# OTA-AUTOMATION-V0.1 Sprint 0 实施报告

任务编号：`OTA-AUTOMATION-V0.1`
实施日期：2026-07-23
业务基线：`DESIGN-1.5`
技术基线：`TECH-DESIGN-1.0`
制品版本：`0.1.0-SNAPSHOT` / Web `0.1.0-sprint0`
当前判断：`SPRINT 0 GO / SPRINT 1 HOLD / PRODUCTION NO-GO`

---

## 一、实施结论

产品负责人已明确下达“开始编码”，Sprint 0 的独立工程骨架、安全底座、数据契约、连接器 SPI、数据库 V1 迁移、本地账号认证及登录壳已经完成，并通过当前阶段的自动化验证。

本次只实现 TECH-DESIGN-1.0 冻结的 Sprint 0，不提前实现 Sprint 1 至 Sprint 4：当前没有真实 PMS、携程、美团连接器，没有小时经营计算、P1 状态机运行链路和企业微信真实投递，也没有把任何试点门店的 `message_enabled` 打开。因此，Sprint 0 通过不等于完整业务闭环已经可用，更不等于双店可以上线。

## 二、交付范围

### 2.1 独立工程

| 模块 | 位置 | Sprint 0 交付 |
|---|---|---|
| 契约包 | `packages/ota-contracts` | 标准记录、时间/质量元数据、连接器 SPI、领域端口、配置安全约束、JSON Schema 与 OpenAPI 认证契约 |
| 独立 API | `apps/ota-standalone-api` | 本地账号认证、Argon2id、短期 Access JWT、Refresh Token 轮换与复用检测、CSRF/CORS/Cookie、安全响应头、首位管理员受控引导、审计、RLS 事务执行器和生产启动门禁 |
| 连接器 Worker | `apps/ota-connector-worker` | 连接器注册、作业定义/目录端口和调度边界；模拟实现只存在于测试，不运行真实采集 |
| 独立 Web | `apps/ota-standalone-web` | React/Vite 登录壳、Access Token 仅内存保存、Refresh/CSRF Cookie、单飞刷新、到期前刷新和退出登录边界 |
| 数据库 | `database/ota-migrations` | 独立 Flyway V1、安全结构、RLS、追加事实约束、精确 GRANT 与静态/真实 PostgreSQL 验证资产 |
| 部署 | `infra/ota` | 独立 PostgreSQL 与 role bootstrap → Flyway → grants → verifier 的一次性严格部署链 |

根聚合构建使用 `ota-platform-pom.xml`，不会把现有 `apps/core-api` 或 `apps/web` 作为独立 OTA 后台的运行时依赖。

### 2.2 数据与权限底座

- 建立 11 张 `control` 表和 12 张 `ota` 租户表。
- 12 张租户表全部启用并强制 PostgreSQL RLS；缺失、非法或错误租户上下文时拒绝读取租户数据。
- `control.audit_event`、`ota.ota_incident_occurrence`、`ota.ota_task_event`、`ota.ota_outbox_event` 为追加事实，数据库触发器拒绝更新和删除。
- 角色 bootstrap 分离数据库管理员、migration owner、API、Worker 和 Audit writer；运行角色均为非超级用户、`NOBYPASSRLS`、非对象 owner。
- API 只获得当前认证仓储和迁移历史读取所需的逐对象权限；Worker 在 Sprint 0 只有数据库 `CONNECT`；Audit writer 只能追加审计。
- 显式撤销 `public` schema 对 PUBLIC 和三类运行角色的 `CREATE`，兼容 PostgreSQL 14 及旧数据卷的默认权限差异。
- 凭据值不得进入业务表、配置文件、日志或聊天；代码只保存 SecretStore 引用、密码摘要和 Refresh Token 摘要。

### 2.3 本地账号安全边界

- Access Token 只驻留浏览器内存，不写入 localStorage/sessionStorage/Cookie。
- Refresh Token 使用 `HttpOnly` Cookie，CSRF Token 使用独立 Cookie/Header 双提交。
- Refresh Token 每次刷新轮换；检测到旧 Token 复用时撤销对应会话族。
- 认证成功、失败、拒绝、刷新、复用检测、退出、管理员引导和受控命令均进入追加审计。
- 首位平台管理员只能通过受控离线引导建立；生产模式会校验数据库角色、迁移版本、签名密钥、Cookie 和数据库安全属性，失败时拒绝启动。
- API 默认关闭运行期 Flyway，迁移只能由独立部署作业执行。

## 三、验证证据

