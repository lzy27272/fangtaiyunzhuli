-- Daily report template center and immutable daily-report revisions.

CREATE TABLE daily_report_template_definition (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenant(id),
    code VARCHAR(80) NOT NULL,
    name VARCHAR(180) NOT NULL,
    description TEXT,
    template_origin VARCHAR(16) NOT NULL CHECK (template_origin IN ('HQ', 'STORE')),
    owner_org_unit_id UUID NOT NULL,
    position_id UUID NOT NULL,
    base_template_definition_id UUID,
    status VARCHAR(24) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'INACTIVE')),
    row_version BIGINT NOT NULL DEFAULT 0,
    created_by UUID NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, id),
    UNIQUE (tenant_id, code),
    CHECK (template_origin <> 'HQ' OR base_template_definition_id IS NULL),
    CHECK (base_template_definition_id IS NULL OR base_template_definition_id <> id),
    FOREIGN KEY (tenant_id, owner_org_unit_id) REFERENCES org_unit (tenant_id, id),
    FOREIGN KEY (tenant_id, position_id) REFERENCES position_definition (tenant_id, id),
    FOREIGN KEY (tenant_id, base_template_definition_id)
        REFERENCES daily_report_template_definition (tenant_id, id),
    FOREIGN KEY (tenant_id, created_by) REFERENCES user_account (tenant_id, id)
);

CREATE TABLE daily_report_template_version (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenant(id),
    template_id UUID NOT NULL,
    version_no INTEGER NOT NULL CHECK (version_no > 0),
    lifecycle_status VARCHAR(24) NOT NULL DEFAULT 'DRAFT'
        CHECK (lifecycle_status IN ('DRAFT', 'IN_REVIEW', 'PUBLISHED', 'RETIRED')),
    work_package_version_id UUID NOT NULL,
    configuration JSONB NOT NULL DEFAULT '{}'::jsonb,
    content_hash CHAR(64),
    effective_from TIMESTAMPTZ,
    effective_to TIMESTAMPTZ,
    review_requested_by UUID,
    review_requested_at TIMESTAMPTZ,
    reviewed_by UUID,
    reviewed_at TIMESTAMPTZ,
    review_comment TEXT,
    published_by UUID,
    published_at TIMESTAMPTZ,
    created_by UUID NOT NULL,
    row_version BIGINT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, id),
    UNIQUE (tenant_id, template_id, version_no),
    CHECK (jsonb_typeof(configuration) = 'object'),
    CHECK (effective_to IS NULL OR effective_from IS NULL OR effective_to > effective_from),
    CHECK (lifecycle_status IN ('DRAFT', 'IN_REVIEW') OR content_hash IS NOT NULL),
    CHECK (lifecycle_status <> 'PUBLISHED' OR (published_by IS NOT NULL AND published_at IS NOT NULL)),
    FOREIGN KEY (tenant_id, template_id)
        REFERENCES daily_report_template_definition (tenant_id, id),
    FOREIGN KEY (tenant_id, work_package_version_id)
        REFERENCES work_package_version (tenant_id, id),
    FOREIGN KEY (tenant_id, review_requested_by) REFERENCES user_account (tenant_id, id),
    FOREIGN KEY (tenant_id, reviewed_by) REFERENCES user_account (tenant_id, id),
    FOREIGN KEY (tenant_id, published_by) REFERENCES user_account (tenant_id, id),
    FOREIGN KEY (tenant_id, created_by) REFERENCES user_account (tenant_id, id)
);

CREATE UNIQUE INDEX ux_daily_report_template_mutable_version
    ON daily_report_template_version (tenant_id, template_id)
    WHERE lifecycle_status IN ('DRAFT', 'IN_REVIEW');

CREATE TABLE daily_report_section_definition (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenant(id),
    code VARCHAR(80) NOT NULL,
    name VARCHAR(180) NOT NULL,
    description TEXT,
    section_origin VARCHAR(16) NOT NULL CHECK (section_origin IN ('HQ', 'STORE')),
    owner_org_unit_id UUID NOT NULL,
    position_id UUID,
    status VARCHAR(24) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'INACTIVE')),
    row_version BIGINT NOT NULL DEFAULT 0,
    created_by UUID NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, id),
    UNIQUE (tenant_id, code),
    FOREIGN KEY (tenant_id, owner_org_unit_id) REFERENCES org_unit (tenant_id, id),
    FOREIGN KEY (tenant_id, position_id) REFERENCES position_definition (tenant_id, id),
    FOREIGN KEY (tenant_id, created_by) REFERENCES user_account (tenant_id, id)
);

