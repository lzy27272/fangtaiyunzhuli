-- Sprint 2B configuration-only control plane.
--
-- This migration registers inert intake templates and permits hotel-scoped
-- connector configuration to be prepared without creating a real runtime
-- path. CONFIGURATION_ONLY is intentionally excluded from every existing
-- dispatcher/Worker allowlist and is additionally blocked from schedules,
-- jobs, collection runs and checkpoints at the database boundary.

ALTER TABLE ota.hotel_source_connector
    DROP CONSTRAINT hotel_source_connector_connector_mode_check;

ALTER TABLE ota.hotel_source_connector
    ADD CONSTRAINT hotel_source_connector_connector_mode_check
    CHECK (connector_mode IN ('SIMULATION', 'FILE_IMPORT', 'CONFIGURATION_ONLY')),
    ADD CONSTRAINT hotel_source_connector_configuration_only_lifecycle_check
    CHECK (
        connector_mode <> 'CONFIGURATION_ONLY'
        OR lifecycle_status IN ('DRAFT', 'PAUSED')
    );

ALTER TABLE control.connector_adapter_registry
    ADD CONSTRAINT connector_adapter_registry_intake_template_check
    CHECK (
        adapter_code NOT IN ('PMS_INTAKE', 'CTRIP_INTAKE', 'MEITUAN_INTAKE')
        OR (
            NOT enabled
            AND NOT supports_simulation
            AND cardinality(capability_codes) = 0
            AND cardinality(allowed_host_patterns) = 0
            AND (
                (adapter_code = 'PMS_INTAKE' AND source_type = 'PMS')
                OR (adapter_code = 'CTRIP_INTAKE' AND source_type = 'CTRIP')
                OR (adapter_code = 'MEITUAN_INTAKE' AND source_type = 'MEITUAN')
            )
        )
    );

INSERT INTO control.connector_adapter_registry(
    adapter_code,
    source_type,
    display_name,
    implementation_version,
    capability_codes,
    allowed_host_patterns,
    supports_simulation,
    enabled
) VALUES
    (
        'PMS_INTAKE',
        'PMS',
        'PMS intake configuration placeholder',
        '0.0.0-config-only',
        ARRAY[]::TEXT[],
        ARRAY[]::TEXT[],
        FALSE,
        FALSE
    ),
    (
        'CTRIP_INTAKE',
        'CTRIP',
        'Ctrip intake configuration placeholder',
        '0.0.0-config-only',
        ARRAY[]::TEXT[],
        ARRAY[]::TEXT[],
        FALSE,
        FALSE
    ),
    (
        'MEITUAN_INTAKE',
        'MEITUAN',
        'Meituan intake configuration placeholder',
        '0.0.0-config-only',
        ARRAY[]::TEXT[],
        ARRAY[]::TEXT[],
        FALSE,
        FALSE
    );

ALTER TABLE ota.connector_secret_binding
    ADD CONSTRAINT connector_secret_binding_no_embedded_credentials_check
    CHECK (
        secret_ref ~
            '^(kms|vault|secretstore|oskeyring|envref)://[A-Za-z0-9][A-Za-z0-9._/+~-][A-Za-z0-9._/+~-]+$'
    );

CREATE FUNCTION control.enforce_configuration_only_connector()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog
AS $$
DECLARE
    expected_source_type TEXT;
