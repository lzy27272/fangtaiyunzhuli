#!/usr/bin/env bash
set -Eeuo pipefail

for service_name in ssh postgresql fail2ban clamav-freshclam hotel-ai-os-core-api; do
  test "$(systemctl is-active "${service_name}")" = 'active'
done

curl --fail --silent --show-error \
  http://127.0.0.1:18080/actuator/health >/dev/null

flyway_state="$(sudo -u postgres psql \
  --dbname hotel_ai_os \
  --tuples-only \
  --no-align \
  --command "
    select version || '|' || success
      from flyway_schema_history
     where installed_rank = (select max(installed_rank) from flyway_schema_history)
  ")"
test "${flyway_state}" = '22|true'

if ss -lnt | awk 'NR > 1 {print $4}' |
    grep -E '(^0[.]0[.]0[.]0:5432$|^\[::\]:5432$|^0[.]0[.]0[.]0:18080$|^\[::\]:18080$)' \
    >/dev/null; then
  printf '%s\n' 'Private database or API port is exposed publicly.' >&2
  exit 1
fi

root_usage="$(df --output=pcent / | tail -n 1 | tr -dc '0-9')"
test -n "${root_usage}"
test "${root_usage}" -lt 85

latest_backup="$(find /var/backups/hotel-ai-os/postgres \
  -maxdepth 1 -type f -name 'hotel_ai_os-auto-*.dump.enc' \
  -printf '%T@ %p\n' | sort -nr | head -n 1 | cut -d' ' -f2-)"
test -n "${latest_backup}"
find "${latest_backup}" -mmin -1560 -print -quit | grep -q .
sha256sum --check "${latest_backup}.sha256" >/dev/null

printf 'HOTEL_AI_OS_HEALTH_OK flyway=%s root_usage=%s%% backup=%s\n' \
  "${flyway_state}" "${root_usage}" "$(basename "${latest_backup}")"
