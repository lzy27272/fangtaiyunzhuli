# OTA Connector Worker

Independent Spring Boot process for the OTA collection and analysis loop. The
currently executable adapters remain simulation/file fixtures; no real PMS or
OTA network adapter is enabled.

## Sprint 2A offline runtime gates

Every connector result now passes a fail-closed boundary before persistence.
The boundary checks the full status/completeness/data-quality matrix,
non-regressing typed watermarks, a trusted completion-time upper bound,
request scope and source identity on every record envelope, controlled
evidence reference protocol plus SHA-256, and stable record
idempotency/schema identifiers. An invalid result is reduced to a fixed
sanitized reason code; connector text is never propagated.

`ConnectorContractFingerprint` creates deterministic capability and standard
record schema fingerprints. `RuntimeConnectorContractGuard` freezes registered
descriptors against the code-reviewed per-stream schema catalog at startup and
invokes `ConnectorContractDriftDetector` after every collection. It refuses an
adapter whose identity, adapter version, capabilities/streams, or record schema
differs from that runtime baseline. A persistent external approval baseline is
still required before any real adapter can be unlocked.

## Sprint 2B execution safety closure

`CollectionResultSafetyGate` is now shared by the registered connector
executor and the JDBC repository, so a persistence caller cannot bypass result
validation. The validator also enforces envelope/result observation ordering
and evidence/watermark time consistency.

`CollectionJobPoller` runs connector work under a hard timeout, renews the job
lease while work is active and performs a final lease fence before accepting a
result. Timeout or lease loss produces a fixed sanitized outcome and discards
late connector results. A connector that ignores interruption may continue its
local thread briefly, but its late result cannot be persisted.

Real connectors have two independent startup controls: profile
`sprint2-real` and `ota.sprint2.real.enabled=true`. The switch defaults to
`false`; simulation and real profiles cannot be active together. Sprint 2A
contains no external SecretStore or network-egress implementation, so even both
real controls intentionally fail startup with
`SPRINT2A_EXTERNAL_SECRETSTORE_EGRESS_NOT_IMPLEMENTED`.

## Offline browser-session bridge

`BrowserSessionCollectionCommand` defines the future Worker-to-isolated-helper
boundary. It carries collection scope and config version, the actor account and
interactive-authorization attempt IDs, the connector-version UUID, connector
code, adapter version, a versioned opaque session locator,
fixed SecretStore-provider/operation codes and a bounded deadline. Provider and
locator scheme must be one of the exact pairs `VAULT`/`vault`,
`OSKEYRING`/`oskeyring` or `SECRETSTORE`/`secretstore`; Cookie-header-shaped values,
scope mismatches, ports, query strings, fragments and URI user information are
rejected.

`BrowserOperationAdmissionManifest` is an immutable offline snapshot whose
entries must come from a trusted control-plane approval independently of the
collection command. `BrowserOperationAdmissionGuard` compares tenant, hotel,
actor account, authorization attempt, connector, config version, connector
version, connector/adapter identity, stream, provider, operation, exact opaque
locator and secret-binding version.
It returns a capability object with a private constructor; the isolated-client
port accepts only that admitted type, not an unchecked command. A future
runtime must never construct the manifest by copying fields from the incoming
command. Manifest loading is package-private and requires the package-private
`TrustedManifestSource` capability; the offline Worker intentionally provides
no production source or wiring. Tests use an in-package fake source only.

The command overrides `toString()` so scope, actor, authorization attempt,
connector-version identity, deadline and the complete `SecretReference`
(including its opaque locator) are redacted. Locator-validation exceptions use
fixed descriptions and do not retain the rejected locator as a nested parser
exception.

`DisabledIsolatedBrowserConnectorClient` is the only current implementation.
It always fails closed with `BROWSER_SESSION_HELPER_NOT_ENABLED`. There is no
transport, browser driver, SecretStore resolution, network egress or PMS
adapter in this module, and the bridge does not unlock the real profile.

## Sprint 2C persisted admission preflight

Every future non-local connector must pass
`RuntimeConnectorContractExecutionGuard` before `collect` is called. The guard
uses the tenant-scoped `JdbcApprovedConnectorContractBaselineReader`, which
invokes only
`control.read_effective_connector_contract_baseline(tenant, hotel, connector,
connector_version, stream)`. The Worker receives `EXECUTE` on this narrow
function and no direct table access to candidate, approval, revocation, service
principal, binding, or rotation evidence.

Execution fails closed with sanitized fixed reason codes when the unique reader
is absent, the database call is unavailable, the baseline is missing or
revoked, the connector version is not active, the fingerprint algorithm is not
supported, or runtime capability/schema fingerprints drift. This preflight
runs before vendor code can collect data.

