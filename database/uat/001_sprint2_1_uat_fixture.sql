\set ON_ERROR_STOP on

-- Sprint 2.1 UAT fixture. This file is intentionally outside database/migrations.
-- Apply only after Flyway V1-V13 completed. Rebuild the disposable UAT volume for a clean rerun.

BEGIN;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM flyway_schema_history WHERE version = '13' AND success = true
    ) THEN
        RAISE EXCEPTION 'Sprint 2.1 UAT fixture requires successful Flyway V13';
    END IF;
END $$;

SELECT set_config('app.tenant_id', '10000000-0000-0000-0000-000000000001', true);

-- The six UAT accounts are real user_account/employee/assignment rows created by V3 and V10.
-- Local UAT authenticates them through tenant/actor headers; permissions are resolved from DB RBAC.
DO $$
DECLARE
    missing_count INTEGER;
BEGIN
    SELECT count(*) INTO missing_count
    FROM (VALUES
        ('19000000-0000-0000-0000-000000000003'::uuid, '前台员工'),
        ('19000000-0000-0000-0000-000000000005'::uuid, '前厅主管'),
        ('19000000-0000-0000-0000-000000000004'::uuid, '客房主管'),
        ('19000000-0000-0000-0000-000000000008'::uuid, '店助'),
        ('19000000-0000-0000-0000-000000000002'::uuid, '店总'),
        ('19000000-0000-0000-0000-000000000007'::uuid, '区域运营')
    ) AS expected(account_id, role_name)
    LEFT JOIN user_account account
      ON account.tenant_id = '10000000-0000-0000-0000-000000000001'
     AND account.id = expected.account_id
    WHERE account.id IS NULL;
    IF missing_count <> 0 THEN
        RAISE EXCEPTION 'Six-role UAT seed is incomplete: % accounts missing', missing_count;
    END IF;
END $$;

-- Complete the responsibility chain used by rule-driven task assignment.
UPDATE employee_position_assignment
SET manager_assignment_id = CASE id
    WHEN '19200000-0000-0000-0000-000000000007'::uuid THEN '19200000-0000-0000-0000-000000000001'::uuid
    WHEN '19200000-0000-0000-0000-000000000002'::uuid THEN '19200000-0000-0000-0000-000000000004'::uuid
    WHEN '19200000-0000-0000-0000-000000000003'::uuid THEN '19200000-0000-0000-0000-000000000008'::uuid
    WHEN '19200000-0000-0000-0000-000000000004'::uuid THEN '19200000-0000-0000-0000-000000000008'::uuid
    WHEN '19200000-0000-0000-0000-000000000008'::uuid THEN '19200000-0000-0000-0000-000000000001'::uuid
    ELSE manager_assignment_id
END
WHERE tenant_id = '10000000-0000-0000-0000-000000000001'
  AND id IN (
      '19200000-0000-0000-0000-000000000007',
      '19200000-0000-0000-0000-000000000002',
      '19200000-0000-0000-0000-000000000003',
      '19200000-0000-0000-0000-000000000004',
      '19200000-0000-0000-0000-000000000008'
  );

-- Add a second region and third hotel. East/Hangzhou/Shanghai already come from V3.
INSERT INTO org_unit (id, tenant_id, parent_id, code, name, unit_type, sort_order)
VALUES
('21000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001',
 '12000000-0000-0000-0000-000000000001', 'SOUTH-REGION-UAT', '华南区域（UAT）', 'REGION', 2),
('21000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001',
 '21000000-0000-0000-0000-000000000001', 'SZ-BAY-UAT', '深圳湾店（UAT）', 'HOTEL', 1),
('21000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000001',
 '21000000-0000-0000-0000-000000000002', 'SZ-FRONT-UAT', '深圳湾店前厅部（UAT）', 'DEPARTMENT', 1)
ON CONFLICT (tenant_id, id) DO NOTHING;

INSERT INTO org_unit_closure (tenant_id, ancestor_id, descendant_id, depth) VALUES
('10000000-0000-0000-0000-000000000001','21000000-0000-0000-0000-000000000001','21000000-0000-0000-0000-000000000001',0),
('10000000-0000-0000-0000-000000000001','21000000-0000-0000-0000-000000000002','21000000-0000-0000-0000-000000000002',0),
('10000000-0000-0000-0000-000000000001','21000000-0000-0000-0000-000000000003','21000000-0000-0000-0000-000000000003',0),
('10000000-0000-0000-0000-000000000001','12000000-0000-0000-0000-000000000001','21000000-0000-0000-0000-000000000001',1),
('10000000-0000-0000-0000-000000000001','12000000-0000-0000-0000-000000000001','21000000-0000-0000-0000-000000000002',2),
('10000000-0000-0000-0000-000000000001','12000000-0000-0000-0000-000000000001','21000000-0000-0000-0000-000000000003',3),
('10000000-0000-0000-0000-000000000001','21000000-0000-0000-0000-000000000001','21000000-0000-0000-0000-000000000002',1),
('10000000-0000-0000-0000-000000000001','21000000-0000-0000-0000-000000000001','21000000-0000-0000-0000-000000000003',2),
('10000000-0000-0000-0000-000000000001','21000000-0000-0000-0000-000000000002','21000000-0000-0000-0000-000000000003',1)
ON CONFLICT DO NOTHING;

INSERT INTO hotel_profile
    (id, tenant_id, org_unit_id, brand_id, property_code, city, room_count)
VALUES
    ('21000000-0000-0000-0000-000000000004', '10000000-0000-0000-0000-000000000001',
     '21000000-0000-0000-0000-000000000002', '11000000-0000-0000-0000-000000000001',
     'SZ-UAT-001', '深圳', 168)
ON CONFLICT (tenant_id, id) DO NOTHING;

