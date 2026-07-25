[CmdletBinding()]
param(
    [string]$RuntimeRoot = 'D:\SifangguanHotelAIOS',
    [string]$RepoRoot = 'C:\Users\MSN\Documents\四方馆AI中台项目',
    [string]$ResultPath = 'C:\Users\MSN\Documents\四方馆AI中台项目\.uat-runtime\pilot\pilot6-deploy-result.json',
    [string]$CandidateJar = '',
    [string]$RollbackJar = ''
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
$deployedJar = [IO.Path]::GetFullPath((Join-Path $repo 'apps\core-api\target\hotel-ai-os-core-api-0.2.0-pilot.7.jar'))
if ([string]::IsNullOrWhiteSpace($CandidateJar)) {
    $CandidateJar = Join-Path $repo 'apps\core-api\target\hotel-ai-os-core-api-0.2.0-pilot.7-candidate.jar'
} elseif (-not [IO.Path]::IsPathRooted($CandidateJar)) {
    $CandidateJar = Join-Path $repo $CandidateJar
}
if ([string]::IsNullOrWhiteSpace($RollbackJar)) {
    $RollbackJar = $deployedJar
} elseif (-not [IO.Path]::IsPathRooted($RollbackJar)) {
    $RollbackJar = Join-Path $repo $RollbackJar
}
$candidateJar = [IO.Path]::GetFullPath($CandidateJar)
$rollbackJar = [IO.Path]::GetFullPath($RollbackJar)
$legacyJar = [IO.Path]::GetFullPath((Join-Path $repo 'apps\core-api\target\hotel-ai-os-core-api-0.1.0-SNAPSHOT.jar'))
$webDist = [IO.Path]::GetFullPath((Join-Path $repo 'apps\web\dist'))

if (-not $runtime.StartsWith('D:\SifangguanHotelAIOS', [StringComparison]::OrdinalIgnoreCase)) {
    throw 'Runtime root is outside the approved Pilot runtime directory.'
}
if (-not $databaseSource.StartsWith($runtime, [StringComparison]::OrdinalIgnoreCase)) {
    throw 'Database source escaped the approved runtime root.'
}
if ($candidateJar.Equals($deployedJar, [StringComparison]::OrdinalIgnoreCase)) {
    throw 'Candidate JAR must be separate from the standard deployed JAR.'
}
if ($candidateJar.Equals($rollbackJar, [StringComparison]::OrdinalIgnoreCase)) {
    throw 'Candidate JAR and rollback JAR must be different files.'
}
foreach ($required in @($databaseSource, $candidateJar, $rollbackJar, $webDist)) {
    if (-not (Test-Path -LiteralPath $required)) {
        throw "Required deployment input is missing: $required"
    }
}

New-Item -ItemType Directory -Force -Path $backupRoot | Out-Null
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$backup = [IO.Path]::GetFullPath((Join-Path $backupRoot "TECH-V0.2-PILOT.7-predeploy-$stamp"))
if (-not $backup.StartsWith($backupRoot, [StringComparison]::OrdinalIgnoreCase)) {
    throw 'Backup target escaped the approved backup root.'
}
if (Test-Path -LiteralPath $backup) {
    throw "Backup target already exists: $backup"
}

$result = @{
    status = 'STARTED'
    version = 'TECH-V0.2-PILOT.7'
    startedAt = (Get-Date).ToString('o')
    backupPath = $backup
    candidateJar = $candidateJar
    rollbackJar = $rollbackJar
    deployedJar = $deployedJar
    rollbackApplied = $false
}
Write-DeploymentResult $result

$coreApiTaskName = 'SifangguanPilotCoreApiUser'
$coreApiTask = $null
$coreApiTaskWasEnabled = $false
$artifactReplacementAttempted = $false
$rollbackBackup = Join-Path $backup 'hotel-ai-os-core-api-0.2.0-pilot.7.rollback.jar'

try {
    $coreApiTask = Get-ScheduledTask -TaskName $coreApiTaskName -ErrorAction SilentlyContinue
    if (-not $coreApiTask) {
        throw "Required Core API watchdog task is not installed: $coreApiTaskName"
    }
    $coreApiTaskWasEnabled = [bool]$coreApiTask.Settings.Enabled
    if (-not $coreApiTaskWasEnabled) {
        throw "Core API watchdog task is disabled before deployment: $coreApiTaskName"
    }

    New-Item -ItemType Directory -Path $backup | Out-Null

    # Quiesce the watchdog before stopping the API/database. Otherwise its
    # five-minute trigger can restart the runtime while the physical database
    # directory is being copied and make the backup inconsistent.
    Disable-ScheduledTask -TaskName $coreApiTaskName | Out-Null
    Stop-ScheduledTask -TaskName $coreApiTaskName -ErrorAction SilentlyContinue

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
    Copy-Item -LiteralPath $rollbackJar -Destination $rollbackBackup
    Copy-Item -LiteralPath $candidateJar -Destination (Join-Path $backup 'hotel-ai-os-core-api-0.2.0-pilot.7.candidate.jar')
    Copy-Item -LiteralPath $webDist -Destination (Join-Path $backup 'web-dist-pilot6-candidate') -Recurse

    $artifactReplacementAttempted = $true
    Copy-Item -LiteralPath $candidateJar -Destination $deployedJar -Force
    (Get-Item -LiteralPath $deployedJar).LastWriteTime = Get-Date

    Start-Service -Name 'SifangguanPostgreSQL'
    (Get-Service -Name 'SifangguanPostgreSQL').WaitForStatus('Running', [TimeSpan]::FromSeconds(60))

    Enable-ScheduledTask -TaskName $coreApiTaskName | Out-Null
    Start-ScheduledTask -TaskName $coreApiTaskName
    if (-not (Wait-HttpHealth -Uri 'http://127.0.0.1:18080/actuator/health')) {
        throw 'PILOT.7 Core API did not become healthy within 120 seconds.'
    }

    Start-Service -Name 'SifangguanPilot'
    (Get-Service -Name 'SifangguanPilot').WaitForStatus('Running', [TimeSpan]::FromSeconds(30))

    $apiConnection = Get-NetTCPConnection -LocalPort 18080 -State Listen | Select-Object -First 1
    $apiProcess = Get-CimInstance Win32_Process -Filter "ProcessId=$($apiConnection.OwningProcess)"
    if ($apiProcess.CommandLine -notmatch 'hotel-ai-os-core-api-0\.2\.0-pilot\.7\.jar') {
        throw 'Healthy API is not running the PILOT.7 JAR.'
    }

    $result.status = 'SUCCEEDED'
    $result.finishedAt = (Get-Date).ToString('o')
    $result.databaseFiles = (Get-ChildItem -LiteralPath (Join-Path $backup 'PostgreSQL') -Recurse -File).Count
    $result.attachmentFiles = if (Test-Path -LiteralPath (Join-Path $backup 'Attachments')) {
        (Get-ChildItem -LiteralPath (Join-Path $backup 'Attachments') -Recurse -File).Count
    } else { 0 }
    $result.coreApiPid = $apiConnection.OwningProcess
    $result.coreApiHealth = 'UP'
    $result.deployedJarSha256 = (Get-FileHash -LiteralPath $deployedJar -Algorithm SHA256).Hash
    $result.postgreSqlService = [string](Get-Service -Name 'SifangguanPostgreSQL').Status
    $result.webService = [string](Get-Service -Name 'SifangguanPilot').Status
    Write-DeploymentResult $result
} catch {
    $deploymentError = $_
    if ($artifactReplacementAttempted) {
        try {
            Disable-ScheduledTask -TaskName $coreApiTaskName -ErrorAction SilentlyContinue | Out-Null
            Stop-ScheduledTask -TaskName $coreApiTaskName -ErrorAction SilentlyContinue

            $rollbackConnection = Get-NetTCPConnection -LocalPort 18080 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
            if ($rollbackConnection) {
                $rollbackProcess = Get-CimInstance Win32_Process -Filter "ProcessId=$($rollbackConnection.OwningProcess)"
                if ($rollbackProcess.CommandLine -notmatch 'hotel-ai-os-core-api-.*\.jar') {
                    throw "Port 18080 owner is not the expected Core API process: $($rollbackConnection.OwningProcess)"
                }
                Stop-Process -Id $rollbackConnection.OwningProcess
                Wait-Process -Id $rollbackConnection.OwningProcess -Timeout 30 -ErrorAction SilentlyContinue
            }

            if (-not (Test-Path -LiteralPath $rollbackBackup)) {
                throw "Rollback JAR backup is missing: $rollbackBackup"
            }
            Copy-Item -LiteralPath $rollbackBackup -Destination $deployedJar -Force
            (Get-Item -LiteralPath $deployedJar).LastWriteTime = Get-Date
            $result.rollbackApplied = $true
            $result.rollbackJarSha256 = (Get-FileHash -LiteralPath $deployedJar -Algorithm SHA256).Hash
        } catch {
            $result.rollbackApplied = $false
            $result.rollbackError = $_.Exception.Message
        }
    }
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
    try {
        if ($coreApiTaskWasEnabled -and (-not $artifactReplacementAttempted -or $result.rollbackApplied)) {
            Enable-ScheduledTask -TaskName $coreApiTaskName | Out-Null
            Start-ScheduledTask -TaskName $coreApiTaskName
            Wait-HttpHealth -Uri 'http://127.0.0.1:18080/actuator/health' -TimeoutSeconds 120 | Out-Null
        }
    } catch {
    }
    $result.status = 'FAILED'
    $result.finishedAt = (Get-Date).ToString('o')
    $result.error = $deploymentError.Exception.Message
    Write-DeploymentResult $result
    throw
}
