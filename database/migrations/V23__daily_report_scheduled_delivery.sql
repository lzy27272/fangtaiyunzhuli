-- Daily-report scheduled delivery for the Pilot hotel roles.
--
-- This migration deliberately does not create a second task scheduler.  It adds
-- delivery policy data consumed by the existing automation worker, while all
-- due-soon/overdue decisions continue through the Rule Engine.

CREATE TABLE daily_report_delivery_policy (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenant(id),
    template_assignment_id UUID NOT NULL,
    enabled BOOLEAN NOT NULL DEFAULT true,
    open_local_time TIME NOT NULL DEFAULT '22:00:00',
    due_local_time TIME NOT NULL DEFAULT '23:00:00',
    grace_minutes INTEGER NOT NULL DEFAULT 30 CHECK (grace_minutes BETWEEN 0 AND 1440),
    pre_due_reminder_minutes INTEGER[] NOT NULL DEFAULT ARRAY[30]::INTEGER[],
    overdue_reminder_minutes INTEGER[] NOT NULL DEFAULT ARRAY[0, 30]::INTEGER[],
    backfill_days INTEGER NOT NULL DEFAULT 1 CHECK (backfill_days BETWEEN 0 AND 7),
    row_version BIGINT NOT NULL DEFAULT 0,
    created_by UUID NOT NULL,
    updated_by UUID NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, id),
    UNIQUE (tenant_id, template_assignment_id),
    CHECK (array_position(pre_due_reminder_minutes, NULL) IS NULL),
    CHECK (coalesce(array_length(pre_due_reminder_minutes, 1), 0) <= 8),
    CHECK (0 < ALL (pre_due_reminder_minutes)),
    CHECK (10080 >= ALL (pre_due_reminder_minutes)),
    CHECK (array_position(overdue_reminder_minutes, NULL) IS NULL),
    CHECK (coalesce(array_length(overdue_reminder_minutes, 1), 0) <= 8),
    CHECK (0 <= ALL (overdue_reminder_minutes)),
    CHECK (10080 >= ALL (overdue_reminder_minutes)),
    FOREIGN KEY (tenant_id, template_assignment_id)
        REFERENCES daily_report_template_assignment (tenant_id, id),
    FOREIGN KEY (tenant_id, created_by) REFERENCES user_account (tenant_id, id),
    FOREIGN KEY (tenant_id, updated_by) REFERENCES user_account (tenant_id, id)
);

COMMENT ON TABLE daily_report_delivery_policy IS
    'Per-template-assignment schedule for automatic daily-report materialization and reminders.';
COMMENT ON COLUMN daily_report_delivery_policy.open_local_time IS
    'Editable local opening time. Pilot 22:00 is a derived default: V15 due_local_time 23:00 minus 60 minutes.';
COMMENT ON COLUMN daily_report_delivery_policy.due_local_time IS
    'Local due time inherited by the Pilot seed from the assigned V15 work-package item; due at or before open means next local day.';
COMMENT ON COLUMN daily_report_delivery_policy.grace_minutes IS
    'Grace period inherited by the Pilot seed from the assigned V15 work-package item.';

CREATE INDEX ix_daily_report_delivery_policy_schedule
    ON daily_report_delivery_policy
        (tenant_id, enabled, open_local_time, due_local_time, template_assignment_id);

CREATE INDEX ix_daily_report_assignment_active_position
    ON daily_report_template_assignment
        (tenant_id, position_id, priority, valid_from, valid_to, template_version_id)
    WHERE status = 'ACTIVE'
      AND assignment_kind = 'BASE'
      AND scope_type = 'POSITION';

ALTER TABLE daily_report_delivery_policy ENABLE ROW LEVEL SECURITY;
ALTER TABLE daily_report_delivery_policy FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON daily_report_delivery_policy
    USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
    WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

