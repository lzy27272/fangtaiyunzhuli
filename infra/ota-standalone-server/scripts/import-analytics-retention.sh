#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

if [[ ${EUID} -ne 0 ]]; then
  echo 'RUN_AS_ROOT_REQUIRED' >&2
  exit 2
fi

analytics_root=/var/lib/sifangguan-ota/analytics-retention
spool_dir=${analytics_root}/spool
pending_file=${spool_dir}/facts.pending.b64
lock_file=${spool_dir}/import.lock
runtime_env=/etc/sifangguan-ota/runtime.env

test "$(readlink -m "${analytics_root}")" = "${analytics_root}"
install -d -m 0700 -o sifangguan-ota -g sifangguan-ota "${spool_dir}"
exec 9>"${lock_file}"
flock -n 9 || exit 0

if [[ -s ${pending_file} ]]; then
  batch_file="${spool_dir}/facts.$(date '+%Y%m%dT%H%M%S').${RANDOM}.b64"
  mv -- "${pending_file}" "${batch_file}"
  chown root:root "${batch_file}"
  chmod 0600 "${batch_file}"
fi

shopt -s nullglob
batches=("${spool_dir}"/facts.*.b64 "${spool_dir}"/facts.*.retry)
for batch_file in "${batches[@]}"; do
  [[ -s ${batch_file} ]] || { rm -f -- "${batch_file}"; continue; }
  case "${batch_file}" in
    "${spool_dir}"/facts.*.b64|"${spool_dir}"/facts.*.retry) ;;
    *) echo 'ANALYTICS_BATCH_PATH_UNSAFE' >&2; exit 2 ;;
  esac
  retry_file="${batch_file%.b64}.retry"
  if [[ ${batch_file} != *.retry ]]; then
    mv -- "${batch_file}" "${retry_file}"
    batch_file=${retry_file}
  fi
  # The queue directory remains 0700. Root reads the batch and feeds it over
  # stdin; the postgres OS account never receives filesystem access to the
  # encrypted-evidence tree or spool directory.
  {
    printf '%s\n' \
      'BEGIN;' \
      'CREATE TEMP TABLE analytics_ingest_batch (payload_base64 text NOT NULL) ON COMMIT DROP;' \
      '\copy analytics_ingest_batch (payload_base64) FROM STDIN WITH (FORMAT text)'
    sed '/^$/d' "${batch_file}"
    printf '%s\n' \
      '\.' \
      'SELECT count(*) AS accepted_events FROM analytics_ingest_batch b CROSS JOIN LATERAL ota_analytics.ingest_base64_event(b.payload_base64) accepted WHERE accepted;' \
      'COMMIT;'
  } | sudo -u postgres psql --dbname hotel_ai_os --set ON_ERROR_STOP=1
  rm -f -- "${batch_file}"
done

target_decisions=/var/lib/sifangguan-ota/occupancy-targets.json
if [[ -f ${target_decisions} ]]; then
  test "$(readlink -f "${target_decisions}")" = "${target_decisions}"
  {
    printf '%s\n' 'BEGIN;' \
      'CREATE TEMP TABLE occupancy_target_batch (payload_base64 text NOT NULL) ON COMMIT DROP;' \
      '\copy occupancy_target_batch (payload_base64) FROM STDIN WITH (FORMAT text)'
    base64 --wrap=0 -- "${target_decisions}"
    printf '\n%s\n' '\.' \
      "SELECT ota_analytics.archive_occupancy_targets(convert_from(decode(payload_base64, 'base64'), 'UTF8')::jsonb) FROM occupancy_target_batch;" \
      'COMMIT;'
  } | sudo -u postgres psql -X --dbname hotel_ai_os --set ON_ERROR_STOP=1
fi

sudo -u postgres psql --dbname hotel_ai_os --set ON_ERROR_STOP=1 <<'SQL'
SELECT ota_analytics.refresh_rollups();
SELECT ota_analytics.refresh_occupancy_reviews();
SELECT ota_analytics.apply_retention();
SQL

# Only aggregate occupancy data is exported; the API never gains a database
# credential or access to guest/order details. Atomic replace keeps readers safe.
review_tmp="${analytics_root}/.occupancy-history.${RANDOM}.tmp"
sudo -u postgres psql -X --dbname hotel_ai_os --tuples-only --no-align \
  --set ON_ERROR_STOP=1 --command 'SELECT ota_analytics.occupancy_review_export();' >"${review_tmp}"
chown sifangguan-ota:sifangguan-ota "${review_tmp}"
chmod 0600 "${review_tmp}"
mv -f -- "${review_tmp}" "${analytics_root}/occupancy-history.json"

import_summary="$(sudo -u postgres psql --dbname hotel_ai_os \
  --tuples-only --no-align --field-separator='|' --set ON_ERROR_STOP=1 \
  --command "
    SELECT
      to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"'),
      (SELECT count(*) FROM ota_analytics.hourly_operating_fact),
      (SELECT count(*) FROM ota_analytics.daily_operating_fact),
      (SELECT count(*) FROM ota_analytics.period_rollup),
      (SELECT count(*) FROM ota_analytics.ingest_error);
  ")"
IFS='|' read -r imported_at hourly_count daily_count rollup_count error_count \
  <<<"${import_summary}"
status_tmp="${analytics_root}/.import-status.${RANDOM}.tmp"
printf '{"status":"READY","lastImportedAt":"%s","hourlyFactCount":%s,"dailyFactCount":%s,"rollupCount":%s,"ingestErrorCount":%s}\n' \
  "${imported_at}" "${hourly_count}" "${daily_count}" "${rollup_count}" \
  "${error_count}" >"${status_tmp}"
chown sifangguan-ota:sifangguan-ota "${status_tmp}"
chmod 0600 "${status_tmp}"
mv -f -- "${status_tmp}" "${analytics_root}/import-status.json"

raw_days=90
if [[ -r ${runtime_env} ]]; then
  configured_raw_days="$(sed -n 's/^OTA_ANALYTICS_RAW_RETENTION_DAYS=//p' "${runtime_env}" | tail -n 1)"
  if [[ ${configured_raw_days} =~ ^[0-9]+$ ]] \
      && (( configured_raw_days >= 30 && configured_raw_days <= 90 )); then
    raw_days=${configured_raw_days}
  fi
fi
raw_root=${analytics_root}/raw
if [[ -d ${raw_root} ]]; then
  test "$(readlink -m "${raw_root}")" = "${raw_root}"
  find "${raw_root}" -xdev -type f -name '*.json.enc' \
    -mtime "+${raw_days}" -delete
  find "${raw_root}" -xdev -depth -type d -empty -delete
fi

printf '%s\n' 'ANALYTICS_IMPORT_OK'