CREATE TABLE daily_report_section_version (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenant(id),
    section_definition_id UUID NOT NULL,
    version_no INTEGER NOT NULL CHECK (version_no > 0),
    lifecycle_status VARCHAR(24) NOT NULL DEFAULT 'DRAFT'
        CHECK (lifecycle_status IN ('DRAFT', 'IN_REVIEW', 'PUBLISHED', 'RETIRED')),
    condition_expression JSONB NOT NULL DEFAULT '{}'::jsonb,
    configuration JSONB NOT NULL DEFAULT '{}'::jsonb,
    content_hash CHAR(64),
    effective_from TIMESTAMPTZ,
    effective_to TIMESTAMPTZ,
    review_requested_by UUID,
    review_requested_at TIMESTAMPTZ,
    reviewed_by UUID,
    reviewed_at TIMESTAMPTZ,
    review_comment TEXT,
    published_by UUID,
    published_at TIMESTAMPTZ,
    created_by UUID NOT NULL,
    row_version BIGINT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, id),
    UNIQUE (tenant_id, section_definition_id, version_no),
    CHECK (jsonb_typeof(condition_expression) = 'object'),
    CHECK (jsonb_typeof(configuration) = 'object'),
    CHECK (effective_to IS NULL OR effective_from IS NULL OR effective_to > effective_from),
    CHECK (lifecycle_status IN ('DRAFT', 'IN_REVIEW') OR content_hash IS NOT NULL),
    CHECK (lifecycle_status <> 'PUBLISHED' OR (published_by IS NOT NULL AND published_at IS NOT NULL)),
    FOREIGN KEY (tenant_id, section_definition_id)
        REFERENCES daily_report_section_definition (tenant_id, id),
    FOREIGN KEY (tenant_id, review_requested_by) REFERENCES user_account (tenant_id, id),
    FOREIGN KEY (tenant_id, reviewed_by) REFERENCES user_account (tenant_id, id),
    FOREIGN KEY (tenant_id, published_by) REFERENCES user_account (tenant_id, id),
    FOREIGN KEY (tenant_id, created_by) REFERENCES user_account (tenant_id, id)
);

CREATE UNIQUE INDEX ux_daily_report_section_mutable_version
    ON daily_report_section_version (tenant_id, section_definition_id)
    WHERE lifecycle_status IN ('DRAFT', 'IN_REVIEW');

CREATE TABLE daily_report_template_section (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenant(id),
    template_version_id UUID NOT NULL,
    section_version_id UUID NOT NULL,
    section_role VARCHAR(24) NOT NULL DEFAULT 'BASE'
        CHECK (section_role IN ('BASE', 'CONDITIONAL', 'SUPPLEMENT')),
    required BOOLEAN NOT NULL DEFAULT true,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, id),
    UNIQUE (tenant_id, template_version_id, section_version_id),
    FOREIGN KEY (tenant_id, template_version_id)
        REFERENCES daily_report_template_version (tenant_id, id),
    FOREIGN KEY (tenant_id, section_version_id)
        REFERENCES daily_report_section_version (tenant_id, id)
);

CREATE TABLE daily_report_template_item (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenant(id),
    section_version_id UUID NOT NULL,
    item_code VARCHAR(80) NOT NULL,
    label VARCHAR(240) NOT NULL,
    help_text TEXT,
    input_type VARCHAR(32) NOT NULL CHECK (input_type IN (
        'TEXT', 'LONG_TEXT', 'NUMBER', 'BOOLEAN', 'SINGLE_SELECT', 'MULTI_SELECT',
        'DATE', 'TIME', 'DATETIME', 'METRIC_REFERENCE', 'WORK_RECORD_REFERENCE'
    )),
    required BOOLEAN NOT NULL DEFAULT true,
    work_package_item_id UUID,
    standard_version_id UUID,
    metric_id UUID,
    evidence_policy JSONB NOT NULL DEFAULT '{}'::jsonb,
    source_policy JSONB NOT NULL DEFAULT '{}'::jsonb,
    validation_rules JSONB NOT NULL DEFAULT '{}'::jsonb,
    option_values JSONB NOT NULL DEFAULT '[]'::jsonb,
    sort_order INTEGER NOT NULL DEFAULT 0,
    row_version BIGINT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, id),
    UNIQUE (tenant_id, section_version_id, item_code),
    CHECK (jsonb_typeof(evidence_policy) = 'object'),
    CHECK (jsonb_typeof(source_policy) = 'object'),
    CHECK (jsonb_typeof(validation_rules) = 'object'),
    CHECK (jsonb_typeof(option_values) = 'array'),
    CHECK (input_type <> 'METRIC_REFERENCE' OR metric_id IS NOT NULL),
    FOREIGN KEY (tenant_id, section_version_id)
        REFERENCES daily_report_section_version (tenant_id, id),
    FOREIGN KEY (tenant_id, work_package_item_id) REFERENCES work_package_item (tenant_id, id),
    FOREIGN KEY (tenant_id, standard_version_id) REFERENCES standard_version (tenant_id, id),
    FOREIGN KEY (tenant_id, metric_id) REFERENCES metric_definition (tenant_id, id)
);