CREATE TRIGGER trg_daily_report_delivery_policy_updated_at
    BEFORE UPDATE ON daily_report_delivery_policy
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'hotel_ai_os_app') THEN
        GRANT SELECT, INSERT, UPDATE, DELETE ON daily_report_delivery_policy TO hotel_ai_os_app;
    END IF;
END $$;

SELECT set_config('app.tenant_id', '10000000-0000-0000-0000-000000000001', false);

-- Five hotel-role fallback templates only.  OTA roles are regional and have no
-- hotel ancestor; CEO is not an employee daily-report role.
INSERT INTO daily_report_template_definition
    (id, tenant_id, code, name, description, template_origin,
     owner_org_unit_id, position_id, status, created_by)
VALUES
    ('43000000-0000-0000-0000-000000000001',
     '10000000-0000-0000-0000-000000000001',
     'DRT-PILOT-FRONT-DAILY',
     '前台员工岗位日报（Pilot）',
     '由前台岗位工作包驱动的每日填报模板。',
     'HQ',
     '12000000-0000-0000-0000-000000000001',
     '14000000-0000-0000-0000-000000000001',
     'ACTIVE',
     '19000000-0000-0000-0000-000000000001'),
    ('43000000-0000-0000-0000-000000000002',
     '10000000-0000-0000-0000-000000000001',
     'DRT-PILOT-HK-SUPERVISOR-DAILY',
     '客房主管岗位日报（Pilot）',
     '由客房主管岗位工作包驱动的每日填报模板。',
     'HQ',
     '12000000-0000-0000-0000-000000000001',
     '14000000-0000-0000-0000-000000000002',
     'ACTIVE',
     '19000000-0000-0000-0000-000000000001'),
    ('43000000-0000-0000-0000-000000000003',
     '10000000-0000-0000-0000-000000000001',
     'DRT-PILOT-FO-SUPERVISOR-DAILY',
     '前厅主管岗位日报（Pilot）',
     '由前厅主管岗位工作包驱动的每日填报模板。',
     'HQ',
     '12000000-0000-0000-0000-000000000001',
     '14000000-0000-0000-0000-000000000003',
     'ACTIVE',
     '19000000-0000-0000-0000-000000000001'),
    ('43000000-0000-0000-0000-000000000004',
     '10000000-0000-0000-0000-000000000001',
     'DRT-PILOT-GM-DAILY',
     '店总经营管理日报（Pilot）',
     '由店总经营管理岗位工作包驱动的每日填报模板。',
     'HQ',
     '12000000-0000-0000-0000-000000000001',
     '14000000-0000-0000-0000-000000000004',
     'ACTIVE',
     '19000000-0000-0000-0000-000000000001'),
    ('43000000-0000-0000-0000-000000000007',
     '10000000-0000-0000-0000-000000000001',
     'DRT-PILOT-AGM-DAILY',
     '店助管理岗位日报（Pilot）',
     '由店助管理岗位工作包驱动的每日填报模板。',
     'HQ',
     '12000000-0000-0000-0000-000000000001',
     '14000000-0000-0000-0000-000000000007',
     'ACTIVE',
     '19000000-0000-0000-0000-000000000001');

-- Versions and all children are created as DRAFT first.  V19 requires this
-- ordering; publishing happens only after sections and items are complete.
INSERT INTO daily_report_template_version
    (id, tenant_id, template_id, version_no, lifecycle_status,
     work_package_version_id, configuration, created_by)
