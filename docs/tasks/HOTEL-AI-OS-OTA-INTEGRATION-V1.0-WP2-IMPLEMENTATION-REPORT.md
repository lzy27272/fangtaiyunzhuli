# 四方馆 Hotel AI OS × OTA 服务 V1.0

## WP2 门店 PMS/OTA 配置与凭据迁移准备实施报告

版本：V1.0
日期：2026-08-12
状态：离线安全范围内完成；真实凭据迁移与外部接入继续 `NO-GO`

## 1. 本阶段结论

WP2 已在不接触真实 Secret、不访问 PMS/OTA、不启用外部网络和不变更生产环境的前提下，完成：

- 门店×PMS/OTA 配置草稿的既有能力复核；
- 岗位与门店范围数据库投影的前向对齐；
- 旧 `REVENUE_MANAGER` 活跃分配停用及不可篡改证据；
- 只读/写入授权的 `UAT_REQUIRED` 非执行草稿；
- 仅引用既有 Secret 绑定的元数据迁移演练；
- 服务端 API、租户边界、权限门禁、幂等、版本校验与脱敏审计；
- 静态迁移、部署结构和 Java 离线测试。

本报告不表示已迁移任何账号、密码、Cookie、Token、API Key 或 Webhook，也不表示任何门店已经接通、授权、通过 UAT 或开始自动采集/推送。

## 2. 复用的既有基础

V2–V6 已提供：

- `ota.hotel_source_connector`：门店×来源绑定；
- `ota.hotel_source_connector_version`：版本化非秘密配置；
- `ota.connector_secret_binding`：不透明 `secret_ref`、版本和安全指纹；
- `ota.connector_authorization_state`：连接器会话授权状态；
- `CONFIGURATION_ONLY`：不可执行的接入草稿模式；
- 浏览器人工授权的离线演练，固定保持 `AUTH_REQUIRED`。

WP2 没有复制这些表，而是补充其缺少的组织角色、业务授权和迁移准备元数据。

## 3. V7 前向迁移

新增迁移：

`database/ota-migrations/V7__wp2_store_source_binding_and_credential_migration_prep.sql`

### 3.1 岗位与门店范围

新增数据库岗位：

- `GENERAL_MANAGER`；
- `ASSISTANT_GENERAL_MANAGER`；
- `FRONT_OFFICE_SUPERVISOR`。

数据库权限投影与已冻结的应用矩阵对齐：

- OTA 运营助理、总经理、店助、前厅主管可在授权门店预览并发起调价申请；
- OTA 运营经理拥有审核并同步、收益规则、预警策略、AI 策略和 Secret 引用管理权限；
- 所有动作仍必须同时通过精确 `tenant_id + hotel_id + action` 范围检查；
- `REVENUE_MANAGER` 仅保留为历史解码标识，不再获得新授权。

V7 追加 `control.role_deprecation_event`，记录前向停用影响数量；迁移会结束已有活跃 `REVENUE_MANAGER` 分配，并用触发器拒绝以后创建新的活跃分配。历史角色和历史行不删除。

### 3.2 授权草稿

新增 `ota.connector_access_authorization_draft`：

- 区分 `READ` 与 `WRITE`；
- 当前状态只能是 `UAT_REQUIRED`；
- `execution_allowed` 数据库固定为 `false`；
- 写入范围只能声明 `STANDARD_RETAIL_ONLY`；
- 正式授权与 UAT 只能保存 SHA-256 证据引用；
- 追加写、FORCE RLS、无 UPDATE/DELETE 运行权限。

该表不能证明厂家授权，不能解锁连接器，也不能触发 OTA 读写。

### 3.3 凭据迁移演练

新增 `ota.credential_migration_rehearsal`：

- 只绑定已经存在的 `connector_secret_binding.binding_id`；
- 旧环境位置只允许保存 SHA-256 指纹，不保存路径、文件名或值；
- 表内没有 `secret_ref`、密码、Cookie、Token、API Key、Webhook 或原始位置列；
- `migration_mode` 固定为 `METADATA_ONLY`；
- `rehearsal_state` 固定为 `METADATA_REHEARSAL_READY`；
- `raw_secret_received=false`、`execution_allowed=false` 由数据库约束；
- 插入时再次校验门店、连接器版本、用途、提供方、版本、指纹和绑定状态；
- 仅允许 `CONFIGURATION_ONLY + DRAFT`；
- 追加写并启用 FORCE RLS。

## 4. 服务端接口

新增接口：

- `GET /api/v1/ota/tenants/{tenantId}/hotels/{hotelId}/connector-onboarding/{connectorId}/credential-migration-rehearsals`
- `POST /api/v1/ota/tenants/{tenantId}/hotels/{hotelId}/connector-onboarding/{connectorId}/credential-migration-rehearsals`

POST 只接收：

