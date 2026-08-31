param(
  [string]$NodePath = 'node.exe',
  [string]$StatePath = '',
  [string]$Uri = 'sfgtrusted001://repair'
)

$ErrorActionPreference = 'Stop'
$normalizedUri = $Uri.Trim().TrimEnd('/')
if ($normalizedUri -notmatch '^sfgtrusted001://(login|repair)$') {
  throw '001可信设备命令地址无效。'
}
$command = $Matches[1].ToLowerInvariant()
$agentPath = Join-Path $PSScriptRoot 'trusted-device-agent.mjs'
$arguments = @($agentPath, $command)
if ($StatePath) { $arguments += @('--state', $StatePath) }
& $NodePath @arguments
if ($LASTEXITCODE -ne 0) { throw "001可信设备操作失败，退出码：$LASTEXITCODE" }
