#!/usr/bin/env bash
set -euo pipefail

current_link=/opt/sifangguan-ota/current
if [[ ! -L ${current_link} ]]; then
  echo "CURRENT_RELEASE_NOT_FOUND"
  exit 1
fi

release_dir="$(readlink -f "${current_link}")"
release_tag="$(basename "${release_dir}")"
compose_file="${release_dir}/infra/ota-standalone-server/compose.yml"

export SFG_OTA_RELEASE_TAG="${release_tag}"
docker compose -p sifangguan-ota -f "${compose_file}" ps
curl --fail --silent --show-error http://127.0.0.1:8091/health
printf '\n'
curl --fail --silent --show-error \
  --output /dev/null \
  http://127.0.0.1:5180/
ss -lntp | grep -E '127\.0\.0\.1:(5180|8091)\b' || true
echo "CURRENT_COMMIT=${release_tag}"
