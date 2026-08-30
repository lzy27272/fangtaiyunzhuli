param(
  [string]$NodePath = 'node.exe',
  [string]$StatePath = ''
)

$ErrorActionPreference = 'Stop'
$agentPath = Join-Path $PSScriptRoot 'trusted-device-agent.mjs'
$arguments = @($agentPath, 'login')
if ($StatePath) { $arguments += @('--state', $StatePath) }
& $NodePath @arguments
if ($LASTEXITCODE -ne 0) { throw "001可信设备登录失败，退出码：$LASTEXITCODE" }
