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
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.springframework.dao.EmptyResultDataAccessException;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Service;
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
public class IssueService {
    private static final UUID EMPTY_SCOPE = new UUID(0, 0);
    private static final Set<String> SEVERITIES = Set.of("GENERAL", "IMPORTANT", "MAJOR");
    private static final Set<String> SOURCE_TYPES = Set.of(
            "DAILY_REPORT", "WORK_RECORD", "INSPECTION", "QUALITY_REPORT", "TASK",
            "METRIC", "RULE", "MANUAL", "OTHER");

    private final NamedParameterJdbcTemplate jdbc;
    private final TenantDatabaseContext databaseContext;
    private final AccessPolicy accessPolicy;
    private final BusinessDayService businessDayService;
    private final CommandIdempotencyService idempotencyService;
    private final AuditWriter auditWriter;
    private final BusinessEventPublisher eventPublisher;
    private final ObjectMapper objectMapper;

    public IssueService(
            NamedParameterJdbcTemplate jdbc,
            TenantDatabaseContext databaseContext,
            AccessPolicy accessPolicy,
            BusinessDayService businessDayService,
            CommandIdempotencyService idempotencyService,
            AuditWriter auditWriter,
            BusinessEventPublisher eventPublisher,
            ObjectMapper objectMapper
    ) {
        this.jdbc = jdbc;
        this.databaseContext = databaseContext;
        this.accessPolicy = accessPolicy;
        this.businessDayService = businessDayService;
        this.idempotencyService = idempotencyService;
        this.auditWriter = auditWriter;
        this.eventPublisher = eventPublisher;
        this.objectMapper = objectMapper;
    }

    @Transactional(readOnly = true)
    public List<Map<String, Object>> list(UUID orgUnitId, LocalDate businessDate, String status, String severity) {
        accessPolicy.requirePermission("daily-operation.read");
        TenantPrincipal principal = prepare();
        if (orgUnitId != null) accessPolicy.requireOrgScope(orgUnitId);
        return jdbc.queryForList("""
                select i.id, i.issue_no, i.hotel_org_unit_id, i.org_unit_id, i.business_date,
                       i.title, i.description, i.severity, i.severity_reason, i.lifecycle_status,
                       i.owner_assignment_id, i.acceptance_assignment_id, i.first_occurred_at,
                       i.last_occurred_at, i.due_at, i.closed_at, i.row_version, i.updated_at,
                       count(distinct source.id) as source_count,
                       count(distinct task.management_task_id) as task_count
                from issue_event i
                left join issue_source_link source
                  on source.tenant_id = i.tenant_id and source.issue_id = i.id
                 and source.invalidated_at is null
                left join issue_task_link task
                  on task.tenant_id = i.tenant_id and task.issue_id = i.id
                where i.tenant_id = :tenantId
                  and (:tenantScope or i.org_unit_id in (:orgScopes))
                  and (cast(:orgUnitId as uuid) is null or exists (
                    select 1 from org_unit_closure c
                    where c.tenant_id = i.tenant_id and c.ancestor_id = :orgUnitId
                      and c.descendant_id = i.org_unit_id
                  ))
                  and (cast(:businessDate as date) is null or i.business_date = :businessDate)
                  and (cast(:status as varchar) is null or i.lifecycle_status = :status)
                  and (cast(:severity as varchar) is null or i.severity = :severity)
                group by i.id
                order by case i.severity when 'MAJOR' then 1 when 'IMPORTANT' then 2 else 3 end,
                         i.due_at nulls last, i.last_occurred_at desc, i.id
                """, scoped(principal)
                .addValue("orgUnitId", orgUnitId)
                .addValue("businessDate", businessDate)
                .addValue("status", normalizeNullable(status))
                .addValue("severity", normalizeNullable(severity)));
    }

    @Transactional(readOnly = true)
    public Map<String, Object> detail(UUID issueId) {
        accessPolicy.requirePermission("daily-operation.read");
        TenantPrincipal principal = prepare();
        return detailResult(principal, issueId, false);
    }

