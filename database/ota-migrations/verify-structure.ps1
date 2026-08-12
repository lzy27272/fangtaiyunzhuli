[CmdletBinding()]
param(
    [string]$MigrationPath,
    [string]$Sprint1MigrationPath,
    [string]$Sprint2MigrationPath,
    [string]$Sprint2bMigrationPath,
    [string]$Sprint2cMigrationPath,
    [string]$Sprint2dMigrationPath,
    [string]$Wp2MigrationPath,
    [string]$FinalStageMigrationPath
)

$ErrorActionPreference = 'Stop'
$scriptDirectory = Split-Path -Parent $MyInvocation.MyCommand.Path

if ([string]::IsNullOrWhiteSpace($MigrationPath)) {
    $MigrationPath = Join-Path $scriptDirectory 'V1__sprint0_security_foundation.sql'
}
if ([string]::IsNullOrWhiteSpace($Sprint1MigrationPath)) {
    $Sprint1MigrationPath = Join-Path $scriptDirectory 'V2__sprint1_simulation_closed_loop.sql'
}
if ([string]::IsNullOrWhiteSpace($Sprint2MigrationPath)) {
    $Sprint2MigrationPath = Join-Path $scriptDirectory 'V3__sprint2_offline_safety_foundation.sql'
}
if ([string]::IsNullOrWhiteSpace($Sprint2bMigrationPath)) {
    $Sprint2bMigrationPath = Join-Path $scriptDirectory 'V4__sprint2b_real_prep_control_plane.sql'
}
if ([string]::IsNullOrWhiteSpace($Sprint2cMigrationPath)) {
    $Sprint2cMigrationPath = Join-Path $scriptDirectory 'V5__sprint2c_contract_governance_and_principal_rotation.sql'
}
if ([string]::IsNullOrWhiteSpace($Sprint2dMigrationPath)) {
    $Sprint2dMigrationPath = Join-Path $scriptDirectory 'V6__sprint2d_offline_manual_authorization_rehearsal.sql'
}
if ([string]::IsNullOrWhiteSpace($Wp2MigrationPath)) {
    $Wp2MigrationPath = Join-Path $scriptDirectory 'V7__wp2_store_source_binding_and_credential_migration_prep.sql'
}
if ([string]::IsNullOrWhiteSpace($FinalStageMigrationPath)) {
    $FinalStageMigrationPath = Join-Path $scriptDirectory 'V8__wp3_to_wp8_final_stage_control_plane.sql'
}

foreach ($path in @($MigrationPath, $Sprint1MigrationPath, $Sprint2MigrationPath, $Sprint2bMigrationPath, $Sprint2cMigrationPath, $Sprint2dMigrationPath, $Wp2MigrationPath, $FinalStageMigrationPath)) {
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
        throw "Migration not found: $path"
    }
}

$v1Sql = Get-Content -LiteralPath $MigrationPath -Raw -Encoding UTF8
$v2Sql = Get-Content -LiteralPath $Sprint1MigrationPath -Raw -Encoding UTF8
$v3Sql = Get-Content -LiteralPath $Sprint2MigrationPath -Raw -Encoding UTF8
$v4Sql = Get-Content -LiteralPath $Sprint2bMigrationPath -Raw -Encoding UTF8
$v5Sql = Get-Content -LiteralPath $Sprint2cMigrationPath -Raw -Encoding UTF8
$v6Sql = Get-Content -LiteralPath $Sprint2dMigrationPath -Raw -Encoding UTF8
$v7Sql = Get-Content -LiteralPath $Wp2MigrationPath -Raw -Encoding UTF8
$v8Sql = Get-Content -LiteralPath $FinalStageMigrationPath -Raw -Encoding UTF8
$grantSql = Get-Content -LiteralPath (Join-Path $scriptDirectory 'post-migration-grants.sql') -Raw -Encoding UTF8
$sql = $v1Sql + "`n" + $v2Sql + "`n" + $v3Sql + "`n" + $v4Sql + "`n" + $v5Sql + "`n" + $v6Sql + "`n" + $v7Sql + "`n" + $v8Sql
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

$bindingRotationFunction = Get-SqlFunctionDefinition $v5Sql 'control.enforce_service_principal_binding_rotation'
$currentTenantFunction = Get-SqlFunctionDefinition $v5Sql 'control.current_tenant_id'
$completeJobFunction = Get-SqlFunctionDefinition $v5Sql 'control.complete_ota_job'
$workerWriteSessionFunction = Get-SqlFunctionDefinition $v5Sql 'control.enforce_live_worker_write_session'
$runtimeParentGateFunction = Get-SqlFunctionDefinition $v5Sql 'control.reject_configuration_only_runtime'

$requiredControlTables = @(
    'tenant_directory', 'auth_account', 'auth_identity', 'auth_credential',
    'auth_session', 'role_definition', 'permission_definition', 'role_permission',
    'account_role', 'service_principal', 'service_principal_database_role_binding',
    'service_principal_rotation_event', 'audit_event',
    'connector_adapter_registry', 'connector_contract_candidate_manifest',
    'tenant_command_idempotency', 'ota_job_registry'
)

$sprint0TenantTables = @(
    'hotel', 'account_hotel_scope', 'hotel_duty_roster_version',
    'hotel_duty_roster_assignment', 'hotel_escalation_policy_version',
    'hotel_escalation_recipient', 'ota_incident', 'ota_incident_occurrence',
    'ota_task', 'ota_task_event', 'ota_outbox_event', 'ota_outbox_publish_state'
)

$sprint1TenantTables = @(
    'hotel_business_day_config',
    'hotel_source_connector',
    'hotel_source_connector_version',
    'connector_secret_binding',
    'connector_authorization_state',
    'hotel_message_endpoint',
    'connector_collection_schedule',
    'hotel_revenue_target_version',
    'hotel_pace_curve_version',
    'hotel_pace_curve_point',
    'ota_command_idempotency',
    'simulation_run',
    'connector_collection_run',
    'connector_collection_attempt',
    'connector_stream_checkpoint',
    'source_raw_record',
    'source_import_batch',
    'pms_business_day_observation',
    'pms_business_day_transition',
    'business_day_run',
    'pms_operating_observation',
    'pms_room_charge_event',
    'source_standard_record',
    'ota_standard_room_type',
    'hotel_inventory_pool',
    'source_sellable_product',
    'source_product_mapping_version',
    'inventory_policy_version',
    'inventory_observation',
    'inventory_observation_item',
    'source_booking',
    'source_booking_revision',
    'booking_room_night_delta',
    'daily_operation_snapshot',
    'daily_operation_snapshot_metric',
    'ota_hourly_brief',
    'ota_brief_adjustment',
    'notification_target',
    'notification_delivery',
    'notification_delivery_attempt'
)

$sprint2bTenantTables = @(
    'connector_contract_approved_baseline'
)

$sprint2cTenantTables = @(
    'connector_contract_baseline_revocation',
    'connector_contract_command_receipt'
)

$sprint2dTenantTables = @(
    'browser_authorization_attempt',
    'browser_authorization_command_receipt'
)

$wp2TenantTables = @(
    'connector_access_authorization_draft',
    'credential_migration_rehearsal'
)

$finalStageTenantTables = @(
    'data_retention_policy_version',
    'data_quality_event',
    'safe_deep_link_policy_version',
    'ota_platform_alert',
    'ota_platform_alert_event',
    'alert_notification_intent',
    'hotel_ai_policy_version',
    'ai_advice_evaluation',
    'price_change_preview',
    'price_change_request',
    'price_change_event',
    'all_store_uat_run',
    'all_store_uat_daily_evidence',
    'hotel_release_decision'
)

foreach ($table in $requiredControlTables) {
    Assert-Contains $sql "(?im)^CREATE TABLE control\.$([regex]::Escape($table))\s*\(" "Missing control.$table"
}

foreach ($table in $sprint0TenantTables) {
    $escaped = [regex]::Escape($table)
    Assert-Contains $v1Sql "(?im)^CREATE TABLE ota\.$escaped\s*\(" "Missing ota.$table"
    Assert-Contains $v1Sql "(?im)^ALTER TABLE ota\.$escaped ENABLE ROW LEVEL SECURITY;" "ota.$table does not ENABLE RLS"
    Assert-Contains $v1Sql "(?im)^ALTER TABLE ota\.$escaped FORCE ROW LEVEL SECURITY;" "ota.$table does not FORCE RLS"
    Assert-Contains $v1Sql "(?ims)^CREATE POLICY tenant_isolation ON ota\.$escaped\s+USING \(tenant_id = control\.current_tenant_id\(\)\)\s+WITH CHECK \(tenant_id = control\.current_tenant_id\(\)\);" "ota.$table lacks fail-closed RLS"
}

$rlsBlock = [regex]::Match(
    $v2Sql,
    '(?ms)DO \$tenant_rls\$.*?tenant_tables CONSTANT TEXT\[\] := ARRAY\[(?<tables>.*?)\];.*?ALTER TABLE ota\.%I ENABLE ROW LEVEL SECURITY.*?ALTER TABLE ota\.%I FORCE ROW LEVEL SECURITY.*?CREATE POLICY tenant_isolation.*?\$tenant_rls\$;'
)
if (-not $rlsBlock.Success) {
    $failures.Add('Sprint 1 dynamic RLS block is missing or incomplete')
}

