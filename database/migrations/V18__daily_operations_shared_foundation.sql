-- Hotel AI OS daily-operations shared foundation.
-- V1-V17 are immutable. This migration expands existing contracts without
-- replacing the current outbox, management-event, audit or IAM foundations.

CREATE TABLE hotel_business_day_config (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenant(id),
    hotel_org_unit_id UUID NOT NULL,
    timezone VARCHAR(64) NOT NULL DEFAULT 'Asia/Shanghai',
    cutoff_local_time TIME NOT NULL DEFAULT '04:00:00',
    closing_grace_minutes INTEGER NOT NULL DEFAULT 30 CHECK (closing_grace_minutes >= 0),
    status VARCHAR(24) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'INACTIVE')),
    row_version BIGINT NOT NULL DEFAULT 0,
    created_by UUID,
    updated_by UUID,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, id),
    UNIQUE (tenant_id, hotel_org_unit_id),
    FOREIGN KEY (tenant_id, hotel_org_unit_id) REFERENCES org_unit (tenant_id, id),
    FOREIGN KEY (tenant_id, created_by) REFERENCES user_account (tenant_id, id),
    FOREIGN KEY (tenant_id, updated_by) REFERENCES user_account (tenant_id, id)
);

CREATE TABLE closed_loop_trace (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenant(id),
    correlation_id UUID NOT NULL,
    root_resource_type VARCHAR(80),
    root_resource_id UUID,
    org_unit_id UUID,
    hotel_org_unit_id UUID,
    business_date DATE,
    status VARCHAR(24) NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'CLOSED')),
    sensitivity_level VARCHAR(24) NOT NULL DEFAULT 'INTERNAL'
        CHECK (sensitivity_level IN ('PUBLIC', 'INTERNAL', 'SENSITIVE', 'RESTRICTED')),
    started_by_account_id UUID,
    started_by_assignment_id UUID,
    started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    completed_at TIMESTAMPTZ,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    row_version BIGINT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, id),
    CHECK ((root_resource_type IS NULL) = (root_resource_id IS NULL)),
    CHECK (completed_at IS NULL OR completed_at >= started_at),
    CHECK (jsonb_typeof(metadata) = 'object'),
    FOREIGN KEY (tenant_id, org_unit_id) REFERENCES org_unit (tenant_id, id),
    FOREIGN KEY (tenant_id, hotel_org_unit_id) REFERENCES org_unit (tenant_id, id),
    FOREIGN KEY (tenant_id, started_by_account_id) REFERENCES user_account (tenant_id, id),
    FOREIGN KEY (tenant_id, started_by_assignment_id)
        REFERENCES employee_position_assignment (tenant_id, id)
);

CREATE TABLE command_idempotency_record (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenant(id),
    command_scope VARCHAR(120) NOT NULL,
    idempotency_key VARCHAR(200) NOT NULL,
    request_hash CHAR(64) NOT NULL,
    status VARCHAR(24) NOT NULL DEFAULT 'IN_PROGRESS'
        CHECK (status IN ('IN_PROGRESS', 'SUCCEEDED', 'FAILED')),
    resource_type VARCHAR(80),
    resource_id UUID,
    response_status INTEGER CHECK (response_status IS NULL OR response_status BETWEEN 100 AND 599),
    response_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
    last_error TEXT,
    trace_id UUID NOT NULL,
    correlation_id UUID NOT NULL,
    expires_at TIMESTAMPTZ,
    row_version BIGINT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, id),
    UNIQUE (tenant_id, command_scope, idempotency_key),
    CHECK ((resource_type IS NULL) = (resource_id IS NULL)),
    CHECK (jsonb_typeof(response_snapshot) = 'object'),
    CHECK (expires_at IS NULL OR expires_at >= created_at)
);

CREATE INDEX ix_business_day_config_status
    ON hotel_business_day_config (tenant_id, status, hotel_org_unit_id);
CREATE INDEX ix_closed_loop_trace_lookup
    ON closed_loop_trace (tenant_id, hotel_org_unit_id, business_date, created_at DESC);
CREATE INDEX ix_closed_loop_trace_correlation
    ON closed_loop_trace (tenant_id, correlation_id, created_at DESC);
