-- OTA-AUTOMATION-V0.1 / Sprint 0
-- Independent PostgreSQL security and control-plane foundation.
-- This migration intentionally contains no pilot hotel seed, connector data,
-- hourly analysis logic, real credentials, webhook URLs, or production role DDL.

CREATE SCHEMA control;
CREATE SCHEMA ota;

REVOKE ALL ON SCHEMA control FROM PUBLIC;
REVOKE ALL ON SCHEMA ota FROM PUBLIC;

CREATE FUNCTION control.current_tenant_id()
RETURNS UUID
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = pg_catalog
AS $$
DECLARE
    configured_tenant TEXT;
BEGIN
    configured_tenant := current_setting('app.tenant_id', true);
    IF configured_tenant IS NULL OR btrim(configured_tenant) = '' THEN
        RETURN NULL;
    END IF;

    BEGIN
        RETURN configured_tenant::UUID;
    EXCEPTION
        WHEN invalid_text_representation THEN
            -- Fail closed: a malformed tenant context must never broaden access.
            RETURN NULL;
    END;
END;
$$;

CREATE FUNCTION control.reject_append_only_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog
AS $$
BEGIN
    RAISE EXCEPTION USING
        ERRCODE = '55000',
        MESSAGE = format('%I.%I is append-only; %s is forbidden', TG_TABLE_SCHEMA, TG_TABLE_NAME, TG_OP);
END;
$$;

CREATE FUNCTION control.jsonb_contains_forbidden_secret_key(document JSONB)
RETURNS BOOLEAN
LANGUAGE plpgsql
IMMUTABLE
STRICT
SECURITY INVOKER
SET search_path = pg_catalog
AS $$
DECLARE
    item RECORD;
    normalized_key TEXT;
    element JSONB;
    forbidden_fragment TEXT;
    forbidden_fragments CONSTANT TEXT[] := ARRAY[
        'password', 'passphrase', 'secret', 'token', 'cookie', 'credential',
        'authorization', 'header', 'webhook', 'apikey', 'connectionstring',
        'privatekey', 'userinfo', 'bearer', 'session', 'username', 'loginname',
        'accesskey', 'jdbcurl', 'dsn', 'verificationcode', 'otp', 'captcha'
    ];
    allowed_reference_metadata_keys CONSTANT TEXT[] := ARRAY[
        'secretref', 'secretreference', 'secretid', 'secretfingerprint',
        'secretprovider', 'secretversion', 'provider', 'providercode',
        'version', 'versionno', 'keyversion', 'referenceid', 'fingerprint'
    ];
BEGIN
    IF jsonb_typeof(document) = 'object' THEN
        FOR item IN SELECT key, value FROM jsonb_each(document)
        LOOP
            normalized_key := regexp_replace(lower(item.key), '[^a-z0-9]', '', 'g');
            IF NOT normalized_key = ANY (allowed_reference_metadata_keys) THEN
                FOREACH forbidden_fragment IN ARRAY forbidden_fragments
                LOOP
                    IF position(forbidden_fragment IN normalized_key) > 0 THEN
                        RETURN TRUE;
                    END IF;
                END LOOP;
            END IF;
            IF control.jsonb_contains_forbidden_secret_key(item.value) THEN
                RETURN TRUE;
            END IF;
        END LOOP;
    ELSIF jsonb_typeof(document) = 'array' THEN
        FOR element IN SELECT value FROM jsonb_array_elements(document)
        LOOP
            IF control.jsonb_contains_forbidden_secret_key(element) THEN
                RETURN TRUE;
            END IF;
        END LOOP;
    END IF;

    RETURN FALSE;
END;
$$;

COMMENT ON FUNCTION control.current_tenant_id() IS
    'Returns the single transaction-scoped app.tenant_id, or NULL when absent/malformed (fail closed).';
COMMENT ON FUNCTION control.jsonb_contains_forbidden_secret_key(JSONB) IS
    'Normalizes JSON keys and rejects sensitive fragments recursively; only exact opaque-reference metadata keys are exempt.';

