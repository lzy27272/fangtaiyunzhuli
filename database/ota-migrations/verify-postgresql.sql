-- Run after V1 through V8 against a disposable OTA database using psql with ON_ERROR_STOP=1.
-- Catalog assertions are followed by rollback-only negative-control data checks.

DO $$
DECLARE
    table_name TEXT;
    required_tenant_tables CONSTANT TEXT[] := ARRAY[
        'hotel',
        'account_hotel_scope',
        'hotel_duty_roster_version',
        'hotel_duty_roster_assignment',
        'hotel_escalation_policy_version',
        'hotel_escalation_recipient',
        'ota_incident',
        'ota_incident_occurrence',
        'ota_task',
        'ota_task_event',
        'ota_outbox_event',
        'ota_outbox_publish_state',
        'hotel_business_day_config',
        'hotel_source_connector',
        'hotel_source_connector_version',
        'connector_contract_approved_baseline',
        'connector_contract_baseline_revocation',
        'connector_contract_command_receipt',
        'connector_secret_binding',
        'connector_authorization_state',
        'browser_authorization_attempt',
        'browser_authorization_command_receipt',
        'connector_access_authorization_draft',
        'credential_migration_rehearsal',
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
        'notification_delivery_attempt',
        'data_retention_policy_version',
        'data_quality_event',
        'safe_deep_link_policy_version',
        'ota_platform_alert',
        'ota_platform_alert_event',
        'alert_notification_intent',
        'hotel_ai_policy_version',
        'ai_advice_evaluation',
        'price_change_preview',
        'price_change_request',
        'price_change_event',
        'all_store_uat_run',
        'all_store_uat_daily_evidence',
        'hotel_release_decision'
    ];
BEGIN
    FOREACH table_name IN ARRAY required_tenant_tables
    LOOP
        IF to_regclass('ota.' || table_name) IS NULL THEN
            RAISE EXCEPTION 'required table ota.% is absent', table_name;
        END IF;
    END LOOP;

    FOR table_name IN
        SELECT relation.relname
        FROM pg_catalog.pg_class relation
        JOIN pg_catalog.pg_namespace namespace ON namespace.oid = relation.relnamespace
        WHERE namespace.nspname = 'ota'
          AND relation.relkind = 'r'
        ORDER BY relation.relname
    LOOP
        IF NOT EXISTS (
            SELECT 1
            FROM pg_catalog.pg_class relation
            JOIN pg_catalog.pg_namespace namespace ON namespace.oid = relation.relnamespace
            WHERE namespace.nspname = 'ota'
              AND relation.relname = table_name
              AND relation.relkind = 'r'
              AND relation.relrowsecurity
              AND relation.relforcerowsecurity
        ) THEN
            RAISE EXCEPTION 'ota.% must exist with ENABLE + FORCE RLS', table_name;
        END IF;

        IF NOT EXISTS (
            SELECT 1
            FROM pg_catalog.pg_policies
            WHERE schemaname = 'ota'
              AND tablename = table_name
              AND policyname = 'tenant_isolation'
        ) THEN
            RAISE EXCEPTION 'ota.% is missing tenant_isolation policy', table_name;
        END IF;
    END LOOP;
END;
$$;

DO $$
DECLARE
    expected_table TEXT;
    immutable_tables CONSTANT TEXT[] := ARRAY[
        'control.audit_event',
        'control.tenant_command_idempotency',
        'ota.ota_incident_occurrence',
        'ota.ota_task_event',
        'ota.ota_outbox_event',
        'ota.ota_command_idempotency',
        'ota.connector_collection_attempt',
        'ota.source_raw_record',
        'ota.pms_business_day_observation',
        'ota.pms_business_day_transition',
        'ota.pms_operating_observation',
        'ota.pms_room_charge_event',
        'ota.source_standard_record',
        'ota.inventory_observation',
        'ota.inventory_observation_item',
        'ota.source_booking_revision',
        'ota.booking_room_night_delta',
        'ota.daily_operation_snapshot',
        'ota.daily_operation_snapshot_metric',
        'ota.ota_hourly_brief',
        'ota.ota_brief_adjustment',
        'ota.notification_delivery_attempt',
        'ota.connector_contract_approved_baseline',
        'ota.connector_contract_baseline_revocation',
        'ota.connector_contract_command_receipt',
        'ota.browser_authorization_command_receipt',
        'control.role_deprecation_event',
        'ota.connector_access_authorization_draft',
        'ota.credential_migration_rehearsal',
        'ota.data_retention_policy_version',
        'ota.data_quality_event',
        'ota.safe_deep_link_policy_version',
        'ota.ota_platform_alert',
        'ota.ota_platform_alert_event',
        'ota.alert_notification_intent',
        'ota.hotel_ai_policy_version',
        'ota.ai_advice_evaluation',
        'ota.price_change_preview',
        'ota.price_change_event',
        'ota.all_store_uat_daily_evidence',
        'ota.hotel_release_decision',
        'control.connector_contract_candidate_manifest',
        'control.service_principal_rotation_event'
    ];
BEGIN
    FOREACH expected_table IN ARRAY immutable_tables
    LOOP
        IF NOT EXISTS (
            SELECT 1
            FROM pg_catalog.pg_trigger trigger
            JOIN pg_catalog.pg_class relation ON relation.oid = trigger.tgrelid
            JOIN pg_catalog.pg_namespace namespace ON namespace.oid = relation.relnamespace
            JOIN pg_catalog.pg_proc function ON function.oid = trigger.tgfoid
            JOIN pg_catalog.pg_namespace function_namespace ON function_namespace.oid = function.pronamespace
            WHERE namespace.nspname || '.' || relation.relname = expected_table
              AND NOT trigger.tgisinternal
              AND function_namespace.nspname = 'control'
              AND function.proname = 'reject_append_only_mutation'
        ) THEN
            RAISE EXCEPTION '% is missing its append-only mutation guard', expected_table;
        END IF;
    END LOOP;
END;
$$;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
          FROM information_schema.columns
         WHERE table_schema = 'ota'
           AND table_name IN (
               'data_retention_policy_version', 'data_quality_event',
               'safe_deep_link_policy_version', 'ota_platform_alert',
               'ota_platform_alert_event', 'alert_notification_intent',
               'hotel_ai_policy_version', 'ai_advice_evaluation',
               'price_change_preview', 'price_change_request',
               'price_change_event', 'all_store_uat_run',
               'all_store_uat_daily_evidence', 'hotel_release_decision'
           )
           AND lower(column_name) IN (
               'password', 'cookie', 'token', 'webhook_url', 'secret_value',
               'secret_ref', 'authorization_header', 'guest_name', 'guest_phone'
           )
    ) THEN
        RAISE EXCEPTION 'WP3-WP8 final-stage tables contain forbidden secret or guest PII columns';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_catalog.pg_constraint c
        JOIN pg_catalog.pg_class r ON r.oid = c.conrelid
        JOIN pg_catalog.pg_namespace n ON n.oid = r.relnamespace
        WHERE n.nspname = 'ota'
          AND r.relname = 'alert_notification_intent'
          AND pg_get_constraintdef(c.oid) LIKE '%P1%P2%IN_APP_AND_WECOM%'
    ) THEN
        RAISE EXCEPTION 'P1/P2 WeCom routing hard constraint is absent';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_catalog.pg_constraint c
        JOIN pg_catalog.pg_class r ON r.oid = c.conrelid
        JOIN pg_catalog.pg_namespace n ON n.oid = r.relnamespace
        WHERE n.nspname = 'ota'
          AND r.relname = 'price_change_preview'
          AND pg_get_constraintdef(c.oid) LIKE '%NOT external_execution_allowed%'
    ) THEN
        RAISE EXCEPTION 'Price write execution is not fail-closed';
    END IF;
END;
$$;

DO $$
DECLARE
    actual_roles TEXT[];
    expected_roles CONSTANT TEXT[] := ARRAY[
        'ASSISTANT_GENERAL_MANAGER', 'CEO', 'FRONT_OFFICE_SUPERVISOR',
        'GENERAL_MANAGER', 'HOTEL_P1_HANDLER', 'OTA_OPERATION_ASSISTANT',
        'OTA_OPERATION_MANAGER', 'PLATFORM_ADMIN', 'REGIONAL_MANAGER',
        'REVENUE_MANAGER'
    ];
BEGIN
    SELECT array_agg(role_code ORDER BY role_code)
    INTO actual_roles
    FROM control.role_definition;

    IF actual_roles IS DISTINCT FROM expected_roles THEN
        RAISE EXCEPTION 'Fixed role seed mismatch: %', actual_roles;
    END IF;
END;
$$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
          FROM control.role_deprecation_event
         WHERE role_code = 'REVENUE_MANAGER'
           AND reason_code = 'ROLE_REMOVED_FROM_ORG_MATRIX'
    ) THEN
        RAISE EXCEPTION 'Legacy revenue role deprecation evidence is absent';
    END IF;

    IF EXISTS (
        SELECT 1
          FROM control.account_role AS assignment
          JOIN control.role_definition AS role
            ON role.role_id = assignment.role_id
         WHERE role.role_code = 'REVENUE_MANAGER'
           AND assignment.valid_from <= CURRENT_TIMESTAMP
           AND (
               assignment.valid_until IS NULL
               OR assignment.valid_until > CURRENT_TIMESTAMP
           )
    ) THEN
        RAISE EXCEPTION 'Legacy revenue role still has an active account assignment';
    END IF;

    IF EXISTS (
        SELECT 1
          FROM information_schema.columns
         WHERE table_schema = 'ota'
           AND table_name IN (
               'connector_access_authorization_draft',
               'credential_migration_rehearsal'
           )
           AND lower(column_name) IN (
               'password', 'cookie', 'token', 'secret_value',
               'secret_ref', 'source_locator', 'legacy_locator'
           )
    ) THEN
        RAISE EXCEPTION 'WP2 preparation metadata contains a forbidden secret/locator column';
    END IF;

    IF NOT EXISTS (
        SELECT 1
          FROM pg_catalog.pg_constraint constraint_row
          JOIN pg_catalog.pg_class relation
            ON relation.oid = constraint_row.conrelid
          JOIN pg_catalog.pg_namespace namespace
            ON namespace.oid = relation.relnamespace
         WHERE namespace.nspname = 'ota'
           AND relation.relname = 'credential_migration_rehearsal'
           AND pg_get_constraintdef(constraint_row.oid) LIKE '%NOT raw_secret_received%'
    ) OR NOT EXISTS (
        SELECT 1
          FROM pg_catalog.pg_constraint constraint_row
          JOIN pg_catalog.pg_class relation
            ON relation.oid = constraint_row.conrelid
          JOIN pg_catalog.pg_namespace namespace
            ON namespace.oid = relation.relnamespace
         WHERE namespace.nspname = 'ota'
           AND relation.relname = 'credential_migration_rehearsal'
           AND pg_get_constraintdef(constraint_row.oid) LIKE '%NOT execution_allowed%'
    ) THEN
        RAISE EXCEPTION 'WP2 migration rehearsal is not fail-closed';
    END IF;
END;
$$;

DO $$
BEGIN
    IF control.current_tenant_id() IS NOT NULL THEN
        RAISE EXCEPTION 'Tenant context must fail closed when app.tenant_id is absent';
    END IF;

    IF NOT control.jsonb_contains_forbidden_secret_key('{"nested":{"access_token":"forbidden"}}'::JSONB) THEN
        RAISE EXCEPTION 'Secret-key JSON guard did not reject a nested access_token';
    END IF;

    IF NOT control.jsonb_contains_forbidden_secret_key('{"nested":{"api_key":"forbidden"}}'::JSONB) THEN
        RAISE EXCEPTION 'Secret-key JSON guard did not reject a normalized nested api_key';
    END IF;

    IF NOT control.jsonb_contains_forbidden_secret_key(
        '{"items":[{"safe_code":"ok"},{"authorization":"forbidden"}]}'::JSONB
    ) THEN
        RAISE EXCEPTION 'Secret-key JSON guard did not recurse into an array authorization key';
    END IF;

    IF NOT control.jsonb_contains_forbidden_secret_key('{"private_key":"forbidden"}'::JSONB) THEN
        RAISE EXCEPTION 'Secret-key JSON guard did not reject private_key';
    END IF;

    IF NOT control.jsonb_contains_forbidden_secret_key('{"session_token":"forbidden"}'::JSONB) THEN
        RAISE EXCEPTION 'Secret-key JSON guard did not reject session_token';
    END IF;

    IF NOT control.jsonb_contains_forbidden_secret_key('{"bearer_value":"forbidden"}'::JSONB) THEN
        RAISE EXCEPTION 'Secret-key JSON guard did not reject bearer-field fragments';
    END IF;

    IF NOT control.jsonb_contains_forbidden_secret_key('{"secret_ref_token":"forbidden"}'::JSONB) THEN
        RAISE EXCEPTION 'Safe reference exemption must be exact and reject secret_ref_token';
    END IF;

    IF control.jsonb_contains_forbidden_secret_key(
        '{
          "secret_ref":"kms://reference-only",
          "provider":"kms",
          "version":3,
          "secret_fingerprint":"sha256:reference-fingerprint",
          "metadata":[{"secret_id":"opaque-id","secret_version":"v3"}]
        }'::JSONB
    ) THEN
        RAISE EXCEPTION 'Exact SecretStore reference metadata keys must remain allowed';
    END IF;
END;
$$;

DO $$
DECLARE
    offending_table TEXT;
    offending_constraint TEXT;
    offending_column TEXT;
    function_name TEXT;
    constraint_text TEXT;
