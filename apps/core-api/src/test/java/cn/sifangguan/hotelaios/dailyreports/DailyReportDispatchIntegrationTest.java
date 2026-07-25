package cn.sifangguan.hotelaios.dailyreports;

import io.zonky.test.db.postgres.embedded.EmbeddedPostgres;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.annotation.DirtiesContext;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

import javax.sql.DataSource;
import java.sql.Connection;
import java.time.Instant;
import java.time.LocalDate;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

@SpringBootTest
@DirtiesContext(classMode = DirtiesContext.ClassMode.AFTER_CLASS)
class DailyReportDispatchIntegrationTest {
    private static final UUID TENANT =
            UUID.fromString("10000000-0000-0000-0000-000000000001");
    private static final LocalDate BUSINESS_DATE = LocalDate.of(2026, 7, 23);
    private static final Instant OPEN_SCAN = Instant.parse("2026-07-23T14:00:00Z");
    private static final Instant DUE_SOON_SCAN = Instant.parse("2026-07-23T14:30:00Z");
    private static final Instant DEADLINE_SCAN = Instant.parse("2026-07-23T15:30:00Z");
    private static final UUID GENERAL_MANAGER_ASSIGNMENT =
            UUID.fromString("19200000-0000-0000-0000-000000000001");
    private static final UUID FRONT_DESK_ASSIGNMENT =
            UUID.fromString("19200000-0000-0000-0000-000000000002");
    private static final UUID GENERAL_MANAGER_TEMPLATE_VERSION =
            UUID.fromString("43100000-0000-0000-0000-000000000004");

    private static final EmbeddedPostgres POSTGRES = startPostgres();
    private static final DataSource DATA_SOURCE = POSTGRES.getPostgresDatabase();
    private static final String JDBC_URL = jdbcUrl(DATA_SOURCE);

    @Autowired
    private DailyReportDispatchService service;

    @Autowired
    private JdbcTemplate jdbc;

    @DynamicPropertySource
    static void properties(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", () -> JDBC_URL);
        registry.add("spring.datasource.username", () -> "postgres");
        registry.add("spring.datasource.password", () -> "postgres");
        registry.add("spring.flyway.user", () -> "postgres");
        registry.add("spring.flyway.password", () -> "postgres");
        registry.add("app.security.development-header-auth-enabled", () -> true);
        registry.add("app.database.rls-enabled", () -> true);
        registry.add("app.automation.worker.enabled", () -> false);
        registry.add("app.work-expectation.sla.scheduler-enabled", () -> false);
    }

