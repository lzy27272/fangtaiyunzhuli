-- Professional investment reports: persistent, tenant-isolated history.
-- Inputs and results are stored as snapshots so a prior report can be opened
-- and exported again even if the active cost parameter version changes later.

CREATE TABLE investment_professional_report_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenant(id),
    project_name VARCHAR(100) NOT NULL CHECK (btrim(project_name) <> ''),
    input_snapshot JSONB NOT NULL CHECK (jsonb_typeof(input_snapshot) = 'object'),
    calculation_snapshot JSONB NOT NULL CHECK (jsonb_typeof(calculation_snapshot) = 'object'),
    cost_parameter_version_id UUID NOT NULL,
    generation_count INTEGER NOT NULL DEFAULT 1 CHECK (generation_count > 0),
    lifecycle_status VARCHAR(24) NOT NULL DEFAULT 'ACTIVE'
        CHECK (lifecycle_status IN ('ACTIVE', 'DELETED')),
    row_version BIGINT NOT NULL DEFAULT 0,
    created_by UUID NOT NULL,
    updated_by UUID NOT NULL,
    deleted_by UUID,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_generated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at TIMESTAMPTZ,
    UNIQUE (tenant_id, id),
    CHECK ((lifecycle_status = 'DELETED' AND deleted_by IS NOT NULL AND deleted_at IS NOT NULL)
        OR lifecycle_status = 'ACTIVE'),
    FOREIGN KEY (tenant_id, cost_parameter_version_id)
        REFERENCES investment_cost_parameter_version (tenant_id, id),
    FOREIGN KEY (tenant_id, created_by) REFERENCES user_account (tenant_id, id),
    FOREIGN KEY (tenant_id, updated_by) REFERENCES user_account (tenant_id, id),
    FOREIGN KEY (tenant_id, deleted_by) REFERENCES user_account (tenant_id, id)
);

CREATE INDEX idx_investment_professional_report_history_active
    ON investment_professional_report_history (tenant_id, lifecycle_status, updated_at DESC);

CREATE TRIGGER trg_investment_professional_report_history_updated_at
    BEFORE UPDATE ON investment_professional_report_history
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE investment_professional_report_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE investment_professional_report_history FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON investment_professional_report_history
    USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
    WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'hotel_ai_os_app') THEN
        GRANT SELECT, INSERT, UPDATE ON investment_professional_report_history
        TO hotel_ai_os_app;
    END IF;
END $$;
