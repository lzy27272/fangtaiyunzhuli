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
    },
    @{
        Pid = [int]$state.webPid
        Pattern = 'vite\.js.+--port\s+\d+'
    }
)

foreach ($entry in $expected) {
    $process = Get-Process -Id $entry.Pid -ErrorAction SilentlyContinue
    if (-not $process) {
        continue
    }
    $details = Get-CimInstance `
        -ClassName Win32_Process `
        -Filter ("ProcessId={0}" -f $entry.Pid)
    if (
        -not $details -or
        [string]$details.CommandLine -notmatch $entry.Pattern
    ) {
        continue
    }
    Stop-Process -Id $entry.Pid -Force
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
