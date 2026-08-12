-- OTA inspection evidence, server-side signatures, objective SLA events and KPI automation runs.

CREATE TABLE kpi_inspection_schedule (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenant(id),
    time_slot VARCHAR(24) NOT NULL CHECK (time_slot IN ('MORNING', 'AFTERNOON', 'BEFORE_SLEEP')),
    opens_at TIME NOT NULL,
    cutoff_at TIME NOT NULL,
    required_checks JSONB NOT NULL DEFAULT '[]'::jsonb,
    active BOOLEAN NOT NULL DEFAULT true,
    row_version BIGINT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, id),
    UNIQUE (tenant_id, time_slot),
    CHECK (cutoff_at > opens_at)
);

CREATE TABLE kpi_inspection_submission (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenant(id),
    employee_id UUID NOT NULL,
    assignment_id UUID NOT NULL,
    org_unit_id UUID NOT NULL,
    business_date DATE NOT NULL,
    time_slot VARCHAR(24) NOT NULL CHECK (time_slot IN ('MORNING', 'AFTERNOON', 'BEFORE_SLEEP')),
    channel_code VARCHAR(80) NOT NULL,
    result VARCHAR(32) NOT NULL CHECK (result IN ('NORMAL', 'ABNORMAL', 'PENDING_VERIFICATION')),
    check_items JSONB NOT NULL,
    abnormality_level VARCHAR(24) CHECK (abnormality_level IN ('ORDINARY', 'MAJOR')),
    abnormality_description TEXT,
    first_action TEXT,
    idempotency_key VARCHAR(160) NOT NULL,
    supersedes_submission_id UUID,
    correction_reason TEXT,
    signed_by UUID NOT NULL,
    signed_name VARCHAR(120) NOT NULL,
    signed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    content_hash CHAR(64) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, id),
    UNIQUE (tenant_id, idempotency_key),
    CHECK (jsonb_typeof(check_items) = 'array'),
    CHECK ((result = 'ABNORMAL' AND abnormality_level IS NOT NULL AND abnormality_description IS NOT NULL AND first_action IS NOT NULL)
        OR result <> 'ABNORMAL'),
    CHECK ((supersedes_submission_id IS NULL AND correction_reason IS NULL)
        OR (supersedes_submission_id IS NOT NULL AND correction_reason IS NOT NULL)),
    FOREIGN KEY (tenant_id, employee_id) REFERENCES employee (tenant_id, id),
    FOREIGN KEY (tenant_id, assignment_id) REFERENCES employee_position_assignment (tenant_id, id),
    FOREIGN KEY (tenant_id, org_unit_id) REFERENCES org_unit (tenant_id, id),
    FOREIGN KEY (tenant_id, supersedes_submission_id) REFERENCES kpi_inspection_submission (tenant_id, id),
    FOREIGN KEY (tenant_id, signed_by) REFERENCES user_account (tenant_id, id)
);

CREATE TABLE kpi_inspection_abnormality_event (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenant(id),
    submission_id UUID NOT NULL,
    event_type VARCHAR(32) NOT NULL CHECK (event_type IN ('CONFIRMED', 'ACTION_SUBMITTED', 'CLOSED', 'ESCALATED')),
    note TEXT NOT NULL,
    evidence_reference TEXT,
    actor_id UUID NOT NULL,
    occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    content_hash CHAR(64) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, id),
    UNIQUE (tenant_id, submission_id, event_type),
    FOREIGN KEY (tenant_id, submission_id) REFERENCES kpi_inspection_submission (tenant_id, id),
    FOREIGN KEY (tenant_id, actor_id) REFERENCES user_account (tenant_id, id)
);

CREATE TABLE kpi_inspection_verification (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenant(id),
    submission_id UUID NOT NULL,
    decision VARCHAR(24) NOT NULL CHECK (decision IN ('MATCHED', 'MISMATCH', 'PENDING')),
    finding TEXT NOT NULL,
    evidence_reference TEXT,
    verified_by UUID NOT NULL,
    verified_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    content_hash CHAR(64) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, id),
    FOREIGN KEY (tenant_id, submission_id) REFERENCES kpi_inspection_submission (tenant_id, id),
    FOREIGN KEY (tenant_id, verified_by) REFERENCES user_account (tenant_id, id)
);

