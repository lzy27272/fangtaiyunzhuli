-- Confirmed issue closure, supervisor-gated task candidates and visible sync state.

CREATE TABLE issue_event (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenant(id),
    issue_no VARCHAR(64) NOT NULL,
    hotel_org_unit_id UUID NOT NULL,
    org_unit_id UUID NOT NULL,
    business_date DATE NOT NULL,
    title VARCHAR(240) NOT NULL,
    description TEXT,
    severity VARCHAR(24) NOT NULL DEFAULT 'GENERAL'
        CHECK (severity IN ('GENERAL', 'IMPORTANT', 'MAJOR')),
    severity_reason TEXT,
    lifecycle_status VARCHAR(24) NOT NULL DEFAULT 'CANDIDATE'
        CHECK (lifecycle_status IN ('CANDIDATE', 'CONFIRMED', 'IN_PROGRESS', 'PENDING_CLOSE', 'CLOSED')),
    owner_assignment_id UUID,
    acceptance_assignment_id UUID,
    created_by_account_id UUID,
    created_by_assignment_id UUID,
    first_occurred_at TIMESTAMPTZ NOT NULL,
    last_occurred_at TIMESTAMPTZ NOT NULL,
    due_at TIMESTAMPTZ,
    confirmed_by_account_id UUID,
    confirmed_by_assignment_id UUID,
    confirmed_at TIMESTAMPTZ,
    closed_by_account_id UUID,
    closed_by_assignment_id UUID,
    closed_at TIMESTAMPTZ,
    closure_reason TEXT,
    trace_id UUID NOT NULL,
    row_version BIGINT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, id),
    UNIQUE (tenant_id, issue_no),
    CHECK (last_occurred_at >= first_occurred_at),
    CHECK (due_at IS NULL OR due_at >= first_occurred_at),
    CHECK (
        lifecycle_status = 'CANDIDATE'
        OR (confirmed_at IS NOT NULL AND confirmed_by_account_id IS NOT NULL)
    ),
    CHECK (
        lifecycle_status <> 'CLOSED'
        OR (closed_at IS NOT NULL AND closed_by_account_id IS NOT NULL AND length(trim(closure_reason)) > 0)
    ),
    FOREIGN KEY (tenant_id, hotel_org_unit_id) REFERENCES org_unit (tenant_id, id),
    FOREIGN KEY (tenant_id, org_unit_id) REFERENCES org_unit (tenant_id, id),
    FOREIGN KEY (tenant_id, owner_assignment_id)
        REFERENCES employee_position_assignment (tenant_id, id),
    FOREIGN KEY (tenant_id, acceptance_assignment_id)
        REFERENCES employee_position_assignment (tenant_id, id),
    FOREIGN KEY (tenant_id, created_by_account_id) REFERENCES user_account (tenant_id, id),
    FOREIGN KEY (tenant_id, created_by_assignment_id)
        REFERENCES employee_position_assignment (tenant_id, id),
    FOREIGN KEY (tenant_id, confirmed_by_account_id) REFERENCES user_account (tenant_id, id),
    FOREIGN KEY (tenant_id, confirmed_by_assignment_id)
        REFERENCES employee_position_assignment (tenant_id, id),
    FOREIGN KEY (tenant_id, closed_by_account_id) REFERENCES user_account (tenant_id, id),
    FOREIGN KEY (tenant_id, closed_by_assignment_id)
        REFERENCES employee_position_assignment (tenant_id, id)
);

