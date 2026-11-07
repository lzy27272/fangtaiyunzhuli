\set ON_ERROR_STOP on
BEGIN;
INSERT INTO ota_analytics.hourly_operating_fact
(idempotency_key,tenant_id,hotel_id,business_date,observed_at,source_system,completeness,
 collection_run_id,room_revenue,sold_room_nights,effective_sellable_room_nights,available_rooms,source_coverage,content_hash)
SELECT lpad(n::text,64,'0'),'retention-test','test-'||n,current_date-10,now()-interval '10 days',
 'YILIAN_CLOUD',CASE WHEN n=3 THEN 'PARTIAL' ELSE 'COMPLETE' END,'run-'||n,
 CASE WHEN n=4 THEN NULL ELSE 300 END,3,10,7,
 CASE WHEN n=5 THEN '[{"sourceId":"source","completeness":"UNAVAILABLE"}]'::jsonb
 ELSE '[{"sourceId":"source","completeness":"COMPLETE","errorCode":null}]'::jsonb END,repeat('a',64)
FROM generate_series(1,9) n;
INSERT INTO ota_analytics.raw_evidence_manifest
(evidence_id,idempotency_key,tenant_id,hotel_id,source_id,source_system,observed_at,expires_at,
 evidence_path,evidence_content_hash,content_hash,created_at,hold_reason)
SELECT lpad(n::text,64,'0'),lpad(n::text,64,'0'),'retention-test',
 CASE WHEN n=7 THEN 'no-fact' ELSE 'test-'||n END,
 CASE WHEN n=6 THEN 'wrong-source' ELSE 'source' END,'YILIAN_CLOUD',
 now()-interval '10 days',now()-interval '3 days',
 'raw/'||to_char(now()-interval '10 days','YYYY-MM-DD')||'/'||lpad(n::text,64,'0')||'.json.enc',
 repeat('b',64),repeat('c',64),
 CASE WHEN n=8 THEN now()-interval '1 day' ELSE now()-interval '10 days' END,
 CASE WHEN n=2 THEN 'important evidence' ELSE NULL END
FROM generate_series(1,9) n;
-- A timestamp near a completed run is not proof of the same run.
UPDATE ota_analytics.raw_evidence_manifest SET observed_at=observed_at+interval '1 second',expires_at=expires_at+interval '1 second'
WHERE tenant_id='retention-test' AND hotel_id='test-9';
DO $$ BEGIN
 IF (SELECT count(*) FROM ota_analytics.raw_evidence_cleanup_candidates WHERE tenant_id='retention-test')<>1
 THEN RAISE EXCEPTION 'Eligibility deleted held/incomplete/unimported/mismatched evidence'; END IF;
END $$;
INSERT INTO ota_analytics.ingest_error(event_type,error_state,error_message,event_payload,received_at)
VALUES ('TEST','TEST','unresolved','{}',now()-interval '100 days');
SELECT ota_analytics.apply_retention();
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM ota_analytics.raw_evidence_cleanup_candidates)
 THEN RAISE EXCEPTION 'Unresolved ingest error must stop cleanup'; END IF;
 IF (SELECT count(*) FROM ota_analytics.raw_evidence_manifest WHERE tenant_id='retention-test')<>9
 THEN RAISE EXCEPTION 'Age-only SQL cleanup removed evidence metadata'; END IF;
END $$;
UPDATE ota_analytics.ingest_error SET resolved_at=now(),resolution_note='Replayed and reconciled' WHERE event_type='TEST';
DO $$ BEGIN
 IF (SELECT count(*) FROM ota_analytics.raw_evidence_cleanup_candidates WHERE tenant_id='retention-test')<>1
 THEN RAISE EXCEPTION 'Resolution did not restore validated cleanup'; END IF;
 IF (SELECT hourly_months=48 AND daily_years=2 AND aggregate_years=5 AND raw_evidence_days=7 FROM ota_analytics.retention_policy) IS NOT TRUE
 THEN RAISE EXCEPTION 'Approved retention mismatch'; END IF;
END $$;
ROLLBACK;
