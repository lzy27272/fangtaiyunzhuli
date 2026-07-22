-- Business-day closure, immutable operation snapshots, action queue,
-- channel delivery, governed AI records and asynchronous exports.

CREATE TABLE business_day_run (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenant(id),
    hotel_org_unit_id UUID NOT NULL,
    business_date DATE NOT NULL,
    timezone VARCHAR(64) NOT NULL,
    cutoff_local_time TIME NOT NULL,
    status VARCHAR(24) NOT NULL DEFAULT 'OPEN'
        CHECK (status IN ('OPEN', 'CLOSING', 'CLOSED', 'FAILED')),
    opened_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    closing_started_at TIMESTAMPTZ,
    closed_at TIMESTAMPTZ,
    failed_at TIMESTAMPTZ,
    failure_reason TEXT,
    triggered_by_account_id UUID,
    trace_id UUID NOT NULL,
    row_version BIGINT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, id),
    UNIQUE (tenant_id, hotel_org_unit_id, business_date),
    CHECK (closing_started_at IS NULL OR closing_started_at >= opened_at),
    CHECK (status <> 'CLOSED' OR closed_at IS NOT NULL),
    CHECK (status <> 'FAILED' OR (failed_at IS NOT NULL AND failure_reason IS NOT NULL)),
    FOREIGN KEY (tenant_id, hotel_org_unit_id) REFERENCES org_unit (tenant_id, id),
    FOREIGN KEY (tenant_id, triggered_by_account_id) REFERENCES user_account (tenant_id, id)
);

CREATE TABLE daily_operation_snapshot (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenant(id),
    business_day_run_id UUID NOT NULL,
    hotel_org_unit_id UUID NOT NULL,
    business_date DATE NOT NULL,
    version_no INTEGER NOT NULL CHECK (version_no > 0),
    status VARCHAR(24) NOT NULL DEFAULT 'GENERATING'
        CHECK (status IN ('GENERATING', 'GENERATED', 'FAILED', 'SUPERSEDED')),
    snapshot_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    data_cutoff_at TIMESTAMPTZ NOT NULL,
    completeness_status VARCHAR(24) NOT NULL DEFAULT 'COMPLETE'
        CHECK (completeness_status IN ('COMPLETE', 'PARTIAL', 'UNAVAILABLE')),
    payload_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
    content_hash CHAR(64),
    correction_of_snapshot_id UUID,
    correction_reason TEXT,
    generated_by_account_id UUID,
    generated_at TIMESTAMPTZ,
    failure_reason TEXT,
    trace_id UUID NOT NULL,
    row_version BIGINT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, id),
    UNIQUE (tenant_id, business_day_run_id, id),
    UNIQUE (tenant_id, business_day_run_id, version_no),
    CHECK (jsonb_typeof(payload_snapshot) = 'object'),
    CHECK (status NOT IN ('GENERATED', 'SUPERSEDED') OR (content_hash IS NOT NULL AND generated_at IS NOT NULL)),
    CHECK (status <> 'FAILED' OR failure_reason IS NOT NULL),
    CHECK (correction_of_snapshot_id IS NULL OR length(trim(correction_reason)) > 0),
    FOREIGN KEY (tenant_id, business_day_run_id) REFERENCES business_day_run (tenant_id, id),
    FOREIGN KEY (tenant_id, hotel_org_unit_id) REFERENCES org_unit (tenant_id, id),
    FOREIGN KEY (tenant_id, business_day_run_id, correction_of_snapshot_id)
        REFERENCES daily_operation_snapshot (tenant_id, business_day_run_id, id),
    FOREIGN KEY (tenant_id, generated_by_account_id) REFERENCES user_account (tenant_id, id)
);

