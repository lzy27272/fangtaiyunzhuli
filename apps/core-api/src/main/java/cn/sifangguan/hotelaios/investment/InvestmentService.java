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
import java.sql.Timestamp;
import java.time.Instant;
import java.time.YearMonth;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;

import static cn.sifangguan.hotelaios.investment.InvestmentModels.AuditEntry;
import static cn.sifangguan.hotelaios.investment.InvestmentModels.CalculationResult;
import static cn.sifangguan.hotelaios.investment.InvestmentModels.CostParameterInput;
import static cn.sifangguan.hotelaios.investment.InvestmentModels.CostParameterView;
import static cn.sifangguan.hotelaios.investment.InvestmentModels.CreateCostParameterRequest;
import static cn.sifangguan.hotelaios.investment.InvestmentModels.CreateProjectRequest;
import static cn.sifangguan.hotelaios.investment.InvestmentModels.DownloadFile;
import static cn.sifangguan.hotelaios.investment.InvestmentModels.InvestmentProjectDetail;
import static cn.sifangguan.hotelaios.investment.InvestmentModels.InvestmentProjectSummary;
import static cn.sifangguan.hotelaios.investment.InvestmentModels.InvestmentVersionView;
import static cn.sifangguan.hotelaios.investment.InvestmentModels.PlanInput;
import static cn.sifangguan.hotelaios.investment.InvestmentModels.ScenarioResult;
import static cn.sifangguan.hotelaios.investment.InvestmentModels.UpdateCostParameterRequest;
import static cn.sifangguan.hotelaios.investment.InvestmentModels.UpdateDraftRequest;

@Service
public class InvestmentService {
    private static final DateTimeFormatter PROJECT_PERIOD = DateTimeFormatter.ofPattern("yyyyMM");
    private static final List<Integer> ALLOWED_OCCUPANCIES = List.of(80, 85, 90, 95);

    private final NamedParameterJdbcTemplate jdbc;
    private final TenantDatabaseContext databaseContext;
    private final AccessPolicy accessPolicy;
    private final AuditWriter auditWriter;
    private final ObjectMapper objectMapper;
    private final InvestmentCalculationEngine engine;
    private final InvestmentExportRenderer exportRenderer;

    public InvestmentService(
            NamedParameterJdbcTemplate jdbc,
            TenantDatabaseContext databaseContext,
            AccessPolicy accessPolicy,
            AuditWriter auditWriter,
            ObjectMapper objectMapper,
            InvestmentCalculationEngine engine,
            InvestmentExportRenderer exportRenderer
    ) {
        this.jdbc = jdbc;
        this.databaseContext = databaseContext;
        this.accessPolicy = accessPolicy;
        this.auditWriter = auditWriter;
        this.objectMapper = objectMapper;
        this.engine = engine;
        this.exportRenderer = exportRenderer;
    }

    @Transactional(readOnly = true)
    public List<InvestmentProjectSummary> projects(boolean includeArchived) {
        TenantPrincipal principal = requireInvestmentAccess("investment.read");
        return jdbc.query("""
                select project.id, project.project_no, project.name, project.lifecycle_status,
                       project.current_formal_version_id, project.updated_at,
                       latest.version_no, latest.lifecycle_status as version_status,
                       latest.calculation_snapshot::text as calculation_snapshot
                from investment_project project
                left join lateral (
                    select version_no, lifecycle_status, calculation_snapshot
                    from investment_plan_version version
                    where version.tenant_id = project.tenant_id and version.project_id = project.id
                    order by version.version_no desc limit 1
                ) latest on true
                where project.tenant_id = :tenantId
                  and (:includeArchived or project.lifecycle_status <> 'ARCHIVED')
                order by project.updated_at desc, project.project_no desc
                """, base(principal).addValue("includeArchived", includeArchived), (rs, rowNum) -> {
            CalculationResult result = calculation(rs.getString("calculation_snapshot"));
            ScenarioResult defaultScenario = defaultScenario(result);
            return new InvestmentProjectSummary(
                    rs.getObject("id", UUID.class),
                    rs.getString("project_no"),
                    rs.getString("name"),
                    rs.getString("lifecycle_status"),
                    numberOrNull(rs, "version_no"),
                    rs.getString("version_status"),
                    rs.getObject("current_formal_version_id", UUID.class),
                    defaultScenario == null ? null : defaultScenario.annualProfit(),
                    defaultScenario == null ? null : defaultScenario.paybackYears(),
                    defaultScenario == null ? null : defaultScenario.rating(),
                    instant(rs, "updated_at")
            );
        });
    }

    @Transactional(readOnly = true)
    public InvestmentProjectDetail project(UUID projectId) {
        TenantPrincipal principal = requireInvestmentAccess("investment.read");
        return projectDetail(principal, projectId);
    }

