-- Sprint 2: work package center, duty periods, work expectations and compatible work-record expansion.
-- V1-V4 are frozen. Every tenant-owned table created here gets same-tenant foreign keys and FORCE RLS.

CREATE TABLE work_package_definition (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenant(id),
    code VARCHAR(64) NOT NULL,
    name VARCHAR(180) NOT NULL,
    description TEXT,
    position_id UUID NOT NULL,
    owner_org_unit_id UUID,
    status VARCHAR(24) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'INACTIVE')),
    created_by UUID,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, id),
    UNIQUE (tenant_id, code),
    FOREIGN KEY (tenant_id, position_id) REFERENCES position_definition (tenant_id, id),
    FOREIGN KEY (tenant_id, owner_org_unit_id) REFERENCES org_unit (tenant_id, id),
    FOREIGN KEY (tenant_id, created_by) REFERENCES user_account (tenant_id, id)
);

CREATE TABLE work_package_version (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenant(id),
    work_package_definition_id UUID NOT NULL,
    version_no INTEGER NOT NULL CHECK (version_no > 0),
    lifecycle_status VARCHAR(24) NOT NULL DEFAULT 'DRAFT'
        CHECK (lifecycle_status IN ('DRAFT', 'PUBLISHED', 'RETIRED')),
    title VARCHAR(200) NOT NULL,
    description TEXT,
    effective_from TIMESTAMPTZ,
    effective_to TIMESTAMPTZ,
    content_hash CHAR(64),
    published_by UUID,
    published_at TIMESTAMPTZ,
    created_by UUID,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, id),
    UNIQUE (tenant_id, work_package_definition_id, version_no),
    CHECK (effective_to IS NULL OR effective_from IS NULL OR effective_to >= effective_from),
    CHECK ((lifecycle_status = 'DRAFT') OR content_hash IS NOT NULL),
    FOREIGN KEY (tenant_id, work_package_definition_id)
        REFERENCES work_package_definition (tenant_id, id),
    FOREIGN KEY (tenant_id, published_by) REFERENCES user_account (tenant_id, id),
    FOREIGN KEY (tenant_id, created_by) REFERENCES user_account (tenant_id, id)
);

CREATE TABLE work_package_scope (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenant(id),
    work_package_version_id UUID NOT NULL,
    scope_type VARCHAR(24) NOT NULL
        CHECK (scope_type IN ('TENANT', 'BRAND', 'ORG_UNIT', 'ORG_TREE', 'POSITION')),
    brand_id UUID,
    org_unit_id UUID,
    position_id UUID,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, id),
    FOREIGN KEY (tenant_id, work_package_version_id)
        REFERENCES work_package_version (tenant_id, id) ON DELETE CASCADE,
    FOREIGN KEY (tenant_id, brand_id) REFERENCES brand (tenant_id, id),
    FOREIGN KEY (tenant_id, org_unit_id) REFERENCES org_unit (tenant_id, id),
    FOREIGN KEY (tenant_id, position_id) REFERENCES position_definition (tenant_id, id),
    CHECK (
        (scope_type = 'TENANT' AND brand_id IS NULL AND org_unit_id IS NULL AND position_id IS NULL)
        OR (scope_type = 'BRAND' AND brand_id IS NOT NULL AND org_unit_id IS NULL AND position_id IS NULL)
        OR (scope_type IN ('ORG_UNIT', 'ORG_TREE') AND org_unit_id IS NOT NULL AND brand_id IS NULL AND position_id IS NULL)
        OR (scope_type = 'POSITION' AND position_id IS NOT NULL AND brand_id IS NULL AND org_unit_id IS NULL)
    )
);

