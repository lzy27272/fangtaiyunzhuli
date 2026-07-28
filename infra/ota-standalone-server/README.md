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

## 当前服务器采用的部署方式

腾讯轻量云可以连接 Node.js 官方下载站，但到 GitHub/Docker Hub 的连接不稳定。
因此当前服务器采用原生 systemd 部署：

- Node.js 24 LTS 官方 Linux 二进制，并校验官方 SHA-256；
- 服务器已有 Caddy 2.11.4；
- 本机构建前端并上传完整发布包；
- API 与 Web 分别由 systemd 自动启动和恢复。

Dockerfile 与 Compose 保留为网络条件允许时的替代方案，不用于当前服务器。

## 首次部署

服务器必须先安装本项目专用 SSH 公钥。之后从本机执行：

```powershell
ssh -i "$env:USERPROFILE\.ssh\sifangguan_tencent_ota_ed25519" `
  ubuntu@43.136.184.38
```

首次部署由本机上传完整发布包后，在服务器执行：

```bash
sudo bash \
  <上传目录>/infra/ota-standalone-server/scripts/bootstrap-native-ubuntu.sh

sudo env \
  SFG_OTA_RELEASE_ARCHIVE=<发布包路径> \
  SFG_OTA_RELEASE_COMMIT=<40位Git提交> \
  SFG_OTA_RELEASE_SHA256=<发布包SHA-256> \
  bash <上传目录>/infra/ota-standalone-server/scripts/deploy-native.sh
```

部署脚本先验证发布包哈希和路径安全，再切换不可变发布目录并检查
`8091/health` 和 `5180`。健康检查失败时，如存在上一版本，会恢复上一版本。

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

首次登录用户名为 `review-admin`，随机初始密码只保存在服务器
`/etc/sifangguan-ota/runtime.env`。登录后由平台管理员在“账号安全”页面自行修改
账号和密码；新密码只以 scrypt 哈希写入
`/var/lib/sifangguan-ota/review-auth-state.json`，修改成功后旧登录会话失效。
任何真实密码都不要粘贴到聊天、文档或 Git。

## 状态检查

```bash
sudo bash \
  /opt/sifangguan-ota/current/infra/ota-standalone-server/scripts/status-native.sh
```

只有同时看到两个 systemd 服务为 active、API 返回 `UP`，并确认 5180/8091 仅监听
`127.0.0.1`，才能认定服务器运行态正常。

## 后续发布

代码通过测试并推送 GitHub 后，在本机重新构建前端、生成包含精确 Git 提交的
发布包并上传，再执行 `deploy-native.sh`。不需要重新配置服务器或重新填写已保存
在 `/var/lib/sifangguan-ota` 的门店数据和加密凭据。只有数据结构或安全边界发生
重大变化时，才需要单独迁移。

## 必须备份

至少备份：

- `/var/lib/sifangguan-ota`：门店、接口、快照、发送记录和加密后的凭据；
- `/etc/sifangguan-ota/runtime.env`：解密密钥与后台登录秘密。

两者必须一起备份并加密保存；缺少 `runtime.env` 时，历史加密凭据不可恢复。
