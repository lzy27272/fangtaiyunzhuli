-- Sprint 2 effective RBAC permissions and six-role UAT seed.
-- Business assumptions for the demo tenant only:
--   * OTA operations is a regional shared function.
--   * Assistant general manager is scoped to one hotel.

SELECT set_config('app.tenant_id', '10000000-0000-0000-0000-000000000001', false);

INSERT INTO permission (code, resource, action, description) VALUES
    ('iam.manage', 'iam', 'manage', '管理角色、权限与临时授权'),
    ('work-package.read', 'work_package', 'read', '查看授权范围工作包'),
    ('work-package.manage', 'work_package', 'manage', '管理工作包草稿'),
    ('work-package.publish', 'work_package', 'publish', '发布或退役工作包版本'),
    ('work-package.allocate', 'work_package', 'allocate', '向有效任职分配工作包'),
    ('work-record.read', 'work_record', 'read', '查看授权范围工作记录'),
    ('work-record.submit', 'work_record', 'submit', '按本人有效任职提交工作记录'),
    ('work-record.review', 'work_record', 'review', '复核授权范围工作记录'),
    ('work-record.submit-for-other', 'work_record', 'submit-for-other', '经授权代提交工作记录')
ON CONFLICT (code) DO NOTHING;

INSERT INTO position_definition
    (id, tenant_id, code, name, job_family, level_code) VALUES
    ('14000000-0000-0000-0000-000000000005', '10000000-0000-0000-0000-000000000001',
     'OTA_OPERATION_ASSISTANT', 'OTA运营助理', 'OTA_OPERATION', 'P1'),
    ('14000000-0000-0000-0000-000000000006', '10000000-0000-0000-0000-000000000001',
     'OTA_OPERATION_MANAGER', 'OTA运营经理', 'OTA_OPERATION', 'M2'),
    ('14000000-0000-0000-0000-000000000007', '10000000-0000-0000-0000-000000000001',
     'ASSISTANT_GENERAL_MANAGER', '店助', 'HOTEL_MANAGEMENT', 'M2')
ON CONFLICT (tenant_id, code) DO NOTHING;

INSERT INTO user_account
    (id, tenant_id, login_name, display_name, mobile) VALUES
    ('19000000-0000-0000-0000-000000000006', '10000000-0000-0000-0000-000000000001',
     'ota.assistant', 'OTA运营助理唐悦', '13800000006'),
    ('19000000-0000-0000-0000-000000000007', '10000000-0000-0000-0000-000000000001',
     'ota.manager', 'OTA运营经理许晨', '13800000007'),
    ('19000000-0000-0000-0000-000000000008', '10000000-0000-0000-0000-000000000001',
     'assistant.gm', '杭州中心店店助沈乔', '13800000008'),
    ('19000000-0000-0000-0000-000000000009', '10000000-0000-0000-0000-000000000001',
     'system.automation', '管理闭环自动化服务', NULL)
ON CONFLICT (tenant_id, login_name) DO NOTHING;

INSERT INTO employee
    (id, tenant_id, account_id, employee_no, name, mobile, hired_on) VALUES
    ('19100000-0000-0000-0000-000000000005', '10000000-0000-0000-0000-000000000001',
     '19000000-0000-0000-0000-000000000006', 'E-OTA-001', '唐悦', '13800000006', '2025-06-01'),
    ('19100000-0000-0000-0000-000000000006', '10000000-0000-0000-0000-000000000001',
     '19000000-0000-0000-0000-000000000007', 'E-OTA-M-001', '许晨', '13800000007', '2023-08-15'),
    ('19100000-0000-0000-0000-000000000007', '10000000-0000-0000-0000-000000000001',
     '19000000-0000-0000-0000-000000000008', 'E-AGM-001', '沈乔', '13800000008', '2023-11-20')
ON CONFLICT (tenant_id, employee_no) DO NOTHING;

INSERT INTO employee_position_assignment
    (id, tenant_id, employee_id, org_unit_id, position_id, is_primary, valid_from) VALUES
    ('19200000-0000-0000-0000-000000000006', '10000000-0000-0000-0000-000000000001',
     '19100000-0000-0000-0000-000000000005', '12000000-0000-0000-0000-000000000002',
     '14000000-0000-0000-0000-000000000005', true, '2025-06-01'),
    ('19200000-0000-0000-0000-000000000007', '10000000-0000-0000-0000-000000000001',
     '19100000-0000-0000-0000-000000000006', '12000000-0000-0000-0000-000000000002',
     '14000000-0000-0000-0000-000000000006', true, '2023-08-15'),
    ('19200000-0000-0000-0000-000000000008', '10000000-0000-0000-0000-000000000001',
     '19100000-0000-0000-0000-000000000007', '12000000-0000-0000-0000-000000000003',
     '14000000-0000-0000-0000-000000000007', true, '2023-11-20')
