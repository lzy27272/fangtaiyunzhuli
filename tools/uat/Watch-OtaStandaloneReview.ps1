[CmdletBinding()]
param(
    [ValidateRange(10, 300)]
    [int]$MonitorIntervalSeconds = 30
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$runtimeRoot = Join-Path $repoRoot '.uat-runtime\ota-review'
$logPath = Join-Path $runtimeRoot 'supervisor.log'
$ensureScript = Join-Path $PSScriptRoot 'Ensure-OtaStandaloneReview.ps1'
$consecutiveFailures = 0

New-Item -ItemType Directory -Path $runtimeRoot -Force | Out-Null
Add-Content `
    -LiteralPath $logPath `
    -Value (
        '{0} SUPERVISOR_STARTED pid={1}' -f
        [DateTimeOffset]::Now.ToString('o'),
        $PID
    ) `
    -Encoding utf8

while ($true) {
    try {
        & $ensureScript
        $consecutiveFailures = 0
        Start-Sleep -Seconds $MonitorIntervalSeconds
    }
    catch {
        $consecutiveFailures++
        $backoffSeconds = [Math]::Min(
            300,
            $MonitorIntervalSeconds * [Math]::Pow(
                2,
                [Math]::Min($consecutiveFailures - 1, 4)
            )
        )
        Add-Content `
            -LiteralPath $logPath `
            -Value (
                '{0} SUPERVISOR_RETRY failureCount={1} backoffSeconds={2}' -f
                [DateTimeOffset]::Now.ToString('o'),
                $consecutiveFailures,
                [int]$backoffSeconds
            ) `
            -Encoding utf8
        Start-Sleep -Seconds ([int]$backoffSeconds)
    }
}
