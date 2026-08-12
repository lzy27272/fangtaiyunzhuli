-- Catalog verification for Sprint 2D post-migration-grants.sql.
-- Required psql variables: api_role, worker_role, audit_role,
-- worker_service_principal_id and worker_slot.

\set ON_ERROR_STOP on

\if :{?api_role}
\else
  \echo 'ERROR: psql variable api_role is required'
  \quit 3
\endif
\if :{?worker_role}
\else
  \echo 'ERROR: psql variable worker_role is required'
  \quit 3
\endif
\if :{?audit_role}
\else
  \echo 'ERROR: psql variable audit_role is required'
  \quit 3
\endif
\if :{?worker_service_principal_id}
\else
  \echo 'ERROR: psql variable worker_service_principal_id is required'
  \quit 3
\endif
\if :{?worker_slot}
\else
  \echo 'ERROR: psql variable worker_slot is required'
  \quit 3
\endif

SELECT set_config('ota.verify.api_role', :'api_role', false);
SELECT set_config('ota.verify.worker_role', :'worker_role', false);
SELECT set_config('ota.verify.audit_role', :'audit_role', false);
SELECT set_config(
    'ota.verify.worker_service_principal_id',
    :'worker_service_principal_id',
    false
);
SELECT set_config('ota.verify.worker_slot', :'worker_slot', false);

