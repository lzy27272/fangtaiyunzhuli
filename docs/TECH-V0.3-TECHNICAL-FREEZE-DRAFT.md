# Hotel AI OS TECH-V0.3 技术冻结报告（草案）

文档版本：DRAFT-V0.1  
日期：2026-07-18  
产品基线：PRODUCT-V1.2  
目标技术版本：TECH-V0.3  
状态：`DRAFT / PENDING REVIEW / 不构成Sprint 3开工批准`  
前置版本：TECH-V0.2必须先正式Released

> 本文件用于提前固化Sprint 3的安全边界和首个可验收切片。G0-01—G0-07未全部关闭，本文未批准，当前不得创建V14迁移、合并AI业务代码或启用真实模型调用。

## 一、冻结目标

TECH-V0.3在不改变PRODUCT-V1.2核心管理链的前提下，让AI进入现有“标准→工作→规则→任务→执行→验收”闭环。AI只能理解、分析和提出草稿；人工负责复核，规则中心负责确定性动作，任务中心负责执行与验收。

首个最小完整切片冻结为：

```text
前台客诉类工作记录提交
→ 版本化触发策略
→ 后台Worker创建分析任务
→ AI Gateway调用批准模型
→ 生成带来源和标准版本的分析/发现/任务建议DRAFT
→ 前厅主管人工批准
→ 写入AITASKSUGGESTIONAPPROVED管理事件
→ Rule Engine决定负责人、SLA、通知和升级
→ 创建既有management_task
→ 执行、复评、验收与反馈沉淀
```

该切片必须端到端可运行，不能以孤立Gateway、空表或静态页面代替业务闭环。

## 二、不可破坏模型

1. 组织模型：租户、集团、品牌、区域、门店、部门、岗位、员工分层不变。
2. 一人多岗：账号、员工、岗位、任职、角色继续分离；所有操作绑定当前有效任职。
3. 权限隔离：服务端RBAC、OrgScopeResolver、任职有效期及PostgreSQL `FORCE RLS`继续共同生效。
4. 标准中心：AI必须引用精确的已发布标准、工作包和Prompt/Agent版本；已发布版本不可修改。
5. 规则中心：阈值、时间、SLA、通知和升级继续由确定性规则负责，大模型不是真值源。
6. 任务中心：沿用既有任务状态机、负责人/验收人任职规则和禁止自我验收约束。
7. 人工门禁：AI输出仅为DRAFT；不得直接创建任务、发布规则/标准、处罚、晋升、调价或替CEO决策。
8. 模块协作：Agent不得直连或修改业务表，只能通过受控只读工具、API与事件协作。

## 三、首个实施切片边界

### 3.1 本切片包含

- AI Gateway统一调用入口、Provider适配接口、超时、重试、成本与审计。
- 模型、Prompt、Agent、工具白名单及触发策略的不可变版本。
- `WORKRECORDSUBMITTED`中“前台客诉”单一受控触发源。
- 分析Job、Attempt、Context Snapshot、Model Call、Result、Finding、Task Suggestion和Review Decision。
- Worker租约、幂等、退避、死信、恢复及指标。
- 前厅主管的分析列表、详情和建议复核三个页面。
- 人工批准事件接入既有Rule Engine与Management Task闭环。

### 3.2 本切片不包含

- 经营、点评、CEO Agent正式业务实现。
- OTA实时接入、自动调价、自动处罚、自动晋升。
- 图片进入模型；首切片仅使用经裁剪的文本和结构化字段。
- AI绕过人工复核直接生成高影响业务动作。

## 四、候选数据库边界

正式DDL必须在TECH-V0.2发布后评审并从V14开始，仅新增迁移，不修改V1—V13。

- V14：Provider、Model、Tenant Model Policy、Service Principal与Grant。
- V15：Prompt/Agent版本、Tool Policy与Trigger Policy。
- V16：Analysis Job、Attempt、Context Snapshot、Model Call及Worker索引。
- V17：Result、Finding、Task Suggestion与Review Decision。
- V18：后续报告、CEO决策与来源关系，仅在相应切片批准后进入。

每个迁移新增的租户表必须在同一迁移内完成：`tenant_id NOT NULL`、租户/组织复合约束、`ENABLE RLS`、`FORCE RLS`、策略、runtime最小权限、必要唯一键和审计字段。禁止等到V18集中补RLS。

## 五、事件与状态冻结

