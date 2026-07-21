package cn.sifangguan.hotelaios.workpackage;

import cn.sifangguan.hotelaios.shared.audit.AuditWriter;
import cn.sifangguan.hotelaios.shared.context.TenantPrincipal;
import cn.sifangguan.hotelaios.shared.db.TenantDatabaseContext;
import cn.sifangguan.hotelaios.shared.security.AccessDeniedException;
import cn.sifangguan.hotelaios.shared.security.AccessPolicy;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.*;
import java.time.temporal.WeekFields;
import java.util.*;

@Service
public class WorkPackageService {
    private static final Set<String> PERIOD_TYPES = Set.of("SHIFT", "DAY", "WEEK", "EVENT");
    private final NamedParameterJdbcTemplate jdbc;
    private final TenantDatabaseContext databaseContext;
    private final AccessPolicy accessPolicy;
    private final AuditWriter auditWriter;

    public WorkPackageService(
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
    public List<Map<String, Object>> definitions() {
        TenantPrincipal principal = prepare();
        accessPolicy.requirePermission("work-package.read");
        MapSqlParameterSource params = base(principal);
        String visibility = "";
        if (!principal.hasTenantScope()) {
            if (principal.orgScopes().isEmpty()) {
                return List.of();
            }
            params.addValue("scopeIds", principal.orgScopes());
            visibility = """
                    and exists (
                        select 1
                        from work_package_version vis_v
                        join work_package_allocation vis_a
                          on vis_a.tenant_id = vis_v.tenant_id
                         and vis_a.work_package_version_id = vis_v.id
                        join org_unit_closure vis_c
                          on vis_c.tenant_id = vis_a.tenant_id
                         and vis_c.descendant_id = vis_a.target_org_unit_id
                        where vis_v.tenant_id = d.tenant_id
                          and vis_v.work_package_definition_id = d.id
                          and vis_a.status = 'ACTIVE'
                          and vis_c.ancestor_id in (:scopeIds)
                    )
                    """;
        }
        return jdbc.queryForList("""
                select d.id, d.code, d.name, d.description, d.status,
                       d.position_id, p.name as position_name,
                       d.owner_org_unit_id, o.name as owner_org_unit_name,
                       v.id as latest_version_id, v.version_no, v.lifecycle_status,
                       v.effective_from, v.effective_to
                from work_package_definition d
                join position_definition p on p.tenant_id = d.tenant_id and p.id = d.position_id
                left join org_unit o on o.tenant_id = d.tenant_id and o.id = d.owner_org_unit_id
                left join lateral (
                    select pv.id, pv.version_no, pv.lifecycle_status, pv.effective_from, pv.effective_to
                    from work_package_version pv
                    where pv.tenant_id = d.tenant_id and pv.work_package_definition_id = d.id
                    order by pv.version_no desc limit 1
                ) v on true
                where d.tenant_id = :tenantId
                """ + visibility + " order by d.code", params);
    }

    @Transactional
    public Map<String, Object> createDefinition(WorkPackageModels.CreateDefinition request) {
        TenantPrincipal principal = prepare();
        accessPolicy.requirePermission("work-package.manage");
        requireOwned("position_definition", principal, request.positionId());
        if (request.ownerOrgUnitId() != null) {
            requireOwned("org_unit", principal, request.ownerOrgUnitId());
            accessPolicy.requireOrgScope(request.ownerOrgUnitId());
        } else if (!principal.hasTenantScope()) {
            throw new AccessDeniedException("仅集团级管理员可以创建集团统一工作包");
        }
        UUID id = UUID.randomUUID();
        jdbc.update("""
                insert into work_package_definition
                    (id, tenant_id, code, name, description, position_id, owner_org_unit_id, created_by)
                values
                    (:id, :tenantId, :code, :name, :description, :positionId, :ownerOrgUnitId, :actorId)
                """, base(principal)
                .addValue("id", id)
                .addValue("code", normalizeCode(request.code()))
                .addValue("name", request.name().trim())
                .addValue("description", trimToNull(request.description()))
                .addValue("positionId", request.positionId())
                .addValue("ownerOrgUnitId", request.ownerOrgUnitId())
                .addValue("actorId", principal.actorId()));
        auditWriter.record("WORK_PACKAGE_CREATED", "WORK_PACKAGE", id,
                "{\"code\":\"" + jsonEscape(normalizeCode(request.code())) + "\"}");
        return response("id", id, "code", normalizeCode(request.code()), "name", request.name().trim(), "status", "ACTIVE");
    }

    @Transactional(readOnly = true)
    public Map<String, Object> detail(UUID workPackageId) {
        TenantPrincipal principal = prepare();
        accessPolicy.requirePermission("work-package.read");
        requireVisible(principal, workPackageId);
        MapSqlParameterSource params = base(principal).addValue("workPackageId", workPackageId);
        Map<String, Object> definition = new LinkedHashMap<>(jdbc.queryForMap("""
                select d.id, d.code, d.name, d.description, d.status, d.position_id,
                       p.name as position_name, d.owner_org_unit_id, o.name as owner_org_unit_name,
                       d.created_at, d.updated_at
                from work_package_definition d
                join position_definition p on p.tenant_id = d.tenant_id and p.id = d.position_id
                left join org_unit o on o.tenant_id = d.tenant_id and o.id = d.owner_org_unit_id
                where d.tenant_id = :tenantId and d.id = :workPackageId
                """, params));
        List<Map<String, Object>> versions = jdbc.queryForList("""
                select id, version_no, lifecycle_status, title, description, effective_from, effective_to,
                       content_hash, published_by, published_at, created_at, updated_at
                from work_package_version
                where tenant_id = :tenantId and work_package_definition_id = :workPackageId
                order by version_no desc
                """, params);
        definition.put("versions", versions);
        if (!versions.isEmpty()) {
            UUID versionId = (UUID) versions.getFirst().get("id");
            definition.put("latestVersion", versionConfiguration(principal, versionId));
        }
        return definition;
    }

    @Transactional
    public Map<String, Object> createVersion(UUID workPackageId, WorkPackageModels.CreateVersion request) {
        TenantPrincipal principal = prepare();
        accessPolicy.requirePermission("work-package.manage");
        requireManageableDefinition(principal, workPackageId);
        Integer nextVersion = jdbc.queryForObject("""
                select coalesce(max(version_no), 0) + 1
                from work_package_version
                where tenant_id = :tenantId and work_package_definition_id = :workPackageId
                """, base(principal).addValue("workPackageId", workPackageId), Integer.class);
        UUID versionId = UUID.randomUUID();
        jdbc.update("""
                insert into work_package_version
                    (id, tenant_id, work_package_definition_id, version_no, title, description, created_by)
                values
                    (:id, :tenantId, :workPackageId, :versionNo, :title, :description, :actorId)
                """, base(principal)
                .addValue("id", versionId)
                .addValue("workPackageId", workPackageId)
                .addValue("versionNo", nextVersion)
                .addValue("title", request.title().trim())
                .addValue("description", trimToNull(request.description()))
                .addValue("actorId", principal.actorId()));
        auditWriter.record("WORK_PACKAGE_VERSION_CREATED", "WORK_PACKAGE_VERSION", versionId,
                "{\"workPackageId\":\"" + workPackageId + "\",\"versionNo\":" + nextVersion + "}");
        return response("id", versionId, "workPackageId", workPackageId, "versionNo", nextVersion, "status", "DRAFT");
    }

    @Transactional
    public Map<String, Object> updateVersion(
            UUID workPackageId,
            UUID versionId,
            WorkPackageModels.UpdateVersion request
    ) {
        TenantPrincipal principal = prepare();
        accessPolicy.requirePermission("work-package.manage");
        requireDraftVersion(principal, workPackageId, versionId);

        jdbc.update("delete from work_package_scope where tenant_id = :tenantId and work_package_version_id = :versionId",
                base(principal).addValue("versionId", versionId));
        jdbc.update("delete from work_package_item where tenant_id = :tenantId and work_package_version_id = :versionId",
                base(principal).addValue("versionId", versionId));
        jdbc.update("""
                update work_package_version set title = :title, description = :description
                where tenant_id = :tenantId and id = :versionId and work_package_definition_id = :workPackageId
                  and lifecycle_status = 'DRAFT'
                """, base(principal)
                .addValue("versionId", versionId)
                .addValue("workPackageId", workPackageId)
                .addValue("title", request.title().trim())
                .addValue("description", trimToNull(request.description())));

        for (WorkPackageModels.Scope scope : request.scopes()) {
            insertScope(principal, versionId, scope);
        }
        Set<String> itemCodes = new HashSet<>();
        for (WorkPackageModels.Item item : request.items()) {
            String itemCode = normalizeCode(item.itemCode());
            if (!itemCodes.add(itemCode)) {
                throw new IllegalArgumentException("工作包条目编码重复: " + itemCode);
            }
            insertItem(principal, versionId, item, itemCode);
        }
        auditWriter.record("WORK_PACKAGE_VERSION_UPDATED", "WORK_PACKAGE_VERSION", versionId,
                "{\"scopeCount\":" + request.scopes().size() + ",\"itemCount\":" + request.items().size() + "}");
        return response("id", versionId, "workPackageId", workPackageId, "status", "DRAFT",
                "scopeCount", request.scopes().size(), "itemCount", request.items().size());
    }

    @Transactional(readOnly = true)
    public Map<String, Object> validateVersion(UUID workPackageId, UUID versionId) {
        TenantPrincipal principal = prepare();
        accessPolicy.requirePermission("work-package.manage");
        requireDraftVersion(principal, workPackageId, versionId);
        List<String> issues = validationIssues(principal, versionId);
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("workPackageId", workPackageId);
        result.put("versionId", versionId);
        result.put("valid", issues.isEmpty());
        result.put("issues", issues);
        return result;
    }

    @Transactional
    public Map<String, Object> publishVersion(
            UUID workPackageId,
            UUID versionId,
            WorkPackageModels.PublishVersion request
    ) {
        TenantPrincipal principal = prepare();
        accessPolicy.requirePermission("work-package.publish");
        requireDraftVersion(principal, workPackageId, versionId);
        if (request.effectiveTo() != null && request.effectiveTo().isBefore(request.effectiveFrom())) {
            throw new IllegalArgumentException("失效时间不能早于生效时间");
        }
        List<String> issues = validationIssues(principal, versionId);
        if (!issues.isEmpty()) {
            throw new IllegalArgumentException("工作包版本未通过发布校验: " + String.join("；", issues));
        }
        String contentHash = sha256(contentSnapshot(principal, versionId));
        MapSqlParameterSource params = base(principal)
                .addValue("workPackageId", workPackageId)
                .addValue("versionId", versionId)
                .addValue("effectiveFrom", request.effectiveFrom())
                .addValue("effectiveTo", request.effectiveTo())
                .addValue("contentHash", contentHash)
                .addValue("actorId", principal.actorId());
        jdbc.update("""
                update work_package_version
                set lifecycle_status = 'RETIRED', effective_to = :effectiveFrom
                where tenant_id = :tenantId and work_package_definition_id = :workPackageId
                  and id <> :versionId and lifecycle_status = 'PUBLISHED'
                """, params);
        int changed = jdbc.update("""
                update work_package_version
                set lifecycle_status = 'PUBLISHED', effective_from = :effectiveFrom, effective_to = :effectiveTo,
                    content_hash = :contentHash, published_by = :actorId, published_at = now()
                where tenant_id = :tenantId and work_package_definition_id = :workPackageId
                  and id = :versionId and lifecycle_status = 'DRAFT'
                """, params);
        if (changed != 1) {
            throw new IllegalArgumentException("只有当前租户的草稿工作包版本可以发布");
        }
        auditWriter.record("WORK_PACKAGE_VERSION_PUBLISHED", "WORK_PACKAGE_VERSION", versionId,
                "{\"workPackageId\":\"" + workPackageId + "\",\"contentHash\":\"" + contentHash + "\"}");
        auditWriter.emit("WORK_PACKAGE", workPackageId, "WorkPackagePublished",
                "{\"workPackageId\":\"" + workPackageId + "\",\"versionId\":\"" + versionId + "\"}");
        return response("workPackageId", workPackageId, "versionId", versionId,
                "status", "PUBLISHED", "contentHash", contentHash);
    }

    @Transactional
    public Map<String, Object> retireVersion(
            UUID workPackageId,
            UUID versionId,
            WorkPackageModels.RetireVersion request
    ) {
        TenantPrincipal principal = prepare();
        accessPolicy.requirePermission("work-package.publish");
        OffsetDateTime effectiveTo = request == null || request.effectiveTo() == null
                ? OffsetDateTime.now() : request.effectiveTo();
        int changed = jdbc.update("""
                update work_package_version
                set lifecycle_status = 'RETIRED', effective_to = :effectiveTo
                where tenant_id = :tenantId and work_package_definition_id = :workPackageId
                  and id = :versionId and lifecycle_status = 'PUBLISHED'
                """, base(principal)
                .addValue("workPackageId", workPackageId)
                .addValue("versionId", versionId)
                .addValue("effectiveTo", effectiveTo));
        if (changed != 1) {
            throw new IllegalArgumentException("只有已发布的工作包版本可以停用");
        }
        auditWriter.record("WORK_PACKAGE_VERSION_RETIRED", "WORK_PACKAGE_VERSION", versionId, "{}");
        auditWriter.emit("WORK_PACKAGE", workPackageId, "WorkPackageRetired",
                "{\"workPackageId\":\"" + workPackageId + "\",\"versionId\":\"" + versionId + "\"}");
        return response("workPackageId", workPackageId, "versionId", versionId,
                "status", "RETIRED", "effectiveTo", effectiveTo);
    }

    @Transactional(readOnly = true)
    public List<Map<String, Object>> allocations(UUID workPackageId) {
        TenantPrincipal principal = prepare();
        accessPolicy.requirePermission("work-package.read");
        requireVisible(principal, workPackageId);
        MapSqlParameterSource params = base(principal).addValue("workPackageId", workPackageId);
        String visibility = orgVisibility(principal, params, "a.target_org_unit_id");
        return jdbc.queryForList("""
                select a.id, a.work_package_version_id, v.version_no, a.position_assignment_id,
                       e.name as employee_name, p.name as position_name,
                       a.target_org_unit_id, o.name as target_org_unit_name,
                       a.valid_from, a.valid_to, a.status, a.allocation_source, a.allocated_by,
                       a.created_at, a.updated_at
                from work_package_allocation a
                join work_package_version v on v.tenant_id = a.tenant_id and v.id = a.work_package_version_id
                join employee_position_assignment pa on pa.tenant_id = a.tenant_id and pa.id = a.position_assignment_id
                join employee e on e.tenant_id = pa.tenant_id and e.id = pa.employee_id
                join position_definition p on p.tenant_id = pa.tenant_id and p.id = pa.position_id
                join org_unit o on o.tenant_id = a.tenant_id and o.id = a.target_org_unit_id
                where a.tenant_id = :tenantId and v.work_package_definition_id = :workPackageId
                """ + visibility + " order by a.created_at desc", params);
    }

    @Transactional
    public Map<String, Object> createAllocation(
            UUID workPackageId,
            WorkPackageModels.CreateAllocation request
    ) {
        TenantPrincipal principal = prepare();
        accessPolicy.requirePermission("work-package.allocate");
        accessPolicy.requireOrgScope(request.targetOrgUnitId());
        if (request.validTo() != null && request.validTo().isBefore(request.validFrom())) {
            throw new IllegalArgumentException("分配失效日期不能早于生效日期");
        }
        Integer applicable = jdbc.queryForObject("""
                select count(*)
                from work_package_version v
                join work_package_definition d
                  on d.tenant_id = v.tenant_id and d.id = v.work_package_definition_id
                join employee_position_assignment a
                  on a.tenant_id = v.tenant_id and a.id = :assignmentId
                where v.tenant_id = :tenantId and v.id = :versionId
                  and d.id = :workPackageId and v.lifecycle_status = 'PUBLISHED'
                  and d.status = 'ACTIVE' and d.position_id = a.position_id and a.status = 'ACTIVE'
                  and a.valid_from <= :validFrom and (a.valid_to is null or a.valid_to >= :validFrom)
                  and exists (
                      select 1 from work_package_scope s
                      where s.tenant_id = v.tenant_id and s.work_package_version_id = v.id
                        and (
                            s.scope_type = 'TENANT'
                            or (s.scope_type = 'POSITION' and s.position_id = a.position_id)
                            or (s.scope_type = 'ORG_UNIT' and s.org_unit_id = :targetOrgUnitId)
                            or (s.scope_type = 'ORG_TREE' and exists (
                                select 1 from org_unit_closure c
                                where c.tenant_id = s.tenant_id and c.ancestor_id = s.org_unit_id
                                  and c.descendant_id = :targetOrgUnitId
                            ))
                            or (s.scope_type = 'BRAND' and exists (
                                select 1 from hotel_profile h
                                where h.tenant_id = s.tenant_id and h.org_unit_id = :targetOrgUnitId
                                  and h.brand_id = s.brand_id
                            ))
                        )
                  )
                """, base(principal)
                .addValue("versionId", request.workPackageVersionId())
                .addValue("workPackageId", workPackageId)
                .addValue("assignmentId", request.positionAssignmentId())
                .addValue("targetOrgUnitId", request.targetOrgUnitId())
                .addValue("validFrom", request.validFrom()), Integer.class);
        if (applicable == null || applicable != 1) {
            throw new IllegalArgumentException("工作包版本、任职、岗位或目标组织不匹配");
        }
        Integer overlaps = jdbc.queryForObject("""
                select count(*)
                from work_package_allocation a
                join work_package_version av on av.tenant_id = a.tenant_id and av.id = a.work_package_version_id
                where a.tenant_id = :tenantId
                  and av.work_package_definition_id = :workPackageId
                  and a.position_assignment_id = :assignmentId
                  and a.target_org_unit_id = :targetOrgUnitId
                  and a.status = 'ACTIVE'
                  and daterange(a.valid_from, coalesce(a.valid_to, 'infinity'::date), '[]')
                      && daterange(:validFrom, coalesce(cast(:validTo as date), 'infinity'::date), '[]')
                """, base(principal)
                .addValue("workPackageId", workPackageId)
                .addValue("assignmentId", request.positionAssignmentId())
                .addValue("targetOrgUnitId", request.targetOrgUnitId())
                .addValue("validFrom", request.validFrom())
                .addValue("validTo", request.validTo()), Integer.class);
        if (overlaps != null && overlaps > 0) {
            throw new IllegalArgumentException("同一任职和目标组织已存在时间重叠的工作包分配");
        }
        UUID allocationId = UUID.randomUUID();
        jdbc.update("""
                insert into work_package_allocation
                    (id, tenant_id, work_package_version_id, position_assignment_id, target_org_unit_id,
                     allocation_source, valid_from, valid_to, allocated_by)
                values
                    (:id, :tenantId, :versionId, :assignmentId, :targetOrgUnitId,
                     :allocationSource, :validFrom, :validTo, :actorId)
                """, base(principal)
                .addValue("id", allocationId)
                .addValue("versionId", request.workPackageVersionId())
                .addValue("assignmentId", request.positionAssignmentId())
                .addValue("targetOrgUnitId", request.targetOrgUnitId())
                .addValue("allocationSource", defaultUpper(request.allocationSource(), "MANUAL"))
                .addValue("validFrom", request.validFrom())
                .addValue("validTo", request.validTo())
                .addValue("actorId", principal.actorId()));
        auditWriter.record("WORK_PACKAGE_ALLOCATED", "WORK_PACKAGE_ALLOCATION", allocationId,
                "{\"workPackageId\":\"" + workPackageId + "\",\"targetOrgUnitId\":\""
                        + request.targetOrgUnitId() + "\"}");
        auditWriter.emit("WORK_PACKAGE_ALLOCATION", allocationId, "WorkPackageAllocated",
                "{\"allocationId\":\"" + allocationId + "\",\"positionAssignmentId\":\""
                        + request.positionAssignmentId() + "\",\"orgUnitId\":\"" + request.targetOrgUnitId() + "\"}");
        return response("id", allocationId, "workPackageId", workPackageId,
                "workPackageVersionId", request.workPackageVersionId(), "status", "ACTIVE");
    }

    @Transactional(readOnly = true)
    public List<Map<String, Object>> dutyPeriods(
            UUID positionAssignmentId,
            UUID targetOrgUnitId,
            LocalDate businessDate
    ) {
        TenantPrincipal principal = prepare();
        accessPolicy.requirePermission("work-package.read");
        MapSqlParameterSource params = base(principal);
        List<String> predicates = new ArrayList<>();
        if (positionAssignmentId != null) {
            predicates.add("d.position_assignment_id = :assignmentId");
            params.addValue("assignmentId", positionAssignmentId);
        }
        if (targetOrgUnitId != null) {
            accessPolicy.requireOrgScope(targetOrgUnitId);
            predicates.add("d.target_org_unit_id = :targetOrgUnitId");
            params.addValue("targetOrgUnitId", targetOrgUnitId);
        }
        if (businessDate != null) {
            predicates.add("d.business_date = :businessDate");
            params.addValue("businessDate", businessDate);
        }
        String visibility = orgVisibility(principal, params, "d.target_org_unit_id");
        String filters = predicates.isEmpty() ? "" : " and " + String.join(" and ", predicates);
        return jdbc.queryForList("""
                select d.id, d.position_assignment_id, e.name as employee_name, p.name as position_name,
                       d.target_org_unit_id, o.name as target_org_unit_name, d.business_date, d.period_type,
                       d.shift_code, d.planned_start_at, d.planned_end_at, d.status, d.source_record_id,
                       d.created_at, d.updated_at
                from work_duty_period d
                join employee_position_assignment a on a.tenant_id = d.tenant_id and a.id = d.position_assignment_id
                join employee e on e.tenant_id = a.tenant_id and e.id = a.employee_id
                join position_definition p on p.tenant_id = a.tenant_id and p.id = a.position_id
                join org_unit o on o.tenant_id = d.tenant_id and o.id = d.target_org_unit_id
                where d.tenant_id = :tenantId
                """ + visibility + filters + " order by d.business_date desc, d.planned_start_at", params);
    }

    @Transactional
    public Map<String, Object> createDutyPeriod(WorkPackageModels.CreateDutyPeriod request) {
        TenantPrincipal principal = prepare();
        accessPolicy.requirePermission("work-package.allocate");
        accessPolicy.requireOrgScope(request.targetOrgUnitId());
        String periodType = request.periodType().trim().toUpperCase(Locale.ROOT);
        if (!Set.of("SHIFT", "DAY", "WEEK").contains(periodType)) {
            throw new IllegalArgumentException("班次周期只支持SHIFT、DAY或WEEK");
        }
        if (!request.plannedEndAt().isAfter(request.plannedStartAt())) {
            throw new IllegalArgumentException("计划结束时间必须晚于开始时间");
        }
        requireActiveAssignment(principal, request.positionAssignmentId(), request.businessDate());
        UUID dutyPeriodId = UUID.randomUUID();
        jdbc.update("""
                insert into work_duty_period
                    (id, tenant_id, position_assignment_id, target_org_unit_id, business_date, period_type,
                     shift_code, planned_start_at, planned_end_at, source_record_id, created_by)
                values
                    (:id, :tenantId, :assignmentId, :targetOrgUnitId, :businessDate, :periodType,
                     :shiftCode, :plannedStartAt, :plannedEndAt, :sourceRecordId, :actorId)
                """, base(principal)
                .addValue("id", dutyPeriodId)
                .addValue("assignmentId", request.positionAssignmentId())
                .addValue("targetOrgUnitId", request.targetOrgUnitId())
                .addValue("businessDate", request.businessDate())
                .addValue("periodType", periodType)
                .addValue("shiftCode", trimToNull(request.shiftCode()))
                .addValue("plannedStartAt", request.plannedStartAt())
                .addValue("plannedEndAt", request.plannedEndAt())
                .addValue("sourceRecordId", trimToNull(request.sourceRecordId()))
                .addValue("actorId", principal.actorId()));
        auditWriter.record("WORK_DUTY_PERIOD_CREATED", "WORK_DUTY_PERIOD", dutyPeriodId,
                "{\"periodType\":\"" + periodType + "\"}");
        Map<String, Object> generated = generateExpectationsInternal(principal,
                new WorkPackageModels.GenerateExpectations(request.positionAssignmentId(), request.targetOrgUnitId(),
                        request.businessDate(), periodType, dutyPeriodId));
        Map<String, Object> result = response("id", dutyPeriodId, "status", "PLANNED",
                "businessDate", request.businessDate(), "periodType", periodType);
        result.put("expectations", generated);
        return result;
    }

    @Transactional
    public Map<String, Object> generateExpectations(WorkPackageModels.GenerateExpectations request) {
        TenantPrincipal principal = prepare();
        accessPolicy.requirePermission("work-package.allocate");
        accessPolicy.requireOrgScope(request.targetOrgUnitId());
        return generateExpectationsInternal(principal, request);
    }

    @Transactional(readOnly = true)
    public List<Map<String, Object>> teamExpectations(String status, LocalDate businessDate) {
        accessPolicy.requirePermission("work-record.review");
        return expectations(status, null, null, businessDate, false);
    }

    @Transactional(readOnly = true)
    public List<Map<String, Object>> expectations(
            String status,
            UUID positionAssignmentId,
            UUID targetOrgUnitId,
            LocalDate businessDate,
            boolean mineOnly
    ) {
        TenantPrincipal principal = prepare();
        accessPolicy.requirePermission("work-package.read");
        MapSqlParameterSource params = base(principal).addValue("actorId", principal.actorId());
        List<String> predicates = new ArrayList<>();
        if (status != null && !status.isBlank()) {
            predicates.add("x.status = :status");
            params.addValue("status", status.trim().toUpperCase(Locale.ROOT));
        }
        if (positionAssignmentId != null) {
            predicates.add("x.position_assignment_id = :assignmentId");
            params.addValue("assignmentId", positionAssignmentId);
        }
        if (targetOrgUnitId != null) {
            accessPolicy.requireOrgScope(targetOrgUnitId);
            predicates.add("x.target_org_unit_id = :targetOrgUnitId");
            params.addValue("targetOrgUnitId", targetOrgUnitId);
        }
        if (businessDate != null) {
            predicates.add("x.business_date = :businessDate");
            params.addValue("businessDate", businessDate);
        }
        if (mineOnly) {
            predicates.add("e.account_id = :actorId");
        }
        String filters = predicates.isEmpty() ? "" : " and " + String.join(" and ", predicates);
        String visibility = mineOnly ? "" : orgVisibility(principal, params, "x.target_org_unit_id");
        return jdbc.queryForList("""
                select x.id, x.business_date, x.period_key, x.available_at, x.due_at, x.status,
                       x.row_version, x.waiver_allowed,
                       x.position_assignment_id, e.id as employee_id, e.name as employee_name, p.name as position_name,
                       x.target_org_unit_id, o.name as target_org_unit_name,
                       i.id as work_package_item_id, i.item_code, i.name as item_name, i.item_type,
                       i.form_version_id, i.submission_policy,
                       d.id as work_package_id, d.code as work_package_code, d.name as work_package_name,
                       v.id as work_package_version_id, v.version_no,
                       (select max(w.attempt_no) from work_record w
                         where w.tenant_id = x.tenant_id and w.work_expectation_id = x.id) as latest_attempt_no
                from work_expectation x
                join work_package_item i on i.tenant_id = x.tenant_id and i.id = x.work_package_item_id
                join work_package_version v on v.tenant_id = i.tenant_id and v.id = i.work_package_version_id
                join work_package_definition d on d.tenant_id = v.tenant_id and d.id = v.work_package_definition_id
                join employee_position_assignment a on a.tenant_id = x.tenant_id and a.id = x.position_assignment_id
                join employee e on e.tenant_id = a.tenant_id and e.id = a.employee_id
                join position_definition p on p.tenant_id = a.tenant_id and p.id = a.position_id
                join org_unit o on o.tenant_id = x.tenant_id and o.id = x.target_org_unit_id
                where x.tenant_id = :tenantId
                """ + visibility + filters + " order by x.due_at, x.created_at limit 500", params);
    }

    @Transactional(readOnly = true)
    public Map<String, Object> expectationDetail(UUID expectationId) {
        TenantPrincipal principal = prepare();
        accessPolicy.requirePermission("work-package.read");
        MapSqlParameterSource params = base(principal).addValue("expectationId", expectationId);
        Map<String, Object> result = new LinkedHashMap<>(jdbc.queryForMap("""
                select x.*, i.item_code, i.name as item_name, i.item_type, i.form_version_id,
                       i.grace_minutes, i.review_mode, i.submission_policy,
                       d.id as work_package_id, d.code as work_package_code, d.name as work_package_name,
                       v.id as work_package_version_id, v.version_no,
                       e.name as employee_name, p.name as position_name, o.name as target_org_unit_name,
                       fd.code as form_code, fd.name as form_name, fv.json_schema as form_schema
                from work_expectation x
                join work_package_item i on i.tenant_id = x.tenant_id and i.id = x.work_package_item_id
                join work_package_version v on v.tenant_id = i.tenant_id and v.id = i.work_package_version_id
                join work_package_definition d on d.tenant_id = v.tenant_id and d.id = v.work_package_definition_id
                join form_version fv on fv.tenant_id = i.tenant_id and fv.id = i.form_version_id
                join form_definition fd on fd.tenant_id = fv.tenant_id and fd.id = fv.form_id
                join employee_position_assignment a on a.tenant_id = x.tenant_id and a.id = x.position_assignment_id
                join employee e on e.tenant_id = a.tenant_id and e.id = a.employee_id
                join position_definition p on p.tenant_id = a.tenant_id and p.id = a.position_id
                join org_unit o on o.tenant_id = x.tenant_id and o.id = x.target_org_unit_id
                where x.tenant_id = :tenantId and x.id = :expectationId
                """, params));
        accessPolicy.requireOrgScope((UUID) result.get("target_org_unit_id"));
        result.put("standards", jdbc.queryForList("""
                select s.standard_version_id, s.usage_type, s.weight, sd.code as standard_code,
                       sv.version_no as standard_version_no, sv.title
                from work_package_item_standard s
                join standard_version sv on sv.tenant_id = s.tenant_id and sv.id = s.standard_version_id
                join standard_definition sd on sd.tenant_id = sv.tenant_id and sd.id = sv.standard_id
                where s.tenant_id = :tenantId and s.work_package_item_id = :itemId
                order by s.usage_type, sd.code
                """, base(principal).addValue("itemId", result.get("work_package_item_id"))));
        result.put("records", jdbc.queryForList("""
                select id, status, attempt_no, payload, submitted_at, reviewed_at, review_reason, created_at
                from work_record
                where tenant_id = :tenantId and work_expectation_id = :expectationId
                order by attempt_no desc
                """, params));
        return result;
    }

    @Transactional
    public Map<String, Object> waiveExpectation(UUID expectationId, WorkPackageModels.ExpectationAction request) {
        TenantPrincipal principal = prepare();
        accessPolicy.requirePermission("work-package.allocate");
        ExpectationAccess expectation = expectationAccess(principal, expectationId);
        accessPolicy.requireOrgScope(expectation.targetOrgUnitId());
        if (!expectation.waiverAllowed()) {
            throw new IllegalArgumentException("该工作条目不允许豁免");
        }
        Integer self = jdbc.queryForObject("""
                select count(*)
                from employee_position_assignment a
                join employee e on e.tenant_id = a.tenant_id and e.id = a.employee_id
                where a.tenant_id = :tenantId and a.id = :assignmentId and e.account_id = :actorId
                """, base(principal)
                .addValue("assignmentId", expectation.assignmentId())
                .addValue("actorId", principal.actorId()), Integer.class);
        if (self != null && self > 0) {
            throw new AccessDeniedException("岗位本人不能批准自己的工作豁免");
        }
        int changed = jdbc.update("""
                update work_expectation
                set status = 'WAIVED', waiver_reason = :reason, waived_by_account_id = :actorId,
                    waived_at = now(), row_version = row_version + 1
                where tenant_id = :tenantId and id = :expectationId
                  and status in ('PLANNED', 'AVAILABLE', 'IN_PROGRESS')
                  and row_version = :expectedVersion
                """, base(principal)
                .addValue("expectationId", expectationId)
                .addValue("reason", request.reason().trim())
                .addValue("actorId", principal.actorId())
                .addValue("expectedVersion", request.expectedVersion()));
        if (changed != 1) {
            throw new IllegalArgumentException("工作期望状态已变化，请刷新后重试");
        }
        auditWriter.record("WORK_EXPECTATION_WAIVED", "WORK_EXPECTATION", expectationId,
                "{\"reason\":\"" + jsonEscape(request.reason().trim()) + "\"}");
        auditWriter.emit("WORK_EXPECTATION", expectationId, "WorkExpectationWaived",
                "{\"workExpectationId\":\"" + expectationId + "\",\"orgUnitId\":\""
                        + expectation.targetOrgUnitId() + "\"}");
        return response("id", expectationId, "status", "WAIVED", "rowVersion", request.expectedVersion() + 1);
    }

    @Transactional
    public Map<String, Object> cancelExpectation(UUID expectationId, WorkPackageModels.ExpectationAction request) {
        TenantPrincipal principal = prepare();
        accessPolicy.requirePermission("work-package.allocate");
        ExpectationAccess expectation = expectationAccess(principal, expectationId);
        accessPolicy.requireOrgScope(expectation.targetOrgUnitId());
        int changed = jdbc.update("""
                update work_expectation
                set status = 'CANCELLED', cancellation_reason = :reason, cancelled_by_account_id = :actorId,
                    cancelled_at = now(), row_version = row_version + 1
                where tenant_id = :tenantId and id = :expectationId
                  and status in ('PLANNED', 'AVAILABLE') and row_version = :expectedVersion
                """, base(principal)
                .addValue("expectationId", expectationId)
                .addValue("reason", request.reason().trim())
                .addValue("actorId", principal.actorId())
                .addValue("expectedVersion", request.expectedVersion()));
        if (changed != 1) {
            throw new IllegalArgumentException("工作期望已开始或状态已变化，不能取消");
        }
        auditWriter.record("WORK_EXPECTATION_CANCELLED", "WORK_EXPECTATION", expectationId,
                "{\"reason\":\"" + jsonEscape(request.reason().trim()) + "\"}");
        auditWriter.emit("WORK_EXPECTATION", expectationId, "WorkExpectationCancelled",
                "{\"workExpectationId\":\"" + expectationId + "\",\"orgUnitId\":\""
                        + expectation.targetOrgUnitId() + "\"}");
        return response("id", expectationId, "status", "CANCELLED", "rowVersion", request.expectedVersion() + 1);
    }

    private Map<String, Object> generateExpectationsInternal(
            TenantPrincipal principal,
            WorkPackageModels.GenerateExpectations request
    ) {
        String periodType = request.periodType().trim().toUpperCase(Locale.ROOT);
        if (!Set.of("SHIFT", "DAY", "WEEK").contains(periodType)) {
            throw new IllegalArgumentException("期望生成只支持SHIFT、DAY或WEEK周期");
        }
        requireActiveAssignment(principal, request.positionAssignmentId(), request.businessDate());
        DutyWindow dutyWindow = null;
        if (request.dutyPeriodId() != null) {
            dutyWindow = jdbc.queryForObject("""
                    select planned_start_at, planned_end_at, period_type, position_assignment_id,
                           target_org_unit_id, business_date, status
                    from work_duty_period
                    where tenant_id = :tenantId and id = :dutyPeriodId
                    """, base(principal).addValue("dutyPeriodId", request.dutyPeriodId()),
                    (rs, rowNum) -> new DutyWindow(
                            rs.getObject("planned_start_at", OffsetDateTime.class),
                            rs.getObject("planned_end_at", OffsetDateTime.class),
                            rs.getString("period_type"),
                            rs.getObject("position_assignment_id", UUID.class),
                            rs.getObject("target_org_unit_id", UUID.class),
                            rs.getObject("business_date", LocalDate.class),
                            rs.getString("status")));
            if (!periodType.equals(dutyWindow.periodType())
                    || !request.positionAssignmentId().equals(dutyWindow.assignmentId())
                    || !request.targetOrgUnitId().equals(dutyWindow.targetOrgUnitId())
                    || !request.businessDate().equals(dutyWindow.businessDate())
                    || "CANCELLED".equals(dutyWindow.status())) {
                throw new IllegalArgumentException("班次周期与期望生成上下文不匹配");
            }
        } else if ("SHIFT".equals(periodType)) {
            throw new IllegalArgumentException("SHIFT期望必须关联实际班次周期");
        }

        List<GenerationCandidate> candidates = jdbc.query("""
                select i.id as item_id, i.period_type, i.timezone_mode, i.fixed_timezone,
                       i.work_window_start, i.due_local_time, i.waiver_allowed,
                       a.id as allocation_id
                from work_package_allocation a
                join work_package_version v on v.tenant_id = a.tenant_id and v.id = a.work_package_version_id
                join work_package_item i on i.tenant_id = v.tenant_id and i.work_package_version_id = v.id
                where a.tenant_id = :tenantId and a.position_assignment_id = :assignmentId
                  and a.target_org_unit_id = :targetOrgUnitId and a.status = 'ACTIVE'
                  and a.valid_from <= :businessDate and (a.valid_to is null or a.valid_to >= :businessDate)
                  and v.lifecycle_status = 'PUBLISHED'
                  and v.effective_from::date <= :businessDate
                  and (v.effective_to is null or v.effective_to::date >= :businessDate)
                  and i.period_type = :periodType
                order by i.sort_order, i.item_code
                """, base(principal)
                .addValue("assignmentId", request.positionAssignmentId())
                .addValue("targetOrgUnitId", request.targetOrgUnitId())
                .addValue("businessDate", request.businessDate())
                .addValue("periodType", periodType),
                (rs, rowNum) -> new GenerationCandidate(
                        rs.getObject("item_id", UUID.class),
                        rs.getObject("allocation_id", UUID.class),
                        rs.getString("timezone_mode"),
                        rs.getString("fixed_timezone"),
                        rs.getObject("work_window_start", LocalTime.class),
                        rs.getObject("due_local_time", LocalTime.class),
                        rs.getBoolean("waiver_allowed")));

        String tenantTimezone = jdbc.queryForObject(
                "select timezone from tenant where id = :tenantId",
                base(principal), String.class);
        int created = 0;
        List<UUID> createdIds = new ArrayList<>();
        for (GenerationCandidate candidate : candidates) {
            ZoneId zone = zone(candidate, tenantTimezone);
            OffsetDateTime availableAt;
            OffsetDateTime dueAt;
            String periodKey;
            if (dutyWindow != null) {
                availableAt = dutyWindow.start();
                dueAt = candidate.dueLocalTime() == null
                        ? dutyWindow.end()
                        : request.businessDate().atTime(candidate.dueLocalTime()).atZone(zone).toOffsetDateTime();
                periodKey = "SHIFT:" + request.dutyPeriodId();
            } else {
                LocalTime availableTime = candidate.windowStart() == null ? LocalTime.MIN : candidate.windowStart();
                LocalTime dueTime = candidate.dueLocalTime() == null ? LocalTime.of(23, 59, 59) : candidate.dueLocalTime();
                availableAt = request.businessDate().atTime(availableTime).atZone(zone).toOffsetDateTime();
                dueAt = request.businessDate().atTime(dueTime).atZone(zone).toOffsetDateTime();
                if (dueAt.isBefore(availableAt)) {
                    dueAt = dueAt.plusDays(1);
                }
                periodKey = "DAY".equals(periodType)
                        ? "DAY:" + request.businessDate()
                        : weekKey(request.businessDate());
            }
            String initialStatus = OffsetDateTime.now().isBefore(availableAt) ? "PLANNED" : "AVAILABLE";
            UUID expectationId = UUID.randomUUID();
            int inserted = jdbc.update("""
                    insert into work_expectation
                        (id, tenant_id, work_package_item_id, work_package_allocation_id,
                         position_assignment_id, duty_period_id, target_org_unit_id, business_date,
                         period_key, available_at, due_at, status, waiver_allowed)
                    values
                        (:id, :tenantId, :itemId, :allocationId, :assignmentId, :dutyPeriodId,
                         :targetOrgUnitId, :businessDate, :periodKey, :availableAt, :dueAt, :status,
                         :waiverAllowed)
                    on conflict (tenant_id, work_package_item_id, position_assignment_id,
                                 target_org_unit_id, period_key) do nothing
                    """, base(principal)
                    .addValue("id", expectationId)
                    .addValue("itemId", candidate.itemId())
                    .addValue("allocationId", candidate.allocationId())
                    .addValue("assignmentId", request.positionAssignmentId())
                    .addValue("dutyPeriodId", request.dutyPeriodId())
                    .addValue("targetOrgUnitId", request.targetOrgUnitId())
                    .addValue("businessDate", request.businessDate())
                    .addValue("periodKey", periodKey)
                    .addValue("availableAt", availableAt)
                    .addValue("dueAt", dueAt)
                    .addValue("status", initialStatus)
                    .addValue("waiverAllowed", candidate.waiverAllowed()));
            if (inserted == 1) {
                created++;
                createdIds.add(expectationId);
                auditWriter.emit("WORK_EXPECTATION", expectationId, "WorkExpectationCreated",
                        "{\"workExpectationId\":\"" + expectationId + "\",\"positionAssignmentId\":\""
                                + request.positionAssignmentId() + "\",\"orgUnitId\":\""
                                + request.targetOrgUnitId() + "\"}");
            }
        }
        return response("candidateCount", candidates.size(), "createdCount", created,
                "existingCount", candidates.size() - created, "createdIds", createdIds);
    }

    private void insertScope(TenantPrincipal principal, UUID versionId, WorkPackageModels.Scope scope) {
        String scopeType = scope.scopeType().trim().toUpperCase(Locale.ROOT);
        UUID brandId = null;
        UUID orgUnitId = null;
        UUID positionId = null;
        switch (scopeType) {
            case "TENANT" -> {
                if (!principal.hasTenantScope()) {
                    throw new AccessDeniedException("仅集团级管理员可以配置租户范围");
                }
            }
            case "BRAND" -> {
                if (scope.brandId() == null) {
                    throw new IllegalArgumentException("BRAND范围必须提供brandId");
                }
                requireOwned("brand", principal, scope.brandId());
                brandId = scope.brandId();
            }
            case "ORG_UNIT", "ORG_TREE" -> {
                if (scope.orgUnitId() == null) {
                    throw new IllegalArgumentException(scopeType + "范围必须提供orgUnitId");
                }
                requireOwned("org_unit", principal, scope.orgUnitId());
                accessPolicy.requireOrgScope(scope.orgUnitId());
                orgUnitId = scope.orgUnitId();
            }
            case "POSITION" -> {
                if (scope.positionId() == null) {
                    throw new IllegalArgumentException("POSITION范围必须提供positionId");
                }
                requireOwned("position_definition", principal, scope.positionId());
                positionId = scope.positionId();
            }
            default -> throw new IllegalArgumentException("不支持的工作包范围类型: " + scopeType);
        }
        jdbc.update("""
                insert into work_package_scope
                    (id, tenant_id, work_package_version_id, scope_type, brand_id, org_unit_id, position_id)
                values
                    (:id, :tenantId, :versionId, :scopeType, :brandId, :orgUnitId, :positionId)
                """, base(principal)
                .addValue("id", UUID.randomUUID())
                .addValue("versionId", versionId)
                .addValue("scopeType", scopeType)
                .addValue("brandId", brandId)
                .addValue("orgUnitId", orgUnitId)
                .addValue("positionId", positionId));
    }

    private void insertItem(
            TenantPrincipal principal,
            UUID versionId,
            WorkPackageModels.Item item,
            String itemCode
    ) {
        requireOwned("form_version", principal, item.formVersionId());
        String periodType = item.periodType().trim().toUpperCase(Locale.ROOT);
        if (!PERIOD_TYPES.contains(periodType)) {
            throw new IllegalArgumentException("不支持的工作周期: " + periodType);
        }
        String weekdays = toPostgresSmallIntArray(item.weekdays());
        UUID itemId = UUID.randomUUID();
        jdbc.update("""
                insert into work_package_item
                    (id, tenant_id, work_package_version_id, item_code, name, description, item_type,
                     form_version_id, sort_order, required, period_type, timezone_mode, fixed_timezone,
                     work_window_start, work_window_end, due_local_time, grace_minutes, weekdays,
                     day_of_month, holiday_policy, waiver_allowed, target_granularity, review_mode,
                     submission_policy)
                values
                    (:id, :tenantId, :versionId, :itemCode, :name, :description, :itemType,
                     :formVersionId, :sortOrder, :required, :periodType, :timezoneMode, :fixedTimezone,
                     :workWindowStart, :workWindowEnd, :dueLocalTime, :graceMinutes,
                     cast(:weekdays as smallint[]), :dayOfMonth, :holidayPolicy, :waiverAllowed,
                     :targetGranularity, :reviewMode, cast(:submissionPolicy as jsonb))
                """, base(principal)
                .addValue("id", itemId)
                .addValue("versionId", versionId)
                .addValue("itemCode", itemCode)
                .addValue("name", item.name().trim())
                .addValue("description", trimToNull(item.description()))
                .addValue("itemType", item.itemType().trim().toUpperCase(Locale.ROOT))
                .addValue("formVersionId", item.formVersionId())
                .addValue("sortOrder", item.sortOrder() == null ? 0 : item.sortOrder())
                .addValue("required", item.required() == null || item.required())
                .addValue("periodType", periodType)
                .addValue("timezoneMode", defaultUpper(item.timezoneMode(), "HOTEL"))
                .addValue("fixedTimezone", trimToNull(item.fixedTimezone()))
                .addValue("workWindowStart", item.workWindowStart())
                .addValue("workWindowEnd", item.workWindowEnd())
                .addValue("dueLocalTime", item.dueLocalTime())
                .addValue("graceMinutes", item.graceMinutes() == null ? 0 : item.graceMinutes())
                .addValue("weekdays", weekdays)
                .addValue("dayOfMonth", item.dayOfMonth())
                .addValue("holidayPolicy", defaultUpper(item.holidayPolicy(), "INCLUDE"))
                .addValue("waiverAllowed", item.waiverAllowed() != null && item.waiverAllowed())
                .addValue("targetGranularity", defaultUpper(item.targetGranularity(), "ASSIGNMENT_ORG"))
                .addValue("reviewMode", defaultUpper(item.reviewMode(), "MANUAL"))
                .addValue("submissionPolicy", normalizeSubmissionPolicy(item.submissionPolicy())));

        for (WorkPackageModels.StandardLink standard : nullSafe(item.standards())) {
            requireOwned("standard_version", principal, standard.standardVersionId());
            jdbc.update("""
                    insert into work_package_item_standard
                        (id, tenant_id, work_package_item_id, standard_version_id, usage_type, weight)
                    values
                        (:id, :tenantId, :itemId, :standardVersionId, :usageType, :weight)
                    """, base(principal)
                    .addValue("id", UUID.randomUUID())
                    .addValue("itemId", itemId)
                    .addValue("standardVersionId", standard.standardVersionId())
                    .addValue("usageType", standard.usageType().trim().toUpperCase(Locale.ROOT))
                    .addValue("weight", standard.weight() == null ? BigDecimal.ONE : standard.weight()));
        }
        for (WorkPackageModels.Responsibility responsibility : item.responsibilities()) {
            if (responsibility.positionId() != null) {
                requireOwned("position_definition", principal, responsibility.positionId());
            }
            jdbc.update("""
                    insert into work_package_item_responsibility
                        (id, tenant_id, work_package_item_id, participant_type, resolver_type,
                         position_id, scope_strategy, escalation_level)
                    values
                        (:id, :tenantId, :itemId, :participantType, :resolverType,
                         :positionId, :scopeStrategy, :escalationLevel)
                    """, base(principal)
                    .addValue("id", UUID.randomUUID())
                    .addValue("itemId", itemId)
                    .addValue("participantType", responsibility.participantType().trim().toUpperCase(Locale.ROOT))
                    .addValue("resolverType", responsibility.resolverType().trim().toUpperCase(Locale.ROOT))
                    .addValue("positionId", responsibility.positionId())
                    .addValue("scopeStrategy", defaultUpper(responsibility.scopeStrategy(), "TARGET_ORG"))
                    .addValue("escalationLevel", responsibility.escalationLevel() == null ? 0 : responsibility.escalationLevel()));
        }
    }

    private List<String> validationIssues(TenantPrincipal principal, UUID versionId) {
        MapSqlParameterSource params = base(principal).addValue("versionId", versionId);
        List<String> issues = new ArrayList<>();
        Integer scopeCount = jdbc.queryForObject("""
                select count(*) from work_package_scope
                where tenant_id = :tenantId and work_package_version_id = :versionId
                """, params, Integer.class);
        if (scopeCount == null || scopeCount == 0) {
            issues.add("至少配置一个适用范围");
        }
        Integer itemCount = jdbc.queryForObject("""
                select count(*) from work_package_item
                where tenant_id = :tenantId and work_package_version_id = :versionId
                """, params, Integer.class);
        if (itemCount == null || itemCount == 0) {
            issues.add("至少配置一个工作条目");
        }
        List<String> badForms = jdbc.queryForList("""
                select i.item_code
                from work_package_item i
                left join form_version f on f.tenant_id = i.tenant_id and f.id = i.form_version_id
                where i.tenant_id = :tenantId and i.work_package_version_id = :versionId
                  and (f.id is null or f.lifecycle_status <> 'PUBLISHED')
                order by i.item_code
                """, params, String.class);
        if (!badForms.isEmpty()) {
            issues.add("条目引用的表单版本未发布: " + String.join(",", badForms));
        }
        List<String> badStandards = jdbc.queryForList("""
                select distinct i.item_code
                from work_package_item i
                join work_package_item_standard s on s.tenant_id = i.tenant_id and s.work_package_item_id = i.id
                left join standard_version v on v.tenant_id = s.tenant_id and v.id = s.standard_version_id
                where i.tenant_id = :tenantId and i.work_package_version_id = :versionId
                  and (v.id is null or v.lifecycle_status <> 'PUBLISHED')
                order by i.item_code
                """, params, String.class);
        if (!badStandards.isEmpty()) {
            issues.add("条目引用的标准版本未发布: " + String.join(",", badStandards));
        }
        List<String> missingExecutor = jdbc.queryForList("""
                select i.item_code
                from work_package_item i
                where i.tenant_id = :tenantId and i.work_package_version_id = :versionId
                  and not exists (
                      select 1 from work_package_item_responsibility r
                      where r.tenant_id = i.tenant_id and r.work_package_item_id = i.id
                        and r.participant_type = 'EXECUTOR'
                  )
                order by i.item_code
                """, params, String.class);
        if (!missingExecutor.isEmpty()) {
            issues.add("条目缺少执行责任: " + String.join(",", missingExecutor));
        }
        List<String> missingAcceptor = jdbc.queryForList("""
                select i.item_code
                from work_package_item i
                where i.tenant_id = :tenantId and i.work_package_version_id = :versionId
                  and i.review_mode <> 'NONE'
                  and not exists (
                      select 1 from work_package_item_responsibility r
                      where r.tenant_id = i.tenant_id and r.work_package_item_id = i.id
                        and r.participant_type = 'ACCEPTOR'
                  )
                order by i.item_code
                """, params, String.class);
        if (!missingAcceptor.isEmpty()) {
            issues.add("需要复核的条目缺少验收责任: " + String.join(",", missingAcceptor));
        }
        return issues;
    }

    private Map<String, Object> versionConfiguration(TenantPrincipal principal, UUID versionId) {
        MapSqlParameterSource params = base(principal).addValue("versionId", versionId);
        Map<String, Object> configuration = new LinkedHashMap<>();
        configuration.put("scopes", jdbc.queryForList("""
                select id, scope_type, brand_id, org_unit_id, position_id
                from work_package_scope
                where tenant_id = :tenantId and work_package_version_id = :versionId
                order by scope_type, id
                """, params));
        List<Map<String, Object>> items = jdbc.queryForList("""
                select * from work_package_item
                where tenant_id = :tenantId and work_package_version_id = :versionId
                order by sort_order, item_code
                """, params);
        for (Map<String, Object> item : items) {
            normalizeSqlArray(item, "weekdays");
            UUID itemId = (UUID) item.get("id");
            item.put("standards", jdbc.queryForList("""
                    select standard_version_id, usage_type, weight
                    from work_package_item_standard
                    where tenant_id = :tenantId and work_package_item_id = :itemId
                    order by usage_type, standard_version_id
                    """, base(principal).addValue("itemId", itemId)));
            item.put("responsibilities", jdbc.queryForList("""
                    select participant_type, resolver_type, position_id, scope_strategy, escalation_level
                    from work_package_item_responsibility
                    where tenant_id = :tenantId and work_package_item_id = :itemId
                    order by participant_type, escalation_level
                    """, base(principal).addValue("itemId", itemId)));
        }
        configuration.put("items", items);
        return configuration;
    }

    private static void normalizeSqlArray(Map<String, Object> row, String column) {
        Object value = row.get(column);
        if (!(value instanceof java.sql.Array sqlArray)) {
            return;
        }
        try {
            Object array = sqlArray.getArray();
            row.put(column, array instanceof Object[] values
                    ? java.util.Arrays.asList(values)
                    : List.of());
        } catch (java.sql.SQLException exception) {
            throw new IllegalStateException("无法读取数据库数组字段: " + column, exception);
        } finally {
            try {
                sqlArray.free();
            } catch (java.sql.SQLException ignored) {
                // The value has already been copied to a detached Java list.
            }
        }
    }

    private String normalizeSubmissionPolicy(JsonNode configured) {
        ObjectNode policy = JsonNodeFactory.instance.objectNode();
        policy.put("completionStatementRequired", true);
        policy.put("exceptionStatementRequired", false);
        policy.put("nextActionRequired", false);
        policy.put("attachmentRequired", false);
        policy.put("maxAttachments", 10);
        policy.put("maxFileSizeBytes", 20 * 1024 * 1024);
        policy.putArray("allowedExtensions").add("jpg").add("jpeg").add("png")
                .add("pdf").add("docx").add("xlsx");
        if (configured != null && !configured.isNull()) {
            if (!configured.isObject()) {
                throw new IllegalArgumentException("工作提交策略必须是JSON对象");
            }
            policy.setAll((ObjectNode) configured);
        }
        int maxAttachments = policy.path("maxAttachments").asInt(10);
        if (maxAttachments < 0 || maxAttachments > 10) {
            throw new IllegalArgumentException("单条工作记录附件数量必须在0到10之间");
        }
        long maxBytes = policy.path("maxFileSizeBytes").asLong(20L * 1024 * 1024);
        if (maxBytes < 1 || maxBytes > 20L * 1024 * 1024) {
            throw new IllegalArgumentException("单个附件大小上限不能超过20MB");
        }
        return policy.toString();
    }

    private String contentSnapshot(TenantPrincipal principal, UUID versionId) {
        return jdbc.queryForObject("""
                select jsonb_build_object(
                    'version', to_jsonb(v) - ARRAY['created_at', 'updated_at', 'published_at', 'published_by'],
                    'scopes', coalesce((
                        select jsonb_agg(to_jsonb(s) - 'created_at' order by s.scope_type, s.id)
                        from work_package_scope s
                        where s.tenant_id = v.tenant_id and s.work_package_version_id = v.id
                    ), '[]'::jsonb),
                    'items', coalesce((
                        select jsonb_agg(
                            jsonb_build_object(
                                'item', to_jsonb(i) - ARRAY['created_at', 'updated_at'],
                                'standards', coalesce((
                                    select jsonb_agg(to_jsonb(st) - 'created_at' order by st.usage_type, st.id)
                                    from work_package_item_standard st
                                    where st.tenant_id = i.tenant_id and st.work_package_item_id = i.id
                                ), '[]'::jsonb),
                                'responsibilities', coalesce((
                                    select jsonb_agg(to_jsonb(r) - 'created_at' order by r.participant_type, r.escalation_level)
                                    from work_package_item_responsibility r
                                    where r.tenant_id = i.tenant_id and r.work_package_item_id = i.id
                                ), '[]'::jsonb)
                            ) order by i.sort_order, i.item_code
                        )
                        from work_package_item i
                        where i.tenant_id = v.tenant_id and i.work_package_version_id = v.id
                    ), '[]'::jsonb)
                )::text
                from work_package_version v
                where v.tenant_id = :tenantId and v.id = :versionId
                """, base(principal).addValue("versionId", versionId), String.class);
    }

    private void requireVisible(TenantPrincipal principal, UUID workPackageId) {
        if (principal.hasTenantScope()) {
            requireOwnedDefinition(principal, workPackageId);
            return;
        }
        if (principal.orgScopes().isEmpty()) {
            throw new AccessDeniedException("工作包不在当前数据范围内");
        }
        Integer count = jdbc.queryForObject("""
                select count(*)
                from work_package_definition d
                where d.tenant_id = :tenantId and d.id = :workPackageId
                  and exists (
                      select 1 from work_package_version v
                      join work_package_allocation a
                        on a.tenant_id = v.tenant_id and a.work_package_version_id = v.id
                      join org_unit_closure c
                        on c.tenant_id = a.tenant_id and c.descendant_id = a.target_org_unit_id
                      where v.tenant_id = d.tenant_id and v.work_package_definition_id = d.id
                        and a.status = 'ACTIVE' and c.ancestor_id in (:scopeIds)
                  )
                """, base(principal)
                .addValue("workPackageId", workPackageId)
                .addValue("scopeIds", principal.orgScopes()), Integer.class);
        if (count == null || count == 0) {
            throw new AccessDeniedException("工作包不在当前数据范围内");
        }
    }

    private void requireOwnedDefinition(TenantPrincipal principal, UUID workPackageId) {
        Integer count = jdbc.queryForObject("""
                select count(*) from work_package_definition
                where tenant_id = :tenantId and id = :workPackageId
                """, base(principal).addValue("workPackageId", workPackageId), Integer.class);
        if (count == null || count == 0) {
            throw new IllegalArgumentException("工作包不存在或不属于当前租户");
        }
    }

    private void requireDraftVersion(TenantPrincipal principal, UUID workPackageId, UUID versionId) {
        requireManageableDefinition(principal, workPackageId);
        Integer count = jdbc.queryForObject("""
                select count(*) from work_package_version
                where tenant_id = :tenantId and id = :versionId
                  and work_package_definition_id = :workPackageId and lifecycle_status = 'DRAFT'
                """, base(principal)
                .addValue("workPackageId", workPackageId)
                .addValue("versionId", versionId), Integer.class);
        if (count == null || count == 0) {
            throw new IllegalArgumentException("草稿工作包版本不存在或不属于当前租户");
        }
    }

    private void requireManageableDefinition(TenantPrincipal principal, UUID workPackageId) {
        Map<String, Object> definition;
        try {
            definition = jdbc.queryForMap("""
                    select owner_org_unit_id
                    from work_package_definition
                    where tenant_id = :tenantId and id = :workPackageId
                    """, base(principal).addValue("workPackageId", workPackageId));
        } catch (org.springframework.dao.EmptyResultDataAccessException exception) {
            throw new IllegalArgumentException("工作包不存在或不属于当前租户");
        }
        if (principal.hasTenantScope()) {
            return;
        }
        UUID ownerOrgUnitId = (UUID) definition.get("owner_org_unit_id");
        if (ownerOrgUnitId == null) {
            throw new AccessDeniedException("集团统一工作包只能由集团级管理员维护");
        }
        accessPolicy.requireOrgScope(ownerOrgUnitId);
    }

    private void requireActiveAssignment(TenantPrincipal principal, UUID assignmentId, LocalDate businessDate) {
        Integer count = jdbc.queryForObject("""
                select count(*) from employee_position_assignment
                where tenant_id = :tenantId and id = :assignmentId and status = 'ACTIVE'
                  and valid_from <= :businessDate and (valid_to is null or valid_to >= :businessDate)
                """, base(principal)
                .addValue("assignmentId", assignmentId)
                .addValue("businessDate", businessDate), Integer.class);
        if (count == null || count == 0) {
            throw new IllegalArgumentException("指定任职在业务日期无效");
        }
    }

    private ExpectationAccess expectationAccess(TenantPrincipal principal, UUID expectationId) {
        return jdbc.queryForObject("""
                select target_org_unit_id, position_assignment_id, waiver_allowed
                from work_expectation
                where tenant_id = :tenantId and id = :expectationId
                """, base(principal).addValue("expectationId", expectationId),
                (rs, rowNum) -> new ExpectationAccess(
                        rs.getObject("target_org_unit_id", UUID.class),
                        rs.getObject("position_assignment_id", UUID.class),
                        rs.getBoolean("waiver_allowed")));
    }

    private String orgVisibility(TenantPrincipal principal, MapSqlParameterSource params, String orgExpression) {
        if (principal.hasTenantScope()) {
            return "";
        }
        if (principal.orgScopes().isEmpty()) {
            return " and 1 = 0 ";
        }
        params.addValue("visibleOrgScopes", principal.orgScopes());
        return " and exists (select 1 from org_unit_closure visible_scope "
                + "where visible_scope.tenant_id = :tenantId and visible_scope.descendant_id = " + orgExpression
                + " and visible_scope.ancestor_id in (:visibleOrgScopes)) ";
    }

    private void requireOwned(String table, TenantPrincipal principal, UUID id) {
        if (!Set.of("position_definition", "org_unit", "brand", "form_version", "standard_version").contains(table)) {
            throw new IllegalArgumentException("不允许的实体类型");
        }
        Integer count = jdbc.queryForObject(
                "select count(*) from " + table + " where tenant_id = :tenantId and id = :id",
                base(principal).addValue("id", id), Integer.class);
        if (count == null || count == 0) {
            throw new IllegalArgumentException("资源不存在或不属于当前租户");
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

    private static ZoneId zone(GenerationCandidate candidate, String tenantTimezone) {
        String zoneName = "FIXED".equals(candidate.timezoneMode())
                ? candidate.fixedTimezone() : tenantTimezone;
        try {
            return ZoneId.of(zoneName);
        } catch (DateTimeException exception) {
            throw new IllegalArgumentException("无效的工作包时区: " + zoneName);
        }
    }

    private static String weekKey(LocalDate date) {
        WeekFields fields = WeekFields.ISO;
        return "WEEK:" + date.get(fields.weekBasedYear()) + "-W" + String.format("%02d", date.get(fields.weekOfWeekBasedYear()));
    }

    private static String toPostgresSmallIntArray(List<Integer> weekdays) {
        if (weekdays == null || weekdays.isEmpty()) {
            return "{}";
        }
        for (Integer day : weekdays) {
            if (day == null || day < 1 || day > 7) {
                throw new IllegalArgumentException("weekdays只能包含1到7");
            }
        }
        return "{" + String.join(",", weekdays.stream().map(String::valueOf).toList()) + "}";
    }

    private static String sha256(String value) {
        try {
            byte[] digest = MessageDigest.getInstance("SHA-256").digest(value.getBytes(StandardCharsets.UTF_8));
            return HexFormat.of().formatHex(digest);
        } catch (Exception exception) {
            throw new IllegalStateException("无法计算工作包内容摘要", exception);
        }
    }

    private static String normalizeCode(String value) {
        return value.trim().toUpperCase(Locale.ROOT);
    }

    private static String defaultUpper(String value, String defaultValue) {
        return value == null || value.isBlank() ? defaultValue : value.trim().toUpperCase(Locale.ROOT);
    }

    private static String trimToNull(String value) {
        return value == null || value.isBlank() ? null : value.trim();
    }

    private static String jsonEscape(String value) {
        return value.replace("\\", "\\\\").replace("\"", "\\\"");
    }

    private static <T> List<T> nullSafe(List<T> list) {
        return list == null ? List.of() : list;
    }

    private static Map<String, Object> response(Object... values) {
        Map<String, Object> result = new LinkedHashMap<>();
        for (int index = 0; index < values.length; index += 2) {
            result.put(String.valueOf(values[index]), values[index + 1]);
        }
        return result;
    }

    private record GenerationCandidate(
            UUID itemId,
            UUID allocationId,
            String timezoneMode,
            String fixedTimezone,
            LocalTime windowStart,
            LocalTime dueLocalTime,
            boolean waiverAllowed
    ) {
    }

    private record DutyWindow(
            OffsetDateTime start,
            OffsetDateTime end,
            String periodType,
            UUID assignmentId,
            UUID targetOrgUnitId,
            LocalDate businessDate,
            String status
    ) {
    }

    private record ExpectationAccess(UUID targetOrgUnitId, UUID assignmentId, boolean waiverAllowed) {
    }
}
