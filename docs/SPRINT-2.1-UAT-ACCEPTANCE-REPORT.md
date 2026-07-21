# Hotel AI OS Sprint 2.1 UAT业务验收报告

版本：UAT-V0.2.1  
验收日期：2026-07-17  
最终运行编号：`20260717-2317-s21-final`  
产品基线：PRODUCT-V1.2  
技术候选：TECH-V0.2 / Sprint 2.1  
报告状态：`技术闭环PASS / 正式Final UAT选择B / 继续修复`

> 后续正式发布门槛复核已形成《Hotel AI OS TECH-V0.2 Sprint 2.1 Final UAT Report》，并选择`B——继续修复`。本文继续作为技术闭环证据报告，正式发布判断以`HOTEL-AI-OS-TECH-V0.2-SPRINT-2.1-FINAL-UAT-REPORT.md`为准。

## 一、执行摘要

Sprint 2.1规定的P0修复已在同一批真实HTTP服务、PostgreSQL和六角色账号上完成自动化业务走查：

- 六角色正向业务走查：`PASS`。
- 客房卫生、客诉、工作未完成提醒升级三条流程：`PASS`。
- 权限与非法状态负向验收：`PASS`，6/6按预期拒绝。
- API：83次请求，业务脚本失败0；69次HTTP 200、8次HTTP 201、1次预期HTTP 400、5次预期HTTP 403。
- Correlation ID：83/83存在且唯一。
- 页面：25张真实API页面截图，25张加载检查通过，0张失败。
- 数据库：12份查询结果，覆盖环境、六角色、工作记录、附件、评价、规则、任务、通知和升级。
- Live UAT主机测试：1/1通过，环境已在取证后关闭。

本次自动化证据足以判定“技术闭环UAT通过”，但不满足TECH-V0.2正式发布条件。除十个签字栏和真实客房照片外，正式Final UAT还确认场景C没有真实后台Worker自动执行，因此发布判断选择B。

最终判定：

| 判定项 | 结论 |
|---|---|
| Sprint 2.1技术闭环UAT | PASS |
| 六角色自动化业务走查 | PASS |
| 权限负向验收 | PASS |
| 业务负责人正式签署 | BLOCKED |
| 正式发布判断 | B——继续修复 |
| TECH-V0.2正式发布 | NO-GO，签署与发布门槛未完成 |
| Sprint 3 | BLOCKED，未启动 |

## 二、UAT环境与证据边界

| 项目 | 本次实测 |
|---|---|
| 数据库 | PostgreSQL 14.22，Flyway V1—V13，13次迁移成功 |
| 应用数据库身份 | `hotel_ai_os_app`，非超级用户，`BYPASSRLS=false` |
| RLS | 49张租户业务表启用并强制RLS |
| 后端 | Spring Boot真实HTTP服务，动态回环端口`127.0.0.1:61562` |
| 前端 | React/Vite真实API模式，`VITE_ENABLE_DEMO_FALLBACK=false` |
| API | API-V1；OpenAPI候选`0.2.1-sprint2.1` |
| 身份 | 六个ACTIVE数据库账号；UAT通过tenant/actor开发身份入口，最终角色、权限和范围由服务端数据库解析 |
| 数据范围 | 主租户、华东/华南区域、杭州/上海/深圳门店及隔离范围 |
| 运行结束 | API、Web和嵌入式PostgreSQL均已停止，61562与5173端口关闭 |

环境事实见`database/00-environment.json`。本次为可重复的本地Live UAT，不等同于目标UAT/预生产环境的SSO、持久化数据库、备份恢复、高可用和回滚验收。

证据边界：

- 截图的PASS表示页面使用真实API加载、没有演示回退、没有API错误态；不替代业务人员人工操作签字。
- 场景A使用68字节PNG测试样本，能够证明图片上传、列表、下载、SHA-256一致和越权下载拒绝；不能证明真实客房照片内容质量，也不证明AI视觉判断能力。
- 后端完整回归、前端生产构建和OpenAPI静态核验记录在`docs/TEST-REPORT.md`；它们不是本运行目录内的同批次日志。

