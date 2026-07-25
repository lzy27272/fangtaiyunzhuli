# OTA-AUTOMATION-V0.1 独立数据库迁移

本目录是独立 OTA 后台的数据库发布资产，不与 AI 中台的迁移集混用。

## 文件职责

- `V1__sprint0_security_foundation.sql`：Sprint 0 安全基座 Flyway 版本迁移。
- `V2__sprint1_simulation_closed_loop.sql`：Sprint 1 模拟采集、分析、P1、简报和投递预览闭环。
- `V3__sprint2_offline_safety_foundation.sql`：Sprint 2A 会话主体绑定、普通采集安全事实层和精确分钟槽。
- `V4__sprint2b_real_prep_control_plane.sql`：Sprint 2B 不可运行的真实接入资料配置态、Secret引用约束和合同批准基线。
- `V5__sprint2c_contract_governance_and_principal_rotation.sql`：Sprint 2C服务端可信候选、批准/吊销追加证据、有效基线窄读和`CONNECTOR_WORKER`蓝绿身份轮换门禁。
- `seed-sprint1-simulation-worker-principal.sql`：V2 完成后由 migration owner 执行的幂等非秘密 Worker 工作负载身份种子；它不是 Flyway migration。
- `post-migration-grants.sql`：迁移完成后按环境参数收口 API、Worker、Audit 三个运行角色权限；它不是 Flyway migration。
- `verify-postgresql.sql`：验证 V1→V5 的 RLS、追加事实、固定角色、模拟闭环、配置态、合同治理、身份轮换负向控制及敏感 JSON 防护。
- `verify-runtime-grants.sql`：验证运行角色属性、所有权、数据库权限和逐表 ACL 白名单。
- `verify-structure.ps1`：不连接 PostgreSQL 的 V1→V5 静态门禁。
- `verify-real-postgresql.ps1`：在一次性 PostgreSQL 中执行并验证 V1→V5。

Flyway location 只能包含符合版本命名的迁移。部署 Compose 因此只把 V1、V2、V3、V4、V5 五个版本文件逐一挂载到 `/flyway/sql`；本目录中的 `seed-*`、`post-migration-*.sql` 和 `verify-*.sql` 由后续 psql job 单独执行，不能整目录交给启用了 `validateMigrationNaming` 的 Flyway。

## Sprint 0 安全基座与 Sprint 1 模拟边界

- `control` schema：租户目录、本地账号认证、固定角色/权限、服务身份和全局追加审计。
- `ota` schema：门店配置、模拟连接器、PMS 营业日、房型/产品映射、库存、间夜、经营快照、P1、简报版本和模拟投递证据。
- 所有 `ota` 租户表同时启用 `ENABLE ROW LEVEL SECURITY` 与 `FORCE ROW LEVEL SECURITY`，只接受事务内单一 `app.tenant_id`。
- `control.audit_event`、`ota.ota_incident_occurrence`、`ota.ota_task_event`、`ota.ota_outbox_event` 通过触发器拒绝 `UPDATE/DELETE`。
- 数据库只保存密码和 Refresh Token 的单向摘要；PMS/OTA 会话、Cookie、Webhook、Token 和服务凭据必须位于外部 SecretStore/KMS。
- Sprint 1 的 `simulation_run`、采集尝试和 notification delivery 均以数据库约束禁止真实外联与真实企业微信投递。

## 部署角色先决条件

V1 不执行 `CREATE ROLE/CREATE USER`，也不假设 Flyway 是超级用户。`infra/ota` 的一次性角色配置 job 建立以下分离身份：

