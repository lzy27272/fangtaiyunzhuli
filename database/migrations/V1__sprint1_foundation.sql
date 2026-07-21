CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE tenant (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code VARCHAR(64) NOT NULL UNIQUE,
    name VARCHAR(160) NOT NULL,
    status VARCHAR(24) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'SUSPENDED', 'CLOSED')),
    timezone VARCHAR(64) NOT NULL DEFAULT 'Asia/Shanghai',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE brand (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenant(id),
    code VARCHAR(64) NOT NULL,
    name VARCHAR(160) NOT NULL,
    status VARCHAR(24) NOT NULL DEFAULT 'ACTIVE',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, id),
    UNIQUE (tenant_id, code)
);

CREATE TABLE org_unit (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenant(id),
    parent_id UUID,
    code VARCHAR(64) NOT NULL,
    name VARCHAR(160) NOT NULL,
    unit_type VARCHAR(24) NOT NULL CHECK (unit_type IN ('GROUP', 'REGION', 'HOTEL', 'DEPARTMENT')),
    status VARCHAR(24) NOT NULL DEFAULT 'ACTIVE',
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, id),
    UNIQUE (tenant_id, code),
    CONSTRAINT fk_org_parent_same_tenant FOREIGN KEY (tenant_id, parent_id)
        REFERENCES org_unit (tenant_id, id) DEFERRABLE INITIALLY DEFERRED
);

CREATE TABLE org_unit_closure (
    tenant_id UUID NOT NULL REFERENCES tenant(id),
    ancestor_id UUID NOT NULL,
    descendant_id UUID NOT NULL,
    depth INTEGER NOT NULL CHECK (depth >= 0),
    PRIMARY KEY (tenant_id, ancestor_id, descendant_id),
    FOREIGN KEY (tenant_id, ancestor_id) REFERENCES org_unit (tenant_id, id) ON DELETE CASCADE,
    FOREIGN KEY (tenant_id, descendant_id) REFERENCES org_unit (tenant_id, id) ON DELETE CASCADE
);

CREATE TABLE hotel_profile (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenant(id),
    org_unit_id UUID NOT NULL,
    brand_id UUID,
    property_code VARCHAR(64) NOT NULL,
    city VARCHAR(100),
    room_count INTEGER CHECK (room_count IS NULL OR room_count >= 0),
    opening_date DATE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, id),
    UNIQUE (tenant_id, org_unit_id),
    UNIQUE (tenant_id, property_code),
    FOREIGN KEY (tenant_id, org_unit_id) REFERENCES org_unit (tenant_id, id),
    FOREIGN KEY (tenant_id, brand_id) REFERENCES brand (tenant_id, id)
);

CREATE TABLE user_account (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenant(id),
    login_name VARCHAR(120) NOT NULL,
    display_name VARCHAR(120) NOT NULL,
    mobile VARCHAR(32),
    status VARCHAR(24) NOT NULL DEFAULT 'ACTIVE',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, id),
    UNIQUE (tenant_id, login_name)
);

CREATE TABLE employee (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenant(id),
    account_id UUID,
    employee_no VARCHAR(64) NOT NULL,
    name VARCHAR(120) NOT NULL,
    mobile VARCHAR(32),
    employment_status VARCHAR(24) NOT NULL DEFAULT 'ACTIVE',
    hired_on DATE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, id),
    UNIQUE (tenant_id, employee_no),
    FOREIGN KEY (tenant_id, account_id) REFERENCES user_account (tenant_id, id)
);

CREATE TABLE position_definition (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenant(id),
    code VARCHAR(64) NOT NULL,
    name VARCHAR(120) NOT NULL,
    job_family VARCHAR(64) NOT NULL,
    level_code VARCHAR(32),
    status VARCHAR(24) NOT NULL DEFAULT 'ACTIVE',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, id),
    UNIQUE (tenant_id, code)
);

CREATE TABLE employee_position_assignment (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenant(id),
    employee_id UUID NOT NULL,
    org_unit_id UUID NOT NULL,
    position_id UUID NOT NULL,
    manager_assignment_id UUID,
    is_primary BOOLEAN NOT NULL DEFAULT false,
    assignment_type VARCHAR(24) NOT NULL DEFAULT 'PERMANENT' CHECK (assignment_type IN ('PERMANENT', 'TEMPORARY', 'ACTING')),
    valid_from DATE NOT NULL,
    valid_to DATE,
    status VARCHAR(24) NOT NULL DEFAULT 'ACTIVE',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, id),
    CHECK (valid_to IS NULL OR valid_to >= valid_from),
    FOREIGN KEY (tenant_id, employee_id) REFERENCES employee (tenant_id, id),
    FOREIGN KEY (tenant_id, org_unit_id) REFERENCES org_unit (tenant_id, id),
    FOREIGN KEY (tenant_id, position_id) REFERENCES position_definition (tenant_id, id),
    FOREIGN KEY (tenant_id, manager_assignment_id) REFERENCES employee_position_assignment (tenant_id, id)
);

