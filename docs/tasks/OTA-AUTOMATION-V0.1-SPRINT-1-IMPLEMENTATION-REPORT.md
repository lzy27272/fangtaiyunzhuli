# OTA-AUTOMATION-V0.1 Sprint 1 实施报告

任务编号：`OTA-AUTOMATION-V0.1`
实施日期：2026-07-23
业务基线：`DESIGN-1.5`
技术基线：`TECH-DESIGN-1.0`
制品版本：`0.1.0-SNAPSHOT` / Web `0.1.0-sprint1`
当前判断：`SPRINT 0 COMPLETE / SPRINT 1 SIMULATION-ONLY COMPLETE / SPRINT 2 HOLD / PRODUCTION NO-GO`

---

## 一、实施结论

产品负责人已明确确认“进入 Sprint 1”。独立 OTA 后台现已完成 Sprint 1 的模拟闭环实现：管理员可建立模拟租户和门店、配置模拟来源及实体库存映射、运行固定场景，并从 API 和独立 Web 查看来源完整度、经营指标、逐产品库存对账、P1、小时简报版本及企业微信 Outbox 禁发预览。

本轮只完成模拟闭环。所有运行均被安全门禁限制为 `simulation-only`，投递模式固定为 `BLOCKED`；没有真实 PMS、携程、美团或企业微信网络连接，也不会向已建立的运营群发送消息或执行 `@所有人`。因此，本报告中的“闭环”只指模拟数据在独立 PostgreSQL、API、Worker 和 Web 之间的业务链路，不表示本地账号已经具备真实数据抓取或微信自动推送能力。

Sprint 1 实现、最终全量复测和安全复核均已完成。普通 Maven 聚合回归共 138 项，0 失败、0 错误，其中 2 项条件式真实数据库测试在普通回归中跳过；这 2 项随后均在一次性 PostgreSQL 14.22 中 1/1 通过。Sprint 2 仍保持 `HOLD`，生产保持 `NO-GO`。

## 二、本轮交付

### 2.1 独立控制面与读模型

- 独立 API 提供模拟适配器目录、模拟租户/门店建立、门店参数、来源连接器、实体库存池、OTA 售卖产品、产品映射、经营目标和旺季节奏配置。
- 所有配置命令使用可信会话、`Idempotency-Key`、期望行版本及追加审计；客户端不能自报角色、租户范围或 Worker 身份。
- 支持门店配置、实时监控、简报、Incident、Outbox 预览及模拟运行历史读取；五类集团角色继续采用逐租户 RLS 事务聚合实现跨租户只读，不开放通用跨租户 SQL。
- `REVENUE_MANAGER` 只在授权门店维护房型映射、目标和节奏；`HOTEL_P1_HANDLER` 的 P1 处置边界保持不变。
- 新增第三家模拟门店不依赖代码或重启，作为后续“后台配置扩店”验收基础。

### 2.2 数据库 V2 与运行身份

- Flyway V2 增加连接器目录、租户命令幂等、动态作业目录，以及模拟采集、营业日、经营、库存、订单间夜、简报版本、P1 和投递预览所需表。
- 当前静态结构基线为 14 张 `control` 表、52 张启用并强制 RLS 的 `ota` 租户表和 22 个追加事实保护对象。
- 普通模拟流水线作业与采集作业分别以 `SIMULATION_PIPELINE`、`COLLECTION` 类型领取，避免 Worker 错领其他类别作业；领取、续租和完成均由最小权限函数控制。
- 部署链新增非秘密的模拟 Worker workload principal 种子，顺序冻结为 PostgreSQL healthy → role bootstrap → Flyway → Worker principal seed → grants → verifier。
- `ota_brief_adjustment` 保存模拟运行标识、完整替代正文和正文哈希，原始小时简报不被覆盖。

### 2.3 模拟采集、计算与 P1

Sprint 1 提供 `MOCK_PMS`、`MOCK_CTRIP`、`MOCK_MEITUAN` 三类内置模拟连接器，以及 `FILE_FIXTURE` 官方导出夹具边界。确定性流水线实现以下四类场景：

