#!/usr/bin/env bash
set -Eeuo pipefail

printf '%s\n' 'SERVICE_STATE'
for service_name in ssh postgresql fail2ban clamav-freshclam unattended-upgrades; do
  printf '%s=' "${service_name}"
  systemctl is-active "${service_name}"
done

printf '%s\n' 'POSTGRES'
pg_lsclusters
sudo -u postgres psql -Atc \
  "show listen_addresses; show port; select current_setting('server_version');"

printf '%s\n' 'SOCKETS'
sudo ss -lntp

printf '%s\n' 'FIREWALL'
sudo ufw status verbose

printf '%s\n' 'CLAMAV_DB'
sudo find /var/lib/clamav -maxdepth 1 -type f -printf '%f %s bytes\n'

printf '%s\n' 'RESOURCES'
free -h
swapon --show

if test -f /var/run/reboot-required; then
  printf '%s\n' 'REBOOT_REQUIRED'
  cat /var/run/reboot-required.pkgs
else
  printf '%s\n' 'NO_REBOOT_REQUIRED'
fi