    @Transactional
    public InvestmentProjectDetail createProject(CreateProjectRequest request) {
        TenantPrincipal principal = requireInvestmentAccess("investment.manage");
        CostParameterView parameters = activeCostParameters(principal);
        PlanInput input = normalizedInput(request.input());
        CalculationResult calculation = engine.calculate(input, parameters);
        UUID projectId = UUID.randomUUID();
        UUID versionId = UUID.randomUUID();
        String name = request.projectName().trim();
        String projectNo = nextProjectNo(principal);
        String snapshot = json(calculation);
        String hash = planHash(name, input, parameters.id(), snapshot);

        jdbc.update("""
                insert into investment_project
                    (id, tenant_id, project_no, name, created_by, updated_by)
                values (:id, :tenantId, :projectNo, :name, :actorId, :actorId)
                """, base(principal)
                .addValue("id", projectId)
                .addValue("projectNo", projectNo)
                .addValue("name", name)
                .addValue("actorId", principal.actorId()));
        insertVersion(principal, versionId, projectId, 1, name, input, parameters.id(), snapshot, hash);
        audit("INVESTMENT_PROJECT_CREATED", "INVESTMENT_PROJECT", projectId,
                projectAudit(projectId, versionId, null, input, "DRAFT"));
        return projectDetail(principal, projectId);
    }

    @Transactional
    public InvestmentVersionView updateDraft(UUID versionId, UpdateDraftRequest request) {
        TenantPrincipal principal = requireInvestmentAccess("investment.manage");
        VersionRow existing = versionRow(principal, versionId, true);
        requireDraft(existing);
        if (existing.rowVersion() != request.expectedVersion()) throw stale();
        ensureProjectActive(principal, existing.projectId());
        CostParameterView parameters = costParameters(principal, existing.costParameterVersionId());
        PlanInput input = normalizedInput(request.input());
        CalculationResult calculation = engine.calculate(input, parameters);
        String name = request.projectName().trim();
        String snapshot = json(calculation);
        String hash = planHash(name, input, parameters.id(), snapshot);
        String origin = hasText(input.reviewedAnalysis()) ? "MANUAL_REVIEW" : "RULE_FALLBACK";

        int updated = jdbc.update("""
                update investment_plan_version
                set project_name_snapshot = :name,
                    rent_per_sqm_month = :rent,
                    property_area_sqm = :area,
                    property_fee_per_sqm_month = :propertyFee,
                    room_count = :rooms,
                    staff_count = :staff,
                    positioning = :positioning,
                    management_fee_rate = :managementRate,
                    selling_room_rate = :roomRate,
                    investment_total = :investmentTotal,
                    notes = :notes,
                    calculation_snapshot = cast(:snapshot as jsonb),
                    reviewed_analysis = :reviewedAnalysis,
                    analysis_origin = :analysisOrigin,
                    content_hash = :contentHash,
                    updated_by = :actorId,
                    row_version = row_version + 1
                where tenant_id = :tenantId and id = :id
                  and lifecycle_status = 'DRAFT' and row_version = :expectedVersion
                """, planParams(principal, versionId, name, input, snapshot, hash)
                .addValue("analysisOrigin", origin)
                .addValue("expectedVersion", request.expectedVersion()));
        if (updated != 1) throw stale();
        jdbc.update("""
                update investment_project
                set name = :name, updated_by = :actorId, row_version = row_version + 1
                where tenant_id = :tenantId and id = :projectId and lifecycle_status = 'ACTIVE'
                """, base(principal)
                .addValue("name", name)
                .addValue("actorId", principal.actorId())
                .addValue("projectId", existing.projectId()));
        audit("INVESTMENT_DRAFT_UPDATED", "INVESTMENT_PLAN_VERSION", versionId,
                projectAudit(existing.projectId(), versionId, existing.input(), input, "DRAFT"));
        return versionView(principal, versionId);
    }

    @Transactional
    public InvestmentVersionView confirm(UUID versionId, long expectedVersion) {
        TenantPrincipal principal = requireFormalConfirmer();
        VersionRow existing = versionRow(principal, versionId, true);
        requireDraft(existing);
        if (existing.rowVersion() != expectedVersion) throw stale();
        ensureProjectActive(principal, existing.projectId());
        CostParameterView parameters = costParameters(principal, existing.costParameterVersionId());
        CalculationResult calculation = engine.calculate(existing.input(), parameters);
        if (!calculation.formalConfirmationAllowed()) {
            String reasons = calculation.warnings().stream()
                    .filter(InvestmentModels.CalculationWarning::blocksFormalConfirmation)
                    .map(InvestmentModels.CalculationWarning::message)
                    .reduce((left, right) -> left + "；" + right)
                    .orElse("存在阻断性异常");
            throw new ResponseStatusException(HttpStatus.CONFLICT, "不能确认正式预测：" + reasons);
        }
        String snapshot = json(calculation);
        String hash = planHash(existing.projectName(), existing.input(), parameters.id(), snapshot);

        jdbc.update("""
                update investment_plan_version
                set lifecycle_status = 'HISTORICAL', updated_by = :actorId,
                    row_version = row_version + 1
                where tenant_id = :tenantId and project_id = :projectId
                  and lifecycle_status = 'FORMAL'
                """, base(principal)
                .addValue("actorId", principal.actorId())
                .addValue("projectId", existing.projectId()));
        int updated = jdbc.update("""
                update investment_plan_version
                set lifecycle_status = 'FORMAL', calculation_snapshot = cast(:snapshot as jsonb),
                    content_hash = :contentHash, confirmed_by = :actorId, confirmed_at = now(),
                    updated_by = :actorId, row_version = row_version + 1
                where tenant_id = :tenantId and id = :id
                  and lifecycle_status = 'DRAFT' and row_version = :expectedVersion
                """, base(principal)
                .addValue("id", versionId)
                .addValue("snapshot", snapshot)
                .addValue("contentHash", hash)
                .addValue("actorId", principal.actorId())
                .addValue("expectedVersion", expectedVersion));
        if (updated != 1) throw stale();
        jdbc.update("""
                update investment_project
                set current_formal_version_id = :versionId, name = :name,
                    updated_by = :actorId, row_version = row_version + 1
                where tenant_id = :tenantId and id = :projectId
                """, base(principal)
                .addValue("versionId", versionId)
                .addValue("name", existing.projectName())
                .addValue("actorId", principal.actorId())
                .addValue("projectId", existing.projectId()));
        audit("INVESTMENT_VERSION_CONFIRMED", "INVESTMENT_PLAN_VERSION", versionId,
                projectAudit(existing.projectId(), versionId, "DRAFT", "FORMAL", calculation));
        return versionView(principal, versionId);
    }

