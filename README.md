# Hotel AI OS

酒店集团第二管理体系。当前产品基线为PRODUCT-V1.2；TECH-V0.1已发布。TECH-V0.2已完成RC Final本地业务收口，并完成RC3安全加固：六角色、三业务闭环、正式JWT路径、真实后台Worker、附件安全扫描、数据库密码外部必填、Live宿主干净停机、可复现构建和数据库恢复演练均有证据；但正式签署、目标企业SSO、真实现场照片与目标附件链、有效Git标签以及目标环境运维保障仍未完成，因此TECH-V0.2保持Unreleased。Sprint 3预实施计划已输出，但仍待TECH-V0.2正式发布和TECH-V0.3技术冻结，尚未启动编码。

当前可供门店开展受控内部业务测试的版本为`TECH-V0.2-PILOT.5`，产品名称“贵州四方馆酒店管理有限公司中台”，公网地址为https://www.sfgzt.cn。该Pilot已接入本机真实PostgreSQL和真实应用账号，支持网页维护组织/岗位/人员与一人多岗，支持工作包创建、发布、下发，以及七类运营岗位的真实结构化填报和图片附件；8个真实角色的API写入与公网页面UAT均已通过。操作说明见`docs/PILOT-TEST-USER-GUIDE.md`，岗位能力验收报告见`docs/uat/TECH-V0.2-PILOT.5-ROLE-CAPABILITY-UAT.md`。Pilot可用不改变TECH-V0.2正式版仍为Unreleased的发布判断。

## Sprint 1 范围

- 组织与权限：租户、集团、区域、门店、部门、员工、岗位、一人多岗、RBAC 数据模型。
- 企业标准中心：标准分类、定义、版本、适用范围和发布。
- 双入口数据：岗位工作记录与经营指标录入。
- 驾驶舱：CEO 和店总基础框架。

## Sprint 2 当前实现

- 工作包中心：定义、版本、适用范围、岗位分配与工作期望。
- 岗位工作：记录提交、复核及与标准、任职的精确关联。
- 企业规则中心：确定性事件条件、模拟、发布和幂等消费；当前动作限定为创建任务或站内通知。
- 任务执行中心：状态流转、SLA、证据、返工与验收。
- 标准评价：确定性评价与人工复核。
- 事件链路：事务Outbox自动投影为管理事件，并触发规则消费。
- 权限：生产使用JWT/SSO受信身份与数据库RBAC；开发请求头仅接受tenant/actor。
- 页面：前台员工、前厅主管、客房主管、店助、店总、区域运营六角色真实API工作台、任务、评价、通知和驾驶舱页面。
- 真实附件：图片上传、列表、下载、删除、结构校验和SHA-256核对。
- 未完成闭环：工作期望MISSED检测、提醒、规则建任务、任务OVERDUE和升级。
- 驾驶舱：店总门店风险/未完成任务汇总和区域多门店运营视图。

当前Pilot工作树数据库迁移已达到Flyway V15，共50张业务表；V5—V13新增/加固25张Sprint 2租户业务表并补齐区域驾驶舱权限，V14增加Pilot本地账号认证数据，V15补齐七类运营岗位的结构化表单、工作包、动态下发和当日真实工作，租户业务表继续启用并强制RLS。当前Pilot OpenAPI仍为0.2.2-pilot.4（71路径、91操作、61模型），本次无破坏性API变更。正式判断见`docs/TECH-V0.2-RELEASE-CANDIDATE-FINAL-REPORT.md`。

RC3本地加固运行移除了发布JAR中的数据库密码回退值，并在应用入口增加缺失密钥预检；48项后端测试零失败，真实Live UAT宿主1/1通过并确认Hikari先于PostgreSQL关闭；两次独立构建的5项制品指纹一致，深度敏感信息扫描覆盖160个文件和43,830个归档条目，0命中、0错误。无密钥启动在0.2秒内失败，未创建Spring上下文、未尝试数据库连接、未监听端口。该结果关闭本地代码级问题，但制品仍未绑定Git提交，不能替代正式发布门禁。

TECH-V0.2仍需完成目标企业SSO及账号生命周期验证、真实客房现场照片与目标对象存储/附件备份恢复、10方正式签字、有效Git提交和正式标签，以及目标持久化PostgreSQL的备份保留、加密、监控和运维签署，才能从Unreleased迁入Released。

AI Gateway、绩效复盘和知识中心继续保留为冻结架构模块，后续按技术版本实施。

## 仓库结构

```text
apps/core-api/       Java/Spring Boot 核心 API
apps/web/            React/TypeScript 管理端
database/migrations/ PostgreSQL 数据库迁移
docs/                架构、接口、页面、测试与计划
tools/               本地验证工具
```

## 构建与验证

项目使用JDK 21、Maven、Node.js和pnpm。当前工作区已在`.tooling/`准备便携JDK/Maven与项目级依赖缓存，该目录不会提交版本库。

后端完整测试会自动启动临时PostgreSQL、执行全部Flyway迁移和API集成测试：

```powershell
cd apps/core-api
mvn test
```

前端生产构建：

```powershell
cd apps/web
pnpm install
pnpm build
```

无依赖页面原型仍可直接打开：

```text
apps/web/prototype/index.html
```

已验证的生产构建产物位于`apps/core-api/target/`和`apps/web/dist/`。

Sprint 1实施与验收范围见`docs/SPRINT-1-IMPLEMENTATION-PLAN.md`；Sprint 2当前实现与未完成项见`docs/SPRINT-2-IMPLEMENTATION-REPORT.md`。

Sprint 3“AI进入管理闭环”预实施计划见`docs/SPRINT-3-PLAN.md`，当前V1.1已纳入受限CEO Agent及每日《CEO AI经营简报》。该计划用于产品和技术审查，不代表已允许启动Sprint 3编码。

