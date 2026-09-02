import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const readSource = (relativePath) => readFile(
  new URL(relativePath, import.meta.url),
  'utf8',
)

test('Bieyanghong configuration page uses per-store trusted device mode and never requests credentials', async () => {
  const [page, panel, client, agent, installer, launcher] = await Promise.all([
    readSource('../src/pages/ReportSourceConfigPage.tsx'),
    readSource('../src/pages/TrustedDevicePanel.tsx'),
    readSource('../src/api/trustedDevice.ts'),
    readSource('../../../tools/trusted-device/trusted-device-agent.mjs'),
    readSource('../../../tools/trusted-device/Install-001TrustedDevice.ps1'),
    readSource('../../../tools/trusted-device/Start-001Login.ps1'),
  ])
  assert.match(page, /<TrustedDevicePanel/u)
  assert.doesNotMatch(page, /<BieyanghongCloudWorkspacePanel/u)
  assert.match(panel, /登录会话只留在门店电脑/u)
  assert.match(panel, /下载安装并进入登录/u)
  assert.match(panel, /一键检查并修复/u)
  assert.match(panel, /仅打开美团登录/u)
  assert.match(panel, /`sfgtrusted\$\{protocolCode\}:\/\/login`/u)
  assert.match(panel, /`sfgtrusted\$\{protocolCode\}:\/\/repair`/u)
  assert.match(panel, /lastSnapshotAt/u)
  assert.match(panel, /lastCompleteness === 'COMPLETE'/u)
  assert.match(panel, /next\.device\.cutoverReady/u)
  assert.match(panel, /Ed25519设备签名/u)
  assert.doesNotMatch(panel, /type=["']password["']|手机号|短信验证码/u)
  assert.match(client, /\/trusted-device\/enrollment/u)
  assert.match(client, /\/trusted-device\/bootstrap/u)
  assert.match(agent, /https:\/\/pms\.meituan\.com/u)
  assert.match(agent, /spawn\(browserExecutable/u)
  assert.match(agent, /connectOverCDP/u)
  assert.match(agent, /trustedDeviceScopeProof/u)
  assert.match(agent, /pmsLoginHotelIdFromCookies/u)
  assert.match(agent, /scopeReceipt/u)
  assert.match(panel, /已核对，批准本门店/u)
  assert.match(panel, /scopeApprovalStatus/u)
  assert.match(client, /\/trusted-device\/scope-approval/u)
  assert.match(client, /APPROVE_TRUSTED_DEVICE_STORE_SCOPE/u)
  assert.match(agent, /--remote-debugging-address=127\.0\.0\.1/u)
  assert.doesNotMatch(agent, /launchPersistentContext/u)
  assert.doesNotMatch(agent, /--enable-automation/u)
  assert.match(installer, /HKCU:\\Software\\Classes\\\$protocolName/u)
  assert.match(installer, /-Uri "%1"/u)
  assert.match(installer, /-WindowStyle Hidden/u)
  assert.match(launcher, /\$expectedProtocol/u)
  assert.match(launcher, /@\(\$agentPath, \$command, '--hotel', \$HotelCode\)/u)
  assert.match(installer, /Node\.js LTS/u)
  assert.match(installer, /\$env:ProgramFiles/u)
  const resolver = installer.match(
    /function Resolve-NodeRuntime[\s\S]+?\r?\n\}\r?\n\r?\nWrite-Host/u,
  )?.[0] ?? ''
  assert.match(resolver, /Write-Host/u)
  assert.doesNotMatch(resolver, /Write-Output/u)
  assert.match(installer, /New-ScheduledTaskAction/u)
  assert.match(installer, /-Execute \$resolvedNodePath/u)
  assert.match(installer, /Register-ScheduledTask/u)
  assert.match(installer, /collect-if-due/u)
  assert.doesNotMatch(installer, /schtasks\.exe/u)
  assert.match(installer, /trusted-device-agent\.mjs' status/u)
  assert.match(installer, /Keeping its device key and browser session/u)
  assert.doesNotMatch(agent, /console\.log\(.*cookie|writeFileSync\(.*cookie/iu)
  assert.match(agent, /const cloudSnapshot = \{[\s\S]+?orders: \[\]/u)
  assert.match(agent, /snapshot: cloudSnapshot/u)
  assert.match(agent, /source\.sourceId === LEGACY_REVENUE_SOURCE_ID/u)
  assert.match(agent, /source\.endpointUrl === LEGACY_REVENUE_ENDPOINT/u)
  assert.match(agent, /home\/workbench\/businessOverview/u)
  assert.match(agent, /sources: collectionSources/u)
  assert.match(
    agent,
    /Buffer\.from\(config\.pseudonymKey, 'base64url'\)/u,
  )
  assert.match(
    agent,
    /previousStore\[config\.hotel\.hotelId\][\s\S]+?\.filter\(matchesCurrentPseudonymKey\)/u,
  )
  assert.match(agent, /secretKey: pseudonymKey/u)
  assert.match(agent, /pseudonymKey\.fill\(0\)/u)
  assert.match(agent, /process\.exit\(0\)/u)
  assert.match(agent, /process\.exit\(1\)/u)
  assert.match(agent, /else if \(command === 'repair'\) await repair\(\)/u)
  assert.match(agent, /waitForOfficialLogin/u)
  assert.match(agent, /Get-CimInstance Win32_Process/u)
  assert.match(agent, /SFG_TRUSTED_PROFILE/u)
  assert.match(
    agent,
    /mergeCurrentDeviceState\(state, \{\s*browserDebuggingPort: discoveredPort,/u,
  )
  assert.doesNotMatch(agent, /Stop-Process|taskkill/iu)
  assert.doesNotMatch(agent, /slider|captcha.*solve|drag.*captcha/iu)
  const scopeCheckAt = agent.indexOf('const config = await scopedCollectionConfig')
  const providerFetchAt = agent.indexOf('result = await collectLiveReports')
  const localSnapshotAt = agent.indexOf('appendAndPersistSnapshot(')
  assert.ok(scopeCheckAt >= 0)
  assert.ok(providerFetchAt > scopeCheckAt)
  assert.ok(localSnapshotAt > scopeCheckAt)
})

test('public proxy exposes only the three signed trusted-device intake paths', async () => {
  const caddyfile = await readSource('../../../infra/production/caddy/Caddyfile')
  const route = caddyfile.match(
    /@trusted_device path[^\n]+[\s\S]+?handle @trusted_device \{[\s\S]+?\n\t\}/u,
  )?.[0] ?? ''

  assert.match(route, /\/api\/v1\/trusted-device\/enroll/u)
  assert.match(route, /\/api\/v1\/trusted-device\/config/u)
  assert.match(route, /\/api\/v1\/trusted-device\/snapshots/u)
  assert.match(route, /reverse_proxy 127\.0\.0\.1:8091/u)
  assert.doesNotMatch(route, /\/api\/v1\/trusted-device\/\*/u)
})
