# OTA-AUTOMATION-V0.1 编码就绪报告

任务编号：`OTA-AUTOMATION-V0.1`
报告日期：2026-07-23
业务基线：`DESIGN-1.5`
技术基线：`TECH-DESIGN-1.0`
当前状态：`CONTROLLED EXTERNAL INTAKE OPEN / CONTROLLED LOGIN COMPLETE / OBSERVATION PARTIAL / COOKIE AUTOMATION BLOCKED / I1 VENDOR AUTHORIZATION REQUIRED / REAL CONNECTORS BLOCKED / PRODUCTION NO-GO`
试点门店：喷水池态六酒店、解放路MOOODSHIFT酒店

---

## 一、结论

产品负责人已于2026-07-23明确下达“开始编码”，随后确认进入Sprint 1及Sprint 2。Sprint 0独立后台骨架、Sprint 1 simulation-only闭环、Sprint 2A离线安全底座、Sprint 2B真实接入准备层和Sprint 2C离线准入治理均已完成阶段验证；阶段证据见对应实施报告。

Sprint 2C离线准入治理完成不等于真实闭环或生产验收：后台目前只能配置非秘密厂商资料和不透明SecretStore引用，并只读展示`CANDIDATE_UNAVAILABLE`，不能批准、吊销、测试、激活或运行连接器。真实PMS/携程/美团连接器、SecretStore解析和隔离联调仍为`BLOCKED`，真实事实层上的完整分析/P1/企微属于后续门禁，双店UAT与发布仍为`NO-GO`。

首个实例为“喷水池态六酒店＋PMS＋美团别样红系统”。2026-07-25已完成隔离Chrome人工认证、试点门店选择和有限只读结构观察；主页房态候选为无请求体`POST /hotelpms/api/v1/report/home/workbench/room`，HTTP 200且`data[]`为三字段对象结构，但字段名和值未留存，业务语义未验证。原`lion/.../room`受控GET仅得到通用包络。厂商/合同自动化许可证据仍缺失；官方协议复核后Cookie自动采集保持阻断，优先申请官方签名式OpenAPI。隔离浏览器进程已关闭且不得复用其会话，适配器业务代码仍为`HOLD`。

真实PMS、携程、美团和企业微信联调尚不具备开始条件。当前系统可由确定性模拟场景生成小时简报和P1禁发预览；`FILE_FIXTURE`普通采集链已能在离线事务中写入受控Raw/Standard事实并通过水位、质量和漂移门禁，但尚未接入任何真实来源或真实下游分析。系统不能抓取真实数据或向企业微信群推送，所有Outbox固定为`BLOCKED/simulation-only`。外部资料和安全设施会阻塞Sprint 2真实适配器、双店UAT和正式群推送。

## 二、门禁判定

| 门禁 | 判定 | 说明 |
|---|---|---|
| 业务设计 | PASS | DESIGN-1.5已确认并冻结 |
| 技术设计 | PASS | T0至T5全部确认，TECH-DESIGN-1.0已冻结 |
| 显式开发授权 | PASS | 产品负责人已明确下达“开始编码” |
| Sprint 0安全底座与工程骨架 | GO / COMPLETE | 实现、自动化验证和最终安全复核完成 |
| Sprint 1模拟闭环 | COMPLETE | 产品负责人已确认进入；实现、全量回归、真实PostgreSQL专项与最终安全复核均通过 |
| Sprint 2A离线安全底座 | COMPLETE | 已通过修复后全量、PostgreSQL 14.22专项和最终复核 |
| Sprint 2B真实接入准备层 | COMPLETE / RUNTIME BLOCKED | 后台配置、API、V4数据库硬门禁和Worker安全收口已通过全量、PostgreSQL 14.22及前端构建验证 |
| Sprint 2C离线准入治理 | COMPLETE / RUNTIME BLOCKED | V5、未来非本地连接器执行前基线门禁、蓝绿身份状态机、只读准入页面、全量/PG/Web/静态及安全复核均完成 |
| 受控外部接入前置 | OPEN / I0 PARTIAL / OBSERVATION PARTIAL | 专用账号、现场输入、只读用途和一次人工登录已完成；网页自动化合同许可、字段语义和金标准待补 |
| Sprint 2真实连接器 | BLOCKED | Sprint 2已授权，但外部接入资料、SecretStore、厂商许可和隔离联调环境仍未齐备 |
| 真实PMS连接器 | NO-GO | 两店PMS厂商、版本、接入方式、字段样例和金标准未提供 |
| 真实携程/美团连接器 | NO-GO | 专用账号、酒店ID、首次人工认证和页面/接口实测资料未提供 |
| 真实企微投递UAT | NO-GO | 群已建立，但机器人Webhook及@全员实投尚未验证 |
| 双店正式启用 | NO-GO | 两店须分别连续通过3个PMS营业日验收后逐店开启 |
| 生产发布 | NO-GO | 生产基础设施、安全、备份恢复、监控和发布门禁尚未完成 |

