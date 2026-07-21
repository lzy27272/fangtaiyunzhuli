# Hotel AI OS V0.1 技术冻结报告

| 项目 | 冻结值 |
|---|---|
| 文档版本 | V1.0 |
| 冻结日期 | 2026-07-17 |
| 产品架构蓝图 | V1.2 |
| 当前技术基线 | V0.1（Sprint 1 验收通过） |
| 数据库基线 | PostgreSQL / Flyway V4 |
| HTTP API 主版本 | /api/v1 |
| OpenAPI 契约版本 | 0.1.0-sprint1 |
| 后端制品版本 | 0.1.0-SNAPSHOT |
| 冻结状态 | 已确认，可作为 Sprint 2 唯一开发基线 |

## 0. 冻结结论

Hotel AI OS V0.1 已形成可继续扩展的基础底座。本次冻结的是技术方向、核心数据关系、隔离原则和既有 API 兼容性，不是把当前技术债务固化为长期方案。

Sprint 2 必须基于本报告增量开发，并同时满足以下四条不可破坏约束：

1. 组织模型继续使用 tenant + org_unit + org_unit_closure。
2. 一人多岗继续使用 employee + position_definition + employee_position_assignment。
3. 权限隔离继续保留受信身份、应用授权、显式 tenant 条件和 PostgreSQL FORCE RLS 多层防线。
4. 标准中心继续使用 standard_definition + standard_version + standard_scope，已发布版本不可原地修改。

变更纪律：

- V1—V4 迁移文件禁止修改；新结构只能通过 V5 及之后的迁移追加。
- /api/v1 只能进行向后兼容扩展；破坏性变更必须启用新的 API 主版本。
- 新模块不得建立平行的组织树、员工单岗字段、权限体系或标准体系。
- Rule Engine、任务中心及未来 AI 模块通过事件和明确契约协作，不直接改写其他模块底表。

## 1. 当前系统架构确认

### 1.1 产品管理链

    组织与权限中心
           ↓
       企业标准中心
           ↓
    岗位工作数据 + 经营数据
           ↓
      审计日志 + Outbox
           ↓
      企业规则中心（Sprint 2）
           ↓
      任务执行中心（Sprint 2）
           ↓
      绩效复盘与知识沉淀（后续）
           ↓
       反哺标准中心

AI 主动发现仍是冻结入口之一，但 Sprint 2 不调用大模型；其运行能力在 AI Gateway 建成后接入。

### 1.2 技术形态

| 层次 | 当前实现 | 冻结结论 |
|---|---|---|
| Web | React 19 + TypeScript + Vite | 保留；当前是可构建的交互原型和页面框架 |
| API | Java 21 + Spring Boot 3.5.3 | 保留模块化单体，不在 Sprint 2 拆微服务 |
| 数据访问 | Spring JDBC + 显式 SQL + 事务 | 保留；所有租户访问必须处于已设置租户上下文的事务中 |
| 数据库 | PostgreSQL + Flyway | 保留；生产数据以 PostgreSQL 行为为准 |
| 隔离 | 应用 tenant 条件 + PostgreSQL FORCE RLS | 两层均不可取消 |
| 领域事件 | 同事务写入 outbox_event | Sprint 2 补齐可靠投递、幂等消费、重试及失败隔离 |
| API 契约 | OpenAPI 3.1.0 | docs/openapi.yaml 是当前外部契约基线 |
| AI | 仅冻结 AI Gateway 边界 | 尚未实现，不属于 V0.1 已完成能力 |

### 1.3 后端模块边界