VALUES
    ('43100000-0000-0000-0000-000000000001',
     '10000000-0000-0000-0000-000000000001',
     '43000000-0000-0000-0000-000000000001',
     1, 'DRAFT',
     '42100000-0000-0000-0000-000000000001',
     '{}'::jsonb,
     '19000000-0000-0000-0000-000000000001'),
    ('43100000-0000-0000-0000-000000000002',
     '10000000-0000-0000-0000-000000000001',
     '43000000-0000-0000-0000-000000000002',
     1, 'DRAFT',
     '42100000-0000-0000-0000-000000000002',
     '{}'::jsonb,
     '19000000-0000-0000-0000-000000000001'),
    ('43100000-0000-0000-0000-000000000003',
     '10000000-0000-0000-0000-000000000001',
     '43000000-0000-0000-0000-000000000003',
     1, 'DRAFT',
     '42100000-0000-0000-0000-000000000003',
     '{}'::jsonb,
     '19000000-0000-0000-0000-000000000001'),
    ('43100000-0000-0000-0000-000000000004',
     '10000000-0000-0000-0000-000000000001',
     '43000000-0000-0000-0000-000000000004',
     1, 'DRAFT',
     '42100000-0000-0000-0000-000000000004',
     '{}'::jsonb,
     '19000000-0000-0000-0000-000000000001'),
    ('43100000-0000-0000-0000-000000000007',
     '10000000-0000-0000-0000-000000000001',
     '43000000-0000-0000-0000-000000000007',
     1, 'DRAFT',
     '42100000-0000-0000-0000-000000000007',
     '{}'::jsonb,
     '19000000-0000-0000-0000-000000000001');

INSERT INTO daily_report_section_definition
    (id, tenant_id, code, name, description, section_origin,
     owner_org_unit_id, position_id, status, created_by)
VALUES
    ('43200000-0000-0000-0000-000000000001',
     '10000000-0000-0000-0000-000000000001',
     'DRS-PILOT-FRONT-DAILY',
     '前台岗位日清',
     '入住、客诉、VIP接待与交接。',
     'HQ',
     '12000000-0000-0000-0000-000000000001',
     '14000000-0000-0000-0000-000000000001',
     'ACTIVE',
     '19000000-0000-0000-0000-000000000001'),
    ('43200000-0000-0000-0000-000000000002',
     '10000000-0000-0000-0000-000000000001',
     'DRS-PILOT-HK-SUPERVISOR-DAILY',
     '客房主管岗位日清',
     '客房检查、图片证据与整改跟进。',
     'HQ',
     '12000000-0000-0000-0000-000000000001',
     '14000000-0000-0000-0000-000000000002',
     'ACTIVE',
     '19000000-0000-0000-0000-000000000001'),
    ('43200000-0000-0000-0000-000000000003',
     '10000000-0000-0000-0000-000000000001',
     'DRS-PILOT-FO-SUPERVISOR-DAILY',
     '前厅主管岗位日清',
     '班组、客诉跟进、检查与交接。',
     'HQ',
     '12000000-0000-0000-0000-000000000001',
     '14000000-0000-0000-0000-000000000003',
     'ACTIVE',
     '19000000-0000-0000-0000-000000000001'),
    ('43200000-0000-0000-0000-000000000004',
     '10000000-0000-0000-0000-000000000001',
     'DRS-PILOT-GM-DAILY',
     '店总经营管理日清',
     '经营复盘、OTA风险、未完成任务与管理决策。',
     'HQ',
     '12000000-0000-0000-0000-000000000001',
     '14000000-0000-0000-0000-000000000004',
     'ACTIVE',
     '19000000-0000-0000-0000-000000000001'),
    ('43200000-0000-0000-0000-000000000007',
     '10000000-0000-0000-0000-000000000001',
     'DRS-PILOT-AGM-DAILY',
     '店助管理岗位日清',
     '部门执行、逾期任务与跨部门支持。',
     'HQ',
     '12000000-0000-0000-0000-000000000001',
     '14000000-0000-0000-0000-000000000007',
     'ACTIVE',
     '19000000-0000-0000-0000-000000000001');

INSERT INTO daily_report_section_version
    (id, tenant_id, section_definition_id, version_no, lifecycle_status,
     condition_expression, configuration, created_by)
