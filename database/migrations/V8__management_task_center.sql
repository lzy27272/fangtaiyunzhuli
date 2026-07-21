CREATE TABLE management_task (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenant(id),
    task_no VARCHAR(64) NOT NULL,
    idempotency_key VARCHAR(200) NOT NULL,
    source_event_id UUID,
    source_action_id UUID,
    standard_version_id UUID,
    work_record_id UUID,
    org_unit_id UUID NOT NULL,
    title VARCHAR(240) NOT NULL,
    description TEXT,
    lifecycle_status VARCHAR(32) NOT NULL DEFAULT 'PROPOSED'
        CHECK (lifecycle_status IN ('PROPOSED', 'PENDING_ACK', 'IN_PROGRESS', 'RESULT_SUBMITTED',
                                    'AWAITING_REVIEW', 'REWORK', 'COMPLETED', 'CANCELLED')),
    sla_status VARCHAR(24) NOT NULL DEFAULT 'ON_TIME'
        CHECK (sla_status IN ('ON_TIME', 'NEAR_DUE', 'OVERDUE', 'WAIVED')),
    priority VARCHAR(16) NOT NULL DEFAULT 'NORMAL' CHECK (priority IN ('LOW', 'NORMAL', 'HIGH', 'URGENT')),
    due_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    source_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
    responsibility_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
    result_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
    row_version BIGINT NOT NULL DEFAULT 0,
    created_by UUID,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, id),
    UNIQUE (tenant_id, task_no),
    UNIQUE (tenant_id, idempotency_key),
    UNIQUE (tenant_id, source_action_id),
    FOREIGN KEY (tenant_id, source_event_id) REFERENCES management_event (tenant_id, id),
    FOREIGN KEY (tenant_id, source_action_id) REFERENCES rule_action_execution (tenant_id, id),
    FOREIGN KEY (tenant_id, standard_version_id) REFERENCES standard_version (tenant_id, id),
    FOREIGN KEY (tenant_id, work_record_id) REFERENCES work_record (tenant_id, id),
    FOREIGN KEY (tenant_id, org_unit_id) REFERENCES org_unit (tenant_id, id),
    FOREIGN KEY (tenant_id, created_by) REFERENCES user_account (tenant_id, id)
);

CREATE TABLE task_participant (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenant(id),
    task_id UUID NOT NULL,
    participant_type VARCHAR(24) NOT NULL CHECK (participant_type IN ('ASSIGNEE', 'REVIEWER', 'OBSERVER')),
    position_assignment_id UUID NOT NULL,
    employee_snapshot JSONB NOT NULL,
    position_snapshot JSONB NOT NULL,
    org_snapshot JSONB NOT NULL,
    valid_from TIMESTAMPTZ NOT NULL DEFAULT now(),
    valid_to TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, id),
    UNIQUE (tenant_id, task_id, participant_type, position_assignment_id),
    CHECK (valid_to IS NULL OR valid_to >= valid_from),
    FOREIGN KEY (tenant_id, task_id) REFERENCES management_task (tenant_id, id) ON DELETE CASCADE,
    FOREIGN KEY (tenant_id, position_assignment_id) REFERENCES employee_position_assignment (tenant_id, id)
);

CREATE TABLE task_transition (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenant(id),
    task_id UUID NOT NULL,
    from_status VARCHAR(32),
    to_status VARCHAR(32) NOT NULL,
    command VARCHAR(32) NOT NULL CHECK (command IN (
        'CREATE', 'DISPATCH', 'ACKNOWLEDGE', 'START', 'SUBMIT_RESULT',
        'EVALUATION_COMPLETED', 'APPROVE', 'REWORK', 'CANCEL', 'MARK_OVERDUE', 'ESCALATE'
    )),
    actor_account_id UUID,
    actor_assignment_id UUID,
    task_version BIGINT NOT NULL,
    idempotency_key VARCHAR(200) NOT NULL,
    payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, id),
    UNIQUE (tenant_id, task_id, idempotency_key),
    FOREIGN KEY (tenant_id, task_id) REFERENCES management_task (tenant_id, id) ON DELETE CASCADE,
    FOREIGN KEY (tenant_id, actor_account_id) REFERENCES user_account (tenant_id, id),
    FOREIGN KEY (tenant_id, actor_assignment_id) REFERENCES employee_position_assignment (tenant_id, id)
);

CREATE TABLE task_evidence (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenant(id),
    task_id UUID NOT NULL,
    submitted_by_assignment_id UUID NOT NULL,
    evidence_type VARCHAR(24) NOT NULL CHECK (evidence_type IN ('FILE', 'IMAGE', 'LINK', 'STRUCTURED')),
    object_key VARCHAR(500),
    original_name VARCHAR(240),
    media_type VARCHAR(120),
    size_bytes BIGINT CHECK (size_bytes IS NULL OR size_bytes >= 0),
    sha256 CHAR(64),
    structured_result JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, id),
    UNIQUE (tenant_id, task_id, object_key),
    FOREIGN KEY (tenant_id, task_id) REFERENCES management_task (tenant_id, id) ON DELETE CASCADE,
    FOREIGN KEY (tenant_id, submitted_by_assignment_id) REFERENCES employee_position_assignment (tenant_id, id),
    CHECK (object_key IS NOT NULL OR structured_result <> '{}'::jsonb)
);

CREATE TABLE task_escalation (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenant(id),
    task_id UUID NOT NULL,
    escalation_level INTEGER NOT NULL CHECK (escalation_level > 0),
    scheduled_at TIMESTAMPTZ NOT NULL,
    resolver_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
    resolved_assignment_id UUID,
    status VARCHAR(24) NOT NULL DEFAULT 'SCHEDULED'
        CHECK (status IN ('SCHEDULED', 'EXECUTED', 'FAILED', 'CANCELLED')),
    executed_at TIMESTAMPTZ,
    last_error TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, id),
    UNIQUE (tenant_id, task_id, escalation_level),
    FOREIGN KEY (tenant_id, task_id) REFERENCES management_task (tenant_id, id) ON DELETE CASCADE,
    FOREIGN KEY (tenant_id, resolved_assignment_id) REFERENCES employee_position_assignment (tenant_id, id)
);

CREATE INDEX ix_task_scope_status ON management_task (tenant_id, org_unit_id, lifecycle_status, due_at);
CREATE INDEX ix_task_assignee ON task_participant (tenant_id, position_assignment_id, participant_type, valid_to);
CREATE INDEX ix_task_timeline ON task_transition (tenant_id, task_id, occurred_at, id);
CREATE INDEX ix_task_evidence_task ON task_evidence (tenant_id, task_id, created_at);
CREATE INDEX ix_task_escalation_due ON task_escalation (tenant_id, scheduled_at) WHERE status = 'SCHEDULED';

CREATE TRIGGER trg_management_task_updated_at BEFORE UPDATE ON management_task
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_task_escalation_updated_at BEFORE UPDATE ON task_escalation
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DO $$
DECLARE
    table_name TEXT;
BEGIN
    FOREACH table_name IN ARRAY ARRAY[
        'management_task', 'task_participant', 'task_transition', 'task_evidence', 'task_escalation'
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
        GRANT SELECT, INSERT, UPDATE, DELETE ON management_task, task_participant,
            task_transition, task_evidence, task_escalation TO hotel_ai_os_app;
    END IF;
END $$;
