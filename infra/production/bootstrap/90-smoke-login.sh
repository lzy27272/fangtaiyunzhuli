#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

payload_file="$(mktemp)"
login_response="$(mktemp)"
identity_response="$(mktemp)"

cleanup() {
  rm -f "${payload_file}" "${login_response}" "${identity_response}"
}
trap cleanup EXIT

cat >"${payload_file}"

login_status="$(curl --silent --show-error \
  --output "${login_response}" \
  --write-out '%{http_code}' \
  --header 'Content-Type: application/json' \
  --data-binary "@${payload_file}" \
  http://127.0.0.1:18080/api/v1/auth/login)"
test "${login_status}" = '200'

access_token="$(jq --exit-status --raw-output '.accessToken' "${login_response}")"
test -n "${access_token}"
test "${access_token}" != 'null'

identity_status="$(curl --silent --show-error \
  --output "${identity_response}" \
  --write-out '%{http_code}' \
  --header "Authorization: Bearer ${access_token}" \
  http://127.0.0.1:18080/api/v1/iam/me)"
test "${identity_status}" = '200'

printf '%s\n' 'LOGIN_SMOKE_OK'
jq '{accountId, displayName}' "${login_response}"
jq '{account: {id: .account.id, loginName: .account.loginName, displayName: .account.displayName},
     primaryRole, roles, organizationScopes}' "${identity_response}"