-- Standards are created as DRAFT, scoped, then published so immutability triggers remain meaningful.
INSERT INTO standard_definition
    (id, tenant_id, category_id, code, name, owner_org_unit_id, description, created_by)
VALUES
('26000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001',
 '15000000-0000-0000-0000-000000000004', 'STD-UAT-OTA-INSPECTION', '区域多门店OTA巡检标准（UAT）',
 '12000000-0000-0000-0000-000000000001', '用于区域运营多门店异常、评价、规则和整改闭环验收。',
 '19000000-0000-0000-0000-000000000001'),
('26000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001',
 '15000000-0000-0000-0000-000000000003', 'STD-UAT-FRONT-COMPLAINT', '前台客诉闭环标准（UAT）',
 '12000000-0000-0000-0000-000000000001', '用于前台客诉记录、主管整改和店助验收。',
 '19000000-0000-0000-0000-000000000001'),
('26000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000001',
 '15000000-0000-0000-0000-000000000004', 'STD-UAT-HK-ROOM-CHECK', '客房巡检与图片证据标准（UAT）',
 '12000000-0000-0000-0000-000000000003', '用于客房主管巡检、真实图片上传、整改和标准评价验收。',
 '19000000-0000-0000-0000-000000000001')
ON CONFLICT (tenant_id, id) DO NOTHING;

INSERT INTO standard_version
    (id, tenant_id, standard_id, version_no, lifecycle_status, title, items,
     evidence_requirements, scoring_rules, created_by)
VALUES
('27000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001',
 '26000000-0000-0000-0000-000000000001', 1, 'DRAFT', '区域多门店OTA巡检标准 V1（UAT）',
 '[{"code":"otaScore","mode":"DETERMINISTIC","operator":"GTE","expected":4.9,"required":true,"weight":40},{"code":"replyCompleted","mode":"DETERMINISTIC","operator":"EQ","expected":true,"required":true,"weight":30},{"code":"pageHealthy","mode":"DETERMINISTIC","operator":"EQ","expected":true,"required":true,"weight":30}]',
 '[{"type":"SNAPSHOT","required":true},{"type":"IMAGE","required":false}]',
 '{"passScore":80,"fullScore":100}', '19000000-0000-0000-0000-000000000001'),
('27000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001',
 '26000000-0000-0000-0000-000000000002', 1, 'DRAFT', '前台客诉闭环标准 V1（UAT）',
 '[{"code":"complaintRecorded","mode":"DETERMINISTIC","operator":"EQ","expected":true,"required":true,"weight":30},{"code":"guestContacted","mode":"DETERMINISTIC","operator":"EQ","expected":true,"required":true,"weight":40},{"code":"resolutionSummary","mode":"DETERMINISTIC","operator":"PRESENT","required":true,"weight":30}]',
 '[{"type":"WORK_RECORD","required":true}]',
 '{"passScore":80,"fullScore":100}', '19000000-0000-0000-0000-000000000001'),
('27000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000001',
 '26000000-0000-0000-0000-000000000003', 1, 'DRAFT', '客房巡检与图片证据标准 V1（UAT）',
 '[{"code":"roomsChecked","mode":"DETERMINISTIC","operator":"GTE","expected":1,"required":true,"weight":30},{"code":"photoAttached","mode":"DETERMINISTIC","operator":"EQ","expected":true,"required":true,"weight":40},{"code":"issueClosed","mode":"DETERMINISTIC","operator":"EQ","expected":true,"required":true,"weight":30}]',
 '[{"type":"IMAGE","required":true},{"type":"WORK_RECORD","required":true}]',
 '{"passScore":80,"fullScore":100}', '19000000-0000-0000-0000-000000000001')
ON CONFLICT (tenant_id, id) DO NOTHING;

INSERT INTO standard_scope
    (id, tenant_id, standard_version_id, scope_type, position_id)
SELECT * FROM (VALUES
('27100000-0000-0000-0000-000000000001'::uuid, '10000000-0000-0000-0000-000000000001'::uuid,
 '27000000-0000-0000-0000-000000000001'::uuid, 'POSITION'::varchar, '14000000-0000-0000-0000-000000000006'::uuid),
('27100000-0000-0000-0000-000000000002'::uuid, '10000000-0000-0000-0000-000000000001'::uuid,
 '27000000-0000-0000-0000-000000000002'::uuid, 'POSITION'::varchar, '14000000-0000-0000-0000-000000000001'::uuid),
('27100000-0000-0000-0000-000000000003'::uuid, '10000000-0000-0000-0000-000000000001'::uuid,
 '27000000-0000-0000-0000-000000000003'::uuid, 'POSITION'::varchar, '14000000-0000-0000-0000-000000000002'::uuid)
) AS fixture(id, tenant_id, standard_version_id, scope_type, position_id)
WHERE NOT EXISTS (
    SELECT 1 FROM standard_scope scope WHERE scope.tenant_id = fixture.tenant_id AND scope.id = fixture.id
);

UPDATE standard_version
SET lifecycle_status = 'PUBLISHED', effective_from = now() - interval '1 day',
    published_by = '19000000-0000-0000-0000-000000000001', published_at = now()
WHERE tenant_id = '10000000-0000-0000-0000-000000000001'
  AND id IN ('27000000-0000-0000-0000-000000000001', '27000000-0000-0000-0000-000000000002',
             '27000000-0000-0000-0000-000000000003')
  AND lifecycle_status = 'DRAFT';

-- UAT forms. They are data fixtures, not schema migrations.
INSERT INTO form_definition
    (id, tenant_id, code, name, form_type, position_id)
VALUES
('29600000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001',
 'UAT-OTA-DAILY', '区域多门店OTA巡检记录（UAT）', 'INSPECTION', '14000000-0000-0000-0000-000000000006'),
