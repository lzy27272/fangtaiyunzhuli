# Hotel AI OS Sprint 2 管理闭环详细实施方案

| 项目 | 计划基线 |
|---|---|
| 方案版本 | V2.0 |
| 编制日期 | 2026-07-17 |
| 依赖基线 | Hotel AI OS V0.1 技术冻结报告 |
| 数据库起点 | PostgreSQL / Flyway V4，只允许新增 V5+ |
| API策略 | 保持 /api/v1 向后兼容，目标契约版本 0.2.0-sprint2 |
| 建议周期 | 10个工作日 |
| 建议团队 | 后端2人、前端1人、测试/技术负责人1人 |
| 当前状态 | 待技术与产品评审，尚未开始编码 |

## 0. 实施结论

Sprint 2的唯一目标是打通：

    已发布企业标准
          ↓
    已发布岗位工作包
          ↓
    岗位工作期望与工作记录
          ↓
    标准评价
          ↓
    管理事件与企业规则
          ↓
    整改任务
          ↓
    负责人执行并提交结果
          ↓
    指定验收人验收或打回
          ↓
    形成可追溯闭环

本方案冻结四个概念，后续实现不得混用：

| 概念 | 回答的问题 | 状态职责 |
|---|---|---|
| 企业标准 | 什么是正确、怎么判断、需要什么证据 | 版本化判断依据，不产生执行状态 |
| 工作包 | 某岗位在什么时间、对哪些门店、必须做什么 | 版本化工作配置，不等于任务 |
| 岗位工作记录 | 某个有效任职实际做了什么、提交了什么事实和证据 | 记录草稿、提交、复核与纠错 |
| 管理任务 | 发现异常后由谁在何时前整改、谁负责验收 | 独立任务状态机与SLA |

关键规则：

- 工作包只引用精确的 standard_version_id，不复制标准内容。
- 工作记录继续复用并扩展现有 work_record，不另建第二套工作记录体系。
- 正常完成例行工作不创建任务。
- 只有漏交、标准评价不通过、人工上报异常或确定性规则命中时才创建管理任务。
- 任务结果不能改写历史工作记录，只能追加证据、评价和状态时间线。
- 工作记录审核、标准评价和任务验收是三件不同的事，必须分别保存。

## 1. 冻结约束与范围

### 1.1 不可破坏模型

| 冻结模型 | Sprint 2要求 |
|---|---|
| 组织模型 | 继续使用 tenant + org_unit + org_unit_closure，不建立工作包或任务私有组织树 |
| 一人多岗 | 工作期望、工作记录、任务责任人与验收人都绑定 employee_position_assignment_id |
| 权限隔离 | 受信身份、服务端RBAC、组织范围、SQL tenant_id和PostgreSQL FORCE RLS全部保留 |
| 标准中心 | 继续使用 standard_definition + standard_version + standard_scope，已发布版本不可修改 |
| API兼容 | 现有30个 /api/v1 操作继续有效；新增接口只能兼容扩展 |
| 架构形态 | 保持模块化单体，不在Sprint 2拆微服务 |

### 1.2 Sprint 2非目标

- 不实现AI Gateway、模型调用、Prompt管理或多Agent协作。
- 不接复杂OTA实时接口，不自动调价。
- 不建设通用BPMN或低代码工作流平台。
- 规则不允许执行任意SQL、SpEL、JavaScript、Groovy或其他脚本。
- 不接企业微信、短信等外部通知；只做站内通知和适配器边界。
- 不自动处罚、自动晋升或自动作出高影响管理决策。
- 不建设大规模数据仓库。

### 1.3 闭环开发前置门禁

以下不是额外产品功能，而是闭环能够安全运行的前置条件，必须随D1—D2完成：

- 接通受信JWT/SSO边界，开发请求头只允许显式dev profile。
- 从数据库加载有效role_assignment与role_permission，支持一账号多角色。
- 建立统一OrgScopeResolver，统一列表、单资源、OTA跨店、任务和验收范围。
- Outbox补齐事件版本、锁租约、重试、死信和消费者Inbox。
- 发布后的标准、工作包、规则和表单版本具备数据库级不可变保护。
- 工作记录提交前真实执行form_version JSON Schema校验。

## 2. 第一阶段重点岗位与责任链

角色名称用于首批业务配置，不直接等于权限。最终能力由 permission、role_permission、role_assignment和组织范围共同决定。

### 2.1 六角色职责矩阵

| 岗位 | 核心工作 | 主要管理动作 | 默认数据范围 | 明确限制 |
|---|---|---|---|---|
| OTA运营助理 | 逐店渠道巡查、点评检查、异常上报、每日总结 | 提交记录、上传截图、执行整改、提交结果 | 本人有效任职被分配的目标门店 | 不发布标准、工作包或规则；不验收本人任务 |
| OTA运营经理 | 助理复核、点评质量抽查、跨店趋势复盘、OTA周复盘 | 查看团队记录、模拟规则、派发和验收OTA任务 | 被授权区域或门店树 | 发布配置必须另有明确权限 |
| 前台员工 | 班前确认、VIP、客诉、服务异常、班次交接 | 提交班次记录、上报异常、执行整改 | 本人有效前台任职与当班门店 | 不查看无关员工和兄弟门店 |
| 前厅主管 | 班组状态、前台记录复核、服务检查、客诉跟踪 | 管理班组、派发和验收前台任务 | 本门店前厅部门或授权范围 | 不跨店，不验收本人负责的任务 |
| 店助 | 巡店、跨部门协调、重要客诉、OTA门店协同 | 承接跨部门整改、验收主管任务、处理返工 | 本门店 | 不因岗位名称自动获得集团权限 |
| 店总 | 经营复盘、风险检查、重点决策、酒店周复盘 | 查看全店、最终验收、处理升级 | 本门店及下属部门 | 不访问兄弟门店；集团标准和规则发布需独立授权 |

### 2.2 首批责任主链

    前台员工 → 前厅主管 → 店助 → 店总

    OTA运营助理 → OTA运营经理
                         ↓
             需要门店整改时 → 店助 → 店总

责任模板不得写死员工ID。首批支持以下解析方式：

- CURRENT_ASSIGNMENT：当前工作包持有任职。
- DIRECT_MANAGER_ASSIGNMENT：任职上配置的直接上级任职。
- POSITION_IN_SAME_ORG：同一门店或部门的指定岗位。
- POSITION_IN_ANCESTOR_ORG：向上级组织查找指定岗位。
- EXPLICIT_ALLOCATION：OTA跨店等显式分配的任职。

