-- TECH-V0.2-PILOT.7 task delivery permissions.
-- TaskTargetPolicy still enforces the target range without broadening access
-- to organization, work-record, dashboard, or other modules.

SELECT set_config('app.tenant_id', '10000000-0000-0000-0000-000000000001', false);

INSERT INTO role_permission (tenant_id, role_id, permission_id)
SELECT '10000000-0000-0000-0000-000000000001', role.id, permission.id
FROM app_role role
JOIN permission ON permission.code IN (
    'task.create', 'task.dispatch', 'task.review', 'task.cancel',
    'evaluation.manual-review', 'template.read'
)
WHERE role.tenant_id = '10000000-0000-0000-0000-000000000001'
  AND role.code = 'OTA_OPERATION_ASSISTANT'
ON CONFLICT DO NOTHING;