CREATE UNIQUE INDEX ux_assignment_primary_active
    ON employee_position_assignment (tenant_id, employee_id)
    WHERE is_primary = true AND status = 'ACTIVE' AND valid_to IS NULL;

CREATE TABLE permission (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code VARCHAR(120) NOT NULL UNIQUE,
    resource VARCHAR(80) NOT NULL,
    action VARCHAR(40) NOT NULL,
    description VARCHAR(240)
);

CREATE TABLE app_role (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenant(id),
    code VARCHAR(64) NOT NULL,
    name VARCHAR(120) NOT NULL,
    role_type VARCHAR(24) NOT NULL DEFAULT 'CUSTOM',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, id),
    UNIQUE (tenant_id, code)
);

CREATE TABLE role_permission (
    tenant_id UUID NOT NULL REFERENCES tenant(id),
    role_id UUID NOT NULL,
    permission_id UUID NOT NULL REFERENCES permission(id),
    PRIMARY KEY (tenant_id, role_id, permission_id),
    FOREIGN KEY (tenant_id, role_id) REFERENCES app_role (tenant_id, id) ON DELETE CASCADE
);

CREATE TABLE role_assignment (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenant(id),
    account_id UUID NOT NULL,
    role_id UUID NOT NULL,
    scope_org_unit_id UUID,
    scope_type VARCHAR(24) NOT NULL DEFAULT 'ORG_TREE' CHECK (scope_type IN ('SELF', 'ORG_UNIT', 'ORG_TREE', 'TENANT')),
    valid_from TIMESTAMPTZ NOT NULL DEFAULT now(),
    valid_to TIMESTAMPTZ,
    granted_by UUID,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, id),
    CHECK (valid_to IS NULL OR valid_to >= valid_from),
    FOREIGN KEY (tenant_id, account_id) REFERENCES user_account (tenant_id, id),
    FOREIGN KEY (tenant_id, role_id) REFERENCES app_role (tenant_id, id),
    FOREIGN KEY (tenant_id, scope_org_unit_id) REFERENCES org_unit (tenant_id, id),
    FOREIGN KEY (tenant_id, granted_by) REFERENCES user_account (tenant_id, id)
);

CREATE TABLE standard_category (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenant(id),
    code VARCHAR(64) NOT NULL,
    name VARCHAR(120) NOT NULL,
    category_type VARCHAR(24) NOT NULL CHECK (category_type IN ('POSITION', 'WORK', 'SOP', 'INSPECTION', 'KPI')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, id),
    UNIQUE (tenant_id, code)
);

CREATE TABLE standard_definition (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenant(id),
    category_id UUID NOT NULL,
    code VARCHAR(64) NOT NULL,
    name VARCHAR(180) NOT NULL,
    owner_org_unit_id UUID,
    description TEXT,
    status VARCHAR(24) NOT NULL DEFAULT 'ACTIVE',
    created_by UUID,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, id),
    UNIQUE (tenant_id, code),
    FOREIGN KEY (tenant_id, category_id) REFERENCES standard_category (tenant_id, id),
    FOREIGN KEY (tenant_id, owner_org_unit_id) REFERENCES org_unit (tenant_id, id),
    FOREIGN KEY (tenant_id, created_by) REFERENCES user_account (tenant_id, id)
);

