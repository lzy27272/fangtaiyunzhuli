\set ON_ERROR_STOP on

-- Hotel AI OS Pilot UAT data cleanup.
--
-- This script is intentionally not a Flyway migration. Run it only through
-- tools/pilot/Invoke-PilotUatDataCleanup.ps1. The wrapper defaults to dry-run,
-- requires a verified logical-backup manifest for execute mode, and supplies
-- both psql variables below.

\if :{?cleanup_execute}
\else
\set cleanup_execute false
\endif

\if :{?cleanup_confirmation}
\else
\set cleanup_confirmation ''
\endif

BEGIN;
SET TRANSACTION ISOLATION LEVEL SERIALIZABLE;
SET LOCAL lock_timeout = '15s';
SET LOCAL statement_timeout = '10min';

SELECT set_config('maintenance.cleanup_execute', :'cleanup_execute', true);
SELECT set_config('maintenance.cleanup_confirmation', :'cleanup_confirmation', true);

DO $$
DECLARE
    schema_version INTEGER;
    execute_mode TEXT := current_setting('maintenance.cleanup_execute');
BEGIN
    IF execute_mode NOT IN ('true', 'false') THEN
        RAISE EXCEPTION 'cleanup_execute must be true or false';
    END IF;
    IF execute_mode = 'true'
       AND current_setting('maintenance.cleanup_confirmation') <> 'DELETE-PILOT-UAT-ONLY' THEN
        RAISE EXCEPTION 'execute mode requires the exact confirmation DELETE-PILOT-UAT-ONLY';
    END IF;

    SELECT max(version::integer) INTO schema_version
    FROM flyway_schema_history
    WHERE success AND version ~ '^[0-9]+$';
    IF schema_version IS NULL OR schema_version < 16 THEN
        RAISE EXCEPTION 'Pilot cleanup requires Flyway V16 or later; found %', schema_version;
    END IF;
END $$;

-- Serialize cleanup with every other invocation and expose only the primary
-- tenant while candidate sets are built. FORCE RLS remains in effect.
SELECT pg_advisory_xact_lock(hashtextextended('hotel-ai-os-pilot-uat-cleanup', 0));
SELECT set_config('app.tenant_id', '10000000-0000-0000-0000-000000000001', true);

CREATE TEMP TABLE tmp_cleanup_org (id UUID PRIMARY KEY) ON COMMIT DROP;
CREATE TEMP TABLE tmp_cleanup_position (id UUID PRIMARY KEY) ON COMMIT DROP;
CREATE TEMP TABLE tmp_cleanup_role (id UUID PRIMARY KEY) ON COMMIT DROP;
CREATE TEMP TABLE tmp_cleanup_account (id UUID PRIMARY KEY) ON COMMIT DROP;
CREATE TEMP TABLE tmp_cleanup_employee (id UUID PRIMARY KEY) ON COMMIT DROP;
CREATE TEMP TABLE tmp_cleanup_assignment (id UUID PRIMARY KEY) ON COMMIT DROP;
CREATE TEMP TABLE tmp_cleanup_standard_definition (id UUID PRIMARY KEY) ON COMMIT DROP;
CREATE TEMP TABLE tmp_cleanup_standard_version (id UUID PRIMARY KEY) ON COMMIT DROP;
CREATE TEMP TABLE tmp_cleanup_form_definition (id UUID PRIMARY KEY) ON COMMIT DROP;
CREATE TEMP TABLE tmp_cleanup_form_version (id UUID PRIMARY KEY) ON COMMIT DROP;
CREATE TEMP TABLE tmp_cleanup_package_definition (id UUID PRIMARY KEY) ON COMMIT DROP;
CREATE TEMP TABLE tmp_cleanup_package_version (id UUID PRIMARY KEY) ON COMMIT DROP;
CREATE TEMP TABLE tmp_cleanup_package_item (id UUID PRIMARY KEY) ON COMMIT DROP;
CREATE TEMP TABLE tmp_cleanup_allocation (id UUID PRIMARY KEY) ON COMMIT DROP;
CREATE TEMP TABLE tmp_cleanup_duty_period (id UUID PRIMARY KEY) ON COMMIT DROP;
CREATE TEMP TABLE tmp_cleanup_expectation (id UUID PRIMARY KEY) ON COMMIT DROP;
CREATE TEMP TABLE tmp_cleanup_work_record (id UUID PRIMARY KEY) ON COMMIT DROP;
CREATE TEMP TABLE tmp_cleanup_metric_observation (id UUID PRIMARY KEY) ON COMMIT DROP;
CREATE TEMP TABLE tmp_cleanup_rule_definition (id UUID PRIMARY KEY) ON COMMIT DROP;
CREATE TEMP TABLE tmp_cleanup_rule_version (id UUID PRIMARY KEY) ON COMMIT DROP;
CREATE TEMP TABLE tmp_cleanup_outbox (id UUID PRIMARY KEY) ON COMMIT DROP;
CREATE TEMP TABLE tmp_cleanup_event (id UUID PRIMARY KEY) ON COMMIT DROP;
CREATE TEMP TABLE tmp_cleanup_rule_evaluation (id UUID PRIMARY KEY) ON COMMIT DROP;
CREATE TEMP TABLE tmp_cleanup_rule_action (id UUID PRIMARY KEY) ON COMMIT DROP;
CREATE TEMP TABLE tmp_cleanup_task (id UUID PRIMARY KEY) ON COMMIT DROP;
CREATE TEMP TABLE tmp_cleanup_standard_evaluation (id UUID PRIMARY KEY) ON COMMIT DROP;
CREATE TEMP TABLE tmp_cleanup_notification (id UUID PRIMARY KEY) ON COMMIT DROP;
CREATE TEMP TABLE tmp_cleanup_template_definition (id UUID PRIMARY KEY) ON COMMIT DROP;

-- Master-data candidates are restricted to prefixes emitted by the legacy
-- Pilot UAT/UI scripts plus the fixed Sprint 2.1 fixture codes.
INSERT INTO tmp_cleanup_org
SELECT id
FROM org_unit
WHERE tenant_id = '10000000-0000-0000-0000-000000000001'
  AND (
      code LIKE 'UAT-R-%' OR code LIKE 'UAT-H-%' OR code LIKE 'UAT-D-%'
      OR code LIKE 'UI-H-%'
      OR code IN ('SOUTH-REGION-UAT', 'SZ-BAY-UAT', 'SZ-FRONT-UAT')
  );

INSERT INTO tmp_cleanup_position
SELECT id
FROM position_definition
WHERE tenant_id = '10000000-0000-0000-0000-000000000001'
  AND (code LIKE 'UAT-P-%' OR code LIKE 'UI-P-%');

INSERT INTO tmp_cleanup_role
SELECT id
FROM app_role
WHERE tenant_id = '10000000-0000-0000-0000-000000000001'
  AND (code LIKE 'UAT-%' OR code LIKE 'UI-%');