foreach ($table in $sprint1TenantTables) {
    $escaped = [regex]::Escape($table)
    Assert-Contains $v2Sql "(?im)^CREATE TABLE ota\.$escaped\s*\(" "Missing ota.$table"
    if ($rlsBlock.Success -and $rlsBlock.Groups['tables'].Value -notmatch "'$escaped'") {
        $failures.Add("ota.$table is absent from Sprint 1 ENABLE+FORCE RLS list")
    }

    $tableBlock = [regex]::Match(
        $v2Sql,
        "(?ms)^CREATE TABLE ota\.$escaped\s*\((?<body>.*?)^\);"
    )
    if (-not $tableBlock.Success) {
        $failures.Add("Could not parse ota.$table definition")
    } else {
        if ($tableBlock.Groups['body'].Value -notmatch '(?m)^\s*tenant_id\s+UUID\s+NOT NULL') {
            $failures.Add("ota.$table must contain NOT NULL tenant_id")
        }
        if ($tableBlock.Groups['body'].Value -notmatch '(?m)^\s*hotel_id\s+UUID\s+NOT NULL') {
            $failures.Add("ota.$table must contain NOT NULL hotel_id")
        }

        $otaForeignKeys = [regex]::Matches(
            $tableBlock.Groups['body'].Value,
            '(?ms)FOREIGN KEY\s*\((?<columns>[^)]*)\)\s*REFERENCES ota\.'
        )
        foreach ($foreignKey in $otaForeignKeys) {
            $normalizedColumns = ($foreignKey.Groups['columns'].Value -replace '\s+', '')
            if (-not $normalizedColumns.StartsWith('tenant_id,hotel_id')) {
                $failures.Add("ota.$table has an ota-to-ota FK without tenant_id + hotel_id prefix")
            }
        }
    }
}

foreach ($table in $sprint2bTenantTables) {
    $escaped = [regex]::Escape($table)
    Assert-Contains $v4Sql "(?im)^CREATE TABLE ota\.$escaped\s*\(" "Missing ota.$table"
    Assert-Contains $v4Sql "(?im)^ALTER TABLE ota\.$escaped ENABLE ROW LEVEL SECURITY;" "ota.$table does not ENABLE RLS"
    Assert-Contains $v4Sql "(?im)^ALTER TABLE ota\.$escaped FORCE ROW LEVEL SECURITY;" "ota.$table does not FORCE RLS"
    Assert-Contains $v4Sql "(?ims)^CREATE POLICY\s+\w+\s+ON ota\.$escaped\s+USING \(tenant_id = control\.current_tenant_id\(\)\)\s+WITH CHECK \(tenant_id = control\.current_tenant_id\(\)\);" "ota.$table lacks fail-closed RLS"
}

foreach ($table in $sprint2cTenantTables) {
    $escaped = [regex]::Escape($table)
    Assert-Contains $v5Sql "(?im)^CREATE TABLE ota\.$escaped\s*\(" "Missing ota.$table"
    Assert-Contains $v5Sql "(?im)^ALTER TABLE ota\.$escaped ENABLE ROW LEVEL SECURITY;" "ota.$table does not ENABLE RLS"
    Assert-Contains $v5Sql "(?im)^ALTER TABLE ota\.$escaped FORCE ROW LEVEL SECURITY;" "ota.$table does not FORCE RLS"
    Assert-Contains $v5Sql "(?ims)^CREATE POLICY\s+\w+\s+ON ota\.$escaped\s+USING \(tenant_id = control\.current_tenant_id\(\)\)\s+WITH CHECK \(tenant_id = control\.current_tenant_id\(\)\);" "ota.$table lacks fail-closed RLS"
}

foreach ($table in $sprint2dTenantTables) {
    $escaped = [regex]::Escape($table)
    Assert-Contains $v6Sql "(?im)^CREATE TABLE ota\.$escaped\s*\(" "Missing ota.$table"
    Assert-Contains $v6Sql "(?im)^ALTER TABLE ota\.$escaped ENABLE ROW LEVEL SECURITY;" "ota.$table does not ENABLE RLS"
    Assert-Contains $v6Sql "(?im)^ALTER TABLE ota\.$escaped FORCE ROW LEVEL SECURITY;" "ota.$table does not FORCE RLS"
    Assert-Contains $v6Sql "(?ims)^CREATE POLICY\s+\w+\s+ON ota\.$escaped\s+USING \(tenant_id = control\.current_tenant_id\(\)\)\s+WITH CHECK \(tenant_id = control\.current_tenant_id\(\)\);" "ota.$table lacks fail-closed RLS"
}

foreach ($table in $wp2TenantTables) {
    $escaped = [regex]::Escape($table)
    Assert-Contains $v7Sql "(?im)^CREATE TABLE ota\.$escaped\s*\(" "Missing ota.$table"
    Assert-Contains $v7Sql "(?im)^ALTER TABLE ota\.$escaped ENABLE ROW LEVEL SECURITY;" "ota.$table does not ENABLE RLS"
    Assert-Contains $v7Sql "(?im)^ALTER TABLE ota\.$escaped FORCE ROW LEVEL SECURITY;" "ota.$table does not FORCE RLS"
    Assert-Contains $v7Sql "(?ims)^CREATE POLICY\s+\w+\s+ON ota\.$escaped\s+USING \(tenant_id = control\.current_tenant_id\(\)\)\s+WITH CHECK \(tenant_id = control\.current_tenant_id\(\)\);" "ota.$table lacks fail-closed RLS"
}

foreach ($table in $finalStageTenantTables) {
    $escaped = [regex]::Escape($table)
    Assert-Contains $v8Sql "(?im)^CREATE TABLE ota\.$escaped\s*\(" "Missing ota.$table"
    Assert-Contains $v8Sql "(?s)'$escaped'.*?ALTER TABLE ota\.%I ENABLE ROW LEVEL SECURITY" "ota.$table is absent from final-stage ENABLE RLS list"
    Assert-Contains $v8Sql "(?s)'$escaped'.*?ALTER TABLE ota\.%I FORCE ROW LEVEL SECURITY" "ota.$table is absent from final-stage FORCE RLS list"
}

$createdTenantTables = [regex]::Matches($sql, '(?im)^CREATE TABLE ota\.(?<name>[a-z0-9_]+)\s*\(') |
    ForEach-Object { $_.Groups['name'].Value }
$expectedTenantTables = @($sprint0TenantTables + $sprint1TenantTables + $sprint2bTenantTables + $sprint2cTenantTables + $sprint2dTenantTables + $wp2TenantTables + $finalStageTenantTables)
$untrackedTenantTables = @($createdTenantTables | Where-Object { $_ -notin $expectedTenantTables })
$missingCreatedTables = @($expectedTenantTables | Where-Object { $_ -notin $createdTenantTables })
if ($untrackedTenantTables.Count -gt 0) {
    $failures.Add("Untracked ota tables could bypass FORCE-RLS verification: $($untrackedTenantTables -join ', ')")
}
if ($missingCreatedTables.Count -gt 0) {
    $failures.Add("Expected ota tables are absent: $($missingCreatedTables -join ', ')")
}

$sprint0AppendOnly = @(
    'control.audit_event', 'ota.ota_incident_occurrence',
    'ota.ota_task_event', 'ota.ota_outbox_event'
)
foreach ($table in $sprint0AppendOnly) {
    $escaped = [regex]::Escape($table)
    Assert-Contains $v1Sql "(?ims)^CREATE TRIGGER\s+\w+\s+BEFORE UPDATE OR DELETE ON $escaped\s+FOR EACH ROW EXECUTE FUNCTION control\.reject_append_only_mutation\(\);" "$table does not reject UPDATE/DELETE"
}

