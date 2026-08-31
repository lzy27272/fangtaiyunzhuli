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

function Resolve-NodeRuntime([string]$RequestedNodePath) {
  $node = Get-Command $RequestedNodePath -ErrorAction SilentlyContinue
  if ($node) { return $node.Source }
  $knownNodePaths = @(
    (Join-Path $env:ProgramFiles 'nodejs\node.exe'),
    (Join-Path $env:LOCALAPPDATA 'Programs\nodejs\node.exe')
  )
  foreach ($knownNodePath in $knownNodePaths) {
    if (Test-Path -LiteralPath $knownNodePath -PathType Leaf) {
      return $knownNodePath
    }
  }
  $winget = Get-Command 'winget.exe' -ErrorAction SilentlyContinue
  if (-not $winget) {
    throw '未检测到Node.js，且系统没有winget。请先安装Node.js LTS后重试。'
  }
  Write-Host '[1/5] 未检测到Node.js，正在通过Windows软件源安装Node.js LTS…'
  & $winget.Source install --id OpenJS.NodeJS.LTS --exact --silent `
    --accept-package-agreements --accept-source-agreements
  if ($LASTEXITCODE -ne 0) {
    throw "Node.js LTS安装失败，退出码：$LASTEXITCODE"
  }
  $env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + `
    [Environment]::GetEnvironmentVariable('Path', 'User')
  $node = Get-Command 'node.exe' -ErrorAction SilentlyContinue
  if ($node) { return $node.Source }
  foreach ($knownNodePath in $knownNodePaths) {
    if (Test-Path -LiteralPath $knownNodePath -PathType Leaf) {
      return $knownNodePath
    }
  }
  throw 'Node.js安装完成，但当前会话尚未找到node.exe。请重新打开安装文件。'
}

Write-Host '[1/5] 正在检查Node.js运行环境…'
$resolvedNodePath = Resolve-NodeRuntime $NodePath
$resolvedNpmPath = Join-Path (Split-Path $resolvedNodePath) 'npm.cmd'
if (-not (Test-Path -LiteralPath $resolvedNpmPath -PathType Leaf)) {
  throw 'Node.js安装目录中未找到npm.cmd。'
}

$repoRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
Write-Host '[2/5] 正在安装001门店采集器文件…'
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
  Write-Host '[3/5] 正在安装本机采集依赖，首次可能需要1至2分钟…'
  & $resolvedNpmPath install --omit=dev --ignore-scripts --no-audit --no-fund
  if ($LASTEXITCODE -ne 0) { throw "依赖安装失败，退出码：$LASTEXITCODE" }
  Write-Host '[4/5] 正在注册001门店可信设备…'
  $deviceStatePath = Join-Path $env:LOCALAPPDATA 'Sifangguan\TrustedDevice001\device-state.json'
  $deviceReady = $false
  if (Test-Path -LiteralPath $deviceStatePath -PathType Leaf) {
    & $resolvedNodePath '.\trusted-device-agent.mjs' status
    if ($LASTEXITCODE -eq 0) {
      $deviceReady = $true
      Write-Host '检测到本机已有有效可信设备，本次保留原设备密钥与登录会话。'
    }
  }
  if (-not $deviceReady) {
    & $resolvedNodePath '.\trusted-device-agent.mjs' enroll --code $EnrollmentCode --server $ServerOrigin
    if ($LASTEXITCODE -ne 0) { throw "可信设备注册失败，退出码：$LASTEXITCODE" }
  }
} finally {
  Pop-Location
}

$taskName = 'Sifangguan-001-Trusted-Collector'
$agentPath = Join-Path $packageRoot 'trusted-device-agent.mjs'
$taskAction = New-ScheduledTaskAction `
  -Execute $resolvedNodePath `
  -Argument ('"' + $agentPath + '" collect-if-due') `
  -WorkingDirectory $packageRoot
$taskTrigger = New-ScheduledTaskTrigger `
  -Once `
  -At (Get-Date).AddMinutes(1) `
  -RepetitionInterval (New-TimeSpan -Minutes 5)
$taskSettings = New-ScheduledTaskSettingsSet `
  -StartWhenAvailable `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries
Register-ScheduledTask `
  -TaskName $taskName `
  -Action $taskAction `
  -Trigger $taskTrigger `
  -Settings $taskSettings `
  -Description '四方馆001门店可信设备采集器；每5分钟检查一次当前采集时段。' `
  -Force | Out-Null

$protocolRoot = 'HKCU:\Software\Classes\sfgtrusted001'
$protocolCommand = Join-Path $protocolRoot 'shell\open\command'
New-Item -Path $protocolCommand -Force | Out-Null
Set-Item -Path $protocolRoot -Value 'URL:Sifangguan 001 Trusted Device'
New-ItemProperty -Path $protocolRoot -Name 'URL Protocol' -Value '' -PropertyType String -Force | Out-Null
$loginScript = Join-Path $packageRoot 'Start-001Login.ps1'
$openCommand = '"powershell.exe" -NoProfile -ExecutionPolicy Bypass -File "' + $loginScript + '" -NodePath "' + $resolvedNodePath + '"'
Set-Item -Path $protocolCommand -Value $openCommand

$stateRoot = Join-Path $env:LOCALAPPDATA 'Sifangguan\TrustedDevice001'
& icacls.exe $stateRoot /inheritance:r /grant:r "$($env:USERNAME):(OI)(CI)F" | Out-Null
if ($LASTEXITCODE -ne 0) { throw "本机凭据目录权限收紧失败，退出码：$LASTEXITCODE" }

Write-Host '[5/5] 安装完成，正在打开美团官方登录页面…'
& $resolvedNodePath $agentPath login
if ($LASTEXITCODE -ne 0) { throw "001可信设备登录未完成，退出码：$LASTEXITCODE" }
