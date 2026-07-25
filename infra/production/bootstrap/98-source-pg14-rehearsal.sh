#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

credential_payload="$(mktemp)"
pgpass_file="$(mktemp)"
source_counts_before="$(mktemp)"
source_counts_after="$(mktemp)"
restore_counts="$(mktemp)"
plain_dump="$(mktemp)"
backup_dir=/var/backups/hotel-ai-os/postgres
encrypted_backup="${backup_dir}/source-pg14-rehearsal-20260723.dump.enc"
checksum_file="${encrypted_backup}.sha256"
backup_key=/etc/hotel-ai-os/backup-encryption.key
rehearsal_database=hotel_ai_os_source_rehearsal

drop_rehearsal_database() {
  sudo -u postgres psql --dbname postgres --quiet --command \
    "select pg_terminate_backend(pid)
       from pg_stat_activity
      where datname = '${rehearsal_database}' and pid <> pg_backend_pid();" \
    >/dev/null 2>&1 || true
  sudo -u postgres dropdb --if-exists "${rehearsal_database}" \
    >/dev/null 2>&1 || true
}

cleanup() {
  drop_rehearsal_database
  rm -f \
    "${credential_payload}" \
    "${pgpass_file}" \
    "${source_counts_before}" \
    "${source_counts_after}" \
    "${restore_counts}" \
    "${plain_dump}"
}
trap cleanup EXIT INT TERM

test ! -e "${encrypted_backup}"
test ! -e "${checksum_file}"
cat >"${credential_payload}"

source_user="$(jq --exit-status --raw-output '.username' "${credential_payload}")"
source_password="$(jq --exit-status --raw-output '.password' "${credential_payload}")"
source_database="$(jq --exit-status --raw-output '.database' "${credential_payload}")"

[[ "${source_user}" =~ ^[a-zA-Z_][a-zA-Z0-9_]*$ ]]
[[ "${source_database}" =~ ^[a-zA-Z_][a-zA-Z0-9_]*$ ]]
test -n "${source_password}"
test "${source_password}" != 'null'

escaped_password="${source_password//\\/\\\\}"
escaped_password="${escaped_password//:/\\:}"
printf '127.0.0.1:55433:%s:%s:%s\n' \
  "${source_database}" "${source_user}" "${escaped_password}" \
  >"${pgpass_file}"
chown postgres:postgres "${pgpass_file}"
chmod 0600 "${pgpass_file}"
source_password=''
escaped_password=''

source_psql=(
  sudo -u postgres
  env "PGPASSFILE=${pgpass_file}"
  psql
  --host 127.0.0.1
  --port 55433
  --username "${source_user}"
  --dbname "${source_database}"
  --tuples-only
  --no-align
  --quiet
)

printf 'SOURCE_POSTGRES_VERSION|'
"${source_psql[@]}" --command 'show server_version'

"${source_psql[@]}" \
  --field-separator='|' \
  --file /tmp/hotel-ai-os-release/table-row-counts.sql \
  >"${source_counts_before}"

sudo -u postgres env "PGPASSFILE=${pgpass_file}" pg_dump \
  --host 127.0.0.1 \
  --port 55433 \
  --username "${source_user}" \
  --dbname "${source_database}" \
  --format=custom \
  --compress=9 \
  >"${plain_dump}"

"${source_psql[@]}" \
  --field-separator='|' \
  --file /tmp/hotel-ai-os-release/table-row-counts.sql \
  >"${source_counts_after}"

source_stable=false
if cmp --silent "${source_counts_before}" "${source_counts_after}"; then
  source_stable=true
fi

drop_rehearsal_database
sudo -u postgres createdb \
  --owner hotel_ai_os_owner \
  "${rehearsal_database}"
sudo -u postgres pg_restore \
  --exit-on-error \
  --single-transaction \
  --dbname "${rehearsal_database}" \
  <"${plain_dump}"

sudo -u postgres psql \
  --dbname "${rehearsal_database}" \
  --tuples-only \
  --no-align \
  --quiet \
  --field-separator='|' \
  --file /tmp/hotel-ai-os-release/table-row-counts.sql \
  >"${restore_counts}"

if test "${source_stable}" = true; then
  cmp --silent "${source_counts_before}" "${restore_counts}"
  printf '%s\n' 'ROW_COUNTS_EXACT_MATCH'
else
  printf '%s\n' 'SOURCE_CHANGED_DURING_ONLINE_REHEARSAL'
fi

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
    select 'restore_database_size|' || pg_database_size(current_database());
  "

if test ! -f "${backup_key}"; then
  openssl rand -hex 32 >"${backup_key}"
  chown root:root "${backup_key}"
  chmod 0600 "${backup_key}"
fi

openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -salt \
  -in "${plain_dump}" \
  -out "${encrypted_backup}" \
  -pass "file:${backup_key}"
chmod 0600 "${encrypted_backup}"
sha256sum "${encrypted_backup}" >"${checksum_file}"
chmod 0600 "${checksum_file}"

drop_rehearsal_database
trap - EXIT INT TERM
rm -f \
  "${credential_payload}" \
  "${pgpass_file}" \
  "${source_counts_before}" \
  "${source_counts_after}" \
  "${restore_counts}" \
  "${plain_dump}"

printf '%s\n' 'SOURCE_PG14_REHEARSAL_OK'
stat -c '%U:%G:%a:%s:%n' "${encrypted_backup}" "${checksum_file}" "${backup_key}"
sha256sum --check "${checksum_file}"
