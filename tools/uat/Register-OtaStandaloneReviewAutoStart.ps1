[CmdletBinding()]
param(
    [string]$TaskName = 'SiFangGuan-OTA-Standalone-AutoStart'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$watchScript = Join-Path $PSScriptRoot 'Watch-OtaStandaloneReview.ps1'
if (-not (Test-Path -LiteralPath $watchScript -PathType Leaf)) {
    throw 'OTA_REVIEW_WATCH_SCRIPT_NOT_FOUND'
}

$currentIdentity = [Security.Principal.WindowsIdentity]::GetCurrent().Name
$powerShellPath = Join-Path $PSHOME 'powershell.exe'
$actionArguments = (
    '-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "{0}"' -f
    $watchScript
)
$action = New-ScheduledTaskAction `
    -Execute $powerShellPath `
    -Argument $actionArguments `
    -WorkingDirectory $repoRoot
$trigger = New-ScheduledTaskTrigger `
    -AtLogOn `
    -User $currentIdentity
$principal = New-ScheduledTaskPrincipal `
    -UserId $currentIdentity `
    -LogonType Interactive `
    -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -StartWhenAvailable `
    -Hidden `
    -MultipleInstances IgnoreNew `
    -RestartCount 999 `
    -RestartInterval (New-TimeSpan -Minutes 1) `
    -ExecutionTimeLimit ([TimeSpan]::Zero)

$task = New-ScheduledTask `
    -Action $action `
    -Trigger $trigger `
    -Principal $principal `
    -Settings $settings `
    -Description (
        'SiFangGuan OTA local backend: logon autostart and recovery.'
    )
Register-ScheduledTask `
    -TaskName $TaskName `
    -InputObject $task `
    -Force | Out-Null
Start-ScheduledTask -TaskName $TaskName

[ordered]@{
    status = 'REGISTERED_AND_STARTED'
    taskName = $TaskName
    user = $currentIdentity
    trigger = 'AT_LOGON'
    monitorIntervalSeconds = 30
    restartIntervalSeconds = 60
} | ConvertTo-Json
