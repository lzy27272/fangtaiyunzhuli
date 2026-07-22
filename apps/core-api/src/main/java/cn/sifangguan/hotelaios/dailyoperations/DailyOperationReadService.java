package cn.sifangguan.hotelaios.dailyoperations;

import cn.sifangguan.hotelaios.dailyoperations.OperationIntelligenceModels.ActionItemView;
import cn.sifangguan.hotelaios.dailyoperations.OperationIntelligenceModels.DailyOperationOverview;
import cn.sifangguan.hotelaios.dailyoperations.OperationIntelligenceModels.IssueSummary;
import cn.sifangguan.hotelaios.dailyoperations.OperationIntelligenceModels.OperationMetric;
import cn.sifangguan.hotelaios.shared.context.TenantPrincipal;
import cn.sifangguan.hotelaios.shared.security.AccessPolicy;
import cn.sifangguan.hotelaios.shared.time.BusinessDayService;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.UUID;

/** Read model for the real-time daily-operation overview and personal action queue. */
@Service
public class DailyOperationReadService {
    private static final Set<String> ACTION_STATUSES = Set.of(
            "OPEN", "ACKNOWLEDGED", "COMPLETED", "CANCELLED");

    private final NamedParameterJdbcTemplate jdbc;
    private final AccessPolicy accessPolicy;
    private final OperationScopeService scopes;
    private final BusinessDayService businessDayService;

    public DailyOperationReadService(
            NamedParameterJdbcTemplate jdbc,
            AccessPolicy accessPolicy,
            OperationScopeService scopes,
            BusinessDayService businessDayService
    ) {
        this.jdbc = jdbc;
        this.accessPolicy = accessPolicy;
        this.scopes = scopes;
        this.businessDayService = businessDayService;
    }

    @Transactional(readOnly = true)
    public DailyOperationOverview realTimeOverview(UUID orgUnitId, LocalDate requestedBusinessDate) {
        accessPolicy.requirePermission("daily-operation.read");
        TenantPrincipal principal = scopes.prepare();
        OperationScopeService.OrgSelection selected = scopes.resolveOrg(principal, orgUnitId);
        BusinessDayService.BusinessDayContext businessDay =
                businessDayService.resolve(selected.id(), requestedBusinessDate);
        OffsetDateTime generatedAt = OffsetDateTime.now(ZoneOffset.UTC);

        MapSqlParameterSource params = scopes.base(principal)
                .addValue("selectedOrgId", selected.id())
                .addValue("hotelId", businessDay.hotelOrgUnitId())
                .addValue("businessDate", businessDay.businessDate())
                .addValue("actorId", principal.actorId());

        List<OperationMetric> metrics = metricRows(params);
        List<IssueSummary> issues = issueRows(params, 100);
        long actionItemCount = actionRows(
                principal, selected.id(), businessDay.businessDate(), null).size();
        long unresolvedIssueCount = scalar("""
                select count(*) from issue_event issue
                where issue.tenant_id = :tenantId and issue.business_date = :businessDate
                  and issue.lifecycle_status <> 'CLOSED'
                  and exists (
                    select 1 from org_unit_closure visible
                    where visible.tenant_id = issue.tenant_id
                      and visible.ancestor_id = :selectedOrgId
                      and visible.descendant_id = issue.org_unit_id
                  )
                """, params);
        long overdueCount = scalar("""
                select count(*) from issue_event issue
                where issue.tenant_id = :tenantId and issue.business_date = :businessDate
                  and issue.lifecycle_status <> 'CLOSED'
                  and issue.due_at is not null and issue.due_at < now()
                  and exists (
                    select 1 from org_unit_closure visible
                    where visible.tenant_id = issue.tenant_id
                      and visible.ancestor_id = :selectedOrgId
                      and visible.descendant_id = issue.org_unit_id
                  )
                """, params);
        long pendingTaskCandidateCount = scalar("""
                select count(*) from task_candidate candidate
                where candidate.tenant_id = :tenantId and candidate.business_date = :businessDate
                  and candidate.status = 'PENDING_CONFIRMATION'
                  and exists (
                    select 1 from org_unit_closure visible
                    where visible.tenant_id = candidate.tenant_id
                      and visible.ancestor_id = :selectedOrgId
                      and visible.descendant_id = candidate.org_unit_id
                  )
                """, params);

        return new DailyOperationOverview(
                selected.id(), selected.name(), businessDay.businessDate(), businessDay.timezone(),
                "REALTIME", null, generatedAt, generatedAt, List.of(), metrics, issues,
                actionItemCount, unresolvedIssueCount, overdueCount, pendingTaskCandidateCount);
    }

