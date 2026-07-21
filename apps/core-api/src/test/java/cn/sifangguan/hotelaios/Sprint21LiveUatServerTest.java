package cn.sifangguan.hotelaios;

import com.fasterxml.jackson.databind.ObjectMapper;
import io.zonky.test.db.postgres.embedded.EmbeddedPostgres;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfSystemProperty;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.test.annotation.DirtiesContext;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.context.TestContext;
import org.springframework.test.context.TestExecutionListeners;
import org.springframework.test.context.support.AbstractTestExecutionListener;
import org.springframework.test.context.support.DirtiesContextTestExecutionListener;

import javax.sql.DataSource;
import java.nio.file.Files;
import java.nio.file.Path;
import java.sql.Connection;
import java.time.Duration;
import java.time.Instant;
import java.time.temporal.TemporalAccessor;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Opt-in live UAT host. It runs the real HTTP application against PostgreSQL with
 * a non-superuser runtime account and the production Bearer-JWT security chain so
 * browser evidence can be captured without Docker.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@DirtiesContext(classMode = DirtiesContext.ClassMode.AFTER_CLASS)
@EnabledIfSystemProperty(named = "uat.live", matches = "true")
@TestExecutionListeners(
        listeners = Sprint21LiveUatServerTest.InfrastructureShutdownListener.class,
        mergeMode = TestExecutionListeners.MergeMode.MERGE_WITH_DEFAULTS
)
class Sprint21LiveUatServerTest {
    private static final String RUNTIME_USER = "hotel_ai_os_app";
    private static final String RUNTIME_PASSWORD = "uat-runtime-only";
    private static final EmbeddedPostgres POSTGRES;
    private static final DataSource OWNER_DATA_SOURCE;
    private static final Path REPO_ROOT = Path.of("..", "..").toAbsolutePath().normalize();
    private static final Path RUNTIME_DIR = REPO_ROOT.resolve("docs/uat/evidence/runtime");
    private static final Path READY_FILE = RUNTIME_DIR.resolve("live-api-port.txt");
    private static final Path STOP_FILE = RUNTIME_DIR.resolve("stop-live-server.flag");
    private static final ObjectMapper JSON = new ObjectMapper().findAndRegisterModules();

    static {
        EmbeddedPostgres postgres = startPostgres();
        try {
            DataSource ownerDataSource = postgres.getPostgresDatabase();
            createRuntimeRole(ownerDataSource);
            POSTGRES = postgres;
            OWNER_DATA_SOURCE = ownerDataSource;
        } catch (RuntimeException | Error failure) {
            try {
                postgres.close();
            } catch (Throwable closeFailure) {
                failure.addSuppressed(closeFailure);
            }
            throw failure;
        }
    }

    @LocalServerPort
    private int port;

    @Value("${app.attachments.root}")
    private Path attachmentRoot;

    @DynamicPropertySource
    static void properties(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", Sprint21LiveUatServerTest::jdbcUrl);
        registry.add("spring.datasource.username", () -> RUNTIME_USER);
        registry.add("spring.datasource.password", () -> RUNTIME_PASSWORD);
        registry.add("spring.flyway.user", () -> "postgres");
        registry.add("spring.flyway.password", () -> "postgres");
        registry.add("app.security.development-header-auth-enabled", () -> false);
        registry.add("app.security.jwt.issuer-uri", Sprint21LiveUatServerTest::jwtIssuerUri);
        registry.add("app.security.jwt.audience", () -> "hotel-ai-os-api");
        registry.add("app.database.rls-enabled", () -> true);
        registry.add("app.work-expectation.sla.scheduler-enabled", () -> false);
        registry.add("app.automation.worker.enabled", () -> true);
        registry.add("app.automation.worker.tenant-ids", () -> "10000000-0000-0000-0000-000000000001");
        registry.add("app.automation.worker.batch-size", () -> 100);
        registry.add("app.automation.worker.initial-delay-ms", () -> 200);
        registry.add("app.automation.worker.fixed-delay-ms", () -> 250);
        registry.add("app.attachments.root", () -> REPO_ROOT.resolve(".uat-runtime/attachments").toString());
        registry.add("app.attachments.scan.command-path", Sprint21LiveUatServerTest::malwareScannerPath);
        registry.add("app.attachments.scan.command-arguments", Sprint21LiveUatServerTest::malwareScannerArguments);
        registry.add("app.tasks.default-escalation-delay-hours", () -> 0);
        registry.add("app.web.allowed-origins", () -> "http://127.0.0.1:5173,http://localhost:5173");
    }

