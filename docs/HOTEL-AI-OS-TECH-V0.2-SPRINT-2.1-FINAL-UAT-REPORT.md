# Hotel AI OS TECH-V0.2 Sprint 2.1 Final UAT Report

报告版本：FINAL-UAT-V1.0  
验收日期：2026-07-17  
最终证据运行：`20260717-2317-s21-final`  
产品基线：PRODUCT-V1.2  
发布候选：TECH-V0.2 / Sprint 2.1  
最终选择：`B——继续修复`

## 一、版本状态确认

| 版本项 | 当前正式版本 | 本次候选版本 | 验收状态 |
|---|---|---|---|
| PRODUCT | PRODUCT-V1.2 | PRODUCT-V1.2 | 已冻结，本次未改变产品方向 |
| TECH | TECH-V0.1 | TECH-V0.2 | 技术闭环通过，正式业务发布未通过 |
| 数据库 | DB-V4 | DB-V13 / Flyway V1—V13 | 候选迁移通过真实PostgreSQL验证，尚未随TECH-V0.2发布 |
| API | API-V1 | API-V1；OpenAPI `0.2.1-sprint2.1` | 83次UAT请求完成，候选契约尚未正式发布 |
| 后端制品 | TECH-V0.1已发布制品 | `0.1.0-SNAPSHOT` | 当前工作目录未识别为Git仓库，缺少不可变制品版本、Git标签和SHA-256 |

是否具备进入TECH-V0.2正式发布条件：`否`。

原因不是核心业务代码未形成，而是正式发布门槛仍有明确缺口：

1. 场景C由UAT脚本调用SLA处理接口，不是后台Worker自动执行。
2. 六角色使用开发身份入口完成服务端身份解析，生产SSO/正式登录未验收。
3. 六角色业务代表、产品、QA、CTO和发布负责人尚未签字。
4. 真实客房现场照片的人工视觉检查、目标环境对象存储和文件安全未验收。
5. 持久化共享UAT环境、备份恢复、部署回滚和可追溯发布制品未完成。

因此当前正式技术发行仍为TECH-V0.1，TECH-V0.2保持Unreleased；Sprint 3不得启动。

## 二、P0问题关闭情况

### 2.1 真实UAT环境

| 检查项 | 证据 | 结果 |
|---|---|---|
| PostgreSQL UAT环境 | PostgreSQL 14.22；Flyway V13；13次迁移成功 | PASS |
| 应用数据库账号 | `hotel_ai_os_app`；非超级用户；`BYPASSRLS=false` | PASS |
| 租户隔离 | 49张租户业务表强制RLS；主测试租户`10000000-0000-0000-0000-000000000001` | PASS |
| 测试门店 | 华东授权范围内杭州中心店、上海滨江店；深圳门店作为跨区域/隔离拒绝目标 | PASS |
| 六角色账号 | 6个ACTIVE数据库账号；前厅主管2个有效任职，验证一人多岗 | PASS |
| 测试数据Fixture | 工作包、工作项、标准、4条发布规则、经营指标、工作期望和任务基线 | PASS |

证据：

- [数据库环境](uat/evidence/20260717-2317-s21-final/database/00-environment.json)
- [六角色账号](uat/evidence/20260717-2317-s21-final/database/01-six-role-accounts.json)
- [Fixture核验索引](uat/evidence/20260717-2317-s21-final/FIXTURE-VERIFICATION.md)

边界：本次确实运行了PostgreSQL，不是H2或前端演示数据；但它是一次性本地Live UAT环境，不等同于持久化共享UAT/预生产环境。后者仍是正式发布阻断项。

### 2.2 前厅主管管理闭环

验证链：

```text
前台员工提交客诉工作记录
→ 前厅主管查看并创建FAIL评价
→ 评价事件触发规则
→ 规则创建整改任务
→ 前台员工确认、执行并提交结果
→ 前厅主管创建PASS评价
→ 前厅主管验收关闭
```

关键记录：

