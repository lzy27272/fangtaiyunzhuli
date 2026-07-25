# ADR-001：独立OTA后台本地认证与会话安全协议

任务编号：`OTA-AUTOMATION-V0.1`
状态：`ACCEPTED / SPRINT 0`
日期：2026-07-23
依据：`DESIGN-1.5`、`TECH-DESIGN-1.0`、编码就绪报告第五章
适用组件：`ota-standalone-web`、`ota-standalone-api`

## 一、背景与边界

试点后台必须在AI中台身份服务尚未完成时独立运行，同时保留未来OIDC映射能力。本ADR只冻结已确认T4的实现协议，不扩大业务范围，不提供真实PMS、OTA或企业微信接入，也不把本地人员会话用作自动采集、分析或投递身份。

本地人员账号、来源/投递Secret和不可交互服务身份严格分离。人员退出、Access Token到期或浏览器关闭不停止后台自动任务。

## 二、决定

### 2.1 密码与账号

1. 本地密码仅保存Argon2id摘要，当前参数为64 MiB内存、3次迭代、并行度1、16字节随机盐和32字节摘要；算法及版本随凭据记录保存，可升级但不得降级为快速哈希。
2. 登录名只作身份入口，业务记录始终引用稳定`account_id`。未来OIDC使用`issuer + subject`映射原账号，不改写历史主体。
3. 连续5次密码失败锁定账号15分钟。错误响应不区分账号不存在、停用、锁定或密码错误，避免枚举。
4. 账号锁定之外，应用另设按规范化账号及来源地址分别计数的1分钟登录限流。当前上限为每账号10次、每来源30次，超限返回`429 + Retry-After`并追加审计。
5. 限流器使用只保存指纹的有界缓存；容量耗尽时拒绝新尝试，不能因内存压力绕过。该端口可替换为生产共享限流存储，多副本上线前必须验证跨副本总限额。
6. 账号停用或`authz_version`变化立即使Refresh会话及Access Token失效。角色、门店范围和租户范围只由服务端当前账号数据计算，不相信客户端自报值。

### 2.2 Access Token

1. Access Token为HS256签名JWT，有效期10分钟，包含本地`account_id`、会话ID、`authz_version`、当前固定角色、签发/到期时间、令牌ID和签发者。
2. 登录和刷新响应只返回`accessToken`、`expiresInSeconds`和`account{id,displayName,roles}`；响应使用`Cache-Control: no-store`。
3. Web只把Access Token保存在内存，通过`Authorization: Bearer`发送；不得放入Cookie、Local Storage、Session Storage、URL、日志或埋点。
4. API验证签名、`kid`、签发者、时间、会话状态、账号状态及当前`authz_version`。Refresh复用、退出或全会话撤销后，关联Access Token即使尚未到期也被拒绝。

### 2.3 Refresh Token与轮换

1. Refresh Token使用至少256位CSPRNG随机数；数据库只保存SHA-256摘要，原值只进入浏览器Cookie。
2. Refresh会话家族绝对有效期12小时。每次刷新生成新Token并原子消费旧Token，轮换不延长家族到期时间。
3. 已轮换或已撤销Token再次出现即判定复用：同一会话家族全部撤销，当前Access Token立即失效，并记录`auth.refresh.reuse`审计。
4. 登录、刷新、退出和复用处理都不把Token、Cookie或摘要写入普通日志、错误正文或审计。
5. Refresh Cookie固定为：
   - 名称`ota_refresh`
   - `HttpOnly`
   - `Secure`
   - `SameSite=Strict`
   - `Path=/api/v1/auth`
6. `POST /api/v1/auth/logout`撤销整个当前会话家族。管理员恢复、账号停用、角色/权限变化可执行账号全会话撤销并追加审计。

### 2.4 CSRF与Origin

1. Refresh和退出使用Cookie认证，必须执行双提交CSRF校验。
2. 服务端另发随机`ota_csrf` Cookie：`Secure; SameSite=Strict; Path=/`且非HttpOnly，使根路径Web页面可读取；Web将同值放入`X-CSRF-TOKEN`请求头。
3. Refresh Cookie仍限制在`/api/v1/auth`，不得为了让Web读取CSRF值而扩大Refresh Cookie路径。
4. 登录、刷新和退出出现`Origin`时，只接受后台配置的精确HTTPS白名单；不允许`*`。无浏览器Origin的受控运维调用仍受TLS、限流和认证规则约束。
5. Bearer业务接口不使用Cookie派生身份，不信任客户端角色或租户字段。