| 场景 | 验证目标 | 预期输出 |
|---|---|---|
| `BASELINE` | 正常来源、指标与房态 | 完整经营快照、匹配库存、小时简报禁发预览 |
| `INVENTORY_MISMATCH` | 任一 OTA 产品与 PMS 实体房型可售量不一致 | 双向差异均生成 P1、任务和禁发告警预览 |
| `SOURCE_UNAVAILABLE` | 来源过期或采集失败 | 相关值为 `UNAVAILABLE/无法判断`，不得以 0 或旧值替代 |
| `LATE_BRIEF_REPLAY` | 迟到数据与过时简报补发 | 保留原始简报，追加修订版本和按原截止时间的禁发补发预览 |

计算口径保持 DESIGN-1.5 不变：

- “今日”跟随 PMS 实际夜审后的营业日，不在自然日 00:00 自动切换。
- 小时窗口严格为 `(T-1h, T]`，截止点必须为 `HH:00`。
- 总营业额只统计房费并包含钟点房收入；ADR、RevPAR 和过夜已售间夜排除钟点房。
- 订单统计以间夜为单位；新增、取消、改期、缩住和减房形成可审计的正负间夜变更。
- 多个套餐、含早/无早售卖名共享 PMS 实体库存池，但每个 OTA 产品必须单独与 PMS 可售量比较，产品库存永不相加。
- OTA 产品可售量高于或低于 PMS 对应实体房型均为 P1；来源不可用时状态为“无法判断”，不生成虚假的库存差值。

### 2.4 小时简报、版本与禁发 Outbox

- 生成确定性的六段小时经营简报正文和 P1 精简告警正文；事实、金额、间夜、百分比和来源状态不由 AI 改写。
- 同一截止点的原始简报保持不可变；迟到数据通过调整版本和替代正文留痕，不覆盖历史。
- 模拟运行生成 Outbox 证据和发送顺序预览，但环境、目标和投递状态均受数据库与应用双重门禁限制，不能转成真实企业微信请求。
- P1 Outbox 幂等键包含门店和模拟运行范围；同一场景重复运行保留独立证据，不串门店、不覆盖其他运行。

### 2.5 独立 Web

独立 Web 已从 Sprint 0 登录壳扩展为四个最小模拟页面：

1. PMS 与 OTA 接入配置：选择服务端登记的模拟适配器和非秘密参数。
2. 实时经营监控：显示来源完整度、经营指标、实体库存池及逐产品对账。
3. 房型、目标与节奏：配置共享库存映射、目标任务、目标 ADR 和节奏曲线。
4. 简报与告警历史：查看原始/调整后简报、P1/任务、模拟运行和 Outbox 禁发预览。

页面不会接收或保存 PMS/OTA 密码、Cookie、Token、Webhook、任意 URL 或脚本，也不会提供绕过模拟门禁的真实发送按钮。

### 2.6 动态数据库调度与文件采集链

数据库动态作业目录、租约领取、续租、完成及失败重试链已经完成 Sprint 1 实现和实库回归。`FILE_FIXTURE` 使用只读内置合成官方导出夹具，不接受宿主路径、URL、凭据或 Secret 引用；来源无效时返回 `FAILED + UNAVAILABLE`，不伪造 0、不推进水位。

真实 PostgreSQL 回归由后台配置动态产生并执行 12 个普通 `COLLECTION` 作业，其中 7 个来自 `MOCK_*`，5 个来自 `FILE_FIXTURE`；12 个 run、attempt 和 `FRESH` checkpoint 均有断言，重复调度不重复建单。普通采集链在 Sprint 1 只保存采集控制证据，不落原始/标准记录；后者仍是 Sprint 1 之后的明确边界。

## 三、真实 PostgreSQL 专项闭环

已在一次性真实 PostgreSQL 14.22 环境执行 V1+V2 迁移，并验证 API 控制面建立模拟门店和运行 → Worker 领取并执行模拟作业 → API 读取经营、简报、P1 和 Outbox 结果的闭环。专项按五次运行覆盖：

1. `BASELINE` 首次运行；
2. `BASELINE` 第二次运行，验证同场景多次运行证据隔离；
3. `LATE_BRIEF_REPLAY`，验证原始简报与修订/补发版本；
4. `INVENTORY_MISMATCH`，验证逐产品双向房态差异 P1；
5. `SOURCE_UNAVAILABLE`，验证“无法判断”及空值传播。

五次运行均未产生外部网络请求或真实投递。真实 PostgreSQL 专项还验证了运行账号为非 owner、`NOBYPASSRLS`，Worker 不能直接写控制表，以及 `COLLECTION` 作业不会被模拟流水线错误领取。