CREATE TABLE daily_operation_snapshot_metric (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenant(id),
    snapshot_id UUID NOT NULL,
    metric_code VARCHAR(80) NOT NULL,
    metric_value NUMERIC(20,4),
    metric_unit VARCHAR(32),
    quality_status VARCHAR(24) NOT NULL DEFAULT 'AVAILABLE'
        CHECK (quality_status IN ('AVAILABLE', 'NO_DATA', 'UNAVAILABLE', 'PARTIAL')),
    source_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
    content_hash CHAR(64) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, id),
    UNIQUE (tenant_id, snapshot_id, metric_code),
    CHECK (jsonb_typeof(source_snapshot) = 'object'),
    CHECK (quality_status = 'AVAILABLE' OR metric_value IS NULL),
    FOREIGN KEY (tenant_id, snapshot_id) REFERENCES daily_operation_snapshot (tenant_id, id)
);

CREATE TABLE action_item (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenant(id),
    action_type VARCHAR(40) NOT NULL CHECK (action_type IN (
        'REPORT_SUBMISSION', 'REPORT_REVIEW', 'REVISION_REVIEW', 'ISSUE_CONFIRMATION',
        'ISSUE_ACTION', 'TASK_CANDIDATE_CONFIRMATION', 'SYNC_RETRY', 'MAJOR_ACKNOWLEDGEMENT'
    )),
    source_type VARCHAR(40) NOT NULL,
    source_id UUID NOT NULL,
    idempotency_key VARCHAR(200) NOT NULL,
    severity VARCHAR(24) NOT NULL DEFAULT 'GENERAL'
        CHECK (severity IN ('GENERAL', 'IMPORTANT', 'MAJOR')),
    status VARCHAR(24) NOT NULL DEFAULT 'OPEN'
        CHECK (status IN ('OPEN', 'ACKNOWLEDGED', 'COMPLETED', 'CANCELLED')),
    hotel_org_unit_id UUID NOT NULL,
    org_unit_id UUID NOT NULL,
    business_date DATE NOT NULL,
    owner_assignment_id UUID,
    recipient_account_id UUID NOT NULL,
    recipient_assignment_id UUID,
    title VARCHAR(240) NOT NULL,
    summary TEXT,
    due_at TIMESTAMPTZ,
    acknowledged_by_account_id UUID,
    acknowledged_at TIMESTAMPTZ,
    completed_by_account_id UUID,
    completed_at TIMESTAMPTZ,
    completion_reason TEXT,
    trace_id UUID NOT NULL,
    row_version BIGINT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, id),
    UNIQUE (tenant_id, idempotency_key),
    CHECK (status <> 'ACKNOWLEDGED' OR acknowledged_at IS NOT NULL),
    CHECK (status <> 'COMPLETED' OR completed_at IS NOT NULL),
    FOREIGN KEY (tenant_id, hotel_org_unit_id) REFERENCES org_unit (tenant_id, id),
    FOREIGN KEY (tenant_id, org_unit_id) REFERENCES org_unit (tenant_id, id),
    FOREIGN KEY (tenant_id, owner_assignment_id)
        REFERENCES employee_position_assignment (tenant_id, id),
    FOREIGN KEY (tenant_id, recipient_account_id) REFERENCES user_account (tenant_id, id),
    FOREIGN KEY (tenant_id, recipient_assignment_id)
        REFERENCES employee_position_assignment (tenant_id, id),
    FOREIGN KEY (tenant_id, acknowledged_by_account_id) REFERENCES user_account (tenant_id, id),
    FOREIGN KEY (tenant_id, completed_by_account_id) REFERENCES user_account (tenant_id, id)
);

