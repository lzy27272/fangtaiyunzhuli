package cn.sifangguan.hotelaios.performance;

import cn.sifangguan.hotelaios.shared.audit.AuditWriter;
import cn.sifangguan.hotelaios.shared.context.TenantPrincipal;
import cn.sifangguan.hotelaios.shared.db.TenantDatabaseContext;
import cn.sifangguan.hotelaios.shared.security.AccessPolicy;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

import java.math.BigDecimal;
import java.time.Duration;
import java.time.OffsetDateTime;
import java.time.ZoneId;
import java.util.List;
import java.util.LinkedHashMap;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

@Service
public class KpiInspectionService {
    private static final ZoneId BUSINESS_ZONE = ZoneId.of("Asia/Shanghai");
    private static final Set<String> SLOTS = Set.of("MORNING", "AFTERNOON", "BEFORE_SLEEP");
    private static final Set<String> RESULTS = Set.of("NORMAL", "ABNORMAL", "PENDING_VERIFICATION");

    private final NamedParameterJdbcTemplate jdbc;
    private final TenantDatabaseContext databaseContext;
    private final AccessPolicy accessPolicy;
    private final AuditWriter auditWriter;
    private final ObjectMapper objectMapper;

    public KpiInspectionService(
            NamedParameterJdbcTemplate jdbc,
            TenantDatabaseContext databaseContext,
            AccessPolicy accessPolicy,
            AuditWriter auditWriter,
            ObjectMapper objectMapper
    ) {
        this.jdbc = jdbc;
        this.databaseContext = databaseContext;
        this.accessPolicy = accessPolicy;
        this.auditWriter = auditWriter;
        this.objectMapper = objectMapper;
    }

    @Transactional(readOnly = true)
    public List<Map<String, Object>> schedules() {
        accessPolicy.requireAnyPermission("kpi.inspection.submit", "kpi.inspection.read-team", "kpi.inspection.manage");
        TenantPrincipal principal = prepare();
        List<Map<String, Object>> rows = jdbc.queryForList("""
                select id, time_slot, opens_at, cutoff_at, required_checks::text as required_checks_text,
                       active, row_version
                from kpi_inspection_schedule where tenant_id = :tenantId order by opens_at
                """, base(principal));
        return rows.stream().map(row -> {
            Map<String, Object> result = new LinkedHashMap<>(row);
            result.remove("required_checks_text");
            result.put("required_checks", jsonValue(row.get("required_checks_text"), List.of()));
            return result;
        }).toList();
    }

    @Transactional
    public Map<String, Object> updateSchedule(String timeSlot, KpiModels.UpdateInspectionSchedule request) {
        accessPolicy.requirePermission("kpi.inspection.manage");
        TenantPrincipal principal = prepare();
        String slot = slot(timeSlot);
        int updated = jdbc.update("""
                update kpi_inspection_schedule
                set opens_at = cast(:opensAt as time), cutoff_at = cast(:cutoffAt as time),
                    required_checks = cast(:requiredChecks as jsonb), active = :active,
                    row_version = row_version + 1
                where tenant_id = :tenantId and time_slot = :slot and row_version = :expectedVersion
                """, base(principal).addValue("slot", slot).addValue("opensAt", request.opensAt())
                .addValue("cutoffAt", request.cutoffAt()).addValue("requiredChecks", json(request.requiredChecks()))
                .addValue("active", request.active()).addValue("expectedVersion", request.expectedVersion()));
        if (updated != 1) throw conflict("巡检时段已变化");
        Map<String, Object> schedule = schedule(principal, slot);
        auditWriter.record("KPI_INSPECTION_SCHEDULE_UPDATED", "KPI_INSPECTION_SCHEDULE", (UUID) schedule.get("id"),
                json(Map.of("timeSlot", slot)));
        return schedule;
    }

