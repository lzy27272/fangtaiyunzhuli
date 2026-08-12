package cn.sifangguan.hotelaios.shared.security;

import io.zonky.test.db.postgres.embedded.EmbeddedPostgres;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.Test;

import javax.sql.DataSource;
import java.sql.Connection;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Statement;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.junit.jupiter.api.Assertions.assertThrows;

class PostgresMigrationIntegrationTest {

    private static final String DEMO_TENANT = "10000000-0000-0000-0000-000000000001";
    private static final String OTHER_TENANT = "20000000-0000-0000-0000-000000000002";

    @Test
    void migrationsApplyAndRuntimeRoleIsTenantIsolated() throws Exception {
        try (EmbeddedPostgres postgres = EmbeddedPostgres.builder().start()) {
            DataSource ownerDataSource = postgres.getPostgresDatabase();

            try (Connection connection = ownerDataSource.getConnection();
                 Statement statement = connection.createStatement()) {
                statement.execute("CREATE ROLE hotel_ai_os_app LOGIN PASSWORD 'test-only-password' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT");
            }

            Flyway foundationFlyway = Flyway.configure()
                    .dataSource(ownerDataSource)
                    .locations("classpath:db/migration")
                    .cleanDisabled(true)
                    .target("27")
                    .load();
            int migrations = foundationFlyway.migrate().migrationsExecuted;

            try (Connection connection = ownerDataSource.getConnection();
                 Statement statement = connection.createStatement()) {
                statement.executeUpdate("""
                        INSERT INTO app_role (tenant_id, code, name, role_type)
                        VALUES ('%s'::uuid, 'PLATFORM_ADMIN', '平台管理员', 'SYSTEM')
                        """.formatted(DEMO_TENANT));
            }

            migrations += Flyway.configure()
                    .dataSource(ownerDataSource)
                    .locations("classpath:db/migration")
                    .cleanDisabled(true)
                    .load()
                    .migrate()
                    .migrationsExecuted;

            assertEquals(28, migrations);

            try (Connection owner = ownerDataSource.getConnection();
                 Statement statement = owner.createStatement()) {
                for (String table : REQUIRED_DAILY_OPERATIONS_TABLES) {
                    assertEquals(1, scalarInt(statement, """
                            SELECT count(*) FROM information_schema.tables
                            WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
                              AND table_name = '%s'
                            """.formatted(table)), table + " must exist");
                }
                assertEquals(1, scalarInt(statement,
                        "SELECT count(*) FROM tenant WHERE id = '" + DEMO_TENANT + "'::uuid"));
                assertEquals(12, scalarInt(statement,
                        "SELECT count(*) FROM app_role WHERE tenant_id = '" + DEMO_TENANT + "'::uuid"));
                assertEquals(1, scalarInt(statement, """
                        SELECT count(*) FROM kpi_template_definition
                        WHERE tenant_id = '%s'::uuid AND code = 'KPI-OTA-OPERATION-MANAGER'
                        """.formatted(DEMO_TENANT)));
                assertEquals(1, scalarInt(statement, """
                        SELECT count(*) FROM kpi_template_version version
                        JOIN standard_version standard ON standard.tenant_id = version.tenant_id
                          AND standard.id = version.standard_version_id
                        WHERE version.tenant_id = '%s'::uuid AND standard.lifecycle_status = 'PUBLISHED'
                          AND version.base_full_score = 100
                        """.formatted(DEMO_TENANT)));
                assertTrue(scalarBoolean(statement,
                        "SELECT relrowsecurity AND relforcerowsecurity FROM pg_class WHERE oid = 'work_record'::regclass"));
                for (String table : TENANT_RLS_TABLES) {
                    assertTrue(scalarBoolean(statement,
                            "SELECT relrowsecurity AND relforcerowsecurity FROM pg_class WHERE oid = '" + table + "'::regclass"),
                            table + " must enforce tenant RLS");
                }
                assertEquals(0, scalarInt(statement, """
                        SELECT count(*) FROM pg_trigger
                        WHERE NOT tgisinternal AND tgname IN (
                          'trg_work_package_scope_updated_at',
                          'trg_work_package_item_standard_updated_at',
                          'trg_work_package_item_responsibility_updated_at'
                        )
                        """));

                verifyEventNormalizationAndFrozenRule(statement);
                verifyWorkPackageChildCannotMoveFromPublishedParent(statement);
                verifyDailyOperationsFoundationAndImmutability(statement);
                verifyInvestmentFoundationPermissionsAndImmutability(statement);
                statement.executeUpdate("INSERT INTO tenant (id, code, name) VALUES ('" + OTHER_TENANT + "', 'OTHER', 'Other tenant')");
                statement.executeUpdate("INSERT INTO org_unit (id, tenant_id, code, name, unit_type) VALUES ('22000000-0000-0000-0000-000000000001', '" + OTHER_TENANT + "', 'OTHER-GROUP', 'Other group', 'GROUP')");
            }

            DataSource runtimeDataSource = postgres.getDatabase("hotel_ai_os_app", "postgres");
            try (Connection runtime = runtimeDataSource.getConnection();
                 Statement statement = runtime.createStatement()) {
                runtime.setAutoCommit(false);

                statement.execute("SELECT set_config('app.tenant_id', '" + DEMO_TENANT + "', true)");
                assertEquals(6, scalarInt(statement, "SELECT count(*) FROM org_unit"));
                assertFalse(canSeeTenant(statement, OTHER_TENANT));

                statement.execute("SELECT set_config('app.tenant_id', '" + OTHER_TENANT + "', true)");
                assertEquals(1, scalarInt(statement, "SELECT count(*) FROM org_unit"));
                assertFalse(canSeeTenant(statement, DEMO_TENANT));

                runtime.rollback();
            }
        }
    }