CREATE TABLE standard_version (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenant(id),
    standard_id UUID NOT NULL,
    version_no INTEGER NOT NULL CHECK (version_no > 0),
    lifecycle_status VARCHAR(24) NOT NULL DEFAULT 'DRAFT' CHECK (lifecycle_status IN ('DRAFT', 'PUBLISHED', 'RETIRED')),
    title VARCHAR(200) NOT NULL,
    items JSONB NOT NULL DEFAULT '[]'::jsonb,
    evidence_requirements JSONB NOT NULL DEFAULT '[]'::jsonb,
    scoring_rules JSONB NOT NULL DEFAULT '{}'::jsonb,
    effective_from TIMESTAMPTZ,
    effective_to TIMESTAMPTZ,
    published_by UUID,
    published_at TIMESTAMPTZ,
    created_by UUID,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, id),
    UNIQUE (tenant_id, standard_id, version_no),
    CHECK (effective_to IS NULL OR effective_from IS NULL OR effective_to >= effective_from),
    FOREIGN KEY (tenant_id, standard_id) REFERENCES standard_definition (tenant_id, id),
    FOREIGN KEY (tenant_id, published_by) REFERENCES user_account (tenant_id, id),
    FOREIGN KEY (tenant_id, created_by) REFERENCES user_account (tenant_id, id)
);

CREATE TABLE standard_scope (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenant(id),
    standard_version_id UUID NOT NULL,
    scope_type VARCHAR(24) NOT NULL CHECK (scope_type IN ('TENANT', 'BRAND', 'ORG_UNIT', 'ORG_TREE', 'POSITION')),
    brand_id UUID,
    org_unit_id UUID,
    position_id UUID,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, id),
    FOREIGN KEY (tenant_id, standard_version_id) REFERENCES standard_version (tenant_id, id) ON DELETE CASCADE,
    FOREIGN KEY (tenant_id, brand_id) REFERENCES brand (tenant_id, id),
    FOREIGN KEY (tenant_id, org_unit_id) REFERENCES org_unit (tenant_id, id),
    FOREIGN KEY (tenant_id, position_id) REFERENCES position_definition (tenant_id, id),
    CHECK (
        (scope_type = 'TENANT' AND brand_id IS NULL AND org_unit_id IS NULL AND position_id IS NULL)
        OR (scope_type = 'BRAND' AND brand_id IS NOT NULL)
        OR (scope_type IN ('ORG_UNIT', 'ORG_TREE') AND org_unit_id IS NOT NULL)
        OR (scope_type = 'POSITION' AND position_id IS NOT NULL)
    )
);

CREATE TABLE form_definition (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenant(id),
    code VARCHAR(64) NOT NULL,
    name VARCHAR(160) NOT NULL,
    form_type VARCHAR(24) NOT NULL CHECK (form_type IN ('DAILY_WORK', 'INSPECTION', 'COMPLAINT', 'EXCEPTION', 'FEEDBACK')),
    position_id UUID,
    status VARCHAR(24) NOT NULL DEFAULT 'ACTIVE',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, id),
    UNIQUE (tenant_id, code),
    FOREIGN KEY (tenant_id, position_id) REFERENCES position_definition (tenant_id, id)
);

CREATE TABLE form_version (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenant(id),
    form_id UUID NOT NULL,
    version_no INTEGER NOT NULL CHECK (version_no > 0),
    lifecycle_status VARCHAR(24) NOT NULL DEFAULT 'DRAFT' CHECK (lifecycle_status IN ('DRAFT', 'PUBLISHED', 'RETIRED')),
    json_schema JSONB NOT NULL,
    ui_schema JSONB NOT NULL DEFAULT '{}'::jsonb,
    published_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, id),
    UNIQUE (tenant_id, form_id, version_no),
    FOREIGN KEY (tenant_id, form_id) REFERENCES form_definition (tenant_id, id)
);

CREATE TABLE work_record (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenant(id),
    org_unit_id UUID NOT NULL,
    employee_id UUID NOT NULL,
    position_assignment_id UUID NOT NULL,
    form_version_id UUID NOT NULL,
    business_date DATE NOT NULL,
    status VARCHAR(24) NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED')),
    payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    submitted_at TIMESTAMPTZ,
    correlation_id UUID NOT NULL DEFAULT gen_random_uuid(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, id),
    FOREIGN KEY (tenant_id, org_unit_id) REFERENCES org_unit (tenant_id, id),
    FOREIGN KEY (tenant_id, employee_id) REFERENCES employee (tenant_id, id),
    FOREIGN KEY (tenant_id, position_assignment_id) REFERENCES employee_position_assignment (tenant_id, id),
    FOREIGN KEY (tenant_id, form_version_id) REFERENCES form_version (tenant_id, id)
);

