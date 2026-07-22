package cn.sifangguan.hotelaios;

import cn.sifangguan.hotelaios.dailyoperations.OperationExportProcessor;
import cn.sifangguan.hotelaios.workdata.AttachmentService;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import io.zonky.test.db.postgres.embedded.EmbeddedPostgres;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.ApplicationContext;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.dao.DataAccessException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.annotation.DirtiesContext;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;

import javax.sql.DataSource;
import java.io.File;
import java.lang.reflect.InvocationTargetException;
import java.lang.reflect.Method;
import java.sql.Connection;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.LocalDate;
import java.util.Comparator;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest
@AutoConfigureMockMvc
@DirtiesContext(classMode = DirtiesContext.ClassMode.AFTER_CLASS)
class OperationIntelligenceIntegrationTest {
    private static final String TENANT = "10000000-0000-0000-0000-000000000001";
    private static final String CEO = "19000000-0000-0000-0000-000000000001";
    private static final String GENERAL_MANAGER = "19000000-0000-0000-0000-000000000002";
    private static final String FRONT_DESK = "19000000-0000-0000-0000-000000000003";
    private static final String FRONT_SUPERVISOR = "19000000-0000-0000-0000-000000000005";
    private static final String HOTEL = "12000000-0000-0000-0000-000000000003";
    private static final String FRONT_DEPARTMENT = "12000000-0000-0000-0000-000000000005";
    private static final String GENERAL_MANAGER_ASSIGNMENT = "19200000-0000-0000-0000-000000000001";
    private static final String FRONT_DESK_ASSIGNMENT = "19200000-0000-0000-0000-000000000002";

    private static final EmbeddedPostgres POSTGRES = startPostgres();
    private static final DataSource DATA_SOURCE = POSTGRES.getPostgresDatabase();
    private static final String JDBC_URL = jdbcUrl(DATA_SOURCE);
    private static final Path EXPORT_ROOT = createExportRoot();