BEGIN
    IF TG_OP = 'UPDATE'
       AND NEW.connector_mode IS DISTINCT FROM OLD.connector_mode
       AND (
           NEW.connector_mode = 'CONFIGURATION_ONLY'
           OR OLD.connector_mode = 'CONFIGURATION_ONLY'
       ) THEN
        RAISE EXCEPTION
            'CONFIGURATION_ONLY mode cannot be entered or exited by in-place connector update'
            USING ERRCODE = '55000';
    END IF;

    expected_source_type := CASE NEW.adapter_code
        WHEN 'PMS_INTAKE' THEN 'PMS'
        WHEN 'CTRIP_INTAKE' THEN 'CTRIP'
        WHEN 'MEITUAN_INTAKE' THEN 'MEITUAN'
        ELSE NULL
    END;

    IF NEW.connector_mode = 'CONFIGURATION_ONLY' THEN
        IF expected_source_type IS NULL
           OR NEW.source_type <> expected_source_type
           OR NEW.lifecycle_status NOT IN ('DRAFT', 'PAUSED') THEN
            RAISE EXCEPTION
                'CONFIGURATION_ONLY connector requires its source-matched intake template and DRAFT/PAUSED lifecycle'
                USING ERRCODE = '55000';
        END IF;

        IF EXISTS (
            SELECT 1
              FROM ota.connector_collection_schedule AS schedule
             WHERE schedule.tenant_id = NEW.tenant_id
               AND schedule.hotel_id = NEW.hotel_id
               AND schedule.connector_id = NEW.connector_id
        ) THEN
            RAISE EXCEPTION
                'CONFIGURATION_ONLY connector cannot retain collection schedules'
                USING ERRCODE = '55000';
        END IF;

        IF EXISTS (
            SELECT 1
              FROM ota.hotel_source_connector_version AS version
             WHERE version.tenant_id = NEW.tenant_id
               AND version.hotel_id = NEW.hotel_id
               AND version.connector_id = NEW.connector_id
               AND (
                   version.status <> 'DRAFT'
                   OR version.tested_at IS NOT NULL
                   OR version.activated_at IS NOT NULL
                   OR version.retired_at IS NOT NULL
               )
        ) THEN
            RAISE EXCEPTION
                'CONFIGURATION_ONLY connector cannot retain a tested, active or retired version'
                USING ERRCODE = '55000';
        END IF;
    ELSIF expected_source_type IS NOT NULL THEN
        RAISE EXCEPTION
            'Intake connector templates are restricted to CONFIGURATION_ONLY mode'
            USING ERRCODE = '55000';
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_hotel_source_connector_configuration_only
BEFORE INSERT OR UPDATE ON ota.hotel_source_connector
FOR EACH ROW
EXECUTE FUNCTION control.enforce_configuration_only_connector();

CREATE FUNCTION control.enforce_configuration_only_version()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog
AS $$
DECLARE
    parent_connector_mode TEXT;
BEGIN
    SELECT connector.connector_mode
      INTO parent_connector_mode
      FROM ota.hotel_source_connector AS connector
     WHERE connector.tenant_id = NEW.tenant_id
       AND connector.hotel_id = NEW.hotel_id
       AND connector.connector_id = NEW.connector_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION
            'Connector version parent must be visible before version mutation'
            USING ERRCODE = '55000';
    END IF;

    IF parent_connector_mode = 'CONFIGURATION_ONLY' AND (
        NEW.status <> 'DRAFT'
        OR NEW.tested_at IS NOT NULL
        OR NEW.activated_at IS NOT NULL
        OR NEW.retired_at IS NOT NULL
    ) THEN
        RAISE EXCEPTION
            'CONFIGURATION_ONLY connector versions must remain untested DRAFT records'
            USING ERRCODE = '55000';
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_connector_version_configuration_only
BEFORE INSERT OR UPDATE ON ota.hotel_source_connector_version
FOR EACH ROW
EXECUTE FUNCTION control.enforce_configuration_only_version();

CREATE FUNCTION control.reject_configuration_only_runtime()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog
AS $$
DECLARE
    parent_connector_mode TEXT;
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

    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_schedule_reject_configuration_only
BEFORE INSERT OR UPDATE ON ota.connector_collection_schedule
FOR EACH ROW
EXECUTE FUNCTION control.reject_configuration_only_runtime();

CREATE TRIGGER trg_job_reject_configuration_only
BEFORE INSERT OR UPDATE ON control.ota_job_registry
FOR EACH ROW
EXECUTE FUNCTION control.reject_configuration_only_runtime();

CREATE TRIGGER trg_collection_run_reject_configuration_only
BEFORE INSERT OR UPDATE ON ota.connector_collection_run
FOR EACH ROW
EXECUTE FUNCTION control.reject_configuration_only_runtime();

CREATE TRIGGER trg_checkpoint_reject_configuration_only
BEFORE INSERT OR UPDATE ON ota.connector_stream_checkpoint
FOR EACH ROW
EXECUTE FUNCTION control.reject_configuration_only_runtime();