解析必须得到唯一结果：

- 无匹配：进入责任解析异常队列并通知配置管理员。
- 多人匹配：进入异常队列，不随机选人。
- 负责人和验收人相同：拒绝派发或要求重新解析。
- 历史任务保存当时的员工、岗位、任职和组织快照，不随主岗变化。

### 2.3 店总自身工作的验收边界

店总是门店闭环的最终验收人，但店总不得自我验收。

Sprint 2若暂不纳入区域经理或CEO专用页面：

- 店总工作包仍生成工作期望、工作记录和标准评价。
- 需要上级验收的店总记录保持待上级验收状态。
- 不得用自我验收或系统自动通过填补上级责任链。

## 3. 工作包中心设计

### 3.1 工作包定位

工作包中心负责把“标准”转化为“岗位可执行的日常工作要求”。

它回答：

- 哪个岗位必须做？
- 对哪些门店或组织做？
- 班次、每日、每周还是事件发生时做？
- 用哪个表单记录？
- 引用哪个标准版本判断？
- 截止时间是什么？
- 谁执行、谁复核、谁验收、逾期升级给谁？

工作包不负责：

- 定义什么是正确，标准中心负责。
- 判断何时创建整改任务，规则中心负责。
- 保存实际工作事实，work_record负责。
- 保存整改执行状态，任务中心负责。

### 3.2 分层模型

    WorkPackageDefinition
             ↓
    WorkPackageVersion
          ↙      ↘
    Scope       WorkPackageItem
                 ↙   ↓   ↘
          Standards Form Responsibility
                    ↓
           WorkPackageAllocation
                    ↓
              DutyPeriod
                    ↓
             WorkExpectation
                    ↓
               WorkRecord

### 3.3 工作包版本生命周期

    DRAFT → PUBLISHED → RETIRED

规则：

- Definition是稳定编码和业务身份。
- Version保存某一时点的完整配置。
- DRAFT可以编辑和校验。
- PUBLISHED不可原地修改，调整必须创建新版本。
- RETIRED不再生成新的工作期望，但历史记录继续引用原版本。
- 发布前必须验证标准版本、表单版本、责任链、作用范围和调度没有冲突。
- 同岗位、同组织范围、同周期不得存在两个冲突的主工作包。
- 一个工作条目可通过work_package_item_standard关联一个或多个精确标准版本，并标记EXECUTION、ACCEPTANCE或KPI用途。
- 执行、复核、验收和升级责任通过work_package_item_responsibility结构化配置，不写入任意脚本或员工ID。

### 3.4 工作包条目类型

| 类型 | 用途 | 是否定时生成期望 |
|---|---|---|
| SCHEDULED_RECORD | 班次、每日、每周固定工作 | 是 |
| EVENT_RECORD | 客诉、VIP、异常等事件发生时记录 | 否 |
| INSPECTION | 巡店、服务检查、OTA页面检查 | 是或事件触发 |
| METRIC_REVIEW | 经营指标、OTA评分和趋势复盘 | 是 |
| REVIEW_APPROVAL | 主管复核下属记录或异常结果 | 由下游事件触发 |

Sprint 2不开放任意Cron。结构化调度至少包括：

- period_type：SHIFT、DAY、WEEK、EVENT。
- timezone_mode：HOTEL、TENANT或FIXED。
- work_window_start、work_window_end。
- due_local_time。
- grace_minutes。
- weekdays或day_of_month。
- holiday_policy。
- waiver_allowed。
- target_granularity：任职组织或逐目标门店。

### 3.5 工作包范围、分配与权限

必须区分三个概念：

| 概念 | 示例 | 能否授予权限 |
|---|---|---|
| 任职组织 | OTA助理任职在区域OTA部门 | 否 |
| 工作负责范围 | 该助理负责酒店A和酒店B | 否 |
| 账号权限范围 | 账号被授权读取酒店A和酒店B | 是，由IAM决定 |

work_package_scope定义工作包可以在哪些品牌、组织树和岗位使用。

work_package_allocation把已发布工作包版本分配给：

- 精确employee_position_assignment_id。
- 一个或多个目标组织/酒店。
- 生效时间与失效时间。
- 分配来源和分配人。

工作包分配本身不能扩大权限。实际可执行范围必须是：

    工作包适用范围
      ∩ 任职负责范围
      ∩ 服务端授权范围

OTA运营助理可在区域部门任职并跨店执行，但只能看到被分配且被授权的门店。

### 3.6 班次与工作周期

前台员工不能按“每人每天”直接生成工作期望，否则休息日会被误判漏交。

Sprint 2增加最小工作周期模型work_duty_period：

- position_assignment_id。
- target_org_unit_id。
- business_date。
- period_type。
- shift_code。
- planned_start_at、planned_end_at。
- status：PLANNED、CANCELLED、COMPLETED。

前台员工的班前、交接和班次结束工作由实际班次生成。

其他五类岗位首期可按每日、每周或事件型生成。

### 3.7 首批六个工作包

#### OTA运营助理：WP-OTA-ASSISTANT

| 工作条目 | 周期 | 记录内容与证据 | 默认验收 |
|---|---|---|---|
| OTA渠道日常巡查 | 每日、逐负责门店 | 平台、酒店页面、房型展示、可售状态、价格展示异常、活动状态、截图与采集时间 | OTA运营经理 |
| 点评分数与待回复巡查 | 每日、逐负责门店 | 当前评分、新增点评、待回复数量、重大负面点评、截图或链接 | OTA运营经理 |
| OTA异常上报 | 事件型 | 无法预订、展示错误、评分异常、重大差评、影响范围 | OTA运营经理 |
| OTA每日工作总结 | 每日 | 已处理事项、未解决问题、需要门店协同事项 | OTA运营经理 |

不包含自动调价、自动回复或复杂OTA接口。

#### OTA运营经理：WP-OTA-MANAGER

| 工作条目 | 周期 | 记录内容与证据 | 默认验收 |
|---|---|---|---|
| 助理完成情况复核 | 每日 | 应交、已交、漏交、异常和整改情况 | 配置的上级任职 |
| 点评回复质量抽查 | 每日/每周 | 及时性、话术、问题归因、抽查样本 | 配置的上级任职 |
| 跨门店OTA趋势复盘 | 每日/每周 | 评分、待回复、异常量和整改闭环率 | 配置的上级任职 |
| OTA周复盘 | 每周 | 问题分布、有效措施、门店协同和需决策事项 | 配置的上级任职 |

#### 前台员工：WP-FRONT-DESK-AGENT