- migration owner：`LOGIN NOSUPERUSER NOINHERIT NOBYPASSRLS`，拥有 `flyway/control/ota` 部署对象；数据库权限是 `CONNECT+CREATE+TEMPORARY`。
- API runtime：`LOGIN NOSUPERUSER NOINHERIT NOBYPASSRLS`，不是数据库/schema/table/function owner。
- Worker runtime：同样是非 owner、NOBYPASS；只获得模拟 JDBC 持久化所需的精确`ota`表白名单、作业函数和V5有效合同基线窄读函数。
- Audit writer：同样是非 owner、NOBYPASS；只写入审计，不读取或修改已写审计。

三个运行角色不得互相复用，不得存在任何入向或出向数据库角色 membership（包括通过 `SET ROLE` 委托），也不得获得 `CREATE/TEMPORARY` 数据库权限。
此外，`PUBLIC` 以及 API、Worker、Audit 均不得拥有 `public` schema 的 `CREATE`；可以保留 `USAGE`，但所有对象创建必须留在 migration owner 的发布边界内。

## 当前最小 GRANT 矩阵

`post-migration-grants.sql` 接收 `api_role`、`worker_role`、`audit_role` 三个 psql 参数。它先撤销三个角色在当前V1→V5 schema、函数和逐项列出的表上的历史ACL，再只授予：

| 角色 | 对象 | 权限 |
|---|---|---|
| API | `control`、`ota`、`flyway` schema | `USAGE` |
| API | 本地认证/授权、门店配置、命令资源与读模型白名单 | 按对象精确 `SELECT/INSERT/UPDATE`；不直接读取候选、批准、吊销或命令回执 |
| API | `control.audit_event` | `INSERT` only |
| API | `flyway.flyway_schema_history` | `SELECT` only |
| Worker | `control`、`ota` schema | `USAGE` |
| Worker | 租户内配置、采集事实、分析快照、P1、简报和模拟投递白名单 | 按对象精确 `SELECT/INSERT/UPDATE` |
| Worker | `control.dispatch_due_ota_jobs`、`claim_ota_job`、`renew_ota_job_lease`、`complete_ota_job` | `EXECUTE` |
| Worker | `control.read_effective_connector_contract_baseline` | `EXECUTE` only |
| Worker | 候选、批准、吊销、服务主体/绑定/轮换事件、`control.ota_job_registry`及租户命令表 | 无直接表权限 |
| Audit | `control` schema | `USAGE` |
| Audit | `control.audit_event` | `INSERT` only |

不会使用 `GRANT ... ON ALL TABLES` 或 default privileges。完整清单以授权脚本和目录验证器中的逐对象数组为准。新增 Repository/表时必须显式更新两者，避免未来对象自动获得权限。API 和 Audit 均没有 `audit_event` 的 `SELECT/UPDATE/DELETE`。

执行示例：

```powershell
psql -v ON_ERROR_STOP=1 `
  -v worker_service_principal_id=21000000-0000-4000-8000-000000000001 `
  -v worker_principal_code=OTA_SPRINT1_SIMULATION_WORKER_BLUE `
  -d <ota_database> `
  -f .\database\ota-migrations\seed-sprint1-simulation-worker-principal.sql

psql -v ON_ERROR_STOP=1 `
  -v api_role=ota_api_app `
  -v worker_role=ota_worker_app `
  -v audit_role=ota_audit_writer `
  -v worker_service_principal_id=21000000-0000-4000-8000-000000000001 `
  -v worker_slot=BLUE `
  -d <ota_database> `
  -f .\database\ota-migrations\post-migration-grants.sql

psql -v ON_ERROR_STOP=1 `
  -v api_role=ota_api_app `
  -v worker_role=ota_worker_app `
  -v audit_role=ota_audit_writer `
  -v worker_service_principal_id=21000000-0000-4000-8000-000000000001 `
  -v worker_slot=BLUE `
  -d <ota_database> `
  -f .\database\ota-migrations\verify-runtime-grants.sql
```

上述三个命令必须由 migration owner 执行。运行账号不得持有 migration 凭据。

