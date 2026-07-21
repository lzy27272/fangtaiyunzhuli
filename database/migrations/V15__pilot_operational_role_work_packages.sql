-- Pilot operational readiness: every active operational assignment receives a real,
-- structured daily work item. This migration is intentionally limited to the demo
-- tenant and preserves the frozen tenant, organization, multi-position and RBAC models.

SELECT set_config('app.tenant_id', '10000000-0000-0000-0000-000000000001', false);

-- Restore the two protected Pilot accounts that were disabled during master-data UAT.
-- Password hashes are retained; this only restores account, employment, assignment and role validity.
UPDATE user_account
SET status = 'ACTIVE', failed_login_attempts = 0, locked_until = NULL, updated_at = now()
WHERE tenant_id = '10000000-0000-0000-0000-000000000001'
  AND id IN ('19000000-0000-0000-0000-000000000002',
             '19000000-0000-0000-0000-000000000007');

UPDATE employee
SET employment_status = 'ACTIVE', updated_at = now()
WHERE tenant_id = '10000000-0000-0000-0000-000000000001'
  AND id IN ('19100000-0000-0000-0000-000000000001',
             '19100000-0000-0000-0000-000000000006');

UPDATE employee_position_assignment
SET status = 'ACTIVE', valid_to = NULL, is_primary = true, updated_at = now()
WHERE tenant_id = '10000000-0000-0000-0000-000000000001'
  AND id IN ('19200000-0000-0000-0000-000000000001',
             '19200000-0000-0000-0000-000000000007');

UPDATE role_assignment
SET valid_to = NULL
WHERE tenant_id = '10000000-0000-0000-0000-000000000001'
  AND id IN ('19500000-0000-0000-0000-000000000002',
             '19500000-0000-0000-0000-000000000007');

-- Complete the fixed Pilot reporting chain used by team work, task review and escalation.
UPDATE employee_position_assignment
SET manager_assignment_id = CASE id
        WHEN '19200000-0000-0000-0000-000000000002'::uuid THEN '19200000-0000-0000-0000-000000000004'::uuid
        WHEN '19200000-0000-0000-0000-000000000003'::uuid THEN '19200000-0000-0000-0000-000000000008'::uuid
        WHEN '19200000-0000-0000-0000-000000000004'::uuid THEN '19200000-0000-0000-0000-000000000008'::uuid
        WHEN '19200000-0000-0000-0000-000000000006'::uuid THEN '19200000-0000-0000-0000-000000000007'::uuid
        WHEN '19200000-0000-0000-0000-000000000008'::uuid THEN '19200000-0000-0000-0000-000000000001'::uuid
        ELSE manager_assignment_id
    END,
    updated_at = now()
WHERE tenant_id = '10000000-0000-0000-0000-000000000001'
  AND id IN ('19200000-0000-0000-0000-000000000002',
             '19200000-0000-0000-0000-000000000003',
             '19200000-0000-0000-0000-000000000004',
             '19200000-0000-0000-0000-000000000006',
             '19200000-0000-0000-0000-000000000008');

-- One common, structured execution standard. It defines the evidence expected from
-- every daily role record without replacing role-specific SOP and evaluation standards.
INSERT INTO standard_definition
    (id, tenant_id, category_id, code, name, owner_org_unit_id, description, created_by)
SELECT
    '41200000-0000-0000-0000-000000000001',
    '10000000-0000-0000-0000-000000000001',
    category.id,
    'STD-PILOT-ROLE-DAILY',
    '岗位日清工作记录标准（Pilot）',
    '12000000-0000-0000-0000-000000000001',
    '所有运营岗位每日按工作包完成结构化记录，事实完整、异常明确、结果可追踪。',
    '19000000-0000-0000-0000-000000000001'
FROM standard_category category
WHERE category.tenant_id = '10000000-0000-0000-0000-000000000001'
  AND category.code = 'WORK'
ON CONFLICT (tenant_id, id) DO NOTHING;

INSERT INTO standard_version
    (id, tenant_id, standard_id, version_no, lifecycle_status, title, items,
     evidence_requirements, scoring_rules, created_by)
