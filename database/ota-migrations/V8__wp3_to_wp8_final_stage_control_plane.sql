-- WP3-WP8 final-stage control plane.
-- This migration adds governance and evidence records only. It does not enable
-- external PMS/OTA access, WeCom delivery, model calls, or channel writes.

CREATE TABLE ota.data_retention_policy_version (
    tenant_id UUID NOT NULL,
    policy_version_id UUID NOT NULL,
    version_no BIGINT NOT NULL CHECK (version_no > 0),
    data_class VARCHAR(48) NOT NULL CHECK (data_class IN (
        'STANDARD_OPERATING_FACT', 'DERIVED_METRIC', 'BRIEF_AI_ALERT_TASK',
        'PRICE_AND_AUDIT', 'REDACTED_RAW_EVIDENCE'
    )),
    retention_days INTEGER NOT NULL CHECK (
        (data_class = 'REDACTED_RAW_EVIDENCE' AND retention_days = 30)
        OR (data_class <> 'REDACTED_RAW_EVIDENCE' AND retention_days = 365)
    ),
    legal_hold_supported BOOLEAN NOT NULL DEFAULT TRUE CHECK (legal_hold_supported),
    cold_archive_allowed BOOLEAN NOT NULL DEFAULT FALSE CHECK (NOT cold_archive_allowed),
    effective_from TIMESTAMPTZ NOT NULL,
    reason_code VARCHAR(64) NOT NULL CHECK (reason_code ~ '^[A-Z][A-Z0-9_]{2,63}$'),
    created_by_account_id UUID NOT NULL REFERENCES control.auth_account(account_id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (tenant_id, policy_version_id),
    UNIQUE (tenant_id, data_class, version_no)
);

CREATE TABLE ota.data_quality_event (
    tenant_id UUID NOT NULL,
    hotel_id UUID NOT NULL,
    quality_event_id UUID NOT NULL,
    connector_id UUID,
    run_id UUID,
    quality_code VARCHAR(48) NOT NULL CHECK (quality_code IN (
        'COMPLETE', 'PARTIAL', 'UNAVAILABLE', 'STALE', 'DUPLICATE_SUPPRESSED',
        'GOLDEN_SAMPLE_MATCH', 'GOLDEN_SAMPLE_MISMATCH', 'RECOVERY_VERIFYING'
    )),
    severity VARCHAR(8) NOT NULL CHECK (severity IN ('P1', 'P2', 'P3', 'INFO')),
    source_cutoff_at TIMESTAMPTZ,
    observed_at TIMESTAMPTZ NOT NULL,
    evidence_hash VARCHAR(64) NOT NULL CHECK (evidence_hash ~ '^[A-Fa-f0-9]{64}$'),
    detail JSONB NOT NULL DEFAULT '{}'::JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (tenant_id, hotel_id, quality_event_id),
    FOREIGN KEY (tenant_id, hotel_id) REFERENCES ota.hotel(tenant_id, hotel_id),
    FOREIGN KEY (tenant_id, hotel_id, connector_id)
        REFERENCES ota.hotel_source_connector(tenant_id, hotel_id, connector_id),
    FOREIGN KEY (tenant_id, hotel_id, run_id)
        REFERENCES ota.connector_collection_run(tenant_id, hotel_id, run_id),
    CHECK (jsonb_typeof(detail) = 'object'),
    CHECK (NOT control.jsonb_contains_forbidden_secret_key(detail))
);

CREATE TABLE ota.safe_deep_link_policy_version (
    tenant_id UUID NOT NULL,
    hotel_id UUID NOT NULL,
    deep_link_policy_id UUID NOT NULL,
    channel_code VARCHAR(48) NOT NULL CHECK (channel_code ~ '^[A-Z][A-Z0-9_]{1,47}$'),
    version_no BIGINT NOT NULL CHECK (version_no > 0),
    https_host VARCHAR(253) NOT NULL CHECK (
        https_host = lower(https_host)
        AND https_host ~ '^[a-z0-9][a-z0-9.-]{1,251}[a-z0-9]$'
    ),
    allowed_path_prefix VARCHAR(256) NOT NULL CHECK (
        allowed_path_prefix ~ '^/[A-Za-z0-9/_-]*$'
        AND allowed_path_prefix !~ '\.\.'
    ),
    query_string_allowed BOOLEAN NOT NULL DEFAULT FALSE CHECK (NOT query_string_allowed),
    enabled BOOLEAN NOT NULL DEFAULT FALSE,
    approved_by_account_id UUID REFERENCES control.auth_account(account_id),
    approved_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (tenant_id, hotel_id, deep_link_policy_id),
    FOREIGN KEY (tenant_id, hotel_id) REFERENCES ota.hotel(tenant_id, hotel_id),
    UNIQUE (tenant_id, hotel_id, channel_code, version_no),
    CHECK ((enabled AND approved_by_account_id IS NOT NULL AND approved_at IS NOT NULL) OR NOT enabled)
);

CREATE TABLE ota.ota_platform_alert (
    tenant_id UUID NOT NULL,
    hotel_id UUID NOT NULL,
    alert_id UUID NOT NULL,
    channel_code VARCHAR(48) NOT NULL CHECK (channel_code ~ '^[A-Z][A-Z0-9_]{1,47}$'),
    metric_code VARCHAR(64) NOT NULL CHECK (metric_code ~ '^[A-Z][A-Z0-9_]{2,63}$'),
    severity VARCHAR(8) NOT NULL CHECK (severity IN ('P1', 'P2', 'P3')),
    policy_version_no BIGINT NOT NULL CHECK (policy_version_no > 0),
    metric_window_from TIMESTAMPTZ NOT NULL,
    metric_window_to TIMESTAMPTZ NOT NULL,
    source_cutoff_at TIMESTAMPTZ NOT NULL,
    data_quality_code VARCHAR(24) NOT NULL CHECK (data_quality_code IN (
        'COMPLETE', 'PARTIAL', 'UNAVAILABLE', 'STALE'
    )),
    evidence_hash VARCHAR(64) NOT NULL CHECK (evidence_hash ~ '^[A-Fa-f0-9]{64}$'),
    summary_code VARCHAR(96) NOT NULL CHECK (summary_code ~ '^[A-Z][A-Z0-9_]{2,95}$'),
    deep_link_policy_id UUID,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (tenant_id, hotel_id, alert_id),
    FOREIGN KEY (tenant_id, hotel_id) REFERENCES ota.hotel(tenant_id, hotel_id),
    FOREIGN KEY (tenant_id, hotel_id, deep_link_policy_id)
        REFERENCES ota.safe_deep_link_policy_version(tenant_id, hotel_id, deep_link_policy_id),
    CHECK (metric_window_to > metric_window_from),
    CHECK (source_cutoff_at >= metric_window_to)
);

CREATE TABLE ota.ota_platform_alert_event (
    tenant_id UUID NOT NULL,
    hotel_id UUID NOT NULL,
    alert_id UUID NOT NULL,
    alert_event_id UUID NOT NULL,
    event_type VARCHAR(32) NOT NULL CHECK (event_type IN (
        'OPENED', 'ASSIGNED', 'ACKNOWLEDGED', 'REMEDIATED', 'REVIEWED', 'CLOSED', 'ESCALATED'
    )),
    actor_account_id UUID REFERENCES control.auth_account(account_id),
    reason_code VARCHAR(64) NOT NULL CHECK (reason_code ~ '^[A-Z][A-Z0-9_]{2,63}$'),
    evidence_hash VARCHAR(64) CHECK (evidence_hash ~ '^[A-Fa-f0-9]{64}$'),
    occurred_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (tenant_id, hotel_id, alert_id, alert_event_id),
    FOREIGN KEY (tenant_id, hotel_id, alert_id)
        REFERENCES ota.ota_platform_alert(tenant_id, hotel_id, alert_id),
    CHECK (event_type <> 'CLOSED' OR evidence_hash IS NOT NULL)
);

CREATE TABLE ota.alert_notification_intent (
    tenant_id UUID NOT NULL,
    hotel_id UUID NOT NULL,
    notification_intent_id UUID NOT NULL,
    alert_id UUID NOT NULL,
    severity VARCHAR(8) NOT NULL CHECK (severity IN ('P1', 'P2', 'P3')),
    route_code VARCHAR(32) NOT NULL CHECK (
        (severity IN ('P1', 'P2') AND route_code = 'IN_APP_AND_WECOM')
        OR (severity = 'P3' AND route_code = 'DAILY_WECOM_SUMMARY')
    ),
    delivery_scope VARCHAR(16) NOT NULL DEFAULT 'UAT_ONLY' CHECK (delivery_scope = 'UAT_ONLY'),
    external_delivery_allowed BOOLEAN NOT NULL DEFAULT FALSE CHECK (NOT external_delivery_allowed),
    stage_code VARCHAR(32) NOT NULL CHECK (stage_code IN (
        'FIRST_NOTICE', 'SLA_ESCALATION', 'DAILY_SUMMARY'
    )),
    idempotency_key VARCHAR(200) NOT NULL CHECK (btrim(idempotency_key) <> ''),
    payload_hash VARCHAR(64) NOT NULL CHECK (payload_hash ~ '^[A-Fa-f0-9]{64}$'),
    scheduled_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (tenant_id, hotel_id, notification_intent_id),
    FOREIGN KEY (tenant_id, hotel_id, alert_id)
        REFERENCES ota.ota_platform_alert(tenant_id, hotel_id, alert_id),
    UNIQUE (tenant_id, hotel_id, alert_id, stage_code, idempotency_key),
    CHECK (
        (severity IN ('P1', 'P2') AND stage_code IN ('FIRST_NOTICE', 'SLA_ESCALATION'))
        OR (severity = 'P3' AND stage_code = 'DAILY_SUMMARY')
    )
);

CREATE TABLE ota.hotel_ai_policy_version (
    tenant_id UUID NOT NULL,
    hotel_id UUID NOT NULL,
    ai_policy_id UUID NOT NULL,
    version_no BIGINT NOT NULL CHECK (version_no > 0),
    scheduled_brief_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    p1_explanation_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    p2_explanation_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    p3_daily_summary_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    p3_manual_invocation_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    model_profile_code VARCHAR(64) NOT NULL CHECK (model_profile_code ~ '^[A-Z][A-Z0-9_]{2,63}$'),
    prompt_version VARCHAR(64) NOT NULL CHECK (prompt_version ~ '^[A-Za-z0-9._-]{1,64}$'),
    daily_call_limit INTEGER NOT NULL CHECK (daily_call_limit BETWEEN 0 AND 1000),
    deterministic_fallback_required BOOLEAN NOT NULL DEFAULT TRUE CHECK (deterministic_fallback_required),
    enabled_from TIMESTAMPTZ NOT NULL,
    created_by_account_id UUID NOT NULL REFERENCES control.auth_account(account_id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (tenant_id, hotel_id, ai_policy_id),
    FOREIGN KEY (tenant_id, hotel_id) REFERENCES ota.hotel(tenant_id, hotel_id),
    UNIQUE (tenant_id, hotel_id, version_no)
);

CREATE TABLE ota.ai_advice_evaluation (
    tenant_id UUID NOT NULL,
    hotel_id UUID NOT NULL,
    evaluation_id UUID NOT NULL,
    ai_policy_id UUID NOT NULL,
    input_facts_hash VARCHAR(64) NOT NULL CHECK (input_facts_hash ~ '^[A-Fa-f0-9]{64}$'),
    output_hash VARCHAR(64) NOT NULL CHECK (output_hash ~ '^[A-Fa-f0-9]{64}$'),
    grounded BOOLEAN NOT NULL,
    pii_free BOOLEAN NOT NULL,
    action_schema_valid BOOLEAN NOT NULL,
    fallback_used BOOLEAN NOT NULL,
    model_invoked BOOLEAN NOT NULL,
    evaluated_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (tenant_id, hotel_id, evaluation_id),
    FOREIGN KEY (tenant_id, hotel_id, ai_policy_id)
        REFERENCES ota.hotel_ai_policy_version(tenant_id, hotel_id, ai_policy_id),
    CHECK (model_invoked OR fallback_used)
);

CREATE TABLE ota.price_change_preview (
    tenant_id UUID NOT NULL,
    hotel_id UUID NOT NULL,
    preview_id UUID NOT NULL,
    channel_code VARCHAR(48) NOT NULL CHECK (channel_code ~ '^[A-Z][A-Z0-9_]{1,47}$'),
    connector_id UUID NOT NULL,
    room_mapping_version_id UUID NOT NULL,
    source_room_code_hash VARCHAR(64) NOT NULL CHECK (source_room_code_hash ~ '^[A-Fa-f0-9]{64}$'),
    price_date DATE NOT NULL,
    rate_type VARCHAR(32) NOT NULL DEFAULT 'STANDARD_RETAIL' CHECK (rate_type = 'STANDARD_RETAIL'),
    current_price NUMERIC(12,2) NOT NULL CHECK (current_price >= 0),
    proposed_price NUMERIC(12,2) NOT NULL CHECK (proposed_price >= 0),
    recommended_min NUMERIC(12,2) NOT NULL CHECK (recommended_min >= 0),
    recommended_max NUMERIC(12,2) NOT NULL CHECK (recommended_max >= recommended_min),
    within_recommended_range BOOLEAN NOT NULL,
    authorization_evidence_hash VARCHAR(64) CHECK (authorization_evidence_hash ~ '^[A-Fa-f0-9]{64}$'),
    write_uat_evidence_hash VARCHAR(64) CHECK (write_uat_evidence_hash ~ '^[A-Fa-f0-9]{64}$'),
    mapping_hash VARCHAR(64) NOT NULL CHECK (mapping_hash ~ '^[A-Fa-f0-9]{64}$'),
    policy_hash VARCHAR(64) NOT NULL CHECK (policy_hash ~ '^[A-Fa-f0-9]{64}$'),
    generated_by_account_id UUID NOT NULL REFERENCES control.auth_account(account_id),
    generated_at TIMESTAMPTZ NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    external_execution_allowed BOOLEAN NOT NULL DEFAULT FALSE CHECK (NOT external_execution_allowed),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (tenant_id, hotel_id, preview_id),
    FOREIGN KEY (tenant_id, hotel_id, connector_id)
        REFERENCES ota.hotel_source_connector(tenant_id, hotel_id, connector_id),
    CHECK (within_recommended_range = (proposed_price BETWEEN recommended_min AND recommended_max)),
    CHECK (expires_at > generated_at)
);

CREATE TABLE ota.price_change_request (
    tenant_id UUID NOT NULL,
    hotel_id UUID NOT NULL,
    price_request_id UUID NOT NULL,
    preview_id UUID NOT NULL,
    requested_by_account_id UUID NOT NULL REFERENCES control.auth_account(account_id),
    approved_by_account_id UUID REFERENCES control.auth_account(account_id),
    state VARCHAR(32) NOT NULL CHECK (state IN (
        'SUBMITTED', 'APPROVED_PENDING_SYNC', 'PREFLIGHT_REJECTED', 'EXECUTION_DISABLED',
        'UNKNOWN_MANUAL_REVIEW', 'READBACK_MISMATCH', 'VERIFIED', 'CANCELLED'
    )),
    idempotency_key VARCHAR(200) NOT NULL CHECK (btrim(idempotency_key) <> ''),
    request_hash VARCHAR(64) NOT NULL CHECK (request_hash ~ '^[A-Fa-f0-9]{64}$'),
    requested_at TIMESTAMPTZ NOT NULL,
    approved_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (tenant_id, hotel_id, price_request_id),
    FOREIGN KEY (tenant_id, hotel_id, preview_id)
        REFERENCES ota.price_change_preview(tenant_id, hotel_id, preview_id),
    UNIQUE (tenant_id, hotel_id, idempotency_key),
    CHECK (approved_by_account_id IS NULL OR approved_by_account_id <> requested_by_account_id),
    CHECK ((approved_at IS NULL) = (approved_by_account_id IS NULL))
);

CREATE TABLE ota.price_change_event (
    tenant_id UUID NOT NULL,
    hotel_id UUID NOT NULL,
    price_request_id UUID NOT NULL,
    price_event_id UUID NOT NULL,
    event_type VARCHAR(40) NOT NULL CHECK (event_type IN (
        'SUBMITTED', 'APPROVED_AND_SYNC_REQUESTED', 'PREFLIGHT_PASSED', 'PREFLIGHT_REJECTED',
        'EXECUTION_DISABLED', 'WRITE_ACCEPTED', 'WRITE_TIMEOUT_UNKNOWN', 'READBACK_VERIFIED',
        'READBACK_MISMATCH', 'MANUAL_RESOLUTION_REQUIRED', 'ROLLBACK_REQUEST_CREATED'
    )),
    actor_account_id UUID REFERENCES control.auth_account(account_id),
    evidence_hash VARCHAR(64) NOT NULL CHECK (evidence_hash ~ '^[A-Fa-f0-9]{64}$'),
    occurred_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (tenant_id, hotel_id, price_request_id, price_event_id),
    FOREIGN KEY (tenant_id, hotel_id, price_request_id)
        REFERENCES ota.price_change_request(tenant_id, hotel_id, price_request_id)
);

CREATE TABLE ota.all_store_uat_run (
    tenant_id UUID NOT NULL,
    uat_run_id UUID NOT NULL,
    scope_hash VARCHAR(64) NOT NULL CHECK (scope_hash ~ '^[A-Fa-f0-9]{64}$'),
    planned_business_days INTEGER NOT NULL DEFAULT 7 CHECK (planned_business_days = 7),
    mode VARCHAR(24) NOT NULL DEFAULT 'READ_ONLY_SHADOW' CHECK (mode = 'READ_ONLY_SHADOW'),
    external_write_allowed BOOLEAN NOT NULL DEFAULT FALSE CHECK (NOT external_write_allowed),
    wecom_scope VARCHAR(16) NOT NULL DEFAULT 'UAT_ONLY' CHECK (wecom_scope = 'UAT_ONLY'),
    state VARCHAR(24) NOT NULL CHECK (state IN ('PLANNED', 'RUNNING', 'EVIDENCE_REVIEW', 'COMPLETED')),
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (tenant_id, uat_run_id),
    CHECK (completed_at IS NULL OR (started_at IS NOT NULL AND completed_at >= started_at))
);

CREATE TABLE ota.all_store_uat_daily_evidence (
    tenant_id UUID NOT NULL,
    hotel_id UUID NOT NULL,
    uat_run_id UUID NOT NULL,
    business_date DATE NOT NULL,
    connector_coverage_percent NUMERIC(5,2) NOT NULL CHECK (connector_coverage_percent BETWEEN 0 AND 100),
    scheduled_collection_success_percent NUMERIC(5,2) NOT NULL CHECK (scheduled_collection_success_percent BETWEEN 0 AND 100),
    critical_window_complete BOOLEAN NOT NULL,
    golden_sample_result VARCHAR(24) NOT NULL CHECK (golden_sample_result IN ('PASS', 'FAIL', 'PENDING')),
    duplicate_delivery_count INTEGER NOT NULL DEFAULT 0 CHECK (duplicate_delivery_count >= 0),
    pii_finding_count INTEGER NOT NULL DEFAULT 0 CHECK (pii_finding_count >= 0),
    evidence_hash VARCHAR(64) NOT NULL CHECK (evidence_hash ~ '^[A-Fa-f0-9]{64}$'),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (tenant_id, hotel_id, uat_run_id, business_date),
    FOREIGN KEY (tenant_id, hotel_id) REFERENCES ota.hotel(tenant_id, hotel_id),
    FOREIGN KEY (tenant_id, uat_run_id) REFERENCES ota.all_store_uat_run(tenant_id, uat_run_id)
);

CREATE TABLE ota.hotel_release_decision (
    tenant_id UUID NOT NULL,
    hotel_id UUID NOT NULL,
    uat_run_id UUID NOT NULL,
    release_decision_id UUID NOT NULL,
    decision VARCHAR(24) NOT NULL CHECK (decision IN ('KEEP_EXISTING_SERVICE', 'READY_FOR_RELEASE', 'ROLLED_BACK')),
    evidence_days INTEGER NOT NULL CHECK (evidence_days BETWEEN 0 AND 7),
    success_rate_percent NUMERIC(5,2) CHECK (success_rate_percent BETWEEN 0 AND 100),
    gate_passed BOOLEAN NOT NULL,
    signed_by_account_id UUID REFERENCES control.auth_account(account_id),
    signed_at TIMESTAMPTZ,
    reason_code VARCHAR(64) NOT NULL CHECK (reason_code ~ '^[A-Z][A-Z0-9_]{2,63}$'),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (tenant_id, hotel_id, release_decision_id),
    FOREIGN KEY (tenant_id, hotel_id) REFERENCES ota.hotel(tenant_id, hotel_id),
    FOREIGN KEY (tenant_id, uat_run_id) REFERENCES ota.all_store_uat_run(tenant_id, uat_run_id),
    CHECK (
        (decision = 'READY_FOR_RELEASE' AND gate_passed AND evidence_days = 7
            AND success_rate_percent >= 99 AND signed_by_account_id IS NOT NULL AND signed_at IS NOT NULL)
        OR decision <> 'READY_FOR_RELEASE'
    )
);

CREATE VIEW ota.anomaly_first_dashboard
WITH (security_invoker = true)
AS
SELECT alert.tenant_id,
       alert.hotel_id,
       'OTA_PLATFORM_ALERT'::TEXT AS item_type,
       alert.alert_id AS item_id,
       CASE alert.severity WHEN 'P1' THEN 1 WHEN 'P2' THEN 2 ELSE 3 END AS priority_no,
       alert.severity,
       alert.channel_code,
       alert.metric_code,
       alert.source_cutoff_at,
       alert.data_quality_code,
       COALESCE(latest.event_type, 'OPENED') AS current_state,
       alert.created_at AS detected_at
  FROM ota.ota_platform_alert AS alert
  LEFT JOIN LATERAL (
      SELECT event.event_type
        FROM ota.ota_platform_alert_event AS event
       WHERE event.tenant_id = alert.tenant_id
         AND event.hotel_id = alert.hotel_id
         AND event.alert_id = alert.alert_id
       ORDER BY event.occurred_at DESC, event.alert_event_id DESC
       LIMIT 1
  ) AS latest ON TRUE
 WHERE COALESCE(latest.event_type, 'OPENED') <> 'CLOSED';

COMMENT ON VIEW ota.anomaly_first_dashboard IS
    'RLS-invoker read model ordered by P1/P2/P3. Missing operating facts are not synthesized as numeric zero.';

-- Append-only evidence and policy versions. Operational transitions are new
-- events/versions, never destructive edits of history.
DO $append_only$
DECLARE
    relation_name TEXT;
BEGIN
    FOREACH relation_name IN ARRAY ARRAY[
        'data_retention_policy_version', 'data_quality_event',
        'safe_deep_link_policy_version', 'ota_platform_alert',
        'ota_platform_alert_event', 'alert_notification_intent',
        'hotel_ai_policy_version', 'ai_advice_evaluation',
        'price_change_preview', 'price_change_event',
        'all_store_uat_daily_evidence', 'hotel_release_decision'
    ]
    LOOP
        EXECUTE format(
            'CREATE TRIGGER trg_%I_append_only BEFORE UPDATE OR DELETE ON ota.%I '
            'FOR EACH ROW EXECUTE FUNCTION control.reject_append_only_mutation()',
            relation_name,
            relation_name
        );
    END LOOP;
END
$append_only$;

DO $rls$
DECLARE
    relation_name TEXT;
BEGIN
    FOREACH relation_name IN ARRAY ARRAY[
        'data_retention_policy_version', 'data_quality_event',
        'safe_deep_link_policy_version', 'ota_platform_alert',
        'ota_platform_alert_event', 'alert_notification_intent',
        'hotel_ai_policy_version', 'ai_advice_evaluation',
        'price_change_preview', 'price_change_request', 'price_change_event',
        'all_store_uat_run', 'all_store_uat_daily_evidence', 'hotel_release_decision'
    ]
    LOOP
        EXECUTE format('ALTER TABLE ota.%I ENABLE ROW LEVEL SECURITY', relation_name);
        EXECUTE format('ALTER TABLE ota.%I FORCE ROW LEVEL SECURITY', relation_name);
        EXECUTE format(
            'CREATE POLICY tenant_isolation ON ota.%I '
            'USING (tenant_id = control.current_tenant_id()) '
            'WITH CHECK (tenant_id = control.current_tenant_id())',
            relation_name
        );
        EXECUTE format('REVOKE ALL ON TABLE ota.%I FROM PUBLIC', relation_name);
    END LOOP;
END
$rls$;

COMMENT ON TABLE ota.alert_notification_intent IS
    'P1 and P2 always route to in-app plus WeCom intent; P3 is one daily WeCom summary. V8 remains UAT-only and performs no external delivery.';
COMMENT ON TABLE ota.price_change_preview IS
    'Immutable standard-retail preview. V8 deliberately constrains external execution false until formal write authorization and write-UAT evidence are installed through a later controlled enablement.';
COMMENT ON TABLE ota.hotel_release_decision IS
    'A failed hotel stays on the existing service; only seven evidence days, >=99% success and OTA operations manager sign-off can mark it ready.';