CREATE INDEX ix_command_idempotency_expiry
    ON command_idempotency_record (tenant_id, status, expires_at);
CREATE INDEX ix_command_idempotency_trace
    ON command_idempotency_record (tenant_id, trace_id, created_at DESC);

-- Existing binaries may still insert the V6 outbox shape during an expand-contract
-- deployment. A trigger derives deterministic envelope defaults from the event id.
ALTER TABLE outbox_event
    ADD COLUMN producer VARCHAR(120) NOT NULL DEFAULT 'LEGACY',
    ADD COLUMN trace_id UUID,
    ADD COLUMN correlation_id UUID,
    ADD COLUMN causation_id UUID,
    ADD COLUMN idempotency_key VARCHAR(200),
    ADD COLUMN org_unit_id UUID,
    ADD COLUMN hotel_org_unit_id UUID,
    ADD COLUMN business_date DATE,
    ADD COLUMN actor_account_id UUID,
    ADD COLUMN actor_assignment_id UUID,
    ADD COLUMN sensitivity_level VARCHAR(24) NOT NULL DEFAULT 'INTERNAL';

UPDATE outbox_event
SET trace_id = id,
    correlation_id = id,
    idempotency_key = 'legacy-event:' || id::text
WHERE trace_id IS NULL OR correlation_id IS NULL OR idempotency_key IS NULL;

CREATE OR REPLACE FUNCTION fill_outbox_envelope_defaults() RETURNS trigger AS $$
BEGIN
    NEW.trace_id := coalesce(NEW.trace_id, NEW.id);
    NEW.correlation_id := coalesce(NEW.correlation_id, NEW.trace_id, NEW.id);
    NEW.idempotency_key := coalesce(NEW.idempotency_key, 'event:' || NEW.id::text);
    NEW.producer := coalesce(nullif(trim(NEW.producer), ''), 'LEGACY');
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_outbox_envelope_defaults
    BEFORE INSERT ON outbox_event
    FOR EACH ROW EXECUTE FUNCTION fill_outbox_envelope_defaults();

ALTER TABLE outbox_event
    ALTER COLUMN trace_id SET NOT NULL,
    ALTER COLUMN correlation_id SET NOT NULL,
    ALTER COLUMN idempotency_key SET NOT NULL,
    ADD CONSTRAINT ck_outbox_sensitivity_level CHECK (
        sensitivity_level IN ('PUBLIC', 'INTERNAL', 'SENSITIVE', 'RESTRICTED')
    ),
    ADD CONSTRAINT fk_outbox_org FOREIGN KEY (tenant_id, org_unit_id)
        REFERENCES org_unit (tenant_id, id),
    ADD CONSTRAINT fk_outbox_hotel FOREIGN KEY (tenant_id, hotel_org_unit_id)
        REFERENCES org_unit (tenant_id, id),
    ADD CONSTRAINT fk_outbox_actor_account FOREIGN KEY (tenant_id, actor_account_id)
        REFERENCES user_account (tenant_id, id),
    ADD CONSTRAINT fk_outbox_actor_assignment FOREIGN KEY (tenant_id, actor_assignment_id)
        REFERENCES employee_position_assignment (tenant_id, id);

CREATE UNIQUE INDEX ux_outbox_event_idempotency
    ON outbox_event (tenant_id, idempotency_key);
CREATE INDEX ix_outbox_trace
    ON outbox_event (tenant_id, trace_id, occurred_at);
CREATE INDEX ix_outbox_business_context
    ON outbox_event (tenant_id, hotel_org_unit_id, business_date, occurred_at DESC);

ALTER TABLE management_event
    ADD COLUMN producer VARCHAR(120) NOT NULL DEFAULT 'LEGACY',
    ADD COLUMN trace_id UUID,
    ADD COLUMN correlation_id UUID,
    ADD COLUMN causation_id UUID,
    ADD COLUMN hotel_org_unit_id UUID,
    ADD COLUMN business_date DATE,
    ADD COLUMN sensitivity_level VARCHAR(24) NOT NULL DEFAULT 'INTERNAL';

UPDATE management_event management
SET producer = source.producer,
    trace_id = source.trace_id,
    correlation_id = source.correlation_id,
    causation_id = source.causation_id,
    hotel_org_unit_id = source.hotel_org_unit_id,
    business_date = source.business_date,
    sensitivity_level = source.sensitivity_level