INSERT INTO tmp_cleanup_account
SELECT id
FROM user_account
WHERE tenant_id = '10000000-0000-0000-0000-000000000001'
  AND (login_name LIKE 'uat.front.%' OR login_name LIKE 'ui.%');

INSERT INTO tmp_cleanup_employee
SELECT employee.id
FROM employee
LEFT JOIN tmp_cleanup_account account ON account.id = employee.account_id
WHERE employee.tenant_id = '10000000-0000-0000-0000-000000000001'
  AND (employee.employee_no LIKE 'UAT-E-%' OR employee.employee_no LIKE 'UI-E-%' OR account.id IS NOT NULL);

INSERT INTO tmp_cleanup_account
SELECT employee.account_id
FROM employee
JOIN tmp_cleanup_employee selected ON selected.id = employee.id
WHERE employee.account_id IS NOT NULL
ON CONFLICT DO NOTHING;

INSERT INTO tmp_cleanup_assignment
SELECT assignment.id
FROM employee_position_assignment assignment
WHERE assignment.tenant_id = '10000000-0000-0000-0000-000000000001'
  AND (
      EXISTS (SELECT 1 FROM tmp_cleanup_employee selected WHERE selected.id = assignment.employee_id)
      OR EXISTS (SELECT 1 FROM tmp_cleanup_org selected WHERE selected.id = assignment.org_unit_id)
      OR EXISTS (SELECT 1 FROM tmp_cleanup_position selected WHERE selected.id = assignment.position_id)
  );

-- Standards/forms/packages/rules that either carry an explicit test code or
-- depend on selected test master data are part of the same cleanup boundary.
INSERT INTO tmp_cleanup_standard_definition
SELECT definition.id
FROM standard_definition definition
WHERE definition.tenant_id = '10000000-0000-0000-0000-000000000001'
  AND (
      definition.code LIKE 'STD-UAT-%' OR definition.code LIKE 'STD-UI-%'
      OR EXISTS (SELECT 1 FROM tmp_cleanup_org selected WHERE selected.id = definition.owner_org_unit_id)
      OR EXISTS (SELECT 1 FROM tmp_cleanup_account selected WHERE selected.id = definition.created_by)
  );

INSERT INTO tmp_cleanup_standard_definition
SELECT version.standard_id
FROM standard_version version
JOIN standard_scope scope
  ON scope.tenant_id = version.tenant_id AND scope.standard_version_id = version.id
WHERE version.tenant_id = '10000000-0000-0000-0000-000000000001'
  AND (
      EXISTS (SELECT 1 FROM tmp_cleanup_org selected WHERE selected.id = scope.org_unit_id)
      OR EXISTS (SELECT 1 FROM tmp_cleanup_position selected WHERE selected.id = scope.position_id)
      OR EXISTS (SELECT 1 FROM tmp_cleanup_account selected WHERE selected.id IN (version.created_by, version.published_by))
  )
ON CONFLICT DO NOTHING;

INSERT INTO tmp_cleanup_standard_version
SELECT version.id
FROM standard_version version
JOIN tmp_cleanup_standard_definition definition ON definition.id = version.standard_id
WHERE version.tenant_id = '10000000-0000-0000-0000-000000000001';

INSERT INTO tmp_cleanup_form_definition
SELECT definition.id
FROM form_definition definition
WHERE definition.tenant_id = '10000000-0000-0000-0000-000000000001'
  AND (
      definition.code LIKE 'UAT-%' OR definition.code LIKE 'UI-%'
      OR EXISTS (SELECT 1 FROM tmp_cleanup_position selected WHERE selected.id = definition.position_id)
  );

INSERT INTO tmp_cleanup_form_version
SELECT version.id
FROM form_version version
JOIN tmp_cleanup_form_definition definition ON definition.id = version.form_id
WHERE version.tenant_id = '10000000-0000-0000-0000-000000000001';

INSERT INTO tmp_cleanup_package_definition
SELECT definition.id
FROM work_package_definition definition
WHERE definition.tenant_id = '10000000-0000-0000-0000-000000000001'
  AND (
      definition.code LIKE 'UAT-WP-%' OR definition.code LIKE 'UI-WP-%' OR definition.code LIKE 'WP-UAT-%'
      OR EXISTS (SELECT 1 FROM tmp_cleanup_position selected WHERE selected.id = definition.position_id)
      OR EXISTS (SELECT 1 FROM tmp_cleanup_org selected WHERE selected.id = definition.owner_org_unit_id)
      OR EXISTS (SELECT 1 FROM tmp_cleanup_account selected WHERE selected.id = definition.created_by)
  );

INSERT INTO tmp_cleanup_package_definition
SELECT version.work_package_definition_id
FROM work_package_version version
JOIN work_package_scope scope
  ON scope.tenant_id = version.tenant_id AND scope.work_package_version_id = version.id
WHERE version.tenant_id = '10000000-0000-0000-0000-000000000001'
  AND (
      EXISTS (SELECT 1 FROM tmp_cleanup_org selected WHERE selected.id = scope.org_unit_id)
      OR EXISTS (SELECT 1 FROM tmp_cleanup_position selected WHERE selected.id = scope.position_id)
      OR EXISTS (SELECT 1 FROM tmp_cleanup_account selected WHERE selected.id IN (version.created_by, version.published_by))
  )
ON CONFLICT DO NOTHING;

INSERT INTO tmp_cleanup_package_version
SELECT version.id
FROM work_package_version version
JOIN tmp_cleanup_package_definition definition ON definition.id = version.work_package_definition_id
WHERE version.tenant_id = '10000000-0000-0000-0000-000000000001';

INSERT INTO tmp_cleanup_package_item
SELECT item.id
FROM work_package_item item
JOIN tmp_cleanup_package_version version ON version.id = item.work_package_version_id
WHERE item.tenant_id = '10000000-0000-0000-0000-000000000001';

-- Retain every form or standard version referenced by a package that is not
-- itself in the cleanup set. A historical UAT code is not sufficient evidence
-- to delete a dependency that has since been reused by real business data.
DELETE FROM tmp_cleanup_form_version selected
USING work_package_item item,
      work_package_version version,
      work_package_definition definition
WHERE selected.id = item.form_version_id
  AND item.work_package_version_id = version.id
  AND version.work_package_definition_id = definition.id
  AND definition.tenant_id = '10000000-0000-0000-0000-000000000001'
  AND NOT EXISTS (
      SELECT 1 FROM tmp_cleanup_package_definition candidate
      WHERE candidate.id = definition.id
  );

DELETE FROM tmp_cleanup_form_definition selected
WHERE EXISTS (
    SELECT 1
    FROM form_version form,
         work_package_item item,
         work_package_version version,
         work_package_definition definition
    WHERE form.form_id = selected.id
      AND item.form_version_id = form.id
      AND item.work_package_version_id = version.id
      AND version.work_package_definition_id = definition.id
      AND definition.tenant_id = '10000000-0000-0000-0000-000000000001'
      AND NOT EXISTS (
          SELECT 1 FROM tmp_cleanup_package_definition candidate
          WHERE candidate.id = definition.id
      )
);

