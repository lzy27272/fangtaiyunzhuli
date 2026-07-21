-- Sprint 2.1: the regional operations role can read the multi-hotel dashboard,
-- while row-level organization scopes continue to constrain which hotels appear.
SELECT set_config('app.tenant_id', '10000000-0000-0000-0000-000000000001', false);

INSERT INTO role_permission (tenant_id, role_id, permission_id)
SELECT r.tenant_id, r.id, p.id
FROM app_role r
JOIN permission p ON p.code = 'dashboard.hotel'
WHERE r.tenant_id = '10000000-0000-0000-0000-000000000001'
  AND r.code = 'OTA_OPERATION_MANAGER'
ON CONFLICT DO NOTHING;