    @Transactional
    public Map<String, Object> create(OperationModels.CreateIssue request, String idempotencyKey) {
        accessPolicy.requirePermission("issue.confirm");
        TenantPrincipal principal = prepare();
        accessPolicy.requireOrgScope(request.orgUnitId());
        requireActorAssignment(principal, request.createdByAssignmentId());
        BusinessDayService.BusinessDayContext day = businessDayService.resolve(
                request.orgUnitId(), request.businessDate());
        if (request.ownerAssignmentId() != null) {
            requireAssignmentInHotel(principal, request.ownerAssignmentId(), day.hotelOrgUnitId());
        }
        if (request.verifierAssignmentId() != null) {
            requireAssignmentInHotel(principal, request.verifierAssignmentId(), day.hotelOrgUnitId());
        }
        if ((request.sourceType() == null) != (request.sourceId() == null)) {
            throw new IllegalArgumentException("sourceType 与 sourceId 必须同时提供");
        }
        CommandIdempotencyService.Reservation reservation = idempotencyService.reserve(
                "ISSUE_CREATE", requiredKey(idempotencyKey), request, principal.correlationId());
        if (reservation.replayed()) return detailResult(principal, reservation.resourceId(), false);

        UUID issueId = UUID.randomUUID();
        UUID traceId = principal.correlationId();
        String issueNo = "I-" + OffsetDateTime.now(ZoneOffset.UTC)
                .format(DateTimeFormatter.ofPattern("yyyyMMdd")) + "-"
                + issueId.toString().substring(0, 8).toUpperCase(Locale.ROOT);
        String severity = normalizeSeverity(request.severity());
        jdbc.update("""
                insert into issue_event
                    (id, tenant_id, issue_no, hotel_org_unit_id, org_unit_id, business_date,
                     title, description, severity, lifecycle_status, owner_assignment_id,
                     acceptance_assignment_id, first_occurred_at, last_occurred_at, due_at,
                     created_by_account_id, created_by_assignment_id, trace_id)
                values
                    (:id, :tenantId, :issueNo, :hotelOrgUnitId, :orgUnitId, :businessDate,
                     :title, :description, :severity, 'CANDIDATE', :ownerAssignmentId,
                     :acceptanceAssignmentId, now(), now(), :dueAt,
                     :actorId, :createdByAssignmentId, :traceId)
                """, base(principal)
                .addValue("id", issueId)
                .addValue("issueNo", issueNo)
                .addValue("hotelOrgUnitId", day.hotelOrgUnitId())
                .addValue("orgUnitId", request.orgUnitId())
                .addValue("businessDate", day.businessDate())
                .addValue("title", request.title().trim())
                .addValue("description", request.description())
                .addValue("severity", severity)
                .addValue("ownerAssignmentId", request.ownerAssignmentId())
                .addValue("acceptanceAssignmentId", request.verifierAssignmentId())
                .addValue("dueAt", request.dueAt())
                .addValue("actorId", principal.actorId())
                .addValue("createdByAssignmentId", request.createdByAssignmentId())
                .addValue("traceId", traceId));
        insertTransition(principal, issueId, null, "CANDIDATE", "CREATE_CANDIDATE",
                request.createdByAssignmentId(), idempotencyKey, null, objectMapper.createObjectNode());
        if (request.sourceType() != null && request.sourceId() != null) {
            addSourceInternal(principal, issueId, new OperationModels.AddIssueSource(
                    request.sourceType(), request.sourceId(), "ORIGIN", request.sourceSnapshot()));
        }
        auditWriter.record("ISSUE_CANDIDATE_CREATED", "ISSUE_EVENT", issueId,
                json(Map.of("issueNo", issueNo, "severity", severity)));
        Map<String, Object> result = detailResult(principal, issueId, false);
        idempotencyService.succeed(reservation, "ISSUE_EVENT", issueId, 201, result);
        return result;
    }

    @Transactional
    public Map<String, Object> addSource(UUID issueId, OperationModels.AddIssueSource request) {
        accessPolicy.requireAnyPermission("issue.confirm", "issue.assign");
        TenantPrincipal principal = prepare();
        detailResult(principal, issueId, true);
        addSourceInternal(principal, issueId, request);
        auditWriter.record("ISSUE_SOURCE_LINKED", "ISSUE_EVENT", issueId,
                json(Map.of("sourceType", request.sourceType(), "sourceId", request.sourceId())));
        return detailResult(principal, issueId, false);
    }