| 模块 | 当前职责 | 对 Sprint 2 的边界 |
|---|---|---|
| organization | 组织树、岗位、员工、任职 | 继续作为唯一组织与一人多岗主数据 |
| iam | 权限目录、角色、角色权限、范围授权 | Sprint 2 激活现有模型，不新增第二套权限体系 |
| standards | 标准分类、定义、版本、范围、发布 | Rule 与 Evaluation 只引用精确发布版本 |
| workdata | 表单、表单版本、工作记录、附件元数据 | 作为岗位工作事件来源 |
| metrics | 指标定义、门店指标观测 | 作为经营事件来源 |
| dashboard | CEO、店总基础聚合 | Sprint 2 以兼容方式增加风险与任务摘要 |
| shared | 租户上下文、RLS设置、授权、审计、异常 | Sprint 2 先完成权限与事件基础加固 |

当前前端页面仍直接读取 apps/web/src/data/demo.ts；虽然已有 API 客户端，但尚未成为页面数据源。因此 V0.1 的前端状态冻结为“页面框架与演示原型”，不能表述为完整业务前端。

### 1.4 当前尚未运行的中心

- 企业规则中心
- 任务执行中心
- 标准评价执行器
- AI Gateway 与 Agent Runtime
- 绩效复盘中心
- 企业知识中心

这些模块在产品架构中已确定边界，但不属于 V0.1 的已实现运行能力。

## 2. 数据库最终结构说明

### 2.1 冻结指纹

| 迁移 | 作用 | SHA-256 |
|---|---|---|
| V1__sprint1_foundation.sql | 25 张基础表、约束、索引与更新时间触发器 | F884E45979F620CD08980FBC086B030C83DFCF20C301C632C4F8D83F22430E58 |
| V2__tenant_row_level_security.sql | 租户 RLS 策略 | 137D7F22AF96F2C977D4FA58E00E90DCE7EE060FFB437909A80210EA3FE2D0FC |
| V3__sprint1_demo_seed.sql | Sprint 1 演示数据 | 1B531F7126D3201A9FADAE7FABDC90817F7A7849224CC97F506D9015B00B3BAB |
| V4__grant_runtime_privileges.sql | 运行账号授权 | 5E90B4F245486DC366C0F3A373D678E49DFE4AA2E1D7007224340E01C01A8CFD |

补充指纹：

- docs/openapi.yaml：8E09C1AA27937590A9C14075C93BB61E937F62495B78E2597D7C0CBE5A511B0F
- hotel-ai-os-core-api-0.1.0-SNAPSHOT.jar：878E500279D137A0F0B04B9069B49B06C8CF0477F3178EB44A553CFC68D3AD5B

当前工作区没有有效 Git 提交历史，因此以上指纹是本次冻结的临时追溯依据。Sprint 2 开始前必须初始化正式版本库并建立 V0.1 基线标签。

### 2.2 25 张业务表

Flyway 自身的 schema history 表不计入以下业务表数量。

| 领域 | 表 | 职责与关键关系 |
|---|---|---|
| 租户 | tenant | 集团租户根；保存编码、名称、状态、时区 |
| 组织 | brand | 租户下品牌 |
| 组织 | org_unit | GROUP、REGION、HOTEL、DEPARTMENT 统一组织节点 |
| 组织 | org_unit_closure | 组织祖先—后代闭包，用于树范围查询 |
| 组织 | hotel_profile | HOTEL 节点的一对一门店档案，可关联品牌 |
| 账号 | user_account | 登录账号；与员工实体分离 |
| 人员 | employee | 员工档案，可选关联账号 |
| 岗位 | position_definition | 岗位定义、职族和等级 |
| 任职 | employee_position_assignment | 员工—组织—岗位多对多任职及上级任职 |
| IAM | permission | 全局权限点目录；唯一不带 tenant_id 的业务表 |
| IAM | app_role | 租户角色 |
| IAM | role_permission | 角色与权限点多对多关系 |
| IAM | role_assignment | 账号角色授权、数据范围和有效期 |
| 标准 | standard_category | 岗位、工作、SOP、检查、KPI 五类标准 |
| 标准 | standard_definition | 稳定标准身份、编码、归属和描述 |
| 标准 | standard_version | 结构化条目、证据、评分、生效期及发布状态 |
| 标准 | standard_scope | 标准版本适用的租户、品牌、组织树或岗位范围 |
| 工作数据 | form_definition | 岗位工作表单稳定身份 |
| 工作数据 | form_version | JSON Schema、UI Schema 及发布生命周期 |
| 工作数据 | work_record | 员工基于某一有效任职和表单版本提交的记录 |
| 工作数据 | attachment | 工作记录附件元数据、对象键、哈希和扫描状态 |
| 经营数据 | metric_definition | 收入、入住率、ADR、RevPAR、OTA 等指标定义 |
| 经营数据 | metric_observation | 门店、业务日、指标、来源和值 |
| 基础设施 | audit_log | 操作审计、操作者、资源及关联 ID |
| 基础设施 | outbox_event | 与业务事务同提交的领域事件 |