CREATE TABLE daily_report_template_assignment (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenant(id),
    template_version_id UUID NOT NULL,
    assignment_kind VARCHAR(24) NOT NULL DEFAULT 'BASE'
        CHECK (assignment_kind IN ('BASE', 'SUPPLEMENT')),
    scope_type VARCHAR(24) NOT NULL CHECK (scope_type IN ('TENANT', 'ORG_UNIT', 'ORG_TREE', 'POSITION')),
    org_unit_id UUID,
    position_id UUID,
    priority INTEGER NOT NULL DEFAULT 100 CHECK (priority BETWEEN 0 AND 1000),
    valid_from DATE NOT NULL,
    valid_to DATE,
    status VARCHAR(24) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'REVOKED')),
    assigned_by UUID,
    row_version BIGINT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, id),
    CHECK (valid_to IS NULL OR valid_to >= valid_from),
    CHECK (
        (scope_type = 'TENANT' AND org_unit_id IS NULL AND position_id IS NULL)
        OR (scope_type IN ('ORG_UNIT', 'ORG_TREE') AND org_unit_id IS NOT NULL AND position_id IS NULL)
        OR (scope_type = 'POSITION' AND org_unit_id IS NULL AND position_id IS NOT NULL)
    ),
    FOREIGN KEY (tenant_id, template_version_id)
        REFERENCES daily_report_template_version (tenant_id, id),
    FOREIGN KEY (tenant_id, org_unit_id) REFERENCES org_unit (tenant_id, id),
    FOREIGN KEY (tenant_id, position_id) REFERENCES position_definition (tenant_id, id),
    FOREIGN KEY (tenant_id, assigned_by) REFERENCES user_account (tenant_id, id)
);

CREATE UNIQUE INDEX ux_daily_report_template_assignment_identity
    ON daily_report_template_assignment (
        tenant_id, template_version_id, assignment_kind, scope_type,
        coalesce(org_unit_id, '00000000-0000-0000-0000-000000000000'::uuid),
        coalesce(position_id, '00000000-0000-0000-0000-000000000000'::uuid), valid_from
    );

CREATE TABLE daily_report (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenant(id),
    hotel_org_unit_id UUID NOT NULL,
    org_unit_id UUID NOT NULL,
    employee_id UUID NOT NULL,
    position_assignment_id UUID NOT NULL,
    business_date DATE NOT NULL,
    timezone VARCHAR(64) NOT NULL,
    cutoff_local_time TIME NOT NULL,
    report_deadline_at TIMESTAMPTZ,
    template_version_id UUID NOT NULL,
    work_package_version_id UUID NOT NULL,
    report_status VARCHAR(24) NOT NULL DEFAULT 'DRAFT'
        CHECK (report_status IN ('DRAFT', 'SUBMITTED', 'ARCHIVED')),
    review_status VARCHAR(24) NOT NULL DEFAULT 'NOT_REQUIRED'
        CHECK (review_status IN ('NOT_REQUIRED', 'PENDING', 'APPROVED', 'REJECTED')),
    current_revision_id UUID,
    current_revision_no INTEGER NOT NULL DEFAULT 1 CHECK (current_revision_no > 0),
    submitted_at TIMESTAMPTZ,
    trace_id UUID NOT NULL,
    created_by_account_id UUID NOT NULL,
    row_version BIGINT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, id),
    UNIQUE (tenant_id, hotel_org_unit_id, position_assignment_id, business_date),
    CHECK (report_status = 'DRAFT' OR submitted_at IS NOT NULL),
    FOREIGN KEY (tenant_id, hotel_org_unit_id) REFERENCES org_unit (tenant_id, id),
    FOREIGN KEY (tenant_id, org_unit_id) REFERENCES org_unit (tenant_id, id),
    FOREIGN KEY (tenant_id, employee_id) REFERENCES employee (tenant_id, id),
    FOREIGN KEY (tenant_id, position_assignment_id)
        REFERENCES employee_position_assignment (tenant_id, id),
    FOREIGN KEY (tenant_id, template_version_id)
        REFERENCES daily_report_template_version (tenant_id, id),
    FOREIGN KEY (tenant_id, work_package_version_id)
        REFERENCES work_package_version (tenant_id, id),
    FOREIGN KEY (tenant_id, created_by_account_id) REFERENCES user_account (tenant_id, id)
);

