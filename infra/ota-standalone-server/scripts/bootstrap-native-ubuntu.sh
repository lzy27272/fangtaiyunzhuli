#!/usr/bin/env bash
set -euo pipefail

if [[ ${EUID} -ne 0 ]]; then
  echo "RUN_AS_ROOT_REQUIRED" >&2
  exit 2
fi

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
asset_root="$(cd -- "${script_dir}/.." && pwd)"
node_version="${SFG_OTA_NODE_VERSION:-24.18.0}"
node_archive="node-v${node_version}-linux-x64.tar.xz"
node_url="https://nodejs.org/dist/v${node_version}"
runtime_root=/opt/sifangguan-ota/runtime
node_release="${runtime_root}/node-v${node_version}-linux-x64"
node_link="${runtime_root}/node"
runtime_env=/etc/sifangguan-ota/runtime.env

if [[ ! -r /etc/os-release ]]; then
  echo "OS_RELEASE_NOT_FOUND" >&2
  exit 2
fi
# shellcheck disable=SC1091
. /etc/os-release
if [[ ${ID:-} != "ubuntu" ]]; then
  echo "UBUNTU_REQUIRED" >&2
  exit 2
fi

export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y ca-certificates curl git openssl xz-utils

if ! command -v caddy >/dev/null 2>&1; then
  apt-get install -y caddy
fi

if ! id sifangguan-ota >/dev/null 2>&1; then
  useradd \
    --system \
    --home-dir /var/lib/sifangguan-ota \
    --shell /usr/sbin/nologin \
    sifangguan-ota
fi

install -d -m 0755 /opt/sifangguan-ota
install -d -m 0755 /opt/sifangguan-ota/releases
install -d -m 0755 "${runtime_root}"
install -d -m 0750 \
  -o root \
  -g sifangguan-ota \
  /etc/sifangguan-ota
install -d -m 0700 \
  -o sifangguan-ota \
  -g sifangguan-ota \
  /var/lib/sifangguan-ota
install -d -m 0700 \
  -o sifangguan-ota \
  -g sifangguan-ota \
  /var/lib/sifangguan-ota/caddy-data \
  /var/lib/sifangguan-ota/caddy-config
install -d -m 0700 \
  -o sifangguan-ota \
  -g sifangguan-ota \
  /var/lib/sifangguan-ota/browser-runtime/config \
  /var/lib/sifangguan-ota/browser-runtime/cache \
  /var/lib/sifangguan-ota/browser-runtime/tmp

if [[ ! -x ${node_release}/bin/node ]]; then
  download_dir="$(mktemp -d)"
  trap 'rm -rf -- "${download_dir}"' EXIT
  curl -fsSLo "${download_dir}/${node_archive}" \
    "${node_url}/${node_archive}"
  curl -fsSLo "${download_dir}/SHASUMS256.txt" \
    "${node_url}/SHASUMS256.txt"
  (
    cd "${download_dir}"
    grep " ${node_archive}\$" SHASUMS256.txt | sha256sum --check -
  )
  tar -xJf "${download_dir}/${node_archive}" -C "${runtime_root}"
fi

next_node_link="${node_link}.next"
ln -sfn "${node_release}" "${next_node_link}"
mv -Tf "${next_node_link}" "${node_link}"
"${node_link}/bin/node" --version

if [[ ! -e ${runtime_env} ]]; then
  umask 077
  review_password="$(openssl rand -base64 36 | tr -d '\n=/+')"
  access_token="$(openssl rand -hex 32)"
  secret_key="$(openssl rand -base64 32 | tr '+/' '-_' | tr -d '=\n')"
  pseudonym_secret_key="$(openssl rand -base64 32 | tr '+/' '-_' | tr -d '=\n')"
  cat > "${runtime_env}" <<EOF
OTA_REVIEW_API_PORT=8091
OTA_REVIEW_USERNAME=review-admin
OTA_REVIEW_PASSWORD=${review_password}
OTA_REVIEW_ACCESS_TOKEN=${access_token}
OTA_REVIEW_AUTH_STATE_PATH=/var/lib/sifangguan-ota/review-auth-state.json
OTA_REVIEW_DATA_PATH=/var/lib/sifangguan-ota/report-sources.json
OTA_REVIEW_COOKIE_SECRETS_PATH=/var/lib/sifangguan-ota/report-source-cookie-secrets.json
OTA_REVIEW_SECRET_KEY=${secret_key}
OTA_REVIEW_PSEUDONYM_SECRET_KEY=${pseudonym_secret_key}
OTA_REVIEW_AUTO_COLLECTION_ENABLED=true
OTA_REVIEW_RUNTIME_MODE=LOCAL_LIVE_LONG_RUNNING
EOF
  unset review_password access_token secret_key pseudonym_secret_key
fi

chown root:sifangguan-ota "${runtime_env}"
chmod 0640 "${runtime_env}"
install -m 0644 \
  "${asset_root}/Caddyfile.native" \
  /etc/sifangguan-ota/Caddyfile
install -m 0644 \
  "${asset_root}/systemd/sifangguan-ota-api.service" \
  /etc/systemd/system/sifangguan-ota-api.service
install -m 0644 \
  "${asset_root}/systemd/sifangguan-ota-web.service" \
  /etc/systemd/system/sifangguan-ota-web.service

systemd-analyze verify \
  /etc/systemd/system/sifangguan-ota-api.service \
  /etc/systemd/system/sifangguan-ota-web.service
caddy validate \
  --config /etc/sifangguan-ota/Caddyfile \
  --adapter caddyfile
systemctl daemon-reload

echo "NATIVE_BOOTSTRAP_COMPLETE"
echo "Node ${node_version} and Caddy are ready."
echo "Runtime secrets remain only in ${runtime_env}."
echo "No public application port was opened."