CREATE TABLE kpi_inspection_sla_breach (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenant(id),
    submission_id UUID,
    employee_id UUID NOT NULL,
    assignment_id UUID NOT NULL,
    org_unit_id UUID NOT NULL,
    business_date DATE NOT NULL,
    time_slot VARCHAR(24) NOT NULL CHECK (time_slot IN ('MORNING', 'AFTERNOON', 'BEFORE_SLEEP')),
    channel_code VARCHAR(80) NOT NULL,
    breach_type VARCHAR(40) NOT NULL CHECK (breach_type IN (
        'MISSING_INSPECTION', 'CONFIRMATION_LATE', 'ACTION_LATE', 'CLOSE_OR_ESCALATION_LATE', 'FALSE_NORMAL'
    )),
    deduction_units NUMERIC(10,2) NOT NULL DEFAULT 1 CHECK (deduction_units > 0),
    detected_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    source_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, id),
    UNIQUE (tenant_id, assignment_id, org_unit_id, business_date, time_slot, channel_code, breach_type),
    FOREIGN KEY (tenant_id, submission_id) REFERENCES kpi_inspection_submission (tenant_id, id),
    FOREIGN KEY (tenant_id, employee_id) REFERENCES employee (tenant_id, id),
    FOREIGN KEY (tenant_id, assignment_id) REFERENCES employee_position_assignment (tenant_id, id),
    FOREIGN KEY (tenant_id, org_unit_id) REFERENCES org_unit (tenant_id, id)
);

CREATE TABLE kpi_automation_run (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenant(id),
    run_key VARCHAR(160) NOT NULL,
    job_type VARCHAR(40) NOT NULL CHECK (job_type IN ('WEEK_SCORECARD', 'MONTH_SCORECARD', 'INSPECTION_SLA', 'REMINDER')),
    status VARCHAR(24) NOT NULL DEFAULT 'RUNNING' CHECK (status IN ('RUNNING', 'SUCCEEDED', 'FAILED')),
    payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    result JSONB NOT NULL DEFAULT '{}'::jsonb,
    correlation_id UUID NOT NULL,
    started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    finished_at TIMESTAMPTZ,
    error_message TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, id),
    UNIQUE (tenant_id, run_key)
);

CREATE INDEX idx_kpi_inspection_scope_date ON kpi_inspection_submission (tenant_id, org_unit_id, business_date DESC, time_slot);
CREATE INDEX idx_kpi_inspection_employee_date ON kpi_inspection_submission (tenant_id, employee_id, business_date DESC);
CREATE INDEX idx_kpi_inspection_abnormality_event ON kpi_inspection_abnormality_event (tenant_id, submission_id, occurred_at);

CREATE TRIGGER trg_kpi_inspection_schedule_updated_at BEFORE UPDATE ON kpi_inspection_schedule
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_kpi_inspection_submission_append_only BEFORE UPDATE OR DELETE ON kpi_inspection_submission
    FOR EACH ROW EXECUTE FUNCTION prevent_kpi_append_only_mutation();
CREATE TRIGGER trg_kpi_inspection_event_append_only BEFORE UPDATE OR DELETE ON kpi_inspection_abnormality_event
    FOR EACH ROW EXECUTE FUNCTION prevent_kpi_append_only_mutation();
CREATE TRIGGER trg_kpi_inspection_verification_append_only BEFORE UPDATE OR DELETE ON kpi_inspection_verification
    FOR EACH ROW EXECUTE FUNCTION prevent_kpi_append_only_mutation();
CREATE TRIGGER trg_kpi_inspection_breach_append_only BEFORE UPDATE OR DELETE ON kpi_inspection_sla_breach
    FOR EACH ROW EXECUTE FUNCTION prevent_kpi_append_only_mutation();

