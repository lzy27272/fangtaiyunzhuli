[CmdletBinding()]
param(
    [string]$RuntimeRoot = 'D:\SifangguanHotelAIOS',
    [string]$ServiceName = 'SifangguanPostgreSQL',
    [int]$Port = 55432
)

$ErrorActionPreference = 'Stop'

$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = [Security.Principal.WindowsPrincipal]::new($identity)
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw 'Administrator privileges are required to install the PostgreSQL service.'
}

$resolvedRuntimeRoot = [IO.Path]::GetFullPath($RuntimeRoot)
if ($resolvedRuntimeRoot -in @('C:\', 'D:\') -or $resolvedRuntimeRoot.Length -lt 8) {
    throw "Unsafe runtime root: $resolvedRuntimeRoot"
}

$postgresRoot = Join-Path $resolvedRuntimeRoot 'PostgreSQL\14.22'
$pgCtl = Join-Path $postgresRoot 'bin\pg_ctl.exe'
$dataRoot = Join-Path $resolvedRuntimeRoot 'Data\PostgreSQL'
$logFile = Join-Path $resolvedRuntimeRoot 'Logs\postgresql.log'
foreach ($requiredPath in @($pgCtl, (Join-Path $dataRoot 'PG_VERSION'))) {
    if (-not (Test-Path -LiteralPath $requiredPath)) {
        throw "Pilot PostgreSQL runtime is missing: $requiredPath"
    }
}

$transitionedFromManual = $false
try {
    $service = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
    if (-not $service) {
        & $pgCtl register -N $ServiceName -D $dataRoot -S auto -o "-p $Port"
        if ($LASTEXITCODE -ne 0) {
            throw "Unable to register PostgreSQL service: $ServiceName"
        }
    }

    & sc.exe description $ServiceName 'Hotel AI OS Pilot PostgreSQL - loopback only' | Out-Null
    & sc.exe config $ServiceName start= delayed-auto | Out-Null
    & sc.exe failure $ServiceName reset= 86400 actions= restart/5000/restart/15000/restart/60000 | Out-Null
    & sc.exe failureflag $ServiceName 1 | Out-Null

    $service = Get-Service -Name $ServiceName
    if ($service.Status -ne 'Running') {
        & $pgCtl status -D $dataRoot | Out-Null
        if ($LASTEXITCODE -eq 0) {
            & $pgCtl stop -D $dataRoot -m fast -w -t 60
            if ($LASTEXITCODE -ne 0) {
                throw 'Unable to stop the manually started Pilot PostgreSQL process.'
            }
            $transitionedFromManual = $true
        }

        Start-Service -Name $ServiceName
        (Get-Service -Name $ServiceName).WaitForStatus('Running', [TimeSpan]::FromSeconds(60))
    }

    [pscustomobject]@{
        Service = $ServiceName
        Status = (Get-Service -Name $ServiceName).Status
        StartType = (Get-Service -Name $ServiceName).StartType
        Listen = "127.0.0.1:$Port"
        DataRoot = $dataRoot
    }
} catch {
    if ($transitionedFromManual) {
        & $pgCtl start -D $dataRoot -l $logFile -o "-p $Port" -w | Out-Null
    }
    throw
}
