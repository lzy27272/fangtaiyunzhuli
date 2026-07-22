package cn.sifangguan.hotelaios.dailyoperations;

import cn.sifangguan.hotelaios.dailyoperations.OperationExportFileRenderer.DetailRow;
import cn.sifangguan.hotelaios.dailyoperations.OperationExportFileRenderer.EvidenceRow;
import cn.sifangguan.hotelaios.dailyoperations.OperationExportFileRenderer.RenderedFile;
import cn.sifangguan.hotelaios.shared.audit.AuditWriter;
import cn.sifangguan.hotelaios.shared.context.TenantContext;
import cn.sifangguan.hotelaios.shared.context.TenantPrincipal;
import cn.sifangguan.hotelaios.shared.db.TenantDatabaseContext;
import cn.sifangguan.hotelaios.shared.events.TenantSystemAccountResolver;
import cn.sifangguan.hotelaios.workdata.AttachmentService;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Isolation;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Objects;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;

/** Tenant-scoped asynchronous processor for operation export jobs. */
@Service
public class OperationExportProcessor {
    private static final Logger log = LoggerFactory.getLogger(OperationExportProcessor.class);
    private final OperationExportJobTransactions transactions;
    private final OperationExportFileRenderer renderer = new OperationExportFileRenderer();
    private final AttachmentService attachmentService;
    private final OperationExportExpiryService expiryService;
    private final TenantSystemAccountResolver systemAccountResolver;
    private final ObjectMapper objectMapper;

    public OperationExportProcessor(
            OperationExportJobTransactions transactions,
            AttachmentService attachmentService,
            OperationExportExpiryService expiryService,
            TenantSystemAccountResolver systemAccountResolver,
            ObjectMapper objectMapper
    ) {
        this.transactions = transactions;
        this.attachmentService = attachmentService;
        this.expiryService = expiryService;
        this.systemAccountResolver = systemAccountResolver;
        this.objectMapper = objectMapper;
    }

    public ProcessingResult processTenant(UUID tenantId, int batchSize, UUID correlationId) {
        Objects.requireNonNull(tenantId, "tenantId");
        Objects.requireNonNull(correlationId, "correlationId");
        int limit = Math.max(1, Math.min(batchSize, 500));
        UUID actorId = systemAccountResolver.resolveOrCreate(tenantId);
        TenantPrincipal previous = TenantContext.current().orElse(null);
        TenantContext.set(new TenantPrincipal(
                tenantId, actorId, "SYSTEM_AUTOMATION", Set.of("SYSTEM_AUTOMATION"),
                Set.of("operation-export.process"), Set.of(), Set.of(), true, correlationId));
        int processed = 0;
        int succeeded = 0;
        int failed = 0;
        int expired = 0;
        int expiryFailed = 0;
        try {
            OperationExportExpiryService.CleanupResult cleanup = expiryService.cleanupTenant(tenantId, limit);
            expired = cleanup.cleaned();
            expiryFailed = cleanup.failed();
            while (processed < limit) {
                Optional<ClaimedJob> claimed = transactions.claimNext(tenantId);
                if (claimed.isEmpty()) break;
                ClaimedJob job = claimed.orElseThrow();
                processed++;
                String objectKey = null;
                try {
                    cleanupAttemptsBestEffort(job, null);
                    FrozenRequest request = validateFrozenRequest(job);
                    ExportData data = transactions.loadData(
                            job, request.includeSensitive(), request.tenantScope(), request.orgScopeRoots());
                    RenderedFile rendered = renderer.render(
                            request.exportType(), job.businessDate(), data.orgName(),
                            request.includeSensitive(), data.details(), data.evidence());
                    requireSafeFileName(rendered.fileName());
                    objectKey = tenantId + "/operation-exports/" + job.id()
                            + "/attempt-" + job.leaseVersion() + "/" + rendered.fileName();
                    AttachmentService.StoredObject stored = attachmentService.storeGeneratedBytes(
                            objectKey, rendered.fileName(), rendered.mediaType(), rendered.bytes());
                    transactions.markSucceeded(job, stored);
                    cleanupAttemptsBestEffort(job, stored.objectKey());
                    succeeded++;
                } catch (RuntimeException exception) {
                    if (objectKey == null) {
                        transactions.markFailed(job, exception);
                        failed++;
                        continue;
                    }
                    CompletionReconciliation reconciliation;
                    try {
                        reconciliation = transactions.reconcileCompletion(job, objectKey);
                    } catch (RuntimeException reconciliationFailure) {
                        log.atError()
                                .addKeyValue("alert_code", "EXPORT_RECONCILIATION_FAILED")
                                .addKeyValue("tenant_id", job.tenantId())
                                .addKeyValue("job_id", job.id())
                                .addKeyValue("lease_version", job.leaseVersion())
                                .setCause(reconciliationFailure)
                                .log("Export completion reconciliation failed; preserving attempt file");
                        failed++;
                        continue;
                    }
                    if (reconciliation == CompletionReconciliation.COMMITTED_THIS_ATTEMPT) {
                        cleanupAttemptsBestEffort(job, objectKey);
                        succeeded++;
                        continue;
                    }
                    boolean attemptRemoved = true;
                    try {
                        attachmentService.removeStoredObject(objectKey);
                    } catch (RuntimeException cleanupFailure) {
                        attemptRemoved = false;
                        log.atError()
                                .addKeyValue("alert_code", "EXPORT_ATTEMPT_CLEANUP_FAILED")
                                .addKeyValue("tenant_id", job.tenantId())
                                .addKeyValue("job_id", job.id())
                                .addKeyValue("lease_version", job.leaseVersion())
                                .setCause(cleanupFailure)
                                .log("Export attempt cleanup failed; preserving retryable job state");
                    }
                    if (attemptRemoved && reconciliation == CompletionReconciliation.STILL_OWNED) {
                        transactions.markFailed(job, exception);
                    }
                    failed++;
                }
            }
            return new ProcessingResult(processed, succeeded, failed, expired, expiryFailed);
        } finally {
            if (previous == null) TenantContext.clear(); else TenantContext.set(previous);
        }
    }