('29600000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001',
 'UAT-FRONT-COMPLAINT', '前台客诉记录（UAT）', 'COMPLAINT', '14000000-0000-0000-0000-000000000001'),
('29600000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000001',
 'UAT-HK-ROOM-CHECK', '客房巡检记录（UAT）', 'INSPECTION', '14000000-0000-0000-0000-000000000002')
ON CONFLICT (tenant_id, id) DO NOTHING;

INSERT INTO form_version
    (id, tenant_id, form_id, version_no, lifecycle_status, json_schema, ui_schema, published_at)
VALUES
('29700000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001',
 '29600000-0000-0000-0000-000000000001', 1, 'PUBLISHED',
 '{"type":"object","required":["otaScore","replyCompleted","pageHealthy"],"properties":{"otaScore":{"type":"number","minimum":0,"maximum":5},"replyCompleted":{"type":"boolean"},"pageHealthy":{"type":"boolean"},"summary":{"type":"string"}}}',
 '{}', now()),
('29700000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001',
 '29600000-0000-0000-0000-000000000002', 1, 'PUBLISHED',
 '{"type":"object","required":["complaintRecorded","guestContacted","resolutionSummary"],"properties":{"complaintRecorded":{"type":"boolean"},"guestContacted":{"type":"boolean"},"resolutionSummary":{"type":"string","minLength":1},"guestName":{"type":"string"}}}',
 '{}', now()),
('29700000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000001',
 '29600000-0000-0000-0000-000000000003', 1, 'PUBLISHED',
 '{"type":"object","required":["roomsChecked","photoAttached","issueClosed"],"properties":{"roomsChecked":{"type":"integer","minimum":1},"photoAttached":{"type":"boolean"},"issueClosed":{"type":"boolean"},"summary":{"type":"string"}}}',
 '{}', now())
ON CONFLICT (tenant_id, id) DO NOTHING;

-- Work package definitions and draft versions.
INSERT INTO work_package_definition
    (id, tenant_id, code, name, description, position_id, owner_org_unit_id, created_by)
VALUES
('2a000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001',
 'WP-UAT-FRONT-SHIFT', '前台班次客诉工作包（UAT）', '前台员工班次客诉记录及主管验收。',
 '14000000-0000-0000-0000-000000000001', '12000000-0000-0000-0000-000000000003',
 '19000000-0000-0000-0000-000000000001'),
('2a000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001',
 'WP-UAT-OTA-DAILY', '区域多门店巡检工作包（UAT）', '区域运营在授权区域内逐店巡检。',
 '14000000-0000-0000-0000-000000000006', '12000000-0000-0000-0000-000000000002',
 '19000000-0000-0000-0000-000000000001'),
('2a000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000001',
 'WP-UAT-HK-ROOM-CHECK', '客房巡检与图片证据工作包（UAT）', '客房主管完成巡检、上传现场图片并关闭问题。',
 '14000000-0000-0000-0000-000000000002', '12000000-0000-0000-0000-000000000003',
 '19000000-0000-0000-0000-000000000001')
ON CONFLICT (tenant_id, id) DO NOTHING;

INSERT INTO work_package_version
    (id, tenant_id, work_package_definition_id, version_no, lifecycle_status, title,
     description, content_hash, created_by)
VALUES
('2a100000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001',
 '2a000000-0000-0000-0000-000000000001', 1, 'DRAFT', '前台班次客诉工作包 V1（UAT）',
 '一个班次生成一个客诉工作期望。', repeat('a', 64), '19000000-0000-0000-0000-000000000001'),
('2a100000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001',
 '2a000000-0000-0000-0000-000000000002', 1, 'DRAFT', '区域多门店巡检工作包 V1（UAT）',
 '每天为区域运营的每个授权目标门店生成工作期望。', repeat('b', 64), '19000000-0000-0000-0000-000000000001'),
('2a100000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000001',
 '2a000000-0000-0000-0000-000000000003', 1, 'DRAFT', '客房巡检与图片证据工作包 V1（UAT）',
 '每天为客房主管生成巡检与图片证据工作期望。', repeat('e', 64), '19000000-0000-0000-0000-000000000001')
ON CONFLICT (tenant_id, id) DO NOTHING;

INSERT INTO work_package_scope (id, tenant_id, work_package_version_id, scope_type, org_unit_id)
SELECT * FROM (VALUES
('2a110000-0000-0000-0000-000000000001'::uuid, '10000000-0000-0000-0000-000000000001'::uuid,
 '2a100000-0000-0000-0000-000000000001'::uuid, 'ORG_TREE'::varchar, '12000000-0000-0000-0000-000000000003'::uuid),
('2a110000-0000-0000-0000-000000000002'::uuid, '10000000-0000-0000-0000-000000000001'::uuid,
 '2a100000-0000-0000-0000-000000000002'::uuid, 'ORG_TREE'::varchar, '12000000-0000-0000-0000-000000000002'::uuid),
('2a110000-0000-0000-0000-000000000003'::uuid, '10000000-0000-0000-0000-000000000001'::uuid,
 '2a100000-0000-0000-0000-000000000003'::uuid, 'ORG_TREE'::varchar, '12000000-0000-0000-0000-000000000003'::uuid)
) AS fixture(id, tenant_id, work_package_version_id, scope_type, org_unit_id)
WHERE NOT EXISTS (SELECT 1 FROM work_package_scope scope WHERE scope.tenant_id = fixture.tenant_id AND scope.id = fixture.id);

INSERT INTO work_package_item
    (id, tenant_id, work_package_version_id, item_code, name, description, item_type,
     form_version_id, sort_order, period_type, timezone_mode, due_local_time,
     grace_minutes, target_granularity, review_mode)
