package cn.sifangguan.hotelaios.performance;

import cn.sifangguan.hotelaios.shared.audit.AuditWriter;
import cn.sifangguan.hotelaios.shared.context.TenantPrincipal;
import cn.sifangguan.hotelaios.shared.db.TenantDatabaseContext;
import cn.sifangguan.hotelaios.shared.security.AccessPolicy;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;

@Service
public class KpiCatalogService {
    private final NamedParameterJdbcTemplate jdbc;
    private final TenantDatabaseContext databaseContext;
    private final AccessPolicy accessPolicy;
    private final AuditWriter auditWriter;
    private final ObjectMapper objectMapper;

    public KpiCatalogService(
            NamedParameterJdbcTemplate jdbc,
            TenantDatabaseContext databaseContext,
            AccessPolicy accessPolicy,
            AuditWriter auditWriter,
            ObjectMapper objectMapper
    ) {
        this.jdbc = jdbc;
        this.databaseContext = databaseContext;
        this.accessPolicy = accessPolicy;
        this.auditWriter = auditWriter;
        this.objectMapper = objectMapper;
    }

    @Transactional(readOnly = true)
    public List<Map<String, Object>> metrics() {
        accessPolicy.requirePermission("kpi.metric.read");
        TenantPrincipal principal = prepare();
        return jdbc.queryForList("""
                select d.id, d.code, d.name, d.unit, d.value_type, d.aggregation, d.status,
                       v.id as version_id, v.version_no, v.lifecycle_status, v.source_type,
                       v.supported_dimensions, v.direction, v.sensitivity_level,
                       v.effective_from, v.effective_to
                from metric_definition d
                left join lateral (
                    select * from metric_definition_version candidate
                    where candidate.tenant_id = d.tenant_id and candidate.metric_definition_id = d.id
                    order by candidate.version_no desc limit 1
                ) v on true
                where d.tenant_id = :tenantId
                order by d.code
                """, base(principal));
    }

    @Transactional
    public Map<String, Object> createMetricVersion(KpiModels.CreateMetricVersion request) {
        accessPolicy.requirePermission("kpi.metric.manage");
        TenantPrincipal principal = prepare();
        String code = request.code().trim().toUpperCase(Locale.ROOT);
        UUID definitionId = findMetricDefinition(principal, code);
        if (definitionId == null) {
            definitionId = UUID.randomUUID();
            jdbc.update("""
                    insert into metric_definition
                        (id, tenant_id, code, name, unit, value_type, aggregation, description)
                    values (:id, :tenantId, :code, :name, :unit, :valueType, :aggregation, :description)
                    """, base(principal)
                    .addValue("id", definitionId)
                    .addValue("code", code)
                    .addValue("name", request.name().trim())
                    .addValue("unit", request.unit().trim())
                    .addValue("valueType", normalize(request.valueType(), "DECIMAL"))
                    .addValue("aggregation", normalize(request.aggregation(), "LAST"))
                    .addValue("description", "KPI统一指标库"));
        }
        Integer nextVersion = jdbc.queryForObject("""
                select coalesce(max(version_no), 0) + 1 from metric_definition_version
                where tenant_id = :tenantId and metric_definition_id = :definitionId
                """, base(principal).addValue("definitionId", definitionId), Integer.class);
        UUID versionId = UUID.randomUUID();
        String dimensions = json(request.supportedDimensions(), "[]");
        String calculation = json(request.calculation(), "{}");
        String hash = KpiHashing.sha256(code + "|" + nextVersion + "|" + dimensions + "|" + calculation);
        jdbc.update("""
                insert into metric_definition_version
                    (id, tenant_id, metric_definition_id, version_no, source_type,
                     supported_dimensions, aggregation, direction, calculation,
                     sensitivity_level, effective_from, content_hash, created_by)
                values
                    (:id, :tenantId, :definitionId, :versionNo, :sourceType,
                     cast(:dimensions as jsonb), :aggregation, :direction, cast(:calculation as jsonb),
                     :sensitivity, :effectiveFrom, :hash, :actorId)
                """, base(principal)
                .addValue("id", versionId)
                .addValue("definitionId", definitionId)
                .addValue("versionNo", nextVersion)
                .addValue("sourceType", normalize(request.sourceType(), "MANUAL"))
                .addValue("dimensions", dimensions)
                .addValue("aggregation", normalize(request.aggregation(), "LAST"))
                .addValue("direction", normalize(request.direction(), "HIGHER_BETTER"))
                .addValue("calculation", calculation)
                .addValue("sensitivity", normalize(request.sensitivityLevel(), "INTERNAL"))
                .addValue("effectiveFrom", request.effectiveFrom())
                .addValue("hash", hash)
                .addValue("actorId", principal.actorId()));
        auditWriter.record("KPI_METRIC_VERSION_CREATED", "METRIC_DEFINITION_VERSION", versionId,
                json(Map.of("code", code, "versionNo", nextVersion)));
        return Map.of("definitionId", definitionId, "versionId", versionId, "code", code,
                "versionNo", nextVersion, "lifecycleStatus", "DRAFT");
    }

    @Transactional
    public Map<String, Object> publishMetricVersion(UUID versionId, KpiModels.PublishMetricVersion request) {
        accessPolicy.requirePermission("kpi.metric.manage");
        TenantPrincipal principal = prepare();
        int updated = jdbc.update("""
                update metric_definition_version
                set lifecycle_status = 'PUBLISHED', effective_from = coalesce(:effectiveFrom, current_date),
                    published_by = :actorId, published_at = now()
                where tenant_id = :tenantId and id = :id and lifecycle_status = 'DRAFT'
                """, base(principal).addValue("id", versionId)
                .addValue("effectiveFrom", request.effectiveFrom())
                .addValue("actorId", principal.actorId()));
        if (updated != 1) throw conflict("指标版本不存在或已发布");
        auditWriter.record("KPI_METRIC_VERSION_PUBLISHED", "METRIC_DEFINITION_VERSION", versionId, "{}");
        return Map.of("id", versionId, "lifecycleStatus", "PUBLISHED");
    }

