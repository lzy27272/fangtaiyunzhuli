# OTA-AUTOMATION-V0.1 Sprint 2C 实施报告

任务编号：`OTA-AUTOMATION-V0.1`  
实施日期：2026-07-23  
阶段范围：Sprint 2C 离线准入治理、持久化合同基线消费与服务身份轮换门禁  
当前判断：`SPRINT 2C OFFLINE ADMISSION GOVERNANCE COMPLETE / REAL CONNECTORS BLOCKED / PRODUCTION NO-GO`

---

## 一、结论与授权边界

产品负责人要求继续实施下一步。本轮只建设不依赖真实账号、真实凭据或外部网络的 **Sprint 2C 离线准入治理**：把连接器合同候选、批准、吊销、Worker执行前校验和数据库服务身份蓝绿轮换纳入可审计的Fail Closed边界，并在独立后台提供只读准入就绪度。

代码、迁移、全量回归、Web构建、静态门禁、PostgreSQL 14.22专项和独立安全复核均已完成。该结论只表示 **离线准入治理** 已完成，不表示存在真实适配器候选、真实账号、真实数据抓取、真实经营分析或企业微信自动推送闭环。

本轮没有开放任何真实外联能力：

- 可信候选清单仍为空，没有PMS、携程或美团真实适配器构建可供批准。
- 管理员API与页面仅展示`CANDIDATE_UNAVAILABLE`，不能批准、吊销、测试、激活或运行连接器。
- Worker只为未来非本地连接器增加执行前持久化基线校验；内置simulation和编译期`FILE_FIXTURE`继续按原离线边界运行。
- 没有录入、读取、解析或轮换任何真实PMS、OTA、SecretStore、数据库或企业微信凭据。
- 没有访问PMS、携程、美团或企业微信网络，没有抓取真实数据，没有发送任何企微消息。
- 双店真实UAT和生产发布继续为`NO-GO`，`message_enabled`不得开启。

## 二、本轮已实现

### 2.1 可信候选与批准/吊销证据

Flyway V5新增由migration/deployment owner发布的追加式可信候选清单。候选只保存服务端构建产生的连接器代码、适配器版本、stream、capability/schema指纹、制品摘要和源码修订，不保存任何凭据，也不授予运行或外联能力。

数据库边界固定为：

- `PMS_INTAKE`、`CTRIP_INTAKE`、`MEITUAN_INTAKE`零能力占位模板不得登记为可信候选。
- V5不会把V4中可能由调用方提供的指纹自动升级为可信候选；发现既有批准行时迁移直接Fail Closed。
- 新批准必须引用可信候选，并绑定精确tenant、hotel、connector、connector version、stream和当时的非秘密`config_hash`。
- capability/schema指纹由候选清单覆盖写入，审批调用方不能自行提交或替换指纹。
- 批准和吊销命令要求活动的已认证`PLATFORM_ADMIN`数据库会话、租户上下文、期望版本、请求哈希、幂等键和原因码。
- 批准、吊销和命令回执均为追加事实；已有批准不原地修改，吊销另写不可变证据。
- 连接器配置哈希变化、明确吊销或版本不再`ACTIVE`时，原批准不再构成可执行基线。
- 共享API运行角色不获得候选清单写入、批准或吊销能力。

当前migration/deployment owner尚未登记任何真实适配器候选，因此所有配置草稿保持候选不可用。

### 2.2 只读管理员准入状态

独立API新增：

- `GET /api/v1/ota/tenants/{tenantId}/hotels/{hotelId}/connector-contract-admissions`

该接口沿用五类集团岗位的跨租户只读边界和服务端租户事务，只读取目标门店最新的`CONFIGURATION_ONLY + DRAFT`配置版本。它不读取或返回候选指纹、批准指纹、SecretStore引用、凭据或运行状态表。

当前响应固定为：

- `admissionState=CANDIDATE_UNAVAILABLE`
- `candidateAvailable=false`
- `approvalAvailable=false`
- `revocationAvailable=false`
- `runtimeBlocked=true`
- `admissionRowVersion=0`
- blockers包含`SERVER_OWNED_CONTRACT_CANDIDATE_UNAVAILABLE`和`CONFIGURATION_ONLY_NOT_EXECUTABLE`

独立后台新增“连接器准入就绪度（只读）”区域，只显示上述服务端状态，不包含输入框、批准/吊销按钮或任何测试、激活、运行入口。

### 2.3 Worker持久化基线执行前门禁

Worker新增持久化批准基线Reader和执行前preflight。任何未来非本地连接器在调用`collect`前都必须：

1. 在目标租户事务内调用数据库窄函数读取精确connector version和stream的有效批准基线。
2. 由数据库确认当前session绑定到活动的`CONNECTOR_WORKER`服务主体。
3. 确认基线存在、未吊销、配置哈希未变化、连接器版本为`ACTIVE`且指纹算法受支持。
4. 将持久化capability/schema指纹与运行时descriptor及代码评审schema重新计算结果比较。

