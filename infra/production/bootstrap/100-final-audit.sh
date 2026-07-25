#!/usr/bin/env bash
set -Eeuo pipefail

printf '%s\n' 'SERVICES'
for service_name in ssh postgresql fail2ban clamav-freshclam unattended-upgrades hotel-ai-os-core-api; do
  printf '%s|%s|%s\n' \
    "${service_name}" \
    "$(systemctl is-enabled "${service_name}" 2>/dev/null || true)" \
    "$(systemctl is-active "${service_name}")"
done
printf 'caddy|%s|%s\n' \
  "$(systemctl is-enabled caddy 2>/dev/null || true)" \
  "$(systemctl is-active caddy 2>/dev/null || true)"

printf '%s\n' 'API'
curl --fail --silent --show-error http://127.0.0.1:18080/actuator/health
printf '\n'

printf '%s\n' 'DATABASE'
sudo -u postgres psql --dbname hotel_ai_os --tuples-only --no-align --command "
  select 'flyway|' || version || '|' || success
    from flyway_schema_history
   where installed_rank = (select max(installed_rank) from flyway_schema_history);
  select 'tables|' || count(*)
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind in ('r', 'p');
  select 'forced_rls|' || count(*)
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind in ('r', 'p')
     and c.relforcerowsecurity;
"

printf '%s\n' 'SECURE_FILES'
stat -c '%U:%G:%a:%s:%n' \
  /etc/hotel-ai-os/bootstrap-secrets.env \
  /etc/hotel-ai-os/migration.env \
  /etc/hotel-ai-os/core-api.env \
  /etc/hotel-ai-os/pilot-accounts.tsv \
  /etc/hotel-ai-os/backup-encryption.key

printf '%s\n' 'NETWORK'
sudo ss -lntp
sudo ufw status verbose
sudo fail2ban-client status sshd

printf '%s\n' 'AUTOMATION'
systemctl is-enabled hotel-ai-os-postgres-backup.timer
systemctl is-active hotel-ai-os-postgres-backup.timer
systemctl is-enabled hotel-ai-os-health-check.timer
systemctl is-active hotel-ai-os-health-check.timer
systemctl list-timers \
  hotel-ai-os-postgres-backup.timer \
  hotel-ai-os-health-check.timer \
  --no-pager

latest_backup="$(find /var/backups/hotel-ai-os/postgres \
  -maxdepth 1 -type f -name 'hotel_ai_os-auto-*.dump.enc' \
  -printf '%T@ %p\n' | sort -nr | head -n 1 | cut -d' ' -f2-)"
sha256sum --check "${latest_backup}.sha256"
stat -c '%U:%G:%a:%s:%n' "${latest_backup}" "${latest_backup}.sha256"

printf '%s\n' 'RESOURCES'
df -h /
free -h
swapon --show

test ! -e /tmp/hotel-ai-os-release
if test -f /var/run/reboot-required; then
  printf '%s\n' 'REBOOT_REQUIRED'
  exit 1
fi
printf '%s\n' 'NO_REBOOT_REQUIRED'
printf '%s\n' 'FINAL_SERVER_AUDIT_OK'
