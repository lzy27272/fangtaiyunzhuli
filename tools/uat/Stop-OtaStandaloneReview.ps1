[CmdletBinding()]
param(
    [ValidateRange(0, 86400)]
    [int]$DelaySeconds = 0
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

if ($DelaySeconds -gt 0) {
    Start-Sleep -Seconds $DelaySeconds
}

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$statePath = Join-Path $repoRoot '.uat-runtime\ota-review\state.json'
if (-not (Test-Path -LiteralPath $statePath -PathType Leaf)) {
    exit 0
}

$state = Get-Content -LiteralPath $statePath -Raw -Encoding utf8 |
    ConvertFrom-Json
$expected = @(
    @{
        Pid = [int]$state.apiPid
        Pattern = 'ota-standalone-review-api\.mjs'
        ProcessName = 'node'
    },
    @{
        Pid = [int]$state.webPid
        Pattern = 'vite\.js.+--port\s+\d+'
        ProcessName = 'node'
    }
)

foreach ($entry in $expected) {
    $process = Get-Process -Id $entry.Pid -ErrorAction SilentlyContinue
    if (-not $process) {
        continue
    }
    $matchesExpectedProcess = $false
    try {
        $details = Get-CimInstance `
            -ClassName Win32_Process `
            -Filter ("ProcessId={0}" -f $entry.Pid)
        $matchesExpectedProcess = (
            $details -and
            [string]$details.CommandLine -match $entry.Pattern
        )
    }
    catch [Microsoft.Management.Infrastructure.CimException] {
        $expectedStart = [DateTimeOffset]::Parse([string]$state.startedAt)
        $actualStart = [DateTimeOffset]$process.StartTime
        $startDifference = [Math]::Abs(
            ($actualStart - $expectedStart).TotalMinutes
        )
        $matchesExpectedProcess = (
            $process.ProcessName -eq $entry.ProcessName -and
            $startDifference -le 2
        )
    }
    if (-not $matchesExpectedProcess) {
        continue
    }
    Stop-Process -Id $entry.Pid -Force
}

if ($DelaySeconds -eq 0 -and $state.watchdogPid) {
    $watchdog = Get-Process `
        -Id ([int]$state.watchdogPid) `
        -ErrorAction SilentlyContinue
    if ($watchdog -and $watchdog.ProcessName -eq 'powershell') {
        $expectedStart = [DateTimeOffset]::Parse([string]$state.startedAt)
        $actualStart = [DateTimeOffset]$watchdog.StartTime
        if (
            [Math]::Abs(
                ($actualStart - $expectedStart).TotalMinutes
            ) -le 2
        ) {
            Stop-Process -Id $watchdog.Id -Force
        }
    }
}

$updated = [ordered]@{}
foreach ($property in $state.PSObject.Properties) {
    $updated[$property.Name] = $property.Value
}
$updated['status'] = 'STOPPED'
$updated['stoppedAt'] = [DateTimeOffset]::Now.ToString('o')
[IO.File]::WriteAllText(
    $statePath,
    ($updated | ConvertTo-Json) + [Environment]::NewLine,
    [Text.UTF8Encoding]::new($false)
)
