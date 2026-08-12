-- KPI performance center: versioned templates, normalized facts, weekly/monthly scorecards,
-- review/dispute/correction workflow, compensation settlement, import and tenant isolation.

CREATE TABLE metric_definition_version (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenant(id),
    metric_definition_id UUID NOT NULL,
    version_no INTEGER NOT NULL CHECK (version_no > 0),
    lifecycle_status VARCHAR(24) NOT NULL DEFAULT 'DRAFT'
        CHECK (lifecycle_status IN ('DRAFT', 'PUBLISHED', 'RETIRED')),
    source_type VARCHAR(32) NOT NULL
        CHECK (source_type IN ('PMS', 'OTA', 'TASK', 'INSPECTION', 'REMEDIATION', 'ATTENDANCE', 'REVIEW', 'MANUAL', 'IMPORT', 'DERIVED')),
    supported_dimensions JSONB NOT NULL DEFAULT '[]'::jsonb,
    aggregation VARCHAR(24) NOT NULL DEFAULT 'LAST'
        CHECK (aggregation IN ('SUM', 'COUNT', 'LAST', 'AVERAGE', 'RATIO', 'MIN', 'MAX')),
    direction VARCHAR(24) NOT NULL DEFAULT 'HIGHER_BETTER'
        CHECK (direction IN ('HIGHER_BETTER', 'LOWER_BETTER', 'TARGET_RANGE', 'INFORMATIONAL')),
    calculation JSONB NOT NULL DEFAULT '{}'::jsonb,
    sensitivity_level VARCHAR(24) NOT NULL DEFAULT 'INTERNAL'
        CHECK (sensitivity_level IN ('INTERNAL', 'BUSINESS_SENSITIVE', 'PAYROLL_SENSITIVE')),
    effective_from DATE,
    effective_to DATE,
    content_hash CHAR(64) NOT NULL,
    published_by UUID,
    published_at TIMESTAMPTZ,
    created_by UUID,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, id),
    UNIQUE (tenant_id, metric_definition_id, version_no),
    CHECK (effective_to IS NULL OR effective_from IS NULL OR effective_to >= effective_from),
    FOREIGN KEY (tenant_id, metric_definition_id) REFERENCES metric_definition (tenant_id, id),
    FOREIGN KEY (tenant_id, published_by) REFERENCES user_account (tenant_id, id),
    FOREIGN KEY (tenant_id, created_by) REFERENCES user_account (tenant_id, id)
);

CREATE TABLE kpi_compensation_policy_definition (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenant(id),
    code VARCHAR(80) NOT NULL,
    name VARCHAR(180) NOT NULL,
    owner_org_unit_id UUID,
    status VARCHAR(24) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'INACTIVE')),
    created_by UUID,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, id),
    UNIQUE (tenant_id, code),
    FOREIGN KEY (tenant_id, owner_org_unit_id) REFERENCES org_unit (tenant_id, id),
    FOREIGN KEY (tenant_id, created_by) REFERENCES user_account (tenant_id, id)
);

CREATE TABLE kpi_compensation_policy_version (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenant(id),
    policy_id UUID NOT NULL,
    version_no INTEGER NOT NULL CHECK (version_no > 0),
    lifecycle_status VARCHAR(24) NOT NULL DEFAULT 'DRAFT'
        CHECK (lifecycle_status IN ('DRAFT', 'IN_REVIEW', 'PUBLISHED', 'RETIRED')),
    score_bands JSONB NOT NULL DEFAULT '[]'::jsonb,
    attendance_bands JSONB NOT NULL DEFAULT '[]'::jsonb,
    zero_bonus_rules JSONB NOT NULL DEFAULT '[]'::jsonb,
    rounding_policy JSONB NOT NULL DEFAULT '{"scoreScale":2,"moneyScale":2}'::jsonb,
    effective_month DATE,
    expires_month DATE,
    content_hash CHAR(64) NOT NULL,
    published_by UUID,
    published_at TIMESTAMPTZ,
    created_by UUID,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, id),
    UNIQUE (tenant_id, policy_id, version_no),
    CHECK (effective_month IS NULL OR date_trunc('month', effective_month)::date = effective_month),
    CHECK (expires_month IS NULL OR date_trunc('month', expires_month)::date = expires_month),
    CHECK (expires_month IS NULL OR effective_month IS NULL OR expires_month >= effective_month),
    FOREIGN KEY (tenant_id, policy_id) REFERENCES kpi_compensation_policy_definition (tenant_id, id),
    FOREIGN KEY (tenant_id, published_by) REFERENCES user_account (tenant_id, id),
    FOREIGN KEY (tenant_id, created_by) REFERENCES user_account (tenant_id, id)
);

CREATE TABLE kpi_template_definition (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenant(id),
    standard_definition_id UUID NOT NULL,
    template_origin VARCHAR(24) NOT NULL CHECK (template_origin IN ('GROUP_BASE', 'POSITION', 'STORE_SUPPLEMENT')),
    owner_org_unit_id UUID,
    position_id UUID,
    code VARCHAR(80) NOT NULL,
    name VARCHAR(180) NOT NULL,
    status VARCHAR(24) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'INACTIVE')),
    created_by UUID,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, id),
    UNIQUE (tenant_id, standard_definition_id),
    UNIQUE (tenant_id, code),
    CHECK (template_origin = 'GROUP_BASE' OR position_id IS NOT NULL),
    CHECK (template_origin <> 'STORE_SUPPLEMENT' OR owner_org_unit_id IS NOT NULL),
    FOREIGN KEY (tenant_id, standard_definition_id) REFERENCES standard_definition (tenant_id, id),
    FOREIGN KEY (tenant_id, owner_org_unit_id) REFERENCES org_unit (tenant_id, id),
    FOREIGN KEY (tenant_id, position_id) REFERENCES position_definition (tenant_id, id),
    FOREIGN KEY (tenant_id, created_by) REFERENCES user_account (tenant_id, id)
);

