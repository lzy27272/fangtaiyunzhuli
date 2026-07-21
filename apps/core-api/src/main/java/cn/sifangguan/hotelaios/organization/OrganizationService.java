package cn.sifangguan.hotelaios.organization;

import cn.sifangguan.hotelaios.shared.audit.AuditWriter;
import cn.sifangguan.hotelaios.shared.context.TenantPrincipal;
import cn.sifangguan.hotelaios.shared.db.TenantDatabaseContext;
import cn.sifangguan.hotelaios.shared.security.AccessPolicy;
import cn.sifangguan.hotelaios.shared.security.AccessDeniedException;
import cn.sifangguan.hotelaios.shared.security.PilotPasswordHasher;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

@Service
public class OrganizationService {
    private final NamedParameterJdbcTemplate jdbc;
    private final TenantDatabaseContext databaseContext;
    private final AccessPolicy accessPolicy;
    private final PilotPasswordHasher passwordHasher;
    private final AuditWriter auditWriter;

    public OrganizationService(
            NamedParameterJdbcTemplate jdbc,
            TenantDatabaseContext databaseContext,
            AccessPolicy accessPolicy,
            PilotPasswordHasher passwordHasher,
            AuditWriter auditWriter
    ) {
        this.jdbc = jdbc;
        this.databaseContext = databaseContext;
        this.accessPolicy = accessPolicy;
        this.passwordHasher = passwordHasher;
        this.auditWriter = auditWriter;
    }

    @Transactional(readOnly = true)
    public List<Map<String, Object>> listOrgUnits(String unitType) {
        accessPolicy.requirePermission("org.read");
        TenantPrincipal principal = prepare();
        if (!principal.hasTenantScope() && principal.orgScopes().isEmpty()) {
            return List.of();
        }
        MapSqlParameterSource parameters = base(principal).addValue("unitType", normalize(unitType));
        String visibility = visibility("o", principal, parameters);
        return jdbc.queryForList("""
                select o.id, o.parent_id, o.code, o.name, o.unit_type, o.status, o.sort_order,
                       h.property_code, h.city, h.room_count, h.opening_date
                from org_unit o
                left join hotel_profile h on h.tenant_id = o.tenant_id and h.org_unit_id = o.id
                where o.tenant_id = :tenantId
                  and (cast(:unitType as varchar) is null or o.unit_type = :unitType)
                """ + visibility + " order by o.sort_order, o.name", parameters);
    }

    @Transactional
    public Map<String, Object> createOrgUnit(OrganizationModels.CreateOrgUnit request) {
        accessPolicy.requirePermission("org.manage");
        TenantPrincipal principal = prepare();
        UUID id = UUID.randomUUID();
        String unitType = normalize(request.unitType());
        if (!Set.of("GROUP", "REGION", "HOTEL", "DEPARTMENT").contains(unitType)) {
            throw new IllegalArgumentException("组织类型必须为集团、区域、门店或部门");
        }
        String parentType = null;
        if (request.parentId() != null) {
            parentType = requireOrgType(principal, request.parentId());
            accessPolicy.requireOrgScope(request.parentId());
        } else if (!principal.hasTenantScope()) {
            throw new AccessDeniedException("仅租户级管理员可以创建根组织");
        }
        validateHierarchy(unitType, request.parentId(), parentType);
        if ("HOTEL".equals(unitType) && isBlank(request.propertyCode())) {
            throw new IllegalArgumentException("创建门店时必须填写门店编码");
        }
        if (request.roomCount() != null && request.roomCount() < 0) {
            throw new IllegalArgumentException("房间数不能小于0");
        }
        requireUniqueCode("org_unit", principal, id, request.code(), "组织编码已存在");
        MapSqlParameterSource parameters = base(principal)
                .addValue("id", id)
                .addValue("parentId", request.parentId())
                .addValue("code", request.code().trim())
                .addValue("name", request.name().trim())
                .addValue("unitType", unitType)
                .addValue("sortOrder", request.sortOrder() == null ? 0 : request.sortOrder())
                .addValue("propertyCode", trimToNull(request.propertyCode()))
                .addValue("city", trimToNull(request.city()))
                .addValue("roomCount", request.roomCount())
                .addValue("openingDate", request.openingDate());
        jdbc.update("""
                insert into org_unit (id, tenant_id, parent_id, code, name, unit_type, sort_order)
                values (:id, :tenantId, :parentId, :code, :name, :unitType, :sortOrder)
                """, parameters);
        jdbc.update("""
                insert into org_unit_closure (tenant_id, ancestor_id, descendant_id, depth)
                values (:tenantId, :id, :id, 0)
                """, parameters);
        if (request.parentId() != null) {
            jdbc.update("""
                    insert into org_unit_closure (tenant_id, ancestor_id, descendant_id, depth)
                    select tenant_id, ancestor_id, :id, depth + 1
                    from org_unit_closure
                    where tenant_id = :tenantId and descendant_id = :parentId
                    """, parameters);
        }
        if ("HOTEL".equals(unitType)) {
            jdbc.update("""
                    insert into hotel_profile
                        (id, tenant_id, org_unit_id, property_code, city, room_count, opening_date)
                    values
                        (:hotelId, :tenantId, :id, :propertyCode, :city, :roomCount, :openingDate)
                    """, parameters.addValue("hotelId", UUID.randomUUID()));
        }
        Map<String, Object> response = new LinkedHashMap<>();
        response.put("id", id);
        response.put("code", request.code());
        response.put("name", request.name());
        response.put("unitType", unitType);
        response.put("propertyCode", trimToNull(request.propertyCode()));
        return response;
    }