## 三、六角色真实业务走查

| 角色 | 账号/真实角色 | 验收动作 | 结论 | 截图 |
|---|---|---|---|---|
| 前台员工 | `front.demo` / `FRONT_DESK` | 查看岗位工作、提交客诉、查看任务与评价反馈 | PASS | 008—011 |
| 前厅主管 | `fo.supervisor` / `FRONT_OFFICE_SUPERVISOR` | 查看团队工作、复核、手工创建整改任务并取消、跟踪与验收 | PASS | 012—014 |
| 客房主管 | `hk.supervisor` / `HOUSEKEEPING_SUPERVISOR` | 图片上传与附件管理、卫生标准评价、整改执行、查看漏交提醒 | PASS | 001—004、015—017 |
| 店助 | `assistant.gm` / `ASSISTANT_GENERAL_MANAGER` | 查看部门执行、跟进逾期任务、查看提醒和升级 | PASS | 018—020 |
| 店总 | `gm.hz` / `GENERAL_MANAGER` | 门店驾驶舱、风险事项、未完成任务、整改验收 | PASS | 005—007 |
| 区域/运营 | `ota.manager` / `OTA_OPERATION_MANAGER` | 承担区域运营职责，查看授权区域多门店、团队、规则和任务 | PASS | 021—025 |

说明：当前没有独立的“区域运营”角色编码；本次由OTA运营经理承担区域运营职责。证据不得将其误写为已实现独立区域运营角色。

六账号均为ACTIVE。前厅主管存在2个有效任职，验证一人多岗模型；其余五个账号各1个有效任职。详见`database/01-six-role-accounts.json`。

前厅主管手工发起整改任务的数据库证据：

- 任务：`d428a216-2cc8-460a-acc9-fe536c35e0cd`。
- 标题：`前厅主管手工发起整改任务（UAT）`。
- 责任人：前台员工任职。
- 验收人：前厅主管任职。
- 最终状态：`CANCELLED`，用于避免污染待办。

## 四、三个业务流程验收

### 场景A：客房卫生问题

```text
客房主管上传图片
→ 关联客房卫生标准
→ 创建FAIL评价
→ 规则创建整改任务
→ 客房主管确认并执行
→ 客房主管提交整改证据
→ 店总创建PASS评价并验收
→ COMPLETED / ON_TIME
```

| 关键证据 | 实测值 |
|---|---|
| 工作记录 | `2e000000-0000-0000-0000-000000000001` |
| 附件 | `c430a0bd-5144-4cea-be63-897aecf8395d`，PNG，68字节，`CLEAN` |
| 上传/下载SHA-256 | `431ced6916a2a21a156e38701afe55bbd7f88969fbbfc56d7fe099d47f265460`，一致 |
| 初次评价 | 客房主管账号创建，`0866f439-44ce-4626-9022-0b9ac32d26df`，`FAIL / 70` |
| 规则任务 | `5dbdc8ff-55f3-46b4-9251-0305fe17904f` |
| 结果评价 | 店总账号创建，`PASS / 100` |
| 执行/验收 | 客房主管执行，店总验收，任职分离 |
| 最终状态 | `COMPLETED / ON_TIME` |

结论：流程与数据落库`PASS`。现场真实客房照片的人工视觉判断仍需业务代表补测并签字。

### 场景B：客诉问题

```text
前台员工提交客诉
→ 创建FAIL标准评价
→ 规则触发并生成任务
→ 前台员工执行并提交结果
→ 前厅主管复核评价与验收
→ COMPLETED / ON_TIME
```

| 关键证据 | 实测值 |
|---|---|
| 客诉记录 | `d4a221ad-dbff-4dbb-a271-a312cfd3bc2d` |
| 初次评价 | `FAIL / 60` |
| 规则任务 | `1e22ca80-eb92-4d76-92d7-c3d8bfaf17ad` |
| 结果评价 | `PASS / 100` |
| 执行/验收 | 前台员工执行，前厅主管复核并验收 |
| 最终状态 | `COMPLETED / ON_TIME` |

结论：`PASS`。工作记录、评价、事件、规则动作、任务迁移和验收记录可追溯。