| 工作条目 | 周期 | 记录内容与证据 | 默认验收 |
|---|---|---|---|
| 班前与交接确认 | 每班次 | 当班重点、未结事项、VIP提示、交接确认 | 前厅主管 |
| VIP接待记录 | 事件型 | 接待节点、特殊需求和完成情况 | 前厅主管 |
| 客诉与服务异常记录 | 事件型 | 发生时间、分类、已采取动作和升级情况 | 前厅主管 |
| 班次结束记录 | 每班次 | 入住情况、异常、遗留事项和下一班交接 | 前厅主管 |

前台记录不得保存非必要的完整身份证号、手机号或支付信息。

#### 前厅主管：WP-FRONT-OFFICE-SUPERVISOR

| 工作条目 | 周期 | 记录内容与证据 | 默认验收 |
|---|---|---|---|
| 班前会与员工状态 | 班次/每日 | 到岗、重点事项、培训提醒和人员异常 | 店助 |
| 前台记录复核 | 班次/每日 | 漏交、信息不完整、未升级客诉 | 店助 |
| 前台服务检查 | 每日 | 环境、仪容、话术、入住流程抽查 | 店助 |
| 客诉跟踪 | 事件型 | 责任人、进度、客人反馈和未解决原因 | 店助 |
| 前厅每日总结 | 每日 | 班组问题、任务进度和需协调事项 | 店助 |

#### 店助：WP-ASSISTANT-GM

| 工作条目 | 周期 | 记录内容与证据 | 默认验收 |
|---|---|---|---|
| 每日巡店 | 每日 | 前厅、公共区域、服务状态和现场异常 | 店总 |
| 跨部门异常协调 | 每日/事件型 | 责任部门、负责人、截止时间和协调结果 | 店总 |
| 重要客诉跟进 | 事件型 | 处理过程、补救措施和风险判断 | 店总 |
| OTA门店协同检查 | 每日 | OTA团队提出的门店整改及完成情况 | 店总 |
| 管理交接与总结 | 每日 | 未结任务、逾期事项和需店总决策内容 | 店总 |

#### 店总：WP-GENERAL-MANAGER

| 工作条目 | 周期 | 记录内容与证据 | 默认验收 |
|---|---|---|---|
| 经营数据查看与复盘 | 每日 | 收入、入住率、ADR、RevPAR、OTA评分和异常 | 上级任职 |
| 风险与逾期任务审查 | 每日 | 高风险、逾期、升级和无人负责事项 | 上级任职 |
| 重点客诉和OTA风险决策 | 事件型 | 决策、责任分配和期限 | 上级任职 |
| 员工沟通和管理检查 | 每日/每周 | 关键沟通、组织问题和改善动作 | 上级任职 |
| 酒店周复盘 | 每周 | 标准执行率、任务闭环率、重复问题和管理措施 | 上级任职 |

## 4. 岗位工作记录设计

### 4.1 复用现有work_record

Sprint 2不新建平行的工作记录主表，而是给现有work_record追加关系：

- work_package_version_id。
- work_package_item_id。
- work_expectation_id。
- record_kind。
- target_org_unit_id。
- occurred_at。
- submitted_by_account_id。
- supersedes_work_record_id。
- attempt_no。
- content_hash。

### 4.2 工作记录核心规则

1. position_assignment_id是责任上下文主键。
2. employee_id必须与该任职属于同一员工。
3. target_org_unit_id表示实际业务门店，可与OTA岗位任职组织不同。
4. 目标门店必须同时位于工作包分配范围与服务端权限范围。
5. 定时工作记录必须关联唯一work_expectation。
6. 事件型记录可不关联expectation，但必须引用工作包条目和目标组织。
7. 提交前必须通过已发布form_version的JSON Schema验证。
8. SUBMITTED后的payload和附件集合不可原地修改。
9. 纠错或补交创建新记录，通过supersedes_work_record_id形成链。
10. 代填需要独立权限，并同时保存实际提交账号和责任任职。
11. APPROVED/REJECTED只表示记录完整性复核，不等于标准评价或任务验收。
12. 提交、漏交、复核和评价完成均写审计并产生Outbox事件。

### 4.3 工作期望状态

    PLANNED → AVAILABLE → IN_PROGRESS → SUBMITTED
                                           ├→ SATISFIED
                                           └→ FAILED
          ├───────────────────────────────→ MISSED
          ├───────────────────────────────→ WAIVED
          └───────────────────────────────→ CANCELLED

规则：

- 同一工作包条目、任职、目标组织、周期只生成一个期望实例。
- 生成任务重复执行必须幂等。
- MISSED只触发一次管理事件。
- WAIVED必须保存原因、批准人和审计，岗位本人不能批准自己的豁免。
- 取消班次后，对应未开始期望转为CANCELLED，不触发漏交。

### 4.4 工作记录状态

沿用当前兼容状态：

    DRAFT → SUBMITTED → APPROVED
                    └→ REJECTED

标准评价另有独立状态。记录被REJECTED后不得修改原提交内容，应创建新attempt。

### 4.5 首批表单数据

| 岗位/表单 | 必填结构化字段 | 主要证据 |
|---|---|---|
| OTA每日巡查 | 目标酒店、平台、评分、新增点评、待回复、页面/可售异常、处理状态 | 截图、链接、采集时间 |
| OTA周复盘 | 门店范围、趋势、异常分类、整改完成率、需决策事项 | 指标快照、记录引用 |
| 前台班次记录 | 班次、入住情况、VIP、客诉、服务异常、交接事项 | 事件记录、必要附件 |
| 前厅每日总结 | 到岗、漏交、抽查结果、客诉进度、未解决事项 | 下属记录引用、检查证据 |
| 店助每日管理 | 巡店、跨部门事项、重要客诉、OTA协同、逾期任务 | 任务与记录引用、附件 |
| 店总每日复盘 | 经营指标、风险、逾期、决策事项、责任分配 | 指标快照、任务引用 |

## 5. 企业规则中心基础设计

### 5.1 规则职责

规则负责“什么时候采取什么行动”，不负责定义什么是正确。

规则输入来自：

- WORK_EXPECTATION_MISSED。
- WORK_RECORD_SUBMITTED。
- WORK_RECORD_REJECTED。
- STANDARD_EVALUATION_COMPLETED。
- OTA_ABNORMAL_REPORTED。
- TASK_RESULT_SUBMITTED。
- TASK_SLA_BREACHED。
- TASK_REWORK_REQUESTED。

