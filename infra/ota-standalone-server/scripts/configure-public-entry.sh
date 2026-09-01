#!/usr/bin/env bash
set -euo pipefail

if [[ ${EUID} -ne 0 ]]; then
  echo "RUN_AS_ROOT_REQUIRED" >&2
  exit 2
fi

main_config=/etc/caddy/Caddyfile
snippet_target=/etc/caddy/ota-console-public.caddy
snippet_source=/opt/sifangguan-ota/current/infra/ota-standalone-server/caddy/ota-console-public.caddy
loopback_target=/etc/sifangguan-ota/Caddyfile
loopback_source=/opt/sifangguan-ota/current/infra/ota-standalone-server/Caddyfile.native
import_line='import /etc/caddy/ota-console-public.caddy'
backup_root=/var/backups/sifangguan-ota/public-entry
backup_dir="${backup_root}/$(date -u +%Y%m%dT%H%M%SZ)-$$"

if [[ ! -f ${main_config} \
  || ! -f ${snippet_source} \
  || ! -f ${loopback_target} \
  || ! -f ${loopback_source} ]]; then
  echo "PUBLIC_ENTRY_INPUT_MISSING" >&2
  exit 2
fi

install -d -m 0700 "${backup_dir}"
cp --preserve=mode,ownership,timestamps "${main_config}" "${backup_dir}/Caddyfile"
cp --preserve=mode,ownership,timestamps \
  "${loopback_target}" "${backup_dir}/Caddyfile.loopback"
if [[ -f ${snippet_target} ]]; then
  cp --preserve=mode,ownership,timestamps \
    "${snippet_target}" "${backup_dir}/ota-console-public.caddy"
  printf 'PRESENT\n' > "${backup_dir}/snippet.state"
else
  printf 'ABSENT\n' > "${backup_dir}/snippet.state"
fi
chmod 0600 "${backup_dir}/snippet.state"

rollback() {
  cp --preserve=mode,ownership,timestamps \
    "${backup_dir}/Caddyfile" "${main_config}"
  cp --preserve=mode,ownership,timestamps \
    "${backup_dir}/Caddyfile.loopback" "${loopback_target}"
  if grep -qx 'PRESENT' "${backup_dir}/snippet.state"; then
    cp --preserve=mode,ownership,timestamps \
      "${backup_dir}/ota-console-public.caddy" "${snippet_target}"
  else
    rm -f -- "${snippet_target}"
  fi
  /usr/bin/caddy validate --config "${main_config}" --adapter caddyfile >/dev/null
  /usr/bin/caddy validate --config "${loopback_target}" --adapter caddyfile >/dev/null
  systemctl reload caddy.service
  systemctl reload sifangguan-ota-web.service
}
trap rollback ERR

install -o root -g root -m 0644 "${snippet_source}" "${snippet_target}"
install -o root -g sifangguan-ota -m 0640 \
  "${loopback_source}" "${loopback_target}"

if ! grep -Fqx $'\timport /etc/caddy/ota-console-public.caddy' "${main_config}"; then
  python3 - "${main_config}" <<'PY'
from pathlib import Path
import sys

path = Path(sys.argv[1])
text = path.read_text(encoding='utf-8')
needle = "www.sfgzt.cn {\n\tencode zstd gzip\n"
if text.count(needle) != 1:
    raise SystemExit("PUBLIC_ENTRY_INSERTION_POINT_INVALID")
replacement = needle + "\n\timport /etc/caddy/ota-console-public.caddy\n"
temporary = path.with_name(path.name + '.ota-console.tmp')
temporary.write_text(text.replace(needle, replacement, 1), encoding='utf-8')
temporary.chmod(0o644)
temporary.replace(path)
PY
fi

/usr/bin/caddy validate --config "${main_config}" --adapter caddyfile >/dev/null
/usr/bin/caddy validate --config "${loopback_target}" --adapter caddyfile >/dev/null
systemctl reload caddy.service
systemctl reload sifangguan-ota-web.service

web_code="$(curl --silent --show-error --output /dev/null \
  --write-out '%{http_code}' \
  --resolve www.sfgzt.cn:443:127.0.0.1 \
  https://www.sfgzt.cn/ota-console/)"
health_code="$(curl --silent --show-error --output /dev/null \
  --write-out '%{http_code}' \
  --resolve www.sfgzt.cn:443:127.0.0.1 \
  https://www.sfgzt.cn/api/v1/ota-console/health)"
if [[ ${web_code} != 200 || ${health_code} != 200 ]]; then
  echo "PUBLIC_ENTRY_POSTCHECK_FAILED:${web_code}:${health_code}" >&2
  false
fi

trap - ERR
echo "PUBLIC_ENTRY_CONFIGURED"
echo "PUBLIC_WEB_HTTP=${web_code}"
echo "PUBLIC_API_HTTP=${health_code}"
echo "PUBLIC_ENTRY_BACKUP=${backup_dir}"
