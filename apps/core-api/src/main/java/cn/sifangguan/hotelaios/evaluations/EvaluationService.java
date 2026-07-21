package cn.sifangguan.hotelaios.evaluations;

import cn.sifangguan.hotelaios.shared.audit.AuditWriter;
import cn.sifangguan.hotelaios.shared.context.TenantPrincipal;
import cn.sifangguan.hotelaios.shared.db.TenantDatabaseContext;
import cn.sifangguan.hotelaios.shared.security.AccessDeniedException;
import cn.sifangguan.hotelaios.shared.security.AccessPolicy;
import cn.sifangguan.hotelaios.tasks.TaskService;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

import java.math.BigDecimal;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.*;

@Service
public class EvaluationService {
    private final NamedParameterJdbcTemplate jdbc;
    private final TenantDatabaseContext databaseContext;
    private final AccessPolicy accessPolicy;
    private final AuditWriter auditWriter;
    private final DeterministicEvaluationEngine engine;
    private final ObjectMapper objectMapper;
    private final TaskService taskService;

    public EvaluationService(
            NamedParameterJdbcTemplate jdbc,
            TenantDatabaseContext databaseContext,
            AccessPolicy accessPolicy,
            AuditWriter auditWriter,
            DeterministicEvaluationEngine engine,
            ObjectMapper objectMapper,
            TaskService taskService
    ) {
        this.jdbc = jdbc;
        this.databaseContext = databaseContext;
        this.accessPolicy = accessPolicy;
        this.auditWriter = auditWriter;
        this.engine = engine;
        this.objectMapper = objectMapper;
        this.taskService = taskService;
    }

    @Transactional(readOnly = true)
    public List<Map<String, Object>> list(String outcome, UUID orgUnitId) {
        accessPolicy.requirePermission("evaluation.read");
        TenantPrincipal principal = prepare();
        return jdbc.queryForList("""
                select e.id, e.subject_type, e.subject_id, e.org_unit_id, e.position_assignment_id,
                       e.standard_version_id, e.execution_status, e.outcome, e.score, e.full_score,
                       e.severity, e.row_version, e.completed_at, e.created_at
                from standard_evaluation e
                where e.tenant_id = :tenantId
                  and (cast(:outcome as varchar) is null or e.outcome = :outcome)
                  and (cast(:orgUnitId as uuid) is null or e.org_unit_id = :orgUnitId)
                  and (:tenantScope = true or exists (
                    select 1 from org_unit_closure c where c.tenant_id = e.tenant_id
                      and c.descendant_id = e.org_unit_id and c.ancestor_id in (:orgScopes)
                  ))
                order by e.created_at desc limit 500
                """, visibleParams(principal)
                .addValue("outcome", normalize(outcome))
                .addValue("orgUnitId", orgUnitId));
    }

