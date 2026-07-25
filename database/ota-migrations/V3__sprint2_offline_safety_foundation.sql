-- OTA Sprint 2A offline safety foundation.
-- Forward-only: bind each runtime database login to one ACTIVE service
-- principal and preserve exact 5/15/30-minute collection schedule slots.
-- This migration does not enable a real connector or external delivery.

CREATE TABLE control.service_principal_database_role_binding (
    service_principal_id UUID PRIMARY KEY
        REFERENCES control.service_principal(service_principal_id),
    database_role_name NAME NOT NULL UNIQUE,
    binding_reason VARCHAR(160) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CHECK (btrim(database_role_name::TEXT) <> ''),
    CHECK (btrim(binding_reason) <> '')
);

COMMENT ON TABLE control.service_principal_database_role_binding IS
    'One-to-one database session_user to service principal binding. Runtime roles receive no direct table privileges.';

CREATE FUNCTION control.current_bound_service_principal_id()
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
    SELECT principal.service_principal_id
      FROM control.service_principal_database_role_binding binding
      JOIN control.service_principal principal
        ON principal.service_principal_id = binding.service_principal_id
     WHERE binding.database_role_name = session_user::NAME
       AND principal.status = 'ACTIVE'
$$;

CREATE FUNCTION control.assert_session_service_principal(
    p_service_principal_id UUID,
    p_allowed_purposes TEXT[]
)
RETURNS VOID
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
BEGIN
    IF p_service_principal_id IS NULL
       OR p_allowed_purposes IS NULL
       OR cardinality(p_allowed_purposes) = 0 THEN
        RAISE EXCEPTION USING
            ERRCODE = '42501',
            MESSAGE = 'database session is not bound to the requested service principal';
    END IF;

    IF NOT EXISTS (
        SELECT 1
          FROM control.service_principal_database_role_binding binding
          JOIN control.service_principal principal
            ON principal.service_principal_id = binding.service_principal_id
         WHERE binding.database_role_name = session_user::NAME
           AND principal.service_principal_id = p_service_principal_id
           AND principal.status = 'ACTIVE'
           AND principal.purpose = ANY (p_allowed_purposes)
    ) THEN
        RAISE EXCEPTION USING
            ERRCODE = '42501',
            MESSAGE = 'database session is not bound to the requested service principal';
    END IF;
END;
$$;

REVOKE ALL ON TABLE control.service_principal_database_role_binding FROM PUBLIC;
REVOKE ALL ON FUNCTION control.current_bound_service_principal_id() FROM PUBLIC;
REVOKE ALL ON FUNCTION control.assert_session_service_principal(UUID, TEXT[]) FROM PUBLIC;

ALTER TABLE control.ota_job_registry
    DROP CONSTRAINT IF EXISTS ota_job_registry_scheduled_for_check;

ALTER TABLE control.ota_job_registry
    ADD CONSTRAINT ota_job_registry_scheduled_slot_check CHECK (
        scheduled_for = date_trunc('minute', scheduled_for)
        AND (
            job_type <> 'SIMULATION_PIPELINE'
            OR scheduled_for = date_trunc('hour', scheduled_for)
        )
        AND (
            trigger_type <> 'HOURLY_CUTOFF'
            OR scheduled_for = date_trunc('hour', scheduled_for)
        )
    );

ALTER TABLE ota.connector_collection_run
    DROP CONSTRAINT IF EXISTS connector_collection_run_cutoff_at_check;

ALTER TABLE ota.connector_collection_run
    ADD CONSTRAINT connector_collection_run_cutoff_slot_check CHECK (
        scheduled_for = date_trunc('minute', scheduled_for)
        AND cutoff_at = date_trunc('minute', cutoff_at)
        AND (
            trigger_type NOT IN ('HOURLY_CUTOFF', 'MANUAL_SIMULATION')
            OR (
                scheduled_for = date_trunc('hour', scheduled_for)
                AND cutoff_at = date_trunc('hour', cutoff_at)
            )
        )
    );

ALTER TABLE ota.connector_collection_schedule
    ADD CONSTRAINT connector_collection_schedule_exact_interval_check CHECK (
        trigger_type NOT IN ('NORMAL', 'FILE_IMPORT')
        OR (
            next_due_at = date_trunc('minute', next_due_at)
            AND mod(
                extract(EPOCH FROM next_due_at)::BIGINT,
                interval_minutes::BIGINT * 60
            ) = 0
        )
    );

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

    PERFORM control.assert_session_service_principal(
        p_scheduler_service_principal_id,
        ARRAY['SCHEDULER', 'CONNECTOR_WORKER']::TEXT[]
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

    PERFORM control.assert_session_service_principal(
        p_worker_service_principal_id,
        ARRAY['CONNECTOR_WORKER']::TEXT[]
    );

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
     ORDER BY candidate.priority_no, candidate.available_at,
              candidate.scheduled_for, candidate.job_id
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
           job.connector_id, job.simulation_run_id, job.job_type::TEXT,
           job.stream_code::TEXT, job.trigger_type::TEXT, job.run_id,
           job.scheduled_for, job.lease_until, job.attempt_count, job.max_attempts
      FROM control.ota_job_registry job
     WHERE job.job_id = claimed_job_id;
END;
$$;

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
BEGIN
    PERFORM control.assert_session_service_principal(
        p_worker_service_principal_id,
        ARRAY['CONNECTOR_WORKER']::TEXT[]
    );

    IF p_job_id IS NULL
       OR p_lease_id IS NULL
       OR p_now IS NULL
       OR p_new_lease_until IS NULL
       OR p_new_lease_until <= p_now
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
       AND job.lease_until > p_now;
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
BEGIN
    PERFORM control.assert_session_service_principal(
        p_worker_service_principal_id,
        ARRAY['CONNECTOR_WORKER']::TEXT[]
    );

    IF p_job_id IS NULL
       OR p_lease_id IS NULL
       OR p_now IS NULL
       OR p_outcome_code NOT IN ('SUCCEEDED', 'RETRYABLE_FAILURE', 'TERMINAL_FAILURE')
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
       AND job.lease_until >= p_now;
    GET DIAGNOSTICS updated_count = ROW_COUNT;
    RETURN updated_count = 1;
END;
$$;

REVOKE ALL ON FUNCTION control.dispatch_due_ota_jobs(UUID, TIMESTAMPTZ, INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION control.claim_ota_job(UUID, UUID, UUID, TIMESTAMPTZ, TIMESTAMPTZ, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION control.renew_ota_job_lease(UUID, UUID, UUID, TIMESTAMPTZ, TIMESTAMPTZ) FROM PUBLIC;
REVOKE ALL ON FUNCTION control.complete_ota_job(UUID, UUID, UUID, TIMESTAMPTZ, TEXT, TEXT) FROM PUBLIC;