DELETE FROM tmp_cleanup_standard_version selected
USING work_package_item_standard link,
      work_package_item item,
      work_package_version version,
      work_package_definition definition
WHERE selected.id = link.standard_version_id
  AND link.work_package_item_id = item.id
  AND item.work_package_version_id = version.id
  AND version.work_package_definition_id = definition.id
  AND definition.tenant_id = '10000000-0000-0000-0000-000000000001'
  AND NOT EXISTS (
      SELECT 1 FROM tmp_cleanup_package_definition candidate
      WHERE candidate.id = definition.id
  );

DELETE FROM tmp_cleanup_standard_definition selected
WHERE EXISTS (
    SELECT 1
    FROM standard_version standard,
         work_package_item_standard link,
         work_package_item item,
         work_package_version version,
         work_package_definition definition
    WHERE standard.standard_id = selected.id
      AND link.standard_version_id = standard.id
      AND link.work_package_item_id = item.id
      AND item.work_package_version_id = version.id
      AND version.work_package_definition_id = definition.id
      AND definition.tenant_id = '10000000-0000-0000-0000-000000000001'
      AND NOT EXISTS (
          SELECT 1 FROM tmp_cleanup_package_definition candidate
          WHERE candidate.id = definition.id
      )
);

INSERT INTO tmp_cleanup_rule_definition
SELECT definition.id
FROM rule_definition definition
WHERE definition.tenant_id = '10000000-0000-0000-0000-000000000001'
  AND (
      definition.code LIKE 'RULE-UAT-%' OR definition.code LIKE 'RULE-UI-%'
      OR EXISTS (SELECT 1 FROM tmp_cleanup_org selected WHERE selected.id = definition.owner_org_unit_id)
      OR EXISTS (SELECT 1 FROM tmp_cleanup_account selected WHERE selected.id = definition.created_by)
  );

INSERT INTO tmp_cleanup_rule_definition
SELECT version.rule_id
FROM rule_version version
JOIN rule_scope scope ON scope.tenant_id = version.tenant_id AND scope.rule_version_id = version.id
WHERE version.tenant_id = '10000000-0000-0000-0000-000000000001'
  AND (
      EXISTS (SELECT 1 FROM tmp_cleanup_org selected WHERE selected.id = scope.org_unit_id)
      OR EXISTS (SELECT 1 FROM tmp_cleanup_position selected WHERE selected.id = scope.position_id)
      OR EXISTS (SELECT 1 FROM tmp_cleanup_account selected WHERE selected.id IN (version.created_by, version.published_by))
  )
ON CONFLICT DO NOTHING;

INSERT INTO tmp_cleanup_rule_version
SELECT version.id
FROM rule_version version
JOIN tmp_cleanup_rule_definition definition ON definition.id = version.rule_id
WHERE version.tenant_id = '10000000-0000-0000-0000-000000000001';

INSERT INTO tmp_cleanup_template_definition
SELECT definition.id
FROM enterprise_template_definition definition
WHERE definition.tenant_id = '10000000-0000-0000-0000-000000000001'
  AND (
      definition.code LIKE 'UAT-%' OR definition.code LIKE 'UI-%'
      OR EXISTS (SELECT 1 FROM tmp_cleanup_position selected WHERE selected.id = definition.target_position_id)
      OR EXISTS (SELECT 1 FROM tmp_cleanup_org selected WHERE selected.id = definition.owner_org_unit_id)
      OR EXISTS (SELECT 1 FROM tmp_cleanup_account selected WHERE selected.id = definition.created_by)
  );

-- Work data is selected by either its test package or its test person/scope.
INSERT INTO tmp_cleanup_allocation
SELECT allocation.id
FROM work_package_allocation allocation
WHERE allocation.tenant_id = '10000000-0000-0000-0000-000000000001'
  AND (
      EXISTS (SELECT 1 FROM tmp_cleanup_package_version selected WHERE selected.id = allocation.work_package_version_id)
      OR EXISTS (SELECT 1 FROM tmp_cleanup_assignment selected WHERE selected.id = allocation.position_assignment_id)
      OR EXISTS (SELECT 1 FROM tmp_cleanup_org selected WHERE selected.id = allocation.target_org_unit_id)
      OR EXISTS (SELECT 1 FROM tmp_cleanup_account selected WHERE selected.id = allocation.allocated_by)
  );

INSERT INTO tmp_cleanup_duty_period
SELECT duty.id
FROM work_duty_period duty
WHERE duty.tenant_id = '10000000-0000-0000-0000-000000000001'
  AND (
      EXISTS (SELECT 1 FROM tmp_cleanup_assignment selected WHERE selected.id = duty.position_assignment_id)
      OR EXISTS (SELECT 1 FROM tmp_cleanup_org selected WHERE selected.id = duty.target_org_unit_id)
      OR EXISTS (SELECT 1 FROM tmp_cleanup_account selected WHERE selected.id = duty.created_by)
      OR duty.source_record_id LIKE 'UAT-%' OR duty.source_record_id LIKE 'UI-%'
  );

INSERT INTO tmp_cleanup_expectation
SELECT expectation.id
FROM work_expectation expectation
WHERE expectation.tenant_id = '10000000-0000-0000-0000-000000000001'
  AND (
      EXISTS (SELECT 1 FROM tmp_cleanup_package_item selected WHERE selected.id = expectation.work_package_item_id)
      OR EXISTS (SELECT 1 FROM tmp_cleanup_allocation selected WHERE selected.id = expectation.work_package_allocation_id)
      OR EXISTS (SELECT 1 FROM tmp_cleanup_assignment selected WHERE selected.id = expectation.position_assignment_id)
      OR EXISTS (SELECT 1 FROM tmp_cleanup_duty_period selected WHERE selected.id = expectation.duty_period_id)
      OR EXISTS (SELECT 1 FROM tmp_cleanup_org selected WHERE selected.id = expectation.target_org_unit_id)
      OR EXISTS (SELECT 1 FROM tmp_cleanup_account selected WHERE selected.id IN (expectation.waived_by_account_id, expectation.cancelled_by_account_id))
      OR expectation.period_key LIKE 'UAT-%' OR expectation.period_key LIKE 'UI-%'
  );

