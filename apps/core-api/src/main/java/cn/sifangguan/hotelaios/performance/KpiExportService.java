package cn.sifangguan.hotelaios.performance;

import cn.sifangguan.hotelaios.shared.audit.AuditWriter;
import cn.sifangguan.hotelaios.shared.context.TenantContext;
import cn.sifangguan.hotelaios.shared.context.TenantPrincipal;
import cn.sifangguan.hotelaios.shared.db.TenantDatabaseContext;
import cn.sifangguan.hotelaios.shared.security.AccessPolicy;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.nio.charset.StandardCharsets;
import java.time.LocalDate;
import java.util.List;
import java.util.Map;
import java.util.UUID;

@Service
public class KpiExportService {
    private final NamedParameterJdbcTemplate jdbc;
    private final TenantDatabaseContext databaseContext;
    private final AccessPolicy accessPolicy;
    private final AuditWriter auditWriter;

    public KpiExportService(
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

    @Transactional
    public ExportFile scorecards(UUID periodId) {
        accessPolicy.requirePermission("kpi.export");
        TenantPrincipal principal = prepare();
        List<Map<String, Object>> rows = jdbc.queryForList("""
                select period.month_start, card.card_type, card.week_no,
                       card.period_start, card.period_end, employee.employee_no,
                       employee.name as employee_name, position.name as position_name,
                       org.name as org_name, card.status, card.warning_level,
                       card.base_score, card.extra_score, card.final_score,
                       card.current_revision_no, revision.data_state,
                       indicator.section_code, indicator.indicator_code,
                       rule.name as indicator_name, indicator.target_value,
                       indicator.actual_value, indicator.numerator, indicator.denominator,
                       indicator.score as indicator_score, indicator.max_score,
                       indicator.min_score, indicator.outcome
                from kpi_scorecard card
                join kpi_period period on period.tenant_id = card.tenant_id and period.id = card.period_id
                join kpi_responsibility_snapshot snapshot
                  on snapshot.tenant_id = card.tenant_id and snapshot.id = card.responsibility_snapshot_id
                join employee on employee.tenant_id = snapshot.tenant_id and employee.id = snapshot.employee_id
                join employee_position_assignment assignment
                  on assignment.tenant_id = snapshot.tenant_id and assignment.id = snapshot.position_assignment_id
                join position_definition position
                  on position.tenant_id = assignment.tenant_id and position.id = assignment.position_id
                join org_unit org on org.tenant_id = assignment.tenant_id and org.id = assignment.org_unit_id
                left join kpi_scorecard_revision revision
                  on revision.tenant_id = card.tenant_id and revision.scorecard_id = card.id
                 and revision.revision_no = card.current_revision_no
                left join kpi_indicator_result indicator
                  on indicator.tenant_id = revision.tenant_id and indicator.scorecard_revision_id = revision.id
                left join kpi_indicator_rule rule
                  on rule.tenant_id = indicator.tenant_id and rule.id = indicator.indicator_rule_id
                where card.tenant_id = :tenantId
                  and (cast(:periodId as uuid) is null or card.period_id = :periodId)
                order by period.month_start desc, employee.name, card.card_type, card.week_no,
                         indicator.section_code, rule.sort_order
                """, base(principal).addValue("periodId", periodId));
        List<String> headers = List.of(
                "考核月份", "考核单类型", "周次", "开始日期", "结束日期", "员工编号", "员工姓名", "岗位",
                "组织/门店", "状态", "预警等级", "基础得分", "额外加减分", "最终得分", "修订号", "数据状态",
                "板块编码", "指标编码", "指标名称", "目标值", "实际值", "分子", "分母", "指标得分", "指标满分",
                "指标最低分", "判定结果");
        List<String> keys = List.of(
                "month_start", "card_type", "week_no", "period_start", "period_end", "employee_no", "employee_name",
                "position_name", "org_name", "status", "warning_level", "base_score", "extra_score", "final_score",
                "current_revision_no", "data_state", "section_code", "indicator_code", "indicator_name", "target_value",
                "actual_value", "numerator", "denominator", "indicator_score", "max_score", "min_score", "outcome");
        UUID exportId = UUID.randomUUID();
        auditWriter.record("KPI_SCORECARD_EXPORTED", "KPI_EXPORT", exportId,
                "{\"exportType\":\"SCORECARD_DETAIL\",\"rowCount\":" + rows.size() + "}");
        return csv("KPI考核结果明细_" + LocalDate.now() + ".csv", headers, keys, rows);
    }

    @Transactional
    public ExportFile settlements(UUID periodId) {
        accessPolicy.requirePermission("kpi.export");
        TenantPrincipal principal = prepare();
        List<Map<String, Object>> rows = jdbc.queryForList("""
                select period.month_start, employee.employee_no, employee.name as employee_name,
                       position.name as position_name, org.name as org_name, card.final_score,
                       settlement.original_bonus_base, settlement.bonus_adjustment,
                       settlement.adjusted_bonus_base, settlement.performance_coefficient,
                       settlement.attendance_coefficient, settlement.payable_bonus,
                       settlement.status, settlement.locked_at
                from kpi_settlement settlement
                join kpi_period period on period.tenant_id = settlement.tenant_id and period.id = settlement.period_id
                join employee on employee.tenant_id = settlement.tenant_id and employee.id = settlement.employee_id
                join kpi_scorecard card on card.tenant_id = settlement.tenant_id and card.id = settlement.scorecard_id
                join kpi_responsibility_snapshot snapshot
                  on snapshot.tenant_id = card.tenant_id and snapshot.id = card.responsibility_snapshot_id
                join employee_position_assignment assignment
                  on assignment.tenant_id = snapshot.tenant_id and assignment.id = snapshot.position_assignment_id
                join position_definition position
                  on position.tenant_id = assignment.tenant_id and position.id = assignment.position_id
                join org_unit org on org.tenant_id = assignment.tenant_id and org.id = assignment.org_unit_id
                where settlement.tenant_id = :tenantId
                  and (cast(:periodId as uuid) is null or settlement.period_id = :periodId)
                order by period.month_start desc, employee.name
                """, base(principal).addValue("periodId", periodId));
        List<String> headers = List.of(
                "考核月份", "员工编号", "员工姓名", "岗位", "组织/门店", "最终得分", "原奖金基数", "岗位专属加减",
                "调整后基数", "绩效系数", "正常出勤系数", "应发绩效奖金", "状态", "锁定时间");
        List<String> keys = List.of(
                "month_start", "employee_no", "employee_name", "position_name", "org_name", "final_score",
                "original_bonus_base", "bonus_adjustment", "adjusted_bonus_base", "performance_coefficient",
                "attendance_coefficient", "payable_bonus", "status", "locked_at");
        UUID exportId = UUID.randomUUID();
        auditWriter.record("KPI_SETTLEMENT_EXPORTED", "KPI_EXPORT", exportId,
                "{\"exportType\":\"SETTLEMENT\",\"rowCount\":" + rows.size() + "}");
        return csv("KPI奖金结算_" + LocalDate.now() + ".csv", headers, keys, rows);
    }

    private ExportFile csv(String name, List<String> headers, List<String> keys, List<Map<String, Object>> rows) {
        StringBuilder content = new StringBuilder("\ufeff");
        appendRow(content, headers);
        for (Map<String, Object> row : rows) {
            appendRow(content, keys.stream().map(key -> stringify(row.get(key))).toList());
        }
        return new ExportFile(name, "text/csv;charset=UTF-8", content.toString().getBytes(StandardCharsets.UTF_8));
    }

    private void appendRow(StringBuilder target, List<String> values) {
        for (int index = 0; index < values.size(); index++) {
            if (index > 0) target.append(',');
            String value = values.get(index);
            target.append('"').append(value.replace("\"", "\"\"")).append('"');
        }
        target.append("\r\n");
    }

    private String stringify(Object value) {
        return value == null ? "" : value.toString();
    }

    private TenantPrincipal prepare() {
        TenantPrincipal principal = TenantContext.require();
        databaseContext.apply(principal.tenantId());
        return principal;
    }

    private MapSqlParameterSource base(TenantPrincipal principal) {
        return new MapSqlParameterSource().addValue("tenantId", principal.tenantId());
    }

    public record ExportFile(String name, String mediaType, byte[] content) {
    }
}
