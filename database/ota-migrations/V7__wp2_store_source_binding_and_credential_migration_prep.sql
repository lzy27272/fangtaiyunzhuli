-- Hotel AI OS / OTA integration WP2 metadata foundation.
--
-- This forward-only migration adds role/scope alignment, inert access-
-- authorization drafts and metadata-only credential migration rehearsals.
-- It does not read or persist secret material, resolve SecretStore references,
-- enable a REAL connector, authorize vendor access, schedule collection,
-- deliver messages or call an external system.

-- Align database role metadata with the frozen organization matrix. The
-- historical REVENUE_MANAGER definition remains for audit compatibility but
-- is explicitly deprecated below and cannot receive a new active assignment.
INSERT INTO control.role_definition(
    role_id, role_code, display_name, role_scope
) VALUES
    (
        '10000000-0000-4000-8000-000000000008',
        'GENERAL_MANAGER',
        'General Manager',
        'HOTEL_SCOPED'
    ),
    (
        '10000000-0000-4000-8000-000000000009',
        'ASSISTANT_GENERAL_MANAGER',
        'Assistant General Manager',
        'HOTEL_SCOPED'
    ),
    (
        '10000000-0000-4000-8000-000000000010',
        'FRONT_OFFICE_SUPERVISOR',
        'Front Office Supervisor',
        'HOTEL_SCOPED'
    )
ON CONFLICT (role_code) DO NOTHING;

DO $role_seed_verification$
BEGIN
    IF NOT EXISTS (
        SELECT 1
          FROM control.role_definition
         WHERE role_id = '10000000-0000-4000-8000-000000000008'::UUID
           AND role_code = 'GENERAL_MANAGER'
           AND role_scope = 'HOTEL_SCOPED'
    ) OR NOT EXISTS (
        SELECT 1
          FROM control.role_definition
         WHERE role_id = '10000000-0000-4000-8000-000000000009'::UUID
           AND role_code = 'ASSISTANT_GENERAL_MANAGER'
           AND role_scope = 'HOTEL_SCOPED'
    ) OR NOT EXISTS (
        SELECT 1
          FROM control.role_definition
         WHERE role_id = '10000000-0000-4000-8000-000000000010'::UUID
           AND role_code = 'FRONT_OFFICE_SUPERVISOR'
           AND role_scope = 'HOTEL_SCOPED'
    ) THEN
        RAISE EXCEPTION USING
            ERRCODE = '23514',
            MESSAGE = 'WP2 role metadata conflicts with the frozen role matrix';
    END IF;
END;
$role_seed_verification$;

INSERT INTO control.permission_definition(
    permission_id, permission_code, description
) VALUES
    (
        '20000000-0000-4000-8000-000000000015',
        'ota.connector-authorization.manage',
        'Manage inert connector authorization metadata and UAT evidence'
    ),
    (
        '20000000-0000-4000-8000-000000000016',
        'ota.hotel.read',
        'Read explicitly scoped hotel operating data'
    ),
    (
        '20000000-0000-4000-8000-000000000017',
        'ota.price.preview',
        'Create a non-executable scoped price preview'
    ),
    (
        '20000000-0000-4000-8000-000000000018',
        'ota.price-request.create',
        'Submit an in-range price request for an explicitly scoped hotel'
    ),
    (
        '20000000-0000-4000-8000-000000000019',
        'ota.price.approve-and-sync',
        'Approve and synchronize an eligible price request'
    ),
    (
        '20000000-0000-4000-8000-000000000020',
        'ota.alert-policy.manage',
        'Manage versioned OTA alert policy metadata'
    ),
    (
        '20000000-0000-4000-8000-000000000021',
        'ota.ai-policy.manage',
        'Manage versioned hotel AI policy metadata'
    ),
    (
        '20000000-0000-4000-8000-000000000022',
        'ota.simulation-run.trigger',
        'Trigger an offline simulation run only'
    )
ON CONFLICT (permission_code) DO NOTHING;

