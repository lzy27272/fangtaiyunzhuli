# Offline Manual Authorization Rehearsal Implementation Report

Date: 2026-07-25

Status:

- `OFFLINE_REHEARSAL CONTRACT COMPLETE`
- `AUTH_REQUIRED`
- `REAL AUTHORIZATION NOT IMPLEMENTED`
- `PRODUCTION CONNECTOR UNCHANGED`

## Implemented scope

The new `cn.sifangguan.ota.browsersession.rehearsal` package is a pure,
immutable and no-I/O contract for rehearsing a future operator-assisted
authorization flow.

It implements:

- a single fixed mode: `OFFLINE_REHEARSAL`;
- exact rehearsal and browser-session binding on every command and query;
- optimistic revision binding that rejects stale commands and queries;
- the lifecycle
  `PENDING_HELPER -> WAITING_FOR_OPERATOR -> OFFLINE_REHEARSAL_COMPLETE`;
- cancellation, expiry and failure from either non-terminal state;
- terminal-state protection that prevents every terminal state from being
  revived;
- monotonic transition time and strict expiry boundaries;
- a preparation result whose only readiness outcome is
  `READY_FOR_OPERATOR_REHEARSAL`; and
- an authorization state whose only value is `AUTH_REQUIRED`.

`OfflineNoIoManualAuthorizationHelper` only validates bindings and composes the
pure state machine. It does not launch a process, open a file, resolve a host,
open a socket, call HTTP, drive a browser, access a secret provider or retain
mutable runtime state.

## Deliberately absent

The rehearsal DTO vocabulary has no address, user-name, password,
verification-code, browser-session material, request-header, credential-store
locator or browser-storage field.

This slice adds no:

- process runtime or inter-process communication;
- external persistence;
- browser or network dependency;
- credential-provider implementation;
- Worker, API, Web or database integration;
- vendor endpoint or adapter; or
- real authorization or collection capability.

Completing the offline rehearsal is therefore never evidence of a successful
PMS login and never changes `AUTH_REQUIRED`.

## Verification

Command:

```powershell
$env:JAVA_HOME = (Resolve-Path '.tooling/jdk/jdk-21.0.11+10').Path
.\.tooling\maven\apache-maven-3.9.9\bin\mvn.cmd `
  '-Dmaven.repo.local=.tooling/m2' -o `
  -f ota-platform-pom.xml `
  -pl apps/ota-browser-session-helper test
```

Result:

- tests: 28
- failures: 0
- errors: 0
- skipped: 0
- build: `SUCCESS`

The verification suite includes strict cross-scope and stale-revision
rejection, method/action substitution rejection, deadline boundaries,
terminal-state non-revival, fixed sanitized error codes, DTO reflection checks
and source/dependency boundary checks for process, file, network, DNS, browser
and secret-provider implementations.
