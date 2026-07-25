# OTA 独立数据库部署

本目录负责独立OTA后台的PostgreSQL、Sprint 0安全基座、Sprint 1模拟闭环、Sprint 2A离线安全底座、Sprint 2B配置准备态和Sprint 2C离线准入治理迁移，以及一次性数据库部署任务和最小权限收口。当前链路为Flyway V1→V5并已通过离线部署验证；它不会启动真实PMS/OTA连接器或企业微信投递。

## 冻结边界

- `ota-postgres` 长期运行，只接收独立的数据库 bootstrap 管理员凭据。
- `ota-db-role-bootstrap` 是一次性角色配置任务，创建/轮换非超管 migration、API、Worker 和 Audit 身份。
- `ota-db-migrator` 是唯一执行 Flyway 版本迁移的任务，迁移历史固定为 `flyway.flyway_schema_history`。
- `ota-db-worker-principal-seed` 在迁移后以 migration owner 幂等写入一条非秘密的 `ACTIVE/CONNECTOR_WORKER` 工作负载身份；UUID 必须由 `.env` 明确提供。
- `ota-db-grants` 在迁移与 Worker principal seed 成功后执行参数化、逐对象的运行权限收口。
- `ota-db-grant-verifier` 最后读取 PostgreSQL 目录并验证角色属性、对象所有权和完整权限矩阵。
- API 和 Worker 运行进程不得接收 bootstrap/migration 凭据；API 必须设置 `SPRING_FLYWAY_ENABLED=false`。

当前 Flyway Docker 镜像固定为 `.env.example` 中的明确版本，可以在发布评审后通过 `OTA_FLYWAY_IMAGE` 升级，不使用 `latest`。

## 首次部署

1. 把 `.env.example` 复制为被 Git 忽略的 `.env`。
2. 为 bootstrap、migration、API、Worker、Audit 五个数据库身份分别生成不同的随机密码，不复用人员账号密码。
3. 执行静态门禁：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\verify-deployment-structure.ps1
```

4. 顺序执行角色配置、Flyway、Worker 工作负载身份种子、最小 GRANT 和目录验证：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\run-database-deployment.ps1 -EnvFile .env
```

脚本会在任一阶段非零退出时停止。Compose 本身也冻结了严格依赖链：

```text
PostgreSQL healthy
  -> role-bootstrap completed
  -> Flyway migrator completed
  -> simulation Worker principal seed completed
  -> grants completed
  -> grant verifier completed
```

也可以由发布平台逐个调用同名 one-shot service，但不得跳过或并行执行上述步骤。

## 身份与权限

- `ota_db_bootstrap`：数据库初始化管理员，仅数据库容器和角色配置任务使用，不交给应用。
- `ota_migration_owner`：`NOSUPERUSER NOBYPASSRLS NOINHERIT`；只在数据库部署任务中使用并持有 Flyway/业务对象。
- `ota_api_app`：`NOSUPERUSER NOBYPASSRLS NOINHERIT`；只获得当前 API JDBC 仓储所需的明确表权限，以及 `flyway.flyway_schema_history` 的只读权限。
- `ota_worker_app`：仅获得JDBC持久化适配器所需的`ota`表白名单、作业`SECURITY DEFINER`函数及V5有效合同基线窄读函数；不能直接读写候选/批准/吊销、`control.service_principal`、绑定/轮换事件、`control.ota_job_registry`或租户命令表。
- `ota_audit_writer`：只获得 `control` schema 的 `USAGE` 和 `control.audit_event` 的 `INSERT`；没有审计读取、更新或删除权限。

角色配置任务还会显式撤销 `PUBLIC` 在 `public` schema 上的 `CREATE`，并分别撤销 API、Worker、Audit 的历史直授 `CREATE`。`USAGE` 可以保留，但运行角色不能在 `public` 中创建对象；任何历史数据库角色成员关系也会被后续 grant/verifier 门禁拒绝。

对象授权清单及目录断言位于 `database/ota-migrations/post-migration-grants.sql` 与 `verify-runtime-grants.sql`。新增表或仓储访问时必须同步评审这两个文件；脚本不使用 `GRANT ... ON ALL TABLES` 或 default privileges，未来对象不会自动进入运行角色权限。

## API 与 Worker 运行配置

仓库中的 `.env.example` 已把以下值冻结为运行默认值：

```dotenv
SPRING_FLYWAY_ENABLED=false
```

启动独立 API 时必须把该环境变量显式传入进程，并使用 `OTA_DB_API_USER/OTA_DB_API_PASSWORD` 对应的运行身份。不得使用 `OTA_DB_MIGRATION_USER/OTA_DB_MIGRATION_PASSWORD`。若启动兼容门禁读取迁移版本，只允许访问精确表 `flyway.flyway_schema_history`。

Sprint 1 模拟 Worker 必须复用部署时种入的同一个非秘密 UUID：

