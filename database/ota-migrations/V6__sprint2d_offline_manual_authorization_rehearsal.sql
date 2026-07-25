-- OTA Sprint 2D offline manual-authorization rehearsal.
--
-- This migration adds only a tenant-scoped control-plane rehearsal. It does
-- not add browser or network I/O, credential access, SecretStore resolution,
-- a REAL connector mode, collection scheduling, activation or delivery.
-- Rehearsal completion remains AUTH_REQUIRED and is never authorization proof.

CREATE TABLE ota.browser_authorization_attempt (
    tenant_id UUID NOT NULL,
    hotel_id UUID NOT NULL,
    connector_id UUID NOT NULL,
    connector_version_id UUID NOT NULL,
    authorization_attempt_id UUID NOT NULL,
    actor_account_id UUID NOT NULL
        REFERENCES control.auth_account(account_id),
    config_version BIGINT NOT NULL CHECK (config_version >= 0),
    adapter_code VARCHAR(96) NOT NULL
        CHECK (adapter_code ~ '^[A-Z0-9][A-Z0-9._-]{2,95}$'),
    adapter_version VARCHAR(64) NOT NULL
        CHECK (adapter_version ~ '^[A-Za-z0-9][A-Za-z0-9._+-]{0,63}$'),
    mode VARCHAR(32) NOT NULL DEFAULT 'OFFLINE_REHEARSAL'
        CHECK (mode = 'OFFLINE_REHEARSAL'),
    state_code VARCHAR(40) NOT NULL DEFAULT 'WAITING_FOR_OPERATOR'
        CHECK (
            state_code IN (
                'WAITING_FOR_OPERATOR',
                'OFFLINE_REHEARSAL_COMPLETE',
                'CANCELLED',
                'EXPIRED',
                'FAILED'
            )
        ),
    authorization_state VARCHAR(32) NOT NULL DEFAULT 'AUTH_REQUIRED'
        CHECK (authorization_state = 'AUTH_REQUIRED'),
    interaction_reference_hash VARCHAR(64) NOT NULL
        CHECK (interaction_reference_hash ~ '^[A-Fa-f0-9]{64}$'),
    requested_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    changed_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    expires_at TIMESTAMPTZ NOT NULL,
    terminal_at TIMESTAMPTZ,
    row_version BIGINT NOT NULL DEFAULT 0 CHECK (row_version >= 0),
    PRIMARY KEY (
        tenant_id,
        hotel_id,
        connector_id,
        authorization_attempt_id
    ),
    FOREIGN KEY (
        tenant_id,
        hotel_id,
        connector_id,
        connector_version_id
    )
        REFERENCES ota.hotel_source_connector_version(
            tenant_id,
            hotel_id,
            connector_id,
            connector_version_id
        ),
    CHECK (expires_at > requested_at),
    CHECK (changed_at >= requested_at),
    CHECK (terminal_at IS NULL OR terminal_at >= requested_at),
    CHECK (
        (
            state_code = 'WAITING_FOR_OPERATOR'
            AND terminal_at IS NULL
        )
        OR
        (
            state_code IN (
                'OFFLINE_REHEARSAL_COMPLETE',
                'CANCELLED',
                'EXPIRED',
                'FAILED'
            )
            AND terminal_at IS NOT NULL
        )
    )
);

CREATE UNIQUE INDEX uq_browser_authorization_attempt_active_connector
    ON ota.browser_authorization_attempt(
        tenant_id,
        hotel_id,
        connector_id
    )
    WHERE state_code = 'WAITING_FOR_OPERATOR';

COMMENT ON TABLE ota.browser_authorization_attempt IS
    'Offline manual-authorization rehearsal only. AUTH_REQUIRED is fixed and no row proves a vendor login or usable browser session.';

COMMENT ON COLUMN ota.browser_authorization_attempt.interaction_reference_hash IS
    'SHA-256 digest of an opaque, one-time rehearsal interaction reference. The reference itself is never stored here.';