CREATE TABLE notification_delivery (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenant(id),
    notification_id UUID NOT NULL,
    channel VARCHAR(24) NOT NULL CHECK (channel IN ('IN_APP', 'EMAIL', 'SMS', 'WECHAT', 'WEBHOOK')),
    recipient_endpoint_hash CHAR(64),
    status VARCHAR(24) NOT NULL DEFAULT 'PENDING'
        CHECK (status IN ('PENDING', 'SENT', 'DELIVERED', 'READ', 'FAILED')),
    attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
    available_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    next_retry_at TIMESTAMPTZ,
    locked_by VARCHAR(120),
    locked_until TIMESTAMPTZ,
    last_error TEXT,
    sent_at TIMESTAMPTZ,
    delivered_at TIMESTAMPTZ,
    read_at TIMESTAMPTZ,
    failed_at TIMESTAMPTZ,
    row_version BIGINT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, id),
    CHECK (channel = 'IN_APP' OR recipient_endpoint_hash IS NOT NULL),
    CHECK (status <> 'SENT' OR sent_at IS NOT NULL),
    CHECK (status <> 'DELIVERED' OR delivered_at IS NOT NULL),
    CHECK (status <> 'READ' OR read_at IS NOT NULL),
    CHECK (status <> 'FAILED' OR failed_at IS NOT NULL),
    FOREIGN KEY (tenant_id, notification_id) REFERENCES notification (tenant_id, id)
);

CREATE UNIQUE INDEX ux_notification_delivery_channel
    ON notification_delivery (
        tenant_id, notification_id, channel,
        coalesce(recipient_endpoint_hash, repeat('0', 64)::char(64))
    );

CREATE TABLE ai_request (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenant(id),
    request_type VARCHAR(40) NOT NULL CHECK (request_type IN (
        'DAILY_REPORT_ANALYSIS', 'ISSUE_ANALYSIS', 'END_OF_DAY_SUMMARY', 'TASK_CANDIDATE'
    )),
    status VARCHAR(24) NOT NULL DEFAULT 'PENDING'
        CHECK (status IN ('PENDING', 'RUNNING', 'SUCCEEDED', 'FAILED')),
    hotel_org_unit_id UUID,
    org_unit_id UUID,
    business_date DATE,
    provider_code VARCHAR(80) NOT NULL,
    model_name VARCHAR(120) NOT NULL,
    model_version VARCHAR(80) NOT NULL,
    prompt_version VARCHAR(80) NOT NULL,
    context_version VARCHAR(80) NOT NULL,
    input_hash CHAR(64) NOT NULL,
    input_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
    sensitivity_level VARCHAR(24) NOT NULL DEFAULT 'INTERNAL'
        CHECK (sensitivity_level IN ('PUBLIC', 'INTERNAL', 'SENSITIVE', 'RESTRICTED')),
    requested_by_account_id UUID,
    requested_by_assignment_id UUID,
    trace_id UUID NOT NULL,
    correlation_id UUID NOT NULL,
    failure_reason TEXT,
    completed_at TIMESTAMPTZ,
    row_version BIGINT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, id),
    CHECK (jsonb_typeof(input_snapshot) = 'object'),
    CHECK (status <> 'SUCCEEDED' OR completed_at IS NOT NULL),
    CHECK (status <> 'FAILED' OR failure_reason IS NOT NULL),
    FOREIGN KEY (tenant_id, hotel_org_unit_id) REFERENCES org_unit (tenant_id, id),
    FOREIGN KEY (tenant_id, org_unit_id) REFERENCES org_unit (tenant_id, id),
    FOREIGN KEY (tenant_id, requested_by_account_id) REFERENCES user_account (tenant_id, id),
    FOREIGN KEY (tenant_id, requested_by_assignment_id)
        REFERENCES employee_position_assignment (tenant_id, id)
);