    @Transactional
    public InvestmentVersionView copyVersion(UUID versionId) {
        TenantPrincipal principal = requireInvestmentAccess("investment.manage");
        VersionRow source = versionRow(principal, versionId, true);
        ensureProjectActive(principal, source.projectId());
        lockProject(principal, source.projectId());
        CostParameterView parameters = activeCostParameters(principal);
        PlanInput copiedInput = new PlanInput(
                source.input().rentPerSqmMonth(),
                source.input().propertyAreaSqm(),
                source.input().propertyFeePerSqmMonth(),
                source.input().roomCount(),
                source.input().staffCount(),
                source.input().positioning(),
                source.input().managementFeeRate(),
                source.input().sellingRoomRate(),
                source.input().investmentTotal(),
                source.input().notes(),
                null
        );
        int versionNo = nextVersionNo(principal, source.projectId());
        UUID copyId = UUID.randomUUID();
        CalculationResult calculation = engine.calculate(copiedInput, parameters);
        String snapshot = json(calculation);
        String hash = planHash(source.projectName(), copiedInput, parameters.id(), snapshot);
        insertVersion(principal, copyId, source.projectId(), versionNo, source.projectName(),
                copiedInput, parameters.id(), snapshot, hash);
        audit("INVESTMENT_VERSION_COPIED", "INVESTMENT_PLAN_VERSION", copyId,
                projectAudit(source.projectId(), copyId, versionId, parameters.id(), "DRAFT"));
        return versionView(principal, copyId);
    }

    @Transactional
    public InvestmentProjectDetail setArchived(UUID projectId, boolean archived, long expectedVersion) {
        TenantPrincipal principal = requireInvestmentAccess("investment.manage");
        String status = archived ? "ARCHIVED" : "ACTIVE";
        int updated = jdbc.update("""
                update investment_project
                set lifecycle_status = :status,
                    archived_by = case when :archived then :actorId else null end,
                    archived_at = case when :archived then now() else null end,
                    updated_by = :actorId, row_version = row_version + 1
                where tenant_id = :tenantId and id = :id and row_version = :expectedVersion
                """, base(principal)
                .addValue("status", status)
                .addValue("archived", archived)
                .addValue("actorId", principal.actorId())
                .addValue("id", projectId)
                .addValue("expectedVersion", expectedVersion));
        if (updated != 1) throw stale();
        audit(archived ? "INVESTMENT_PROJECT_ARCHIVED" : "INVESTMENT_PROJECT_RESTORED",
                "INVESTMENT_PROJECT", projectId, projectAudit(projectId, null, null, null, status));
        return projectDetail(principal, projectId);
    }

    @Transactional(readOnly = true)
    public List<CostParameterView> costParameterVersions() {
        TenantPrincipal principal = requireInvestmentAccess("investment.read");
        return jdbc.query("""
                select * from investment_cost_parameter_version
                where tenant_id = :tenantId
                order by version_no desc
                """, base(principal), this::mapCostParameters);
    }

    @Transactional
    public CostParameterView createCostParameters(CreateCostParameterRequest request) {
        TenantPrincipal principal = requirePlatformAdmin();
        accessPolicy.requirePermission("investment.configure");
        int versionNo = jdbc.queryForObject("""
                select coalesce(max(version_no), 0) + 1
                from investment_cost_parameter_version where tenant_id = :tenantId
                """, base(principal), Integer.class);
        UUID id = UUID.randomUUID();
        CostParameterInput input = request.input();
        jdbc.update("""
                insert into investment_cost_parameter_version (
                    id, tenant_id, version_no, lifecycle_status, salary_per_person_month,
                    consumables_per_room_night, linen_per_room_night, utilities_per_room_night,
                    three_diamond_operations_per_room_night,
                    four_diamond_operations_per_room_night, content_hash, created_by
                ) values (
                    :id, :tenantId, :versionNo, 'DRAFT', :salary, :consumables, :linen, :utilities,
                    :threeDiamond, :fourDiamond, :contentHash, :actorId
                )
                """, costParams(principal, id, versionNo, input)
                .addValue("actorId", principal.actorId()));
        audit("INVESTMENT_COST_PARAMETER_CREATED", "INVESTMENT_COST_PARAMETER_VERSION", id,
                projectAudit(null, id, null, input, "DRAFT"));
        return costParameters(principal, id);
    }

