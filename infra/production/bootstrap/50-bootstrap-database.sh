#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

secret_state=/etc/hotel-ai-os/bootstrap-secrets.env

if test -f "${secret_state}"; then
  # This file is root-owned, mode 0600, and contains only generated hex values.
  # shellcheck disable=SC1090
  source "${secret_state}"
else
  DB_OWNER_SECRET="$(openssl rand -hex 24)"
  DB_APP_SECRET="$(openssl rand -hex 24)"
  LOCAL_JWT_SECRET="$(openssl rand -hex 32)"
  DUMMY_MIGRATION_SECRET="$(openssl rand -hex 24)"

  secret_tmp="$(mktemp)"
  {
    printf 'DB_OWNER_SECRET=%s\n' "${DB_OWNER_SECRET}"
    printf 'DB_APP_SECRET=%s\n' "${DB_APP_SECRET}"
    printf 'LOCAL_JWT_SECRET=%s\n' "${LOCAL_JWT_SECRET}"
    printf 'DUMMY_MIGRATION_SECRET=%s\n' "${DUMMY_MIGRATION_SECRET}"
  } >"${secret_tmp}"
  install -o root -g root -m 0600 "${secret_tmp}" "${secret_state}"
  rm -f "${secret_tmp}"
fi

sudo -u postgres psql --dbname postgres --set ON_ERROR_STOP=1 <<SQL
DO \$\$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'hotel_ai_os_owner') THEN
    CREATE ROLE hotel_ai_os_owner LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'hotel_ai_os_app') THEN
    CREATE ROLE hotel_ai_os_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
  END IF;
END
\$\$;

ALTER ROLE hotel_ai_os_owner
  WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS
  CONNECTION LIMIT 5 PASSWORD '${DB_OWNER_SECRET}';
ALTER ROLE hotel_ai_os_app
  WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS
  CONNECTION LIMIT 40 PASSWORD '${DB_APP_SECRET}';
SQL

if ! sudo -u postgres psql --dbname postgres --tuples-only --no-align \
    --command "select 1 from pg_database where datname = 'hotel_ai_os'" |
    grep -qx '1'; then
  sudo -u postgres createdb --owner hotel_ai_os_owner hotel_ai_os
fi

sudo -u postgres psql --dbname hotel_ai_os --set ON_ERROR_STOP=1 <<'SQL'
REVOKE CONNECT ON DATABASE hotel_ai_os FROM PUBLIC;
GRANT CONNECT ON DATABASE hotel_ai_os TO hotel_ai_os_owner, hotel_ai_os_app;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT USAGE, CREATE ON SCHEMA public TO hotel_ai_os_owner;
SQL

migration_tmp="$(mktemp)"
cat >"${migration_tmp}" <<EOF
DB_URL=jdbc:postgresql://127.0.0.1:5432/hotel_ai_os
DB_USERNAME=hotel_ai_os_app
DB_PASSWORD=${DB_APP_SECRET}
DB_MIGRATION_USERNAME=hotel_ai_os_owner
DB_MIGRATION_PASSWORD=${DB_OWNER_SECRET}
DB_POOL_SIZE=12
SPRING_FLYWAY_ENABLED=true
DEV_HEADER_AUTH_ENABLED=false
DB_RLS_ENABLED=true
LOCAL_LOGIN_ENABLED=true
LOCAL_LOGIN_SECRET=${LOCAL_JWT_SECRET}
LOCAL_LOGIN_ISSUER=hotel-ai-os-pilot
LOCAL_LOGIN_TOKEN_TTL_HOURS=8
AUTOMATION_WORKER_ENABLED=false
WORK_EXPECTATION_SLA_SCHEDULER_ENABLED=false
ATTACHMENT_STORAGE_ROOT=/var/lib/hotel-ai-os/attachments
ATTACHMENT_SCAN_COMMAND_PATH=/usr/bin/clamscan
ATTACHMENT_SCAN_COMMAND_ARGUMENTS=--no-summary|{file}
ATTACHMENT_SCAN_ALLOW_SANITIZED_IMAGE_FALLBACK=false
WEB_ALLOWED_ORIGINS=https://www.sfgzt.cn
WECOM_ENABLED=false
WECOM_WORKER_ENABLED=false
WECOM_BOT_ACTIONS_ENABLED=false
EOF
install -o root -g root -m 0600 "${migration_tmp}" /etc/hotel-ai-os/migration.env
rm -f "${migration_tmp}"

runtime_tmp="$(mktemp)"
cat >"${runtime_tmp}" <<EOF
DB_URL=jdbc:postgresql://127.0.0.1:5432/hotel_ai_os
DB_USERNAME=hotel_ai_os_app
DB_PASSWORD=${DB_APP_SECRET}
DB_MIGRATION_USERNAME=hotel_ai_os_app
DB_MIGRATION_PASSWORD=${DUMMY_MIGRATION_SECRET}
DB_POOL_SIZE=12
SPRING_FLYWAY_ENABLED=false
DEV_HEADER_AUTH_ENABLED=false
DB_RLS_ENABLED=true
LOCAL_LOGIN_ENABLED=true
LOCAL_LOGIN_SECRET=${LOCAL_JWT_SECRET}
LOCAL_LOGIN_ISSUER=hotel-ai-os-pilot
LOCAL_LOGIN_TOKEN_TTL_HOURS=8
AUTOMATION_WORKER_ENABLED=false
WORK_EXPECTATION_SLA_SCHEDULER_ENABLED=false
ATTACHMENT_STORAGE_ROOT=/var/lib/hotel-ai-os/attachments
ATTACHMENT_SCAN_COMMAND_PATH=/usr/bin/clamscan
ATTACHMENT_SCAN_COMMAND_ARGUMENTS=--no-summary|{file}
ATTACHMENT_SCAN_ALLOW_SANITIZED_IMAGE_FALLBACK=false
WEB_ALLOWED_ORIGINS=https://www.sfgzt.cn
WECOM_ENABLED=false
WECOM_WORKER_ENABLED=false
WECOM_BOT_ACTIONS_ENABLED=false
EOF
install -o root -g hotelai -m 0640 "${runtime_tmp}" /etc/hotel-ai-os/core-api.env
rm -f "${runtime_tmp}"

printf '%s\n' 'DATABASE_BOOTSTRAP_COMPLETE'
sudo -u postgres psql --dbname postgres --tuples-only --no-align --command \
  "select rolname || '|' || rolsuper || '|' || rolcreatedb || '|' ||
          rolcreaterole || '|' || rolinherit || '|' || rolbypassrls
     from pg_roles
    where rolname in ('hotel_ai_os_owner', 'hotel_ai_os_app')
    order by rolname;"
sudo -u postgres psql --dbname postgres --tuples-only --no-align --command \
  "select datname || '|' || pg_get_userbyid(datdba)
     from pg_database where datname = 'hotel_ai_os';"
