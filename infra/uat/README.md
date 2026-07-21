# Sprint 2.1 本地UAT数据库

该目录只提供可丢弃的PostgreSQL UAT环境，不是生产部署方案。业务API和Web仍从工作区本地构建并启动。

## 隔离边界

- Compose项目名固定为`hotel-ai-os-uat`。
- 宿主机默认端口为`55432`，避免占用现有开发库的`5432`。
- 数据卷固定为`hotel-ai-os-uat-postgres`。
- fixture只挂载自`database/uat`，不会被Spring/Flyway扫描。
- `hotel_ai_os_owner`只用于迁移和fixture；API使用无`BYPASSRLS`的`hotel_ai_os_app`。
- `.env.example`中的口令仅供本机UAT，禁止复制到生产环境。

## 使用

在本目录复制环境文件：

```powershell
Copy-Item .env.example .env
```

推荐从仓库根目录运行：

```powershell
.\tools\uat\Start-UatEnvironment.ps1
.\tools\uat\Invoke-UatApiSmoke.ps1
```

完整重建数据库时必须显式确认：

```powershell
.\tools\uat\Start-UatEnvironment.ps1 -ResetDatabase -Force
```

该命令仅删除名为`hotel-ai-os-uat-postgres`的UAT数据卷。不要手工修改Compose项目名或数据卷名后继续使用重建参数。

## 身份说明

当前本地正式UAT路径使用临时RS256 OIDC/JWKS服务签发Bearer JWT，并强制`DEV_HEADER_AUTH_ENABLED=false`。角色、权限、组织范围和任职仍由服务端从PostgreSQL解析，客户端不能自报角色或范围；匿名、过期、错误签名、错误受众和错误签发方等负向用例必须返回401。

该OIDC服务只用于本地可重复技术验收。真实企业SSO的issuer、JWKS、账号生命周期、停用与退出失效、六角色真实账号及安全签署仍是正式发布门槛，不能由本地模拟服务替代。
