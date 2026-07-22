# Hotel AI OS API-V1 使用说明

当前机器可读契约见 [`openapi.yaml`](./openapi.yaml)，候选契约版本为 `0.2.4-pilot.7`。PILOT.7 在 `/api/v1` 内兼容补齐任务视图、可下发对象、原子创建派发和CEO门店驾驶舱，不改变 API 主版本。

## 身份与权限

生产环境使用 Bearer JWT/企业 SSO。服务端以 JWT 中的租户与账号标识查询数据库，解析有效角色、权限、组织范围和任职；客户端提交的角色或组织范围不会被信任。

本地联调必须显式设置 `DEV_HEADER_AUTH_ENABLED=true`，并仅发送：

- `X-Tenant-Id`：联调租户。
- `X-Actor-Id`：联调账号。
- `X-Correlation-Id`：可选，缺省由服务端生成并回传。

`X-Role-Code` 与 `X-Org-Scope` 已退出身份决策。当前身份基线可通过 `GET /api/v1/iam/me` 查询。

## 写操作约定

- 规则动作、任务创建/流转和标准评价等可重试命令必须携带 `Idempotency-Key`。
- 更新或状态流转携带 `expectedVersion`；当前运行时将版本或状态校验失败作为 `400 application/problem+json` 返回。
- 业务错误采用 `application/problem+json`。
- 附件通过 `multipart/form-data` 真实落盘，PILOT.6允许JPEG、PNG、PDF、DOCX和XLSX，单文件最大20 MiB；图片解码并重新编码，OOXML校验ZIP结构，所有文件计算SHA-256并执行恶意文件扫描。正式模式保持fail-closed。

## Sprint 2.1 资源清单

| 资源 | 路径前缀 | 主要能力 |
|---|---|---|
| 当前身份 | `/api/v1/iam/me` | 数据库驱动的角色、权限、组织范围与一人多岗任职 |
| 组织主数据 | `/api/v1/org/units` | 组织查询、新建、编辑、启停与未引用数据受控删除 |
| 岗位主数据 | `/api/v1/org/positions` | 岗位查询、新建、编辑、启停与未引用数据受控删除 |
| 人员主数据 | `/api/v1/org/employees` | 人员/账号新建、编辑、启停、管理员密码重置、任职与受控删除 |
| 工作包 | `/api/v1/work-packages` | 定义、版本、范围、标准关联、校验、发布、停用、分配 |
| 工作周期 | `/api/v1/work-duty-periods` | 班次/日/周周期及工作期望生成 |
| 岗位工作 | `/api/v1/*/work-expectations` | 我的工作、团队工作、详情、豁免、取消与漏交 SLA 处理 |
| 工作记录 | `/api/v1/work-data/records` | 草稿、提交、复核、真实图片上传/查看/删除与重提留痕 |
| 企业规则 | `/api/v1/rules` | 事件+条件+动作、模拟、发布与停用 |
| 管理事件 | `/api/v1/management-events` | Outbox 投影、消费和恢复 |
| 任务 | `/api/v1/tasks` | 创建、派发、确认、执行、提交、评价、验收、返工、取消、逾期提醒与升级 |
| 标准评价 | `/api/v1/standard-evaluations` | 确定性评价、人工判断、标准版本快照 |
| 通知 | `/api/v1/notifications` | 任职级通知与已读状态 |
| 驾驶舱 | `/api/v1/dashboards` | 店总单店风险/未完成任务与区域运营多店汇总 |
| 企业模板 | `/api/v1/templates` | CEO配置、修订和发布任务及门店驾驶舱模板；管理角色只读已发布版本 |

## TECH-V0.2-PILOT.6 新增关键契约

- `POST/PUT /api/v1/work-data/records`：草稿允许分步保存，最终提交按已发布表单和岗位工作提交策略完整校验；支持完成情况、异常协同和下一步行动。
- `POST /api/v1/work-data/records/{recordId}/supplements`：原执行任职可在待复核期间追加不可变说明。
- `POST /api/v1/tasks`：主管及以上可选择精确执行任职和验收任职创建并下达管理任务。
- `POST /api/v1/tasks/{taskId}/evidence/upload`、`GET .../content`、`DELETE .../{evidenceId}`：执行负责人提交任务证据；提交结果后证据不可删除。
- `/api/v1/templates`：任务和门店驾驶舱模板采用定义→草稿版本→发布→历史版本模型，管理和发布仅授予CEO。
- 岗位标准工作模板仍使用`/api/v1/work-packages`，由CEO创建草稿版本、配置提交策略、发布并按任职下发。

## TECH-V0.2-PILOT.7 修复契约