```dotenv
OTA_SPRINT1_SIMULATION_WORKER_PRINCIPAL_ID=21000000-0000-4000-8000-000000000001
```

该值映射到 Worker 配置
`ota.sprint1.simulation.worker-service-principal-id`，只标识工作负载，不是密码、Token 或数据库账号。首次部署后应保持稳定；如果 UUID 已绑定其他 principal code，种子任务会拒绝部署，避免静默改绑。

Worker 运行环境还应显式提供：

```dotenv
OTA_SPRINT1_SIMULATION_ENABLED=true
OTA_SPRINT1_SIMULATION_JDBC_URL=jdbc:postgresql://<host>:<port>/<database>
OTA_SPRINT1_SIMULATION_DB_USERNAME=<OTA_DB_WORKER_USER 的值>
OTA_SPRINT1_SIMULATION_DB_PASSWORD=<从 SecretStore 注入 OTA_DB_WORKER_PASSWORD>
OTA_SPRINT1_SIMULATION_WORKER_PRINCIPAL_ID=<与部署 .env 完全相同的 UUID>
```

数据库密码不得写回 `.env.example` 或代码仓库。Sprint 1 Worker 只运行模拟采集、分析和投递预览；上述配置不会开启真实 PMS/OTA 或企微外联。

## Sprint 2C准入与身份轮换边界

Compose迁移链逐文件挂载V1至V5。V5新增的可信候选清单默认且当前为空；migration/deployment owner未登记受信任真实适配器构建前，后台只会显示`CANDIDATE_UNAVAILABLE`，Worker不能获得真实连接器执行资格。

当前一次性部署流程仍只种入初始活动`CONNECTOR_WORKER`主体。V5提供owner侧BLUE/GREEN stage、promote和retire数据库协议，但不生成第二套数据库账号或密码、不修改SecretStore、不切换运行中连接池，也不自动执行生产轮换。绑定同时冻结角色OID和名称，禁止角色改名冒用、同名新OID冒用及任意方向membership/`SET ROLE`委托。实际轮换必须另行准备两个永久、独立、安全的LOGIN角色与凭据，并保留追加事件证据。

新dispatch、claim、renew及直接事实/Outbox DML只接受`ACTIVE`主体；`DRAINING`只保留15分钟有界tenant SELECT，只能完成排空前已经取得且仍有效的租约，不能续租。Worker事务必须为`READ COMMITTED`，调度和租约授权使用数据库时钟，`message_enabled`由数据库约束固定为false。运行角色不能调用stage/promote/retire函数，也不能直接访问绑定、轮换事件或合同治理表。

数据库状态轮换并不替代真实凭据和会话轮换。受控UAT顺序为：创建并验证新凭据/连接池 → STAGED → promote → 撤销旧凭据 → 关闭旧连接池 → 由独立运维身份（按需授予`pg_signal_backend`）终止旧角色后端 → 确认`pg_stat_activity`中旧角色会话为0 → 等待已有租约完成或过期 → retire。数据库SECURITY DEFINER函数不会自动终止后端。角色bootstrap将Worker设置为`idle_in_transaction_session_timeout=60s`和`lock_timeout=5s`；promotion遇到未完成写事务时，该事务应回滚，由新ACTIVE身份在租约过期后重放。

当前P2限制：候选`artifact_digest`只存档非运行时制品/签名证明，不做Worker运行时制品证明；轮换函数没有覆盖完整命令字段的command receipt/idempotency；批准`request_hash`仍由caller提供且receipt未覆盖全部规范字段；未执行真实并发写事务切换演练或真实15分钟墙钟长测；真实PMS/携程/美团、SecretStore、隔离网络和企业微信仍为`BLOCKED`。上述限制均为已登记非放宽项。

Sprint 2C部署验证为PASS：静态门禁确认`17`张control表、`55`张FORCE RLS租户表和`27`个append-only保护对象，one-shot部署顺序及Compose逐文件Flyway V1→V5挂载通过；PostgreSQL 14.22 API`1/1`、Worker`1/1`通过，迁移在`LOGIN/NOSUPERUSER/NOINHERIT/NOBYPASSRLS` owner下完成，post-grants、runtime grants、catalog及负向控制全部PASS。即使离线验证通过，也不会配置真实PMS/OTA、外部SecretStore或企业微信凭据与网络。

## 已有本地数据卷

旧版 Compose 曾把 migration 账号作为 PostgreSQL bootstrap 超级用户。已有 `sifangguan-ota-postgres-data` 数据卷不会因修改环境变量自动改变角色或所有权，因此不能直接视为已修复。应先备份需要保留的数据，再由 DBA 明确迁移所有权和降权；纯测试数据确认可丢弃时，可手工创建全新卷后重新执行本流程。本仓库不提供自动删卷命令。

`docker compose down` 不会删除数据卷。