    @Transactional
    public Map<String, Object> recordFact(KpiModels.RecordMetricFact request) {
        accessPolicy.requirePermission("kpi.metric.manage");
        TenantPrincipal principal = prepare();
        if (request.orgUnitId() != null) accessPolicy.requireOrgScope(request.orgUnitId());
        requirePublishedMetric(principal, request.metricVersionId());
        if (request.supersedesFactId() != null) requireFact(principal, request.supersedesFactId());
        UUID id = UUID.randomUUID();
        String snapshot = json(request.sourceSnapshot(), "{}");
        String state = normalize(request.dataState(), "AVAILABLE");
        if ("AVAILABLE".equals(state) && request.value() == null
                && (request.numerator() == null || request.denominator() == null)) {
            throw new IllegalArgumentException("可用指标事实必须包含value或完整分子分母");
        }
        int revisionNo = 1;
        if (request.supersedesFactId() != null) {
            Integer prior = jdbc.queryForObject("""
                    select revision_no from kpi_metric_fact where tenant_id = :tenantId and id = :id
                    """, base(principal).addValue("id", request.supersedesFactId()), Integer.class);
            revisionNo = prior == null ? 2 : prior + 1;
        }
        String hashSource = request.metricVersionId() + "|" + request.businessDate() + "|"
                + request.value() + "|" + request.numerator() + "|" + request.denominator() + "|" + snapshot;
        jdbc.update("""
                insert into kpi_metric_fact
                    (id, tenant_id, metric_version_id, org_unit_id, employee_id,
                     position_assignment_id, channel_code, business_time, business_date,
                     period_start, period_end, value, numerator, denominator, data_state,
                     source_type, source_record_id, source_snapshot, content_hash, revision_no,
                     supersedes_fact_id, idempotency_key, created_by)
                values
                    (:id, :tenantId, :metricVersionId, :orgUnitId, :employeeId,
                     :assignmentId, :channelCode, now(), :businessDate,
                     :periodStart, :periodEnd, :value, :numerator, :denominator, :dataState,
                     :sourceType, :sourceRecordId, cast(:snapshot as jsonb), :hash, :revisionNo,
                     :supersedesFactId, :idempotencyKey, :actorId)
                on conflict (tenant_id, idempotency_key) do nothing
                """, base(principal)
                .addValue("id", id)
                .addValue("metricVersionId", request.metricVersionId())
                .addValue("orgUnitId", request.orgUnitId())
                .addValue("employeeId", request.employeeId())
                .addValue("assignmentId", request.positionAssignmentId())
                .addValue("channelCode", blankToNull(request.channelCode()))
                .addValue("businessDate", request.businessDate())
                .addValue("periodStart", request.periodStart())
                .addValue("periodEnd", request.periodEnd())
                .addValue("value", request.value())
                .addValue("numerator", request.numerator())
                .addValue("denominator", request.denominator())
                .addValue("dataState", state)
                .addValue("sourceType", normalize(request.sourceType(), "MANUAL"))
                .addValue("sourceRecordId", request.sourceRecordId())
                .addValue("snapshot", snapshot)
                .addValue("hash", KpiHashing.sha256(hashSource))
                .addValue("revisionNo", revisionNo)
                .addValue("supersedesFactId", request.supersedesFactId())
                .addValue("idempotencyKey", request.idempotencyKey())
                .addValue("actorId", principal.actorId()));
        UUID persistedId = jdbc.queryForObject("""
                select id from kpi_metric_fact where tenant_id = :tenantId and idempotency_key = :key
                """, base(principal).addValue("key", request.idempotencyKey()), UUID.class);
        auditWriter.record("KPI_METRIC_FACT_RECORDED", "KPI_METRIC_FACT", persistedId,
                json(Map.of("state", state, "revisionNo", revisionNo)));
        return Map.of("id", persistedId, "dataState", state, "revisionNo", revisionNo);
    }

    @Transactional(readOnly = true)
    public List<Map<String, Object>> facts(UUID metricVersionId, LocalDate from, LocalDate to, UUID orgUnitId) {
        accessPolicy.requirePermission("kpi.metric.read");
        TenantPrincipal principal = prepare();
        if (orgUnitId != null) accessPolicy.requireOrgScope(orgUnitId);
        return jdbc.queryForList("""
                select f.id, f.metric_version_id, d.code as metric_code, f.org_unit_id,
                       f.employee_id, f.position_assignment_id, f.channel_code, f.business_date,
                       f.period_start, f.period_end, f.value, f.numerator, f.denominator,
                       f.data_state, f.source_type, f.source_record_id, f.revision_no,
                       f.supersedes_fact_id, f.created_at
                from kpi_metric_fact f
                join metric_definition_version v on v.tenant_id = f.tenant_id and v.id = f.metric_version_id
                join metric_definition d on d.tenant_id = v.tenant_id and d.id = v.metric_definition_id
                where f.tenant_id = :tenantId
                  and (cast(:metricVersionId as uuid) is null or f.metric_version_id = :metricVersionId)
                  and (cast(:fromDate as date) is null or f.business_date >= :fromDate)
                  and (cast(:toDate as date) is null or f.business_date <= :toDate)
                  and (cast(:orgUnitId as uuid) is null or f.org_unit_id = :orgUnitId)
                order by f.business_date desc, f.created_at desc
                limit 1000
                """, base(principal)
                .addValue("metricVersionId", metricVersionId)
                .addValue("fromDate", from)
                .addValue("toDate", to)
                .addValue("orgUnitId", orgUnitId));
    }

