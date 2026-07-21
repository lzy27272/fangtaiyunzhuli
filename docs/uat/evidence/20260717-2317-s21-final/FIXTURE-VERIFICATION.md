# Sprint 2.1 UAT测试数据核验索引

本文件是对同一运行批次原始API与数据库证据的导航，不是新增或改写的数据库事实。

| 必备测试数据 | 核验结果 | 原始证据 |
|---|---|---|
| PostgreSQL UAT数据库 | PostgreSQL 14.22；Flyway V1—V13；运行账号非超级用户且不可绕过RLS | `database/00-environment.json` |
| 六角色真实账号 | 6个ACTIVE账号；前厅主管2个有效任职，其余各1个 | `database/01-six-role-accounts.json` |
| 测试门店 | 区域视图返回杭州中心店、上海滨江店；华南深圳门店跨区域访问返回403 | `api/roles/regional-operations/dashboards-operations.json`、`api/security/03-regional-role-cross-region-hotel-denied.json` |
| 测试工作包 | 前台账号返回`WP-UAT-FRONT-SHIFT`、版本1、工作项`FRONT_COMPLAINT`；客房工作记录关联客房工作包条目 | `api/roles/front-desk/my-work-expectations.json`、`database/02-work-records-and-attachments.json` |
| 测试标准 | 客房卫生、前台客诉评价均关联发布标准版本；A、B各有FAIL与PASS评价 | `database/03-standard-evaluations.json` |
| 客房主管评价能力 | 客房主管账号创建客房卫生`FAIL`标准评价，HTTP 201 | `api/summary.json`、`api/roles/housekeeping-supervisor/hygiene-standard-evaluation-created.json`、`api/request-log.json` |
| 测试规则 | 4条ACTIVE/PUBLISHED规则：OTA风险、客房卫生失败、前台客诉、岗位漏交 | `api/roles/regional-operations/rules.json` |
| 规则执行数据 | 评价与漏交事件被规则消费并形成动作、任务和通知 | `database/10-rule-events-and-actions.json` |
| 测试工作记录 | 客房巡检、前台客诉各1条SUBMITTED记录 | `database/02-work-records-and-attachments.json` |
| 测试任务 | 5条UAT任务，含A、B、C、区域OTA基线及前厅主管手工任务 | `database/04-management-tasks.json` |

结论：Sprint 2.1要求的数据库、账号、门店、工作包、标准、规则及客房主管评价能力均有原始证据可追溯。

