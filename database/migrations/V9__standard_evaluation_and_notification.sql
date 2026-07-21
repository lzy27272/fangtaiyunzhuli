CREATE TABLE standard_evaluation (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenant(id),
    idempotency_key VARCHAR(200) NOT NULL,
    subject_type VARCHAR(24) NOT NULL CHECK (subject_type IN ('WORK_RECORD', 'TASK')),
    subject_id UUID NOT NULL,
    org_unit_id UUID NOT NULL,
    position_assignment_id UUID,
    standard_version_id UUID NOT NULL,
    standard_content_hash CHAR(64) NOT NULL,
    input_hash CHAR(64) NOT NULL,
    input_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
    execution_status VARCHAR(24) NOT NULL DEFAULT 'RUNNING'
        CHECK (execution_status IN ('RUNNING', 'PENDING_MANUAL', 'COMPLETED', 'FAILED')),
    outcome VARCHAR(24) NOT NULL DEFAULT 'PENDING'
        CHECK (outcome IN ('PENDING', 'PASS', 'WARNING', 'FAIL')),
    score NUMERIC(8,2),
    full_score NUMERIC(8,2),
    severity VARCHAR(16) NOT NULL DEFAULT 'NONE'
        CHECK (severity IN ('NONE', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL')),
    evaluator_version VARCHAR(32) NOT NULL DEFAULT 'deterministic-v1',
    failure_reason TEXT,
    row_version BIGINT NOT NULL DEFAULT 0,
    completed_at TIMESTAMPTZ,
    created_by UUID,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, id),
    UNIQUE (tenant_id, idempotency_key),
    FOREIGN KEY (tenant_id, org_unit_id) REFERENCES org_unit (tenant_id, id),
    FOREIGN KEY (tenant_id, position_assignment_id) REFERENCES employee_position_assignment (tenant_id, id),
    FOREIGN KEY (tenant_id, standard_version_id) REFERENCES standard_version (tenant_id, id),
    FOREIGN KEY (tenant_id, created_by) REFERENCES user_account (tenant_id, id)
);

CREATE TABLE standard_evaluation_item (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenant(id),
    evaluation_id UUID NOT NULL,
    item_code VARCHAR(120) NOT NULL,
    evaluation_mode VARCHAR(24) NOT NULL DEFAULT 'DETERMINISTIC'
        CHECK (evaluation_mode IN ('DETERMINISTIC', 'MANUAL', 'AI_RESERVED')),
    operator VARCHAR(24),
    expected_value JSONB,
    actual_value JSONB,
    outcome VARCHAR(24) NOT NULL CHECK (outcome IN ('PENDING', 'PASS', 'WARNING', 'FAIL')),
    score NUMERIC(8,2),
    full_score NUMERIC(8,2),
    reason TEXT,
    row_version BIGINT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, id),
    UNIQUE (tenant_id, evaluation_id, item_code),
    FOREIGN KEY (tenant_id, evaluation_id) REFERENCES standard_evaluation (tenant_id, id) ON DELETE CASCADE
);

CREATE TABLE evaluation_evidence (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenant(id),
    evaluation_item_id UUID NOT NULL,
    evidence_type VARCHAR(24) NOT NULL CHECK (evidence_type IN ('WORK_RECORD', 'ATTACHMENT', 'METRIC', 'TASK_EVIDENCE', 'SNAPSHOT')),
    work_record_id UUID,
    attachment_id UUID,
    metric_observation_id UUID,
    task_evidence_id UUID,
    evidence_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
    content_hash CHAR(64) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, id),
    FOREIGN KEY (tenant_id, evaluation_item_id) REFERENCES standard_evaluation_item (tenant_id, id) ON DELETE CASCADE,
    FOREIGN KEY (tenant_id, work_record_id) REFERENCES work_record (tenant_id, id),
    FOREIGN KEY (tenant_id, attachment_id) REFERENCES attachment (tenant_id, id),
    FOREIGN KEY (tenant_id, metric_observation_id) REFERENCES metric_observation (tenant_id, id),
    FOREIGN KEY (tenant_id, task_evidence_id) REFERENCES task_evidence (tenant_id, id),
    CHECK (num_nonnulls(work_record_id, attachment_id, metric_observation_id, task_evidence_id) <= 1)
);

CREATE TABLE notification (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenant(id),
    recipient_account_id UUID NOT NULL,
    recipient_assignment_id UUID,
    notification_type VARCHAR(40) NOT NULL,
    title VARCHAR(240) NOT NULL,
    content TEXT NOT NULL,
    source_type VARCHAR(40),
    source_id UUID,
    idempotency_key VARCHAR(200) NOT NULL,
    delivered_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    read_at TIMESTAMPTZ,
    row_version BIGINT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, id),
    UNIQUE (tenant_id, recipient_account_id, idempotency_key),
    FOREIGN KEY (tenant_id, recipient_account_id) REFERENCES user_account (tenant_id, id),
    FOREIGN KEY (tenant_id, recipient_assignment_id) REFERENCES employee_position_assignment (tenant_id, id)
);