SELECT * FROM (VALUES
('2a200000-0000-0000-0000-000000000001'::uuid, '10000000-0000-0000-0000-000000000001'::uuid,
 '2a100000-0000-0000-0000-000000000001'::uuid, 'FRONT_COMPLAINT'::varchar, '班次客诉记录'::varchar,
 '记录、联系客人并形成处理说明。'::text, 'SCHEDULED_RECORD'::varchar,
 '29700000-0000-0000-0000-000000000002'::uuid, 1, 'SHIFT'::varchar, 'HOTEL'::varchar,
 '23:00:00'::time, 15, 'TARGET_ORG'::varchar, 'STANDARD_EVALUATION'::varchar),
('2a200000-0000-0000-0000-000000000002'::uuid, '10000000-0000-0000-0000-000000000001'::uuid,
 '2a100000-0000-0000-0000-000000000002'::uuid, 'OTA_DAILY_INSPECTION'::varchar, 'OTA逐店巡检'::varchar,
 '检查评分、页面健康与点评回复。'::text, 'INSPECTION'::varchar,
 '29700000-0000-0000-0000-000000000001'::uuid, 1, 'DAY'::varchar, 'TENANT'::varchar,
 '18:00:00'::time, 30, 'TARGET_ORG'::varchar, 'STANDARD_EVALUATION'::varchar),
('2a200000-0000-0000-0000-000000000003'::uuid, '10000000-0000-0000-0000-000000000001'::uuid,
 '2a100000-0000-0000-0000-000000000003'::uuid, 'HK_ROOM_CHECK'::varchar, '客房巡检与图片证据'::varchar,
 '完成客房巡检、上传现场图片并确认问题关闭。'::text, 'INSPECTION'::varchar,
 '29700000-0000-0000-0000-000000000003'::uuid, 1, 'DAY'::varchar, 'HOTEL'::varchar,
 '17:30:00'::time, 30, 'TARGET_ORG'::varchar, 'STANDARD_EVALUATION'::varchar)
) AS fixture(id, tenant_id, work_package_version_id, item_code, name, description, item_type,
             form_version_id, sort_order, period_type, timezone_mode, due_local_time,
             grace_minutes, target_granularity, review_mode)
WHERE NOT EXISTS (SELECT 1 FROM work_package_item item WHERE item.tenant_id = fixture.tenant_id AND item.id = fixture.id);

INSERT INTO work_package_item_standard
    (id, tenant_id, work_package_item_id, standard_version_id, usage_type, weight)
SELECT * FROM (VALUES
('2a210000-0000-0000-0000-000000000001'::uuid, '10000000-0000-0000-0000-000000000001'::uuid,
 '2a200000-0000-0000-0000-000000000001'::uuid, '27000000-0000-0000-0000-000000000002'::uuid, 'ACCEPTANCE'::varchar, 1::numeric),
('2a210000-0000-0000-0000-000000000002'::uuid, '10000000-0000-0000-0000-000000000001'::uuid,
 '2a200000-0000-0000-0000-000000000002'::uuid, '27000000-0000-0000-0000-000000000001'::uuid, 'ACCEPTANCE'::varchar, 1::numeric),
('2a210000-0000-0000-0000-000000000003'::uuid, '10000000-0000-0000-0000-000000000001'::uuid,
 '2a200000-0000-0000-0000-000000000003'::uuid, '27000000-0000-0000-0000-000000000003'::uuid, 'ACCEPTANCE'::varchar, 1::numeric)
) AS fixture(id, tenant_id, work_package_item_id, standard_version_id, usage_type, weight)
WHERE NOT EXISTS (SELECT 1 FROM work_package_item_standard link WHERE link.tenant_id = fixture.tenant_id AND link.id = fixture.id);

INSERT INTO work_package_item_responsibility
    (id, tenant_id, work_package_item_id, participant_type, resolver_type, position_id, scope_strategy, escalation_level)
SELECT * FROM (VALUES
('2a220000-0000-0000-0000-000000000001'::uuid, '10000000-0000-0000-0000-000000000001'::uuid,
 '2a200000-0000-0000-0000-000000000001'::uuid, 'EXECUTOR'::varchar, 'CURRENT_ASSIGNMENT'::varchar,
 NULL::uuid, 'TARGET_ORG'::varchar, 0),
('2a220000-0000-0000-0000-000000000002'::uuid, '10000000-0000-0000-0000-000000000001'::uuid,
 '2a200000-0000-0000-0000-000000000001'::uuid, 'ACCEPTOR'::varchar, 'POSITION_IN_SAME_ORG'::varchar,
 '14000000-0000-0000-0000-000000000003'::uuid, 'TARGET_ORG'::varchar, 0),
('2a220000-0000-0000-0000-000000000003'::uuid, '10000000-0000-0000-0000-000000000001'::uuid,
 '2a200000-0000-0000-0000-000000000002'::uuid, 'EXECUTOR'::varchar, 'CURRENT_ASSIGNMENT'::varchar,
 NULL::uuid, 'TARGET_ORG'::varchar, 0),
('2a220000-0000-0000-0000-000000000004'::uuid, '10000000-0000-0000-0000-000000000001'::uuid,
 '2a200000-0000-0000-0000-000000000002'::uuid, 'REVIEWER'::varchar, 'DIRECT_MANAGER_ASSIGNMENT'::varchar,
 NULL::uuid, 'TARGET_ORG'::varchar, 0),
('2a220000-0000-0000-0000-000000000005'::uuid, '10000000-0000-0000-0000-000000000001'::uuid,
 '2a200000-0000-0000-0000-000000000003'::uuid, 'EXECUTOR'::varchar, 'CURRENT_ASSIGNMENT'::varchar,
 NULL::uuid, 'TARGET_ORG'::varchar, 0),
('2a220000-0000-0000-0000-000000000006'::uuid, '10000000-0000-0000-0000-000000000001'::uuid,
 '2a200000-0000-0000-0000-000000000003'::uuid, 'REVIEWER'::varchar, 'DIRECT_MANAGER_ASSIGNMENT'::varchar,
 NULL::uuid, 'TARGET_ORG'::varchar, 1)
) AS fixture(id, tenant_id, work_package_item_id, participant_type, resolver_type, position_id, scope_strategy, escalation_level)
WHERE NOT EXISTS (SELECT 1 FROM work_package_item_responsibility responsibility
                  WHERE responsibility.tenant_id = fixture.tenant_id AND responsibility.id = fixture.id);