CREATE TABLE kpi_template_version (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenant(id),
    template_id UUID NOT NULL,
    standard_version_id UUID NOT NULL,
    base_template_version_id UUID,
    compensation_policy_version_id UUID,
    version_no INTEGER NOT NULL CHECK (version_no > 0),
    review_status VARCHAR(24) NOT NULL DEFAULT 'DRAFT'
        CHECK (review_status IN ('DRAFT', 'IN_REVIEW', 'APPROVED', 'REJECTED')),
    base_full_score NUMERIC(12,4) NOT NULL DEFAULT 100,
    allow_extra_score BOOLEAN NOT NULL DEFAULT true,
    effective_month DATE,
    expires_month DATE,
    configuration JSONB NOT NULL DEFAULT '{}'::jsonb,
    content_hash CHAR(64) NOT NULL,
    row_version BIGINT NOT NULL DEFAULT 0,
    created_by UUID,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, id),
    UNIQUE (tenant_id, template_id, version_no),
    UNIQUE (tenant_id, standard_version_id),
    CHECK (effective_month IS NULL OR date_trunc('month', effective_month)::date = effective_month),
    CHECK (expires_month IS NULL OR date_trunc('month', expires_month)::date = expires_month),
    CHECK (expires_month IS NULL OR effective_month IS NULL OR expires_month >= effective_month),
    FOREIGN KEY (tenant_id, template_id) REFERENCES kpi_template_definition (tenant_id, id),
    FOREIGN KEY (tenant_id, standard_version_id) REFERENCES standard_version (tenant_id, id),
    FOREIGN KEY (tenant_id, base_template_version_id) REFERENCES kpi_template_version (tenant_id, id),
    FOREIGN KEY (tenant_id, compensation_policy_version_id) REFERENCES kpi_compensation_policy_version (tenant_id, id),
    FOREIGN KEY (tenant_id, created_by) REFERENCES user_account (tenant_id, id)
);

CREATE TABLE kpi_template_section (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenant(id),
    template_version_id UUID NOT NULL,
    section_code VARCHAR(80) NOT NULL,
    name VARCHAR(180) NOT NULL,
    max_score NUMERIC(12,4) NOT NULL,
    min_score NUMERIC(12,4),
    sort_order INTEGER NOT NULL DEFAULT 0,
    configuration JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, id),
    UNIQUE (tenant_id, template_version_id, section_code),
    CHECK (min_score IS NULL OR min_score <= max_score),
    FOREIGN KEY (tenant_id, template_version_id) REFERENCES kpi_template_version (tenant_id, id) ON DELETE CASCADE
);

CREATE TABLE kpi_indicator_rule (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenant(id),
    section_id UUID NOT NULL,
    metric_version_id UUID,
    indicator_code VARCHAR(100) NOT NULL,
    name VARCHAR(200) NOT NULL,
    indicator_type VARCHAR(32) NOT NULL
        CHECK (indicator_type IN ('TARGET', 'COMPLETION_RATE', 'ON_TIME', 'EVENT_DEDUCTION', 'CONDITION', 'MILESTONE', 'MANUAL', 'BONUS_ADJUSTMENT', 'COMPOSITE')),
    weekly_split_type VARCHAR(32) NOT NULL DEFAULT 'SAME_TARGET'
        CHECK (weekly_split_type IN ('SAME_TARGET', 'EQUAL_FOUR_WEEKS', 'CUSTOM_FOUR_WEEKS', 'DUE_DATE', 'MILESTONE', 'MONTH_END_ONLY')),
    max_score NUMERIC(12,4) NOT NULL DEFAULT 0,
    min_score NUMERIC(12,4),
    target_value NUMERIC(20,6),
    allow_above_max BOOLEAN NOT NULL DEFAULT false,
    precision_scale INTEGER NOT NULL DEFAULT 2 CHECK (precision_scale BETWEEN 0 AND 6),
    evidence_required BOOLEAN NOT NULL DEFAULT false,
    evaluator_type VARCHAR(24) NOT NULL DEFAULT 'SYSTEM'
        CHECK (evaluator_type IN ('SYSTEM', 'MANUAL_EVALUATOR')),
    not_applicable_policy VARCHAR(32) NOT NULL DEFAULT 'PENDING_VERIFICATION'
        CHECK (not_applicable_policy IN ('FULL_SCORE', 'PROPORTIONAL_SECTION', 'PENDING_VERIFICATION', 'ALTERNATE_INDICATOR')),
    sort_order INTEGER NOT NULL DEFAULT 0,
    formula_config JSONB NOT NULL DEFAULT '{}'::jsonb,
    warning_config JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, id),
    UNIQUE (tenant_id, section_id, indicator_code),
    CHECK (min_score IS NULL OR min_score <= max_score),
    CHECK (indicator_type <> 'MANUAL' OR evaluator_type = 'MANUAL_EVALUATOR'),
    CHECK (weekly_split_type <> 'CUSTOM_FOUR_WEEKS' OR jsonb_typeof(formula_config -> 'weeklyWeights') = 'array'),
    FOREIGN KEY (tenant_id, section_id) REFERENCES kpi_template_section (tenant_id, id) ON DELETE CASCADE,
    FOREIGN KEY (tenant_id, metric_version_id) REFERENCES metric_definition_version (tenant_id, id)
);

CREATE TABLE kpi_template_approval (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenant(id),
    template_version_id UUID NOT NULL,
    approval_stage VARCHAR(24) NOT NULL CHECK (approval_stage IN ('DEPARTMENT', 'HR', 'CEO')),
    decision VARCHAR(24) NOT NULL CHECK (decision IN ('APPROVED', 'REJECTED', 'RETURNED')),
    comment TEXT,
    decided_by UUID NOT NULL,
    decided_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, id),
    FOREIGN KEY (tenant_id, template_version_id) REFERENCES kpi_template_version (tenant_id, id),
    FOREIGN KEY (tenant_id, decided_by) REFERENCES user_account (tenant_id, id)
);

