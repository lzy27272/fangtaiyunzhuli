CREATE TABLE rule_definition (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenant(id),
    code VARCHAR(64) NOT NULL,
    name VARCHAR(180) NOT NULL,
    event_type VARCHAR(120) NOT NULL,
    owner_org_unit_id UUID,
    description TEXT,
    status VARCHAR(24) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'INACTIVE')),
    created_by UUID,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, id),
    UNIQUE (tenant_id, code),
    FOREIGN KEY (tenant_id, owner_org_unit_id) REFERENCES org_unit (tenant_id, id),
    FOREIGN KEY (tenant_id, created_by) REFERENCES user_account (tenant_id, id)
);

CREATE TABLE rule_version (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenant(id),
    rule_id UUID NOT NULL,
    version_no INTEGER NOT NULL CHECK (version_no > 0),
    lifecycle_status VARCHAR(24) NOT NULL DEFAULT 'DRAFT'
        CHECK (lifecycle_status IN ('DRAFT', 'PUBLISHED', 'DISABLED', 'RETIRED')),
    condition_ast JSONB NOT NULL DEFAULT '{}'::jsonb,
    actions JSONB NOT NULL DEFAULT '[]'::jsonb,
    priority INTEGER NOT NULL DEFAULT 100 CHECK (priority BETWEEN 0 AND 1000),
    cooldown_minutes INTEGER NOT NULL DEFAULT 0 CHECK (cooldown_minutes >= 0),
    effective_from TIMESTAMPTZ,
    effective_to TIMESTAMPTZ,
    content_hash CHAR(64) NOT NULL,
    row_version BIGINT NOT NULL DEFAULT 0,
    published_by UUID,
    published_at TIMESTAMPTZ,
    created_by UUID,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, id),
    UNIQUE (tenant_id, rule_id, version_no),
    CHECK (jsonb_typeof(condition_ast) = 'object'),
    CHECK (jsonb_typeof(actions) = 'array'),
    CHECK (effective_to IS NULL OR effective_from IS NULL OR effective_to >= effective_from),
    FOREIGN KEY (tenant_id, rule_id) REFERENCES rule_definition (tenant_id, id),
    FOREIGN KEY (tenant_id, published_by) REFERENCES user_account (tenant_id, id),
    FOREIGN KEY (tenant_id, created_by) REFERENCES user_account (tenant_id, id)
);

CREATE TABLE rule_scope (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenant(id),
    rule_version_id UUID NOT NULL,
    scope_type VARCHAR(24) NOT NULL CHECK (scope_type IN ('TENANT', 'BRAND', 'ORG_UNIT', 'ORG_TREE', 'POSITION')),
    brand_id UUID,
    org_unit_id UUID,
    position_id UUID,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, id),
    FOREIGN KEY (tenant_id, rule_version_id) REFERENCES rule_version (tenant_id, id) ON DELETE CASCADE,
    FOREIGN KEY (tenant_id, brand_id) REFERENCES brand (tenant_id, id),
    FOREIGN KEY (tenant_id, org_unit_id) REFERENCES org_unit (tenant_id, id),
    FOREIGN KEY (tenant_id, position_id) REFERENCES position_definition (tenant_id, id),
    CHECK (
        (scope_type = 'TENANT' AND brand_id IS NULL AND org_unit_id IS NULL AND position_id IS NULL)
        OR (scope_type = 'BRAND' AND brand_id IS NOT NULL AND org_unit_id IS NULL AND position_id IS NULL)
        OR (scope_type IN ('ORG_UNIT', 'ORG_TREE') AND brand_id IS NULL AND org_unit_id IS NOT NULL AND position_id IS NULL)
        OR (scope_type = 'POSITION' AND brand_id IS NULL AND org_unit_id IS NULL AND position_id IS NOT NULL)
    )
);

CREATE TABLE rule_evaluation (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenant(id),
    management_event_id UUID NOT NULL,
    rule_version_id UUID NOT NULL,
    facts_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
    matched BOOLEAN NOT NULL,
    evaluation_status VARCHAR(24) NOT NULL DEFAULT 'COMPLETED'
        CHECK (evaluation_status IN ('COMPLETED', 'FAILED')),
    result JSONB NOT NULL DEFAULT '{}'::jsonb,
    failure_reason TEXT,
    evaluated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, id),
    UNIQUE (tenant_id, management_event_id, rule_version_id),
    FOREIGN KEY (tenant_id, management_event_id) REFERENCES management_event (tenant_id, id),
    FOREIGN KEY (tenant_id, rule_version_id) REFERENCES rule_version (tenant_id, id)
);