SELECT
    ('43300000-0000-0000-0000-' || lpad(seed.role_no::text, 12, '0'))::uuid,
    '10000000-0000-0000-0000-000000000001'::uuid,
    ('43200000-0000-0000-0000-' || lpad(seed.role_no::text, 12, '0'))::uuid,
    1,
    'DRAFT',
    '{}'::jsonb,
    jsonb_build_object(
        'sectionCode', 'daily_entry',
        'title', seed.section_title,
        'description', seed.section_description,
        'sectionOrigin', 'HQ'
    ),
    '19000000-0000-0000-0000-000000000001'::uuid
FROM (VALUES
    (1, '前台岗位日清', '入住、客诉、VIP接待与交接。'),
    (2, '客房主管岗位日清', '客房检查、图片证据与整改跟进。'),
    (3, '前厅主管岗位日清', '班组、客诉跟进、检查与交接。'),
    (4, '店总经营管理日清', '经营复盘、OTA风险、未完成任务与管理决策。'),
    (7, '店助管理岗位日清', '部门执行、逾期任务与跨部门支持。')
) AS seed(role_no, section_title, section_description);

INSERT INTO daily_report_template_section
    (id, tenant_id, template_version_id, section_version_id,
     section_role, required, sort_order)
SELECT
    ('43400000-0000-0000-0000-' || lpad(seed.role_no::text, 12, '0'))::uuid,
    '10000000-0000-0000-0000-000000000001'::uuid,
    ('43100000-0000-0000-0000-' || lpad(seed.role_no::text, 12, '0'))::uuid,
    ('43300000-0000-0000-0000-' || lpad(seed.role_no::text, 12, '0'))::uuid,
    'BASE',
    true,
    1
FROM (VALUES (1), (2), (3), (4), (7)) AS seed(role_no);

-- Item labels and validation are the daily-report projection of the already
-- published V15 role forms.  All items retain a reference to the role work item
-- and the common V15 execution standard.
WITH seed(
    item_id, role_no, item_code, label, input_type,
    required, sort_order, validation_rules
) AS (
    VALUES
        ('43500000-0000-0001-0000-000000000001'::uuid, 1, 'checkins',
         '今日入住数', 'NUMBER', true, 1, '{"minimum":0}'::jsonb),
        ('43500000-0000-0001-0000-000000000002'::uuid, 1, 'complaintCount',
         '客诉数量', 'NUMBER', true, 2, '{"minimum":0}'::jsonb),
        ('43500000-0000-0001-0000-000000000003'::uuid, 1, 'vipReception',
         'VIP接待情况', 'LONG_TEXT', false, 3, '{}'::jsonb),
        ('43500000-0000-0001-0000-000000000004'::uuid, 1, 'handoverComplete',
         '交接已完成', 'BOOLEAN', true, 4, '{}'::jsonb),

        ('43500000-0000-0002-0000-000000000001'::uuid, 2, 'roomsChecked',
         '检查房间数', 'NUMBER', true, 1, '{"minimum":0}'::jsonb),
        ('43500000-0000-0002-0000-000000000002'::uuid, 2, 'issuesFound',
         '发现问题数', 'NUMBER', true, 2, '{"minimum":0}'::jsonb),
        ('43500000-0000-0002-0000-000000000003'::uuid, 2, 'photosChecked',
         '图片证据已检查', 'BOOLEAN', true, 3, '{}'::jsonb),
        ('43500000-0000-0002-0000-000000000004'::uuid, 2, 'rectificationSummary',
         '整改跟进说明', 'LONG_TEXT', false, 4, '{}'::jsonb),

        ('43500000-0000-0003-0000-000000000001'::uuid, 3, 'teamAttendance',
         '班组出勤人数', 'NUMBER', true, 1, '{"minimum":0}'::jsonb),
        ('43500000-0000-0003-0000-000000000002'::uuid, 3, 'complaintFollowUps',
         '客诉跟进数量', 'NUMBER', true, 2, '{"minimum":0}'::jsonb),
        ('43500000-0000-0003-0000-000000000003'::uuid, 3, 'shiftInspectionSummary',
         '班组检查与交接说明', 'LONG_TEXT', false, 3, '{}'::jsonb),

        ('43500000-0000-0004-0000-000000000001'::uuid, 4, 'revenueReviewed',
         '经营数据已复盘', 'BOOLEAN', true, 1, '{}'::jsonb),
        ('43500000-0000-0004-0000-000000000002'::uuid, 4, 'otaRiskChecked',
         'OTA风险已检查', 'BOOLEAN', true, 2, '{}'::jsonb),
        ('43500000-0000-0004-0000-000000000003'::uuid, 4, 'unfinishedTasksFollowed',
         '跟进未完成任务数', 'NUMBER', true, 3, '{"minimum":0}'::jsonb),
        ('43500000-0000-0004-0000-000000000004'::uuid, 4, 'decisions',
         '今日管理决策与安排', 'LONG_TEXT', false, 4, '{}'::jsonb),

        ('43500000-0000-0007-0000-000000000001'::uuid, 7, 'departmentsReviewed',
         '检查部门数', 'NUMBER', true, 1, '{"minimum":0}'::jsonb),
        ('43500000-0000-0007-0000-000000000002'::uuid, 7, 'overdueTasks',
         '跟进逾期任务数', 'NUMBER', true, 2, '{"minimum":0}'::jsonb),
        ('43500000-0000-0007-0000-000000000003'::uuid, 7, 'supportSummary',
         '跨部门协调与支持说明', 'LONG_TEXT', false, 3, '{}'::jsonb)
)
INSERT INTO daily_report_template_item
    (id, tenant_id, section_version_id, item_code, label, input_type,
     required, work_package_item_id, standard_version_id,
     evidence_policy, source_policy, validation_rules, option_values, sort_order)
