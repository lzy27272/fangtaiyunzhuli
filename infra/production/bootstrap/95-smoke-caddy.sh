#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

payload_file="$(mktemp)"
login_response="$(mktemp)"
identity_response="$(mktemp)"
caddy_pid=''

cleanup() {
  rm -f "${payload_file}" "${login_response}" "${identity_response}"
  if test -n "${caddy_pid}" && kill -0 "${caddy_pid}" 2>/dev/null; then
    kill -TERM "${caddy_pid}" 2>/dev/null || true
    wait "${caddy_pid}" 2>/dev/null || true
  fi
}
trap cleanup EXIT INT TERM

cat >"${payload_file}"

runuser -u caddy -- /usr/bin/caddy run \
  --config /tmp/hotel-ai-os-release/Caddyfile.preview \
  --adapter caddyfile &
caddy_pid=$!

ready=false
for _attempt in $(seq 1 20); do
  if curl --fail --silent --show-error \
      http://127.0.0.1:18090/ >/dev/null; then
    ready=true
    break
  fi
  sleep 1
done
test "${ready}" = true

test "$(curl --fail --silent --show-error \
  http://127.0.0.1:18090/WW_verify_SPDdxyqWud3VVNJn.txt)" = \
  'SPDdxyqWud3VVNJn'

login_status="$(curl --silent --show-error \
  --output "${login_response}" \
  --write-out '%{http_code}' \
  --header 'Content-Type: application/json' \
  --data-binary "@${payload_file}" \
  http://127.0.0.1:18090/api/v1/auth/login)"
test "${login_status}" = '200'

access_token="$(jq --exit-status --raw-output '.accessToken' "${login_response}")"
test -n "${access_token}"
test "${access_token}" != 'null'

identity_status="$(curl --silent --show-error \
  --output "${identity_response}" \
  --write-out '%{http_code}' \
  --header "X-Hotel-AI-Authorization: Bearer ${access_token}" \
  http://127.0.0.1:18090/api/v1/iam/me)"
test "${identity_status}" = '200'

printf '%s\n' 'CADDY_CHAIN_SMOKE_OK'
jq '{account: .account.loginName, primaryRole, organizationScopes}' \
  "${identity_response}"