CREATE TABLE kpi_template_binding (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenant(id),
    template_version_id UUID NOT NULL,
    position_id UUID,
    org_unit_id UUID,
    binding_level VARCHAR(24) NOT NULL CHECK (binding_level IN ('GROUP_BASE', 'POSITION', 'STORE')),
    effective_month DATE NOT NULL,
    expires_month DATE,
    priority INTEGER NOT NULL DEFAULT 0,
    created_by UUID,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, id),
    CHECK (date_trunc('month', effective_month)::date = effective_month),
    CHECK (expires_month IS NULL OR date_trunc('month', expires_month)::date = expires_month),
    CHECK (expires_month IS NULL OR expires_month >= effective_month),
    CHECK (binding_level = 'GROUP_BASE' OR position_id IS NOT NULL),
    CHECK (binding_level <> 'STORE' OR org_unit_id IS NOT NULL),
    FOREIGN KEY (tenant_id, template_version_id) REFERENCES kpi_template_version (tenant_id, id),
    FOREIGN KEY (tenant_id, position_id) REFERENCES position_definition (tenant_id, id),
    FOREIGN KEY (tenant_id, org_unit_id) REFERENCES org_unit (tenant_id, id),
    FOREIGN KEY (tenant_id, created_by) REFERENCES user_account (tenant_id, id)
);

CREATE TABLE kpi_assessment_relation (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenant(id),
    employee_id UUID NOT NULL,
    position_assignment_id UUID NOT NULL,
    template_id UUID NOT NULL,
    evaluator_assignment_id UUID,
    department_reviewer_assignment_id UUID,
    valid_from DATE NOT NULL,
    valid_to DATE,
    status VARCHAR(24) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'INACTIVE')),
    created_by UUID,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, id),
    CHECK (valid_to IS NULL OR valid_to >= valid_from),
    FOREIGN KEY (tenant_id, employee_id) REFERENCES employee (tenant_id, id),
    FOREIGN KEY (tenant_id, position_assignment_id) REFERENCES employee_position_assignment (tenant_id, id),
    FOREIGN KEY (tenant_id, template_id) REFERENCES kpi_template_definition (tenant_id, id),
    FOREIGN KEY (tenant_id, evaluator_assignment_id) REFERENCES employee_position_assignment (tenant_id, id),
    FOREIGN KEY (tenant_id, department_reviewer_assignment_id) REFERENCES employee_position_assignment (tenant_id, id),
    FOREIGN KEY (tenant_id, created_by) REFERENCES user_account (tenant_id, id)
);

CREATE TABLE kpi_relation_scope (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenant(id),
    relation_id UUID NOT NULL,
    scope_type VARCHAR(24) NOT NULL CHECK (scope_type IN ('GROUP', 'STORE', 'DEPARTMENT', 'CHANNEL')),
    org_unit_id UUID,
    channel_code VARCHAR(64),
    is_primary BOOLEAN NOT NULL DEFAULT false,
    valid_from DATE NOT NULL,
    valid_to DATE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, id),
    CHECK (valid_to IS NULL OR valid_to >= valid_from),
    CHECK ((scope_type = 'CHANNEL' AND channel_code IS NOT NULL) OR (scope_type <> 'CHANNEL' AND org_unit_id IS NOT NULL)),
    FOREIGN KEY (tenant_id, relation_id) REFERENCES kpi_assessment_relation (tenant_id, id) ON DELETE CASCADE,
    FOREIGN KEY (tenant_id, org_unit_id) REFERENCES org_unit (tenant_id, id)
);

CREATE TABLE kpi_period (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenant(id),
    month_start DATE NOT NULL,
    status VARCHAR(32) NOT NULL DEFAULT 'OPEN'
        CHECK (status IN ('OPEN', 'GENERATING', 'DRAFT', 'DEPARTMENT_REVIEW', 'HR_REVIEW', 'DISPUTE', 'CEO_APPROVAL', 'LOCKED', 'CORRECTED')),
    draft_due_at TIMESTAMPTZ NOT NULL,
    dispute_due_at TIMESTAMPTZ NOT NULL,
    confirmation_due_at TIMESTAMPTZ NOT NULL,
    lock_due_at TIMESTAMPTZ NOT NULL,
    locked_by UUID,
    locked_at TIMESTAMPTZ,
    row_version BIGINT NOT NULL DEFAULT 0,
    created_by UUID,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, id),
    UNIQUE (tenant_id, month_start),
    CHECK (date_trunc('month', month_start)::date = month_start),
    FOREIGN KEY (tenant_id, locked_by) REFERENCES user_account (tenant_id, id),
    FOREIGN KEY (tenant_id, created_by) REFERENCES user_account (tenant_id, id)
);

CREATE TABLE kpi_responsibility_snapshot (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenant(id),
    period_id UUID NOT NULL,
    relation_id UUID NOT NULL,
    employee_id UUID NOT NULL,
    position_assignment_id UUID NOT NULL,
    template_version_id UUID NOT NULL,
    evaluator_assignment_id UUID,
    responsibility_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
    content_hash CHAR(64) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, id),
    UNIQUE (tenant_id, period_id, employee_id),
    FOREIGN KEY (tenant_id, period_id) REFERENCES kpi_period (tenant_id, id),
    FOREIGN KEY (tenant_id, relation_id) REFERENCES kpi_assessment_relation (tenant_id, id),
    FOREIGN KEY (tenant_id, employee_id) REFERENCES employee (tenant_id, id),
    FOREIGN KEY (tenant_id, position_assignment_id) REFERENCES employee_position_assignment (tenant_id, id),
    FOREIGN KEY (tenant_id, template_version_id) REFERENCES kpi_template_version (tenant_id, id),
    FOREIGN KEY (tenant_id, evaluator_assignment_id) REFERENCES employee_position_assignment (tenant_id, id)
);