CREATE TABLE work_package_item (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenant(id),
    work_package_version_id UUID NOT NULL,
    item_code VARCHAR(64) NOT NULL,
    name VARCHAR(180) NOT NULL,
    description TEXT,
    item_type VARCHAR(32) NOT NULL
        CHECK (item_type IN ('SCHEDULED_RECORD', 'EVENT_RECORD', 'INSPECTION', 'METRIC_REVIEW', 'REVIEW_APPROVAL')),
    form_version_id UUID,
    sort_order INTEGER NOT NULL DEFAULT 0,
    required BOOLEAN NOT NULL DEFAULT true,
    period_type VARCHAR(16) NOT NULL CHECK (period_type IN ('SHIFT', 'DAY', 'WEEK', 'EVENT')),
    timezone_mode VARCHAR(16) NOT NULL DEFAULT 'HOTEL' CHECK (timezone_mode IN ('HOTEL', 'TENANT', 'FIXED')),
    fixed_timezone VARCHAR(64),
    work_window_start TIME,
    work_window_end TIME,
    due_local_time TIME,
    grace_minutes INTEGER NOT NULL DEFAULT 0 CHECK (grace_minutes >= 0),
    weekdays SMALLINT[] NOT NULL DEFAULT ARRAY[]::SMALLINT[],
    day_of_month SMALLINT CHECK (day_of_month IS NULL OR day_of_month BETWEEN 1 AND 31),
    holiday_policy VARCHAR(24) NOT NULL DEFAULT 'INCLUDE'
        CHECK (holiday_policy IN ('INCLUDE', 'SKIP', 'SHIFT_FORWARD', 'SHIFT_BACKWARD')),
    waiver_allowed BOOLEAN NOT NULL DEFAULT false,
    target_granularity VARCHAR(24) NOT NULL DEFAULT 'ASSIGNMENT_ORG'
        CHECK (target_granularity IN ('ASSIGNMENT_ORG', 'TARGET_ORG')),
    review_mode VARCHAR(24) NOT NULL DEFAULT 'MANUAL'
        CHECK (review_mode IN ('NONE', 'MANUAL', 'STANDARD_EVALUATION')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, id),
    UNIQUE (tenant_id, work_package_version_id, id),
    UNIQUE (tenant_id, work_package_version_id, item_code),
    CHECK (timezone_mode <> 'FIXED' OR fixed_timezone IS NOT NULL),
    CHECK (period_type <> 'EVENT' OR item_type IN ('EVENT_RECORD', 'INSPECTION', 'REVIEW_APPROVAL')),
    FOREIGN KEY (tenant_id, work_package_version_id)
        REFERENCES work_package_version (tenant_id, id) ON DELETE CASCADE,
    FOREIGN KEY (tenant_id, form_version_id) REFERENCES form_version (tenant_id, id)
);

CREATE TABLE work_package_item_standard (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenant(id),
    work_package_item_id UUID NOT NULL,
    standard_version_id UUID NOT NULL,
    usage_type VARCHAR(24) NOT NULL CHECK (usage_type IN ('EXECUTION', 'ACCEPTANCE', 'KPI')),
    weight NUMERIC(8,4) NOT NULL DEFAULT 1 CHECK (weight > 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, id),
    UNIQUE (tenant_id, work_package_item_id, standard_version_id, usage_type),
    FOREIGN KEY (tenant_id, work_package_item_id)
        REFERENCES work_package_item (tenant_id, id) ON DELETE CASCADE,
    FOREIGN KEY (tenant_id, standard_version_id) REFERENCES standard_version (tenant_id, id)
);

CREATE TABLE work_package_item_responsibility (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenant(id),
    work_package_item_id UUID NOT NULL,
    participant_type VARCHAR(24) NOT NULL
        CHECK (participant_type IN ('EXECUTOR', 'REVIEWER', 'ACCEPTOR', 'ESCALATION')),
    resolver_type VARCHAR(40) NOT NULL
        CHECK (resolver_type IN ('CURRENT_ASSIGNMENT', 'DIRECT_MANAGER_ASSIGNMENT', 'POSITION_IN_SAME_ORG',
                                 'POSITION_IN_ANCESTOR_ORG', 'EXPLICIT_ALLOCATION')),
    position_id UUID,
    scope_strategy VARCHAR(24) NOT NULL DEFAULT 'TARGET_ORG'
        CHECK (scope_strategy IN ('ASSIGNMENT_ORG', 'TARGET_ORG', 'ANCESTOR_ORG')),
    escalation_level INTEGER NOT NULL DEFAULT 0 CHECK (escalation_level >= 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, id),
    UNIQUE (tenant_id, work_package_item_id, participant_type, escalation_level),
    CHECK (
        resolver_type NOT IN ('POSITION_IN_SAME_ORG', 'POSITION_IN_ANCESTOR_ORG')
        OR position_id IS NOT NULL
    ),
    FOREIGN KEY (tenant_id, work_package_item_id)
        REFERENCES work_package_item (tenant_id, id) ON DELETE CASCADE,
    FOREIGN KEY (tenant_id, position_id) REFERENCES position_definition (tenant_id, id)
);