| 记录 | ID / 状态 |
|---|---|
| 前台工作记录 | `d4a221ad-dbff-4dbb-a271-a312cfd3bc2d` |
| 专用客诉事件 | `55ed7e7f-f4e5-4cb7-bfaa-d77091daaacb` / `COMPLAINTREPORTED` |
| 主管问题评价 | `be6946aa-25d0-43fe-b8e9-3235ffa9e7ab` / `FAIL 60` |
| 规则动作 | `75a334fc-10f5-4bdf-8da0-2cc775d5aca2` / `CREATE_TASK SUCCEEDED` |
| 整改任务 | `1e22ca80-eb92-4d76-92d7-c3d8bfaf17ad` |
| 主管结果评价 | `1b5cb2e3-b778-4566-b3ec-dea854e82581` / `PASS 100` |
| 最终任务状态 | `COMPLETED / ON_TIME` |

另有前厅主管手工创建整改任务`d428a216-2cc8-460a-acc9-fe536c35e0cd`的独立正向证据；该任务验证创建能力后被取消，避免污染待办。

页面：

- [前厅主管团队工作](uat/evidence/20260717-2317-s21-final/screenshots/tech-v0.2-uat-screen-012-b-front-supervisor-team-work-20260717t152154z.png)
- [前厅主管任务中心](uat/evidence/20260717-2317-s21-final/screenshots/tech-v0.2-uat-screen-013-b-front-supervisor-tasks-20260717t152156z.png)
- [前厅主管标准评价](uat/evidence/20260717-2317-s21-final/screenshots/tech-v0.2-uat-screen-014-b-front-supervisor-evaluations-20260717t152157z.png)

结果：`PASS`。

说明：连续闭环内的任务由规则引擎依据主管FAIL评价创建；主管手工创建能力由另一条任务单独验证。

### 2.3 客房主管检查闭环

验证链：

```text
客房主管上传图片
→ 关联客房卫生标准
→ 客房主管创建FAIL评价
→ 规则创建整改任务
→ 客房主管执行并提交整改证据
→ 店总创建PASS评价
→ 店总验收关闭
```

| 记录 | ID / 状态 |
|---|---|
| 客房巡检工作记录 | `2e000000-0000-0000-0000-000000000001` |
| 图片附件 | `c430a0bd-5144-4cea-be63-897aecf8395d` |
| 图片SHA-256 | `431ced6916a2a21a156e38701afe55bbd7f88969fbbfc56d7fe099d47f265460`，上传下载一致 |
| 卫生标准版本 | `27000000-0000-0000-0000-000000000003` |
| 客房主管问题评价 | `0866f439-44ce-4626-9022-0b9ac32d26df` / `FAIL 70` |
| 整改任务 | `5dbdc8ff-55f3-46b4-9251-0305fe17904f` |
| 店总结果评价 | `7b81d4f2-82d1-4d4e-bda6-82dc51998910` / `PASS 100` |
| 最终任务状态 | `COMPLETED / ON_TIME` |

页面：

- [客房主管工作台](uat/evidence/20260717-2317-s21-final/screenshots/tech-v0.2-uat-screen-001-a-housekeeping-supervisor-workbench-20260717t152142z.png)
- [客房主管任务中心](uat/evidence/20260717-2317-s21-final/screenshots/tech-v0.2-uat-screen-003-a-housekeeping-supervisor-tasks-20260717t152145z.png)
- [客房主管标准评价](uat/evidence/20260717-2317-s21-final/screenshots/tech-v0.2-uat-screen-004-a-housekeeping-supervisor-evaluations-20260717t152146z.png)
- [店总验收视图](uat/evidence/20260717-2317-s21-final/screenshots/tech-v0.2-uat-screen-007-a-general-manager-evaluations-20260717t152149z.png)

结果：`PASS`。

边界：当前附件是68字节的1×1 PNG测试样本，只能证明上传、列表、下载、SHA和权限控制，不能证明真实客房照片的人工视觉检查或AI图片判断。

### 2.4 店总驾驶舱

店总身份解析后可见：

