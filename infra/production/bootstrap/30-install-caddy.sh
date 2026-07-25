#!/usr/bin/env bash
set -Eeuo pipefail

export DEBIAN_FRONTEND=noninteractive

apt-get update
apt-get -y install \
  apt-transport-https \
  curl \
  debian-archive-keyring \
  debian-keyring \
  gnupg

curl -1sLf \
  'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
  -o /tmp/caddy-stable.gpg.key
gpg --batch --yes --dearmor \
  -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg \
  /tmp/caddy-stable.gpg.key

curl -1sLf \
  'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
  -o /etc/apt/sources.list.d/caddy-stable.list
chmod o+r /usr/share/keyrings/caddy-stable-archive-keyring.gpg
chmod o+r /etc/apt/sources.list.d/caddy-stable.list

apt-get update
apt-get -y install caddy

# The production site config is installed separately and validated first.
systemctl disable --now caddy

printf '%s\n' 'CADDY_INSTALL_COMPLETE'
caddy version