    private void cleanupAttemptsBestEffort(ClaimedJob job, String winnerObjectKey) {
        try {
            attachmentService.cleanupGeneratedExportJob(job.tenantId(), job.id(), winnerObjectKey);
        } catch (RuntimeException cleanupFailure) {
            log.atWarn()
                    .addKeyValue("alert_code", "EXPORT_ORPHAN_CLEANUP_FAILED")
                    .addKeyValue("tenant_id", job.tenantId())
                    .addKeyValue("job_id", job.id())
                    .setCause(cleanupFailure)
                    .log("Export orphan attempt cleanup will be retried by retention maintenance");
        }
    }

    private FrozenRequest validateFrozenRequest(ClaimedJob job) {
        try {
            JsonNode filters = objectMapper.readTree(job.filterSnapshot());
            JsonNode authorization = objectMapper.readTree(job.authorizationSnapshot());
            String exportType = requiredText(filters, "exportType").toUpperCase(Locale.ROOT);
            UUID filterOrgId = UUID.fromString(requiredText(filters, "orgUnitId"));
            LocalDate filterDate = LocalDate.parse(requiredText(filters, "businessDate"));
            boolean includeSensitive = requiredBoolean(filters, "includeSensitive");
            boolean crossHotel = requiredBoolean(filters, "crossHotel");
            UUID requestedBy = UUID.fromString(requiredText(authorization, "requestedByAccountId"));
            boolean tenantScope = requiredBoolean(authorization, "tenantScope");

            if (!job.orgUnitId().equals(filterOrgId)
                    || !job.businessDate().equals(filterDate)
                    || !job.requestedByAccountId().equals(requestedBy)) {
                throw new IllegalArgumentException("导出作业冻结条件与授权快照不一致");
            }
            if (includeSensitive != Set.of("SENSITIVE", "RESTRICTED").contains(job.sensitivityLevel())) {
                throw new IllegalArgumentException("导出作业敏感级别与冻结条件不一致");
            }
            if (crossHotel != (job.hotelOrgUnitId() == null)) {
                throw new IllegalArgumentException("导出作业跨店标识与冻结条件不一致");
            }
            JsonNode permissionCodes = authorization.path("permissionCodes");
            if (!permissionCodes.isArray() || permissionCodes.isEmpty()) {
                throw new IllegalArgumentException("导出授权快照缺少已验证权限");
            }
            Set<String> frozenPermissions = new java.util.HashSet<>();
            for (JsonNode permissionCode : permissionCodes) {
                if (!permissionCode.isTextual() || permissionCode.asText().isBlank()) {
                    throw new IllegalArgumentException("导出授权快照包含无效权限代码");
                }
                frozenPermissions.add(permissionCode.asText());
            }
            Set<String> requiredPermissions = new java.util.HashSet<>(Set.of(
                    "daily-operation.read", "operation-export.create"));
            if (includeSensitive) requiredPermissions.add("operation-export.sensitive");
            if (crossHotel) requiredPermissions.add("daily-operation.cross-hotel-read");
            if (!frozenPermissions.containsAll(requiredPermissions)) {
                throw new IllegalArgumentException("导出授权快照缺少必需权限");
            }
            String expectedFormat = switch (exportType) {
                case "CSV_DETAIL", "CSV" -> "CSV";
                case "EVIDENCE_LIST" -> "EVIDENCE_LIST";
                case "EXCEL_DETAIL", "XLSX" -> "XLSX";
                case "PDF_SUMMARY", "PDF" -> "PDF";
                default -> throw new IllegalArgumentException("不支持的冻结导出类型");
            };
            if (!expectedFormat.equals(job.exportFormat())) {
                throw new IllegalArgumentException("导出格式与冻结条件不一致");
            }
            List<UUID> orgScopeRoots = new ArrayList<>();
            if (!tenantScope) {
                JsonNode orgScopes = authorization.path("orgScopes");
                if (!orgScopes.isArray() || orgScopes.isEmpty()) {
                    throw new IllegalArgumentException("导出授权快照缺少组织范围");
                }
                for (JsonNode orgScope : orgScopes) {
                    if (!orgScope.isTextual() || orgScope.asText().isBlank()) {
                        throw new IllegalArgumentException("导出授权快照包含无效组织范围");
                    }
                    orgScopeRoots.add(UUID.fromString(orgScope.asText()));
                }
            }
            return new FrozenRequest(exportType, includeSensitive, tenantScope, List.copyOf(orgScopeRoots));
        } catch (IllegalArgumentException exception) {
            throw exception;
        } catch (Exception exception) {
            throw new IllegalArgumentException("导出作业冻结快照无法解析", exception);
        }
    }