CREATE TABLE daily_report_revision (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenant(id),
    report_id UUID NOT NULL,
    revision_no INTEGER NOT NULL CHECK (revision_no > 0),
    revision_type VARCHAR(24) NOT NULL DEFAULT 'ORIGINAL'
        CHECK (revision_type IN ('ORIGINAL', 'CORRECTION')),
    revision_status VARCHAR(24) NOT NULL DEFAULT 'DRAFT'
        CHECK (revision_status IN ('DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED')),
    supersedes_revision_id UUID,
    payload_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
    narrative TEXT,
    content_hash CHAR(64),
    submitted_by_account_id UUID,
    submitted_by_assignment_id UUID,
    submitted_at TIMESTAMPTZ,
    created_by_account_id UUID NOT NULL,
    row_version BIGINT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, id),
    UNIQUE (tenant_id, report_id, id),
    UNIQUE (tenant_id, report_id, revision_no),
    CHECK (jsonb_typeof(payload_snapshot) = 'object'),
    CHECK (revision_status = 'DRAFT' OR (content_hash IS NOT NULL AND submitted_at IS NOT NULL)),
    CHECK (revision_type <> 'CORRECTION' OR supersedes_revision_id IS NOT NULL),
    FOREIGN KEY (tenant_id, report_id) REFERENCES daily_report (tenant_id, id),
    FOREIGN KEY (tenant_id, report_id, supersedes_revision_id)
        REFERENCES daily_report_revision (tenant_id, report_id, id),
    FOREIGN KEY (tenant_id, submitted_by_account_id) REFERENCES user_account (tenant_id, id),
    FOREIGN KEY (tenant_id, submitted_by_assignment_id)
        REFERENCES employee_position_assignment (tenant_id, id),
    FOREIGN KEY (tenant_id, created_by_account_id) REFERENCES user_account (tenant_id, id)
);

CREATE UNIQUE INDEX ux_daily_report_one_original_revision
    ON daily_report_revision (tenant_id, report_id)
    WHERE revision_type = 'ORIGINAL';

ALTER TABLE daily_report
    ADD CONSTRAINT fk_daily_report_current_revision
    FOREIGN KEY (tenant_id, id, current_revision_id)
        REFERENCES daily_report_revision (tenant_id, report_id, id)
        DEFERRABLE INITIALLY DEFERRED;

CREATE TABLE daily_report_item_result (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenant(id),
    revision_id UUID NOT NULL,
    template_item_id UUID NOT NULL,
    result_status VARCHAR(24) NOT NULL DEFAULT 'PENDING'
        CHECK (result_status IN ('PENDING', 'COMPLETED', 'EXCEPTION', 'NOT_APPLICABLE')),
    value JSONB,
    system_prefilled BOOLEAN NOT NULL DEFAULT false,
    employee_confirmed BOOLEAN NOT NULL DEFAULT false,
    exception_flag BOOLEAN NOT NULL DEFAULT false,
    exception_statement TEXT,
    source_summary JSONB NOT NULL DEFAULT '{}'::jsonb,
    content_hash CHAR(64),
    row_version BIGINT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, id),
    UNIQUE (tenant_id, revision_id, id),
    UNIQUE (tenant_id, revision_id, template_item_id),
    CHECK (jsonb_typeof(source_summary) = 'object'),
    CHECK (NOT exception_flag OR result_status = 'EXCEPTION'),
    FOREIGN KEY (tenant_id, revision_id) REFERENCES daily_report_revision (tenant_id, id),
    FOREIGN KEY (tenant_id, template_item_id) REFERENCES daily_report_template_item (tenant_id, id)
);

