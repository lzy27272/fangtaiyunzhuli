#!/usr/bin/env bash
set -euo pipefail

if [[ ${EUID} -ne 0 ]]; then
  echo "RUN_AS_ROOT_REQUIRED" >&2
  exit 2
fi

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
apt-get install -y ca-certificates curl git openssl

if ! command -v docker >/dev/null 2>&1; then
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg \
    -o /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc

  arch="$(dpkg --print-architecture)"
  codename="${UBUNTU_CODENAME:-${VERSION_CODENAME:-}}"
  if [[ -z ${codename} ]]; then
    echo "UBUNTU_CODENAME_NOT_FOUND" >&2
    exit 2
  fi
  printf '%s\n' \
    "deb [arch=${arch} signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu ${codename} stable" \
    > /etc/apt/sources.list.d/docker.sources.list

  apt-get update
  apt-get install -y \
    docker-ce \
    docker-ce-cli \
    containerd.io \
    docker-buildx-plugin \
    docker-compose-plugin
fi

systemctl enable --now docker
docker version >/dev/null
docker compose version >/dev/null

install -d -m 0755 /opt/sifangguan-ota
install -d -m 0755 /opt/sifangguan-ota/releases
install -d -m 0755 /opt/sifangguan-ota/source
install -d -m 0700 /etc/sifangguan-ota
install -d -m 0700 -o 10001 -g 10001 /var/lib/sifangguan-ota

runtime_env=/etc/sifangguan-ota/runtime.env
if [[ ! -e ${runtime_env} ]]; then
  umask 077
  review_password="$(openssl rand -base64 36 | tr -d '\n=/+')"
  access_token="$(openssl rand -hex 32)"
  secret_key="$(openssl rand -base64 32 | tr '+/' '-_' | tr -d '=\n')"
  cat > "${runtime_env}" <<EOF
OTA_REVIEW_API_PORT=8091
OTA_REVIEW_USERNAME=review-admin
OTA_REVIEW_PASSWORD=${review_password}
OTA_REVIEW_ACCESS_TOKEN=${access_token}
OTA_REVIEW_AUTH_STATE_PATH=/data/review-auth-state.json
OTA_REVIEW_DATA_PATH=/data/report-sources.json
OTA_REVIEW_COOKIE_SECRETS_PATH=/data/report-source-cookie-secrets.json
OTA_REVIEW_SECRET_KEY=${secret_key}
OTA_REVIEW_AUTO_COLLECTION_ENABLED=true
OTA_REVIEW_RUNTIME_MODE=LOCAL_LIVE_LONG_RUNNING
EOF
  unset review_password access_token secret_key
fi

chown root:root "${runtime_env}"
chmod 0600 "${runtime_env}"

echo "BOOTSTRAP_COMPLETE"
echo "Runtime secrets remain only in ${runtime_env}"
echo "No public application port was opened."