WITH RECURSIVE selected_record AS (
    SELECT record.id
    FROM work_record record
    WHERE record.tenant_id = '10000000-0000-0000-0000-000000000001'
      AND (
          record.id = '2e000000-0000-0000-0000-000000000001'
          OR EXISTS (SELECT 1 FROM tmp_cleanup_package_version selected WHERE selected.id = record.work_package_version_id)
          OR EXISTS (SELECT 1 FROM tmp_cleanup_package_item selected WHERE selected.id = record.work_package_item_id)
          OR EXISTS (SELECT 1 FROM tmp_cleanup_expectation selected WHERE selected.id = record.work_expectation_id)
          OR EXISTS (SELECT 1 FROM tmp_cleanup_assignment selected WHERE selected.id = record.position_assignment_id)
          OR EXISTS (SELECT 1 FROM tmp_cleanup_org selected WHERE selected.id IN (record.org_unit_id, record.target_org_unit_id))
          OR EXISTS (SELECT 1 FROM tmp_cleanup_employee selected WHERE selected.id = record.employee_id)
          OR EXISTS (SELECT 1 FROM tmp_cleanup_form_version selected WHERE selected.id = record.form_version_id)
          OR EXISTS (SELECT 1 FROM tmp_cleanup_account selected WHERE selected.id IN (record.submitted_by_account_id, record.reviewed_by_account_id))
      )
    UNION
    SELECT child.id
    FROM work_record child
    JOIN selected_record parent ON parent.id = child.supersedes_work_record_id
    WHERE child.tenant_id = '10000000-0000-0000-0000-000000000001'
)
INSERT INTO tmp_cleanup_work_record SELECT id FROM selected_record;

INSERT INTO tmp_cleanup_metric_observation
SELECT observation.id
FROM metric_observation observation
WHERE observation.tenant_id = '10000000-0000-0000-0000-000000000001'
  AND (
      EXISTS (SELECT 1 FROM tmp_cleanup_org selected WHERE selected.id = observation.hotel_org_unit_id)
      OR EXISTS (SELECT 1 FROM tmp_cleanup_account selected WHERE selected.id = observation.entered_by)
      OR observation.source_record_id LIKE 'UAT-%' OR observation.source_record_id LIKE 'UI-%'
  );

-- Events, rule executions, tasks and evaluations are expanded from selected
-- business facts. This captures asynchronous rows created after fixture load.
INSERT INTO tmp_cleanup_outbox
SELECT event.id
FROM outbox_event event
WHERE event.tenant_id = '10000000-0000-0000-0000-000000000001'
  AND (
      event.id = '2c000000-0000-0000-0000-000000000001'
      OR event.aggregate_type LIKE 'UAT_%' OR event.aggregate_type LIKE 'UI_%'
      OR event.payload ->> 'source' IN ('UAT_FIXTURE', 'PILOT_UAT', 'UI_UAT')
      OR EXISTS (SELECT 1 FROM tmp_cleanup_work_record selected WHERE selected.id = event.aggregate_id)
      OR EXISTS (SELECT 1 FROM tmp_cleanup_expectation selected WHERE selected.id = event.aggregate_id)
      OR EXISTS (SELECT 1 FROM tmp_cleanup_package_version selected WHERE selected.id = event.aggregate_id)
  );

INSERT INTO tmp_cleanup_event
SELECT event.id
FROM management_event event
WHERE event.tenant_id = '10000000-0000-0000-0000-000000000001'
  AND (
      EXISTS (SELECT 1 FROM tmp_cleanup_outbox selected WHERE selected.id = event.source_event_id)
      OR EXISTS (SELECT 1 FROM tmp_cleanup_org selected WHERE selected.id = event.org_unit_id)
      OR EXISTS (SELECT 1 FROM tmp_cleanup_assignment selected WHERE selected.id = event.position_assignment_id)
      OR event.payload_snapshot ->> 'source' IN ('UAT_FIXTURE', 'PILOT_UAT', 'UI_UAT')
      OR event.payload_snapshot ->> 'workRecordId' IN (SELECT id::text FROM tmp_cleanup_work_record)
      OR event.payload_snapshot ->> 'workExpectationId' IN (SELECT id::text FROM tmp_cleanup_expectation)
  );

INSERT INTO tmp_cleanup_rule_evaluation
SELECT evaluation.id
FROM rule_evaluation evaluation
WHERE evaluation.tenant_id = '10000000-0000-0000-0000-000000000001'
  AND (
      EXISTS (SELECT 1 FROM tmp_cleanup_rule_version selected WHERE selected.id = evaluation.rule_version_id)
      OR EXISTS (SELECT 1 FROM tmp_cleanup_event selected WHERE selected.id = evaluation.management_event_id)
  );

INSERT INTO tmp_cleanup_event
SELECT evaluation.management_event_id
FROM rule_evaluation evaluation
JOIN tmp_cleanup_rule_evaluation selected ON selected.id = evaluation.id
ON CONFLICT DO NOTHING;

INSERT INTO tmp_cleanup_rule_action
SELECT action.id
FROM rule_action_execution action
WHERE action.tenant_id = '10000000-0000-0000-0000-000000000001'
  AND (
      EXISTS (SELECT 1 FROM tmp_cleanup_rule_evaluation selected WHERE selected.id = action.rule_evaluation_id)
      OR EXISTS (SELECT 1 FROM tmp_cleanup_event selected WHERE selected.id = action.management_event_id)
      OR EXISTS (SELECT 1 FROM tmp_cleanup_rule_version selected WHERE selected.id = action.rule_version_id)
      OR action.idempotency_key LIKE 'uat-%' OR action.idempotency_key LIKE 'ui-%'
  );

INSERT INTO tmp_cleanup_task
SELECT task.id
FROM management_task task
WHERE task.tenant_id = '10000000-0000-0000-0000-000000000001'
  AND (
      EXISTS (SELECT 1 FROM tmp_cleanup_event selected WHERE selected.id = task.source_event_id)
      OR EXISTS (SELECT 1 FROM tmp_cleanup_rule_action selected WHERE selected.id = task.source_action_id)
      OR EXISTS (SELECT 1 FROM tmp_cleanup_work_record selected WHERE selected.id = task.work_record_id)
      OR EXISTS (SELECT 1 FROM tmp_cleanup_standard_version selected WHERE selected.id = task.standard_version_id)
      OR EXISTS (SELECT 1 FROM tmp_cleanup_org selected WHERE selected.id = task.org_unit_id)
      OR EXISTS (SELECT 1 FROM tmp_cleanup_account selected WHERE selected.id = task.created_by)
      OR task.task_no LIKE 'UAT-%' OR task.idempotency_key LIKE 'uat-%' OR task.idempotency_key LIKE 'ui-%'
      OR EXISTS (
          SELECT 1
          FROM rule_action_execution action
          JOIN tmp_cleanup_rule_action selected_action ON selected_action.id = action.id
          WHERE action.target_id = task.id
      )
      OR EXISTS (
          SELECT 1 FROM task_participant participant
          JOIN tmp_cleanup_assignment selected ON selected.id = participant.position_assignment_id
          WHERE participant.tenant_id = task.tenant_id AND participant.task_id = task.id
      )
      OR EXISTS (
          SELECT 1 FROM task_transition transition
          WHERE transition.tenant_id = task.tenant_id AND transition.task_id = task.id
            AND (
                EXISTS (SELECT 1 FROM tmp_cleanup_assignment selected WHERE selected.id = transition.actor_assignment_id)
                OR EXISTS (SELECT 1 FROM tmp_cleanup_account selected WHERE selected.id = transition.actor_account_id)
            )
      )
      OR EXISTS (
          SELECT 1 FROM task_evidence evidence
          JOIN tmp_cleanup_assignment selected ON selected.id = evidence.submitted_by_assignment_id
          WHERE evidence.tenant_id = task.tenant_id AND evidence.task_id = task.id
      )
      OR EXISTS (
          SELECT 1 FROM task_escalation escalation
          JOIN tmp_cleanup_assignment selected ON selected.id = escalation.resolved_assignment_id
          WHERE escalation.tenant_id = task.tenant_id AND escalation.task_id = task.id
      )
  );

