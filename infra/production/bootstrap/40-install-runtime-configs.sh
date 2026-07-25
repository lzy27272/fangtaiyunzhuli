#!/usr/bin/env bash
set -Eeuo pipefail

install -o root -g root -m 0644 \
  /tmp/52-sfgzt-unattended-upgrades \
  /etc/apt/apt.conf.d/52-sfgzt-unattended-upgrades
install -o root -g root -m 0644 \
  /tmp/99-sfgzt.conf \
  /etc/postgresql/16/main/conf.d/99-sfgzt.conf
install -o root -g root -m 0644 \
  /tmp/Caddyfile \
  /etc/caddy/Caddyfile
install -o root -g root -m 0644 \
  /tmp/hotel-ai-os-core-api.service \
  /etc/systemd/system/hotel-ai-os-core-api.service

systemd-analyze verify /etc/systemd/system/hotel-ai-os-core-api.service
caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile

systemctl daemon-reload
systemctl restart postgresql

printf '%s\n' 'POSTGRES_EFFECTIVE'
sudo -u postgres psql -Atc \
  "select current_setting('listen_addresses'),
          current_setting('port'),
          current_setting('max_connections'),
          current_setting('password_encryption'),
          current_setting('timezone');"

printf '%s\n' 'CADDY_STATE'
systemctl is-enabled caddy || true
systemctl is-active caddy || true

printf '%s\n' 'AUTO_REBOOT_SETTING'
apt-config dump | grep 'Unattended-Upgrade::Automatic-Reboot'
