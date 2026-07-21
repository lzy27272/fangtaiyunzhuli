package cn.sifangguan.hotelaios.iam;

import cn.sifangguan.hotelaios.shared.context.TenantPrincipal;
import cn.sifangguan.hotelaios.shared.db.TenantDatabaseContext;
import cn.sifangguan.hotelaios.shared.security.AccessPolicy;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.OffsetDateTime;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

@Service
public class IamService {
    private final NamedParameterJdbcTemplate jdbc;
    private final TenantDatabaseContext databaseContext;
    private final AccessPolicy accessPolicy;

    public IamService(NamedParameterJdbcTemplate jdbc, TenantDatabaseContext databaseContext, AccessPolicy accessPolicy) {
        this.jdbc = jdbc;
        this.databaseContext = databaseContext;
        this.accessPolicy = accessPolicy;
    }

    @Transactional(readOnly = true)
    public IamModels.Me me() {
        TenantPrincipal principal = prepare();
        MapSqlParameterSource params = base(principal).addValue("accountId", principal.actorId());
        IamModels.Account account = jdbc.queryForObject("""
                select id, login_name, display_name, status
                from user_account
                where tenant_id = :tenantId and id = :accountId
                """, params, (rs, rowNum) -> new IamModels.Account(
                rs.getObject("id", UUID.class),
                rs.getString("login_name"),
                rs.getString("display_name"),
                rs.getString("status")
        ));

        List<IamModels.Employee> employees = jdbc.query("""
                select id, employee_no, name, employment_status
                from employee
                where tenant_id = :tenantId and account_id = :accountId
                """, params, (rs, rowNum) -> new IamModels.Employee(
                rs.getObject("id", UUID.class),
                rs.getString("employee_no"),
                rs.getString("name"),
                rs.getString("employment_status")
        ));

        List<IamModels.PositionAssignment> assignments = jdbc.query("""
                select epa.id, epa.org_unit_id, ou.code as org_code, ou.name as org_name,
                       epa.position_id, pd.code as position_code, pd.name as position_name,
                       epa.is_primary, epa.assignment_type, epa.valid_from, epa.valid_to
                from employee e
                join employee_position_assignment epa
                  on epa.tenant_id = e.tenant_id and epa.employee_id = e.id
                join org_unit ou
                  on ou.tenant_id = epa.tenant_id and ou.id = epa.org_unit_id
                join position_definition pd
                  on pd.tenant_id = epa.tenant_id and pd.id = epa.position_id
                where e.tenant_id = :tenantId
                  and e.account_id = :accountId
                  and epa.status = 'ACTIVE'
                  and epa.valid_from <= current_date
                  and (epa.valid_to is null or epa.valid_to >= current_date)
                order by epa.is_primary desc, pd.name, ou.name
                """, params, (rs, rowNum) -> new IamModels.PositionAssignment(
                rs.getObject("id", UUID.class),
                rs.getObject("org_unit_id", UUID.class),
                rs.getString("org_code"),
                rs.getString("org_name"),
                rs.getObject("position_id", UUID.class),
                rs.getString("position_code"),
                rs.getString("position_name"),
                rs.getBoolean("is_primary"),
                rs.getString("assignment_type"),
                rs.getObject("valid_from", java.time.LocalDate.class),
                rs.getObject("valid_to", java.time.LocalDate.class)
        ));

        return new IamModels.Me(
                principal.tenantId(),
                account,
                employees.isEmpty() ? null : employees.getFirst(),
                principal.roleCode(),
                principal.roleCodes(),
                principal.permissions(),
                principal.hasTenantScope(),
                principal.orgScopes(),
                assignments
        );
    }

    @Transactional(readOnly = true)
    public List<Map<String, Object>> listPermissions() {
        accessPolicy.requirePermission("iam.manage");
        prepare();
        return jdbc.queryForList("select id, code, resource, action, description from permission order by resource, action", Map.of());
    }

    @Transactional(readOnly = true)
    public List<Map<String, Object>> listRoles() {
        accessPolicy.requirePermission("iam.manage");
        TenantPrincipal principal = prepare();
        return jdbc.queryForList("""
                select r.id, r.code, r.name, r.role_type,
                       count(rp.permission_id) as permission_count
                from app_role r
                left join role_permission rp on rp.tenant_id = r.tenant_id and rp.role_id = r.id
                where r.tenant_id = :tenantId
                group by r.id, r.code, r.name, r.role_type
                order by r.name
                """, base(principal));
    }

    @Transactional
    public Map<String, Object> createRole(IamModels.CreateRole request) {
        accessPolicy.requirePermission("iam.manage");
        TenantPrincipal principal = prepare();
        UUID id = UUID.randomUUID();
        MapSqlParameterSource params = base(principal)
                .addValue("id", id)
                .addValue("code", request.code().trim().toUpperCase())
                .addValue("name", request.name().trim())
                .addValue("roleType", request.roleType() == null ? "CUSTOM" : request.roleType().toUpperCase());
        jdbc.update("""
                insert into app_role (id, tenant_id, code, name, role_type)
                values (:id, :tenantId, :code, :name, :roleType)
                """, params);
        return Map.of("id", id, "code", request.code(), "name", request.name());
    }

    @Transactional
    public void setPermissions(UUID roleId, IamModels.SetPermissions request) {
        accessPolicy.requirePermission("iam.manage");
        TenantPrincipal principal = prepare();
        requireOwned("app_role", principal, roleId);
        jdbc.update("delete from role_permission where tenant_id = :tenantId and role_id = :roleId",
                base(principal).addValue("roleId", roleId));
        for (UUID permissionId : request.permissionIds()) {
            jdbc.update("""
                    insert into role_permission (tenant_id, role_id, permission_id)
                    select :tenantId, :roleId, p.id from permission p where p.id = :permissionId
                    """, base(principal)
                    .addValue("roleId", roleId)
                    .addValue("permissionId", permissionId));
        }
    }

    @Transactional
    public Map<String, Object> grantRole(IamModels.GrantRole request) {
        accessPolicy.requirePermission("iam.manage");
        TenantPrincipal principal = prepare();
        requireOwned("user_account", principal, request.accountId());
        requireOwned("app_role", principal, request.roleId());
        if (request.scopeOrgUnitId() != null) {
            requireOwned("org_unit", principal, request.scopeOrgUnitId());
            accessPolicy.requireOrgScope(request.scopeOrgUnitId());
        }
        UUID id = UUID.randomUUID();
        MapSqlParameterSource params = base(principal)
                .addValue("id", id)
                .addValue("accountId", request.accountId())
                .addValue("roleId", request.roleId())
                .addValue("scopeOrgUnitId", request.scopeOrgUnitId())
                .addValue("scopeType", request.scopeType().toUpperCase())
                .addValue("validFrom", request.validFrom() == null ? OffsetDateTime.now() : request.validFrom())
                .addValue("validTo", request.validTo())
                .addValue("grantedBy", principal.actorId());
        jdbc.update("""
                insert into role_assignment
                    (id, tenant_id, account_id, role_id, scope_org_unit_id, scope_type,
                     valid_from, valid_to, granted_by)
                values
                    (:id, :tenantId, :accountId, :roleId, :scopeOrgUnitId, :scopeType,
                     :validFrom, :validTo, :grantedBy)
                """, params);
        return Map.of("id", id, "accountId", request.accountId(), "roleId", request.roleId());
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
        if (!List.of("app_role", "user_account", "org_unit").contains(table)) {
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