    private static String requiredText(JsonNode node, String field) {
        JsonNode value = node.get(field);
        if (value == null || !value.isTextual() || value.asText().isBlank()) {
            throw new IllegalArgumentException("导出冻结快照缺少字段：" + field);
        }
        return value.asText();
    }

    private static boolean requiredBoolean(JsonNode node, String field) {
        JsonNode value = node.get(field);
        if (value == null || !value.isBoolean()) {
            throw new IllegalArgumentException("导出冻结快照缺少字段：" + field);
        }
        return value.asBoolean();
    }

    private static void requireSafeFileName(String fileName) {
        if (fileName == null || !fileName.matches("[\\p{L}\\p{N}._-]{1,160}")
                || fileName.contains("..")) {
            throw new IllegalArgumentException("导出渲染器返回了不安全的文件名");
        }
    }

    public record ProcessingResult(
            int processed,
            int succeeded,
            int failed,
            int expired,
            int expiryFailed
    ) {
    }

    private record FrozenRequest(
            String exportType,
            boolean includeSensitive,
            boolean tenantScope,
            List<UUID> orgScopeRoots
    ) {
    }
}

@Component
class OperationExportJobTransactions {
    private final NamedParameterJdbcTemplate jdbc;
    private final TenantDatabaseContext databaseContext;
    private final AuditWriter auditWriter;
    private final int maxRows;
    private final long maxVariableTextBytes;
    private final long maxSingleTextBytes;

    OperationExportJobTransactions(
            NamedParameterJdbcTemplate jdbc,
            TenantDatabaseContext databaseContext,
            AuditWriter auditWriter,
            @Value("${app.operation-export.max-rows:5000}") int maxRows,
            @Value("${app.operation-export.max-variable-text-bytes:4194304}") long maxVariableTextBytes,
            @Value("${app.operation-export.max-single-text-bytes:131072}") long maxSingleTextBytes
    ) {
        this.jdbc = jdbc;
        this.databaseContext = databaseContext;
        this.auditWriter = auditWriter;
        if (maxRows < 1 || maxRows > 100_000
                || maxVariableTextBytes < 1 || maxSingleTextBytes < 1
                || maxSingleTextBytes > maxVariableTextBytes) {
            throw new IllegalArgumentException("运营导出资源预算配置无效");
        }
        this.maxRows = maxRows;
        this.maxVariableTextBytes = maxVariableTextBytes;
        this.maxSingleTextBytes = maxSingleTextBytes;
    }