### 2.5 CORS与响应头

1. CORS只允许精确HTTPS Origin、`GET/POST/OPTIONS`以及必需的`Authorization`、`Content-Type`、`X-CSRF-TOKEN`和`X-Correlation-ID`头。
2. 允许凭据仅用于已批准Origin的认证Cookie请求。
3. API统一启用HSTS、`frame-ancestors 'none'`、`default-src 'none'`、`base-uri 'none'`、`form-action 'none'`、拒绝Frame及`Referrer-Policy: no-referrer`。
4. 默认`forward-headers-strategy=none`并忽略客户端转发头。生产TLS在反向代理或入口终止时，只有先完成受信代理边界评审和显式配置，才可启用框架转发头处理；不能直接信任任意`X-Forwarded-*`。

### 2.6 签名密钥加载与轮换

1. 配置只保存`secret_ref`，不得保存签名密钥值。Sprint 0提供严格的`env:<registered-name>`适配器，生产可替换为Secret Manager/KMS端口。
2. HS256密钥至少256位随机字节，以Base64形式由Secret注入；缺失、不可解析或过短时应用拒绝启动。
3. 新签发只使用当前`kid`。轮换时可配置一个旧`kid`、旧Secret引用及明确`valid-until`；三项必须同时存在，旧`kid`必须与当前`kid`不同，旧密钥只用于验证，不再签发。
4. 应用启动时强制旧密钥窗口晚于当前时刻且不超过`当前时刻 + Access TTL + 2分钟`。窗口结束后删除旧引用并撤销异常会话。
5. 紧急泄露时停止接受旧`kid`、撤销全部会话、轮换Secret并审计；不得通过延长旧密钥窗口维持可用性。

## 三、首个管理员与恢复

1. 系统没有默认账号、默认密码、共享密码、开发请求头认证或HTTP Bootstrap端点。
2. 首个`PLATFORM_ADMIN`只能在空数据库执行一次性离线引导，必须同时提供：显式启用开关、固定确认短语、登录名、显示名和一次性密码Secret引用。
3. API在同一PostgreSQL事务中取得固定事务级advisory lock，再检查账号表为空并插入首个账号；多个副本并发引导只能有一个成功。
4. 密码至少16字符，成功后立即移除一次性Secret并关闭引导开关。引导失败不打印密码或Secret引用解析值。
5. 生产启用前配置两名可恢复平台管理员。恢复必须验证人员身份，重置凭据、递增`authz_version`、撤销全部会话并追加原因审计；不得直接修改摘要或复用他人账号。

## 四、租户隔离与受控命令

1. 普通业务事务通过`SET LOCAL app.tenant_id`设置单一租户，并立即用`control.current_tenant_id()`复核；API数据库角色必须`NOBYPASSRLS`且不是业务表所有者。
2. 集团跨租户只读只接受服务端当前账号生成的`ota.monitor.cross-tenant.read`权限。执行器从服务端启用租户目录取值，逐租户开启独立只读事务并汇总。
3. 任一租户失败必须返回`PARTIAL`及明确缺失租户；全部失败返回`UNAVAILABLE`，不得把缺失显示为0。
4. 平台配置写入只接受密封的固定命令类型、单一目标租户、显式权限、幂等键、预期`row_version`及原因码。执行器不接受SQL文本、任意脚本、租户数组或通用租户切换。
5. CEO、OTA运营助理、OTA运营经理和区域经理的全租户能力只有只读，不由此获得配置写权限。

## 五、数据库身份与GRANT

| 身份 | 允许 | 明确禁止 |
|---|---|---|
| `ota_migration_owner` | 执行受审Flyway迁移，创建对象、RLS和GRANT | 作为API/Worker日常账号 |
| `ota_api_app` | 认证控制面所需最小SELECT/INSERT/UPDATE；单租户RLS业务读写；追加审计 | `BYPASSRLS`、业务表所有权、任意跨租户SQL、审计UPDATE/DELETE |
| `ota_worker_app` | 领取已分配作业、单租户采集结果和Outbox最小权限 | 人员认证表写入、集团跨租户读取、配置命令 |
| `ota_audit_writer`或受控函数 | `control.audit_event`仅INSERT | SELECT Secret、UPDATE/DELETE审计 |
| `ota_audit_reader` | 脱敏审计只读视图 | 业务写入、Secret读取、审计修改 |

