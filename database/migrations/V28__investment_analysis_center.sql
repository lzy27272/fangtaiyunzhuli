-- Investment analysis center: auditable cost parameters, immutable formal forecasts,
-- deterministic scenario snapshots, tenant isolation and CEO/platform-admin access only.

CREATE TABLE investment_cost_parameter_version (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenant(id),
    version_no INTEGER NOT NULL CHECK (version_no > 0),
    lifecycle_status VARCHAR(24) NOT NULL DEFAULT 'DRAFT'
        CHECK (lifecycle_status IN ('DRAFT', 'ACTIVE', 'RETIRED')),
    salary_per_person_month NUMERIC(18,2) NOT NULL CHECK (salary_per_person_month >= 0),
    consumables_per_room_night NUMERIC(18,2) NOT NULL CHECK (consumables_per_room_night >= 0),
    linen_per_room_night NUMERIC(18,2) NOT NULL CHECK (linen_per_room_night >= 0),
    utilities_per_room_night NUMERIC(18,2) NOT NULL CHECK (utilities_per_room_night >= 0),
    three_diamond_operations_per_room_night NUMERIC(18,2) NOT NULL
        CHECK (three_diamond_operations_per_room_night >= 0),
    four_diamond_operations_per_room_night NUMERIC(18,2) NOT NULL
        CHECK (four_diamond_operations_per_room_night >= 0),
    content_hash CHAR(64) NOT NULL,
    row_version BIGINT NOT NULL DEFAULT 0,
    created_by UUID,
    activated_by UUID,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    activated_at TIMESTAMPTZ,
    retired_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, id),
    UNIQUE (tenant_id, version_no),
    CHECK ((lifecycle_status = 'ACTIVE' AND activated_at IS NOT NULL AND activated_by IS NOT NULL)
        OR lifecycle_status <> 'ACTIVE'),
    FOREIGN KEY (tenant_id, created_by) REFERENCES user_account (tenant_id, id),
    FOREIGN KEY (tenant_id, activated_by) REFERENCES user_account (tenant_id, id)
);

CREATE UNIQUE INDEX ux_investment_cost_parameter_active
    ON investment_cost_parameter_version (tenant_id)
    WHERE lifecycle_status = 'ACTIVE';

CREATE TABLE investment_project_number_counter (
    tenant_id UUID NOT NULL REFERENCES tenant(id),
    year_month CHAR(6) NOT NULL CHECK (year_month ~ '^[0-9]{6}$'),
    next_number INTEGER NOT NULL CHECK (next_number > 0),
    PRIMARY KEY (tenant_id, year_month)
);

CREATE TABLE investment_project (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenant(id),
    project_no VARCHAR(32) NOT NULL,
    name VARCHAR(100) NOT NULL CHECK (btrim(name) <> ''),
    lifecycle_status VARCHAR(24) NOT NULL DEFAULT 'ACTIVE'
        CHECK (lifecycle_status IN ('ACTIVE', 'ARCHIVED')),
    current_formal_version_id UUID,
    row_version BIGINT NOT NULL DEFAULT 0,
    created_by UUID NOT NULL,
    updated_by UUID NOT NULL,
    archived_by UUID,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    archived_at TIMESTAMPTZ,
    UNIQUE (tenant_id, id),
    UNIQUE (tenant_id, project_no),
    FOREIGN KEY (tenant_id, created_by) REFERENCES user_account (tenant_id, id),
    FOREIGN KEY (tenant_id, updated_by) REFERENCES user_account (tenant_id, id),
    FOREIGN KEY (tenant_id, archived_by) REFERENCES user_account (tenant_id, id)
);