### 2.3 关键数据库约束

- 主键统一采用 UUID。
- 带租户的实体普遍提供 tenant_id + id 唯一键；跨实体关系使用同租户组合外键，阻断跨租户引用。
- org_unit 同时保存 parent_id 和 closure 关系，分别满足直接父子与祖先/后代查询。
- hotel_profile 与 HOTEL 组织节点一对一。
- employee_position_assignment 保存主岗标记、PERMANENT / TEMPORARY / ACTING、有效期和 manager_assignment_id。
- 当前唯一索引限制同一员工只能有一个无结束日期的活动主岗；多个兼岗、临时岗和代理岗可以并存。
- role_assignment 支持 SELF / ORG_UNIT / ORG_TREE / TENANT 范围及 valid_from / valid_to。
- standard_version 与 form_version 均采用定义和版本分离，不覆盖历史版本。
- work_record 固定引用提交时的 form_version_id 与 employee_position_assignment_id。
- metric_observation 对门店、指标、业务日、来源和来源记录建立幂等约束。
- 未发布 outbox 事件、工作记录日期、指标观测、审计资源和标准范围均有查询索引。

### 2.4 RLS 状态

25 张业务表中有 24 张启用并强制执行 RLS：

- tenant 使用 tenant_self 策略。
- 23 张带 tenant_id 的领域表使用 tenant_isolation 策略。
- permission 是全局权限目录，不带 tenant_id，不启用 RLS。

RLS 同时使用 USING 和 WITH CHECK，覆盖读取与写入。运行连接必须在事务内设置 app.tenant_id，且运行角色不得是表所有者、不得拥有 BYPASSRLS。

### 2.5 数据库冻结规则

- 禁止修改 V1—V4 内容或校验和。
- Sprint 2 所有租户业务表必须在创建迁移中同步加入 tenant_id、同租户外键、必要索引和 FORCE RLS。
- 任何历史责任关系必须保存精确版本或快照，不能只引用会变化的当前定义。
- 演示数据不得继续进入所有环境自动执行的正式迁移；V3 的后续处理必须采用环境隔离方案，不能回改 V3。

## 3. 核心实体关系说明

### 3.1 组织与一人多岗

    Tenant
      ├── Brand
      └── OrgUnit
           ├── GROUP
           ├── REGION
           ├── HOTEL ── HotelProfile ── Brand
           └── DEPARTMENT

    Employee
      └── EmployeePositionAssignment
           ├── OrgUnit
           ├── PositionDefinition
           ├── ManagerAssignment
           ├── 主岗 / 兼岗
           └── 任职类型与有效期

岗位和员工不是组织节点。员工所属组织与岗位只能通过任职关系表达；不得在 employee 上增加单一 org_unit_id 或 position_id。

### 3.2 账号、角色与权限

    UserAccount
      └── RoleAssignment
           ├── AppRole
           │    └── RolePermission ── Permission
           ├── ScopeType
           ├── ScopeOrgUnit
           └── ValidFrom / ValidTo

