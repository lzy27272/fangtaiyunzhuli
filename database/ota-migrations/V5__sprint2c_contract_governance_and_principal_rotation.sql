-- OTA Sprint 2C offline contract governance and workload-identity rotation.
--
-- This migration does not add a REAL connector mode, external network access,
-- SecretStore resolution, collection scheduling, or message delivery. Trusted
-- contract candidates remain empty until a migration/deployment owner records
-- a reviewed build manifest.

CREATE TABLE control.connector_contract_candidate_manifest (
    candidate_id UUID PRIMARY KEY,
    connector_code VARCHAR(96) NOT NULL,
    adapter_code VARCHAR(96) NOT NULL
        REFERENCES control.connector_adapter_registry(adapter_code),
    adapter_version VARCHAR(64) NOT NULL,
    stream_code VARCHAR(64) NOT NULL,
    fingerprint_algorithm VARCHAR(32) NOT NULL DEFAULT 'SHA-256-V1'
        CHECK (fingerprint_algorithm = 'SHA-256-V1'),
    capability_fingerprint VARCHAR(64) NOT NULL
        CHECK (capability_fingerprint ~ '^[A-Fa-f0-9]{64}$'),
    schema_fingerprint VARCHAR(64) NOT NULL
        CHECK (schema_fingerprint ~ '^[A-Fa-f0-9]{64}$'),
    artifact_digest VARCHAR(64) NOT NULL
        CHECK (artifact_digest ~ '^[A-Fa-f0-9]{64}$'),
    source_revision VARCHAR(96) NOT NULL,
    registered_by_database_role NAME NOT NULL DEFAULT SESSION_USER,
    registered_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (connector_code, adapter_version, stream_code),
    UNIQUE (adapter_code, adapter_version, stream_code),
    CHECK (btrim(connector_code) <> ''),
    CHECK (btrim(adapter_version) <> ''),
    CHECK (btrim(stream_code) <> ''),
    CHECK (btrim(source_revision) <> ''),
    CHECK (adapter_code NOT IN ('PMS_INTAKE', 'CTRIP_INTAKE', 'MEITUAN_INTAKE'))
);

COMMENT ON TABLE control.connector_contract_candidate_manifest IS
    'Owner-published immutable build manifest. It contains fingerprints only and grants no runtime or external access.';

CREATE FUNCTION control.enforce_connector_contract_candidate_manifest()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog
AS $$
DECLARE
    registry_row RECORD;
BEGIN
    SELECT registry.adapter_code,
           registry.implementation_version,
           registry.capability_codes
      INTO registry_row
      FROM control.connector_adapter_registry AS registry
     WHERE registry.adapter_code = NEW.adapter_code;

    IF NOT FOUND
       OR registry_row.implementation_version IS DISTINCT FROM NEW.adapter_version
       OR cardinality(registry_row.capability_codes) = 0 THEN
        RAISE EXCEPTION USING
            ERRCODE = '55000',
            MESSAGE = 'trusted connector candidate must match a non-placeholder adapter build';
    END IF;

    NEW.capability_fingerprint := lower(NEW.capability_fingerprint);
    NEW.schema_fingerprint := lower(NEW.schema_fingerprint);
    NEW.artifact_digest := lower(NEW.artifact_digest);
    NEW.registered_by_database_role := SESSION_USER;
    NEW.registered_at := CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_connector_contract_candidate_manifest_insert
BEFORE INSERT ON control.connector_contract_candidate_manifest
FOR EACH ROW
EXECUTE FUNCTION control.enforce_connector_contract_candidate_manifest();

CREATE TRIGGER trg_connector_contract_candidate_manifest_append_only
BEFORE UPDATE OR DELETE ON control.connector_contract_candidate_manifest
FOR EACH ROW
EXECUTE FUNCTION control.reject_append_only_mutation();

-- V4 did not expose an INSERT path to the shared API role. Nevertheless, V5
-- refuses to convert any existing caller-supplied fingerprint into a trusted
-- candidate-backed approval automatically.
ALTER TABLE ota.connector_contract_approved_baseline NO FORCE ROW LEVEL SECURITY;

DO $baseline_upgrade_guard$
BEGIN
    IF EXISTS (
        SELECT 1
          FROM ota.connector_contract_approved_baseline
    ) THEN
        RAISE EXCEPTION USING
            ERRCODE = '55000',
            MESSAGE = 'V5 refuses to upgrade existing connector contract baselines without a trusted candidate';
    END IF;
END
$baseline_upgrade_guard$;

ALTER TABLE ota.connector_contract_approved_baseline
    ADD COLUMN candidate_id UUID NOT NULL
        REFERENCES control.connector_contract_candidate_manifest(candidate_id),
    ADD COLUMN approved_config_hash VARCHAR(64) NOT NULL
        CHECK (approved_config_hash ~ '^[A-Fa-f0-9]{64}$');

ALTER TABLE ota.connector_contract_approved_baseline FORCE ROW LEVEL SECURITY;

CREATE TABLE ota.connector_contract_baseline_revocation (
    tenant_id UUID NOT NULL,
    hotel_id UUID NOT NULL,
    revocation_id UUID NOT NULL,
    baseline_id UUID NOT NULL,
    revocation_reason_code VARCHAR(64) NOT NULL,
    revoked_by_account_id UUID NOT NULL
        REFERENCES control.auth_account(account_id),
    revoked_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (tenant_id, hotel_id, revocation_id),
    FOREIGN KEY (tenant_id, hotel_id, baseline_id)
        REFERENCES ota.connector_contract_approved_baseline(
            tenant_id, hotel_id, baseline_id
        ),
    UNIQUE (tenant_id, hotel_id, baseline_id),
    CHECK (revocation_reason_code ~ '^[A-Z0-9_]{1,64}$')
);

COMMENT ON TABLE ota.connector_contract_baseline_revocation IS
    'Append-only revocation fact. An approval is never updated or deleted.';