    @Transactional
    public Optional<ClaimedJob> claimNext(UUID tenantId) {
        databaseContext.apply(tenantId);
        List<ClaimedJob> rows = jdbc.query("""
                select id, tenant_id, export_format, hotel_org_unit_id, org_unit_id, business_date,
                       filter_snapshot::text, authorization_snapshot::text, sensitivity_level,
                       requested_by_account_id, trace_id, row_version
                from operation_export_job
                where tenant_id = :tenantId
                  and (status = 'PENDING'
                       or (status = 'RUNNING' and updated_at < now() - interval '15 minutes'))
                order by case status when 'PENDING' then 0 else 1 end, created_at, id
                for update skip locked
                limit 1
                """, new MapSqlParameterSource("tenantId", tenantId), (rs, rowNum) -> new ClaimedJob(
                rs.getObject("id", UUID.class), rs.getObject("tenant_id", UUID.class),
                rs.getString("export_format"), rs.getObject("hotel_org_unit_id", UUID.class),
                rs.getObject("org_unit_id", UUID.class),
                rs.getObject("business_date", LocalDate.class), rs.getString("filter_snapshot"),
                rs.getString("authorization_snapshot"), rs.getString("sensitivity_level"),
                rs.getObject("requested_by_account_id", UUID.class), rs.getObject("trace_id", UUID.class),
                rs.getLong("row_version")));
        if (rows.isEmpty()) return Optional.empty();
        ClaimedJob job = rows.getFirst();
        long leaseVersion = job.leaseVersion() + 1;
        int updated = jdbc.update("""
                update operation_export_job
                set status = 'RUNNING', object_key = null, file_name = null, sha256 = null,
                    size_bytes = null, expires_at = null, completed_at = null, failure_reason = null,
                    row_version = row_version + 1, updated_at = now()
                where tenant_id = :tenantId and id = :id and row_version = :previousVersion
                  and (status = 'PENDING'
                       or (status = 'RUNNING' and updated_at < now() - interval '15 minutes'))
                """, base(job).addValue("id", job.id())
                .addValue("previousVersion", job.leaseVersion()));
        if (updated != 1) throw new IllegalStateException("导出作业领取失败");
        return Optional.of(job.withLeaseVersion(leaseVersion));
    }