SELECT
    seed.item_id,
    '10000000-0000-0000-0000-000000000001'::uuid,
    ('43300000-0000-0000-0000-' || lpad(seed.role_no::text, 12, '0'))::uuid,
    seed.item_code,
    seed.label,
    seed.input_type,
    seed.required,
    ('42300000-0000-0000-0000-' || lpad(seed.role_no::text, 12, '0'))::uuid,
    '41300000-0000-0000-0000-000000000001'::uuid,
    '{"required":false,"allowedTypes":["IMAGE","DOCUMENT","QUALITY_REPORT"]}'::jsonb,
    '{"sourceType":"MANUAL"}'::jsonb,
    seed.validation_rules,
    '[]'::jsonb,
    seed.sort_order
FROM seed;

-- Assemble the same immutable configuration shape produced by the template
-- service so report materialization can use these fallback templates directly.
WITH assembled AS (
    SELECT
        version.id AS template_version_id,
        jsonb_build_object(
            'title', definition.name,
            'description', definition.description,
            'sections', coalesce((
                SELECT jsonb_agg(
                    jsonb_build_object(
                        'id', section_definition.id::text,
                        'sectionVersionId', section_version.id::text,
                        'sectionCode', section_version.configuration ->> 'sectionCode',
                        'title', section_version.configuration ->> 'title',
                        'description', section_version.configuration ->> 'description',
                        'sectionOrigin', 'HQ',
                        'applicabilityCondition', section_version.condition_expression,
                        'sectionRole', relation.section_role,
                        'required', relation.required,
                        'sortOrder', relation.sort_order,
                        'items', coalesce((
                            SELECT jsonb_agg(
                                jsonb_strip_nulls(jsonb_build_object(
                                    'id', item.id::text,
                                    'itemCode', item.item_code,
                                    'label', item.label,
                                    'description', item.help_text,
                                    'valueType', item.input_type,
                                    'required', item.required,
                                    'workPackageItemId', item.work_package_item_id::text,
                                    'standardVersionId', item.standard_version_id::text,
                                    'metricId', item.metric_id::text,
                                    'dataSourceType', item.source_policy ->> 'sourceType',
                                    'evidencePolicy', item.evidence_policy,
                                    'validationRules', item.validation_rules,
                                    'optionValues', item.option_values,
                                    'sortOrder', item.sort_order
                                ))
                                ORDER BY item.sort_order, item.item_code
                            )
                            FROM daily_report_template_item item
                            WHERE item.tenant_id = relation.tenant_id
                              AND item.section_version_id = relation.section_version_id
                        ), '[]'::jsonb)
                    )
                    ORDER BY relation.sort_order, section_definition.code
                )
                FROM daily_report_template_section relation
                JOIN daily_report_section_version section_version
                  ON section_version.tenant_id = relation.tenant_id
                 AND section_version.id = relation.section_version_id
                JOIN daily_report_section_definition section_definition
                  ON section_definition.tenant_id = section_version.tenant_id
                 AND section_definition.id = section_version.section_definition_id
                WHERE relation.tenant_id = version.tenant_id
                  AND relation.template_version_id = version.id
            ), '[]'::jsonb)
        ) AS configuration
    FROM daily_report_template_version version
    JOIN daily_report_template_definition definition
      ON definition.tenant_id = version.tenant_id
     AND definition.id = version.template_id
    WHERE version.tenant_id = '10000000-0000-0000-0000-000000000001'
      AND version.id IN (
          '43100000-0000-0000-0000-000000000001',
          '43100000-0000-0000-0000-000000000002',
          '43100000-0000-0000-0000-000000000003',
          '43100000-0000-0000-0000-000000000004',
          '43100000-0000-0000-0000-000000000007'
      )
      AND version.lifecycle_status = 'DRAFT'
)
UPDATE daily_report_template_version version
SET configuration = assembled.configuration,
    row_version = version.row_version + 1