    @Transactional(readOnly = true)
    public List<Map<String, Object>> submissions(
            java.time.LocalDate businessDate,
            UUID orgUnitId,
            UUID employeeId,
            String timeSlot,
            String result
    ) {
        accessPolicy.requireAnyPermission("kpi.inspection.submit", "kpi.inspection.read-team", "kpi.inspection.verify");
        TenantPrincipal principal = prepare();
        boolean team = principal.hasPermission("kpi.inspection.read-team") || principal.hasPermission("kpi.inspection.verify")
                || principal.hasTenantScope();
        return jdbc.queryForList("""
                select submission.*, employee.employee_no, employee.name as employee_name,
                       org.name as org_name,
                       (select count(*) from kpi_inspection_sla_breach breach
                        where breach.tenant_id = submission.tenant_id and breach.submission_id = submission.id) as breach_count,
                       (select max(verification.decision) from kpi_inspection_verification verification
                        where verification.tenant_id = submission.tenant_id and verification.submission_id = submission.id) as verification_decision
                from kpi_inspection_submission submission
                join employee on employee.tenant_id = submission.tenant_id and employee.id = submission.employee_id
                join org_unit org on org.tenant_id = submission.tenant_id and org.id = submission.org_unit_id
                where submission.tenant_id = :tenantId
                  and (cast(:businessDate as date) is null or submission.business_date = :businessDate)
                  and (cast(:orgUnitId as uuid) is null or submission.org_unit_id = :orgUnitId)
                  and (cast(:employeeId as uuid) is null or submission.employee_id = :employeeId)
                  and (:timeSlot = '' or submission.time_slot = :timeSlot)
                  and (:result = '' or submission.result = :result)
                  and (:team = true or submission.signed_by = :actorId)
                  and not exists (
                    select 1 from kpi_inspection_submission newer
                    where newer.tenant_id = submission.tenant_id and newer.supersedes_submission_id = submission.id
                  )
                order by submission.business_date desc, submission.signed_at desc
                limit 500
                """, base(principal).addValue("businessDate", businessDate).addValue("orgUnitId", orgUnitId)
                .addValue("employeeId", employeeId).addValue("timeSlot", normalized(timeSlot))
                .addValue("result", normalized(result)).addValue("team", team).addValue("actorId", principal.actorId()));
    }