| 要求 | 页面呈现 | 结果 |
|---|---|---|
| 今日重点事项 | 风险事项列表与未完成任务汇总共同呈现 | PASS |
| 未完成任务 | 未完成任务汇总及任务入口 | PASS |
| 风险事项 | 开放风险数量及风险事项列表 | PASS |
| 标准异常 | 风险列表包含`STANDARD_EVALUATION`异常 | PASS |

页面：[杭州中心店门店驾驶舱](uat/evidence/20260717-2317-s21-final/screenshots/tech-v0.2-uat-screen-005-a-general-manager-hotel-dashboard-20260717t152147z.png)。

结果：`PASS`。

## 三、三个核心业务场景验收

### 场景A：客房卫生

操作步骤：

1. 客房主管上传PNG附件并读取附件列表。
2. 系统下载附件并核对上传、下载SHA-256一致。
3. 客房主管关联卫生标准，创建`FAIL 70`评价。
4. Outbox投影为管理事件，规则动作创建整改任务。
5. 客房主管确认任务、执行并提交整改证据。
6. 店总创建`PASS 100`结果评价并验收。

数据记录：工作记录`2e000000-0000-0000-0000-000000000001`；附件`c430a0bd-5144-4cea-be63-897aecf8395d`；评价`0866f439-44ce-4626-9022-0b9ac32d26df`；任务`5dbdc8ff-55f3-46b4-9251-0305fe17904f`。

API记录：[场景A完整API目录](uat/evidence/20260717-2317-s21-final/api/flows/A-housekeeping-photo-standard-remediation/)。

页面截图：[客房主管工作台](uat/evidence/20260717-2317-s21-final/screenshots/tech-v0.2-uat-screen-001-a-housekeeping-supervisor-workbench-20260717t152142z.png)、[任务页](uat/evidence/20260717-2317-s21-final/screenshots/tech-v0.2-uat-screen-003-a-housekeeping-supervisor-tasks-20260717t152145z.png)、[店总驾驶舱](uat/evidence/20260717-2317-s21-final/screenshots/tech-v0.2-uat-screen-005-a-general-manager-hotel-dashboard-20260717t152147z.png)。

结果：`PASS`，但真实现场照片人工检查仍为发布门槛。

### 场景B：客户投诉

操作步骤：

1. 前台员工提交客诉工作记录。
2. 系统产生专用事件`COMPLAINTREPORTED`。
3. 前厅主管创建`FAIL 60`标准评价。
4. 系统产生`STANDARDEVALUATIONCOMPLETED`事件。
5. 企业规则判断评价失败，执行`CREATE_TASK`。
6. 前台员工执行整改，前厅主管复评并关闭任务。

数据记录：工作记录`d4a221ad-dbff-4dbb-a271-a312cfd3bc2d`；专用客诉事件`55ed7e7f-f4e5-4cb7-bfaa-d77091daaacb`；评价`be6946aa-25d0-43fe-b8e9-3235ffa9e7ab`；任务`1e22ca80-eb92-4d76-92d7-c3d8bfaf17ad`。

是否有专用业务事件：`是`，事件类型为`COMPLAINTREPORTED`。

说明：专用客诉事件用于表达业务事实；当前整改规则实际监听评价完成事件`STANDARDEVALUATIONCOMPLETED`，根据评价结果确定性创建任务。

API记录：[场景B完整API目录](uat/evidence/20260717-2317-s21-final/api/flows/B-front-complaint-rule-task-closure/)、[规则事件与动作数据库记录](uat/evidence/20260717-2317-s21-final/database/10-rule-events-and-actions.json)。

页面截图：[前台工作台](uat/evidence/20260717-2317-s21-final/screenshots/tech-v0.2-uat-screen-008-b-front-desk-workbench-20260717t152150z.png)、[前厅主管任务](uat/evidence/20260717-2317-s21-final/screenshots/tech-v0.2-uat-screen-013-b-front-supervisor-tasks-20260717t152156z.png)、[前厅主管评价](uat/evidence/20260717-2317-s21-final/screenshots/tech-v0.2-uat-screen-014-b-front-supervisor-evaluations-20260717t152157z.png)。

