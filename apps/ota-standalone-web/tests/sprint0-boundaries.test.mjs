import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const appSource = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8')
const sessionSource = await readFile(new URL('../src/auth/session.ts', import.meta.url), 'utf8')
const authApiSource = await readFile(new URL('../src/api/auth.ts', import.meta.url), 'utf8')
const businessApiSource = await readFile(new URL('../src/api/business.ts', import.meta.url), 'utf8')
const monitorSource = await readFile(new URL('../src/pages/MonitorPage.tsx', import.meta.url), 'utf8')
const historySource = await readFile(new URL('../src/pages/HistoryPage.tsx', import.meta.url), 'utf8')
const accountSecuritySource = await readFile(new URL('../src/pages/AccountSecurityPage.tsx', import.meta.url), 'utf8')
const mappingSource = await readFile(new URL('../src/pages/MappingTargetPage.tsx', import.meta.url), 'utf8')
const reportSourceSource = await readFile(new URL('../src/pages/ReportSourceConfigPage.tsx', import.meta.url), 'utf8')
const otaSourceConfigSource = await readFile(new URL('../src/pages/OtaSourceConfigPanel.tsx', import.meta.url), 'utf8')
const otaSourceGuidanceSource = await readFile(new URL('../src/pages/otaSourceGuidance.ts', import.meta.url), 'utf8')
const luopanBrowserConfigSource = await readFile(new URL('../src/pages/LuopanBrowserConfigPanel.tsx', import.meta.url), 'utf8')
const dataAccessOverviewSource = await readFile(
  new URL('../src/pages/DataAccessOverviewPanel.tsx', import.meta.url),
  'utf8',
)
const connectionSource = await readFile(new URL('../src/pages/ConnectionConfigPage.tsx', import.meta.url), 'utf8')
const realPrepSource = await readFile(new URL('../src/pages/RealConnectorPrepPanel.tsx', import.meta.url), 'utf8')
const browserRehearsalSource = await readFile(new URL('../src/pages/BrowserAuthorizationRehearsalPanel.tsx', import.meta.url), 'utf8')
const browserRehearsalStateSource = await readFile(new URL('../src/pages/browserAuthorizationRehearsalState.ts', import.meta.url), 'utf8')
const admissionSource = await readFile(new URL('../src/pages/ConnectorAdmissionReadinessPanel.tsx', import.meta.url), 'utf8')
const stylesSource = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8')
const hotelContextSource = await readFile(
  new URL('../src/components/HotelContextBar.tsx', import.meta.url),
  'utf8',
)
const reviewApiSource = await readFile(
  new URL('../../../tools/uat/ota-standalone-review-api.mjs', import.meta.url),
  'utf8',
)
const luopanCollectorSource = await readFile(
  new URL(
    '../../../tools/uat/luopan-controlled-browser-collector.mjs',
    import.meta.url,
  ),
  'utf8',
)

test('Sprint 0 web does not persist access tokens in browser storage', () => {
  assert.equal(sessionSource.includes('localStorage'), false)
  assert.equal(sessionSource.includes('sessionStorage'), false)
})

