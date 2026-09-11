#!/usr/bin/env bash
set -euo pipefail

if [[ ${EUID} -ne 0 ]]; then
  echo "RUN_AS_ROOT_REQUIRED" >&2
  exit 2
fi

archive="${SFG_OTA_RELEASE_ARCHIVE:-}"
commit="${SFG_OTA_RELEASE_COMMIT:-}"
expected_sha="${SFG_OTA_RELEASE_SHA256:-}"
release_root=/opt/sifangguan-ota/releases
current_link=/opt/sifangguan-ota/current
backup_root=/var/backups/sifangguan-ota/code-releases
runtime_env=/etc/sifangguan-ota/runtime.env
scheduler_pause_path=/run/sifangguan-ota/deployment-scheduler.pause
yilian_report_sources_path=/var/lib/sifangguan-ota/report-sources.json
yilian_repair_status_path=/var/lib/sifangguan-ota/yilian-cloud-repair-statuses.json
incoming_dir=""
listing_file=""
registry_listing_file=""
scheduler_pause_tmp=""
backup_dir=""
rollback_armed=false
pre_switch_recovery_armed=false
scheduler_pause_created=false

protected_paths=(
  /etc/sifangguan-ota/runtime.env
  /var/lib/sifangguan-ota/review-auth-state.json
  /var/lib/sifangguan-ota/review-auth-sessions.json
  /var/lib/sifangguan-ota/security-audit.jsonl
  /var/lib/sifangguan-ota/simulation-hotels.json
  "${yilian_report_sources_path}"
  /var/lib/sifangguan-ota/report-source-cookie-secrets.json
  /var/lib/sifangguan-ota/pms-login-secrets.json
  "${yilian_repair_status_path}"
  /var/lib/sifangguan-ota/ota-source-configs.json
  /var/lib/sifangguan-ota/ota-source-secrets.json
  /var/lib/sifangguan-ota/luopan-session-secrets.json
  /var/lib/sifangguan-ota/hot-selling-room-types.json
  /var/lib/sifangguan-ota/room-type-mappings.json
  /var/lib/sifangguan-ota/ota-room-type-catalogs.json
  /var/lib/sifangguan-ota/business-day-controls.json
  /var/lib/sifangguan-ota/luopan-browser-configs.json
  /var/lib/sifangguan-ota/luopan-session-secrets.json
  /var/lib/sifangguan-ota/wecom-configs.json
  /var/lib/sifangguan-ota/wecom-webhook-secrets.json
  /var/lib/sifangguan-ota/wecom-repair-bot-config.json
  /var/lib/sifangguan-ota/wecom-repair-bot-secrets.json
  /var/lib/sifangguan-ota/trusted-device-registry.json
)
cleanup_temporary_files() {
  if [[ ${scheduler_pause_created} == true ]]; then
    echo "DEPLOYMENT_SCHEDULER_REMAINS_PAUSED" >&2
  fi
  if [[ -n ${listing_file} && -f ${listing_file} ]]; then
    rm -f -- "${listing_file}"
  fi
  if [[ -n ${registry_listing_file} && -f ${registry_listing_file} ]]; then
    rm -f -- "${registry_listing_file}"
  fi
  if [[ -n ${scheduler_pause_tmp} \
    && ${scheduler_pause_tmp} == "${scheduler_pause_path}."* \
    && -f ${scheduler_pause_tmp} ]]; then
    rm -f -- "${scheduler_pause_tmp}"
  fi
  if [[ -n ${incoming_dir} \
    && ${incoming_dir} == "${release_root}/.incoming-"* \
    && -d ${incoming_dir} ]]; then
    rm -rf -- "${incoming_dir}"
  fi
}
trap cleanup_temporary_files EXIT