$sprint1AppendOnly = @(
    'ota_command_idempotency',
    'connector_collection_attempt',
    'source_raw_record',
    'pms_business_day_observation',
    'pms_business_day_transition',
    'pms_operating_observation',
    'pms_room_charge_event',
    'source_standard_record',
    'inventory_observation',
    'inventory_observation_item',
    'source_booking_revision',
    'booking_room_night_delta',
    'daily_operation_snapshot',
    'daily_operation_snapshot_metric',
    'ota_hourly_brief',
    'ota_brief_adjustment',
    'notification_delivery_attempt'
)
$finalStageAppendOnly = @(
    'data_retention_policy_version', 'data_quality_event',
    'safe_deep_link_policy_version', 'ota_platform_alert',
    'ota_platform_alert_event', 'alert_notification_intent',
    'hotel_ai_policy_version', 'ai_advice_evaluation',
    'price_change_preview', 'price_change_event',
    'all_store_uat_daily_evidence', 'hotel_release_decision'
)
foreach ($table in $finalStageAppendOnly) {
    Assert-Contains $v8Sql "(?s)'$([regex]::Escape($table))'.*?control\.reject_append_only_mutation\(\)" "ota.$table is absent from final-stage append-only list"
}
$appendBlock = [regex]::Match(
    $v2Sql,
    '(?ms)DO \$append_only_guards\$.*?immutable_tables CONSTANT TEXT\[\] := ARRAY\[(?<tables>.*?)\];.*?BEFORE UPDATE OR DELETE.*?control\.reject_append_only_mutation\(\).*?\$append_only_guards\$;'
)
if (-not $appendBlock.Success) {
    $failures.Add('Sprint 1 append-only guard block is missing or incomplete')
} else {
    foreach ($table in $sprint1AppendOnly) {
        if ($appendBlock.Groups['tables'].Value -notmatch "'$([regex]::Escape($table))'") {
            $failures.Add("ota.$table is absent from Sprint 1 append-only list")
        }
    }
}
Assert-Contains $v2Sql '(?ims)^CREATE TRIGGER trg_tenant_command_idempotency_append_only\s+BEFORE UPDATE OR DELETE ON control\.tenant_command_idempotency' 'control.tenant_command_idempotency must be append-only'
Assert-Contains $v4Sql '(?ims)^CREATE TRIGGER trg_connector_contract_baseline_append_only\s+BEFORE UPDATE OR DELETE ON ota\.connector_contract_approved_baseline\s+FOR EACH ROW\s+EXECUTE FUNCTION control\.reject_append_only_mutation\(\);' 'ota.connector_contract_approved_baseline must be append-only'
foreach ($table in @(
    'control.connector_contract_candidate_manifest',
    'control.service_principal_rotation_event',
    'ota.connector_contract_baseline_revocation',
    'ota.connector_contract_command_receipt'
)) {
    Assert-Contains $v5Sql "(?ims)BEFORE UPDATE OR DELETE ON $([regex]::Escape($table)).*?control\.reject_append_only_mutation\(\)" "$table must be append-only"
}
Assert-Contains $v6Sql '(?ims)BEFORE UPDATE OR DELETE ON ota\.browser_authorization_command_receipt.*?control\.reject_append_only_mutation\(\)' 'ota.browser_authorization_command_receipt must be append-only'
foreach ($table in @(
    'control.role_deprecation_event',
    'ota.connector_access_authorization_draft',
    'ota.credential_migration_rehearsal'
)) {
    Assert-Contains $v7Sql "(?ims)BEFORE UPDATE OR DELETE ON $([regex]::Escape($table)).*?control\.reject_append_only_mutation\(\)" "$table must be append-only"
}

$fixedRoles = @(
    'PLATFORM_ADMIN', 'OTA_OPERATION_ASSISTANT', 'OTA_OPERATION_MANAGER',
    'CEO', 'REGIONAL_MANAGER', 'REVENUE_MANAGER', 'HOTEL_P1_HANDLER'
)
foreach ($role in $fixedRoles) {
    Assert-Contains $v1Sql "'$role'" "Missing fixed role seed: $role"
}
foreach ($role in @(
    'GENERAL_MANAGER',
    'ASSISTANT_GENERAL_MANAGER',
    'FRONT_OFFICE_SUPERVISOR'
)) {
    Assert-Contains $v7Sql "'$role'" "Missing WP2 role seed: $role"
}

Assert-Contains $v1Sql '(?im)^\s*refresh_token_hash\s+' 'auth_session must persist only a refresh-token hash'
Assert-Contains $v1Sql '(?im)^\s*password_hash\s+' 'auth_credential must persist only a password hash'
Assert-Contains $v2Sql "(?im)^\s*secret_ref\s+VARCHAR\(512\)" 'Sprint 1 must persist opaque SecretStore references'
Assert-Contains $v2Sql "\^\(kms\|vault\|secretstore\|oskeyring\|envref\)://" 'Secret references must use an explicit provider URI allowlist'
Assert-Contains $v4Sql "connector_secret_binding_no_embedded_credentials_check" 'Sprint 2B must add a database guard against embedded Secret reference credentials'
Assert-Contains $v4Sql ([regex]::Escape("[A-Za-z0-9][A-Za-z0-9._/+~-][A-Za-z0-9._/+~-]+")) 'Sprint 2B Secret reference allowlist must exclude URI user-info punctuation'
Assert-NotContains $v2Sql '(?im)^\s*(password|refresh_token|access_token|cookie|webhook_url|secret_value|authorization_header)\s+(TEXT|VARCHAR|CHAR|JSONB?)\b' 'Potential plaintext credential/endpoint column found'

