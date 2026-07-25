-- Store-level WeCom group robot destinations. The credential is encrypted with
-- WECOM_GROUP_ROBOT_ENCRYPTION_KEY before it reaches this table. APIs expose
-- configuration state only, never the address, key, hash, nonce or ciphertext.

CREATE TABLE wecom_group_robot_webhook (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenant(id),
    hotel_org_unit_id UUID NOT NULL,
    webhook_ciphertext BYTEA NOT NULL,
    encryption_nonce BYTEA NOT NULL CHECK (octet_length(encryption_nonce) = 12),
    webhook_hash CHAR(64) NOT NULL,
    row_version BIGINT NOT NULL DEFAULT 0,
    created_by UUID NOT NULL,
    updated_by UUID NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, id),
    UNIQUE (tenant_id, hotel_org_unit_id),
    CHECK (octet_length(webhook_ciphertext) > 16),
    FOREIGN KEY (tenant_id, hotel_org_unit_id) REFERENCES org_unit (tenant_id, id),
    FOREIGN KEY (tenant_id, created_by) REFERENCES user_account (tenant_id, id),
    FOREIGN KEY (tenant_id, updated_by) REFERENCES user_account (tenant_id, id)
);

CREATE INDEX ix_wecom_group_robot_webhook_hotel
    ON wecom_group_robot_webhook (tenant_id, hotel_org_unit_id);

ALTER TABLE wecom_group_robot_webhook ENABLE ROW LEVEL SECURITY;
ALTER TABLE wecom_group_robot_webhook FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON wecom_group_robot_webhook
    USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
    WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

CREATE TRIGGER trg_wecom_group_robot_webhook_updated_at
    BEFORE UPDATE ON wecom_group_robot_webhook
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'hotel_ai_os_app') THEN
        GRANT SELECT, INSERT, UPDATE, DELETE ON wecom_group_robot_webhook TO hotel_ai_os_app;
    END IF;
END $$;
