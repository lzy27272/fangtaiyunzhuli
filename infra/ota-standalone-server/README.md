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
- 日常代码发布包不得包含 Windows `.uat-runtime`、DPAPI 密钥、Cookie、
  Webhook、密码或服务器运行数据。
- 当前服务器已通过受控密文迁移接收既有门店配置；后续代码发布只切换
  `/opt/sifangguan-ota/releases`，不得覆盖 `/var/lib/sifangguan-ota`。
- `/etc/sifangguan-ota/runtime.env` 只存在服务器，权限为
  `0640 root:sifangguan-ota`，不得提交 Git。

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

## 后续一键发布

功能修改必须先提交到 Git。确认当前分支的提交可发布后，在项目根目录执行：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File `
  infra\ota-standalone-server\scripts\Publish-OtaStandaloneServer.ps1
```

脚本会依次完成：

1. 核对 GitHub 远程仓库必须是
   `lzy27272/OTAyunyingtuisongzhushou.git`；
2. 拒绝发布存在未提交代码修改的工作区；
3. 运行前端测试和构建；
4. 仅打包前端产物及 API 必需运行文件；
5. 扫描 Git 推送差异和发布包中的敏感信息；
6. 将精确提交快进推送到 `ota-yunying/main`；
7. 上传发布包并原子切换服务器版本；
8. 检查 API、Web、回环监听和当前提交；
9. 健康检查失败或门店密文、后台认证、运行密钥发生意外变化时，自动恢复
   上一代码版本及受保护运行状态。

只查看发布计划：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File `
  infra\ota-standalone-server\scripts\Publish-OtaStandaloneServer.ps1 `
  -Mode Plan
```

只生成并扫描发布包、不上传服务器：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File `
  infra\ota-standalone-server\scripts\Publish-OtaStandaloneServer.ps1 `
  -Mode Package
```

日常发布不需要重新配置服务器，也不需要重新填写保存在
`/var/lib/sifangguan-ota` 的门店数据、账号密码、Cookie 或 Webhook。只有运行数据
结构或加密边界发生重大变化时，才使用独立迁移流程。

## 大模型建议增强

远期房态简报支持可选的 OpenAI 兼容接口。规则引擎始终生成经营事实和结论；
大模型只补充“先做、策略、复盘”三行建议。接口超时、鉴权失败、限流、返回格式
错误或安全校验不通过时，系统自动使用规则建议继续发送简报。

运行配置只保存在服务器 `/etc/sifangguan-ota/runtime.env`，禁止将 API Key
提交到 Git、写入聊天、浏览器配置、普通日志或发布包。所需变量名称见
`runtime.env.example`。其中 `OTA_REVIEW_AI_API_KEY_B64` 是 API Key 的 Base64
编码，仅用于安全写入环境文件，不代表加密；该文件继续保持
`root:sifangguan-ota 0640`。

启用前必须确认：

- 接口为公网 HTTPS、标准 443 端口且不发生重定向；
- 模型支持 OpenAI 兼容的 `/chat/completions`；
- 只发送未来14天按日期汇总的售卖率、余房、ADR和间夜变化；
- 健康检查中的 `aiAdvice.enabled` 与 `aiAdvice.ready` 均为 `true`；
- 完成一次受控手动远期简报测试，再允许等待自动发送。

选择供应商和模型后，在本机 PowerShell 运行配置脚本。API Key 由隐藏输入框
读取，经 SSH 标准输入送到服务器，不进入命令行参数或终端输出：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File `
  infra\ota-standalone-server\scripts\Configure-OtaAiProvider.ps1 `
  -BaseUrl 'https://供应商的兼容接口/v1' `
  -Model '供应商模型编码'
```

脚本会先用合成汇总数据测试模型。测试失败时恢复原配置且不重启线上服务；测试
通过后才重启 API，并核验健康状态。关闭模型增强时运行：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File `
  infra\ota-standalone-server\scripts\Configure-OtaAiProvider.ps1 `
  -Disable
```

## 必须备份

至少备份：

- `/var/lib/sifangguan-ota`：门店、接口、快照、发送记录和加密后的凭据；
- `/etc/sifangguan-ota/runtime.env`：解密密钥与后台登录秘密。

两者必须一起备份并加密保存；缺少 `runtime.env` 时，历史加密凭据不可恢复。
