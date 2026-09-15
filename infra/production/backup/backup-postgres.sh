#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

backup_root=/var/backups/hotel-ai-os/postgres
daily_dir=${backup_root}/daily
monthly_dir=${backup_root}/monthly
yearly_dir=${backup_root}/yearly
backup_key=/etc/hotel-ai-os/backup-encryption.key
offsite_env=/etc/hotel-ai-os/backup-offsite.env
analytics_raw=/var/lib/sifangguan-ota/analytics-retention/raw
ota_runtime_env=/etc/sifangguan-ota/runtime.env
raw_retention_days=90
timestamp="$(date '+%Y%m%dT%H%M%S%z')"
month_key="$(date '+%Y%m')"
year_key="$(date '+%Y')"
plain_dump="$(mktemp "${backup_root}/.hotel_ai_os-auto-XXXXXX.dump")"
decrypted_check="$(mktemp "${backup_root}/.hotel_ai_os-check-XXXXXX.dump")"
encrypted_tmp="${backup_root}/.hotel_ai_os-auto-${timestamp}.dump.enc"
encrypted_final="${daily_dir}/hotel_ai_os-daily-${timestamp}.dump.enc"
checksum_final="${encrypted_final}.sha256"
runtime_encrypted_tmp="${backup_root}/.sifangguan-ota-runtime-${timestamp}.env.enc"
runtime_encrypted_final="${daily_dir}/sifangguan-ota-runtime-daily-${timestamp}.env.enc"
runtime_checksum_final="${runtime_encrypted_final}.sha256"
runtime_backup_created=false

cleanup() {
  rm -f -- "${plain_dump}" "${decrypted_check}" "${encrypted_tmp}" \
    "${runtime_encrypted_tmp}"
}
trap cleanup EXIT INT TERM

test "$(readlink -f "${backup_root}")" = '/var/backups/hotel-ai-os/postgres'
test -f "${backup_key}"
if [[ -r ${ota_runtime_env} ]]; then
  configured_raw_days="$(sed -n 's/^OTA_ANALYTICS_RAW_RETENTION_DAYS=//p' "${ota_runtime_env}" | tail -n 1)"
  if [[ ${configured_raw_days} =~ ^[0-9]+$ ]] \
      && (( configured_raw_days >= 30 && configured_raw_days <= 90 )); then
    raw_retention_days=${configured_raw_days}
  fi
fi
install -d -m 0700 -o root -g root \
  "${daily_dir}" "${monthly_dir}" "${yearly_dir}"

# Preserve and normalize backups made by the former 14-day layout so they are
# included in the new exact-count daily tier instead of becoming unbounded.
shopt -s nullglob
for legacy_backup in "${backup_root}"/hotel_ai_os-auto-*.dump.enc; do
  legacy_name="$(basename "${legacy_backup}")"
  legacy_target="${daily_dir}/hotel_ai_os-daily-${legacy_name#hotel_ai_os-auto-}"
  if [[ ! -e ${legacy_target} ]]; then
    mv -- "${legacy_backup}" "${legacy_target}"
    (cd "${daily_dir}" && \
      sha256sum "$(basename "${legacy_target}")" \
        >"$(basename "${legacy_target}.sha256")")
    chmod 0600 "${legacy_target}" "${legacy_target}.sha256"
  fi
  rm -f -- "${legacy_backup}" "${legacy_backup}.sha256"
done

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
(cd "${daily_dir}" && \
  sha256sum "$(basename "${encrypted_final}")" >"$(basename "${checksum_final}")")
chmod 0600 "${checksum_final}"

if [[ -r ${ota_runtime_env} ]]; then
  openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -salt \
    -in "${ota_runtime_env}" \
    -out "${runtime_encrypted_tmp}" \
    -pass "file:${backup_key}"
  openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 \
    -in "${runtime_encrypted_tmp}" \
    -out "${decrypted_check}" \
    -pass "file:${backup_key}"
  cmp --silent "${ota_runtime_env}" "${decrypted_check}"
  mv "${runtime_encrypted_tmp}" "${runtime_encrypted_final}"
  (cd "${daily_dir}" && \
    sha256sum "$(basename "${runtime_encrypted_final}")" \
      >"$(basename "${runtime_checksum_final}")")
  chmod 0600 "${runtime_encrypted_final}" "${runtime_checksum_final}"
  runtime_backup_created=true
fi

copy_tier_once() {
  local target=$1
  if [[ ! -e ${target} ]]; then
    cp --reflink=auto --preserve=mode,timestamps "${encrypted_final}" "${target}"
    (cd "$(dirname "${target}")" && \
      sha256sum "$(basename "${target}")" >"$(basename "${target}.sha256")")
    chmod 0600 "${target}" "${target}.sha256"
  fi
}

copy_tier_once "${monthly_dir}/hotel_ai_os-monthly-${month_key}.dump.enc"
copy_tier_once "${yearly_dir}/hotel_ai_os-yearly-${year_key}.dump.enc"
if [[ ${runtime_backup_created} == true ]]; then
  source_backup=${encrypted_final}
  encrypted_final=${runtime_encrypted_final}
  copy_tier_once "${monthly_dir}/sifangguan-ota-runtime-monthly-${month_key}.env.enc"
  copy_tier_once "${yearly_dir}/sifangguan-ota-runtime-yearly-${year_key}.env.enc"
  encrypted_final=${source_backup}