Assert-Contains $v2Sql "(?ims)^CREATE TABLE ota\.simulation_run.*?delivery_mode\s+VARCHAR.*?CHECK \(delivery_mode = 'SIMULATION_ONLY'\).*?external_delivery_allowed.*?CHECK \(NOT external_delivery_allowed\)" 'simulation_run is not database-enforced simulation-only'
Assert-Contains $v2Sql "(?ims)^CREATE TABLE ota\.notification_delivery.*?transport_mode.*?CHECK \(transport_mode = 'SIMULATION_ONLY'\).*?external_delivery_allowed.*?CHECK \(NOT external_delivery_allowed\)" 'notification_delivery is not database-enforced simulation-only'
Assert-Contains $v2Sql "(?ims)^CREATE TABLE ota\.notification_delivery_attempt.*?external_network_attempted.*?CHECK \(NOT external_network_attempted\)" 'delivery attempts do not fail closed against external network use'
Assert-Contains $v2Sql "(?ims)^CREATE TABLE ota\.daily_operation_snapshot_metric.*?quality_code.*?'NOT_CONFIGURED'" 'Snapshot metric must distinguish not-configured standards from unavailable facts'
Assert-NotContains $v2Sql "CHECK \(fixed_clock_at = date_trunc\('hour', fixed_clock_at\)\)" 'Simulation execution clock must allow HH:06 and other non-hour instants'
Assert-Contains $v2Sql "(?ims)^CREATE TABLE control\.ota_job_registry.*?CHECK \(scheduled_for = date_trunc\('hour', scheduled_for\)\)" 'Job scheduled_for must be an exact hour'
Assert-Contains $v2Sql "(?ims)^CREATE TABLE ota\.connector_collection_run.*?CHECK \(cutoff_at = date_trunc\('hour', cutoff_at\)\)" 'Collection cutoff must be an exact hour'
Assert-Contains $v2Sql "(?ims)^CREATE TABLE ota\.daily_operation_snapshot.*?CHECK \(cutoff_at = date_trunc\('hour', cutoff_at\)\)" 'Snapshot cutoff must be an exact hour'
Assert-Contains $v2Sql "(?ims)^CREATE TABLE ota\.ota_hourly_brief.*?CHECK \(cutoff_at = date_trunc\('hour', cutoff_at\)\)" 'Hourly brief cutoff must be an exact hour'
Assert-Contains $v2Sql "(?ims)^CREATE TABLE ota\.ota_brief_adjustment.*?simulation_run_id UUID NOT NULL.*?replacement_frozen_body TEXT NOT NULL.*?replacement_body_hash VARCHAR\(64\) NOT NULL.*?FOREIGN KEY \(tenant_id, hotel_id, simulation_run_id\).*?REFERENCES ota\.simulation_run.*?UNIQUE \(tenant_id, hotel_id, simulation_run_id\)" 'Brief adjustment must preserve a run-linked immutable replacement body'
Assert-NotContains $v2Sql "(?im)connector_mode\s+IN\s*\([^)]*'REAL'" 'Sprint 1 connector mode must not enable real collection'
Assert-NotContains $v3Sql "(?im)connector_mode\s+IN\s*\([^)]*'REAL'" 'Sprint 2A must not enable real collection'
Assert-NotContains $v3Sql "(?im)(external_delivery_allowed\s*=\s*TRUE|transport_mode\s*=\s*'REAL')" 'Sprint 2A must not enable external message delivery'
Assert-Contains $v4Sql "connector_mode IN \('SIMULATION', 'FILE_IMPORT', 'CONFIGURATION_ONLY'\)" 'Sprint 2B must add only CONFIGURATION_ONLY connector mode'
Assert-Contains $v4Sql "connector_mode <> 'CONFIGURATION_ONLY'\s+OR lifecycle_status IN \('DRAFT', 'PAUSED'\)" 'CONFIGURATION_ONLY connector lifecycle must stay DRAFT/PAUSED'
Assert-Contains $v4Sql "CONFIGURATION_ONLY mode cannot be entered or exited by in-place connector update" 'CONFIGURATION_ONLY mode transition must require a future forward migration'
Assert-Contains $v4Sql "(?ims)^CREATE FUNCTION control\.enforce_configuration_only_version\(\).*?NEW\.status <> 'DRAFT'.*?NEW\.tested_at IS NOT NULL.*?NEW\.activated_at IS NOT NULL.*?NEW\.retired_at IS NOT NULL" 'CONFIGURATION_ONLY versions must stay untested DRAFT records'
Assert-Contains $v4Sql "cardinality\(capability_codes\) = 0" 'Intake templates must have no registered capability'
Assert-Contains $v4Sql "cardinality\(allowed_host_patterns\) = 0" 'Intake templates must have no allowed host'
Assert-Contains $v4Sql "(?ims)^CREATE TRIGGER trg_schedule_reject_configuration_only.*?^CREATE TRIGGER trg_job_reject_configuration_only.*?^CREATE TRIGGER trg_collection_run_reject_configuration_only.*?^CREATE TRIGGER trg_checkpoint_reject_configuration_only" 'CONFIGURATION_ONLY schedule/job/run/checkpoint guards are incomplete'
Assert-Contains $v4Sql "(?ims)^CREATE TABLE ota\.connector_contract_approved_baseline.*?connector_version_id UUID NOT NULL.*?stream_code VARCHAR\(64\) NOT NULL.*?capability_fingerprint VARCHAR\(64\) NOT NULL.*?schema_fingerprint VARCHAR\(64\) NOT NULL.*?status VARCHAR\(24\) NOT NULL DEFAULT 'APPROVED'.*?approved_by_account_id UUID NOT NULL.*?approved_at TIMESTAMPTZ NOT NULL" 'Approved contract baseline schema is incomplete'
Assert-Contains $v4Sql "(?ims)^CREATE FUNCTION control\.enforce_connector_contract_baseline_approval\(\).*?role_definition\.role_code = 'PLATFORM_ADMIN'" 'Approved baseline must require PLATFORM_ADMIN approval'
Assert-Contains $v4Sql "(?ims)^CREATE FUNCTION control\.enforce_connector_contract_baseline_approval\(\).*?current_setting\('app\.account_id', TRUE\).*?NEW\.approved_by_account_id <> session_account_id" 'Approved baseline must bind the approver to the authenticated account session'
Assert-NotContains $grantSql "GRANT SELECT, INSERT ON TABLE ota\.connector_contract_approved_baseline" 'Shared API role must not directly insert approval evidence'
Assert-NotContains $v4Sql "(?im)(connector_mode\s+IN\s*\([^)]*'REAL'|connector_mode\s*=\s*'REAL'|external_delivery_allowed\s*=\s*TRUE|transport_mode\s*=\s*'REAL')" 'Sprint 2B must not enable real collection or external delivery'
Assert-Contains $v5Sql '(?ims)^CREATE TABLE control\.connector_contract_candidate_manifest.*?candidate_id UUID PRIMARY KEY.*?adapter_code.*?adapter_version.*?stream_code.*?capability_fingerprint.*?schema_fingerprint.*?artifact_digest' 'Sprint 2C trusted candidate manifest is incomplete'
Assert-NotContains $v5Sql '(?im)^INSERT INTO control\.connector_contract_candidate_manifest' 'Sprint 2C must not seed a trusted candidate'
Assert-Contains $v5Sql '(?ims)^ALTER TABLE ota\.connector_contract_approved_baseline.*?ADD COLUMN candidate_id UUID NOT NULL.*?ADD COLUMN approved_config_hash VARCHAR\(64\) NOT NULL' 'Sprint 2C baseline must bind trusted candidate and config snapshot'
Assert-Contains $v5Sql '(?ims)^CREATE FUNCTION control\.read_effective_connector_contract_baseline\(.*?RETURNS TABLE\(\s*connector_code TEXT,\s*adapter_version TEXT,\s*fingerprint_algorithm TEXT,\s*capability_fingerprint TEXT,\s*schema_fingerprint TEXT,\s*approval_status TEXT,\s*connector_version_status TEXT\s*\).*?LANGUAGE plpgsql\s+VOLATILE\s+SECURITY DEFINER\s+SET search_path = pg_catalog' 'Worker narrow contract read signature, volatility or safety boundary is incomplete'
Assert-Contains $grantSql 'GRANT EXECUTE ON FUNCTION control\.read_effective_connector_contract_baseline\(uuid,uuid,uuid,uuid,text\)' 'Worker narrow contract read EXECUTE grant is missing'
Assert-NotContains $grantSql 'GRANT (SELECT|INSERT|UPDATE|DELETE).*ON TABLE (control\.connector_contract_candidate_manifest|ota\.connector_contract_approved_baseline|ota\.connector_contract_baseline_revocation|ota\.connector_contract_command_receipt) TO .*worker' 'Worker must not receive direct contract-governance table access'
Assert-NotContains $grantSql 'GRANT SELECT ON TABLE (control\.connector_contract_candidate_manifest|ota\.connector_contract_approved_baseline|ota\.connector_contract_baseline_revocation|ota\.connector_contract_command_receipt) TO .*api' 'API must not receive direct contract-governance table reads'
Assert-NotContains $grantSql 'GRANT EXECUTE ON FUNCTION control\.(approve_connector_contract_candidate|revoke_connector_contract_baseline).*TO' 'API/Worker must not receive contract approval or revocation execution'
Assert-Contains $grantSql "worker_service_principal_id" 'Grant convergence must require an explicit Worker principal id'
Assert-Contains $grantSql "worker_slot" 'Grant convergence must require an explicit BLUE/GREEN slot'
Assert-Contains $v5Sql "(?ims)^CREATE FUNCTION control\.promote_service_principal_binding.*?binding_state = 'DRAINING'.*?binding_state = 'ACTIVE'" 'Blue/green promotion must atomically drain the predecessor and activate the replacement'
Assert-Contains $v5Sql "(?ims)^CREATE FUNCTION control\.rollback_service_principal_promotion.*?ROLLBACK_DRAIN_STARTED.*?ROLLBACK_PROMOTED" 'Blue/green promotion rollback is missing'
Assert-Contains $v5Sql "(?ims)^CREATE FUNCTION control\.cancel_staged_service_principal_binding.*?binding_state = 'RETIRED'.*?status = 'DISABLED'" 'Failed STAGED identity cancellation is missing'
Assert-Contains $v5Sql '(?ims)^ALTER TABLE control\.service_principal_database_role_binding.*?ADD COLUMN database_role_oid OID.*?ALTER COLUMN database_role_oid SET NOT NULL.*?UNIQUE \(database_role_oid\)' 'Worker binding must freeze an immutable, globally unique database role OID'
Assert-Contains $bindingRotationFunction 'role\.oid = NEW\.database_role_oid' 'Binding mutation gate must resolve the exact stored database role OID and name'
Assert-Contains $bindingRotationFunction 'NEW\.database_role_oid IS DISTINCT FROM OLD\.database_role_oid' 'Binding database role OID must be immutable'
Assert-Contains $bindingRotationFunction 'membership\.member = role_row\.oid\s+OR membership\.roleid = role_row\.oid' 'Binding mutation gate must reject incoming and outgoing role membership'
Assert-Contains $v5Sql '(?ims)^CREATE TRIGGER trg_service_principal_binding_delete_forbidden\s+BEFORE DELETE ON control\.service_principal_database_role_binding' 'Worker binding deletion must be forbidden'
Assert-Contains $currentTenantFunction '(?ims)\bSTABLE\b' 'Worker tenant read gate must remain STABLE'
Assert-Contains $currentTenantFunction 'live_binding\.database_role_oid = session_role_oid' 'Worker tenant read gate must require the exact database role OID'
Assert-Contains $currentTenantFunction 'live_binding\.database_role_name = session_user::NAME' 'Worker tenant read gate must require the exact database role name'
Assert-Contains $currentTenantFunction 'transaction_isolation' 'Worker tenant read gate must require READ COMMITTED'
Assert-Contains $currentTenantFunction 'statement_timestamp\(\)' 'DRAINING Worker reads must use a bounded statement-time window'
Assert-Contains $currentTenantFunction 'membership\.member = session_role_oid\s+OR membership\.roleid = session_role_oid' 'Worker tenant read gate must reject incoming and outgoing role membership'
Assert-Contains $currentTenantFunction '(?ims)NOT COALESCE\(session_role_is_superuser, FALSE\).*?pg_catalog\.pg_has_role' 'Superuser capability membership must not be treated as Worker delegation'
Assert-NotContains $currentTenantFunction '\bFOR SHARE\b' 'STABLE RLS tenant helper must not take binding row locks'
Assert-Contains $v5Sql "(?ims)^CREATE OR REPLACE FUNCTION control\.dispatch_due_ota_jobs.*?assert_session_active_service_principal" 'DRAINING identity must not dispatch'
Assert-Contains $v5Sql "(?ims)^CREATE OR REPLACE FUNCTION control\.claim_ota_job.*?assert_session_active_service_principal" 'DRAINING identity must not claim'
Assert-Contains $v5Sql "(?ims)^CREATE OR REPLACE FUNCTION control\.renew_ota_job_lease.*?assert_session_active_service_principal.*?clock_timestamp\(\)" 'DRAINING identity must not renew and renewal must use database time'
Assert-Contains $completeJobFunction 'assert_session_service_principal' 'Job completion must authenticate the bound Worker principal'
Assert-Contains $completeJobFunction 'clock_timestamp\(\)' 'Job completion must use database time'
Assert-Contains $completeJobFunction "database_now <= live_draining_at \+ INTERVAL '15 minutes'" 'DRAINING job completion must end within fifteen minutes'
Assert-Contains $completeJobFunction 'job\.lease_acquired_at <= live_draining_at' 'DRAINING job completion must use a lease acquired before drain'
Assert-Contains $workerWriteSessionFunction 'transaction_isolation' 'Worker direct writes must require READ COMMITTED'
Assert-Contains $workerWriteSessionFunction 'live_binding\.database_role_oid = session_role_oid' 'Worker direct writes must require the exact database role OID'
Assert-Contains $workerWriteSessionFunction 'live_binding\.database_role_name = session_user::NAME' 'Worker direct writes must require the exact database role name'
Assert-Contains $workerWriteSessionFunction "binding_state = 'ACTIVE'" 'Worker direct writes must be ACTIVE-only'
Assert-Contains $workerWriteSessionFunction 'membership\.member = session_role_oid\s+OR membership\.roleid = session_role_oid' 'Worker direct writes must reject incoming and outgoing role membership'
Assert-Contains $workerWriteSessionFunction '(?ims)NOT COALESCE\(session_role_is_superuser, FALSE\).*?pg_catalog\.pg_has_role' 'Worker write gate must distinguish superuser capability from delegated membership'
Assert-Contains $workerWriteSessionFunction '\bFOR SHARE\b' 'Worker direct-write gate must hold the live binding row lock'
Assert-Contains $runtimeParentGateFunction '(?ims)\bSECURITY DEFINER\b.*?SET search_path = pg_catalog' 'Runtime parent gate must use a fixed-path SECURITY DEFINER'
Assert-Contains $runtimeParentGateFunction "(?ims)TG_TABLE_SCHEMA = 'control'.*?TG_TABLE_NAME = 'ota_job_registry'.*?set_config\('app\.tenant_id', NEW\.tenant_id::TEXT, TRUE\)" 'Only the global job registry may establish context from NEW.tenant_id'
Assert-Contains $runtimeParentGateFunction '(?ims)connector\.tenant_id = NEW\.tenant_id.*?connector\.hotel_id = NEW\.hotel_id.*?connector\.connector_id = NEW\.connector_id' 'Runtime parent gate must use the explicit tenant/hotel/connector key'
Assert-Contains $runtimeParentGateFunction '(?ims)EXCEPTION.*?WHEN OTHERS.*?COALESCE\(prior_tenant_setting, ''''\).*?RAISE;.*?IF job_context_switched.*?COALESCE\(prior_tenant_setting, ''''\)' 'Runtime parent gate must restore tenant context on normal and exceptional paths'
Assert-Contains $v5Sql '(?ims)REVOKE ALL ON FUNCTION control\.reject_configuration_only_runtime\(\) FROM PUBLIC' 'Runtime parent gate must not be executable by PUBLIC'
Assert-Contains $v5Sql '(?ims)guarded_relations CONSTANT TEXT\[\] := ARRAY\[.*?ota\.notification_delivery_attempt.*?BEFORE INSERT OR UPDATE OR DELETE' 'Worker write-table trigger coverage is incomplete'
Assert-NotContains $v5Sql '(?ims)guarded_relations CONSTANT TEXT\[\] := ARRAY\[.*?control\.ota_job_registry.*?\];' 'Job registry must be writable only through SECURITY DEFINER lease functions'
Assert-Contains $v5Sql "(?ims)^CREATE OR REPLACE FUNCTION control\.dispatch_due_ota_jobs.*?FROM control\.tenant_directory.*?set_config\(\s*'app\.tenant_id'.*?schedule\.tenant_id = tenant_row\.dispatch_tenant_id.*?clock_timestamp\(\)" 'NOBYPASSRLS dispatcher must enumerate and scope every tenant using the database clock'
Assert-Contains $v5Sql '(?ims)^ALTER TABLE ota\.hotel\s+ADD CONSTRAINT hotel_message_delivery_disabled\s+CHECK \(NOT message_enabled\);' 'Database must hard-freeze message_enabled=false'
Assert-NotContains $v5Sql "(?im)(connector_mode\s+IN\s*\([^)]*'REAL'|connector_mode\s*=\s*'REAL'|external_delivery_allowed\s*=\s*TRUE|transport_mode\s*=\s*'REAL'|message_enabled\s*=\s*TRUE)" 'Sprint 2C must not enable real collection, external delivery or messaging'
Assert-Contains $v6Sql "(?ims)^CREATE TABLE ota\.browser_authorization_attempt.*?mode VARCHAR\(32\).*?CHECK \(mode = 'OFFLINE_REHEARSAL'\).*?authorization_state VARCHAR\(32\).*?CHECK \(authorization_state = 'AUTH_REQUIRED'\)" 'Sprint 2D authorization attempt must remain an offline AUTH_REQUIRED rehearsal'
Assert-NotContains $v6Sql "(?im)state_code IN \([^)]*'(AUTHORIZED|ACTIVE|VALID)'" 'Sprint 2D rehearsal state must not claim real authorization'
Assert-Contains $v6Sql "(?ims)^CREATE UNIQUE INDEX uq_browser_authorization_attempt_active_connector.*?WHERE state_code = 'WAITING_FOR_OPERATOR';" 'Sprint 2D active rehearsal uniqueness is missing'
Assert-Contains $v6Sql "(?ims)^CREATE TABLE ota\.browser_authorization_command_receipt.*?predecessor_authorization_attempt_id UUID.*?predecessor_expected_row_version BIGINT" 'Sprint 2D receipts must preserve reauthentication predecessor binding'
Assert-Contains $v6Sql "(?ims)^CREATE FUNCTION control\.enforce_browser_authorization_rehearsal_insert\(.*?source_type <> 'PMS'.*?connection_method IS DISTINCT FROM\s+'CONTROLLED_BROWSER'" 'Sprint 2D insert guard lost its PMS controlled-browser gate'
Assert-Contains $v6Sql "(?ims)^CREATE FUNCTION control\.enforce_browser_authorization_rehearsal_insert\(.*?secret_purpose = 'BROWSER_SESSION'.*?binding_status = 'CONFIGURED'" 'Sprint 2D insert guard lost its configured BROWSER_SESSION binding gate'
Assert-Contains $v6Sql "(?ims)^CREATE FUNCTION ota\.start_browser_authorization_rehearsal\(.*?SECURITY DEFINER\s+SET search_path = pg_catalog" 'Sprint 2D start command lost its fixed-path SECURITY DEFINER boundary'
Assert-Contains $v6Sql "(?ims)^CREATE FUNCTION ota\.start_browser_authorization_rehearsal\(.*?CONFIGURATION_ONLY" 'Sprint 2D start command lost its configuration-only gate'
Assert-Contains $v6Sql "(?ims)^CREATE FUNCTION ota\.start_browser_authorization_rehearsal\(.*?source_type <> 'PMS'.*?connection_method IS DISTINCT FROM\s+'CONTROLLED_BROWSER'.*?browser_session_binding_configured" 'Sprint 2D start command lost its PMS controlled-browser binding gate'
Assert-Contains $v6Sql "(?ims)^CREATE FUNCTION ota\.start_browser_authorization_rehearsal\(.*?AUTH_REQUIRED" 'Sprint 2D start command must remain AUTH_REQUIRED'
Assert-Contains $v6Sql "(?ims)^CREATE FUNCTION ota\.start_browser_authorization_rehearsal\(.*?p_predecessor_authorization_attempt_id UUID.*?p_predecessor_expected_row_version BIGINT.*?FOR UPDATE.*?predecessor_attempt\.row_version IS DISTINCT FROM\s+p_predecessor_expected_row_version" 'Sprint 2D reauthentication predecessor must be locked and CAS-validated inside start'
Assert-Contains $v6Sql "(?ims)^CREATE FUNCTION ota\.start_browser_authorization_rehearsal\(.*?active_attempt\.expires_at > command_now.*?expired_attempt := active_attempt" 'Sprint 2D ordinary START must atomically expire only an already-expired connector slot'
Assert-Contains $v6Sql "(?ims)^CREATE FUNCTION ota\.transition_browser_authorization_rehearsal\(.*?SECURITY DEFINER\s+SET search_path = pg_catalog" 'Sprint 2D transition command lost its fixed-path SECURITY DEFINER boundary'
Assert-Contains $v6Sql "(?ims)^CREATE FUNCTION ota\.transition_browser_authorization_rehearsal\(.*?CONFIGURATION_ONLY" 'Sprint 2D transition command lost its configuration-only gate'
Assert-Contains $v6Sql "(?ims)^CREATE FUNCTION ota\.transition_browser_authorization_rehearsal\(.*?source_type <> 'PMS'.*?connection_method IS DISTINCT FROM\s+'CONTROLLED_BROWSER'.*?browser_session_binding_configured" 'Sprint 2D transition command lost its PMS controlled-browser binding gate'
Assert-Contains $v6Sql "(?ims)^CREATE FUNCTION ota\.transition_browser_authorization_rehearsal\(.*?AUTH_REQUIRED" 'Sprint 2D transition command must remain AUTH_REQUIRED'
Assert-Contains $v6Sql "(?ims)^CREATE FUNCTION ota\.transition_browser_authorization_rehearsal\(.*?transition_now >= attempt_row\.expires_at.*?p_target_state <> 'EXPIRED'" 'Sprint 2D transitions at or beyond expiry must allow only EXPIRED'
Assert-Contains $grantSql 'GRANT SELECT ON TABLE ota\.browser_authorization_attempt' 'API must receive SELECT-only access to rehearsal attempts'
Assert-Contains $grantSql 'GRANT SELECT ON TABLE ota\.browser_authorization_command_receipt' 'API must receive SELECT-only access to rehearsal receipts'
Assert-NotContains $grantSql 'GRANT (INSERT|UPDATE|DELETE).*ON TABLE ota\.browser_authorization_(attempt|command_receipt) TO .*api' 'API must not directly mutate rehearsal attempts or receipts'
Assert-NotContains $grantSql 'GRANT (SELECT|INSERT|UPDATE|DELETE).*ON TABLE ota\.browser_authorization_(attempt|command_receipt) TO .*worker' 'Worker must not access offline rehearsal persistence'
Assert-Contains $grantSql 'GRANT EXECUTE ON FUNCTION ota\.start_browser_authorization_rehearsal' 'API start rehearsal function grant is missing'
Assert-Contains $grantSql 'GRANT EXECUTE ON FUNCTION ota\.transition_browser_authorization_rehearsal' 'API transition rehearsal function grant is missing'
Assert-NotContains $v6Sql "(?im)(connector_mode\s+IN\s*\([^)]*'REAL'|connector_mode\s*=\s*'REAL'|external_delivery_allowed\s*=\s*TRUE|transport_mode\s*=\s*'REAL'|message_enabled\s*=\s*TRUE)" 'Sprint 2D must not enable real collection, delivery or messaging'

