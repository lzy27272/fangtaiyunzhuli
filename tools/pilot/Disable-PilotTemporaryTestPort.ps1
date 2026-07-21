[CmdletBinding()]
param(
    [string]$KeepRuleName = 'Sifangguan Pilot HTTPS 80-443'
)

$ErrorActionPreference = 'Stop'

$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = [Security.Principal.WindowsPrincipal]::new($identity)
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw 'This script must run from an elevated Administrator session.'
}

$pilotRules = Get-NetFirewallRule -Direction Inbound -ErrorAction Stop |
    Where-Object { $_.DisplayName -like '*Pilot*' }

foreach ($rule in $pilotRules) {
    if ($rule.DisplayName -ne $KeepRuleName) {
        Remove-NetFirewallRule -Name $rule.Name
    }
}
