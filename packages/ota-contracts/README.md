# OTA Contracts

`ota-contracts` is the framework-free contract module shared by the independent OTA API,
connector worker, and future AI-platform adapters. It intentionally has no Spring, database,
HTTP-client, secret-manager SDK, or AI-platform application dependency.

The module freezes:

- connector SPI and capabilities;
- typed collection and event envelopes;
- the OpenAPI 3.1 Sprint 0 authentication contract at
  `src/main/resources/openapi/ota-standalone-auth-v1.yaml`;
- source, quality, validation, and lifecycle enums;
- future integration ports that preserve the OTA service as the single writer.

Secret material is never part of a DTO. Non-secret connector configuration must be constructed
with an adapter-owned `ConnectorConfigFieldPolicy`: only explicitly allowed fields are accepted.
Every URL field has an exact scheme/host/query allow-list; HTTPS is the default factory policy,
HTTP must be explicit, and IP literals, localhost, userinfo, fragments, and unlisted query
parameters are rejected. Policies come from the trusted adapter registry, never from an
administrator request. A connector
that needs credentials must use an injected `SecretStorePort`; the port exposes secret material
only through a short-lived, closeable lease and never as a `String`.

Source time preserves evidence precision. Each record must provide exactly one of an exact
`sourceEffectiveAt` or a `sourceDetectionInterval`; callers cannot omit both or invent a timestamp.
Audit actors likewise preserve their
identity kind: `ACCOUNT`, `SERVICE`, and `ANONYMOUS` have mutually exclusive identifiers.
