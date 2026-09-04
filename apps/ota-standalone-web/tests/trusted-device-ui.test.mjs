import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const readSource = (relativePath) => readFile(
  new URL(relativePath, import.meta.url),
  'utf8',
)

test('Bieyanghong defaults to scoped server-Cookie repair while retaining an explicit trusted-device rollback', async () => {
  const [
    page,
    cookieRepair,
    storeRepair,
    panel,
    client,
    agent,
    installer,
    launcher,
    api,
    cookieValidation,
  ] = await Promise.all([
    readSource('../src/pages/ReportSourceConfigPage.tsx'),
    readSource('../src/pages/BieyanghongCookieRepairPanel.tsx'),
    readSource('../src/pages/StoreRepairPanel.tsx'),
    readSource('../src/pages/TrustedDevicePanel.tsx'),
    readSource('../src/api/trustedDevice.ts'),
    readSource('../../../tools/trusted-device/trusted-device-agent.mjs'),
    readSource('../../../tools/trusted-device/Install-001TrustedDevice.ps1'),
    readSource('../../../tools/trusted-device/Start-001Login.ps1'),
    readSource('../../../tools/uat/ota-standalone-review-api.mjs'),
    readSource('../../../tools/uat/bieyanghong-cookie-validation.mjs'),
  ])
  assert.match(page, /<TrustedDevicePanel/u)
  assert.match(page, /trustedDeviceEligible === true/u)
  assert.match(page, /<BieyanghongCookieRepairPanel/u)
  assert.match(page, /trustedDeviceEligible === false/u)
  assert.doesNotMatch(page, /<BieyanghongCloudWorkspacePanel/u)
  assert.match(cookieRepair, /验证 Cookie 并恢复采集/u)
  assert.match(cookieRepair, /validateAndUpdatePmsCookie/u)
  assert.match(cookieRepair, /triggerLiveCollection/u)
  assert.match(cookieRepair, /失败保留旧 Cookie，不影响其他门店/u)
  assert.match(cookieRepair, /无需安装软件/u)
  assert.match(storeRepair, /<BieyanghongCookieRepairPanel/u)
  assert.doesNotMatch(page, /hotelCode === '001'/u)
  assert.match(cookieRepair, /\{hotelCode\} · 云端 Cookie 修复/u)
  assert.match(cookieRepair, /当前 \{hotelCode\} 门店/u)
  assert.match(cookieRepair, /本店验证/u)
  assert.match(page, /PMS配置/u)
  assert.match(page, /PMS 接口与 Cookie/u)
  assert.match(page, /当前门店的报表名称、接口地址和 Cookie 均独立保存/u)
  assert.match(page, /本店独立/u)
  assert.match(page, /source\.endpointUrl/u)
  assert.match(page, /修改接口与 Cookie/u)
  assert.match(page, /新增接口与 Cookie/u)
  assert.ok(
    page.indexOf('PMS 接口与 Cookie') < page.indexOf('<TrustedDevicePanel'),
  )
  assert.match(api, /ensureReportSourcesForEveryHotel/u)
  assert.match(api, /OTA_REVIEW_BIEYANGHONG_COLLECTION_MODE/u)
  assert.match(api, /'SERVER_COOKIE'/u)
  assert.match(api, /!bieyanghongServerCookieModeEnabled/u)
  assert.match(api, /'\/pms-cookie-validation'/u)
  assert.match(api, /'\/live-collection-runs'/u)
  assert.doesNotMatch(
    api,
    /REPORT_SOURCE_DEFINITION_MANAGED|LUOPAN_REPORT_SOURCE_ENABLED_ONLY/u,
  )
  assert.match(api, /suffix === '\/pms-cookie-validation'/u)
  const validationOperation = api.slice(
    api.indexOf('const validateAndReplaceBieyanghongReportCookies'),
    api.indexOf('const finishBieyanghongRepair'),
  )
  const readOnlyValidationAt = validationOperation.indexOf(
    'await validateBieyanghongCookieAccess',
  )
  const replacementAt = validationOperation.indexOf(
    'replaceBieyanghongReportCookies',
  )
  assert.ok(readOnlyValidationAt >= 0)
  assert.ok(replacementAt > readOnlyValidationAt)
  assert.doesNotMatch(
    validationOperation,
    /hotel\.hotelCode !== BIEYANGHONG_REPAIR_PILOT_HOTEL_CODE/u,
  )
  assert.doesNotMatch(
    validationOperation,
    /appendAndPersistSnapshot|deliverWeComSnapshot/u,
  )
  assert.match(cookieValidation, /outboundDeliveryAttempted: false/u)
  assert.doesNotMatch(cookieValidation, /console\.(?:log|info|warn|error)/u)
  assert.match(
    await readSource(
      '../../../infra/ota-standalone-server/scripts/Publish-OtaStandaloneServer.ps1',
    ),
    /tools\/uat\/bieyanghong-cookie-validation\.mjs/u,
  )
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
  const repairActions = panel.slice(
    panel.indexOf('const generateEnrollment'),
    panel.indexOf('const revoke'),
  )
  const scopeApproval = panel.slice(
    panel.indexOf('const approveScope'),
    panel.indexOf('const copyEnrollment'),
  )
  assert.doesNotMatch(repairActions, /canRevokeDevice/u)
  assert.doesNotMatch(scopeApproval, /canRevokeDevice/u)
  assert.match(panel, /if \(!canRevokeDevice \|\| loading \|\| !status\.device\) return/u)
  assert.match(panel, /disabled=\{!canRevokeDevice \|\| loading\}/u)
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
  assert.match(
    installer,
    /-RepetitionInterval \(New-TimeSpan -Minutes 1\)/u,
  )
  assert.match(installer, /-MultipleInstances IgnoreNew/u)
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
  const collectOnce = agent.slice(
    agent.indexOf('const collectOnce = async'),
    agent.indexOf('const repair = async'),
  )
  assert.match(collectOnce, /officialBrowserFor\(state\)/u)
  assert.doesNotMatch(collectOnce, /connectToOfficialBrowser\(state\)/u)
  assert.match(agent, /lastCollectionAttemptStatus: 'RUNNING'/u)
  assert.match(agent, /lastCollectionAttemptStatus: 'SUCCEEDED'/u)
  assert.match(agent, /lastCollectionAttemptStatus: 'FAILED'/u)
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

test('store immediate collection routes trusted devices to the local repair protocol', async () => {
  const [storePage, client] = await Promise.all([
    readSource('../src/pages/StoreConsolePage.tsx'),
    readSource('../src/api/trustedDevice.ts'),
  ])
  const detailStart = storePage.indexOf('export function StoreDetailPage')
  const collectStart = storePage.indexOf('const collect = async () =>', detailStart)
  const refreshStart = storePage.indexOf(
    'const refresh = useCallback(async () =>',
    detailStart,
  )
  const refreshEnd = storePage.indexOf('useEffect(() => {', refreshStart)
  const refreshSource = storePage.slice(refreshStart, refreshEnd)
  const controllerAt = storePage.indexOf(
    'const controller = new AbortController()',
    collectStart,
  )
  const trustedBranchAt = storePage.indexOf(
    'if (trusted.eligible)',
    collectStart,
  )
  const protocolAt = storePage.indexOf(
    'window.location.href = trustedDeviceRepairUrl(trusted.hotelCode)',
    trustedBranchAt,
  )
  const trustedPollAt = storePage.indexOf(
    'await waitForTrustedDeviceSnapshot(',
    trustedBranchAt,
  )
  const freshStatusAt = storePage.indexOf(
    'const latest = await loadTrustedDeviceStatus(',
    trustedBranchAt,
  )
  const legacyCollectionAt = storePage.indexOf(
    'await triggerLiveCollection(context)',
    freshStatusAt,
  )

  assert.ok(collectStart >= 0)
  assert.ok(refreshStart >= 0)
  assert.ok(refreshEnd > refreshStart)
  assert.match(
    refreshSource,
    /canConfigure \? loadConfiguration\(context\) : Promise\.resolve\(null\)/u,
  )
  assert.doesNotMatch(refreshSource, /setLoading\(true\)/u)
  assert.match(
    storePage,
    /setError\(''\)\s+setLoading\(true\)\s+setData\(emptyDetail\)/u,
  )
  assert.ok(controllerAt > collectStart)
  assert.ok(trustedBranchAt >= 0)
  assert.ok(protocolAt > trustedBranchAt)
  assert.ok(trustedPollAt > protocolAt)
  assert.ok(freshStatusAt > trustedPollAt)
  assert.ok(legacyCollectionAt > trustedBranchAt)
  assert.ok(controllerAt < trustedPollAt)
  assert.match(storePage, /if \(trusted\.eligible\) \{/u)
  assert.match(storePage, /if \(collectingRef\.current\) return/u)
  assert.match(storePage, /trustedDeviceRepairUrl\(trusted\.hotelCode\)/u)
  assert.match(storePage, /waitForTrustedDeviceSnapshot/u)
  assert.match(
    storePage,
    /loadTrustedDeviceStatus\(\s*context,\s*\{ signal: controller\.signal \},\s*\)/u,
  )
  assert.match(storePage, /if \(latest\.eligible\) \{/u)
  assert.match(
    storePage,
    /if \(collectionAbortRef\.current === controller\) \{[\s\S]+?setCollecting\(false\)/u,
  )
  assert.match(storePage, /refreshSequenceRef/u)
  assert.match(storePage, /本机立即采集/u)
  assert.match(storePage, /unavailable: dataUnavailable/u)
  assert.doesNotMatch(storePage, /unavailable: Boolean\(error\)/u)
  assert.match(client, /`sfgtrusted\$\{protocolCode\}:\/\/repair`/u)
  assert.match(client, /loadTrustedDeviceStatus\(context, \{ signal \}\)/u)
  assert.match(client, /removeEventListener\('abort', onAbort\)/u)
  assert.match(client, /latest && latest !== baselineSnapshotAt/u)
})
