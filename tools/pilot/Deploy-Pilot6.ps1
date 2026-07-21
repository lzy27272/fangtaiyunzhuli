[CmdletBinding()]
param(
    [string]$RuntimeRoot = 'D:\SifangguanHotelAIOS',
    [string]$RepoRoot = 'C:\Users\MSN\Documents\四方馆AI中台项目',
    [string]$ResultPath = 'C:\Users\MSN\Documents\四方馆AI中台项目\.uat-runtime\pilot\pilot6-deploy-result.json'
)

$ErrorActionPreference = 'Stop'

function Wait-HttpHealth {
    param([string]$Uri, [int]$TimeoutSeconds = 120)
    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    do {
        Start-Sleep -Milliseconds 1000
        try {
            if ((Invoke-RestMethod -Uri $Uri -TimeoutSec 3).status -eq 'UP') {
                return $true
            }
        } catch {
        }
    } while ((Get-Date) -lt $deadline)
    return $false
}

function Write-DeploymentResult {
    param([hashtable]$Data)
    $resultDirectory = Split-Path -Parent $ResultPath
    New-Item -ItemType Directory -Force -Path $resultDirectory | Out-Null
    [IO.File]::WriteAllText($ResultPath, ($Data | ConvertTo-Json -Depth 5), [Text.UTF8Encoding]::new($false))
}

$runtime = [IO.Path]::GetFullPath($RuntimeRoot)
$repo = [IO.Path]::GetFullPath($RepoRoot)
$backupRoot = [IO.Path]::GetFullPath((Join-Path $runtime 'Backups'))
$databaseSource = [IO.Path]::GetFullPath((Join-Path $runtime 'Data\PostgreSQL'))
$attachmentsSource = [IO.Path]::GetFullPath((Join-Path $runtime 'Data\Attachments'))
$candidateJar = [IO.Path]::GetFullPath((Join-Path $repo 'apps\core-api\target\hotel-ai-os-core-api-0.2.0-pilot.6.jar'))
$legacyJar = [IO.Path]::GetFullPath((Join-Path $repo 'apps\core-api\target\hotel-ai-os-core-api-0.1.0-SNAPSHOT.jar'))
$webDist = [IO.Path]::GetFullPath((Join-Path $repo 'apps\web\dist'))

if (-not $runtime.StartsWith('D:\SifangguanHotelAIOS', [StringComparison]::OrdinalIgnoreCase)) {
    throw 'Runtime root is outside the approved Pilot runtime directory.'
}
if (-not $databaseSource.StartsWith($runtime, [StringComparison]::OrdinalIgnoreCase)) {
    throw 'Database source escaped the approved runtime root.'
}
foreach ($required in @($databaseSource, $candidateJar, $webDist)) {
    if (-not (Test-Path -LiteralPath $required)) {
        throw "Required deployment input is missing: $required"
    }
}

New-Item -ItemType Directory -Force -Path $backupRoot | Out-Null
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$backup = [IO.Path]::GetFullPath((Join-Path $backupRoot "TECH-V0.2-PILOT.6-predeploy-$stamp"))
if (-not $backup.StartsWith($backupRoot, [StringComparison]::OrdinalIgnoreCase)) {
    throw 'Backup target escaped the approved backup root.'
}
if (Test-Path -LiteralPath $backup) {
    throw "Backup target already exists: $backup"
}

$result = @{
    status = 'STARTED'
    version = 'TECH-V0.2-PILOT.6'
    startedAt = (Get-Date).ToString('o')
    backupPath = $backup
}
Write-DeploymentResult $result