deployment_error_trap() {
  local exit_code=$?
  trap - ERR
  if [[ ${rollback_armed} == true ]]; then
    rollback_armed=false
    echo "DEPLOYMENT_COMMAND_FAILED_ROLLING_BACK" >&2
    if ! rollback_release; then
      echo "DEPLOYMENT_AUTOMATIC_ROLLBACK_FAILED" >&2
    fi
  elif [[ ${pre_switch_recovery_armed} == true ]]; then
    pre_switch_recovery_armed=false
    echo "DEPLOYMENT_PRE_SWITCH_FAILED_RECOVERING" >&2
    if ! recover_pre_switch_release; then
      echo "DEPLOYMENT_PRE_SWITCH_RECOVERY_FAILED" >&2
    fi
  fi
  exit "${exit_code}"
}
trap deployment_error_trap ERR

if [[ ! -f ${archive} \
  || ! ${commit} =~ ^[0-9a-f]{40}$ \
  || ! ${expected_sha} =~ ^[0-9a-f]{64}$ ]]; then
  echo "RELEASE_INPUT_INVALID" >&2
  exit 2
fi

actual_sha="$(sha256sum "${archive}" | awk '{print $1}')"
if [[ ${actual_sha} != "${expected_sha}" ]]; then
  echo "RELEASE_SHA256_MISMATCH" >&2
  exit 2
fi

listing_file="$(mktemp)"
tar -tzf "${archive}" > "${listing_file}"
if grep -Eq '(^/|(^|/)\.\.(/|$))' "${listing_file}"; then
  echo "RELEASE_ARCHIVE_PATH_UNSAFE" >&2
  exit 2
fi
if grep -Eiq \
  '(^|/)(\.git|\.uat-runtime|node_modules|tmp)(/|$)|(^|/)(credentials\.json|secret-key\.dpapi|review-auth-sessions\.json|security-audit\.jsonl|report-source-cookie-secrets\.json|pms-login-secrets\.json|luopan-session-secrets\.json|ota-source-secrets\.json|hot-selling-room-types\.json|room-type-mappings\.json|ota-room-type-catalogs\.json|wecom-webhook-secrets\.json|wecom-repair-bot-secrets\.json|trusted-device-registry(-[^/]+)?\.json|runtime\.env)$' \
  "${listing_file}"; then
  echo "RELEASE_ARCHIVE_FORBIDDEN_CONTENT" >&2
  exit 2
fi

release_dir="${release_root}/${commit}"
if [[ ! -d ${release_dir} ]]; then
  incoming_dir="${release_root}/.incoming-${commit}-$$"
  install -d -m 0755 "${incoming_dir}"
  tar \
    --extract \
    --gzip \
    --file "${archive}" \
    --directory "${incoming_dir}" \
    --no-same-owner \
    --no-same-permissions
  if find "${incoming_dir}" -type l -print -quit | grep -q .; then
    echo "RELEASE_SYMLINK_NOT_ALLOWED" >&2
    exit 2
  fi
  printf '%s\n' "${commit}" > "${incoming_dir}/.release-commit"
  mv -T "${incoming_dir}" "${release_dir}"
  incoming_dir=""
fi

if [[ ! -f ${release_dir}/.release-commit \
  || "$(cat "${release_dir}/.release-commit")" != "${commit}" \
  || ! -f ${release_dir}/apps/ota-standalone-web/dist/index.html \
  || ! -f ${release_dir}/tools/uat/ota-standalone-review-api.mjs \
  || ! -f ${release_dir}/infra/ota-standalone-server/scripts/verify-yilian-source-contract-migration.mjs ]]; then
  echo "RELEASE_CONTENT_INVALID" >&2
  exit 2
fi

previous_release=""
if [[ -e ${current_link} && ! -L ${current_link} ]]; then
  echo "CURRENT_RELEASE_POINTER_UNSAFE" >&2
  exit 2
fi
if [[ -L ${current_link} ]]; then
  previous_release="$(readlink -f "${current_link}" || true)"
  if [[ -z ${previous_release} \
    || ! -d ${previous_release} \
    || ${previous_release} != "${release_root}/"* ]]; then
    echo "PREVIOUS_RELEASE_POINTER_UNSAFE" >&2
    exit 2
  fi