    @Transactional
    public CostParameterView updateCostParameters(UUID id, UpdateCostParameterRequest request) {
        TenantPrincipal principal = requirePlatformAdmin();
        accessPolicy.requirePermission("investment.configure");
        CostParameterView existing = costParameters(principal, id);
        if (!"DRAFT".equals(existing.lifecycleStatus())) throw conflict("只有成本参数草稿可以修改");
        if (existing.rowVersion() != request.expectedVersion()) throw stale();
        CostParameterInput input = request.input();
        int updated = jdbc.update("""
                update investment_cost_parameter_version
                set salary_per_person_month = :salary,
                    consumables_per_room_night = :consumables,
                    linen_per_room_night = :linen,
                    utilities_per_room_night = :utilities,
                    three_diamond_operations_per_room_night = :threeDiamond,
                    four_diamond_operations_per_room_night = :fourDiamond,
                    content_hash = :contentHash,
                    row_version = row_version + 1
                where tenant_id = :tenantId and id = :id
                  and lifecycle_status = 'DRAFT' and row_version = :expectedVersion
                """, costParams(principal, id, existing.versionNo(), input)
                .addValue("expectedVersion", request.expectedVersion()));
        if (updated != 1) throw stale();
        audit("INVESTMENT_COST_PARAMETER_UPDATED", "INVESTMENT_COST_PARAMETER_VERSION", id,
                projectAudit(null, id, existing.asInput(), input, "DRAFT"));
        return costParameters(principal, id);
    }

    @Transactional
    public CostParameterView activateCostParameters(UUID id, long expectedVersion) {
        TenantPrincipal principal = requireCeo();
        accessPolicy.requirePermission("investment.parameter-confirm");
        CostParameterView target = costParameters(principal, id);
        if (!"DRAFT".equals(target.lifecycleStatus())) throw conflict("只有成本参数草稿可以确认启用");
        if (target.rowVersion() != expectedVersion) throw stale();
        jdbc.update("""
                update investment_cost_parameter_version
                set lifecycle_status = 'RETIRED', retired_at = now(), row_version = row_version + 1
                where tenant_id = :tenantId and lifecycle_status = 'ACTIVE'
                """, base(principal));
        int updated = jdbc.update("""
                update investment_cost_parameter_version
                set lifecycle_status = 'ACTIVE', activated_by = :actorId, activated_at = now(),
                    row_version = row_version + 1
                where tenant_id = :tenantId and id = :id
                  and lifecycle_status = 'DRAFT' and row_version = :expectedVersion
                """, base(principal)
                .addValue("id", id)
                .addValue("actorId", principal.actorId())
                .addValue("expectedVersion", expectedVersion));
        if (updated != 1) throw stale();
        audit("INVESTMENT_COST_PARAMETER_ACTIVATED", "INVESTMENT_COST_PARAMETER_VERSION", id,
                projectAudit(null, id, "DRAFT", "ACTIVE", target.asInput()));
        return costParameters(principal, id);
    }

    @Transactional(readOnly = true)
    public List<AuditEntry> auditEntries(UUID projectId) {
        TenantPrincipal principal = requireInvestmentAccess("investment.audit");
        requireProject(principal, projectId, false);
        return auditEntriesInternal(principal, projectId);
    }

    @Transactional
    public DownloadFile exportXlsx(UUID versionId) {
        TenantPrincipal principal = requireInvestmentAccess("investment.export");
        InvestmentVersionView version = versionView(principal, versionId);
        ProjectRow project = requireProject(principal, version.projectId(), false);
        List<AuditEntry> audit = auditEntriesInternal(principal, project.id());
        byte[] bytes = exportRenderer.renderXlsx(project.projectNo(), version, audit);
        audit("INVESTMENT_EXCEL_EXPORTED", "INVESTMENT_PLAN_VERSION", versionId,
                projectAudit(project.id(), versionId, null, null, "XLSX"));
        return new DownloadFile(investmentReportFileName(version.projectName(), "xlsx"),
                "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", bytes);
    }

    @Transactional
    public DownloadFile exportPdf(UUID versionId, List<Integer> occupancies) {
        TenantPrincipal principal = requireInvestmentAccess("investment.export");
        List<Integer> selected = normalizeOccupancies(occupancies);
        InvestmentVersionView version = versionView(principal, versionId);
        ProjectRow project = requireProject(principal, version.projectId(), false);
        byte[] bytes = exportRenderer.renderPdf(project.projectNo(), version, selected);
        audit("INVESTMENT_PDF_EXPORTED", "INVESTMENT_PLAN_VERSION", versionId,
                projectAudit(project.id(), versionId, null, selected, "PDF"));
        return new DownloadFile(investmentReportFileName(version.projectName(), "pdf"),
                "application/pdf", bytes);
    }