    @Transactional(readOnly = true, isolation = Isolation.REPEATABLE_READ)
    public ExportData loadData(
            ClaimedJob job,
            boolean includeSensitive,
            boolean tenantScope,
            List<UUID> frozenScopeRoots
    ) {
        databaseContext.apply(job.tenantId());
        if (!tenantScope) {
            if (frozenScopeRoots == null || frozenScopeRoots.isEmpty()) {
                throw new IllegalArgumentException("导出授权快照缺少组织范围");
            }
            Integer authorized = jdbc.queryForObject("""
                    select count(*) from org_unit_closure scope
                    where scope.tenant_id = :tenantId
                      and scope.ancestor_id in (:scopeRoots)
                      and scope.descendant_id = :orgUnitId
                    """, base(job).addValue("scopeRoots", frozenScopeRoots), Integer.class);
            if (authorized == null || authorized < 1) {
                throw new IllegalArgumentException("导出目标组织不在冻结授权范围内");
            }
        }
        String orgName = jdbc.queryForObject("""
                select name from org_unit where tenant_id = :tenantId and id = :orgUnitId
                """, base(job), String.class);
        if (orgName == null || orgName.isBlank()) {
            throw new IllegalArgumentException("导出目标组织不存在");
        }

        MapSqlParameterSource params = base(job)
                .addValue("includeSensitive", includeSensitive)
                .addValue("queryLimit", maxRows + 1);
        requireWithinBudget(params);
        List<DetailRow> details = jdbc.query("""
                select record_type, record_id, reference_no, org_unit_id, status, level,
                       title, description, created_at
                from (
                    select 'DAILY_REPORT'::text as record_type, report.id::text as record_id,
                           report.id::text as reference_no, report.org_unit_id::text as org_unit_id,
                           report.report_status as status, report.review_status as level,
                           'Daily report'::text as title,
                           case when :includeSensitive then revision.narrative else null end as description,
                           report.created_at
                    from daily_report report
                    left join daily_report_revision revision
                      on revision.tenant_id = report.tenant_id and revision.id = report.current_revision_id
                    where report.tenant_id = :tenantId and report.business_date = :businessDate
                      and exists (select 1 from org_unit_closure scope
                                  where scope.tenant_id = report.tenant_id
                                    and scope.ancestor_id = :orgUnitId
                                    and scope.descendant_id = report.org_unit_id)
                    union all
                    select 'ISSUE'::text, issue.id::text, issue.issue_no,
                           issue.org_unit_id::text, issue.lifecycle_status, issue.severity,
                           issue.title, case when :includeSensitive then issue.description else null end,
                           issue.created_at
                    from issue_event issue
                    where issue.tenant_id = :tenantId and issue.business_date = :businessDate
                      and exists (select 1 from org_unit_closure scope
                                  where scope.tenant_id = issue.tenant_id
                                    and scope.ancestor_id = :orgUnitId
                                    and scope.descendant_id = issue.org_unit_id)
                    union all
                    select 'TASK_CANDIDATE'::text, candidate.id::text, candidate.candidate_no,
                           candidate.org_unit_id::text, candidate.status, candidate.priority,
                           candidate.title,
                           case when :includeSensitive then candidate.description else null end,
                           candidate.created_at
                    from task_candidate candidate
                    where candidate.tenant_id = :tenantId and candidate.business_date = :businessDate
                      and exists (select 1 from org_unit_closure scope
                                  where scope.tenant_id = candidate.tenant_id
                                    and scope.ancestor_id = :orgUnitId
                                    and scope.descendant_id = candidate.org_unit_id)
                ) exported
                order by created_at, record_type, record_id
                limit :queryLimit
                """, params, (rs, rowNum) -> new DetailRow(
                rs.getString("record_type"), rs.getString("record_id"), rs.getString("reference_no"),
                rs.getString("org_unit_id"), rs.getString("status"), rs.getString("level"),
                rs.getString("title"), rs.getString("description"),
                String.valueOf(rs.getObject("created_at", OffsetDateTime.class))));

        List<EvidenceRow> evidence = new ArrayList<>(jdbc.query("""
                select 'DAILY_REPORT'::text as source_type, report.id::text as source_id,
                       evidence.evidence_type, evidence.original_name as file_name,
                       evidence.media_type, evidence.size_bytes::text, evidence.sha256,
                       evidence.scan_status as status, evidence.sensitivity_level as sensitivity,
                       evidence.created_at as occurred_at
                from daily_report_evidence evidence
                join daily_report_revision revision
                  on revision.tenant_id = evidence.tenant_id and revision.id = evidence.revision_id
                join daily_report report
                  on report.tenant_id = revision.tenant_id and report.id = revision.report_id
                where report.tenant_id = :tenantId and report.business_date = :businessDate
                  and (:includeSensitive or evidence.sensitivity_level in ('PUBLIC', 'INTERNAL'))
                  and exists (select 1 from org_unit_closure scope
                              where scope.tenant_id = report.tenant_id
                                and scope.ancestor_id = :orgUnitId
                                and scope.descendant_id = report.org_unit_id)
                order by evidence.created_at, evidence.id
                limit :queryLimit
                """, params, (rs, rowNum) -> new EvidenceRow(
                rs.getString("source_type"), rs.getString("source_id"), rs.getString("evidence_type"),
                rs.getString("file_name"), rs.getString("media_type"), rs.getString("size_bytes"),
                rs.getString("sha256"), rs.getString("status"), rs.getString("sensitivity"),
                String.valueOf(rs.getObject("occurred_at", OffsetDateTime.class)))));
        evidence.addAll(jdbc.query("""
                select 'ISSUE'::text as source_type, issue.id::text as source_id,
                       source.source_type as evidence_type, source.source_external_key as file_name,
                       null::text as media_type, null::text as size_bytes, source.content_hash as sha256,
                       source.source_status as status, 'INTERNAL'::text as sensitivity,
                       coalesce(source.source_occurred_at, source.linked_at) as occurred_at
                from issue_source_link source
                join issue_event issue
                  on issue.tenant_id = source.tenant_id and issue.id = source.issue_id
                where issue.tenant_id = :tenantId and issue.business_date = :businessDate
                  and exists (select 1 from org_unit_closure scope
                              where scope.tenant_id = issue.tenant_id
                                and scope.ancestor_id = :orgUnitId
                                and scope.descendant_id = issue.org_unit_id)
                order by occurred_at, source.id
                limit :queryLimit
                """, params, (rs, rowNum) -> new EvidenceRow(
                rs.getString("source_type"), rs.getString("source_id"), rs.getString("evidence_type"),
                rs.getString("file_name"), rs.getString("media_type"), rs.getString("size_bytes"),
                rs.getString("sha256"), rs.getString("status"), rs.getString("sensitivity"),
                String.valueOf(rs.getObject("occurred_at", OffsetDateTime.class)))));
        if ((long) details.size() + evidence.size() > maxRows) {
            throw new IllegalArgumentException("运营导出数据行数超过资源预算");
        }
        return new ExportData(orgName, List.copyOf(details), List.copyOf(evidence));
    }