-- The database projection mirrors the application matrix. All action paths
-- still require an exact tenant + hotel scope in addition to these roles.
INSERT INTO control.role_permission(role_id, permission_id)
SELECT role.role_id, permission.permission_id
  FROM control.role_definition AS role
  JOIN control.permission_definition AS permission
    ON permission.permission_code = ANY (CASE role.role_code
        WHEN 'PLATFORM_ADMIN' THEN ARRAY[
            'ota.connector-authorization.manage', 'ota.hotel.read',
            'ota.price.preview', 'ota.price-request.create',
            'ota.price.approve-and-sync', 'ota.alert-policy.manage',
            'ota.ai-policy.manage', 'ota.simulation-run.trigger'
        ]::TEXT[]
        WHEN 'OTA_OPERATION_MANAGER' THEN ARRAY[
            'ota.hotel.read', 'ota.price.preview',
            'ota.price-request.create', 'ota.price.approve-and-sync',
            'ota.secret-reference.manage', 'ota.room-mapping.manage',
            'ota.revenue-target.manage', 'ota.pace-curve.manage',
            'ota.alert-policy.manage', 'ota.ai-policy.manage'
        ]::TEXT[]
        WHEN 'OTA_OPERATION_ASSISTANT' THEN ARRAY[
            'ota.hotel.read', 'ota.price.preview', 'ota.price-request.create'
        ]::TEXT[]
        WHEN 'GENERAL_MANAGER' THEN ARRAY[
            'ota.hotel.read', 'ota.price.preview', 'ota.price-request.create'
        ]::TEXT[]
        WHEN 'ASSISTANT_GENERAL_MANAGER' THEN ARRAY[
            'ota.hotel.read', 'ota.price.preview', 'ota.price-request.create'
        ]::TEXT[]
        WHEN 'FRONT_OFFICE_SUPERVISOR' THEN ARRAY[
            'ota.hotel.read', 'ota.price.preview', 'ota.price-request.create'
        ]::TEXT[]
        ELSE ARRAY[]::TEXT[]
    END)
 WHERE role.role_code IN (
     'PLATFORM_ADMIN', 'OTA_OPERATION_MANAGER', 'OTA_OPERATION_ASSISTANT',
     'GENERAL_MANAGER', 'ASSISTANT_GENERAL_MANAGER',
     'FRONT_OFFICE_SUPERVISOR'
 )
ON CONFLICT DO NOTHING;

CREATE TABLE control.role_deprecation_event (
    role_deprecation_event_id UUID PRIMARY KEY,
    role_id UUID NOT NULL REFERENCES control.role_definition(role_id),
    role_code VARCHAR(64) NOT NULL,
    reason_code VARCHAR(64) NOT NULL,
    affected_account_role_count BIGINT NOT NULL CHECK (affected_account_role_count >= 0),
    affected_hotel_scope_count BIGINT NOT NULL CHECK (affected_hotel_scope_count >= 0),
    deprecated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    deprecated_by_database_role NAME NOT NULL DEFAULT SESSION_USER,
    UNIQUE (role_id),
    CHECK (role_code = 'REVENUE_MANAGER'),
    CHECK (reason_code = 'ROLE_REMOVED_FROM_ORG_MATRIX')
);

COMMENT ON TABLE control.role_deprecation_event IS
    'Append-only evidence that a legacy role stopped receiving new authorization; existing role metadata remains for historical decoding.';

INSERT INTO control.role_deprecation_event(
    role_deprecation_event_id,
    role_id,
    role_code,
    reason_code,
    affected_account_role_count,
    affected_hotel_scope_count
)
SELECT
    '70000000-0000-4000-8000-000000000001'::UUID,
    role.role_id,
    role.role_code,
    'ROLE_REMOVED_FROM_ORG_MATRIX',
    (
        SELECT count(*)
          FROM control.account_role AS assignment
         WHERE assignment.role_id = role.role_id
           AND assignment.valid_from <= CURRENT_TIMESTAMP
           AND (
               assignment.valid_until IS NULL
               OR assignment.valid_until > CURRENT_TIMESTAMP
           )
    ),
    (
        SELECT count(*)
          FROM ota.account_hotel_scope AS scope
         WHERE scope.role_code = role.role_code
           AND scope.valid_from <= CURRENT_TIMESTAMP
           AND (scope.valid_until IS NULL OR scope.valid_until > CURRENT_TIMESTAMP)
    )
FROM control.role_definition AS role
WHERE role.role_code = 'REVENUE_MANAGER'
ON CONFLICT (role_id) DO NOTHING;

UPDATE control.account_role AS assignment
   SET valid_until = CURRENT_TIMESTAMP
  FROM control.role_definition AS role
 WHERE assignment.role_id = role.role_id
   AND role.role_code = 'REVENUE_MANAGER'
   AND assignment.valid_from < CURRENT_TIMESTAMP
   AND (assignment.valid_until IS NULL OR assignment.valid_until > CURRENT_TIMESTAMP);