CREATE TABLE issue_source_link (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenant(id),
    issue_id UUID NOT NULL,
    source_type VARCHAR(40) NOT NULL CHECK (source_type IN (
        'DAILY_REPORT', 'WORK_RECORD', 'INSPECTION', 'QUALITY_REPORT', 'TASK',
        'METRIC', 'RULE', 'MANUAL', 'OTHER'
    )),
    source_id UUID,
    source_external_key VARCHAR(200),
    source_version VARCHAR(80),
    source_status VARCHAR(24) NOT NULL DEFAULT 'ACTIVE'
        CHECK (source_status IN ('ACTIVE', 'INVALIDATED')),
    source_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
    content_hash CHAR(64) NOT NULL,
    source_occurred_at TIMESTAMPTZ,
    linked_by_account_id UUID,
    linked_by_assignment_id UUID,
    linked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    invalidated_by_account_id UUID,
    invalidated_at TIMESTAMPTZ,
    invalidation_reason TEXT,
    UNIQUE (tenant_id, id),
    CHECK (num_nonnulls(source_id, source_external_key) = 1),
    CHECK (jsonb_typeof(source_snapshot) = 'object'),
    CHECK (
        source_status <> 'INVALIDATED'
        OR (invalidated_at IS NOT NULL AND length(trim(invalidation_reason)) > 0)
    ),
    FOREIGN KEY (tenant_id, issue_id) REFERENCES issue_event (tenant_id, id),
    FOREIGN KEY (tenant_id, linked_by_account_id) REFERENCES user_account (tenant_id, id),
    FOREIGN KEY (tenant_id, linked_by_assignment_id)
        REFERENCES employee_position_assignment (tenant_id, id),
    FOREIGN KEY (tenant_id, invalidated_by_account_id) REFERENCES user_account (tenant_id, id)
);

CREATE UNIQUE INDEX ux_issue_source_identity
    ON issue_source_link (
        tenant_id, issue_id, source_type,
        coalesce(source_id::text, source_external_key), coalesce(source_version, '')
    );

CREATE TABLE issue_transition (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenant(id),
    issue_id UUID NOT NULL,
    from_status VARCHAR(24),
    to_status VARCHAR(24) NOT NULL,
    command VARCHAR(40) NOT NULL CHECK (command IN (
        'CREATE_CANDIDATE', 'CONFIRM', 'START', 'REQUEST_CLOSE', 'CLOSE', 'REOPEN',
        'CHANGE_SEVERITY', 'ASSIGN', 'LINK_SOURCE', 'INVALIDATE_SOURCE'
    )),
    actor_account_id UUID,
    actor_assignment_id UUID,
    reason TEXT,
    payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    idempotency_key VARCHAR(200) NOT NULL,
    occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, id),
    UNIQUE (tenant_id, issue_id, idempotency_key),
    CHECK (jsonb_typeof(payload) = 'object'),
    FOREIGN KEY (tenant_id, issue_id) REFERENCES issue_event (tenant_id, id),
    FOREIGN KEY (tenant_id, actor_account_id) REFERENCES user_account (tenant_id, id),
    FOREIGN KEY (tenant_id, actor_assignment_id)
        REFERENCES employee_position_assignment (tenant_id, id)
);