    @Transactional
    public Map<String, Object> updateOrgUnit(UUID orgUnitId, OrganizationModels.UpdateOrgUnit request) {
        accessPolicy.requirePermission("org.manage");
        TenantPrincipal principal = prepare();
        Map<String, Object> current = requireOrg(principal, orgUnitId);
        accessPolicy.requireOrgScope(orgUnitId);
        String unitType = String.valueOf(current.get("unit_type"));
        String status = lifecycleStatus(request.status());
        if ("GROUP".equals(unitType) && "INACTIVE".equals(status)) {
            throw new IllegalArgumentException("集团根组织不能停用");
        }
        if (request.roomCount() != null && request.roomCount() < 0) {
            throw new IllegalArgumentException("房间数不能小于0");
        }
        if ("HOTEL".equals(unitType) && isBlank(request.propertyCode())) {
            throw new IllegalArgumentException("门店必须保留门店编码");
        }
        requireUniqueCode("org_unit", principal, orgUnitId, request.code(), "组织编码已存在");
        if ("ACTIVE".equals(status) && current.get("parent_id") != null) {
            Integer activeParent = jdbc.queryForObject("""
                    select count(*) from org_unit
                    where tenant_id = :tenantId and id = :parentId and status = 'ACTIVE'
                    """, base(principal).addValue("parentId", current.get("parent_id")), Integer.class);
            if (activeParent == null || activeParent != 1) {
                throw new IllegalArgumentException("上级组织未启用，不能启用当前组织");
            }
        }
        MapSqlParameterSource parameters = base(principal)
                .addValue("id", orgUnitId)
                .addValue("code", request.code().trim())
                .addValue("name", request.name().trim())
                .addValue("sortOrder", request.sortOrder() == null ? 0 : request.sortOrder())
                .addValue("status", status)
                .addValue("propertyCode", trimToNull(request.propertyCode()))
                .addValue("city", trimToNull(request.city()))
                .addValue("roomCount", request.roomCount())
                .addValue("openingDate", request.openingDate());
        jdbc.update("""
                update org_unit
                set code = :code, name = :name, sort_order = :sortOrder, status = :status, updated_at = now()
                where tenant_id = :tenantId and id = :id
                """, parameters);
        if ("HOTEL".equals(unitType)) {
            jdbc.update("""
                    update hotel_profile
                    set property_code = :propertyCode, city = :city, room_count = :roomCount,
                        opening_date = :openingDate, updated_at = now()
                    where tenant_id = :tenantId and org_unit_id = :id
                    """, parameters);
        }
        if ("INACTIVE".equals(status)) {
            deactivateOrgTree(principal, orgUnitId);
        }
        auditWriter.record("ORG_UNIT_UPDATED", "ORG_UNIT", orgUnitId,
                "{\"status\":\"" + status + "\",\"code\":\"" + jsonEscape(request.code().trim()) + "\"}");
        return Map.of("id", orgUnitId, "code", request.code().trim(), "name", request.name().trim(),
                "unitType", unitType, "status", status);
    }

