[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$InputPath,

    [Parameter(Mandatory = $true)]
    [ValidateLength(1, 80)]
    [string]$HotelName,

    [Parameter(Mandatory = $true)]
    [ValidatePattern('^[a-fA-F0-9]{64}$')]
    [string]$ApprovedInputSha256,

    [Parameter(Mandatory = $true)]
    [ValidatePattern('^[a-fA-F0-9]{32}$')]
    [string]$RunId,

    [switch]$AllowTruncatedRootRecovery
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$wrapperPath = Join-Path `
    -Path $PSScriptRoot `
    -ChildPath 'Invoke-OtaJsonWeComUat.ps1'
$childPowerShell = Join-Path -Path $PSHOME -ChildPath 'powershell.exe'
$workspaceRoot = (
    Resolve-Path -LiteralPath (
        Join-Path -Path $PSScriptRoot -ChildPath '..\..\..'
    )
).Path
$runtimeRoot = Join-Path -Path $workspaceRoot -ChildPath '.uat-runtime\wecom'
$resultPath = Join-Path `
    -Path $runtimeRoot `
    -ChildPath ('interactive-uat-{0}.json' -f $RunId.ToLowerInvariant())

New-Item -ItemType Directory -Path $runtimeRoot -Force | Out-Null

$exitCode = 2
$finalStatus = 'FAILED'
$reasonCode = 'INTERACTIVE_UAT_NOT_STARTED'

function Write-RunMarker {
    $marker = [ordered]@{
        status = $finalStatus
        reasonCode = $reasonCode
        exitCode = $exitCode
        runId = $RunId.ToLowerInvariant()
        completedAt = [DateTimeOffset]::Now.ToString('o')
    }
    [IO.File]::WriteAllText(
        $resultPath,
        ($marker | ConvertTo-Json) + [Environment]::NewLine,
        [Text.UTF8Encoding]::new($false)
    )
}

try {
    Write-Host ''
    Write-Host '=== 企业微信真实 UAT：步骤 1/2，核对脱敏预览 ===' `
        -ForegroundColor Cyan
    & $childPowerShell `
        -NoProfile `
        -ExecutionPolicy Bypass `
        -File $wrapperPath `
        -InputPath $InputPath `
        -HotelName $HotelName
    if ($LASTEXITCODE -ne 0) {
        throw 'INTERACTIVE_UAT_DRY_RUN_FAILED'
    }

    $env:OTA_WECOM_UAT_SEND_ENABLED = 'true'

    Write-Host ''
    Write-Host '=== 步骤 2/2，输入 Webhook、确认指纹并发送 ===' `
        -ForegroundColor Yellow
    $sendArguments = @(
        '-NoProfile',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        $wrapperPath,
        '-InputPath',
        $InputPath,
        '-HotelName',
        $HotelName,
        '-InteractiveSend',
        '-ApprovedInputSha256',
        $ApprovedInputSha256
    )
    if ($AllowTruncatedRootRecovery) {
        $sendArguments += '-AllowTruncatedRootRecovery'
    }

    & $childPowerShell @sendArguments
    $exitCode = $LASTEXITCODE
    if ($exitCode -eq 0) {
        $finalStatus = 'COMPLETED'
        $reasonCode = 'INTERACTIVE_UAT_WRAPPER_EXITED_ZERO'
    }
    elseif ($exitCode -eq 5) {
        $finalStatus = 'ABORTED'
        $reasonCode = 'INTERACTIVE_UAT_OPERATOR_NOT_CONFIRMED'
    }
    else {
        $finalStatus = 'FAILED'
        $reasonCode = 'INTERACTIVE_UAT_SEND_PROCESS_FAILED'
    }
}
catch {
    $reasonCode = $_.Exception.Message
    if ($reasonCode -eq 'INTERACTIVE_UAT_OPERATOR_NOT_CONFIRMED') {
        $exitCode = 5
        $finalStatus = 'ABORTED'
    }
    else {
        $exitCode = 2
        $finalStatus = 'FAILED'
    }
    Write-Host ''
    Write-Host ("UAT未发送或未完成：{0}" -f $reasonCode) `
        -ForegroundColor Red
}
finally {
    foreach ($variableName in @(
        'OTA_WECOM_UAT_SEND_ENABLED',
        'WECOM_GROUP_ROBOT_ENDPOINT_SHA256',
        'WECOM_UAT_EXPECTED_HOTEL_NAME',
        'OTA_WECOM_UAT_APPROVED_INPUT_SHA256',
        'WECOM_GROUP_ROBOT_WEBHOOK',
        'OTA_WECOM_UAT_WRAPPER_NONCE'
    )) {
        [Environment]::SetEnvironmentVariable(
            $variableName,
            $null,
            'Process'
        )
    }
    Write-RunMarker
    Write-Host ''
    Write-Host ("本地结果标记：{0}" -f $resultPath)
    [void](Read-Host "可保留窗口核对结果；按 Enter 关闭.")
}

exit $exitCode