CREATE TABLE investment_plan_version (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenant(id),
    project_id UUID NOT NULL,
    version_no INTEGER NOT NULL CHECK (version_no > 0),
    lifecycle_status VARCHAR(24) NOT NULL DEFAULT 'DRAFT'
        CHECK (lifecycle_status IN ('DRAFT', 'FORMAL', 'HISTORICAL')),
    project_name_snapshot VARCHAR(100) NOT NULL CHECK (btrim(project_name_snapshot) <> ''),
    rent_per_sqm_month NUMERIC(18,2) NOT NULL CHECK (rent_per_sqm_month >= 0),
    property_area_sqm NUMERIC(18,2) NOT NULL CHECK (property_area_sqm > 0),
    property_fee_per_sqm_month NUMERIC(18,2) NOT NULL CHECK (property_fee_per_sqm_month >= 0),
    room_count INTEGER NOT NULL CHECK (room_count > 0),
    staff_count INTEGER NOT NULL CHECK (staff_count > 0),
    positioning VARCHAR(24) NOT NULL CHECK (positioning IN ('THREE_DIAMOND', 'FOUR_DIAMOND')),
    management_fee_rate NUMERIC(6,5) NOT NULL CHECK (management_fee_rate BETWEEN 0.01 AND 0.05),
    selling_room_rate NUMERIC(18,2) NOT NULL CHECK (selling_room_rate > 0),
    investment_total NUMERIC(20,2) NOT NULL CHECK (investment_total > 0),
    notes VARCHAR(1000),
    cost_parameter_version_id UUID NOT NULL,
    calculation_snapshot JSONB NOT NULL CHECK (jsonb_typeof(calculation_snapshot) = 'object'),
    reviewed_analysis TEXT,
    analysis_origin VARCHAR(24) NOT NULL DEFAULT 'RULE_FALLBACK'
        CHECK (analysis_origin IN ('RULE_FALLBACK', 'AI_GATEWAY', 'MANUAL_REVIEW')),
    content_hash CHAR(64) NOT NULL,
    row_version BIGINT NOT NULL DEFAULT 0,
    created_by UUID NOT NULL,
    updated_by UUID NOT NULL,
    confirmed_by UUID,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    confirmed_at TIMESTAMPTZ,
    UNIQUE (tenant_id, id),
    UNIQUE (tenant_id, project_id, version_no),
    CHECK ((lifecycle_status IN ('FORMAL', 'HISTORICAL') AND confirmed_by IS NOT NULL AND confirmed_at IS NOT NULL)
        OR lifecycle_status = 'DRAFT'),
    FOREIGN KEY (tenant_id, project_id) REFERENCES investment_project (tenant_id, id),
    FOREIGN KEY (tenant_id, cost_parameter_version_id)
        REFERENCES investment_cost_parameter_version (tenant_id, id),
    FOREIGN KEY (tenant_id, created_by) REFERENCES user_account (tenant_id, id),
    FOREIGN KEY (tenant_id, updated_by) REFERENCES user_account (tenant_id, id),
    FOREIGN KEY (tenant_id, confirmed_by) REFERENCES user_account (tenant_id, id)
);

ALTER TABLE investment_project
    ADD CONSTRAINT fk_investment_project_current_formal
    FOREIGN KEY (tenant_id, current_formal_version_id)
    REFERENCES investment_plan_version (tenant_id, id);

CREATE INDEX idx_investment_project_status
    ON investment_project (tenant_id, lifecycle_status, updated_at DESC);
CREATE INDEX idx_investment_plan_project
    ON investment_plan_version (tenant_id, project_id, version_no DESC);

