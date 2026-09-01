param(
  [Parameter(Mandatory = $true)]
  [ValidatePattern('^[A-Z0-9][A-Z0-9_-]{0,15}-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$')]
  [string]$EnrollmentCode,
  [ValidatePattern('^[A-Z0-9][A-Z0-9_-]{0,15}$')]
  [string]$HotelCode = '',
  [string]$ServerOrigin = 'https://www.sfgzt.cn',
  [string]$NodePath = 'node.exe',
  [string]$InstallRoot = ''
)

$ErrorActionPreference = 'Stop'
if ($EnrollmentCode -notmatch '^([A-Z0-9][A-Z0-9_-]{0,15})-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$') {
  throw 'EnrollmentCode format is invalid.'
}
$enrollmentHotelCode = $Matches[1]
if (-not $HotelCode) { $HotelCode = $enrollmentHotelCode }
if ($HotelCode -ne $enrollmentHotelCode) {
  throw 'HotelCode must match the enrollment code.'
}
$stateDirectoryName = if ($HotelCode -eq '001') { 'TrustedDevice001' } else { "TrustedDevice-$HotelCode" }
if (-not $InstallRoot) {
  $InstallRoot = Join-Path $env:LOCALAPPDATA "Sifangguan\$stateDirectoryName\app"
}
$resolvedRoot = [System.IO.Path]::GetFullPath($InstallRoot).TrimEnd('\', '/')
$localAppDataRoot = [System.IO.Path]::GetFullPath(
  $env:LOCALAPPDATA
).TrimEnd('\', '/')
$localAppDataPrefix = $localAppDataRoot + [System.IO.Path]::DirectorySeparatorChar
$installRootInLocalAppData = $resolvedRoot.Equals(
  $localAppDataRoot,
  [System.StringComparison]::OrdinalIgnoreCase
) -or $resolvedRoot.StartsWith(
  $localAppDataPrefix,
  [System.StringComparison]::OrdinalIgnoreCase
)
if (-not $installRootInLocalAppData) {
  throw 'InstallRoot must be inside the current user LOCALAPPDATA directory.'
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
    throw 'Node.js and winget were not found. Install Node.js LTS and retry.'
  }
  Write-Host '[1/5] Node.js was not found. Installing Node.js LTS with winget...'
  & $winget.Source install --id OpenJS.NodeJS.LTS --exact --silent `
    --accept-package-agreements --accept-source-agreements
  if ($LASTEXITCODE -ne 0) {
    throw "Node.js LTS installation failed. Exit code: $LASTEXITCODE"
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
  throw 'Node.js was installed but node.exe is not available yet. Reopen the installer.'
}

Write-Host '[1/5] Checking the Node.js runtime...'
$resolvedNodePath = Resolve-NodeRuntime $NodePath
$resolvedNpmPath = Join-Path (Split-Path $resolvedNodePath) 'npm.cmd'
if (-not (Test-Path -LiteralPath $resolvedNpmPath -PathType Leaf)) {
  throw 'npm.cmd was not found next to node.exe.'
}

$repoRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
Write-Host "[2/5] Installing the $HotelCode trusted-device files..."
$files = @(
  'tools\trusted-device\trusted-device-agent.mjs',
  'tools\trusted-device\trusted-device-local-state.mjs',
  'tools\trusted-device\package.json',
  'tools\trusted-device\Start-001Login.ps1',
  'tools\trusted-device\Uninstall-001TrustedDevice.ps1',
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
  Write-Host '[3/5] Installing collector dependencies. The first run may take 1-2 minutes...'
  & $resolvedNpmPath install --omit=dev --ignore-scripts --no-audit --no-fund
  if ($LASTEXITCODE -ne 0) { throw "Dependency installation failed. Exit code: $LASTEXITCODE" }
  Write-Host "[4/5] Registering the $HotelCode trusted device..."
  $deviceStatePath = Join-Path $env:LOCALAPPDATA "Sifangguan\$stateDirectoryName\device-state.json"
  $deviceReady = $false
  if (Test-Path -LiteralPath $deviceStatePath -PathType Leaf) {
    & $resolvedNodePath '.\trusted-device-agent.mjs' status --hotel $HotelCode
    if ($LASTEXITCODE -eq 0) {
      $deviceReady = $true
      Write-Host 'An existing trusted device is valid. Keeping its device key and browser session.'
    }
  }
  if (-not $deviceReady) {
    & $resolvedNodePath '.\trusted-device-agent.mjs' enroll --hotel $HotelCode --code $EnrollmentCode --server $ServerOrigin
    if ($LASTEXITCODE -ne 0) { throw "Trusted-device enrollment failed. Exit code: $LASTEXITCODE" }
  }
} finally {
  Pop-Location
}

$taskName = "Sifangguan-$HotelCode-Trusted-Collector"
$agentPath = Join-Path $packageRoot 'trusted-device-agent.mjs'
$taskAction = New-ScheduledTaskAction `
  -Execute $resolvedNodePath `
  -Argument ('"' + $agentPath + '" collect-if-due --hotel ' + $HotelCode) `
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
  -Description "Sifangguan $HotelCode trusted-device collector. Checks the active collection window every 5 minutes." `
  -Force | Out-Null

$protocolCode = $HotelCode.ToLowerInvariant().Replace('_', '-')
$protocolName = "sfgtrusted$protocolCode"
$protocolRoot = "HKCU:\Software\Classes\$protocolName"
$protocolCommand = Join-Path $protocolRoot 'shell\open\command'
New-Item -Path $protocolCommand -Force | Out-Null
Set-Item -Path $protocolRoot -Value "URL:Sifangguan $HotelCode Trusted Device"
New-ItemProperty -Path $protocolRoot -Name 'URL Protocol' -Value '' -PropertyType String -Force | Out-Null
$loginScript = Join-Path $packageRoot 'Start-001Login.ps1'
$openCommand = '"powershell.exe" -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "' + $loginScript + '" -NodePath "' + $resolvedNodePath + '" -HotelCode "' + $HotelCode + '" -Uri "%1"'
Set-Item -Path $protocolCommand -Value $openCommand

$stateRoot = Join-Path $env:LOCALAPPDATA "Sifangguan\$stateDirectoryName"
& icacls.exe $stateRoot /inheritance:r /grant:r "$($env:USERNAME):(OI)(CI)F" | Out-Null
if ($LASTEXITCODE -ne 0) { throw "Failed to secure the local credential directory. Exit code: $LASTEXITCODE" }

Write-Host '[5/5] Installation complete. Opening the official Meituan login page...'
& $resolvedNodePath $agentPath login --hotel $HotelCode
if ($LASTEXITCODE -ne 0) { throw "$HotelCode trusted-device login was not completed. Exit code: $LASTEXITCODE" }