DO $verify$
DECLARE
    api_name TEXT := current_setting('ota.verify.api_role');
    worker_name TEXT := current_setting('ota.verify.worker_role');
    audit_name TEXT := current_setting('ota.verify.audit_role');
    worker_principal_id UUID :=
        current_setting('ota.verify.worker_service_principal_id')::UUID;
    worker_slot TEXT := current_setting('ota.verify.worker_slot');
    role_name TEXT;
    role_oid OID;
    role_row RECORD;
    object_name TEXT;
    privilege_name TEXT;
    expected BOOLEAN;
    actual BOOLEAN;
    unexpected_table TEXT;
    function_signature TEXT;
    deployment_tables CONSTANT TEXT[] := ARRAY[
        'flyway.flyway_schema_history',
        'control.tenant_directory',
        'control.auth_account',
        'control.auth_identity',
        'control.auth_credential',
        'control.auth_session',
        'control.role_definition',
        'control.permission_definition',
        'control.role_permission',
        'control.account_role',
        'control.service_principal',
        'control.service_principal_database_role_binding',
        'control.service_principal_rotation_event',
        'control.role_deprecation_event',
        'control.audit_event',
        'control.connector_adapter_registry',
        'control.connector_contract_candidate_manifest',
        'control.tenant_command_idempotency',
        'control.ota_job_registry',
        'ota.hotel',
        'ota.account_hotel_scope',
        'ota.hotel_duty_roster_version',
        'ota.hotel_duty_roster_assignment',
        'ota.hotel_escalation_policy_version',
        'ota.hotel_escalation_recipient',
        'ota.ota_incident',
        'ota.ota_incident_occurrence',
        'ota.ota_task',
        'ota.ota_task_event',
        'ota.ota_outbox_event',
        'ota.ota_outbox_publish_state',
        'ota.hotel_business_day_config',
        'ota.hotel_source_connector',
        'ota.hotel_source_connector_version',
        'ota.connector_contract_approved_baseline',
        'ota.connector_contract_baseline_revocation',
        'ota.connector_contract_command_receipt',
        'ota.connector_secret_binding',
        'ota.connector_authorization_state',
        'ota.browser_authorization_attempt',
        'ota.browser_authorization_command_receipt',
        'ota.connector_access_authorization_draft',
        'ota.credential_migration_rehearsal',
        'ota.hotel_message_endpoint',
        'ota.connector_collection_schedule',
        'ota.hotel_revenue_target_version',
        'ota.hotel_pace_curve_version',
        'ota.hotel_pace_curve_point',
        'ota.ota_command_idempotency',
        'ota.simulation_run',
        'ota.connector_collection_run',
        'ota.connector_collection_attempt',
        'ota.connector_stream_checkpoint',
        'ota.source_raw_record',
        'ota.source_import_batch',
        'ota.pms_business_day_observation',
        'ota.pms_business_day_transition',
        'ota.business_day_run',
        'ota.pms_operating_observation',
        'ota.pms_room_charge_event',
        'ota.source_standard_record',
        'ota.ota_standard_room_type',
        'ota.hotel_inventory_pool',
        'ota.source_sellable_product',
        'ota.source_product_mapping_version',
        'ota.inventory_policy_version',
        'ota.inventory_observation',
        'ota.inventory_observation_item',
        'ota.source_booking',
        'ota.source_booking_revision',
        'ota.booking_room_night_delta',
        'ota.daily_operation_snapshot',
        'ota.daily_operation_snapshot_metric',
        'ota.ota_hourly_brief',
        'ota.ota_brief_adjustment',
        'ota.notification_target',
        'ota.notification_delivery',
        'ota.notification_delivery_attempt',
        'ota.data_retention_policy_version',
        'ota.data_quality_event',
        'ota.safe_deep_link_policy_version',
        'ota.ota_platform_alert',
        'ota.ota_platform_alert_event',
        'ota.alert_notification_intent',
        'ota.hotel_ai_policy_version',
        'ota.ai_advice_evaluation',
        'ota.price_change_preview',
        'ota.price_change_request',
        'ota.price_change_event',
        'ota.all_store_uat_run',
        'ota.all_store_uat_daily_evidence',
        'ota.hotel_release_decision'
    ];
    api_control_select CONSTANT TEXT[] := ARRAY[
        'flyway.flyway_schema_history',
        'control.tenant_directory',
        'control.auth_account',
        'control.auth_credential',
        'control.auth_session',
        'control.role_definition',
        'control.permission_definition',
        'control.role_permission',
        'control.account_role',
        'control.role_deprecation_event',
        'control.connector_adapter_registry'
    ];
    api_denied_select CONSTANT TEXT[] := ARRAY[
        'ota.connector_contract_approved_baseline',
        'ota.connector_contract_baseline_revocation',
        'ota.connector_contract_command_receipt'
    ];
    api_insert CONSTANT TEXT[] := ARRAY[
        'control.auth_account',
        'control.auth_credential',
        'control.auth_session',
        'control.account_role',
        'control.audit_event',
        'ota.hotel',
        'ota.account_hotel_scope',
        'ota.hotel_duty_roster_version',
        'ota.hotel_duty_roster_assignment',
        'ota.hotel_escalation_policy_version',
        'ota.hotel_escalation_recipient',
        'ota.hotel_business_day_config',
        'ota.hotel_source_connector',
        'ota.hotel_source_connector_version',
        'ota.connector_secret_binding',
        'ota.connector_authorization_state',
        'ota.connector_access_authorization_draft',
        'ota.credential_migration_rehearsal',
        'ota.hotel_message_endpoint',
        'ota.connector_collection_schedule',
        'ota.hotel_revenue_target_version',
        'ota.hotel_pace_curve_version',
        'ota.hotel_pace_curve_point',
        'ota.ota_command_idempotency',
        'ota.simulation_run',
        'ota.source_import_batch',
        'ota.ota_standard_room_type',
        'ota.hotel_inventory_pool',
        'ota.source_sellable_product',
        'ota.source_product_mapping_version',
        'ota.inventory_policy_version',
        'ota.notification_target',
        'ota.ota_incident',
        'ota.ota_incident_occurrence',
        'ota.ota_task',
        'ota.ota_task_event',
        'ota.ota_outbox_event',
        'ota.ota_outbox_publish_state',
        'ota.data_retention_policy_version',
        'ota.safe_deep_link_policy_version',
        'ota.ota_platform_alert_event',
        'ota.hotel_ai_policy_version',
        'ota.price_change_preview',
        'ota.price_change_request',
        'ota.price_change_event',
        'ota.all_store_uat_run',
        'ota.hotel_release_decision'
    ];
    api_update CONSTANT TEXT[] := ARRAY[
        'control.auth_credential',
        'control.auth_session',
        'ota.hotel',
        'ota.account_hotel_scope',
        'ota.hotel_duty_roster_version',
        'ota.hotel_duty_roster_assignment',
        'ota.hotel_escalation_policy_version',
        'ota.hotel_escalation_recipient',
        'ota.hotel_business_day_config',
        'ota.hotel_source_connector',
        'ota.hotel_source_connector_version',
        'ota.connector_secret_binding',
        'ota.connector_authorization_state',
        'ota.hotel_message_endpoint',
        'ota.connector_collection_schedule',
        'ota.hotel_revenue_target_version',
        'ota.hotel_pace_curve_version',
        'ota.hotel_pace_curve_point',
        'ota.simulation_run',
        'ota.source_import_batch',
        'ota.ota_standard_room_type',
        'ota.hotel_inventory_pool',
        'ota.source_sellable_product',
        'ota.source_product_mapping_version',
        'ota.inventory_policy_version',
        'ota.notification_target',
        'ota.ota_incident',
        'ota.ota_task',
        'ota.ota_outbox_publish_state',
        'ota.price_change_request',
        'ota.all_store_uat_run'
    ];
    worker_select CONSTANT TEXT[] := ARRAY[
        'ota.hotel',
        'ota.hotel_duty_roster_version',
        'ota.hotel_duty_roster_assignment',
        'ota.hotel_escalation_policy_version',
        'ota.hotel_escalation_recipient',
        'ota.hotel_business_day_config',
        'ota.hotel_source_connector',
        'ota.hotel_source_connector_version',
        'ota.connector_authorization_state',
        'ota.connector_collection_schedule',
        'ota.hotel_revenue_target_version',
        'ota.hotel_pace_curve_version',
        'ota.hotel_pace_curve_point',
        'ota.simulation_run',
        'ota.connector_collection_run',
        'ota.connector_collection_attempt',
        'ota.connector_stream_checkpoint',
        'ota.source_raw_record',
        'ota.source_import_batch',
        'ota.pms_business_day_observation',
        'ota.pms_business_day_transition',
        'ota.business_day_run',
        'ota.pms_operating_observation',
        'ota.pms_room_charge_event',
        'ota.source_standard_record',
        'ota.ota_standard_room_type',
        'ota.hotel_inventory_pool',
        'ota.source_sellable_product',
        'ota.source_product_mapping_version',
        'ota.inventory_policy_version',
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
        'ota.hotel_message_endpoint',
        'ota.notification_target',
        'ota.notification_delivery',
        'ota.notification_delivery_attempt',
        'ota.data_retention_policy_version',
        'ota.data_quality_event',
        'ota.safe_deep_link_policy_version',
        'ota.ota_platform_alert',
        'ota.ota_platform_alert_event',
        'ota.alert_notification_intent',
        'ota.hotel_ai_policy_version',
        'ota.ai_advice_evaluation',
        'ota.all_store_uat_daily_evidence'
    ];
    worker_insert CONSTANT TEXT[] := ARRAY[
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
        'ota.notification_delivery_attempt',
        'ota.data_quality_event',
        'ota.ota_platform_alert',
        'ota.ota_platform_alert_event',
        'ota.alert_notification_intent',
        'ota.ai_advice_evaluation',
        'ota.all_store_uat_daily_evidence'
    ];
    worker_update CONSTANT TEXT[] := ARRAY[
        'ota.simulation_run',
        'ota.connector_authorization_state',
        'ota.connector_collection_run',
        'ota.connector_stream_checkpoint',
        'ota.business_day_run',
        'ota.source_sellable_product',
        'ota.source_booking',
        'ota.ota_incident',
        'ota.ota_task',
        'ota.ota_outbox_publish_state',
        'ota.notification_delivery'
    ];
    known_functions CONSTANT TEXT[] := ARRAY[
        'control.current_tenant_id()',
        'control.current_bound_service_principal_id()',
        'control.assert_session_service_principal(uuid,text[])',
        'control.reject_append_only_mutation()',
        'control.jsonb_contains_forbidden_secret_key(jsonb)',
        'control.create_tenant_directory_entry(uuid,text,text,uuid,text,text,text,uuid)',
        'control.enqueue_ota_job(uuid,uuid,uuid,uuid,uuid,uuid,timestamp with time zone)',
        'control.dispatch_due_ota_jobs(uuid,timestamp with time zone,integer)',
        'control.claim_ota_job(uuid,uuid,uuid,timestamp with time zone,timestamp with time zone,text)',
        'control.renew_ota_job_lease(uuid,uuid,uuid,timestamp with time zone,timestamp with time zone)',
        'control.complete_ota_job(uuid,uuid,uuid,timestamp with time zone,text,text)',
        'control.enforce_configuration_only_connector()',
        'control.enforce_configuration_only_version()',
        'control.reject_configuration_only_runtime()',
        'control.enforce_connector_contract_baseline_approval()',
        'control.current_authenticated_platform_admin_id()',
        'control.enforce_connector_contract_baseline_revocation()',
        'control.enforce_connector_contract_candidate_manifest()',
        'control.enforce_service_principal_binding_rotation()',
        'control.enforce_service_principal_disable_after_retirement()',
        'control.enforce_live_worker_write_session()',
        'control.enforce_browser_authorization_rehearsal_insert()',
        'control.reject_deprecated_account_role()',
        'control.reject_deprecated_hotel_scope()',
        'control.enforce_credential_migration_rehearsal()',
        'control.assert_session_active_service_principal(uuid,text[])',
        'control.approve_connector_contract_candidate(uuid,uuid,uuid,uuid,uuid,uuid,text,bigint,uuid,text,text,text)',
        'control.revoke_connector_contract_baseline(uuid,uuid,uuid,uuid,bigint,uuid,text,text,text)',
        'control.read_effective_connector_contract_baseline(uuid,uuid,uuid,uuid,text)',
        'control.stage_service_principal_binding(uuid,name,text,uuid,text)',
        'control.promote_service_principal_binding(uuid,uuid,uuid,text)',
        'control.retire_service_principal_binding(uuid,uuid,uuid,text)',
        'control.cancel_staged_service_principal_binding(uuid,uuid,text)',
        'control.rollback_service_principal_promotion(uuid,uuid,uuid,text)',
        'ota.start_browser_authorization_rehearsal(uuid,uuid,uuid,uuid,uuid,uuid,bigint,text,text,text,timestamp with time zone,uuid,text,text,text,uuid,bigint)',
        'ota.transition_browser_authorization_rehearsal(uuid,uuid,uuid,uuid,uuid,uuid,bigint,text,text,bigint,text,uuid,text,text,text)'
    ];
    api_functions CONSTANT TEXT[] := ARRAY[
        'control.current_tenant_id()',
        'control.jsonb_contains_forbidden_secret_key(jsonb)',
        'control.create_tenant_directory_entry(uuid,text,text,uuid,text,text,text,uuid)',
        'control.enqueue_ota_job(uuid,uuid,uuid,uuid,uuid,uuid,timestamp with time zone)',
        'ota.start_browser_authorization_rehearsal(uuid,uuid,uuid,uuid,uuid,uuid,bigint,text,text,text,timestamp with time zone,uuid,text,text,text,uuid,bigint)',
        'ota.transition_browser_authorization_rehearsal(uuid,uuid,uuid,uuid,uuid,uuid,bigint,text,text,bigint,text,uuid,text,text,text)'
    ];
    worker_functions CONSTANT TEXT[] := ARRAY[
        'control.current_tenant_id()',
        'control.current_bound_service_principal_id()',
        'control.jsonb_contains_forbidden_secret_key(jsonb)',
        'control.dispatch_due_ota_jobs(uuid,timestamp with time zone,integer)',
        'control.claim_ota_job(uuid,uuid,uuid,timestamp with time zone,timestamp with time zone,text)',
        'control.renew_ota_job_lease(uuid,uuid,uuid,timestamp with time zone,timestamp with time zone)',
        'control.complete_ota_job(uuid,uuid,uuid,timestamp with time zone,text,text)',
        'control.read_effective_connector_contract_baseline(uuid,uuid,uuid,uuid,text)'
    ];
