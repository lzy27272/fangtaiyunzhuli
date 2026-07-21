package cn.sifangguan.hotelaios.standards;

import cn.sifangguan.hotelaios.shared.audit.AuditWriter;
import cn.sifangguan.hotelaios.shared.context.TenantPrincipal;
import cn.sifangguan.hotelaios.shared.db.TenantDatabaseContext;
import cn.sifangguan.hotelaios.shared.security.AccessPolicy;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.Map;
import java.util.UUID;

@Service
public class StandardService {
    private final NamedParameterJdbcTemplate jdbc;
    private final TenantDatabaseContext databaseContext;
    private final AccessPolicy accessPolicy;
    private final AuditWriter auditWriter;

    public StandardService(
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
    public List<Map<String, Object>> categories() {
        accessPolicy.requirePermission("standard.read");
        TenantPrincipal principal = prepare();
        return jdbc.queryForList("""
                select id, code, name, category_type
                from standard_category
                where tenant_id = :tenantId
                order by category_type, name
                """, base(principal));
    }

    @Transactional(readOnly = true)
    public List<Map<String, Object>> standards() {
        accessPolicy.requirePermission("standard.read");
        TenantPrincipal principal = prepare();
        boolean draftsVisible = principal.hasTenantScope();
        return jdbc.queryForList("""
                select d.id, d.code, d.name, d.description, c.category_type,
                       v.id as latest_version_id, v.version_no, v.lifecycle_status,
                       v.effective_from, v.published_at
                from standard_definition d
                join standard_category c on c.tenant_id = d.tenant_id and c.id = d.category_id
                left join lateral (
                    select sv.id, sv.version_no, sv.lifecycle_status, sv.effective_from, sv.published_at
                    from standard_version sv
                    where sv.tenant_id = d.tenant_id and sv.standard_id = d.id
                      and (:draftsVisible = true or sv.lifecycle_status = 'PUBLISHED')
                    order by sv.version_no desc limit 1
                ) v on true
                where d.tenant_id = :tenantId
                order by c.category_type, d.name
                """, base(principal).addValue("draftsVisible", draftsVisible));
    }

    @Transactional
    public Map<String, Object> createStandard(StandardModels.CreateStandard request) {
        accessPolicy.requirePermission("standard.manage");
        TenantPrincipal principal = prepare();
        requireOwned("standard_category", principal, request.categoryId());
        if (request.ownerOrgUnitId() != null) {
            requireOwned("org_unit", principal, request.ownerOrgUnitId());
            accessPolicy.requireOrgScope(request.ownerOrgUnitId());
        }
        UUID id = UUID.randomUUID();
        MapSqlParameterSource params = base(principal)
                .addValue("id", id)
                .addValue("categoryId", request.categoryId())
                .addValue("code", request.code().trim().toUpperCase())
                .addValue("name", request.name().trim())
                .addValue("ownerOrgUnitId", request.ownerOrgUnitId())
                .addValue("description", request.description())
                .addValue("createdBy", principal.actorId());
        jdbc.update("""
                insert into standard_definition
                    (id, tenant_id, category_id, code, name, owner_org_unit_id, description, created_by)
                values
                    (:id, :tenantId, :categoryId, :code, :name, :ownerOrgUnitId, :description, :createdBy)
                """, params);
        auditWriter.record("STANDARD_CREATED", "STANDARD", id, "{\"code\":\"" + request.code() + "\"}");
        return Map.of("id", id, "code", request.code(), "name", request.name());
    }

    @Transactional
    public Map<String, Object> createVersion(UUID standardId, StandardModels.CreateVersion request) {
        accessPolicy.requirePermission("standard.manage");
        TenantPrincipal principal = prepare();
        requireOwned("standard_definition", principal, standardId);
        Integer versionNo = jdbc.queryForObject("""
                select coalesce(max(version_no), 0) + 1
                from standard_version
                where tenant_id = :tenantId and standard_id = :standardId
                """, base(principal).addValue("standardId", standardId), Integer.class);
        UUID versionId = UUID.randomUUID();
        MapSqlParameterSource params = base(principal)
                .addValue("id", versionId)
                .addValue("standardId", standardId)
                .addValue("versionNo", versionNo)
                .addValue("title", request.title().trim())
                .addValue("items", request.items().toString())
                .addValue("evidence", (request.evidenceRequirements() == null ? JsonNodeFactory.instance.arrayNode() : request.evidenceRequirements()).toString())
                .addValue("scoring", (request.scoringRules() == null ? JsonNodeFactory.instance.objectNode() : request.scoringRules()).toString())
                .addValue("createdBy", principal.actorId());
        jdbc.update("""
                insert into standard_version
                    (id, tenant_id, standard_id, version_no, title, items,
                     evidence_requirements, scoring_rules, created_by)
                values
                    (:id, :tenantId, :standardId, :versionNo, :title, cast(:items as jsonb),
                     cast(:evidence as jsonb), cast(:scoring as jsonb), :createdBy)
                """, params);
        for (StandardModels.Scope scope : request.scopes()) {
            insertScope(principal, versionId, scope);
        }
        auditWriter.record("STANDARD_VERSION_CREATED", "STANDARD_VERSION", versionId,
                "{\"standardId\":\"" + standardId + "\",\"versionNo\":" + versionNo + "}");
        return Map.of("id", versionId, "standardId", standardId, "versionNo", versionNo, "status", "DRAFT");
    }

    @Transactional
    public Map<String, Object> publish(UUID standardId, UUID versionId, StandardModels.PublishVersion request) {
        accessPolicy.requirePermission("standard.manage");
        TenantPrincipal principal = prepare();
        int updated = jdbc.update("""
                update standard_version
                set lifecycle_status = 'PUBLISHED', effective_from = :effectiveFrom,
                    effective_to = :effectiveTo, published_by = :actorId, published_at = now()
                where tenant_id = :tenantId and standard_id = :standardId and id = :versionId
                  and lifecycle_status = 'DRAFT'
                """, base(principal)
                .addValue("standardId", standardId)
                .addValue("versionId", versionId)
                .addValue("effectiveFrom", request.effectiveFrom())
                .addValue("effectiveTo", request.effectiveTo())
                .addValue("actorId", principal.actorId()));
        if (updated != 1) {
            throw new IllegalArgumentException("只有当前租户的草稿版本可以发布");
        }
        jdbc.update("""
                update standard_version
                set lifecycle_status = 'RETIRED', effective_to = :effectiveFrom
                where tenant_id = :tenantId and standard_id = :standardId and id <> :versionId
                  and lifecycle_status = 'PUBLISHED'
                """, base(principal)
                .addValue("standardId", standardId)
                .addValue("versionId", versionId)
                .addValue("effectiveFrom", request.effectiveFrom()));
        auditWriter.record("STANDARD_PUBLISHED", "STANDARD_VERSION", versionId,
                "{\"standardId\":\"" + standardId + "\"}");
        auditWriter.emit("STANDARD", standardId, "StandardPublished",
                "{\"standardId\":\"" + standardId + "\",\"versionId\":\"" + versionId + "\"}");
        return Map.of("standardId", standardId, "versionId", versionId, "status", "PUBLISHED");
    }

    private void insertScope(TenantPrincipal principal, UUID versionId, StandardModels.Scope scope) {
        String scopeType = scope.scopeType().toUpperCase();
        if (scope.orgUnitId() != null) {
            requireOwned("org_unit", principal, scope.orgUnitId());
        }
        if (scope.positionId() != null) {
            requireOwned("position_definition", principal, scope.positionId());
        }
        if (scope.brandId() != null) {
            requireOwned("brand", principal, scope.brandId());
        }
        jdbc.update("""
                insert into standard_scope
                    (id, tenant_id, standard_version_id, scope_type, brand_id, org_unit_id, position_id)
                values
                    (:id, :tenantId, :versionId, :scopeType, :brandId, :orgUnitId, :positionId)
                """, base(principal)
                .addValue("id", UUID.randomUUID())
                .addValue("versionId", versionId)
                .addValue("scopeType", scopeType)
                .addValue("brandId", scope.brandId())
                .addValue("orgUnitId", scope.orgUnitId())
                .addValue("positionId", scope.positionId()));
    }

    private TenantPrincipal prepare() {
        TenantPrincipal principal = accessPolicy.principal();
        databaseContext.apply(principal.tenantId());
        return principal;
    }

    private MapSqlParameterSource base(TenantPrincipal principal) {
        return new MapSqlParameterSource("tenantId", principal.tenantId());
    }

    private void requireOwned(String table, TenantPrincipal principal, UUID id) {
        if (!List.of("standard_category", "standard_definition", "org_unit", "position_definition", "brand").contains(table)) {
            throw new IllegalArgumentException("不允许的实体类型");
        }
        Integer count = jdbc.queryForObject(
                "select count(*) from " + table + " where tenant_id = :tenantId and id = :id",
                base(principal).addValue("id", id), Integer.class);
        if (count == null || count == 0) {
            throw new IllegalArgumentException("资源不存在或不属于当前租户");
        }
    }
}
