# OTA Browser Session Helper

This module is an offline, framework-free policy skeleton for a future
isolated browser-session process. It currently provides only:

- a deterministic interactive-session lifecycle state machine;
- immutable tenant, hotel, connector/version, configuration-version, actor and
  authorization-attempt session binding;
- exact HTTPS scheme, explicit port, host, method, path and request-contract
  allowlisting;
- a pure per-hop resolved-address authorization contract;
- a server-owned schema of typed non-secret configuration keys;
- sanitized fixed error codes; and
- a composition port that performs no I/O.

`BrowserSessionSnapshot` carries a `BrowserSessionBinding`. Every authorization
request must repeat the same tenant, hotel, connector ID/version,
configuration version, actor ID and authorization-attempt ID. Any difference
fails closed, so an active session cannot be reused across a hotel, tenant,
connector version, configuration revision, operator or authorization attempt.

`BrowserTarget` is HTTPS-only and always carries an explicit port; the
convenience factories default to `443`. Targets are exact and do not allow
wildcards, URL queries, fragments, path traversal, localhost, private address
literals or metadata-style host names. A `POST` target additionally requires
a reviewed request-contract ID/version and SHA-256 digest of the complete
canonical request shape. This module never receives the body or headers.

`BrowserHopAuthorizationRequest` requires the outer runtime to supply every
address returned by name resolution. All addresses must be publicly routable.
The outer runtime must invoke authorization immediately before connecting and
again for every redirect hop, then connect only to an address in the checked
set. A missing address set, a DNS-rebinding result, a private/link-local/
loopback/metadata address, or a redirect to a target not independently
allowlisted must fail closed. This module only evaluates those supplied
facts—it performs no DNS lookup or network access.

`NonSecretConfigurationSchema` accepts keys only, never values. Its allowlist
is compiled server-side and limited to typed non-secret fields; callers cannot
extend it. Secret material cannot be classified as safe by choosing a benign
field name.

It has no browser driver, HTTP client, network egress, credential parser,
secret-store implementation, persistence, scheduler or vendor adapter. It
does not accept session cookies, tokens, passwords, authorization headers or
browser storage state. `ACTIVE` is only an in-memory lifecycle fact supplied
by a future authorized outer runtime; it is not proof of vendor permission or
successful authentication.

The module therefore cannot log in, collect PMS data or unlock any existing
real-connector gate. A future external runtime must remain a separate
process, pass connector admission and UAT, and obtain explicit authorization
before any browser or network implementation is introduced.

Run its tests from the repository root:

```powershell
mvn -f ota-platform-pom.xml -pl apps/ota-browser-session-helper test
```