Assert-Contains $v7Sql "(?ims)^CREATE TABLE control\.role_deprecation_event.*?role_code = 'REVENUE_MANAGER'.*?ROLE_REMOVED_FROM_ORG_MATRIX" 'WP2 legacy role deprecation evidence is missing'
Assert-Contains $v7Sql "(?ims)^UPDATE control\.account_role.*?role\.role_code = 'REVENUE_MANAGER'.*?valid_until = CURRENT_TIMESTAMP" 'WP2 must expire active legacy account-role assignments'
Assert-Contains $v7Sql "(?ims)^CREATE FUNCTION control\.reject_deprecated_account_role\(\).*?deprecated role cannot receive an active assignment" 'WP2 must fail closed against new active legacy role assignments'
Assert-Contains $v7Sql "(?ims)^ALTER TABLE ota\.account_hotel_scope.*?PRICE_REQUEST_INITIATION.*?PRICE_APPROVAL.*?P1_HANDLING" 'WP2 hotel scope matrix is incomplete'
Assert-NotContains $v7Sql "(?ims)^ALTER TABLE ota\.account_hotel_scope.*?REVENUE_MANAGER.*?scope_type" 'WP2 hotel scope matrix must not authorize the removed revenue role'
Assert-Contains $v7Sql "(?ims)^CREATE TABLE ota\.connector_access_authorization_draft.*?authorization_state.*?CHECK \(authorization_state = 'UAT_REQUIRED'\).*?execution_allowed.*?CHECK \(NOT execution_allowed\).*?STANDARD_RETAIL_ONLY" 'WP2 authorization metadata must remain UAT-required and non-executable'
Assert-Contains $v7Sql "(?ims)^CREATE TABLE ota\.credential_migration_rehearsal.*?migration_mode.*?METADATA_ONLY.*?rehearsal_state.*?METADATA_REHEARSAL_READY.*?raw_secret_received.*?CHECK \(NOT raw_secret_received\).*?execution_allowed.*?CHECK \(NOT execution_allowed\)" 'WP2 credential migration rehearsal must remain metadata-only and non-executable'
Assert-Contains $v7Sql "(?ims)^CREATE FUNCTION control\.enforce_credential_migration_rehearsal\(\).*?CONFIGURATION_ONLY.*?target binding metadata mismatch" 'WP2 migration rehearsal must bind to an exact configuration-only Secret metadata record'
Assert-NotContains $v7Sql '(?im)^\s*(password|refresh_token|access_token|cookie|webhook_url|secret_value|authorization_header|legacy_locator|source_locator)\s+(TEXT|VARCHAR|CHAR|JSONB?)\b' 'WP2 migration tables must not persist a raw credential or legacy locator'
Assert-NotContains $v7Sql "(?im)(connector_mode\s+IN\s*\([^)]*'REAL'|connector_mode\s*=\s*'REAL'|external_delivery_allowed\s*=\s*TRUE|transport_mode\s*=\s*'REAL'|message_enabled\s*=\s*TRUE|execution_allowed\s*=\s*TRUE)" 'WP2 must not enable real collection, execution, delivery or messaging'
Assert-Contains $v8Sql "(?s)data_class <> 'REDACTED_RAW_EVIDENCE'.*?retention_days = 365" 'WP3 operating, derived, brief, alert, task, price and audit data must retain exactly one year'
Assert-Contains $v8Sql "(?s)data_class = 'REDACTED_RAW_EVIDENCE'.*?retention_days = 30" 'WP3 redacted raw evidence must retain exactly thirty days'
Assert-Contains $v8Sql "(?s)severity IN \('P1', 'P2'\).*?route_code = 'IN_APP_AND_WECOM'" 'WP5 P1 and P2 must both route to in-app plus WeCom intents'
Assert-Contains $v8Sql "(?s)severity = 'P3'.*?route_code = 'DAILY_WECOM_SUMMARY'" 'WP5 P3 must route to the daily WeCom summary'
Assert-Contains $v8Sql "external_delivery_allowed\s+BOOLEAN NOT NULL DEFAULT FALSE CHECK \(NOT external_delivery_allowed\)" 'WP5 external delivery must remain fail-closed during UAT'
Assert-Contains $v8Sql "deterministic_fallback_required\s+BOOLEAN NOT NULL DEFAULT TRUE CHECK \(deterministic_fallback_required\)" 'WP6 deterministic fallback is mandatory'
Assert-Contains $v8Sql "rate_type\s+VARCHAR\(32\) NOT NULL DEFAULT 'STANDARD_RETAIL' CHECK \(rate_type = 'STANDARD_RETAIL'\)" 'WP7 must be constrained to standard retail rate only'
Assert-Contains $v8Sql "approved_by_account_id IS NULL OR approved_by_account_id <> requested_by_account_id" 'WP7 requester and approver must use different accounts'
Assert-Contains $v8Sql "external_execution_allowed\s+BOOLEAN NOT NULL DEFAULT FALSE CHECK \(NOT external_execution_allowed\)" 'WP7 external write must remain fail-closed before formal authorization and write UAT'
Assert-Contains $v8Sql "planned_business_days\s+INTEGER NOT NULL DEFAULT 7 CHECK \(planned_business_days = 7\)" 'WP8 all-store UAT must require seven business days'
Assert-Contains $v8Sql "success_rate_percent >= 99" 'WP8 release gate must require at least 99 percent collection success'
Assert-Contains $v8Sql "(?s)CREATE VIEW ota\.anomaly_first_dashboard.*?WITH \(security_invoker = true\).*?CASE alert\.severity WHEN 'P1' THEN 1 WHEN 'P2' THEN 2 ELSE 3 END" 'WP4 anomaly-first dashboard must be RLS-invoker and severity ordered'
Assert-Contains $v8Sql "Missing operating facts are not synthesized as numeric zero" 'WP4 must preserve missing data rather than report zero'
Assert-NotContains $v8Sql '(?im)^\s*(password|refresh_token|access_token|cookie|webhook_url|secret_value|authorization_header)\s+(TEXT|VARCHAR|CHAR|JSONB?|BYTEA)\b' 'Final-stage tables must not persist raw credential material'
Assert-Contains $grantSql 'GRANT SELECT, INSERT ON TABLE ota\.connector_access_authorization_draft' 'API authorization-draft grant is missing'
Assert-Contains $grantSql 'GRANT SELECT, INSERT ON TABLE ota\.credential_migration_rehearsal' 'API migration-rehearsal grant is missing'
Assert-NotContains $grantSql 'GRANT (UPDATE|DELETE).*ON TABLE ota\.(connector_access_authorization_draft|credential_migration_rehearsal)' 'WP2 append-only metadata must not receive UPDATE/DELETE grants'
Assert-NotContains $grantSql 'GRANT (SELECT|INSERT|UPDATE|DELETE).*ON TABLE ota\.(connector_access_authorization_draft|credential_migration_rehearsal) TO .*worker' 'Worker must not access WP2 preparation metadata'
Assert-NotContains $grantSql 'GRANT (INSERT|UPDATE|DELETE).*ON TABLE ota\.(data_retention_policy_version|hotel_ai_policy_version|price_change_preview|price_change_request|price_change_event|all_store_uat_run|hotel_release_decision) TO .*worker' 'Worker must not control retention, AI policy, pricing approvals or release decisions'