TECH-V0.3技术冻结草案见`docs/TECH-V0.3-TECHNICAL-FREEZE-DRAFT.md`。草案已定义首个受控工作分析闭环和同迁移强制RLS原则，但在TECH-V0.2正式发布、数据安全评审和独立开工批准前不生效。

## 项目长期维护基线

后续所有系统更新、优化和维护必须同步检查以下三份文档：

- 产品总蓝图：`docs/HOTEL-AI-OS-PRODUCT-BLUEPRINT.md`
- 变更日志：`CHANGELOG.md`
- 技术版本记录：`docs/TECHNICAL-VERSION-HISTORY.md`

强制维护规则：

1. 每次产品、功能、数据库、API、权限、安全、页面或运维变更，先在`CHANGELOG.md`的Unreleased登记。
2. 如果改变产品定位、核心管理链、中心边界或不可破坏模型，必须先更新并冻结产品总蓝图。
3. 开始开发、进入测试、完成验收或正式发布时，必须更新技术版本状态和证据。
4. PRODUCT、TECH、API和DB版本分别编号，禁止只写无法判断含义的裸版本号。
5. 尚未开发的能力只能标记“规划中”，不得写成已完成。
6. 已发布记录采用追加式维护，不覆盖历史结论。

## Sprint 1 交付索引

- 架构冻结：`docs/V1.2-ARCHITECTURE-FREEZE.md`
- V0.1技术冻结报告：`docs/HOTEL-AI-OS-V0.1-TECHNICAL-FREEZE-REPORT.md`
- 数据库迁移：`database/migrations/`
- API契约：`docs/openapi.yaml`
- 页面说明：`docs/PAGE-FUNCTIONS.md`
- 测试报告：`docs/TEST-REPORT.md`
- Sprint 2详细实施方案：`docs/SPRINT-2-PLAN.md`
- 当前截图：`docs/sprint1-ceo-dashboard.png`、`docs/sprint1-gm-dashboard.png`、`docs/sprint1-standard-center.png`

## Sprint 2 开发候选索引

- 实施方案：`docs/SPRINT-2-PLAN.md`
- 本轮实施报告：`docs/SPRINT-2-IMPLEMENTATION-REPORT.md`
- 数据库迁移：`database/migrations/V5__sprint2_work_packages_and_records.sql`至`database/migrations/V13__sprint2_1_regional_dashboard_permission.sql`
- API契约：`docs/openapi.yaml`
- 页面说明：`docs/PAGE-FUNCTIONS.md`
- 自动化测试证据：`docs/TEST-REPORT.md`
- Sprint 2.1技术闭环UAT报告：`docs/SPRINT-2.1-UAT-ACCEPTANCE-REPORT.md`
- Sprint 2.1正式Final UAT报告：`docs/HOTEL-AI-OS-TECH-V0.2-SPRINT-2.1-FINAL-UAT-REPORT.md`
- Sprint 2.1最终证据：`docs/uat/evidence/20260717-2317-s21-final/README.md`
- TECH-V0.2 RC Final报告：`docs/TECH-V0.2-RELEASE-CANDIDATE-FINAL-REPORT.md`
- TECH-V0.2 RC Release Note：`docs/releases/TECH-V0.2-RELEASE-NOTE-RC.md`
- TECH-V0.2 RC Final证据：`docs/uat/evidence/20260718-0112-tech-v02-rc-final/README.md`
- TECH-V0.2 RC2身份生命周期与闭环复验证据：`docs/uat/evidence/20260718-0154-tech-v02-rc2/README.md`
- TECH-V0.2 Live宿主停机复验证据：`docs/uat/evidence/20260718-1306-tech-v02-shutdown-order-fixed/README.md`
- TECH-V0.2 RC3本地安全加固证据：`docs/uat/evidence/20260718-1315-tech-v02-rc3-local-hardening/README.md`
- TECH-V0.2只读发布门禁组件（仅内部诊断，不构成发布授权）：`tools/release/Test-TechV02ReleaseGate.ps1`
- TECH-V0.2证据一致性校验器：`tools/release/Test-TechV02EvidenceConsistency.ps1`
- TECH-V0.2发布包敏感信息扫描器：`tools/release/Test-ReleaseSensitiveInformation.ps1`
- TECH-V0.2外部证据包校验器：`tools/release/Test-TechV02ExternalEvidenceBundle.ps1`
- TECH-V0.2唯一正式发布收口入口：`tools/release/Invoke-TechV02ReleaseClosure.ps1`
- TECH-V0.2外部证据包说明：`docs/releases/TECH-V0.2-EXTERNAL-EVIDENCE-BUNDLE.md`
- TECH-V0.2发布阻塞交接单：`docs/releases/TECH-V0.2-RELEASE-BLOCKER-HANDOFF.md`
- TECH-V0.2发布门禁输入示例：`docs/releases/TECH-V0.2-RELEASE-GATE-INPUTS.example.json`

本节表示Sprint 2.1业务功能P0/P1与RC Final本地技术验证已通过；发布级REL-P0仍未全部关闭，不表示TECH-V0.2已经正式发布。
收口总控是唯一正式入口，固定执行“本地证据一致性→外部证据生成→独立重算→6项发布门禁”；门禁输入先写同目录唯一暂存文件，复算通过后才原子替换规范输入，最终门禁锁定并返回实际消费字节的SHA，总控再核对前后漂移。任何字段缺失、类型错误、大小写状态不精确、退出码与JSON矛盾、stderr、SHA不一致或副作用声明缺失都会失败关闭；即使全部通过，也只输出可进入人工发布审批，不会修改版本状态或启动Sprint 3。
