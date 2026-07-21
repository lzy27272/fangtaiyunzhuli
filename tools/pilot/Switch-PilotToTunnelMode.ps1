[CmdletBinding()]
param(
    [string]$CaddyServiceName = 'SifangguanPilot',
    [string]$FirewallRuleName = 'Sifangguan Pilot HTTPS 80-443'
)

$ErrorActionPreference = 'Stop'

$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = [Security.Principal.WindowsPrincipal]::new($identity)
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw 'This script must run from an elevated Administrator session.'
}

$service = Get-Service -Name $CaddyServiceName -ErrorAction SilentlyContinue
if ($service) {
    if ($service.Status -ne 'Stopped') {
        Stop-Service -Name $CaddyServiceName -Force
    }
    Set-Service -Name $CaddyServiceName -StartupType Manual
}

$firewallRule = Get-NetFirewallRule -DisplayName $FirewallRuleName -ErrorAction SilentlyContinue
if ($firewallRule) {
    $firewallRule | Remove-NetFirewallRule
}

[pscustomobject]@{
    CaddyService = if ($service) { $CaddyServiceName } else { 'NotInstalled' }
    CaddyStartup = if ($service) { (Get-Service -Name $CaddyServiceName).StartType } else { $null }
    CaddyState = if ($service) { (Get-Service -Name $CaddyServiceName).Status } else { $null }
    InboundFirewallRuleRemoved = -not [bool](Get-NetFirewallRule -DisplayName $FirewallRuleName -ErrorAction SilentlyContinue)
}
