package cn.sifangguan.hotelaios.templates;

import cn.sifangguan.hotelaios.shared.audit.AuditWriter;
import cn.sifangguan.hotelaios.shared.context.TenantPrincipal;
import cn.sifangguan.hotelaios.shared.db.TenantDatabaseContext;
import cn.sifangguan.hotelaios.shared.security.AccessPolicy;
import com.fasterxml.jackson.databind.JsonNode;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.OffsetDateTime;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;

@Service
public class EnterpriseTemplateService {
    private final NamedParameterJdbcTemplate jdbc;
    private final TenantDatabaseContext databaseContext;
    private final AccessPolicy accessPolicy;
    private final AuditWriter auditWriter;

    public EnterpriseTemplateService(
            NamedParameterJdbcTemplate jdbc,
            TenantDatabaseContext databaseContext,
            AccessPolicy accessPolicy,
            AuditWriter auditWriter
    ) {
        this.jdbc = jdbc;
        this.databaseContext = databaseContext;
        this.accessPolicy = accessPolicy;
        this.auditWriter = auditWriter;
    }

    @Transactional(readOnly = true)
    public List<Map<String, Object>> list(String type) {
        accessPolicy.requirePermission("template.read");
        TenantPrincipal principal = prepare();
        String normalizedType = normalizeType(type, true);
        return jdbc.queryForList("""
                select definition.id, definition.template_type, definition.code, definition.name,
                       definition.description, definition.target_position_id, position.name as position_name,
                       definition.owner_org_unit_id, owner.name as owner_org_unit_name,
                       version.id as latest_version_id, version.version_no, version.lifecycle_status,
                       version.configuration, version.row_version, version.effective_from,
                       version.published_at, definition.updated_at,
                       published.id as published_version_id, published.version_no as published_version_no,
                       published.configuration as published_configuration
                from enterprise_template_definition definition
                left join position_definition position
                  on position.tenant_id = definition.tenant_id and position.id = definition.target_position_id
                left join org_unit owner
                  on owner.tenant_id = definition.tenant_id and owner.id = definition.owner_org_unit_id
                left join lateral (
                    select candidate.* from enterprise_template_version candidate
                    where candidate.tenant_id = definition.tenant_id and candidate.template_id = definition.id
                    order by case candidate.lifecycle_status when 'DRAFT' then 0 when 'PUBLISHED' then 1 else 2 end,
                             candidate.version_no desc
                    limit 1
                ) version on true
                left join lateral (
                    select candidate.id, candidate.version_no, candidate.configuration
                    from enterprise_template_version candidate
                    where candidate.tenant_id = definition.tenant_id and candidate.template_id = definition.id
                      and candidate.lifecycle_status = 'PUBLISHED'
                    order by candidate.version_no desc limit 1
                ) published on true
                where definition.tenant_id = :tenantId
                  and (cast(:type as varchar) is null or definition.template_type = cast(:type as varchar))
                order by definition.template_type, definition.name, definition.id
                """, base(principal).addValue("type", normalizedType));
    }

    @Transactional(readOnly = true)
    public Map<String, Object> detail(UUID templateId) {
        accessPolicy.requirePermission("template.read");
        TenantPrincipal principal = prepare();
        Map<String, Object> result = jdbc.queryForMap("""
                select definition.*, position.name as position_name, owner.name as owner_org_unit_name
                from enterprise_template_definition definition
                left join position_definition position
                  on position.tenant_id = definition.tenant_id and position.id = definition.target_position_id
                left join org_unit owner
                  on owner.tenant_id = definition.tenant_id and owner.id = definition.owner_org_unit_id
                where definition.tenant_id = :tenantId and definition.id = :templateId
                """, base(principal).addValue("templateId", templateId));
        result.put("versions", jdbc.queryForList("""
                select id, version_no, lifecycle_status, configuration, effective_from, effective_to,
                       published_at, row_version, created_at, updated_at
                from enterprise_template_version
                where tenant_id = :tenantId and template_id = :templateId
                order by version_no desc
                """, base(principal).addValue("templateId", templateId)));
        return result;
    }

