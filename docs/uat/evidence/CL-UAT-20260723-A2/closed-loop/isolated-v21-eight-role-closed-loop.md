# V21-ISOLATED-EIGHT-ROLE-CAPABILITY-MATRIX

- RunId: `CL-UAT-20260723-A2`
- Result: **BLOCKED**
- Target: `http://127.0.0.1:57864/api/v1`
- Database: `embedded PostgreSQL (real non-superuser runtime role)`
- Credentials persisted: **NO**

| Role | Identity | Daily report | Task |
|---|---:|---:|---:|
| front-desk | PASS | BLOCKED | PASS |
| front-supervisor | PASS | BLOCKED | PASS |
| housekeeping-supervisor | PASS | BLOCKED | PASS |
| assistant-gm | PASS | BLOCKED | PASS |
| general-manager | PASS | BLOCKED | SKIPPED |
| ota-assistant | PASS | SKIPPED | BLOCKED |
| ota-manager | PASS | SKIPPED | SKIPPED |
| ceo | PASS | SKIPPED | SKIPPED |

## Capability coverage

- templatePublicationMakerChecker: **BLOCKED**
- hotelRoleDailyReportSubmission: **BLOCKED**
- manualTaskLifecycle: **BLOCKED**
- dailyOperationAggregationAndSourceReferences: **NOT_TESTED**
- aiRecommendationAnalysis: **NOT_TESTED**
- supervisorConfirmationToTaskCandidate: **NOT_TESTED**
- slaOverdueEscalationNotifications: **NOT_TESTED**
- operationSnapshotAndExport: **NOT_TESTED**
- auditLogTableVerification: **NOT_TESTED_NO_API**
- fullDailyOperationsClosedLoop: **NOT_TESTED**

- Limitation: This is a capability matrix, not a PASS claim for the full daily-operations main closed loop.
- Limitation: CEO-created manual tasks do not prove AI recommendation, supervisor confirmation, or task-candidate promotion.
- Limitation: Task timeline evidence is not direct audit_log table verification.
- Limitation: SLA overdue escalation, operation snapshot, and export are outside this run.

## Blockers

- **DAILY_REPORT_TEMPLATE_MAKER_CHECKER_GAP**: A new template cannot be safely published: the isolated role set has fewer than two distinct actors with review and publish permission. (front-desk, front-supervisor, housekeeping-supervisor, assistant-gm, general-manager)
- **MISSING_PUBLISHED_DAILY_REPORT_TEMPLATE**: A hotel role has no published daily-report template. (front-desk)
- **TASK_TARGET_NOT_VISIBLE**: A planned assignee is not visible to the governance creator. (ota-assistant)

## Evidence boundary

- The run is allowed only against a loopback API whose active state declares `purpose=ISOLATED_UAT` and a disposable database marker.
- CEO and regional OTA identities are not given fabricated hotel assignments.
- Tokens, passwords and authorization headers are never written to this report.
- Generated artifacts remain in the disposable database; reset or destroy it after review.
