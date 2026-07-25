#!/usr/bin/env bash
set -Eeuo pipefail

systemctl enable --now hotel-ai-os-core-api.service

healthy=false
for _attempt in $(seq 1 30); do
  if curl --fail --silent --show-error \
      http://127.0.0.1:18080/actuator/health; then
    printf '\n'
    healthy=true
    break
  fi
  sleep 2
done
test "${healthy}" = true

systemctl show hotel-ai-os-core-api.service \
  -p ActiveState -p SubState -p Result -p MainPID
ss -lntp | grep -E '(:18080|:5432|:80 |:443 )'
journalctl -u hotel-ai-os-core-api.service -n 35 --no-pager