VALUES
    ('41300000-0000-0000-0000-000000000001',
     '10000000-0000-0000-0000-000000000001',
     '41200000-0000-0000-0000-000000000001', 1, 'DRAFT',
     '岗位日清工作记录标准 V1（Pilot）',
     '[{"code":"factsComplete","name":"关键事实填写完整","required":true,"weight":40},{"code":"exceptionsClear","name":"异常和风险说明清楚","required":true,"weight":30},{"code":"followUpDefined","name":"后续跟进责任明确","required":true,"weight":30}]',
     '[{"type":"WORK_RECORD","required":true}]',
     '{"passScore":80,"fullScore":100}',
     '19000000-0000-0000-0000-000000000001')
ON CONFLICT (tenant_id, id) DO NOTHING;

INSERT INTO standard_scope
    (id, tenant_id, standard_version_id, scope_type)
SELECT '41400000-0000-0000-0000-000000000001',
       '10000000-0000-0000-0000-000000000001',
       '41300000-0000-0000-0000-000000000001', 'TENANT'
WHERE EXISTS (
    SELECT 1 FROM standard_version
    WHERE tenant_id = '10000000-0000-0000-0000-000000000001'
      AND id = '41300000-0000-0000-0000-000000000001'
      AND lifecycle_status = 'DRAFT'
)
ON CONFLICT (tenant_id, id) DO NOTHING;

UPDATE standard_version
SET lifecycle_status = 'PUBLISHED', effective_from = now() - interval '1 day',
    published_by = '19000000-0000-0000-0000-000000000001', published_at = now()
WHERE tenant_id = '10000000-0000-0000-0000-000000000001'
  AND id = '41300000-0000-0000-0000-000000000001'
  AND lifecycle_status = 'DRAFT';

-- Published, role-specific forms used by the real "My Work" submission flow.
INSERT INTO form_definition
    (id, tenant_id, code, name, form_type, position_id)
VALUES
('41000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','PILOT-FRONT-DAILY','前台员工日清记录（Pilot）','DAILY_WORK','14000000-0000-0000-0000-000000000001'),
('41000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001','PILOT-HK-SUPERVISOR-DAILY','客房主管日清记录（Pilot）','INSPECTION','14000000-0000-0000-0000-000000000002'),
('41000000-0000-0000-0000-000000000003','10000000-0000-0000-0000-000000000001','PILOT-FO-SUPERVISOR-DAILY','前厅主管日清记录（Pilot）','DAILY_WORK','14000000-0000-0000-0000-000000000003'),
('41000000-0000-0000-0000-000000000004','10000000-0000-0000-0000-000000000001','PILOT-GM-DAILY','店总经营日清记录（Pilot）','DAILY_WORK','14000000-0000-0000-0000-000000000004'),
('41000000-0000-0000-0000-000000000005','10000000-0000-0000-0000-000000000001','PILOT-OTA-ASSISTANT-DAILY','OTA运营助理日清记录（Pilot）','DAILY_WORK','14000000-0000-0000-0000-000000000005'),
('41000000-0000-0000-0000-000000000006','10000000-0000-0000-0000-000000000001','PILOT-OTA-MANAGER-DAILY','OTA运营经理日清记录（Pilot）','DAILY_WORK','14000000-0000-0000-0000-000000000006'),
('41000000-0000-0000-0000-000000000007','10000000-0000-0000-0000-000000000001','PILOT-AGM-DAILY','店助管理日清记录（Pilot）','DAILY_WORK','14000000-0000-0000-0000-000000000007')
ON CONFLICT (tenant_id, id) DO NOTHING;

INSERT INTO form_version
    (id, tenant_id, form_id, version_no, lifecycle_status, json_schema, ui_schema, published_at)