Assert-Contains $v3Sql "(?ims)^CREATE TABLE control\.service_principal_database_role_binding\s*\(.*?service_principal_id UUID PRIMARY KEY\s+REFERENCES control\.service_principal.*?database_role_name NAME NOT NULL UNIQUE" 'Sprint 2A database-role/service-principal one-to-one binding is missing'
Assert-Contains $v3Sql "(?ims)^CREATE FUNCTION control\.current_bound_service_principal_id\(\).*?SECURITY DEFINER\s+SET search_path = pg_catalog.*?database_role_name = session_user::NAME.*?principal\.status = 'ACTIVE'" 'Current-session principal resolver must use session_user and require ACTIVE'
Assert-Contains $v3Sql "(?ims)^CREATE FUNCTION control\.assert_session_service_principal\(.*?SECURITY DEFINER\s+SET search_path = pg_catalog.*?database_role_name = session_user::NAME.*?principal\.service_principal_id = p_service_principal_id.*?principal\.status = 'ACTIVE'.*?principal\.purpose = ANY" 'Private session/principal assertion is incomplete'
Assert-Contains $v3Sql "(?ims)^ALTER TABLE control\.ota_job_registry\s+DROP CONSTRAINT IF EXISTS ota_job_registry_scheduled_for_check;.*?ADD CONSTRAINT ota_job_registry_scheduled_slot_check CHECK \(\s*scheduled_for = date_trunc\('minute', scheduled_for\).*?job_type <> 'SIMULATION_PIPELINE'.*?date_trunc\('hour', scheduled_for\).*?trigger_type <> 'HOURLY_CUTOFF'.*?date_trunc\('hour', scheduled_for\)" 'Sprint 2A must permit exact-minute collection slots while keeping simulation/hourly-cutoff jobs on the hour'
Assert-Contains $v3Sql "(?ims)^ALTER TABLE ota\.connector_collection_run\s+DROP CONSTRAINT IF EXISTS connector_collection_run_cutoff_at_check;.*?ADD CONSTRAINT connector_collection_run_cutoff_slot_check CHECK \(\s*scheduled_for = date_trunc\('minute', scheduled_for\).*?cutoff_at = date_trunc\('minute', cutoff_at\).*?trigger_type NOT IN \('HOURLY_CUTOFF', 'MANUAL_SIMULATION'\).*?scheduled_for = date_trunc\('hour', scheduled_for\).*?cutoff_at = date_trunc\('hour', cutoff_at\)" 'Collection runs must accept exact-minute normal/file cutoffs while keeping hourly/simulation runs on the hour'
Assert-Contains $v3Sql "(?ims)^ALTER TABLE ota\.connector_collection_schedule\s+ADD CONSTRAINT connector_collection_schedule_exact_interval_check CHECK \(.*?trigger_type NOT IN \('NORMAL', 'FILE_IMPORT'\).*?date_trunc\('minute', next_due_at\).*?interval_minutes::BIGINT \* 60" 'Normal/file schedules must align to exact configured minute intervals'
Assert-Contains $v3Sql "(?ims)^CREATE OR REPLACE FUNCTION control\.dispatch_due_ota_jobs\(.*?scheduled_slot := CASE\s+WHEN schedule_row\.scheduled_trigger_type = 'HOURLY_CUTOFF'.*?date_trunc\('hour', schedule_row\.scheduled_next_due_at\)\s+ELSE schedule_row\.scheduled_next_due_at.*?\$\$;" 'Dispatcher must retain 5/15/30-minute slots and truncate only hourly cutoffs'
Assert-Contains $v3Sql "(?ims)^CREATE OR REPLACE FUNCTION control\.dispatch_due_ota_jobs\(.*?ARRAY\['SCHEDULER', 'CONNECTOR_WORKER'\]::TEXT\[\].*?extract\(EPOCH FROM scheduled_slot\)::BIGINT::TEXT.*?\$\$;" 'Dispatcher must allow the merged scheduler/worker model and derive stable job IDs from timezone-independent epoch slots'
Assert-NotContains $v3Sql "(?ims)^CREATE OR REPLACE FUNCTION control\.dispatch_due_ota_jobs\(.*?scheduled_slot::TEXT.*?\$\$;" 'Dispatcher stable job IDs must not depend on the PostgreSQL TimeZone rendering'
Assert-NotContains $v3Sql "(?ims)^CREATE OR REPLACE FUNCTION control\.dispatch_due_ota_jobs\(.*?(secret_ref|non_secret_config|normalized_payload|frozen_payload).*?\$\$;" 'Sprint 2A dispatcher must not expose configuration, payload or Secret material'