全局作业目录只返回领取作业所需的租户、连接器、作业类型和运行ID，不含经营数据或Secret；函数固定`search_path`并使用显式列。

Flyway只由独立迁移Job使用`ota_migration_owner`执行。API默认`spring.flyway.enabled=false`，运行时若被启用则拒绝进入服务；API身份不得通过“启动时顺便迁移”获得表所有权。迁移Job固定使用`flyway.flyway_schema_history`。API启动时以只读权限检查该表：不得存在`success=false`记录，且V1必须成功；同时确认`control.auth_account`、`control.auth_session`、`control.audit_event`和`ota.hotel`已经存在。Flyway的`success=false`即本协议所称失败/dirty状态。

## 六、审计与关联标识

1. 登录成功/拒绝、限流、Refresh、复用、退出、全会话撤销、首管引导、跨租户读取及受控命令必须追加审计。认证、首管和受控命令的成功审计与状态变更处于同一事务；失败/拒绝证据使用独立事务。成功审计失败必须回滚对应变更，不得留下无审计高权限状态。
2. 浏览器可提供`X-Correlation-ID`字符串。若为UUID则直接使用；否则服务端以带命名空间SHA-256稳定映射为UUID后写入数据库UUID列。原字符串不直接绑定UUID列，也不作为Secret保存。
3. 审计只保存动作、主体引用、认证来源、结果、原因、覆盖和关联标识；密码、Token、Cookie、Webhook、验证码、密钥及浏览器会话一律禁止。

## 七、Fail-closed与运行健康

以下任一情况发生时应用不得进入Readiness：

- PostgreSQL URL缺失、不是`jdbc:postgresql://`，或URL内嵌用户/密码。
- 专用数据库运行账号缺失。
- 当前数据库身份为超级用户、拥有`BYPASSRLS`、是任一`ota`普通表所有者，或`row_security`未开启；应用在Bootstrap之前查询PostgreSQL系统目录并拒绝启动。
- 当前签名Secret引用缺失、解析失败、Base64无效或不足256位。
- Refresh/CSRF Cookie不为`Secure + SameSite=Strict`，或路径分离被改变。
- CORS包含通配符或非HTTPS Origin。
- 启用Bootstrap但未使用一次性Secret引用。
- 必需数据库对象或`flyway.flyway_schema_history`缺失、迁移历史存在`success=false`，或尚未成功执行V1。
- API进程内Flyway被启用。

Liveness只判断进程；Readiness同时包含数据库和签名材料。健康响应不得披露数据库地址、账号、Secret引用、密钥ID历史或异常堆栈。

## 八、验证门禁

Sprint 0至少验证：

1. Argon2id摘要及错误密码拒绝。
2. Access Token签名、篡改、到期和`authz_version`变化拒绝。
3. Refresh原子轮换、旧Token复用导致会话家族撤销。
4. 登录限流与账号锁定为两条独立控制。
5. Refresh Cookie仅认证路径可见，CSRF Cookie在Web根路径可读；缺失/不匹配CSRF或不可信Origin被拒绝。
6. 非UUID关联头转换后可安全写入UUID列。
7. 跨租户只读逐租户事务及`PARTIAL/UNAVAILABLE`覆盖；非集团角色拒绝。
8. 受控命令仅平台管理员、显式权限、单租户、固定命令类型可执行。
9. 真实PostgreSQL验证无租户/错租户不可见、正确租户可见，审计及证据表拒绝UPDATE/DELETE。
10. 启动门禁拒绝空库、缺失迁移历史、失败迁移、低于V1的数据库及不安全的历史表标识符。

第9项必须在允许启动PostgreSQL的测试环境执行；沙箱不能启动数据库时应报告`ENVIRONMENT BLOCKED`，不得改用H2宣称RLS通过。

## 九、后果与后续

本协议允许本地账号闭环独立运行，并以稳定`account_id`支持未来OIDC切换。代价是API必须在每次Bearer请求检查当前账号和会话状态，且多副本生产需要共享限流存储、正式Secret Manager/KMS、独立PostgreSQL身份和恢复演练。以上属于上线门禁，不得用开发模式绕过。
