-- Sprint 2 P0 hardening: canonical event names and immutable published rule evidence.

UPDATE outbox_event SET event_type = upper(trim(event_type));
UPDATE management_event SET event_type = upper(trim(event_type));
UPDATE rule_definition SET event_type = upper(trim(event_type));

CREATE OR REPLACE FUNCTION normalize_event_type_name() RETURNS trigger AS $$
BEGIN
    NEW.event_type := upper(trim(NEW.event_type));
    IF NEW.event_type = '' THEN
        RAISE EXCEPTION 'event_type must not be blank';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_outbox_event_type_normalized
    BEFORE INSERT OR UPDATE OF event_type ON outbox_event
    FOR EACH ROW EXECUTE FUNCTION normalize_event_type_name();
CREATE TRIGGER trg_management_event_type_normalized
    BEFORE INSERT OR UPDATE OF event_type ON management_event
    FOR EACH ROW EXECUTE FUNCTION normalize_event_type_name();
CREATE TRIGGER trg_rule_definition_event_type_normalized
    BEFORE INSERT OR UPDATE OF event_type ON rule_definition
    FOR EACH ROW EXECUTE FUNCTION normalize_event_type_name();

ALTER TABLE outbox_event
    ADD CONSTRAINT ck_outbox_event_type_normalized
        CHECK (event_type = upper(trim(event_type)) AND event_type <> '');
ALTER TABLE management_event
    ADD CONSTRAINT ck_management_event_type_normalized
        CHECK (event_type = upper(trim(event_type)) AND event_type <> '');
ALTER TABLE rule_definition
    ADD CONSTRAINT ck_rule_definition_event_type_normalized
        CHECK (event_type = upper(trim(event_type)) AND event_type <> '');

DROP TRIGGER IF EXISTS trg_rule_version_immutable ON rule_version;

CREATE OR REPLACE FUNCTION protect_published_rule_version() RETURNS trigger AS $$
BEGIN
    IF TG_OP = 'DELETE' AND OLD.lifecycle_status IN ('PUBLISHED', 'DISABLED', 'RETIRED') THEN
        RAISE EXCEPTION 'published, disabled or retired rule versions are immutable';
    END IF;

    IF TG_OP = 'UPDATE' AND OLD.lifecycle_status IN ('PUBLISHED', 'DISABLED', 'RETIRED') THEN
        IF OLD.lifecycle_status = 'PUBLISHED'
           AND NEW.lifecycle_status = 'DISABLED'
           AND (to_jsonb(NEW) - ARRAY['lifecycle_status', 'effective_to', 'row_version', 'updated_at'])
               = (to_jsonb(OLD) - ARRAY['lifecycle_status', 'effective_to', 'row_version', 'updated_at']) THEN
            RETURN NEW;
        END IF;
        RAISE EXCEPTION 'published, disabled or retired rule versions are immutable';
    END IF;

    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_rule_version_immutable
    BEFORE UPDATE OR DELETE ON rule_version
    FOR EACH ROW EXECUTE FUNCTION protect_published_rule_version();

CREATE OR REPLACE FUNCTION protect_published_rule_scope() RETURNS trigger AS $$
DECLARE
    old_status VARCHAR(24);
    new_status VARCHAR(24);
BEGIN
    IF TG_OP IN ('UPDATE', 'DELETE') THEN
        SELECT lifecycle_status INTO old_status
        FROM rule_version
        WHERE tenant_id = OLD.tenant_id AND id = OLD.rule_version_id;
        IF old_status IS DISTINCT FROM 'DRAFT' THEN
            RAISE EXCEPTION 'scope of a published, disabled or retired rule version is immutable';
        END IF;
    END IF;

    IF TG_OP IN ('INSERT', 'UPDATE') THEN
        SELECT lifecycle_status INTO new_status
        FROM rule_version
        WHERE tenant_id = NEW.tenant_id AND id = NEW.rule_version_id;
        IF new_status IS DISTINCT FROM 'DRAFT' THEN
            RAISE EXCEPTION 'scope of a published, disabled or retired rule version is immutable';
        END IF;
    END IF;

    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_rule_scope_draft_only
    BEFORE INSERT OR UPDATE OR DELETE ON rule_scope
    FOR EACH ROW EXECUTE FUNCTION protect_published_rule_scope();

-- V5 compatibility repair: these relation tables have created_at only.
DROP TRIGGER IF EXISTS trg_work_package_scope_updated_at ON work_package_scope;
DROP TRIGGER IF EXISTS trg_work_package_item_standard_updated_at ON work_package_item_standard;
DROP TRIGGER IF EXISTS trg_work_package_item_responsibility_updated_at ON work_package_item_responsibility;

-- Validate both sides of an UPDATE so a child cannot be moved out of a frozen parent.
CREATE OR REPLACE FUNCTION require_draft_work_package_child() RETURNS trigger AS $$
DECLARE
    old_version UUID;
    new_version UUID;
    old_status VARCHAR(24);
    new_status VARCHAR(24);
BEGIN
    IF TG_OP IN ('UPDATE', 'DELETE') THEN
        IF TG_TABLE_NAME IN ('work_package_scope', 'work_package_item') THEN
            old_version := OLD.work_package_version_id;
        ELSE
            SELECT i.work_package_version_id INTO old_version
            FROM work_package_item i
            WHERE i.tenant_id = OLD.tenant_id AND i.id = OLD.work_package_item_id;
        END IF;
        SELECT lifecycle_status INTO old_status
        FROM work_package_version
        WHERE tenant_id = OLD.tenant_id AND id = old_version;
        IF old_status IS DISTINCT FROM 'DRAFT' THEN
            RAISE EXCEPTION 'only draft work package versions may change';
        END IF;
    END IF;

    IF TG_OP IN ('INSERT', 'UPDATE') THEN
        IF TG_TABLE_NAME IN ('work_package_scope', 'work_package_item') THEN
            new_version := NEW.work_package_version_id;
        ELSE
            SELECT i.work_package_version_id INTO new_version
            FROM work_package_item i
            WHERE i.tenant_id = NEW.tenant_id AND i.id = NEW.work_package_item_id;
        END IF;
        SELECT lifecycle_status INTO new_status
        FROM work_package_version
        WHERE tenant_id = NEW.tenant_id AND id = new_version;
        IF new_status IS DISTINCT FROM 'DRAFT' THEN
            RAISE EXCEPTION 'only draft work package versions may change';
        END IF;
    END IF;

    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
