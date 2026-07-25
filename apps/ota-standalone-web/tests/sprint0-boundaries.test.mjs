import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const appSource = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8')
const sessionSource = await readFile(new URL('../src/auth/session.ts', import.meta.url), 'utf8')
const authApiSource = await readFile(new URL('../src/api/auth.ts', import.meta.url), 'utf8')
const businessApiSource = await readFile(new URL('../src/api/business.ts', import.meta.url), 'utf8')
const monitorSource = await readFile(new URL('../src/pages/MonitorPage.tsx', import.meta.url), 'utf8')
const historySource = await readFile(new URL('../src/pages/HistoryPage.tsx', import.meta.url), 'utf8')
const mappingSource = await readFile(new URL('../src/pages/MappingTargetPage.tsx', import.meta.url), 'utf8')
const reportSourceSource = await readFile(new URL('../src/pages/ReportSourceConfigPage.tsx', import.meta.url), 'utf8')
const connectionSource = await readFile(new URL('../src/pages/ConnectionConfigPage.tsx', import.meta.url), 'utf8')
const realPrepSource = await readFile(new URL('../src/pages/RealConnectorPrepPanel.tsx', import.meta.url), 'utf8')
const browserRehearsalSource = await readFile(new URL('../src/pages/BrowserAuthorizationRehearsalPanel.tsx', import.meta.url), 'utf8')
const browserRehearsalStateSource = await readFile(new URL('../src/pages/browserAuthorizationRehearsalState.ts', import.meta.url), 'utf8')
const admissionSource = await readFile(new URL('../src/pages/ConnectorAdmissionReadinessPanel.tsx', import.meta.url), 'utf8')
const stylesSource = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8')

test('Sprint 0 web does not persist access tokens in browser storage', () => {
  assert.equal(sessionSource.includes('localStorage'), false)
  assert.equal(sessionSource.includes('sessionStorage'), false)
})

test('pilot shell exposes four report-fusion pages and controlled WeCom UAT delivery', () => {
  assert.match(appSource, /ReportSourceConfigPage/)
  assert.match(appSource, /MonitorPage/)
  assert.match(appSource, /MappingTargetPage/)
  assert.match(appSource, /HistoryPage/)
  assert.match(appSource, /LOCAL REVIEW · REPORT FUSION/)
  assert.match(appSource, /ReportSourceConfigPage[\s\S]*canConfigure=\{canAdminConfigure\}/)
  assert.match(appSource, /报表只读采集已启用 · 企微UAT推送可配置/)
  assert.match(appSource, /HistoryPage[\s\S]*canConfigure=\{canAdminConfigure\}/)
  assert.match(monitorSource, /triggerLiveCollection/)
  assert.doesNotMatch(monitorSource, /confirmBusinessDateAndCollect/)
  assert.doesNotMatch(monitorSource, /loadBusinessDayControl|saveBusinessDayControl/)
  assert.doesNotMatch(monitorSource, /type="date"/)
  assert.match(monitorSource, /collectNow\('automatic'\)/)
  assert.match(monitorSource, /重新采集已配置报表/)
  assert.match(monitorSource, /本次仅采集；企微由06分调度处理/)
  assert.match(historySource, /type="password"/)
  assert.match(historySource, /saveWeComConfig/)
  assert.match(historySource, /sendWeComTestDelivery/)
  assert.match(historySource, /@所有人/)
  assert.doesNotMatch(
    historySource,
    /qyapi\.weixin\.qq\.com[^<]*key=[A-Za-z0-9-]{20}/,
  )
})

test('cookie-authenticated logout forwards a double-submit CSRF token', () => {
  assert.match(authApiSource, /ota_csrf=/)
  assert.match(authApiSource, /X-CSRF-TOKEN/)
  assert.doesNotMatch(authApiSource, /Authorization: `Bearer/)
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
