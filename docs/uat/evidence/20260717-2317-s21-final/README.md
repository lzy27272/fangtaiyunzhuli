# Sprint 2.1最终UAT证据索引

运行编号：`20260717-2317-s21-final`  
运行时间：2026-07-17 23:17—23:22（Asia/Shanghai）  
结论：`技术闭环PASS / 正式Final UAT选择B / 继续修复`

正式发布判断：[Hotel AI OS TECH-V0.2 Sprint 2.1 Final UAT Report](../../../HOTEL-AI-OS-TECH-V0.2-SPRINT-2.1-FINAL-UAT-REPORT.md)

## 汇总

- 真实API请求：83；非预期失败0。
- 正向响应：77；预期拒绝：6（1个400、5个403）。
- Correlation ID：83/83存在且唯一。
- 六角色资源探测：34；另有前厅主管手工任务创建、取消证据2份。
- 客房主管标准评价创建：1次，HTTP 201，`FAIL`评价。
- 强制业务流程：3。
- 页面截图：25，加载检查失败0，25张图片哈希均不重复。
- 数据库导出：12份。
- 原始API、数据库、截图和Live UAT测试结果：122个文件；加本索引和测试数据核验索引后共124个文件。

## 测试数据

- [UAT数据库、账号、门店、工作包、标准与规则核验索引](FIXTURE-VERIFICATION.md)

## Live UAT测试结果

- [Surefire文本结果](test-results/cn.sifangguan.hotelaios.Sprint21LiveUatServerTest.txt)

## API

- [API汇总](api/summary.json)
- [请求、预期状态与Correlation ID日志](api/request-log.json)
- [六角色API记录](api/roles/)
- [客房主管创建标准评价](api/roles/housekeeping-supervisor/hygiene-standard-evaluation-created.json)
- [权限与非法状态负向证据](api/security/)
- [场景A：客房卫生图片整改](api/flows/A-housekeeping-photo-standard-remediation/)
- [场景B：前台客诉闭环](api/flows/B-front-complaint-rule-task-closure/)
- [场景C：漏交提醒与逾期升级](api/flows/C-missed-scan-reminder-task-escalation/)

## 数据库

- [环境、PostgreSQL、迁移与RLS事实](database/00-environment.json)
- [六角色账号及一人多岗](database/01-six-role-accounts.json)
- [工作记录与附件](database/02-work-records-and-attachments.json)
- [标准评价](database/03-standard-evaluations.json)
- [管理任务](database/04-management-tasks.json)
- [任务时间线](database/05-task-timeline.json)
- [任务证据](database/06-task-evidence.json)
- [漏交工作期望](database/07-missed-expectation.json)
- [提醒通知](database/08-notifications.json)
- [任务升级](database/09-task-escalations.json)
- [规则事件与动作](database/10-rule-events-and-actions.json)
- [数据库汇总](database/11-database-summary.json)

## 页面截图

- [截图清单](screenshots/manifest.md)
- [机器可读截图清单](screenshots/manifest.json)

截图目录含25张页面图片。API场景A目录另含1张上传后再下载的PNG，用于图片链路和SHA-256一致性验证。

## 判定边界

- 场景A由客房主管创建初次`FAIL`评价、执行整改；店总创建任务结果`PASS`评价并验收，最终`COMPLETED / ON_TIME`。
- 场景B最终为`COMPLETED / ON_TIME`。
- 场景C最终为`PENDING_ACK / OVERDUE`，时间线含`MARK_OVERDUE`与`ESCALATE`；这是验证升级后有意保留的状态。
- 场景C由UAT脚本调用SLA处理接口，不是真实后台Worker自动执行；该发布门槛为FAIL。
- 6个负向用例均返回预期400或403，不计为失败。
- 页面截图PASS只证明真实API加载、无演示回退、无API错误态，不替代人工操作签字。
- 场景A的68字节PNG只证明上传、列表、下载、SHA和访问控制，不证明真实客房照片内容或AI视觉判断。
- `regional-operations`页面身份的真实角色是`OTA_OPERATION_MANAGER`，由其承担区域运营职责。
- 正式登录、业务签字、真实照片、制品追溯和目标环境发布门槛尚未完成，因此TECH-V0.2不得标记为已发布。