结果：`PASS`。

### 场景C：工作未完成升级

已验证链路：

```text
工作期望未提交
→ SLA处理服务标记MISSED
→ WORKEXPECTATIONMISSED事件
→ 发送MISSED_WORK_REMINDER
→ 规则创建整改任务
→ 任务标记OVERDUE
→ 升级店助
```

| 记录 | ID / 状态 |
|---|---|
| 工作期望 | `2a500000-0000-0000-0000-000000000005` / `MISSED` |
| 漏交事件 | `9a1a2238-03d6-485a-bb0d-f8f6ad8047b1` / `WORKEXPECTATIONMISSED` |
| 提醒 | `39741ff0-b22a-4376-9eb1-e3e802a5874b` / `MISSED_WORK_REMINDER` |
| 规则任务 | `77e453dd-8ef5-4aaf-94a2-16406c68e012` |
| 最终状态 | `PENDING_ACK / OVERDUE`，时间线含`MARK_OVERDUE`和`ESCALATE` |

是否真实Worker执行：`否`。

本次证据中的检测和升级由技术账号调用：

- `POST /api/v1/work-expectations/sla/process?limit=100`
- `POST /api/v1/tasks/sla/process`

`WORK_EXPECTATION_SLA_SCHEDULER_ENABLED`默认值为`false`，没有证据证明后台Worker按计划自动触发、失败重试、告警和恢复。

API记录：[场景C完整API目录](uat/evidence/20260717-2317-s21-final/api/flows/C-missed-scan-reminder-task-escalation/)、[请求日志](uat/evidence/20260717-2317-s21-final/api/request-log.json)。

页面截图：[客房主管漏交提醒](uat/evidence/20260717-2317-s21-final/screenshots/tech-v0.2-uat-screen-017-c-housekeeping-supervisor-notifications-20260717t152200z.png)、[店助升级通知](uat/evidence/20260717-2317-s21-final/screenshots/tech-v0.2-uat-screen-020-c-assistant-gm-notifications-20260717t152203z.png)。

结果：业务处理链`PASS`；真实Worker执行门槛`FAIL`。该场景不满足正式发布要求。

## 四、六角色UAT

所有账号均成功通过服务端身份解析，`GET /api/v1/iam/me`返回200；但身份入口为UAT开发请求头和页面角色切换，不是生产SSO登录。

| 角色 | 登录/身份 | 可见数据 | 可执行动作 | 权限边界 | 结论 |
|---|---|---|---|---|---|
| 前台员工 | `front.demo`，ACTIVE，身份解析PASS | 本人岗位工作、本人参与任务、评价反馈、通知 | 提交工作、确认任务、提交结果 | 团队工作接口返回403；仅前厅部范围 | 业务权限PASS；正式登录未验收 |
| 前厅主管 | `fo.supervisor`，ACTIVE，身份解析PASS | 前厅部团队工作、任务、评价、通知 | 查看详情、复核、创建/派发/取消任务、验收 | 范围外任职派单403；跨部门附件下载403；2个有效任职验证一人多岗 | 业务权限PASS；正式登录未验收 |
| 客房主管 | `hk.supervisor`，ACTIVE，身份解析PASS | 客房部工作、附件、任务、评价、提醒 | 上传图片、创建评价、执行整改、提交证据 | 组织范围限定客房部 | 业务权限PASS；正式登录未验收 |
| 店助 | `assistant.gm`，ACTIVE，身份解析PASS | 杭州中心店及前厅、客房部门任务和通知 | 跟进任务、查看升级、复核验收 | 数据范围限定杭州中心店组织树 | 业务权限PASS；正式登录未验收 |
| 店总 | `gm.hz`，ACTIVE，身份解析PASS | 门店驾驶舱、经营指标、风险、未完成任务、评价 | 门店复核验收、任务管理、指标录入 | 访问上海门店驾驶舱返回403 | 业务权限PASS；正式登录未验收 |
| 区域/运营管理 | `ota.manager`，真实角色`OTA_OPERATION_MANAGER`，身份解析PASS | 华东区域杭州、上海两店运营视图、规则、任务 | 跨店查看、规则模拟、任务管理 | 访问华南深圳门店返回403；当前没有独立“区域运营”角色编码 | 业务权限PASS；正式登录未验收 |