    @Test
    void materializesFiveHotelRolesOnceAndUsesFrozenPolicyForEligibleDraftReports() {
        DailyReportDispatchService.ProcessResult first = service.processTenantAsSystem(
                TENANT, 100, UUID.randomUUID(), OPEN_SCAN);

        assertThat(first.createdReports()).isEqualTo(6);
        assertThat(first.openedEvents()).isEqualTo(6);
        assertThat(first.dueSoonEvents()).isZero();
        assertThat(first.overdueEvents()).isZero();
        assertThat(count("""
                select count(*) from daily_report
                where tenant_id = ? and business_date = ?
                """, TENANT, BUSINESS_DATE)).isEqualTo(6);
        assertHotelRoleCoverage();
        assertThat(count("""
                select count(*)
                from daily_report report
                join daily_report_revision revision
                  on revision.tenant_id = report.tenant_id
                 and revision.id = report.current_revision_id
                where report.tenant_id = ? and report.business_date = ?
                  and report.report_status = 'DRAFT'
                  and revision.revision_type = 'ORIGINAL'
                  and revision.revision_status = 'DRAFT'
                  and jsonb_exists(revision.payload_snapshot, 'deliveryPolicy')
                """, TENANT, BUSINESS_DATE)).isEqualTo(6);
        assertThat(count("""
                select count(*)
                from daily_report report
                join daily_report_revision revision
                  on revision.tenant_id = report.tenant_id
                 and revision.id = report.current_revision_id
                where report.tenant_id = ? and report.business_date = ?
                  and revision.payload_snapshot -> 'deliveryPolicy'
                        -> 'preDueReminderMinutes' = '[30]'::jsonb
                  and revision.payload_snapshot -> 'deliveryPolicy'
                        -> 'overdueReminderMinutes' = '[0, 30]'::jsonb
                """, TENANT, BUSINESS_DATE)).isEqualTo(6);
        assertThat(count("""
                select count(*) from notification notification
                join daily_report report
                  on report.tenant_id = notification.tenant_id
                 and report.id = notification.source_id
                where notification.tenant_id = ?
                  and notification.notification_type = 'DAILY_REPORT_READY'
                  and notification.source_type = 'DAILY_REPORT'
                  and report.business_date = ?
                """, TENANT, BUSINESS_DATE)).isEqualTo(6);
        assertThat(count("""
                select count(*) from outbox_event
                where tenant_id = ? and business_date = ?
                  and event_type = 'DAILY_REPORT_OPENED'
                """, TENANT, BUSINESS_DATE)).isEqualTo(6);

        DailyReportDispatchService.ProcessResult replay = service.processTenantAsSystem(
                TENANT, 100, UUID.randomUUID(), OPEN_SCAN);
        assertThat(replay.createdReports()).isZero();
        assertThat(replay.openedEvents()).isZero();
        assertThat(replay.dueSoonEvents()).isZero();
        assertThat(replay.overdueEvents()).isZero();
        assertThat(count("""
                select count(*) from daily_report
                where tenant_id = ? and business_date = ?
                """, TENANT, BUSINESS_DATE)).isEqualTo(6);

        UUID submittedReportId = reportIdForAssignment(GENERAL_MANAGER_ASSIGNMENT);
        UUID mismatchedReportId = reportIdForAssignment(FRONT_DESK_ASSIGNMENT);
        assertThat(jdbc.update("""
                update daily_report
                set report_status = 'SUBMITTED', submitted_at = now(),
                    row_version = row_version + 1
                where tenant_id = ? and id = ?
                """, TENANT, submittedReportId)).isEqualTo(1);
        assertThat(jdbc.update("""
                update daily_report
                set template_version_id = ?, row_version = row_version + 1
                where tenant_id = ? and id = ?
                """, GENERAL_MANAGER_TEMPLATE_VERSION, TENANT, mismatchedReportId)).isEqualTo(1);
        jdbc.update("""
                update daily_report_delivery_policy
                set pre_due_reminder_minutes = array[5]::integer[],
                    overdue_reminder_minutes = array[10]::integer[],
                    updated_by = created_by,
                    row_version = row_version + 1
                where tenant_id = ?
                """, TENANT);

        DailyReportDispatchService.ProcessResult dueSoon = service.processTenantAsSystem(
                TENANT, 100, UUID.randomUUID(), DUE_SOON_SCAN);
        assertThat(dueSoon.createdReports()).isZero();
        assertThat(dueSoon.dueSoonEvents()).isEqualTo(4);
        assertThat(count("""
                select count(*) from outbox_event
                where tenant_id = ? and business_date = ?
                  and event_type = 'DAILY_REPORT_DUE_SOON'
                """, TENANT, BUSINESS_DATE)).isEqualTo(4);
        assertNoReminderEvents(submittedReportId);
        assertNoReminderEvents(mismatchedReportId);

        DailyReportDispatchService.ProcessResult dueSoonReplay = service.processTenantAsSystem(
                TENANT, 100, UUID.randomUUID(), DUE_SOON_SCAN);
        assertThat(dueSoonReplay.dueSoonEvents()).isZero();

        DailyReportDispatchService.ProcessResult overdue = service.processTenantAsSystem(
                TENANT, 100, UUID.randomUUID(), DEADLINE_SCAN);
        assertThat(overdue.createdReports()).isZero();
        assertThat(overdue.overdueEvents()).isEqualTo(4);
        assertThat(count("""
                select count(*) from outbox_event
                where tenant_id = ? and business_date = ?
                  and event_type = 'DAILY_REPORT_OVERDUE'
                """, TENANT, BUSINESS_DATE)).isEqualTo(4);
        assertNoReminderEvents(submittedReportId);
        assertNoReminderEvents(mismatchedReportId);

        DailyReportDispatchService.ProcessResult frozenReplay = service.processTenantAsSystem(
                TENANT, 100, UUID.randomUUID(), Instant.parse("2026-07-23T15:40:00Z"));
        assertThat(frozenReplay.dueSoonEvents()).isZero();
        assertThat(frozenReplay.overdueEvents()).isZero();
        assertThat(count("""
                select count(*) from outbox_event
                where tenant_id = ? and idempotency_key like 'daily-report:overdue:%:10'
                """, TENANT)).isZero();
    }