BEGIN
    IF api_name = worker_name OR api_name = audit_name OR worker_name = audit_name THEN
        RAISE EXCEPTION 'API, Worker and Audit roles are not distinct';
    END IF;

    SELECT oid, rolcanlogin, rolsuper, rolinherit, rolcreaterole,
           rolcreatedb, rolreplication, rolbypassrls
      INTO role_row
      FROM pg_roles
     WHERE rolname = current_user;

    IF NOT FOUND
       OR NOT role_row.rolcanlogin
       OR role_row.rolsuper
       OR role_row.rolinherit
       OR role_row.rolcreaterole
       OR role_row.rolcreatedb
       OR role_row.rolreplication
       OR role_row.rolbypassrls THEN
        RAISE EXCEPTION 'Migration executor must be LOGIN, NOSUPERUSER, NOINHERIT and NOBYPASSRLS';
    END IF;

    IF NOT has_database_privilege(current_user, current_database(), 'CONNECT')
       OR NOT has_database_privilege(current_user, current_database(), 'CREATE')
       OR NOT has_database_privilege(current_user, current_database(), 'TEMPORARY') THEN
        RAISE EXCEPTION 'Migration executor lacks expected CONNECT+CREATE+TEMPORARY database privileges';
    END IF;

    IF EXISTS (
        SELECT 1
          FROM pg_namespace n
          CROSS JOIN LATERAL aclexplode(COALESCE(n.nspacl, acldefault('n', n.nspowner))) acl
         WHERE n.nspname = 'public'
           AND acl.grantee = 0
           AND acl.privilege_type = 'CREATE'
    ) THEN
        RAISE EXCEPTION 'PUBLIC must not retain CREATE on schema public';
    END IF;

    FOREACH role_name IN ARRAY ARRAY[api_name, worker_name, audit_name]
    LOOP
        SELECT oid, rolcanlogin, rolsuper, rolinherit, rolcreaterole,
               rolcreatedb, rolreplication, rolbypassrls
          INTO role_row
          FROM pg_roles
         WHERE rolname = role_name;

        IF NOT FOUND
           OR NOT role_row.rolcanlogin
           OR role_row.rolsuper
           OR role_row.rolinherit
           OR role_row.rolcreaterole
           OR role_row.rolcreatedb
           OR role_row.rolreplication
           OR role_row.rolbypassrls THEN
            RAISE EXCEPTION 'Runtime role % has unsafe role attributes or is missing', role_name;
        END IF;

        role_oid := role_row.oid;
        IF EXISTS (SELECT 1 FROM pg_database WHERE datname = current_database() AND datdba = role_oid)
           OR EXISTS (
                SELECT 1 FROM pg_namespace
                 WHERE nspname IN ('flyway', 'control', 'ota') AND nspowner = role_oid
           )
           OR EXISTS (
                SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                 WHERE n.nspname IN ('flyway', 'control', 'ota') AND c.relowner = role_oid
           )
           OR EXISTS (
                SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                 WHERE n.nspname IN ('flyway', 'control', 'ota') AND p.proowner = role_oid
           ) THEN
            RAISE EXCEPTION 'Runtime role % owns deployment objects', role_name;
        END IF;

        IF EXISTS (
            SELECT 1
              FROM pg_auth_members
             WHERE member = role_oid
                OR roleid = role_oid
        ) THEN
            RAISE EXCEPTION
                'Runtime role % has incoming or outgoing database-role membership',
                role_name;
        END IF;

        IF NOT has_database_privilege(role_name, current_database(), 'CONNECT')
           OR has_database_privilege(role_name, current_database(), 'CREATE')
           OR has_database_privilege(role_name, current_database(), 'TEMPORARY') THEN
            RAISE EXCEPTION 'Runtime role % must have database CONNECT only', role_name;
        END IF;

        IF has_schema_privilege(role_name, 'public', 'CREATE') THEN
            RAISE EXCEPTION 'Runtime role % must not have effective CREATE on schema public', role_name;
        END IF;
    END LOOP;

    SELECT format('%I.%I', n.nspname, c.relname)
      INTO unexpected_table
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname IN ('flyway', 'control', 'ota')
       AND c.relkind IN ('r', 'p')
       AND NOT (format('%I.%I', n.nspname, c.relname) = ANY (deployment_tables))
     LIMIT 1;

    IF unexpected_table IS NOT NULL THEN
        RAISE EXCEPTION 'Unreviewed deployment table is absent from the grant matrix: %', unexpected_table;
    END IF;

    FOREACH object_name IN ARRAY deployment_tables
    LOOP
        IF to_regclass(object_name) IS NULL THEN
            RAISE EXCEPTION 'Expected deployment table is missing: %', object_name;
        END IF;

        FOREACH privilege_name IN ARRAY ARRAY[
            'SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'
        ]
        LOOP
            expected := CASE privilege_name
                WHEN 'SELECT' THEN (
                    (
                        object_name LIKE 'ota.%'
                        AND NOT object_name = ANY(api_denied_select)
                    )
                    OR object_name = ANY(api_control_select)
                )
                WHEN 'INSERT' THEN object_name = ANY(api_insert)
                WHEN 'UPDATE' THEN object_name = ANY(api_update)
                ELSE FALSE
            END;
            actual := has_table_privilege(api_name, object_name, privilege_name);
            IF actual IS DISTINCT FROM expected THEN
                RAISE EXCEPTION 'API privilege mismatch: %.% expected %, got %',
                    object_name, privilege_name, expected, actual;
            END IF;

            expected := CASE privilege_name
                WHEN 'SELECT' THEN object_name = ANY(worker_select)
                WHEN 'INSERT' THEN object_name = ANY(worker_insert)
                WHEN 'UPDATE' THEN object_name = ANY(worker_update)
                ELSE FALSE
            END;
            actual := has_table_privilege(worker_name, object_name, privilege_name);
            IF actual IS DISTINCT FROM expected THEN
                RAISE EXCEPTION 'Worker privilege mismatch: %.% expected %, got %',
                    object_name, privilege_name, expected, actual;
            END IF;

            expected := object_name = 'control.audit_event' AND privilege_name = 'INSERT';
            actual := has_table_privilege(audit_name, object_name, privilege_name);
            IF actual IS DISTINCT FROM expected THEN
                RAISE EXCEPTION 'Audit privilege mismatch: %.% expected %, got %',
                    object_name, privilege_name, expected, actual;
            END IF;
        END LOOP;
    END LOOP;

    IF NOT has_schema_privilege(api_name, 'control', 'USAGE')
       OR NOT has_schema_privilege(api_name, 'ota', 'USAGE')
       OR NOT has_schema_privilege(api_name, 'flyway', 'USAGE') THEN
        RAISE EXCEPTION 'API must have control+ota+flyway USAGE';
    END IF;
    IF NOT has_schema_privilege(worker_name, 'control', 'USAGE')
       OR NOT has_schema_privilege(worker_name, 'ota', 'USAGE')
       OR has_schema_privilege(worker_name, 'flyway', 'USAGE') THEN
        RAISE EXCEPTION 'Worker schema privilege matrix must be control+ota USAGE only';
    END IF;
    IF NOT has_schema_privilege(audit_name, 'control', 'USAGE')
       OR has_schema_privilege(audit_name, 'ota', 'USAGE')
       OR has_schema_privilege(audit_name, 'flyway', 'USAGE') THEN
        RAISE EXCEPTION 'Audit schema privilege matrix must be control USAGE only';
    END IF;

    FOREACH role_name IN ARRAY ARRAY[api_name, worker_name, audit_name]
    LOOP
        IF has_schema_privilege(role_name, 'control', 'CREATE')
           OR has_schema_privilege(role_name, 'ota', 'CREATE')
           OR has_schema_privilege(role_name, 'flyway', 'CREATE') THEN
            RAISE EXCEPTION 'Runtime role % must not have schema CREATE', role_name;
        END IF;
    END LOOP;

    FOREACH function_signature IN ARRAY known_functions
    LOOP
        expected := function_signature = ANY(api_functions);
        actual := has_function_privilege(api_name, function_signature, 'EXECUTE');
        IF actual IS DISTINCT FROM expected THEN
            RAISE EXCEPTION 'API function privilege mismatch: % expected %, got %',
                function_signature, expected, actual;
        END IF;

        expected := function_signature = ANY(worker_functions);
        actual := has_function_privilege(worker_name, function_signature, 'EXECUTE');
        IF actual IS DISTINCT FROM expected THEN
            RAISE EXCEPTION 'Worker function privilege mismatch: % expected %, got %',
                function_signature, expected, actual;
        END IF;

        IF has_function_privilege(audit_name, function_signature, 'EXECUTE') THEN
            RAISE EXCEPTION 'Audit role has unapproved function EXECUTE: %', function_signature;
        END IF;
    END LOOP;

    IF (
        SELECT count(*) <> 1
          FROM control.service_principal_database_role_binding AS binding
          JOIN control.service_principal AS principal
            ON principal.service_principal_id = binding.service_principal_id
         WHERE binding.database_role_name = worker_name::NAME
           AND binding.database_role_oid = (
               SELECT oid FROM pg_roles WHERE rolname = worker_name
           )
           AND binding.service_principal_id = worker_principal_id
           AND binding.rotation_slot = worker_slot
           AND binding.binding_state IN ('STAGED', 'ACTIVE', 'DRAINING')
           AND principal.purpose = 'CONNECTOR_WORKER'
           AND principal.status = 'ACTIVE'
    ) OR EXISTS (
        SELECT 1
          FROM control.service_principal_database_role_binding AS binding
         WHERE binding.database_role_name IN (api_name::NAME, audit_name::NAME)
            OR binding.database_role_oid IN (
                SELECT oid
                  FROM pg_roles
                 WHERE rolname IN (api_name, audit_name)
            )
    ) THEN
        RAISE EXCEPTION
            'Worker role must match its explicit live CONNECTOR_WORKER principal/slot and API/Audit must have no binding';
    END IF;

    IF EXISTS (
        SELECT 1
          FROM control.service_principal_database_role_binding AS binding
          LEFT JOIN pg_roles AS role
            ON role.oid = binding.database_role_oid
           AND role.rolname = binding.database_role_name
         WHERE binding.binding_state <> 'RETIRED'
           AND role.oid IS NULL
    ) THEN
        RAISE EXCEPTION
            'Every service-principal binding must match an existing role OID and name exactly';
    END IF;

    IF (
        SELECT count(*) > 2
          FROM control.service_principal_database_role_binding AS binding
          JOIN control.service_principal AS principal
            ON principal.service_principal_id = binding.service_principal_id
         WHERE binding.binding_scope = 'CONNECTOR_WORKER'
           AND binding.binding_state IN ('STAGED', 'ACTIVE', 'DRAINING')
           AND principal.status = 'ACTIVE'
    ) THEN
        RAISE EXCEPTION
            'At most two distinct live CONNECTOR_WORKER blue/green bindings are allowed';
    END IF;

    IF EXISTS (
        SELECT 1
          FROM pg_proc function
          JOIN pg_namespace namespace ON namespace.oid = function.pronamespace
         WHERE namespace.nspname = 'control'
           AND function.proname IN (
               'current_tenant_id',
               'create_tenant_directory_entry', 'enqueue_ota_job',
               'dispatch_due_ota_jobs', 'claim_ota_job',
               'renew_ota_job_lease', 'complete_ota_job',
               'approve_connector_contract_candidate',
               'revoke_connector_contract_baseline',
               'read_effective_connector_contract_baseline',
               'stage_service_principal_binding',
               'promote_service_principal_binding',
               'retire_service_principal_binding',
               'cancel_staged_service_principal_binding',
               'rollback_service_principal_promotion'
           )
           AND (
               NOT function.prosecdef
               OR function.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog']::TEXT[]
           )
    ) THEN
        RAISE EXCEPTION 'SECURITY DEFINER command/job functions must pin search_path to pg_catalog';
    END IF;

    IF EXISTS (
        SELECT 1
          FROM pg_proc AS function
          JOIN pg_namespace AS namespace
            ON namespace.oid = function.pronamespace
         WHERE namespace.nspname = 'control'
           AND (
               (
                   function.proname = 'current_tenant_id'
                   AND (
                       function.provolatile <> 's'
                       OR pg_get_functiondef(function.oid) LIKE '%FOR SHARE%'
                       OR pg_get_functiondef(function.oid) NOT LIKE '%statement_timestamp()%'
                       OR pg_get_functiondef(function.oid) NOT LIKE '%database_role_oid%'
                       OR pg_get_functiondef(function.oid) NOT LIKE '%database_role_name%'
                       OR pg_get_functiondef(function.oid) NOT LIKE '%transaction_isolation%'
                       OR pg_get_functiondef(function.oid) NOT LIKE '%pg_auth_members%'
                       OR pg_get_functiondef(function.oid) NOT LIKE
                          '%NOT COALESCE(session_role_is_superuser, FALSE)%'
                   )
               )
               OR (
                   function.proname = 'read_effective_connector_contract_baseline'
                   AND function.provolatile <> 'v'
               )
           )
    ) THEN
        RAISE EXCEPTION
            'Tenant read gate volatility/identity checks or contract-read volatility are unsafe';
    END IF;

    IF EXISTS (
        SELECT 1
          FROM pg_proc function
          JOIN pg_namespace namespace ON namespace.oid = function.pronamespace
         WHERE namespace.nspname = 'control'
           AND function.proname IN (
               'current_bound_service_principal_id',
               'assert_session_service_principal',
               'assert_session_active_service_principal',
               'current_authenticated_platform_admin_id'
           )
           AND (
               NOT function.prosecdef
               OR function.proconfig IS DISTINCT FROM
                  ARRAY['search_path=pg_catalog']::TEXT[]
               OR function.proowner IN (
                   (SELECT oid FROM pg_roles WHERE rolname = api_name),
                   (SELECT oid FROM pg_roles WHERE rolname = worker_name),
                   (SELECT oid FROM pg_roles WHERE rolname = audit_name)
               )
           )
    ) THEN
        RAISE EXCEPTION
            'Session binding helper owner/SECURITY DEFINER/search_path is unsafe';
    END IF;

    IF EXISTS (
        SELECT 1
          FROM pg_proc function
          JOIN pg_namespace namespace ON namespace.oid = function.pronamespace
         WHERE namespace.nspname = 'control'
           AND (
               (
                    function.proname IN (
                       'dispatch_due_ota_jobs', 'claim_ota_job',
                       'renew_ota_job_lease'
                    )
                    AND pg_get_functiondef(function.oid) NOT LIKE
                        '%control.assert_session_active_service_principal%'
                )
                OR (
                    function.proname = 'complete_ota_job'
                    AND pg_get_functiondef(function.oid) NOT LIKE
                        '%control.assert_session_service_principal%'
                )
           )
    ) THEN
        RAISE EXCEPTION
            'Every dispatch/lease function must assert the session service principal';
    END IF;

    IF EXISTS (
        SELECT 1
          FROM pg_proc AS function
          JOIN pg_namespace AS namespace
            ON namespace.oid = function.pronamespace
          CROSS JOIN LATERAL (
              SELECT lower(
                  regexp_replace(
                      pg_get_functiondef(function.oid),
                      '[[:space:]]+',
                      ' ',
                      'g'
                  )
              ) AS body
          ) AS inspected
         WHERE namespace.nspname = 'control'
           AND (
               (
                   function.proname = 'dispatch_due_ota_jobs'
                   AND (
                       inspected.body NOT LIKE '%clock_timestamp()%'
                       OR inspected.body NOT LIKE
                          '%from control.tenant_directory%'
                       OR inspected.body NOT LIKE
                          '%set_config(%app.tenant_id%'
                       OR inspected.body NOT LIKE
                          '%schedule.tenant_id = tenant_row.dispatch_tenant_id%'
                   )
               )
               OR (
                   function.proname IN (
                       'claim_ota_job', 'renew_ota_job_lease',
                       'complete_ota_job'
                   )
                   AND inspected.body NOT LIKE '%clock_timestamp()%'
               )
               OR (
                   function.proname = 'complete_ota_job'
                   AND (
                       inspected.body NOT LIKE
                          '%lease_acquired_at <= live_draining_at%'
                       OR inspected.body NOT LIKE
                          '%live_draining_at + interval ''15 minutes''%'
                   )
               )
           )
    ) THEN
        RAISE EXCEPTION
            'Database-clock lease semantics, bounded DRAINING completion or tenant-loop dispatch is missing';
    END IF;

    IF EXISTS (
        SELECT 1
          FROM pg_proc function
          JOIN pg_namespace namespace ON namespace.oid = function.pronamespace
          CROSS JOIN LATERAL aclexplode(
              COALESCE(
                  function.proacl,
                  acldefault('f', function.proowner)
              )
          ) acl
         WHERE namespace.nspname = 'control'
           AND function.proname IN (
               'current_bound_service_principal_id',
               'dispatch_due_ota_jobs', 'claim_ota_job',
               'renew_ota_job_lease', 'complete_ota_job',
               'read_effective_connector_contract_baseline'
           )
           AND acl.privilege_type = 'EXECUTE'
           AND acl.grantee <> function.proowner
           AND NOT EXISTS (
               SELECT 1
                 FROM control.service_principal_database_role_binding AS binding
                 JOIN pg_roles AS bound_role
                   ON bound_role.oid = binding.database_role_oid
                  AND bound_role.rolname = binding.database_role_name
                WHERE binding.binding_scope = 'CONNECTOR_WORKER'
                  AND binding.database_role_oid = acl.grantee
           )
    ) THEN
        RAISE EXCEPTION
            'Worker session/job functions have an unexpected EXECUTE grantee';
    END IF;

    IF EXISTS (
        SELECT 1
          FROM pg_class AS relation
          JOIN pg_namespace AS namespace
            ON namespace.oid = relation.relnamespace
          CROSS JOIN LATERAL aclexplode(
              COALESCE(
                  relation.relacl,
                  acldefault(
                      CASE relation.relkind
                          WHEN 'S' THEN 's'::"char"
                          ELSE 'r'::"char"
                      END,
                      relation.relowner
                  )
              )
          ) AS acl
         WHERE namespace.nspname IN ('control', 'ota')
           AND relation.relkind IN ('r', 'p')
           AND acl.privilege_type IN ('SELECT', 'INSERT', 'UPDATE')
           AND acl.grantee <> relation.relowner
           AND acl.grantee NOT IN (
               (SELECT oid FROM pg_roles WHERE rolname = api_name),
               (SELECT oid FROM pg_roles WHERE rolname = audit_name)
           )
           AND NOT EXISTS (
               SELECT 1
                 FROM control.service_principal_database_role_binding AS binding
                 JOIN pg_roles AS bound_role
                   ON bound_role.oid = binding.database_role_oid
                  AND bound_role.rolname = binding.database_role_name
                WHERE binding.binding_scope = 'CONNECTOR_WORKER'
                  AND binding.database_role_oid = acl.grantee
           )
    ) THEN
        RAISE EXCEPTION
            'A deployment table has an unexpected non-owner/API/Audit/bound-Worker ACL grantee';
    END IF;

    IF NOT EXISTS (
        SELECT 1
          FROM pg_constraint
         WHERE conrelid = 'ota.hotel'::regclass
           AND conname = 'hotel_message_delivery_disabled'
           AND contype = 'c'
           AND convalidated
           AND regexp_replace(
               lower(pg_get_constraintdef(oid)),
               '[[:space:]()]',
               '',
               'g'
           ) = 'checknotmessage_enabled'
    ) OR NOT EXISTS (
        SELECT 1
          FROM pg_attribute
         WHERE attrelid = 'ota.hotel'::regclass
           AND attname = 'message_enabled'
           AND attnum > 0
           AND NOT attisdropped
           AND attnotnull
    ) THEN
        RAISE EXCEPTION
            'ota.hotel.message_enabled must remain hard-disabled by a validated database constraint';
    END IF;
END
$verify$;

\echo 'PASS: runtime roles match the exact Sprint 2D table/function ACL, offline rehearsal function boundary, narrow contract read and blue/green binding matrix.'