    @Transactional
    public Map<String, Object> command(
            UUID issueId,
            String command,
            String idempotencyKey,
            OperationModels.IssueCommand request
    ) {
        String action = normalizeCommand(command);
        requireCommandPermission(action);
        TenantPrincipal principal = prepare();
        requireActorAssignment(principal, request.actorAssignmentId());
        List<UUID> replay = jdbc.queryForList("""
                select issue_id from issue_transition
                where tenant_id = :tenantId and issue_id = :issueId and idempotency_key = :key
                """, base(principal).addValue("issueId", issueId)
                .addValue("key", requiredKey(idempotencyKey)), UUID.class);
        if (!replay.isEmpty()) return detailResult(principal, issueId, false);

        Map<String, Object> issue = issueRow(principal, issueId, true);
        long currentVersion = ((Number) issue.get("row_version")).longValue();
        if (currentVersion != request.expectedVersion()) {
            throw new ResponseStatusException(HttpStatus.CONFLICT,
                    "ISSUE_VERSION_CONFLICT expected=" + request.expectedVersion() + " actual=" + currentVersion);
        }
        String fromStatus = String.valueOf(issue.get("lifecycle_status"));
        String toStatus = transition(action, fromStatus);
        UUID owner = request.ownerAssignmentId();
        UUID verifier = request.verifierAssignmentId();
        String severity = request.severity() == null ? null : normalizeSeverity(request.severity());
        if ("ASSIGN".equals(action) && owner == null) {
            throw new IllegalArgumentException("ownerAssignmentId不能为空");
        }
        if (owner != null) requireAssignmentInHotel(principal, owner, (UUID) issue.get("hotel_org_unit_id"));
        if (verifier != null) requireAssignmentInHotel(principal, verifier, (UUID) issue.get("hotel_org_unit_id"));
        if ("CLOSE".equals(action)) {
            requireIndependentClosure(issue, request.actorAssignmentId());
            requireLinkedTasksCompleted(principal, issueId);
            UUID expectedVerifier = (UUID) issue.get("acceptance_assignment_id");
            if (expectedVerifier != null && !expectedVerifier.equals(request.actorAssignmentId())) {
                throw new AccessDeniedException("该异常必须由指定验收人关闭");
            }
            if (request.reason() == null || request.reason().isBlank()) {
                throw new IllegalArgumentException("关闭异常必须填写验收意见");
            }
        }
        if (Set.of("REOPEN", "CHANGE_SEVERITY").contains(action)
                && (request.reason() == null || request.reason().isBlank())) {
            throw new IllegalArgumentException(action + "必须填写原因");
        }
        int updated = jdbc.update("""
                update issue_event
                set lifecycle_status = :toStatus,
                    owner_assignment_id = coalesce(:ownerAssignmentId, owner_assignment_id),
                    acceptance_assignment_id = coalesce(:acceptanceAssignmentId, acceptance_assignment_id),
                    severity = coalesce(cast(:severity as varchar), severity),
                    severity_reason = case
                        when cast(:severity as varchar) is null then severity_reason
                        else cast(:reason as text) end,
                    confirmed_by_assignment_id = case when :action = 'CONFIRM' then :actorAssignmentId else confirmed_by_assignment_id end,
                    confirmed_by_account_id = case when :action = 'CONFIRM' then :actorId else confirmed_by_account_id end,
                    confirmed_at = case when :action = 'CONFIRM' then now() else confirmed_at end,
                    closed_by_assignment_id = case
                        when :action = 'CLOSE' then :actorAssignmentId
                        when :action = 'REOPEN' then null
                        else closed_by_assignment_id end,
                    closed_by_account_id = case
                        when :action = 'CLOSE' then :actorId
                        when :action = 'REOPEN' then null
                        else closed_by_account_id end,
                    closed_at = case when :action = 'CLOSE' then now() when :action = 'REOPEN' then null else closed_at end,
                    closure_reason = case when :action = 'CLOSE' then :reason when :action = 'REOPEN' then null else closure_reason end,
                    row_version = row_version + 1,
                    updated_at = now()
                where tenant_id = :tenantId and id = :issueId and row_version = :expectedVersion
                """, base(principal)
                .addValue("issueId", issueId)
                .addValue("toStatus", toStatus)
                .addValue("ownerAssignmentId", owner)
                .addValue("acceptanceAssignmentId", verifier)
                .addValue("severity", severity)
                .addValue("reason", request.reason())
                .addValue("action", action)
                .addValue("actorId", principal.actorId())
                .addValue("actorAssignmentId", request.actorAssignmentId())
                .addValue("expectedVersion", request.expectedVersion()));
        if (updated != 1) throw new ResponseStatusException(HttpStatus.CONFLICT, "ISSUE_VERSION_CONFLICT");
        ObjectNode payload = objectMapper.createObjectNode();
        if (owner != null) payload.put("ownerAssignmentId", owner.toString());
        if (verifier != null) payload.put("acceptanceAssignmentId", verifier.toString());
        if (severity != null) payload.put("severity", severity);
        insertTransition(principal, issueId, fromStatus, toStatus, action,
                request.actorAssignmentId(), idempotencyKey, request.reason(), payload);

        String eventType = switch (action) {
            case "CONFIRM" -> "ISSUE_EVENT_CONFIRMED";
            case "CHANGE_SEVERITY" -> "ISSUE_SEVERITY_CHANGED";
            case "REQUEST_CLOSE" -> "ISSUE_EVENT_READY_TO_CLOSE";
            case "CLOSE" -> "ISSUE_EVENT_CLOSED";
            case "REOPEN" -> "ISSUE_EVENT_REOPENED";
            default -> null;
        };
        if (eventType != null) {
            ObjectNode eventPayload = payload.deepCopy();
            eventPayload.put("issueId", issueId.toString());
            eventPayload.put("fromStatus", fromStatus);
            eventPayload.put("toStatus", toStatus);
            eventPublisher.publish(new BusinessEvent(
                    "ISSUE_EVENT", issueId, eventType, 1, "daily-operations",
                    (UUID) issue.get("org_unit_id"), (UUID) issue.get("hotel_org_unit_id"),
                    request.actorAssignmentId(), request.actorAssignmentId(),
                    asLocalDate(issue.get("business_date")), (UUID) issue.get("trace_id"), null,
                    idempotencyKey, "INTERNAL", eventPayload));
        }
        auditWriter.record("ISSUE_" + action, "ISSUE_EVENT", issueId,
                json(Map.of("fromStatus", fromStatus, "toStatus", toStatus)));
        return detailResult(principal, issueId, false);
    }