    @Test
    void hostsRealApiUntilTheUatRunnerSignalsCompletion() throws Exception {
        Files.createDirectories(RUNTIME_DIR);
        Files.deleteIfExists(STOP_FILE);
        importFixture();
        assertFixtureReady();
        Files.createDirectories(attachmentRoot);
        Files.writeString(READY_FILE, Integer.toString(port));
        System.out.printf("SPRINT21_LIVE_UAT_READY port=%d%n", port);

        Instant deadline = Instant.now().plus(Duration.ofMinutes(15));
        while (!Files.exists(STOP_FILE) && Instant.now().isBefore(deadline)) {
            Thread.sleep(250);
        }
        assertThat(Files.exists(STOP_FILE))
                .as("UAT runner must create %s before the 15-minute deadline", STOP_FILE)
                .isTrue();
        exportDatabaseEvidence();
        Files.deleteIfExists(STOP_FILE);
        Files.deleteIfExists(READY_FILE);
    }

    private static void importFixture() throws Exception {
        String fixture = Files.readString(REPO_ROOT.resolve("database/uat/001_sprint2_1_uat_fixture.sql"))
                .replaceAll("(?m)^\\\\.*(?:\\R|$)", "");
        try (Connection connection = OWNER_DATA_SOURCE.getConnection(); var statement = connection.createStatement()) {
            statement.execute(fixture);
        }
    }

    private static void assertFixtureReady() throws Exception {
        try (Connection connection = OWNER_DATA_SOURCE.getConnection(); var statement = connection.createStatement()) {
            try (var result = statement.executeQuery("""
                    select count(*)
                    from user_account
                    where tenant_id = '10000000-0000-0000-0000-000000000001'::uuid
                      and id in (
                        '19000000-0000-0000-0000-000000000003'::uuid,
                        '19000000-0000-0000-0000-000000000004'::uuid,
                        '19000000-0000-0000-0000-000000000005'::uuid,
                        '19000000-0000-0000-0000-000000000008'::uuid,
                        '19000000-0000-0000-0000-000000000002'::uuid,
                        '19000000-0000-0000-0000-000000000007'::uuid
                      )
                    """)) {
                assertThat(result.next()).isTrue();
                assertThat(result.getInt(1)).isEqualTo(6);
            }
        }
    }