FROM assembled
WHERE version.tenant_id = '10000000-0000-0000-0000-000000000001'
  AND version.id = assembled.template_version_id
  AND version.lifecycle_status = 'DRAFT';

UPDATE daily_report_section_version
SET lifecycle_status = 'PUBLISHED',
    content_hash = md5(configuration::text) || md5(configuration::text || ':pilot-v1'),
    effective_from = now() - interval '1 day',
    published_by = '19000000-0000-0000-0000-000000000001',
    published_at = now(),
    row_version = row_version + 1
WHERE tenant_id = '10000000-0000-0000-0000-000000000001'
  AND id IN (
      '43300000-0000-0000-0000-000000000001',
      '43300000-0000-0000-0000-000000000002',
      '43300000-0000-0000-0000-000000000003',
      '43300000-0000-0000-0000-000000000004',
      '43300000-0000-0000-0000-000000000007'
  )
  AND lifecycle_status = 'DRAFT';

UPDATE daily_report_template_version
SET lifecycle_status = 'PUBLISHED',
    content_hash = md5(configuration::text) || md5(configuration::text || ':pilot-v1'),
    effective_from = now() - interval '1 day',
    published_by = '19000000-0000-0000-0000-000000000001',
    published_at = now(),
    row_version = row_version + 1
WHERE tenant_id = '10000000-0000-0000-0000-000000000001'
  AND id IN (
      '43100000-0000-0000-0000-000000000001',
      '43100000-0000-0000-0000-000000000002',
      '43100000-0000-0000-0000-000000000003',
      '43100000-0000-0000-0000-000000000004',
      '43100000-0000-0000-0000-000000000007'
  )
  AND lifecycle_status = 'DRAFT';

-- Priority is ordered ascending by the resolver.  900 intentionally makes these
-- safe fallback templates; an administrator-created priority-100 HQ template wins.
INSERT INTO daily_report_template_assignment
    (id, tenant_id, template_version_id, assignment_kind, scope_type,
     position_id, priority, valid_from, status, assigned_by)