    @Transactional
    public Map<String, Object> createPolicy(KpiModels.CreatePolicy request) {
        accessPolicy.requirePermission("kpi.policy.manage");
        TenantPrincipal principal = prepare();
        UUID id = UUID.randomUUID();
        jdbc.update("""
                insert into kpi_compensation_policy_definition
                    (id, tenant_id, code, name, owner_org_unit_id, created_by)
                values (:id, :tenantId, :code, :name, :ownerOrgUnitId, :actorId)
                """, base(principal).addValue("id", id)
                .addValue("code", request.code().trim().toUpperCase(Locale.ROOT))
                .addValue("name", request.name().trim())
                .addValue("ownerOrgUnitId", request.ownerOrgUnitId())
                .addValue("actorId", principal.actorId()));
        auditWriter.record("KPI_POLICY_CREATED", "KPI_COMPENSATION_POLICY", id, "{}");
        return Map.of("id", id, "code", request.code().trim().toUpperCase(Locale.ROOT));
    }

    @Transactional
    public Map<String, Object> createPolicyVersion(UUID policyId, KpiModels.CreatePolicyVersion request) {
        accessPolicy.requirePermission("kpi.policy.manage");
        TenantPrincipal principal = prepare();
        requirePolicy(principal, policyId);
        Integer versionNo = jdbc.queryForObject("""
                select coalesce(max(version_no), 0) + 1 from kpi_compensation_policy_version
                where tenant_id = :tenantId and policy_id = :policyId
                """, base(principal).addValue("policyId", policyId), Integer.class);
        UUID id = UUID.randomUUID();
        String scoreBands = json(request.scoreBands(), "[]");
        String attendanceBands = json(request.attendanceBands(), "[]");
        String zeroRules = json(request.zeroBonusRules(), "[]");
        String rounding = json(request.roundingPolicy(), "{\"scoreScale\":2,\"moneyScale\":2}");
        jdbc.update("""
                insert into kpi_compensation_policy_version
                    (id, tenant_id, policy_id, version_no, score_bands, attendance_bands,
                     zero_bonus_rules, rounding_policy, effective_month, expires_month,
                     content_hash, created_by)
                values
                    (:id, :tenantId, :policyId, :versionNo, cast(:scoreBands as jsonb),
                     cast(:attendanceBands as jsonb), cast(:zeroRules as jsonb), cast(:rounding as jsonb),
                     :effectiveMonth, :expiresMonth, :hash, :actorId)
                """, base(principal).addValue("id", id).addValue("policyId", policyId)
                .addValue("versionNo", versionNo).addValue("scoreBands", scoreBands)
                .addValue("attendanceBands", attendanceBands).addValue("zeroRules", zeroRules)
                .addValue("rounding", rounding).addValue("effectiveMonth", request.effectiveMonth())
                .addValue("expiresMonth", request.expiresMonth())
                .addValue("hash", KpiHashing.sha256(scoreBands + attendanceBands + zeroRules + rounding))
                .addValue("actorId", principal.actorId()));
        auditWriter.record("KPI_POLICY_VERSION_CREATED", "KPI_COMPENSATION_POLICY_VERSION", id, "{}");
        return Map.of("id", id, "versionNo", versionNo, "lifecycleStatus", "DRAFT");
    }

    @Transactional
    public Map<String, Object> publishPolicyVersion(UUID versionId) {
        accessPolicy.requirePermission("kpi.policy.publish");
        TenantPrincipal principal = prepare();
        int updated = jdbc.update("""
                update kpi_compensation_policy_version
                set lifecycle_status = 'PUBLISHED', published_by = :actorId, published_at = now(),
                    effective_month = coalesce(effective_month, date_trunc('month', current_date)::date)
                where tenant_id = :tenantId and id = :id and lifecycle_status in ('DRAFT', 'IN_REVIEW')
                """, base(principal).addValue("id", versionId).addValue("actorId", principal.actorId()));
        if (updated != 1) throw conflict("绩效政策版本不存在或无法发布");
        auditWriter.record("KPI_POLICY_VERSION_PUBLISHED", "KPI_COMPENSATION_POLICY_VERSION", versionId, "{}");
        return Map.of("id", versionId, "lifecycleStatus", "PUBLISHED");
    }

    @Transactional(readOnly = true)
    public List<Map<String, Object>> policies() {
        accessPolicy.requireAnyPermission("kpi.policy.manage", "kpi.settlement.read", "kpi.template.read");
        TenantPrincipal principal = prepare();
        return jdbc.queryForList("""
                select p.id, p.code, p.name, p.status, v.id as version_id, v.version_no,
                       v.lifecycle_status, v.effective_month, v.expires_month, v.score_bands,
                       v.attendance_bands, v.zero_bonus_rules
                from kpi_compensation_policy_definition p
                left join lateral (
                    select * from kpi_compensation_policy_version candidate
                    where candidate.tenant_id = p.tenant_id and candidate.policy_id = p.id
                    order by candidate.version_no desc limit 1
                ) v on true
                where p.tenant_id = :tenantId order by p.code
                """, base(principal));
    }