    @Transactional
    public void deleteOrgUnit(UUID orgUnitId) {
        accessPolicy.requirePermission("org.manage");
        TenantPrincipal principal = prepare();
        requireTenantScope(principal, "组织删除只能由集团级管理员执行");
        Map<String, Object> current = requireOrg(principal, orgUnitId);
        if ("GROUP".equals(String.valueOf(current.get("unit_type")))) {
            throw new IllegalArgumentException("集团根组织不能删除");
        }
        if (!"INACTIVE".equals(String.valueOf(current.get("status")))) {
            throw new IllegalArgumentException("请先停用组织，再执行删除");
        }
        Integer children = jdbc.queryForObject("""
                select count(*) from org_unit
                where tenant_id = :tenantId and parent_id = :id
                """, base(principal).addValue("id", orgUnitId), Integer.class);
        if (children != null && children > 0) {
            throw new IllegalArgumentException("该组织仍有下级组织，只能停用，不能删除");
        }
        try {
            MapSqlParameterSource parameters = base(principal).addValue("id", orgUnitId);
            jdbc.update("delete from hotel_profile where tenant_id = :tenantId and org_unit_id = :id", parameters);
            int deleted = jdbc.update("delete from org_unit where tenant_id = :tenantId and id = :id", parameters);
            if (deleted != 1) {
                throw new IllegalArgumentException("组织不存在或不属于当前租户");
            }
        } catch (DataIntegrityViolationException exception) {
            throw new IllegalArgumentException("该组织已有任职、权限、工作或经营数据，只能停用，不能删除", exception);
        }
        auditWriter.record("ORG_UNIT_DELETED", "ORG_UNIT", orgUnitId, "{\"status\":\"DELETED\"}");
    }

    @Transactional(readOnly = true)
    public List<Map<String, Object>> listPositions() {
        accessPolicy.requirePermission("org.read");
        TenantPrincipal principal = prepare();
        return jdbc.queryForList("""
                select id, code, name, job_family, level_code, status
                from position_definition
                where tenant_id = :tenantId
                order by job_family, level_code, name
                """, base(principal));
    }

    @Transactional
    public Map<String, Object> createPosition(OrganizationModels.CreatePosition request) {
        accessPolicy.requirePermission("org.manage");
        TenantPrincipal principal = prepare();
        requireTenantScope(principal, "岗位字典只能由集团级管理员维护");
        UUID id = UUID.randomUUID();
        requireUniqueCode("position_definition", principal, id, request.code(), "岗位编码已存在");
        MapSqlParameterSource parameters = base(principal)
                .addValue("id", id)
                .addValue("code", request.code().trim())
                .addValue("name", request.name().trim())
                .addValue("jobFamily", request.jobFamily().trim())
                .addValue("levelCode", request.levelCode());
        jdbc.update("""
                insert into position_definition (id, tenant_id, code, name, job_family, level_code)
                values (:id, :tenantId, :code, :name, :jobFamily, :levelCode)
                """, parameters);
        return Map.of("id", id, "code", request.code(), "name", request.name());
    }

    @Transactional
    public Map<String, Object> updatePosition(UUID positionId, OrganizationModels.UpdatePosition request) {
        accessPolicy.requirePermission("org.manage");
        TenantPrincipal principal = prepare();
        requireTenantScope(principal, "岗位字典只能由集团级管理员维护");
        requireEntity("position_definition", principal, positionId);
        requireUniqueCode("position_definition", principal, positionId, request.code(), "岗位编码已存在");
        String status = lifecycleStatus(request.status());
        MapSqlParameterSource parameters = base(principal)
                .addValue("id", positionId)
                .addValue("code", request.code().trim())
                .addValue("name", request.name().trim())
                .addValue("jobFamily", request.jobFamily().trim())
                .addValue("levelCode", trimToNull(request.levelCode()))
                .addValue("status", status);
        jdbc.update("""
                update position_definition
                set code = :code, name = :name, job_family = :jobFamily,
                    level_code = :levelCode, status = :status, updated_at = now()
                where tenant_id = :tenantId and id = :id
                """, parameters);
        if ("INACTIVE".equals(status)) {
            jdbc.update("""
                    update employee_position_assignment
                    set status = 'INACTIVE', valid_to = case
                        when valid_to is null or valid_to > current_date then current_date else valid_to end,
                        updated_at = now()
                    where tenant_id = :tenantId and position_id = :id and status = 'ACTIVE'
                    """, parameters);
        }
        auditWriter.record("POSITION_UPDATED", "POSITION", positionId,
                "{\"status\":\"" + status + "\",\"code\":\"" + jsonEscape(request.code().trim()) + "\"}");
        return Map.of("id", positionId, "code", request.code().trim(), "name", request.name().trim(), "status", status);
    }

