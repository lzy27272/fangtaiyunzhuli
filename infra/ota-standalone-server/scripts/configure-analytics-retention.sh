#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

if [[ ${EUID} -ne 0 ]]; then
  echo 'RUN_AS_ROOT_REQUIRED' >&2
  exit 2
fi

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
asset_root="$(cd -- "${script_dir}/.." && pwd)"
runtime_env=/etc/sifangguan-ota/runtime.env
analytics_root=/var/lib/sifangguan-ota/analytics-retention

command -v psql >/dev/null
sudo -u postgres psql --dbname hotel_ai_os --set ON_ERROR_STOP=1 \
  --file "${asset_root}/sql/analytics-retention.sql"

install -d -m 0700 -o sifangguan-ota -g sifangguan-ota \
  "${analytics_root}" "${analytics_root}/spool" "${analytics_root}/raw"
install -d -m 0755 -o root -g root /usr/local/lib/sifangguan-ota
install -m 0750 -o root -g root \
  "${script_dir}/import-analytics-retention.sh" \
  /usr/local/lib/sifangguan-ota/import-analytics-retention.sh
install -m 0644 -o root -g root \
  "${asset_root}/systemd/sifangguan-ota-analytics-import.service" \
  /etc/systemd/system/sifangguan-ota-analytics-import.service
install -m 0644 -o root -g root \
  "${asset_root}/systemd/sifangguan-ota-analytics-import.timer" \
  /etc/systemd/system/sifangguan-ota-analytics-import.timer

set_env_value() {
  local key=$1 value=$2 next
  next="${runtime_env}.analytics-next"
  awk -v key="${key}" -v value="${value}" '
    BEGIN { replaced = 0 }
    index($0, key "=") == 1 {
      if (!replaced) print key "=" value
      replaced = 1
      next
    }
    { print }
    END { if (!replaced) print key "=" value }
  ' "${runtime_env}" >"${next}"
  chown root:sifangguan-ota "${next}"
  chmod 0640 "${next}"
  mv -f -- "${next}" "${runtime_env}"
}

raw_key="$(sed -n 's/^OTA_ANALYTICS_RAW_EVIDENCE_KEY=//p' "${runtime_env}" | tail -n 1)"
if [[ -z ${raw_key} ]]; then
  raw_key="$(openssl rand -base64 32 | tr '+/' '-_' | tr -d '=\n')"
fi
set_env_value OTA_ANALYTICS_RETENTION_ENABLED true
set_env_value OTA_ANALYTICS_RETENTION_ROOT "${analytics_root}"
set_env_value OTA_ANALYTICS_RAW_RETENTION_DAYS 90
set_env_value OTA_ANALYTICS_RAW_EVIDENCE_KEY "${raw_key}"
unset raw_key

bash -n /usr/local/lib/sifangguan-ota/import-analytics-retention.sh
systemd-analyze verify \
  /etc/systemd/system/sifangguan-ota-analytics-import.service \
  /etc/systemd/system/sifangguan-ota-analytics-import.timer
systemctl daemon-reload
systemctl enable --now sifangguan-ota-analytics-import.timer
systemctl restart sifangguan-ota-api.service
systemctl start sifangguan-ota-analytics-import.service
systemctl is-active sifangguan-ota-analytics-import.timer

printf '%s\n' 'ANALYTICS_RETENTION_CONFIGURED'