CREATE TABLE control.tenant_directory (
    tenant_id UUID PRIMARY KEY,
    tenant_code VARCHAR(64) NOT NULL UNIQUE,
    display_name VARCHAR(160) NOT NULL,
    default_timezone VARCHAR(64) NOT NULL DEFAULT 'Asia/Shanghai',
    status VARCHAR(24) NOT NULL DEFAULT 'DRAFT'
        CHECK (status IN ('DRAFT', 'ACTIVE', 'SUSPENDED')),
    row_version BIGINT NOT NULL DEFAULT 0 CHECK (row_version >= 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CHECK (btrim(tenant_code) <> ''),
    CHECK (btrim(display_name) <> '')
);

COMMENT ON TABLE control.tenant_directory IS
    'Global control-plane directory. It contains no hotel operating facts and is accessed only by narrow directory/job components.';

CREATE TABLE control.auth_account (
    account_id UUID PRIMARY KEY,
    login_name VARCHAR(160) NOT NULL,
    display_name VARCHAR(160) NOT NULL,
    status VARCHAR(24) NOT NULL DEFAULT 'ACTIVE'
        CHECK (status IN ('INVITED', 'ACTIVE', 'LOCKED', 'DISABLED')),
    authz_version BIGINT NOT NULL DEFAULT 1 CHECK (authz_version > 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (login_name),
    CHECK (btrim(login_name) <> ''),
    CHECK (btrim(display_name) <> '')
);

CREATE TABLE control.auth_identity (
    identity_id UUID PRIMARY KEY,
    account_id UUID NOT NULL REFERENCES control.auth_account(account_id),
    provider_type VARCHAR(24) NOT NULL CHECK (provider_type IN ('LOCAL_PILOT', 'OIDC')),
    issuer VARCHAR(255) NOT NULL,
    subject VARCHAR(255) NOT NULL,
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    disabled_at TIMESTAMPTZ,
    UNIQUE (issuer, subject),
    CHECK (btrim(issuer) <> ''),
    CHECK (btrim(subject) <> ''),
    CHECK (disabled_at IS NULL OR NOT enabled)
);

CREATE TABLE control.auth_credential (
    credential_id UUID PRIMARY KEY,
    account_id UUID NOT NULL REFERENCES control.auth_account(account_id),
    password_hash TEXT NOT NULL,
    algorithm_code VARCHAR(32) NOT NULL,
    algorithm_version VARCHAR(32) NOT NULL,
    failed_attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (failed_attempt_count >= 0),
    locked_until TIMESTAMPTZ,
    status VARCHAR(24) NOT NULL DEFAULT 'ACTIVE'
        CHECK (status IN ('ACTIVE', 'RETIRED', 'COMPROMISED')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    retired_at TIMESTAMPTZ,
    CHECK (length(password_hash) >= 32),
    CHECK (upper(algorithm_code) NOT IN ('PLAIN', 'PLAINTEXT', 'CLEAR', 'NONE')),
    CHECK ((status = 'ACTIVE' AND retired_at IS NULL) OR status <> 'ACTIVE')
);

CREATE UNIQUE INDEX uq_auth_credential_active_account
    ON control.auth_credential(account_id)
    WHERE status = 'ACTIVE';

COMMENT ON COLUMN control.auth_credential.password_hash IS
    'One-way password verifier only (Argon2id or approved equivalent); plaintext is forbidden.';

CREATE TABLE control.auth_session (
    session_id UUID PRIMARY KEY,
    account_id UUID NOT NULL REFERENCES control.auth_account(account_id),
    session_family_id UUID NOT NULL,
    refresh_token_hash VARCHAR(256) NOT NULL UNIQUE,
    authz_version_snapshot BIGINT NOT NULL CHECK (authz_version_snapshot > 0),
    issued_at TIMESTAMPTZ NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    rotated_at TIMESTAMPTZ,
    replaced_by_session_id UUID REFERENCES control.auth_session(session_id),
    revoked_at TIMESTAMPTZ,
    revoke_reason_code VARCHAR(64),
    reuse_detected_at TIMESTAMPTZ,
    user_agent_hash VARCHAR(128),
    source_ip INET,
    CHECK (expires_at > issued_at),
    CHECK (length(refresh_token_hash) >= 32),
    CHECK (replaced_by_session_id IS NULL OR rotated_at IS NOT NULL),
    CHECK (revoked_at IS NOT NULL OR revoke_reason_code IS NULL)
);

COMMENT ON COLUMN control.auth_session.refresh_token_hash IS
    'One-way digest only. Raw refresh/access tokens must never be persisted.';

CREATE INDEX ix_auth_session_account_active
    ON control.auth_session(account_id, expires_at)
    WHERE revoked_at IS NULL;
CREATE INDEX ix_auth_session_family
    ON control.auth_session(session_family_id, issued_at);

CREATE TABLE control.role_definition (
    role_id UUID PRIMARY KEY,
    role_code VARCHAR(64) NOT NULL UNIQUE,
    display_name VARCHAR(120) NOT NULL,
    role_scope VARCHAR(24) NOT NULL CHECK (role_scope IN ('GLOBAL', 'HOTEL_SCOPED')),
    built_in BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CHECK (btrim(role_code) <> '')
);

CREATE TABLE control.permission_definition (
    permission_id UUID PRIMARY KEY,
    permission_code VARCHAR(128) NOT NULL UNIQUE,
    description VARCHAR(255) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CHECK (btrim(permission_code) <> '')
);

CREATE TABLE control.role_permission (
    role_id UUID NOT NULL REFERENCES control.role_definition(role_id),
    permission_id UUID NOT NULL REFERENCES control.permission_definition(permission_id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (role_id, permission_id)
);

CREATE TABLE control.account_role (
    account_role_id UUID PRIMARY KEY,
    account_id UUID NOT NULL REFERENCES control.auth_account(account_id),
    role_id UUID NOT NULL REFERENCES control.role_definition(role_id),
    valid_from TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    valid_until TIMESTAMPTZ,
    granted_by_account_id UUID REFERENCES control.auth_account(account_id),
    grant_reason_code VARCHAR(64) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (account_id, role_id, valid_from),
    CHECK (valid_until IS NULL OR valid_until > valid_from),
    CHECK (btrim(grant_reason_code) <> '')
);

CREATE TABLE control.service_principal (
    service_principal_id UUID PRIMARY KEY,
    principal_code VARCHAR(96) NOT NULL UNIQUE,
    purpose VARCHAR(32) NOT NULL
        CHECK (purpose IN ('API', 'SCHEDULER', 'CONNECTOR_WORKER', 'ANALYSIS', 'DELIVERY')),
    status VARCHAR(24) NOT NULL DEFAULT 'ACTIVE'
        CHECK (status IN ('ACTIVE', 'DISABLED')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    disabled_at TIMESTAMPTZ,
    CHECK (btrim(principal_code) <> ''),
    CHECK (disabled_at IS NULL OR status = 'DISABLED')
);

COMMENT ON TABLE control.service_principal IS
    'Non-interactive workload identity metadata only; runtime credentials are external to PostgreSQL tables.';

CREATE TABLE ota.hotel (
    tenant_id UUID NOT NULL REFERENCES control.tenant_directory(tenant_id),
    hotel_id UUID NOT NULL,
    hotel_code VARCHAR(64) NOT NULL,
    display_name VARCHAR(160) NOT NULL,
    timezone VARCHAR(64) NOT NULL DEFAULT 'Asia/Shanghai',
    lifecycle_status VARCHAR(24) NOT NULL DEFAULT 'DRAFT'
        CHECK (lifecycle_status IN ('DRAFT', 'READY_FOR_TEST', 'SHADOW', 'UAT', 'LIVE', 'PAUSED')),
    collection_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    message_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    row_version BIGINT NOT NULL DEFAULT 0 CHECK (row_version >= 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (tenant_id, hotel_id),
    UNIQUE (tenant_id, hotel_code),
    CHECK (btrim(hotel_code) <> ''),
    CHECK (btrim(display_name) <> ''),
    CHECK (NOT message_enabled OR collection_enabled)
);

CREATE TABLE ota.account_hotel_scope (
    tenant_id UUID NOT NULL,
    hotel_id UUID NOT NULL,
    scope_id UUID NOT NULL,
    account_id UUID NOT NULL REFERENCES control.auth_account(account_id),
    role_code VARCHAR(64) NOT NULL REFERENCES control.role_definition(role_code),
    scope_type VARCHAR(32) NOT NULL,
    valid_from TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    valid_until TIMESTAMPTZ,
    granted_by_account_id UUID REFERENCES control.auth_account(account_id),
    grant_reason_code VARCHAR(64) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (tenant_id, hotel_id, scope_id),
    FOREIGN KEY (tenant_id, hotel_id) REFERENCES ota.hotel(tenant_id, hotel_id),
    UNIQUE (tenant_id, hotel_id, account_id, role_code, valid_from),
    CHECK (
        (role_code = 'REVENUE_MANAGER' AND scope_type = 'REVENUE_CONFIGURATION')
        OR (role_code = 'HOTEL_P1_HANDLER' AND scope_type = 'P1_HANDLING')
    ),
    CHECK (valid_until IS NULL OR valid_until > valid_from),
    CHECK (btrim(grant_reason_code) <> '')
);

CREATE TABLE ota.hotel_duty_roster_version (
    tenant_id UUID NOT NULL,
    hotel_id UUID NOT NULL,
    roster_version_id UUID NOT NULL,
    version_no INTEGER NOT NULL CHECK (version_no > 0),
    status VARCHAR(24) NOT NULL DEFAULT 'DRAFT'
        CHECK (status IN ('DRAFT', 'ACTIVE', 'RETIRED')),
    timezone VARCHAR(64) NOT NULL,
    effective_from TIMESTAMPTZ NOT NULL,
    effective_until TIMESTAMPTZ,
    change_reason_code VARCHAR(64) NOT NULL,
    created_by_account_id UUID NOT NULL REFERENCES control.auth_account(account_id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    activated_at TIMESTAMPTZ,
    PRIMARY KEY (tenant_id, hotel_id, roster_version_id),
    FOREIGN KEY (tenant_id, hotel_id) REFERENCES ota.hotel(tenant_id, hotel_id),
    UNIQUE (tenant_id, hotel_id, version_no),
    CHECK (effective_until IS NULL OR effective_until > effective_from),
    CHECK ((status = 'ACTIVE' AND activated_at IS NOT NULL) OR status <> 'ACTIVE')
);

CREATE TABLE ota.hotel_duty_roster_assignment (
    tenant_id UUID NOT NULL,
    hotel_id UUID NOT NULL,
    roster_version_id UUID NOT NULL,
    assignment_id UUID NOT NULL,
    handler_account_id UUID NOT NULL REFERENCES control.auth_account(account_id),
    priority_no INTEGER NOT NULL CHECK (priority_no > 0),
    shift_start_local TIME NOT NULL,
    shift_end_local TIME NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (tenant_id, hotel_id, roster_version_id, assignment_id),
    FOREIGN KEY (tenant_id, hotel_id, roster_version_id)
        REFERENCES ota.hotel_duty_roster_version(tenant_id, hotel_id, roster_version_id),
    UNIQUE (tenant_id, hotel_id, roster_version_id, priority_no, shift_start_local, shift_end_local)
);

CREATE TABLE ota.hotel_escalation_policy_version (
    tenant_id UUID NOT NULL,
    hotel_id UUID NOT NULL,
    escalation_policy_version_id UUID NOT NULL,
    version_no INTEGER NOT NULL CHECK (version_no > 0),
    status VARCHAR(24) NOT NULL DEFAULT 'DRAFT'
        CHECK (status IN ('DRAFT', 'ACTIVE', 'RETIRED')),
    effective_from TIMESTAMPTZ NOT NULL,
    effective_until TIMESTAMPTZ,
    sla_minutes INTEGER NOT NULL DEFAULT 10 CHECK (sla_minutes > 0),
    change_reason_code VARCHAR(64) NOT NULL,
    created_by_account_id UUID NOT NULL REFERENCES control.auth_account(account_id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    activated_at TIMESTAMPTZ,
    PRIMARY KEY (tenant_id, hotel_id, escalation_policy_version_id),
    FOREIGN KEY (tenant_id, hotel_id) REFERENCES ota.hotel(tenant_id, hotel_id),
    UNIQUE (tenant_id, hotel_id, version_no),
    CHECK (effective_until IS NULL OR effective_until > effective_from),
    CHECK ((status = 'ACTIVE' AND activated_at IS NOT NULL) OR status <> 'ACTIVE')
);

CREATE TABLE ota.hotel_escalation_recipient (
    tenant_id UUID NOT NULL,
    hotel_id UUID NOT NULL,
    escalation_policy_version_id UUID NOT NULL,
    recipient_id UUID NOT NULL,
    account_id UUID NOT NULL REFERENCES control.auth_account(account_id),
    escalation_level INTEGER NOT NULL CHECK (escalation_level > 0),
    recipient_order INTEGER NOT NULL CHECK (recipient_order > 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (tenant_id, hotel_id, escalation_policy_version_id, recipient_id),
    FOREIGN KEY (tenant_id, hotel_id, escalation_policy_version_id)
        REFERENCES ota.hotel_escalation_policy_version(tenant_id, hotel_id, escalation_policy_version_id),
    UNIQUE (tenant_id, hotel_id, escalation_policy_version_id, escalation_level, recipient_order)
);

CREATE TABLE ota.ota_incident (
    tenant_id UUID NOT NULL,
    hotel_id UUID NOT NULL,
    incident_id UUID NOT NULL,
    incident_type VARCHAR(40) NOT NULL
        CHECK (incident_type IN ('INVENTORY_MISMATCH', 'SOURCE_UNAVAILABLE', 'DELIVERY_FAILURE')),
    severity VARCHAR(8) NOT NULL DEFAULT 'P1' CHECK (severity = 'P1'),
    source_code VARCHAR(32),
    direction_code VARCHAR(48),
    correlation_key VARCHAR(255) NOT NULL,
    status VARCHAR(32) NOT NULL DEFAULT 'OPEN'
        CHECK (status IN ('OPEN', 'ACKNOWLEDGED', 'RECOVERY_VERIFYING', 'RESOLVED', 'REPLACED')),
    opened_at TIMESTAMPTZ NOT NULL,
    last_observed_at TIMESTAMPTZ NOT NULL,
    acknowledged_at TIMESTAMPTZ,
    resolved_at TIMESTAMPTZ,
    resolution_code VARCHAR(64),
    replaced_by_incident_id UUID,
    row_version BIGINT NOT NULL DEFAULT 0 CHECK (row_version >= 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (tenant_id, hotel_id, incident_id),
    FOREIGN KEY (tenant_id, hotel_id) REFERENCES ota.hotel(tenant_id, hotel_id),
    FOREIGN KEY (tenant_id, hotel_id, replaced_by_incident_id)
        REFERENCES ota.ota_incident(tenant_id, hotel_id, incident_id),
    CHECK (btrim(correlation_key) <> ''),
    CHECK (last_observed_at >= opened_at),
    CHECK ((status IN ('RESOLVED', 'REPLACED') AND resolved_at IS NOT NULL) OR status NOT IN ('RESOLVED', 'REPLACED')),
    CHECK ((status = 'REPLACED' AND replaced_by_incident_id IS NOT NULL) OR status <> 'REPLACED')
);

CREATE UNIQUE INDEX uq_ota_incident_active_correlation
    ON ota.ota_incident(tenant_id, hotel_id, incident_type, correlation_key)
    WHERE status IN ('OPEN', 'ACKNOWLEDGED', 'RECOVERY_VERIFYING');
CREATE INDEX ix_ota_incident_hotel_status
    ON ota.ota_incident(tenant_id, hotel_id, status, opened_at DESC);

CREATE TABLE ota.ota_incident_occurrence (
    tenant_id UUID NOT NULL,
    hotel_id UUID NOT NULL,
    incident_id UUID NOT NULL,
    occurrence_id UUID NOT NULL,
    occurrence_type VARCHAR(40) NOT NULL
        CHECK (occurrence_type IN ('DETECTED', 'CONTINUED', 'DIRECTION_REVERSED', 'SUSPENDED', 'RECOVERY_CHECK', 'RECOVERED', 'REPLACED')),
    occurred_at TIMESTAMPTZ NOT NULL,
    source_observed_at TIMESTAMPTZ,
    evidence_hash VARCHAR(128),
    evidence_ref VARCHAR(512),
    correlation_id UUID,
    causation_id UUID,
    actor_service_principal_id UUID REFERENCES control.service_principal(service_principal_id),
    event_data JSONB NOT NULL DEFAULT '{}'::JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (tenant_id, hotel_id, incident_id, occurrence_id),
    FOREIGN KEY (tenant_id, hotel_id, incident_id)
        REFERENCES ota.ota_incident(tenant_id, hotel_id, incident_id),
    CHECK (NOT control.jsonb_contains_forbidden_secret_key(event_data))
);

CREATE TABLE ota.ota_task (
    tenant_id UUID NOT NULL,
    hotel_id UUID NOT NULL,
    task_id UUID NOT NULL,
    incident_id UUID NOT NULL,
    task_type VARCHAR(40) NOT NULL DEFAULT 'P1_RESPONSE' CHECK (task_type = 'P1_RESPONSE'),
    status VARCHAR(32) NOT NULL DEFAULT 'OPEN'
        CHECK (status IN ('OPEN', 'IN_PROGRESS', 'ESCALATED', 'RESOLVED', 'CLOSED', 'CANCELLED')),
    assigned_account_id UUID REFERENCES control.auth_account(account_id),
    duty_roster_version_id UUID,
    escalation_policy_version_id UUID,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    sla_due_at TIMESTAMPTZ NOT NULL,
    acknowledged_at TIMESTAMPTZ,
    resolved_at TIMESTAMPTZ,
    resolution_code VARCHAR(64),
    row_version BIGINT NOT NULL DEFAULT 0 CHECK (row_version >= 0),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (tenant_id, hotel_id, task_id),
    FOREIGN KEY (tenant_id, hotel_id) REFERENCES ota.hotel(tenant_id, hotel_id),
    FOREIGN KEY (tenant_id, hotel_id, incident_id)
        REFERENCES ota.ota_incident(tenant_id, hotel_id, incident_id),
    FOREIGN KEY (tenant_id, hotel_id, duty_roster_version_id)
        REFERENCES ota.hotel_duty_roster_version(tenant_id, hotel_id, roster_version_id),
    FOREIGN KEY (tenant_id, hotel_id, escalation_policy_version_id)
        REFERENCES ota.hotel_escalation_policy_version(tenant_id, hotel_id, escalation_policy_version_id),
    CHECK (sla_due_at > created_at),
    CHECK ((status IN ('RESOLVED', 'CLOSED') AND resolved_at IS NOT NULL) OR status NOT IN ('RESOLVED', 'CLOSED'))
);

CREATE UNIQUE INDEX uq_ota_task_active_incident
    ON ota.ota_task(tenant_id, hotel_id, incident_id)
    WHERE status IN ('OPEN', 'IN_PROGRESS', 'ESCALATED');
CREATE INDEX ix_ota_task_hotel_sla
    ON ota.ota_task(tenant_id, hotel_id, status, sla_due_at);

CREATE TABLE ota.ota_task_event (
    tenant_id UUID NOT NULL,
    hotel_id UUID NOT NULL,
    task_id UUID NOT NULL,
    task_event_id UUID NOT NULL,
    event_type VARCHAR(40) NOT NULL
        CHECK (event_type IN ('CREATED', 'ASSIGNED', 'ACKNOWLEDGED', 'ESCALATED', 'NOTE_RECORDED', 'RESOLVED', 'CLOSED', 'CANCELLED')),
    occurred_at TIMESTAMPTZ NOT NULL,
    actor_type VARCHAR(16) NOT NULL CHECK (actor_type IN ('ACCOUNT', 'SERVICE')),
    actor_account_id UUID REFERENCES control.auth_account(account_id),
    actor_service_principal_id UUID REFERENCES control.service_principal(service_principal_id),
    reason_code VARCHAR(64),
    evidence_ref VARCHAR(512),
    event_data JSONB NOT NULL DEFAULT '{}'::JSONB,
    correlation_id UUID,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (tenant_id, hotel_id, task_id, task_event_id),
    FOREIGN KEY (tenant_id, hotel_id, task_id)
        REFERENCES ota.ota_task(tenant_id, hotel_id, task_id),
    CHECK (
        (actor_type = 'ACCOUNT' AND actor_account_id IS NOT NULL AND actor_service_principal_id IS NULL)
        OR (actor_type = 'SERVICE' AND actor_account_id IS NULL AND actor_service_principal_id IS NOT NULL)
    ),
    CHECK (NOT control.jsonb_contains_forbidden_secret_key(event_data))
);

CREATE TABLE ota.ota_outbox_event (
    tenant_id UUID NOT NULL,
    hotel_id UUID NOT NULL,
    event_id UUID NOT NULL,
    event_type VARCHAR(160) NOT NULL,
    schema_version INTEGER NOT NULL CHECK (schema_version > 0),
    source_system VARCHAR(64) NOT NULL DEFAULT 'OTA_AUTOMATION',
    aggregate_type VARCHAR(96) NOT NULL,
    aggregate_id UUID NOT NULL,
    aggregate_version BIGINT NOT NULL CHECK (aggregate_version > 0),
    occurred_at TIMESTAMPTZ NOT NULL,
    correlation_id UUID,
    causation_id UUID,
    idempotency_key VARCHAR(255) NOT NULL,
    payload_json JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (tenant_id, hotel_id, event_id),
    FOREIGN KEY (tenant_id, hotel_id) REFERENCES ota.hotel(tenant_id, hotel_id),
    UNIQUE (tenant_id, idempotency_key),
    CHECK (btrim(event_type) <> ''),
    CHECK (btrim(idempotency_key) <> ''),
    CHECK (jsonb_typeof(payload_json) = 'object'),
    CHECK (NOT control.jsonb_contains_forbidden_secret_key(payload_json))
);

CREATE TABLE ota.ota_outbox_publish_state (
    tenant_id UUID NOT NULL,
    hotel_id UUID NOT NULL,
    event_id UUID NOT NULL,
    publish_status VARCHAR(24) NOT NULL DEFAULT 'PENDING'
        CHECK (publish_status IN ('PENDING', 'LEASED', 'PUBLISHED', 'FAILED')),
    available_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
    locked_by_service_principal_id UUID REFERENCES control.service_principal(service_principal_id),
    lease_until TIMESTAMPTZ,
    last_error_code VARCHAR(96),
    published_at TIMESTAMPTZ,
    row_version BIGINT NOT NULL DEFAULT 0 CHECK (row_version >= 0),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (tenant_id, hotel_id, event_id),
    FOREIGN KEY (tenant_id, hotel_id, event_id)
        REFERENCES ota.ota_outbox_event(tenant_id, hotel_id, event_id),
    CHECK ((publish_status = 'LEASED' AND locked_by_service_principal_id IS NOT NULL AND lease_until IS NOT NULL)
        OR publish_status <> 'LEASED'),
    CHECK ((publish_status = 'PUBLISHED' AND published_at IS NOT NULL) OR publish_status <> 'PUBLISHED')
);

CREATE INDEX ix_ota_outbox_publish_due
    ON ota.ota_outbox_publish_state(tenant_id, publish_status, available_at)
    WHERE publish_status IN ('PENDING', 'FAILED');

CREATE TABLE control.audit_event (
    audit_event_id UUID PRIMARY KEY,
    occurred_at TIMESTAMPTZ NOT NULL,
    actor_type VARCHAR(16) NOT NULL CHECK (actor_type IN ('ACCOUNT', 'SERVICE', 'ANONYMOUS')),
    actor_account_id UUID REFERENCES control.auth_account(account_id),
    actor_service_principal_id UUID REFERENCES control.service_principal(service_principal_id),
    authentication_source_snapshot VARCHAR(64),
    role_snapshot TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    permission_snapshot TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    action_code VARCHAR(128) NOT NULL,
    resource_type VARCHAR(96) NOT NULL,
    resource_id UUID,
    target_tenant_id UUID REFERENCES control.tenant_directory(tenant_id),
    target_hotel_id UUID,
    outcome_code VARCHAR(48) NOT NULL
        CHECK (outcome_code IN ('SUCCEEDED', 'DENIED', 'FAILED', 'PARTIAL')),
    condition_hash VARCHAR(128),
    coverage_code VARCHAR(64),
    duration_ms BIGINT CHECK (duration_ms IS NULL OR duration_ms >= 0),
    request_ip INET,
    user_agent VARCHAR(512),
    trace_id UUID,
    correlation_id UUID,
    failure_reason_code VARCHAR(96),
    domain_evidence_id UUID,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (target_tenant_id, target_hotel_id)
        REFERENCES ota.hotel(tenant_id, hotel_id),
    CHECK (
        (actor_type = 'ACCOUNT' AND actor_account_id IS NOT NULL AND actor_service_principal_id IS NULL)
        OR (actor_type = 'SERVICE' AND actor_account_id IS NULL AND actor_service_principal_id IS NOT NULL)
        OR (actor_type = 'ANONYMOUS' AND actor_account_id IS NULL AND actor_service_principal_id IS NULL)
    ),
    CHECK (btrim(action_code) <> ''),
    CHECK (btrim(resource_type) <> ''),
    CHECK (target_hotel_id IS NULL OR target_tenant_id IS NOT NULL)
);

COMMENT ON TABLE control.audit_event IS
    'Global append-only audit. It stores references/fingerprints only; passwords, tokens, cookies, webhooks and verification codes are forbidden.';

-- Fixed roles confirmed in TECH-DESIGN-1.0/T4. UUIDs are migration constants.
INSERT INTO control.role_definition(role_id, role_code, display_name, role_scope) VALUES
    ('10000000-0000-4000-8000-000000000001', 'PLATFORM_ADMIN', '平台管理员', 'GLOBAL'),
    ('10000000-0000-4000-8000-000000000002', 'OTA_OPERATION_ASSISTANT', 'OTA运营助理', 'GLOBAL'),
    ('10000000-0000-4000-8000-000000000003', 'OTA_OPERATION_MANAGER', 'OTA运营经理', 'GLOBAL'),
    ('10000000-0000-4000-8000-000000000004', 'CEO', 'CEO', 'GLOBAL'),
    ('10000000-0000-4000-8000-000000000005', 'REGIONAL_MANAGER', '区域经理', 'GLOBAL'),
    ('10000000-0000-4000-8000-000000000006', 'REVENUE_MANAGER', '收益经理', 'HOTEL_SCOPED'),
    ('10000000-0000-4000-8000-000000000007', 'HOTEL_P1_HANDLER', '门店P1处理人', 'HOTEL_SCOPED');

INSERT INTO control.permission_definition(permission_id, permission_code, description) VALUES
    ('20000000-0000-4000-8000-000000000001', 'ota.monitor.read', 'Read one tenant monitoring data'),
    ('20000000-0000-4000-8000-000000000002', 'ota.monitor.cross-tenant.read', 'Read monitoring data through controlled per-tenant fan-out'),
    ('20000000-0000-4000-8000-000000000003', 'ota.brief-history.read', 'Read hourly brief history'),
    ('20000000-0000-4000-8000-000000000004', 'ota.alert-history.read', 'Read P1 alert history'),
    ('20000000-0000-4000-8000-000000000005', 'ota.tenant-config.manage', 'Manage tenant configuration via privileged command path'),
    ('20000000-0000-4000-8000-000000000006', 'ota.hotel-config.manage', 'Manage hotel configuration via privileged command path'),
    ('20000000-0000-4000-8000-000000000007', 'ota.connector-config.manage', 'Manage connector metadata and SecretStore references'),
    ('20000000-0000-4000-8000-000000000008', 'ota.secret-reference.manage', 'Manage references and fingerprints, never secret values'),
    ('20000000-0000-4000-8000-000000000009', 'ota.fallback-import.create', 'Create controlled official-export imports'),
    ('20000000-0000-4000-8000-000000000010', 'ota.room-mapping.manage', 'Manage room/product mappings for scoped hotels'),
    ('20000000-0000-4000-8000-000000000011', 'ota.revenue-target.manage', 'Manage revenue targets for scoped hotels'),
    ('20000000-0000-4000-8000-000000000012', 'ota.pace-curve.manage', 'Manage pace curves for scoped hotels'),
    ('20000000-0000-4000-8000-000000000013', 'ota.task.read', 'Read assigned or scoped P1 tasks'),
    ('20000000-0000-4000-8000-000000000014', 'ota.task.handle', 'Handle assigned or scoped P1 tasks');

-- PLATFORM_ADMIN: cross-tenant read plus explicit control-plane configuration permissions.
INSERT INTO control.role_permission(role_id, permission_id)
SELECT '10000000-0000-4000-8000-000000000001'::UUID, permission_id
FROM control.permission_definition;

-- Four other group roles: read only across tenants; no configuration permissions.
INSERT INTO control.role_permission(role_id, permission_id)
SELECT role.role_id, permission.permission_id
FROM control.role_definition role
CROSS JOIN control.permission_definition permission
WHERE role.role_code IN ('OTA_OPERATION_ASSISTANT', 'OTA_OPERATION_MANAGER', 'CEO', 'REGIONAL_MANAGER')
  AND permission.permission_code IN (
      'ota.monitor.read', 'ota.monitor.cross-tenant.read',
      'ota.brief-history.read', 'ota.alert-history.read'
  );

-- Task handling remains subject to task assignment and hotel scope checks in the service layer.
INSERT INTO control.role_permission(role_id, permission_id)
SELECT role.role_id, permission.permission_id
FROM control.role_definition role
CROSS JOIN control.permission_definition permission
WHERE role.role_code IN ('OTA_OPERATION_ASSISTANT', 'OTA_OPERATION_MANAGER')
  AND permission.permission_code IN ('ota.task.read', 'ota.task.handle');

INSERT INTO control.role_permission(role_id, permission_id)
SELECT role.role_id, permission.permission_id
FROM control.role_definition role
CROSS JOIN control.permission_definition permission
WHERE role.role_code = 'REVENUE_MANAGER'
  AND permission.permission_code IN (
      'ota.monitor.read', 'ota.room-mapping.manage',
      'ota.revenue-target.manage', 'ota.pace-curve.manage'
  );

INSERT INTO control.role_permission(role_id, permission_id)
SELECT role.role_id, permission.permission_id
FROM control.role_definition role
CROSS JOIN control.permission_definition permission
WHERE role.role_code = 'HOTEL_P1_HANDLER'
  AND permission.permission_code IN ('ota.monitor.read', 'ota.task.read', 'ota.task.handle');

-- Every table in the tenant-scoped OTA schema is protected by fail-closed FORCE RLS.
ALTER TABLE ota.hotel ENABLE ROW LEVEL SECURITY;
ALTER TABLE ota.hotel FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON ota.hotel
    USING (tenant_id = control.current_tenant_id())
    WITH CHECK (tenant_id = control.current_tenant_id());

ALTER TABLE ota.account_hotel_scope ENABLE ROW LEVEL SECURITY;
ALTER TABLE ota.account_hotel_scope FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON ota.account_hotel_scope
    USING (tenant_id = control.current_tenant_id())
    WITH CHECK (tenant_id = control.current_tenant_id());

ALTER TABLE ota.hotel_duty_roster_version ENABLE ROW LEVEL SECURITY;
ALTER TABLE ota.hotel_duty_roster_version FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON ota.hotel_duty_roster_version
    USING (tenant_id = control.current_tenant_id())
    WITH CHECK (tenant_id = control.current_tenant_id());

ALTER TABLE ota.hotel_duty_roster_assignment ENABLE ROW LEVEL SECURITY;
ALTER TABLE ota.hotel_duty_roster_assignment FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON ota.hotel_duty_roster_assignment
    USING (tenant_id = control.current_tenant_id())
    WITH CHECK (tenant_id = control.current_tenant_id());

ALTER TABLE ota.hotel_escalation_policy_version ENABLE ROW LEVEL SECURITY;
ALTER TABLE ota.hotel_escalation_policy_version FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON ota.hotel_escalation_policy_version
    USING (tenant_id = control.current_tenant_id())
    WITH CHECK (tenant_id = control.current_tenant_id());

ALTER TABLE ota.hotel_escalation_recipient ENABLE ROW LEVEL SECURITY;
ALTER TABLE ota.hotel_escalation_recipient FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON ota.hotel_escalation_recipient
    USING (tenant_id = control.current_tenant_id())
    WITH CHECK (tenant_id = control.current_tenant_id());

ALTER TABLE ota.ota_incident ENABLE ROW LEVEL SECURITY;
ALTER TABLE ota.ota_incident FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON ota.ota_incident
    USING (tenant_id = control.current_tenant_id())
    WITH CHECK (tenant_id = control.current_tenant_id());

ALTER TABLE ota.ota_incident_occurrence ENABLE ROW LEVEL SECURITY;
ALTER TABLE ota.ota_incident_occurrence FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON ota.ota_incident_occurrence
    USING (tenant_id = control.current_tenant_id())
    WITH CHECK (tenant_id = control.current_tenant_id());

ALTER TABLE ota.ota_task ENABLE ROW LEVEL SECURITY;
ALTER TABLE ota.ota_task FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON ota.ota_task
    USING (tenant_id = control.current_tenant_id())
    WITH CHECK (tenant_id = control.current_tenant_id());

ALTER TABLE ota.ota_task_event ENABLE ROW LEVEL SECURITY;
ALTER TABLE ota.ota_task_event FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON ota.ota_task_event
    USING (tenant_id = control.current_tenant_id())
    WITH CHECK (tenant_id = control.current_tenant_id());

ALTER TABLE ota.ota_outbox_event ENABLE ROW LEVEL SECURITY;
ALTER TABLE ota.ota_outbox_event FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON ota.ota_outbox_event
    USING (tenant_id = control.current_tenant_id())
    WITH CHECK (tenant_id = control.current_tenant_id());

ALTER TABLE ota.ota_outbox_publish_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE ota.ota_outbox_publish_state FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON ota.ota_outbox_publish_state
    USING (tenant_id = control.current_tenant_id())
    WITH CHECK (tenant_id = control.current_tenant_id());

-- Immutable evidence/event rows reject UPDATE and DELETE even for their owner.
CREATE TRIGGER trg_audit_event_append_only
    BEFORE UPDATE OR DELETE ON control.audit_event
    FOR EACH ROW EXECUTE FUNCTION control.reject_append_only_mutation();

CREATE TRIGGER trg_incident_occurrence_append_only
    BEFORE UPDATE OR DELETE ON ota.ota_incident_occurrence
    FOR EACH ROW EXECUTE FUNCTION control.reject_append_only_mutation();

CREATE TRIGGER trg_task_event_append_only
    BEFORE UPDATE OR DELETE ON ota.ota_task_event
    FOR EACH ROW EXECUTE FUNCTION control.reject_append_only_mutation();

CREATE TRIGGER trg_outbox_event_append_only
    BEFORE UPDATE OR DELETE ON ota.ota_outbox_event
    FOR EACH ROW EXECUTE FUNCTION control.reject_append_only_mutation();

REVOKE ALL ON ALL TABLES IN SCHEMA control FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA ota FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA control FROM PUBLIC;

-- Runtime GRANTs are deliberately absent. A DBA must create NOBYPASSRLS,
-- NOINHERIT API/Worker roles that are not object owners, then apply the reviewed
-- privilege matrix described in README.md. Flyway must not assume superuser.