    @Transactional
    public void deletePosition(UUID positionId) {
        accessPolicy.requirePermission("org.manage");
        TenantPrincipal principal = prepare();
        requireTenantScope(principal, "岗位删除只能由集团级管理员执行");
        String status = jdbc.queryForObject("""
                select status from position_definition
                where tenant_id = :tenantId and id = :id
                """, base(principal).addValue("id", positionId), String.class);
        if (!"INACTIVE".equals(status)) {
            throw new IllegalArgumentException("请先停用岗位，再执行删除");
        }
        try {
            int deleted = jdbc.update("""
                    delete from position_definition where tenant_id = :tenantId and id = :id
                    """, base(principal).addValue("id", positionId));
            if (deleted != 1) {
                throw new IllegalArgumentException("岗位不存在或不属于当前租户");
            }
        } catch (DataIntegrityViolationException exception) {
            throw new IllegalArgumentException("该岗位已有任职、标准、表单或工作包数据，只能停用，不能删除", exception);
        }
        auditWriter.record("POSITION_DELETED", "POSITION", positionId, "{\"status\":\"DELETED\"}");
    }

    @Transactional(readOnly = true)
    public List<Map<String, Object>> listEmployees() {
        accessPolicy.requirePermission("org.read");
        TenantPrincipal principal = prepare();
        if (!principal.hasTenantScope() && principal.orgScopes().isEmpty()) {
            return List.of();
        }
        MapSqlParameterSource parameters = base(principal);
        String visibility = visibility("o", principal, parameters);
        return jdbc.queryForList("""
                select distinct e.id, e.account_id, u.login_name, u.status as account_status,
                       e.employee_no, e.name, e.mobile, e.employment_status, e.hired_on,
                       a.id as assignment_id, a.is_primary, a.valid_from, a.valid_to,
                       o.id as org_unit_id, o.name as org_unit_name,
                       p.id as position_id, p.name as position_name
                from employee e
                left join user_account u on u.tenant_id = e.tenant_id and u.id = e.account_id
                left join employee_position_assignment a
                  on a.tenant_id = e.tenant_id and a.employee_id = e.id and a.status = 'ACTIVE'
                left join org_unit o on o.tenant_id = a.tenant_id and o.id = a.org_unit_id
                left join position_definition p on p.tenant_id = a.tenant_id and p.id = a.position_id
                where e.tenant_id = :tenantId
                """ + visibility + " order by e.name, a.is_primary desc", parameters);
    }

    @Transactional
    public Map<String, Object> createEmployee(OrganizationModels.CreateEmployee request) {
        accessPolicy.requirePermission("org.manage");
        TenantPrincipal principal = prepare();
        requireTenantScope(principal, "员工账号只能由集团级管理员创建");
        UUID id = UUID.randomUUID();
        requireUniqueCode("employee", principal, id, request.employeeNo(), "员工编号已存在");
        UUID accountId = null;
        String loginName = trimToNull(request.loginName());
        String temporaryPassword = request.temporaryPassword();
        if (loginName != null) {
            requireUniqueLogin(principal, null, loginName);
            passwordHasher.requirePassword(temporaryPassword);
            accountId = UUID.randomUUID();
        } else if (!isBlank(temporaryPassword)) {
            throw new IllegalArgumentException("设置初始密码时必须同时填写登录账号");
        }
        MapSqlParameterSource parameters = base(principal)
                .addValue("id", id)
                .addValue("accountId", accountId)
                .addValue("employeeNo", request.employeeNo().trim())
                .addValue("name", request.name().trim())
                .addValue("mobile", request.mobile())
                .addValue("hiredOn", request.hiredOn())
                .addValue("loginName", loginName == null ? null : loginName.toLowerCase())
                .addValue("passwordHash", accountId == null ? null : passwordHasher.hash(temporaryPassword));
        if (accountId != null) {
            jdbc.update("""
                    insert into user_account
                        (id, tenant_id, login_name, display_name, mobile, password_hash, password_changed_at)
                    values
                        (:accountId, :tenantId, :loginName, :name, :mobile, :passwordHash, now())
                    """, parameters);
        }
        jdbc.update("""
                insert into employee (id, tenant_id, account_id, employee_no, name, mobile, hired_on)
                values (:id, :tenantId, :accountId, :employeeNo, :name, :mobile, :hiredOn)
                """, parameters);
        Map<String, Object> response = new LinkedHashMap<>();
        response.put("id", id);
        response.put("accountId", accountId);
        response.put("employeeNo", request.employeeNo());
        response.put("name", request.name());
        response.put("loginName", loginName);
        return response;
    }