CREATE TABLE ota.browser_authorization_command_receipt (
    tenant_id UUID NOT NULL,
    hotel_id UUID NOT NULL,
    connector_id UUID NOT NULL,
    authorization_attempt_id UUID NOT NULL,
    command_id UUID NOT NULL,
    idempotency_key VARCHAR(255) NOT NULL,
    command_type VARCHAR(32) NOT NULL
        CHECK (
            command_type IN (
                'START',
                'COMPLETE_REHEARSAL',
                'CANCEL',
                'EXPIRE',
                'FAIL'
            )
        ),
    request_hash VARCHAR(64) NOT NULL
        CHECK (request_hash ~ '^[A-Fa-f0-9]{64}$'),
    from_state VARCHAR(40) NOT NULL
        CHECK (from_state IN ('NONE', 'WAITING_FOR_OPERATOR')),
    to_state VARCHAR(40) NOT NULL
        CHECK (
            to_state IN (
                'WAITING_FOR_OPERATOR',
                'OFFLINE_REHEARSAL_COMPLETE',
                'CANCELLED',
                'EXPIRED',
                'FAILED'
            )
        ),
    expected_row_version BIGINT NOT NULL
        CHECK (expected_row_version >= 0),
    resulting_row_version BIGINT NOT NULL
        CHECK (resulting_row_version >= 0),
    actor_account_id UUID NOT NULL
        REFERENCES control.auth_account(account_id),
    predecessor_authorization_attempt_id UUID,
    predecessor_expected_row_version BIGINT
        CHECK (predecessor_expected_row_version >= 0),
    reason_code VARCHAR(64) NOT NULL
        CHECK (reason_code ~ '^[A-Z0-9_]{1,64}$'),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (tenant_id, hotel_id, command_id),
    FOREIGN KEY (
        tenant_id,
        hotel_id,
        connector_id,
        authorization_attempt_id
    )
        REFERENCES ota.browser_authorization_attempt(
            tenant_id,
            hotel_id,
            connector_id,
            authorization_attempt_id
        ),
    FOREIGN KEY (
        tenant_id,
        hotel_id,
        connector_id,
        predecessor_authorization_attempt_id
    )
        REFERENCES ota.browser_authorization_attempt(
            tenant_id,
            hotel_id,
            connector_id,
            authorization_attempt_id
        ),
    UNIQUE (command_id),
    UNIQUE (tenant_id, hotel_id, idempotency_key),
    CHECK (btrim(idempotency_key) <> ''),
    CHECK (
        (
            predecessor_authorization_attempt_id IS NULL
            AND predecessor_expected_row_version IS NULL
        )
        OR
        (
            command_type = 'START'
            AND predecessor_authorization_attempt_id IS NOT NULL
            AND predecessor_expected_row_version IS NOT NULL
        )
    ),
    CHECK (
        (
            command_type = 'START'
            AND from_state = 'NONE'
            AND to_state = 'WAITING_FOR_OPERATOR'
            AND expected_row_version = 0
            AND resulting_row_version = 0
        )
        OR
        (
            command_type <> 'START'
            AND from_state = 'WAITING_FOR_OPERATOR'
            AND to_state IN (
                'OFFLINE_REHEARSAL_COMPLETE',
                'CANCELLED',
                'EXPIRED',
                'FAILED'
            )
            AND resulting_row_version = expected_row_version + 1
        )
    )
);

COMMENT ON TABLE ota.browser_authorization_command_receipt IS
    'Append-only idempotency and state-transition evidence for the offline rehearsal; it contains no URL, credential, cookie, token, header or browser storage.';

CREATE TRIGGER trg_browser_authorization_attempt_reject_delete
BEFORE DELETE ON ota.browser_authorization_attempt
FOR EACH ROW
EXECUTE FUNCTION control.reject_append_only_mutation();

CREATE TRIGGER trg_browser_authorization_command_receipt_append_only
BEFORE UPDATE OR DELETE ON ota.browser_authorization_command_receipt
FOR EACH ROW
EXECUTE FUNCTION control.reject_append_only_mutation();

ALTER TABLE ota.browser_authorization_attempt ENABLE ROW LEVEL SECURITY;
ALTER TABLE ota.browser_authorization_attempt FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation
ON ota.browser_authorization_attempt
USING (tenant_id = control.current_tenant_id())
WITH CHECK (tenant_id = control.current_tenant_id());

ALTER TABLE ota.browser_authorization_command_receipt ENABLE ROW LEVEL SECURITY;
ALTER TABLE ota.browser_authorization_command_receipt FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation
ON ota.browser_authorization_command_receipt
USING (tenant_id = control.current_tenant_id())
WITH CHECK (tenant_id = control.current_tenant_id());

CREATE FUNCTION control.enforce_browser_authorization_rehearsal_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
    session_actor_id UUID;
    connector_snapshot RECORD;