    private InvestmentProjectDetail projectDetail(TenantPrincipal principal, UUID projectId) {
        ProjectRow project = requireProject(principal, projectId, false);
        List<InvestmentVersionView> versions = jdbc.query("""
                select version.*, parameter.version_no as parameter_version_no,
                       parameter.lifecycle_status as parameter_status,
                       parameter.salary_per_person_month, parameter.consumables_per_room_night,
                       parameter.linen_per_room_night, parameter.utilities_per_room_night,
                       parameter.three_diamond_operations_per_room_night,
                       parameter.four_diamond_operations_per_room_night,
                       parameter.row_version as parameter_row_version,
                       parameter.created_by as parameter_created_by,
                       parameter.activated_by as parameter_activated_by,
                       parameter.created_at as parameter_created_at,
                       parameter.activated_at as parameter_activated_at,
                       (version.id = project.current_formal_version_id) as current_formal
                from investment_plan_version version
                join investment_project project
                  on project.tenant_id = version.tenant_id and project.id = version.project_id
                join investment_cost_parameter_version parameter
                  on parameter.tenant_id = version.tenant_id and parameter.id = version.cost_parameter_version_id
                where version.tenant_id = :tenantId and version.project_id = :projectId
                order by version.version_no desc
                """, base(principal).addValue("projectId", projectId), this::mapVersionView);
        return new InvestmentProjectDetail(
                project.id(), project.projectNo(), project.name(), project.lifecycleStatus(),
                project.currentFormalVersionId(), project.rowVersion(), project.createdAt(),
                project.updatedAt(), versions
        );
    }

    private InvestmentVersionView versionView(TenantPrincipal principal, UUID versionId) {
        List<InvestmentVersionView> matches = jdbc.query("""
                select version.*, parameter.version_no as parameter_version_no,
                       parameter.lifecycle_status as parameter_status,
                       parameter.salary_per_person_month, parameter.consumables_per_room_night,
                       parameter.linen_per_room_night, parameter.utilities_per_room_night,
                       parameter.three_diamond_operations_per_room_night,
                       parameter.four_diamond_operations_per_room_night,
                       parameter.row_version as parameter_row_version,
                       parameter.created_by as parameter_created_by,
                       parameter.activated_by as parameter_activated_by,
                       parameter.created_at as parameter_created_at,
                       parameter.activated_at as parameter_activated_at,
                       (version.id = project.current_formal_version_id) as current_formal
                from investment_plan_version version
                join investment_project project
                  on project.tenant_id = version.tenant_id and project.id = version.project_id
                join investment_cost_parameter_version parameter
                  on parameter.tenant_id = version.tenant_id and parameter.id = version.cost_parameter_version_id
                where version.tenant_id = :tenantId and version.id = :id
                """, base(principal).addValue("id", versionId), this::mapVersionView);
        if (matches.isEmpty()) throw notFound("投资测算版本不存在");
        return matches.getFirst();
    }

    private InvestmentVersionView mapVersionView(ResultSet rs, int rowNum) throws SQLException {
        CostParameterView parameters = mapCostParameters(rs, rowNum);
        PlanInput input = new PlanInput(
                rs.getBigDecimal("rent_per_sqm_month"),
                rs.getBigDecimal("property_area_sqm"),
                rs.getBigDecimal("property_fee_per_sqm_month"),
                rs.getInt("room_count"),
                rs.getInt("staff_count"),
                rs.getString("positioning"),
                rs.getBigDecimal("management_fee_rate"),
                rs.getBigDecimal("selling_room_rate"),
                rs.getBigDecimal("investment_total"),
                rs.getString("notes"),
                rs.getString("reviewed_analysis")
        );
        return new InvestmentVersionView(
                rs.getObject("id", UUID.class),
                rs.getObject("project_id", UUID.class),
                rs.getInt("version_no"),
                rs.getString("lifecycle_status"),
                rs.getString("project_name_snapshot"),
                input,
                parameters,
                calculation(rs.getString("calculation_snapshot")),
                rs.getString("analysis_origin"),
                rs.getLong("row_version"),
                rs.getObject("created_by", UUID.class),
                rs.getObject("confirmed_by", UUID.class),
                instant(rs, "created_at"),
                instant(rs, "updated_at"),
                instant(rs, "confirmed_at"),
                rs.getBoolean("current_formal")
        );
    }

    /**
     * Read-only access for the professional calculator. It intentionally
     * resolves the same active tenant parameter version as formal plans.
     */
    @Transactional(readOnly = true)
    public CostParameterView activeCostParametersForProfessionalCalculator() {
        TenantPrincipal principal = requireInvestmentAccess("investment.manage");
        return activeCostParameters(principal);
    }

    private CostParameterView activeCostParameters(TenantPrincipal principal) {
        List<CostParameterView> values = jdbc.query("""
                select * from investment_cost_parameter_version
                where tenant_id = :tenantId and lifecycle_status = 'ACTIVE'
                """, base(principal), this::mapCostParameters);
        if (values.isEmpty()) throw conflict("当前租户尚无生效的投资成本参数版本");
        return values.getFirst();
    }

    private CostParameterView costParameters(TenantPrincipal principal, UUID id) {
        List<CostParameterView> values = jdbc.query("""
                select * from investment_cost_parameter_version
                where tenant_id = :tenantId and id = :id
                """, base(principal).addValue("id", id), this::mapCostParameters);
        if (values.isEmpty()) throw notFound("投资成本参数版本不存在");
        return values.getFirst();
    }