fi

ensure_pseudonym_secret_key() {
  if [[ ! -f ${runtime_env} ]]; then
    echo "RUNTIME_ENV_NOT_FOUND" >&2
    return 1
  fi
  key_count="$(grep -Ec '^OTA_REVIEW_PSEUDONYM_SECRET_KEY=' "${runtime_env}" || true)"
  if [[ ${key_count} -gt 1 ]]; then
    echo "PSEUDONYM_SECRET_KEY_DUPLICATE" >&2
    return 1
  fi
  if [[ ${key_count} -eq 1 ]]; then
    configured_key="$(sed -n 's/^OTA_REVIEW_PSEUDONYM_SECRET_KEY=//p' "${runtime_env}")"
    if [[ ! ${configured_key} =~ ^[A-Za-z0-9_-]{43}$ ]]; then
      unset configured_key
      echo "PSEUDONYM_SECRET_KEY_INVALID" >&2
      return 1
    fi
    unset configured_key
    return 0
  fi

  generated_key="$(openssl rand -base64 32 | tr '+/' '-_' | tr -d '=\n')"
  if [[ ! ${generated_key} =~ ^[A-Za-z0-9_-]{43}$ ]]; then
    unset generated_key
    echo "PSEUDONYM_SECRET_KEY_GENERATION_FAILED" >&2
    return 1
  fi
  runtime_env_tmp="${runtime_env}.pseudonym-$$"
  cp --preserve=mode,ownership,timestamps "${runtime_env}" "${runtime_env_tmp}"
  printf 'OTA_REVIEW_PSEUDONYM_SECRET_KEY=%s\n' "${generated_key}" \
    >> "${runtime_env_tmp}"
  mv -Tf "${runtime_env_tmp}" "${runtime_env}"
  unset generated_key runtime_env_tmp
}

protected_fingerprint() {
  for protected_path in "${protected_paths[@]}"; do
    if [[ -L ${protected_path} \
      || ( -e ${protected_path} && ! -f ${protected_path} ) ]]; then
      echo "PROTECTED_RUNTIME_PATH_UNSAFE" >&2
      return 1
    elif [[ -f ${protected_path} ]]; then
      printf 'PRESENT %s ' "${protected_path}"
      sha256sum "${protected_path}" | awk '{print $1}'
    else
      printf 'ABSENT %s\n' "${protected_path}"
    fi
  done | sha256sum | awk '{print $1}'
}

is_yilian_migration_path() {
  [[ $1 == "${yilian_report_sources_path}" \
    || $1 == "${yilian_repair_status_path}" ]]
}

protected_fingerprint_without_yilian_migration() {
  for protected_path in "${protected_paths[@]}"; do
    if is_yilian_migration_path "${protected_path}"; then
      continue
    fi
    if [[ -L ${protected_path} \
      || ( -e ${protected_path} && ! -f ${protected_path} ) ]]; then
      echo "PROTECTED_RUNTIME_PATH_UNSAFE" >&2
      return 1
    elif [[ -f ${protected_path} ]]; then
      printf 'PRESENT %s ' "${protected_path}"
      sha256sum "${protected_path}" | awk '{print $1}'
    else
      printf 'ABSENT %s\n' "${protected_path}"
    fi
  done | sha256sum | awk '{print $1}'
}

snapshot_migration_path() {
  local source_path=$1
  local snapshot_name=$2
  local snapshot_data="${backup_dir}/${snapshot_name}.data"
  local snapshot_state="${backup_dir}/${snapshot_name}.state"
  if [[ -L ${source_path} \
    || ( -e ${source_path} && ! -f ${source_path} ) ]]; then
    echo "YILIAN_MIGRATION_BASELINE_PATH_UNSAFE" >&2
    return 1
  fi
  if [[ -f ${source_path} ]]; then
    cp --preserve=mode,ownership,timestamps \
      "${source_path}" \
      "${snapshot_data}"
    chmod 0600 "${snapshot_data}"
    printf 'PRESENT\n' > "${snapshot_state}"
  else
    printf 'ABSENT\n' > "${snapshot_state}"
  fi
  chmod 0600 "${snapshot_state}"
}

