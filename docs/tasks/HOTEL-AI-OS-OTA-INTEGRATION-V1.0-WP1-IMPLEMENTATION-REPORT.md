# 四方馆 AI 中台“门店房态收益助手”WP1 离线安全基础实施报告

文档版本：`WP1-1.0`

形成日期：2026-08-12

状态：`OFFLINE FOUNDATION COMPLETE / REAL INTEGRATION NO-GO / NO PRODUCTION CHANGE`

依据：

- `HOTEL-AI-OS-OTA-INTEGRATION-V1.0-IMPLEMENTATION-READINESS.md`
- `HOTEL-AI-OS-OTA-INTEGRATION-V1.0-WP0-READINESS.md`

---

## 1. 实施结论

WP1 已完成身份与岗位映射、门店范围门禁、Secret 引用和短租约契约、数据/命令网关受理骨架、幂等/版本冲突语义及脱敏审计基础。

本阶段全部能力保持离线：

- 没有创建或修改数据库迁移。
- 没有新增 UI 或启用功能开关。
- 没有启动本地或云端服务。
- 没有连接 PMS、OTA、企业微信、模型提供方或生产 SecretStore。
- 没有接收、保存或迁移真实凭据。
- 没有实现或调用任何房价、库存、开关房写入。

## 2. 已实施内容

### 2.1 AI 中台身份与岗位映射

新增服务端可信身份解析：

- `PlatformRoleMapper`
- `PlatformIdentityAuthorizationService`

只接受 `IdentityProviderPort` 返回的服务端身份和角色，不接收客户端自报角色。当前映射的中台岗位：

- `PLATFORM_ADMIN`
- `OTA_OPERATION_ASSISTANT`
- `OTA_OPERATION_MANAGER`
- `CEO`
- `REGIONAL_MANAGER`
- `GENERAL_MANAGER`
- `ASSISTANT_GENERAL_MANAGER`
- `FRONT_OFFICE_SUPERVISOR`

禁用账号、只有未知岗位的账号或只有旧 `REVENUE_MANAGER` 的账号不能形成 OTA 授权上下文。未知岗位只记录数量，不把不受控岗位字符串带入后续日志或响应。

### 2.2 旧“收益经理”兼容收口

组织已确认不存在“收益经理”岗位，因此：

- `REVENUE_MANAGER` 仅为旧数据和旧响应兼容而保留，并标记为 Deprecated。
- 它不再获得查看、房型映射、收益目标、节奏曲线、预览、申请、审批或 Secret 管理权限。
- 收益规则维护权限移交 `OTA_OPERATION_MANAGER`，仍要求授权门店范围。
- 历史 V1 迁移不做破坏性重写；如生产数据库存在旧角色分配，后续前向迁移须另行停用并保留审计证据。

### 2.3 已冻结岗位权限

| 岗位 | 授权门店读取 | 调价预览 | 提交申请 | 审核并同步 | 收益规则 | Secret引用 |
|---|---|---|---|---|---|---|
| OTA运营经理 | 是 | 是 | 是 | 是 | 是 | 是 |
| OTA运营助理 | 是 | 是 | 是 | 否 | 否 | 否 |
| 店总 | 是 | 是 | 是 | 否 | 否 | 否 |
| 店助 | 是 | 是 | 是 | 否 | 否 | 否 |
| 前厅主管 | 是 | 是 | 是 | 否 | 否 | 否 |
| 区域经理 | 是，只读 | 否 | 否 | 否 | 否 | 否 |
| CEO | 是，只读 | 否 | 否 | 否 | 否 | 否 |
| 平台管理员 | 技术范围 | 否 | 否 | 否 | 否 | 是 |

本表只建立授权基础，不代表调价功能已经实现。OTA 运营经理自己发起时由另一账号审核的规则留待 WP7 调价领域实现。

### 2.4 精确门店范围门禁

新增：

- `StoreScopeAuthorizationPort`
- `GatewayAuthorizationService`

所有网关动作同时验证：

1. 服务端认证账号。
2. 角色对应的显式权限。
3. 精确 `tenant_id`。
4. 精确 `hotel_id`。
5. 动作对应的 Scope Type。

同一个已授权门店 ID 不能与另一个租户 ID 组合复用；全局只读岗位也不能绕过网关的门店授权记录。

### 2.5 网关契约、版本和幂等

新增契约：

- `GatewayScope`
- `GatewayRequestMetadata`
- `GatewayErrorCode`

新增受理骨架：

- `GatewayAction`
- `GatewayIdempotencyPort`
- `GatewayCommandAdmissionService`
- `GatewayAdmissionException`

命令要求：

