-- @statement
INSERT INTO control.tenant_directory(
    tenant_id,
    tenant_code,
    display_name,
    status
) VALUES (
    '92000000-0000-4000-8000-000000000001',
    'sprint2d-concurrency',
    'Sprint 2D Concurrency',
    'ACTIVE'
);

-- @statement
INSERT INTO control.auth_account(
    account_id,
    login_name,
    display_name,
    status
) VALUES (
    '92000000-0000-4000-8000-000000000003',
    'sprint2d-concurrency-admin',
    'Sprint 2D Concurrency Admin',
    'ACTIVE'
);

-- @statement
INSERT INTO control.account_role(
    account_role_id,
    account_id,
    role_id,
    grant_reason_code
) VALUES (
    '92000000-0000-4000-8000-000000000004',
    '92000000-0000-4000-8000-000000000003',
    '10000000-0000-4000-8000-000000000001',
    'CONCURRENCY_VERIFICATION'
);

-- @statement
INSERT INTO control.auth_session(
    session_id,
    account_id,
    session_family_id,
    refresh_token_hash,
    authz_version_snapshot,
    issued_at,
    expires_at
) VALUES (
    '92000000-0000-4000-8000-000000000020',
    '92000000-0000-4000-8000-000000000003',
    '92000000-0000-4000-8000-000000000025',
    repeat('c', 64),
    1,
    clock_timestamp() - INTERVAL '1 minute',
    clock_timestamp() + INTERVAL '1 hour'
);

-- @statement
SELECT set_config(
    'app.tenant_id',
    '92000000-0000-4000-8000-000000000001',
    false
);
-- @statement
SELECT set_config(
    'app.account_id',
    '92000000-0000-4000-8000-000000000003',
    false
);
-- @statement
SELECT set_config(
    'app.auth_session_id',
    '92000000-0000-4000-8000-000000000020',
    false
);

-- @statement
INSERT INTO ota.hotel(
    tenant_id,
    hotel_id,
    hotel_code,
    display_name,
    lifecycle_status,
    collection_enabled,
    message_enabled
) VALUES (
    '92000000-0000-4000-8000-000000000001',
    '92000000-0000-4000-8000-000000000002',
    'sprint2d-concurrency-hotel',
    'Sprint 2D Concurrency Hotel',
    'DRAFT',
    FALSE,
    FALSE
);

-- @statement
INSERT INTO ota.hotel_source_connector(
    tenant_id,
    hotel_id,
    connector_id,
    source_type,
    adapter_code,
    connector_mode,
    lifecycle_status,
    display_name
) VALUES (
    '92000000-0000-4000-8000-000000000001',
    '92000000-0000-4000-8000-000000000002',
    '92000000-0000-4000-8000-000000000005',
    'PMS',
    'PMS_INTAKE',
    'CONFIGURATION_ONLY',
    'DRAFT',
    'Sprint 2D Concurrency Connector'
);

-- @statement
INSERT INTO ota.hotel_source_connector_version(
    tenant_id,
    hotel_id,
    connector_id,
    connector_version_id,
    version_no,
    adapter_version,
    parser_version,
    non_secret_config,
    capability_codes,
    config_hash,
    status,
    created_by_account_id
) VALUES (
    '92000000-0000-4000-8000-000000000001',
    '92000000-0000-4000-8000-000000000002',
    '92000000-0000-4000-8000-000000000005',
    '92000000-0000-4000-8000-000000000006',
    1,
    '0.0.0-concurrency',
    '0.0.0-concurrency',
    '{"connectionMethod":"CONTROLLED_BROWSER"}'::JSONB,
    ARRAY[]::TEXT[],
    repeat('a', 64),
    'DRAFT',
    '92000000-0000-4000-8000-000000000003'
);

-- @statement
INSERT INTO ota.connector_secret_binding(
    tenant_id,
    hotel_id,
    connector_id,
    connector_version_id,
    binding_id,
    secret_purpose,
    provider_code,
    secret_ref,
    secret_version,
    secret_fingerprint
) VALUES (
    '92000000-0000-4000-8000-000000000001',
    '92000000-0000-4000-8000-000000000002',
    '92000000-0000-4000-8000-000000000005',
    '92000000-0000-4000-8000-000000000006',
    '92000000-0000-4000-8000-000000000013',
    'BROWSER_SESSION',
    'OSKEYRING',
    'oskeyring://sprint2d-concurrency',
    'v1',
    repeat('b', 64)
);

-- @statement
SELECT (
    ota.start_browser_authorization_rehearsal(
        '92000000-0000-4000-8000-000000000001',
        '92000000-0000-4000-8000-000000000002',
        '92000000-0000-4000-8000-000000000005',
        '92000000-0000-4000-8000-000000000006',
        '92000000-0000-4000-8000-000000000021',
        '92000000-0000-4000-8000-000000000003',
        0,
        'PMS_INTAKE',
        '0.0.0-concurrency',
        repeat('1', 64),
        clock_timestamp() + INTERVAL '250 milliseconds',
        '92000000-0000-4000-8000-000000000026',
        'sprint2d-concurrency-predecessor',
        repeat('2', 64),
        'CONCURRENCY_VERIFICATION',
        NULL,
        NULL
    )
).authorization_attempt_id;

-- @statement
SELECT pg_sleep(0.35);