VALUES
('41100000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','41000000-0000-0000-0000-000000000001',1,'PUBLISHED','{"type":"object","required":["checkins","complaintCount","handoverComplete"],"properties":{"checkins":{"type":"integer","title":"今日入住数","minimum":0},"complaintCount":{"type":"integer","title":"客诉数量","minimum":0},"vipReception":{"type":"string","title":"VIP接待情况"},"handoverComplete":{"type":"boolean","title":"交接已完成"}}}','{}',now()),
('41100000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001','41000000-0000-0000-0000-000000000002',1,'PUBLISHED','{"type":"object","required":["roomsChecked","issuesFound","photosChecked"],"properties":{"roomsChecked":{"type":"integer","title":"检查房间数","minimum":0},"issuesFound":{"type":"integer","title":"发现问题数","minimum":0},"photosChecked":{"type":"boolean","title":"图片证据已检查"},"rectificationSummary":{"type":"string","title":"整改跟进说明"}}}','{}',now()),
('41100000-0000-0000-0000-000000000003','10000000-0000-0000-0000-000000000001','41000000-0000-0000-0000-000000000003',1,'PUBLISHED','{"type":"object","required":["teamAttendance","complaintFollowUps"],"properties":{"teamAttendance":{"type":"integer","title":"班组出勤人数","minimum":0},"complaintFollowUps":{"type":"integer","title":"客诉跟进数量","minimum":0},"shiftInspectionSummary":{"type":"string","title":"班组检查与交接说明"}}}','{}',now()),
('41100000-0000-0000-0000-000000000004','10000000-0000-0000-0000-000000000001','41000000-0000-0000-0000-000000000004',1,'PUBLISHED','{"type":"object","required":["revenueReviewed","otaRiskChecked","unfinishedTasksFollowed"],"properties":{"revenueReviewed":{"type":"boolean","title":"经营数据已复盘"},"otaRiskChecked":{"type":"boolean","title":"OTA风险已检查"},"unfinishedTasksFollowed":{"type":"integer","title":"跟进未完成任务数","minimum":0},"decisions":{"type":"string","title":"今日管理决策与安排"}}}','{}',now()),
('41100000-0000-0000-0000-000000000005','10000000-0000-0000-0000-000000000001','41000000-0000-0000-0000-000000000005',1,'PUBLISHED','{"type":"object","required":["hotelsChecked","reviewsReplied","issuesFound"],"properties":{"hotelsChecked":{"type":"integer","title":"巡检门店数","minimum":0},"reviewsReplied":{"type":"integer","title":"点评回复数","minimum":0},"issuesFound":{"type":"integer","title":"发现问题数","minimum":0},"summary":{"type":"string","title":"运营情况说明"}}}','{}',now()),
('41100000-0000-0000-0000-000000000006','10000000-0000-0000-0000-000000000001','41000000-0000-0000-0000-000000000006',1,'PUBLISHED','{"type":"object","required":["hotelsReviewed","riskHotels","tasksDispatched"],"properties":{"hotelsReviewed":{"type":"integer","title":"复盘门店数","minimum":0},"riskHotels":{"type":"integer","title":"风险门店数","minimum":0},"tasksDispatched":{"type":"integer","title":"已下发整改任务数","minimum":0},"decisionNotes":{"type":"string","title":"运营决策说明"}}}','{}',now()),
('41100000-0000-0000-0000-000000000007','10000000-0000-0000-0000-000000000001','41000000-0000-0000-0000-000000000007',1,'PUBLISHED','{"type":"object","required":["departmentsReviewed","overdueTasks"],"properties":{"departmentsReviewed":{"type":"integer","title":"检查部门数","minimum":0},"overdueTasks":{"type":"integer","title":"跟进逾期任务数","minimum":0},"supportSummary":{"type":"string","title":"跨部门协调与支持说明"}}}','{}',now())
ON CONFLICT (tenant_id, id) DO NOTHING;

-- One published package per operational position. Definitions remain configuration data;
-- assignment allocation below is separate and keeps one-person-multi-position intact.
INSERT INTO work_package_definition
    (id, tenant_id, code, name, description, position_id, owner_org_unit_id, created_by)
