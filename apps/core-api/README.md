# Core API

Java 21 + Spring Boot 模块化单体。业务模块按顶级包隔离：

- `organization`
- `iam`
- `standards`
- `workdata`
- `metrics`
- `dashboard`
- `shared`

## 本地运行

准备PostgreSQL数据库和非表所有者的运行账号后：

```powershell
$env:DB_URL='jdbc:postgresql://localhost:5432/hotel_ai_os'
$env:DB_USERNAME='hotel_ai_os_app'
$env:DB_MIGRATION_USERNAME='hotel_ai_os_owner'
$env:DEV_HEADER_AUTH_ENABLED='true'
# 从本地密钥管理工具向当前进程注入DB_PASSWORD和DB_MIGRATION_PASSWORD；仓库不提供默认值。
mvn spring-boot:run
```

Flyway会从仓库根目录`database/migrations`打包并执行迁移。任一数据库密码变量缺失或为空时，应用必须在启动阶段失败。

## 联调身份

```text
X-Tenant-Id: 10000000-0000-0000-0000-000000000001
X-Actor-Id: 19000000-0000-0000-0000-000000000001
X-Role-Code: CEO
X-Org-Scope:
```

这些请求头仅为Sprint 1本地联调契约，默认关闭，只有显式设置`DEV_HEADER_AUTH_ENABLED=true`才启用。上线前必须接入受信JWT/SSO，并从数据库授权派生角色和组织范围。

## 测试

```powershell
mvn test
```

测试覆盖租户上下文、配置权限、门店范围拒绝、RLS迁移契约和发布配置密钥边界。PostgreSQL集成测试使用隔离的临时凭据，不依赖主配置回退值。