### 5.2 事件—条件—动作

    ManagementEvent
          ↓
    RuleScope过滤
          ↓
    RuleVersion条件判断
          ↓
    RuleEvaluation
          ↓
    RuleActionExecution
       ├─ CREATE_TASK
       ├─ CREATE_NOTIFICATION
       ├─ REQUEST_MANUAL_REVIEW
       └─ SCHEDULE_ESCALATION

### 5.3 规则生命周期

    DRAFT → PUBLISHED → DISABLED

- DRAFT可以编辑和模拟。
- PUBLISHED不可修改。
- DISABLED停止处理新事件，历史执行继续保留。
- 修改规则必须创建新版本。
- 模拟不得写任务、通知或真实管理事件。

### 5.4 条件DSL

使用有类型的JSON AST和事实白名单，不允许任意代码。

首批操作符：

- EQ、NE。
- GT、GTE、LT、LTE。
- EXISTS、MISSING。
- IN。
- COUNT_IN_WINDOW。
- CONSECUTIVE_OCCURRENCE。
- STATE_TIMEOUT。

首批事实：

- expectation.status、due_at、grace_minutes。
- evaluation.outcome、score、severity、failed_item_codes。
- work_record.record_kind、target_org_unit_id、business_date。
- ota.platform、rating、unanswered_count、abnormality_type。
- task.lifecycle_status、sla_status、due_at、rework_count。

### 5.5 首批规则

| 规则 | 触发与条件 | 动作 |
|---|---|---|
| 岗位工作漏交 | expectation到期且状态仍为AVAILABLE | 创建整改任务给执行任职，通知直接主管 |
| 标准评价不合格 | outcome=FAIL且严重度达到配置阈值 | 创建整改任务；验收人按工作包责任链解析 |
| OTA异常协同 | OTA助理上报门店执行类异常 | 创建门店协同任务给店助，OTA经理为专业协同人 |
| 重大客诉升级 | 前台上报重大客诉或评价失败 | 创建任务给前厅主管，店助验收，超时通知店总 |
| 任务超时升级 | 任务未完成且到达next_escalation_at | 更新SLA状态，增加升级层级并通知下一责任人 |
| 重复问题升级 | 同标准条目在配置窗口内重复失败 | 提升任务优先级并升级管理层 |

阈值、时间窗口、优先级和升级路径全部配置化，不写死在服务代码。

### 5.6 幂等与冲突

- 管理事件以tenant_id + source_event_id + event_type唯一。
- 规则动作以tenant_id + rule_version_id + management_event_id + action_key唯一。
- 同一事件重复投递10次只能产生一次同名动作。
- 多条不同规则可以命中同一事件，但UI必须显示重复风险。
- 负责人或验收人解析失败时，动作进入FAILED/WAITING_CONFIGURATION，不得假装成功。
- 规则不能自动完成任务。

## 6. 任务状态流转设计

### 6.1 主生命周期

    PROPOSED
       ↓ DISPATCH
    PENDING_ACK
       ↓ ACKNOWLEDGE
    IN_PROGRESS
       ↓ SUBMIT_RESULT
    RESULT_SUBMITTED
       ↓ QUEUE_REVIEW
    AWAITING_REVIEW
       ├─ APPROVE → COMPLETED
       └─ REWORK  → REWORK → START → IN_PROGRESS

非终态任务可由有权角色执行CANCEL进入CANCELLED。

### 6.2 SLA状态

SLA状态与主生命周期分离：

- ON_TIME。
- DUE_SOON。
- OVERDUE。
- ESCALATED。

OVERDUE不能覆盖IN_PROGRESS或AWAITING_REVIEW；任务可以同时为IN_PROGRESS + OVERDUE。

### 6.3 状态迁移矩阵

| 当前状态 | 命令 | 目标状态 | 允许主体 | 必填内容 |
|---|---|---|---|---|
| PROPOSED | DISPATCH | PENDING_ACK | 系统或有权创建者 | 负责人、验收人、截止时间 |
| PENDING_ACK | ACKNOWLEDGE | IN_PROGRESS | 当前负责人任职 | 接单确认 |
| IN_PROGRESS | SUBMIT_RESULT | RESULT_SUBMITTED | 当前负责人任职 | 结果说明、证据 |
| RESULT_SUBMITTED | QUEUE_REVIEW | AWAITING_REVIEW | 系统 | 标准评价或人工复核要求 |
| AWAITING_REVIEW | APPROVE | COMPLETED | 指定验收人任职 | 验收结论、评价引用 |
| AWAITING_REVIEW | REWORK | REWORK | 指定验收人任职 | 打回原因、需补充项 |
| REWORK | START | IN_PROGRESS | 当前负责人任职 | 返工开始 |
| 任一非终态 | CANCEL | CANCELLED | 创建者或授权管理者 | 取消原因 |

### 6.4 并发与审计

- management_task使用version字段进行乐观锁。
- 所有命令携带expectedVersion和Idempotency-Key。
- 20个并发相同命令只允许一次有效迁移。
- 每次状态变化追加task_transition，不允许修改历史时间线。
- task_transition保存actor_account_id、actor_assignment_id、from_status、to_status、command、comment、correlation_id和发生时间。

### 6.5 执行证据与验收

任务结果可提交：

- 结构化结果JSON。
- 说明文本。
- 对work_record、metric_observation、standard_evaluation的引用。
- 图片或文件证据。

验收要求：

- 验收人必须是任务创建时解析并冻结的有效任职，或由有权人员重新指派。
- 负责人不能验收自己的任务。
- 需要标准判断的结果先产生TASK_RESULT类型标准评价。
- 验收通过追加APPROVE迁移；打回追加REWORK迁移。
- 每轮验收都保存在task_transition payload中，不覆盖上一次结果。

### 6.6 升级

management_task保存：

- sla_policy_snapshot。
- due_at。
- next_escalation_at。
- escalation_level。
- sla_status。

每次升级作为task_transition和notification追加记录，不需要修改任务来源规则版本。

## 7. 标准评价设计

### 7.1 评价对象

Sprint 2支持：

- WORK_RECORD：岗位工作记录。
- TASK_RESULT：整改任务结果。

### 7.2 标准版本解析

- 计划型工作优先使用work_package_item中固定的standard_version_id。
- 任务结果使用任务创建时冻结的standard_version_id或验收标准快照。
- 禁止在评价时自动漂移到“当前最新标准”。
- 无显式标准版本的自由记录不自动评价，进入待配置或人工复核。

### 7.3 评价方式