- 触发事实：`WORKRECORDSUBMITTED`。
- 分析Job：`PENDING → LEASED → RUNNING → SUCCEEDED | FAILED | DEAD_LETTER`。
- 分析结果：`DRAFT → IN_REVIEW → APPROVED | REJECTED | SUPERSEDED`。
- 任务建议：`DRAFT → IN_REVIEW → APPROVED | REJECTED`。
- 唯一批准事件：`AITASKSUGGESTIONAPPROVED`，必须包含tenant、org、source work record、result、suggestion、reviewer assignment、Agent/Prompt/Model版本和Correlation ID。
- 同一来源、触发策略和Agent版本的逻辑Job必须幂等；事件重放10次只能产生1个Job和1次有效批准动作。

## 六、AI Gateway与工具权限

1. 100%模型调用经过Gateway，业务模块不得存在旁路模型客户端。
2. Secret只保存外部密钥引用，不进数据库明文、日志、Prompt或证据包。
3. Agent工具默认拒绝，仅允许字段级白名单只读查询。
4. 有效范围取tenant、用户/服务主体授权、当前任职、组织范围、触发策略和工具策略交集。
5. Context Snapshot必须记录来源ID、精确版本、裁剪字段、内容哈希和数据截止时间。
6. Model Call记录Provider/Model、Prompt/Agent版本、Token、成本、延迟、重试、错误分类和Correlation ID。
7. 模型失败、Schema不合法或证据不足时不得伪造成功结果或创建任务建议。

## 七、首切片API候选

保持API-V1兼容扩展：

- `GET /api/v1/ai/analysis-jobs`
- `GET /api/v1/ai/analysis-jobs/{id}`
- `GET /api/v1/ai/analysis-results/{id}`
- `GET /api/v1/ai/task-suggestions/{id}`
- `POST /api/v1/ai/task-suggestions/{id}/submit-review`
- `POST /api/v1/ai/task-suggestions/{id}/approve`
- `POST /api/v1/ai/task-suggestions/{id}/reject`
- `GET /api/v1/ai/audit/model-calls`

所有写接口必须使用`Idempotency-Key`和`expectedVersion`；资源读取必须经过服务端范围解析及RLS双重校验。

## 八、首切片页面

- `/ai/work-analysis`：本人或授权团队的分析列表。
- `/ai/work-analysis/:id`：来源、标准版本、证据、分析、风险与成本详情。
- `/ai/task-suggestions/:id/review`：主管批准/拒绝，理由必填，明确标识“AI建议≠管理决定”。

## 九、验收门槛

1. 前台客诉工作记录到任务执行验收的完整闭环通过。
2. 同一事件重放10次仅1个Job、1个有效结果、1个批准事件。
3. UAT无手工process/recover接口调用；Worker失败可观察、可重试、可死信、可恢复。
4. 两租户、跨区域、跨门店、跨部门、任职到期、对象猜ID全部拒绝。
5. 所有新增租户表在首次访问前100%启用并强制RLS。
6. AI直接创建任务次数为0；人工批准后由Rule Engine建任务。
7. 模型失败和Schema失败不产生伪成功结果。
8. 输入来源、标准、Prompt、Agent、模型、输出、成本、审核与后续任务100%可追溯。
9. Sprint 1/2全量回归通过，新增P0/P1为0。

## 十、冻结前待确认参数

- 首个Provider、部署区域、数据保留、训练使用政策和安全批准。
- Secret管理方式及引用规范。
- 每租户日预算、单次上限、硬阻断阈值和告警接收人。
- 前厅客诉建议的审批任职、严重度口径和规则模板。
- Context允许字段、PII脱敏策略及最长保留期。
- 黄金评测集20条工作分析样本及准确率/证据率/拒答率门槛。
- 质量下降回滚阈值及模型版本下线流程。
- 图片是否进入后续模型分析；默认否。
- CEO简报时区、数据截止、收件任职、风险口径和决策事件映射，留待CEO切片冻结。

## 十一、批准条件

只有同时满足以下条件，本文才能从DRAFT迁为APPROVED：

1. TECH-V0.2正式Released，G0-01—G0-07全部有权威证据。
2. 产品、架构、数据安全、QA和运维完成评审签署。
3. 本文第十节参数全部形成明确决策。
4. 产品负责人下达独立Sprint 3开工指令。

在此之前，Sprint 3状态继续为`未启动`。