    @Transactional
    public Map<String, Object> updateEmployee(UUID employeeId, OrganizationModels.UpdateEmployee request) {
        accessPolicy.requirePermission("org.manage");
        TenantPrincipal principal = prepare();
        requireTenantScope(principal, "员工账号只能由集团级管理员维护");
        Map<String, Object> current = requireEmployee(principal, employeeId);
        requireUniqueCode("employee", principal, employeeId, request.employeeNo(), "员工编号已存在");
        String employmentStatus = lifecycleStatus(request.employmentStatus());
        UUID accountId = (UUID) current.get("account_id");
        String loginName = trimToNull(request.loginName());
        String temporaryPassword = request.temporaryPassword();
        if (loginName != null) {
            requireUniqueLogin(principal, accountId, loginName);
        }
        MapSqlParameterSource parameters = base(principal)
                .addValue("id", employeeId)
                .addValue("employeeNo", request.employeeNo().trim())
                .addValue("name", request.name().trim())
                .addValue("mobile", trimToNull(request.mobile()))
                .addValue("hiredOn", request.hiredOn())
                .addValue("employmentStatus", employmentStatus);
        if (accountId == null && loginName != null) {
            passwordHasher.requirePassword(temporaryPassword);
            accountId = UUID.randomUUID();
            parameters.addValue("accountId", accountId)
                    .addValue("loginName", loginName.toLowerCase())
                    .addValue("passwordHash", passwordHasher.hash(temporaryPassword));
            jdbc.update("""
                    insert into user_account
                        (id, tenant_id, login_name, display_name, mobile, status, password_hash, password_changed_at)
                    values
                        (:accountId, :tenantId, :loginName, :name, :mobile, :employmentStatus,
                         :passwordHash, now())
                    """, parameters);
        } else if (accountId != null) {
            if (loginName == null) {
                throw new IllegalArgumentException("已开通账号的员工必须保留登录账号");
            }
            parameters.addValue("accountId", accountId).addValue("loginName", loginName.toLowerCase());
            if (!isBlank(temporaryPassword)) {
                passwordHasher.requirePassword(temporaryPassword);
                parameters.addValue("passwordHash", passwordHasher.hash(temporaryPassword));
                jdbc.update("""
                        update user_account
                        set login_name = :loginName, display_name = :name, mobile = :mobile,
                            status = :employmentStatus, password_hash = :passwordHash,
                            password_changed_at = now(), updated_at = now()
                        where tenant_id = :tenantId and id = :accountId
                        """, parameters);
            } else {
                jdbc.update("""
                        update user_account
                        set login_name = :loginName, display_name = :name, mobile = :mobile,
                            status = :employmentStatus, updated_at = now()
                        where tenant_id = :tenantId and id = :accountId
                        """, parameters);
            }
        } else if (!isBlank(temporaryPassword)) {
            throw new IllegalArgumentException("设置初始密码时必须同时填写登录账号");
        }
        parameters.addValue("accountId", accountId);
        jdbc.update("""
                update employee
                set account_id = :accountId, employee_no = :employeeNo, name = :name,
                    mobile = :mobile, hired_on = :hiredOn, employment_status = :employmentStatus,
                    updated_at = now()
                where tenant_id = :tenantId and id = :id
                """, parameters);
        if ("INACTIVE".equals(employmentStatus)) {
            jdbc.update("""
                    update employee_position_assignment
                    set status = 'INACTIVE', valid_to = case
                        when valid_to is null or valid_to > current_date then current_date else valid_to end,
                        updated_at = now()
                    where tenant_id = :tenantId and employee_id = :id and status = 'ACTIVE'
                    """, parameters);
            if (accountId != null) {
                jdbc.update("""
                        update role_assignment
                        set valid_to = now()
                        where tenant_id = :tenantId and account_id = :accountId
                          and (valid_to is null or valid_to > now())
                        """, parameters);
            }
        }
        auditWriter.record("EMPLOYEE_UPDATED", "EMPLOYEE", employeeId,
                "{\"status\":\"" + employmentStatus + "\",\"employeeNo\":\""
                        + jsonEscape(request.employeeNo().trim()) + "\"}");
        Map<String, Object> response = new LinkedHashMap<>();
        response.put("id", employeeId);
        response.put("accountId", accountId);
        response.put("employeeNo", request.employeeNo().trim());
        response.put("name", request.name().trim());
        response.put("loginName", loginName);
        response.put("employmentStatus", employmentStatus);
        return response;
    }

