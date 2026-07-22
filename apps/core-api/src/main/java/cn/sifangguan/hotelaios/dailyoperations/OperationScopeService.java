package cn.sifangguan.hotelaios.dailyoperations;

import cn.sifangguan.hotelaios.shared.context.TenantPrincipal;
import cn.sifangguan.hotelaios.shared.db.TenantDatabaseContext;
import cn.sifangguan.hotelaios.shared.security.AccessDeniedException;
import cn.sifangguan.hotelaios.shared.security.AccessPolicy;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Component;

import java.util.List;
import java.util.UUID;

/** Shared, server-side scope resolution for V21 operation resources. */
@Component
class OperationScopeService {
    static final UUID EMPTY_SCOPE = new UUID(0, 0);

    private final NamedParameterJdbcTemplate jdbc;
    private final TenantDatabaseContext databaseContext;
    private final AccessPolicy accessPolicy;

    OperationScopeService(
            NamedParameterJdbcTemplate jdbc,
            TenantDatabaseContext databaseContext,
            AccessPolicy accessPolicy
    ) {
        this.jdbc = jdbc;
        this.databaseContext = databaseContext;
        this.accessPolicy = accessPolicy;
    }

    TenantPrincipal prepare() {
        TenantPrincipal principal = accessPolicy.principal();
        databaseContext.apply(principal.tenantId());
        return principal;
    }

    OrgSelection resolveOrg(TenantPrincipal principal, UUID requestedOrgUnitId) {
        if (requestedOrgUnitId != null) {
            accessPolicy.requireOrgScope(requestedOrgUnitId);
            return findOrg(principal, requestedOrgUnitId);
        }
        List<OrgSelection> choices;
        if (principal.hasTenantScope()) {
            choices = jdbc.query("""
                    select id, name, unit_type
                    from org_unit
                    where tenant_id = :tenantId and status = 'ACTIVE'
                    order by case unit_type when 'HOTEL' then 0 when 'GROUP' then 1
                               when 'REGION' then 2 else 3 end,
                             sort_order, code
                    limit 1
                    """, base(principal), (rs, rowNum) -> new OrgSelection(
                    rs.getObject("id", UUID.class), rs.getString("name"), rs.getString("unit_type")));
        } else {
            if (principal.orgScopes().isEmpty()) {
                throw new AccessDeniedException("当前账号没有可用的组织数据范围");
            }
            choices = jdbc.query("""
                    select id, name, unit_type
                    from org_unit
                    where tenant_id = :tenantId and id in (:orgScopes) and status = 'ACTIVE'
                    order by case unit_type when 'HOTEL' then 0 when 'DEPARTMENT' then 1
                               when 'REGION' then 2 else 3 end,
                             sort_order, code
                    limit 1
                    """, base(principal).addValue("orgScopes", principal.orgScopes()),
                    (rs, rowNum) -> new OrgSelection(
                            rs.getObject("id", UUID.class), rs.getString("name"), rs.getString("unit_type")));
        }
        if (choices.isEmpty()) {
            throw new IllegalArgumentException("当前授权范围内没有启用的组织");
        }
        return choices.getFirst();
    }

    void requireVisibleHotel(TenantPrincipal principal, UUID hotelOrgUnitId) {
        if (principal.hasTenantScope()) return;
        if (principal.orgScopes().isEmpty()) {
            throw new AccessDeniedException("目标门店不在当前账号的数据范围内");
        }
        Integer count = jdbc.queryForObject("""
                select count(*)
                from org_unit hotel
                where hotel.tenant_id = :tenantId and hotel.id = :hotelId
                  and hotel.unit_type = 'HOTEL' and hotel.status = 'ACTIVE'
                  and exists (
                    select 1 from org_unit_closure scope_relation
                    where scope_relation.tenant_id = hotel.tenant_id
                      and scope_relation.ancestor_id = hotel.id
                      and scope_relation.descendant_id in (:orgScopes)
                  )
                """, base(principal)
                .addValue("hotelId", hotelOrgUnitId)
                .addValue("orgScopes", principal.orgScopes()), Integer.class);
        if (count == null || count != 1) {
            throw new AccessDeniedException("目标门店不在当前账号的数据范围内");
        }
    }

    MapSqlParameterSource visibility(TenantPrincipal principal) {
        return base(principal)
                .addValue("tenantScope", principal.hasTenantScope())
                .addValue("orgScopes", principal.orgScopes().isEmpty()
                        ? List.of(EMPTY_SCOPE) : principal.orgScopes());
    }

    MapSqlParameterSource base(TenantPrincipal principal) {
        return new MapSqlParameterSource("tenantId", principal.tenantId());
    }

    private OrgSelection findOrg(TenantPrincipal principal, UUID orgUnitId) {
        List<OrgSelection> rows = jdbc.query("""
                select id, name, unit_type from org_unit
                where tenant_id = :tenantId and id = :orgUnitId and status = 'ACTIVE'
                """, base(principal).addValue("orgUnitId", orgUnitId),
                (rs, rowNum) -> new OrgSelection(
                        rs.getObject("id", UUID.class), rs.getString("name"), rs.getString("unit_type")));
        if (rows.size() != 1) {
            throw new IllegalArgumentException("目标组织不存在或未启用");
        }
        return rows.getFirst();
    }

    record OrgSelection(UUID id, String name, String unitType) {
    }
}