    private void requireWithinBudget(MapSqlParameterSource params) {
        ExportBudget budget = jdbc.queryForObject("""
                with budget_parts as (
                    select count(*)::bigint as row_count,
                           coalesce(sum(case when :includeSensitive
                               then octet_length(coalesce(revision.narrative, '')) else 0 end), 0)::bigint
                               as variable_bytes,
                           coalesce(max(case when :includeSensitive
                               then octet_length(coalesce(revision.narrative, '')) else 0 end), 0)::bigint
                               as max_single_bytes
                    from daily_report report
                    left join daily_report_revision revision
                      on revision.tenant_id = report.tenant_id and revision.id = report.current_revision_id
                    where report.tenant_id = :tenantId and report.business_date = :businessDate
                      and exists (select 1 from org_unit_closure scope
                                  where scope.tenant_id = report.tenant_id
                                    and scope.ancestor_id = :orgUnitId
                                    and scope.descendant_id = report.org_unit_id)
                    union all
                    select count(*)::bigint,
                           coalesce(sum(case when :includeSensitive
                               then octet_length(coalesce(issue.description, '')) else 0 end), 0)::bigint,
                           coalesce(max(case when :includeSensitive
                               then octet_length(coalesce(issue.description, '')) else 0 end), 0)::bigint
                    from issue_event issue
                    where issue.tenant_id = :tenantId and issue.business_date = :businessDate
                      and exists (select 1 from org_unit_closure scope
                                  where scope.tenant_id = issue.tenant_id
                                    and scope.ancestor_id = :orgUnitId
                                    and scope.descendant_id = issue.org_unit_id)
                    union all
                    select count(*)::bigint,
                           coalesce(sum(case when :includeSensitive
                               then octet_length(coalesce(candidate.description, '')) else 0 end), 0)::bigint,
                           coalesce(max(case when :includeSensitive
                               then octet_length(coalesce(candidate.description, '')) else 0 end), 0)::bigint
                    from task_candidate candidate
                    where candidate.tenant_id = :tenantId and candidate.business_date = :businessDate
                      and exists (select 1 from org_unit_closure scope
                                  where scope.tenant_id = candidate.tenant_id
                                    and scope.ancestor_id = :orgUnitId
                                    and scope.descendant_id = candidate.org_unit_id)
                    union all
                    select count(*)::bigint, 0::bigint, 0::bigint
                    from daily_report_evidence evidence
                    join daily_report_revision revision
                      on revision.tenant_id = evidence.tenant_id and revision.id = evidence.revision_id
                    join daily_report report
                      on report.tenant_id = revision.tenant_id and report.id = revision.report_id
                    where report.tenant_id = :tenantId and report.business_date = :businessDate
                      and (:includeSensitive or evidence.sensitivity_level in ('PUBLIC', 'INTERNAL'))
                      and exists (select 1 from org_unit_closure scope
                                  where scope.tenant_id = report.tenant_id
                                    and scope.ancestor_id = :orgUnitId
                                    and scope.descendant_id = report.org_unit_id)
                    union all
                    select count(*)::bigint, 0::bigint, 0::bigint
                    from issue_source_link source
                    join issue_event issue
                      on issue.tenant_id = source.tenant_id and issue.id = source.issue_id
                    where issue.tenant_id = :tenantId and issue.business_date = :businessDate
                      and exists (select 1 from org_unit_closure scope
                                  where scope.tenant_id = issue.tenant_id
                                    and scope.ancestor_id = :orgUnitId
                                    and scope.descendant_id = issue.org_unit_id)
                )
                select coalesce(sum(row_count), 0)::bigint as row_count,
                       coalesce(sum(variable_bytes), 0)::bigint as variable_bytes,
                       coalesce(max(max_single_bytes), 0)::bigint as max_single_bytes
                from budget_parts
                """, params, (rs, rowNum) -> new ExportBudget(
                rs.getLong("row_count"), rs.getLong("variable_bytes"), rs.getLong("max_single_bytes")));
        if (budget == null || budget.rowCount() > maxRows
                || budget.variableBytes() > maxVariableTextBytes
                || budget.maxSingleBytes() > maxSingleTextBytes) {
            throw new IllegalArgumentException("运营导出数据超过资源预算");
        }
    }

    @Transactional
    public void markSucceeded(ClaimedJob job, AttachmentService.StoredObject stored) {
        databaseContext.apply(job.tenantId());
        int updated = jdbc.update("""
                update operation_export_job
                set status = 'SUCCEEDED', object_key = :objectKey, file_name = :fileName,
                    sha256 = :sha256, size_bytes = :sizeBytes,
                    completed_at = now(), expires_at = now() + interval '7 days',
                    failure_reason = null, row_version = row_version + 1, updated_at = now()
                where tenant_id = :tenantId and id = :id and status = 'RUNNING'
                  and row_version = :leaseVersion
                """, base(job).addValue("id", job.id())
                .addValue("leaseVersion", job.leaseVersion())
                .addValue("objectKey", stored.objectKey()).addValue("fileName", stored.originalName())
                .addValue("sha256", stored.sha256()).addValue("sizeBytes", stored.sizeBytes()));
        if (updated != 1) throw new ExportLeaseLostException("导出作业租约已失效");
        auditWriter.record("OPERATION_EXPORT_SUCCEEDED", "OPERATION_EXPORT_JOB", job.id(),
                "{\"status\":\"SUCCEEDED\",\"sha256\":\"" + stored.sha256() + "\"}");
    }