    @Transactional
    public Map<String, Object> createTemplate(KpiModels.CreateTemplate request) {
        accessPolicy.requirePermission("kpi.template.manage");
        TenantPrincipal principal = prepare();
        String origin = normalize(request.templateOrigin(), "POSITION");
        if (!"GROUP_BASE".equals(origin) && request.positionId() == null) {
            throw new IllegalArgumentException("岗位模板和门店补充模板必须绑定岗位");
        }
        if ("STORE_SUPPLEMENT".equals(origin) && request.ownerOrgUnitId() == null) {
            throw new IllegalArgumentException("门店补充模板必须绑定门店");
        }
        if (request.ownerOrgUnitId() != null) accessPolicy.requireOrgScope(request.ownerOrgUnitId());
        UUID categoryId = ensureKpiCategory(principal);
        UUID standardId = UUID.randomUUID();
        String code = request.code().trim().toUpperCase(Locale.ROOT);
        jdbc.update("""
                insert into standard_definition
                    (id, tenant_id, category_id, code, name, owner_org_unit_id, description, created_by)
                values (:id, :tenantId, :categoryId, :code, :name, :ownerOrgUnitId, :description, :actorId)
                """, base(principal).addValue("id", standardId).addValue("categoryId", categoryId)
                .addValue("code", code).addValue("name", request.name().trim())
                .addValue("ownerOrgUnitId", request.ownerOrgUnitId())
                .addValue("description", request.description()).addValue("actorId", principal.actorId()));
        UUID templateId = UUID.randomUUID();
        jdbc.update("""
                insert into kpi_template_definition
                    (id, tenant_id, standard_definition_id, template_origin, owner_org_unit_id,
                     position_id, code, name, created_by)
                values (:id, :tenantId, :standardId, :origin, :ownerOrgUnitId,
                        :positionId, :code, :name, :actorId)
                """, base(principal).addValue("id", templateId).addValue("standardId", standardId)
                .addValue("origin", origin).addValue("ownerOrgUnitId", request.ownerOrgUnitId())
                .addValue("positionId", request.positionId()).addValue("code", code)
                .addValue("name", request.name().trim()).addValue("actorId", principal.actorId()));
        auditWriter.record("KPI_TEMPLATE_CREATED", "KPI_TEMPLATE", templateId,
                json(Map.of("code", code, "origin", origin)));
        return Map.of("id", templateId, "code", code, "name", request.name(), "templateOrigin", origin);
    }

    @Transactional
    public Map<String, Object> createTemplateVersion(UUID templateId, KpiModels.CreateTemplateVersion request) {
        accessPolicy.requirePermission("kpi.template.manage");
        TenantPrincipal principal = prepare();
        Map<String, Object> template = templateRow(principal, templateId);
        validateVersion(request);
        Integer versionNo = jdbc.queryForObject("""
                select coalesce(max(version_no), 0) + 1 from kpi_template_version
                where tenant_id = :tenantId and template_id = :templateId
                """, base(principal).addValue("templateId", templateId), Integer.class);
        UUID standardVersionId = UUID.randomUUID();
        UUID kpiVersionId = UUID.randomUUID();
        String content = json(request);
        String hash = KpiHashing.sha256(content);
        jdbc.update("""
                insert into standard_version
                    (id, tenant_id, standard_id, version_no, lifecycle_status, title,
                     items, evidence_requirements, scoring_rules, created_by)
                values (:id, :tenantId, :standardId, :versionNo, 'DRAFT', :title,
                        cast(:items as jsonb), '[]'::jsonb, cast(:scoring as jsonb), :actorId)
                """, base(principal).addValue("id", standardVersionId)
                .addValue("standardId", template.get("standard_definition_id"))
                .addValue("versionNo", versionNo).addValue("title", request.title().trim())
                .addValue("items", json(request.sections()))
                .addValue("scoring", json(Map.of("baseFullScore", request.baseFullScore(),
                        "allowExtraScore", request.allowExtraScore() == null || request.allowExtraScore())))
                .addValue("actorId", principal.actorId()));
        jdbc.update("""
                insert into kpi_template_version
                    (id, tenant_id, template_id, standard_version_id, base_template_version_id,
                     compensation_policy_version_id, version_no, base_full_score, allow_extra_score,
                     effective_month, expires_month, configuration, content_hash, created_by)
                values (:id, :tenantId, :templateId, :standardVersionId, :baseVersionId,
                        :policyVersionId, :versionNo, :baseFullScore, :allowExtraScore,
                        :effectiveMonth, :expiresMonth, cast(:configuration as jsonb), :hash, :actorId)
                """, base(principal).addValue("id", kpiVersionId).addValue("templateId", templateId)
                .addValue("standardVersionId", standardVersionId)
                .addValue("baseVersionId", request.baseTemplateVersionId())
                .addValue("policyVersionId", request.compensationPolicyVersionId())
                .addValue("versionNo", versionNo).addValue("baseFullScore", request.baseFullScore())
                .addValue("allowExtraScore", request.allowExtraScore() == null || request.allowExtraScore())
                .addValue("effectiveMonth", month(request.effectiveMonth()))
                .addValue("expiresMonth", month(request.expiresMonth()))
                .addValue("configuration", json(request.configuration(), "{}"))
                .addValue("hash", hash).addValue("actorId", principal.actorId()));
        insertSections(principal, kpiVersionId, request.sections());
        auditWriter.record("KPI_TEMPLATE_VERSION_CREATED", "KPI_TEMPLATE_VERSION", kpiVersionId,
                json(Map.of("templateId", templateId, "versionNo", versionNo)));
        return Map.of("id", kpiVersionId, "templateId", templateId, "versionNo", versionNo,
                "reviewStatus", "DRAFT", "lifecycleStatus", "DRAFT");
    }

