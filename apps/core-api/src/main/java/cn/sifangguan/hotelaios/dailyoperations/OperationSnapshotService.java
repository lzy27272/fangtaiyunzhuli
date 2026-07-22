package cn.sifangguan.hotelaios.dailyoperations;

import cn.sifangguan.hotelaios.dailyoperations.OperationIntelligenceModels.DailyOperationOverview;
import cn.sifangguan.hotelaios.dailyoperations.OperationIntelligenceModels.CreateSnapshotRequest;
import cn.sifangguan.hotelaios.dailyoperations.OperationIntelligenceModels.RetrySnapshotRequest;
import cn.sifangguan.hotelaios.dailyoperations.OperationIntelligenceModels.SnapshotDetail;
import cn.sifangguan.hotelaios.dailyoperations.OperationIntelligenceModels.SnapshotSummary;
import cn.sifangguan.hotelaios.shared.audit.AuditWriter;
import cn.sifangguan.hotelaios.shared.context.TenantPrincipal;
import cn.sifangguan.hotelaios.shared.idempotency.CommandIdempotencyService;
import cn.sifangguan.hotelaios.shared.security.AccessPolicy;
import cn.sifangguan.hotelaios.shared.time.BusinessDayService;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.List;
import java.util.UUID;

/** Creates and reads immutable V21 operation snapshots. */
@Service
public class OperationSnapshotService {
    private final NamedParameterJdbcTemplate jdbc;
    private final AccessPolicy accessPolicy;
    private final OperationScopeService scopes;
    private final BusinessDayService businessDayService;
    private final OperationSnapshotPayloadBuilder payloadBuilder;
    private final CommandIdempotencyService idempotencyService;
    private final AuditWriter auditWriter;
    private final ObjectMapper objectMapper;

    public OperationSnapshotService(
            NamedParameterJdbcTemplate jdbc,
            AccessPolicy accessPolicy,
            OperationScopeService scopes,
            BusinessDayService businessDayService,
            OperationSnapshotPayloadBuilder payloadBuilder,
            CommandIdempotencyService idempotencyService,
            AuditWriter auditWriter,
            ObjectMapper objectMapper
    ) {
        this.jdbc = jdbc;
        this.accessPolicy = accessPolicy;
        this.scopes = scopes;
        this.businessDayService = businessDayService;
        this.payloadBuilder = payloadBuilder;
        this.idempotencyService = idempotencyService;
        this.auditWriter = auditWriter;
        this.objectMapper = objectMapper;
    }

    @Transactional(readOnly = true)
    public List<SnapshotSummary> list(UUID orgUnitId, LocalDate businessDate) {
        accessPolicy.requirePermission("operation-snapshot.read");
        TenantPrincipal principal = scopes.prepare();
        UUID hotelId = null;
        if (orgUnitId != null) {
            OperationScopeService.OrgSelection selected = scopes.resolveOrg(principal, orgUnitId);
            hotelId = businessDayService.resolve(selected.id(), businessDate).hotelOrgUnitId();
        }
        return snapshotRows(principal, hotelId, businessDate, null);
    }

    @Transactional(readOnly = true)
    public SnapshotDetail detail(UUID snapshotId) {
        accessPolicy.requirePermission("operation-snapshot.read");
        TenantPrincipal principal = scopes.prepare();
        return toDetail(requireSnapshot(principal, snapshotId));
    }