CREATE TABLE work_package_allocation (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenant(id),
    work_package_version_id UUID NOT NULL,
    position_assignment_id UUID NOT NULL,
    target_org_unit_id UUID NOT NULL,
    allocation_source VARCHAR(24) NOT NULL DEFAULT 'MANUAL'
        CHECK (allocation_source IN ('MANUAL', 'IMPORT', 'SYSTEM')),
    valid_from DATE NOT NULL,
    valid_to DATE,
    status VARCHAR(24) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'REVOKED')),
    allocated_by UUID,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, id),
    UNIQUE (tenant_id, work_package_version_id, position_assignment_id, target_org_unit_id, valid_from),
    CHECK (valid_to IS NULL OR valid_to >= valid_from),
    FOREIGN KEY (tenant_id, work_package_version_id)
        REFERENCES work_package_version (tenant_id, id),
    FOREIGN KEY (tenant_id, position_assignment_id)
        REFERENCES employee_position_assignment (tenant_id, id),
    FOREIGN KEY (tenant_id, target_org_unit_id) REFERENCES org_unit (tenant_id, id),
    FOREIGN KEY (tenant_id, allocated_by) REFERENCES user_account (tenant_id, id)
);

CREATE TABLE work_duty_period (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenant(id),
    position_assignment_id UUID NOT NULL,
    target_org_unit_id UUID NOT NULL,
    business_date DATE NOT NULL,
    period_type VARCHAR(16) NOT NULL CHECK (period_type IN ('SHIFT', 'DAY', 'WEEK')),
    shift_code VARCHAR(64),
    planned_start_at TIMESTAMPTZ NOT NULL,
    planned_end_at TIMESTAMPTZ NOT NULL,
    status VARCHAR(24) NOT NULL DEFAULT 'PLANNED' CHECK (status IN ('PLANNED', 'CANCELLED', 'COMPLETED')),
    source_record_id VARCHAR(160),
    created_by UUID,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, id),
    CHECK (planned_end_at > planned_start_at),
    UNIQUE (tenant_id, position_assignment_id, target_org_unit_id, period_type, business_date, shift_code),
    FOREIGN KEY (tenant_id, position_assignment_id)
        REFERENCES employee_position_assignment (tenant_id, id),
    FOREIGN KEY (tenant_id, target_org_unit_id) REFERENCES org_unit (tenant_id, id),
    FOREIGN KEY (tenant_id, created_by) REFERENCES user_account (tenant_id, id)
);