CREATE TABLE kpi_metric_fact (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenant(id),
    metric_version_id UUID NOT NULL,
    org_unit_id UUID,
    employee_id UUID,
    position_assignment_id UUID,
    channel_code VARCHAR(64),
    business_time TIMESTAMPTZ,
    business_date DATE NOT NULL,
    period_start DATE,
    period_end DATE,
    value NUMERIC(24,8),
    numerator NUMERIC(24,8),
    denominator NUMERIC(24,8),
    data_state VARCHAR(32) NOT NULL DEFAULT 'AVAILABLE'
        CHECK (data_state IN ('AVAILABLE', 'PENDING_VERIFICATION', 'NOT_APPLICABLE', 'UNAVAILABLE')),
    source_type VARCHAR(32) NOT NULL,
    source_record_id VARCHAR(200),
    source_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
    content_hash CHAR(64) NOT NULL,
    revision_no INTEGER NOT NULL DEFAULT 1 CHECK (revision_no > 0),
    supersedes_fact_id UUID,
    idempotency_key VARCHAR(240) NOT NULL,
    created_by UUID,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, id),
    UNIQUE (tenant_id, idempotency_key),
    CHECK (period_end IS NULL OR period_start IS NULL OR period_end >= period_start),
    CHECK (denominator IS NULL OR denominator >= 0),
    FOREIGN KEY (tenant_id, metric_version_id) REFERENCES metric_definition_version (tenant_id, id),
    FOREIGN KEY (tenant_id, org_unit_id) REFERENCES org_unit (tenant_id, id),
    FOREIGN KEY (tenant_id, employee_id) REFERENCES employee (tenant_id, id),
    FOREIGN KEY (tenant_id, position_assignment_id) REFERENCES employee_position_assignment (tenant_id, id),
    FOREIGN KEY (tenant_id, supersedes_fact_id) REFERENCES kpi_metric_fact (tenant_id, id),
    FOREIGN KEY (tenant_id, created_by) REFERENCES user_account (tenant_id, id)
);

CREATE TABLE kpi_scorecard (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenant(id),
    period_id UUID NOT NULL,
    responsibility_snapshot_id UUID NOT NULL,
    card_type VARCHAR(16) NOT NULL CHECK (card_type IN ('WEEK', 'MONTH')),
    week_no INTEGER CHECK (week_no BETWEEN 1 AND 4),
    period_start DATE NOT NULL,
    period_end DATE NOT NULL,
    status VARCHAR(32) NOT NULL DEFAULT 'DRAFT'
        CHECK (status IN ('DRAFT', 'PENDING_MANUAL', 'PENDING_VERIFICATION', 'DEPARTMENT_REVIEW', 'HR_REVIEW', 'DISPUTE', 'CEO_APPROVAL', 'LOCKED', 'CORRECTED')),
    current_revision_no INTEGER NOT NULL DEFAULT 0,
    base_score NUMERIC(14,4),
    extra_score NUMERIC(14,4),
    final_score NUMERIC(14,4),
    warning_level VARCHAR(16) NOT NULL DEFAULT 'NONE' CHECK (warning_level IN ('NONE', 'YELLOW', 'ORANGE', 'RED')),
    generated_at TIMESTAMPTZ,
    locked_by UUID,
    locked_at TIMESTAMPTZ,
    row_version BIGINT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, id),
    UNIQUE (tenant_id, responsibility_snapshot_id, card_type, week_no),
    CHECK ((card_type = 'WEEK' AND week_no IS NOT NULL) OR (card_type = 'MONTH' AND week_no IS NULL)),
    CHECK (period_end >= period_start),
    FOREIGN KEY (tenant_id, period_id) REFERENCES kpi_period (tenant_id, id),
    FOREIGN KEY (tenant_id, responsibility_snapshot_id) REFERENCES kpi_responsibility_snapshot (tenant_id, id),
    FOREIGN KEY (tenant_id, locked_by) REFERENCES user_account (tenant_id, id)
);

CREATE UNIQUE INDEX uq_kpi_scorecard_week
    ON kpi_scorecard (tenant_id, responsibility_snapshot_id, week_no)
    WHERE card_type = 'WEEK';
CREATE UNIQUE INDEX uq_kpi_scorecard_month
    ON kpi_scorecard (tenant_id, responsibility_snapshot_id)
    WHERE card_type = 'MONTH';

CREATE TABLE kpi_scorecard_revision (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenant(id),
    scorecard_id UUID NOT NULL,
    revision_no INTEGER NOT NULL CHECK (revision_no > 0),
    revision_type VARCHAR(24) NOT NULL DEFAULT 'CALCULATION'
        CHECK (revision_type IN ('CALCULATION', 'LATE_DATA', 'MANUAL_SCORE', 'DISPUTE_CORRECTION', 'LOCK_CORRECTION')),
    calculation_version VARCHAR(40) NOT NULL,
    data_cutoff_at TIMESTAMPTZ NOT NULL,
    data_state VARCHAR(32) NOT NULL,
    base_score NUMERIC(14,4),
    extra_score NUMERIC(14,4),
    final_score NUMERIC(14,4),
    performance_coefficient NUMERIC(10,4),
    original_bonus_base NUMERIC(16,2),
    bonus_adjustment NUMERIC(16,2),
    adjusted_bonus_base NUMERIC(16,2),
    attendance_coefficient NUMERIC(10,4),
    payable_bonus NUMERIC(16,2),
    calculation_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
    content_hash CHAR(64) NOT NULL,
    reason TEXT,
    created_by UUID,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, id),
    UNIQUE (tenant_id, scorecard_id, revision_no),
    FOREIGN KEY (tenant_id, scorecard_id) REFERENCES kpi_scorecard (tenant_id, id),
    FOREIGN KEY (tenant_id, created_by) REFERENCES user_account (tenant_id, id)
);

