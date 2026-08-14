package cn.sifangguan.hotelaios.investment;

import cn.sifangguan.hotelaios.shared.audit.AuditWriter;
import cn.sifangguan.hotelaios.shared.context.TenantPrincipal;
import cn.sifangguan.hotelaios.shared.db.TenantDatabaseContext;
import cn.sifangguan.hotelaios.shared.security.AccessDeniedException;
import cn.sifangguan.hotelaios.shared.security.AccessPolicy;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

import java.math.BigDecimal;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static cn.sifangguan.hotelaios.investment.InvestmentModels.CostParameterView;
import static cn.sifangguan.hotelaios.investment.InvestmentModels.DownloadFile;
import static cn.sifangguan.hotelaios.investment.ProfessionalInvestmentModels.ProfessionalCalculationResult;
import static cn.sifangguan.hotelaios.investment.ProfessionalInvestmentModels.ProfessionalPlanInput;
import static cn.sifangguan.hotelaios.investment.ProfessionalInvestmentModels.ProfessionalReportHistoryRecord;
import static cn.sifangguan.hotelaios.investment.ProfessionalInvestmentModels.ProfessionalReportHistorySummary;
import static cn.sifangguan.hotelaios.investment.ProfessionalInvestmentModels.ProfessionalReportRequest;
import static cn.sifangguan.hotelaios.investment.ProfessionalInvestmentModels.UpdateProfessionalReportRequest;

/**
 * Professional calculator and investor-report archive. Each generated report
 * keeps its input and calculation snapshot so it can be viewed or downloaded
 * later without depending on subsequently changed cost parameters.
 */
@Service
public class ProfessionalInvestmentReportService {
    private final AccessPolicy accessPolicy;
    private final TenantDatabaseContext databaseContext;
    private final AuditWriter auditWriter;
    private final ObjectMapper objectMapper;
    private final NamedParameterJdbcTemplate jdbc;
    private final ProfessionalInvestmentCalculationEngine calculationEngine;
    private final ProfessionalInvestmentReportRenderer reportRenderer;
    private final InvestmentService investmentService;

    public ProfessionalInvestmentReportService(
            AccessPolicy accessPolicy,
            TenantDatabaseContext databaseContext,
            AuditWriter auditWriter,
            ObjectMapper objectMapper,
            NamedParameterJdbcTemplate jdbc,
            ProfessionalInvestmentCalculationEngine calculationEngine,
            ProfessionalInvestmentReportRenderer reportRenderer,
            InvestmentService investmentService
    ) {
        this.accessPolicy = accessPolicy;
        this.databaseContext = databaseContext;
        this.auditWriter = auditWriter;
        this.objectMapper = objectMapper;
        this.jdbc = jdbc;
        this.calculationEngine = calculationEngine;
        this.reportRenderer = reportRenderer;
        this.investmentService = investmentService;
    }

    @Transactional(readOnly = true)
    public ProfessionalCalculationResult calculate(ProfessionalReportRequest request) {
        requireAccess("investment.manage");
        ProfessionalPlanInput input = normalize(request.input());
        CostParameterView parameters = investmentService.activeCostParametersForProfessionalCalculator();
        return calculationEngine.calculate(input, parameters);
    }

    @Transactional(readOnly = true)
    public List<ProfessionalReportHistorySummary> histories() {
        TenantPrincipal principal = requireAccess("investment.read");
        return jdbc.query("""
                select report.id, report.project_name, report.input_snapshot::text as input_snapshot,
                       report.calculation_snapshot::text as calculation_snapshot,
                       parameter.version_no as cost_parameter_version_no,
                       report.generation_count, report.row_version, report.created_at,
                       report.updated_at, report.last_generated_at
                from investment_professional_report_history report
                join investment_cost_parameter_version parameter
                  on parameter.tenant_id = report.tenant_id and parameter.id = report.cost_parameter_version_id
                where report.tenant_id = :tenantId and report.lifecycle_status = 'ACTIVE'
                order by report.updated_at desc, report.created_at desc
                """, base(principal), this::mapHistorySummary);
    }

    @Transactional(readOnly = true)
    public ProfessionalReportHistoryRecord history(UUID reportId) {
        return history(requireAccess("investment.read"), reportId);
    }

    /** Creates a history record and calculates the snapshot that will be exported. */
    @Transactional
    public ProfessionalReportHistoryRecord createHistory(ProfessionalReportRequest request) {
        TenantPrincipal principal = requireAccess("investment.export");
        return createHistory(principal, normalize(request.input()));
    }

