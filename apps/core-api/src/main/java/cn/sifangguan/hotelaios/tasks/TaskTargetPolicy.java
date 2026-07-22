package cn.sifangguan.hotelaios.tasks;

import cn.sifangguan.hotelaios.shared.context.TenantPrincipal;
import cn.sifangguan.hotelaios.shared.security.AccessDeniedException;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Component;

import java.util.ArrayList;
import java.util.Collection;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

/**
 * Task-specific target scope. It deliberately does not broaden organization,
 * work-record, dashboard or other module data permissions.
 */
@Component
public class TaskTargetPolicy {
    private static final Set<String> HOTEL_MANAGER_ROLES = Set.of(
            "HOUSEKEEPING_SUPERVISOR", "FRONT_OFFICE_SUPERVISOR",
            "ASSISTANT_GENERAL_MANAGER", "GENERAL_MANAGER"
    );
    private static final Set<String> OTA_ROLES = Set.of(
            "OTA_OPERATION_ASSISTANT", "OTA_OPERATION_MANAGER"
    );

    private final NamedParameterJdbcTemplate jdbc;

    public TaskTargetPolicy(NamedParameterJdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    public List<Map<String, Object>> listTargets(TenantPrincipal principal) {
        Collection<UUID> roots = targetScopeRoots(principal);
        return jdbc.queryForList("""
                select assignment.id as assignment_id,
                       employee.id as employee_id, employee.name as employee_name,
                       position.id as position_id, position.code as position_code,
                       position.name as position_name, position.job_family, position.level_code,
                       organization.id as org_unit_id, organization.name as org_unit_name,
                       hotel.id as hotel_id, hotel.name as hotel_name,
                       assignment.manager_assignment_id
                from employee_position_assignment assignment
                join employee on employee.tenant_id = assignment.tenant_id
                             and employee.id = assignment.employee_id
                join position_definition position on position.tenant_id = assignment.tenant_id
                                                   and position.id = assignment.position_id
                join org_unit organization on organization.tenant_id = assignment.tenant_id
                                          and organization.id = assignment.org_unit_id
                join lateral (
                    select hotel_unit.id, hotel_unit.name
                    from org_unit_closure closure
                    join org_unit hotel_unit on hotel_unit.tenant_id = closure.tenant_id
                                            and hotel_unit.id = closure.ancestor_id
                                            and hotel_unit.unit_type = 'HOTEL'
                                            and hotel_unit.status = 'ACTIVE'
                    where closure.tenant_id = assignment.tenant_id
                      and closure.descendant_id = assignment.org_unit_id
                    order by closure.depth
                    limit 1
                ) hotel on true
                where assignment.tenant_id = :tenantId
                  and assignment.status = 'ACTIVE'
                  and assignment.valid_from <= current_date
                  and (assignment.valid_to is null or assignment.valid_to >= current_date)
                  and employee.employment_status = 'ACTIVE'
                  and position.status = 'ACTIVE'
                  and organization.status = 'ACTIVE'
                  and (
                    :tenantScope = true
                    or (:otaScope = true and coalesce(position.level_code, '') like 'M%')
                    or (:otaScope = false and exists (
                        select 1 from org_unit_closure visible
                        where visible.tenant_id = assignment.tenant_id
                          and visible.descendant_id = assignment.org_unit_id
                          and visible.ancestor_id in (:scopeRoots)
                    ))
                  )
                order by hotel.name, organization.name, position.level_code desc, employee.name
                """, params(principal, roots));
    }

    public UUID resolveReviewer(
            TenantPrincipal principal,
            UUID taskOrgUnitId,
            UUID assigneeAssignmentId,
            UUID requestedReviewerAssignmentId,
            UUID creatorAssignmentId
    ) {
        requireTaskOrgAndAssignee(principal, taskOrgUnitId, assigneeAssignmentId);
        if (requestedReviewerAssignmentId != null) {
            requireReviewer(principal, assigneeAssignmentId, requestedReviewerAssignmentId, creatorAssignmentId);
            return requestedReviewerAssignmentId;
        }
        if (creatorAssignmentId != null && !creatorAssignmentId.equals(assigneeAssignmentId)) {
            requireActorAssignment(principal, creatorAssignmentId);
            requireReviewer(principal, assigneeAssignmentId, creatorAssignmentId, creatorAssignmentId);
            return creatorAssignmentId;
        }
        UUID manager = jdbc.query("""
                select manager.id
                from employee_position_assignment assignee
                join employee_position_assignment manager
                  on manager.tenant_id = assignee.tenant_id
                 and manager.id = assignee.manager_assignment_id
                 and manager.status = 'ACTIVE'
                 and manager.valid_from <= current_date
                 and (manager.valid_to is null or manager.valid_to >= current_date)
                where assignee.tenant_id = :tenantId and assignee.id = :assigneeId
                """, base(principal).addValue("assigneeId", assigneeAssignmentId),
                result -> result.next() ? result.getObject(1, UUID.class) : null);
        if (manager != null && !manager.equals(assigneeAssignmentId)) {
            requireReviewer(principal, assigneeAssignmentId, manager, creatorAssignmentId);
            return manager;
        }
        List<UUID> fallback = jdbc.queryForList("""
                select candidate.id
                from employee_position_assignment assignee
                join org_unit_closure assignee_hotel_link
                  on assignee_hotel_link.tenant_id = assignee.tenant_id
                 and assignee_hotel_link.descendant_id = assignee.org_unit_id
                join org_unit hotel on hotel.tenant_id = assignee_hotel_link.tenant_id
                                   and hotel.id = assignee_hotel_link.ancestor_id
                                   and hotel.unit_type = 'HOTEL'
                join org_unit_closure candidate_link on candidate_link.tenant_id = hotel.tenant_id
                                                    and candidate_link.ancestor_id = hotel.id
                join employee_position_assignment candidate
                  on candidate.tenant_id = candidate_link.tenant_id
                 and candidate.org_unit_id = candidate_link.descendant_id
                join position_definition position on position.tenant_id = candidate.tenant_id
                                                   and position.id = candidate.position_id
                where assignee.tenant_id = :tenantId and assignee.id = :assigneeId
                  and candidate.id <> assignee.id and candidate.status = 'ACTIVE'
                  and candidate.valid_from <= current_date
                  and (candidate.valid_to is null or candidate.valid_to >= current_date)
                  and coalesce(position.level_code, '') like 'M%'
                order by case position.code
                    when 'GENERAL_MANAGER' then 1 when 'ASSISTANT_GENERAL_MANAGER' then 2 else 3 end,
                    candidate.is_primary desc, candidate.created_at
                limit 1
                """, base(principal).addValue("assigneeId", assigneeAssignmentId), UUID.class);
        if (fallback.isEmpty()) {
            throw new IllegalArgumentException("无法自动解析验收负责人，请指定目标门店另一名有效管理任职");
        }
        UUID reviewer = fallback.getFirst();
        requireReviewer(principal, assigneeAssignmentId, reviewer, creatorAssignmentId);
        return reviewer;
    }

    public Collection<UUID> targetScopeRoots(TenantPrincipal principal) {
        if (principal.hasTenantScope()) {
            return List.of(new UUID(0, 0));
        }
        if (isOta(principal)) {
            List<UUID> hotels = jdbc.queryForList("""
                    select id from org_unit
                    where tenant_id = :tenantId and unit_type = 'HOTEL' and status = 'ACTIVE'
                    order by id
                    """, base(principal), UUID.class);
            return hotels.isEmpty() ? List.of(new UUID(0, 0)) : hotels;
        }
        if (hasAnyRole(principal, HOTEL_MANAGER_ROLES)) {
            List<UUID> hotels = jdbc.queryForList("""
                    select distinct hotel.id
                    from employee_position_assignment assignment
                    join employee on employee.tenant_id = assignment.tenant_id
                                 and employee.id = assignment.employee_id
                    join org_unit_closure closure on closure.tenant_id = assignment.tenant_id
                                                 and closure.descendant_id = assignment.org_unit_id
                    join org_unit hotel on hotel.tenant_id = closure.tenant_id
                                       and hotel.id = closure.ancestor_id
                                       and hotel.unit_type = 'HOTEL'
                                       and hotel.status = 'ACTIVE'
                    where assignment.tenant_id = :tenantId and employee.account_id = :actorId
                      and assignment.status = 'ACTIVE'
                      and assignment.valid_from <= current_date
                      and (assignment.valid_to is null or assignment.valid_to >= current_date)
                    order by hotel.id
                    """, base(principal).addValue("actorId", principal.actorId()), UUID.class);
            if (!hotels.isEmpty()) return hotels;
        }
        return principal.orgScopes().isEmpty() ? List.of(new UUID(0, 0)) : principal.orgScopes();
    }

    /**
     * Task read scope is deliberately resolved from the role grant that carries
     * task read/review permission. It must not inherit the broader delivery
     * matrix (notably OTA cross-hotel targets), nor unrelated assignments held
     * by the same employee.
     */
    public ReadScope readScope(TenantPrincipal principal) {
        List<Map<String, Object>> grants = jdbc.queryForList("""
                select distinct grant_scope.scope_type, grant_scope.scope_org_unit_id
                from role_assignment grant_scope
                join role_permission role_access
                  on role_access.tenant_id = grant_scope.tenant_id
                 and role_access.role_id = grant_scope.role_id
                join permission permission on permission.id = role_access.permission_id
                where grant_scope.tenant_id = :tenantId
                  and grant_scope.account_id = :actorId
                  and grant_scope.valid_from <= now()
                  and (grant_scope.valid_to is null or grant_scope.valid_to > now())
                  and permission.code in ('task.read', 'task.review', 'task.view', 'task.team')
                """, base(principal).addValue("actorId", principal.actorId()));
        boolean tenant = grants.stream().anyMatch(row -> "TENANT".equals(row.get("scope_type")));
        if (tenant) {
            return new ReadScope(true, Set.of());
        }
        Set<UUID> units = new LinkedHashSet<>();
        List<UUID> treeRoots = new ArrayList<>();
        for (Map<String, Object> grant : grants) {
            UUID scopeId = (UUID) grant.get("scope_org_unit_id");
            if (scopeId == null) continue;
            if ("ORG_UNIT".equals(grant.get("scope_type"))) {
                units.add(scopeId);
            } else if ("ORG_TREE".equals(grant.get("scope_type"))) {
                treeRoots.add(scopeId);
            }
            // SELF grants expose participant tasks only; they never create a
            // team-wide organization read scope.
        }
        if (!treeRoots.isEmpty()) {
            units.addAll(jdbc.queryForList("""
                    select distinct descendant_id
                    from org_unit_closure
                    where tenant_id = :tenantId and ancestor_id in (:treeRoots)
                    """, base(principal).addValue("treeRoots", treeRoots), UUID.class));
        }
        return new ReadScope(false, units);
    }

    private void requireTaskOrgAndAssignee(TenantPrincipal principal, UUID taskOrgUnitId, UUID assigneeAssignmentId) {
        Collection<UUID> roots = targetScopeRoots(principal);
        Integer count = jdbc.queryForObject("""
                select count(*)
                from employee_position_assignment assignment
                join employee on employee.tenant_id = assignment.tenant_id
                             and employee.id = assignment.employee_id
                join position_definition position on position.tenant_id = assignment.tenant_id
                                                   and position.id = assignment.position_id
                join org_unit organization on organization.tenant_id = assignment.tenant_id
                                          and organization.id = assignment.org_unit_id
                where assignment.tenant_id = :tenantId and assignment.id = :assignmentId
                  and assignment.status = 'ACTIVE'
                  and assignment.valid_from <= current_date
                  and (assignment.valid_to is null or assignment.valid_to >= current_date)
                  and employee.employment_status = 'ACTIVE' and position.status = 'ACTIVE'
                  and organization.status = 'ACTIVE'
                  and exists (
                    select 1 from org_unit_closure relation
                    where relation.tenant_id = assignment.tenant_id
                      and relation.ancestor_id = :taskOrgId
                      and relation.descendant_id = assignment.org_unit_id
                  )
                  and exists (
                    select 1 from org_unit_closure hotel_link
                    join org_unit hotel on hotel.tenant_id = hotel_link.tenant_id
                                       and hotel.id = hotel_link.ancestor_id
                                       and hotel.unit_type = 'HOTEL' and hotel.status = 'ACTIVE'
                    where hotel_link.tenant_id = assignment.tenant_id
                      and hotel_link.descendant_id = assignment.org_unit_id
                  )
                  and (
                    :tenantScope = true
                    or (:otaScope = true and coalesce(position.level_code, '') like 'M%')
                    or (:otaScope = false and exists (
                      select 1 from org_unit_closure visible
                      where visible.tenant_id = assignment.tenant_id
                        and visible.ancestor_id in (:scopeRoots)
                        and visible.descendant_id = assignment.org_unit_id
                    ))
                  )
                """, params(principal, roots)
                .addValue("taskOrgId", taskOrgUnitId)
                .addValue("assignmentId", assigneeAssignmentId), Integer.class);
        if (count == null || count != 1) {
            throw new AccessDeniedException("任务组织与执行任职不匹配，或执行人不在可下达范围");
        }
    }

    private void requireReviewer(
            TenantPrincipal principal,
            UUID assigneeAssignmentId,
            UUID reviewerAssignmentId,
            UUID creatorAssignmentId
    ) {
        if (assigneeAssignmentId.equals(reviewerAssignmentId)) {
            throw new IllegalArgumentException("任务负责人和验收负责人不能是同一任职");
        }
        if (creatorAssignmentId != null && creatorAssignmentId.equals(reviewerAssignmentId)) {
            requireActorAssignment(principal, creatorAssignmentId);
            return;
        }
        if (principal.hasTenantScope()) {
            requireActiveManagerAssignment(principal, reviewerAssignmentId);
            return;
        }
        Collection<UUID> roots = targetScopeRoots(principal);
        Integer count = jdbc.queryForObject("""
                select count(*)
                from employee_position_assignment assignment
                join position_definition position on position.tenant_id = assignment.tenant_id
                                                 and position.id = assignment.position_id
                where assignment.tenant_id = :tenantId and assignment.id = :assignmentId
                  and assignment.status = 'ACTIVE'
                  and assignment.valid_from <= current_date
                  and (assignment.valid_to is null or assignment.valid_to >= current_date)
                  and coalesce(position.level_code, '') like 'M%'
                  and exists (
                    select 1 from org_unit_closure visible
                    where visible.tenant_id = assignment.tenant_id
                      and visible.ancestor_id in (:scopeRoots)
                      and visible.descendant_id = assignment.org_unit_id
                  )
                """, params(principal, roots).addValue("assignmentId", reviewerAssignmentId), Integer.class);
        if (count == null || count != 1) {
            throw new AccessDeniedException("验收任职不在当前任务管理范围");
        }
    }

    private void requireActorAssignment(TenantPrincipal principal, UUID assignmentId) {
        Integer count = jdbc.queryForObject("""
                select count(*)
                from employee_position_assignment assignment
                join employee on employee.tenant_id = assignment.tenant_id
                             and employee.id = assignment.employee_id
                where assignment.tenant_id = :tenantId and assignment.id = :assignmentId
                  and employee.account_id = :actorId and assignment.status = 'ACTIVE'
                  and assignment.valid_from <= current_date
                  and (assignment.valid_to is null or assignment.valid_to >= current_date)
                """, base(principal).addValue("assignmentId", assignmentId)
                .addValue("actorId", principal.actorId()), Integer.class);
        if (count == null || count != 1) {
            throw new AccessDeniedException("发起任职不属于当前账号或已失效");
        }
    }

    private void requireActiveManagerAssignment(TenantPrincipal principal, UUID assignmentId) {
        Integer count = jdbc.queryForObject("""
                select count(*)
                from employee_position_assignment assignment
                join position_definition position on position.tenant_id = assignment.tenant_id
                                                 and position.id = assignment.position_id
                where assignment.tenant_id = :tenantId and assignment.id = :assignmentId
                  and assignment.status = 'ACTIVE'
                  and assignment.valid_from <= current_date
                  and (assignment.valid_to is null or assignment.valid_to >= current_date)
                  and coalesce(position.level_code, '') like 'M%'
                """, base(principal).addValue("assignmentId", assignmentId), Integer.class);
        if (count == null || count != 1) {
            throw new IllegalArgumentException("验收任职必须是有效的门店管理岗位");
        }
    }

    private boolean isOta(TenantPrincipal principal) {
        return hasAnyRole(principal, OTA_ROLES);
    }

    private boolean hasAnyRole(TenantPrincipal principal, Set<String> expected) {
        return principal.roleCodes().stream().anyMatch(expected::contains);
    }

    private MapSqlParameterSource params(TenantPrincipal principal, Collection<UUID> roots) {
        return base(principal)
                .addValue("tenantScope", principal.hasTenantScope())
                .addValue("otaScope", isOta(principal))
                .addValue("scopeRoots", roots.isEmpty() ? List.of(new UUID(0, 0)) : roots);
    }

    private MapSqlParameterSource base(TenantPrincipal principal) {
        return new MapSqlParameterSource("tenantId", principal.tenantId());
    }

    public record ReadScope(boolean tenantScope, Set<UUID> orgUnitIds) {
        public ReadScope {
            orgUnitIds = orgUnitIds == null || orgUnitIds.isEmpty() ? Set.of() : Set.copyOf(orgUnitIds);
        }
    }
}
