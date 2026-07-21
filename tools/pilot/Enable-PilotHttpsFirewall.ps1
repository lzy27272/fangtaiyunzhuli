[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'

$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = [Security.Principal.WindowsPrincipal]::new($identity)
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw 'This script must run from an elevated Administrator session.'
}

$firewallScript = Join-Path $PSScriptRoot 'Set-PilotFirewallRule.ps1'
& $firewallScript `
    -RuleName 'Sifangguan Pilot HTTPS 80-443' `
    -Ports @(80, 443) `
    -Profile Private