    /** Updates an existing history record from the edited professional form. */
    @Transactional
    public ProfessionalReportHistoryRecord updateHistory(UUID reportId, UpdateProfessionalReportRequest request) {
        TenantPrincipal principal = requireAccess("investment.export");
        ProfessionalReportHistoryRecord existing = history(principal, reportId);
        if (existing.rowVersion() != request.expectedVersion()) throw stale();

        ProfessionalPlanInput input = normalize(request.input());
        CostParameterView parameters = investmentService.activeCostParametersForProfessionalCalculator();
        ProfessionalCalculationResult calculation = calculationEngine.calculate(input, parameters);
        int updated = jdbc.update("""
                update investment_professional_report_history
                set project_name = :projectName,
                    input_snapshot = cast(:inputSnapshot as jsonb),
                    calculation_snapshot = cast(:calculationSnapshot as jsonb),
                    cost_parameter_version_id = :costParameterVersionId,
                    generation_count = generation_count + 1,
                    row_version = row_version + 1,
                    updated_by = :actorId,
                    last_generated_at = now()
                where tenant_id = :tenantId and id = :id and lifecycle_status = 'ACTIVE'
                  and row_version = :expectedVersion
                """, base(principal)
                .addValue("id", reportId)
                .addValue("projectName", input.projectName())
                .addValue("inputSnapshot", json(input))
                .addValue("calculationSnapshot", json(calculation))
                .addValue("costParameterVersionId", parameters.id())
                .addValue("actorId", principal.actorId())
                .addValue("expectedVersion", request.expectedVersion()));
        if (updated != 1) throw stale();
        ProfessionalReportHistoryRecord saved = history(principal, reportId);
        audit("INVESTMENT_PROFESSIONAL_REPORT_REGENERATED", reportId, auditData(input, calculation, saved.generationCount()));
        return saved;
    }

    @Transactional
    public void deleteHistory(UUID reportId, long expectedVersion) {
        TenantPrincipal principal = requireAccess("investment.manage");
        ProfessionalReportHistoryRecord existing = history(principal, reportId);
        if (existing.rowVersion() != expectedVersion) throw stale();
        int updated = jdbc.update("""
                update investment_professional_report_history
                set lifecycle_status = 'DELETED', deleted_by = :actorId, deleted_at = now(),
                    row_version = row_version + 1
                where tenant_id = :tenantId and id = :id and lifecycle_status = 'ACTIVE'
                  and row_version = :expectedVersion
                """, base(principal).addValue("id", reportId)
                .addValue("actorId", principal.actorId())
                .addValue("expectedVersion", expectedVersion));
        if (updated != 1) throw stale();
        audit("INVESTMENT_PROFESSIONAL_REPORT_DELETED", reportId, Map.of(
                "projectName", existing.projectName(), "generationCount", existing.generationCount()
        ));
    }

    /** Kept for existing clients: exporting a stateless request now also creates a history record. */
    @Transactional
    public DownloadFile exportPdf(ProfessionalReportRequest request) {
        TenantPrincipal principal = requireAccess("investment.export");
        return exportHistoryPdf(principal, createHistory(principal, normalize(request.input())));
    }

    @Transactional
    public DownloadFile exportHistoryPdf(UUID reportId) {
        TenantPrincipal principal = requireAccess("investment.export");
        return exportHistoryPdf(principal, history(principal, reportId));
    }

    private ProfessionalReportHistoryRecord createHistory(TenantPrincipal principal, ProfessionalPlanInput input) {
        CostParameterView parameters = investmentService.activeCostParametersForProfessionalCalculator();
        ProfessionalCalculationResult calculation = calculationEngine.calculate(input, parameters);
        UUID reportId = UUID.randomUUID();
        jdbc.update("""
                insert into investment_professional_report_history (
                    id, tenant_id, project_name, input_snapshot, calculation_snapshot,
                    cost_parameter_version_id, generation_count, created_by, updated_by, last_generated_at
                ) values (
                    :id, :tenantId, :projectName, cast(:inputSnapshot as jsonb), cast(:calculationSnapshot as jsonb),
                    :costParameterVersionId, 1, :actorId, :actorId, now()
                )
                """, base(principal)
                .addValue("id", reportId)
                .addValue("projectName", input.projectName())
                .addValue("inputSnapshot", json(input))
                .addValue("calculationSnapshot", json(calculation))
                .addValue("costParameterVersionId", parameters.id())
                .addValue("actorId", principal.actorId()));
        ProfessionalReportHistoryRecord saved = history(principal, reportId);
        audit("INVESTMENT_PROFESSIONAL_REPORT_CREATED", reportId, auditData(input, calculation, saved.generationCount()));
        return saved;
    }

    private DownloadFile exportHistoryPdf(TenantPrincipal principal, ProfessionalReportHistoryRecord report) {
        byte[] bytes = reportRenderer.render(report.input(), report.calculation());
        audit("INVESTMENT_PROFESSIONAL_REPORT_EXPORTED", report.id(), Map.of(
                "projectName", report.projectName(), "generationCount", report.generationCount()
        ));
        return new DownloadFile(fileName(report.projectName()), "application/pdf", bytes);
    }

    private TenantPrincipal requireAccess(String permission) {
        accessPolicy.requirePermission(permission);
        TenantPrincipal principal = accessPolicy.principal();
        databaseContext.apply(principal.tenantId());
        if (!principal.hasRole("CEO") && !principal.hasRole("PLATFORM_ADMIN")) {
            throw new AccessDeniedException("投资测算专业版仅向集团 CEO 和平台管理员开放");
        }
        return principal;
    }