CREATE TABLE ota.connector_contract_command_receipt (
    tenant_id UUID NOT NULL,
    hotel_id UUID NOT NULL,
    command_id UUID NOT NULL,
    idempotency_key VARCHAR(255) NOT NULL,
    command_type VARCHAR(32) NOT NULL
        CHECK (command_type IN ('APPROVE_CONTRACT', 'REVOKE_CONTRACT')),
    request_hash VARCHAR(64) NOT NULL
        CHECK (request_hash ~ '^[A-Fa-f0-9]{64}$'),
    candidate_id UUID
        REFERENCES control.connector_contract_candidate_manifest(candidate_id),
    baseline_id UUID NOT NULL,
    expected_row_version BIGINT NOT NULL
        CHECK (expected_row_version IN (0, 1)),
    reason_code VARCHAR(64) NOT NULL
        CHECK (reason_code ~ '^[A-Z0-9_]{1,64}$'),
    result_code VARCHAR(32) NOT NULL
        CHECK (result_code IN ('APPROVED', 'REVOKED')),
    resulting_row_version BIGINT NOT NULL
        CHECK (resulting_row_version IN (1, 2)),
    actor_account_id UUID NOT NULL
        REFERENCES control.auth_account(account_id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (tenant_id, hotel_id, command_id),
    FOREIGN KEY (tenant_id, hotel_id) REFERENCES ota.hotel(tenant_id, hotel_id),
    UNIQUE (command_id),
    UNIQUE (tenant_id, hotel_id, idempotency_key),
    CHECK (
        (command_type = 'APPROVE_CONTRACT' AND candidate_id IS NOT NULL
            AND result_code = 'APPROVED' AND resulting_row_version = 1)
        OR
        (command_type = 'REVOKE_CONTRACT' AND candidate_id IS NULL
            AND result_code = 'REVOKED' AND resulting_row_version = 2)
    )
);

COMMENT ON TABLE ota.connector_contract_command_receipt IS
    'Append-only idempotency receipt for owner-controlled contract approval and revocation.';

CREATE TRIGGER trg_connector_contract_revocation_append_only
BEFORE UPDATE OR DELETE ON ota.connector_contract_baseline_revocation
FOR EACH ROW
EXECUTE FUNCTION control.reject_append_only_mutation();

CREATE TRIGGER trg_connector_contract_command_receipt_append_only
BEFORE UPDATE OR DELETE ON ota.connector_contract_command_receipt
FOR EACH ROW
EXECUTE FUNCTION control.reject_append_only_mutation();

ALTER TABLE ota.connector_contract_baseline_revocation ENABLE ROW LEVEL SECURITY;
ALTER TABLE ota.connector_contract_baseline_revocation FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation
ON ota.connector_contract_baseline_revocation
USING (tenant_id = control.current_tenant_id())
WITH CHECK (tenant_id = control.current_tenant_id());

ALTER TABLE ota.connector_contract_command_receipt ENABLE ROW LEVEL SECURITY;
ALTER TABLE ota.connector_contract_command_receipt FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation
ON ota.connector_contract_command_receipt
USING (tenant_id = control.current_tenant_id())
WITH CHECK (tenant_id = control.current_tenant_id());

CREATE FUNCTION control.current_authenticated_platform_admin_id()
RETURNS UUID
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
    account_text TEXT;
    session_text TEXT;
    bound_account_id UUID;
    bound_session_id UUID;
BEGIN
    account_text := nullif(btrim(current_setting('app.account_id', TRUE)), '');
    session_text := nullif(btrim(current_setting('app.auth_session_id', TRUE)), '');

    IF account_text IS NULL OR session_text IS NULL THEN
        RAISE EXCEPTION USING
            ERRCODE = '42501',
            MESSAGE = 'authenticated account and session context are required';
    END IF;

    BEGIN
        bound_account_id := account_text::UUID;
        bound_session_id := session_text::UUID;
    EXCEPTION
        WHEN invalid_text_representation THEN
            RAISE EXCEPTION USING
                ERRCODE = '42501',
                MESSAGE = 'authenticated account or session context is invalid';
    END;

    IF NOT EXISTS (
        SELECT 1
          FROM control.auth_account AS account
          JOIN control.auth_session AS session
            ON session.account_id = account.account_id
         WHERE account.account_id = bound_account_id
           AND session.session_id = bound_session_id
           AND account.status = 'ACTIVE'
           AND session.rotated_at IS NULL
           AND session.revoked_at IS NULL
           AND session.expires_at > CURRENT_TIMESTAMP
           AND session.authz_version_snapshot = account.authz_version
           AND EXISTS (
               SELECT 1
                 FROM control.account_role AS account_role
                 JOIN control.role_definition AS role_definition
                   ON role_definition.role_id = account_role.role_id
                WHERE account_role.account_id = account.account_id
                  AND role_definition.role_code = 'PLATFORM_ADMIN'
                  AND account_role.valid_from <= CURRENT_TIMESTAMP
                  AND (
                      account_role.valid_until IS NULL
                      OR account_role.valid_until > CURRENT_TIMESTAMP
                  )
           )
    ) THEN
        RAISE EXCEPTION USING
            ERRCODE = '42501',
            MESSAGE = 'an active authenticated PLATFORM_ADMIN session is required';
    END IF;

    RETURN bound_account_id;
END;
$$;

CREATE OR REPLACE FUNCTION control.enforce_connector_contract_baseline_approval()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog
AS $$
DECLARE
    session_account_id UUID;
    candidate_row RECORD;
    version_row RECORD;
BEGIN
    session_account_id := control.current_authenticated_platform_admin_id();
    IF NEW.approved_by_account_id IS DISTINCT FROM session_account_id THEN
        RAISE EXCEPTION USING
            ERRCODE = '42501',
            MESSAGE = 'connector contract approver must match the authenticated session';
    END IF;

    SELECT candidate.candidate_id,
           candidate.adapter_code,
           candidate.adapter_version,
           candidate.stream_code,
           candidate.fingerprint_algorithm,
           candidate.capability_fingerprint,
           candidate.schema_fingerprint
      INTO candidate_row
      FROM control.connector_contract_candidate_manifest AS candidate
     WHERE candidate.candidate_id = NEW.candidate_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION USING
            ERRCODE = '55000',
            MESSAGE = 'trusted connector contract candidate is unavailable';
    END IF;

    SELECT connector.adapter_code,
           version.adapter_version,
           version.config_hash
      INTO version_row
      FROM ota.hotel_source_connector AS connector
      JOIN ota.hotel_source_connector_version AS version
        ON version.tenant_id = connector.tenant_id
       AND version.hotel_id = connector.hotel_id
       AND version.connector_id = connector.connector_id
     WHERE connector.tenant_id = NEW.tenant_id
       AND connector.hotel_id = NEW.hotel_id
       AND connector.connector_id = NEW.connector_id
       AND version.connector_version_id = NEW.connector_version_id;

    IF NOT FOUND
       OR candidate_row.adapter_code IS DISTINCT FROM version_row.adapter_code
       OR candidate_row.adapter_version IS DISTINCT FROM version_row.adapter_version
       OR candidate_row.stream_code IS DISTINCT FROM NEW.stream_code THEN
        RAISE EXCEPTION USING
            ERRCODE = '55000',
            MESSAGE = 'trusted candidate does not match the connector version and stream';
    END IF;

    NEW.fingerprint_algorithm := candidate_row.fingerprint_algorithm;
    NEW.capability_fingerprint := candidate_row.capability_fingerprint;
    NEW.schema_fingerprint := candidate_row.schema_fingerprint;
    NEW.approved_config_hash := lower(version_row.config_hash);
    NEW.status := 'APPROVED';
    NEW.approved_at := CURRENT_TIMESTAMP;
    NEW.created_at := CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$;

CREATE FUNCTION control.enforce_connector_contract_baseline_revocation()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog
AS $$
DECLARE
    session_account_id UUID;
BEGIN
    session_account_id := control.current_authenticated_platform_admin_id();
    IF NEW.revoked_by_account_id IS DISTINCT FROM session_account_id THEN
        RAISE EXCEPTION USING
            ERRCODE = '42501',
            MESSAGE = 'connector contract revoker must match the authenticated session';
    END IF;

    NEW.revoked_at := CURRENT_TIMESTAMP;
    NEW.created_at := CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_connector_contract_baseline_revocation
BEFORE INSERT ON ota.connector_contract_baseline_revocation
FOR EACH ROW
EXECUTE FUNCTION control.enforce_connector_contract_baseline_revocation();

CREATE FUNCTION control.approve_connector_contract_candidate(
    p_tenant_id UUID,
    p_hotel_id UUID,
    p_connector_id UUID,
    p_connector_version_id UUID,
    p_candidate_id UUID,
    p_baseline_id UUID,
    p_stream_code TEXT,
    p_expected_row_version BIGINT,
    p_command_id UUID,
    p_idempotency_key TEXT,
    p_request_hash TEXT,
    p_reason_code TEXT
)
RETURNS TABLE(
    baseline_id UUID,
    approval_status TEXT,
    row_version BIGINT,
    result_code TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
#variable_conflict use_column
DECLARE
    actor_account_id UUID;
    existing_receipt RECORD;
    candidate_row RECORD;
    version_row RECORD;
BEGIN
    IF control.current_tenant_id() IS DISTINCT FROM p_tenant_id THEN
        RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'tenant context mismatch';
    END IF;
    actor_account_id := control.current_authenticated_platform_admin_id();

    IF p_tenant_id IS NULL
       OR p_hotel_id IS NULL
       OR p_connector_id IS NULL
       OR p_connector_version_id IS NULL
       OR p_candidate_id IS NULL
       OR p_baseline_id IS NULL
       OR p_command_id IS NULL
       OR p_stream_code IS NULL
       OR btrim(p_stream_code) = ''
       OR p_expected_row_version <> 0
       OR p_idempotency_key IS NULL
       OR btrim(p_idempotency_key) = ''
       OR length(p_idempotency_key) > 255
       OR p_request_hash !~ '^[A-Fa-f0-9]{64}$'
       OR p_reason_code !~ '^[A-Z0-9_]{1,64}$' THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid contract approval command';
    END IF;

    PERFORM pg_advisory_xact_lock(
        hashtextextended(
            p_tenant_id::TEXT || '|' || p_hotel_id::TEXT || '|' ||
            btrim(p_idempotency_key),
            0
        )
    );

    SELECT receipt.*
      INTO existing_receipt
      FROM ota.connector_contract_command_receipt AS receipt
     WHERE receipt.tenant_id = p_tenant_id
       AND receipt.hotel_id = p_hotel_id
       AND receipt.idempotency_key = btrim(p_idempotency_key);

    IF FOUND THEN
        IF existing_receipt.command_type <> 'APPROVE_CONTRACT'
           OR existing_receipt.request_hash <> lower(p_request_hash)
           OR existing_receipt.candidate_id IS DISTINCT FROM p_candidate_id
           OR existing_receipt.baseline_id IS DISTINCT FROM p_baseline_id
           OR existing_receipt.expected_row_version <> p_expected_row_version
           OR existing_receipt.reason_code <> p_reason_code THEN
            RAISE EXCEPTION USING
                ERRCODE = '23505',
                MESSAGE = 'idempotency key payload conflict';
        END IF;
        RETURN QUERY
        SELECT existing_receipt.baseline_id,
               existing_receipt.result_code::TEXT,
               existing_receipt.resulting_row_version,
               'EXISTING'::TEXT;
        RETURN;
    END IF;

    SELECT candidate.*
      INTO candidate_row
      FROM control.connector_contract_candidate_manifest AS candidate
     WHERE candidate.candidate_id = p_candidate_id;

    SELECT connector.adapter_code,
           version.adapter_version,
           version.config_hash
      INTO version_row
      FROM ota.hotel_source_connector AS connector
      JOIN ota.hotel_source_connector_version AS version
        ON version.tenant_id = connector.tenant_id
       AND version.hotel_id = connector.hotel_id
       AND version.connector_id = connector.connector_id
     WHERE connector.tenant_id = p_tenant_id
       AND connector.hotel_id = p_hotel_id
       AND connector.connector_id = p_connector_id
       AND version.connector_version_id = p_connector_version_id;

    IF candidate_row.candidate_id IS NULL
       OR version_row.adapter_code IS NULL
       OR candidate_row.adapter_code IS DISTINCT FROM version_row.adapter_code
       OR candidate_row.adapter_version IS DISTINCT FROM version_row.adapter_version
       OR candidate_row.stream_code IS DISTINCT FROM p_stream_code THEN
        RAISE EXCEPTION USING
            ERRCODE = '55000',
            MESSAGE = 'trusted connector contract candidate is unavailable';
    END IF;

    IF EXISTS (
        SELECT 1
          FROM ota.connector_contract_approved_baseline AS approval
         WHERE approval.tenant_id = p_tenant_id
           AND approval.hotel_id = p_hotel_id
           AND approval.connector_id = p_connector_id
           AND approval.connector_version_id = p_connector_version_id
           AND approval.stream_code = p_stream_code
    ) THEN
        RAISE EXCEPTION USING
            ERRCODE = '55000',
            MESSAGE = 'connector contract stream already has an approval fact';
    END IF;

    INSERT INTO ota.connector_contract_approved_baseline(
        tenant_id,
        hotel_id,
        connector_id,
        connector_version_id,
        baseline_id,
        candidate_id,
        stream_code,
        fingerprint_algorithm,
        capability_fingerprint,
        schema_fingerprint,
        approved_config_hash,
        status,
        approval_reason_code,
        approved_by_account_id
    )
    VALUES (
        p_tenant_id,
        p_hotel_id,
        p_connector_id,
        p_connector_version_id,
        p_baseline_id,
        p_candidate_id,
        p_stream_code,
        candidate_row.fingerprint_algorithm,
        candidate_row.capability_fingerprint,
        candidate_row.schema_fingerprint,
        version_row.config_hash,
        'APPROVED',
        p_reason_code,
        actor_account_id
    );

    INSERT INTO ota.connector_contract_command_receipt(
        tenant_id,
        hotel_id,
        command_id,
        idempotency_key,
        command_type,
        request_hash,
        candidate_id,
        baseline_id,
        expected_row_version,
        reason_code,
        result_code,
        resulting_row_version,
        actor_account_id
    )
    VALUES (
        p_tenant_id,
        p_hotel_id,
        p_command_id,
        btrim(p_idempotency_key),
        'APPROVE_CONTRACT',
        lower(p_request_hash),
        p_candidate_id,
        p_baseline_id,
        0,
        p_reason_code,
        'APPROVED',
        1,
        actor_account_id
    );

    INSERT INTO control.audit_event(
        audit_event_id,
        occurred_at,
        actor_type,
        actor_account_id,
        action_code,
        resource_type,
        resource_id,
        target_tenant_id,
        target_hotel_id,
        outcome_code,
        condition_hash,
        domain_evidence_id
    )
    VALUES (
        p_command_id,
        CURRENT_TIMESTAMP,
        'ACCOUNT',
        actor_account_id,
        'ota.connector-contract.approve',
        'CONNECTOR_CONTRACT_BASELINE',
        p_baseline_id,
        p_tenant_id,
        p_hotel_id,
        'SUCCEEDED',
        lower(p_request_hash),
        p_baseline_id
    );

    RETURN QUERY
    SELECT p_baseline_id, 'APPROVED'::TEXT, 1::BIGINT, 'APPROVED'::TEXT;
END;
$$;

CREATE FUNCTION control.revoke_connector_contract_baseline(
    p_tenant_id UUID,
    p_hotel_id UUID,
    p_baseline_id UUID,
    p_revocation_id UUID,
    p_expected_row_version BIGINT,
    p_command_id UUID,
    p_idempotency_key TEXT,
    p_request_hash TEXT,
    p_reason_code TEXT
)
RETURNS TABLE(
    baseline_id UUID,
    approval_status TEXT,
    row_version BIGINT,
    result_code TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
#variable_conflict use_column
DECLARE
    actor_account_id UUID;
    existing_receipt RECORD;
BEGIN
    IF control.current_tenant_id() IS DISTINCT FROM p_tenant_id THEN
        RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'tenant context mismatch';
    END IF;
    actor_account_id := control.current_authenticated_platform_admin_id();

    IF p_tenant_id IS NULL
       OR p_hotel_id IS NULL
       OR p_baseline_id IS NULL
       OR p_revocation_id IS NULL
       OR p_command_id IS NULL
       OR p_expected_row_version <> 1
       OR p_idempotency_key IS NULL
       OR btrim(p_idempotency_key) = ''
       OR length(p_idempotency_key) > 255
       OR p_request_hash !~ '^[A-Fa-f0-9]{64}$'
       OR p_reason_code !~ '^[A-Z0-9_]{1,64}$' THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid contract revocation command';
    END IF;

    PERFORM pg_advisory_xact_lock(
        hashtextextended(
            p_tenant_id::TEXT || '|' || p_hotel_id::TEXT || '|' ||
            btrim(p_idempotency_key),
            0
        )
    );

    SELECT receipt.*
      INTO existing_receipt
      FROM ota.connector_contract_command_receipt AS receipt
     WHERE receipt.tenant_id = p_tenant_id
       AND receipt.hotel_id = p_hotel_id
       AND receipt.idempotency_key = btrim(p_idempotency_key);

    IF FOUND THEN
        IF existing_receipt.command_type <> 'REVOKE_CONTRACT'
           OR existing_receipt.request_hash <> lower(p_request_hash)
           OR existing_receipt.baseline_id IS DISTINCT FROM p_baseline_id
           OR existing_receipt.expected_row_version <> p_expected_row_version
           OR existing_receipt.reason_code <> p_reason_code THEN
            RAISE EXCEPTION USING
                ERRCODE = '23505',
                MESSAGE = 'idempotency key payload conflict';
        END IF;
        RETURN QUERY
        SELECT existing_receipt.baseline_id,
               existing_receipt.result_code::TEXT,
               existing_receipt.resulting_row_version,
               'EXISTING'::TEXT;
        RETURN;
    END IF;

    IF NOT EXISTS (
        SELECT 1
          FROM ota.connector_contract_approved_baseline AS approval
         WHERE approval.tenant_id = p_tenant_id
           AND approval.hotel_id = p_hotel_id
           AND approval.baseline_id = p_baseline_id
    ) THEN
        RAISE EXCEPTION USING
            ERRCODE = '55000',
            MESSAGE = 'approved connector contract baseline was not found';
    END IF;

    IF EXISTS (
        SELECT 1
          FROM ota.connector_contract_baseline_revocation AS revocation
         WHERE revocation.tenant_id = p_tenant_id
           AND revocation.hotel_id = p_hotel_id
           AND revocation.baseline_id = p_baseline_id
    ) THEN
        RAISE EXCEPTION USING
            ERRCODE = '55000',
            MESSAGE = 'connector contract baseline is already revoked';
    END IF;

    INSERT INTO ota.connector_contract_baseline_revocation(
        tenant_id,
        hotel_id,
        revocation_id,
        baseline_id,
        revocation_reason_code,
        revoked_by_account_id
    )
    VALUES (
        p_tenant_id,
        p_hotel_id,
        p_revocation_id,
        p_baseline_id,
        p_reason_code,
        actor_account_id
    );

    INSERT INTO ota.connector_contract_command_receipt(
        tenant_id,
        hotel_id,
        command_id,
        idempotency_key,
        command_type,
        request_hash,
        candidate_id,
        baseline_id,
        expected_row_version,
        reason_code,
        result_code,
        resulting_row_version,
        actor_account_id
    )
    VALUES (
        p_tenant_id,
        p_hotel_id,
        p_command_id,
        btrim(p_idempotency_key),
        'REVOKE_CONTRACT',
        lower(p_request_hash),
        NULL,
        p_baseline_id,
        1,
        p_reason_code,
        'REVOKED',
        2,
        actor_account_id
    );

    INSERT INTO control.audit_event(
        audit_event_id,
        occurred_at,
        actor_type,
        actor_account_id,
        action_code,
        resource_type,
        resource_id,
        target_tenant_id,
        target_hotel_id,
        outcome_code,
        condition_hash,
        domain_evidence_id
    )
    VALUES (
        p_command_id,
        CURRENT_TIMESTAMP,
        'ACCOUNT',
        actor_account_id,
        'ota.connector-contract.revoke',
        'CONNECTOR_CONTRACT_BASELINE',
        p_baseline_id,
        p_tenant_id,
        p_hotel_id,
        'SUCCEEDED',
        lower(p_request_hash),
        p_revocation_id
    );

    RETURN QUERY
    SELECT p_baseline_id, 'REVOKED'::TEXT, 2::BIGINT, 'REVOKED'::TEXT;
END;
$$;

REVOKE ALL ON TABLE control.connector_contract_candidate_manifest FROM PUBLIC;
REVOKE ALL ON TABLE ota.connector_contract_baseline_revocation FROM PUBLIC;
REVOKE ALL ON TABLE ota.connector_contract_command_receipt FROM PUBLIC;
REVOKE ALL ON FUNCTION control.enforce_connector_contract_candidate_manifest() FROM PUBLIC;
REVOKE ALL ON FUNCTION control.current_authenticated_platform_admin_id() FROM PUBLIC;
REVOKE ALL ON FUNCTION control.enforce_connector_contract_baseline_revocation() FROM PUBLIC;
REVOKE ALL ON FUNCTION control.approve_connector_contract_candidate(
    UUID, UUID, UUID, UUID, UUID, UUID, TEXT, BIGINT, UUID, TEXT, TEXT, TEXT
) FROM PUBLIC;
REVOKE ALL ON FUNCTION control.revoke_connector_contract_baseline(
    UUID, UUID, UUID, UUID, BIGINT, UUID, TEXT, TEXT, TEXT
) FROM PUBLIC;

ALTER TABLE control.service_principal_database_role_binding
    ADD COLUMN binding_scope VARCHAR(32),
    ADD COLUMN database_role_oid OID,
    ADD COLUMN rotation_slot VARCHAR(8) NOT NULL DEFAULT 'BLUE'
        CHECK (rotation_slot IN ('BLUE', 'GREEN')),
    ADD COLUMN binding_state VARCHAR(16) NOT NULL DEFAULT 'ACTIVE'
        CHECK (binding_state IN ('STAGED', 'ACTIVE', 'DRAINING', 'RETIRED')),
    ADD COLUMN activated_at TIMESTAMPTZ,
    ADD COLUMN draining_at TIMESTAMPTZ,
    ADD COLUMN retired_at TIMESTAMPTZ,
    ADD COLUMN state_changed_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP;

UPDATE control.service_principal_database_role_binding AS binding
   SET binding_scope = principal.purpose,
       database_role_oid = role.oid,
       binding_state = 'ACTIVE',
       activated_at = binding.created_at,
       state_changed_at = binding.updated_at
  FROM control.service_principal AS principal,
       pg_catalog.pg_roles AS role
 WHERE principal.service_principal_id = binding.service_principal_id
   AND role.rolname = binding.database_role_name::TEXT;

DO $existing_binding_roles$
BEGIN
    IF EXISTS (
        SELECT 1
          FROM control.service_principal_database_role_binding
         WHERE database_role_oid IS NULL
    ) THEN
        RAISE EXCEPTION
            'Every existing service principal binding must resolve to a permanent database LOGIN OID';
    END IF;
END
$existing_binding_roles$;

ALTER TABLE control.service_principal_database_role_binding
    ALTER COLUMN binding_scope SET NOT NULL,
    ALTER COLUMN database_role_oid SET NOT NULL,
    ADD CONSTRAINT uq_service_principal_database_role_oid
        UNIQUE (database_role_oid),
    ADD CONSTRAINT service_principal_binding_state_time_check CHECK (
        (
            binding_state = 'STAGED'
            AND activated_at IS NULL
            AND draining_at IS NULL
            AND retired_at IS NULL
        )
        OR (
            binding_state = 'ACTIVE'
            AND activated_at IS NOT NULL
            AND draining_at IS NULL
            AND retired_at IS NULL
        )
        OR (
            binding_state = 'DRAINING'
            AND activated_at IS NOT NULL
            AND draining_at IS NOT NULL
            AND retired_at IS NULL
        )
        OR (
            binding_state = 'RETIRED'
            AND retired_at IS NOT NULL
        )
    );

CREATE UNIQUE INDEX uq_service_principal_live_scope_slot
    ON control.service_principal_database_role_binding(binding_scope, rotation_slot)
    WHERE binding_state <> 'RETIRED';

-- Every tenant RLS policy already calls this helper. Binding awareness here
-- therefore gates all direct tenant reads without widening the per-table ACL
-- matrix: ACTIVE/DRAINING workers may read, while STAGED/RETIRED/disabled
-- Worker LOGINs fail closed even if they set app.tenant_id themselves.
CREATE OR REPLACE FUNCTION control.current_tenant_id()
RETURNS UUID
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
    configured_tenant TEXT;
    session_role_oid OID;
    session_role_is_superuser BOOLEAN;
    worker_identity_known BOOLEAN;
BEGIN
    SELECT role.oid, role.rolsuper
      INTO session_role_oid, session_role_is_superuser
      FROM pg_catalog.pg_roles AS role
     WHERE role.rolname = session_user;

    SELECT EXISTS (
        SELECT 1
          FROM control.service_principal_database_role_binding AS known_binding
         WHERE known_binding.binding_scope = 'CONNECTOR_WORKER'
           AND (
               known_binding.database_role_oid = session_role_oid
               OR known_binding.database_role_name = session_user::NAME
               OR (
                   NOT COALESCE(session_role_is_superuser, FALSE)
                   AND EXISTS (
                       SELECT 1
                         FROM pg_catalog.pg_roles AS bound_role
                        WHERE bound_role.oid = known_binding.database_role_oid
                          AND pg_catalog.pg_has_role(
                              session_role_oid,
                              bound_role.oid,
                              'MEMBER'
                          )
                   )
               )
           )
    )
      INTO worker_identity_known;

    IF worker_identity_known THEN
        IF current_setting('transaction_isolation') <> 'read committed' THEN
            RAISE EXCEPTION USING
                ERRCODE = '42501',
                MESSAGE = 'Worker tenant access requires READ COMMITTED isolation';
        END IF;

        PERFORM live_binding.service_principal_id
          FROM control.service_principal_database_role_binding AS live_binding
          JOIN control.service_principal AS principal
            ON principal.service_principal_id =
               live_binding.service_principal_id
         WHERE live_binding.database_role_oid = session_role_oid
           AND live_binding.database_role_name = session_user::NAME
           AND live_binding.binding_scope = 'CONNECTOR_WORKER'
           AND (
               live_binding.binding_state = 'ACTIVE'
               OR (
                   live_binding.binding_state = 'DRAINING'
                   AND live_binding.draining_at + INTERVAL '15 minutes'
                       > statement_timestamp()
               )
           )
           AND principal.purpose = 'CONNECTOR_WORKER'
           AND principal.status = 'ACTIVE'
           AND NOT EXISTS (
               SELECT 1
                 FROM pg_catalog.pg_auth_members AS membership
                WHERE membership.member = session_role_oid
                   OR membership.roleid = session_role_oid
           );

        IF NOT FOUND THEN
            RAISE EXCEPTION USING
                ERRCODE = '42501',
                MESSAGE = 'tenant access requires an ACTIVE or DRAINING bound Worker identity';
        END IF;
    END IF;

    configured_tenant := current_setting('app.tenant_id', TRUE);
    IF configured_tenant IS NULL OR btrim(configured_tenant) = '' THEN
        RETURN NULL;
    END IF;

    BEGIN
        RETURN configured_tenant::UUID;
    EXCEPTION
        WHEN invalid_text_representation THEN
            RETURN NULL;
    END;
END;
$$;

REVOKE ALL ON FUNCTION control.current_tenant_id() FROM PUBLIC;

CREATE TABLE control.service_principal_rotation_event (
    rotation_event_id UUID PRIMARY KEY,
    rotation_id UUID NOT NULL,
    service_principal_id UUID NOT NULL
        REFERENCES control.service_principal(service_principal_id),
    counterpart_service_principal_id UUID
        REFERENCES control.service_principal(service_principal_id),
    binding_scope VARCHAR(32) NOT NULL,
    rotation_slot VARCHAR(8) NOT NULL
        CHECK (rotation_slot IN ('BLUE', 'GREEN')),
    database_role_name NAME NOT NULL,
    event_type VARCHAR(24) NOT NULL
        CHECK (event_type IN (
            'INITIAL_ACTIVATED', 'STAGED', 'PROMOTED',
            'DRAIN_STARTED', 'RETIRED', 'STAGE_CANCELLED',
            'ROLLBACK_PROMOTED', 'ROLLBACK_DRAIN_STARTED'
        )),
    reason_code VARCHAR(64) NOT NULL
        CHECK (reason_code ~ '^[A-Z0-9_]{1,64}$'),
    actor_database_role NAME NOT NULL DEFAULT SESSION_USER,
    occurred_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (rotation_id, service_principal_id, event_type)
);

COMMENT ON TABLE control.service_principal_rotation_event IS
    'Append-only owner-operated blue/green workload identity transition evidence; it stores no credential material.';

CREATE TRIGGER trg_service_principal_rotation_event_append_only
BEFORE UPDATE OR DELETE ON control.service_principal_rotation_event
FOR EACH ROW
EXECUTE FUNCTION control.reject_append_only_mutation();

CREATE FUNCTION control.enforce_service_principal_binding_rotation()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog
AS $$
DECLARE
    principal_row RECORD;
    role_row RECORD;
BEGIN
    SELECT principal.purpose, principal.status
      INTO principal_row
      FROM control.service_principal AS principal
     WHERE principal.service_principal_id = NEW.service_principal_id;

    IF NOT FOUND
       OR principal_row.purpose IS DISTINCT FROM NEW.binding_scope THEN
        RAISE EXCEPTION USING
            ERRCODE = '55000',
            MESSAGE = 'service principal binding scope does not match the principal purpose';
    END IF;

    IF NEW.binding_state <> 'RETIRED' AND principal_row.status <> 'ACTIVE' THEN
        RAISE EXCEPTION USING
            ERRCODE = '55000',
            MESSAGE = 'a live binding requires an ACTIVE service principal';
    END IF;

    SELECT role.oid,
           role.rolcanlogin,
           role.rolsuper,
           role.rolinherit,
           role.rolcreaterole,
           role.rolcreatedb,
           role.rolreplication,
           role.rolbypassrls
      INTO role_row
      FROM pg_roles AS role
     WHERE (
               TG_OP = 'INSERT'
               AND role.rolname = NEW.database_role_name::TEXT
           )
        OR (
               TG_OP = 'UPDATE'
               AND role.oid = NEW.database_role_oid
               AND role.rolname = NEW.database_role_name::TEXT
           );

    IF NOT FOUND
       OR NOT role_row.rolcanlogin
       OR role_row.rolsuper
       OR role_row.rolinherit
       OR role_row.rolcreaterole
       OR role_row.rolcreatedb
       OR role_row.rolreplication
       OR role_row.rolbypassrls
       OR EXISTS (
           SELECT 1
             FROM pg_catalog.pg_auth_members AS membership
            WHERE membership.member = role_row.oid
               OR membership.roleid = role_row.oid
       ) THEN
        RAISE EXCEPTION USING
            ERRCODE = '55000',
            MESSAGE = 'service principal binding requires a safe membership-free dedicated LOGIN role';
    END IF;

    IF TG_OP = 'INSERT' THEN
        NEW.database_role_oid := role_row.oid;
    END IF;

    IF TG_OP = 'UPDATE' AND (
        NEW.service_principal_id IS DISTINCT FROM OLD.service_principal_id
        OR NEW.database_role_name IS DISTINCT FROM OLD.database_role_name
        OR NEW.database_role_oid IS DISTINCT FROM OLD.database_role_oid
        OR NEW.binding_scope IS DISTINCT FROM OLD.binding_scope
        OR NEW.rotation_slot IS DISTINCT FROM OLD.rotation_slot
    ) THEN
        RAISE EXCEPTION USING
            ERRCODE = '55000',
            MESSAGE = 'service principal binding identity and slot are immutable';
    END IF;

    IF TG_OP = 'INSERT' THEN
        IF NEW.binding_state = 'ACTIVE' THEN
            IF EXISTS (
                SELECT 1
                  FROM control.service_principal_database_role_binding AS binding
                 WHERE binding.binding_scope = NEW.binding_scope
                   AND binding.binding_state IN ('ACTIVE', 'DRAINING')
            ) THEN
                RAISE EXCEPTION USING
                    ERRCODE = '55000',
                    MESSAGE = 'only the first binding may be activated without a blue/green promotion';
            END IF;
            NEW.activated_at := CURRENT_TIMESTAMP;
        ELSIF NEW.binding_state <> 'STAGED' THEN
            RAISE EXCEPTION USING
                ERRCODE = '55000',
                MESSAGE = 'a new service principal binding must be STAGED or the initial ACTIVE binding';
        END IF;
    ELSIF NEW.binding_state IS DISTINCT FROM OLD.binding_state THEN
        IF OLD.binding_state = 'ACTIVE' AND NEW.binding_state = 'DRAINING' THEN
            IF NOT EXISTS (
                SELECT 1
                  FROM control.service_principal_database_role_binding AS replacement
                 WHERE replacement.binding_scope = OLD.binding_scope
                   AND replacement.service_principal_id <> OLD.service_principal_id
                   AND (
                       replacement.binding_state = 'STAGED'
                       OR (
                           current_setting(
                               'ota.rotation_transition',
                               TRUE
                           ) = 'ROLLBACK'
                           AND replacement.binding_state = 'DRAINING'
                       )
                   )
            ) THEN
                RAISE EXCEPTION USING
                    ERRCODE = '55000',
                    MESSAGE = 'an ACTIVE binding may drain only when a distinct STAGED replacement exists';
            END IF;
            NEW.draining_at := CURRENT_TIMESTAMP;
        ELSIF OLD.binding_state = 'STAGED' AND NEW.binding_state = 'ACTIVE' THEN
            IF NOT EXISTS (
                SELECT 1
                  FROM control.service_principal_database_role_binding AS predecessor
                 WHERE predecessor.binding_scope = OLD.binding_scope
                   AND predecessor.service_principal_id <> OLD.service_principal_id
                   AND predecessor.binding_state = 'DRAINING'
            ) THEN
                RAISE EXCEPTION USING
                    ERRCODE = '55000',
                    MESSAGE = 'a STAGED binding may activate only after its predecessor starts draining';
            END IF;
            NEW.activated_at := CURRENT_TIMESTAMP;
        ELSIF OLD.binding_state = 'STAGED' AND NEW.binding_state = 'RETIRED' THEN
            NEW.retired_at := CURRENT_TIMESTAMP;
        ELSIF OLD.binding_state = 'DRAINING'
              AND NEW.binding_state = 'ACTIVE'
              AND current_setting('ota.rotation_transition', TRUE) = 'ROLLBACK' THEN
            IF NOT EXISTS (
                SELECT 1
                  FROM control.service_principal_database_role_binding AS failed_replacement
                 WHERE failed_replacement.binding_scope = OLD.binding_scope
                   AND failed_replacement.service_principal_id <>
                       OLD.service_principal_id
                   AND failed_replacement.binding_state = 'DRAINING'
            ) THEN
                RAISE EXCEPTION USING
                    ERRCODE = '55000',
                    MESSAGE = 'rollback activation requires the failed replacement to be DRAINING';
            END IF;
            NEW.draining_at := NULL;
        ELSIF OLD.binding_state = 'DRAINING' AND NEW.binding_state = 'RETIRED' THEN
            IF NOT EXISTS (
                SELECT 1
                  FROM control.service_principal_database_role_binding AS replacement
                  JOIN control.service_principal AS replacement_principal
                    ON replacement_principal.service_principal_id =
                       replacement.service_principal_id
                 WHERE replacement.binding_scope = OLD.binding_scope
                   AND replacement.service_principal_id <> OLD.service_principal_id
                   AND replacement.binding_state = 'ACTIVE'
                   AND replacement_principal.status = 'ACTIVE'
            ) THEN
                RAISE EXCEPTION USING
                    ERRCODE = '55000',
                    MESSAGE = 'a DRAINING binding requires an ACTIVE replacement before retirement';
            END IF;
            IF EXISTS (
                SELECT 1
                  FROM control.ota_job_registry AS job
                 WHERE job.leased_by_service_principal_id =
                       OLD.service_principal_id
                   AND job.job_state = 'LEASED'
                   AND job.lease_until > clock_timestamp()
            ) THEN
                RAISE EXCEPTION USING
                    ERRCODE = '55000',
                    MESSAGE = 'a service principal with an unexpired lease cannot be retired';
            END IF;
            NEW.retired_at := CURRENT_TIMESTAMP;
        ELSE
            RAISE EXCEPTION USING
                ERRCODE = '55000',
                MESSAGE = 'illegal service principal binding state transition';
        END IF;
    END IF;

    NEW.updated_at := CURRENT_TIMESTAMP;
    NEW.state_changed_at := CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_service_principal_binding_rotation
BEFORE INSERT OR UPDATE ON control.service_principal_database_role_binding
FOR EACH ROW
EXECUTE FUNCTION control.enforce_service_principal_binding_rotation();

CREATE TRIGGER trg_service_principal_binding_delete_forbidden
BEFORE DELETE ON control.service_principal_database_role_binding
FOR EACH ROW
EXECUTE FUNCTION control.reject_append_only_mutation();

CREATE FUNCTION control.enforce_service_principal_disable_after_retirement()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog
AS $$
BEGIN
    IF OLD.status = 'DISABLED' AND NEW.status <> 'DISABLED' THEN
        RAISE EXCEPTION USING
            ERRCODE = '55000',
            MESSAGE = 'a DISABLED service principal cannot be reactivated';
    END IF;

    IF OLD.status = 'ACTIVE'
       AND NEW.status = 'DISABLED'
       AND OLD.purpose = 'CONNECTOR_WORKER'
       AND NOT EXISTS (
           SELECT 1
             FROM control.service_principal_database_role_binding AS binding
            WHERE binding.service_principal_id = OLD.service_principal_id
              AND binding.binding_state = 'RETIRED'
       ) THEN
        RAISE EXCEPTION USING
            ERRCODE = '55000',
            MESSAGE = 'a CONNECTOR_WORKER principal must retire its binding before disablement';
    END IF;

    IF NEW.status = 'DISABLED' THEN
        NEW.disabled_at := COALESCE(NEW.disabled_at, CURRENT_TIMESTAMP);
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_service_principal_disable_after_retirement
BEFORE UPDATE ON control.service_principal
FOR EACH ROW
EXECUTE FUNCTION control.enforce_service_principal_disable_after_retirement();

CREATE OR REPLACE FUNCTION control.current_bound_service_principal_id()
RETURNS UUID
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
    bound_principal_id UUID;
BEGIN
    IF current_setting('transaction_isolation') <> 'read committed' THEN
        RAISE EXCEPTION USING
            ERRCODE = '42501',
            MESSAGE = 'Worker identity resolution requires READ COMMITTED isolation';
    END IF;

    SELECT principal.service_principal_id
      INTO bound_principal_id
      FROM control.service_principal_database_role_binding AS binding
      JOIN control.service_principal AS principal
        ON principal.service_principal_id = binding.service_principal_id
      JOIN pg_catalog.pg_roles AS session_role
        ON session_role.rolname = session_user
     WHERE binding.database_role_oid = session_role.oid
       AND binding.database_role_name = session_user::NAME
       AND (
           binding.binding_state = 'ACTIVE'
           OR (
               binding.binding_state = 'DRAINING'
               AND binding.draining_at + INTERVAL '15 minutes'
                   > clock_timestamp()
           )
       )
       AND principal.status = 'ACTIVE'
       AND NOT EXISTS (
           SELECT 1
             FROM pg_catalog.pg_auth_members AS membership
            WHERE membership.member = session_role.oid
               OR membership.roleid = session_role.oid
       )
     FOR SHARE OF binding;

    RETURN bound_principal_id;
END;
$$;

CREATE OR REPLACE FUNCTION control.assert_session_service_principal(
    p_service_principal_id UUID,
    p_allowed_purposes TEXT[]
)
RETURNS VOID
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
BEGIN
    IF p_service_principal_id IS NULL
       OR p_allowed_purposes IS NULL
       OR cardinality(p_allowed_purposes) = 0 THEN
        RAISE EXCEPTION USING
            ERRCODE = '42501',
            MESSAGE = 'database session is not bound to the requested live service principal';
    END IF;

    IF current_setting('transaction_isolation') <> 'read committed' THEN
        RAISE EXCEPTION USING
            ERRCODE = '42501',
            MESSAGE = 'Worker job access requires READ COMMITTED isolation';
    END IF;

    PERFORM binding.service_principal_id
      FROM control.service_principal_database_role_binding AS binding
      JOIN control.service_principal AS principal
        ON principal.service_principal_id = binding.service_principal_id
      JOIN pg_catalog.pg_roles AS session_role
        ON session_role.rolname = session_user
     WHERE binding.database_role_oid = session_role.oid
       AND binding.database_role_name = session_user::NAME
       AND binding.service_principal_id = p_service_principal_id
       AND (
           binding.binding_state = 'ACTIVE'
           OR (
               binding.binding_state = 'DRAINING'
               AND binding.draining_at + INTERVAL '15 minutes'
                   > clock_timestamp()
           )
       )
       AND principal.status = 'ACTIVE'
       AND principal.purpose = ANY (p_allowed_purposes)
       AND NOT EXISTS (
           SELECT 1
             FROM pg_catalog.pg_auth_members AS membership
            WHERE membership.member = session_role.oid
               OR membership.roleid = session_role.oid
       )
     FOR SHARE OF binding;

    IF NOT FOUND THEN
        RAISE EXCEPTION USING
            ERRCODE = '42501',
            MESSAGE = 'database session is not bound to the requested live service principal';
    END IF;
END;
$$;

CREATE FUNCTION control.assert_session_active_service_principal(
    p_service_principal_id UUID,
    p_allowed_purposes TEXT[]
)
RETURNS VOID
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
BEGIN
    IF p_service_principal_id IS NULL
       OR p_allowed_purposes IS NULL
       OR cardinality(p_allowed_purposes) = 0 THEN
        RAISE EXCEPTION USING
            ERRCODE = '42501',
            MESSAGE = 'database session is not bound to the requested ACTIVE service principal';
    END IF;

    IF current_setting('transaction_isolation') <> 'read committed' THEN
        RAISE EXCEPTION USING
            ERRCODE = '42501',
            MESSAGE = 'Worker job access requires READ COMMITTED isolation';
    END IF;

    PERFORM binding.service_principal_id
      FROM control.service_principal_database_role_binding AS binding
      JOIN control.service_principal AS principal
        ON principal.service_principal_id = binding.service_principal_id
      JOIN pg_catalog.pg_roles AS session_role
        ON session_role.rolname = session_user
     WHERE binding.database_role_oid = session_role.oid
       AND binding.database_role_name = session_user::NAME
       AND binding.service_principal_id = p_service_principal_id
       AND binding.binding_state = 'ACTIVE'
       AND principal.status = 'ACTIVE'
       AND principal.purpose = ANY (p_allowed_purposes)
       AND NOT EXISTS (
           SELECT 1
             FROM pg_catalog.pg_auth_members AS membership
            WHERE membership.member = session_role.oid
               OR membership.roleid = session_role.oid
       )
     FOR SHARE OF binding;

    IF NOT FOUND THEN
        RAISE EXCEPTION USING
            ERRCODE = '42501',
            MESSAGE = 'database session is not bound to the requested ACTIVE service principal';
    END IF;
END;
$$;

CREATE FUNCTION control.stage_service_principal_binding(
    p_service_principal_id UUID,
    p_database_role_name NAME,
    p_rotation_slot TEXT,
    p_rotation_id UUID,
    p_reason_code TEXT
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
    principal_row RECORD;
    existing_binding RECORD;
    initial_binding BOOLEAN;
    desired_state TEXT;
BEGIN
    IF p_service_principal_id IS NULL
       OR p_database_role_name IS NULL
       OR btrim(p_database_role_name::TEXT) = ''
       OR p_rotation_slot NOT IN ('BLUE', 'GREEN')
       OR p_rotation_id IS NULL
       OR p_reason_code !~ '^[A-Z0-9_]{1,64}$' THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid service principal stage request';
    END IF;

    PERFORM pg_advisory_xact_lock(
        hashtextextended('CONNECTOR_WORKER_ROTATION', 0)
    );

    SELECT principal.purpose, principal.status
      INTO principal_row
      FROM control.service_principal AS principal
     WHERE principal.service_principal_id = p_service_principal_id
     FOR UPDATE;

    IF NOT FOUND
       OR principal_row.purpose <> 'CONNECTOR_WORKER'
       OR principal_row.status <> 'ACTIVE' THEN
        RAISE EXCEPTION USING
            ERRCODE = '55000',
            MESSAGE = 'staging requires an ACTIVE CONNECTOR_WORKER principal';
    END IF;

    SELECT binding.*
      INTO existing_binding
      FROM control.service_principal_database_role_binding AS binding
     WHERE binding.service_principal_id = p_service_principal_id;

    IF FOUND THEN
        IF existing_binding.database_role_name IS DISTINCT FROM p_database_role_name
           OR existing_binding.binding_scope <> 'CONNECTOR_WORKER'
           OR existing_binding.rotation_slot <> p_rotation_slot
           OR existing_binding.binding_state = 'RETIRED' THEN
            RAISE EXCEPTION USING
                ERRCODE = '55000',
                MESSAGE = 'service principal is already bound to different immutable rotation metadata';
        END IF;
        RETURN existing_binding.binding_state;
    END IF;

    initial_binding := NOT EXISTS (
        SELECT 1
          FROM control.service_principal_database_role_binding AS binding
         WHERE binding.binding_scope = 'CONNECTOR_WORKER'
           AND binding.binding_state IN ('ACTIVE', 'DRAINING')
    );
    desired_state := CASE WHEN initial_binding THEN 'ACTIVE' ELSE 'STAGED' END;

    INSERT INTO control.service_principal_database_role_binding(
        service_principal_id,
        database_role_name,
        binding_reason,
        binding_scope,
        rotation_slot,
        binding_state
    )
    VALUES (
        p_service_principal_id,
        p_database_role_name,
        p_reason_code,
        'CONNECTOR_WORKER',
        p_rotation_slot,
        desired_state
    );

    INSERT INTO control.service_principal_rotation_event(
        rotation_event_id,
        rotation_id,
        service_principal_id,
        counterpart_service_principal_id,
        binding_scope,
        rotation_slot,
        database_role_name,
        event_type,
        reason_code
    )
    VALUES (
        md5(
            p_rotation_id::TEXT || '|' ||
            CASE WHEN initial_binding THEN 'INITIAL_ACTIVATED' ELSE 'STAGED' END ||
            '|' || p_service_principal_id::TEXT
        )::UUID,
        p_rotation_id,
        p_service_principal_id,
        NULL,
        'CONNECTOR_WORKER',
        p_rotation_slot,
        p_database_role_name,
        CASE WHEN initial_binding THEN 'INITIAL_ACTIVATED' ELSE 'STAGED' END,
        p_reason_code
    );

    RETURN desired_state;
END;
$$;

CREATE FUNCTION control.promote_service_principal_binding(
    p_new_service_principal_id UUID,
    p_old_service_principal_id UUID,
    p_rotation_id UUID,
    p_reason_code TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
    new_binding RECORD;
    old_binding RECORD;
BEGIN
    IF p_new_service_principal_id IS NULL
       OR p_old_service_principal_id IS NULL
       OR p_new_service_principal_id = p_old_service_principal_id
       OR p_rotation_id IS NULL
       OR p_reason_code !~ '^[A-Z0-9_]{1,64}$' THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid service principal promotion request';
    END IF;

    PERFORM pg_advisory_xact_lock(
        hashtextextended('CONNECTOR_WORKER_ROTATION', 0)
    );

    SELECT binding.*
      INTO old_binding
      FROM control.service_principal_database_role_binding AS binding
     WHERE binding.service_principal_id = p_old_service_principal_id
     FOR UPDATE;
    SELECT binding.*
      INTO new_binding
      FROM control.service_principal_database_role_binding AS binding
     WHERE binding.service_principal_id = p_new_service_principal_id
     FOR UPDATE;

    IF old_binding.binding_state IS DISTINCT FROM 'ACTIVE'
       OR new_binding.binding_state IS DISTINCT FROM 'STAGED'
       OR old_binding.binding_scope IS DISTINCT FROM 'CONNECTOR_WORKER'
       OR new_binding.binding_scope IS DISTINCT FROM old_binding.binding_scope
       OR old_binding.database_role_name = new_binding.database_role_name
       OR old_binding.rotation_slot = new_binding.rotation_slot THEN
        RAISE EXCEPTION USING
            ERRCODE = '55000',
            MESSAGE = 'promotion requires distinct ACTIVE and STAGED blue/green bindings';
    END IF;

    UPDATE control.service_principal_database_role_binding
       SET binding_state = 'DRAINING',
           binding_reason = p_reason_code
     WHERE service_principal_id = p_old_service_principal_id;

    UPDATE control.service_principal_database_role_binding
       SET binding_state = 'ACTIVE',
           binding_reason = p_reason_code
     WHERE service_principal_id = p_new_service_principal_id;

    INSERT INTO control.service_principal_rotation_event(
        rotation_event_id, rotation_id, service_principal_id,
        counterpart_service_principal_id, binding_scope, rotation_slot,
        database_role_name, event_type, reason_code
    )
    VALUES
    (
        md5(
            p_rotation_id::TEXT || '|DRAIN_STARTED|' ||
            p_old_service_principal_id::TEXT
        )::UUID,
        p_rotation_id,
        p_old_service_principal_id,
        p_new_service_principal_id,
        old_binding.binding_scope,
        old_binding.rotation_slot,
        old_binding.database_role_name,
        'DRAIN_STARTED',
        p_reason_code
    ),
    (
        md5(
            p_rotation_id::TEXT || '|PROMOTED|' ||
            p_new_service_principal_id::TEXT
        )::UUID,
        p_rotation_id,
        p_new_service_principal_id,
        p_old_service_principal_id,
        new_binding.binding_scope,
        new_binding.rotation_slot,
        new_binding.database_role_name,
        'PROMOTED',
        p_reason_code
    );
END;
$$;

CREATE FUNCTION control.retire_service_principal_binding(
    p_retiring_service_principal_id UUID,
    p_replacement_service_principal_id UUID,
    p_rotation_id UUID,
    p_reason_code TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
    retiring_binding RECORD;
    replacement_binding RECORD;
BEGIN
    IF p_retiring_service_principal_id IS NULL
       OR p_replacement_service_principal_id IS NULL
       OR p_retiring_service_principal_id = p_replacement_service_principal_id
       OR p_rotation_id IS NULL
       OR p_reason_code !~ '^[A-Z0-9_]{1,64}$' THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid service principal retirement request';
    END IF;

    PERFORM pg_advisory_xact_lock(
        hashtextextended('CONNECTOR_WORKER_ROTATION', 0)
    );

    SELECT binding.*
      INTO retiring_binding
      FROM control.service_principal_database_role_binding AS binding
     WHERE binding.service_principal_id = p_retiring_service_principal_id
     FOR UPDATE;
    SELECT binding.*
      INTO replacement_binding
      FROM control.service_principal_database_role_binding AS binding
     WHERE binding.service_principal_id = p_replacement_service_principal_id
     FOR UPDATE;

    IF retiring_binding.binding_state IS DISTINCT FROM 'DRAINING'
       OR replacement_binding.binding_state IS DISTINCT FROM 'ACTIVE'
       OR retiring_binding.binding_scope IS DISTINCT FROM 'CONNECTOR_WORKER'
       OR replacement_binding.binding_scope IS DISTINCT FROM retiring_binding.binding_scope THEN
        RAISE EXCEPTION USING
            ERRCODE = '55000',
            MESSAGE = 'retirement requires DRAINING predecessor and ACTIVE replacement';
    END IF;

    UPDATE control.service_principal_database_role_binding
       SET binding_state = 'RETIRED',
           binding_reason = p_reason_code
     WHERE service_principal_id = p_retiring_service_principal_id;

    UPDATE control.service_principal
       SET status = 'DISABLED',
           disabled_at = CURRENT_TIMESTAMP
     WHERE service_principal_id = p_retiring_service_principal_id
       AND status = 'ACTIVE';

    INSERT INTO control.service_principal_rotation_event(
        rotation_event_id, rotation_id, service_principal_id,
        counterpart_service_principal_id, binding_scope, rotation_slot,
        database_role_name, event_type, reason_code
    )
    VALUES (
        md5(
            p_rotation_id::TEXT || '|RETIRED|' ||
            p_retiring_service_principal_id::TEXT
        )::UUID,
        p_rotation_id,
        p_retiring_service_principal_id,
        p_replacement_service_principal_id,
        retiring_binding.binding_scope,
        retiring_binding.rotation_slot,
        retiring_binding.database_role_name,
        'RETIRED',
        p_reason_code
    );
END;
$$;

CREATE FUNCTION control.cancel_staged_service_principal_binding(
    p_staged_service_principal_id UUID,
    p_rotation_id UUID,
    p_reason_code TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
    staged_binding RECORD;
BEGIN
    IF p_staged_service_principal_id IS NULL
       OR p_rotation_id IS NULL
       OR p_reason_code !~ '^[A-Z0-9_]{1,64}$' THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid staged binding cancellation';
    END IF;

    PERFORM pg_advisory_xact_lock(
        hashtextextended('CONNECTOR_WORKER_ROTATION', 0)
    );

    SELECT binding.*
      INTO staged_binding
      FROM control.service_principal_database_role_binding AS binding
     WHERE binding.service_principal_id = p_staged_service_principal_id
     FOR UPDATE;

    IF staged_binding.binding_state IS DISTINCT FROM 'STAGED'
       OR staged_binding.binding_scope IS DISTINCT FROM 'CONNECTOR_WORKER' THEN
        RAISE EXCEPTION USING
            ERRCODE = '55000',
            MESSAGE = 'only a STAGED CONNECTOR_WORKER binding may be cancelled';
    END IF;

    UPDATE control.service_principal_database_role_binding
       SET binding_state = 'RETIRED',
           binding_reason = p_reason_code
     WHERE service_principal_id = p_staged_service_principal_id;

    UPDATE control.service_principal
       SET status = 'DISABLED',
           disabled_at = CURRENT_TIMESTAMP
     WHERE service_principal_id = p_staged_service_principal_id
       AND status = 'ACTIVE';

    INSERT INTO control.service_principal_rotation_event(
        rotation_event_id, rotation_id, service_principal_id,
        counterpart_service_principal_id, binding_scope, rotation_slot,
        database_role_name, event_type, reason_code
    )
    VALUES (
        md5(
            p_rotation_id::TEXT || '|STAGE_CANCELLED|' ||
            p_staged_service_principal_id::TEXT
        )::UUID,
        p_rotation_id,
        p_staged_service_principal_id,
        NULL,
        staged_binding.binding_scope,
        staged_binding.rotation_slot,
        staged_binding.database_role_name,
        'STAGE_CANCELLED',
        p_reason_code
    );
END;
$$;

CREATE FUNCTION control.rollback_service_principal_promotion(
    p_failed_service_principal_id UUID,
    p_previous_service_principal_id UUID,
    p_rotation_id UUID,
    p_reason_code TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
    failed_binding RECORD;
    previous_binding RECORD;
BEGIN
    IF p_failed_service_principal_id IS NULL
       OR p_previous_service_principal_id IS NULL
       OR p_failed_service_principal_id = p_previous_service_principal_id
       OR p_rotation_id IS NULL
       OR p_reason_code !~ '^[A-Z0-9_]{1,64}$' THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid service principal rollback request';
    END IF;

    PERFORM pg_advisory_xact_lock(
        hashtextextended('CONNECTOR_WORKER_ROTATION', 0)
    );

    SELECT binding.*
      INTO failed_binding
      FROM control.service_principal_database_role_binding AS binding
     WHERE binding.service_principal_id = p_failed_service_principal_id
     FOR UPDATE;
    SELECT binding.*
      INTO previous_binding
      FROM control.service_principal_database_role_binding AS binding
     WHERE binding.service_principal_id = p_previous_service_principal_id
     FOR UPDATE;

    IF failed_binding.binding_state IS DISTINCT FROM 'ACTIVE'
       OR previous_binding.binding_state IS DISTINCT FROM 'DRAINING'
       OR failed_binding.binding_scope IS DISTINCT FROM 'CONNECTOR_WORKER'
       OR previous_binding.binding_scope IS DISTINCT FROM failed_binding.binding_scope
       OR failed_binding.database_role_name = previous_binding.database_role_name
       OR failed_binding.rotation_slot = previous_binding.rotation_slot THEN
        RAISE EXCEPTION USING
            ERRCODE = '55000',
            MESSAGE = 'rollback requires the promoted ACTIVE identity and its DRAINING predecessor';
    END IF;

    PERFORM set_config('ota.rotation_transition', 'ROLLBACK', TRUE);

    UPDATE control.service_principal_database_role_binding
       SET binding_state = 'DRAINING',
           binding_reason = p_reason_code
     WHERE service_principal_id = p_failed_service_principal_id;

    UPDATE control.service_principal_database_role_binding
       SET binding_state = 'ACTIVE',
           draining_at = NULL,
           binding_reason = p_reason_code
     WHERE service_principal_id = p_previous_service_principal_id;

    INSERT INTO control.service_principal_rotation_event(
        rotation_event_id, rotation_id, service_principal_id,
        counterpart_service_principal_id, binding_scope, rotation_slot,
        database_role_name, event_type, reason_code
    )
    VALUES
    (
        md5(
            p_rotation_id::TEXT || '|ROLLBACK_DRAIN_STARTED|' ||
            p_failed_service_principal_id::TEXT
        )::UUID,
        p_rotation_id,
        p_failed_service_principal_id,
        p_previous_service_principal_id,
        failed_binding.binding_scope,
        failed_binding.rotation_slot,
        failed_binding.database_role_name,
        'ROLLBACK_DRAIN_STARTED',
        p_reason_code
    ),
    (
        md5(
            p_rotation_id::TEXT || '|ROLLBACK_PROMOTED|' ||
            p_previous_service_principal_id::TEXT
        )::UUID,
        p_rotation_id,
        p_previous_service_principal_id,
        p_failed_service_principal_id,
        previous_binding.binding_scope,
        previous_binding.rotation_slot,
        previous_binding.database_role_name,
        'ROLLBACK_PROMOTED',
        p_reason_code
    );
END;
$$;

CREATE FUNCTION control.read_effective_connector_contract_baseline(
    p_tenant_id UUID,
    p_hotel_id UUID,
    p_connector_id UUID,
    p_connector_version_id UUID,
    p_stream_code TEXT
)
RETURNS TABLE(
    connector_code TEXT,
    adapter_version TEXT,
    fingerprint_algorithm TEXT,
    capability_fingerprint TEXT,
    schema_fingerprint TEXT,
    approval_status TEXT,
    connector_version_status TEXT
)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
    bound_principal_id UUID;
BEGIN
    IF control.current_tenant_id() IS DISTINCT FROM p_tenant_id THEN
        RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'tenant context mismatch';
    END IF;

    bound_principal_id := control.current_bound_service_principal_id();
    IF bound_principal_id IS NULL
       OR NOT EXISTS (
           SELECT 1
             FROM control.service_principal AS principal
            WHERE principal.service_principal_id = bound_principal_id
              AND principal.purpose = 'CONNECTOR_WORKER'
              AND principal.status = 'ACTIVE'
       ) THEN
        RAISE EXCEPTION USING
            ERRCODE = '42501',
            MESSAGE = 'an ACTIVE bound CONNECTOR_WORKER session is required';
    END IF;

    RETURN QUERY
    SELECT candidate.connector_code::TEXT,
           candidate.adapter_version::TEXT,
           candidate.fingerprint_algorithm::TEXT,
           candidate.capability_fingerprint::TEXT,
           candidate.schema_fingerprint::TEXT,
           CASE
               WHEN revocation.revocation_id IS NOT NULL
                    OR approval.approved_config_hash <> version.config_hash
                   THEN 'REVOKED'
               ELSE 'APPROVED'
           END::TEXT,
           version.status::TEXT
      FROM ota.hotel_source_connector AS connector
      JOIN ota.hotel_source_connector_version AS version
        ON version.tenant_id = connector.tenant_id
       AND version.hotel_id = connector.hotel_id
       AND version.connector_id = connector.connector_id
      JOIN control.connector_contract_candidate_manifest AS candidate
        ON candidate.adapter_code = connector.adapter_code
       AND candidate.adapter_version = version.adapter_version
       AND candidate.stream_code = p_stream_code
      JOIN ota.connector_contract_approved_baseline AS approval
        ON approval.tenant_id = version.tenant_id
       AND approval.hotel_id = version.hotel_id
       AND approval.connector_id = version.connector_id
       AND approval.connector_version_id = version.connector_version_id
       AND approval.candidate_id = candidate.candidate_id
       AND approval.stream_code = candidate.stream_code
      LEFT JOIN ota.connector_contract_baseline_revocation AS revocation
        ON revocation.tenant_id = approval.tenant_id
       AND revocation.hotel_id = approval.hotel_id
       AND revocation.baseline_id = approval.baseline_id
     WHERE connector.tenant_id = p_tenant_id
       AND connector.hotel_id = p_hotel_id
       AND connector.connector_id = p_connector_id
       AND version.connector_version_id = p_connector_version_id;
END;
$$;

REVOKE ALL ON TABLE control.service_principal_rotation_event FROM PUBLIC;
REVOKE ALL ON FUNCTION control.enforce_service_principal_binding_rotation() FROM PUBLIC;
REVOKE ALL ON FUNCTION control.enforce_service_principal_disable_after_retirement() FROM PUBLIC;
REVOKE ALL ON FUNCTION control.assert_session_active_service_principal(UUID, TEXT[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION control.stage_service_principal_binding(UUID, NAME, TEXT, UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION control.promote_service_principal_binding(UUID, UUID, UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION control.retire_service_principal_binding(UUID, UUID, UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION control.cancel_staged_service_principal_binding(UUID, UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION control.rollback_service_principal_promotion(UUID, UUID, UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION control.read_effective_connector_contract_baseline(
    UUID, UUID, UUID, UUID, TEXT
) FROM PUBLIC;

-- The job registry is a global control-plane queue rather than a tenant RLS
-- table. Its trigger must establish the selected job tenant while checking the
-- RLS-protected parent connector. Tenant tables keep the caller's existing
-- context so a forged NEW.tenant_id cannot switch the RLS scope.
CREATE OR REPLACE FUNCTION control.reject_configuration_only_runtime()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
    parent_connector_mode TEXT;
    prior_tenant_setting TEXT;
    job_context_switched BOOLEAN := FALSE;
BEGIN
    prior_tenant_setting := current_setting('app.tenant_id', TRUE);

    IF TG_TABLE_SCHEMA = 'control'
       AND TG_TABLE_NAME = 'ota_job_registry' THEN
        IF NEW.tenant_id IS NULL THEN
            RAISE EXCEPTION
                'Runtime mutation requires a tenant id'
                USING ERRCODE = '55000';
        END IF;
        PERFORM set_config('app.tenant_id', NEW.tenant_id::TEXT, TRUE);
        job_context_switched := TRUE;
    END IF;

    BEGIN
        SELECT connector.connector_mode
          INTO parent_connector_mode
          FROM ota.hotel_source_connector AS connector
         WHERE connector.tenant_id = NEW.tenant_id
           AND connector.hotel_id = NEW.hotel_id
           AND connector.connector_id = NEW.connector_id;

        IF NOT FOUND THEN
            RAISE EXCEPTION
                'Runtime parent connector must be visible before runtime mutation'
                USING ERRCODE = '55000';
        END IF;

        IF parent_connector_mode = 'CONFIGURATION_ONLY' THEN
            RAISE EXCEPTION
                'CONFIGURATION_ONLY connector cannot enter schedule, job or collection runtime state'
                USING ERRCODE = '55000';
        END IF;
    EXCEPTION
        WHEN OTHERS THEN
            IF job_context_switched THEN
                PERFORM set_config(
                    'app.tenant_id',
                    COALESCE(prior_tenant_setting, ''),
                    TRUE
                );
            END IF;
            RAISE;
    END;

    IF job_context_switched THEN
        PERFORM set_config(
            'app.tenant_id',
            COALESCE(prior_tenant_setting, ''),
            TRUE
        );
    END IF;
    RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION control.reject_configuration_only_runtime() FROM PUBLIC;

ALTER TABLE control.ota_job_registry
    ADD COLUMN lease_acquired_at TIMESTAMPTZ;

UPDATE control.ota_job_registry
   SET lease_acquired_at = updated_at
 WHERE job_state = 'LEASED'
   AND lease_acquired_at IS NULL;

ALTER TABLE control.ota_job_registry
    ADD CONSTRAINT ota_job_lease_acquired_state_check CHECK (
        (job_state = 'LEASED' AND lease_acquired_at IS NOT NULL)
        OR (job_state <> 'LEASED' AND lease_acquired_at IS NULL)
    );

DO $message_delivery_must_remain_disabled$
BEGIN
    IF EXISTS (
        SELECT 1
          FROM ota.hotel
         WHERE message_enabled
    ) THEN
        RAISE EXCEPTION USING
            ERRCODE = '23514',
            MESSAGE = 'Sprint 2C requires ota.hotel.message_enabled=false';
    END IF;
END
$message_delivery_must_remain_disabled$;

ALTER TABLE ota.hotel
    ADD CONSTRAINT hotel_message_delivery_disabled
    CHECK (NOT message_enabled);

-- Caller timestamps remain in the compatibility signatures, but all schedule
-- eligibility, lease and completion authorization uses the database wall
-- clock. New dispatch/claim/renew are ACTIVE-only. DRAINING may only complete
-- a lease acquired before draining and within a fixed 15-minute drain window.
CREATE OR REPLACE FUNCTION control.dispatch_due_ota_jobs(
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
    tenant_row RECORD;
    schedule_row RECORD;
    scheduled_slot TIMESTAMPTZ;
    stable_hash TEXT;
    stable_job_id UUID;
    inserted_count INTEGER;
    elapsed_intervals INTEGER;
    dispatched_count INTEGER := 0;
    database_now TIMESTAMPTZ;
    prior_tenant_setting TEXT := current_setting('app.tenant_id', TRUE);
BEGIN
    IF p_scheduler_service_principal_id IS NULL
       OR p_now IS NULL
       OR p_batch_limit IS NULL
       OR p_batch_limit < 1
       OR p_batch_limit > 500 THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid schedule dispatch request';
    END IF;

    PERFORM control.assert_session_active_service_principal(
        p_scheduler_service_principal_id,
        ARRAY['SCHEDULER', 'CONNECTOR_WORKER']::TEXT[]
    );
    database_now := clock_timestamp();

    FOR tenant_row IN
        SELECT directory.tenant_id AS dispatch_tenant_id
          FROM control.tenant_directory AS directory
         WHERE directory.status IN ('DRAFT', 'ACTIVE')
         ORDER BY directory.tenant_id
    LOOP
        EXIT WHEN dispatched_count >= p_batch_limit;
        PERFORM set_config(
            'app.tenant_id',
            tenant_row.dispatch_tenant_id::TEXT,
            TRUE
        );

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
              FROM ota.connector_collection_schedule AS schedule
              JOIN control.tenant_directory AS tenant
                ON tenant.tenant_id = schedule.tenant_id
              JOIN ota.hotel AS hotel
                ON hotel.tenant_id = schedule.tenant_id
               AND hotel.hotel_id = schedule.hotel_id
              JOIN ota.hotel_source_connector AS connector
                ON connector.tenant_id = schedule.tenant_id
               AND connector.hotel_id = schedule.hotel_id
               AND connector.connector_id = schedule.connector_id
              JOIN control.connector_adapter_registry AS adapter
                ON adapter.adapter_code = connector.adapter_code
               AND adapter.source_type = connector.source_type
             WHERE schedule.tenant_id = tenant_row.dispatch_tenant_id
               AND schedule.enabled
               AND schedule.next_due_at <= database_now
               AND tenant.tenant_id = tenant_row.dispatch_tenant_id
               AND tenant.status IN ('DRAFT', 'ACTIVE')
               AND hotel.tenant_id = tenant_row.dispatch_tenant_id
               AND connector.tenant_id = tenant_row.dispatch_tenant_id
               AND adapter.enabled
               AND schedule.trigger_type IN ('NORMAL', 'HOURLY_CUTOFF', 'FILE_IMPORT')
               AND schedule.stream_code <> 'SIMULATION_PIPELINE'
               AND hotel.collection_enabled
               AND hotel.lifecycle_status IN ('READY_FOR_TEST', 'SHADOW', 'UAT', 'LIVE')
               AND connector.lifecycle_status IN ('READY_FOR_TEST', 'SHADOW', 'UAT')
               AND connector.connector_mode IN ('SIMULATION', 'FILE_IMPORT')
               AND EXISTS (
                   SELECT 1
                     FROM ota.hotel_source_connector_version AS version
                    WHERE version.tenant_id = tenant_row.dispatch_tenant_id
                      AND version.tenant_id = connector.tenant_id
                      AND version.hotel_id = connector.hotel_id
                      AND version.connector_id = connector.connector_id
                      AND version.status = 'ACTIVE'
               )
             ORDER BY schedule.next_due_at, schedule.priority_no,
                      schedule.tenant_id, schedule.hotel_id, schedule.schedule_id
             FOR UPDATE OF schedule SKIP LOCKED
             LIMIT (p_batch_limit - dispatched_count)
        LOOP
        scheduled_slot := CASE
            WHEN schedule_row.scheduled_trigger_type = 'HOURLY_CUTOFF'
                THEN date_trunc('hour', schedule_row.scheduled_next_due_at)
            ELSE schedule_row.scheduled_next_due_at
        END;
        stable_hash := md5(
            schedule_row.scheduled_tenant_id::TEXT || '|' ||
            schedule_row.scheduled_hotel_id::TEXT || '|' ||
            schedule_row.scheduled_schedule_id::TEXT || '|' ||
            extract(EPOCH FROM scheduled_slot)::BIGINT::TEXT
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
            extract(EPOCH FROM (database_now - schedule_row.scheduled_next_due_at))
            / 60
            / schedule_row.scheduled_interval_minutes
        )::INTEGER + 1;
        UPDATE ota.connector_collection_schedule AS schedule
           SET next_due_at = schedule_row.scheduled_next_due_at
               + make_interval(
                   mins => schedule_row.scheduled_interval_minutes * elapsed_intervals
               ),
               row_version = schedule.row_version + 1,
               updated_at = database_now
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
        dispatched_count := dispatched_count + 1;
        RETURN NEXT;
        END LOOP;
    END LOOP;

    PERFORM set_config(
        'app.tenant_id',
        COALESCE(prior_tenant_setting, ''),
        TRUE
    );
END;
$$;

CREATE OR REPLACE FUNCTION control.claim_ota_job(
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
    database_now TIMESTAMPTZ;
    database_lease_until TIMESTAMPTZ;
    requested_lease_duration INTERVAL;
BEGIN
    IF p_worker_service_principal_id IS NULL
       OR p_lease_id IS NULL
       OR p_run_id IS NULL
       OR p_now IS NULL
       OR p_lease_until IS NULL
       OR p_job_type IS NULL
       OR p_job_type NOT IN ('COLLECTION', 'SIMULATION_PIPELINE') THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid job lease request';
    END IF;
    requested_lease_duration := p_lease_until - p_now;
    IF requested_lease_duration <= INTERVAL '0 seconds'
       OR requested_lease_duration > INTERVAL '15 minutes' THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid job lease request';
    END IF;
    PERFORM control.assert_session_active_service_principal(
        p_worker_service_principal_id,
        ARRAY['CONNECTOR_WORKER']::TEXT[]
    );
    database_now := clock_timestamp();
    database_lease_until := database_now + requested_lease_duration;

    SELECT candidate.job_id
      INTO claimed_job_id
      FROM control.ota_job_registry AS candidate
     WHERE candidate.available_at <= database_now
       AND candidate.job_type = p_job_type
       AND candidate.attempt_count < candidate.max_attempts
       AND (
           candidate.job_state = 'DUE'
           OR (
               candidate.job_state = 'LEASED'
               AND candidate.lease_until <= database_now
           )
       )
     ORDER BY candidate.priority_no, candidate.available_at,
              candidate.scheduled_for, candidate.job_id
     FOR UPDATE SKIP LOCKED
     LIMIT 1;

    IF claimed_job_id IS NULL THEN
        RETURN;
    END IF;

    UPDATE control.ota_job_registry AS job
       SET job_state = 'LEASED',
           lease_id = p_lease_id,
           leased_by_service_principal_id = p_worker_service_principal_id,
           lease_until = database_lease_until,
           lease_acquired_at = database_now,
           run_id = p_run_id,
           attempt_count = job.attempt_count + 1,
           last_outcome_code = NULL,
           last_failure_code = NULL,
           completed_at = NULL,
           row_version = job.row_version + 1,
           updated_at = database_now
     WHERE job.job_id = claimed_job_id;

    RETURN QUERY
    SELECT job.job_id, job.lease_id, job.tenant_id, job.hotel_id,
           job.connector_id, job.simulation_run_id, job.job_type::TEXT,
           job.stream_code::TEXT, job.trigger_type::TEXT, job.run_id,
           job.scheduled_for, job.lease_until, job.attempt_count, job.max_attempts
      FROM control.ota_job_registry AS job
     WHERE job.job_id = claimed_job_id;
END;
$$;

-- Runtime table ACL is deliberately static across blue/green deployments.
-- Direct Worker DML and lease acquisition/renewal are ACTIVE-only. A DRAINING
-- identity may only complete a still-valid lease acquired before draining.
CREATE OR REPLACE FUNCTION control.renew_ota_job_lease(
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
    database_now TIMESTAMPTZ;
    database_lease_until TIMESTAMPTZ;
    requested_lease_duration INTERVAL;
BEGIN
    IF p_job_id IS NULL
       OR p_lease_id IS NULL
       OR p_worker_service_principal_id IS NULL
       OR p_now IS NULL
       OR p_new_lease_until IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid lease extension';
    END IF;

    requested_lease_duration := p_new_lease_until - p_now;
    IF requested_lease_duration <= INTERVAL '0 seconds'
       OR requested_lease_duration > INTERVAL '15 minutes' THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid lease extension';
    END IF;
    PERFORM control.assert_session_active_service_principal(
        p_worker_service_principal_id,
        ARRAY['CONNECTOR_WORKER']::TEXT[]
    );
    database_now := clock_timestamp();
    database_lease_until := database_now + requested_lease_duration;

    UPDATE control.ota_job_registry AS job
       SET lease_until = database_lease_until,
           row_version = job.row_version + 1,
           updated_at = database_now
     WHERE job.job_id = p_job_id
       AND job.job_state = 'LEASED'
       AND job.lease_id = p_lease_id
       AND job.leased_by_service_principal_id = p_worker_service_principal_id
       AND job.lease_until > database_now;
    GET DIAGNOSTICS updated_count = ROW_COUNT;
    RETURN updated_count = 1;
END;
$$;

CREATE OR REPLACE FUNCTION control.complete_ota_job(
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
    database_now TIMESTAMPTZ;
    live_binding_state TEXT;
    live_draining_at TIMESTAMPTZ;
BEGIN
    IF p_job_id IS NULL
       OR p_lease_id IS NULL
       OR p_worker_service_principal_id IS NULL
       OR p_now IS NULL
       OR p_outcome_code NOT IN ('SUCCEEDED', 'RETRYABLE_FAILURE', 'TERMINAL_FAILURE')
       OR (p_failure_code IS NOT NULL AND p_failure_code !~ '^[A-Z0-9_]{1,96}$')
       OR (p_outcome_code = 'SUCCEEDED' AND p_failure_code IS NOT NULL)
       OR (p_outcome_code <> 'SUCCEEDED' AND p_failure_code IS NULL) THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid job outcome';
    END IF;

    PERFORM control.assert_session_service_principal(
        p_worker_service_principal_id,
        ARRAY['CONNECTOR_WORKER']::TEXT[]
    );

    SELECT binding.binding_state, binding.draining_at
      INTO live_binding_state, live_draining_at
      FROM control.service_principal_database_role_binding AS binding
      JOIN pg_catalog.pg_roles AS session_role
        ON session_role.rolname = session_user
     WHERE binding.database_role_oid = session_role.oid
       AND binding.database_role_name = session_user::NAME
       AND binding.service_principal_id = p_worker_service_principal_id
       AND binding.binding_scope = 'CONNECTOR_WORKER'
       AND binding.binding_state IN ('ACTIVE', 'DRAINING')
       AND NOT EXISTS (
           SELECT 1
             FROM pg_catalog.pg_auth_members AS membership
            WHERE membership.member = session_role.oid
               OR membership.roleid = session_role.oid
       )
     FOR SHARE OF binding;

    IF NOT FOUND THEN
        RAISE EXCEPTION USING
            ERRCODE = '42501',
            MESSAGE = 'job completion requires a live bound Worker identity';
    END IF;
    database_now := clock_timestamp();

    UPDATE control.ota_job_registry AS job
       SET job_state = CASE
               WHEN p_outcome_code = 'SUCCEEDED' THEN 'SUCCEEDED'
               WHEN p_outcome_code = 'RETRYABLE_FAILURE'
                    AND job.attempt_count < job.max_attempts THEN 'DUE'
               ELSE 'FAILED'
           END,
           lease_id = NULL,
           leased_by_service_principal_id = NULL,
           lease_until = NULL,
           lease_acquired_at = NULL,
           last_outcome_code = p_outcome_code,
           last_failure_code = p_failure_code,
           completed_at = CASE
               WHEN p_outcome_code = 'RETRYABLE_FAILURE'
                    AND job.attempt_count < job.max_attempts THEN NULL
               ELSE database_now
           END,
           available_at = CASE
               WHEN p_outcome_code = 'RETRYABLE_FAILURE'
                    AND job.attempt_count < job.max_attempts
                   THEN database_now + CASE job.attempt_count
                       WHEN 1 THEN INTERVAL '30 seconds'
                       WHEN 2 THEN INTERVAL '2 minutes'
                       ELSE INTERVAL '5 minutes'
                   END
               ELSE job.available_at
           END,
           row_version = job.row_version + 1,
           updated_at = database_now
     WHERE job.job_id = p_job_id
       AND job.job_state = 'LEASED'
       AND job.lease_id = p_lease_id
       AND job.leased_by_service_principal_id = p_worker_service_principal_id
       AND job.lease_until >= database_now
       AND (
           live_binding_state = 'ACTIVE'
           OR (
               live_binding_state = 'DRAINING'
               AND live_draining_at IS NOT NULL
               AND database_now <= live_draining_at + INTERVAL '15 minutes'
               AND job.lease_acquired_at IS NOT NULL
               AND job.lease_acquired_at <= live_draining_at
           )
       );
    GET DIAGNOSTICS updated_count = ROW_COUNT;
    RETURN updated_count = 1;
END;
$$;

REVOKE ALL ON FUNCTION control.renew_ota_job_lease(
    UUID, UUID, UUID, TIMESTAMPTZ, TIMESTAMPTZ
) FROM PUBLIC;
REVOKE ALL ON FUNCTION control.complete_ota_job(
    UUID, UUID, UUID, TIMESTAMPTZ, TEXT, TEXT
) FROM PUBLIC;

CREATE FUNCTION control.enforce_live_worker_write_session()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
    session_role_oid OID;
    session_role_is_superuser BOOLEAN;
    worker_identity_known BOOLEAN;
BEGIN
    SELECT role.oid, role.rolsuper
      INTO session_role_oid, session_role_is_superuser
      FROM pg_catalog.pg_roles AS role
     WHERE role.rolname = session_user;

    SELECT EXISTS (
        SELECT 1
          FROM control.service_principal_database_role_binding AS known_binding
         WHERE known_binding.binding_scope = 'CONNECTOR_WORKER'
           AND (
               known_binding.database_role_oid = session_role_oid
               OR known_binding.database_role_name = session_user::NAME
               OR (
                   NOT COALESCE(session_role_is_superuser, FALSE)
                   AND EXISTS (
                       SELECT 1
                         FROM pg_catalog.pg_roles AS bound_role
                        WHERE bound_role.oid = known_binding.database_role_oid
                          AND pg_catalog.pg_has_role(
                              session_role_oid,
                              bound_role.oid,
                              'MEMBER'
                          )
                   )
               )
           )
    )
      INTO worker_identity_known;

    IF worker_identity_known THEN
        IF current_setting('transaction_isolation') <> 'read committed' THEN
            RAISE EXCEPTION USING
                ERRCODE = '42501',
                MESSAGE = 'Worker database writes require READ COMMITTED isolation';
        END IF;

        PERFORM pg_catalog.pg_advisory_xact_lock_shared(
            hashtextextended('CONNECTOR_WORKER_ROTATION', 0)
        );
        PERFORM live_binding.service_principal_id
          FROM control.service_principal_database_role_binding AS live_binding
          JOIN control.service_principal AS principal
            ON principal.service_principal_id =
               live_binding.service_principal_id
         WHERE live_binding.database_role_oid = session_role_oid
           AND live_binding.database_role_name = session_user::NAME
           AND live_binding.binding_scope = 'CONNECTOR_WORKER'
           AND live_binding.binding_state = 'ACTIVE'
           AND principal.purpose = 'CONNECTOR_WORKER'
           AND principal.status = 'ACTIVE'
           AND NOT EXISTS (
               SELECT 1
                 FROM pg_catalog.pg_auth_members AS membership
                WHERE membership.member = session_role_oid
                   OR membership.roleid = session_role_oid
           )
         FOR SHARE OF live_binding;

        IF NOT FOUND THEN
            RAISE EXCEPTION USING
                ERRCODE = '42501',
                MESSAGE = 'Worker database writes require an ACTIVE bound service principal';
        END IF;
    END IF;

    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    END IF;
    RETURN NEW;
END;
$$;

DO $worker_write_session_guards$
DECLARE
    relation_name TEXT;
    guarded_relations CONSTANT TEXT[] := ARRAY[
        'ota.connector_collection_schedule',
        'ota.simulation_run',
        'ota.connector_authorization_state',
        'ota.connector_collection_run',
        'ota.connector_collection_attempt',
        'ota.connector_stream_checkpoint',
        'ota.source_raw_record',
        'ota.pms_business_day_observation',
        'ota.pms_business_day_transition',
        'ota.business_day_run',
        'ota.pms_operating_observation',
        'ota.pms_room_charge_event',
        'ota.source_standard_record',
        'ota.source_sellable_product',
        'ota.inventory_observation',
        'ota.inventory_observation_item',
        'ota.source_booking',
        'ota.source_booking_revision',
        'ota.booking_room_night_delta',
        'ota.daily_operation_snapshot',
        'ota.daily_operation_snapshot_metric',
        'ota.ota_hourly_brief',
        'ota.ota_brief_adjustment',
        'ota.ota_incident',
        'ota.ota_incident_occurrence',
        'ota.ota_task',
        'ota.ota_task_event',
        'ota.ota_outbox_event',
        'ota.ota_outbox_publish_state',
        'ota.notification_delivery',
        'ota.notification_delivery_attempt'
    ];
BEGIN
    FOREACH relation_name IN ARRAY guarded_relations
    LOOP
        EXECUTE format(
            'CREATE TRIGGER %I
             BEFORE INSERT OR UPDATE OR DELETE ON %s
             FOR EACH ROW
             EXECUTE FUNCTION control.enforce_live_worker_write_session()',
            'trg_' || replace(relation_name, '.', '_') ||
                '_live_worker_write',
            relation_name
        );
    END LOOP;
END
$worker_write_session_guards$;

REVOKE ALL ON FUNCTION control.enforce_live_worker_write_session() FROM PUBLIC;
