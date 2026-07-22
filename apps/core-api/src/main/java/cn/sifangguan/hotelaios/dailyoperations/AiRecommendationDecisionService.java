package cn.sifangguan.hotelaios.dailyoperations;

import cn.sifangguan.hotelaios.dailyoperations.OperationIntelligenceModels.AiDecisionRequest;
import cn.sifangguan.hotelaios.dailyoperations.OperationIntelligenceModels.AiDecisionView;
import cn.sifangguan.hotelaios.shared.audit.AuditWriter;
import cn.sifangguan.hotelaios.shared.context.TenantPrincipal;
import cn.sifangguan.hotelaios.shared.idempotency.CommandIdempotencyService;
import cn.sifangguan.hotelaios.shared.security.AccessDeniedException;
import cn.sifangguan.hotelaios.shared.security.AccessPolicy;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

import java.time.OffsetDateTime;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.UUID;

/** Records governed human decisions on immutable AI recommendations. */
@Service
public class AiRecommendationDecisionService {
    private static final Set<String> DECISIONS = Set.of(
            "ACCEPTED", "PARTIALLY_ACCEPTED", "REJECTED", "REPORTED_INCORRECT");

    private final NamedParameterJdbcTemplate jdbc;
    private final AccessPolicy accessPolicy;
    private final OperationScopeService scopes;
    private final CommandIdempotencyService idempotencyService;
    private final AuditWriter auditWriter;
    private final ObjectMapper objectMapper;

    public AiRecommendationDecisionService(
            NamedParameterJdbcTemplate jdbc,
            AccessPolicy accessPolicy,
            OperationScopeService scopes,
            CommandIdempotencyService idempotencyService,
            AuditWriter auditWriter,
            ObjectMapper objectMapper
    ) {
        this.jdbc = jdbc;
        this.accessPolicy = accessPolicy;
        this.scopes = scopes;
        this.idempotencyService = idempotencyService;
        this.auditWriter = auditWriter;
        this.objectMapper = objectMapper;
    }