CREATE TABLE kpi_indicator_result (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenant(id),
    scorecard_revision_id UUID NOT NULL,
    indicator_rule_id UUID NOT NULL,
    section_code VARCHAR(80) NOT NULL,
    indicator_code VARCHAR(100) NOT NULL,
    target_value NUMERIC(24,8),
    actual_value NUMERIC(24,8),
    numerator NUMERIC(24,8),
    denominator NUMERIC(24,8),
    score NUMERIC(14,4),
    max_score NUMERIC(14,4),
    min_score NUMERIC(14,4),
    data_state VARCHAR(32) NOT NULL,
    outcome VARCHAR(24) NOT NULL CHECK (outcome IN ('PENDING', 'PASS', 'WARNING', 'FAIL', 'NOT_APPLICABLE')),
    details JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, id),
    UNIQUE (tenant_id, scorecard_revision_id, indicator_rule_id),
    FOREIGN KEY (tenant_id, scorecard_revision_id) REFERENCES kpi_scorecard_revision (tenant_id, id) ON DELETE CASCADE,
    FOREIGN KEY (tenant_id, indicator_rule_id) REFERENCES kpi_indicator_rule (tenant_id, id)
);

CREATE TABLE kpi_manual_score (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenant(id),
    scorecard_id UUID NOT NULL,
    indicator_rule_id UUID NOT NULL,
    score NUMERIC(14,4) NOT NULL,
    explanation TEXT NOT NULL,
    evaluator_assignment_id UUID NOT NULL,
    supersedes_manual_score_id UUID,
    content_hash CHAR(64) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, id),
    FOREIGN KEY (tenant_id, scorecard_id) REFERENCES kpi_scorecard (tenant_id, id),
    FOREIGN KEY (tenant_id, indicator_rule_id) REFERENCES kpi_indicator_rule (tenant_id, id),
    FOREIGN KEY (tenant_id, evaluator_assignment_id) REFERENCES employee_position_assignment (tenant_id, id),
    FOREIGN KEY (tenant_id, supersedes_manual_score_id) REFERENCES kpi_manual_score (tenant_id, id)
);

CREATE TABLE kpi_evidence (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenant(id),
    scorecard_id UUID NOT NULL,
    indicator_rule_id UUID,
    evidence_type VARCHAR(32) NOT NULL CHECK (evidence_type IN ('METRIC_FACT', 'TASK_EVIDENCE', 'WORK_RECORD', 'SNAPSHOT', 'DOCUMENT', 'EXTERNAL_REFERENCE')),
    reference_id UUID,
    reference_text VARCHAR(500),
    evidence_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
    content_hash CHAR(64) NOT NULL,
    created_by UUID,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, id),
    FOREIGN KEY (tenant_id, scorecard_id) REFERENCES kpi_scorecard (tenant_id, id),
    FOREIGN KEY (tenant_id, indicator_rule_id) REFERENCES kpi_indicator_rule (tenant_id, id),
    FOREIGN KEY (tenant_id, created_by) REFERENCES user_account (tenant_id, id)
);

CREATE TABLE kpi_review (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenant(id),
    scorecard_id UUID NOT NULL,
    review_stage VARCHAR(24) NOT NULL CHECK (review_stage IN ('DEPARTMENT', 'HR', 'CEO')),
    decision VARCHAR(24) NOT NULL CHECK (decision IN ('APPROVED', 'REJECTED', 'RETURNED')),
    comment TEXT,
    reviewed_by UUID NOT NULL,
    reviewed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, id),
    FOREIGN KEY (tenant_id, scorecard_id) REFERENCES kpi_scorecard (tenant_id, id),
    FOREIGN KEY (tenant_id, reviewed_by) REFERENCES user_account (tenant_id, id)
);

CREATE TABLE kpi_dispute (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenant(id),
    scorecard_id UUID NOT NULL,
    indicator_rule_id UUID,
    reason TEXT NOT NULL,
    status VARCHAR(24) NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'VERIFYING', 'ACCEPTED', 'REJECTED', 'CLOSED')),
    resolution TEXT,
    raised_by UUID NOT NULL,
    raised_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    resolved_by UUID,
    resolved_at TIMESTAMPTZ,
    row_version BIGINT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, id),
    FOREIGN KEY (tenant_id, scorecard_id) REFERENCES kpi_scorecard (tenant_id, id),
    FOREIGN KEY (tenant_id, indicator_rule_id) REFERENCES kpi_indicator_rule (tenant_id, id),
    FOREIGN KEY (tenant_id, raised_by) REFERENCES user_account (tenant_id, id),
    FOREIGN KEY (tenant_id, resolved_by) REFERENCES user_account (tenant_id, id)
);

CREATE TABLE kpi_correction (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenant(id),
    scorecard_id UUID NOT NULL,
    correction_type VARCHAR(24) NOT NULL CHECK (correction_type IN ('DATA', 'MANUAL_SCORE', 'TEMPLATE_EXCEPTION', 'LOCKED_RESULT')),
    reason TEXT NOT NULL,
    status VARCHAR(24) NOT NULL DEFAULT 'REQUESTED' CHECK (status IN ('REQUESTED', 'APPROVED', 'REJECTED', 'APPLIED')),
    requested_by UUID NOT NULL,
    approved_by UUID,
    replacement_revision_id UUID,
    row_version BIGINT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, id),
    FOREIGN KEY (tenant_id, scorecard_id) REFERENCES kpi_scorecard (tenant_id, id),
    FOREIGN KEY (tenant_id, requested_by) REFERENCES user_account (tenant_id, id),
    FOREIGN KEY (tenant_id, approved_by) REFERENCES user_account (tenant_id, id),
    FOREIGN KEY (tenant_id, replacement_revision_id) REFERENCES kpi_scorecard_revision (tenant_id, id)
);

CREATE TABLE kpi_bonus_adjustment (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenant(id),
    scorecard_revision_id UUID NOT NULL,
    adjustment_code VARCHAR(100) NOT NULL,
    description VARCHAR(300) NOT NULL,
    quantity NUMERIC(14,4) NOT NULL DEFAULT 1,
    amount_per_unit NUMERIC(16,2) NOT NULL,
    total_amount NUMERIC(16,2) NOT NULL,
    source_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, id),
    UNIQUE (tenant_id, scorecard_revision_id, adjustment_code),
    FOREIGN KEY (tenant_id, scorecard_revision_id) REFERENCES kpi_scorecard_revision (tenant_id, id)
);

