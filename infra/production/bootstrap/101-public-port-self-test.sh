#!/usr/bin/env bash
set -Eeuo pipefail

public_ip=43.136.184.38
for port_number in 22 80 443 5432 18080; do
  if timeout 3 bash -c "exec 3<>/dev/tcp/${public_ip}/${port_number}" \
      2>/dev/null; then
    printf '%s|REACHABLE\n' "${port_number}"
  else
    printf '%s|BLOCKED_OR_CLOSED\n' "${port_number}"
  fi
done