| 验证项 | 结果 | 说明 |
|---|---|---|
| Maven 聚合测试 | PASS | 58 项；0 失败、0 错误、1 条条件式 PostgreSQL 测试在普通聚合构建中跳过 |
| 真实 PostgreSQL 14.22 集成测试 | PASS | 单独启动一次性实例后 1/1 通过，覆盖非 owner、`NOBYPASSRLS`、无租户/错租户/正确租户可见性和追加事实保护；实例已停止并清理 |
| 契约模块 | PASS | 25 项测试通过 |
| 独立 API | PASS | 24 项测试，0 失败、0 错误；普通聚合构建中的 1 条真实数据库条件测试由上述 1/1 专项运行补证 |
| Worker | PASS | 9 项测试通过 |
| Web | PASS | 6 项 Node 测试通过，TypeScript 与 Vite 生产构建通过 |
| V1 数据库结构门禁 | PASS | 11 张 control 表、12 张 FORCE RLS 租户表、4 个追加事实保护和 7 个固定角色通过 |
| 部署结构门禁 | PASS | 一次性迁移边界、API Flyway 默认关闭、精确授权矩阵和 `public` schema CREATE 收口通过 |
| 敏感值扫描 | PASS | Sprint 0 新增范围未发现企微 Webhook、Bearer JWT、API Key 或非空密码/Token/Secret 值 |
| 架构边界扫描 | PASS | 生产源未依赖 `cn.sifangguan.hotelaios`、`apps/core-api` 或 AI 中台数据库迁移；仅测试中存在禁止依赖的断言文本 |

主要复验命令：

```powershell
mvn -f .\ota-platform-pom.xml test

Set-Location .\apps\ota-standalone-web
npm test
npm run build

Set-Location ..\..
powershell -NoProfile -ExecutionPolicy Bypass -File .\database\ota-migrations\verify-structure.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File .\infra\ota\verify-deployment-structure.ps1

# 需要 PostgreSQL bin 目录；本轮已用 PostgreSQL 14.22 执行并通过
powershell -NoProfile -ExecutionPolicy Bypass `
  -File .\database\ota-migrations\verify-real-postgresql.ps1 `
  -PostgresBin <postgres-bin-directory>
```

## 四、尚未实现与保留限制

1. 当前不能抓取真实 PMS、携程或美团数据；真实账号、登录态、接口/页面字段和风控策略尚未接入。
2. 当前不能生成用户示例中的小时经营简报，也不会即时触发 P1 或向企业微信群发送消息。
3. 当前 Web 只提供安全登录壳，不包含租户、门店、房型映射、连接器、目标曲线、值班表、P1 和投递配置页面。
4. 当前 Worker 只冻结 SPI 和作业边界，没有真实调度、持久化 adapter 或业务编排。
5. 本机没有 Docker CLI，因此完整 Compose 一次性部署链未做容器级实跑；部署结构门禁已通过，V1 与 RLS 已在真实 PostgreSQL 14.22 单独通过。
6. `post-migration-grants.sql` 与 `verify-runtime-grants.sql` 已完成静态门禁，但尚未通过完整 Compose 以不同运行身份做一次端到端目录验收；该项必须在目标 UAT 数据库开通前补跑。
7. 双店上线仍必须分别连续通过 3 个 PMS 营业日 UAT，并在隔离环境验证真实企微 Webhook、`@所有人`、全部旧简报补发、P1 即时告警和第三家模拟门店无代码扩店。

## 五、阶段门禁

| 阶段 | 当前状态 | 下一门禁 |
|---|---|---|
| Sprint 0 安全底座与工程骨架 | GO / COMPLETE | 本报告及自动化证据保持通过 |
| Sprint 1 模拟闭环 | HOLD | 产品负责人明确确认进入 Sprint 1；只使用模拟来源与测试群/禁发通道 |
| Sprint 2 真实连接器 | NO-GO | 两店 PMS/OTA 厂商、版本、接入方式、字段样例、专用账号和隔离联调环境齐备 |
| Sprint 3 分析、P1 与企微 | NO-GO | Sprint 2 事实层验收通过，测试 Webhook 和投递安全门禁通过 |
| Sprint 4 双店 UAT 与发布 | NO-GO | 每店连续 3 个 PMS 营业日全部验收项通过 |
| 生产发布 | NO-GO | 安全、备份恢复、监控、值班、真实账号生命周期和发布签署全部完成 |

Sprint 0 完成不会自动启动 Sprint 1。下一次编码必须继续遵守 DESIGN-1.5、TECH-DESIGN-1.0 和“一阶段一门禁”的范围约束。