    private static void verifyInvestmentFoundationPermissionsAndImmutability(Statement statement) throws Exception {
        assertEquals(1, scalarInt(statement, """
                SELECT count(*) FROM investment_cost_parameter_version
                WHERE tenant_id = '%s'::uuid AND lifecycle_status = 'ACTIVE'
                """.formatted(DEMO_TENANT)));
        assertEquals(6, scalarInt(statement, """
                SELECT count(*)
                FROM role_permission grant_item
                JOIN app_role role ON role.tenant_id = grant_item.tenant_id AND role.id = grant_item.role_id
                JOIN permission permission_item ON permission_item.id = grant_item.permission_id
                WHERE grant_item.tenant_id = '%s'::uuid
                  AND role.code = 'CEO' AND permission_item.code LIKE 'investment.%%'
                """.formatted(DEMO_TENANT)));
        assertEquals(7, scalarInt(statement, """
                SELECT count(*)
                FROM role_permission grant_item
                JOIN app_role role ON role.tenant_id = grant_item.tenant_id AND role.id = grant_item.role_id
                JOIN permission permission_item ON permission_item.id = grant_item.permission_id
                WHERE grant_item.tenant_id = '%s'::uuid
                  AND role.code = 'PLATFORM_ADMIN' AND permission_item.code LIKE 'investment.%%'
                """.formatted(DEMO_TENANT)));
        assertEquals(0, scalarInt(statement, """
                SELECT count(*)
                FROM role_permission grant_item
                JOIN app_role role ON role.tenant_id = grant_item.tenant_id AND role.id = grant_item.role_id
                JOIN permission permission_item ON permission_item.id = grant_item.permission_id
                WHERE grant_item.tenant_id = '%s'::uuid
                  AND role.code NOT IN ('CEO', 'PLATFORM_ADMIN')
                  AND permission_item.code LIKE 'investment.%%'
                """.formatted(DEMO_TENANT)));

        assertThrows(SQLException.class, () -> statement.executeUpdate("""
                UPDATE investment_cost_parameter_version
                SET salary_per_person_month = 5501
                WHERE tenant_id = '%s'::uuid AND lifecycle_status = 'ACTIVE'
                """.formatted(DEMO_TENANT)));

        String projectId = "50000000-0000-0000-0000-000000000001";
        String versionId = "50000000-0000-0000-0000-000000000002";
        statement.executeUpdate("""
                INSERT INTO investment_project
                    (id, tenant_id, project_no, name, created_by, updated_by)
                SELECT '%s'::uuid, '%s'::uuid, 'TZ-202608-TEST', '迁移测试项目', activated_by, activated_by
                FROM investment_cost_parameter_version
                WHERE tenant_id = '%s'::uuid AND lifecycle_status = 'ACTIVE'
                """.formatted(projectId, DEMO_TENANT, DEMO_TENANT));
        statement.executeUpdate("""
                INSERT INTO investment_plan_version (
                    id, tenant_id, project_id, version_no, lifecycle_status, project_name_snapshot,
                    rent_per_sqm_month, property_area_sqm, property_fee_per_sqm_month,
                    room_count, staff_count, positioning, management_fee_rate, selling_room_rate,
                    investment_total, cost_parameter_version_id, calculation_snapshot,
                    content_hash, created_by, updated_by, confirmed_by, confirmed_at
                )
                SELECT '%s'::uuid, '%s'::uuid, '%s'::uuid, 1, 'FORMAL', '迁移测试项目',
                       50, 1000, 10, 100, 10, 'FOUR_DIAMOND', 0.05, 300,
                       20000000, id, '{}'::jsonb, repeat('f', 64),
                       activated_by, activated_by, activated_by, now()
                FROM investment_cost_parameter_version
                WHERE tenant_id = '%s'::uuid AND lifecycle_status = 'ACTIVE'
                """.formatted(versionId, DEMO_TENANT, projectId, DEMO_TENANT));

        assertThrows(SQLException.class, () -> statement.executeUpdate(
                "UPDATE investment_plan_version SET selling_room_rate = 301 WHERE id = '" + versionId + "'::uuid"));
        assertThrows(SQLException.class, () -> statement.executeUpdate(
                "DELETE FROM investment_plan_version WHERE id = '" + versionId + "'::uuid"));
        assertEquals(1, statement.executeUpdate(
                "UPDATE investment_plan_version SET lifecycle_status = 'HISTORICAL' WHERE id = '" + versionId + "'::uuid"));
        assertThrows(SQLException.class, () -> statement.executeUpdate(
                "UPDATE investment_plan_version SET lifecycle_status = 'FORMAL' WHERE id = '" + versionId + "'::uuid"));
    }

