\set ON_ERROR_STOP on
BEGIN;
UPDATE ota_analytics.retention_policy SET raw_evidence_days=7, updated_at=now();
ALTER TABLE ota_analytics.raw_evidence_manifest
  DROP CONSTRAINT IF EXISTS raw_evidence_manifest_check;
ALTER TABLE ota_analytics.raw_evidence_manifest
  ADD CONSTRAINT raw_evidence_manifest_check CHECK (expires_at >= observed_at + interval '7 days');
ALTER TABLE ota_analytics.raw_evidence_manifest
  ADD COLUMN IF NOT EXISTS hold_reason text,
  ADD COLUMN IF NOT EXISTS held_at timestamptz,
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
ALTER TABLE ota_analytics.ingest_error
  ADD COLUMN IF NOT EXISTS resolved_at timestamptz,
  ADD COLUMN IF NOT EXISTS resolution_note text;

-- Exact collection identity, not a nearby timestamp or a later successful run.
-- Unknown source contracts and any unresolved ingestion error fail closed.
CREATE OR REPLACE VIEW ota_analytics.raw_evidence_cleanup_candidates AS
SELECT r.evidence_id, r.evidence_path, r.evidence_content_hash,
       r.tenant_id, r.hotel_id, r.source_id, r.source_system, r.observed_at
FROM ota_analytics.raw_evidence_manifest r
WHERE r.deleted_at IS NULL AND r.hold_reason IS NULL AND r.held_at IS NULL
  AND greatest(r.created_at,r.observed_at) < now() - interval '7 days'
  AND NOT EXISTS (SELECT 1 FROM ota_analytics.ingest_error WHERE resolved_at IS NULL OR nullif(trim(resolution_note),'') IS NULL)
  AND r.source_system IN ('MEITUAN_BIEYANGHONG','YILIAN_CLOUD','LUOPAN_CLOUD')
  AND EXISTS (
    SELECT 1 FROM ota_analytics.hourly_operating_fact f
    WHERE f.tenant_id=r.tenant_id AND f.hotel_id=r.hotel_id
      AND f.source_system=r.source_system AND f.observed_at=r.observed_at
      AND f.completeness='COMPLETE' AND nullif(f.collection_run_id,'') IS NOT NULL
      AND f.room_revenue IS NOT NULL AND f.sold_room_nights >= 0
      AND f.effective_sellable_room_nights > 0 AND f.available_rooms >= 0
      AND jsonb_array_length(f.source_coverage)>0
      AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(f.source_coverage) s
                      WHERE s->>'completeness' IS DISTINCT FROM 'COMPLETE' OR s->>'errorCode' IS NOT NULL)
      AND EXISTS (SELECT 1 FROM jsonb_array_elements(f.source_coverage) s
        WHERE s->>'sourceId' = CASE
          WHEN r.source_system='LUOPAN_CLOUD' AND r.source_id IN
            ('LUOPAN_ROOM_FORECAST_CURRENT','LUOPAN_ROOM_FORECAST_FUTURE')
          THEN 'LUOPAN_ROOM_FORECAST' ELSE r.source_id END)
  );
REVOKE ALL ON ota_analytics.raw_evidence_cleanup_candidates FROM PUBLIC;
COMMIT;