    private CostParameterView mapCostParameters(ResultSet rs, int rowNum) throws SQLException {
        UUID parameterId = hasColumn(rs, "cost_parameter_version_id")
                ? rs.getObject("cost_parameter_version_id", UUID.class)
                : rs.getObject("id", UUID.class);
        return new CostParameterView(
                parameterId,
                hasColumn(rs, "parameter_version_no") ? rs.getInt("parameter_version_no") : rs.getInt("version_no"),
                hasColumn(rs, "parameter_status") ? rs.getString("parameter_status") : rs.getString("lifecycle_status"),
                rs.getBigDecimal("salary_per_person_month"),
                rs.getBigDecimal("consumables_per_room_night"),
                rs.getBigDecimal("linen_per_room_night"),
                rs.getBigDecimal("utilities_per_room_night"),
                rs.getBigDecimal("three_diamond_operations_per_room_night"),
                rs.getBigDecimal("four_diamond_operations_per_room_night"),
                hasColumn(rs, "parameter_row_version") ? rs.getLong("parameter_row_version") : rs.getLong("row_version"),
                hasColumn(rs, "parameter_created_by")
                        ? rs.getObject("parameter_created_by", UUID.class)
                        : rs.getObject("created_by", UUID.class),
                hasColumn(rs, "parameter_activated_by")
                        ? rs.getObject("parameter_activated_by", UUID.class)
                        : rs.getObject("activated_by", UUID.class),
                hasColumn(rs, "parameter_created_at")
                        ? instant(rs, "parameter_created_at") : instant(rs, "created_at"),
                hasColumn(rs, "parameter_activated_at")
                        ? instant(rs, "parameter_activated_at") : instant(rs, "activated_at")
        );
    }

    private static boolean hasColumn(ResultSet rs, String name) {
        try {
            rs.findColumn(name);
            return true;
        } catch (SQLException ignored) {
            return false;
        }
    }

    private VersionRow versionRow(TenantPrincipal principal, UUID versionId, boolean forUpdate) {
        String sql = """
                select * from investment_plan_version
                where tenant_id = :tenantId and id = :id
                """ + (forUpdate ? " for update" : "");
        List<VersionRow> rows = jdbc.query(sql, base(principal).addValue("id", versionId), (rs, rowNum) ->
                new VersionRow(
                        rs.getObject("id", UUID.class),
                        rs.getObject("project_id", UUID.class),
                        rs.getInt("version_no"),
                        rs.getString("lifecycle_status"),
                        rs.getString("project_name_snapshot"),
                        new PlanInput(
                                rs.getBigDecimal("rent_per_sqm_month"),
                                rs.getBigDecimal("property_area_sqm"),
                                rs.getBigDecimal("property_fee_per_sqm_month"),
                                rs.getInt("room_count"),
                                rs.getInt("staff_count"),
                                rs.getString("positioning"),
                                rs.getBigDecimal("management_fee_rate"),
                                rs.getBigDecimal("selling_room_rate"),
                                rs.getBigDecimal("investment_total"),
                                rs.getString("notes"),
                                rs.getString("reviewed_analysis")
                        ),
                        rs.getObject("cost_parameter_version_id", UUID.class),
                        rs.getLong("row_version")
                ));
        if (rows.isEmpty()) throw notFound("投资测算版本不存在");
        return rows.getFirst();
    }

    private ProjectRow requireProject(TenantPrincipal principal, UUID projectId, boolean forUpdate) {
        String sql = """
                select id, project_no, name, lifecycle_status, current_formal_version_id,
                       row_version, created_at, updated_at
                from investment_project
                where tenant_id = :tenantId and id = :id
                """ + (forUpdate ? " for update" : "");
        List<ProjectRow> rows = jdbc.query(sql, base(principal).addValue("id", projectId), (rs, rowNum) ->
                new ProjectRow(
                        rs.getObject("id", UUID.class),
                        rs.getString("project_no"),
                        rs.getString("name"),
                        rs.getString("lifecycle_status"),
                        rs.getObject("current_formal_version_id", UUID.class),
                        rs.getLong("row_version"),
                        instant(rs, "created_at"),
                        instant(rs, "updated_at")
                ));
        if (rows.isEmpty()) throw notFound("投资测算项目不存在");
        return rows.getFirst();
    }

    private void ensureProjectActive(TenantPrincipal principal, UUID projectId) {
        if (!"ACTIVE".equals(requireProject(principal, projectId, false).lifecycleStatus())) {
            throw conflict("已归档项目不能继续修改或复制方案");
        }
    }

    private void lockProject(TenantPrincipal principal, UUID projectId) {
        requireProject(principal, projectId, true);
    }

    private void insertVersion(
            TenantPrincipal principal,
            UUID versionId,
            UUID projectId,
            int versionNo,
            String projectName,
            PlanInput input,
            UUID costParameterVersionId,
            String snapshot,
            String hash
    ) {
        jdbc.update("""
                insert into investment_plan_version (
                    id, tenant_id, project_id, version_no, lifecycle_status,
                    project_name_snapshot, rent_per_sqm_month, property_area_sqm,
                    property_fee_per_sqm_month, room_count, staff_count, positioning,
                    management_fee_rate, selling_room_rate, investment_total, notes,
                    cost_parameter_version_id, calculation_snapshot, reviewed_analysis,
                    analysis_origin, content_hash, created_by, updated_by
                ) values (
                    :id, :tenantId, :projectId, :versionNo, 'DRAFT',
                    :name, :rent, :area, :propertyFee, :rooms, :staff, :positioning,
                    :managementRate, :roomRate, :investmentTotal, :notes,
                    :costParameterVersionId, cast(:snapshot as jsonb), :reviewedAnalysis,
                    :analysisOrigin, :contentHash, :actorId, :actorId
                )
                """, planParams(principal, versionId, projectName, input, snapshot, hash)
                .addValue("projectId", projectId)
                .addValue("versionNo", versionNo)
                .addValue("costParameterVersionId", costParameterVersionId)
                .addValue("analysisOrigin", hasText(input.reviewedAnalysis()) ? "MANUAL_REVIEW" : "RULE_FALLBACK"));
    }