## 三、开工前仓库与构建基线（历史快照）

本节记录授权前的仓库事实，仅用于说明Sprint 0的起点，不代表当前实现状态。当前制品、测试和限制以Sprint 0实施报告为准。

检查基线：分支`codex/daily-operations-v1`，提交`b28af813f6c4eef1683acd518ccc70a36817813d`。

1. 当前只有既有`apps/core-api`和`apps/web`，以下目标目录均不存在：
   - `apps/ota-standalone-api`
   - `apps/ota-standalone-web`
   - `apps/ota-connector-worker`
   - `packages/ota-contracts`
   - `database/ota-migrations`
2. 因此可确认OTA独立后台尚未编码；后续必须独立构建、配置、迁移和部署，不把现有AI中台应用作为运行时依赖。
3. 现有前端于2026-07-23执行`tsc -b && vite build`通过；Vite完成59个模块的生产构建，仅报告既有动态/静态重复导入提示。
4. 现有后端于2026-07-23执行不启动数据库的Maven编译通过，结果为`BUILD SUCCESS`。
5. 现有后端全量测试已启动核验，但沙箱环境不允许嵌入式PostgreSQL正常建立本地连接，出现`Connection refused`并超时；该次结果记为`ENVIRONMENT BLOCKED`，不能记为代码失败，也不能记为测试通过。超时遗留的本次Java测试进程已结束，未清理本机原有PostgreSQL服务。

## 四、已按授权实施的Sprint 0范围

1. 建立独立Web、API、连接器Worker、契约包和独立数据库迁移工程。
2. 建立独立PostgreSQL实例/集群、迁移账号和`NOBYPASSRLS`运行账号，验证不访问AI中台数据库。
3. 建立最小本地账号、会话、固定角色、租户/门店目录、账号门店范围、值班/升级配置、逐租户RLS读取和受控配置写入骨架。
4. 建立`ota_incident`、`ota_task`、`ota_task_event`、`audit_event`和`ota_outbox_event`骨架及追加约束。
5. 冻结连接器SPI、标准记录Envelope、OpenAPI、事件Envelope、领域Ports和单一写入方约束；未来中台适配器仅保留测试桩。
6. 准备模拟连接器、固定时钟、真实PostgreSQL RLS、认证和契约兼容性测试；本阶段只做测试准备，不实现Sprint 1模拟流水线。

Sprint 0不得擅自实现或宣称完成Sprint 1至Sprint 4能力，不得接入真实账号、保存明文凭据、向正式运营群发送消息，或把任何试点门店的`message_enabled`置为`true`。

上述六项现已实现并通过阶段验证；Sprint 0未越过本节末尾的禁止边界。

## 五、已实施的认证与安全ADR

该ADR属于已确认T4边界的实现协议，不新增业务决策；现已作为Sprint 0技术交付物完成，冻结：

1. Access Token与Refresh Token的传输方式、有效期、刷新轮换、复用检测、会话族撤销和全端退出。
2. 浏览器Cookie的`HttpOnly`、`Secure`、`SameSite`策略，以及CSRF、CORS和安全响应头策略。
3. 签名密钥加载、轮换、旧密钥验证窗口和应急吊销流程。
4. 首个`PLATFORM_ADMIN`的一次性离线引导、两名可恢复管理员要求、账号恢复及全会话撤销审计；生产禁止默认共享密码和开发认证后门。
5. API、Worker、Migration和审计只读身份的数据库`GRANT`矩阵；全局任务目录只开放完成职责所需的窄权限。

推荐实现基线为：Access Token仅驻留前端内存；Refresh Token使用`HttpOnly + Secure + SameSite` Cookie；每次刷新轮换并检测复用；首个管理员采用一次性离线引导。

## 六、两家试点门店真实联调资料

以下项目须按门店独立收集和验收；一店资料齐备可以先联调，不等待另一店。未通过的门店不得启用正式群消息。

在录入任何真实凭据或数据前，还必须为对应门店准备隔离UAT环境、TLS、独立数据库与服务账号、SecretStore、对象存储及来源只读权限；按实际网络边界配置出口白名单，必须使用门店Agent时采用mTLS。真实联调全过程保持`message_enabled=false`。

