package cn.sifangguan.hotelaios.dailyoperations;

import cn.sifangguan.hotelaios.shared.audit.AuditWriter;
import cn.sifangguan.hotelaios.shared.context.TenantPrincipal;
import cn.sifangguan.hotelaios.shared.db.TenantDatabaseContext;
import cn.sifangguan.hotelaios.shared.events.BusinessEvent;
import cn.sifangguan.hotelaios.shared.events.BusinessEventPublisher;
import cn.sifangguan.hotelaios.shared.idempotency.CommandIdempotencyService;
import cn.sifangguan.hotelaios.shared.security.AccessDeniedException;
import cn.sifangguan.hotelaios.shared.security.AccessPolicy;
import cn.sifangguan.hotelaios.shared.time.BusinessDayService;
import cn.sifangguan.hotelaios.tasks.TaskModels;
import cn.sifangguan.hotelaios.tasks.TaskService;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.dao.EmptyResultDataAccessException;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

@Service
public class TaskCandidateService {
    private static final UUID EMPTY_SCOPE = new UUID(0, 0);

    private final NamedParameterJdbcTemplate jdbc;
    private final TenantDatabaseContext databaseContext;
    private final AccessPolicy accessPolicy;
    private final BusinessDayService businessDayService;
    private final CommandIdempotencyService idempotencyService;
    private final TaskService taskService;
    private final AuditWriter auditWriter;
    private final BusinessEventPublisher businessEvents;
    private final ApplicationEventPublisher applicationEvents;
    private final ObjectMapper objectMapper;

    public TaskCandidateService(
            NamedParameterJdbcTemplate jdbc,
            TenantDatabaseContext databaseContext,
            AccessPolicy accessPolicy,
            BusinessDayService businessDayService,
            CommandIdempotencyService idempotencyService,
            TaskService taskService,
            AuditWriter auditWriter,
            BusinessEventPublisher businessEvents,
            ApplicationEventPublisher applicationEvents,
            ObjectMapper objectMapper
    ) {
        this.jdbc = jdbc;
        this.databaseContext = databaseContext;
        this.accessPolicy = accessPolicy;
        this.businessDayService = businessDayService;
        this.idempotencyService = idempotencyService;
        this.taskService = taskService;
        this.auditWriter = auditWriter;
        this.businessEvents = businessEvents;
        this.applicationEvents = applicationEvents;
        this.objectMapper = objectMapper;
    }

    @Transactional(readOnly = true)
    public List<Map<String, Object>> list(UUID orgUnitId, String status) {
        accessPolicy.requirePermission("task-candidate.read");
        TenantPrincipal principal = prepare();
        if (orgUnitId != null) accessPolicy.requireOrgScope(orgUnitId);
        return jdbc.queryForList("""
                select c.id, c.candidate_no, c.issue_id, c.hotel_org_unit_id, c.org_unit_id,
                       c.business_date, c.title, c.description, c.priority, c.status,
                       c.assignee_assignment_id, c.reviewer_assignment_id, c.standard_version_id,
                       c.due_at, c.acceptance_criteria, c.formal_task_id, c.formal_task_no,
                       c.row_version, c.created_at, c.updated_at,
                       sync.status as sync_status, sync.attempt_count as sync_attempt_count,
                       sync.next_retry_at, sync.last_error
                from task_candidate c
                left join lateral (
                    select operation.status, operation.attempt_count, operation.next_retry_at, operation.last_error
                    from sync_operation operation
                    where operation.tenant_id = c.tenant_id
                      and operation.aggregate_type = 'TASK_CANDIDATE'
                      and operation.aggregate_id = c.id
                    order by operation.created_at desc, operation.id desc limit 1
                ) sync on true
                where c.tenant_id = :tenantId
                  and (:tenantScope or c.org_unit_id in (:orgScopes))
                  and (cast(:orgUnitId as uuid) is null or exists (
                    select 1 from org_unit_closure scope
                    where scope.tenant_id = c.tenant_id and scope.ancestor_id = :orgUnitId
                      and scope.descendant_id = c.org_unit_id
                  ))
                  and (cast(:status as varchar) is null or c.status = :status)
                order by case c.priority when 'URGENT' then 1 when 'HIGH' then 2 else 3 end,
                         c.due_at nulls last, c.created_at, c.id
                """, scoped(principal).addValue("orgUnitId", orgUnitId)
                .addValue("status", normalizeNullable(status)));
    }

    @Transactional(readOnly = true)
    public Map<String, Object> detail(UUID candidateId) {
        accessPolicy.requirePermission("task-candidate.read");
        return detailResult(prepare(), candidateId, false);
    }

