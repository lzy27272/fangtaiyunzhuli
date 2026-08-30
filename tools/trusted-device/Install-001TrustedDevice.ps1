param(
  [Parameter(Mandatory = $true)]
  [ValidatePattern('^001-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$')]
  [string]$EnrollmentCode,
  [string]$ServerOrigin = 'https://www.sfgzt.cn',
  [string]$NodePath = 'node.exe',
  [string]$InstallRoot = "$env:LOCALAPPDATA\Sifangguan\TrustedDevice001\app"
)

$ErrorActionPreference = 'Stop'
$resolvedRoot = [System.IO.Path]::GetFullPath($InstallRoot)
if (-not $resolvedRoot.StartsWith([System.IO.Path]::GetFullPath($env:LOCALAPPDATA), [System.StringComparison]::OrdinalIgnoreCase)) {
  throw '安装目录必须位于当前用户LOCALAPPDATA中。'
}
New-Item -ItemType Directory -Path $resolvedRoot -Force | Out-Null

$repoRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$files = @(
  'tools\trusted-device\trusted-device-agent.mjs',
  'tools\trusted-device\package.json',
  'tools\trusted-device\Start-001Login.ps1',
  'tools\uat\live-report-collector.mjs',
  'tools\uat\report-schedule.mjs',
  'tools\uat\trusted-device-intake.mjs'
)
foreach ($relative in $files) {
  $source = Join-Path $repoRoot $relative
  $target = Join-Path $resolvedRoot $relative
  New-Item -ItemType Directory -Path (Split-Path $target) -Force | Out-Null
  Copy-Item -LiteralPath $source -Destination $target -Force
}

$packageRoot = Join-Path $resolvedRoot 'tools\trusted-device'
Push-Location $packageRoot
try {
  & npm.cmd install --omit=dev --ignore-scripts --no-audit --no-fund
  if ($LASTEXITCODE -ne 0) { throw "依赖安装失败，退出码：$LASTEXITCODE" }
  & $NodePath '.\trusted-device-agent.mjs' enroll --code $EnrollmentCode --server $ServerOrigin
  if ($LASTEXITCODE -ne 0) { throw "可信设备注册失败，退出码：$LASTEXITCODE" }
} finally {
  Pop-Location
}

$taskName = 'Sifangguan-001-Trusted-Collector'
$agentPath = Join-Path $packageRoot 'trusted-device-agent.mjs'
$taskCommand = '"' + $NodePath + '" "' + $agentPath + '" collect-if-due'
& schtasks.exe /Create /TN $taskName /SC MINUTE /MO 5 /TR $taskCommand /F | Out-Null
if ($LASTEXITCODE -ne 0) { throw "计划任务创建失败，退出码：$LASTEXITCODE" }

$stateRoot = Join-Path $env:LOCALAPPDATA 'Sifangguan\TrustedDevice001'
& icacls.exe $stateRoot /inheritance:r /grant:r "$($env:USERNAME):(OI)(CI)F" | Out-Null
if ($LASTEXITCODE -ne 0) { throw "本机凭据目录权限收紧失败，退出码：$LASTEXITCODE" }

Write-Output '安装完成。下一步请运行 Start-001Login.ps1，在美团官方页面人工登录。'