BEGIN
    IF control.current_tenant_id() IS DISTINCT FROM NEW.tenant_id THEN
        RAISE EXCEPTION USING
            ERRCODE = '42501',
            MESSAGE = 'tenant context mismatch';
    END IF;

    session_actor_id := control.current_authenticated_platform_admin_id();
    IF NEW.actor_account_id IS DISTINCT FROM session_actor_id THEN
        RAISE EXCEPTION USING
            ERRCODE = '42501',
            MESSAGE = 'browser authorization actor must match the authenticated session';
    END IF;

    IF NEW.mode <> 'OFFLINE_REHEARSAL'
       OR NEW.state_code <> 'WAITING_FOR_OPERATOR'
       OR NEW.authorization_state <> 'AUTH_REQUIRED'
       OR NEW.terminal_at IS NOT NULL
       OR NEW.row_version <> 0 THEN
        RAISE EXCEPTION USING
            ERRCODE = '55000',
            MESSAGE = 'browser authorization attempts must start as an offline rehearsal waiting for an operator';
    END IF;

    SELECT connector.connector_mode,
           connector.lifecycle_status,
           connector.row_version AS config_version,
           connector.source_type,
           connector.adapter_code,
           version.status AS version_status,
           version.version_no,
           version.adapter_version,
           version.non_secret_config ->> 'connectionMethod'
               AS connection_method,
           EXISTS (
               SELECT 1
                 FROM ota.connector_secret_binding AS binding
                WHERE binding.tenant_id = version.tenant_id
                  AND binding.hotel_id = version.hotel_id
                  AND binding.connector_id = version.connector_id
                  AND binding.connector_version_id =
                      version.connector_version_id
                  AND binding.secret_purpose = 'BROWSER_SESSION'
                  AND binding.binding_status = 'CONFIGURED'
           ) AS browser_session_binding_configured,
           version.version_no = (
               SELECT max(candidate.version_no)
                 FROM ota.hotel_source_connector_version AS candidate
                WHERE candidate.tenant_id = connector.tenant_id
                  AND candidate.hotel_id = connector.hotel_id
                  AND candidate.connector_id = connector.connector_id
                  AND candidate.status = 'DRAFT'
           ) AS latest_draft_version
      INTO connector_snapshot
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
       OR connector_snapshot.connector_mode <> 'CONFIGURATION_ONLY'
       OR connector_snapshot.lifecycle_status <> 'DRAFT'
       OR connector_snapshot.source_type <> 'PMS'
       OR connector_snapshot.version_status <> 'DRAFT'
       OR NOT connector_snapshot.latest_draft_version
       OR connector_snapshot.connection_method IS DISTINCT FROM
          'CONTROLLED_BROWSER'
       OR NOT connector_snapshot.browser_session_binding_configured
       OR connector_snapshot.config_version IS DISTINCT FROM NEW.config_version
       OR connector_snapshot.adapter_code IS DISTINCT FROM NEW.adapter_code
       OR connector_snapshot.adapter_version IS DISTINCT FROM NEW.adapter_version THEN
        RAISE EXCEPTION USING
            ERRCODE = '55000',
            MESSAGE = 'offline browser authorization rehearsal requires an exact CONFIGURATION_ONLY DRAFT connector version';
    END IF;

    NEW.interaction_reference_hash := lower(
        NEW.interaction_reference_hash
    );
    NEW.requested_at := clock_timestamp();
    NEW.changed_at := NEW.requested_at;
    NEW.terminal_at := NULL;
    NEW.row_version := 0;

    IF NEW.expires_at <= NEW.requested_at THEN
        RAISE EXCEPTION USING
            ERRCODE = '22023',
            MESSAGE = 'browser authorization rehearsal expiry must be in the future';
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_browser_authorization_attempt_insert_guard
BEFORE INSERT ON ota.browser_authorization_attempt
FOR EACH ROW
EXECUTE FUNCTION control.enforce_browser_authorization_rehearsal_insert();

CREATE FUNCTION ota.start_browser_authorization_rehearsal(
    p_tenant_id UUID,
    p_hotel_id UUID,
    p_connector_id UUID,
    p_connector_version_id UUID,
    p_authorization_attempt_id UUID,
    p_actor_account_id UUID,
    p_config_version BIGINT,
    p_adapter_code TEXT,
    p_adapter_version TEXT,
    p_interaction_reference_hash TEXT,
    p_expires_at TIMESTAMPTZ,
    p_command_id UUID,
    p_idempotency_key TEXT,
    p_request_hash TEXT,
    p_reason_code TEXT,
    p_predecessor_authorization_attempt_id UUID,
    p_predecessor_expected_row_version BIGINT
)
RETURNS ota.browser_authorization_attempt
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
#variable_conflict use_column
DECLARE
    session_actor_id UUID;
    existing_receipt RECORD;
    attempt_row ota.browser_authorization_attempt%ROWTYPE;
    predecessor_attempt ota.browser_authorization_attempt%ROWTYPE;
    expired_attempt ota.browser_authorization_attempt%ROWTYPE;
    active_attempt ota.browser_authorization_attempt%ROWTYPE;
    connector_snapshot RECORD;
    expired_expected_row_version BIGINT;
    auto_expire_command_id UUID;
    auto_expire_idempotency_key TEXT;
    auto_expire_request_hash TEXT;
    command_now TIMESTAMPTZ;