    @Transactional
    public Map<String, Object> updateTemplateVersion(UUID versionId, KpiModels.UpdateTemplateVersion request) {
        accessPolicy.requirePermission("kpi.template.manage");
        TenantPrincipal principal = prepare();
        KpiModels.CreateTemplateVersion content = request.content();
        validateVersion(content);
        Map<String, Object> version = mutableTemplateVersion(principal, versionId, request.expectedVersion());
        if (!"DRAFT".equals(version.get("review_status"))) {
            throw conflict("模板已进入审核，不能覆盖修改；请复制为新的草稿版本");
        }
        String serialized = json(content);
        String hash = KpiHashing.sha256(serialized);
        jdbc.update("""
                update standard_version
                set title = :title, items = cast(:items as jsonb), scoring_rules = cast(:scoring as jsonb)
                where tenant_id = :tenantId and id = :standardVersionId and lifecycle_status = 'DRAFT'
                """, base(principal).addValue("standardVersionId", version.get("standard_version_id"))
                .addValue("title", content.title().trim()).addValue("items", json(content.sections()))
                .addValue("scoring", json(Map.of("baseFullScore", content.baseFullScore(),
                        "allowExtraScore", content.allowExtraScore() == null || content.allowExtraScore()))));
        int updated = jdbc.update("""
                update kpi_template_version
                set base_template_version_id = :baseVersionId,
                    compensation_policy_version_id = :policyVersionId,
                    base_full_score = :baseFullScore, allow_extra_score = :allowExtraScore,
                    effective_month = :effectiveMonth, expires_month = :expiresMonth,
                    configuration = cast(:configuration as jsonb), content_hash = :hash,
                    review_status = 'DRAFT', row_version = row_version + 1
                where tenant_id = :tenantId and id = :id and row_version = :expectedVersion
                """, base(principal).addValue("id", versionId)
                .addValue("baseVersionId", content.baseTemplateVersionId())
                .addValue("policyVersionId", content.compensationPolicyVersionId())
                .addValue("baseFullScore", content.baseFullScore())
                .addValue("allowExtraScore", content.allowExtraScore() == null || content.allowExtraScore())
                .addValue("effectiveMonth", month(content.effectiveMonth()))
                .addValue("expiresMonth", month(content.expiresMonth()))
                .addValue("configuration", json(content.configuration(), "{}"))
                .addValue("hash", hash).addValue("expectedVersion", request.expectedVersion()));
        if (updated != 1) throw conflict("模板草稿已被其他人修改，请刷新后重试");
        jdbc.update("""
                delete from kpi_indicator_rule
                where tenant_id = :tenantId and section_id in (
                    select id from kpi_template_section
                    where tenant_id = :tenantId and template_version_id = :id
                )
                """, base(principal).addValue("id", versionId));
        jdbc.update("delete from kpi_template_section where tenant_id = :tenantId and template_version_id = :id",
                base(principal).addValue("id", versionId));
        insertSections(principal, versionId, content.sections());
        auditWriter.record("KPI_TEMPLATE_VERSION_UPDATED", "KPI_TEMPLATE_VERSION", versionId,
                json(Map.of("expectedVersion", request.expectedVersion(), "contentHash", hash)));
        return Map.of("id", versionId, "templateId", version.get("template_id"),
                "versionNo", version.get("version_no"), "reviewStatus", "DRAFT",
                "lifecycleStatus", "DRAFT", "rowVersion", request.expectedVersion() + 1);
    }

    @Transactional(readOnly = true)
    public List<Map<String, Object>> templates(UUID positionId, UUID orgUnitId, String status) {
        accessPolicy.requirePermission("kpi.template.read");
        TenantPrincipal principal = prepare();
        if (orgUnitId != null) accessPolicy.requireOrgScope(orgUnitId);
        return jdbc.queryForList("""
                select t.id, t.code, t.name, t.template_origin, t.owner_org_unit_id,
                       t.position_id, t.status, p.name as position_name,
                       v.id as latest_version_id, v.version_no, v.review_status,
                       sv.lifecycle_status, v.effective_month, v.expires_month,
                       v.base_full_score, v.allow_extra_score
                from kpi_template_definition t
                left join position_definition p on p.tenant_id = t.tenant_id and p.id = t.position_id
                left join lateral (
                    select * from kpi_template_version candidate
                    where candidate.tenant_id = t.tenant_id and candidate.template_id = t.id
                    order by candidate.version_no desc limit 1
                ) v on true
                left join standard_version sv on sv.tenant_id = v.tenant_id and sv.id = v.standard_version_id
                where t.tenant_id = :tenantId
                  and (cast(:positionId as uuid) is null or t.position_id = :positionId)
                  and (cast(:orgUnitId as uuid) is null or t.owner_org_unit_id = :orgUnitId)
                  and (cast(:status as varchar) is null or sv.lifecycle_status = :status)
                order by t.code
                """, base(principal).addValue("positionId", positionId)
                .addValue("orgUnitId", orgUnitId).addValue("status", blankToNull(status)));
    }

    @Transactional(readOnly = true)
    public Map<String, Object> templateDetail(UUID templateId) {
        accessPolicy.requirePermission("kpi.template.read");
        TenantPrincipal principal = prepare();
        Map<String, Object> template = new LinkedHashMap<>(templateRow(principal, templateId));
        List<Map<String, Object>> versions = jdbc.queryForList("""
                select v.id, v.version_no, v.review_status, v.base_full_score, v.allow_extra_score,
                       v.effective_month, v.expires_month, v.configuration, v.content_hash,
                       v.row_version, sv.lifecycle_status, sv.title, sv.published_at
                from kpi_template_version v
                join standard_version sv on sv.tenant_id = v.tenant_id and sv.id = v.standard_version_id
                where v.tenant_id = :tenantId and v.template_id = :templateId
                order by v.version_no desc
                """, base(principal).addValue("templateId", templateId));
        template.put("versions", versions);
        return template;
    }

