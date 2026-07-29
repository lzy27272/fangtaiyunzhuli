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
incoming_dir=""
listing_file=""

protected_paths=(
  /etc/sifangguan-ota/runtime.env
  /var/lib/sifangguan-ota/review-auth-state.json
  /var/lib/sifangguan-ota/simulation-hotels.json
  /var/lib/sifangguan-ota/report-sources.json
  /var/lib/sifangguan-ota/report-source-cookie-secrets.json
  /var/lib/sifangguan-ota/pms-login-secrets.json
  /var/lib/sifangguan-ota/ota-source-configs.json
  /var/lib/sifangguan-ota/ota-source-secrets.json
  /var/lib/sifangguan-ota/luopan-session-secrets.json
  /var/lib/sifangguan-ota/hot-selling-room-types.json
  /var/lib/sifangguan-ota/business-day-controls.json
  /var/lib/sifangguan-ota/wecom-configs.json
  /var/lib/sifangguan-ota/wecom-webhook-secrets.json
)

cleanup_temporary_files() {
  if [[ -n ${listing_file} && -f ${listing_file} ]]; then
    rm -f -- "${listing_file}"
  fi
  if [[ -n ${incoming_dir} \
    && ${incoming_dir} == "${release_root}/.incoming-"* \
    && -d ${incoming_dir} ]]; then
    rm -rf -- "${incoming_dir}"
  fi
}
trap cleanup_temporary_files EXIT

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
  '(^|/)(\.git|\.uat-runtime|node_modules|tmp)(/|$)|(^|/)(credentials\.json|secret-key\.dpapi|report-source-cookie-secrets\.json|pms-login-secrets\.json|ota-source-secrets\.json|luopan-session-secrets\.json|wecom-webhook-secrets\.json|runtime\.env)$' \
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
  || ! -f ${release_dir}/tools/uat/ota-standalone-review-api.mjs ]]; then
  echo "RELEASE_CONTENT_INVALID" >&2
  exit 2
fi

previous_release=""
if [[ -L ${current_link} ]]; then
  previous_release="$(readlink -f "${current_link}" || true)"
fi

backup_stamp="$(date -u +%Y%m%dT%H%M%SZ)"
backup_dir="${backup_root}/${commit}-${backup_stamp}-$$"
install -d -m 0700 "${backup_root}" "${backup_dir}"
for index in "${!protected_paths[@]}"; do
  protected_path="${protected_paths[$index]}"
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

protected_fingerprint() {
  for protected_path in "${protected_paths[@]}"; do
    if [[ -f ${protected_path} ]]; then
      printf 'PRESENT %s ' "${protected_path}"
      sha256sum "${protected_path}" | awk '{print $1}'
    else
      printf 'ABSENT %s\n' "${protected_path}"
    fi
  done | sha256sum | awk '{print $1}'
}

restore_protected_state() {
  systemctl stop sifangguan-ota-api.service || true
  for index in "${!protected_paths[@]}"; do
    protected_path="${protected_paths[$index]}"
    state="$(cat "${backup_dir}/${index}.state")"
    if [[ ${state} == PRESENT ]]; then
      restore_tmp="${protected_path}.restore-$$"
      cp --preserve=mode,ownership,timestamps \
        "${backup_dir}/${index}.data" \
        "${restore_tmp}"
      mv -Tf "${restore_tmp}" "${protected_path}"
    elif [[ -e ${protected_path} ]]; then
      rm -f -- "${protected_path}"
    fi
  done
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

rollback_release() {
  restore_protected_state
  if [[ -n ${previous_release} && -d ${previous_release} ]]; then
    rollback_link="${current_link}.rollback"
    ln -sfn "${previous_release}" "${rollback_link}"
    mv -Tf "${rollback_link}" "${current_link}"
  fi
  systemctl restart sifangguan-ota-api.service
  systemctl restart sifangguan-ota-web.service
  if ! wait_for_health; then
    echo "ROLLBACK_HEALTH_CHECK_FAILED" >&2
    return 1
  fi
  echo "PREVIOUS_RELEASE_AND_PROTECTED_STATE_RESTORED" >&2
}

before_fingerprint="$(protected_fingerprint)"

next_link="${current_link}.next"
ln -sfn "${release_dir}" "${next_link}"
mv -Tf "${next_link}" "${current_link}"

systemctl enable sifangguan-ota-api.service sifangguan-ota-web.service
systemctl restart sifangguan-ota-api.service
systemctl restart sifangguan-ota-web.service

if ! wait_for_health; then
  echo "DEPLOYMENT_HEALTH_CHECK_FAILED" >&2
  rollback_release || true
  exit 1
fi

after_fingerprint="$(protected_fingerprint)"
if [[ ${after_fingerprint} != "${before_fingerprint}" ]]; then
  echo "PROTECTED_RUNTIME_STATE_CHANGED" >&2
  rollback_release || true
  exit 1
fi

if [[ "$(readlink -f "${current_link}")" != "${release_dir}" ]]; then
  echo "CURRENT_RELEASE_POINTER_MISMATCH" >&2
  rollback_release || true
  exit 1
fi

systemctl is-active sifangguan-ota-api.service
systemctl is-active sifangguan-ota-web.service
echo "NATIVE_DEPLOYMENT_COMPLETE"
echo "Commit: ${commit}"
echo "Protected-state backup: ${backup_dir}"
echo "Web: http://127.0.0.1:5180 (SSH tunnel only)"
