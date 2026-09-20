#!/usr/bin/env bash
set -euo pipefail
[[ ${EUID} -eq 0 ]] || { echo RUN_AS_ROOT_REQUIRED >&2; exit 2; }
release=/opt/sifangguan-ota/current
test -f "$release/tools/uat/ota-cloud-browser-worker.mjs"
test -x /usr/bin/google-chrome
test -x /usr/bin/Xvfb
test -x /usr/bin/xvfb-run
test -x /usr/bin/xauth
test -d /opt/sifangguan-ota/runtime/playwright/node_modules/playwright
getent group sifangguan-ota >/dev/null
getent group sifangguan-ota-cloud >/dev/null || groupadd --system sifangguan-ota-cloud
if ! id sifangguan-ota-cloud >/dev/null 2>&1; then
  useradd --system --gid sifangguan-ota-cloud --home-dir /var/lib/sifangguan-ota-cloud --shell /usr/sbin/nologin sifangguan-ota-cloud
fi
install -d -m 0700 -o sifangguan-ota-cloud -g sifangguan-ota-cloud /var/lib/sifangguan-ota-cloud
install -d -m 0755 /etc/systemd/system/sifangguan-ota-api.service.d
install -m 0644 "$release/infra/ota-standalone-server/systemd/ota-cloud-api-access.conf" /etc/systemd/system/sifangguan-ota-api.service.d/ota-cloud-api-access.conf
install -m 0644 "$release/infra/ota-standalone-server/systemd/sifangguan-ota-cloud.service" /etc/systemd/system/sifangguan-ota-cloud.service
systemctl daemon-reload
systemctl enable sifangguan-ota-cloud.service
systemctl restart sifangguan-ota-cloud.service
systemctl is-active --quiet sifangguan-ota-cloud.service
systemctl restart sifangguan-ota-api.service
echo OTA_CLOUD_SERVICE_CONFIGURED
