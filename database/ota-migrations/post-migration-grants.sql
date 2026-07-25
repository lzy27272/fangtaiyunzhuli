-- Parameterized, auditable runtime grants through OTA Sprint 2D.
-- Run as the non-superuser migration owner after Flyway V1 through V6.
--
-- Required psql variables: api_role, worker_role, audit_role.
-- No default privileges, ALL TABLES, broad role membership or ownership is used.

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

SELECT set_config('ota.grants.api_role', :'api_role', false);
SELECT set_config('ota.grants.worker_role', :'worker_role', false);
SELECT set_config('ota.grants.audit_role', :'audit_role', false);
SELECT set_config(
    'ota.grants.worker_service_principal_id',
    :'worker_service_principal_id',
    false
);
SELECT set_config('ota.grants.worker_slot', :'worker_slot', false);

DO $assertions$
DECLARE
    api_name TEXT := current_setting('ota.grants.api_role');
    worker_name TEXT := current_setting('ota.grants.worker_role');
    audit_name TEXT := current_setting('ota.grants.audit_role');
    role_name TEXT;
    role_oid OID;
    role_row RECORD;
BEGIN
    IF api_name = worker_name OR api_name = audit_name OR worker_name = audit_name THEN
        RAISE EXCEPTION 'API, Worker and Audit roles must be three distinct roles';
    END IF;

    FOREACH role_name IN ARRAY ARRAY[api_name, worker_name, audit_name]
    LOOP
        SELECT oid, rolname, rolcanlogin, rolsuper, rolinherit, rolcreaterole,
               rolcreatedb, rolreplication, rolbypassrls
          INTO role_row
          FROM pg_roles
         WHERE rolname = role_name;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'Required runtime role % does not exist', role_name;
        END IF;

        IF NOT role_row.rolcanlogin
           OR role_row.rolsuper
           OR role_row.rolinherit
           OR role_row.rolcreaterole
           OR role_row.rolcreatedb
           OR role_row.rolreplication
           OR role_row.rolbypassrls THEN
            RAISE EXCEPTION
                'Unsafe attributes for runtime role % (LOGIN=true, NOSUPERUSER, NOINHERIT, NOCREATEROLE, NOCREATEDB, NOREPLICATION and NOBYPASSRLS are required)',
                role_name;
        END IF;

        role_oid := role_row.oid;
        IF EXISTS (SELECT 1 FROM pg_database WHERE datname = current_database() AND datdba = role_oid)
           OR EXISTS (
                SELECT 1 FROM pg_namespace
                 WHERE nspname IN ('flyway', 'control', 'ota') AND nspowner = role_oid
           )
           OR EXISTS (
                SELECT 1
                  FROM pg_class c
                  JOIN pg_namespace n ON n.oid = c.relnamespace
                 WHERE n.nspname IN ('flyway', 'control', 'ota') AND c.relowner = role_oid
           )
           OR EXISTS (
                SELECT 1
                  FROM pg_proc p
                  JOIN pg_namespace n ON n.oid = p.pronamespace
                 WHERE n.nspname IN ('flyway', 'control', 'ota') AND p.proowner = role_oid
           ) THEN
            RAISE EXCEPTION 'Runtime role % must not own deployment objects', role_name;
        END IF;

        IF EXISTS (
            SELECT 1
              FROM pg_auth_members
             WHERE member = role_oid OR roleid = role_oid
        ) THEN
            RAISE EXCEPTION
                'Runtime role % must have no incoming or outgoing database-role membership',
                role_name;
        END IF;
    END LOOP;
END
$assertions$;

DO $worker_binding$
DECLARE
    worker_name TEXT := current_setting('ota.grants.worker_role');
    worker_principal_id UUID :=
        current_setting('ota.grants.worker_service_principal_id')::UUID;
    worker_slot TEXT := current_setting('ota.grants.worker_slot');
    worker_role_oid OID;
    stage_state TEXT;
    stage_rotation_id UUID;