test('pilot shell exposes five report-fusion pages and controlled WeCom UAT delivery', () => {
  assert.match(appSource, /ReportSourceConfigPage/)
  assert.match(appSource, /MonitorPage/)
  assert.match(appSource, /MappingTargetPage/)
  assert.match(appSource, /HistoryPage/)
  assert.match(appSource, /AccountSecurityPage/)
  assert.match(appSource, /LOCAL REVIEW · REPORT FUSION/)
  assert.match(appSource, /ReportSourceConfigPage[\s\S]*canConfigure=\{canAdminConfigure\}/)
  assert.match(appSource, /报表只读采集已启用 · 企微UAT推送可配置/)
  assert.match(appSource, /HistoryPage[\s\S]*canConfigure=\{canAdminConfigure\}/)
  assert.match(monitorSource, /triggerLiveCollection/)
  assert.doesNotMatch(monitorSource, /confirmBusinessDateAndCollect/)
  assert.doesNotMatch(monitorSource, /loadBusinessDayControl|saveBusinessDayControl/)
  assert.doesNotMatch(monitorSource, /type="date"/)
  assert.doesNotMatch(monitorSource, /collectNow\('automatic'\)/)
  assert.match(monitorSource, /系统会在播报时段按30分钟轮询/)
  assert.match(monitorSource, /重新采集已配置报表/)
  assert.match(monitorSource, /进入报表接口核对配置/)
  assert.match(
    appSource,
    /onOpenReportSources=\{\(attention\) => \{[\s\S]*setReportSourceAttention\(attention\)[\s\S]*setPage\('connections'\)/,
  )
  assert.match(appSource, /attentionItems=\{reportSourceAttention\}/)
  assert.match(monitorSource, /incompleteMonitorAttention/)
  assert.match(monitorSource, /reportSourceGuidance/)
  assert.match(reportSourceSource, /最近一次采集需要核对以下报表/)
  assert.match(reportSourceSource, /定位该报表/)
  assert.match(reportSourceSource, /needs-attention/)
  assert.match(reportSourceSource, /scrollIntoView/)
  assert.match(stylesSource, /\.report-source-attention-panel/)
  assert.match(
    monitorSource,
    /本次仅采集；企微在08:00至次日02:00的整点约06分推送/,
  )
  assert.match(historySource, /type="password"/)
  assert.match(historySource, /saveWeComConfig/)
  assert.match(historySource, /sendWeComTestSuite/)
  assert.match(historySource, /采集并发送全部适用模板/)
  assert.match(historySource, /@所有人/)
  assert.match(reviewApiSource, /\/wecom-test-suite-deliveries/)
  assert.match(reviewApiSource, /createWeComTestSuitePlan/)
  assert.doesNotMatch(
    historySource,
    /qyapi\.weixin\.qq\.com[^<]*key=[A-Za-z0-9-]{20}/,
  )
})

test('cookie-authenticated logout forwards a double-submit CSRF token', () => {
  const logoutSource = authApiSource.slice(
    authApiSource.indexOf('export async function logout'),
    authApiSource.indexOf('export interface CredentialChangeInput'),
  )
  assert.match(authApiSource, /ota_csrf=/)
  assert.match(logoutSource, /X-CSRF-TOKEN/)
  assert.doesNotMatch(logoutSource, /Authorization: `Bearer/)
})

test('platform administrators can rotate their own login credentials', () => {
  assert.match(appSource, /code: 'security'/)
  assert.match(
    appSource,
    /item\.code !== 'security' \|\| canAdminConfigure/,
  )
  assert.match(accountSecuritySource, /changeCredentials/)
  assert.match(accountSecuritySource, /currentPassword/)
  assert.match(accountSecuritySource, /newUsername/)
  assert.match(accountSecuritySource, /newPassword/)
  assert.match(accountSecuritySource, /type="password"/)
  assert.match(accountSecuritySource, /旧登录已失效/)
  assert.match(authApiSource, /\/auth\/credentials/)
  assert.match(
    authApiSource,
    /Authorization: `Bearer \$\{session\.accessToken\}`/,
  )
  assert.doesNotMatch(accountSecuritySource, /localStorage|sessionStorage/)
})

test('page startup and token expiry use one cookie-authenticated refresh flight', () => {
  assert.match(authApiSource, /\/auth\/refresh/)
  assert.match(authApiSource, /let refreshInFlight/)
  assert.match(authApiSource, /X-CSRF-TOKEN/)
  assert.match(appSource, /hasRefreshContext\(\)/)
  assert.match(appSource, /refreshSession\(\)/)
  assert.match(appSource, /session\.expiresInSeconds - 60/)
})

test('failed refresh removes unusable in-memory authentication state', () => {
  const effects = appSource.slice(appSource.indexOf('export default function App'))
  assert.match(effects, /refreshSession\(\)[\s\S]*?\.catch\(\(\) => \{[\s\S]*?clearSession\(\)[\s\S]*?updateSession\(null\)/)
})

test('failed logout does not silently clear the in-memory session', () => {
  const start = appSource.indexOf('async function signOut')
  const end = appSource.indexOf('return (', start)
  const signOutSource = appSource.slice(start, end)
  assert.match(signOutSource, /await logout\(\)/)
  assert.match(signOutSource, /catch \(reason\)/)
  assert.ok(signOutSource.indexOf('clearSession()') < signOutSource.indexOf('catch (reason)'))
})

test('business calls use the memory access token and idempotency keys', () => {
  assert.match(businessApiSource, /Authorization: `Bearer \$\{session\.accessToken\}`/)
  assert.match(businessApiSource, /'Idempotency-Key'/)
  assert.match(businessApiSource, /messageEnabled: false/)
  assert.match(businessApiSource, /\/ota\/simulation\/hotels/)
  assert.doesNotMatch(businessApiSource, /qyapi\.weixin\.qq\.com/)
})

test('new hotels use an explicit PMS template without copying store secrets or OTA configuration', () => {
  assert.match(hotelContextSource, /美团别样红/)
  assert.match(hotelContextSource, /罗盘PMS/)
  assert.match(hotelContextSource, /pmsUsername/)
  assert.match(hotelContextSource, /type="password"/)
  assert.match(hotelContextSource, /Cookie与POST请求载荷保持为空/)
  assert.match(hotelContextSource, /两种PMS均不复制OTA配置/)
  assert.match(reviewApiSource, /MEITUAN_BIEYANGHONG/)
  assert.match(reviewApiSource, /LUOPAN_CLOUD/)
  assert.match(
    reviewApiSource,
    /hotelSourcesBySourceId\.has\(source\.sourceId\)[\s\S]*: ''/,
  )
  assert.match(reviewApiSource, /otaSourcesByHotel\.set\(created\.hotelId, \[\]\)/)
  assert.match(reviewApiSource, /pmsLoginScope\(created\.hotelId\)/)
})

test('report source administration and scoped revenue configuration stay separate', () => {
  assert.match(appSource, /const canAdminConfigure = session\.account\.roles\.includes\('PLATFORM_ADMIN'\)/)
  assert.match(appSource, /canRevenueConfigure = canAdminConfigure[\s\S]*REVENUE_MANAGER/)
  assert.match(appSource, /ReportSourceConfigPage[\s\S]*canConfigure=\{canAdminConfigure\}/)
  assert.match(appSource, /MappingTargetPage context=\{context\} canConfigure=\{canRevenueConfigure\}/)
})

test('simulation views fail closed and never sum shared OTA inventory', () => {
  assert.match(monitorSource, /无法判断/)
  assert.match(mappingSource, /主库存报表 = 实体可售基准/)
  assert.match(mappingSource, /OTA产品库存只参与差异校验/)
  assert.match(mappingSource, /FULL_SYNC/)
  assert.match(businessApiSource, /'COMPLETE' \| 'PARTIAL' \| 'UNAVAILABLE'/)
  assert.match(businessApiSource, /'MATCHED' \| 'P1_RISK' \| 'UNAVAILABLE'/)
  assert.match(stylesSource, /\.source-complete/)
  assert.match(stylesSource, /\.source-partial/)
  assert.match(stylesSource, /\.inventory-p1_risk/)
  assert.doesNotMatch(businessApiSource, /messageDeliveryEnabled:\s*true/)
})

test('multiple report URLs are saved by hotel with HTTPS and secret boundaries', () => {
  assert.match(businessApiSource, /loadReportSources/)
  assert.match(businessApiSource, /saveReportSources/)
  assert.match(businessApiSource, /\/report-sources/)
  assert.match(reportSourceSource, /SENSITIVE_QUERY_KEY/)
  assert.match(reportSourceSource, /url\.protocol !== 'https:'/)
  assert.match(reportSourceSource, /PRIMARY_CALCULATION/)
  assert.match(reportSourceSource, /AUXILIARY_CALCULATION/)
  assert.match(reportSourceSource, /saveReportSources\(context, payload, reasonCode\)/)
  assert.match(reportSourceSource, /type="password"/)
  assert.match(reportSourceSource, /cookieDrafts\[source\.sourceId\]/)
  assert.match(reportSourceSource, /action: 'REPLACE'/)
  assert.match(reportSourceSource, /action: 'CLEAR'/)
  assert.match(businessApiSource, /cookieConfigured: boolean/)
  assert.match(businessApiSource, /cookieUpdate: ReportSourceCookieUpdate/)
  const viewContract = businessApiSource.slice(
    businessApiSource.indexOf('export interface ReportSourceView'),
    businessApiSource.indexOf('export type ReportSourceCookieUpdate'),
  )
  assert.doesNotMatch(viewContract, /cookieValue|ciphertext|authTag/)
  assert.doesNotMatch(reportSourceSource, /fetch\(['"`]https?:/)
})

test('Luopan stores can disable legacy reports without editing interfaces or credentials', () => {
  assert.match(businessApiSource, /enabledToggleOnly: boolean/)
  assert.match(reportSourceSource, /保存报表启用状态/)
  assert.match(reportSourceSource, /无须配置美团报表接口/)
  assert.match(reportSourceSource, /未启用的报表无需配置Cookie或POST载荷/)
  assert.match(reviewApiSource, /LUOPAN_REPORT_SOURCE_ENABLED_ONLY/)
  assert.match(reviewApiSource, /reportSourceEnabledToggleOnlyMatch/)
  assert.match(monitorSource, /enabledReportSourceIds\.has\(source\.sourceId\)/)
})

test('OTA sources support encrypted configuration, immediate read-only refresh and direct correction', () => {
  assert.match(reportSourceSource, /OtaSourceConfigPanel/)
  assert.match(otaSourceConfigSource, /OTA后台登录网址/)
  assert.match(otaSourceConfigSource, /OTA数据接口网址（返回JSON）/)
  assert.match(otaSourceConfigSource, /OTA Cookie/)
  assert.match(otaSourceConfigSource, /OTA账号/)
  assert.match(otaSourceConfigSource, /OTA密码/)
  assert.match(otaSourceConfigSource, /type="password"/)
  assert.match(otaSourceConfigSource, /saveOtaSources/)
  assert.match(otaSourceConfigSource, /refreshOtaSource/)
  assert.match(otaSourceConfigSource, /保存并自动采集一次/)
  assert.match(otaSourceConfigSource, /OTA_DEFAULT_POLL_INTERVAL_MINUTES = 120/)
  assert.match(otaSourceConfigSource, /每30分钟/)
  assert.match(otaSourceConfigSource, /每24小时/)
  assert.match(reviewApiSource, /scheduledOtaSourceTick/)
  assert.match(reviewApiSource, /otaRefreshDueOnly: true/)
  assert.match(otaSourceConfigSource, /triggerLiveCollection/)
  assert.match(otaSourceConfigSource, /打开OTA后台/)
  assert.match(otaSourceGuidanceSource, /OTA_RESPONSE_NOT_JSON/)
  assert.match(monitorSource, /OTA多维度对比来源/)
  assert.match(monitorSource, /直达修改/)
  assert.match(appSource, /onOpenOtaSource/)
  assert.match(businessApiSource, /\/ota-sources/)
  assert.match(businessApiSource, /\/ota-source-refreshes/)
  assert.match(reviewApiSource, /ota-source-configs\.json/)
  assert.match(reviewApiSource, /ota-source-secrets\.json/)
  assert.match(reviewApiSource, /encryptCookie/)
  const otaViewContract = businessApiSource.slice(
    businessApiSource.indexOf('export interface OtaSourceView'),
    businessApiSource.indexOf('export type OtaCookieUpdate'),
  )
  assert.doesNotMatch(
    otaViewContract,
    /cookieValue|password: string|account: string|ciphertext|authTag/,
  )
})

test('Luopan controlled browser collection is single-hotel locked and produces an explicitly partial brief', () => {
  assert.match(reportSourceSource, /LuopanBrowserConfigPanel/)
  assert.match(luopanBrowserConfigSource, /验证单门店会话/)
  assert.match(luopanBrowserConfigSource, /立即采集并生成简报/)
  assert.match(luopanBrowserConfigSource, /保存并自动采集一次/)
  assert.match(luopanBrowserConfigSource, /订单渠道明细尚未接入/)
  assert.match(businessApiSource, /\/luopan-browser-config/)
  assert.match(
    businessApiSource,
    /\/luopan-browser-session-validations/,
  )
  assert.match(luopanCollectorSource, /LUOPAN_HOTEL_SCOPE_AMBIGUOUS/)
  assert.match(reviewApiSource, /collectLuopanControlledBrowser/)
  const viewContract = businessApiSource.slice(
    businessApiSource.indexOf('export interface LuopanBrowserConfigView'),
    businessApiSource.indexOf('export type OtaPlatformCode'),
  )
  assert.doesNotMatch(
    viewContract,
    /expectedHotelFingerprint|password|cookie|jsessionid/i,
  )
})

test('each saved data-source configuration triggers one collection while manual collection remains available', () => {
  assert.match(reportSourceSource, /saveReportSources[\s\S]*triggerLiveCollection/)
  assert.match(
    reportSourceSource,
    /保存当前门店配置并自动采集一次|保存同步接口并自动采集一次/,
  )
  assert.match(otaSourceConfigSource, /saveOtaSources[\s\S]*triggerLiveCollection/)
  assert.match(
    luopanBrowserConfigSource,
    /saveLuopanBrowserConfig[\s\S]*triggerLiveCollection/,
  )
  const collectNowSource = monitorSource.slice(
    monitorSource.indexOf('const collectNow'),
    monitorSource.indexOf('useEffect', monitorSource.indexOf('const collectNow')),
  )
  assert.match(collectNowSource, /triggerLiveCollection/)
  assert.doesNotMatch(
    collectNowSource,
    /REPORT_SOURCE_COOKIE_REQUIRED|cookieConfigured/,
  )
  assert.match(monitorSource, /罗盘云单门店主采集已启用/)
  assert.match(monitorSource, /重新采集已配置报表/)
})

test('report-source administration shows configuration, data formation, brief and OTA status together', () => {
  assert.match(reportSourceSource, /DataAccessOverviewPanel/)
  assert.match(dataAccessOverviewSource, /当前门店数据接入总览/)
  assert.match(dataAccessOverviewSource, /经营数据形成/)
  assert.match(dataAccessOverviewSource, /经营简报/)
  assert.match(dataAccessOverviewSource, /OTA平台数据/)
  assert.match(dataAccessOverviewSource, /loadMonitor/)
  assert.match(dataAccessOverviewSource, /loadBriefs/)
  assert.match(dataAccessOverviewSource, /loadOtaSources/)
  assert.match(dataAccessOverviewSource, /配置OTA平台数据/)
  assert.match(dataAccessOverviewSource, /collectionRunId/)
  assert.doesNotMatch(
    dataAccessOverviewSource,
    /cookieValue|password|expectedHotelFingerprint|jsessionid/i,
  )
})

test('Sprint 2B real connector preparation is configuration-only and never echoes secrets', () => {
  assert.match(connectionSource, /RealConnectorPrepPanel/)
  assert.match(realPrepSource, /真实接入准备（只配置、不执行）/)
  assert.match(realPrepSource, /RUNTIME BLOCKED/)
  assert.match(realPrepSource, /SecretStore 引用（写入后不回显）/)
  assert.match(realPrepSource, /type="password"/)
  assert.match(realPrepSource, /\^\[A-Z\]\[A-Z0-9_\]\{2,63\}\$/)
  assert.equal(businessApiSource.includes('fingerprint?: string'), false)
  assert.match(businessApiSource, /\/ota\/connector-onboarding\/templates/)
  assert.match(businessApiSource, /\/connector-onboarding/)
  assert.match(businessApiSource, /runtimeBlocked: true/)
  assert.doesNotMatch(businessApiSource, /secretReference\?:/)
  assert.doesNotMatch(realPrepSource, /fetch\(['"`]https?:/)
})

test('controlled PMS browser preparation accepts only an opaque browser-session reference', () => {
  assert.match(
    realPrepSource,
    /connectionMethod === 'CONTROLLED_BROWSER'[\s\S]*return \['BROWSER_SESSION'\]/,
  )
  assert.match(realPrepSource, /不要粘贴 Cookie/)
  assert.match(realPrepSource, /隔离浏览器助手中由授权人员完成/)
  assert.match(realPrepSource, /vault:\/\/、oskeyring:\/\/ 或 secretstore:\/\//)
  assert.match(realPrepSource, /SECRET_PROVIDER_BY_SCHEME/)
  assert.match(realPrepSource, /providerCode: SECRET_PROVIDER_BY_SCHEME\[scheme\]/)
  assert.match(realPrepSource, /首次配置或轮换凭据时必须完整填写/)
  assert.doesNotMatch(realPrepSource, /name=["']cookie["']/i)
})

test('saved controlled-browser PMS drafts expose only the offline authorization rehearsal', () => {
  assert.match(realPrepSource, /BrowserAuthorizationRehearsalPanel/)
  assert.match(
    realPrepSource,
    /draft\.saved\?\.sourceCode === 'PMS'[\s\S]*draft\.saved\.connectionMethod === 'CONTROLLED_BROWSER'/,
  )
  assert.match(
    realPrepSource,
    /configVersion=\{draft\.saved\.rowVersion\}/,
  )
  assert.match(browserRehearsalSource, /OFFLINE REHEARSAL/)
  assert.match(browserRehearsalSource, /RUNTIME BLOCKED/)
  assert.match(browserRehearsalSource, /未连接PMS/)
  assert.match(browserRehearsalSource, /未启动浏览器/)
  assert.match(browserRehearsalSource, /未读取凭据/)
  assert.match(browserRehearsalSource, /AUTH_REQUIRED/)
  assert.doesNotMatch(browserRehearsalSource, /登录成功|已授权|可抓取/)
  assert.doesNotMatch(browserRehearsalSource, /window\.open|<iframe|https?:\/\//)
  assert.doesNotMatch(browserRehearsalSource, /type=["']password["']|name=["']cookie["']/i)
})

test('offline authorization rehearsal uses attempt-bound local API commands and fails closed', () => {
  assert.match(businessApiSource, /browser-authorization-attempts/)
  assert.match(
    businessApiSource,
    /action\?: 'confirm' \| 'cancel' \| 'reauthenticate'/,
  )
  assert.match(businessApiSource, /\{ expectedConfigVersion, reasonCode \}/)
  assert.match(businessApiSource, /\{ expectedRowVersion, reasonCode \}/)
  assert.match(businessApiSource, /authorizationAttemptId/)
  assert.match(businessApiSource, /authorizationState: 'AUTH_REQUIRED'/)
  assert.match(businessApiSource, /runtimeBlocked: true/)
  assert.match(businessApiSource, /pmsConnected: false/)
  assert.match(businessApiSource, /browserStarted: false/)
  assert.match(businessApiSource, /credentialsRead: false/)
  assert.match(businessApiSource, /requireOfflineRehearsalBoundary/)
  assert.match(businessApiSource, /loadLatestBrowserAuthorizationRehearsal/)
  assert.match(browserRehearsalSource, /loadLatestBrowserAuthorizationRehearsal/)
  assert.match(browserRehearsalSource, /selectCurrentConfigAttempt\(latest, configVersion\)/)
  assert.match(
    browserRehearsalStateSource,
    /latest\.configVersion !== currentConfigVersion/,
  )
  assert.match(businessApiSource, /view\.mode !== 'OFFLINE_REHEARSAL'/)
  assert.match(browserRehearsalSource, /view\.rowVersion/)
  assert.doesNotMatch(
    businessApiSource,
    /browser-authorization-attempts[^'`]*\/(?:activate|run|collect)/,
  )
})

test('Sprint 2C admission readiness stays read-only, candidate-unavailable and runtime-blocked', () => {
  assert.match(connectionSource, /ConnectorAdmissionReadinessPanel/)
  assert.match(admissionSource, /连接器准入就绪度（只读）/)
  assert.match(admissionSource, /CANDIDATE_UNAVAILABLE|admissionState/)
  assert.match(admissionSource, /RUNTIME BLOCKED/)
  assert.match(admissionSource, /不能测试连接、不能批准或撤销/)
  assert.match(admissionSource, /runtimeBlocked=true/)
  assert.match(businessApiSource, /\/connector-contract-admissions/)
  assert.match(businessApiSource, /admissionState: 'CANDIDATE_UNAVAILABLE'/)
  assert.match(businessApiSource, /candidateAvailable: false/)
  assert.match(businessApiSource, /approvalAvailable: false/)
  assert.match(businessApiSource, /revocationAvailable: false/)
  assert.match(businessApiSource, /admissionRowVersion: 0/)
  assert.doesNotMatch(admissionSource, /<button/)
  assert.doesNotMatch(admissionSource, /<input/)
  assert.doesNotMatch(businessApiSource, /connector-contract-admissions\/.*approve/)
  assert.doesNotMatch(businessApiSource, /connector-contract-admissions\/.*revoke/)
})