CREATE TABLE work_expectation (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenant(id),
    work_package_item_id UUID NOT NULL,
    work_package_allocation_id UUID NOT NULL,
    position_assignment_id UUID NOT NULL,
    duty_period_id UUID,
    target_org_unit_id UUID NOT NULL,
    business_date DATE NOT NULL,
    period_key VARCHAR(120) NOT NULL,
    available_at TIMESTAMPTZ NOT NULL,
    due_at TIMESTAMPTZ NOT NULL,
    status VARCHAR(24) NOT NULL DEFAULT 'PLANNED'
        CHECK (status IN ('PLANNED', 'AVAILABLE', 'IN_PROGRESS', 'SUBMITTED', 'SATISFIED', 'FAILED',
                          'MISSED', 'WAIVED', 'CANCELLED')),
    waiver_allowed BOOLEAN NOT NULL DEFAULT false,
    waiver_reason TEXT,
    waived_by_account_id UUID,
    waived_at TIMESTAMPTZ,
    cancellation_reason TEXT,
    cancelled_by_account_id UUID,
    cancelled_at TIMESTAMPTZ,
    row_version BIGINT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, id),
    UNIQUE (tenant_id, work_package_item_id, position_assignment_id, target_org_unit_id, period_key),
    CHECK (due_at >= available_at),
    CHECK ((status <> 'WAIVED') OR (waiver_reason IS NOT NULL AND waived_by_account_id IS NOT NULL AND waived_at IS NOT NULL)),
    CHECK ((status <> 'CANCELLED') OR (cancellation_reason IS NOT NULL AND cancelled_by_account_id IS NOT NULL AND cancelled_at IS NOT NULL)),
    FOREIGN KEY (tenant_id, work_package_item_id)
        REFERENCES work_package_item (tenant_id, id),
    FOREIGN KEY (tenant_id, work_package_allocation_id)
        REFERENCES work_package_allocation (tenant_id, id),
    FOREIGN KEY (tenant_id, position_assignment_id)
        REFERENCES employee_position_assignment (tenant_id, id),
    FOREIGN KEY (tenant_id, duty_period_id) REFERENCES work_duty_period (tenant_id, id),
    FOREIGN KEY (tenant_id, target_org_unit_id) REFERENCES org_unit (tenant_id, id),
    FOREIGN KEY (tenant_id, waived_by_account_id) REFERENCES user_account (tenant_id, id),
    FOREIGN KEY (tenant_id, cancelled_by_account_id) REFERENCES user_account (tenant_id, id)
);

ALTER TABLE work_record
    ADD COLUMN work_package_version_id UUID,
    ADD COLUMN work_package_item_id UUID,
    ADD COLUMN work_expectation_id UUID,
    ADD COLUMN record_kind VARCHAR(24) NOT NULL DEFAULT 'LEGACY',
    ADD COLUMN target_org_unit_id UUID,
    ADD COLUMN occurred_at TIMESTAMPTZ,
    ADD COLUMN submitted_by_account_id UUID,
    ADD COLUMN supersedes_work_record_id UUID,
    ADD COLUMN attempt_no INTEGER NOT NULL DEFAULT 1,
    ADD COLUMN content_hash CHAR(64),
    ADD COLUMN reviewed_by_account_id UUID,
    ADD COLUMN reviewed_at TIMESTAMPTZ,
    ADD COLUMN review_reason TEXT,
    ADD COLUMN row_version BIGINT NOT NULL DEFAULT 0;

UPDATE work_record
SET target_org_unit_id = org_unit_id,
    occurred_at = coalesce(submitted_at, created_at),
    content_hash = encode(digest(payload::text, 'sha256'), 'hex');

ALTER TABLE work_record
    ALTER COLUMN target_org_unit_id SET NOT NULL,
    ALTER COLUMN occurred_at SET NOT NULL,
    ALTER COLUMN content_hash SET NOT NULL,
    ADD CONSTRAINT ck_work_record_kind CHECK (
        record_kind IN ('LEGACY', 'SCHEDULED', 'EVENT', 'INSPECTION', 'METRIC_REVIEW', 'REVIEW_APPROVAL')
    ),
    ADD CONSTRAINT ck_work_record_attempt CHECK (attempt_no > 0),
    ADD CONSTRAINT fk_work_record_wp_version FOREIGN KEY (tenant_id, work_package_version_id)
        REFERENCES work_package_version (tenant_id, id),
    ADD CONSTRAINT fk_work_record_wp_item_version FOREIGN KEY
        (tenant_id, work_package_version_id, work_package_item_id)
        REFERENCES work_package_item (tenant_id, work_package_version_id, id),
    ADD CONSTRAINT fk_work_record_expectation FOREIGN KEY (tenant_id, work_expectation_id)
        REFERENCES work_expectation (tenant_id, id),
    ADD CONSTRAINT fk_work_record_target_org FOREIGN KEY (tenant_id, target_org_unit_id)
        REFERENCES org_unit (tenant_id, id),
    ADD CONSTRAINT fk_work_record_submitted_by FOREIGN KEY (tenant_id, submitted_by_account_id)
        REFERENCES user_account (tenant_id, id),
    ADD CONSTRAINT fk_work_record_supersedes FOREIGN KEY (tenant_id, supersedes_work_record_id)
        REFERENCES work_record (tenant_id, id),
    ADD CONSTRAINT fk_work_record_reviewed_by FOREIGN KEY (tenant_id, reviewed_by_account_id)
        REFERENCES user_account (tenant_id, id),
    ADD CONSTRAINT ck_work_record_package_pair CHECK (
        (work_package_version_id IS NULL AND work_package_item_id IS NULL)
        OR (work_package_version_id IS NOT NULL AND work_package_item_id IS NOT NULL)
    );