UPDATE work_package_version
SET lifecycle_status = 'PUBLISHED', effective_from = now() - interval '1 day',
    published_by = '19000000-0000-0000-0000-000000000001', published_at = now()
WHERE tenant_id = '10000000-0000-0000-0000-000000000001'
  AND id IN ('2a100000-0000-0000-0000-000000000001', '2a100000-0000-0000-0000-000000000002',
             '2a100000-0000-0000-0000-000000000003')
  AND lifecycle_status = 'DRAFT';

-- Allocate front desk and housekeeping packages in Hangzhou, plus regional operations to two East-region hotels.
INSERT INTO work_package_allocation
    (id, tenant_id, work_package_version_id, position_assignment_id, target_org_unit_id,
     allocation_source, valid_from, status, allocated_by)
VALUES
('2a300000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001',
 '2a100000-0000-0000-0000-000000000001', '19200000-0000-0000-0000-000000000002',
 '12000000-0000-0000-0000-000000000005', 'MANUAL', current_date - 7, 'ACTIVE',
 '19000000-0000-0000-0000-000000000001'),
('2a300000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001',
 '2a100000-0000-0000-0000-000000000002', '19200000-0000-0000-0000-000000000007',
 '12000000-0000-0000-0000-000000000003', 'MANUAL', current_date - 7, 'ACTIVE',
 '19000000-0000-0000-0000-000000000001'),
('2a300000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000001',
 '2a100000-0000-0000-0000-000000000002', '19200000-0000-0000-0000-000000000007',
 '12000000-0000-0000-0000-000000000004', 'MANUAL', current_date - 7, 'ACTIVE',
 '19000000-0000-0000-0000-000000000001'),
('2a300000-0000-0000-0000-000000000004', '10000000-0000-0000-0000-000000000001',
 '2a100000-0000-0000-0000-000000000003', '19200000-0000-0000-0000-000000000003',
 '12000000-0000-0000-0000-000000000006', 'MANUAL', current_date - 7, 'ACTIVE',
 '19000000-0000-0000-0000-000000000001')
ON CONFLICT (tenant_id, id) DO NOTHING;

INSERT INTO work_duty_period
    (id, tenant_id, position_assignment_id, target_org_unit_id, business_date, period_type,
     shift_code, planned_start_at, planned_end_at, status, source_record_id, created_by)
VALUES
('2a400000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001',
 '19200000-0000-0000-0000-000000000002', '12000000-0000-0000-0000-000000000005',
 current_date, 'SHIFT', 'UAT-AM', date_trunc('day', now()) + interval '8 hours',
 date_trunc('day', now()) + interval '16 hours', 'PLANNED', 'UAT-FRONT-AM',
 '19000000-0000-0000-0000-000000000001')
ON CONFLICT (tenant_id, id) DO NOTHING;

INSERT INTO work_expectation
    (id, tenant_id, work_package_item_id, work_package_allocation_id, position_assignment_id,
     duty_period_id, target_org_unit_id, business_date, period_key, available_at, due_at, status)
VALUES
('2a500000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001',
 '2a200000-0000-0000-0000-000000000001', '2a300000-0000-0000-0000-000000000001',
 '19200000-0000-0000-0000-000000000002', '2a400000-0000-0000-0000-000000000001',
 '12000000-0000-0000-0000-000000000005', current_date, 'UAT-FRONT-' || current_date,
 now() - interval '1 hour', now() + interval '8 hours', 'AVAILABLE'),
('2a500000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001',
 '2a200000-0000-0000-0000-000000000002', '2a300000-0000-0000-0000-000000000002',
 '19200000-0000-0000-0000-000000000007', NULL,
 '12000000-0000-0000-0000-000000000003', current_date, 'UAT-OTA-HZ-' || current_date,
 now() - interval '1 hour', now() + interval '8 hours', 'AVAILABLE'),
('2a500000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000001',
 '2a200000-0000-0000-0000-000000000002', '2a300000-0000-0000-0000-000000000003',
 '19200000-0000-0000-0000-000000000007', NULL,
 '12000000-0000-0000-0000-000000000004', current_date, 'UAT-OTA-SH-' || current_date,
 now() - interval '1 hour', now() + interval '8 hours', 'AVAILABLE'),
('2a500000-0000-0000-0000-000000000004', '10000000-0000-0000-0000-000000000001',
 '2a200000-0000-0000-0000-000000000003', '2a300000-0000-0000-0000-000000000004',
 '19200000-0000-0000-0000-000000000003', NULL,
 '12000000-0000-0000-0000-000000000006', current_date, 'UAT-HK-CURRENT-' || current_date,
 now() - interval '1 hour', now() + interval '8 hours', 'AVAILABLE'),