CREATE TABLE ai_recommendation (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenant(id),
    ai_request_id UUID NOT NULL,
    recommendation_no INTEGER NOT NULL DEFAULT 1 CHECK (recommendation_no > 0),
    recommendation_type VARCHAR(40) NOT NULL,
    fact_summary JSONB NOT NULL DEFAULT '{}'::jsonb,
    analysis TEXT NOT NULL,
    recommendation TEXT NOT NULL,
    confidence NUMERIC(6,5) CHECK (confidence IS NULL OR confidence BETWEEN 0 AND 1),
    applicability_scope JSONB NOT NULL DEFAULT '{}'::jsonb,
    model_name VARCHAR(120) NOT NULL,
    model_version VARCHAR(80) NOT NULL,
    prompt_version VARCHAR(80) NOT NULL,
    context_version VARCHAR(80) NOT NULL,
    status VARCHAR(24) NOT NULL DEFAULT 'AVAILABLE'
        CHECK (status IN ('AVAILABLE', 'INVALIDATED')),
    invalidated_at TIMESTAMPTZ,
    invalidation_reason TEXT,
    generated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, id),
    UNIQUE (tenant_id, ai_request_id, recommendation_no),
    CHECK (jsonb_typeof(fact_summary) = 'object'),
    CHECK (jsonb_typeof(applicability_scope) = 'object'),
    CHECK (status <> 'INVALIDATED' OR (invalidated_at IS NOT NULL AND invalidation_reason IS NOT NULL)),
    FOREIGN KEY (tenant_id, ai_request_id) REFERENCES ai_request (tenant_id, id)
);

CREATE TABLE ai_recommendation_source (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenant(id),
    recommendation_id UUID NOT NULL,
    source_type VARCHAR(40) NOT NULL,
    source_id UUID,
    source_external_key VARCHAR(200),
    source_version VARCHAR(80),
    source_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
    content_hash CHAR(64) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, id),
    CHECK (num_nonnulls(source_id, source_external_key) = 1),
    CHECK (jsonb_typeof(source_snapshot) = 'object'),
    FOREIGN KEY (tenant_id, recommendation_id) REFERENCES ai_recommendation (tenant_id, id)
);

CREATE UNIQUE INDEX ux_ai_recommendation_source_identity
    ON ai_recommendation_source (
        tenant_id, recommendation_id, source_type,
        coalesce(source_id::text, source_external_key), coalesce(source_version, '')
    );

CREATE TABLE ai_decision (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenant(id),
    recommendation_id UUID NOT NULL,
    decision VARCHAR(32) NOT NULL CHECK (decision IN (
        'ACCEPTED', 'PARTIALLY_ACCEPTED', 'REJECTED', 'REPORTED_INCORRECT'
    )),
    actor_account_id UUID NOT NULL,
    actor_assignment_id UUID,
    reason TEXT,
    result_draft_type VARCHAR(40),
    result_draft_id UUID,
    decision_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
    trace_id UUID NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, id),
    CHECK ((result_draft_type IS NULL) = (result_draft_id IS NULL)),
    CHECK (jsonb_typeof(decision_snapshot) = 'object'),
    FOREIGN KEY (tenant_id, recommendation_id) REFERENCES ai_recommendation (tenant_id, id),
    FOREIGN KEY (tenant_id, actor_account_id) REFERENCES user_account (tenant_id, id),
    FOREIGN KEY (tenant_id, actor_assignment_id)
        REFERENCES employee_position_assignment (tenant_id, id)
);

