# Sprint 2.1 UAT工具

工具只编排本地UAT基础设施和证据，不修改业务前后端源码。

## 1. 启动真实环境

```powershell
.\tools\uat\Start-UatEnvironment.ps1
```

它会：

1. 启动独立PostgreSQL容器。
2. 用owner执行Flyway V1—V13，API使用无`BYPASSRLS`的runtime账号。
3. 显式导入`database/uat` fixture并执行断言。
4. 构建并后台启动真实API。
5. 以`VITE_ENABLE_DEMO_FALLBACK=false`构建并启动Web预览。

如需清空全部UAT状态：

```powershell
.\tools\uat\Start-UatEnvironment.ps1 -ResetDatabase -Force
```

## 2. 运行真实API闭环

```powershell
.\tools\uat\Invoke-UatApiSmoke.ps1
```

脚本验证前台员工、前厅主管、客房主管、店助、店总、区域运营六角色的`/iam/me`和角色资源，并形成三条真实流程证据：

1. A：客房照片 → 卫生标准评价 → 整改任务 → 客房主管执行 → 店总验收。
2. B：前台客诉提交 → 标准判断 → 规则触发 → 任务 → 关闭。
3. C：未提交 → `MISSED`扫描 → 提醒通知 → 整改任务 → 逾期升级。

JSON、下载图片和Correlation ID证据写入`docs/uat/evidence/<run-id>/api`。脚本要求从干净UAT数据卷执行；复跑完整流程前使用`-ResetDatabase -Force`。

该脚本是UAT技术骨架，不替代业务人员逐角色签字。

正式现场照片复验必须传入原始PNG/JPEG及完整来源元数据；脚本拒绝小于1 KiB的文件，也不会把本机绝对路径写入证据：

```powershell
.\tools\uat\Invoke-UatApiSmoke.ps1 `
  -RunId 'tech-v0.2-field-photo' `
  -PhotoPath 'D:\uat-input\room-hygiene.jpg' `
  -PhotoHotel '试点门店编码' `
  -PhotoMaskedRoom '8**' `
  -PhotoCapturedAt '2026-07-18T10:30:00+08:00' `
  -PhotoCapturedBy '客房主管姓名或受控人员编号' `
  -PhotoIssueDescription '卫生问题说明'
```

不提供`-PhotoPath`时仍使用68字节技术fixture，只能用于自动化回归，不能关闭现场照片门禁。

## 3. 截图

截图工具使用独立Playwright依赖：

```powershell
pnpm --dir .\tools\uat install
$env:UAT_RUN_ID = '填写与API证据相同的run-id'
pnpm --dir .\tools\uat capture
```

脚本默认复用本机Edge：

```text
C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe
```

如浏览器位于其他路径，设置`UAT_BROWSER_EXECUTABLE`。脚本不假设已经下载Playwright Chromium。它使用1440x1050视口，逐角色写入localStorage验收账号，访问真实页面hash，并拒绝把“演示回退”或API错误页面当成通过证据。

截图矩阵以`scenario`和`flow`字段分别标注A、B、C三条业务链，明确包含客房主管图片整改、店总驾驶舱与验收、前台客诉闭环、漏交提醒与升级；区域多门店运营页作为额外的`SCOPE`隔离证据保留，不能替代A、B、C任一场景。

截图名遵循：

```text
tech-v0.2-{case-id}-{role-key}-{view}-{timestamp}.png
```

每次运行同时生成`manifest.json`和`manifest.md`。

## 4. 停止

```powershell
.\tools\uat\Stop-UatEnvironment.ps1 -StopDatabase
```

删除UAT数据卷必须显式执行：

```powershell
.\tools\uat\Stop-UatEnvironment.ps1 -RemoveDatabase -Force
```

## 当前依赖边界

- 本地UAT使用临时RS256 OIDC/JWKS和Bearer JWT并关闭开发身份头；真实企业SSO、账号生命周期、停用和退出失效仍需目标环境单独验收。
- 图片上传、附件查询/下载/删除及ClamAV fail-closed扫描已可验收；UAT仍使用隔离本地文件存储，目标对象存储、加密、生命周期和备份恢复仍是发布门禁。
- 工作期望SLA处理器、可配置调度器、任务逾期/升级处理器已由真实后台Worker验证；目标环境仍需启用调度、监控、告警及恢复演练。
- 工作包完整编辑器尚未开放；API可配置，页面只验收现有查询/入口能力。
# TECH-V0.2 signed-JWT release-candidate mode

The UAT launcher uses the production authentication chain: `DEV_HEADER_AUTH_ENABLED=false`,
an ephemeral local RS256 OIDC/JWKS issuer, and one signed bearer token per UAT role. The private
key stays in the issuer process; bearer tokens are written only to the ignored
`.uat-runtime/identity/tokens.json` file and are never copied into committed evidence.

On a workstation without Docker, the normal launcher automatically delegates to the real
Embedded PostgreSQL host:

```powershell
.\tools\uat\Start-UatEnvironment.ps1
# Equivalent explicit launcher with a stable evidence run id:
.\tools\uat\Start-EmbeddedUatEnvironment.ps1 -RunId 'tech-v0.2-rc-final'
```

Both launchers fail unless anonymous `/api/v1/iam/me` returns `401` and a signed role token
returns `200`. Run the API and screenshot evidence with the same ignored token file:

```powershell
.\tools\uat\Invoke-UatApiSmoke.ps1 -ApiOrigin '<launcher output>' -RunId 'tech-v0.2-rc-final'
$env:UAT_RUN_ID = 'tech-v0.2-rc-final'
$env:UAT_TOKEN_FILE = (Resolve-Path '.\.uat-runtime\identity\tokens.json')
pnpm --dir .\tools\uat capture
```

The screenshot runner records page URL/title, nonblank rendering, overlay state, console/network
health, and a navigation interaction proof for every case. It uses local Playwright because the
Browser plugin is unavailable in this workspace.