CREATE TABLE attachment (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenant(id),
    work_record_id UUID NOT NULL,
    object_key VARCHAR(500) NOT NULL,
    original_name VARCHAR(240) NOT NULL,
    media_type VARCHAR(120) NOT NULL,
    size_bytes BIGINT NOT NULL CHECK (size_bytes >= 0),
    sha256 CHAR(64),
    scan_status VARCHAR(24) NOT NULL DEFAULT 'PENDING',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, id),
    UNIQUE (tenant_id, object_key),
    FOREIGN KEY (tenant_id, work_record_id) REFERENCES work_record (tenant_id, id) ON DELETE CASCADE
);

CREATE TABLE metric_definition (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenant(id),
    code VARCHAR(64) NOT NULL,
    name VARCHAR(160) NOT NULL,
    unit VARCHAR(32) NOT NULL,
    value_type VARCHAR(24) NOT NULL DEFAULT 'DECIMAL',
    aggregation VARCHAR(24) NOT NULL DEFAULT 'LAST',
    description TEXT,
    status VARCHAR(24) NOT NULL DEFAULT 'ACTIVE',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, id),
    UNIQUE (tenant_id, code)
);

CREATE TABLE metric_observation (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenant(id),
    hotel_org_unit_id UUID NOT NULL,
    metric_id UUID NOT NULL,
    business_date DATE NOT NULL,
    value NUMERIC(20,4) NOT NULL,
    source_type VARCHAR(24) NOT NULL CHECK (source_type IN ('MANUAL', 'EXCEL', 'PMS', 'OTA', 'FINANCE', 'AI_DERIVED')),
    source_record_id VARCHAR(160),
    quality_status VARCHAR(24) NOT NULL DEFAULT 'UNVERIFIED',
    entered_by UUID,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, id),
    UNIQUE (tenant_id, hotel_org_unit_id, metric_id, business_date, source_type, source_record_id),
    FOREIGN KEY (tenant_id, hotel_org_unit_id) REFERENCES org_unit (tenant_id, id),
    FOREIGN KEY (tenant_id, metric_id) REFERENCES metric_definition (tenant_id, id),
    FOREIGN KEY (tenant_id, entered_by) REFERENCES user_account (tenant_id, id)
);

CREATE TABLE audit_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenant(id),
    actor_id UUID,
    action VARCHAR(120) NOT NULL,
    resource_type VARCHAR(80) NOT NULL,
    resource_id UUID,
    correlation_id UUID NOT NULL,
    before_data JSONB,
    after_data JSONB,
    ip_address INET,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE outbox_event (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenant(id),
    aggregate_type VARCHAR(80) NOT NULL,
    aggregate_id UUID NOT NULL,
    event_type VARCHAR(120) NOT NULL,
    payload JSONB NOT NULL,
    occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    published_at TIMESTAMPTZ,
    attempt_count INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX ix_org_parent ON org_unit (tenant_id, parent_id, sort_order);
CREATE INDEX ix_assignment_employee ON employee_position_assignment (tenant_id, employee_id, status);
CREATE INDEX ix_assignment_org ON employee_position_assignment (tenant_id, org_unit_id, status);
CREATE INDEX ix_role_assignment_account ON role_assignment (tenant_id, account_id, valid_to);
CREATE INDEX ix_standard_version_status ON standard_version (tenant_id, lifecycle_status, effective_from);
CREATE INDEX ix_standard_scope_lookup ON standard_scope (tenant_id, scope_type, org_unit_id, position_id);
CREATE INDEX ix_work_record_lookup ON work_record (tenant_id, org_unit_id, business_date, status);
CREATE INDEX ix_metric_observation_lookup ON metric_observation (tenant_id, hotel_org_unit_id, business_date, metric_id);
CREATE UNIQUE INDEX ux_metric_observation_idempotency
    ON metric_observation (tenant_id, hotel_org_unit_id, metric_id, business_date, source_type, coalesce(source_record_id, ''));
CREATE INDEX ix_audit_resource ON audit_log (tenant_id, resource_type, resource_id, created_at DESC);
CREATE INDEX ix_outbox_unpublished ON outbox_event (occurred_at) WHERE published_at IS NULL;

CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
DECLARE
    table_name TEXT;
BEGIN
    FOREACH table_name IN ARRAY ARRAY[
        'tenant', 'brand', 'org_unit', 'hotel_profile', 'user_account', 'employee',
        'position_definition', 'employee_position_assignment', 'app_role',
        'standard_category', 'standard_definition', 'form_definition', 'work_record',
        'metric_definition', 'metric_observation'
    ] LOOP
        EXECUTE format('CREATE TRIGGER trg_%I_updated_at BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION set_updated_at()', table_name, table_name);
    END LOOP;
END $$;