FROM outbox_event source
WHERE source.tenant_id = management.tenant_id
  AND source.id = management.source_event_id;

CREATE OR REPLACE FUNCTION hydrate_management_event_envelope() RETURNS trigger AS $$
DECLARE
    source_event outbox_event%ROWTYPE;
BEGIN
    SELECT * INTO source_event
    FROM outbox_event
    WHERE tenant_id = NEW.tenant_id AND id = NEW.source_event_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'source outbox event does not exist for management event';
    END IF;

    NEW.producer := coalesce(nullif(trim(NEW.producer), ''), source_event.producer);
    IF NEW.producer = 'LEGACY' AND source_event.producer <> 'LEGACY' THEN
        NEW.producer := source_event.producer;
    END IF;
    NEW.trace_id := coalesce(NEW.trace_id, source_event.trace_id);
    NEW.correlation_id := coalesce(NEW.correlation_id, source_event.correlation_id);
    NEW.causation_id := coalesce(NEW.causation_id, source_event.causation_id);
    NEW.hotel_org_unit_id := coalesce(NEW.hotel_org_unit_id, source_event.hotel_org_unit_id);
    NEW.business_date := coalesce(NEW.business_date, source_event.business_date);
    IF NEW.sensitivity_level IS NULL
       OR (NEW.sensitivity_level = 'INTERNAL' AND source_event.sensitivity_level <> 'INTERNAL') THEN
        NEW.sensitivity_level := source_event.sensitivity_level;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_management_event_envelope
    BEFORE INSERT ON management_event
    FOR EACH ROW EXECUTE FUNCTION hydrate_management_event_envelope();

ALTER TABLE management_event
    ALTER COLUMN trace_id SET NOT NULL,
    ALTER COLUMN correlation_id SET NOT NULL,
    ADD CONSTRAINT ck_management_event_sensitivity CHECK (
        sensitivity_level IN ('PUBLIC', 'INTERNAL', 'SENSITIVE', 'RESTRICTED')
    ),
    ADD CONSTRAINT fk_management_event_hotel FOREIGN KEY (tenant_id, hotel_org_unit_id)
        REFERENCES org_unit (tenant_id, id);

CREATE INDEX ix_management_event_trace
    ON management_event (tenant_id, trace_id, occurred_at);
CREATE INDEX ix_management_event_business_context
    ON management_event (tenant_id, hotel_org_unit_id, business_date, event_type, occurred_at DESC);

ALTER TABLE audit_log
    ADD COLUMN event_category VARCHAR(40) NOT NULL DEFAULT 'BUSINESS',
    ADD COLUMN org_unit_id UUID,
    ADD COLUMN hotel_org_unit_id UUID,
    ADD COLUMN actor_assignment_id UUID,
    ADD COLUMN trace_id UUID,
    ADD COLUMN outcome VARCHAR(24) NOT NULL DEFAULT 'SUCCESS',
    ADD COLUMN reason TEXT,
    ADD COLUMN sensitivity_level VARCHAR(24) NOT NULL DEFAULT 'INTERNAL',
    ADD COLUMN metadata JSONB NOT NULL DEFAULT '{}'::jsonb;

UPDATE audit_log SET trace_id = correlation_id WHERE trace_id IS NULL;

CREATE OR REPLACE FUNCTION fill_audit_trace_default() RETURNS trigger AS $$
BEGIN
    NEW.trace_id := coalesce(NEW.trace_id, NEW.correlation_id, NEW.id);
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_audit_trace_default
    BEFORE INSERT ON audit_log
    FOR EACH ROW EXECUTE FUNCTION fill_audit_trace_default();