    private void addSourceInternal(TenantPrincipal principal, UUID issueId, OperationModels.AddIssueSource request) {
        JsonNode snapshot = request.sourceSnapshot() == null ? objectMapper.createObjectNode() : request.sourceSnapshot();
        String sourceType = request.sourceType().trim().toUpperCase(Locale.ROOT);
        if (!SOURCE_TYPES.contains(sourceType)) throw new IllegalArgumentException("不支持的异常来源类型: " + sourceType);
        jdbc.update("""
                insert into issue_source_link
                    (tenant_id, issue_id, source_type, source_id,
                     source_snapshot, content_hash, linked_by_account_id)
                values (:tenantId, :issueId, :sourceType, :sourceId,
                        cast(:sourceSnapshot as jsonb), :contentHash, :actorId)
                on conflict do nothing
                """, base(principal)
                .addValue("issueId", issueId)
                .addValue("sourceType", sourceType)
                .addValue("sourceId", request.sourceId())
                .addValue("sourceSnapshot", snapshot.toString())
                .addValue("contentHash", sha256(snapshot.toString()))
                .addValue("actorId", principal.actorId()));
    }

    private Map<String, Object> detailResult(TenantPrincipal principal, UUID issueId, boolean forUpdate) {
        Map<String, Object> result = new LinkedHashMap<>(issueRow(principal, issueId, forUpdate));
        result.put("sources", jdbc.queryForList("""
                select id, source_type, source_id, source_external_key, source_version, source_status,
                       source_snapshot, content_hash, source_occurred_at, linked_at,
                       invalidated_at, invalidation_reason
                from issue_source_link
                where tenant_id = :tenantId and issue_id = :issueId
                order by linked_at, id
                """, base(principal).addValue("issueId", issueId)));
        result.put("timeline", jdbc.queryForList("""
                select id, from_status, to_status, command, actor_account_id, actor_assignment_id,
                       reason, payload, occurred_at
                from issue_transition
                where tenant_id = :tenantId and issue_id = :issueId
                order by occurred_at, id
                """, base(principal).addValue("issueId", issueId)));
        result.put("tasks", jdbc.queryForList("""
                select id, task_candidate_id, management_task_id, management_task_no as task_no,
                       link_type, link_status, task_snapshot, linked_at
                from issue_task_link
                where tenant_id = :tenantId and issue_id = :issueId
                order by linked_at, id
                """, base(principal).addValue("issueId", issueId)));
        result.put("taskCandidates", jdbc.queryForList("""
                select id, candidate_no, title, priority, status, due_at, formal_task_id,
                       formal_task_no, row_version, updated_at
                from task_candidate
                where tenant_id = :tenantId and issue_id = :issueId
                order by created_at, id
                """, base(principal).addValue("issueId", issueId)));
        return result;
    }