    @Transactional(readOnly = true)
    public List<ActionItemView> actionItems(
            UUID orgUnitId,
            LocalDate businessDate,
            String requestedStatus
    ) {
        accessPolicy.requirePermission("daily-operation.read");
        TenantPrincipal principal = scopes.prepare();
        String status = normalizeStatus(requestedStatus);
        if (orgUnitId != null) scopes.resolveOrg(principal, orgUnitId);
        return actionRows(principal, orgUnitId, businessDate, status);
    }

    private List<ActionItemView> actionRows(
            TenantPrincipal principal,
            UUID orgUnitId,
            LocalDate businessDate,
            String status
    ) {
        MapSqlParameterSource params = scopes.visibility(principal)
                .addValue("actorId", principal.actorId())
                .addValue("orgUnitId", orgUnitId)
                .addValue("businessDate", businessDate)
                .addValue("status", status)
                .addValue("canSubmitReport", permitted(principal, "daily-report.submit"))
                .addValue("canReviewReport", permitted(principal, "daily-report.review")
                        || permitted(principal, "daily-report.revision-review"))
                .addValue("canConfirmIssue", permitted(principal, "issue.confirm"))
                .addValue("canHandleIssue", permitted(principal, "issue.assign")
                        || permitted(principal, "issue.close") || permitted(principal, "issue.reopen"))
                .addValue("canConfirmCandidate", permitted(principal, "task-candidate.confirm"))
                .addValue("canRetrySync", permitted(principal, "task-candidate.retry"));
        return jdbc.query("""
                with queue as (
                  select item.id, item.action_type, item.title, item.summary, item.severity,
                         item.source_type, item.source_id, owner_employee.name as owner_name,
                         item.due_at, item.status, latest_sync.status as sync_status,
                         item.org_unit_id, item.business_date, item.recipient_account_id,
                         item.created_at, 0 as projection_priority
                  from action_item item
                  left join employee_position_assignment owner
                    on owner.tenant_id = item.tenant_id and owner.id = item.owner_assignment_id
                  left join employee owner_employee
                    on owner_employee.tenant_id = owner.tenant_id and owner_employee.id = owner.employee_id
                  left join lateral (
                    select operation.status
                    from sync_operation operation
                    where operation.tenant_id = item.tenant_id
                      and operation.aggregate_type = 'TASK_CANDIDATE'
                      and operation.aggregate_id = item.source_id
                    order by operation.created_at desc
                    limit 1
                  ) latest_sync on true
                  where item.tenant_id = :tenantId

                  union all

                  select issue.id, 'ISSUE_CONFIRMATION', concat('确认异常：', issue.title),
                         issue.description, issue.severity, 'ISSUE', issue.id,
                         owner_employee.name, issue.due_at, 'OPEN', null,
                         issue.org_unit_id, issue.business_date, recipient_employee.account_id,
                         issue.created_at, 1
                  from issue_event issue
                  join employee_position_assignment recipient_assignment
                    on recipient_assignment.tenant_id = issue.tenant_id
                   and recipient_assignment.id = coalesce(
                         issue.acceptance_assignment_id, issue.owner_assignment_id)
                   and recipient_assignment.status = 'ACTIVE'
                  join employee recipient_employee
                    on recipient_employee.tenant_id = recipient_assignment.tenant_id
                   and recipient_employee.id = recipient_assignment.employee_id
                   and recipient_employee.account_id is not null
                  left join employee_position_assignment owner_assignment
                    on owner_assignment.tenant_id = issue.tenant_id
                   and owner_assignment.id = issue.owner_assignment_id
                  left join employee owner_employee
                    on owner_employee.tenant_id = owner_assignment.tenant_id
                   and owner_employee.id = owner_assignment.employee_id
                  where issue.tenant_id = :tenantId and issue.lifecycle_status = 'CANDIDATE'

                  union all

                  select issue.id, 'ISSUE_ACTION', concat('处理异常：', issue.title),
                         issue.description, issue.severity, 'ISSUE', issue.id,
                         owner_employee.name, issue.due_at, 'OPEN', null,
                         issue.org_unit_id, issue.business_date, owner_employee.account_id,
                         issue.updated_at, 1
                  from issue_event issue
                  join employee_position_assignment owner_assignment
                    on owner_assignment.tenant_id = issue.tenant_id
                   and owner_assignment.id = issue.owner_assignment_id
                   and owner_assignment.status = 'ACTIVE'
                  join employee owner_employee
                    on owner_employee.tenant_id = owner_assignment.tenant_id
                   and owner_employee.id = owner_assignment.employee_id
                   and owner_employee.account_id is not null
                  where issue.tenant_id = :tenantId
                    and issue.lifecycle_status in ('CONFIRMED', 'IN_PROGRESS', 'PENDING_CLOSE')

                  union all

                  select candidate.id, 'TASK_CANDIDATE_CONFIRMATION',
                         concat('确认任务候选：', candidate.title), candidate.description,
                         case candidate.priority when 'URGENT' then 'MAJOR'
                              when 'HIGH' then 'IMPORTANT' else 'GENERAL' end,
                         'TASK_CANDIDATE', candidate.id, assignee_employee.name,
                         candidate.due_at, 'OPEN', null, candidate.org_unit_id,
                         candidate.business_date, reviewer_employee.account_id,
                         candidate.created_at, 1
                  from task_candidate candidate
                  join employee_position_assignment reviewer
                    on reviewer.tenant_id = candidate.tenant_id
                   and reviewer.id = candidate.reviewer_assignment_id and reviewer.status = 'ACTIVE'
                  join employee reviewer_employee
                    on reviewer_employee.tenant_id = reviewer.tenant_id
                   and reviewer_employee.id = reviewer.employee_id
                   and reviewer_employee.account_id is not null
                  left join employee_position_assignment assignee
                    on assignee.tenant_id = candidate.tenant_id
                   and assignee.id = candidate.assignee_assignment_id
                  left join employee assignee_employee
                    on assignee_employee.tenant_id = assignee.tenant_id
                   and assignee_employee.id = assignee.employee_id
                  where candidate.tenant_id = :tenantId
                    and candidate.status = 'PENDING_CONFIRMATION'

                  union all

                  select candidate.id, 'SYNC_RETRY', concat('重试任务同步：', candidate.title),
                         operation.last_error,
                         case candidate.priority when 'URGENT' then 'MAJOR'
                              when 'HIGH' then 'IMPORTANT' else 'GENERAL' end,
                         'TASK_CANDIDATE', candidate.id, assignee_employee.name,
                         operation.next_retry_at, 'OPEN', operation.status,
                         candidate.org_unit_id, candidate.business_date,
                         reviewer_employee.account_id, operation.updated_at, 1
                  from task_candidate candidate
                  join lateral (
                    select sync.status, sync.last_error, sync.next_retry_at, sync.updated_at
                    from sync_operation sync
                    where sync.tenant_id = candidate.tenant_id
                      and sync.aggregate_type = 'TASK_CANDIDATE'
                      and sync.aggregate_id = candidate.id
                    order by sync.created_at desc
                    limit 1
                  ) operation on operation.status in ('FAILED', 'MANUAL_INTERVENTION')
                  join employee_position_assignment reviewer
                    on reviewer.tenant_id = candidate.tenant_id
                   and reviewer.id = candidate.reviewer_assignment_id and reviewer.status = 'ACTIVE'
                  join employee reviewer_employee
                    on reviewer_employee.tenant_id = reviewer.tenant_id
                   and reviewer_employee.id = reviewer.employee_id
                   and reviewer_employee.account_id is not null
                  left join employee_position_assignment assignee
                    on assignee.tenant_id = candidate.tenant_id
                   and assignee.id = candidate.assignee_assignment_id
                  left join employee assignee_employee
                    on assignee_employee.tenant_id = assignee.tenant_id
                   and assignee_employee.id = assignee.employee_id
                  where candidate.tenant_id = :tenantId
                    and candidate.status = 'PENDING_SYNC'

                  union all

                  select report.id, 'REPORT_SUBMISSION', '提交岗位日报',
                         concat('营业日 ', report.business_date, ' 的岗位日报尚未提交'),
                         'GENERAL', 'DAILY_REPORT', report.id, employee.name,
                         report.report_deadline_at, 'OPEN', null, report.org_unit_id,
                         report.business_date, employee.account_id, report.updated_at, 1
                  from daily_report report
                  join employee_position_assignment assignment
                    on assignment.tenant_id = report.tenant_id
                   and assignment.id = report.position_assignment_id and assignment.status = 'ACTIVE'
                  join employee
                    on employee.tenant_id = assignment.tenant_id
                   and employee.id = assignment.employee_id and employee.account_id is not null
                  where report.tenant_id = :tenantId and report.report_status = 'DRAFT'

                  union all

                  select report.id, 'REPORT_REVIEW', '审核岗位日报',
                         concat(employee.name, ' 的 ', report.business_date, ' 日报待审核'),
                         'IMPORTANT', 'DAILY_REPORT', report.id, employee.name,
                         null, 'OPEN', null, report.org_unit_id, report.business_date,
                         manager_employee.account_id, report.updated_at, 1
                  from daily_report report
                  join employee_position_assignment assignment
                    on assignment.tenant_id = report.tenant_id
                   and assignment.id = report.position_assignment_id
                  join employee
                    on employee.tenant_id = assignment.tenant_id and employee.id = assignment.employee_id
                  join employee_position_assignment manager
                    on manager.tenant_id = assignment.tenant_id
                   and manager.id = assignment.manager_assignment_id and manager.status = 'ACTIVE'
                  join employee manager_employee
                    on manager_employee.tenant_id = manager.tenant_id
                   and manager_employee.id = manager.employee_id
                   and manager_employee.account_id is not null
                  where report.tenant_id = :tenantId and report.report_status = 'SUBMITTED'
                    and report.review_status = 'PENDING'
                ), deduplicated as (
                  select distinct on (action_type, source_type, source_id, recipient_account_id)
                         id, action_type, title, summary, severity, source_type, source_id,
                         owner_name, due_at, status, sync_status, org_unit_id, business_date,
                         recipient_account_id, created_at
                  from queue
                  order by action_type, source_type, source_id, recipient_account_id,
                           case status when 'OPEN' then 0 when 'ACKNOWLEDGED' then 1 else 2 end,
                           projection_priority, created_at
                )
                select id, action_type, title, summary, severity, source_type, source_id,
                       owner_name, due_at, status, sync_status
                from deduplicated item
                where item.recipient_account_id = :actorId
                  and (:tenantScope or item.org_unit_id in (:orgScopes))
                  and (cast(:businessDate as date) is null or item.business_date = :businessDate)
                  and (
                    (cast(:status as varchar) is null and item.status in ('OPEN', 'ACKNOWLEDGED'))
                    or item.status = :status
                  )
                  and (cast(:orgUnitId as uuid) is null or exists (
                    select 1 from org_unit_closure selected_scope
                    where selected_scope.tenant_id = :tenantId
                      and selected_scope.ancestor_id = :orgUnitId
                      and selected_scope.descendant_id = item.org_unit_id
                  ))
                  and case item.action_type
                    when 'REPORT_SUBMISSION' then :canSubmitReport
                    when 'REPORT_REVIEW' then :canReviewReport
                    when 'REVISION_REVIEW' then :canReviewReport
                    when 'ISSUE_CONFIRMATION' then :canConfirmIssue
                    when 'ISSUE_ACTION' then :canHandleIssue
                    when 'TASK_CANDIDATE_CONFIRMATION' then :canConfirmCandidate
                    when 'SYNC_RETRY' then :canRetrySync
                    when 'MAJOR_ACKNOWLEDGEMENT' then :canHandleIssue
                    else false
                  end
                order by case item.severity when 'MAJOR' then 0 when 'IMPORTANT' then 1 else 2 end,
                         item.due_at nulls last, item.created_at
                limit 500
                """, params, (rs, rowNum) -> {
            String itemStatus = rs.getString("status");
            String severity = rs.getString("severity");
            return new ActionItemView(
                    rs.getObject("id", UUID.class),
                    rs.getString("action_type"),
                    rs.getString("title"),
                    rs.getString("summary"),
                    severity,
                    rs.getString("source_type"),
                    rs.getObject("source_id", UUID.class),
                    rs.getString("owner_name"),
                    rs.getObject("due_at", OffsetDateTime.class),
                    escalationLevel(severity),
                    rs.getString("sync_status"),
                    allowedActions(itemStatus));
        });
    }

