# OTA-AUTOMATION-V0.1 Sprint 2D 离线人工授权演练实施报告

任务编号：`OTA-AUTOMATION-V0.1`  
实施日期：2026-07-25  
阶段范围：Sprint 2D 程序内人工授权流程的离线演练、持久化状态机与后台控制面  
当前判断：`SPRINT 2D OFFLINE REHEARSAL COMPLETE / REAL PMS AUTHORIZATION BLOCKED / REAL CONNECTORS BLOCKED / PRODUCTION NO-GO`

---

## 一、结论与授权边界

产品负责人要求进入下一步骤。本轮在既有浏览器会话安全骨架之上，实现了一个可以在独立后台实际操作、刷新恢复并审计的 **离线人工授权演练**。它用于先验证未来程序内人工登录流程的控制面、状态机、并发和权限边界，不代表已经登录PMS。

演练的安全不变量固定为：

- 模式始终为`OFFLINE_REHEARSAL`。
- 对外授权状态始终为`AUTH_REQUIRED`。
- “确认完成”只把流程状态变为`OFFLINE_REHEARSAL_COMPLETE`，不会产生`AUTHORIZED`、`ACTIVE`或`VALID`。
- 运行态始终为`runtimeBlocked=true`、`pmsConnected=false`、`browserStarted=false`、`credentialsRead=false`。
- 不打开浏览器，不访问PMS或OTA网络，不解析SecretStore，不读取账号、密码、验证码、Cookie、Token或浏览器存储。
- 不采集、分析或发送任何真实经营数据，不触发P1告警或企业微信群消息。

因此，本轮完成的是“程序内人工授权工作流的离线可操作验证”，不是“真实PMS授权”或“数据抓取—分析—微信推送闭环”。

## 二、本轮已实现

### 2.1 独立助手的纯离线状态机

`apps/ota-browser-session-helper`新增纯内存、无I/O的人工授权演练契约：

- `PENDING_HELPER → WAITING_FOR_OPERATOR → OFFLINE_REHEARSAL_COMPLETE`
- 等待态可进入`CANCELLED`、`EXPIRED`或`FAILED`
- 所有终态不可复活，只能创建新的重新演练记录
- 命令与查询绑定精确tenant、hotel、connector、connector version、config version、actor和attempt
- 时间必须单调，15分钟截止后不能继续确认
- 所有状态的`authorizationState`都固定为`AUTH_REQUIRED`

该包没有进程、文件、网络、DNS、HTTP客户端、浏览器驱动、SecretStore或数据库实现。

### 2.2 V6持久化与最小权限写入

Flyway V6新增：

- `ota.browser_authorization_attempt`
- `ota.browser_authorization_command_receipt`
- `ota.start_browser_authorization_rehearsal(...)`
- `ota.transition_browser_authorization_rehearsal(...)`

数据库强制：

- 两张表启用并强制RLS，按tenant隔离。
- attempt只能保存`OFFLINE_REHEARSAL + AUTH_REQUIRED`。
- 同一连接器同一时间只能有一个有效等待态。
- 开始、确认、取消和重新演练要求精确配置版本、行版本、操作人、认证会话、幂等键、请求哈希和原因码。
- 只有活动的`PLATFORM_ADMIN`数据库会话可以执行写函数；API把已认证principal中的account ID和session ID在同一租户事务内绑定为`app.account_id`与`app.auth_session_id`，请求体和请求头不能自报或替换。
- API角色对attempt和receipt均只有`SELECT`，没有直接`INSERT/UPDATE/DELETE`；所有写入必须经过两个受控函数。
- receipt追加写且不可更新或删除；过期等待记录由开始新演练的函数原子失效并留下回执和审计证据。
- 到达`expires_at`后，转换函数拒绝确认、取消和失败，只允许进入`EXPIRED`；不能用取消覆盖已经过期的事实。
- 重新演练把前置attempt ID和期望行版本传给17参数开始函数；函数在同一事务内`FOR UPDATE`锁定精确范围和操作人的前置记录并执行CAS，消除Java预读到创建之间的竞争窗口。
- 连接器必须仍为最新的`CONFIGURATION_ONLY + DRAFT + PMS + CONTROLLED_BROWSER`版本，并存在已配置的`BROWSER_SESSION`不透明引用；数据库再次核验，不能只依赖页面或Java校验。

### 2.3 API控制面

独立API新增以下本地接口：

- `POST .../browser-authorization-attempts`：开始离线演练
- `GET .../browser-authorization-attempts`：读取最近一次演练，供页面刷新恢复
- `GET .../browser-authorization-attempts/{attemptId}`：查看指定演练
- `POST .../{attemptId}/confirm`：确认离线流程已走完
- `POST .../{attemptId}/cancel`：取消演练
- `POST .../{attemptId}/reauthenticate`：从终态创建新的重新演练

写操作仅允许`PLATFORM_ADMIN + CONNECTOR_AUTHORIZATION_MANAGE`，并绑定当前认证操作人与认证会话；五类集团级岗位保持跨租户只读。所有写请求要求`Idempotency-Key`、期望版本和原因码，未知请求字段直接拒绝。

响应不返回操作人ID、交互引用、SecretStore引用、URL、请求头或任何秘密，只返回最小范围、适配器版本、流程状态、时间、版本和固定安全标志，并设置`Cache-Control: no-store`。