CREATE TABLE daily_report_source_reference (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenant(id),
    revision_id UUID NOT NULL,
    item_result_id UUID,
    source_type VARCHAR(40) NOT NULL CHECK (source_type IN (
        'WORK_RECORD', 'INSPECTION', 'QUALITY_REPORT', 'TASK', 'METRIC', 'MANUAL', 'OTHER'
    )),
    source_id UUID,
    source_external_key VARCHAR(200),
    source_version VARCHAR(80),
    source_status VARCHAR(24) NOT NULL DEFAULT 'ACTIVE'
        CHECK (source_status IN ('ACTIVE', 'INVALIDATED')),
    source_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
    content_hash CHAR(64) NOT NULL,
    source_occurred_at TIMESTAMPTZ,
    linked_by_account_id UUID,
    linked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    invalidated_by_account_id UUID,
    invalidated_at TIMESTAMPTZ,
    invalidation_reason TEXT,
    UNIQUE (tenant_id, id),
    CHECK (num_nonnulls(source_id, source_external_key) = 1),
    CHECK (jsonb_typeof(source_snapshot) = 'object'),
    CHECK (
        source_status <> 'INVALIDATED'
        OR (invalidated_at IS NOT NULL AND invalidation_reason IS NOT NULL)
    ),
    FOREIGN KEY (tenant_id, revision_id) REFERENCES daily_report_revision (tenant_id, id),
    FOREIGN KEY (tenant_id, revision_id, item_result_id)
        REFERENCES daily_report_item_result (tenant_id, revision_id, id),
    FOREIGN KEY (tenant_id, linked_by_account_id) REFERENCES user_account (tenant_id, id),
    FOREIGN KEY (tenant_id, invalidated_by_account_id) REFERENCES user_account (tenant_id, id)
);

CREATE UNIQUE INDEX ux_daily_report_source_identity
    ON daily_report_source_reference (
        tenant_id, revision_id, source_type,
        coalesce(source_id::text, source_external_key), coalesce(source_version, '')
    );

CREATE TABLE daily_report_evidence (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenant(id),
    revision_id UUID NOT NULL,
    item_result_id UUID,
    evidence_type VARCHAR(32) NOT NULL CHECK (evidence_type IN (
        'FILE', 'IMAGE', 'DOCUMENT', 'QUALITY_REPORT', 'LINK', 'STRUCTURED'
    )),
    object_key VARCHAR(500),
    original_name VARCHAR(240),
    media_type VARCHAR(120),
    size_bytes BIGINT CHECK (size_bytes IS NULL OR size_bytes >= 0),
    sha256 CHAR(64),
    structured_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
    scan_status VARCHAR(24) NOT NULL DEFAULT 'PENDING'
        CHECK (scan_status IN ('PENDING', 'CLEAN', 'REJECTED', 'BYPASSED_DEV', 'SANITIZED_IMAGE')),
    sensitivity_level VARCHAR(24) NOT NULL DEFAULT 'INTERNAL'
        CHECK (sensitivity_level IN ('PUBLIC', 'INTERNAL', 'SENSITIVE', 'RESTRICTED')),
    uploaded_by_account_id UUID NOT NULL,
    uploaded_by_assignment_id UUID,
    invalidated_by_account_id UUID,
    invalidated_at TIMESTAMPTZ,
    invalidation_reason TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, id),
    CHECK (jsonb_typeof(structured_snapshot) = 'object'),
    CHECK (object_key IS NOT NULL OR structured_snapshot <> '{}'::jsonb),
    CHECK (invalidated_at IS NULL OR invalidation_reason IS NOT NULL),
    FOREIGN KEY (tenant_id, revision_id) REFERENCES daily_report_revision (tenant_id, id),
    FOREIGN KEY (tenant_id, revision_id, item_result_id)
        REFERENCES daily_report_item_result (tenant_id, revision_id, id),
    FOREIGN KEY (tenant_id, uploaded_by_account_id) REFERENCES user_account (tenant_id, id),
    FOREIGN KEY (tenant_id, uploaded_by_assignment_id)
        REFERENCES employee_position_assignment (tenant_id, id),
    FOREIGN KEY (tenant_id, invalidated_by_account_id) REFERENCES user_account (tenant_id, id)
);

CREATE UNIQUE INDEX ux_daily_report_evidence_object
    ON daily_report_evidence (tenant_id, revision_id, object_key)
    WHERE object_key IS NOT NULL;