    private List<OperationMetric> metricRows(MapSqlParameterSource params) {
        return jdbc.query("""
                select definition.code, definition.name, definition.unit,
                       observation.value, observation.source_type, observation.quality_status
                from metric_definition definition
                left join lateral (
                  select candidate.value, candidate.source_type, candidate.quality_status
                  from metric_observation candidate
                  where candidate.tenant_id = definition.tenant_id
                    and candidate.metric_id = definition.id
                    and candidate.hotel_org_unit_id = :hotelId
                    and candidate.business_date = :businessDate
                  order by candidate.created_at desc, candidate.id desc
                  limit 1
                ) observation on true
                where definition.tenant_id = :tenantId and definition.status = 'ACTIVE'
                order by definition.code
                limit 50
                """, params, (rs, rowNum) -> {
            BigDecimal value = rs.getBigDecimal("value");
            String source = value == null
                    ? "NO_DATA"
                    : rs.getString("source_type") + "/" + rs.getString("quality_status");
            return new OperationMetric(
                    rs.getString("code"), rs.getString("name"), value,
                    rs.getString("unit"), value != null, source);
        });
    }

    private List<IssueSummary> issueRows(MapSqlParameterSource params, int limit) {
        params.addValue("limit", limit);
        return jdbc.query("""
                select issue.id, issue.issue_no, issue.title, issue.description, issue.severity,
                       issue.lifecycle_status, issue.owner_assignment_id,
                       issue.acceptance_assignment_id, owner_employee.name as owner_name,
                       hotel.name as hotel_name, issue.business_date, issue.due_at,
                       issue.updated_at, issue.row_version,
                       (select count(*) from issue_source_link source
                        where source.tenant_id = issue.tenant_id and source.issue_id = issue.id
                          and source.invalidated_at is null) as source_count,
                       (select count(*) from issue_task_link task
                        where task.tenant_id = issue.tenant_id and task.issue_id = issue.id) as task_count
                from issue_event issue
                join org_unit hotel
                  on hotel.tenant_id = issue.tenant_id and hotel.id = issue.hotel_org_unit_id
                left join employee_position_assignment owner_assignment
                  on owner_assignment.tenant_id = issue.tenant_id
                 and owner_assignment.id = issue.owner_assignment_id
                left join employee owner_employee
                  on owner_employee.tenant_id = owner_assignment.tenant_id
                 and owner_employee.id = owner_assignment.employee_id
                where issue.tenant_id = :tenantId and issue.business_date = :businessDate
                  and issue.lifecycle_status <> 'CLOSED'
                  and exists (
                    select 1 from org_unit_closure visible
                    where visible.tenant_id = issue.tenant_id
                      and visible.ancestor_id = :selectedOrgId
                      and visible.descendant_id = issue.org_unit_id
                  )
                order by case issue.severity when 'MAJOR' then 0 when 'IMPORTANT' then 1 else 2 end,
                         issue.due_at nulls last, issue.updated_at desc
                limit :limit
                """, params, (rs, rowNum) -> {
            OffsetDateTime dueAt = rs.getObject("due_at", OffsetDateTime.class);
            String lifecycleStatus = rs.getString("lifecycle_status");
            boolean overdue = dueAt != null && dueAt.isBefore(OffsetDateTime.now(ZoneOffset.UTC))
                    && !"CLOSED".equals(lifecycleStatus);
            return new IssueSummary(
                    rs.getObject("id", UUID.class), rs.getString("issue_no"),
                    rs.getString("title"), rs.getString("description"), rs.getString("severity"),
                    lifecycleStatus, rs.getString("owner_name"),
                    rs.getObject("owner_assignment_id", UUID.class),
                    rs.getObject("acceptance_assignment_id", UUID.class), rs.getString("hotel_name"),
                    rs.getObject("business_date", LocalDate.class), dueAt, overdue,
                    rs.getLong("source_count"), rs.getLong("task_count"),
                    rs.getObject("updated_at", OffsetDateTime.class), rs.getLong("row_version"));
        });
    }

    private long scalar(String sql, MapSqlParameterSource params) {
        Long result = jdbc.queryForObject(sql, params, Long.class);
        return result == null ? 0L : result;
    }

    private static String normalizeStatus(String value) {
        if (value == null || value.isBlank()) return null;
        String normalized = value.trim().toUpperCase(Locale.ROOT);
        if (!ACTION_STATUSES.contains(normalized)) {
            throw new IllegalArgumentException("不支持的行动项状态: " + value);
        }
        return normalized;
    }

    private static int escalationLevel(String severity) {
        return switch (severity) {
            case "MAJOR" -> 2;
            case "IMPORTANT" -> 1;
            default -> 0;
        };
    }

    private static List<String> allowedActions(String status) {
        return switch (status) {
            case "OPEN" -> List.of("ACKNOWLEDGE", "COMPLETE");
            case "ACKNOWLEDGED" -> List.of("COMPLETE");
            default -> List.of();
        };
    }

    private static boolean permitted(TenantPrincipal principal, String permission) {
        return principal.hasPermission(permission) || principal.hasPermission("*");
    }
}