verify_expected_yilian_migration() {
  local verifier=
  verifier="${release_dir}/infra/ota-standalone-server/scripts/verify-yilian-source-contract-migration.mjs"
  if [[ -L ${yilian_report_sources_path} \
    || ! -f ${yilian_report_sources_path} \
    || -L ${yilian_repair_status_path} \
    || ! -f ${yilian_repair_status_path} ]]; then
    echo "YILIAN_MIGRATION_RESULT_PATH_UNSAFE" >&2
    return 1
  fi
  node "${verifier}" \
    --before-report-sources-state \
    "${backup_dir}/yilian-report-sources-baseline.state" \
    --before-report-sources-data \
    "${backup_dir}/yilian-report-sources-baseline.data" \
    --before-repair-statuses-state \
    "${backup_dir}/yilian-repair-status-baseline.state" \
    --before-repair-statuses-data \
    "${backup_dir}/yilian-repair-status-baseline.data" \
    --after-report-sources "${yilian_report_sources_path}" \
    --after-repair-statuses "${yilian_repair_status_path}" \
    --hotels /var/lib/sifangguan-ota/simulation-hotels.json \
    --pms-login-secrets /var/lib/sifangguan-ota/pms-login-secrets.json \
    --runtime-env "${runtime_env}"
}

restore_protected_state() {
  local restore_failed=0
  if ! systemctl stop sifangguan-ota-api.service; then
    echo "ROLLBACK_API_STOP_FAILED" >&2
    return 1
  fi
  for index in "${!protected_paths[@]}"; do
    protected_path="${protected_paths[$index]}"
    if ! state="$(cat "${backup_dir}/${index}.state")"; then
      restore_failed=1
      continue
    fi
    if [[ ${state} == PRESENT ]]; then
      restore_tmp="${protected_path}.restore-$$"
      if ! cp --preserve=mode,ownership,timestamps \
          "${backup_dir}/${index}.data" \
          "${restore_tmp}" \
        || ! mv -Tf "${restore_tmp}" "${protected_path}"; then
        rm -f -- "${restore_tmp}"
        restore_failed=1
      fi
    elif [[ ${state} == ABSENT ]]; then
      if [[ -e ${protected_path} || -L ${protected_path} ]]; then
        if ! rm -f -- "${protected_path}"; then
          restore_failed=1
        fi
      fi
    else
      restore_failed=1
    fi
  done
  return "${restore_failed}"
}

wait_for_health() {
  for _ in $(seq 1 30); do
    if curl --fail --silent --show-error \
        http://127.0.0.1:8091/health >/dev/null \
      && curl --fail --silent --show-error \
        http://127.0.0.1:5180/ >/dev/null; then
      return 0
    fi
    sleep 2
  done
  return 1
}

release_owned_scheduler_pause() {
  if [[ ${scheduler_pause_created} != true ]]; then
    return 0
  fi
  if ! rm -f -- "${scheduler_pause_path}"; then
    return 1
  fi
  scheduler_pause_created=false
}

recover_pre_switch_release() {
  local recovery_failed=0
  rollback_armed=false
  pre_switch_recovery_armed=false
  if ! systemctl restart sifangguan-ota-api.service; then
    recovery_failed=1
  fi
  if ! systemctl restart sifangguan-ota-web.service; then
    recovery_failed=1
  fi
  if ! wait_for_health; then
    echo "PRE_SWITCH_RECOVERY_HEALTH_CHECK_FAILED" >&2
    recovery_failed=1
  fi
  if [[ ${recovery_failed} -ne 0 ]]; then
    return 1
  fi
  if ! release_owned_scheduler_pause; then
    return 1
  fi
  echo "PRE_SWITCH_RELEASE_RECOVERED" >&2
}