    private Map<String, Object> issueRow(TenantPrincipal principal, UUID issueId, boolean forUpdate) {
        try {
            return jdbc.queryForMap("""
                    select i.*
                    from issue_event i
                    where i.tenant_id = :tenantId and i.id = :issueId
                      and (:tenantScope or i.org_unit_id in (:orgScopes))
                    """ + (forUpdate ? " for update" : ""), scoped(principal).addValue("issueId", issueId));
        } catch (EmptyResultDataAccessException exception) {
            throw exception;
        }
    }

    private void insertTransition(
            TenantPrincipal principal,
            UUID issueId,
            String fromStatus,
            String toStatus,
            String command,
            UUID actorAssignmentId,
            String idempotencyKey,
            String reason,
            JsonNode payload
    ) {
        jdbc.update("""
                insert into issue_transition
                    (tenant_id, issue_id, from_status, to_status, command,
                     actor_account_id, actor_assignment_id, reason, payload, idempotency_key)
                values (:tenantId, :issueId, :fromStatus, :toStatus, :command,
                        :actorId, :actorAssignmentId, :reason, cast(:payload as jsonb), :key)
                """, base(principal)
                .addValue("issueId", issueId)
                .addValue("fromStatus", fromStatus)
                .addValue("toStatus", toStatus)
                .addValue("command", command)
                .addValue("actorId", principal.actorId())
                .addValue("actorAssignmentId", actorAssignmentId)
                .addValue("reason", reason)
                .addValue("payload", payload == null ? "{}" : payload.toString())
                .addValue("key", requiredKey(idempotencyKey)));
    }

    private void requireCommandPermission(String action) {
        switch (action) {
            case "CONFIRM" -> accessPolicy.requirePermission("issue.confirm");
            case "ASSIGN", "CHANGE_SEVERITY", "START", "REQUEST_CLOSE" -> accessPolicy.requirePermission("issue.assign");
            case "CLOSE" -> accessPolicy.requirePermission("issue.close");
            case "REOPEN" -> accessPolicy.requirePermission("issue.reopen");
            default -> throw new IllegalArgumentException("不支持的异常命令: " + action);
        }
    }

    private String transition(String action, String from) {
        if ("ASSIGN".equals(action) || "CHANGE_SEVERITY".equals(action)) {
            if ("CLOSED".equals(from)) {
                throw new ResponseStatusException(HttpStatus.CONFLICT,
                        "ISSUE_CLOSED_REQUIRES_REOPEN");
            }
            return from;
        }
        String to = switch (action + ":" + from) {
            case "CONFIRM:CANDIDATE" -> "CONFIRMED";
            case "START:CONFIRMED" -> "IN_PROGRESS";
            case "REQUEST_CLOSE:IN_PROGRESS" -> "PENDING_CLOSE";
            case "CLOSE:PENDING_CLOSE" -> "CLOSED";
            case "REOPEN:CLOSED" -> "IN_PROGRESS";
            default -> null;
        };
        if (to == null) throw new ResponseStatusException(HttpStatus.CONFLICT,
                "ISSUE_INVALID_TRANSITION " + from + " -> " + action);
        return to;
    }

    private void requireIndependentClosure(Map<String, Object> issue, UUID actorAssignmentId) {
        String severity = String.valueOf(issue.get("severity"));
        if (!Set.of("IMPORTANT", "MAJOR").contains(severity)) return;
        if (actorAssignmentId.equals(issue.get("owner_assignment_id"))
                || actorAssignmentId.equals(issue.get("created_by_assignment_id"))) {
            throw new AccessDeniedException("重要或重大异常不得由创建人或责任人自行验收关闭");
        }
    }