| 方式 | 适用内容 | Sprint 2处理 |
|---|---|---|
| DETERMINISTIC | 必填、枚举、数值阈值、时间、数量、状态 | 系统自动判断 |
| MANUAL | 话术质量、复杂客诉、现场管理判断 | 指定复核人判断 |
| REQUIRES_AI | 图片质量、自由文本语义、未来AI识别 | 只标记，不调用模型 |

Sprint 2不得把图片或自由文本伪装成AI自动结论。

### 7.4 评价状态与结果

执行状态：

- PENDING。
- RUNNING。
- MANUAL_REQUIRED。
- AI_REQUIRED。
- COMPLETED。
- ERROR。

业务结果：

- PASS。
- WARN。
- FAIL。
- NOT_APPLICABLE。

状态和结果分开保存，避免将“待人工判断”误认为不合格。

### 7.5 评价快照

standard_evaluation保存：

- subject_type和subject_id。
- standard_version_id。
- standard_content_hash。
- input_snapshot。
- evidence_snapshot。
- score、max_score和threshold_snapshot。
- execution_status、outcome、severity。
- evaluator_type和完成时间。

standard_evaluation_item保存逐条：

- standard_item_code。
- evaluation_mode。
- operator。
- expected_value。
- actual_value。
- outcome。
- score。
- evidence_refs。
- reason。

### 7.6 评价后的动作

    PASS
      ↓
    工作完成留痕；不创建整改任务

    WARN / FAIL
      ↓
    STANDARD_EVALUATION_COMPLETED事件
      ↓
    企业规则中心决定是否通知、建任务或升级

    MANUAL_REQUIRED
      ↓
    指定主管复核

    AI_REQUIRED
      ↓
    Sprint 2进入人工队列；Sprint 3由AI Gateway接入

标准评价不直接创建任务，必须经过规则中心，保证“标准判断”和“行动策略”分离。

## 8. 数据库新增表

### 8.1 迁移规划

| 迁移 | 内容 |
|---|---|
| V5 | 工作包中心、班次周期、工作期望、work_record兼容扩展 |
| V6 | 管理事件与Outbox可靠投递字段 |
| V7 | 企业规则中心 |
| V8 | 任务中心、任务参与人与证据 |
| V9 | 标准评价、通知、权限点、索引和完整隔离复核 |

V1—V4禁止修改。每张新租户表必须在创建迁移中同步完成FORCE RLS和同租户外键，不能先裸表上线。

### 8.2 计划新增25张表

#### 工作包中心：9张

| 表 | 关键字段与关系 |
|---|---|
| work_package_definition | code、name、position_id、owner_org_unit_id、status |
| work_package_version | work_package_definition_id、version_no、lifecycle_status、effective_from/to、content_hash、published_by |
| work_package_scope | work_package_version_id、scope_type、brand_id、org_unit_id、position_id |
| work_package_item | version_id、item_code、item_type、form_version_id、调度字段、复核模式 |
| work_package_item_standard | item_id、standard_version_id、usage_type、weight；支持执行/验收/KPI标准 |
| work_package_item_responsibility | item_id、participant_type、resolver_type、position_id、scope_strategy、escalation_level |
| work_package_allocation | version_id、position_assignment_id、target_org_unit_id、valid_from/to、allocated_by |
| work_duty_period | assignment_id、target_org_unit_id、business_date、period_type、shift_code、planned_start/end、status |
| work_expectation | item_id、allocation_id、assignment_id、duty_period_id、target_org_unit_id、business_date、due_at、status、waiver信息 |

#### 管理事件：2张

| 表 | 关键字段与关系 |
|---|---|
| event_consumer_inbox | consumer_code、outbox_event_id、status、attempt_count、locked_until、last_error；组合唯一保证消费幂等 |
| management_event | source_event_id、event_type、schema_version、org_unit_id、assignment_id、occurred_at、payload_snapshot、processing_status |

#### 企业规则中心：5张

| 表 | 关键字段与关系 |
|---|---|
| rule_definition | code、name、event_type、owner_org_unit_id、status |
| rule_version | rule_id、version_no、condition_ast、actions、priority、cooldown、effective_from/to、content_hash、lifecycle_status |
| rule_scope | rule_version_id、scope_type、brand_id、org_unit_id、position_id |
| rule_evaluation | management_event_id、rule_version_id、facts_snapshot、matched、result、evaluated_at |
| rule_action_execution | rule_evaluation_id、action_key、action_type、idempotency_key、status、target_id、attempt_count、last_error |

#### 任务中心：5张

| 表 | 关键字段与关系 |
|---|---|
| management_task | source_event_id、source_action_id、standard_version_id、work_record_id、org_unit_id、lifecycle_status、sla_status、priority、due_at、version、快照字段 |
| task_participant | task_id、participant_type、position_assignment_id、员工/岗位/组织快照、valid_from/to |
| task_transition | task_id、from_status、to_status、command、actor_account_id、actor_assignment_id、standard_evaluation_id、payload、occurred_at |
| task_evidence | task_id、submitted_by_assignment_id、object_key、media_type、sha256、structured_result、created_at |
| task_escalation | task_id、level、scheduled_at、resolver_snapshot、resolved_assignment_id、status、executed_at、last_error |

验收记录使用task_transition中的APPROVE/REWORK命令和payload保存，不另建可变验收主表。

task_escalation只保存升级计划与执行结果；实际状态变化仍通过task_transition留痕，不建立平行主状态机。

#### 标准评价：3张

| 表 | 关键字段与关系 |
|---|---|
| standard_evaluation | subject_type/id、standard_version_id、hash与输入快照、execution_status、outcome、score、severity |
| standard_evaluation_item | evaluation_id、item_code、mode、operator、expected/actual、outcome、score、reason |
| evaluation_evidence | evaluation_item_id、evidence_type、work_record/attachment/metric/task_evidence引用、evidence_snapshot、content_hash |

#### 通知：1张

| 表 | 关键字段与关系 |
|---|---|
| notification | recipient_account_id、recipient_assignment_id、type、title、content、source_type/id、delivered_at、read_at、idempotency_key |

### 8.3 现有表兼容扩展

work_record新增：

- work_package_version_id。
- work_package_item_id。
- work_expectation_id。
- record_kind。
- target_org_unit_id。
- occurred_at。
- submitted_by_account_id。
- supersedes_work_record_id。
- attempt_no。
- content_hash。

outbox_event新增：

- schema_version。
- status。
- available_at。
- locked_by。
- locked_until。
- last_error。
- dead_lettered_at。

### 8.4 关键唯一约束

