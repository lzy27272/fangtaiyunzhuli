[CmdletBinding()]
param(
    [string]$RuntimeRoot = 'D:\SifangguanHotelAIOS',
    [int]$ApiPort = 18080,
    [string]$DatabaseServiceName = 'SifangguanPostgreSQL'
)

$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$resolvedRuntimeRoot = [IO.Path]::GetFullPath($RuntimeRoot)
$secretFile = Join-Path $resolvedRuntimeRoot 'Secrets\pilot-uat.env'
if (-not (Test-Path -LiteralPath $secretFile)) { throw "Pilot secret file does not exist: $secretFile" }
foreach ($line in Get-Content -LiteralPath $secretFile -Encoding UTF8) {
    $trimmed = $line.Trim()
    if (-not $trimmed -or $trimmed.StartsWith('#')) { continue }
    $pair = $trimmed.Split('=', 2)
    Set-Item -Path "Env:$($pair[0])" -Value $pair[1]
}

$pgCtl = Join-Path $resolvedRuntimeRoot 'PostgreSQL\14.22\bin\pg_ctl.exe'
$dataRoot = Join-Path $resolvedRuntimeRoot 'Data\PostgreSQL'
$logRoot = Join-Path $resolvedRuntimeRoot 'Logs'
New-Item -ItemType Directory -Force -Path $logRoot | Out-Null
$databaseService = Get-Service -Name $DatabaseServiceName -ErrorAction SilentlyContinue
if ($databaseService) {
    if ($databaseService.Status -ne 'Running') {
        Start-Service -Name $DatabaseServiceName
        (Get-Service -Name $DatabaseServiceName).WaitForStatus('Running', [TimeSpan]::FromSeconds(60))
    }
} else {
    & $pgCtl status -D $dataRoot | Out-Null
    if ($LASTEXITCODE -ne 0) {
        & $pgCtl start -D $dataRoot -l (Join-Path $logRoot 'postgresql.log') -o "-p $($env:PILOT_DB_PORT)" -w
        if ($LASTEXITCODE -ne 0) { throw 'Unable to start Pilot PostgreSQL.' }
    }
}

$health = "http://127.0.0.1:$ApiPort/actuator/health"
$apiReady = $false
try { $apiReady = (Invoke-WebRequest -UseBasicParsing -Uri $health -TimeoutSec 3).StatusCode -eq 200 } catch { }
if (-not $apiReady) {
    $runner = Join-Path $repoRoot 'tools\pilot\Run-PilotCoreApi.ps1'
    Start-Process -FilePath (Join-Path $PSHOME 'powershell.exe') `
        -ArgumentList @('-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', ('"{0}"' -f $runner), '-RuntimeRoot', ('"{0}"' -f $resolvedRuntimeRoot), '-Port', $ApiPort) `
        -WorkingDirectory $repoRoot -RedirectStandardOutput (Join-Path $logRoot 'core-api-runner.stdout.log') `
        -RedirectStandardError (Join-Path $logRoot 'core-api-runner.stderr.log') -WindowStyle Hidden | Out-Null
}

$deadline = (Get-Date).AddSeconds(120)
do {
    try {
        if ((Invoke-WebRequest -UseBasicParsing -Uri $health -TimeoutSec 3).StatusCode -eq 200) {
            [pscustomobject]@{ PostgreSQL = 'Running'; CoreApi = 'UP'; ApiOrigin = "127.0.0.1:$ApiPort" }
            return
        }
    } catch { }
    Start-Sleep -Milliseconds 750
} while ((Get-Date) -lt $deadline)
throw 'Pilot Core API did not become healthy within 120 seconds.'