CREATE TABLE ota.connector_contract_approved_baseline (
    tenant_id UUID NOT NULL,
    hotel_id UUID NOT NULL,
    connector_id UUID NOT NULL,
    connector_version_id UUID NOT NULL,
    baseline_id UUID NOT NULL,
    stream_code VARCHAR(64) NOT NULL,
    fingerprint_algorithm VARCHAR(32) NOT NULL DEFAULT 'SHA-256-V1'
        CHECK (fingerprint_algorithm = 'SHA-256-V1'),
    capability_fingerprint VARCHAR(64) NOT NULL,
    schema_fingerprint VARCHAR(64) NOT NULL,
    status VARCHAR(24) NOT NULL DEFAULT 'APPROVED'
        CHECK (status = 'APPROVED'),
    approval_reason_code VARCHAR(64) NOT NULL,
    approved_by_account_id UUID NOT NULL REFERENCES control.auth_account(account_id),
    approved_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (tenant_id, hotel_id, baseline_id),
    FOREIGN KEY (tenant_id, hotel_id, connector_id, connector_version_id)
        REFERENCES ota.hotel_source_connector_version(
            tenant_id, hotel_id, connector_id, connector_version_id
        ),
    UNIQUE (
        tenant_id, hotel_id, connector_id, connector_version_id, stream_code
    ),
    CHECK (btrim(stream_code) <> ''),
    CHECK (capability_fingerprint ~ '^[A-Fa-f0-9]{64}$'),
    CHECK (schema_fingerprint ~ '^[A-Fa-f0-9]{64}$'),
    CHECK (approval_reason_code ~ '^[A-Z0-9_]{1,64}$')
);

COMMENT ON TABLE ota.connector_contract_approved_baseline IS
    'Append-only approved capability/schema contract evidence. It grants no runtime or external access.';

CREATE FUNCTION control.enforce_connector_contract_baseline_approval()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog
AS $$
DECLARE
    session_account_text TEXT;
    session_account_id UUID;
BEGIN
    IF NEW.status <> 'APPROVED' THEN
        RAISE EXCEPTION
            'Connector contract baseline rows must be APPROVED'
            USING ERRCODE = '55000';
    END IF;

    session_account_text := nullif(
        btrim(current_setting('app.account_id', TRUE)),
        ''
    );
    IF session_account_text IS NULL THEN
        RAISE EXCEPTION
            'Connector contract baseline approval requires a bound account session'
            USING ERRCODE = '42501';
    END IF;
    BEGIN
        session_account_id := session_account_text::UUID;
    EXCEPTION
        WHEN invalid_text_representation THEN
            RAISE EXCEPTION
                'Connector contract baseline approval account context is invalid'
                USING ERRCODE = '42501';
    END;
    IF NEW.approved_by_account_id <> session_account_id THEN
        RAISE EXCEPTION
            'Connector contract baseline approver must match the bound account session'
            USING ERRCODE = '42501';
    END IF;

    IF NOT EXISTS (
        SELECT 1
          FROM control.auth_account AS account
          JOIN control.account_role AS account_role
            ON account_role.account_id = account.account_id
          JOIN control.role_definition AS role_definition
            ON role_definition.role_id = account_role.role_id
         WHERE account.account_id = NEW.approved_by_account_id
           AND account.status = 'ACTIVE'
           AND role_definition.role_code = 'PLATFORM_ADMIN'
           AND account_role.valid_from <= CURRENT_TIMESTAMP
           AND (
               account_role.valid_until IS NULL
               OR account_role.valid_until > CURRENT_TIMESTAMP
           )
    ) THEN
        RAISE EXCEPTION
            'Connector contract baseline approval requires an active PLATFORM_ADMIN role'
            USING ERRCODE = '42501';
    END IF;

    NEW.approved_at := CURRENT_TIMESTAMP;
    NEW.created_at := CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_connector_contract_baseline_approval
BEFORE INSERT ON ota.connector_contract_approved_baseline
FOR EACH ROW
EXECUTE FUNCTION control.enforce_connector_contract_baseline_approval();

CREATE TRIGGER trg_connector_contract_baseline_append_only
BEFORE UPDATE OR DELETE ON ota.connector_contract_approved_baseline
FOR EACH ROW
EXECUTE FUNCTION control.reject_append_only_mutation();

ALTER TABLE ota.connector_contract_approved_baseline ENABLE ROW LEVEL SECURITY;
ALTER TABLE ota.connector_contract_approved_baseline FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation
ON ota.connector_contract_approved_baseline
USING (tenant_id = control.current_tenant_id())
WITH CHECK (tenant_id = control.current_tenant_id());

REVOKE ALL ON TABLE ota.connector_contract_approved_baseline FROM PUBLIC;
REVOKE ALL ON FUNCTION control.enforce_configuration_only_connector() FROM PUBLIC;
REVOKE ALL ON FUNCTION control.enforce_configuration_only_version() FROM PUBLIC;
REVOKE ALL ON FUNCTION control.reject_configuration_only_runtime() FROM PUBLIC;
REVOKE ALL ON FUNCTION control.enforce_connector_contract_baseline_approval() FROM PUBLIC;