VALUES
    ('43600000-0000-0000-0000-000000000001',
     '10000000-0000-0000-0000-000000000001',
     '43100000-0000-0000-0000-000000000001',
     'BASE', 'POSITION',
     '14000000-0000-0000-0000-000000000001',
     900, DATE '2020-01-01', 'ACTIVE',
     '19000000-0000-0000-0000-000000000001'),
    ('43600000-0000-0000-0000-000000000002',
     '10000000-0000-0000-0000-000000000001',
     '43100000-0000-0000-0000-000000000002',
     'BASE', 'POSITION',
     '14000000-0000-0000-0000-000000000002',
     900, DATE '2020-01-01', 'ACTIVE',
     '19000000-0000-0000-0000-000000000001'),
    ('43600000-0000-0000-0000-000000000003',
     '10000000-0000-0000-0000-000000000001',
     '43100000-0000-0000-0000-000000000003',
     'BASE', 'POSITION',
     '14000000-0000-0000-0000-000000000003',
     900, DATE '2020-01-01', 'ACTIVE',
     '19000000-0000-0000-0000-000000000001'),
    ('43600000-0000-0000-0000-000000000004',
     '10000000-0000-0000-0000-000000000001',
     '43100000-0000-0000-0000-000000000004',
     'BASE', 'POSITION',
     '14000000-0000-0000-0000-000000000004',
     900, DATE '2020-01-01', 'ACTIVE',
     '19000000-0000-0000-0000-000000000001'),
    ('43600000-0000-0000-0000-000000000007',
     '10000000-0000-0000-0000-000000000001',
     '43100000-0000-0000-0000-000000000007',
     'BASE', 'POSITION',
     '14000000-0000-0000-0000-000000000007',
     900, DATE '2020-01-01', 'ACTIVE',
     '19000000-0000-0000-0000-000000000001');

-- The due/grace values are selected from V15 rather than duplicated as constants.
-- open_local_time is the documented, editable due-minus-60-minutes default.
INSERT INTO daily_report_delivery_policy
    (id, tenant_id, template_assignment_id, enabled,
     open_local_time, due_local_time, grace_minutes,
     pre_due_reminder_minutes, overdue_reminder_minutes, backfill_days,
     created_by, updated_by)
SELECT
    ('43700000-0000-0000-0000-' || lpad(seed.role_no::text, 12, '0'))::uuid,
    assignment.tenant_id,
    assignment.id,
    true,
    item.due_local_time - interval '1 hour',
    item.due_local_time,
    item.grace_minutes,
    ARRAY[30]::INTEGER[],
    ARRAY[0, 30]::INTEGER[],
    1,
    '19000000-0000-0000-0000-000000000001'::uuid,
    '19000000-0000-0000-0000-000000000001'::uuid
FROM (VALUES (1), (2), (3), (4), (7)) AS seed(role_no)
JOIN daily_report_template_assignment assignment
  ON assignment.tenant_id = '10000000-0000-0000-0000-000000000001'
 AND assignment.id =
     ('43600000-0000-0000-0000-' || lpad(seed.role_no::text, 12, '0'))::uuid
JOIN work_package_item item
  ON item.tenant_id = assignment.tenant_id
 AND item.id =
     ('42300000-0000-0000-0000-' || lpad(seed.role_no::text, 12, '0'))::uuid;

-- Rule Engine owns deterministic reminders.  These two rules can only create
-- notifications for the assignment on the event; they never create tasks.
INSERT INTO rule_definition
    (id, tenant_id, code, name, event_type, owner_org_unit_id,
     description, status, created_by)