- work_expectation：tenant + item + assignment + target_org + business period唯一。
- management_event：tenant + source_event_id + event_type唯一。
- rule_action_execution：tenant + rule_version + management_event + action_key唯一。
- management_task：tenant + source_action_id唯一。
- notification：tenant + idempotency_key + recipient_account_id唯一。
- published work_package_version、rule_version和standard_version数据库级不可变。

### 8.5 所有新表统一要求

- UUID主键。
- tenant_id + id唯一键。
- 跨实体外键全部携带tenant_id。
- 显式created_at；可变聚合含updated_at和version。
- 配置版本含version_no、lifecycle_status和content_hash。
- FORCE RLS同时使用USING与WITH CHECK。
- 新表运行账号不得拥有BYPASSRLS或表所有权。

## 9. API设计

所有新增接口继续位于/api/v1。列表统一分页；命令接口统一使用Idempotency-Key、expectedVersion和X-Correlation-Id。

### 9.1 身份与任职

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | /api/v1/iam/me | 返回服务端解析的账号、员工、有效任职、角色、权限和组织范围 |

### 9.2 工作包中心

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | /api/v1/work-packages | 查询授权范围内工作包 |
| POST | /api/v1/work-packages | 创建工作包定义 |
| GET | /api/v1/work-packages/{id} | 工作包详情与版本历史 |
| POST | /api/v1/work-packages/{id}/versions | 创建草稿版本 |
| PUT | /api/v1/work-packages/{id}/versions/{versionId} | 更新草稿版本、条目、标准、责任链与范围 |
| POST | /api/v1/work-packages/{id}/versions/{versionId}/validate | 校验标准、表单、调度和责任链 |
| POST | /api/v1/work-packages/{id}/versions/{versionId}/publish | 发布版本 |
| POST | /api/v1/work-packages/{id}/versions/{versionId}/retire | 停止生成新期望 |
| GET | /api/v1/work-packages/{id}/allocations | 查询分配 |
| POST | /api/v1/work-packages/{id}/allocations | 分配给具体任职和目标组织 |
| GET | /api/v1/work-expectations | 查询工作期望 |
| GET | /api/v1/work-expectations/{id} | 查询期望、工作包快照和当前attempt |
| POST | /api/v1/work-expectations/{id}/waive | 有权管理者豁免 |
| POST | /api/v1/work-expectations/{id}/cancel | 取消未开始期望 |

### 9.3 岗位工作记录

保留现有GET/POST /api/v1/work-data/records并向后兼容扩展。

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | /api/v1/work-data/records/{id} | 工作记录详情、评价与关联任务 |
| PUT | /api/v1/work-data/records/{id} | 仅保存DRAFT |
| POST | /api/v1/work-data/records/{id}/actions/submit | 提交并封存内容 |
| POST | /api/v1/work-data/records/{id}/actions/review | 完整性复核APPROVED/REJECTED |
| GET | /api/v1/my/work-expectations | 当前任职的今日、逾期和已完成工作 |
| GET | /api/v1/team/work-expectations | 授权范围内团队完成情况 |

兼容规则：

- 原POST /work-data/records保持现有直接提交流程。
- 新工作包页面可使用创建DRAFT后显式submit。
- 已提交记录不提供更新接口。

### 9.4 管理事件与规则

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | /api/v1/management-events | 查询管理事件和处理状态 |
| GET | /api/v1/management-events/{id} | 事件事实、来源和处理链 |
| GET | /api/v1/rules | 查询规则 |
| POST | /api/v1/rules | 创建规则定义 |
| GET | /api/v1/rules/{id} | 规则详情和版本 |
| POST | /api/v1/rules/{id}/versions | 创建版本 |
| PUT | /api/v1/rules/{id}/versions/{versionId} | 更新草稿条件、动作、范围和SLA |
| POST | /api/v1/rules/{id}/versions/{versionId}/validate | 校验DSL、事实和动作 |
| POST | /api/v1/rules/{id}/versions/{versionId}/simulate | 无副作用模拟 |
| POST | /api/v1/rules/{id}/versions/{versionId}/publish | 发布规则 |
| POST | /api/v1/rules/{id}/versions/{versionId}/disable | 停用已发布版本 |
| GET | /api/v1/rule-evaluations/{id} | 查看事实、条件、动作和错误 |

### 9.5 任务中心

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | /api/v1/tasks | 我的任务或授权范围任务 |
| POST | /api/v1/tasks | 有权人员手工创建管理任务 |
| GET | /api/v1/tasks/{id} | 来源、责任、状态、证据和评价 |
| POST | /api/v1/tasks/{id}/actions/dispatch | 派发 |
| POST | /api/v1/tasks/{id}/actions/acknowledge | 接单确认 |
| POST | /api/v1/tasks/{id}/actions/start | 开始或返工开始 |
| POST | /api/v1/tasks/{id}/actions/submit-result | 提交执行结果 |
| POST | /api/v1/tasks/{id}/actions/approve | 验收通过 |
| POST | /api/v1/tasks/{id}/actions/rework | 打回返工 |
| POST | /api/v1/tasks/{id}/actions/cancel | 取消 |
| GET | /api/v1/tasks/{id}/timeline | 不可变时间线 |
| POST | /api/v1/tasks/{id}/evidence | 提交任务证据 |

RESULT_SUBMITTED到AWAITING_REVIEW由系统在标准评价完成后内部迁移，不暴露可由客户端跳过评价的公共HTTP命令。

### 9.6 标准评价与通知

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | /api/v1/standard-evaluations | 按岗位、组织、结果查询 |
| GET | /api/v1/standard-evaluations/{id} | 逐项评价详情 |
| POST | /api/v1/standard-evaluations/{id}/manual-review | 提交人工判断 |
| GET | /api/v1/notifications | 当前账号站内通知 |
| POST | /api/v1/notifications/{id}/read | 标记已读 |

### 9.7 API统一约定

- 认证：受信JWT/SSO；客户端不得提交角色和数据范围。
- 授权：服务端数据库RBAC和OrgScopeResolver。
- 列表：page、size、sort和白名单过滤字段。
- 命令：Idempotency-Key和expectedVersion。
- 响应：稳定DTO，不新增Map式公共契约。
- 错误：problem+json，明确400、401、403、404、409、422。
- 所有响应回传X-Correlation-Id。

### 9.8 Sprint 2权限点

| 模块 | 权限点 |
|---|---|
| 工作包 | work-package.read、work-package.manage、work-package.publish、work-package.allocate |
| 工作记录 | work-record.read、work-record.submit、work-record.review、work-record.submit-for-other |
| 规则 | rule.read、rule.manage、rule.simulate、rule.publish |
| 任务 | task.read、task.create、task.dispatch、task.act、task.review、task.cancel |
| 标准评价 | evaluation.read、evaluation.manual-review |
| 通知 | notification.read |

