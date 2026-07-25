#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

backup_dir=/var/backups/hotel-ai-os/postgres
backup_file="${backup_dir}/hotel_ai_os-pilot7-baseline.dump"
checksum_file="${backup_file}.sha256"
rehearsal_database=hotel_ai_os_restore_rehearsal

cleanup() {
  sudo -u postgres psql --dbname postgres --quiet --command \
    "select pg_terminate_backend(pid)
       from pg_stat_activity
      where datname = '${rehearsal_database}' and pid <> pg_backend_pid();" \
    >/dev/null 2>&1 || true
  sudo -u postgres dropdb --if-exists "${rehearsal_database}" \
    >/dev/null 2>&1 || true
}
trap cleanup EXIT

test ! -e "${backup_file}"
test ! -e "${checksum_file}"

sudo -u postgres pg_dump \
  --format=custom \
  --compress=9 \
  --dbname hotel_ai_os \
  >"${backup_file}"
sha256sum "${backup_file}" >"${checksum_file}"

cleanup
sudo -u postgres createdb \
  --owner hotel_ai_os_owner \
  "${rehearsal_database}"
sudo -u postgres pg_restore \
  --exit-on-error \
  --single-transaction \
  --dbname "${rehearsal_database}" \
  <"${backup_file}"

sudo -u postgres psql \
  --dbname "${rehearsal_database}" \
  --tuples-only \
  --no-align \
  --set ON_ERROR_STOP=1 \
  --command "
    select 'restore_flyway|' || version || '|' || success
      from flyway_schema_history
     where installed_rank = (select max(installed_rank) from flyway_schema_history);
    select 'restore_tables|' || count(*)
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind in ('r', 'p');
    select 'restore_seed|' ||
           (select count(*) from tenant) || '|' ||
           (select count(*) from user_account) || '|' ||
           (select count(*) from app_role) || '|' ||
           (select count(*) from work_package_definition);
  "

cleanup
trap - EXIT

printf '%s\n' 'BACKUP_RESTORE_REHEARSAL_OK'
stat -c '%U:%G:%a:%s:%n' "${backup_file}" "${checksum_file}"
sha256sum --check "${checksum_file}"