rollback_release() {
  local rollback_failed=0
  rollback_armed=false
  if ! restore_protected_state; then
    rollback_failed=1
  fi
  if [[ -n ${previous_release} && -d ${previous_release} ]]; then
    rollback_link="${current_link}.rollback"
    if ! ln -sfn "${previous_release}" "${rollback_link}" \
      || ! mv -Tf "${rollback_link}" "${current_link}"; then
      rollback_failed=1
    fi
  else
    echo "PREVIOUS_RELEASE_UNAVAILABLE" >&2
    rollback_failed=1
  fi
  if ! systemctl restart sifangguan-ota-api.service; then
    rollback_failed=1
  fi
  if ! systemctl restart sifangguan-ota-web.service; then
    rollback_failed=1
  fi
  if ! wait_for_health; then
    echo "ROLLBACK_HEALTH_CHECK_FAILED" >&2
    rollback_failed=1
  fi
  if [[ ${rollback_failed} -ne 0 ]]; then
    return 1
  fi
  if ! release_owned_scheduler_pause; then
    return 1
  fi
  echo "PREVIOUS_RELEASE_AND_PROTECTED_STATE_RESTORED" >&2
}

initialize_phase_one_refresh_state() {
  local state_path=/var/lib/sifangguan-ota/review-auth-sessions.json
  local state_tmp="${state_path}.initialize-$$"
  if [[ -L ${state_path} || ( -e ${state_path} && ! -f ${state_path} ) ]]; then
    echo "REFRESH_STATE_PATH_UNSAFE" >&2
    return 1
  fi
  if [[ -f ${state_path} ]]; then
    return 0
  fi
  (
    umask 077
    printf '{\n  "version": 1,\n  "sessions": []\n}\n' > "${state_tmp}"
  ) || return 1
  if ! chown sifangguan-ota:sifangguan-ota "${state_tmp}" \
    || ! chmod 0600 "${state_tmp}"; then
    rm -f -- "${state_tmp}"
    return 1
  fi
  mv -Tf "${state_tmp}" "${state_path}"
}

install -d -m 0755 "$(dirname "${scheduler_pause_path}")"
if [[ -e ${scheduler_pause_path} || -L ${scheduler_pause_path} ]]; then
  echo "SCHEDULER_PAUSE_ALREADY_PRESENT" >&2
  false
fi
scheduler_pause_tmp="${scheduler_pause_path}.$$"
(
  umask 077
  printf 'deployment\n' > "${scheduler_pause_tmp}"
)
mv -Tf "${scheduler_pause_tmp}" "${scheduler_pause_path}"
scheduler_pause_created=true
scheduler_pause_tmp=""
pre_switch_recovery_armed=true

systemctl stop sifangguan-ota-api.service
api_active_state="$(
  systemctl show \
    --property=ActiveState \
    --value \
    sifangguan-ota-api.service
)"
api_main_pid="$(
  systemctl show \
    --property=MainPID \
    --value \
    sifangguan-ota-api.service
)"
if [[ ${api_active_state} != inactive \
  && ${api_active_state} != failed ]]; then
  echo "DEPLOYMENT_API_STOP_NOT_CONFIRMED" >&2
  false
fi
if [[ ! ${api_main_pid} =~ ^[0-9]+$ || ${api_main_pid} -ne 0 ]]; then
  echo "DEPLOYMENT_API_PROCESS_STILL_PRESENT" >&2
  false
fi

if [[ -d /var/lib/sifangguan-ota ]]; then
  registry_listing_file="$(mktemp)"
  find /var/lib/sifangguan-ota \
    -maxdepth 1 \
    -type f \
    -name 'trusted-device-registry-*.json' \
    -print0 \
    | sort -z > "${registry_listing_file}"
  while IFS= read -r -d '' registry_path; do
    protected_paths+=("${registry_path}")
  done < "${registry_listing_file}"
  rm -f -- "${registry_listing_file}"
  registry_listing_file=""