    @Transactional(readOnly = true)
    public DailyOperationOverview latestOverview(
            UUID orgUnitId,
            LocalDate businessDate,
            UUID snapshotId
    ) {
        accessPolicy.requirePermission("daily-operation.read");
        accessPolicy.requirePermission("operation-snapshot.read");
        TenantPrincipal principal = scopes.prepare();
        SnapshotRow row;
        if (snapshotId != null) {
            row = requireSnapshot(principal, snapshotId);
            if (orgUnitId != null) {
                OperationScopeService.OrgSelection selected = scopes.resolveOrg(principal, orgUnitId);
                UUID selectedHotel = businessDayService.resolve(selected.id(), businessDate).hotelOrgUnitId();
                if (!selectedHotel.equals(row.hotelOrgUnitId())) {
                    throw new ResponseStatusException(HttpStatus.BAD_REQUEST,
                            "snapshotId与orgUnitId不属于同一门店");
                }
            }
            if (businessDate != null && !businessDate.equals(row.businessDate())) {
                throw new ResponseStatusException(HttpStatus.BAD_REQUEST,
                        "snapshotId与businessDate不一致");
            }
        } else {
            OperationScopeService.OrgSelection selected = scopes.resolveOrg(principal, orgUnitId);
            BusinessDayService.BusinessDayContext context = businessDayService.resolve(
                    selected.id(), businessDate);
            List<SnapshotRow> rows = snapshotRecords(principal, context.hotelOrgUnitId(),
                    context.businessDate(), "GENERATED", 1);
            if (rows.isEmpty()) {
                throw new ResponseStatusException(HttpStatus.NOT_FOUND, "指定营业日尚无可用日运营快照");
            }
            row = rows.getFirst();
        }
        if (!"GENERATED".equals(row.status()) && !"SUPERSEDED".equals(row.status())) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "日运营快照尚未生成完成");
        }
        return snapshotOverview(row);
    }

    @Transactional
    public SnapshotSummary create(CreateSnapshotRequest request, String idempotencyKey) {
        accessPolicy.requirePermission("operation-snapshot.retry");
        TenantPrincipal principal = scopes.prepare();
        UUID actorAssignmentId = actorAssignment(principal, request.actorAssignmentId());
        OperationScopeService.OrgSelection selected = scopes.resolveOrg(principal, request.orgUnitId());
        BusinessDayService.BusinessDayContext context = businessDayService.resolve(
                selected.id(), request.businessDate());
        // A snapshot is hotel-wide. A department-only scope may read an authorized
        // hotel snapshot but may not close the hotel's business day.
        accessPolicy.requireOrgScope(context.hotelOrgUnitId());
        CreateCommand command = new CreateCommand(
                context.hotelOrgUnitId(), context.businessDate(), actorAssignmentId);
        CommandIdempotencyService.Reservation reservation = idempotencyService.reserve(
                "OPERATION_SNAPSHOT_CREATE", idempotencyKey, command, principal.correlationId());
        if (reservation.replayed()) {
            return summary(reservation.resourceId());
        }

        UUID runId = ensureBusinessDayRun(principal, context);
        Long existing = jdbc.queryForObject("""
                select count(*) from daily_operation_snapshot
                where tenant_id = :tenantId and business_day_run_id = :runId
                """, scopes.base(principal).addValue("runId", runId), Long.class);
        if (existing != null && existing > 0) {
            throw new ResponseStatusException(HttpStatus.CONFLICT,
                    "该营业日已有快照记录；失败记录请使用retry生成新版本");
        }
        markRunClosing(principal, runId);
        UUID snapshotId = insertGeneratingSnapshot(
                principal, runId, context.hotelOrgUnitId(), context.businessDate(),
                1, null, null);
        SnapshotSummary result = completeOrFail(
                principal, runId, snapshotId, context.hotelOrgUnitId(), context.businessDate());
        idempotencyService.succeed(reservation, "DAILY_OPERATION_SNAPSHOT", snapshotId, 201, result);
        recordGeneration(principal, result, actorAssignmentId, null, "OPERATION_SNAPSHOT_CREATED");
        return result;
    }

    @Transactional
    public SnapshotSummary retry(
            UUID failedSnapshotId,
            RetrySnapshotRequest request,
            String idempotencyKey
    ) {
        accessPolicy.requirePermission("operation-snapshot.retry");
        TenantPrincipal principal = scopes.prepare();
        CommandIdempotencyService.Reservation reservation = idempotencyService.reserve(
                "OPERATION_SNAPSHOT_RETRY", idempotencyKey,
                new RetryCommand(failedSnapshotId, request.expectedVersion()), principal.correlationId());
        if (reservation.replayed()) {
            return summary(reservation.resourceId());
        }

        SnapshotRow failed = requireSnapshot(principal, failedSnapshotId);
        if (!"FAILED".equals(failed.status())) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "只有生成失败的快照可以重试");
        }
        if (request.expectedVersion() != failed.rowVersion()) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "快照版本已变化，请刷新后重试");
        }
        accessPolicy.requireOrgScope(failed.hotelOrgUnitId());
        BusinessDayService.BusinessDayContext context = businessDayService.resolve(
                failed.hotelOrgUnitId(), failed.businessDate());
        UUID runId = ensureBusinessDayRun(principal, context);
        markRunClosing(principal, runId);
        int nextVersion = nextVersion(principal, runId);
        UUID snapshotId = insertGeneratingSnapshot(
                principal, runId, failed.hotelOrgUnitId(), failed.businessDate(), nextVersion,
                failed.id(), "失败快照重试");
        SnapshotSummary result = completeOrFail(
                principal, runId, snapshotId, failed.hotelOrgUnitId(), failed.businessDate());
        idempotencyService.succeed(reservation, "DAILY_OPERATION_SNAPSHOT", snapshotId, 200, result);
        recordGeneration(principal, result, null, failed.id(), "OPERATION_SNAPSHOT_RETRIED");
        return result;
    }

    private void markRunClosing(TenantPrincipal principal, UUID runId) {
        int changed = jdbc.update("""
                update business_day_run
                set status = 'CLOSING', closing_started_at = coalesce(closing_started_at, now()),
                    closed_at = null, failed_at = null, failure_reason = null,
                    row_version = row_version + 1
                where tenant_id = :tenantId and id = :runId
                """, scopes.base(principal).addValue("runId", runId));
        if (changed != 1) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "营业日关闭状态已变化");
        }
    }

    private UUID insertGeneratingSnapshot(
            TenantPrincipal principal,
            UUID runId,
            UUID hotelOrgUnitId,
            LocalDate businessDate,
            int versionNo,
            UUID correctionOfSnapshotId,
            String correctionReason
    ) {
        UUID snapshotId = UUID.randomUUID();
        OffsetDateTime now = OffsetDateTime.now(ZoneOffset.UTC);
        jdbc.update("""
                insert into daily_operation_snapshot
                    (id, tenant_id, business_day_run_id, hotel_org_unit_id, business_date,
                     version_no, status, snapshot_at, data_cutoff_at, completeness_status,
                     payload_snapshot, correction_of_snapshot_id, correction_reason,
                     generated_by_account_id, trace_id)
                values
                    (:id, :tenantId, :runId, :hotelId, :businessDate,
                     :versionNo, 'GENERATING', :snapshotAt, :dataCutoffAt, 'COMPLETE',
                     '{}'::jsonb, :correctionOf, :correctionReason,
                     :actorId, :traceId)
                """, scopes.base(principal)
                .addValue("id", snapshotId)
                .addValue("runId", runId)
                .addValue("hotelId", hotelOrgUnitId)
                .addValue("businessDate", businessDate)
                .addValue("versionNo", versionNo)
                .addValue("snapshotAt", now)
                .addValue("dataCutoffAt", now)
                .addValue("correctionOf", correctionOfSnapshotId)
                .addValue("correctionReason", correctionReason)
                .addValue("actorId", principal.actorId())
                .addValue("traceId", principal.correlationId()));
        return snapshotId;
    }

    private SnapshotSummary completeOrFail(
            TenantPrincipal principal,
            UUID runId,
            UUID snapshotId,
            UUID hotelOrgUnitId,
            LocalDate businessDate
    ) {
        try {
            payloadBuilder.generate(principal, snapshotId, hotelOrgUnitId, businessDate,
                    OffsetDateTime.now(ZoneOffset.UTC));
            int changed = jdbc.update("""
                    update business_day_run
                    set status = 'CLOSED', closed_at = now(), failed_at = null,
                        failure_reason = null, row_version = row_version + 1
                    where tenant_id = :tenantId and id = :runId and status = 'CLOSING'
                    """, scopes.base(principal).addValue("runId", runId));
            if (changed != 1) {
                throw new ResponseStatusException(HttpStatus.CONFLICT, "营业日关闭状态已变化");
            }
        } catch (RuntimeException generationFailure) {
            String failureReason = failureReason(generationFailure);
            int snapshotChanged = jdbc.update("""
                    update daily_operation_snapshot
                    set status = 'FAILED', failure_reason = :failureReason,
                        row_version = row_version + 1
                    where tenant_id = :tenantId and id = :id and status = 'GENERATING'
                    """, scopes.base(principal)
                    .addValue("id", snapshotId)
                    .addValue("failureReason", failureReason));
            if (snapshotChanged != 1) throw generationFailure;
            jdbc.update("""
                    update business_day_run
                    set status = 'FAILED', failed_at = now(), failure_reason = :failureReason,
                        row_version = row_version + 1
                    where tenant_id = :tenantId and id = :runId
                    """, scopes.base(principal)
                    .addValue("runId", runId)
                    .addValue("failureReason", failureReason));
        }
        return summary(snapshotId);
    }

    private void recordGeneration(
            TenantPrincipal principal,
            SnapshotSummary result,
            UUID actorAssignmentId,
            UUID correctionOfSnapshotId,
            String auditAction
    ) {
        String eventType = "GENERATED".equals(result.status())
                ? "OPERATION_SNAPSHOT_GENERATED" : "OPERATION_SNAPSHOT_FAILED";
        auditWriter.record(auditAction, "DAILY_OPERATION_SNAPSHOT", result.id(),
                json(new GenerationAudit(
                        result.status(), result.versionNo(), result.rowVersion(),
                        result.completenessPercent(), correctionOfSnapshotId, actorAssignmentId)));
        auditWriter.emit("DAILY_OPERATION_SNAPSHOT", result.id(), eventType,
                json(new SnapshotEvent(
                        result.orgUnitId(), result.businessDate(), result.versionNo(),
                        result.rowVersion(), result.status(), correctionOfSnapshotId)));
    }

    private UUID actorAssignment(TenantPrincipal principal, UUID requested) {
        if (requested != null) {
            accessPolicy.requireActiveAssignment(requested);
            return requested;
        }
        if (principal.assignmentIds().size() == 1) {
            return principal.assignmentIds().stream().findFirst().orElse(null);
        }
        return null;
    }

    private static String failureReason(RuntimeException exception) {
        String message = exception.getMessage();
        String result = message == null || message.isBlank()
                ? exception.getClass().getSimpleName() : message.trim();
        return result.length() <= 2000 ? result : result.substring(0, 2000);
    }

    private UUID ensureBusinessDayRun(
            TenantPrincipal principal,
            BusinessDayService.BusinessDayContext context
    ) {
        UUID candidate = UUID.randomUUID();
        jdbc.update("""
                insert into business_day_run
                    (id, tenant_id, hotel_org_unit_id, business_date, timezone,
                     cutoff_local_time, status, triggered_by_account_id, trace_id)
                values
                    (:id, :tenantId, :hotelId, :businessDate, :timezone,
                     :cutoff, 'OPEN', :actorId, :traceId)
                on conflict (tenant_id, hotel_org_unit_id, business_date) do nothing
                """, scopes.base(principal)
                .addValue("id", candidate)
                .addValue("hotelId", context.hotelOrgUnitId())
                .addValue("businessDate", context.businessDate())
                .addValue("timezone", context.timezone())
                .addValue("cutoff", context.cutoffLocalTime())
                .addValue("actorId", principal.actorId())
                .addValue("traceId", principal.correlationId()));
        return jdbc.queryForObject("""
                select id from business_day_run
                where tenant_id = :tenantId and hotel_org_unit_id = :hotelId
                  and business_date = :businessDate
                for update
                """, scopes.base(principal)
                .addValue("hotelId", context.hotelOrgUnitId())
                .addValue("businessDate", context.businessDate()), UUID.class);
    }

    private int nextVersion(TenantPrincipal principal, UUID runId) {
        Integer version = jdbc.queryForObject("""
                select coalesce(max(version_no), 0) + 1
                from daily_operation_snapshot
                where tenant_id = :tenantId and business_day_run_id = :runId
                """, scopes.base(principal).addValue("runId", runId), Integer.class);
        return version == null ? 1 : version;
    }

    private SnapshotSummary summary(UUID snapshotId) {
        if (snapshotId == null) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "幂等响应缺少快照资源标识");
        }
        TenantPrincipal principal = accessPolicy.principal();
        return toSummary(requireSnapshot(principal, snapshotId));
    }

    private List<SnapshotSummary> snapshotRows(
            TenantPrincipal principal,
            UUID hotelId,
            LocalDate businessDate,
            String status
    ) {
        return snapshotRecords(principal, hotelId, businessDate, status, 500)
                .stream().map(this::toSummary).toList();
    }

    private List<SnapshotRow> snapshotRecords(
            TenantPrincipal principal,
            UUID hotelId,
            LocalDate businessDate,
            String status,
            int limit
    ) {
        MapSqlParameterSource params = scopes.visibility(principal)
                .addValue("hotelId", hotelId)
                .addValue("businessDate", businessDate)
                .addValue("status", status)
                .addValue("limit", limit);
        return jdbc.query("""
                select snapshot.id, snapshot.hotel_org_unit_id, hotel.name as hotel_name,
                       snapshot.business_date, snapshot.version_no, snapshot.status,
                       snapshot.completeness_status, snapshot.payload_snapshot::text,
                       snapshot.correction_of_snapshot_id, snapshot.correction_reason,
                       snapshot.generated_at, snapshot.failure_reason, snapshot.row_version
                from daily_operation_snapshot snapshot
                join org_unit hotel
                  on hotel.tenant_id = snapshot.tenant_id and hotel.id = snapshot.hotel_org_unit_id
                where snapshot.tenant_id = :tenantId
                  and (cast(:hotelId as uuid) is null or snapshot.hotel_org_unit_id = :hotelId)
                  and (cast(:businessDate as date) is null or snapshot.business_date = :businessDate)
                  and (cast(:status as varchar) is null or snapshot.status = :status)
                  and (:tenantScope or exists (
                    select 1 from org_unit_closure visible
                    where visible.tenant_id = snapshot.tenant_id
                      and visible.ancestor_id = snapshot.hotel_org_unit_id
                      and visible.descendant_id in (:orgScopes)
                  ))
                order by snapshot.business_date desc, snapshot.version_no desc
                limit :limit
                """, params, this::mapSnapshot);
    }

    private SnapshotRow requireSnapshot(TenantPrincipal principal, UUID snapshotId) {
        List<SnapshotRow> rows = jdbc.query("""
                select snapshot.id, snapshot.hotel_org_unit_id, hotel.name as hotel_name,
                       snapshot.business_date, snapshot.version_no, snapshot.status,
                       snapshot.completeness_status, snapshot.payload_snapshot::text,
                       snapshot.correction_of_snapshot_id, snapshot.correction_reason,
                       snapshot.generated_at, snapshot.failure_reason, snapshot.row_version
                from daily_operation_snapshot snapshot
                join org_unit hotel
                  on hotel.tenant_id = snapshot.tenant_id and hotel.id = snapshot.hotel_org_unit_id
                where snapshot.tenant_id = :tenantId and snapshot.id = :id
                  and (:tenantScope or exists (
                    select 1 from org_unit_closure visible
                    where visible.tenant_id = snapshot.tenant_id
                      and visible.ancestor_id = snapshot.hotel_org_unit_id
                      and visible.descendant_id in (:orgScopes)
                  ))
                """, scopes.visibility(principal).addValue("id", snapshotId), this::mapSnapshot);
        if (rows.size() != 1) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND,
                    "日运营快照不存在或不在当前授权范围内");
        }
        return rows.getFirst();
    }

    private SnapshotRow mapSnapshot(java.sql.ResultSet rs, int rowNum) throws java.sql.SQLException {
        return new SnapshotRow(
                rs.getObject("id", UUID.class), rs.getObject("hotel_org_unit_id", UUID.class),
                rs.getString("hotel_name"), rs.getObject("business_date", LocalDate.class),
                rs.getInt("version_no"), rs.getString("status"),
                rs.getString("completeness_status"), rs.getString("payload_snapshot"),
                rs.getObject("correction_of_snapshot_id", UUID.class), rs.getString("correction_reason"),
                rs.getObject("generated_at", OffsetDateTime.class), rs.getString("failure_reason"),
                rs.getLong("row_version"));
    }

    private SnapshotSummary toSummary(SnapshotRow row) {
        return new SnapshotSummary(
                row.id(), row.hotelOrgUnitId(), row.hotelName(), row.businessDate(), row.versionNo(),
                row.status(), row.generatedAt(), snapshotCompleteness(row),
                row.correctionReason(), row.rowVersion());
    }

    private SnapshotDetail toDetail(SnapshotRow row) {
        SnapshotSummary summary = toSummary(row);
        return new SnapshotDetail(
                summary.id(), summary.orgUnitId(), summary.orgName(), summary.businessDate(),
                summary.versionNo(), summary.status(), summary.generatedAt(),
                summary.completenessPercent(), summary.correctionReason(), summary.rowVersion(),
                snapshotOverview(row), row.correctionOfSnapshotId());
    }

    private DailyOperationOverview snapshotOverview(SnapshotRow row) {
        if (row.payload() != null && !row.payload().isBlank() && !"{}".equals(row.payload().trim())) {
            try {
                DailyOperationOverview stored = objectMapper.readValue(
                        row.payload(), DailyOperationOverview.class);
                return new DailyOperationOverview(
                        stored.orgUnitId(), stored.orgName(), stored.businessDate(), stored.timezone(),
                        "SNAPSHOT", row.id(), row.generatedAt(), stored.dataUpdatedAt(),
                        stored.unavailableSources(), stored.metrics(), stored.issues(),
                        stored.actionItemCount(), stored.unresolvedIssueCount(), stored.overdueCount(),
                        stored.pendingTaskCandidateCount());
            } catch (Exception ignored) {
                // A malformed historical payload must be surfaced as unavailable, never as zero data.
            }
        }
        return new DailyOperationOverview(
                row.hotelOrgUnitId(), row.hotelName(), row.businessDate(), "UTC", "SNAPSHOT",
                row.id(), row.generatedAt(), row.generatedAt(), List.of("SNAPSHOT_PAYLOAD"),
                List.of(), List.of(), 0, 0, 0, 0);
    }

    private static int completenessPercent(String status) {
        return switch (status) {
            case "COMPLETE" -> 100;
            case "PARTIAL" -> 50;
            default -> 0;
        };
    }

    private static Integer snapshotCompleteness(SnapshotRow row) {
        if ("FAILED".equals(row.status())) return 0;
        if ("GENERATING".equals(row.status())) return null;
        return completenessPercent(row.completenessStatus());
    }

    private String json(Object value) {
        try {
            return objectMapper.writeValueAsString(value);
        } catch (Exception exception) {
            throw new IllegalArgumentException("无法生成日运营快照JSON", exception);
        }
    }

    private record SnapshotRow(
            UUID id,
            UUID hotelOrgUnitId,
            String hotelName,
            LocalDate businessDate,
            int versionNo,
            String status,
            String completenessStatus,
            String payload,
            UUID correctionOfSnapshotId,
            String correctionReason,
            OffsetDateTime generatedAt,
            String failureReason,
            long rowVersion
    ) {
    }

    private record RetryCommand(UUID snapshotId, long expectedVersion) {
    }

    private record CreateCommand(
            UUID hotelOrgUnitId,
            LocalDate businessDate,
            UUID actorAssignmentId
    ) {
    }

    private record GenerationAudit(
            String status,
            int versionNo,
            long rowVersion,
            Integer completenessPercent,
            UUID correctionOfSnapshotId,
            UUID actorAssignmentId
    ) {
    }

    private record SnapshotEvent(
            UUID hotelOrgUnitId,
            LocalDate businessDate,
            int versionNo,
            long rowVersion,
            String status,
            UUID correctionOfSnapshotId
    ) {
    }
}