CREATE UNIQUE INDEX ux_work_record_expectation_attempt
    ON work_record (tenant_id, work_expectation_id, attempt_no)
    WHERE work_expectation_id IS NOT NULL;
CREATE INDEX ix_work_record_target ON work_record (tenant_id, target_org_unit_id, business_date, status);
CREATE INDEX ix_work_record_package_item ON work_record (tenant_id, work_package_item_id, business_date);

CREATE INDEX ix_work_package_version_definition
    ON work_package_version (tenant_id, work_package_definition_id, lifecycle_status, version_no DESC);
CREATE INDEX ix_work_package_scope_lookup
    ON work_package_scope (tenant_id, scope_type, org_unit_id, brand_id, position_id);
CREATE INDEX ix_work_package_item_version
    ON work_package_item (tenant_id, work_package_version_id, sort_order);
CREATE INDEX ix_work_package_allocation_assignment
    ON work_package_allocation (tenant_id, position_assignment_id, target_org_unit_id, status, valid_from, valid_to);
CREATE INDEX ix_work_duty_period_schedule
    ON work_duty_period (tenant_id, business_date, position_assignment_id, status);
CREATE UNIQUE INDEX ux_work_duty_period_identity
    ON work_duty_period (
        tenant_id, position_assignment_id, target_org_unit_id, period_type,
        business_date, coalesce(shift_code, '')
    );
CREATE INDEX ix_work_expectation_queue
    ON work_expectation (tenant_id, status, due_at, target_org_unit_id);
CREATE INDEX ix_work_expectation_assignment
    ON work_expectation (tenant_id, position_assignment_id, business_date, status);

CREATE OR REPLACE FUNCTION protect_work_package_version() RETURNS trigger AS $$
BEGIN
    IF TG_OP = 'DELETE' AND OLD.lifecycle_status IN ('PUBLISHED', 'RETIRED') THEN
        RAISE EXCEPTION 'published or retired work package versions are immutable';
    END IF;
    IF TG_OP = 'UPDATE' AND OLD.lifecycle_status IN ('PUBLISHED', 'RETIRED') THEN
        IF OLD.lifecycle_status = 'PUBLISHED'
           AND NEW.lifecycle_status = 'RETIRED'
           AND (to_jsonb(NEW) - ARRAY['lifecycle_status', 'effective_to', 'updated_at'])
               = (to_jsonb(OLD) - ARRAY['lifecycle_status', 'effective_to', 'updated_at']) THEN
            RETURN NEW;
        END IF;
        RAISE EXCEPTION 'published or retired work package versions are immutable';
    END IF;
    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_protect_work_package_version
BEFORE UPDATE OR DELETE ON work_package_version
FOR EACH ROW EXECUTE FUNCTION protect_work_package_version();

CREATE OR REPLACE FUNCTION require_draft_work_package_child() RETURNS trigger AS $$
DECLARE
    candidate_tenant UUID;
    candidate_version UUID;
    version_status VARCHAR(24);
