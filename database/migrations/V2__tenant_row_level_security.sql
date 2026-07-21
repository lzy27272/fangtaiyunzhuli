-- Runtime connections must call:
--   SELECT set_config('app.tenant_id', '<tenant uuid>', true);
-- inside each transaction. Runtime roles must not own tables or hold BYPASSRLS.

DO $$
DECLARE
    table_name TEXT;
BEGIN
    FOREACH table_name IN ARRAY ARRAY[
        'brand', 'org_unit', 'org_unit_closure', 'hotel_profile', 'user_account',
        'employee', 'position_definition', 'employee_position_assignment', 'app_role',
        'role_permission', 'role_assignment', 'standard_category', 'standard_definition',
        'standard_version', 'standard_scope', 'form_definition', 'form_version',
        'work_record', 'attachment', 'metric_definition', 'metric_observation',
        'audit_log', 'outbox_event'
    ] LOOP
        EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', table_name);
        EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', table_name);
        EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', table_name);
        EXECUTE format(
            'CREATE POLICY tenant_isolation ON %I USING (tenant_id = nullif(current_setting(''app.tenant_id'', true), '''')::uuid) WITH CHECK (tenant_id = nullif(current_setting(''app.tenant_id'', true), '''')::uuid)',
            table_name
        );
    END LOOP;
END $$;

ALTER TABLE tenant ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_self ON tenant
    USING (id = nullif(current_setting('app.tenant_id', true), '')::uuid)
    WITH CHECK (id = nullif(current_setting('app.tenant_id', true), '')::uuid);