foreach ($function in @(
    'dispatch_due_ota_jobs', 'claim_ota_job',
    'renew_ota_job_lease', 'complete_ota_job'
)) {
    Assert-Contains $v3Sql "(?ims)^CREATE OR REPLACE FUNCTION control\.$function\(.*?SECURITY DEFINER\s+SET search_path = pg_catalog.*?control\.assert_session_service_principal\(.*?\$\$;" "Sprint 2A control.$function must enforce the session principal binding"
}
foreach ($function in @(
    'claim_ota_job', 'renew_ota_job_lease', 'complete_ota_job'
)) {
    Assert-Contains $v3Sql "(?ims)^CREATE OR REPLACE FUNCTION control\.$function\(.*?ARRAY\['CONNECTOR_WORKER'\]::TEXT\[\].*?\$\$;" "Sprint 2A control.$function must accept only a CONNECTOR_WORKER principal"
    Assert-NotContains $v3Sql "(?ims)^CREATE OR REPLACE FUNCTION control\.$function\(.*?ARRAY\['SCHEDULER', 'CONNECTOR_WORKER'\].*?\$\$;" "Sprint 2A control.$function must not allow a SCHEDULER principal to lease or finish work"
}

Assert-Contains $v3Sql '(?im)^REVOKE ALL ON TABLE control\.service_principal_database_role_binding FROM PUBLIC;' 'Binding table must revoke PUBLIC access'
Assert-Contains $v3Sql '(?im)^REVOKE ALL ON FUNCTION control\.current_bound_service_principal_id\(\) FROM PUBLIC;' 'Session principal resolver must revoke PUBLIC execute'
Assert-Contains $v3Sql '(?im)^REVOKE ALL ON FUNCTION control\.assert_session_service_principal\(UUID, TEXT\[\]\) FROM PUBLIC;' 'Private session assertion must revoke PUBLIC execute'

$topLevelInserts = [regex]::Matches(
    $v2Sql,
    '(?m)^INSERT INTO\s+(?<table>(control|ota)\.[a-z0-9_]+)'
)
if ($topLevelInserts.Count -ne 1 -or
    $topLevelInserts[0].Groups['table'].Value -ne 'control.connector_adapter_registry') {
    $failures.Add('V2 top-level seed must contain only the reviewed mock adapter registry statement')
}
foreach ($seedPair in @(
    "'MOCK_PMS', 'PMS'",
    "'MOCK_CTRIP', 'CTRIP'",
    "'MOCK_MEITUAN', 'MEITUAN'",
    "'FILE_FIXTURE', 'OFFICIAL_EXPORT'"
)) {
    Assert-Contains $v2Sql ([regex]::Escape($seedPair)) "Missing or mismatched adapter seed: $seedPair"
}

$v4TopLevelInserts = [regex]::Matches(
    $v4Sql,
    '(?m)^INSERT INTO\s+(?<table>(control|ota)\.[a-z0-9_]+)'
)
if ($v4TopLevelInserts.Count -ne 1 -or
    $v4TopLevelInserts[0].Groups['table'].Value -ne 'control.connector_adapter_registry') {
    $failures.Add('V4 top-level seed must contain only the reviewed inert intake adapter registry statement')
}
foreach ($seedPair in @(
    "'PMS_INTAKE',",
    "'CTRIP_INTAKE',",
    "'MEITUAN_INTAKE',"
)) {
    Assert-Contains $v4Sql ([regex]::Escape($seedPair)) "Missing intake adapter seed: $seedPair"
}

Assert-Contains $v2Sql "(?ims)^CREATE UNIQUE INDEX uq_ota_job_collection_slot.*?WHERE simulation_run_id IS NULL;" 'Ordinary collection slot idempotency index is missing'
Assert-Contains $v2Sql "(?ims)^CREATE UNIQUE INDEX uq_ota_job_simulation_slot.*?simulation_run_id.*?WHERE simulation_run_id IS NOT NULL;" 'Per-simulation slot idempotency index is missing'
Assert-Contains $v2Sql "(?ims)^CREATE UNIQUE INDEX uq_collection_run_collection_slot\s+ON ota\.connector_collection_run\(\s*tenant_id,\s*hotel_id,\s*connector_id,\s*stream_code,\s*trigger_type,\s*scheduled_for\s*\)\s*WHERE simulation_run_id IS NULL;" 'Ordinary collection-run slot idempotency index is missing'
Assert-Contains $v2Sql "(?ims)^CREATE UNIQUE INDEX uq_collection_run_simulation_slot\s+ON ota\.connector_collection_run\(\s*tenant_id,\s*hotel_id,\s*connector_id,\s*stream_code,\s*trigger_type,\s*scheduled_for,\s*simulation_run_id\s*\)\s*WHERE simulation_run_id IS NOT NULL;" 'Per-simulation collection-run slot idempotency index is missing'
Assert-NotContains $v2Sql "(?ims)UNIQUE\s*\(\s*tenant_id,\s*hotel_id,\s*connector_id,\s*stream_code,\s*trigger_type,\s*scheduled_for\s*\)" 'Collection-run table-level uniqueness would collapse distinct simulation runs'
Assert-Contains $v2Sql "(?ims)^CREATE TABLE control\.ota_job_registry.*?available_at TIMESTAMPTZ NOT NULL" 'Job retry availability timestamp is missing'
Assert-Contains $v2Sql "(?ims)^CREATE FUNCTION control\.complete_ota_job\(.*?available_at = CASE" 'Retry must move available_at'
Assert-NotContains $v2Sql "(?ims)^CREATE FUNCTION control\.complete_ota_job\(.*?scheduled_for = CASE" 'Retry must not mutate the immutable scheduled slot'
Assert-Contains $v2Sql "(?ims)^CREATE FUNCTION control\.renew_ota_job_lease\(.*?FROM control\.service_principal principal.*?principal\.status = 'ACTIVE'.*?\$\$;" 'Lease renewal must reject a disabled service principal'
Assert-Contains $v2Sql "(?ims)^CREATE FUNCTION control\.complete_ota_job\(.*?FROM control\.service_principal principal.*?principal\.status = 'ACTIVE'.*?\$\$;" 'Job completion must reject a disabled service principal'
Assert-Contains $v2Sql "(?ims)^CREATE TABLE ota\.inventory_observation_item.*?sellable_room_count INTEGER CHECK \(\s*sellable_room_count IS NULL OR sellable_room_count >= 0\s*\).*?item_quality_code = 'UNAVAILABLE'.*?sellable_room_count IS NULL" 'Unknown inventory must persist NULL under UNAVAILABLE quality'

