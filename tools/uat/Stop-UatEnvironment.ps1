[CmdletBinding()]
param(
    [switch]$StopDatabase,
    [switch]$RemoveDatabase,
    [switch]$Force
)

$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$stateFile = Join-Path $repoRoot 'docs\uat\evidence\runtime\uat-processes.json'
$stopFile = Join-Path $repoRoot 'docs\uat\evidence\runtime\stop-live-server.flag'
$tokenFile = Join-Path $repoRoot '.uat-runtime\identity\tokens.json'
$composeFile = Join-Path $repoRoot 'infra\uat\docker-compose.yml'
$envFile = Join-Path $repoRoot 'infra\uat\.env'

if (Test-Path -LiteralPath $stateFile) {
    $state = Get-Content -LiteralPath $stateFile -Encoding UTF8 -Raw | ConvertFrom-Json
    if ($state.environmentType -eq 'embedded-postgresql' -and $state.apiPid) {
        [System.IO.File]::WriteAllText($stopFile, 'stop', [System.Text.UTF8Encoding]::new($false))
        $deadline = (Get-Date).AddSeconds(60)
        do {
            $apiProcess = Get-Process -Id $state.apiPid -ErrorAction SilentlyContinue
            if (-not $apiProcess) { break }
            Start-Sleep -Milliseconds 500
        } while ((Get-Date) -lt $deadline)
        if ($apiProcess) {
            Stop-Process -Id $state.apiPid -Force
            Write-Warning 'Embedded UAT API did not stop after exporting evidence and was terminated.'
        } else {
            Write-Host 'Embedded UAT API stopped after exporting database evidence.'
        }
    }
    $processIds = if ($state.environmentType -eq 'embedded-postgresql') {
        @($state.webPid, $state.oidcPid)
    } else {
        @($state.apiPid, $state.webPid, $state.oidcPid)
    }
    foreach ($processId in $processIds) {
        if (-not $processId) { continue }
        $process = Get-Process -Id $processId -ErrorAction SilentlyContinue
        if ($process) {
            Stop-Process -Id $processId
            Write-Host "Stopped process $processId ($($process.ProcessName))."
        }
    }
}

if (Test-Path -LiteralPath $tokenFile) {
    Remove-Item -LiteralPath $tokenFile -Force
    Write-Host 'Removed ephemeral UAT bearer tokens from the ignored runtime directory.'
}

if ($RemoveDatabase -and -not $Force) {
    throw 'RemoveDatabase deletes the disposable hotel-ai-os-uat-postgres volume. Re-run with -Force.'
}

if ($StopDatabase -or $RemoveDatabase) {
    $docker = (Get-Command docker -ErrorAction Stop).Source
    $args = @('compose', '--env-file', $envFile, '-f', $composeFile, 'down', '--remove-orphans')
    if ($RemoveDatabase) { $args += '--volumes' }
    & $docker @args
    if ($LASTEXITCODE -ne 0) { throw 'Failed to stop the UAT compose project.' }
}