BEGIN
    SELECT role.oid
      INTO worker_role_oid
      FROM pg_catalog.pg_roles AS role
     WHERE role.rolname = worker_name;

    IF worker_principal_id =
       '00000000-0000-0000-0000-000000000000'::UUID
       OR worker_slot NOT IN ('BLUE', 'GREEN')
       OR NOT EXISTS (
           SELECT 1
             FROM control.service_principal AS principal
            WHERE principal.service_principal_id = worker_principal_id
              AND principal.purpose = 'CONNECTOR_WORKER'
              AND principal.status = 'ACTIVE'
       ) THEN
        RAISE EXCEPTION
            'Explicit ACTIVE CONNECTOR_WORKER principal_id and BLUE/GREEN slot are required';
    END IF;

    IF EXISTS (
        SELECT 1
          FROM control.service_principal_database_role_binding AS binding
         WHERE (
                   (
                       binding.database_role_name = worker_name::NAME
                       OR binding.database_role_oid = worker_role_oid
                   )
                   AND binding.service_principal_id <> worker_principal_id
               )
            OR (
                   binding.service_principal_id = worker_principal_id
                   AND (
                       binding.database_role_name <> worker_name::NAME
                       OR binding.database_role_oid <> worker_role_oid
                   )
               )
    ) THEN
        RAISE EXCEPTION
            'Worker principal and database LOGIN binding metadata conflict';
    END IF;

    stage_rotation_id := md5(
        worker_principal_id::TEXT || '|' || worker_name || '|' || worker_slot
    )::UUID;
    SELECT control.stage_service_principal_binding(
        worker_principal_id,
        worker_name::NAME,
        worker_slot,
        stage_rotation_id,
        'POST_MIGRATION_RUNTIME_GRANT'
    )
      INTO stage_state;

    IF stage_state NOT IN ('STAGED', 'ACTIVE') THEN
        RAISE EXCEPTION
            'Worker binding did not converge to a live blue/green state';
    END IF;
END
$worker_binding$;

DO $grants$
DECLARE
    api_name TEXT := current_setting('ota.grants.api_role');
    worker_name TEXT := current_setting('ota.grants.worker_role');
    audit_name TEXT := current_setting('ota.grants.audit_role');
    role_name TEXT;
    object_name TEXT;
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
        'ota.notification_delivery_attempt'
    ];