ALTER TABLE audit_log
    ALTER COLUMN trace_id SET NOT NULL,
    ADD CONSTRAINT ck_audit_event_category CHECK (
        event_category IN ('SECURITY', 'BUSINESS', 'DATA_ACCESS', 'AI', 'EXPORT', 'SYSTEM')
    ),
    ADD CONSTRAINT ck_audit_outcome CHECK (outcome IN ('SUCCESS', 'FAILURE', 'DENIED')),
    ADD CONSTRAINT ck_audit_sensitivity CHECK (
        sensitivity_level IN ('PUBLIC', 'INTERNAL', 'SENSITIVE', 'RESTRICTED')
    ),
    ADD CONSTRAINT ck_audit_metadata_object CHECK (jsonb_typeof(metadata) = 'object'),
    ADD CONSTRAINT fk_audit_org FOREIGN KEY (tenant_id, org_unit_id)
        REFERENCES org_unit (tenant_id, id),
    ADD CONSTRAINT fk_audit_hotel FOREIGN KEY (tenant_id, hotel_org_unit_id)
        REFERENCES org_unit (tenant_id, id),
    ADD CONSTRAINT fk_audit_actor_assignment FOREIGN KEY (tenant_id, actor_assignment_id)
        REFERENCES employee_position_assignment (tenant_id, id);

CREATE INDEX ix_audit_trace ON audit_log (tenant_id, trace_id, created_at DESC);
CREATE INDEX ix_audit_category ON audit_log (tenant_id, event_category, created_at DESC);

CREATE OR REPLACE FUNCTION reject_append_only_mutation() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION '% is append-only; % is not allowed', TG_TABLE_NAME, TG_OP;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_audit_log_append_only
    BEFORE UPDATE OR DELETE ON audit_log
    FOR EACH ROW EXECUTE FUNCTION reject_append_only_mutation();

DO $$
DECLARE
    table_name TEXT;
BEGIN
    FOREACH table_name IN ARRAY ARRAY[
        'hotel_business_day_config', 'closed_loop_trace', 'command_idempotency_record'
    ] LOOP
        EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', table_name);
        EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', table_name);
        EXECUTE format(
            'CREATE POLICY tenant_isolation ON %I USING (tenant_id = nullif(current_setting(''app.tenant_id'', true), '''')::uuid) WITH CHECK (tenant_id = nullif(current_setting(''app.tenant_id'', true), '''')::uuid)',
            table_name
        );
    END LOOP;
END $$;

CREATE TRIGGER trg_hotel_business_day_config_updated_at
    BEFORE UPDATE ON hotel_business_day_config
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_closed_loop_trace_updated_at
    BEFORE UPDATE ON closed_loop_trace
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_command_idempotency_record_updated_at
    BEFORE UPDATE ON command_idempotency_record
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