CREATE TABLE operation_export_job (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenant(id),
    export_format VARCHAR(24) NOT NULL CHECK (export_format IN ('XLSX', 'CSV', 'PDF', 'EVIDENCE_LIST')),
    status VARCHAR(24) NOT NULL DEFAULT 'PENDING'
        CHECK (status IN ('PENDING', 'RUNNING', 'SUCCEEDED', 'FAILED', 'EXPIRED', 'CANCELLED')),
    hotel_org_unit_id UUID,
    org_unit_id UUID,
    business_date DATE,
    filter_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
    authorization_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
    sensitivity_level VARCHAR(24) NOT NULL DEFAULT 'INTERNAL'
        CHECK (sensitivity_level IN ('PUBLIC', 'INTERNAL', 'SENSITIVE', 'RESTRICTED')),
    requested_by_account_id UUID NOT NULL,
    requested_by_assignment_id UUID,
    object_key VARCHAR(500),
    file_name VARCHAR(240),
    sha256 CHAR(64),
    size_bytes BIGINT CHECK (size_bytes IS NULL OR size_bytes >= 0),
    expires_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    failure_reason TEXT,
    trace_id UUID NOT NULL,
    row_version BIGINT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, id),
    CHECK (jsonb_typeof(filter_snapshot) = 'object'),
    CHECK (jsonb_typeof(authorization_snapshot) = 'object'),
    CHECK (status <> 'SUCCEEDED' OR (
        object_key IS NOT NULL AND file_name IS NOT NULL AND sha256 IS NOT NULL
        AND size_bytes IS NOT NULL AND size_bytes > 0
        AND completed_at IS NOT NULL AND expires_at IS NOT NULL
    )),
    CHECK (status <> 'FAILED' OR failure_reason IS NOT NULL),
    CHECK (expires_at IS NULL OR completed_at IS NULL OR expires_at >= completed_at),
    FOREIGN KEY (tenant_id, hotel_org_unit_id) REFERENCES org_unit (tenant_id, id),
    FOREIGN KEY (tenant_id, org_unit_id) REFERENCES org_unit (tenant_id, id),
    FOREIGN KEY (tenant_id, requested_by_account_id) REFERENCES user_account (tenant_id, id),
    FOREIGN KEY (tenant_id, requested_by_assignment_id)
        REFERENCES employee_position_assignment (tenant_id, id)
);

CREATE INDEX ix_business_day_run_queue
    ON business_day_run (tenant_id, status, business_date, hotel_org_unit_id);
CREATE INDEX ix_operation_snapshot_lookup
    ON daily_operation_snapshot (tenant_id, hotel_org_unit_id, business_date, version_no DESC);
CREATE INDEX ix_action_item_queue
    ON action_item (tenant_id, recipient_account_id, status, severity, due_at);
CREATE INDEX ix_action_item_scope
    ON action_item (tenant_id, hotel_org_unit_id, business_date, status, action_type);
CREATE INDEX ix_notification_delivery_queue
    ON notification_delivery (tenant_id, status, available_at, next_retry_at)
    WHERE status IN ('PENDING', 'FAILED');
CREATE INDEX ix_ai_request_queue
    ON ai_request (tenant_id, status, created_at)
    WHERE status IN ('PENDING', 'RUNNING');
CREATE INDEX ix_ai_request_context
    ON ai_request (tenant_id, hotel_org_unit_id, business_date, request_type, created_at DESC);
CREATE INDEX ix_ai_decision_recommendation
    ON ai_decision (tenant_id, recommendation_id, created_at DESC);
CREATE INDEX ix_operation_export_queue
    ON operation_export_job (tenant_id, status, created_at)
    WHERE status IN ('PENDING', 'RUNNING');
CREATE INDEX ix_operation_export_expiry_cleanup
    ON operation_export_job (tenant_id, expires_at, id)
    WHERE status IN ('SUCCEEDED', 'EXPIRED') AND object_key IS NOT NULL;
CREATE INDEX ix_operation_export_account_list
    ON operation_export_job (tenant_id, requested_by_account_id, created_at DESC);

CREATE OR REPLACE FUNCTION protect_operation_snapshot() RETURNS trigger AS $$
BEGIN
    IF TG_OP = 'DELETE' AND OLD.status <> 'GENERATING' THEN
        RAISE EXCEPTION 'completed operation snapshots are immutable';
    END IF;
    IF TG_OP = 'UPDATE' AND OLD.status IN ('GENERATED', 'FAILED', 'SUPERSEDED') THEN
        IF OLD.status = 'GENERATED' AND NEW.status = 'SUPERSEDED'
           AND NEW.row_version = OLD.row_version + 1
           AND (to_jsonb(NEW) - ARRAY['status', 'row_version'])
               = (to_jsonb(OLD) - ARRAY['status', 'row_version']) THEN
            RETURN NEW;
        END IF;
        RAISE EXCEPTION 'completed operation snapshots are immutable';
    END IF;
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_operation_snapshot_immutable
    BEFORE UPDATE OR DELETE ON daily_operation_snapshot
    FOR EACH ROW EXECUTE FUNCTION protect_operation_snapshot();