    private MapSqlParameterSource planParams(
            TenantPrincipal principal,
            UUID id,
            String projectName,
            PlanInput input,
            String snapshot,
            String hash
    ) {
        return base(principal)
                .addValue("id", id)
                .addValue("name", projectName)
                .addValue("rent", input.rentPerSqmMonth())
                .addValue("area", input.propertyAreaSqm())
                .addValue("propertyFee", input.propertyFeePerSqmMonth())
                .addValue("rooms", input.roomCount())
                .addValue("staff", input.staffCount())
                .addValue("positioning", InvestmentCalculationEngine.normalizePositioning(input.positioning()))
                .addValue("managementRate", input.managementFeeRate())
                .addValue("roomRate", input.sellingRoomRate())
                .addValue("investmentTotal", input.investmentTotal())
                .addValue("notes", blankToNull(input.notes()))
                .addValue("reviewedAnalysis", blankToNull(input.reviewedAnalysis()))
                .addValue("snapshot", snapshot)
                .addValue("contentHash", hash)
                .addValue("actorId", principal.actorId());
    }

    private MapSqlParameterSource costParams(
            TenantPrincipal principal,
            UUID id,
            int versionNo,
            CostParameterInput input
    ) {
        String source = input.salaryPerPersonMonth() + "|" + input.consumablesPerRoomNight() + "|"
                + input.linenPerRoomNight() + "|" + input.utilitiesPerRoomNight() + "|"
                + input.threeDiamondOperationsPerRoomNight() + "|"
                + input.fourDiamondOperationsPerRoomNight();
        return base(principal)
                .addValue("id", id)
                .addValue("versionNo", versionNo)
                .addValue("salary", input.salaryPerPersonMonth())
                .addValue("consumables", input.consumablesPerRoomNight())
                .addValue("linen", input.linenPerRoomNight())
                .addValue("utilities", input.utilitiesPerRoomNight())
                .addValue("threeDiamond", input.threeDiamondOperationsPerRoomNight())
                .addValue("fourDiamond", input.fourDiamondOperationsPerRoomNight())
                .addValue("contentHash", InvestmentHashing.sha256(source));
    }

    private String nextProjectNo(TenantPrincipal principal) {
        String period = YearMonth.now().format(PROJECT_PERIOD);
        Integer number = jdbc.queryForObject("""
                insert into investment_project_number_counter (tenant_id, year_month, next_number)
                values (:tenantId, :period, 1)
                on conflict (tenant_id, year_month)
                do update set next_number = investment_project_number_counter.next_number + 1
                returning next_number
                """, base(principal).addValue("period", period), Integer.class);
        return "INV-" + period + "-" + String.format(Locale.ROOT, "%04d", number);
    }

    private int nextVersionNo(TenantPrincipal principal, UUID projectId) {
        Integer value = jdbc.queryForObject("""
                select coalesce(max(version_no), 0) + 1
                from investment_plan_version
                where tenant_id = :tenantId and project_id = :projectId
                """, base(principal).addValue("projectId", projectId), Integer.class);
        return value == null ? 1 : value;
    }

    private List<AuditEntry> auditEntriesInternal(TenantPrincipal principal, UUID projectId) {
        return jdbc.query("""
                select id, actor_id, action, resource_type, resource_id,
                       coalesce(after_data, '{}'::jsonb)::text as details, created_at
                from audit_log
                where tenant_id = :tenantId
                  and (resource_id = :projectId or after_data ->> 'projectId' = :projectIdText)
                  and resource_type like 'INVESTMENT_%'
                order by created_at desc
                limit 500
                """, base(principal)
                .addValue("projectId", projectId)
                .addValue("projectIdText", projectId.toString()), (rs, rowNum) -> new AuditEntry(
                rs.getObject("id", UUID.class),
                rs.getObject("actor_id", UUID.class),
                rs.getString("action"),
                rs.getString("resource_type"),
                rs.getObject("resource_id", UUID.class),
                rs.getString("details"),
                instant(rs, "created_at")
        ));
    }

    private TenantPrincipal requireInvestmentAccess(String permission) {
        accessPolicy.requirePermission(permission);
        TenantPrincipal principal = prepare();
        if (!principal.hasRole("CEO") && !principal.hasRole("PLATFORM_ADMIN")) {
            throw new AccessDeniedException("投资测算仅向集团CEO和平台管理员开放");
        }
        return principal;
    }

    private TenantPrincipal requireFormalConfirmer() {
        TenantPrincipal principal = requireInvestmentAccess("investment.confirm");
        if (!principal.hasRole("CEO") && !principal.hasRole("PLATFORM_ADMIN")) {
            throw new AccessDeniedException("当前角色不能确认正式预测");
        }
        return principal;
    }

    private TenantPrincipal requirePlatformAdmin() {
        TenantPrincipal principal = prepare();
        if (!principal.hasRole("PLATFORM_ADMIN")) {
            throw new AccessDeniedException("只有平台管理员可以维护成本参数草稿");
        }
        return principal;
    }