    private static void verifyEventNormalizationAndFrozenRule(Statement statement) throws Exception {
        String outboxId = "30000000-0000-0000-0000-000000000001";
        statement.executeUpdate("""
                INSERT INTO outbox_event
                    (id, tenant_id, aggregate_type, aggregate_id, event_type, payload)
                VALUES
                    ('%s', '%s', 'TEST', gen_random_uuid(), 'WorkRecordSubmitted', '{}'::jsonb)
                """.formatted(outboxId, DEMO_TENANT));
        assertEquals("WORKRECORDSUBMITTED", scalarString(statement,
                "SELECT event_type FROM outbox_event WHERE id = '" + outboxId + "'::uuid"));
        assertEquals(outboxId, scalarString(statement,
                "SELECT trace_id::text FROM outbox_event WHERE id = '" + outboxId + "'::uuid"));
        assertEquals("event:" + outboxId, scalarString(statement,
                "SELECT idempotency_key FROM outbox_event WHERE id = '" + outboxId + "'::uuid"));

        String ruleId = "30000000-0000-0000-0000-000000000002";
        String versionId = "30000000-0000-0000-0000-000000000003";
        String draftVersionId = "30000000-0000-0000-0000-000000000004";
        String scopeId = "30000000-0000-0000-0000-000000000005";
        statement.executeUpdate("""
                INSERT INTO rule_definition
                    (id, tenant_id, code, name, event_type, created_by)
                VALUES
                    ('%s', '%s', 'MIGRATION-FREEZE', 'Migration freeze test',
                     'WorkRecordSubmitted', '19000000-0000-0000-0000-000000000001')
                """.formatted(ruleId, DEMO_TENANT));
        statement.executeUpdate("""
                INSERT INTO rule_version
                    (id, tenant_id, rule_id, version_no, lifecycle_status, condition_ast,
                     actions, content_hash, effective_from, published_by, published_at, created_by)
                VALUES
                    ('%s', '%s', '%s', 1, 'DRAFT', '{"op":"EXISTS","fact":"id"}'::jsonb,
                     '[{"key":"notify","type":"CREATE_NOTIFICATION"}]'::jsonb,
                     repeat('a', 64), NULL,
                     NULL, NULL,
                     '19000000-0000-0000-0000-000000000001')
                """.formatted(versionId, DEMO_TENANT, ruleId));
        statement.executeUpdate("""
                INSERT INTO rule_scope (id, tenant_id, rule_version_id, scope_type)
                VALUES ('%s', '%s', '%s', 'TENANT')
                """.formatted(scopeId, DEMO_TENANT, versionId));
        statement.executeUpdate("""
                UPDATE rule_version
                SET lifecycle_status = 'PUBLISHED', effective_from = now() - interval '1 minute',
                    published_by = '19000000-0000-0000-0000-000000000001', published_at = now(),
                    row_version = row_version + 1
                WHERE id = '%s'::uuid
                """.formatted(versionId));
        statement.executeUpdate("""
                INSERT INTO rule_version
                    (id, tenant_id, rule_id, version_no, lifecycle_status, condition_ast,
                     actions, content_hash, created_by)
                VALUES
                    ('%s', '%s', '%s', 2, 'DRAFT', '{"op":"EXISTS","fact":"id"}'::jsonb,
                     '[{"key":"notify","type":"CREATE_NOTIFICATION"}]'::jsonb,
                     repeat('c', 64), '19000000-0000-0000-0000-000000000001')
                """.formatted(draftVersionId, DEMO_TENANT, ruleId));

        assertThrows(SQLException.class, () -> statement.executeUpdate(
                "UPDATE rule_version SET lifecycle_status = 'DRAFT' WHERE id = '" + versionId + "'::uuid"));
        assertThrows(SQLException.class, () -> statement.executeUpdate(
                "UPDATE rule_version SET condition_ast = '{\"op\":\"TRUE\"}'::jsonb WHERE id = '" + versionId + "'::uuid"));
        assertThrows(SQLException.class, () -> statement.executeUpdate(
                "DELETE FROM rule_scope WHERE rule_version_id = '" + versionId + "'::uuid"));
        assertThrows(SQLException.class, () -> statement.executeUpdate("""
                UPDATE rule_scope SET rule_version_id = '%s'::uuid WHERE id = '%s'::uuid
                """.formatted(draftVersionId, scopeId)));

        assertEquals(1, statement.executeUpdate("""
                UPDATE rule_version
                SET lifecycle_status = 'DISABLED', effective_to = now(), row_version = row_version + 1
                WHERE id = '%s'::uuid
                """.formatted(versionId)));
        assertThrows(SQLException.class, () -> statement.executeUpdate(
                "UPDATE rule_version SET effective_to = now() + interval '1 hour' WHERE id = '" + versionId + "'::uuid"));
    }

