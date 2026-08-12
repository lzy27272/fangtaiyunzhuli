package cn.sifangguan.hotelaios.shared.security;

import cn.sifangguan.hotelaios.shared.context.TenantPrincipal;
import cn.sifangguan.hotelaios.shared.db.TenantDatabaseContext;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;
import java.util.UUID;

/** Resolves roles, permissions, active positions and organization scope on every request. */
@Service
public class EffectiveIdentityService {
    private static final List<String> ROLE_PRIORITY = List.of(
            "PLATFORM_ADMIN", "GROUP_ADMIN", "CEO", "GENERAL_MANAGER",
            "ASSISTANT_GENERAL_MANAGER", "OTA_OPERATION_MANAGER",
            "FRONT_OFFICE_SUPERVISOR", "HOUSEKEEPING_SUPERVISOR",
            "OTA_OPERATION_ASSISTANT", "FRONT_DESK"
    );

    private final NamedParameterJdbcTemplate jdbc;
    private final TenantDatabaseContext databaseContext;

    public EffectiveIdentityService(NamedParameterJdbcTemplate jdbc, TenantDatabaseContext databaseContext) {
        this.jdbc = jdbc;
        this.databaseContext = databaseContext;
    }

    @Transactional(readOnly = true)
    public TenantPrincipal resolve(UUID tenantId, UUID accountId, UUID correlationId) {
        databaseContext.apply(tenantId);
        MapSqlParameterSource params = new MapSqlParameterSource()
                .addValue("tenantId", tenantId)
                .addValue("accountId", accountId);

        Integer activeAccounts = jdbc.queryForObject("""
                select count(*)
                from user_account
                where tenant_id = :tenantId and id = :accountId and status = 'ACTIVE'
                """, params, Integer.class);
        if (activeAccounts == null || activeAccounts != 1) {
            throw new IdentityAuthenticationException("账号不存在、已停用或不属于当前租户");
        }

        List<RoleGrant> grants = jdbc.query("""
                select distinct r.code, ra.scope_type, ra.scope_org_unit_id
                from role_assignment ra
                join app_role r
                  on r.tenant_id = ra.tenant_id and r.id = ra.role_id
                where ra.tenant_id = :tenantId
                  and ra.account_id = :accountId
                  and ra.valid_from <= now()
                  and (ra.valid_to is null or ra.valid_to > now())
                """, params, (rs, rowNum) -> new RoleGrant(
                rs.getString("code"),
                rs.getString("scope_type"),
                rs.getObject("scope_org_unit_id", UUID.class)
        ));

        Set<String> roles = new LinkedHashSet<>();
        boolean tenantScope = false;
        Set<UUID> directScopes = new LinkedHashSet<>();
        Set<UUID> treeRoots = new LinkedHashSet<>();
        for (RoleGrant grant : grants) {
            roles.add(grant.roleCode());
            switch (grant.scopeType()) {
                case "TENANT" -> tenantScope = true;
                case "ORG_TREE" -> addIfPresent(treeRoots, grant.scopeOrgUnitId());
                case "ORG_UNIT" -> addIfPresent(directScopes, grant.scopeOrgUnitId());
                case "SELF" -> {
                    // SELF scope is materialized below from active employee assignments.
                }
                default -> throw new IdentityAuthenticationException("账号存在不支持的数据范围类型");
            }
        }

        Set<String> permissions = new LinkedHashSet<>(jdbc.queryForList("""
                select distinct p.code
                from role_assignment ra
                join role_permission rp
                  on rp.tenant_id = ra.tenant_id and rp.role_id = ra.role_id
                join permission p on p.id = rp.permission_id
                where ra.tenant_id = :tenantId
                  and ra.account_id = :accountId
                  and ra.valid_from <= now()
                  and (ra.valid_to is null or ra.valid_to > now())
                order by p.code
                """, params, String.class));
        if (roles.contains("PLATFORM_ADMIN")) {
            permissions.add("*");
        }

        List<AssignmentScope> activeAssignments = jdbc.query("""
                select epa.id, epa.org_unit_id
                from employee e
                join employee_position_assignment epa
                  on epa.tenant_id = e.tenant_id and epa.employee_id = e.id
                where e.tenant_id = :tenantId
                  and e.account_id = :accountId
                  and e.employment_status = 'ACTIVE'
                  and epa.status = 'ACTIVE'
                  and epa.valid_from <= current_date
                  and (epa.valid_to is null or epa.valid_to >= current_date)
                """, params, (rs, rowNum) -> new AssignmentScope(
                rs.getObject("id", UUID.class),
                rs.getObject("org_unit_id", UUID.class)
        ));
        if (activeAssignments.isEmpty()) {
            Integer linkedEmployees = jdbc.queryForObject("""
                    select count(*)
                    from employee
                    where tenant_id = :tenantId and account_id = :accountId
                    """, params, Integer.class);
            if (linkedEmployees != null && linkedEmployees > 0) {
                throw new IdentityAuthenticationException("Employee account has no current active position assignment");
            }
        }

        Set<UUID> assignmentIds = new LinkedHashSet<>();
        for (AssignmentScope assignment : activeAssignments) {
            assignmentIds.add(assignment.assignmentId());
        }

        boolean hasSelfRole = grants.stream().anyMatch(grant -> "SELF".equals(grant.scopeType()));
        if (hasSelfRole) {
            activeAssignments.forEach(assignment -> directScopes.add(assignment.orgUnitId()));
        }

        Set<UUID> scopes = new LinkedHashSet<>(directScopes);
        if (!treeRoots.isEmpty()) {
            scopes.addAll(jdbc.queryForList("""
                    select distinct descendant_id
                    from org_unit_closure
                    where tenant_id = :tenantId and ancestor_id in (:treeRoots)
                    """, new MapSqlParameterSource()
                    .addValue("tenantId", tenantId)
                    .addValue("treeRoots", treeRoots), UUID.class));
        }

        String primaryRole = roles.stream()
                .min(Comparator.comparingInt(EffectiveIdentityService::priorityOf).thenComparing(String::compareTo))
                .orElse("UNASSIGNED");

        return new TenantPrincipal(
                tenantId,
                accountId,
                primaryRole,
                roles,
                permissions,
                scopes,
                assignmentIds,
                tenantScope,
                correlationId
        );
    }

    private static int priorityOf(String role) {
        int index = ROLE_PRIORITY.indexOf(role);
        return index < 0 ? ROLE_PRIORITY.size() : index;
    }

    private static <T> void addIfPresent(Set<T> target, T value) {
        if (value != null) {
            target.add(value);
        }
    }

    private record RoleGrant(String roleCode, String scopeType, UUID scopeOrgUnitId) {
    }

    private record AssignmentScope(UUID assignmentId, UUID orgUnitId) {
    }
}
