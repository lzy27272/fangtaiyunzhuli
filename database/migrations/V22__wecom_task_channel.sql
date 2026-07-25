-- WeCom V1 is opt-in at runtime.  The schema is installed unconditionally so
-- enabling the feature never requires an application-side DDL operation.

ALTER TABLE notification_delivery
    ADD COLUMN provider_message_id VARCHAR(200);

CREATE TABLE wecom_user_binding (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenant(id),
    corp_id VARCHAR(128) NOT NULL,
    wecom_user_id VARCHAR(128) NOT NULL,
    account_id UUID NOT NULL,
    preferred_assignment_id UUID,
    status VARCHAR(24) NOT NULL DEFAULT 'ACTIVE'
        CHECK (status IN ('ACTIVE', 'SUSPENDED', 'REVOKED')),
    row_version BIGINT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, id),
    UNIQUE (tenant_id, corp_id, wecom_user_id),
    UNIQUE (tenant_id, corp_id, account_id),
    FOREIGN KEY (tenant_id, account_id) REFERENCES user_account (tenant_id, id),
    FOREIGN KEY (tenant_id, preferred_assignment_id)
        REFERENCES employee_position_assignment (tenant_id, id)
);

CREATE TABLE wecom_chat_binding (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenant(id),
    corp_id VARCHAR(128) NOT NULL,
    chat_id VARCHAR(160) NOT NULL,
    org_unit_id UUID NOT NULL,
    status VARCHAR(24) NOT NULL DEFAULT 'ACTIVE'
        CHECK (status IN ('ACTIVE', 'SUSPENDED', 'REVOKED')),
    allowed_actions JSONB NOT NULL DEFAULT '[]'::jsonb,
    row_version BIGINT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, id),
    UNIQUE (tenant_id, corp_id, chat_id),
    CHECK (jsonb_typeof(allowed_actions) = 'array'),
    FOREIGN KEY (tenant_id, org_unit_id) REFERENCES org_unit (tenant_id, id)
);

CREATE TABLE wecom_inbound_receipt (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenant(id),
    corp_id VARCHAR(128) NOT NULL,
    message_id VARCHAR(200) NOT NULL,
    receipt_type VARCHAR(48) NOT NULL,
    from_user_id VARCHAR(128),
    event_key VARCHAR(240),
    payload_hash CHAR(64) NOT NULL,
    status VARCHAR(24) NOT NULL DEFAULT 'PROCESSING'
        CHECK (status IN ('PROCESSING', 'SUCCEEDED', 'FAILED', 'IGNORED')),
    correlation_id UUID NOT NULL,
    received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    processed_at TIMESTAMPTZ,
    last_error TEXT,
    attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
    last_attempt_at TIMESTAMPTZ,
    row_version BIGINT NOT NULL DEFAULT 0,
    UNIQUE (tenant_id, id),
    UNIQUE (tenant_id, corp_id, message_id),
    CHECK (status = 'PROCESSING' OR processed_at IS NOT NULL),
    CHECK (status <> 'FAILED' OR last_error IS NOT NULL)
);

CREATE TABLE wecom_task_card_binding (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenant(id),
    notification_delivery_id UUID NOT NULL,
    task_id UUID NOT NULL,
    recipient_account_id UUID NOT NULL,
    recipient_assignment_id UUID,
    allowed_command VARCHAR(32) NOT NULL
        CHECK (allowed_command IN ('ACKNOWLEDGE', 'START', 'APPROVE', 'REWORK', 'REJECT')),
    external_event_key VARCHAR(200) NOT NULL,
    expected_task_version BIGINT NOT NULL CHECK (expected_task_version >= 0),
    status VARCHAR(24) NOT NULL DEFAULT 'ACTIVE'
        CHECK (status IN ('ACTIVE', 'CONSUMED', 'EXPIRED', 'REVOKED')),
    expires_at TIMESTAMPTZ NOT NULL,
    consumed_by_account_id UUID,
    consumed_by_assignment_id UUID,
    consumed_receipt_id UUID,
    consumed_at TIMESTAMPTZ,
    row_version BIGINT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, id),
    UNIQUE (tenant_id, external_event_key),
    FOREIGN KEY (tenant_id, notification_delivery_id)
        REFERENCES notification_delivery (tenant_id, id),
    FOREIGN KEY (tenant_id, task_id) REFERENCES management_task (tenant_id, id),
    FOREIGN KEY (tenant_id, recipient_account_id) REFERENCES user_account (tenant_id, id),
    FOREIGN KEY (tenant_id, recipient_assignment_id)
        REFERENCES employee_position_assignment (tenant_id, id),
    FOREIGN KEY (tenant_id, consumed_by_account_id) REFERENCES user_account (tenant_id, id),
    FOREIGN KEY (tenant_id, consumed_by_assignment_id)
        REFERENCES employee_position_assignment (tenant_id, id),
    FOREIGN KEY (tenant_id, consumed_receipt_id) REFERENCES wecom_inbound_receipt (tenant_id, id),
    CHECK ((status = 'CONSUMED') = (consumed_at IS NOT NULL)),
    CHECK (consumed_at IS NULL OR consumed_by_account_id IS NOT NULL)
);

