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
const personalSecuritySource = await readFile(new URL('../src/pages/PersonalSecurityPage.tsx', import.meta.url), 'utf8')
const peoplePermissionsSource = await readFile(new URL('../src/pages/PeoplePermissionsPage.tsx', import.meta.url), 'utf8')
const storeConsoleSource = await readFile(new URL('../src/pages/StoreConsolePage.tsx', import.meta.url), 'utf8')
const hotSellingRoomSource = await readFile(new URL('../src/pages/HotSellingRoomConfigPanel.tsx', import.meta.url), 'utf8')
const newStoreWizardSource = await readFile(new URL('../src/pages/NewStoreWizard.tsx', import.meta.url), 'utf8')
const mappingSource = await readFile(new URL('../src/pages/MappingTargetPage.tsx', import.meta.url), 'utf8')
const reportSourceSource = await readFile(new URL('../src/pages/ReportSourceConfigPage.tsx', import.meta.url), 'utf8')
const otaSourceConfigSource = await readFile(new URL('../src/pages/OtaSourceConfigPanel.tsx', import.meta.url), 'utf8')
const otaSourceGuidanceSource = await readFile(new URL('../src/pages/otaSourceGuidance.ts', import.meta.url), 'utf8')
const businessDisplaySource = await readFile(new URL('../src/ui/businessDisplay.ts', import.meta.url), 'utf8')
const otaSourceCollectorSource = await readFile(
  new URL('../../../tools/uat/ota-source-collector.mjs', import.meta.url),
  'utf8',
)
const fliggySourceCollectorSource = await readFile(
  new URL('../../../tools/uat/fliggy-source-collector.mjs', import.meta.url),
  'utf8',
)
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
const publicCaddySource = await readFile(
  new URL('../../../infra/ota-standalone-server/caddy/ota-console-public.caddy', import.meta.url),
  'utf8',
)
const nativeCaddySource = await readFile(
  new URL('../../../infra/ota-standalone-server/Caddyfile.native', import.meta.url),
  'utf8',
)
const publishScriptSource = await readFile(
  new URL('../../../infra/ota-standalone-server/scripts/Publish-OtaStandaloneServer.ps1', import.meta.url),
  'utf8',
)
const nativeDeploySource = await readFile(
  new URL('../../../infra/ota-standalone-server/scripts/deploy-native.sh', import.meta.url),
  'utf8',
)
const publicEntryScriptSource = await readFile(
  new URL('../../../infra/ota-standalone-server/scripts/configure-public-entry.sh', import.meta.url),
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

test('people permissions expose the current roles and retire canceled roles from assignment', () => {
  const roleOptionsBlock = peoplePermissionsSource.slice(
    peoplePermissionsSource.indexOf('const ROLE_OPTIONS'),
    peoplePermissionsSource.indexOf('const ASSIGNABLE_ROLES'),
  )
  assert.match(roleOptionsBlock, /'PLATFORM_ADMIN'/)
  assert.match(roleOptionsBlock, /'GENERAL_MANAGER'/)
  assert.match(roleOptionsBlock, /'OTA_OPERATION_MANAGER'/)
  assert.doesNotMatch(roleOptionsBlock, /'REVENUE_MANAGER'|'HOTEL_P1_HANDLER'/)
  assert.match(peoplePermissionsSource, /只有管理员可以查看及编辑采集配置；其他角色仅能进入登录修复/)
})

test('operations console exposes store, exception, people and scoped store-detail pages', () => {
  assert.match(appSource, /StoreOverviewPage/)
  assert.match(appSource, /StoreDetailPage/)
  assert.match(appSource, /ExceptionCenterPage/)
  assert.match(appSource, /PeoplePermissionsPage/)
  assert.match(appSource, /PersonalSecurityPage/)
  assert.match(appSource, /门店总览/)
  assert.match(storeConsoleSource, /ReportSourceConfigPage[\s\S]*canConfigure=\{canConfigure\}/)
  assert.match(storeConsoleSource, /MappingTargetPage[\s\S]*canConfigure=\{canRevenueConfigure\}/)
  assert.match(storeConsoleSource, /HistoryPage[\s\S]*canConfigure=\{canConfigure\}/)
  assert.match(monitorSource, /triggerLiveCollection/)
  assert.doesNotMatch(monitorSource, /confirmBusinessDateAndCollect/)
  assert.doesNotMatch(monitorSource, /loadBusinessDayControl|saveBusinessDayControl/)
  assert.doesNotMatch(monitorSource, /type="date"/)
  assert.doesNotMatch(monitorSource, /collectNow\('automatic'\)/)
  assert.match(monitorSource, /系统会按旺季\/节假日与普通日期的动态时段采集/)
  assert.match(monitorSource, /重新采集已配置报表/)
  assert.match(monitorSource, /进入报表接口核对配置/)
  assert.match(storeConsoleSource, /const connectionTab(?:: StoreTab)? = canConfigure \? 'collection' : 'repair'/)
  assert.match(storeConsoleSource, /setTab\(connectionTab\)/)
  assert.match(storeConsoleSource, /attentionItems=\{\[\]\}/)
  assert.match(monitorSource, /incompleteMonitorAttention/)
  assert.match(monitorSource, /reportSourceGuidance/)
  assert.match(reportSourceSource, /最近一次采集需要核对以下报表/)
  assert.match(reportSourceSource, /定位该报表/)
  assert.match(reportSourceSource, /needs-attention/)
  assert.match(reportSourceSource, /scrollIntoView/)
  assert.match(stylesSource, /\.report-source-attention-panel/)
  assert.match(
    monitorSource,
    /本次仅采集；企微按动态时段在采集完成后约06分推送/,
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

test('store workspaces present business Chinese and keep technical values secondary', () => {
  assert.match(businessDisplaySource, /DAILY_MORNING_REPAIR_FAILED: '每日早间自动修复失败'/)
  assert.match(businessDisplaySource, /COLLECTION_MISSING: '缺少采集数据'/)
  assert.match(historySource, /businessCodeLabel\(message\.deliveryStatus/)
  assert.match(historySource, /className="technical-details"/)
  assert.match(reportSourceSource, /状态总览/)
  assert.match(reportSourceSource, /酒店系统/)
  assert.match(reportSourceSource, /渠道平台/)
  assert.match(reportSourceSource, /高级报表/)
  assert.doesNotMatch(reportSourceSource, />变更原因码</)
  assert.match(storeConsoleSource, /HotSellingRoomConfigPanel/)
  assert.match(hotSellingRoomSource, /热销房型与渠道对应/)
  assert.match(hotSellingRoomSource, /PMS 房型为唯一库存基准/)
  assert.doesNotMatch(hotSellingRoomSource, /热销房型编码/)
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
  assert.match(appSource, /'security'/)
  assert.match(appSource, /PersonalSecurityPage/)
  assert.match(personalSecuritySource, /changeCredentials/)
  assert.match(personalSecuritySource, /currentPassword/)
  assert.match(personalSecuritySource, /newUsername/)
  assert.match(personalSecuritySource, /newPassword/)
  assert.match(personalSecuritySource, /type="password"/)
  assert.match(personalSecuritySource, /旧登录会话已失效/)
  assert.match(authApiSource, /\/auth\/credentials/)
  assert.match(
    authApiSource,
    /Authorization: `Bearer \$\{session\.accessToken\}`/,
  )
  assert.doesNotMatch(personalSecuritySource, /localStorage|sessionStorage/)
  assert.match(peoplePermissionsSource, /新增管理账号/u)
  assert.match(peoplePermissionsSource, /服务端/u)
  assert.match(authApiSource, /\/auth\/accounts/u)
})

test('page startup and token expiry use one cookie-authenticated refresh flight', () => {
  assert.match(authApiSource, /\/auth\/refresh/)
  assert.match(authApiSource, /let refreshInFlight/)
  assert.match(authApiSource, /X-CSRF-TOKEN/)
  assert.match(appSource, /hasRefreshContext\(\)/)
  assert.match(appSource, /refreshSession\(\)/)
  assert.match(appSource, /session\.expiresInSeconds - 60/)
})

test('phase-one public entry keeps the OTA runtime isolated behind an HTTPS subpath', () => {
  assert.match(publicCaddySource, /handle_path \/ota-console\/\*/)
  assert.match(publicCaddySource, /handle_path \/api\/v1\/ota-console\/\*/)
  assert.match(publicCaddySource, /reverse_proxy 127\.0\.0\.1:8091/)
  assert.match(nativeCaddySource, /handle_path \/ota-console\/\*/)
  assert.match(nativeCaddySource, /handle_path \/api\/v1\/ota-console\/\*/)
  assert.match(publishScriptSource, /\$webBasePath = '\/ota-console\/'/)
  assert.match(publishScriptSource, /\$publicApiBaseUrl = '\/api\/v1\/ota-console'/)
  assert.match(publishScriptSource, /configure-public-entry\.sh/)
  assert.match(publishScriptSource, /configure-phase1-runtime\.sh/)
  assert.match(nativeDeploySource, /configure-phase1-runtime\.sh/)
  assert.match(nativeDeploySource, /configure-public-entry\.sh/)
  assert.match(nativeDeploySource, /initialize_phase_one_refresh_state/)
  assert.ok(
    nativeDeploySource.indexOf('initialize_phase_one_refresh_state; then')
      < nativeDeploySource.indexOf('before_fingerprint='),
  )
  assert.ok(
    nativeDeploySource.indexOf('configure-phase1-runtime.sh')
      < nativeDeploySource.indexOf('configure-public-entry.sh'),
  )
  assert.match(nativeDeploySource, /rollback_release \|\| true/)
  assert.doesNotMatch(
    publicEntryScriptSource,
    /systemctl reload sifangguan-ota-web\.service/,
  )
  assert.match(
    publicEntryScriptSource,
    /systemctl restart sifangguan-ota-web\.service/,
  )
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

test('store creation auto-generates the store number and records ownership only', () => {
  assert.match(newStoreWizardSource, /门店编号由系统[^。]*自动生成/)
  assert.doesNotMatch(newStoreWizardSource, /draft\.hotelCode/)
  assert.match(newStoreWizardSource, />所属组织</)
  assert.match(newStoreWizardSource, /value="DIRECT">直营/)
  assert.match(newStoreWizardSource, /value="NON_DIRECT">非直营/)
  assert.doesNotMatch(newStoreWizardSource, /租户编号|租户编码|tenantCode|tenantDisplayName/)
  assert.match(hotelContextSource, />门店编号</)
  assert.doesNotMatch(hotelContextSource, /draft\.hotelCode/)
  assert.doesNotMatch(hotelContextSource, /租户编号|租户编码|tenantReference|tenantDisplayCode/)
  const initializeInput = businessApiSource.slice(
    businessApiSource.indexOf('export function initializeSimulationHotel'),
    businessApiSource.indexOf('export function loadMonitor'),
  )
  assert.doesNotMatch(initializeInput, /tenantCode|tenantDisplayName|hotelCode/)
  assert.match(initializeInput, /ownershipType: HotelOwnershipType/)
})

test('store direct action diagnoses upstream data before reporting a broadcast failure', () => {
  assert.match(storeConsoleSource, /loadBriefs\(context\)/)
  assert.match(storeConsoleSource, /latestBrief\?\.completenessCode === 'COMPLETE'/)
  assert.match(storeConsoleSource, /label: '上游数据待处理', tab: 'collection'/)
  assert.match(storeConsoleSource, /tab: 'collection', label: '检查采集数据'/)
  assert.match(storeConsoleSource, /setTab\(broadcast\.tab\)/)
})

test('new stores can register another PMS vendor without enabling an unsupported collector', () => {
  assert.match(newStoreWizardSource, /code: 'OTHER'/)
  assert.match(newStoreWizardSource, /PMS 厂家名称/)
  assert.match(newStoreWizardSource, /可登记 · 待适配/)
  assert.match(newStoreWizardSource, /pmsSystemName: draft\.pmsSystemName\.trim\(\)/)
  assert.match(reviewApiSource, /'OTHER'/)
  assert.match(reviewApiSource, /pmsSystemName: input\.pmsSystemName/)
  assert.match(reviewApiSource, /input\.pmsSystemCode === 'MEITUAN_BIEYANGHONG'/)
  assert.match(reportSourceSource, /其他 PMS 接入配置/)
})

test('report source administration and scoped revenue configuration stay separate', () => {
  assert.match(appSource, /const platformAdmin = session\.account\.roles\.includes\('PLATFORM_ADMIN'\)/)
  assert.match(appSource, /const canConfigure = platformAdmin/)
  assert.match(appSource, /canRevenueConfigure = platformAdmin[\s\S]*OTA_OPERATION_MANAGER/)
  assert.match(storeConsoleSource, /tab === 'collection' && canConfigure[\s\S]*ReportSourceConfigPage[\s\S]*canConfigure/)
  assert.match(storeConsoleSource, /tab === 'repair'[\s\S]*StoreRepairPanel/)
  assert.match(storeConsoleSource, /MappingTargetPage context=\{context\} canConfigure=\{canRevenueConfigure\}/)
})

test('simulation views fail closed and never sum shared OTA inventory', () => {
  assert.match(monitorSource, /无法判断/)
  assert.match(mappingSource, /以酒店实体可售房量为准/)
  assert.match(mappingSource, /渠道库存只用于核对差异，不会覆盖酒店库存/)
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
  assert.match(reportSourceSource, /saveReportSources\(context, payload, REPORT_SOURCE_CHANGE_REASON\)/)
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
  assert.match(reportSourceSource, /停用后不要求登录凭据或请求内容/)
  assert.match(reviewApiSource, /LUOPAN_REPORT_SOURCE_ENABLED_ONLY/)
  assert.match(reviewApiSource, /reportSourceEnabledToggleOnlyMatch/)
  assert.match(monitorSource, /enabledReportSourceIds\.has\(source\.sourceId\)/)
})

test('OTA sources support encrypted configuration, immediate read-only refresh and direct correction', () => {
  assert.match(reportSourceSource, /OtaSourceConfigPanel/)
  assert.match(otaSourceConfigSource, /OTA后台登录网址/)
  assert.match(otaSourceConfigSource, /填写OTA后台登录网址（可选）/)
  assert.match(otaSourceConfigSource, /仅用于后台快捷跳转，不参与数据采集/)
  assert.match(reviewApiSource, /normalizeOptionalOtaUrl/)
  assert.match(reviewApiSource, /portalUrl: normalizeOptionalOtaUrl/)
  assert.match(otaSourceConfigSource, /渠道数据接口地址（可选）/)
  assert.match(otaSourceConfigSource, /未填写时仅保存OTA渠道资料，不参与自动轮询/)
  assert.match(otaSourceConfigSource, /expandedSourceIds/)
  assert.match(otaSourceConfigSource, /\{expanded \? '收起' : '展开'\}/)
  assert.match(otaSourceConfigSource, /expandedPlatformCodes/)
  assert.match(otaSourceConfigSource, /新增\{group\.label\}数据源/)
  assert.match(otaSourceConfigSource, /新增OTA渠道/)
  assert.match(otaSourceConfigSource, /SOURCE_KIND_LABELS/)
  assert.match(reviewApiSource, /dataEndpointUrl: normalizeOptionalOtaUrl/)
  assert.match(otaSourceConfigSource, /渠道登录凭据/)
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
  const scheduledOtaSourceBlock = reviewApiSource.slice(
    reviewApiSource.indexOf('const scheduledOtaSourceTick'),
    reviewApiSource.indexOf('const deliverWeComSnapshot'),
  )
  assert.match(scheduledOtaSourceBlock, /for \(const hotel of hotels\)/)
  assert.doesNotMatch(scheduledOtaSourceBlock, /collectionEnabled/)
  assert.match(otaSourceConfigSource, /refreshAfterSave/)
  assert.match(otaSourceConfigSource, /dirtySourceIds/)
  assert.doesNotMatch(otaSourceConfigSource, /triggerLiveCollection/)
  assert.match(otaSourceConfigSource, /打开OTA后台/)
  assert.match(otaSourceGuidanceSource, /OTA_RESPONSE_NOT_JSON/)
  assert.match(otaSourceGuidanceSource, /OTA_HTTP_403/)
  assert.match(reviewApiSource, /safeOtaRefreshErrorCode/)
  assert.match(otaSourceCollectorSource, /MEITUAN_EBOOKING_REFERER/)
  assert.match(monitorSource, /OTA排名与评价经营看板/)
  assert.match(monitorSource, /门店全渠道评价总览/)
  assert.match(
    monitorSource,
    /全渠道好评率＝所有已配置渠道截止昨日好评数之和/,
  )
  assert.doesNotMatch(monitorSource, /订单数据看板|未取消订单（分母）/)
  assert.match(monitorSource, /排名实时看板/)
  assert.match(monitorSource, /当前接口未返回竞争圈总数和上期名次/)
  assert.match(monitorSource, /遇到排名空值将在10分钟后补采/)
  assert.match(monitorSource, /平台暂未返回/)
  assert.match(otaSourceCollectorSource, /MEITUAN_PEER_RANK_METRICS/)
  assert.match(otaSourceCollectorSource, /collectFliggySourceSummary/)
  assert.match(fliggySourceCollectorSource, /FLIGGY_STAR_THRESHOLDS/)
  assert.match(fliggySourceCollectorSource, /_m_h5_tk/)
  assert.match(fliggySourceCollectorSource, /OTA_FLIGGY_PAGINATION_STALLED/)
  assert.doesNotMatch(monitorSource, /bestPeerPoiId/)
  assert.match(monitorSource, /直达修改/)
  assert.match(storeConsoleSource, /setTab\(connectionTab\)/)
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

test('Luopan controlled browser collection is single-hotel locked and keeps its session private', () => {
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

test('each saved data-source configuration triggers a scoped collection while manual collection remains available', () => {
  assert.match(reportSourceSource, /saveReportSources[\s\S]*triggerLiveCollection/)
  assert.match(
    reportSourceSource,
    /保存当前门店配置并自动采集一次|保存同步接口并自动采集一次/,
  )
  assert.match(otaSourceConfigSource, /saveOtaSources[\s\S]*refreshAfterSave/)
  assert.doesNotMatch(otaSourceConfigSource, /triggerLiveCollection/)
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
