#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

credential_file=/etc/hotel-ai-os/pilot-accounts.tsv
work_dir=/tmp/hotel-ai-os-account-bootstrap

cleanup() {
  rm -f \
    "${work_dir}/postgresql-driver.jar" \
    "${work_dir}/ProductionPilotAccountBootstrap.class" \
    "${work_dir}/pilot-accounts.tsv"
  rmdir "${work_dir}" 2>/dev/null || true
}
trap cleanup EXIT

test ! -e "${credential_file}"
install -d -o root -g root -m 0700 "${work_dir}"

# shellcheck disable=SC1091
source /etc/hotel-ai-os/bootstrap-secrets.env

jdbc_entry="$(unzip -Z1 /opt/hotel-ai-os/current/core-api.jar |
  grep -E '^BOOT-INF/lib/postgresql-[^/]+[.]jar$' |
  head -n 1)"
test -n "${jdbc_entry}"
unzip -p /opt/hotel-ai-os/current/core-api.jar "${jdbc_entry}" \
  >"${work_dir}/postgresql-driver.jar"

install -o root -g root -m 0600 \
  /tmp/hotel-ai-os-release/ProductionPilotAccountBootstrap.class \
  "${work_dir}/ProductionPilotAccountBootstrap.class"

PILOT_DB_OWNER=hotel_ai_os_owner \
PILOT_DB_OWNER_PASSWORD="${DB_OWNER_SECRET}" \
java -cp "${work_dir}:${work_dir}/postgresql-driver.jar" \
  ProductionPilotAccountBootstrap \
  jdbc:postgresql://127.0.0.1:5432/hotel_ai_os \
  "${work_dir}/pilot-accounts.tsv"

install -o root -g root -m 0600 \
  "${work_dir}/pilot-accounts.tsv" \
  "${credential_file}"

printf '%s\n' 'PILOT_ACCOUNT_BOOTSTRAP_COMPLETE'
sudo -u postgres psql --dbname hotel_ai_os --tuples-only --no-align --command \
  "select count(*) filter (where password_hash is not null and lower(login_name) not like 'system.%'),
          count(*) filter (where password_hash is not null and lower(login_name) like 'system.%')
     from user_account;"