('2a500000-0000-0000-0000-000000000005', '10000000-0000-0000-0000-000000000001',
 '2a200000-0000-0000-0000-000000000003', '2a300000-0000-0000-0000-000000000004',
 '19200000-0000-0000-0000-000000000003', NULL,
 '12000000-0000-0000-0000-000000000006', current_date - 1, 'UAT-HK-MISSED-' || (current_date - 1),
 now() - interval '1 day', now() - interval '5 minutes', 'AVAILABLE')
ON CONFLICT (tenant_id, id) DO NOTHING;

-- A submitted housekeeping inspection is the stable subject for scenario A image upload and hygiene evaluation.
INSERT INTO work_record
    (id, tenant_id, org_unit_id, employee_id, position_assignment_id, form_version_id,
     business_date, status, payload, submitted_at, work_package_version_id,
     work_package_item_id, work_expectation_id, record_kind, target_org_unit_id,
     occurred_at, submitted_by_account_id, attempt_no, content_hash)
VALUES
('2e000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001',
 '12000000-0000-0000-0000-000000000006', '19100000-0000-0000-0000-000000000003',
 '19200000-0000-0000-0000-000000000003', '29700000-0000-0000-0000-000000000003',
 current_date, 'SUBMITTED', '{"roomsChecked":32,"photoAttached":true,"issueClosed":false,"summary":"卫生问题待整改"}',
 now(), '2a100000-0000-0000-0000-000000000003', '2a200000-0000-0000-0000-000000000003',
 '2a500000-0000-0000-0000-000000000004', 'INSPECTION', '12000000-0000-0000-0000-000000000006',
 now(), '19000000-0000-0000-0000-000000000004', 1, repeat('f', 64))
ON CONFLICT (tenant_id, id) DO NOTHING;

UPDATE work_expectation
SET status = 'SUBMITTED', row_version = row_version + 1, updated_at = now()
WHERE tenant_id = '10000000-0000-0000-0000-000000000001'
  AND id = '2a500000-0000-0000-0000-000000000004'
  AND status = 'AVAILABLE';

-- Deterministic enterprise rules. Insert scope while the version is still DRAFT.
INSERT INTO rule_definition
    (id, tenant_id, code, name, event_type, owner_org_unit_id, description, created_by)
VALUES
('2b000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001',
 'RULE-UAT-OTA-RISK', 'OTA评分风险整改规则（UAT）', 'OTA_SCORE_RISK',
 '12000000-0000-0000-0000-000000000002', '评分低于4.9时创建整改任务。',
 '19000000-0000-0000-0000-000000000001'),
('2b000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001',
 'RULE-UAT-WORK-SUBMITTED', '工作记录提交提醒规则（UAT）', 'WORKRECORDSUBMITTED',
 '12000000-0000-0000-0000-000000000001', '真实工作记录提交后产生站内提醒。',
 '19000000-0000-0000-0000-000000000001'),
('2b000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000001',
 'RULE-UAT-FRONT-COMPLAINT', '前台客诉整改规则（UAT）', 'STANDARDEVALUATIONCOMPLETED',
 '12000000-0000-0000-0000-000000000003', '前台客诉标准评价为FAIL后创建整改任务。',
 '19000000-0000-0000-0000-000000000001'),
('2b000000-0000-0000-0000-000000000004', '10000000-0000-0000-0000-000000000001',
 'RULE-UAT-MISSED-WORK', '岗位漏交提醒与整改规则（UAT）', 'WORKEXPECTATIONMISSED',
 '12000000-0000-0000-0000-000000000003', '工作期望漏交后提醒责任人并创建立即到期的整改任务。',
 '19000000-0000-0000-0000-000000000001'),
('2b000000-0000-0000-0000-000000000005', '10000000-0000-0000-0000-000000000001',
 'RULE-UAT-HK-HYGIENE-FAIL', '客房卫生评价失败整改规则（UAT）', 'STANDARDEVALUATIONCOMPLETED',
 '12000000-0000-0000-0000-000000000003', '客房卫生标准评价为FAIL后创建由客房主管整改、店总验收的任务。',
 '19000000-0000-0000-0000-000000000001')
ON CONFLICT (tenant_id, id) DO NOTHING;

INSERT INTO rule_version
    (id, tenant_id, rule_id, version_no, lifecycle_status, condition_ast, actions,
     priority, cooldown_minutes, content_hash, created_by)
VALUES
('2b100000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001',
 '2b000000-0000-0000-0000-000000000001', 1, 'DRAFT',
 '{"op":"LT","fact":"score","value":4.9}',
 '[{"key":"create-ota-remediation","type":"CREATE_TASK","assigneeResolver":"CURRENT_ASSIGNMENT","reviewerResolver":"DIRECT_MANAGER_ASSIGNMENT","standardVersionId":"27000000-0000-0000-0000-000000000001","title":"区域多门店OTA评分风险整改（UAT）","description":"请完成页面、点评和评分整改，并提交证据。","priority":"HIGH","dueMinutes":0}]',
 10, 0, repeat('c', 64), '19000000-0000-0000-0000-000000000001'),
('2b100000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001',
 '2b000000-0000-0000-0000-000000000002', 1, 'DRAFT',
 '{"op":"EXISTS","fact":"workRecordId"}',
 '[{"key":"notify-submitter","type":"CREATE_NOTIFICATION","recipientResolver":"CURRENT_ASSIGNMENT","notificationType":"WORK_SUBMITTED","title":"工作记录已进入闭环","content":"记录已提交，后续评价和任务可追溯。"}]',
 20, 0, repeat('d', 64), '19000000-0000-0000-0000-000000000001'),
