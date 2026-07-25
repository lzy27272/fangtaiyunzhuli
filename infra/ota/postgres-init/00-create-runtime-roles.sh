#!/usr/bin/env sh
set -eu

: "${PGHOST:?PGHOST is required}"
: "${PGDATABASE:?PGDATABASE is required}"
: "${PGUSER:?PGUSER is required}"
: "${PGPASSWORD:?PGPASSWORD is required}"
: "${OTA_DB_MIGRATION_USER:?OTA_DB_MIGRATION_USER is required}"
: "${OTA_DB_MIGRATION_PASSWORD:?OTA_DB_MIGRATION_PASSWORD is required}"
: "${OTA_DB_API_USER:?OTA_DB_API_USER is required}"
: "${OTA_DB_API_PASSWORD:?OTA_DB_API_PASSWORD is required}"
: "${OTA_DB_WORKER_USER:?OTA_DB_WORKER_USER is required}"
: "${OTA_DB_WORKER_PASSWORD:?OTA_DB_WORKER_PASSWORD is required}"
: "${OTA_DB_AUDIT_USER:?OTA_DB_AUDIT_USER is required}"
: "${OTA_DB_AUDIT_PASSWORD:?OTA_DB_AUDIT_PASSWORD is required}"

psql --set ON_ERROR_STOP=1 \
  --set bootstrap_user="$PGUSER" \
  --set migration_user="$OTA_DB_MIGRATION_USER" \
  --set migration_password="$OTA_DB_MIGRATION_PASSWORD" \
  --set api_user="$OTA_DB_API_USER" \
  --set api_password="$OTA_DB_API_PASSWORD" \
  --set worker_user="$OTA_DB_WORKER_USER" \
  --set worker_password="$OTA_DB_WORKER_PASSWORD" \
  --set audit_user="$OTA_DB_AUDIT_USER" \
  --set audit_password="$OTA_DB_AUDIT_PASSWORD" <<-'SQL'
SELECT set_config('ota.bootstrap.bootstrap_role', :'bootstrap_user', false);
SELECT set_config('ota.bootstrap.migration_role', :'migration_user', false);
SELECT set_config('ota.bootstrap.api_role', :'api_user', false);
SELECT set_config('ota.bootstrap.worker_role', :'worker_user', false);
SELECT set_config('ota.bootstrap.audit_role', :'audit_user', false);

DO $assert_distinct_roles$
DECLARE
  names TEXT[] := ARRAY[
    current_setting('ota.bootstrap.bootstrap_role'),
    current_setting('ota.bootstrap.migration_role'),
    current_setting('ota.bootstrap.api_role'),
    current_setting('ota.bootstrap.worker_role'),
    current_setting('ota.bootstrap.audit_role')
  ];
BEGIN
  IF (SELECT count(DISTINCT name) FROM unnest(names) AS name) <> array_length(names, 1) THEN
    RAISE EXCEPTION 'Bootstrap, migration, API, Worker and Audit roles must all be distinct';
  END IF;
END
$assert_distinct_roles$;

SELECT format(
  'CREATE ROLE %I LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS',
  :'migration_user', :'migration_password'
) WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'migration_user') \gexec

SELECT format(
  'CREATE ROLE %I LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS',
  :'api_user', :'api_password'
) WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'api_user') \gexec

SELECT format(
  'CREATE ROLE %I LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS',
  :'worker_user', :'worker_password'
) WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'worker_user') \gexec

SELECT format(
  'CREATE ROLE %I LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS',
  :'audit_user', :'audit_password'
) WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'audit_user') \gexec

-- Re-running the deployment job rotates passwords and converges unsafe role
-- attributes. Object ownership and memberships are independently rejected by
-- post-migration-grants.sql before any runtime privilege is issued.
SELECT format(
  'ALTER ROLE %I WITH LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS',
  :'migration_user', :'migration_password'
) \gexec
SELECT format(
  'ALTER ROLE %I WITH LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS',
  :'api_user', :'api_password'
) \gexec
SELECT format(
  'ALTER ROLE %I WITH LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS',
  :'worker_user', :'worker_password'
) \gexec
SELECT format(
  'ALTER ROLE %I SET idle_in_transaction_session_timeout = %L',
  :'worker_user', '60s'
) \gexec
SELECT format(
  'ALTER ROLE %I SET lock_timeout = %L',
  :'worker_user', '5s'
) \gexec
SELECT format(
  'ALTER ROLE %I WITH LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS',
  :'audit_user', :'audit_password'
) \gexec

SELECT format('REVOKE ALL PRIVILEGES ON DATABASE %I FROM PUBLIC', current_database()) \gexec
SELECT format('REVOKE ALL PRIVILEGES ON DATABASE %I FROM %I', current_database(), :'migration_user') \gexec
SELECT format('REVOKE ALL PRIVILEGES ON DATABASE %I FROM %I', current_database(), :'api_user') \gexec
SELECT format('REVOKE ALL PRIVILEGES ON DATABASE %I FROM %I', current_database(), :'worker_user') \gexec
SELECT format('REVOKE ALL PRIVILEGES ON DATABASE %I FROM %I', current_database(), :'audit_user') \gexec
SELECT format(
  'GRANT CONNECT, CREATE, TEMPORARY ON DATABASE %I TO %I',
  current_database(), :'migration_user'
) \gexec
SELECT format('GRANT CONNECT ON DATABASE %I TO %I', current_database(), :'api_user') \gexec
SELECT format('GRANT CONNECT ON DATABASE %I TO %I', current_database(), :'worker_user') \gexec
SELECT format('GRANT CONNECT ON DATABASE %I TO %I', current_database(), :'audit_user') \gexec

-- PostgreSQL 14 and older commonly grant CREATE on public to PUBLIC by
-- default. Close both that inherited path and any historical direct runtime
-- grants. USAGE may remain available; no application role may create objects
-- outside the migration-owned schemas.
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
SELECT format('REVOKE CREATE ON SCHEMA public FROM %I', :'api_user') \gexec
SELECT format('REVOKE CREATE ON SCHEMA public FROM %I', :'worker_user') \gexec
SELECT format('REVOKE CREATE ON SCHEMA public FROM %I', :'audit_user') \gexec

SELECT format('CREATE SCHEMA flyway AUTHORIZATION %I', :'migration_user')
 WHERE NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'flyway') \gexec

DO $assert_flyway_owner$
DECLARE
  expected_owner TEXT := current_setting('ota.bootstrap.migration_role');
  actual_owner TEXT;
BEGIN
  SELECT pg_get_userbyid(nspowner)
    INTO actual_owner
    FROM pg_namespace
   WHERE nspname = 'flyway';

  IF actual_owner IS DISTINCT FROM expected_owner THEN
    RAISE EXCEPTION 'flyway schema owner must be %, got %', expected_owner, actual_owner;
  END IF;
END
$assert_flyway_owner$;

REVOKE ALL PRIVILEGES ON SCHEMA flyway FROM PUBLIC;
SQL