    @Transactional
    public Map<String, Object> create(EnterpriseTemplateModels.CreateTemplate request) {
        accessPolicy.requirePermission("template.manage");
        TenantPrincipal principal = prepare();
        String type = normalizeType(request.templateType(), false);
        requireJsonObject(request.configuration());
        requireOptionalOrgScope(request.ownerOrgUnitId());
        UUID templateId = UUID.randomUUID();
        UUID versionId = UUID.randomUUID();
        jdbc.update("""
                insert into enterprise_template_definition
                    (id, tenant_id, template_type, code, name, description, target_position_id,
                     owner_org_unit_id, created_by)
                values (:id, :tenantId, :type, :code, :name, :description, :positionId,
                        :ownerOrgUnitId, :actorId)
                """, base(principal)
                .addValue("id", templateId).addValue("type", type)
                .addValue("code", request.code().trim().toUpperCase(Locale.ROOT))
                .addValue("name", request.name().trim()).addValue("description", request.description())
                .addValue("positionId", request.targetPositionId()).addValue("ownerOrgUnitId", request.ownerOrgUnitId())
                .addValue("actorId", principal.actorId()));
        insertVersion(principal, templateId, versionId, 1, request.configuration());
        auditWriter.record("ENTERPRISE_TEMPLATE_CREATED", "ENTERPRISE_TEMPLATE", templateId,
                "{\"versionId\":\"" + versionId + "\",\"type\":\"" + type + "\"}");
        return detail(templateId);
    }

    @Transactional
    public Map<String, Object> createVersion(UUID templateId, EnterpriseTemplateModels.CreateVersion request) {
        accessPolicy.requirePermission("template.manage");
        TenantPrincipal principal = prepare();
        requireTemplate(principal, templateId);
        requireJsonObject(request.configuration());
        int versionNo = jdbc.queryForObject("""
                select coalesce(max(version_no), 0) + 1 from enterprise_template_version
                where tenant_id = :tenantId and template_id = :templateId
                """, base(principal).addValue("templateId", templateId), Integer.class);
        UUID versionId = UUID.randomUUID();
        insertVersion(principal, templateId, versionId, versionNo, request.configuration());
        auditWriter.record("ENTERPRISE_TEMPLATE_VERSION_CREATED", "ENTERPRISE_TEMPLATE_VERSION", versionId,
                "{\"templateId\":\"" + templateId + "\",\"versionNo\":" + versionNo + "}");
        return detail(templateId);
    }

    @Transactional
    public Map<String, Object> updateVersion(
            UUID templateId,
            UUID versionId,
            EnterpriseTemplateModels.UpdateVersion request
    ) {
        accessPolicy.requirePermission("template.manage");
        TenantPrincipal principal = prepare();
        requireJsonObject(request.configuration());
        int changed = jdbc.update("""
                update enterprise_template_version
                set configuration = cast(:configuration as jsonb), row_version = row_version + 1
                where tenant_id = :tenantId and template_id = :templateId and id = :versionId
                  and lifecycle_status = 'DRAFT' and row_version = :expectedVersion
                """, base(principal).addValue("templateId", templateId).addValue("versionId", versionId)
                .addValue("configuration", request.configuration().toString())
                .addValue("expectedVersion", request.expectedVersion()));
        if (changed != 1) {
            throw new IllegalArgumentException("模板草稿已变化或不是可编辑草稿，请刷新后重试");
        }
        auditWriter.record("ENTERPRISE_TEMPLATE_VERSION_UPDATED", "ENTERPRISE_TEMPLATE_VERSION", versionId,
                "{\"templateId\":\"" + templateId + "\"}");
        return detail(templateId);
    }