-- A task may have been selected from its participants even when its originating
-- action/event was not selected in the first pass. Pull that causal chain in.
INSERT INTO tmp_cleanup_rule_action
SELECT task.source_action_id
FROM management_task task
JOIN tmp_cleanup_task selected ON selected.id = task.id
WHERE task.source_action_id IS NOT NULL
ON CONFLICT DO NOTHING;

INSERT INTO tmp_cleanup_rule_evaluation
SELECT action.rule_evaluation_id
FROM rule_action_execution action
JOIN tmp_cleanup_rule_action selected ON selected.id = action.id
ON CONFLICT DO NOTHING;

INSERT INTO tmp_cleanup_event
SELECT source_event_id
FROM management_task task
JOIN tmp_cleanup_task selected ON selected.id = task.id
WHERE source_event_id IS NOT NULL
UNION
SELECT management_event_id
FROM rule_action_execution action
JOIN tmp_cleanup_rule_action selected ON selected.id = action.id
ON CONFLICT DO NOTHING;

INSERT INTO tmp_cleanup_outbox
SELECT event.source_event_id
FROM management_event event
JOIN tmp_cleanup_event selected ON selected.id = event.id
ON CONFLICT DO NOTHING;

INSERT INTO tmp_cleanup_standard_evaluation
SELECT evaluation.id
FROM standard_evaluation evaluation
WHERE evaluation.tenant_id = '10000000-0000-0000-0000-000000000001'
  AND (
      EXISTS (SELECT 1 FROM tmp_cleanup_standard_version selected WHERE selected.id = evaluation.standard_version_id)
      OR EXISTS (SELECT 1 FROM tmp_cleanup_org selected WHERE selected.id = evaluation.org_unit_id)
      OR EXISTS (SELECT 1 FROM tmp_cleanup_assignment selected WHERE selected.id = evaluation.position_assignment_id)
      OR EXISTS (SELECT 1 FROM tmp_cleanup_account selected WHERE selected.id = evaluation.created_by)
      OR (evaluation.subject_type = 'WORK_RECORD' AND EXISTS (SELECT 1 FROM tmp_cleanup_work_record selected WHERE selected.id = evaluation.subject_id))
      OR (evaluation.subject_type = 'TASK' AND EXISTS (SELECT 1 FROM tmp_cleanup_task selected WHERE selected.id = evaluation.subject_id))
  );

INSERT INTO tmp_cleanup_task
SELECT transition.task_id
FROM task_transition transition
JOIN tmp_cleanup_standard_evaluation selected ON selected.id = transition.standard_evaluation_id
ON CONFLICT DO NOTHING;

INSERT INTO tmp_cleanup_notification
SELECT notification.id
FROM notification
WHERE notification.tenant_id = '10000000-0000-0000-0000-000000000001'
  AND (
      notification.source_type = 'UAT'
      OR notification.idempotency_key LIKE 'uat-%' OR notification.idempotency_key LIKE 'ui-%'
      OR EXISTS (SELECT 1 FROM tmp_cleanup_account selected WHERE selected.id = notification.recipient_account_id)
      OR EXISTS (SELECT 1 FROM tmp_cleanup_assignment selected WHERE selected.id = notification.recipient_assignment_id)
      OR EXISTS (SELECT 1 FROM tmp_cleanup_task selected WHERE selected.id = notification.source_id)
      OR EXISTS (SELECT 1 FROM tmp_cleanup_rule_action selected WHERE selected.id = notification.source_id)
      OR EXISTS (SELECT 1 FROM tmp_cleanup_event selected WHERE selected.id = notification.source_id)
      OR EXISTS (SELECT 1 FROM tmp_cleanup_standard_evaluation selected WHERE selected.id = notification.source_id)
      OR EXISTS (SELECT 1 FROM tmp_cleanup_work_record selected WHERE selected.id = notification.source_id)
  );

CREATE FUNCTION pg_temp.assert_protected_pilot_data() RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
    actual INTEGER;