权限点只说明“可执行什么操作”；实际对象范围还必须通过OrgScopeResolver和有效任职校验。

## 10. 页面设计

Sprint 2必须建立正式路由和真实API数据流。验收构建禁止读取apps/web/src/data/demo.ts。

### 10.1 页面清单

| 页面 | 路由 | 主要能力 | 使用角色 |
|---|---|---|---|
| 角色工作台 | /workbench | 今日工作、待提交、任务、待验收、逾期和通知 | 全部 |
| 我的任职 | /my-assignments | 主岗、兼岗、临时岗、有效期和业务上下文 | 全部 |
| 工作包列表 | /work-packages | 岗位、组织、状态和版本查询 | 主管以上、有配置权限者 |
| 工作包编辑 | /work-packages/:id/versions/:versionId | 工作项、标准、表单、频率、责任链和发布 | 有配置权限者 |
| 工作包详情 | /work-packages/:id | 当前版本、范围、分配、标准和完成统计 | 授权角色 |
| 我的工作 | /my-work | 今日、逾期、已完成工作期望 | 全部执行岗位 |
| 工作填报 | /my-work/:expectationId | 动态表单、草稿、附件、标准提示和提交 | 执行岗位 |
| 团队工作看板 | /team-work | 提交率、漏交、异常和待复核 | OTA经理、前厅主管、店助、店总 |
| 工作记录详情 | /work-records/:id | 记录、附件、标准评价、来源事件和任务 | 提交人与授权管理者 |
| 规则列表 | /rules | 状态、范围、版本和命中次数 | 有规则权限者 |
| 规则编辑/模拟 | /rules/:id/versions/:versionId | 条件、动作、责任、SLA、模拟和发布 | 有规则权限者 |
| 管理事件中心 | /management-events | 漏交、不达标、异常和处理状态 | 主管以上 |
| 规则执行详情 | /rule-evaluations/:id | 输入事实、命中条件、动作和失败原因 | 规则管理/审计 |
| 我的任务 | /tasks | 待确认、执行中、返工、待验收和完成 | 全部 |
| 主管任务看板 | /tasks/team | 待派发、待验收、逾期和升级 | OTA经理、前厅主管、店助、店总 |
| 任务详情 | /tasks/:id | 来源标准、记录、规则、责任、SLA、证据和时间线 | 负责人和验收人 |
| 标准评价列表 | /evaluations | 通过、警告、失败、待人工和待AI | 本人及主管以上 |
| 标准评价详情 | /evaluations/:id | 标准版本、逐条事实、证据、评分与原因 | 授权角色 |
| 通知中心 | /notifications | 未读、任务提醒、逾期、升级和异常 | 全部 |
| 店总驾驶舱扩展 | 现有店总入口 | 工作包完成率、标准达标率、任务闭环率和逾期率 | 店助、店总 |

### 10.2 页面权限规则

- 菜单和按钮由GET /api/v1/iam/me返回的权限决定，不按中文角色名硬编码。
- 一人多岗必须显示当前有效任职。
- 选择任职只改变业务上下文，不授予权限；服务端再次校验。
- OTA跨店记录同时显示执行任职与目标门店。
- 门店角色不能通过URL或猜测ID访问兄弟门店。
- 写操作防重复点击并携带幂等键和expectedVersion。
- 列表必须具备分页、筛选、加载、空状态、错误和无权状态。

### 10.3 六角色首页重点

| 岗位 | 首页第一屏 |
|---|---|
| OTA运营助理 | 今日逐店巡查、待回复、异常、待执行任务 |
| OTA运营经理 | 助理提交率、各店异常、待验收、逾期升级 |
| 前台员工 | 当前班次工作、VIP、客诉、待整改 |
| 前厅主管 | 班组完成率、漏交、客诉、待验收 |
| 店助 | 跨部门待办、即将逾期、返工和待验收 |
| 店总 | 全店完成率、标准达标率、风险、逾期和最终验收 |

## 11. 验收测试方案

### 11.1 四条端到端闭环

#### 场景A：OTA异常整改

1. 发布OTA检查标准与OTA助理工作包。
2. 区域OTA助理只被分配酒店A和酒店B。
3. 系统逐店生成工作期望。
4. 助理提交酒店A异常记录和截图。
5. 标准评价判定不合格。
6. 规则创建整改任务。
7. 助理确认、执行并提交结果。
8. OTA经理打回一次。
9. 助理补充证据再次提交。
10. OTA经理验收完成。
11. 标准、工作包、工作记录、规则、任务、证据和验收链均可追溯。
12. 助理不能查看酒店C。

#### 场景B：前台客诉闭环

1. 发布客诉处理SOP与前台班次工作包。
2. 前台员工提交重大客诉记录。
3. 标准评价发现处理时限或升级信息不完整。
4. 规则创建任务给前厅主管。
5. 前厅主管执行并提交结果。
6. 店助验收或打回。
7. 逾期后通知店总，但不覆盖任务主状态。

#### 场景C：漏交和升级

1. 前台实际排班生成唯一工作期望。
2. 截止时间未提交，生成一次WORK_EXPECTATION_MISSED。
3. 规则创建一个整改任务并通知前厅主管。
4. SLA到期仍未完成，标记OVERDUE并升级店助/店总。
5. 补交后仍需责任人提交任务结果并由指定人员验收。

#### 场景D：一人多岗

同一员工同时拥有OTA运营助理和前台员工两条任职：

- 两类工作期望分别绑定正确任职。
- 两类记录、任务、评价和权限不串岗。
- 主岗改变或任职到期不改写历史责任。
- OTA工作范围与前台门店范围互不借权。

### 11.2 量化测试矩阵