    private static void verifyWorkPackageChildCannotMoveFromPublishedParent(Statement statement) throws Exception {
        String definitionId = "30000000-0000-0000-0000-000000000010";
        String publishedVersionId = "30000000-0000-0000-0000-000000000011";
        String draftVersionId = "30000000-0000-0000-0000-000000000012";
        String itemId = "30000000-0000-0000-0000-000000000013";
        String scopeId = "30000000-0000-0000-0000-000000000014";
        statement.executeUpdate("""
                INSERT INTO work_package_definition
                    (id, tenant_id, code, name, position_id, created_by)
                VALUES
                    ('%s', '%s', 'MIGRATION-WP', 'Migration work package',
                     '14000000-0000-0000-0000-000000000001',
                     '19000000-0000-0000-0000-000000000001')
                """.formatted(definitionId, DEMO_TENANT));
        statement.executeUpdate("""
                INSERT INTO work_package_version
                    (id, tenant_id, work_package_definition_id, version_no, lifecycle_status,
                     title, content_hash, effective_from, published_by, published_at, created_by)
                VALUES
                    ('%s', '%s', '%s', 1, 'DRAFT', 'Published', repeat('b', 64), now(),
                     NULL, NULL,
                     '19000000-0000-0000-0000-000000000001'),
                    ('%s', '%s', '%s', 2, 'DRAFT', 'Draft', NULL, NULL, NULL, NULL,
                     '19000000-0000-0000-0000-000000000001')
                """.formatted(publishedVersionId, DEMO_TENANT, definitionId,
                draftVersionId, DEMO_TENANT, definitionId));
        statement.executeUpdate("""
                INSERT INTO work_package_item
                    (id, tenant_id, work_package_version_id, item_code, name, item_type, period_type)
                VALUES
                    ('%s', '%s', '%s', 'PUBLISHED-ITEM', 'Published item',
                     'SCHEDULED_RECORD', 'DAY')
                """.formatted(itemId, DEMO_TENANT, publishedVersionId));
        statement.executeUpdate("""
                UPDATE work_package_version
                SET lifecycle_status = 'PUBLISHED', published_at = now(),
                    published_by = '19000000-0000-0000-0000-000000000001'
                WHERE id = '%s'::uuid
                """.formatted(publishedVersionId));
        assertThrows(SQLException.class, () -> statement.executeUpdate("""
                UPDATE work_package_item SET work_package_version_id = '%s'
                WHERE id = '%s'::uuid
                """.formatted(draftVersionId, itemId)));

        statement.executeUpdate("""
                INSERT INTO work_package_scope (id, tenant_id, work_package_version_id, scope_type)
                VALUES ('%s', '%s', '%s', 'TENANT')
                """.formatted(scopeId, DEMO_TENANT, draftVersionId));
        assertEquals(1, statement.executeUpdate(
                "UPDATE work_package_scope SET scope_type = 'TENANT' WHERE id = '" + scopeId + "'::uuid"));
    }