BEGIN
    SELECT count(*) INTO actual
    FROM app_role
    WHERE tenant_id = '10000000-0000-0000-0000-000000000001'
      AND code IN ('CEO', 'GENERAL_MANAGER', 'ASSISTANT_GENERAL_MANAGER', 'FRONT_OFFICE_SUPERVISOR',
                   'HOUSEKEEPING_SUPERVISOR', 'FRONT_DESK', 'OTA_OPERATION_ASSISTANT', 'OTA_OPERATION_MANAGER');
    IF actual <> 8 THEN RAISE EXCEPTION 'protected role invariant failed: expected 8, found %', actual; END IF;

    SELECT count(*) INTO actual
    FROM position_definition
    WHERE tenant_id = '10000000-0000-0000-0000-000000000001'
      AND code IN ('FRONT_DESK', 'HOUSEKEEPING_SUPERVISOR', 'FRONT_OFFICE_SUPERVISOR',
                   'GENERAL_MANAGER', 'ASSISTANT_GENERAL_MANAGER', 'OTA_OPERATION_ASSISTANT', 'OTA_OPERATION_MANAGER');
    IF actual <> 7 THEN RAISE EXCEPTION 'protected position invariant failed: expected 7, found %', actual; END IF;

    SELECT count(*) INTO actual
    FROM org_unit
    WHERE tenant_id = '10000000-0000-0000-0000-000000000001'
      AND code IN ('EAST-REGION', 'HZ-CENTER', 'SH-RIVER', 'HZ-FRONT', 'HZ-HOUSEKEEPING');
    IF actual <> 5 THEN RAISE EXCEPTION 'protected V3 organization invariant failed: expected 5, found %', actual; END IF;

    IF NOT EXISTS (
        SELECT 1 FROM org_unit
        WHERE tenant_id = '10000000-0000-0000-0000-000000000001'
          AND id = '24d7c586-5d89-4bea-be33-3816618f1be1' AND name = '四方馆归来'
    ) THEN RAISE EXCEPTION 'protected real organization 四方馆归来 is missing'; END IF;

    SELECT count(*) INTO actual
    FROM user_account
    WHERE tenant_id = '10000000-0000-0000-0000-000000000001'
      AND login_name IN ('ceo.demo', 'sfgrff', 'sfglzy');
    IF actual <> 3 THEN RAISE EXCEPTION 'protected account invariant failed: expected ceo.demo/sfgrff/sfglzy'; END IF;

    IF NOT EXISTS (
        SELECT 1 FROM work_package_definition
        WHERE tenant_id = '10000000-0000-0000-0000-000000000001' AND code = '123'
    ) THEN RAISE EXCEPTION 'protected work package 123 is missing'; END IF;

    IF EXISTS (
        SELECT 1 FROM tmp_cleanup_position selected
        JOIN position_definition position ON position.id = selected.id
        WHERE position.code IN ('FRONT_DESK', 'HOUSEKEEPING_SUPERVISOR', 'FRONT_OFFICE_SUPERVISOR',
                                'GENERAL_MANAGER', 'ASSISTANT_GENERAL_MANAGER', 'OTA_OPERATION_ASSISTANT', 'OTA_OPERATION_MANAGER')
    ) THEN RAISE EXCEPTION 'candidate selection overlaps a protected position'; END IF;

    IF EXISTS (
        SELECT 1 FROM tmp_cleanup_org selected
        JOIN org_unit organization ON organization.id = selected.id
        WHERE organization.code IN ('EAST-REGION', 'HZ-CENTER', 'SH-RIVER', 'HZ-FRONT', 'HZ-HOUSEKEEPING')
           OR organization.id = '24d7c586-5d89-4bea-be33-3816618f1be1'
    ) THEN RAISE EXCEPTION 'candidate selection overlaps a protected organization'; END IF;

    IF EXISTS (
        SELECT 1 FROM tmp_cleanup_account selected
        JOIN user_account account ON account.id = selected.id
        WHERE account.login_name IN ('ceo.demo', 'sfgrff', 'sfglzy')
    ) THEN RAISE EXCEPTION 'candidate selection overlaps a protected account'; END IF;

    IF EXISTS (
        SELECT 1 FROM tmp_cleanup_package_definition selected
        JOIN work_package_definition package ON package.id = selected.id
        WHERE package.code = '123'
    ) THEN RAISE EXCEPTION 'candidate selection overlaps protected work package 123'; END IF;
END $$;

CREATE FUNCTION pg_temp.assert_cleanup_boundary() RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM org_unit child
        JOIN tmp_cleanup_org parent ON parent.id = child.parent_id
        LEFT JOIN tmp_cleanup_org selected_child ON selected_child.id = child.id
        WHERE child.tenant_id = '10000000-0000-0000-0000-000000000001' AND selected_child.id IS NULL
    ) THEN RAISE EXCEPTION 'cleanup would orphan an unselected child organization'; END IF;

    IF EXISTS (
        SELECT 1 FROM employee_position_assignment assignment
        JOIN tmp_cleanup_assignment manager ON manager.id = assignment.manager_assignment_id
        LEFT JOIN tmp_cleanup_assignment selected ON selected.id = assignment.id
        WHERE assignment.tenant_id = '10000000-0000-0000-0000-000000000001' AND selected.id IS NULL
    ) THEN RAISE EXCEPTION 'cleanup would remove a manager referenced by an unselected assignment'; END IF;

    IF EXISTS (
        SELECT 1 FROM work_package_item item
        JOIN tmp_cleanup_form_version form ON form.id = item.form_version_id
        LEFT JOIN tmp_cleanup_package_item selected ON selected.id = item.id
        WHERE item.tenant_id = '10000000-0000-0000-0000-000000000001' AND selected.id IS NULL
    ) THEN RAISE EXCEPTION 'a non-test work-package item still references a selected UAT form'; END IF;

    IF EXISTS (
        SELECT 1
        FROM work_package_item_standard link
        JOIN tmp_cleanup_standard_version standard ON standard.id = link.standard_version_id
        LEFT JOIN tmp_cleanup_package_item selected ON selected.id = link.work_package_item_id
        WHERE link.tenant_id = '10000000-0000-0000-0000-000000000001'
          AND selected.id IS NULL
    ) THEN RAISE EXCEPTION 'a non-test work-package item still references a selected UAT standard'; END IF;

    IF EXISTS (
        SELECT 1 FROM role_assignment assignment
        JOIN tmp_cleanup_account account ON account.id = assignment.granted_by
        WHERE assignment.tenant_id = '10000000-0000-0000-0000-000000000001'
          AND NOT EXISTS (SELECT 1 FROM tmp_cleanup_account selected WHERE selected.id = assignment.account_id)
          AND NOT EXISTS (SELECT 1 FROM tmp_cleanup_role selected WHERE selected.id = assignment.role_id)
          AND NOT EXISTS (SELECT 1 FROM tmp_cleanup_org selected WHERE selected.id = assignment.scope_org_unit_id)
    ) THEN RAISE EXCEPTION 'a selected test account granted an unselected role assignment; manual review required'; END IF;
END $$;

SELECT pg_temp.assert_protected_pilot_data();
SELECT pg_temp.assert_cleanup_boundary();

\echo '--- Pilot UAT cleanup candidate summary ---'
SELECT category, candidate_count
FROM (
    VALUES
      ('organizations', (SELECT count(*) FROM tmp_cleanup_org)),
      ('positions', (SELECT count(*) FROM tmp_cleanup_position)),
      ('roles', (SELECT count(*) FROM tmp_cleanup_role)),
      ('accounts', (SELECT count(*) FROM tmp_cleanup_account)),
      ('employees', (SELECT count(*) FROM tmp_cleanup_employee)),
      ('assignments', (SELECT count(*) FROM tmp_cleanup_assignment)),
      ('standards', (SELECT count(*) FROM tmp_cleanup_standard_definition)),
      ('forms', (SELECT count(*) FROM tmp_cleanup_form_definition)),
      ('work_packages', (SELECT count(*) FROM tmp_cleanup_package_definition)),
      ('allocations', (SELECT count(*) FROM tmp_cleanup_allocation)),
      ('expectations', (SELECT count(*) FROM tmp_cleanup_expectation)),
      ('work_records', (SELECT count(*) FROM tmp_cleanup_work_record)),
      ('rules', (SELECT count(*) FROM tmp_cleanup_rule_definition)),
      ('management_events', (SELECT count(*) FROM tmp_cleanup_event)),
      ('rule_evaluations', (SELECT count(*) FROM tmp_cleanup_rule_evaluation)),
      ('rule_actions', (SELECT count(*) FROM tmp_cleanup_rule_action)),
      ('tasks', (SELECT count(*) FROM tmp_cleanup_task)),
      ('standard_evaluations', (SELECT count(*) FROM tmp_cleanup_standard_evaluation)),
      ('notifications', (SELECT count(*) FROM tmp_cleanup_notification)),
      ('enterprise_templates', (SELECT count(*) FROM tmp_cleanup_template_definition))
) AS summary(category, candidate_count)
ORDER BY category;