    @Transactional
    public Map<String, Object> create(OperationModels.CreateTaskCandidate request, String idempotencyKey) {
        accessPolicy.requirePermission("task-candidate.manage");
        TenantPrincipal principal = prepare();
        UUID actorAssignmentId = resolveActorAssignment(principal, request.createdByAssignmentId());
        CommandIdempotencyService.Reservation reservation = idempotencyService.reserve(
                "TASK_CANDIDATE_CREATE", requiredKey(idempotencyKey), request, principal.correlationId());
        if (reservation.replayed()) return detailResult(principal, reservation.resourceId(), false);

        CandidateContext context = resolveContext(principal, request);
        UUID candidateId = insertCandidate(principal, new CandidateDraft(
                request.issueId(), context.hotelOrgUnitId(), context.orgUnitId(), context.businessDate(),
                request.title(), request.description(), normalizePriority(request.priority()),
                context.assigneeAssignmentId(), context.reviewerAssignmentId(), request.standardVersionId(),
                request.dueAt(), request.acceptanceCriteria(), actorAssignmentId,
                request.sourceSnapshot(), principal.correlationId(), requiredKey(idempotencyKey), null, null));
        auditWriter.record("TASK_CANDIDATE_CREATED", "TASK_CANDIDATE", candidateId,
                json(Map.of("candidateId", candidateId)));
        Map<String, Object> result = detailResult(principal, candidateId, false);
        idempotencyService.succeed(reservation, "TASK_CANDIDATE", candidateId, 201, result);
        return result;
    }

    /** Called only by the Rule Engine after its deterministic condition matched. */
    @Transactional
    public UUID createFromRule(RuleCandidateSpec spec, String idempotencyKey) {
        TenantPrincipal principal = prepare();
        List<UUID> existing = jdbc.queryForList("""
                select id from task_candidate
                where tenant_id = :tenantId and source_rule_action_id = :sourceRuleActionId
                """, base(principal).addValue("sourceRuleActionId", spec.sourceRuleActionId()), UUID.class);
        if (!existing.isEmpty()) return existing.getFirst();
        BusinessDayService.BusinessDayContext day = businessDayService.resolve(spec.orgUnitId(), spec.businessDate());
        ObjectNode snapshot = objectMapper.createObjectNode();
        snapshot.put("source", "RULE_ENGINE");
        if (spec.sourceEventId() != null) snapshot.put("sourceEventId", spec.sourceEventId().toString());
        if (spec.sourceRuleActionId() != null) snapshot.put("sourceRuleActionId", spec.sourceRuleActionId().toString());
        if (spec.sourceSnapshot() != null) snapshot.set("facts", spec.sourceSnapshot().deepCopy());
        return insertCandidate(principal, new CandidateDraft(
                spec.issueId(), day.hotelOrgUnitId(), spec.orgUnitId(), day.businessDate(),
                spec.title(), spec.description(), normalizePriority(spec.priority()),
                spec.assigneeAssignmentId(), spec.reviewerAssignmentId(), spec.standardVersionId(),
                spec.dueAt(), spec.acceptanceCriteria(), spec.createdByAssignmentId(),
                snapshot, principal.correlationId(), requiredKey(idempotencyKey),
                spec.sourceEventId(), spec.sourceRuleActionId()));
    }