    @Autowired
    private MockMvc mockMvc;
    @Autowired
    private ObjectMapper objectMapper;
    @Autowired
    private JdbcTemplate jdbc;
    @Autowired
    private OperationExportProcessor operationExportProcessor;
    @Autowired
    private AttachmentService attachmentService;
    @Autowired
    private ApplicationContext applicationContext;

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
        registry.add("app.attachments.root", EXPORT_ROOT::toString);
        registry.add("app.operation-export.max-single-text-bytes", () -> 256);
        registry.add("app.operation-export.max-variable-text-bytes", () -> 4096);
    }

    @Test
    void governsSnapshotsDerivedActionsAiDecisionsAndSensitiveExports() throws Exception {
        LocalDate businessDate = LocalDate.of(2042, 4, 8);

        String createKey = "snapshot-create-" + UUID.randomUUID();
        String createBody = """
                {
                  "orgUnitId":"%s",
                  "businessDate":"%s",
                  "actorAssignmentId":"%s"
                }
                """.formatted(HOTEL, businessDate, GENERAL_MANAGER_ASSIGNMENT);
        JsonNode created = json(postJson(
                "/api/v1/daily-operation-snapshots", GENERAL_MANAGER, createKey, createBody, 201));
        JsonNode replayed = json(postJson(
                "/api/v1/daily-operation-snapshots", GENERAL_MANAGER, createKey, createBody, 201));

        String snapshotId = created.path("id").asText();
        assertThat(replayed.path("id").asText()).isEqualTo(snapshotId);
        assertThat(created.path("status").asText()).isEqualTo("GENERATED");
        assertThat(created.path("versionNo").asInt()).isEqualTo(1);
        assertThat(created.path("rowVersion").asLong()).isEqualTo(1);
        assertThat(singleString("""
                select run.status from business_day_run run
                join daily_operation_snapshot snapshot
                  on snapshot.tenant_id = run.tenant_id and snapshot.business_day_run_id = run.id
                where snapshot.tenant_id = ?::uuid and snapshot.id = ?::uuid
                """, TENANT, snapshotId)).isEqualTo("CLOSED");
        assertThat(count("""
                select count(*) from daily_operation_snapshot
                where tenant_id = ?::uuid and hotel_org_unit_id = ?::uuid and business_date = ?
                """, TENANT, HOTEL, businessDate)).isEqualTo(1);

        verifyFailedSnapshotRetryCreatesANewImmutableVersion(businessDate.plusDays(1));
        verifyDerivedActionAndOverviewCountAgree(businessDate);
        verifyAiAdoptionRequiresPermissionAndDecisionIsAppendOnly(businessDate);
        verifySensitiveExportPermissionGate(businessDate);
        verifyStaleLeaseUsesUniqueAttemptAndCleansOrphan(businessDate.plusDays(2));
        verifyOversizedExportFailsClosed(businessDate.plusDays(3));
        verifyDailyOperationReadIsRequired(businessDate.plusDays(4));
    }

    private void verifyFailedSnapshotRetryCreatesANewImmutableVersion(LocalDate businessDate) throws Exception {
        String runId = UUID.randomUUID().toString();
        String failedSnapshotId = UUID.randomUUID().toString();
        jdbc.update("""
                insert into business_day_run
                    (id, tenant_id, hotel_org_unit_id, business_date, timezone,
                     cutoff_local_time, status, failed_at, failure_reason,
                     triggered_by_account_id, trace_id, row_version)
                values (?::uuid, ?::uuid, ?::uuid, ?, 'Asia/Shanghai',
                        cast('04:00' as time), 'FAILED', now(), 'simulated failure',
                        ?::uuid, ?::uuid, 2)
                """, runId, TENANT, HOTEL, businessDate, GENERAL_MANAGER, UUID.randomUUID().toString());
        jdbc.update("""
                insert into daily_operation_snapshot
                    (id, tenant_id, business_day_run_id, hotel_org_unit_id, business_date,
                     version_no, status, data_cutoff_at, completeness_status,
                     payload_snapshot, failure_reason, trace_id, row_version)
                values (?::uuid, ?::uuid, ?::uuid, ?::uuid, ?,
                        1, 'FAILED', now(), 'UNAVAILABLE', '{}'::jsonb,
                        'simulated failure', ?::uuid, 7)
                """, failedSnapshotId, TENANT, runId, HOTEL, businessDate, UUID.randomUUID().toString());

        JsonNode retried = json(postJson(
                "/api/v1/daily-operation-snapshots/" + failedSnapshotId + "/retry",
                GENERAL_MANAGER,
                "snapshot-retry-" + UUID.randomUUID(),
                """
                        {"expectedVersion":7}
                        """,
                200));

        assertThat(retried.path("id").asText()).isNotEqualTo(failedSnapshotId);
        assertThat(retried.path("status").asText()).isEqualTo("GENERATED");
        assertThat(retried.path("versionNo").asInt()).isEqualTo(2);
        assertThat(retried.path("rowVersion").asLong()).isEqualTo(1);
        assertThat(singleString("""
                select status from daily_operation_snapshot
                where tenant_id = ?::uuid and id = ?::uuid
                """, TENANT, failedSnapshotId)).isEqualTo("FAILED");
        assertThat(singleLong("""
                select row_version from daily_operation_snapshot
                where tenant_id = ?::uuid and id = ?::uuid
                """, TENANT, failedSnapshotId)).isEqualTo(7);
        assertThat(count("""
                select count(*) from daily_operation_snapshot
                where tenant_id = ?::uuid and business_day_run_id = ?::uuid
                """, TENANT, runId)).isEqualTo(2);
        assertThat(singleString("""
                select status from business_day_run
                where tenant_id = ?::uuid and id = ?::uuid
                """, TENANT, runId)).isEqualTo("CLOSED");
    }

    private void verifyDerivedActionAndOverviewCountAgree(LocalDate businessDate) throws Exception {
        String issueId = UUID.randomUUID().toString();
        jdbc.update("""
                insert into issue_event
                    (id, tenant_id, issue_no, hotel_org_unit_id, org_unit_id, business_date,
                     title, description, severity, lifecycle_status,
                     owner_assignment_id, acceptance_assignment_id,
                     created_by_account_id, created_by_assignment_id,
                     first_occurred_at, last_occurred_at, due_at, trace_id)
                values (?::uuid, ?::uuid, ?, ?::uuid, ?::uuid, ?,
                        'Derived action integration test', 'No action_item projection is inserted',
                        'IMPORTANT', 'CANDIDATE', ?::uuid, ?::uuid,
                        ?::uuid, ?::uuid, now(), now(), now() + interval '1 day', ?::uuid)
                """, issueId, TENANT, "OP-IT-" + UUID.randomUUID(), HOTEL, FRONT_DEPARTMENT,
                businessDate, GENERAL_MANAGER_ASSIGNMENT, GENERAL_MANAGER_ASSIGNMENT,
                FRONT_SUPERVISOR, GENERAL_MANAGER_ASSIGNMENT, UUID.randomUUID().toString());
        assertThat(count("""
                select count(*) from action_item
                where tenant_id = ?::uuid and source_type = 'ISSUE' and source_id = ?::uuid
                """, TENANT, issueId)).isZero();

        JsonNode actions = json(getJson(
                "/api/v1/daily-operations/action-items?orgUnitId=" + HOTEL
                        + "&businessDate=" + businessDate,
                GENERAL_MANAGER,
                200));
        assertThat(actions.isArray()).isTrue();
        assertThat(actions.size()).isPositive();
        assertThat(actions.findValuesAsText("sourceId")).contains(issueId);
        assertThat(actions.findValuesAsText("actionType")).contains("ISSUE_CONFIRMATION");

        JsonNode overview = json(getJson(
                "/api/v1/daily-operations?orgUnitId=" + HOTEL
                        + "&businessDate=" + businessDate + "&mode=REALTIME",
                GENERAL_MANAGER,
                200));
        assertThat(overview.path("actionItemCount").asLong()).isEqualTo(actions.size());
    }

    private void verifyAiAdoptionRequiresPermissionAndDecisionIsAppendOnly(LocalDate businessDate) throws Exception {
        String requestId = UUID.randomUUID().toString();
        String recommendationId = UUID.randomUUID().toString();
        jdbc.update("""
                insert into ai_request
                    (id, tenant_id, request_type, status, hotel_org_unit_id, org_unit_id,
                     business_date, provider_code, model_name, model_version,
                     prompt_version, context_version, input_hash, input_snapshot,
                     requested_by_account_id, requested_by_assignment_id,
                     trace_id, correlation_id, completed_at)
                values (?::uuid, ?::uuid, 'ISSUE_ANALYSIS', 'SUCCEEDED', ?::uuid, ?::uuid,
                        ?, 'integration-test', 'test-model', '1', 'p1', 'c1',
                        repeat('a', 64), '{}'::jsonb, ?::uuid, ?::uuid,
                        ?::uuid, ?::uuid, now())
                """, requestId, TENANT, HOTEL, FRONT_DEPARTMENT, businessDate,
                FRONT_DESK, FRONT_DESK_ASSIGNMENT,
                UUID.randomUUID().toString(), UUID.randomUUID().toString());
        jdbc.update("""
                insert into ai_recommendation
                    (id, tenant_id, ai_request_id, recommendation_no, recommendation_type,
                     fact_summary, analysis, recommendation, applicability_scope,
                     model_name, model_version, prompt_version, context_version)
                values (?::uuid, ?::uuid, ?::uuid, 1, 'ISSUE_ACTION',
                        '{}'::jsonb, 'integration analysis', 'human should decide', '{}'::jsonb,
                        'test-model', '1', 'p1', 'c1')
                """, recommendationId, TENANT, requestId);

        String decisionBody = """
                {
                  "decision":"ACCEPTED",
                  "note":"human confirmation",
                  "actorAssignmentId":"%s"
                }
                """.formatted(FRONT_DESK_ASSIGNMENT);
        postJson(
                "/api/v1/ai/recommendations/" + recommendationId + "/decisions",
                FRONT_DESK,
                "ai-adopt-denied-" + UUID.randomUUID(),
                decisionBody,
                403);
        assertThat(count("""
                select count(*) from ai_decision
                where tenant_id = ?::uuid and recommendation_id = ?::uuid
                """, TENANT, recommendationId)).isZero();

        JsonNode accepted = json(postJson(
                "/api/v1/ai/recommendations/" + recommendationId + "/decisions",
                GENERAL_MANAGER,
                "ai-adopt-accepted-" + UUID.randomUUID(),
                decisionBody.replace(FRONT_DESK_ASSIGNMENT, GENERAL_MANAGER_ASSIGNMENT),
                201));
        String decisionId = accepted.path("id").asText();
        assertThat(accepted.path("decision").asText()).isEqualTo("ACCEPTED");
        assertThat(singleString("""
                select decision_snapshot ->> 'formalTaskCreated' from ai_decision
                where tenant_id = ?::uuid and id = ?::uuid
                """, TENANT, decisionId)).isEqualTo("false");
        assertThat(count("""
                select count(*) from ai_decision
                where tenant_id = ?::uuid and recommendation_id = ?::uuid
                  and result_draft_type is null and result_draft_id is null
                """, TENANT, recommendationId)).isEqualTo(1);
        assertThatThrownBy(() -> jdbc.update("""
                update ai_decision set reason = 'mutation must fail'
                where tenant_id = ?::uuid and id = ?::uuid
                """, TENANT, decisionId)).isInstanceOf(DataAccessException.class);
    }

    private void verifySensitiveExportPermissionGate(LocalDate businessDate) throws Exception {
        String sensitiveBody = """
                {
                  "exportType":"CSV_DETAIL",
                  "businessDate":"%s",
                  "orgUnitId":"%s",
                  "includeSensitive":true,
                  "actorAssignmentId":"%s"
                }
                """.formatted(businessDate, HOTEL, GENERAL_MANAGER_ASSIGNMENT);
        postJson(
                "/api/v1/daily-operations/exports",
                GENERAL_MANAGER,
                "sensitive-export-denied-" + UUID.randomUUID(),
                sensitiveBody,
                403);

        JsonNode ordinary = json(postJson(
                "/api/v1/daily-operations/exports",
                GENERAL_MANAGER,
                "ordinary-export-" + UUID.randomUUID(),
                sensitiveBody.replace("\"includeSensitive\":true", "\"includeSensitive\":false"),
                201));
        assertThat(ordinary.path("status").asText()).isEqualTo("PENDING");
        assertThat(ordinary.path("sensitiveIncluded").asBoolean()).isFalse();
        String ordinaryId = ordinary.path("id").asText();

        OperationExportProcessor.ProcessingResult ordinaryProcessing = operationExportProcessor.processTenant(
                UUID.fromString(TENANT), 1, UUID.randomUUID());
        assertThat(ordinaryProcessing.processed()).isEqualTo(1);
        assertThat(ordinaryProcessing.succeeded()).isEqualTo(1);
        assertThat(ordinaryProcessing.failed()).isZero();
        assertThat(singleString("""
                select status from operation_export_job
                where tenant_id = ?::uuid and id = ?::uuid
                """, TENANT, ordinaryId)).isEqualTo("SUCCEEDED");
        assertThat(singleLong("""
                select size_bytes from operation_export_job
                where tenant_id = ?::uuid and id = ?::uuid
                """, TENANT, ordinaryId)).isPositive();

        MvcResult csvDownload = getBinary(
                "/api/v1/daily-operations/exports/" + ordinaryId + "/download",
                GENERAL_MANAGER, 200);
        byte[] csv = csvDownload.getResponse().getContentAsByteArray();
        assertThat(csv).isNotEmpty();
        assertThat(new String(csv, StandardCharsets.UTF_8)).contains("Record Type");
        assertThat(csvDownload.getResponse().getHeader("Content-Disposition")).contains("attachment");
        assertThat(csvDownload.getResponse().getHeader("Cache-Control")).contains("no-store");

        String expiredObjectKey = singleString("""
                select object_key from operation_export_job
                where tenant_id = ?::uuid and id = ?::uuid
                """, TENANT, ordinaryId);
        Path expiredPath = exportPath(expiredObjectKey);
        assertThat(expiredPath).exists();
        jdbc.update("""
                update operation_export_job
                set completed_at = now() - interval '2 hours',
                    expires_at = now() - interval '1 hour'
                where tenant_id = ?::uuid and id = ?::uuid
                """, TENANT, ordinaryId);
        getBinary(
                "/api/v1/daily-operations/exports/" + ordinaryId + "/download",
                GENERAL_MANAGER, 410);
        assertThat(singleString("""
                select status from operation_export_job
                where tenant_id = ?::uuid and id = ?::uuid
                """, TENANT, ordinaryId)).isEqualTo("EXPIRED");
        assertThat(count("""
                select count(*) from operation_export_job
                where tenant_id = ?::uuid and id = ?::uuid
                  and object_key is null and file_name is null and sha256 is null and size_bytes is null
                """, TENANT, ordinaryId)).isEqualTo(1);
        assertThat(expiredPath).doesNotExist();
        getBinary(
                "/api/v1/daily-operations/exports/" + ordinaryId + "/download",
                GENERAL_MANAGER, 410);
        JsonNode exportsAfterExpiry = json(getJson(
                "/api/v1/daily-operations/exports", GENERAL_MANAGER, 200));
        JsonNode expiredListItem = null;
        for (JsonNode item : exportsAfterExpiry) {
            if (ordinaryId.equals(item.path("id").asText())) {
                expiredListItem = item;
                break;
            }
        }
        assertThat(expiredListItem).isNotNull();
        assertThat(expiredListItem.hasNonNull("downloadUrl")).isFalse();

        JsonNode privileged = json(postJson(
                "/api/v1/daily-operations/exports",
                CEO,
                "sensitive-export-allowed-" + UUID.randomUUID(),
                """
                        {
                          "exportType":"CSV_DETAIL",
                          "businessDate":"%s",
                          "orgUnitId":"%s",
                          "includeSensitive":true
                        }
                        """.formatted(businessDate, HOTEL),
                201));
        assertThat(privileged.path("status").asText()).isEqualTo("PENDING");
        assertThat(privileged.path("sensitiveIncluded").asBoolean()).isTrue();

        JsonNode xlsx = createOrdinaryExport(businessDate, "EXCEL_DETAIL");
        JsonNode pdf = createOrdinaryExport(businessDate, "PDF_SUMMARY");
        OperationExportProcessor.ProcessingResult binaryProcessing = operationExportProcessor.processTenant(
                UUID.fromString(TENANT), 10, UUID.randomUUID());
        assertThat(binaryProcessing.processed()).isEqualTo(3);
        assertThat(binaryProcessing.failed()).isZero();

        byte[] xlsxBytes = getBinary(
                "/api/v1/daily-operations/exports/" + xlsx.path("id").asText() + "/download",
                GENERAL_MANAGER, 200).getResponse().getContentAsByteArray();
        assertThat(xlsxBytes).startsWith((byte) 0x50, (byte) 0x4b);
        byte[] pdfBytes = getBinary(
                "/api/v1/daily-operations/exports/" + pdf.path("id").asText() + "/download",
                GENERAL_MANAGER, 200).getResponse().getContentAsByteArray();
        assertThat(new String(pdfBytes, 0, Math.min(pdfBytes.length, 8), StandardCharsets.US_ASCII))
                .startsWith("%PDF-");

        String xlsxObjectKey = singleString("""
                select object_key from operation_export_job
                where tenant_id = ?::uuid and id = ?::uuid
                """, TENANT, xlsx.path("id").asText());
        Path xlsxPath = exportPath(xlsxObjectKey);
        byte[] tamperedXlsx = Files.readAllBytes(xlsxPath);
        tamperedXlsx[tamperedXlsx.length - 1] ^= 0x01;
        Files.write(xlsxPath, tamperedXlsx);
        getBinary(
                "/api/v1/daily-operations/exports/" + xlsx.path("id").asText() + "/download",
                GENERAL_MANAGER, 400);
    }

    private JsonNode createOrdinaryExport(LocalDate businessDate, String exportType) throws Exception {
        return json(postJson(
                "/api/v1/daily-operations/exports",
                GENERAL_MANAGER,
                "ordinary-export-" + exportType + "-" + UUID.randomUUID(),
                """
                        {
                          "exportType":"%s",
                          "businessDate":"%s",
                          "orgUnitId":"%s",
                          "includeSensitive":false,
                          "actorAssignmentId":"%s"
                        }
                        """.formatted(exportType, businessDate, HOTEL, GENERAL_MANAGER_ASSIGNMENT),
                201));
    }

    private void verifyStaleLeaseUsesUniqueAttemptAndCleansOrphan(LocalDate businessDate) {
        String jobId = UUID.randomUUID().toString();
        String orphanKey = TENANT + "/operation-exports/" + jobId + "/attempt-7/orphan.csv";
        attachmentService.storeGeneratedBytes(
                orphanKey, "orphan.csv", "text/csv", "stale-attempt".getBytes(StandardCharsets.UTF_8));
        assertThat(exportPath(orphanKey)).exists();
        String filters = """
                {"exportType":"CSV_DETAIL","includeSensitive":false,"crossHotel":false,
                 "orgUnitId":"%s","businessDate":"%s"}
                """.formatted(HOTEL, businessDate);
        String authorization = """
                {"tenantScope":false,"requestedByAccountId":"%s",
                 "requestedByAssignmentId":"%s","orgScopes":["%s"],
                 "permissionCodes":["daily-operation.read","operation-export.create"]}
                """.formatted(GENERAL_MANAGER, GENERAL_MANAGER_ASSIGNMENT, HOTEL);
        jdbc.update("""
                insert into operation_export_job
                    (id, tenant_id, export_format, status, hotel_org_unit_id, org_unit_id,
                     business_date, filter_snapshot, authorization_snapshot, sensitivity_level,
                     requested_by_account_id, requested_by_assignment_id, trace_id,
                     row_version, updated_at)
                values (?::uuid, ?::uuid, 'CSV', 'RUNNING', ?::uuid, ?::uuid,
                        ?, ?::jsonb, ?::jsonb, 'INTERNAL', ?::uuid, ?::uuid, ?::uuid,
                        7, now() - interval '20 minutes')
                """, jobId, TENANT, HOTEL, HOTEL, businessDate, filters, authorization,
                GENERAL_MANAGER, GENERAL_MANAGER_ASSIGNMENT, UUID.randomUUID().toString());

        OperationExportProcessor.ProcessingResult result = operationExportProcessor.processTenant(
                UUID.fromString(TENANT), 1, UUID.randomUUID());
        assertThat(result.processed()).isEqualTo(1);
        assertThat(result.succeeded()).isEqualTo(1);
        String winnerKey = singleString("""
                select object_key from operation_export_job
                where tenant_id = ?::uuid and id = ?::uuid
                """, TENANT, jobId);
        assertThat(winnerKey).contains("/attempt-8/");
        assertThat(exportPath(winnerKey)).exists();
        assertThat(exportPath(orphanKey)).doesNotExist();

        verifyLostLeaseAndCommitReconciliation(
                jobId, businessDate, filters, authorization, winnerKey);
    }

    private void verifyLostLeaseAndCommitReconciliation(
            String jobId,
            LocalDate businessDate,
            String filters,
            String authorization,
            String winnerKey
    ) {
        try {
            Object transactions = applicationContext.getBean("operationExportJobTransactions");
            Class<?> claimedType = Class.forName(
                    "cn.sifangguan.hotelaios.dailyoperations.ClaimedJob");
            var constructor = claimedType.getDeclaredConstructors()[0];
            constructor.setAccessible(true);
            Object lostLease = constructor.newInstance(
                    UUID.fromString(jobId), UUID.fromString(TENANT), "CSV",
                    UUID.fromString(HOTEL), UUID.fromString(HOTEL), businessDate,
                    filters, authorization, "INTERNAL", UUID.fromString(GENERAL_MANAGER),
                    UUID.randomUUID(), 7L);
            String loserKey = TENANT + "/operation-exports/" + jobId + "/attempt-7/late-loser.csv";
            AttachmentService.StoredObject loser = attachmentService.storeGeneratedBytes(
                    loserKey, "late-loser.csv", "text/csv",
                    "late-loser".getBytes(StandardCharsets.UTF_8));
            Method markSucceeded = transactions.getClass().getMethod(
                    "markSucceeded", claimedType, AttachmentService.StoredObject.class);
            markSucceeded.setAccessible(true);
            try {
                markSucceeded.invoke(transactions, lostLease, loser);
                throw new AssertionError("lost lease unexpectedly committed");
            } catch (InvocationTargetException exception) {
                assertThat(rootCause(exception)).hasMessageContaining("租约已失效");
            }
            Method reconcile = transactions.getClass().getMethod(
                    "reconcileCompletion", claimedType, String.class);
            reconcile.setAccessible(true);
            assertThat(reconcile.invoke(transactions, lostLease, loserKey).toString())
                    .isEqualTo("LOST_LEASE");
            attachmentService.removeStoredObject(loserKey);
            assertThat(exportPath(loserKey)).doesNotExist();
            assertThat(exportPath(winnerKey)).exists();

            Object committedLease = constructor.newInstance(
                    UUID.fromString(jobId), UUID.fromString(TENANT), "CSV",
                    UUID.fromString(HOTEL), UUID.fromString(HOTEL), businessDate,
                    filters, authorization, "INTERNAL", UUID.fromString(GENERAL_MANAGER),
                    UUID.randomUUID(), 8L);
            assertThat(reconcile.invoke(transactions, committedLease, winnerKey).toString())
                    .isEqualTo("COMMITTED_THIS_ATTEMPT");
            assertThat(exportPath(winnerKey)).exists();
        } catch (AssertionError error) {
            throw error;
        } catch (Exception exception) {
            throw new AssertionError("unable to exercise export lease transaction seam", exception);
        }
    }

    private static Throwable rootCause(Throwable throwable) {
        Throwable current = throwable;
        while (current.getCause() != null && current.getCause() != current) {
            current = current.getCause();
        }
        return current;
    }

    private void verifyOversizedExportFailsClosed(LocalDate businessDate) throws Exception {
        String issueId = UUID.randomUUID().toString();
        jdbc.update("""
                insert into issue_event
                    (id, tenant_id, issue_no, hotel_org_unit_id, org_unit_id, business_date,
                     title, description, severity, lifecycle_status,
                     owner_assignment_id, acceptance_assignment_id,
                     created_by_account_id, first_occurred_at, last_occurred_at, due_at, trace_id)
                values (?::uuid, ?::uuid, ?, ?::uuid, ?::uuid, ?,
                        'Oversized export budget test', ?, 'IMPORTANT', 'CANDIDATE',
                        ?::uuid, ?::uuid, ?::uuid, now(), now(), now() + interval '1 day', ?::uuid)
                """, issueId, TENANT, "OP-BUDGET-" + UUID.randomUUID(), HOTEL, FRONT_DEPARTMENT,
                businessDate, "x".repeat(300), GENERAL_MANAGER_ASSIGNMENT, GENERAL_MANAGER_ASSIGNMENT,
                CEO, UUID.randomUUID().toString());
        JsonNode job = json(postJson(
                "/api/v1/daily-operations/exports", CEO,
                "oversized-export-" + UUID.randomUUID(),
                """
                        {
                          "exportType":"CSV_DETAIL",
                          "businessDate":"%s",
                          "orgUnitId":"%s",
                          "includeSensitive":true
                        }
                        """.formatted(businessDate, HOTEL),
                201));
        OperationExportProcessor.ProcessingResult result = operationExportProcessor.processTenant(
                UUID.fromString(TENANT), 1, UUID.randomUUID());
        assertThat(result.failed()).isEqualTo(1);
        assertThat(count("""
                select count(*) from operation_export_job
                where tenant_id = ?::uuid and id = ?::uuid and status = 'FAILED'
                  and object_key is null and failure_reason like '%资源预算%'
                """, TENANT, job.path("id").asText())).isEqualTo(1);
    }

    private void verifyDailyOperationReadIsRequired(LocalDate businessDate) throws Exception {
        String downloadableJobId = singleString("""
                select id::text from operation_export_job
                where tenant_id = ?::uuid and requested_by_account_id = ?::uuid and status = 'SUCCEEDED'
                order by created_at desc limit 1
                """, TENANT, GENERAL_MANAGER);
        assertThat(count("""
                select count(*) from role_permission grant_item
                join permission permission_item on permission_item.id = grant_item.permission_id
                where grant_item.tenant_id = ?::uuid
                  and grant_item.role_id = '19400000-0000-0000-0000-000000000002'::uuid
                  and permission_item.code in ('operation-export.create', 'operation-export.download')
                """, TENANT)).isEqualTo(2);
        jdbc.update("""
                delete from role_permission grant_item
                using permission permission_item
                where grant_item.tenant_id = ?::uuid
                  and grant_item.role_id = '19400000-0000-0000-0000-000000000002'::uuid
                  and permission_item.id = grant_item.permission_id
                  and permission_item.code = 'daily-operation.read'
                """, TENANT);

        String body = """
                {
                  "exportType":"CSV_DETAIL",
                  "businessDate":"%s",
                  "orgUnitId":"%s",
                  "includeSensitive":false,
                  "actorAssignmentId":"%s"
                }
                """.formatted(businessDate, HOTEL, GENERAL_MANAGER_ASSIGNMENT);
        postJson(
                "/api/v1/daily-operations/exports", GENERAL_MANAGER,
                "missing-operation-read-" + UUID.randomUUID(), body, 403);
        getJson("/api/v1/daily-operations/exports", GENERAL_MANAGER, 403);
        getBinary(
                "/api/v1/daily-operations/exports/" + downloadableJobId + "/download",
                GENERAL_MANAGER, 403);
    }

    private static Path exportPath(String objectKey) {
        return EXPORT_ROOT.resolve(objectKey.replace('/', File.separatorChar)).normalize();
    }

    private MvcResult postJson(
            String path,
            String actorId,
            String idempotencyKey,
            String body,
            int expectedStatus
    ) throws Exception {
        return mockMvc.perform(post(path)
                        .header("X-Tenant-Id", TENANT)
                        .header("X-Actor-Id", actorId)
                        .header("Idempotency-Key", idempotencyKey)
                        .contentType("application/json")
                        .content(body))
                .andExpect(status().is(expectedStatus))
                .andReturn();
    }

    private MvcResult getJson(String path, String actorId, int expectedStatus) throws Exception {
        return mockMvc.perform(get(path)
                        .header("X-Tenant-Id", TENANT)
                        .header("X-Actor-Id", actorId))
                .andExpect(status().is(expectedStatus))
                .andReturn();
    }

    private MvcResult getBinary(String path, String actorId, int expectedStatus) throws Exception {
        return mockMvc.perform(get(path)
                        .header("X-Tenant-Id", TENANT)
                        .header("X-Actor-Id", actorId))
                .andExpect(status().is(expectedStatus))
                .andReturn();
    }

    private JsonNode json(MvcResult result) throws Exception {
        return objectMapper.readTree(result.getResponse().getContentAsByteArray());
    }

    private int count(String sql, Object... args) {
        Integer result = jdbc.queryForObject(sql, Integer.class, args);
        return result == null ? 0 : result;
    }

    private long singleLong(String sql, Object... args) {
        Long result = jdbc.queryForObject(sql, Long.class, args);
        return result == null ? 0 : result;
    }

    private String singleString(String sql, Object... args) {
        return jdbc.queryForObject(sql, String.class, args);
    }

    @AfterAll
    static void closePostgres() throws Exception {
        try {
            POSTGRES.close();
        } finally {
            if (Files.exists(EXPORT_ROOT)) {
                try (var paths = Files.walk(EXPORT_ROOT)) {
                    paths.sorted(Comparator.reverseOrder()).forEach(path -> {
                        try {
                            Files.deleteIfExists(path);
                        } catch (Exception ignored) {
                            // Temporary test artifacts are best-effort cleanup only.
                        }
                    });
                }
            }
        }
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

    private static Path createExportRoot() {
        try {
            return Files.createTempDirectory("hotel-ai-os-operation-exports-");
        } catch (Exception exception) {
            throw new ExceptionInInitializerError(exception);
        }
    }
}