VALUES
    ('43800000-0000-0000-0000-000000000001',
     '10000000-0000-0000-0000-000000000001',
     'RULE-DAILY-REPORT-DUE-SOON',
     '日报临期提醒',
     'DAILY_REPORT_DUE_SOON',
     '12000000-0000-0000-0000-000000000001',
     '日报达到配置的临期提醒时间时通知当前岗位任职。',
     'ACTIVE',
     '19000000-0000-0000-0000-000000000001'),
    ('43800000-0000-0000-0000-000000000002',
     '10000000-0000-0000-0000-000000000001',
     'RULE-DAILY-REPORT-OVERDUE',
     '日报逾期提醒',
     'DAILY_REPORT_OVERDUE',
     '12000000-0000-0000-0000-000000000001',
     '日报达到配置的逾期提醒时间时通知当前岗位任职。',
     'ACTIVE',
     '19000000-0000-0000-0000-000000000001');

INSERT INTO rule_version
    (id, tenant_id, rule_id, version_no, lifecycle_status,
     condition_ast, actions, priority, cooldown_minutes,
     effective_from, content_hash, published_by, published_at, created_by)
VALUES
    ('43900000-0000-0000-0000-000000000001',
     '10000000-0000-0000-0000-000000000001',
     '43800000-0000-0000-0000-000000000001',
     1,
     'DRAFT',
     '{"op":"EXISTS","fact":"payload.reportId"}'::jsonb,
     '[{
        "key":"notify-daily-report-due-soon",
        "type":"CREATE_NOTIFICATION",
        "recipientResolver":"CURRENT_ASSIGNMENT",
        "notificationType":"DAILY_REPORT_DUE_SOON",
        "title":"日报即将到期",
        "content":"您的岗位日报即将到期，请及时完成填报。",
        "sourceType":"DAILY_REPORT",
        "sourceIdFact":"payload.reportId"
     }]'::jsonb,
     100,
     0,
     now() - interval '1 day',
     md5('RULE-DAILY-REPORT-DUE-SOON:v1') || md5('RULE-DAILY-REPORT-DUE-SOON:v1:actions'),
     NULL,
     NULL,
     '19000000-0000-0000-0000-000000000001'),
    ('43900000-0000-0000-0000-000000000002',
     '10000000-0000-0000-0000-000000000001',
     '43800000-0000-0000-0000-000000000002',
     1,
     'DRAFT',
     '{"op":"EXISTS","fact":"payload.reportId"}'::jsonb,
     '[{
        "key":"notify-daily-report-overdue",
        "type":"CREATE_NOTIFICATION",
        "recipientResolver":"CURRENT_ASSIGNMENT",
        "notificationType":"DAILY_REPORT_OVERDUE",
        "title":"日报已逾期",
        "content":"您的岗位日报已逾期，请立即完成填报。",
        "sourceType":"DAILY_REPORT",
        "sourceIdFact":"payload.reportId"
     }]'::jsonb,
     100,
     0,
     now() - interval '1 day',
     md5('RULE-DAILY-REPORT-OVERDUE:v1') || md5('RULE-DAILY-REPORT-OVERDUE:v1:actions'),
     NULL,
     NULL,
     '19000000-0000-0000-0000-000000000001');

INSERT INTO rule_scope
    (id, tenant_id, rule_version_id, scope_type)
VALUES
    ('44000000-0000-0000-0000-000000000001',
     '10000000-0000-0000-0000-000000000001',
     '43900000-0000-0000-0000-000000000001',
     'TENANT'),
    ('44000000-0000-0000-0000-000000000002',
     '10000000-0000-0000-0000-000000000001',
     '43900000-0000-0000-0000-000000000002',
     'TENANT');

UPDATE rule_version
SET lifecycle_status = 'PUBLISHED',
    published_by = '19000000-0000-0000-0000-000000000001',
    published_at = now(),
    row_version = row_version + 1
WHERE tenant_id = '10000000-0000-0000-0000-000000000001'
  AND id IN (
      '43900000-0000-0000-0000-000000000001',
      '43900000-0000-0000-0000-000000000002'
  )
  AND lifecycle_status = 'DRAFT';