CREATE OR REPLACE FUNCTION require_generating_operation_snapshot() RETURNS trigger AS $$
DECLARE
    parent_status VARCHAR(24);
BEGIN
    SELECT status INTO parent_status FROM daily_operation_snapshot
    WHERE tenant_id = coalesce(NEW.tenant_id, OLD.tenant_id)
      AND id = coalesce(NEW.snapshot_id, OLD.snapshot_id);
    IF parent_status IS DISTINCT FROM 'GENERATING' THEN
        RAISE EXCEPTION 'snapshot metrics may change only while snapshot is generating';
    END IF;
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_operation_snapshot_metric_generating_only
    BEFORE INSERT OR UPDATE OR DELETE ON daily_operation_snapshot_metric
    FOR EACH ROW EXECUTE FUNCTION require_generating_operation_snapshot();

CREATE OR REPLACE FUNCTION protect_ai_recommendation() RETURNS trigger AS $$
BEGIN
    IF TG_OP = 'UPDATE' THEN
        IF OLD.status = 'AVAILABLE' AND NEW.status = 'INVALIDATED'
           AND (to_jsonb(NEW) - ARRAY['status', 'invalidated_at', 'invalidation_reason'])
               = (to_jsonb(OLD) - ARRAY['status', 'invalidated_at', 'invalidation_reason']) THEN
            RETURN NEW;
        END IF;
        RAISE EXCEPTION 'AI recommendations are immutable except for one-way invalidation';
    END IF;
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'AI recommendations cannot be deleted';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_ai_recommendation_immutable
    BEFORE UPDATE OR DELETE ON ai_recommendation
    FOR EACH ROW EXECUTE FUNCTION protect_ai_recommendation();
CREATE TRIGGER trg_ai_recommendation_source_append_only
    BEFORE UPDATE OR DELETE ON ai_recommendation_source
    FOR EACH ROW EXECUTE FUNCTION reject_append_only_mutation();
CREATE TRIGGER trg_ai_decision_append_only
    BEFORE UPDATE OR DELETE ON ai_decision
    FOR EACH ROW EXECUTE FUNCTION reject_append_only_mutation();

DO $$
DECLARE
    table_name TEXT;
BEGIN
    FOREACH table_name IN ARRAY ARRAY[
        'business_day_run', 'daily_operation_snapshot', 'daily_operation_snapshot_metric',
        'action_item', 'notification_delivery', 'ai_request', 'ai_recommendation',
        'ai_recommendation_source', 'ai_decision', 'operation_export_job'
    ] LOOP
        EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', table_name);
        EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', table_name);
        EXECUTE format(
            'CREATE POLICY tenant_isolation ON %I USING (tenant_id = nullif(current_setting(''app.tenant_id'', true), '''')::uuid) WITH CHECK (tenant_id = nullif(current_setting(''app.tenant_id'', true), '''')::uuid)',
            table_name
        );
    END LOOP;
END $$;

CREATE TRIGGER trg_business_day_run_updated_at
    BEFORE UPDATE ON business_day_run FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_action_item_updated_at
    BEFORE UPDATE ON action_item FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_notification_delivery_updated_at
    BEFORE UPDATE ON notification_delivery FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_ai_request_updated_at
    BEFORE UPDATE ON ai_request FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_operation_export_job_updated_at
    BEFORE UPDATE ON operation_export_job FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'hotel_ai_os_app') THEN
        GRANT SELECT, INSERT, UPDATE, DELETE ON
            business_day_run, daily_operation_snapshot, daily_operation_snapshot_metric,
            action_item, notification_delivery, ai_request, ai_recommendation,
            ai_recommendation_source, ai_decision, operation_export_job
        TO hotel_ai_os_app;
        REVOKE UPDATE, DELETE ON ai_recommendation_source, ai_decision FROM hotel_ai_os_app;
    END IF;
END $$;