INSERT INTO permission (code, resource, action, description) VALUES
    ('daily-report.read', 'daily_report', 'read', '查看授权范围日报'),
    ('daily-report.submit', 'daily_report', 'submit', '提交本人岗位日报'),
    ('daily-report.team-read', 'daily_report', 'team-read', '查看授权团队日报'),
    ('daily-report.review', 'daily_report', 'review', '复核异常日报'),
    ('daily-report.revision-review', 'daily_report', 'revision-review', '审核日报修订'),
    ('daily-report-template.read', 'daily_report_template', 'read', '查看日报模板'),
    ('daily-report-template.manage', 'daily_report_template', 'manage', '管理日报模板草稿'),
    ('daily-report-template.review', 'daily_report_template', 'review', '审核日报模板'),
    ('daily-report-template.publish', 'daily_report_template', 'publish', '发布或退役日报模板'),
    ('daily-report-template.store-supplement', 'daily_report_template', 'store-supplement', '维护门店补充模块'),
    ('daily-operation.read', 'daily_operation', 'read', '查看授权日运营数据'),
    ('daily-operation.cross-hotel-read', 'daily_operation', 'cross-hotel-read', '查看跨店日运营数据'),
    ('issue.confirm', 'issue', 'confirm', '确认运营异常'),
    ('issue.assign', 'issue', 'assign', '指派异常负责人'),
    ('issue.close', 'issue', 'close', '验收关闭异常'),
    ('issue.reopen', 'issue', 'reopen', '重新打开异常'),
    ('task-candidate.read', 'task_candidate', 'read', '查看任务候选'),
    ('task-candidate.manage', 'task_candidate', 'manage', '编辑任务候选草稿'),
    ('task-candidate.confirm', 'task_candidate', 'confirm', '确认生成正式任务'),
    ('task-candidate.reject', 'task_candidate', 'reject', '驳回任务候选'),
    ('task-candidate.retry', 'task_candidate', 'retry', '重试正式任务同步'),
    ('evidence.sensitive.read', 'evidence', 'sensitive-read', '查看敏感证据'),
    ('operation-snapshot.read', 'operation_snapshot', 'read', '查看日运营快照'),
    ('operation-snapshot.retry', 'operation_snapshot', 'retry', '重试快照生成'),
    ('operation-snapshot.compare', 'operation_snapshot', 'compare', '比较快照版本'),
    ('operation-export.create', 'operation_export', 'create', '创建运营导出任务'),
    ('operation-export.download', 'operation_export', 'download', '下载运营导出文件'),
    ('operation-export.sensitive', 'operation_export', 'sensitive', '导出敏感字段'),
    ('ai-recommendation.read', 'ai_recommendation', 'read', '查看AI建议'),
    ('ai-recommendation.feedback', 'ai_recommendation', 'feedback', '反馈AI建议质量'),
    ('ai-recommendation.adopt', 'ai_recommendation', 'adopt', '采纳AI建议为草稿'),
    ('audit.cross-org-read', 'audit', 'cross-org-read', '跨组织查看审计记录')
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
        WHERE role.tenant_id = tenant_record.id
          AND role.code = 'CEO'
          AND (
              permission_item.code LIKE 'daily-report.%'
              OR permission_item.code LIKE 'daily-report-template.%'
              OR permission_item.code LIKE 'daily-operation.%'
              OR permission_item.code LIKE 'issue.%'
              OR permission_item.code LIKE 'task-candidate.%'
              OR permission_item.code LIKE 'evidence.%'
              OR permission_item.code LIKE 'operation-snapshot.%'
              OR permission_item.code LIKE 'operation-export.%'
              OR permission_item.code LIKE 'ai-recommendation.%'
              OR permission_item.code = 'audit.cross-org-read'
          )
        ON CONFLICT DO NOTHING;

        INSERT INTO role_permission (tenant_id, role_id, permission_id)
        SELECT tenant_record.id, role.id, permission_item.id
        FROM app_role role
        JOIN permission permission_item ON permission_item.code = ANY (ARRAY[
            'daily-report.read', 'daily-report.submit', 'daily-report-template.read',
            'daily-operation.read', 'task-candidate.read', 'ai-recommendation.read',
            'ai-recommendation.feedback'
        ])
        WHERE role.tenant_id = tenant_record.id
          AND role.code IN ('FRONT_DESK', 'OTA_OPERATION_ASSISTANT')
        ON CONFLICT DO NOTHING;

        INSERT INTO role_permission (tenant_id, role_id, permission_id)
        SELECT tenant_record.id, role.id, permission_item.id
        FROM app_role role
        JOIN permission permission_item ON permission_item.code = ANY (ARRAY[
            'daily-report.read', 'daily-report.submit', 'daily-report.team-read',
            'daily-report.review', 'daily-report.revision-review',
            'daily-report-template.read', 'daily-report-template.store-supplement',
            'daily-operation.read', 'issue.confirm', 'issue.assign', 'issue.close',
            'issue.reopen', 'task-candidate.read', 'task-candidate.manage',
            'task-candidate.confirm', 'task-candidate.reject', 'task-candidate.retry',
            'operation-snapshot.read', 'operation-snapshot.retry',
            'operation-snapshot.compare', 'operation-export.create',
            'operation-export.download', 'ai-recommendation.read',
            'ai-recommendation.feedback', 'ai-recommendation.adopt'
        ])
        WHERE role.tenant_id = tenant_record.id
          AND role.code IN (
              'HOUSEKEEPING_SUPERVISOR', 'FRONT_OFFICE_SUPERVISOR',
              'ASSISTANT_GENERAL_MANAGER', 'GENERAL_MANAGER', 'OTA_OPERATION_MANAGER'
          )
        ON CONFLICT DO NOTHING;
    END LOOP;
END $$;

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'hotel_ai_os_app') THEN
        GRANT SELECT, INSERT, UPDATE, DELETE ON
            hotel_business_day_config, closed_loop_trace, command_idempotency_record
        TO hotel_ai_os_app;
        REVOKE UPDATE, DELETE ON audit_log FROM hotel_ai_os_app;
    END IF;
END $$;
