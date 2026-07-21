[CmdletBinding()]
param(
    [string]$ServiceName = 'SifangguanPilotTunnel',
    [switch]$StartService
)

$ErrorActionPreference = 'Stop'

$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = [Security.Principal.WindowsPrincipal]::new($identity)
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw 'This script must run from an elevated Administrator session.'
}

$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$cloudflaredExe = Join-Path $projectRoot '.tooling\cloudflared\cloudflared.exe'
$configFile = Join-Path $projectRoot '.uat-runtime\pilot\cloudflared\config.yml'

foreach ($requiredPath in @($cloudflaredExe, $configFile)) {
    if (-not (Test-Path -LiteralPath $requiredPath)) {
        throw "Required file does not exist: $requiredPath"
    }
}

& $cloudflaredExe tunnel --config $configFile ingress validate
if ($LASTEXITCODE -ne 0) {
    throw 'Cloudflare Tunnel ingress validation failed.'
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

$binaryPath = '"{0}" tunnel --config "{1}" run' -f $cloudflaredExe, $configFile
& sc.exe create $ServiceName binPath= $binaryPath start= auto DisplayName= 'Sifangguan Pilot Cloudflare Tunnel' | Out-Null
if ($LASTEXITCODE -ne 0) {
    throw "Unable to create Windows service: $ServiceName"
}

& sc.exe description $ServiceName 'Outbound-only Cloudflare Tunnel for Sifangguan Pilot' | Out-Null
& sc.exe failure $ServiceName reset= 86400 actions= restart/5000/restart/15000/restart/60000 | Out-Null

if ($StartService) {
    Start-Service -Name $ServiceName
}

Get-Service -Name $ServiceName |
    Select-Object Name, DisplayName, Status, StartType