    @Transactional
    public void deleteEmployee(UUID employeeId) {
        accessPolicy.requirePermission("org.manage");
        TenantPrincipal principal = prepare();
        requireTenantScope(principal, "员工删除只能由集团级管理员执行");
        Map<String, Object> current = requireEmployee(principal, employeeId);
        if (!"INACTIVE".equals(String.valueOf(current.get("employment_status")))) {
            throw new IllegalArgumentException("请先停用员工，再执行删除");
        }
        Integer assignments = jdbc.queryForObject("""
                select count(*) from employee_position_assignment
                where tenant_id = :tenantId and employee_id = :id
                """, base(principal).addValue("id", employeeId), Integer.class);
        if (assignments != null && assignments > 0) {
            throw new IllegalArgumentException("该员工已有任职或工作历史，只能停用，不能删除");
        }
        UUID accountId = (UUID) current.get("account_id");
        try {
            MapSqlParameterSource parameters = base(principal).addValue("id", employeeId).addValue("accountId", accountId);
            int deleted = jdbc.update("delete from employee where tenant_id = :tenantId and id = :id", parameters);
            if (deleted != 1) {
                throw new IllegalArgumentException("员工不存在或不属于当前租户");
            }
            if (accountId != null) {
                jdbc.update("delete from user_account where tenant_id = :tenantId and id = :accountId", parameters);
            }
        } catch (DataIntegrityViolationException exception) {
            throw new IllegalArgumentException("该员工账号已有权限、工作或审计数据，只能停用，不能删除", exception);
        }
        auditWriter.record("EMPLOYEE_DELETED", "EMPLOYEE", employeeId, "{\"status\":\"DELETED\"}");
    }

    @Transactional
    public Map<String, Object> assignPosition(UUID employeeId, OrganizationModels.CreatePositionAssignment request) {
        accessPolicy.requirePermission("org.manage");
        TenantPrincipal principal = prepare();
        requireOrgType(principal, request.orgUnitId());
        requireEntity("employee", principal, employeeId);
        requireActiveEntity("employee", "employment_status", principal, employeeId, "员工已停用，不能分配任职");
        requireActiveEntity("position_definition", "status", principal, request.positionId(), "岗位已停用，不能分配任职");
        accessPolicy.requireOrgScope(request.orgUnitId());

        UUID id = UUID.randomUUID();
        MapSqlParameterSource parameters = base(principal)
                .addValue("id", id)
                .addValue("employeeId", employeeId)
                .addValue("orgUnitId", request.orgUnitId())
                .addValue("positionId", request.positionId())
                .addValue("managerAssignmentId", request.managerAssignmentId())
                .addValue("primary", Boolean.TRUE.equals(request.primary()))
                .addValue("assignmentType", request.assignmentType() == null ? "PERMANENT" : request.assignmentType().toUpperCase())
                .addValue("validFrom", request.validFrom())
                .addValue("validTo", request.validTo());
        jdbc.update("""
                insert into employee_position_assignment
                    (id, tenant_id, employee_id, org_unit_id, position_id, manager_assignment_id,
                     is_primary, assignment_type, valid_from, valid_to)
                values
                    (:id, :tenantId, :employeeId, :orgUnitId, :positionId, :managerAssignmentId,
                     :primary, :assignmentType, :validFrom, :validTo)
                """, parameters);
        return Map.of("id", id, "employeeId", employeeId, "orgUnitId", request.orgUnitId(), "positionId", request.positionId());
    }