六角色页面证据：[截图清单](uat/evidence/20260717-2317-s21-final/screenshots/manifest.md)。权限负向证据：[security目录](uat/evidence/20260717-2317-s21-final/api/security/)。

六角色业务权限与数据隔离结论：`PASS`。  
六角色正式登录和业务代表签署结论：`BLOCKED`。

## 五、发布判断

最终选择：

# B：继续修复

TECH-V0.2本次不得正式发布，也不得从Unreleased迁入Released。

必须关闭的发布阻断项：

| 编号 | 阻断项 | 关闭标准 |
|---|---|---|
| REL-P0-01 | 工作未完成链路没有真实后台Worker | 启用受控租户调度；自动触发检测和升级；完成幂等、重试、告警和恢复测试 |
| REL-P0-02 | 六角色正式登录未验收 | 接入目标环境SSO/JWT；六角色分别登录并验证账号生命周期和退出失效 |
| REL-P0-03 | 正式业务签字为空 | 六角色业务代表、产品、QA、CTO和发布负责人完成签字 |
| REL-P0-04 | 真实客房照片与生产附件链未验收 | 使用现场照片完成人工检查；验证对象存储、访问控制、备份和恶意文件扫描 |
| REL-P0-05 | 发布制品不可追溯，当前工作目录不是Git仓库 | 建立受控代码仓库，生成Git提交/标签、后端与前端制品、OpenAPI和数据库迁移清单及SHA-256 |
| REL-P0-06 | 目标环境运行保障未完成 | 完成持久化PostgreSQL部署、备份恢复、监控告警和回滚演练 |

由于选择B：

- 不生成《TECH-V0.2 Release Note》。
- 不宣告TECH-V0.2已发布。
- 不启动或输出Sprint 3实施计划。

> 后续治理说明（2026-07-17）：产品负责人在本报告完成后另行授权输出Sprint 3预实施计划。该授权仅用于技术审查和资源安排，不改变本报告的B结论，不代表TECH-V0.2已发布，也不代表Sprint 3已启动。计划见[SPRINT-3-PLAN.md](SPRINT-3-PLAN.md)。

## 六、下一阶段规划状态

Sprint 3目标“AI进入管理闭环”继续保留在PRODUCT-V1.2和TECH-V0.3候选方向中，包括AI Gateway、工作分析Agent、经营分析Agent、点评分析Agent、AI报告生成和AI任务建议。

但Sprint 3当前状态为：`未启动 / 不具备启动条件`。

下一步只执行Sprint 2发布收口，不增加AI新功能：

1. 补齐真实Worker和运行监控。
2. 建立持久化目标UAT环境并接入正式SSO。
3. 使用真实客房照片完成业务复验。
4. 完成六角色和发布责任人签字。
5. 生成可追溯制品、回滚与恢复证据。
6. 关闭全部REL-P0后重新提交Final UAT，并重新作A/B判断。

## 七、证据总索引

- [Sprint 2.1最终证据](uat/evidence/20260717-2317-s21-final/README.md)
- [API汇总](uat/evidence/20260717-2317-s21-final/api/summary.json)
- [API请求日志](uat/evidence/20260717-2317-s21-final/api/request-log.json)
- [数据库汇总](uat/evidence/20260717-2317-s21-final/database/11-database-summary.json)
- [截图清单](uat/evidence/20260717-2317-s21-final/screenshots/manifest.md)
- [Live UAT测试结果](uat/evidence/20260717-2317-s21-final/test-results/cn.sifangguan.hotelaios.Sprint21LiveUatServerTest.txt)