Position 表达“员工做什么工作”，Role 表达“账号能做什么操作”，两者必须继续分离。一名员工可以多岗，一名账号也可以同时拥有多条角色授权。

### 3.3 标准中心

    StandardCategory
      └── StandardDefinition
           └── StandardVersion
                └── StandardScope
                     ├── TENANT
                     ├── BRAND
                     ├── ORG_UNIT / ORG_TREE
                     └── POSITION

StandardDefinition 是稳定身份；StandardVersion 是某一时点的判断依据；StandardScope 决定适用范围。Sprint 2 的标准评价、规则和任务必须引用 standard_version_id，并保存必要快照，不能只引用可继续换版的 definition。

### 3.4 双入口与事件

    PositionAssignment + FormVersion
                    ↓
               WorkRecord
                    └── Attachment

    Hotel + MetricDefinition
                    ↓
             MetricObservation

    WorkRecord / MetricObservation / StandardPublished / FormPublished
                    ↓
              AuditLog + OutboxEvent
                    ↓
          Sprint 2 Rule Engine / Task Center

Outbox 是模块协作边界，不是已完成的消息总线；可靠投递和消费者幂等属于 Sprint 2 前置能力。

## 4. 权限模型说明

### 4.1 冻结的目标权限链

    受信 JWT / SSO 身份
            ↓
    服务端加载有效 RoleAssignment
            ↓
    聚合 RolePermission + ScopeType + OrgScope
            ↓
    应用层 Permission / OrgScope 判定
            ↓
    SQL 显式 tenant_id 条件
            ↓
    PostgreSQL FORCE RLS

### 4.2 V0.1 已具备

- permission、app_role、role_permission、role_assignment 的持久化模型和配置 API。
- 角色授权范围类型、生效时间和失效时间。
- 组织闭包表驱动的部分列表范围下钻。
- 每个业务查询显式带 tenant_id。
- 事务内设置数据库租户上下文。
- PostgreSQL FORCE RLS 与真实双租户隔离测试。
- 开发请求头认证默认关闭，未配置正式身份时业务 API 失败关闭。

### 4.3 V0.1 尚未具备

- 尚未接入 Spring Security JWT / SSO。
- 运行时尚未从 role_assignment 与 role_permission 派生权限；当前开发模式信任请求头提供的单个角色和组织范围。
- TenantPrincipal 只能表达单个 roleCode，不能表达一账号多角色及各自的范围、有效期。
- 配置管理员仍由 PLATFORM_ADMIN、GROUP_ADMIN、CEO 硬编码。
- 单资源 requireOrgScope 只比较直接 ID，尚未统一 ORG_TREE 的后代访问语义。
- 标准适用范围尚未用于“当前员工可见标准”解析。

因此，V0.1 的准确表述是：“生产可扩展的 RBAC 数据模型、配置 API 与租户隔离底座已完成；受信身份和数据库驱动的运行时授权尚待接通。”

### 4.4 数据范围语义

| 范围 | 冻结语义 |
|---|---|
| SELF | 仅本人及明确允许的本人业务记录 |
| ORG_UNIT | 仅指定组织节点，不自动包含后代 |
| ORG_TREE | 指定节点及 org_unit_closure 中全部后代 |
| TENANT | 当前租户全域 |

Sprint 2 必须以一个服务端 Scope Resolver 统一列表查询、单资源命令、任务分派、通知和升级路径的范围判断。

## 5. API 版本清单

### 5.1 版本状态

| 项目 | 当前值 |
|---|---|
| OpenAPI 规范 | 3.1.0 |
| 契约版本 | 0.1.0-sprint1 |
| URL 主版本 | /api/v1 |
| Controller 与 OpenAPI 一致性 | 30 个业务操作，已一致 |
| /api/v2 | 不存在 |
| Actuator | health、info、metrics；不计入业务 OpenAPI |

### 5.2 当前 30 个业务操作