    private TenantPrincipal prepare() {
        TenantPrincipal principal = accessPolicy.principal();
        databaseContext.apply(principal.tenantId());
        return principal;
    }

    private MapSqlParameterSource base(TenantPrincipal principal) {
        return new MapSqlParameterSource("tenantId", principal.tenantId());
    }

    private String visibility(String orgAlias, TenantPrincipal principal, MapSqlParameterSource parameters) {
        if (principal.hasTenantScope()) {
            return "";
        }
        parameters.addValue("scopeIds", principal.orgScopes());
        return " and exists (select 1 from org_unit_closure vis where vis.tenant_id = " + orgAlias
                + ".tenant_id and vis.descendant_id = " + orgAlias + ".id and vis.ancestor_id in (:scopeIds))";
    }

    private String requireOrgType(TenantPrincipal principal, UUID orgUnitId) {
        List<Map<String, Object>> rows = jdbc.queryForList(
                "select unit_type, status from org_unit where tenant_id = :tenantId and id = :id",
                base(principal).addValue("id", orgUnitId));
        if (rows.isEmpty()) {
            throw new IllegalArgumentException("组织不存在或不属于当前租户");
        }
        if (!"ACTIVE".equals(String.valueOf(rows.getFirst().get("status")))) {
            throw new IllegalArgumentException("组织已停用，不能继续配置任职或下级组织");
        }
        return String.valueOf(rows.getFirst().get("unit_type"));
    }

    private Map<String, Object> requireOrg(TenantPrincipal principal, UUID orgUnitId) {
        List<Map<String, Object>> rows = jdbc.queryForList("""
                select id, parent_id, code, name, unit_type, status, sort_order
                from org_unit where tenant_id = :tenantId and id = :id
                """, base(principal).addValue("id", orgUnitId));
        if (rows.isEmpty()) {
            throw new IllegalArgumentException("组织不存在或不属于当前租户");
        }
        return rows.getFirst();
    }

    private Map<String, Object> requireEmployee(TenantPrincipal principal, UUID employeeId) {
        List<Map<String, Object>> rows = jdbc.queryForList("""
                select id, account_id, employee_no, name, employment_status
                from employee where tenant_id = :tenantId and id = :id
                """, base(principal).addValue("id", employeeId));
        if (rows.isEmpty()) {
            throw new IllegalArgumentException("员工不存在或不属于当前租户");
        }
        return rows.getFirst();
    }

    private void deactivateOrgTree(TenantPrincipal principal, UUID orgUnitId) {
        MapSqlParameterSource parameters = base(principal).addValue("id", orgUnitId);
        jdbc.update("""
                update org_unit o
                set status = 'INACTIVE', updated_at = now()
                where o.tenant_id = :tenantId and exists (
                    select 1 from org_unit_closure c
                    where c.tenant_id = o.tenant_id and c.ancestor_id = :id and c.descendant_id = o.id
                )
                """, parameters);
        jdbc.update("""
                update employee_position_assignment a
                set status = 'INACTIVE', valid_to = case
                    when valid_to is null or valid_to > current_date then current_date else valid_to end,
                    updated_at = now()
                where a.tenant_id = :tenantId and a.status = 'ACTIVE' and exists (
                    select 1 from org_unit_closure c
                    where c.tenant_id = a.tenant_id and c.ancestor_id = :id and c.descendant_id = a.org_unit_id
                )
                """, parameters);
        jdbc.update("""
                update role_assignment ra
                set valid_to = now()
                where ra.tenant_id = :tenantId and (ra.valid_to is null or ra.valid_to > now())
                  and ra.scope_org_unit_id is not null and exists (
                    select 1 from org_unit_closure c
                    where c.tenant_id = ra.tenant_id and c.ancestor_id = :id
                      and c.descendant_id = ra.scope_org_unit_id
                  )
                """, parameters);
    }