    @Transactional(readOnly = true)
    public Map<String, Object> templateVersion(UUID versionId) {
        accessPolicy.requirePermission("kpi.template.read");
        TenantPrincipal principal = prepare();
        Map<String, Object> version = new LinkedHashMap<>(jdbc.queryForMap("""
                select v.*, sv.lifecycle_status, sv.title, sv.published_at
                from kpi_template_version v
                join standard_version sv on sv.tenant_id = v.tenant_id and sv.id = v.standard_version_id
                where v.tenant_id = :tenantId and v.id = :id
                """, base(principal).addValue("id", versionId)));
        List<Map<String, Object>> sections = jdbc.queryForList("""
                select id, section_code, name, max_score, min_score, sort_order, configuration
                from kpi_template_section
                where tenant_id = :tenantId and template_version_id = :id
                order by sort_order, section_code
                """, base(principal).addValue("id", versionId));
        for (Map<String, Object> section : sections) {
            ((Map<String, Object>) section).put("indicators", jdbc.queryForList("""
                    select id, indicator_code, name, indicator_type, weekly_split_type,
                           metric_version_id, max_score, min_score, target_value, allow_above_max,
                           precision_scale, evidence_required, evaluator_type, not_applicable_policy,
                           sort_order, formula_config, warning_config
                    from kpi_indicator_rule
                    where tenant_id = :tenantId and section_id = :sectionId
                    order by sort_order, indicator_code
                    """, base(principal).addValue("sectionId", section.get("id"))));
        }
        version.put("sections", sections);
        version.put("approvals", jdbc.queryForList("""
                select approval_stage, decision, comment, decided_by, decided_at
                from kpi_template_approval
                where tenant_id = :tenantId and template_version_id = :id
                order by decided_at
                """, base(principal).addValue("id", versionId)));
        return version;
    }