| 模块 | 方法 | 路径 | 当前能力 |
|---|---|---|---|
| Organization | GET | /api/v1/org/units | 查询授权组织节点 |
| Organization | POST | /api/v1/org/units | 创建组织节点 |
| Organization | GET | /api/v1/org/positions | 查询岗位 |
| Organization | POST | /api/v1/org/positions | 创建岗位 |
| Organization | GET | /api/v1/org/employees | 查询员工及任职 |
| Organization | POST | /api/v1/org/employees | 创建员工 |
| Organization | POST | /api/v1/org/employees/{employeeId}/assignments | 创建任职 |
| IAM | GET | /api/v1/iam/permissions | 查询权限点 |
| IAM | GET | /api/v1/iam/roles | 查询角色 |
| IAM | POST | /api/v1/iam/roles | 创建角色 |
| IAM | PUT | /api/v1/iam/roles/{roleId}/permissions | 替换角色权限集合 |
| IAM | POST | /api/v1/iam/role-assignments | 创建范围授权 |
| Standard | GET | /api/v1/standards/categories | 查询标准分类 |
| Standard | GET | /api/v1/standards | 查询标准及最新可见版本 |
| Standard | POST | /api/v1/standards | 创建标准定义 |
| Standard | POST | /api/v1/standards/{standardId}/versions | 创建结构化标准版本 |
| Standard | POST | /api/v1/standards/{standardId}/versions/{versionId}/publish | 发布标准版本 |
| Work Data | GET | /api/v1/work-data/forms | 查询岗位表单 |
| Work Data | POST | /api/v1/work-data/forms | 创建表单定义 |
| Work Data | POST | /api/v1/work-data/forms/{formId}/versions | 创建表单版本 |
| Work Data | POST | /api/v1/work-data/forms/{formId}/versions/{versionId}/publish | 发布表单版本 |
| Work Data | GET | /api/v1/work-data/records | 查询授权工作记录 |
| Work Data | POST | /api/v1/work-data/records | 提交工作记录 |
| Work Data | POST | /api/v1/work-data/records/{recordId}/attachments | 登记附件元数据 |
| Metrics | GET | /api/v1/metrics/definitions | 查询指标定义 |
| Metrics | POST | /api/v1/metrics/definitions | 创建指标定义 |
| Metrics | GET | /api/v1/metrics/observations | 查询经营指标观测 |
| Metrics | POST | /api/v1/metrics/observations | 录入经营指标观测 |
| Dashboard | GET | /api/v1/dashboards/ceo | CEO 集团摘要 |
| Dashboard | GET | /api/v1/dashboards/hotels/{hotelId} | 店总门店摘要 |

### 5.3 API 兼容规则

- Sprint 2 新能力继续追加到 /api/v1。
- 已有字段、状态含义和路径不得静默改变。
- 列表分页等兼容改造应保留已有调用方式或明确提供迁移期。
- 所有命令型接口必须逐步补充权限码、幂等键、稳定错误码和乐观并发控制。
- OpenAPI 版本在 Sprint 2 完成时升级为 0.2.0-sprint2。

## 6. 已完成能力

### 6.1 已完成并验证

- 多租户基础模型。
- 集团、区域、门店、部门统一组织树及闭包查询。
- 员工、岗位、一人多岗、主岗、临时岗、代理岗和上级任职模型。
- 权限点、角色、角色权限和范围授权的数据模型与配置 API。
- 标准分类、定义、结构化版本、证据要求、评分规则、适用范围与发布生命周期。
- 岗位表单定义、JSON Schema 版本、发布、工作记录和附件元数据。
- 经营指标定义、门店指标录入和数据来源。
- CEO 与店总驾驶舱基础 API。
- 审计日志和事务 Outbox 写入。
- 4 个 Flyway 迁移、25 张业务表和 24 张表的强制 RLS。
- 真实 PostgreSQL 14.22 迁移与隔离测试。
- 后端 11 项测试通过、前端生产构建通过、后端 JAR 构建通过。

