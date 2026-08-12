package cn.sifangguan.hotelaios.performance;

import cn.sifangguan.hotelaios.notifications.NotificationService;
import cn.sifangguan.hotelaios.shared.audit.AuditWriter;
import cn.sifangguan.hotelaios.shared.context.TenantPrincipal;
import cn.sifangguan.hotelaios.shared.db.TenantDatabaseContext;
import cn.sifangguan.hotelaios.shared.security.AccessPolicy;
import cn.sifangguan.hotelaios.tasks.TaskModels;
import cn.sifangguan.hotelaios.tasks.TaskService;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.springframework.dao.EmptyResultDataAccessException;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.sql.Date;
import java.time.LocalDate;
import java.time.LocalTime;
import java.time.OffsetDateTime;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

@Service
public class KpiAssessmentService {
    private static final ZoneId BUSINESS_ZONE = ZoneId.of("Asia/Shanghai");
    private static final UUID EMPTY_SCOPE = new UUID(0, 0);
    private static final String CALCULATION_VERSION = "kpi-deterministic-v1";

    private final NamedParameterJdbcTemplate jdbc;
    private final TenantDatabaseContext databaseContext;
    private final AccessPolicy accessPolicy;
    private final AuditWriter auditWriter;
    private final NotificationService notificationService;
    private final TaskService taskService;
    private final KpiScoringEngine scoringEngine;
    private final ObjectMapper objectMapper;

    public KpiAssessmentService(
            NamedParameterJdbcTemplate jdbc,
            TenantDatabaseContext databaseContext,
            AccessPolicy accessPolicy,
            AuditWriter auditWriter,
            NotificationService notificationService,
            TaskService taskService,
            KpiScoringEngine scoringEngine,
            ObjectMapper objectMapper
    ) {
        this.jdbc = jdbc;
        this.databaseContext = databaseContext;
        this.accessPolicy = accessPolicy;
        this.auditWriter = auditWriter;
        this.notificationService = notificationService;
        this.taskService = taskService;
        this.scoringEngine = scoringEngine;
        this.objectMapper = objectMapper;
    }

    @Transactional(readOnly = true)
    public List<Map<String, Object>> relations(UUID employeeId, String status) {
        accessPolicy.requireAnyPermission("kpi.relation.manage", "kpi.scorecard.read-all", "kpi.scorecard.read-team");
        TenantPrincipal principal = prepare();
        return jdbc.queryForList("""
                select r.id, r.employee_id, e.employee_no, e.name as employee_name,
                       r.position_assignment_id, p.code as position_code, p.name as position_name,
                       a.org_unit_id, o.name as org_name, r.template_id, t.code as template_code,
                       t.name as template_name, r.evaluator_assignment_id,
                       r.department_reviewer_assignment_id, r.valid_from, r.valid_to, r.status
                from kpi_assessment_relation r
                join employee e on e.tenant_id = r.tenant_id and e.id = r.employee_id
                join employee_position_assignment a on a.tenant_id = r.tenant_id and a.id = r.position_assignment_id
                join position_definition p on p.tenant_id = a.tenant_id and p.id = a.position_id
                join org_unit o on o.tenant_id = a.tenant_id and o.id = a.org_unit_id
                join kpi_template_definition t on t.tenant_id = r.tenant_id and t.id = r.template_id
                where r.tenant_id = :tenantId
                  and (cast(:employeeId as uuid) is null or r.employee_id = :employeeId)
                  and (cast(:status as varchar) is null or r.status = :status)
                  and (:tenantScope = true or exists (
                    select 1 from org_unit_closure c where c.tenant_id = r.tenant_id
                      and c.descendant_id = a.org_unit_id and c.ancestor_id in (:orgScopes)
                  ))
                order by e.name, r.valid_from desc
                """, scopeBase(principal).addValue("employeeId", employeeId)
                .addValue("status", blankToNull(status)));
    }

    @Transactional
    public Map<String, Object> createRelation(KpiModels.CreateRelation request) {
        accessPolicy.requirePermission("kpi.relation.manage");
        TenantPrincipal principal = prepare();
        Map<String, Object> assignment = assignment(principal, request.positionAssignmentId());
        if (!request.employeeId().equals(assignment.get("employee_id"))) {
            throw new IllegalArgumentException("任职不属于所选员工");
        }
        Map<String, Object> template = template(principal, request.templateId());
        UUID templatePosition = (UUID) template.get("position_id");
        if (templatePosition != null && !templatePosition.equals(assignment.get("position_id"))) {
            throw new IllegalArgumentException("员工任职岗位与KPI模板岗位不一致");
        }
        int overlap = jdbc.queryForObject("""
                select count(*) from kpi_assessment_relation
                where tenant_id = :tenantId and employee_id = :employeeId and status = 'ACTIVE'
                  and daterange(valid_from, coalesce(valid_to, 'infinity'::date), '[]')
                      && daterange(:validFrom, coalesce(cast(:validTo as date), 'infinity'::date), '[]')
                """, base(principal).addValue("employeeId", request.employeeId())
                .addValue("validFrom", request.validFrom()).addValue("validTo", request.validTo()), Integer.class);
        if (overlap > 0) throw conflict("同一员工同一考核周期只能绑定一个岗位KPI关系");
        if (request.evaluatorAssignmentId() != null
                && request.evaluatorAssignmentId().equals(request.positionAssignmentId())) {
            throw new IllegalArgumentException("员工不能评价自己");
        }
        UUID id = UUID.randomUUID();
        jdbc.update("""
                insert into kpi_assessment_relation
                    (id, tenant_id, employee_id, position_assignment_id, template_id,
                     evaluator_assignment_id, department_reviewer_assignment_id,
                     valid_from, valid_to, created_by)
                values (:id, :tenantId, :employeeId, :assignmentId, :templateId,
                        :evaluatorId, :reviewerId, :validFrom, :validTo, :actorId)
                """, base(principal).addValue("id", id).addValue("employeeId", request.employeeId())
                .addValue("assignmentId", request.positionAssignmentId()).addValue("templateId", request.templateId())
                .addValue("evaluatorId", request.evaluatorAssignmentId())
                .addValue("reviewerId", request.departmentReviewerAssignmentId())
                .addValue("validFrom", request.validFrom()).addValue("validTo", request.validTo())
                .addValue("actorId", principal.actorId()));
        if (request.scopes() != null) {
            for (KpiModels.ScopeInput scope : request.scopes()) {
                if (scope.orgUnitId() != null) accessPolicy.requireOrgScope(scope.orgUnitId());
                jdbc.update("""
                        insert into kpi_relation_scope
                            (id, tenant_id, relation_id, scope_type, org_unit_id, channel_code,
                             is_primary, valid_from, valid_to)
                        values (:id, :tenantId, :relationId, :scopeType, :orgUnitId, :channelCode,
                                :primary, :validFrom, :validTo)
                        """, base(principal).addValue("id", UUID.randomUUID()).addValue("relationId", id)
                        .addValue("scopeType", normalize(scope.scopeType(), "STORE"))
                        .addValue("orgUnitId", scope.orgUnitId()).addValue("channelCode", blankToNull(scope.channelCode()))
                        .addValue("primary", Boolean.TRUE.equals(scope.primary()))
                        .addValue("validFrom", scope.validFrom()).addValue("validTo", scope.validTo()));
            }
        }
        auditWriter.record("KPI_RELATION_CREATED", "KPI_ASSESSMENT_RELATION", id,
                json(Map.of("employeeId", request.employeeId(), "templateId", request.templateId())));
        return Map.of("id", id, "status", "ACTIVE");
    }

    @Transactional(readOnly = true)
    public List<Map<String, Object>> periods() {
        accessPolicy.requireAnyPermission("kpi.scorecard.read-own", "kpi.scorecard.read-team", "kpi.scorecard.read-all");
        TenantPrincipal principal = prepare();
        return jdbc.queryForList("""
                select p.id, p.month_start, p.status, p.draft_due_at, p.dispute_due_at,
                       p.confirmation_due_at, p.lock_due_at, p.locked_at, p.row_version,
                       count(c.id) as scorecard_count,
                       count(c.id) filter (where c.status = 'PENDING_VERIFICATION') as pending_count
                from kpi_period p
                left join kpi_scorecard c on c.tenant_id = p.tenant_id and c.period_id = p.id
                where p.tenant_id = :tenantId
                group by p.id order by p.month_start desc
                """, base(principal));
    }

    @Transactional
    public Map<String, Object> generate(KpiModels.GeneratePeriod request) {
        accessPolicy.requirePermission("kpi.scorecard.generate");
        TenantPrincipal principal = prepare();
        LocalDate month = month(request.monthStart());
        UUID periodId = ensurePeriod(principal, month);
        createResponsibilitySnapshots(principal, periodId, month);
        List<Map<String, Object>> snapshots = jdbc.queryForList("""
                select s.*, e.name as employee_name, a.org_unit_id, a.manager_assignment_id
                from kpi_responsibility_snapshot s
                join employee e on e.tenant_id = s.tenant_id and e.id = s.employee_id
                join employee_position_assignment a on a.tenant_id = s.tenant_id and a.id = s.position_assignment_id
                where s.tenant_id = :tenantId and s.period_id = :periodId
                order by e.name
                """, base(principal).addValue("periodId", periodId));
        String generationType = normalize(request.generationType(), "ALL");
        int generated = 0;
        int pending = 0;
        for (Map<String, Object> snapshot : snapshots) {
            List<CardWindow> windows = windows(month, generationType, request.weekNo());
            for (CardWindow window : windows) {
                Map<String, Object> card = ensureScorecard(principal, periodId, snapshot, window);
                KpiModels.ScoreResult result = calculateCard(principal, card, snapshot, request.reason());
                generated++;
                if (result.pendingManual() || result.pendingVerification()) pending++;
            }
        }
        jdbc.update("""
                update kpi_period set status = :status, row_version = row_version + 1
                where tenant_id = :tenantId and id = :periodId and status <> 'LOCKED'
                """, base(principal).addValue("periodId", periodId)
                .addValue("status", pending > 0 ? "DRAFT" : "DEPARTMENT_REVIEW"));
        auditWriter.record("KPI_PERIOD_GENERATED", "KPI_PERIOD", periodId,
                json(Map.of("generated", generated, "pending", pending, "generationType", generationType)));
        auditWriter.emit("KPI_PERIOD", periodId, "KpiPeriodGenerated",
                json(Map.of("periodId", periodId, "generated", generated, "pending", pending)));
        return Map.of("periodId", periodId, "monthStart", month, "generated", generated,
                "pending", pending, "status", pending > 0 ? "DRAFT" : "DEPARTMENT_REVIEW");
    }

    public Map<String, Object> generateAsSystem(KpiModels.GeneratePeriod request) {
        return generate(request);
    }

