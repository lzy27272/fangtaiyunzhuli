package cn.sifangguan.hotelaios.rules;

import cn.sifangguan.hotelaios.notifications.NotificationService;
import cn.sifangguan.hotelaios.shared.audit.AuditWriter;
import cn.sifangguan.hotelaios.shared.context.TenantPrincipal;
import cn.sifangguan.hotelaios.shared.db.TenantDatabaseContext;
import cn.sifangguan.hotelaios.shared.events.EventTypeNames;
import cn.sifangguan.hotelaios.shared.security.AccessDeniedException;
import cn.sifangguan.hotelaios.shared.security.AccessPolicy;
import cn.sifangguan.hotelaios.tasks.TaskModels;
import cn.sifangguan.hotelaios.tasks.TaskService;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.OffsetDateTime;
import java.util.*;

@Service
public class RuleService {
    private final NamedParameterJdbcTemplate jdbc;
    private final TenantDatabaseContext databaseContext;
    private final AccessPolicy accessPolicy;
    private final AuditWriter auditWriter;
    private final RuleConditionEvaluator evaluator;
    private final ObjectMapper objectMapper;
    private final TaskService taskService;
    private final NotificationService notificationService;

    public RuleService(
            NamedParameterJdbcTemplate jdbc,
            TenantDatabaseContext databaseContext,
            AccessPolicy accessPolicy,
            AuditWriter auditWriter,
            RuleConditionEvaluator evaluator,
            ObjectMapper objectMapper,
            TaskService taskService,
            NotificationService notificationService
    ) {
        this.jdbc = jdbc;
        this.databaseContext = databaseContext;
        this.accessPolicy = accessPolicy;
        this.auditWriter = auditWriter;
        this.evaluator = evaluator;
        this.objectMapper = objectMapper;
        this.taskService = taskService;
        this.notificationService = notificationService;
    }

    @Transactional(readOnly = true)
    public List<Map<String, Object>> list() {
        accessPolicy.requirePermission("rule.read");
        TenantPrincipal principal = prepare();
        return jdbc.queryForList("""
                select d.id, d.code, d.name, d.event_type, d.owner_org_unit_id, d.description, d.status,
                       v.id as latest_version_id, v.version_no, v.lifecycle_status,
                       v.priority, v.cooldown_minutes, v.effective_from, v.effective_to, v.row_version
                from rule_definition d
                left join lateral (
                    select rv.* from rule_version rv
                    where rv.tenant_id = d.tenant_id and rv.rule_id = d.id
                    order by rv.version_no desc limit 1
                ) v on true
                where d.tenant_id = :tenantId
                  and (:tenantScope = true or d.owner_org_unit_id is null or exists (
                    select 1 from org_unit_closure c where c.tenant_id = d.tenant_id
                      and c.descendant_id = d.owner_org_unit_id and c.ancestor_id in (:orgScopes)
                  ))
                order by d.event_type, d.name
                """, visibleParams(principal));
    }

    @Transactional
    public Map<String, Object> create(RuleModels.CreateRule request) {
        accessPolicy.requirePermission("rule.manage");
        TenantPrincipal principal = prepare();
        if (request.ownerOrgUnitId() != null) {
            requireOwned(principal, "org_unit", request.ownerOrgUnitId());
            accessPolicy.requireOrgScope(request.ownerOrgUnitId());
        }
        UUID id = UUID.randomUUID();
        jdbc.update("""
                insert into rule_definition
                    (id, tenant_id, code, name, event_type, owner_org_unit_id, description, created_by)
                values
                    (:id, :tenantId, :code, :name, :eventType, :ownerOrgUnitId, :description, :actorId)
                """, base(principal)
                .addValue("id", id)
                .addValue("code", request.code().trim().toUpperCase(Locale.ROOT))
                .addValue("name", request.name().trim())
                .addValue("eventType", EventTypeNames.normalize(request.eventType()))
                .addValue("ownerOrgUnitId", request.ownerOrgUnitId())
                .addValue("description", request.description())
                .addValue("actorId", principal.actorId()));
        auditWriter.record("RULE_CREATED", "RULE", id, "{\"code\":\"" + request.code() + "\"}");
        return Map.of("id", id, "code", request.code().trim().toUpperCase(Locale.ROOT), "status", "ACTIVE");
    }