    @Transactional
    public Map<String, Object> reviewTemplate(UUID versionId, KpiModels.TemplateReview request) {
        accessPolicy.requirePermission("kpi.template.review");
        TenantPrincipal principal = prepare();
        String stage = normalize(request.stage(), "DEPARTMENT");
        String decision = normalize(request.decision(), "APPROVED");
        if ("CEO".equals(stage) && !principal.hasRole("CEO") && !principal.hasPermission("kpi.template.publish")) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "只有CEO可以完成CEO审批");
        }
        Map<String, Object> version = mutableTemplateVersion(principal, versionId, request.expectedVersion());
        UUID approvalId = UUID.randomUUID();
        jdbc.update("""
                insert into kpi_template_approval
                    (id, tenant_id, template_version_id, approval_stage, decision, comment, decided_by)
                values (:id, :tenantId, :versionId, :stage, :decision, :comment, :actorId)
                """, base(principal).addValue("id", approvalId).addValue("versionId", versionId)
                .addValue("stage", stage).addValue("decision", decision)
                .addValue("comment", request.comment()).addValue("actorId", principal.actorId()));
        String reviewStatus = "APPROVED".equals(decision) && "CEO".equals(stage)
                ? "APPROVED" : ("APPROVED".equals(decision) ? "IN_REVIEW" : "REJECTED");
        jdbc.update("""
                update kpi_template_version set review_status = :reviewStatus, row_version = row_version + 1
                where tenant_id = :tenantId and id = :id and row_version = :expectedVersion
                """, base(principal).addValue("id", versionId).addValue("reviewStatus", reviewStatus)
                .addValue("expectedVersion", request.expectedVersion()));
        auditWriter.record("KPI_TEMPLATE_REVIEWED", "KPI_TEMPLATE_VERSION", versionId,
                json(Map.of("stage", stage, "decision", decision)));
        return Map.of("id", versionId, "reviewStatus", reviewStatus,
                "rowVersion", ((Number) version.get("row_version")).longValue() + 1);
    }

    @Transactional
    public Map<String, Object> publishTemplate(UUID versionId, KpiModels.TemplatePublish request) {
        accessPolicy.requirePermission("kpi.template.publish");
        TenantPrincipal principal = prepare();
        Map<String, Object> version = mutableTemplateVersion(principal, versionId, request.expectedVersion());
        if (!"APPROVED".equals(version.get("review_status"))) {
            throw conflict("模板必须完成CEO审批后才能发布");
        }
        BigDecimal sectionTotal = jdbc.queryForObject("""
                select coalesce(sum(max_score), 0) from kpi_template_section
                where tenant_id = :tenantId and template_version_id = :id
                """, base(principal).addValue("id", versionId), BigDecimal.class);
        BigDecimal baseFullScore = (BigDecimal) version.get("base_full_score");
        if (sectionTotal == null || sectionTotal.compareTo(baseFullScore) != 0) {
            throw new IllegalArgumentException("板块分值合计必须等于基础总分，当前为" + sectionTotal);
        }
        int invalid = jdbc.queryForObject("""
                select count(*) from kpi_indicator_rule i
                join kpi_template_section s on s.tenant_id = i.tenant_id and s.id = i.section_id
                where i.tenant_id = :tenantId and s.template_version_id = :id
                  and i.indicator_type <> 'MANUAL' and i.metric_version_id is null
                  and i.indicator_type <> 'COMPOSITE'
                """, base(principal).addValue("id", versionId), Integer.class);
        if (invalid > 0) throw new IllegalArgumentException("存在未绑定指标来源的自动指标");
        LocalDate effective = month(request.effectiveMonth() == null
                ? (LocalDate) version.get("effective_month") : request.effectiveMonth());
        if (effective == null) effective = LocalDate.now().withDayOfMonth(1);
        jdbc.update("""
                update kpi_template_version
                set effective_month = :effectiveMonth, expires_month = :expiresMonth,
                    row_version = row_version + 1
                where tenant_id = :tenantId and id = :id and row_version = :expectedVersion
                """, base(principal).addValue("id", versionId).addValue("effectiveMonth", effective)
                .addValue("expiresMonth", month(request.expiresMonth()))
                .addValue("expectedVersion", request.expectedVersion()));
        int published = jdbc.update("""
                update standard_version
                set lifecycle_status = 'PUBLISHED', effective_from = :effectiveMonth,
                    effective_to = :expiresMonth, published_by = :actorId, published_at = now()
                where tenant_id = :tenantId and id = :standardVersionId and lifecycle_status = 'DRAFT'
                """, base(principal).addValue("standardVersionId", version.get("standard_version_id"))
                .addValue("effectiveMonth", effective).addValue("expiresMonth", request.expiresMonth())
                .addValue("actorId", principal.actorId()));
        if (published != 1) throw conflict("标准版本已发布或不可变");
        auditWriter.record("KPI_TEMPLATE_PUBLISHED", "KPI_TEMPLATE_VERSION", versionId,
                json(Map.of("effectiveMonth", effective.toString())));
        auditWriter.emit("KPI_TEMPLATE_VERSION", versionId, "KpiTemplatePublished",
                json(Map.of("versionId", versionId, "effectiveMonth", effective.toString())));
        return Map.of("id", versionId, "lifecycleStatus", "PUBLISHED", "effectiveMonth", effective,
                "rowVersion", request.expectedVersion() + 1);
    }

    private void insertSections(TenantPrincipal principal, UUID versionId, List<KpiModels.SectionInput> sections) {
        for (KpiModels.SectionInput section : sections) {
            UUID sectionId = section.id() == null ? UUID.randomUUID() : section.id();
            jdbc.update("""
                    insert into kpi_template_section
                        (id, tenant_id, template_version_id, section_code, name, max_score,
                         min_score, sort_order, configuration)
                    values (:id, :tenantId, :versionId, :code, :name, :maxScore,
                            :minScore, :sortOrder, cast(:configuration as jsonb))
                    """, base(principal).addValue("id", sectionId).addValue("versionId", versionId)
                    .addValue("code", section.sectionCode().trim().toUpperCase(Locale.ROOT))
                    .addValue("name", section.name().trim()).addValue("maxScore", section.maxScore())
                    .addValue("minScore", section.minScore()).addValue("sortOrder", value(section.sortOrder(), 0))
                    .addValue("configuration", json(section.configuration(), "{}")));
            for (KpiModels.IndicatorInput indicator : section.indicators()) {
                UUID indicatorId = indicator.id() == null ? UUID.randomUUID() : indicator.id();
                jdbc.update("""
                        insert into kpi_indicator_rule
                            (id, tenant_id, section_id, metric_version_id, indicator_code, name,
                             indicator_type, weekly_split_type, max_score, min_score, target_value,
                             allow_above_max, precision_scale, evidence_required, evaluator_type,
                             not_applicable_policy, sort_order, formula_config, warning_config)
                        values (:id, :tenantId, :sectionId, :metricVersionId, :code, :name,
                                :indicatorType, :weeklySplitType, :maxScore, :minScore, :targetValue,
                                :allowAboveMax, :precisionScale, :evidenceRequired, :evaluatorType,
                                :naPolicy, :sortOrder, cast(:formulaConfig as jsonb), cast(:warningConfig as jsonb))
                        """, base(principal).addValue("id", indicatorId).addValue("sectionId", sectionId)
                        .addValue("metricVersionId", indicator.metricVersionId())
                        .addValue("code", indicator.indicatorCode().trim().toUpperCase(Locale.ROOT))
                        .addValue("name", indicator.name().trim())
                        .addValue("indicatorType", normalize(indicator.indicatorType(), "TARGET"))
                        .addValue("weeklySplitType", normalize(indicator.weeklySplitType(), "SAME_TARGET"))
                        .addValue("maxScore", indicator.maxScore()).addValue("minScore", indicator.minScore())
                        .addValue("targetValue", indicator.targetValue())
                        .addValue("allowAboveMax", Boolean.TRUE.equals(indicator.allowAboveMax()))
                        .addValue("precisionScale", value(indicator.precisionScale(), 2))
                        .addValue("evidenceRequired", Boolean.TRUE.equals(indicator.evidenceRequired()))
                        .addValue("evaluatorType", normalize(indicator.evaluatorType(),
                                "MANUAL".equalsIgnoreCase(indicator.indicatorType()) ? "MANUAL_EVALUATOR" : "SYSTEM"))
                        .addValue("naPolicy", normalize(indicator.notApplicablePolicy(), "PENDING_VERIFICATION"))
                        .addValue("sortOrder", value(indicator.sortOrder(), 0))
                        .addValue("formulaConfig", json(indicator.formulaConfig(), "{}"))
                        .addValue("warningConfig", json(indicator.warningConfig(), "{}")));
            }
        }
    }

    private void validateVersion(KpiModels.CreateTemplateVersion request) {
        if (request.effectiveMonth() != null && request.effectiveMonth().getDayOfMonth() != 1) {
            throw new IllegalArgumentException("模板生效月份必须为当月1日");
        }
        if (request.expiresMonth() != null && request.expiresMonth().getDayOfMonth() != 1) {
            throw new IllegalArgumentException("模板失效月份必须为当月1日");
        }
        for (KpiModels.SectionInput section : request.sections()) {
            BigDecimal indicatorTotal = section.indicators().stream()
                    .filter(item -> !"BONUS_ADJUSTMENT".equalsIgnoreCase(item.indicatorType()))
                    .map(KpiModels.IndicatorInput::maxScore).reduce(BigDecimal.ZERO, BigDecimal::add);
            if (indicatorTotal.compareTo(section.maxScore()) != 0) {
                throw new IllegalArgumentException("板块" + section.name() + "指标满分合计必须等于板块分值");
            }
            for (KpiModels.IndicatorInput indicator : section.indicators()) {
                if ("EQUAL_FOUR_WEEKS".equalsIgnoreCase(indicator.weeklySplitType())
                        && indicator.formulaConfig() != null
                        && indicator.formulaConfig().path("metricNature").asText().equalsIgnoreCase("RATIO")) {
                    throw new IllegalArgumentException("比率型指标不能按25%拆分，应选择每周目标保持不变");
                }
            }
        }
    }

    private Map<String, Object> mutableTemplateVersion(TenantPrincipal principal, UUID id, long expectedVersion) {
        Map<String, Object> row = jdbc.queryForMap("""
                select v.*, sv.lifecycle_status from kpi_template_version v
                join standard_version sv on sv.tenant_id = v.tenant_id and sv.id = v.standard_version_id
                where v.tenant_id = :tenantId and v.id = :id
                """, base(principal).addValue("id", id));
        if (!"DRAFT".equals(row.get("lifecycle_status"))) throw conflict("已发布模板不可修改");
        if (((Number) row.get("row_version")).longValue() != expectedVersion) throw conflict("模板版本已变化，请刷新后重试");
        return row;
    }

    private Map<String, Object> templateRow(TenantPrincipal principal, UUID templateId) {
        List<Map<String, Object>> rows = jdbc.queryForList("""
                select t.*, s.description, p.name as position_name, p.code as position_code
                from kpi_template_definition t
                join standard_definition s on s.tenant_id = t.tenant_id and s.id = t.standard_definition_id
                left join position_definition p on p.tenant_id = t.tenant_id and p.id = t.position_id
                where t.tenant_id = :tenantId and t.id = :id
                """, base(principal).addValue("id", templateId));
        if (rows.isEmpty()) throw new ResponseStatusException(HttpStatus.NOT_FOUND, "KPI模板不存在");
        return rows.getFirst();
    }

    private UUID ensureKpiCategory(TenantPrincipal principal) {
        List<UUID> ids = jdbc.query("""
                select id from standard_category where tenant_id = :tenantId and category_type = 'KPI'
                order by created_at limit 1
                """, base(principal), (rs, rowNum) -> rs.getObject("id", UUID.class));
        if (!ids.isEmpty()) return ids.getFirst();
        UUID id = UUID.randomUUID();
        jdbc.update("""
                insert into standard_category (id, tenant_id, code, name, category_type)
                values (:id, :tenantId, 'KPI', 'KPI标准', 'KPI')
                """, base(principal).addValue("id", id));
        return id;
    }

    private UUID findMetricDefinition(TenantPrincipal principal, String code) {
        List<UUID> ids = jdbc.query("""
                select id from metric_definition where tenant_id = :tenantId and code = :code
                """, base(principal).addValue("code", code), (rs, rowNum) -> rs.getObject("id", UUID.class));
        return ids.isEmpty() ? null : ids.getFirst();
    }

    private void requirePublishedMetric(TenantPrincipal principal, UUID versionId) {
        Integer count = jdbc.queryForObject("""
                select count(*) from metric_definition_version
                where tenant_id = :tenantId and id = :id and lifecycle_status = 'PUBLISHED'
                """, base(principal).addValue("id", versionId), Integer.class);
        if (count == null || count != 1) throw new IllegalArgumentException("指标版本不存在或尚未发布");
    }

    private void requireFact(TenantPrincipal principal, UUID factId) {
        Integer count = jdbc.queryForObject("""
                select count(*) from kpi_metric_fact where tenant_id = :tenantId and id = :id
                """, base(principal).addValue("id", factId), Integer.class);
        if (count == null || count != 1) throw new IllegalArgumentException("被更正的指标事实不存在");
    }

    private void requirePolicy(TenantPrincipal principal, UUID policyId) {
        Integer count = jdbc.queryForObject("""
                select count(*) from kpi_compensation_policy_definition
                where tenant_id = :tenantId and id = :id and status = 'ACTIVE'
                """, base(principal).addValue("id", policyId), Integer.class);
        if (count == null || count != 1) throw new IllegalArgumentException("绩效政策不存在");
    }

    private TenantPrincipal prepare() {
        TenantPrincipal principal = accessPolicy.principal();
        databaseContext.apply(principal.tenantId());
        return principal;
    }

    private MapSqlParameterSource base(TenantPrincipal principal) {
        return new MapSqlParameterSource("tenantId", principal.tenantId());
    }

    private LocalDate month(LocalDate date) {
        return date == null ? null : date.withDayOfMonth(1);
    }

    private int value(Integer value, int fallback) {
        return value == null ? fallback : value;
    }

    private String normalize(String value, String fallback) {
        return value == null || value.isBlank() ? fallback : value.trim().toUpperCase(Locale.ROOT);
    }

    private String blankToNull(String value) {
        return value == null || value.isBlank() ? null : value.trim();
    }

    private String json(Object value) {
        return json(value, "{}");
    }

    private String json(Object value, String fallback) {
        if (value == null || value instanceof JsonNode node && node.isNull()) return fallback;
        try {
            return objectMapper.writeValueAsString(value);
        } catch (JsonProcessingException exception) {
            throw new IllegalArgumentException("无法序列化KPI配置", exception);
        }
    }

    private ResponseStatusException conflict(String message) {
        return new ResponseStatusException(HttpStatus.CONFLICT, message);
    }
}