The exemption is class-exact and limited to the three built-in deterministic
simulation connectors and the compiled read-only `FILE_FIXTURE`. A future
connector cannot bypass persisted admission by copying a mode or connector
code. The trusted candidate manifest is currently empty, so there is no
approved real connector to execute.

Sprint 2C also adds database-side blue/green `CONNECTOR_WORKER` identity states.
Dispatch, claim, renew, and direct fact/Outbox DML require an `ACTIVE` binding.
A `DRAINING` predecessor has only a 15-minute bounded tenant-read window and
may complete only work leased before promotion while that lease remains
unexpired; it cannot renew or claim. Retirement is rejected while an unexpired
lease remains.

The database state machine does not revoke old credentials, close old pools, or
terminate old backends. Controlled UAT must revoke the old credential, close
the old pool, use a separate operator with `pg_signal_backend` to terminate old
role sessions, confirm `pg_stat_activity=0`, and only then retire the binding.

Final verification passed: the main-agent rerun confirmed 209 aggregate tests,
0 failures, 0 errors, and 2 conditional PostgreSQL skips; PostgreSQL 14.22 API
and Worker special runs passed 1/1 each. Security review ended at P0=0 and P1=0.
Recorded P2 limits include archive-only `artifact_digest`, incomplete rotation
command-receipt/idempotency coverage, caller-provided non-canonical
`request_hash`, and no real concurrent-write cutover or 15-minute wall-clock
long test. The preflight is not a Java execution sandbox: descriptor access
happens before the guard call, while connector class initialization and
construction may happen earlier still. This is non-exploitable in the current
scope because no real adapter or external egress exists and the real profile
fails startup. A future real adapter must run in a separate process/container,
pass artifact admission before connector code is loaded, and start with
deny-by-default network policy. No real connector, SecretStore, network, or
message capability is enabled.

## Executable adapters

- `MOCK_PMS`, `MOCK_CTRIP`, and `MOCK_MEITUAN` are deterministic synthetic
  adapters enabled only by the `sprint1-simulation` profile plus the explicit
  `ota.sprint1.simulation.enabled=true` gate.
- `FILE_FIXTURE` is an always-registered, read-only `OFFICIAL_EXPORT` adapter.
  It implements the `OfficialExportParser` flow against one immutable built-in
  synthetic fixture. It accepts no endpoint, host filesystem path, webhook, or
  credential and performs no network access.
- A missing or invalid file fixture returns `FAILED` with
  `UNAVAILABLE` quality, no records, no source-effective time, and no candidate
  watermark. It never turns collection failure into inventory or revenue zero.

The connector codes are identical to the server-owned adapter codes persisted
by the standalone API, so both deterministic pipeline execution and dynamically
scheduled collection jobs resolve through `SourceConnectorRegistry`.

## Database-backed job loops

When the same explicit simulation and persistence gates are enabled:

1. `DynamicScheduleDispatcher` dispatches due schedule slots through the
   database-owned enqueue function.
2. `CollectionJobPoller` claims only `job_type='COLLECTION'`, executes the
   registered adapter through `RegisteredConnectorJobExecutor`, writes the
   `connector_collection_run`, immutable raw-evidence and normalized standard
   records, append-only collection attempt, and stream checkpoint state, then
   calls `control.complete_ota_job`.
3. `SimulationJobPoller` separately claims only
   `job_type='SIMULATION_PIPELINE'` and runs the deterministic four-scenario
   Sprint 1 analysis pipeline.

The run, records, attempt, checkpoint and job completion are handled in one
tenant transaction. Each `StandardRecordEnvelope` produces:

- one deduplicated `source_raw_record` containing only the hashed source key,
  evidence reference/SHA-256, parser version and normalized-content hash; and
- one deduplicated `source_standard_record` containing the privacy-minimized
  normalized JSON payload linked to that raw record.

Both fact inserts use stable IDs and `ON CONFLICT DO NOTHING`, so a retry cannot
duplicate facts or create a dangling raw-record reference. Evidence references
must use a controlled `object://`, `file://` or `fixture://` identifier. Host
filesystem paths, traversal, embedded user information and credential-like
markers are rejected before facts are written.

Collection checkpoint advancement remains fail closed: only a `SUCCESS` result
with `COMPLETE + FRESH` quality, no failed pagination/field/capability
validation, and a non-regressing candidate watermark advances the committed
watermark, and only after every record insert succeeds. Partial or unavailable
results retain the previous committed watermark, preserve unknown values as
`null` rather than fabricated zeroes, and update source health instead.

## Safety boundary

There is still no browser automation, real PMS/OTA adapter, real credential
use, or external message delivery. Production adapters must implement the
framework-free `SourceConnector` contract and obtain secrets only through an
injected `SecretStorePort`; job claims, collection requests, evidence
references and normalized records never carry credential material or host
paths.