### 场景C：工作未完成提醒升级

```text
岗位工作未提交
→ SLA扫描标记MISSED
→ 生成WORKEXPECTATIONMISSED事件
→ 发送漏交提醒
→ 规则创建整改任务
→ 任务到期标记OVERDUE
→ 升级店助
→ 保持PENDING_ACK等待责任人处理
```

| 关键证据 | 实测值 |
|---|---|
| 工作期望 | `2a500000-0000-0000-0000-000000000005` |
| 工作期望状态 | `MISSED` |
| 整改任务 | `77e453dd-8ef5-4aaf-94a2-16406c68e012` |
| 提醒 | `MISSED_WORK_REMINDER` |
| 升级对象 | 店助任职`19200000-0000-0000-0000-000000000008` |
| 时间线 | 包含`MARK_OVERDUE`和`ESCALATE` |
| 最终状态 | `PENDING_ACK / OVERDUE` |

结论：`PASS`。本场景目标是验证“漏交→提醒→逾期→升级”，因此任务有意保留待确认，不按未关闭缺陷处理。0小时升级延迟仅用于UAT时间加速。

## 五、API与权限验收

### 5.1 请求统计

| 指标 | 结果 |
|---|---|
| 总请求 | 83 |
| 正向2xx | 77（69个200、8个201） |
| 预期拒绝 | 6（1个400、5个403） |
| 非预期失败 | 0 |
| 六角色资源探测 | 34 |
| Correlation ID | 83/83存在且唯一 |

### 5.2 负向权限与约束用例

| 用例 | 预期/实测 | 结论 |
|---|---|---|
| 前台员工访问团队工作 | 403 / 403 | PASS |
| 店总访问跨门店驾驶舱 | 403 / 403 | PASS |
| OTA运营经理访问跨区域门店 | 403 / 403 | PASS |
| 前厅主管向范围外任职指派任务 | 403 / 403 | PASS |
| 任务责任人与验收人为同一任职 | 400 / 400 | PASS |
| 跨部门下载客房附件 | 403 / 403 | PASS |

负向证据位于`api/security/`。正向API、角色探测和三场景请求见`api/request-log.json`、`api/roles/`和`api/flows/`。

## 六、数据库验收

| 数据断言 | 实测结果 |
|---|---|
| 六角色ACTIVE账号 | 6 |
| 前厅主管有效任职 | 2，验证一人多岗 |
| 客房卫生附件 | 1 |
| 已完成标准评价 | 4 |
| UAT任务 | 5 |
| 已完成任务 | 2（场景A、B） |
| 已取消任务 | 1（前厅主管手工任务） |
| 前厅主管手工任务 | 1 |
| 升级迁移 | 2（区域OTA基线1、场景C 1） |
| 工作漏交提醒 | 1 |

12份数据库文件依次覆盖环境、账号、工作记录与附件、评价、任务、时间线、任务证据、漏交期望、通知、升级、规则事件/动作及汇总。

## 七、页面与截图验收

- 截图总数：25；加载检查通过25，失败0。
- 场景分布：A 7张、B 7张、C 6张、SCOPE 5张。
- 角色分布：前台4、前厅主管3、客房主管7、店助3、店总3、区域/运营5。
- 页面均使用真实API；未显示演示回退或API错误态。

代表性截图：

- 客房主管工作台：`tech-v0.2-uat-screen-001-a-housekeeping-supervisor-workbench-20260717t152142z.png`
- 店总门店驾驶舱：`tech-v0.2-uat-screen-005-a-general-manager-hotel-dashboard-20260717t152147z.png`
- 前厅主管团队工作：`tech-v0.2-uat-screen-012-b-front-supervisor-team-work-20260717t152154z.png`
- 店助升级通知：`tech-v0.2-uat-screen-020-c-assistant-gm-notifications-20260717t152203z.png`
- 区域多门店驾驶舱：`tech-v0.2-uat-screen-022-scope-regional-operations-operations-dashboard-20260717t152205z.png`

截图清单见`screenshots/manifest.md`和`screenshots/manifest.json`。

## 八、当前发现问题与限制

