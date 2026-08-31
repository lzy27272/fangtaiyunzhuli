param(
  [string]$NodePath = 'node.exe',
  [string]$StatePath = '',
  [string]$Uri = 'sfgtrusted001://repair'
)

$ErrorActionPreference = 'Stop'
$normalizedUri = $Uri.Trim().TrimEnd('/')
if ($normalizedUri -notmatch '^sfgtrusted001://(login|repair)$') {
  throw 'Invalid 001 trusted-device command URI.'
}
$command = $Matches[1].ToLowerInvariant()
$agentPath = Join-Path $PSScriptRoot 'trusted-device-agent.mjs'
$arguments = @($agentPath, $command)
if ($StatePath) { $arguments += @('--state', $StatePath) }
& $NodePath @arguments
if ($LASTEXITCODE -ne 0) { throw "001 trusted-device operation failed. Exit code: $LASTEXITCODE" }