    @Transactional(readOnly = true)
    public Map<String, Object> detail(UUID ruleId) {
        accessPolicy.requirePermission("rule.read");
        TenantPrincipal principal = prepare();
        requireRuleVisible(principal, ruleId);
        Map<String, Object> result = new LinkedHashMap<>(jdbc.queryForMap("""
                select id, code, name, event_type, owner_org_unit_id, description, status, created_at, updated_at
                from rule_definition where tenant_id = :tenantId and id = :ruleId
                """, base(principal).addValue("ruleId", ruleId)));
        result.put("versions", jdbc.queryForList("""
                select id, version_no, lifecycle_status, condition_ast, actions, priority,
                       cooldown_minutes, effective_from, effective_to, content_hash,
                       row_version, published_at, created_at
                from rule_version where tenant_id = :tenantId and rule_id = :ruleId
                order by version_no desc
                """, base(principal).addValue("ruleId", ruleId)));
        result.put("scopes", jdbc.queryForList("""
                select s.id, s.rule_version_id, s.scope_type, s.brand_id, s.org_unit_id, s.position_id
                from rule_scope s join rule_version v on v.tenant_id = s.tenant_id and v.id = s.rule_version_id
                where s.tenant_id = :tenantId and v.rule_id = :ruleId
                order by v.version_no desc, s.scope_type
                """, base(principal).addValue("ruleId", ruleId)));
        return result;
    }

    @Transactional
    public Map<String, Object> createVersion(UUID ruleId, RuleModels.CreateVersion request) {
        accessPolicy.requirePermission("rule.manage");
        TenantPrincipal principal = prepare();
        requireOwned(principal, "rule_definition", ruleId);
        validateDefinition(request.conditionAst(), request.actions());
        Integer versionNo = jdbc.queryForObject("""
                select coalesce(max(version_no), 0) + 1 from rule_version
                where tenant_id = :tenantId and rule_id = :ruleId
                """, base(principal).addValue("ruleId", ruleId), Integer.class);
        UUID versionId = UUID.randomUUID();
        String contentHash = contentHash(request.conditionAst(), request.actions(), request.priority(), request.cooldownMinutes());
        jdbc.update("""
                insert into rule_version
                    (id, tenant_id, rule_id, version_no, condition_ast, actions, priority,
                     cooldown_minutes, content_hash, created_by)
                values
                    (:id, :tenantId, :ruleId, :versionNo, cast(:condition as jsonb), cast(:actions as jsonb),
                     :priority, :cooldown, :contentHash, :actorId)
                """, base(principal)
                .addValue("id", versionId)
                .addValue("ruleId", ruleId)
                .addValue("versionNo", versionNo)
                .addValue("condition", request.conditionAst().toString())
                .addValue("actions", request.actions().toString())
                .addValue("priority", request.priority() == null ? 100 : request.priority())
                .addValue("cooldown", request.cooldownMinutes() == null ? 0 : request.cooldownMinutes())
                .addValue("contentHash", contentHash)
                .addValue("actorId", principal.actorId()));
        replaceScopes(principal, versionId, request.scopes());
        auditWriter.record("RULE_VERSION_CREATED", "RULE_VERSION", versionId,
                "{\"ruleId\":\"" + ruleId + "\",\"versionNo\":" + versionNo + "}");
        return versionResult(principal, versionId);
    }