('2b100000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000001',
 '2b000000-0000-0000-0000-000000000003', 1, 'DRAFT',
 '{"op":"ALL","children":[{"op":"EQ","fact":"subjectType","value":"WORK_RECORD"},{"op":"EQ","fact":"outcome","value":"FAIL"},{"op":"EQ","fact":"standardVersionId","value":"27000000-0000-0000-0000-000000000002"}]}',
 '[{"key":"create-front-complaint-remediation","type":"CREATE_TASK","assigneeResolver":"CURRENT_ASSIGNMENT","reviewerResolver":"DIRECT_MANAGER_ASSIGNMENT","standardVersionId":"27000000-0000-0000-0000-000000000002","title":"前台客诉跟进整改（UAT）","description":"完成客人回访、处理说明和闭环证据。","priority":"HIGH","dueMinutes":120}]',
 5, 0, repeat('1', 64), '19000000-0000-0000-0000-000000000001'),
('2b100000-0000-0000-0000-000000000004', '10000000-0000-0000-0000-000000000001',
 '2b000000-0000-0000-0000-000000000004', 1, 'DRAFT',
 '{"op":"EXISTS","fact":"workExpectationId"}',
 '[{"key":"notify-missed-owner","type":"CREATE_NOTIFICATION","recipientResolver":"CURRENT_ASSIGNMENT","notificationType":"MISSED_WORK_REMINDER","title":"岗位工作已漏交","content":"请立即补交并完成整改。"},{"key":"create-missed-remediation","type":"CREATE_TASK","assigneeResolver":"CURRENT_ASSIGNMENT","reviewerResolver":"DIRECT_MANAGER_ASSIGNMENT","standardVersionId":"27000000-0000-0000-0000-000000000003","title":"岗位漏交整改（UAT）","description":"补齐漏交记录并提交整改证据。","priority":"URGENT","dueMinutes":0}]',
 1, 0, repeat('2', 64), '19000000-0000-0000-0000-000000000001'),
('2b100000-0000-0000-0000-000000000005', '10000000-0000-0000-0000-000000000001',
 '2b000000-0000-0000-0000-000000000005', 1, 'DRAFT',
 '{"op":"ALL","children":[{"op":"EQ","fact":"subjectType","value":"WORK_RECORD"},{"op":"EQ","fact":"outcome","value":"FAIL"},{"op":"EQ","fact":"standardVersionId","value":"27000000-0000-0000-0000-000000000003"}]}',
 '[{"key":"create-hk-hygiene-remediation","type":"CREATE_TASK","assigneeResolver":"CURRENT_ASSIGNMENT","reviewerResolver":"POSITION_IN_ANCESTOR_ORG","positionId":"14000000-0000-0000-0000-000000000004","standardVersionId":"27000000-0000-0000-0000-000000000003","title":"客房卫生图片整改（UAT）","description":"根据失败的卫生标准评价完成整改并由店总验收。","priority":"HIGH","dueMinutes":120}]',
 2, 0, repeat('3', 64), '19000000-0000-0000-0000-000000000001')
ON CONFLICT (tenant_id, id) DO NOTHING;

INSERT INTO rule_scope (id, tenant_id, rule_version_id, scope_type, org_unit_id)
SELECT * FROM (VALUES
('2b200000-0000-0000-0000-000000000001'::uuid, '10000000-0000-0000-0000-000000000001'::uuid,
 '2b100000-0000-0000-0000-000000000001'::uuid, 'ORG_TREE'::varchar, '12000000-0000-0000-0000-000000000002'::uuid),
('2b200000-0000-0000-0000-000000000002'::uuid, '10000000-0000-0000-0000-000000000001'::uuid,
 '2b100000-0000-0000-0000-000000000002'::uuid, 'ORG_TREE'::varchar, '12000000-0000-0000-0000-000000000001'::uuid),
('2b200000-0000-0000-0000-000000000003'::uuid, '10000000-0000-0000-0000-000000000001'::uuid,
 '2b100000-0000-0000-0000-000000000003'::uuid, 'ORG_TREE'::varchar, '12000000-0000-0000-0000-000000000003'::uuid),
('2b200000-0000-0000-0000-000000000004'::uuid, '10000000-0000-0000-0000-000000000001'::uuid,
 '2b100000-0000-0000-0000-000000000004'::uuid, 'ORG_TREE'::varchar, '12000000-0000-0000-0000-000000000003'::uuid),
('2b200000-0000-0000-0000-000000000005'::uuid, '10000000-0000-0000-0000-000000000001'::uuid,
 '2b100000-0000-0000-0000-000000000005'::uuid, 'ORG_TREE'::varchar, '12000000-0000-0000-0000-000000000003'::uuid)
) AS fixture(id, tenant_id, rule_version_id, scope_type, org_unit_id)
WHERE NOT EXISTS (SELECT 1 FROM rule_scope scope WHERE scope.tenant_id = fixture.tenant_id AND scope.id = fixture.id);

UPDATE rule_version
SET lifecycle_status = 'PUBLISHED', effective_from = now() - interval '1 day',
    published_by = '19000000-0000-0000-0000-000000000001', published_at = now(), row_version = row_version + 1
WHERE tenant_id = '10000000-0000-0000-0000-000000000001'
  AND id IN ('2b100000-0000-0000-0000-000000000001', '2b100000-0000-0000-0000-000000000002',
             '2b100000-0000-0000-0000-000000000003', '2b100000-0000-0000-0000-000000000004',
             '2b100000-0000-0000-0000-000000000005')
  AND lifecycle_status = 'DRAFT';

-- A pending event lets the real API smoke script create, escalate and complete one regional-operations remediation task.
INSERT INTO outbox_event
    (id, tenant_id, aggregate_type, aggregate_id, event_type, payload, schema_version, status, available_at)
VALUES
('2c000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001',
 'UAT_OTA_SCORE', '2c000000-0000-0000-0000-000000000002', 'OTA_SCORE_RISK',
 '{"score":4.8,"hotelOrgUnitId":"12000000-0000-0000-0000-000000000003","standardVersionId":"27000000-0000-0000-0000-000000000001","source":"UAT_FIXTURE"}',
 1, 'PENDING', now())