BEGIN
    candidate_tenant := coalesce(NEW.tenant_id, OLD.tenant_id);
    IF TG_TABLE_NAME IN ('work_package_scope', 'work_package_item') THEN
        candidate_version := coalesce(NEW.work_package_version_id, OLD.work_package_version_id);
    ELSE
        SELECT i.work_package_version_id INTO candidate_version
        FROM work_package_item i
        WHERE i.tenant_id = candidate_tenant
          AND i.id = coalesce(NEW.work_package_item_id, OLD.work_package_item_id);
    END IF;
    SELECT lifecycle_status INTO version_status
    FROM work_package_version
    WHERE tenant_id = candidate_tenant AND id = candidate_version;
    IF version_status IS DISTINCT FROM 'DRAFT' THEN
        RAISE EXCEPTION 'only draft work package versions may change';
    END IF;
    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_work_package_scope_draft_only
BEFORE INSERT OR UPDATE OR DELETE ON work_package_scope
FOR EACH ROW EXECUTE FUNCTION require_draft_work_package_child();
CREATE TRIGGER trg_work_package_item_draft_only
BEFORE INSERT OR UPDATE OR DELETE ON work_package_item
FOR EACH ROW EXECUTE FUNCTION require_draft_work_package_child();
CREATE TRIGGER trg_work_package_item_standard_draft_only
BEFORE INSERT OR UPDATE OR DELETE ON work_package_item_standard
FOR EACH ROW EXECUTE FUNCTION require_draft_work_package_child();
CREATE TRIGGER trg_work_package_item_responsibility_draft_only
BEFORE INSERT OR UPDATE OR DELETE ON work_package_item_responsibility
FOR EACH ROW EXECUTE FUNCTION require_draft_work_package_child();

CREATE OR REPLACE FUNCTION protect_submitted_work_record() RETURNS trigger AS $$
BEGIN
    IF OLD.status = 'DRAFT' THEN
        IF NEW.status NOT IN ('DRAFT', 'SUBMITTED') THEN
            RAISE EXCEPTION 'draft work records may only remain draft or be submitted';
        END IF;
        RETURN NEW;
    END IF;
    IF OLD.status = 'SUBMITTED' AND NEW.status NOT IN ('SUBMITTED', 'APPROVED', 'REJECTED') THEN
        RAISE EXCEPTION 'submitted work records may only be approved or rejected';
    END IF;
    IF OLD.status IN ('APPROVED', 'REJECTED') AND NEW.status <> OLD.status THEN
        RAISE EXCEPTION 'reviewed work records are final; create a new attempt';
    END IF;
    IF (to_jsonb(NEW) - ARRAY['status', 'reviewed_by_account_id', 'reviewed_at', 'review_reason', 'updated_at', 'row_version'])
       <> (to_jsonb(OLD) - ARRAY['status', 'reviewed_by_account_id', 'reviewed_at', 'review_reason', 'updated_at', 'row_version']) THEN
        RAISE EXCEPTION 'submitted work record facts are immutable';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_protect_submitted_work_record
BEFORE UPDATE ON work_record
FOR EACH ROW EXECUTE FUNCTION protect_submitted_work_record();

DO $$
DECLARE
    table_name TEXT;
BEGIN
    FOREACH table_name IN ARRAY ARRAY[
        'work_package_definition', 'work_package_version', 'work_package_scope', 'work_package_item',
        'work_package_item_standard', 'work_package_item_responsibility', 'work_package_allocation',
        'work_duty_period', 'work_expectation'
    ] LOOP
        EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', table_name);
        EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', table_name);
        EXECUTE format(
            'CREATE POLICY tenant_isolation ON %I USING (tenant_id = nullif(current_setting(''app.tenant_id'', true), '''')::uuid) WITH CHECK (tenant_id = nullif(current_setting(''app.tenant_id'', true), '''')::uuid)',
            table_name
        );
        EXECUTE format('CREATE TRIGGER trg_%I_updated_at BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION set_updated_at()', table_name, table_name);
    END LOOP;
END $$;

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'hotel_ai_os_app') THEN
        GRANT SELECT, INSERT, UPDATE, DELETE ON
            work_package_definition, work_package_version, work_package_scope, work_package_item,
            work_package_item_standard, work_package_item_responsibility, work_package_allocation,
            work_duty_period, work_expectation
        TO hotel_ai_os_app;
    END IF;
END $$;
