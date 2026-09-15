# Ubuntu production runtime drafts

These files are installation inputs for the Ubuntu 24.04 / 4 CPU / 8 GiB
server. They do not contain credentials and do not deploy anything by
themselves.

## 数据留存与备份

经营分析数据按以下固定策略运行：小时事实保留 48 个月，日终事实保留 2 年，
月/季/半年/年度汇总保留 5 年；原始响应必须先脱敏、再使用独立密钥执行
AES-256-GCM 加密，保留天数只能配置为 30–90 天（默认 90 天）。

PostgreSQL 备份按数量精确保留 30 个日备份、12 个月备份和 3 个年度备份。
`/etc/hotel-ai-os/backup-offsite.env` 必须由 root 创建（0600），并指向已经挂载的
NFS、CIFS、rclone 或 SSHFS 异机目录，例如：

```dotenv
HOTEL_AI_OS_BACKUP_OFFSITE_DIR=/mnt/hotel-ai-os-offsite
```

没有远端挂载、远端校验失败或异机副本缺失时，备份任务和健康检查都会明确失败，
不会把同机目录误报为异机备份。OTA `runtime.env`（含原始响应解密密钥）会再用
数据库备份密钥加密后随三个层级保存；`backup-encryption.key` 本身必须单独离线
托管，不能与异机密文放在同一存储位置。

## Expected server paths

| Repository file | Server path |
| --- | --- |
| `systemd/hotel-ai-os-core-api.service` | `/etc/systemd/system/hotel-ai-os-core-api.service` |
| `caddy/Caddyfile` | `/etc/caddy/Caddyfile` |
| `postgresql/99-sfgzt.conf` | `/etc/postgresql/16/main/conf.d/99-sfgzt.conf` |

The active backend JAR is
`/opt/hotel-ai-os/current/core-api.jar`; the active static site is
`/srv/www/hotel-ai-os/current`. Both `current` entries should be atomic
symlinks to immutable release directories.

Create `/etc/hotel-ai-os/core-api.env` only on the server, owned by
`root:hotelai` with mode `0640`. The current application configuration requires
at least `DB_URL`, `DB_USERNAME`, `DB_PASSWORD`, `DB_MIGRATION_USERNAME`, and
`DB_MIGRATION_PASSWORD`. Set the selected identity mode and its required JWT or
local-login values explicitly. Production also needs the attachment storage and
Linux malware-scanner settings; do not reuse the Windows AMSI command.

The non-secret part of that file should start from the application's current
configuration keys:

```dotenv
DB_POOL_SIZE=12
DEV_HEADER_AUTH_ENABLED=false
DB_RLS_ENABLED=true
AUTOMATION_WORKER_ENABLED=false
WORK_EXPECTATION_SLA_SCHEDULER_ENABLED=false
ATTACHMENT_STORAGE_ROOT=/var/lib/hotel-ai-os/attachments
ATTACHMENT_SCAN_COMMAND_PATH=/usr/bin/clamscan
ATTACHMENT_SCAN_COMMAND_ARGUMENTS=--no-summary|{file}
ATTACHMENT_SCAN_ALLOW_SANITIZED_IMAGE_FALLBACK=false
WEB_ALLOWED_ORIGINS=https://www.sfgzt.cn
WECOM_ENABLED=false
WECOM_WORKER_ENABLED=false
WECOM_BOT_ACTIONS_ENABLED=false
```

The systemd command line intentionally fixes `server.address` and `server.port`
to `127.0.0.1:18080`, regardless of environment-file values. Leave
`LOGGING_FILE_NAME` unset so Spring logs to journald under the service sandbox.

## Validate before enabling

Run these commands on the server after copying the files, before exposing ports
80 or 443:

```bash
sudo systemd-analyze verify /etc/systemd/system/hotel-ai-os-core-api.service
sudo caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
sudo -u postgres /usr/lib/postgresql/16/bin/postgres \
  -D /var/lib/postgresql/16/main -C listen_addresses
sudo -u postgres /usr/lib/postgresql/16/bin/postgres \
  -D /var/lib/postgresql/16/main -C max_connections
```

After a controlled PostgreSQL restart and service start, verify loopback-only
listeners and health:

```bash
sudo ss -lntp
sudo -u postgres psql -Atqc \
  "select current_setting('listen_addresses'), current_setting('password_encryption');"
curl --fail --silent --show-error http://127.0.0.1:18080/actuator/health
sudo journalctl -u hotel-ai-os-core-api --since=-10m --no-pager
```

Do not open PostgreSQL port `5432` or Core API port `18080` in UFW. Caddy is the
only intended public entry point, and 80/443 should remain closed until the
mainland-domain/ICP cutover is authorized.
