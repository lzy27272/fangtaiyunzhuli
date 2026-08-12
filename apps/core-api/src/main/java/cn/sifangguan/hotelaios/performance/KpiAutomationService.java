package cn.sifangguan.hotelaios.performance;

import cn.sifangguan.hotelaios.shared.context.TenantContext;
import cn.sifangguan.hotelaios.shared.context.TenantPrincipal;
import cn.sifangguan.hotelaios.shared.db.TenantDatabaseContext;
import cn.sifangguan.hotelaios.shared.events.TenantSystemAccountResolver;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;

import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.time.ZoneId;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

@Service
public class KpiAutomationService {
    private static final ZoneId BUSINESS_ZONE = ZoneId.of("Asia/Shanghai");

    private final TenantSystemAccountResolver systemAccountResolver;
    private final TenantDatabaseContext databaseContext;
    private final NamedParameterJdbcTemplate jdbc;
    private final KpiAssessmentService assessmentService;
    private final KpiInspectionService inspectionService;
    private final TransactionTemplate transactionTemplate;
    private final ObjectMapper objectMapper;

    public KpiAutomationService(
            TenantSystemAccountResolver systemAccountResolver,
            TenantDatabaseContext databaseContext,
            NamedParameterJdbcTemplate jdbc,
            KpiAssessmentService assessmentService,
            KpiInspectionService inspectionService,
            org.springframework.transaction.PlatformTransactionManager transactionManager,
            ObjectMapper objectMapper
    ) {
        this.systemAccountResolver = systemAccountResolver;
        this.databaseContext = databaseContext;
        this.jdbc = jdbc;
        this.assessmentService = assessmentService;
        this.inspectionService = inspectionService;
        this.transactionTemplate = new TransactionTemplate(transactionManager);
        this.objectMapper = objectMapper;
    }

    public void processTenant(UUID tenantId, UUID correlationId) {
        UUID actorId = systemAccountResolver.resolveOrCreate(tenantId);
        TenantPrincipal previous = TenantContext.current().orElse(null);
        TenantPrincipal principal = new TenantPrincipal(
                tenantId,
                actorId,
                "SYSTEM_AUTOMATION",
                Set.of("SYSTEM_AUTOMATION"),
                Set.of("kpi.scorecard.generate", "kpi.inspection.submit", "kpi.inspection.read-team",
                        "kpi.inspection.verify", "notification.read"),
                Set.of(),
                Set.of(),
                true,
                correlationId
        );
        TenantContext.set(principal);
        try {
            processInspection(tenantId, correlationId);
            processScorecards(tenantId, correlationId, OffsetDateTime.now(BUSINESS_ZONE));
        } finally {
            if (previous == null) TenantContext.clear();
            else TenantContext.set(previous);
        }
    }

    private void processInspection(UUID tenantId, UUID correlationId) {
        String runKey = "kpi:inspection-sla:" + LocalDate.now(BUSINESS_ZONE);
        if (!claimRun(tenantId, runKey, "INSPECTION_SLA", correlationId, Map.of())) return;
        try {
            KpiInspectionService.ProcessResult result = inspectionService.processSlaBreaches();
            finishRun(tenantId, runKey, Map.of(
                    "missingInspections", result.missingInspections(),
                    "confirmationBreaches", result.confirmationBreaches(),
                    "actionBreaches", result.actionBreaches(),
                    "closeBreaches", result.closeBreaches()
            ));
        } catch (RuntimeException exception) {
            failRun(tenantId, runKey, exception);
            throw exception;
        }
    }

    private void processScorecards(UUID tenantId, UUID correlationId, OffsetDateTime now) {
        LocalDate today = now.toLocalDate();
        if (now.getHour() < 2) return;
        LocalDate month;
        Integer weekNo;
        String generationType;
        String jobType;
        if (today.getDayOfMonth() == 1) {
            month = today.minusMonths(1).withDayOfMonth(1);
            weekNo = null;
            generationType = "ALL";
            jobType = "MONTH_SCORECARD";
        } else if (Set.of(8, 15, 22).contains(today.getDayOfMonth())) {
            month = today.withDayOfMonth(1);
            weekNo = today.getDayOfMonth() == 8 ? 1 : today.getDayOfMonth() == 15 ? 2 : 3;
            generationType = "WEEK";
            jobType = "WEEK_SCORECARD";
        } else {
            return;
        }
        String runKey = "kpi:scorecard:" + month + ":" + generationType + ":" + (weekNo == null ? "MONTH" : weekNo);
        if (!claimRun(tenantId, runKey, jobType, correlationId,
                Map.of("monthStart", month, "generationType", generationType,
                        "weekNo", weekNo == null ? "" : weekNo))) return;
        try {
            Map<String, Object> result = assessmentService.generateAsSystem(
                    new KpiModels.GeneratePeriod(month, generationType, weekNo, "系统固定四周自动生成"));
            finishRun(tenantId, runKey, result);
        } catch (RuntimeException exception) {
            failRun(tenantId, runKey, exception);
            throw exception;
        }
    }

    private boolean claimRun(
            UUID tenantId,
            String runKey,
            String jobType,
            UUID correlationId,
            Map<String, ?> payload
    ) {
        Boolean claimed = transactionTemplate.execute(status -> {
            databaseContext.apply(tenantId);
            int inserted = jdbc.update("""
                    insert into kpi_automation_run
                        (id, tenant_id, run_key, job_type, status, payload, correlation_id)
                    values (:id, :tenantId, :runKey, :jobType, 'RUNNING', cast(:payload as jsonb), :correlationId)
                    on conflict (tenant_id, run_key) do nothing
                    """, new MapSqlParameterSource("tenantId", tenantId).addValue("id", UUID.randomUUID())
                    .addValue("runKey", runKey).addValue("jobType", jobType)
                    .addValue("payload", json(payload)).addValue("correlationId", correlationId));
            return inserted == 1;
        });
        return Boolean.TRUE.equals(claimed);
    }

    private void finishRun(UUID tenantId, String runKey, Map<String, ?> result) {
        transactionTemplate.executeWithoutResult(status -> {
            databaseContext.apply(tenantId);
            jdbc.update("""
                    update kpi_automation_run
                    set status = 'SUCCEEDED', result = cast(:result as jsonb), finished_at = now()
                    where tenant_id = :tenantId and run_key = :runKey
                    """, new MapSqlParameterSource("tenantId", tenantId).addValue("runKey", runKey)
                    .addValue("result", json(result)));
        });
    }

    private void failRun(UUID tenantId, String runKey, RuntimeException exception) {
        transactionTemplate.executeWithoutResult(status -> {
            databaseContext.apply(tenantId);
            jdbc.update("""
                    update kpi_automation_run
                    set status = 'FAILED', error_message = :error, finished_at = now()
                    where tenant_id = :tenantId and run_key = :runKey
                    """, new MapSqlParameterSource("tenantId", tenantId).addValue("runKey", runKey)
                    .addValue("error", String.valueOf(exception.getMessage())));
        });
    }

    private String json(Object value) {
        try {
            return objectMapper.writeValueAsString(value == null ? Map.of() : value);
        } catch (JsonProcessingException exception) {
            throw new IllegalArgumentException("自动任务内容无法序列化", exception);
        }
    }
}
