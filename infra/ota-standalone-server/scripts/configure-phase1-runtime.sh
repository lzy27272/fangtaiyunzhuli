#!/usr/bin/env bash
set -euo pipefail

if [[ ${EUID} -ne 0 ]]; then
  echo "RUN_AS_ROOT_REQUIRED" >&2
  exit 2
fi

runtime_env=/etc/sifangguan-ota/runtime.env
backup_root=/var/backups/sifangguan-ota/runtime-config
backup_dir="${backup_root}/$(date -u +%Y%m%dT%H%M%SZ)-$$"

if [[ ! -f ${runtime_env} ]]; then
  echo "RUNTIME_ENV_MISSING" >&2
  exit 2
fi

install -d -m 0700 "${backup_dir}"
cp --preserve=mode,ownership,timestamps \
  "${runtime_env}" "${backup_dir}/runtime.env"

rollback() {
  cp --preserve=mode,ownership,timestamps \
    "${backup_dir}/runtime.env" "${runtime_env}"
  systemctl restart sifangguan-ota-api.service
}
trap rollback ERR

python3 - "${runtime_env}" <<'PY'
from pathlib import Path
import sys

path = Path(sys.argv[1])
updates = {
    "OTA_REVIEW_AUTH_REFRESH_STATE_PATH": "/var/lib/sifangguan-ota/review-auth-sessions.json",
    "OTA_REVIEW_SECURITY_AUDIT_PATH": "/var/lib/sifangguan-ota/security-audit.jsonl",
    "OTA_REVIEW_AUTH_COOKIE_PATH": "/api/v1/ota-console/auth",
    "OTA_REVIEW_AUTH_COOKIE_SECURE": "true",
    "OTA_REVIEW_ALLOWED_ORIGINS": "https://www.sfgzt.cn,http://127.0.0.1:15180",
    "OTA_REVIEW_REPAIR_PUBLIC_BASE_URL": "https://www.sfgzt.cn/api/v1/luopan-repair",
    "OTA_REVIEW_BIEYANGHONG_REPAIR_PUBLIC_BASE_URL": "https://www.sfgzt.cn/api/v1/bieyanghong-repair",
    "OTA_REVIEW_TRUSTED_DEVICE_PUBLIC_BASE_URL": "https://www.sfgzt.cn",
}
lines = path.read_text(encoding="utf-8").splitlines()
seen = set()
result = []
for line in lines:
    key = line.split("=", 1)[0] if "=" in line and not line.lstrip().startswith("#") else None
    if key in updates:
        if key not in seen:
            result.append(f"{key}={updates[key]}")
            seen.add(key)
        continue
    result.append(line)
for key, value in updates.items():
    if key not in seen:
        result.append(f"{key}={value}")
temporary = path.with_name(path.name + ".phase1.tmp")
temporary.write_text("\n".join(result) + "\n", encoding="utf-8")
temporary.chmod(0o640)
temporary.replace(path)
PY

chown root:sifangguan-ota "${runtime_env}"
chmod 0640 "${runtime_env}"
systemctl restart sifangguan-ota-api.service

for _ in $(seq 1 30); do
  if curl --fail --silent --show-error \
    http://127.0.0.1:8091/health >/dev/null; then
    trap - ERR
    echo "PHASE1_RUNTIME_CONFIGURED"
    echo "PHASE1_RUNTIME_BACKUP=${backup_dir}"
    exit 0
  fi
  sleep 1
done

echo "PHASE1_RUNTIME_POSTCHECK_FAILED" >&2
false