CREATE TABLE rule_action_execution (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenant(id),
    rule_evaluation_id UUID NOT NULL,
    management_event_id UUID NOT NULL,
    rule_version_id UUID NOT NULL,
    action_key VARCHAR(80) NOT NULL,
    action_type VARCHAR(40) NOT NULL CHECK (action_type IN ('CREATE_TASK', 'CREATE_NOTIFICATION')),
    idempotency_key VARCHAR(200) NOT NULL,
    status VARCHAR(24) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'SUCCEEDED', 'FAILED')),
    target_id UUID,
    attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
    last_error TEXT,
    executed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, id),
    UNIQUE (tenant_id, rule_version_id, management_event_id, action_key),
    UNIQUE (tenant_id, idempotency_key),
    FOREIGN KEY (tenant_id, rule_evaluation_id) REFERENCES rule_evaluation (tenant_id, id),
    FOREIGN KEY (tenant_id, management_event_id) REFERENCES management_event (tenant_id, id),
    FOREIGN KEY (tenant_id, rule_version_id) REFERENCES rule_version (tenant_id, id)
);

CREATE INDEX ix_rule_definition_event ON rule_definition (tenant_id, event_type, status);
CREATE INDEX ix_rule_version_active ON rule_version (tenant_id, lifecycle_status, effective_from, effective_to, priority);
CREATE INDEX ix_rule_scope_lookup ON rule_scope (tenant_id, scope_type, org_unit_id, position_id, brand_id);
CREATE INDEX ix_rule_evaluation_event ON rule_evaluation (tenant_id, management_event_id, evaluated_at DESC);
CREATE INDEX ix_rule_action_pending ON rule_action_execution (tenant_id, status, created_at) WHERE status <> 'SUCCEEDED';

CREATE TRIGGER trg_rule_definition_updated_at BEFORE UPDATE ON rule_definition
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_rule_version_updated_at BEFORE UPDATE ON rule_version
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_rule_action_execution_updated_at BEFORE UPDATE ON rule_action_execution
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE OR REPLACE FUNCTION protect_published_rule_version() RETURNS trigger AS $$
BEGIN
    IF OLD.lifecycle_status IN ('PUBLISHED', 'DISABLED', 'RETIRED') THEN
        IF NEW.rule_id IS DISTINCT FROM OLD.rule_id
           OR NEW.version_no IS DISTINCT FROM OLD.version_no
           OR NEW.condition_ast IS DISTINCT FROM OLD.condition_ast
           OR NEW.actions IS DISTINCT FROM OLD.actions
           OR NEW.priority IS DISTINCT FROM OLD.priority
           OR NEW.cooldown_minutes IS DISTINCT FROM OLD.cooldown_minutes
           OR NEW.content_hash IS DISTINCT FROM OLD.content_hash
           OR NEW.effective_from IS DISTINCT FROM OLD.effective_from THEN
            RAISE EXCEPTION 'published rule versions are immutable';
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_rule_version_immutable BEFORE UPDATE ON rule_version
    FOR EACH ROW EXECUTE FUNCTION protect_published_rule_version();

DO $$
DECLARE
    table_name TEXT;
BEGIN
    FOREACH table_name IN ARRAY ARRAY[
        'rule_definition', 'rule_version', 'rule_scope', 'rule_evaluation', 'rule_action_execution'
    ] LOOP
        EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', table_name);
        EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', table_name);
        EXECUTE format(
            'CREATE POLICY tenant_isolation ON %I USING (tenant_id = nullif(current_setting(''app.tenant_id'', true), '''')::uuid) WITH CHECK (tenant_id = nullif(current_setting(''app.tenant_id'', true), '''')::uuid)',
            table_name
        );
    END LOOP;
END $$;

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'hotel_ai_os_app') THEN
        GRANT SELECT, INSERT, UPDATE, DELETE ON rule_definition, rule_version, rule_scope,
            rule_evaluation, rule_action_execution TO hotel_ai_os_app;
    END IF;
END $$;