ALTER TABLE task_transition ADD COLUMN standard_evaluation_id UUID;
ALTER TABLE task_transition ADD CONSTRAINT fk_task_transition_evaluation_same_tenant
    FOREIGN KEY (tenant_id, standard_evaluation_id) REFERENCES standard_evaluation (tenant_id, id);

CREATE INDEX ix_evaluation_subject ON standard_evaluation (tenant_id, subject_type, subject_id, created_at DESC);
CREATE INDEX ix_evaluation_outcome ON standard_evaluation (tenant_id, org_unit_id, outcome, created_at DESC);
CREATE INDEX ix_evaluation_item_result ON standard_evaluation_item (tenant_id, evaluation_id, outcome);
CREATE INDEX ix_notification_inbox ON notification (tenant_id, recipient_account_id, read_at, delivered_at DESC);

CREATE TRIGGER trg_standard_evaluation_updated_at BEFORE UPDATE ON standard_evaluation
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_standard_evaluation_item_updated_at BEFORE UPDATE ON standard_evaluation_item
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

INSERT INTO permission (code, resource, action, description) VALUES
    ('rule.read', 'rule', 'read', '查看授权范围规则'),
    ('rule.manage', 'rule', 'manage', '管理规则草稿'),
    ('rule.simulate', 'rule', 'simulate', '模拟规则且不产生副作用'),
    ('rule.publish', 'rule', 'publish', '发布或停用规则版本'),
    ('task.read', 'task', 'read', '查看授权范围任务'),
    ('task.create', 'task', 'create', '手工创建管理任务'),
    ('task.dispatch', 'task', 'dispatch', '派发管理任务'),
    ('task.act', 'task', 'act', '执行本人任职绑定的任务'),
    ('task.review', 'task', 'review', '验收任务或要求返工'),
    ('task.cancel', 'task', 'cancel', '取消管理任务'),
    ('evaluation.read', 'evaluation', 'read', '查看标准评价'),
    ('evaluation.manual-review', 'evaluation', 'manual-review', '完成人工标准判断'),
    ('notification.read', 'notification', 'read', '查看本人站内通知'),
    ('iam.manage', 'iam', 'manage', '管理租户角色、权限与授权')
ON CONFLICT (code) DO NOTHING;

DO $$
DECLARE
    tenant_record RECORD;
BEGIN
    FOR tenant_record IN SELECT id FROM tenant LOOP
        PERFORM set_config('app.tenant_id', tenant_record.id::text, true);

        INSERT INTO role_permission (tenant_id, role_id, permission_id)
        SELECT tenant_record.id, role.id, permission_item.id
        FROM app_role role
        CROSS JOIN permission permission_item
        WHERE role.tenant_id = tenant_record.id AND role.code = 'CEO'
        ON CONFLICT DO NOTHING;

        INSERT INTO role_permission (tenant_id, role_id, permission_id)
        SELECT tenant_record.id, role.id, permission_item.id
        FROM app_role role
        JOIN permission permission_item ON permission_item.code = ANY (ARRAY[
            'rule.read', 'task.read', 'task.create', 'task.dispatch', 'task.review', 'task.cancel',
            'evaluation.read', 'evaluation.manual-review', 'notification.read'
        ])
        WHERE role.tenant_id = tenant_record.id
          AND role.code = ANY (ARRAY[
            'GENERAL_MANAGER', 'ASSISTANT_GENERAL_MANAGER', 'FRONT_OFFICE_SUPERVISOR',
            'HOUSEKEEPING_SUPERVISOR', 'OTA_OPERATION_MANAGER'
          ])
        ON CONFLICT DO NOTHING;

        INSERT INTO role_permission (tenant_id, role_id, permission_id)
        SELECT tenant_record.id, role.id, permission_item.id
        FROM app_role role
        JOIN permission permission_item ON permission_item.code = ANY (ARRAY[
            'task.read', 'task.act', 'evaluation.read', 'notification.read'
        ])
        WHERE role.tenant_id = tenant_record.id
          AND role.code = ANY (ARRAY['FRONT_DESK', 'OTA_OPERATION_ASSISTANT'])
        ON CONFLICT DO NOTHING;
    END LOOP;
END $$;

DO $$
DECLARE
    table_name TEXT;
BEGIN
    FOREACH table_name IN ARRAY ARRAY[
        'standard_evaluation', 'standard_evaluation_item', 'evaluation_evidence', 'notification'
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
        GRANT SELECT, INSERT, UPDATE, DELETE ON standard_evaluation, standard_evaluation_item,
            evaluation_evidence, notification TO hotel_ai_os_app;
        GRANT SELECT ON permission TO hotel_ai_os_app;
    END IF;
END $$;
