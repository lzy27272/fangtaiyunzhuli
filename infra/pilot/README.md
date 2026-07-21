# 贵州四方馆酒店管理有限公司中台 Pilot 部署

本目录部署 `TECH-V0.2-PILOT.1` 的演示数据内部测试通道，目标域名为 `https://www.sfgzt.cn`。

## 部署边界

- 当前制品只用于页面、角色视图和流程导航走查，固定显示“Pilot 演示数据”。
- 当前制品不会连接真实业务API，不包含数据库、JWT、测试令牌或附件文件。
- 真实业务UAT必须另行接入企业SSO/JWT、持久化PostgreSQL、对象存储、文件扫描、备份和监控；不得把本地Mock OIDC或开发请求头认证暴露到公网。

## 构建

```powershell
cd apps/web
pnpm run build:pilot
```

## 当前 Windows 试点服务器

当前办公室电脑作为 Pilot 内部测试服务器，使用 Caddy Windows Service 承载静态站点：

- 服务名：`SifangguanPilot`
- 服务启动模式：自动
- 当前状态：运行中，仅监听`127.0.0.1:4180`
- Windows 防火墙：不开放Pilot公网入站端口
- 公网入口：固定Cloudflare Named Tunnel出站连接
- Tunnel服务：`SifangguanPilotTunnel`，自动启动
- 正式Pilot网址：`https://www.sfgzt.cn`

安装或更新服务：

```powershell
# 需要管理员 PowerShell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\tools\pilot\Install-PilotWindowsService.ps1
```

检查状态：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\tools\pilot\Get-PilotServerStatus.ps1
```

固定Named Tunnel已创建并安装为Windows自动启动服务；历史Quick Tunnel已停止。

## Linux / 容器目标服务器启动

前提：域名A/AAAA记录已指向服务器，80和443端口已开放，服务器已安装Docker Compose。

```bash
docker compose -f infra/pilot/compose.yml up -d --build
```

Caddy在域名解析生效后自动申请和续期HTTPS证书。根域名会永久重定向到 `www.sfgzt.cn`。

## 上线检查

1. `https://www.sfgzt.cn` 返回200且证书有效。
2. 浏览器标题和侧边栏显示“贵州四方馆酒店管理有限公司中台”。
3. 页面明确显示“Pilot Test Version / 内部测试版 / Pilot 演示数据”。
4. 任务中心导航可用，控制台无页面运行错误。
5. `http://sfgzt.cn` 跳转到 `https://www.sfgzt.cn`。

## 中国大陆部署提示

若服务器位于中国大陆，开通网站前需确认ICP备案；备案号取得后还需按要求在页面底部展示并链接工信部备案系统。备案号未提供前，本制品不虚构备案信息。