| 类别 | 喷水池态六酒店 | 解放路MOOODSHIFT酒店 | 达标条件 |
|---|---|---|---|
| PMS身份 | 待提供 | 待提供 | 厂商、产品、版本、部署位置和网络边界明确 |
| PMS接入 | 待提供 | 待提供 | API、只读库、报表/导出、浏览器或门店Agent方案明确 |
| PMS数据 | 待提供 | 待提供 | 稳定订单/间夜键、创建/修改/取消时间、来源更新时间、营业日/夜审、订单状态、房费/非房费判定、钟点房、冲销退款、实体房型、有效总房量及可售量字段与脱敏样例齐全 |
| PMS金标准 | 待提供 | 待提供 | 至少一组人工核对营业日结果，覆盖跨夜审、改期、缩住、减房、取消、冲销和钟点房边界 |
| 携程 | 待提供 | 待提供 | 专用账号、准确酒店ID、首次人工认证；稳定产品/订单ID、产品级库存、开关房、修改/取消语义、来源更新时间、分页完整性、历史范围及15/30分钟频率实测完成 |
| 美团 | 待提供 | 待提供 | 专用账号、准确酒店ID、首次人工认证；稳定产品/订单ID、产品级库存、开关房、修改/取消语义、来源更新时间、分页完整性、历史范围及15/30分钟频率实测完成 |
| 产品映射 | 待提供 | 待提供 | 全部套餐、含早/无早等售卖名映射到PMS实体房型并经门店复核 |
| 经营配置 | 待提供 | 待提供 | 收入目标、目标ADR、旺季节奏、值班和升级负责人版本已配置 |
| 企业微信 | 群已建立，Webhook待验证 | 群已建立，Webhook待验证 | 机器人Webhook在后台SecretStore配置；测试消息与@全员实投通过，该项只代表投递通道可用，不代表门店UAT完成 |
| UAT | 未开始 | 未开始 | 每店分别连续3个PMS营业日且满足TECH-DESIGN-1.0第14.2节全部条件 |

第14.2节UAT条件至少包括：房费收入核对到分，库存及新增/取消减少间夜完全一致；多放、少放、来源不可用和投递失败P1零漏告；10分钟升级及复核关闭符合规则；HH:06简报、@全员、Webhook中断与全部旧简报补发通过；权限隔离、停机恢复和断点续跑通过。不得仅凭“连续运行3日”判定门店通过。

任何密码、Cookie、Token、Webhook或验证码不得写入聊天、文档、日志或代码仓库；只在后台受控配置或SecretStore中录入。首次人工登录时不得向开发人员索取密码或验证码。

## 七、生产发布前置条件

1. 独立访问域名与TLS、独立PostgreSQL、SecretStore/KMS、对象存储和服务身份。
2. 数据库与对象存储备份恢复演练、RPO/RTO、密钥恢复或重配方案、应用兼容回滚与数据库向前修复策略；禁止以破坏性Down Migration回退生产数据库。
3. 监控阈值、告警路由、值班手册、连接器失效和消息积压处置手册。
4. 依赖及制品扫描、SBOM、SAST；文件上传大小/MIME限制、压缩炸弹、病毒和资源耗尽防护。
5. 原始文件、受限订单标识、消息投递和审计日志保存期限及责任人确认。
6. 平台级生产基础设施门禁统一通过；两家试点分别签字、分别开启`message_enabled`，一家未通过不阻塞另一家启用；第三家模拟门店无需改代码扩店验收通过。

生产发布还必须同时满足TECH-DESIGN-1.0第十六章全部门禁，包括无未关闭P0/P1、RLS与`NOBYPASSRLS`、关闭开发认证、会话和密钥轮换、来源及投递凭据隔离等；本节摘要不能替代完整发布检查表。

## 八、下一步授权门禁

Sprint 0、Sprint 1 simulation-only、Sprint 2A离线安全底座、Sprint 2B真实接入准备层和Sprint 2C离线准入治理均已完成；Sprint 2真实连接器仍处于`BLOCKED`。

受控外部接入前置现已打开，首个实例为“喷水池态六酒店＋PMS＋美团别样红系统”，系统名称、登录型网页接口性质及`NO_VISIBLE_VERSION`已确认。2026-07-25完成的一次有限观察只形成匿名结构指纹，不能替代许可证据、字段合同或UAT。由于UI无可见版本，后续必须以capability/schema指纹和脱敏合同测试识别变化。后续顺序固定为：先申请官方签名式OpenAPI的门店和方法权限；如其不能覆盖冻结字段，再取得厂商对指定网页登录会话自动化的书面许可、允许频率、资料责任人和门店复核人 → 形成脱敏字段样例、实体房型映射和人工金标准 → 另行评审独立浏览器会话代理并申请开始单一适配器离线代码 → 完成受信任构建并由migration/deployment owner登记候选 → 由授权人员直接向外部SecretStore写入真实凭据 → 建立隔离UAT网络、重新人工认证、Worker蓝绿身份实操和单一适配器影子联调。不得把网页登录态复用误作官方API接入，也不得让现有Worker接触Cookie本体。

真实轮换必须撤销旧凭据、关闭旧连接池、由具备`pg_signal_backend`的独立运维身份终止旧backend并确认`pg_stat_activity=0`后才可retire；还须补做真实并发写切换和15分钟墙钟长测。真实企微送达和双店3个PMS营业日验收仍未完成，因此不得解除`test/activate/run`和数据库运行态阻断。任何范围变更仍需记录；真实凭据不得进入对话、文档、代码、日志或夹具，真实连接器、真实Webhook和正式群发送不得以离线结果替代验收。
