#!/usr/bin/env bash
set -euo pipefail

release_root="${1:-/opt/sifangguan-ota/current}"
runtime_env=/etc/sifangguan-ota/runtime.env
browser_env=/etc/sifangguan-ota/bieyanghong-browser.env
service_user=sifangguan-login
service_group=sifangguan-browser

for required in \
  /usr/bin/Xvfb \
  /usr/bin/x11vnc \
  /usr/bin/websockify \
  /usr/bin/google-chrome \
  /usr/share/novnc/vnc.html \
  /opt/sifangguan-ota/runtime/node/bin/node \
  /opt/sifangguan-ota/runtime/playwright/node_modules/playwright/package.json \
  "${release_root}/tools/uat/bieyanghong-browser-broker.mjs"
do
  test -e "${required}"
done

getent group "${service_group}" >/dev/null \
  || groupadd --system "${service_group}"
id -u "${service_user}" >/dev/null 2>&1 \
  || useradd \
    --system \
    --gid "${service_group}" \
    --home-dir /var/lib/sifangguan-login \
    --no-create-home \
    --shell /usr/sbin/nologin \
    "${service_user}"

install -d -o "${service_user}" -g "${service_group}" -m 0700 \
  /var/lib/sifangguan-login \
  /var/lib/sifangguan-login/hotel-001 \
  /var/lib/sifangguan-login/xdg-cache \
  /var/lib/sifangguan-login/xdg-config
install -d -o root -g root -m 0750 /etc/sifangguan-ota
test -f "${runtime_env}"

RUNTIME_ENV="${runtime_env}" BROWSER_ENV="${browser_env}" \
python3 - <<'PY'
import base64
import os
import re
import secrets
from pathlib import Path

runtime_path = Path(os.environ['RUNTIME_ENV'])
browser_path = Path(os.environ['BROWSER_ENV'])


def read_values(path):
    values = {}
    if not path.exists():
        return values
    for raw in path.read_text(encoding='utf-8').splitlines():
        line = raw.strip()
        if not line or line.startswith('#') or '=' not in line:
            continue
        key, value = line.split('=', 1)
        values[key.strip()] = value.strip()
    return values


def update_env(path, updates, mode):
    original = path.read_text(encoding='utf-8').splitlines() if path.exists() else []
    seen = set()
    output = []
    for raw in original:
        stripped = raw.strip()
        if stripped and not stripped.startswith('#') and '=' in stripped:
            key = stripped.split('=', 1)[0].strip()
            if key in updates:
                output.append(f'{key}={updates[key]}')
                seen.add(key)
                continue
        output.append(raw)
    if output and output[-1] != '':
        output.append('')
    for key, value in updates.items():
        if key not in seen:
            output.append(f'{key}={value}')
    temporary = path.with_name(f'.{path.name}.tmp')
    temporary.write_text('\n'.join(output).rstrip() + '\n', encoding='utf-8')
    os.chmod(temporary, mode)
    os.replace(temporary, path)


existing = read_values(browser_path)
secret = existing.get('BIEYANGHONG_BROWSER_BROKER_SECRET', '')
if re.fullmatch(r'[A-Za-z0-9_-]{40,128}', secret) is None:
    secret = base64.urlsafe_b64encode(secrets.token_bytes(32)).decode().rstrip('=')

shared = {
    'BIEYANGHONG_BROWSER_BROKER_SOCKET_PATH': '/run/sifangguan-bieyanghong/broker.sock',
    'BIEYANGHONG_BROWSER_BROKER_SECRET': secret,
}
update_env(runtime_path, {
    **shared,
    'BIEYANGHONG_REMOTE_DESKTOP_ENABLED': 'true',
    'BIEYANGHONG_NOVNC_ROOT': '/usr/share/novnc',
    'BIEYANGHONG_BROWSER_BROKER_ENABLED': 'true',
    'BIEYANGHONG_REMOTE_DESKTOP_WEBSOCKET_PORT': '6081',
}, 0o600)
update_env(browser_path, {
    **shared,
    'BIEYANGHONG_BROWSER_PROFILE_ROOT': '/var/lib/sifangguan-login/hotel-001',
    'BIEYANGHONG_BROWSER_EXECUTABLE': '/usr/bin/google-chrome',
    'UAT_PLAYWRIGHT_MODULE': '/opt/sifangguan-ota/runtime/playwright/node_modules/playwright',
    'BIEYANGHONG_REMOTE_DESKTOP_DISPLAY': ':91',
    'BIEYANGHONG_REMOTE_DESKTOP_WIDTH': '1280',
    'BIEYANGHONG_REMOTE_DESKTOP_HEIGHT': '800',
    'BIEYANGHONG_REMOTE_DESKTOP_WEBSOCKET_PORT': '6081',
    'HOME': '/var/lib/sifangguan-login',
    'XDG_CACHE_HOME': '/var/lib/sifangguan-login/xdg-cache',
    'XDG_CONFIG_HOME': '/var/lib/sifangguan-login/xdg-config',
    'TMPDIR': '/tmp',
    'LANG': 'C.UTF-8',
    'LC_ALL': 'C.UTF-8',
    'PATH': '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',
    'PYTHONPATH': '/opt/sifangguan-ota/current/tools/uat',
}, 0o600)
PY

chown root:root "${runtime_env}" "${browser_env}"
chmod 0600 "${runtime_env}" "${browser_env}"

install -m 0644 \
  "${release_root}/infra/production/systemd/sifangguan-bieyanghong-browser.service" \
  /etc/systemd/system/sifangguan-bieyanghong-browser.service
install -d -m 0755 /etc/systemd/system/sifangguan-ota-api.service.d
install -m 0644 \
  "${release_root}/infra/production/systemd/sifangguan-ota-api.service.d/bieyanghong-browser.conf" \
  /etc/systemd/system/sifangguan-ota-api.service.d/bieyanghong-browser.conf

systemctl daemon-reload
systemctl enable --now sifangguan-bieyanghong-browser.service
systemctl restart sifangguan-ota-api.service