SELECT 'organization' AS object_type, organization.code, organization.name
FROM org_unit organization JOIN tmp_cleanup_org selected ON selected.id = organization.id
UNION ALL
SELECT 'position', position.code, position.name
FROM position_definition position JOIN tmp_cleanup_position selected ON selected.id = position.id
UNION ALL
SELECT 'role', role.code, role.name
FROM app_role role JOIN tmp_cleanup_role selected ON selected.id = role.id
UNION ALL
SELECT 'account', account.login_name, account.display_name
FROM user_account account JOIN tmp_cleanup_account selected ON selected.id = account.id
UNION ALL
SELECT 'work_package', package.code, package.name
FROM work_package_definition package JOIN tmp_cleanup_package_definition selected ON selected.id = package.id
UNION ALL
SELECT 'standard', standard.code, standard.name
FROM standard_definition standard JOIN tmp_cleanup_standard_definition selected ON selected.id = standard.id
UNION ALL
SELECT 'rule', rule.code, rule.name
FROM rule_definition rule JOIN tmp_cleanup_rule_definition selected ON selected.id = rule.id
UNION ALL
SELECT 'enterprise_template', template.code, template.name
FROM enterprise_template_definition template JOIN tmp_cleanup_template_definition selected ON selected.id = template.id
ORDER BY object_type, code;

SELECT set_config('app.tenant_id', '30000000-0000-0000-0000-000000000001', true);
SELECT 'isolation_fixture_tenant' AS object_type, count(*) AS candidate_count
FROM tenant
WHERE id = '30000000-0000-0000-0000-000000000001';
SELECT set_config('app.tenant_id', '10000000-0000-0000-0000-000000000001', true);

\if :cleanup_execute
\echo '--- EXECUTE mode: deleting only the reviewed candidate set ---'

-- Published configuration guards are temporarily disabled by the owner role.
-- The DDL is transactional: any failure rolls the trigger state back as well.
ALTER TABLE work_package_version DISABLE TRIGGER trg_protect_work_package_version;
ALTER TABLE work_package_scope DISABLE TRIGGER trg_work_package_scope_draft_only;
ALTER TABLE work_package_item DISABLE TRIGGER trg_work_package_item_draft_only;
ALTER TABLE work_package_item_standard DISABLE TRIGGER trg_work_package_item_standard_draft_only;
ALTER TABLE work_package_item_responsibility DISABLE TRIGGER trg_work_package_item_responsibility_draft_only;
ALTER TABLE standard_version DISABLE TRIGGER trg_standard_version_immutable;
ALTER TABLE standard_scope DISABLE TRIGGER trg_standard_scope_draft_only;
ALTER TABLE form_version DISABLE TRIGGER trg_form_version_immutable;
ALTER TABLE rule_version DISABLE TRIGGER trg_rule_version_immutable;
ALTER TABLE rule_scope DISABLE TRIGGER trg_rule_scope_draft_only;

DELETE FROM notification WHERE id IN (SELECT id FROM tmp_cleanup_notification);
DELETE FROM task_transition
WHERE task_id IN (SELECT id FROM tmp_cleanup_task)
   OR standard_evaluation_id IN (SELECT id FROM tmp_cleanup_standard_evaluation);
DELETE FROM standard_evaluation WHERE id IN (SELECT id FROM tmp_cleanup_standard_evaluation);
DELETE FROM management_task WHERE id IN (SELECT id FROM tmp_cleanup_task);
DELETE FROM rule_action_execution WHERE id IN (SELECT id FROM tmp_cleanup_rule_action);
DELETE FROM rule_evaluation WHERE id IN (SELECT id FROM tmp_cleanup_rule_evaluation);
DELETE FROM management_event WHERE id IN (SELECT id FROM tmp_cleanup_event);
DELETE FROM event_consumer_inbox WHERE outbox_event_id IN (SELECT id FROM tmp_cleanup_outbox);
DELETE FROM outbox_event WHERE id IN (SELECT id FROM tmp_cleanup_outbox);

DELETE FROM metric_observation WHERE id IN (SELECT id FROM tmp_cleanup_metric_observation);
DELETE FROM work_record_supplement
WHERE work_record_id IN (SELECT id FROM tmp_cleanup_work_record)
   OR submitted_by_assignment_id IN (SELECT id FROM tmp_cleanup_assignment);
DELETE FROM attachment WHERE work_record_id IN (SELECT id FROM tmp_cleanup_work_record);
DELETE FROM work_record WHERE id IN (SELECT id FROM tmp_cleanup_work_record);
DELETE FROM work_expectation WHERE id IN (SELECT id FROM tmp_cleanup_expectation);
DELETE FROM work_duty_period WHERE id IN (SELECT id FROM tmp_cleanup_duty_period);
DELETE FROM work_package_allocation WHERE id IN (SELECT id FROM tmp_cleanup_allocation);

DELETE FROM enterprise_template_definition WHERE id IN (SELECT id FROM tmp_cleanup_template_definition);
DELETE FROM work_package_item_standard
WHERE standard_version_id IN (SELECT id FROM tmp_cleanup_standard_version)
   OR work_package_item_id IN (SELECT id FROM tmp_cleanup_package_item);
DELETE FROM work_package_item_responsibility WHERE work_package_item_id IN (SELECT id FROM tmp_cleanup_package_item);
DELETE FROM work_package_scope WHERE work_package_version_id IN (SELECT id FROM tmp_cleanup_package_version);
DELETE FROM work_package_item WHERE id IN (SELECT id FROM tmp_cleanup_package_item);
DELETE FROM work_package_version WHERE id IN (SELECT id FROM tmp_cleanup_package_version);
DELETE FROM work_package_definition WHERE id IN (SELECT id FROM tmp_cleanup_package_definition);

DELETE FROM standard_scope WHERE standard_version_id IN (SELECT id FROM tmp_cleanup_standard_version);
DELETE FROM standard_version WHERE id IN (SELECT id FROM tmp_cleanup_standard_version);
DELETE FROM standard_definition WHERE id IN (SELECT id FROM tmp_cleanup_standard_definition);
DELETE FROM form_version WHERE id IN (SELECT id FROM tmp_cleanup_form_version);
DELETE FROM form_definition WHERE id IN (SELECT id FROM tmp_cleanup_form_definition);
DELETE FROM rule_scope WHERE rule_version_id IN (SELECT id FROM tmp_cleanup_rule_version);
DELETE FROM rule_version WHERE id IN (SELECT id FROM tmp_cleanup_rule_version);
DELETE FROM rule_definition WHERE id IN (SELECT id FROM tmp_cleanup_rule_definition);

