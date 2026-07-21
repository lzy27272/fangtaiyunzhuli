[CmdletBinding()]
param(
    [string]$ServiceName = 'SifangguanPilotTunnel'
)

$ErrorActionPreference = 'Stop'

$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = [Security.Principal.WindowsPrincipal]::new($identity)
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw 'This script must run from an elevated Administrator session.'
}

$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$sourceConfig = Join-Path $projectRoot 'infra\pilot\cloudflared-config.windows.yml'
$secureDir = Join-Path $projectRoot '.uat-runtime\pilot\cloudflared'
$destinationConfig = Join-Path $secureDir 'config.yml'
$cloudflaredExe = Join-Path $projectRoot '.tooling\cloudflared\cloudflared.exe'

foreach ($requiredPath in @($sourceConfig, $secureDir, $cloudflaredExe)) {
    if (-not (Test-Path -LiteralPath $requiredPath)) {
        throw "Required path does not exist: $requiredPath"
    }
}

& $cloudflaredExe tunnel --config $sourceConfig ingress validate
if ($LASTEXITCODE -ne 0) {
    throw 'Cloudflare Tunnel configuration validation failed.'
}

Copy-Item -LiteralPath $sourceConfig -Destination $destinationConfig -Force

$fileAcl = [Security.AccessControl.FileSecurity]::new()
$fileAcl.SetAccessRuleProtection($true, $false)
$allow = [Security.AccessControl.AccessControlType]::Allow
$sids = @(
    [Security.Principal.WindowsIdentity]::GetCurrent().User,
    [Security.Principal.SecurityIdentifier]'S-1-5-18',
    [Security.Principal.SecurityIdentifier]'S-1-5-32-544'
)
foreach ($sid in $sids) {
    $fileAcl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new(
        $sid,
        [Security.AccessControl.FileSystemRights]::FullControl,
        $allow
    ))
}
Set-Acl -LiteralPath $destinationConfig -AclObject $fileAcl

Restart-Service -Name $ServiceName
(Get-Service -Name $ServiceName).WaitForStatus('Running', [TimeSpan]::FromSeconds(20))

Get-Service -Name $ServiceName |
    Select-Object Name, Status, StartType