缺少唯一Reader、数据库读取失败、无基线、已吊销、版本未激活、算法不支持或指纹漂移时，Worker均在`collect`前Fail Closed，并只返回固定脱敏原因码。Worker仅获得窄函数`EXECUTE`，不直接读取候选、批准或吊销表。

豁免范围按具体实现类封闭，只包括三个内置simulation连接器和内置只读`FILE_FIXTURE`。未来新增连接器不能仅通过伪造代码或模式名称绕过持久化批准。

### 2.4 Service principal蓝绿轮换门禁

V5把`CONNECTOR_WORKER`数据库角色绑定扩展为`STAGED → ACTIVE → DRAINING → RETIRED`蓝绿状态机，并保存追加式轮换事件。owner侧受控函数负责stage、promote和retire：

- 新主体必须是活动的`CONNECTOR_WORKER`，绑定到安全、独立、非超管、`NOBYPASSRLS`的LOGIN数据库角色。
- 同一作用域的BLUE/GREEN活动槽唯一，主体、数据库角色、作用域和槽位一经绑定不可原地改写。
- promote后新主体成为`ACTIVE`，旧主体进入`DRAINING`。
- 新dispatch、claim和renew只允许`ACTIVE`主体；旧`DRAINING`主体仅可在`draining_at`后15分钟内完成切换前取得且仍有效的租约，不能领取或续租。
- `DRAINING`仅保留15分钟有界tenant SELECT以完成上述旧租约；直接事实/Outbox DML同样要求`ACTIVE`，不能借只读窗口创建新写入。
- 旧主体仍有未到期租约时不得retire；retire后绑定不可恢复，主体同步`DISABLED`且不得重新激活。
- 轮换函数和事件表不授予API或Worker运行角色，不包含任何密码、Token或Secret值。

本轮只实现数据库安全协议与验证资产，没有执行真实凭据轮换、连接池切换或生产轮换演练。数据库状态切换不等于旧凭据已经撤销，也不等于旧连接池或旧数据库backend已经退出。

## 三、明确未实现

1. 未建立任何真实PMS、携程或美团适配器，可信候选清单仍为空。
2. 未提供通过HTTP或页面批准、吊销合同基线的写入口；当前页面只读。
3. 未连接或解析外部SecretStore/KMS，未处理真实账号、Cookie、Token、验证码、Webhook或数据库密码。
4. 未访问真实PMS、携程、美团页面/API/数据库或报表，未采集任何真实订单间夜、房费、钟点房、库存、房态或PMS营业日数据。
5. 未运行真实小时经营分析、P1房态不匹配即时告警或真实企微补发。
6. 未向两家试点门店运营群发送消息，未执行`@所有人`，`message_enabled`继续为`false`。
7. 未完成隔离UAT网络、首次人工认证、真实Worker服务身份蓝绿演练、双店各连续3个PMS营业日UAT或生产发布。

因此，当前仍不能声称本地账号已经实现真实“数据抓取—分析—微信自动推送”闭环。

## 四、最终验证状态

| 验证项 | 当前状态 | 最终结果 |
|---|---|---|
| Contracts / API / Worker Maven聚合回归 | `PASS` | 主代理最终复跑确认：共`209`项，失败`0`、错误`0`、条件式PostgreSQL跳过`2` |
| PostgreSQL 14.22专项 | `PASS` | API`1/1`、Worker`1/1`；Flyway V1→V5由`LOGIN/NOSUPERUSER/NOINHERIT/NOBYPASSRLS` owner执行，post-grants、runtime grants、catalog及负向控制全部通过 |
| Web自动化测试 | `PASS` | Node`11/11`，TypeScript `tsc -b`通过，Vite生产构建通过并转换`40`个modules |
| 数据库静态门禁 | `PASS` | `17`张control表、`55`张FORCE RLS租户表、`27`个append-only保护对象及V5合同/轮换门禁通过 |
| 部署静态门禁 | `PASS` | one-shot部署顺序、Compose逐文件Flyway V1→V5挂载、grants及verifier通过 |
| 独立安全复核 | `PASS WITH RECORDED P2` | P0=`0`、P1=`0`；P2均已登记为非放宽项 |
| 真实PMS / 携程 / 美团连接 | 未实施 | `BLOCKED` |
| 真实SecretStore解析 | 未实施 | `BLOCKED` |
| 真实企业微信送达 | 未实施 | `BLOCKED` |
| 双店真实UAT | 未实施 | `NO-GO` |
| 生产发布 | 未实施 | `NO-GO` |

Maven聚合中的两项条件跳过是需要PostgreSQL环境的集成测试，已由上述PostgreSQL 14.22 API`1/1`和Worker`1/1`专项补证。以上PASS只证明离线准入治理和Fail Closed边界符合当前契约，不证明任何外部系统可连接。

### 4.1 独立安全复核与已登记P2

