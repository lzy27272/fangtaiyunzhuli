#!/usr/bin/env bash
set -euo pipefail

if [[ ${EUID} -ne 0 ]]; then
  echo "RUN_AS_ROOT_REQUIRED" >&2
  exit 2
fi

runtime_env=/etc/sifangguan-ota/runtime.env
current_link=/opt/sifangguan-ota/current
node_runtime=/opt/sifangguan-ota/runtime/node/bin/node
test_script="${current_link}/tools/uat/wecom/Test-FutureBookingAiConfig.mjs"
backup_file=""
next_file=""

cleanup() {
  if [[ -n ${backup_file} && -f ${backup_file} ]]; then
    rm -f -- "${backup_file}"
  fi
  if [[ -n ${next_file} && -f ${next_file} ]]; then
    rm -f -- "${next_file}"
  fi
}
trap cleanup EXIT

if [[ ! -f ${runtime_env} \
  || ! -x ${node_runtime} \
  || ! -f ${test_script} ]]; then
  echo "AI_RUNTIME_PREREQUISITE_MISSING" >&2
  exit 2
fi

IFS= read -r action
IFS= read -r base_url_b64
IFS= read -r model_b64
IFS= read -r api_key_b64
IFS= read -r timeout_ms

if [[ ${action} != ENABLE && ${action} != DISABLE ]]; then
  echo "AI_CONFIGURATION_ACTION_INVALID" >&2
  exit 2
fi
if [[ ! ${timeout_ms} =~ ^[0-9]+$ \
  || ${timeout_ms} -lt 1000 \
  || ${timeout_ms} -gt 15000 ]]; then
  echo "AI_TIMEOUT_INVALID" >&2
  exit 2
fi

if [[ ${action} == ENABLE ]]; then
  if [[ ! ${base_url_b64} =~ ^[A-Za-z0-9+/]+={0,2}$ \
    || ! ${model_b64} =~ ^[A-Za-z0-9+/]+={0,2}$ \
    || ! ${api_key_b64} =~ ^[A-Za-z0-9+/]+={0,2}$ \
    || ${#api_key_b64} -gt 2048 ]]; then
    echo "AI_CONFIGURATION_ENCODING_INVALID" >&2
    exit 2
  fi
  base_url="$(printf '%s' "${base_url_b64}" | base64 -d)"
  model="$(printf '%s' "${model_b64}" | base64 -d)"
  if [[ ! ${base_url} =~ ^https:// \
    || ! ${model} =~ ^[A-Za-z0-9._:/-]{1,120}$ ]]; then
    echo "AI_CONFIGURATION_VALUE_INVALID" >&2
    exit 2
  fi
fi

backup_file="$(mktemp /etc/sifangguan-ota/runtime.env.ai-backup.XXXXXX)"
next_file="$(mktemp /etc/sifangguan-ota/runtime.env.ai-next.XXXXXX)"
cp --preserve=mode,ownership,timestamps "${runtime_env}" "${backup_file}"
awk '!/^OTA_REVIEW_AI_/' "${runtime_env}" > "${next_file}"

if [[ ${action} == ENABLE ]]; then
  {
    printf 'OTA_REVIEW_AI_ENABLED=true\n'
    printf 'OTA_REVIEW_AI_BASE_URL=%s\n' "${base_url}"
    printf 'OTA_REVIEW_AI_MODEL=%s\n' "${model}"
    printf 'OTA_REVIEW_AI_API_KEY_B64=%s\n' "${api_key_b64}"
    printf 'OTA_REVIEW_AI_TIMEOUT_MS=%s\n' "${timeout_ms}"
  } >> "${next_file}"
else
  {
    printf 'OTA_REVIEW_AI_ENABLED=false\n'
    printf 'OTA_REVIEW_AI_TIMEOUT_MS=%s\n' "${timeout_ms}"
  } >> "${next_file}"
fi

chown root:sifangguan-ota "${next_file}"
chmod 0640 "${next_file}"
mv -Tf "${next_file}" "${runtime_env}"
next_file=""

restore_runtime() {
  cp --preserve=mode,ownership,timestamps \
    "${backup_file}" \
    "${runtime_env}"
}

if [[ ${action} == ENABLE ]]; then
  set -a
  # shellcheck disable=SC1090
  . "${runtime_env}"
  set +a
  if ! "${node_runtime}" "${test_script}"; then
    restore_runtime
    echo "AI_CONFIGURATION_ROLLED_BACK" >&2
    exit 1
  fi
fi

if ! systemctl restart sifangguan-ota-api.service; then
  restore_runtime
  systemctl restart sifangguan-ota-api.service || true
  echo "AI_SERVICE_RESTART_ROLLED_BACK" >&2
  exit 1
fi

health=""
for _ in $(seq 1 20); do
  health="$(curl --fail --silent --show-error \
    http://127.0.0.1:8091/health 2>/dev/null || true)"
  if [[ -n ${health} ]]; then
    break
  fi
  sleep 1
done

expected='"enabled":true'
if [[ ${action} == DISABLE ]]; then
  expected='"enabled":false'
fi
if [[ ${health} != *"${expected}"* ]]; then
  restore_runtime
  systemctl restart sifangguan-ota-api.service || true
  echo "AI_HEALTH_CHECK_ROLLED_BACK" >&2
  exit 1
fi
if [[ ${action} == ENABLE && ${health} != *'"ready":true'* ]]; then
  restore_runtime
  systemctl restart sifangguan-ota-api.service || true
  echo "AI_READY_CHECK_ROLLED_BACK" >&2
  exit 1
fi

echo "AI_RUNTIME_CONFIGURATION_APPLIED"
echo "Action: ${action}"
echo "API Key: server-only and not printed"
