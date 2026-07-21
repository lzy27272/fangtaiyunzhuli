# TECH-V0.2 External Evidence Bundle

This workflow binds external release declarations to locally archived evidence. It is fail-closed and read-only except for writing the generated release-gate input JSON.

## Required formal order

1. After the repository owner has created a clean commit and annotated `TECH-V0.2-rc.3` tag, rebuild the formal RC artifacts from that exact HEAD. Do not reuse the local-hardening artifacts whose release version is `TECH-V0.2-rc.3-local`:

```powershell
.\tools\release\Test-ReleaseReproducibility.ps1 `
  -ReleaseVersion 'TECH-V0.2-rc.3' `
  -BuildTimestamp '<approved-UTC-timestamp>' `
  -OutputRoot '.uat-runtime\release-artifacts\reproducibility-rc3-formal'
```

2. Copy the `.example.json` contents to controlled, non-example files under `.uat-runtime/release/external-evidence/` and fill them only from real target-environment evidence and real human approvals. Create the controlled bundle at `.uat-runtime/release/TECH-V0.2-EXTERNAL-EVIDENCE-BUNDLE.json`. The source-traceability paths must reference the formal RC3 build above. `.uat-runtime/` is excluded from Git; do not store real signer or target-environment metadata in `docs/releases`. The target-SSO and target-operations declarations each require the exact ten specialty approvals defined by their acceptance documents; one owner signature is not sufficient.
3. Run the release-closure controller. This is the only authoritative executable entrypoint for a formal TECH-V0.2 closure decision:

```powershell
.\tools\release\Invoke-TechV02ReleaseClosure.ps1 `
  -BundlePath '.uat-runtime\release\TECH-V0.2-EXTERNAL-EVIDENCE-BUNDLE.json' `
  -GateInputsPath '.uat-runtime\release\TECH-V0.2-RELEASE-GATE-INPUTS.json'
```

## Authoritative closure behavior

The controller alone invokes gate-input generation, external-evidence recomputation, and the final six checks in a fixed order. It requires all four stages to agree on process exit code and exact JSON status, independently recomputes external evidence, verifies the generated gate-input SHA-256 before and after recomputation and the final gate, and stops before later stages on any failure. Invalid evidence does not create or refresh the canonical gate-input file. A complete result is only `READY_FOR_RELEASE_APPROVAL`; the controller never marks TECH-V0.2 Released and never starts Sprint 3.

`New-TechV02ExternalEvidenceBundle.ps1`, `Test-TechV02ExternalEvidenceBundle.ps1`, and `Test-TechV02ReleaseGate.ps1` are internal diagnostic components. Running any of them directly, separately, or in a hand-assembled sequence is not a formal release decision and must not be used to bypass the controller.

## Human-signature assurance boundary

Plain JSON, a person name, `signedByHuman=true`, and a SHA-256 value do not prove a real human identity. Every SSO approval, target-operations approval, attachment approval, and ten-party release signoff therefore requires `signatureAssurance`.

Allowed assurance methods are:

- `CONTROLLED_SIGNING_PLATFORM_EXPORT`
- `CERTIFICATE_SIGNATURE`

The declaration must include the provider, verification ID, `VERIFIED` status, verification time, and a locally archived platform export or certificate-verification evidence file. Certificate-based declarations also require the SHA-256 fingerprint of the certificate. Missing or unverifiable assurance data remains `BLOCKED`.

The local validator only checks required metadata, local-file containment, and byte hashes. It does not independently authenticate a person or replace verification by the controlled signing platform, certificate trust chain, release owner, or governance committee.

## Evidence-to-subject binding

- The field-photo declaration must provide `photo.originalFilePath`. The validator consumes that file as one locked byte snapshot and derives `originalFileUri`, `originalFileSha256`, and `originalFileSizeBytes`; file name, byte count, declared photo SHA-256, upload SHA-256, download SHA-256, and restore SHA-256 must all resolve to the same original bytes.
- Source traceability must declare a permitted non-local HTTPS/SSH Git remote, remote branch, HEAD author and committer identities, a clean HEAD, an annotated RC tag, a matching remote-tracking commit, and formal artifacts rebuilt from that HEAD.
- `repositoryApproval` must be a verified `REPOSITORY_OWNER` human approval scoped to the exact remote URL, branch, HEAD commit, RC tag, consumed artifact-manifest SHA-256, and remote publication time. A generic repository approval cannot be reused across repositories, commits, tags, or manifests.
- The repository owner and release owner must confirm that the controlled signing/export evidence itself contains those exact scope values. A local remote-tracking reference is necessary for deterministic checking but is not, by itself, proof that an external remote accepted the commit.
- Target SSO and target operations each require their frozen set of ten distinct human approver roles. Attachment acceptance requires exactly four frozen approver roles. Unknown, duplicate, extra, or differently cased role codes fail closed.
- The formal manifest must use the canonical case-sensitive `TECH-V0.2-rc.N` tag and contain exactly one each of the backend JAR, web ZIP, DB-V13 migration ZIP, OpenAPI YAML, and API Markdown artifacts named for that tag.

## Local evidence boundary

- Evidence-file URLs are rejected; export evidence to a controlled local file first. The only URL accepted as data is the explicitly validated, non-local HTTPS/SSH Git remote in source traceability.
- Any path containing a symbolic link, junction, or other reparse point is rejected.
- Evidence files are hashed, sized, and parsed from the same locked byte snapshot; later recomputation and the final gate must reproduce the same binding. The final gate registers and revalidates the Worker summary/runtime/XML, manifest, all five artifacts, `SHA256SUMS.txt`, signature-assurance exports, original photo, and other referenced evidence before deciding.
- JSON snapshots must be strict UTF-8 and may contain at most one leading UTF-8 BOM. `schemaVersion` is the integer `1`; release versions, evidence types, role codes, storage type, and RC tags are case-exact. Signed, verified, captured, published, and approved timestamps use ISO 8601 with `Z` or an explicit numeric offset.
- Reservation, Worker, migration, backup, and test counters are validated as integers without coercing strings, booleans, or fractions. Target attachment storage must be exactly `OBJECT_STORAGE`.
- Signer and signature IDs must not contain leading or trailing whitespace and are compared after `Trim().ToLowerInvariant()` normalization.
- The tools create no signature, approval, commit, tag, or network write.
- The controlled bundle, generated gate inputs, real signer exports, certificate verification records, and target-environment exports belong under `.uat-runtime/release/`, which is Git-ignored. The generator rejects gate-input output paths outside that directory.
- Files named `*.example.json`, `fixed-empty`, `external-audit`, or `invalid-template-derived` are templates or negative-test fixtures, not release evidence. They must never be copied or renamed into the canonical gate-input path.