文档收口后安全结论为P0=`0`、P1=`0`。以下P2均为已登记限制，不构成真实接入或生产放行：

1. `artifact_digest`目前仅作为非运行时制品/签名证明的存档值，不是Worker执行时重新验证的制品证明。
2. stage/promote/retire轮换函数尚无覆盖完整命令字段的command receipt与完整幂等协议。
3. 批准命令的`request_hash`由caller提供，receipt尚未覆盖所有规范化请求字段，不能把它视为服务端重算的完整请求证明。
4. Worker preflight不是Java执行沙箱：它会在`collect`前校验，但descriptor读取发生在preflight之前，连接器类静态初始化和实例构造可能更早发生。当前没有真实适配器或外部egress，且real profile硬拒绝启动，因此本阶段没有形成可利用的外联路径；未来真实连接器仍必须使用独立进程/容器、在加载连接器代码前完成制品准入，并采用默认拒绝网络策略。
5. 尚未执行真实并发写事务下的蓝绿切换演练，也未完成真实15分钟墙钟长测；现有验证使用数据库规则和受控时间场景。
6. 真实PMS/携程/美团连接、外部SecretStore、隔离网络、真实企业微信投递仍为`BLOCKED`。

## 五、真实连接器前剩余条件

### 5.1 服务端可信候选

- 完成单一真实适配器代码、制品、SBOM、SAST/依赖扫描和代码评审。
- 从同一受信任构建产物计算adapter version、capability/schema指纹、artifact digest和source revision；在补齐运行时制品证明前，`artifact_digest`仅作存档。
- 由migration/deployment owner登记候选，不允许浏览器、共享API或厂商响应自行声明指纹。
- 真实适配器必须部署在独立进程/容器中，在类加载、静态初始化和实例构造前完成制品准入；运行环境默认拒绝网络，只按已批准连接器和目标域名开放最小egress。不得把`collect`前preflight当作Java执行沙箱。
- 建立候选撤回、紧急停用、批准、吊销及回退操作手册和责任人。

### 5.2 外部资料与隔离环境

- 收齐PMS、携程、美团厂商文档、字段字典、限流/分页/增量/夜审语义、酒店ID和脱敏样例。
- 配置专用最小权限测试账号、外部SecretStore、隔离UAT网络、出口白名单、TLS和受控浏览器/Agent。
- 完成产品名称到PMS实体房型的全量映射，多个套餐/含早/无早产品继续共享实体房量且不得相加。
- 为两家试点门店准备人工金标准和差异签字人。

### 5.3 身份轮换与投递验收

- 为蓝绿Worker配置两个独立数据库LOGIN角色和独立凭据。受控顺序必须为：验证新凭据与新连接池 → stage/promote → 撤销旧凭据 → 关闭旧连接池 → 由具备`pg_signal_backend`的独立运维身份终止旧角色backend → 确认`pg_stat_activity`中旧角色会话为`0` → 等待切换前租约完成或过期 → retire。数据库协议不会自动完成真实凭据或会话轮换。
- 完成真实并发写事务切换演练和真实15分钟墙钟长测；冲突写事务必须回滚，再由新`ACTIVE`身份在租约过期后重放。
- 在测试群验证企业微信Webhook、`@所有人`、小时简报、即时P1、失败重试、结果不明和全部过时简报补发。
- 两店分别完成连续3个PMS营业日真实UAT；只有单店全部门禁通过并获得明确批准后，才可单店开启真实消息。

## 六、阶段门禁

| 阶段 | 当前状态 | 下一门禁 |
|---|---|---|
| Sprint 0安全底座 | `COMPLETE` | 维持冻结基线 |
| Sprint 1模拟闭环 | `COMPLETE` | 维持simulation-only和真实投递禁发 |
| Sprint 2A离线安全底座 | `COMPLETE` | 维持真实profile与外部egress Fail Closed |
| Sprint 2B离线准备控制面 | `COMPLETE` | 配置可登记，但不得测试、激活或运行 |
| Sprint 2C离线准入治理 | `COMPLETE` | 保持候选清单为空和运行态Fail Closed，直至外部条件另行验收 |
| 可信真实适配器候选 | `EMPTY / BLOCKED` | 服务端受信任构建、审查和owner登记 |
| 真实PMS / 携程 / 美团连接器 | `BLOCKED` | 外部文档、账号、SecretStore、网络、候选批准和单适配器UAT |
| 真实企业微信投递 | `BLOCKED` | 测试群真实送达、安全、幂等和补发验收 |
| 双店真实UAT | `NO-GO` | 两店分别连续3个PMS营业日通过金标准核对 |
| 生产发布 | `NO-GO` | 安全、监控、灾备、值班、身份/Secret生命周期和发布审批全部完成 |

Sprint 2C离线准入治理完成不会自动解锁真实连接器、真实企微投递、双店UAT或生产发布。上述能力必须逐项满足外部条件并获得新的明确放行。
