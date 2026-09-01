[CmdletBinding()]
param(
  [Parameter(ValueFromRemainingArguments = $true)]
  [string[]]$CliArguments = @()
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Read-UninstallArguments([string[]]$Arguments) {
  $hotelCode = $null
  $dryRun = $false

  for ($index = 0; $index -lt $Arguments.Count; $index += 1) {
    $argument = $Arguments[$index]
    switch -CaseSensitive ($argument) {
      '--hotel' {
        if ($null -ne $hotelCode) {
          throw 'TRUSTED_DEVICE_UNINSTALL_HOTEL_DUPLICATE'
        }
        if ($index + 1 -ge $Arguments.Count) {
          throw 'TRUSTED_DEVICE_UNINSTALL_HOTEL_REQUIRED'
        }
        $index += 1
        $hotelCode = $Arguments[$index]
      }
      '--dry-run' {
        if ($dryRun) {
          throw 'TRUSTED_DEVICE_UNINSTALL_DRY_RUN_DUPLICATE'
        }
        $dryRun = $true
      }
      default {
        throw "TRUSTED_DEVICE_UNINSTALL_ARGUMENT_UNSUPPORTED:$argument"
      }
    }
  }

  if ([string]::IsNullOrWhiteSpace($hotelCode)) {
    throw 'TRUSTED_DEVICE_UNINSTALL_HOTEL_REQUIRED: use --hotel <code>'
  }
  if ($hotelCode -cnotmatch '^[A-Z0-9][A-Z0-9_-]{0,15}$') {
    throw 'TRUSTED_DEVICE_UNINSTALL_HOTEL_INVALID'
  }

  return [pscustomobject]@{
    HotelCode = $hotelCode
    DryRun = $dryRun
  }
}

function Get-TrustedDeviceTargets([string]$HotelCode) {
  $localAppData = [Environment]::GetFolderPath(
    [Environment+SpecialFolder]::LocalApplicationData
  )
  if ([string]::IsNullOrWhiteSpace($localAppData)) {
    throw 'TRUSTED_DEVICE_UNINSTALL_LOCAL_APP_DATA_UNAVAILABLE'
  }

  $localAppDataRoot = [IO.Path]::GetFullPath($localAppData).TrimEnd('\', '/')
  $sifangguanRoot = [IO.Path]::GetFullPath(
    (Join-Path $localAppDataRoot 'Sifangguan')
  )
  $stateDirectoryName = if ($HotelCode -ceq '001') {
    'TrustedDevice001'
  }
  else {
    "TrustedDevice-$HotelCode"
  }
  $stateRoot = [IO.Path]::GetFullPath(
    (Join-Path $sifangguanRoot $stateDirectoryName)
  )
  $stateParent = [IO.Path]::GetFullPath(
    (Split-Path -Parent $stateRoot)
  ).TrimEnd('\', '/')
  if (-not $stateParent.Equals(
    $sifangguanRoot.TrimEnd('\', '/'),
    [StringComparison]::OrdinalIgnoreCase
  )) {
    throw 'TRUSTED_DEVICE_UNINSTALL_STATE_SCOPE_INVALID'
  }

  $protocolCode = $HotelCode.ToLowerInvariant().Replace('_', '-')
  $protocolName = "sfgtrusted$protocolCode"
  return [pscustomobject]@{
    HotelCode = $HotelCode
    TaskName = "Sifangguan-$HotelCode-Trusted-Collector"
    TaskPath = '\'
    ProtocolName = $protocolName
    ProtocolRoot = "HKCU:\Software\Classes\$protocolName"
    ProtocolCommand = "HKCU:\Software\Classes\$protocolName\shell\open\command"
    StateRoot = $stateRoot
    AppRoot = Join-Path $stateRoot 'app'
    ProfileRoot = Join-Path $stateRoot 'chrome-profile'
    StateFile = Join-Path $stateRoot 'device-state.json'
  }
}

function Assert-ProtocolOwnedByHotel($Targets) {
  if (-not (Test-Path -LiteralPath $Targets.ProtocolRoot)) {
    return $false
  }

  $protocolKey = Get-Item -LiteralPath $Targets.ProtocolRoot -Force
  $expectedTitle = "URL:Sifangguan $($Targets.HotelCode) Trusted Device"
  $registeredTitle = [string]$protocolKey.GetValue('')
  if ($registeredTitle -cne $expectedTitle) {
    throw 'TRUSTED_DEVICE_UNINSTALL_PROTOCOL_OWNERSHIP_MISMATCH'
  }
  if (-not (Test-Path -LiteralPath $Targets.ProtocolCommand)) {
    throw 'TRUSTED_DEVICE_UNINSTALL_PROTOCOL_OWNERSHIP_MISMATCH'
  }

  $commandKey = Get-Item -LiteralPath $Targets.ProtocolCommand -Force
  $registeredCommand = [string]$commandKey.GetValue('')
  $hotelArgument = '(?:^|\s)-HotelCode\s+"' +
    [regex]::Escape($Targets.HotelCode) + '"(?:\s|$)'
  if (-not [regex]::IsMatch(
    $registeredCommand,
    $hotelArgument,
    [Text.RegularExpressions.RegexOptions]::CultureInvariant
  )) {
    throw 'TRUSTED_DEVICE_UNINSTALL_PROTOCOL_OWNERSHIP_MISMATCH'
  }
  return $true
}

function Assert-PathInsideStateRoot([string]$Path, [string]$StateRoot) {
  $fullPath = [IO.Path]::GetFullPath($Path).TrimEnd('\', '/')
  $fullStateRoot = [IO.Path]::GetFullPath($StateRoot).TrimEnd('\', '/')
  if ($fullPath.Equals(
    $fullStateRoot,
    [StringComparison]::OrdinalIgnoreCase
  )) {
    return
  }
  $statePrefix = $fullStateRoot + [IO.Path]::DirectorySeparatorChar
  if (-not $fullPath.StartsWith(
    $statePrefix,
    [StringComparison]::OrdinalIgnoreCase
  )) {
    throw 'TRUSTED_DEVICE_UNINSTALL_DELETE_SCOPE_INVALID'
  }
}

function Remove-ScopedTree([string]$Path, [string]$StateRoot) {
  Assert-PathInsideStateRoot -Path $Path -StateRoot $StateRoot
  $item = Get-Item -LiteralPath $Path -Force -ErrorAction SilentlyContinue
  if ($null -eq $item) {
    return $false
  }

  $isReparsePoint = (
    $item.Attributes -band [IO.FileAttributes]::ReparsePoint
  ) -ne 0
  if ($isReparsePoint) {
    if ($item.PSIsContainer) {
      [IO.Directory]::Delete($item.FullName, $false)
    }
    else {
      [IO.File]::Delete($item.FullName)
    }
    return $true
  }

  if (-not $item.PSIsContainer) {
    Remove-Item -LiteralPath $item.FullName -Force
    return $true
  }

  foreach ($child in @(Get-ChildItem -LiteralPath $item.FullName -Force)) {
    $null = Remove-ScopedTree -Path $child.FullName -StateRoot $StateRoot
  }
  Remove-Item -LiteralPath $item.FullName -Force
  return $true
}

function Remove-TrustedDeviceState($Targets) {
  $stateItem = Get-Item `
    -LiteralPath $Targets.StateRoot `
    -Force `
    -ErrorAction SilentlyContinue
  if ($null -eq $stateItem) {
    return $false
  }

  $stateIsReparsePoint = (
    $stateItem.Attributes -band [IO.FileAttributes]::ReparsePoint
  ) -ne 0
  if ($stateIsReparsePoint) {
    $null = Remove-ScopedTree `
      -Path $Targets.StateRoot `
      -StateRoot $Targets.StateRoot
    return $true
  }

  # Remove the browser profile before the installed script. If Chrome still has
  # this hotel's profile open, the script fails while the retry copy is intact.
  $null = Remove-ScopedTree `
    -Path $Targets.ProfileRoot `
    -StateRoot $Targets.StateRoot

  $appFullPath = [IO.Path]::GetFullPath($Targets.AppRoot).TrimEnd('\', '/')
  $profileFullPath = [IO.Path]::GetFullPath(
    $Targets.ProfileRoot
  ).TrimEnd('\', '/')
  foreach ($child in @(Get-ChildItem -LiteralPath $Targets.StateRoot -Force)) {
    $childFullPath = [IO.Path]::GetFullPath($child.FullName).TrimEnd('\', '/')
    if (
      $childFullPath.Equals(
        $appFullPath,
        [StringComparison]::OrdinalIgnoreCase
      ) -or
      $childFullPath.Equals(
        $profileFullPath,
        [StringComparison]::OrdinalIgnoreCase
      )
    ) {
      continue
    }
    $null = Remove-ScopedTree `
      -Path $child.FullName `
      -StateRoot $Targets.StateRoot
  }

  $null = Remove-ScopedTree `
    -Path $Targets.AppRoot `
    -StateRoot $Targets.StateRoot
  Remove-Item -LiteralPath $Targets.StateRoot -Force
  return $true
}

$options = Read-UninstallArguments -Arguments $CliArguments
$targets = Get-TrustedDeviceTargets -HotelCode $options.HotelCode

if ($options.DryRun) {
  [ordered]@{
    status = 'TRUSTED_DEVICE_UNINSTALL_PLAN'
    hotelCode = $targets.HotelCode
    scheduledTask = $targets.TaskName
    scheduledTaskPath = $targets.TaskPath
    protocol = $targets.ProtocolName
    stateRoot = $targets.StateRoot
    appRoot = $targets.AppRoot
    profileRoot = $targets.ProfileRoot
    stateFile = $targets.StateFile
    mutatesRuntime = $false
  } | ConvertTo-Json
  return
}

# Preflight the only shared namespace before changing any local state. This also
# protects hotel codes such as A_B and A-B that normalize to the same URI scheme.
$protocolPresent = Assert-ProtocolOwnedByHotel -Targets $targets

$task = Get-ScheduledTask `
  -TaskName $targets.TaskName `
  -TaskPath $targets.TaskPath `
  -ErrorAction SilentlyContinue
$taskPresent = $null -ne $task
if ($taskPresent) {
  $task | Disable-ScheduledTask -ErrorAction Stop | Out-Null
  $task | Stop-ScheduledTask -ErrorAction Stop
  $task | Unregister-ScheduledTask -Confirm:$false -ErrorAction Stop
}

if ($protocolPresent) {
  Remove-Item -LiteralPath $targets.ProtocolRoot -Recurse -Force
}

$statePresent = Remove-TrustedDeviceState -Targets $targets

[ordered]@{
  status = 'TRUSTED_DEVICE_UNINSTALLED'
  hotelCode = $targets.HotelCode
  scheduledTaskRemoved = $taskPresent
  protocolRemoved = $protocolPresent
  localStateRemoved = $statePresent
  otherHotelsPreserved = $true
  nodeRuntimePreserved = $true
  cloudRegistrationChanged = $false
} | ConvertTo-Json