fi

prune_tier() {
  local directory=$1 pattern=$2 keep=$3
  local files=()
  mapfile -t files < <(find "${directory}" -maxdepth 1 -type f -name "${pattern}" -printf '%f\n' | sort -r)
  local index
  for ((index = keep; index < ${#files[@]}; index++)); do
    rm -f -- "${directory}/${files[index]}" "${directory}/${files[index]}.sha256"
  done
}

prune_tier "${daily_dir}" 'hotel_ai_os-daily-*.dump.enc' 30
prune_tier "${monthly_dir}" 'hotel_ai_os-monthly-*.dump.enc' 12
prune_tier "${yearly_dir}" 'hotel_ai_os-yearly-*.dump.enc' 3
prune_tier "${daily_dir}" 'sifangguan-ota-runtime-daily-*.env.enc' 30
prune_tier "${monthly_dir}" 'sifangguan-ota-runtime-monthly-*.env.enc' 12
prune_tier "${yearly_dir}" 'sifangguan-ota-runtime-yearly-*.env.enc' 3

if [[ ! -r ${offsite_env} ]]; then
  echo 'OFFSITE_BACKUP_CONFIG_REQUIRED' >&2
  exit 3
fi
test "$(stat -c '%U:%a' "${offsite_env}")" = 'root:600'
# This root-owned file contains only the pre-mounted remote target path.
# shellcheck disable=SC1090
. "${offsite_env}"
offsite_dir=${HOTEL_AI_OS_BACKUP_OFFSITE_DIR:-}
if [[ ${offsite_dir} != /* || ${offsite_dir} == / ]]; then
  echo 'OFFSITE_BACKUP_PATH_INVALID' >&2
  exit 3
fi
offsite_resolved="$(readlink -f "${offsite_dir}")"
if [[ -z ${offsite_resolved} || ${offsite_resolved} == / ]]; then
  echo 'OFFSITE_BACKUP_PATH_UNAVAILABLE' >&2
  exit 3
fi
offsite_fstype="$(findmnt -n -o FSTYPE --target "${offsite_resolved}")"
case "${offsite_fstype}" in
  nfs|nfs4|cifs|fuse.rclone|fuse.sshfs) ;;
  *) echo "OFFSITE_BACKUP_REMOTE_MOUNT_REQUIRED:${offsite_fstype}" >&2; exit 3 ;;
esac

offsite_postgres=${offsite_resolved}/postgres
install -d -m 0700 \
  "${offsite_postgres}/daily" "${offsite_postgres}/monthly" \
  "${offsite_postgres}/yearly" "${offsite_resolved}/analytics-raw"

copy_offsite_tier() {
  local source=$1 target_directory=$2
  local target=${target_directory}/$(basename "${source}")
  install -m 0600 "${source}" "${target}"
  install -m 0600 "${source}.sha256" "${target}.sha256"
  (cd "${target_directory}" && sha256sum --check "$(basename "${target}.sha256")" >/dev/null)
}

copy_offsite_tier "${encrypted_final}" "${offsite_postgres}/daily"
copy_offsite_tier \
  "${monthly_dir}/hotel_ai_os-monthly-${month_key}.dump.enc" \
  "${offsite_postgres}/monthly"
copy_offsite_tier \
  "${yearly_dir}/hotel_ai_os-yearly-${year_key}.dump.enc" \
  "${offsite_postgres}/yearly"
if [[ ${runtime_backup_created} == true ]]; then
  copy_offsite_tier "${runtime_encrypted_final}" "${offsite_postgres}/daily"
  copy_offsite_tier \
    "${monthly_dir}/sifangguan-ota-runtime-monthly-${month_key}.env.enc" \
    "${offsite_postgres}/monthly"
  copy_offsite_tier \
    "${yearly_dir}/sifangguan-ota-runtime-yearly-${year_key}.env.enc" \
    "${offsite_postgres}/yearly"
fi
prune_tier "${offsite_postgres}/daily" 'hotel_ai_os-daily-*.dump.enc' 30
prune_tier "${offsite_postgres}/monthly" 'hotel_ai_os-monthly-*.dump.enc' 12
prune_tier "${offsite_postgres}/yearly" 'hotel_ai_os-yearly-*.dump.enc' 3
prune_tier "${offsite_postgres}/daily" 'sifangguan-ota-runtime-daily-*.env.enc' 30
prune_tier "${offsite_postgres}/monthly" 'sifangguan-ota-runtime-monthly-*.env.enc' 12
prune_tier "${offsite_postgres}/yearly" 'sifangguan-ota-runtime-yearly-*.env.enc' 3

if [[ -d ${analytics_raw} ]]; then
  cp -a --no-preserve=ownership "${analytics_raw}/." "${offsite_resolved}/analytics-raw/"
  find "${offsite_resolved}/analytics-raw" -xdev -type f -name '*.json.enc' \
    -mtime "+${raw_retention_days}" -delete
  find "${offsite_resolved}/analytics-raw" -xdev -depth -type d -empty -delete
fi

rm -f -- "${plain_dump}" "${decrypted_check}"
trap - EXIT INT TERM

printf '%s\n' 'POSTGRES_BACKUP_OK'
printf 'retention=daily:30,monthly:12,yearly:3 offsite=%s\n' "${offsite_resolved}"
stat -c '%U:%G:%a:%s:%n' "${encrypted_final}" "${checksum_final}"