CREATE TABLE daily_report_review (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenant(id),
    report_id UUID NOT NULL,
    revision_id UUID NOT NULL,
    review_type VARCHAR(24) NOT NULL CHECK (review_type IN ('EXCEPTION', 'CORRECTION', 'SUPERVISOR')),
    decision VARCHAR(32) NOT NULL CHECK (decision IN (
        'APPROVED', 'REJECTED', 'SUPPLEMENT_REQUIRED', 'ACKNOWLEDGED'
    )),
    reviewer_account_id UUID NOT NULL,
    reviewer_assignment_id UUID NOT NULL,
    comment TEXT,
    trace_id UUID NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, id),
    CHECK (decision NOT IN ('REJECTED', 'SUPPLEMENT_REQUIRED') OR length(trim(comment)) > 0),
    FOREIGN KEY (tenant_id, report_id) REFERENCES daily_report (tenant_id, id),
    FOREIGN KEY (tenant_id, report_id, revision_id)
        REFERENCES daily_report_revision (tenant_id, report_id, id),
    FOREIGN KEY (tenant_id, reviewer_account_id) REFERENCES user_account (tenant_id, id),
    FOREIGN KEY (tenant_id, reviewer_assignment_id)
        REFERENCES employee_position_assignment (tenant_id, id)
);

CREATE INDEX ix_daily_report_template_version_lookup
    ON daily_report_template_version (tenant_id, template_id, lifecycle_status, version_no DESC);
CREATE INDEX ix_daily_report_section_version_lookup
    ON daily_report_section_version (tenant_id, section_definition_id, lifecycle_status, version_no DESC);
CREATE INDEX ix_daily_report_template_item_order
    ON daily_report_template_item (tenant_id, section_version_id, sort_order);
CREATE INDEX ix_daily_report_assignment_resolve
    ON daily_report_template_assignment (tenant_id, status, scope_type, org_unit_id, position_id, valid_from, valid_to, priority);
CREATE INDEX ix_daily_report_queue
    ON daily_report (tenant_id, hotel_org_unit_id, business_date, report_status, review_status);
CREATE INDEX ix_daily_report_employee
    ON daily_report (tenant_id, employee_id, business_date DESC);
CREATE INDEX ix_daily_report_revision_timeline
    ON daily_report_revision (tenant_id, report_id, revision_no DESC);
CREATE INDEX ix_daily_report_review_queue
    ON daily_report_review (tenant_id, review_type, created_at DESC);
CREATE INDEX ix_daily_report_evidence_revision
    ON daily_report_evidence (tenant_id, revision_id, created_at);

CREATE OR REPLACE FUNCTION protect_daily_report_template_version() RETURNS trigger AS $$
BEGIN
    IF TG_OP = 'DELETE' AND OLD.lifecycle_status IN ('PUBLISHED', 'RETIRED') THEN
        RAISE EXCEPTION 'published or retired daily report template versions are immutable';
    END IF;
    IF TG_OP = 'UPDATE' AND OLD.lifecycle_status IN ('PUBLISHED', 'RETIRED') THEN
        IF OLD.lifecycle_status = 'PUBLISHED'
           AND NEW.lifecycle_status = 'RETIRED'
           AND (to_jsonb(NEW) - ARRAY['lifecycle_status', 'effective_to', 'row_version', 'updated_at'])
               = (to_jsonb(OLD) - ARRAY['lifecycle_status', 'effective_to', 'row_version', 'updated_at']) THEN
            RETURN NEW;
        END IF;
        RAISE EXCEPTION 'published or retired daily report template versions are immutable';
    END IF;
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_daily_report_template_version_immutable
    BEFORE UPDATE OR DELETE ON daily_report_template_version
    FOR EACH ROW EXECUTE FUNCTION protect_daily_report_template_version();

CREATE OR REPLACE FUNCTION protect_daily_report_section_version() RETURNS trigger AS $$
BEGIN
    IF TG_OP = 'DELETE' AND OLD.lifecycle_status IN ('PUBLISHED', 'RETIRED') THEN
        RAISE EXCEPTION 'published or retired daily report section versions are immutable';
    END IF;
    IF TG_OP = 'UPDATE' AND OLD.lifecycle_status IN ('PUBLISHED', 'RETIRED') THEN
        IF OLD.lifecycle_status = 'PUBLISHED'
           AND NEW.lifecycle_status = 'RETIRED'
           AND (to_jsonb(NEW) - ARRAY['lifecycle_status', 'effective_to', 'row_version', 'updated_at'])
               = (to_jsonb(OLD) - ARRAY['lifecycle_status', 'effective_to', 'row_version', 'updated_at']) THEN
            RETURN NEW;
        END IF;
        RAISE EXCEPTION 'published or retired daily report section versions are immutable';
    END IF;
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_daily_report_section_version_immutable
    BEFORE UPDATE OR DELETE ON daily_report_section_version
    FOR EACH ROW EXECUTE FUNCTION protect_daily_report_section_version();

CREATE OR REPLACE FUNCTION require_draft_daily_report_template_child() RETURNS trigger AS $$
DECLARE
    old_parent UUID;
    new_parent UUID;
    parent_status VARCHAR(24);