try {
    New-Item -ItemType Directory -Path $backup | Out-Null

    $webService = Get-Service -Name 'SifangguanPilot'
    if ($webService.Status -eq 'Running') {
        Stop-Service -Name 'SifangguanPilot'
        (Get-Service -Name 'SifangguanPilot').WaitForStatus('Stopped', [TimeSpan]::FromSeconds(30))
    }

    $connection = Get-NetTCPConnection -LocalPort 18080 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($connection) {
        $process = Get-CimInstance Win32_Process -Filter "ProcessId=$($connection.OwningProcess)"
        if ($process.CommandLine -notmatch 'hotel-ai-os-core-api-.*\.jar') {
            throw "Port 18080 owner is not the expected Core API process: $($connection.OwningProcess)"
        }
        Stop-Process -Id $connection.OwningProcess
        Wait-Process -Id $connection.OwningProcess -Timeout 30 -ErrorAction SilentlyContinue
    }

    $databaseService = Get-Service -Name 'SifangguanPostgreSQL'
    if ($databaseService.Status -eq 'Running') {
        Stop-Service -Name 'SifangguanPostgreSQL'
        (Get-Service -Name 'SifangguanPostgreSQL').WaitForStatus('Stopped', [TimeSpan]::FromSeconds(60))
    }

    Copy-Item -LiteralPath $databaseSource -Destination (Join-Path $backup 'PostgreSQL') -Recurse
    if (Test-Path -LiteralPath $attachmentsSource) {
        Copy-Item -LiteralPath $attachmentsSource -Destination (Join-Path $backup 'Attachments') -Recurse
    }
    if (Test-Path -LiteralPath $legacyJar) {
        Copy-Item -LiteralPath $legacyJar -Destination (Join-Path $backup 'hotel-ai-os-core-api-0.1.0-SNAPSHOT.jar')
    }
    Copy-Item -LiteralPath $candidateJar -Destination (Join-Path $backup 'hotel-ai-os-core-api-0.2.0-pilot.6.candidate.jar')
    Copy-Item -LiteralPath $webDist -Destination (Join-Path $backup 'web-dist-pilot6-candidate') -Recurse

    Start-Service -Name 'SifangguanPostgreSQL'
    (Get-Service -Name 'SifangguanPostgreSQL').WaitForStatus('Running', [TimeSpan]::FromSeconds(60))

    Start-ScheduledTask -TaskName 'SifangguanPilotCoreApiUser'
    if (-not (Wait-HttpHealth -Uri 'http://127.0.0.1:18080/actuator/health')) {
        throw 'PILOT.6 Core API did not become healthy within 120 seconds.'
    }

    Start-Service -Name 'SifangguanPilot'
    (Get-Service -Name 'SifangguanPilot').WaitForStatus('Running', [TimeSpan]::FromSeconds(30))

    $apiConnection = Get-NetTCPConnection -LocalPort 18080 -State Listen | Select-Object -First 1
    $apiProcess = Get-CimInstance Win32_Process -Filter "ProcessId=$($apiConnection.OwningProcess)"
    if ($apiProcess.CommandLine -notmatch 'hotel-ai-os-core-api-0\.2\.0-pilot\.6\.jar') {
        throw 'Healthy API is not running the PILOT.6 JAR.'
    }

    $result.status = 'SUCCEEDED'
    $result.finishedAt = (Get-Date).ToString('o')
    $result.databaseFiles = (Get-ChildItem -LiteralPath (Join-Path $backup 'PostgreSQL') -Recurse -File).Count
    $result.attachmentFiles = if (Test-Path -LiteralPath (Join-Path $backup 'Attachments')) {
        (Get-ChildItem -LiteralPath (Join-Path $backup 'Attachments') -Recurse -File).Count
    } else { 0 }
    $result.coreApiPid = $apiConnection.OwningProcess
    $result.coreApiHealth = 'UP'
    $result.postgreSqlService = [string](Get-Service -Name 'SifangguanPostgreSQL').Status
    $result.webService = [string](Get-Service -Name 'SifangguanPilot').Status
    Write-DeploymentResult $result
} catch {
    try {
        if ((Get-Service -Name 'SifangguanPostgreSQL' -ErrorAction SilentlyContinue).Status -ne 'Running') {
            Start-Service -Name 'SifangguanPostgreSQL'
        }
    } catch {
    }
    try {
        if ((Get-Service -Name 'SifangguanPilot' -ErrorAction SilentlyContinue).Status -ne 'Running') {
            Start-Service -Name 'SifangguanPilot'
        }
    } catch {
    }
    $result.status = 'FAILED'
    $result.finishedAt = (Get-Date).ToString('o')
    $result.error = $_.Exception.Message
    Write-DeploymentResult $result
    throw
}