    @Transactional
    public Map<String, Object> publish(
            UUID templateId,
            UUID versionId,
            EnterpriseTemplateModels.PublishVersion request
    ) {
        accessPolicy.requirePermission("template.publish");
        TenantPrincipal principal = prepare();
        OffsetDateTime effectiveFrom = request == null || request.effectiveFrom() == null
                ? OffsetDateTime.now() : request.effectiveFrom();
        int changed = jdbc.update("""
                update enterprise_template_version
                set lifecycle_status = 'PUBLISHED', effective_from = :effectiveFrom,
                    published_by = :actorId, published_at = now(), row_version = row_version + 1
                where tenant_id = :tenantId and template_id = :templateId and id = :versionId
                  and lifecycle_status = 'DRAFT'
                """, base(principal).addValue("templateId", templateId).addValue("versionId", versionId)
                .addValue("effectiveFrom", effectiveFrom).addValue("actorId", principal.actorId()));
        if (changed != 1) {
            throw new IllegalArgumentException("仅草稿模板版本可以发布");
        }
        jdbc.update("""
                update enterprise_template_version
                set lifecycle_status = 'RETIRED', effective_to = :effectiveFrom, row_version = row_version + 1
                where tenant_id = :tenantId and template_id = :templateId and id <> :versionId
                  and lifecycle_status = 'PUBLISHED'
                """, base(principal).addValue("templateId", templateId).addValue("versionId", versionId)
                .addValue("effectiveFrom", effectiveFrom));
        auditWriter.record("ENTERPRISE_TEMPLATE_VERSION_PUBLISHED", "ENTERPRISE_TEMPLATE_VERSION", versionId,
                "{\"templateId\":\"" + templateId + "\"}");
        return detail(templateId);
    }

    private void insertVersion(TenantPrincipal principal, UUID templateId, UUID versionId, int versionNo, JsonNode configuration) {
        jdbc.update("""
                insert into enterprise_template_version
                    (id, tenant_id, template_id, version_no, lifecycle_status, configuration, created_by)
                values (:id, :tenantId, :templateId, :versionNo, 'DRAFT', cast(:configuration as jsonb), :actorId)
                """, base(principal).addValue("id", versionId).addValue("templateId", templateId)
                .addValue("versionNo", versionNo).addValue("configuration", configuration.toString())
                .addValue("actorId", principal.actorId()));
    }

    private void requireTemplate(TenantPrincipal principal, UUID templateId) {
        Integer count = jdbc.queryForObject("""
                select count(*) from enterprise_template_definition
                where tenant_id = :tenantId and id = :templateId
                """, base(principal).addValue("templateId", templateId), Integer.class);
        if (count == null || count != 1) {
            throw new IllegalArgumentException("企业模板不存在");
        }
    }

    private void requireOptionalOrgScope(UUID orgUnitId) {
        if (orgUnitId != null) {
            accessPolicy.requireOrgScope(orgUnitId);
        }
    }

    private String normalizeType(String value, boolean optional) {
        if (value == null || value.isBlank()) {
            if (optional) return null;
            throw new IllegalArgumentException("模板类型不能为空");
        }
        String normalized = value.trim().toUpperCase(Locale.ROOT);
        if (!List.of("TASK", "HOTEL_DASHBOARD").contains(normalized)) {
            throw new IllegalArgumentException("不支持的模板类型: " + normalized);
        }
        return normalized;
    }

    private void requireJsonObject(JsonNode configuration) {
        if (configuration == null || !configuration.isObject()) {
            throw new IllegalArgumentException("模板配置必须是JSON对象");
        }
    }

    private TenantPrincipal prepare() {
        TenantPrincipal principal = accessPolicy.principal();
        databaseContext.apply(principal.tenantId());
        return principal;
    }

    private MapSqlParameterSource base(TenantPrincipal principal) {
        return new MapSqlParameterSource("tenantId", principal.tenantId());
    }
}