    @Transactional
    public Map<String, Object> submit(KpiModels.SubmitInspection request) {
        accessPolicy.requirePermission("kpi.inspection.submit");
        TenantPrincipal principal = prepare();
        if (!principal.assignmentIds().contains(request.assignmentId()) && !principal.hasTenantScope()) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "提交任职不属于当前账号");
        }
        String slot = slot(request.timeSlot());
        String result = normalized(request.result());
        if (!RESULTS.contains(result)) throw new IllegalArgumentException("不支持的巡检结果：" + result);
        Map<String, Object> assignment = jdbc.queryForMap("""
                select assignment.employee_id, assignment.org_unit_id, employee.name as employee_name
                from employee_position_assignment assignment
                join employee on employee.tenant_id = assignment.tenant_id and employee.id = assignment.employee_id
                where assignment.tenant_id = :tenantId and assignment.id = :assignmentId and assignment.status = 'ACTIVE'
                """, base(principal).addValue("assignmentId", request.assignmentId()));
        if (!request.orgUnitId().equals(assignment.get("org_unit_id"))) {
            throw new IllegalArgumentException("巡检门店与当前任职不一致");
        }
        validateRequiredChecks(principal, slot, request.checkItems());
        if ("ABNORMAL".equals(result)) {
            String level = normalized(request.abnormalityLevel());
            if (!Set.of("ORDINARY", "MAJOR").contains(level)
                    || blank(request.abnormalityDescription()) || blank(request.firstAction())) {
                throw new IllegalArgumentException("异常巡检必须填写普通/重大级别、异常说明和首个处理动作");
            }
        }
        if ((request.supersedesSubmissionId() == null) != blank(request.correctionReason())) {
            throw new IllegalArgumentException("更正记录必须同时指定原记录和更正原因");
        }
        if (request.supersedesSubmissionId() != null) {
            Map<String, Object> original = jdbc.queryForMap("""
                    select signed_by from kpi_inspection_submission
                    where tenant_id = :tenantId and id = :id
                    """, base(principal).addValue("id", request.supersedesSubmissionId()));
            if (!principal.actorId().equals(original.get("signed_by")) && !principal.hasPermission("kpi.inspection.verify")) {
                throw new ResponseStatusException(HttpStatus.FORBIDDEN, "只能更正本人提交的巡检记录");
            }
        }
        UUID id = UUID.randomUUID();
        String checks = json(request.checkItems());
        String hash = KpiHashing.sha256(principal.tenantId() + "|" + assignment.get("employee_id") + "|"
                + request.orgUnitId() + "|" + request.businessDate() + "|" + slot + "|"
                + request.channelCode() + "|" + result + "|" + checks + "|" + principal.actorId());
        jdbc.update("""
                insert into kpi_inspection_submission
                    (id, tenant_id, employee_id, assignment_id, org_unit_id, business_date,
                     time_slot, channel_code, result, check_items, abnormality_level,
                     abnormality_description, first_action, idempotency_key,
                     supersedes_submission_id, correction_reason, signed_by, signed_name, content_hash)
                values (:id, :tenantId, :employeeId, :assignmentId, :orgUnitId, :businessDate,
                        :timeSlot, :channelCode, :result, cast(:checkItems as jsonb), :abnormalityLevel,
                        :description, :firstAction, :idempotencyKey,
                        :supersedesId, :correctionReason, :actorId, :signedName, :hash)
                on conflict (tenant_id, idempotency_key) do nothing
                """, base(principal).addValue("id", id).addValue("employeeId", assignment.get("employee_id"))
                .addValue("assignmentId", request.assignmentId()).addValue("orgUnitId", request.orgUnitId())
                .addValue("businessDate", request.businessDate()).addValue("timeSlot", slot)
                .addValue("channelCode", request.channelCode().trim().toUpperCase(Locale.ROOT))
                .addValue("result", result).addValue("checkItems", checks)
                .addValue("abnormalityLevel", normalizedOrNull(request.abnormalityLevel()))
                .addValue("description", request.abnormalityDescription()).addValue("firstAction", request.firstAction())
                .addValue("idempotencyKey", request.idempotencyKey()).addValue("supersedesId", request.supersedesSubmissionId())
                .addValue("correctionReason", request.correctionReason()).addValue("actorId", principal.actorId())
                .addValue("signedName", assignment.get("employee_name")).addValue("hash", hash));
        Map<String, Object> submission = jdbc.queryForMap("""
                select * from kpi_inspection_submission
                where tenant_id = :tenantId and idempotency_key = :idempotencyKey
                """, base(principal).addValue("idempotencyKey", request.idempotencyKey()));
        auditWriter.record("KPI_INSPECTION_SUBMITTED", "KPI_INSPECTION_SUBMISSION", (UUID) submission.get("id"),
                json(Map.of("result", result, "timeSlot", slot, "serverSigned", true)));
        return submission;
    }

    @Transactional
    public Map<String, Object> recordEvent(UUID submissionId, KpiModels.InspectionEvent request) {
        accessPolicy.requirePermission("kpi.inspection.submit");
        TenantPrincipal principal = prepare();
        Map<String, Object> submission = submission(principal, submissionId);
        if (!principal.actorId().equals(submission.get("signed_by")) && !principal.hasPermission("kpi.inspection.verify")) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "只能处理本人巡检异常");
        }
        if (!"ABNORMAL".equals(submission.get("result"))) throw new IllegalArgumentException("正常巡检无需登记异常事件");
        String eventType = normalized(request.eventType());
        if (!Set.of("CONFIRMED", "ACTION_SUBMITTED", "CLOSED", "ESCALATED").contains(eventType)) {
            throw new IllegalArgumentException("不支持的异常事件：" + eventType);
        }
        validateEventOrder(principal, submissionId, eventType);
        UUID id = UUID.randomUUID();
        String hash = KpiHashing.sha256(submissionId + "|" + eventType + "|" + request.note() + "|" + principal.actorId());
        jdbc.update("""
                insert into kpi_inspection_abnormality_event
                    (id, tenant_id, submission_id, event_type, note, evidence_reference, actor_id, content_hash)
                values (:id, :tenantId, :submissionId, :eventType, :note, :evidence, :actorId, :hash)
                """, base(principal).addValue("id", id).addValue("submissionId", submissionId)
                .addValue("eventType", eventType).addValue("note", request.note())
                .addValue("evidence", request.evidenceReference()).addValue("actorId", principal.actorId())
                .addValue("hash", hash));
        detectSlaBreaches(principal, submissionId);
        auditWriter.record("KPI_INSPECTION_EVENT_RECORDED", "KPI_INSPECTION_ABNORMALITY_EVENT", id,
                json(Map.of("submissionId", submissionId, "eventType", eventType)));
        return Map.of("id", id, "submissionId", submissionId, "eventType", eventType);
    }

    @Transactional
    public Map<String, Object> verify(UUID submissionId, KpiModels.VerifyInspection request) {
        accessPolicy.requirePermission("kpi.inspection.verify");
        TenantPrincipal principal = prepare();
        Map<String, Object> submission = submission(principal, submissionId);
        String decision = normalized(request.decision());
        if (!Set.of("MATCHED", "MISMATCH", "PENDING").contains(decision)) {
            throw new IllegalArgumentException("不支持的核验结论：" + decision);
        }
        UUID id = UUID.randomUUID();
        String hash = KpiHashing.sha256(submissionId + "|" + decision + "|" + request.finding() + "|" + principal.actorId());
        jdbc.update("""
                insert into kpi_inspection_verification
                    (id, tenant_id, submission_id, decision, finding, evidence_reference,
                     verified_by, content_hash)
                values (:id, :tenantId, :submissionId, :decision, :finding, :evidence, :actorId, :hash)
                """, base(principal).addValue("id", id).addValue("submissionId", submissionId)
                .addValue("decision", decision).addValue("finding", request.finding())
                .addValue("evidence", request.evidenceReference()).addValue("actorId", principal.actorId())
                .addValue("hash", hash));
        if ("MISMATCH".equals(decision) && "NORMAL".equals(submission.get("result"))) {
            insertBreach(principal, submission, "FALSE_NORMAL", BigDecimal.valueOf(3),
                    Map.of("verificationId", id, "finding", request.finding()));
        }
        auditWriter.record("KPI_INSPECTION_VERIFIED", "KPI_INSPECTION_VERIFICATION", id,
                json(Map.of("submissionId", submissionId, "decision", decision)));
        return Map.of("id", id, "submissionId", submissionId, "decision", decision);
    }

    @Transactional
    public ProcessResult processSlaBreaches() {
        TenantPrincipal principal = prepare();
        int lateConfirmed = processLateEvent(principal, "CONFIRMED", "CONFIRMATION_LATE", 30, 15);
        int lateAction = processLateEvent(principal, "ACTION_SUBMITTED", "ACTION_LATE", 60, 30);
        int lateClose = processCloseOrEscalation(principal);
        int missing = processMissingInspections(principal);
        materializeDeductionFacts(principal);
        return new ProcessResult(missing, lateConfirmed, lateAction, lateClose);
    }

    private int processLateEvent(
            TenantPrincipal principal,
            String eventType,
            String breachType,
            int ordinaryMinutes,
            int majorMinutes
    ) {
        List<Map<String, Object>> overdue = jdbc.queryForList("""
                select submission.*
                from kpi_inspection_submission submission
                where submission.tenant_id = :tenantId and submission.result = 'ABNORMAL'
                  and now() > submission.signed_at + make_interval(mins =>
                    case when submission.abnormality_level = 'MAJOR' then :majorMinutes else :ordinaryMinutes end)
                  and not exists (
                    select 1 from kpi_inspection_abnormality_event event
                    where event.tenant_id = submission.tenant_id and event.submission_id = submission.id
                      and event.event_type = :eventType
                  )
                """, base(principal).addValue("majorMinutes", majorMinutes)
                .addValue("ordinaryMinutes", ordinaryMinutes).addValue("eventType", eventType));
        overdue.forEach(item -> insertBreach(principal, item, breachType, BigDecimal.ONE,
                Map.of("eventType", eventType, "deadlineMinutes",
                        "MAJOR".equals(item.get("abnormality_level")) ? majorMinutes : ordinaryMinutes,
                        "detectedBy", "KPI_AUTOMATION")));
        return overdue.size();
    }

    private int processCloseOrEscalation(TenantPrincipal principal) {
        List<Map<String, Object>> overdue = jdbc.queryForList("""
                select submission.*
                from kpi_inspection_submission submission
                where submission.tenant_id = :tenantId and submission.result = 'ABNORMAL'
                  and now() > submission.signed_at + make_interval(mins =>
                    case when submission.abnormality_level = 'MAJOR' then 120 else 240 end)
                  and not exists (
                    select 1 from kpi_inspection_abnormality_event event
                    where event.tenant_id = submission.tenant_id and event.submission_id = submission.id
                      and event.event_type in ('CLOSED', 'ESCALATED')
                  )
                """, base(principal));
        overdue.forEach(item -> insertBreach(principal, item, "CLOSE_OR_ESCALATION_LATE", BigDecimal.ONE,
                Map.of("deadlineMinutes", "MAJOR".equals(item.get("abnormality_level")) ? 120 : 240,
                        "detectedBy", "KPI_AUTOMATION")));
        return overdue.size();
    }

    private int processMissingInspections(TenantPrincipal principal) {
        List<Map<String, Object>> missing = jdbc.queryForList("""
                select relation.employee_id, relation.position_assignment_id as assignment_id,
                       scope.org_unit_id, current_date - 1 as business_date, schedule.time_slot,
                       channel.channel_code
                from kpi_assessment_relation relation
                join employee_position_assignment assignment on assignment.tenant_id = relation.tenant_id
                  and assignment.id = relation.position_assignment_id
                join position_definition position on position.tenant_id = assignment.tenant_id
                  and position.id = assignment.position_id and position.code = 'OTA_OPERATION_MANAGER'
                join kpi_relation_scope scope on scope.tenant_id = relation.tenant_id
                  and scope.relation_id = relation.id and scope.scope_type = 'STORE'
                  and scope.valid_from <= current_date - 1
                  and (scope.valid_to is null or scope.valid_to >= current_date - 1)
                cross join kpi_inspection_schedule schedule
                join lateral (
                    select channel_scope.channel_code
                    from kpi_relation_scope channel_scope
                    where channel_scope.tenant_id = relation.tenant_id
                      and channel_scope.relation_id = relation.id
                      and channel_scope.scope_type = 'CHANNEL'
                      and channel_scope.valid_from <= current_date - 1
                      and (channel_scope.valid_to is null or channel_scope.valid_to >= current_date - 1)
                    union all
                    select 'PRIMARY'
                    where not exists (
                        select 1
                        from kpi_relation_scope channel_scope
                        where channel_scope.tenant_id = relation.tenant_id
                          and channel_scope.relation_id = relation.id
                          and channel_scope.scope_type = 'CHANNEL'
                          and channel_scope.valid_from <= current_date - 1
                          and (channel_scope.valid_to is null or channel_scope.valid_to >= current_date - 1)
                    )
                ) channel on true
                where relation.tenant_id = :tenantId and relation.status = 'ACTIVE'
                  and schedule.tenant_id = relation.tenant_id and schedule.active = true
                  and not exists (
                    select 1 from kpi_inspection_submission submission
                    where submission.tenant_id = relation.tenant_id
                      and submission.assignment_id = relation.position_assignment_id
                      and submission.org_unit_id = scope.org_unit_id
                      and submission.business_date = current_date - 1
                      and submission.time_slot = schedule.time_slot
                      and submission.channel_code = channel.channel_code
                      and not exists (
                        select 1 from kpi_inspection_submission newer
                        where newer.tenant_id = submission.tenant_id and newer.supersedes_submission_id = submission.id
                      )
                  )
                """, base(principal));
        for (Map<String, Object> item : missing) {
            jdbc.update("""
                    insert into kpi_inspection_sla_breach
                        (id, tenant_id, employee_id, assignment_id, org_unit_id, business_date,
                         time_slot, channel_code, breach_type, deduction_units, source_snapshot)
                    values (:id, :tenantId, :employeeId, :assignmentId, :orgUnitId, :businessDate,
                            :timeSlot, :channelCode, 'MISSING_INSPECTION', 1,
                            '{"detectedBy":"KPI_AUTOMATION"}'::jsonb)
                    on conflict (tenant_id, assignment_id, org_unit_id, business_date, time_slot, channel_code, breach_type) do nothing
                    """, base(principal).addValue("id", UUID.randomUUID()).addValue("employeeId", item.get("employee_id"))
                    .addValue("assignmentId", item.get("assignment_id")).addValue("orgUnitId", item.get("org_unit_id"))
                    .addValue("businessDate", item.get("business_date")).addValue("timeSlot", item.get("time_slot"))
                    .addValue("channelCode", item.get("channel_code")));
        }
        return missing.size();
    }

    private void materializeDeductionFacts(TenantPrincipal principal) {
        List<Map<String, Object>> totals = jdbc.queryForList("""
                select breach.employee_id, breach.assignment_id, breach.business_date,
                       sum(breach.deduction_units) as deduction_units,
                       array_agg(breach.id order by breach.id) as breach_ids
                from kpi_inspection_sla_breach breach
                where breach.tenant_id = :tenantId
                  and breach.business_date >= date_trunc('month', current_date)::date
                group by breach.employee_id, breach.assignment_id, breach.business_date
                """, base(principal));
        UUID metricVersionId = jdbc.queryForObject("""
                select version.id
                from metric_definition_version version
                join metric_definition definition on definition.tenant_id = version.tenant_id
                  and definition.id = version.metric_definition_id
                where version.tenant_id = :tenantId and definition.code = 'OTA_INSPECTION_DEDUCTION_EVENTS'
                  and version.lifecycle_status = 'PUBLISHED'
                order by version.version_no desc limit 1
                """, base(principal), UUID.class);
        for (Map<String, Object> total : totals) {
            String idempotencyKey = "kpi:inspection:deduction:" + total.get("assignment_id") + ":" + total.get("business_date");
            String snapshot = json(Map.of("breachIds", String.valueOf(total.get("breach_ids")), "source", "KPI_INSPECTION_SLA"));
            jdbc.update("""
                    insert into kpi_metric_fact
                        (id, tenant_id, metric_version_id, employee_id, position_assignment_id,
                         business_date, value, data_state, source_type, source_record_id,
                         source_snapshot, content_hash, idempotency_key, created_by)
                    values (:id, :tenantId, :metricVersionId, :employeeId, :assignmentId,
                            :businessDate, :value, 'AVAILABLE', 'INSPECTION', :sourceRecordId,
                            cast(:snapshot as jsonb), :hash, :idempotencyKey, :actorId)
                    on conflict (tenant_id, idempotency_key) do nothing
                    """, base(principal).addValue("id", UUID.randomUUID()).addValue("metricVersionId", metricVersionId)
                    .addValue("employeeId", total.get("employee_id")).addValue("assignmentId", total.get("assignment_id"))
                    .addValue("businessDate", total.get("business_date")).addValue("value", total.get("deduction_units"))
                    .addValue("sourceRecordId", idempotencyKey).addValue("snapshot", snapshot)
                    .addValue("hash", KpiHashing.sha256(idempotencyKey + "|" + total.get("deduction_units") + "|" + snapshot))
                    .addValue("idempotencyKey", idempotencyKey).addValue("actorId", principal.actorId()));
        }
    }

    public record ProcessResult(int missingInspections, int confirmationBreaches, int actionBreaches, int closeBreaches) {
    }

    private void validateRequiredChecks(TenantPrincipal principal, String slot, List<KpiModels.InspectionCheck> checks) {
        Map<String, Object> schedule = schedule(principal, slot);
        if (!Boolean.TRUE.equals(schedule.get("active"))) throw new IllegalArgumentException("该巡检时段未启用");
        List<String> required;
        try {
            required = objectMapper.readValue(String.valueOf(schedule.get("required_checks")),
                    objectMapper.getTypeFactory().constructCollectionType(List.class, String.class));
        } catch (JsonProcessingException exception) {
            throw new IllegalStateException("巡检必查项配置不可解析", exception);
        }
        Set<String> submitted = checks.stream().map(KpiModels.InspectionCheck::code)
                .map(this::normalized).collect(java.util.stream.Collectors.toSet());
        List<String> missing = required.stream().map(this::normalized).filter(item -> !submitted.contains(item)).toList();
        if (!missing.isEmpty()) throw new IllegalArgumentException("巡检缺少必查项：" + String.join("、", missing));
    }

    private void validateEventOrder(TenantPrincipal principal, UUID submissionId, String eventType) {
        List<String> existing = jdbc.queryForList("""
                select event_type from kpi_inspection_abnormality_event
                where tenant_id = :tenantId and submission_id = :submissionId
                """, base(principal).addValue("submissionId", submissionId), String.class);
        if (existing.contains(eventType)) throw conflict("该异常事件已经留痕");
        if ("ACTION_SUBMITTED".equals(eventType) && !existing.contains("CONFIRMED")) {
            throw new IllegalArgumentException("必须先确认异常，再提交处理动作");
        }
        if (Set.of("CLOSED", "ESCALATED").contains(eventType) && !existing.contains("ACTION_SUBMITTED")) {
            throw new IllegalArgumentException("必须先提交处理动作，再关闭或升级交接");
        }
        if (Set.of("CLOSED", "ESCALATED").stream().anyMatch(existing::contains)) {
            throw conflict("异常已经关闭或升级交接");
        }
    }

    private void detectSlaBreaches(TenantPrincipal principal, UUID submissionId) {
        Map<String, Object> submission = submission(principal, submissionId);
        boolean major = "MAJOR".equals(submission.get("abnormality_level"));
        OffsetDateTime submittedAt = offset(submission.get("signed_at"));
        checkDeadline(principal, submission, "CONFIRMED", "CONFIRMATION_LATE", submittedAt, major ? 15 : 30, BigDecimal.ONE);
        checkDeadline(principal, submission, "ACTION_SUBMITTED", "ACTION_LATE", submittedAt, major ? 30 : 60, BigDecimal.ONE);
        OffsetDateTime completion = eventTime(principal, submissionId, "CLOSED", "ESCALATED");
        if (completion != null && Duration.between(submittedAt, completion).toMinutes() > (major ? 120 : 240)) {
            insertBreach(principal, submission, "CLOSE_OR_ESCALATION_LATE", BigDecimal.ONE,
                    Map.of("limitMinutes", major ? 120 : 240, "actualMinutes", Duration.between(submittedAt, completion).toMinutes()));
        }
    }

    private void checkDeadline(
            TenantPrincipal principal,
            Map<String, Object> submission,
            String eventType,
            String breachType,
            OffsetDateTime origin,
            long limitMinutes,
            BigDecimal units
    ) {
        OffsetDateTime actual = eventTime(principal, (UUID) submission.get("id"), eventType);
        if (actual != null && Duration.between(origin, actual).toMinutes() > limitMinutes) {
            insertBreach(principal, submission, breachType, units,
                    Map.of("limitMinutes", limitMinutes, "actualMinutes", Duration.between(origin, actual).toMinutes()));
        }
    }

    private OffsetDateTime eventTime(TenantPrincipal principal, UUID submissionId, String... eventTypes) {
        List<OffsetDateTime> values = jdbc.query("""
                select occurred_at from kpi_inspection_abnormality_event
                where tenant_id = :tenantId and submission_id = :submissionId
                  and event_type = any(cast(:eventTypes as varchar[]))
                order by occurred_at limit 1
                """, base(principal).addValue("submissionId", submissionId).addValue("eventTypes", eventTypes),
                (rs, rowNum) -> rs.getObject(1, OffsetDateTime.class));
        return values.isEmpty() ? null : values.getFirst();
    }

    private void insertBreach(
            TenantPrincipal principal,
            Map<String, Object> submission,
            String type,
            BigDecimal units,
            Map<String, ?> snapshot
    ) {
        jdbc.update("""
                insert into kpi_inspection_sla_breach
                    (id, tenant_id, submission_id, employee_id, assignment_id, org_unit_id,
                     business_date, time_slot, channel_code, breach_type, deduction_units, source_snapshot)
                values (:id, :tenantId, :submissionId, :employeeId, :assignmentId, :orgUnitId,
                        :businessDate, :timeSlot, :channelCode, :type, :units, cast(:snapshot as jsonb))
                on conflict (tenant_id, assignment_id, org_unit_id, business_date, time_slot, channel_code, breach_type) do nothing
                """, base(principal).addValue("id", UUID.randomUUID()).addValue("submissionId", submission.get("id"))
                .addValue("employeeId", submission.get("employee_id")).addValue("assignmentId", submission.get("assignment_id"))
                .addValue("orgUnitId", submission.get("org_unit_id")).addValue("businessDate", submission.get("business_date"))
                .addValue("timeSlot", submission.get("time_slot")).addValue("channelCode", submission.get("channel_code"))
                .addValue("type", type).addValue("units", units).addValue("snapshot", json(snapshot)));
    }

    private Map<String, Object> submission(TenantPrincipal principal, UUID submissionId) {
        return jdbc.queryForMap("""
                select * from kpi_inspection_submission where tenant_id = :tenantId and id = :id
                """, base(principal).addValue("id", submissionId));
    }

    private Map<String, Object> schedule(TenantPrincipal principal, String slot) {
        return jdbc.queryForMap("""
                select * from kpi_inspection_schedule where tenant_id = :tenantId and time_slot = :slot
                """, base(principal).addValue("slot", slot));
    }

    private String slot(String value) {
        String normalized = normalized(value);
        if (!SLOTS.contains(normalized)) throw new IllegalArgumentException("不支持的巡检时段：" + normalized);
        return normalized;
    }

    private String normalized(String value) {
        return value == null ? "" : value.trim().toUpperCase(Locale.ROOT);
    }

    private String normalizedOrNull(String value) {
        String normalized = normalized(value);
        return normalized.isEmpty() ? null : normalized;
    }

    private boolean blank(String value) {
        return value == null || value.isBlank();
    }

    private OffsetDateTime offset(Object value) {
        if (value instanceof OffsetDateTime offsetDateTime) return offsetDateTime;
        if (value instanceof java.sql.Timestamp timestamp) return timestamp.toInstant().atZone(BUSINESS_ZONE).toOffsetDateTime();
        return OffsetDateTime.parse(String.valueOf(value));
    }

    private TenantPrincipal prepare() {
        TenantPrincipal principal = accessPolicy.principal();
        databaseContext.apply(principal.tenantId());
        return principal;
    }

    private MapSqlParameterSource base(TenantPrincipal principal) {
        return new MapSqlParameterSource("tenantId", principal.tenantId());
    }

    private String json(Object value) {
        try {
            return objectMapper.writeValueAsString(value == null ? Map.of() : value);
        } catch (JsonProcessingException exception) {
            throw new IllegalArgumentException("内容无法序列化", exception);
        }
    }

    private Object jsonValue(Object value, Object fallback) {
        if (value == null) return fallback;
        try {
            return objectMapper.readValue(value.toString(), Object.class);
        } catch (JsonProcessingException exception) {
            throw new IllegalStateException("数据库中的巡检JSON配置无效", exception);
        }
    }

    private ResponseStatusException conflict(String message) {
        return new ResponseStatusException(HttpStatus.CONFLICT, message);
    }
}