BEGIN
    IF TG_OP IN ('UPDATE', 'DELETE') THEN
        IF TG_TABLE_NAME = 'daily_report_template_section' THEN
            old_parent := OLD.template_version_id;
            SELECT lifecycle_status INTO parent_status FROM daily_report_template_version
            WHERE tenant_id = OLD.tenant_id AND id = old_parent;
        ELSIF TG_TABLE_NAME = 'daily_report_template_item' THEN
            old_parent := OLD.section_version_id;
            SELECT lifecycle_status INTO parent_status FROM daily_report_section_version
            WHERE tenant_id = OLD.tenant_id AND id = old_parent;
        ELSE
            RAISE EXCEPTION 'unsupported daily report template child table: %', TG_TABLE_NAME;
        END IF;
        IF parent_status IS DISTINCT FROM 'DRAFT' THEN
            RAISE EXCEPTION 'only draft daily report template content may change';
        END IF;
    END IF;
    IF TG_OP IN ('INSERT', 'UPDATE') THEN
        IF TG_TABLE_NAME = 'daily_report_template_section' THEN
            new_parent := NEW.template_version_id;
            SELECT lifecycle_status INTO parent_status FROM daily_report_template_version
            WHERE tenant_id = NEW.tenant_id AND id = new_parent;
        ELSIF TG_TABLE_NAME = 'daily_report_template_item' THEN
            new_parent := NEW.section_version_id;
            SELECT lifecycle_status INTO parent_status FROM daily_report_section_version
            WHERE tenant_id = NEW.tenant_id AND id = new_parent;
        ELSE
            RAISE EXCEPTION 'unsupported daily report template child table: %', TG_TABLE_NAME;
        END IF;
        IF parent_status IS DISTINCT FROM 'DRAFT' THEN
            RAISE EXCEPTION 'only draft daily report template content may change';
        END IF;
    END IF;
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_daily_report_template_section_draft_only
    BEFORE INSERT OR UPDATE OR DELETE ON daily_report_template_section
    FOR EACH ROW EXECUTE FUNCTION require_draft_daily_report_template_child();
CREATE TRIGGER trg_daily_report_template_item_draft_only
    BEFORE INSERT OR UPDATE OR DELETE ON daily_report_template_item
    FOR EACH ROW EXECUTE FUNCTION require_draft_daily_report_template_child();

CREATE OR REPLACE FUNCTION protect_daily_report_revision() RETURNS trigger AS $$
BEGIN
    IF TG_OP = 'DELETE' AND OLD.revision_status <> 'DRAFT' THEN
        RAISE EXCEPTION 'submitted daily report revisions are immutable';
    END IF;
    IF TG_OP = 'UPDATE' AND OLD.revision_status <> 'DRAFT' THEN
        IF (to_jsonb(NEW) - ARRAY['revision_status', 'row_version', 'updated_at'])
           <> (to_jsonb(OLD) - ARRAY['revision_status', 'row_version', 'updated_at']) THEN
            RAISE EXCEPTION 'submitted daily report revision facts are immutable';
        END IF;
        IF NEW.revision_status NOT IN ('SUBMITTED', 'APPROVED', 'REJECTED') THEN
            RAISE EXCEPTION 'submitted daily report revision has an invalid transition';
        END IF;
    END IF;
    IF TG_OP = 'UPDATE'
       AND OLD.revision_status = 'DRAFT'
       AND NEW.revision_status NOT IN ('DRAFT', 'SUBMITTED') THEN
        RAISE EXCEPTION 'draft daily report revisions may only remain draft or be submitted';
    END IF;
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_daily_report_revision_immutable
    BEFORE UPDATE OR DELETE ON daily_report_revision
    FOR EACH ROW EXECUTE FUNCTION protect_daily_report_revision();

CREATE OR REPLACE FUNCTION require_draft_daily_report_revision() RETURNS trigger AS $$
DECLARE
    parent_status VARCHAR(24);
    parent_id UUID;
    parent_tenant UUID;
BEGIN
    parent_id := coalesce(NEW.revision_id, OLD.revision_id);
    parent_tenant := coalesce(NEW.tenant_id, OLD.tenant_id);
    SELECT revision_status INTO parent_status FROM daily_report_revision
    WHERE tenant_id = parent_tenant AND id = parent_id;
    IF parent_status IS DISTINCT FROM 'DRAFT' THEN
        RAISE EXCEPTION 'only draft daily report revision items may change';
    END IF;
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_daily_report_item_result_draft_only
    BEFORE INSERT OR UPDATE OR DELETE ON daily_report_item_result
    FOR EACH ROW EXECUTE FUNCTION require_draft_daily_report_revision();