fi

backup_stamp="$(date -u +%Y%m%dT%H%M%SZ)"
backup_dir="${backup_root}/${commit}-${backup_stamp}-$$"
install -d -m 0700 "${backup_root}" "${backup_dir}"
for index in "${!protected_paths[@]}"; do
  protected_path="${protected_paths[$index]}"
  if [[ -L ${protected_path} \
    || ( -e ${protected_path} && ! -f ${protected_path} ) ]]; then
    echo "PROTECTED_RUNTIME_PATH_UNSAFE" >&2
    false
  fi
  if [[ -f ${protected_path} ]]; then
    cp --preserve=mode,ownership,timestamps \
      "${protected_path}" \
      "${backup_dir}/${index}.data"
    printf 'PRESENT\n' > "${backup_dir}/${index}.state"
  else
    printf 'ABSENT\n' > "${backup_dir}/${index}.state"
  fi
  chmod 0600 "${backup_dir}/${index}.state"
done

rollback_armed=true
pre_switch_recovery_armed=false
ensure_pseudonym_secret_key
initialize_phase_one_refresh_state

snapshot_migration_path \
  "${yilian_report_sources_path}" \
  yilian-report-sources-baseline
snapshot_migration_path \
  "${yilian_repair_status_path}" \
  yilian-repair-status-baseline

before_fingerprint="$(protected_fingerprint)"
before_non_yilian_fingerprint="$(
  protected_fingerprint_without_yilian_migration
)"

next_link="${current_link}.next"
ln -sfn "${release_dir}" "${next_link}"
mv -Tf "${next_link}" "${current_link}"

systemctl enable sifangguan-ota-api.service sifangguan-ota-web.service
systemctl restart sifangguan-ota-api.service
systemctl restart sifangguan-ota-web.service

if ! wait_for_health; then
  echo "DEPLOYMENT_HEALTH_CHECK_FAILED" >&2
  false
fi

after_fingerprint="$(protected_fingerprint)"
if [[ ${after_fingerprint} != "${before_fingerprint}" ]]; then
  after_non_yilian_fingerprint="$(
    protected_fingerprint_without_yilian_migration
  )"
  if [[ ${after_non_yilian_fingerprint} \
    != "${before_non_yilian_fingerprint}" ]]; then
    echo "PROTECTED_RUNTIME_STATE_CHANGED" >&2
    false
  fi
  if ! verify_expected_yilian_migration; then
    echo "PROTECTED_RUNTIME_STATE_CHANGED" >&2
    false
  fi
fi

if [[ "$(readlink -f "${current_link}")" != "${release_dir}" ]]; then
  echo "CURRENT_RELEASE_POINTER_MISMATCH" >&2
  false
fi

if ! bash \
  "${release_dir}/infra/ota-standalone-server/scripts/configure-phase1-runtime.sh"; then
  echo "PHASE1_RUNTIME_CONFIGURATION_FAILED" >&2
  false
fi

if ! bash \
  "${release_dir}/infra/ota-standalone-server/scripts/configure-public-entry.sh"; then
  echo "PUBLIC_ENTRY_CONFIGURATION_FAILED" >&2
  false
fi

systemctl is-active sifangguan-ota-api.service
systemctl is-active sifangguan-ota-web.service
if ! wait_for_health; then
  echo "POST_CONFIGURATION_HEALTH_CHECK_FAILED" >&2
  false
fi
release_owned_scheduler_pause
rollback_armed=false
pre_switch_recovery_armed=false
trap - ERR
echo "NATIVE_DEPLOYMENT_COMPLETE"
echo "Commit: ${commit}"
echo "Protected-state backup: ${backup_dir}"
echo "Web: http://127.0.0.1:5180 (SSH tunnel only)"