    @Transactional
    public AiDecisionView decide(
            UUID recommendationId,
            AiDecisionRequest request,
            String idempotencyKey
    ) {
        String decision = normalizeDecision(request.decision());
        if ("ACCEPTED".equals(decision) || "PARTIALLY_ACCEPTED".equals(decision)) {
            accessPolicy.requirePermission("ai-recommendation.adopt");
        } else {
            accessPolicy.requirePermission("ai-recommendation.feedback");
        }
        TenantPrincipal principal = scopes.prepare();
        accessPolicy.requireActiveAssignment(request.actorAssignmentId());
        RecommendationContext recommendation = requireRecommendation(principal, recommendationId);
        requireScope(principal, recommendation);
        if (!"AVAILABLE".equals(recommendation.status())) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "AI建议已失效，不能再记录采纳或反馈");
        }

        DecisionCommand command = new DecisionCommand(
                recommendationId, decision, trimmed(request.note()), request.actorAssignmentId());
        CommandIdempotencyService.Reservation reservation = idempotencyService.reserve(
                "AI_RECOMMENDATION_DECISION", idempotencyKey, command, principal.correlationId());
        if (reservation.replayed()) {
            return requireDecision(principal, reservation.resourceId());
        }

        UUID id = UUID.randomUUID();
        ObjectNode snapshot = objectMapper.createObjectNode();
        snapshot.put("recommendationId", recommendationId.toString());
        snapshot.put("decision", decision);
        snapshot.put("humanConfirmed", true);
        snapshot.put("formalTaskCreated", false);
        if (request.note() != null && !request.note().isBlank()) {
            snapshot.put("note", request.note().trim());
        }
        jdbc.update("""
                insert into ai_decision
                    (id, tenant_id, recommendation_id, decision, actor_account_id,
                     actor_assignment_id, reason, decision_snapshot, trace_id)
                values
                    (:id, :tenantId, :recommendationId, :decision, :actorId,
                     :actorAssignmentId, :reason, cast(:snapshot as jsonb), :traceId)
                """, scopes.base(principal)
                .addValue("id", id)
                .addValue("recommendationId", recommendationId)
                .addValue("decision", decision)
                .addValue("actorId", principal.actorId())
                .addValue("actorAssignmentId", request.actorAssignmentId())
                .addValue("reason", trimmed(request.note()))
                .addValue("snapshot", snapshot.toString())
                .addValue("traceId", principal.correlationId()));

        AiDecisionView result = requireDecision(principal, id);
        idempotencyService.succeed(reservation, "AI_DECISION", id, 201, result);
        auditWriter.record("AI_RECOMMENDATION_DECIDED", "AI_RECOMMENDATION", recommendationId,
                json(snapshot));
        ObjectNode event = objectMapper.createObjectNode();
        event.put("recommendationId", recommendationId.toString());
        event.put("decisionId", id.toString());
        event.put("decision", decision);
        event.put("formalTaskCreated", false);
        auditWriter.emit("AI_RECOMMENDATION", recommendationId,
                "AI_RECOMMENDATION_DECIDED", event.toString());
        return result;
    }

    private RecommendationContext requireRecommendation(TenantPrincipal principal, UUID id) {
        List<RecommendationContext> rows = jdbc.query("""
                select recommendation.id, recommendation.status,
                       request.hotel_org_unit_id, request.org_unit_id
                from ai_recommendation recommendation
                join ai_request request
                  on request.tenant_id = recommendation.tenant_id
                 and request.id = recommendation.ai_request_id
                where recommendation.tenant_id = :tenantId and recommendation.id = :id
                """, scopes.base(principal).addValue("id", id),
                (rs, rowNum) -> new RecommendationContext(
                        rs.getObject("id", UUID.class), rs.getString("status"),
                        rs.getObject("hotel_org_unit_id", UUID.class),
                        rs.getObject("org_unit_id", UUID.class)));
        if (rows.size() != 1) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "AI建议不存在");
        }
        return rows.getFirst();
    }

    private void requireScope(TenantPrincipal principal, RecommendationContext recommendation) {
        if (recommendation.orgUnitId() != null) {
            accessPolicy.requireOrgScope(recommendation.orgUnitId());
            return;
        }
        if (recommendation.hotelOrgUnitId() != null) {
            scopes.requireVisibleHotel(principal, recommendation.hotelOrgUnitId());
            return;
        }
        if (!principal.hasTenantScope()) {
            throw new AccessDeniedException("租户级AI建议不在当前账号的数据范围内");
        }
    }

    private AiDecisionView requireDecision(TenantPrincipal principal, UUID id) {
        if (id == null) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "幂等响应缺少AI决策资源标识");
        }
        List<AiDecisionView> rows = jdbc.query("""
                select id, recommendation_id, decision, reason, actor_assignment_id, created_at
                from ai_decision
                where tenant_id = :tenantId and id = :id and actor_account_id = :actorId
                """, scopes.base(principal).addValue("id", id).addValue("actorId", principal.actorId()),
                (rs, rowNum) -> new AiDecisionView(
                        rs.getObject("id", UUID.class), rs.getObject("recommendation_id", UUID.class),
                        rs.getString("decision"), rs.getString("reason"),
                        rs.getObject("actor_assignment_id", UUID.class),
                        rs.getObject("created_at", OffsetDateTime.class)));
        if (rows.size() != 1) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "AI决策不存在或不属于当前账号");
        }
        return rows.getFirst();
    }

    private static String normalizeDecision(String value) {
        if (value == null || value.isBlank()) {
            throw new IllegalArgumentException("decision不能为空");
        }
        String normalized = value.trim().toUpperCase(Locale.ROOT);
        if (!DECISIONS.contains(normalized)) {
            throw new IllegalArgumentException("不支持的AI建议决策: " + value);
        }
        return normalized;
    }

    private static String trimmed(String value) {
        return value == null || value.isBlank() ? null : value.trim();
    }

    private String json(Object value) {
        try {
            return objectMapper.writeValueAsString(value);
        } catch (Exception exception) {
            throw new IllegalArgumentException("无法生成AI决策审计JSON", exception);
        }
    }

    private record RecommendationContext(
            UUID id,
            String status,
            UUID hotelOrgUnitId,
            UUID orgUnitId
    ) {
    }

    private record DecisionCommand(
            UUID recommendationId,
            String decision,
            String note,
            UUID actorAssignmentId
    ) {
    }
}