同一实库专项还验证了 12 个动态普通采集作业、调度幂等、完整成功才推进水位，以及 Worker principal 在领取后被停用时不能续租或完成任务。

## 四、验证状态

| 验证项 | 当前状态 | 说明 |
|---|---|---|
| API → Worker → API 真实 PostgreSQL 五次运行 | PASS | PostgreSQL 14.22；覆盖两次 baseline、迟到简报补发、房态不匹配、来源不可用 |
| V1+V2 迁移、RLS、追加事实与运行权限 | PASS | 一次性真实 PostgreSQL 专项已通过 |
| 数据库静态结构门禁 | PASS | 14 张 control 表、52 张 FORCE RLS 租户表、22 个追加事实保护 |
| 部署静态门禁 | PASS | 一次性迁移、Worker principal seed、精确 GRANT 和运行期 Flyway 关闭边界 |
| Maven 聚合最终全量复测 | PASS | 138 项；0 失败、0 错误、2 项条件式实库测试跳过并由下列实库专项补证 |
| 契约/API/Worker 分模块数字 | PASS | Contracts 40；API 48（普通回归跳过实库 1）；Worker 50（普通回归跳过实库 1） |
| Web Node 测试、TypeScript 与 Vite 构建 | PASS | Node 9/9；`tsc -b` PASS；Vite 38 modules 生产构建 PASS |
| 动态数据库调度、FILE_FIXTURE/collection 执行链 | PASS | PostgreSQL 实际执行 12 个普通采集：7 个 Mock + 5 个 FILE_FIXTURE；12 个 run/attempt/FRESH checkpoint |
| 最终安全复核 | PASS | 复核发现的 2 个 P1 已修复并补负向测试；当前无未关闭 P0/P1 |
| 完整 Docker Compose 整栈启动 | ENVIRONMENT NOT RUN | 当前环境无 Docker CLI/psql 客户端，不能写为容器级 PASS |

非阻断 P2 已记录为后续纵深加固项：将数据库会话身份与 service principal 强绑定、扩大 Worker 启动时的函数所有权/ACL 自检，以及切换到 `FILE_FIXTURE` 后历史 Secret binding 的展示收口。这些问题不形成 Sprint 1 的真实外联能力，但在真实连接器阶段前必须继续处理。

本次复测只更新实施状态和验证证据，未改写已冻结的业务口径。

## 五、明确未实现

1. 未接入真实 PMS API、只读数据库、官方报表或门店 Agent。
2. 未建立或复用真实携程、美团账号、浏览器会话、Cookie、Token 或验证码流程。
3. 未配置真实企业微信机器人 Webhook，未向任何运营群投递，也未实测 `@所有人`、重试、网络不明结果和真实补发。
4. 未使用两家试点门店的真实订单、房态、房费或夜审数据；当前结果不能替代人工金标准核对。
5. 未完成两店各连续 3 个 PMS 营业日 UAT，也未开启任何门店的 LIVE 或 `message_enabled`。
6. 未完成目标生产环境的 TLS、SecretStore/KMS、备份恢复、监控告警、值班和发布签署。

## 六、阶段门禁

| 阶段 | 当前状态 | 下一门禁 |
|---|---|---|
| Sprint 0 安全底座与工程骨架 | COMPLETE | 已由 Sprint 0 实施报告冻结 |
| Sprint 1 模拟闭环 | COMPLETE | 实现、全量回归、真实 PostgreSQL 专项与最终安全复核均通过 |
| Sprint 2 真实连接器 | HOLD | 产品负责人另行授权；对应门店 PMS/OTA 资料、专用账号和隔离联调环境齐备 |
| Sprint 3 完整分析、P1 与企微 | NO-GO | Sprint 2 真实事实层验收通过，测试 Webhook 与投递安全门禁通过 |
| Sprint 4 双店 UAT 与发布 | NO-GO | 两店分别连续 3 个 PMS 营业日通过全部核对项 |
| 生产发布 | NO-GO | 安全、备份恢复、监控、值班、真实账号生命周期和发布签署全部完成 |

Sprint 1 完成不会自动启动 Sprint 2。真实连接器、真实群发送和生产启用均需要新的明确授权与外部资料。