    private ProfessionalReportHistoryRecord history(TenantPrincipal principal, UUID reportId) {
        List<ProfessionalReportHistoryRecord> rows = jdbc.query("""
                select report.id, report.project_name, report.input_snapshot::text as input_snapshot,
                       report.calculation_snapshot::text as calculation_snapshot,
                       parameter.version_no as cost_parameter_version_no,
                       report.generation_count, report.row_version, report.created_at,
                       report.updated_at, report.last_generated_at
                from investment_professional_report_history report
                join investment_cost_parameter_version parameter
                  on parameter.tenant_id = report.tenant_id and parameter.id = report.cost_parameter_version_id
                where report.tenant_id = :tenantId and report.id = :id and report.lifecycle_status = 'ACTIVE'
                """, base(principal).addValue("id", reportId), this::mapHistory);
        if (rows.isEmpty()) throw notFound("历史投资分析书记录不存在或已删除");
        return rows.getFirst();
    }

    private ProfessionalReportHistorySummary mapHistorySummary(ResultSet rs, int rowNum) throws SQLException {
        ProfessionalReportHistoryRecord report = mapHistory(rs, rowNum);
        return new ProfessionalReportHistorySummary(
                report.id(), report.projectName(), report.input().roomCount(), report.input().initialInvestment(),
                report.calculation().irr(), report.calculation().npv(), report.costParameterVersionNo(),
                report.generationCount(), report.rowVersion(), report.createdAt(), report.updatedAt(), report.lastGeneratedAt()
        );
    }

    private ProfessionalReportHistoryRecord mapHistory(ResultSet rs, int rowNum) throws SQLException {
        return new ProfessionalReportHistoryRecord(
                rs.getObject("id", UUID.class),
                rs.getString("project_name"),
                fromJson(rs.getString("input_snapshot"), ProfessionalPlanInput.class, "专业版投资分析书输入快照"),
                fromJson(rs.getString("calculation_snapshot"), ProfessionalCalculationResult.class, "专业版投资分析书测算快照"),
                rs.getInt("cost_parameter_version_no"),
                rs.getInt("generation_count"),
                rs.getLong("row_version"),
                instant(rs, "created_at"),
                instant(rs, "updated_at"),
                instant(rs, "last_generated_at")
        );
    }

    private ProfessionalPlanInput normalize(ProfessionalPlanInput input) {
        return new ProfessionalPlanInput(
                input.projectName().trim(), blankToNull(input.projectLocation()), blankToNull(input.brandName()), blankToNull(input.operatorName()),
                input.roomCount(), input.propertyAreaSqm(), input.rentPerSqmMonth(), input.propertyFeePerSqmMonth(), input.leaseTermYears(),
                input.occupancyRate(), input.managementFeeRate(), input.staffCount(), input.projectPositioning(), input.initialInvestment(),
                input.prepaidRentMonths(), input.depositMonths(), input.discountRate(), input.adrPlan(), input.maintenanceUpgrades(), input.reportNarrative()
        );
    }

    private Map<String, Object> auditData(ProfessionalPlanInput input, ProfessionalCalculationResult calculation, int generationCount) {
        Map<String, Object> values = new LinkedHashMap<>();
        values.put("projectName", input.projectName());
        values.put("roomCount", input.roomCount());
        values.put("leaseTermYears", input.leaseTermYears());
        values.put("initialInvestment", input.initialInvestment());
        values.put("irr", calculation.irr());
        values.put("npv", calculation.npv());
        values.put("generationCount", generationCount);
        return values;
    }

    private void audit(String action, UUID reportId, Map<String, Object> details) {
        auditWriter.record(action, "INVESTMENT_PROFESSIONAL_REPORT", reportId, json(details));
    }

    private MapSqlParameterSource base(TenantPrincipal principal) {
        return new MapSqlParameterSource("tenantId", principal.tenantId());
    }

    private <T> T fromJson(String value, Class<T> target, String label) {
        try {
            return objectMapper.readValue(value, target);
        } catch (JsonProcessingException exception) {
            throw new IllegalStateException(label + "无法读取", exception);
        }
    }

    private String json(Object value) {
        try {
            return objectMapper.writeValueAsString(value);
        } catch (JsonProcessingException exception) {
            throw new IllegalStateException("投资测算专业版数据无法序列化", exception);
        }
    }

    private Instant instant(ResultSet rs, String column) throws SQLException {
        return rs.getTimestamp(column).toInstant();
    }

    private String fileName(String projectName) {
        String cleaned = projectName.trim().replaceAll("[\\\\/:*?\"<>|\\p{Cntrl}]", "").replaceAll("[. ]+$", "");
        if (cleaned.isBlank()) cleaned = "酒店项目";
        return cleaned + "投资分析书_专业版.pdf";
    }

    private String blankToNull(String value) {
        if (value == null) return null;
        String cleaned = value.trim();
        return cleaned.isEmpty() ? null : cleaned;
    }

    private static ResponseStatusException notFound(String message) {
        return new ResponseStatusException(HttpStatus.NOT_FOUND, message);
    }

    private static ResponseStatusException stale() {
        return new ResponseStatusException(HttpStatus.CONFLICT, "数据已被其他操作更新，请刷新后重试");
    }
}
