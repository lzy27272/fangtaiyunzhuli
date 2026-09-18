\set ON_ERROR_STOP on

CREATE SCHEMA IF NOT EXISTS ota_analytics;
REVOKE ALL ON SCHEMA ota_analytics FROM PUBLIC;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ota_analytics_reader') THEN
    CREATE ROLE ota_analytics_reader NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ota_analytics_ingester') THEN
    CREATE ROLE ota_analytics_ingester NOLOGIN;
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS ota_analytics.retention_policy (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  hourly_months smallint NOT NULL CHECK (hourly_months = 48),
  daily_years smallint NOT NULL CHECK (daily_years = 2),
  aggregate_years smallint NOT NULL CHECK (aggregate_years = 5),
  raw_evidence_days smallint NOT NULL CHECK (raw_evidence_days BETWEEN 30 AND 90),
  daily_backup_count smallint NOT NULL CHECK (daily_backup_count = 30),
  monthly_backup_count smallint NOT NULL CHECK (monthly_backup_count = 12),
  yearly_backup_count smallint NOT NULL CHECK (yearly_backup_count = 3),
  offsite_copy_required boolean NOT NULL CHECK (offsite_copy_required),
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO ota_analytics.retention_policy (
  singleton, hourly_months, daily_years, aggregate_years,
  raw_evidence_days, daily_backup_count, monthly_backup_count,
  yearly_backup_count, offsite_copy_required
) VALUES (true, 48, 2, 5, 90, 30, 12, 3, true)
ON CONFLICT (singleton) DO UPDATE SET
  hourly_months = EXCLUDED.hourly_months,
  daily_years = EXCLUDED.daily_years,
  aggregate_years = EXCLUDED.aggregate_years,
  daily_backup_count = EXCLUDED.daily_backup_count,
  monthly_backup_count = EXCLUDED.monthly_backup_count,
  yearly_backup_count = EXCLUDED.yearly_backup_count,
  offsite_copy_required = EXCLUDED.offsite_copy_required,
  updated_at = now();

CREATE TABLE IF NOT EXISTS ota_analytics.hourly_operating_fact (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  idempotency_key text NOT NULL UNIQUE CHECK (idempotency_key ~ '^[a-f0-9]{64}$'),
  tenant_id text NOT NULL,
  hotel_id text NOT NULL,
  business_date date NOT NULL,
  observed_at timestamptz NOT NULL,
  source_system text NOT NULL,
  completeness text NOT NULL CHECK (completeness IN ('COMPLETE', 'PARTIAL', 'UNAVAILABLE')),
  collection_run_id text,
  room_revenue numeric(18,2),
  sold_room_nights numeric(14,2),
  effective_sellable_room_nights numeric(14,2),
  available_rooms numeric(14,2),
  occupancy_rate numeric(9,6) CHECK (occupancy_rate BETWEEN 0 AND 1),
  adr numeric(18,4),
  revpar numeric(18,4),
  daily_order_summary jsonb,
  future_daily jsonb NOT NULL DEFAULT '[]'::jsonb,
  source_coverage jsonb NOT NULL DEFAULT '[]'::jsonb,
  content_hash text NOT NULL CHECK (content_hash ~ '^[a-f0-9]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS hourly_fact_hotel_observed_idx
  ON ota_analytics.hourly_operating_fact (tenant_id, hotel_id, observed_at DESC);
CREATE INDEX IF NOT EXISTS hourly_fact_hotel_business_idx
  ON ota_analytics.hourly_operating_fact
  (tenant_id, hotel_id, business_date, observed_at DESC);

CREATE TABLE IF NOT EXISTS ota_analytics.daily_operating_fact (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  idempotency_key text NOT NULL UNIQUE CHECK (idempotency_key ~ '^[a-f0-9]{64}$'),
  tenant_id text NOT NULL,
  hotel_id text NOT NULL,
  business_date date NOT NULL,
  observed_at timestamptz NOT NULL,
  finalized_at timestamptz NOT NULL DEFAULT now(),
  revision integer NOT NULL CHECK (revision > 0),
  source_system text NOT NULL,
  completeness text NOT NULL CHECK (completeness IN ('COMPLETE', 'PARTIAL')),
  collection_run_id text,
  room_revenue numeric(18,2),
  sold_room_nights numeric(14,2),
  effective_sellable_room_nights numeric(14,2),
  available_rooms numeric(14,2),
  occupancy_rate numeric(9,6) CHECK (occupancy_rate BETWEEN 0 AND 1),
  adr numeric(18,4),
  revpar numeric(18,4),
  daily_order_summary jsonb,
  source_coverage jsonb NOT NULL DEFAULT '[]'::jsonb,
  content_hash text NOT NULL CHECK (content_hash ~ '^[a-f0-9]{64}$'),
  UNIQUE (tenant_id, hotel_id, business_date, revision)
);
CREATE INDEX IF NOT EXISTS daily_fact_hotel_business_idx
  ON ota_analytics.daily_operating_fact
  (tenant_id, hotel_id, business_date DESC, revision DESC);

CREATE TABLE IF NOT EXISTS ota_analytics.ota_source_fact (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  idempotency_key text NOT NULL UNIQUE CHECK (idempotency_key ~ '^[a-f0-9]{64}$'),
  tenant_id text NOT NULL,
  hotel_id text NOT NULL,
  source_id text NOT NULL,
  platform_code text NOT NULL,
  source_type text,
  observed_at timestamptz NOT NULL,
  completeness text NOT NULL CHECK (completeness IN ('COMPLETE', 'UNAVAILABLE')),
  error_code text,
  summary jsonb,
  content_hash text NOT NULL CHECK (content_hash ~ '^[a-f0-9]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ota_source_fact_hotel_observed_idx
  ON ota_analytics.ota_source_fact
  (tenant_id, hotel_id, source_id, observed_at DESC);

CREATE TABLE IF NOT EXISTS ota_analytics.raw_evidence_manifest (
  evidence_id text PRIMARY KEY CHECK (evidence_id ~ '^[a-f0-9]{64}$'),
  idempotency_key text NOT NULL UNIQUE CHECK (idempotency_key ~ '^[a-f0-9]{64}$'),
  tenant_id text NOT NULL,
  hotel_id text NOT NULL,
  source_id text NOT NULL,
  source_system text NOT NULL,
  observed_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  evidence_path text NOT NULL CHECK (
    evidence_path ~ '^raw/[0-9]{4}-[0-9]{2}-[0-9]{2}/[a-f0-9]{64}\.json\.enc$'
  ),
  evidence_content_hash text NOT NULL CHECK (evidence_content_hash ~ '^[a-f0-9]{64}$'),
  content_hash text NOT NULL CHECK (content_hash ~ '^[a-f0-9]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (expires_at >= observed_at + interval '30 days'),
  CHECK (expires_at <= observed_at + interval '90 days')
);
CREATE INDEX IF NOT EXISTS raw_evidence_manifest_expires_idx
  ON ota_analytics.raw_evidence_manifest (expires_at);

CREATE TABLE IF NOT EXISTS ota_analytics.period_rollup (
  tenant_id text NOT NULL,
  hotel_id text NOT NULL,
  period_type text NOT NULL CHECK (period_type IN ('MONTH', 'QUARTER', 'HALF_YEAR', 'YEAR')),
  period_start date NOT NULL,
  period_end date NOT NULL CHECK (period_end >= period_start),
  available_day_count integer NOT NULL CHECK (available_day_count >= 0),
  expected_day_count integer NOT NULL CHECK (expected_day_count > 0),
  room_revenue numeric(20,2),
  sold_room_nights numeric(18,2),
  effective_sellable_room_nights numeric(18,2),
  occupancy_rate numeric(9,6) CHECK (occupancy_rate BETWEEN 0 AND 1),
  adr numeric(18,4),
  revpar numeric(18,4),
  completeness text NOT NULL CHECK (completeness IN ('COMPLETE', 'PARTIAL')),
  refreshed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, hotel_id, period_type, period_start)
);
CREATE INDEX IF NOT EXISTS period_rollup_hotel_period_idx
  ON ota_analytics.period_rollup
  (tenant_id, hotel_id, period_type, period_start DESC);

CREATE TABLE IF NOT EXISTS ota_analytics.ingest_error (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  received_at timestamptz NOT NULL DEFAULT now(),
  event_type text,
  idempotency_key text,
  error_state text NOT NULL,
  error_message text NOT NULL,
  event_payload jsonb NOT NULL
);
CREATE INDEX IF NOT EXISTS ingest_error_received_idx
  ON ota_analytics.ingest_error (received_at DESC);

CREATE OR REPLACE FUNCTION ota_analytics.jsonb_numeric(payload jsonb, field_name text)
RETURNS numeric
LANGUAGE plpgsql IMMUTABLE
AS $$
DECLARE result numeric;
BEGIN
  IF payload -> field_name IS NULL OR payload -> field_name = 'null'::jsonb THEN
    RETURN NULL;
  END IF;
  result := (payload ->> field_name)::numeric;
  IF result = 'Infinity'::numeric OR result = '-Infinity'::numeric OR result = 'NaN'::numeric THEN
    RETURN NULL;
  END IF;
  RETURN result;
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
  RETURN NULL;
END
$$;

CREATE OR REPLACE FUNCTION ota_analytics.ingest_event(event jsonb)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, ota_analytics
AS $$
DECLARE
  event_type text := event ->> 'eventType';
  measures jsonb := COALESCE(event -> 'measures', '{}'::jsonb);
  next_revision integer;
BEGIN
  IF event_type = 'PMS_HOURLY_FACT_V1' THEN
    INSERT INTO ota_analytics.hourly_operating_fact (
      idempotency_key, tenant_id, hotel_id, business_date, observed_at,
      source_system, completeness, collection_run_id, room_revenue,
      sold_room_nights, effective_sellable_room_nights, available_rooms,
      occupancy_rate, adr, revpar, daily_order_summary, future_daily,
      source_coverage, content_hash
    ) VALUES (
      event ->> 'idempotencyKey', event ->> 'tenantId', event ->> 'hotelId',
      (event ->> 'businessDate')::date, (event ->> 'observedAt')::timestamptz,
      event ->> 'sourceSystem', event ->> 'completeness', event ->> 'collectionRunId',
      ota_analytics.jsonb_numeric(measures, 'roomRevenue'),
      ota_analytics.jsonb_numeric(measures, 'soldRoomNights'),
      ota_analytics.jsonb_numeric(measures, 'effectiveSellableRoomNights'),
      ota_analytics.jsonb_numeric(measures, 'availableRooms'),
      ota_analytics.jsonb_numeric(measures, 'occupancyRate'),
      ota_analytics.jsonb_numeric(measures, 'adr'),
      ota_analytics.jsonb_numeric(measures, 'revPar'),
      event -> 'dailyOrderSummary', COALESCE(event -> 'futureDaily', '[]'::jsonb),
      COALESCE(event -> 'sourceCoverage', '[]'::jsonb), event ->> 'contentHash'
    ) ON CONFLICT (idempotency_key) DO NOTHING;
  ELSIF event_type = 'PMS_DAILY_FINAL_FACT_V1' THEN
    PERFORM pg_advisory_xact_lock(hashtextextended(
      concat_ws(':', event ->> 'tenantId', event ->> 'hotelId', event ->> 'businessDate'), 0
    ));
    SELECT COALESCE(max(revision), 0) + 1 INTO next_revision
    FROM ota_analytics.daily_operating_fact
    WHERE tenant_id = event ->> 'tenantId'
      AND hotel_id = event ->> 'hotelId'
      AND business_date = (event ->> 'businessDate')::date;
    INSERT INTO ota_analytics.daily_operating_fact (
      idempotency_key, tenant_id, hotel_id, business_date, observed_at, revision,
      source_system, completeness, collection_run_id, room_revenue,
      sold_room_nights, effective_sellable_room_nights, available_rooms,
      occupancy_rate, adr, revpar, daily_order_summary, source_coverage, content_hash
    ) VALUES (
      event ->> 'idempotencyKey', event ->> 'tenantId', event ->> 'hotelId',
      (event ->> 'businessDate')::date, (event ->> 'observedAt')::timestamptz,
      next_revision, event ->> 'sourceSystem', event ->> 'completeness',
      event ->> 'collectionRunId',
      ota_analytics.jsonb_numeric(measures, 'roomRevenue'),
      ota_analytics.jsonb_numeric(measures, 'soldRoomNights'),
      ota_analytics.jsonb_numeric(measures, 'effectiveSellableRoomNights'),
      ota_analytics.jsonb_numeric(measures, 'availableRooms'),
      ota_analytics.jsonb_numeric(measures, 'occupancyRate'),
      ota_analytics.jsonb_numeric(measures, 'adr'),
      ota_analytics.jsonb_numeric(measures, 'revPar'),
      event -> 'dailyOrderSummary', COALESCE(event -> 'sourceCoverage', '[]'::jsonb),
      event ->> 'contentHash'
    ) ON CONFLICT (idempotency_key) DO NOTHING;
  ELSIF event_type = 'OTA_SOURCE_FACT_V1' THEN
    INSERT INTO ota_analytics.ota_source_fact (
      idempotency_key, tenant_id, hotel_id, source_id, platform_code,
      source_type, observed_at, completeness, error_code, summary, content_hash
    ) VALUES (
      event ->> 'idempotencyKey', event ->> 'tenantId', event ->> 'hotelId',
      event ->> 'sourceId', event ->> 'platformCode', event ->> 'sourceType',
      (event ->> 'observedAt')::timestamptz, event ->> 'completeness',
      event ->> 'errorCode', event -> 'summary', event ->> 'contentHash'
    ) ON CONFLICT (idempotency_key) DO NOTHING;
  ELSIF event_type = 'RAW_EVIDENCE_MANIFEST_V1' THEN
    INSERT INTO ota_analytics.raw_evidence_manifest (
      evidence_id, idempotency_key, tenant_id, hotel_id, source_id,
      source_system, observed_at, expires_at, evidence_path,
      evidence_content_hash, content_hash
    ) VALUES (
      event ->> 'evidenceId', event ->> 'idempotencyKey', event ->> 'tenantId',
      event ->> 'hotelId', event ->> 'sourceId', event ->> 'sourceSystem',
      (event ->> 'observedAt')::timestamptz, (event ->> 'expiresAt')::timestamptz,
      event ->> 'evidencePath', event ->> 'evidenceContentHash', event ->> 'contentHash'
    ) ON CONFLICT (evidence_id) DO NOTHING;
  ELSE
    RAISE EXCEPTION 'unsupported analytics event type: %', event_type
      USING ERRCODE = '22023';
  END IF;
  RETURN true;
EXCEPTION WHEN OTHERS THEN
  INSERT INTO ota_analytics.ingest_error (
    event_type, idempotency_key, error_state, error_message, event_payload
  ) VALUES (
    event_type, event ->> 'idempotencyKey', SQLSTATE, left(SQLERRM, 1000), event
  );
  RETURN false;
END
$$;

CREATE OR REPLACE FUNCTION ota_analytics.refresh_rollups()
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, ota_analytics
AS $$
DECLARE affected bigint;
BEGIN
  WITH latest_daily AS (
    SELECT DISTINCT ON (tenant_id, hotel_id, business_date)
      tenant_id, hotel_id, business_date, room_revenue, sold_room_nights,
      effective_sellable_room_nights
    FROM ota_analytics.daily_operating_fact
    ORDER BY tenant_id, hotel_id, business_date, revision DESC
  ), expanded AS (
    SELECT d.*, p.period_type,
      CASE p.period_type
        WHEN 'MONTH' THEN date_trunc('month', d.business_date)::date
        WHEN 'QUARTER' THEN date_trunc('quarter', d.business_date)::date
        WHEN 'HALF_YEAR' THEN make_date(
          extract(year FROM d.business_date)::integer,
          CASE WHEN extract(month FROM d.business_date) <= 6 THEN 1 ELSE 7 END, 1)
        ELSE date_trunc('year', d.business_date)::date
      END AS period_start
    FROM latest_daily d
    CROSS JOIN (VALUES ('MONTH'), ('QUARTER'), ('HALF_YEAR'), ('YEAR')) p(period_type)
  ), grouped AS (
    SELECT tenant_id, hotel_id, period_type, period_start,
      CASE period_type
        WHEN 'MONTH' THEN (period_start + interval '1 month - 1 day')::date
        WHEN 'QUARTER' THEN (period_start + interval '3 months - 1 day')::date
        WHEN 'HALF_YEAR' THEN (period_start + interval '6 months - 1 day')::date
        ELSE (period_start + interval '1 year - 1 day')::date
      END AS period_end,
      count(*)::integer AS available_day_count,
      sum(room_revenue) AS room_revenue,
      sum(sold_room_nights) AS sold_room_nights,
      sum(effective_sellable_room_nights) AS effective_sellable_room_nights
    FROM expanded
    GROUP BY tenant_id, hotel_id, period_type, period_start
  ), prepared AS (
    SELECT *, (period_end - period_start + 1)::integer AS expected_day_count,
      CASE WHEN effective_sellable_room_nights > 0
        THEN sold_room_nights / effective_sellable_room_nights END AS occupancy_rate,
      CASE WHEN sold_room_nights > 0 THEN room_revenue / sold_room_nights END AS adr,
      CASE WHEN effective_sellable_room_nights > 0
        THEN room_revenue / effective_sellable_room_nights END AS revpar
    FROM grouped
  )
  INSERT INTO ota_analytics.period_rollup (
    tenant_id, hotel_id, period_type, period_start, period_end,
    available_day_count, expected_day_count, room_revenue, sold_room_nights,
    effective_sellable_room_nights, occupancy_rate, adr, revpar, completeness,
    refreshed_at
  ) SELECT
    tenant_id, hotel_id, period_type, period_start, period_end,
    available_day_count, expected_day_count, room_revenue, sold_room_nights,
    effective_sellable_room_nights, occupancy_rate, adr, revpar,
    CASE WHEN available_day_count = expected_day_count THEN 'COMPLETE' ELSE 'PARTIAL' END,
    now()
  FROM prepared
  ON CONFLICT (tenant_id, hotel_id, period_type, period_start) DO UPDATE SET
    period_end = EXCLUDED.period_end,
    available_day_count = EXCLUDED.available_day_count,
    expected_day_count = EXCLUDED.expected_day_count,
    room_revenue = EXCLUDED.room_revenue,
    sold_room_nights = EXCLUDED.sold_room_nights,
    effective_sellable_room_nights = EXCLUDED.effective_sellable_room_nights,
    occupancy_rate = EXCLUDED.occupancy_rate,
    adr = EXCLUDED.adr,
    revpar = EXCLUDED.revpar,
    completeness = EXCLUDED.completeness,
    refreshed_at = now();
  GET DIAGNOSTICS affected = ROW_COUNT;
  RETURN affected;
END
$$;

CREATE OR REPLACE FUNCTION ota_analytics.ingest_base64_event(encoded_event text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, ota_analytics
AS $$
DECLARE decoded_event jsonb;
BEGIN
  IF encoded_event IS NULL OR length(encoded_event) > 20000000 THEN
    RAISE EXCEPTION 'analytics encoded event is empty or oversized'
      USING ERRCODE = '22023';
  END IF;
  decoded_event := convert_from(decode(encoded_event, 'base64'), 'UTF8')::jsonb;
  RETURN ota_analytics.ingest_event(decoded_event);
EXCEPTION WHEN OTHERS THEN
  INSERT INTO ota_analytics.ingest_error (
    event_type, idempotency_key, error_state, error_message, event_payload
  ) VALUES (
    NULL, NULL, SQLSTATE, left(SQLERRM, 1000),
    jsonb_build_object(
      'payloadOmitted', true,
      'encodedLength', COALESCE(length(encoded_event), 0)
    )
  );
  RETURN false;
END
$$;

CREATE OR REPLACE FUNCTION ota_analytics.apply_retention(reference_time timestamptz DEFAULT now())
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, ota_analytics
AS $$
DECLARE hourly_removed bigint; daily_removed bigint; aggregate_removed bigint;
DECLARE ota_removed bigint; manifests_removed bigint; errors_removed bigint;
BEGIN
  DELETE FROM ota_analytics.hourly_operating_fact
  WHERE observed_at < reference_time - interval '48 months';
  GET DIAGNOSTICS hourly_removed = ROW_COUNT;
  DELETE FROM ota_analytics.ota_source_fact
  WHERE observed_at < reference_time - interval '48 months';
  GET DIAGNOSTICS ota_removed = ROW_COUNT;
  DELETE FROM ota_analytics.daily_operating_fact
  WHERE business_date < (reference_time AT TIME ZONE 'Asia/Shanghai')::date - interval '2 years';
  GET DIAGNOSTICS daily_removed = ROW_COUNT;
  DELETE FROM ota_analytics.period_rollup
  WHERE period_end < (reference_time AT TIME ZONE 'Asia/Shanghai')::date - interval '5 years';
  GET DIAGNOSTICS aggregate_removed = ROW_COUNT;
  DELETE FROM ota_analytics.raw_evidence_manifest WHERE expires_at < reference_time;
  GET DIAGNOSTICS manifests_removed = ROW_COUNT;
  DELETE FROM ota_analytics.ingest_error WHERE received_at < reference_time - interval '90 days';
  GET DIAGNOSTICS errors_removed = ROW_COUNT;
  RETURN jsonb_build_object(
    'hourly', hourly_removed, 'ota', ota_removed, 'daily', daily_removed,
    'aggregate', aggregate_removed, 'rawManifests', manifests_removed,
    'ingestErrors', errors_removed
  );
END
$$;

CREATE OR REPLACE VIEW ota_analytics.period_comparison AS
SELECT current_period.*,
  prior.room_revenue AS prior_room_revenue,
  current_period.room_revenue - prior.room_revenue AS room_revenue_period_delta,
  CASE WHEN prior.room_revenue <> 0
    THEN (current_period.room_revenue - prior.room_revenue) / abs(prior.room_revenue) END
    AS room_revenue_period_change,
  prior_year.room_revenue AS prior_year_room_revenue,
  current_period.room_revenue - prior_year.room_revenue AS room_revenue_year_delta,
  CASE WHEN prior_year.room_revenue <> 0
    THEN (current_period.room_revenue - prior_year.room_revenue) / abs(prior_year.room_revenue) END
    AS room_revenue_year_change,
  prior.sold_room_nights AS prior_sold_room_nights,
  current_period.sold_room_nights - prior.sold_room_nights AS sold_room_nights_period_delta,
  CASE WHEN prior.sold_room_nights <> 0
    THEN (current_period.sold_room_nights - prior.sold_room_nights) / abs(prior.sold_room_nights) END
    AS sold_room_nights_period_change,
  prior_year.sold_room_nights AS prior_year_sold_room_nights,
  current_period.sold_room_nights - prior_year.sold_room_nights AS sold_room_nights_year_delta,
  CASE WHEN prior_year.sold_room_nights <> 0
    THEN (current_period.sold_room_nights - prior_year.sold_room_nights) / abs(prior_year.sold_room_nights) END
    AS sold_room_nights_year_change,
  prior.occupancy_rate AS prior_occupancy_rate,
  prior_year.occupancy_rate AS prior_year_occupancy_rate,
  current_period.occupancy_rate - prior.occupancy_rate AS occupancy_period_delta,
  current_period.occupancy_rate - prior_year.occupancy_rate AS occupancy_year_delta,
  prior.adr AS prior_adr,
  prior_year.adr AS prior_year_adr,
  current_period.adr - prior.adr AS adr_period_delta,
  current_period.adr - prior_year.adr AS adr_year_delta,
  CASE WHEN prior.adr <> 0 THEN (current_period.adr - prior.adr) / abs(prior.adr) END
    AS adr_period_change,
  CASE WHEN prior_year.adr <> 0
    THEN (current_period.adr - prior_year.adr) / abs(prior_year.adr) END
    AS adr_year_change,
  prior.revpar AS prior_revpar,
  prior_year.revpar AS prior_year_revpar,
  current_period.revpar - prior.revpar AS revpar_period_delta,
  current_period.revpar - prior_year.revpar AS revpar_year_delta,
  CASE WHEN prior.revpar <> 0
    THEN (current_period.revpar - prior.revpar) / abs(prior.revpar) END
    AS revpar_period_change,
  CASE WHEN prior_year.revpar <> 0
    THEN (current_period.revpar - prior_year.revpar) / abs(prior_year.revpar) END
    AS revpar_year_change
FROM ota_analytics.period_rollup current_period
LEFT JOIN ota_analytics.period_rollup prior
  ON prior.tenant_id = current_period.tenant_id
 AND prior.hotel_id = current_period.hotel_id
 AND prior.period_type = current_period.period_type
 AND prior.period_start = current_period.period_start - CASE current_period.period_type
   WHEN 'MONTH' THEN interval '1 month'
   WHEN 'QUARTER' THEN interval '3 months'
   WHEN 'HALF_YEAR' THEN interval '6 months'
   ELSE interval '1 year' END
LEFT JOIN ota_analytics.period_rollup prior_year
  ON prior_year.tenant_id = current_period.tenant_id
 AND prior_year.hotel_id = current_period.hotel_id
 AND prior_year.period_type = current_period.period_type
 AND prior_year.period_start = current_period.period_start - interval '1 year';

-- Stay-date occupancy reviews are separate from financial/room-night rollups.
-- A PMS occupancy ratio already includes in-house + reserved rooms. Never add
-- order/check-in counts here, nor average daily percentages without room weights.
CREATE TABLE IF NOT EXISTS ota_analytics.occupancy_target_decision (
  tenant_id text NOT NULL,
  hotel_id text NOT NULL,
  week_start date NOT NULL,
  version integer NOT NULL CHECK (version > 0),
  decision jsonb NOT NULL,
  archived_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, hotel_id, week_start, version)
);

-- Mirror the atomic runtime decision journal into PostgreSQL so the existing
-- encrypted 30 daily / 12 monthly / 3 yearly backups cover approved targets too.
CREATE OR REPLACE FUNCTION ota_analytics.archive_occupancy_targets(document jsonb)
RETURNS bigint LANGUAGE plpgsql
SET search_path = pg_catalog, ota_analytics
AS $$
DECLARE item jsonb; previous jsonb; affected bigint := 0; inserted integer;
BEGIN
  IF document->>'schemaVersion' IS DISTINCT FROM '1' OR jsonb_typeof(document->'plans') IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'OCCUPANCY_TARGET_ARCHIVE_INVALID';
  END IF;
  FOR item IN SELECT value FROM jsonb_array_elements(document->'plans') LOOP
    IF COALESCE(item->>'tenantId', '') = '' OR COALESCE(item->>'hotelId', '') = ''
      OR item->>'weekStart' IS NULL OR item->>'version' IS NULL
      OR jsonb_typeof(item->'points') IS DISTINCT FROM 'array' THEN
      RAISE EXCEPTION 'OCCUPANCY_TARGET_ARCHIVE_INVALID';
    END IF;
    SELECT decision INTO previous FROM ota_analytics.occupancy_target_decision
      WHERE tenant_id = item->>'tenantId' AND hotel_id = item->>'hotelId'
        AND week_start = (item->>'weekStart')::date AND version = (item->>'version')::integer;
    IF previous IS NOT NULL AND previous <> item THEN
      RAISE EXCEPTION 'OCCUPANCY_TARGET_ARCHIVE_VERSION_CONFLICT';
    END IF;
    INSERT INTO ota_analytics.occupancy_target_decision (tenant_id, hotel_id, week_start, version, decision)
      VALUES (item->>'tenantId', item->>'hotelId', (item->>'weekStart')::date, (item->>'version')::integer, item)
      ON CONFLICT DO NOTHING;
    GET DIAGNOSTICS inserted = ROW_COUNT;
    affected := affected + inserted;
  END LOOP;
  DELETE FROM ota_analytics.occupancy_target_decision
    WHERE week_start < (now() AT TIME ZONE 'Asia/Shanghai')::date - interval '5 years';
  RETURN affected;
END
$$;

CREATE TABLE IF NOT EXISTS ota_analytics.occupancy_review_period (
  tenant_id text NOT NULL,
  hotel_id text NOT NULL,
  period_type text NOT NULL CHECK (period_type IN ('WEEK', 'MONTH')),
  period_start date NOT NULL,
  period_end date NOT NULL,
  available_day_count integer NOT NULL,
  expected_day_count integer NOT NULL,
  weighted_occupancy_percent numeric(12,6) NOT NULL,
  room_capacity numeric(18,2) NOT NULL CHECK (room_capacity > 0),
  refreshed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, hotel_id, period_type, period_start)
);

CREATE OR REPLACE FUNCTION ota_analytics.refresh_occupancy_reviews(reference_time timestamptz DEFAULT now())
RETURNS bigint LANGUAGE plpgsql
SET search_path = pg_catalog, ota_analytics
AS $$
DECLARE affected bigint;
BEGIN
  WITH latest AS (
    SELECT DISTINCT ON (tenant_id, hotel_id, business_date)
      tenant_id, hotel_id, business_date, effective_sellable_room_nights,
      CASE WHEN source_system = 'LUOPAN_CLOUD' AND effective_sellable_room_nights > 0
        AND sold_room_nights BETWEEN 0 AND effective_sellable_room_nights
        THEN sold_room_nights / effective_sellable_room_nights ELSE occupancy_rate END AS occupancy_rate
    FROM ota_analytics.daily_operating_fact
    WHERE business_date >= (reference_time AT TIME ZONE 'Asia/Shanghai')::date - interval '2 years'
      AND business_date < (reference_time AT TIME ZONE 'Asia/Shanghai')::date
    ORDER BY tenant_id, hotel_id, business_date, revision DESC
  ), expanded AS (
    SELECT d.*, p.period_type,
      date_trunc(lower(p.period_type), d.business_date)::date AS period_start
    FROM latest d CROSS JOIN (VALUES ('WEEK'), ('MONTH')) p(period_type)
    WHERE occupancy_rate BETWEEN 0 AND 1 AND effective_sellable_room_nights > 0
  ), grouped AS (
    SELECT tenant_id, hotel_id, period_type, period_start,
      (period_start + CASE period_type WHEN 'WEEK' THEN interval '7 days' ELSE interval '1 month' END - interval '1 day')::date AS period_end,
      count(*)::integer AS available_day_count,
      sum(occupancy_rate * effective_sellable_room_nights) * 100 / sum(effective_sellable_room_nights) AS weighted_occupancy_percent,
      sum(effective_sellable_room_nights) AS room_capacity
    FROM expanded GROUP BY tenant_id, hotel_id, period_type, period_start
  )
  INSERT INTO ota_analytics.occupancy_review_period AS existing (
    tenant_id, hotel_id, period_type, period_start, period_end,
    available_day_count, expected_day_count, weighted_occupancy_percent, room_capacity, refreshed_at
  ) SELECT tenant_id, hotel_id, period_type, period_start, period_end,
    available_day_count, period_end - period_start + 1, weighted_occupancy_percent, room_capacity, reference_time
  FROM grouped
  ON CONFLICT (tenant_id, hotel_id, period_type, period_start) DO UPDATE SET
    available_day_count = EXCLUDED.available_day_count,
    weighted_occupancy_percent = EXCLUDED.weighted_occupancy_percent,
    room_capacity = EXCLUDED.room_capacity,
    refreshed_at = EXCLUDED.refreshed_at
  -- Daily retention must never erase part of an already archived review.
  WHERE EXCLUDED.available_day_count >= existing.available_day_count;
  GET DIAGNOSTICS affected = ROW_COUNT;
  DELETE FROM ota_analytics.occupancy_review_period
    WHERE period_end < (reference_time AT TIME ZONE 'Asia/Shanghai')::date - interval '5 years';
  RETURN affected;
END
$$;

CREATE OR REPLACE FUNCTION ota_analytics.occupancy_review_export(reference_time timestamptz DEFAULT now())
RETURNS jsonb LANGUAGE sql STABLE
SET search_path = pg_catalog, ota_analytics
AS $$
  WITH daily AS MATERIALIZED (
    SELECT DISTINCT ON (tenant_id, hotel_id, business_date)
      tenant_id, hotel_id, business_date, observed_at, effective_sellable_room_nights,
      CASE WHEN source_system = 'LUOPAN_CLOUD' AND effective_sellable_room_nights > 0
        AND sold_room_nights BETWEEN 0 AND effective_sellable_room_nights
        THEN sold_room_nights / effective_sellable_room_nights ELSE occupancy_rate END AS occupancy_rate
    FROM ota_analytics.daily_operating_fact
    WHERE business_date >= (reference_time AT TIME ZONE 'Asia/Shanghai')::date - interval '2 years'
      AND business_date < (reference_time AT TIME ZONE 'Asia/Shanghai')::date
    ORDER BY tenant_id, hotel_id, business_date, revision DESC
  ), pace AS MATERIALIZED (
    SELECT DISTINCT ON (h.tenant_id, h.hotel_id, h.business_date, t.cutoff_time)
      h.tenant_id, h.hotel_id, h.business_date, t.cutoff_time, h.observed_at,
      CASE WHEN h.source_system = 'LUOPAN_CLOUD' AND h.effective_sellable_room_nights > 0
        AND h.sold_room_nights BETWEEN 0 AND h.effective_sellable_room_nights
        THEN h.sold_room_nights / h.effective_sellable_room_nights ELSE h.occupancy_rate END AS occupancy_rate
    FROM ota_analytics.hourly_operating_fact h
    CROSS JOIN (VALUES ('12:00'), ('15:00'), ('18:00'), ('21:00'), ('23:00')) t(cutoff_time)
    WHERE h.business_date >= (reference_time AT TIME ZONE 'Asia/Shanghai')::date - interval '2 years'
      AND h.business_date <= (reference_time AT TIME ZONE 'Asia/Shanghai')::date
      AND h.observed_at <= reference_time
      AND h.completeness <> 'UNAVAILABLE'
      AND h.occupancy_rate BETWEEN 0 AND 1 AND h.effective_sellable_room_nights > 0
      -- Strict as-of selection, no look-ahead or stale carry-forward.
      AND h.observed_at <= (h.business_date + t.cutoff_time::time) AT TIME ZONE 'Asia/Shanghai'
      AND h.observed_at >= ((h.business_date + t.cutoff_time::time) AT TIME ZONE 'Asia/Shanghai') - interval '90 minutes'
    ORDER BY h.tenant_id, h.hotel_id, h.business_date, t.cutoff_time, h.observed_at DESC, h.id DESC
  ), daily_group AS (
    SELECT tenant_id, hotel_id, min(business_date) AS first_date,
      jsonb_agg(jsonb_build_object('date', business_date, 'observedAt', observed_at,
        'occupancyPercent', CASE WHEN effective_sellable_room_nights > 0 THEN occupancy_rate * 100 END,
        'roomCount', effective_sellable_room_nights) ORDER BY business_date) AS records
    FROM daily GROUP BY tenant_id, hotel_id
  ), pace_group AS (
    SELECT tenant_id, hotel_id,
      jsonb_agg(jsonb_build_object('date', business_date, 'time', cutoff_time,
        'observedAt', observed_at, 'occupancyPercent', occupancy_rate * 100)
        ORDER BY business_date, cutoff_time) AS records
    FROM pace GROUP BY tenant_id, hotel_id
  ), period_group AS (
    SELECT tenant_id, hotel_id,
      jsonb_agg(jsonb_build_object('type', period_type, 'start', period_start, 'end', period_end,
        'availableDays', available_day_count, 'expectedDays', expected_day_count,
        'occupancyPercent', weighted_occupancy_percent) ORDER BY period_start, period_type) AS records
    FROM ota_analytics.occupancy_review_period GROUP BY tenant_id, hotel_id
  ), scopes AS (
    SELECT tenant_id, hotel_id FROM daily_group UNION
    SELECT tenant_id, hotel_id FROM pace_group UNION
    SELECT tenant_id, hotel_id FROM period_group
  )
  SELECT jsonb_build_object('schemaVersion', 1, 'generatedAt', reference_time,
    'hotels', COALESCE(jsonb_agg(jsonb_build_object('tenantId', s.tenant_id, 'hotelId', s.hotel_id,
      'firstDate', d.first_date, 'daily', COALESCE(d.records, '[]'::jsonb),
      'pace', COALESCE(p.records, '[]'::jsonb), 'periods', COALESCE(r.records, '[]'::jsonb))), '[]'::jsonb))
  FROM scopes s
  LEFT JOIN daily_group d USING (tenant_id, hotel_id)
  LEFT JOIN pace_group p USING (tenant_id, hotel_id)
  LEFT JOIN period_group r USING (tenant_id, hotel_id);
$$;

REVOKE ALL ON ALL TABLES IN SCHEMA ota_analytics FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA ota_analytics FROM PUBLIC;
GRANT USAGE ON SCHEMA ota_analytics TO ota_analytics_reader, ota_analytics_ingester;
GRANT SELECT ON ota_analytics.retention_policy,
  ota_analytics.hourly_operating_fact, ota_analytics.daily_operating_fact,
  ota_analytics.ota_source_fact, ota_analytics.period_rollup,
  ota_analytics.period_comparison, ota_analytics.occupancy_review_period,
  ota_analytics.occupancy_target_decision TO ota_analytics_reader;
GRANT EXECUTE ON FUNCTION ota_analytics.ingest_event(jsonb) TO ota_analytics_ingester;
GRANT EXECUTE ON FUNCTION ota_analytics.ingest_base64_event(text) TO ota_analytics_ingester;