CREATE TABLE task_candidate (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenant(id),
    candidate_no VARCHAR(64) NOT NULL,
    issue_id UUID,
    source_event_id UUID,
    source_rule_action_id UUID,
    hotel_org_unit_id UUID NOT NULL,
    org_unit_id UUID NOT NULL,
    business_date DATE NOT NULL,
    standard_version_id UUID,
    title VARCHAR(240) NOT NULL,
    description TEXT,
    priority VARCHAR(16) NOT NULL DEFAULT 'NORMAL'
        CHECK (priority IN ('LOW', 'NORMAL', 'HIGH', 'URGENT')),
    status VARCHAR(32) NOT NULL DEFAULT 'PENDING_CONFIRMATION'
        CHECK (status IN ('PENDING_CONFIRMATION', 'CONFIRMED', 'PENDING_SYNC', 'TASK_CREATED', 'REJECTED')),
    created_by_account_id UUID,
    created_by_assignment_id UUID,
    assignee_assignment_id UUID NOT NULL,
    reviewer_assignment_id UUID NOT NULL,
    due_at TIMESTAMPTZ,
    acceptance_criteria TEXT NOT NULL,
    source_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
    idempotency_key VARCHAR(200) NOT NULL,
    confirmed_by_account_id UUID,
    confirmed_by_assignment_id UUID,
    confirmed_at TIMESTAMPTZ,
    rejected_by_account_id UUID,
    rejected_by_assignment_id UUID,
    rejected_at TIMESTAMPTZ,
    rejection_reason TEXT,
    formal_task_id UUID,
    formal_task_no VARCHAR(64),
    formal_task_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
    trace_id UUID NOT NULL,
    row_version BIGINT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, id),
    UNIQUE (tenant_id, candidate_no),
    UNIQUE (tenant_id, idempotency_key),
    CHECK (jsonb_typeof(source_snapshot) = 'object'),
    CHECK (jsonb_typeof(formal_task_snapshot) = 'object'),
    CHECK (assignee_assignment_id <> reviewer_assignment_id),
    CHECK (
        status NOT IN ('CONFIRMED', 'PENDING_SYNC', 'TASK_CREATED')
        OR (confirmed_at IS NOT NULL AND confirmed_by_account_id IS NOT NULL)
    ),
    CHECK (
        status <> 'REJECTED'
        OR (rejected_at IS NOT NULL AND rejected_by_account_id IS NOT NULL AND length(trim(rejection_reason)) > 0)
    ),
    CHECK (
        status <> 'TASK_CREATED'
        OR (formal_task_id IS NOT NULL AND formal_task_no IS NOT NULL)
    ),
    FOREIGN KEY (tenant_id, issue_id) REFERENCES issue_event (tenant_id, id),
    FOREIGN KEY (tenant_id, source_event_id) REFERENCES management_event (tenant_id, id),
    FOREIGN KEY (tenant_id, source_rule_action_id) REFERENCES rule_action_execution (tenant_id, id),
    FOREIGN KEY (tenant_id, hotel_org_unit_id) REFERENCES org_unit (tenant_id, id),
    FOREIGN KEY (tenant_id, org_unit_id) REFERENCES org_unit (tenant_id, id),
    FOREIGN KEY (tenant_id, standard_version_id) REFERENCES standard_version (tenant_id, id),
    FOREIGN KEY (tenant_id, created_by_account_id) REFERENCES user_account (tenant_id, id),
    FOREIGN KEY (tenant_id, created_by_assignment_id)
        REFERENCES employee_position_assignment (tenant_id, id),
    FOREIGN KEY (tenant_id, assignee_assignment_id)
        REFERENCES employee_position_assignment (tenant_id, id),
    FOREIGN KEY (tenant_id, reviewer_assignment_id)
        REFERENCES employee_position_assignment (tenant_id, id),
    FOREIGN KEY (tenant_id, confirmed_by_account_id) REFERENCES user_account (tenant_id, id),
    FOREIGN KEY (tenant_id, confirmed_by_assignment_id)
        REFERENCES employee_position_assignment (tenant_id, id),
    FOREIGN KEY (tenant_id, rejected_by_account_id) REFERENCES user_account (tenant_id, id),
    FOREIGN KEY (tenant_id, rejected_by_assignment_id)
        REFERENCES employee_position_assignment (tenant_id, id)
);

CREATE UNIQUE INDEX ux_task_candidate_source_rule_action
    ON task_candidate (tenant_id, source_rule_action_id)
    WHERE source_rule_action_id IS NOT NULL;
CREATE INDEX ix_task_candidate_queue
    ON task_candidate (tenant_id, hotel_org_unit_id, business_date, status, due_at);
CREATE INDEX ix_task_candidate_source_event
    ON task_candidate (tenant_id, source_event_id)
    WHERE source_event_id IS NOT NULL;

CREATE TABLE issue_task_link (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenant(id),
    issue_id UUID NOT NULL,
    task_candidate_id UUID,
    management_task_id UUID NOT NULL,
    management_task_no VARCHAR(64) NOT NULL,
    link_type VARCHAR(32) NOT NULL CHECK (link_type IN ('CREATED_FROM_CANDIDATE', 'RELATED_EXISTING')),
    link_status VARCHAR(24) NOT NULL DEFAULT 'ACTIVE' CHECK (link_status IN ('ACTIVE', 'UNLINKED')),
    task_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
    linked_by_account_id UUID NOT NULL,
    linked_by_assignment_id UUID,
    linked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    unlinked_by_account_id UUID,
    unlinked_at TIMESTAMPTZ,
    unlink_reason TEXT,
    UNIQUE (tenant_id, id),
    UNIQUE (tenant_id, issue_id, management_task_id),
    CHECK (jsonb_typeof(task_snapshot) = 'object'),
    CHECK (
        link_status <> 'UNLINKED'
        OR (unlinked_at IS NOT NULL AND unlinked_by_account_id IS NOT NULL AND length(trim(unlink_reason)) > 0)
    ),
    FOREIGN KEY (tenant_id, issue_id) REFERENCES issue_event (tenant_id, id),
    FOREIGN KEY (tenant_id, task_candidate_id) REFERENCES task_candidate (tenant_id, id),
    FOREIGN KEY (tenant_id, linked_by_account_id) REFERENCES user_account (tenant_id, id),
    FOREIGN KEY (tenant_id, linked_by_assignment_id)
        REFERENCES employee_position_assignment (tenant_id, id),
    FOREIGN KEY (tenant_id, unlinked_by_account_id) REFERENCES user_account (tenant_id, id)
);

