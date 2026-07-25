#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

backup_dir=/var/backups/hotel-ai-os/postgres
backup_key=/etc/hotel-ai-os/backup-encryption.key
timestamp="$(date '+%Y%m%dT%H%M%S%z')"
plain_dump="$(mktemp "${backup_dir}/.hotel_ai_os-auto-XXXXXX.dump")"
decrypted_check="$(mktemp "${backup_dir}/.hotel_ai_os-check-XXXXXX.dump")"
encrypted_tmp="${backup_dir}/.hotel_ai_os-auto-${timestamp}.dump.enc"
encrypted_final="${backup_dir}/hotel_ai_os-auto-${timestamp}.dump.enc"
checksum_final="${encrypted_final}.sha256"

cleanup() {
  rm -f "${plain_dump}" "${decrypted_check}" "${encrypted_tmp}"
}
trap cleanup EXIT INT TERM

test "$(readlink -f "${backup_dir}")" = '/var/backups/hotel-ai-os/postgres'
test -f "${backup_key}"

sudo -u postgres pg_dump \
  --format=custom \
  --compress=9 \
  --dbname hotel_ai_os \
  >"${plain_dump}"

openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -salt \
  -in "${plain_dump}" \
  -out "${encrypted_tmp}" \
  -pass "file:${backup_key}"
chmod 0600 "${encrypted_tmp}"

openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 \
  -in "${encrypted_tmp}" \
  -out "${decrypted_check}" \
  -pass "file:${backup_key}"
cmp --silent "${plain_dump}" "${decrypted_check}"
sudo -u postgres pg_restore --list <"${decrypted_check}" >/dev/null

mv "${encrypted_tmp}" "${encrypted_final}"
sha256sum "${encrypted_final}" >"${checksum_final}"
chmod 0600 "${checksum_final}"
rm -f "${plain_dump}" "${decrypted_check}"
trap - EXIT INT TERM

# Retain only this timer's encrypted automatic backups for 14 days. Baseline,
# rehearsal and manually named backups are deliberately outside these patterns.
find "${backup_dir}" -maxdepth 1 -type f \
  -name 'hotel_ai_os-auto-*.dump.enc' -mtime +14 -delete
find "${backup_dir}" -maxdepth 1 -type f \
  -name 'hotel_ai_os-auto-*.dump.enc.sha256' -mtime +14 -delete

printf '%s\n' 'POSTGRES_BACKUP_OK'
stat -c '%U:%G:%a:%s:%n' "${encrypted_final}" "${checksum_final}"
