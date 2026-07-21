-- Pilot local account authentication. This is an internal-test identity source,
-- not a replacement for the target enterprise SSO/OIDC integration.

ALTER TABLE user_account
    ADD COLUMN password_hash VARCHAR(255),
    ADD COLUMN password_changed_at TIMESTAMPTZ,
    ADD COLUMN failed_login_attempts INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN locked_until TIMESTAMPTZ,
    ADD COLUMN last_login_at TIMESTAMPTZ;

ALTER TABLE user_account
    ADD CONSTRAINT ck_user_account_failed_login_attempts_nonnegative
    CHECK (failed_login_attempts >= 0);

CREATE INDEX idx_user_account_active_login
    ON user_account (tenant_id, lower(login_name))
    WHERE status = 'ACTIVE';

COMMENT ON COLUMN user_account.password_hash IS
    'PBKDF2-HMAC-SHA256 hash used only by the internal Pilot local login channel.';