    @Transactional(readOnly = true)
    public List<Map<String, Object>> scorecards(UUID periodId, String cardType, String status) {
        accessPolicy.requireAnyPermission("kpi.scorecard.read-own", "kpi.scorecard.read-team", "kpi.scorecard.read-all");
        TenantPrincipal principal = prepare();
        return jdbc.queryForList("""
                select c.id, c.period_id, c.card_type, c.week_no, c.period_start, c.period_end,
                       c.status, c.current_revision_no, c.base_score, c.extra_score, c.final_score,
                       c.warning_level, c.generated_at, c.locked_at, c.row_version,
                       s.employee_id, e.employee_no, e.name as employee_name,
                       s.position_assignment_id, p.code as position_code, p.name as position_name,
                       a.org_unit_id, o.name as org_name
                from kpi_scorecard c
                join kpi_responsibility_snapshot s on s.tenant_id = c.tenant_id and s.id = c.responsibility_snapshot_id
                join employee e on e.tenant_id = s.tenant_id and e.id = s.employee_id
                join employee_position_assignment a on a.tenant_id = s.tenant_id and a.id = s.position_assignment_id
                join position_definition p on p.tenant_id = a.tenant_id and p.id = a.position_id
                join org_unit o on o.tenant_id = a.tenant_id and o.id = a.org_unit_id
                where c.tenant_id = :tenantId
                  and (cast(:periodId as uuid) is null or c.period_id = :periodId)
                  and (cast(:cardType as varchar) is null or c.card_type = :cardType)
                  and (cast(:status as varchar) is null or c.status = :status)
                  and (
                    :readAll = true
                    or s.position_assignment_id in (:assignmentIds)
                    or (:readTeam = true and (
                      s.evaluator_assignment_id in (:assignmentIds)
                      or exists (
                        select 1 from org_unit_closure closure
                        where closure.tenant_id = c.tenant_id and closure.descendant_id = a.org_unit_id
                          and closure.ancestor_id in (:orgScopes)
                      )
                    ))
                  )
                order by c.period_start desc, e.name
                """, visibilityBase(principal).addValue("periodId", periodId)
                .addValue("cardType", blankToNull(cardType) == null ? null : normalize(cardType, "MONTH"))
                .addValue("status", blankToNull(status)));
    }

    @Transactional(readOnly = true)
    public Map<String, Object> scorecard(UUID scorecardId) {
        accessPolicy.requireAnyPermission("kpi.scorecard.read-own", "kpi.scorecard.read-team", "kpi.scorecard.read-all");
        TenantPrincipal principal = prepare();
        requireVisible(principal, scorecardId);
        Map<String, Object> card = new LinkedHashMap<>(cardRow(principal, scorecardId));
        List<Map<String, Object>> revisions = jdbc.queryForList("""
                select id, revision_no, revision_type, calculation_version, data_cutoff_at,
                       data_state, base_score, extra_score, final_score, performance_coefficient,
                       original_bonus_base, bonus_adjustment, adjusted_bonus_base,
                       attendance_coefficient, payable_bonus, reason, created_at
                from kpi_scorecard_revision
                where tenant_id = :tenantId and scorecard_id = :id
                order by revision_no desc
                """, base(principal).addValue("id", scorecardId));
        card.put("revisions", revisions);
        if (!revisions.isEmpty()) {
            UUID revisionId = (UUID) revisions.getFirst().get("id");
            card.put("indicators", jdbc.queryForList("""
                    select r.id, r.indicator_rule_id, r.section_code, r.indicator_code,
                           i.name, r.target_value, r.actual_value, r.numerator, r.denominator,
                           r.score, r.max_score, r.min_score, r.data_state, r.outcome, r.details
                    from kpi_indicator_result r
                    join kpi_indicator_rule i on i.tenant_id = r.tenant_id and i.id = r.indicator_rule_id
                    where r.tenant_id = :tenantId and r.scorecard_revision_id = :revisionId
                    order by r.section_code, i.sort_order, r.indicator_code
                    """, base(principal).addValue("revisionId", revisionId)));
        }
        card.put("reviews", jdbc.queryForList("""
                select review_stage, decision, comment, reviewed_by, reviewed_at
                from kpi_review where tenant_id = :tenantId and scorecard_id = :id order by reviewed_at
                """, base(principal).addValue("id", scorecardId)));
        card.put("disputes", jdbc.queryForList("""
                select id, indicator_rule_id, reason, status, resolution, raised_by,
                       raised_at, resolved_by, resolved_at, row_version
                from kpi_dispute where tenant_id = :tenantId and scorecard_id = :id order by raised_at
                """, base(principal).addValue("id", scorecardId)));
        card.put("corrections", jdbc.queryForList("""
                select id, correction_type, reason, status, requested_by, approved_by,
                       replacement_revision_id, row_version, created_at, updated_at
                from kpi_correction where tenant_id = :tenantId and scorecard_id = :id order by created_at
                """, base(principal).addValue("id", scorecardId)));
        return card;
    }