    private void requireLinkedTasksCompleted(TenantPrincipal principal, UUID issueId) {
        Integer incomplete = jdbc.queryForObject("""
                select count(*)
                from issue_task_link link
                join management_task task
                  on task.tenant_id = link.tenant_id and task.id = link.management_task_id
                where link.tenant_id = :tenantId and link.issue_id = :issueId
                  and link.link_status = 'ACTIVE' and task.lifecycle_status <> 'COMPLETED'
                """, base(principal).addValue("issueId", issueId), Integer.class);
        if (incomplete != null && incomplete > 0) {
            throw new ResponseStatusException(HttpStatus.CONFLICT,
                    "ISSUE_LINKED_TASKS_NOT_COMPLETED");
        }
    }

    private void requireActorAssignment(TenantPrincipal principal, UUID assignmentId) {
        if (assignmentId == null) throw new IllegalArgumentException("actorAssignmentId不能为空");
        if (!principal.hasTenantScope()) accessPolicy.requireActiveAssignment(assignmentId);
        Integer count = jdbc.queryForObject("""
                select count(*) from employee_position_assignment
                where tenant_id = :tenantId and id = :assignmentId and status = 'ACTIVE'
                  and valid_from <= current_date and (valid_to is null or valid_to >= current_date)
                """, base(principal).addValue("assignmentId", assignmentId), Integer.class);
        if (count == null || count != 1) throw new AccessDeniedException("任职不存在或已失效");
    }

    private void requireAssignmentInHotel(TenantPrincipal principal, UUID assignmentId, UUID hotelOrgUnitId) {
        Integer count = jdbc.queryForObject("""
                select count(*)
                from employee_position_assignment assignment
                join org_unit_closure scope
                  on scope.tenant_id = assignment.tenant_id
                 and scope.ancestor_id = :hotelOrgUnitId
                 and scope.descendant_id = assignment.org_unit_id
                where assignment.tenant_id = :tenantId and assignment.id = :assignmentId
                  and assignment.status = 'ACTIVE' and assignment.valid_from <= current_date
                  and (assignment.valid_to is null or assignment.valid_to >= current_date)
                """, base(principal).addValue("assignmentId", assignmentId)
                .addValue("hotelOrgUnitId", hotelOrgUnitId), Integer.class);
        if (count == null || count != 1) throw new IllegalArgumentException("任职不属于异常所在门店或已失效");
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
        return base(principal)
                .addValue("tenantScope", principal.hasTenantScope())
                .addValue("orgScopes", principal.orgScopes().isEmpty() ? List.of(EMPTY_SCOPE) : principal.orgScopes());
    }

    private String normalizeSeverity(String value) {
        String normalized = normalizeDefault(value, "GENERAL");
        if (!SEVERITIES.contains(normalized)) throw new IllegalArgumentException("不支持的异常级别: " + value);
        return normalized;
    }

    private String normalizeCommand(String value) {
        String command = normalizeDefault(value, "").replace('-', '_');
        return "PENDING_CLOSE".equals(command) || "READY_TO_CLOSE".equals(command) ? "REQUEST_CLOSE" : command;
    }

    private String normalizeNullable(String value) {
        return value == null || value.isBlank() ? null : value.trim().toUpperCase(Locale.ROOT);
    }

    private String normalizeDefault(String value, String fallback) {
        return value == null || value.isBlank() ? fallback : value.trim().toUpperCase(Locale.ROOT);
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

    private String json(Object value) {
        try {
            return objectMapper.writeValueAsString(value);
        } catch (Exception exception) {
            throw new IllegalArgumentException("无法序列化业务数据", exception);
        }
    }

    private String sha256(String value) {
        try {
            byte[] digest = java.security.MessageDigest.getInstance("SHA-256")
                    .digest(value.getBytes(java.nio.charset.StandardCharsets.UTF_8));
            return java.util.HexFormat.of().formatHex(digest);
        } catch (Exception exception) {
            throw new IllegalStateException("SHA-256不可用", exception);
        }
    }
}