    private static void exportDatabaseEvidence() throws Exception {
        String runId = System.getProperty("uat.run-id", "manual").replaceAll("[^A-Za-z0-9._-]", "-");
        Path databaseEvidence = REPO_ROOT.resolve("docs/uat/evidence").resolve(runId).resolve("database");
        Files.createDirectories(databaseEvidence);

        exportQuery(databaseEvidence, "00-environment.json", """
                select version() as postgres_version,
                       (select version from flyway_schema_history where success order by installed_rank desc limit 1) as flyway_version,
                       (select count(*) from flyway_schema_history where success) as successful_migrations,
                       (select rolname from pg_roles where rolname = 'hotel_ai_os_app') as runtime_role,
                       (select rolsuper from pg_roles where rolname = 'hotel_ai_os_app') as runtime_role_superuser,
                       (select rolbypassrls from pg_roles where rolname = 'hotel_ai_os_app') as runtime_role_bypass_rls,
                       (select count(*)
                          from pg_class c
                          join pg_namespace n on n.oid = c.relnamespace
                         where n.nspname = 'public' and c.relkind = 'r'
                           and c.relrowsecurity and c.relforcerowsecurity) as forced_rls_tables
                """);
        exportQuery(databaseEvidence, "01-six-role-accounts.json", """
                select ua.id::text as account_id, ua.login_name, ua.display_name, ua.status,
                       coalesce(string_agg(distinct ar.code, ',' order by ar.code), '') as roles,
                       count(distinct pa.id) filter (
                         where pa.status = 'ACTIVE' and pa.valid_from <= current_date
                           and (pa.valid_to is null or pa.valid_to >= current_date)
                       ) as active_assignment_count
                  from user_account ua
                  left join role_assignment ra on ra.tenant_id = ua.tenant_id and ra.account_id = ua.id
                  left join app_role ar on ar.tenant_id = ra.tenant_id and ar.id = ra.role_id
                  left join employee e on e.tenant_id = ua.tenant_id and e.account_id = ua.id
                  left join employee_position_assignment pa on pa.tenant_id = e.tenant_id and pa.employee_id = e.id
                 where ua.tenant_id = '10000000-0000-0000-0000-000000000001'::uuid
                   and ua.id in (
                     '19000000-0000-0000-0000-000000000003'::uuid,
                     '19000000-0000-0000-0000-000000000004'::uuid,
                     '19000000-0000-0000-0000-000000000005'::uuid,
                     '19000000-0000-0000-0000-000000000008'::uuid,
                     '19000000-0000-0000-0000-000000000002'::uuid,
                     '19000000-0000-0000-0000-000000000007'::uuid
                   )
                 group by ua.id, ua.login_name, ua.display_name, ua.status
                 order by ua.login_name
                """);
        exportQuery(databaseEvidence, "02-work-records-and-attachments.json", """
                select w.id::text as work_record_id, w.record_kind, w.status,
                       w.org_unit_id::text, w.position_assignment_id::text,
                       w.work_expectation_id::text, w.work_package_item_id::text,
                       w.business_date::text, w.payload::text, w.submitted_at::text,
                       a.id::text as attachment_id, a.original_name, a.media_type,
                       a.size_bytes, a.sha256, a.scan_status, a.object_key
                  from work_record w
                  left join attachment a on a.tenant_id = w.tenant_id and a.work_record_id = w.id
                 where w.tenant_id = '10000000-0000-0000-0000-000000000001'::uuid
                   and (w.id = '2e000000-0000-0000-0000-000000000001'::uuid
                        or w.work_package_item_id = '2a200000-0000-0000-0000-000000000001'::uuid)
                 order by w.created_at, a.created_at
                """);
        exportQuery(databaseEvidence, "03-standard-evaluations.json", """
                select e.id::text as evaluation_id, e.subject_type, e.subject_id::text,
                       e.org_unit_id::text, e.position_assignment_id::text,
                       e.standard_version_id::text, e.execution_status, e.outcome,
                       e.score, e.full_score, e.severity, e.input_snapshot::text,
                       e.created_at::text, e.completed_at::text
                  from standard_evaluation e
                 where e.tenant_id = '10000000-0000-0000-0000-000000000001'::uuid
                   and e.standard_version_id in (
                     '27000000-0000-0000-0000-000000000002'::uuid,
                     '27000000-0000-0000-0000-000000000003'::uuid
                   )
                 order by e.created_at
                """);
        exportQuery(databaseEvidence, "04-management-tasks.json", """
                select t.id::text as task_id, t.task_no, t.title, t.lifecycle_status, t.sla_status,
                       t.priority, t.work_record_id::text, t.standard_version_id::text,
                       t.org_unit_id::text, t.due_at::text, t.completed_at::text,
                       t.source_snapshot::text, t.result_snapshot::text,
                       (select jsonb_agg(jsonb_build_object(
                                  'type', p.participant_type,
                                  'assignmentId', p.position_assignment_id,
                                  'employee', p.employee_snapshot,
                                  'position', p.position_snapshot
                                ) order by p.participant_type)::text
                          from task_participant p
                         where p.tenant_id = t.tenant_id and p.task_id = t.id) as participants
                  from management_task t
                 where t.tenant_id = '10000000-0000-0000-0000-000000000001'::uuid
                   and (t.title like '%（UAT）%' or t.source_snapshot ->> 'scenario' in ('A','B','C'))
                 order by t.created_at
                """);
        exportQuery(databaseEvidence, "05-task-timeline.json", """
                select t.id::text as task_id, t.title, x.id::text as transition_id,
                       x.from_status, x.to_status, x.command,
                       x.actor_account_id::text, x.actor_assignment_id::text,
                       x.task_version, x.payload::text, x.occurred_at::text,
                       x.standard_evaluation_id::text
                  from management_task t
                  join task_transition x on x.tenant_id = t.tenant_id and x.task_id = t.id
                 where t.tenant_id = '10000000-0000-0000-0000-000000000001'::uuid
                   and (t.title like '%（UAT）%' or t.source_snapshot ->> 'scenario' in ('A','B','C'))
                 order by t.created_at, x.occurred_at, x.id
                """);
        exportQuery(databaseEvidence, "06-task-evidence.json", """
                select t.id::text as task_id, t.title, e.id::text as evidence_id,
                       e.submitted_by_assignment_id::text, e.evidence_type, e.object_key,
                       e.original_name, e.media_type, e.size_bytes, e.sha256,
                       e.structured_result::text, e.created_at::text
                  from management_task t
                  join task_evidence e on e.tenant_id = t.tenant_id and e.task_id = t.id
                 where t.tenant_id = '10000000-0000-0000-0000-000000000001'::uuid
                   and (t.title like '%（UAT）%' or t.source_snapshot ->> 'scenario' in ('A','B','C'))
                 order by t.created_at, e.created_at
                """);
        exportQuery(databaseEvidence, "07-missed-expectation.json", """
                select x.id::text as work_expectation_id, x.status,
                       x.position_assignment_id::text, x.target_org_unit_id::text,
                       x.business_date::text, x.available_at::text, x.due_at::text,
                       x.row_version, x.updated_at::text
                  from work_expectation x
                 where x.tenant_id = '10000000-0000-0000-0000-000000000001'::uuid
                   and x.id = '2a500000-0000-0000-0000-000000000005'::uuid
                """);
        exportQuery(databaseEvidence, "08-notifications.json", """
                select n.id::text as notification_id, n.recipient_account_id::text,
                       n.recipient_assignment_id::text, n.notification_type,
                       n.title, n.content, n.source_type, n.source_id::text,
                       n.delivered_at::text, n.read_at::text
                  from notification n
                 where n.tenant_id = '10000000-0000-0000-0000-000000000001'::uuid
                   and n.notification_type in ('MISSED_WORK_REMINDER','TASK_OVERDUE','TASK_ESCALATED')
                 order by n.delivered_at
                """);
        exportQuery(databaseEvidence, "09-task-escalations.json", """
                select t.id::text as task_id, t.title, t.sla_status,
                       e.id::text as escalation_id, e.escalation_level,
                       e.scheduled_at::text, e.resolved_assignment_id::text,
                       e.status, e.executed_at::text, e.resolver_snapshot::text
                  from management_task t
                  join task_escalation e on e.tenant_id = t.tenant_id and e.task_id = t.id
                 where t.tenant_id = '10000000-0000-0000-0000-000000000001'::uuid
                   and t.title like '%（UAT）%'
                 order by t.created_at, e.escalation_level
                """);
        exportQuery(databaseEvidence, "10-rule-events-and-actions.json", """
                select m.id::text as management_event_id, m.event_type,
                       m.org_unit_id::text, m.position_assignment_id::text,
                       m.processing_status, m.payload_snapshot::text,
                       a.id::text as action_id, a.action_key, a.action_type,
                       a.status as action_status, a.target_id::text
                  from management_event m
                  left join rule_action_execution a
                    on a.tenant_id = m.tenant_id and a.management_event_id = m.id
                 where m.tenant_id = '10000000-0000-0000-0000-000000000001'::uuid
                   and m.event_type in ('STANDARDEVALUATIONCOMPLETED','WORKEXPECTATIONMISSED','COMPLAINTREPORTED')
                 order by m.occurred_at, a.created_at
                """);
        exportQuery(databaseEvidence, "11-database-summary.json", """
                select
                  (select count(*) from user_account where tenant_id = '10000000-0000-0000-0000-000000000001'::uuid
                    and id in ('19000000-0000-0000-0000-000000000003'::uuid,'19000000-0000-0000-0000-000000000004'::uuid,
                               '19000000-0000-0000-0000-000000000005'::uuid,'19000000-0000-0000-0000-000000000008'::uuid,
                               '19000000-0000-0000-0000-000000000002'::uuid,'19000000-0000-0000-0000-000000000007'::uuid)) as six_role_accounts,
                  (select count(*) from attachment where tenant_id = '10000000-0000-0000-0000-000000000001'::uuid and work_record_id = '2e000000-0000-0000-0000-000000000001'::uuid) as hygiene_attachments,
                  (select count(*) from standard_evaluation where tenant_id = '10000000-0000-0000-0000-000000000001'::uuid and outcome in ('FAIL','PASS')) as completed_evaluations,
                  (select count(*) from management_task where tenant_id = '10000000-0000-0000-0000-000000000001'::uuid and title like '%（UAT）%') as uat_tasks,
                  (select count(*) from management_task where tenant_id = '10000000-0000-0000-0000-000000000001'::uuid and title like '%（UAT）%' and lifecycle_status = 'COMPLETED') as completed_uat_tasks,
                  (select count(*) from management_task where tenant_id = '10000000-0000-0000-0000-000000000001'::uuid and title like '%（UAT）%' and lifecycle_status = 'CANCELLED') as cancelled_uat_tasks,
                  (select count(*) from management_task where tenant_id = '10000000-0000-0000-0000-000000000001'::uuid and source_snapshot ->> 'scenario' = 'SUPERVISOR_MANUAL_CREATE') as supervisor_manual_tasks,
                  (select count(*) from task_transition where tenant_id = '10000000-0000-0000-0000-000000000001'::uuid and command = 'ESCALATE') as escalation_transitions,
                  (select count(*) from notification where tenant_id = '10000000-0000-0000-0000-000000000001'::uuid and notification_type = 'MISSED_WORK_REMINDER') as missed_work_reminders
                """);
    }

