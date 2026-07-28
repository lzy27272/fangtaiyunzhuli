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

if tar -tzf "${archive}" | grep -Eq '(^/|(^|/)\.\.(/|$))'; then
  echo "RELEASE_ARCHIVE_PATH_UNSAFE" >&2
  exit 2
fi

release_dir="${release_root}/${commit}"
if [[ ! -d ${release_dir} ]]; then
  install -d -m 0755 "${release_dir}"
  tar -xzf "${archive}" -C "${release_dir}"
  printf '%s\n' "${commit}" > "${release_dir}/.release-commit"
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

next_link="${current_link}.next"
ln -sfn "${release_dir}" "${next_link}"
mv -Tf "${next_link}" "${current_link}"

systemctl enable sifangguan-ota-api.service sifangguan-ota-web.service
systemctl restart sifangguan-ota-api.service
systemctl restart sifangguan-ota-web.service

healthy=false
for _ in $(seq 1 30); do
  if curl --fail --silent --show-error \
      http://127.0.0.1:8091/health >/dev/null \
    && curl --fail --silent --show-error \
      http://127.0.0.1:5180/ >/dev/null; then
    healthy=true
    break
  fi
  sleep 2
done

if [[ ${healthy} != true ]]; then
  echo "DEPLOYMENT_HEALTH_CHECK_FAILED" >&2
  if [[ -n ${previous_release} && -d ${previous_release} ]]; then
    rollback_link="${current_link}.rollback"
    ln -sfn "${previous_release}" "${rollback_link}"
    mv -Tf "${rollback_link}" "${current_link}"
    systemctl restart sifangguan-ota-api.service
    systemctl restart sifangguan-ota-web.service
    echo "PREVIOUS_RELEASE_RESTORED" >&2
  fi
  exit 1
fi

systemctl --no-pager --full status \
  sifangguan-ota-api.service \
  sifangguan-ota-web.service
echo "NATIVE_DEPLOYMENT_COMPLETE"
echo "Commit: ${commit}"
echo "Web: http://127.0.0.1:5180 (SSH tunnel only)"