### 6.2 仅完成模型或框架，尚未完整接通

- RBAC：模型与配置 API 已完成，运行时数据库授权解析未接通。
- 附件：元数据和对象键已完成，真实上传、下载授权与病毒扫描未接通。
- 前端：页面框架与演示数据已完成，真实 API 数据流未接通。
- Outbox：事务写入已完成，可靠分发、消费、重试和死信未接通。
- 标准结构化：JSONB 容器已完成，条目 DSL / JSON Schema 校验和适用标准解析未完成。

### 6.3 未完成

- Rule Engine、任务状态机、通知升级、标准评价运行时。
- AI Gateway、Prompt / Agent / Model 管理及 AI 审计。
- 绩效复盘、知识中心和标准反馈闭环。
- 复杂 OTA 接入、自动调价、高级预测、多 Agent 协同。

## 7. 当前技术债务

### 7.1 P0：Sprint 2 开工门禁

| 编号 | 技术债务 | Sprint 2 处理要求 |
|---|---|---|
| P0-01 | 正式认证缺失；开发请求头可自报角色与范围 | 接入 Spring Security 资源服务器边界；浏览器只提交受信令牌，角色和范围全部由服务端派生 |
| P0-02 | 持久化 RBAC 未进入运行时授权 | 建立 AuthorizationContextResolver，聚合有效角色、权限和数据范围 |
| P0-03 | ORG_TREE 列表与单资源授权语义不一致 | 建立统一 Scope Resolver，并覆盖区域到门店、门店到部门测试 |
| P0-04 | Outbox 缺少事件版本、锁租约、重试、死信和消费者幂等 | 先完成可靠事件主干，再允许规则自动创建任务 |
| P0-05 | “漏交”没有应提交计划与期望实例 | 增加版本化提交策略和按业务日固化的 expectation |
| P0-06 | OTA 日值来源、质量、缺失日、时区与连续下降算法未定义 | 冻结 canonical 日值和趋势算法，规则执行保存输入快照 |
| P0-07 | 已发布标准、范围和表单仅靠 API 约定不可变 | 增加数据库不可变保护、内容 hash 和结构校验 |
| P0-08 | 新建 HOTEL 不会自动形成 hotel_profile | 增加原子化门店建档流程，避免驾驶舱漏店 |
| P0-09 | 生产迁移账号可回退为运行账号 | 强制 owner、runtime、worker 账号分离并最小授权 |
| P0-10 | 当前没有有效 Git 基线 | Sprint 2 开工前建立仓库、保护主分支并打 V0.1 标签 |

### 7.2 P1：Sprint 2 内治理

- TenantPrincipal 只支持单角色，尚不能表达一账号多角色与各自范围。
- 组织父子类型没有强制 GROUP → REGION → HOTEL → DEPARTMENT。
- 主岗时间重叠和 manager_assignment 的组织、有效期完整性约束不足。
- standard_scope 的唯一性与互斥字段约束不足。
- 标准与表单版本号使用 max + 1，并发创建存在竞争。
- 标准适用范围尚未真正参与员工可见标准解析。
- 工作记录与任职、员工、组织的一致性主要依赖服务校验。
- 表单 payload 尚未按已发布 JSON Schema 验证。
- 工作提交的 actor 与员工代填权限边界尚未明确。
- 列表 API 没有统一分页、排序与过滤契约。
- 大量 API 响应使用 Map，缺少稳定 DTO、operationId 和细粒度错误码。
- 写接口缺少统一 Idempotency-Key 和 expectedVersion。
- Actuator 匿名跳过范围过宽；生产只应公开必要健康探针。
- API 全链路尚未使用最小权限运行账号执行 RLS 测试。
- React 页面未使用真实 API，缺少前端自动化测试。
- V3 演示数据会进入所有环境，需要环境隔离。
- PostgreSQL 测试版本为 14.22，Compose 为 17，支持版本矩阵未冻结。
- Core API README 的测试状态已过期。