UPDATE ota.account_hotel_scope
   SET valid_until = CURRENT_TIMESTAMP
 WHERE role_code = 'REVENUE_MANAGER'
   AND valid_from < CURRENT_TIMESTAMP
   AND (valid_until IS NULL OR valid_until > CURRENT_TIMESTAMP);

CREATE FUNCTION control.reject_deprecated_account_role()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
BEGIN
    IF EXISTS (
        SELECT 1
          FROM control.role_deprecation_event AS event
         WHERE event.role_id = NEW.role_id
    ) AND (
        NEW.valid_from <= CURRENT_TIMESTAMP
        AND (NEW.valid_until IS NULL OR NEW.valid_until > CURRENT_TIMESTAMP)
    ) THEN
        RAISE EXCEPTION USING
            ERRCODE = '42501',
            MESSAGE = 'deprecated role cannot receive an active assignment';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_account_role_reject_deprecated
BEFORE INSERT OR UPDATE ON control.account_role
FOR EACH ROW
EXECUTE FUNCTION control.reject_deprecated_account_role();

CREATE TRIGGER trg_role_deprecation_event_append_only
BEFORE UPDATE OR DELETE ON control.role_deprecation_event
FOR EACH ROW
EXECUTE FUNCTION control.reject_append_only_mutation();

ALTER TABLE ota.account_hotel_scope
    DROP CONSTRAINT account_hotel_scope_check;

ALTER TABLE ota.account_hotel_scope
    ADD CONSTRAINT account_hotel_scope_role_type_check CHECK (
        (
            role_code IN (
                'PLATFORM_ADMIN', 'OTA_OPERATION_ASSISTANT',
                'OTA_OPERATION_MANAGER', 'CEO', 'REGIONAL_MANAGER',
                'GENERAL_MANAGER', 'ASSISTANT_GENERAL_MANAGER',
                'FRONT_OFFICE_SUPERVISOR'
            )
            AND scope_type = 'HOTEL_READ'
        )
        OR (
            role_code IN (
                'OTA_OPERATION_ASSISTANT', 'OTA_OPERATION_MANAGER',
                'GENERAL_MANAGER', 'ASSISTANT_GENERAL_MANAGER',
                'FRONT_OFFICE_SUPERVISOR'
            )
            AND scope_type = 'PRICE_REQUEST_INITIATION'
        )
        OR (
            role_code = 'OTA_OPERATION_MANAGER'
            AND scope_type = 'PRICE_APPROVAL'
        )
        OR (
            role_code = 'HOTEL_P1_HANDLER'
            AND scope_type = 'P1_HANDLING'
        )
    );

CREATE FUNCTION control.reject_deprecated_hotel_scope()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
BEGIN
    IF EXISTS (
        SELECT 1
          FROM control.role_deprecation_event AS event
         WHERE event.role_code = NEW.role_code
    ) AND (
        NEW.valid_from <= CURRENT_TIMESTAMP
        AND (NEW.valid_until IS NULL OR NEW.valid_until > CURRENT_TIMESTAMP)
    ) THEN
        RAISE EXCEPTION USING
            ERRCODE = '42501',
            MESSAGE = 'deprecated role cannot receive an active hotel scope';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_hotel_scope_reject_deprecated
BEFORE INSERT OR UPDATE ON ota.account_hotel_scope
FOR EACH ROW
EXECUTE FUNCTION control.reject_deprecated_hotel_scope();

