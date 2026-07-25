# OTA自动化程序内PMS登录离线骨架实施报告

任务编号：`OTA-AUTOMATION-V0.1`
实施日期：2026-07-25
版本：`IMPLEMENTATION-BROWSER-SKELETON-0.1`
结论：`OFFLINE BROWSER SESSION SKELETON COMPLETE / REAL PMS LOGIN BLOCKED / PRODUCTION NO-GO`

## 一、实施目标

本轮按产品负责人的“继续写程序，后续在程序里面进行PMS链接登录”指令，只实现程序内受控登录所需的离线代码骨架和安全契约，不连接PMS、不驱动浏览器、不解析或重放Cookie，也不开放真实采集、企业微信发送或生产能力。

程序后续接入PMS登录时，授权人员应在独立浏览器助手中现场完成认证。现有后台、API和Worker只接收不透明授权句柄或SecretStore定位符，不得接收账号、密码、验证码、Cookie、Token、Authorization请求头或浏览器存储状态。

## 二、已完成代码

### 1. 独立浏览器会话助手骨架

新增`apps/ota-browser-session-helper`独立Java模块，包含：

- `PENDING_INTERACTIVE_LOGIN → ACTIVE → EXPIRING → REAUTH_REQUIRED → REVOKED`会话状态机；
- 租户、门店、连接器/适配器版本、配置版本、操作人和授权尝试的不可变绑定；
- HTTPS协议、显式端口、主机、方法、路径和请求合同的精确白名单策略；
- 每次连接及重定向逐跳校验解析地址，拒绝空解析、回环、链路本地、私网、元数据和其他非公网地址；
- POST完整规范化请求合同的SHA-256绑定；
- 服务端固定、只接收键名而不接收值的非秘密配置Schema；
- 固定、脱敏错误码；
- 无I/O的浏览器助手组合端口。

该模块没有HTTP客户端、浏览器驱动、网络出口、SecretStore实现、持久化、调度器或厂商适配器。`ACTIVE`只表示未来外部运行时提供的内存状态，不代表已经登录，也不代表已获得厂商许可。

### 2. API授权控制面

新增纯离线`OfflineBrowserAuthorizationControlPlane`及`BrowserAuthorizationBindingPort`：

- 复用连接器的`BROWSER_SESSION_AUTH`能力；
- 启动时把租户、门店、连接器、配置版本、适配器版本、操作人、授权尝试、不透明句柄及过期时间登记为服务端绑定；
- 探测和撤销必须按授权尝试读取绑定并逐字段复核，拒绝跨操作人、跨门店、跨连接器、跨版本、过期或已撤销请求；
- 底层连接器的探测和撤销强制携带授权尝试ID，不回退到无尝试ID的旧方法；
- 返回值只包含固定状态码、时间及`urn:sifangguan:browser-auth:*`不透明句柄；
- 不向调用方返回连接器原始文本；
- 绑定Port没有生产实现，控制面未注册为Spring Bean，未增加HTTP端点、持久化或网络能力。

### 3. Worker隔离桥接契约

新增`IsolatedBrowserConnectorClient`及其命令模型：

- 只接受`vault://`、`oskeyring://`或`secretstore://`不透明定位符；
- 强制租户、门店、操作人、授权尝试、连接器、配置版本、连接器版本、适配器版本、数据流、用途、Secret Binding版本和截止时间与采集请求一致；
- 只有命中独立可信`BrowserOperationAdmissionManifest`全部字段后，才能生成浏览器客户端接受的私有能力令牌；
- Manifest构造器为私有，条目及可信来源接口仅包内可见，当前生产没有来源实现或运行时装配；
- Worker命令、可信条目和能力令牌的字符串输出均隐藏范围、授权尝试及SecretStore定位符；
- `VAULT`、`OSKEYRING`和`SECRETSTORE`提供方必须分别匹配对应引用协议；
- 拒绝Cookie请求头形态、空白、端口、查询参数、片段、URI用户信息和不安全业务代码；
- 当前实现固定失败为`BROWSER_SESSION_HELPER_NOT_ENABLED`，不会发起网络或浏览器操作。

现有真实连接器启动门禁未放宽，真实Profile仍按原设计拒绝启动。

### 4. 后台配置准备

PMS接入模板和配置页面现已支持选择`CONTROLLED_BROWSER`：

- PMS受控浏览器模式固定要求`BROWSER_SESSION`用途；
- 后台只允许填写SecretStore不透明引用；
- 页面明确禁止粘贴Cookie；
- 模板仍为`DRAFT_INTAKE_ONLY`且`executable=false`。

这表示“配置结构已经就绪”，不表示“真实PMS登录已经可用”。

## 三、安全负向边界

测试覆盖以下拒绝场景：

- 把Cookie请求头或包含分号、等号的值当作会话引用；
- 使用`envref://`、HTTP URL或未经允许的引用协议；
- 租户、门店、连接器或用途不一致；
- 操作人、授权尝试、配置版本、连接器版本、适配器版本、数据流、Secret Binding版本或可信操作清单不一致；
- 浏览器助手超出采集超时窗口；
- 目标不是HTTPS、端口/主机/方法/路径或POST请求摘要不在精确白名单；
- DNS解析为空或包含回环、私网、链路本地、元数据及其他非公网地址；
- 重定向目标未单独列入白名单；
- 配置键不在服务端固定非秘密Schema；
- Secret提供方与引用协议不匹配；
- 通过API控制面暴露URL、SecretStore引用或连接器原始响应文本；
- 在浏览器助手模块引入HTTP、Playwright、Selenium、SecretStore实现或网络依赖。

源码及文档敏感标记扫描未发现已知会话Cookie字段被保存。

## 四、验证结果

- Java聚合测试：`254`项，`0`失败，`0`错误，`2`项条件式PostgreSQL跳过；
- 其中`ota-contracts 40`项、`ota-standalone-api 83`项、`ota-connector-worker 113`项、`ota-browser-session-helper 18`项；
- Web Node测试：`12/12`通过；
- TypeScript编译：通过；
- Vite生产构建：通过，转换`40`个模块；
- 真实连接器固定拒绝测试：通过；
- 本轮无数据库迁移、无真实连接器候选、无真实Secret解析、无网络出口。
- 最终独立安全复核：当前离线范围`P0=0 / P1=0 / P2=0`；真实运行时仍须以独立鉴权的持久化授权记录实现可信Manifest来源。

## 五、尚未实施

以下能力仍需后续单独批准和实施：

1. 厂商OpenAPI权限或网页登录自动化书面许可；
2. 独立浏览器助手的真实传输协议及进程隔离；
3. Windows凭据管理器、OS Keyring或Vault的真实适配器；
4. 后台人工登录入口、重新认证和撤销接口；
5. 试点门店身份校验、只读目标白名单和字段语义确认；
6. 美团别样红PMS数据适配器、可信候选准入、影子联调及连续3个PMS营业日UAT；
7. 真实周期抓取、P1即时告警和企业微信群投递。

在上述门禁完成前，不得在后台、聊天、代码、数据库业务字段、日志或配置文件中粘贴真实Cookie。

## 六、下一实施入口

优先申请正式签名式OpenAPI。如OpenAPI不能覆盖冻结数据字段，且已取得厂商对指定门店、只读路径、字段和频率的书面许可，再实施：

`后台发起授权 → 独立助手打开登录页 → 授权人员现场认证 → 会话只存外部SecretStore → Worker仅持不透明引用 → 精确白名单只读采集 → 会话失效转人工重新认证`