BEGIN
    SELECT relation.relname
      INTO offending_table
      FROM pg_catalog.pg_class relation
      JOIN pg_catalog.pg_namespace namespace ON namespace.oid = relation.relnamespace
     WHERE namespace.nspname = 'ota'
       AND relation.relkind = 'r'
       AND (
           NOT EXISTS (
               SELECT 1 FROM pg_catalog.pg_attribute attribute
                WHERE attribute.attrelid = relation.oid
                  AND attribute.attname = 'tenant_id'
                  AND NOT attribute.attisdropped
           )
           OR NOT EXISTS (
               SELECT 1 FROM pg_catalog.pg_attribute attribute
                WHERE attribute.attrelid = relation.oid
                  AND attribute.attname = 'hotel_id'
                  AND NOT attribute.attisdropped
           )
       )
     LIMIT 1;

    IF offending_table IS NOT NULL THEN
        RAISE EXCEPTION 'ota.% must contain tenant_id + hotel_id', offending_table;
    END IF;

    SELECT format('%I.%I', source_relation.relname, con.conname)
      INTO offending_constraint
      FROM pg_catalog.pg_constraint con
      JOIN pg_catalog.pg_class source_relation ON source_relation.oid = con.conrelid
      JOIN pg_catalog.pg_namespace source_namespace ON source_namespace.oid = source_relation.relnamespace
      JOIN pg_catalog.pg_class target_relation ON target_relation.oid = con.confrelid
      JOIN pg_catalog.pg_namespace target_namespace ON target_namespace.oid = target_relation.relnamespace
     WHERE con.contype = 'f'
       AND source_namespace.nspname = 'ota'
       AND target_namespace.nspname = 'ota'
       AND pg_catalog.pg_get_constraintdef(con.oid)
           NOT LIKE 'FOREIGN KEY (tenant_id, hotel_id,%'
       AND pg_catalog.pg_get_constraintdef(con.oid)
           NOT LIKE 'FOREIGN KEY (tenant_id, hotel_id) REFERENCES%'
     LIMIT 1;

    IF offending_constraint IS NOT NULL THEN
        RAISE EXCEPTION 'ota-to-ota foreign key must begin with tenant_id + hotel_id: %',
            offending_constraint;
    END IF;

    SELECT format('%I.%I.%I', table_schema, table_name, column_name)
      INTO offending_column
      FROM information_schema.columns
     WHERE table_schema = 'ota'
       AND (
           column_name ~ '(amount|revenue|adr)$'
           OR column_name LIKE '%_amount'
           OR column_name LIKE '%_revenue'
       )
       AND data_type <> 'numeric'
     LIMIT 1;

    IF offending_column IS NOT NULL THEN
        RAISE EXCEPTION 'Money column must use NUMERIC: %', offending_column;
    END IF;

    SELECT format('%I.%I.%I', table_schema, table_name, column_name)
      INTO offending_column
      FROM information_schema.columns
     WHERE table_schema IN ('control', 'ota')
       AND column_name ~ '_at$'
       AND data_type NOT IN ('timestamp with time zone', 'time without time zone')
     LIMIT 1;

    IF offending_column IS NOT NULL THEN
        RAISE EXCEPTION 'Timestamp column must use TIMESTAMPTZ: %', offending_column;
    END IF;

    IF EXISTS (
        SELECT 1
          FROM information_schema.columns
         WHERE table_schema IN ('control', 'ota')
           AND column_name IN (
               'password', 'refresh_token', 'access_token', 'cookie',
               'webhook_url', 'secret_value', 'authorization_header'
           )
    ) THEN
        RAISE EXCEPTION 'Plaintext credential/endpoint column is forbidden';
    END IF;

    FOREACH function_name IN ARRAY ARRAY[
        'create_tenant_directory_entry',
        'enqueue_ota_job',
        'dispatch_due_ota_jobs',
        'claim_ota_job',
        'renew_ota_job_lease',
        'complete_ota_job',
        'reject_configuration_only_runtime',
        'current_bound_service_principal_id',
        'assert_session_service_principal',
        'assert_session_active_service_principal',
        'current_authenticated_platform_admin_id',
        'approve_connector_contract_candidate',
        'revoke_connector_contract_baseline',
        'read_effective_connector_contract_baseline',
        'stage_service_principal_binding',
        'promote_service_principal_binding',
        'retire_service_principal_binding',
        'cancel_staged_service_principal_binding',
        'rollback_service_principal_promotion',
        'enforce_browser_authorization_rehearsal_insert'
    ]
    LOOP
        IF NOT EXISTS (
            SELECT 1
              FROM pg_catalog.pg_proc function
              JOIN pg_catalog.pg_namespace namespace ON namespace.oid = function.pronamespace
             WHERE namespace.nspname = 'control'
               AND function.proname = function_name
               AND function.prosecdef
               AND function.proconfig = ARRAY['search_path=pg_catalog']::TEXT[]
        ) THEN
            RAISE EXCEPTION 'control.% must be SECURITY DEFINER with fixed pg_catalog search_path',
                function_name;
        END IF;
    END LOOP;

    IF NOT EXISTS (
        SELECT 1
          FROM pg_catalog.pg_proc function
          JOIN pg_catalog.pg_namespace namespace
            ON namespace.oid = function.pronamespace
         WHERE namespace.nspname = 'ota'
           AND function.proname = 'start_browser_authorization_rehearsal'
           AND function.prosecdef
           AND function.proconfig =
               ARRAY['search_path=pg_catalog']::TEXT[]
    ) OR NOT EXISTS (
        SELECT 1
          FROM pg_catalog.pg_proc function
          JOIN pg_catalog.pg_namespace namespace
            ON namespace.oid = function.pronamespace
         WHERE namespace.nspname = 'ota'
           AND function.proname =
               'transition_browser_authorization_rehearsal'
           AND function.prosecdef
           AND function.proconfig =
               ARRAY['search_path=pg_catalog']::TEXT[]
    ) THEN
        RAISE EXCEPTION
            'Browser authorization rehearsal commands must be SECURITY DEFINER with fixed pg_catalog search_path';
    END IF;

    IF NOT EXISTS (
        SELECT 1
          FROM pg_catalog.pg_proc function
          JOIN pg_catalog.pg_namespace namespace
            ON namespace.oid = function.pronamespace
         WHERE namespace.nspname = 'control'
           AND function.proname = 'create_tenant_directory_entry'
           AND upper(pg_catalog.pg_get_functiondef(function.oid))
               LIKE '%ON CONFLICT ON CONSTRAINT TENANT_DIRECTORY_PKEY DO NOTHING%'
    ) THEN
        RAISE EXCEPTION
            'Tenant creation must use its named PK conflict target to avoid PL/pgSQL output-column ambiguity';
    END IF;

    IF EXISTS (
        SELECT 1
          FROM pg_catalog.pg_proc function
          JOIN pg_catalog.pg_namespace namespace ON namespace.oid = function.pronamespace
          CROSS JOIN LATERAL aclexplode(
              COALESCE(function.proacl, acldefault('f', function.proowner))
          ) acl
         WHERE namespace.nspname IN ('control', 'ota')
           AND function.proname IN (
               'create_tenant_directory_entry', 'enqueue_ota_job',
               'dispatch_due_ota_jobs', 'claim_ota_job',
                'renew_ota_job_lease', 'complete_ota_job',
                'current_bound_service_principal_id',
                'assert_session_service_principal',
                'enforce_configuration_only_connector',
                'enforce_configuration_only_version',
                 'reject_configuration_only_runtime',
                 'enforce_connector_contract_baseline_approval',
                 'current_authenticated_platform_admin_id',
                 'enforce_live_worker_write_session',
                 'approve_connector_contract_candidate',
                 'revoke_connector_contract_baseline',
                 'read_effective_connector_contract_baseline',
                 'assert_session_active_service_principal',
                 'stage_service_principal_binding',
                 'promote_service_principal_binding',
                 'retire_service_principal_binding',
                 'cancel_staged_service_principal_binding',
                 'rollback_service_principal_promotion',
                 'enforce_browser_authorization_rehearsal_insert',
                 'start_browser_authorization_rehearsal',
                 'transition_browser_authorization_rehearsal'
           )
           AND acl.grantee = 0
           AND acl.privilege_type = 'EXECUTE'
    ) THEN
        RAISE EXCEPTION 'PUBLIC EXECUTE must be revoked from command/job functions';
    END IF;

    SELECT lower(string_agg(pg_catalog.pg_get_constraintdef(con.oid), ' '))
      INTO constraint_text
      FROM pg_catalog.pg_constraint con
     WHERE con.conrelid IN (
         'ota.simulation_run'::regclass,
         'ota.hotel_message_endpoint'::regclass,
         'ota.notification_target'::regclass,
         'ota.notification_delivery'::regclass,
         'ota.notification_delivery_attempt'::regclass
     )
       AND con.contype = 'c';

    IF constraint_text NOT LIKE '%simulation_only%'
       OR constraint_text NOT LIKE '%not external_delivery_allowed%'
       OR constraint_text NOT LIKE '%not external_network_attempted%' THEN
        RAISE EXCEPTION 'Sprint 1 simulated delivery fail-closed constraints are incomplete';
    END IF;

    IF pg_catalog.pg_get_function_result(
        'control.claim_ota_job(uuid,uuid,uuid,timestamptz,timestamptz,text)'::regprocedure
    ) ~* '(secret|config|credential|token|cookie|endpoint|payload)' THEN
        RAISE EXCEPTION 'Job claim function exposes more than the minimal ID/schedule envelope';
    END IF;

    IF NOT EXISTS (
        SELECT 1
          FROM pg_catalog.pg_constraint con
         WHERE con.conrelid = 'ota.daily_operation_snapshot_metric'::regclass
           AND con.contype = 'c'
           AND pg_catalog.pg_get_constraintdef(con.oid) LIKE '%NOT_CONFIGURED%'
    ) THEN
        RAISE EXCEPTION 'Snapshot metric must preserve NOT_CONFIGURED separately';
    END IF;

    IF to_regclass('control.service_principal_database_role_binding') IS NULL
       OR NOT EXISTS (
           SELECT 1
             FROM pg_catalog.pg_constraint con
            WHERE con.conrelid =
                  'control.service_principal_database_role_binding'::regclass
              AND con.contype = 'p'
              AND pg_catalog.pg_get_constraintdef(con.oid)
                  LIKE '%(service_principal_id)%'
       )
       OR NOT EXISTS (
           SELECT 1
             FROM pg_catalog.pg_constraint con
            WHERE con.conrelid =
                  'control.service_principal_database_role_binding'::regclass
              AND con.contype = 'u'
              AND pg_catalog.pg_get_constraintdef(con.oid)
                  LIKE '%(database_role_name)%'
       ) THEN
        RAISE EXCEPTION
            'Database role/service principal one-to-one binding table is incomplete';
    END IF;

    IF EXISTS (
        SELECT 1
          FROM pg_catalog.pg_proc function
          JOIN pg_catalog.pg_namespace namespace
            ON namespace.oid = function.pronamespace
         WHERE namespace.nspname = 'control'
           AND (
               (
                   function.proname IN (
                       'dispatch_due_ota_jobs', 'claim_ota_job',
                       'renew_ota_job_lease'
                   )
                   AND pg_catalog.pg_get_functiondef(function.oid) NOT LIKE
                       '%control.assert_session_active_service_principal%'
               )
               OR (
                   function.proname = 'complete_ota_job'
                   AND pg_catalog.pg_get_functiondef(function.oid) NOT LIKE
                       '%control.assert_session_service_principal%'
               )
           )
    ) OR NOT EXISTS (
        SELECT 1
          FROM pg_catalog.pg_proc function
          JOIN pg_catalog.pg_namespace namespace
            ON namespace.oid = function.pronamespace
         WHERE namespace.nspname = 'control'
           AND function.proname = 'assert_session_service_principal'
           AND pg_catalog.pg_get_functiondef(function.oid) LIKE '%session_user%'
           AND pg_catalog.pg_get_functiondef(function.oid) LIKE
               '%service_principal_database_role_binding%'
           AND pg_catalog.pg_get_functiondef(function.oid) LIKE
               '%principal.status = ''ACTIVE''%'
    ) THEN
        RAISE EXCEPTION
            'Dispatch/lease functions do not enforce the ACTIVE session binding';
    END IF;

    IF EXISTS (
        SELECT 1
          FROM pg_catalog.pg_proc function
          JOIN pg_catalog.pg_namespace namespace
            ON namespace.oid = function.pronamespace
         WHERE namespace.nspname = 'control'
           AND function.proname IN (
               'claim_ota_job',
               'renew_ota_job_lease',
               'complete_ota_job'
           )
           AND (
               pg_catalog.pg_get_functiondef(function.oid)
                   NOT LIKE '%CONNECTOR_WORKER%'
               OR pg_catalog.pg_get_functiondef(function.oid)
                   LIKE '%SCHEDULER%'
           )
    ) OR NOT EXISTS (
        SELECT 1
          FROM pg_catalog.pg_proc function
          JOIN pg_catalog.pg_namespace namespace
            ON namespace.oid = function.pronamespace
         WHERE namespace.nspname = 'control'
           AND function.proname = 'dispatch_due_ota_jobs'
           AND pg_catalog.pg_get_functiondef(function.oid)
               LIKE '%SCHEDULER%'
           AND pg_catalog.pg_get_functiondef(function.oid)
               LIKE '%CONNECTOR_WORKER%'
           AND lower(pg_catalog.pg_get_functiondef(function.oid))
               LIKE '%extract(epoch from scheduled_slot)%'
           AND lower(pg_catalog.pg_get_functiondef(function.oid))
               NOT LIKE '%scheduled_slot::text%'
    ) THEN
        RAISE EXCEPTION
            'Worker lease purposes or timezone-independent dispatcher job identity are incomplete';
    END IF;

    IF EXISTS (
        SELECT expected.relation_name
          FROM (VALUES
              ('ota.daily_operation_snapshot'::regclass, 'cutoff_at'),
              ('ota.ota_hourly_brief'::regclass, 'cutoff_at')
          ) AS expected(relation_oid, relation_name)
         WHERE NOT EXISTS (
             SELECT 1
               FROM pg_catalog.pg_constraint con
              WHERE con.conrelid = expected.relation_oid
                AND con.contype = 'c'
                AND pg_catalog.pg_get_constraintdef(con.oid) LIKE
                    '%' || expected.relation_name || '%date_trunc%'
         )
    ) THEN
        RAISE EXCEPTION 'Collection/snapshot/brief cutoff must be exact-hour constrained';
    END IF;

    IF NOT EXISTS (
        SELECT 1
          FROM pg_catalog.pg_constraint con
         WHERE con.conrelid = 'ota.connector_collection_run'::regclass
           AND con.conname = 'connector_collection_run_cutoff_slot_check'
           AND lower(pg_catalog.pg_get_expr(con.conbin, con.conrelid))
               ~ $slot$date_trunc\('minute'[^,]*,[[:space:]]*scheduled_for\)$slot$
           AND lower(pg_catalog.pg_get_expr(con.conbin, con.conrelid))
               ~ $slot$date_trunc\('minute'[^,]*,[[:space:]]*cutoff_at\)$slot$
           AND lower(pg_catalog.pg_get_expr(con.conbin, con.conrelid))
               LIKE '%hourly_cutoff%'
           AND lower(pg_catalog.pg_get_expr(con.conbin, con.conrelid))
               LIKE '%manual_simulation%'
           AND lower(pg_catalog.pg_get_expr(con.conbin, con.conrelid))
               ~ $slot$date_trunc\('hour'[^,]*,[[:space:]]*scheduled_for\)$slot$
           AND lower(pg_catalog.pg_get_expr(con.conbin, con.conrelid))
               ~ $slot$date_trunc\('hour'[^,]*,[[:space:]]*cutoff_at\)$slot$
    ) THEN
        RAISE EXCEPTION
            'Collection run slots must permit exact-minute normal/file cutoffs and keep hourly/simulation exact-hour';
    END IF;

    IF NOT EXISTS (
        SELECT 1
          FROM pg_catalog.pg_constraint con
         WHERE con.conrelid = 'control.ota_job_registry'::regclass
           AND con.conname = 'ota_job_registry_scheduled_slot_check'
           AND lower(pg_catalog.pg_get_expr(con.conbin, con.conrelid))
               ~ $slot$date_trunc\('minute'[^,]*,[[:space:]]*scheduled_for\)$slot$
           AND lower(pg_catalog.pg_get_expr(con.conbin, con.conrelid))
               LIKE '%simulation_pipeline%'
           AND lower(pg_catalog.pg_get_expr(con.conbin, con.conrelid))
               LIKE '%hourly_cutoff%'
           AND lower(pg_catalog.pg_get_expr(con.conbin, con.conrelid))
               ~ $slot$date_trunc\('hour'[^,]*,[[:space:]]*scheduled_for\)$slot$
    ) THEN
        RAISE EXCEPTION
            'Job slots must allow exact minutes while simulation/hourly-cutoff remain exact-hour';
    END IF;

    SELECT lower(string_agg(pg_catalog.pg_get_constraintdef(con.oid), ' '))
      INTO constraint_text
      FROM pg_catalog.pg_constraint con
     WHERE con.conrelid = 'ota.connector_collection_schedule'::regclass
       AND con.contype = 'c';
    IF constraint_text NOT LIKE
           '%connector_collection_schedule_exact_interval_check%'
       AND NOT EXISTS (
           SELECT 1
             FROM pg_catalog.pg_constraint con
            WHERE con.conrelid =
                  'ota.connector_collection_schedule'::regclass
              AND con.conname =
                  'connector_collection_schedule_exact_interval_check'
              AND lower(pg_catalog.pg_get_constraintdef(con.oid))
                  LIKE '%interval_minutes%'
       ) THEN
        RAISE EXCEPTION
            'Normal/file collection next_due_at lacks exact interval alignment';
    END IF;

    IF EXISTS (
        SELECT 1
          FROM pg_catalog.pg_constraint con
         WHERE con.conrelid = 'ota.simulation_run'::regclass
           AND con.contype = 'c'
           AND pg_catalog.pg_get_constraintdef(con.oid)
               LIKE '%fixed_clock_at%date_trunc%'
    ) THEN
        RAISE EXCEPTION 'Simulation execution clock must not be constrained to an exact hour';
    END IF;

    IF EXISTS (
        SELECT required.column_name
          FROM (VALUES
              ('simulation_run_id'),
              ('replacement_frozen_body'),
              ('replacement_body_hash')
          ) AS required(column_name)
         WHERE NOT EXISTS (
             SELECT 1
               FROM pg_catalog.pg_attribute attribute
              WHERE attribute.attrelid = 'ota.ota_brief_adjustment'::regclass
                AND attribute.attname = required.column_name
                AND attribute.attnum > 0
                AND NOT attribute.attisdropped
                AND attribute.attnotnull
         )
    ) THEN
        RAISE EXCEPTION 'Brief adjustment does not preserve a required immutable replacement version';
    END IF;

    IF NOT EXISTS (
        SELECT 1
          FROM pg_catalog.pg_constraint con
         WHERE con.conrelid = 'ota.ota_brief_adjustment'::regclass
           AND con.contype = 'f'
           AND pg_catalog.pg_get_constraintdef(con.oid)
               LIKE '%(tenant_id, hotel_id, simulation_run_id)%REFERENCES ota.simulation_run%'
    ) OR NOT EXISTS (
        SELECT 1
          FROM pg_catalog.pg_constraint con
         WHERE con.conrelid = 'ota.ota_brief_adjustment'::regclass
           AND con.contype = 'u'
           AND pg_catalog.pg_get_constraintdef(con.oid)
               LIKE '%(tenant_id, hotel_id, simulation_run_id)%'
    ) THEN
        RAISE EXCEPTION 'Brief adjustment is not uniquely linked to its simulation run';
    END IF;

    IF NOT EXISTS (
        SELECT 1
          FROM pg_catalog.pg_indexes
         WHERE schemaname = 'control'
           AND indexname = 'uq_ota_job_collection_slot'
           AND indexdef LIKE '%WHERE (simulation_run_id IS NULL)%'
    ) OR NOT EXISTS (
        SELECT 1
          FROM pg_catalog.pg_indexes
         WHERE schemaname = 'control'
           AND indexname = 'uq_ota_job_simulation_slot'
           AND indexdef LIKE '%simulation_run_id%'
           AND indexdef LIKE '%WHERE (simulation_run_id IS NOT NULL)%'
    ) THEN
        RAISE EXCEPTION 'Ordinary/simulation job slot idempotency indexes are incomplete';
    END IF;

    IF NOT EXISTS (
        SELECT 1
          FROM pg_catalog.pg_indexes
         WHERE schemaname = 'ota'
           AND indexname = 'uq_collection_run_collection_slot'
           AND indexdef LIKE
               '%(tenant_id, hotel_id, connector_id, stream_code, trigger_type, scheduled_for)%'
           AND indexdef LIKE '%WHERE (simulation_run_id IS NULL)%'
    ) OR NOT EXISTS (
        SELECT 1
          FROM pg_catalog.pg_indexes
         WHERE schemaname = 'ota'
           AND indexname = 'uq_collection_run_simulation_slot'
           AND indexdef LIKE
               '%(tenant_id, hotel_id, connector_id, stream_code, trigger_type, scheduled_for, simulation_run_id)%'
           AND indexdef LIKE '%WHERE (simulation_run_id IS NOT NULL)%'
    ) THEN
        RAISE EXCEPTION 'Ordinary/simulation collection-run slot indexes are incomplete';
    END IF;

    IF NOT EXISTS (
        SELECT 1
          FROM pg_catalog.pg_attribute attribute
         WHERE attribute.attrelid = 'ota.inventory_observation_item'::regclass
           AND attribute.attname = 'sellable_room_count'
           AND NOT attribute.attnotnull
    ) OR NOT EXISTS (
        SELECT 1
          FROM pg_catalog.pg_constraint con
         WHERE con.conrelid = 'ota.inventory_observation_item'::regclass
           AND con.contype = 'c'
           AND pg_catalog.pg_get_constraintdef(con.oid)
               LIKE '%UNAVAILABLE%sellable_room_count IS NULL%'
    ) THEN
        RAISE EXCEPTION 'Unknown sellable inventory must allow NULL only with UNAVAILABLE quality';
    END IF;

    SELECT lower(string_agg(pg_catalog.pg_get_constraintdef(con.oid), ' '))
      INTO constraint_text
      FROM pg_catalog.pg_constraint con
     WHERE con.conrelid = 'ota.hotel_source_connector'::regclass
       AND con.contype = 'c';

    IF constraint_text NOT LIKE '%configuration_only%'
       OR constraint_text NOT LIKE '%draft%'
       OR constraint_text NOT LIKE '%paused%' THEN
        RAISE EXCEPTION
            'CONFIGURATION_ONLY connector mode/lifecycle constraints are incomplete';
    END IF;

    IF (
        SELECT count(*)
          FROM control.connector_adapter_registry adapter
         WHERE adapter.adapter_code IN (
             'PMS_INTAKE', 'CTRIP_INTAKE', 'MEITUAN_INTAKE'
         )
           AND NOT adapter.enabled
           AND NOT adapter.supports_simulation
           AND cardinality(adapter.capability_codes) = 0
           AND cardinality(adapter.allowed_host_patterns) = 0
           AND (
               (adapter.adapter_code = 'PMS_INTAKE' AND adapter.source_type = 'PMS')
               OR (adapter.adapter_code = 'CTRIP_INTAKE' AND adapter.source_type = 'CTRIP')
               OR (adapter.adapter_code = 'MEITUAN_INTAKE' AND adapter.source_type = 'MEITUAN')
           )
    ) <> 3 THEN
        RAISE EXCEPTION
            'Configuration-only intake templates must be disabled, hostless and capability-empty';
    END IF;

    IF (
        SELECT count(*)
          FROM pg_catalog.pg_trigger trigger
          JOIN pg_catalog.pg_class relation ON relation.oid = trigger.tgrelid
          JOIN pg_catalog.pg_namespace namespace ON namespace.oid = relation.relnamespace
         WHERE NOT trigger.tgisinternal
           AND namespace.nspname || '.' || relation.relname IN (
               'ota.hotel_source_connector',
               'ota.hotel_source_connector_version',
               'ota.connector_collection_schedule',
               'control.ota_job_registry',
               'ota.connector_collection_run',
               'ota.connector_stream_checkpoint'
           )
           AND trigger.tgname IN (
               'trg_hotel_source_connector_configuration_only',
               'trg_connector_version_configuration_only',
               'trg_schedule_reject_configuration_only',
               'trg_job_reject_configuration_only',
               'trg_collection_run_reject_configuration_only',
               'trg_checkpoint_reject_configuration_only'
           )
    ) <> 6 THEN
        RAISE EXCEPTION
            'CONFIGURATION_ONLY connector/version/runtime trigger guards are incomplete';
    END IF;

    IF pg_catalog.pg_get_functiondef(
        'control.dispatch_due_ota_jobs(uuid,timestamptz,integer)'::regprocedure
    ) NOT LIKE '%connector.connector_mode IN (''SIMULATION'', ''FILE_IMPORT'')%'
       OR pg_catalog.pg_get_functiondef(
           'control.dispatch_due_ota_jobs(uuid,timestamptz,integer)'::regprocedure
       ) LIKE '%CONFIGURATION_ONLY%' THEN
        RAISE EXCEPTION
            'Dispatcher allowlist must exclude CONFIGURATION_ONLY connectors';
    END IF;

    SELECT lower(string_agg(pg_catalog.pg_get_constraintdef(con.oid), ' '))
      INTO constraint_text
      FROM pg_catalog.pg_constraint con
     WHERE con.conrelid =
           'ota.browser_authorization_attempt'::regclass
       AND con.contype = 'c';

    IF constraint_text NOT LIKE '%offline_rehearsal%'
       OR constraint_text NOT LIKE '%auth_required%'
       OR constraint_text NOT LIKE '%waiting_for_operator%'
       OR constraint_text NOT LIKE '%offline_rehearsal_complete%'
       OR constraint_text NOT LIKE '%cancelled%'
       OR constraint_text NOT LIKE '%expired%'
       OR constraint_text NOT LIKE '%failed%'
       OR constraint_text LIKE '%''authorized''%'
       OR constraint_text LIKE '%''active''%'
       OR constraint_text LIKE '%''valid''%' THEN
        RAISE EXCEPTION
            'Offline browser authorization attempt states are not fail-closed';
    END IF;

    IF NOT EXISTS (
        SELECT 1
          FROM pg_catalog.pg_indexes
         WHERE schemaname = 'ota'
           AND tablename = 'browser_authorization_attempt'
           AND indexname =
               'uq_browser_authorization_attempt_active_connector'
           AND lower(indexdef) LIKE
               '%where%state_code%waiting_for_operator%'
    ) THEN
        RAISE EXCEPTION
            'Offline browser authorization attempt active uniqueness is missing';
    END IF;

    IF (
        SELECT count(*)
          FROM pg_catalog.pg_trigger trigger
          JOIN pg_catalog.pg_class relation
            ON relation.oid = trigger.tgrelid
          JOIN pg_catalog.pg_namespace namespace
            ON namespace.oid = relation.relnamespace
         WHERE NOT trigger.tgisinternal
           AND namespace.nspname = 'ota'
           AND (
               (
                   relation.relname = 'browser_authorization_attempt'
                   AND trigger.tgname IN (
                       'trg_browser_authorization_attempt_insert_guard',
                       'trg_browser_authorization_attempt_reject_delete'
                   )
               )
               OR
               (
                   relation.relname =
                       'browser_authorization_command_receipt'
                   AND trigger.tgname =
                       'trg_browser_authorization_command_receipt_append_only'
               )
           )
    ) <> 3 THEN
        RAISE EXCEPTION
            'Offline browser authorization attempt/receipt guards are incomplete';
    END IF;

    IF pg_catalog.pg_get_functiondef(
        'ota.start_browser_authorization_rehearsal(uuid,uuid,uuid,uuid,uuid,uuid,bigint,text,text,text,timestamptz,uuid,text,text,text,uuid,bigint)'::regprocedure
    ) NOT LIKE '%CONFIGURATION_ONLY%'
       OR pg_catalog.pg_get_functiondef(
           'ota.start_browser_authorization_rehearsal(uuid,uuid,uuid,uuid,uuid,uuid,bigint,text,text,text,timestamptz,uuid,text,text,text,uuid,bigint)'::regprocedure
       ) NOT LIKE '%AUTH_REQUIRED%'
       OR pg_catalog.pg_get_functiondef(
           'ota.transition_browser_authorization_rehearsal(uuid,uuid,uuid,uuid,uuid,uuid,bigint,text,text,bigint,text,uuid,text,text,text)'::regprocedure
       ) NOT LIKE '%CONFIGURATION_ONLY%'
       OR pg_catalog.pg_get_functiondef(
           'ota.transition_browser_authorization_rehearsal(uuid,uuid,uuid,uuid,uuid,uuid,bigint,text,text,bigint,text,uuid,text,text,text)'::regprocedure
       ) NOT LIKE '%AUTH_REQUIRED%' THEN
        RAISE EXCEPTION
            'Offline browser authorization commands lost their configuration-only AUTH_REQUIRED gate';
    END IF;

    IF pg_catalog.pg_get_functiondef(
        'ota.start_browser_authorization_rehearsal(uuid,uuid,uuid,uuid,uuid,uuid,bigint,text,text,text,timestamptz,uuid,text,text,text,uuid,bigint)'::regprocedure
    ) NOT LIKE '%p_predecessor_authorization_attempt_id%'
       OR pg_catalog.pg_get_functiondef(
           'ota.start_browser_authorization_rehearsal(uuid,uuid,uuid,uuid,uuid,uuid,bigint,text,text,text,timestamptz,uuid,text,text,text,uuid,bigint)'::regprocedure
       ) NOT LIKE '%p_predecessor_expected_row_version%'
       OR pg_catalog.pg_get_functiondef(
           'ota.start_browser_authorization_rehearsal(uuid,uuid,uuid,uuid,uuid,uuid,bigint,text,text,text,timestamptz,uuid,text,text,text,uuid,bigint)'::regprocedure
       ) NOT LIKE '%FOR UPDATE%'
       OR pg_catalog.pg_get_functiondef(
           'ota.start_browser_authorization_rehearsal(uuid,uuid,uuid,uuid,uuid,uuid,bigint,text,text,text,timestamptz,uuid,text,text,text,uuid,bigint)'::regprocedure
       ) NOT LIKE '%predecessor_attempt.row_version IS DISTINCT FROM%'
       OR pg_catalog.pg_get_functiondef(
           'ota.start_browser_authorization_rehearsal(uuid,uuid,uuid,uuid,uuid,uuid,bigint,text,text,text,timestamptz,uuid,text,text,text,uuid,bigint)'::regprocedure
       ) NOT LIKE '%expired_attempt := predecessor_attempt%'
       OR pg_catalog.pg_get_functiondef(
           'ota.transition_browser_authorization_rehearsal(uuid,uuid,uuid,uuid,uuid,uuid,bigint,text,text,bigint,text,uuid,text,text,text)'::regprocedure
       ) NOT LIKE '%transition_now >= attempt_row.expires_at%'
       OR pg_catalog.pg_get_functiondef(
           'ota.transition_browser_authorization_rehearsal(uuid,uuid,uuid,uuid,uuid,uuid,bigint,text,text,bigint,text,uuid,text,text,text)'::regprocedure
       ) NOT LIKE '%p_target_state <> ''EXPIRED''%' THEN
        RAISE EXCEPTION
            'Offline authorization predecessor locking/CAS or expiry-only transition gate is incomplete';
    END IF;

    IF (
        SELECT count(*)
          FROM pg_catalog.pg_attribute
         WHERE attrelid =
               'ota.browser_authorization_command_receipt'::regclass
           AND attname IN (
               'predecessor_authorization_attempt_id',
               'predecessor_expected_row_version'
           )
           AND attnum > 0
           AND NOT attisdropped
    ) <> 2 THEN
        RAISE EXCEPTION
            'Offline authorization receipts do not preserve predecessor idempotency binding';
    END IF;

    IF pg_catalog.pg_get_functiondef(
        'control.enforce_browser_authorization_rehearsal_insert()'::regprocedure
    ) NOT LIKE '%source_type <> ''PMS''%'
       OR pg_catalog.pg_get_functiondef(
           'control.enforce_browser_authorization_rehearsal_insert()'::regprocedure
       ) NOT LIKE '%CONTROLLED_BROWSER%'
       OR pg_catalog.pg_get_functiondef(
           'control.enforce_browser_authorization_rehearsal_insert()'::regprocedure
       ) NOT LIKE '%secret_purpose = ''BROWSER_SESSION''%'
       OR pg_catalog.pg_get_functiondef(
           'control.enforce_browser_authorization_rehearsal_insert()'::regprocedure
       ) NOT LIKE '%binding_status = ''CONFIGURED''%'
       OR pg_catalog.pg_get_functiondef(
           'ota.start_browser_authorization_rehearsal(uuid,uuid,uuid,uuid,uuid,uuid,bigint,text,text,text,timestamptz,uuid,text,text,text,uuid,bigint)'::regprocedure
       ) NOT LIKE '%source_type <> ''PMS''%'
       OR pg_catalog.pg_get_functiondef(
           'ota.start_browser_authorization_rehearsal(uuid,uuid,uuid,uuid,uuid,uuid,bigint,text,text,text,timestamptz,uuid,text,text,text,uuid,bigint)'::regprocedure
       ) NOT LIKE '%CONTROLLED_BROWSER%'
       OR pg_catalog.pg_get_functiondef(
           'ota.start_browser_authorization_rehearsal(uuid,uuid,uuid,uuid,uuid,uuid,bigint,text,text,text,timestamptz,uuid,text,text,text,uuid,bigint)'::regprocedure
       ) NOT LIKE '%secret_purpose = ''BROWSER_SESSION''%'
       OR pg_catalog.pg_get_functiondef(
           'ota.transition_browser_authorization_rehearsal(uuid,uuid,uuid,uuid,uuid,uuid,bigint,text,text,bigint,text,uuid,text,text,text)'::regprocedure
       ) NOT LIKE '%source_type <> ''PMS''%'
       OR pg_catalog.pg_get_functiondef(
           'ota.transition_browser_authorization_rehearsal(uuid,uuid,uuid,uuid,uuid,uuid,bigint,text,text,bigint,text,uuid,text,text,text)'::regprocedure
       ) NOT LIKE '%CONTROLLED_BROWSER%'
       OR pg_catalog.pg_get_functiondef(
           'ota.transition_browser_authorization_rehearsal(uuid,uuid,uuid,uuid,uuid,uuid,bigint,text,text,bigint,text,uuid,text,text,text)'::regprocedure
       ) NOT LIKE '%secret_purpose = ''BROWSER_SESSION''%' THEN
        RAISE EXCEPTION
            'Offline browser authorization commands lost the PMS controlled-browser configured-session gate';
    END IF;

    IF EXISTS (
        SELECT 1
          FROM pg_catalog.pg_class relation
          CROSS JOIN LATERAL aclexplode(
              COALESCE(
                  relation.relacl,
                  acldefault('r', relation.relowner)
              )
          ) acl
         WHERE relation.oid IN (
             'ota.browser_authorization_attempt'::regclass,
             'ota.browser_authorization_command_receipt'::regclass
         )
           AND acl.grantee = 0
           AND acl.privilege_type IN (
               'SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE',
               'REFERENCES', 'TRIGGER'
           )
    ) THEN
        RAISE EXCEPTION
            'Offline browser authorization tables must expose no PUBLIC privileges';
    END IF;

    IF EXISTS (
        SELECT 1
          FROM pg_catalog.pg_class relation
          CROSS JOIN LATERAL aclexplode(
              COALESCE(
                  relation.relacl,
                  acldefault('r', relation.relowner)
              )
          ) acl
         WHERE relation.oid IN (
             'ota.browser_authorization_attempt'::regclass,
             'ota.browser_authorization_command_receipt'::regclass
         )
           AND acl.grantee <> relation.relowner
           AND acl.privilege_type IN (
               'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE',
               'REFERENCES', 'TRIGGER'
           )
    ) THEN
        RAISE EXCEPTION
            'Offline browser authorization tables must be runtime read-only; commands must use CAS functions';
    END IF;

    IF NOT EXISTS (
        SELECT 1
          FROM pg_catalog.pg_constraint con
         WHERE con.conrelid =
               'ota.connector_contract_approved_baseline'::regclass
           AND con.contype = 'u'
           AND pg_catalog.pg_get_constraintdef(con.oid) LIKE
               '%(tenant_id, hotel_id, connector_id, connector_version_id, stream_code)%'
    ) OR EXISTS (
        SELECT 1
          FROM pg_catalog.pg_class relation
          CROSS JOIN LATERAL aclexplode(
              COALESCE(relation.relacl, acldefault('r', relation.relowner))
          ) acl
         WHERE relation.oid =
               'ota.connector_contract_approved_baseline'::regclass
           AND acl.grantee = 0
           AND acl.privilege_type IN (
               'SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE',
               'REFERENCES', 'TRIGGER'
           )
    ) THEN
        RAISE EXCEPTION
            'Approved contract baseline uniqueness or PUBLIC-zero boundary is incomplete';
    END IF;

    IF (
        SELECT array_agg(adapter_code || ':' || source_type ORDER BY adapter_code)
          FROM control.connector_adapter_registry
    ) IS DISTINCT FROM ARRAY[
        'CTRIP_INTAKE:CTRIP',
        'FILE_FIXTURE:OFFICIAL_EXPORT',
        'MEITUAN_INTAKE:MEITUAN',
        'MOCK_CTRIP:CTRIP',
        'MOCK_MEITUAN:MEITUAN',
        'MOCK_PMS:PMS',
        'PMS_INTAKE:PMS'
    ]::TEXT[] THEN
        RAISE EXCEPTION 'Mock/file/intake adapter registry seed mismatch';
    END IF;