-- Authorization remains a non-executable draft in WP2. A later, separately
-- approved migration may add UAT-passed/active states and guarded commands.
CREATE TABLE ota.connector_access_authorization_draft (
    tenant_id UUID NOT NULL,
    hotel_id UUID NOT NULL,
    connector_id UUID NOT NULL,
    connector_version_id UUID NOT NULL,
    authorization_draft_id UUID NOT NULL,
    access_mode VARCHAR(16) NOT NULL CHECK (access_mode IN ('READ', 'WRITE')),
    authorization_state VARCHAR(32) NOT NULL DEFAULT 'UAT_REQUIRED'
        CHECK (authorization_state = 'UAT_REQUIRED'),
    execution_allowed BOOLEAN NOT NULL DEFAULT FALSE CHECK (NOT execution_allowed),
    price_scope_code VARCHAR(64),
    formal_grant_reference_hash VARCHAR(64),
    uat_evidence_hash VARCHAR(64),
    reason_code VARCHAR(64) NOT NULL,
    created_by_account_id UUID NOT NULL REFERENCES control.auth_account(account_id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    row_version BIGINT NOT NULL DEFAULT 0 CHECK (row_version = 0),
    PRIMARY KEY (tenant_id, hotel_id, connector_id, authorization_draft_id),
    FOREIGN KEY (tenant_id, hotel_id, connector_id, connector_version_id)
        REFERENCES ota.hotel_source_connector_version(
            tenant_id, hotel_id, connector_id, connector_version_id
        ),
    UNIQUE (
        tenant_id, hotel_id, connector_id, connector_version_id, access_mode
    ),
    CHECK (reason_code ~ '^[A-Z][A-Z0-9_]{2,63}$'),
    CHECK (
        formal_grant_reference_hash IS NULL
        OR formal_grant_reference_hash ~ '^[A-Fa-f0-9]{64}$'
    ),
    CHECK (
        uat_evidence_hash IS NULL
        OR uat_evidence_hash ~ '^[A-Fa-f0-9]{64}$'
    ),
    CHECK (
        (access_mode = 'READ' AND price_scope_code IS NULL)
        OR (
            access_mode = 'WRITE'
            AND price_scope_code = 'STANDARD_RETAIL_ONLY'
        )
    )
);

COMMENT ON TABLE ota.connector_access_authorization_draft IS
    'WP2 UAT-required metadata only. A row neither proves vendor authorization nor permits reads/writes against an external system.';

-- A rehearsal binds only to an already-stored opaque SecretStore reference.
-- It accepts a SHA-256 legacy locator fingerprint, never a legacy path/value.
CREATE TABLE ota.credential_migration_rehearsal (
    tenant_id UUID NOT NULL,
    hotel_id UUID NOT NULL,
    connector_id UUID NOT NULL,
    connector_version_id UUID NOT NULL,
    migration_rehearsal_id UUID NOT NULL,
    target_binding_id UUID NOT NULL,
    secret_purpose VARCHAR(64) NOT NULL,
    source_system_code VARCHAR(64) NOT NULL,
    source_locator_hash VARCHAR(64) NOT NULL,
    target_provider_code VARCHAR(48) NOT NULL,
    target_secret_version VARCHAR(96) NOT NULL,
    target_secret_fingerprint VARCHAR(160) NOT NULL,
    migration_mode VARCHAR(32) NOT NULL DEFAULT 'METADATA_ONLY'
        CHECK (migration_mode = 'METADATA_ONLY'),
    rehearsal_state VARCHAR(40) NOT NULL DEFAULT 'METADATA_REHEARSAL_READY'
        CHECK (rehearsal_state = 'METADATA_REHEARSAL_READY'),
    raw_secret_received BOOLEAN NOT NULL DEFAULT FALSE CHECK (NOT raw_secret_received),
    execution_allowed BOOLEAN NOT NULL DEFAULT FALSE CHECK (NOT execution_allowed),
    planned_by_account_id UUID NOT NULL REFERENCES control.auth_account(account_id),
    reason_code VARCHAR(64) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    row_version BIGINT NOT NULL DEFAULT 0 CHECK (row_version = 0),
    PRIMARY KEY (tenant_id, hotel_id, connector_id, migration_rehearsal_id),
    FOREIGN KEY (tenant_id, hotel_id, connector_id, connector_version_id)
        REFERENCES ota.hotel_source_connector_version(
            tenant_id, hotel_id, connector_id, connector_version_id
        ),
    FOREIGN KEY (tenant_id, hotel_id, connector_id, target_binding_id)
        REFERENCES ota.connector_secret_binding(
            tenant_id, hotel_id, connector_id, binding_id
        ),
    UNIQUE (
        tenant_id, hotel_id, connector_id, connector_version_id,
        secret_purpose, source_system_code, source_locator_hash
    ),
    CHECK (secret_purpose ~ '^[A-Z][A-Z0-9_]{2,63}$'),
    CHECK (source_system_code ~ '^[A-Z][A-Z0-9_]{2,63}$'),
    CHECK (source_locator_hash ~ '^[A-Fa-f0-9]{64}$'),
    CHECK (target_provider_code ~ '^[A-Z][A-Z0-9_]{1,47}$'),
    CHECK (btrim(target_secret_version) <> ''),
    CHECK (target_secret_fingerprint ~ '^sha256:[A-Fa-f0-9]{64}$'),
    CHECK (reason_code ~ '^[A-Z][A-Z0-9_]{2,63}$')
);

COMMENT ON TABLE ota.credential_migration_rehearsal IS
    'Append-only metadata rehearsal. It records only hashes/fingerprints and a binding id; raw credentials and SecretStore references are intentionally absent.';

CREATE FUNCTION control.enforce_credential_migration_rehearsal()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
    connector_snapshot RECORD;
    binding_snapshot RECORD;
BEGIN
    IF control.current_tenant_id() IS DISTINCT FROM NEW.tenant_id THEN
        RAISE EXCEPTION USING
            ERRCODE = '42501',
            MESSAGE = 'tenant context mismatch';
    END IF;

    SELECT connector.connector_mode,
           connector.lifecycle_status,
           version.status AS version_status
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
       OR connector_snapshot.version_status <> 'DRAFT' THEN
        RAISE EXCEPTION USING
            ERRCODE = '55000',
            MESSAGE = 'migration rehearsal requires a configuration-only draft';
    END IF;

    SELECT binding.connector_version_id,
           binding.secret_purpose,
           binding.provider_code,
           binding.secret_version,
           binding.secret_fingerprint,
           binding.binding_status
      INTO binding_snapshot
      FROM ota.connector_secret_binding AS binding
     WHERE binding.tenant_id = NEW.tenant_id
       AND binding.hotel_id = NEW.hotel_id
       AND binding.connector_id = NEW.connector_id
       AND binding.binding_id = NEW.target_binding_id;

    IF NOT FOUND
       OR binding_snapshot.connector_version_id <> NEW.connector_version_id
       OR binding_snapshot.secret_purpose <> NEW.secret_purpose
       OR binding_snapshot.provider_code <> NEW.target_provider_code
       OR binding_snapshot.secret_version <> NEW.target_secret_version
       OR binding_snapshot.secret_fingerprint <> NEW.target_secret_fingerprint
       OR binding_snapshot.binding_status <> 'CONFIGURED' THEN
        RAISE EXCEPTION USING
            ERRCODE = '55000',
            MESSAGE = 'migration rehearsal target binding metadata mismatch';
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_credential_migration_rehearsal_insert
BEFORE INSERT ON ota.credential_migration_rehearsal
FOR EACH ROW
EXECUTE FUNCTION control.enforce_credential_migration_rehearsal();

CREATE TRIGGER trg_connector_access_authorization_draft_append_only
BEFORE UPDATE OR DELETE ON ota.connector_access_authorization_draft
FOR EACH ROW
EXECUTE FUNCTION control.reject_append_only_mutation();

CREATE TRIGGER trg_credential_migration_rehearsal_append_only
BEFORE UPDATE OR DELETE ON ota.credential_migration_rehearsal
FOR EACH ROW
EXECUTE FUNCTION control.reject_append_only_mutation();

ALTER TABLE ota.connector_access_authorization_draft ENABLE ROW LEVEL SECURITY;
ALTER TABLE ota.connector_access_authorization_draft FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation
ON ota.connector_access_authorization_draft
USING (tenant_id = control.current_tenant_id())
WITH CHECK (tenant_id = control.current_tenant_id());

ALTER TABLE ota.credential_migration_rehearsal ENABLE ROW LEVEL SECURITY;
ALTER TABLE ota.credential_migration_rehearsal FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation
ON ota.credential_migration_rehearsal
USING (tenant_id = control.current_tenant_id())
WITH CHECK (tenant_id = control.current_tenant_id());

REVOKE ALL ON TABLE control.role_deprecation_event FROM PUBLIC;
REVOKE ALL ON TABLE ota.connector_access_authorization_draft FROM PUBLIC;
REVOKE ALL ON TABLE ota.credential_migration_rehearsal FROM PUBLIC;
REVOKE ALL ON FUNCTION control.reject_deprecated_account_role() FROM PUBLIC;
REVOKE ALL ON FUNCTION control.reject_deprecated_hotel_scope() FROM PUBLIC;
REVOKE ALL ON FUNCTION control.enforce_credential_migration_rehearsal() FROM PUBLIC;