CREATE TRIGGER trg_investment_cost_parameter_updated_at
    BEFORE UPDATE ON investment_cost_parameter_version
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_investment_project_updated_at
    BEFORE UPDATE ON investment_project
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_investment_plan_updated_at
    BEFORE UPDATE ON investment_plan_version
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE OR REPLACE FUNCTION protect_investment_plan_version() RETURNS trigger AS $$
BEGIN
    IF TG_OP = 'DELETE' AND OLD.lifecycle_status IN ('FORMAL', 'HISTORICAL') THEN
        RAISE EXCEPTION 'formal investment forecasts are immutable';
    END IF;
    IF TG_OP = 'UPDATE' AND OLD.lifecycle_status IN ('FORMAL', 'HISTORICAL') THEN
        IF ROW(
            NEW.project_id, NEW.version_no, NEW.project_name_snapshot,
            NEW.rent_per_sqm_month, NEW.property_area_sqm, NEW.property_fee_per_sqm_month,
            NEW.room_count, NEW.staff_count, NEW.positioning, NEW.management_fee_rate,
            NEW.selling_room_rate, NEW.investment_total, NEW.notes,
            NEW.cost_parameter_version_id, NEW.calculation_snapshot,
            NEW.reviewed_analysis, NEW.analysis_origin, NEW.content_hash,
            NEW.created_by, NEW.confirmed_by, NEW.created_at, NEW.confirmed_at
        ) IS DISTINCT FROM ROW(
            OLD.project_id, OLD.version_no, OLD.project_name_snapshot,
            OLD.rent_per_sqm_month, OLD.property_area_sqm, OLD.property_fee_per_sqm_month,
            OLD.room_count, OLD.staff_count, OLD.positioning, OLD.management_fee_rate,
            OLD.selling_room_rate, OLD.investment_total, OLD.notes,
            OLD.cost_parameter_version_id, OLD.calculation_snapshot,
            OLD.reviewed_analysis, OLD.analysis_origin, OLD.content_hash,
            OLD.created_by, OLD.confirmed_by, OLD.created_at, OLD.confirmed_at
        ) THEN
            RAISE EXCEPTION 'formal investment forecasts are immutable';
        END IF;
        IF OLD.lifecycle_status = 'HISTORICAL' AND NEW.lifecycle_status <> 'HISTORICAL' THEN
            RAISE EXCEPTION 'historical investment forecasts cannot be reactivated';
        END IF;
        IF OLD.lifecycle_status = 'FORMAL' AND NEW.lifecycle_status NOT IN ('FORMAL', 'HISTORICAL') THEN
            RAISE EXCEPTION 'formal investment forecasts can only become historical';
        END IF;
    END IF;
    RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_investment_plan_immutable
    BEFORE UPDATE OR DELETE ON investment_plan_version
    FOR EACH ROW EXECUTE FUNCTION protect_investment_plan_version();

CREATE OR REPLACE FUNCTION protect_investment_cost_parameter_version() RETURNS trigger AS $$
BEGIN
    IF TG_OP = 'DELETE' AND OLD.lifecycle_status <> 'DRAFT' THEN
        RAISE EXCEPTION 'activated investment cost parameters cannot be deleted';
    END IF;
    IF TG_OP = 'UPDATE' AND OLD.lifecycle_status IN ('ACTIVE', 'RETIRED') THEN
        IF ROW(
            NEW.version_no, NEW.salary_per_person_month, NEW.consumables_per_room_night,
            NEW.linen_per_room_night, NEW.utilities_per_room_night,
            NEW.three_diamond_operations_per_room_night,
            NEW.four_diamond_operations_per_room_night, NEW.content_hash,
            NEW.created_by, NEW.activated_by, NEW.created_at, NEW.activated_at
        ) IS DISTINCT FROM ROW(
            OLD.version_no, OLD.salary_per_person_month, OLD.consumables_per_room_night,
            OLD.linen_per_room_night, OLD.utilities_per_room_night,
            OLD.three_diamond_operations_per_room_night,
            OLD.four_diamond_operations_per_room_night, OLD.content_hash,
            OLD.created_by, OLD.activated_by, OLD.created_at, OLD.activated_at
        ) THEN
            RAISE EXCEPTION 'activated investment cost parameters are immutable';
        END IF;
        IF OLD.lifecycle_status = 'RETIRED' AND NEW.lifecycle_status <> 'RETIRED' THEN
            RAISE EXCEPTION 'retired investment cost parameters cannot be reactivated';
        END IF;
        IF OLD.lifecycle_status = 'ACTIVE' AND NEW.lifecycle_status NOT IN ('ACTIVE', 'RETIRED') THEN
            RAISE EXCEPTION 'active investment cost parameters can only be retired';
        END IF;
    END IF;
    RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_investment_cost_parameter_immutable
    BEFORE UPDATE OR DELETE ON investment_cost_parameter_version
    FOR EACH ROW EXECUTE FUNCTION protect_investment_cost_parameter_version();

