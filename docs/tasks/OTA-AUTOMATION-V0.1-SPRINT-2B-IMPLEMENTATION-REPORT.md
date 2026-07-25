# OTA-AUTOMATION-V0.1 Sprint 2B 实施报告

任务编号：`OTA-AUTOMATION-V0.1`  
实施日期：2026-07-23  
阶段范围：Sprint 2B 真实接入离线准备控制面  
当前判断：`SPRINT 2 AUTHORIZED / SPRINT 2B OFFLINE PREPARATION COMPLETE / REAL CONNECTORS BLOCKED / PRODUCTION NO-GO`

---

## 一、结论与授权边界

Sprint 2 已获明确授权。本轮完成的是 **Sprint 2B 离线准备控制面**：管理员可在独立后台录入 PMS、携程和美团真实接入前所需的非秘密配置及受控 SecretStore 引用，API、数据库 V4 和 Worker 已共同收紧为“可准备、不可测试、不可激活、不可运行”。

本轮完成不代表真实连接器已经接通，也不代表本地账号已经具备真实抓取、分析或企业微信自动推送能力。截至本报告生成时：

- Sprint 2B 离线准备控制面已经完成实现与验证。
- PMS、携程、美团真实连接器仍为 `BLOCKED`。
- 真实 SecretStore 解析、真实网络访问、浏览器自动化和企业微信投递仍为 `BLOCKED`。
- 双店真实 UAT 和生产发布仍为 `NO-GO`。
- 不得将本报告中的“配置完成”解释为账号可用、连接测试通过、数据可抓取或生产可用。

## 二、本轮已实现

### 2.1 独立后台配置

- 独立 OTA 后台新增真实接入准备页面，使用固定的 `PMS_INTAKE`、`CTRIP_INTAKE`、`MEITUAN_INTAKE` 三类服务端模板。
- PMS 可登记 `OFFICIAL_API`、`READ_ONLY_DATABASE`、`AUTOMATED_REPORT`、`LOCAL_AGENT`；携程与美团可登记 `OFFICIAL_API`、`AUTOMATED_REPORT`、`CONTROLLED_BROWSER`。
- 后台只采集厂商、产品、外部门店编码、账号别名、受控网络路由编码、轮询间隔及 SecretStore 引用等准备信息，不允许填写任意 URL、主机、SQL、脚本或明文凭据。
- 页面始终显示 `DRAFT`、readiness、blockers 和 `runtimeBlocked=true`，不提供可误导为已接通的测试、启用或运行按钮。
- 门店接入配置由后台数据驱动，后续新增门店不需要为门店名称、PMS 厂商或 OTA 产品重复修改代码。

### 2.2 稳定 API 契约

已提供以下稳定接口：

- `GET /api/v1/ota/connector-onboarding/templates`
- `GET /api/v1/ota/tenants/{tenantId}/hotels/{hotelId}/connector-onboarding`
- `POST /api/v1/ota/tenants/{tenantId}/hotels/{hotelId}/connector-onboarding/{connectorId}`

控制面继续沿用可信登录会话、租户 RLS 事务、`Idempotency-Key`、请求哈希、期望行版本和追加审计。五类集团角色可按既有跨租户只读边界查看，连接器配置写入仍要求管理员的显式配置权限。

POST 请求采用严格字段白名单，未知顶层字段及未知 Secret binding 字段均拒绝。以下外部动作固定拒绝：

- `POST .../{connectorId}/test`
- `POST .../{connectorId}/activate`
- `POST .../{connectorId}/run`

三类动作均返回 HTTP `409` 和固定原因码 `SPRINT2_EXTERNAL_ACTION_BLOCKED`，同时留下拒绝审计；不存在用其他参数绕过后直接创建运行任务的路径。

### 2.3 Secret 最小暴露与安全编辑

- 后台只提交受控 SecretStore 引用，不接收密码、Cookie、Token、验证码、二维码、私钥、完整连接串或其他 Secret 明文。
- Secret 引用只允许批准的引用协议，并在 API 与 V4 数据库约束中拒绝嵌入式 credential/userinfo、查询参数和 fragment 等可夹带秘密的形式。
- GET 接口及 Web 页面不回显 `secret_ref`、Secret 版本或可用于定位 Secret 的确定性指纹；只返回用途、提供方、是否已配置及状态等最小信息。
- API 日志、审计请求哈希和非秘密配置 JSON 不保存 Secret 引用明文。
- 仅修改厂商名称、产品版本、门店编码、路由编码、轮询间隔等非秘密字段时，服务端在数据库事务内沿用上一草稿版本的既有 Secret binding；浏览器不需要读取、回显或重新提交旧 Secret。
- 如需轮换 Secret，必须显式提交新的受控引用并形成新的草稿版本；本轮不解析、不验证、不中转引用对应的真实 Secret 值。