VALUES
('42000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','WP-PILOT-FRONT-DAILY','前台员工岗位日清工作包（Pilot）','入住、客诉、VIP接待和交接日清。','14000000-0000-0000-0000-000000000001','12000000-0000-0000-0000-000000000001','19000000-0000-0000-0000-000000000001'),
('42000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001','WP-PILOT-HK-SUPERVISOR-DAILY','客房主管岗位日清工作包（Pilot）','客房检查、图片证据和整改跟进日清。','14000000-0000-0000-0000-000000000002','12000000-0000-0000-0000-000000000001','19000000-0000-0000-0000-000000000001'),
('42000000-0000-0000-0000-000000000003','10000000-0000-0000-0000-000000000001','WP-PILOT-FO-SUPERVISOR-DAILY','前厅主管岗位日清工作包（Pilot）','班组、客诉、检查和交接日清。','14000000-0000-0000-0000-000000000003','12000000-0000-0000-0000-000000000001','19000000-0000-0000-0000-000000000001'),
('42000000-0000-0000-0000-000000000004','10000000-0000-0000-0000-000000000001','WP-PILOT-GM-DAILY','店总经营管理日清工作包（Pilot）','经营数据、OTA风险、任务和管理决策日清。','14000000-0000-0000-0000-000000000004','12000000-0000-0000-0000-000000000001','19000000-0000-0000-0000-000000000001'),
('42000000-0000-0000-0000-000000000005','10000000-0000-0000-0000-000000000001','WP-PILOT-OTA-ASSISTANT-DAILY','OTA运营助理岗位日清工作包（Pilot）','门店巡检、点评回复和问题记录日清。','14000000-0000-0000-0000-000000000005','12000000-0000-0000-0000-000000000001','19000000-0000-0000-0000-000000000001'),
('42000000-0000-0000-0000-000000000006','10000000-0000-0000-0000-000000000001','WP-PILOT-OTA-MANAGER-DAILY','OTA运营经理岗位日清工作包（Pilot）','多门店复盘、风险识别和任务下发日清。','14000000-0000-0000-0000-000000000006','12000000-0000-0000-0000-000000000001','19000000-0000-0000-0000-000000000001'),
('42000000-0000-0000-0000-000000000007','10000000-0000-0000-0000-000000000001','WP-PILOT-AGM-DAILY','店助管理日清工作包（Pilot）','部门执行、逾期任务和跨部门支持日清。','14000000-0000-0000-0000-000000000007','12000000-0000-0000-0000-000000000001','19000000-0000-0000-0000-000000000001')
ON CONFLICT (tenant_id, id) DO NOTHING;

INSERT INTO work_package_version
    (id, tenant_id, work_package_definition_id, version_no, lifecycle_status, title,
     description, content_hash, created_by)
SELECT ('42100000-0000-0000-0000-' || lpad(index_no::text, 12, '0'))::uuid,
       '10000000-0000-0000-0000-000000000001',
       ('42000000-0000-0000-0000-' || lpad(index_no::text, 12, '0'))::uuid,
       1, 'DRAFT', package_title || ' V1', package_title, repeat(index_no::text, 64),
       '19000000-0000-0000-0000-000000000001'
FROM (VALUES
    (1, '前台员工岗位日清工作包（Pilot）'),
    (2, '客房主管岗位日清工作包（Pilot）'),
    (3, '前厅主管岗位日清工作包（Pilot）'),
    (4, '店总经营管理日清工作包（Pilot）'),
    (5, 'OTA运营助理岗位日清工作包（Pilot）'),
    (6, 'OTA运营经理岗位日清工作包（Pilot）'),
    (7, '店助管理日清工作包（Pilot）')
) AS packages(index_no, package_title)
ON CONFLICT (tenant_id, id) DO NOTHING;

INSERT INTO work_package_scope
    (id, tenant_id, work_package_version_id, scope_type)
SELECT ('42200000-0000-0000-0000-' || lpad(index_no::text, 12, '0'))::uuid,
       '10000000-0000-0000-0000-000000000001',
       ('42100000-0000-0000-0000-' || lpad(index_no::text, 12, '0'))::uuid,
       'TENANT'
FROM generate_series(1, 7) AS indexes(index_no)
WHERE EXISTS (
    SELECT 1 FROM work_package_version version
    WHERE version.tenant_id = '10000000-0000-0000-0000-000000000001'
      AND version.id = ('42100000-0000-0000-0000-' || lpad(index_no::text, 12, '0'))::uuid
      AND version.lifecycle_status = 'DRAFT'
)
ON CONFLICT (tenant_id, id) DO NOTHING;

INSERT INTO work_package_item
    (id, tenant_id, work_package_version_id, item_code, name, description, item_type,
     form_version_id, sort_order, required, period_type, timezone_mode, due_local_time,
     grace_minutes, holiday_policy, waiver_allowed, target_granularity, review_mode)