    private TenantPrincipal requireCeo() {
        TenantPrincipal principal = prepare();
        if (!principal.hasRole("CEO")) {
            throw new AccessDeniedException("只有集团CEO可以确认启用成本参数");
        }
        return principal;
    }

    private TenantPrincipal prepare() {
        TenantPrincipal principal = accessPolicy.principal();
        databaseContext.apply(principal.tenantId());
        return principal;
    }

    private MapSqlParameterSource base(TenantPrincipal principal) {
        return new MapSqlParameterSource("tenantId", principal.tenantId());
    }

    private PlanInput normalizedInput(PlanInput input) {
        return new PlanInput(
                input.rentPerSqmMonth(),
                input.propertyAreaSqm(),
                input.propertyFeePerSqmMonth(),
                input.roomCount(),
                input.staffCount(),
                InvestmentCalculationEngine.normalizePositioning(input.positioning()),
                input.managementFeeRate(),
                input.sellingRoomRate(),
                input.investmentTotal(),
                blankToNull(input.notes()),
                blankToNull(input.reviewedAnalysis())
        );
    }

    private void requireDraft(VersionRow version) {
        if (!"DRAFT".equals(version.lifecycleStatus())) {
            throw conflict("正式或历史版本不可修改，请复制为新草稿");
        }
    }

    private String planHash(String name, PlanInput input, UUID parameterId, String snapshot) {
        return InvestmentHashing.sha256(name + "|" + json(input) + "|" + parameterId + "|" + snapshot);
    }

    private CalculationResult calculation(String value) {
        if (!hasText(value)) return null;
        try {
            return objectMapper.readValue(value, CalculationResult.class);
        } catch (JsonProcessingException exception) {
            throw new IllegalStateException("投资测算结果快照无法读取", exception);
        }
    }

    private String json(Object value) {
        try {
            return objectMapper.writeValueAsString(value);
        } catch (JsonProcessingException exception) {
            throw new IllegalStateException("投资测算数据无法序列化", exception);
        }
    }

    private void audit(String action, String resourceType, UUID resourceId, Map<String, Object> details) {
        auditWriter.record(action, resourceType, resourceId, json(details));
    }

    private static Map<String, Object> projectAudit(
            UUID projectId,
            UUID versionId,
            Object before,
            Object after,
            Object state
    ) {
        Map<String, Object> values = new LinkedHashMap<>();
        if (projectId != null) values.put("projectId", projectId.toString());
        if (versionId != null) values.put("versionId", versionId.toString());
        if (before != null) values.put("before", before);
        if (after != null) values.put("after", after);
        if (state != null) values.put("state", state);
        return values;
    }

    private static ScenarioResult defaultScenario(CalculationResult result) {
        if (result == null || result.scenarios() == null) return null;
        return result.scenarios().stream()
                .filter(item -> item.occupancyRate().compareTo(new BigDecimal("0.85")) == 0)
                .findFirst()
                .orElse(null);
    }

    private static List<Integer> normalizeOccupancies(List<Integer> occupancies) {
        List<Integer> selected = occupancies == null || occupancies.isEmpty()
                ? ALLOWED_OCCUPANCIES
                : occupancies.stream().distinct().sorted().toList();
        if (selected.isEmpty() || selected.stream().anyMatch(value -> !ALLOWED_OCCUPANCIES.contains(value))) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "出租率只能选择80、85、90或95");
        }
        return selected;
    }

    static String investmentReportFileName(String projectName, String extension) {
        String cleaned = projectName == null ? "" : projectName.trim()
                .replaceAll("[\\\\/:*?\"<>|\\p{Cntrl}]", "")
                .replaceAll("[. ]+$", "");
        if (cleaned.isBlank()) cleaned = "投资项目";
        String baseName = cleaned.endsWith("投资测算")
                ? cleaned
                : cleaned + (cleaned.endsWith("项目") ? "" : "项目") + "投资测算";
        return baseName + "." + extension;
    }

    private static Integer numberOrNull(ResultSet rs, String column) throws SQLException {
        int value = rs.getInt(column);
        return rs.wasNull() ? null : value;
    }

    private static Instant instant(ResultSet rs, String column) throws SQLException {
        Timestamp value = rs.getTimestamp(column);
        return value == null ? null : value.toInstant();
    }

    private static String blankToNull(String value) {
        return hasText(value) ? value.trim() : null;
    }

    private static boolean hasText(String value) {
        return value != null && !value.isBlank();
    }

    private static ResponseStatusException notFound(String message) {
        return new ResponseStatusException(HttpStatus.NOT_FOUND, message);
    }

    private static ResponseStatusException conflict(String message) {
        return new ResponseStatusException(HttpStatus.CONFLICT, message);
    }

    private static ResponseStatusException stale() {
        return conflict("数据已被其他操作更新，请刷新后重试");
    }

    private record VersionRow(
            UUID id,
            UUID projectId,
            int versionNo,
            String lifecycleStatus,
            String projectName,
            PlanInput input,
            UUID costParameterVersionId,
            long rowVersion
    ) {
    }

    private record ProjectRow(
            UUID id,
            String projectNo,
            String name,
            String lifecycleStatus,
            UUID currentFormalVersionId,
            long rowVersion,
            Instant createdAt,
            Instant updatedAt
    ) {
    }
}