    @Transactional
    public Map<String, Object> confirm(
            UUID candidateId,
            String idempotencyKey,
            OperationModels.CandidateDecision request
    ) {
        accessPolicy.requirePermission("task-candidate.confirm");
        TenantPrincipal principal = prepare();
        UUID actorAssignmentId = resolveActorAssignment(principal, request.actorAssignmentId());
        Map<String, Object> candidate = candidateRow(principal, candidateId, true);
        if (Set.of("CONFIRMED", "PENDING_SYNC", "TASK_CREATED").contains(String.valueOf(candidate.get("status")))) {
            return detailResult(principal, candidateId, false);
        }
        requireVersion(candidate, request.expectedVersion());
        if (!"PENDING_CONFIRMATION".equals(candidate.get("status"))) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "TASK_CANDIDATE_NOT_CONFIRMABLE");
        }
        UUID reviewerAssignmentId = (UUID) candidate.get("reviewer_assignment_id");
        if (!principal.hasTenantScope() && !actorAssignmentId.equals(reviewerAssignmentId)) {
            throw new AccessDeniedException("任务候选必须由指定验收岗位确认");
        }
        if (actorAssignmentId.equals(candidate.get("assignee_assignment_id"))) {
            throw new AccessDeniedException("任务责任人与确认人不得为同一任职");
        }
        requireIndependentConfirmation(principal, candidate, actorAssignmentId);
        int updated = jdbc.update("""
                update task_candidate
                set status = 'PENDING_SYNC', confirmed_by_account_id = :actorId,
                    confirmed_by_assignment_id = :actorAssignmentId, confirmed_at = now(),
                    row_version = row_version + 1, updated_at = now()
                where tenant_id = :tenantId and id = :candidateId
                  and row_version = :expectedVersion and status = 'PENDING_CONFIRMATION'
                """, base(principal).addValue("candidateId", candidateId)
                .addValue("actorId", principal.actorId())
                .addValue("actorAssignmentId", actorAssignmentId)
                .addValue("expectedVersion", request.expectedVersion()));
        if (updated != 1) throw new ResponseStatusException(HttpStatus.CONFLICT, "TASK_CANDIDATE_VERSION_CONFLICT");
        UUID syncId = ensureSyncOperation(principal, candidateId, idempotencyKey);
        ObjectNode payload = objectMapper.createObjectNode()
                .put("taskCandidateId", candidateId.toString())
                .put("syncOperationId", syncId.toString());
        businessEvents.publish(new BusinessEvent(
                "TASK_CANDIDATE", candidateId, "TASK_CANDIDATE_CONFIRMED", 1, "daily-operations",
                (UUID) candidate.get("org_unit_id"), (UUID) candidate.get("hotel_org_unit_id"),
                actorAssignmentId, actorAssignmentId, asLocalDate(candidate.get("business_date")),
                (UUID) candidate.get("trace_id"), null, idempotencyKey, "INTERNAL", payload));
        auditWriter.record("TASK_CANDIDATE_CONFIRMED", "TASK_CANDIDATE", candidateId, payload.toString());
        applicationEvents.publishEvent(new CandidateSyncRequested(candidateId, principal.correlationId()));
        return detailResult(principal, candidateId, false);
    }

    @Transactional
    public Map<String, Object> reject(
            UUID candidateId,
            String idempotencyKey,
            OperationModels.CandidateDecision request
    ) {
        accessPolicy.requirePermission("task-candidate.reject");
        TenantPrincipal principal = prepare();
        UUID actorAssignmentId = resolveActorAssignment(principal, request.actorAssignmentId());
        if (request.reason() == null || request.reason().isBlank()) {
            throw new IllegalArgumentException("驳回任务候选必须填写原因");
        }
        Map<String, Object> candidate = candidateRow(principal, candidateId, true);
        if ("REJECTED".equals(candidate.get("status"))) return detailResult(principal, candidateId, false);
        requireVersion(candidate, request.expectedVersion());
        if (!"PENDING_CONFIRMATION".equals(candidate.get("status"))) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "TASK_CANDIDATE_NOT_REJECTABLE");
        }
        jdbc.update("""
                update task_candidate
                set status = 'REJECTED', rejected_by_account_id = :actorId,
                    rejected_by_assignment_id = :actorAssignmentId, rejected_at = now(),
                    rejection_reason = :reason, row_version = row_version + 1, updated_at = now()
                where tenant_id = :tenantId and id = :candidateId and row_version = :expectedVersion
                """, base(principal).addValue("candidateId", candidateId)
                .addValue("actorId", principal.actorId())
                .addValue("actorAssignmentId", actorAssignmentId)
                .addValue("reason", request.reason().trim())
                .addValue("expectedVersion", request.expectedVersion()));
        auditWriter.record("TASK_CANDIDATE_REJECTED", "TASK_CANDIDATE", candidateId,
                json(Map.of("reason", request.reason())));
        return detailResult(principal, candidateId, false);
    }

    @Transactional
    public Map<String, Object> retry(
            UUID candidateId,
            String idempotencyKey,
            OperationModels.CandidateDecision request
    ) {
        accessPolicy.requirePermission("task-candidate.retry");
        TenantPrincipal principal = prepare();
        resolveActorAssignment(principal, request.actorAssignmentId());
        Map<String, Object> candidate = candidateRow(principal, candidateId, true);
        requireVersion(candidate, request.expectedVersion());
        if (!Set.of("CONFIRMED", "PENDING_SYNC").contains(String.valueOf(candidate.get("status")))) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "TASK_CANDIDATE_NOT_CONFIRMED");
        }
        if (candidate.get("formal_task_id") != null) return detailResult(principal, candidateId, false);
        jdbc.update("""
                update sync_operation
                set status = 'PENDING', available_at = now(), next_retry_at = null,
                    locked_by = null, locked_until = null, last_error = null,
                    row_version = row_version + 1, updated_at = now()
                where tenant_id = :tenantId and aggregate_type = 'TASK_CANDIDATE'
                  and aggregate_id = :candidateId and status in ('FAILED', 'MANUAL_INTERVENTION')
                """, base(principal).addValue("candidateId", candidateId));
        ensureSyncOperation(principal, candidateId, idempotencyKey);
        applicationEvents.publishEvent(new CandidateSyncRequested(candidateId, principal.correlationId()));
        return detailResult(principal, candidateId, false);
    }

    @Transactional
    public UUID syncConfirmedCandidate(UUID candidateId) {
        TenantPrincipal principal = prepare();
        Map<String, Object> candidate = candidateRow(principal, candidateId, true);
        if (candidate.get("formal_task_id") instanceof UUID existingTaskId) {
            markSyncSucceeded(principal, candidateId, existingTaskId, null);
            return existingTaskId;
        }
        if (!Set.of("CONFIRMED", "PENDING_SYNC").contains(String.valueOf(candidate.get("status")))) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "TASK_CANDIDATE_NOT_CONFIRMED");
        }
        requireValidCandidateAssignments(
                principal,
                (UUID) candidate.get("hotel_org_unit_id"),
                (UUID) candidate.get("org_unit_id"),
                asLocalDate(candidate.get("business_date")),
                (UUID) candidate.get("assignee_assignment_id"),
                (UUID) candidate.get("reviewer_assignment_id")
        );
        jdbc.update("""
                update sync_operation
                set status = 'RUNNING', attempt_count = attempt_count + 1,
                    last_attempt_at = now(),
                    locked_by = :lockedBy, locked_until = now() + interval '2 minutes',
                    last_error = null, row_version = row_version + 1, updated_at = now()
                where tenant_id = :tenantId and aggregate_type = 'TASK_CANDIDATE'
                  and aggregate_id = :candidateId and status in ('PENDING', 'FAILED')
                """, base(principal).addValue("candidateId", candidateId)
                .addValue("lockedBy", "task-candidate-sync:" + principal.correlationId()));
        ObjectNode snapshot = asObjectNode(candidate.get("source_snapshot"));
        snapshot.put("candidateNo", String.valueOf(candidate.get("candidate_no")));
        snapshot.put("acceptanceCriteria", String.valueOf(candidate.get("acceptance_criteria")));
        if (candidate.get("issue_id") != null) {
            snapshot.put("issueId", String.valueOf(candidate.get("issue_id")));
        }
        UUID formalTaskId = taskService.createFromCandidate(new TaskModels.CandidateTaskSpec(
                candidateId,
                (UUID) candidate.get("org_unit_id"),
                (UUID) candidate.get("assignee_assignment_id"),
                (UUID) candidate.get("reviewer_assignment_id"),
                (UUID) candidate.get("standard_version_id"),
                String.valueOf(candidate.get("title")),
                candidate.get("description") == null ? null : String.valueOf(candidate.get("description")),
                String.valueOf(candidate.get("priority")),
                asOffsetDateTime(candidate.get("due_at")),
                snapshot
        ), "task-candidate:" + candidateId);
        TaskModels.TaskReference reference = taskService.integrationReference(formalTaskId);
        ObjectNode taskSnapshot = objectMapper.createObjectNode()
                .put("taskId", reference.id().toString())
                .put("taskNo", reference.taskNo())
                .put("title", reference.title())
                .put("lifecycleStatus", reference.lifecycleStatus());
        jdbc.update("""
                update task_candidate
                set status = 'TASK_CREATED', formal_task_id = :taskId, formal_task_no = :taskNo,
                    formal_task_snapshot = cast(:taskSnapshot as jsonb),
                    row_version = row_version + 1, updated_at = now()
                where tenant_id = :tenantId and id = :candidateId and formal_task_id is null
                """, base(principal).addValue("candidateId", candidateId)
                .addValue("taskId", formalTaskId).addValue("taskNo", reference.taskNo())
                .addValue("taskSnapshot", taskSnapshot.toString()));
        if (candidate.get("issue_id") instanceof UUID issueId) {
            jdbc.update("""
                    insert into issue_task_link
                        (tenant_id, issue_id, task_candidate_id, management_task_id,
                         management_task_no, link_type, task_snapshot, linked_by_account_id)
                    values (:tenantId, :issueId, :candidateId, :taskId,
                            :taskNo, 'CREATED_FROM_CANDIDATE', cast(:taskSnapshot as jsonb), :actorId)
                    on conflict (tenant_id, issue_id, management_task_id) do nothing
                    """, base(principal).addValue("issueId", issueId)
                    .addValue("candidateId", candidateId).addValue("taskId", formalTaskId)
                    .addValue("taskNo", reference.taskNo()).addValue("taskSnapshot", taskSnapshot.toString())
                    .addValue("actorId", principal.actorId()));
        }
        markSyncSucceeded(principal, candidateId, formalTaskId, taskSnapshot);
        ObjectNode payload = objectMapper.createObjectNode()
                .put("taskCandidateId", candidateId.toString())
                .put("formalTaskId", formalTaskId.toString())
                .put("formalTaskNo", reference.taskNo());
        businessEvents.publish(new BusinessEvent(
                "TASK_CANDIDATE", candidateId, "SYNC_OPERATION_COMPLETED", 1, "daily-operations",
                (UUID) candidate.get("org_unit_id"), (UUID) candidate.get("hotel_org_unit_id"),
                null, null, asLocalDate(candidate.get("business_date")),
                (UUID) candidate.get("trace_id"), null, "task-candidate:" + candidateId,
                "INTERNAL", payload));
        return formalTaskId;
    }

    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public void markSyncFailed(UUID candidateId, RuntimeException failure) {
        TenantPrincipal principal = prepare();
        String message = failure.getMessage() == null ? failure.getClass().getSimpleName() : failure.getMessage();
        jdbc.update("""
                update sync_operation
                set attempt_count = attempt_count + 1,
                    status = case when attempt_count + 1 >= 5 then 'MANUAL_INTERVENTION' else 'FAILED' end,
                    next_retry_at = case when attempt_count + 1 >= 5 then null else now() + interval '5 minutes' end,
                    last_attempt_at = now(),
                    locked_by = null, locked_until = null, last_error = :lastError,
                    row_version = row_version + 1, updated_at = now()
                where tenant_id = :tenantId and aggregate_type = 'TASK_CANDIDATE'
                  and aggregate_id = :candidateId
                """, base(principal).addValue("candidateId", candidateId)
                .addValue("lastError", message.substring(0, Math.min(message.length(), 1000))));
        auditWriter.record("TASK_CANDIDATE_SYNC_FAILED", "TASK_CANDIDATE", candidateId,
                json(Map.of("errorType", failure.getClass().getSimpleName())));
    }

    @Transactional(readOnly = true)
    public List<UUID> pendingForRecovery(int batchSize) {
        TenantPrincipal principal = prepare();
        int limit = Math.max(1, Math.min(batchSize, 500));
        return jdbc.queryForList("""
                select operation.aggregate_id
                from sync_operation operation
                join task_candidate candidate
                  on candidate.tenant_id = operation.tenant_id
                 and candidate.id = operation.aggregate_id
                where operation.tenant_id = :tenantId
                  and operation.aggregate_type = 'TASK_CANDIDATE'
                  and operation.operation_type = 'CREATE_FORMAL_TASK'
                  and operation.status in ('PENDING', 'FAILED')
                  and operation.available_at <= now()
                  and (operation.next_retry_at is null or operation.next_retry_at <= now())
                  and (operation.locked_until is null or operation.locked_until < now())
                  and candidate.status in ('CONFIRMED', 'PENDING_SYNC') and candidate.formal_task_id is null
                order by coalesce(operation.next_retry_at, operation.available_at), operation.id
                limit :batchSize
                """, base(principal).addValue("batchSize", limit), UUID.class);
    }

    private UUID insertCandidate(TenantPrincipal principal, CandidateDraft draft) {
        requireValidCandidateAssignments(
                principal,
                draft.hotelOrgUnitId(),
                draft.orgUnitId(),
                draft.businessDate(),
                draft.assigneeAssignmentId(),
                draft.reviewerAssignmentId()
        );
        UUID candidateId = UUID.randomUUID();
        String candidateNo = "TC-" + OffsetDateTime.now(ZoneOffset.UTC)
                .format(DateTimeFormatter.ofPattern("yyyyMMdd")) + "-"
                + candidateId.toString().substring(0, 8).toUpperCase(Locale.ROOT);
        JsonNode sourceSnapshot = draft.sourceSnapshot() == null
                ? objectMapper.createObjectNode() : draft.sourceSnapshot();
        jdbc.update("""
                insert into task_candidate
                    (id, tenant_id, issue_id, candidate_no, hotel_org_unit_id, org_unit_id,
                     business_date, title, description, priority, status,
                     assignee_assignment_id, reviewer_assignment_id, standard_version_id,
                     due_at, acceptance_criteria, source_snapshot,
                     source_event_id, source_rule_action_id,
                     created_by_account_id, created_by_assignment_id, trace_id, idempotency_key)
                values
                    (:id, :tenantId, :issueId, :candidateNo, :hotelOrgUnitId, :orgUnitId,
                     :businessDate, :title, :description, :priority, 'PENDING_CONFIRMATION',
                     :assigneeAssignmentId, :reviewerAssignmentId, :standardVersionId,
                     :dueAt, :acceptanceCriteria, cast(:sourceSnapshot as jsonb),
                     :sourceEventId, :sourceRuleActionId,
                      :actorId, :createdByAssignmentId, :traceId, :idempotencyKey)
                """, base(principal)
                .addValue("id", candidateId).addValue("issueId", draft.issueId())
                .addValue("candidateNo", candidateNo).addValue("hotelOrgUnitId", draft.hotelOrgUnitId())
                .addValue("orgUnitId", draft.orgUnitId()).addValue("businessDate", draft.businessDate())
                .addValue("title", draft.title()).addValue("description", draft.description())
                .addValue("priority", draft.priority()).addValue("assigneeAssignmentId", draft.assigneeAssignmentId())
                .addValue("reviewerAssignmentId", draft.reviewerAssignmentId())
                .addValue("standardVersionId", draft.standardVersionId()).addValue("dueAt", draft.dueAt())
                .addValue("acceptanceCriteria", normalizedAcceptanceCriteria(draft.acceptanceCriteria()))
                .addValue("sourceSnapshot", sourceSnapshot.toString())
                .addValue("sourceEventId", draft.sourceEventId()).addValue("sourceRuleActionId", draft.sourceRuleActionId())
                .addValue("actorId", principal.actorId())
                .addValue("createdByAssignmentId", draft.createdByAssignmentId())
                .addValue("traceId", draft.traceId())
                .addValue("idempotencyKey", draft.idempotencyKey()));
        return candidateId;
    }

    private void requireValidCandidateAssignments(
            TenantPrincipal principal,
            UUID hotelOrgUnitId,
            UUID orgUnitId,
            LocalDate businessDate,
            UUID assigneeAssignmentId,
            UUID reviewerAssignmentId
    ) {
        if (hotelOrgUnitId == null || orgUnitId == null || businessDate == null) {
            throw new IllegalArgumentException("任务候选缺少酒店、组织或业务日上下文");
        }
        if (assigneeAssignmentId == null || reviewerAssignmentId == null) {
            throw new IllegalArgumentException("任务候选必须指定责任人与验收人");
        }
        if (assigneeAssignmentId.equals(reviewerAssignmentId)) {
            throw new IllegalArgumentException("任务责任人与验收人不得为同一任职");
        }

        Boolean assigneeValid = jdbc.queryForObject("""
                select exists (
                    select 1
                    from employee_position_assignment assignment
                    join employee employee_row
                      on employee_row.tenant_id = assignment.tenant_id
                     and employee_row.id = assignment.employee_id
                    join position_definition position
                      on position.tenant_id = assignment.tenant_id
                     and position.id = assignment.position_id
                    join org_unit assignment_org
                      on assignment_org.tenant_id = assignment.tenant_id
                     and assignment_org.id = assignment.org_unit_id
                    join org_unit_closure scope
                      on scope.tenant_id = assignment.tenant_id
                     and scope.ancestor_id = :orgUnitId
                     and scope.descendant_id = assignment.org_unit_id
                    where assignment.tenant_id = :tenantId
                      and assignment.id = :assignmentId
                      and assignment.status = 'ACTIVE'
                      and employee_row.employment_status = 'ACTIVE'
                      and position.status = 'ACTIVE'
                      and assignment_org.status = 'ACTIVE'
                      and assignment.valid_from <= :businessDate
                      and (assignment.valid_to is null or assignment.valid_to >= :businessDate)
                )
                """, base(principal)
                .addValue("orgUnitId", orgUnitId)
                .addValue("assignmentId", assigneeAssignmentId)
                .addValue("businessDate", businessDate), Boolean.class);
        if (!Boolean.TRUE.equals(assigneeValid)) {
            throw new IllegalArgumentException("任务责任任职必须在候选组织的后代范围内且于业务日有效");
        }

        Boolean reviewerValid = jdbc.queryForObject("""
                select exists (
                    select 1
                    from employee_position_assignment assignment
                    join employee employee_row
                      on employee_row.tenant_id = assignment.tenant_id
                     and employee_row.id = assignment.employee_id
                    join position_definition position
                      on position.tenant_id = assignment.tenant_id
                     and position.id = assignment.position_id
                    join org_unit assignment_org
                      on assignment_org.tenant_id = assignment.tenant_id
                     and assignment_org.id = assignment.org_unit_id
                    join org_unit_closure scope
                      on scope.tenant_id = assignment.tenant_id
                     and scope.ancestor_id = :hotelOrgUnitId
                     and scope.descendant_id = assignment.org_unit_id
                    where assignment.tenant_id = :tenantId
                      and assignment.id = :assignmentId
                      and assignment.status = 'ACTIVE'
                      and employee_row.employment_status = 'ACTIVE'
                      and position.status = 'ACTIVE'
                      and assignment_org.status = 'ACTIVE'
                      and assignment.valid_from <= :businessDate
                      and (assignment.valid_to is null or assignment.valid_to >= :businessDate)
                )
                """, base(principal)
                .addValue("hotelOrgUnitId", hotelOrgUnitId)
                .addValue("assignmentId", reviewerAssignmentId)
                .addValue("businessDate", businessDate), Boolean.class);
        if (!Boolean.TRUE.equals(reviewerValid)) {
            throw new IllegalArgumentException("任务验收任职必须与候选任务同酒店且于业务日有效");
        }
    }

    private CandidateContext resolveContext(TenantPrincipal principal, OperationModels.CreateTaskCandidate request) {
        if (request.issueId() != null) {
            Map<String, Object> issue = jdbc.queryForMap("""
                    select id, hotel_org_unit_id, org_unit_id, business_date,
                           owner_assignment_id, acceptance_assignment_id
                    from issue_event
                    where tenant_id = :tenantId and id = :issueId
                      and (:tenantScope or org_unit_id in (:orgScopes))
                    """, scoped(principal).addValue("issueId", request.issueId()));
            UUID assignee = request.assigneeAssignmentId() == null
                    ? (UUID) issue.get("owner_assignment_id") : request.assigneeAssignmentId();
            UUID reviewer = request.reviewerAssignmentId() == null
                    ? (UUID) issue.get("acceptance_assignment_id") : request.reviewerAssignmentId();
            return new CandidateContext(
                    (UUID) issue.get("hotel_org_unit_id"), (UUID) issue.get("org_unit_id"),
                    asLocalDate(issue.get("business_date")), assignee, reviewer);
        }
        if (request.orgUnitId() == null) throw new IllegalArgumentException("orgUnitId不能为空");
        accessPolicy.requireOrgScope(request.orgUnitId());
        BusinessDayService.BusinessDayContext day = businessDayService.resolve(
                request.orgUnitId(), request.businessDate());
        return new CandidateContext(day.hotelOrgUnitId(), request.orgUnitId(), day.businessDate(),
                request.assigneeAssignmentId(), request.reviewerAssignmentId());
    }

    private void requireIndependentConfirmation(
            TenantPrincipal principal,
            Map<String, Object> candidate,
            UUID actorAssignmentId
    ) {
        if (candidate.get("issue_id") == null) return;
        List<Map<String, Object>> issues = jdbc.queryForList("""
                select severity, created_by_assignment_id, owner_assignment_id
                from issue_event where tenant_id = :tenantId and id = :issueId
                """, base(principal).addValue("issueId", candidate.get("issue_id")));
        if (issues.isEmpty()) return;
        Map<String, Object> issue = issues.getFirst();
        if (Set.of("IMPORTANT", "MAJOR").contains(String.valueOf(issue.get("severity")))
                && (actorAssignmentId.equals(issue.get("created_by_assignment_id"))
                || actorAssignmentId.equals(issue.get("owner_assignment_id")))) {
            throw new AccessDeniedException("重要或重大事项不得由创建人或责任人自行确认任务候选");
        }
    }

    private UUID ensureSyncOperation(TenantPrincipal principal, UUID candidateId, String idempotencyKey) {
        UUID syncId = UUID.randomUUID();
        jdbc.update("""
                insert into sync_operation
                    (id, tenant_id, aggregate_type, aggregate_id, operation_type,
                     idempotency_key, status, available_at, trace_id)
                values (:id, :tenantId, 'TASK_CANDIDATE', :candidateId, 'CREATE_FORMAL_TASK',
                        :idempotencyKey, 'PENDING', now(), :traceId)
                on conflict (tenant_id, idempotency_key) do nothing
                """, base(principal).addValue("id", syncId).addValue("candidateId", candidateId)
                .addValue("idempotencyKey", "task-candidate:" + candidateId)
                .addValue("traceId", principal.correlationId()));
        return jdbc.queryForObject("""
                select id from sync_operation
                where tenant_id = :tenantId and aggregate_type = 'TASK_CANDIDATE'
                  and aggregate_id = :candidateId and operation_type = 'CREATE_FORMAL_TASK'
                """, base(principal).addValue("candidateId", candidateId), UUID.class);
    }

    private void markSyncSucceeded(TenantPrincipal principal, UUID candidateId, UUID taskId, JsonNode snapshot) {
        jdbc.update("""
                update sync_operation
                set status = 'SUCCEEDED', target_id = :taskId,
                    target_snapshot = coalesce(cast(:targetSnapshot as jsonb), target_snapshot),
                    locked_by = null, locked_until = null, next_retry_at = null, last_error = null,
                    completed_at = now(),
                    row_version = row_version + 1, updated_at = now()
                where tenant_id = :tenantId and aggregate_type = 'TASK_CANDIDATE'
                  and aggregate_id = :candidateId
                """, base(principal).addValue("candidateId", candidateId).addValue("taskId", taskId)
                .addValue("targetSnapshot", snapshot == null ? null : snapshot.toString()));
    }

    private Map<String, Object> detailResult(TenantPrincipal principal, UUID candidateId, boolean forUpdate) {
        Map<String, Object> result = new LinkedHashMap<>(candidateRow(principal, candidateId, forUpdate));
        List<Map<String, Object>> sync = jdbc.queryForList("""
                select id, operation_type, status, attempt_count, available_at, next_retry_at,
                       last_error, target_id, target_snapshot, row_version, created_at, updated_at
                from sync_operation
                where tenant_id = :tenantId and aggregate_type = 'TASK_CANDIDATE'
                  and aggregate_id = :candidateId
                order by created_at desc, id desc
                """, base(principal).addValue("candidateId", candidateId));
        result.put("syncOperations", sync);
        result.put("syncStatus", sync.isEmpty() ? "NOT_STARTED" : sync.getFirst().get("status"));
        return result;
    }

    private Map<String, Object> candidateRow(TenantPrincipal principal, UUID candidateId, boolean forUpdate) {
        try {
            return jdbc.queryForMap("""
                    select c.* from task_candidate c
                    where c.tenant_id = :tenantId and c.id = :candidateId
                      and (:tenantScope or c.org_unit_id in (:orgScopes))
                    """ + (forUpdate ? " for update" : ""),
                    scoped(principal).addValue("candidateId", candidateId));
        } catch (EmptyResultDataAccessException exception) {
            throw exception;
        }
    }

    private UUID resolveActorAssignment(TenantPrincipal principal, UUID requested) {
        UUID assignmentId = requested;
        if (assignmentId == null && principal.assignmentIds().size() == 1) {
            assignmentId = principal.assignmentIds().iterator().next();
        }
        if (assignmentId == null) throw new IllegalArgumentException("actorAssignmentId不能为空，请先选择当前岗位");
        if (!principal.hasTenantScope()) accessPolicy.requireActiveAssignment(assignmentId);
        return assignmentId;
    }

    private void requireVersion(Map<String, Object> row, long expectedVersion) {
        long actual = ((Number) row.get("row_version")).longValue();
        if (actual != expectedVersion) throw new ResponseStatusException(HttpStatus.CONFLICT,
                "TASK_CANDIDATE_VERSION_CONFLICT expected=" + expectedVersion + " actual=" + actual);
    }

    private TenantPrincipal prepare() {
        TenantPrincipal principal = accessPolicy.principal();
        databaseContext.apply(principal.tenantId());
        return principal;
    }

    private MapSqlParameterSource base(TenantPrincipal principal) {
        return new MapSqlParameterSource("tenantId", principal.tenantId());
    }

    private MapSqlParameterSource scoped(TenantPrincipal principal) {
        return base(principal).addValue("tenantScope", principal.hasTenantScope())
                .addValue("orgScopes", principal.orgScopes().isEmpty() ? List.of(EMPTY_SCOPE) : principal.orgScopes());
    }

    private String requiredKey(String key) {
        if (key == null || key.isBlank()) throw new IllegalArgumentException("Idempotency-Key不能为空");
        if (key.length() > 200) throw new IllegalArgumentException("Idempotency-Key长度不能超过200字符");
        return key.trim();
    }

    private LocalDate asLocalDate(Object value) {
        if (value instanceof LocalDate localDate) return localDate;
        if (value instanceof java.sql.Date sqlDate) return sqlDate.toLocalDate();
        return LocalDate.parse(String.valueOf(value));
    }

    private OffsetDateTime asOffsetDateTime(Object value) {
        if (value == null) return null;
        if (value instanceof OffsetDateTime offsetDateTime) return offsetDateTime;
        if (value instanceof java.sql.Timestamp timestamp) {
            return timestamp.toInstant().atOffset(java.time.ZoneOffset.UTC);
        }
        return OffsetDateTime.parse(String.valueOf(value));
    }

    private String normalizeNullable(String value) {
        return value == null || value.isBlank() ? null : value.trim().toUpperCase(Locale.ROOT);
    }

    private String normalizePriority(String value) {
        String priority = value == null || value.isBlank() ? "NORMAL" : value.trim().toUpperCase(Locale.ROOT);
        if (!Set.of("LOW", "NORMAL", "HIGH", "URGENT").contains(priority)) {
            throw new IllegalArgumentException("不支持的任务优先级: " + value);
        }
        return priority;
    }

    private String normalizedAcceptanceCriteria(String value) {
        return value == null || value.isBlank()
                ? "完成任务并由指定验收人验收"
                : value.trim();
    }

    private ObjectNode asObjectNode(Object value) {
        if (value instanceof ObjectNode objectNode) {
            return objectNode.deepCopy();
        }
        if (value instanceof JsonNode node && node.isObject()) {
            return (ObjectNode) node.deepCopy();
        }
        if (value != null) {
            try {
                JsonNode parsed = objectMapper.readTree(String.valueOf(value));
                if (parsed != null && parsed.isObject()) {
                    return (ObjectNode) parsed;
                }
            } catch (Exception ignored) {
                // A malformed optional source snapshot must not block formal task creation.
            }
        }
        return objectMapper.createObjectNode();
    }

    private String json(Object value) {
        try {
            return objectMapper.writeValueAsString(value);
        } catch (Exception exception) {
            throw new IllegalArgumentException("无法序列化业务数据", exception);
        }
    }

    public record CandidateSyncRequested(UUID candidateId, UUID correlationId) {
    }

    public record RuleCandidateSpec(
            UUID sourceEventId,
            UUID sourceRuleActionId,
            UUID issueId,
            UUID orgUnitId,
            LocalDate businessDate,
            UUID assigneeAssignmentId,
            UUID reviewerAssignmentId,
            UUID standardVersionId,
            String title,
            String description,
            String priority,
            OffsetDateTime dueAt,
            String acceptanceCriteria,
            UUID createdByAssignmentId,
            JsonNode sourceSnapshot
    ) {
    }

    private record CandidateContext(
            UUID hotelOrgUnitId,
            UUID orgUnitId,
            LocalDate businessDate,
            UUID assigneeAssignmentId,
            UUID reviewerAssignmentId
    ) {
    }

    private record CandidateDraft(
            UUID issueId,
            UUID hotelOrgUnitId,
            UUID orgUnitId,
            LocalDate businessDate,
            String title,
            String description,
            String priority,
            UUID assigneeAssignmentId,
            UUID reviewerAssignmentId,
            UUID standardVersionId,
            OffsetDateTime dueAt,
            String acceptanceCriteria,
            UUID createdByAssignmentId,
            JsonNode sourceSnapshot,
            UUID traceId,
            String idempotencyKey,
            UUID sourceEventId,
            UUID sourceRuleActionId
    ) {
        CandidateDraft(
                UUID issueId, UUID hotelOrgUnitId, UUID orgUnitId, LocalDate businessDate,
                String title, String description, String priority,
                UUID assigneeAssignmentId, UUID reviewerAssignmentId, UUID standardVersionId,
                OffsetDateTime dueAt, String acceptanceCriteria, UUID createdByAssignmentId,
                JsonNode sourceSnapshot, UUID traceId, String idempotencyKey
        ) {
            this(issueId, hotelOrgUnitId, orgUnitId, businessDate, title, description, priority,
                    assigneeAssignmentId, reviewerAssignmentId, standardVersionId, dueAt,
                    acceptanceCriteria, createdByAssignmentId, sourceSnapshot, traceId,
                    idempotencyKey, null, null);
        }
    }
}
