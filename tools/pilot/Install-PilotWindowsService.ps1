[CmdletBinding()]
param(
    [string]$ServiceName = 'SifangguanPilot',
    [switch]$StartService
)

$ErrorActionPreference = 'Stop'

$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = [Security.Principal.WindowsPrincipal]::new($identity)
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw 'This script must run from an elevated Administrator session.'
}

$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$caddyExe = Join-Path $projectRoot '.tooling\caddy\bin\caddy.exe'
$caddyFile = Join-Path $projectRoot 'infra\pilot\Caddyfile.windows-tunnel'
$envFile = Join-Path $projectRoot '.uat-runtime\pilot\caddy.windows.env'

foreach ($requiredPath in @($caddyExe, $caddyFile, $envFile)) {
    if (-not (Test-Path -LiteralPath $requiredPath)) {
        throw "Required file does not exist: $requiredPath"
    }
}

& $caddyExe validate --config $caddyFile --adapter caddyfile --envfile $envFile
if ($LASTEXITCODE -ne 0) {
    throw 'Caddy configuration validation failed.'
}

$existing = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
if ($existing) {
    if ($existing.Status -ne 'Stopped') {
        Stop-Service -Name $ServiceName -Force
        $existing.WaitForStatus('Stopped', [TimeSpan]::FromSeconds(20))
    }

    & sc.exe delete $ServiceName | Out-Null
    if ($LASTEXITCODE -ne 0) {
        throw "Unable to replace Windows service: $ServiceName"
    }

    Start-Sleep -Seconds 1
}

$binaryPath = '"{0}" run --config "{1}" --adapter caddyfile --envfile "{2}"' -f $caddyExe, $caddyFile, $envFile
& sc.exe create $ServiceName binPath= $binaryPath start= auto DisplayName= 'Sifangguan Pilot HTTPS Service' | Out-Null
if ($LASTEXITCODE -ne 0) {
    throw "Unable to create Windows service: $ServiceName"
}

& sc.exe description $ServiceName 'Sifangguan Hotel Management Platform Pilot Test Version HTTPS service' | Out-Null
& sc.exe failure $ServiceName reset= 86400 actions= restart/5000/restart/15000/restart/60000 | Out-Null

if ($StartService) {
    Start-Service -Name $ServiceName
}

Get-CimInstance Win32_Service -Filter "Name='$ServiceName'" |
    Select-Object Name, DisplayName, State, StartMode, PathName
