#!/usr/bin/env bash
set -Eeuo pipefail

if ! id ops >/dev/null 2>&1; then
  useradd --create-home --shell /bin/bash ops
fi
usermod --append --groups sudo ops

install -d -m 0700 -o ops -g ops /home/ops/.ssh
install -m 0600 -o ops -g ops /home/ubuntu/.ssh/authorized_keys /home/ops/.ssh/authorized_keys

printf '%s\n' 'ops ALL=(ALL:ALL) NOPASSWD:ALL' >/etc/sudoers.d/90-ops
chmod 0440 /etc/sudoers.d/90-ops
visudo -cf /etc/sudoers.d/90-ops

if ! id hotelai >/dev/null 2>&1; then
  useradd --system --user-group --create-home \
    --home-dir /var/lib/hotel-ai-os \
    --shell /usr/sbin/nologin \
    hotelai
fi

install -d -m 0755 -o root -g root /opt/hotel-ai-os/releases
install -d -m 0755 -o root -g root /srv/www/hotel-ai-os/releases
install -d -m 0750 -o hotelai -g hotelai /var/lib/hotel-ai-os/attachments
install -d -m 0750 -o root -g hotelai /etc/hotel-ai-os
install -d -m 0700 -o root -g root /var/backups/hotel-ai-os
install -d -m 0700 -o root -g root /var/backups/hotel-ai-os/postgres
install -d -m 0700 -o root -g root /var/backups/hotel-ai-os/attachments
install -d -m 0700 -o root -g root /var/backups/hotel-ai-os/releases

id ops
id hotelai
