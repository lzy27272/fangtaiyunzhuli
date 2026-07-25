# OTA Standalone API

Independent control-plane API for `OTA-AUTOMATION-V0.1`. It provides
local authentication, tenant/hotel and simulation-connector configuration,
physical inventory-pool/product mapping, targets/pace curves, database-backed
dynamic collection schedules, four deterministic simulation scenarios and
typed monitoring/history read models. Sprint 2B additionally provides
configuration-only PMS/Ctrip/Meituan onboarding drafts; these drafts cannot be
tested, activated or run.

The Sprint 1 boundary is still simulation-only: it never connects to a real
PMS, Ctrip, Meituan or WeCom endpoint, and every notification remains blocked
in the simulated Outbox.

## Sprint 2B configuration-only intake

- `GET /api/v1/ota/connector-onboarding/templates` returns three fixed,
  non-executable intake templates.
- Hotel-scoped GET/POST onboarding endpoints store only DRAFT non-secret
  configuration and controlled opaque SecretStore references.
- Responses expose only Secret purpose/provider/configuration status; they do
  not return the reference, version or a deterministic reference fingerprint.
- A non-secret edit retains the still-applicable previous binding inside the
  database transaction, so the browser never has to read or resubmit it.
- URI user-info, embedded credentials, unknown fields, arbitrary URLs,
  scripts and SQL are rejected.
- `/test`, `/activate` and `/run` always return
  `SPRINT2_EXTERNAL_ACTION_BLOCKED`.

## Runtime safety boundary

- Java 21 and Spring Boot 3.5.3.
- PostgreSQL is mandatory. The default configuration has no fallback database and refuses to start without an explicit `jdbc:postgresql://` URL and a dedicated runtime account.
- Before bootstrap, startup queries PostgreSQL system catalogs and refuses a runtime identity that is superuser, has `BYPASSRLS`, owns an `ota` table, or has `row_security` disabled.
- The independent `database/ota-migrations` resource set is packaged at `classpath:db/migration`, but API Flyway is disabled by default and the API refuses to run when it is enabled. A separate migration Job uses the migration identity; `ota_api_app` never owns or migrates tables.
- Startup also fails closed until `control.auth_account`, `control.auth_session`, `control.audit_event`, and `ota.hotel` exist and `flyway.flyway_schema_history` records a successful V1 with no failed migration. In Flyway, a failed/dirty migration is represented by `success=false`. The runtime identity receives read access only to this history table for the compatibility check.
- Access signing material and the optional one-time bootstrap password are supplied only by `env:` secret references. A signing key is a base64-encoded random value of at least 32 bytes.
- There is no default account, shared password, development authentication header, or in-memory production repository.

## Local authentication API

`POST /api/v1/auth/login`

```json
{"username":"operator","password":"entered-in-the-browser"}
```

The response contains only:

```json
{
  "accessToken":"short-lived-bearer-token",
  "expiresInSeconds":600,
  "account":{"id":"uuid","displayName":"Operator","roles":["PLATFORM_ADMIN"]}
}
```

The raw refresh token is returned only as the `ota_refresh` `HttpOnly; Secure; SameSite=Strict; Path=/api/v1/auth` cookie. A separate non-HttpOnly `ota_csrf` cookie uses `Path=/` so the Web application can read it; its value must be copied to the `X-CSRF-TOKEN` header for `POST /api/v1/auth/refresh` and `POST /api/v1/auth/logout`. `GET /api/v1/auth/me` requires the bearer Access Token. The server calculates roles from the current account; roles or tenant identifiers submitted by a client are never trusted.

Browser requests with an `Origin` header are accepted only when the exact HTTPS origin appears in `OTA_ALLOWED_ORIGINS`. Responses containing an Access Token use `Cache-Control: no-store`.

Forwarded headers are ignored by default, so a direct client cannot spoof its source address to evade login limiting. Do not enable a forwarded-header strategy until the deployment has a reviewed ingress and an explicit trusted-proxy boundary.

## One-time first administrator command

There is no HTTP bootstrap endpoint. On an empty database only, an operator may start one instance with all of these deployment-secret/config references set:

```text
OTA_BOOTSTRAP_ENABLED=true
OTA_BOOTSTRAP_CONFIRMATION=CREATE_FIRST_PLATFORM_ADMIN_ONCE
OTA_BOOTSTRAP_USERNAME=<non-secret login name>
OTA_BOOTSTRAP_DISPLAY_NAME=<display name>
OTA_BOOTSTRAP_PASSWORD_SECRET_REF=env:<one-time secret variable name>
```

The command fails if any account already exists. Remove the one-time secret and disable bootstrap immediately after success. Passwords, tokens, cookies, and secret values must never be passed on a command line, committed, logged, or placed in documentation.

## Health

- Liveness: `/actuator/health/liveness`
- Readiness: `/actuator/health/readiness`, including PostgreSQL and loaded signing material

The implementation protocol and key/session rotation rules are frozen in `docs/tasks/OTA-AUTOMATION-V0.1-ADR-001-LOCAL-AUTH.md`.

## Verification

Normal unit tests do not start an embedded database:

```powershell
./.tooling/maven/apache-maven-3.9.9/bin/mvn.cmd -f ota-platform-pom.xml -pl apps/ota-standalone-api -am test
```

The PostgreSQL migration/RLS/append-only test is skipped unless `OTA_POSTGRES_IT_CONFIRM=isolated-database` and the separate migration identity variables `OTA_POSTGRES_IT_ADMIN_URL`, `OTA_POSTGRES_IT_ADMIN_USERNAME`, and `OTA_POSTGRES_IT_ADMIN_PASSWORD` are provided. Point them only at a disposable, isolated database. The administrator runs Flyway and creates a random temporary `NOSUPERUSER NOBYPASSRLS` non-owner login with minimum grants; all no-tenant, wrong-tenant, correct-tenant and append-only assertions run through that restricted login. The temporary password is generated in memory, never logged, and the role is dropped after the test. A sandbox that cannot start or reach PostgreSQL must report this test as environment-blocked, not as an RLS pass.

The migration Job must use the exact history table `flyway.flyway_schema_history`. Override `OTA_FLYWAY_HISTORY_TABLE` only for a reviewed, schema-qualified equivalent; the API rejects unsafe identifiers and an empty, incomplete, failed, or pre-V1 database before bootstrap.