END;
$$;

DO $sprint2c_catalog$
DECLARE
    read_result TEXT;
    prior_tenant_setting TEXT;
    superuser_probe_tenant CONSTANT UUID :=
        '27000000-0000-4000-8000-000000000001';
BEGIN
    IF COALESCE((
        SELECT role.rolsuper
          FROM pg_catalog.pg_roles AS role
         WHERE role.rolname = session_user
    ), FALSE) THEN
        prior_tenant_setting := current_setting('app.tenant_id', TRUE);
        PERFORM set_config(
            'app.tenant_id',
            superuser_probe_tenant::TEXT,
            TRUE
        );
        IF control.current_tenant_id() IS DISTINCT FROM superuser_probe_tenant THEN
            RAISE EXCEPTION
                'Superuser capability membership must not be mistaken for a delegated Worker identity';
        END IF;
        PERFORM set_config(
            'app.tenant_id',
            COALESCE(prior_tenant_setting, ''),
            TRUE
        );
    END IF;

    IF NOT EXISTS (
        SELECT 1
          FROM information_schema.columns
         WHERE table_schema = 'ota'
           AND table_name = 'connector_contract_approved_baseline'
           AND column_name = 'candidate_id'
           AND is_nullable = 'NO'
    ) OR NOT EXISTS (
        SELECT 1
          FROM information_schema.columns
         WHERE table_schema = 'ota'
           AND table_name = 'connector_contract_approved_baseline'
           AND column_name = 'approved_config_hash'
           AND is_nullable = 'NO'
    ) THEN
        RAISE EXCEPTION
            'Trusted candidate/config snapshot columns are missing from contract approval facts';
    END IF;

    SELECT pg_catalog.pg_get_function_result(
        'control.read_effective_connector_contract_baseline(uuid,uuid,uuid,uuid,text)'::regprocedure
    )
      INTO read_result;
    IF read_result NOT LIKE '%connector_code text%'
       OR read_result NOT LIKE '%adapter_version text%'
       OR read_result NOT LIKE '%fingerprint_algorithm text%'
       OR read_result NOT LIKE '%capability_fingerprint text%'
       OR read_result NOT LIKE '%schema_fingerprint text%'
       OR read_result NOT LIKE '%approval_status text%'
       OR read_result NOT LIKE '%connector_version_status text%' THEN
        RAISE EXCEPTION 'Worker narrow contract read has an unexpected result contract: %',
            read_result;
    END IF;

    IF EXISTS (
        SELECT 1
          FROM pg_catalog.pg_proc AS function
          JOIN pg_catalog.pg_namespace AS namespace
            ON namespace.oid = function.pronamespace
          CROSS JOIN LATERAL aclexplode(
              COALESCE(function.proacl, acldefault('f', function.proowner))
          ) AS acl
         WHERE namespace.nspname = 'control'
           AND function.proname IN (
               'approve_connector_contract_candidate',
               'revoke_connector_contract_baseline',
               'read_effective_connector_contract_baseline',
               'stage_service_principal_binding',
               'promote_service_principal_binding',
               'retire_service_principal_binding',
               'cancel_staged_service_principal_binding',
               'rollback_service_principal_promotion'
           )
           AND acl.grantee = 0
           AND acl.privilege_type = 'EXECUTE'
    ) THEN
        RAISE EXCEPTION 'Sprint 2C controlled functions expose PUBLIC EXECUTE';
    END IF;

    IF NOT EXISTS (
        SELECT 1
          FROM pg_catalog.pg_index AS index_metadata
          JOIN pg_catalog.pg_class AS index_relation
            ON index_relation.oid = index_metadata.indexrelid
         WHERE index_metadata.indrelid =
               'control.service_principal_database_role_binding'::regclass
           AND index_relation.relname =
               'uq_service_principal_live_scope_slot'
           AND index_metadata.indisunique
           AND index_metadata.indnkeyatts = 2
           AND index_metadata.indnatts = 2
           AND index_metadata.indkey[0] = (
               SELECT attribute.attnum
                 FROM pg_catalog.pg_attribute AS attribute
                WHERE attribute.attrelid = index_metadata.indrelid
                  AND attribute.attname = 'binding_scope'
                  AND attribute.attnum > 0
                  AND NOT attribute.attisdropped
           )
           AND index_metadata.indkey[1] = (
               SELECT attribute.attnum
                 FROM pg_catalog.pg_attribute AS attribute
                WHERE attribute.attrelid = index_metadata.indrelid
                  AND attribute.attname = 'rotation_slot'
                  AND attribute.attnum > 0
                  AND NOT attribute.attisdropped
           )
           AND regexp_replace(
               lower(pg_catalog.pg_get_expr(
                   index_metadata.indpred,
                   index_metadata.indrelid
               )),
               '[[:space:]()]',
               '',
               'g'
           ) ~ '^binding_state(::text)?<>''retired''::text$'
    ) OR NOT EXISTS (
        SELECT 1
          FROM pg_catalog.pg_constraint AS constraint_metadata
         WHERE constraint_metadata.conrelid =
               'control.service_principal_database_role_binding'::regclass
           AND constraint_metadata.contype = 'u'
           AND constraint_metadata.conkey = ARRAY[(
               SELECT attribute.attnum
                 FROM pg_catalog.pg_attribute AS attribute
                WHERE attribute.attrelid = constraint_metadata.conrelid
                  AND attribute.attname = 'database_role_name'
                  AND attribute.attnum > 0
                  AND NOT attribute.attisdropped
           )]::SMALLINT[]
    ) OR NOT EXISTS (
        SELECT 1
          FROM pg_catalog.pg_constraint AS constraint_metadata
         WHERE constraint_metadata.conrelid =
               'control.service_principal_database_role_binding'::regclass
           AND constraint_metadata.contype = 'u'
           AND constraint_metadata.conkey = ARRAY[(
               SELECT attribute.attnum
                 FROM pg_catalog.pg_attribute AS attribute
                WHERE attribute.attrelid = constraint_metadata.conrelid
                  AND attribute.attname = 'database_role_oid'
                  AND attribute.attnum > 0
                  AND NOT attribute.attisdropped
           )]::SMALLINT[]
    ) THEN
        RAISE EXCEPTION
            'Blue/green slots or permanent database LOGIN uniqueness are not enforced';
    END IF;

    IF pg_catalog.pg_get_functiondef(
        'control.dispatch_due_ota_jobs(uuid,timestamptz,integer)'::regprocedure
    ) NOT LIKE '%assert_session_active_service_principal%'
       OR pg_catalog.pg_get_functiondef(
           'control.claim_ota_job(uuid,uuid,uuid,timestamptz,timestamptz,text)'::regprocedure
       ) NOT LIKE '%assert_session_active_service_principal%'
       OR pg_catalog.pg_get_functiondef(
           'control.renew_ota_job_lease(uuid,uuid,uuid,timestamptz,timestamptz)'::regprocedure
       ) NOT LIKE '%assert_session_active_service_principal%'
       OR pg_catalog.pg_get_functiondef(
           'control.complete_ota_job(uuid,uuid,uuid,timestamptz,text,text)'::regprocedure
       ) NOT LIKE '%assert_session_service_principal%' THEN
        RAISE EXCEPTION
            'ACTIVE dispatch/claim/renew or bounded DRAINING completion semantics are incomplete';
    END IF;

    IF (
        SELECT provolatile <> 's'
          FROM pg_catalog.pg_proc
         WHERE oid = 'control.current_tenant_id()'::regprocedure
    ) OR pg_catalog.pg_get_functiondef(
        'control.current_tenant_id()'::regprocedure
    ) LIKE '%FOR SHARE%'
       OR pg_catalog.pg_get_functiondef(
           'control.current_tenant_id()'::regprocedure
       ) NOT LIKE '%statement_timestamp()%'
       OR (
           SELECT provolatile <> 'v'
             FROM pg_catalog.pg_proc
            WHERE oid =
                  'control.read_effective_connector_contract_baseline(uuid,uuid,uuid,uuid,text)'::regprocedure
       ) THEN
        RAISE EXCEPTION
            'Tenant RLS helper or narrow contract read volatility is unsafe';
    END IF;

    IF regexp_replace(
        lower(pg_catalog.pg_get_functiondef(
            'control.dispatch_due_ota_jobs(uuid,timestamptz,integer)'::regprocedure
        )),
        '[[:space:]]',
        '',
        'g'
    ) NOT LIKE '%fromcontrol.tenant_directoryasdirectory%'
       OR regexp_replace(
           lower(pg_catalog.pg_get_functiondef(
               'control.dispatch_due_ota_jobs(uuid,timestamptz,integer)'::regprocedure
           )),
           '[[:space:]]',
           '',
           'g'
       ) NOT LIKE '%set_config(''app.tenant_id'',tenant_row.dispatch_tenant_id::text,true)%'
       OR regexp_replace(
           lower(pg_catalog.pg_get_functiondef(
               'control.dispatch_due_ota_jobs(uuid,timestamptz,integer)'::regprocedure
           )),
           '[[:space:]]',
           '',
           'g'
       ) NOT LIKE '%database_now:=clock_timestamp();%' THEN
        RAISE EXCEPTION
            'Per-tenant dispatch or dispatch database clock is missing';
    END IF;

    IF regexp_replace(
        lower(pg_catalog.pg_get_functiondef(
            'control.claim_ota_job(uuid,uuid,uuid,timestamptz,timestamptz,text)'::regprocedure
        )),
        '[[:space:]]',
        '',
        'g'
    ) NOT LIKE '%database_now:=clock_timestamp();%'
       OR regexp_replace(
           lower(pg_catalog.pg_get_functiondef(
               'control.claim_ota_job(uuid,uuid,uuid,timestamptz,timestamptz,text)'::regprocedure
           )),
           '[[:space:]]',
           '',
           'g'
       ) NOT LIKE '%database_lease_until:=database_now+requested_lease_duration;%'
       OR regexp_replace(
           lower(pg_catalog.pg_get_functiondef(
               'control.claim_ota_job(uuid,uuid,uuid,timestamptz,timestamptz,text)'::regprocedure
           )),
           '[[:space:]]',
           '',
           'g'
       ) NOT LIKE '%lease_acquired_at=database_now%' THEN
        RAISE EXCEPTION
            'Claim must acquire a lease using only the database clock';
    END IF;

    IF regexp_replace(
        lower(pg_catalog.pg_get_functiondef(
            'control.renew_ota_job_lease(uuid,uuid,uuid,timestamptz,timestamptz)'::regprocedure
        )),
        '[[:space:]]',
        '',
        'g'
    ) NOT LIKE '%database_now:=clock_timestamp();%'
       OR regexp_replace(
           lower(pg_catalog.pg_get_functiondef(
               'control.renew_ota_job_lease(uuid,uuid,uuid,timestamptz,timestamptz)'::regprocedure
           )),
           '[[:space:]]',
           '',
           'g'
       ) NOT LIKE '%database_lease_until:=database_now+requested_lease_duration;%'
       OR regexp_replace(
           lower(pg_catalog.pg_get_functiondef(
               'control.renew_ota_job_lease(uuid,uuid,uuid,timestamptz,timestamptz)'::regprocedure
           )),
           '[[:space:]]',
           '',
           'g'
       ) NOT LIKE '%job.lease_until>database_now%' THEN
        RAISE EXCEPTION
            'Renew must extend only a live ACTIVE lease using the database clock';
    END IF;

    IF regexp_replace(
        lower(pg_catalog.pg_get_functiondef(
            'control.complete_ota_job(uuid,uuid,uuid,timestamptz,text,text)'::regprocedure
        )),
        '[[:space:]]',
        '',
        'g'
    ) NOT LIKE '%database_now:=clock_timestamp();%'
       OR regexp_replace(
           lower(pg_catalog.pg_get_functiondef(
               'control.complete_ota_job(uuid,uuid,uuid,timestamptz,text,text)'::regprocedure
           )),
           '[[:space:]]',
           '',
           'g'
       ) NOT LIKE '%job.lease_until>=database_now%'
       OR regexp_replace(
           lower(pg_catalog.pg_get_functiondef(
               'control.complete_ota_job(uuid,uuid,uuid,timestamptz,text,text)'::regprocedure
           )),
           '[[:space:]]',
           '',
           'g'
       ) NOT LIKE '%live_binding_state=''draining''%'
       OR regexp_replace(
           lower(pg_catalog.pg_get_functiondef(
               'control.complete_ota_job(uuid,uuid,uuid,timestamptz,text,text)'::regprocedure
           )),
           '[[:space:]]',
           '',
           'g'
       ) NOT LIKE '%database_now<=live_draining_at+interval''15minutes''%'
       OR regexp_replace(
           lower(pg_catalog.pg_get_functiondef(
               'control.complete_ota_job(uuid,uuid,uuid,timestamptz,text,text)'::regprocedure
           )),
           '[[:space:]]',
           '',
           'g'
       ) NOT LIKE '%job.lease_acquired_atisnotnull%'
       OR regexp_replace(
           lower(pg_catalog.pg_get_functiondef(
               'control.complete_ota_job(uuid,uuid,uuid,timestamptz,text,text)'::regprocedure
           )),
           '[[:space:]]',
           '',
           'g'
       ) NOT LIKE '%job.lease_acquired_at<=live_draining_at%' THEN
        RAISE EXCEPTION
            'Completion must require a live pre-drain lease within the 15-minute drain window';
    END IF;

    IF NOT EXISTS (
        SELECT 1
          FROM information_schema.columns
         WHERE table_schema = 'control'
           AND table_name = 'service_principal_database_role_binding'
           AND column_name = 'database_role_oid'
           AND is_nullable = 'NO'
    ) OR NOT EXISTS (
        SELECT 1
          FROM information_schema.columns
         WHERE table_schema = 'control'
           AND table_name = 'ota_job_registry'
           AND column_name = 'lease_acquired_at'
    ) OR NOT EXISTS (
        SELECT 1
          FROM pg_catalog.pg_constraint
         WHERE conrelid = 'ota.hotel'::regclass
           AND conname = 'hotel_message_delivery_disabled'
           AND contype = 'c'
           AND convalidated
           AND regexp_replace(
               lower(pg_catalog.pg_get_constraintdef(oid)),
               '[[:space:]()]',
               '',
               'g'
           ) = 'checknotmessage_enabled'
    ) OR NOT EXISTS (
        SELECT 1
          FROM pg_catalog.pg_attribute
         WHERE attrelid = 'ota.hotel'::regclass
           AND attname = 'message_enabled'
           AND attnum > 0
           AND NOT attisdropped
           AND attnotnull
    ) OR NOT EXISTS (
        SELECT 1
          FROM pg_catalog.pg_trigger
         WHERE tgrelid =
               'control.service_principal_database_role_binding'::regclass
           AND tgname = 'trg_service_principal_binding_delete_forbidden'
           AND NOT tgisinternal
    ) THEN
        RAISE EXCEPTION
            'OID binding, lease acquisition, binding deletion or message hard-freeze catalog gate is missing';
    END IF;
