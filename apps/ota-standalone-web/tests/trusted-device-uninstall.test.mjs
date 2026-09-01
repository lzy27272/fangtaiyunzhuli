import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { join, win32 } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const uninstallUrl = new URL(
  '../../../tools/trusted-device/Uninstall-001TrustedDevice.ps1',
  import.meta.url,
)
const uninstallPath = fileURLToPath(uninstallUrl)
const uninstallSource = readFileSync(uninstallUrl, 'utf8')
const installerSource = readFileSync(
  new URL(
    '../../../tools/trusted-device/Install-001TrustedDevice.ps1',
    import.meta.url,
  ),
  'utf8',
)
const readmeSource = readFileSync(
  new URL('../../../tools/trusted-device/README.md', import.meta.url),
  'utf8',
)
const publishSource = readFileSync(
  new URL(
    '../../../infra/ota-standalone-server/scripts/Publish-OtaStandaloneServer.ps1',
    import.meta.url,
  ),
  'utf8',
)
const windowsPowerShell = process.platform === 'win32' && process.env.SystemRoot
  ? join(
      process.env.SystemRoot,
      'System32',
      'WindowsPowerShell',
      'v1.0',
      'powershell.exe',
    )
  : ''
const canRunWindowsPowerShell = Boolean(
  windowsPowerShell && existsSync(windowsPowerShell),
)

const runUninstaller = (...arguments_) => spawnSync(
  windowsPowerShell,
  [
    '-NoProfile',
    '-ExecutionPolicy',
    'Bypass',
    '-File',
    uninstallPath,
    ...arguments_,
  ],
  { encoding: 'utf8' },
)

const removalHarness = String.raw`
$source = [IO.File]::ReadAllText($env:SFG_UNINSTALL_SOURCE_PATH)
$entrypoint = $source.IndexOf('$options = Read-UninstallArguments')
if ($entrypoint -lt 0) { throw 'UNINSTALL_ENTRYPOINT_NOT_FOUND' }
Invoke-Expression $source.Substring(0, $entrypoint)
$testRoot = Join-Path $env:TEMP ('sfg-uninstall-test-' + [guid]::NewGuid().ToString('N'))
$stateRoot = Join-Path $testRoot 'TrustedDevice-003'
$appRoot = Join-Path $stateRoot 'app'
$profileRoot = Join-Path $stateRoot 'chrome-profile'
$siblingRoot = Join-Path $testRoot 'TrustedDevice-001'
$outsideRoot = Join-Path $testRoot 'outside'
$outsideLink = Join-Path $stateRoot 'outside-link'
try {
  New-Item -ItemType Directory -Path $appRoot,$profileRoot,$siblingRoot,$outsideRoot -Force | Out-Null
  [IO.File]::WriteAllText((Join-Path $appRoot 'uninstall-copy.ps1'), 'retry')
  [IO.File]::WriteAllText((Join-Path $profileRoot 'profile.bin'), 'profile')
  [IO.File]::WriteAllText((Join-Path $stateRoot 'device-state.json'), 'not-read')
  [IO.File]::WriteAllText((Join-Path $siblingRoot 'sentinel.txt'), 'preserve')
  [IO.File]::WriteAllText((Join-Path $outsideRoot 'sentinel.txt'), 'preserve')
  New-Item -ItemType Junction -Path $outsideLink -Target $outsideRoot | Out-Null
  $targets = [pscustomobject]@{
    StateRoot = $stateRoot
    AppRoot = $appRoot
    ProfileRoot = $profileRoot
  }
  $removed = Remove-TrustedDeviceState -Targets $targets
  $secondRemoval = Remove-TrustedDeviceState -Targets $targets
  [ordered]@{
    removed = $removed
    secondRemoval = $secondRemoval
    targetGone = -not (Test-Path -LiteralPath $stateRoot)
    siblingPreserved = Test-Path -LiteralPath (Join-Path $siblingRoot 'sentinel.txt')
    junctionTargetPreserved = Test-Path -LiteralPath (Join-Path $outsideRoot 'sentinel.txt')
  } | ConvertTo-Json -Compress
}
finally {
  if (Test-Path -LiteralPath $outsideLink) {
    [IO.Directory]::Delete($outsideLink, $false)
  }
  if (Test-Path -LiteralPath $testRoot) {
    Remove-Item -LiteralPath $testRoot -Recurse -Force
  }
}
`