    @Transactional
    public Map<String, Object> create(String idempotencyKey, EvaluationModels.CreateEvaluation request) {
        accessPolicy.requirePermission("evaluation.manual-review");
        TenantPrincipal principal = prepare();
        accessPolicy.requireOrgScope(request.orgUnitId());
        if (idempotencyKey == null || idempotencyKey.isBlank()) {
            throw new IllegalArgumentException("Idempotency-Key不能为空");
        }
        List<UUID> existing = jdbc.queryForList("""
                select id from standard_evaluation where tenant_id = :tenantId and idempotency_key = :key
                """, base(principal).addValue("key", idempotencyKey), UUID.class);
        if (!existing.isEmpty()) {
            return detailResult(principal, existing.getFirst());
        }
        String subjectType = request.subjectType().trim().toUpperCase(Locale.ROOT);
        validateSubject(principal, subjectType, request.subjectId(), request.orgUnitId(),
                request.positionAssignmentId(), request.standardVersionId());
        Map<String, Object> standard = jdbc.queryForMap("""
                select items, scoring_rules
                from standard_version
                where tenant_id = :tenantId and id = :standardVersionId and lifecycle_status = 'PUBLISHED'
                """, base(principal).addValue("standardVersionId", request.standardVersionId()));
        JsonNode items = parse(standard.get("items"));
        JsonNode scoring = parse(standard.get("scoring_rules"));
        DeterministicEvaluationEngine.Result result = engine.evaluate(items, scoring, request.inputSnapshot());
        UUID evaluationId = UUID.randomUUID();
        String standardHash = hash(items.toString() + "|" + scoring);
        String inputHash = hash(request.inputSnapshot().toString());
        String severity = severity(result.outcome(), result.score(), result.fullScore());
        jdbc.update("""
                insert into standard_evaluation
                    (id, tenant_id, idempotency_key, subject_type, subject_id, org_unit_id,
                     position_assignment_id, standard_version_id, standard_content_hash, input_hash,
                     input_snapshot, execution_status, outcome, score, full_score, severity,
                     completed_at, created_by)
                values
                    (:id, :tenantId, :key, :subjectType, :subjectId, :orgUnitId,
                     :assignmentId, :standardVersionId, :standardHash, :inputHash,
                     cast(:input as jsonb), :executionStatus, :outcome, :score, :fullScore, :severity,
                     case when :executionStatus = 'COMPLETED' then now() else null end, :actorId)
                """, base(principal)
                .addValue("id", evaluationId)
                .addValue("key", idempotencyKey)
                .addValue("subjectType", subjectType)
                .addValue("subjectId", request.subjectId())
                .addValue("orgUnitId", request.orgUnitId())
                .addValue("assignmentId", request.positionAssignmentId())
                .addValue("standardVersionId", request.standardVersionId())
                .addValue("standardHash", standardHash)
                .addValue("inputHash", inputHash)
                .addValue("input", request.inputSnapshot().toString())
                .addValue("executionStatus", result.executionStatus())
                .addValue("outcome", result.outcome())
                .addValue("score", result.score())
                .addValue("fullScore", result.fullScore())
                .addValue("severity", severity)
                .addValue("actorId", principal.actorId()));
        for (DeterministicEvaluationEngine.ItemResult item : result.items()) {
            insertItem(principal, evaluationId, item);
        }
        auditWriter.record("STANDARD_EVALUATION_CREATED", "STANDARD_EVALUATION", evaluationId,
                "{\"subjectType\":\"" + subjectType + "\",\"outcome\":\"" + result.outcome() + "\"}");
        if ("COMPLETED".equals(result.executionStatus())) {
            emitCompleted(evaluationId, subjectType, request.subjectId(), request.orgUnitId(),
                    request.positionAssignmentId(), request.standardVersionId(), result.outcome(),
                    result.score(), result.fullScore());
            if ("TASK".equals(subjectType)) {
                taskService.completeEvaluation(request.subjectId(), evaluationId, "evaluation:" + evaluationId);
            } else if ("WORK_RECORD".equals(subjectType)) {
                settleWorkExpectation(principal, request.subjectId(), result.outcome());
            }
        }
        return detailResult(principal, evaluationId);
    }

    @Transactional(readOnly = true)
    public Map<String, Object> detail(UUID evaluationId) {
        accessPolicy.requirePermission("evaluation.read");
        TenantPrincipal principal = prepare();
        return detailResult(principal, evaluationId);
    }

    private Map<String, Object> detailResult(TenantPrincipal principal, UUID evaluationId) {
        Map<String, Object> evaluation = requireVisible(principal, evaluationId, false);
        Map<String, Object> result = new LinkedHashMap<>(evaluation);
        result.put("items", jdbc.queryForList("""
                select id, item_code, evaluation_mode, operator, expected_value, actual_value,
                       outcome, score, full_score, reason, row_version
                from standard_evaluation_item
                where tenant_id = :tenantId and evaluation_id = :evaluationId
                order by created_at, item_code
                """, base(principal).addValue("evaluationId", evaluationId)));
        return result;
    }

