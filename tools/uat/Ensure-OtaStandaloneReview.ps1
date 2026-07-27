[CmdletBinding()]
param(
    [int]$ApiPort = 8091,
    [int]$WebPort = 5180,
    [ValidateRange(1, 30)]
    [int]$HealthTimeoutSeconds = 5
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$runtimeRoot = Join-Path $repoRoot '.uat-runtime\ota-review'
$statePath = Join-Path $runtimeRoot 'state.json'
$logPath = Join-Path $runtimeRoot 'supervisor.log'
$startScript = Join-Path $PSScriptRoot 'Start-OtaStandaloneReview.ps1'
$stopScript = Join-Path $PSScriptRoot 'Stop-OtaStandaloneReview.ps1'
$mutex = [Threading.Mutex]::new(
    $false,
    'Local\SiFangGuanOtaStandaloneReviewSupervisor'
)
$lockAcquired = $false

function Write-SupervisorLog([string]$Message) {
    New-Item -ItemType Directory -Path $runtimeRoot -Force | Out-Null
    $line = '{0} {1}' -f (
        [DateTimeOffset]::Now.ToString('o')
    ), $Message
    Add-Content -LiteralPath $logPath -Value $line -Encoding utf8
}

function Test-HttpEndpoint([string]$Url) {
    try {
        $response = Invoke-WebRequest `
            -Uri $Url `
            -UseBasicParsing `
            -TimeoutSec $HealthTimeoutSeconds
        return $response.StatusCode -eq 200
    }
    catch {
        return $false
    }
}

try {
    $lockAcquired = $mutex.WaitOne(0)
    if (-not $lockAcquired) {
        return
    }

    $apiHealthy = Test-HttpEndpoint "http://127.0.0.1:$ApiPort/health"
    $webHealthy = Test-HttpEndpoint "http://127.0.0.1:$WebPort"
    $longRunning = $false
    if (Test-Path -LiteralPath $statePath -PathType Leaf) {
        try {
            $state = Get-Content `
                -LiteralPath $statePath `
                -Raw `
                -Encoding utf8 |
                ConvertFrom-Json
            $longRunning = (
                $state.PSObject.Properties.Name -contains 'longRunning' -and
                [bool]$state.longRunning
            )
        }
        catch {
            $longRunning = $false
        }
    }

    if ($apiHealthy -and $webHealthy -and $longRunning) {
        return
    }

    Write-SupervisorLog (
        'RECOVERY_STARTED apiHealthy={0} webHealthy={1} longRunning={2}' -f
        $apiHealthy,
        $webHealthy,
        $longRunning
    )

    & $stopScript
    $deadline = (Get-Date).AddSeconds(20)
    do {
        $portsBusy = @(
            @(
                $ApiPort,
                $WebPort
            ) | Where-Object {
                Get-NetTCPConnection `
                    -State Listen `
                    -LocalPort $_ `
                    -ErrorAction SilentlyContinue
            }
        )
        if ($portsBusy.Count -eq 0) {
            break
        }
        Start-Sleep -Milliseconds 500
    } while ((Get-Date) -lt $deadline)

    if ($portsBusy.Count -gt 0) {
        throw "OTA_REVIEW_RECOVERY_PORTS_BUSY:$($portsBusy -join ',')"
    }

    $null = & $startScript `
        -ApiPort $ApiPort `
        -WebPort $WebPort `
        -LongRunning
    Write-SupervisorLog 'RECOVERY_COMPLETED'
}
catch {
    Write-SupervisorLog (
        'RECOVERY_FAILED errorType={0} message={1}' -f
        $_.Exception.GetType().Name,
        $_.Exception.Message
    )
    throw
}
finally {
    if ($lockAcquired) {
        $mutex.ReleaseMutex()
    }
    $mutex.Dispose()
}