### 7.3 P2：后续演进

- JDBC SQL、租户准备和权限判断存在重复，可在边界稳定后抽取。
- 缺少结构化日志、分布式追踪、Outbox 延迟、规则积压与任务超时监控。
- 缺少 1000 门店规模的规则扫描、列表和驾驶舱容量测试。
- 缺少个人信息脱敏、字段加密、归档和数据保留策略。
- 前端缺少正式路由、查询缓存、错误边界和统一组件体系。

## 8. Sprint 2 开始前需要注意事项

### 8.1 四项冻结模型保护

| 冻结模型 | 必须保持 | 禁止做法 | Sprint 2 验证 |
|---|---|---|---|
| 组织模型 | org_unit + org_unit_closure 为唯一组织主数据 | 为规则、任务另建门店或部门树 | 区域可访问下属门店，不能访问其他区域 |
| 一人多岗 | 任务、期望、评价绑定 assignment_id 与历史快照 | 在 employee 上新增单一岗位或仅按 employee 分派任务 | 双岗员工任务责任不会随主岗变化漂移 |
| 权限隔离 | 服务端授权 + tenant 条件 + FORCE RLS | 信任客户端角色/范围、取消任一租户防线 | 新表跨租户读写与动作全部拒绝 |
| 标准中心 | 定义、版本、范围分离，引用精确发布版本 | 原地修改已发布标准，或把规则复制成标准 | 标准换版后历史评价和任务不变化 |

### 8.2 开工前必须冻结的业务口径

1. 岗位工作提交策略：适用任职、表单版本、频率、截止时间、门店时区、补交与豁免。
2. OTA 权威日值：来源优先级、VERIFIED 条件、缺失日、重复数据和连续 7 天下跌的精确定义。
3. 负责人和升级人解析：岗位、角色、组织范围、有效期，以及无人或多人匹配时的异常处理。
4. 任务验收：谁可确认、谁可验收、谁可打回、何时可取消。
5. 高影响动作边界：Sprint 2 只通知、建任务和升级，不自动处罚、晋升或作出经营决策。

### 8.3 技术启动顺序

1. 建立 V0.1 Git 标签和冻结回归测试。
2. 接通受信身份、数据库 RBAC 与统一 Scope Resolver。
3. 补齐 Outbox 可靠消费、期望实例与经营日值契约。
4. 再开发 Rule Engine、任务中心、标准评价、通知与前端页面。
5. 最后以真实 PostgreSQL 和真实 React 页面完成两条端到端闭环。

### 8.4 发布纪律

- 先部署 V5+ 增量迁移，再部署默认关闭的新能力。
- Rule Engine、Outbox Dispatcher 和自动升级必须有独立功能开关。
- 先运行规则模拟和数据回放，再启用真实建任务动作。
- 迁移必须同时验证“V4 数据库升级”和“空库安装”，不能只测试空库。
- 每次自动动作都必须产生审计、关联 ID、规则版本、输入快照和幂等键。

## 9. 最终确认

Hotel AI OS V0.1 技术架构正式冻结。

Sprint 2 获准在此基线上进行增量实施，但本报告本身不代表 Sprint 2 已开始开发。本轮未修改业务代码、数据库迁移和 API 实现。

后续所有架构变更必须回答四个问题：

1. 是否仍以 org_unit 组织树为唯一组织事实？
2. 是否仍通过 employee_position_assignment 表达一人多岗和历史责任？
3. 是否仍由服务端权限与 PostgreSQL RLS共同保证隔离？
4. 是否仍引用不可变的标准版本，而不是覆盖历史标准？

任一答案为“否”，即视为破坏冻结架构，必须停止开发并进行专项技术评审。
