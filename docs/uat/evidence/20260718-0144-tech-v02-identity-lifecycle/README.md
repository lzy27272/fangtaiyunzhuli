# TECH-V0.2 Identity Lifecycle Closure Evidence

Run ID: `20260718-0144-tech-v02-identity-lifecycle`  
Date: 2026-07-18 (Asia/Shanghai)  
Scope: local signed-JWT identity lifecycle regression after RC Final  
Release impact: local technical evidence only; does not close target enterprise SSO or authorize release

## Result

- Full backend suite: 41 tests, 0 failures, 0 errors, 2 skipped, `BUILD SUCCESS`.
- New suite: `SignedJwtIdentityLifecycleIntegrationTest`, 4/4 PASS.
- A still-valid RS256 JWT is rejected with HTTP 401 immediately after the Hotel AI OS account becomes inactive.
- A still-valid RS256 JWT is rejected with HTTP 401 immediately after an employee loses the last current active position assignment.
- One-person-many-positions remains valid when another current assignment still exists; `/iam/me` returns only the remaining assignment.
- A tenant-level account without an employee record remains valid, preserving the non-employee service/tenant-account boundary.

## Production correction

`EffectiveIdentityService` now rejects an account that is linked to an employee but has no current active position assignment. It does not reject tenant-level accounts that intentionally have no employee row, and it preserves one-person-many-positions behavior.

## Evidence

- `regression/TEST-cn.sifangguan.hotelaios.shared.security.SignedJwtIdentityLifecycleIntegrationTest.xml`
- `regression/cn.sifangguan.hotelaios.shared.security.SignedJwtIdentityLifecycleIntegrationTest.txt`
- All 17 Surefire XML reports and 17 text reports are retained under `regression/`.

## Boundary

This run uses a local ephemeral RS256 issuer. It proves server-side account and assignment lifecycle enforcement against a still-valid signed token; it does not prove enterprise IdP disablement, logout, revocation, key rotation, six real target accounts or target-environment security approval. REL-P0-02 therefore remains `BLOCKED` until `docs/releases/TECH-V0.2-TARGET-SSO-ACCEPTANCE.md` is completed and signed.