    private static void exportQuery(Path directory, String fileName, String sql) throws Exception {
        List<Map<String, Object>> rows = new java.util.ArrayList<>();
        try (Connection connection = OWNER_DATA_SOURCE.getConnection();
             var statement = connection.createStatement();
             var result = statement.executeQuery(sql)) {
            var metadata = result.getMetaData();
            while (result.next()) {
                Map<String, Object> row = new LinkedHashMap<>();
                for (int column = 1; column <= metadata.getColumnCount(); column++) {
                    Object value = result.getObject(column);
                    if (value instanceof UUID || value instanceof TemporalAccessor
                            || value instanceof java.sql.Timestamp || value instanceof java.sql.Date
                            || (value != null && value.getClass().getName().startsWith("org.postgresql."))) {
                        value = value.toString();
                    }
                    row.put(metadata.getColumnLabel(column), value);
                }
                rows.add(row);
            }
        }
        JSON.writerWithDefaultPrettyPrinter().writeValue(directory.resolve(fileName).toFile(), rows);
    }

    private static EmbeddedPostgres startPostgres() {
        try {
            return EmbeddedPostgres.builder().start();
        } catch (Exception exception) {
            throw new ExceptionInInitializerError(exception);
        }
    }

    private static void createRuntimeRole(DataSource ownerDataSource) {
        try (Connection connection = ownerDataSource.getConnection(); var statement = connection.createStatement()) {
            statement.execute("""
                    do $$ begin
                      if not exists (select 1 from pg_roles where rolname = 'hotel_ai_os_app') then
                        create role hotel_ai_os_app login password 'uat-runtime-only';
                      end if;
                    end $$
                    """);
        } catch (Exception exception) {
            throw new ExceptionInInitializerError(exception);
        }
    }

