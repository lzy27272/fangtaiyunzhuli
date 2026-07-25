#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

clean_file="$(mktemp)"
eicar_file="$(mktemp)"
cleanup() {
  rm -f "${clean_file}" "${eicar_file}"
}
trap cleanup EXIT

printf '%s\n' 'hotel-ai-os clean attachment smoke' >"${clean_file}"
clamscan --no-summary "${clean_file}"

curl --fail --silent --show-error \
  https://secure.eicar.org/eicar.com.txt \
  --output "${eicar_file}"

scan_status=0
clamscan --no-summary "${eicar_file}" || scan_status=$?
test "${scan_status}" -eq 1

printf '%s\n' 'CLAMAV_SMOKE_OK'
