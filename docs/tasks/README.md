# 在研任务台账

本目录用于保存尚处于沟通、设计或待批准阶段的长期任务，避免临时对话结束后丢失上下文。

| 任务编号 | 任务名称 | 状态 | 当前节点 | 入口 |
|---|---|---|---|---|
| OTA-AUTOMATION-V0.1 | OTA自动化房态对账与小时经营简报 | SPRINT 2D OFFLINE REHEARSAL COMPLETE / I1 LICENSE EVIDENCE MISSING / REAL PMS AUTHORIZATION BLOCKED / REAL CONNECTORS BLOCKED / PRODUCTION NO-GO | 独立后台已具备可持久化、刷新恢复、确认、取消和重新演练的离线人工授权流程；授权状态始终为AUTH_REQUIRED，浏览器、SecretStore、真实登录、网络抓取和企微发送仍BLOCKED | [业务设计](./OTA-AUTOMATION-V0.1-DESIGN-DISCUSSION.md) · [技术设计](./OTA-AUTOMATION-V0.1-TECH-DESIGN.md) · [编码就绪报告](./OTA-AUTOMATION-V0.1-CODING-READINESS.md) · [Sprint 2D离线授权演练报告](./OTA-AUTOMATION-V0.1-SPRINT-2D-OFFLINE-AUTHORIZATION-REHEARSAL-IMPLEMENTATION-REPORT.md) · [浏览器会话骨架实施报告](./OTA-AUTOMATION-V0.1-BROWSER-SESSION-SKELETON-IMPLEMENTATION-REPORT.md) · [受控外部接入工作包](./OTA-AUTOMATION-V0.1-CONTROLLED-EXTERNAL-INTAKE-WORK-PACKAGE.md) · [首个接入实例](./ota-controlled-external-intake/intakes/pilot-01-bieyanghong-pms/README.md) · [受控登录清单](./ota-controlled-external-intake/intakes/pilot-01-bieyanghong-pms/CONTROLLED-LOGIN-RUNBOOK.md) · [接入资料模板](./ota-controlled-external-intake/README.md) · [Sprint 0实施报告](./OTA-AUTOMATION-V0.1-SPRINT-0-IMPLEMENTATION-REPORT.md) · [Sprint 1实施报告](./OTA-AUTOMATION-V0.1-SPRINT-1-IMPLEMENTATION-REPORT.md) · [Sprint 2A实施报告](./OTA-AUTOMATION-V0.1-SPRINT-2A-IMPLEMENTATION-REPORT.md) · [Sprint 2B实施报告](./OTA-AUTOMATION-V0.1-SPRINT-2B-IMPLEMENTATION-REPORT.md) · [Sprint 2C实施报告](./OTA-AUTOMATION-V0.1-SPRINT-2C-IMPLEMENTATION-REPORT.md) · [本地认证ADR](./OTA-AUTOMATION-V0.1-ADR-001-LOCAL-AUTH.md) |

## 维护规则

1. 每确认一个业务或技术板块，立即更新对应任务文档的“已确认决策”和“对话同步记录”。
2. 未经明确开工批准，任务只能标记为“需求沟通中”“设计已冻结”或“待开发”，不得写成已实现。
3. 开始编码后，再按项目治理要求同步 `CHANGELOG.md`、技术版本、数据库/API版本及测试证据。
4. 任务涉及账号、Cookie、Token、Webhook或密码时，只记录凭证位置和状态，不记录秘密值。
