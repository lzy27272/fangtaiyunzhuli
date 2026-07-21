-- Sprint 2: reliable outbox delivery metadata, consumer inbox and normalized management events.

ALTER TABLE outbox_event
    ADD CONSTRAINT uq_outbox_event_tenant_id_id UNIQUE (tenant_id, id),
    ADD COLUMN schema_version INTEGER NOT NULL DEFAULT 1 CHECK (schema_version > 0),
    ADD COLUMN status VARCHAR(24) NOT NULL DEFAULT 'PENDING',
    ADD COLUMN available_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    ADD COLUMN locked_by VARCHAR(120),
    ADD COLUMN locked_until TIMESTAMPTZ,
    ADD COLUMN last_error TEXT,
    ADD COLUMN dead_lettered_at TIMESTAMPTZ,
    ADD COLUMN row_version BIGINT NOT NULL DEFAULT 0;

UPDATE outbox_event
SET status = CASE WHEN published_at IS NULL THEN 'PENDING' ELSE 'PUBLISHED' END;

ALTER TABLE outbox_event
    ADD CONSTRAINT ck_outbox_status
        CHECK (status IN ('PENDING', 'PROCESSING', 'PUBLISHED', 'FAILED', 'DEAD_LETTER')),
    ADD CONSTRAINT ck_outbox_dead_letter
        CHECK (status <> 'DEAD_LETTER' OR dead_lettered_at IS NOT NULL);

DROP INDEX IF EXISTS ix_outbox_unpublished;
CREATE INDEX ix_outbox_delivery_queue
    ON outbox_event (status, available_at, occurred_at)
    WHERE status IN ('PENDING', 'FAILED');
CREATE INDEX ix_outbox_lock_expiry
    ON outbox_event (locked_until)
    WHERE status = 'PROCESSING';

CREATE TABLE event_consumer_inbox (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenant(id),
    consumer_code VARCHAR(120) NOT NULL,
    outbox_event_id UUID NOT NULL,
    status VARCHAR(24) NOT NULL DEFAULT 'RECEIVED'
        CHECK (status IN ('RECEIVED', 'PROCESSING', 'PROCESSED', 'FAILED', 'DEAD_LETTER')),
    attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
    locked_by VARCHAR(120),
    locked_until TIMESTAMPTZ,
    last_error TEXT,
    processed_at TIMESTAMPTZ,
    row_version BIGINT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, id),
    UNIQUE (tenant_id, consumer_code, outbox_event_id),
    CHECK (status <> 'PROCESSED' OR processed_at IS NOT NULL),
    FOREIGN KEY (tenant_id, outbox_event_id) REFERENCES outbox_event (tenant_id, id)
);

CREATE TABLE management_event (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenant(id),
    source_event_id UUID NOT NULL,
    event_type VARCHAR(120) NOT NULL,
    schema_version INTEGER NOT NULL DEFAULT 1 CHECK (schema_version > 0),
    org_unit_id UUID,
    position_assignment_id UUID,
    occurred_at TIMESTAMPTZ NOT NULL,
    payload_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
    processing_status VARCHAR(24) NOT NULL DEFAULT 'PENDING'
        CHECK (processing_status IN ('PENDING', 'PROCESSING', 'PROCESSED', 'FAILED', 'DEAD_LETTER')),
    locked_by VARCHAR(120),
    locked_until TIMESTAMPTZ,
    attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
    last_error TEXT,
    row_version BIGINT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, id),
    UNIQUE (tenant_id, source_event_id, event_type),
    FOREIGN KEY (tenant_id, source_event_id) REFERENCES outbox_event (tenant_id, id),
    FOREIGN KEY (tenant_id, org_unit_id) REFERENCES org_unit (tenant_id, id),
    FOREIGN KEY (tenant_id, position_assignment_id)
        REFERENCES employee_position_assignment (tenant_id, id)
);

CREATE INDEX ix_event_consumer_inbox_queue
    ON event_consumer_inbox (tenant_id, consumer_code, status, locked_until, created_at);
CREATE INDEX ix_management_event_queue
    ON management_event (tenant_id, processing_status, occurred_at);
CREATE INDEX ix_management_event_scope
    ON management_event (tenant_id, org_unit_id, event_type, occurred_at DESC);

ALTER TABLE event_consumer_inbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE event_consumer_inbox FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON event_consumer_inbox
    USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
    WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE management_event ENABLE ROW LEVEL SECURITY;
ALTER TABLE management_event FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON management_event
    USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
    WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

CREATE TRIGGER trg_event_consumer_inbox_updated_at
BEFORE UPDATE ON event_consumer_inbox
FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_management_event_updated_at
BEFORE UPDATE ON management_event
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'hotel_ai_os_app') THEN
        GRANT SELECT, INSERT, UPDATE, DELETE ON event_consumer_inbox, management_event TO hotel_ai_os_app;
    END IF;
END $$;