| 编号 | 级别 | 状态 | 说明 |
|---|---|---|---|
| UAT-2.1-01 | 发布门槛 | BLOCKED | 业务代表、产品、QA、CTO和发布负责人尚未签字 |
| UAT-2.1-02 | 业务补测 | BLOCKED | 需使用真实客房现场照片完成人工视觉检查；当前样本仅验证图片链路 |
| UAT-2.1-03 | 发布门槛 | BLOCKED | 尚缺Git提交/标签、前后端制品SHA-256和可追溯制品清单 |
| UAT-2.1-04 | 环境门槛 | BLOCKED | 目标环境SSO、持久化PostgreSQL、对象存储、安全扫描、备份恢复和回滚未验收 |
| UAT-2.1-05 | 运维门槛 | BLOCKED | 生产SLA调度租户白名单、告警和重跑机制未验收 |
| UAT-2.1-06 | 角色边界 | OPEN | 当前由OTA运营经理承担区域运营职责；如需独立角色，须另行立项而非在本修复迭代内暗增 |

非P0技术债务：完整JSON Schema验证、工作记录命令全链路幂等、工作包完整Web编辑器，以及版本/状态校验统一返回HTTP 400而非409。

## 九、发布建议

建议状态更新为：`B——继续修复`。

发布前必须：

1. 由六角色业务代表完成现场操作复核，补测真实客房照片并签字。
2. 产品、QA、CTO和发布负责人审核本报告及证据并签字。
3. 生成Git提交/标签、前后端制品及SHA-256清单。
4. 在目标环境完成SSO、持久化数据库、对象存储、安全扫描、调度告警、备份恢复和回滚演练。
5. 上述门槛全部关闭后，才能把TECH-V0.2从Unreleased迁入Released。

在收到单独启动指令前，Sprint 3不得开始。

## 十、签字

| 责任 | 姓名 | 结论 | 日期 |
|---|---|---|---|
| 前台员工业务代表 |  |  |  |
| 前厅主管业务代表 |  |  |  |
| 客房主管业务代表 |  |  |  |
| 店助业务代表 |  |  |  |
| 店总业务代表 |  |  |  |
| 区域/运营业务代表 |  |  |  |
| 产品负责人 |  |  |  |
| QA负责人 |  |  |  |
| CTO / 技术负责人 |  |  |  |
| 发布负责人 |  |  |  |

## 十一、证据索引

- 总索引：`docs/uat/evidence/20260717-2317-s21-final/README.md`
- 测试数据核验：`docs/uat/evidence/20260717-2317-s21-final/FIXTURE-VERIFICATION.md`
- API汇总：`docs/uat/evidence/20260717-2317-s21-final/api/summary.json`
- API请求日志：`docs/uat/evidence/20260717-2317-s21-final/api/request-log.json`
- 权限负向证据：`docs/uat/evidence/20260717-2317-s21-final/api/security/`
- 六角色API：`docs/uat/evidence/20260717-2317-s21-final/api/roles/`
- 客房主管评价创建：`docs/uat/evidence/20260717-2317-s21-final/api/roles/housekeeping-supervisor/hygiene-standard-evaluation-created.json`
- 场景A：`docs/uat/evidence/20260717-2317-s21-final/api/flows/A-housekeeping-photo-standard-remediation/`
- 场景B：`docs/uat/evidence/20260717-2317-s21-final/api/flows/B-front-complaint-rule-task-closure/`
- 场景C：`docs/uat/evidence/20260717-2317-s21-final/api/flows/C-missed-scan-reminder-task-escalation/`
- 数据库环境：`docs/uat/evidence/20260717-2317-s21-final/database/00-environment.json`
- 数据库汇总：`docs/uat/evidence/20260717-2317-s21-final/database/11-database-summary.json`
- 截图清单：`docs/uat/evidence/20260717-2317-s21-final/screenshots/manifest.md`
- Live UAT测试结果：`docs/uat/evidence/20260717-2317-s21-final/test-results/cn.sifangguan.hotelaios.Sprint21LiveUatServerTest.txt`
- OpenAPI契约：`docs/openapi.yaml`
