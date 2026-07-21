# TECH-V0.2 RC2 Identity-Lifecycle UAT Evidence

Run ID: `20260718-0154-tech-v02-rc2`  
Date: 2026-07-18 (Asia/Shanghai)  
Candidate: `TECH-V0.2-rc.2-local`  
Scope: signed-JWT six-role/API/three-loop regression after identity lifecycle correction  
Status: `LOCAL TECHNICAL PASS / FORMAL RELEASE BLOCKED`

## Why this run exists

After RC Final, the identity lifecycle audit found that an employee account with no current active position assignment could retain role grants while using an otherwise valid JWT. The server now rejects that identity immediately. This run proves the correction did not break the six roles, one-person-many-positions or the three Sprint 2 management loops.

## Results

- Full backend suite: 41 tests, 0 failures, 0 errors, 2 opt-in tests skipped in the normal suite.
- Identity lifecycle suite: 4/4 PASS.
- Six formal role probes: PASS; 34 role-resource probes completed.
- Authentication negative probes: 10 expected HTTP 401 responses.
- Business permission denials: 6/6 expected denials.
- API requests: 89; unexpected failures: 0.
- Scenario A housekeeping remediation: `COMPLETED`.
- Scenario B complaint closure: `COMPLETED`.
- Scenario C missed work: reminder created, task `OVERDUE`, escalation recorded.
- Worker mode: `scheduled-worker`; manual SLA processing calls: 0; manual Outbox recovery calls: 0.
- PostgreSQL: 14.22; Flyway V13; non-superuser runtime account; 49 forced-RLS tables.
- RC2 reproducible build: two payloads matched; fingerprint `daf7a779fca869ee0208c7ae4588aff3d3f111ee1732f6ff5477612d42a1f1bb`.
- RC2 artifact validation: 5/5 size and SHA-256 checks PASS.

## Evidence map

- `api/summary.json`: aggregate authentication, authorization, worker and scenario result.
- `api/authentication/`, `api/security/`, `api/roles/`: signed-JWT and scope evidence.
- `api/flows/`: scenarios A, B and C.
- `database/`: environment, accounts, assignments, attachment, evaluation, task, event and escalation snapshots.
- `regression/`: 17 Surefire XML plus 17 text reports and RC2 artifact validation.
- `runtime/`: final process state and API/OIDC logs; Bearer tokens are not retained.
- Prior unchanged Web UI evidence remains at `../20260718-0112-tech-v02-rc-final/screenshots/` (25/25 PASS). This RC2 run intentionally used `-SkipWeb` because the production change is limited to server-side identity resolution.

## Photo boundary

Scenario A used the 68-byte technical fixture and records `sourceType=TECHNICAL_FIXTURE`, `fieldMetadataComplete=false`. It proves upload/scanning/SHA/authorization/workflow regression only. It does not close the real on-site photo or target object-storage gate.

## Release boundary

The local Git repository has no first commit or RC tag, so both RC2 manifests retain `source.commit=null`. Target enterprise SSO, human signatures, real on-site photo/target attachment chain and persistent target operations evidence are also absent. TECH-V0.2 therefore remains Unreleased and Sprint 3 remains not started.
