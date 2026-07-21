package cn.sifangguan.hotelaios.shared.events;

import io.micrometer.core.instrument.MeterRegistry;
import io.zonky.test.db.postgres.embedded.EmbeddedPostgres;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.scheduling.annotation.ScheduledAnnotationBeanPostProcessor;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.annotation.DirtiesContext;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

import javax.sql.DataSource;
import java.nio.file.Files;
import java.nio.file.Path;
import java.sql.Connection;
import java.time.Duration;
import java.time.Instant;
import java.util.UUID;
import java.util.function.BooleanSupplier;

import static org.assertj.core.api.Assertions.assertThat;

@SpringBootTest
@DirtiesContext(classMode = DirtiesContext.ClassMode.AFTER_CLASS)
class ManagementAutomationWorkerIntegrationTest {
    private static final String TENANT = "10000000-0000-0000-0000-000000000001";
    private static final String MISSED_EXPECTATION = "2a500000-0000-0000-0000-000000000005";
    private static final String RECOVERABLE_OUTBOX = "4f000000-0000-0000-0000-000000000001";
    private static final String FAILED_OUTBOX = "4f000000-0000-0000-0000-000000000002";

    private static final EmbeddedPostgres POSTGRES = startPostgres();
    private static final DataSource DATA_SOURCE = POSTGRES.getPostgresDatabase();
    private static final String JDBC_URL = jdbcUrl(DATA_SOURCE);

    @Autowired
    private JdbcTemplate jdbc;

    @Autowired
    private MeterRegistry meterRegistry;

    @Autowired
    private ScheduledAnnotationBeanPostProcessor scheduledTasks;

    @DynamicPropertySource
    static void properties(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", () -> JDBC_URL);
        registry.add("spring.datasource.username", () -> "postgres");
        registry.add("spring.datasource.password", () -> "postgres");
        registry.add("spring.flyway.user", () -> "postgres");
        registry.add("spring.flyway.password", () -> "postgres");
        registry.add("app.security.development-header-auth-enabled", () -> true);
        registry.add("app.database.rls-enabled", () -> true);
        registry.add("app.work-expectation.sla.scheduler-enabled", () -> false);
        registry.add("app.tasks.default-escalation-delay-hours", () -> 0);
        registry.add("app.automation.worker.enabled", () -> true);
        registry.add("app.automation.worker.tenant-ids", () -> TENANT);
        registry.add("app.automation.worker.batch-size", () -> 100);
        registry.add("app.automation.worker.initial-delay-ms", () -> 300);
        registry.add("app.automation.worker.fixed-delay-ms", () -> 200);
    }

    @BeforeEach
    void loadFixtureAndRecoveryCases() throws Exception {
        String fixture = Files.readString(repositoryRoot().resolve("database/uat/001_sprint2_1_uat_fixture.sql"))
                .replaceAll("(?m)^\\\\.*(?:\\R|$)", "");
        try (Connection connection = DATA_SOURCE.getConnection(); var statement = connection.createStatement()) {
            statement.execute(fixture);
        }
        jdbc.update("""
                insert into outbox_event
                    (id, tenant_id, aggregate_type, aggregate_id, event_type, payload,
                     schema_version, status, available_at, locked_by, locked_until)
                values
                    (?::uuid, ?::uuid, 'WORK_RECORD', ?::uuid, 'WORKRECORDSUBMITTED',
                     '{"workRecordId":"2e000000-0000-0000-0000-000000000001","orgUnitId":"12000000-0000-0000-0000-000000000006","positionAssignmentId":"19200000-0000-0000-0000-000000000003"}'::jsonb,
                     1, 'PROCESSING', now() - interval '1 minute', 'abandoned-worker', now() - interval '1 minute')
                """, RECOVERABLE_OUTBOX, TENANT, UUID.randomUUID());
        jdbc.update("""
                insert into outbox_event
                    (id, tenant_id, aggregate_type, aggregate_id, event_type, payload,
                     schema_version, status, available_at, locked_by, locked_until)
                values
                    (?::uuid, ?::uuid, 'BROKEN', ?::uuid, 'WORKRECORDSUBMITTED',
                     '{"orgUnitId":"not-a-uuid"}'::jsonb, 1, 'PROCESSING', now() - interval '1 minute',
                     'abandoned-worker', now() - interval '1 minute')
                """, FAILED_OUTBOX, TENANT, UUID.randomUUID());
    }

