\set ON_ERROR_STOP on

\if :{?worker_service_principal_id}
\else
    \echo 'worker_service_principal_id is required'
    \quit 3
\endif
\if :{?worker_principal_code}
\else
    \echo 'worker_principal_code is required'
    \quit 3
\endif

BEGIN;

CREATE TEMPORARY TABLE pg_temp.sprint1_worker_principal_seed (
    service_principal_id UUID PRIMARY KEY,
    principal_code VARCHAR(96) NOT NULL,
    purpose VARCHAR(32) NOT NULL,
    status VARCHAR(24) NOT NULL,
    CHECK (service_principal_id <> '00000000-0000-0000-0000-000000000000'::UUID)
) ON COMMIT DROP;

-- psql quotes the environment-supplied value as a SQL literal before the UUID
-- cast. Invalid or nil UUIDs therefore fail the one-shot deployment job.
INSERT INTO pg_temp.sprint1_worker_principal_seed(
    service_principal_id, principal_code, purpose, status
)
VALUES (
    :'worker_service_principal_id'::UUID,
    :'worker_principal_code',
    'CONNECTOR_WORKER',
    'ACTIVE'
);

DO $seed_guard$
DECLARE
    expected RECORD;
    service_principal_owner TEXT;
BEGIN
    SELECT * INTO STRICT expected
      FROM pg_temp.sprint1_worker_principal_seed;

    SELECT tableowner
      INTO service_principal_owner
      FROM pg_catalog.pg_tables
     WHERE schemaname = 'control'
       AND tablename = 'service_principal';

    IF service_principal_owner IS DISTINCT FROM CURRENT_USER THEN
        RAISE EXCEPTION
            'Sprint 1 Worker principal seed must run as the migration owner';
    END IF;

    IF EXISTS (
        SELECT 1
          FROM control.service_principal principal
         WHERE principal.principal_code = expected.principal_code
           AND principal.service_principal_id <> expected.service_principal_id
    ) THEN
        RAISE EXCEPTION
            'Principal code % is already bound to another UUID',
            expected.principal_code;
    END IF;

    IF expected.principal_code !~ '^[A-Z0-9_]{1,96}$' THEN
        RAISE EXCEPTION 'Worker principal code must be an uppercase deployment identifier';
    END IF;

    IF EXISTS (
        SELECT 1
          FROM control.service_principal principal
         WHERE principal.service_principal_id = expected.service_principal_id
           AND principal.principal_code <> expected.principal_code
    ) THEN
        RAISE EXCEPTION
            'Worker principal UUID is already bound to another principal code';
    END IF;
END
$seed_guard$;

INSERT INTO control.service_principal(
    service_principal_id,
    principal_code,
    purpose,
    status,
    disabled_at
)
SELECT
    desired.service_principal_id,
    desired.principal_code,
    desired.purpose,
    desired.status,
    NULL
  FROM pg_temp.sprint1_worker_principal_seed desired
ON CONFLICT (service_principal_id) DO NOTHING;

DO $seed_verify$
DECLARE
    expected RECORD;
BEGIN
    SELECT * INTO STRICT expected
      FROM pg_temp.sprint1_worker_principal_seed;

    IF NOT EXISTS (
        SELECT 1
          FROM control.service_principal principal
         WHERE principal.service_principal_id = expected.service_principal_id
           AND principal.principal_code = expected.principal_code
           AND principal.purpose = 'CONNECTOR_WORKER'
           AND principal.status = 'ACTIVE'
           AND principal.disabled_at IS NULL
    ) THEN
        RAISE EXCEPTION
            'Worker service principal is absent, changed, or DISABLED; seed refuses reactivation';
    END IF;
END
$seed_verify$;

COMMIT;

\echo 'PASS: Sprint 1 simulation Worker service principal is ACTIVE and contains no credential material.'
