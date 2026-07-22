package cn.sifangguan.hotelaios.dailyoperations;

import cn.sifangguan.hotelaios.dailyoperations.OperationIntelligenceModels.DailyOperationOverview;
import cn.sifangguan.hotelaios.dailyoperations.OperationIntelligenceModels.OperationMetric;
import cn.sifangguan.hotelaios.shared.context.TenantPrincipal;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.util.HexFormat;
import java.util.List;
import java.util.UUID;

/**
 * Savepoint boundary for snapshot assembly. A failed read rolls back to the
 * savepoint so the outer command can durably retain a FAILED snapshot record.
 */
@Component
class OperationSnapshotPayloadBuilder {
    private final DailyOperationReadService readService;
    private final NamedParameterJdbcTemplate jdbc;
    private final OperationScopeService scopes;
    private final ObjectMapper objectMapper;

    OperationSnapshotPayloadBuilder(
            DailyOperationReadService readService,
            NamedParameterJdbcTemplate jdbc,
            OperationScopeService scopes,
            ObjectMapper objectMapper
    ) {
        this.readService = readService;
        this.jdbc = jdbc;
        this.scopes = scopes;
        this.objectMapper = objectMapper;
    }

    @Transactional(propagation = Propagation.NESTED)
    GenerationResult generate(
            TenantPrincipal principal,
            UUID snapshotId,
            UUID hotelOrgUnitId,
            LocalDate businessDate,
            OffsetDateTime generatedAt
    ) {
        DailyOperationOverview realtime = readService.realTimeOverview(hotelOrgUnitId, businessDate);
        DailyOperationOverview immutableOverview = new DailyOperationOverview(
                realtime.orgUnitId(), realtime.orgName(), realtime.businessDate(), realtime.timezone(),
                "SNAPSHOT", snapshotId, generatedAt, realtime.dataUpdatedAt(),
                realtime.unavailableSources(), realtime.metrics(), realtime.issues(),
                realtime.actionItemCount(), realtime.unresolvedIssueCount(), realtime.overdueCount(),
                realtime.pendingTaskCandidateCount());
        String payload = json(immutableOverview);
        String completeness = completeness(realtime.metrics());
        insertMetrics(principal, snapshotId, realtime.metrics());
        int changed = jdbc.update("""
                update daily_operation_snapshot
                set status = 'GENERATED', completeness_status = :completeness,
                    payload_snapshot = cast(:payload as jsonb), content_hash = :contentHash,
                    generated_at = :generatedAt, row_version = row_version + 1
                where tenant_id = :tenantId and id = :id and status = 'GENERATING'
                """, scopes.base(principal)
                .addValue("id", snapshotId)
                .addValue("completeness", completeness)
                .addValue("payload", payload)
                .addValue("contentHash", hash(payload))
                .addValue("generatedAt", generatedAt));
        if (changed != 1) {
            throw new IllegalStateException("快照生成状态已变化");
        }
        return new GenerationResult(immutableOverview, completeness);
    }

    private void insertMetrics(
            TenantPrincipal principal,
            UUID snapshotId,
            List<OperationMetric> metrics
    ) {
        for (OperationMetric metric : metrics) {
            ObjectNode source = objectMapper.createObjectNode();
            source.put("label", metric.label());
            if (metric.source() != null) source.put("source", metric.source());
            String sourceJson = source.toString();
            jdbc.update("""
                    insert into daily_operation_snapshot_metric
                        (id, tenant_id, snapshot_id, metric_code, metric_value, metric_unit,
                         quality_status, source_snapshot, content_hash)
                    values
                        (:id, :tenantId, :snapshotId, :metricCode, :metricValue, :metricUnit,
                         :qualityStatus, cast(:sourceSnapshot as jsonb), :contentHash)
                    """, scopes.base(principal)
                    .addValue("id", UUID.randomUUID())
                    .addValue("snapshotId", snapshotId)
                    .addValue("metricCode", metric.code())
                    .addValue("metricValue", metric.available() ? metric.value() : null)
                    .addValue("metricUnit", metric.unit())
                    .addValue("qualityStatus", metric.available() ? "AVAILABLE" : "NO_DATA")
                    .addValue("sourceSnapshot", sourceJson)
                    .addValue("contentHash", hash(metric.code() + ":" + sourceJson
                            + ":" + (metric.value() == null ? "" : metric.value().toPlainString()))));
        }
    }

    private String json(Object value) {
        try {
            return objectMapper.writeValueAsString(value);
        } catch (Exception exception) {
            throw new IllegalArgumentException("无法生成日运营快照JSON", exception);
        }
    }

    private static String completeness(List<OperationMetric> metrics) {
        if (metrics.isEmpty()) return "COMPLETE";
        long available = metrics.stream().filter(OperationMetric::available).count();
        if (available == 0) return "UNAVAILABLE";
        return available == metrics.size() ? "COMPLETE" : "PARTIAL";
    }

    private static String hash(String value) {
        try {
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256")
                    .digest(value.getBytes(StandardCharsets.UTF_8)));
        } catch (Exception exception) {
            throw new IllegalStateException("SHA-256不可用", exception);
        }
    }

    record GenerationResult(DailyOperationOverview overview, String completeness) {
    }
}