    private static String jdbcUrl() {
        try (Connection connection = OWNER_DATA_SOURCE.getConnection()) {
            return connection.getMetaData().getURL();
        } catch (Exception exception) {
            throw new IllegalStateException(exception);
        }
    }

    private static String jwtIssuerUri() {
        String configured = System.getProperty("uat.jwt.issuer-uri");
        if (configured == null || configured.isBlank()) {
            configured = System.getenv("UAT_JWT_ISSUER_URI");
        }
        if (configured == null || configured.isBlank()) {
            throw new IllegalStateException(
                    "Signed-JWT live UAT requires -Duat.jwt.issuer-uri=http://127.0.0.1:18081"
            );
        }
        return configured;
    }

    private static String malwareScannerPath() {
        String configured = System.getProperty("uat.attachment-scan-command");
        if (configured == null || configured.isBlank()) {
            configured = System.getenv("UAT_ATTACHMENT_SCAN_COMMAND");
        }
        if (configured == null || configured.isBlank()) {
            Path defender = Path.of("C:\\Program Files\\Windows Defender\\MpCmdRun.exe");
            if (Files.isRegularFile(defender)) {
                configured = defender.toString();
            }
        }
        if (configured == null || configured.isBlank()) {
            throw new IllegalStateException(
                    "Live UAT requires a real attachment malware scanner command via "
                            + "-Duat.attachment-scan-command or UAT_ATTACHMENT_SCAN_COMMAND"
            );
        }
        return configured;
    }