其中 Worker principal UUID 不是凭据，但必须由部署 `.env` 明确提供，并与 Worker 运行环境中的 `OTA_SPRINT1_SIMULATION_WORKER_PRINCIPAL_ID` 完全一致。脚本通过 PostgreSQL `UUID` cast 拒绝非法值和 nil UUID；若同一 UUID 或固定 principal code 已被绑定到其他身份则失败，不会静默改绑。该种子只写 `control.service_principal` 元数据，不会给 Worker 增加 control 表写权限。

## RLS 使用约束

应用必须在已验证目标租户的服务端事务内设置本地上下文：

```sql
SELECT set_config('app.tenant_id', :verified_tenant_uuid, true);
```

第三个参数必须为 `true`。不得使用会话级 `SET`，不得从前端直接接收租户列表，连接归还连接池前也不得遗留上下文。未设置、空值或非法 UUID 时，`control.current_tenant_id()` 返回 `NULL`，RLS 拒绝所有租户行。

## 验证

静态验证：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\database\ota-migrations\verify-structure.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File .\infra\ota\verify-deployment-structure.ps1
```

真实 PostgreSQL 目录验证应在 Flyway、Worker principal seed 和 post-migration grants 完成后运行 `verify-postgresql.sql` 与 `verify-runtime-grants.sql`。`infra/ota/run-database-deployment.ps1` 已按 role-bootstrap → Flyway → principal seed → grants → verifier 顺序执行部署级验证。

## 向前迁移原则

只允许向前修复，不提供回滚删除审计、任务事件、Incident 证据或 Outbox 事件的脚本，也不得与 AI 中台数据库双写。新增租户表必须同步扩展 RLS、静态验证、PostgreSQL 目录验证和运行权限白名单。
# Sprint 2A 数据库发布补充

Sprint 2A交付时的版本链为 `V1 + V2 + V3`。`V3__sprint2_offline_safety_foundation.sql`
是前向迁移：将 Worker 的数据库 `session_user` 与唯一 ACTIVE
`CONNECTOR_WORKER` 服务主体绑定；`dispatch/claim/renew/complete` 均拒绝
调用方传入与会话绑定不一致的 principal；普通采集保留精确
5/15/30 分钟槽位，`HOURLY_CUTOFF`、模拟任务、经营快照和小时简报仍为整点。
V3 不开放真实 PMS/OTA 外联，也不开放企业微信真实发送。

Sprint 2A当时的部署顺序为：
`role-bootstrap -> Flyway(V1,V2,V3) -> Worker principal seed -> grants -> verifier`。
Flyway 目录只逐文件只读挂载 V1、V2、V3；seed、授权和验证 SQL 仍由后续
psql job 独立执行。授权收敛会建立数据库 Worker 角色与 ACTIVE principal
的一对一绑定，Worker 只获得只读绑定解析函数及四个会话绑定作业入口的
`EXECUTE`，不获得绑定表或私有断言函数的直接权限。

静态验证和一次性 PostgreSQL 验证命令不变，但现在同时验证 V3、错 principal
拒绝、非整点 5 分钟普通采集 job/run 落库，以及真实外联和消息发送继续关闭。

## Sprint 2B 数据库发布补充

当前版本链为`V1 + V2 + V3 + V4`。V4只新增不可执行的
`CONFIGURATION_ONLY`接入准备态：三个Intake模板固定为disabled、零能力和
零允许主机；配置态连接器不能创建schedule、job、collection run或checkpoint，
也不能通过原地更新进入可运行模式。

Secret引用在V4进一步拒绝URI user-info、内嵌凭据、查询参数和fragment。
`connector_contract_approved_baseline`启用FORCE RLS和追加保护，审批账号必须与
`app.account_id`会话上下文一致；共享API角色只有SELECT，没有直接INSERT权限。
在Sprint 2B交付快照中，Worker尚未消费该批准基线，V4不开放真实连接、Secret解析或企业微信投递；V5进一步撤销了API对该表的直接SELECT。

部署顺序现为：
`role-bootstrap -> Flyway(V1,V2,V3,V4) -> Worker principal seed -> grants -> verifier`。

## Sprint 2C 数据库发布补充

当前版本链为`V1 + V2 + V3 + V4 + V5`。V5不增加任何`REAL`连接器模式、允许主机、外部Secret解析、采集调度或消息发送能力。

V5增加的`control.connector_contract_candidate_manifest`只能由migration/deployment owner从受信任构建制品发布，且保持追加式；三个Intake占位模板不能成为候选。当前候选清单为空。V5拒绝把既有、未经候选绑定的V4批准行自动升级；新批准必须引用候选并冻结当时的`config_hash`，吊销另写追加事实。批准、吊销命令由owner侧安全函数校验活动`PLATFORM_ADMIN`会话、tenant、期望版本、幂等键和请求哈希，共享API角色没有这些函数的`EXECUTE`或相关表写权限。

Worker只获得`control.read_effective_connector_contract_baseline`的`EXECUTE`。该函数要求事务内tenant与当前数据库session绑定的活动`CONNECTOR_WORKER`主体一致，只返回精确connector version和stream的无Secret投影；配置哈希变化或追加吊销会返回不可执行状态。API与Worker均不直接读取候选、批准、吊销或命令回执表。

服务主体绑定新增`STAGED/ACTIVE/DRAINING/RETIRED`及BLUE/GREEN槽位，并冻结数据库角色的OID与名称。角色改名、同名新OID、任何方向membership和非`READ COMMITTED` Worker事务均失败关闭。租户读在`ACTIVE`及15分钟内的`DRAINING`状态可用；dispatch、claim、renew和直接事实/Outbox DML仅接受`ACTIVE`，`DRAINING`不能续租，只能在数据库时钟判定的15分钟窗口内完成“排空前已经取得且尚未过期”的租约。调度、租约和重试时间均以`clock_timestamp()`为准，调用方时间只用于提供不超过15分钟的相对租期。`ota.hotel.message_enabled`由数据库CHECK硬冻结为false。

数据库绑定轮换不等于真实会话或凭据轮换。UAT在retire旧角色前必须由受控编排撤销旧凭据、关闭旧连接池，并以具备`pg_signal_backend`的独立运维身份终止旧角色后端，确认`pg_stat_activity`为0；SECURITY DEFINER函数不会自动终止会话。Worker角色应配置`idle_in_transaction_session_timeout=60s`与`lock_timeout=5s`。若promotion与未完成写事务冲突，写事务应回滚；新`ACTIVE`身份在租约过期后重放，不把部分写入视为成功。

当前仍保留以下P2边界：`artifact_digest`只存档非运行时制品/签名证明，不构成Worker运行时制品证明；轮换函数没有覆盖完整命令字段的command receipt/idempotency；批准命令的`request_hash`仍由caller提供，receipt尚未覆盖全部规范化字段；尚未执行真实并发写事务切换演练或真实15分钟墙钟长测；真实PMS/携程/美团、SecretStore、隔离网络和企业微信仍为`BLOCKED`。当前一次性部署只建立初始活动主体，不自动创建第二套数据库凭据，也不构成生产轮换演练。

部署顺序现为：
`role-bootstrap -> Flyway(V1,V2,V3,V4,V5) -> Worker principal seed -> grants -> verifier`。
Sprint 2C验证结果为PASS：静态门禁确认`17`张control表、`55`张FORCE RLS租户表和`27`个append-only保护对象，one-shot部署链及Flyway V1→V5挂载通过；PostgreSQL 14.22中API`1/1`、Worker`1/1`通过，迁移由`LOGIN/NOSUPERUSER/NOINHERIT/NOBYPASSRLS` owner执行，post-grants、runtime grants、catalog及负向控制全部通过。该结果只完成离线准入治理，不构成生产准入。