DELETE FROM role_assignment
WHERE account_id IN (SELECT id FROM tmp_cleanup_account)
   OR role_id IN (SELECT id FROM tmp_cleanup_role)
   OR scope_org_unit_id IN (SELECT id FROM tmp_cleanup_org);
DELETE FROM role_permission WHERE role_id IN (SELECT id FROM tmp_cleanup_role);
DELETE FROM employee_position_assignment WHERE id IN (SELECT id FROM tmp_cleanup_assignment);
DELETE FROM employee WHERE id IN (SELECT id FROM tmp_cleanup_employee);
DELETE FROM user_account WHERE id IN (SELECT id FROM tmp_cleanup_account);
DELETE FROM app_role WHERE id IN (SELECT id FROM tmp_cleanup_role);
DELETE FROM hotel_profile WHERE org_unit_id IN (SELECT id FROM tmp_cleanup_org);
DELETE FROM org_unit_closure
WHERE ancestor_id IN (SELECT id FROM tmp_cleanup_org) OR descendant_id IN (SELECT id FROM tmp_cleanup_org);
DELETE FROM org_unit WHERE id IN (SELECT id FROM tmp_cleanup_org);
DELETE FROM position_definition WHERE id IN (SELECT id FROM tmp_cleanup_position);

ALTER TABLE work_package_version ENABLE TRIGGER trg_protect_work_package_version;
ALTER TABLE work_package_scope ENABLE TRIGGER trg_work_package_scope_draft_only;
ALTER TABLE work_package_item ENABLE TRIGGER trg_work_package_item_draft_only;
ALTER TABLE work_package_item_standard ENABLE TRIGGER trg_work_package_item_standard_draft_only;
ALTER TABLE work_package_item_responsibility ENABLE TRIGGER trg_work_package_item_responsibility_draft_only;
ALTER TABLE standard_version ENABLE TRIGGER trg_standard_version_immutable;
ALTER TABLE standard_scope ENABLE TRIGGER trg_standard_scope_draft_only;
ALTER TABLE form_version ENABLE TRIGGER trg_form_version_immutable;
ALTER TABLE rule_version ENABLE TRIGGER trg_rule_version_immutable;
ALTER TABLE rule_scope ENABLE TRIGGER trg_rule_scope_draft_only;

SELECT pg_temp.assert_protected_pilot_data();

DO $$
DECLARE
    remaining BIGINT;
BEGIN
    SELECT
        (SELECT count(*) FROM org_unit WHERE id IN (SELECT id FROM tmp_cleanup_org))
      + (SELECT count(*) FROM position_definition WHERE id IN (SELECT id FROM tmp_cleanup_position))
      + (SELECT count(*) FROM app_role WHERE id IN (SELECT id FROM tmp_cleanup_role))
      + (SELECT count(*) FROM user_account WHERE id IN (SELECT id FROM tmp_cleanup_account))
      + (SELECT count(*) FROM employee WHERE id IN (SELECT id FROM tmp_cleanup_employee))
      + (SELECT count(*) FROM employee_position_assignment WHERE id IN (SELECT id FROM tmp_cleanup_assignment))
      + (SELECT count(*) FROM standard_definition WHERE id IN (SELECT id FROM tmp_cleanup_standard_definition))
      + (SELECT count(*) FROM form_definition WHERE id IN (SELECT id FROM tmp_cleanup_form_definition))
      + (SELECT count(*) FROM work_package_definition WHERE id IN (SELECT id FROM tmp_cleanup_package_definition))
      + (SELECT count(*) FROM work_record WHERE id IN (SELECT id FROM tmp_cleanup_work_record))
      + (SELECT count(*) FROM rule_definition WHERE id IN (SELECT id FROM tmp_cleanup_rule_definition))
      + (SELECT count(*) FROM management_task WHERE id IN (SELECT id FROM tmp_cleanup_task))
      + (SELECT count(*) FROM notification WHERE id IN (SELECT id FROM tmp_cleanup_notification))
    INTO remaining;
    IF remaining <> 0 THEN RAISE EXCEPTION 'post-cleanup verification failed: % selected rows remain', remaining; END IF;
END $$;

-- The second tenant is a fixed isolation control. Delete it only if it still
-- contains exactly the known fixture rows and no other tenant-owned data.
SELECT set_config('app.tenant_id', '30000000-0000-0000-0000-000000000001', true);
DO $$
DECLARE
    relation RECORD;
    row_count BIGINT;
BEGIN
    IF EXISTS (SELECT 1 FROM tenant WHERE id = '30000000-0000-0000-0000-000000000001') THEN
        IF EXISTS (
            SELECT 1 FROM org_unit
            WHERE tenant_id = '30000000-0000-0000-0000-000000000001'
              AND code NOT IN ('UAT-B-GROUP', 'UAT-B-REGION', 'UAT-B-HOTEL')
        ) OR EXISTS (
            SELECT 1 FROM user_account
            WHERE tenant_id = '30000000-0000-0000-0000-000000000001' AND login_name <> 'isolation.probe'
        ) THEN RAISE EXCEPTION 'isolation tenant contains non-fixture master data'; END IF;

        FOR relation IN
            SELECT table_schema, table_name
            FROM information_schema.columns
            WHERE column_name = 'tenant_id'
              AND table_schema = 'public'
              AND table_name NOT IN ('org_unit', 'org_unit_closure', 'hotel_profile', 'user_account')
            GROUP BY table_schema, table_name
        LOOP
            EXECUTE format('SELECT count(*) FROM %I.%I WHERE tenant_id = $1', relation.table_schema, relation.table_name)
            INTO row_count USING '30000000-0000-0000-0000-000000000001'::uuid;
            IF row_count <> 0 THEN
                RAISE EXCEPTION 'isolation tenant has % unexpected rows in %.%', row_count, relation.table_schema, relation.table_name;
            END IF;
        END LOOP;

        DELETE FROM user_account WHERE tenant_id = '30000000-0000-0000-0000-000000000001';
        DELETE FROM hotel_profile WHERE tenant_id = '30000000-0000-0000-0000-000000000001';
        DELETE FROM org_unit_closure WHERE tenant_id = '30000000-0000-0000-0000-000000000001';
        DELETE FROM org_unit WHERE tenant_id = '30000000-0000-0000-0000-000000000001';
        DELETE FROM tenant WHERE id = '30000000-0000-0000-0000-000000000001';
    END IF;
END $$;

SELECT set_config('app.tenant_id', '10000000-0000-0000-0000-000000000001', true);
SELECT pg_temp.assert_protected_pilot_data();
COMMIT;
\echo 'PILOT_UAT_CLEANUP_EXECUTED_AND_VERIFIED'
\else
\echo 'DRY_RUN_ONLY: no business rows were changed; transaction will be rolled back.'
ROLLBACK;
\echo 'PILOT_UAT_CLEANUP_DRY_RUN_COMPLETE'
\endif
