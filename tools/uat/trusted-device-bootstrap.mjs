import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const ENROLLMENT_PATTERN = /^([A-Z0-9][A-Z0-9_-]{0,15})-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/u
const BUNDLE_FILES = [
  ['tools/trusted-device/Install-001TrustedDevice.ps1', '../trusted-device/Install-001TrustedDevice.ps1'],
  ['tools/trusted-device/Start-001Login.ps1', '../trusted-device/Start-001Login.ps1'],
  ['tools/trusted-device/Uninstall-001TrustedDevice.ps1', '../trusted-device/Uninstall-001TrustedDevice.ps1'],
  ['tools/trusted-device/trusted-device-agent.mjs', '../trusted-device/trusted-device-agent.mjs'],
  ['tools/trusted-device/trusted-device-local-state.mjs', '../trusted-device/trusted-device-local-state.mjs'],
  ['tools/trusted-device/package.json', '../trusted-device/package.json'],
  ['tools/uat/live-report-collector.mjs', './live-report-collector.mjs'],
  ['tools/uat/daily-order-summary.mjs', './daily-order-summary.mjs'],
  ['tools/uat/report-schedule.mjs', './report-schedule.mjs'],
  ['tools/uat/trusted-device-intake.mjs', './trusted-device-intake.mjs'],
]

const UTF8_BOM = Buffer.from([0xef, 0xbb, 0xbf])

const encodeBundleFile = (target, content) => {
  if (!target.toLowerCase().endsWith('.ps1')) return content
  if (content.subarray(0, UTF8_BOM.length).equals(UTF8_BOM)) return content
  return Buffer.concat([UTF8_BOM, content])
}

const powerShellLiteral = (value) => `'${String(value).replaceAll("'", "''")}'`

export const renderTrustedDeviceBootstrapPowerShell = ({
  enrollmentCode,
  serverOrigin,
}) => {
  const enrollmentMatch = ENROLLMENT_PATTERN.exec(String(enrollmentCode ?? ''))
  if (!enrollmentMatch) {
    throw new Error('TRUSTED_DEVICE_ENROLLMENT_CODE_INVALID')
  }
  const hotelCode = enrollmentMatch[1]
  let origin
  try {
    origin = new URL(String(serverOrigin ?? ''))
  } catch {
    throw new Error('TRUSTED_DEVICE_SERVER_ORIGIN_INVALID')
  }
  if (origin.protocol !== 'https:' || origin.username || origin.password) {
    throw new Error('TRUSTED_DEVICE_SERVER_ORIGIN_INVALID')
  }

  const fileCommands = BUNDLE_FILES.map(([target, source]) => {
    const content = encodeBundleFile(
      target,
      readFileSync(fileURLToPath(new URL(source, import.meta.url))),
    )
    return `Write-B64File ${powerShellLiteral(target)} ${powerShellLiteral(content.toString('base64'))}`
  }).join('\n')

  return [
    "$ErrorActionPreference = 'Stop'",
    `$hotelCode = ${powerShellLiteral(hotelCode)}`,
    "$bundleRoot = Join-Path $env:TEMP ('Sifangguan-' + $hotelCode + '-' + [guid]::NewGuid().ToString('N'))",
    'function Write-B64File([string]$RelativePath, [string]$Encoded) {',
    '  $target = Join-Path $bundleRoot $RelativePath',
    '  New-Item -ItemType Directory -Path (Split-Path $target) -Force | Out-Null',
    '  [IO.File]::WriteAllBytes($target, [Convert]::FromBase64String($Encoded))',
    '}',
    'try {',
    '  New-Item -ItemType Directory -Path $bundleRoot -Force | Out-Null',
    fileCommands.split('\n').map((line) => `  ${line}`).join('\n'),
    "  $installer = Join-Path $bundleRoot 'tools\\trusted-device\\Install-001TrustedDevice.ps1'",
    `  & $installer -EnrollmentCode ${powerShellLiteral(enrollmentCode)} -HotelCode $hotelCode -ServerOrigin ${powerShellLiteral(origin.origin)}`,
    "  if ($LASTEXITCODE -ne 0) { throw ($hotelCode + '可信设备安装失败。') }",
    '} finally {',
    '  if (Test-Path -LiteralPath $bundleRoot) {',
    '    Remove-Item -LiteralPath $bundleRoot -Recurse -Force -ErrorAction SilentlyContinue',
    '  }',
    '}',
  ].join('\r\n') + '\r\n'
}

export const renderTrustedDeviceBootstrapCommand = (options) => {
  const enrollmentMatch = ENROLLMENT_PATTERN.exec(String(options?.enrollmentCode ?? ''))
  if (!enrollmentMatch) throw new Error('TRUSTED_DEVICE_ENROLLMENT_CODE_INVALID')
  const hotelCode = enrollmentMatch[1]
  const script = `\ufeff${renderTrustedDeviceBootstrapPowerShell(options)}`
  const encoded = Buffer.from(script, 'utf8').toString('base64')
  const chunks = encoded.match(/.{1,3000}/gu) ?? []
  const writeChunks = chunks.map((chunk, index) =>
    `${index === 0 ? '>' : '>>'}"%SFG_B64%" echo ${chunk}`)
  return [
    '@echo off',
    'setlocal',
    `set "SFG_B64=%TEMP%\\Sifangguan-${hotelCode}-%RANDOM%-%RANDOM%.b64"`,
    `set "SFG_PS1=%TEMP%\\Sifangguan-${hotelCode}-%RANDOM%-%RANDOM%.ps1"`,
    ...writeChunks,
    'powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "$b=[IO.File]::ReadAllText($env:SFG_B64);[IO.File]::WriteAllBytes($env:SFG_PS1,[Convert]::FromBase64String($b))"',
    'if errorlevel 1 goto :failed',
    'powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%SFG_PS1%"',
    'set "SFG_EXIT=%ERRORLEVEL%"',
    'del /q "%SFG_B64%" "%SFG_PS1%" >nul 2>nul',
    'if not "%SFG_EXIT%"=="0" goto :failed_code',
    'exit /b 0',
    ':failed_code',
    `echo ${hotelCode} trusted device setup failed. Exit code: %SFG_EXIT%`,
    'pause',
    'exit /b %SFG_EXIT%',
    ':failed',
    'del /q "%SFG_B64%" "%SFG_PS1%" >nul 2>nul',
    `echo ${hotelCode} trusted device setup failed.`,
    'pause',
    'exit /b 1',
  ].join('\r\n') + '\r\n'
}