    private static void verifyDailyOperationsFoundationAndImmutability(Statement statement) throws Exception {
        String auditId = "30000000-0000-0000-0000-000000000020";
        String correlationId = "30000000-0000-0000-0000-000000000021";
        statement.executeUpdate("""
                INSERT INTO audit_log
                    (id, tenant_id, action, resource_type, resource_id, correlation_id, after_data)
                VALUES
                    ('%s', '%s', 'MIGRATION_TEST', 'DAILY_OPERATION', gen_random_uuid(), '%s', '{}'::jsonb)
                """.formatted(auditId, DEMO_TENANT, correlationId));
        assertEquals(correlationId, scalarString(statement,
                "SELECT trace_id::text FROM audit_log WHERE id = '" + auditId + "'::uuid"));
        assertThrows(SQLException.class, () -> statement.executeUpdate(
                "UPDATE audit_log SET after_data = '{\"tampered\":true}'::jsonb WHERE id = '" + auditId + "'::uuid"));

        String templateId = "30000000-0000-0000-0000-000000000022";
        String versionId = "30000000-0000-0000-0000-000000000023";
        statement.executeUpdate("""
                INSERT INTO daily_report_template_definition
                    (id, tenant_id, code, name, template_origin, owner_org_unit_id, position_id, created_by)
                VALUES
                    ('%s', '%s', 'MIGRATION-DAILY-REPORT', 'Migration daily report', 'HQ',
                     '12000000-0000-0000-0000-000000000001',
                     '14000000-0000-0000-0000-000000000001',
                     '19000000-0000-0000-0000-000000000001')
                """.formatted(templateId, DEMO_TENANT));
        statement.executeUpdate("""
                INSERT INTO daily_report_template_version
                    (id, tenant_id, template_id, version_no, lifecycle_status,
                     work_package_version_id, configuration, content_hash, created_by)
                SELECT
                    '%s', '%s', '%s', 1, 'DRAFT', id, '{}'::jsonb, repeat('d', 64),
                    '19000000-0000-0000-0000-000000000001'
                FROM work_package_version
                WHERE tenant_id = '%s'::uuid
                ORDER BY created_at
                LIMIT 1
                """.formatted(versionId, DEMO_TENANT, templateId, DEMO_TENANT));
        statement.executeUpdate("""
                UPDATE daily_report_template_version
                SET lifecycle_status = 'PUBLISHED', effective_from = now(),
                    published_by = '19000000-0000-0000-0000-000000000001', published_at = now(),
                    row_version = row_version + 1
                WHERE id = '%s'::uuid
                """.formatted(versionId));
        assertThrows(SQLException.class, () -> statement.executeUpdate(
                "UPDATE daily_report_template_version SET configuration = '{\"changed\":true}'::jsonb "
                        + "WHERE id = '" + versionId + "'::uuid"));
        assertThrows(SQLException.class, () -> statement.executeUpdate(
                "DELETE FROM daily_report_template_version WHERE id = '" + versionId + "'::uuid"));

        assertTrue(scalarString(statement, """
                SELECT pg_get_constraintdef(oid)
                FROM pg_constraint
                WHERE conrelid = 'rule_action_execution'::regclass
                  AND conname = 'ck_rule_action_execution_type'
                """).contains("CREATE_TASK_CANDIDATE"));
    }