ON CONFLICT (tenant_id, id) DO NOTHING;

INSERT INTO app_role (id, tenant_id, code, name, role_type) VALUES
    ('19400000-0000-0000-0000-000000000006', '10000000-0000-0000-0000-000000000001',
     'OTA_OPERATION_ASSISTANT', 'OTA运营助理', 'SYSTEM'),
    ('19400000-0000-0000-0000-000000000007', '10000000-0000-0000-0000-000000000001',
     'OTA_OPERATION_MANAGER', 'OTA运营经理', 'SYSTEM'),
    ('19400000-0000-0000-0000-000000000008', '10000000-0000-0000-0000-000000000001',
     'ASSISTANT_GENERAL_MANAGER', '店助', 'SYSTEM')
ON CONFLICT (tenant_id, code) DO NOTHING;

INSERT INTO role_assignment
    (id, tenant_id, account_id, role_id, scope_org_unit_id, scope_type, granted_by) VALUES
    ('19500000-0000-0000-0000-000000000006', '10000000-0000-0000-0000-000000000001',
     '19000000-0000-0000-0000-000000000006', '19400000-0000-0000-0000-000000000006',
     '12000000-0000-0000-0000-000000000002', 'ORG_TREE', '19000000-0000-0000-0000-000000000001'),
    ('19500000-0000-0000-0000-000000000007', '10000000-0000-0000-0000-000000000001',
     '19000000-0000-0000-0000-000000000007', '19400000-0000-0000-0000-000000000007',
     '12000000-0000-0000-0000-000000000002', 'ORG_TREE', '19000000-0000-0000-0000-000000000001'),
    ('19500000-0000-0000-0000-000000000008', '10000000-0000-0000-0000-000000000001',
     '19000000-0000-0000-0000-000000000008', '19400000-0000-0000-0000-000000000008',
     '12000000-0000-0000-0000-000000000003', 'ORG_TREE', '19000000-0000-0000-0000-000000000001')
ON CONFLICT (tenant_id, id) DO NOTHING;

-- CEO receives every current and future Sprint 2 permission present at migration time.
INSERT INTO role_permission (tenant_id, role_id, permission_id)
SELECT '10000000-0000-0000-0000-000000000001',
       '19400000-0000-0000-0000-000000000001', p.id
FROM permission p
ON CONFLICT DO NOTHING;

-- Individual contributors: own work, own tasks, evaluations and notifications.
INSERT INTO role_permission (tenant_id, role_id, permission_id)
SELECT '10000000-0000-0000-0000-000000000001', r.id, p.id
FROM app_role r
JOIN permission p ON p.code IN (
    'org.read', 'standard.read', 'work-package.read', 'work-record.read',
    'work-record.submit', 'work.submit', 'task.read', 'task.act',
    'evaluation.read', 'notification.read'
)
WHERE r.tenant_id = '10000000-0000-0000-0000-000000000001'
  AND r.code IN ('FRONT_DESK', 'OTA_OPERATION_ASSISTANT')
ON CONFLICT DO NOTHING;

-- Operational supervisors and assistant GM: team review, task dispatch and acceptance.
INSERT INTO role_permission (tenant_id, role_id, permission_id)
SELECT '10000000-0000-0000-0000-000000000001', r.id, p.id
FROM app_role r
JOIN permission p ON p.code IN (
    'org.read', 'standard.read', 'work-package.read', 'work-package.allocate',
    'work-record.read', 'work-record.submit', 'work-record.review',
    'task.read', 'task.create', 'task.dispatch', 'task.act', 'task.review', 'task.cancel',
    'evaluation.read', 'evaluation.manual-review', 'notification.read', 'dashboard.hotel'
)
WHERE r.tenant_id = '10000000-0000-0000-0000-000000000001'
  AND r.code IN (
      'HOUSEKEEPING_SUPERVISOR', 'FRONT_OFFICE_SUPERVISOR',
      'ASSISTANT_GENERAL_MANAGER', 'GENERAL_MANAGER'
  )
ON CONFLICT DO NOTHING;

-- OTA manager additionally has explainable rule simulation over the authorized region.
INSERT INTO role_permission (tenant_id, role_id, permission_id)
SELECT '10000000-0000-0000-0000-000000000001', r.id, p.id
FROM app_role r
JOIN permission p ON p.code IN (
    'org.read', 'standard.read', 'work-package.read', 'work-package.allocate',
    'work-record.read', 'work-record.submit', 'work-record.review',
    'rule.read', 'rule.simulate',
    'task.read', 'task.create', 'task.dispatch', 'task.act', 'task.review', 'task.cancel',
    'evaluation.read', 'evaluation.manual-review', 'notification.read'
)
WHERE r.tenant_id = '10000000-0000-0000-0000-000000000001'
  AND r.code = 'OTA_OPERATION_MANAGER'
ON CONFLICT DO NOTHING;