CREATE TABLE kpi_employee_bonus_base (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenant(id),
    employee_id UUID NOT NULL,
    effective_month DATE NOT NULL,
    expires_month DATE,
    amount NUMERIC(16,2) NOT NULL CHECK (amount >= 0),
    reason TEXT NOT NULL,
    content_hash CHAR(64) NOT NULL,
    supersedes_bonus_base_id UUID,
    created_by UUID NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, id),
    CHECK (date_trunc('month', effective_month)::date = effective_month),
    CHECK (expires_month IS NULL OR date_trunc('month', expires_month)::date = expires_month),
    CHECK (expires_month IS NULL OR expires_month >= effective_month),
    FOREIGN KEY (tenant_id, employee_id) REFERENCES employee (tenant_id, id),
    FOREIGN KEY (tenant_id, supersedes_bonus_base_id) REFERENCES kpi_employee_bonus_base (tenant_id, id),
    FOREIGN KEY (tenant_id, created_by) REFERENCES user_account (tenant_id, id)
);

CREATE TABLE kpi_settlement (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenant(id),
    period_id UUID NOT NULL,
    employee_id UUID NOT NULL,
    scorecard_id UUID NOT NULL,
    scorecard_revision_id UUID NOT NULL,
    original_bonus_base NUMERIC(16,2) NOT NULL,
    bonus_adjustment NUMERIC(16,2) NOT NULL DEFAULT 0,
    adjusted_bonus_base NUMERIC(16,2) NOT NULL,
    performance_coefficient NUMERIC(10,4) NOT NULL,
    attendance_coefficient NUMERIC(10,4) NOT NULL,
    payable_bonus NUMERIC(16,2) NOT NULL CHECK (payable_bonus >= 0),
    status VARCHAR(24) NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'PENDING_VERIFICATION', 'CONFIRMED', 'LOCKED', 'CORRECTED')),
    locked_by UUID,
    locked_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, id),
    UNIQUE (tenant_id, period_id, employee_id),
    FOREIGN KEY (tenant_id, period_id) REFERENCES kpi_period (tenant_id, id),
    FOREIGN KEY (tenant_id, employee_id) REFERENCES employee (tenant_id, id),
    FOREIGN KEY (tenant_id, scorecard_id) REFERENCES kpi_scorecard (tenant_id, id),
    FOREIGN KEY (tenant_id, scorecard_revision_id) REFERENCES kpi_scorecard_revision (tenant_id, id),
    FOREIGN KEY (tenant_id, locked_by) REFERENCES user_account (tenant_id, id)
);

CREATE TABLE kpi_template_import_job (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenant(id),
    original_name VARCHAR(240) NOT NULL,
    media_type VARCHAR(120) NOT NULL,
    size_bytes BIGINT NOT NULL CHECK (size_bytes BETWEEN 1 AND 10485760),
    sha256 CHAR(64) NOT NULL,
    original_content BYTEA NOT NULL,
    status VARCHAR(32) NOT NULL DEFAULT 'UPLOADED'
        CHECK (status IN ('UPLOADED', 'PARSED', 'MAPPING_REQUIRED', 'VALIDATED', 'FAILED', 'APPLIED')),
    extracted_rows JSONB NOT NULL DEFAULT '[]'::jsonb,
    field_mapping JSONB NOT NULL DEFAULT '{}'::jsonb,
    validation_errors JSONB NOT NULL DEFAULT '[]'::jsonb,
    result_template_version_id UUID,
    created_by UUID NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, id),
    FOREIGN KEY (tenant_id, result_template_version_id) REFERENCES kpi_template_version (tenant_id, id),
    FOREIGN KEY (tenant_id, created_by) REFERENCES user_account (tenant_id, id)
);

CREATE INDEX ix_kpi_metric_fact_lookup ON kpi_metric_fact
    (tenant_id, metric_version_id, business_date, org_unit_id, employee_id, channel_code);
CREATE INDEX ix_kpi_relation_employee_period ON kpi_assessment_relation
    (tenant_id, employee_id, valid_from, valid_to, status);
CREATE INDEX ix_kpi_scorecard_period_status ON kpi_scorecard (tenant_id, period_id, status, card_type, week_no);
CREATE INDEX ix_kpi_scorecard_snapshot ON kpi_scorecard (tenant_id, responsibility_snapshot_id, period_start, period_end);
CREATE INDEX ix_kpi_dispute_status ON kpi_dispute (tenant_id, status, raised_at);
CREATE INDEX ix_kpi_template_binding_resolution ON kpi_template_binding
    (tenant_id, position_id, org_unit_id, effective_month, expires_month, priority DESC);

CREATE TRIGGER trg_kpi_policy_definition_updated_at BEFORE UPDATE ON kpi_compensation_policy_definition
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_kpi_template_definition_updated_at BEFORE UPDATE ON kpi_template_definition
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_kpi_template_version_updated_at BEFORE UPDATE ON kpi_template_version
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_kpi_assessment_relation_updated_at BEFORE UPDATE ON kpi_assessment_relation
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_kpi_period_updated_at BEFORE UPDATE ON kpi_period
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_kpi_scorecard_updated_at BEFORE UPDATE ON kpi_scorecard
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_kpi_dispute_updated_at BEFORE UPDATE ON kpi_dispute
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_kpi_correction_updated_at BEFORE UPDATE ON kpi_correction
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_kpi_settlement_updated_at BEFORE UPDATE ON kpi_settlement
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_kpi_template_import_updated_at BEFORE UPDATE ON kpi_template_import_job
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE OR REPLACE FUNCTION prevent_kpi_append_only_mutation()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION '% is append-only; create a correction or superseding version', TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_kpi_metric_fact_append_only BEFORE UPDATE OR DELETE ON kpi_metric_fact
    FOR EACH ROW EXECUTE FUNCTION prevent_kpi_append_only_mutation();