    @Transactional(readOnly = true, propagation = Propagation.REQUIRES_NEW)
    public CompletionReconciliation reconcileCompletion(ClaimedJob job, String attemptObjectKey) {
        databaseContext.apply(job.tenantId());
        List<CompletionState> rows = jdbc.query("""
                select status, object_key, row_version
                from operation_export_job
                where tenant_id = :tenantId and id = :id
                """, base(job).addValue("id", job.id()), (rs, rowNum) -> new CompletionState(
                rs.getString("status"), rs.getString("object_key"), rs.getLong("row_version")));
        if (rows.size() != 1) return CompletionReconciliation.UNKNOWN;
        CompletionState state = rows.getFirst();
        if ("SUCCEEDED".equals(state.status()) && attemptObjectKey.equals(state.objectKey())) {
            return CompletionReconciliation.COMMITTED_THIS_ATTEMPT;
        }
        if ("RUNNING".equals(state.status()) && state.rowVersion() == job.leaseVersion()) {
            return CompletionReconciliation.STILL_OWNED;
        }
        return CompletionReconciliation.LOST_LEASE;
    }

    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public boolean markFailed(ClaimedJob job, RuntimeException failure) {
        databaseContext.apply(job.tenantId());
        String message = failure.getMessage() == null ? failure.getClass().getSimpleName() : failure.getMessage();
        message = message.replace('\r', ' ').replace('\n', ' ').trim();
        if (message.length() > 1000) message = message.substring(0, 1000);
        int updated = jdbc.update("""
                update operation_export_job
                set status = 'FAILED', failure_reason = :failureReason, completed_at = now(),
                    object_key = null, file_name = null, sha256 = null, size_bytes = null, expires_at = null,
                    row_version = row_version + 1, updated_at = now()
                where tenant_id = :tenantId and id = :id and status = 'RUNNING'
                  and row_version = :leaseVersion
                """, base(job).addValue("id", job.id()).addValue("failureReason", message)
                .addValue("leaseVersion", job.leaseVersion()));
        if (updated != 1) return false;
        auditWriter.record("OPERATION_EXPORT_FAILED", "OPERATION_EXPORT_JOB", job.id(),
                "{\"status\":\"FAILED\",\"errorType\":\""
                        + failure.getClass().getSimpleName().replace("\"", "") + "\"}");
        return true;
    }

    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public Optional<ExpiredExportObject> claimExpired(UUID tenantId, UUID requestedJobId) {
        databaseContext.apply(tenantId);
        MapSqlParameterSource params = new MapSqlParameterSource("tenantId", tenantId)
                .addValue("jobId", requestedJobId);
        List<ExpiredExportObject> rows = jdbc.query("""
                select id, tenant_id, object_key, row_version
                from operation_export_job
                where tenant_id = :tenantId and object_key is not null
                  and (cast(:jobId as uuid) is null or id = :jobId)
                  and ((status = 'SUCCEEDED' and expires_at <= now())
                       or (status = 'EXPIRED' and updated_at < now() - interval '5 minutes'))
                order by expires_at nulls first, id
                for update skip locked
                limit 1
                """, params, (rs, rowNum) -> new ExpiredExportObject(
                rs.getObject("id", UUID.class), rs.getObject("tenant_id", UUID.class),
                rs.getString("object_key"), rs.getLong("row_version")));
        if (rows.isEmpty()) return Optional.empty();
        ExpiredExportObject object = rows.getFirst();
        requireExportObjectNamespace(object);
        long leaseVersion = object.leaseVersion() + 1;
        int updated = jdbc.update("""
                update operation_export_job
                set status = 'EXPIRED', failure_reason = null,
                    row_version = row_version + 1, updated_at = now()
                where tenant_id = :tenantId and id = :id and row_version = :previousVersion
                  and object_key = :objectKey
                  and ((status = 'SUCCEEDED' and expires_at <= now())
                       or (status = 'EXPIRED' and updated_at < now() - interval '5 minutes'))
                """, new MapSqlParameterSource("tenantId", tenantId)
                .addValue("id", object.jobId()).addValue("previousVersion", object.leaseVersion())
                .addValue("objectKey", object.objectKey()));
        if (updated != 1) return Optional.empty();
        return Optional.of(object.withLeaseVersion(leaseVersion));
    }

    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public boolean finalizeExpired(ExpiredExportObject object) {
        databaseContext.apply(object.tenantId());
        int updated = jdbc.update("""
                update operation_export_job
                set status = 'EXPIRED', object_key = null, file_name = null, sha256 = null,
                    size_bytes = null, failure_reason = null,
                    row_version = row_version + 1, updated_at = now()
                where tenant_id = :tenantId and id = :id and status = 'EXPIRED'
                  and row_version = :leaseVersion and object_key = :objectKey
                """, new MapSqlParameterSource("tenantId", object.tenantId())
                .addValue("id", object.jobId()).addValue("leaseVersion", object.leaseVersion())
                .addValue("objectKey", object.objectKey()));
        if (updated != 1) return false;
        auditWriter.record("OPERATION_EXPORT_EXPIRED_CLEANED", "OPERATION_EXPORT_JOB", object.jobId(),
                "{\"status\":\"EXPIRED\",\"fileDeleted\":true}");
        return true;
    }

    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public void recordExpiryFailure(ExpiredExportObject object, RuntimeException failure) {
        databaseContext.apply(object.tenantId());
        String message = failure.getMessage() == null ? failure.getClass().getSimpleName() : failure.getMessage();
        message = message.replace('\r', ' ').replace('\n', ' ').trim();
        if (message.length() > 1000) message = message.substring(0, 1000);
        jdbc.update("""
                update operation_export_job
                set failure_reason = :failureReason, row_version = row_version + 1, updated_at = now()
                where tenant_id = :tenantId and id = :id and status = 'EXPIRED'
                  and row_version = :leaseVersion and object_key = :objectKey
                """, new MapSqlParameterSource("tenantId", object.tenantId())
                .addValue("id", object.jobId()).addValue("leaseVersion", object.leaseVersion())
                .addValue("objectKey", object.objectKey()).addValue("failureReason", message));
    }