    @Transactional
    public Map<String, Object> submitManualScore(UUID scorecardId, KpiModels.SubmitManualScore request) {
        accessPolicy.requirePermission("kpi.scorecard.manual-score");
        TenantPrincipal principal = prepare();
        requireVisible(principal, scorecardId);
        if (!principal.assignmentIds().contains(request.evaluatorAssignmentId()) && !principal.hasTenantScope()) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "评价任职不属于当前账号");
        }
        Map<String, Object> card = cardRow(principal, scorecardId);
        if ("LOCKED".equals(card.get("status"))) throw conflict("已锁定考核单只能走更正流程");
        if (request.evaluatorAssignmentId().equals(card.get("position_assignment_id"))) {
            throw new IllegalArgumentException("员工不能评价自己");
        }
        Map<String, Object> rule = jdbc.queryForMap("""
                select i.max_score, i.min_score, i.evidence_required, i.indicator_type
                from kpi_indicator_rule i
                join kpi_template_section s on s.tenant_id = i.tenant_id and s.id = i.section_id
                where i.tenant_id = :tenantId and i.id = :ruleId
                  and s.template_version_id = :templateVersionId
                """, base(principal).addValue("ruleId", request.indicatorRuleId())
                .addValue("templateVersionId", card.get("template_version_id")));
        if (!"MANUAL".equals(rule.get("indicator_type"))) throw new IllegalArgumentException("该指标不是人工评分指标");
        BigDecimal max = (BigDecimal) rule.get("max_score");
        BigDecimal min = rule.get("min_score") == null ? BigDecimal.ZERO : (BigDecimal) rule.get("min_score");
        if (request.score().compareTo(min) < 0 || request.score().compareTo(max) > 0) {
            throw new IllegalArgumentException("人工评分必须在" + min + "至" + max + "之间");
        }
        if (Boolean.TRUE.equals(rule.get("evidence_required")) && blankToNull(request.evidenceReference()) == null) {
            throw new IllegalArgumentException("该人工指标必须提交评分证据");
        }
        UUID id = UUID.randomUUID();
        String hash = KpiHashing.sha256(scorecardId + "|" + request.indicatorRuleId() + "|"
                + request.score() + "|" + request.explanation() + "|" + request.evidenceReference());
        jdbc.update("""
                insert into kpi_manual_score
                    (id, tenant_id, scorecard_id, indicator_rule_id, score, explanation,
                     evaluator_assignment_id, supersedes_manual_score_id, content_hash)
                values (:id, :tenantId, :scorecardId, :ruleId, :score, :explanation,
                        :evaluatorId, :supersedesId, :hash)
                """, base(principal).addValue("id", id).addValue("scorecardId", scorecardId)
                .addValue("ruleId", request.indicatorRuleId()).addValue("score", request.score())
                .addValue("explanation", request.explanation()).addValue("evaluatorId", request.evaluatorAssignmentId())
                .addValue("supersedesId", request.supersedesManualScoreId()).addValue("hash", hash));
        if (blankToNull(request.evidenceReference()) != null) {
            jdbc.update("""
                    insert into kpi_evidence
                        (id, tenant_id, scorecard_id, indicator_rule_id, evidence_type,
                         reference_text, evidence_snapshot, content_hash, created_by)
                    values (:id, :tenantId, :scorecardId, :ruleId, 'EXTERNAL_REFERENCE',
                            :reference, '{}'::jsonb, :hash, :actorId)
                    """, base(principal).addValue("id", UUID.randomUUID()).addValue("scorecardId", scorecardId)
                    .addValue("ruleId", request.indicatorRuleId()).addValue("reference", request.evidenceReference())
                    .addValue("hash", KpiHashing.sha256(request.evidenceReference()))
                    .addValue("actorId", principal.actorId()));
        }
        Map<String, Object> snapshot = snapshotRow(principal, (UUID) card.get("responsibility_snapshot_id"));
        calculateCard(principal, card, snapshot, "人工评分提交后重新计算");
        auditWriter.record("KPI_MANUAL_SCORE_SUBMITTED", "KPI_MANUAL_SCORE", id,
                json(Map.of("scorecardId", scorecardId, "indicatorRuleId", request.indicatorRuleId(),
                        "score", request.score())));
        return Map.of("id", id, "scorecardId", scorecardId, "score", request.score());
    }

    @Transactional
    public Map<String, Object> reviewScorecard(UUID scorecardId, KpiModels.ScorecardReview request) {
        accessPolicy.requirePermission("kpi.scorecard.review");
        TenantPrincipal principal = prepare();
        requireVisible(principal, scorecardId);
        Map<String, Object> card = cardRow(principal, scorecardId);
        if (((Number) card.get("row_version")).longValue() != request.expectedVersion()) throw conflict("考核单已变化");
        String stage = normalize(request.stage(), "DEPARTMENT");
        String decision = normalize(request.decision(), "APPROVED");
        if ("CEO".equals(stage) && !principal.hasRole("CEO") && !principal.hasPermission("kpi.scorecard.lock")) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "只有CEO可以完成CEO复核");
        }
        UUID id = UUID.randomUUID();
        jdbc.update("""
                insert into kpi_review
                    (id, tenant_id, scorecard_id, review_stage, decision, comment, reviewed_by)
                values (:id, :tenantId, :scorecardId, :stage, :decision, :comment, :actorId)
                """, base(principal).addValue("id", id).addValue("scorecardId", scorecardId)
                .addValue("stage", stage).addValue("decision", decision).addValue("comment", request.comment())
                .addValue("actorId", principal.actorId()));
        String nextStatus = nextReviewStatus(stage, decision);
        jdbc.update("""
                update kpi_scorecard set status = :status, row_version = row_version + 1
                where tenant_id = :tenantId and id = :id and row_version = :expectedVersion
                """, base(principal).addValue("id", scorecardId).addValue("status", nextStatus)
                .addValue("expectedVersion", request.expectedVersion()));
        auditWriter.record("KPI_SCORECARD_REVIEWED", "KPI_SCORECARD", scorecardId,
                json(Map.of("stage", stage, "decision", decision)));
        return Map.of("id", scorecardId, "status", nextStatus, "rowVersion", request.expectedVersion() + 1);
    }

    @Transactional
    public Map<String, Object> createDispute(UUID scorecardId, KpiModels.CreateDispute request) {
        accessPolicy.requirePermission("kpi.scorecard.dispute");
        TenantPrincipal principal = prepare();
        requireVisible(principal, scorecardId);
        Map<String, Object> card = cardRow(principal, scorecardId);
        if ("LOCKED".equals(card.get("status"))) throw conflict("锁定结果请发起更正申请");
        UUID id = UUID.randomUUID();
        jdbc.update("""
                insert into kpi_dispute
                    (id, tenant_id, scorecard_id, indicator_rule_id, reason, raised_by)
                values (:id, :tenantId, :scorecardId, :ruleId, :reason, :actorId)
                """, base(principal).addValue("id", id).addValue("scorecardId", scorecardId)
                .addValue("ruleId", request.indicatorRuleId()).addValue("reason", request.reason())
                .addValue("actorId", principal.actorId()));
        jdbc.update("""
                update kpi_scorecard set status = 'DISPUTE', row_version = row_version + 1
                where tenant_id = :tenantId and id = :id
                """, base(principal).addValue("id", scorecardId));
        notifyParticipants(principal, card, "KPI考核异议待处理", "员工已提交KPI异议，请在后台核验。", "KPI_DISPUTE", id);
        auditWriter.record("KPI_DISPUTE_CREATED", "KPI_DISPUTE", id, json(Map.of("scorecardId", scorecardId)));
        return Map.of("id", id, "status", "OPEN");
    }

    @Transactional
    public Map<String, Object> resolveDispute(UUID disputeId, KpiModels.ResolveDispute request) {
        accessPolicy.requirePermission("kpi.scorecard.review");
        TenantPrincipal principal = prepare();
        Map<String, Object> dispute = jdbc.queryForMap("""
                select id, scorecard_id, indicator_rule_id, reason, status, row_version
                from kpi_dispute where tenant_id = :tenantId and id = :id
                """, base(principal).addValue("id", disputeId));
        String decision = normalize(request.decision(), "REJECTED");
        String status = "APPROVED".equals(decision) || "ACCEPTED".equals(decision) ? "ACCEPTED" : "REJECTED";
        int updated = jdbc.update("""
                update kpi_dispute
                set status = :status, resolution = :resolution, resolved_by = :actorId,
                    resolved_at = now(), row_version = row_version + 1
                where tenant_id = :tenantId and id = :id and row_version = :expectedVersion and status in ('OPEN', 'VERIFYING')
                """, base(principal).addValue("id", disputeId).addValue("status", status)
                .addValue("resolution", request.resolution()).addValue("actorId", principal.actorId())
                .addValue("expectedVersion", request.expectedVersion()));
        if (updated != 1) throw conflict("异议已变化或已处理");
        UUID scorecardId = (UUID) dispute.get("scorecard_id");
        if ("ACCEPTED".equals(status)) {
            UUID correctionId = UUID.randomUUID();
            jdbc.update("""
                    insert into kpi_correction
                        (id, tenant_id, scorecard_id, correction_type, reason, requested_by)
                    values (:id, :tenantId, :scorecardId, 'DATA', :reason, :actorId)
                    """, base(principal).addValue("id", correctionId).addValue("scorecardId", scorecardId)
                    .addValue("reason", "异议受理：" + request.resolution()).addValue("actorId", principal.actorId()));
            jdbc.update("""
                    update kpi_scorecard set status = 'PENDING_VERIFICATION', row_version = row_version + 1
                    where tenant_id = :tenantId and id = :id
                    """, base(principal).addValue("id", scorecardId));
        } else {
            jdbc.update("""
                    update kpi_scorecard set status = 'HR_REVIEW', row_version = row_version + 1
                    where tenant_id = :tenantId and id = :id and status = 'DISPUTE'
                    """, base(principal).addValue("id", scorecardId));
        }
        auditWriter.record("KPI_DISPUTE_RESOLVED", "KPI_DISPUTE", disputeId,
                json(Map.of("decision", decision)));
        return Map.of("id", disputeId, "status", status, "rowVersion", request.expectedVersion() + 1);
    }

    @Transactional(readOnly = true)
    public List<Map<String, Object>> corrections(UUID scorecardId, String status) {
        accessPolicy.requireAnyPermission("kpi.scorecard.review", "kpi.scorecard.read-all", "kpi.scorecard.read-team");
        TenantPrincipal principal = prepare();
        return jdbc.queryForList("""
                select correction.*, employee.employee_no, employee.name as employee_name,
                       card.card_type, card.week_no, period.month_start
                from kpi_correction correction
                join kpi_scorecard card on card.tenant_id = correction.tenant_id and card.id = correction.scorecard_id
                join kpi_responsibility_snapshot snapshot on snapshot.tenant_id = card.tenant_id
                  and snapshot.id = card.responsibility_snapshot_id
                join employee on employee.tenant_id = snapshot.tenant_id and employee.id = snapshot.employee_id
                join kpi_period period on period.tenant_id = card.tenant_id and period.id = card.period_id
                where correction.tenant_id = :tenantId
                  and (cast(:scorecardId as uuid) is null or correction.scorecard_id = :scorecardId)
                  and (:status = '' or correction.status = :status)
                order by correction.created_at desc
                """, base(principal).addValue("scorecardId", scorecardId)
                .addValue("status", normalize(status, "")));
    }

    @Transactional
    public Map<String, Object> createCorrection(UUID scorecardId, KpiModels.CreateCorrection request) {
        accessPolicy.requireAnyPermission("kpi.scorecard.review", "kpi.scorecard.lock");
        TenantPrincipal principal = prepare();
        requireVisible(principal, scorecardId);
        String type = normalize(request.correctionType(), "DATA");
        if (!Set.of("DATA", "MANUAL_SCORE", "TEMPLATE_EXCEPTION", "LOCKED_RESULT").contains(type)) {
            throw new IllegalArgumentException("不支持的更正类型：" + type);
        }
        Map<String, Object> card = cardRow(principal, scorecardId);
        if ("LOCKED".equals(card.get("status")) && !principal.hasPermission("kpi.scorecard.lock")) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "锁定结果的更正申请需要CEO权限");
        }
        UUID id = UUID.randomUUID();
        jdbc.update("""
                insert into kpi_correction
                    (id, tenant_id, scorecard_id, correction_type, reason, requested_by)
                values (:id, :tenantId, :scorecardId, :type, :reason, :actorId)
                """, base(principal).addValue("id", id).addValue("scorecardId", scorecardId)
                .addValue("type", type).addValue("reason", request.reason()).addValue("actorId", principal.actorId()));
        auditWriter.record("KPI_CORRECTION_REQUESTED", "KPI_CORRECTION", id,
                json(Map.of("scorecardId", scorecardId, "correctionType", type, "reason", request.reason())));
        return Map.of("id", id, "scorecardId", scorecardId, "status", "REQUESTED", "rowVersion", 0);
    }

    @Transactional
    public Map<String, Object> resolveCorrection(UUID correctionId, KpiModels.ResolveCorrection request) {
        accessPolicy.requireAnyPermission("kpi.scorecard.review", "kpi.scorecard.lock");
        TenantPrincipal principal = prepare();
        Map<String, Object> correction = jdbc.queryForMap("""
                select * from kpi_correction where tenant_id = :tenantId and id = :id
                """, base(principal).addValue("id", correctionId));
        if (((Number) correction.get("row_version")).longValue() != request.expectedVersion()
                || !"REQUESTED".equals(correction.get("status"))) {
            throw conflict("更正申请已变化或已处理");
        }
        UUID scorecardId = (UUID) correction.get("scorecard_id");
        Map<String, Object> card = cardRow(principal, scorecardId);
        boolean locked = "LOCKED".equals(card.get("status")) || "CORRECTED".equals(card.get("status"));
        if (locked && !principal.hasPermission("kpi.scorecard.lock")) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "锁定结果只能由CEO批准更正");
        }
        String decision = normalize(request.decision(), "REJECTED");
        if (!Set.of("APPROVED", "REJECTED").contains(decision)) {
            throw new IllegalArgumentException("更正决定只能为APPROVED或REJECTED");
        }
        UUID replacementRevisionId = null;
        String finalStatus = decision;
        if ("APPROVED".equals(decision)) {
            Map<String, Object> snapshot = snapshotRow(principal, (UUID) card.get("responsibility_snapshot_id"));
            calculateCard(principal, card, snapshot,
                    "LOCKED_RESULT".equals(correction.get("correction_type")) ? "LOCK_CORRECTION" : "DISPUTE_CORRECTION");
            replacementRevisionId = jdbc.queryForObject("""
                    select id from kpi_scorecard_revision
                    where tenant_id = :tenantId and scorecard_id = :scorecardId
                    order by revision_no desc limit 1
                    """, base(principal).addValue("scorecardId", scorecardId), UUID.class);
            jdbc.update("""
                    update kpi_scorecard set status = 'CORRECTED', row_version = row_version + 1
                    where tenant_id = :tenantId and id = :id
                    """, base(principal).addValue("id", scorecardId));
            finalStatus = "APPLIED";
            Map<String, Object> period = jdbc.queryForMap("""
                    select id, month_start, status from kpi_period where tenant_id = :tenantId and id = :id
                    """, base(principal).addValue("id", card.get("period_id")));
            if ("MONTH".equals(card.get("card_type")) && "LOCKED".equals(period.get("status"))) {
                generateSettlements(principal, (UUID) period.get("id"), localDate(period.get("month_start")));
                jdbc.update("""
                        update kpi_settlement set status = 'LOCKED', locked_by = :actorId,
                            locked_at = coalesce(locked_at, now()), updated_at = now()
                        where tenant_id = :tenantId and period_id = :periodId
                        """, base(principal).addValue("periodId", period.get("id")).addValue("actorId", principal.actorId()));
            }
        }
        int updated = jdbc.update("""
                update kpi_correction
                set status = :status, approved_by = :actorId, replacement_revision_id = :revisionId,
                    row_version = row_version + 1, updated_at = now()
                where tenant_id = :tenantId and id = :id and row_version = :expectedVersion and status = 'REQUESTED'
                """, base(principal).addValue("id", correctionId).addValue("status", finalStatus)
                .addValue("actorId", principal.actorId()).addValue("revisionId", replacementRevisionId)
                .addValue("expectedVersion", request.expectedVersion()));
        if (updated != 1) throw conflict("更正申请已变化或已处理");
        auditWriter.record("KPI_CORRECTION_RESOLVED", "KPI_CORRECTION", correctionId,
                json(Map.of("decision", decision, "resolution", request.resolution(),
                        "replacementRevisionId", replacementRevisionId == null ? "" : replacementRevisionId.toString())));
        return Map.of("id", correctionId, "status", finalStatus,
                "replacementRevisionId", replacementRevisionId == null ? "" : replacementRevisionId,
                "rowVersion", request.expectedVersion() + 1);
    }

    @Transactional
    public Map<String, Object> setBonusBase(KpiModels.SetBonusBase request) {
        accessPolicy.requirePermission("kpi.settlement.manage");
        TenantPrincipal principal = prepare();
        LocalDate effective = month(request.effectiveMonth());
        List<UUID> prior = jdbc.query("""
                select id from kpi_employee_bonus_base
                where tenant_id = :tenantId and employee_id = :employeeId
                  and effective_month <= :effectiveMonth
                  and (expires_month is null or expires_month >= :effectiveMonth)
                  and not exists (
                    select 1 from kpi_employee_bonus_base newer
                    where newer.tenant_id = kpi_employee_bonus_base.tenant_id
                      and newer.supersedes_bonus_base_id = kpi_employee_bonus_base.id
                  )
                order by effective_month desc, created_at desc limit 1
                """, base(principal).addValue("employeeId", request.employeeId())
                .addValue("effectiveMonth", effective), (rs, rowNum) -> rs.getObject("id", UUID.class));
        UUID id = UUID.randomUUID();
        UUID supersedes = prior.isEmpty() ? null : prior.getFirst();
        String hash = KpiHashing.sha256(request.employeeId() + "|" + effective + "|" + request.amount() + "|" + request.reason());
        jdbc.update("""
                insert into kpi_employee_bonus_base
                    (id, tenant_id, employee_id, effective_month, expires_month, amount,
                     reason, content_hash, supersedes_bonus_base_id, created_by)
                values (:id, :tenantId, :employeeId, :effectiveMonth, :expiresMonth, :amount,
                        :reason, :hash, :supersedesId, :actorId)
                """, base(principal).addValue("id", id).addValue("employeeId", request.employeeId())
                .addValue("effectiveMonth", effective).addValue("expiresMonth", month(request.expiresMonth()))
                .addValue("amount", request.amount()).addValue("reason", request.reason())
                .addValue("hash", hash).addValue("supersedesId", supersedes).addValue("actorId", principal.actorId()));
        auditWriter.record("KPI_BONUS_BASE_SET", "KPI_EMPLOYEE_BONUS_BASE", id,
                json(Map.of("employeeId", request.employeeId(), "effectiveMonth", effective,
                        "amount", request.amount())));
        return Map.of("id", id, "employeeId", request.employeeId(), "effectiveMonth", effective,
                "amount", request.amount());
    }

    @Transactional
    public Map<String, Object> lockPeriod(UUID periodId, KpiModels.LockPeriod request) {
        accessPolicy.requirePermission("kpi.scorecard.lock");
        TenantPrincipal principal = prepare();
        Map<String, Object> period = jdbc.queryForMap("""
                select * from kpi_period where tenant_id = :tenantId and id = :id
                """, base(principal).addValue("id", periodId));
        if (((Number) period.get("row_version")).longValue() != request.expectedVersion()) throw conflict("考核周期已变化");
        int pending = jdbc.queryForObject("""
                select count(*) from kpi_scorecard
                where tenant_id = :tenantId and period_id = :periodId and card_type = 'MONTH'
                  and status in ('DRAFT', 'PENDING_MANUAL', 'PENDING_VERIFICATION', 'DISPUTE')
                """, base(principal).addValue("periodId", periodId), Integer.class);
        int openDisputes = jdbc.queryForObject("""
                select count(*) from kpi_dispute d join kpi_scorecard c
                  on c.tenant_id = d.tenant_id and c.id = d.scorecard_id
                where d.tenant_id = :tenantId and c.period_id = :periodId
                  and d.status in ('OPEN', 'VERIFYING')
                """, base(principal).addValue("periodId", periodId), Integer.class);
        if (pending > 0 || openDisputes > 0) throw conflict("存在待评分、待核验或未关闭异议，不能锁定");
        int incompleteReviews = jdbc.queryForObject("""
                select count(*) from kpi_scorecard c
                where c.tenant_id = :tenantId and c.period_id = :periodId and c.card_type = 'MONTH'
                  and not exists (
                    select 1 from kpi_review r where r.tenant_id = c.tenant_id and r.scorecard_id = c.id
                      and r.review_stage = 'CEO' and r.decision = 'APPROVED'
                  )
                """, base(principal).addValue("periodId", periodId), Integer.class);
        if (incompleteReviews > 0) throw conflict("所有月度考核单必须完成CEO确认后才能锁定");
        generateSettlements(principal, periodId, localDate(period.get("month_start")));
        jdbc.update("""
                update kpi_scorecard set status = 'LOCKED', locked_by = :actorId, locked_at = now(),
                    row_version = row_version + 1
                where tenant_id = :tenantId and period_id = :periodId
                """, base(principal).addValue("periodId", periodId).addValue("actorId", principal.actorId()));
        jdbc.update("""
                update kpi_settlement set status = 'LOCKED', locked_by = :actorId, locked_at = now(), updated_at = now()
                where tenant_id = :tenantId and period_id = :periodId
                """, base(principal).addValue("periodId", periodId).addValue("actorId", principal.actorId()));
        jdbc.update("""
                update kpi_period set status = 'LOCKED', locked_by = :actorId, locked_at = now(),
                    row_version = row_version + 1
                where tenant_id = :tenantId and id = :periodId and row_version = :expectedVersion
                """, base(principal).addValue("periodId", periodId).addValue("actorId", principal.actorId())
                .addValue("expectedVersion", request.expectedVersion()));
        auditWriter.record("KPI_PERIOD_LOCKED", "KPI_PERIOD", periodId,
                json(Map.of("comment", request.comment() == null ? "" : request.comment())));
        auditWriter.emit("KPI_PERIOD", periodId, "KpiPeriodLocked", json(Map.of("periodId", periodId)));
        return Map.of("id", periodId, "status", "LOCKED", "rowVersion", request.expectedVersion() + 1);
    }

    @Transactional(readOnly = true)
    public List<Map<String, Object>> settlements(UUID periodId) {
        accessPolicy.requirePermission("kpi.settlement.read");
        TenantPrincipal principal = prepare();
        return jdbc.queryForList("""
                select s.*, e.employee_no, e.name as employee_name, c.final_score
                from kpi_settlement s
                join employee e on e.tenant_id = s.tenant_id and e.id = s.employee_id
                join kpi_scorecard c on c.tenant_id = s.tenant_id and c.id = s.scorecard_id
                where s.tenant_id = :tenantId and (cast(:periodId as uuid) is null or s.period_id = :periodId)
                order by e.name
                """, base(principal).addValue("periodId", periodId));
    }

    private UUID ensurePeriod(TenantPrincipal principal, LocalDate month) {
        OffsetDateTime draft = at(month.plusMonths(1), 12, 0);
        OffsetDateTime dispute = at(month.plusMonths(1).plusDays(1), 18, 0);
        OffsetDateTime confirmation = at(month.plusMonths(1).plusDays(2), 23, 59);
        OffsetDateTime lock = at(month.plusMonths(1).plusDays(3), 23, 59);
        UUID candidate = UUID.randomUUID();
        jdbc.update("""
                insert into kpi_period
                    (id, tenant_id, month_start, draft_due_at, dispute_due_at,
                     confirmation_due_at, lock_due_at, created_by)
                values (:id, :tenantId, :monthStart, :draftDueAt, :disputeDueAt,
                        :confirmationDueAt, :lockDueAt, :actorId)
                on conflict (tenant_id, month_start) do nothing
                """, base(principal).addValue("id", candidate).addValue("monthStart", month)
                .addValue("draftDueAt", draft).addValue("disputeDueAt", dispute)
                .addValue("confirmationDueAt", confirmation).addValue("lockDueAt", lock)
                .addValue("actorId", principal.actorId()));
        return jdbc.queryForObject("""
                select id from kpi_period where tenant_id = :tenantId and month_start = :monthStart
                """, base(principal).addValue("monthStart", month), UUID.class);
    }

    private void createResponsibilitySnapshots(TenantPrincipal principal, UUID periodId, LocalDate month) {
        LocalDate monthEnd = month.plusMonths(1).minusDays(1);
        List<Map<String, Object>> relations = jdbc.queryForList("""
                select r.*, a.position_id, a.org_unit_id, e.name as employee_name,
                       p.code as position_code, p.name as position_name
                from kpi_assessment_relation r
                join employee_position_assignment a on a.tenant_id = r.tenant_id and a.id = r.position_assignment_id
                join employee e on e.tenant_id = r.tenant_id and e.id = r.employee_id
                join position_definition p on p.tenant_id = a.tenant_id and p.id = a.position_id
                where r.tenant_id = :tenantId and r.status = 'ACTIVE'
                  and r.valid_from <= :monthEnd and (r.valid_to is null or r.valid_to >= :monthStart)
                order by r.employee_id, r.valid_from desc
                """, base(principal).addValue("monthStart", month).addValue("monthEnd", monthEnd));
        Set<UUID> employees = new LinkedHashSet<>();
        for (Map<String, Object> relation : relations) {
            UUID employeeId = (UUID) relation.get("employee_id");
            if (!employees.add(employeeId)) throw conflict("员工" + relation.get("employee_name") + "当月存在多套KPI关系");
            UUID templateVersionId = resolveTemplateVersion(principal, relation, month);
            List<Map<String, Object>> scopes = relationScopes(principal, (UUID) relation.get("id"), month, monthEnd);
            ObjectNode snapshot = JsonNodeFactory.instance.objectNode();
            snapshot.put("employeeName", String.valueOf(relation.get("employee_name")));
            snapshot.put("positionCode", String.valueOf(relation.get("position_code")));
            snapshot.put("positionName", String.valueOf(relation.get("position_name")));
            snapshot.put("assignmentOrgUnitId", String.valueOf(relation.get("org_unit_id")));
            snapshot.set("scopes", objectMapper.valueToTree(scopes));
            String snapshotJson = json(snapshot);
            jdbc.update("""
                    insert into kpi_responsibility_snapshot
                        (id, tenant_id, period_id, relation_id, employee_id, position_assignment_id,
                         template_version_id, evaluator_assignment_id, responsibility_snapshot, content_hash)
                    values (:id, :tenantId, :periodId, :relationId, :employeeId, :assignmentId,
                            :templateVersionId, :evaluatorId, cast(:snapshot as jsonb), :hash)
                    on conflict (tenant_id, period_id, employee_id) do nothing
                    """, base(principal).addValue("id", UUID.randomUUID()).addValue("periodId", periodId)
                    .addValue("relationId", relation.get("id")).addValue("employeeId", employeeId)
                    .addValue("assignmentId", relation.get("position_assignment_id"))
                    .addValue("templateVersionId", templateVersionId)
                    .addValue("evaluatorId", relation.get("evaluator_assignment_id"))
                    .addValue("snapshot", snapshotJson).addValue("hash", KpiHashing.sha256(snapshotJson)));
        }
    }

    private UUID resolveTemplateVersion(TenantPrincipal principal, Map<String, Object> relation, LocalDate month) {
        List<Map<String, Object>> scopes = relationScopes(principal, (UUID) relation.get("id"), month, month.plusMonths(1).minusDays(1));
        List<UUID> orgIds = scopes.stream().map(row -> (UUID) row.get("org_unit_id")).filter(java.util.Objects::nonNull).toList();
        MapSqlParameterSource parameters = base(principal)
                .addValue("positionId", relation.get("position_id"))
                .addValue("monthStart", month)
                .addValue("orgIds", orgIds.isEmpty() ? List.of(EMPTY_SCOPE) : orgIds);
        List<UUID> bound = jdbc.query("""
                select b.template_version_id
                from kpi_template_binding b
                join kpi_template_version v on v.tenant_id = b.tenant_id and v.id = b.template_version_id
                join standard_version sv on sv.tenant_id = v.tenant_id and sv.id = v.standard_version_id
                where b.tenant_id = :tenantId and sv.lifecycle_status = 'PUBLISHED'
                  and b.effective_month <= :monthStart and (b.expires_month is null or b.expires_month >= :monthStart)
                  and (b.position_id is null or b.position_id = :positionId)
                  and (b.org_unit_id is null or b.org_unit_id in (:orgIds))
                order by case b.binding_level when 'STORE' then 3 when 'POSITION' then 2 else 1 end desc,
                         b.priority desc, v.version_no desc
                limit 1
                """, parameters, (rs, rowNum) -> rs.getObject(1, UUID.class));
        if (!bound.isEmpty()) return bound.getFirst();
        List<UUID> direct = jdbc.query("""
                select v.id from kpi_template_version v
                join standard_version sv on sv.tenant_id = v.tenant_id and sv.id = v.standard_version_id
                where v.tenant_id = :tenantId and v.template_id = :templateId
                  and sv.lifecycle_status = 'PUBLISHED'
                  and (v.effective_month is null or v.effective_month <= :monthStart)
                  and (v.expires_month is null or v.expires_month >= :monthStart)
                order by v.version_no desc limit 1
                """, base(principal).addValue("templateId", relation.get("template_id"))
                .addValue("monthStart", month), (rs, rowNum) -> rs.getObject(1, UUID.class));
        if (direct.isEmpty()) throw conflict("员工" + relation.get("employee_name") + "没有当月已发布KPI模板");
        return direct.getFirst();
    }

    private Map<String, Object> ensureScorecard(
            TenantPrincipal principal,
            UUID periodId,
            Map<String, Object> snapshot,
            CardWindow window
    ) {
        UUID candidate = UUID.randomUUID();
        jdbc.update("""
                insert into kpi_scorecard
                    (id, tenant_id, period_id, responsibility_snapshot_id, card_type, week_no,
                     period_start, period_end)
                values (:id, :tenantId, :periodId, :snapshotId, :cardType, :weekNo,
                        :periodStart, :periodEnd)
                on conflict (tenant_id, responsibility_snapshot_id, card_type, week_no) do nothing
                """, base(principal).addValue("id", candidate).addValue("periodId", periodId)
                .addValue("snapshotId", snapshot.get("id")).addValue("cardType", window.cardType())
                .addValue("weekNo", window.weekNo()).addValue("periodStart", window.start())
                .addValue("periodEnd", window.end()));
        return jdbc.queryForMap("""
                select c.*, s.employee_id, s.position_assignment_id, s.template_version_id,
                       s.evaluator_assignment_id, s.responsibility_snapshot,
                       r.department_reviewer_assignment_id, a.org_unit_id, a.manager_assignment_id
                from kpi_scorecard c
                join kpi_responsibility_snapshot s on s.tenant_id = c.tenant_id and s.id = c.responsibility_snapshot_id
                join kpi_assessment_relation r on r.tenant_id = s.tenant_id and r.id = s.relation_id
                join employee_position_assignment a on a.tenant_id = s.tenant_id and a.id = s.position_assignment_id
                where c.tenant_id = :tenantId and c.responsibility_snapshot_id = :snapshotId
                  and c.card_type = :cardType
                  and ((:weekNo is null and c.week_no is null) or c.week_no = :weekNo)
                """, base(principal).addValue("snapshotId", snapshot.get("id"))
                .addValue("cardType", window.cardType()).addValue("weekNo", window.weekNo()));
    }

    private KpiModels.ScoreResult calculateCard(
            TenantPrincipal principal,
            Map<String, Object> card,
            Map<String, Object> snapshot,
            String reason
    ) {
        UUID scorecardId = (UUID) card.get("id");
        UUID templateVersionId = (UUID) card.get("template_version_id");
        List<KpiModels.TemplateRule> rules = templateRules(principal, templateVersionId);
        List<Map<String, Object>> scopes = relationScopes(principal, (UUID) snapshot.get("relation_id"),
                localDate(card.get("period_start")), localDate(card.get("period_end")));
        Map<UUID, KpiModels.MetricAggregate> aggregates = new HashMap<>();
        for (KpiModels.TemplateRule rule : rules) {
            if (rule.metricVersionId() != null && !aggregates.containsKey(rule.metricVersionId())) {
                aggregates.put(rule.metricVersionId(), aggregate(principal, rule.metricVersionId(),
                        (UUID) card.get("employee_id"), (UUID) card.get("position_assignment_id"),
                        localDate(card.get("period_start")), localDate(card.get("period_end")), scopes));
            }
        }
        Map<UUID, BigDecimal> manualScores = latestManualScores(principal, scorecardId);
        boolean weekly = "WEEK".equals(card.get("card_type"));
        Integer weekNo = card.get("week_no") == null ? null : ((Number) card.get("week_no")).intValue();
        KpiModels.ScoreResult result = scoringEngine.score(rules, aggregates, manualScores, weekly, weekNo);
        int revisionNo = ((Number) card.get("current_revision_no")).intValue() + 1;
        String dataState = result.pendingVerification() ? "PENDING_VERIFICATION"
                : (result.pendingManual() ? "PENDING_MANUAL" : "AVAILABLE");
        String status = result.pendingVerification() ? "PENDING_VERIFICATION"
                : (result.pendingManual() ? "PENDING_MANUAL" : "DEPARTMENT_REVIEW");
        ObjectNode calculation = JsonNodeFactory.instance.objectNode();
        calculation.put("calculationVersion", CALCULATION_VERSION);
        calculation.put("weekly", weekly);
        if (weekNo != null) calculation.put("weekNo", weekNo);
        calculation.set("indicators", objectMapper.valueToTree(result.indicators()));
        String calculationJson = json(calculation);
        UUID revisionId = UUID.randomUUID();
        jdbc.update("""
                insert into kpi_scorecard_revision
                    (id, tenant_id, scorecard_id, revision_no, revision_type, calculation_version,
                     data_cutoff_at, data_state, base_score, extra_score, final_score,
                     calculation_snapshot, content_hash, reason, created_by)
                values (:id, :tenantId, :scorecardId, :revisionNo, :revisionType, :calculationVersion,
                        now(), :dataState, :baseScore, :extraScore, :finalScore,
                        cast(:snapshot as jsonb), :hash, :reason, :actorId)
                """, base(principal).addValue("id", revisionId).addValue("scorecardId", scorecardId)
                .addValue("revisionNo", revisionNo).addValue("revisionType", revisionNo == 1 ? "CALCULATION" : "LATE_DATA")
                .addValue("calculationVersion", CALCULATION_VERSION).addValue("dataState", dataState)
                .addValue("baseScore", result.baseScore()).addValue("extraScore", result.extraScore())
                .addValue("finalScore", result.finalScore()).addValue("snapshot", calculationJson)
                .addValue("hash", KpiHashing.sha256(calculationJson)).addValue("reason", reason)
                .addValue("actorId", principal.actorId()));
        for (KpiModels.IndicatorScore item : result.indicators()) {
            jdbc.update("""
                    insert into kpi_indicator_result
                        (id, tenant_id, scorecard_revision_id, indicator_rule_id, section_code,
                         indicator_code, target_value, actual_value, numerator, denominator,
                         score, max_score, min_score, data_state, outcome, details)
                    values (:id, :tenantId, :revisionId, :ruleId, :sectionCode,
                            :indicatorCode, :targetValue, :actualValue, :numerator, :denominator,
                            :score, :maxScore, :minScore, :dataState, :outcome, cast(:details as jsonb))
                    """, base(principal).addValue("id", UUID.randomUUID()).addValue("revisionId", revisionId)
                    .addValue("ruleId", item.ruleId()).addValue("sectionCode", item.sectionCode())
                    .addValue("indicatorCode", item.indicatorCode()).addValue("targetValue", item.targetValue())
                    .addValue("actualValue", item.actualValue()).addValue("numerator", item.numerator())
                    .addValue("denominator", item.denominator()).addValue("score", item.score())
                    .addValue("maxScore", item.maxScore()).addValue("minScore", item.minScore())
                    .addValue("dataState", item.dataState()).addValue("outcome", item.outcome())
                    .addValue("details", json(item.details())));
        }
        String warning = weekly ? warningLevel(principal, scorecardId, weekNo, result.indicators()) : "NONE";
        jdbc.update("""
                update kpi_scorecard
                set status = :status, current_revision_no = :revisionNo, base_score = :baseScore,
                    extra_score = :extraScore, final_score = :finalScore, warning_level = :warning,
                    generated_at = now(), row_version = row_version + 1
                where tenant_id = :tenantId and id = :id
                """, base(principal).addValue("id", scorecardId).addValue("status", status)
                .addValue("revisionNo", revisionNo).addValue("baseScore", result.baseScore())
                .addValue("extraScore", result.extraScore()).addValue("finalScore", result.finalScore())
                .addValue("warning", warning));
        card.put("status", status);
        card.put("current_revision_no", revisionNo);
        notifyScorecard(principal, card, revisionId, warning);
        if ("ORANGE".equals(warning) || "RED".equals(warning)) {
            createImprovementTasks(card, result.indicators(), revisionId);
        }
        return result;
    }

    private List<KpiModels.TemplateRule> templateRules(TenantPrincipal principal, UUID versionId) {
        List<Map<String, Object>> rows = jdbc.queryForList("""
                with recursive chain as (
                    select v.id, v.base_template_version_id, 0 as depth
                    from kpi_template_version v where v.tenant_id = :tenantId and v.id = :versionId
                    union all
                    select parent.id, parent.base_template_version_id, chain.depth + 1
                    from kpi_template_version parent join chain on chain.base_template_version_id = parent.id
                    where parent.tenant_id = :tenantId and chain.depth < 10
                ), ranked as (
                    select i.*, s.section_code, chain.depth,
                           row_number() over (partition by i.indicator_code order by chain.depth) as priority
                    from chain
                    join kpi_template_section s on s.tenant_id = :tenantId and s.template_version_id = chain.id
                    join kpi_indicator_rule i on i.tenant_id = s.tenant_id and i.section_id = s.id
                )
                select id, section_code, indicator_code, name, indicator_type, weekly_split_type,
                       metric_version_id, max_score, min_score, target_value, allow_above_max,
                       precision_scale, evidence_required, evaluator_type, not_applicable_policy,
                       formula_config::text as formula_config_text,
                       warning_config::text as warning_config_text
                from ranked where priority = 1 order by section_code, sort_order, indicator_code
                """, base(principal).addValue("versionId", versionId));
        List<KpiModels.TemplateRule> result = new ArrayList<>();
        for (Map<String, Object> row : rows) {
            result.add(new KpiModels.TemplateRule((UUID) row.get("id"), String.valueOf(row.get("section_code")),
                    String.valueOf(row.get("indicator_code")), String.valueOf(row.get("name")),
                    String.valueOf(row.get("indicator_type")), String.valueOf(row.get("weekly_split_type")),
                    (UUID) row.get("metric_version_id"), (BigDecimal) row.get("max_score"),
                    (BigDecimal) row.get("min_score"), (BigDecimal) row.get("target_value"),
                    Boolean.TRUE.equals(row.get("allow_above_max")), ((Number) row.get("precision_scale")).intValue(),
                    Boolean.TRUE.equals(row.get("evidence_required")), String.valueOf(row.get("evaluator_type")),
                    String.valueOf(row.get("not_applicable_policy")), parseJson(row.get("formula_config_text")),
                    parseJson(row.get("warning_config_text"))));
        }
        return result;
    }

    private KpiModels.MetricAggregate aggregate(
            TenantPrincipal principal,
            UUID metricVersionId,
            UUID employeeId,
            UUID assignmentId,
            LocalDate from,
            LocalDate to,
            List<Map<String, Object>> scopes
    ) {
        List<UUID> orgIds = scopes.stream().map(row -> (UUID) row.get("org_unit_id"))
                .filter(java.util.Objects::nonNull).distinct().toList();
        List<String> channels = scopes.stream().map(row -> (String) row.get("channel_code"))
                .filter(java.util.Objects::nonNull).distinct().toList();
        StringBuilder sql = new StringBuilder("""
                select f.value, f.numerator, f.denominator, f.data_state, f.source_type,
                       f.source_record_id, f.source_snapshot::text as source_snapshot_text,
                       f.business_time, f.created_at
                from kpi_metric_fact f
                where f.tenant_id = :tenantId and f.metric_version_id = :metricVersionId
                  and f.business_date between :fromDate and :toDate
                  and not exists (
                    select 1 from kpi_metric_fact newer
                    where newer.tenant_id = f.tenant_id and newer.supersedes_fact_id = f.id
                  )
                  and (f.employee_id is null or f.employee_id = :employeeId)
                  and (f.position_assignment_id is null or f.position_assignment_id = :assignmentId)
                """);
        if (!orgIds.isEmpty()) sql.append(" and (f.org_unit_id is null or f.org_unit_id in (:orgIds))");
        else sql.append(" and f.org_unit_id is null");
        if (!channels.isEmpty()) sql.append(" and (f.channel_code is null or f.channel_code in (:channels))");
        sql.append(" order by coalesce(f.business_time, f.created_at) desc");
        MapSqlParameterSource parameters = base(principal).addValue("metricVersionId", metricVersionId)
                .addValue("employeeId", employeeId).addValue("assignmentId", assignmentId)
                .addValue("fromDate", from).addValue("toDate", to)
                .addValue("orgIds", orgIds).addValue("channels", channels);
        List<Map<String, Object>> facts = jdbc.queryForList(sql.toString(), parameters);
        if (facts.isEmpty()) return new KpiModels.MetricAggregate("PENDING_VERIFICATION", null, null, null, 0,
                JsonNodeFactory.instance.objectNode().put("reason", "NO_FACTS"));
        if (facts.stream().anyMatch(row -> "PENDING_VERIFICATION".equals(row.get("data_state"))
                || "UNAVAILABLE".equals(row.get("data_state")))) {
            return new KpiModels.MetricAggregate("PENDING_VERIFICATION", null, null, null, facts.size(),
                    sourceSummary(facts));
        }
        List<Map<String, Object>> available = facts.stream()
                .filter(row -> "AVAILABLE".equals(row.get("data_state"))).toList();
        if (available.isEmpty()) return new KpiModels.MetricAggregate("NOT_APPLICABLE", null, null, null,
                facts.size(), sourceSummary(facts));
        Map<String, Object> metric = jdbc.queryForMap("""
                select aggregation from metric_definition_version where tenant_id = :tenantId and id = :id
                """, base(principal).addValue("id", metricVersionId));
        String aggregation = String.valueOf(metric.get("aggregation"));
        BigDecimal numerator = available.stream().map(row -> (BigDecimal) row.get("numerator"))
                .filter(java.util.Objects::nonNull).reduce(BigDecimal.ZERO, BigDecimal::add);
        BigDecimal denominator = available.stream().map(row -> (BigDecimal) row.get("denominator"))
                .filter(java.util.Objects::nonNull).reduce(BigDecimal.ZERO, BigDecimal::add);
        List<BigDecimal> values = available.stream().map(row -> (BigDecimal) row.get("value"))
                .filter(java.util.Objects::nonNull).toList();
        BigDecimal value = switch (aggregation) {
            case "RATIO" -> denominator.compareTo(BigDecimal.ZERO) > 0
                    ? numerator.divide(denominator, 8, RoundingMode.HALF_UP) : null;
            case "SUM" -> values.stream().reduce(BigDecimal.ZERO, BigDecimal::add);
            case "COUNT" -> BigDecimal.valueOf(available.size());
            case "AVERAGE" -> values.isEmpty() ? null : values.stream().reduce(BigDecimal.ZERO, BigDecimal::add)
                    .divide(BigDecimal.valueOf(values.size()), 8, RoundingMode.HALF_UP);
            case "MIN" -> values.stream().min(Comparator.naturalOrder()).orElse(null);
            case "MAX" -> values.stream().max(Comparator.naturalOrder()).orElse(null);
            default -> (BigDecimal) available.getFirst().get("value");
        };
        if (value == null) return new KpiModels.MetricAggregate("PENDING_VERIFICATION", null, numerator,
                denominator, facts.size(), sourceSummary(facts));
        return new KpiModels.MetricAggregate("AVAILABLE", value, numerator, denominator,
                facts.size(), sourceSummary(facts));
    }

    private Map<UUID, BigDecimal> latestManualScores(TenantPrincipal principal, UUID scorecardId) {
        List<Map<String, Object>> rows = jdbc.queryForList("""
                select m.indicator_rule_id, m.score from kpi_manual_score m
                where m.tenant_id = :tenantId and m.scorecard_id = :scorecardId
                  and not exists (
                    select 1 from kpi_manual_score newer
                    where newer.tenant_id = m.tenant_id and newer.supersedes_manual_score_id = m.id
                  )
                order by m.created_at desc
                """, base(principal).addValue("scorecardId", scorecardId));
        Map<UUID, BigDecimal> result = new LinkedHashMap<>();
        for (Map<String, Object> row : rows) result.putIfAbsent((UUID) row.get("indicator_rule_id"), (BigDecimal) row.get("score"));
        return result;
    }

    private String warningLevel(
            TenantPrincipal principal,
            UUID scorecardId,
            Integer weekNo,
            List<KpiModels.IndicatorScore> indicators
    ) {
        if (weekNo == null) return "NONE";
        List<String> failingIndicators = indicators.stream()
                .filter(item -> "FAIL".equals(item.outcome()) || "WARNING".equals(item.outcome()))
                .map(KpiModels.IndicatorScore::indicatorCode)
                .distinct()
                .toList();
        if (failingIndicators.isEmpty()) return "NONE";
        if (weekNo == 1) return "YELLOW";
        int maximumConsecutivePrior = 0;
        for (String indicatorCode : failingIndicators) {
            int consecutivePrior = 0;
            for (int prior = weekNo - 1; prior >= 1; prior--) {
                Integer failures = jdbc.queryForObject("""
                        select count(*) from kpi_indicator_result result
                        join kpi_scorecard_revision revision on revision.tenant_id = result.tenant_id
                          and revision.id = result.scorecard_revision_id
                        join kpi_scorecard prior_card on prior_card.tenant_id = revision.tenant_id
                          and prior_card.id = revision.scorecard_id and prior_card.current_revision_no = revision.revision_no
                        join kpi_scorecard current_card on current_card.tenant_id = prior_card.tenant_id
                          and current_card.id = :currentCardId
                        where prior_card.tenant_id = :tenantId and prior_card.responsibility_snapshot_id = current_card.responsibility_snapshot_id
                          and prior_card.card_type = 'WEEK' and prior_card.week_no = :weekNo
                          and result.indicator_code = :indicatorCode
                          and result.outcome in ('FAIL', 'WARNING')
                        """, base(principal).addValue("currentCardId", scorecardId)
                        .addValue("weekNo", prior).addValue("indicatorCode", indicatorCode), Integer.class);
                if (failures == null || failures == 0) break;
                consecutivePrior++;
            }
            maximumConsecutivePrior = Math.max(maximumConsecutivePrior, consecutivePrior);
        }
        if (maximumConsecutivePrior >= 2) return "RED";
        if (maximumConsecutivePrior >= 1) return "ORANGE";
        return "YELLOW";
    }

    private void createImprovementTasks(
            Map<String, Object> card,
            List<KpiModels.IndicatorScore> indicators,
            UUID revisionId
    ) {
        UUID reviewer = (UUID) card.get("department_reviewer_assignment_id");
        if (reviewer == null) reviewer = (UUID) card.get("evaluator_assignment_id");
        if (reviewer == null) return;
        for (KpiModels.IndicatorScore item : indicators) {
            if (!"FAIL".equals(item.outcome()) && !"WARNING".equals(item.outcome())) continue;
            ObjectNode source = JsonNodeFactory.instance.objectNode();
            source.put("sourceType", "KPI_WEEKLY_WARNING");
            source.put("scorecardId", String.valueOf(card.get("id")));
            source.put("scorecardRevisionId", revisionId.toString());
            source.put("indicatorCode", item.indicatorCode());
            TaskModels.RuleTaskSpec spec = new TaskModels.RuleTaskSpec(
                    null, null, (UUID) card.get("org_unit_id"),
                    (UUID) card.get("position_assignment_id"), reviewer,
                    null, null, "KPI改善任务：" + item.name(),
                    "本周指标未达标。请提交量化改善动作、完成证据并在下一周复盘。",
                    "HIGH", OffsetDateTime.now(BUSINESS_ZONE).plusDays(7), source
            );
            taskService.createFromRule(spec,
                    "kpi:improvement:" + card.get("id") + ":" + item.indicatorCode());
        }
    }

    private void notifyScorecard(TenantPrincipal principal, Map<String, Object> card, UUID revisionId, String warning) {
        String title = "WEEK".equals(card.get("card_type"))
                ? "KPI周考核单已生成" : "KPI月度考核单已生成";
        String content = "考核结果已生成，当前状态：" + card.get("status") + "，预警级别：" + warning + "。";
        Set<UUID> recipients = new LinkedHashSet<>();
        add(recipients, card.get("position_assignment_id"));
        add(recipients, card.get("evaluator_assignment_id"));
        add(recipients, card.get("department_reviewer_assignment_id"));
        add(recipients, card.get("manager_assignment_id"));
        recipients.addAll(storeManagerAssignments(principal, (UUID) card.get("responsibility_snapshot_id")));
        for (UUID assignmentId : recipients) {
            notifyAssignment(assignmentId, "KPI_SCORECARD", title, content, "KPI_SCORECARD",
                    (UUID) card.get("id"), "kpi:scorecard:" + revisionId + ":" + assignmentId);
        }
    }

    private void notifyParticipants(
            TenantPrincipal principal,
            Map<String, Object> card,
            String title,
            String content,
            String sourceType,
            UUID sourceId
    ) {
        Set<UUID> recipients = new LinkedHashSet<>();
        add(recipients, card.get("position_assignment_id"));
        add(recipients, card.get("evaluator_assignment_id"));
        add(recipients, card.get("department_reviewer_assignment_id"));
        add(recipients, card.get("manager_assignment_id"));
        for (UUID assignmentId : recipients) {
            notifyAssignment(assignmentId, sourceType, title, content, sourceType, sourceId,
                    "kpi:" + sourceType.toLowerCase(Locale.ROOT) + ":" + sourceId + ":" + assignmentId);
        }
    }

    private void notifyAssignment(UUID assignmentId, String type, String title, String content,
                                  String sourceType, UUID sourceId, String idempotencyKey) {
        if (assignmentId == null) return;
        try {
            notificationService.createForAssignment(assignmentId, type, title, content,
                    sourceType, sourceId, idempotencyKey);
        } catch (EmptyResultDataAccessException ignored) {
            // A KPI result remains valid when a future/disabled assignment has no active account;
            // the scorecard is still visible after the account is bound.
        }
    }

    private List<UUID> storeManagerAssignments(TenantPrincipal principal, UUID snapshotId) {
        return jdbc.query("""
                select distinct manager.id
                from kpi_responsibility_snapshot snapshot
                join kpi_relation_scope scope on scope.tenant_id = snapshot.tenant_id and scope.relation_id = snapshot.relation_id
                join employee_position_assignment manager on manager.tenant_id = scope.tenant_id and manager.org_unit_id = scope.org_unit_id
                join position_definition position on position.tenant_id = manager.tenant_id and position.id = manager.position_id
                where snapshot.tenant_id = :tenantId and snapshot.id = :snapshotId
                  and scope.scope_type = 'STORE' and manager.status = 'ACTIVE'
                  and position.code = 'GENERAL_MANAGER'
                """, base(principal).addValue("snapshotId", snapshotId),
                (rs, rowNum) -> rs.getObject(1, UUID.class));
    }

    private void generateSettlements(TenantPrincipal principal, UUID periodId, LocalDate month) {
        List<Map<String, Object>> cards = jdbc.queryForList("""
                select c.id, c.responsibility_snapshot_id, c.current_revision_no, c.final_score,
                       s.employee_id, s.template_version_id
                from kpi_scorecard c join kpi_responsibility_snapshot s
                  on s.tenant_id = c.tenant_id and s.id = c.responsibility_snapshot_id
                where c.tenant_id = :tenantId and c.period_id = :periodId and c.card_type = 'MONTH'
                """, base(principal).addValue("periodId", periodId));
        for (Map<String, Object> card : cards) {
            UUID revisionId = jdbc.queryForObject("""
                    select id from kpi_scorecard_revision
                    where tenant_id = :tenantId and scorecard_id = :scorecardId and revision_no = :revisionNo
                    """, base(principal).addValue("scorecardId", card.get("id"))
                    .addValue("revisionNo", card.get("current_revision_no")), UUID.class);
            BigDecimal baseAmount = bonusBase(principal, (UUID) card.get("employee_id"), month);
            BigDecimal adjustment = bonusAdjustment(principal, revisionId);
            BigDecimal adjusted = baseAmount.add(adjustment).max(BigDecimal.ZERO);
            PolicyResult policy = policyResult(principal, (UUID) card.get("template_version_id"),
                    (BigDecimal) card.get("final_score"), (UUID) card.get("employee_id"), month);
            BigDecimal payable = adjusted.multiply(policy.performanceCoefficient())
                    .multiply(policy.attendanceCoefficient()).setScale(2, RoundingMode.HALF_UP).max(BigDecimal.ZERO);
            UUID settlementId = UUID.randomUUID();
            jdbc.update("""
                    insert into kpi_settlement
                        (id, tenant_id, period_id, employee_id, scorecard_id, scorecard_revision_id,
                         original_bonus_base, bonus_adjustment, adjusted_bonus_base,
                         performance_coefficient, attendance_coefficient, payable_bonus, status)
                    values (:id, :tenantId, :periodId, :employeeId, :scorecardId, :revisionId,
                            :baseAmount, :adjustment, :adjusted, :performanceCoefficient,
                            :attendanceCoefficient, :payable, :status)
                    on conflict (tenant_id, period_id, employee_id) do update set
                        scorecard_id = excluded.scorecard_id,
                        scorecard_revision_id = excluded.scorecard_revision_id,
                        original_bonus_base = excluded.original_bonus_base,
                        bonus_adjustment = excluded.bonus_adjustment,
                        adjusted_bonus_base = excluded.adjusted_bonus_base,
                        performance_coefficient = excluded.performance_coefficient,
                        attendance_coefficient = excluded.attendance_coefficient,
                        payable_bonus = excluded.payable_bonus,
                        status = excluded.status,
                        updated_at = now()
                    """, base(principal).addValue("id", settlementId).addValue("periodId", periodId)
                    .addValue("employeeId", card.get("employee_id")).addValue("scorecardId", card.get("id"))
                    .addValue("revisionId", revisionId).addValue("baseAmount", baseAmount)
                    .addValue("adjustment", adjustment).addValue("adjusted", adjusted)
                    .addValue("performanceCoefficient", policy.performanceCoefficient())
                    .addValue("attendanceCoefficient", policy.attendanceCoefficient())
                    .addValue("payable", payable).addValue("status", policy.pending() ? "PENDING_VERIFICATION" : "CONFIRMED"));
        }
    }

    private BigDecimal bonusBase(TenantPrincipal principal, UUID employeeId, LocalDate month) {
        List<BigDecimal> values = jdbc.query("""
                select base.amount from kpi_employee_bonus_base base
                where base.tenant_id = :tenantId and base.employee_id = :employeeId
                  and base.effective_month <= :monthStart
                  and (base.expires_month is null or base.expires_month >= :monthStart)
                  and not exists (
                    select 1 from kpi_employee_bonus_base newer
                    where newer.tenant_id = base.tenant_id and newer.supersedes_bonus_base_id = base.id
                  )
                order by base.effective_month desc, base.created_at desc limit 1
                """, base(principal).addValue("employeeId", employeeId).addValue("monthStart", month),
                (rs, rowNum) -> rs.getBigDecimal(1));
        return values.isEmpty() ? BigDecimal.ZERO : values.getFirst();
    }

    private BigDecimal bonusAdjustment(TenantPrincipal principal, UUID revisionId) {
        List<Map<String, Object>> rows = jdbc.queryForList("""
                select result.indicator_rule_id, result.actual_value, indicator.indicator_code,
                       indicator.name, indicator.formula_config::text as formula_config_text
                from kpi_indicator_result result
                join kpi_indicator_rule indicator on indicator.tenant_id = result.tenant_id
                  and indicator.id = result.indicator_rule_id
                where result.tenant_id = :tenantId and result.scorecard_revision_id = :revisionId
                  and indicator.indicator_type = 'BONUS_ADJUSTMENT' and result.data_state = 'AVAILABLE'
                """, base(principal).addValue("revisionId", revisionId));
        BigDecimal total = BigDecimal.ZERO;
        for (Map<String, Object> row : rows) {
            JsonNode config = parseJson(row.get("formula_config_text"));
            BigDecimal perUnit = config.hasNonNull("amountPerUnit") ? config.path("amountPerUnit").decimalValue() : BigDecimal.ZERO;
            BigDecimal quantity = (BigDecimal) row.get("actual_value");
            if (quantity == null) continue;
            BigDecimal amount = quantity.multiply(perUnit).setScale(2, RoundingMode.HALF_UP);
            total = total.add(amount);
            jdbc.update("""
                    insert into kpi_bonus_adjustment
                        (id, tenant_id, scorecard_revision_id, adjustment_code, description,
                         quantity, amount_per_unit, total_amount, source_snapshot)
                    values (:id, :tenantId, :revisionId, :code, :description,
                            :quantity, :perUnit, :amount, '{}'::jsonb)
                    on conflict (tenant_id, scorecard_revision_id, adjustment_code) do nothing
                    """, base(principal).addValue("id", UUID.randomUUID()).addValue("revisionId", revisionId)
                    .addValue("code", row.get("indicator_code")).addValue("description", row.get("name"))
                    .addValue("quantity", quantity).addValue("perUnit", perUnit).addValue("amount", amount));
        }
        return total;
    }

    private PolicyResult policyResult(
            TenantPrincipal principal,
            UUID templateVersionId,
            BigDecimal score,
            UUID employeeId,
            LocalDate month
    ) {
        List<Map<String, Object>> policies = jdbc.queryForList("""
                select policy.score_bands::text as score_bands_text,
                       policy.attendance_bands::text as attendance_bands_text,
                       policy.zero_bonus_rules::text as zero_bonus_rules_text
                from kpi_template_version template
                join kpi_compensation_policy_version policy on policy.tenant_id = template.tenant_id
                  and policy.id = template.compensation_policy_version_id
                where template.tenant_id = :tenantId and template.id = :templateVersionId
                  and policy.lifecycle_status = 'PUBLISHED'
                """, base(principal).addValue("templateVersionId", templateVersionId));
        if (policies.isEmpty()) return new PolicyResult(BigDecimal.ONE, BigDecimal.ONE, false);
        Map<String, Object> policy = policies.getFirst();
        BigDecimal performance = coefficient(parseJson(policy.get("score_bands_text")), score, BigDecimal.ONE);
        FactByCode attendance = factByCode(principal, "ATTENDANCE_RATE", employeeId, month);
        FactByCode absence = factByCode(principal, "ABSENCE_COUNT", employeeId, month);
        FactByCode serious = factByCode(principal, "SERIOUS_HR_EVENT_COUNT", employeeId, month);
        boolean pending = attendance.value() == null;
        BigDecimal attendanceCoefficient = pending ? BigDecimal.ZERO
                : coefficient(parseJson(policy.get("attendance_bands_text")), attendance.value(), BigDecimal.ONE);
        if (absence.value() != null && absence.value().compareTo(BigDecimal.ONE) >= 0) attendanceCoefficient = BigDecimal.ZERO;
        if (serious.value() != null && serious.value().compareTo(BigDecimal.ONE) >= 0) attendanceCoefficient = BigDecimal.ZERO;
        return new PolicyResult(performance, attendanceCoefficient, pending);
    }

    private BigDecimal coefficient(JsonNode bands, BigDecimal value, BigDecimal fallback) {
        if (bands == null || !bands.isArray() || value == null) return fallback;
        for (JsonNode band : bands) {
            BigDecimal min = band.hasNonNull("minInclusive") ? band.path("minInclusive").decimalValue() : null;
            BigDecimal max = band.hasNonNull("maxExclusive") ? band.path("maxExclusive").decimalValue() : null;
            BigDecimal minExclusive = band.hasNonNull("minExclusive") ? band.path("minExclusive").decimalValue() : null;
            BigDecimal maxInclusive = band.hasNonNull("maxInclusive") ? band.path("maxInclusive").decimalValue() : null;
            if ((min == null || value.compareTo(min) >= 0)
                    && (minExclusive == null || value.compareTo(minExclusive) > 0)
                    && (max == null || value.compareTo(max) < 0)
                    && (maxInclusive == null || value.compareTo(maxInclusive) <= 0)) {
                return band.path("coefficient").decimalValue();
            }
        }
        return fallback;
    }

    private FactByCode factByCode(TenantPrincipal principal, String code, UUID employeeId, LocalDate month) {
        List<BigDecimal> values = jdbc.query("""
                select fact.value from kpi_metric_fact fact
                join metric_definition_version version on version.tenant_id = fact.tenant_id and version.id = fact.metric_version_id
                join metric_definition definition on definition.tenant_id = version.tenant_id and definition.id = version.metric_definition_id
                where fact.tenant_id = :tenantId and definition.code = :code and fact.employee_id = :employeeId
                  and fact.business_date between :fromDate and :toDate and fact.data_state = 'AVAILABLE'
                  and not exists (select 1 from kpi_metric_fact newer where newer.tenant_id = fact.tenant_id and newer.supersedes_fact_id = fact.id)
                order by fact.business_date desc, fact.created_at desc limit 1
                """, base(principal).addValue("code", code).addValue("employeeId", employeeId)
                .addValue("fromDate", month).addValue("toDate", month.plusMonths(1).minusDays(1)),
                (rs, rowNum) -> rs.getBigDecimal(1));
        return new FactByCode(values.isEmpty() ? null : values.getFirst());
    }

    private String nextReviewStatus(String stage, String decision) {
        if (!"APPROVED".equals(decision)) return "DRAFT";
        return switch (stage) {
            case "DEPARTMENT" -> "HR_REVIEW";
            case "HR" -> "CEO_APPROVAL";
            case "CEO" -> "CEO_APPROVAL";
            default -> throw new IllegalArgumentException("不支持的复核阶段：" + stage);
        };
    }

    private List<Map<String, Object>> relationScopes(TenantPrincipal principal, UUID relationId, LocalDate from, LocalDate to) {
        return jdbc.queryForList("""
                select scope_type, org_unit_id, channel_code, is_primary, valid_from, valid_to
                from kpi_relation_scope
                where tenant_id = :tenantId and relation_id = :relationId
                  and valid_from <= :toDate and (valid_to is null or valid_to >= :fromDate)
                order by is_primary desc, scope_type, org_unit_id, channel_code
                """, base(principal).addValue("relationId", relationId)
                .addValue("fromDate", from).addValue("toDate", to));
    }

    private Map<String, Object> assignment(TenantPrincipal principal, UUID assignmentId) {
        List<Map<String, Object>> rows = jdbc.queryForList("""
                select a.*, e.name as employee_name from employee_position_assignment a
                join employee e on e.tenant_id = a.tenant_id and e.id = a.employee_id
                where a.tenant_id = :tenantId and a.id = :id and a.status = 'ACTIVE'
                """, base(principal).addValue("id", assignmentId));
        if (rows.isEmpty()) throw new IllegalArgumentException("员工任职不存在或已失效");
        accessPolicy.requireOrgScope((UUID) rows.getFirst().get("org_unit_id"));
        return rows.getFirst();
    }

    private Map<String, Object> template(TenantPrincipal principal, UUID templateId) {
        List<Map<String, Object>> rows = jdbc.queryForList("""
                select * from kpi_template_definition
                where tenant_id = :tenantId and id = :id and status = 'ACTIVE'
                """, base(principal).addValue("id", templateId));
        if (rows.isEmpty()) throw new IllegalArgumentException("KPI模板不存在或已停用");
        return rows.getFirst();
    }

    private Map<String, Object> cardRow(TenantPrincipal principal, UUID scorecardId) {
        List<Map<String, Object>> rows = jdbc.queryForList("""
                select c.*, s.employee_id, s.position_assignment_id, s.template_version_id,
                       s.evaluator_assignment_id, s.responsibility_snapshot,
                       r.department_reviewer_assignment_id, a.org_unit_id, a.manager_assignment_id
                from kpi_scorecard c
                join kpi_responsibility_snapshot s on s.tenant_id = c.tenant_id and s.id = c.responsibility_snapshot_id
                join kpi_assessment_relation r on r.tenant_id = s.tenant_id and r.id = s.relation_id
                join employee_position_assignment a on a.tenant_id = s.tenant_id and a.id = s.position_assignment_id
                where c.tenant_id = :tenantId and c.id = :id
                """, base(principal).addValue("id", scorecardId));
        if (rows.isEmpty()) throw new ResponseStatusException(HttpStatus.NOT_FOUND, "KPI考核单不存在");
        return new LinkedHashMap<>(rows.getFirst());
    }

    private Map<String, Object> snapshotRow(TenantPrincipal principal, UUID snapshotId) {
        return jdbc.queryForMap("""
                select s.*, a.org_unit_id, a.manager_assignment_id, r.department_reviewer_assignment_id
                from kpi_responsibility_snapshot s
                join employee_position_assignment a on a.tenant_id = s.tenant_id and a.id = s.position_assignment_id
                join kpi_assessment_relation r on r.tenant_id = s.tenant_id and r.id = s.relation_id
                where s.tenant_id = :tenantId and s.id = :id
                """, base(principal).addValue("id", snapshotId));
    }

    private void requireVisible(TenantPrincipal principal, UUID scorecardId) {
        Integer count = jdbc.queryForObject("""
                select count(*) from kpi_scorecard c
                join kpi_responsibility_snapshot s on s.tenant_id = c.tenant_id and s.id = c.responsibility_snapshot_id
                join employee_position_assignment a on a.tenant_id = s.tenant_id and a.id = s.position_assignment_id
                where c.tenant_id = :tenantId and c.id = :id
                  and (
                    :readAll = true or s.position_assignment_id in (:assignmentIds)
                    or (:readTeam = true and (
                      s.evaluator_assignment_id in (:assignmentIds)
                      or exists (select 1 from org_unit_closure closure
                        where closure.tenant_id = c.tenant_id and closure.descendant_id = a.org_unit_id
                          and closure.ancestor_id in (:orgScopes))
                    ))
                  )
                """, visibilityBase(principal).addValue("id", scorecardId), Integer.class);
        if (count == null || count != 1) throw new ResponseStatusException(HttpStatus.FORBIDDEN, "无权查看该KPI考核单");
    }

    private ArrayNode sourceSummary(List<Map<String, Object>> facts) {
        ArrayNode array = JsonNodeFactory.instance.arrayNode();
        facts.stream().limit(50).forEach(row -> {
            ObjectNode item = JsonNodeFactory.instance.objectNode();
            item.put("sourceType", String.valueOf(row.get("source_type")));
            if (row.get("source_record_id") != null) item.put("sourceRecordId", String.valueOf(row.get("source_record_id")));
            item.put("dataState", String.valueOf(row.get("data_state")));
            array.add(item);
        });
        return array;
    }

    private List<CardWindow> windows(LocalDate month, String generationType, Integer requestedWeek) {
        LocalDate monthEnd = month.plusMonths(1).minusDays(1);
        List<CardWindow> all = List.of(
                new CardWindow("WEEK", 1, month, month.plusDays(6)),
                new CardWindow("WEEK", 2, month.plusDays(7), month.plusDays(13)),
                new CardWindow("WEEK", 3, month.plusDays(14), month.plusDays(20)),
                new CardWindow("WEEK", 4, month.plusDays(21), monthEnd),
                new CardWindow("MONTH", null, month, monthEnd)
        );
        if ("MONTH".equals(generationType)) return List.of(all.getLast());
        if ("WEEK".equals(generationType)) {
            if (requestedWeek == null) throw new IllegalArgumentException("生成周考核单必须指定weekNo");
            return all.stream().filter(item -> requestedWeek.equals(item.weekNo())).toList();
        }
        return all;
    }

    private OffsetDateTime at(LocalDate date, int hour, int minute) {
        return date.atTime(LocalTime.of(hour, minute)).atZone(BUSINESS_ZONE).toOffsetDateTime();
    }

    private LocalDate localDate(Object value) {
        if (value instanceof LocalDate date) return date;
        if (value instanceof Date date) return date.toLocalDate();
        return LocalDate.parse(String.valueOf(value));
    }

    private LocalDate month(LocalDate value) {
        if (value == null || value.getDayOfMonth() != 1) throw new IllegalArgumentException("考核月份必须使用当月1日");
        return value;
    }

    private void add(Set<UUID> values, Object value) {
        if (value instanceof UUID id) values.add(id);
    }

    private TenantPrincipal prepare() {
        TenantPrincipal principal = accessPolicy.principal();
        databaseContext.apply(principal.tenantId());
        return principal;
    }

    private MapSqlParameterSource base(TenantPrincipal principal) {
        return new MapSqlParameterSource("tenantId", principal.tenantId());
    }

    private MapSqlParameterSource scopeBase(TenantPrincipal principal) {
        return base(principal).addValue("tenantScope", principal.hasTenantScope())
                .addValue("orgScopes", principal.orgScopes().isEmpty() ? List.of(EMPTY_SCOPE) : principal.orgScopes());
    }

    private MapSqlParameterSource visibilityBase(TenantPrincipal principal) {
        return scopeBase(principal)
                .addValue("readAll", principal.hasPermission("kpi.scorecard.read-all") || principal.hasPermission("*"))
                .addValue("readTeam", principal.hasPermission("kpi.scorecard.read-team") || principal.hasPermission("*"))
                .addValue("assignmentIds", principal.assignmentIds().isEmpty() ? List.of(EMPTY_SCOPE) : principal.assignmentIds());
    }

    private String normalize(String value, String fallback) {
        return value == null || value.isBlank() ? fallback : value.trim().toUpperCase(Locale.ROOT);
    }

    private String blankToNull(String value) {
        return value == null || value.isBlank() ? null : value.trim();
    }

    private JsonNode parseJson(Object value) {
        if (value == null) return JsonNodeFactory.instance.objectNode();
        if (value instanceof JsonNode node) return node;
        try {
            return objectMapper.readTree(String.valueOf(value));
        } catch (JsonProcessingException exception) {
            throw new IllegalStateException("数据库中的KPI JSON无效", exception);
        }
    }

    private String json(Object value) {
        try {
            return objectMapper.writeValueAsString(value == null ? Map.of() : value);
        } catch (JsonProcessingException exception) {
            throw new IllegalArgumentException("无法序列化KPI数据", exception);
        }
    }

    private ResponseStatusException conflict(String message) {
        return new ResponseStatusException(HttpStatus.CONFLICT, message);
    }

    private record CardWindow(String cardType, Integer weekNo, LocalDate start, LocalDate end) {
    }

    private record PolicyResult(BigDecimal performanceCoefficient, BigDecimal attendanceCoefficient, boolean pending) {
    }

    private record FactByCode(BigDecimal value) {
    }
}