SELECT ('42300000-0000-0000-0000-' || lpad(index_no::text, 12, '0'))::uuid,
       '10000000-0000-0000-0000-000000000001',
       ('42100000-0000-0000-0000-' || lpad(index_no::text, 12, '0'))::uuid,
       item_code, item_name, item_description, item_type,
       ('41100000-0000-0000-0000-' || lpad(index_no::text, 12, '0'))::uuid,
       1, true, 'DAY', 'HOTEL', '23:00:00', 30, 'INCLUDE', false,
       'ASSIGNMENT_ORG', 'NONE'
FROM (VALUES
    (1, 'FRONT_DAILY', '完成前台岗位日清', '填写入住、客诉、VIP接待和交接情况。', 'SCHEDULED_RECORD'),
    (2, 'HK_SUPERVISOR_DAILY', '完成客房主管日清', '填写客房检查、图片证据和整改跟进情况。', 'INSPECTION'),
    (3, 'FO_SUPERVISOR_DAILY', '完成前厅主管日清', '填写班组、客诉跟进、检查和交接情况。', 'SCHEDULED_RECORD'),
    (4, 'GM_DAILY', '完成店总经营管理日清', '填写经营复盘、风险、未完成任务和管理决策。', 'METRIC_REVIEW'),
    (5, 'OTA_ASSISTANT_DAILY', '完成OTA运营助理日清', '填写门店巡检、点评回复和问题情况。', 'SCHEDULED_RECORD'),
    (6, 'OTA_MANAGER_DAILY', '完成OTA运营经理日清', '填写多门店复盘、风险识别和任务下发情况。', 'METRIC_REVIEW'),
    (7, 'AGM_DAILY', '完成店助管理日清', '填写部门执行、逾期任务和跨部门支持情况。', 'SCHEDULED_RECORD')
) AS items(index_no, item_code, item_name, item_description, item_type)
WHERE EXISTS (
    SELECT 1 FROM work_package_version version
    WHERE version.tenant_id = '10000000-0000-0000-0000-000000000001'
      AND version.id = ('42100000-0000-0000-0000-' || lpad(index_no::text, 12, '0'))::uuid
      AND version.lifecycle_status = 'DRAFT'
)
ON CONFLICT (tenant_id, id) DO NOTHING;

INSERT INTO work_package_item_standard
    (id, tenant_id, work_package_item_id, standard_version_id, usage_type, weight)
SELECT ('42400000-0000-0000-0000-' || lpad(index_no::text, 12, '0'))::uuid,
       '10000000-0000-0000-0000-000000000001',
       ('42300000-0000-0000-0000-' || lpad(index_no::text, 12, '0'))::uuid,
       '41300000-0000-0000-0000-000000000001', 'EXECUTION', 1
FROM generate_series(1, 7) AS indexes(index_no)
WHERE EXISTS (
    SELECT 1 FROM work_package_version version
    WHERE version.tenant_id = '10000000-0000-0000-0000-000000000001'
      AND version.id = ('42100000-0000-0000-0000-' || lpad(index_no::text, 12, '0'))::uuid
      AND version.lifecycle_status = 'DRAFT'
)
ON CONFLICT (tenant_id, id) DO NOTHING;

INSERT INTO work_package_item_responsibility
    (id, tenant_id, work_package_item_id, participant_type, resolver_type, scope_strategy, escalation_level)
SELECT ('42500000-0000-0000-0000-' || lpad(index_no::text, 12, '0'))::uuid,
       '10000000-0000-0000-0000-000000000001',
       ('42300000-0000-0000-0000-' || lpad(index_no::text, 12, '0'))::uuid,
       'EXECUTOR', 'CURRENT_ASSIGNMENT', 'ASSIGNMENT_ORG', 0
FROM generate_series(1, 7) AS indexes(index_no)
WHERE EXISTS (
    SELECT 1 FROM work_package_version version
    WHERE version.tenant_id = '10000000-0000-0000-0000-000000000001'
      AND version.id = ('42100000-0000-0000-0000-' || lpad(index_no::text, 12, '0'))::uuid
      AND version.lifecycle_status = 'DRAFT'
)
ON CONFLICT (tenant_id, id) DO NOTHING;