    @Transactional(readOnly = true)
    public List<ExpiredExportObject> succeededObjectsForMaintenance(UUID tenantId, int batchSize) {
        databaseContext.apply(tenantId);
        int limit = Math.max(1, Math.min(batchSize, 500));
        List<ExpiredExportObject> objects = jdbc.query("""
                select id, tenant_id, object_key, row_version
                from operation_export_job
                where tenant_id = :tenantId and status = 'SUCCEEDED' and object_key is not null
                  and expires_at > now()
                order by updated_at desc, id
                limit :batchSize
                """, new MapSqlParameterSource("tenantId", tenantId).addValue("batchSize", limit),
                (rs, rowNum) -> new ExpiredExportObject(
                        rs.getObject("id", UUID.class), rs.getObject("tenant_id", UUID.class),
                        rs.getString("object_key"), rs.getLong("row_version")));
        objects.forEach(OperationExportJobTransactions::requireExportObjectNamespace);
        return objects;
    }

    private static void requireExportObjectNamespace(ExpiredExportObject object) {
        String prefix = object.tenantId() + "/operation-exports/" + object.jobId() + "/attempt-";
        if (object.objectKey() == null || !object.objectKey().startsWith(prefix)) {
            throw new IllegalArgumentException("导出对象键不属于作业安全命名空间");
        }
    }

    private static MapSqlParameterSource base(ClaimedJob job) {
        return new MapSqlParameterSource("tenantId", job.tenantId())
                .addValue("orgUnitId", job.orgUnitId())
                .addValue("businessDate", job.businessDate());
    }
}

record ClaimedJob(
        UUID id,
        UUID tenantId,
        String exportFormat,
        UUID hotelOrgUnitId,
        UUID orgUnitId,
        LocalDate businessDate,
        String filterSnapshot,
        String authorizationSnapshot,
        String sensitivityLevel,
        UUID requestedByAccountId,
        UUID traceId,
        long leaseVersion
) {
    ClaimedJob withLeaseVersion(long newLeaseVersion) {
        return new ClaimedJob(id, tenantId, exportFormat, hotelOrgUnitId, orgUnitId, businessDate,
                filterSnapshot, authorizationSnapshot, sensitivityLevel, requestedByAccountId,
                traceId, newLeaseVersion);
    }
}

record ExportData(String orgName, List<DetailRow> details, List<EvidenceRow> evidence) {
}

record ExportBudget(long rowCount, long variableBytes, long maxSingleBytes) {
}

class ExportLeaseLostException extends IllegalStateException {
    ExportLeaseLostException(String message) {
        super(message);
    }
}

enum CompletionReconciliation {
    COMMITTED_THIS_ATTEMPT,
    STILL_OWNED,
    LOST_LEASE,
    UNKNOWN
}

record CompletionState(String status, String objectKey, long rowVersion) {
}

record ExpiredExportObject(UUID jobId, UUID tenantId, String objectKey, long leaseVersion) {
    ExpiredExportObject withLeaseVersion(long newLeaseVersion) {
        return new ExpiredExportObject(jobId, tenantId, objectKey, newLeaseVersion);
    }
}