ON CONFLICT (tenant_id, id) DO NOTHING;

INSERT INTO management_event
    (id, tenant_id, source_event_id, event_type, schema_version, org_unit_id,
     position_assignment_id, occurred_at, payload_snapshot, processing_status)
VALUES
('2c100000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001',
 '2c000000-0000-0000-0000-000000000001', 'OTA_SCORE_RISK', 1,
 '12000000-0000-0000-0000-000000000003', '19200000-0000-0000-0000-000000000007',
 now(), '{"score":4.8,"hotelOrgUnitId":"12000000-0000-0000-0000-000000000003","standardVersionId":"27000000-0000-0000-0000-000000000001","source":"UAT_FIXTURE"}',
 'PENDING')
ON CONFLICT (tenant_id, id) DO NOTHING;

-- One unread notice per role makes notification and unread-count UAT deterministic.
INSERT INTO notification
    (id, tenant_id, recipient_account_id, recipient_assignment_id, notification_type,
     title, content, source_type, source_id, idempotency_key)
VALUES
('2d000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','19000000-0000-0000-0000-000000000007','19200000-0000-0000-0000-000000000007','UAT_READY','区域运营UAT待办','请完成杭州和上海两店巡检。','UAT',NULL,'uat-ready-regional-operations'),
('2d000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001','19000000-0000-0000-0000-000000000004','19200000-0000-0000-0000-000000000003','UAT_READY','客房主管UAT待办','请完成客房巡检并上传现场图片。','UAT',NULL,'uat-ready-housekeeping-supervisor'),
('2d000000-0000-0000-0000-000000000003','10000000-0000-0000-0000-000000000001','19000000-0000-0000-0000-000000000003','19200000-0000-0000-0000-000000000002','UAT_READY','前台UAT待办','请提交本班次客诉记录。','UAT',NULL,'uat-ready-front-desk'),
('2d000000-0000-0000-0000-000000000004','10000000-0000-0000-0000-000000000001','19000000-0000-0000-0000-000000000005','19200000-0000-0000-0000-000000000004','UAT_READY','前厅主管UAT待办','请检查团队工作并验收。','UAT',NULL,'uat-ready-front-supervisor'),
('2d000000-0000-0000-0000-000000000005','10000000-0000-0000-0000-000000000001','19000000-0000-0000-0000-000000000008','19200000-0000-0000-0000-000000000008','UAT_READY','店助UAT待办','请检查本店跨部门任务。','UAT',NULL,'uat-ready-assistant-gm'),
('2d000000-0000-0000-0000-000000000006','10000000-0000-0000-0000-000000000001','19000000-0000-0000-0000-000000000002','19200000-0000-0000-0000-000000000001','UAT_READY','店总UAT待办','请完成最终验收检查。','UAT',NULL,'uat-ready-general-manager')
ON CONFLICT (tenant_id, id) DO NOTHING;

-- Minimal second tenant is an isolation control. It is not part of the six-role scenario.
SELECT set_config('app.tenant_id', '30000000-0000-0000-0000-000000000001', true);

INSERT INTO tenant (id, code, name)
VALUES ('30000000-0000-0000-0000-000000000001', 'UAT-ISOLATION', '隔离对照集团（UAT）')
ON CONFLICT (id) DO NOTHING;

INSERT INTO org_unit (id, tenant_id, parent_id, code, name, unit_type, sort_order) VALUES
('32000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001',NULL,'UAT-B-GROUP','隔离对照集团','GROUP',1),
('32000000-0000-0000-0000-000000000002','30000000-0000-0000-0000-000000000001','32000000-0000-0000-0000-000000000001','UAT-B-REGION','隔离对照区域','REGION',1),
('32000000-0000-0000-0000-000000000003','30000000-0000-0000-0000-000000000001','32000000-0000-0000-0000-000000000002','UAT-B-HOTEL','隔离对照门店','HOTEL',1)
ON CONFLICT (tenant_id, id) DO NOTHING;

INSERT INTO org_unit_closure (tenant_id, ancestor_id, descendant_id, depth) VALUES
('30000000-0000-0000-0000-000000000001','32000000-0000-0000-0000-000000000001','32000000-0000-0000-0000-000000000001',0),
('30000000-0000-0000-0000-000000000001','32000000-0000-0000-0000-000000000002','32000000-0000-0000-0000-000000000002',0),
('30000000-0000-0000-0000-000000000001','32000000-0000-0000-0000-000000000003','32000000-0000-0000-0000-000000000003',0),
('30000000-0000-0000-0000-000000000001','32000000-0000-0000-0000-000000000001','32000000-0000-0000-0000-000000000002',1),
('30000000-0000-0000-0000-000000000001','32000000-0000-0000-0000-000000000001','32000000-0000-0000-0000-000000000003',2),
('30000000-0000-0000-0000-000000000001','32000000-0000-0000-0000-000000000002','32000000-0000-0000-0000-000000000003',1)
ON CONFLICT DO NOTHING;

INSERT INTO hotel_profile (id, tenant_id, org_unit_id, property_code, city, room_count)
VALUES ('33000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001',
        '32000000-0000-0000-0000-000000000003','UAT-B-001','隔离市',20)
ON CONFLICT (tenant_id, id) DO NOTHING;

INSERT INTO user_account (id, tenant_id, login_name, display_name)
VALUES ('39000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001',
        'isolation.probe','隔离探针账号')
ON CONFLICT (tenant_id, id) DO NOTHING;

SELECT set_config('app.tenant_id', '10000000-0000-0000-0000-000000000001', true);

COMMIT;