UPDATE work_package_version
SET lifecycle_status = 'PUBLISHED', effective_from = now() - interval '1 day',
    published_by = '19000000-0000-0000-0000-000000000001', published_at = now(), updated_at = now()
WHERE tenant_id = '10000000-0000-0000-0000-000000000001'
  AND id IN (
      '42100000-0000-0000-0000-000000000001','42100000-0000-0000-0000-000000000002',
      '42100000-0000-0000-0000-000000000003','42100000-0000-0000-0000-000000000004',
      '42100000-0000-0000-0000-000000000005','42100000-0000-0000-0000-000000000006',
      '42100000-0000-0000-0000-000000000007')
  AND lifecycle_status = 'DRAFT';

-- Allocate the matching package to every currently active assignment. This includes
-- user-created Pilot employees and therefore avoids coupling work to fixed demo names.
INSERT INTO work_package_allocation
    (id, tenant_id, work_package_version_id, position_assignment_id, target_org_unit_id,
     allocation_source, valid_from, status, allocated_by)
SELECT gen_random_uuid(), assignment.tenant_id, version.id, assignment.id, assignment.org_unit_id,
       'SYSTEM', current_date - 1, 'ACTIVE', '19000000-0000-0000-0000-000000000001'
FROM employee_position_assignment assignment
JOIN employee employee_row
  ON employee_row.tenant_id = assignment.tenant_id AND employee_row.id = assignment.employee_id
JOIN user_account account
  ON account.tenant_id = employee_row.tenant_id AND account.id = employee_row.account_id
JOIN work_package_definition definition
  ON definition.tenant_id = assignment.tenant_id AND definition.position_id = assignment.position_id
JOIN work_package_version version
  ON version.tenant_id = definition.tenant_id
 AND version.work_package_definition_id = definition.id
 AND version.lifecycle_status = 'PUBLISHED'
WHERE assignment.tenant_id = '10000000-0000-0000-0000-000000000001'
  AND definition.code LIKE 'WP-PILOT-%'
  AND assignment.status = 'ACTIVE'
  AND assignment.valid_from <= current_date
  AND (assignment.valid_to IS NULL OR assignment.valid_to >= current_date)
  AND employee_row.employment_status = 'ACTIVE'
  AND account.status = 'ACTIVE'
  AND NOT EXISTS (
      SELECT 1 FROM work_package_allocation existing
      WHERE existing.tenant_id = assignment.tenant_id
        AND existing.work_package_version_id = version.id
        AND existing.position_assignment_id = assignment.id
        AND existing.target_org_unit_id = assignment.org_unit_id
        AND existing.status = 'ACTIVE'
        AND existing.valid_from <= current_date
        AND (existing.valid_to IS NULL OR existing.valid_to >= current_date)
  );

-- Materialize today's real work. The unique business key keeps restart/re-run behavior safe.
INSERT INTO work_expectation
    (id, tenant_id, work_package_item_id, work_package_allocation_id, position_assignment_id,
     target_org_unit_id, business_date, period_key, available_at, due_at, status, waiver_allowed)
SELECT gen_random_uuid(), allocation.tenant_id, item.id, allocation.id,
       allocation.position_assignment_id, allocation.target_org_unit_id, current_date,
       'PILOT-DAILY:' || to_char(current_date, 'YYYY-MM-DD'),
       date_trunc('day', now()), date_trunc('day', now()) + interval '23 hours 59 minutes',
       'AVAILABLE', item.waiver_allowed
FROM work_package_allocation allocation
JOIN work_package_version version
  ON version.tenant_id = allocation.tenant_id AND version.id = allocation.work_package_version_id
JOIN work_package_definition definition
  ON definition.tenant_id = version.tenant_id AND definition.id = version.work_package_definition_id
JOIN work_package_item item
  ON item.tenant_id = version.tenant_id AND item.work_package_version_id = version.id
WHERE allocation.tenant_id = '10000000-0000-0000-0000-000000000001'
  AND definition.code LIKE 'WP-PILOT-%'
  AND allocation.status = 'ACTIVE'
  AND allocation.valid_from <= current_date
  AND (allocation.valid_to IS NULL OR allocation.valid_to >= current_date)
ON CONFLICT (tenant_id, work_package_item_id, position_assignment_id, target_org_unit_id, period_key)
DO NOTHING;