CREATE OR REPLACE FUNCTION protect_daily_report_source_reference() RETURNS trigger AS $$
DECLARE
    parent_status VARCHAR(24);
BEGIN
    SELECT revision_status INTO parent_status FROM daily_report_revision
    WHERE tenant_id = coalesce(NEW.tenant_id, OLD.tenant_id)
      AND id = coalesce(NEW.revision_id, OLD.revision_id);
    IF parent_status IS DISTINCT FROM 'DRAFT' THEN
        IF TG_OP = 'UPDATE'
           AND OLD.source_status = 'ACTIVE' AND NEW.source_status = 'INVALIDATED'
           AND (to_jsonb(NEW) - ARRAY['source_status', 'invalidated_by_account_id', 'invalidated_at', 'invalidation_reason'])
               = (to_jsonb(OLD) - ARRAY['source_status', 'invalidated_by_account_id', 'invalidated_at', 'invalidation_reason']) THEN
            RETURN NEW;
        END IF;
        RAISE EXCEPTION 'submitted daily report source references are immutable';
    END IF;
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_daily_report_source_reference_immutable
    BEFORE INSERT OR UPDATE OR DELETE ON daily_report_source_reference
    FOR EACH ROW EXECUTE FUNCTION protect_daily_report_source_reference();

CREATE OR REPLACE FUNCTION protect_daily_report_evidence() RETURNS trigger AS $$
DECLARE
    parent_status VARCHAR(24);
BEGIN
    SELECT revision_status INTO parent_status FROM daily_report_revision
    WHERE tenant_id = coalesce(NEW.tenant_id, OLD.tenant_id)
      AND id = coalesce(NEW.revision_id, OLD.revision_id);
    IF parent_status IS DISTINCT FROM 'DRAFT' THEN
        IF TG_OP = 'UPDATE'
           AND OLD.invalidated_at IS NULL AND NEW.invalidated_at IS NOT NULL
           AND (to_jsonb(NEW) - ARRAY['invalidated_by_account_id', 'invalidated_at', 'invalidation_reason'])
               = (to_jsonb(OLD) - ARRAY['invalidated_by_account_id', 'invalidated_at', 'invalidation_reason']) THEN
            RETURN NEW;
        END IF;
        RAISE EXCEPTION 'submitted daily report evidence is immutable';
    END IF;
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_daily_report_evidence_immutable
    BEFORE INSERT OR UPDATE OR DELETE ON daily_report_evidence
    FOR EACH ROW EXECUTE FUNCTION protect_daily_report_evidence();
CREATE TRIGGER trg_daily_report_review_append_only
    BEFORE UPDATE OR DELETE ON daily_report_review
    FOR EACH ROW EXECUTE FUNCTION reject_append_only_mutation();

DO $$
DECLARE
    table_name TEXT;
BEGIN
    FOREACH table_name IN ARRAY ARRAY[
        'daily_report_template_definition', 'daily_report_template_version',
        'daily_report_section_definition', 'daily_report_section_version',
        'daily_report_template_section', 'daily_report_template_item',
        'daily_report_template_assignment', 'daily_report', 'daily_report_revision',
        'daily_report_item_result', 'daily_report_source_reference',
        'daily_report_evidence', 'daily_report_review'
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
DECLARE
    table_name TEXT;
BEGIN
    FOREACH table_name IN ARRAY ARRAY[
        'daily_report_template_definition', 'daily_report_template_version',
        'daily_report_section_definition', 'daily_report_section_version',
        'daily_report_template_item', 'daily_report_template_assignment',
        'daily_report', 'daily_report_revision', 'daily_report_item_result'
    ] LOOP
        EXECUTE format(
            'CREATE TRIGGER trg_%I_updated_at BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION set_updated_at()',
            table_name, table_name
        );
    END LOOP;
END $$;

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'hotel_ai_os_app') THEN
        GRANT SELECT, INSERT, UPDATE, DELETE ON
            daily_report_template_definition, daily_report_template_version,
            daily_report_section_definition, daily_report_section_version,
            daily_report_template_section, daily_report_template_item,
            daily_report_template_assignment, daily_report, daily_report_revision,
            daily_report_item_result, daily_report_source_reference,
            daily_report_evidence, daily_report_review
        TO hotel_ai_os_app;
        REVOKE UPDATE, DELETE ON daily_report_review FROM hotel_ai_os_app;
    END IF;
END $$;