INSERT INTO permission (code, resource, action, description) VALUES
    ('investment.read', 'investment_analysis', 'read', '查看全部投资测算项目及版本'),
    ('investment.manage', 'investment_analysis', 'manage', '新建、编辑、复制及归档投资测算'),
    ('investment.confirm', 'investment_analysis', 'confirm', '确认投资测算正式预测'),
    ('investment.configure', 'investment_cost_parameter', 'configure', '配置投资测算成本参数草稿'),
    ('investment.parameter-confirm', 'investment_cost_parameter', 'confirm', '确认启用投资测算成本参数'),
    ('investment.export', 'investment_analysis', 'export', '导出投资测算PDF和Excel'),
    ('investment.audit', 'investment_analysis', 'audit', '查看投资测算审计记录')
ON CONFLICT (code) DO NOTHING;

DO $$
DECLARE
    tenant_record RECORD;
BEGIN
    FOR tenant_record IN SELECT id FROM tenant LOOP
        PERFORM set_config('app.tenant_id', tenant_record.id::text, true);

        INSERT INTO investment_cost_parameter_version (
            tenant_id, version_no, lifecycle_status, salary_per_person_month,
            consumables_per_room_night, linen_per_room_night, utilities_per_room_night,
            three_diamond_operations_per_room_night,
            four_diamond_operations_per_room_night, content_hash,
            activated_by, activated_at
        )
        SELECT tenant_record.id, 1, 'ACTIVE', 5500, 6, 8, 12, 15, 30,
               encode(digest('5500|6|8|12|15|30', 'sha256'), 'hex'), account.id, now()
        FROM user_account account
        JOIN role_assignment assignment
          ON assignment.tenant_id = account.tenant_id AND assignment.account_id = account.id
        JOIN app_role role
          ON role.tenant_id = assignment.tenant_id AND role.id = assignment.role_id
        WHERE account.tenant_id = tenant_record.id
          AND role.code = 'CEO'
          AND account.status = 'ACTIVE'
        ORDER BY assignment.created_at
        LIMIT 1
        ON CONFLICT (tenant_id, version_no) DO NOTHING;

        INSERT INTO role_permission (tenant_id, role_id, permission_id)
        SELECT tenant_record.id, role.id, permission_item.id
        FROM app_role role
        CROSS JOIN permission permission_item
        WHERE role.tenant_id = tenant_record.id
          AND role.code = 'CEO'
          AND permission_item.code = ANY (ARRAY[
              'investment.read', 'investment.manage', 'investment.confirm',
              'investment.parameter-confirm', 'investment.export', 'investment.audit'
          ])
        ON CONFLICT DO NOTHING;

        INSERT INTO role_permission (tenant_id, role_id, permission_id)
        SELECT tenant_record.id, role.id, permission_item.id
        FROM app_role role
        CROSS JOIN permission permission_item
        WHERE role.tenant_id = tenant_record.id
          AND role.code = 'PLATFORM_ADMIN'
          AND permission_item.code LIKE 'investment.%'
        ON CONFLICT DO NOTHING;
    END LOOP;
END $$;

DO $$
DECLARE
    table_name TEXT;
BEGIN
    FOREACH table_name IN ARRAY ARRAY[
        'investment_cost_parameter_version', 'investment_project_number_counter',
        'investment_project', 'investment_plan_version'
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
        GRANT SELECT, INSERT, UPDATE, DELETE ON
            investment_cost_parameter_version, investment_project_number_counter,
            investment_project, investment_plan_version
        TO hotel_ai_os_app;
    END IF;
END $$;