END
$sprint2c_catalog$;

BEGIN;
DO $$
DECLARE
    test_tenant_id CONSTANT UUID := '90000000-0000-4000-8000-000000000001';
    test_hotel_id CONSTANT UUID := '90000000-0000-4000-8000-000000000002';
    test_account_id CONSTANT UUID := '90000000-0000-4000-8000-000000000003';
    test_connector_id CONSTANT UUID := '90000000-0000-4000-8000-000000000004';
    test_schedule_id CONSTANT UUID := '90000000-0000-4000-8000-000000000005';
    test_simulation_run_id CONSTANT UUID := '90000000-0000-4000-8000-000000000006';
    test_job_id CONSTANT UUID := '90000000-0000-4000-8000-000000000007';
    test_worker_id CONSTANT UUID := '90000000-0000-4000-8000-000000000008';
    test_lease_id CONSTANT UUID := '90000000-0000-4000-8000-000000000009';
    test_collection_run_id CONSTANT UUID := '90000000-0000-4000-8000-000000000010';
    second_simulation_run_id CONSTANT UUID := '90000000-0000-4000-8000-000000000011';
    second_job_id CONSTANT UUID := '90000000-0000-4000-8000-000000000012';
    second_lease_id CONSTANT UUID := '90000000-0000-4000-8000-000000000013';
    second_collection_run_id CONSTANT UUID := '90000000-0000-4000-8000-000000000014';
    connector_version_id CONSTANT UUID := '90000000-0000-4000-8000-000000000015';
    inventory_collection_run_id CONSTANT UUID := '90000000-0000-4000-8000-000000000016';
    business_day_observation_id CONSTANT UUID := '90000000-0000-4000-8000-000000000017';
    business_day_run_id CONSTANT UUID := '90000000-0000-4000-8000-000000000018';
    source_product_id CONSTANT UUID := '90000000-0000-4000-8000-000000000019';
    inventory_observation_id CONSTANT UUID := '90000000-0000-4000-8000-000000000020';
    inventory_item_id CONSTANT UUID := '90000000-0000-4000-8000-000000000021';
    duplicate_simulation_collection_run_id CONSTANT UUID :=
        '90000000-0000-4000-8000-000000000024';
    ordinary_collection_run_id CONSTANT UUID :=
        '90000000-0000-4000-8000-000000000025';
    ordinary_duplicate_collection_run_id CONSTANT UUID :=
        '90000000-0000-4000-8000-000000000026';
    ordinary_schedule_id CONSTANT UUID :=
        '90000000-0000-4000-8000-000000000027';
    ordinary_job_id CONSTANT UUID :=
        '90000000-0000-4000-8000-000000000028';
    dynamic_schedule_id CONSTANT UUID :=
        '90000000-0000-4000-8000-000000000029';
    disabled_lease_id CONSTANT UUID :=
        '90000000-0000-4000-8000-000000000030';
    disabled_collection_run_id CONSTANT UUID :=
        '90000000-0000-4000-8000-000000000031';
    minute_schedule_id CONSTANT UUID :=
        '90000000-0000-4000-8000-000000000032';
    wrong_worker_id CONSTANT UUID :=
        '90000000-0000-4000-8000-000000000033';
    minute_collection_run_id CONSTANT UUID :=
        '90000000-0000-4000-8000-000000000034';
    claimed RECORD;
    mutation_rejected BOOLEAN;
    dispatched_count INTEGER;