Assert-Contains $v2Sql "(?ims)^CREATE FUNCTION control\.claim_ota_job\(.*?p_job_type TEXT.*?RETURNS TABLE\(.*?tenant_id UUID,.*?hotel_id UUID,.*?connector_id UUID,.*?simulation_run_id UUID,.*?run_id UUID,.*?scheduled_for TIMESTAMPTZ,.*?lease_expires_at TIMESTAMPTZ,.*?attempt_count INTEGER,.*?max_attempts INTEGER.*?\).*?SECURITY DEFINER\s+SET search_path = pg_catalog" 'Job claim function must accept an allowed job type and return retry counters under a fixed search path'
Assert-Contains $v2Sql "(?ims)^CREATE FUNCTION control\.claim_ota_job\(.*?candidate\.job_type = p_job_type.*?\$\$;" 'Job claim function must filter candidates by the requested job type'
Assert-Contains $v2Sql "(?ims)^CREATE FUNCTION control\.dispatch_due_ota_jobs\(.*?p_scheduler_service_principal_id UUID.*?p_now TIMESTAMPTZ.*?p_batch_limit INTEGER.*?RETURNS TABLE\(.*?tenant_id UUID,.*?hotel_id UUID,.*?schedule_id UUID,.*?scheduled_for TIMESTAMPTZ,.*?created_now BOOLEAN.*?\).*?SECURITY DEFINER\s+SET search_path = pg_catalog" 'Dynamic schedule dispatcher must expose only narrow job metadata under a fixed search path'
Assert-Contains $v2Sql "(?ims)^CREATE FUNCTION control\.dispatch_due_ota_jobs\(.*?schedule\.next_due_at <= p_now.*?schedule\.trigger_type IN \('NORMAL', 'HOURLY_CUTOFF', 'FILE_IMPORT'\).*?FOR UPDATE OF schedule SKIP LOCKED.*?ON CONFLICT \(tenant_id, hotel_id, schedule_id, scheduled_for\).*?WHERE simulation_run_id IS NULL.*?next_due_at = schedule_row\.scheduled_next_due_at.*?make_interval.*?\$\$;" 'Dynamic schedule dispatcher must lock due configuration rows, enqueue idempotently and advance next_due_at'
Assert-NotContains $v2Sql "(?ims)^CREATE FUNCTION control\.dispatch_due_ota_jobs\(.*?(secret_ref|non_secret_config|normalized_payload|frozen_payload).*?\$\$;" 'Dynamic schedule dispatcher must not return or copy configuration, payload or Secret material'
$claimReturn = [regex]::Match(
    $v2Sql,
    '(?ims)^CREATE FUNCTION control\.claim_ota_job\(.*?RETURNS TABLE\((?<columns>.*?)\)\s*LANGUAGE'
)
if (-not $claimReturn.Success -or $claimReturn.Groups['columns'].Value -match '(secret|config|credential|token|cookie|endpoint|payload)') {
    $failures.Add('Job claim result leaks configuration or secret material')
}
Assert-Contains $v2Sql "(?ims)^CREATE FUNCTION control\.complete_ota_job\(.*?p_outcome_code NOT IN \('SUCCEEDED', 'RETRYABLE_FAILURE', 'TERMINAL_FAILURE'\)" 'Job completion outcome allowlist is missing'
Assert-Contains $v2Sql "(?ims)^CREATE TABLE control\.ota_job_registry.*?job_type = 'SIMULATION_PIPELINE'.*?simulation_run_id IS NOT NULL.*?stream_code = 'SIMULATION_PIPELINE'.*?trigger_type = 'MANUAL_SIMULATION'" 'Simulation job identity/linkage constraint is missing'

foreach ($function in @(
    'create_tenant_directory_entry', 'enqueue_ota_job', 'dispatch_due_ota_jobs', 'claim_ota_job',
    'renew_ota_job_lease', 'complete_ota_job'
)) {
    Assert-Contains $v2Sql "(?ims)^CREATE FUNCTION control\.$function\(.*?SECURITY DEFINER\s+SET search_path = pg_catalog" "control.$function must pin SECURITY DEFINER search_path"
}
Assert-Contains $v2Sql "(?ims)^CREATE FUNCTION control\.create_tenant_directory_entry\(.*?ON CONFLICT ON CONSTRAINT tenant_directory_pkey DO NOTHING;.*?\$\$;" 'Tenant creation must avoid PL/pgSQL output-column ambiguity in ON CONFLICT'
Assert-NotContains $v2Sql "(?ims)^CREATE FUNCTION control\.create_tenant_directory_entry\(.*?ON CONFLICT \(tenant_id\) DO NOTHING;.*?\$\$;" 'Tenant creation must not use an ambiguous tenant_id conflict target'

Assert-Contains $v2Sql '(?im)^REVOKE ALL ON ALL TABLES IN SCHEMA control FROM PUBLIC;' 'Missing Sprint 1 control PUBLIC table revoke'
Assert-Contains $v2Sql '(?im)^REVOKE ALL ON ALL TABLES IN SCHEMA ota FROM PUBLIC;' 'Missing Sprint 1 ota PUBLIC table revoke'
Assert-Contains $v2Sql '(?im)^REVOKE ALL ON ALL FUNCTIONS IN SCHEMA control FROM PUBLIC;' 'Missing Sprint 1 control PUBLIC function revoke'

$moneyColumns = [regex]::Matches(
    $v2Sql,
    '(?im)^\s*(?<name>[a-z0-9_]*(amount|revenue|adr))\s+(?<type>[A-Z]+(?:\([^)]+\))?)'
)
foreach ($column in $moneyColumns) {
    if (-not $column.Groups['type'].Value.StartsWith('NUMERIC')) {
        $failures.Add("Money column $($column.Groups['name'].Value) must use NUMERIC")
    }
}

Assert-NotContains $v1Sql '(?im)^\s*CREATE\s+(USER|ROLE)\b' 'V1 must not create production roles/users'
Assert-NotContains $v2Sql '(?im)^\s*CREATE\s+(USER|ROLE)\b' 'V2 must not create production roles/users'
Assert-NotContains $v3Sql '(?im)^\s*CREATE\s+(USER|ROLE)\b' 'V3 must not create production roles/users'
Assert-NotContains $v4Sql '(?im)^\s*CREATE\s+(USER|ROLE)\b' 'V4 must not create production roles/users'
Assert-NotContains $v5Sql '(?im)^\s*CREATE\s+(USER|ROLE)\b' 'V5 must not create production roles/users'
Assert-NotContains $v6Sql '(?im)^\s*CREATE\s+(USER|ROLE)\b' 'V6 must not create production roles/users'
Assert-NotContains $v7Sql '(?im)^\s*CREATE\s+(USER|ROLE)\b' 'V7 must not create production roles/users'
Assert-NotContains $v2Sql '(?im)^\s*(DROP|TRUNCATE)\s+' 'V2 must be forward-only and non-destructive'
Assert-NotContains $v3Sql '(?im)^\s*(DROP\s+(TABLE|SCHEMA|COLUMN)|TRUNCATE)\s+' 'V3 must be forward-only and must not remove stored data'
Assert-NotContains $v4Sql '(?im)^\s*(DROP\s+(TABLE|SCHEMA|COLUMN)|TRUNCATE)\s+' 'V4 must be forward-only and must not remove stored data'
Assert-NotContains $v5Sql '(?im)^\s*(DROP\s+(TABLE|SCHEMA|COLUMN)|TRUNCATE)\s+' 'V5 must be forward-only and must not remove stored data'
Assert-NotContains $v6Sql '(?im)^\s*(DROP\s+(TABLE|SCHEMA|COLUMN)|TRUNCATE)\s+' 'V6 must be forward-only and must not remove stored data'
Assert-NotContains $v7Sql '(?im)^\s*(DROP\s+(TABLE|SCHEMA|COLUMN)|TRUNCATE)\s+' 'V7 must be forward-only and must not remove stored data'

if ($failures.Count -gt 0) {
    $formatted = $failures | ForEach-Object { " - $_" }
    throw "OTA migration structure verification failed:`n$($formatted -join "`n")"
}

Write-Output (
    "PASS: $($requiredControlTables.Count) control tables, " +
    "$($expectedTenantTables.Count) FORCE-RLS tenant tables, " +
    "$($sprint0AppendOnly.Count + $sprint1AppendOnly.Count + 10) append-only guards, " +
    "session-bound job SECURITY DEFINER functions, exact-minute collection slots, " +
        "configuration-only intake, trusted contract governance, offline authorization rehearsal, WP2 binding preparation, WP3-WP8 fail-closed final stage, blue/green identity gates, and UAT-only delivery verified through V8."
)