    private void requireEntity(String table, TenantPrincipal principal, UUID id) {
        if (!Set.of("employee", "position_definition").contains(table)) {
            throw new IllegalArgumentException("不允许的实体类型");
        }
        Integer count = jdbc.queryForObject(
                "select count(*) from " + table + " where tenant_id = :tenantId and id = :id",
                base(principal).addValue("id", id),
                Integer.class
        );
        if (count == null || count == 0) {
            throw new IllegalArgumentException("实体不存在或不属于当前租户");
        }
    }

    private void requireActiveEntity(
            String table,
            String statusColumn,
            TenantPrincipal principal,
            UUID id,
            String message
    ) {
        if (!("employee".equals(table) && "employment_status".equals(statusColumn))
                && !("position_definition".equals(table) && "status".equals(statusColumn))) {
            throw new IllegalArgumentException("不允许的实体状态检查");
        }
        Integer count = jdbc.queryForObject(
                "select count(*) from " + table + " where tenant_id = :tenantId and id = :id and "
                        + statusColumn + " = 'ACTIVE'",
                base(principal).addValue("id", id), Integer.class);
        if (count == null || count != 1) {
            throw new IllegalArgumentException(message);
        }
    }

    private void requireUniqueCode(
            String table,
            TenantPrincipal principal,
            UUID id,
            String code,
            String message
    ) {
        String column = switch (table) {
            case "org_unit", "position_definition" -> "code";
            case "employee" -> "employee_no";
            default -> throw new IllegalArgumentException("不允许的唯一编码检查");
        };
        Integer count = jdbc.queryForObject(
                "select count(*) from " + table + " where tenant_id = :tenantId and id <> :id and lower("
                        + column + ") = lower(:code)",
                base(principal).addValue("id", id).addValue("code", code.trim()), Integer.class);
        if (count != null && count > 0) {
            throw new IllegalArgumentException(message);
        }
    }

    private void requireUniqueLogin(TenantPrincipal principal, UUID accountId, String loginName) {
        MapSqlParameterSource parameters = base(principal)
                .addValue("loginName", loginName.trim().toLowerCase());
        String exclusion = "";
        if (accountId != null) {
            parameters.addValue("accountId", accountId);
            exclusion = " and id <> :accountId";
        }
        Integer count = jdbc.queryForObject("""
                select count(*) from user_account
                where tenant_id = :tenantId and lower(login_name) = :loginName
                """ + exclusion, parameters, Integer.class);
        if (count != null && count > 0) {
            throw new IllegalArgumentException("登录账号已存在");
        }
    }

    private String normalize(String value) {
        return value == null || value.isBlank() ? null : value.trim().toUpperCase();
    }

    private String lifecycleStatus(String value) {
        String normalized = normalize(value);
        if (!Set.of("ACTIVE", "INACTIVE").contains(normalized)) {
            throw new IllegalArgumentException("状态必须为ACTIVE或INACTIVE");
        }
        return normalized;
    }

    private void validateHierarchy(String unitType, UUID parentId, String parentType) {
        if ("GROUP".equals(unitType)) {
            if (parentId != null) {
                throw new IllegalArgumentException("集团不能设置上级组织");
            }
            return;
        }
        if (parentId == null) {
            throw new IllegalArgumentException("区域、门店和部门必须选择上级组织");
        }
        boolean valid = switch (unitType) {
            case "REGION" -> "GROUP".equals(parentType);
            case "HOTEL" -> Set.of("GROUP", "REGION").contains(parentType);
            case "DEPARTMENT" -> "HOTEL".equals(parentType);
            default -> false;
        };
        if (!valid) {
            throw new IllegalArgumentException("组织层级不符合集团→区域→门店→部门模型");
        }
    }

    private void requireTenantScope(TenantPrincipal principal, String message) {
        if (!principal.hasTenantScope()) {
            throw new AccessDeniedException(message);
        }
    }

    private String trimToNull(String value) {
        return isBlank(value) ? null : value.trim();
    }

    private boolean isBlank(String value) {
        return value == null || value.isBlank();
    }

    private String jsonEscape(String value) {
        return value.replace("\\", "\\\\").replace("\"", "\\\"");
    }
}
