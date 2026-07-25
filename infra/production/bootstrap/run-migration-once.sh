#!/usr/bin/env bash
set -Eeuo pipefail

api_pid=''
cleanup() {
  if test -n "${api_pid}" && kill -0 "${api_pid}" 2>/dev/null; then
    kill -TERM "${api_pid}" 2>/dev/null || true
    wait "${api_pid}" 2>/dev/null || true
  fi
}
trap cleanup EXIT INT TERM

/usr/bin/java \
  -Xms256m \
  -Xmx1024m \
  -XX:+ExitOnOutOfMemoryError \
  -jar /opt/hotel-ai-os/current/core-api.jar \
  --server.address=127.0.0.1 \
  --server.port=18081 &
api_pid=$!

migration_ready=false
for _attempt in $(seq 1 60); do
  if ! kill -0 "${api_pid}" 2>/dev/null; then
    wait "${api_pid}"
    exit $?
  fi
  if /usr/bin/curl --fail --silent --show-error \
      http://127.0.0.1:18081/actuator/health >/dev/null; then
    migration_ready=true
    break
  fi
  sleep 2
done

if test "${migration_ready}" != true; then
  printf '%s\n' 'Migration health check timed out.' >&2
  exit 1
fi

kill -TERM "${api_pid}"
wait_status=0
wait "${api_pid}" || wait_status=$?
api_pid=''
if test "${wait_status}" -ne 0 && test "${wait_status}" -ne 143; then
  exit "${wait_status}"
fi

trap - EXIT INT TERM
printf '%s\n' 'DATABASE_MIGRATION_COMPLETE'