INSERT INTO permission (code, resource, action, description) VALUES
    ('kpi.inspection.submit', 'kpi_inspection', 'submit', '提交本人OTA巡检及异常处理事件'),
    ('kpi.inspection.read-team', 'kpi_inspection', 'read-team', '查看授权范围OTA巡检留痕'),
    ('kpi.inspection.verify', 'kpi_inspection', 'verify', '抽查核验OTA巡检结果'),
    ('kpi.inspection.manage', 'kpi_inspection', 'manage', '配置巡检时段和必查项')
ON CONFLICT (code) DO NOTHING;

DO $$
DECLARE
    tenant_record RECORD;
BEGIN
    FOR tenant_record IN SELECT id FROM tenant LOOP
        PERFORM set_config('app.tenant_id', tenant_record.id::text, true);

        INSERT INTO kpi_inspection_schedule (tenant_id, time_slot, opens_at, cutoff_at, required_checks)
        VALUES
            (tenant_record.id, 'MORNING', '06:00', '12:00', '["CHANNEL_VIOLATION","TRAFFIC_REDUCTION","TRAFFIC","CONVERSION","PRICE","INVENTORY"]'::jsonb),
            (tenant_record.id, 'AFTERNOON', '12:00', '18:00', '["TRAFFIC","CONVERSION","PRICE","INVENTORY","CHANNEL_RANKING"]'::jsonb),
            (tenant_record.id, 'BEFORE_SLEEP', '18:00', '23:59', '["TRAFFIC","CONVERSION","PRICE","INVENTORY","TOMORROW_AVAILABILITY"]'::jsonb)
        ON CONFLICT (tenant_id, time_slot) DO NOTHING;

        INSERT INTO role_permission (tenant_id, role_id, permission_id)
        SELECT tenant_record.id, role.id, permission_item.id
        FROM app_role role
        CROSS JOIN permission permission_item
        WHERE role.tenant_id = tenant_record.id AND role.code = 'CEO'
          AND permission_item.code LIKE 'kpi.inspection.%'
        ON CONFLICT DO NOTHING;

        INSERT INTO role_permission (tenant_id, role_id, permission_id)
        SELECT tenant_record.id, role.id, permission_item.id
        FROM app_role role
        JOIN permission permission_item ON permission_item.code = ANY (ARRAY[
            'kpi.inspection.read-team', 'kpi.inspection.verify', 'kpi.inspection.manage'
        ])
        WHERE role.tenant_id = tenant_record.id AND role.code = 'HR_KPI_ADMIN'
        ON CONFLICT DO NOTHING;

        INSERT INTO role_permission (tenant_id, role_id, permission_id)
        SELECT tenant_record.id, role.id, permission_item.id
        FROM app_role role
        JOIN permission permission_item ON permission_item.code = ANY (ARRAY[
            'kpi.inspection.submit', 'kpi.inspection.read-team'
        ])
        WHERE role.tenant_id = tenant_record.id
          AND role.code = ANY (ARRAY['OTA_OPERATION_MANAGER', 'OTA_OPERATION_ASSISTANT'])
        ON CONFLICT DO NOTHING;
    END LOOP;
END $$;

DO $$
DECLARE
    table_name TEXT;
BEGIN
    FOREACH table_name IN ARRAY ARRAY[
        'kpi_inspection_schedule', 'kpi_inspection_submission',
        'kpi_inspection_abnormality_event', 'kpi_inspection_verification',
        'kpi_inspection_sla_breach', 'kpi_automation_run'
    ] LOOP
        EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', table_name);
        EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', table_name);
        EXECUTE format(
            'CREATE POLICY tenant_isolation ON %I USING (tenant_id = nullif(current_setting(''app.tenant_id'', true), '''')::uuid) WITH CHECK (tenant_id = nullif(current_setting(''app.tenant_id'', true), '''')::uuid)',
            table_name
        );
    END LOOP;
END $$;

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'hotel_ai_os_app') THEN
        GRANT SELECT, INSERT, UPDATE, DELETE ON
            kpi_inspection_schedule, kpi_inspection_submission,
            kpi_inspection_abnormality_event, kpi_inspection_verification,
            kpi_inspection_sla_breach, kpi_automation_run
        TO hotel_ai_os_app;
    END IF;
END $$;