    @Test
    void scheduledWorkerClosesMissedWorkLoopAndRecoversExpiredLeasesWithoutManualApi() throws Exception {
        await(Duration.ofSeconds(30), () -> "MISSED".equals(value(
                "select status from work_expectation where id = ?::uuid", MISSED_EXPECTATION)));
        await(Duration.ofSeconds(30), () -> count("""
                select count(*) from notification
                where tenant_id = ?::uuid and notification_type = 'MISSED_WORK_REMINDER'
                """, TENANT) > 0);
        await(Duration.ofSeconds(30), () -> count("""
                select count(*) from management_task
                where tenant_id = ?::uuid and source_snapshot::text like ?
                """, TENANT, "%" + MISSED_EXPECTATION + "%") > 0);
        await(Duration.ofSeconds(30), () -> count("""
                select count(*) from task_transition tr
                join management_task t on t.tenant_id = tr.tenant_id and t.id = tr.task_id
                where t.tenant_id = ?::uuid and t.source_snapshot::text like ?
                  and tr.command in ('MARK_OVERDUE', 'ESCALATE')
                """, TENANT, "%" + MISSED_EXPECTATION + "%") >= 2);

        await(Duration.ofSeconds(30), () -> "PUBLISHED".equals(value(
                "select status from outbox_event where id = ?::uuid", RECOVERABLE_OUTBOX)));
        assertThat(count("""
                select count(*) from management_event
                where tenant_id = ?::uuid and source_event_id = ?::uuid and processing_status = 'PROCESSED'
                """, TENANT, RECOVERABLE_OUTBOX)).isEqualTo(1);

        await(Duration.ofSeconds(30), () -> "FAILED".equals(value(
                "select status from outbox_event where id = ?::uuid", FAILED_OUTBOX)));
        assertThat(count("""
                select count(*) from outbox_event
                where id = ?::uuid and last_error is not null and available_at > now()
                """, FAILED_OUTBOX)).isEqualTo(1);

        assertThat(meterRegistry.get(AutomationWorkerMetrics.RUNS)
                .tag("pipeline", "work_expectation_sla").tag("outcome", "success")
                .counter().count()).isGreaterThan(0);
        assertThat(meterRegistry.get(AutomationWorkerMetrics.ALERTS)
                .tag("pipeline", "event_recovery").tag("code", "RETRY_SCHEDULED")
                .counter().count()).isGreaterThan(0);
    }

    @AfterEach
    void stopScheduledWorkerBeforeDatabaseShutdown() {
        // Spring's after-test-class callback runs after JUnit's @AfterAll. Stop the scheduler here so
        // the worker cannot retain a transaction while the embedded PostgreSQL process is closing.
        scheduledTasks.destroy();
    }

    private void await(Duration timeout, BooleanSupplier condition) throws Exception {
        Instant deadline = Instant.now().plus(timeout);
        while (Instant.now().isBefore(deadline)) {
            if (condition.getAsBoolean()) {
                return;
            }
            Thread.sleep(100);
        }
        throw new AssertionError("Timed out waiting for the scheduled automation worker");
    }

    private String value(String sql, Object... args) {
        return jdbc.queryForObject(sql, String.class, args);
    }

    private int count(String sql, Object... args) {
        Integer value = jdbc.queryForObject(sql, Integer.class, args);
        return value == null ? 0 : value;
    }

    @AfterAll
    static void closePostgres() throws Exception {
        POSTGRES.close();
    }

    private static Path repositoryRoot() {
        return Path.of("..").toAbsolutePath().normalize().getParent();
    }

    private static EmbeddedPostgres startPostgres() {
        try {
            return EmbeddedPostgres.builder().start();
        } catch (Exception exception) {
            throw new ExceptionInInitializerError(exception);
        }
    }

    private static String jdbcUrl(DataSource dataSource) {
        try (Connection connection = dataSource.getConnection()) {
            return connection.getMetaData().getURL();
        } catch (Exception exception) {
            throw new ExceptionInInitializerError(exception);
        }
    }
}
