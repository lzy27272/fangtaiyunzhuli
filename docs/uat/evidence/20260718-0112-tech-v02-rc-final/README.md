# TECH-V0.2 Release Candidate Final Evidence

Run ID: `20260718-0112-tech-v02-rc-final`  
Evidence type: local Release Candidate UAT  
Execution window: 2026-07-18 01:12–01:17 (Asia/Shanghai)  
Candidate: `TECH-V0.2-rc.1-local` / `DB-V13` / `/api/v1` / OpenAPI `0.2.1-sprint2.1`

## Conclusion

The local technical UAT passed the six-role probes, the three management-loop scenarios, database isolation checks, browser evidence capture and build-1 artifact integrity verification. This directory supports a local RC decision only. It does not prove that TECH-V0.2 is formally Released, and it does not authorize Sprint 3 while the external release gates below remain open.

## Environment boundary

- API: local Spring Boot process at `http://127.0.0.1:62509`.
- Database: embedded PostgreSQL 14.22 with a real non-superuser runtime role.
- Authentication: locally signed RS256 Bearer JWT through a mock OIDC issuer at `http://127.0.0.1:18081`; development-header authentication was disabled.
- Worker: scheduled management automation enabled; no manual SLA-processing or outbox-recovery API call was used by the UAT runner.
- Attachment scan: local ClamAV 1.5.3 with signed CVD database and fail-closed behavior.
- Browser: Microsoft Edge driven by the Playwright fallback because the Browser plugin was unavailable.
- Secrets: the evidence directory contains no persisted Bearer token; copied runtime files passed a token/password-pattern scan.

## Result metrics

| Area | Result | Evidence |
|---|---:|---|
| Formal role accounts | 6 | `api/summary.json`, `database/01-six-role-accounts.json` |
| Role API probes | 34 | `api/summary.json`, `api/roles/` |
| API requests | 89 | 0 unexpected failures; 16 expected denials (10 authentication, 6 business permission) |
| Management-loop scenarios | 3 | A hygiene remediation completed; B complaint closure completed; C missed-work reminder reached `PENDING_ACK` and `OVERDUE` after escalation |
| Browser cases | 25/25 PASS | 25 PNG files; 0 console errors and 0 console warnings |
| Database migrations | 13/13, latest V13 | PostgreSQL 14.22; 49 tables with forced RLS |
| Runtime database role | PASS | `rolsuper=false`, `rolbypassrls=false` |
| Business records | 6 role accounts, 1 hygiene attachment, 4 completed evaluations, 5 UAT tasks | 2 completed UAT tasks, 1 cancelled task, 2 escalation transitions, 1 missed-work reminder |
| Scheduled automation | PASS in scenario execution | 0 manual SLA process calls; 0 manual outbox recovery calls |
| Build-1 artifacts | 5/5 PASS | Payload fingerprint `1652df5d4e3e1beb0418765584468cc849b80c1913286ad910fad64164a8d98c` |
| Reproducible payload | PASS locally | build-1 and build-2 payload fingerprints are identical |
| Full backend regression | 37 tests | 0 failures, 0 errors, 2 intentionally skipped opt-in tests; `BUILD SUCCESS` at 2026-07-18 01:24:12 +08:00 |
| Live UAT JUnit wrapper | 1/1 PASS | `runtime/core-api.stdout.log` contains the Surefire summary and `BUILD SUCCESS` |
| Local database recovery drill | PASS | 1,253-file cold backup; restored V13/49 forced-RLS state; post-backup rows rolled back to 0 |

Scenario C intentionally stops after the reminder and overdue escalation are observable; its expected acceptance state is not task completion.

## Directory map

- `api/`: health response, signed-JWT authentication probes, role probes, security denials and scenarios A/B/C request evidence.
- `database/`: PostgreSQL environment, six-role accounts, work records, attachment, evaluations, tasks, timeline, notifications, escalation and rule-action snapshots.
- `screenshots/`: 25 six-role/business-flow PNGs and capture manifests.
- `runtime/`: copied final process state plus API, OIDC and Web stdout/stderr logs. Source files under `docs/uat/evidence/runtime` were preserved.
- `regression/`: 16 Surefire XML files, 16 Surefire text reports, the local database recovery-drill result and the build-1 artifact validation result.

## Regression evidence

The backend suite was rerun and sealed after artifact construction. The 16 XML reports aggregate to 37 tests, 0 failures, 0 errors and 2 skipped tests. The skipped cases are the explicit opt-in `PostgresBackupRestoreRollbackIntegrationTest` and `Sprint21LiveUatServerTest`; they are not silent omissions:

- The live-UAT wrapper ran separately and passed, with its full runtime output retained in `runtime/core-api.stdout.log`.
- The database recovery drill ran separately and passed; `regression/database-recovery-drill.json` records the cold-backup fingerprint, V13 restore checks and point-in-time rollback result.

`regression/release-artifact-validation.json` records the independent build-1 size/SHA-256 validation, in which all five artifacts passed.

## Runtime log notes

- `runtime/web.stderr.log` records a second preview-launch attempt failing because port 5173 was already occupied. The already-running Web server served all 25 successful browser captures; this log is retained rather than hidden.
- After the UAT flow and screenshots completed, `runtime/core-api.stdout.log` records scheduled-worker database I/O errors while the embedded PostgreSQL test fixture was shutting down. The JUnit wrapper subsequently finished with 0 failures and `BUILD SUCCESS`. A persistent target environment must still prove clean worker shutdown and operational alert handling.
- `screenshots/manifest.json` was revalidated with Node.js after evidence sealing: it parses successfully, contains 25 cases, and retains readable Chinese scenario labels. The 25 PNGs and `screenshots/manifest.md` remain the human-readable companion evidence.

## External release gates not proven here

1. Real business UAT signatures from the six operational roles, product owner, security and operations are not included.
2. The hygiene attachment is a 68-byte technical PNG, not a real on-site guest-room inspection photo; real-photo review and human acceptance remain required.
3. The mock local OIDC issuer does not replace enterprise SSO/IdP integration, key rotation, account lifecycle and security approval.
4. The successful embedded PostgreSQL 14.22 recovery drill does not replace the persistent target environment. Target-version migration, encrypted backup retention, restore/rollback rehearsal, monitoring and operator approval remain required; the local drill also reports `dataChecksums=off`.
5. Local file/object storage and local malware scanning do not prove production object-store durability, access policy, retention, quarantine and scanning operations.
6. The artifact manifest has no source commit (`source.commit=null`) and no immutable Git release tag/SHA. Formal source-to-binary traceability is therefore not established.
Until these external gates are closed, the supported governance decision is **TECH-V0.2 RC technical evidence PASS, formal release BLOCKED**.
