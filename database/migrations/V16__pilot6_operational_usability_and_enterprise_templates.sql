-- TECH-V0.2-PILOT.6 operational usability and CEO-owned enterprise templates.

SELECT set_config('app.tenant_id', '10000000-0000-0000-0000-000000000001', false);

INSERT INTO permission (code, resource, action, description) VALUES
    ('template.read', 'enterprise_template', 'read', '查看授权范围企业模板'),
    ('template.manage', 'enterprise_template', 'manage', '管理企业模板草稿'),
    ('template.publish', 'enterprise_template', 'publish', '发布企业模板版本')
ON CONFLICT (code) DO NOTHING;

-- Managers consume published task/dashboard templates. Only CEO receives manage/publish below.
INSERT INTO role_permission (tenant_id, role_id, permission_id)
SELECT '10000000-0000-0000-0000-000000000001', role.id, permission.id
FROM app_role role
JOIN permission ON permission.code = 'template.read'
WHERE role.tenant_id = '10000000-0000-0000-0000-000000000001'
  AND role.code IN (
      'HOUSEKEEPING_SUPERVISOR', 'FRONT_OFFICE_SUPERVISOR',
      'ASSISTANT_GENERAL_MANAGER', 'GENERAL_MANAGER', 'OTA_OPERATION_MANAGER', 'CEO'
  )
ON CONFLICT DO NOTHING;

INSERT INTO role_permission (tenant_id, role_id, permission_id)
SELECT '10000000-0000-0000-0000-000000000001', role.id, permission.id
FROM app_role role
JOIN permission ON permission.code IN ('template.manage', 'template.publish')
WHERE role.tenant_id = '10000000-0000-0000-0000-000000000001'
  AND role.code = 'CEO'
ON CONFLICT DO NOTHING;

ALTER TABLE work_package_item
    ADD COLUMN IF NOT EXISTS submission_policy JSONB NOT NULL DEFAULT
    '{"completionStatementRequired":true,"exceptionStatementRequired":false,"nextActionRequired":false,"attachmentRequired":false,"maxAttachments":10,"maxFileSizeBytes":20971520,"allowedExtensions":["jpg","jpeg","png","pdf","docx","xlsx"]}'::jsonb;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'ck_work_package_item_submission_policy_object'
          AND conrelid = 'work_package_item'::regclass
    ) THEN
        ALTER TABLE work_package_item
            ADD CONSTRAINT ck_work_package_item_submission_policy_object
            CHECK (jsonb_typeof(submission_policy) = 'object');
    END IF;
END $$;

ALTER TABLE work_record
    ADD COLUMN IF NOT EXISTS completion_statement TEXT,
    ADD COLUMN IF NOT EXISTS exception_statement TEXT,
    ADD COLUMN IF NOT EXISTS next_action TEXT;

CREATE TABLE enterprise_template_definition (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenant(id),
    template_type VARCHAR(32) NOT NULL CHECK (template_type IN ('TASK', 'HOTEL_DASHBOARD')),
    code VARCHAR(80) NOT NULL,
    name VARCHAR(180) NOT NULL,
    description TEXT,
    target_position_id UUID,
    owner_org_unit_id UUID,
    created_by UUID NOT NULL,
    row_version BIGINT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, id),
    UNIQUE (tenant_id, template_type, code),
    FOREIGN KEY (tenant_id, target_position_id) REFERENCES position_definition (tenant_id, id),
    FOREIGN KEY (tenant_id, owner_org_unit_id) REFERENCES org_unit (tenant_id, id),
    FOREIGN KEY (tenant_id, created_by) REFERENCES user_account (tenant_id, id)
);

CREATE TABLE enterprise_template_version (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenant(id),
    template_id UUID NOT NULL,
    version_no INTEGER NOT NULL CHECK (version_no > 0),
    lifecycle_status VARCHAR(24) NOT NULL DEFAULT 'DRAFT'
        CHECK (lifecycle_status IN ('DRAFT', 'PUBLISHED', 'RETIRED')),
    configuration JSONB NOT NULL DEFAULT '{}'::jsonb,
    effective_from TIMESTAMPTZ,
    effective_to TIMESTAMPTZ,
    created_by UUID NOT NULL,
    published_by UUID,
    published_at TIMESTAMPTZ,
    row_version BIGINT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, id),
    UNIQUE (tenant_id, template_id, version_no),
    CHECK (jsonb_typeof(configuration) = 'object'),
    CHECK (effective_to IS NULL OR effective_from IS NULL OR effective_to > effective_from),
    FOREIGN KEY (tenant_id, template_id)
        REFERENCES enterprise_template_definition (tenant_id, id) ON DELETE CASCADE,
    FOREIGN KEY (tenant_id, created_by) REFERENCES user_account (tenant_id, id),
    FOREIGN KEY (tenant_id, published_by) REFERENCES user_account (tenant_id, id)
);

CREATE UNIQUE INDEX ux_enterprise_template_one_draft
    ON enterprise_template_version (tenant_id, template_id)
    WHERE lifecycle_status = 'DRAFT';
CREATE INDEX ix_enterprise_template_type
    ON enterprise_template_definition (tenant_id, template_type, target_position_id);