CREATE UNIQUE INDEX ux_issue_task_link_candidate
    ON issue_task_link (tenant_id, task_candidate_id)
    WHERE task_candidate_id IS NOT NULL AND link_type = 'CREATED_FROM_CANDIDATE';

CREATE TABLE sync_operation (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenant(id),
    aggregate_type VARCHAR(80) NOT NULL,
    aggregate_id UUID NOT NULL,
    operation_type VARCHAR(80) NOT NULL,
    idempotency_key VARCHAR(200) NOT NULL,
    status VARCHAR(32) NOT NULL DEFAULT 'PENDING'
        CHECK (status IN ('PENDING', 'RUNNING', 'SUCCEEDED', 'FAILED', 'MANUAL_INTERVENTION')),
    attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
    available_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    locked_by VARCHAR(120),
    locked_until TIMESTAMPTZ,
    next_retry_at TIMESTAMPTZ,
    last_attempt_at TIMESTAMPTZ,
    last_error TEXT,
    target_id UUID,
    target_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
    completed_at TIMESTAMPTZ,
    trace_id UUID NOT NULL,
    row_version BIGINT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, id),
    UNIQUE (tenant_id, idempotency_key),
    CHECK (jsonb_typeof(target_snapshot) = 'object'),
    CHECK (status <> 'SUCCEEDED' OR completed_at IS NOT NULL)
);

CREATE INDEX ix_sync_operation_queue
    ON sync_operation (tenant_id, status, available_at, next_retry_at)
    WHERE status IN ('PENDING', 'FAILED');
CREATE INDEX ix_sync_operation_lock
    ON sync_operation (tenant_id, locked_until)
    WHERE status = 'RUNNING';
CREATE INDEX ix_sync_operation_aggregate
    ON sync_operation (tenant_id, aggregate_type, aggregate_id, created_at DESC);

ALTER TABLE rule_action_execution
    DROP CONSTRAINT IF EXISTS rule_action_execution_action_type_check;
ALTER TABLE rule_action_execution
    ADD CONSTRAINT ck_rule_action_execution_type CHECK (
        action_type IN ('CREATE_TASK', 'CREATE_NOTIFICATION', 'CREATE_TASK_CANDIDATE')
    );

CREATE INDEX ix_issue_event_action_queue
    ON issue_event (tenant_id, hotel_org_unit_id, business_date, lifecycle_status, severity, due_at);
CREATE INDEX ix_issue_event_owner
    ON issue_event (tenant_id, owner_assignment_id, lifecycle_status, due_at);
CREATE INDEX ix_issue_transition_timeline
    ON issue_transition (tenant_id, issue_id, occurred_at, id);