### 2.4 V4 配置态与数据库 Fail Closed

Flyway V4 引入 `CONFIGURATION_ONLY` 连接器模式并注册三个惰性 intake 模板。模板在注册表中保持 disabled、无运行 capability、无允许主机且不支持 simulation，不能被当作真实适配器使用。

数据库边界已固定：

- `CONFIGURATION_ONLY` 只能匹配对应来源的 intake 模板，生命周期只能为 `DRAFT/PAUSED`。
- 配置态连接器版本只能保持未经测试的 `DRAFT`，`tested_at`、`activated_at`、`retired_at` 不得伪造。
- 不允许通过原地更新在 `CONFIGURATION_ONLY` 与可运行模式之间转换。
- 配置态连接器不能进入 collection schedule、job、collection run 或 checkpoint；即使绕过 API 直接写库，V4 触发器仍拒绝。
- Secret 引用新增无嵌入凭据约束，非法 userinfo 等形式在数据库边界继续 Fail Closed。

V4 同时建立追加式 `connector_contract_approved_baseline`，用于将来保存经批准的 capability/schema 指纹证据。该表启用并强制 RLS，只允许绑定会话中的有效平台管理员形成审批证据，更新和删除被拒绝。共享 API 运行角色不授予该表 `INSERT`，因此普通后台请求不能自批基线；审批基线本身也不授予任何真实网络、运行或外部访问能力。

### 2.5 Worker 安全收口

- `CONFIGURATION_ONLY` 不在现有 Dispatcher 或 Worker 运行允许列表中。
- 当前 Worker 没有 PMS、携程、美团真实适配器，也没有真实 SecretStore、浏览器或企业微信网络实现。
- Worker 继续保持真实 profile、外部 SecretStore 和 egress 未齐备时主动拒绝启动真实连接器。
- V4 审批基线目前只是不可变审批证据模型，Worker 尚未消费该表建立版本级运行许可；在完成基线消费、漂移校验和回滚流程前，真实连接器不得解锁。

## 三、明确未实现

1. 未连接“喷水池态六酒店”或“解放路MOOODSHIFT酒店”的真实 PMS API、只读数据库、自动报表或本地 Agent。
2. 未连接携程、美团官方接口或真实商家后台，未建立浏览器会话、扫码、验证码、多因素认证、Cookie 或 Token 生命周期。
3. 未连接或解析任何真实 SecretStore/KMS 条目，当前配置仅保存受控引用。
4. 未访问真实 PMS、携程或美团网络，未采集任何真实订单间夜、房费、钟点房、库存、房态或 PMS 营业日数据。
5. 未配置真实企业微信机器人或企业应用，未向运营群发送小时简报、P1 告警、补发消息或执行 `@所有人`。
6. 未完成两家试点门店各连续 3 个 PMS 营业日的真实数据金标准核对。
7. 未完成真实监控、告警、值班、灾备、凭据轮换和生产发布审批。

因此，当前不能声称“本地账号已实现真实数据抓取—分析—微信自动推送完整闭环”，也不能声称系统已经生产可用。

## 四、验证结果

| 验证项 | 状态 | 最终结果 |
|---|---|---|
| Contracts / API / Worker Maven 聚合回归 | PASS | 共`193`项，失败`0`、错误`0`、条件跳过`2` |
| PostgreSQL 14.22 专项 | PASS | 条件式 API 与 Worker 专项共`2`项，均在真实 PostgreSQL 14.22 中通过 |
| Flyway 与数据库负向门禁 | PASS | V1→V4 迁移通过；配置态运行阻断、Secret userinfo 拒绝、审批权限和 RLS/ACL 负向断言通过 |
| Web 自动化测试 | PASS | Node 测试`10/10`，TypeScript `tsc` 通过，Vite 生产构建通过 |
| 数据库静态门禁 | PASS | V4 对象、触发器、RLS、追加保护及运行阻断检查通过 |
| 部署静态门禁 | PASS | 迁移顺序、精确 grants、运行身份和真实外联默认关闭检查通过 |
| 真实 PMS / 携程 / 美团连接 | 未实施 | `BLOCKED` |
| 真实 SecretStore 解析 | 未实施 | `BLOCKED` |
| 真实企业微信送达 | 未实施 | `BLOCKED` |
| 双店真实 UAT | 未实施 | `NO-GO` |
| 生产发布 | 未实施 | `NO-GO` |