BEGIN
    -- Converge from a closed baseline and enumerate every current relation.
    FOREACH role_name IN ARRAY ARRAY[api_name, worker_name, audit_name]
    LOOP
        EXECUTE format('REVOKE ALL PRIVILEGES ON SCHEMA flyway, control, ota FROM %I', role_name);
        FOREACH object_name IN ARRAY deployment_tables
        LOOP
            EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE %s FROM %I', object_name, role_name);
        END LOOP;

        EXECUTE format('REVOKE ALL PRIVILEGES ON FUNCTION control.current_tenant_id() FROM %I', role_name);
        EXECUTE format(
            'REVOKE ALL PRIVILEGES ON FUNCTION control.current_bound_service_principal_id() FROM %I',
            role_name
        );
        EXECUTE format(
            'REVOKE ALL PRIVILEGES ON FUNCTION control.assert_session_service_principal(uuid,text[]) FROM %I',
            role_name
        );
        EXECUTE format('REVOKE ALL PRIVILEGES ON FUNCTION control.reject_append_only_mutation() FROM %I', role_name);
        EXECUTE format('REVOKE ALL PRIVILEGES ON FUNCTION control.jsonb_contains_forbidden_secret_key(jsonb) FROM %I', role_name);
        EXECUTE format(
            'REVOKE ALL PRIVILEGES ON FUNCTION control.create_tenant_directory_entry(uuid,text,text,uuid,text,text,text,uuid) FROM %I',
            role_name
        );
        EXECUTE format(
            'REVOKE ALL PRIVILEGES ON FUNCTION control.enqueue_ota_job(uuid,uuid,uuid,uuid,uuid,uuid,timestamptz) FROM %I',
            role_name
        );
        EXECUTE format(
            'REVOKE ALL PRIVILEGES ON FUNCTION control.dispatch_due_ota_jobs(uuid,timestamptz,integer) FROM %I',
            role_name
        );
        EXECUTE format(
        'REVOKE ALL PRIVILEGES ON FUNCTION control.claim_ota_job(uuid,uuid,uuid,timestamptz,timestamptz,text) FROM %I',
            role_name
        );
        EXECUTE format(
            'REVOKE ALL PRIVILEGES ON FUNCTION control.renew_ota_job_lease(uuid,uuid,uuid,timestamptz,timestamptz) FROM %I',
            role_name
        );
        EXECUTE format(
            'REVOKE ALL PRIVILEGES ON FUNCTION control.complete_ota_job(uuid,uuid,uuid,timestamptz,text,text) FROM %I',
            role_name
        );
        EXECUTE format(
            'REVOKE ALL PRIVILEGES ON FUNCTION control.enforce_configuration_only_connector() FROM %I',
            role_name
        );
        EXECUTE format(
            'REVOKE ALL PRIVILEGES ON FUNCTION control.enforce_configuration_only_version() FROM %I',
            role_name
        );
        EXECUTE format(
            'REVOKE ALL PRIVILEGES ON FUNCTION control.reject_configuration_only_runtime() FROM %I',
            role_name
        );
        EXECUTE format(
            'REVOKE ALL PRIVILEGES ON FUNCTION control.enforce_connector_contract_baseline_approval() FROM %I',
            role_name
        );
        EXECUTE format(
            'REVOKE ALL PRIVILEGES ON FUNCTION control.current_authenticated_platform_admin_id() FROM %I',
            role_name
        );
        EXECUTE format(
            'REVOKE ALL PRIVILEGES ON FUNCTION control.approve_connector_contract_candidate(uuid,uuid,uuid,uuid,uuid,uuid,text,bigint,uuid,text,text,text) FROM %I',
            role_name
        );
        EXECUTE format(
            'REVOKE ALL PRIVILEGES ON FUNCTION control.revoke_connector_contract_baseline(uuid,uuid,uuid,uuid,bigint,uuid,text,text,text) FROM %I',
            role_name
        );
        EXECUTE format(
            'REVOKE ALL PRIVILEGES ON FUNCTION control.read_effective_connector_contract_baseline(uuid,uuid,uuid,uuid,text) FROM %I',
            role_name
        );
        EXECUTE format(
            'REVOKE ALL PRIVILEGES ON FUNCTION control.assert_session_active_service_principal(uuid,text[]) FROM %I',
            role_name
        );
        EXECUTE format(
            'REVOKE ALL PRIVILEGES ON FUNCTION control.stage_service_principal_binding(uuid,name,text,uuid,text) FROM %I',
            role_name
        );
        EXECUTE format(
            'REVOKE ALL PRIVILEGES ON FUNCTION control.promote_service_principal_binding(uuid,uuid,uuid,text) FROM %I',
            role_name
        );
        EXECUTE format(
            'REVOKE ALL PRIVILEGES ON FUNCTION control.retire_service_principal_binding(uuid,uuid,uuid,text) FROM %I',
            role_name
        );
        EXECUTE format(
            'REVOKE ALL PRIVILEGES ON FUNCTION control.cancel_staged_service_principal_binding(uuid,uuid,text) FROM %I',
            role_name
        );
        EXECUTE format(
            'REVOKE ALL PRIVILEGES ON FUNCTION control.rollback_service_principal_promotion(uuid,uuid,uuid,text) FROM %I',
            role_name
        );
        EXECUTE format(
            'REVOKE ALL PRIVILEGES ON FUNCTION control.enforce_live_worker_write_session() FROM %I',
            role_name
        );
        EXECUTE format(
            'REVOKE ALL PRIVILEGES ON FUNCTION control.enforce_browser_authorization_rehearsal_insert() FROM %I',
            role_name
        );
        EXECUTE format(
            'REVOKE ALL PRIVILEGES ON FUNCTION ota.start_browser_authorization_rehearsal(uuid,uuid,uuid,uuid,uuid,uuid,bigint,text,text,text,timestamptz,uuid,text,text,text,uuid,bigint) FROM %I',
            role_name
        );
        EXECUTE format(
            'REVOKE ALL PRIVILEGES ON FUNCTION ota.transition_browser_authorization_rehearsal(uuid,uuid,uuid,uuid,uuid,uuid,bigint,text,text,bigint,text,uuid,text,text,text) FROM %I',
            role_name
        );
    END LOOP;

    -- API authentication, authorization, compatibility gate and audit.
    EXECUTE format('GRANT USAGE ON SCHEMA control, ota, flyway TO %I', api_name);
    EXECUTE format('GRANT SELECT ON TABLE control.tenant_directory TO %I', api_name);
    EXECUTE format('GRANT SELECT, INSERT ON TABLE control.auth_account TO %I', api_name);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE ON TABLE control.auth_credential TO %I', api_name);
    EXECUTE format('GRANT SELECT ON TABLE control.role_definition TO %I', api_name);
    EXECUTE format('GRANT SELECT ON TABLE control.permission_definition TO %I', api_name);
    EXECUTE format('GRANT SELECT ON TABLE control.role_permission TO %I', api_name);
    EXECUTE format('GRANT SELECT, INSERT ON TABLE control.account_role TO %I', api_name);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE ON TABLE control.auth_session TO %I', api_name);
    EXECUTE format('GRANT SELECT ON TABLE control.connector_adapter_registry TO %I', api_name);
    EXECUTE format('GRANT INSERT ON TABLE control.audit_event TO %I', api_name);
    EXECUTE format('GRANT SELECT ON TABLE flyway.flyway_schema_history TO %I', api_name);
    EXECUTE format('GRANT EXECUTE ON FUNCTION control.current_tenant_id() TO %I', api_name);
    EXECUTE format(
        'GRANT EXECUTE ON FUNCTION control.jsonb_contains_forbidden_secret_key(jsonb) TO %I',
        api_name
    );
    EXECUTE format(
        'GRANT EXECUTE ON FUNCTION control.create_tenant_directory_entry(uuid,text,text,uuid,text,text,text,uuid) TO %I',
        api_name
    );
    EXECUTE format(
        'GRANT EXECUTE ON FUNCTION control.enqueue_ota_job(uuid,uuid,uuid,uuid,uuid,uuid,timestamptz) TO %I',
        api_name
    );

    -- API configuration and command-owned mutable resources.
    EXECUTE format('GRANT SELECT, INSERT, UPDATE ON TABLE ota.hotel TO %I', api_name);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE ON TABLE ota.account_hotel_scope TO %I', api_name);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE ON TABLE ota.hotel_duty_roster_version TO %I', api_name);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE ON TABLE ota.hotel_duty_roster_assignment TO %I', api_name);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE ON TABLE ota.hotel_escalation_policy_version TO %I', api_name);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE ON TABLE ota.hotel_escalation_recipient TO %I', api_name);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE ON TABLE ota.hotel_business_day_config TO %I', api_name);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE ON TABLE ota.hotel_source_connector TO %I', api_name);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE ON TABLE ota.hotel_source_connector_version TO %I', api_name);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE ON TABLE ota.connector_secret_binding TO %I', api_name);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE ON TABLE ota.connector_authorization_state TO %I', api_name);
    EXECUTE format('GRANT SELECT ON TABLE ota.browser_authorization_attempt TO %I', api_name);
    EXECUTE format('GRANT SELECT ON TABLE ota.browser_authorization_command_receipt TO %I', api_name);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE ON TABLE ota.hotel_message_endpoint TO %I', api_name);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE ON TABLE ota.connector_collection_schedule TO %I', api_name);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE ON TABLE ota.hotel_revenue_target_version TO %I', api_name);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE ON TABLE ota.hotel_pace_curve_version TO %I', api_name);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE ON TABLE ota.hotel_pace_curve_point TO %I', api_name);
    EXECUTE format('GRANT SELECT, INSERT ON TABLE ota.ota_command_idempotency TO %I', api_name);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE ON TABLE ota.simulation_run TO %I', api_name);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE ON TABLE ota.source_import_batch TO %I', api_name);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE ON TABLE ota.ota_standard_room_type TO %I', api_name);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE ON TABLE ota.hotel_inventory_pool TO %I', api_name);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE ON TABLE ota.source_sellable_product TO %I', api_name);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE ON TABLE ota.source_product_mapping_version TO %I', api_name);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE ON TABLE ota.inventory_policy_version TO %I', api_name);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE ON TABLE ota.notification_target TO %I', api_name);
    EXECUTE format(
        'GRANT EXECUTE ON FUNCTION ota.start_browser_authorization_rehearsal(uuid,uuid,uuid,uuid,uuid,uuid,bigint,text,text,text,timestamptz,uuid,text,text,text,uuid,bigint) TO %I',
        api_name
    );
    EXECUTE format(
        'GRANT EXECUTE ON FUNCTION ota.transition_browser_authorization_rehearsal(uuid,uuid,uuid,uuid,uuid,uuid,bigint,text,text,bigint,text,uuid,text,text,text) TO %I',
        api_name
    );

    -- API read models and P1/task command surface.
    EXECUTE format('GRANT SELECT, INSERT, UPDATE ON TABLE ota.ota_incident TO %I', api_name);
    EXECUTE format('GRANT SELECT, INSERT ON TABLE ota.ota_incident_occurrence TO %I', api_name);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE ON TABLE ota.ota_task TO %I', api_name);
    EXECUTE format('GRANT SELECT, INSERT ON TABLE ota.ota_task_event TO %I', api_name);
    EXECUTE format('GRANT SELECT, INSERT ON TABLE ota.ota_outbox_event TO %I', api_name);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE ON TABLE ota.ota_outbox_publish_state TO %I', api_name);

    FOREACH object_name IN ARRAY ARRAY[
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
        'ota.inventory_observation',
        'ota.inventory_observation_item',
        'ota.source_booking',
        'ota.source_booking_revision',
        'ota.booking_room_night_delta',
        'ota.daily_operation_snapshot',
        'ota.daily_operation_snapshot_metric',
        'ota.ota_hourly_brief',
        'ota.ota_brief_adjustment',
        'ota.notification_delivery',
        'ota.notification_delivery_attempt'
    ]
    LOOP
        EXECUTE format('GRANT SELECT ON TABLE %s TO %I', object_name, api_name);
    END LOOP;

    -- Worker gets only tenant-scoped configuration reads, exact ingestion/
    -- simulation writes, due-schedule dispatch and the three lease functions.
    -- It gets no direct control-plane table access and no tenant-creation or
    -- caller-selected enqueue authority.
    EXECUTE format('GRANT USAGE ON SCHEMA control, ota TO %I', worker_name);
    EXECUTE format('GRANT EXECUTE ON FUNCTION control.current_tenant_id() TO %I', worker_name);
    EXECUTE format(
        'GRANT EXECUTE ON FUNCTION control.current_bound_service_principal_id() TO %I',
        worker_name
    );
    EXECUTE format(
        'GRANT EXECUTE ON FUNCTION control.jsonb_contains_forbidden_secret_key(jsonb) TO %I',
        worker_name
    );
    EXECUTE format(
        'GRANT EXECUTE ON FUNCTION control.claim_ota_job(uuid,uuid,uuid,timestamptz,timestamptz,text) TO %I',
        worker_name
    );
    EXECUTE format(
        'GRANT EXECUTE ON FUNCTION control.dispatch_due_ota_jobs(uuid,timestamptz,integer) TO %I',
        worker_name
    );
    EXECUTE format(
        'GRANT EXECUTE ON FUNCTION control.renew_ota_job_lease(uuid,uuid,uuid,timestamptz,timestamptz) TO %I',
        worker_name
    );
    EXECUTE format(
        'GRANT EXECUTE ON FUNCTION control.complete_ota_job(uuid,uuid,uuid,timestamptz,text,text) TO %I',
        worker_name
    );
    EXECUTE format(
        'GRANT EXECUTE ON FUNCTION control.read_effective_connector_contract_baseline(uuid,uuid,uuid,uuid,text) TO %I',
        worker_name
    );

    FOREACH object_name IN ARRAY ARRAY[
        'ota.hotel',
        'ota.hotel_duty_roster_version',
        'ota.hotel_duty_roster_assignment',
        'ota.hotel_escalation_policy_version',
        'ota.hotel_escalation_recipient',
        'ota.hotel_business_day_config',
        'ota.hotel_source_connector',
        'ota.hotel_source_connector_version',
        'ota.connector_collection_schedule',
        'ota.hotel_revenue_target_version',
        'ota.hotel_pace_curve_version',
        'ota.hotel_pace_curve_point',
        'ota.ota_standard_room_type',
        'ota.hotel_inventory_pool',
        'ota.source_product_mapping_version',
        'ota.inventory_policy_version',
        'ota.hotel_message_endpoint',
        'ota.notification_target'
    ]
    LOOP
        EXECUTE format('GRANT SELECT ON TABLE %s TO %I', object_name, worker_name);
    END LOOP;

    EXECUTE format('GRANT SELECT, UPDATE ON TABLE ota.simulation_run TO %I', worker_name);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE ON TABLE ota.connector_authorization_state TO %I', worker_name);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE ON TABLE ota.connector_collection_run TO %I', worker_name);
    EXECUTE format('GRANT SELECT, INSERT ON TABLE ota.connector_collection_attempt TO %I', worker_name);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE ON TABLE ota.connector_stream_checkpoint TO %I', worker_name);
    EXECUTE format('GRANT SELECT, INSERT ON TABLE ota.source_raw_record TO %I', worker_name);
    EXECUTE format('GRANT SELECT ON TABLE ota.source_import_batch TO %I', worker_name);
    EXECUTE format('GRANT SELECT, INSERT ON TABLE ota.pms_business_day_observation TO %I', worker_name);
    EXECUTE format('GRANT SELECT, INSERT ON TABLE ota.pms_business_day_transition TO %I', worker_name);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE ON TABLE ota.business_day_run TO %I', worker_name);
    EXECUTE format('GRANT SELECT, INSERT ON TABLE ota.pms_operating_observation TO %I', worker_name);
    EXECUTE format('GRANT SELECT, INSERT ON TABLE ota.pms_room_charge_event TO %I', worker_name);
    EXECUTE format('GRANT SELECT, INSERT ON TABLE ota.source_standard_record TO %I', worker_name);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE ON TABLE ota.source_sellable_product TO %I', worker_name);
    EXECUTE format('GRANT SELECT, INSERT ON TABLE ota.inventory_observation TO %I', worker_name);
    EXECUTE format('GRANT SELECT, INSERT ON TABLE ota.inventory_observation_item TO %I', worker_name);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE ON TABLE ota.source_booking TO %I', worker_name);
    EXECUTE format('GRANT SELECT, INSERT ON TABLE ota.source_booking_revision TO %I', worker_name);
    EXECUTE format('GRANT SELECT, INSERT ON TABLE ota.booking_room_night_delta TO %I', worker_name);
    EXECUTE format('GRANT SELECT, INSERT ON TABLE ota.daily_operation_snapshot TO %I', worker_name);
    EXECUTE format('GRANT SELECT, INSERT ON TABLE ota.daily_operation_snapshot_metric TO %I', worker_name);
    EXECUTE format('GRANT SELECT, INSERT ON TABLE ota.ota_hourly_brief TO %I', worker_name);
    EXECUTE format('GRANT SELECT, INSERT ON TABLE ota.ota_brief_adjustment TO %I', worker_name);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE ON TABLE ota.ota_incident TO %I', worker_name);
    EXECUTE format('GRANT SELECT, INSERT ON TABLE ota.ota_incident_occurrence TO %I', worker_name);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE ON TABLE ota.ota_task TO %I', worker_name);
    EXECUTE format('GRANT SELECT, INSERT ON TABLE ota.ota_task_event TO %I', worker_name);
    EXECUTE format('GRANT SELECT, INSERT ON TABLE ota.ota_outbox_event TO %I', worker_name);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE ON TABLE ota.ota_outbox_publish_state TO %I', worker_name);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE ON TABLE ota.notification_delivery TO %I', worker_name);
    EXECUTE format('GRANT SELECT, INSERT ON TABLE ota.notification_delivery_attempt TO %I', worker_name);

    -- Independent audit sink stays write-only.
    EXECUTE format('GRANT USAGE ON SCHEMA control TO %I', audit_name);
    EXECUTE format('GRANT INSERT ON TABLE control.audit_event TO %I', audit_name);
END
$grants$;

\echo 'PASS: Sprint 2D runtime grants, offline rehearsal command functions, explicit Worker principal/slot binding and narrow contract read applied.'
