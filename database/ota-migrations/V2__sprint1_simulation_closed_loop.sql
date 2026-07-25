-- OTA-AUTOMATION-V0.1 / Sprint 1
-- Configurable simulation closed-loop data model.
--
-- This migration intentionally contains no tenant/hotel seed, no pilot data,
-- no credential/webhook value, and no path that can record or authorize a real
-- external message delivery. Sprint 1 delivery is database-enforced simulation.

CREATE TABLE control.connector_adapter_registry (
    adapter_code VARCHAR(96) PRIMARY KEY,
    source_type VARCHAR(32) NOT NULL
        CHECK (source_type IN ('PMS', 'CTRIP', 'MEITUAN', 'OFFICIAL_EXPORT', 'SIMULATOR')),
    display_name VARCHAR(160) NOT NULL,
    implementation_version VARCHAR(64) NOT NULL,
    capability_codes TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    allowed_host_patterns TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    supports_simulation BOOLEAN NOT NULL DEFAULT TRUE,
    enabled BOOLEAN NOT NULL DEFAULT FALSE,
    row_version BIGINT NOT NULL DEFAULT 0 CHECK (row_version >= 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CHECK (btrim(adapter_code) <> ''),
    CHECK (btrim(display_name) <> ''),
    CHECK (btrim(implementation_version) <> '')
);

COMMENT ON TABLE control.connector_adapter_registry IS
    'Server-side adapter allowlist only. It stores no executable script, SQL, credential, session or endpoint URL.';

-- Code-owned, non-secret Sprint 1 adapters. These are executable adapter
-- registrations, not tenant/hotel/source configuration or pilot data.
INSERT INTO control.connector_adapter_registry(
    adapter_code, source_type, display_name, implementation_version,
    capability_codes, allowed_host_patterns, supports_simulation, enabled
) VALUES
    (
        'MOCK_PMS', 'PMS', 'Mock PMS', '1.0.0',
        ARRAY[
            'PMS_BUSINESS_DATE', 'ROOM_REVENUE_AGGREGATE',
            'OVERNIGHT_SOLD', 'EFFECTIVE_SELLABLE_TOTAL',
            'INVENTORY_BY_ROOM_TYPE'
        ]::TEXT[],
        ARRAY[]::TEXT[], TRUE, TRUE
    ),
    (
        'MOCK_CTRIP', 'CTRIP', 'Mock Ctrip', '1.0.0',
        ARRAY[
            'BOOKING_EVENTS', 'CANCELLATION_EVENTS',
            'INVENTORY_BY_SELL_PRODUCT', 'SOURCE_UPDATED_AT'
        ]::TEXT[],
        ARRAY[]::TEXT[], TRUE, TRUE
    ),
    (
        'MOCK_MEITUAN', 'MEITUAN', 'Mock Meituan', '1.0.0',
        ARRAY[
            'BOOKING_EVENTS', 'CANCELLATION_EVENTS',
            'INVENTORY_BY_SELL_PRODUCT', 'SOURCE_UPDATED_AT'
        ]::TEXT[],
        ARRAY[]::TEXT[], TRUE, TRUE
    ),
    (
        'FILE_FIXTURE', 'OFFICIAL_EXPORT', 'File Fixture', '1.0.0',
        ARRAY['OFFICIAL_EXPORT_PARSE']::TEXT[],
        ARRAY[]::TEXT[], TRUE, TRUE
    );

CREATE TABLE control.tenant_command_idempotency (
    command_id UUID PRIMARY KEY,
    idempotency_key VARCHAR(255) NOT NULL UNIQUE,
    command_type VARCHAR(96) NOT NULL,
    request_hash VARCHAR(128) NOT NULL,
    target_tenant_id UUID NOT NULL,
    resource_id UUID NOT NULL,
    original_result_code VARCHAR(32) NOT NULL
        CHECK (original_result_code IN ('CREATED', 'EXISTING')),
    actor_account_id UUID NOT NULL REFERENCES control.auth_account(account_id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CHECK (btrim(idempotency_key) <> ''),
    CHECK (request_hash ~ '^[A-Fa-f0-9]{64}$')
);

CREATE FUNCTION control.create_tenant_directory_entry(
    p_command_id UUID,
    p_idempotency_key TEXT,
    p_request_hash TEXT,
    p_tenant_id UUID,
    p_tenant_code TEXT,
    p_display_name TEXT,
    p_default_timezone TEXT,
    p_actor_account_id UUID
)
RETURNS TABLE(tenant_id UUID, original_result_code TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
    existing_command RECORD;
    existing_tenant RECORD;
    inserted_count INTEGER;
    result_code TEXT;
BEGIN
    IF p_command_id IS NULL
       OR p_tenant_id IS NULL
       OR p_actor_account_id IS NULL
       OR p_idempotency_key IS NULL
       OR btrim(p_idempotency_key) = ''
       OR p_request_hash !~ '^[A-Fa-f0-9]{64}$'
       OR p_tenant_code IS NULL
       OR btrim(p_tenant_code) = ''
       OR p_display_name IS NULL
       OR btrim(p_display_name) = ''
       OR p_default_timezone IS NULL
       OR btrim(p_default_timezone) = '' THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid tenant directory command';
    END IF;

    IF NOT EXISTS (
        SELECT 1
          FROM control.auth_account account
          JOIN control.account_role account_role
            ON account_role.account_id = account.account_id
          JOIN control.role_definition role
            ON role.role_id = account_role.role_id
         WHERE account.account_id = p_actor_account_id
           AND account.status = 'ACTIVE'
           AND role.role_code = 'PLATFORM_ADMIN'
           AND account_role.valid_from <= CURRENT_TIMESTAMP
           AND (account_role.valid_until IS NULL OR account_role.valid_until > CURRENT_TIMESTAMP)
    ) THEN
        RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'active PLATFORM_ADMIN is required';
    END IF;

    SELECT command.request_hash, command.target_tenant_id, command.resource_id,
           command.original_result_code
      INTO existing_command
      FROM control.tenant_command_idempotency command
     WHERE command.idempotency_key = p_idempotency_key
     FOR SHARE;

    IF FOUND THEN
        IF existing_command.request_hash IS DISTINCT FROM lower(p_request_hash)
           OR existing_command.target_tenant_id IS DISTINCT FROM p_tenant_id
           OR existing_command.resource_id IS DISTINCT FROM p_tenant_id THEN
            RAISE EXCEPTION USING ERRCODE = '23505', MESSAGE = 'idempotency key payload conflict';
        END IF;
        RETURN QUERY SELECT p_tenant_id, existing_command.original_result_code::TEXT;
        RETURN;
    END IF;

    INSERT INTO control.tenant_directory(
        tenant_id, tenant_code, display_name, default_timezone, status
    )
    VALUES (
        p_tenant_id, btrim(p_tenant_code), btrim(p_display_name),
        btrim(p_default_timezone), 'DRAFT'
    )
    ON CONFLICT ON CONSTRAINT tenant_directory_pkey DO NOTHING;
    GET DIAGNOSTICS inserted_count = ROW_COUNT;

    IF inserted_count = 0 THEN
        SELECT tenant.tenant_code, tenant.display_name, tenant.default_timezone
          INTO existing_tenant
          FROM control.tenant_directory tenant
         WHERE tenant.tenant_id = p_tenant_id;

        IF existing_tenant.tenant_code IS DISTINCT FROM btrim(p_tenant_code)
           OR existing_tenant.display_name IS DISTINCT FROM btrim(p_display_name)
           OR existing_tenant.default_timezone IS DISTINCT FROM btrim(p_default_timezone) THEN
            RAISE EXCEPTION USING ERRCODE = '23505', MESSAGE = 'tenant identity conflict';
        END IF;
        result_code := 'EXISTING';
    ELSE
        result_code := 'CREATED';
    END IF;

    INSERT INTO control.tenant_command_idempotency(
        command_id, idempotency_key, command_type, request_hash,
        target_tenant_id, resource_id, original_result_code, actor_account_id
    )
    VALUES (
        p_command_id, p_idempotency_key, 'CREATE_TENANT', lower(p_request_hash),
        p_tenant_id, p_tenant_id, result_code, p_actor_account_id
    );

    INSERT INTO control.audit_event(
        audit_event_id, occurred_at, actor_type, actor_account_id,
        action_code, resource_type, resource_id, target_tenant_id,
        outcome_code, condition_hash
    )
    VALUES (
        p_command_id, CURRENT_TIMESTAMP, 'ACCOUNT', p_actor_account_id,
        'ota.tenant.create', 'TENANT', p_tenant_id, p_tenant_id,
        'SUCCEEDED', lower(p_request_hash)
    );

    RETURN QUERY SELECT p_tenant_id, result_code;
END;
$$;

CREATE TABLE ota.hotel_business_day_config (
    tenant_id UUID NOT NULL,
    hotel_id UUID NOT NULL,
    config_id UUID NOT NULL,
    fallback_cutoff_local_time TIME NOT NULL,
    fallback_only BOOLEAN NOT NULL DEFAULT TRUE CHECK (fallback_only),
    status VARCHAR(24) NOT NULL DEFAULT 'DRAFT'
        CHECK (status IN ('DRAFT', 'ACTIVE', 'RETIRED')),
    effective_from TIMESTAMPTZ NOT NULL,
    effective_until TIMESTAMPTZ,
    reason_code VARCHAR(64) NOT NULL,
    row_version BIGINT NOT NULL DEFAULT 0 CHECK (row_version >= 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (tenant_id, hotel_id, config_id),
    FOREIGN KEY (tenant_id, hotel_id) REFERENCES ota.hotel(tenant_id, hotel_id),
    UNIQUE (tenant_id, hotel_id, effective_from),
    CHECK (effective_until IS NULL OR effective_until > effective_from),
    CHECK (btrim(reason_code) <> '')
);

COMMENT ON TABLE ota.hotel_business_day_config IS
    'Fallback operations setting only; it must never synthesize an official PMS business date.';

CREATE TABLE ota.hotel_source_connector (
    tenant_id UUID NOT NULL,
    hotel_id UUID NOT NULL,
    connector_id UUID NOT NULL,
    source_type VARCHAR(32) NOT NULL
        CHECK (source_type IN ('PMS', 'CTRIP', 'MEITUAN', 'OFFICIAL_EXPORT', 'SIMULATOR')),
    adapter_code VARCHAR(96) NOT NULL REFERENCES control.connector_adapter_registry(adapter_code),
    connector_mode VARCHAR(24) NOT NULL
        CHECK (connector_mode IN ('SIMULATION', 'FILE_IMPORT')),
    lifecycle_status VARCHAR(24) NOT NULL DEFAULT 'DRAFT'
        CHECK (lifecycle_status IN ('DRAFT', 'READY_FOR_TEST', 'SHADOW', 'UAT', 'PAUSED')),
    display_name VARCHAR(160) NOT NULL,
    row_version BIGINT NOT NULL DEFAULT 0 CHECK (row_version >= 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (tenant_id, hotel_id, connector_id),
    FOREIGN KEY (tenant_id, hotel_id) REFERENCES ota.hotel(tenant_id, hotel_id),
    CHECK (btrim(display_name) <> '')
);

CREATE UNIQUE INDEX uq_hotel_source_connector_enabled_source
    ON ota.hotel_source_connector(tenant_id, hotel_id, source_type)
    WHERE lifecycle_status IN ('READY_FOR_TEST', 'SHADOW', 'UAT');

CREATE TABLE ota.hotel_source_connector_version (
    tenant_id UUID NOT NULL,
    hotel_id UUID NOT NULL,
    connector_id UUID NOT NULL,
    connector_version_id UUID NOT NULL,
    version_no BIGINT NOT NULL CHECK (version_no > 0),
    adapter_version VARCHAR(64) NOT NULL,
    parser_version VARCHAR(64) NOT NULL,
    non_secret_config JSONB NOT NULL DEFAULT '{}'::JSONB,
    capability_codes TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    config_hash VARCHAR(128) NOT NULL,
    status VARCHAR(24) NOT NULL DEFAULT 'DRAFT'
        CHECK (status IN ('DRAFT', 'TESTED', 'ACTIVE', 'RETIRED')),
    tested_at TIMESTAMPTZ,
    activated_at TIMESTAMPTZ,
    retired_at TIMESTAMPTZ,
    created_by_account_id UUID NOT NULL REFERENCES control.auth_account(account_id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    row_version BIGINT NOT NULL DEFAULT 0 CHECK (row_version >= 0),
    PRIMARY KEY (tenant_id, hotel_id, connector_id, connector_version_id),
    FOREIGN KEY (tenant_id, hotel_id, connector_id)
        REFERENCES ota.hotel_source_connector(tenant_id, hotel_id, connector_id),
    UNIQUE (tenant_id, hotel_id, connector_id, version_no),
    CHECK (jsonb_typeof(non_secret_config) = 'object'),
    CHECK (NOT control.jsonb_contains_forbidden_secret_key(non_secret_config)),
    CHECK (config_hash ~ '^[A-Fa-f0-9]{64}$'),
    CHECK ((status = 'ACTIVE' AND tested_at IS NOT NULL AND activated_at IS NOT NULL) OR status <> 'ACTIVE'),
    CHECK ((status = 'RETIRED' AND retired_at IS NOT NULL) OR status <> 'RETIRED')
);

CREATE UNIQUE INDEX uq_connector_version_active
    ON ota.hotel_source_connector_version(tenant_id, hotel_id, connector_id)
    WHERE status = 'ACTIVE';

CREATE TABLE ota.connector_secret_binding (
    tenant_id UUID NOT NULL,
    hotel_id UUID NOT NULL,
    connector_id UUID NOT NULL,
    connector_version_id UUID NOT NULL,
    binding_id UUID NOT NULL,
    secret_purpose VARCHAR(64) NOT NULL,
    provider_code VARCHAR(48) NOT NULL,
    secret_ref VARCHAR(512) NOT NULL,
    secret_version VARCHAR(96) NOT NULL,
    secret_fingerprint VARCHAR(160) NOT NULL,
    binding_status VARCHAR(24) NOT NULL DEFAULT 'CONFIGURED'
        CHECK (binding_status IN ('CONFIGURED', 'ROTATION_REQUIRED', 'REVOKED')),
    configured_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    revoked_at TIMESTAMPTZ,
    row_version BIGINT NOT NULL DEFAULT 0 CHECK (row_version >= 0),
    PRIMARY KEY (tenant_id, hotel_id, connector_id, binding_id),
    FOREIGN KEY (tenant_id, hotel_id, connector_id, connector_version_id)
        REFERENCES ota.hotel_source_connector_version(
            tenant_id, hotel_id, connector_id, connector_version_id
        ),
    UNIQUE (tenant_id, hotel_id, connector_id, connector_version_id, secret_purpose),
    CHECK (btrim(secret_purpose) <> ''),
    CHECK (btrim(provider_code) <> ''),
    CHECK (
        secret_ref ~ '^(kms|vault|secretstore|oskeyring|envref)://[A-Za-z0-9._:/@+-]+$'
        AND secret_ref !~ '[?#&=]'
    ),
    CHECK (btrim(secret_version) <> ''),
    CHECK (btrim(secret_fingerprint) <> ''),
    CHECK ((binding_status = 'REVOKED' AND revoked_at IS NOT NULL) OR binding_status <> 'REVOKED')
);

COMMENT ON COLUMN ota.connector_secret_binding.secret_ref IS
    'Opaque SecretStore reference only. Query strings, inline values and raw credentials are rejected.';

CREATE TABLE ota.connector_authorization_state (
    tenant_id UUID NOT NULL,
    hotel_id UUID NOT NULL,
    connector_id UUID NOT NULL,
    authorization_state_id UUID NOT NULL,
    state_code VARCHAR(32) NOT NULL
        CHECK (state_code IN ('NOT_REQUIRED', 'UNCONFIGURED', 'VALID', 'AUTH_REQUIRED', 'REVOKED')),
    last_probe_at TIMESTAMPTZ,
    last_probe_result_code VARCHAR(64),
    reauthorization_requested_at TIMESTAMPTZ,
    authorized_at TIMESTAMPTZ,
    expires_at TIMESTAMPTZ,
    row_version BIGINT NOT NULL DEFAULT 0 CHECK (row_version >= 0),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (tenant_id, hotel_id, connector_id, authorization_state_id),
    FOREIGN KEY (tenant_id, hotel_id, connector_id)
        REFERENCES ota.hotel_source_connector(tenant_id, hotel_id, connector_id),
    UNIQUE (tenant_id, hotel_id, connector_id),
    CHECK (expires_at IS NULL OR authorized_at IS NULL OR expires_at > authorized_at)
);

CREATE TABLE ota.hotel_message_endpoint (
    tenant_id UUID NOT NULL,
    hotel_id UUID NOT NULL,
    endpoint_id UUID NOT NULL,
    endpoint_name VARCHAR(160) NOT NULL,
    endpoint_type VARCHAR(32) NOT NULL CHECK (endpoint_type = 'HOTEL_OPERATION_GROUP'),
    transport_mode VARCHAR(32) NOT NULL DEFAULT 'SIMULATION_ONLY'
        CHECK (transport_mode = 'SIMULATION_ONLY'),
    external_delivery_allowed BOOLEAN NOT NULL DEFAULT FALSE
        CHECK (NOT external_delivery_allowed),
    secret_ref VARCHAR(512),
    secret_fingerprint VARCHAR(160),
    at_all_required BOOLEAN NOT NULL DEFAULT TRUE CHECK (at_all_required),
    test_status VARCHAR(24) NOT NULL DEFAULT 'NOT_RUN'
        CHECK (test_status IN ('NOT_RUN', 'SIMULATED_PASS', 'SIMULATED_FAIL')),
    status VARCHAR(24) NOT NULL DEFAULT 'DRAFT'
        CHECK (status IN ('DRAFT', 'SIMULATION_READY', 'PAUSED')),
    last_tested_at TIMESTAMPTZ,
    row_version BIGINT NOT NULL DEFAULT 0 CHECK (row_version >= 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (tenant_id, hotel_id, endpoint_id),
    FOREIGN KEY (tenant_id, hotel_id) REFERENCES ota.hotel(tenant_id, hotel_id),
    CHECK (btrim(endpoint_name) <> ''),
    CHECK (
        secret_ref IS NULL
        OR (
            secret_ref ~ '^(kms|vault|secretstore|oskeyring|envref)://[A-Za-z0-9._:/@+-]+$'
            AND secret_ref !~ '[?#&=]'
        )
    ),
    CHECK ((secret_ref IS NULL) = (secret_fingerprint IS NULL))
);

COMMENT ON TABLE ota.hotel_message_endpoint IS
    'Sprint 1 endpoint metadata is simulation-only; the database cannot represent a real-delivery-enabled endpoint.';

CREATE TABLE ota.connector_collection_schedule (
    tenant_id UUID NOT NULL,
    hotel_id UUID NOT NULL,
    connector_id UUID NOT NULL,
    schedule_id UUID NOT NULL,
    stream_code VARCHAR(64) NOT NULL,
    trigger_type VARCHAR(32) NOT NULL
        CHECK (trigger_type IN ('NORMAL', 'HOURLY_CUTOFF', 'MANUAL_SIMULATION', 'FILE_IMPORT')),
    interval_minutes INTEGER NOT NULL CHECK (interval_minutes IN (5, 15, 30, 60)),
    timeout_seconds INTEGER NOT NULL CHECK (timeout_seconds BETWEEN 1 AND 240),
    lookback_minutes INTEGER NOT NULL CHECK (lookback_minutes >= 15),
    priority_no INTEGER NOT NULL DEFAULT 100 CHECK (priority_no > 0),
    next_due_at TIMESTAMPTZ NOT NULL,
    enabled BOOLEAN NOT NULL DEFAULT FALSE,
    row_version BIGINT NOT NULL DEFAULT 0 CHECK (row_version >= 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (tenant_id, hotel_id, connector_id, schedule_id),
    FOREIGN KEY (tenant_id, hotel_id, connector_id)
        REFERENCES ota.hotel_source_connector(tenant_id, hotel_id, connector_id),
    UNIQUE (tenant_id, hotel_id, connector_id, stream_code, trigger_type),
    CHECK (btrim(stream_code) <> ''),
    CHECK (trigger_type <> 'HOURLY_CUTOFF' OR interval_minutes = 60)
);

CREATE TABLE ota.hotel_revenue_target_version (
    tenant_id UUID NOT NULL,
    hotel_id UUID NOT NULL,
    target_version_id UUID NOT NULL,
    version_no BIGINT NOT NULL CHECK (version_no > 0),
    valid_business_date_from DATE NOT NULL,
    valid_business_date_until DATE,
    target_room_revenue NUMERIC(18,2) NOT NULL CHECK (target_room_revenue >= 0),
    target_adr NUMERIC(18,2) NOT NULL CHECK (target_adr >= 0),
    currency_code CHAR(3) NOT NULL DEFAULT 'CNY',
    status VARCHAR(24) NOT NULL DEFAULT 'DRAFT'
        CHECK (status IN ('DRAFT', 'ACTIVE', 'RETIRED')),
    reason_code VARCHAR(64) NOT NULL,
    created_by_account_id UUID NOT NULL REFERENCES control.auth_account(account_id),
    activated_at TIMESTAMPTZ,
    row_version BIGINT NOT NULL DEFAULT 0 CHECK (row_version >= 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (tenant_id, hotel_id, target_version_id),
    FOREIGN KEY (tenant_id, hotel_id) REFERENCES ota.hotel(tenant_id, hotel_id),
    UNIQUE (tenant_id, hotel_id, version_no),
    CHECK (valid_business_date_until IS NULL OR valid_business_date_until >= valid_business_date_from),
    CHECK (currency_code ~ '^[A-Z]{3}$'),
    CHECK ((status = 'ACTIVE' AND activated_at IS NOT NULL) OR status <> 'ACTIVE')
);

CREATE TABLE ota.hotel_pace_curve_version (
    tenant_id UUID NOT NULL,
    hotel_id UUID NOT NULL,
    pace_curve_version_id UUID NOT NULL,
    version_no BIGINT NOT NULL CHECK (version_no > 0),
    curve_code VARCHAR(64) NOT NULL,
    season_code VARCHAR(64) NOT NULL,
    effective_from DATE NOT NULL,
    effective_until DATE,
    tolerance_percentage_points NUMERIC(6,2) NOT NULL DEFAULT 2.00
        CHECK (tolerance_percentage_points >= 0),
    status VARCHAR(24) NOT NULL DEFAULT 'DRAFT'
        CHECK (status IN ('DRAFT', 'ACTIVE', 'RETIRED')),
    reason_code VARCHAR(64) NOT NULL,
    created_by_account_id UUID NOT NULL REFERENCES control.auth_account(account_id),
    activated_at TIMESTAMPTZ,
    row_version BIGINT NOT NULL DEFAULT 0 CHECK (row_version >= 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (tenant_id, hotel_id, pace_curve_version_id),
    FOREIGN KEY (tenant_id, hotel_id) REFERENCES ota.hotel(tenant_id, hotel_id),
    UNIQUE (tenant_id, hotel_id, version_no),
    CHECK (btrim(curve_code) <> ''),
    CHECK (btrim(season_code) <> ''),
    CHECK (effective_until IS NULL OR effective_until >= effective_from),
    CHECK ((status = 'ACTIVE' AND activated_at IS NOT NULL) OR status <> 'ACTIVE')
);

CREATE TABLE ota.hotel_pace_curve_point (
    tenant_id UUID NOT NULL,
    hotel_id UUID NOT NULL,
    pace_curve_version_id UUID NOT NULL,
    local_cutoff_time TIME NOT NULL,
    expected_revenue_progress_pct NUMERIC(6,2) NOT NULL
        CHECK (expected_revenue_progress_pct BETWEEN 0 AND 100),
    expected_sell_progress_pct NUMERIC(6,2) NOT NULL
        CHECK (expected_sell_progress_pct BETWEEN 0 AND 100),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (tenant_id, hotel_id, pace_curve_version_id, local_cutoff_time),
    FOREIGN KEY (tenant_id, hotel_id, pace_curve_version_id)
        REFERENCES ota.hotel_pace_curve_version(tenant_id, hotel_id, pace_curve_version_id)
);

CREATE TABLE control.ota_job_registry (
    job_id UUID PRIMARY KEY,
    tenant_id UUID NOT NULL,
    hotel_id UUID NOT NULL,
    connector_id UUID NOT NULL,
    schedule_id UUID NOT NULL,
    simulation_run_id UUID,
    job_type VARCHAR(40) NOT NULL DEFAULT 'COLLECTION'
        CHECK (job_type IN ('COLLECTION', 'SIMULATION_PIPELINE')),
    stream_code VARCHAR(64) NOT NULL,
    trigger_type VARCHAR(32) NOT NULL,
    scheduled_for TIMESTAMPTZ NOT NULL,
    available_at TIMESTAMPTZ NOT NULL,
    priority_no INTEGER NOT NULL CHECK (priority_no > 0),
    job_state VARCHAR(24) NOT NULL DEFAULT 'DUE'
        CHECK (job_state IN ('DUE', 'LEASED', 'SUCCEEDED', 'FAILED', 'CANCELLED')),
    lease_id UUID,
    leased_by_service_principal_id UUID REFERENCES control.service_principal(service_principal_id),
    lease_until TIMESTAMPTZ,
    run_id UUID,
    attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
    max_attempts INTEGER NOT NULL DEFAULT 4 CHECK (max_attempts BETWEEN 1 AND 10),
    last_outcome_code VARCHAR(64),
    last_failure_code VARCHAR(96),
    completed_at TIMESTAMPTZ,
    row_version BIGINT NOT NULL DEFAULT 0 CHECK (row_version >= 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (tenant_id, hotel_id, connector_id, schedule_id)
        REFERENCES ota.connector_collection_schedule(tenant_id, hotel_id, connector_id, schedule_id),
    CHECK (scheduled_for = date_trunc('hour', scheduled_for)),
    CHECK (available_at >= scheduled_for),
    CHECK (
        (job_state = 'LEASED' AND lease_id IS NOT NULL
            AND leased_by_service_principal_id IS NOT NULL
            AND lease_until IS NOT NULL AND run_id IS NOT NULL)
        OR job_state <> 'LEASED'
    ),
    CHECK (
        (job_state IN ('SUCCEEDED', 'FAILED', 'CANCELLED') AND completed_at IS NOT NULL)
        OR job_state NOT IN ('SUCCEEDED', 'FAILED', 'CANCELLED')
    ),
    CHECK (
        (job_type = 'SIMULATION_PIPELINE' AND simulation_run_id IS NOT NULL
            AND stream_code = 'SIMULATION_PIPELINE' AND trigger_type = 'MANUAL_SIMULATION')
        OR
        (job_type = 'COLLECTION' AND simulation_run_id IS NULL
            AND stream_code <> 'SIMULATION_PIPELINE'
            AND trigger_type <> 'MANUAL_SIMULATION')
    ),
    CHECK (last_failure_code IS NULL OR last_failure_code ~ '^[A-Z0-9_]{1,96}$')
);

CREATE UNIQUE INDEX uq_ota_job_active_lease
    ON control.ota_job_registry(lease_id)
    WHERE lease_id IS NOT NULL AND job_state = 'LEASED';
CREATE UNIQUE INDEX uq_ota_job_collection_slot
    ON control.ota_job_registry(tenant_id, hotel_id, schedule_id, scheduled_for)
    WHERE simulation_run_id IS NULL;
CREATE UNIQUE INDEX uq_ota_job_simulation_slot
    ON control.ota_job_registry(
        tenant_id, hotel_id, schedule_id, scheduled_for, simulation_run_id
    )
    WHERE simulation_run_id IS NOT NULL;
CREATE INDEX ix_ota_job_due
    ON control.ota_job_registry(job_state, available_at, priority_no, scheduled_for, job_id)
    WHERE job_state IN ('DUE', 'LEASED');

COMMENT ON TABLE control.ota_job_registry IS
    'Narrow global schedule/lease directory. It contains IDs and status only, never operating facts or Secret values.';

CREATE FUNCTION control.enqueue_ota_job(
    p_job_id UUID,
    p_tenant_id UUID,
    p_hotel_id UUID,
    p_connector_id UUID,
    p_schedule_id UUID,
    p_simulation_run_id UUID,
    p_scheduled_for TIMESTAMPTZ
)
RETURNS TABLE(job_id UUID, created_now BOOLEAN)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
    schedule_row RECORD;
    inserted_count INTEGER;
BEGIN
    IF control.current_tenant_id() IS DISTINCT FROM p_tenant_id THEN
        RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'tenant context mismatch';
    END IF;

    IF p_scheduled_for IS NULL
       OR p_scheduled_for <> date_trunc('hour', p_scheduled_for) THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'scheduled_for must be an exact hour';
    END IF;

    SELECT schedule.stream_code, schedule.trigger_type, schedule.priority_no
      INTO schedule_row
      FROM ota.connector_collection_schedule schedule
     WHERE schedule.tenant_id = p_tenant_id
       AND schedule.hotel_id = p_hotel_id
       AND schedule.connector_id = p_connector_id
       AND schedule.schedule_id = p_schedule_id
       AND schedule.enabled;

    IF NOT FOUND THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'enabled collection schedule not found';
    END IF;

    IF p_simulation_run_id IS NOT NULL THEN
        IF schedule_row.stream_code <> 'SIMULATION_PIPELINE'
           OR schedule_row.trigger_type <> 'MANUAL_SIMULATION'
           OR NOT EXISTS (
               SELECT 1
                 FROM ota.simulation_run simulation
                WHERE simulation.tenant_id = p_tenant_id
                  AND simulation.hotel_id = p_hotel_id
                  AND simulation.simulation_run_id = p_simulation_run_id
                  AND simulation.status = 'REQUESTED'
                  AND simulation.delivery_mode = 'SIMULATION_ONLY'
                  AND NOT simulation.external_delivery_allowed
           ) THEN
            RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'eligible simulation run not found';
        END IF;
    ELSIF schedule_row.stream_code = 'SIMULATION_PIPELINE'
       OR schedule_row.trigger_type = 'MANUAL_SIMULATION' THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'simulation schedule requires simulation_run_id';
    END IF;

    IF p_simulation_run_id IS NULL THEN
        INSERT INTO control.ota_job_registry(
            job_id, tenant_id, hotel_id, connector_id, schedule_id,
            simulation_run_id, job_type, stream_code, trigger_type,
            scheduled_for, available_at, priority_no
        )
        VALUES (
            p_job_id, p_tenant_id, p_hotel_id, p_connector_id, p_schedule_id,
            NULL, 'COLLECTION', schedule_row.stream_code, schedule_row.trigger_type,
            p_scheduled_for, p_scheduled_for, schedule_row.priority_no
        )
        ON CONFLICT (tenant_id, hotel_id, schedule_id, scheduled_for)
            WHERE simulation_run_id IS NULL
            DO NOTHING;
    ELSE
        INSERT INTO control.ota_job_registry(
            job_id, tenant_id, hotel_id, connector_id, schedule_id,
            simulation_run_id, job_type, stream_code, trigger_type,
            scheduled_for, available_at, priority_no
        )
        VALUES (
            p_job_id, p_tenant_id, p_hotel_id, p_connector_id, p_schedule_id,
            p_simulation_run_id, 'SIMULATION_PIPELINE',
            schedule_row.stream_code, schedule_row.trigger_type,
            p_scheduled_for, p_scheduled_for, schedule_row.priority_no
        )
        ON CONFLICT (
            tenant_id, hotel_id, schedule_id, scheduled_for, simulation_run_id
        )
            WHERE simulation_run_id IS NOT NULL
            DO NOTHING;
    END IF;
    GET DIAGNOSTICS inserted_count = ROW_COUNT;

    RETURN QUERY
    SELECT registry.job_id, inserted_count = 1
      FROM control.ota_job_registry registry
     WHERE registry.tenant_id = p_tenant_id
       AND registry.hotel_id = p_hotel_id
       AND registry.schedule_id = p_schedule_id
       AND registry.scheduled_for = p_scheduled_for
       AND registry.simulation_run_id IS NOT DISTINCT FROM p_simulation_run_id;
END;
$$;

CREATE FUNCTION control.dispatch_due_ota_jobs(
    p_scheduler_service_principal_id UUID,
    p_now TIMESTAMPTZ,
    p_batch_limit INTEGER DEFAULT 100
)
RETURNS TABLE(
    job_id UUID,
    tenant_id UUID,
    hotel_id UUID,
    schedule_id UUID,
    scheduled_for TIMESTAMPTZ,
    created_now BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
#variable_conflict use_column
DECLARE
    schedule_row RECORD;
    scheduled_slot TIMESTAMPTZ;
    stable_hash TEXT;
    stable_job_id UUID;
    inserted_count INTEGER;
    elapsed_intervals INTEGER;
BEGIN
    IF p_scheduler_service_principal_id IS NULL
       OR p_now IS NULL
       OR p_batch_limit IS NULL
       OR p_batch_limit < 1
       OR p_batch_limit > 500 THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid schedule dispatch request';
    END IF;

    IF NOT EXISTS (
        SELECT 1
          FROM control.service_principal principal
         WHERE principal.service_principal_id = p_scheduler_service_principal_id
           AND principal.purpose IN ('SCHEDULER', 'CONNECTOR_WORKER')
           AND principal.status = 'ACTIVE'
    ) THEN
        RAISE EXCEPTION USING ERRCODE = '42501',
            MESSAGE = 'active scheduler service principal is required';
    END IF;

    FOR schedule_row IN
        SELECT schedule.tenant_id AS scheduled_tenant_id,
               schedule.hotel_id AS scheduled_hotel_id,
               schedule.connector_id AS scheduled_connector_id,
               schedule.schedule_id AS scheduled_schedule_id,
               schedule.stream_code AS scheduled_stream_code,
               schedule.trigger_type AS scheduled_trigger_type,
               schedule.priority_no AS scheduled_priority_no,
               schedule.next_due_at AS scheduled_next_due_at,
               schedule.interval_minutes AS scheduled_interval_minutes
          FROM ota.connector_collection_schedule schedule
          JOIN control.tenant_directory tenant
            ON tenant.tenant_id = schedule.tenant_id
          JOIN ota.hotel hotel
            ON hotel.tenant_id = schedule.tenant_id
           AND hotel.hotel_id = schedule.hotel_id
          JOIN ota.hotel_source_connector connector
            ON connector.tenant_id = schedule.tenant_id
           AND connector.hotel_id = schedule.hotel_id
           AND connector.connector_id = schedule.connector_id
          JOIN control.connector_adapter_registry adapter
            ON adapter.adapter_code = connector.adapter_code
           AND adapter.source_type = connector.source_type
         WHERE schedule.enabled
           AND schedule.next_due_at <= p_now
           AND tenant.status IN ('DRAFT', 'ACTIVE')
           AND adapter.enabled
           AND schedule.trigger_type IN ('NORMAL', 'HOURLY_CUTOFF', 'FILE_IMPORT')
           AND schedule.stream_code <> 'SIMULATION_PIPELINE'
           AND hotel.collection_enabled
           AND hotel.lifecycle_status IN ('READY_FOR_TEST', 'SHADOW', 'UAT', 'LIVE')
           AND connector.lifecycle_status IN ('READY_FOR_TEST', 'SHADOW', 'UAT')
           AND connector.connector_mode IN ('SIMULATION', 'FILE_IMPORT')
           AND EXISTS (
               SELECT 1
                 FROM ota.hotel_source_connector_version version
                WHERE version.tenant_id = connector.tenant_id
                  AND version.hotel_id = connector.hotel_id
                  AND version.connector_id = connector.connector_id
                  AND version.status = 'ACTIVE'
           )
         ORDER BY schedule.next_due_at, schedule.priority_no,
                  schedule.tenant_id, schedule.hotel_id, schedule.schedule_id
         FOR UPDATE OF schedule SKIP LOCKED
         LIMIT p_batch_limit
    LOOP
        scheduled_slot := date_trunc('hour', schedule_row.scheduled_next_due_at);
        stable_hash := md5(
            schedule_row.scheduled_tenant_id::TEXT || '|' ||
            schedule_row.scheduled_hotel_id::TEXT || '|' ||
            schedule_row.scheduled_schedule_id::TEXT || '|' ||
            scheduled_slot::TEXT
        );
        stable_job_id := (
            substr(stable_hash, 1, 8) || '-' ||
            substr(stable_hash, 9, 4) || '-' ||
            substr(stable_hash, 13, 4) || '-' ||
            substr(stable_hash, 17, 4) || '-' ||
            substr(stable_hash, 21, 12)
        )::UUID;

        INSERT INTO control.ota_job_registry(
            job_id, tenant_id, hotel_id, connector_id, schedule_id,
            simulation_run_id, job_type, stream_code, trigger_type,
            scheduled_for, available_at, priority_no
        )
        VALUES (
            stable_job_id,
            schedule_row.scheduled_tenant_id,
            schedule_row.scheduled_hotel_id,
            schedule_row.scheduled_connector_id,
            schedule_row.scheduled_schedule_id,
            NULL,
            'COLLECTION',
            schedule_row.scheduled_stream_code,
            schedule_row.scheduled_trigger_type,
            scheduled_slot,
            schedule_row.scheduled_next_due_at,
            schedule_row.scheduled_priority_no
        )
        ON CONFLICT (tenant_id, hotel_id, schedule_id, scheduled_for)
            WHERE simulation_run_id IS NULL
            DO NOTHING;
        GET DIAGNOSTICS inserted_count = ROW_COUNT;

        elapsed_intervals := floor(
            extract(EPOCH FROM (p_now - schedule_row.scheduled_next_due_at))
            / 60
            / schedule_row.scheduled_interval_minutes
        )::INTEGER + 1;
        UPDATE ota.connector_collection_schedule schedule
           SET next_due_at = schedule_row.scheduled_next_due_at
               + make_interval(
                   mins => schedule_row.scheduled_interval_minutes * elapsed_intervals
               ),
               row_version = schedule.row_version + 1,
               updated_at = p_now
         WHERE schedule.tenant_id = schedule_row.scheduled_tenant_id
           AND schedule.hotel_id = schedule_row.scheduled_hotel_id
           AND schedule.connector_id = schedule_row.scheduled_connector_id
           AND schedule.schedule_id = schedule_row.scheduled_schedule_id
           AND schedule.next_due_at = schedule_row.scheduled_next_due_at;

        job_id := stable_job_id;
        tenant_id := schedule_row.scheduled_tenant_id;
        hotel_id := schedule_row.scheduled_hotel_id;
        schedule_id := schedule_row.scheduled_schedule_id;
        scheduled_for := scheduled_slot;
        created_now := inserted_count = 1;
        RETURN NEXT;
    END LOOP;
END;
$$;

CREATE FUNCTION control.claim_ota_job(
    p_worker_service_principal_id UUID,
    p_lease_id UUID,
    p_run_id UUID,
    p_now TIMESTAMPTZ,
    p_lease_until TIMESTAMPTZ,
    p_job_type TEXT
)
RETURNS TABLE(
    job_id UUID,
    lease_id UUID,
    tenant_id UUID,
    hotel_id UUID,
    connector_id UUID,
    simulation_run_id UUID,
    job_type TEXT,
    stream_code TEXT,
    trigger_type TEXT,
    run_id UUID,
    scheduled_for TIMESTAMPTZ,
    lease_expires_at TIMESTAMPTZ,
    attempt_count INTEGER,
    max_attempts INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
    claimed_job_id UUID;
BEGIN
    IF p_worker_service_principal_id IS NULL
       OR p_lease_id IS NULL
       OR p_run_id IS NULL
       OR p_now IS NULL
       OR p_lease_until IS NULL
       OR p_job_type IS NULL
       OR p_job_type NOT IN ('COLLECTION', 'SIMULATION_PIPELINE')
       OR p_lease_until <= p_now
       OR p_lease_until > p_now + INTERVAL '15 minutes' THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid job lease request';
    END IF;

    IF NOT EXISTS (
        SELECT 1
          FROM control.service_principal principal
         WHERE principal.service_principal_id = p_worker_service_principal_id
           AND principal.purpose IN ('SCHEDULER', 'CONNECTOR_WORKER')
           AND principal.status = 'ACTIVE'
    ) THEN
        RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'active worker service principal is required';
    END IF;

    SELECT candidate.job_id
      INTO claimed_job_id
     FROM control.ota_job_registry candidate
     WHERE candidate.available_at <= p_now
       AND candidate.job_type = p_job_type
       AND candidate.attempt_count < candidate.max_attempts
       AND (
           candidate.job_state = 'DUE'
           OR (candidate.job_state = 'LEASED' AND candidate.lease_until <= p_now)
       )
     ORDER BY candidate.priority_no, candidate.available_at, candidate.scheduled_for, candidate.job_id
     FOR UPDATE SKIP LOCKED
     LIMIT 1;

    IF claimed_job_id IS NULL THEN
        RETURN;
    END IF;

    UPDATE control.ota_job_registry job
       SET job_state = 'LEASED',
           lease_id = p_lease_id,
           leased_by_service_principal_id = p_worker_service_principal_id,
           lease_until = p_lease_until,
           run_id = p_run_id,
           attempt_count = job.attempt_count + 1,
           last_outcome_code = NULL,
           last_failure_code = NULL,
           completed_at = NULL,
           row_version = job.row_version + 1,
           updated_at = p_now
     WHERE job.job_id = claimed_job_id;

    RETURN QUERY
    SELECT job.job_id, job.lease_id, job.tenant_id, job.hotel_id,
           job.connector_id, job.simulation_run_id, job.job_type::TEXT, job.stream_code::TEXT,
           job.trigger_type::TEXT, job.run_id, job.scheduled_for,
           job.lease_until, job.attempt_count, job.max_attempts
      FROM control.ota_job_registry job
     WHERE job.job_id = claimed_job_id;
END;
$$;

CREATE FUNCTION control.renew_ota_job_lease(
    p_job_id UUID,
    p_lease_id UUID,
    p_worker_service_principal_id UUID,
    p_now TIMESTAMPTZ,
    p_new_lease_until TIMESTAMPTZ
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
    updated_count INTEGER;
BEGIN
    IF p_new_lease_until <= p_now
       OR p_new_lease_until > p_now + INTERVAL '15 minutes' THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid lease extension';
    END IF;

    UPDATE control.ota_job_registry job
       SET lease_until = p_new_lease_until,
           row_version = job.row_version + 1,
           updated_at = p_now
     WHERE job.job_id = p_job_id
       AND job.job_state = 'LEASED'
       AND job.lease_id = p_lease_id
       AND job.leased_by_service_principal_id = p_worker_service_principal_id
       AND job.lease_until > p_now
       AND EXISTS (
           SELECT 1
             FROM control.service_principal principal
            WHERE principal.service_principal_id =
                      p_worker_service_principal_id
              AND principal.purpose IN ('SCHEDULER', 'CONNECTOR_WORKER')
              AND principal.status = 'ACTIVE'
       );
    GET DIAGNOSTICS updated_count = ROW_COUNT;
    RETURN updated_count = 1;
END;
$$;

CREATE FUNCTION control.complete_ota_job(
    p_job_id UUID,
    p_lease_id UUID,
    p_worker_service_principal_id UUID,
    p_now TIMESTAMPTZ,
    p_outcome_code TEXT,
    p_failure_code TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
    updated_count INTEGER;
BEGIN
    IF p_outcome_code NOT IN ('SUCCEEDED', 'RETRYABLE_FAILURE', 'TERMINAL_FAILURE')
       OR (p_failure_code IS NOT NULL AND p_failure_code !~ '^[A-Z0-9_]{1,96}$')
       OR (p_outcome_code = 'SUCCEEDED' AND p_failure_code IS NOT NULL)
       OR (p_outcome_code <> 'SUCCEEDED' AND p_failure_code IS NULL) THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid job outcome';
    END IF;

    UPDATE control.ota_job_registry job
       SET job_state = CASE
               WHEN p_outcome_code = 'SUCCEEDED' THEN 'SUCCEEDED'
               WHEN p_outcome_code = 'RETRYABLE_FAILURE'
                    AND job.attempt_count < job.max_attempts THEN 'DUE'
               ELSE 'FAILED'
           END,
           lease_id = NULL,
           leased_by_service_principal_id = NULL,
           lease_until = NULL,
           last_outcome_code = p_outcome_code,
           last_failure_code = p_failure_code,
           completed_at = CASE
               WHEN p_outcome_code = 'RETRYABLE_FAILURE'
                    AND job.attempt_count < job.max_attempts THEN NULL
               ELSE p_now
           END,
           available_at = CASE
               WHEN p_outcome_code = 'RETRYABLE_FAILURE'
                    AND job.attempt_count < job.max_attempts
                   THEN p_now + CASE job.attempt_count
                       WHEN 1 THEN INTERVAL '30 seconds'
                       WHEN 2 THEN INTERVAL '2 minutes'
                       ELSE INTERVAL '5 minutes'
                   END
               ELSE job.available_at
           END,
           row_version = job.row_version + 1,
           updated_at = p_now
     WHERE job.job_id = p_job_id
       AND job.job_state = 'LEASED'
       AND job.lease_id = p_lease_id
       AND job.leased_by_service_principal_id = p_worker_service_principal_id
       AND job.lease_until >= p_now
       AND EXISTS (
           SELECT 1
             FROM control.service_principal principal
            WHERE principal.service_principal_id =
                      p_worker_service_principal_id
              AND principal.purpose IN ('SCHEDULER', 'CONNECTOR_WORKER')
              AND principal.status = 'ACTIVE'
       );
    GET DIAGNOSTICS updated_count = ROW_COUNT;
    RETURN updated_count = 1;
END;
$$;

CREATE TABLE ota.ota_command_idempotency (
    tenant_id UUID NOT NULL,
    hotel_id UUID NOT NULL,
    command_id UUID NOT NULL,
    idempotency_key VARCHAR(255) NOT NULL,
    command_type VARCHAR(96) NOT NULL,
    request_hash VARCHAR(128) NOT NULL,
    resource_type VARCHAR(96) NOT NULL,
    resource_id UUID NOT NULL,
    resulting_row_version BIGINT CHECK (resulting_row_version IS NULL OR resulting_row_version >= 0),
    result_code VARCHAR(48) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (tenant_id, hotel_id, command_id),
    FOREIGN KEY (tenant_id, hotel_id) REFERENCES ota.hotel(tenant_id, hotel_id),
    UNIQUE (tenant_id, hotel_id, idempotency_key),
    CHECK (btrim(idempotency_key) <> ''),
    CHECK (btrim(command_type) <> ''),
    CHECK (request_hash ~ '^[A-Fa-f0-9]{64}$'),
    CHECK (btrim(resource_type) <> ''),
    CHECK (btrim(result_code) <> '')
);

COMMENT ON TABLE ota.ota_command_idempotency IS
    'Append-only command receipt. A replay with the same key must compare request_hash and return this original receipt.';

CREATE TABLE ota.simulation_run (
    tenant_id UUID NOT NULL,
    hotel_id UUID NOT NULL,
    simulation_run_id UUID NOT NULL,
    scenario_code VARCHAR(96) NOT NULL,
    fixed_clock_at TIMESTAMPTZ NOT NULL,
    status VARCHAR(32) NOT NULL DEFAULT 'REQUESTED'
        CHECK (status IN ('REQUESTED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELLED')),
    requested_by_account_id UUID NOT NULL REFERENCES control.auth_account(account_id),
    idempotency_key VARCHAR(255) NOT NULL,
    request_hash VARCHAR(128) NOT NULL,
    delivery_mode VARCHAR(32) NOT NULL DEFAULT 'SIMULATION_ONLY'
        CHECK (delivery_mode = 'SIMULATION_ONLY'),
    external_delivery_allowed BOOLEAN NOT NULL DEFAULT FALSE
        CHECK (NOT external_delivery_allowed),
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    failure_code VARCHAR(96),
    row_version BIGINT NOT NULL DEFAULT 0 CHECK (row_version >= 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (tenant_id, hotel_id, simulation_run_id),
    FOREIGN KEY (tenant_id, hotel_id) REFERENCES ota.hotel(tenant_id, hotel_id),
    UNIQUE (tenant_id, hotel_id, idempotency_key),
    CHECK (btrim(scenario_code) <> ''),
    CHECK (request_hash ~ '^[A-Fa-f0-9]{64}$'),
    CHECK (failure_code IS NULL OR failure_code ~ '^[A-Z0-9_]{1,96}$'),
    CHECK (
        (status IN ('SUCCEEDED', 'FAILED', 'CANCELLED') AND completed_at IS NOT NULL)
        OR status NOT IN ('SUCCEEDED', 'FAILED', 'CANCELLED')
    )
);

ALTER TABLE control.ota_job_registry
    ADD CONSTRAINT fk_ota_job_simulation_run
    FOREIGN KEY (tenant_id, hotel_id, simulation_run_id)
    REFERENCES ota.simulation_run(tenant_id, hotel_id, simulation_run_id);

CREATE TABLE ota.connector_collection_run (
    tenant_id UUID NOT NULL,
    hotel_id UUID NOT NULL,
    run_id UUID NOT NULL,
    connector_id UUID NOT NULL,
    connector_version_id UUID NOT NULL,
    simulation_run_id UUID,
    stream_code VARCHAR(64) NOT NULL,
    trigger_type VARCHAR(32) NOT NULL
        CHECK (trigger_type IN ('NORMAL', 'HOURLY_CUTOFF', 'MANUAL_SIMULATION', 'FILE_IMPORT')),
    scheduled_for TIMESTAMPTZ NOT NULL,
    window_from_exclusive TIMESTAMPTZ NOT NULL,
    window_to_inclusive TIMESTAMPTZ NOT NULL,
    cutoff_at TIMESTAMPTZ NOT NULL,
    reconciliation_epoch UUID,
    status VARCHAR(32) NOT NULL DEFAULT 'STARTED'
        CHECK (status IN ('STARTED', 'SUCCESS', 'PARTIAL', 'AUTH_REQUIRED', 'FAILED')),
    completeness_code VARCHAR(32) NOT NULL DEFAULT 'UNAVAILABLE'
        CHECK (completeness_code IN ('COMPLETE', 'PARTIAL', 'UNAVAILABLE')),
    source_valid_at TIMESTAMPTZ,
    observed_at TIMESTAMPTZ,
    candidate_watermark JSONB,
    record_count BIGINT NOT NULL DEFAULT 0 CHECK (record_count >= 0),
    page_count INTEGER NOT NULL DEFAULT 0 CHECK (page_count >= 0),
    error_code VARCHAR(96),
    started_at TIMESTAMPTZ NOT NULL,
    finished_at TIMESTAMPTZ,
    row_version BIGINT NOT NULL DEFAULT 0 CHECK (row_version >= 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (tenant_id, hotel_id, run_id),
    FOREIGN KEY (tenant_id, hotel_id, connector_id, connector_version_id)
        REFERENCES ota.hotel_source_connector_version(
            tenant_id, hotel_id, connector_id, connector_version_id
        ),
    FOREIGN KEY (tenant_id, hotel_id, simulation_run_id)
        REFERENCES ota.simulation_run(tenant_id, hotel_id, simulation_run_id),
    CHECK (window_to_inclusive > window_from_exclusive),
    CHECK (cutoff_at = date_trunc('hour', cutoff_at)),
    CHECK (cutoff_at >= window_to_inclusive),
    CHECK (candidate_watermark IS NULL OR jsonb_typeof(candidate_watermark) = 'object'),
    CHECK (candidate_watermark IS NULL OR NOT control.jsonb_contains_forbidden_secret_key(candidate_watermark)),
    CHECK (error_code IS NULL OR error_code ~ '^[A-Z0-9_]{1,96}$'),
    CHECK (finished_at IS NULL OR finished_at >= started_at),
    CHECK (
        (status IN ('SUCCESS', 'PARTIAL', 'AUTH_REQUIRED', 'FAILED') AND finished_at IS NOT NULL)
        OR status = 'STARTED'
    )
);

CREATE UNIQUE INDEX uq_collection_run_collection_slot
    ON ota.connector_collection_run(
        tenant_id, hotel_id, connector_id, stream_code, trigger_type, scheduled_for
    )
    WHERE simulation_run_id IS NULL;
CREATE UNIQUE INDEX uq_collection_run_simulation_slot
    ON ota.connector_collection_run(
        tenant_id, hotel_id, connector_id, stream_code, trigger_type,
        scheduled_for, simulation_run_id
    )
    WHERE simulation_run_id IS NOT NULL;

CREATE INDEX ix_collection_run_cutoff
    ON ota.connector_collection_run(tenant_id, hotel_id, cutoff_at, stream_code, status);

CREATE TABLE ota.connector_collection_attempt (
    tenant_id UUID NOT NULL,
    hotel_id UUID NOT NULL,
    run_id UUID NOT NULL,
    attempt_id UUID NOT NULL,
    attempt_no INTEGER NOT NULL CHECK (attempt_no > 0),
    fragment_code VARCHAR(96),
    page_no INTEGER CHECK (page_no IS NULL OR page_no > 0),
    status VARCHAR(32) NOT NULL
        CHECK (status IN ('SUCCESS', 'PARTIAL', 'AUTH_REQUIRED', 'FAILED')),
    result_category VARCHAR(64) NOT NULL,
    sanitized_error_code VARCHAR(96),
    response_fingerprint VARCHAR(160),
    started_at TIMESTAMPTZ NOT NULL,
    finished_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (tenant_id, hotel_id, run_id, attempt_id),
    FOREIGN KEY (tenant_id, hotel_id, run_id)
        REFERENCES ota.connector_collection_run(tenant_id, hotel_id, run_id),
    UNIQUE (tenant_id, hotel_id, run_id, attempt_no, fragment_code, page_no),
    CHECK (btrim(result_category) <> ''),
    CHECK (sanitized_error_code IS NULL OR sanitized_error_code ~ '^[A-Z0-9_]{1,96}$'),
    CHECK (finished_at >= started_at)
);

CREATE TABLE ota.connector_stream_checkpoint (
    tenant_id UUID NOT NULL,
    hotel_id UUID NOT NULL,
    connector_id UUID NOT NULL,
    stream_code VARCHAR(64) NOT NULL,
    committed_watermark JSONB,
    committed_run_id UUID,
    committed_at TIMESTAMPTZ,
    last_success_at TIMESTAMPTZ,
    last_observed_at TIMESTAMPTZ,
    freshness_state VARCHAR(32) NOT NULL DEFAULT 'UNAVAILABLE'
        CHECK (freshness_state IN ('FRESH', 'SUSPECT', 'UNAVAILABLE', 'RECOVERY_VERIFYING')),
    consecutive_failure_count INTEGER NOT NULL DEFAULT 0 CHECK (consecutive_failure_count >= 0),
    stale_after TIMESTAMPTZ,
    last_reason_code VARCHAR(96),
    row_version BIGINT NOT NULL DEFAULT 0 CHECK (row_version >= 0),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (tenant_id, hotel_id, connector_id, stream_code),
    FOREIGN KEY (tenant_id, hotel_id, connector_id)
        REFERENCES ota.hotel_source_connector(tenant_id, hotel_id, connector_id),
    FOREIGN KEY (tenant_id, hotel_id, committed_run_id)
        REFERENCES ota.connector_collection_run(tenant_id, hotel_id, run_id),
    CHECK (committed_watermark IS NULL OR jsonb_typeof(committed_watermark) = 'object'),
    CHECK (committed_watermark IS NULL OR NOT control.jsonb_contains_forbidden_secret_key(committed_watermark)),
    CHECK (last_reason_code IS NULL OR last_reason_code ~ '^[A-Z0-9_]{1,96}$'),
    CHECK ((committed_run_id IS NULL) = (committed_at IS NULL))
);

CREATE TABLE ota.source_raw_record (
    tenant_id UUID NOT NULL,
    hotel_id UUID NOT NULL,
    raw_record_id UUID NOT NULL,
    run_id UUID NOT NULL,
    connector_id UUID NOT NULL,
    connector_version_id UUID NOT NULL,
    stream_code VARCHAR(64) NOT NULL,
    source_record_key_hash VARCHAR(128) NOT NULL,
    source_valid_at TIMESTAMPTZ,
    observed_at TIMESTAMPTZ NOT NULL,
    evidence_ref VARCHAR(512) NOT NULL,
    evidence_sha256 VARCHAR(64) NOT NULL,
    parser_version VARCHAR(64) NOT NULL,
    normalized_content_hash VARCHAR(64) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (tenant_id, hotel_id, raw_record_id),
    FOREIGN KEY (tenant_id, hotel_id, run_id)
        REFERENCES ota.connector_collection_run(tenant_id, hotel_id, run_id),
    FOREIGN KEY (tenant_id, hotel_id, connector_id, connector_version_id)
        REFERENCES ota.hotel_source_connector_version(
            tenant_id, hotel_id, connector_id, connector_version_id
        ),
    UNIQUE (tenant_id, hotel_id, connector_id, stream_code, source_record_key_hash, normalized_content_hash),
    CHECK (source_record_key_hash ~ '^[A-Fa-f0-9]{64}$'),
    CHECK (evidence_ref ~ '^(object|file|fixture)://[A-Za-z0-9._:/@+-]+$'),
    CHECK (evidence_sha256 ~ '^[A-Fa-f0-9]{64}$'),
    CHECK (normalized_content_hash ~ '^[A-Fa-f0-9]{64}$')
);

CREATE TABLE ota.source_import_batch (
    tenant_id UUID NOT NULL,
    hotel_id UUID NOT NULL,
    import_batch_id UUID NOT NULL,
    connector_id UUID NOT NULL,
    connector_version_id UUID NOT NULL,
    simulation_run_id UUID,
    period_from TIMESTAMPTZ NOT NULL,
    period_until TIMESTAMPTZ NOT NULL,
    object_ref VARCHAR(512) NOT NULL,
    object_sha256 VARCHAR(64) NOT NULL,
    parser_version VARCHAR(64) NOT NULL,
    status VARCHAR(32) NOT NULL DEFAULT 'UPLOADED'
        CHECK (status IN ('UPLOADED', 'VALIDATED', 'ACTIVATED', 'REJECTED')),
    activated_run_id UUID,
    uploaded_by_account_id UUID NOT NULL REFERENCES control.auth_account(account_id),
    uploaded_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    validated_at TIMESTAMPTZ,
    activated_at TIMESTAMPTZ,
    row_version BIGINT NOT NULL DEFAULT 0 CHECK (row_version >= 0),
    PRIMARY KEY (tenant_id, hotel_id, import_batch_id),
    FOREIGN KEY (tenant_id, hotel_id, connector_id, connector_version_id)
        REFERENCES ota.hotel_source_connector_version(
            tenant_id, hotel_id, connector_id, connector_version_id
        ),
    FOREIGN KEY (tenant_id, hotel_id, simulation_run_id)
        REFERENCES ota.simulation_run(tenant_id, hotel_id, simulation_run_id),
    FOREIGN KEY (tenant_id, hotel_id, activated_run_id)
        REFERENCES ota.connector_collection_run(tenant_id, hotel_id, run_id),
    CHECK (period_until > period_from),
    CHECK (object_ref ~ '^(object|file|fixture)://[A-Za-z0-9._:/@+-]+$'),
    CHECK (object_sha256 ~ '^[A-Fa-f0-9]{64}$'),
    CHECK ((status = 'ACTIVATED' AND activated_run_id IS NOT NULL AND activated_at IS NOT NULL)
        OR status <> 'ACTIVATED')
);

CREATE TABLE ota.pms_business_day_observation (
    tenant_id UUID NOT NULL,
    hotel_id UUID NOT NULL,
    observation_id UUID NOT NULL,
    run_id UUID NOT NULL,
    connector_id UUID NOT NULL,
    connector_version_id UUID NOT NULL,
    pms_business_date DATE NOT NULL,
    source_effective_at TIMESTAMPTZ,
    detected_after TIMESTAMPTZ,
    detected_at_or_before TIMESTAMPTZ,
    observed_at TIMESTAMPTZ NOT NULL,
    evidence_ref VARCHAR(512) NOT NULL,
    content_hash VARCHAR(64) NOT NULL,
    parser_version VARCHAR(64) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (tenant_id, hotel_id, observation_id),
    FOREIGN KEY (tenant_id, hotel_id, run_id)
        REFERENCES ota.connector_collection_run(tenant_id, hotel_id, run_id),
    FOREIGN KEY (tenant_id, hotel_id, connector_id, connector_version_id)
        REFERENCES ota.hotel_source_connector_version(
            tenant_id, hotel_id, connector_id, connector_version_id
        ),
    UNIQUE (tenant_id, hotel_id, run_id, pms_business_date, content_hash),
    CHECK (
        (source_effective_at IS NOT NULL
            AND detected_after IS NULL AND detected_at_or_before IS NULL)
        OR
        (source_effective_at IS NULL
            AND detected_after IS NOT NULL AND detected_at_or_before IS NOT NULL
            AND detected_at_or_before >= detected_after)
    ),
    CHECK (evidence_ref ~ '^(object|file|fixture)://[A-Za-z0-9._:/@+-]+$'),
    CHECK (content_hash ~ '^[A-Fa-f0-9]{64}$')
);

COMMENT ON TABLE ota.pms_business_day_observation IS
    'Stores either a source-provided exact effective timestamp or a detection interval, never an invented cutover time.';

CREATE TABLE ota.pms_business_day_transition (
    tenant_id UUID NOT NULL,
    hotel_id UUID NOT NULL,
    transition_id UUID NOT NULL,
    previous_observation_id UUID NOT NULL,
    current_observation_id UUID NOT NULL,
    previous_business_date DATE NOT NULL,
    current_business_date DATE NOT NULL,
    source_effective_at TIMESTAMPTZ,
    detected_after TIMESTAMPTZ,
    detected_at_or_before TIMESTAMPTZ,
    transition_detected_at TIMESTAMPTZ NOT NULL,
    evidence_hash VARCHAR(64) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (tenant_id, hotel_id, transition_id),
    FOREIGN KEY (tenant_id, hotel_id, previous_observation_id)
        REFERENCES ota.pms_business_day_observation(tenant_id, hotel_id, observation_id),
    FOREIGN KEY (tenant_id, hotel_id, current_observation_id)
        REFERENCES ota.pms_business_day_observation(tenant_id, hotel_id, observation_id),
    UNIQUE (tenant_id, hotel_id, current_observation_id),
    CHECK (current_business_date <> previous_business_date),
    CHECK (
        (source_effective_at IS NOT NULL
            AND detected_after IS NULL AND detected_at_or_before IS NULL)
        OR
        (source_effective_at IS NULL
            AND detected_after IS NOT NULL AND detected_at_or_before IS NOT NULL
            AND detected_at_or_before >= detected_after)
    ),
    CHECK (evidence_hash ~ '^[A-Fa-f0-9]{64}$')
);

CREATE TABLE ota.business_day_run (
    tenant_id UUID NOT NULL,
    hotel_id UUID NOT NULL,
    business_day_run_id UUID NOT NULL,
    pms_business_date DATE NOT NULL,
    opening_observation_id UUID NOT NULL,
    opening_transition_id UUID,
    status VARCHAR(24) NOT NULL DEFAULT 'OPEN'
        CHECK (status IN ('OPEN', 'CLOSED', 'CORRECTED')),
    opened_at TIMESTAMPTZ NOT NULL,
    closed_at TIMESTAMPTZ,
    row_version BIGINT NOT NULL DEFAULT 0 CHECK (row_version >= 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (tenant_id, hotel_id, business_day_run_id),
    FOREIGN KEY (tenant_id, hotel_id, opening_observation_id)
        REFERENCES ota.pms_business_day_observation(tenant_id, hotel_id, observation_id),
    FOREIGN KEY (tenant_id, hotel_id, opening_transition_id)
        REFERENCES ota.pms_business_day_transition(tenant_id, hotel_id, transition_id),
    UNIQUE (tenant_id, hotel_id, pms_business_date),
    CHECK ((status = 'CLOSED' AND closed_at IS NOT NULL) OR status <> 'CLOSED'),
    CHECK (closed_at IS NULL OR closed_at >= opened_at)
);

CREATE TABLE ota.pms_operating_observation (
    tenant_id UUID NOT NULL,
    hotel_id UUID NOT NULL,
    operating_observation_id UUID NOT NULL,
    run_id UUID NOT NULL,
    business_day_run_id UUID NOT NULL,
    connector_id UUID NOT NULL,
    connector_version_id UUID NOT NULL,
    pms_business_date DATE NOT NULL,
    room_revenue NUMERIC(18,2) NOT NULL,
    hourly_room_revenue_included NUMERIC(18,2) NOT NULL DEFAULT 0,
    overnight_sold_room_nights INTEGER NOT NULL CHECK (overnight_sold_room_nights >= 0),
    sellable_room_count INTEGER NOT NULL CHECK (sellable_room_count >= 0),
    effective_total_room_count INTEGER NOT NULL CHECK (effective_total_room_count >= 0),
    currency_code CHAR(3) NOT NULL DEFAULT 'CNY',
    source_valid_at TIMESTAMPTZ,
    observed_at TIMESTAMPTZ NOT NULL,
    evidence_ref VARCHAR(512) NOT NULL,
    content_hash VARCHAR(64) NOT NULL,
    parser_version VARCHAR(64) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (tenant_id, hotel_id, operating_observation_id),
    FOREIGN KEY (tenant_id, hotel_id, run_id)
        REFERENCES ota.connector_collection_run(tenant_id, hotel_id, run_id),
    FOREIGN KEY (tenant_id, hotel_id, business_day_run_id)
        REFERENCES ota.business_day_run(tenant_id, hotel_id, business_day_run_id),
    FOREIGN KEY (tenant_id, hotel_id, connector_id, connector_version_id)
        REFERENCES ota.hotel_source_connector_version(
            tenant_id, hotel_id, connector_id, connector_version_id
        ),
    UNIQUE (tenant_id, hotel_id, run_id, pms_business_date, content_hash),
    CHECK (sellable_room_count <= effective_total_room_count),
    CHECK (currency_code ~ '^[A-Z]{3}$'),
    CHECK (evidence_ref ~ '^(object|file|fixture)://[A-Za-z0-9._:/@+-]+$'),
    CHECK (content_hash ~ '^[A-Fa-f0-9]{64}$')
);

COMMENT ON COLUMN ota.pms_operating_observation.room_revenue IS
    'Room-charge revenue only; hourly-room revenue is included and is separately identified for reconciliation.';

CREATE TABLE ota.pms_room_charge_event (
    tenant_id UUID NOT NULL,
    hotel_id UUID NOT NULL,
    room_charge_event_id UUID NOT NULL,
    run_id UUID NOT NULL,
    business_day_run_id UUID NOT NULL,
    connector_id UUID NOT NULL,
    connector_version_id UUID NOT NULL,
    source_event_key_hash VARCHAR(64) NOT NULL,
    charge_type VARCHAR(24) NOT NULL CHECK (charge_type IN ('ROOM', 'HOURLY_ROOM')),
    event_type VARCHAR(24) NOT NULL CHECK (event_type IN ('POSTED', 'REVERSED', 'CORRECTED')),
    amount NUMERIC(18,2) NOT NULL,
    currency_code CHAR(3) NOT NULL DEFAULT 'CNY',
    pms_business_date DATE NOT NULL,
    occurred_at TIMESTAMPTZ NOT NULL,
    observed_at TIMESTAMPTZ NOT NULL,
    evidence_ref VARCHAR(512) NOT NULL,
    content_hash VARCHAR(64) NOT NULL,
    parser_version VARCHAR(64) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (tenant_id, hotel_id, room_charge_event_id),
    FOREIGN KEY (tenant_id, hotel_id, run_id)
        REFERENCES ota.connector_collection_run(tenant_id, hotel_id, run_id),
    FOREIGN KEY (tenant_id, hotel_id, business_day_run_id)
        REFERENCES ota.business_day_run(tenant_id, hotel_id, business_day_run_id),
    FOREIGN KEY (tenant_id, hotel_id, connector_id, connector_version_id)
        REFERENCES ota.hotel_source_connector_version(
            tenant_id, hotel_id, connector_id, connector_version_id
        ),
    UNIQUE (tenant_id, hotel_id, connector_id, source_event_key_hash, content_hash),
    CHECK (source_event_key_hash ~ '^[A-Fa-f0-9]{64}$'),
    CHECK (currency_code ~ '^[A-Z]{3}$'),
    CHECK (evidence_ref ~ '^(object|file|fixture)://[A-Za-z0-9._:/@+-]+$'),
    CHECK (content_hash ~ '^[A-Fa-f0-9]{64}$')
);

CREATE TABLE ota.source_standard_record (
    tenant_id UUID NOT NULL,
    hotel_id UUID NOT NULL,
    standard_record_id UUID NOT NULL,
    run_id UUID NOT NULL,
    raw_record_id UUID NOT NULL,
    connector_id UUID NOT NULL,
    connector_version_id UUID NOT NULL,
    record_type VARCHAR(64) NOT NULL,
    source_event_key_hash VARCHAR(64) NOT NULL,
    source_valid_at TIMESTAMPTZ,
    observed_at TIMESTAMPTZ NOT NULL,
    parser_version VARCHAR(64) NOT NULL,
    content_hash VARCHAR(64) NOT NULL,
    normalized_payload JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (tenant_id, hotel_id, standard_record_id),
    FOREIGN KEY (tenant_id, hotel_id, run_id)
        REFERENCES ota.connector_collection_run(tenant_id, hotel_id, run_id),
    FOREIGN KEY (tenant_id, hotel_id, raw_record_id)
        REFERENCES ota.source_raw_record(tenant_id, hotel_id, raw_record_id),
    FOREIGN KEY (tenant_id, hotel_id, connector_id, connector_version_id)
        REFERENCES ota.hotel_source_connector_version(
            tenant_id, hotel_id, connector_id, connector_version_id
        ),
    UNIQUE (tenant_id, hotel_id, connector_id, record_type, source_event_key_hash, content_hash),
    CHECK (btrim(record_type) <> ''),
    CHECK (source_event_key_hash ~ '^[A-Fa-f0-9]{64}$'),
    CHECK (content_hash ~ '^[A-Fa-f0-9]{64}$'),
    CHECK (jsonb_typeof(normalized_payload) = 'object'),
    CHECK (NOT control.jsonb_contains_forbidden_secret_key(normalized_payload))
);

CREATE TABLE ota.ota_standard_room_type (
    tenant_id UUID NOT NULL,
    hotel_id UUID NOT NULL,
    standard_room_type_id UUID NOT NULL,
    version_no BIGINT NOT NULL CHECK (version_no > 0),
    room_type_code VARCHAR(64) NOT NULL,
    display_name VARCHAR(160) NOT NULL,
    status VARCHAR(24) NOT NULL DEFAULT 'DRAFT'
        CHECK (status IN ('DRAFT', 'ACTIVE', 'RETIRED')),
    effective_from TIMESTAMPTZ NOT NULL,
    effective_until TIMESTAMPTZ,
    reason_code VARCHAR(64) NOT NULL,
    created_by_account_id UUID NOT NULL REFERENCES control.auth_account(account_id),
    row_version BIGINT NOT NULL DEFAULT 0 CHECK (row_version >= 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (tenant_id, hotel_id, standard_room_type_id, version_no),
    FOREIGN KEY (tenant_id, hotel_id) REFERENCES ota.hotel(tenant_id, hotel_id),
    UNIQUE (tenant_id, hotel_id, room_type_code, version_no),
    CHECK (btrim(room_type_code) <> ''),
    CHECK (btrim(display_name) <> ''),
    CHECK (effective_until IS NULL OR effective_until > effective_from)
);

CREATE TABLE ota.hotel_inventory_pool (
    tenant_id UUID NOT NULL,
    hotel_id UUID NOT NULL,
    inventory_pool_id UUID NOT NULL,
    pool_code VARCHAR(64) NOT NULL,
    display_name VARCHAR(160) NOT NULL,
    standard_room_type_id UUID NOT NULL,
    standard_room_type_version_no BIGINT NOT NULL,
    physical_capacity INTEGER CHECK (physical_capacity IS NULL OR physical_capacity >= 0),
    status VARCHAR(24) NOT NULL DEFAULT 'DRAFT'
        CHECK (status IN ('DRAFT', 'ACTIVE', 'RETIRED')),
    reason_code VARCHAR(64) NOT NULL,
    row_version BIGINT NOT NULL DEFAULT 0 CHECK (row_version >= 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (tenant_id, hotel_id, inventory_pool_id),
    FOREIGN KEY (tenant_id, hotel_id) REFERENCES ota.hotel(tenant_id, hotel_id),
    FOREIGN KEY (
        tenant_id, hotel_id, standard_room_type_id, standard_room_type_version_no
    ) REFERENCES ota.ota_standard_room_type(
        tenant_id, hotel_id, standard_room_type_id, version_no
    ),
    UNIQUE (tenant_id, hotel_id, pool_code),
    CHECK (btrim(pool_code) <> ''),
    CHECK (btrim(display_name) <> '')
);

CREATE TABLE ota.source_sellable_product (
    tenant_id UUID NOT NULL,
    hotel_id UUID NOT NULL,
    connector_id UUID NOT NULL,
    source_product_id UUID NOT NULL,
    product_kind VARCHAR(32) NOT NULL
        CHECK (product_kind IN ('PMS_PHYSICAL_ROOM', 'OTA_SELL_PRODUCT')),
    source_product_key_hash VARCHAR(64) NOT NULL,
    display_name VARCHAR(200) NOT NULL,
    meal_plan_code VARCHAR(64),
    sell_rule_label VARCHAR(160),
    status VARCHAR(24) NOT NULL DEFAULT 'DISCOVERED'
        CHECK (status IN ('DISCOVERED', 'ACTIVE', 'RETIRED')),
    first_observed_at TIMESTAMPTZ NOT NULL,
    last_observed_at TIMESTAMPTZ NOT NULL,
    row_version BIGINT NOT NULL DEFAULT 0 CHECK (row_version >= 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (tenant_id, hotel_id, connector_id, source_product_id),
    FOREIGN KEY (tenant_id, hotel_id, connector_id)
        REFERENCES ota.hotel_source_connector(tenant_id, hotel_id, connector_id),
    UNIQUE (tenant_id, hotel_id, connector_id, source_product_key_hash),
    CHECK (source_product_key_hash ~ '^[A-Fa-f0-9]{64}$'),
    CHECK (btrim(display_name) <> ''),
    CHECK (last_observed_at >= first_observed_at)
);

CREATE TABLE ota.source_product_mapping_version (
    tenant_id UUID NOT NULL,
    hotel_id UUID NOT NULL,
    connector_id UUID NOT NULL,
    source_product_id UUID NOT NULL,
    mapping_version_id UUID NOT NULL,
    version_no BIGINT NOT NULL CHECK (version_no > 0),
    inventory_pool_id UUID NOT NULL,
    status VARCHAR(24) NOT NULL DEFAULT 'DRAFT'
        CHECK (status IN ('DRAFT', 'ACTIVE', 'RETIRED')),
    effective_from TIMESTAMPTZ NOT NULL,
    effective_until TIMESTAMPTZ,
    reason_code VARCHAR(64) NOT NULL,
    created_by_account_id UUID NOT NULL REFERENCES control.auth_account(account_id),
    activated_at TIMESTAMPTZ,
    row_version BIGINT NOT NULL DEFAULT 0 CHECK (row_version >= 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (tenant_id, hotel_id, connector_id, source_product_id, mapping_version_id),
    FOREIGN KEY (tenant_id, hotel_id, connector_id, source_product_id)
        REFERENCES ota.source_sellable_product(tenant_id, hotel_id, connector_id, source_product_id),
    FOREIGN KEY (tenant_id, hotel_id, inventory_pool_id)
        REFERENCES ota.hotel_inventory_pool(tenant_id, hotel_id, inventory_pool_id),
    UNIQUE (tenant_id, hotel_id, connector_id, source_product_id, version_no),
    CHECK (effective_until IS NULL OR effective_until > effective_from),
    CHECK ((status = 'ACTIVE' AND activated_at IS NOT NULL) OR status <> 'ACTIVE')
);

CREATE UNIQUE INDEX uq_source_product_mapping_active
    ON ota.source_product_mapping_version(
        tenant_id, hotel_id, connector_id, source_product_id
    )
    WHERE status = 'ACTIVE';

CREATE TABLE ota.inventory_policy_version (
    tenant_id UUID NOT NULL,
    hotel_id UUID NOT NULL,
    inventory_pool_id UUID NOT NULL,
    policy_version_id UUID NOT NULL,
    version_no BIGINT NOT NULL CHECK (version_no > 0),
    policy_code VARCHAR(32) NOT NULL DEFAULT 'FULL_SYNC' CHECK (policy_code = 'FULL_SYNC'),
    status VARCHAR(24) NOT NULL DEFAULT 'DRAFT'
        CHECK (status IN ('DRAFT', 'ACTIVE', 'RETIRED')),
    effective_from TIMESTAMPTZ NOT NULL,
    effective_until TIMESTAMPTZ,
    reason_code VARCHAR(64) NOT NULL,
    created_by_account_id UUID NOT NULL REFERENCES control.auth_account(account_id),
    activated_at TIMESTAMPTZ,
    row_version BIGINT NOT NULL DEFAULT 0 CHECK (row_version >= 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (tenant_id, hotel_id, inventory_pool_id, policy_version_id),
    FOREIGN KEY (tenant_id, hotel_id, inventory_pool_id)
        REFERENCES ota.hotel_inventory_pool(tenant_id, hotel_id, inventory_pool_id),
    UNIQUE (tenant_id, hotel_id, inventory_pool_id, version_no),
    CHECK (effective_until IS NULL OR effective_until > effective_from),
    CHECK ((status = 'ACTIVE' AND activated_at IS NOT NULL) OR status <> 'ACTIVE')
);

CREATE UNIQUE INDEX uq_inventory_policy_active
    ON ota.inventory_policy_version(tenant_id, hotel_id, inventory_pool_id)
    WHERE status = 'ACTIVE';

CREATE TABLE ota.inventory_observation (
    tenant_id UUID NOT NULL,
    hotel_id UUID NOT NULL,
    inventory_observation_id UUID NOT NULL,
    run_id UUID NOT NULL,
    connector_id UUID NOT NULL,
    connector_version_id UUID NOT NULL,
    business_day_run_id UUID NOT NULL,
    pms_business_date DATE NOT NULL,
    reconciliation_epoch UUID NOT NULL,
    source_valid_at TIMESTAMPTZ,
    observed_at TIMESTAMPTZ NOT NULL,
    completeness_code VARCHAR(32) NOT NULL
        CHECK (completeness_code IN ('COMPLETE', 'PARTIAL', 'UNAVAILABLE')),
    evidence_ref VARCHAR(512) NOT NULL,
    content_hash VARCHAR(64) NOT NULL,
    parser_version VARCHAR(64) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (tenant_id, hotel_id, inventory_observation_id),
    FOREIGN KEY (tenant_id, hotel_id, run_id)
        REFERENCES ota.connector_collection_run(tenant_id, hotel_id, run_id),
    FOREIGN KEY (tenant_id, hotel_id, connector_id, connector_version_id)
        REFERENCES ota.hotel_source_connector_version(
            tenant_id, hotel_id, connector_id, connector_version_id
        ),
    FOREIGN KEY (tenant_id, hotel_id, business_day_run_id)
        REFERENCES ota.business_day_run(tenant_id, hotel_id, business_day_run_id),
    UNIQUE (tenant_id, hotel_id, run_id, reconciliation_epoch, content_hash),
    CHECK (evidence_ref ~ '^(object|file|fixture)://[A-Za-z0-9._:/@+-]+$'),
    CHECK (content_hash ~ '^[A-Fa-f0-9]{64}$')
);

CREATE INDEX ix_inventory_observation_epoch
    ON ota.inventory_observation(
        tenant_id, hotel_id, pms_business_date, reconciliation_epoch, observed_at
    );

CREATE TABLE ota.inventory_observation_item (
    tenant_id UUID NOT NULL,
    hotel_id UUID NOT NULL,
    inventory_observation_id UUID NOT NULL,
    observation_item_id UUID NOT NULL,
    connector_id UUID NOT NULL,
    source_product_id UUID NOT NULL,
    mapping_version_id UUID,
    inventory_pool_id UUID,
    sellable_room_count INTEGER CHECK (
        sellable_room_count IS NULL OR sellable_room_count >= 0
    ),
    sale_switch_open BOOLEAN NOT NULL DEFAULT TRUE,
    item_quality_code VARCHAR(32) NOT NULL
        CHECK (item_quality_code IN ('COMPLETE', 'MAPPING_MISSING', 'UNAVAILABLE')),
    reason_code VARCHAR(96),
    item_content_hash VARCHAR(64) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (tenant_id, hotel_id, inventory_observation_id, observation_item_id),
    FOREIGN KEY (tenant_id, hotel_id, inventory_observation_id)
        REFERENCES ota.inventory_observation(tenant_id, hotel_id, inventory_observation_id),
    FOREIGN KEY (tenant_id, hotel_id, connector_id, source_product_id)
        REFERENCES ota.source_sellable_product(tenant_id, hotel_id, connector_id, source_product_id),
    FOREIGN KEY (
        tenant_id, hotel_id, connector_id, source_product_id, mapping_version_id
    ) REFERENCES ota.source_product_mapping_version(
        tenant_id, hotel_id, connector_id, source_product_id, mapping_version_id
    ),
    FOREIGN KEY (tenant_id, hotel_id, inventory_pool_id)
        REFERENCES ota.hotel_inventory_pool(tenant_id, hotel_id, inventory_pool_id),
    UNIQUE (tenant_id, hotel_id, inventory_observation_id, connector_id, source_product_id),
    CHECK (
        (item_quality_code = 'COMPLETE'
            AND sellable_room_count IS NOT NULL
            AND mapping_version_id IS NOT NULL AND inventory_pool_id IS NOT NULL)
        OR
        (item_quality_code = 'MAPPING_MISSING'
            AND sellable_room_count IS NOT NULL
            AND mapping_version_id IS NULL AND inventory_pool_id IS NULL)
        OR
        (item_quality_code = 'UNAVAILABLE'
            AND sellable_room_count IS NULL
            AND ((mapping_version_id IS NULL AND inventory_pool_id IS NULL)
                OR (mapping_version_id IS NOT NULL AND inventory_pool_id IS NOT NULL)))
    ),
    CHECK (reason_code IS NULL OR reason_code ~ '^[A-Z0-9_]{1,96}$'),
    CHECK (item_content_hash ~ '^[A-Fa-f0-9]{64}$')
);

COMMENT ON TABLE ota.inventory_observation_item IS
    'Each OTA sellable product is observed separately. Counts mapped to one physical pool must never be summed.';

CREATE TABLE ota.source_booking (
    tenant_id UUID NOT NULL,
    hotel_id UUID NOT NULL,
    connector_id UUID NOT NULL,
    source_booking_id UUID NOT NULL,
    external_booking_id_hash VARCHAR(64) NOT NULL,
    current_revision_no BIGINT NOT NULL DEFAULT 0 CHECK (current_revision_no >= 0),
    booking_status VARCHAR(24) NOT NULL DEFAULT 'ACTIVE'
        CHECK (booking_status IN ('ACTIVE', 'CANCELLED')),
    first_observed_at TIMESTAMPTZ NOT NULL,
    last_observed_at TIMESTAMPTZ NOT NULL,
    row_version BIGINT NOT NULL DEFAULT 0 CHECK (row_version >= 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (tenant_id, hotel_id, connector_id, source_booking_id),
    FOREIGN KEY (tenant_id, hotel_id, connector_id)
        REFERENCES ota.hotel_source_connector(tenant_id, hotel_id, connector_id),
    UNIQUE (tenant_id, hotel_id, connector_id, external_booking_id_hash),
    CHECK (external_booking_id_hash ~ '^[A-Fa-f0-9]{64}$'),
    CHECK (last_observed_at >= first_observed_at)
);

CREATE TABLE ota.source_booking_revision (
    tenant_id UUID NOT NULL,
    hotel_id UUID NOT NULL,
    connector_id UUID NOT NULL,
    source_booking_id UUID NOT NULL,
    booking_revision_id UUID NOT NULL,
    revision_no BIGINT NOT NULL CHECK (revision_no > 0),
    source_revision_key_hash VARCHAR(64) NOT NULL,
    revision_type VARCHAR(24) NOT NULL
        CHECK (revision_type IN ('CREATED', 'MODIFIED', 'CANCELLED', 'RESTORED')),
    booking_status VARCHAR(24) NOT NULL CHECK (booking_status IN ('ACTIVE', 'CANCELLED')),
    source_event_at TIMESTAMPTZ NOT NULL,
    observed_at TIMESTAMPTZ NOT NULL,
    arrival_date DATE NOT NULL,
    departure_date DATE NOT NULL,
    room_quantity INTEGER NOT NULL CHECK (room_quantity > 0),
    room_revenue NUMERIC(18,2) NOT NULL,
    currency_code CHAR(3) NOT NULL DEFAULT 'CNY',
    run_id UUID NOT NULL,
    connector_version_id UUID NOT NULL,
    parser_version VARCHAR(64) NOT NULL,
    evidence_ref VARCHAR(512) NOT NULL,
    content_hash VARCHAR(64) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (tenant_id, hotel_id, connector_id, source_booking_id, booking_revision_id),
    FOREIGN KEY (tenant_id, hotel_id, connector_id, source_booking_id)
        REFERENCES ota.source_booking(tenant_id, hotel_id, connector_id, source_booking_id),
    FOREIGN KEY (tenant_id, hotel_id, run_id)
        REFERENCES ota.connector_collection_run(tenant_id, hotel_id, run_id),
    FOREIGN KEY (tenant_id, hotel_id, connector_id, connector_version_id)
        REFERENCES ota.hotel_source_connector_version(
            tenant_id, hotel_id, connector_id, connector_version_id
        ),
    UNIQUE (tenant_id, hotel_id, connector_id, source_booking_id, revision_no),
    UNIQUE (tenant_id, hotel_id, connector_id, source_revision_key_hash),
    CHECK (departure_date > arrival_date),
    CHECK (currency_code ~ '^[A-Z]{3}$'),
    CHECK (source_revision_key_hash ~ '^[A-Fa-f0-9]{64}$'),
    CHECK (evidence_ref ~ '^(object|file|fixture)://[A-Za-z0-9._:/@+-]+$'),
    CHECK (content_hash ~ '^[A-Fa-f0-9]{64}$')
);

CREATE TABLE ota.booking_room_night_delta (
    tenant_id UUID NOT NULL,
    hotel_id UUID NOT NULL,
    connector_id UUID NOT NULL,
    source_booking_id UUID NOT NULL,
    booking_revision_id UUID NOT NULL,
    room_night_delta_id UUID NOT NULL,
    inventory_pool_id UUID NOT NULL,
    stay_date DATE NOT NULL,
    delta_room_nights INTEGER NOT NULL CHECK (delta_room_nights <> 0),
    delta_reason VARCHAR(32) NOT NULL
        CHECK (delta_reason IN ('BOOKED', 'MODIFIED_ADD', 'CANCELLED', 'MODIFIED_REMOVE')),
    pms_business_date_at_event DATE,
    business_day_relation VARCHAR(24)
        CHECK (business_day_relation IN ('TODAY', 'FUTURE', 'PAST_ANOMALY', 'UNKNOWN')),
    occurred_at TIMESTAMPTZ NOT NULL,
    content_hash VARCHAR(64) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (
        tenant_id, hotel_id, connector_id, source_booking_id,
        booking_revision_id, room_night_delta_id
    ),
    FOREIGN KEY (
        tenant_id, hotel_id, connector_id, source_booking_id, booking_revision_id
    ) REFERENCES ota.source_booking_revision(
        tenant_id, hotel_id, connector_id, source_booking_id, booking_revision_id
    ),
    FOREIGN KEY (tenant_id, hotel_id, inventory_pool_id)
        REFERENCES ota.hotel_inventory_pool(tenant_id, hotel_id, inventory_pool_id),
    UNIQUE (
        tenant_id, hotel_id, connector_id, source_booking_id,
        booking_revision_id, inventory_pool_id, stay_date, delta_reason
    ),
    CHECK (
        (delta_reason IN ('BOOKED', 'MODIFIED_ADD') AND delta_room_nights > 0)
        OR
        (delta_reason IN ('CANCELLED', 'MODIFIED_REMOVE') AND delta_room_nights < 0)
    ),
    CHECK (
        (pms_business_date_at_event IS NULL AND business_day_relation = 'UNKNOWN')
        OR
        (pms_business_date_at_event IS NOT NULL AND business_day_relation <> 'UNKNOWN')
    ),
    CHECK (content_hash ~ '^[A-Fa-f0-9]{64}$')
);

CREATE INDEX ix_booking_room_night_delta_window
    ON ota.booking_room_night_delta(
        tenant_id, hotel_id, occurred_at, connector_id, delta_reason
    );

CREATE TABLE ota.daily_operation_snapshot (
    tenant_id UUID NOT NULL,
    hotel_id UUID NOT NULL,
    snapshot_id UUID NOT NULL,
    business_day_run_id UUID NOT NULL,
    pms_business_date DATE NOT NULL,
    snapshot_type VARCHAR(32) NOT NULL
        CHECK (snapshot_type IN ('HOURLY_CUTOFF', 'LATE_ADJUSTMENT')),
    cutoff_at TIMESTAMPTZ NOT NULL,
    revision_no INTEGER NOT NULL CHECK (revision_no > 0),
    version_no BIGINT NOT NULL CHECK (version_no > 0),
    reconciliation_epoch UUID NOT NULL,
    facts_frozen_at TIMESTAMPTZ NOT NULL,
    computation_version VARCHAR(64) NOT NULL,
    completeness_code VARCHAR(32) NOT NULL
        CHECK (completeness_code IN ('COMPLETE', 'PARTIAL', 'UNAVAILABLE')),
    source_observation_span_seconds NUMERIC(12,3)
        CHECK (source_observation_span_seconds IS NULL OR source_observation_span_seconds >= 0),
    quality_reason_code VARCHAR(96),
    content_hash VARCHAR(64) NOT NULL,
    simulation_run_id UUID,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (tenant_id, hotel_id, snapshot_id),
    FOREIGN KEY (tenant_id, hotel_id, business_day_run_id)
        REFERENCES ota.business_day_run(tenant_id, hotel_id, business_day_run_id),
    FOREIGN KEY (tenant_id, hotel_id, simulation_run_id)
        REFERENCES ota.simulation_run(tenant_id, hotel_id, simulation_run_id),
    UNIQUE (
        tenant_id, hotel_id, business_day_run_id,
        snapshot_type, cutoff_at, revision_no
    ),
    UNIQUE (tenant_id, hotel_id, business_day_run_id, version_no),
    CHECK (cutoff_at = date_trunc('hour', cutoff_at)),
    CHECK (facts_frozen_at >= cutoff_at),
    CHECK (quality_reason_code IS NULL OR quality_reason_code ~ '^[A-Z0-9_]{1,96}$'),
    CHECK (content_hash ~ '^[A-Fa-f0-9]{64}$')
);

CREATE INDEX ix_daily_snapshot_slot
    ON ota.daily_operation_snapshot(
        tenant_id, hotel_id, pms_business_date, cutoff_at, revision_no DESC
    );

CREATE TABLE ota.daily_operation_snapshot_metric (
    tenant_id UUID NOT NULL,
    hotel_id UUID NOT NULL,
    snapshot_id UUID NOT NULL,
    metric_id UUID NOT NULL,
    metric_code VARCHAR(96) NOT NULL,
    numeric_value NUMERIC(24,6),
    text_value VARCHAR(512),
    unit_code VARCHAR(32) NOT NULL,
    currency_code CHAR(3),
    quality_code VARCHAR(32) NOT NULL
        CHECK (quality_code IN ('AVAILABLE', 'NOT_APPLICABLE', 'NOT_CONFIGURED', 'UNAVAILABLE')),
    reason_code VARCHAR(96),
    source_reference_hash VARCHAR(64),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (tenant_id, hotel_id, snapshot_id, metric_id),
    FOREIGN KEY (tenant_id, hotel_id, snapshot_id)
        REFERENCES ota.daily_operation_snapshot(tenant_id, hotel_id, snapshot_id),
    UNIQUE (tenant_id, hotel_id, snapshot_id, metric_code),
    CHECK ((numeric_value IS NOT NULL)::INTEGER + (text_value IS NOT NULL)::INTEGER <= 1),
    CHECK (
        (quality_code = 'AVAILABLE' AND (numeric_value IS NOT NULL OR text_value IS NOT NULL))
        OR quality_code <> 'AVAILABLE'
    ),
    CHECK (
        (quality_code <> 'AVAILABLE' AND numeric_value IS NULL AND text_value IS NULL)
        OR quality_code = 'AVAILABLE'
    ),
    CHECK (currency_code IS NULL OR currency_code ~ '^[A-Z]{3}$'),
    CHECK (reason_code IS NULL OR reason_code ~ '^[A-Z0-9_]{1,96}$'),
    CHECK (source_reference_hash IS NULL OR source_reference_hash ~ '^[A-Fa-f0-9]{64}$')
);

CREATE TABLE ota.ota_hourly_brief (
    tenant_id UUID NOT NULL,
    hotel_id UUID NOT NULL,
    hourly_brief_id UUID NOT NULL,
    business_day_run_id UUID NOT NULL,
    snapshot_id UUID NOT NULL,
    pms_business_date DATE NOT NULL,
    cutoff_at TIMESTAMPTZ NOT NULL,
    frozen_body TEXT NOT NULL,
    content_hash VARCHAR(64) NOT NULL,
    completeness_code VARCHAR(32) NOT NULL
        CHECK (completeness_code IN ('COMPLETE', 'PARTIAL', 'UNAVAILABLE')),
    message_short_code VARCHAR(32) NOT NULL,
    published_at TIMESTAMPTZ NOT NULL,
    simulation_run_id UUID,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (tenant_id, hotel_id, hourly_brief_id),
    FOREIGN KEY (tenant_id, hotel_id, business_day_run_id)
        REFERENCES ota.business_day_run(tenant_id, hotel_id, business_day_run_id),
    FOREIGN KEY (tenant_id, hotel_id, snapshot_id)
        REFERENCES ota.daily_operation_snapshot(tenant_id, hotel_id, snapshot_id),
    FOREIGN KEY (tenant_id, hotel_id, simulation_run_id)
        REFERENCES ota.simulation_run(tenant_id, hotel_id, simulation_run_id),
    UNIQUE (tenant_id, hotel_id, pms_business_date, cutoff_at),
    UNIQUE (tenant_id, hotel_id, message_short_code),
    CHECK (cutoff_at = date_trunc('hour', cutoff_at)),
    CHECK (length(frozen_body) BETWEEN 1 AND 12000),
    CHECK (content_hash ~ '^[A-Fa-f0-9]{64}$'),
    CHECK (message_short_code ~ '^[A-Z0-9-]{6,32}$'),
    CHECK (published_at >= cutoff_at)
);

COMMENT ON TABLE ota.ota_hourly_brief IS
    'One immutable original brief per PMS business-day hour slot. Late data creates adjustments, never a second original brief.';

CREATE TABLE ota.ota_brief_adjustment (
    tenant_id UUID NOT NULL,
    hotel_id UUID NOT NULL,
    adjustment_id UUID NOT NULL,
    hourly_brief_id UUID NOT NULL,
    simulation_run_id UUID NOT NULL,
    original_snapshot_id UUID NOT NULL,
    replacement_snapshot_id UUID NOT NULL,
    original_cutoff_at TIMESTAMPTZ NOT NULL,
    adjustment_type VARCHAR(32) NOT NULL CHECK (adjustment_type IN ('LATE_DATA', 'CORRECTION')),
    reason_code VARCHAR(96) NOT NULL,
    adjustment_summary TEXT NOT NULL,
    content_hash VARCHAR(64) NOT NULL,
    replacement_frozen_body TEXT NOT NULL,
    replacement_body_hash VARCHAR(64) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (tenant_id, hotel_id, adjustment_id),
    FOREIGN KEY (tenant_id, hotel_id, hourly_brief_id)
        REFERENCES ota.ota_hourly_brief(tenant_id, hotel_id, hourly_brief_id),
    FOREIGN KEY (tenant_id, hotel_id, simulation_run_id)
        REFERENCES ota.simulation_run(tenant_id, hotel_id, simulation_run_id),
    FOREIGN KEY (tenant_id, hotel_id, original_snapshot_id)
        REFERENCES ota.daily_operation_snapshot(tenant_id, hotel_id, snapshot_id),
    FOREIGN KEY (tenant_id, hotel_id, replacement_snapshot_id)
        REFERENCES ota.daily_operation_snapshot(tenant_id, hotel_id, snapshot_id),
    UNIQUE (tenant_id, hotel_id, hourly_brief_id, replacement_snapshot_id),
    UNIQUE (tenant_id, hotel_id, simulation_run_id),
    CHECK (original_snapshot_id <> replacement_snapshot_id),
    CHECK (reason_code ~ '^[A-Z0-9_]{1,96}$'),
    CHECK (length(adjustment_summary) BETWEEN 1 AND 4000),
    CHECK (content_hash ~ '^[A-Fa-f0-9]{64}$'),
    CHECK (length(replacement_frozen_body) BETWEEN 1 AND 12000),
    CHECK (replacement_body_hash ~ '^[A-Fa-f0-9]{64}$')
);

CREATE TABLE ota.notification_target (
    tenant_id UUID NOT NULL,
    hotel_id UUID NOT NULL,
    notification_target_id UUID NOT NULL,
    target_type VARCHAR(32) NOT NULL
        CHECK (target_type IN ('ACCOUNT', 'HOTEL_OPERATION_GROUP')),
    account_id UUID REFERENCES control.auth_account(account_id),
    endpoint_id UUID,
    at_all_required BOOLEAN NOT NULL DEFAULT TRUE,
    transport_mode VARCHAR(32) NOT NULL DEFAULT 'SIMULATION_ONLY'
        CHECK (transport_mode = 'SIMULATION_ONLY'),
    external_delivery_allowed BOOLEAN NOT NULL DEFAULT FALSE
        CHECK (NOT external_delivery_allowed),
    status VARCHAR(24) NOT NULL DEFAULT 'ACTIVE'
        CHECK (status IN ('ACTIVE', 'PAUSED', 'RETIRED')),
    row_version BIGINT NOT NULL DEFAULT 0 CHECK (row_version >= 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (tenant_id, hotel_id, notification_target_id),
    FOREIGN KEY (tenant_id, hotel_id) REFERENCES ota.hotel(tenant_id, hotel_id),
    FOREIGN KEY (tenant_id, hotel_id, endpoint_id)
        REFERENCES ota.hotel_message_endpoint(tenant_id, hotel_id, endpoint_id),
    CHECK (
        (target_type = 'ACCOUNT' AND account_id IS NOT NULL AND endpoint_id IS NULL)
        OR
        (target_type = 'HOTEL_OPERATION_GROUP' AND account_id IS NULL
            AND endpoint_id IS NOT NULL AND at_all_required)
    )
);

CREATE TABLE ota.notification_delivery (
    tenant_id UUID NOT NULL,
    hotel_id UUID NOT NULL,
    delivery_id UUID NOT NULL,
    notification_target_id UUID NOT NULL,
    notification_type VARCHAR(32) NOT NULL
        CHECK (notification_type IN ('HOURLY_BRIEF', 'P1_ALERT', 'P1_RECOVERY', 'DELIVERY_FAILURE')),
    hourly_brief_id UUID,
    incident_id UUID,
    outbox_event_id UUID NOT NULL,
    idempotency_key VARCHAR(255) NOT NULL,
    message_short_code VARCHAR(32) NOT NULL,
    frozen_payload TEXT NOT NULL,
    payload_hash VARCHAR(64) NOT NULL,
    original_cutoff_at TIMESTAMPTZ,
    transport_mode VARCHAR(32) NOT NULL DEFAULT 'SIMULATION_ONLY'
        CHECK (transport_mode = 'SIMULATION_ONLY'),
    external_delivery_allowed BOOLEAN NOT NULL DEFAULT FALSE
        CHECK (NOT external_delivery_allowed),
    delivery_status VARCHAR(32) NOT NULL DEFAULT 'PENDING'
        CHECK (delivery_status IN (
            'PENDING', 'LEASED', 'SIMULATED', 'FAILED', 'AMBIGUOUS', 'SKIPPED_OBSOLETE'
        )),
    available_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count BETWEEN 0 AND 4),
    leased_by_service_principal_id UUID REFERENCES control.service_principal(service_principal_id),
    lease_id UUID,
    lease_until TIMESTAMPTZ,
    final_outcome_code VARCHAR(64),
    completed_at TIMESTAMPTZ,
    row_version BIGINT NOT NULL DEFAULT 0 CHECK (row_version >= 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (tenant_id, hotel_id, delivery_id),
    FOREIGN KEY (tenant_id, hotel_id, notification_target_id)
        REFERENCES ota.notification_target(tenant_id, hotel_id, notification_target_id),
    FOREIGN KEY (tenant_id, hotel_id, hourly_brief_id)
        REFERENCES ota.ota_hourly_brief(tenant_id, hotel_id, hourly_brief_id),
    FOREIGN KEY (tenant_id, hotel_id, incident_id)
        REFERENCES ota.ota_incident(tenant_id, hotel_id, incident_id),
    FOREIGN KEY (tenant_id, hotel_id, outbox_event_id)
        REFERENCES ota.ota_outbox_event(tenant_id, hotel_id, event_id),
    UNIQUE (tenant_id, hotel_id, idempotency_key),
    CHECK (btrim(idempotency_key) <> ''),
    CHECK (message_short_code ~ '^[A-Z0-9-]{6,32}$'),
    CHECK (length(frozen_payload) BETWEEN 1 AND 12000),
    CHECK (payload_hash ~ '^[A-Fa-f0-9]{64}$'),
    CHECK (
        (notification_type = 'HOURLY_BRIEF' AND hourly_brief_id IS NOT NULL)
        OR notification_type <> 'HOURLY_BRIEF'
    ),
    CHECK (
        (notification_type IN ('P1_ALERT', 'P1_RECOVERY', 'DELIVERY_FAILURE')
            AND incident_id IS NOT NULL)
        OR notification_type = 'HOURLY_BRIEF'
    ),
    CHECK (
        (delivery_status = 'LEASED' AND leased_by_service_principal_id IS NOT NULL
            AND lease_id IS NOT NULL AND lease_until IS NOT NULL)
        OR delivery_status <> 'LEASED'
    ),
    CHECK (
        (delivery_status IN ('SIMULATED', 'FAILED', 'AMBIGUOUS', 'SKIPPED_OBSOLETE')
            AND completed_at IS NOT NULL)
        OR delivery_status IN ('PENDING', 'LEASED')
    ),
    CHECK (final_outcome_code IS NULL OR final_outcome_code ~ '^[A-Z0-9_]{1,64}$')
);

CREATE INDEX ix_notification_delivery_due
    ON ota.notification_delivery(
        tenant_id, hotel_id, delivery_status, available_at, original_cutoff_at
    )
    WHERE delivery_status IN ('PENDING', 'FAILED');

CREATE TABLE ota.notification_delivery_attempt (
    tenant_id UUID NOT NULL,
    hotel_id UUID NOT NULL,
    delivery_id UUID NOT NULL,
    delivery_attempt_id UUID NOT NULL,
    attempt_no INTEGER NOT NULL CHECK (attempt_no BETWEEN 1 AND 4),
    transport_mode VARCHAR(32) NOT NULL DEFAULT 'SIMULATION_ONLY'
        CHECK (transport_mode = 'SIMULATION_ONLY'),
    external_network_attempted BOOLEAN NOT NULL DEFAULT FALSE
        CHECK (NOT external_network_attempted),
    outcome_code VARCHAR(32) NOT NULL
        CHECK (outcome_code IN ('SIMULATED', 'FAILED', 'AMBIGUOUS', 'SKIPPED_OBSOLETE')),
    sanitized_error_code VARCHAR(96),
    response_fingerprint VARCHAR(160),
    attempted_at TIMESTAMPTZ NOT NULL,
    finished_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (tenant_id, hotel_id, delivery_id, delivery_attempt_id),
    FOREIGN KEY (tenant_id, hotel_id, delivery_id)
        REFERENCES ota.notification_delivery(tenant_id, hotel_id, delivery_id),
    UNIQUE (tenant_id, hotel_id, delivery_id, attempt_no),
    CHECK (sanitized_error_code IS NULL OR sanitized_error_code ~ '^[A-Z0-9_]{1,96}$'),
    CHECK (finished_at >= attempted_at)
);

COMMENT ON TABLE ota.notification_delivery IS
    'Sprint 1 outbox queue is fail-closed: only simulated outcomes exist and external_delivery_allowed is constrained false.';
COMMENT ON TABLE ota.notification_delivery_attempt IS
    'Append-only simulated delivery evidence; external_network_attempted is constrained false.';

-- Every Sprint 1 hotel-scoped table is fail-closed under a single transaction
-- tenant context. The catalog verifier enumerates all ota tables independently,
-- so adding a future table without RLS fails deployment.
DO $tenant_rls$
DECLARE
    table_name TEXT;
    tenant_tables CONSTANT TEXT[] := ARRAY[
        'hotel_business_day_config',
        'hotel_source_connector',
        'hotel_source_connector_version',
        'connector_secret_binding',
        'connector_authorization_state',
        'hotel_message_endpoint',
        'connector_collection_schedule',
        'hotel_revenue_target_version',
        'hotel_pace_curve_version',
        'hotel_pace_curve_point',
        'ota_command_idempotency',
        'simulation_run',
        'connector_collection_run',
        'connector_collection_attempt',
        'connector_stream_checkpoint',
        'source_raw_record',
        'source_import_batch',
        'pms_business_day_observation',
        'pms_business_day_transition',
        'business_day_run',
        'pms_operating_observation',
        'pms_room_charge_event',
        'source_standard_record',
        'ota_standard_room_type',
        'hotel_inventory_pool',
        'source_sellable_product',
        'source_product_mapping_version',
        'inventory_policy_version',
        'inventory_observation',
        'inventory_observation_item',
        'source_booking',
        'source_booking_revision',
        'booking_room_night_delta',
        'daily_operation_snapshot',
        'daily_operation_snapshot_metric',
        'ota_hourly_brief',
        'ota_brief_adjustment',
        'notification_target',
        'notification_delivery',
        'notification_delivery_attempt'
    ];
BEGIN
    FOREACH table_name IN ARRAY tenant_tables
    LOOP
        EXECUTE format('ALTER TABLE ota.%I ENABLE ROW LEVEL SECURITY', table_name);
        EXECUTE format('ALTER TABLE ota.%I FORCE ROW LEVEL SECURITY', table_name);
        EXECUTE format(
            'CREATE POLICY tenant_isolation ON ota.%I
             USING (tenant_id = control.current_tenant_id())
             WITH CHECK (tenant_id = control.current_tenant_id())',
            table_name
        );
    END LOOP;
END
$tenant_rls$;

-- Facts, evidence, published briefs, command receipts and attempt history are
-- append-only even for the migration owner. Corrections use a new revision.
DO $append_only_guards$
DECLARE
    table_name TEXT;
    immutable_tables CONSTANT TEXT[] := ARRAY[
        'ota_command_idempotency',
        'connector_collection_attempt',
        'source_raw_record',
        'pms_business_day_observation',
        'pms_business_day_transition',
        'pms_operating_observation',
        'pms_room_charge_event',
        'source_standard_record',
        'inventory_observation',
        'inventory_observation_item',
        'source_booking_revision',
        'booking_room_night_delta',
        'daily_operation_snapshot',
        'daily_operation_snapshot_metric',
        'ota_hourly_brief',
        'ota_brief_adjustment',
        'notification_delivery_attempt'
    ];
BEGIN
    FOREACH table_name IN ARRAY immutable_tables
    LOOP
        EXECUTE format(
            'CREATE TRIGGER %I
             BEFORE UPDATE OR DELETE ON ota.%I
             FOR EACH ROW EXECUTE FUNCTION control.reject_append_only_mutation()',
            'trg_' || table_name || '_append_only',
            table_name
        );
    END LOOP;
END
$append_only_guards$;

CREATE TRIGGER trg_tenant_command_idempotency_append_only
    BEFORE UPDATE OR DELETE ON control.tenant_command_idempotency
    FOR EACH ROW EXECUTE FUNCTION control.reject_append_only_mutation();

REVOKE ALL ON ALL TABLES IN SCHEMA control FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA ota FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA control FROM PUBLIC;

-- Runtime grants are applied only by post-migration-grants.sql after all
-- versioned migrations succeed and are catalog-verified.