BEGIN
    INSERT INTO control.tenant_directory(
        tenant_id, tenant_code, display_name, status
    ) VALUES (
        test_tenant_id, 'catalog-simulation', 'Catalog Simulation Tenant', 'ACTIVE'
    );
    INSERT INTO control.auth_account(
        account_id, login_name, display_name, status
    ) VALUES (
        test_account_id, 'catalog-simulation-admin', 'Catalog Simulation Admin', 'ACTIVE'
    );
    INSERT INTO control.connector_adapter_registry(
        adapter_code, source_type, display_name, implementation_version, enabled
    ) VALUES (
        'CATALOG_SIMULATOR', 'SIMULATOR', 'Catalog Simulator', 'test-only', TRUE
    );
    INSERT INTO control.service_principal(
        service_principal_id, principal_code, purpose, status
    ) VALUES
        (
            test_worker_id, 'catalog-simulation-worker',
            'CONNECTOR_WORKER', 'ACTIVE'
        ),
        (
            wrong_worker_id, 'catalog-unbound-worker',
            'CONNECTOR_WORKER', 'ACTIVE'
        );
    PERFORM set_config('app.tenant_id', test_tenant_id::TEXT, false);
    INSERT INTO ota.hotel(
        tenant_id, hotel_id, hotel_code, display_name, lifecycle_status,
        collection_enabled, message_enabled
    ) VALUES (
        test_tenant_id, test_hotel_id, 'catalog-sim-hotel', 'Catalog Simulation Hotel',
        'READY_FOR_TEST', TRUE, FALSE
    );
    INSERT INTO ota.hotel_source_connector(
        tenant_id, hotel_id, connector_id, source_type, adapter_code,
        connector_mode, lifecycle_status, display_name
    ) VALUES (
        test_tenant_id, test_hotel_id, test_connector_id, 'SIMULATOR',
        'CATALOG_SIMULATOR', 'SIMULATION', 'READY_FOR_TEST', 'Catalog Simulator'
    );
    INSERT INTO ota.connector_collection_schedule(
        tenant_id, hotel_id, connector_id, schedule_id, stream_code,
        trigger_type, interval_minutes, timeout_seconds, lookback_minutes,
        priority_no, next_due_at, enabled
    ) VALUES (
        test_tenant_id, test_hotel_id, test_connector_id, test_schedule_id,
        'SIMULATION_PIPELINE', 'MANUAL_SIMULATION', 15, 120, 30, 1,
        '2026-07-19 10:00:00+08'::TIMESTAMPTZ, TRUE
    );
    INSERT INTO ota.connector_collection_schedule(
        tenant_id, hotel_id, connector_id, schedule_id, stream_code,
        trigger_type, interval_minutes, timeout_seconds, lookback_minutes,
        priority_no, next_due_at, enabled
    ) VALUES (
        test_tenant_id, test_hotel_id, test_connector_id, ordinary_schedule_id,
        'PMS_OPERATING', 'NORMAL', 15, 120, 30, 1,
        '2026-07-19 09:00:00+08'::TIMESTAMPTZ, TRUE
    );
    INSERT INTO ota.connector_collection_schedule(
        tenant_id, hotel_id, connector_id, schedule_id, stream_code,
        trigger_type, interval_minutes, timeout_seconds, lookback_minutes,
        priority_no, next_due_at, enabled
    ) VALUES (
        test_tenant_id, test_hotel_id, test_connector_id, dynamic_schedule_id,
        'INVENTORY_ROOM_TYPE', 'HOURLY_CUTOFF', 60, 120, 60, 2,
        '2026-07-19 10:06:00+08'::TIMESTAMPTZ, TRUE
    );
    INSERT INTO ota.connector_collection_schedule(
        tenant_id, hotel_id, connector_id, schedule_id, stream_code,
        trigger_type, interval_minutes, timeout_seconds, lookback_minutes,
        priority_no, next_due_at, enabled
    ) VALUES (
        test_tenant_id, test_hotel_id, test_connector_id, minute_schedule_id,
        'BOOKING_EVENT', 'NORMAL', 5, 120, 30, 3,
        '2026-07-19 10:05:00+08'::TIMESTAMPTZ, TRUE
    );
    INSERT INTO ota.hotel_source_connector_version(
        tenant_id, hotel_id, connector_id, connector_version_id, version_no,
        adapter_version, parser_version, non_secret_config, capability_codes,
        config_hash, status, tested_at, activated_at, created_by_account_id
    ) VALUES (
        test_tenant_id, test_hotel_id, test_connector_id, connector_version_id, 1,
        'test-only', 'test-only', '{}'::JSONB, ARRAY['INVENTORY_BY_SELL_PRODUCT']::TEXT[],
        repeat('c', 64), 'ACTIVE',
        '2026-07-19 09:00:00+08'::TIMESTAMPTZ,
        '2026-07-19 09:00:00+08'::TIMESTAMPTZ,
        test_account_id
    );
    INSERT INTO ota.simulation_run(
        tenant_id, hotel_id, simulation_run_id, scenario_code, fixed_clock_at,
        requested_by_account_id, idempotency_key, request_hash
    ) VALUES (
        test_tenant_id, test_hotel_id, test_simulation_run_id, 'CATALOG_TEST',
        '2026-07-19 10:06:00+08'::TIMESTAMPTZ, test_account_id,
        'catalog-simulation-run', repeat('a', 64)
    );

    PERFORM *
      FROM control.enqueue_ota_job(
          test_job_id, test_tenant_id, test_hotel_id, test_connector_id,
          test_schedule_id, test_simulation_run_id,
          '2026-07-19 10:00:00+08'::TIMESTAMPTZ
      );
    PERFORM *
      FROM control.enqueue_ota_job(
          ordinary_job_id, test_tenant_id, test_hotel_id, test_connector_id,
          ordinary_schedule_id, NULL,
          '2026-07-19 09:00:00+08'::TIMESTAMPTZ
      );

    INSERT INTO ota.connector_collection_run(
        tenant_id, hotel_id, run_id, connector_id, connector_version_id,
        simulation_run_id, stream_code, trigger_type, scheduled_for,
        window_from_exclusive, window_to_inclusive, cutoff_at,
        reconciliation_epoch, status, completeness_code, observed_at,
        started_at, finished_at
    ) VALUES (
        test_tenant_id, test_hotel_id, minute_collection_run_id,
        test_connector_id, connector_version_id, NULL,
        'BOOKING_EVENT', 'NORMAL',
        '2026-07-19 10:05:00+08'::TIMESTAMPTZ,
        '2026-07-19 09:35:00+08'::TIMESTAMPTZ,
        '2026-07-19 10:05:00+08'::TIMESTAMPTZ,
        '2026-07-19 10:05:00+08'::TIMESTAMPTZ,
        NULL, 'SUCCESS', 'COMPLETE',
        '2026-07-19 10:06:01+08'::TIMESTAMPTZ,
        '2026-07-19 10:06:00+08'::TIMESTAMPTZ,
        '2026-07-19 10:06:01+08'::TIMESTAMPTZ
    );
    IF NOT EXISTS (
        SELECT 1
          FROM ota.connector_collection_run
         WHERE tenant_id = test_tenant_id
           AND hotel_id = test_hotel_id
           AND run_id = minute_collection_run_id
           AND scheduled_for =
               '2026-07-19 10:05:00+08'::TIMESTAMPTZ
           AND cutoff_at =
               '2026-07-19 10:05:00+08'::TIMESTAMPTZ
    ) THEN
        RAISE EXCEPTION
            'Five-minute normal collection run did not preserve its exact cutoff';
    END IF;

    IF NOT EXISTS (
        SELECT 1
          FROM ota.simulation_run
         WHERE tenant_id = test_tenant_id
           AND hotel_id = test_hotel_id
           AND simulation_run_id = test_simulation_run_id
           AND fixed_clock_at = '2026-07-19 10:06:00+08'::TIMESTAMPTZ
    ) THEN
        RAISE EXCEPTION 'Simulation execution clock did not preserve HH:06';
    END IF;

    mutation_rejected := FALSE;
    BEGIN
        PERFORM *
          FROM control.enqueue_ota_job(
              '90000000-0000-4000-8000-000000000022',
              test_tenant_id, test_hotel_id, test_connector_id,
              test_schedule_id, test_simulation_run_id,
              '2026-07-19 10:06:00+08'::TIMESTAMPTZ
          );
    EXCEPTION
        WHEN SQLSTATE '22023' THEN
            mutation_rejected := TRUE;
    END;
    IF NOT mutation_rejected THEN
        RAISE EXCEPTION 'Job enqueue accepted non-hour scheduled_for';
    END IF;

    INSERT INTO ota.simulation_run(
        tenant_id, hotel_id, simulation_run_id, scenario_code, fixed_clock_at,
        requested_by_account_id, idempotency_key, request_hash
    ) VALUES (
        test_tenant_id, test_hotel_id, second_simulation_run_id, 'CATALOG_TEST_2',
        '2026-07-19 10:06:30+08'::TIMESTAMPTZ, test_account_id,
        'catalog-simulation-run-2', repeat('b', 64)
    );

    PERFORM *
      FROM control.enqueue_ota_job(
          second_job_id, test_tenant_id, test_hotel_id, test_connector_id,
          test_schedule_id, second_simulation_run_id,
          '2026-07-19 10:00:00+08'::TIMESTAMPTZ
      );

    IF (
        SELECT count(*)
          FROM control.ota_job_registry
         WHERE tenant_id = test_tenant_id
           AND hotel_id = test_hotel_id
           AND schedule_id = test_schedule_id
           AND scheduled_for = '2026-07-19 10:00:00+08'::TIMESTAMPTZ
    ) <> 2 THEN
        RAISE EXCEPTION 'Distinct simulation runs in one slot were deduplicated together';
    END IF;

    mutation_rejected := FALSE;
    BEGIN
        UPDATE ota.simulation_run
           SET external_delivery_allowed = TRUE
         WHERE tenant_id = test_tenant_id
           AND hotel_id = test_hotel_id
           AND simulation_run_id = test_simulation_run_id;
    EXCEPTION
        WHEN check_violation THEN
            mutation_rejected := TRUE;
    END;
    IF NOT mutation_rejected THEN
        RAISE EXCEPTION 'Simulation run accepted real external delivery';
    END IF;

    INSERT INTO ota.connector_collection_run(
        tenant_id, hotel_id, run_id, connector_id, connector_version_id,
        simulation_run_id, stream_code, trigger_type, scheduled_for,
        window_from_exclusive, window_to_inclusive, cutoff_at,
        reconciliation_epoch, status, completeness_code, observed_at,
        started_at, finished_at
    ) VALUES (
        test_tenant_id, test_hotel_id, inventory_collection_run_id,
        test_connector_id, connector_version_id, test_simulation_run_id,
        'INVENTORY_BY_SELL_PRODUCT', 'MANUAL_SIMULATION',
        '2026-07-19 10:00:00+08'::TIMESTAMPTZ,
        '2026-07-19 09:00:00+08'::TIMESTAMPTZ,
        '2026-07-19 10:00:00+08'::TIMESTAMPTZ,
        '2026-07-19 10:00:00+08'::TIMESTAMPTZ,
        '90000000-0000-4000-8000-000000000023',
        'SUCCESS', 'COMPLETE',
        '2026-07-19 10:06:00+08'::TIMESTAMPTZ,
        '2026-07-19 10:06:00+08'::TIMESTAMPTZ,
        '2026-07-19 10:06:01+08'::TIMESTAMPTZ
    )
    ON CONFLICT (
        tenant_id, hotel_id, connector_id, stream_code, trigger_type,
        scheduled_for, simulation_run_id
    )
        WHERE simulation_run_id IS NOT NULL
        DO NOTHING;

    INSERT INTO ota.connector_collection_run(
        tenant_id, hotel_id, run_id, connector_id, connector_version_id,
        simulation_run_id, stream_code, trigger_type, scheduled_for,
        window_from_exclusive, window_to_inclusive, cutoff_at,
        reconciliation_epoch, status, completeness_code, observed_at,
        started_at, finished_at
    ) VALUES (
        test_tenant_id, test_hotel_id, second_collection_run_id,
        test_connector_id, connector_version_id, second_simulation_run_id,
        'INVENTORY_BY_SELL_PRODUCT', 'MANUAL_SIMULATION',
        '2026-07-19 10:00:00+08'::TIMESTAMPTZ,
        '2026-07-19 09:00:00+08'::TIMESTAMPTZ,
        '2026-07-19 10:00:00+08'::TIMESTAMPTZ,
        '2026-07-19 10:00:00+08'::TIMESTAMPTZ,
        '90000000-0000-4000-8000-000000000027',
        'SUCCESS', 'COMPLETE',
        '2026-07-19 10:06:30+08'::TIMESTAMPTZ,
        '2026-07-19 10:06:30+08'::TIMESTAMPTZ,
        '2026-07-19 10:06:31+08'::TIMESTAMPTZ
    )
    ON CONFLICT (
        tenant_id, hotel_id, connector_id, stream_code, trigger_type,
        scheduled_for, simulation_run_id
    )
        WHERE simulation_run_id IS NOT NULL
        DO NOTHING;

    INSERT INTO ota.connector_collection_run(
        tenant_id, hotel_id, run_id, connector_id, connector_version_id,
        simulation_run_id, stream_code, trigger_type, scheduled_for,
        window_from_exclusive, window_to_inclusive, cutoff_at,
        reconciliation_epoch, status, completeness_code, observed_at,
        started_at, finished_at
    ) VALUES (
        test_tenant_id, test_hotel_id, duplicate_simulation_collection_run_id,
        test_connector_id, connector_version_id, test_simulation_run_id,
        'INVENTORY_BY_SELL_PRODUCT', 'MANUAL_SIMULATION',
        '2026-07-19 10:00:00+08'::TIMESTAMPTZ,
        '2026-07-19 09:00:00+08'::TIMESTAMPTZ,
        '2026-07-19 10:00:00+08'::TIMESTAMPTZ,
        '2026-07-19 10:00:00+08'::TIMESTAMPTZ,
        '90000000-0000-4000-8000-000000000028',
        'SUCCESS', 'COMPLETE',
        '2026-07-19 10:07:00+08'::TIMESTAMPTZ,
        '2026-07-19 10:07:00+08'::TIMESTAMPTZ,
        '2026-07-19 10:07:01+08'::TIMESTAMPTZ
    )
    ON CONFLICT (
        tenant_id, hotel_id, connector_id, stream_code, trigger_type,
        scheduled_for, simulation_run_id
    )
        WHERE simulation_run_id IS NOT NULL
        DO NOTHING;

    IF (
        SELECT count(*)
          FROM ota.connector_collection_run
         WHERE tenant_id = test_tenant_id
           AND hotel_id = test_hotel_id
           AND connector_id = test_connector_id
           AND stream_code = 'INVENTORY_BY_SELL_PRODUCT'
           AND trigger_type = 'MANUAL_SIMULATION'
           AND scheduled_for = '2026-07-19 10:00:00+08'::TIMESTAMPTZ
    ) <> 2 OR NOT EXISTS (
        SELECT 1
          FROM ota.connector_collection_run
         WHERE tenant_id = test_tenant_id
           AND hotel_id = test_hotel_id
           AND run_id = inventory_collection_run_id
           AND simulation_run_id = test_simulation_run_id
    ) OR NOT EXISTS (
        SELECT 1
          FROM ota.connector_collection_run
         WHERE tenant_id = test_tenant_id
           AND hotel_id = test_hotel_id
           AND run_id = second_collection_run_id
           AND simulation_run_id = second_simulation_run_id
    ) THEN
        RAISE EXCEPTION
            'Distinct simulations did not persist independently or simulation replay was not idempotent';
    END IF;

    INSERT INTO ota.connector_collection_run(
        tenant_id, hotel_id, run_id, connector_id, connector_version_id,
        simulation_run_id, stream_code, trigger_type, scheduled_for,
        window_from_exclusive, window_to_inclusive, cutoff_at,
        reconciliation_epoch, status, completeness_code, observed_at,
        started_at, finished_at
    ) VALUES (
        test_tenant_id, test_hotel_id, ordinary_collection_run_id,
        test_connector_id, connector_version_id, NULL,
        'BOOKING_EVENT', 'NORMAL',
        '2026-07-19 11:00:00+08'::TIMESTAMPTZ,
        '2026-07-19 10:00:00+08'::TIMESTAMPTZ,
        '2026-07-19 11:00:00+08'::TIMESTAMPTZ,
        '2026-07-19 11:00:00+08'::TIMESTAMPTZ,
        NULL, 'SUCCESS', 'COMPLETE',
        '2026-07-19 11:00:05+08'::TIMESTAMPTZ,
        '2026-07-19 11:00:00+08'::TIMESTAMPTZ,
        '2026-07-19 11:00:05+08'::TIMESTAMPTZ
    )
    ON CONFLICT (
        tenant_id, hotel_id, connector_id, stream_code, trigger_type,
        scheduled_for
    )
        WHERE simulation_run_id IS NULL
        DO NOTHING;

    INSERT INTO ota.connector_collection_run(
        tenant_id, hotel_id, run_id, connector_id, connector_version_id,
        simulation_run_id, stream_code, trigger_type, scheduled_for,
        window_from_exclusive, window_to_inclusive, cutoff_at,
        reconciliation_epoch, status, completeness_code, observed_at,
        started_at, finished_at
    ) VALUES (
        test_tenant_id, test_hotel_id, ordinary_duplicate_collection_run_id,
        test_connector_id, connector_version_id, NULL,
        'BOOKING_EVENT', 'NORMAL',
        '2026-07-19 11:00:00+08'::TIMESTAMPTZ,
        '2026-07-19 10:00:00+08'::TIMESTAMPTZ,
        '2026-07-19 11:00:00+08'::TIMESTAMPTZ,
        '2026-07-19 11:00:00+08'::TIMESTAMPTZ,
        NULL, 'SUCCESS', 'COMPLETE',
        '2026-07-19 11:00:10+08'::TIMESTAMPTZ,
        '2026-07-19 11:00:00+08'::TIMESTAMPTZ,
        '2026-07-19 11:00:10+08'::TIMESTAMPTZ
    )
    ON CONFLICT (
        tenant_id, hotel_id, connector_id, stream_code, trigger_type,
        scheduled_for
    )
        WHERE simulation_run_id IS NULL
        DO NOTHING;

    IF (
        SELECT count(*)
          FROM ota.connector_collection_run
         WHERE tenant_id = test_tenant_id
           AND hotel_id = test_hotel_id
           AND connector_id = test_connector_id
           AND stream_code = 'BOOKING_EVENT'
           AND trigger_type = 'NORMAL'
           AND scheduled_for = '2026-07-19 11:00:00+08'::TIMESTAMPTZ
           AND simulation_run_id IS NULL
    ) <> 1 OR NOT EXISTS (
        SELECT 1
          FROM ota.connector_collection_run
         WHERE tenant_id = test_tenant_id
           AND hotel_id = test_hotel_id
           AND run_id = ordinary_collection_run_id
    ) THEN
        RAISE EXCEPTION 'Ordinary collection-run replay was not idempotent';
    END IF;

    INSERT INTO ota.pms_business_day_observation(
        tenant_id, hotel_id, observation_id, run_id, connector_id,
        connector_version_id, pms_business_date, source_effective_at,
        observed_at, evidence_ref, content_hash, parser_version
    ) VALUES (
        test_tenant_id, test_hotel_id, business_day_observation_id,
        inventory_collection_run_id, test_connector_id, connector_version_id,
        DATE '2026-07-19', '2026-07-19 04:00:00+08'::TIMESTAMPTZ,
        '2026-07-19 10:06:00+08'::TIMESTAMPTZ,
        'fixture://business-day', repeat('d', 64), 'test-only'
    );

    INSERT INTO ota.business_day_run(
        tenant_id, hotel_id, business_day_run_id, pms_business_date,
        opening_observation_id, opened_at
    ) VALUES (
        test_tenant_id, test_hotel_id, business_day_run_id, DATE '2026-07-19',
        business_day_observation_id, '2026-07-19 10:06:00+08'::TIMESTAMPTZ
    );

    INSERT INTO ota.source_sellable_product(
        tenant_id, hotel_id, connector_id, source_product_id, product_kind,
        source_product_key_hash, display_name, first_observed_at, last_observed_at
    ) VALUES (
        test_tenant_id, test_hotel_id, test_connector_id, source_product_id,
        'OTA_SELL_PRODUCT', repeat('e', 64), 'Unavailable test product',
        '2026-07-19 10:06:00+08'::TIMESTAMPTZ,
        '2026-07-19 10:06:00+08'::TIMESTAMPTZ
    );

    INSERT INTO ota.inventory_observation(
        tenant_id, hotel_id, inventory_observation_id, run_id, connector_id,
        connector_version_id, business_day_run_id, pms_business_date,
        reconciliation_epoch, observed_at, completeness_code,
        evidence_ref, content_hash, parser_version
    ) VALUES (
        test_tenant_id, test_hotel_id, inventory_observation_id,
        inventory_collection_run_id, test_connector_id, connector_version_id,
        business_day_run_id, DATE '2026-07-19',
        '90000000-0000-4000-8000-000000000023',
        '2026-07-19 10:06:00+08'::TIMESTAMPTZ, 'UNAVAILABLE',
        'fixture://inventory-unavailable', repeat('f', 64), 'test-only'
    );

    INSERT INTO ota.inventory_observation_item(
        tenant_id, hotel_id, inventory_observation_id, observation_item_id,
        connector_id, source_product_id, sellable_room_count,
        item_quality_code, reason_code, item_content_hash
    ) VALUES (
        test_tenant_id, test_hotel_id, inventory_observation_id,
        inventory_item_id, test_connector_id, source_product_id,
        NULL, 'UNAVAILABLE', 'SOURCE_FAILED', repeat('1', 64)
    );

    IF NOT EXISTS (
        SELECT 1
          FROM ota.inventory_observation_item
         WHERE tenant_id = test_tenant_id
           AND hotel_id = test_hotel_id
           AND observation_item_id = inventory_item_id
           AND sellable_room_count IS NULL
           AND item_quality_code = 'UNAVAILABLE'
    ) THEN
        RAISE EXCEPTION 'Unknown inventory was not preserved as NULL/UNAVAILABLE';
    END IF;