- `GET /api/v1/tasks?view=mine|team|review|all`：由服务端按账号全部有效任职和任务专用管理范围返回数据；可叠加`status`及`orgUnitId`组织子树筛选。
- `GET /api/v1/tasks/targets`：只返回调用者可下发的有效任职。CEO为租户全量，店内管理岗为所在门店，OTA岗位为授权范围内门店管理岗位；不会扩大其他模块的通用组织权限。
- `POST /api/v1/tasks`：`reviewerAssignmentId`可省略并由服务端确定安全验收人；`creatorAssignmentId`记录发起任职；`dispatchNow=true`时创建、派发、通知和审计在同一事务提交。
- 任务读取范围与下发目标范围独立计算：跨店下发能力不会扩大`team/all`读取范围；读取始终服从账号的有效角色授权范围。
- 未绑定标准的临时任务可由指定验收人在`RESULT_SUBMITTED`直接`APPROVE`或`REJECT`并写入审计；绑定标准的任务仍禁止绕过标准评价。
- `GET /api/v1/dashboards/operations`与`GET /api/v1/dashboards/hotels/{hotelId}`：CEO可选择租户内门店；店内主管只可访问其所属门店，跨门店仍拒绝。

主数据维护继续使用API-V1向后兼容边界。`PUT`负责资料和`ACTIVE/INACTIVE`生命周期；`DELETE`只接受已停用且没有业务引用的数据。已存在任职、授权、工作或任务历史时返回400并要求保留停用记录，禁止级联删除历史。所有写操作要求`org.manage`，并继续执行租户和组织范围检查。

## Sprint 2.1 UAT 关键契约

- `POST /api/v1/work-data/records/{recordId}/attachments/upload`：以 `file` 字段上传 JPEG/PNG，返回附件 ID、对象键、SHA-256、恶意文件扫描状态和 `contentUrl`。TECH-V0.2 RC 已在正式 JWT 模式下使用 ClamAV 1.5.3 及签名 CVD 病毒库完成实际扫描并返回 `CLEAN`；该结果验证扫描器集成，不替代真实现场照片、目标对象存储和恢复演练验收。
- `GET /api/v1/work-data/records/{recordId}/attachments`、`GET /api/v1/work-data/attachments/{attachmentId}/content`、`DELETE /api/v1/work-data/records/{recordId}/attachments/{attachmentId}`：分别用于附件列表、二进制查看和删除。已复核记录不允许增删附件。
- `POST /api/v1/work-expectations/sla/process?limit=100`：将到期未交期望标记为 `MISSED`，返回 `processedCount`、`batchLimit`、`expectationIds`和 `processedAt`，并产生 `WorkExpectationMissed` 事件。
- `POST /api/v1/tasks/sla/process`：返回 `overdueTasks`、`escalations`、`cancelledEscalations`和 `notifications`，用于核对逾期提醒与升级执行。
- `GET /api/v1/dashboards/hotels/{hotelId}`：新增 `risks`、`incompleteTasks`、`openTaskCount`、`overdueTaskCount`和 `missedWorkCount`。
- `GET /api/v1/dashboards/operations`：按服务端组织范围返回可见门店及各店未完成任务、逾期任务、失败评价、漏交和当日提交计数。

## 管理闭环

```text
已发布标准
  → 已发布工作包
  → 岗位工作期望
  → 工作记录提交
  → Outbox / Management Event
  → Rule Engine
  → 管理任务 / 通知
  → 执行证据与结果
  → 标准评价
  → 验收通过或返工
```

规则引擎只处理确定性阈值、状态和时间条件。文本理解、原因分析与建议生成属于后续 AI Gateway/Agent 能力，不进入规则真值判断。

## 任务状态机

```text
PROPOSED → PENDING_ACK → IN_PROGRESS → RESULT_SUBMITTED
                                      → AWAITING_REVIEW
                                      → COMPLETED
                                      → REWORK → IN_PROGRESS
任一未终态可在授权下 → CANCELLED
```

`RESULT_SUBMITTED → AWAITING_REVIEW` 由标准评价完成事件驱动，不能绕过评价直接验收。责任人和验收人均绑定精确 `employee_position_assignment`，同一员工的不同任职不会自动合并。

## 数据隔离

1. Controller 不接受可覆盖服务端身份的 `tenant_id`。
2. Service 查询显式附加当前 `tenant_id` 与组织/参与人范围。
3. 事务写入 PostgreSQL `app.tenant_id`。
4. 所有租户业务表启用并强制执行 RLS。
5. 跨实体关系使用同租户组合外键。
6. 工作、任务、评价和通知在组织范围基础上继续执行任职级校验。

## 事件可靠性

业务事务与 `outbox_event` 同时提交。提交后由投影器写入 `management_event`，消费端通过 `event_consumer_inbox`、规则评价和动作幂等键防止重复副作用；失败事件保留可恢复状态，不得被误标为成功。
