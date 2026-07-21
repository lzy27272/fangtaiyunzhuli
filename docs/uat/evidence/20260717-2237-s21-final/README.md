# Sprint 2.1最终UAT证据索引

运行编号：`20260717-2237-s21-final`  
运行时间：2026-07-17 22:37（Asia/Shanghai）  
结论：`PASS`

## 汇总

- 真实API请求：75，失败0。
- 六角色资源探测：34。
- 强制业务流程：3。
- 页面截图：25，失败0。
- 数据库导出：11份。
- 证据文件总数：99（新增本索引前）。

## API

- [API汇总](api/summary.json)
- [请求与Correlation ID日志](api/request-log.json)
- [六角色API记录](api/roles/)
- [场景A：客房卫生图片整改](api/flows/A-housekeeping-photo-standard-remediation/)
- [场景B：前台客诉闭环](api/flows/B-front-complaint-rule-task-closure/)
- [场景C：漏交提醒与逾期升级](api/flows/C-missed-scan-reminder-task-escalation/)

## 数据库

- [数据库汇总](database/11-database-summary.json)
- [六角色账号](database/01-six-role-accounts.json)
- [工作记录与附件](database/02-work-records-and-attachments.json)
- [标准评价](database/03-standard-evaluations.json)
- [管理任务](database/04-management-tasks.json)
- [任务时间线](database/05-task-timeline.json)
- [漏交工作期望](database/07-missed-expectation.json)
- [提醒通知](database/08-notifications.json)
- [任务升级](database/09-task-escalations.json)
- [规则事件与动作](database/10-rule-events-and-actions.json)

## 页面截图

- [截图清单](screenshots/manifest.md)
- [机器可读截图清单](screenshots/manifest.json)

截图目录包含25张页面图片；API场景A目录另含1张上传后再下载的PNG，用于SHA-256一致性验证。

## 判定说明

- 场景A和B最终状态为`COMPLETED`。
- 场景C最终状态为`PENDING_ACK / OVERDUE`，且时间线包含`MARK_OVERDUE`和`ESCALATE`；这是验证提醒升级动作后的预期停留状态。
- 本证据由真实HTTP应用、PostgreSQL及非超级运行账号产生；未使用前端演示回退。