- 8–200 字符受控幂等键。
- 非负 `expectedVersion`。
- SHA-256 请求指纹。
- 受控关联标识。

处理语义：

- 期望版本不一致返回 `VERSION_CONFLICT`，不占用幂等记录。
- 相同账号、租户、门店、动作、幂等键和请求指纹为安全重放，返回原受理编号。
- 同键不同请求返回 `IDEMPOTENCY_CONFLICT`。
- 越权或范围不符返回 `FORBIDDEN_SCOPE`。
- 成功受理/重放使用事务内审计；拒绝使用独立失败审计。

当前只有端口和离线受理服务，没有数据库幂等适配器，也不会执行外部业务动作。

### 2.6 Secret 引用和短租约

新增 `ScopedSecretStorePort`：

- 禁止旧式无范围 `open(SecretReference)` 调用。
- 每次解析必须带服务身份、工作项、操作码、请求时间和到期时间。
- 租约必须大于 0 且最长 5 分钟。
- 生产适配器必须再次校验服务身份、门店、渠道、用途和到期，并追加不含 Secret 的审计。
- `SecretReference`、`SecretAccessRequest` 和网关元数据的 `toString()` 均隐藏引用、账号范围和请求指纹。

本阶段没有 `ScopedSecretStorePort` 生产实现，测试只使用明显虚构的离线引用。

## 3. 变更范围

### 3.1 契约包

- 新增网关范围、请求元数据和错误码。
- 新增短租约 SecretStore 端口。
- Secret 引用日志表示改为脱敏。
- 认证 OpenAPI 增加店总、店助和前厅主管角色值；旧收益经理值暂留兼容。

### 3.2 OTA API

- 增加中台身份和岗位映射。
- 更新冻结的角色权限矩阵。
- 收益规则权限由旧收益经理迁至 OTA 运营经理。
- 店总、店助、前厅主管可在授权门店读取预览所需配置，但不能读取运营监控和连接器配置。
- 增加门店级网关授权与命令受理骨架。

### 3.3 未变更

- `database/migrations`
- `database/ota-migrations`
- Web UI
- Worker 外联实现
- 企业微信发送实现
- 模型调用实现
- 生产配置和云端部署

## 4. 验证结果

### 4.1 WP1 定向测试

覆盖：

- 网关契约与脱敏。
- 短租约、过期、超时和无范围访问拒绝。
- 中台岗位映射、禁用账号和未知岗位拒绝。
- 冻结角色权限矩阵。
- 精确租户×门店×动作范围。
- 版本冲突、幂等重放、同键异请求冲突。
- OTA 运营经理收益规则范围。
- 店总预览输入的门店级读取边界。

结果：`21 tests / 0 failures / 0 errors / 0 skipped`。

### 4.2 OTA 全量离线回归

最终回归已覆盖契约、独立 API、浏览器会话 Helper 和连接器 Worker。

结果：`302 tests / 0 failures / 0 errors / 2 skipped`。

两项跳过均为需要真实 PostgreSQL 环境的既有专项；本阶段没有启动数据库。真实 PostgreSQL 专项仍按既有环境门禁单独执行，不能用普通单元测试替代。

### 4.3 静态安全检查

- 12 个新增核心文件未发现 HTTP 客户端、Socket、进程执行、环境变量读取、JDBC 或其他外联/持久化实现。
- 新增核心文件逐文件敏感信息扫描为 `PASS / CLEAN`。
- `git diff --check` 通过。

## 5. 已知限制与后续门禁

1. `GatewayIdempotencyPort` 只有端口；数据库适配器必须把幂等预留和成功审计放在同一事务。
2. 旧收益经理数据库种子仍存在于历史迁移；不能修改 V1，后续须用前向迁移停用现有分配。
3. `ScopedSecretStorePort` 没有生产实现；SecretStore/KMS 产品和服务身份尚未确认。
4. 中台 OIDC 适配器尚未接入，只完成 `IdentityProviderPort` 后的授权解析。
5. 价态预览、申请和审批只存在权限码，不存在领域处理器、API 或外部写入。
6. 当前没有数据库和服务运行验证；本阶段不启动环境。

## 6. WP1 完成判定

WP1 在离线安全基础范围内完成。它证明岗位、范围、Secret 使用和命令受理可以失败关闭，但不证明真实身份、SecretStore、PMS/OTA 或生产数据库已接通。

下一阶段为 WP2：门店×PMS/OTA 绑定、授权元数据和安全凭据迁移准备。WP2 可先实现不含真实 Secret 的前向数据库结构、服务端 API 和虚构迁移演练；真实迁移必须等 SecretStore/KMS 选型、服务身份和受控录入通道验收后才可开启。