    private static final String[] REQUIRED_DAILY_OPERATIONS_TABLES = {
            "hotel_business_day_config", "closed_loop_trace", "command_idempotency_record",
            "daily_report_template_definition", "daily_report_template_version",
            "daily_report_section_definition", "daily_report_section_version",
            "daily_report_template_section", "daily_report_template_item",
            "daily_report_template_assignment", "daily_report", "daily_report_revision",
            "daily_report_item_result", "daily_report_source_reference", "daily_report_evidence",
            "daily_report_review", "issue_event", "issue_source_link", "issue_transition",
            "task_candidate", "issue_task_link", "sync_operation", "business_day_run",
            "daily_operation_snapshot", "daily_operation_snapshot_metric", "action_item",
            "notification_delivery", "ai_request", "ai_recommendation",
            "ai_recommendation_source", "ai_decision", "operation_export_job",
            "wecom_user_binding", "wecom_chat_binding", "wecom_inbound_receipt",
            "wecom_task_card_binding", "wecom_oauth_attempt",
            "daily_report_delivery_policy"
            , "metric_definition_version", "kpi_compensation_policy_definition",
            "kpi_compensation_policy_version", "kpi_template_definition", "kpi_template_version",
            "kpi_template_section", "kpi_indicator_rule", "kpi_template_approval", "kpi_template_binding",
            "kpi_assessment_relation", "kpi_relation_scope", "kpi_period", "kpi_responsibility_snapshot",
            "kpi_metric_fact", "kpi_scorecard", "kpi_scorecard_revision", "kpi_indicator_result",
            "kpi_manual_score", "kpi_evidence", "kpi_review", "kpi_dispute", "kpi_correction",
            "kpi_bonus_adjustment", "kpi_employee_bonus_base", "kpi_settlement", "kpi_template_import_job",
            "kpi_inspection_schedule", "kpi_inspection_submission", "kpi_inspection_abnormality_event",
            "kpi_inspection_verification", "kpi_inspection_sla_breach", "kpi_automation_run",
            "investment_cost_parameter_version", "investment_project_number_counter",
            "investment_project", "investment_plan_version"
    };

    private static final String[] TENANT_RLS_TABLES = {
            "work_package_definition", "work_package_version", "work_package_scope",
            "work_package_item", "work_package_item_standard", "work_package_item_responsibility",
            "work_package_allocation", "work_duty_period", "work_expectation",
            "event_consumer_inbox", "management_event",
            "rule_definition", "rule_version", "rule_scope", "rule_evaluation", "rule_action_execution",
            "management_task", "task_participant", "task_transition", "task_evidence", "task_escalation",
            "standard_evaluation", "standard_evaluation_item", "evaluation_evidence", "notification"
            , "enterprise_template_definition", "enterprise_template_version", "work_record_supplement",
            "hotel_business_day_config", "closed_loop_trace", "command_idempotency_record",
            "daily_report_template_definition", "daily_report_template_version",
            "daily_report_section_definition", "daily_report_section_version",
            "daily_report_template_section", "daily_report_template_item",
            "daily_report_template_assignment", "daily_report", "daily_report_revision",
            "daily_report_item_result", "daily_report_source_reference", "daily_report_evidence",
            "daily_report_review", "issue_event", "issue_source_link", "issue_transition",
            "task_candidate", "issue_task_link", "sync_operation", "business_day_run",
            "daily_operation_snapshot", "daily_operation_snapshot_metric", "action_item",
            "notification_delivery", "ai_request", "ai_recommendation",
            "ai_recommendation_source", "ai_decision", "operation_export_job",
            "wecom_user_binding", "wecom_chat_binding", "wecom_inbound_receipt",
            "wecom_task_card_binding", "wecom_oauth_attempt",
            "daily_report_delivery_policy",
            "investment_cost_parameter_version", "investment_project_number_counter",
            "investment_project", "investment_plan_version"
    };

    private static int scalarInt(Statement statement, String sql) throws Exception {
        try (ResultSet resultSet = statement.executeQuery(sql)) {
            assertTrue(resultSet.next());
            return resultSet.getInt(1);
        }
    }

    private static boolean scalarBoolean(Statement statement, String sql) throws Exception {
        try (ResultSet resultSet = statement.executeQuery(sql)) {
            assertTrue(resultSet.next());
            return resultSet.getBoolean(1);
        }
    }

    private static String scalarString(Statement statement, String sql) throws Exception {
        try (ResultSet resultSet = statement.executeQuery(sql)) {
            assertTrue(resultSet.next());
            return resultSet.getString(1);
        }
    }

    private static boolean canSeeTenant(Statement statement, String tenantId) throws Exception {
        return scalarInt(statement,
                "SELECT count(*) FROM tenant WHERE id = '" + tenantId + "'::uuid") > 0;
    }
}