| 编号 | 测试 | 通过门槛 |
|---|---|---|
| AT-01 | OTA异常闭环 | 全链路成功，核心实体可追溯 |
| AT-02 | 前台客诉闭环 | 提交、建任务、执行、验收和证据完整 |
| AT-03 | 返工 | 完成至少一次打回、返工、再提交、通过 |
| AT-04 | 漏交幂等 | 同一期望只产生1个漏交事件和1组规则动作 |
| AT-05 | 六角色UAT | 每个角色完成登录、工作台及至少1项本岗位操作 |
| AT-06 | 一人多岗 | 数据和权限不串岗，历史责任100%稳定 |
| AT-07 | 两租户隔离 | 跨租户读取0条，写入100%拒绝 |
| AT-08 | 兄弟门店隔离 | 门店角色猜ID读取和操作均100%拒绝 |
| AT-09 | RLS与外键 | 100%新增租户表FORCE RLS，跨租户外键100%失败 |
| AT-10 | 工作包不可变 | 已发布版本的修改100%拒绝 |
| AT-11 | 工作期望 | 未排班前台不漏交；取消班次不触发规则 |
| AT-12 | 表单校验 | 不符合发布JSON Schema的记录不能提交 |
| AT-13 | 记录不可变 | 提交后不可修改；纠错链完整 |
| AT-14 | 任务状态机 | 合法迁移全覆盖，非法迁移100%拒绝 |
| AT-15 | 并发任务命令 | 20并发相同命令只有1次有效迁移 |
| AT-16 | 事件幂等 | 同一事件重放10次只生成1组动作 |
| AT-17 | 规则模拟 | 结果可解释，任务、通知和事件副作用为0 |
| AT-18 | 标准复算 | 使用保存快照复算，逐项结果和总分100%一致 |
| AT-19 | 自我验收 | 无特别授权时负责人验收本人任务100%拒绝 |
| AT-20 | 临时授权 | 生效前和失效后均不可操作 |
| AT-21 | API契约 | 100%新增接口进入OpenAPI并与实现一致 |
| AT-22 | 真实前端 | 验收构建0页面读取demo.ts |
| AT-23 | 自动化覆盖 | 状态机和规则操作符分支100%，新增领域代码行覆盖率不低于80% |
| AT-24 | 浏览器E2E | 至少12条：4闭环、6角色冒烟、2隔离安全 |
| AT-25 | 数据迁移 | 空库安装和V4升级两条路径全部通过 |
| AT-26 | Sprint 1回归 | 原11项后端测试、前端与JAR构建全部通过 |
| AT-27 | 缺陷门槛 | 0个P0、0个P1；P2均有负责人和计划版本 |

### 11.3 性能烟测

固定并记录基线环境后，使用：

- 2个租户。
- 合计1000家门店。
- 3万工作期望。
- 5万工作记录。
- 2万任务。
- 20并发用户。

建议门槛：

- 列表查询P95不高于500ms。
- 任务命令P95不高于800ms。
- 单事件规则评价P95不高于200ms。
- 错误率低于1%。

该数据仅作为Sprint 2架构烟测，不代表最终生产容量承诺。

## 12. 10个工作日实施安排

| 日程 | 后端主线 | 前端主线 | 测试/技术负责人 | 当日门禁 |
|---|---|---|---|---|
| D1 | 冻结工作包、事件、规则DSL、任务状态机、评价契约与受信身份方案 | 六角色流程与信息架构 | 冻结权限矩阵、验收人、升级路径 | ADR和产品口径通过 |
| D2 | 数据库RBAC、ScopeResolver、V5+结构、RLS、外键与OpenAPI先行 | 正式路由、API客户端和任职上下文 | 空库/V4升级与权限测试设计 | 身份、DB与API评审通过 |
| D3 | 工作包定义、版本、范围、分配和期望 | 工作包与我的工作页面 | 工作包版本、范围和权限测试 | 发布版本不可变 |
| D4 | 班次、岗位记录、表单校验和提交事件 | 填报、团队工作、记录详情 | 一人多岗和幂等提交 | 真实工作记录可提交 |
| D5 | 可靠Outbox/Inbox、管理事件、规则模拟与发布 | 规则与事件页面 | 重复投递、规则操作符和零副作用模拟 | 规则结果可解释 |
| D6 | 任务状态机、参与人、证据与并发控制 | 我的任务、团队任务、任务详情 | 全部合法/非法迁移 | 状态机全绿 |
| D7 | 标准评价、通知和SLA升级 | 评价、通知和验收/打回 | 复算、幂等和升级 | 评价可复算 |
| D8 | 六角色权限、责任人和验收人联调 | 六角色工作台、真实API闭环 | 四条浏览器闭环 | 页面无演示数据 |
| D9 | 重试、异常队列、索引和性能优化 | 错误/空状态与重复提交保护 | 两租户、兄弟门店、性能和回归 | 0个P0/P1 |
| D10 | 发布候选与数据核验 | UAT修正和截图 | 六角色UAT、报告、迁移和OpenAPI | Go/No-Go评审 |

若实际团队少于4人，应拆成：

- Sprint 2A：工作包、工作记录、事件、规则。
- Sprint 2B：任务、评价、真实页面、完整闭环。

不得通过取消RLS、幂等、状态机、版本不可变或测试来压缩周期。

## 13. Sprint 2交付物

- V5+数据库迁移和升级说明。
- OpenAPI 0.2.0-sprint2。
- 工作包中心功能说明。
- 六角色权限与责任矩阵。
- 页面功能说明。
- 自动化测试报告。
- 四条闭环验收报告。
- 六角色UAT记录。
- 系统截图。
- 部署、功能开关、失败恢复和回滚说明。
- Sprint 3 AI Gateway输入清单。

## 14. 开工前必须确认的问题

1. OTA运营助理和OTA运营经理属于集团、区域还是跨店共享部门？
2. OTA助理的目标门店范围由谁分配和复核？
3. OTA异常中哪些由OTA团队整改，哪些必须转给门店店助？
4. 前台班次数据由谁维护，跨午夜班次归属哪个业务日？
5. 同岗位是否采用“集团基础工作包 + 门店附加工作包”，还是首期只允许单一主包？
6. 工作记录完整性复核与整改任务验收是否确认分离？本方案默认分离。
7. 自我验收是否一律禁止？本方案默认禁止。
8. 店助与店总的最终验收边界如何划分？
9. 店总本人工作记录的上级验收人是否在Sprint 2纳入？
10. 无负责人、多人匹配、无验收人时是否统一进入配置异常队列？本方案默认是。

## 15. 完成定义

只有同时满足以下条件，Sprint 2才可标记完成：

1. 标准→工作包→工作记录→评价→规则→任务→执行→验收真实运行。
2. 四条端到端场景使用真实PostgreSQL和真实React页面通过。
3. 六个重点岗位全部完成角色UAT。
4. 组织、一人多岗、权限隔离和标准版本模型没有被破坏。
5. 所有自动动作具备事件、规则版本、责任任职、输入快照、幂等键和审计。
6. V4升级与空库安装均通过。
7. Sprint 1全部测试继续通过。
8. API、页面、迁移、测试、截图和部署文档齐全。
9. 没有未解决的P0/P1缺陷。

本方案当前只完成实施设计，不代表Sprint 2已经开始编码。
