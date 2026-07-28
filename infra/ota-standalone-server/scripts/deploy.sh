#!/usr/bin/env bash
set -euo pipefail

if [[ ${EUID} -ne 0 ]]; then
  echo "RUN_AS_ROOT_REQUIRED" >&2
  exit 2
fi

repo_url="${SFG_OTA_REPOSITORY_URL:-https://github.com/lzy27272/OTAyunyingtuisongzhushou.git}"
ref="${SFG_OTA_GIT_REF:-main}"
source_dir=/opt/sifangguan-ota/source
release_root=/opt/sifangguan-ota/releases
current_link=/opt/sifangguan-ota/current
runtime_env=/etc/sifangguan-ota/runtime.env

if [[ ! -f ${runtime_env} ]]; then
  echo "RUNTIME_ENV_NOT_FOUND" >&2
  exit 2
fi
if ! command -v git >/dev/null 2>&1 \
  || ! command -v docker >/dev/null 2>&1; then
  echo "BOOTSTRAP_REQUIRED" >&2
  exit 2
fi

if [[ ! -d ${source_dir}/.git ]]; then
  if [[ -n "$(find "${source_dir}" -mindepth 1 -maxdepth 1 -print -quit)" ]]; then
    echo "SOURCE_DIRECTORY_NOT_EMPTY" >&2
    exit 2
  fi
  git clone --filter=blob:none --no-checkout "${repo_url}" "${source_dir}"
else
  configured_url="$(git -C "${source_dir}" remote get-url origin)"
  if [[ ${configured_url} != "${repo_url}" ]]; then
    echo "SOURCE_REMOTE_MISMATCH" >&2
    exit 2
  fi
fi

git -C "${source_dir}" fetch --prune origin "${ref}"
commit="$(git -C "${source_dir}" rev-parse --verify FETCH_HEAD^{commit})"
release_dir="${release_root}/${commit}"

if [[ ! -d ${release_dir} ]]; then
  install -d -m 0755 "${release_dir}"
  git -C "${source_dir}" archive "${commit}" | tar -x -C "${release_dir}"
fi

compose_file="${release_dir}/infra/ota-standalone-server/compose.yml"
if [[ ! -f ${compose_file} ]]; then
  echo "RELEASE_COMPOSE_NOT_FOUND" >&2
  exit 2
fi

previous_release=""
if [[ -L ${current_link} ]]; then
  previous_release="$(readlink -f "${current_link}" || true)"
fi

export SFG_OTA_RELEASE_TAG="${commit}"
docker compose -p sifangguan-ota -f "${compose_file}" build
docker compose -p sifangguan-ota -f "${compose_file}" up -d

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
  if [[ -n ${previous_release} \
    && -f ${previous_release}/infra/ota-standalone-server/compose.yml ]]; then
    previous_tag="$(basename "${previous_release}")"
    export SFG_OTA_RELEASE_TAG="${previous_tag}"
    docker compose \
      -p sifangguan-ota \
      -f "${previous_release}/infra/ota-standalone-server/compose.yml" \
      up -d
    echo "PREVIOUS_RELEASE_RESTORED" >&2
  fi
  exit 1
fi

next_link="${current_link}.next"
ln -sfn "${release_dir}" "${next_link}"
mv -Tf "${next_link}" "${current_link}"

docker compose -p sifangguan-ota -f "${compose_file}" ps
echo "DEPLOYMENT_COMPLETE"
echo "Commit: ${commit}"
echo "Web: http://127.0.0.1:5180 (SSH tunnel only)"