-- Raw OAuth state, the provider authorization code and the browser exchange
-- code are never persisted.  Only SHA-256 digests are retained.
CREATE TABLE wecom_oauth_attempt (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenant(id),
    state_hash CHAR(64) NOT NULL,
    browser_verifier_hash CHAR(64) NOT NULL,
    provider_code_hash CHAR(64),
    exchange_code_hash CHAR(64),
    account_id UUID,
    assignment_id UUID,
    return_path VARCHAR(500) NOT NULL,
    status VARCHAR(24) NOT NULL DEFAULT 'STARTED'
        CHECK (status IN ('STARTED', 'AUTHORIZING', 'AUTHORIZED', 'EXCHANGED', 'FAILED')),
    expires_at TIMESTAMPTZ NOT NULL,
    authorized_at TIMESTAMPTZ,
    exchanged_at TIMESTAMPTZ,
    last_error TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, id),
    UNIQUE (tenant_id, state_hash),
    UNIQUE (tenant_id, provider_code_hash),
    UNIQUE (tenant_id, exchange_code_hash),
    FOREIGN KEY (tenant_id, account_id) REFERENCES user_account (tenant_id, id),
    FOREIGN KEY (tenant_id, assignment_id)
        REFERENCES employee_position_assignment (tenant_id, id),
    CHECK (status IN ('STARTED', 'AUTHORIZING', 'FAILED') OR account_id IS NOT NULL),
    CHECK (status <> 'AUTHORIZED' OR (authorized_at IS NOT NULL AND exchange_code_hash IS NOT NULL)),
    CHECK (status <> 'EXCHANGED' OR exchanged_at IS NOT NULL),
    CHECK (status <> 'FAILED' OR last_error IS NOT NULL)
);

CREATE INDEX ix_wecom_user_binding_account
    ON wecom_user_binding (tenant_id, account_id, status);
CREATE INDEX ix_wecom_chat_binding_org
    ON wecom_chat_binding (tenant_id, org_unit_id, status);
CREATE INDEX ix_wecom_inbound_receipt_received
    ON wecom_inbound_receipt (tenant_id, received_at DESC);
CREATE INDEX ix_wecom_task_card_active
    ON wecom_task_card_binding (tenant_id, task_id, status, expires_at);
CREATE INDEX ix_wecom_oauth_exchange
    ON wecom_oauth_attempt (tenant_id, exchange_code_hash, status, expires_at);

DO $$
DECLARE
    table_name TEXT;
BEGIN
    FOREACH table_name IN ARRAY ARRAY[
        'wecom_user_binding', 'wecom_chat_binding', 'wecom_inbound_receipt',
        'wecom_task_card_binding', 'wecom_oauth_attempt'
    ] LOOP
        EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', table_name);
        EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', table_name);
        EXECUTE format(
            'CREATE POLICY tenant_isolation ON %I USING (tenant_id = nullif(current_setting(''app.tenant_id'', true), '''')::uuid) WITH CHECK (tenant_id = nullif(current_setting(''app.tenant_id'', true), '''')::uuid)',
            table_name
        );
    END LOOP;
END $$;

CREATE TRIGGER trg_wecom_user_binding_updated_at
    BEFORE UPDATE ON wecom_user_binding FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_wecom_chat_binding_updated_at
    BEFORE UPDATE ON wecom_chat_binding FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_wecom_task_card_binding_updated_at
    BEFORE UPDATE ON wecom_task_card_binding FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_wecom_oauth_attempt_updated_at
    BEFORE UPDATE ON wecom_oauth_attempt FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'hotel_ai_os_app') THEN
        GRANT SELECT, INSERT, UPDATE, DELETE ON
            wecom_user_binding, wecom_chat_binding, wecom_inbound_receipt,
            wecom_task_card_binding, wecom_oauth_attempt
        TO hotel_ai_os_app;
    END IF;
END $$;