END;
$$;
ROLLBACK;

BEGIN;
DO $configuration_only_negative_controls$
DECLARE
    test_tenant_id CONSTANT UUID := '91000000-0000-4000-8000-000000000001';
    test_hotel_id CONSTANT UUID := '91000000-0000-4000-8000-000000000002';
    platform_admin_id CONSTANT UUID := '91000000-0000-4000-8000-000000000003';
    test_account_role_id CONSTANT UUID := '91000000-0000-4000-8000-000000000004';
    test_connector_id CONSTANT UUID := '91000000-0000-4000-8000-000000000005';
    test_connector_version_id CONSTANT UUID := '91000000-0000-4000-8000-000000000006';
    test_baseline_id CONSTANT UUID := '91000000-0000-4000-8000-000000000007';
    test_collection_run_id CONSTANT UUID := '91000000-0000-4000-8000-000000000008';
    non_admin_id CONSTANT UUID := '91000000-0000-4000-8000-000000000009';
    test_secret_binding_id CONSTANT UUID := '91000000-0000-4000-8000-000000000012';
    browser_session_binding_id CONSTANT UUID := '91000000-0000-4000-8000-000000000013';
    platform_admin_session_id CONSTANT UUID := '91000000-0000-4000-8000-000000000020';
    rehearsal_attempt_id CONSTANT UUID := '91000000-0000-4000-8000-000000000021';
    replay_attempt_id CONSTANT UUID := '91000000-0000-4000-8000-000000000022';
    expiring_attempt_id CONSTANT UUID := '91000000-0000-4000-8000-000000000023';
    replacement_attempt_id CONSTANT UUID := '91000000-0000-4000-8000-000000000024';
    rejected_reauth_attempt_id CONSTANT UUID := '91000000-0000-4000-8000-000000000032';
    active_reauth_attempt_id CONSTANT UUID := '91000000-0000-4000-8000-000000000033';
    ordinary_expiring_attempt_id CONSTANT UUID := '91000000-0000-4000-8000-000000000034';
    ordinary_replacement_attempt_id CONSTANT UUID := '91000000-0000-4000-8000-000000000035';
    deadline_attempt_id CONSTANT UUID := '91000000-0000-4000-8000-000000000036';
    rehearsal_row ota.browser_authorization_attempt%ROWTYPE;
    mutation_rejected BOOLEAN;