    private void assertHotelRoleCoverage() {
        assertThat(count("""
                select count(distinct position.code)
                from daily_report report
                join employee_position_assignment assignment
                  on assignment.tenant_id = report.tenant_id
                 and assignment.id = report.position_assignment_id
                join position_definition position
                  on position.tenant_id = assignment.tenant_id
                 and position.id = assignment.position_id
                where report.tenant_id = ? and report.business_date = ?
                """, TENANT, BUSINESS_DATE)).isEqualTo(5);
        assertPositionReportCount("FRONT_DESK", 2);
        assertPositionReportCount("FRONT_OFFICE_SUPERVISOR", 1);
        assertPositionReportCount("HOUSEKEEPING_SUPERVISOR", 1);
        assertPositionReportCount("ASSISTANT_GENERAL_MANAGER", 1);
        assertPositionReportCount("GENERAL_MANAGER", 1);
        assertThat(count("""
                select count(*)
                from daily_report report
                join employee_position_assignment assignment
                  on assignment.tenant_id = report.tenant_id
                 and assignment.id = report.position_assignment_id
                join position_definition position
                  on position.tenant_id = assignment.tenant_id
                 and position.id = assignment.position_id
                where report.tenant_id = ? and report.business_date = ?
                  and position.code in ('OTA_OPERATION_ASSISTANT', 'OTA_OPERATION_MANAGER')
                """, TENANT, BUSINESS_DATE)).isZero();
        assertThat(count("""
                select count(*)
                from daily_report report
                join employee
                  on employee.tenant_id = report.tenant_id
                 and employee.id = report.employee_id
                join user_account account
                  on account.tenant_id = employee.tenant_id
                 and account.id = employee.account_id
                where report.tenant_id = ? and report.business_date = ?
                  and account.login_name = 'ceo.demo'
                """, TENANT, BUSINESS_DATE)).isZero();
    }

    private void assertPositionReportCount(String positionCode, int expected) {
        assertThat(count("""
                select count(*)
                from daily_report report
                join employee_position_assignment assignment
                  on assignment.tenant_id = report.tenant_id
                 and assignment.id = report.position_assignment_id
                join position_definition position
                  on position.tenant_id = assignment.tenant_id
                 and position.id = assignment.position_id
                where report.tenant_id = ? and report.business_date = ?
                  and position.code = ?
                """, TENANT, BUSINESS_DATE, positionCode)).isEqualTo(expected);
    }

    private UUID reportIdForAssignment(UUID assignmentId) {
        return jdbc.queryForObject("""
                select id from daily_report
                where tenant_id = ? and business_date = ?
                  and position_assignment_id = ?
                """, UUID.class, TENANT, BUSINESS_DATE, assignmentId);
    }

    private void assertNoReminderEvents(UUID reportId) {
        assertThat(count("""
                select count(*) from outbox_event
                where tenant_id = ? and aggregate_id = ?
                  and event_type in ('DAILY_REPORT_DUE_SOON', 'DAILY_REPORT_OVERDUE')
                """, TENANT, reportId)).isZero();
    }

    private int count(String sql, Object... args) {
        Integer value = jdbc.queryForObject(sql, Integer.class, args);
        return value == null ? 0 : value;
    }

    @AfterAll
    static void closePostgres() throws Exception {
        POSTGRES.close();
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