CREATE TRIGGER trg_kpi_scorecard_revision_append_only BEFORE UPDATE OR DELETE ON kpi_scorecard_revision
    FOR EACH ROW EXECUTE FUNCTION prevent_kpi_append_only_mutation();
CREATE TRIGGER trg_kpi_indicator_result_append_only BEFORE UPDATE OR DELETE ON kpi_indicator_result
    FOR EACH ROW EXECUTE FUNCTION prevent_kpi_append_only_mutation();
CREATE TRIGGER trg_kpi_manual_score_append_only BEFORE UPDATE OR DELETE ON kpi_manual_score
    FOR EACH ROW EXECUTE FUNCTION prevent_kpi_append_only_mutation();
CREATE TRIGGER trg_kpi_evidence_append_only BEFORE UPDATE OR DELETE ON kpi_evidence
    FOR EACH ROW EXECUTE FUNCTION prevent_kpi_append_only_mutation();
CREATE TRIGGER trg_kpi_review_append_only BEFORE UPDATE OR DELETE ON kpi_review
    FOR EACH ROW EXECUTE FUNCTION prevent_kpi_append_only_mutation();
CREATE TRIGGER trg_kpi_template_approval_append_only BEFORE UPDATE OR DELETE ON kpi_template_approval
    FOR EACH ROW EXECUTE FUNCTION prevent_kpi_append_only_mutation();
CREATE TRIGGER trg_kpi_employee_bonus_base_append_only BEFORE UPDATE OR DELETE ON kpi_employee_bonus_base
    FOR EACH ROW EXECUTE FUNCTION prevent_kpi_append_only_mutation();

CREATE OR REPLACE FUNCTION prevent_published_kpi_child_mutation()
RETURNS TRIGGER AS $$
DECLARE
    version_id UUID;
    lifecycle VARCHAR(24);
BEGIN
    IF TG_TABLE_NAME = 'kpi_template_version' THEN
        version_id := OLD.id;
    ELSIF TG_TABLE_NAME = 'kpi_template_section' THEN
        version_id := OLD.template_version_id;
    ELSIF TG_TABLE_NAME = 'kpi_indicator_rule' THEN
        SELECT s.template_version_id INTO version_id
        FROM kpi_template_section s
        WHERE s.tenant_id = OLD.tenant_id AND s.id = OLD.section_id;
    END IF;

    SELECT sv.lifecycle_status INTO lifecycle
    FROM kpi_template_version kv
    JOIN standard_version sv ON sv.tenant_id = kv.tenant_id AND sv.id = kv.standard_version_id
    WHERE kv.tenant_id = OLD.tenant_id AND kv.id = version_id;

    IF lifecycle = 'PUBLISHED' THEN
        RAISE EXCEPTION 'published KPI template versions and children are immutable';
    END IF;
    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_kpi_template_version_published_immutable BEFORE UPDATE OR DELETE ON kpi_template_version
    FOR EACH ROW EXECUTE FUNCTION prevent_published_kpi_child_mutation();
CREATE TRIGGER trg_kpi_template_section_published_immutable BEFORE UPDATE OR DELETE ON kpi_template_section
    FOR EACH ROW EXECUTE FUNCTION prevent_published_kpi_child_mutation();
CREATE TRIGGER trg_kpi_indicator_rule_published_immutable BEFORE UPDATE OR DELETE ON kpi_indicator_rule
    FOR EACH ROW EXECUTE FUNCTION prevent_published_kpi_child_mutation();

INSERT INTO permission (code, resource, action, description) VALUES
    ('kpi.metric.read', 'kpi_metric', 'read', '查看KPI统一指标库'),
    ('kpi.metric.manage', 'kpi_metric', 'manage', '管理KPI指标定义版本和标准事实入口'),
    ('kpi.template.read', 'kpi_template', 'read', '查看岗位KPI模板'),
    ('kpi.template.manage', 'kpi_template', 'manage', '管理KPI模板草稿'),
    ('kpi.template.review', 'kpi_template', 'review', '复核KPI模板'),
    ('kpi.template.publish', 'kpi_template', 'publish', '发布或退役KPI模板'),
    ('kpi.template.import', 'kpi_template', 'import', '导入岗位KPI考核表'),
    ('kpi.relation.manage', 'kpi_relation', 'manage', '管理员工KPI考核关系和责任范围'),
    ('kpi.scorecard.read-own', 'kpi_scorecard', 'read-own', '查看本人KPI考核单'),
    ('kpi.scorecard.read-team', 'kpi_scorecard', 'read-team', '查看授权团队KPI考核单'),
    ('kpi.scorecard.read-all', 'kpi_scorecard', 'read-all', '查看全部KPI考核单'),
    ('kpi.scorecard.generate', 'kpi_scorecard', 'generate', '批量生成周月KPI考核单'),
    ('kpi.scorecard.manual-score', 'kpi_scorecard', 'manual-score', '提交授权范围人工评分'),
    ('kpi.scorecard.review', 'kpi_scorecard', 'review', '复核KPI考核单'),
    ('kpi.scorecard.dispute', 'kpi_scorecard', 'dispute', '发起或处理KPI异议'),
    ('kpi.scorecard.lock', 'kpi_scorecard', 'lock', '锁定正式KPI结果'),
    ('kpi.policy.manage', 'kpi_policy', 'manage', '管理绩效系数、考勤和岗位奖金政策'),
    ('kpi.policy.publish', 'kpi_policy', 'publish', '发布绩效与奖金政策'),
    ('kpi.settlement.read', 'kpi_settlement', 'read', '查看授权范围KPI奖金结算'),
    ('kpi.settlement.manage', 'kpi_settlement', 'manage', '管理KPI奖金基数和结算'),
    ('kpi.export', 'kpi_export', 'create', '导出KPI考核、奖金和审计数据')
ON CONFLICT (code) DO NOTHING;

DO $$
DECLARE
    tenant_record RECORD;
    hr_role_id UUID;