test('uninstaller has one explicit hotel scope and no process-wide cleanup', () => {
  assert.match(uninstallSource, /ValueFromRemainingArguments/u)
  assert.match(uninstallSource, /'--hotel'/u)
  assert.match(uninstallSource, /TRUSTED_DEVICE_UNINSTALL_HOTEL_REQUIRED/u)
  assert.match(uninstallSource, /\^\[A-Z0-9\]\[A-Z0-9_-\]\{0,15\}\$/u)
  assert.doesNotMatch(uninstallSource, /HotelCode\s*=\s*['"]001['"]/u)

  assert.match(
    uninstallSource,
    /TaskName = "Sifangguan-\$HotelCode-Trusted-Collector"/u,
  )
  assert.match(uninstallSource, /TaskPath = '\\'/u)
  assert.match(uninstallSource, /ProtocolName = \$protocolName/u)
  assert.match(uninstallSource, /TrustedDevice001/u)
  assert.match(uninstallSource, /"TrustedDevice-\$HotelCode"/u)
  assert.match(uninstallSource, /Join-Path \$stateRoot 'app'/u)
  assert.match(uninstallSource, /Join-Path \$stateRoot 'chrome-profile'/u)

  assert.doesNotMatch(
    uninstallSource,
    /Get-CimInstance|Win32_Process|Stop-Process|taskkill(?:\.exe)?/iu,
  )
  assert.doesNotMatch(
    uninstallSource,
    /Get-Content|ReadAllText|ConvertFrom-Json/iu,
  )
  assert.doesNotMatch(uninstallSource, /Unregister-ScheduledTask[^\n]+\*/u)
  assert.doesNotMatch(uninstallSource, /Remove-Item[^\n]+\$sifangguanRoot/u)
})

test('uninstaller preflights protocol ownership and deletes only exact targets', () => {
  const protocolPreflight = uninstallSource.indexOf(
    '$protocolPresent = Assert-ProtocolOwnedByHotel',
  )
  const taskLookup = uninstallSource.indexOf('$task = Get-ScheduledTask')
  const taskDisable = uninstallSource.indexOf('Disable-ScheduledTask')
  const taskUnregister = uninstallSource.indexOf('Unregister-ScheduledTask')

  assert.ok(protocolPreflight >= 0)
  assert.ok(protocolPreflight < taskLookup)
  assert.ok(taskDisable < taskUnregister)
  assert.match(
    uninstallSource,
    /Get-ScheduledTask `[\s\S]+?-TaskName \$targets\.TaskName `[\s\S]+?-TaskPath \$targets\.TaskPath/u,
  )
  assert.match(
    uninstallSource,
    /TRUSTED_DEVICE_UNINSTALL_PROTOCOL_OWNERSHIP_MISMATCH/u,
  )
  assert.match(uninstallSource, /-HotelCode\\s\+"/u)
  assert.match(
    uninstallSource,
    /Remove-Item -LiteralPath \$targets\.ProtocolRoot -Recurse -Force/u,
  )
  assert.match(
    uninstallSource,
    /\$statePresent = Remove-TrustedDeviceState -Targets \$targets/u,
  )
  assert.match(uninstallSource, /FileAttributes\]::ReparsePoint/u)
  assert.match(uninstallSource, /TRUSTED_DEVICE_UNINSTALL_DELETE_SCOPE_INVALID/u)
  assert.ok(
    uninstallSource.indexOf('-Path $Targets.ProfileRoot') <
      uninstallSource.lastIndexOf('-Path $Targets.AppRoot'),
  )
})

test('uninstaller is installed, published, and documented with explicit scope', () => {
  assert.match(
    installerSource,
    /'tools\\trusted-device\\Uninstall-001TrustedDevice\.ps1'/u,
  )
  assert.match(
    publishSource,
    /'tools\/trusted-device\/Uninstall-001TrustedDevice\.ps1'/u,
  )
  assert.match(readmeSource, /## 单店本机停用和卸载/u)
  assert.match(
    readmeSource,
    /Uninstall-001TrustedDevice\.ps1" --hotel 003 --dry-run/u,
  )
  assert.match(
    readmeSource,
    /Uninstall-001TrustedDevice\.ps1" --hotel 001/u,
  )
  assert.match(readmeSource, /不修改其他门店或云端设备登记/u)
})

test('installer and server release include the trusted-device local state store', () => {
  assert.match(
    installerSource,
    /'tools\\trusted-device\\trusted-device-local-state\.mjs'/u,
  )
  assert.match(
    publishSource,
    /'tools\/trusted-device\/trusted-device-local-state\.mjs'/u,
  )
})

test('installer uses a directory boundary for custom InstallRoot', () => {
  assert.match(
    installerSource,
    /\$localAppDataPrefix = \$localAppDataRoot \+ \[System\.IO\.Path\]::DirectorySeparatorChar/u,
  )
  assert.match(
    installerSource,
    /\$resolvedRoot\.Equals\([\s\S]+?\$localAppDataRoot[\s\S]+?\) -or \$resolvedRoot\.StartsWith\([\s\S]+?\$localAppDataPrefix/u,
  )
  assert.doesNotMatch(
    installerSource,
    /\$resolvedRoot\.StartsWith\(\[System\.IO\.Path\]::GetFullPath\(\$env:LOCALAPPDATA\)/u,
  )
})

test(
  'dry-run resolves exact 001 and multistore targets without runtime mutation',
  { skip: !canRunWindowsPowerShell },
  () => {
    const legacy = runUninstaller('--hotel', '001', '--dry-run')
    const multistore = runUninstaller('--hotel', '003', '--dry-run')
    assert.equal(legacy.status, 0, legacy.stderr)
    assert.equal(multistore.status, 0, multistore.stderr)

    const legacyPlan = JSON.parse(legacy.stdout)
    const multistorePlan = JSON.parse(multistore.stdout)
    assert.deepEqual(
      {
        status: legacyPlan.status,
        hotelCode: legacyPlan.hotelCode,
        task: legacyPlan.scheduledTask,
        protocol: legacyPlan.protocol,
        stateLeaf: win32.basename(legacyPlan.stateRoot),
        mutatesRuntime: legacyPlan.mutatesRuntime,
      },
      {
        status: 'TRUSTED_DEVICE_UNINSTALL_PLAN',
        hotelCode: '001',
        task: 'Sifangguan-001-Trusted-Collector',
        protocol: 'sfgtrusted001',
        stateLeaf: 'TrustedDevice001',
        mutatesRuntime: false,
      },
    )
    assert.deepEqual(
      {
        status: multistorePlan.status,
        hotelCode: multistorePlan.hotelCode,
        task: multistorePlan.scheduledTask,
        protocol: multistorePlan.protocol,
        stateLeaf: win32.basename(multistorePlan.stateRoot),
        appLeaf: win32.basename(multistorePlan.appRoot),
        profileLeaf: win32.basename(multistorePlan.profileRoot),
        stateFile: win32.basename(multistorePlan.stateFile),
        mutatesRuntime: multistorePlan.mutatesRuntime,
      },
      {
        status: 'TRUSTED_DEVICE_UNINSTALL_PLAN',
        hotelCode: '003',
        task: 'Sifangguan-003-Trusted-Collector',
        protocol: 'sfgtrusted003',
        stateLeaf: 'TrustedDevice-003',
        appLeaf: 'app',
        profileLeaf: 'chrome-profile',
        stateFile: 'device-state.json',
        mutatesRuntime: false,
      },
    )
    assert.notEqual(legacyPlan.stateRoot, multistorePlan.stateRoot)
  },
)

test(
  'uninstaller rejects missing, malformed, duplicate, and implicit hotel scope',
  { skip: !canRunWindowsPowerShell },
  () => {
    const cases = [
      ['--dry-run'],
      ['--hotel', '..\\001', '--dry-run'],
      ['--hotel', '003', '--hotel', '001', '--dry-run'],
      ['003', '--dry-run'],
    ]
    for (const arguments_ of cases) {
      const result = runUninstaller(...arguments_)
      assert.notEqual(result.status, 0, `unexpected success: ${arguments_.join(' ')}`)
      assert.doesNotMatch(result.stdout, /TRUSTED_DEVICE_UNINSTALLED/u)
    }
  },
)

test(
  'scoped removal is idempotent and never follows a junction into another root',
  { skip: !canRunWindowsPowerShell },
  () => {
    const result = spawnSync(
      windowsPowerShell,
      ['-NoProfile', '-Command', removalHarness],
      {
        encoding: 'utf8',
        env: {
          ...process.env,
          SFG_UNINSTALL_SOURCE_PATH: uninstallPath,
        },
      },
    )
    assert.equal(result.status, 0, result.stderr)
    assert.deepEqual(JSON.parse(result.stdout), {
      removed: true,
      secondRemoval: false,
      targetGone: true,
      siblingPreserved: true,
      junctionTargetPreserved: true,
    })
  },
)

test(
  'installer rejects a LOCALAPPDATA-prefix sibling before creating it',
  { skip: !canRunWindowsPowerShell },
  () => {
    const outsideRoot = `${process.env.LOCALAPPDATA}-sfg-boundary-test-${Date.now()}`
    assert.equal(existsSync(outsideRoot), false)
    const result = spawnSync(
      windowsPowerShell,
      [
        '-NoProfile',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        fileURLToPath(new URL(
          '../../../tools/trusted-device/Install-001TrustedDevice.ps1',
          import.meta.url,
        )),
        '-EnrollmentCode',
        '003-ABCD-EFGH-IJKL',
        '-HotelCode',
        '003',
        '-InstallRoot',
        join(outsideRoot, 'app'),
      ],
      { encoding: 'utf8' },
    )
    assert.notEqual(result.status, 0)
    assert.match(
      result.stderr,
      /InstallRoot must be inside the current user LOCALAPPDATA directory/u,
    )
    assert.equal(existsSync(outsideRoot), false)
  },
)
