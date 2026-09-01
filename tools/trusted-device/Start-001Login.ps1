param(
  [string]$NodePath = 'node.exe',
  [string]$StatePath = '',
  [ValidatePattern('^[A-Z0-9][A-Z0-9_-]{0,15}$')]
  [string]$HotelCode = '001',
  [string]$Uri = ''
)

$ErrorActionPreference = 'Stop'
$protocolCode = $HotelCode.ToLowerInvariant().Replace('_', '-')
if (-not $Uri) { $Uri = "sfgtrusted${protocolCode}://repair" }
$normalizedUri = $Uri.Trim().TrimEnd('/')
$expectedProtocol = "sfgtrusted$protocolCode"
if ($normalizedUri -notmatch ('^' + [regex]::Escape($expectedProtocol) + '://(login|repair)$')) {
  throw "Invalid $HotelCode trusted-device command URI."
}
$command = $Matches[1].ToLowerInvariant()
$agentPath = Join-Path $PSScriptRoot 'trusted-device-agent.mjs'
$arguments = @($agentPath, $command, '--hotel', $HotelCode)
if ($StatePath) { $arguments += @('--state', $StatePath) }
& $NodePath @arguments
if ($LASTEXITCODE -ne 0) { throw "$HotelCode trusted-device operation failed. Exit code: $LASTEXITCODE" }
