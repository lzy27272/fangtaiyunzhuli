[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$scriptDirectory = Split-Path -Parent $MyInvocation.MyCommand.Path
$databaseDirectory = Resolve-Path (Join-Path $scriptDirectory '..\..\database\ota-migrations')

$compose = Get-Content -LiteralPath (Join-Path $scriptDirectory 'compose.yml') -Raw -Encoding UTF8
$environmentExample = Get-Content -LiteralPath (Join-Path $scriptDirectory '.env.example') -Raw -Encoding UTF8
$deploymentRunner = Get-Content -LiteralPath (Join-Path $scriptDirectory 'run-database-deployment.ps1') -Raw -Encoding UTF8
$roleBootstrap = Get-Content -LiteralPath (Join-Path $scriptDirectory 'postgres-init\00-create-runtime-roles.sh') -Raw -Encoding UTF8
$grants = Get-Content -LiteralPath (Join-Path $databaseDirectory 'post-migration-grants.sql') -Raw -Encoding UTF8
$grantVerifier = Get-Content -LiteralPath (Join-Path $databaseDirectory 'verify-runtime-grants.sql') -Raw -Encoding UTF8
$sprint1Migration = Get-Content -LiteralPath (Join-Path $databaseDirectory 'V2__sprint1_simulation_closed_loop.sql') -Raw -Encoding UTF8
$sprint2Migration = Get-Content -LiteralPath (Join-Path $databaseDirectory 'V3__sprint2_offline_safety_foundation.sql') -Raw -Encoding UTF8
$sprint2bMigration = Get-Content -LiteralPath (Join-Path $databaseDirectory 'V4__sprint2b_real_prep_control_plane.sql') -Raw -Encoding UTF8
$sprint2cMigration = Get-Content -LiteralPath (Join-Path $databaseDirectory 'V5__sprint2c_contract_governance_and_principal_rotation.sql') -Raw -Encoding UTF8
$sprint2dMigration = Get-Content -LiteralPath (Join-Path $databaseDirectory 'V6__sprint2d_offline_manual_authorization_rehearsal.sql') -Raw -Encoding UTF8
$wp2Migration = Get-Content -LiteralPath (Join-Path $databaseDirectory 'V7__wp2_store_source_binding_and_credential_migration_prep.sql') -Raw -Encoding UTF8
$finalStageMigration = Get-Content -LiteralPath (Join-Path $databaseDirectory 'V8__wp3_to_wp8_final_stage_control_plane.sql') -Raw -Encoding UTF8
$workerPrincipalSeed = Get-Content -LiteralPath (Join-Path $databaseDirectory 'seed-sprint1-simulation-worker-principal.sql') -Raw -Encoding UTF8

$failures = [System.Collections.Generic.List[string]]::new()

function Assert-Contains {
    param([string]$Document, [string]$Pattern, [string]$Message)
    if ($Document -notmatch $Pattern) {
        $failures.Add($Message)
    }
}

function Assert-NotContains {
    param([string]$Document, [string]$Pattern, [string]$Message)
    if ($Document -match $Pattern) {
        $failures.Add($Message)
    }
}

function Get-SqlFunctionDefinition {
    param([string]$Document, [string]$QualifiedName)
    $escapedName = [regex]::Escape($QualifiedName)
    return [regex]::Match(
        $Document,
        '(?ims)^CREATE(?: OR REPLACE)? FUNCTION\s+' + $escapedName +
            '\s*\(.*?^\$\$;\s*$'
    ).Value
}

$completeJobFunction = Get-SqlFunctionDefinition $sprint2cMigration 'control.complete_ota_job'
$runtimeParentGateFunction = Get-SqlFunctionDefinition $sprint2cMigration 'control.reject_configuration_only_runtime'

$postgresService = [regex]::Match(
    $compose,
    '(?ms)^  ota-postgres:\r?\n(?<body>.*?)(?=^  ota-db-role-bootstrap:)'
).Groups['body'].Value

if ([string]::IsNullOrWhiteSpace($postgresService)) {
    $failures.Add('Could not isolate ota-postgres service')
} else {
    Assert-Contains $postgresService 'POSTGRES_USER:\s*\$\{OTA_DB_BOOTSTRAP_USER' 'PostgreSQL must start under the distinct bootstrap identity'
    Assert-NotContains $postgresService 'OTA_DB_MIGRATION_(USER|PASSWORD)|OTA_DB_(API|WORKER|AUDIT)_(USER|PASSWORD)' 'Long-running PostgreSQL service must not receive deployment/runtime role secrets'
}

Assert-Contains $compose '(?ms)^  ota-db-migrator:.*?FLYWAY_DEFAULT_SCHEMA:\s*flyway.*?FLYWAY_SCHEMAS:\s*flyway' 'Missing one-shot Flyway job with isolated flyway schema'
Assert-Contains $compose '(?ms)^  ota-db-migrator:.*?depends_on:.*?ota-postgres:\s*\r?\n\s+condition:\s*service_healthy.*?ota-db-role-bootstrap:\s*\r?\n\s+condition:\s*service_completed_successfully' 'Migrator must wait for healthy PostgreSQL and successful role bootstrap'
Assert-Contains $compose 'FLYWAY_CLEAN_DISABLED:\s*"true"' 'Flyway clean must be disabled'
Assert-Contains $compose '\.\./\.\./database/ota-migrations/V1__sprint0_security_foundation\.sql:/flyway/sql/V1__sprint0_security_foundation\.sql:ro' 'Flyway must mount only the versioned migration file read-only'
Assert-Contains $compose '\.\./\.\./database/ota-migrations/V2__sprint1_simulation_closed_loop\.sql:/flyway/sql/V2__sprint1_simulation_closed_loop\.sql:ro' 'Flyway must mount the Sprint 1 migration read-only'
Assert-Contains $compose '\.\./\.\./database/ota-migrations/V3__sprint2_offline_safety_foundation\.sql:/flyway/sql/V3__sprint2_offline_safety_foundation\.sql:ro' 'Flyway must mount the Sprint 2A migration read-only'
Assert-Contains $compose '\.\./\.\./database/ota-migrations/V4__sprint2b_real_prep_control_plane\.sql:/flyway/sql/V4__sprint2b_real_prep_control_plane\.sql:ro' 'Flyway must mount the Sprint 2B configuration-only migration read-only'
Assert-Contains $compose '\.\./\.\./database/ota-migrations/V5__sprint2c_contract_governance_and_principal_rotation\.sql:/flyway/sql/V5__sprint2c_contract_governance_and_principal_rotation\.sql:ro' 'Flyway must mount the Sprint 2C governance migration read-only'
Assert-Contains $compose '\.\./\.\./database/ota-migrations/V6__sprint2d_offline_manual_authorization_rehearsal\.sql:/flyway/sql/V6__sprint2d_offline_manual_authorization_rehearsal\.sql:ro' 'Flyway must mount the Sprint 2D authorization rehearsal migration read-only'
Assert-Contains $compose '\.\./\.\./database/ota-migrations/V7__wp2_store_source_binding_and_credential_migration_prep\.sql:/flyway/sql/V7__wp2_store_source_binding_and_credential_migration_prep\.sql:ro' 'Flyway must mount the WP2 migration read-only'
Assert-Contains $compose '\.\./\.\./database/ota-migrations/V8__wp3_to_wp8_final_stage_control_plane\.sql:/flyway/sql/V8__wp3_to_wp8_final_stage_control_plane\.sql:ro' 'Flyway must mount the WP3-WP8 final-stage migration read-only'
Assert-NotContains $compose '\.\./\.\./database/ota-migrations:/flyway/sql:ro' 'Flyway location must not include post-migration and verification SQL files'
Assert-Contains $compose '(?ms)^  ota-db-worker-principal-seed:.*?depends_on:.*?ota-postgres:\s*\r?\n\s+condition:\s*service_healthy.*?ota-db-migrator:\s*\r?\n\s+condition:\s*service_completed_successfully' 'Worker principal seed must wait for healthy PostgreSQL and successful Flyway migration'
Assert-Contains $compose '(?ms)^  ota-db-worker-principal-seed:.*?PGUSER:\s*\$\{OTA_DB_MIGRATION_USER.*?PGPASSWORD:\s*\$\{OTA_DB_MIGRATION_PASSWORD' 'Worker principal seed must execute as the migration owner'
Assert-Contains $compose '--set=worker_service_principal_id=\$\{OTA_SPRINT1_SIMULATION_WORKER_PRINCIPAL_ID:\?OTA_SPRINT1_SIMULATION_WORKER_PRINCIPAL_ID is required\}' 'Worker principal seed must require the explicit environment UUID'
Assert-Contains $compose '--set=worker_principal_code=\$\{OTA_SPRINT1_SIMULATION_WORKER_PRINCIPAL_CODE:\?OTA_SPRINT1_SIMULATION_WORKER_PRINCIPAL_CODE is required\}' 'Worker principal seed must require an explicit immutable principal code'
Assert-Contains $compose '--set=worker_slot=\$\{OTA_DB_WORKER_SLOT:\?OTA_DB_WORKER_SLOT is required\}' 'Grant and verifier jobs must require an explicit BLUE/GREEN slot'
Assert-Contains $compose '\.\./\.\./database/ota-migrations/seed-sprint1-simulation-worker-principal\.sql:/deployment/seed-sprint1-simulation-worker-principal\.sql:ro' 'Worker principal seed SQL must be mounted as a single read-only deployment asset'
Assert-Contains $compose '(?ms)^  ota-db-grants:.*?post-migration-grants\.sql' 'Missing parameterized post-migration grant job'
Assert-Contains $compose '(?ms)^  ota-db-grants:.*?depends_on:.*?ota-postgres:\s*\r?\n\s+condition:\s*service_healthy.*?ota-db-worker-principal-seed:\s*\r?\n\s+condition:\s*service_completed_successfully' 'Grant job must wait for the successful Worker principal seed'
Assert-Contains $compose '(?ms)^  ota-db-grant-verifier:.*?verify-runtime-grants\.sql' 'Missing runtime grant verification job'
Assert-Contains $compose '(?ms)^  ota-db-grant-verifier:.*?depends_on:.*?ota-postgres:\s*\r?\n\s+condition:\s*service_healthy.*?ota-db-grants:\s*\r?\n\s+condition:\s*service_completed_successfully' 'Grant verifier must wait for healthy PostgreSQL and successful grant convergence'
Assert-Contains $deploymentRunner "(?ms)'ota-db-role-bootstrap',\s*'ota-db-migrator',\s*'ota-db-worker-principal-seed',\s*'ota-db-grants',\s*'ota-db-grant-verifier'" 'Deployment runner must preserve role-bootstrap -> migration -> principal-seed -> grants -> verifier order'
Assert-Contains $environmentExample '(?m)^OTA_SPRINT1_SIMULATION_WORKER_PRINCIPAL_ID=[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[89aAbB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}\s*$' 'Runtime environment example must contain a valid stable Worker service-principal UUID'
Assert-Contains $environmentExample '(?m)^OTA_SPRINT1_SIMULATION_WORKER_PRINCIPAL_CODE=OTA_[A-Z0-9_]+\s*$' 'Runtime environment example must contain an immutable Worker principal code'
Assert-Contains $environmentExample '(?m)^OTA_DB_WORKER_SLOT=(BLUE|GREEN)\s*$' 'Runtime environment example must select a BLUE/GREEN Worker slot'
Assert-Contains $environmentExample '(?m)^SPRING_FLYWAY_ENABLED=false\s*$' 'Standalone API Flyway must default to disabled in the runtime environment example'

Assert-Contains $workerPrincipalSeed "\\if\s+:\{\?worker_service_principal_id\}" 'Worker principal seed must fail when its psql UUID variable is missing'
Assert-Contains $workerPrincipalSeed "\\if\s+:\{\?worker_principal_code\}" 'Worker principal seed must fail when its principal code is missing'
Assert-Contains $workerPrincipalSeed ":'worker_service_principal_id'::UUID" 'Worker principal seed must validate the supplied value with a PostgreSQL UUID cast'
Assert-Contains $workerPrincipalSeed "service_principal_id\s+<>\s+'00000000-0000-0000-0000-000000000000'::UUID" 'Worker principal seed must reject the nil UUID'
Assert-Contains $workerPrincipalSeed "service_principal_owner\s+IS DISTINCT FROM CURRENT_USER" 'Worker principal seed must reject execution outside the migration owner'
Assert-Contains $workerPrincipalSeed "(?s):'worker_principal_code'.*?'CONNECTOR_WORKER'.*?'ACTIVE'" 'Worker principal seed must converge only the explicit simulation Worker identity'
Assert-Contains $workerPrincipalSeed "ON CONFLICT \(service_principal_id\) DO NOTHING" 'Worker principal seed must be idempotent without mutating an existing identity'
Assert-NotContains $workerPrincipalSeed "status\s*=\s*EXCLUDED\.status|disabled_at\s*=\s*NULL" 'Worker principal seed must never reactivate a DISABLED identity'
Assert-Contains $workerPrincipalSeed "(?s)principal\.purpose = 'CONNECTOR_WORKER'.*?principal\.status = 'ACTIVE'" 'Worker principal seed must verify the persisted claim-compatible state'
Assert-NotContains $workerPrincipalSeed '(?i)\b(password|token|cookie|webhook|secret)\b' 'Worker principal metadata seed must not contain credential material'

Assert-Contains $roleBootstrap 'NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS' 'Provisioned roles must converge to non-privileged NOBYPASS attributes'
Assert-Contains $roleBootstrap 'CREATE SCHEMA flyway AUTHORIZATION' 'Role bootstrap must create a migration-owned flyway schema'
Assert-Contains $roleBootstrap 'REVOKE ALL PRIVILEGES ON DATABASE %I FROM PUBLIC' 'Database PUBLIC privileges must be closed before explicit CONNECT grants'
Assert-Contains $roleBootstrap "REVOKE ALL PRIVILEGES ON DATABASE %I FROM %I'.*:'migration_user'" 'Migration role historical database privileges must be reset before the exact grant'
Assert-Contains $roleBootstrap "REVOKE ALL PRIVILEGES ON DATABASE %I FROM %I'.*:'api_user'" 'API role historical database privileges must be reset before CONNECT'
Assert-Contains $roleBootstrap "REVOKE ALL PRIVILEGES ON DATABASE %I FROM %I'.*:'worker_user'" 'Worker role historical database privileges must be reset before CONNECT'
Assert-Contains $roleBootstrap "REVOKE ALL PRIVILEGES ON DATABASE %I FROM %I'.*:'audit_user'" 'Audit role historical database privileges must be reset before CONNECT'
Assert-Contains $roleBootstrap '(?m)^REVOKE CREATE ON SCHEMA public FROM PUBLIC;\s*$' 'PUBLIC CREATE on schema public must be explicitly revoked'
Assert-Contains $roleBootstrap "REVOKE CREATE ON SCHEMA public FROM %I'.*:'api_user'" 'Historical API CREATE on schema public must be revoked'
Assert-Contains $roleBootstrap "REVOKE CREATE ON SCHEMA public FROM %I'.*:'worker_user'" 'Historical Worker CREATE on schema public must be revoked'
Assert-Contains $roleBootstrap "REVOKE CREATE ON SCHEMA public FROM %I'.*:'audit_user'" 'Historical Audit CREATE on schema public must be revoked'

Assert-NotContains $grants '(?i)GRANT\s+.*\bON\s+ALL\s+TABLES\b|GRANT\s+ALL\s+PRIVILEGES\s+ON\s+TABLE' 'Runtime grant script must not use broad ALL TABLES/ALL PRIVILEGES table grants'
Assert-Contains $grants "GRANT SELECT, INSERT ON TABLE control\.auth_account" 'API auth_account grant is missing'
Assert-Contains $grants "GRANT SELECT, INSERT, UPDATE ON TABLE control\.auth_credential" 'API auth_credential grant is missing'
Assert-Contains $grants "GRANT SELECT ON TABLE control\.role_definition" 'API role_definition grant is missing'
Assert-Contains $grants "GRANT SELECT, INSERT ON TABLE control\.account_role" 'API account_role grant is missing'
Assert-Contains $grants "GRANT SELECT, INSERT, UPDATE ON TABLE control\.auth_session" 'API auth_session grant is missing'
Assert-Contains $grants "GRANT INSERT ON TABLE control\.audit_event" 'Write-only audit INSERT grant is missing'
Assert-Contains $grants "GRANT SELECT ON TABLE flyway\.flyway_schema_history" 'API compatibility gate must receive only the exact Flyway history table'
Assert-NotContains $grants "GRANT (SELECT|UPDATE|DELETE).*control\.audit_event" 'Audit data must not receive SELECT/UPDATE/DELETE through the runtime grant script'
Assert-Contains $grants "GRANT EXECUTE ON FUNCTION control\.claim_ota_job\(uuid,uuid,uuid,timestamptz,timestamptz,text\)" 'Worker job-claim EXECUTE grant is missing'
Assert-Contains $grants "REVOKE ALL PRIVILEGES ON FUNCTION control\.dispatch_due_ota_jobs\(uuid,timestamptz,integer\)" 'Dynamic dispatcher historical EXECUTE privileges must be revoked before exact grants'
Assert-Contains $grants "GRANT EXECUTE ON FUNCTION control\.dispatch_due_ota_jobs\(uuid,timestamptz,integer\)" 'Worker dynamic-dispatch EXECUTE grant is missing'
Assert-Contains $grants "GRANT EXECUTE ON FUNCTION control\.renew_ota_job_lease\(uuid,uuid,uuid,timestamptz,timestamptz\)" 'Worker lease-renew EXECUTE grant is missing'
Assert-Contains $grants "GRANT EXECUTE ON FUNCTION control\.complete_ota_job\(uuid,uuid,uuid,timestamptz,text,text\)" 'Worker job-complete EXECUTE grant is missing'
Assert-Contains $grants "control\.service_principal_database_role_binding" 'Grant convergence must enumerate the session/principal binding table'
Assert-Contains $grants "GRANT EXECUTE ON FUNCTION control\.current_bound_service_principal_id\(\)" 'Worker must receive only the read-only current-session binding resolver'
Assert-Contains $grants "worker_service_principal_id" 'Grant convergence must require an explicit Worker principal id'
Assert-Contains $grants "worker_slot" 'Grant convergence must require an explicit BLUE/GREEN slot'
Assert-NotContains $grants "GRANT .*control\.assert_session_service_principal" 'Private session assertion must never be granted directly to a runtime role'
Assert-NotContains $grants "GRANT (SELECT|INSERT|UPDATE|DELETE).*control\.ota_job_registry" 'Runtime roles must not access the job registry table directly'
Assert-NotContains $grants "GRANT (SELECT|INSERT|UPDATE|DELETE).*control\.tenant_command_idempotency" 'Runtime roles must not access global tenant command receipts directly'
Assert-NotContains $grants "GRANT SELECT ON TABLE (control\.connector_contract_candidate_manifest|ota\.connector_contract_approved_baseline|ota\.connector_contract_baseline_revocation|ota\.connector_contract_command_receipt)" 'API/Worker must not receive direct contract-governance table reads'
Assert-NotContains $grants "GRANT .*INSERT.*ON TABLE ota\.connector_contract_approved_baseline" 'Shared API role must not insert approval evidence directly'
Assert-Contains $grants "GRANT EXECUTE ON FUNCTION control\.read_effective_connector_contract_baseline\(uuid,uuid,uuid,uuid,text\)" 'Worker narrow contract-baseline read grant is missing'
Assert-NotContains $grants "GRANT EXECUTE ON FUNCTION control\.(approve_connector_contract_candidate|revoke_connector_contract_baseline)" 'Runtime roles must never approve or revoke contract baselines'

Assert-Contains $grantVerifier 'rolbypassrls' 'Catalog verifier must assert NOBYPASSRLS'
Assert-Contains $grantVerifier 'Runtime role % owns deployment objects' 'Catalog verifier must reject runtime object owners'
Assert-Contains $grantVerifier 'Worker schema privilege matrix must be control\+ota USAGE only' 'Catalog verifier must enforce the Worker schema boundary'
Assert-Contains $grantVerifier "must have database CONNECT only" 'Catalog verifier must reject runtime database CREATE/TEMPORARY privileges'
Assert-Contains $grantVerifier 'Migration executor lacks expected CONNECT\+CREATE\+TEMPORARY' 'Catalog verifier must enforce the migration database privilege set'
Assert-Contains $grantVerifier 'PUBLIC must not retain CREATE on schema public' 'Catalog verifier must reject PUBLIC CREATE on schema public'
Assert-Contains $grantVerifier 'must not have effective CREATE on schema public' 'Catalog verifier must reject runtime CREATE on schema public'
Assert-Contains $grantVerifier "object_name = 'control\.audit_event' AND privilege_name = 'INSERT'" 'Catalog verifier must enforce write-only audit access'
Assert-Contains $grantVerifier 'SECURITY DEFINER command/job functions must pin search_path to pg_catalog' 'Catalog verifier must enforce fixed SECURITY DEFINER search_path'
Assert-Contains $grantVerifier 'explicit live CONNECTOR_WORKER principal/slot' 'Catalog verifier must enforce the explicit Worker session/principal slot binding'
Assert-Contains $grantVerifier 'Worker session/job functions have an unexpected EXECUTE grantee' 'Catalog verifier must enforce the exact Worker function ACL'
Assert-Contains $grantVerifier 'incoming or outgoing database-role membership' 'Catalog verifier must reject bidirectional runtime-role membership'
Assert-Contains $grantVerifier 'database_role_oid' 'Catalog verifier must enforce immutable Worker role OIDs'
Assert-Contains $grantVerifier 'transaction_isolation' 'Catalog verifier must enforce READ COMMITTED Worker sessions'
Assert-Contains $grantVerifier 'hotel_message_delivery_disabled' 'Catalog verifier must enforce the message-delivery hard freeze'

Assert-Contains $sprint1Migration "delivery_mode\s+VARCHAR\(32\) NOT NULL DEFAULT 'SIMULATION_ONLY'" 'Sprint 1 simulation run must be simulation-only'
Assert-Contains $sprint1Migration "external_delivery_allowed\s+BOOLEAN NOT NULL DEFAULT FALSE\s+CHECK \(NOT external_delivery_allowed\)" 'Sprint 1 must fail closed against real external delivery'
Assert-Contains $sprint1Migration "external_network_attempted\s+BOOLEAN NOT NULL DEFAULT FALSE\s+CHECK \(NOT external_network_attempted\)" 'Sprint 1 attempts must fail closed against external network use'
Assert-Contains $sprint2Migration "(?s)CREATE TABLE control\.service_principal_database_role_binding.*?database_role_name NAME NOT NULL UNIQUE" 'Sprint 2A one-to-one database-role binding is missing'
Assert-Contains $sprint2Migration "(?s)CREATE FUNCTION control\.assert_session_service_principal.*?database_role_name = session_user::NAME.*?principal\.status = 'ACTIVE'" 'Sprint 2A private session assertion must require an ACTIVE bound principal'
foreach ($function in @(
    'dispatch_due_ota_jobs', 'claim_ota_job',
    'renew_ota_job_lease', 'complete_ota_job'
)) {
    Assert-Contains $sprint2Migration "(?s)CREATE OR REPLACE FUNCTION control\.$function.*?control\.assert_session_service_principal" "Sprint 2A $function must enforce the session principal binding"
}
Assert-Contains $sprint2Migration "(?s)ota_job_registry_scheduled_slot_check.*?date_trunc\('minute', scheduled_for\).*?HOURLY_CUTOFF.*?date_trunc\('hour', scheduled_for\)" 'Sprint 2A job slots must preserve exact minutes while keeping hourly cutoffs on the hour'
Assert-Contains $sprint2Migration "(?s)connector_collection_run_cutoff_slot_check.*?date_trunc\('minute', cutoff_at\).*?MANUAL_SIMULATION.*?date_trunc\('hour', cutoff_at\)" 'Sprint 2A collection runs must preserve normal minute cutoffs while keeping simulation/hourly cutoffs on the hour'
Assert-NotContains $sprint2Migration "connector_mode\s+IN\s*\([^)]*'REAL'" 'Sprint 2A must not enable a real connector mode'
Assert-NotContains $sprint2Migration "(external_delivery_allowed\s*=\s*TRUE|transport_mode\s*=\s*'REAL')" 'Sprint 2A must not enable external message delivery'
Assert-Contains $sprint2bMigration "connector_mode IN \('SIMULATION', 'FILE_IMPORT', 'CONFIGURATION_ONLY'\)" 'Sprint 2B must add only the inert CONFIGURATION_ONLY mode'
Assert-Contains $sprint2bMigration "CONFIGURATION_ONLY mode cannot be entered or exited by in-place connector update" 'Sprint 2B configuration-only mode must not be activated through an in-place update'
Assert-Contains $sprint2bMigration "(?s)'PMS_INTAKE'.*?'CTRIP_INTAKE'.*?'MEITUAN_INTAKE'.*?FALSE,\s*FALSE" 'Sprint 2B inert intake templates are missing'
Assert-Contains $sprint2bMigration "cardinality\(capability_codes\) = 0" 'Sprint 2B intake templates must keep an empty capability allowlist'
Assert-Contains $sprint2bMigration "cardinality\(allowed_host_patterns\) = 0" 'Sprint 2B intake templates must keep an empty host allowlist'
Assert-Contains $sprint2bMigration "CREATE TABLE ota\.connector_contract_approved_baseline" 'Sprint 2B approved contract baseline is missing'
Assert-Contains $sprint2bMigration "ALTER TABLE ota\.connector_contract_approved_baseline FORCE ROW LEVEL SECURITY" 'Sprint 2B approved baseline must FORCE RLS'
Assert-Contains $sprint2bMigration "trg_connector_contract_baseline_append_only" 'Sprint 2B approved baseline must be append-only'
Assert-Contains $sprint2bMigration "current_setting\('app\.account_id', TRUE\)" 'Sprint 2B approved baseline must bind approval to the account session'
Assert-Contains $sprint2bMigration "connector_secret_binding_no_embedded_credentials_check" 'Sprint 2B Secret reference user-info guard is missing'
Assert-Contains $sprint2bMigration "trg_schedule_reject_configuration_only" 'Sprint 2B configuration-only schedule guard is missing'
Assert-Contains $sprint2bMigration "trg_job_reject_configuration_only" 'Sprint 2B configuration-only job guard is missing'
Assert-Contains $sprint2bMigration "trg_collection_run_reject_configuration_only" 'Sprint 2B configuration-only collection-run guard is missing'
Assert-Contains $sprint2bMigration "trg_checkpoint_reject_configuration_only" 'Sprint 2B configuration-only checkpoint guard is missing'
Assert-NotContains $sprint2bMigration "(connector_mode\s+IN\s*\([^)]*'REAL'|connector_mode\s*=\s*'REAL'|transport_mode\s*=\s*'REAL'|external_delivery_allowed\s*=\s*TRUE)" 'Sprint 2B must not add real runtime or external delivery switches'
Assert-Contains $sprint2cMigration "CREATE TABLE control\.connector_contract_candidate_manifest" 'Sprint 2C trusted candidate manifest is missing'
Assert-NotContains $sprint2cMigration "(?im)^INSERT INTO control\.connector_contract_candidate_manifest" 'Sprint 2C must not seed a trusted candidate'
Assert-Contains $sprint2cMigration "CREATE FUNCTION control\.read_effective_connector_contract_baseline" 'Sprint 2C Worker narrow-read function is missing'
Assert-Contains $sprint2cMigration "CREATE FUNCTION control\.rollback_service_principal_promotion" 'Sprint 2C blue/green rollback gate is missing'
Assert-Contains $sprint2cMigration "CREATE FUNCTION control\.cancel_staged_service_principal_binding" 'Sprint 2C staged identity cancellation is missing'
Assert-Contains $sprint2cMigration "CREATE FUNCTION control\.enforce_live_worker_write_session" 'Sprint 2C Worker direct-write session gate is missing'
Assert-Contains $sprint2cMigration "ADD COLUMN database_role_oid OID" 'Sprint 2C immutable Worker role OID is missing'
Assert-Contains $sprint2cMigration "membership\.member = session_role_oid\s+OR membership\.roleid = session_role_oid" 'Sprint 2C Worker gate must reject incoming and outgoing membership'
Assert-Contains $sprint2cMigration "transaction_isolation" 'Sprint 2C Worker gates must require READ COMMITTED'
Assert-Contains $sprint2cMigration "binding_state = 'ACTIVE'" 'Sprint 2C direct writes and new/renewed leases must be ACTIVE-only'
Assert-NotContains $sprint2cMigration "(?s)guarded_relations CONSTANT TEXT\[\] := ARRAY\[.*?control\.ota_job_registry.*?\];" 'Job registry must not be covered by direct Worker DML triggers'
Assert-Contains $sprint2cMigration "(?s)dispatch_due_ota_jobs.*?FROM control\.tenant_directory.*?set_config\(\s*'app\.tenant_id'.*?clock_timestamp\(\)" 'Sprint 2C dispatcher must enumerate FORCE-RLS tenants using database time'
Assert-Contains $sprint2cMigration "(?s)renew_ota_job_lease.*?assert_session_active_service_principal" 'DRAINING Worker must not renew a lease'
Assert-Contains $completeJobFunction "database_now <= live_draining_at \+ INTERVAL '15 minutes'" 'DRAINING completion must end within fifteen minutes'
Assert-Contains $completeJobFunction "job\.lease_acquired_at <= live_draining_at" 'DRAINING completion must use a lease acquired before drain'
Assert-Contains $runtimeParentGateFunction "(?ims)TG_TABLE_SCHEMA = 'control'.*?TG_TABLE_NAME = 'ota_job_registry'.*?set_config\('app\.tenant_id', NEW\.tenant_id::TEXT, TRUE\)" 'Only the global job queue may establish runtime parent-check tenant context from NEW'
Assert-Contains $runtimeParentGateFunction "(?ims)connector\.tenant_id = NEW\.tenant_id.*?connector\.hotel_id = NEW\.hotel_id.*?connector\.connector_id = NEW\.connector_id" 'Runtime parent lookup must use the explicit tenant/hotel/connector key'
Assert-Contains $sprint2cMigration "ADD CONSTRAINT hotel_message_delivery_disabled\s+CHECK \(NOT message_enabled\)" 'Database message_enabled=false hard freeze is missing'
Assert-NotContains $sprint2cMigration "(connector_mode\s+IN\s*\([^)]*'REAL'|connector_mode\s*=\s*'REAL'|transport_mode\s*=\s*'REAL'|external_delivery_allowed\s*=\s*TRUE|message_enabled\s*=\s*TRUE)" 'Sprint 2C must not add real runtime, network or message switches'
Assert-Contains $wp2Migration "CREATE TABLE ota\.credential_migration_rehearsal" 'WP2 metadata-only credential migration rehearsal is missing'
Assert-Contains $wp2Migration "raw_secret_received\s+BOOLEAN NOT NULL DEFAULT FALSE CHECK \(NOT raw_secret_received\)" 'WP2 must reject raw secret material at the database boundary'
Assert-Contains $wp2Migration "execution_allowed\s+BOOLEAN NOT NULL DEFAULT FALSE CHECK \(NOT execution_allowed\)" 'WP2 migration preparation must remain non-executable'
Assert-Contains $wp2Migration "authorization_state\s+VARCHAR\(32\) NOT NULL DEFAULT 'UAT_REQUIRED'" 'WP2 connector authorization must remain UAT-required'
Assert-NotContains $wp2Migration "(connector_mode\s+IN\s*\([^)]*'REAL'|connector_mode\s*=\s*'REAL'|transport_mode\s*=\s*'REAL'|external_delivery_allowed\s*=\s*TRUE|message_enabled\s*=\s*TRUE|execution_allowed\s*=\s*TRUE)" 'WP2 must not enable real runtime, execution, network or message switches'
Assert-Contains $finalStageMigration "retention_days\s*=\s*365" 'Final-stage operating and audit retention must be exactly one year'
Assert-Contains $finalStageMigration "severity IN \('P1', 'P2'\).*?route_code = 'IN_APP_AND_WECOM'" 'P1 and P2 must both create in-app plus WeCom intents'
Assert-Contains $finalStageMigration "severity = 'P3'.*?route_code = 'DAILY_WECOM_SUMMARY'" 'P3 must use the daily WeCom summary route'
Assert-Contains $finalStageMigration "external_delivery_allowed\s+BOOLEAN NOT NULL DEFAULT FALSE CHECK \(NOT external_delivery_allowed\)" 'Final-stage notification intent must remain UAT fail-closed'
Assert-Contains $finalStageMigration "external_execution_allowed\s+BOOLEAN NOT NULL DEFAULT FALSE CHECK \(NOT external_execution_allowed\)" 'Final-stage channel execution must remain fail-closed'
Assert-Contains $finalStageMigration "planned_business_days\s+INTEGER NOT NULL DEFAULT 7 CHECK \(planned_business_days = 7\)" 'All-store UAT must require seven business days'
Assert-Contains $finalStageMigration "(?s)CREATE VIEW ota\.anomaly_first_dashboard.*?WITH \(security_invoker = true\)" 'Final-stage dashboard must honor invoker RLS'
Assert-NotContains $finalStageMigration "(?i)(password|cookie|token|webhook)(_value|_text|_body)?\s+(TEXT|VARCHAR|JSONB|BYTEA)" 'Final-stage schema must not persist secret material'

if ($failures.Count -gt 0) {
    $formatted = $failures | ForEach-Object { " - $_" }
    throw "OTA deployment structure verification failed:`n$($formatted -join "`n")"
}

Write-Output 'PASS: one-shot V1-V8 migration, WP3-WP8 fail-closed final stage, trusted contract governance, blue/green Worker gates, runtime Flyway-off default and exact grant matrix verified.'