    @Transactional
    public Map<String, Object> manualReview(UUID evaluationId, String idempotencyKey, EvaluationModels.ManualReview request) {
        accessPolicy.requirePermission("evaluation.manual-review");
        TenantPrincipal principal = prepare();
        requireActorAssignment(principal, request.reviewerAssignmentId());
        Map<String, Object> evaluation = requireVisible(principal, evaluationId, true);
        if (!"PENDING_MANUAL".equals(evaluation.get("execution_status"))) {
            throw new IllegalArgumentException("只有待人工判断的评价可以进行人工复核");
        }
        for (EvaluationModels.ManualItem item : request.items()) {
            String outcome = item.outcome().trim().toUpperCase(Locale.ROOT);
            if (!Set.of("PASS", "WARNING", "FAIL").contains(outcome)) {
                throw new IllegalArgumentException("人工评价结果必须为PASS、WARNING或FAIL");
            }
            int updated = jdbc.update("""
                    update standard_evaluation_item
                    set outcome = :outcome,
                        score = coalesce(:score, case when :outcome = 'PASS' then full_score else 0 end),
                        reason = :reason,
                        actual_value = coalesce(cast(:actual as jsonb), actual_value),
                        row_version = row_version + 1
                    where tenant_id = :tenantId and evaluation_id = :evaluationId and item_code = :itemCode
                      and evaluation_mode in ('MANUAL', 'AI_RESERVED') and outcome = 'PENDING'
                    """, base(principal)
                    .addValue("evaluationId", evaluationId)
                    .addValue("itemCode", item.itemCode())
                    .addValue("outcome", outcome)
                    .addValue("score", item.score())
                    .addValue("reason", item.reason())
                    .addValue("actual", item.actualValue() == null ? null : item.actualValue().toString()));
            if (updated != 1) {
                throw new ResponseStatusException(HttpStatus.CONFLICT, "评价条目已处理、代码不存在或不是人工判断条目");
            }
        }
        Map<String, Object> totals = jdbc.queryForMap("""
                select count(*) filter (where outcome = 'PENDING') as pending_count,
                       count(*) filter (where outcome = 'FAIL') as fail_count,
                       count(*) filter (where outcome = 'WARNING') as warning_count,
                       coalesce(sum(score), 0) as score, coalesce(sum(full_score), 0) as full_score
                from standard_evaluation_item where tenant_id = :tenantId and evaluation_id = :evaluationId
                """, base(principal).addValue("evaluationId", evaluationId));
        long pending = ((Number) totals.get("pending_count")).longValue();
        String outcome = pending > 0 ? "PENDING"
                : ((Number) totals.get("fail_count")).longValue() > 0 ? "FAIL"
                : ((Number) totals.get("warning_count")).longValue() > 0 ? "WARNING" : "PASS";
        String executionStatus = pending > 0 ? "PENDING_MANUAL" : "COMPLETED";
        int updated = jdbc.update("""
                update standard_evaluation
                set execution_status = :executionStatus, outcome = :outcome,
                    score = :score, full_score = :fullScore,
                    severity = :severity,
                    completed_at = case when :executionStatus = 'COMPLETED' then now() else null end,
                    row_version = row_version + 1
                where tenant_id = :tenantId and id = :evaluationId and row_version = :expectedVersion
                """, base(principal)
                .addValue("evaluationId", evaluationId)
                .addValue("executionStatus", executionStatus)
                .addValue("outcome", outcome)
                .addValue("score", totals.get("score"))
                .addValue("fullScore", totals.get("full_score"))
                .addValue("severity", severity(outcome, (BigDecimal) totals.get("score"), (BigDecimal) totals.get("full_score")))
                .addValue("expectedVersion", request.expectedVersion()));
        if (updated != 1) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "评价版本已变化，请刷新后重试");
        }
        auditWriter.record("STANDARD_EVALUATION_MANUAL_REVIEWED", "STANDARD_EVALUATION", evaluationId,
                "{\"outcome\":\"" + outcome + "\"}");
        if (pending == 0) {
            emitCompleted(evaluationId, String.valueOf(evaluation.get("subject_type")),
                    (UUID) evaluation.get("subject_id"), (UUID) evaluation.get("org_unit_id"),
                    (UUID) evaluation.get("position_assignment_id"), (UUID) evaluation.get("standard_version_id"),
                    outcome, totals.get("score"), totals.get("full_score"));
            if ("TASK".equals(evaluation.get("subject_type"))) {
                taskService.completeEvaluation((UUID) evaluation.get("subject_id"), evaluationId,
                        "evaluation:" + evaluationId + ":manual");
            } else if ("WORK_RECORD".equals(evaluation.get("subject_type"))) {
                settleWorkExpectation(principal, (UUID) evaluation.get("subject_id"), outcome);
            }
        }
        return detailResult(principal, evaluationId);
    }

    private void insertItem(TenantPrincipal principal, UUID evaluationId, DeterministicEvaluationEngine.ItemResult item) {
        UUID itemId = UUID.randomUUID();
        jdbc.update("""
                insert into standard_evaluation_item
                    (id, tenant_id, evaluation_id, item_code, evaluation_mode, operator,
                     expected_value, actual_value, outcome, score, full_score, reason)
                values
                    (:id, :tenantId, :evaluationId, :code, :mode, :operator,
                     cast(:expected as jsonb), cast(:actual as jsonb), :outcome, :score, :fullScore, :reason)
                """, base(principal)
                .addValue("id", itemId)
                .addValue("evaluationId", evaluationId)
                .addValue("code", item.code())
                .addValue("mode", item.mode())
                .addValue("operator", item.operator())
                .addValue("expected", jsonOrNull(item.expected()))
                .addValue("actual", jsonOrNull(item.actual()))
                .addValue("outcome", item.outcome())
                .addValue("score", item.score())
                .addValue("fullScore", item.fullScore())
                .addValue("reason", item.reason()));
        String snapshot = "{\"itemCode\":\"" + item.code() + "\",\"outcome\":\"" + item.outcome() + "\"}";
        jdbc.update("""
                insert into evaluation_evidence
                    (tenant_id, evaluation_item_id, evidence_type, evidence_snapshot, content_hash)
                values (:tenantId, :itemId, 'SNAPSHOT', cast(:snapshot as jsonb), :hash)
                """, base(principal)
                .addValue("itemId", itemId)
                .addValue("snapshot", snapshot)
                .addValue("hash", hash(snapshot)));
    }

    private void emitCompleted(
            UUID evaluationId,
            String subjectType,
            UUID subjectId,
            UUID orgUnitId,
            UUID positionAssignmentId,
            UUID standardVersionId,
            String outcome,
            Object score,
            Object fullScore
    ) {
        ObjectNode event = objectMapper.createObjectNode();
        event.put("evaluationId", evaluationId.toString());
        event.put("subjectType", subjectType);
        event.put("subjectId", subjectId.toString());
        event.put("orgUnitId", orgUnitId.toString());
        if (positionAssignmentId != null) {
            event.put("positionAssignmentId", positionAssignmentId.toString());
        }
        event.put("standardVersionId", standardVersionId.toString());
        event.put("outcome", outcome);
        event.set("score", objectMapper.valueToTree(score));
        event.set("fullScore", objectMapper.valueToTree(fullScore));
        if ("WORK_RECORD".equals(subjectType)) {
            event.put("workRecordId", subjectId.toString());
        } else if ("TASK".equals(subjectType)) {
            event.put("taskId", subjectId.toString());
        }
        auditWriter.emit("STANDARD_EVALUATION", evaluationId, "StandardEvaluationCompleted", event.toString());
    }

    private void settleWorkExpectation(TenantPrincipal principal, UUID workRecordId, String outcome) {
        jdbc.update("""
                update work_expectation x
                set status = :expectationStatus, row_version = x.row_version + 1
                from work_record w
                where w.tenant_id = :tenantId and w.id = :workRecordId
                  and x.tenant_id = w.tenant_id and x.id = w.work_expectation_id
                  and x.status in ('SUBMITTED', 'SATISFIED', 'FAILED')
                """, base(principal)
                .addValue("workRecordId", workRecordId)
                .addValue("expectationStatus", "PASS".equals(outcome) ? "SATISFIED" : "FAILED"));
    }

    private void validateSubject(
            TenantPrincipal principal,
            String type,
            UUID subjectId,
            UUID orgUnitId,
            UUID assignmentId,
            UUID standardVersionId
    ) {
        if ("TASK".equals(type)) {
            Integer count = jdbc.queryForObject("""
                    select count(*) from management_task
                    where tenant_id = :tenantId and id = :subjectId and org_unit_id = :orgUnitId
                      and lifecycle_status = 'RESULT_SUBMITTED'
                      and standard_version_id = :standardVersionId
                      and (cast(:assignmentId as uuid) is null or exists (
                        select 1 from task_participant p
                        where p.tenant_id = management_task.tenant_id and p.task_id = management_task.id
                          and p.position_assignment_id = :assignmentId and p.valid_to is null
                      ))
                    """, base(principal).addValue("subjectId", subjectId).addValue("orgUnitId", orgUnitId)
                    .addValue("assignmentId", assignmentId).addValue("standardVersionId", standardVersionId), Integer.class);
            if (count == null || count == 0) {
                throw new IllegalArgumentException("任务不存在、组织/任职不一致、尚未提交结果，或评价标准不是任务绑定标准");
            }
        } else if ("WORK_RECORD".equals(type)) {
            Integer count = jdbc.queryForObject("""
                    select count(*) from work_record w
                    where w.tenant_id = :tenantId and w.id = :subjectId and w.org_unit_id = :orgUnitId
                      and w.status in ('SUBMITTED', 'APPROVED')
                      and (cast(:assignmentId as uuid) is null or w.position_assignment_id = :assignmentId)
                      and exists (
                        select 1 from work_package_item_standard s
                        where s.tenant_id = w.tenant_id and s.work_package_item_id = w.work_package_item_id
                          and s.usage_type = 'ACCEPTANCE' and s.standard_version_id = :standardVersionId
                      )
                    """, base(principal).addValue("subjectId", subjectId).addValue("orgUnitId", orgUnitId)
                    .addValue("assignmentId", assignmentId).addValue("standardVersionId", standardVersionId), Integer.class);
            if (count == null || count == 0) {
                throw new IllegalArgumentException("工作记录不存在、任职不一致、尚未提交，或评价标准不是工作项验收标准");
            }
        } else {
            throw new IllegalArgumentException("评价对象类型必须为WORK_RECORD或TASK");
        }
    }

    private Map<String, Object> requireVisible(TenantPrincipal principal, UUID evaluationId, boolean forUpdate) {
        List<Map<String, Object>> rows = jdbc.queryForList("""
                select e.id, e.idempotency_key, e.subject_type, e.subject_id, e.org_unit_id,
                       e.position_assignment_id, e.standard_version_id, e.standard_content_hash,
                       e.input_hash, e.input_snapshot, e.execution_status, e.outcome, e.score,
                       e.full_score, e.severity, e.evaluator_version, e.row_version,
                       e.completed_at, e.created_by, e.created_at, e.updated_at
                from standard_evaluation e
                where e.tenant_id = :tenantId and e.id = :evaluationId
                  and (:tenantScope = true or exists (
                    select 1 from org_unit_closure c where c.tenant_id = e.tenant_id
                      and c.descendant_id = e.org_unit_id and c.ancestor_id in (:orgScopes)
                  ))
                """ + (forUpdate ? " for update" : ""),
                visibleParams(principal).addValue("evaluationId", evaluationId));
        if (rows.isEmpty()) {
            throw new AccessDeniedException("标准评价不存在或不在当前授权范围");
        }
        return rows.getFirst();
    }

    private void requireActorAssignment(TenantPrincipal principal, UUID assignmentId) {
        Integer count = jdbc.queryForObject("""
                select count(*)
                from employee_position_assignment a
                join employee e on e.tenant_id = a.tenant_id and e.id = a.employee_id
                where a.tenant_id = :tenantId and a.id = :assignmentId and e.account_id = :actorId
                  and a.status = 'ACTIVE' and a.valid_from <= current_date
                  and (a.valid_to is null or a.valid_to >= current_date)
                """, base(principal).addValue("assignmentId", assignmentId).addValue("actorId", principal.actorId()), Integer.class);
        if (count == null || count == 0) {
            throw new AccessDeniedException("人工评价任职不属于当前账号或已失效");
        }
    }

    private JsonNode parse(Object value) {
        try {
            return objectMapper.readTree(String.valueOf(value));
        } catch (Exception exception) {
            throw new IllegalArgumentException("标准结构化内容无法解析", exception);
        }
    }

    private String jsonOrNull(JsonNode value) {
        return value == null || value.isMissingNode() ? "null" : value.toString();
    }

    private String hash(String value) {
        try {
            byte[] bytes = MessageDigest.getInstance("SHA-256").digest(value.getBytes(StandardCharsets.UTF_8));
            return HexFormat.of().formatHex(bytes);
        } catch (Exception exception) {
            throw new IllegalStateException("SHA-256不可用", exception);
        }
    }

    private String severity(String outcome, BigDecimal score, BigDecimal fullScore) {
        if ("PASS".equals(outcome)) {
            return "NONE";
        }
        if ("PENDING".equals(outcome) || "WARNING".equals(outcome)) {
            return "MEDIUM";
        }
        if (fullScore == null || fullScore.signum() == 0 || score == null) {
            return "HIGH";
        }
        return score.divide(fullScore, 4, java.math.RoundingMode.HALF_UP)
                .compareTo(BigDecimal.valueOf(0.5)) < 0 ? "CRITICAL" : "HIGH";
    }

    private MapSqlParameterSource visibleParams(TenantPrincipal principal) {
        Collection<UUID> scopes = principal.orgScopes().isEmpty()
                ? List.of(new UUID(0, 0)) : principal.orgScopes();
        return base(principal)
                .addValue("tenantScope", principal.hasTenantScope())
                .addValue("orgScopes", scopes);
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