CREATE OR REPLACE FUNCTION protect_confirmed_task_candidate() RETURNS trigger AS $$
BEGIN
    IF TG_OP = 'DELETE' AND OLD.status <> 'PENDING_CONFIRMATION' THEN
        RAISE EXCEPTION 'confirmed task candidates cannot be deleted';
    END IF;
    IF TG_OP = 'UPDATE' AND OLD.status <> 'PENDING_CONFIRMATION' THEN
        IF (to_jsonb(NEW) - ARRAY[
                'status', 'confirmed_by_account_id', 'confirmed_by_assignment_id', 'confirmed_at',
                'rejected_by_account_id', 'rejected_by_assignment_id', 'rejected_at', 'rejection_reason',
                'formal_task_id', 'formal_task_no', 'formal_task_snapshot', 'row_version', 'updated_at'
            ]) <> (to_jsonb(OLD) - ARRAY[
                'status', 'confirmed_by_account_id', 'confirmed_by_assignment_id', 'confirmed_at',
                'rejected_by_account_id', 'rejected_by_assignment_id', 'rejected_at', 'rejection_reason',
                'formal_task_id', 'formal_task_no', 'formal_task_snapshot', 'row_version', 'updated_at'
            ]) THEN
            RAISE EXCEPTION 'confirmed task candidate facts are immutable';
        END IF;
    END IF;
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_task_candidate_confirmed_immutable
    BEFORE UPDATE OR DELETE ON task_candidate
    FOR EACH ROW EXECUTE FUNCTION protect_confirmed_task_candidate();

CREATE OR REPLACE FUNCTION protect_issue_source_link() RETURNS trigger AS $$
BEGIN
    IF TG_OP = 'UPDATE' THEN
        IF OLD.source_status = 'ACTIVE' AND NEW.source_status = 'INVALIDATED'
           AND (to_jsonb(NEW) - ARRAY['source_status', 'invalidated_by_account_id', 'invalidated_at', 'invalidation_reason'])
               = (to_jsonb(OLD) - ARRAY['source_status', 'invalidated_by_account_id', 'invalidated_at', 'invalidation_reason']) THEN
            RETURN NEW;
        END IF;
        RAISE EXCEPTION 'issue source links are immutable except for one-way invalidation';
    END IF;
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'issue source links cannot be deleted; invalidate them instead';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_issue_source_link_immutable
    BEFORE UPDATE OR DELETE ON issue_source_link
    FOR EACH ROW EXECUTE FUNCTION protect_issue_source_link();

CREATE OR REPLACE FUNCTION protect_issue_task_link() RETURNS trigger AS $$
BEGIN
    IF TG_OP = 'UPDATE' THEN
        IF OLD.link_status = 'ACTIVE' AND NEW.link_status = 'UNLINKED'
           AND (to_jsonb(NEW) - ARRAY['link_status', 'unlinked_by_account_id', 'unlinked_at', 'unlink_reason'])
               = (to_jsonb(OLD) - ARRAY['link_status', 'unlinked_by_account_id', 'unlinked_at', 'unlink_reason']) THEN
            RETURN NEW;
        END IF;
        RAISE EXCEPTION 'issue task links are immutable except for one-way unlinking';
    END IF;
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'issue task links cannot be deleted; unlink them instead';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_issue_task_link_immutable
    BEFORE UPDATE OR DELETE ON issue_task_link
    FOR EACH ROW EXECUTE FUNCTION protect_issue_task_link();
CREATE TRIGGER trg_issue_transition_append_only
    BEFORE UPDATE OR DELETE ON issue_transition
    FOR EACH ROW EXECUTE FUNCTION reject_append_only_mutation();

DO $$
DECLARE
    table_name TEXT;
BEGIN
    FOREACH table_name IN ARRAY ARRAY[
        'issue_event', 'issue_source_link', 'issue_transition',
        'task_candidate', 'issue_task_link', 'sync_operation'
    ] LOOP
        EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', table_name);
        EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', table_name);
        EXECUTE format(
            'CREATE POLICY tenant_isolation ON %I USING (tenant_id = nullif(current_setting(''app.tenant_id'', true), '''')::uuid) WITH CHECK (tenant_id = nullif(current_setting(''app.tenant_id'', true), '''')::uuid)',
            table_name
        );
    END LOOP;
END $$;

CREATE TRIGGER trg_issue_event_updated_at
    BEFORE UPDATE ON issue_event FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_task_candidate_updated_at
    BEFORE UPDATE ON task_candidate FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_sync_operation_updated_at
    BEFORE UPDATE ON sync_operation FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'hotel_ai_os_app') THEN
        GRANT SELECT, INSERT, UPDATE, DELETE ON
            issue_event, issue_source_link, issue_transition,
            task_candidate, issue_task_link, sync_operation
        TO hotel_ai_os_app;
        REVOKE UPDATE, DELETE ON issue_transition FROM hotel_ai_os_app;
    END IF;
END $$;