BEGIN
    FOR tenant_record IN SELECT id FROM tenant LOOP
        PERFORM set_config('app.tenant_id', tenant_record.id::text, true);

        INSERT INTO position_definition (tenant_id, code, name, job_family, level_code)
        VALUES
            (tenant_record.id, 'GROUP_VICE_PRESIDENT', '集团副总', 'GROUP_MANAGEMENT', 'M4'),
            (tenant_record.id, 'OTA_OPERATION_ASSISTANT', 'OTA运营助理', 'OTA_OPERATION', 'P2'),
            (tenant_record.id, 'HOUSEKEEPING_ATTENDANT', '客房服务员', 'HOUSEKEEPING', 'P1')
        ON CONFLICT (tenant_id, code) DO NOTHING;

        INSERT INTO app_role (tenant_id, code, name, role_type)
        VALUES
            (tenant_record.id, 'HR_KPI_ADMIN', '行政人事KPI管理员', 'SYSTEM'),
            (tenant_record.id, 'GROUP_VICE_PRESIDENT', '集团副总', 'SYSTEM'),
            (tenant_record.id, 'OTA_OPERATION_ASSISTANT', 'OTA运营助理', 'SYSTEM'),
            (tenant_record.id, 'HOUSEKEEPING_ATTENDANT', '客房服务员', 'SYSTEM')
        ON CONFLICT (tenant_id, code) DO NOTHING;

        SELECT id INTO hr_role_id FROM app_role
        WHERE tenant_id = tenant_record.id AND code = 'HR_KPI_ADMIN';

        INSERT INTO role_permission (tenant_id, role_id, permission_id)
        SELECT tenant_record.id, role.id, permission_item.id
        FROM app_role role
        CROSS JOIN permission permission_item
        WHERE role.tenant_id = tenant_record.id
          AND role.code = 'CEO'
          AND permission_item.code LIKE 'kpi.%'
        ON CONFLICT DO NOTHING;

        INSERT INTO role_permission (tenant_id, role_id, permission_id)
        SELECT tenant_record.id, hr_role_id, permission_item.id
        FROM permission permission_item
        WHERE permission_item.code = ANY (ARRAY[
            'kpi.metric.read', 'kpi.metric.manage', 'kpi.template.read', 'kpi.template.manage',
            'kpi.template.review', 'kpi.template.import', 'kpi.relation.manage',
            'kpi.scorecard.read-all', 'kpi.scorecard.generate', 'kpi.scorecard.review',
            'kpi.scorecard.dispute', 'kpi.policy.manage', 'kpi.settlement.read',
            'kpi.settlement.manage', 'kpi.export', 'notification.read'
        ])
        ON CONFLICT DO NOTHING;

        INSERT INTO role_permission (tenant_id, role_id, permission_id)
        SELECT tenant_record.id, role.id, permission_item.id
        FROM app_role role
        JOIN permission permission_item ON permission_item.code = ANY (ARRAY[
            'kpi.template.read', 'kpi.metric.read', 'kpi.scorecard.read-own',
            'kpi.scorecard.read-team', 'kpi.scorecard.manual-score',
            'kpi.scorecard.review', 'kpi.scorecard.dispute', 'notification.read'
        ])
        WHERE role.tenant_id = tenant_record.id
          AND role.code = ANY (ARRAY[
            'GROUP_VICE_PRESIDENT', 'GENERAL_MANAGER', 'ASSISTANT_GENERAL_MANAGER',
            'FRONT_OFFICE_SUPERVISOR', 'HOUSEKEEPING_SUPERVISOR', 'OTA_OPERATION_MANAGER'
        ])
        ON CONFLICT DO NOTHING;

        INSERT INTO role_permission (tenant_id, role_id, permission_id)
        SELECT tenant_record.id, role.id, permission_item.id
        FROM app_role role
        JOIN permission permission_item ON permission_item.code = ANY (ARRAY[
            'kpi.template.read', 'kpi.scorecard.read-own', 'kpi.scorecard.dispute', 'notification.read'
        ])
        WHERE role.tenant_id = tenant_record.id
          AND role.code = ANY (ARRAY['FRONT_DESK', 'OTA_OPERATION_ASSISTANT', 'HOUSEKEEPING_ATTENDANT'])
        ON CONFLICT DO NOTHING;
    END LOOP;
END $$;

DO $$
DECLARE
    table_name TEXT;
BEGIN
    FOREACH table_name IN ARRAY ARRAY[
        'metric_definition_version',
        'kpi_compensation_policy_definition', 'kpi_compensation_policy_version',
        'kpi_template_definition', 'kpi_template_version', 'kpi_template_section',
        'kpi_indicator_rule', 'kpi_template_approval', 'kpi_template_binding',
        'kpi_assessment_relation', 'kpi_relation_scope', 'kpi_period',
        'kpi_responsibility_snapshot', 'kpi_metric_fact', 'kpi_scorecard',
        'kpi_scorecard_revision', 'kpi_indicator_result', 'kpi_manual_score',
        'kpi_evidence', 'kpi_review', 'kpi_dispute', 'kpi_correction',
        'kpi_bonus_adjustment', 'kpi_employee_bonus_base', 'kpi_settlement', 'kpi_template_import_job'
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
            metric_definition_version,
            kpi_compensation_policy_definition, kpi_compensation_policy_version,
            kpi_template_definition, kpi_template_version, kpi_template_section,
            kpi_indicator_rule, kpi_template_approval, kpi_template_binding,
            kpi_assessment_relation, kpi_relation_scope, kpi_period,
            kpi_responsibility_snapshot, kpi_metric_fact, kpi_scorecard,
            kpi_scorecard_revision, kpi_indicator_result, kpi_manual_score,
            kpi_evidence, kpi_review, kpi_dispute, kpi_correction,
            kpi_bonus_adjustment, kpi_employee_bonus_base, kpi_settlement, kpi_template_import_job
        TO hotel_ai_os_app;
    END IF;
END $$;