    @Transactional
    public Map<String, Object> updateVersion(UUID ruleId, UUID versionId, RuleModels.UpdateVersion request) {
        accessPolicy.requirePermission("rule.manage");
        TenantPrincipal principal = prepare();
        validateDefinition(request.conditionAst(), request.actions());
        String contentHash = contentHash(request.conditionAst(), request.actions(), request.priority(), request.cooldownMinutes());
        int updated = jdbc.update("""
                update rule_version
                set condition_ast = cast(:condition as jsonb), actions = cast(:actions as jsonb),
                    priority = :priority, cooldown_minutes = :cooldown, content_hash = :contentHash,
                    row_version = row_version + 1
                where tenant_id = :tenantId and rule_id = :ruleId and id = :versionId
                  and lifecycle_status = 'DRAFT' and row_version = :expectedVersion
                """, base(principal)
                .addValue("ruleId", ruleId)
                .addValue("versionId", versionId)
                .addValue("condition", request.conditionAst().toString())
                .addValue("actions", request.actions().toString())
                .addValue("priority", request.priority() == null ? 100 : request.priority())
                .addValue("cooldown", request.cooldownMinutes() == null ? 0 : request.cooldownMinutes())
                .addValue("contentHash", contentHash)
                .addValue("expectedVersion", request.expectedVersion()));
        if (updated != 1) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "规则草稿版本已变化或已发布");
        }
        jdbc.update("delete from rule_scope where tenant_id = :tenantId and rule_version_id = :versionId",
                base(principal).addValue("versionId", versionId));
        replaceScopes(principal, versionId, request.scopes());
        auditWriter.record("RULE_VERSION_UPDATED", "RULE_VERSION", versionId, "{}");
        return versionResult(principal, versionId);
    }

    @Transactional(readOnly = true)
    public Map<String, Object> validate(UUID ruleId, UUID versionId) {
        accessPolicy.requirePermission("rule.manage");
        TenantPrincipal principal = prepare();
        Map<String, Object> version = requireVersion(principal, ruleId, versionId);
        JsonNode condition = parse(version.get("condition_ast"));
        JsonNode actions = parse(version.get("actions"));
        validateDefinition(condition, actions);
        return Map.of("valid", true, "ruleId", ruleId, "versionId", versionId,
                "actionCount", actions.size(), "contentHash", version.get("content_hash"));
    }

    @Transactional(readOnly = true)
    public Map<String, Object> simulate(UUID ruleId, UUID versionId, RuleModels.Simulation request) {
        accessPolicy.requirePermission("rule.simulate");
        TenantPrincipal principal = prepare();
        Map<String, Object> version = requireVersion(principal, ruleId, versionId);
        RuleConditionEvaluator.Evaluation evaluated = evaluator.evaluate(parse(version.get("condition_ast")), request.facts());
        JsonNode actions = parse(version.get("actions"));
        return Map.of(
                "ruleId", ruleId,
                "versionId", versionId,
                "matched", evaluated.matched(),
                "trace", evaluated.trace(),
                "plannedActions", evaluated.matched() ? actions : objectMapper.createArrayNode(),
                "sideEffects", 0
        );
    }

    @Transactional
    public Map<String, Object> publish(UUID ruleId, UUID versionId, RuleModels.PublishVersion request) {
        accessPolicy.requirePermission("rule.publish");
        TenantPrincipal principal = prepare();
        Map<String, Object> version = requireVersion(principal, ruleId, versionId);
        validateDefinition(parse(version.get("condition_ast")), parse(version.get("actions")));
        Integer scopeCount = jdbc.queryForObject("""
                select count(*) from rule_scope where tenant_id = :tenantId and rule_version_id = :versionId
                """, base(principal).addValue("versionId", versionId), Integer.class);
        if (scopeCount == null || scopeCount == 0) {
            throw new IllegalArgumentException("规则版本至少需要一个适用范围");
        }
        int updated = jdbc.update("""
                update rule_version
                set lifecycle_status = 'PUBLISHED', effective_from = :effectiveFrom,
                    effective_to = :effectiveTo, published_by = :actorId, published_at = now(),
                    row_version = row_version + 1
                where tenant_id = :tenantId and rule_id = :ruleId and id = :versionId
                  and lifecycle_status = 'DRAFT' and row_version = :expectedVersion
                """, base(principal)
                .addValue("ruleId", ruleId)
                .addValue("versionId", versionId)
                .addValue("effectiveFrom", request.effectiveFrom())
                .addValue("effectiveTo", request.effectiveTo())
                .addValue("actorId", principal.actorId())
                .addValue("expectedVersion", request.expectedVersion()));
        if (updated != 1) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "规则版本已变化或不是草稿");
        }
        jdbc.update("""
                update rule_version set lifecycle_status = 'DISABLED', effective_to = :effectiveFrom,
                    row_version = row_version + 1
                where tenant_id = :tenantId and rule_id = :ruleId and id <> :versionId
                  and lifecycle_status = 'PUBLISHED'
                """, base(principal).addValue("ruleId", ruleId).addValue("versionId", versionId)
                .addValue("effectiveFrom", request.effectiveFrom()));
        auditWriter.record("RULE_PUBLISHED", "RULE_VERSION", versionId, "{\"ruleId\":\"" + ruleId + "\"}");
        auditWriter.emit("RULE", ruleId, "RulePublished",
                "{\"ruleId\":\"" + ruleId + "\",\"versionId\":\"" + versionId + "\"}");
        return versionResult(principal, versionId);
    }

    @Transactional
    public Map<String, Object> disable(UUID ruleId, UUID versionId, long expectedVersion) {
        accessPolicy.requirePermission("rule.publish");
        TenantPrincipal principal = prepare();
        int updated = jdbc.update("""
                update rule_version
                set lifecycle_status = 'DISABLED', effective_to = now(), row_version = row_version + 1
                where tenant_id = :tenantId and rule_id = :ruleId and id = :versionId
                  and lifecycle_status = 'PUBLISHED' and row_version = :expectedVersion
                """, base(principal).addValue("ruleId", ruleId).addValue("versionId", versionId)
                .addValue("expectedVersion", expectedVersion));
        if (updated != 1) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "规则版本已变化或不是已发布状态");
        }
        auditWriter.record("RULE_DISABLED", "RULE_VERSION", versionId, "{}");
        return versionResult(principal, versionId);
    }

    @Transactional(readOnly = true)
    public List<Map<String, Object>> events(String status) {
        accessPolicy.requirePermission("rule.read");
        TenantPrincipal principal = prepare();
        return jdbc.queryForList("""
                select e.id, e.source_event_id, e.event_type, e.schema_version, e.org_unit_id,
                       e.position_assignment_id, e.occurred_at, e.payload_snapshot,
                       e.processing_status, e.attempt_count, e.last_error, e.row_version
                from management_event e
                where e.tenant_id = :tenantId
                  and (cast(:status as varchar) is null or e.processing_status = :status)
                  and (:tenantScope = true or e.org_unit_id is null or exists (
                    select 1 from org_unit_closure c where c.tenant_id = e.tenant_id
                      and c.descendant_id = e.org_unit_id and c.ancestor_id in (:orgScopes)
                  ))
                order by e.occurred_at desc limit 500
                """, visibleParams(principal).addValue("status", normalize(status)));
    }

    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public Map<String, Object> consume(UUID eventId) {
        accessPolicy.requirePermission("rule.manage");
        TenantPrincipal principal = prepare();
        Map<String, Object> event = requireEventVisible(principal, eventId, true);
        if ("PROCESSED".equals(event.get("processing_status"))) {
            return consumptionResult(principal, eventId);
        }
        int claimed = jdbc.update("""
                update management_event
                set processing_status = 'PROCESSING', attempt_count = attempt_count + 1,
                    locked_by = :lockedBy, locked_until = now() + interval '2 minutes',
                    row_version = row_version + 1, last_error = null
                where tenant_id = :tenantId and id = :eventId
                  and processing_status in ('PENDING', 'FAILED') and row_version = :expectedVersion
                """, base(principal).addValue("eventId", eventId)
                .addValue("lockedBy", "http:" + principal.actorId())
                .addValue("expectedVersion", event.get("row_version")));
        if (claimed != 1) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "管理事件已被其他消费者处理");
        }
        JsonNode facts = eventFacts(event);
        List<Map<String, Object>> versions = matchingVersions(principal, event);
        boolean allActionsSucceeded = true;
        for (Map<String, Object> version : versions) {
            if (inCooldown(principal, event, version)) {
                continue;
            }
            allActionsSucceeded &= evaluateAndAct(principal, event, version, facts);
        }
        if (allActionsSucceeded) {
            jdbc.update("""
                    update management_event
                    set processing_status = 'PROCESSED', locked_by = null, locked_until = null,
                        last_error = null, row_version = row_version + 1
                    where tenant_id = :tenantId and id = :eventId and processing_status = 'PROCESSING'
                    """, base(principal).addValue("eventId", eventId));
        } else {
            jdbc.update("""
                    update management_event
                    set processing_status = 'FAILED', locked_by = null, locked_until = null,
                        last_error = 'one or more rule actions failed', row_version = row_version + 1
                    where tenant_id = :tenantId and id = :eventId and processing_status = 'PROCESSING'
                    """, base(principal).addValue("eventId", eventId));
        }
        auditWriter.record("MANAGEMENT_EVENT_CONSUMED", "MANAGEMENT_EVENT", eventId,
                "{\"ruleCount\":" + versions.size() + ",\"succeeded\":" + allActionsSucceeded + "}");
        return consumptionResult(principal, eventId);
    }

    private boolean evaluateAndAct(
            TenantPrincipal principal,
            Map<String, Object> event,
            Map<String, Object> version,
            JsonNode facts
    ) {
        UUID eventId = (UUID) event.get("id");
        UUID versionId = (UUID) version.get("id");
        RuleConditionEvaluator.Evaluation result = evaluator.evaluate(parse(version.get("condition_ast")), facts);
        UUID evaluationId = UUID.randomUUID();
        ObjectNode resultJson = objectMapper.createObjectNode();
        resultJson.put("matched", result.matched());
        result.trace().forEach(item -> resultJson.withArray("trace").add(item));
        int inserted = jdbc.update("""
                insert into rule_evaluation
                    (id, tenant_id, management_event_id, rule_version_id, facts_snapshot, matched, result)
                values (:id, :tenantId, :eventId, :versionId, cast(:facts as jsonb), :matched, cast(:result as jsonb))
                on conflict (tenant_id, management_event_id, rule_version_id) do nothing
                """, base(principal).addValue("id", evaluationId).addValue("eventId", eventId)
                .addValue("versionId", versionId).addValue("facts", facts.toString())
                .addValue("matched", result.matched()).addValue("result", resultJson.toString()));
        if (inserted == 0) {
            evaluationId = jdbc.queryForObject("""
                    select id from rule_evaluation where tenant_id = :tenantId
                      and management_event_id = :eventId and rule_version_id = :versionId
                    """, base(principal).addValue("eventId", eventId).addValue("versionId", versionId), UUID.class);
        }
        if (!result.matched()) {
            return true;
        }
        JsonNode actions = parse(version.get("actions"));
        boolean allActionsSucceeded = true;
        for (int index = 0; index < actions.size(); index++) {
            allActionsSucceeded &= executeAction(principal, event, version, evaluationId, actions.get(index), index);
        }
        return allActionsSucceeded;
    }

    private boolean executeAction(
            TenantPrincipal principal,
            Map<String, Object> event,
            Map<String, Object> version,
            UUID evaluationId,
            JsonNode action,
            int index
    ) {
        UUID eventId = (UUID) event.get("id");
        UUID versionId = (UUID) version.get("id");
        String actionKey = action.path("key").asText("action-" + index);
        String actionType = action.path("type").asText().toUpperCase(Locale.ROOT);
        String idempotencyKey = versionId + ":" + eventId + ":" + actionKey;
        UUID actionId = UUID.randomUUID();
        int inserted = jdbc.update("""
                insert into rule_action_execution
                    (id, tenant_id, rule_evaluation_id, management_event_id, rule_version_id,
                     action_key, action_type, idempotency_key)
                values (:id, :tenantId, :evaluationId, :eventId, :versionId,
                        :actionKey, :actionType, :idempotencyKey)
                on conflict (tenant_id, rule_version_id, management_event_id, action_key) do nothing
                """, base(principal).addValue("id", actionId).addValue("evaluationId", evaluationId)
                .addValue("eventId", eventId).addValue("versionId", versionId)
                .addValue("actionKey", actionKey).addValue("actionType", actionType)
                .addValue("idempotencyKey", idempotencyKey));
        if (inserted == 0) {
            List<Map<String, Object>> existing = jdbc.queryForList("""
                    select id, status from rule_action_execution
                    where tenant_id = :tenantId and rule_version_id = :versionId
                      and management_event_id = :eventId and action_key = :actionKey
                    for update
                    """, base(principal).addValue("versionId", versionId)
                    .addValue("eventId", eventId).addValue("actionKey", actionKey));
            if (existing.isEmpty()) {
                return false;
            }
            actionId = (UUID) existing.getFirst().get("id");
            if ("SUCCEEDED".equals(existing.getFirst().get("status"))) {
                return true;
            }
        }
        try {
            UUID targetId = switch (actionType) {
                case "CREATE_TASK" -> createTaskAction(event, action, actionId, idempotencyKey);
                case "CREATE_NOTIFICATION" -> createNotificationAction(event, action, idempotencyKey);
                default -> throw new IllegalArgumentException("不支持的规则动作类型: " + actionType);
            };
            jdbc.update("""
                    update rule_action_execution
                    set status = 'SUCCEEDED', target_id = :targetId, attempt_count = attempt_count + 1,
                        executed_at = now(), last_error = null
                    where tenant_id = :tenantId and id = :id
                    """, base(principal).addValue("id", actionId).addValue("targetId", targetId));
            return true;
        } catch (RuntimeException exception) {
            jdbc.update("""
                    update rule_action_execution
                    set status = 'FAILED', attempt_count = attempt_count + 1, last_error = :error
                    where tenant_id = :tenantId and id = :id
                    """, base(principal).addValue("id", actionId)
                    .addValue("error", exception.getMessage() == null ? exception.getClass().getSimpleName() : exception.getMessage()));
            return false;
        }
    }

    private UUID createTaskAction(Map<String, Object> event, JsonNode action, UUID actionId, String key) {
        UUID assignee = resolveAssignment(event, action.path("assigneeResolver").asText("CURRENT_ASSIGNMENT"), action);
        UUID reviewer = resolveAssignment(event, action.path("reviewerResolver").asText("DIRECT_MANAGER_ASSIGNMENT"), action);
        int dueMinutes = action.path("dueMinutes").asInt(48 * 60);
        UUID standardVersionId = uuid(action.get("standardVersionId"));
        if (standardVersionId == null) {
            JsonNode payload = parse(event.get("payload_snapshot"));
            standardVersionId = uuid(payload.get("standardVersionId"));
        }
        UUID workRecordId = uuid(parse(event.get("payload_snapshot")).get("workRecordId"));
        TaskModels.RuleTaskSpec spec = new TaskModels.RuleTaskSpec(
                (UUID) event.get("id"), actionId, (UUID) event.get("org_unit_id"), assignee, reviewer,
                standardVersionId, workRecordId,
                action.path("title").asText("规则触发整改任务"),
                action.path("description").asText("由企业规则中心自动创建"),
                action.path("priority").asText("NORMAL"),
                OffsetDateTime.now().plusMinutes(Math.max(dueMinutes, 0)),
                parse(event.get("payload_snapshot"))
        );
        return taskService.createFromRule(spec, key);
    }

    private UUID createNotificationAction(Map<String, Object> event, JsonNode action, String key) {
        UUID recipient = resolveAssignment(event, action.path("recipientResolver").asText("CURRENT_ASSIGNMENT"), action);
        return notificationService.createForAssignment(recipient,
                action.path("notificationType").asText("RULE_MATCHED"),
                action.path("title").asText("管理规则已触发"),
                action.path("content").asText("请查看相关管理事件"),
                "MANAGEMENT_EVENT", (UUID) event.get("id"), key);
    }

    private UUID resolveAssignment(Map<String, Object> event, String resolver, JsonNode action) {
        TenantPrincipal principal = accessPolicy.principal();
        UUID current = (UUID) event.get("position_assignment_id");
        return switch (resolver.toUpperCase(Locale.ROOT)) {
            case "CURRENT_ASSIGNMENT" -> {
                if (current == null) {
                    throw new IllegalArgumentException("事件没有当前任职，无法解析责任人");
                }
                yield current;
            }
            case "DIRECT_MANAGER_ASSIGNMENT" -> {
                if (current == null) {
                    throw new IllegalArgumentException("事件没有当前任职，无法解析直接上级");
                }
                List<UUID> managers = jdbc.queryForList("""
                        select manager_assignment_id from employee_position_assignment
                        where tenant_id = :tenantId and id = :assignmentId and manager_assignment_id is not null
                        """, base(principal).addValue("assignmentId", current), UUID.class);
                if (managers.size() != 1) {
                    throw new IllegalArgumentException("当前任职未配置唯一直接上级任职");
                }
                yield managers.getFirst();
            }
            case "POSITION_IN_SAME_ORG" -> uniquePositionAssignment(principal,
                    (UUID) event.get("org_unit_id"), uuidRequired(action.get("positionId"), "positionId"), false);
            case "POSITION_IN_ANCESTOR_ORG" -> uniquePositionAssignment(principal,
                    (UUID) event.get("org_unit_id"), uuidRequired(action.get("positionId"), "positionId"), true);
            default -> throw new IllegalArgumentException("不支持的任职解析器: " + resolver);
        };
    }

    private UUID uniquePositionAssignment(TenantPrincipal principal, UUID orgUnitId, UUID positionId, boolean ancestors) {
        List<UUID> assignments;
        if (ancestors) {
            assignments = jdbc.queryForList("""
                    select a.id
                    from org_unit_closure c
                    join employee_position_assignment a on a.tenant_id = c.tenant_id and a.org_unit_id = c.ancestor_id
                    where c.tenant_id = :tenantId and c.descendant_id = :orgUnitId
                      and a.position_id = :positionId and a.status = 'ACTIVE'
                      and a.valid_from <= current_date and (a.valid_to is null or a.valid_to >= current_date)
                    order by c.depth, a.id limit 2
                    """, base(principal).addValue("orgUnitId", orgUnitId).addValue("positionId", positionId), UUID.class);
        } else {
            assignments = jdbc.queryForList("""
                    select id from employee_position_assignment
                    where tenant_id = :tenantId and org_unit_id = :orgUnitId and position_id = :positionId
                      and status = 'ACTIVE' and valid_from <= current_date
                      and (valid_to is null or valid_to >= current_date)
                    order by id limit 2
                    """, base(principal).addValue("orgUnitId", orgUnitId).addValue("positionId", positionId), UUID.class);
        }
        if (assignments.size() != 1) {
            throw new IllegalArgumentException("任职解析必须得到唯一结果，实际数量: " + assignments.size());
        }
        return assignments.getFirst();
    }

    private List<Map<String, Object>> matchingVersions(TenantPrincipal principal, Map<String, Object> event) {
        return jdbc.queryForList("""
                select v.id, v.rule_id, v.condition_ast, v.actions, v.priority, v.cooldown_minutes
                from rule_version v
                join rule_definition d on d.tenant_id = v.tenant_id and d.id = v.rule_id
                where v.tenant_id = :tenantId and d.status = 'ACTIVE'
                  and upper(trim(d.event_type)) = :eventType
                  and v.lifecycle_status = 'PUBLISHED'
                  and v.effective_from <= :occurredAt
                  and (v.effective_to is null or v.effective_to > :occurredAt)
                  and exists (
                    select 1 from rule_scope s
                    where s.tenant_id = v.tenant_id and s.rule_version_id = v.id and (
                      s.scope_type = 'TENANT'
                      or (s.scope_type = 'ORG_UNIT' and s.org_unit_id = :orgUnitId)
                      or (s.scope_type = 'ORG_TREE' and exists (
                        select 1 from org_unit_closure c where c.tenant_id = s.tenant_id
                          and c.ancestor_id = s.org_unit_id and c.descendant_id = :orgUnitId
                      ))
                      or (s.scope_type = 'POSITION' and exists (
                        select 1 from employee_position_assignment a where a.tenant_id = s.tenant_id
                          and a.id = :assignmentId and a.position_id = s.position_id
                      ))
                      or (s.scope_type = 'BRAND' and exists (
                        select 1 from hotel_profile h where h.tenant_id = s.tenant_id
                          and h.org_unit_id = :orgUnitId and h.brand_id = s.brand_id
                      ))
                    )
                  )
                order by v.priority, v.version_no desc
                """, base(principal)
                .addValue("eventType", EventTypeNames.normalize(String.valueOf(event.get("event_type"))))
                .addValue("occurredAt", event.get("occurred_at"))
                .addValue("orgUnitId", event.get("org_unit_id"))
                .addValue("assignmentId", event.get("position_assignment_id")));
    }

    private boolean inCooldown(TenantPrincipal principal, Map<String, Object> event, Map<String, Object> version) {
        int cooldown = ((Number) version.get("cooldown_minutes")).intValue();
        if (cooldown <= 0) {
            return false;
        }
        Integer count = jdbc.queryForObject("""
                select count(*)
                from rule_evaluation re
                join management_event me on me.tenant_id = re.tenant_id and me.id = re.management_event_id
                where re.tenant_id = :tenantId and re.rule_version_id = :versionId and re.matched = true
                  and me.org_unit_id is not distinct from :orgUnitId
                  and re.management_event_id <> :eventId
                  and re.evaluated_at >= now() - make_interval(mins => :cooldown)
                """, base(principal).addValue("versionId", version.get("id"))
                .addValue("eventId", event.get("id"))
                .addValue("orgUnitId", event.get("org_unit_id")).addValue("cooldown", cooldown), Integer.class);
        return count != null && count > 0;
    }

    private Map<String, Object> requireVersion(TenantPrincipal principal, UUID ruleId, UUID versionId) {
        requireRuleVisible(principal, ruleId);
        return jdbc.queryForMap("""
                select id, rule_id, version_no, lifecycle_status, condition_ast, actions, priority,
                       cooldown_minutes, effective_from, effective_to, content_hash, row_version
                from rule_version where tenant_id = :tenantId and rule_id = :ruleId and id = :versionId
                """, base(principal).addValue("ruleId", ruleId).addValue("versionId", versionId));
    }

    private Map<String, Object> versionResult(TenantPrincipal principal, UUID versionId) {
        return jdbc.queryForMap("""
                select id, rule_id, version_no, lifecycle_status, priority, cooldown_minutes,
                       effective_from, effective_to, content_hash, row_version
                from rule_version where tenant_id = :tenantId and id = :versionId
                """, base(principal).addValue("versionId", versionId));
    }

    private Map<String, Object> requireEventVisible(TenantPrincipal principal, UUID eventId, boolean forUpdate) {
        List<Map<String, Object>> rows = jdbc.queryForList("""
                select e.id, e.source_event_id, e.event_type, e.schema_version, e.org_unit_id,
                       e.position_assignment_id, e.occurred_at, e.payload_snapshot,
                       e.processing_status, e.attempt_count, e.row_version
                from management_event e
                where e.tenant_id = :tenantId and e.id = :eventId
                  and (:tenantScope = true or e.org_unit_id is null or exists (
                    select 1 from org_unit_closure c where c.tenant_id = e.tenant_id
                      and c.descendant_id = e.org_unit_id and c.ancestor_id in (:orgScopes)
                  ))
                """ + (forUpdate ? " for update" : ""), visibleParams(principal).addValue("eventId", eventId));
        if (rows.isEmpty()) {
            throw new AccessDeniedException("管理事件不存在或不在当前授权范围");
        }
        return rows.getFirst();
    }

    private Map<String, Object> consumptionResult(TenantPrincipal principal, UUID eventId) {
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("event", jdbc.queryForMap("""
                select id, processing_status, attempt_count, last_error, row_version
                from management_event where tenant_id = :tenantId and id = :eventId
                """, base(principal).addValue("eventId", eventId)));
        result.put("evaluations", jdbc.queryForList("""
                select id, rule_version_id, matched, evaluation_status, result, failure_reason, evaluated_at
                from rule_evaluation where tenant_id = :tenantId and management_event_id = :eventId
                order by evaluated_at
                """, base(principal).addValue("eventId", eventId)));
        result.put("actions", jdbc.queryForList("""
                select id, rule_version_id, action_key, action_type, status, target_id,
                       attempt_count, last_error, executed_at
                from rule_action_execution where tenant_id = :tenantId and management_event_id = :eventId
                order by created_at
                """, base(principal).addValue("eventId", eventId)));
        return result;
    }

    private JsonNode eventFacts(Map<String, Object> event) {
        JsonNode payload = parse(event.get("payload_snapshot"));
        ObjectNode facts = payload.isObject() ? ((ObjectNode) payload.deepCopy()) : objectMapper.createObjectNode().set("payload", payload);
        ObjectNode metadata = facts.putObject("_event");
        metadata.put("id", String.valueOf(event.get("id")));
        metadata.put("type", String.valueOf(event.get("event_type")));
        metadata.put("orgUnitId", String.valueOf(event.get("org_unit_id")));
        metadata.put("positionAssignmentId", String.valueOf(event.get("position_assignment_id")));
        return facts;
    }

    private void validateDefinition(JsonNode condition, JsonNode actions) {
        evaluator.validate(condition);
        if (!actions.isArray() || actions.isEmpty()) {
            throw new IllegalArgumentException("规则动作必须是非空数组");
        }
        Set<String> keys = new HashSet<>();
        for (JsonNode action : actions) {
            if (!action.isObject()) {
                throw new IllegalArgumentException("每个规则动作必须是对象");
            }
            String type = action.path("type").asText().toUpperCase(Locale.ROOT);
            if (!Set.of("CREATE_TASK", "CREATE_NOTIFICATION").contains(type)) {
                throw new IllegalArgumentException("不支持的规则动作: " + type);
            }
            String key = action.path("key").asText();
            if (key.isBlank() || !keys.add(key)) {
                throw new IllegalArgumentException("规则动作key不能为空且必须唯一");
            }
        }
    }

    private void replaceScopes(TenantPrincipal principal, UUID versionId, List<RuleModels.Scope> scopes) {
        for (RuleModels.Scope scope : scopes) {
            String type = scope.scopeType().trim().toUpperCase(Locale.ROOT);
            if (!Set.of("TENANT", "BRAND", "ORG_UNIT", "ORG_TREE", "POSITION").contains(type)) {
                throw new IllegalArgumentException("不支持的规则范围类型: " + type);
            }
            requireOwnedOptional(principal, "brand", scope.brandId());
            requireOwnedOptional(principal, "org_unit", scope.orgUnitId());
            requireOwnedOptional(principal, "position_definition", scope.positionId());
            jdbc.update("""
                    insert into rule_scope
                        (tenant_id, rule_version_id, scope_type, brand_id, org_unit_id, position_id)
                    values (:tenantId, :versionId, :scopeType, :brandId, :orgUnitId, :positionId)
                    """, base(principal).addValue("versionId", versionId).addValue("scopeType", type)
                    .addValue("brandId", scope.brandId()).addValue("orgUnitId", scope.orgUnitId())
                    .addValue("positionId", scope.positionId()));
        }
    }

    private void requireRuleVisible(TenantPrincipal principal, UUID ruleId) {
        Integer count = jdbc.queryForObject("""
                select count(*) from rule_definition d
                where d.tenant_id = :tenantId and d.id = :ruleId
                  and (:tenantScope = true or d.owner_org_unit_id is null or exists (
                    select 1 from org_unit_closure c where c.tenant_id = d.tenant_id
                      and c.descendant_id = d.owner_org_unit_id and c.ancestor_id in (:orgScopes)
                  ))
                """, visibleParams(principal).addValue("ruleId", ruleId), Integer.class);
        if (count == null || count == 0) {
            throw new AccessDeniedException("规则不存在或不在当前授权范围");
        }
    }

    private void requireOwned(TenantPrincipal principal, String table, UUID id) {
        requireOwnedOptional(principal, table, id);
    }

    private void requireOwnedOptional(TenantPrincipal principal, String table, UUID id) {
        if (id == null) {
            return;
        }
        if (!Set.of("rule_definition", "org_unit", "brand", "position_definition").contains(table)) {
            throw new IllegalArgumentException("不允许校验的资源类型");
        }
        Integer count = jdbc.queryForObject("select count(*) from " + table + " where tenant_id = :tenantId and id = :id",
                base(principal).addValue("id", id), Integer.class);
        if (count == null || count == 0) {
            throw new IllegalArgumentException("规则引用资源不存在或不属于当前租户");
        }
    }

    private JsonNode parse(Object value) {
        try {
            return objectMapper.readTree(String.valueOf(value));
        } catch (Exception exception) {
            throw new IllegalArgumentException("JSON结构无法解析", exception);
        }
    }

    private String contentHash(JsonNode condition, JsonNode actions, Integer priority, Integer cooldown) {
        return hash(condition.toString() + "|" + actions + "|" + (priority == null ? 100 : priority)
                + "|" + (cooldown == null ? 0 : cooldown));
    }

    private String hash(String value) {
        try {
            byte[] bytes = MessageDigest.getInstance("SHA-256").digest(value.getBytes(StandardCharsets.UTF_8));
            return HexFormat.of().formatHex(bytes);
        } catch (Exception exception) {
            throw new IllegalStateException("SHA-256不可用", exception);
        }
    }

    private UUID uuid(JsonNode value) {
        if (value == null || value.isNull() || value.asText().isBlank()) {
            return null;
        }
        return UUID.fromString(value.asText());
    }

    private UUID uuidRequired(JsonNode value, String field) {
        UUID parsed = uuid(value);
        if (parsed == null) {
            throw new IllegalArgumentException(field + "不能为空");
        }
        return parsed;
    }

    private MapSqlParameterSource visibleParams(TenantPrincipal principal) {
        Collection<UUID> scopes = principal.orgScopes().isEmpty()
                ? List.of(new UUID(0, 0)) : principal.orgScopes();
        return base(principal).addValue("tenantScope", principal.hasTenantScope()).addValue("orgScopes", scopes);
    }

    private TenantPrincipal prepare() {
        TenantPrincipal principal = accessPolicy.principal();
        databaseContext.apply(principal.tenantId());
        return principal;
    }

    private MapSqlParameterSource base(TenantPrincipal principal) {
        return new MapSqlParameterSource("tenantId", principal.tenantId());
    }

    private String normalize(String value) {
        return value == null || value.isBlank() ? null : value.trim().toUpperCase(Locale.ROOT);
    }
}