BEGIN
    IF control.current_tenant_id() IS DISTINCT FROM p_tenant_id THEN
        RAISE EXCEPTION USING
            ERRCODE = '42501',
            MESSAGE = 'tenant context mismatch';
    END IF;
    session_actor_id := control.current_authenticated_platform_admin_id();

    IF p_tenant_id IS NULL
       OR p_hotel_id IS NULL
       OR p_connector_id IS NULL
       OR p_connector_version_id IS NULL
       OR p_authorization_attempt_id IS NULL
       OR p_actor_account_id IS NULL
       OR p_actor_account_id IS DISTINCT FROM session_actor_id
       OR p_config_version IS NULL
       OR p_config_version < 0
       OR p_adapter_code IS NULL
       OR p_adapter_code !~ '^[A-Z0-9][A-Z0-9._-]{2,95}$'
       OR p_adapter_version IS NULL
       OR p_adapter_version !~ '^[A-Za-z0-9][A-Za-z0-9._+-]{0,63}$'
       OR p_interaction_reference_hash IS NULL
       OR p_interaction_reference_hash !~ '^[A-Fa-f0-9]{64}$'
       OR p_expires_at IS NULL
       OR p_expires_at <= clock_timestamp()
       OR p_command_id IS NULL
       OR p_idempotency_key IS NULL
       OR btrim(p_idempotency_key) = ''
       OR length(p_idempotency_key) > 255
       OR p_request_hash IS NULL
       OR p_request_hash !~ '^[A-Fa-f0-9]{64}$'
       OR p_reason_code IS NULL
       OR p_reason_code !~ '^[A-Z0-9_]{1,64}$'
       OR (
           (p_predecessor_authorization_attempt_id IS NULL)
           <>
           (p_predecessor_expected_row_version IS NULL)
       )
       OR p_predecessor_expected_row_version < 0
       OR p_predecessor_authorization_attempt_id IS NOT DISTINCT FROM
          p_authorization_attempt_id THEN
        RAISE EXCEPTION USING
            ERRCODE = '22023',
            MESSAGE = 'invalid offline browser authorization rehearsal start command';
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
      FROM ota.browser_authorization_command_receipt AS receipt
     WHERE receipt.tenant_id = p_tenant_id
       AND receipt.hotel_id = p_hotel_id
       AND receipt.idempotency_key = btrim(p_idempotency_key);

    IF FOUND THEN
        IF existing_receipt.command_type <> 'START'
           OR existing_receipt.connector_id IS DISTINCT FROM p_connector_id
           OR existing_receipt.request_hash <> lower(p_request_hash)
           OR existing_receipt.actor_account_id IS DISTINCT FROM session_actor_id
           OR existing_receipt.predecessor_authorization_attempt_id
              IS DISTINCT FROM p_predecessor_authorization_attempt_id
           OR existing_receipt.predecessor_expected_row_version
              IS DISTINCT FROM p_predecessor_expected_row_version
           OR existing_receipt.reason_code <> p_reason_code THEN
            RAISE EXCEPTION USING
                ERRCODE = '23505',
                MESSAGE = 'idempotency key payload conflict';
        END IF;

        SELECT attempt.*
          INTO attempt_row
          FROM ota.browser_authorization_attempt AS attempt
         WHERE attempt.tenant_id = p_tenant_id
           AND attempt.hotel_id = p_hotel_id
           AND attempt.connector_id = p_connector_id
           AND attempt.connector_version_id = p_connector_version_id
           AND attempt.authorization_attempt_id =
               existing_receipt.authorization_attempt_id
           AND attempt.actor_account_id = session_actor_id
           AND attempt.config_version = p_config_version
           AND attempt.adapter_code = p_adapter_code
           AND attempt.adapter_version = p_adapter_version;

        IF NOT FOUND THEN
            RAISE EXCEPTION USING
                ERRCODE = '55000',
                MESSAGE = 'idempotent browser authorization attempt binding is unavailable';
        END IF;
        RETURN attempt_row;
    END IF;

    PERFORM pg_advisory_xact_lock(
        hashtextextended(
            'browser-authorization-active|' ||
            p_tenant_id::TEXT || '|' ||
            p_hotel_id::TEXT || '|' ||
            p_connector_id::TEXT,
            0
        )
    );

    SELECT connector.connector_mode,
           connector.lifecycle_status,
           connector.row_version AS config_version,
           connector.source_type,
           connector.adapter_code,
           version.status AS version_status,
           version.adapter_version,
           version.non_secret_config ->> 'connectionMethod'
               AS connection_method,
           EXISTS (
               SELECT 1
                 FROM ota.connector_secret_binding AS binding
                WHERE binding.tenant_id = version.tenant_id
                  AND binding.hotel_id = version.hotel_id
                  AND binding.connector_id = version.connector_id
                  AND binding.connector_version_id =
                      version.connector_version_id
                  AND binding.secret_purpose = 'BROWSER_SESSION'
                  AND binding.binding_status = 'CONFIGURED'
           ) AS browser_session_binding_configured,
           version.version_no = (
               SELECT max(candidate.version_no)
                 FROM ota.hotel_source_connector_version AS candidate
                WHERE candidate.tenant_id = connector.tenant_id
                  AND candidate.hotel_id = connector.hotel_id
                  AND candidate.connector_id = connector.connector_id
                  AND candidate.status = 'DRAFT'
           ) AS latest_draft_version
      INTO connector_snapshot
      FROM ota.hotel_source_connector AS connector
      JOIN ota.hotel_source_connector_version AS version
        ON version.tenant_id = connector.tenant_id
       AND version.hotel_id = connector.hotel_id
       AND version.connector_id = connector.connector_id
     WHERE connector.tenant_id = p_tenant_id
       AND connector.hotel_id = p_hotel_id
       AND connector.connector_id = p_connector_id
       AND version.connector_version_id = p_connector_version_id;

    IF NOT FOUND
       OR connector_snapshot.connector_mode <> 'CONFIGURATION_ONLY'
       OR connector_snapshot.lifecycle_status <> 'DRAFT'
       OR connector_snapshot.source_type <> 'PMS'
       OR connector_snapshot.version_status <> 'DRAFT'
       OR NOT connector_snapshot.latest_draft_version
       OR connector_snapshot.connection_method IS DISTINCT FROM
          'CONTROLLED_BROWSER'
       OR NOT connector_snapshot.browser_session_binding_configured
       OR connector_snapshot.config_version IS DISTINCT FROM p_config_version
       OR connector_snapshot.adapter_code IS DISTINCT FROM p_adapter_code
       OR connector_snapshot.adapter_version IS DISTINCT FROM p_adapter_version THEN
        RAISE EXCEPTION USING
            ERRCODE = '55000',
            MESSAGE = 'offline browser authorization rehearsal requires an exact CONFIGURATION_ONLY DRAFT connector version';
    END IF;

    IF p_predecessor_authorization_attempt_id IS NOT NULL THEN
        SELECT attempt.*
          INTO predecessor_attempt
          FROM ota.browser_authorization_attempt AS attempt
         WHERE attempt.tenant_id = p_tenant_id
           AND attempt.hotel_id = p_hotel_id
           AND attempt.connector_id = p_connector_id
           AND attempt.authorization_attempt_id =
               p_predecessor_authorization_attempt_id
         FOR UPDATE;

        command_now := clock_timestamp();

        IF NOT FOUND THEN
            RAISE EXCEPTION USING
                ERRCODE = '55000',
                MESSAGE = 'reauthentication predecessor was not found in the exact connector scope';
        END IF;

        IF predecessor_attempt.actor_account_id IS DISTINCT FROM
           session_actor_id
           OR predecessor_attempt.connector_version_id IS DISTINCT FROM
              p_connector_version_id
           OR predecessor_attempt.config_version IS DISTINCT FROM
              p_config_version
           OR predecessor_attempt.adapter_code IS DISTINCT FROM
              p_adapter_code
           OR predecessor_attempt.adapter_version IS DISTINCT FROM
              p_adapter_version
           OR predecessor_attempt.mode <> 'OFFLINE_REHEARSAL'
           OR predecessor_attempt.authorization_state <> 'AUTH_REQUIRED' THEN
            RAISE EXCEPTION USING
                ERRCODE = '42501',
                MESSAGE = 'reauthentication predecessor binding does not match the authenticated exact connector scope';
        END IF;

        IF predecessor_attempt.row_version IS DISTINCT FROM
           p_predecessor_expected_row_version THEN
            RAISE EXCEPTION USING
                ERRCODE = '40001',
                MESSAGE = 'reauthentication predecessor row version conflict';
        END IF;

        IF predecessor_attempt.state_code = 'WAITING_FOR_OPERATOR' THEN
            IF predecessor_attempt.expires_at > command_now THEN
                RAISE EXCEPTION USING
                    ERRCODE = '55000',
                    MESSAGE = 'active reauthentication predecessor must be cancelled or reach expiry first';
            END IF;
            expired_attempt := predecessor_attempt;
        ELSIF predecessor_attempt.state_code NOT IN (
            'OFFLINE_REHEARSAL_COMPLETE',
            'CANCELLED',
            'EXPIRED',
            'FAILED'
        ) THEN
            RAISE EXCEPTION USING
                ERRCODE = '55000',
                MESSAGE = 'reauthentication predecessor must be terminal or expired';
        END IF;

        SELECT attempt.*
          INTO active_attempt
          FROM ota.browser_authorization_attempt AS attempt
         WHERE attempt.tenant_id = p_tenant_id
           AND attempt.hotel_id = p_hotel_id
           AND attempt.connector_id = p_connector_id
           AND attempt.state_code = 'WAITING_FOR_OPERATOR'
           AND attempt.authorization_attempt_id <>
               p_predecessor_authorization_attempt_id
         FOR UPDATE;

        command_now := clock_timestamp();

        IF FOUND THEN
            RAISE EXCEPTION USING
                ERRCODE = '55000',
                MESSAGE = 'another browser authorization rehearsal already owns the connector slot';
        END IF;
    ELSE
        SELECT attempt.*
          INTO active_attempt
          FROM ota.browser_authorization_attempt AS attempt
         WHERE attempt.tenant_id = p_tenant_id
           AND attempt.hotel_id = p_hotel_id
           AND attempt.connector_id = p_connector_id
           AND attempt.state_code = 'WAITING_FOR_OPERATOR'
         FOR UPDATE;

        command_now := clock_timestamp();

        IF FOUND THEN
            IF active_attempt.expires_at > command_now THEN
                RAISE EXCEPTION USING
                    ERRCODE = '55000',
                    MESSAGE = 'an unexpired browser authorization rehearsal already owns the connector slot';
            END IF;
            expired_attempt := active_attempt;
        END IF;
    END IF;

    IF expired_attempt.authorization_attempt_id IS NOT NULL THEN
        expired_expected_row_version := expired_attempt.row_version;
        auto_expire_command_id := md5(
            'browser-auth-auto-expire|' ||
            expired_attempt.authorization_attempt_id::TEXT || '|' ||
            expired_expected_row_version::TEXT
        )::UUID;
        auto_expire_idempotency_key :=
            'browser-auth-auto-expire:' ||
            expired_attempt.authorization_attempt_id::TEXT || ':' ||
            expired_expected_row_version::TEXT;
        auto_expire_request_hash := encode(
            sha256(
                convert_to(
                    auto_expire_idempotency_key,
                    'UTF8'
                )
            ),
            'hex'
        );

        UPDATE ota.browser_authorization_attempt AS attempt
           SET state_code = 'EXPIRED',
               changed_at = command_now,
               terminal_at = command_now,
               row_version = attempt.row_version + 1
         WHERE attempt.tenant_id = expired_attempt.tenant_id
           AND attempt.hotel_id = expired_attempt.hotel_id
           AND attempt.connector_id = expired_attempt.connector_id
           AND attempt.authorization_attempt_id =
               expired_attempt.authorization_attempt_id
           AND attempt.row_version = expired_expected_row_version
        RETURNING attempt.* INTO expired_attempt;

        IF NOT FOUND THEN
            RAISE EXCEPTION USING
                ERRCODE = '40001',
                MESSAGE = 'expired browser authorization rehearsal compare-and-set failed';
        END IF;

        INSERT INTO ota.browser_authorization_command_receipt(
            tenant_id,
            hotel_id,
            connector_id,
            authorization_attempt_id,
            command_id,
            idempotency_key,
            command_type,
            request_hash,
            from_state,
            to_state,
            expected_row_version,
            resulting_row_version,
            actor_account_id,
            reason_code
        )
        VALUES (
            expired_attempt.tenant_id,
            expired_attempt.hotel_id,
            expired_attempt.connector_id,
            expired_attempt.authorization_attempt_id,
            auto_expire_command_id,
            auto_expire_idempotency_key,
            'EXPIRE',
            auto_expire_request_hash,
            'WAITING_FOR_OPERATOR',
            'EXPIRED',
            expired_expected_row_version,
            expired_attempt.row_version,
            session_actor_id,
            'AUTO_EXPIRED_BEFORE_RESTART'
        );

        -- This audit is emitted only for the internal expiry side effect.
        -- Caller-owned START/transition success audit remains in Java AuditPort.
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
            auto_expire_command_id,
            command_now,
            'ACCOUNT',
            session_actor_id,
            'ota.browser-authorization-rehearsal.auto-expire',
            'BROWSER_AUTHORIZATION_ATTEMPT',
            expired_attempt.authorization_attempt_id,
            expired_attempt.tenant_id,
            expired_attempt.hotel_id,
            'SUCCEEDED',
            auto_expire_request_hash,
            expired_attempt.authorization_attempt_id
        );
    END IF;

    INSERT INTO ota.browser_authorization_attempt(
        tenant_id,
        hotel_id,
        connector_id,
        connector_version_id,
        authorization_attempt_id,
        actor_account_id,
        config_version,
        adapter_code,
        adapter_version,
        mode,
        state_code,
        authorization_state,
        interaction_reference_hash,
        expires_at
    )
    VALUES (
        p_tenant_id,
        p_hotel_id,
        p_connector_id,
        p_connector_version_id,
        p_authorization_attempt_id,
        session_actor_id,
        p_config_version,
        p_adapter_code,
        p_adapter_version,
        'OFFLINE_REHEARSAL',
        'WAITING_FOR_OPERATOR',
        'AUTH_REQUIRED',
        lower(p_interaction_reference_hash),
        p_expires_at
    )
    RETURNING * INTO attempt_row;

    INSERT INTO ota.browser_authorization_command_receipt(
        tenant_id,
        hotel_id,
        connector_id,
        authorization_attempt_id,
        command_id,
        idempotency_key,
        command_type,
        request_hash,
        from_state,
        to_state,
        expected_row_version,
        resulting_row_version,
        actor_account_id,
        predecessor_authorization_attempt_id,
        predecessor_expected_row_version,
        reason_code
    )
    VALUES (
        p_tenant_id,
        p_hotel_id,
        p_connector_id,
        p_authorization_attempt_id,
        p_command_id,
        btrim(p_idempotency_key),
        'START',
        lower(p_request_hash),
        'NONE',
        'WAITING_FOR_OPERATOR',
        0,
        0,
        session_actor_id,
        p_predecessor_authorization_attempt_id,
        p_predecessor_expected_row_version,
        p_reason_code
    );

    RETURN attempt_row;
