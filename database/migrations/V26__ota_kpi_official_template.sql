-- Official OTA operation manager KPI template and reusable KPI metric catalog.
-- Other first-wave positions use the same configurable engine but are intentionally not
-- assigned this role-specific template.

DO $$
DECLARE
    tenant_record RECORD;
    metric_record RECORD;
    v_actor UUID;
    v_owner_org UUID;
    v_position UUID;
    v_category UUID;
    v_standard UUID;
    v_standard_version UUID;
    v_policy UUID;
    v_policy_version UUID;
    v_template UUID;
    v_template_version UUID;
    v_section UUID;
    v_effective_month DATE := date_trunc('month', CURRENT_DATE)::date;
BEGIN
    FOR tenant_record IN SELECT id FROM tenant WHERE status = 'ACTIVE' LOOP
        PERFORM set_config('app.tenant_id', tenant_record.id::text, true);

        SELECT id INTO v_actor FROM user_account
        WHERE tenant_id = tenant_record.id AND status = 'ACTIVE'
        ORDER BY created_at LIMIT 1;
        SELECT id INTO v_owner_org FROM org_unit
        WHERE tenant_id = tenant_record.id AND unit_type = 'GROUP' AND status = 'ACTIVE'
        ORDER BY sort_order, created_at LIMIT 1;
        SELECT id INTO v_position FROM position_definition
        WHERE tenant_id = tenant_record.id AND code = 'OTA_OPERATION_MANAGER';

        IF v_actor IS NULL OR v_position IS NULL THEN
            CONTINUE;
        END IF;

        FOR metric_record IN
            SELECT * FROM (VALUES
                ('OTA_OCCUPANCY_95_STORE_SHARE', '出租率达到95%的门店占比', 'ratio', 'RATIO', '负责门店中月累计出租率达到95%的门店数/全部负责门店数；钟点房不计入', 'DERIVED', 'HIGHER_BETTER'),
                ('OTA_OCCUPANCY_EXTRA_SCORE', '出租率额外加分', 'score', 'LAST', '全部门店达到98%记2分；全部达到95%且至少50%门店达到98%记1分；否则0分', 'DERIVED', 'HIGHER_BETTER'),
                ('OTA_REMEDIATION_PLAN_RATE', '差店整改计划确认率', 'ratio', 'RATIO', '预警差店在时限内提交计划并经负责人确认的比例', 'REMEDIATION', 'HIGHER_BETTER'),
                ('OTA_REMEDIATION_EXECUTION_RATE', '差店整改任务落地率', 'ratio', 'RATIO', '已确认整改任务按期落地并具有证据的比例', 'REMEDIATION', 'HIGHER_BETTER'),
                ('OTA_REMEDIATION_WEEKLY_REVIEW_RATE', '差店每周复盘完成率', 'ratio', 'RATIO', '差店整改期间每周按期提交数据复盘与优化回报的比例', 'REMEDIATION', 'HIGHER_BETTER'),
                ('OTA_REMEDIATION_ACCEPTANCE_RATE', '差店整改验收通过率', 'ratio', 'RATIO', '到期整改批次达到冻结验收标准的比例', 'REMEDIATION', 'HIGHER_BETTER'),
                ('OTA_INSPECTION_DEDUCTION_EVENTS', 'OTA巡检扣分事件数', 'event', 'SUM', '三时段巡检缺失、虚假正常、超时处置及异常未闭环按规则折算后的扣分事件', 'INSPECTION', 'LOWER_BETTER'),
                ('COMPANY_TASK_ON_TIME_RATE', '运营计划及公司任务按时完成率', 'ratio', 'RATIO', '纳入周期的有效到期任务按期验收通过数/有效到期任务数', 'TASK', 'HIGHER_BETTER'),
                ('OTA_REVPAR_100_STORE_COUNT', 'RevPAR达到目标100%的门店数', 'store', 'SUM', 'OTA运营经理负责门店中月累计RevPAR达到目标100%的门店数', 'PMS', 'HIGHER_BETTER'),
                ('OTA_REVPAR_BELOW_85_STORE_COUNT', 'RevPAR低于目标85%的门店数', 'store', 'SUM', 'OTA运营经理负责门店中月累计RevPAR低于目标85%的门店数', 'PMS', 'LOWER_BETTER'),
                ('ATTENDANCE_RATE', '月正常出勤率', 'percent', 'LAST', '正常出勤天数/应出勤天数，按0至100记录', 'ATTENDANCE', 'HIGHER_BETTER'),
                ('ABSENCE_COUNT', '旷工次数', 'event', 'SUM', '月内旷工事件数', 'ATTENDANCE', 'LOWER_BETTER'),
                ('SERIOUS_HR_EVENT_COUNT', '重大人事违规次数', 'event', 'SUM', '触发绩效奖金清零的重大人事事件数', 'ATTENDANCE', 'LOWER_BETTER'),
                ('OTA_WEAK_STORE_WARNING_COUNT', '周滚动差店预警数', 'store', 'SUM', '周滚动出租率未达90%且主渠道未领先的差店预警数', 'DERIVED', 'LOWER_BETTER'),
                ('OTA_SINGLE_DAY_OCC_BELOW_60_COUNT', '单日出租率低于60%预警数', 'store_day', 'SUM', '负责范围内单日出租率低于60%的门店日数，钟点房不计入', 'PMS', 'LOWER_BETTER'),
                ('OTA_CHANNEL_ORDER_RANK_PERCENTILE', '渠道订单排名百分位', 'percent', 'MAX', '每个门店每个确定渠道独立计算；竞争圈10家时前3名为前30%', 'OTA', 'LOWER_BETTER'),
                ('OTA_CHANNEL_EXPOSURE_RANK_PERCENTILE', '渠道曝光排名百分位', 'percent', 'MAX', '每个门店每个确定渠道独立计算，不允许跨渠道平均或抵消', 'OTA', 'LOWER_BETTER'),
                ('OTA_CHANNEL_SALES_RANK_PERCENTILE', '渠道销售额排名百分位', 'percent', 'MAX', '每个门店每个确定渠道独立计算，不允许跨渠道平均或抵消', 'OTA', 'LOWER_BETTER'),
                ('OTA_CHANNEL_ALL_THREE_TOP30_RATE', '三项全部前30%渠道达标率', 'ratio', 'RATIO', '订单、曝光、销售额三项均进入前30%的门店渠道组合数/应考核组合数；缺数待核验', 'DERIVED', 'HIGHER_BETTER')
            ) AS metrics(code, name, unit, aggregation, description, source_type, direction)
        LOOP
            INSERT INTO metric_definition
                (tenant_id, code, name, unit, value_type, aggregation, description, status)
            VALUES
                (tenant_record.id, metric_record.code, metric_record.name, metric_record.unit,
                 'DECIMAL', metric_record.aggregation, metric_record.description, 'ACTIVE')
            ON CONFLICT (tenant_id, code) DO NOTHING;

            INSERT INTO metric_definition_version
                (tenant_id, metric_definition_id, version_no, lifecycle_status, source_type,
                 supported_dimensions, aggregation, direction, calculation, sensitivity_level,
                 effective_from, content_hash, published_by, published_at, created_by)
            SELECT tenant_record.id, definition.id,
                   COALESCE((SELECT max(existing.version_no) + 1
                             FROM metric_definition_version existing
                             WHERE existing.tenant_id = tenant_record.id
                               AND existing.metric_definition_id = definition.id), 1),
                   'PUBLISHED', metric_record.source_type,
                   '["orgUnitId","storeId","channelCode","employeeId"]'::jsonb,
                   metric_record.aggregation, metric_record.direction,
                   jsonb_build_object('definition', metric_record.description, 'missingData', 'PENDING_VERIFICATION'),
                   CASE WHEN metric_record.source_type = 'ATTENDANCE' THEN 'PAYROLL_SENSITIVE' ELSE 'BUSINESS_SENSITIVE' END,
                   v_effective_month,
                   md5(metric_record.code || ':v1') || md5(metric_record.description || ':v1'),
                   v_actor, now(), v_actor
            FROM metric_definition definition
            WHERE definition.tenant_id = tenant_record.id AND definition.code = metric_record.code
              AND NOT EXISTS (
                SELECT 1 FROM metric_definition_version existing
                WHERE existing.tenant_id = tenant_record.id
                  AND existing.metric_definition_id = definition.id
                  AND existing.lifecycle_status = 'PUBLISHED'
              );
        END LOOP;

        INSERT INTO kpi_compensation_policy_definition
            (tenant_id, code, name, owner_org_unit_id, created_by)
        VALUES
            (tenant_record.id, 'KPI-BONUS-COEFFICIENT-2026', '绩效奖金与正常出勤系数', v_owner_org, v_actor)
        ON CONFLICT (tenant_id, code) DO NOTHING;

        SELECT id INTO v_policy FROM kpi_compensation_policy_definition
        WHERE tenant_id = tenant_record.id AND code = 'KPI-BONUS-COEFFICIENT-2026';
        SELECT id INTO v_policy_version FROM kpi_compensation_policy_version
        WHERE tenant_id = tenant_record.id AND policy_id = v_policy AND lifecycle_status = 'PUBLISHED'
        ORDER BY version_no DESC LIMIT 1;

        IF v_policy_version IS NULL THEN
            v_policy_version := gen_random_uuid();
            INSERT INTO kpi_compensation_policy_version
                (id, tenant_id, policy_id, version_no, lifecycle_status, score_bands,
                 attendance_bands, zero_bonus_rules, rounding_policy, effective_month,
                 content_hash, published_by, published_at, created_by)
            VALUES
                (v_policy_version, tenant_record.id, v_policy, 1, 'PUBLISHED',
                 '[{"minInclusive":90,"coefficient":1.1},{"minInclusive":80,"maxExclusive":90,"coefficient":1},{"minInclusive":70,"maxExclusive":80,"coefficient":0.8},{"minInclusive":60,"maxExclusive":70,"coefficient":0.6},{"minInclusive":50,"maxExclusive":60,"coefficient":0.5},{"minInclusive":40,"maxExclusive":50,"coefficient":0.4},{"minExclusive":1,"maxExclusive":40,"coefficient":0.3},{"maxInclusive":1,"coefficient":0}]'::jsonb,
                 '[{"minInclusive":100,"coefficient":1},{"minInclusive":90,"maxExclusive":100,"coefficient":0.9},{"minInclusive":80,"maxExclusive":90,"coefficient":0.8},{"minInclusive":70,"maxExclusive":80,"coefficient":0.7},{"maxExclusive":70,"coefficient":0}]'::jsonb,
                 '[{"metricCode":"ABSENCE_COUNT","operator":"GTE","threshold":1},{"metricCode":"SERIOUS_HR_EVENT_COUNT","operator":"GTE","threshold":1}]'::jsonb,
                 '{"scoreScale":2,"moneyScale":2,"roundingMode":"HALF_UP","formula":"bonusBase*performanceCoefficient*attendanceCoefficient"}'::jsonb,
                 v_effective_month,
                 md5('KPI-BONUS-COEFFICIENT-2026:v1') || md5('attendance-and-performance:v1'),
                 v_actor, now(), v_actor);
        END IF;

        INSERT INTO standard_category (tenant_id, code, name, category_type)
        VALUES (tenant_record.id, 'KPI_PERFORMANCE', '岗位KPI绩效考核', 'KPI')
        ON CONFLICT (tenant_id, code) DO NOTHING;
        SELECT id INTO v_category FROM standard_category
        WHERE tenant_id = tenant_record.id AND code = 'KPI_PERFORMANCE';

        INSERT INTO standard_definition
            (tenant_id, category_id, code, name, owner_org_unit_id, description, created_by)
        VALUES
            (tenant_record.id, v_category, 'KPI-OTA-OPERATION-MANAGER', 'OTA运营经理绩效考核',
             v_owner_org, '已确认的OTA运营经理月度KPI：经营结果、差店整改、每日巡检和公司任务；支持每周过程考核。', v_actor)
        ON CONFLICT (tenant_id, code) DO NOTHING;
        SELECT id INTO v_standard FROM standard_definition
        WHERE tenant_id = tenant_record.id AND code = 'KPI-OTA-OPERATION-MANAGER';

        INSERT INTO kpi_template_definition
            (tenant_id, standard_definition_id, template_origin, owner_org_unit_id,
             position_id, code, name, created_by)
        VALUES
            (tenant_record.id, v_standard, 'POSITION', v_owner_org, v_position,
             'KPI-OTA-OPERATION-MANAGER', 'OTA运营经理绩效考核', v_actor)
        ON CONFLICT (tenant_id, code) DO NOTHING;
        SELECT id INTO v_template FROM kpi_template_definition
        WHERE tenant_id = tenant_record.id AND code = 'KPI-OTA-OPERATION-MANAGER';

        SELECT kv.id INTO v_template_version
        FROM kpi_template_version kv
        JOIN standard_version sv ON sv.tenant_id = kv.tenant_id AND sv.id = kv.standard_version_id
        WHERE kv.tenant_id = tenant_record.id AND kv.template_id = v_template
          AND sv.lifecycle_status = 'PUBLISHED'
        ORDER BY kv.version_no DESC LIMIT 1;

        IF v_template_version IS NULL THEN
            v_standard_version := gen_random_uuid();
            v_template_version := gen_random_uuid();

            INSERT INTO standard_version
                (id, tenant_id, standard_id, version_no, lifecycle_status, title,
                 items, evidence_requirements, scoring_rules, effective_from,
                 created_by)
            VALUES
                (v_standard_version, tenant_record.id, v_standard, 1, 'DRAFT',
                 'OTA运营经理绩效考核 V1.0', '[]'::jsonb,
                 '["系统数据快照","巡检不可覆盖留痕","整改任务证据","人工评分说明"]'::jsonb,
                 '{"baseFullScore":100,"fixedWeeks":4,"missingData":"PENDING_VERIFICATION","hourlyRoomsExcluded":true,"negativeScoreSupported":true}'::jsonb,
                 v_effective_month, v_actor);

            INSERT INTO kpi_template_version
                (id, tenant_id, template_id, standard_version_id,
                 compensation_policy_version_id, version_no, review_status,
                 base_full_score, allow_extra_score, effective_month, configuration,
                 content_hash, created_by)
            VALUES
                (v_template_version, tenant_record.id, v_template, v_standard_version,
                 v_policy_version, 1, 'DRAFT', 100, true, v_effective_month,
                 '{"weekDefinition":[[1,7],[8,14],[15,21],[22,"MONTH_END"]],"scorecardRecipients":["EMPLOYEE","STORE_MANAGER","DEPARTMENT_MANAGER"],"channelRankingRule":"EACH_CHANNEL_ALL_ORDER_EXPOSURE_SALES_TOP_30","weakStoreRule":"WEEKLY_OCCUPANCY_BELOW_90_AND_PRIMARY_CHANNEL_NOT_LEADING","hourlyRoomsExcluded":true}'::jsonb,
                 md5('KPI-OTA-OPERATION-MANAGER:v1') || md5('20-35-25-20:v1'), v_actor);

            v_section := gen_random_uuid();
            INSERT INTO kpi_template_section
                (id, tenant_id, template_version_id, section_code, name, max_score, min_score, sort_order, configuration)
            VALUES
                (v_section, tenant_record.id, v_template_version, 'OPERATING_RESULT', '经营结果', 20, 0, 10,
                 '{"definition":"负责门店月累计出租率达标结果；100%门店达到95%方可拿满基础分"}'::jsonb);
            INSERT INTO kpi_indicator_rule
                (tenant_id, section_id, metric_version_id, indicator_code, name, indicator_type,
                 weekly_split_type, max_score, min_score, target_value, allow_above_max,
                 precision_scale, evaluator_type, not_applicable_policy, sort_order,
                 formula_config, warning_config)
            SELECT tenant_record.id, v_section, mv.id, 'OCCUPANCY_95_STORE_SHARE',
                   '95%出租率达标门店占比', 'TARGET', 'SAME_TARGET', 20, 0, 1, false,
                   2, 'SYSTEM', 'PENDING_VERIFICATION', 10,
                   '{"scoreMode":"PROPORTIONAL","metricNature":"RATIO","fullScoreRequiresAllStores":true,"hourlyRoomsExcluded":true}'::jsonb,
                   '{"yellowBelow":1,"orangeBelow":0.9,"redBelow":0.8}'::jsonb
            FROM metric_definition_version mv
            JOIN metric_definition md ON md.tenant_id = mv.tenant_id AND md.id = mv.metric_definition_id
            WHERE mv.tenant_id = tenant_record.id AND md.code = 'OTA_OCCUPANCY_95_STORE_SHARE' AND mv.lifecycle_status = 'PUBLISHED';
            INSERT INTO kpi_indicator_rule
                (tenant_id, section_id, metric_version_id, indicator_code, name, indicator_type,
                 weekly_split_type, max_score, min_score, target_value, allow_above_max,
                 precision_scale, evaluator_type, not_applicable_policy, sort_order,
                 formula_config, warning_config)
            SELECT tenant_record.id, v_section, mv.id, 'OCCUPANCY_EXTRA_SCORE',
                   '出租率额外加分', 'COMPOSITE', 'MONTH_END_ONLY', 0, 0, 1, true,
                   2, 'SYSTEM', 'PENDING_VERIFICATION', 20,
                   '{"scoreMode":"ACTUAL","maxExtraScore":2,"rule":"ALL_98_EQUALS_2;ALL_95_AND_HALF_98_EQUALS_1"}'::jsonb, '{}'::jsonb
            FROM metric_definition_version mv
            JOIN metric_definition md ON md.tenant_id = mv.tenant_id AND md.id = mv.metric_definition_id
            WHERE mv.tenant_id = tenant_record.id AND md.code = 'OTA_OCCUPANCY_EXTRA_SCORE' AND mv.lifecycle_status = 'PUBLISHED';

            v_section := gen_random_uuid();
            INSERT INTO kpi_template_section
                (id, tenant_id, template_version_id, section_code, name, max_score, min_score, sort_order, configuration)
            VALUES
                (v_section, tenant_record.id, v_template_version, 'WEAK_STORE_REMEDIATION', '差店整改', 35, 0, 20,
                 '{"internalWeighting":{"plan":15,"execution":30,"weeklyReview":15,"acceptance":40},"warning":"按周滚动预警"}'::jsonb);
            INSERT INTO kpi_indicator_rule
                (tenant_id, section_id, metric_version_id, indicator_code, name, indicator_type,
                 weekly_split_type, max_score, min_score, target_value, precision_scale,
                 evidence_required, evaluator_type, not_applicable_policy, sort_order, formula_config, warning_config)
            SELECT tenant_record.id, v_section, mv.id, rules.code, rules.name, 'COMPLETION_RATE',
                   'SAME_TARGET', rules.score, 0, 1, 2, true, 'SYSTEM', 'FULL_SCORE', rules.sort_order,
                   '{"metricNature":"RATIO","scoreMode":"PROPORTIONAL"}'::jsonb,
                   '{"yellowBelow":1,"orangeBelow":0.8,"redBelow":0.6}'::jsonb
            FROM (VALUES
                ('OTA_REMEDIATION_PLAN_RATE','整改计划确认率',5.25::numeric,10),
                ('OTA_REMEDIATION_EXECUTION_RATE','整改任务落地率',10.50::numeric,20),
                ('OTA_REMEDIATION_WEEKLY_REVIEW_RATE','每周数据复盘完成率',5.25::numeric,30),
                ('OTA_REMEDIATION_ACCEPTANCE_RATE','最终整改验收通过率',14.00::numeric,40)
            ) AS rules(code,name,score,sort_order)
            JOIN metric_definition md ON md.tenant_id = tenant_record.id AND md.code = rules.code
            JOIN metric_definition_version mv ON mv.tenant_id = md.tenant_id
                AND mv.metric_definition_id = md.id AND mv.lifecycle_status = 'PUBLISHED';

            v_section := gen_random_uuid();
            INSERT INTO kpi_template_section
                (id, tenant_id, template_version_id, section_code, name, max_score, min_score, sort_order, configuration)
            VALUES
                (v_section, tenant_record.id, v_template_version, 'DAILY_INSPECTION', '每日OTA巡检', 25, NULL, 30,
                 '{"timeWindows":["MORNING","AFTERNOON","BEFORE_SLEEP"],"morningChecks":["channelViolation","trafficReduction","traffic","conversion","price","inventory"],"audit":"APPEND_ONLY_SERVER_TIME"}'::jsonb);
            INSERT INTO kpi_indicator_rule
                (tenant_id, section_id, metric_version_id, indicator_code, name, indicator_type,
                 weekly_split_type, max_score, min_score, target_value, precision_scale,
                 evidence_required, evaluator_type, not_applicable_policy, sort_order, formula_config, warning_config)
            SELECT tenant_record.id, v_section, mv.id, 'OTA_INSPECTION_DEDUCTION_EVENTS',
                   '三时段巡检与异常闭环', 'EVENT_DEDUCTION', 'SAME_TARGET', 25, NULL, 0, 2,
                   true, 'SYSTEM', 'PENDING_VERIFICATION', 10,
                   '{"deductionPerEvent":1,"negativeAllowed":true,"ordinarySla":{"confirmMinutes":30,"actionMinutes":60,"closeOrEscalateMinutes":240},"majorSla":{"confirmMinutes":15,"actionMinutes":30,"closeOrEscalateMinutes":120}}'::jsonb,
                   '{"yellowFailureCount":1,"orangeFailureCount":2,"redFailureCount":3}'::jsonb
            FROM metric_definition_version mv
            JOIN metric_definition md ON md.tenant_id = mv.tenant_id AND md.id = mv.metric_definition_id
            WHERE mv.tenant_id = tenant_record.id AND md.code = 'OTA_INSPECTION_DEDUCTION_EVENTS' AND mv.lifecycle_status = 'PUBLISHED';

            v_section := gen_random_uuid();
            INSERT INTO kpi_template_section
                (id, tenant_id, template_version_id, section_code, name, max_score, min_score, sort_order, configuration)
            VALUES
                (v_section, tenant_record.id, v_template_version, 'COMPANY_TASKS', '运营计划及公司任务执行', 20, 0, 40,
                 '{"acceptance":"taskResultAccepted","noDueTask":"FULL_SCORE","remediationTasksExcluded":true,"rescheduleRequiresApprovedAudit":true}'::jsonb);
            INSERT INTO kpi_indicator_rule
                (tenant_id, section_id, metric_version_id, indicator_code, name, indicator_type,
                 weekly_split_type, max_score, min_score, target_value, precision_scale,
                 evidence_required, evaluator_type, not_applicable_policy, sort_order, formula_config, warning_config)
            SELECT tenant_record.id, v_section, mv.id, 'COMPANY_TASK_ON_TIME_RATE',
                   '有效到期任务按时验收通过率', 'ON_TIME', 'SAME_TARGET', 20, 0, 1, 2,
                   true, 'SYSTEM', 'FULL_SCORE', 10,
                   '{"metricNature":"RATIO","excludeRemediationTasks":true,"cancelledOrApprovedRescheduleExcluded":true}'::jsonb,
                   '{"yellowBelow":1,"orangeBelow":0.8,"redBelow":0.6}'::jsonb
            FROM metric_definition_version mv
            JOIN metric_definition md ON md.tenant_id = mv.tenant_id AND md.id = mv.metric_definition_id
            WHERE mv.tenant_id = tenant_record.id AND md.code = 'COMPANY_TASK_ON_TIME_RATE' AND mv.lifecycle_status = 'PUBLISHED';

            v_section := gen_random_uuid();
            INSERT INTO kpi_template_section
                (id, tenant_id, template_version_id, section_code, name, max_score, min_score, sort_order, configuration)
            VALUES
                (v_section, tenant_record.id, v_template_version, 'ROLE_BONUS_ADJUSTMENT', 'OTA岗位专属奖金基数加减', 0, 0, 50,
                 '{"scope":"OTA_OPERATION_MANAGER_ONLY","notUniversal":true}'::jsonb);
            INSERT INTO kpi_indicator_rule
                (tenant_id, section_id, metric_version_id, indicator_code, name, indicator_type,
                 weekly_split_type, max_score, min_score, target_value, precision_scale,
                 evaluator_type, not_applicable_policy, sort_order, formula_config, warning_config)
            SELECT tenant_record.id, v_section, mv.id, adjustments.code, adjustments.name,
                   'BONUS_ADJUSTMENT', 'MONTH_END_ONLY', 0, 0, 0, 2,
                   'SYSTEM', 'PENDING_VERIFICATION', adjustments.sort_order,
                   jsonb_build_object('amountPerUnit', adjustments.amount_per_unit, 'roleSpecific', true), '{}'::jsonb
            FROM (VALUES
                ('OTA_REVPAR_100_STORE_COUNT','RevPAR达到目标100%门店奖金基数增加',500::numeric,10),
                ('OTA_REVPAR_BELOW_85_STORE_COUNT','RevPAR低于目标85%门店奖金基数减少',-500::numeric,20)
            ) AS adjustments(code,name,amount_per_unit,sort_order)
            JOIN metric_definition md ON md.tenant_id = tenant_record.id AND md.code = adjustments.code
            JOIN metric_definition_version mv ON mv.tenant_id = md.tenant_id
                AND mv.metric_definition_id = md.id AND mv.lifecycle_status = 'PUBLISHED';

            INSERT INTO kpi_template_approval
                (tenant_id, template_version_id, approval_stage, decision, comment, decided_by)
            VALUES
                (tenant_record.id, v_template_version, 'DEPARTMENT', 'APPROVED', '首版业务规则已确认', v_actor),
                (tenant_record.id, v_template_version, 'HR', 'APPROVED', '首版量化及审计规则已确认', v_actor),
                (tenant_record.id, v_template_version, 'CEO', 'APPROVED', 'CEO确认发布首版OTA运营经理KPI', v_actor);

            UPDATE kpi_template_version
            SET review_status = 'APPROVED', row_version = row_version + 1
            WHERE tenant_id = tenant_record.id AND id = v_template_version;
            UPDATE standard_version
            SET lifecycle_status = 'PUBLISHED', effective_from = v_effective_month,
                published_by = v_actor, published_at = now()
            WHERE tenant_id = tenant_record.id AND id = v_standard_version;

            INSERT INTO kpi_template_binding
                (tenant_id, template_version_id, position_id, binding_level,
                 effective_month, priority, created_by)
            VALUES
                (tenant_record.id, v_template_version, v_position, 'POSITION',
                 v_effective_month, 100, v_actor);
        END IF;
    END LOOP;
END $$;