普通 Maven 回归中的两项条件式数据库测试，已由 PostgreSQL 14.22 专项补证。上述 PASS 只证明离线准备控制面、迁移和安全门禁符合当前契约，不证明任何真实外部系统可连接。

## 五、真实接入前剩余条件

### 5.1 外部接口与业务资料

- PMS 厂商、产品版本、正式接入方式、字段字典、增量/分页、水位、限流、错误码和营业日/夜审说明。
- 携程、美团官方接口或获许可的商家后台自动化文档，以及酒店标识、房型/售卖产品导出和与 PMS 实体房型的确认映射。
- 企业微信机器人或企业应用文档、群标识、`@所有人` 权限、频率/长度限制及测试群验收方案。

### 5.2 专用账号与 SecretStore 引用

- 两店最小权限 PMS 测试账号、携程/美团专用测试账号及对应酒店授权。
- 经批准的 SecretStore/KMS、条目命名、引用、注入、轮换、吊销、审计和应急恢复流程。
- 凭据只能由授权人员通过 SecretStore 或现场受控方式录入，不得通过对话、群聊、邮件正文、截图、文档、代码、日志或测试夹具交付。

### 5.3 UAT 网络与浏览器环境

- 隔离 UAT 环境、稳定出口 IP、出站域名白名单、代理、TLS 证书和网络负责人。
- 如确需 `CONTROLLED_BROWSER`，还需受控浏览器运行环境、厂商书面许可、验证码/扫码/多因素认证的人工协作流程，以及页面变化和反自动化处置方案。
- 两店各连续 3 个 PMS 营业日的人工金标准、差异签字人和验收排期。

### 5.4 真实送达与运行验收

- 在测试群实测小时简报、P1 即时告警、`@所有人`、幂等、失败重试、结果不明、乱序、停机恢复和过时简报补发。
- 建立人工停发/恢复、降级、监控、告警、值班、审计取证和灾备流程。
- 只有真实事实层及送达链均通过验收后，才可申请门店级受控放行。

### 5.5 Worker 基线消费

- Worker 必须按 tenant、hotel、connector、connector version 和 stream 消费已批准 capability/schema 基线。
- 启动、领取与每次执行前均需校验版本、指纹、授权状态和漂移；无基线、基线不匹配或发生漂移时必须 Fail Closed。
- 需补齐审批、轮换、吊销、回滚和紧急停用流程，且不得由共享 API 自行批准。

### 5.6 Principal 轮换

- 完成 API/Worker service principal 的蓝绿轮换、绑定、吊销、连接池会话清理和受控重绑定方案。
- 验证旧 principal 失效后不能领取、续租或完成任务，新 principal 只能获得其所需的精确权限。
- 在生产前完成轮换演练、审计证据、回滚预案和责任人签署。

## 六、阶段门禁

| 阶段 | 当前状态 | 下一门禁 |
|---|---|---|
| Sprint 0 安全底座 | `COMPLETE` | 维持冻结基线 |
| Sprint 1 模拟闭环 | `COMPLETE` | 维持 simulation-only 与真实投递禁发 |
| Sprint 2 | `AUTHORIZED / IN PROGRESS` | 完成真实连接器、真实 SecretStore 和隔离 UAT 前置条件 |
| Sprint 2A 离线安全底座 | `COMPLETE` | 维持真实 profile 与外部 egress Fail Closed |
| Sprint 2B 离线准备控制面 | `COMPLETE` | 配置可登记，但不得测试、激活或运行 |
| 真实 PMS / 携程 / 美团连接器 | `BLOCKED` | 外部文档、账号、SecretStore、网络和 Worker 基线消费齐备 |
| 真实企业微信投递 | `BLOCKED` | 测试群真实送达、安全、幂等与补发验收通过 |
| 双店真实 UAT | `NO-GO` | 两店分别连续 3 个 PMS 营业日通过金标准核对 |
| 生产发布 | `NO-GO` | 安全、监控、灾备、值班、principal/Secret 生命周期和发布审批全部完成 |

Sprint 2B 完成只表示离线配置入口和防误运行边界已经具备。真实连接器、真实企业微信投递、双店 UAT 与生产发布不会被自动解锁，必须逐项满足上述外部条件并获得新的明确放行。