END;
$$;

CREATE FUNCTION ota.transition_browser_authorization_rehearsal(
    p_tenant_id UUID,
    p_hotel_id UUID,
    p_connector_id UUID,
    p_connector_version_id UUID,
    p_authorization_attempt_id UUID,
    p_actor_account_id UUID,
    p_config_version BIGINT,
    p_adapter_code TEXT,
    p_adapter_version TEXT,
    p_expected_row_version BIGINT,
    p_target_state TEXT,
    p_command_id UUID,
    p_idempotency_key TEXT,
    p_request_hash TEXT,
    p_reason_code TEXT
)
RETURNS ota.browser_authorization_attempt
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
#variable_conflict use_column
DECLARE
    session_actor_id UUID;
    existing_receipt RECORD;
    attempt_row ota.browser_authorization_attempt%ROWTYPE;
    connector_snapshot RECORD;
    transition_command_type TEXT;
    transition_now TIMESTAMPTZ;
BEGIN
    IF control.current_tenant_id() IS DISTINCT FROM p_tenant_id THEN
        RAISE EXCEPTION USING
            ERRCODE = '42501',
            MESSAGE = 'tenant context mismatch';
    END IF;
    session_actor_id := control.current_authenticated_platform_admin_id();

    transition_command_type := CASE p_target_state
        WHEN 'OFFLINE_REHEARSAL_COMPLETE' THEN 'COMPLETE_REHEARSAL'
        WHEN 'CANCELLED' THEN 'CANCEL'
        WHEN 'EXPIRED' THEN 'EXPIRE'
        WHEN 'FAILED' THEN 'FAIL'
        ELSE NULL
    END;

    IF p_tenant_id IS NULL
       OR p_hotel_id IS NULL
       OR p_connector_id IS NULL
       OR p_connector_version_id IS NULL
       OR p_authorization_attempt_id IS NULL
       OR p_actor_account_id IS NULL
       OR p_actor_account_id IS DISTINCT FROM session_actor_id
       OR p_config_version IS NULL
       OR p_config_version < 0
       OR p_adapter_code IS NULL
       OR p_adapter_code !~ '^[A-Z0-9][A-Z0-9._-]{2,95}$'
       OR p_adapter_version IS NULL
       OR p_adapter_version !~ '^[A-Za-z0-9][A-Za-z0-9._+-]{0,63}$'
       OR p_expected_row_version IS NULL
       OR p_expected_row_version < 0
       OR transition_command_type IS NULL
       OR p_command_id IS NULL
       OR p_idempotency_key IS NULL
       OR btrim(p_idempotency_key) = ''
       OR length(p_idempotency_key) > 255
       OR p_request_hash IS NULL
       OR p_request_hash !~ '^[A-Fa-f0-9]{64}$'
       OR p_reason_code IS NULL
       OR p_reason_code !~ '^[A-Z0-9_]{1,64}$' THEN
        RAISE EXCEPTION USING
            ERRCODE = '22023',
            MESSAGE = 'invalid offline browser authorization rehearsal transition command';
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
      FROM ota.browser_authorization_command_receipt AS receipt
     WHERE receipt.tenant_id = p_tenant_id
       AND receipt.hotel_id = p_hotel_id
       AND receipt.idempotency_key = btrim(p_idempotency_key);

    IF FOUND THEN
        IF existing_receipt.command_type <> transition_command_type
           OR existing_receipt.connector_id IS DISTINCT FROM p_connector_id
           OR existing_receipt.authorization_attempt_id IS DISTINCT FROM
              p_authorization_attempt_id
           OR existing_receipt.request_hash <> lower(p_request_hash)
           OR existing_receipt.expected_row_version <>
              p_expected_row_version
           OR existing_receipt.to_state <> p_target_state
           OR existing_receipt.actor_account_id IS DISTINCT FROM session_actor_id
           OR existing_receipt.reason_code <> p_reason_code THEN
            RAISE EXCEPTION USING
                ERRCODE = '23505',
                MESSAGE = 'idempotency key payload conflict';
        END IF;

        SELECT attempt.*
          INTO attempt_row
          FROM ota.browser_authorization_attempt AS attempt
         WHERE attempt.tenant_id = p_tenant_id
           AND attempt.hotel_id = p_hotel_id
           AND attempt.connector_id = p_connector_id
           AND attempt.connector_version_id = p_connector_version_id
           AND attempt.authorization_attempt_id =
               p_authorization_attempt_id
           AND attempt.actor_account_id = session_actor_id
           AND attempt.config_version = p_config_version
           AND attempt.adapter_code = p_adapter_code
           AND attempt.adapter_version = p_adapter_version;

        IF NOT FOUND THEN
            RAISE EXCEPTION USING
                ERRCODE = '55000',
                MESSAGE = 'idempotent browser authorization attempt binding is unavailable';
        END IF;
        RETURN attempt_row;
    END IF;

    SELECT attempt.*
      INTO attempt_row
      FROM ota.browser_authorization_attempt AS attempt
     WHERE attempt.tenant_id = p_tenant_id
       AND attempt.hotel_id = p_hotel_id
       AND attempt.connector_id = p_connector_id
       AND attempt.connector_version_id = p_connector_version_id
       AND attempt.authorization_attempt_id = p_authorization_attempt_id
     FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION USING
            ERRCODE = '55000',
            MESSAGE = 'browser authorization rehearsal attempt was not found';
    END IF;

    IF attempt_row.actor_account_id IS DISTINCT FROM session_actor_id
       OR attempt_row.actor_account_id IS DISTINCT FROM p_actor_account_id
       OR attempt_row.config_version IS DISTINCT FROM p_config_version
       OR attempt_row.adapter_code IS DISTINCT FROM p_adapter_code
       OR attempt_row.adapter_version IS DISTINCT FROM p_adapter_version
       OR attempt_row.mode <> 'OFFLINE_REHEARSAL'
       OR attempt_row.authorization_state <> 'AUTH_REQUIRED' THEN
        RAISE EXCEPTION USING
            ERRCODE = '42501',
            MESSAGE = 'browser authorization rehearsal transition binding mismatch';
    END IF;

    IF attempt_row.state_code <> 'WAITING_FOR_OPERATOR' THEN
        RAISE EXCEPTION USING
            ERRCODE = '55000',
            MESSAGE = 'browser authorization rehearsal is already terminal';
    END IF;

    IF attempt_row.row_version <> p_expected_row_version THEN
        RAISE EXCEPTION USING
            ERRCODE = '40001',
            MESSAGE = 'browser authorization rehearsal row version conflict';
    END IF;

    SELECT connector.connector_mode,
           connector.lifecycle_status,
           connector.row_version AS config_version,
           connector.source_type,
           connector.adapter_code,
           version.status AS version_status,
           version.version_no,
           version.adapter_version,
           version.non_secret_config ->> 'connectionMethod'
               AS connection_method,
           EXISTS (
               SELECT 1
                 FROM ota.connector_secret_binding AS binding
                WHERE binding.tenant_id = version.tenant_id
                  AND binding.hotel_id = version.hotel_id
                  AND binding.connector_id = version.connector_id
                  AND binding.connector_version_id =
                      version.connector_version_id
                  AND binding.secret_purpose = 'BROWSER_SESSION'
                  AND binding.binding_status = 'CONFIGURED'
           ) AS browser_session_binding_configured,
           version.version_no = (
               SELECT max(candidate.version_no)
                 FROM ota.hotel_source_connector_version AS candidate
                WHERE candidate.tenant_id = connector.tenant_id
                  AND candidate.hotel_id = connector.hotel_id
                  AND candidate.connector_id = connector.connector_id
                  AND candidate.status = 'DRAFT'
           ) AS latest_draft_version
      INTO connector_snapshot
      FROM ota.hotel_source_connector AS connector
      JOIN ota.hotel_source_connector_version AS version
        ON version.tenant_id = connector.tenant_id
       AND version.hotel_id = connector.hotel_id
       AND version.connector_id = connector.connector_id
     WHERE connector.tenant_id = p_tenant_id
       AND connector.hotel_id = p_hotel_id
       AND connector.connector_id = p_connector_id
       AND version.connector_version_id = p_connector_version_id;

    IF NOT FOUND
       OR connector_snapshot.connector_mode <> 'CONFIGURATION_ONLY'
       OR connector_snapshot.lifecycle_status <> 'DRAFT'
       OR connector_snapshot.source_type <> 'PMS'
       OR connector_snapshot.version_status <> 'DRAFT'
       OR NOT connector_snapshot.latest_draft_version
       OR connector_snapshot.connection_method IS DISTINCT FROM
          'CONTROLLED_BROWSER'
       OR NOT connector_snapshot.browser_session_binding_configured
       OR connector_snapshot.config_version IS DISTINCT FROM p_config_version
       OR connector_snapshot.adapter_code IS DISTINCT FROM p_adapter_code
       OR connector_snapshot.adapter_version IS DISTINCT FROM p_adapter_version THEN
        RAISE EXCEPTION USING
            ERRCODE = '55000',
            MESSAGE = 'offline browser authorization rehearsal connector binding is no longer eligible';
    END IF;

    transition_now := clock_timestamp();

    IF transition_now >= attempt_row.expires_at
       AND p_target_state <> 'EXPIRED' THEN
        RAISE EXCEPTION USING
            ERRCODE = '55000',
            MESSAGE = 'a browser authorization rehearsal at or beyond expiry can only transition to EXPIRED';
    END IF;

    IF p_target_state = 'EXPIRED'
       AND transition_now < attempt_row.expires_at THEN
        RAISE EXCEPTION USING
            ERRCODE = '55000',
            MESSAGE = 'browser authorization rehearsal cannot expire before its deadline';
    END IF;

    UPDATE ota.browser_authorization_attempt AS attempt
       SET state_code = p_target_state,
           changed_at = transition_now,
           terminal_at = transition_now,
           row_version = attempt.row_version + 1
     WHERE attempt.tenant_id = p_tenant_id
       AND attempt.hotel_id = p_hotel_id
       AND attempt.connector_id = p_connector_id
       AND attempt.connector_version_id = p_connector_version_id
       AND attempt.authorization_attempt_id = p_authorization_attempt_id
       AND attempt.row_version = p_expected_row_version
    RETURNING attempt.* INTO attempt_row;

    IF NOT FOUND THEN
        RAISE EXCEPTION USING
            ERRCODE = '40001',
            MESSAGE = 'browser authorization rehearsal compare-and-set failed';
    END IF;

    INSERT INTO ota.browser_authorization_command_receipt(
        tenant_id,
        hotel_id,
        connector_id,
        authorization_attempt_id,
        command_id,
        idempotency_key,
        command_type,
        request_hash,
        from_state,
        to_state,
        expected_row_version,
        resulting_row_version,
        actor_account_id,
        reason_code
    )
    VALUES (
        p_tenant_id,
        p_hotel_id,
        p_connector_id,
        p_authorization_attempt_id,
        p_command_id,
        btrim(p_idempotency_key),
        transition_command_type,
        lower(p_request_hash),
        'WAITING_FOR_OPERATOR',
        p_target_state,
        p_expected_row_version,
        attempt_row.row_version,
        session_actor_id,
        p_reason_code
    );

    RETURN attempt_row;
END;
$$;

REVOKE ALL ON TABLE ota.browser_authorization_attempt FROM PUBLIC;
REVOKE ALL ON TABLE ota.browser_authorization_command_receipt FROM PUBLIC;
REVOKE ALL ON FUNCTION
    control.enforce_browser_authorization_rehearsal_insert()
FROM PUBLIC;
REVOKE ALL ON FUNCTION ota.start_browser_authorization_rehearsal(
    UUID, UUID, UUID, UUID, UUID, UUID, BIGINT, TEXT, TEXT, TEXT,
    TIMESTAMPTZ, UUID, TEXT, TEXT, TEXT, UUID, BIGINT
) FROM PUBLIC;
REVOKE ALL ON FUNCTION ota.transition_browser_authorization_rehearsal(
    UUID, UUID, UUID, UUID, UUID, UUID, BIGINT, TEXT, TEXT, BIGINT,
    TEXT, UUID, TEXT, TEXT, TEXT
) FROM PUBLIC;
