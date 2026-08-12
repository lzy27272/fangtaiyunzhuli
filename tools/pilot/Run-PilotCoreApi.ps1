[CmdletBinding()]
param(
    [string]$RuntimeRoot = 'D:\SifangguanHotelAIOS',
    [int]$Port = 18080
)

$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$secretFile = Join-Path ([IO.Path]::GetFullPath($RuntimeRoot)) 'Secrets\pilot-uat.env'
if (-not (Test-Path -LiteralPath $secretFile)) { throw "Pilot secret file does not exist: $secretFile" }
foreach ($line in Get-Content -LiteralPath $secretFile -Encoding UTF8) {
    $trimmed = $line.Trim()
    if (-not $trimmed -or $trimmed.StartsWith('#')) { continue }
    $pair = $trimmed.Split('=', 2)
    Set-Item -Path "Env:$($pair[0])" -Value $pair[1]
}

$java = Get-ChildItem -LiteralPath (Join-Path $repoRoot '.tooling\jdk') -Filter java.exe -Recurse | Select-Object -First 1
$jar = Get-ChildItem -LiteralPath (Join-Path $repoRoot 'apps\core-api\target') -Filter 'hotel-ai-os-core-api-*.jar' |
    Where-Object Name -NotLike '*.original' | Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not $java -or -not $jar) { throw 'Java or Core API JAR is missing.' }

$env:DB_URL = "jdbc:postgresql://127.0.0.1:$($env:PILOT_DB_PORT)/$($env:PILOT_DB_NAME)"
$env:DB_USERNAME = $env:PILOT_DB_RUNTIME_USER
$env:DB_PASSWORD = $env:PILOT_DB_RUNTIME_PASSWORD
$env:DB_MIGRATION_USERNAME = $env:PILOT_DB_OWNER
$env:DB_MIGRATION_PASSWORD = $env:PILOT_DB_OWNER_PASSWORD
$env:DB_POOL_SIZE = '12'
$env:PORT = [string]$Port
$env:SERVER_ADDRESS = '127.0.0.1'
$env:DEV_HEADER_AUTH_ENABLED = 'false'
$env:LOCAL_LOGIN_ENABLED = 'true'
$env:LOCAL_LOGIN_SECRET = $env:PILOT_LOCAL_JWT_SECRET
$env:LOCAL_LOGIN_ISSUER = 'hotel-ai-os-pilot'
$env:LOCAL_LOGIN_TOKEN_TTL_HOURS = '8'
$env:DB_RLS_ENABLED = 'true'
$env:AUTOMATION_WORKER_ENABLED = 'true'
$env:AUTOMATION_WORKER_TENANT_IDS = '10000000-0000-0000-0000-000000000001'
$env:WORK_EXPECTATION_SLA_SCHEDULER_ENABLED = 'true'
$env:WORK_EXPECTATION_SLA_TENANT_IDS = '10000000-0000-0000-0000-000000000001'
$env:KPI_OTA_SNAPSHOT_PATH = Join-Path $repoRoot '.uat-runtime\ota-review\live-report-snapshots.json'
$env:KPI_OTA_HOTEL_DIRECTORY_PATH = Join-Path $repoRoot '.uat-runtime\ota-review\simulation-hotels.json'
$env:KPI_OTA_ALLOWED_TENANT_CODE = '001'
$env:KPI_PMS_MONTHLY_SUMMARY_PATH = Join-Path $repoRoot '.uat-runtime\ota-review\kpi-monthly-pms-summaries.json'
$env:ATTACHMENT_STORAGE_ROOT = Join-Path ([IO.Path]::GetFullPath($RuntimeRoot)) 'Data\Attachments'
$env:ATTACHMENT_SCAN_COMMAND_PATH = Join-Path $PSHOME 'powershell.exe'
$env:ATTACHMENT_SCAN_COMMAND_ARGUMENTS = "-NoProfile|-NonInteractive|-ExecutionPolicy|Bypass|-File|$(Join-Path $repoRoot 'tools\uat\Invoke-AmsiFileScan.ps1')|-Path|{file}"
$env:ATTACHMENT_SCAN_ALLOW_SANITIZED_IMAGE_FALLBACK = 'true'
$env:WEB_ALLOWED_ORIGINS = 'https://www.sfgzt.cn'
$env:LOGGING_FILE_NAME = Join-Path ([IO.Path]::GetFullPath($RuntimeRoot)) 'Logs\core-api.log'

if ([string]::IsNullOrWhiteSpace($env:LOCAL_LOGIN_SECRET)) {
    throw 'PILOT_LOCAL_JWT_SECRET is missing from the protected Pilot secret file.'
}

& $java.FullName -jar $jar.FullName
exit $LASTEXITCODE
