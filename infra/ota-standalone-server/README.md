# OTA 独立后台腾讯轻量云部署

这套配置用于把当前 OTA 独立后台迁移到 Ubuntu 24.04 轻量云，作为受控
UAT/长期运行环境。它包括：

- OTA 管理页面；
- PMS/OTA 只读采集 API；
- 自动整点采集、简报及 P1 风险检测；
- 企微机器人投递；
- 服务器本地加密的 Cookie、账号密码和 Webhook 存储。

它不表示正式生产放行，也不会启用自动调价或自动修改库存。

## 安全边界

- Web 和 API 只监听服务器的 `127.0.0.1:5180/8091`。
- Docker Compose 不发布任何公网端口。
- 管理页面先通过 SSH 隧道访问；域名和 HTTPS 单独完成后才能开放公网入口。
- 不复制 Windows `.uat-runtime`、DPAPI 密钥、Cookie、Webhook 或密码。
- 服务器首次启动后，所有真实凭据必须由用户在服务器后台重新配置。
- `/etc/sifangguan-ota/runtime.env` 只存在服务器，权限为 `0600`，不得提交 Git。

## 首次部署

服务器必须先安装本项目专用 SSH 公钥。之后从本机执行：

```powershell
ssh -i "$env:USERPROFILE\.ssh\sifangguan_tencent_ota_ed25519" `
  ubuntu@43.136.184.38
```

在服务器 SSH 会话中执行：

```bash
git clone --depth=1 \
  https://github.com/lzy27272/OTAyunyingtuisongzhushou.git \
  /tmp/sifangguan-ota-bootstrap
sudo bash \
  /tmp/sifangguan-ota-bootstrap/infra/ota-standalone-server/scripts/bootstrap-ubuntu.sh
sudo bash \
  /tmp/sifangguan-ota-bootstrap/infra/ota-standalone-server/scripts/deploy.sh
```

部署脚本从 GitHub `main` 获取精确提交，先构建镜像，再更新容器并检查
`8091/health` 和 `5180`。健康检查失败时，如存在上一版本，会恢复上一版本容器。

## 从本机打开服务器后台

保持下面的 SSH 隧道窗口运行：

```powershell
ssh -N `
  -i "$env:USERPROFILE\.ssh\sifangguan_tencent_ota_ed25519" `
  -L 15180:127.0.0.1:5180 `
  ubuntu@43.136.184.38
```

浏览器打开：

```text
http://127.0.0.1:15180
```

登录用户名固定为 `review-admin`。随机登录密码只保存在服务器
`/etc/sifangguan-ota/runtime.env`；请在自己的 SSH 会话中读取，不要粘贴到聊天、
文档或 Git。

## 状态检查

```bash
sudo bash \
  /opt/sifangguan-ota/current/infra/ota-standalone-server/scripts/status.sh
```

只有同时看到两个容器为 healthy、API 返回 `UP`，并确认 5180/8091 仅监听
`127.0.0.1`，才能认定服务器运行态正常。

## 后续发布

代码通过测试并推送 GitHub 后，在服务器执行：

```bash
sudo bash \
  /opt/sifangguan-ota/current/infra/ota-standalone-server/scripts/deploy.sh
```

不需要重新配置服务器或重新填写已保存在 `/var/lib/sifangguan-ota` 的门店数据和
加密凭据。只有数据结构或安全边界发生重大变化时，才需要单独迁移。

## 必须备份

至少备份：

- `/var/lib/sifangguan-ota`：门店、接口、快照、发送记录和加密后的凭据；
- `/etc/sifangguan-ota/runtime.env`：解密密钥与后台登录秘密。

两者必须一起备份并加密保存；缺少 `runtime.env` 时，历史加密凭据不可恢复。