    private static String malwareScannerArguments() {
        String configured = System.getProperty("uat.attachment-scan-arguments");
        if (configured == null || configured.isBlank()) {
            configured = System.getenv("UAT_ATTACHMENT_SCAN_ARGUMENTS");
        }
        return configured == null ? "" : configured;
    }

    /**
     * Spring invokes afterTestClass listeners in reverse order. Ordering this listener
     * immediately below DirtiesContextTestExecutionListener makes AFTER_CLASS context
     * shutdown finish before PostgreSQL and the marker files are released.
     */
    public static final class InfrastructureShutdownListener extends AbstractTestExecutionListener {
        static final int ORDER = DirtiesContextTestExecutionListener.ORDER - 1;

        @Override
        public int getOrder() {
            return ORDER;
        }

        @Override
        public void afterTestClass(TestContext testContext) throws Exception {
            UatResourceCloser.closeInOrder(
                    POSTGRES,
                    () -> {
                        Files.deleteIfExists(READY_FILE);
                        Files.deleteIfExists(STOP_FILE);
                    }
            );
        }
    }
}

/** Closes test infrastructure in dependency order without leaking later resources after an earlier failure. */
final class UatResourceCloser {
    private UatResourceCloser() {
    }

    static void closeInOrder(AutoCloseable... resources) throws Exception {
        Throwable failure = null;
        for (AutoCloseable resource : resources) {
            if (resource == null) {
                continue;
            }
            try {
                resource.close();
            } catch (Throwable closeFailure) {
                if (failure == null) {
                    failure = closeFailure;
                } else {
                    failure.addSuppressed(closeFailure);
                }
            }
        }

        if (failure instanceof Exception exception) {
            throw exception;
        }
        if (failure instanceof Error error) {
            throw error;
        }
        if (failure != null) {
            throw new IllegalStateException(failure);
        }
    }
}