- 连接器版本 ID；
- 期望的 Secret 绑定行版本；
- Secret 用途；
- 旧系统代码；
- 旧位置 SHA-256；
- 目标提供方、目标 Secret 版本和目标安全指纹；
- 原因码和幂等键。

请求模型不存在密码、Cookie、Token、SecretStore 引用或原始位置字段；未知字段失败关闭。响应也不返回绑定 ID 或 `secret_ref`。

准备操作当前只允许平台管理员，且必须同时具备连接器配置与 Secret 引用管理权限。OTA 运营经理可以读取脱敏结果，但不能通过该接口执行迁移。

## 5. 数据与 Secret 边界

冻结以下边界：

1. SecretStore/KMS 是 Secret 本体的唯一事实源。
2. OTA 服务数据库只保存不透明引用、版本、指纹、用途和状态。
3. AI 中台其他功能只能通过版本化数据/命令网关读取标准化数据或调用授权能力，不能直接读取 SecretStore、OTA 数据库或原始凭据。
4. 连接器未来只可在单任务、单门店、单渠道、单用途、短生命周期租约内解析一个 Secret。
5. 本阶段没有 `ScopedSecretStorePort` 生产实现，也没有受控真实录入通道。

## 6. 验证结果

### 6.1 静态数据库与部署结构

- V1–V7 迁移结构：通过；
- 17 个 control 表和 59 个 FORCE-RLS 门店表：通过；
- 31 个追加写防护：通过；
- `CONFIGURATION_ONLY`、授权 `UAT_REQUIRED`、迁移 `METADATA_ONLY`：通过；
- 未新增 REAL 连接器、外部交付或执行开关：通过；
- 运行账号最小授权与 Worker 不可访问 WP2 准备元数据：通过。

### 6.2 定向 Java 测试

执行结果：10 项，0 失败，0 错误，0 跳过。

覆盖：

- 平台管理员成功准备；
- OTA 运营经理写入拒绝；
- 旧收益经理读取拒绝；
- 原始旧位置拒绝；
- 密码、Cookie、Token、`secretReference`、原始位置未知字段拒绝；
- 精确租户写事务；
- Secret 绑定行版本冲突；
- 目标绑定元数据一致性；
- 幂等命令凭证；
- JDBC 查询不选择 `secret_ref`；
- 无 HTTP 客户端、Secret 解析器、调度器或运行队列依赖。

### 6.3 敏感信息扫描

- 11 个新增 WP2 文件：0 发现、0 错误；
- 全部相关修改文件扫描只有 `verify-postgresql.sql` 的既有负向测试字符串 `bearer_value=forbidden` 命中 `BEARER_CREDENTIAL` 规则；该字符串是校验敏感键拒绝能力的固定伪测试数据，不是凭据。

### 6.4 OTA 平台全量离线回归

执行 `ota-platform-pom.xml` 全量测试：

- 共 308 项；
- 0 失败；
- 0 错误；
- 2 项跳过。

跳过项是既有的真实 PostgreSQL 特殊集成测试；本阶段遵守服务保持停止和不迁移生产数据库的边界，因此未启动数据库来执行这两项。其余 contracts、浏览器会话助手、独立 API 和连接器 Worker 均通过。

## 7. 未执行事项与继续门禁

以下事项仍未执行：

- 未选择或部署生产 SecretStore/KMS；
- 未建立生产连接器服务身份与 KMS 策略；
- 未建立真实凭据受控录入/双人复核通道；
- 未导入任何真实门店、渠道酒店 ID 或 Secret；
- 未访问 PMS、OTA、企业微信或模型提供方；
- 未运行真实只读连通性、字段映射、金标准比对或全门店 UAT；
- 未撤销旧环境真实凭据；
- 未启用 OTA 写入或自动调价；
- 未迁移或部署生产数据库。

真实凭据迁移继续 `NO-GO`，直到以下条件全部完成验收：

1. SecretStore/KMS 产品、区域、密钥托管、备份与灾备确认；
2. 连接器服务身份及单任务短租约策略确认；
3. 全部门店×PMS/OTA×酒店 ID 脱敏清单确认；
4. 厂家/渠道正式只读授权确认；
5. 安全录入通道、双人复核、失败撤销和旧环境销毁流程确认；
6. 单门店虚构演练与授权 UAT 通过。

## 8. 下一工作包

下一阶段建议进入 WP3：只读连接器与标准化经营事实。

安全起步范围仍应限定为：

- 只使用虚构适配器或正式授权的 UAT；
- 先实现 PMS/OTA 只读端口、字段映射、数据新鲜度和质量码；
- 不启用真实全门店采集；
- 不发送企业微信消息；
- 不执行房价、库存、房态或渠道状态写入；
- 生产 SecretStore 和全门店授权未验收前保持真实接入 `NO-GO`。
