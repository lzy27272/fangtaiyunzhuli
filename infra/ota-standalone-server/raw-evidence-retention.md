# Validated raw evidence retention

Ordinary encrypted/redacted collection responses are eligible only after both
observation and durable manifest insertion are seven days old. Exact tenant,
hotel, source system and collection timestamp must match a COMPLETE hourly fact
with required measures and successful source coverage. Unknown source contracts,
partial collections, unmatched evidence and unresolved ingest errors fail closed.
Luopan's CURRENT/FUTURE raw sources both originate in the same ROOM_FORECAST
collector snapshot; this is the only source alias.

The root-owned `prune-validated-raw.py` defaults to a dry run. `--apply` validates
the entire candidate set before deletion, holds the backup flock and database
manifest/error table locks, then records `deleted_at`. A crash after unlink but
before commit is retried safely. Never replace this with a filesystem-age sweep.

To preserve important raw evidence, the database administrator sets `hold_reason`
and `held_at` on its manifest, before expiration. These updates serialize against
cleanup. After review, clear both fields to release the hold. For ingest errors,
set both `resolved_at` and a nonempty `resolution_note` only after replay and
reconciliation. No age-based cleanup removes these exception records.

Hourly facts remain 48 months, final daily facts two years and period aggregates
five years. Images, finance source files, reports and their holds are outside
this worker's path allowlist. Existing manifest `expires_at` records the policy
at capture time; the guarded eligibility view is the deletion authority.

The backup job captures only remaining raw files and retains their verified
current encrypted day packages, including protected old days. Obsolete packages
are removed from export only after a replacement recovery manifest is published.
An in-flight downloader of an old manifest may retry; database/state recovery
points remain on their existing 30 daily/12 monthly/3 yearly policy. The Windows
client applies server selection after successful verification, with its existing
14-day quarantine for retired files until the workstation cleaner is upgraded.