### 2.4 独立后台

已保存且符合`PMS + CONTROLLED_BROWSER`条件的连接器草稿会显示“离线人工授权演练”面板。页面支持：

- 开始演练
- 刷新和页面重开后恢复最近状态
- 确认离线演练
- 取消
- 终态后重新演练

页面对服务端响应再次Fail Closed：只接受`OFFLINE_REHEARSAL`、允许的流程状态、`AUTH_REQUIRED`和四个固定安全标志；任何边界异常都作为错误显示，不会把异常响应解释成授权成功。刷新恢复时还会要求记录的`configVersion`与当前连接器配置精确一致，旧配置记录不会遮挡新配置的“开始演练”入口，也不会误触发旧记录重新演练。

## 三、明确未实现

1. 未启动Chrome、Edge、Playwright、Selenium或其他浏览器驱动。
2. 未访问`pms.meituan.com`或任何PMS、携程、美团、企业微信地址。
3. 未读取、保存、解析或重放账号、密码、验证码、Cookie、Token、Header、浏览器存储或SecretStore值。
4. 未实现真实独立助手进程传输、Windows Credential Manager/其他SecretStore实现或会话托管。
5. 未实现别样红PMS字段适配器、营业日、房费、钟点房、间夜、订单或库存采集。
6. 未运行小时收益分析、P1房态不匹配告警、企业微信群`@所有人`投递或过时简报补发。
7. 未执行双店连续3个PMS营业日UAT，未部署、未改变生产配置，`message_enabled`继续不得开启。

用户此前提供的真实Cookie未被本轮代码、配置、数据库、文档、日志或测试数据使用和保存。

## 四、验证结果

| 验证项 | 结果 | 证据范围 |
|---|---|---|
| Java全量Maven聚合 | `PASS` | 按当前测试源码计`283`项，失败`0`、错误`0`、条件式PostgreSQL跳过`2` |
| PostgreSQL 14.22专项 | `PASS` | 临时隔离数据库执行Flyway V1→V6、API/Worker两项真实集成测试、运行时ACL、catalog负控和结构校验全部通过；双连接竞争中contender实际等待约`800ms`后收到`40001`，只有leader成功 |
| Helper模块 | `PASS` | 模块共`28`项，其中本轮离线演练状态机与无I/O边界新增`12`项 |
| Web自动化 | `PASS` | Node`16/16`，TypeScript `tsc -b`通过，Vite生产构建通过并转换`42`个modules |
| 敏感会话标记扫描 | `PASS` | 五类已知会话标记命中`0`，未发现用户此前提供的Cookie字段进入项目资产 |
| 无I/O助手边界 | `PASS` | 演练源码无网络、HTTP、文件、进程、浏览器驱动、SecretStore或环境变量读取实现 |
| 独立安全复核 | `PASS` | 初次发现`3`项P1和`1`项P2，全部修复；第二次复核确认原问题关闭且无新增P0/P1 |
| 真实PMS授权与连接 | 未实施 | `BLOCKED` |
| 真实采集、分析与企微投递 | 未实施 | `BLOCKED` |
| 双店UAT与生产 | 未实施 | `NO-GO` |

Maven中的两项条件跳过需要真实PostgreSQL环境，已由PostgreSQL 14.22专项补证。最终尝试执行`clean test`时，Windows拒绝删除既有`packages/ota-contracts/target`目录；未手工删除或改动该目录，随后在保留现场的情况下执行完整`test`并通过。上表Java数量按当前源码对应的Surefire报告汇总，排除了Helper目录中一个已无对应源码的历史报告。以上PASS只证明离线演练与Fail Closed边界符合当前契约，不证明外部系统可连接。

## 五、下一阶段门禁

下一阶段不能直接改成Cookie自动登录或自动抓取，仍须按以下顺序另行放行：

1. 取得美团别样红正式OpenAPI门店/方法权限；若必须使用网页登录会话，则取得覆盖指定门店、只读路径、字段、频率和环境的厂商书面许可。
2. 实现并评审独立助手进程的本机认证传输、操作系统SecretStore、可见人工登录窗口、最小egress和会话失效重认证；真实秘密不得进入API、Worker、数据库业务字段、页面、日志或Git。
3. 在隔离UAT中由门店授权人员现场输入凭据，先验证只读范围和门店隔离，再形成脱敏字段合同与离线fixture。
4. 单独实现并批准首个PMS适配器，完成金标准对账后，才进入真实采集影子联调。
5. 真实分析、P1告警和企业微信群投递继续分别验收；两家门店各连续3个PMS营业日通过后，才能申请生产放行。

## 六、阶段状态

| 能力 | 当前状态 |
|---|---|
| 浏览器会话离线安全骨架 | `COMPLETE` |
| Sprint 2D离线人工授权演练 | `COMPLETE` |
| 真实浏览器人工认证运行时 | `BLOCKED` |
| 真实PMS授权与会话托管 | `BLOCKED` |
| 真实PMS / 携程 / 美团连接器 | `BLOCKED` |
| 真实经营分析与P1告警 | `BLOCKED` |
| 真实企业微信投递 | `BLOCKED` |
| 双店真实UAT | `NO-GO` |
| 生产发布 | `NO-GO` |
