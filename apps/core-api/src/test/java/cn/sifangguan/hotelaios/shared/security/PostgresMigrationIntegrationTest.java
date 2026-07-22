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

            int migrations = Flyway.configure()
                    .dataSource(ownerDataSource)
                    .locations("classpath:db/migration")
                    .cleanDisabled(true)
                    .load()
                    .migrate()
                    .migrationsExecuted;

            assertEquals(17, migrations);

            try (Connection owner = ownerDataSource.getConnection();
                 Statement statement = owner.createStatement()) {
                assertEquals(53, scalarInt(statement,
                        "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' AND table_name <> 'flyway_schema_history'"));
                assertEquals(1, scalarInt(statement,
                        "SELECT count(*) FROM tenant WHERE id = '" + DEMO_TENANT + "'::uuid"));
                assertEquals(8, scalarInt(statement,
                        "SELECT count(*) FROM app_role WHERE tenant_id = '" + DEMO_TENANT + "'::uuid"));
                assertTrue(scalarBoolean(statement,
                        "SELECT relrowsecurity AND relforcerowsecurity FROM pg_class WHERE oid = 'work_record'::regclass"));
                for (String table : SPRINT_2_TENANT_TABLES) {
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

    private static final String[] SPRINT_2_TENANT_TABLES = {
            "work_package_definition", "work_package_version", "work_package_scope",
            "work_package_item", "work_package_item_standard", "work_package_item_responsibility",
            "work_package_allocation", "work_duty_period", "work_expectation",
            "event_consumer_inbox", "management_event",
            "rule_definition", "rule_version", "rule_scope", "rule_evaluation", "rule_action_execution",
            "management_task", "task_participant", "task_transition", "task_evidence", "task_escalation",
            "standard_evaluation", "standard_evaluation_item", "evaluation_evidence", "notification"
            , "enterprise_template_definition", "enterprise_template_version", "work_record_supplement"
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