BEGIN
    INSERT INTO control.tenant_directory(
        tenant_id, tenant_code, display_name, status
    ) VALUES (
        test_tenant_id,
        'configuration-only-negative-controls',
        'Configuration-only Negative Controls',
        'ACTIVE'
    );

    INSERT INTO control.auth_account(
        account_id, login_name, display_name, status
    ) VALUES
        (
            platform_admin_id,
            'configuration-only-platform-admin',
            'Configuration-only Platform Admin',
            'ACTIVE'
        ),
        (
            non_admin_id,
            'configuration-only-non-admin',
            'Configuration-only Non Admin',
            'ACTIVE'
        );

    INSERT INTO control.account_role(
        account_role_id,
        account_id,
        role_id,
        grant_reason_code
    ) VALUES (
        test_account_role_id,
        platform_admin_id,
        '10000000-0000-4000-8000-000000000001',
        'CATALOG_VERIFICATION'
    );

    INSERT INTO control.auth_session(
        session_id,
        account_id,
        session_family_id,
        refresh_token_hash,
        authz_version_snapshot,
        issued_at,
        expires_at
    ) VALUES (
        platform_admin_session_id,
        platform_admin_id,
        '91000000-0000-4000-8000-000000000025',
        repeat('7', 64),
        1,
        clock_timestamp() - INTERVAL '1 minute',
        clock_timestamp() + INTERVAL '1 hour'
    );

    PERFORM set_config('app.tenant_id', test_tenant_id::TEXT, false);
    PERFORM set_config('app.account_id', platform_admin_id::TEXT, false);
    PERFORM set_config(
        'app.auth_session_id',
        platform_admin_session_id::TEXT,
        false
    );

    INSERT INTO ota.hotel(
        tenant_id,
        hotel_id,
        hotel_code,
        display_name,
        lifecycle_status,
        collection_enabled,
        message_enabled
    ) VALUES (
        test_tenant_id,
        test_hotel_id,
        'configuration-only-hotel',
        'Configuration-only Hotel',
        'DRAFT',
        FALSE,
        FALSE
    );

    mutation_rejected := FALSE;
    BEGIN
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
            test_tenant_id,
            test_hotel_id,
            test_connector_id,
            'PMS',
            'PMS_INTAKE',
            'CONFIGURATION_ONLY',
            'READY_FOR_TEST',
            'Forbidden ready intake'
        );
    EXCEPTION
        WHEN SQLSTATE '55000' OR SQLSTATE '23514' THEN
            mutation_rejected := TRUE;
    END;
    IF NOT mutation_rejected THEN
        RAISE EXCEPTION
            'CONFIGURATION_ONLY connector accepted READY_FOR_TEST lifecycle';
    END IF;

    mutation_rejected := FALSE;
    BEGIN
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
            test_tenant_id,
            test_hotel_id,
            test_connector_id,
            'PMS',
            'PMS_INTAKE',
            'SIMULATION',
            'DRAFT',
            'Forbidden intake simulation'
        );
    EXCEPTION
        WHEN SQLSTATE '55000' THEN
            mutation_rejected := TRUE;
    END;
    IF NOT mutation_rejected THEN
        RAISE EXCEPTION 'Intake template escaped CONFIGURATION_ONLY mode';
    END IF;

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
        test_tenant_id,
        test_hotel_id,
        test_connector_id,
        'PMS',
        'PMS_INTAKE',
        'CONFIGURATION_ONLY',
        'DRAFT',
        'PMS intake configuration'
    );

    mutation_rejected := FALSE;
    BEGIN
        UPDATE ota.hotel_source_connector AS connector
           SET connector_mode = 'SIMULATION',
               adapter_code = 'MOCK_PMS'
         WHERE connector.tenant_id = test_tenant_id
           AND connector.hotel_id = test_hotel_id
           AND connector.connector_id = test_connector_id;
    EXCEPTION
        WHEN SQLSTATE '55000' THEN
            mutation_rejected := TRUE;
    END;
    IF NOT mutation_rejected THEN
        RAISE EXCEPTION
            'CONFIGURATION_ONLY connector escaped through in-place mode update';
    END IF;

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
        test_tenant_id,
        test_hotel_id,
        test_connector_id,
        test_connector_version_id,
        1,
        '0.0.0-config-only',
        '0.0.0-config-only',
        '{"connectionMethod":"CONTROLLED_BROWSER"}'::JSONB,
        ARRAY[]::TEXT[],
        repeat('a', 64),
        'DRAFT',
        platform_admin_id
    );

    mutation_rejected := FALSE;
    BEGIN
        UPDATE ota.hotel_source_connector_version AS version
           SET status = 'TESTED',
               tested_at = CURRENT_TIMESTAMP
         WHERE version.tenant_id = test_tenant_id
           AND version.hotel_id = test_hotel_id
           AND version.connector_id = test_connector_id
           AND version.connector_version_id = test_connector_version_id;
    EXCEPTION
        WHEN SQLSTATE '55000' THEN
            mutation_rejected := TRUE;
    END;
    IF NOT mutation_rejected THEN
        RAISE EXCEPTION
            'CONFIGURATION_ONLY connector version escaped DRAFT status';
    END IF;

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
        test_tenant_id,
        test_hotel_id,
        test_connector_id,
        test_connector_version_id,
        browser_session_binding_id,
        'BROWSER_SESSION',
        'OSKEYRING',
        'oskeyring://browser-session-fixture',
        'v1',
        repeat('b', 64)
    );

    rehearsal_row := ota.start_browser_authorization_rehearsal(
        test_tenant_id,
        test_hotel_id,
        test_connector_id,
        test_connector_version_id,
        rehearsal_attempt_id,
        platform_admin_id,
        0,
        'PMS_INTAKE',
        '0.0.0-config-only',
        repeat('1', 64),
        clock_timestamp() + INTERVAL '10 minutes',
        '91000000-0000-4000-8000-000000000026',
        'browser-auth-start-1',
        repeat('2', 64),
        'CATALOG_VERIFICATION',
        NULL,
        NULL
    );

    IF rehearsal_row.authorization_attempt_id <> rehearsal_attempt_id
       OR rehearsal_row.state_code <> 'WAITING_FOR_OPERATOR'
       OR rehearsal_row.authorization_state <> 'AUTH_REQUIRED'
       OR rehearsal_row.mode <> 'OFFLINE_REHEARSAL'
       OR rehearsal_row.config_version <> 0
       OR rehearsal_row.row_version <> 0 THEN
        RAISE EXCEPTION
            'Offline browser authorization rehearsal did not start fail-closed';
    END IF;

    rehearsal_row := ota.start_browser_authorization_rehearsal(
        test_tenant_id,
        test_hotel_id,
        test_connector_id,
        test_connector_version_id,
        replay_attempt_id,
        platform_admin_id,
        0,
        'PMS_INTAKE',
        '0.0.0-config-only',
        repeat('1', 64),
        clock_timestamp() + INTERVAL '10 minutes',
        '91000000-0000-4000-8000-000000000027',
        'browser-auth-start-1',
        repeat('2', 64),
        'CATALOG_VERIFICATION',
        NULL,
        NULL
    );

    IF rehearsal_row.authorization_attempt_id <> rehearsal_attempt_id THEN
        RAISE EXCEPTION
            'Start idempotency replay did not return the original authorization attempt';
    END IF;

    rehearsal_row := ota.transition_browser_authorization_rehearsal(
        test_tenant_id,
        test_hotel_id,
        test_connector_id,
        test_connector_version_id,
        rehearsal_attempt_id,
        platform_admin_id,
        0,
        'PMS_INTAKE',
        '0.0.0-config-only',
        0,
        'OFFLINE_REHEARSAL_COMPLETE',
        '91000000-0000-4000-8000-000000000028',
        'browser-auth-complete-1',
        repeat('3', 64),
        'CATALOG_VERIFICATION'
    );

    IF rehearsal_row.state_code <> 'OFFLINE_REHEARSAL_COMPLETE'
       OR rehearsal_row.authorization_state <> 'AUTH_REQUIRED'
       OR rehearsal_row.row_version <> 1
       OR rehearsal_row.terminal_at IS NULL THEN
        RAISE EXCEPTION
            'Offline rehearsal completion was confused with real authorization';
    END IF;

    mutation_rejected := FALSE;
    BEGIN
        PERFORM ota.start_browser_authorization_rehearsal(
            test_tenant_id,
            test_hotel_id,
            test_connector_id,
            test_connector_version_id,
            rejected_reauth_attempt_id,
            platform_admin_id,
            0,
            'PMS_INTAKE',
            '0.0.0-config-only',
            repeat('4', 64),
            clock_timestamp() + INTERVAL '10 minutes',
            '91000000-0000-4000-8000-000000000037',
            'browser-auth-reauth-wrong-version-1',
            repeat('5', 64),
            'CATALOG_VERIFICATION',
            rehearsal_attempt_id,
            0
        );
    EXCEPTION
        WHEN SQLSTATE '40001' THEN
            mutation_rejected := TRUE;
    END;
    IF NOT mutation_rejected THEN
        RAISE EXCEPTION
            'Reauthentication accepted a stale predecessor row version';
    END IF;

    rehearsal_row := ota.start_browser_authorization_rehearsal(
        test_tenant_id,
        test_hotel_id,
        test_connector_id,
        test_connector_version_id,
        expiring_attempt_id,
        platform_admin_id,
        0,
        'PMS_INTAKE',
        '0.0.0-config-only',
        repeat('4', 64),
        clock_timestamp() + INTERVAL '50 milliseconds',
        '91000000-0000-4000-8000-000000000029',
        'browser-auth-expiring-1',
        repeat('5', 64),
        'CATALOG_VERIFICATION',
        rehearsal_attempt_id,
        1
    );

    mutation_rejected := FALSE;
    BEGIN
        PERFORM ota.start_browser_authorization_rehearsal(
            test_tenant_id,
            test_hotel_id,
            test_connector_id,
            test_connector_version_id,
            active_reauth_attempt_id,
            platform_admin_id,
            0,
            'PMS_INTAKE',
            '0.0.0-config-only',
            repeat('6', 64),
            clock_timestamp() + INTERVAL '10 minutes',
            '91000000-0000-4000-8000-000000000038',
            'browser-auth-active-reauth-1',
            repeat('7', 64),
            'CATALOG_VERIFICATION',
            expiring_attempt_id,
            0
        );
    EXCEPTION
        WHEN SQLSTATE '55000' THEN
            mutation_rejected := TRUE;
    END;
    IF NOT mutation_rejected THEN
        RAISE EXCEPTION
            'Reauthentication accepted an unexpired WAITING predecessor';
    END IF;

    PERFORM pg_sleep(0.1);

    rehearsal_row := ota.start_browser_authorization_rehearsal(
        test_tenant_id,
        test_hotel_id,
        test_connector_id,
        test_connector_version_id,
        replacement_attempt_id,
        platform_admin_id,
        0,
        'PMS_INTAKE',
        '0.0.0-config-only',
        repeat('6', 64),
        clock_timestamp() + INTERVAL '10 minutes',
        '91000000-0000-4000-8000-000000000030',
        'browser-auth-replacement-1',
        repeat('8', 64),
        'CATALOG_VERIFICATION',
        expiring_attempt_id,
        0
    );

    IF rehearsal_row.authorization_attempt_id <> replacement_attempt_id
       OR rehearsal_row.state_code <> 'WAITING_FOR_OPERATOR'
       OR NOT EXISTS (
           SELECT 1
             FROM ota.browser_authorization_attempt AS expired
            WHERE expired.tenant_id = test_tenant_id
              AND expired.hotel_id = test_hotel_id
              AND expired.connector_id = test_connector_id
              AND expired.authorization_attempt_id = expiring_attempt_id
              AND expired.state_code = 'EXPIRED'
              AND expired.authorization_state = 'AUTH_REQUIRED'
              AND expired.row_version = 1
              AND expired.terminal_at IS NOT NULL
       )
       OR NOT EXISTS (
           SELECT 1
             FROM ota.browser_authorization_command_receipt AS receipt
            WHERE receipt.tenant_id = test_tenant_id
              AND receipt.hotel_id = test_hotel_id
              AND receipt.authorization_attempt_id = expiring_attempt_id
              AND receipt.command_type = 'EXPIRE'
              AND receipt.reason_code = 'AUTO_EXPIRED_BEFORE_RESTART'
       )
       OR NOT EXISTS (
           SELECT 1
             FROM ota.browser_authorization_command_receipt AS receipt
            WHERE receipt.tenant_id = test_tenant_id
              AND receipt.hotel_id = test_hotel_id
              AND receipt.authorization_attempt_id = replacement_attempt_id
              AND receipt.command_type = 'START'
              AND receipt.predecessor_authorization_attempt_id =
                  expiring_attempt_id
              AND receipt.predecessor_expected_row_version = 0
       ) THEN
        RAISE EXCEPTION
            'Expired predecessor was not atomically expired and replaced with bound evidence';
    END IF;

    rehearsal_row := ota.transition_browser_authorization_rehearsal(
        test_tenant_id,
        test_hotel_id,
        test_connector_id,
        test_connector_version_id,
        replacement_attempt_id,
        platform_admin_id,
        0,
        'PMS_INTAKE',
        '0.0.0-config-only',
        0,
        'CANCELLED',
        '91000000-0000-4000-8000-000000000031',
        'browser-auth-cancel-1',
        repeat('9', 64),
        'CATALOG_VERIFICATION'
    );

    IF rehearsal_row.state_code <> 'CANCELLED'
       OR rehearsal_row.authorization_state <> 'AUTH_REQUIRED' THEN
        RAISE EXCEPTION
            'Offline browser authorization rehearsal cancellation failed';
    END IF;

    rehearsal_row := ota.start_browser_authorization_rehearsal(
        test_tenant_id,
        test_hotel_id,
        test_connector_id,
        test_connector_version_id,
        ordinary_expiring_attempt_id,
        platform_admin_id,
        0,
        'PMS_INTAKE',
        '0.0.0-config-only',
        repeat('a', 64),
        clock_timestamp() + INTERVAL '50 milliseconds',
        '91000000-0000-4000-8000-000000000039',
        'browser-auth-ordinary-expiring-1',
        repeat('b', 64),
        'CATALOG_VERIFICATION',
        NULL,
        NULL
    );
    PERFORM pg_sleep(0.1);

    rehearsal_row := ota.start_browser_authorization_rehearsal(
        test_tenant_id,
        test_hotel_id,
        test_connector_id,
        test_connector_version_id,
        ordinary_replacement_attempt_id,
        platform_admin_id,
        0,
        'PMS_INTAKE',
        '0.0.0-config-only',
        repeat('c', 64),
        clock_timestamp() + INTERVAL '10 minutes',
        '91000000-0000-4000-8000-000000000040',
        'browser-auth-ordinary-replacement-1',
        repeat('d', 64),
        'CATALOG_VERIFICATION',
        NULL,
        NULL
    );

    IF rehearsal_row.authorization_attempt_id <>
       ordinary_replacement_attempt_id
       OR NOT EXISTS (
           SELECT 1
             FROM ota.browser_authorization_attempt AS expired
            WHERE expired.tenant_id = test_tenant_id
              AND expired.hotel_id = test_hotel_id
              AND expired.connector_id = test_connector_id
              AND expired.authorization_attempt_id =
                  ordinary_expiring_attempt_id
              AND expired.state_code = 'EXPIRED'
              AND expired.row_version = 1
       ) THEN
        RAISE EXCEPTION
            'Ordinary START did not atomically release an expired connector slot';
    END IF;

    PERFORM ota.transition_browser_authorization_rehearsal(
        test_tenant_id,
        test_hotel_id,
        test_connector_id,
        test_connector_version_id,
        ordinary_replacement_attempt_id,
        platform_admin_id,
        0,
        'PMS_INTAKE',
        '0.0.0-config-only',
        0,
        'CANCELLED',
        '91000000-0000-4000-8000-000000000041',
        'browser-auth-ordinary-cancel-1',
        repeat('e', 64),
        'CATALOG_VERIFICATION'
    );

    rehearsal_row := ota.start_browser_authorization_rehearsal(
        test_tenant_id,
        test_hotel_id,
        test_connector_id,
        test_connector_version_id,
        deadline_attempt_id,
        platform_admin_id,
        0,
        'PMS_INTAKE',
        '0.0.0-config-only',
        repeat('1', 64),
        clock_timestamp() + INTERVAL '50 milliseconds',
        '91000000-0000-4000-8000-000000000042',
        'browser-auth-deadline-1',
        repeat('2', 64),
        'CATALOG_VERIFICATION',
        NULL,
        NULL
    );
    PERFORM pg_sleep(0.1);

    mutation_rejected := FALSE;
    BEGIN
        PERFORM ota.transition_browser_authorization_rehearsal(
            test_tenant_id, test_hotel_id, test_connector_id,
            test_connector_version_id, deadline_attempt_id,
            platform_admin_id, 0, 'PMS_INTAKE', '0.0.0-config-only',
            0, 'OFFLINE_REHEARSAL_COMPLETE',
            '91000000-0000-4000-8000-000000000043',
            'browser-auth-expired-complete-1', repeat('3', 64),
            'CATALOG_VERIFICATION'
        );
    EXCEPTION
        WHEN SQLSTATE '55000' THEN
            mutation_rejected := TRUE;
    END;
    IF NOT mutation_rejected THEN
        RAISE EXCEPTION
            'Expired rehearsal accepted OFFLINE_REHEARSAL_COMPLETE';
    END IF;

    mutation_rejected := FALSE;
    BEGIN
        PERFORM ota.transition_browser_authorization_rehearsal(
            test_tenant_id, test_hotel_id, test_connector_id,
            test_connector_version_id, deadline_attempt_id,
            platform_admin_id, 0, 'PMS_INTAKE', '0.0.0-config-only',
            0, 'CANCELLED',
            '91000000-0000-4000-8000-000000000044',
            'browser-auth-expired-cancel-1', repeat('4', 64),
            'CATALOG_VERIFICATION'
        );
    EXCEPTION
        WHEN SQLSTATE '55000' THEN
            mutation_rejected := TRUE;
    END;
    IF NOT mutation_rejected THEN
        RAISE EXCEPTION 'Expired rehearsal accepted CANCELLED';
    END IF;

    mutation_rejected := FALSE;
    BEGIN
        PERFORM ota.transition_browser_authorization_rehearsal(
            test_tenant_id, test_hotel_id, test_connector_id,
            test_connector_version_id, deadline_attempt_id,
            platform_admin_id, 0, 'PMS_INTAKE', '0.0.0-config-only',
            0, 'FAILED',
            '91000000-0000-4000-8000-000000000045',
            'browser-auth-expired-fail-1', repeat('5', 64),
            'CATALOG_VERIFICATION'
        );
    EXCEPTION
        WHEN SQLSTATE '55000' THEN
            mutation_rejected := TRUE;
    END;
    IF NOT mutation_rejected THEN
        RAISE EXCEPTION 'Expired rehearsal accepted a non-EXPIRED terminal state';
    END IF;

    rehearsal_row := ota.transition_browser_authorization_rehearsal(
        test_tenant_id, test_hotel_id, test_connector_id,
        test_connector_version_id, deadline_attempt_id,
        platform_admin_id, 0, 'PMS_INTAKE', '0.0.0-config-only',
        0, 'EXPIRED',
        '91000000-0000-4000-8000-000000000046',
        'browser-auth-expired-only-1', repeat('6', 64),
        'CATALOG_VERIFICATION'
    );

    IF rehearsal_row.state_code <> 'EXPIRED'
       OR rehearsal_row.row_version <> 1 THEN
        RAISE EXCEPTION
            'Expired rehearsal did not accept its only legal transition';
    END IF;

    mutation_rejected := FALSE;
    BEGIN
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
            test_tenant_id,
            test_hotel_id,
            test_connector_id,
            test_connector_version_id,
            test_secret_binding_id,
            'PMS_READ_ONLY_CREDENTIAL',
            'VAULT',
            'vault://user:plaintext@store/path',
            'v1',
            repeat('f', 64)
        );
    EXCEPTION
        WHEN SQLSTATE '23514' THEN
            mutation_rejected := TRUE;
    END;
    IF NOT mutation_rejected THEN
        RAISE EXCEPTION
            'Secret reference accepted embedded URI user-info credentials';
    END IF;

    mutation_rejected := FALSE;
    BEGIN
        INSERT INTO ota.connector_collection_schedule(
            tenant_id,
            hotel_id,
            connector_id,
            schedule_id,
            stream_code,
            trigger_type,
            interval_minutes,
            timeout_seconds,
            lookback_minutes,
            priority_no,
            next_due_at,
            enabled
        ) VALUES (
            test_tenant_id,
            test_hotel_id,
            test_connector_id,
            '91000000-0000-4000-8000-000000000010',
            'PMS_OPERATING',
            'NORMAL',
            60,
            120,
            60,
            100,
            '2026-07-19 18:00:00+08'::TIMESTAMPTZ,
            FALSE
        );
    EXCEPTION
        WHEN SQLSTATE '55000' THEN
            mutation_rejected := TRUE;
    END;
    IF NOT mutation_rejected THEN
        RAISE EXCEPTION
            'CONFIGURATION_ONLY connector accepted even a disabled schedule';
    END IF;

    mutation_rejected := FALSE;
    BEGIN
        INSERT INTO ota.connector_collection_run(
            tenant_id,
            hotel_id,
            run_id,
            connector_id,
            connector_version_id,
            stream_code,
            trigger_type,
            scheduled_for,
            window_from_exclusive,
            window_to_inclusive,
            cutoff_at,
            status,
            completeness_code,
            started_at
        ) VALUES (
            test_tenant_id,
            test_hotel_id,
            test_collection_run_id,
            test_connector_id,
            test_connector_version_id,
            'PMS_OPERATING',
            'NORMAL',
            '2026-07-19 18:00:00+08'::TIMESTAMPTZ,
            '2026-07-19 17:00:00+08'::TIMESTAMPTZ,
            '2026-07-19 18:00:00+08'::TIMESTAMPTZ,
            '2026-07-19 18:00:00+08'::TIMESTAMPTZ,
            'STARTED',
            'UNAVAILABLE',
            '2026-07-19 18:00:00+08'::TIMESTAMPTZ
        );
    EXCEPTION
        WHEN SQLSTATE '55000' THEN
            mutation_rejected := TRUE;
    END;
    IF NOT mutation_rejected THEN
        RAISE EXCEPTION
            'CONFIGURATION_ONLY connector entered collection runtime';
    END IF;

    mutation_rejected := FALSE;
    BEGIN
        INSERT INTO ota.connector_stream_checkpoint(
            tenant_id,
            hotel_id,
            connector_id,
            stream_code
        ) VALUES (
            test_tenant_id,
            test_hotel_id,
            test_connector_id,
            'PMS_OPERATING'
        );
    EXCEPTION
        WHEN SQLSTATE '55000' THEN
            mutation_rejected := TRUE;
    END;
    IF NOT mutation_rejected THEN
        RAISE EXCEPTION
            'CONFIGURATION_ONLY connector entered checkpoint runtime';
    END IF;

    mutation_rejected := FALSE;
    BEGIN
        UPDATE control.connector_adapter_registry
           SET enabled = TRUE
         WHERE adapter_code = 'PMS_INTAKE';
    EXCEPTION
        WHEN SQLSTATE '23514' THEN
            mutation_rejected := TRUE;
    END;
    IF NOT mutation_rejected THEN
        RAISE EXCEPTION 'PMS_INTAKE adapter could be enabled';
    END IF;

    mutation_rejected := FALSE;
    BEGIN
        INSERT INTO ota.connector_contract_approved_baseline(
            tenant_id,
            hotel_id,
            connector_id,
            connector_version_id,
            baseline_id,
            candidate_id,
            stream_code,
            capability_fingerprint,
            schema_fingerprint,
            approved_config_hash,
            approval_reason_code,
            approved_by_account_id
        ) VALUES (
            test_tenant_id,
            test_hotel_id,
            test_connector_id,
            test_connector_version_id,
            test_baseline_id,
            '91000000-0000-4000-8000-000000000012',
            'PMS_OPERATING',
            repeat('d', 64),
            repeat('e', 64),
            repeat('f', 64),
            'CATALOG_VERIFICATION',
            platform_admin_id
        );
    EXCEPTION
        WHEN SQLSTATE '42501' OR SQLSTATE '23503' OR SQLSTATE '55000' THEN
            mutation_rejected := TRUE;
    END;
    IF NOT mutation_rejected THEN
        RAISE EXCEPTION
            'CONFIGURATION_ONLY intake accepted an untrusted contract baseline';
    END IF;

    IF EXISTS (
        SELECT 1
          FROM ota.connector_contract_approved_baseline AS baseline
         WHERE baseline.tenant_id = test_tenant_id
           AND baseline.hotel_id = test_hotel_id
           AND baseline.baseline_id = test_baseline_id
    ) THEN
        RAISE EXCEPTION 'Untrusted CONFIGURATION_ONLY baseline was persisted';
    END IF;
END;
$configuration_only_negative_controls$;
ROLLBACK;

SELECT 'OTA Sprint 2D database catalog, offline authorization rehearsal and negative-control verification passed' AS result;