CREATE INDEX ix_enterprise_template_version_lookup
    ON enterprise_template_version (tenant_id, template_id, lifecycle_status, version_no DESC);

CREATE TABLE work_record_supplement (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenant(id),
    work_record_id UUID NOT NULL,
    submitted_by_assignment_id UUID NOT NULL,
    content TEXT NOT NULL CHECK (length(trim(content)) > 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, id),
    FOREIGN KEY (tenant_id, work_record_id) REFERENCES work_record (tenant_id, id) ON DELETE CASCADE,
    FOREIGN KEY (tenant_id, submitted_by_assignment_id)
        REFERENCES employee_position_assignment (tenant_id, id)
);

CREATE INDEX ix_work_record_supplement_record
    ON work_record_supplement (tenant_id, work_record_id, created_at);

ALTER TABLE task_evidence
    ADD COLUMN IF NOT EXISTS scan_status VARCHAR(24) NOT NULL DEFAULT 'PENDING'
        CHECK (scan_status IN ('PENDING', 'CLEAN', 'REJECTED', 'BYPASSED_DEV', 'SANITIZED_IMAGE'));

ALTER TABLE enterprise_template_definition ENABLE ROW LEVEL SECURITY;
ALTER TABLE enterprise_template_definition FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON enterprise_template_definition
    USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
    WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE enterprise_template_version ENABLE ROW LEVEL SECURITY;
ALTER TABLE enterprise_template_version FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON enterprise_template_version
    USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
    WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE work_record_supplement ENABLE ROW LEVEL SECURITY;
ALTER TABLE work_record_supplement FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON work_record_supplement
    USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
    WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

CREATE TRIGGER trg_enterprise_template_definition_updated_at
    BEFORE UPDATE ON enterprise_template_definition
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_enterprise_template_version_updated_at
    BEFORE UPDATE ON enterprise_template_version
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'hotel_ai_os_app') THEN
        GRANT SELECT, INSERT, UPDATE, DELETE ON enterprise_template_definition,
            enterprise_template_version, work_record_supplement TO hotel_ai_os_app;
    END IF;
END $$;

-- Seed usable group templates. They are configuration, not hard-coded UI behavior.
INSERT INTO enterprise_template_definition
    (id, tenant_id, template_type, code, name, description, owner_org_unit_id, created_by)
VALUES
    ('51000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001',
     'TASK', 'TASK-RECTIFICATION', '整改任务模板', '标准评价或现场检查不合格后的整改任务。',
     '12000000-0000-0000-0000-000000000001', '19000000-0000-0000-0000-000000000001'),
    ('51000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001',
     'TASK', 'TASK-MANAGEMENT', '临时管理任务模板', '管理人员直接下达的临时工作任务。',
     '12000000-0000-0000-0000-000000000001', '19000000-0000-0000-0000-000000000001'),
    ('51000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000001',
     'HOTEL_DASHBOARD', 'DASHBOARD-HOTEL-DEFAULT', '门店驾驶舱默认模板', '集团统一门店驾驶舱布局。',
     '12000000-0000-0000-0000-000000000001', '19000000-0000-0000-0000-000000000001')
ON CONFLICT (tenant_id, template_type, code) DO NOTHING;

INSERT INTO enterprise_template_version
    (id, tenant_id, template_id, version_no, lifecycle_status, configuration,
     effective_from, created_by, published_by, published_at)
VALUES
    ('51100000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001',
     '51000000-0000-0000-0000-000000000001', 1, 'PUBLISHED',
     '{"titlePrefix":"整改：","description":"请按关联标准完成整改，提交结果说明和现场证据。","priority":"HIGH","dueHours":24,"evidencePolicy":{"narrativeRequired":true,"attachmentRequired":true,"maxAttachments":10,"allowedExtensions":["jpg","jpeg","png","pdf","docx","xlsx"]}}',
     now(), '19000000-0000-0000-0000-000000000001', '19000000-0000-0000-0000-000000000001', now()),
    ('51100000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001',
     '51000000-0000-0000-0000-000000000002', 1, 'PUBLISHED',
     '{"titlePrefix":"","description":"请按要求完成任务并提交结果说明。","priority":"NORMAL","dueHours":24,"evidencePolicy":{"narrativeRequired":true,"attachmentRequired":false,"maxAttachments":10,"allowedExtensions":["jpg","jpeg","png","pdf","docx","xlsx"]}}',
     now(), '19000000-0000-0000-0000-000000000001', '19000000-0000-0000-0000-000000000001', now()),
    ('51100000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000001',
     '51000000-0000-0000-0000-000000000003', 1, 'PUBLISHED',
     '{"sections":["OPERATING_METRICS","RISKS","INCOMPLETE_TASKS","WORK_COMPLETION"],"metricCodes":["REVENUE","OCCUPANCY_RATE","ADR","REVPAR","OTA_RATING","COST"],"riskLimit":10,"taskLimit":20}',
     now(), '19000000-0000-0000-0000-000000000001', '19000000-0000-0000-0000-000000000001', now())
ON CONFLICT (tenant_id, template_id, version_no) DO NOTHING;
