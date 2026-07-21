-- Published configuration is evidence. It may be retired, but its facts cannot be rewritten.

CREATE OR REPLACE FUNCTION protect_published_standard_version() RETURNS trigger AS $$
BEGIN
    IF TG_OP = 'DELETE' AND OLD.lifecycle_status IN ('PUBLISHED', 'RETIRED') THEN
        RAISE EXCEPTION 'published or retired standard versions are immutable';
    END IF;
    IF TG_OP = 'UPDATE' AND OLD.lifecycle_status IN ('PUBLISHED', 'RETIRED') THEN
        IF OLD.lifecycle_status = 'PUBLISHED'
           AND NEW.lifecycle_status = 'RETIRED'
           AND (to_jsonb(NEW) - ARRAY['lifecycle_status', 'effective_to'])
               = (to_jsonb(OLD) - ARRAY['lifecycle_status', 'effective_to']) THEN
            RETURN NEW;
        END IF;
        RAISE EXCEPTION 'published or retired standard versions are immutable';
    END IF;
    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_standard_version_immutable
    BEFORE UPDATE OR DELETE ON standard_version
    FOR EACH ROW EXECUTE FUNCTION protect_published_standard_version();

CREATE OR REPLACE FUNCTION protect_published_standard_scope() RETURNS trigger AS $$
DECLARE
    target_tenant UUID;
    target_version UUID;
    version_status VARCHAR(24);
BEGIN
    target_tenant := COALESCE(NEW.tenant_id, OLD.tenant_id);
    target_version := COALESCE(NEW.standard_version_id, OLD.standard_version_id);
    SELECT lifecycle_status INTO version_status
    FROM standard_version
    WHERE tenant_id = target_tenant AND id = target_version;
    IF version_status <> 'DRAFT' THEN
        RAISE EXCEPTION 'scope of a published or retired standard version is immutable';
    END IF;
    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_standard_scope_draft_only
    BEFORE INSERT OR UPDATE OR DELETE ON standard_scope
    FOR EACH ROW EXECUTE FUNCTION protect_published_standard_scope();

CREATE OR REPLACE FUNCTION protect_published_form_version() RETURNS trigger AS $$
BEGIN
    IF TG_OP = 'DELETE' AND OLD.lifecycle_status IN ('PUBLISHED', 'RETIRED') THEN
        RAISE EXCEPTION 'published or retired form versions are immutable';
    END IF;
    IF TG_OP = 'UPDATE' AND OLD.lifecycle_status IN ('PUBLISHED', 'RETIRED') THEN
        IF OLD.lifecycle_status = 'PUBLISHED'
           AND NEW.lifecycle_status = 'RETIRED'
           AND (to_jsonb(NEW) - ARRAY['lifecycle_status'])
               = (to_jsonb(OLD) - ARRAY['lifecycle_status']) THEN
            RETURN NEW;
        END IF;
        RAISE EXCEPTION 'published or retired form versions are immutable';
    END IF;
    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_form_version_immutable
    BEFORE UPDATE OR DELETE ON form_version
    FOR EACH ROW EXECUTE FUNCTION protect_published_form_version();
