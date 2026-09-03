#!/usr/bin/env node

import { createServer } from 'node:http'
import {
  createHash,
  createHmac,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from 'node:crypto'
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { createConnection } from 'node:net'
import { dirname, extname, join, resolve, sep } from 'node:path'
import {
  decryptCookie,
  encryptCookie,
} from './report-source-cookie-crypto.mjs'
import { createReviewAuthStore } from './review-auth-store.mjs'
import { collectOtaSource } from './ota-source-collector.mjs'
import {
  mergeRoomTypeCatalogs,
  mergeRoomTypeCatalogsPreserving,
  normalizeStoredRoomTypeMappings,
  validateRoomTypeMappings,
} from './room-type-catalog.mjs'
import {
  builtInFliggyEndpointUrl,
  fliggyBuiltInFallbackSource,
  sanitizeFliggyEndpointUrl,
} from './fliggy-source-collector.mjs'
import {
  fliggyControlledLoginPolicy,
  fliggyCookieHeaderForHost,
  fliggyLoginRateLimitState,
  fliggyMtopTokenAvailable,
  startFliggyControlledLogin,
} from './fliggy-controlled-login.mjs'
import {
  pairOtaReviewAndOrderSources,
} from './ota-review-order-pairing.mjs'
import {
  OTA_DEFAULT_POLL_INTERVAL_MINUTES,
  OTA_POLL_INTERVAL_OPTIONS_MINUTES,
  otaSourcePollingDue,
  otaSourceSchedulerReady,
} from './ota-source-schedule.mjs'
import {
  collectLuopanControlledBrowser,
  validateLuopanBrowserSession,
} from './luopan-controlled-browser-collector.mjs'
import {
  normalizeLuopanSessionState,
} from './luopan-session-state.mjs'
import { startLuopanAssistedLogin } from './luopan-assisted-login.mjs'
import {
  createLuopanRepairChallengeStore,
  luopanRepairLink,
  validateLuopanRepairPublicBaseUrl,
} from './luopan-repair-challenge.mjs'
import {
  renderLuopanRepairClientScript,
  renderLuopanRepairPage,
} from './luopan-repair-page.mjs'
import { startBieyanghongAssistedLogin } from './bieyanghong-assisted-login.mjs'
import {
  bieyanghongBrowserBrokerConfig,
  bieyanghongBrowserBrokerReady,
  startBieyanghongBrokeredLogin,
} from './bieyanghong-browser-broker-client.mjs'
import {
  bieyanghongRepairLink,
  createBieyanghongRepairChallengeStore,
  validateBieyanghongRepairPublicBaseUrl,
} from './bieyanghong-repair-challenge.mjs'
import {
  renderBieyanghongOfficialLoginClientScript,
  renderBieyanghongOfficialLoginPage,
  renderBieyanghongRepairClientScript,
  renderBieyanghongRepairPage,
} from './bieyanghong-repair-page.mjs'
import {
  BIEYANGHONG_RECOVERY_HOTEL_CODES,
  normalizeBieyanghongRecoveryRequest,
  recoveryDeliveryDecision,
  resolveBieyanghongRecoveryTargets,
  safeBieyanghongRecoveryReason,
} from './bieyanghong-targeted-recovery.mjs'
import {
  appendAndPersistSnapshot,
  collectLiveReports,
  loadSnapshotStore,
  monitorFromSnapshot,
} from './live-report-collector.mjs'
import {
  buildStoreRepairConsoleUrl,
  pmsRepairIncidentFor,
  pmsRepairNoticeContent,
  pmsRepairNoticeMessageKey,
} from './pms-repair-alert.mjs'
import {
  createTrustedDeviceIntakeStore,
  stableJson,
  TRUSTED_DEVICE_PILOT_HOTEL_CODE,
  validateTrustedDeviceSnapshot,
} from './trusted-device-intake.mjs'
import { renderTrustedDeviceBootstrapCommand } from './trusted-device-bootstrap.mjs'
import {
  briefingCycleSnapshots,
  briefingSnapshotsObservedAfter,
  collectionSlotFor,
  isBriefDeliveryTime,
  isBroadcastWindowOpen,
  shanghaiScheduleParts,
} from './report-schedule.mjs'
import {
  hourlyDeliveryMessageKey,
  selectHourlyDeliveryCandidates,
} from './wecom/src/hourly-delivery-candidates.mjs'
import {
  createFutureBookingWeComPayloadsWithAi,
} from './wecom/src/future-booking-brief.mjs'
import {
  futureBookingAiConfigFromEnv,
  futureBookingAiPublicStatus,
} from './wecom/src/future-booking-ai-advice.mjs'
import {
  createFutureDemandP1WeComPayloads,
  futureDemandRiskStateAfterDelivery,
  reconcileFutureDemandRiskStates,
  selectFutureDemandRiskCandidates,
} from './wecom/src/future-demand-risk.mjs'
import {
  createHotSellingSoldOutWeComPayloads,
  hourlyBriefBundleDelivered,
  selectHotSellingSoldOutAlerts,
} from './wecom/src/hot-selling-sold-out-alert.mjs'
import { createReportMonitorWeComPayloads } from './wecom/src/report-monitor-brief.mjs'
import {
  fingerprintWeComWebhook,
  sendWeComGroupRobotMessage,
  sha256,
} from './wecom/src/wecom-group-robot.mjs'
import { createWeComTestSuitePlan } from './wecom/src/wecom-test-suite.mjs'
import {
  MANUAL_REPLAY_MESSAGE_PREFIX,
  manualReplayDeliveryDecision,
  manualReplayDeliveryView,
  manualReplayMessageKey,
  normalizeManualReplayRequest,
  safeManualReplayFailureReason,
  selectLatestAuthoritativeCompleteSnapshot,
} from './wecom-manual-replay.mjs'
import {
  auditBriefingStore,
  dailyBriefingAuditSlot,
  dailyBriefingRepairSlot,
  isNightlyRepairDeferred,
} from './wecom/src/briefing-delivery-audit.mjs'
import {
  createWeComRepairBotPairingStore,
  createWeComRepairBotRuntime,
  deliverWeComRepairBotToAllowedUsers,
  fingerprintWeComRepairBotValue,
  normalizeWeComRepairBotCredentials,
  parseWeComRepairBotText,
  planWeComRepairNoticeDeliveries,
  selectWeComRepairNoticeChannels,
  shouldFanOutWeComRepairNotice,
  WECOM_REPAIR_BOT_MAX_ALLOWED_USERS,
  WECOM_REPAIR_BOT_MAX_STORE_USERS,
  weComRepairBotRecipientsForHotel,
} from './wecom/src/wecom-repair-bot.mjs'

const host = '127.0.0.1'
const port = Number.parseInt(process.env.OTA_REVIEW_API_PORT ?? '8091', 10)
const bootstrapUsername = process.env.OTA_REVIEW_USERNAME
const bootstrapPassword = process.env.OTA_REVIEW_PASSWORD
const bootstrapAccessToken = process.env.OTA_REVIEW_ACCESS_TOKEN
const dataPath = process.env.OTA_REVIEW_DATA_PATH?.trim()
const cookieSecretsPath =
  process.env.OTA_REVIEW_COOKIE_SECRETS_PATH?.trim()
const cookieSecretKey = process.env.OTA_REVIEW_SECRET_KEY?.trim()
const pseudonymSecretKey =
  process.env.OTA_REVIEW_PSEUDONYM_SECRET_KEY?.trim()
const automaticHourlyCollectionEnabled =
  process.env.OTA_REVIEW_AUTO_COLLECTION_ENABLED === 'true'
const runtimeMode =
  process.env.OTA_REVIEW_RUNTIME_MODE === 'LOCAL_LIVE_LONG_RUNNING'
    ? 'LOCAL_LIVE_LONG_RUNNING'
    : 'LOCAL_LIVE_PILOT'
const futureBookingAiConfig = futureBookingAiConfigFromEnv(process.env)
const futureBookingAiStatus =
  futureBookingAiPublicStatus(futureBookingAiConfig)
const luopanAssistedRepairEnabled =
  process.env.OTA_REVIEW_LUOPAN_ASSISTED_REAUTH_ENABLED === 'true'
let luopanRepairPublicBaseUrl = null
let luopanWebRepairConfigurationReason =
  luopanAssistedRepairEnabled
    ? 'LUOPAN_REPAIR_PUBLIC_URL_REQUIRED'
    : 'LUOPAN_REPAIR_DISABLED'
try {
  luopanRepairPublicBaseUrl = validateLuopanRepairPublicBaseUrl(
    process.env.OTA_REVIEW_REPAIR_PUBLIC_BASE_URL,
  )
  if (luopanAssistedRepairEnabled && luopanRepairPublicBaseUrl) {
    luopanWebRepairConfigurationReason = null
  }
} catch {
  luopanWebRepairConfigurationReason = 'LUOPAN_REPAIR_PUBLIC_URL_INVALID'
}
const luopanWebRepairReady =
  luopanAssistedRepairEnabled
  && Boolean(luopanRepairPublicBaseUrl)
  && !luopanWebRepairConfigurationReason
const BIEYANGHONG_REPAIR_PILOT_HOTEL_CODE = '001'
const BIEYANGHONG_ADMIN_WORKSPACE_TTL_MS = 45 * 60_000
const bieyanghongAssistedRepairEnabled =
  process.env.OTA_REVIEW_BIEYANGHONG_ASSISTED_REAUTH_ENABLED === 'true'
let bieyanghongRepairPublicBaseUrl = null
let bieyanghongRepairConfigurationReason =
  bieyanghongAssistedRepairEnabled
    ? 'BIEYANGHONG_REPAIR_PUBLIC_URL_REQUIRED'
    : 'BIEYANGHONG_REPAIR_DISABLED'
try {
  bieyanghongRepairPublicBaseUrl =
    validateBieyanghongRepairPublicBaseUrl(
      process.env.OTA_REVIEW_BIEYANGHONG_REPAIR_PUBLIC_BASE_URL,
    )
  if (bieyanghongAssistedRepairEnabled && bieyanghongRepairPublicBaseUrl) {
    bieyanghongRepairConfigurationReason = null
  }
} catch {
  bieyanghongRepairConfigurationReason =
    'BIEYANGHONG_REPAIR_PUBLIC_URL_INVALID'
}
const bieyanghongWebRepairReady =
  bieyanghongAssistedRepairEnabled
  && Boolean(bieyanghongRepairPublicBaseUrl)
  && !bieyanghongRepairConfigurationReason
const trustedDeviceEnabled =
  process.env.OTA_REVIEW_TRUSTED_DEVICE_ENABLED !== 'false'
  && process.env.OTA_REVIEW_TRUSTED_DEVICE_001_ENABLED !== 'false'
const trustedDeviceFixedHotelCodes = new Set(['001', '003', '013'])
const trustedDeviceAllowedHotelCodes = new Set(
  String(
    process.env.OTA_REVIEW_TRUSTED_DEVICE_HOTEL_CODES ?? '001,003,013',
  ).split(',').map((value) => value.trim().toUpperCase()).filter((value) =>
    trustedDeviceFixedHotelCodes.has(value)),
)
const liveSnapshotPath = dataPath
  ? join(dirname(dataPath), 'live-report-snapshots.json')
  : null
const businessDayControlPath = dataPath
  ? join(dirname(dataPath), 'business-day-controls.json')
  : null
const hotSellingRoomTypePath = dataPath
  ? join(dirname(dataPath), 'hot-selling-room-types.json')
  : null
const roomTypeMappingPath = dataPath
  ? join(dirname(dataPath), 'room-type-mappings.json')
  : null
const otaRoomTypeCatalogPath = dataPath
  ? join(dirname(dataPath), 'ota-room-type-catalogs.json')
  : null
const simulationHotelPath = dataPath
  ? join(dirname(dataPath), 'simulation-hotels.json')
  : null
const pmsLoginSecretPath = dataPath
  ? join(dirname(dataPath), 'pms-login-secrets.json')
  : null
const otaSourceConfigPath = dataPath
  ? join(dirname(dataPath), 'ota-source-configs.json')
  : null
const otaSourceSecretPath = dataPath
  ? join(dirname(dataPath), 'ota-source-secrets.json')
  : null
const luopanBrowserConfigPath = dataPath
  ? join(dirname(dataPath), 'luopan-browser-configs.json')
  : null
const luopanSessionSecretPath = dataPath
  ? join(dirname(dataPath), 'luopan-session-secrets.json')
  : null
const bieyanghongBrowserProfileBase =
  process.env.BIEYANGHONG_BROWSER_PROFILE_BASE?.trim()
  || (dataPath ? join(dirname(dataPath), 'bieyanghong-browser-profiles') : null)
const trustedDeviceStateDirectory = dataPath
  ? dirname(dataPath)
  : null
const trustedDevicePublicOrigin = (() => {
  const configured =
    process.env.OTA_REVIEW_TRUSTED_DEVICE_PUBLIC_BASE_URL?.trim()
    || 'https://www.sfgzt.cn'
  try {
    const parsed = new URL(configured)
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password) {
      throw new Error('TRUSTED_DEVICE_SERVER_ORIGIN_INVALID')
    }
    return parsed.origin
  } catch {
    process.stderr.write('TRUSTED_DEVICE_SERVER_ORIGIN_INVALID\n')
    process.exit(2)
  }
})()
const storeRepairConsoleUrlFor = (hotel) => buildStoreRepairConsoleUrl({
  publicOrigin: trustedDevicePublicOrigin,
  hotelCode: hotel.hotelCode,
})
const bieyanghongRemoteDesktopConfig = Object.freeze({
  enabled: process.env.BIEYANGHONG_REMOTE_DESKTOP_ENABLED === 'true',
  display: process.env.BIEYANGHONG_REMOTE_DESKTOP_DISPLAY?.trim() || ':91',
  width: process.env.BIEYANGHONG_REMOTE_DESKTOP_WIDTH,
  height: process.env.BIEYANGHONG_REMOTE_DESKTOP_HEIGHT,
  vncPort: process.env.BIEYANGHONG_REMOTE_DESKTOP_VNC_PORT,
  webSocketPort: process.env.BIEYANGHONG_REMOTE_DESKTOP_WEBSOCKET_PORT,
  xvfbExecutable:
    process.env.BIEYANGHONG_XVFB_EXECUTABLE?.trim() || '/usr/bin/Xvfb',
  x11vncExecutable:
    process.env.BIEYANGHONG_X11VNC_EXECUTABLE?.trim() || '/usr/bin/x11vnc',
  websockifyExecutable:
    process.env.BIEYANGHONG_WEBSOCKIFY_EXECUTABLE?.trim()
    || '/usr/bin/websockify',
})
const bieyanghongNoVncRoot =
  process.env.BIEYANGHONG_NOVNC_ROOT?.trim() || '/usr/share/novnc'
const bieyanghongRemoteDesktopReady = () =>
  !bieyanghongRemoteDesktopConfig.enabled
  || (
    existsSync(bieyanghongNoVncRoot)
    && bieyanghongBrowserBrokerConfig.enabled
    && bieyanghongBrowserBrokerReady()
  )
const weComConfigPath = dataPath
  ? join(dirname(dataPath), 'wecom-configs.json')
  : null
const weComSecretPath = dataPath
  ? join(dirname(dataPath), 'wecom-webhook-secrets.json')
  : null
const weComDeliveryPath = dataPath
  ? join(dirname(dataPath), 'wecom-deliveries.json')
  : null
const briefingHealthAuditPath = dataPath
  ? join(dirname(dataPath), 'briefing-health-audits.json')
  : null
const futureDemandRiskStatePath = dataPath
  ? join(dirname(dataPath), 'future-demand-risk-states.json')
  : null
const weComRepairBotConfigPath = dataPath
  ? join(dirname(dataPath), 'wecom-repair-bot-config.json')
  : null
const weComRepairBotSecretPath = dataPath
  ? join(dirname(dataPath), 'wecom-repair-bot-secrets.json')
  : null
const authStatePath =
  process.env.OTA_REVIEW_AUTH_STATE_PATH?.trim()
  || (
    dataPath || cookieSecretsPath
      ? join(
        dirname(dataPath || cookieSecretsPath),
        'review-auth-state.json',
      )
      : null
  )
const authRefreshStatePath =
  process.env.OTA_REVIEW_AUTH_REFRESH_STATE_PATH?.trim()
  || (authStatePath ? join(dirname(authStatePath), 'review-auth-sessions.json') : null)
const securityAuditPath =
  process.env.OTA_REVIEW_SECURITY_AUDIT_PATH?.trim()
  || (dataPath ? join(dirname(dataPath), 'security-audit.jsonl') : null)
const authCookiePath =
  process.env.OTA_REVIEW_AUTH_COOKIE_PATH?.trim()
  || '/api/v1/auth'
const authCookieSecure =
  process.env.OTA_REVIEW_AUTH_COOKIE_SECURE !== 'false'
const allowedBrowserOrigins = new Set(
  (process.env.OTA_REVIEW_ALLOWED_ORIGINS
    ?? 'https://www.sfgzt.cn,http://127.0.0.1:15180')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean),
)

if (
  !Number.isInteger(port)
  || port < 1024
  || port > 65535
  || !bootstrapUsername
  || !bootstrapPassword
  || !bootstrapAccessToken
  || !authStatePath
  || !authRefreshStatePath
  || !securityAuditPath
  || !authCookiePath.startsWith('/')
  || authCookiePath.includes('..')
  || !cookieSecretsPath
  || !cookieSecretKey
  || Buffer.from(pseudonymSecretKey ?? '', 'base64url').length !== 32
) {
  process.stderr.write('REVIEW_API_CONFIGURATION_INVALID\n')
  process.exit(2)
}

const authStore = createReviewAuthStore({
  statePath: authStatePath,
  refreshStatePath: authRefreshStatePath,
  bootstrapUsername,
  bootstrapPassword,
  bootstrapAccessToken,
})

const tenantId = '10000000-0000-4000-8000-000000000001'
const hotels = [
  {
    tenantId,
    hotelId: '20000000-0000-4000-8000-000000000001',
    tenantCode: '001',
    tenantName: '四方馆酒店管理',
    hotelCode: '001',
    hotelName: '喷水池态六酒店',
    ownershipType: 'DIRECT',
    pmsSystemCode: 'MEITUAN_BIEYANGHONG',
    pmsSystemName: '美团别样红 PMS',
    timezone: 'Asia/Shanghai',
    lifecycleStatus: 'PILOT',
    collectionEnabled: true,
    messageEnabled: false,
    configuredMockConnectors: 2,
    simulationOnly: true,
    rowVersion: 3,
  },
  {
    tenantId,
    hotelId: '20000000-0000-4000-8000-000000000002',
    tenantCode: '001',
    tenantName: '四方馆酒店管理',
    hotelCode: '002',
    hotelName: '解放路MOOODSHIFT酒店',
    ownershipType: 'DIRECT',
    pmsSystemCode: 'LUOPAN_CLOUD',
    pmsSystemName: '罗盘 PMS',
    timezone: 'Asia/Shanghai',
    lifecycleStatus: 'PILOT',
    collectionEnabled: true,
    messageEnabled: false,
    configuredMockConnectors: 2,
    simulationOnly: true,
    rowVersion: 2,
  },
]

const adapters = [
  {
    code: 'CTRIP_SIM',
    displayName: '携程辅助报表（可选）',
    sourceSystem: 'CTRIP',
    simulationOnly: true,
    streams: ['订单间夜', '取消间夜', '售卖产品库存'],
  },
  {
    code: 'MEITUAN_SIM',
    displayName: '美团辅助报表（可选）',
    sourceSystem: 'MEITUAN',
    simulationOnly: true,
    streams: ['订单间夜', '取消间夜', '售卖产品库存'],
  },
]

const onboardingTemplates = [
  {
    templateCode: 'CTRIP_INTAKE',
    displayName: '携程接入资料',
    sourceCode: 'CTRIP',
    implementationStatus: 'DRAFT_INTAKE_ONLY',
    connectionMethods: ['OFFICIAL_API', 'CONTROLLED_BROWSER'],
    allowedPollIntervalsMinutes: [5, 10, 15],
    acceptedFields: ['externalHotelCode', 'accountAlias'],
    executable: false,
  },
  {
    templateCode: 'MEITUAN_INTAKE',
    displayName: '美团接入资料',
    sourceCode: 'MEITUAN',
    implementationStatus: 'DRAFT_INTAKE_ONLY',
    connectionMethods: ['OFFICIAL_API', 'CONTROLLED_BROWSER'],
    allowedPollIntervalsMinutes: [5, 10, 15],
    acceptedFields: ['externalHotelCode', 'accountAlias'],
    executable: false,
  },
]

const simulationRuns = new Map()
const reportSourcesByHotel = new Map()
const cookieSecretsByHotel = new Map()
const pmsLoginSecretsByHotel = new Map()
const otaSourcesByHotel = new Map()
const otaSourceSecretsByHotel = new Map()
const otaSourceRefreshLocks = new Map()
const otaControlledLoginLocks = new Map()
const activeOtaControlledLoginAttempts = new Map()
const luopanBrowserConfigsByHotel = new Map()
const luopanSessionStatesByHotel = new Map()
const liveCollectionLocks = new Map()
const bieyanghongTargetedRecoveryLocks = new Map()
const bieyanghongTargetedRecoveryResults = new Map()
const liveSnapshotStore = loadSnapshotStore(liveSnapshotPath)
const businessDayControlsByHotel = new Map()
const hotSellingRoomTypesByHotel = new Map()
const otaRoomTypeCatalogsByHotel = new Map()
const weComConfigsByHotel = new Map()
const weComSecretsByHotel = new Map()
const weComDeliveriesByKey = new Map()
const weComDeliveryLocks = new Map()
const weComManualReplayLocks = new Map()
const futureDemandRiskStates = {}
const briefingHealthAudits = []
const lastScheduledCollectionSlotByHotel = new Map()
const luopanRepairChallengeStore = createLuopanRepairChallengeStore()
const activeLuopanRepairsByHotel = new Map()
const bieyanghongRepairChallengeStore =
  createBieyanghongRepairChallengeStore()
const activeBieyanghongRepairsByHotel = new Map()
const weComRepairBotPairingStore = createWeComRepairBotPairingStore()
const seenWeComRepairBotMessageHashes = new Map()
const lastScheduledLuopanRecoveryAtByHotel = new Map()
let scheduledLuopanRecoveryRunning = false
let weComRepairBotConfig = {
  enabled: false,
  botIdSha256: null,
  allowedUserIdSha256: null,
  allowedUserIdSha256s: [],
  hotelAllowedUserIdSha256s: {},
  updatedAt: null,
}
let weComRepairBotCredentials = null
let weComRepairBotRuntime = null
const lastDailyBriefingAuditKeyByHotel = new Map()
const lastDailyBriefingRepairKeyByHotel = new Map()
const schedulerStartedAt = new Date()
const REPORT_POLL_INTERVAL_MINUTES = 30
const WECOM_DELIVERY_RETENTION_LIMIT = 5_000
const BRIEFING_HEALTH_AUDIT_RETENTION_MS = 366 * 24 * 60 * 60_000
const LUOPAN_AUTO_RECOVERY_RETRY_MS = 30 * 60_000
const LUOPAN_REPAIR_SUBMISSION_TIMEOUT_MS = 45_000
const BIEYANGHONG_REPAIR_SUBMISSION_TIMEOUT_MS = 45_000
const BIEYANGHONG_VNC_COOKIE = 'sfg_bieyanghong_vnc'
const BIEYANGHONG_VNC_COOKIE_PATH = '/api/v1/bieyanghong-repair/vnc'
const BIEYANGHONG_NOVNC_ROUTE_PREFIX =
  '/api/v1/bieyanghong-repair/novnc/'
const BIEYANGHONG_VNC_SESSION_TTL_MS = 10 * 60_000
const BIEYANGHONG_NOVNC_CONTENT_TYPES = Object.freeze({
  '.css': 'text/css; charset=utf-8',
  '.gif': 'image/gif',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
})

const SIMULATION_HOTEL_CODE = /^[A-Z0-9][A-Z0-9_-]{0,15}$/
const SIMULATION_HOTEL_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const PMS_SYSTEM_CODES = new Set([
  'MEITUAN_BIEYANGHONG',
  'LUOPAN_CLOUD',
  'OTHER',
])
const HOTEL_OWNERSHIP_TYPES = new Set(['DIRECT', 'NON_DIRECT'])
const PMS_SYSTEM_NAMES = Object.freeze({
  MEITUAN_BIEYANGHONG: '美团别样红 PMS',
  LUOPAN_CLOUD: '罗盘 PMS',
})

const inferredPmsSystemCode = ({ tenantCode, hotelCode }) =>
  tenantCode === '001' && hotelCode === '002'
    ? 'LUOPAN_CLOUD'
    : 'MEITUAN_BIEYANGHONG'

const normalizeSimulationHotel = (candidate) => {
  if (!candidate || typeof candidate !== 'object') return null
  const tenantCode = typeof candidate.tenantCode === 'string'
    ? candidate.tenantCode.trim().toUpperCase()
    : ''
  const hotelCode = typeof candidate.hotelCode === 'string'
    ? candidate.hotelCode.trim().toUpperCase()
    : ''
  const tenantName = typeof candidate.tenantName === 'string'
    ? candidate.tenantName.trim()
    : ''
  const hotelName = typeof candidate.hotelName === 'string'
    ? candidate.hotelName.trim()
    : ''
  const timezone = typeof candidate.timezone === 'string'
    ? candidate.timezone.trim()
    : ''
  const pmsSystemCode = PMS_SYSTEM_CODES.has(candidate.pmsSystemCode)
    ? candidate.pmsSystemCode
    : inferredPmsSystemCode({ tenantCode, hotelCode })
  const pmsSystemName = typeof candidate.pmsSystemName === 'string'
    && candidate.pmsSystemName.trim()
    ? candidate.pmsSystemName.trim()
    : PMS_SYSTEM_NAMES[pmsSystemCode]
  const ownershipType = HOTEL_OWNERSHIP_TYPES.has(candidate.ownershipType)
    ? candidate.ownershipType
    : 'DIRECT'
  if (
    !SIMULATION_HOTEL_ID.test(candidate.tenantId)
    || !SIMULATION_HOTEL_ID.test(candidate.hotelId)
    || !SIMULATION_HOTEL_CODE.test(tenantCode)
    || !SIMULATION_HOTEL_CODE.test(hotelCode)
    || tenantName.length < 1
    || tenantName.length > 80
    || hotelName.length < 1
    || hotelName.length > 80
    || typeof pmsSystemName !== 'string'
    || pmsSystemName.length < 1
    || pmsSystemName.length > 80
    || !timezone
  ) {
    return null
  }
  try {
    Intl.DateTimeFormat(undefined, { timeZone: timezone })
  } catch {
    return null
  }
  return {
    tenantId: candidate.tenantId,
    hotelId: candidate.hotelId,
    tenantCode,
    tenantName,
    hotelCode,
    hotelName,
    ownershipType,
    pmsSystemCode,
    pmsSystemName,
    timezone,
    lifecycleStatus:
      typeof candidate.lifecycleStatus === 'string'
      && /^[A-Z][A-Z0-9_]{2,39}$/.test(candidate.lifecycleStatus)
        ? candidate.lifecycleStatus
        : 'PILOT',
    collectionEnabled: candidate.collectionEnabled !== false,
    messageEnabled: false,
    configuredMockConnectors: Number.isInteger(candidate.configuredMockConnectors)
      ? Math.min(Math.max(candidate.configuredMockConnectors, 0), 3)
      : 2,
    simulationOnly: true,
    rowVersion: Number.isInteger(candidate.rowVersion) && candidate.rowVersion > 0
      ? candidate.rowVersion
      : 1,
  }
}

const normalizeSimulationHotelInput = (body) => {
  if (!body || typeof body !== 'object') return null
  const tenantCode = typeof body.tenantCode === 'string'
    ? body.tenantCode.trim().toUpperCase()
    : null
  const hotelCode = typeof body.hotelCode === 'string' && body.hotelCode.trim()
    ? body.hotelCode.trim().toUpperCase()
    : null
  const tenantName = typeof body.tenantDisplayName === 'string'
    ? body.tenantDisplayName.trim()
    : null
  const hotelName = typeof body.hotelDisplayName === 'string'
    ? body.hotelDisplayName.trim()
    : ''
  const timezone = typeof body.timezone === 'string'
    ? body.timezone.trim()
    : ''
  const pmsSystemCode = PMS_SYSTEM_CODES.has(body.pmsSystemCode)
    ? body.pmsSystemCode
    : null
  const ownershipType = HOTEL_OWNERSHIP_TYPES.has(body.ownershipType)
    ? body.ownershipType
    : 'DIRECT'
  const suppliedPmsSystemName = typeof body.pmsSystemName === 'string'
    ? body.pmsSystemName.trim()
    : ''
  const pmsSystemName = pmsSystemCode === 'OTHER'
    ? suppliedPmsSystemName
    : PMS_SYSTEM_NAMES[pmsSystemCode]
  if (
    (tenantCode !== null && !SIMULATION_HOTEL_CODE.test(tenantCode))
    || (tenantName !== null && (tenantName.length < 1 || tenantName.length > 80))
    || ((tenantCode === null) !== (tenantName === null))
    || (hotelCode !== null && !SIMULATION_HOTEL_CODE.test(hotelCode))
    || hotelName.length < 1
    || hotelName.length > 80
    || typeof body.reasonCode !== 'string'
    || !/^[A-Z0-9][A-Z0-9_-]{1,63}$/.test(body.reasonCode)
    || !pmsSystemCode
    || typeof pmsSystemName !== 'string'
    || pmsSystemName.length < 1
    || pmsSystemName.length > 80
  ) {
    return null
  }
  try {
    Intl.DateTimeFormat(undefined, { timeZone: timezone })
  } catch {
    return null
  }
  let pmsCredentials = null
  if (pmsSystemCode === 'LUOPAN_CLOUD') {
    try {
      pmsCredentials = normalizePmsLoginCredentials({
        username: body.pmsUsername,
        password: body.pmsPassword,
      })
    } catch {
      return null
    }
  }
  return {
    tenantCode,
    tenantName,
    hotelCode,
    hotelName,
    ownershipType,
    pmsSystemCode,
    pmsSystemName,
    pmsCredentials,
    timezone,
  }
}

const nextSimulationHotelCode = () => {
  const highest = hotels.reduce((maximum, hotel) => {
    if (!/^\d{3}$/.test(hotel.hotelCode)) return maximum
    return Math.max(maximum, Number(hotel.hotelCode))
  }, 0)
  if (highest >= 999) throw new Error('SIMULATION_HOTEL_CODE_EXHAUSTED')
  return String(highest + 1).padStart(3, '0')
}

const persistSimulationHotels = () => {
  if (!simulationHotelPath) return
  mkdirSync(dirname(simulationHotelPath), { recursive: true })
  const temporaryPath = `${simulationHotelPath}.${process.pid}.tmp`
  writeFileSync(
    temporaryPath,
    `${JSON.stringify(hotels, null, 2)}\n`,
    { encoding: 'utf8', mode: 0o600 },
  )
  renameSync(temporaryPath, simulationHotelPath)
}

if (simulationHotelPath && existsSync(simulationHotelPath)) {
  try {
    const persistedHotels = JSON.parse(readFileSync(simulationHotelPath, 'utf8'))
    if (Array.isArray(persistedHotels)) {
      const restored = persistedHotels
        .map(normalizeSimulationHotel)
        .filter((hotel) => hotel !== null)
        .slice(0, 100)
      if (restored.length > 0) {
        hotels.splice(0, hotels.length, ...restored)
      }
    }
  } catch {
    process.stderr.write('REVIEW_SIMULATION_HOTEL_STORE_IGNORED\n')
  }
}

const trustedDeviceEligible = (hotel) =>
  trustedDeviceEnabled
  && hotel?.pmsSystemCode === 'MEITUAN_BIEYANGHONG'
  && trustedDeviceAllowedHotelCodes.has(hotel.hotelCode)
  && hotels.filter((candidate) =>
    candidate.hotelCode === hotel.hotelCode
    && candidate.pmsSystemCode === 'MEITUAN_BIEYANGHONG').length === 1
const trustedDeviceIntakeStores = new Map()
const trustedDeviceStatePathFor = (hotel) => {
  if (!trustedDeviceStateDirectory) return null
  return hotel.hotelCode === TRUSTED_DEVICE_PILOT_HOTEL_CODE
    ? join(trustedDeviceStateDirectory, 'trusted-device-registry.json')
    : join(
        trustedDeviceStateDirectory,
        `trusted-device-registry-${hotel.hotelCode.toLowerCase()}.json`,
      )
}
const trustedDeviceStoreScopeSecretScope = (hotel) =>
  `trusted-device-store-scope:${hotel.tenantId}:${hotel.hotelId}`
const trustedDeviceProofKeySecretScope = (hotel, deviceId) =>
  `trusted-device-proof-key:${hotel.tenantId}:${hotel.hotelId}:${deviceId}`
const trustedDeviceStoreFor = (hotel) => {
  if (!trustedDeviceEligible(hotel)) return null
  const existing = trustedDeviceIntakeStores.get(hotel.hotelId)
  if (existing) return existing
  const created = createTrustedDeviceIntakeStore({
    path: trustedDeviceStatePathFor(hotel),
    hotel,
    sealStoreScope: (value) => encryptCookie(
      value,
      cookieSecretKey,
      trustedDeviceStoreScopeSecretScope(hotel),
    ),
    openStoreScope: (record) => decryptCookie(
      record,
      cookieSecretKey,
      trustedDeviceStoreScopeSecretScope(hotel),
    ),
    sealDeviceScopeProofKey: (value, deviceId) => encryptCookie(
      value,
      cookieSecretKey,
      trustedDeviceProofKeySecretScope(hotel, deviceId),
    ),
    openDeviceScopeProofKey: (record, deviceId) => decryptCookie(
      record,
      cookieSecretKey,
      trustedDeviceProofKeySecretScope(hotel, deviceId),
    ),
  })
  trustedDeviceIntakeStores.set(hotel.hotelId, created)
  return created
}
const trustedDeviceCutoverReady = (hotel) =>
  Boolean(trustedDeviceStoreFor(hotel)?.status().device?.cutoverReady)
const trustedDeviceLegacyCollectionBlocked = (hotel) =>
  Boolean(trustedDeviceStoreFor(hotel)?.legacyCollectionBlocked())
const trustedDeviceHotelCodeFromBody = (body) => {
  if (
    !body
    || typeof body !== 'object'
    || Array.isArray(body)
    || typeof body.hotelCode !== 'string'
    || !/^[A-Z0-9][A-Z0-9_-]{0,15}$/u.test(body.hotelCode)
  ) throw new Error('TRUSTED_DEVICE_HOTEL_SCOPE_INVALID')
  return body.hotelCode
}
const trustedDeviceHotelForCode = (hotelCode) => {
  const matches = hotels.filter((hotel) =>
    trustedDeviceEligible(hotel) && hotel.hotelCode === hotelCode)
  if (matches.length !== 1) {
    throw new Error(
      matches.length === 0
        ? 'TRUSTED_DEVICE_HOTEL_NOT_FOUND'
        : 'TRUSTED_DEVICE_HOTEL_SCOPE_AMBIGUOUS',
    )
  }
  return matches[0]
}
const trustedDeviceNotApplicableStatus = (hotel) => ({
  eligible: false,
  mode: 'NOT_APPLICABLE',
  hotelCode: hotel?.hotelCode ?? '',
  hotelName: hotel?.hotelName ?? '',
  enrollmentTtlMinutes: 15,
  enrollmentPending: false,
  enrollmentExpiresAt: null,
  device: null,
})
for (const hotel of hotels.filter(trustedDeviceEligible)) {
  trustedDeviceStoreFor(hotel)
}

const defaultReportSources = () => [
  {
    sourceId: '34000000-0000-4000-8000-000000000001',
    displayName: '订单明细报表 jd01',
    endpointUrl: 'https://pms.meituan.com/hotelpms/api/v1/report/jd01',
    reportType: 'ORDER_DETAIL',
    calculationRole: 'PRIMARY_CALCULATION',
    pollIntervalMinutes: REPORT_POLL_INTERVAL_MINUTES,
    credentialAlias: 'REPORT_READER_ORDERS',
    requestPayloadJson: '',
    cookieConfigured: false,
    cookieUpdatedAt: null,
    enabled: true,
    validationStatus: 'FORMAT_VALID',
    rowVersion: 1,
  },
  {
    sourceId: '34000000-0000-4000-8000-000000000002',
    displayName: '实体房型库存报表',
    endpointUrl:
      'https://pms.meituan.com/hotelpms/api/v1/report/lion/manager/workbench/room',
    reportType: 'PHYSICAL_INVENTORY',
    calculationRole: 'PRIMARY_CALCULATION',
    pollIntervalMinutes: REPORT_POLL_INTERVAL_MINUTES,
    credentialAlias: 'REPORT_READER_INVENTORY',
    requestPayloadJson: '',
    cookieConfigured: false,
    cookieUpdatedAt: null,
    enabled: true,
    validationStatus: 'FORMAT_VALID',
    rowVersion: 1,
  },
  {
    sourceId: '27f5ead0-11a3-4131-87ce-7ba9d7ff0ce0',
    displayName: '经营概览（房费/ADR/RevPAR）',
    endpointUrl:
      'https://pms.meituan.com/hotelpms/api/v1/report/home/workbench/businessOverview',
    reportType: 'CUSTOM_REPORT',
    calculationRole: 'AUXILIARY_CALCULATION',
    pollIntervalMinutes: REPORT_POLL_INTERVAL_MINUTES,
    credentialAlias: '',
    requestPayloadJson: '',
    cookieConfigured: false,
    cookieUpdatedAt: null,
    enabled: true,
    validationStatus: 'FORMAT_VALID',
    rowVersion: 1,
  },
  {
    sourceId: '94c0b6ee-2ee4-421f-a9e8-d1fa38a352a9',
    displayName: '房态预测表（分房型可售）',
    endpointUrl:
      'https://pms.meituan.com/hotelpms/api/v2/report/roomState/batchSearchBaseRoomForcasting',
    reportType: 'PHYSICAL_INVENTORY',
    calculationRole: 'PRIMARY_CALCULATION',
    pollIntervalMinutes: REPORT_POLL_INTERVAL_MINUTES,
    credentialAlias: '',
    requestPayloadJson: '',
    cookieConfigured: false,
    cookieUpdatedAt: null,
    enabled: true,
    validationStatus: 'FORMAT_VALID',
    rowVersion: 1,
  },
]

const primaryReportSourceHotel = () =>
  hotels.find((hotel) =>
    hotel.tenantCode === '001' && hotel.hotelCode === '001')
  ?? hotels[0]

const cloneReportSourceDefinitions = (
  sources,
  hotelSources = [],
  { preserveEnabled = false } = {},
) => {
  const hotelSourcesBySourceId = new Map(
    hotelSources.map((source) => [source.sourceId, source]),
  )
  return sources.map((source) => ({
    sourceId: source.sourceId,
    displayName: source.displayName,
    endpointUrl: source.endpointUrl,
    reportType: source.reportType,
    calculationRole: source.calculationRole,
    pollIntervalMinutes: source.pollIntervalMinutes,
    credentialAlias: source.credentialAlias,
    requestPayloadJson: hotelSourcesBySourceId.has(source.sourceId)
      ? hotelSourcesBySourceId.get(source.sourceId).requestPayloadJson
      : '',
    enabled:
      preserveEnabled && hotelSourcesBySourceId.has(source.sourceId)
        ? hotelSourcesBySourceId.get(source.sourceId).enabled
        : source.enabled,
    validationStatus: source.validationStatus,
    rowVersion: source.rowVersion,
  }))
}

const reportSourceDefinitionsMatch = (
  left,
  right,
  { ignoreEnabled = false } = {},
) => {
  const comparable = (sources) =>
    cloneReportSourceDefinitions(sources)
      .map(({
        requestPayloadJson,
        validationStatus,
        rowVersion,
        enabled,
        ...source
      }) => ({
        ...source,
        requestPayloadJson,
        ...(ignoreEnabled ? {} : { enabled }),
      }))
      .sort((first, second) =>
        first.sourceId.localeCompare(second.sourceId))
  return JSON.stringify(comparable(left)) === JSON.stringify(comparable(right))
}

const reportSourceEnabledToggleOnlyMatch = (left, right) => {
  const comparable = (sources) =>
    sources
      .map((source) => ({
        sourceId: source.sourceId,
        displayName: source.displayName,
        endpointUrl: source.endpointUrl,
        reportType: source.reportType,
        calculationRole: source.calculationRole,
        pollIntervalMinutes: source.pollIntervalMinutes,
        credentialAlias: source.credentialAlias,
        requestPayloadJson: source.requestPayloadJson,
      }))
      .sort((first, second) =>
        first.sourceId.localeCompare(second.sourceId))
  return JSON.stringify(comparable(left)) === JSON.stringify(comparable(right))
}

const ensurePrimaryReportSourceTemplate = () => {
  const primary = primaryReportSourceHotel()
  if (!primary) throw new Error('REPORT_SOURCE_TEMPLATE_HOTEL_NOT_FOUND')
  if (!reportSourcesByHotel.has(primary.hotelId)) {
    reportSourcesByHotel.set(primary.hotelId, defaultReportSources())
  }
  return {
    primary,
    sources: reportSourcesByHotel.get(primary.hotelId),
  }
}

const synchronizeReportSourcesFromPrimary = () => {
  const { primary, sources } = ensurePrimaryReportSourceTemplate()
  for (const hotel of hotels) {
    if (hotel.hotelId === primary.hotelId) continue
    if (
      hotel.pmsSystemCode === 'LUOPAN_CLOUD'
      && !reportSourcesByHotel.has(hotel.hotelId)
    ) {
      continue
    }
    reportSourcesByHotel.set(
      hotel.hotelId,
      cloneReportSourceDefinitions(
        sources,
        reportSourcesByHotel.get(hotel.hotelId),
        {
          preserveEnabled: hotel.pmsSystemCode === 'LUOPAN_CLOUD',
        },
      ),
    )
  }
}

const allowedReportTypes = new Set([
  'ORDER_DETAIL',
  'ROOM_REVENUE',
  'PHYSICAL_INVENTORY',
  'OTA_PRODUCT_INVENTORY',
  'BUSINESS_DAY',
  'CUSTOM_REPORT',
])
const allowedCalculationRoles = new Set([
  'PRIMARY_CALCULATION',
  'AUXILIARY_CALCULATION',
])
const allowedReportPollIntervals = new Set([5, 10, 15, 30, 60])
const allowedOtaPollIntervals = new Set(
  OTA_POLL_INTERVAL_OPTIONS_MINUTES,
)
const sensitiveQueryKey =
  /(?:token|cookie|password|passwd|secret|session|authorization|api[_-]?key|sign(?:ature)?)/i
const requestPayloadContainsSensitiveKey = (value, depth = 0) => {
  if (depth > 12 || value === null || typeof value !== 'object') return false
  if (Array.isArray(value)) {
    return value.some((item) =>
      requestPayloadContainsSensitiveKey(item, depth + 1))
  }
  return Object.entries(value).some(
    ([key, child]) =>
      sensitiveQueryKey.test(key)
      || requestPayloadContainsSensitiveKey(child, depth + 1),
  )
}

const normalizeReportSources = (input) => {
  if (!Array.isArray(input) || input.length > 20) {
    throw new Error('REPORT_SOURCES_INVALID')
  }
  const normalized = input.map((source) => {
    const cookieUpdate = source?.cookieUpdate ?? { action: 'KEEP' }
    const requestPayloadJson =
      typeof source?.requestPayloadJson === 'string'
        ? source.requestPayloadJson.trim()
        : ''
    let requestPayload = null
    if (requestPayloadJson) {
      if (requestPayloadJson.length > 20_000) {
        throw new Error('REPORT_SOURCE_REQUEST_PAYLOAD_INVALID')
      }
      try {
        requestPayload = JSON.parse(requestPayloadJson)
      } catch {
        throw new Error('REPORT_SOURCE_REQUEST_PAYLOAD_INVALID')
      }
      if (
        requestPayload === null
        || typeof requestPayload !== 'object'
        || Array.isArray(requestPayload)
        || requestPayloadContainsSensitiveKey(requestPayload)
      ) {
        throw new Error('REPORT_SOURCE_REQUEST_PAYLOAD_INVALID')
      }
    }
    if (
      source === null
      || typeof source !== 'object'
      || typeof source.sourceId !== 'string'
      || !/^[0-9a-f-]{36}$/i.test(source.sourceId)
      || typeof source.displayName !== 'string'
      || source.displayName.trim().length < 1
      || source.displayName.trim().length > 80
      || typeof source.endpointUrl !== 'string'
      || source.endpointUrl.length > 500
      || !allowedReportTypes.has(source.reportType)
      || !allowedCalculationRoles.has(source.calculationRole)
      || !allowedReportPollIntervals.has(source.pollIntervalMinutes)
      || typeof source.credentialAlias !== 'string'
      || (
        source.credentialAlias.length > 0
        && !/^[A-Z0-9][A-Z0-9_-]{1,63}$/.test(source.credentialAlias)
      )
      || typeof source.enabled !== 'boolean'
      || !Number.isInteger(source.rowVersion)
      || source.rowVersion < 0
      || cookieUpdate === null
      || typeof cookieUpdate !== 'object'
      || !['KEEP', 'REPLACE', 'CLEAR'].includes(cookieUpdate.action)
      || (
        cookieUpdate.action === 'REPLACE'
        && typeof cookieUpdate.value !== 'string'
      )
      || (
        cookieUpdate.action !== 'REPLACE'
        && Object.hasOwn(cookieUpdate, 'value')
      )
    ) {
      throw new Error('REPORT_SOURCE_SCHEMA_INVALID')
    }
    const endpoint = new URL(source.endpointUrl)
    if (
      endpoint.protocol !== 'https:'
      || endpoint.username
      || endpoint.password
      || endpoint.hash
      || [...endpoint.searchParams.keys()].some((key) =>
        sensitiveQueryKey.test(key))
    ) {
      throw new Error('REPORT_SOURCE_ENDPOINT_UNSAFE')
    }
    return {
      sourceId: source.sourceId,
      displayName: source.displayName.trim(),
      endpointUrl: endpoint.toString(),
      reportType: source.reportType,
      calculationRole: source.calculationRole,
      pollIntervalMinutes: REPORT_POLL_INTERVAL_MINUTES,
      credentialAlias: source.credentialAlias,
      enabled: source.enabled,
      requestPayloadJson:
        requestPayload === null ? '' : JSON.stringify(requestPayload),
      validationStatus: 'FORMAT_VALID',
      rowVersion: source.rowVersion + 1,
    }
  })
  if (
    normalized.some((source) => source.enabled)
    && !normalized.some((source) =>
      source.enabled
      && source.calculationRole === 'PRIMARY_CALCULATION')
  ) {
    throw new Error('REPORT_SOURCE_PRIMARY_REQUIRED')
  }
  return normalized
}

const cookieScope = (hotelId, sourceId) => `${hotelId}:${sourceId}`

const secretsForHotel = (hotelId) =>
  cookieSecretsByHotel.get(hotelId) ?? {}

const decorateReportSources = (hotelId, sources) => {
  const secrets = secretsForHotel(hotelId)
  const primary = primaryReportSourceHotel()
  const hotel = hotels.find((candidate) => candidate.hotelId === hotelId)
  return sources.map((source) => {
    const secret = secrets[source.sourceId]
    return {
      ...source,
      cookieConfigured: Boolean(secret),
      cookieUpdatedAt: secret?.updatedAt ?? null,
      definitionLocked: hotelId !== primary.hotelId,
      definitionTemplateHotelCode:
        `${primary.tenantCode}/${primary.hotelCode}`,
      enabledToggleOnly: hotel?.pmsSystemCode === 'LUOPAN_CLOUD',
    }
  })
}

const applyCookieUpdates = (hotelId, input) => {
  const nextSecrets = { ...secretsForHotel(hotelId) }
  const retainedSourceIds = new Set(input.map((source) => source.sourceId))
  for (const sourceId of Object.keys(nextSecrets)) {
    if (!retainedSourceIds.has(sourceId)) delete nextSecrets[sourceId]
  }
  for (const source of input) {
    const update = source.cookieUpdate ?? { action: 'KEEP' }
    if (update.action === 'REPLACE') {
      nextSecrets[source.sourceId] = encryptCookie(
        update.value,
        cookieSecretKey,
        cookieScope(hotelId, source.sourceId),
      )
    } else if (update.action === 'CLEAR') {
      delete nextSecrets[source.sourceId]
    }
  }
  cookieSecretsByHotel.set(hotelId, nextSecrets)
}

const persistReportSources = () => {
  if (!dataPath) return
  mkdirSync(dirname(dataPath), { recursive: true })
  const serializable = Object.fromEntries(reportSourcesByHotel)
  const temporaryPath = `${dataPath}.${process.pid}.tmp`
  writeFileSync(
    temporaryPath,
    `${JSON.stringify(serializable, null, 2)}\n`,
    { encoding: 'utf8', mode: 0o600 },
  )
  renameSync(temporaryPath, dataPath)
}

const persistCookieSecrets = () => {
  mkdirSync(dirname(cookieSecretsPath), { recursive: true })
  const temporaryPath = `${cookieSecretsPath}.${process.pid}.tmp`
  writeFileSync(
    temporaryPath,
    `${JSON.stringify(Object.fromEntries(cookieSecretsByHotel), null, 2)}\n`,
    { encoding: 'utf8', mode: 0o600 },
  )
  renameSync(temporaryPath, cookieSecretsPath)
}

const pmsLoginScope = (hotelId) => `pms-login:${hotelId}`

const normalizePmsLoginCredentials = (credentials) => {
  if (!credentials || typeof credentials !== 'object') {
    throw new Error('PMS_LOGIN_CREDENTIALS_INVALID')
  }
  const username = typeof credentials.username === 'string'
    ? credentials.username.trim()
    : ''
  const password = typeof credentials.password === 'string'
    ? credentials.password
    : ''
  if (
    username.length < 1
    || username.length > 256
    || password.length < 1
    || password.length > 4096
    || /[\r\n\u0000]/.test(username)
    || /[\r\n\u0000]/.test(password)
  ) {
    throw new Error('PMS_LOGIN_CREDENTIALS_INVALID')
  }
  return { username, password }
}

const pmsLoginConfigFor = (hotelId) => {
  const record = pmsLoginSecretsByHotel.get(hotelId)
  const hotel = hotels.find((candidate) => candidate.hotelId === hotelId)
  const bieyanghongPilot =
    hotel?.hotelCode === BIEYANGHONG_REPAIR_PILOT_HOTEL_CODE
    && hotel?.pmsSystemCode === 'MEITUAN_BIEYANGHONG'
  const trustedDeviceMode = trustedDeviceEligible(hotel)
  return {
    configured: trustedDeviceMode ? false : Boolean(record),
    updatedAt: trustedDeviceMode ? null : record?.updatedAt ?? null,
    loginMode: trustedDeviceMode
      ? 'STORE_TRUSTED_DEVICE'
      : bieyanghongPilot
      ? 'CONTROLLED_BROWSER_CREDENTIALS_THEN_SMS_AUTHORIZATION'
      : 'CONTROLLED_BROWSER',
    loginExecutionEnabled:
      !trustedDeviceMode
      && bieyanghongPilot
      && bieyanghongAssistedRepairEnabled,
  }
}

const pmsLoginCredentialsFor = (hotelId) => {
  const record = pmsLoginSecretsByHotel.get(hotelId)
  if (!record) throw new Error('PMS_LOGIN_CREDENTIALS_MISSING')
  const plaintext = decryptCookie(
    record,
    cookieSecretKey,
    pmsLoginScope(hotelId),
  )
  return normalizePmsLoginCredentials(JSON.parse(plaintext))
}

const persistPmsLoginSecrets = () => {
  if (!pmsLoginSecretPath) return
  mkdirSync(dirname(pmsLoginSecretPath), { recursive: true })
  const temporaryPath = `${pmsLoginSecretPath}.${process.pid}.tmp`
  writeFileSync(
    temporaryPath,
    `${JSON.stringify(Object.fromEntries(pmsLoginSecretsByHotel), null, 2)}\n`,
    { encoding: 'utf8', mode: 0o600 },
  )
  renameSync(temporaryPath, pmsLoginSecretPath)
}

const LUOPAN_PROFILE_REF = /^[a-z0-9][a-z0-9_-]{0,39}$/
const LUOPAN_FINGERPRINT = /^[a-f0-9]{16}$/
const luopanSessionScope = (hotelId) => `luopan-session:${hotelId}`

const defaultLuopanBrowserConfig = () => ({
  providerCode: 'LUOPAN_CLOUD',
  portalUrl: 'http://bj.chinapms.com:8880/pms-web/login/login.do',
  enabled: false,
  profileRef: '',
  expectedHotelFingerprint: null,
  scopeStatus: 'NOT_VALIDATED',
  pollIntervalMinutes: REPORT_POLL_INTERVAL_MINUTES,
  lastValidatedAt: null,
  lastBusinessDate: null,
  lastCollectionStatus: 'NEVER',
  lastCollectionAt: null,
  lastErrorCode: null,
  rowVersion: 0,
})

const normalizeLuopanBrowserConfig = (value) => {
  const fallback = defaultLuopanBrowserConfig()
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return fallback
  }
  const profileRef =
    typeof value.profileRef === 'string'
    && LUOPAN_PROFILE_REF.test(value.profileRef)
      ? value.profileRef
      : ''
  const expectedHotelFingerprint =
    typeof value.expectedHotelFingerprint === 'string'
    && LUOPAN_FINGERPRINT.test(value.expectedHotelFingerprint)
      ? value.expectedHotelFingerprint
      : null
  const scopeStatus =
    expectedHotelFingerprint
    && value.scopeStatus === 'SINGLE_HOTEL_CONFIRMED'
      ? 'SINGLE_HOTEL_CONFIRMED'
      : 'NOT_VALIDATED'
  return {
    ...fallback,
    enabled:
      value.enabled === true
      && Boolean(profileRef)
      && scopeStatus === 'SINGLE_HOTEL_CONFIRMED',
    profileRef,
    expectedHotelFingerprint,
    scopeStatus,
    lastValidatedAt:
      typeof value.lastValidatedAt === 'string'
        ? value.lastValidatedAt
        : null,
    lastBusinessDate:
      typeof value.lastBusinessDate === 'string'
      && /^\d{4}-\d{2}-\d{2}$/.test(value.lastBusinessDate)
        ? value.lastBusinessDate
        : null,
    lastCollectionStatus:
      ['NEVER', 'COMPLETE', 'PARTIAL', 'FAILED'].includes(
        value.lastCollectionStatus,
      )
        ? value.lastCollectionStatus
        : 'NEVER',
    lastCollectionAt:
      typeof value.lastCollectionAt === 'string'
        ? value.lastCollectionAt
        : null,
    lastErrorCode:
      typeof value.lastErrorCode === 'string'
        ? value.lastErrorCode
        : null,
    rowVersion:
      Number.isInteger(value.rowVersion) && value.rowVersion >= 0
        ? value.rowVersion
        : 0,
  }
}

const luopanBrowserConfigRecordFor = (hotelId) =>
  luopanBrowserConfigsByHotel.get(hotelId)
  ?? defaultLuopanBrowserConfig()

const luopanBrowserConfigFor = (hotelId) => {
  const config = luopanBrowserConfigRecordFor(hotelId)
  return {
    providerCode: config.providerCode,
    portalUrl: config.portalUrl,
    enabled: config.enabled,
    profileRef: config.profileRef,
    hotelFingerprintConfigured:
      Boolean(config.expectedHotelFingerprint),
    scopeStatus: config.scopeStatus,
    pollIntervalMinutes: REPORT_POLL_INTERVAL_MINUTES,
    lastValidatedAt: config.lastValidatedAt,
    lastBusinessDate: config.lastBusinessDate,
    lastCollectionStatus: config.lastCollectionStatus,
    lastCollectionAt: config.lastCollectionAt,
    lastErrorCode: config.lastErrorCode,
    loginMode: 'CONTROLLED_BROWSER_MANUAL_SESSION',
    automaticCredentialLoginEnabled: false,
    encryptedSessionConfigured:
      luopanSessionStatesByHotel.has(hotelId),
    rowVersion: config.rowVersion,
  }
}

const luopanBrowserRepairFor = (hotelId) => {
  const config = luopanBrowserConfigRecordFor(hotelId)
  return {
    providerCode: config.providerCode,
    portalUrl: config.portalUrl,
    enabled: config.enabled,
    profileConfigured: Boolean(config.profileRef),
    scopeStatus: config.scopeStatus,
    lastValidatedAt: config.lastValidatedAt,
    lastBusinessDate: config.lastBusinessDate,
    lastCollectionStatus: config.lastCollectionStatus,
    lastCollectionAt: config.lastCollectionAt,
    lastErrorCode: config.lastErrorCode,
  }
}

const persistLuopanBrowserConfigs = () => {
  if (!luopanBrowserConfigPath) return
  mkdirSync(dirname(luopanBrowserConfigPath), { recursive: true })
  const temporaryPath = `${luopanBrowserConfigPath}.${process.pid}.tmp`
  writeFileSync(
    temporaryPath,
    `${JSON.stringify(
      Object.fromEntries(luopanBrowserConfigsByHotel),
      null,
      2,
    )}\n`,
    { encoding: 'utf8', mode: 0o600 },
  )
  renameSync(temporaryPath, luopanBrowserConfigPath)
}

const persistLuopanSessionStates = () => {
  if (!luopanSessionSecretPath) return
  mkdirSync(dirname(luopanSessionSecretPath), { recursive: true })
  const encrypted = Object.fromEntries(
    [...luopanSessionStatesByHotel.entries()].map(
      ([hotelId, sessionState]) => [
        hotelId,
        encryptCookie(
          JSON.stringify(normalizeLuopanSessionState(sessionState)),
          cookieSecretKey,
          luopanSessionScope(hotelId),
        ),
      ],
    ),
  )
  const temporaryPath = `${luopanSessionSecretPath}.${process.pid}.tmp`
  writeFileSync(
    temporaryPath,
    `${JSON.stringify(encrypted, null, 2)}\n`,
    { encoding: 'utf8', mode: 0o600 },
  )
  renameSync(temporaryPath, luopanSessionSecretPath)
}

const allowedOtaPlatforms = new Set([
  'CTRIP',
  'MEITUAN',
  'FLIGGY',
  'DOUYIN',
  'QUNAR',
  'TONGCHENG',
  'OTHER',
])

const otaSecretScope = (hotelId, sourceId, kind) =>
  `ota-source:${hotelId}:${sourceId}:${kind}`

const normalizeOtaCredentials = (credentials) => {
  if (!credentials || typeof credentials !== 'object') {
    throw new Error('OTA_LOGIN_CREDENTIALS_INVALID')
  }
  const account = typeof credentials.account === 'string'
    ? credentials.account.trim()
    : ''
  const password = typeof credentials.password === 'string'
    ? credentials.password
    : ''
  if (
    account.length < 1
    || account.length > 256
    || password.length < 1
    || password.length > 4096
    || /[\r\n\u0000]/.test(account)
    || /[\r\n\u0000]/.test(password)
  ) {
    throw new Error('OTA_LOGIN_CREDENTIALS_INVALID')
  }
  return { account, password }
}

const normalizeOtaUrl = (value) => {
  let url
  try {
    url = new URL(value)
    if (url.hostname.toLowerCase() === 'h5api.m.fliggy.com') {
      url = new URL(sanitizeFliggyEndpointUrl(url))
    }
  } catch {
    throw new Error('OTA_SOURCE_URL_INVALID')
  }
  if (
    url.protocol !== 'https:'
    || url.username
    || url.password
    || url.hash
    || [...url.searchParams.keys()].some((key) =>
      sensitiveQueryKey.test(key)
      && !(
        url.hostname.toLowerCase() === 'h5api.m.fliggy.com'
        && key.toLowerCase() === 'appkey'
      ))
  ) {
    throw new Error('OTA_SOURCE_URL_UNSAFE')
  }
  return url.toString()
}

const normalizeOptionalOtaUrl = (value) => {
  if (value === undefined || value === null) return ''
  if (typeof value !== 'string') {
    throw new Error('OTA_SOURCE_URL_INVALID')
  }
  const normalized = value.trim()
  return normalized ? normalizeOtaUrl(normalized) : ''
}

const otaUpdateValid = (update, kind) => {
  if (
    !update
    || typeof update !== 'object'
    || !['KEEP', 'REPLACE', 'CLEAR'].includes(update.action)
  ) {
    return false
  }
  if (kind === 'COOKIE') {
    return update.action === 'REPLACE'
      ? typeof update.value === 'string'
      : !Object.hasOwn(update, 'value')
  }
  return update.action === 'REPLACE'
    ? typeof update.account === 'string'
      && typeof update.password === 'string'
    : !Object.hasOwn(update, 'account')
      && !Object.hasOwn(update, 'password')
}

const normalizeOtaSources = (
  input,
  previousSources = [],
  { persisted = false } = {},
) => {
  if (!Array.isArray(input) || input.length > 10) {
    throw new Error('OTA_SOURCES_INVALID')
  }
  const previousById = new Map(
    previousSources.map((source) => [source.sourceId, source]),
  )
  const normalized = input.map((source) => {
    const previous = previousById.get(source?.sourceId)
    const cookieUpdate = source?.cookieUpdate ?? { action: 'KEEP' }
    const credentialUpdate =
      source?.credentialUpdate ?? { action: 'KEEP' }
    const requestPayloadJson =
      typeof source?.requestPayloadJson === 'string'
        ? source.requestPayloadJson.trim()
        : ''
    let requestPayload = null
    if (requestPayloadJson) {
      if (requestPayloadJson.length > 20_000) {
        throw new Error('OTA_REQUEST_PAYLOAD_INVALID')
      }
      try {
        requestPayload = JSON.parse(requestPayloadJson)
      } catch {
        throw new Error('OTA_REQUEST_PAYLOAD_INVALID')
      }
      if (
        requestPayload === null
        || typeof requestPayload !== 'object'
        || Array.isArray(requestPayload)
        || requestPayloadContainsSensitiveKey(requestPayload)
      ) {
        throw new Error('OTA_REQUEST_PAYLOAD_INVALID')
      }
    }
    if (
      !source
      || typeof source !== 'object'
      || typeof source.sourceId !== 'string'
      || !SIMULATION_HOTEL_ID.test(source.sourceId)
      || typeof source.displayName !== 'string'
      || source.displayName.trim().length < 1
      || source.displayName.trim().length > 80
      || !allowedOtaPlatforms.has(source.platformCode)
      || !['GET', 'POST'].includes(source.requestMethod)
      || (
        source.requestMethod === 'GET'
        && requestPayload !== null
      )
      || (
        !allowedOtaPollIntervals.has(source.pollIntervalMinutes)
        && !(
          persisted
          && source.pollIntervalPolicyVersion !== 1
          && [5, 10, 15].includes(source.pollIntervalMinutes)
        )
      )
      || typeof source.enabled !== 'boolean'
      || !Number.isInteger(source.rowVersion)
      || source.rowVersion < 0
      || !otaUpdateValid(cookieUpdate, 'COOKIE')
      || !otaUpdateValid(credentialUpdate, 'CREDENTIALS')
    ) {
      throw new Error('OTA_SOURCE_SCHEMA_INVALID')
    }
    if (
      !persisted
      && (
        (previous && source.rowVersion !== previous.rowVersion)
        || (!previous && source.rowVersion !== 0)
      )
    ) {
      throw new Error('OTA_SOURCE_VERSION_CONFLICT')
    }
    const lastState = persisted ? source : previous
    const pollIntervalMinutes =
      persisted && source.pollIntervalPolicyVersion !== 1
        ? OTA_DEFAULT_POLL_INTERVAL_MINUTES
        : source.pollIntervalMinutes
    const normalizedPortalUrl = normalizeOptionalOtaUrl(source.portalUrl)
    const normalizedDataEndpointUrl = normalizeOptionalOtaUrl(
      source.dataEndpointUrl,
    )
    const normalizedRequestPayloadJson =
      requestPayload === null ? '' : JSON.stringify(requestPayload)
    const sourceConfigurationChanged = !previous || [
      ['displayName', source.displayName.trim()],
      ['platformCode', source.platformCode],
      ['portalUrl', normalizedPortalUrl],
      ['dataEndpointUrl', normalizedDataEndpointUrl],
      ['requestMethod', source.requestMethod],
      ['requestPayloadJson', normalizedRequestPayloadJson],
      ['pollIntervalMinutes', pollIntervalMinutes],
      ['enabled', source.enabled],
    ].some(([key, value]) => previous?.[key] !== value)
      || cookieUpdate.action !== 'KEEP'
      || credentialUpdate.action !== 'KEEP'
    return {
      sourceId: source.sourceId,
      displayName: source.displayName.trim(),
      platformCode: source.platformCode,
      portalUrl: normalizeOptionalOtaUrl(source.portalUrl),
      dataEndpointUrl: normalizeOptionalOtaUrl(source.dataEndpointUrl),
      requestMethod: source.requestMethod,
      requestPayloadJson: normalizedRequestPayloadJson,
      pollIntervalMinutes,
      pollIntervalPolicyVersion: 1,
      enabled: source.enabled,
      lastRefreshStatus:
        ['NEVER', 'COMPLETE', 'FAILED'].includes(
          lastState?.lastRefreshStatus,
        )
          ? lastState.lastRefreshStatus
          : 'NEVER',
      lastRefreshAt:
        typeof lastState?.lastRefreshAt === 'string'
          ? lastState.lastRefreshAt
          : null,
      lastErrorCode:
        typeof lastState?.lastErrorCode === 'string'
          ? lastState.lastErrorCode
          : null,
      lastSummary:
        lastState?.lastSummary
        && typeof lastState.lastSummary === 'object'
        && !Array.isArray(lastState.lastSummary)
          ? lastState.lastSummary
          : null,
      autoLoginEnabled:
        source.platformCode === 'FLIGGY'
        && Boolean(lastState?.autoLoginEnabled),
      lastLoginStatus:
        source.platformCode === 'FLIGGY'
        && [
          'NEVER',
          'RUNNING',
          'AUTHENTICATED',
          'VERIFICATION_REQUIRED',
          'EXTERNAL_VERIFICATION_REQUIRED',
          'FAILED',
          'RATE_LIMITED',
        ].includes(lastState?.lastLoginStatus)
          ? lastState.lastLoginStatus
          : 'NEVER',
      lastLoginAttemptAt:
        typeof lastState?.lastLoginAttemptAt === 'string'
          ? lastState.lastLoginAttemptAt
          : null,
      lastLoginAt:
        typeof lastState?.lastLoginAt === 'string'
          ? lastState.lastLoginAt
          : null,
      lastLoginErrorCode:
        typeof lastState?.lastLoginErrorCode === 'string'
          ? lastState.lastLoginErrorCode
          : null,
      loginAttemptWindowStartedAt:
        typeof lastState?.loginAttemptWindowStartedAt === 'string'
          ? lastState.loginAttemptWindowStartedAt
          : null,
      loginAttemptCount:
        Number.isInteger(lastState?.loginAttemptCount)
        && lastState.loginAttemptCount >= 0
        && lastState.loginAttemptCount
          <= fliggyControlledLoginPolicy.maxAttemptsPerWindow
          ? lastState.loginAttemptCount
          : 0,
      rowVersion: persisted
        ? source.rowVersion
        : sourceConfigurationChanged
          ? (previous?.rowVersion ?? 0) + 1
          : previous.rowVersion,
    }
  })
  if (
    new Set(normalized.map((source) => source.sourceId)).size
    !== normalized.length
  ) {
    throw new Error('OTA_SOURCE_DUPLICATE')
  }
  return normalized
}

const assertOtaSourceDeletions = (
  input,
  previousSources,
  remainingSources,
) => {
  if (!Array.isArray(input) || input.length > 10) {
    throw new Error('OTA_SOURCE_VERSION_CONFLICT')
  }
  const remainingIds = new Set(remainingSources.map(
    (source) => source.sourceId,
  ))
  const previousById = new Map(previousSources.map(
    (source) => [source.sourceId, source],
  ))
  const omittedIds = previousSources
    .filter((source) => !remainingIds.has(source.sourceId))
    .map((source) => source.sourceId)
  const deletionIds = new Set()
  for (const deletion of input) {
    const previous = previousById.get(deletion?.sourceId)
    if (
      !deletion
      || typeof deletion !== 'object'
      || !previous
      || remainingIds.has(deletion.sourceId)
      || !Number.isInteger(deletion.expectedRowVersion)
      || deletion.expectedRowVersion !== previous.rowVersion
      || deletionIds.has(deletion.sourceId)
    ) {
      throw new Error('OTA_SOURCE_VERSION_CONFLICT')
    }
    deletionIds.add(deletion.sourceId)
  }
  if (
    deletionIds.size !== omittedIds.length
    || omittedIds.some((sourceId) => !deletionIds.has(sourceId))
  ) {
    throw new Error('OTA_SOURCE_VERSION_CONFLICT')
  }
}

const otaSecretsForHotel = (hotelId) =>
  otaSourceSecretsByHotel.get(hotelId) ?? {}

const otaSecretValuesFor = (hotelId, sourceId) => {
  const records = otaSecretsForHotel(hotelId)[sourceId] ?? {}
  const values = {}
  if (records.cookie) {
    values.cookie = decryptCookie(
      records.cookie,
      cookieSecretKey,
      otaSecretScope(hotelId, sourceId, 'cookie'),
    )
  }
  if (records.credentials) {
    values.credentials = normalizeOtaCredentials(JSON.parse(decryptCookie(
      records.credentials,
      cookieSecretKey,
      otaSecretScope(hotelId, sourceId, 'credentials'),
    )))
  }
  return values
}

const applyOtaSecretUpdates = (hotelId, input) => {
  const current = otaSecretsForHotel(hotelId)
  const next = {}
  for (const source of input) {
    const records = { ...(current[source.sourceId] ?? {}) }
    const cookieUpdate = source.cookieUpdate ?? { action: 'KEEP' }
    const credentialUpdate =
      source.credentialUpdate ?? { action: 'KEEP' }
    if (cookieUpdate.action === 'REPLACE') {
      records.cookie = encryptCookie(
        cookieUpdate.value,
        cookieSecretKey,
        otaSecretScope(hotelId, source.sourceId, 'cookie'),
      )
    } else if (cookieUpdate.action === 'CLEAR') {
      delete records.cookie
    }
    if (credentialUpdate.action === 'REPLACE') {
      records.credentials = encryptCookie(
        JSON.stringify(normalizeOtaCredentials(credentialUpdate)),
        cookieSecretKey,
        otaSecretScope(hotelId, source.sourceId, 'credentials'),
      )
    } else if (credentialUpdate.action === 'CLEAR') {
      delete records.credentials
    }
    if (records.cookie || records.credentials) {
      next[source.sourceId] = records
    }
  }
  otaSourceSecretsByHotel.set(hotelId, next)
}

const decorateOtaSources = (hotelId, sources) => {
  const secrets = otaSecretsForHotel(hotelId)
  return sources.map((source) => {
    const { pollIntervalPolicyVersion: _policyVersion, ...view } = source
    return {
      ...view,
      cookieConfigured: Boolean(secrets[source.sourceId]?.cookie),
      cookieUpdatedAt:
        secrets[source.sourceId]?.cookie?.updatedAt ?? null,
      credentialsConfigured:
        Boolean(secrets[source.sourceId]?.credentials),
      credentialsUpdatedAt:
        secrets[source.sourceId]?.credentials?.updatedAt ?? null,
      loginMode: source.platformCode === 'FLIGGY'
        ? 'CONTROLLED_BROWSER_CREDENTIALS'
        : 'CONTROLLED_LOGIN_PENDING',
      loginExecutionEnabled: source.platformCode === 'FLIGGY',
    }
  })
}

const persistOtaSources = () => {
  if (!otaSourceConfigPath) return
  mkdirSync(dirname(otaSourceConfigPath), { recursive: true })
  const temporaryPath = `${otaSourceConfigPath}.${process.pid}.tmp`
  writeFileSync(
    temporaryPath,
    `${JSON.stringify(Object.fromEntries(otaSourcesByHotel), null, 2)}\n`,
    { encoding: 'utf8', mode: 0o600 },
  )
  renameSync(temporaryPath, otaSourceConfigPath)
}

const persistOtaSecrets = () => {
  if (!otaSourceSecretPath) return
  mkdirSync(dirname(otaSourceSecretPath), { recursive: true })
  const temporaryPath = `${otaSourceSecretPath}.${process.pid}.tmp`
  writeFileSync(
    temporaryPath,
    `${JSON.stringify(
      Object.fromEntries(otaSourceSecretsByHotel),
      null,
      2,
    )}\n`,
    { encoding: 'utf8', mode: 0o600 },
  )
  renameSync(temporaryPath, otaSourceSecretPath)
}

if (dataPath && existsSync(dataPath)) {
  try {
    const persisted = JSON.parse(readFileSync(dataPath, 'utf8'))
    if (persisted && typeof persisted === 'object' && !Array.isArray(persisted)) {
      for (const [hotelId, sources] of Object.entries(persisted)) {
        if (!hotels.some((hotel) => hotel.hotelId === hotelId)) continue
        const normalized = normalizeReportSources(
          sources.map((source) => ({
            ...source,
            rowVersion: Math.max(0, Number(source.rowVersion ?? 1) - 1),
          })),
        )
        reportSourcesByHotel.set(hotelId, normalized)
      }
    }
  } catch {
    process.stderr.write('REVIEW_REPORT_SOURCE_STORE_IGNORED\n')
  }
}

synchronizeReportSourcesFromPrimary()
persistReportSources()

if (existsSync(cookieSecretsPath)) {
  try {
    const persistedSecrets = JSON.parse(
      readFileSync(cookieSecretsPath, 'utf8'),
    )
    if (
      persistedSecrets
      && typeof persistedSecrets === 'object'
      && !Array.isArray(persistedSecrets)
    ) {
      for (const [hotelId, sourceSecrets] of Object.entries(persistedSecrets)) {
        if (
          !hotels.some((hotel) => hotel.hotelId === hotelId)
          || sourceSecrets === null
          || typeof sourceSecrets !== 'object'
          || Array.isArray(sourceSecrets)
        ) {
          continue
        }
        const verified = {}
        for (const [sourceId, record] of Object.entries(sourceSecrets)) {
          decryptCookie(
            record,
            cookieSecretKey,
            cookieScope(hotelId, sourceId),
          )
          verified[sourceId] = record
        }
        cookieSecretsByHotel.set(hotelId, verified)
      }
    }
  } catch {
    process.stderr.write('REVIEW_COOKIE_SECRET_STORE_IGNORED\n')
  }
}

if (pmsLoginSecretPath && existsSync(pmsLoginSecretPath)) {
  try {
    const persistedCredentials = JSON.parse(
      readFileSync(pmsLoginSecretPath, 'utf8'),
    )
    if (
      persistedCredentials
      && typeof persistedCredentials === 'object'
      && !Array.isArray(persistedCredentials)
    ) {
      for (const [hotelId, record] of Object.entries(persistedCredentials)) {
        if (!hotels.some((hotel) => hotel.hotelId === hotelId)) continue
        const plaintext = decryptCookie(
          record,
          cookieSecretKey,
          pmsLoginScope(hotelId),
        )
        normalizePmsLoginCredentials(JSON.parse(plaintext))
        pmsLoginSecretsByHotel.set(hotelId, record)
      }
    }
  } catch {
    process.stderr.write('REVIEW_PMS_LOGIN_SECRET_STORE_IGNORED\n')
  }
}

if (luopanBrowserConfigPath && existsSync(luopanBrowserConfigPath)) {
  try {
    const persistedConfigs = JSON.parse(
      readFileSync(luopanBrowserConfigPath, 'utf8'),
    )
    if (
      persistedConfigs
      && typeof persistedConfigs === 'object'
      && !Array.isArray(persistedConfigs)
    ) {
      for (const [hotelId, config] of Object.entries(persistedConfigs)) {
        if (!hotels.some((hotel) => hotel.hotelId === hotelId)) continue
        luopanBrowserConfigsByHotel.set(
          hotelId,
          normalizeLuopanBrowserConfig(config),
        )
      }
    }
  } catch {
    process.stderr.write('REVIEW_LUOPAN_BROWSER_CONFIG_STORE_IGNORED\n')
  }
}

if (luopanSessionSecretPath && existsSync(luopanSessionSecretPath)) {
  try {
    const persistedSessions = JSON.parse(
      readFileSync(luopanSessionSecretPath, 'utf8'),
    )
    if (
      persistedSessions
      && typeof persistedSessions === 'object'
      && !Array.isArray(persistedSessions)
    ) {
      for (const [hotelId, record] of Object.entries(persistedSessions)) {
        if (!hotels.some((hotel) => hotel.hotelId === hotelId)) continue
        const plaintext = decryptCookie(
          record,
          cookieSecretKey,
          luopanSessionScope(hotelId),
        )
        luopanSessionStatesByHotel.set(
          hotelId,
          normalizeLuopanSessionState(JSON.parse(plaintext)),
        )
      }
    }
  } catch {
    process.stderr.write('REVIEW_LUOPAN_SESSION_SECRET_STORE_IGNORED\n')
  }
}

if (otaSourceConfigPath && existsSync(otaSourceConfigPath)) {
  try {
    const persistedConfigs = JSON.parse(
      readFileSync(otaSourceConfigPath, 'utf8'),
    )
    if (
      persistedConfigs
      && typeof persistedConfigs === 'object'
      && !Array.isArray(persistedConfigs)
    ) {
      for (const [hotelId, sources] of Object.entries(persistedConfigs)) {
        if (!hotels.some((hotel) => hotel.hotelId === hotelId)) continue
        otaSourcesByHotel.set(
          hotelId,
          normalizeOtaSources(sources, [], { persisted: true }),
        )
      }
    }
  } catch {
    process.stderr.write('REVIEW_OTA_SOURCE_STORE_IGNORED\n')
  }
}

const otaRoomTypeCatalogFingerprint = (hotelId, source) => {
  return createHash('sha256')
    .update(JSON.stringify({
      hotelId,
      sourceId: source.sourceId,
      platformCode: source.platformCode,
      dataEndpointUrl: source.dataEndpointUrl,
      requestMethod: source.requestMethod,
      requestPayloadJson: source.requestPayloadJson,
    }))
    .digest('hex')
}

const otaRoomTypeCatalogMatchesSource = (hotelId, catalog, source) => (
  Boolean(catalog)
  && catalog.platformCode === source.platformCode
  && (
    typeof catalog.sourceFingerprint === 'string'
      ? catalog.sourceFingerprint
        === otaRoomTypeCatalogFingerprint(hotelId, source)
      : catalog.sourceRowVersion === source.rowVersion
  )
)

if (otaRoomTypeCatalogPath && existsSync(otaRoomTypeCatalogPath)) {
  try {
    const persistedCatalogs = JSON.parse(
      readFileSync(otaRoomTypeCatalogPath, 'utf8'),
    )
    if (
      persistedCatalogs
      && typeof persistedCatalogs === 'object'
      && !Array.isArray(persistedCatalogs)
    ) {
      for (const [hotelId, sourceCatalogs] of Object.entries(
        persistedCatalogs,
      )) {
        if (
          !hotels.some((hotel) => hotel.hotelId === hotelId)
          || !sourceCatalogs
          || typeof sourceCatalogs !== 'object'
          || Array.isArray(sourceCatalogs)
        ) continue
        const configuredSources = new Map(
          (otaSourcesByHotel.get(hotelId) ?? [])
            .map((source) => [source.sourceId, source]),
        )
        const normalized = {}
        for (const [sourceId, catalog] of Object.entries(sourceCatalogs)) {
          const source = configuredSources.get(sourceId)
          if (
            !source
            || !catalog
            || typeof catalog !== 'object'
            || Array.isArray(catalog)
          ) continue
          normalized[sourceId] = {
            sourceId,
            platformCode: source.platformCode,
            displayName: source.displayName,
            sourceRowVersion:
              Number.isInteger(catalog.sourceRowVersion)
                ? catalog.sourceRowVersion
                : null,
            sourceFingerprint:
              typeof catalog.sourceFingerprint === 'string'
              && /^[a-f0-9]{64}$/.test(catalog.sourceFingerprint)
                ? catalog.sourceFingerprint
                : null,
            observedAt:
              typeof catalog.observedAt === 'string'
                ? catalog.observedAt
                : null,
            roomTypes: mergeRoomTypeCatalogs(catalog.roomTypes),
          }
        }
        otaRoomTypeCatalogsByHotel.set(hotelId, normalized)
      }
    }
  } catch {
    process.stderr.write('REVIEW_OTA_ROOM_TYPE_CATALOG_STORE_IGNORED\n')
  }
}

const replaceMapContents = (target, replacement) => {
  target.clear()
  for (const [key, value] of replacement) target.set(key, value)
}

const persistOtaRoomTypeCatalogs = (
  catalogsByHotel = otaRoomTypeCatalogsByHotel,
) => {
  if (!otaRoomTypeCatalogPath) return
  mkdirSync(dirname(otaRoomTypeCatalogPath), { recursive: true })
  const temporaryPath = `${otaRoomTypeCatalogPath}.${process.pid}.tmp`
  writeFileSync(
    temporaryPath,
    `${JSON.stringify(
      Object.fromEntries(catalogsByHotel),
      null,
      2,
    )}\n`,
    { encoding: 'utf8', mode: 0o600 },
  )
  renameSync(temporaryPath, otaRoomTypeCatalogPath)
}

const updateOtaRoomTypeCatalog = ({
  hotelId,
  source,
  roomTypes,
  observedAt,
}) => {
  const current = { ...(otaRoomTypeCatalogsByHotel.get(hotelId) ?? {}) }
  const observedRoomTypes = mergeRoomTypeCatalogs(roomTypes)
  if (observedRoomTypes.length === 0) return false
  const existing = current[source.sourceId]
  const sameConnectorVersion = otaRoomTypeCatalogMatchesSource(
    hotelId,
    existing,
    source,
  )
  const pinnedRoomTypeCodes = sameConnectorVersion
    ? hotSellingRoomTypesFor(hotelId).mappings
      .filter((mapping) => mapping.sourceId === source.sourceId)
      .map((mapping) => mapping.otaRoomTypeCode)
    : []
  const normalizedRoomTypes = mergeRoomTypeCatalogsPreserving(
    [sameConnectorVersion ? existing.roomTypes : [], observedRoomTypes],
    pinnedRoomTypeCodes,
  )
  current[source.sourceId] = {
    sourceId: source.sourceId,
    platformCode: source.platformCode,
    displayName: source.displayName,
    sourceRowVersion: source.rowVersion,
    sourceFingerprint: otaRoomTypeCatalogFingerprint(hotelId, source),
    observedAt,
    roomTypes: normalizedRoomTypes,
  }
  const nextCatalogs = new Map(otaRoomTypeCatalogsByHotel)
  nextCatalogs.set(hotelId, current)
  persistOtaRoomTypeCatalogs(nextCatalogs)
  replaceMapContents(otaRoomTypeCatalogsByHotel, nextCatalogs)
  return true
}

if (otaSourceSecretPath && existsSync(otaSourceSecretPath)) {
  try {
    const persistedSecrets = JSON.parse(
      readFileSync(otaSourceSecretPath, 'utf8'),
    )
    if (
      persistedSecrets
      && typeof persistedSecrets === 'object'
      && !Array.isArray(persistedSecrets)
    ) {
      for (const [hotelId, sourceSecrets] of Object.entries(
        persistedSecrets,
      )) {
        if (
          !hotels.some((hotel) => hotel.hotelId === hotelId)
          || !sourceSecrets
          || typeof sourceSecrets !== 'object'
          || Array.isArray(sourceSecrets)
        ) {
          continue
        }
        otaSourceSecretsByHotel.set(hotelId, sourceSecrets)
        for (const sourceId of Object.keys(sourceSecrets)) {
          otaSecretValuesFor(hotelId, sourceId)
        }
      }
    }
  } catch {
    otaSourceSecretsByHotel.clear()
    process.stderr.write('REVIEW_OTA_SECRET_STORE_IGNORED\n')
  }
}

if (businessDayControlPath && existsSync(businessDayControlPath)) {
  try {
    const persistedControls = JSON.parse(
      readFileSync(businessDayControlPath, 'utf8'),
    )
    for (const [hotelId, control] of Object.entries(persistedControls)) {
      if (
        !hotels.some((hotel) => hotel.hotelId === hotelId)
        || !control
        || typeof control !== 'object'
        || !/^\d{4}-\d{2}-\d{2}$/.test(control.businessDate)
      ) {
        continue
      }
      businessDayControlsByHotel.set(hotelId, {
        businessDate: control.businessDate,
        mode: 'PMS_CONFIRMED',
        source:
          typeof control.source === 'string' ? control.source : null,
        businessDateStartedAt:
          typeof control.businessDateStartedAt === 'string'
            && Number.isFinite(
              new Date(control.businessDateStartedAt).getTime(),
            )
            ? control.businessDateStartedAt
            : null,
        updatedAt:
          typeof control.updatedAt === 'string' ? control.updatedAt : null,
      })
    }
  } catch {
    process.stderr.write('REVIEW_BUSINESS_DAY_STORE_IGNORED\n')
  }
}

const businessDayControlFor = (hotelId) =>
  businessDayControlsByHotel.get(hotelId) ?? {
    businessDate: null,
    mode: 'UNCONFIRMED',
    source: null,
    businessDateStartedAt: null,
    updatedAt: null,
  }

const persistBusinessDayControls = () => {
  if (!businessDayControlPath) return
  mkdirSync(dirname(businessDayControlPath), { recursive: true })
  const temporaryPath = `${businessDayControlPath}.${process.pid}.tmp`
  writeFileSync(
    temporaryPath,
    `${JSON.stringify(
      Object.fromEntries(businessDayControlsByHotel),
      null,
      2,
    )}\n`,
    { encoding: 'utf8', mode: 0o600 },
  )
  renameSync(temporaryPath, businessDayControlPath)
}

const normalizePersistedRoomTypeMappingsFor = (hotelId, input) => {
  const mappings = []
  let invalidMappingCount = 0
  for (const mapping of Array.isArray(input) ? input : []) {
    try {
      const [normalizedMapping] = normalizeStoredRoomTypeMappings([
        mapping,
      ])
      const ownerConflict = mappings.some((current) => (
        current.sourceId === normalizedMapping.sourceId
        && current.otaRoomTypeCode === normalizedMapping.otaRoomTypeCode
        && current.physicalRoomTypeCode
          !== normalizedMapping.physicalRoomTypeCode
      ))
      if (ownerConflict) throw new Error('ROOM_TYPE_MAPPING_CONFLICT')
      if (!mappings.some((current) => (
        current.physicalRoomTypeCode
          === normalizedMapping.physicalRoomTypeCode
        && current.sourceId === normalizedMapping.sourceId
        && current.otaRoomTypeCode === normalizedMapping.otaRoomTypeCode
      ))) mappings.push(normalizedMapping)
    } catch {
      invalidMappingCount += 1
    }
  }
  if (invalidMappingCount > 0) {
    process.stderr.write(
      `REVIEW_HOT_ROOM_MAPPING_ITEMS_IGNORED:${hotelId}:${invalidMappingCount}\n`,
    )
  }
  return mappings
}

if (hotSellingRoomTypePath && existsSync(hotSellingRoomTypePath)) {
  try {
    const persistedHotRooms = JSON.parse(
      readFileSync(hotSellingRoomTypePath, 'utf8'),
    )
    for (const [hotelId, config] of Object.entries(persistedHotRooms)) {
      if (
        !hotels.some((hotel) => hotel.hotelId === hotelId)
        || !config
        || typeof config !== 'object'
        || !Array.isArray(config.roomTypeCodes)
      ) {
        continue
      }
      const roomTypeCodes = [
        ...new Set(
          config.roomTypeCodes.filter(
            (code) =>
              typeof code === 'string'
              && /^[A-Za-z0-9:_-]{3,100}$/.test(code),
          ),
        ),
      ].slice(0, 30)
      const mappings = normalizePersistedRoomTypeMappingsFor(
        hotelId,
        config.mappings,
      )
      hotSellingRoomTypesByHotel.set(hotelId, {
        roomTypeCodes,
        mappings,
        rowVersion:
          Number.isInteger(config.rowVersion) && config.rowVersion >= 0
            ? config.rowVersion
            : 0,
        updatedAt:
          typeof config.updatedAt === 'string' ? config.updatedAt : null,
      })
    }
  } catch {
    process.stderr.write('REVIEW_HOT_ROOM_STORE_IGNORED\n')
  }
}

if (roomTypeMappingPath && existsSync(roomTypeMappingPath)) {
  try {
    const persistedMappings = JSON.parse(
      readFileSync(roomTypeMappingPath, 'utf8'),
    )
    for (const [hotelId, mappingConfig] of Object.entries(
      persistedMappings,
    )) {
      if (
        !hotels.some((hotel) => hotel.hotelId === hotelId)
        || !mappingConfig
        || typeof mappingConfig !== 'object'
      ) continue
      const current = hotSellingRoomTypesByHotel.get(hotelId) ?? {
        roomTypeCodes: [],
        mappings: [],
        rowVersion: 0,
        updatedAt: null,
      }
      const mappingUpdatedAt =
        typeof mappingConfig.updatedAt === 'string'
          ? mappingConfig.updatedAt
          : null
      const mappingIsCurrent = Boolean(
        mappingUpdatedAt
        && (
          !current.updatedAt
          || mappingUpdatedAt.localeCompare(current.updatedAt) >= 0
        ),
      )
      const journalRoomTypeCodes = Array.isArray(
        mappingConfig.roomTypeCodes,
      )
        ? [...new Set(mappingConfig.roomTypeCodes.filter((code) => (
          typeof code === 'string'
          && /^[A-Za-z0-9:_-]{3,100}$/.test(code)
        )))].slice(0, 30)
        : null
      const canonicalRowVersion =
        Number.isInteger(mappingConfig.rowVersion)
        && mappingConfig.rowVersion >= 0
          ? mappingConfig.rowVersion
          : current.rowVersion
      const legacySelectionIsNewer = Boolean(
        current.updatedAt
        && (
          !mappingUpdatedAt
          || current.updatedAt.localeCompare(mappingUpdatedAt) > 0
        ),
      )
      hotSellingRoomTypesByHotel.set(hotelId, {
        ...current,
        roomTypeCodes:
          mappingIsCurrent && journalRoomTypeCodes
            ? journalRoomTypeCodes
            : current.roomTypeCodes,
        mappings: normalizePersistedRoomTypeMappingsFor(
          hotelId,
          mappingConfig.mappings,
        ),
        rowVersion: legacySelectionIsNewer
          ? Math.max(current.rowVersion, canonicalRowVersion) + 1
          : canonicalRowVersion,
        updatedAt: mappingIsCurrent
          ? mappingUpdatedAt
          : current.updatedAt,
      })
    }
  } catch {
    process.stderr.write('REVIEW_ROOM_TYPE_MAPPING_STORE_IGNORED\n')
  }
}

const hotSellingRoomTypesFor = (hotelId) =>
  hotSellingRoomTypesByHotel.get(hotelId) ?? {
    roomTypeCodes: [],
    mappings: [],
    rowVersion: 0,
    updatedAt: null,
  }

const persistHotSellingRoomTypes = (
  configsByHotel = hotSellingRoomTypesByHotel,
) => {
  if (!hotSellingRoomTypePath) return
  mkdirSync(dirname(hotSellingRoomTypePath), { recursive: true })
  const temporaryPath = `${hotSellingRoomTypePath}.${process.pid}.tmp`
  writeFileSync(
    temporaryPath,
    `${JSON.stringify(
      Object.fromEntries([...configsByHotel].map(([hotelId, config]) => [
        hotelId,
        {
          roomTypeCodes: config.roomTypeCodes,
          updatedAt: config.updatedAt,
        },
      ])),
      null,
      2,
    )}\n`,
    { encoding: 'utf8', mode: 0o600 },
  )
  renameSync(temporaryPath, hotSellingRoomTypePath)
}

const persistRoomTypeMappings = (
  configsByHotel = hotSellingRoomTypesByHotel,
) => {
  if (!roomTypeMappingPath) return
  mkdirSync(dirname(roomTypeMappingPath), { recursive: true })
  const temporaryPath = `${roomTypeMappingPath}.${process.pid}.tmp`
  writeFileSync(
    temporaryPath,
    `${JSON.stringify(
      Object.fromEntries([...configsByHotel].map(([hotelId, config]) => [
        hotelId,
        {
          schemaVersion: 1,
          roomTypeCodes: config.roomTypeCodes,
          mappings: config.mappings,
          rowVersion: config.rowVersion,
          updatedAt: config.updatedAt,
        },
      ])),
      null,
      2,
    )}\n`,
    { encoding: 'utf8', mode: 0o600 },
  )
  renameSync(temporaryPath, roomTypeMappingPath)
}

const commitHotSellingRoomTypes = (hotelId, config) => {
  const previousConfigs = new Map(hotSellingRoomTypesByHotel)
  const nextConfigs = new Map(hotSellingRoomTypesByHotel)
  nextConfigs.set(hotelId, config)
  // Canonical state is one atomic file; the legacy file is a rollback mirror.
  try {
    persistRoomTypeMappings(nextConfigs)
  } catch (error) {
    process.stderr.write(
      `REVIEW_HOT_ROOM_CANONICAL_WRITE_FAILED:${hotelId}\n`,
    )
    throw new Error('HOT_SELLING_ROOM_TYPES_PERSIST_FAILED', {
      cause: error,
    })
  }
  try {
    persistHotSellingRoomTypes(nextConfigs)
  } catch (error) {
    process.stderr.write(
      `REVIEW_HOT_ROOM_LEGACY_MIRROR_FAILED:${hotelId}\n`,
    )
    try {
      persistRoomTypeMappings(previousConfigs)
    } catch {
      process.stderr.write(
        `REVIEW_HOT_ROOM_CANONICAL_ROLLBACK_FAILED:${hotelId}\n`,
      )
    }
    throw new Error('HOT_SELLING_ROOM_TYPES_PERSIST_FAILED', {
      cause: error,
    })
  }
  replaceMapContents(hotSellingRoomTypesByHotel, nextConfigs)
}

const stripTrustedPseudonymAliases = (snapshot) => {
  snapshot.orders = snapshot.orders.map(({ legacyKey: _legacyKey, ...order }) =>
    order)
  snapshot.physicalInventory = snapshot.physicalInventory.map(({
    legacyPhysicalRoomTypeCode: _legacyCode,
    ...room
  }) => room)
  snapshot.roomForecast = snapshot.roomForecast.map(({
    legacyPhysicalRoomTypeCode: _legacyCode,
    ...room
  }) => room)
  return snapshot
}

const migrateTrustedPseudonymAliases = (hotel, snapshot) => {
  const aliases = []
  for (const room of [
    ...snapshot.physicalInventory,
    ...snapshot.roomForecast,
  ]) {
    if (
      typeof room.legacyPhysicalRoomTypeCode === 'string'
      && room.legacyPhysicalRoomTypeCode !== room.physicalRoomTypeCode
    ) aliases.push([
      room.legacyPhysicalRoomTypeCode,
      room.physicalRoomTypeCode,
    ])
  }
  const previous = (liveSnapshotStore[hotel.hotelId] ?? []).at(-1)
  if (previous) {
    const oldByName = new Map()
    for (const room of previous.physicalInventory ?? []) {
      const values = oldByName.get(room.displayName) ?? new Set()
      values.add(room.physicalRoomTypeCode)
      oldByName.set(room.displayName, values)
    }
    const newByName = new Map()
    for (const room of snapshot.physicalInventory ?? []) {
      const values = newByName.get(room.displayName) ?? new Set()
      values.add(room.physicalRoomTypeCode)
      newByName.set(room.displayName, values)
    }
    for (const [displayName, oldCodes] of oldByName) {
      const newCodes = newByName.get(displayName)
      if (oldCodes.size === 1 && newCodes?.size === 1) {
        const oldCode = [...oldCodes][0]
        const newCode = [...newCodes][0]
        if (oldCode !== newCode) aliases.push([oldCode, newCode])
      }
    }
  }
  const aliasMap = new Map()
  for (const [oldCode, newCode] of aliases) {
    if (aliasMap.has(oldCode) && aliasMap.get(oldCode) !== newCode) {
      throw new Error('TRUSTED_DEVICE_PSEUDONYM_MIGRATION_AMBIGUOUS')
    }
    aliasMap.set(oldCode, newCode)
  }
  const current = hotSellingRoomTypesFor(hotel.hotelId)
  const roomTypeCodes = current.roomTypeCodes.map((code) =>
    aliasMap.get(code) ?? code)
  const mappings = current.mappings.map((mapping) => ({
    ...mapping,
    physicalRoomTypeCode:
      aliasMap.get(mapping.physicalRoomTypeCode)
      ?? mapping.physicalRoomTypeCode,
  }))
  if (
    stableJson(roomTypeCodes) !== stableJson(current.roomTypeCodes)
    || stableJson(mappings) !== stableJson(current.mappings)
  ) {
    commitHotSellingRoomTypes(hotel.hotelId, {
      ...current,
      roomTypeCodes: [...new Set(roomTypeCodes)],
      mappings,
      rowVersion: current.rowVersion + 1,
      updatedAt: new Date().toISOString(),
    })
  }
  return stripTrustedPseudonymAliases(snapshot)
}

const latestPhysicalInventorySnapshotFor = (hotelId) => {
  const snapshots = liveSnapshotStore[hotelId] ?? []
  for (let index = snapshots.length - 1; index >= 0; index -= 1) {
    const candidate = snapshots[index]
    if (
      Array.isArray(candidate?.physicalInventory)
      && candidate.physicalInventory.length > 0
    ) return candidate
  }
  return null
}

const currentRoomTypeMappingsFor = (hotelId) => {
  const config = hotSellingRoomTypesFor(hotelId)
  const sourceById = new Map(
    (otaSourcesByHotel.get(hotelId) ?? [])
      .filter((source) => source.enabled)
      .map((source) => [source.sourceId, source]),
  )
  const sourceCatalogs = otaRoomTypeCatalogsByHotel.get(hotelId) ?? {}
  return config.mappings.flatMap((mapping) => {
    const source = sourceById.get(mapping.sourceId)
    const catalog = sourceCatalogs[mapping.sourceId]
    if (
      !source
      || !catalog
      || !otaRoomTypeCatalogMatchesSource(hotelId, catalog, source)
    ) return []
    const roomType = (catalog.roomTypes ?? []).find((candidate) => (
      candidate.roomTypeCode === mapping.otaRoomTypeCode
    ))
    return roomType
      ? [{ ...mapping, otaRoomTypeName: roomType.displayName }]
      : []
  })
}

const roomTypeConfigurationFor = (hotelId) => {
  const snapshot = latestPhysicalInventorySnapshotFor(hotelId)
  const config = hotSellingRoomTypesFor(hotelId)
  const sourceCatalogs = otaRoomTypeCatalogsByHotel.get(hotelId) ?? {}
  const otaSources = (otaSourcesByHotel.get(hotelId) ?? [])
    .filter((source) => source.enabled)
    .map((source) => {
      const catalog = sourceCatalogs[source.sourceId]
      const catalogMatchesSource = otaRoomTypeCatalogMatchesSource(
        hotelId,
        catalog,
        source,
      )
      return {
        sourceId: source.sourceId,
        displayName: source.displayName,
        platformCode: source.platformCode,
        observedAt: catalogMatchesSource
          ? catalog.observedAt ?? null
          : null,
        refreshStatus: source.lastRefreshStatus,
        roomTypes: catalogMatchesSource ? catalog.roomTypes ?? [] : [],
      }
    })
  const currentOtaRoomNames = new Map(
    currentRoomTypeMappingsFor(hotelId).map((mapping) => [
      `${mapping.sourceId}:${mapping.otaRoomTypeCode}`,
      mapping.otaRoomTypeName,
    ]),
  )
  return {
    rowVersion: config.rowVersion,
    updatedAt: config.updatedAt,
    pmsObservedAt: snapshot?.observedAt ?? null,
    pmsRoomTypes: (snapshot?.physicalInventory ?? []).map((room) => ({
      physicalRoomTypeCode: room.physicalRoomTypeCode,
      displayName: room.displayName,
      primaryAvailableRooms: room.primaryAvailableRooms ?? null,
    })),
    otaSources,
    mappings: config.mappings.map((mapping) => ({
      ...mapping,
      otaRoomTypeName:
        currentOtaRoomNames.get(
          `${mapping.sourceId}:${mapping.otaRoomTypeCode}`,
        ) ?? mapping.otaRoomTypeName,
    })),
    hotSellingRoomTypeCodes: config.roomTypeCodes,
  }
}

const weComSecretScope = (hotelId) => `wecom-webhook:${hotelId}`

const weComConfigFor = (hotelId) => {
  const config = weComConfigsByHotel.get(hotelId) ?? {
    enabled: false,
    sendMinute: 6,
    endpointSha256: null,
    updatedAt: null,
  }
  const secret = weComSecretsByHotel.get(hotelId)
  const deliveries = [...weComDeliveriesByKey.values()]
    .filter((delivery) => delivery.hotelId === hotelId)
    .sort((left, right) =>
      String(right.attemptedAt).localeCompare(String(left.attemptedAt)))
  return {
    enabled: config.enabled === true,
    sendMinute: 6,
    futureBriefSendMinute: 8,
    hotSellingSoldOutAlertSendMinute: 9,
    futureDemandP1Immediate: true,
    deliveryMode: 'UAT_SANITIZED_AT_ALL',
    webhookConfigured: Boolean(secret),
    endpointSha256:
      secret ? config.endpointSha256 ?? null : null,
    updatedAt: config.updatedAt ?? null,
    lastDelivery: deliveries[0] ?? null,
  }
}

const persistWeComConfigs = () => {
  if (!weComConfigPath) return
  mkdirSync(dirname(weComConfigPath), { recursive: true })
  const temporaryPath = `${weComConfigPath}.${process.pid}.tmp`
  writeFileSync(
    temporaryPath,
    `${JSON.stringify(Object.fromEntries(weComConfigsByHotel), null, 2)}\n`,
    { encoding: 'utf8', mode: 0o600 },
  )
  renameSync(temporaryPath, weComConfigPath)
}

const persistWeComSecrets = () => {
  if (!weComSecretPath) return
  mkdirSync(dirname(weComSecretPath), { recursive: true })
  const temporaryPath = `${weComSecretPath}.${process.pid}.tmp`
  writeFileSync(
    temporaryPath,
    `${JSON.stringify(Object.fromEntries(weComSecretsByHotel), null, 2)}\n`,
    { encoding: 'utf8', mode: 0o600 },
  )
  renameSync(temporaryPath, weComSecretPath)
}

const persistWeComDeliveries = () => {
  if (!weComDeliveryPath) return
  mkdirSync(dirname(weComDeliveryPath), { recursive: true })
  const deliveries = [...weComDeliveriesByKey.values()]
    .sort((left, right) =>
      String(left.attemptedAt).localeCompare(String(right.attemptedAt)))
    .slice(-WECOM_DELIVERY_RETENTION_LIMIT)
  const temporaryPath = `${weComDeliveryPath}.${process.pid}.tmp`
  writeFileSync(
    temporaryPath,
    `${JSON.stringify(deliveries, null, 2)}\n`,
    { encoding: 'utf8', mode: 0o600 },
  )
  renameSync(temporaryPath, weComDeliveryPath)
}

const persistBriefingHealthAudits = () => {
  if (!briefingHealthAuditPath) return
  const cutoffAt = Date.now() - BRIEFING_HEALTH_AUDIT_RETENTION_MS
  const retained = briefingHealthAudits
    .filter((audit) => {
      const auditedAt = new Date(audit?.auditedAt ?? '').getTime()
      return Number.isFinite(auditedAt) && auditedAt >= cutoffAt
    })
    .sort((left, right) =>
      String(left.auditedAt).localeCompare(String(right.auditedAt)))
  briefingHealthAudits.splice(0, briefingHealthAudits.length, ...retained)
  mkdirSync(dirname(briefingHealthAuditPath), { recursive: true })
  const temporaryPath = `${briefingHealthAuditPath}.${process.pid}.tmp`
  writeFileSync(
    temporaryPath,
    `${JSON.stringify(briefingHealthAudits, null, 2)}\n`,
    { encoding: 'utf8', mode: 0o600 },
  )
  renameSync(temporaryPath, briefingHealthAuditPath)
}

const upsertBriefingHealthAudit = (record) => {
  const index = briefingHealthAudits.findIndex(
    (candidate) => candidate.auditId === record.auditId,
  )
  if (index >= 0) briefingHealthAudits[index] = record
  else briefingHealthAudits.push(record)
  persistBriefingHealthAudits()
  return record
}

const updateBriefingHealthAudit = (auditId, patch) => {
  const existing = briefingHealthAudits.find(
    (candidate) => candidate.auditId === auditId,
  )
  if (!existing) return null
  return upsertBriefingHealthAudit({
    ...existing,
    ...patch,
    updatedAt: new Date().toISOString(),
  })
}

const updateLatestPendingBriefingHealthAudit = (hotelId, patch) => {
  const existing = briefingHealthAudits
    .filter((candidate) =>
      candidate.hotelId === hotelId
      && ['PENDING', 'WAITING_CAPTCHA', 'REPAIRING'].includes(
        candidate.resolutionStatus,
      ))
    .sort((left, right) =>
      String(left.auditedAt).localeCompare(String(right.auditedAt)))
    .at(-1)
  return existing
    ? updateBriefingHealthAudit(existing.auditId, patch)
    : null
}

const weComRepairBotSecretScope = () => 'wecom-repair-bot:v1'
const SHA256_PATTERN = /^[a-f0-9]{64}$/iu

const weComRepairBotHotelUserFingerprints = (hotelAllowedUserIds = {}) =>
  Object.fromEntries(
    Object.entries(hotelAllowedUserIds)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([hotelId, userIds]) => [
        hotelId,
        userIds.map(fingerprintWeComRepairBotValue),
      ]),
  )

const weComRepairBotAuthorizedForHotel = (userId, hotelId) =>
  weComRepairBotRecipientsForHotel(
    weComRepairBotCredentials ?? {},
    hotelId,
  ).includes(userId)

const persistWeComRepairBotConfig = () => {
  if (!weComRepairBotConfigPath) return
  mkdirSync(dirname(weComRepairBotConfigPath), { recursive: true })
  const temporaryPath = `${weComRepairBotConfigPath}.${process.pid}.tmp`
  writeFileSync(
    temporaryPath,
    `${JSON.stringify(weComRepairBotConfig, null, 2)}\n`,
    { encoding: 'utf8', mode: 0o600 },
  )
  renameSync(temporaryPath, weComRepairBotConfigPath)
}

const persistWeComRepairBotSecret = () => {
  if (!weComRepairBotSecretPath) return
  mkdirSync(dirname(weComRepairBotSecretPath), { recursive: true })
  const temporaryPath = `${weComRepairBotSecretPath}.${process.pid}.tmp`
  const record = weComRepairBotCredentials
    ? encryptCookie(
      JSON.stringify(weComRepairBotCredentials),
      cookieSecretKey,
      weComRepairBotSecretScope(),
    )
    : null
  writeFileSync(
    temporaryPath,
    `${JSON.stringify(record ? { record } : {}, null, 2)}\n`,
    { encoding: 'utf8', mode: 0o600 },
  )
  renameSync(temporaryPath, weComRepairBotSecretPath)
}

const weComRepairBotStatus = () => {
  const runtimeStatus = weComRepairBotRuntime?.status() ?? {
    connectionStatus:
      weComRepairBotConfig.enabled ? 'STARTING' : 'DISABLED',
    connected: false,
    lastAuthenticatedAt: null,
    lastDisconnectedAt: null,
    lastErrorCode: null,
  }
  const allowedUserIds = weComRepairBotCredentials?.allowedUserIds ?? []
  const allowedUserFingerprints =
    weComRepairBotConfig.allowedUserIdSha256s
      .map((fingerprint) => fingerprint.slice(0, 16))
  const hotelBindings = hotels
    .map((hotel) => {
      const userIds =
        weComRepairBotCredentials?.hotelAllowedUserIds?.[hotel.hotelId] ?? []
      const fingerprints =
        weComRepairBotConfig.hotelAllowedUserIdSha256s?.[hotel.hotelId] ?? []
      return {
        hotelId: hotel.hotelId,
        hotelCode: hotel.hotelCode,
        displayName: hotel.hotelName,
        pairedUserCount: userIds.length,
        pairedUserCapacity: WECOM_REPAIR_BOT_MAX_STORE_USERS,
        userFingerprints: fingerprints.map((value) => value.slice(0, 16)),
      }
    })
    .sort((left, right) => left.hotelCode.localeCompare(right.hotelCode))
  const hotelPairedUserCount = hotelBindings.reduce(
    (sum, binding) => sum + binding.pairedUserCount,
    0,
  )
  return {
    enabled: weComRepairBotConfig.enabled === true,
    credentialConfigured: Boolean(weComRepairBotCredentials),
    paired: allowedUserIds.length > 0 || hotelPairedUserCount > 0,
    pairedUserCount: allowedUserIds.length,
    pairedUserCapacity: WECOM_REPAIR_BOT_MAX_ALLOWED_USERS,
    hotelPairedUserCount,
    hotelBindings,
    botIdFingerprint:
      weComRepairBotConfig.botIdSha256?.slice(0, 16) ?? null,
    allowedUserFingerprint:
      weComRepairBotConfig.allowedUserIdSha256?.slice(0, 16) ?? null,
    allowedUserFingerprints,
    updatedAt: weComRepairBotConfig.updatedAt,
    pairing: weComRepairBotPairingStore.status(),
    ...runtimeStatus,
  }
}

const weComRepairBotStatusForHotel = (hotelId) => {
  const status = weComRepairBotStatus()
  const hotelBindings = status.hotelBindings.filter(
    (binding) => binding.hotelId === hotelId,
  )
  const pairingMatchesHotel = status.pairing.active
    && status.pairing.scope?.type === 'HOTEL'
    && status.pairing.scope.hotelId === hotelId
  return {
    ...status,
    hotelPairedUserCount:
      hotelBindings[0]?.pairedUserCount ?? 0,
    hotelBindings,
    pairing: pairingMatchesHotel
      ? status.pairing
      : {
        active: false,
        expiresAt: null,
        attemptsRemaining: 0,
      },
  }
}

const weComRepairBotPublicStatus = () => {
  const status = weComRepairBotStatus()
  return {
    enabled: status.enabled,
    credentialConfigured: status.credentialConfigured,
    paired: status.paired,
    connected: status.connected,
    connectionStatus: status.connectionStatus,
    lastAuthenticatedAt: status.lastAuthenticatedAt,
    lastDisconnectedAt: status.lastDisconnectedAt,
    lastErrorCode: status.lastErrorCode,
    updatedAt: status.updatedAt,
  }
}

const weComRepairBotReady = () => {
  const status = weComRepairBotStatus()
  return status.enabled
    && status.credentialConfigured
    && status.paired
    && status.connectionStatus === 'AUTHENTICATED'
    && status.connected
}

const luopanAssistedRepairReady = () =>
  luopanAssistedRepairEnabled
  && (luopanWebRepairReady || weComRepairBotReady())

const luopanRepairReasonCode = () => {
  if (!luopanAssistedRepairEnabled) return 'LUOPAN_REPAIR_DISABLED'
  if (luopanWebRepairReady || weComRepairBotReady()) return null
  const bot = weComRepairBotStatus()
  if (!bot.enabled || !bot.credentialConfigured) {
    return luopanWebRepairConfigurationReason
      === 'LUOPAN_REPAIR_PUBLIC_URL_INVALID'
      ? luopanWebRepairConfigurationReason
      : 'WECOM_REPAIR_BOT_CONFIGURATION_REQUIRED'
  }
  if (!bot.paired) return 'WECOM_REPAIR_BOT_PAIRING_REQUIRED'
  if (bot.connectionStatus !== 'AUTHENTICATED' || !bot.connected) {
    return bot.lastErrorCode ?? 'WECOM_REPAIR_BOT_NOT_CONNECTED'
  }
  return 'LUOPAN_REPAIR_NOT_READY'
}

const bieyanghongPilotHotel = () => hotels.find((hotel) =>
  hotel.hotelCode === BIEYANGHONG_REPAIR_PILOT_HOTEL_CODE
  && hotel.pmsSystemCode === 'MEITUAN_BIEYANGHONG') ?? null

const bieyanghongAssistedRepairReady = () => {
  const hotel = bieyanghongPilotHotel()
  return bieyanghongAssistedRepairEnabled
    && bieyanghongWebRepairReady
    && Boolean(bieyanghongBrowserProfileBase)
    && bieyanghongRemoteDesktopReady()
    && Boolean(hotel)
    && weComRepairBotReady()
}

const bieyanghongRepairReasonCode = () => {
  if (!bieyanghongAssistedRepairEnabled) {
    return 'BIEYANGHONG_REPAIR_DISABLED'
  }
  if (!bieyanghongPilotHotel()) {
    return 'BIEYANGHONG_REPAIR_PILOT_HOTEL_NOT_FOUND'
  }
  if (!bieyanghongWebRepairReady) {
    return bieyanghongRepairConfigurationReason
  }
  if (!bieyanghongBrowserProfileBase) {
    return 'BIEYANGHONG_BROWSER_PROFILE_BASE_REQUIRED'
  }
  if (!bieyanghongRemoteDesktopReady()) {
    return bieyanghongRemoteDesktopConfig.enabled
      ? 'BIEYANGHONG_BROWSER_BROKER_UNAVAILABLE'
      : 'BIEYANGHONG_REMOTE_DESKTOP_RUNTIME_UNAVAILABLE'
  }
  if (!weComRepairBotReady()) {
    return 'WECOM_REPAIR_BOT_NOT_CONNECTED'
  }
  return null
}

if (weComRepairBotConfigPath && existsSync(weComRepairBotConfigPath)) {
  try {
    const persisted = JSON.parse(
      readFileSync(weComRepairBotConfigPath, 'utf8'),
    )
    if (!persisted || typeof persisted !== 'object') {
      throw new Error('WECOM_REPAIR_BOT_CONFIG_INVALID')
    }
    const legacyAllowedUserIdSha256 =
      SHA256_PATTERN.test(String(persisted.allowedUserIdSha256 ?? ''))
        ? String(persisted.allowedUserIdSha256).toLowerCase()
        : null
    const allowedUserIdSha256s = [...new Set([
      ...(Array.isArray(persisted.allowedUserIdSha256s)
        ? persisted.allowedUserIdSha256s
          .map((value) => String(value).toLowerCase())
          .filter((value) => SHA256_PATTERN.test(value))
        : []),
      ...(legacyAllowedUserIdSha256 ? [legacyAllowedUserIdSha256] : []),
    ])]
    if (allowedUserIdSha256s.length > WECOM_REPAIR_BOT_MAX_ALLOWED_USERS) {
      throw new Error('WECOM_REPAIR_BOT_ALLOWED_USERS_INVALID')
    }
    const persistedHotelFingerprints =
      persisted.hotelAllowedUserIdSha256s == null
        ? {}
        : persisted.hotelAllowedUserIdSha256s
    if (
      !persistedHotelFingerprints
      || typeof persistedHotelFingerprints !== 'object'
      || Array.isArray(persistedHotelFingerprints)
    ) {
      throw new Error('WECOM_REPAIR_BOT_HOTEL_ALLOWED_USERS_INVALID')
    }
    const hotelAllowedUserIdSha256s = Object.fromEntries(
      Object.entries(persistedHotelFingerprints)
        .filter(([hotelId]) => hotels.some((hotel) =>
          hotel.hotelId === hotelId))
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([hotelId, values]) => {
          const fingerprints = [...new Set(
            (Array.isArray(values) ? values : [])
              .map((value) => String(value).toLowerCase()),
          )]
          if (
            !Array.isArray(values)
            || fingerprints.length > WECOM_REPAIR_BOT_MAX_STORE_USERS
            || fingerprints.some((value) => !SHA256_PATTERN.test(value))
          ) {
            throw new Error('WECOM_REPAIR_BOT_HOTEL_ALLOWED_USERS_INVALID')
          }
          return [hotelId, fingerprints]
        }),
    )
    weComRepairBotConfig = {
      enabled: persisted.enabled === true,
      botIdSha256:
        SHA256_PATTERN.test(String(persisted.botIdSha256 ?? ''))
          ? String(persisted.botIdSha256).toLowerCase()
          : null,
      allowedUserIdSha256: allowedUserIdSha256s[0] ?? null,
      allowedUserIdSha256s,
      hotelAllowedUserIdSha256s,
      updatedAt:
        typeof persisted.updatedAt === 'string' ? persisted.updatedAt : null,
    }
  } catch {
    process.stderr.write('REVIEW_WECOM_REPAIR_BOT_CONFIG_STORE_IGNORED\n')
  }
}

if (weComRepairBotSecretPath && existsSync(weComRepairBotSecretPath)) {
  try {
    const persisted = JSON.parse(
      readFileSync(weComRepairBotSecretPath, 'utf8'),
    )
    if (!persisted?.record) throw new Error('WECOM_REPAIR_BOT_SECRET_MISSING')
    const credentials = normalizeWeComRepairBotCredentials(JSON.parse(
      decryptCookie(
        persisted.record,
        cookieSecretKey,
        weComRepairBotSecretScope(),
      ),
    ))
    const botIdSha256 = fingerprintWeComRepairBotValue(credentials.botId)
    const allowedUserIdSha256s = credentials.allowedUserIds
      .map(fingerprintWeComRepairBotValue)
    const allowedUserIdSha256 = allowedUserIdSha256s[0] ?? null
    const hotelAllowedUserIdSha256s =
      weComRepairBotHotelUserFingerprints(credentials.hotelAllowedUserIds)
    if (
      (weComRepairBotConfig.botIdSha256
        && weComRepairBotConfig.botIdSha256 !== botIdSha256)
      || (weComRepairBotConfig.allowedUserIdSha256s.length > 0
        && JSON.stringify(weComRepairBotConfig.allowedUserIdSha256s)
          !== JSON.stringify(allowedUserIdSha256s))
      || (Object.keys(weComRepairBotConfig.hotelAllowedUserIdSha256s).length > 0
        && JSON.stringify(weComRepairBotConfig.hotelAllowedUserIdSha256s)
          !== JSON.stringify(hotelAllowedUserIdSha256s))
    ) {
      throw new Error('WECOM_REPAIR_BOT_SECRET_FINGERPRINT_MISMATCH')
    }
    weComRepairBotCredentials = credentials
    weComRepairBotConfig = {
      ...weComRepairBotConfig,
      botIdSha256,
      allowedUserIdSha256,
      allowedUserIdSha256s,
      hotelAllowedUserIdSha256s,
    }
  } catch {
    weComRepairBotCredentials = null
    process.stderr.write('REVIEW_WECOM_REPAIR_BOT_SECRET_STORE_IGNORED\n')
  }
}

const applyWeComRepairBotConfigUpdate = (body) => {
  const credentialUpdate = body?.credentialUpdate ?? { action: 'KEEP' }
  if (
    typeof body?.enabled !== 'boolean'
    || typeof body?.reasonCode !== 'string'
    || !/^[A-Z0-9][A-Z0-9_-]{1,63}$/u.test(body.reasonCode)
    || !credentialUpdate
    || typeof credentialUpdate !== 'object'
    || !['KEEP', 'REPLACE', 'CLEAR'].includes(credentialUpdate.action)
    || (credentialUpdate.action !== 'REPLACE'
      && (Object.hasOwn(credentialUpdate, 'botId')
        || Object.hasOwn(credentialUpdate, 'secret')))
  ) {
    throw new Error('WECOM_REPAIR_BOT_CONFIG_INVALID')
  }

  let nextCredentials = weComRepairBotCredentials
  let nextBotIdSha256 = weComRepairBotConfig.botIdSha256
  let nextAllowedUserIdSha256 = weComRepairBotConfig.allowedUserIdSha256
  let nextAllowedUserIdSha256s =
    weComRepairBotConfig.allowedUserIdSha256s
  let nextHotelAllowedUserIdSha256s =
    weComRepairBotConfig.hotelAllowedUserIdSha256s
  if (credentialUpdate.action === 'REPLACE') {
    const candidateBotId = String(credentialUpdate.botId ?? '').trim()
    const candidateBotIdSha256 = fingerprintWeComRepairBotValue(candidateBotId)
    const preservePairing =
      candidateBotIdSha256 === weComRepairBotConfig.botIdSha256
        ? weComRepairBotCredentials?.allowedUserIds ?? []
        : []
    const preserveHotelPairing =
      candidateBotIdSha256 === weComRepairBotConfig.botIdSha256
        ? weComRepairBotCredentials?.hotelAllowedUserIds ?? {}
        : {}
    nextCredentials = normalizeWeComRepairBotCredentials({
      botId: candidateBotId,
      secret: credentialUpdate.secret,
      allowedUserIds: preservePairing,
      hotelAllowedUserIds: preserveHotelPairing,
    })
    nextBotIdSha256 = candidateBotIdSha256
    nextAllowedUserIdSha256s = preservePairing
      .map(fingerprintWeComRepairBotValue)
    nextAllowedUserIdSha256 = nextAllowedUserIdSha256s[0] ?? null
    nextHotelAllowedUserIdSha256s =
      weComRepairBotHotelUserFingerprints(preserveHotelPairing)
    if (
      preservePairing.length === 0
      && Object.keys(preserveHotelPairing).length === 0
    ) weComRepairBotPairingStore.clear()
  } else if (credentialUpdate.action === 'CLEAR') {
    nextCredentials = null
    nextBotIdSha256 = null
    nextAllowedUserIdSha256 = null
    nextAllowedUserIdSha256s = []
    nextHotelAllowedUserIdSha256s = {}
    weComRepairBotPairingStore.clear()
  }

  if (body.enabled && !nextCredentials) {
    throw new Error('WECOM_REPAIR_BOT_CREDENTIALS_REQUIRED')
  }

  weComRepairBotCredentials = nextCredentials
  weComRepairBotConfig = {
    enabled: body.enabled,
    botIdSha256: nextBotIdSha256,
    allowedUserIdSha256: nextAllowedUserIdSha256,
    allowedUserIdSha256s: nextAllowedUserIdSha256s,
    hotelAllowedUserIdSha256s: nextHotelAllowedUserIdSha256s,
    updatedAt: new Date().toISOString(),
  }
  persistWeComRepairBotSecret()
  persistWeComRepairBotConfig()
  weComRepairBotRuntime?.configure({
    enabled: weComRepairBotConfig.enabled,
    credentials: weComRepairBotCredentials,
  })
  return weComRepairBotStatus()
}

const startWeComRepairBotPairing = (hotelId) => {
  const status = weComRepairBotStatus()
  if (
    !status.enabled
    || !status.credentialConfigured
    || status.connectionStatus !== 'AUTHENTICATED'
    || !status.connected
  ) {
    throw new Error('WECOM_REPAIR_BOT_NOT_CONNECTED')
  }
  const hotel = hotels.find((candidate) => candidate.hotelId === hotelId)
  if (!hotel) {
    throw new Error('WECOM_REPAIR_BOT_PAIRING_HOTEL_INVALID')
  }
  const hotelUserCount =
    weComRepairBotCredentials?.hotelAllowedUserIds?.[hotel.hotelId]?.length ?? 0
  if (hotelUserCount >= WECOM_REPAIR_BOT_MAX_STORE_USERS) {
    throw new Error('WECOM_REPAIR_BOT_PAIRING_LIMIT_REACHED')
  }
  return {
    ...weComRepairBotPairingStore.start({
      scope: { type: 'HOTEL', hotelId: hotel.hotelId },
    }),
    hotelId: hotel.hotelId,
    hotelCode: hotel.hotelCode,
    displayName: hotel.hotelName,
    pairedUserCount: hotelUserCount,
    pairedUserCapacity: WECOM_REPAIR_BOT_MAX_STORE_USERS,
  }
}

if (weComConfigPath && existsSync(weComConfigPath)) {
  try {
    const persisted = JSON.parse(readFileSync(weComConfigPath, 'utf8'))
    for (const [hotelId, config] of Object.entries(persisted)) {
      if (
        !hotels.some((hotel) => hotel.hotelId === hotelId)
        || !config
        || typeof config !== 'object'
      ) {
        continue
      }
      weComConfigsByHotel.set(hotelId, {
        enabled: config.enabled === true,
        sendMinute: 6,
        endpointSha256:
          typeof config.endpointSha256 === 'string'
          && /^[a-f0-9]{64}$/i.test(config.endpointSha256)
            ? config.endpointSha256.toLowerCase()
            : null,
        updatedAt:
          typeof config.updatedAt === 'string' ? config.updatedAt : null,
      })
    }
  } catch {
    process.stderr.write('REVIEW_WECOM_CONFIG_STORE_IGNORED\n')
  }
}

if (weComSecretPath && existsSync(weComSecretPath)) {
  try {
    const persisted = JSON.parse(readFileSync(weComSecretPath, 'utf8'))
    for (const [hotelId, record] of Object.entries(persisted)) {
      if (!hotels.some((hotel) => hotel.hotelId === hotelId)) continue
      const webhook = decryptCookie(
        record,
        cookieSecretKey,
        weComSecretScope(hotelId),
      )
      const fingerprint = fingerprintWeComWebhook(webhook)
      const config = weComConfigsByHotel.get(hotelId)
      if (config?.endpointSha256 && config.endpointSha256 !== fingerprint) {
        continue
      }
      weComSecretsByHotel.set(hotelId, record)
      weComConfigsByHotel.set(hotelId, {
        ...(config ?? {
          enabled: false,
          sendMinute: 6,
          updatedAt: null,
        }),
        endpointSha256: fingerprint,
      })
    }
  } catch {
    process.stderr.write('REVIEW_WECOM_SECRET_STORE_IGNORED\n')
  }
}

if (weComDeliveryPath && existsSync(weComDeliveryPath)) {
  try {
    const persisted = JSON.parse(readFileSync(weComDeliveryPath, 'utf8'))
    if (Array.isArray(persisted)) {
      for (const delivery of persisted.slice(-WECOM_DELIVERY_RETENTION_LIMIT)) {
        if (
          delivery
          && typeof delivery === 'object'
          && typeof delivery.messageKey === 'string'
          && typeof delivery.hotelId === 'string'
        ) {
          weComDeliveriesByKey.set(delivery.messageKey, delivery)
        }
      }
    }
  } catch {
    process.stderr.write('REVIEW_WECOM_DELIVERY_STORE_IGNORED\n')
  }
}

if (briefingHealthAuditPath && existsSync(briefingHealthAuditPath)) {
  try {
    const persisted = JSON.parse(
      readFileSync(briefingHealthAuditPath, 'utf8'),
    )
    const cutoffAt = Date.now() - BRIEFING_HEALTH_AUDIT_RETENTION_MS
    if (Array.isArray(persisted)) {
      for (const audit of persisted) {
        const auditedAt = new Date(audit?.auditedAt ?? '').getTime()
        if (
          audit
          && typeof audit === 'object'
          && typeof audit.auditId === 'string'
          && typeof audit.hotelId === 'string'
          && Number.isFinite(auditedAt)
          && auditedAt >= cutoffAt
        ) {
          briefingHealthAudits.push(audit)
        }
      }
    }
  } catch {
    process.stderr.write('REVIEW_BRIEFING_HEALTH_AUDIT_STORE_IGNORED\n')
  }
}

if (futureDemandRiskStatePath && existsSync(futureDemandRiskStatePath)) {
  try {
    const persisted = JSON.parse(
      readFileSync(futureDemandRiskStatePath, 'utf8'),
    )
    if (persisted && typeof persisted === 'object' && !Array.isArray(persisted)) {
      for (const [key, state] of Object.entries(persisted)) {
        if (
          typeof key === 'string'
          && state
          && typeof state === 'object'
          && typeof state.stayDate === 'string'
        ) {
          futureDemandRiskStates[key] = state
        }
      }
    }
  } catch {
    process.stderr.write('REVIEW_FUTURE_DEMAND_RISK_STORE_IGNORED\n')
  }
}

const persistFutureDemandRiskStates = () => {
  if (!futureDemandRiskStatePath) return
  mkdirSync(dirname(futureDemandRiskStatePath), { recursive: true })
  const temporaryPath =
    `${futureDemandRiskStatePath}.${process.pid}.tmp`
  writeFileSync(
    temporaryPath,
    `${JSON.stringify(futureDemandRiskStates, null, 2)}\n`,
    { encoding: 'utf8', mode: 0o600 },
  )
  renameSync(temporaryPath, futureDemandRiskStatePath)
}

const json = (response, status, body, headers = {}) => {
  const content = JSON.stringify(body)
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(content),
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'x-ota-review-mode': 'local-live-pilot',
    ...headers,
  })
  response.end(content)
}

const empty = (response, status = 204, headers = {}) => {
  response.writeHead(status, {
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'x-ota-review-mode': 'local-live-pilot',
    ...headers,
  })
  response.end()
}

const attachment = (response, fileName, content, headers = {}) => {
  const body = Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf8')
  response.writeHead(200, {
    'content-type': 'application/octet-stream',
    'content-length': body.length,
    'content-disposition': `attachment; filename="${fileName}"`,
    'cache-control': 'no-store, max-age=0',
    'x-content-type-options': 'nosniff',
    'x-ota-review-mode': 'local-live-pilot',
    ...headers,
  })
  response.end(body)
}

const repairHtml = (response) => {
  const content = renderLuopanRepairPage()
  response.writeHead(200, {
    'content-type': 'text/html; charset=utf-8',
    'content-length': Buffer.byteLength(content),
    'cache-control': 'no-store, max-age=0',
    'content-security-policy':
      `default-src 'none'; base-uri 'none'; frame-ancestors 'none'; `
      + `form-action 'self'; img-src 'self' blob:; connect-src 'self'; `
      + `style-src 'unsafe-inline'; script-src 'self'`,
    'permissions-policy':
      'camera=(), geolocation=(), microphone=(), payment=(), usb=()',
    'referrer-policy': 'no-referrer',
    'x-content-type-options': 'nosniff',
    'x-frame-options': 'DENY',
  })
  response.end(content)
}

const repairClientScript = (response) => {
  const content = renderLuopanRepairClientScript()
  response.writeHead(200, {
    'content-type': 'application/javascript; charset=utf-8',
    'content-length': Buffer.byteLength(content),
    'cache-control': 'no-store, max-age=0',
    'referrer-policy': 'no-referrer',
    'x-content-type-options': 'nosniff',
  })
  response.end(content)
}

const bieyanghongRepairHtml = (response) => {
  const content = renderBieyanghongRepairPage()
  response.writeHead(200, {
    'content-type': 'text/html; charset=utf-8',
    'content-length': Buffer.byteLength(content),
    'cache-control': 'no-store, max-age=0',
    'content-security-policy':
      `default-src 'none'; base-uri 'none'; frame-ancestors 'none'; `
      + `form-action 'self'; img-src 'self' blob:; connect-src 'self'; `
      + `style-src 'unsafe-inline'; `
      + `script-src 'self'`,
    'permissions-policy':
      'camera=(), geolocation=(), microphone=(), payment=(), usb=()',
    'referrer-policy': 'no-referrer',
    'x-content-type-options': 'nosniff',
    'x-frame-options': 'DENY',
  })
  response.end(content)
}

const bieyanghongRepairClientScript = (response) => {
  const content = renderBieyanghongRepairClientScript()
  response.writeHead(200, {
    'content-type': 'application/javascript; charset=utf-8',
    'content-length': Buffer.byteLength(content),
    'cache-control': 'no-store, max-age=0',
    'referrer-policy': 'no-referrer',
    'x-content-type-options': 'nosniff',
  })
  response.end(content)
}

const bieyanghongOfficialLoginHtml = (response) => {
  const content = renderBieyanghongOfficialLoginPage()
  response.writeHead(200, {
    'content-type': 'text/html; charset=utf-8',
    'content-length': Buffer.byteLength(content),
    'cache-control': 'no-store, max-age=0',
    'content-security-policy':
      `default-src 'none'; base-uri 'none'; frame-ancestors 'none'; `
      + `form-action 'self'; img-src 'self' blob:; `
      + `connect-src 'self'; frame-src 'self'; `
      + `style-src 'unsafe-inline'; script-src 'self'`,
    'permissions-policy':
      'camera=(), geolocation=(), microphone=(), payment=(), usb=()',
    'referrer-policy': 'no-referrer',
    'x-content-type-options': 'nosniff',
    'x-frame-options': 'DENY',
  })
  response.end(content)
}

const bieyanghongOfficialLoginClientScript = (response) => {
  const content = renderBieyanghongOfficialLoginClientScript()
  response.writeHead(200, {
    'content-type': 'application/javascript; charset=utf-8',
    'content-length': Buffer.byteLength(content),
    'cache-control': 'no-store, max-age=0',
    'referrer-policy': 'no-referrer',
    'x-content-type-options': 'nosniff',
  })
  response.end(content)
}

const serveBieyanghongNoVncAsset = (response, requestPath) => {
  if (
    !requestPath.startsWith(BIEYANGHONG_NOVNC_ROUTE_PREFIX)
    || !existsSync(bieyanghongNoVncRoot)
  ) return false
  let relativePath
  try {
    relativePath = decodeURIComponent(
      requestPath.slice(BIEYANGHONG_NOVNC_ROUTE_PREFIX.length),
    )
  } catch {
    return false
  }
  if (!relativePath) relativePath = 'vnc.html'
  if (
    relativePath.includes('\0')
    || relativePath.includes('\\')
    || relativePath.startsWith('/')
    || !(
      relativePath === 'vnc.html'
      || relativePath === 'vnc_lite.html'
      || relativePath === 'vnc_lite_bootstrap.js'
      || relativePath.startsWith('app/')
      || relativePath.startsWith('core/')
      || relativePath.startsWith('vendor/')
    )
  ) return false
  try {
    const root = realpathSync(bieyanghongNoVncRoot)
    const sourcePath = relativePath === 'vnc_lite_bootstrap.js'
      ? 'vnc_lite.html'
      : relativePath
    const candidate = resolve(root, sourcePath)
    if (candidate !== root && !candidate.startsWith(`${root}${sep}`)) {
      return false
    }
    const actual = realpathSync(candidate)
    if (actual !== root && !actual.startsWith(`${root}${sep}`)) return false
    const stats = statSync(actual)
    if (!stats.isFile() || stats.size > 8 * 1024 * 1024) return false
    let content = readFileSync(actual)
    const inlineModulePattern =
      /<script\b((?![^>]*\bsrc\s*=)[^>]*\btype=["']module["'][^>]*)>([\s\S]*?)<\/script>/iu
    if (relativePath === 'vnc_lite_bootstrap.js') {
      const match = content.toString('utf8').match(inlineModulePattern)
      if (!match || !match[2].trim()) return false
      content = Buffer.from(match[2], 'utf8')
    } else if (relativePath === 'vnc_lite.html') {
      const html = content.toString('utf8')
      const match = html.match(inlineModulePattern)
      if (!match) return false
      content = Buffer.from(
        html.replace(
          inlineModulePattern,
          `<script${match[1]} src="./vnc_lite_bootstrap.js"></script>`,
        ),
        'utf8',
      )
    }
    const contentType =
      BIEYANGHONG_NOVNC_CONTENT_TYPES[extname(relativePath).toLowerCase()]
      ?? 'application/octet-stream'
    const headers = {
      'content-type': contentType,
      'content-length': content.length,
      'cache-control': 'no-store, max-age=0',
      'cross-origin-resource-policy': 'same-origin',
      'referrer-policy': 'no-referrer',
      'x-content-type-options': 'nosniff',
    }
    if (contentType.startsWith('text/html')) {
      headers['content-security-policy'] =
        `default-src 'self'; base-uri 'none'; object-src 'none'; `
        + `frame-ancestors 'self'; connect-src 'self'; `
        + `img-src 'self' data:; style-src 'self' 'unsafe-inline'; `
        + `script-src 'self'; font-src 'self'`
    }
    response.writeHead(200, headers)
    response.end(content)
    return true
  } catch {
    return false
  }
}

const bieyanghongVisualFrame = (response, image) => {
  response.writeHead(200, {
    'content-type': 'image/png',
    'content-length': image.length,
    'cache-control': 'no-store, max-age=0',
    'vary': 'authorization',
    'content-disposition': 'inline; filename="meituan-verification.png"',
    'referrer-policy': 'no-referrer',
    'x-content-type-options': 'nosniff',
  })
  response.end(image)
}

const repairCaptcha = (response, captcha) => {
  response.writeHead(200, {
    'content-type': 'image/png',
    'content-length': captcha.length,
    'cache-control': 'no-store, max-age=0',
    'content-disposition': 'inline; filename="captcha.png"',
    'referrer-policy': 'no-referrer',
    'x-content-type-options': 'nosniff',
  })
  response.end(captcha)
}

const repairTokenFrom = (request) => {
  const authorization = String(request.headers.authorization ?? '')
  return authorization.startsWith('Repair ')
    ? authorization.slice('Repair '.length).trim()
    : ''
}

const loopbackPilotTriggerAuthorized = (request) => {
  const remoteAddress = String(request.socket?.remoteAddress ?? '')
  const forwarded =
    request.headers['x-forwarded-for']
    || request.headers['x-real-ip']
    || request.headers.forwarded
  const authorization = String(request.headers.authorization ?? '')
  const supplied = authorization.startsWith('Pilot ')
    ? authorization.slice('Pilot '.length).trim()
    : ''
  if (
    forwarded
    || !['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(remoteAddress)
    || !supplied
    || !bootstrapAccessToken
  ) return false
  const suppliedHash = createHash('sha256').update(supplied).digest()
  const expectedHash = createHash('sha256')
    .update(bootstrapAccessToken)
    .digest()
  return timingSafeEqual(suppliedHash, expectedHash)
}

const readBody = async (request) => {
  const chunks = []
  let bytes = 0
  for await (const chunk of request) {
    bytes += chunk.length
    if (bytes > 512 * 1024) throw new Error('REQUEST_TOO_LARGE')
    chunks.push(chunk)
  }
  if (chunks.length === 0) return {}
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

const selectedHotel = (hotelId) =>
  hotels.find((hotel) => hotel.hotelId === hotelId) ?? hotels[0]

const configurationFor = (hotelId) => {
  const selected = selectedHotel(hotelId)
  const suffix = selected.hotelId.endsWith('2') ? '2' : '1'
  const connectors = [
    {
      connectorId: `31000000-0000-4000-8000-00000000000${suffix}`,
      adapterCode: 'CTRIP_SIM',
      sourceCode: 'CTRIP',
      enabled: true,
      fixtureScenarioCode: 'BASELINE',
      pollIntervalMinutes: 5,
      rowVersion: 1,
      secret: { referenceConfigured: false },
    },
    {
      connectorId: `32000000-0000-4000-8000-00000000000${suffix}`,
      adapterCode: 'MEITUAN_SIM',
      sourceCode: 'MEITUAN',
      enabled: true,
      fixtureScenarioCode: 'BASELINE',
      pollIntervalMinutes: 5,
      rowVersion: 1,
      secret: { referenceConfigured: false },
    },
  ]
  const pools = [
    {
      inventoryPoolId: `40000000-0000-4000-8000-0000000000${suffix}1`,
      physicalRoomTypeCode: 'VIEW_TWIN',
      displayName: '景观双床房',
      physicalRoomCount: 18,
      rowVersion: 1,
    },
    {
      inventoryPoolId: `40000000-0000-4000-8000-0000000000${suffix}2`,
      physicalRoomTypeCode: 'LUXURY_KING',
      displayName: '轻奢大床房',
      physicalRoomCount: 16,
      rowVersion: 1,
    },
  ]
  const products = [
    {
      productId: `50000000-0000-4000-8000-0000000000${suffix}1`,
      connectorId: connectors[0].connectorId,
      sourceCode: 'CTRIP',
      externalProductCode: 'CTRIP-VIEW-RO',
      displayName: '景观双床房·无早',
      mealPlanCode: 'ROOM_ONLY',
      rowVersion: 1,
    },
    {
      productId: `50000000-0000-4000-8000-0000000000${suffix}2`,
      connectorId: connectors[0].connectorId,
      sourceCode: 'CTRIP',
      externalProductCode: 'CTRIP-VIEW-BF',
      displayName: '景观双床房·双早',
      mealPlanCode: 'BREAKFAST_INCLUDED',
      rowVersion: 1,
    },
    {
      productId: `50000000-0000-4000-8000-0000000000${suffix}3`,
      connectorId: connectors[1].connectorId,
      sourceCode: 'MEITUAN',
      externalProductCode: 'MT-LUXURY-RO',
      displayName: '轻奢大床房·无早',
      mealPlanCode: 'ROOM_ONLY',
      rowVersion: 1,
    },
  ]
  return {
    tenant: {
      tenantId: selected.tenantId,
      tenantCode: selected.tenantCode,
      displayName: selected.tenantName,
      timezone: selected.timezone,
      status: 'ACTIVE',
      rowVersion: 1,
    },
    hotel: {
      tenantId: selected.tenantId,
      hotelId: selected.hotelId,
      hotelCode: selected.hotelCode,
      displayName: selected.hotelName,
      timezone: selected.timezone,
      lifecycleStatus: selected.lifecycleStatus,
      collectionEnabled: true,
      messageEnabled: false,
      rowVersion: selected.rowVersion,
    },
    connectors,
    inventoryPools: pools,
    products,
    productMappings: [
      {
        mappingVersionId: `60000000-0000-4000-8000-0000000000${suffix}1`,
        productId: products[0].productId,
        inventoryPoolId: pools[0].inventoryPoolId,
        validFrom: '2026-07-01T00:00:00+08:00',
        rowVersion: 1,
      },
      {
        mappingVersionId: `60000000-0000-4000-8000-0000000000${suffix}2`,
        productId: products[1].productId,
        inventoryPoolId: pools[0].inventoryPoolId,
        validFrom: '2026-07-01T00:00:00+08:00',
        rowVersion: 1,
      },
      {
        mappingVersionId: `60000000-0000-4000-8000-0000000000${suffix}3`,
        productId: products[2].productId,
        inventoryPoolId: pools[1].inventoryPoolId,
        validFrom: '2026-07-01T00:00:00+08:00',
        rowVersion: 1,
      },
    ],
    targets: [
      {
        targetVersionId: `70000000-0000-4000-8000-00000000000${suffix}`,
        businessDate: '2026-07-25',
        roomRevenueTarget: '10000.00',
        targetAdr: '200.00',
        rowVersion: 1,
      },
    ],
    paceCurves: [
      {
        paceCurveVersionId: `71000000-0000-4000-8000-00000000000${suffix}`,
        curveCode: 'PEAK_SEASON',
        validFrom: '2026-07-01T00:00:00+08:00',
        points: [
          {
            cutoffLocalTime: '12:00',
            revenueProgressPercent: '52.0',
            soldProgressPercent: '50.0',
          },
          {
            cutoffLocalTime: '18:00',
            revenueProgressPercent: '88.2',
            soldProgressPercent: '88.2',
          },
          {
            cutoffLocalTime: '22:00',
            revenueProgressPercent: '98.0',
            soldProgressPercent: '97.0',
          },
        ],
        rowVersion: 1,
      },
    ],
    simulationMode: true,
    outboundDeliveryBlocked: true,
  }
}

const monitorFor = (hotelId) => {
  const selected = selectedHotel(hotelId)
  return {
    tenantId: selected.tenantId,
    hotelId: selected.hotelId,
    hotelName: selected.hotelName,
    businessDate: '2026-07-25',
    cutoffAt: '2026-07-25T18:00:00+08:00',
    completeness: 'COMPLETE',
    simulationMode: true,
    sources: [
      {
        sourceCode: 'REPORT_ORDER',
        completeness: 'COMPLETE',
        sourceObservedAt: '2026-07-25T18:00:02+08:00',
        ingestedAt: '2026-07-25T18:00:04+08:00',
      },
      {
        sourceCode: 'REPORT_REVENUE',
        completeness: 'COMPLETE',
        sourceObservedAt: '2026-07-25T18:00:03+08:00',
        ingestedAt: '2026-07-25T18:00:05+08:00',
      },
      {
        sourceCode: 'REPORT_INVENTORY',
        completeness: 'COMPLETE',
        sourceObservedAt: '2026-07-25T18:00:03+08:00',
        ingestedAt: '2026-07-25T18:00:05+08:00',
      },
    ],
    metrics: {
      totalRevenue: { value: 7849, unit: 'CURRENCY', state: 'AVAILABLE' },
      adr: { value: 201.26, unit: 'CURRENCY', state: 'AVAILABLE' },
      revPar: { value: 156.98, unit: 'CURRENCY', state: 'AVAILABLE' },
      soldRooms: { value: 39, unit: 'ROOM', state: 'AVAILABLE' },
      availableRooms: { value: 11, unit: 'ROOM', state: 'AVAILABLE' },
      targetProgress: { value: 78.5, unit: 'PERCENT', state: 'AVAILABLE' },
      sellProgress: { value: 78, unit: 'PERCENT', state: 'AVAILABLE' },
    },
    inventory: [
      {
        inventoryPoolId: '40000000-0000-4000-8000-000000000011',
        physicalRoomTypeCode: 'VIEW_TWIN',
        displayName: '景观双床房',
        primaryAvailableRooms: 2,
        otaAvailableRooms: {
          'CTRIP-VIEW-RO': 2,
          'CTRIP-VIEW-BF': 2,
          'MEITUAN-VIEW-RO': 1,
        },
        state: 'P1_RISK',
      },
      {
        inventoryPoolId: '40000000-0000-4000-8000-000000000012',
        physicalRoomTypeCode: 'LUXURY_KING',
        displayName: '轻奢大床房',
        primaryAvailableRooms: 4,
        otaAvailableRooms: {
          'CTRIP-LUXURY-RO': 4,
          'MEITUAN-LUXURY-RO': 4,
        },
        state: 'MATCHED',
      },
    ],
  }
}

const liveMonitorFor = (hotelId) => {
  const hotel = selectedHotel(hotelId)
  const snapshots = liveSnapshotStore[hotelId] ?? []
  const snapshot = snapshots.at(-1) ?? null
  return monitorFromSnapshot(
    snapshot,
    hotel,
    null,
    hotSellingRoomTypesFor(hotelId).roomTypeCodes,
  )
}

const otaControlledLoginKey = (hotelId, platformCode) =>
  `${hotelId}:${platformCode}`

const otaPlatformSourcesFor = (hotelId, platformCode) =>
  (otaSourcesByHotel.get(hotelId) ?? [])
    .filter((source) => source.platformCode === platformCode)

const latestOtaLoginStateSource = (sources) => [...sources]
  .sort((left, right) =>
    new Date(right.lastLoginAttemptAt ?? 0).getTime()
    - new Date(left.lastLoginAttemptAt ?? 0).getTime())[0] ?? null

const updateOtaPlatformLoginState = (
  hotelId,
  platformCode,
  patch,
) => {
  const sources = otaSourcesByHotel.get(hotelId) ?? []
  const updated = sources.map((source) =>
    source.platformCode === platformCode ? { ...source, ...patch } : source)
  otaSourcesByHotel.set(hotelId, updated)
  persistOtaSources()
  return updated.filter((source) => source.platformCode === platformCode)
}

const cleanExpiredOtaControlledLogin = async (hotelId, platformCode) => {
  const key = otaControlledLoginKey(hotelId, platformCode)
  const active = activeOtaControlledLoginAttempts.get(key)
  if (!active || active.expiresAt > Date.now()) return
  activeOtaControlledLoginAttempts.delete(key)
  clearTimeout(active.expiryTimer)
  await active.login.close().catch(() => {})
  updateOtaPlatformLoginState(hotelId, platformCode, {
    lastLoginStatus: 'FAILED',
    lastLoginErrorCode: 'OTA_FLIGGY_VERIFICATION_EXPIRED',
  })
}

const storeOtaControlledLoginChallenge = (
  hotelId,
  platformCode,
  attempt,
) => {
  const key = otaControlledLoginKey(hotelId, platformCode)
  const expiresAt =
    Date.now()
    + fliggyControlledLoginPolicy.challengeTtlMinutes * 60_000
  const expiryTimer = setTimeout(() => {
    const active = activeOtaControlledLoginAttempts.get(key)
    if (!active || active.attemptId !== attempt.attemptId) return
    activeOtaControlledLoginAttempts.delete(key)
    void active.login.close().catch(() => {})
    updateOtaPlatformLoginState(hotelId, platformCode, {
      lastLoginStatus: 'FAILED',
      lastLoginErrorCode: 'OTA_FLIGGY_VERIFICATION_EXPIRED',
    })
  }, Math.max(1, expiresAt - Date.now()))
  expiryTimer.unref()
  activeOtaControlledLoginAttempts.set(key, {
    ...attempt,
    expiresAt,
    expiryTimer,
  })
}

const otaControlledLoginProfilesFor = (hotelId) => {
  const platformCode = 'FLIGGY'
  const sources = otaPlatformSourcesFor(hotelId, platformCode)
  if (sources.length < 1) return []
  const state = latestOtaLoginStateSource(sources)
  const secrets = otaSecretsForHotel(hotelId)
  const credentialSourceCount = sources.filter(
    (source) => Boolean(secrets[source.sourceId]?.credentials),
  ).length
  const cookieSourceCount = sources.filter(
    (source) => Boolean(secrets[source.sourceId]?.cookie),
  ).length
  const rateLimit = fliggyLoginRateLimitState({
    windowStartedAt: state?.loginAttemptWindowStartedAt,
    attemptCount: state?.loginAttemptCount,
  })
  const expiredPersistedRateLimit = Boolean(
    !rateLimit.rateLimited
    && state?.lastLoginStatus === 'RATE_LIMITED',
  )
  const active = activeOtaControlledLoginAttempts.get(
    otaControlledLoginKey(hotelId, platformCode),
  )
  return [{
    platformCode,
    loginMode: 'CONTROLLED_BROWSER_CREDENTIALS',
    supported: true,
    credentialSourceCount,
    credentialsConfigured: credentialSourceCount > 0,
    sessionSourceCount: cookieSourceCount,
    sessionConfigured: cookieSourceCount > 0,
    autoRenewEnabled: sources.some((source) => source.autoLoginEnabled),
    status: rateLimit.rateLimited
      ? 'RATE_LIMITED'
      : active
        ? 'VERIFICATION_REQUIRED'
        : expiredPersistedRateLimit
          ? 'FAILED'
          : state?.lastLoginStatus ?? 'NEVER',
    lastAttemptAt: state?.lastLoginAttemptAt ?? null,
    lastAuthenticatedAt: state?.lastLoginAt ?? null,
    lastErrorCode: rateLimit.rateLimited
      ? 'OTA_FLIGGY_LOGIN_RATE_LIMITED'
      : expiredPersistedRateLimit
        ? null
        : state?.lastLoginErrorCode ?? null,
    nextAttemptAt: rateLimit.nextAttemptAt,
    attemptCount: rateLimit.attemptCount,
    maxAttempts: rateLimit.maxAttempts,
    challengeActive: Boolean(active),
  }]
}

const otaCredentialsForPlatform = (hotelId, platformCode) => {
  const sources = otaPlatformSourcesFor(hotelId, platformCode)
  const configured = sources
    .filter((source) =>
      Boolean(otaSecretsForHotel(hotelId)[source.sourceId]?.credentials))
    .map((source) => otaSecretValuesFor(hotelId, source.sourceId).credentials)
  if (configured.length < 1) {
    throw new Error('OTA_CHANNEL_CREDENTIALS_MISSING')
  }
  const selected = configured[0]
  if (configured.some((credentials) =>
    credentials.account !== selected.account
    || credentials.password !== selected.password)) {
    throw new Error('OTA_CHANNEL_CREDENTIALS_CONFLICT')
  }
  return selected
}

const beginOtaControlledLoginAttempt = (
  hotelId,
  platformCode,
  now = new Date(),
) => {
  const sources = otaPlatformSourcesFor(hotelId, platformCode)
  if (sources.length < 1) throw new Error('OTA_CHANNEL_NOT_CONFIGURED')
  const state = latestOtaLoginStateSource(sources)
  const currentWindowStartedAt = new Date(
    state?.loginAttemptWindowStartedAt ?? 0,
  )
  const windowExpired = !Number.isFinite(currentWindowStartedAt.getTime())
    || now.getTime() - currentWindowStartedAt.getTime()
      >= fliggyControlledLoginPolicy.attemptWindowMinutes * 60_000
  const windowStartedAt = windowExpired ? now : currentWindowStartedAt
  const attemptCount = windowExpired ? 0 : state?.loginAttemptCount ?? 0
  if (attemptCount >= fliggyControlledLoginPolicy.maxAttemptsPerWindow) {
    updateOtaPlatformLoginState(hotelId, platformCode, {
      lastLoginStatus: 'RATE_LIMITED',
      lastLoginErrorCode: 'OTA_FLIGGY_LOGIN_RATE_LIMITED',
    })
    throw new Error('OTA_FLIGGY_LOGIN_RATE_LIMITED')
  }
  updateOtaPlatformLoginState(hotelId, platformCode, {
    lastLoginStatus: 'RUNNING',
    lastLoginAttemptAt: now.toISOString(),
    lastLoginErrorCode: null,
    loginAttemptWindowStartedAt: windowStartedAt.toISOString(),
    loginAttemptCount: attemptCount + 1,
  })
}

const applyFliggyAuthenticatedSession = (
  hotelId,
  login,
  now = new Date(),
) => {
  const sources = otaPlatformSourcesFor(hotelId, 'FLIGGY')
  const needsMtop = sources.some((source) => {
    const endpointUrl = source.dataEndpointUrl
      || builtInFliggyEndpointUrl(source)
    try {
      return new URL(endpointUrl).hostname.toLowerCase()
        === 'h5api.m.fliggy.com'
    } catch {
      return false
    }
  })
  if (needsMtop && !fliggyMtopTokenAvailable(login.sessionState)) {
    throw new Error('OTA_FLIGGY_MTOP_SESSION_UNAVAILABLE')
  }
  const currentSecrets = otaSecretsForHotel(hotelId)
  const nextSecrets = { ...currentSecrets }
  for (const source of sources) {
    const endpointUrl = source.dataEndpointUrl
      || builtInFliggyEndpointUrl(source)
    if (!endpointUrl) continue
    const host = new URL(endpointUrl).hostname.toLowerCase()
    const cookie = fliggyCookieHeaderForHost(login.sessionState, host)
    if (!cookie) throw new Error('OTA_FLIGGY_SESSION_INCOMPLETE')
    const records = { ...(nextSecrets[source.sourceId] ?? {}) }
    records.cookie = encryptCookie(
      cookie,
      cookieSecretKey,
      otaSecretScope(hotelId, source.sourceId, 'cookie'),
    )
    nextSecrets[source.sourceId] = records
  }
  otaSourceSecretsByHotel.set(hotelId, nextSecrets)
  persistOtaSecrets()
  updateOtaPlatformLoginState(hotelId, 'FLIGGY', {
    autoLoginEnabled: true,
    lastLoginStatus: 'AUTHENTICATED',
    lastLoginAt: now.toISOString(),
    lastLoginErrorCode: null,
  })
}

const otaControlledLoginPublicResult = (
  hotelId,
  login,
  { attemptId = null } = {},
) => ({
  profile: otaControlledLoginProfilesFor(hotelId)[0] ?? null,
  status: login.status,
  reasonCode: login.reasonCode ?? null,
  attemptId,
  challengeType: login.challengeType ?? null,
  captchaImageDataUrl: login.captcha
    ? `data:image/png;base64,${login.captcha.toString('base64')}`
    : null,
})

const finalizeOtaControlledLogin = async (
  hotelId,
  platformCode,
  login,
) => {
  if (login.status === 'AUTHENTICATED') {
    try {
      applyFliggyAuthenticatedSession(hotelId, login)
      return otaControlledLoginPublicResult(hotelId, login)
    } finally {
      await login.close().catch(() => {})
    }
  }
  if (login.status === 'VERIFICATION_REQUIRED' && login.submit) {
    const attemptId = randomUUID()
    storeOtaControlledLoginChallenge(hotelId, platformCode, {
      attemptId,
      hotelId,
      platformCode,
      login,
      answerCount: 0,
    })
    updateOtaPlatformLoginState(hotelId, platformCode, {
      lastLoginStatus: 'VERIFICATION_REQUIRED',
      lastLoginErrorCode: login.reasonCode,
    })
    return otaControlledLoginPublicResult(
      hotelId,
      login,
      { attemptId },
    )
  }
  updateOtaPlatformLoginState(hotelId, platformCode, {
    lastLoginStatus: login.status === 'EXTERNAL_VERIFICATION_REQUIRED'
      ? 'EXTERNAL_VERIFICATION_REQUIRED'
      : 'FAILED',
    lastLoginErrorCode: login.reasonCode ?? 'OTA_FLIGGY_LOGIN_FAILED',
  })
  await login.close().catch(() => {})
  return otaControlledLoginPublicResult(hotelId, login)
}

const startOtaControlledLoginFor = async (
  hotelId,
  platformCode,
  { allowInteractiveChallenge = true } = {},
) => {
  if (platformCode !== 'FLIGGY') {
    throw new Error('OTA_CONTROLLED_LOGIN_UNSUPPORTED')
  }
  await cleanExpiredOtaControlledLogin(hotelId, platformCode)
  const key = otaControlledLoginKey(hotelId, platformCode)
  if (activeOtaControlledLoginAttempts.has(key)) {
    throw new Error('OTA_CONTROLLED_LOGIN_ALREADY_RUNNING')
  }
  const running = otaControlledLoginLocks.get(key)
  if (running) return running
  const operation = (async () => {
    const credentials = otaCredentialsForPlatform(hotelId, platformCode)
    beginOtaControlledLoginAttempt(hotelId, platformCode)
    let login
    try {
      login = await startFliggyControlledLogin({ credentials })
      if (!allowInteractiveChallenge && login.status !== 'AUTHENTICATED') {
        updateOtaPlatformLoginState(hotelId, platformCode, {
          lastLoginStatus: login.status === 'EXTERNAL_VERIFICATION_REQUIRED'
            || login.status === 'VERIFICATION_REQUIRED'
            ? 'VERIFICATION_REQUIRED'
            : 'FAILED',
          lastLoginErrorCode:
            login.reasonCode ?? 'OTA_FLIGGY_LOGIN_FAILED',
        })
        await login.close().catch(() => {})
        return otaControlledLoginPublicResult(hotelId, login)
      }
      return await finalizeOtaControlledLogin(
        hotelId,
        platformCode,
        login,
      )
    } catch (error) {
      await login?.close?.().catch(() => {})
      const errorCode = safeOtaRefreshErrorCode(error)
      updateOtaPlatformLoginState(hotelId, platformCode, {
        lastLoginStatus: errorCode === 'OTA_FLIGGY_LOGIN_RATE_LIMITED'
          ? 'RATE_LIMITED'
          : 'FAILED',
        lastLoginErrorCode: errorCode,
      })
      throw new Error(errorCode)
    }
  })()
  otaControlledLoginLocks.set(key, operation)
  try {
    return await operation
  } finally {
    otaControlledLoginLocks.delete(key)
  }
}

const submitOtaControlledLoginAnswer = async (
  hotelId,
  platformCode,
  attemptId,
  answer,
) => {
  await cleanExpiredOtaControlledLogin(hotelId, platformCode)
  const key = otaControlledLoginKey(hotelId, platformCode)
  const active = activeOtaControlledLoginAttempts.get(key)
  if (!active || active.attemptId !== attemptId) {
    throw new Error('OTA_FLIGGY_VERIFICATION_ATTEMPT_INVALID')
  }
  if (
    active.answerCount
    >= fliggyControlledLoginPolicy.maxVerificationAnswers
  ) {
    activeOtaControlledLoginAttempts.delete(key)
    clearTimeout(active.expiryTimer)
    await active.login.close().catch(() => {})
    updateOtaPlatformLoginState(hotelId, platformCode, {
      lastLoginStatus: 'FAILED',
      lastLoginErrorCode: 'OTA_FLIGGY_VERIFICATION_LIMIT_REACHED',
    })
    throw new Error('OTA_FLIGGY_VERIFICATION_LIMIT_REACHED')
  }
  active.answerCount += 1
  const login = await active.login.submit(answer)
  activeOtaControlledLoginAttempts.delete(key)
  clearTimeout(active.expiryTimer)
  if (login.status === 'VERIFICATION_REQUIRED' && login.submit) {
    storeOtaControlledLoginChallenge(hotelId, platformCode, {
      ...active,
      login,
    })
    updateOtaPlatformLoginState(hotelId, platformCode, {
      lastLoginStatus: 'VERIFICATION_REQUIRED',
      lastLoginErrorCode: login.reasonCode,
    })
    return otaControlledLoginPublicResult(
      hotelId,
      login,
      { attemptId },
    )
  }
  return finalizeOtaControlledLogin(hotelId, platformCode, login)
}

const safeOtaRefreshErrorCode = (error) => {
  const code = typeof error?.message === 'string' ? error.message : ''
  return code.startsWith('OTA_') ? code : 'OTA_REFRESH_FAILED'
}

const hasEnabledMeituanReviewSource = (hotelId) =>
  (otaSourcesByHotel.get(hotelId) ?? []).some((source) => {
    if (!source.enabled || source.platformCode !== 'MEITUAN') return false
    try {
      const endpoint = new URL(source.dataEndpointUrl)
      return endpoint.hostname.toLowerCase() === 'me.meituan.com'
        && endpoint.pathname
          === '/api/gw/v1/base/comments/queryGeneralCommentInfo'
    } catch {
      return false
    }
  })

const refreshOtaSourceFor = async (hotelId, sourceId) => {
  const lockKey = `${hotelId}:${sourceId}`
  const running = otaSourceRefreshLocks.get(lockKey)
  if (running) return running
  const operation = (async () => {
    const sources = otaSourcesByHotel.get(hotelId) ?? []
    const sourceIndex = sources.findIndex(
      (candidate) => candidate.sourceId === sourceId,
    )
    if (sourceIndex < 0) throw new Error('OTA_SOURCE_NOT_FOUND')
    const source = sources[sourceIndex]
    try {
      let observedRoomTypes = []
      const collectSource = async (candidateSource) => {
        observedRoomTypes = []
        return collectOtaSource({
          source: candidateSource,
          cookie: otaSecretValuesFor(hotelId, sourceId).cookie,
          businessDate: (liveSnapshotStore[hotelId] ?? []).at(-1)
            ?.businessDate,
          validStayedOrderCountThroughPreviousBusinessDate: null,
          onRoomTypeCatalog: (roomTypes) => {
            observedRoomTypes = mergeRoomTypeCatalogs(roomTypes)
          },
          roomTypeCatalogScope: `${hotelId}:${sourceId}`,
          roomTypeCatalogHmacKey: cookieSecretKey,
        })
      }
      const collect = async () => {
        try {
          return await collectSource(source)
        } catch (error) {
          const fallbackSource = fliggyBuiltInFallbackSource({
            source,
            errorCode: safeOtaRefreshErrorCode(error),
          })
          if (!fallbackSource) throw error
          return collectSource(fallbackSource)
        }
      }
      let summary
      try {
        summary = await collect()
      } catch (firstError) {
        const firstErrorCode = safeOtaRefreshErrorCode(firstError)
        const sessionInvalid = source.platformCode === 'FLIGGY'
          && source.autoLoginEnabled
          && [
            'OTA_FLIGGY_SESSION_INVALID',
            'OTA_SESSION_INVALID',
          ].includes(firstErrorCode)
        if (!sessionInvalid) throw firstError
        const renewed = await startOtaControlledLoginFor(
          hotelId,
          'FLIGGY',
          { allowInteractiveChallenge: false },
        )
        if (renewed.status !== 'AUTHENTICATED') {
          throw new Error(
            renewed.reasonCode ?? 'OTA_FLIGGY_VERIFICATION_REQUIRED',
          )
        }
        summary = await collect()
      }
      const activeSources = otaSourcesByHotel.get(hotelId) ?? []
      const activeSourceIndex = activeSources.findIndex(
        (candidate) => candidate.sourceId === sourceId,
      )
      const activeSource = activeSources[activeSourceIndex]
      if (
        !activeSource
        || activeSource.rowVersion !== source.rowVersion
        || activeSource.platformCode !== source.platformCode
      ) {
        throw new Error('OTA_SOURCE_CHANGED_DURING_REFRESH')
      }
      const updated = {
        ...activeSource,
        lastRefreshStatus: 'COMPLETE',
        lastRefreshAt: summary.observedAt,
        lastErrorCode: null,
        lastSummary: summary,
      }
      updateOtaRoomTypeCatalog({
        hotelId,
        source: updated,
        roomTypes: observedRoomTypes,
        observedAt: summary.observedAt,
      })
      const nextSources = [...activeSources]
      nextSources[activeSourceIndex] = updated
      const pairedSources = pairOtaReviewAndOrderSources(nextSources)
      otaSourcesByHotel.set(hotelId, pairedSources)
      persistOtaSources()
      return decorateOtaSources(hotelId, [
        pairedSources.find((candidate) => candidate.sourceId === sourceId)
          ?? updated,
      ])[0]
    } catch (error) {
      const errorCode = safeOtaRefreshErrorCode(error)
      const activeSources = otaSourcesByHotel.get(hotelId) ?? []
      const activeSourceIndex = activeSources.findIndex(
        (candidate) => candidate.sourceId === sourceId,
      )
      const activeSource = activeSources[activeSourceIndex]
      const sourceUnchanged = Boolean(
        activeSource
        && activeSource.rowVersion === source.rowVersion
        && activeSource.platformCode === source.platformCode,
      )
      if (!sourceUnchanged) {
        process.stderr.write(
          `${JSON.stringify({
            event: 'OTA_SOURCE_REFRESH_DISCARDED',
            hotelId,
            sourceId,
            errorCode,
          })}\n`,
        )
        throw new Error('OTA_SOURCE_CHANGED_DURING_REFRESH')
      }
      const updated = {
        ...activeSource,
        lastRefreshStatus: 'FAILED',
        lastRefreshAt: new Date().toISOString(),
        lastErrorCode: errorCode,
        lastSummary: null,
      }
      const nextSources = [...activeSources]
      nextSources[activeSourceIndex] = updated
      const pairedSources = pairOtaReviewAndOrderSources(nextSources)
      otaSourcesByHotel.set(hotelId, pairedSources)
      persistOtaSources()
      process.stderr.write(
        `${JSON.stringify({
          event: 'OTA_SOURCE_REFRESH_FAILED',
          hotelId,
          sourceId,
          errorCode,
        })}\n`,
      )
      throw new Error(errorCode)
    }
  })()
  otaSourceRefreshLocks.set(lockKey, operation)
  try {
    return await operation
  } finally {
    otaSourceRefreshLocks.delete(lockKey)
  }
}

const refreshOtaPlatformSourcesFor = async (hotelId, platformCode) => {
  const sourceIds = (otaSourcesByHotel.get(hotelId) ?? [])
    .filter((source) => source.enabled && source.platformCode === platformCode)
    .filter((source) => Boolean(
      source.dataEndpointUrl || builtInFliggyEndpointUrl(source),
    ))
    .map((source) => source.sourceId)
  const results = []
  for (const sourceId of sourceIds) {
    try {
      results.push(await refreshOtaSourceFor(hotelId, sourceId))
    } catch {
      const current = (otaSourcesByHotel.get(hotelId) ?? [])
        .find((source) => source.sourceId === sourceId)
      if (current) results.push(decorateOtaSources(hotelId, [current])[0])
    }
  }
  return results
}

const refreshEnabledOtaSourcesFor = async (
  hotelId,
  { dueOnly = false, now = new Date() } = {},
) => {
  const validStayedOrderCountThroughPreviousBusinessDate =
    (liveSnapshotStore[hotelId] ?? []).at(-1)
      ?.validStayedOrderSummary?.validStayedOrderCount ?? null
  const enabled = (otaSourcesByHotel.get(hotelId) ?? [])
    .filter((source) =>
      source.enabled
      && typeof source.dataEndpointUrl === 'string'
      && Boolean(
        source.dataEndpointUrl.trim()
        || builtInFliggyEndpointUrl(source),
      )
      && (!dueOnly || otaSourcePollingDue(source, now, {
        validStayedOrderCountThroughPreviousBusinessDate,
      })))
  const results = []
  for (const source of enabled) {
    try {
      results.push(await refreshOtaSourceFor(hotelId, source.sourceId))
    } catch {
      const current = (otaSourcesByHotel.get(hotelId) ?? [])
        .find((candidate) => candidate.sourceId === source.sourceId)
      if (current) {
        results.push(decorateOtaSources(hotelId, [current])[0])
      }
    }
  }
  return results
}

const collectLuopanLiveFor = async (
  hotelId,
  config,
  { otaRefreshDueOnly = false } = {},
) => {
  const hotel = selectedHotel(hotelId)
  try {
    const result = await collectLuopanControlledBrowser({
      hotel,
      profileRef: config.profileRef,
      expectedHotelFingerprint: config.expectedHotelFingerprint,
      previousSnapshots: liveSnapshotStore[hotelId] ?? [],
      secretKey: cookieSecretKey,
      sessionState: luopanSessionStatesByHotel.get(hotelId) ?? null,
      target: null,
      hotSellingRoomTypeCodes:
        hotSellingRoomTypesFor(hotelId).roomTypeCodes,
      collectValidStayedOrders: hasEnabledMeituanReviewSource(hotelId),
    })
    appendAndPersistSnapshot(
      liveSnapshotStore,
      liveSnapshotPath,
      result.snapshot,
    )
    const updatedAt = new Date().toISOString()
    luopanBrowserConfigsByHotel.set(hotelId, {
      ...config,
      lastBusinessDate: result.snapshot.businessDate,
      lastCollectionStatus: result.snapshot.completeness,
      lastCollectionAt: result.snapshot.observedAt,
      lastErrorCode: null,
      rowVersion: config.rowVersion + 1,
    })
    persistLuopanBrowserConfigs()
    businessDayControlsByHotel.set(hotelId, {
      businessDate: result.snapshot.businessDate,
      mode: 'PMS_CONFIRMED',
      source: 'LUOPAN_CLOUD',
      businessDateStartedAt: null,
      updatedAt,
    })
    persistBusinessDayControls()
    const otaRefreshes = await refreshEnabledOtaSourcesFor(
      hotelId,
      { dueOnly: otaRefreshDueOnly },
    )
    return {
      ...result,
      otaRefreshes,
    }
  } catch (error) {
    const errorCode =
      typeof error?.message === 'string'
      && error.message.startsWith('LUOPAN_')
        ? error.message
        : 'LUOPAN_COLLECTION_FAILED'
    luopanBrowserConfigsByHotel.set(hotelId, {
      ...config,
      lastCollectionStatus: 'FAILED',
      lastCollectionAt: new Date().toISOString(),
      lastErrorCode: errorCode,
      rowVersion: config.rowVersion + 1,
    })
    persistLuopanBrowserConfigs()
    if (
      errorCode === 'LUOPAN_REAUTH_REQUIRED'
      && !isNightlyRepairDeferred()
    ) {
      void startLuopanRepairChallenge(
        hotelId,
        'SCHEDULED_COLLECTION_FAILURE',
      )
    }
    throw new Error(errorCode)
  }
}

const collectLiveFor = async (
  hotelId,
  { otaRefreshDueOnly = false } = {},
) => {
  if (activeLuopanRepairsByHotel.has(hotelId)) {
    throw new Error('LUOPAN_REAUTH_IN_PROGRESS')
  }
  if (activeBieyanghongRepairsByHotel.has(hotelId)) {
    throw new Error('BIEYANGHONG_REAUTH_IN_PROGRESS')
  }
  const running = liveCollectionLocks.get(hotelId)
  if (running) return running

  const operation = (async () => {
    const hotel = selectedHotel(hotelId)
    if (trustedDeviceLegacyCollectionBlocked(hotel)) {
      throw new Error('TRUSTED_DEVICE_COLLECTION_REQUIRED')
    }
    const luopanConfig = luopanBrowserConfigRecordFor(hotelId)
    if (hotel.pmsSystemCode === 'LUOPAN_CLOUD' && luopanConfig.enabled) {
      return collectLuopanLiveFor(
        hotelId,
        luopanConfig,
        { otaRefreshDueOnly },
      )
    }
    const businessDayControl = businessDayControlFor(hotelId)
    if (!reportSourcesByHotel.has(hotelId)) {
      synchronizeReportSourcesFromPrimary()
    }
    const sources = reportSourcesByHotel.get(hotelId)
    const encryptedSecrets = secretsForHotel(hotelId)
    const cookiesBySourceId = {}
    for (const source of sources) {
      const record = encryptedSecrets[source.sourceId]
      if (!record) continue
      cookiesBySourceId[source.sourceId] = decryptCookie(
        record,
        cookieSecretKey,
        cookieScope(hotelId, source.sourceId),
      )
    }
    const enabledSources = sources.filter((source) => source.enabled)
    if (enabledSources.length === 0) {
      throw new Error('REPORT_SOURCE_ENABLED_REQUIRED')
    }
    if (
      !enabledSources.some((source) =>
        typeof cookiesBySourceId[source.sourceId] === 'string')
    ) {
      throw new Error('REPORT_SOURCE_COOKIE_REQUIRED')
    }
    const result = await collectLiveReports({
      hotel,
      sources,
      cookiesBySourceId,
      previousSnapshots: liveSnapshotStore[hotelId] ?? [],
      secretKey: trustedDeviceEligible(hotel)
        ? trustedDevicePseudonymKeyFor(hotel)
        : cookieSecretKey,
      legacySecretKey: trustedDeviceEligible(hotel)
        ? cookieSecretKey
        : null,
      target: null,
      hotSellingRoomTypeCodes:
        hotSellingRoomTypesFor(hotelId).roomTypeCodes,
      reportDate: businessDayControl.businessDate,
    })
    if (trustedDeviceEligible(hotel)) {
      migrateTrustedPseudonymAliases(hotel, result.snapshot)
      result.monitor = monitorFromSnapshot(
        result.snapshot,
        hotel,
        null,
        hotSellingRoomTypesFor(hotelId).roomTypeCodes,
      )
    }
    if (trustedDeviceLegacyCollectionBlocked(hotel)) {
      throw new Error('TRUSTED_DEVICE_COLLECTION_REQUIRED')
    }
    if (
      businessDayControl.businessDate !== result.snapshot.businessDate
      || businessDayControl.mode !== 'PMS_CONFIRMED'
      || businessDayControl.businessDateStartedAt
        !== result.snapshot.businessDateStartedAt
    ) {
      const previousBusinessDate = businessDayControl.businessDate
      businessDayControlsByHotel.set(hotelId, {
        businessDate: result.snapshot.businessDate,
        mode: 'PMS_CONFIRMED',
        source: 'PMS_NIGHT_AUDIT_API',
        businessDateStartedAt: result.snapshot.businessDateStartedAt,
        updatedAt: new Date().toISOString(),
      })
      persistBusinessDayControls()
      process.stdout.write(
        `${JSON.stringify({
          event: 'PMS_BUSINESS_DAY_CONFIRMED',
          hotelId,
          previousBusinessDate,
          businessDate: result.snapshot.businessDate,
        })}\n`,
      )
    }
    appendAndPersistSnapshot(
      liveSnapshotStore,
      liveSnapshotPath,
      result.snapshot,
    )
    const otaRefreshes = await refreshEnabledOtaSourcesFor(
      hotelId,
      { dueOnly: otaRefreshDueOnly },
    )
    return {
      ...result,
      otaRefreshes,
    }
  })().catch((error) => {
    const hotel = selectedHotel(hotelId)
    if (
      error?.message === 'PMS_SESSION_REAUTH_REQUIRED'
      && hotel.hotelCode === BIEYANGHONG_REPAIR_PILOT_HOTEL_CODE
      && hotel.pmsSystemCode === 'MEITUAN_BIEYANGHONG'
      && !isNightlyRepairDeferred()
    ) {
      void startBieyanghongRepairChallenge(
        hotelId,
        'SCHEDULED_COLLECTION_FAILURE',
      ).catch(() => {})
    }
    throw error
  })
  liveCollectionLocks.set(hotelId, operation)
  try {
    return await operation
  } finally {
    liveCollectionLocks.delete(hotelId)
  }
}

const scheduledCollectionTick = async () => {
  if (!automaticHourlyCollectionEnabled) return
  const slot = collectionSlotFor()
  if (!slot) return
  for (const hotel of hotels.filter((item) => item.collectionEnabled)) {
    if (trustedDeviceCutoverReady(hotel)) {
      continue
    }
    const luopanConfig = luopanBrowserConfigRecordFor(hotel.hotelId)
    if (
      Object.keys(secretsForHotel(hotel.hotelId)).length === 0
      && !luopanConfig.enabled
    ) {
      continue
    }
    if (
      lastScheduledCollectionSlotByHotel.get(hotel.hotelId) === slot.slotKey
    ) {
      continue
    }
    const latest = (liveSnapshotStore[hotel.hotelId] ?? []).at(-1)
    if (
      latest?.observedAt?.startsWith(slot.slotKey)
    ) {
      lastScheduledCollectionSlotByHotel.set(hotel.hotelId, slot.slotKey)
      continue
    }
    lastScheduledCollectionSlotByHotel.set(hotel.hotelId, slot.slotKey)
    try {
      const result = await collectLiveFor(
        hotel.hotelId,
        { otaRefreshDueOnly: true },
      )
      try {
        await deliverFutureDemandRisks(hotel.hotelId, result.snapshot)
      } catch (error) {
        process.stderr.write(
          `${JSON.stringify({
            event: 'FUTURE_DEMAND_P1_EVALUATION_FAILED',
            hotelId: hotel.hotelId,
            collectionRunId: result.snapshot.collectionRunId,
            reasonCode:
              error?.message ?? 'FUTURE_DEMAND_P1_EVALUATION_FAILED',
          })}\n`,
        )
      }
      process.stdout.write(
        `${JSON.stringify({
          event: 'SCHEDULED_COLLECTION_COMPLETED',
          hotelId: hotel.hotelId,
          collectionSlot: slot.slotKey,
        })}\n`,
      )
    } catch {
      process.stderr.write(
        `${JSON.stringify({
          event: 'SCHEDULED_COLLECTION_FAILED',
          hotelId: hotel.hotelId,
          collectionSlot: slot.slotKey,
        })}\n`,
      )
    }
  }
}

const scheduledOtaSourceTick = async () => {
  if (!automaticHourlyCollectionEnabled) return
  const now = new Date()
  if (!otaSourceSchedulerReady(schedulerStartedAt, now)) return
  for (const hotel of hotels) {
    const validStayedOrderCountThroughPreviousBusinessDate =
      (liveSnapshotStore[hotel.hotelId] ?? []).at(-1)
        ?.validStayedOrderSummary?.validStayedOrderCount ?? null
    const dueSources = (otaSourcesByHotel.get(hotel.hotelId) ?? [])
      .filter((source) => otaSourcePollingDue(source, now, {
        validStayedOrderCountThroughPreviousBusinessDate,
      }))
    if (dueSources.length === 0) continue
    const results = await refreshEnabledOtaSourcesFor(
      hotel.hotelId,
      { dueOnly: true, now },
    )
    process.stdout.write(
      `${JSON.stringify({
        event: 'SCHEDULED_OTA_SOURCE_POLL_COMPLETED',
        hotelId: hotel.hotelId,
        dueSourceCount: dueSources.length,
        completedSourceCount: results.filter(
          (source) => source.lastRefreshStatus === 'COMPLETE',
        ).length,
      })}\n`,
    )
  }
}

const deliverWeComSnapshot = async ({
  hotelId,
  snapshot,
  messageKey,
  messagePrefix,
  payloadFactory = null,
  deliveryType = 'TODAY_REVENUE',
  allowDisabled = false,
}) => {
  const existing = weComDeliveriesByKey.get(messageKey)
  if (existing) return existing
  const running = weComDeliveryLocks.get(messageKey)
  if (running) return running

  const operation = (async () => {
    const config = weComConfigFor(hotelId)
    const encryptedSecret = weComSecretsByHotel.get(hotelId)
    if (
      (!config.enabled && !allowDisabled)
      || !encryptedSecret
      || !config.endpointSha256
    ) {
      throw new Error('WECOM_DELIVERY_NOT_CONFIGURED')
    }
    const webhook = decryptCookie(
      encryptedSecret,
      cookieSecretKey,
      weComSecretScope(hotelId),
    )
    const hotel = selectedHotel(hotelId)
    const payloads =
      typeof payloadFactory === 'function'
        ? await payloadFactory({ hotel, snapshot, messagePrefix })
        : createReportMonitorWeComPayloads(
            monitorFromSnapshot(
              snapshot,
              hotel,
              null,
              hotSellingRoomTypesFor(hotelId).roomTypeCodes,
            ),
            {
              messagePrefix,
              snapshot,
              briefId: snapshot.collectionRunId,
              orderDataRedacted: trustedDeviceEligible(hotel),
            },
          )
    const messageSha256 = sha256(
      payloads.map((payload) => payload.text.content).join('\n---\n'),
    )
    const attemptedAt = new Date().toISOString()
    const delivery = {
      deliveryId: randomUUID(),
      messageKey,
      deliveryType,
      hotelId,
      businessDate: snapshot.businessDate,
      cutoffAt: snapshot.observedAt,
      attemptedAt,
      completedAt: null,
      deliveryStatus: 'SENDING',
      reasonCode: 'WECOM_BUNDLE_SENDING',
      endpointSha256: config.endpointSha256,
      messageSha256,
      httpStatus: null,
      weComCode: null,
      automaticRetryAttempted: false,
      partCount: payloads.length,
      deliveredPartCount: 0,
      parts: [],
      bodyPreview:
        payloads.map((payload) => payload.text.content).join('\n\n——\n\n'),
    }
    weComDeliveriesByKey.set(messageKey, delivery)
    persistWeComDeliveries()
    for (let index = 0; index < payloads.length; index += 1) {
      let result
      try {
        result = await sendWeComGroupRobotMessage({
          rawWebhook: webhook,
          payload: payloads[index],
          expectedEndpointSha256: config.endpointSha256,
          fetchImpl: globalThis.fetch,
          networkAuthorized: true,
        })
      } catch (error) {
        result = {
          deliveryStatus: 'REJECTED',
          reasonCode:
            typeof error?.reasonCode === 'string'
              ? error.reasonCode
              : 'WECOM_SEND_FAILED_CLOSED',
          endpointSha256: config.endpointSha256,
          httpStatus: null,
          weComCode: null,
        }
      }
      delivery.parts.push({
        partNo: index + 1,
        messageSha256: sha256(payloads[index].text.content),
        deliveryStatus: result.deliveryStatus,
        reasonCode: result.reasonCode,
        httpStatus: result.httpStatus,
        weComCode: result.weComCode,
      })
      if (result.deliveryStatus === 'DELIVERED') {
        delivery.deliveredPartCount += 1
      }
      delivery.httpStatus = result.httpStatus
      delivery.weComCode = result.weComCode
      delivery.reasonCode = result.reasonCode
      persistWeComDeliveries()
      if (result.deliveryStatus !== 'DELIVERED') break
    }
    const hasAmbiguous = delivery.parts.some(
      (part) => part.deliveryStatus === 'AMBIGUOUS',
    )
    const allDelivered =
      delivery.parts.length === payloads.length
      && delivery.parts.every(
        (part) => part.deliveryStatus === 'DELIVERED',
      )
    delivery.deliveryStatus =
      allDelivered ? 'DELIVERED' : hasAmbiguous ? 'AMBIGUOUS' : 'REJECTED'
    delivery.reasonCode =
      allDelivered
        ? 'WECOM_BUNDLE_DELIVERED'
        : hasAmbiguous
          ? 'WECOM_BUNDLE_RESULT_UNKNOWN'
          : 'WECOM_BUNDLE_REJECTED'
    delivery.completedAt = new Date().toISOString()
    persistWeComDeliveries()
    process.stdout.write(
      `${JSON.stringify({
        event: 'WECOM_DELIVERY_COMPLETED',
        hotelId,
        messageKey,
        deliveryStatus: delivery.deliveryStatus,
        reasonCode: delivery.reasonCode,
      })}\n`,
    )
    return delivery
  })()
  weComDeliveryLocks.set(messageKey, operation)
  try {
    return await operation
  } finally {
    weComDeliveryLocks.delete(messageKey)
  }
}

const deliverWeComAuditNotice = async ({
  hotelId,
  messageKey,
  deliveryType,
  content,
  bodyPreview,
}) => {
  const existing = weComDeliveriesByKey.get(messageKey)
  if (existing) return existing
  const running = weComDeliveryLocks.get(messageKey)
  if (running) return running
  const operation = (async () => {
    const config = weComConfigFor(hotelId)
    const encryptedSecret = weComSecretsByHotel.get(hotelId)
    if (
      !config.enabled
      || !encryptedSecret
      || !config.endpointSha256
    ) {
      throw new Error('WECOM_DELIVERY_NOT_CONFIGURED')
    }
    const webhook = decryptCookie(
      encryptedSecret,
      cookieSecretKey,
      weComSecretScope(hotelId),
    )
    const attemptedAt = new Date().toISOString()
    const delivery = {
      deliveryId: randomUUID(),
      messageKey,
      deliveryType,
      hotelId,
      businessDate: null,
      cutoffAt: attemptedAt,
      attemptedAt,
      completedAt: null,
      deliveryStatus: 'SENDING',
      reasonCode: 'WECOM_AUDIT_NOTICE_SENDING',
      endpointSha256: config.endpointSha256,
      messageSha256: sha256(content),
      httpStatus: null,
      weComCode: null,
      automaticRetryAttempted: false,
      partCount: 1,
      deliveredPartCount: 0,
      parts: [],
      bodyPreview,
      deliveryChannel: 'WECOM_GROUP_WEBHOOK',
    }
    weComDeliveriesByKey.set(messageKey, delivery)
    persistWeComDeliveries()
    let result
    try {
      result = await sendWeComGroupRobotMessage({
        rawWebhook: webhook,
        payload: {
          msgtype: 'text',
          text: {
            content,
            mentioned_list: [],
          },
        },
        expectedEndpointSha256: config.endpointSha256,
        fetchImpl: globalThis.fetch,
        networkAuthorized: true,
      })
    } catch (error) {
      result = {
        deliveryStatus: 'REJECTED',
        reasonCode:
          typeof error?.reasonCode === 'string'
            ? error.reasonCode
            : 'WECOM_SEND_FAILED_CLOSED',
        endpointSha256: config.endpointSha256,
        httpStatus: null,
        weComCode: null,
      }
    }
    delivery.parts.push({
      partNo: 1,
      messageSha256: sha256(content),
      deliveryStatus: result.deliveryStatus,
      reasonCode: result.reasonCode,
      httpStatus: result.httpStatus,
      weComCode: result.weComCode,
    })
    delivery.deliveredPartCount =
      result.deliveryStatus === 'DELIVERED' ? 1 : 0
    delivery.deliveryStatus = result.deliveryStatus
    delivery.reasonCode = result.reasonCode
    delivery.httpStatus = result.httpStatus
    delivery.weComCode = result.weComCode
    delivery.completedAt = new Date().toISOString()
    persistWeComDeliveries()
    process.stdout.write(
      `${JSON.stringify({
        event: 'WECOM_AUDIT_NOTICE_COMPLETED',
        hotelId,
        deliveryType,
        deliveryStatus: delivery.deliveryStatus,
        reasonCode: delivery.reasonCode,
      })}\n`,
    )
    return delivery
  })()
  weComDeliveryLocks.set(messageKey, operation)
  try {
    return await operation
  } finally {
    weComDeliveryLocks.delete(messageKey)
  }
}

const deliverWeComRepairBotDirectMessage = async ({
  hotelId,
  messageKey,
  deliveryType,
  content,
  captcha = null,
}) => {
  const existing = weComDeliveriesByKey.get(messageKey)
  if (existing) return existing
  const running = weComDeliveryLocks.get(messageKey)
  if (running) return running
  const operation = (async () => {
    if (!weComRepairBotReady()) {
      throw new Error('WECOM_REPAIR_BOT_NOT_CONNECTED')
    }
    const allowedUserIds = weComRepairBotRecipientsForHotel(
      weComRepairBotCredentials ?? {},
      hotelId,
    )
    if (allowedUserIds.length === 0) {
      throw new Error('WECOM_REPAIR_BOT_PAIRING_REQUIRED')
    }
    const attemptedAt = new Date().toISOString()
    const delivery = {
      deliveryId: randomUUID(),
      messageKey,
      deliveryType,
      hotelId,
      businessDate: null,
      cutoffAt: attemptedAt,
      attemptedAt,
      completedAt: null,
      deliveryStatus: 'SENDING',
      reasonCode: 'WECOM_REPAIR_BOT_MESSAGE_SENDING',
      endpointSha256: weComRepairBotConfig.botIdSha256,
      messageSha256: sha256(content),
      httpStatus: null,
      weComCode: null,
      automaticRetryAttempted: false,
      partCount: allowedUserIds.length,
      deliveredPartCount: 0,
      parts: [],
      bodyPreview: '企业微信智能机器人私聊通知（内容已隐藏）',
      deliveryChannel: 'WECOM_LONG_CONNECTION',
    }
    weComDeliveriesByKey.set(messageKey, delivery)
    persistWeComDeliveries()
    const results = await deliverWeComRepairBotToAllowedUsers({
      credentials: weComRepairBotCredentials,
      hotelId,
      deliver: (userId) => captcha
        ? weComRepairBotRuntime.sendCaptcha({ userId, captcha, content })
        : weComRepairBotRuntime.sendText(userId, content),
    })
    for (const [partIndex, result] of results.entries()) {
      if (result.status === 'fulfilled') {
        const weComCode = Number.isInteger(result.value?.errcode)
          ? result.value.errcode
          : null
        delivery.deliveredPartCount += 1
        delivery.parts.push({
          partIndex,
          deliveryStatus: 'DELIVERED',
          reasonCode: 'WECOM_REPAIR_BOT_MESSAGE_DELIVERED',
          httpStatus: null,
          weComCode,
        })
      } else {
        delivery.parts.push({
          partIndex,
          deliveryStatus: 'REJECTED',
          reasonCode: safeLuopanRepairReason(result.reason),
          httpStatus: null,
          weComCode: null,
        })
      }
    }
    delivery.deliveryStatus =
      delivery.deliveredPartCount === delivery.partCount
        ? 'DELIVERED'
        : delivery.deliveredPartCount > 0
          ? 'PARTIAL'
          : 'REJECTED'
    delivery.reasonCode =
      delivery.deliveryStatus === 'DELIVERED'
        ? 'WECOM_REPAIR_BOT_MESSAGE_DELIVERED'
        : delivery.deliveryStatus === 'PARTIAL'
          ? 'WECOM_REPAIR_BOT_MESSAGE_PARTIAL'
          : 'WECOM_REPAIR_BOT_MESSAGE_REJECTED'
    delivery.completedAt = new Date().toISOString()
    persistWeComDeliveries()
    process.stdout.write(
      `${JSON.stringify({
        event: 'WECOM_REPAIR_BOT_DELIVERY_COMPLETED',
        hotelId,
        deliveryType,
        deliveryStatus: delivery.deliveryStatus,
        reasonCode: delivery.reasonCode,
      })}\n`,
    )
    return delivery
  })()
  weComDeliveryLocks.set(messageKey, operation)
  try {
    return await operation
  } finally {
    weComDeliveryLocks.delete(messageKey)
  }
}

const safeLuopanRepairReason = (error) => {
  const candidate = String(error?.message ?? '')
  return /^[A-Z][A-Z0-9_]{2,80}$/u.test(candidate)
    ? candidate
    : 'LUOPAN_REPAIR_FAILED'
}

const finishLuopanRepair = async ({
  hotelId,
  tokenSha256,
  sessionState,
}) => {
  const handle = activeLuopanRepairsByHotel.get(hotelId)
  if (!handle || handle.tokenSha256 !== tokenSha256) {
    throw new Error('LUOPAN_REPAIR_CHALLENGE_NOT_FOUND')
  }
  luopanRepairChallengeStore.markVerifying(tokenSha256)
  await handle.login?.close().catch(() => {})
  activeLuopanRepairsByHotel.delete(hotelId)
  try {
    const config = luopanBrowserConfigRecordFor(hotelId)
    const normalizedSession = sessionState
      ? normalizeLuopanSessionState(sessionState)
      : null
    const validation = await validateLuopanBrowserSession({
      profileRef: config.profileRef,
      expectedHotelFingerprint: config.expectedHotelFingerprint,
      sessionState: normalizedSession,
    })
    if (validation.scopeStatus !== 'SINGLE_HOTEL_CONFIRMED') {
      throw new Error('LUOPAN_STORE_SCOPE_INVALID')
    }
    if (normalizedSession) {
      luopanSessionStatesByHotel.set(hotelId, normalizedSession)
    } else {
      luopanSessionStatesByHotel.delete(hotelId)
    }
    persistLuopanSessionStates()
    luopanBrowserConfigsByHotel.set(hotelId, {
      ...config,
      enabled: true,
      expectedHotelFingerprint: validation.hotelFingerprint,
      scopeStatus: validation.scopeStatus,
      lastValidatedAt: validation.validatedAt,
      lastBusinessDate: validation.businessDate,
      lastErrorCode: null,
      rowVersion: config.rowVersion + 1,
    })
    persistLuopanBrowserConfigs()
    const collection = await collectLiveFor(hotelId)
    const today = await deliverWeComSnapshot({
      hotelId,
      snapshot: collection.snapshot,
      messageKey:
        `${hotelId}:RECOVERY:${collection.snapshot.collectionRunId}:TODAY`,
      messagePrefix: '会话修复后补发简报',
      deliveryType: 'TODAY_REVENUE',
    })
    const future = await deliverWeComSnapshot({
      hotelId,
      snapshot: collection.snapshot,
      messageKey:
        `${hotelId}:RECOVERY:${collection.snapshot.collectionRunId}:FUTURE_14D_V1`,
      messagePrefix: '会话修复后补发远期房态',
      deliveryType: 'FUTURE_14D',
      payloadFactory: ({ hotel: selected, snapshot: current }) =>
        futureBookingPayloads({
          hotel: selected,
          snapshot: current,
          messagePrefix: '会话修复后补发远期房态',
        }),
    })
    if (
      today.deliveryStatus !== 'DELIVERED'
      || future.deliveryStatus !== 'DELIVERED'
    ) {
      throw new Error('LUOPAN_REPAIR_DELIVERY_NOT_CONFIRMED')
    }
    luopanRepairChallengeStore.complete(tokenSha256)
    updateLatestPendingBriefingHealthAudit(hotelId, {
      resolutionStatus: 'RESOLVED',
      resolvedAt: new Date().toISOString(),
      reasonCode: 'LUOPAN_REPAIR_VERIFIED',
    })
    const hotel = selectedHotel(hotelId)
    await deliverWeComAuditNotice({
      hotelId,
      messageKey:
        `${hotelId}:LUOPAN_REPAIR_COMPLETE:${collection.snapshot.collectionRunId}`,
      deliveryType: 'LUOPAN_REPAIR_COMPLETE',
      content: [
        '【罗盘简报自动修复完成】',
        `门店：${hotel.hotelCode} · ${hotel.hotelName}`,
        '结果：重新登录、采集和两类简报补发均已完成。',
        '送达：已取得企业微信 DELIVERED 记录。',
      ].join('\n'),
      bodyPreview:
        `罗盘简报自动修复完成 · ${hotel.hotelCode} · ${hotel.hotelName}`,
    })
    if (handle.channel === 'WECOM_LONG_CONNECTION') {
      await deliverWeComRepairBotDirectMessage({
        hotelId,
        messageKey:
          `${hotelId}:LUOPAN_REPAIR_BOT_COMPLETE:${collection.snapshot.collectionRunId}`,
        deliveryType: 'LUOPAN_REPAIR_BOT_COMPLETE',
        content: [
          '### 罗盘简报修复完成',
          `门店：${hotel.hotelCode} · ${hotel.hotelName}`,
          '重新登录、采集及两类简报补发均已完成。',
        ].join('\n'),
      }).catch(() => {})
    }
  } catch (error) {
    const reasonCode = safeLuopanRepairReason(error)
    luopanRepairChallengeStore.fail(tokenSha256, reasonCode)
    updateLatestPendingBriefingHealthAudit(hotelId, {
      resolutionStatus: 'FAILED',
      reasonCode,
    })
    const hotel = selectedHotel(hotelId)
    await deliverWeComAuditNotice({
      hotelId,
      messageKey:
        `${hotelId}:LUOPAN_REPAIR_FAILED:${tokenSha256.slice(0, 16)}`,
      deliveryType: 'LUOPAN_REPAIR_FAILED',
      content: [
        '【罗盘简报自动修复未完成】',
        `门店：${hotel.hotelCode} · ${hotel.hotelName}`,
        `状态码：${reasonCode}`,
        '系统已停止本次尝试，不会继续提交验证码。',
        `修复后台（需登录）：${storeRepairConsoleUrlFor(hotel)}`,
      ].join('\n'),
      bodyPreview:
        `罗盘简报自动修复未完成 · ${hotel.hotelCode} · ${reasonCode}`,
    }).catch(() => {})
    if (handle.channel === 'WECOM_LONG_CONNECTION') {
      await deliverWeComRepairBotDirectMessage({
        hotelId,
        messageKey:
          `${hotelId}:LUOPAN_REPAIR_BOT_FAILED:${tokenSha256.slice(0, 16)}`,
        deliveryType: 'LUOPAN_REPAIR_BOT_FAILED',
        content: [
          '### 罗盘简报修复未完成',
          `门店：${hotel.hotelCode} · ${hotel.hotelName}`,
          `状态码：${reasonCode}`,
          '系统已停止本次尝试，不会继续提交验证码。',
        ].join('\n'),
      }).catch(() => {})
    }
  }
}

const startLuopanRepairChallenge = async (
  hotelId,
  trigger = 'SCHEDULED_AUDIT',
) => {
  if (!luopanAssistedRepairReady()) return null
  const active = activeLuopanRepairsByHotel.get(hotelId)
  if (active) {
    return luopanRepairChallengeStore.getInternalByHash(active.tokenSha256)
  }
  const hotel = selectedHotel(hotelId)
  const config = luopanBrowserConfigRecordFor(hotelId)
  const weComConfig = weComConfigFor(hotelId)
  const repairChannel = weComRepairBotReady()
    ? 'WECOM_LONG_CONNECTION'
    : luopanWebRepairReady
      ? 'WECOM_SECURE_LINK'
      : null
  if (
    !repairChannel
    ||
    hotel.pmsSystemCode !== 'LUOPAN_CLOUD'
    || !config.enabled
    || !weComConfig.enabled
    || !weComConfig.webhookConfigured
  ) {
    return null
  }
  const created = luopanRepairChallengeStore.create({
    hotelId,
    hotelCode: hotel.hotelCode,
    hotelName: hotel.hotelName,
  })
  const handle = {
    hotelId,
    tokenSha256: created.tokenSha256,
    challengeId: created.record.challengeId,
    channel: repairChannel,
    login: null,
  }
  activeLuopanRepairsByHotel.set(hotelId, handle)
  try {
    const credentials = pmsLoginCredentialsFor(hotelId)
    handle.login = await startLuopanAssistedLogin({
      profileRef: config.profileRef,
      credentials,
    })
    if (handle.login.alreadyAuthenticated) {
      void finishLuopanRepair({
        hotelId,
        tokenSha256: created.tokenSha256,
        sessionState: handle.login.sessionState,
      })
      return created.record
    }
    luopanRepairChallengeStore.setWaiting(
      created.tokenSha256,
      handle.login.captcha,
    )
    const repairMessageKey =
      `${hotelId}:LUOPAN_REPAIR_REQUIRED:${created.record.challengeId}`
    const deliveryTasks = []
    if (repairChannel === 'WECOM_LONG_CONNECTION') {
      deliveryTasks.push(deliverWeComRepairBotDirectMessage({
        hotelId,
        messageKey: repairMessageKey,
        deliveryType: 'LUOPAN_REPAIR_REQUIRED',
        captcha: handle.login.captcha,
        content: [
          '### 罗盘简报需要人工验证码',
          `门店：${hotel.hotelCode} · ${hotel.hotelName}`,
          '请查看上方验证码图片，并直接回复：',
          `**${hotel.hotelCode} 验证码**`,
          '有效期10分钟，最多提交3次。',
        ].join('\n'),
      }))
    }
    deliveryTasks.push(deliverWeComAuditNotice({
      hotelId,
      messageKey: repairChannel === 'WECOM_LONG_CONNECTION'
        ? `${repairMessageKey}:WECOM_GROUP_WEBHOOK`
        : repairMessageKey,
      deliveryType: 'LUOPAN_REPAIR_REQUIRED',
      content: repairChannel === 'WECOM_LONG_CONNECTION'
        ? [
          '【罗盘简报需要人工验证】',
          `门店：${hotel.hotelCode} · ${hotel.hotelName}`,
          '原因：罗盘登录会话已失效，自动简报已暂停。',
          '处理：验证码已私聊本店修复管理员；其他授权人员可登录后台按指引处理。',
          `修复后台（需登录）：${storeRepairConsoleUrlFor(hotel)}`,
        ].join('\n')
        : [
          '【罗盘简报需要人工验证码】',
          `门店：${hotel.hotelCode} · ${hotel.hotelName}`,
          '原因：罗盘登录会话已失效，自动简报已暂停。',
          '处理：点击一次性链接填写验证码，或登录后台查看修复指引。',
          '有效期：10分钟，最多提交3次。',
          luopanRepairLink(luopanRepairPublicBaseUrl, created.token),
          `修复后台（需登录）：${storeRepairConsoleUrlFor(hotel)}`,
        ].join('\n'),
      bodyPreview:
        `罗盘简报需要人工验证码 · ${hotel.hotelCode} · 安全链接已隐藏`,
    }))
    const deliveryOutcomes = await Promise.allSettled(deliveryTasks)
    const deliveredPartCount = deliveryOutcomes.reduce(
      (total, outcome) => total + (
        outcome.status === 'fulfilled'
          ? outcome.value.deliveredPartCount
          : 0
      ),
      0,
    )
    if (deliveredPartCount < 1) {
      throw new Error('LUOPAN_REPAIR_NOTICE_NOT_DELIVERED')
    }
    process.stdout.write(
      `${JSON.stringify({
        event: 'LUOPAN_REPAIR_CHALLENGE_STARTED',
        hotelId,
        trigger,
        channel: repairChannel,
        expiresAt: created.record.expiresAt,
      })}\n`,
    )
    return created.record
  } catch (error) {
    const reasonCode = safeLuopanRepairReason(error)
    await handle.login?.close().catch(() => {})
    activeLuopanRepairsByHotel.delete(hotelId)
    luopanRepairChallengeStore.fail(created.tokenSha256, reasonCode)
    process.stderr.write(
      `${JSON.stringify({
        event: 'LUOPAN_REPAIR_CHALLENGE_FAILED',
        hotelId,
        trigger,
        reasonCode,
      })}\n`,
    )
    return null
  }
}

// A collection failure already starts this repair flow. This extra recovery
// pass closes the gap where the process restarts (or a prior scheduler run is
// interrupted) after the session has been marked as needing re-authentication.
// It is intentionally limited to a single pending repair per hotel and a
// thirty-minute retry window, so a failed browser start cannot flood the
// assigned WeCom managers with captcha messages.
const scheduledLuopanRecoveryTick = async () => {
  if (
    !automaticHourlyCollectionEnabled
    || !luopanAssistedRepairReady()
    || scheduledLuopanRecoveryRunning
    || isNightlyRepairDeferred()
  ) return
  scheduledLuopanRecoveryRunning = true
  try {
    const now = Date.now()
    for (const hotel of hotels.filter(
      (item) => item.pmsSystemCode === 'LUOPAN_CLOUD',
    )) {
      const config = luopanBrowserConfigRecordFor(hotel.hotelId)
      if (
        !config.enabled
        || config.lastErrorCode !== 'LUOPAN_REAUTH_REQUIRED'
      ) continue
      const lastAttemptAt =
        lastScheduledLuopanRecoveryAtByHotel.get(hotel.hotelId) ?? 0
      if (now - lastAttemptAt < LUOPAN_AUTO_RECOVERY_RETRY_MS) continue
      lastScheduledLuopanRecoveryAtByHotel.set(hotel.hotelId, now)
      try {
        const challenge = await startLuopanRepairChallenge(
          hotel.hotelId,
          'SCHEDULED_STALE_SESSION_RECOVERY',
        )
        process.stdout.write(
          `${JSON.stringify({
            event: 'LUOPAN_STALE_SESSION_RECOVERY_ATTEMPTED',
            hotelId: hotel.hotelId,
            challengeStarted: Boolean(challenge),
          })}\n`,
        )
      } catch (error) {
        process.stderr.write(
          `${JSON.stringify({
            event: 'LUOPAN_STALE_SESSION_RECOVERY_FAILED',
            hotelId: hotel.hotelId,
            reasonCode: safeLuopanRepairReason(error),
          })}\n`,
        )
      }
    }
  } finally {
    scheduledLuopanRecoveryRunning = false
  }
}

const processSubmittedLuopanRepair = (submitted) => {
  const challenge = luopanRepairChallengeStore.getInternalByHash(
    submitted.tokenSha256,
  )
  const handle = activeLuopanRepairsByHotel.get(challenge.hotelId)
  if (!handle || handle.tokenSha256 !== submitted.tokenSha256) {
    luopanRepairChallengeStore.fail(
      submitted.tokenSha256,
      'LUOPAN_REPAIR_SESSION_UNAVAILABLE',
    )
    throw new Error('LUOPAN_REPAIR_SESSION_UNAVAILABLE')
  }
  luopanRepairChallengeStore.markVerifying(submitted.tokenSha256)
  process.stdout.write(
    `${JSON.stringify({
      event: 'LUOPAN_REPAIR_CAPTCHA_SUBMITTED',
      hotelId: challenge.hotelId,
      challengeId: challenge.challengeId,
    })}\n`,
  )
  void (async () => {
    let answer = submitted.answer
    try {
      let timeoutId = null
      const result = await Promise.race([
        handle.login.submit(answer),
        new Promise((_, reject) => {
          timeoutId = setTimeout(
            () => reject(new Error('LUOPAN_REPAIR_SUBMISSION_TIMEOUT')),
            LUOPAN_REPAIR_SUBMISSION_TIMEOUT_MS,
          )
          timeoutId.unref?.()
        }),
      ]).finally(() => {
        if (timeoutId) clearTimeout(timeoutId)
      })
      answer = null
      if (!result.authenticated) {
        if (
          result.captcha
          && challenge.attemptsUsed < challenge.maxAttempts
        ) {
          luopanRepairChallengeStore.setWaiting(
            submitted.tokenSha256,
            result.captcha,
            result.reasonCode,
          )
          if (handle.channel === 'WECOM_LONG_CONNECTION') {
            const hotel = selectedHotel(challenge.hotelId)
            const retryDelivery = await deliverWeComRepairBotDirectMessage({
              hotelId: challenge.hotelId,
              messageKey:
                `${challenge.hotelId}:LUOPAN_REPAIR_CAPTCHA_RETRY:${challenge.challengeId}:${challenge.attemptsUsed}`,
              deliveryType: 'LUOPAN_REPAIR_CAPTCHA_RETRY',
              captcha: result.captcha,
              content: [
                '### 验证码未通过，请重新填写',
                `门店：${hotel.hotelCode} · ${hotel.hotelName}`,
                `请回复：**${hotel.hotelCode} 新验证码**`,
                `剩余次数：${Math.max(0, challenge.maxAttempts - challenge.attemptsUsed)}`,
              ].join('\n'),
            })
            if (retryDelivery.deliveredPartCount < 1) {
              throw new Error('LUOPAN_REPAIR_NOTICE_NOT_DELIVERED')
            }
          }
          return
        }
        throw new Error(
          result.reasonCode === 'CAPTCHA_REJECTED'
            ? 'LUOPAN_REPAIR_ATTEMPTS_EXHAUSTED'
            : result.reasonCode,
        )
      }
      await finishLuopanRepair({
        hotelId: challenge.hotelId,
        tokenSha256: submitted.tokenSha256,
        sessionState: result.sessionState,
      })
    } catch (error) {
      answer = null
      const reasonCode = safeLuopanRepairReason(error)
      await handle.login?.close().catch(() => {})
      activeLuopanRepairsByHotel.delete(challenge.hotelId)
      luopanRepairChallengeStore.fail(submitted.tokenSha256, reasonCode)
      process.stderr.write(
        `${JSON.stringify({
          event: 'LUOPAN_REPAIR_SUBMISSION_FAILED',
          hotelId: challenge.hotelId,
          challengeId: challenge.challengeId,
          reasonCode,
        })}\n`,
      )
      if (handle.channel === 'WECOM_LONG_CONNECTION') {
        const hotel = selectedHotel(challenge.hotelId)
        await deliverWeComRepairBotDirectMessage({
          hotelId: challenge.hotelId,
          messageKey:
            `${challenge.hotelId}:LUOPAN_REPAIR_BOT_SUBMISSION_FAILED:${challenge.challengeId}:${challenge.attemptsUsed}`,
          deliveryType: 'LUOPAN_REPAIR_BOT_FAILED',
          content: [
            '### 罗盘简报修复未完成',
            `门店：${hotel.hotelCode} · ${hotel.hotelName}`,
            `状态码：${reasonCode}`,
            '系统已停止本次尝试，稍后会重新发送新的验证码。',
          ].join('\n'),
        }).catch(() => {})
      }
    }
  })()
  return submitted.record
}

const processLuopanRepairSubmission = ({ token, captcha }) =>
  processSubmittedLuopanRepair(
    luopanRepairChallengeStore.submit(token, captcha),
  )

const processLuopanRepairSubmissionByHash = ({ tokenSha256, captcha }) =>
  processSubmittedLuopanRepair(
    luopanRepairChallengeStore.submitByHash(tokenSha256, captcha),
  )

const safeBieyanghongRepairReason = (error) => {
  const candidate = String(error?.message ?? '')
  return /^[A-Z][A-Z0-9_]{2,80}$/u.test(candidate)
    ? candidate
    : 'BIEYANGHONG_REPAIR_FAILED'
}

const pmsCookieValue = (cookieHeader, name) => {
  const values = []
  for (const part of String(cookieHeader ?? '').split(';')) {
    const [candidate, ...value] = part.trim().split('=')
    if (candidate === name) values.push(value.join('=').trim())
  }
  if (values.length === 0) return null
  if (
    values.some((value) => !/^(?:0|[1-9][0-9]{0,63})$/u.test(value))
    || new Set(values).size !== 1
  ) throw new Error('BIEYANGHONG_STORE_SCOPE_INVALID')
  return values[0]
}

const expectedBieyanghongHotelScope = (hotelId) => {
  const sources = reportSourcesByHotel.get(hotelId) ?? []
  const encryptedSecrets = secretsForHotel(hotelId)
  const expectedHotelIds = new Set()
  for (const source of sources) {
    const record = encryptedSecrets[source.sourceId]
    if (!record) continue
    const existingCookie = decryptCookie(
      record,
      cookieSecretKey,
      cookieScope(hotelId, source.sourceId),
    )
    const expectedHotelId = pmsCookieValue(
      existingCookie,
      'hotelpms_login_hotel_id',
    )
    if (expectedHotelId) expectedHotelIds.add(expectedHotelId)
  }
  if (expectedHotelIds.size !== 1) {
    throw new Error('BIEYANGHONG_EXPECTED_STORE_SCOPE_UNAVAILABLE')
  }
  return [...expectedHotelIds][0]
}

const replaceBieyanghongReportCookies = (hotelId, cookieHeader) => {
  const hotel = selectedHotel(hotelId)
  if (
    hotel.hotelCode !== BIEYANGHONG_REPAIR_PILOT_HOTEL_CODE
    || hotel.pmsSystemCode !== 'MEITUAN_BIEYANGHONG'
  ) {
    throw new Error('BIEYANGHONG_REPAIR_PILOT_SCOPE_INVALID')
  }
  const expectedHotelId = expectedBieyanghongHotelScope(hotelId)
  const authenticatedHotelId = pmsCookieValue(
    cookieHeader,
    'hotelpms_login_hotel_id',
  )
  if (!authenticatedHotelId || authenticatedHotelId !== expectedHotelId) {
    throw new Error('BIEYANGHONG_STORE_SCOPE_INVALID')
  }
  const sources = reportSourcesByHotel.get(hotelId) ?? []
  const previous = { ...secretsForHotel(hotelId) }
  const next = { ...previous }
  let replaced = 0
  for (const source of sources) {
    let endpoint
    try {
      endpoint = new URL(source.endpointUrl)
    } catch {
      continue
    }
    if (endpoint.hostname !== 'pms.meituan.com') continue
    next[source.sourceId] = encryptCookie(
      cookieHeader,
      cookieSecretKey,
      cookieScope(hotelId, source.sourceId),
    )
    replaced += 1
  }
  if (replaced < 1) {
    throw new Error('BIEYANGHONG_REPORT_SOURCE_NOT_CONFIGURED')
  }
  cookieSecretsByHotel.set(hotelId, next)
  persistCookieSecrets()
  return { previous, replaced }
}

const finishBieyanghongRepair = async ({
  hotelId,
  tokenSha256,
  cookieHeader: inputCookieHeader,
}) => {
  const handle = activeBieyanghongRepairsByHotel.get(hotelId)
  if (!handle || handle.tokenSha256 !== tokenSha256) {
    throw new Error('BIEYANGHONG_REPAIR_CHALLENGE_NOT_FOUND')
  }
  bieyanghongRepairChallengeStore.markVerifying(tokenSha256)
  revokeBieyanghongVncSession(handle)
  await handle.login?.close().catch(() => {})
  activeBieyanghongRepairsByHotel.delete(hotelId)
  let cookieHeader = inputCookieHeader
  let previousSecrets = null
  let collectionSucceeded = false
  try {
    const replacement = replaceBieyanghongReportCookies(hotelId, cookieHeader)
    previousSecrets = replacement.previous
    cookieHeader = null
    const collection = await collectLiveFor(hotelId)
    collectionSucceeded = true
    const today = await deliverWeComSnapshot({
      hotelId,
      snapshot: collection.snapshot,
      messageKey:
        `${hotelId}:BIEYANGHONG_RECOVERY:${collection.snapshot.collectionRunId}:TODAY`,
      messagePrefix: '别样红会话修复后补发简报',
      deliveryType: 'TODAY_REVENUE',
    })
    const future = await deliverWeComSnapshot({
      hotelId,
      snapshot: collection.snapshot,
      messageKey:
        `${hotelId}:BIEYANGHONG_RECOVERY:${collection.snapshot.collectionRunId}:FUTURE_14D_V1`,
      messagePrefix: '别样红会话修复后补发远期房态',
      deliveryType: 'FUTURE_14D',
      payloadFactory: ({ hotel: selected, snapshot: current }) =>
        futureBookingPayloads({
          hotel: selected,
          snapshot: current,
          messagePrefix: '别样红会话修复后补发远期房态',
        }),
    })
    if (
      today.deliveryStatus !== 'DELIVERED'
      || future.deliveryStatus !== 'DELIVERED'
    ) {
      throw new Error('BIEYANGHONG_REPAIR_DELIVERY_NOT_CONFIRMED')
    }
    bieyanghongRepairChallengeStore.complete(tokenSha256)
    updateLatestPendingBriefingHealthAudit(hotelId, {
      resolutionStatus: 'RESOLVED',
      resolvedAt: new Date().toISOString(),
      reasonCode: 'BIEYANGHONG_REPAIR_VERIFIED',
    })
    const hotel = selectedHotel(hotelId)
    await deliverWeComRepairBotDirectMessage({
      hotelId,
      messageKey:
        `${hotelId}:BIEYANGHONG_REPAIR_COMPLETE:${collection.snapshot.collectionRunId}`,
      deliveryType: 'BIEYANGHONG_REPAIR_COMPLETE',
      content: [
        '### 别样红简报授权修复完成',
        `门店：${hotel.hotelCode} · ${hotel.hotelName}`,
        '短信授权、会话刷新、数据采集及两类简报补发均已完成。',
      ].join('\n'),
    }).catch(() => {})
  } catch (error) {
    cookieHeader = null
    if (previousSecrets && !collectionSucceeded) {
      cookieSecretsByHotel.set(hotelId, previousSecrets)
      persistCookieSecrets()
    }
    const reasonCode = safeBieyanghongRepairReason(error)
    bieyanghongRepairChallengeStore.fail(tokenSha256, reasonCode)
    updateLatestPendingBriefingHealthAudit(hotelId, {
      resolutionStatus: 'FAILED',
      reasonCode,
    })
    const hotel = selectedHotel(hotelId)
    await deliverWeComRepairBotDirectMessage({
      hotelId,
      messageKey:
        `${hotelId}:BIEYANGHONG_REPAIR_FAILED:${tokenSha256.slice(0, 16)}`,
      deliveryType: 'BIEYANGHONG_REPAIR_FAILED',
      content: [
        '### 别样红简报授权修复未完成',
        `门店：${hotel.hotelCode} · ${hotel.hotelName}`,
        `状态码：${reasonCode}`,
        '系统已停止本次尝试，未向其他门店写入任何会话。',
      ].join('\n'),
    }).catch(() => {})
  }
}

const startBieyanghongRepairChallenge = async (
  hotelId,
  trigger = 'MANUAL_PILOT',
  replaceActive = false,
  {
    notifyManager = true,
    challengeTtlMs,
    includeWorkspaceUrl = false,
  } = {},
) => {
  if (trustedDeviceEnabled) {
    throw new Error('BIEYANGHONG_TRUSTED_DEVICE_MODE')
  }
  if (includeWorkspaceUrl && notifyManager) {
    throw new Error('BIEYANGHONG_WORKSPACE_MODE_INVALID')
  }
  if (!bieyanghongAssistedRepairReady()) return null
  const active = activeBieyanghongRepairsByHotel.get(hotelId)
  if (active) {
    if (!replaceActive) {
      return bieyanghongRepairChallengeStore
        .getByHash(active.tokenSha256)
    }
    revokeBieyanghongVncSession(active)
    await active.login?.close().catch(() => {})
    bieyanghongRepairChallengeStore.fail(
      active.tokenSha256,
      'BIEYANGHONG_REPAIR_CHALLENGE_REPLACED',
    )
    activeBieyanghongRepairsByHotel.delete(hotelId)
    process.stdout.write(
      `${JSON.stringify({
        event: 'BIEYANGHONG_REPAIR_CHALLENGE_REPLACED',
        hotelId,
        previousChallengeId: active.challengeId,
        trigger,
      })}\n`,
    )
  }
  const hotel = selectedHotel(hotelId)
  if (
    hotel.hotelCode !== BIEYANGHONG_REPAIR_PILOT_HOTEL_CODE
    || hotel.pmsSystemCode !== 'MEITUAN_BIEYANGHONG'
  ) return null

  const created = bieyanghongRepairChallengeStore.create({
    hotelId,
    hotelCode: hotel.hotelCode,
    hotelName: hotel.hotelName,
    challengeTtlMs,
  })
  const handle = {
    hotelId,
    tokenSha256: created.tokenSha256,
    challengeId: created.record.challengeId,
    login: null,
    vncSessionSha256: null,
    vncSessionExpiresAt: 0,
    vncViewerConnected: false,
    vncConnectionsUsed: 0,
    vncSocket: null,
    visualOperation: null,
    visualFrameLastAt: 0,
    finishing: false,
  }
  activeBieyanghongRepairsByHotel.set(hotelId, handle)
  try {
    bieyanghongRepairChallengeStore.setWaitingForCredentials(
      created.tokenSha256,
    )
    if (notifyManager) {
      const delivery = await deliverWeComRepairBotDirectMessage({
        hotelId,
        messageKey:
          `${hotelId}:BIEYANGHONG_REPAIR_REQUIRED:${created.record.challengeId}`,
        deliveryType: 'BIEYANGHONG_REPAIR_REQUIRED',
        content: [
          '### 001别样红简报需要管理员授权',
          `门店：${hotel.hotelCode} · ${hotel.hotelName}`,
          '请由本次处理管理员点击一次性链接，直接在美团官方页面完成登录：',
          bieyanghongRepairLink(
            bieyanghongRepairPublicBaseUrl,
            created.token,
          ),
          '有效期10分钟，官方窗口最多启动2次；请勿转发或由多人同时操作。',
        ].join('\n'),
      })
      if (delivery.deliveredPartCount < 1) {
        throw new Error('BIEYANGHONG_REPAIR_NOTICE_NOT_DELIVERED')
      }
    }
    process.stdout.write(
      `${JSON.stringify({
        event: 'BIEYANGHONG_REPAIR_CHALLENGE_STARTED',
        hotelId,
        trigger,
        expiresAt: created.record.expiresAt,
      })}\n`,
    )
    return {
      ...created.record,
      ...(includeWorkspaceUrl
        ? {
            workspaceUrl: bieyanghongRepairLink(
              bieyanghongRepairPublicBaseUrl,
              created.token,
            ),
          }
        : {}),
    }
  } catch (error) {
    const reasonCode = safeBieyanghongRepairReason(error)
    revokeBieyanghongVncSession(handle)
    await handle.login?.close().catch(() => {})
    activeBieyanghongRepairsByHotel.delete(hotelId)
    bieyanghongRepairChallengeStore.fail(created.tokenSha256, reasonCode)
    process.stderr.write(
      `${JSON.stringify({
        event: 'BIEYANGHONG_REPAIR_CHALLENGE_FAILED',
        hotelId,
        trigger,
        reasonCode,
      })}\n`,
    )
    throw new Error(reasonCode)
  }
}

const processBieyanghongRepairCodeRequest = ({
  token,
  phone: inputPhone,
}) => {
  let phone = inputPhone
  const requested = bieyanghongRepairChallengeStore.requestCode(token, {
    phone,
  })
  phone = null
  const challenge = bieyanghongRepairChallengeStore.getInternalByHash(
    requested.tokenSha256,
  )
  const handle = activeBieyanghongRepairsByHotel.get(challenge.hotelId)
  if (!handle || handle.tokenSha256 !== requested.tokenSha256) {
    requested.credentials.phone = ''
    bieyanghongRepairChallengeStore.fail(
      requested.tokenSha256,
      'BIEYANGHONG_REPAIR_SESSION_UNAVAILABLE',
    )
    throw new Error('BIEYANGHONG_REPAIR_SESSION_UNAVAILABLE')
  }
  process.stdout.write(
    `${JSON.stringify({
      event: 'BIEYANGHONG_REPAIR_CODE_REQUEST_STARTED',
      hotelId: challenge.hotelId,
      challengeId: challenge.challengeId,
      credentialRequest: challenge.credentialRequestsUsed,
    })}\n`,
  )
  void (async () => {
    let credentials = requested.credentials
    try {
      handle.login = await startBieyanghongAssistedLogin({
        profileRoot: join(
          bieyanghongBrowserProfileBase,
          `hotel-${challenge.hotelCode}`,
        ),
        phone: credentials.phone,
      })
      credentials.phone = ''
      credentials = null
      if (handle.login.alreadyAuthenticated) {
        await finishBieyanghongRepair({
          hotelId: challenge.hotelId,
          tokenSha256: requested.tokenSha256,
          cookieHeader: handle.login.cookieHeader,
        })
        return
      }
      if (handle.login.interactiveVerificationRequired) {
        bieyanghongRepairChallengeStore
          .setWaitingForInteractiveVerification(
            requested.tokenSha256,
            handle.login.interactiveReasonCode,
          )
        process.stdout.write(
          `${JSON.stringify({
            event: 'BIEYANGHONG_INTERACTIVE_VERIFICATION_REQUIRED',
            hotelId: challenge.hotelId,
            challengeId: challenge.challengeId,
            reasonCode: handle.login.interactiveReasonCode,
          })}\n`,
        )
        return
      }
      bieyanghongRepairChallengeStore.setWaitingForCode(
        requested.tokenSha256,
      )
      process.stdout.write(
        `${JSON.stringify({
          event: 'BIEYANGHONG_REPAIR_CODE_REQUESTED',
          hotelId: challenge.hotelId,
          challengeId: challenge.challengeId,
        })}\n`,
      )
    } catch (error) {
      if (credentials) {
        credentials.phone = ''
        credentials = null
      }
      await handle.login?.close().catch(() => {})
      handle.login = null
      const reasonCode = safeBieyanghongRepairReason(error)
      process.stderr.write(
        `${JSON.stringify({
          event: 'BIEYANGHONG_REPAIR_CODE_REQUEST_FAILED',
          hotelId: challenge.hotelId,
          challengeId: challenge.challengeId,
          credentialRequest: challenge.credentialRequestsUsed,
          reasonCode,
        })}\n`,
      )
      const current = bieyanghongRepairChallengeStore.getInternalByHash(
        requested.tokenSha256,
      )
      if (
        reasonCode === 'BIEYANGHONG_LOGIN_ACCOUNT_REJECTED'
        && current
        && current.credentialRequestsUsed < current.maxCredentialRequests
      ) {
        bieyanghongRepairChallengeStore.setWaitingForCredentials(
          requested.tokenSha256,
          reasonCode,
        )
        return
      }
      activeBieyanghongRepairsByHotel.delete(challenge.hotelId)
      bieyanghongRepairChallengeStore.fail(
        requested.tokenSha256,
        reasonCode,
      )
      const hotel = selectedHotel(challenge.hotelId)
      await deliverWeComRepairBotDirectMessage({
        hotelId: challenge.hotelId,
        messageKey:
          `${challenge.hotelId}:BIEYANGHONG_REPAIR_CODE_REQUEST_FAILED:${challenge.challengeId}:${challenge.credentialRequestsUsed}`,
        deliveryType: 'BIEYANGHONG_REPAIR_FAILED',
        content: [
          '### 别样红管理员授权未完成',
          `门店：${hotel.hotelCode} · ${hotel.hotelName}`,
          `状态码：${reasonCode}`,
          '系统已停止本次尝试，请等待新的授权链接。',
        ].join('\n'),
      }).catch(() => {})
    }
  })()
  return requested.record
}

const processBieyanghongOfficialLoginStart = ({ token }) => {
  const started = bieyanghongRepairChallengeStore.startOfficialLogin(token)
  const challenge = bieyanghongRepairChallengeStore.getInternalByHash(
    started.tokenSha256,
  )
  const handle = activeBieyanghongRepairsByHotel.get(challenge.hotelId)
  if (!handle || handle.tokenSha256 !== started.tokenSha256) {
    bieyanghongRepairChallengeStore.fail(
      started.tokenSha256,
      'BIEYANGHONG_REPAIR_SESSION_UNAVAILABLE',
    )
    throw new Error('BIEYANGHONG_REPAIR_SESSION_UNAVAILABLE')
  }
  process.stdout.write(
    `${JSON.stringify({
      event: 'BIEYANGHONG_OFFICIAL_LOGIN_WINDOW_STARTED',
      hotelId: challenge.hotelId,
      challengeId: challenge.challengeId,
      windowAttempt: challenge.credentialRequestsUsed,
    })}\n`,
  )
  void (async () => {
    try {
      revokeBieyanghongVncSession(handle)
      await handle.login?.close().catch(() => {})
      handle.login = bieyanghongRemoteDesktopConfig.enabled
        ? await startBieyanghongBrokeredLogin()
        : await startBieyanghongAssistedLogin({
            profileRoot: join(
              bieyanghongBrowserProfileBase,
              `hotel-${challenge.hotelCode}`,
            ),
            officialLogin: true,
            remoteDesktopConfig: bieyanghongRemoteDesktopConfig,
          })
      if (handle.login.alreadyAuthenticated) {
        await finishBieyanghongRepair({
          hotelId: challenge.hotelId,
          tokenSha256: started.tokenSha256,
          cookieHeader: handle.login.cookieHeader,
        })
        return
      }
      bieyanghongRepairChallengeStore.setWaitingForInteractiveVerification(
        started.tokenSha256,
        'BIEYANGHONG_OFFICIAL_LOGIN_REQUIRED',
      )
      process.stdout.write(
        `${JSON.stringify({
          event: 'BIEYANGHONG_OFFICIAL_LOGIN_WINDOW_READY',
          hotelId: challenge.hotelId,
          challengeId: challenge.challengeId,
        })}\n`,
      )
    } catch (error) {
      revokeBieyanghongVncSession(handle)
      await handle.login?.close().catch(() => {})
      handle.login = null
      const reasonCode = safeBieyanghongRepairReason(error)
      const current = bieyanghongRepairChallengeStore.getInternalByHash(
        started.tokenSha256,
      )
      process.stderr.write(
        `${JSON.stringify({
          event: 'BIEYANGHONG_OFFICIAL_LOGIN_WINDOW_FAILED',
          hotelId: challenge.hotelId,
          challengeId: challenge.challengeId,
          reasonCode,
        })}\n`,
      )
      if (
        current
        && current.credentialRequestsUsed < current.maxCredentialRequests
      ) {
        bieyanghongRepairChallengeStore.setWaitingForCredentials(
          started.tokenSha256,
          reasonCode,
        )
        return
      }
      activeBieyanghongRepairsByHotel.delete(challenge.hotelId)
      bieyanghongRepairChallengeStore.fail(started.tokenSha256, reasonCode)
    }
  })()
  return started.record
}

const bieyanghongInteractiveHandleFor = (token) => {
  const challenge = bieyanghongRepairChallengeStore.getInternal(token)
  if (!challenge) {
    throw new Error('BIEYANGHONG_REPAIR_CHALLENGE_NOT_FOUND')
  }
  if (challenge.status !== 'WAITING_FOR_INTERACTIVE_VERIFICATION') {
    throw new Error('BIEYANGHONG_INTERACTIVE_VERIFICATION_NOT_READY')
  }
  const handle = activeBieyanghongRepairsByHotel.get(challenge.hotelId)
  if (
    !handle
    || handle.tokenSha256 !== challenge.tokenSha256
    || !handle.login?.captureVisualState
    || !handle.login?.interactVisually
  ) {
    throw new Error('BIEYANGHONG_REPAIR_SESSION_UNAVAILABLE')
  }
  return { challenge, handle }
}

const queueBieyanghongVisualOperation = (handle, operation) => {
  const previous = handle.visualOperation ?? Promise.resolve()
  const current = previous.catch(() => {}).then(operation)
  handle.visualOperation = current
  return current.finally(() => {
    if (handle.visualOperation === current) handle.visualOperation = null
  })
}

const bieyanghongVncCookieValue = (request) => {
  const header = String(request.headers.cookie ?? '')
  if (!header || header.length > 4_096) return ''
  for (const segment of header.split(';')) {
    const separator = segment.indexOf('=')
    if (separator < 1) continue
    if (segment.slice(0, separator).trim() !== BIEYANGHONG_VNC_COOKIE) continue
    const value = segment.slice(separator + 1).trim()
    return /^[A-Za-z0-9_-]{40,96}$/u.test(value) ? value : ''
  }
  return ''
}

const bieyanghongVncHashMatches = (left, right) => {
  if (
    typeof left !== 'string'
    || typeof right !== 'string'
    || !/^[a-f0-9]{64}$/u.test(left)
    || !/^[a-f0-9]{64}$/u.test(right)
  ) return false
  return timingSafeEqual(Buffer.from(left, 'hex'), Buffer.from(right, 'hex'))
}

const revokeBieyanghongVncSession = (handle) => {
  if (!handle) return
  handle.vncSessionSha256 = null
  handle.vncSessionExpiresAt = 0
  handle.vncViewerConnected = false
  handle.vncConnectionsUsed = 0
  handle.vncSocket?.destroy()
  handle.vncSocket = null
}

const releaseBieyanghongVncViewer = (handle, socket) => {
  if (!handle || handle.vncSocket !== socket) return
  handle.vncViewerConnected = false
  handle.vncSocket = null
}

const bieyanghongRemoteDesktopHandleFor = (token) => {
  const challenge = bieyanghongRepairChallengeStore.getInternal(token)
  if (!challenge) {
    throw new Error('BIEYANGHONG_REPAIR_CHALLENGE_NOT_FOUND')
  }
  if (challenge.status !== 'WAITING_FOR_INTERACTIVE_VERIFICATION') {
    throw new Error('BIEYANGHONG_INTERACTIVE_VERIFICATION_NOT_READY')
  }
  const handle = activeBieyanghongRepairsByHotel.get(challenge.hotelId)
  if (
    !handle
    || handle.tokenSha256 !== challenge.tokenSha256
    || !handle.login?.remoteDesktop?.webSocketPort
    || !handle.login?.detectAuthentication
  ) {
    throw new Error('BIEYANGHONG_REMOTE_DESKTOP_SESSION_UNAVAILABLE')
  }
  return { challenge, handle }
}

const createBieyanghongVncSession = (token) => {
  const { challenge, handle } = bieyanghongRemoteDesktopHandleFor(token)
  const now = Date.now()
  const challengeExpiresAt = new Date(challenge.expiresAt).getTime()
  const expiresAt = Math.min(
    challengeExpiresAt,
    now + BIEYANGHONG_VNC_SESSION_TTL_MS,
  )
  if (!Number.isFinite(expiresAt) || expiresAt <= now + 1_000) {
    throw new Error('BIEYANGHONG_REPAIR_CHALLENGE_EXPIRED')
  }
  revokeBieyanghongVncSession(handle)
  let sessionToken = randomBytes(32).toString('base64url')
  handle.vncSessionSha256 = createHash('sha256')
    .update(sessionToken)
    .digest('hex')
  handle.vncSessionExpiresAt = expiresAt
  handle.vncConnectionsUsed = 0
  return {
    sessionToken,
    maxAgeSeconds: Math.max(1, Math.floor((expiresAt - now) / 1_000)),
    clear() {
      sessionToken = null
    },
  }
}

const bieyanghongVncHandleForRequest = (request) => {
  const cookieValue = bieyanghongVncCookieValue(request)
  if (!cookieValue) {
    throw new Error('BIEYANGHONG_REMOTE_DESKTOP_SESSION_REQUIRED')
  }
  const suppliedHash = createHash('sha256').update(cookieValue).digest('hex')
  const now = Date.now()
  for (const handle of activeBieyanghongRepairsByHotel.values()) {
    if (
      !bieyanghongVncHashMatches(handle.vncSessionSha256, suppliedHash)
      || handle.vncSessionExpiresAt <= now
      || !handle.login?.remoteDesktop?.webSocketPort
    ) continue
    const challenge = bieyanghongRepairChallengeStore.getInternalByHash(
      handle.tokenSha256,
    )
    if (
      challenge
      && challenge.hotelId === handle.hotelId
      && challenge.status === 'WAITING_FOR_INTERACTIVE_VERIFICATION'
    ) return { challenge, handle }
  }
  throw new Error('BIEYANGHONG_REMOTE_DESKTOP_SESSION_REQUIRED')
}

const processBieyanghongRemoteAuthenticationCheck = async (request) => {
  const { challenge, handle } = bieyanghongVncHandleForRequest(request)
  const result = await queueBieyanghongVisualOperation(
    handle,
    () => handle.login.detectAuthentication(),
  )
  if (!result.authenticated) {
    return { authenticationDetected: false, status: challenge.status }
  }
  revokeBieyanghongVncSession(handle)
  beginBieyanghongInteractiveFinish({
    challenge,
    handle,
    cookieHeader: result.cookieHeader,
  })
  result.cookieHeader = null
  return { authenticationDetected: true, status: 'VERIFYING' }
}

const beginBieyanghongInteractiveFinish = ({ challenge, handle, cookieHeader }) => {
  if (handle.finishing) return
  handle.finishing = true
  let scopedCookieHeader = cookieHeader
  void finishBieyanghongRepair({
    hotelId: challenge.hotelId,
    tokenSha256: challenge.tokenSha256,
    cookieHeader: scopedCookieHeader,
  }).finally(() => {
    scopedCookieHeader = null
  })
}

const captureBieyanghongInteractiveFrame = async (token) => {
  const { challenge, handle } = bieyanghongInteractiveHandleFor(token)
  const now = Date.now()
  if (now - handle.visualFrameLastAt < 750) {
    throw new Error('BIEYANGHONG_VISUAL_FRAME_RATE_LIMITED')
  }
  handle.visualFrameLastAt = now
  const result = await queueBieyanghongVisualOperation(
    handle,
    () => handle.login.captureVisualState(),
  )
  if (result.authenticated) {
    beginBieyanghongInteractiveFinish({
      challenge,
      handle,
      cookieHeader: result.cookieHeader,
    })
    result.cookieHeader = null
    return { authenticated: true, image: null }
  }
  return { authenticated: false, image: result.image }
}

const processBieyanghongInteractiveAction = async ({ token, input }) => {
  const { challenge, handle } = bieyanghongInteractiveHandleFor(token)
  const result = await queueBieyanghongVisualOperation(
    handle,
    () => handle.login.interactVisually(input),
  )
  if (result.authenticated) {
    beginBieyanghongInteractiveFinish({
      challenge,
      handle,
      cookieHeader: result.cookieHeader,
    })
    result.cookieHeader = null
  }
  return {
    accepted: true,
    authenticationDetected: result.authenticated,
  }
}

const processBieyanghongRepairSubmission = ({ token, code }) => {
  const submitted = bieyanghongRepairChallengeStore.submit(token, code)
  const challenge = bieyanghongRepairChallengeStore.getInternalByHash(
    submitted.tokenSha256,
  )
  const handle = activeBieyanghongRepairsByHotel.get(challenge.hotelId)
  if (!handle || handle.tokenSha256 !== submitted.tokenSha256) {
    bieyanghongRepairChallengeStore.fail(
      submitted.tokenSha256,
      'BIEYANGHONG_REPAIR_SESSION_UNAVAILABLE',
    )
    throw new Error('BIEYANGHONG_REPAIR_SESSION_UNAVAILABLE')
  }
  bieyanghongRepairChallengeStore.markVerifying(submitted.tokenSha256)
  process.stdout.write(
    `${JSON.stringify({
      event: 'BIEYANGHONG_REPAIR_CODE_SUBMITTED',
      hotelId: challenge.hotelId,
      challengeId: challenge.challengeId,
    })}\n`,
  )
  void (async () => {
    let answer = submitted.answer
    try {
      let timeoutId = null
      const result = await Promise.race([
        handle.login.submit(answer),
        new Promise((_, reject) => {
          timeoutId = setTimeout(
            () => reject(new Error('BIEYANGHONG_REPAIR_SUBMISSION_TIMEOUT')),
            BIEYANGHONG_REPAIR_SUBMISSION_TIMEOUT_MS,
          )
          timeoutId.unref?.()
        }),
      ]).finally(() => {
        if (timeoutId) clearTimeout(timeoutId)
      })
      answer = null
      if (!result.authenticated) {
        if (
          result.reasonCode === 'BIEYANGHONG_SMS_CODE_REJECTED'
          && challenge.attemptsUsed < challenge.maxAttempts
        ) {
          bieyanghongRepairChallengeStore.setWaitingForCode(
            submitted.tokenSha256,
            result.reasonCode,
          )
          return
        }
        throw new Error(result.reasonCode)
      }
      await finishBieyanghongRepair({
        hotelId: challenge.hotelId,
        tokenSha256: submitted.tokenSha256,
        cookieHeader: result.cookieHeader,
      })
    } catch (error) {
      answer = null
      const reasonCode = safeBieyanghongRepairReason(error)
      await handle.login?.close().catch(() => {})
      activeBieyanghongRepairsByHotel.delete(challenge.hotelId)
      bieyanghongRepairChallengeStore.fail(
        submitted.tokenSha256,
        reasonCode,
      )
      const hotel = selectedHotel(challenge.hotelId)
      await deliverWeComRepairBotDirectMessage({
        hotelId: challenge.hotelId,
        messageKey:
          `${challenge.hotelId}:BIEYANGHONG_REPAIR_SUBMISSION_FAILED:${challenge.challengeId}:${challenge.attemptsUsed}`,
        deliveryType: 'BIEYANGHONG_REPAIR_FAILED',
        content: [
          '### 别样红短信授权未完成',
          `门店：${hotel.hotelCode} · ${hotel.hotelName}`,
          `状态码：${reasonCode}`,
          '系统已停止本次尝试，请等待新的授权链接。',
        ].join('\n'),
      }).catch(() => {})
    }
  })()
  return submitted.record
}

const handleWeComRepairBotText = async (frame, replyText) => {
  const body = frame?.body
  const userId = typeof body?.from?.userid === 'string'
    ? body.from.userid.trim()
    : ''
  if (body?.chattype !== 'single' || !userId) {
    await replyText(frame, '请在与机器人的单聊中完成门店修复接手。')
    return
  }

  const messageId = typeof body?.msgid === 'string' ? body.msgid : ''
  if (!messageId) {
    await replyText(frame, '消息格式无效，请重新发送。')
    return
  }
  const now = Date.now()
  for (const [messageHash, seenAt] of seenWeComRepairBotMessageHashes) {
    if (now - seenAt > 60 * 60 * 1000) {
      seenWeComRepairBotMessageHashes.delete(messageHash)
    }
  }
  const messageHash = fingerprintWeComRepairBotValue(messageId)
  if (seenWeComRepairBotMessageHashes.has(messageHash)) {
    await replyText(frame, '本条消息已接收，请勿重复提交。')
    return
  }
  seenWeComRepairBotMessageHashes.set(messageHash, now)
  while (seenWeComRepairBotMessageHashes.size > 1_000) {
    seenWeComRepairBotMessageHashes.delete(
      seenWeComRepairBotMessageHashes.keys().next().value,
    )
  }

  const command = parseWeComRepairBotText(body?.text?.content)
  if (command.type === 'PAIR') {
    try {
      if (!weComRepairBotCredentials) {
        throw new Error('WECOM_REPAIR_BOT_CREDENTIALS_REQUIRED')
      }
      const pairing = weComRepairBotPairingStore.submit({
        pairingCode: command.pairingCode,
        userId,
      })
      const existingAllowedUserIds = weComRepairBotCredentials.allowedUserIds
      let allowedUserIds = existingAllowedUserIds
      let hotelAllowedUserIds = {
        ...weComRepairBotCredentials.hotelAllowedUserIds,
      }
      let reply
      if (pairing.scope?.type === 'HOTEL') {
        const hotel = hotels.find((candidate) =>
          candidate.hotelId === pairing.scope.hotelId)
        if (!hotel) {
          throw new Error('WECOM_REPAIR_BOT_PAIRING_HOTEL_INVALID')
        }
        const existingHotelUserIds = hotelAllowedUserIds[hotel.hotelId] ?? []
        const hotelUserIds = existingHotelUserIds.includes(pairing.userId)
          ? existingHotelUserIds
          : [...existingHotelUserIds, pairing.userId]
        if (hotelUserIds.length > WECOM_REPAIR_BOT_MAX_STORE_USERS) {
          throw new Error('WECOM_REPAIR_BOT_PAIRING_LIMIT_REACHED')
        }
        hotelAllowedUserIds = {
          ...hotelAllowedUserIds,
          [hotel.hotelId]: hotelUserIds,
        }
        reply = `绑定成功。你已获授权处理 ${hotel.hotelCode} ${hotel.hotelName}；该门店当前已绑定${hotelUserIds.length}名管理人员。发送“状态”可查看该门店待处理修复任务。`
      } else {
        allowedUserIds = existingAllowedUserIds.includes(pairing.userId)
          ? existingAllowedUserIds
          : [...existingAllowedUserIds, pairing.userId]
        if (allowedUserIds.length > WECOM_REPAIR_BOT_MAX_ALLOWED_USERS) {
          throw new Error('WECOM_REPAIR_BOT_PAIRING_LIMIT_REACHED')
        }
        reply = `绑定成功。当前已保留${allowedUserIds.length}/2名全局接收人。发送“状态”可查看待处理修复任务。`
      }
      weComRepairBotCredentials = normalizeWeComRepairBotCredentials({
        ...weComRepairBotCredentials,
        allowedUserIds,
        hotelAllowedUserIds,
      })
      const allowedUserIdSha256s = weComRepairBotCredentials.allowedUserIds
        .map(fingerprintWeComRepairBotValue)
      weComRepairBotConfig = {
        ...weComRepairBotConfig,
        allowedUserIdSha256: allowedUserIdSha256s[0] ?? null,
        allowedUserIdSha256s,
        hotelAllowedUserIdSha256s:
          weComRepairBotHotelUserFingerprints(hotelAllowedUserIds),
        updatedAt: new Date().toISOString(),
      }
      persistWeComRepairBotSecret()
      persistWeComRepairBotConfig()
      await replyText(
        frame,
        reply,
      )
    } catch (error) {
      await replyText(
        frame,
        error?.message === 'WECOM_REPAIR_BOT_PAIRING_LIMIT_REACHED'
          ? '该门店绑定人员已达到安全上限。'
          : '配对码无效或已过期，请在后台重新生成。',
      )
    }
    return
  }

  const globalAllowedUserIds = weComRepairBotCredentials?.allowedUserIds ?? []
  const hotelAllowedUserIds =
    weComRepairBotCredentials?.hotelAllowedUserIds ?? {}
  const userHotelIds = Object.entries(hotelAllowedUserIds)
    .filter(([, userIds]) => userIds.includes(userId))
    .map(([hotelId]) => hotelId)
  if (!globalAllowedUserIds.includes(userId) && userHotelIds.length === 0) {
    await replyText(frame, '当前账号未获授权，请先使用后台配对码完成绑定。')
    return
  }

  if (command.type === 'HELP') {
    const authorizedForUser = (hotelId) =>
      globalAllowedUserIds.includes(userId)
      || userHotelIds.includes(hotelId)
    const activeCaptchaHotelIds = new Set(
      [...activeLuopanRepairsByHotel.values()]
        .filter((handle) => handle.channel === 'WECOM_LONG_CONNECTION')
        .map((handle) => handle.hotelId),
    )
    const visibleHotelIds = new Set([
      ...activeCaptchaHotelIds,
      ...briefingHealthAudits
        .filter((audit) =>
          ['PENDING', 'WAITING_CAPTCHA', 'REPAIRING', 'FAILED'].includes(
            audit.resolutionStatus,
          ))
        .filter((audit) => {
          const auditedAt = new Date(audit.auditedAt ?? '').getTime()
          return Number.isFinite(auditedAt)
            && Date.now() - auditedAt <= 48 * 60 * 60_000
        })
        .map((audit) => audit.hotelId),
    ])
    const pendingCodes = [...visibleHotelIds]
      .filter((hotelId) =>
        hotels.some((candidate) => candidate.hotelId === hotelId))
      .filter(authorizedForUser)
      .map((hotelId) => selectedHotel(hotelId).hotelCode)
      .sort()
    const captchaCodes = [...activeCaptchaHotelIds]
      .filter((hotelId) =>
        hotels.some((candidate) => candidate.hotelId === hotelId))
      .filter(authorizedForUser)
      .map((hotelId) => selectedHotel(hotelId).hotelCode)
      .sort()
    const statusLines = []
    if (pendingCodes.length > 0) {
      statusLines.push(`待处理门店：${pendingCodes.join('、')}。`)
    }
    if (captchaCodes.length > 0) {
      statusLines.push(
        `等待验证码：${captchaCodes.join('、')}。请发送“门店编号 验证码”。`,
      )
    } else if (pendingCodes.length > 0) {
      statusLines.push('系统将在晨间处理；无需提前提交验证码。')
    }
    await replyText(
      frame,
      statusLines.length > 0
        ? `已安全连接。${statusLines.join('')}`
        : '已安全连接，目前没有待处理的门店修复任务。',
    )
    return
  }

  if (command.type === 'CAPTCHA') {
    const hotel = hotels.find(
      (candidate) =>
        candidate.hotelCode === command.hotelCode
        && candidate.pmsSystemCode === 'LUOPAN_CLOUD',
    )
    const handle = hotel
      ? activeLuopanRepairsByHotel.get(hotel.hotelId)
      : null
    if (hotel && !weComRepairBotAuthorizedForHotel(userId, hotel.hotelId)) {
      await replyText(frame, '当前账号未获该门店授权。')
      return
    }
    if (!hotel || !handle || handle.channel !== 'WECOM_LONG_CONNECTION') {
      await replyText(frame, '该门店当前没有等待填写的验证码。')
      return
    }
    try {
      processLuopanRepairSubmissionByHash({
        tokenSha256: handle.tokenSha256,
        captcha: command.captcha,
      })
      await replyText(frame, '验证码已提交，系统正在验证并恢复简报。')
    } catch {
      await replyText(frame, '验证码未被接收，可能已过期或次数已用完。')
    }
    return
  }

  await replyText(
    frame,
    '可发送“状态”查看待处理门店；罗盘门店等待验证码时，可发送“门店编号 验证码”，例如：014 5dm8。',
  )
}

weComRepairBotRuntime = createWeComRepairBotRuntime({
  onTextMessage: handleWeComRepairBotText,
})
weComRepairBotRuntime.configure({
  enabled: weComRepairBotConfig.enabled,
  credentials: weComRepairBotCredentials,
})

const expireLuopanRepairSessions = async () => {
  luopanRepairChallengeStore.cleanupExpired()
  for (const [hotelId, handle] of activeLuopanRepairsByHotel) {
    const challenge = luopanRepairChallengeStore.getInternalByHash(
      handle.tokenSha256,
    )
    if (!challenge || challenge.status === 'EXPIRED') {
      await handle.login?.close().catch(() => {})
      activeLuopanRepairsByHotel.delete(hotelId)
    }
  }
  bieyanghongRepairChallengeStore.cleanupExpired()
  for (const [hotelId, handle] of activeBieyanghongRepairsByHotel) {
    const challenge = bieyanghongRepairChallengeStore.getInternalByHash(
      handle.tokenSha256,
    )
    if (!challenge || challenge.status === 'EXPIRED') {
      revokeBieyanghongVncSession(handle)
      await handle.login?.close().catch(() => {})
      activeBieyanghongRepairsByHotel.delete(hotelId)
    }
  }
}

const briefingHealthAuditFor = (hotel, date) => auditBriefingStore({
  hotel,
  luopanConfig: luopanBrowserConfigRecordFor(hotel.hotelId),
  weComConfig: weComConfigFor(hotel.hotelId),
  snapshots: liveSnapshotStore[hotel.hotelId] ?? [],
  deliveries: [...weComDeliveriesByKey.values()],
  date,
})

const recordNightlyBriefingHealthAudit = ({ hotel, slot, date }) => {
  const auditId = `${hotel.hotelId}:${slot.auditKey}`
  const existing = briefingHealthAudits.find(
    (candidate) => candidate.auditId === auditId,
  )
  if (existing) return existing
  const audit = briefingHealthAuditFor(hotel, date)
  const record = upsertBriefingHealthAudit({
    auditId,
    auditKey: slot.auditKey,
    dateKey: slot.dateKey,
    hotelId: hotel.hotelId,
    hotelCode: hotel.hotelCode,
    status: audit.status,
    snapshotObservedAt: audit.snapshotObservedAt ?? null,
    todayRevenueDelivered: audit.todayRevenueDelivered ?? false,
    future14dDelivered: audit.future14dDelivered ?? false,
    auditedAt: date.toISOString(),
    resolutionStatus:
      audit.status === 'HEALTHY' ? 'NOT_REQUIRED' : 'PENDING',
    repairKey: null,
    repairStartedAt: null,
    resolvedAt: null,
    reasonCode: null,
    updatedAt: date.toISOString(),
  })
  process.stdout.write(
    `${JSON.stringify({
      event: 'NIGHTLY_BRIEFING_HEALTH_AUDITED',
      hotelId: hotel.hotelId,
      auditKey: slot.auditKey,
      status: record.status,
      notificationSent: false,
    })}\n`,
  )
  return record
}

const repairNoticeChannelsFor = (hotel) => {
  const config = weComConfigFor(hotel.hotelId)
  const repairBotReady = weComRepairBotReady()
  const recipientCount = repairBotReady
    ? weComRepairBotRecipientsForHotel(
      weComRepairBotCredentials ?? {},
      hotel.hotelId,
    ).length
    : 0
  return selectWeComRepairNoticeChannels({
    repairBotReady,
    recipientCount,
    groupWebhookEnabled: config.enabled,
    groupWebhookConfigured: config.webhookConfigured,
  })
}

const deliverMorningRepairNotice = async ({
  hotel,
  auditRecord,
  deliveryType,
  content,
}) => {
  const messageKey =
    `${hotel.hotelId}:${deliveryType}:${auditRecord.auditKey}`
  const availableChannels = repairNoticeChannelsFor(hotel)
  const channels = shouldFanOutWeComRepairNotice(deliveryType)
    ? availableChannels
    : availableChannels.slice(0, 1)
  if (channels.length === 0) {
    throw new Error('MORNING_REPAIR_NOTICE_NOT_CONFIGURED')
  }
  const plan = planWeComRepairNoticeDeliveries({
    messageKey,
    channels,
    deliveryForKey: (key) => weComDeliveriesByKey.get(key),
  })
  const outcomes = await Promise.allSettled(plan.map((item) =>
    item.channel === 'WECOM_LONG_CONNECTION'
      ? deliverWeComRepairBotDirectMessage({
        hotelId: hotel.hotelId,
        messageKey: item.messageKey,
        deliveryType,
        content,
      })
      : deliverWeComAuditNotice({
        hotelId: hotel.hotelId,
        messageKey: item.messageKey,
        deliveryType,
        content,
        bodyPreview:
          `${deliveryType} · ${hotel.hotelCode} · ${auditRecord.status}`,
      })))
  if (outcomes.every((outcome) => outcome.status === 'rejected')) {
    throw new Error('MORNING_REPAIR_NOTICE_DELIVERY_FAILED')
  }
  return outcomes
}

const pmsRepairNoticeAvailableFor = (hotel) =>
  repairNoticeChannelsFor(hotel).length > 0

const scheduledPmsRepairAlertTick = async (now = new Date()) => {
  const attempts = hotels.map(async (hotel) => {
    if (!pmsRepairNoticeAvailableFor(hotel)) return null
    const trustedDeviceStatus = trustedDeviceEligible(hotel)
      ? trustedDeviceStoreFor(hotel).status(now)
      : trustedDeviceNotApplicableStatus(hotel)
    const incident = pmsRepairIncidentFor({
      hotel,
      monitor: liveMonitorFor(hotel.hotelId),
      trustedDeviceStatus,
      now,
    })
    if (!incident) return null
    const providerLastErrorCode = hotel.pmsSystemCode === 'LUOPAN_CLOUD'
      ? luopanBrowserConfigRecordFor(hotel.hotelId).lastErrorCode
      : null
    const messageKey = pmsRepairNoticeMessageKey({
      hotel,
      incident,
      providerLastErrorCode,
    })
    const deliveryPlan = planWeComRepairNoticeDeliveries({
      messageKey,
      channels: repairNoticeChannelsFor(hotel),
      deliveryForKey: (key) => weComDeliveriesByKey.get(key),
    })
    if (
      deliveryPlan.length > 0
      && deliveryPlan.every((item) =>
        weComDeliveriesByKey.has(item.messageKey))
    ) return null
    try {
      return await deliverMorningRepairNotice({
        hotel,
        auditRecord: {
          auditKey: incident.incidentId,
          status: 'PMS_REPAIR_REQUIRED',
        },
        deliveryType: 'PMS_REPAIR_REQUIRED',
        content: pmsRepairNoticeContent({
          hotel,
          incident,
          publicOrigin: trustedDevicePublicOrigin,
          providerLastErrorCode,
        }),
      })
    } catch (error) {
      process.stderr.write(`${JSON.stringify({
        event: 'PMS_REPAIR_NOTICE_SKIPPED',
        hotelId: hotel.hotelId,
        reasonCode:
          typeof error?.message === 'string'
            ? safeLuopanRepairReason(error.message)
            : 'PMS_REPAIR_NOTICE_FAILED_CLOSED',
      })}\n`)
      return null
    }
  })
  return Promise.allSettled(attempts)
}

const repairNightlyBriefingHealthAudit = async ({
  hotel,
  auditRecord,
  repairSlot,
}) => {
  updateBriefingHealthAudit(auditRecord.auditId, {
    repairKey: repairSlot.repairKey,
    repairStartedAt: new Date().toISOString(),
    resolutionStatus: 'REPAIRING',
    reasonCode: null,
  })
  try {
    if (auditRecord.status === 'REAUTH_REQUIRED') {
      const bieyanghongPilot =
        hotel.hotelCode === BIEYANGHONG_REPAIR_PILOT_HOTEL_CODE
        && hotel.pmsSystemCode === 'MEITUAN_BIEYANGHONG'
      const challenge = bieyanghongPilot
        ? await startBieyanghongRepairChallenge(
          hotel.hotelId,
          'DAILY_07_30_REPAIR',
        )
        : await startLuopanRepairChallenge(
          hotel.hotelId,
          'DAILY_07_30_REPAIR',
        )
      if (!challenge) {
        throw new Error(
          bieyanghongPilot
            ? 'BIEYANGHONG_REPAIR_NOT_STARTED'
            : 'LUOPAN_REPAIR_NOT_STARTED',
        )
      }
      updateBriefingHealthAudit(auditRecord.auditId, {
        resolutionStatus: 'WAITING_CAPTCHA',
        reasonCode: bieyanghongPilot
          ? 'BIEYANGHONG_REPAIR_WAITING_MANAGER_AUTHORIZATION'
          : 'LUOPAN_REPAIR_WAITING_CAPTCHA',
      })
      return
    }
    if (
      auditRecord.status === 'COLLECTION_DISABLED'
      || auditRecord.status === 'DELIVERY_DISABLED'
    ) {
      throw new Error(`${auditRecord.status}_MANUAL_CONFIGURATION_REQUIRED`)
    }

    const collection = await collectLiveFor(hotel.hotelId)
    const today = await deliverWeComSnapshot({
      hotelId: hotel.hotelId,
      snapshot: collection.snapshot,
      messageKey:
        `${hotel.hotelId}:DAILY_MORNING_RECOVERY:${auditRecord.auditKey}:${collection.snapshot.collectionRunId}:TODAY`,
      messagePrefix: '凌晨自检修复补发',
      deliveryType: 'TODAY_REVENUE',
    })
    const future = await deliverWeComSnapshot({
      hotelId: hotel.hotelId,
      snapshot: collection.snapshot,
      messageKey:
        `${hotel.hotelId}:DAILY_MORNING_RECOVERY:${auditRecord.auditKey}:${collection.snapshot.collectionRunId}:FUTURE_14D_V1`,
      messagePrefix: '凌晨自检修复补发',
      deliveryType: 'FUTURE_14D',
      payloadFactory: ({ hotel: selected, snapshot: current }) =>
        futureBookingPayloads({
          hotel: selected,
          snapshot: current,
          messagePrefix: '凌晨自检修复补发',
        }),
    })
    if (
      today.deliveryStatus !== 'DELIVERED'
      || future.deliveryStatus !== 'DELIVERED'
    ) {
      throw new Error('MORNING_REPAIR_DELIVERY_NOT_CONFIRMED')
    }
    updateBriefingHealthAudit(auditRecord.auditId, {
      resolutionStatus: 'RESOLVED',
      resolvedAt: new Date().toISOString(),
      reasonCode: 'MORNING_REPAIR_VERIFIED',
    })
    await deliverMorningRepairNotice({
      hotel,
      auditRecord,
      deliveryType: 'DAILY_MORNING_REPAIR_COMPLETE',
      content: [
        '【门店晨间修复完成】',
        `门店：${hotel.hotelCode} · ${hotel.hotelName}`,
        `凌晨状态：${auditRecord.status}`,
        '结果：已重新采集、补发两类简报并确认送达。',
      ].join('\n'),
    }).catch(() => {})
  } catch (error) {
    if (
      activeLuopanRepairsByHotel.has(hotel.hotelId)
      || activeBieyanghongRepairsByHotel.has(hotel.hotelId)
    ) {
      updateBriefingHealthAudit(auditRecord.auditId, {
        resolutionStatus: 'WAITING_CAPTCHA',
        reasonCode: activeBieyanghongRepairsByHotel.has(hotel.hotelId)
          ? 'BIEYANGHONG_REPAIR_WAITING_MANAGER_AUTHORIZATION'
          : 'LUOPAN_REPAIR_WAITING_CAPTCHA',
      })
      return
    }
    const reasonCode = safeLuopanRepairReason(error)
    updateBriefingHealthAudit(auditRecord.auditId, {
      resolutionStatus: 'FAILED',
      reasonCode,
    })
    await deliverMorningRepairNotice({
      hotel,
      auditRecord,
      deliveryType: 'DAILY_MORNING_REPAIR_FAILED',
      content: [
        '【门店晨间修复未完成】',
        `门店：${hotel.hotelCode} · ${hotel.hotelName}`,
        `凌晨状态：${auditRecord.status}`,
        `状态码：${reasonCode}`,
        '请由OTA运营人员进入后台处理；系统不会重复登录。',
        `修复后台（需登录）：${storeRepairConsoleUrlFor(hotel)}`,
      ].join('\n'),
    }).catch(() => {})
  }
}

const scheduledBriefingAuditTick = async () => {
  await expireLuopanRepairSessions()
  const now = new Date()
  const auditSlot = dailyBriefingAuditSlot(now)
  if (auditSlot) {
    for (const hotel of hotels) {
      if (
        lastDailyBriefingAuditKeyByHotel.get(hotel.hotelId)
        === auditSlot.auditKey
      ) continue
      lastDailyBriefingAuditKeyByHotel.set(hotel.hotelId, auditSlot.auditKey)
      recordNightlyBriefingHealthAudit({ hotel, slot: auditSlot, date: now })
    }
  }

  const repairSlot = dailyBriefingRepairSlot(now)
  if (!repairSlot) return
  for (const hotel of hotels) {
    if (
      lastDailyBriefingRepairKeyByHotel.get(hotel.hotelId)
      === repairSlot.repairKey
    ) continue
    lastDailyBriefingRepairKeyByHotel.set(hotel.hotelId, repairSlot.repairKey)
    const auditRecord = recordNightlyBriefingHealthAudit({
      hotel,
      slot: {
        ...repairSlot,
        auditKey: repairSlot.auditKey,
      },
      date: now,
    })
    if (
      auditRecord.resolutionStatus === 'NOT_REQUIRED'
      || auditRecord.resolutionStatus === 'RESOLVED'
      || auditRecord.repairKey === repairSlot.repairKey
    ) continue
    await repairNightlyBriefingHealthAudit({
      hotel,
      auditRecord,
      repairSlot,
    })
  }
}

const futureBookingPayloads = ({
  hotel,
  snapshot,
  messagePrefix,
}) => createFutureBookingWeComPayloadsWithAi(
  hotel,
  snapshot,
  {
    messagePrefix,
    aiConfig: futureBookingAiConfig,
    onAiApplied: () => {
      process.stdout.write(
        `${JSON.stringify({
          event: 'FUTURE_BOOKING_AI_ADVICE_APPLIED',
          businessDate: snapshot.businessDate,
        })}\n`,
      )
    },
    onAiFallback: (reasonCode) => {
      const safeReasonCode =
        typeof reasonCode === 'string'
        && /^[A-Z0-9][A-Z0-9_]{1,63}$/.test(reasonCode)
          ? reasonCode
          : 'AI_ADVICE_FALLBACK'
      process.stderr.write(
        `${JSON.stringify({
          event: 'FUTURE_BOOKING_AI_ADVICE_FALLBACK',
          businessDate: snapshot.businessDate,
          reasonCode: safeReasonCode,
        })}\n`,
      )
    },
  },
)

const manualReplayFailureForDecision = (decision) => {
  if (decision === 'MANUAL_RECONCILIATION_REQUIRED') {
    return 'WECOM_MANUAL_REPLAY_MANUAL_RECONCILIATION_REQUIRED'
  }
  if (decision === 'OPERATION_SCOPE_CONFLICT') {
    return 'WECOM_MANUAL_REPLAY_OPERATION_SCOPE_CONFLICT'
  }
  return 'WECOM_MANUAL_REPLAY_REJECTED_NO_AUTOMATIC_RETRY'
}

const runWeComManualReplay = async ({ hotelId, body }) => {
  const request = normalizeManualReplayRequest(body)
  const hotel = selectedHotel(hotelId)
  const snapshot = selectLatestAuthoritativeCompleteSnapshot({
    snapshots: liveSnapshotStore[hotelId] ?? [],
    expectedCollectionRunId: request.expectedCollectionRunId,
    trustedDeviceStatus: trustedDeviceEligible(hotel)
      ? trustedDeviceStoreFor(hotel).status()
      : null,
  })
  const templates = [
    {
      templateCode: 'TODAY_REVENUE',
      messageKey: manualReplayMessageKey({
        hotelId,
        operationKey: request.operationKey,
        deliveryType: 'TODAY_REVENUE',
      }),
      delivery: () => deliverWeComSnapshot({
        hotelId,
        snapshot,
        messageKey: manualReplayMessageKey({
          hotelId,
          operationKey: request.operationKey,
          deliveryType: 'TODAY_REVENUE',
        }),
        messagePrefix: MANUAL_REPLAY_MESSAGE_PREFIX,
        deliveryType: 'TODAY_REVENUE',
      }),
    },
  ]
  const skippedTemplates = []
  if (
    Array.isArray(snapshot.futureBookingChanges?.daily)
    && snapshot.futureBookingChanges.daily.length > 0
  ) {
    const messageKey = manualReplayMessageKey({
      hotelId,
      operationKey: request.operationKey,
      deliveryType: 'FUTURE_14D',
    })
    templates.push({
      templateCode: 'FUTURE_14D',
      messageKey,
      delivery: () => deliverWeComSnapshot({
        hotelId,
        snapshot,
        messageKey,
        messagePrefix: MANUAL_REPLAY_MESSAGE_PREFIX,
        deliveryType: 'FUTURE_14D',
        payloadFactory: ({ hotel: selected, snapshot: current }) =>
          futureBookingPayloads({
            hotel: selected,
            snapshot: current,
            messagePrefix: MANUAL_REPLAY_MESSAGE_PREFIX,
          }),
      }),
    })
  } else {
    skippedTemplates.push({
      templateCode: 'FUTURE_14D',
      reasonCode: 'FUTURE_BOOKING_SNAPSHOT_REQUIRED',
    })
  }

  const operationLockKey = templates[0].messageKey
  const running = weComManualReplayLocks.get(operationLockKey)
  if (running) {
    const result = await running
    return { ...result, replayed: true }
  }

  const operation = (async () => {
    const existingBefore = new Map(templates.map((template) => [
      template.messageKey,
      weComDeliveriesByKey.get(template.messageKey) ?? null,
    ]))
    const result = {
      operationKey: request.operationKey,
      collectionRunId: snapshot.collectionRunId,
      cutoffAt: snapshot.observedAt,
      replayed: templates.every((template) =>
        existingBefore.get(template.messageKey) !== null),
      overallStatus: 'COMPLETE',
      deliveries: [],
      skippedTemplates,
      failedTemplates: [],
    }

    const hasOperationScopeConflict = templates.some((template) =>
      manualReplayDeliveryDecision({
        delivery: existingBefore.get(template.messageKey),
        hotelId,
        snapshot,
      }) === 'OPERATION_SCOPE_CONFLICT')
    if (hasOperationScopeConflict) {
      for (const template of templates) {
        const existing = existingBefore.get(template.messageKey)
        if (existing) {
          result.deliveries.push(manualReplayDeliveryView(existing))
        }
        result.failedTemplates.push({
          templateCode: template.templateCode,
          reasonCode: 'WECOM_MANUAL_REPLAY_OPERATION_SCOPE_CONFLICT',
        })
      }
      result.overallStatus = 'PARTIAL'
      return result
    }

    for (const template of templates) {
      const existing = existingBefore.get(template.messageKey)
      const decision = manualReplayDeliveryDecision({
        delivery: existing,
        hotelId,
        snapshot,
      })
      if (existing) {
        result.deliveries.push(manualReplayDeliveryView(existing))
        if (decision !== 'ALREADY_DELIVERED') {
          result.failedTemplates.push({
            templateCode: template.templateCode,
            reasonCode: manualReplayFailureForDecision(decision),
          })
          result.overallStatus = 'PARTIAL'
        }
        continue
      }
      try {
        const delivery = await template.delivery()
        const deliveredView = manualReplayDeliveryView(delivery)
        result.deliveries.push(deliveredView)
        if (delivery.deliveryStatus !== 'DELIVERED') {
          result.failedTemplates.push({
            templateCode: template.templateCode,
            reasonCode: manualReplayFailureForDecision(
              manualReplayDeliveryDecision({ delivery, hotelId, snapshot }),
            ),
          })
          result.overallStatus = 'PARTIAL'
        }
      } catch (error) {
        result.failedTemplates.push({
          templateCode: template.templateCode,
          reasonCode: safeManualReplayFailureReason(error),
        })
        result.overallStatus = 'PARTIAL'
      }
    }
    return result
  })()
  weComManualReplayLocks.set(operationLockKey, operation)
  try {
    return await operation
  } finally {
    weComManualReplayLocks.delete(operationLockKey)
  }
}

const recoveryDeliveryView = (delivery) => ({
  messageKey: delivery.messageKey,
  deliveryType: delivery.deliveryType,
  deliveryStatus: delivery.deliveryStatus,
  reasonCode: delivery.reasonCode,
  partCount: delivery.partCount,
  deliveredPartCount: delivery.deliveredPartCount,
  decision: recoveryDeliveryDecision(delivery),
})

const canonicalRecoveryMessageKeys = ({ hotelId, snapshot }) => {
  const snapshotHour = shanghaiScheduleParts(
    new Date(snapshot.observedAt),
  ).hourKey
  const common = {
    hotelId,
    businessDate: snapshot.businessDate,
    snapshotHour,
  }
  const keys = {
    today: hourlyDeliveryMessageKey(common),
    future: hourlyDeliveryMessageKey({
      ...common,
      messageKeySuffix: 'FUTURE_14D_V1',
    }),
    hotSelling: hourlyDeliveryMessageKey({
      ...common,
      messageKeySuffix: 'HOT_SELLING_SOLD_OUT_V1',
    }),
  }
  if (Object.values(keys).some((messageKey) => !messageKey)) {
    throw new Error('BIEYANGHONG_RECOVERY_SNAPSHOT_SLOT_INVALID')
  }
  return { ...keys, snapshotHour }
}

const deliverMissingRecoveryMessage = async ({
  messageKey,
  delivery,
}) => {
  const existing = weComDeliveriesByKey.get(messageKey)
  if (existing) return recoveryDeliveryView(existing)
  return recoveryDeliveryView(await delivery())
}

const scheduleRecoveryHotSellingDelivery = ({
  operationResult,
  hotelResult,
  hotelId,
  snapshot,
  snapshotHour,
  messageKey,
}) => {
  const candidate = { snapshot, snapshotHour, messageKey }
  const attempt = async () => {
    if (!hourlyBriefBundleDelivered({
      hotelId,
      candidate,
      deliveriesByKey: weComDeliveriesByKey,
      now: new Date(),
    })) {
      hotelResult.hotSelling = {
        messageKey,
        decision: 'POLICY_DELAY_NOT_SATISFIED',
        deliveryStatus: 'SKIPPED',
        reasonCode: 'HOT_SELLING_POLICY_DELAY_NOT_SATISFIED',
      }
      hotelResult.status = 'DELIVERY_BLOCKED'
      operationResult.status = 'PARTIAL'
      return
    }
    try {
      hotelResult.hotSelling = await deliverMissingRecoveryMessage({
        messageKey,
        delivery: () => deliverWeComSnapshot({
          hotelId,
          snapshot,
          messageKey,
          messagePrefix: '补发售罄预警',
          deliveryType: 'HOT_SELLING_SOLD_OUT',
          payloadFactory: ({ hotel: selected, snapshot: current }) =>
            createHotSellingSoldOutWeComPayloads(
              monitorFromSnapshot(
                current,
                selected,
                null,
                hotSellingRoomTypesFor(selected.hotelId).roomTypeCodes,
              ),
              {
                messagePrefix: '补发售罄预警',
                roomTypeMappings:
                  currentRoomTypeMappingsFor(selected.hotelId),
              },
            ),
        }),
      })
      hotelResult.status = hotelResult.hotSelling.deliveryStatus === 'DELIVERED'
        ? 'COMPLETE'
        : 'DELIVERY_BLOCKED'
    } catch (error) {
      hotelResult.hotSelling = {
        messageKey,
        decision: 'FAILED_CLOSED',
        deliveryStatus: 'REJECTED',
        reasonCode: safeBieyanghongRecoveryReason(error),
      }
      hotelResult.status = 'DELIVERY_BLOCKED'
    }
    operationResult.status = operationResult.hotels.every(
      (hotel) => hotel.status === 'COMPLETE',
    ) ? 'COMPLETE' : 'PARTIAL'
  }
  const timer = setTimeout(() => void attempt(), 65_000)
  timer.unref()
}

const runBieyanghongTargetedRecovery = async (body) => {
  const request = normalizeBieyanghongRecoveryRequest({
    operationKey: body?.operationKey,
    hotelCodes: BIEYANGHONG_RECOVERY_HOTEL_CODES,
  })
  const completed = bieyanghongTargetedRecoveryResults.get(
    request.operationKey,
  )
  if (completed) return { ...completed, replayed: true }
  const running = bieyanghongTargetedRecoveryLocks.get(request.operationKey)
  if (running) return running

  const operation = (async () => {
    const preflightHotels = hotels.map((hotel) => {
      const weComConfig = weComConfigFor(hotel.hotelId)
      return {
        ...hotel,
        cookieConfigured: Object.keys(secretsForHotel(hotel.hotelId)).length > 0,
        weComEnabled: weComConfig.enabled,
        weComWebhookConfigured: weComConfig.webhookConfigured,
      }
    })
    const targets = resolveBieyanghongRecoveryTargets({
      hotels: preflightHotels,
      hotelCodes: request.hotelCodes,
    })
    const operationResult = {
      operationKey: request.operationKey,
      requestedHotelCodes: request.hotelCodes,
      excludedHotelCodes: [BIEYANGHONG_REPAIR_PILOT_HOTEL_CODE],
      startedAt: new Date().toISOString(),
      completedAt: null,
      status: 'RUNNING',
      replayed: false,
      hotels: [],
    }
    for (const target of targets) {
      const hotelResult = {
        hotelId: target.hotelId,
        hotelCode: target.hotelCode,
        status: 'RUNNING',
      }
      operationResult.hotels.push(hotelResult)
      try {
        const collection = await collectLiveFor(target.hotelId)
        const snapshot = collection.snapshot
        const keys = canonicalRecoveryMessageKeys({
          hotelId: target.hotelId,
          snapshot,
        })
        hotelResult.collection = {
          collectionRunId: snapshot.collectionRunId,
          observedAt: snapshot.observedAt,
          businessDate: snapshot.businessDate,
          completeness: snapshot.completeness,
        }
        hotelResult.today = await deliverMissingRecoveryMessage({
          messageKey: keys.today,
          delivery: () => deliverWeComSnapshot({
            hotelId: target.hotelId,
            snapshot,
            messageKey: keys.today,
            messagePrefix: '补发小时简报',
            deliveryType: 'TODAY_REVENUE',
          }),
        })

        const futureAvailable =
          Array.isArray(snapshot?.futureBookingChanges?.daily)
          && snapshot.futureBookingChanges.daily.length > 0
        hotelResult.future = futureAvailable
          ? await deliverMissingRecoveryMessage({
              messageKey: keys.future,
              delivery: () => deliverWeComSnapshot({
                hotelId: target.hotelId,
                snapshot,
                messageKey: keys.future,
                messagePrefix: '补发远期房态',
                deliveryType: 'FUTURE_14D',
                payloadFactory: ({ hotel: selected, snapshot: current }) =>
                  futureBookingPayloads({
                    hotel: selected,
                    snapshot: current,
                    messagePrefix: '补发远期房态',
                  }),
              }),
            })
          : {
              messageKey: keys.future,
              decision: 'SKIPPED_NO_FUTURE_DATA',
              deliveryStatus: 'SKIPPED',
              reasonCode: 'FUTURE_BOOKING_SNAPSHOT_REQUIRED',
            }

        const monitor = monitorFromSnapshot(
          snapshot,
          target,
          null,
          hotSellingRoomTypesFor(target.hotelId).roomTypeCodes,
        )
        const alerts = selectHotSellingSoldOutAlerts(monitor)
        const bundleDelivered =
          hotelResult.today.deliveryStatus === 'DELIVERED'
          && hotelResult.future.deliveryStatus === 'DELIVERED'
        if (alerts.length === 0) {
          hotelResult.hotSelling = {
            messageKey: keys.hotSelling,
            decision: 'SKIPPED_NO_RELIABLE_ALERT',
            deliveryStatus: 'SKIPPED',
            reasonCode: 'HOT_SELLING_SOLD_OUT_NONE',
          }
          hotelResult.status = bundleDelivered || !futureAvailable
            ? 'COMPLETE'
            : 'DELIVERY_BLOCKED'
        } else if (!bundleDelivered) {
          hotelResult.hotSelling = {
            messageKey: keys.hotSelling,
            decision: 'SKIPPED_BRIEF_BUNDLE_NOT_DELIVERED',
            deliveryStatus: 'SKIPPED',
            reasonCode: 'HOT_SELLING_BRIEF_BUNDLE_REQUIRED',
          }
          hotelResult.status = 'DELIVERY_BLOCKED'
        } else {
          const existingHot = weComDeliveriesByKey.get(keys.hotSelling)
          if (existingHot) {
            hotelResult.hotSelling = recoveryDeliveryView(existingHot)
            hotelResult.status = existingHot.deliveryStatus === 'DELIVERED'
              ? 'COMPLETE'
              : 'DELIVERY_BLOCKED'
          } else {
            hotelResult.hotSelling = {
              messageKey: keys.hotSelling,
              decision: 'PENDING_POLICY_DELAY',
              deliveryStatus: 'PENDING',
              reasonCode: 'HOT_SELLING_POLICY_DELAY_PENDING',
            }
            hotelResult.status = 'PENDING_HOT_SELLING'
            scheduleRecoveryHotSellingDelivery({
              operationResult,
              hotelResult,
              hotelId: target.hotelId,
              snapshot,
              snapshotHour: keys.snapshotHour,
              messageKey: keys.hotSelling,
            })
          }
        }
      } catch (error) {
        hotelResult.status = 'FAILED'
        hotelResult.reasonCode = safeBieyanghongRecoveryReason(error)
      }
    }
    operationResult.completedAt = new Date().toISOString()
    operationResult.status = operationResult.hotels.every(
      (hotel) => hotel.status === 'COMPLETE',
    )
      ? 'COMPLETE'
      : operationResult.hotels.some(
          (hotel) => hotel.status === 'PENDING_HOT_SELLING',
        )
        ? 'PENDING'
        : 'PARTIAL'
    bieyanghongTargetedRecoveryResults.set(
      request.operationKey,
      operationResult,
    )
    process.stdout.write(`${JSON.stringify({
      event: 'BIEYANGHONG_TARGETED_RECOVERY_COMPLETED',
      operationKey: request.operationKey,
      requestedHotelCodes: request.hotelCodes,
      excludedHotelCodes: [BIEYANGHONG_REPAIR_PILOT_HOTEL_CODE],
      status: operationResult.status,
    })}\n`)
    return operationResult
  })()
  bieyanghongTargetedRecoveryLocks.set(request.operationKey, operation)
  try {
    return await operation
  } finally {
    bieyanghongTargetedRecoveryLocks.delete(request.operationKey)
  }
}

const deliverFutureDemandRisks = async (hotelId, snapshot) => {
  if (!isBroadcastWindowOpen()) return []
  const stateChanged = reconcileFutureDemandRiskStates({
    hotelId,
    snapshot,
    riskStates: futureDemandRiskStates,
  })
  if (stateChanged) persistFutureDemandRiskStates()
  const config = weComConfigFor(hotelId)
  if (!config.enabled || !config.webhookConfigured) return []

  const candidates = selectFutureDemandRiskCandidates({
    hotelId,
    snapshot,
    riskStates: futureDemandRiskStates,
  })
  if (candidates.length === 0) return []
  const delivery = await deliverWeComSnapshot({
    hotelId,
    snapshot,
    messageKey:
      `${hotelId}:P1_FUTURE_DEMAND:${snapshot.collectionRunId}`,
    deliveryType: 'P1_FUTURE_DEMAND',
    payloadFactory: ({ hotel: selected, snapshot: current }) =>
      createFutureDemandP1WeComPayloads(selected, current, candidates),
  })
  if (delivery.deliveryStatus === 'DELIVERED') {
    for (const candidate of candidates) {
      futureDemandRiskStates[candidate.stateKey] =
        futureDemandRiskStateAfterDelivery(candidate, snapshot)
    }
    persistFutureDemandRiskStates()
  }
  return [delivery]
}

const postStartupBriefingSnapshots = (snapshots) =>
  briefingSnapshotsObservedAfter(snapshots, schedulerStartedAt)

const scheduledWeComDeliveryTick = async () => {
  const now = new Date()
  if (!isBriefDeliveryTime(now, 6)) return
  const { hourKey } = shanghaiScheduleParts(now)
  for (const hotel of hotels) {
    const config = weComConfigFor(hotel.hotelId)
    if (!config.enabled || !config.webhookConfigured) continue
    const candidates = selectHourlyDeliveryCandidates({
      hotelId: hotel.hotelId,
      snapshots: postStartupBriefingSnapshots(
        briefingCycleSnapshots(
          liveSnapshotStore[hotel.hotelId] ?? [],
          now,
        ),
      ),
      deliveredMessageKeys: new Set(weComDeliveriesByKey.keys()),
      businessDayControl: businessDayControlFor(hotel.hotelId),
      limit: 4,
    })
    for (const candidate of candidates) {
      const messagePrefix =
        candidate.snapshotHour === hourKey ? null : '补发小时简报'
      try {
        await deliverWeComSnapshot({
          hotelId: hotel.hotelId,
          snapshot: candidate.snapshot,
          messageKey: candidate.messageKey,
          messagePrefix,
        })
      } catch (error) {
        process.stderr.write(
          `${JSON.stringify({
            event: 'WECOM_DELIVERY_FAILED_CLOSED',
            hotelId: hotel.hotelId,
            messageKey: candidate.messageKey,
            reasonCode: error?.message ?? 'WECOM_DELIVERY_FAILED_CLOSED',
          })}\n`,
        )
      }
    }
  }
}

const scheduledFutureBookingDeliveryTick = async () => {
  const now = new Date()
  if (!isBriefDeliveryTime(now, 8)) return
  const { hourKey } = shanghaiScheduleParts(now)
  for (const hotel of hotels) {
    const config = weComConfigFor(hotel.hotelId)
    if (!config.enabled || !config.webhookConfigured) continue
    const candidates = selectHourlyDeliveryCandidates({
      hotelId: hotel.hotelId,
      snapshots: postStartupBriefingSnapshots(
        briefingCycleSnapshots(
          liveSnapshotStore[hotel.hotelId] ?? [],
          now,
        ),
      ).filter(
        (snapshot) =>
          Array.isArray(snapshot?.futureBookingChanges?.daily)
          && snapshot.futureBookingChanges.daily.length > 0,
      ),
      deliveredMessageKeys: new Set(weComDeliveriesByKey.keys()),
      businessDayControl: businessDayControlFor(hotel.hotelId),
      messageKeySuffix: 'FUTURE_14D_V1',
      limit: 4,
    })
    for (const candidate of candidates) {
      const messagePrefix =
        candidate.snapshotHour === hourKey ? null : '补发远期房态'
      try {
        await deliverWeComSnapshot({
          hotelId: hotel.hotelId,
          snapshot: candidate.snapshot,
          messageKey: candidate.messageKey,
          messagePrefix,
          deliveryType: 'FUTURE_14D',
          payloadFactory: ({ hotel: selected, snapshot: current }) =>
            futureBookingPayloads({
              hotel: selected,
              snapshot: current,
              messagePrefix,
            }),
        })
      } catch (error) {
        process.stderr.write(
          `${JSON.stringify({
            event: 'FUTURE_BOOKING_WECOM_DELIVERY_FAILED_CLOSED',
            hotelId: hotel.hotelId,
            messageKey: candidate.messageKey,
            reasonCode:
              error?.message ?? 'FUTURE_BOOKING_WECOM_DELIVERY_FAILED_CLOSED',
          })}\n`,
        )
      }
    }
  }
}

const scheduledHotSellingSoldOutDeliveryTick = async () => {
  const now = new Date()
  if (!isBriefDeliveryTime(now, 9)) return
  const { hourKey } = shanghaiScheduleParts(now)
  for (const hotel of hotels) {
    const config = weComConfigFor(hotel.hotelId)
    if (!config.enabled || !config.webhookConfigured) continue
    const candidates = selectHourlyDeliveryCandidates({
      hotelId: hotel.hotelId,
      snapshots: postStartupBriefingSnapshots(
        briefingCycleSnapshots(
          liveSnapshotStore[hotel.hotelId] ?? [],
          now,
        ),
      ).filter((snapshot) => {
        const monitor = monitorFromSnapshot(
          snapshot,
          hotel,
          null,
          hotSellingRoomTypesFor(hotel.hotelId).roomTypeCodes,
        )
        return selectHotSellingSoldOutAlerts(monitor).length > 0
      }),
      deliveredMessageKeys: new Set(weComDeliveriesByKey.keys()),
      businessDayControl: businessDayControlFor(hotel.hotelId),
      messageKeySuffix: 'HOT_SELLING_SOLD_OUT_V1',
      limit: 4,
    }).filter((candidate) => hourlyBriefBundleDelivered({
      hotelId: hotel.hotelId,
      candidate,
      deliveriesByKey: weComDeliveriesByKey,
      now,
    }))
    for (const candidate of candidates) {
      const messagePrefix =
        candidate.snapshotHour === hourKey ? null : '补发售罄预警'
      try {
        await deliverWeComSnapshot({
          hotelId: hotel.hotelId,
          snapshot: candidate.snapshot,
          messageKey: candidate.messageKey,
          messagePrefix,
          deliveryType: 'HOT_SELLING_SOLD_OUT',
          payloadFactory: ({ hotel: selected, snapshot: current }) =>
            createHotSellingSoldOutWeComPayloads(
              monitorFromSnapshot(
                current,
                selected,
                null,
                hotSellingRoomTypesFor(selected.hotelId).roomTypeCodes,
              ),
              {
                messagePrefix,
                roomTypeMappings:
                  currentRoomTypeMappingsFor(selected.hotelId),
              },
            ),
        })
      } catch (error) {
        process.stderr.write(
          `${JSON.stringify({
            event: 'HOT_SELLING_SOLD_OUT_WECOM_DELIVERY_FAILED_CLOSED',
            hotelId: hotel.hotelId,
            messageKey: candidate.messageKey,
            reasonCode:
              error?.message ?? 'HOT_SELLING_SOLD_OUT_DELIVERY_FAILED_CLOSED',
          })}\n`,
        )
      }
    }
  }
}

const briefFor = (hotelId) => {
  const hotel = selectedHotel(hotelId)
  const snapshot = (liveSnapshotStore[hotelId] ?? []).at(-1)
  if (!snapshot) return null
  const monitor = monitorFromSnapshot(
    snapshot,
    hotel,
    null,
    hotSellingRoomTypesFor(hotelId).roomTypeCodes,
  )
  const payloads = createReportMonitorWeComPayloads(monitor, {
    snapshot,
    briefId: snapshot.collectionRunId,
    orderDataRedacted: trustedDeviceEligible(hotel),
  })
  const delivery = [...weComDeliveriesByKey.values()]
    .filter(
      (item) =>
        item.hotelId === hotelId
        && item.cutoffAt === snapshot.observedAt,
    )
    .sort((left, right) =>
      String(right.attemptedAt).localeCompare(String(left.attemptedAt)))[0]
  return {
    briefId: snapshot.collectionRunId,
    businessDate: snapshot.businessDate,
    cutoffAt: snapshot.observedAt,
    revisionNo: 1,
    completenessCode: snapshot.completeness,
    content:
      payloads.map((payload) => payload.text.content).join('\n\n——\n\n'),
    publishedAt: snapshot.observedAt,
    simulationRunId: snapshot.collectionRunId,
    deliveryStatus:
      delivery?.deliveryStatus
      ?? (weComConfigFor(hotelId).enabled
        ? 'WAITING_FOR_SCHEDULE'
        : 'DELIVERY_DISABLED'),
    simulationMode: false,
  }
}

const trustedDeviceReportContractByPath = new Map([
  ['/hotelpms/api/v1/report/jd01', 'ORDER_DETAIL'],
  ['/hotelpms/api/v2/report/jy09', 'FUTURE_OVERVIEW'],
  [
    '/hotelpms/api/v1/report/home/workbench/businessOverview',
    'BUSINESS_OVERVIEW',
  ],
  [
    '/hotelpms/api/v1/report/lion/manager/workbench/room',
    'PHYSICAL_INVENTORY',
  ],
  [
    '/hotelpms/api/v2/report/roomState/batchSearchBaseRoomForcasting',
    'ROOM_FORECAST',
  ],
])

const trustedDeviceSourceCodeFor = (source) => {
  let contract = null
  try {
    contract = trustedDeviceReportContractByPath.get(
      new URL(source.endpointUrl).pathname,
    ) ?? null
  } catch {
    contract = null
  }
  const prefix =
    contract === 'ORDER_DETAIL'
      ? 'REPORT_ORDER'
      : ['FUTURE_OVERVIEW', 'BUSINESS_OVERVIEW'].includes(contract)
        ? 'REPORT_REVENUE'
        : contract === 'ROOM_FORECAST'
          ? 'REPORT_ROOM_FORECAST'
          : contract === 'PHYSICAL_INVENTORY'
            ? 'REPORT_INVENTORY'
            : 'REPORT_UNKNOWN'
  return `${prefix}_${String(source.sourceId).slice(0, 8)}`
}

const trustedDevicePseudonymKeyFor = (hotel) => createHmac(
  'sha256',
  Buffer.from(pseudonymSecretKey, 'base64url'),
).update([
  'SFG_TRUSTED_DEVICE_PSEUDONYM_V1',
  hotel.tenantId,
  hotel.hotelId,
].join('\n')).digest('base64url')

const trustedDeviceConfigMaterial = (hotel) => {
  if (!trustedDeviceEligible(hotel)) {
    throw new Error('TRUSTED_DEVICE_DISABLED')
  }
  if (!reportSourcesByHotel.has(hotel.hotelId)) {
    synchronizeReportSourcesFromPrimary()
  }
  const sources = (reportSourcesByHotel.get(hotel.hotelId) ?? []).map((source) => ({
    sourceId: source.sourceId,
    displayName: source.displayName,
    endpointUrl: source.endpointUrl,
    reportType: source.reportType,
    calculationRole: source.calculationRole,
    pollIntervalMinutes: source.pollIntervalMinutes,
    requestPayloadJson: source.requestPayloadJson,
    enabled: source.enabled,
  }))
  const requiredSourceContracts = sources
    .filter((source) => source.enabled)
    .map((source) => ({
      sourceId: source.sourceId,
      sourceCode: trustedDeviceSourceCodeFor(source),
      reportType: source.reportType,
    }))
    .sort((left, right) => left.sourceId.localeCompare(right.sourceId))
  const config = {
    schemaVersion: 2,
    phase: 'COLLECTION_CONFIG',
    hotel: {
      tenantId: hotel.tenantId,
      hotelId: hotel.hotelId,
      hotelCode: hotel.hotelCode,
      hotelName: hotel.hotelName,
      timezone: hotel.timezone,
    },
    sources,
    requiredSourceContracts,
    pseudonymKey: trustedDevicePseudonymKeyFor(hotel),
    hotSellingRoomTypeCodes:
      hotSellingRoomTypesFor(hotel.hotelId).roomTypeCodes,
    schedule: 'DYNAMIC_SHANGHAI_V1',
  }
  const encryptedSecrets = secretsForHotel(hotel.hotelId)
  const credentialEpochs = sources.map((source) => ({
    sourceId: source.sourceId,
    updatedAt: encryptedSecrets[source.sourceId]?.updatedAt ?? null,
  }))
  return {
    config,
    requiredSourceContracts,
    configDigest: createHash('sha256')
      .update(stableJson({ config, credentialEpochs }))
      .digest('hex'),
  }
}

const trustedDeviceCollectionConfig = (hotel, scopeReceipt, material = null) => {
  const resolved = material ?? trustedDeviceConfigMaterial(hotel)
  return {
    ...resolved.config,
    scopeReceipt,
  }
}

const trustedDeviceSnapshotHash = (snapshot) => createHash('sha256')
  .update(stableJson(snapshot))
  .digest('hex')

const acceptTrustedDeviceSnapshot = ({
  hotel,
  deviceId,
  snapshot,
  requiredSourceContracts,
}) => {
  if (!trustedDeviceEligible(hotel)) {
    throw new Error('TRUSTED_DEVICE_DISABLED')
  }
  validateTrustedDeviceSnapshot({
    snapshot,
    hotel,
    requiredSourceContracts,
    requiredPseudonymKey: trustedDevicePseudonymKeyFor(hotel),
  })
  const intakeStore = trustedDeviceStoreFor(hotel)
  const snapshotHash = trustedDeviceSnapshotHash(snapshot)
  const prior = liveSnapshotStore[hotel.hotelId] ?? []
  const pending = intakeStore.pendingCutover()
  const persistedPending = pending
    ? prior.find((candidate) =>
        candidate?.collectionRunId === pending.collectionRunId)
    : null
  if (persistedPending) {
    if (trustedDeviceSnapshotHash(persistedPending) !== pending.snapshotHash) {
      throw new Error('TRUSTED_DEVICE_CUTOVER_COMMIT_INVALID')
    }
    intakeStore.completeCutover({
      deviceId: pending.deviceId,
      collectionRunId: pending.collectionRunId,
      snapshotHash: pending.snapshotHash,
    })
  }
  const existing = prior.find((candidate) =>
    candidate?.collectionRunId === snapshot.collectionRunId)
  if (
    existing
    && trustedDeviceSnapshotHash(existing) !== snapshotHash
  ) throw new Error('TRUSTED_DEVICE_SNAPSHOT_ID_CONFLICT')
  const statusBefore = intakeStore.status().device
  const cutoverWasReady = Boolean(statusBefore?.cutoverReady)
  const beginsCutover =
    !cutoverWasReady && snapshot.completeness === 'COMPLETE'
  if (!cutoverWasReady && !beginsCutover) {
    if (existing) return { duplicate: true, authoritative: false }
    intakeStore.acceptSnapshot({ deviceId, snapshot })
    process.stdout.write(`${JSON.stringify({
      event: 'TRUSTED_DEVICE_SHADOW_SNAPSHOT_ACCEPTED',
      hotelId: hotel.hotelId,
      deviceId,
      collectionRunId: snapshot.collectionRunId,
      completeness: snapshot.completeness,
    })}\n`)
    return { duplicate: false, authoritative: false }
  }
  if (existing && !statusBefore?.cutoverPending) {
    return { duplicate: true, authoritative: true }
  }
  if (!existing) {
    migrateTrustedPseudonymAliases(hotel, snapshot)
  }
  if (beginsCutover) {
    intakeStore.beginCutover({
      deviceId,
      snapshot,
      snapshotHash,
      allowPendingReplacement: Boolean(pending && !persistedPending),
    })
  }
  if (!existing) {
    appendAndPersistSnapshot(
      liveSnapshotStore,
      liveSnapshotPath,
      snapshot,
    )
  }
  intakeStore.acceptSnapshot({ deviceId, snapshot })
  if (beginsCutover) intakeStore.completeCutover({
    deviceId,
    collectionRunId: snapshot.collectionRunId,
    snapshotHash,
  })
  const currentControl = businessDayControlFor(hotel.hotelId)
  if (
    currentControl.businessDate !== snapshot.businessDate
    || currentControl.mode !== 'PMS_CONFIRMED'
    || currentControl.businessDateStartedAt !== snapshot.businessDateStartedAt
  ) {
    businessDayControlsByHotel.set(hotel.hotelId, {
      businessDate: snapshot.businessDate,
      mode: 'PMS_CONFIRMED',
      source: 'PMS_NIGHT_AUDIT_API',
      businessDateStartedAt: snapshot.businessDateStartedAt ?? null,
      updatedAt: new Date().toISOString(),
    })
    persistBusinessDayControls()
  }
  process.stdout.write(`${JSON.stringify({
    event: existing
      ? 'TRUSTED_DEVICE_SNAPSHOT_REPLAYED'
      : 'TRUSTED_DEVICE_SNAPSHOT_ACCEPTED',
    hotelId: hotel.hotelId,
    deviceId,
    collectionRunId: snapshot.collectionRunId,
    completeness: snapshot.completeness,
  })}\n`)
  return { duplicate: Boolean(existing), authoritative: true }
}

const bearerTokenFor = (request) => {
  const authorization = request.headers.authorization ?? ''
  return authorization.startsWith('Bearer ')
    ? authorization.slice('Bearer '.length)
    : ''
}

const parseCookies = (request) => Object.fromEntries(
  String(request.headers.cookie ?? '')
    .split(';')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const separator = part.indexOf('=')
      if (separator <= 0) return ['', '']
      const name = part.slice(0, separator)
      const rawValue = part.slice(separator + 1)
      try {
        return [name, decodeURIComponent(rawValue)]
      } catch {
        return [name, '']
      }
    })
    .filter(([name]) => name),
)

const browserOriginAllowed = (request) => {
  const origin = String(request.headers.origin ?? '').trim()
  return !origin || allowedBrowserOrigins.has(origin)
}

const clientAddressFor = (request) => {
  const remoteAddress = String(request.socket?.remoteAddress ?? '')
  const loopback = ['127.0.0.1', '::1', '::ffff:127.0.0.1']
    .includes(remoteAddress)
  const forwarded = loopback
    ? String(request.headers['x-forwarded-for'] ?? '')
      .split(',')[0]
      .trim()
    : ''
  const candidate = forwarded || remoteAddress || 'unknown'
  return candidate.slice(0, 96)
}

const auditSecurityEvent = ({
  action,
  outcome,
  request,
  principal = null,
  hotelId = null,
  targetAccountId = null,
  reasonCode = null,
  username = null,
}) => {
  mkdirSync(dirname(securityAuditPath), { recursive: true })
  const sourceFingerprint = createHash('sha256')
    .update(clientAddressFor(request), 'utf8')
    .digest('hex')
    .slice(0, 24)
  const usernameFingerprint = username
    ? createHash('sha256')
      .update(String(username).trim().toLocaleLowerCase(), 'utf8')
      .digest('hex')
      .slice(0, 24)
    : null
  appendFileSync(
    securityAuditPath,
    `${JSON.stringify({
      occurredAt: new Date().toISOString(),
      action: String(action).slice(0, 96),
      outcome: String(outcome).slice(0, 32),
      actorAccountId: principal?.id ?? null,
      targetAccountId,
      hotelId,
      reasonCode,
      usernameFingerprint,
      sourceFingerprint,
    })}\n`,
    { encoding: 'utf8', mode: 0o600 },
  )
}

const secureCookieAttribute = authCookieSecure ? '; Secure' : ''
const authCookieHeaders = (bundle) => ({
  'set-cookie': [
    `ota_refresh=${encodeURIComponent(bundle.refreshToken)}; `
      + `Path=${authCookiePath}; `
      + `Max-Age=${bundle.refreshExpiresInSeconds}; HttpOnly; `
      + `SameSite=Strict${secureCookieAttribute}`,
    `ota_csrf=${encodeURIComponent(bundle.csrfToken)}; `
      + `Path=/; Max-Age=${bundle.refreshExpiresInSeconds}; `
      + `SameSite=Strict${secureCookieAttribute}`,
  ],
})

const expiredAuthCookieHeaders = () => ({
  'set-cookie': [
    `ota_refresh=; Path=${authCookiePath}; Max-Age=0; HttpOnly; `
      + `SameSite=Strict${secureCookieAttribute}`,
    `ota_csrf=; Path=/; Max-Age=0; SameSite=Strict${secureCookieAttribute}`,
  ],
})

const publicAuthSession = (bundle) => {
  const {
    refreshToken: _refreshToken,
    csrfToken: _csrfToken,
    refreshExpiresInSeconds: _refreshExpiresInSeconds,
    ...session
  } = bundle
  return session
}

const refreshInputFor = (request) => {
  const cookies = parseCookies(request)
  const csrfHeader = String(request.headers['x-csrf-token'] ?? '')
  const csrfCookie = String(cookies.ota_csrf ?? '')
  const csrfMatches = csrfHeader.length > 0
    && csrfHeader.length === csrfCookie.length
    && timingSafeEqual(
      Buffer.from(csrfHeader, 'utf8'),
      Buffer.from(csrfCookie, 'utf8'),
    )
  return {
    refreshToken: cookies.ota_refresh ?? '',
    csrfToken: csrfMatches ? csrfHeader : '',
  }
}

const LOGIN_RATE_WINDOW_MS = 15 * 60_000
const LOGIN_RATE_BLOCK_MS = 15 * 60_000
const LOGIN_RATE_ACCOUNT_MAX_FAILURES = 5
const LOGIN_RATE_SOURCE_MAX_FAILURES = 25
const loginRateState = new Map()

const loginRateKeysFor = (request, username) => {
  const source = clientAddressFor(request)
  const normalizedUsername = String(username).trim().toLocaleLowerCase()
  const keyFor = (scope) => createHash('sha256')
    .update(scope, 'utf8')
    .digest('hex')
  return [
    {
      key: keyFor(`ACCOUNT:${source}:${normalizedUsername}`),
      maxFailures: LOGIN_RATE_ACCOUNT_MAX_FAILURES,
    },
    {
      key: keyFor(`SOURCE:${source}`),
      maxFailures: LOGIN_RATE_SOURCE_MAX_FAILURES,
    },
  ]
}

const loginRateLimited = ({ key, maxFailures }) => {
  const current = loginRateState.get(key)
  if (!current) return false
  const now = Date.now()
  if (current.blockedUntil > now) return true
  if (current.windowStartedAt + LOGIN_RATE_WINDOW_MS <= now) {
    loginRateState.delete(key)
    return false
  }
  return current.failures >= maxFailures
}

const recordLoginFailure = ({ key, maxFailures }) => {
  const now = Date.now()
  const current = loginRateState.get(key)
  const active = current && current.windowStartedAt + LOGIN_RATE_WINDOW_MS > now
    ? current
    : { failures: 0, windowStartedAt: now, blockedUntil: 0 }
  active.failures += 1
  if (active.failures >= maxFailures) {
    active.blockedUntil = now + LOGIN_RATE_BLOCK_MS
  }
  loginRateState.set(key, active)
}

const requireAuth = (request, response) => {
  const principal = authStore.principal(bearerTokenFor(request))
  if (!principal) {
    json(response, 401, { code: 'REVIEW_SESSION_REQUIRED' })
    return null
  }
  return principal
}

const isPlatformAdmin = (principal) =>
  Boolean(principal?.roles?.includes('PLATFORM_ADMIN'))

const canConfigureHotels = (principal) => isPlatformAdmin(principal)

const ASSIGNABLE_REVIEW_ROLES = new Set([
  'PLATFORM_ADMIN',
  'GENERAL_MANAGER',
  'OTA_OPERATION_MANAGER',
  'OTA_OPERATION_ASSISTANT',
  'CEO',
  'REGIONAL_MANAGER',
])

const REPAIR_WRITE_SUFFIXES = new Set([
  '/bieyanghong-workspace',
  '/bieyanghong-repair',
  '/ota-controlled-logins',
  '/ota-controlled-login-verifications',
  '/luopan-browser-session-validations',
  '/pms-login-config',
  '/trusted-device/bootstrap',
  '/trusted-device/enrollment',
  '/trusted-device/scope-approval',
])

const assignableReviewRoles = (roles) =>
  roles.length > 0 && roles.every((role) => ASSIGNABLE_REVIEW_ROLES.has(role))

const canAccessHotel = (principal, hotelId) =>
  isPlatformAdmin(principal)
  || Boolean(principal?.hotelIds?.includes(hotelId))

const rejectForbidden = (response) => {
  json(response, 403, { code: 'REVIEW_ACCOUNT_SCOPE_FORBIDDEN' })
}

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url ?? '/', `http://${host}:${port}`)
    const path = url.pathname

    if (request.method === 'GET' && path === '/health') {
      json(response, 200, {
        status: 'UP',
        mode: runtimeMode,
        automaticHourlyCollectionEnabled,
        outboundDeliveryEnabled:
          [...weComConfigsByHotel.values()]
            .some((config) => config.enabled === true),
        aiAdvice: futureBookingAiStatus,
        luopanAssistedRepair: {
          enabled: luopanAssistedRepairEnabled,
          ready: luopanAssistedRepairReady(),
          reasonCode: luopanRepairReasonCode(),
          webLinkReady: luopanWebRepairReady,
          weComRepairBot: weComRepairBotPublicStatus(),
        },
        bieyanghongAssistedRepair: {
          enabled:
            bieyanghongAssistedRepairEnabled && !trustedDeviceEnabled,
          ready:
            bieyanghongAssistedRepairReady() && !trustedDeviceEnabled,
          reasonCode: trustedDeviceEnabled
            ? 'BIEYANGHONG_TRUSTED_DEVICE_MODE'
            : bieyanghongRepairReasonCode(),
          pilotHotelCode: BIEYANGHONG_REPAIR_PILOT_HOTEL_CODE,
          credentialInputMode: bieyanghongRemoteDesktopConfig.enabled
            ? 'REMOTE_NATIVE_OFFICIAL_LOGIN'
            : 'CLOUD_OFFICIAL_LOGIN_POPUP',
          remoteDesktop: {
            enabled: bieyanghongRemoteDesktopConfig.enabled,
            ready: bieyanghongRemoteDesktopReady(),
            isolatedBroker: {
              enabled: bieyanghongBrowserBrokerConfig.enabled,
              ready: bieyanghongBrowserBrokerReady(),
            },
          },
          webLinkReady:
            bieyanghongWebRepairReady && !trustedDeviceEnabled,
          adminWorkspaceReady:
            bieyanghongAssistedRepairReady() && !trustedDeviceEnabled,
          adminWorkspaceTtlMinutes:
            BIEYANGHONG_ADMIN_WORKSPACE_TTL_MS / 60_000,
          activeChallengeCount: activeBieyanghongRepairsByHotel.size,
        },
        trustedDevices: hotels.filter(trustedDeviceEligible).map((hotel) => ({
          enabled: true,
          ...trustedDeviceStoreFor(hotel).status(),
        })),
        trustedDevice001: (() => {
          const hotel = hotels.find((candidate) =>
            candidate.hotelCode === TRUSTED_DEVICE_PILOT_HOTEL_CODE
            && trustedDeviceEligible(candidate))
          return hotel
            ? { enabled: true, ...trustedDeviceStoreFor(hotel).status() }
            : {
                enabled: false,
                ...trustedDeviceNotApplicableStatus(
                  hotels.find((candidate) =>
                    candidate.hotelCode === TRUSTED_DEVICE_PILOT_HOTEL_CODE),
                ),
              }
        })(),
      })
      return
    }

    if (
      request.method === 'POST'
      && path === '/api/v1/trusted-device/enroll'
    ) {
      if (url.search) throw new Error('TRUSTED_DEVICE_REQUEST_QUERY_INVALID')
      if (!trustedDeviceEnabled) {
        throw new Error('TRUSTED_DEVICE_PILOT_DISABLED')
      }
      const body = await readBody(request)
      const hotel = trustedDeviceHotelForCode(
        trustedDeviceHotelCodeFromBody(body),
      )
      const intakeStore = trustedDeviceStoreFor(hotel)
      const device = intakeStore.enroll({
        hotelCode: body.hotelCode,
        enrollmentCode: body.enrollmentCode,
        publicKeyPem: body.publicKeyPem,
        label: body.label,
      })
      process.stdout.write(`${JSON.stringify({
        event: 'TRUSTED_DEVICE_ENROLLED',
        hotelCode: hotel.hotelCode,
        deviceId: device.deviceId,
      })}\n`)
      json(response, 201, { data: device })
      return
    }

    if (
      request.method === 'POST'
      && path === '/api/v1/trusted-device/config'
    ) {
      if (url.search) throw new Error('TRUSTED_DEVICE_REQUEST_QUERY_INVALID')
      const body = await readBody(request)
      const hotel = trustedDeviceHotelForCode(
        trustedDeviceHotelCodeFromBody(body),
      )
      const intakeStore = trustedDeviceStoreFor(hotel)
      const device = intakeStore.verifyRequest({
        method: request.method,
        path,
        body,
        headers: request.headers,
      })
      const keys = Object.keys(body).sort()
      if (keys.length === 1 && keys[0] === 'hotelCode') {
        const challenge = intakeStore.issueScopeChallenge({
          deviceId: device.deviceId,
        })
        json(response, 200, {
          data: {
            schemaVersion: 2,
            phase: 'SCOPE_CHALLENGE',
            hotelCode: hotel.hotelCode,
            scopeChallenge: challenge,
          },
        })
        return
      }
      if (
        keys.join(',') !== 'hotelCode,scopeChallengeId,scopeProof'
        || typeof body.scopeChallengeId !== 'string'
        || typeof body.scopeProof !== 'string'
      ) throw new Error('TRUSTED_DEVICE_COLLECTION_CONFIG_INVALID')
      const configMaterial = trustedDeviceConfigMaterial(hotel)
      const verifiedScope = intakeStore.verifyScopeProof({
        deviceId: device.deviceId,
        challengeId: body.scopeChallengeId,
        proof: body.scopeProof,
        expectedPmsLoginHotelId:
          intakeStore.hasBoundStoreScope({ deviceId: device.deviceId })
            ? null
            : expectedBieyanghongHotelScope(hotel.hotelId),
        configDigest: configMaterial.configDigest,
      })
      json(response, 200, {
        data: trustedDeviceCollectionConfig(
          hotel,
          verifiedScope.scopeReceipt,
          configMaterial,
        ),
      })
      return
    }

    if (
      request.method === 'POST'
      && path === '/api/v1/trusted-device/snapshots'
    ) {
      if (url.search) throw new Error('TRUSTED_DEVICE_REQUEST_QUERY_INVALID')
      const body = await readBody(request)
      const hotel = trustedDeviceHotelForCode(
        trustedDeviceHotelCodeFromBody(body),
      )
      if (
        Object.keys(body).sort().join(',') !== 'hotelCode,scopeReceipt,snapshot'
        || typeof body.scopeReceipt !== 'string'
      ) throw new Error('TRUSTED_DEVICE_SNAPSHOT_REQUEST_INVALID')
      const intakeStore = trustedDeviceStoreFor(hotel)
      const device = intakeStore.verifyRequest({
        method: request.method,
        path,
        body,
        headers: request.headers,
      })
      const inFlightLegacyCollection = liveCollectionLocks.get(hotel.hotelId)
      if (inFlightLegacyCollection) {
        await inFlightLegacyCollection.catch(() => {})
      }
      const configMaterial = trustedDeviceConfigMaterial(hotel)
      intakeStore.consumeScopeReceipt({
        deviceId: device.deviceId,
        scopeReceipt: body.scopeReceipt,
        configDigest: configMaterial.configDigest,
      })
      const result = acceptTrustedDeviceSnapshot({
        hotel,
        deviceId: device.deviceId,
        snapshot: body.snapshot,
        requiredSourceContracts: configMaterial.requiredSourceContracts,
      })
      json(response, result.duplicate ? 200 : 202, {
        data: {
          accepted: true,
          authoritative: result.authoritative,
          replayed: result.duplicate,
          collectionRunId: body.snapshot.collectionRunId,
          device: intakeStore.status().device,
        },
      })
      return
    }

    if (
      request.method === 'GET'
      && path === '/api/v1/luopan-repair'
    ) {
      repairHtml(response)
      return
    }

    if (
      request.method === 'GET'
      && path === '/api/v1/luopan-repair/client.js'
    ) {
      repairClientScript(response)
      return
    }

    if (
      request.method === 'GET'
      && path === '/api/v1/luopan-repair/status'
    ) {
      const challenge = luopanRepairChallengeStore.get(
        repairTokenFrom(request),
      )
      if (!challenge) {
        json(response, 404, { code: 'LUOPAN_REPAIR_CHALLENGE_NOT_FOUND' })
        return
      }
      json(response, 200, { data: challenge })
      return
    }

    if (
      request.method === 'GET'
      && path === '/api/v1/luopan-repair/captcha'
    ) {
      const captcha = luopanRepairChallengeStore.captcha(
        repairTokenFrom(request),
      )
      if (!captcha) {
        json(response, 404, { code: 'LUOPAN_REPAIR_CAPTCHA_NOT_FOUND' })
        return
      }
      repairCaptcha(response, captcha)
      return
    }

    if (
      request.method === 'POST'
      && path === '/api/v1/luopan-repair/submit'
    ) {
      const token = repairTokenFrom(request)
      const body = await readBody(request)
      const accepted = processLuopanRepairSubmission({
        token,
        captcha: body.captcha,
      })
      json(response, 202, { data: accepted })
      return
    }

    if (
      request.method === 'GET'
      && path === '/api/v1/bieyanghong-repair'
    ) {
      bieyanghongRepairHtml(response)
      return
    }

    if (
      request.method === 'GET'
      && path === '/api/v1/bieyanghong-repair/client.js'
    ) {
      bieyanghongRepairClientScript(response)
      return
    }

    if (
      request.method === 'GET'
      && path === '/api/v1/bieyanghong-repair/official'
    ) {
      bieyanghongOfficialLoginHtml(response)
      return
    }

    if (
      request.method === 'GET'
      && path === '/api/v1/bieyanghong-repair/official.js'
    ) {
      bieyanghongOfficialLoginClientScript(response)
      return
    }

    if (
      request.method === 'GET'
      && path.startsWith(BIEYANGHONG_NOVNC_ROUTE_PREFIX)
    ) {
      if (!serveBieyanghongNoVncAsset(response, path)) {
        json(response, 404, { code: 'BIEYANGHONG_NOVNC_ASSET_NOT_FOUND' })
      }
      return
    }

    if (
      request.method === 'GET'
      && path === '/api/v1/bieyanghong-repair/status'
    ) {
      const challenge = bieyanghongRepairChallengeStore.get(
        repairTokenFrom(request),
      )
      if (!challenge) {
        json(response, 404, {
          code: 'BIEYANGHONG_REPAIR_CHALLENGE_NOT_FOUND',
        })
        return
      }
      json(response, 200, { data: challenge })
      return
    }

    if (
      request.method === 'POST'
      && path === '/api/v1/bieyanghong-repair/official/start'
    ) {
      const accepted = processBieyanghongOfficialLoginStart({
        token: repairTokenFrom(request),
      })
      json(response, 202, { data: accepted })
      return
    }

    if (
      request.method === 'POST'
      && path === '/api/v1/bieyanghong-repair/vnc/session'
    ) {
      const session = createBieyanghongVncSession(repairTokenFrom(request))
      try {
        empty(response, 204, {
          'set-cookie':
            `${BIEYANGHONG_VNC_COOKIE}=${session.sessionToken}; `
            + `Path=${BIEYANGHONG_VNC_COOKIE_PATH}; `
            + `Max-Age=${session.maxAgeSeconds}; HttpOnly; Secure; `
            + `SameSite=Strict`,
        })
      } finally {
        session.clear()
      }
      return
    }

    if (
      request.method === 'GET'
      && path === '/api/v1/bieyanghong-repair/vnc/check'
    ) {
      try {
        const result = await processBieyanghongRemoteAuthenticationCheck(request)
        json(
          response,
          result.authenticationDetected ? 200 : 202,
          { data: result },
          result.authenticationDetected
            ? {
                'set-cookie':
                  `${BIEYANGHONG_VNC_COOKIE}=; `
                  + `Path=${BIEYANGHONG_VNC_COOKIE_PATH}; Max-Age=0; `
                  + `HttpOnly; Secure; SameSite=Strict`,
              }
            : {},
        )
      } catch (error) {
        if (
          error?.message
          === 'BIEYANGHONG_REMOTE_DESKTOP_SESSION_REQUIRED'
        ) {
          json(
            response,
            401,
            { code: error.message },
            {
              'set-cookie':
                `${BIEYANGHONG_VNC_COOKIE}=; `
                + `Path=${BIEYANGHONG_VNC_COOKIE_PATH}; Max-Age=0; `
                + `HttpOnly; Secure; SameSite=Strict`,
            },
          )
          return
        }
        throw error
      }
      return
    }

    if (
      request.method === 'POST'
      && path === '/api/v1/bieyanghong-repair/request-code'
    ) {
      const token = repairTokenFrom(request)
      const body = await readBody(request)
      let phone = body.phone
      body.phone = null
      body.password = null
      try {
        const accepted = processBieyanghongRepairCodeRequest({
          token,
          phone,
        })
        json(response, 202, { data: accepted })
      } finally {
        phone = null
      }
      return
    }

    if (
      request.method === 'POST'
      && path === '/api/v1/bieyanghong-repair/submit'
    ) {
      const token = repairTokenFrom(request)
      const body = await readBody(request)
      const accepted = processBieyanghongRepairSubmission({
        token,
        code: body.code,
      })
      json(response, 202, { data: accepted })
      return
    }

    if (
      request.method === 'GET'
      && path === '/api/v1/bieyanghong-repair/visual/frame'
    ) {
      const captured = await captureBieyanghongInteractiveFrame(
        repairTokenFrom(request),
      )
      if (captured.authenticated) {
        json(response, 202, { data: { authenticationDetected: true } })
      } else {
        bieyanghongVisualFrame(response, captured.image)
      }
      return
    }

    if (
      request.method === 'POST'
      && path === '/api/v1/bieyanghong-repair/visual/interact'
    ) {
      const token = repairTokenFrom(request)
      const body = await readBody(request)
      let interaction = body
      try {
        const result = await processBieyanghongInteractiveAction({
          token,
          input: interaction,
        })
        json(response, 202, { data: result })
      } finally {
        if (interaction && typeof interaction === 'object') {
          interaction.value = null
        }
        interaction = null
      }
      return
    }

    if (
      request.method === 'POST'
      && path === '/api/v1/bieyanghong-repair/start'
    ) {
      if (!loopbackPilotTriggerAuthorized(request)) {
        json(response, 404, { code: 'REVIEW_ROUTE_NOT_FOUND' })
        return
      }
      const hotel = bieyanghongPilotHotel()
      const challenge = hotel
        ? await startBieyanghongRepairChallenge(
          hotel.hotelId,
          'LOOPBACK_PILOT_TEST',
          true,
        )
        : null
      if (!challenge) {
        throw new Error(
          bieyanghongRepairReasonCode()
          ?? 'BIEYANGHONG_REPAIR_NOT_STARTED',
        )
      }
      json(response, 202, { data: challenge })
      return
    }

    if (
      request.method === 'POST'
      && path === '/api/v1/internal/bieyanghong-cookie-recovery'
    ) {
      if (!loopbackPilotTriggerAuthorized(request)) {
        json(response, 404, { code: 'REVIEW_ROUTE_NOT_FOUND' })
        return
      }
      const body = await readBody(request)
      if (Object.prototype.hasOwnProperty.call(body, 'hotelCodes')) {
        throw new Error('BIEYANGHONG_RECOVERY_SCOPE_IS_SERVER_FIXED')
      }
      const result = await runBieyanghongTargetedRecovery(body)
      json(response, result.status === 'PENDING' ? 202 : 200, {
        data: result,
      })
      return
    }

    if (request.method === 'POST' && path === '/api/v1/auth/login') {
      if (!browserOriginAllowed(request)) {
        auditSecurityEvent({
          action: 'AUTH_LOGIN',
          outcome: 'DENIED',
          request,
          reasonCode: 'REVIEW_AUTH_ORIGIN_FORBIDDEN',
        })
        json(response, 403, { code: 'REVIEW_AUTH_ORIGIN_FORBIDDEN' })
        return
      }
      const body = await readBody(request)
      const username = String(body.username ?? '')
      const rateKeys = loginRateKeysFor(request, username)
      if (rateKeys.some(loginRateLimited)) {
        auditSecurityEvent({
          action: 'AUTH_LOGIN',
          outcome: 'RATE_LIMITED',
          request,
          reasonCode: 'REVIEW_AUTH_LOGIN_RATE_LIMITED',
          username,
        })
        json(response, 429, { code: 'REVIEW_AUTH_LOGIN_RATE_LIMITED' })
        return
      }
      const authSession = authStore.loginWithRefresh(
        username,
        String(body.password ?? ''),
      )
      if (!authSession) {
        rateKeys.forEach(recordLoginFailure)
        auditSecurityEvent({
          action: 'AUTH_LOGIN',
          outcome: 'DENIED',
          request,
          reasonCode: 'REVIEW_LOGIN_FAILED',
          username,
        })
        json(response, 401, { code: 'REVIEW_LOGIN_FAILED' })
        return
      }
      loginRateState.delete(rateKeys[0].key)
      const principal = authStore.principal(authSession.accessToken)
      auditSecurityEvent({
        action: 'AUTH_LOGIN',
        outcome: 'SUCCEEDED',
        request,
        principal,
      })
      json(
        response,
        200,
        publicAuthSession(authSession),
        authCookieHeaders(authSession),
      )
      return
    }

    if (request.method === 'POST' && path === '/api/v1/auth/refresh') {
      if (!browserOriginAllowed(request)) {
        json(response, 403, { code: 'REVIEW_AUTH_ORIGIN_FORBIDDEN' })
        return
      }
      const refreshed = authStore.refreshSession(refreshInputFor(request))
      if (!refreshed) {
        auditSecurityEvent({
          action: 'AUTH_REFRESH',
          outcome: 'DENIED',
          request,
          reasonCode: 'REVIEW_AUTH_REFRESH_INVALID',
        })
        json(
          response,
          401,
          { code: 'REVIEW_AUTH_REFRESH_INVALID' },
          expiredAuthCookieHeaders(),
        )
        return
      }
      const principal = authStore.principal(refreshed.accessToken)
      auditSecurityEvent({
        action: 'AUTH_REFRESH',
        outcome: 'SUCCEEDED',
        request,
        principal,
      })
      json(
        response,
        200,
        publicAuthSession(refreshed),
        authCookieHeaders(refreshed),
      )
      return
    }

    if (
      request.method === 'POST'
      && path === '/api/v1/auth/credentials'
    ) {
      const principal = requireAuth(request, response)
      if (!principal) return
      const body = await readBody(request)
      try {
        const authSession = authStore.changeCredentials({
          accessToken: bearerTokenFor(request),
          currentPassword: String(body.currentPassword ?? ''),
          newUsername: String(body.newUsername ?? ''),
          newPassword: String(body.newPassword ?? ''),
        })
        const refreshSession = authStore.attachRefresh(authSession.accessToken)
        const bundle = { ...authSession, ...refreshSession }
        auditSecurityEvent({
          action: 'AUTH_CREDENTIALS_CHANGE',
          outcome: 'SUCCEEDED',
          request,
          principal: authStore.principal(authSession.accessToken),
        })
        json(
          response,
          200,
          publicAuthSession(bundle),
          authCookieHeaders(bundle),
        )
      } catch (reason) {
        const code = reason instanceof Error ? reason.message : ''
        if (code === 'REVIEW_AUTH_CURRENT_PASSWORD_INVALID') {
          json(response, 403, { code })
          return
        }
        if (
          code === 'REVIEW_AUTH_USERNAME_INVALID'
          || code === 'REVIEW_AUTH_PASSWORD_WEAK'
          || code === 'REVIEW_AUTH_CREDENTIALS_UNCHANGED'
        ) {
          json(response, 400, { code })
          return
        }
        throw reason
      }
      return
    }

    if (
      request.method === 'GET'
      && path === '/api/v1/auth/accounts'
    ) {
      const principal = requireAuth(request, response)
      if (!principal) return
      if (!isPlatformAdmin(principal)) {
        rejectForbidden(response)
        return
      }
      json(response, 200, { data: authStore.listAccounts() })
      return
    }

    if (
      request.method === 'POST'
      && path === '/api/v1/auth/accounts'
    ) {
      const principal = requireAuth(request, response)
      if (!principal) return
      if (!isPlatformAdmin(principal)) {
        rejectForbidden(response)
        return
      }
      const body = await readBody(request)
      const roles = Array.isArray(body.roles) ? body.roles : []
      const hotelIds = Array.isArray(body.hotelIds) ? body.hotelIds : []
      if (
        !assignableReviewRoles(roles)
        || hotelIds.some((hotelId) =>
          !hotels.some((hotel) => hotel.hotelId === hotelId))
      ) throw new Error('REVIEW_AUTH_HOTEL_SCOPE_INVALID')
      const account = authStore.createAccount({
        username: body.username,
        displayName: body.displayName,
        password: body.password,
        roles,
        hotelIds,
      })
      auditSecurityEvent({
        action: 'AUTH_ACCOUNT_CREATE',
        outcome: 'SUCCEEDED',
        request,
        principal,
        targetAccountId: account.id,
      })
      json(response, 201, { data: account })
      return
    }

    const managedAccountMatch = path.match(
      /^\/api\/v1\/auth\/accounts\/([0-9a-f-]{36})$/iu,
    )
    if (request.method === 'PATCH' && managedAccountMatch) {
      const principal = requireAuth(request, response)
      if (!principal) return
      if (!isPlatformAdmin(principal)) {
        rejectForbidden(response)
        return
      }
      const body = await readBody(request)
      const roles = Array.isArray(body.roles) ? body.roles : []
      const hotelIds = Array.isArray(body.hotelIds) ? body.hotelIds : []
      const existing = authStore.listAccounts().find((account) =>
        account.id === managedAccountMatch[1])
      if (!existing) throw new Error('REVIEW_AUTH_ACCOUNT_NOT_FOUND')
      if (
        !assignableReviewRoles(roles)
        || hotelIds.some((hotelId) =>
          !hotels.some((hotel) => hotel.hotelId === hotelId))
      ) throw new Error('REVIEW_AUTH_HOTEL_SCOPE_INVALID')
      const account = authStore.updateAccount({
        accountId: managedAccountMatch[1],
        displayName: body.displayName,
        roles,
        hotelIds,
        enabled: body.enabled,
        newPassword: body.newPassword,
      })
      auditSecurityEvent({
        action: 'AUTH_ACCOUNT_UPDATE',
        outcome: 'SUCCEEDED',
        request,
        principal,
        targetAccountId: account.id,
      })
      json(response, 200, { data: account })
      return
    }

    if (request.method === 'POST' && path === '/api/v1/auth/logout') {
      if (!browserOriginAllowed(request)) {
        json(response, 403, { code: 'REVIEW_AUTH_ORIGIN_FORBIDDEN' })
        return
      }
      const loggedOut = authStore.logoutRefresh(refreshInputFor(request))
      if (!loggedOut) {
        json(response, 403, { code: 'REVIEW_AUTH_CSRF_INVALID' })
        return
      }
      auditSecurityEvent({
        action: 'AUTH_LOGOUT',
        outcome: 'SUCCEEDED',
        request,
        principal: loggedOut,
      })
      empty(response, 204, expiredAuthCookieHeaders())
      return
    }

    let requestPrincipal = null
    if (path.startsWith('/api/v1/ota/')) {
      requestPrincipal = requireAuth(request, response)
      if (!requestPrincipal) return
    }

    if (
      request.method === 'GET'
      && path === '/api/v1/ota/wecom-repair-bot-config'
    ) {
      if (!isPlatformAdmin(requestPrincipal)) {
        rejectForbidden(response)
        return
      }
      json(response, 200, { data: weComRepairBotStatus() })
      return
    }

    if (
      request.method === 'POST'
      && path === '/api/v1/ota/wecom-repair-bot-config'
    ) {
      if (!isPlatformAdmin(requestPrincipal)) {
        rejectForbidden(response)
        return
      }
      const status = applyWeComRepairBotConfigUpdate(await readBody(request))
      json(response, 200, { data: status })
      return
    }

    if (
      request.method === 'GET'
      && path === '/api/v1/ota/connector-adapters'
    ) {
      json(response, 200, { data: adapters })
      return
    }
    if (
      request.method === 'GET'
      && path === '/api/v1/ota/connector-onboarding/templates'
    ) {
      json(response, 200, { data: onboardingTemplates })
      return
    }
    if (
      request.method === 'GET'
      && path === '/api/v1/ota/simulation/hotels'
    ) {
      const visibleHotels = hotels.filter((hotel) =>
        canAccessHotel(requestPrincipal, hotel.hotelId))
      json(response, 200, {
        data: {
          coverage: isPlatformAdmin(requestPrincipal)
            ? 'LOCAL_REVIEW'
            : 'ACCOUNT_HOTEL_SCOPE',
          hotels: visibleHotels,
          failedTenantIds: [],
        },
      })
      return
    }
    if (
      request.method === 'POST'
      && path === '/api/v1/ota/simulation/hotels'
    ) {
      if (!isPlatformAdmin(requestPrincipal)) {
        rejectForbidden(response)
        return
      }
      const input = normalizeSimulationHotelInput(await readBody(request))
      if (!input) throw new Error('SIMULATION_HOTEL_INVALID')
      const hotelCode = input.hotelCode ?? nextSimulationHotelCode()
      const requestedTenant = input.tenantCode === null
        ? null
        : hotels.find((hotel) => hotel.tenantCode === input.tenantCode)
      const tenant = input.tenantCode === null
        ? hotels[0] ?? null
        : requestedTenant ?? null
      if (
        input.tenantCode !== null
        && requestedTenant
        && requestedTenant.tenantName !== input.tenantName
      ) {
        throw new Error('SIMULATION_TENANT_NAME_CONFLICT')
      }
      const existing = hotels.find(
        (hotel) =>
          hotel.hotelCode === hotelCode
          && (input.tenantCode === null || hotel.tenantCode === input.tenantCode),
      )
      if (existing) {
        if (
          existing.hotelName !== input.hotelName
          || existing.timezone !== input.timezone
          || existing.pmsSystemCode !== input.pmsSystemCode
          || existing.pmsSystemName !== input.pmsSystemName
          || existing.ownershipType !== input.ownershipType
        ) {
          throw new Error('SIMULATION_HOTEL_CODE_CONFLICT')
        }
        json(response, 200, {
          data: {
            commandId: randomUUID(),
            resourceId: existing.hotelId,
            resultingRowVersion: existing.rowVersion,
            replayed: true,
          },
        })
        return
      }
      if (hotels.length >= 100) {
        throw new Error('SIMULATION_HOTEL_LIMIT_REACHED')
      }
      const created = {
        tenantId: tenant?.tenantId ?? randomUUID(),
        hotelId: randomUUID(),
        tenantCode: input.tenantCode ?? tenant?.tenantCode ?? 'INTERNAL',
        tenantName: input.tenantName ?? tenant?.tenantName ?? '四方馆酒店经营中心',
        hotelCode,
        hotelName: input.hotelName,
        ownershipType: input.ownershipType,
        pmsSystemCode: input.pmsSystemCode,
        pmsSystemName: input.pmsSystemName,
        timezone: input.timezone,
        lifecycleStatus: 'PILOT',
        collectionEnabled: input.pmsSystemCode !== 'OTHER',
        messageEnabled: false,
        configuredMockConnectors: input.pmsSystemCode === 'OTHER' ? 0 : 2,
        simulationOnly: true,
        rowVersion: 1,
      }
      let clonedSources = []
      if (input.pmsSystemCode === 'MEITUAN_BIEYANGHONG') {
        const { sources: templateSources } = ensurePrimaryReportSourceTemplate()
        clonedSources = cloneReportSourceDefinitions(templateSources)
      }
      hotels.push(created)
      reportSourcesByHotel.set(created.hotelId, clonedSources)
      otaSourcesByHotel.set(created.hotelId, [])
      otaSourceSecretsByHotel.set(created.hotelId, {})
      if (input.pmsSystemCode === 'LUOPAN_CLOUD') {
        pmsLoginSecretsByHotel.set(
          created.hotelId,
          encryptCookie(
            JSON.stringify(input.pmsCredentials),
            cookieSecretKey,
            pmsLoginScope(created.hotelId),
          ),
        )
        luopanBrowserConfigsByHotel.set(
          created.hotelId,
          defaultLuopanBrowserConfig(),
        )
      }
      persistSimulationHotels()
      persistReportSources()
      persistPmsLoginSecrets()
      persistLuopanBrowserConfigs()
      persistOtaSources()
      persistOtaSecrets()
      json(response, 201, {
        data: {
          commandId: randomUUID(),
          resourceId: created.hotelId,
          resultingRowVersion: 1,
          replayed: false,
          copiedReportSourceCount: clonedSources.length,
          pmsSystemCode: input.pmsSystemCode,
          pmsCredentialsConfigured:
            input.pmsSystemCode === 'LUOPAN_CLOUD',
          otaConfigurationRequired: true,
        },
      })
      return
    }

    const scoped = path.match(
      /^\/api\/v1\/ota\/tenants\/([^/]+)\/hotels\/([^/]+)(\/.*)$/,
    )
    if (scoped) {
      const requestTenantId = decodeURIComponent(scoped[1])
      const hotelId = decodeURIComponent(scoped[2])
      const suffix = scoped[3]
      const selected = hotels.find((hotel) => hotel.hotelId === hotelId)
      if (
        !selected
        || selected.tenantId !== requestTenantId
        || !canAccessHotel(requestPrincipal, selected.hotelId)
      ) {
        auditSecurityEvent({
          action: 'HOTEL_SCOPE_ACCESS',
          outcome: 'DENIED',
          request,
          principal: requestPrincipal,
          hotelId,
          reasonCode: 'REVIEW_HOTEL_NOT_FOUND',
        })
        json(response, 404, { code: 'REVIEW_HOTEL_NOT_FOUND' })
        return
      }

      if (
        !['GET', 'HEAD'].includes(request.method ?? '')
        && !canConfigureHotels(requestPrincipal)
        && !REPAIR_WRITE_SUFFIXES.has(suffix)
      ) {
        auditSecurityEvent({
          action: 'HOTEL_WRITE',
          outcome: 'DENIED',
          request,
          principal: requestPrincipal,
          hotelId,
          reasonCode: 'REVIEW_ACCOUNT_SCOPE_FORBIDDEN',
        })
        rejectForbidden(response)
        return
      }

      if (!['GET', 'HEAD'].includes(request.method ?? '')) {
        auditSecurityEvent({
          action: 'HOTEL_WRITE',
          outcome: 'REQUESTED',
          request,
          principal: requestPrincipal,
          hotelId,
        })
      }

      if (
        request.method === 'GET'
        && suffix === '/trusted-device'
      ) {
        const eligible = trustedDeviceEligible(selected)
        json(response, 200, {
          data: eligible
            ? trustedDeviceStoreFor(selected).status()
            : trustedDeviceNotApplicableStatus(selected),
        })
        return
      }

      if (
        request.method === 'POST'
        && suffix === '/trusted-device/enrollment'
      ) {
        if (
          !trustedDeviceEligible(selected)
        ) throw new Error('TRUSTED_DEVICE_SCOPE_INVALID')
        const body = await readBody(request)
        const enrollment = trustedDeviceStoreFor(selected).createEnrollment({
          label: body.label,
        })
        process.stdout.write(`${JSON.stringify({
          event: 'TRUSTED_DEVICE_ENROLLMENT_CREATED',
          hotelId: selected.hotelId,
          expiresAt: enrollment.expiresAt,
        })}\n`)
        json(response, 201, { data: enrollment })
        return
      }

      if (
        request.method === 'POST'
        && suffix === '/trusted-device/scope-approval'
      ) {
        if (!trustedDeviceEligible(selected)) {
          throw new Error('TRUSTED_DEVICE_SCOPE_INVALID')
        }
        const body = await readBody(request)
        if (
          Object.keys(body).sort().join(',') !== 'reasonCode'
          || body.reasonCode !== 'APPROVE_TRUSTED_DEVICE_STORE_SCOPE'
        ) throw new Error('TRUSTED_DEVICE_SCOPE_APPROVAL_INVALID')
        const device = trustedDeviceStoreFor(selected).approveStoreScope()
        process.stdout.write(`${JSON.stringify({
          event: 'TRUSTED_DEVICE_STORE_SCOPE_APPROVED',
          hotelId: selected.hotelId,
          deviceId: device.deviceId,
        })}\n`)
        json(response, 200, { data: { device } })
        return
      }

      if (
        request.method === 'POST'
        && suffix === '/trusted-device/bootstrap'
      ) {
        if (
          !trustedDeviceEligible(selected)
        ) throw new Error('TRUSTED_DEVICE_SCOPE_INVALID')
        const body = await readBody(request)
        const enrollment = trustedDeviceStoreFor(selected).createEnrollment({
          label: body.label,
        })
        const command = renderTrustedDeviceBootstrapCommand({
          enrollmentCode: enrollment.enrollmentCode,
          serverOrigin: trustedDevicePublicOrigin,
        })
        process.stdout.write(`${JSON.stringify({
          event: 'TRUSTED_DEVICE_BOOTSTRAP_DOWNLOADED',
          hotelId: selected.hotelId,
          expiresAt: enrollment.expiresAt,
        })}\n`)
        attachment(
          response,
          `Sifangguan-${selected.hotelCode}-Setup.cmd`,
          command,
          {
            'x-sfg-enrollment-expires-at': enrollment.expiresAt,
            'x-sfg-bootstrap-file-name': `Sifangguan-${selected.hotelCode}-Setup.cmd`,
          },
        )
        return
      }

      if (
        request.method === 'DELETE'
        && suffix === '/trusted-device'
      ) {
        if (
          !trustedDeviceEligible(selected)
        ) throw new Error('TRUSTED_DEVICE_SCOPE_INVALID')
        const intakeStore = trustedDeviceStoreFor(selected)
        const revoked = intakeStore.revoke()
        json(response, 200, {
          data: {
            revoked: Boolean(revoked),
            status: intakeStore.status(),
          },
        })
        return
      }

      if (
        request.method === 'GET'
        && suffix === '/bieyanghong-workspace'
      ) {
        const eligible =
          !trustedDeviceEnabled
          &&
          selected.hotelCode === BIEYANGHONG_REPAIR_PILOT_HOTEL_CODE
          && selected.pmsSystemCode === 'MEITUAN_BIEYANGHONG'
        json(response, 200, {
          data: {
            eligible,
            ready: eligible && bieyanghongAssistedRepairReady(),
            hotelCode: selected.hotelCode,
            hotelName: selected.hotelName,
            reasonCode: trustedDeviceEnabled
              ? 'BIEYANGHONG_TRUSTED_DEVICE_MODE'
              : eligible
                ? bieyanghongRepairReasonCode()
                : 'BIEYANGHONG_WORKSPACE_HOTEL_NOT_ELIGIBLE',
            workspaceTtlMinutes:
              BIEYANGHONG_ADMIN_WORKSPACE_TTL_MS / 60_000,
          },
        })
        return
      }

      if (
        request.method === 'POST'
        && suffix === '/bieyanghong-workspace'
      ) {
        if (trustedDeviceEnabled) {
          throw new Error('BIEYANGHONG_TRUSTED_DEVICE_MODE')
        }
        const workspace = await startBieyanghongRepairChallenge(
          hotelId,
          'ADMIN_FIXED_WORKSPACE',
          true,
          {
            notifyManager: false,
            challengeTtlMs: BIEYANGHONG_ADMIN_WORKSPACE_TTL_MS,
            includeWorkspaceUrl: true,
          },
        )
        if (!workspace || typeof workspace.workspaceUrl !== 'string') {
          throw new Error(
            bieyanghongRepairReasonCode()
            ?? 'BIEYANGHONG_WORKSPACE_NOT_STARTED',
          )
        }
        json(response, 201, { data: workspace })
        return
      }

      if (
        request.method === 'POST'
        && suffix === '/bieyanghong-repair'
      ) {
        const challenge = await startBieyanghongRepairChallenge(
          hotelId,
          'ADMIN_PILOT_TEST',
        )
        if (!challenge) {
          throw new Error(
            bieyanghongRepairReasonCode()
            ?? 'BIEYANGHONG_REPAIR_NOT_STARTED',
          )
        }
        json(response, 202, { data: challenge })
        return
      }

      if (request.method === 'GET' && suffix === '/configuration') {
        if (!canConfigureHotels(requestPrincipal)) {
          rejectForbidden(response)
          return
        }
        json(response, 200, { data: configurationFor(hotelId) })
        return
      }
      if (request.method === 'GET' && suffix === '/report-sources') {
        if (!canConfigureHotels(requestPrincipal)) {
          rejectForbidden(response)
          return
        }
        if (!reportSourcesByHotel.has(hotelId)) {
          if (selected.pmsSystemCode === 'LUOPAN_CLOUD') {
            reportSourcesByHotel.set(hotelId, [])
          } else {
            synchronizeReportSourcesFromPrimary()
          }
        }
        json(response, 200, {
          data: decorateReportSources(
            hotelId,
            reportSourcesByHotel.get(hotelId),
          ),
        })
        return
      }
      if (request.method === 'POST' && suffix === '/report-sources') {
        const body = await readBody(request)
        if (
          typeof body.reasonCode !== 'string'
          || !/^[A-Z0-9][A-Z0-9_-]{1,63}$/.test(body.reasonCode)
        ) {
          throw new Error('REASON_CODE_INVALID')
        }
        const normalizedSources = normalizeReportSources(body.sources)
        if (selected.pmsSystemCode === 'LUOPAN_CLOUD') {
          const existingSources = reportSourcesByHotel.get(hotelId) ?? []
          const cookieUpdateRequested = body.sources.some((source) =>
            (source?.cookieUpdate?.action ?? 'KEEP') !== 'KEEP')
          if (
            cookieUpdateRequested
            || !reportSourceEnabledToggleOnlyMatch(
              normalizedSources,
              existingSources,
            )
          ) {
            throw new Error('LUOPAN_REPORT_SOURCE_ENABLED_ONLY')
          }
          reportSourcesByHotel.set(hotelId, normalizedSources)
          persistReportSources()
          json(response, 200, {
            data: {
              commandId: randomUUID(),
              resourceId: hotelId,
              resultingRowVersion: Math.max(
                1,
                ...normalizedSources.map((source) => source.rowVersion),
              ),
              replayed: false,
            },
          })
          return
        }
        const { primary, sources: templateSources } =
          ensurePrimaryReportSourceTemplate()
        let savedSources
        if (hotelId === primary.hotelId) {
          reportSourcesByHotel.set(hotelId, normalizedSources)
          synchronizeReportSourcesFromPrimary()
          savedSources = normalizedSources
        } else {
          if (!reportSourceDefinitionsMatch(normalizedSources, templateSources)) {
            throw new Error('REPORT_SOURCE_DEFINITION_MANAGED')
          }
          savedSources = cloneReportSourceDefinitions(
            templateSources,
            normalizedSources,
          )
          reportSourcesByHotel.set(hotelId, savedSources)
        }
        applyCookieUpdates(hotelId, body.sources)
        persistCookieSecrets()
        persistReportSources()
        json(response, 200, {
          data: {
            commandId: randomUUID(),
            resourceId: hotelId,
            resultingRowVersion: Math.max(
              1,
              ...savedSources.map((source) => source.rowVersion),
            ),
            replayed: false,
          },
        })
        return
      }
      if (request.method === 'GET' && suffix === '/ota-sources') {
        const decorated = decorateOtaSources(
          hotelId,
          otaSourcesByHotel.get(hotelId) ?? [],
        )
        json(response, 200, {
          data: canConfigureHotels(requestPrincipal)
            ? decorated
            : decorated.map((source) => ({
                ...source,
                portalUrl: '',
                dataEndpointUrl: '',
                requestPayloadJson: '',
                pollIntervalMinutes: 0,
                cookieConfigured: false,
                cookieUpdatedAt: null,
                credentialsConfigured: false,
                credentialsUpdatedAt: null,
              })),
        })
        return
      }
      if (
        request.method === 'GET'
        && suffix === '/ota-controlled-logins'
      ) {
        await cleanExpiredOtaControlledLogin(hotelId, 'FLIGGY')
        json(response, 200, {
          data: otaControlledLoginProfilesFor(hotelId),
        })
        return
      }
      if (
        request.method === 'POST'
        && suffix === '/ota-controlled-logins'
      ) {
        const body = await readBody(request)
        if (
          body.platformCode !== 'FLIGGY'
          || typeof body.reasonCode !== 'string'
          || !/^[A-Z0-9][A-Z0-9_-]{1,63}$/.test(body.reasonCode)
        ) {
          throw new Error('OTA_CONTROLLED_LOGIN_REQUEST_INVALID')
        }
        const result = await startOtaControlledLoginFor(
          hotelId,
          body.platformCode,
        )
        const refreshedSources = result.status === 'AUTHENTICATED'
          ? await refreshOtaPlatformSourcesFor(hotelId, body.platformCode)
          : []
        json(response, 200, {
          data: { ...result, refreshedSources },
        })
        return
      }
      if (
        request.method === 'POST'
        && suffix === '/ota-controlled-login-verifications'
      ) {
        const body = await readBody(request)
        if (
          body.platformCode !== 'FLIGGY'
          || typeof body.attemptId !== 'string'
          || !SIMULATION_HOTEL_ID.test(body.attemptId)
          || typeof body.answer !== 'string'
          || !/^[A-Za-z0-9]{4,8}$/.test(body.answer)
          || typeof body.reasonCode !== 'string'
          || !/^[A-Z0-9][A-Z0-9_-]{1,63}$/.test(body.reasonCode)
        ) {
          throw new Error('OTA_CONTROLLED_LOGIN_VERIFICATION_INVALID')
        }
        const result = await submitOtaControlledLoginAnswer(
          hotelId,
          body.platformCode,
          body.attemptId,
          body.answer,
        )
        const refreshedSources = result.status === 'AUTHENTICATED'
          ? await refreshOtaPlatformSourcesFor(hotelId, body.platformCode)
          : []
        json(response, 200, {
          data: { ...result, refreshedSources },
        })
        return
      }
      if (request.method === 'POST' && suffix === '/ota-sources') {
        const body = await readBody(request)
        if (
          typeof body.reasonCode !== 'string'
          || !/^[A-Z0-9][A-Z0-9_-]{1,63}$/.test(body.reasonCode)
        ) {
          throw new Error('OTA_SOURCE_REASON_CODE_INVALID')
        }
        const previousSources = otaSourcesByHotel.get(hotelId) ?? []
        const normalized = normalizeOtaSources(
          body.sources,
          previousSources,
        )
        assertOtaSourceDeletions(
          body.deletedSources ?? [],
          previousSources,
          normalized,
        )
        applyOtaSecretUpdates(hotelId, body.sources)
        otaSourcesByHotel.set(hotelId, normalized)
        persistOtaSecrets()
        persistOtaSources()
        json(response, 200, {
          data: decorateOtaSources(hotelId, normalized),
        })
        return
      }
      if (
        request.method === 'POST'
        && suffix === '/ota-source-refreshes'
      ) {
        const body = await readBody(request)
        if (
          typeof body.reasonCode !== 'string'
          || !/^[A-Z0-9][A-Z0-9_-]{1,63}$/.test(body.reasonCode)
          || typeof body.sourceId !== 'string'
          || !SIMULATION_HOTEL_ID.test(body.sourceId)
        ) {
          throw new Error('OTA_REFRESH_REQUEST_INVALID')
        }
        const refreshed = await refreshOtaSourceFor(
          hotelId,
          body.sourceId,
        )
        json(response, 200, { data: refreshed })
        return
      }
      if (
        request.method === 'GET'
        && suffix === '/luopan-browser-config'
      ) {
        if (!canConfigureHotels(requestPrincipal)) {
          rejectForbidden(response)
          return
        }
        json(response, 200, {
          data: luopanBrowserConfigFor(hotelId),
        })
        return
      }
      if (
        request.method === 'GET'
        && suffix === '/luopan-browser-repair'
      ) {
        json(response, 200, {
          data: luopanBrowserRepairFor(hotelId),
        })
        return
      }
      if (
        request.method === 'POST'
        && suffix === '/luopan-browser-config'
      ) {
        if (selected.pmsSystemCode !== 'LUOPAN_CLOUD') {
          throw new Error('LUOPAN_PMS_SCOPE_INVALID')
        }
        const body = await readBody(request)
        const existing = luopanBrowserConfigRecordFor(hotelId)
        const profileRef =
          typeof body.profileRef === 'string'
            ? body.profileRef.trim().toLowerCase()
            : ''
        if (
          typeof body.reasonCode !== 'string'
          || !/^[A-Z0-9][A-Z0-9_-]{1,63}$/.test(body.reasonCode)
          || typeof body.enabled !== 'boolean'
          || !LUOPAN_PROFILE_REF.test(profileRef)
          || !Number.isInteger(body.rowVersion)
          || body.rowVersion !== existing.rowVersion
        ) {
          throw new Error('LUOPAN_CONFIG_INVALID')
        }
        const profileChanged = profileRef !== existing.profileRef
        const expectedHotelFingerprint = profileChanged
          ? null
          : existing.expectedHotelFingerprint
        const scopeStatus = profileChanged
          ? 'NOT_VALIDATED'
          : existing.scopeStatus
        if (
          body.enabled
          && (
            scopeStatus !== 'SINGLE_HOTEL_CONFIRMED'
            || !expectedHotelFingerprint
          )
        ) {
          throw new Error('LUOPAN_SESSION_VALIDATION_REQUIRED')
        }
        luopanBrowserConfigsByHotel.set(hotelId, {
          ...existing,
          enabled: body.enabled,
          profileRef,
          expectedHotelFingerprint,
          scopeStatus,
          lastValidatedAt:
            profileChanged ? null : existing.lastValidatedAt,
          lastBusinessDate:
            profileChanged ? null : existing.lastBusinessDate,
          lastCollectionStatus:
            profileChanged ? 'NEVER' : existing.lastCollectionStatus,
          lastCollectionAt:
            profileChanged ? null : existing.lastCollectionAt,
          lastErrorCode: null,
          rowVersion: existing.rowVersion + 1,
        })
        persistLuopanBrowserConfigs()
        json(response, 200, {
          data: luopanBrowserConfigFor(hotelId),
        })
        return
      }
      if (
        request.method === 'POST'
        && suffix === '/luopan-browser-session-validations'
      ) {
        if (selected.pmsSystemCode !== 'LUOPAN_CLOUD') {
          throw new Error('LUOPAN_PMS_SCOPE_INVALID')
        }
        const body = await readBody(request)
        const existing = luopanBrowserConfigRecordFor(hotelId)
        if (
          typeof body.reasonCode !== 'string'
          || !/^[A-Z0-9][A-Z0-9_-]{1,63}$/.test(body.reasonCode)
          || !existing.profileRef
        ) {
          throw new Error('LUOPAN_VALIDATION_REQUEST_INVALID')
        }
        try {
          const validation = await validateLuopanBrowserSession({
            profileRef: existing.profileRef,
            expectedHotelFingerprint:
              existing.expectedHotelFingerprint,
            sessionState:
              luopanSessionStatesByHotel.get(hotelId) ?? null,
          })
          luopanBrowserConfigsByHotel.set(hotelId, {
            ...existing,
            expectedHotelFingerprint: validation.hotelFingerprint,
            scopeStatus: validation.scopeStatus,
            lastValidatedAt: validation.validatedAt,
            lastBusinessDate: validation.businessDate,
            lastErrorCode: null,
            rowVersion: existing.rowVersion + 1,
          })
          persistLuopanBrowserConfigs()
          json(response, 200, {
            data: canConfigureHotels(requestPrincipal)
              ? luopanBrowserConfigFor(hotelId)
              : luopanBrowserRepairFor(hotelId),
          })
          return
        } catch (error) {
          const errorCode =
            typeof error?.message === 'string'
            && error.message.startsWith('LUOPAN_')
              ? error.message
              : 'LUOPAN_SESSION_VALIDATION_FAILED'
          luopanBrowserConfigsByHotel.set(hotelId, {
            ...existing,
            enabled: false,
            scopeStatus: 'NOT_VALIDATED',
            lastErrorCode: errorCode,
            rowVersion: existing.rowVersion + 1,
          })
          persistLuopanBrowserConfigs()
          throw new Error(errorCode)
        }
      }
      if (request.method === 'GET' && suffix === '/pms-login-config') {
        json(response, 200, { data: pmsLoginConfigFor(hotelId) })
        return
      }
      if (request.method === 'POST' && suffix === '/pms-login-config') {
        const body = await readBody(request)
        const credentialUpdate = body.credentialUpdate ?? { action: 'KEEP' }
        if (
          typeof body.reasonCode !== 'string'
          || !/^[A-Z0-9][A-Z0-9_-]{1,63}$/.test(body.reasonCode)
          || !credentialUpdate
          || typeof credentialUpdate !== 'object'
          || !['KEEP', 'REPLACE', 'CLEAR'].includes(credentialUpdate.action)
        ) {
          throw new Error('PMS_LOGIN_CONFIG_INVALID')
        }
        if (
          !canConfigureHotels(requestPrincipal)
          && (
            body.reasonCode !== 'UPDATE_PMS_LOGIN_CREDENTIALS'
            || credentialUpdate.action !== 'REPLACE'
          )
        ) {
          rejectForbidden(response)
          return
        }
        if (
          trustedDeviceEligible(selected)
          && credentialUpdate.action === 'REPLACE'
        ) {
          throw new Error('TRUSTED_DEVICE_CREDENTIAL_UPLOAD_REJECTED')
        }
        if (credentialUpdate.action === 'REPLACE') {
          const credentials = normalizePmsLoginCredentials(credentialUpdate)
          pmsLoginSecretsByHotel.set(
            hotelId,
            encryptCookie(
              JSON.stringify(credentials),
              cookieSecretKey,
              pmsLoginScope(hotelId),
            ),
          )
        } else if (credentialUpdate.action === 'CLEAR') {
          pmsLoginSecretsByHotel.delete(hotelId)
        }
        persistPmsLoginSecrets()
        json(response, 200, { data: pmsLoginConfigFor(hotelId) })
        return
      }
      if (request.method === 'GET' && suffix === '/business-day-control') {
        json(response, 200, {
          data: businessDayControlFor(hotelId),
        })
        return
      }
      if (request.method === 'POST' && suffix === '/business-day-control') {
        const body = await readBody(request)
        if (
          typeof body.businessDate !== 'string'
          || !/^\d{4}-\d{2}-\d{2}$/.test(body.businessDate)
          || typeof body.reasonCode !== 'string'
          || !/^[A-Z0-9][A-Z0-9_-]{1,63}$/.test(body.reasonCode)
        ) {
          throw new Error('BUSINESS_DAY_CONTROL_INVALID')
        }
        const control = {
          businessDate: body.businessDate,
          mode: 'PMS_CONFIRMED',
          source: 'MANUAL_SEED',
          businessDateStartedAt: null,
          updatedAt: new Date().toISOString(),
        }
        businessDayControlsByHotel.set(hotelId, control)
        persistBusinessDayControls()
        json(response, 200, { data: control })
        return
      }
      if (
        request.method === 'GET'
        && suffix === '/room-type-configuration'
      ) {
        json(response, 200, {
          data: roomTypeConfigurationFor(hotelId),
        })
        return
      }
      if (
        request.method === 'POST'
        && suffix === '/room-type-configuration'
      ) {
        const body = await readBody(request)
        if (
          !Number.isInteger(body.expectedRowVersion)
          || body.expectedRowVersion < 0
          || !Array.isArray(body.hotSellingRoomTypeCodes)
          || body.hotSellingRoomTypeCodes.length > 30
          || typeof body.reasonCode !== 'string'
          || !/^[A-Z0-9][A-Z0-9_-]{1,63}$/.test(body.reasonCode)
        ) {
          throw new Error('ROOM_TYPE_CONFIGURATION_INVALID')
        }
        const current = hotSellingRoomTypesFor(hotelId)
        if (body.expectedRowVersion !== current.rowVersion) {
          throw new Error('ROOM_TYPE_CONFIGURATION_VERSION_CONFLICT')
        }
        const latestSnapshot = latestPhysicalInventorySnapshotFor(hotelId)
        const knownCodes = new Set(
          (latestSnapshot?.physicalInventory ?? [])
            .map((room) => room.physicalRoomTypeCode),
        )
        const roomTypeCodes = [...new Set(body.hotSellingRoomTypeCodes)]
        if (roomTypeCodes.some((code) => (
          typeof code !== 'string' || !knownCodes.has(code)
        ))) {
          throw new Error('ROOM_TYPE_CONFIGURATION_INVALID')
        }
        const sourceCatalogs = otaRoomTypeCatalogsByHotel.get(hotelId) ?? {}
        const configuredSources = otaSourcesByHotel.get(hotelId) ?? []
        const sourceById = new Map(
          configuredSources.map((source) => [source.sourceId, source]),
        )
        const catalogsBySourceId = new Map(
          Object.entries(sourceCatalogs)
            .map(([sourceId, catalog]) => {
              const source = sourceById.get(sourceId)
              const matches = Boolean(
                source
                && otaRoomTypeCatalogMatchesSource(
                  hotelId,
                  catalog,
                  source,
                ),
              )
              return [sourceId, matches ? catalog.roomTypes ?? [] : []]
            }),
        )
        const mappings = validateRoomTypeMappings({
          input: body.mappings,
          knownPhysicalRoomTypeCodes: knownCodes,
          otaSources: configuredSources,
          catalogsBySourceId,
        })
        const config = {
          roomTypeCodes,
          mappings,
          rowVersion: current.rowVersion + 1,
          updatedAt: new Date().toISOString(),
        }
        commitHotSellingRoomTypes(hotelId, config)
        json(response, 200, {
          data: roomTypeConfigurationFor(hotelId),
        })
        return
      }
      if (request.method === 'GET' && suffix === '/hot-selling-room-types') {
        json(response, 200, {
          data: hotSellingRoomTypesFor(hotelId),
        })
        return
      }
      if (
        request.method === 'POST'
        && suffix === '/hot-selling-room-types'
      ) {
        const body = await readBody(request)
        if (
          !Array.isArray(body.roomTypeCodes)
          || body.roomTypeCodes.length > 30
          || !Number.isInteger(body.expectedRowVersion)
          || body.expectedRowVersion < 0
          || typeof body.reasonCode !== 'string'
          || !/^[A-Z0-9][A-Z0-9_-]{1,63}$/.test(body.reasonCode)
        ) {
          throw new Error('HOT_SELLING_ROOM_TYPES_INVALID')
        }
        const latestSnapshot = latestPhysicalInventorySnapshotFor(hotelId)
        const knownCodes = new Set(
          (latestSnapshot?.physicalInventory ?? [])
            .map((room) => room.physicalRoomTypeCode),
        )
        const roomTypeCodes = [...new Set(body.roomTypeCodes)]
        if (
          roomTypeCodes.some(
            (code) =>
              typeof code !== 'string'
              || !knownCodes.has(code),
          )
        ) {
          throw new Error('HOT_SELLING_ROOM_TYPES_INVALID')
        }
        const current = hotSellingRoomTypesFor(hotelId)
        if (body.expectedRowVersion !== current.rowVersion) {
          throw new Error('ROOM_TYPE_CONFIGURATION_VERSION_CONFLICT')
        }
        const config = {
          roomTypeCodes,
          mappings: current.mappings,
          rowVersion: current.rowVersion + 1,
          updatedAt: new Date().toISOString(),
        }
        commitHotSellingRoomTypes(hotelId, config)
        json(response, 200, { data: config })
        return
      }
      if (
        request.method === 'GET'
        && suffix === '/wecom-repair-bot-config'
      ) {
        json(response, 200, {
          data: weComRepairBotStatusForHotel(hotelId),
        })
        return
      }
      if (
        request.method === 'POST'
        && suffix === '/wecom-repair-bot-pairing'
      ) {
        const body = await readBody(request)
        if (
          body?.reasonCode !== 'START_WECOM_REPAIR_BOT_PAIRING'
          || Object.hasOwn(body ?? {}, 'hotelId')
        ) {
          throw new Error('WECOM_REPAIR_BOT_PAIRING_REQUEST_INVALID')
        }
        json(response, 201, {
          data: startWeComRepairBotPairing(hotelId),
        })
        return
      }
      if (request.method === 'GET' && suffix === '/wecom-config') {
        json(response, 200, { data: weComConfigFor(hotelId) })
        return
      }
      if (request.method === 'POST' && suffix === '/wecom-config') {
        const body = await readBody(request)
        const webhookUpdate =
          body.webhookUpdate ?? { action: 'KEEP' }
        if (
          typeof body.enabled !== 'boolean'
          || typeof body.reasonCode !== 'string'
          || !/^[A-Z0-9][A-Z0-9_-]{1,63}$/.test(body.reasonCode)
          || !webhookUpdate
          || typeof webhookUpdate !== 'object'
          || !['KEEP', 'CLEAR', 'REPLACE'].includes(webhookUpdate.action)
        ) {
          throw new Error('WECOM_CONFIG_INVALID')
        }
        let endpointSha256 =
          weComConfigsByHotel.get(hotelId)?.endpointSha256 ?? null
        if (webhookUpdate.action === 'REPLACE') {
          endpointSha256 = fingerprintWeComWebhook(webhookUpdate.value)
          weComSecretsByHotel.set(
            hotelId,
            encryptCookie(
              webhookUpdate.value,
              cookieSecretKey,
              weComSecretScope(hotelId),
            ),
          )
        } else if (webhookUpdate.action === 'CLEAR') {
          weComSecretsByHotel.delete(hotelId)
          endpointSha256 = null
        }
        const enabled =
          webhookUpdate.action === 'CLEAR' ? false : body.enabled
        if (enabled && !weComSecretsByHotel.has(hotelId)) {
          throw new Error('WECOM_WEBHOOK_REQUIRED')
        }
        weComConfigsByHotel.set(hotelId, {
          enabled,
          sendMinute: 6,
          endpointSha256,
          updatedAt: new Date().toISOString(),
        })
        persistWeComSecrets()
        persistWeComConfigs()
        json(response, 200, { data: weComConfigFor(hotelId) })
        return
      }
      if (
        request.method === 'POST'
        && suffix === '/wecom-manual-replay-deliveries'
      ) {
        const result = await runWeComManualReplay({
          hotelId,
          body: await readBody(request),
        })
        auditSecurityEvent({
          action: 'WECOM_MANUAL_REPLAY',
          outcome: result.failedTemplates.length > 0 ? 'BLOCKED' : 'SUCCEEDED',
          request,
          principal: requestPrincipal,
          hotelId,
          reasonCode:
            result.failedTemplates[0]?.reasonCode
            ?? 'MANUAL_REPLAY_LATEST_COMPLETE',
        })
        json(response, 200, { data: result })
        return
      }
      if (
        request.method === 'POST'
        && suffix === '/wecom-test-suite-deliveries'
      ) {
        const body = await readBody(request)
        if (
          typeof body.reasonCode !== 'string'
          || !/^[A-Z0-9][A-Z0-9_-]{1,63}$/.test(body.reasonCode)
        ) {
          throw new Error('REASON_CODE_INVALID')
        }
        const config = weComConfigFor(hotelId)
        if (!config.webhookConfigured) {
          throw new Error('WECOM_DELIVERY_NOT_CONFIGURED')
        }
        const collection = await collectLiveFor(hotelId)
        const snapshot = collection.snapshot
        const suiteId = randomUUID()
        const deliveries = []
        const failedTemplates = []
        const suitePlan = createWeComTestSuitePlan({
          hotelId,
          snapshot,
        })
        const deliverTemplate = async (templateCode, task) => {
          try {
            deliveries.push(await task())
          } catch (error) {
            failedTemplates.push({
              templateCode,
              reasonCode:
                typeof error?.message === 'string'
                  ? error.message
                  : 'WECOM_TEMPLATE_DELIVERY_FAILED',
            })
          }
        }

        for (const template of suitePlan.templates) {
          await deliverTemplate(template.templateCode, () =>
            deliverWeComSnapshot({
              hotelId,
              snapshot,
              messageKey:
                `${hotelId}:TEST_SUITE:${suiteId}:${template.templateCode}`,
              messagePrefix: template.messagePrefix,
              deliveryType: template.deliveryType,
              allowDisabled: true,
              payloadFactory: template.payloadFactory,
            }))
        }

        json(response, 200, {
          data: {
            collectionRun: {
              ...collection.run,
              monitor: collection.monitor,
            },
            requestedTemplateCount: suitePlan.requestedTemplateCount,
            deliveries,
            skippedTemplates: suitePlan.skippedTemplates,
            failedTemplates,
          },
        })
        return
      }
      if (
        request.method === 'POST'
        && suffix === '/wecom-test-deliveries'
      ) {
        const body = await readBody(request)
        if (
          typeof body.reasonCode !== 'string'
          || !/^[A-Z0-9][A-Z0-9_-]{1,63}$/.test(body.reasonCode)
        ) {
          throw new Error('REASON_CODE_INVALID')
        }
        const snapshot = (liveSnapshotStore[hotelId] ?? []).at(-1)
        if (!snapshot) throw new Error('LIVE_SNAPSHOT_REQUIRED')
        const delivery = await deliverWeComSnapshot({
          hotelId,
          snapshot,
          messageKey: `${hotelId}:TEST:${randomUUID()}`,
          messagePrefix: '手动通道测试',
          allowDisabled: true,
        })
        json(response, 200, { data: delivery })
        return
      }
      if (
        request.method === 'POST'
        && suffix === '/wecom-future-test-deliveries'
      ) {
        const body = await readBody(request)
        if (
          typeof body.reasonCode !== 'string'
          || !/^[A-Z0-9][A-Z0-9_-]{1,63}$/.test(body.reasonCode)
        ) {
          throw new Error('REASON_CODE_INVALID')
        }
        const snapshot = (liveSnapshotStore[hotelId] ?? []).at(-1)
        if (
          !snapshot
          || !Array.isArray(snapshot.futureBookingChanges?.daily)
        ) {
          throw new Error('FUTURE_BOOKING_SNAPSHOT_REQUIRED')
        }
        const delivery = await deliverWeComSnapshot({
          hotelId,
          snapshot,
          messageKey: `${hotelId}:FUTURE_TEST:${randomUUID()}`,
          deliveryType: 'FUTURE_14D_TEST',
          allowDisabled: true,
          payloadFactory: ({ hotel: selected, snapshot: current }) =>
            futureBookingPayloads({
              hotel: selected,
              snapshot: current,
              messagePrefix: '手动通道测试',
            }),
        })
        json(response, 200, { data: delivery })
        return
      }
      if (request.method === 'GET' && suffix === '/monitor') {
        json(response, 200, { data: liveMonitorFor(hotelId) })
        return
      }
      if (
        request.method === 'POST'
        && suffix === '/live-collection-runs'
      ) {
        await readBody(request)
        const result = await collectLiveFor(hotelId)
        json(response, 200, {
          data: {
            ...result.run,
            monitor: result.monitor,
            otaRefreshes: result.otaRefreshes,
          },
        })
        return
      }
      if (request.method === 'GET' && suffix === '/briefs') {
        const brief = briefFor(hotelId)
        json(response, 200, { data: brief ? [brief] : [] })
        return
      }
      if (request.method === 'GET' && suffix === '/incidents') {
        const monitor = liveMonitorFor(hotelId)
        const trustedDeviceStatus = trustedDeviceEligible(selected)
          ? trustedDeviceStoreFor(selected).status()
          : trustedDeviceNotApplicableStatus(selected)
        const pmsIncident = pmsRepairIncidentFor({
          hotel: selected,
          monitor,
          trustedDeviceStatus,
        })
        json(response, 200, { data: pmsIncident ? [pmsIncident] : [] })
        return
      }
      if (request.method === 'GET' && suffix === '/outbox-preview') {
        const deliveries = [...weComDeliveriesByKey.values()]
          .filter((delivery) => delivery.hotelId === hotelId)
          .sort((left, right) =>
            String(right.attemptedAt)
              .localeCompare(String(left.attemptedAt)))
          .slice(0, 20)
        json(response, 200, {
          data: deliveries.map((delivery) => ({
            eventId: delivery.deliveryId,
            messageKey: delivery.messageKey,
            messageType: delivery.deliveryType
              ?? (
                delivery.messageKey.includes(':TEST:')
                  ? 'WECOM_CHANNEL_TEST'
                  : 'HOURLY_REVENUE_BRIEF'
              ),
            createdAt: delivery.attemptedAt,
            deliveryBlocked: false,
            deliveryStatus: delivery.deliveryStatus,
            bodyPreview: delivery.bodyPreview,
          })),
        })
        return
      }
      if (request.method === 'GET' && suffix === '/connector-onboarding') {
        json(response, 200, { data: [] })
        return
      }
      if (
        request.method === 'GET'
        && suffix === '/connector-contract-admissions'
      ) {
        json(response, 200, { data: [] })
        return
      }
      if (
        request.method === 'GET'
        && suffix.includes('/browser-authorization-attempts')
      ) {
        json(response, 200, { data: null })
        return
      }
      if (
        request.method === 'POST'
        && suffix === '/simulation-runs'
      ) {
        const body = await readBody(request)
        const runId = randomUUID()
        const run = {
          runId,
          scenarioCode: body.scenarioCode ?? 'BASELINE',
          status: 'SUCCEEDED',
          fixedClockAt: '2026-07-25T18:00:00+08:00',
          scheduledFor: '2026-07-25T18:00:00+08:00',
          startedAt: new Date().toISOString(),
          completedAt: new Date().toISOString(),
          briefId: briefFor(hotelId).briefId,
          incidentIds: ['81000000-0000-4000-8000-000000000001'],
          rowVersion: 1,
        }
        simulationRuns.set(runId, run)
        json(response, 200, {
          data: {
            commandId: randomUUID(),
            resourceId: runId,
            resultingRowVersion: 1,
            replayed: false,
          },
        })
        return
      }
      const runMatch = suffix.match(/^\/simulation-runs\/([^/]+)$/)
      if (request.method === 'GET' && runMatch) {
        const run = simulationRuns.get(decodeURIComponent(runMatch[1]))
        if (!run) {
          json(response, 404, { code: 'REVIEW_RUN_NOT_FOUND' })
          return
        }
        json(response, 200, { data: run })
        return
      }
      if (request.method === 'POST') {
        await readBody(request)
        const resourceId =
          decodeURIComponent(suffix.split('/').filter(Boolean).at(-1) ?? '')
          || randomUUID()
        json(response, 200, {
          data: {
            commandId: randomUUID(),
            resourceId,
            resultingRowVersion: 2,
            replayed: false,
          },
        })
        return
      }
    }

    json(response, 404, { code: 'REVIEW_ROUTE_NOT_FOUND' })
  } catch (error) {
    const code =
      error instanceof SyntaxError
        ? 'REVIEW_REQUEST_JSON_INVALID'
        : error?.message === 'REQUEST_TOO_LARGE'
          ? 'REVIEW_REQUEST_TOO_LARGE'
          : error?.message === 'BUSINESS_DAY_UNCONFIRMED'
            ? 'BUSINESS_DAY_UNCONFIRMED'
            : error?.message === 'BUSINESS_DAY_CONTROL_INVALID'
              ? 'BUSINESS_DAY_CONTROL_INVALID'
           : error?.message === 'HOT_SELLING_ROOM_TYPES_INVALID'
                 ? 'HOT_SELLING_ROOM_TYPES_INVALID'
             : error?.message === 'HOT_SELLING_ROOM_TYPES_PERSIST_FAILED'
               ? 'HOT_SELLING_ROOM_TYPES_PERSIST_FAILED'
                : typeof error?.message === 'string'
                  && (
                    error.message.startsWith('SIMULATION_')
                    || error.message.startsWith('PMS_LOGIN_')
                    || error.message.startsWith('PMS_BUSINESS_DATE_')
                    || error.message.startsWith('REPORT_SOURCE_')
                    || error.message.startsWith('WECOM_')
                    || error.message.startsWith('LIVE_')
                    || error.message.startsWith('FUTURE_')
                    || error.message.startsWith('OTA_')
                    || error.message.startsWith('ROOM_TYPE_')
                    || error.message.startsWith('LUOPAN_')
                    || error.message.startsWith('BIEYANGHONG_')
                    || error.message.startsWith('TRUSTED_DEVICE_')
                    || error.message.startsWith('REVIEW_AUTH_')
                  )
                    ? error.message
           : 'REVIEW_API_FAILED_CLOSED'
    json(
      response,
      [
        'ROOM_TYPE_CONFIGURATION_VERSION_CONFLICT',
        'OTA_SOURCE_VERSION_CONFLICT',
        'OTA_SOURCE_CHANGED_DURING_REFRESH',
        'WECOM_MANUAL_REPLAY_AUTHORITATIVE_SNAPSHOT_REQUIRED',
        'WECOM_MANUAL_REPLAY_COMPLETE_SNAPSHOT_REQUIRED',
        'WECOM_MANUAL_REPLAY_LATEST_SNAPSHOT_CHANGED',
        'WECOM_MANUAL_REPLAY_SNAPSHOT_REQUIRED',
      ].includes(code)
        ? 409
        : code === 'HOT_SELLING_ROOM_TYPES_PERSIST_FAILED'
          ? 500
          : 400,
      { code },
    )
  }
})

const rejectBieyanghongVncUpgrade = (socket, status = '401 Unauthorized') => {
  if (!socket.destroyed) {
    socket.end(
      `HTTP/1.1 ${status}\r\nConnection: close\r\n`
      + `Content-Length: 0\r\nCache-Control: no-store\r\n\r\n`,
    )
  }
}

const bieyanghongVncUpgradeOriginValid = (request) => {
  if (!bieyanghongRepairPublicBaseUrl) return false
  try {
    const expected = new URL(bieyanghongRepairPublicBaseUrl)
    const origin = new URL(String(request.headers.origin ?? ''))
    const hostHeader = String(request.headers.host ?? '').toLowerCase()
    return origin.origin === expected.origin
      && hostHeader === expected.host.toLowerCase()
  } catch {
    return false
  }
}

server.on('upgrade', (request, socket, head) => {
  let url
  try {
    url = new URL(request.url ?? '/', `http://${host}:${port}`)
  } catch {
    rejectBieyanghongVncUpgrade(socket, '400 Bad Request')
    return
  }
  if (
    url.pathname !== BIEYANGHONG_VNC_COOKIE_PATH
    || url.search
    || !bieyanghongVncUpgradeOriginValid(request)
  ) {
    rejectBieyanghongVncUpgrade(socket, '404 Not Found')
    return
  }
  const websocketKey = String(request.headers['sec-websocket-key'] ?? '')
  const websocketVersion = String(
    request.headers['sec-websocket-version'] ?? '',
  )
  const protocol = String(request.headers['sec-websocket-protocol'] ?? '')
  let decodedKey = null
  try {
    decodedKey = Buffer.from(websocketKey, 'base64')
  } catch {
    decodedKey = null
  }
  if (
    request.method !== 'GET'
    || String(request.headers.upgrade ?? '').toLowerCase() !== 'websocket'
    || !String(request.headers.connection ?? '').toLowerCase()
      .split(',')
      .map((value) => value.trim())
      .includes('upgrade')
    || websocketVersion !== '13'
    || decodedKey?.length !== 16
    || websocketKey.length > 64
    || (
      protocol
      && !['binary', 'base64'].includes(protocol)
    )
  ) {
    rejectBieyanghongVncUpgrade(socket, '400 Bad Request')
    return
  }
  let match
  try {
    match = bieyanghongVncHandleForRequest(request)
  } catch {
    rejectBieyanghongVncUpgrade(socket)
    return
  }
  const { handle } = match
  if (handle.vncViewerConnected || handle.vncSocket) {
    rejectBieyanghongVncUpgrade(socket, '409 Conflict')
    return
  }
  if (handle.vncConnectionsUsed >= 3) {
    rejectBieyanghongVncUpgrade(socket, '429 Too Many Requests')
    return
  }
  const targetPort = handle.login.remoteDesktop.webSocketPort
  const expectedTargetPort = Number.parseInt(
    String(bieyanghongRemoteDesktopConfig.webSocketPort ?? ''),
    10,
  )
  const upstreamAuthorization =
    handle.login.remoteDesktop.webSocketAuthorization
  if (
    !Number.isInteger(targetPort)
    || targetPort !== expectedTargetPort
    || targetPort < 1024
    || targetPort > 65535
    || typeof upstreamAuthorization !== 'string'
    || !/^Basic [A-Za-z0-9+/]{40,256}={0,2}$/u.test(upstreamAuthorization)
  ) {
    rejectBieyanghongVncUpgrade(socket)
    return
  }

  handle.vncViewerConnected = true
  handle.vncConnectionsUsed += 1
  handle.vncSocket = socket
  socket.pause()
  const upstream = createConnection({ host: '127.0.0.1', port: targetPort })
  let released = false
  let upstreamConnected = false
  const release = () => {
    if (released) return
    released = true
    upstream.destroy()
    releaseBieyanghongVncViewer(handle, socket)
  }
  socket.once('error', release)
  socket.once('close', release)
  upstream.once('error', () => {
    if (!upstreamConnected && !socket.destroyed) {
      rejectBieyanghongVncUpgrade(socket, '502 Bad Gateway')
    }
    release()
  })
  upstream.setTimeout(5_000, () => {
    if (!socket.destroyed) {
      rejectBieyanghongVncUpgrade(socket, '504 Gateway Timeout')
    }
    release()
  })
  upstream.once('connect', () => {
    upstreamConnected = true
    upstream.setTimeout(0)
    const lines = [
      'GET /websockify HTTP/1.1',
      `Host: 127.0.0.1:${targetPort}`,
      'Upgrade: websocket',
      'Connection: Upgrade',
      `Sec-WebSocket-Key: ${websocketKey}`,
      'Sec-WebSocket-Version: 13',
      `Authorization: ${upstreamAuthorization}`,
    ]
    if (protocol) lines.push(`Sec-WebSocket-Protocol: ${protocol}`)
    upstream.write(`${lines.join('\r\n')}\r\n\r\n`)
    if (head?.length) upstream.write(head)
    socket.pipe(upstream)
    upstream.pipe(socket)
    socket.resume()
  })
})

server.listen(port, host, () => {
  process.stdout.write(
    `${JSON.stringify({
      status: 'READY',
      mode: runtimeMode,
      url: `http://${host}:${port}`,
    })}\n`,
  )
  const scheduler = setInterval(() => {
    void scheduledLuopanRecoveryTick()
    void scheduledCollectionTick()
    void scheduledOtaSourceTick()
    void scheduledWeComDeliveryTick()
    void scheduledFutureBookingDeliveryTick()
    void scheduledHotSellingSoldOutDeliveryTick()
    void scheduledBriefingAuditTick()
    void scheduledPmsRepairAlertTick()
  }, 30_000)
  scheduler.unref()
  const initialScheduler = setTimeout(() => {
    void scheduledLuopanRecoveryTick()
    void scheduledCollectionTick()
    void scheduledWeComDeliveryTick()
    void scheduledFutureBookingDeliveryTick()
    void scheduledHotSellingSoldOutDeliveryTick()
    void scheduledBriefingAuditTick()
    void scheduledPmsRepairAlertTick()
  }, 2_000)
  initialScheduler.unref()
})

let shuttingDown = false
const shutdown = async () => {
  if (shuttingDown) return
  shuttingDown = true
  weComRepairBotRuntime?.disconnect()
  const closeOperations = []
  for (const handle of activeLuopanRepairsByHotel.values()) {
    closeOperations.push(handle.login?.close().catch(() => {}))
  }
  for (const handle of activeBieyanghongRepairsByHotel.values()) {
    revokeBieyanghongVncSession(handle)
    closeOperations.push(handle.login?.close().catch(() => {}))
  }
  await Promise.allSettled(closeOperations.filter(Boolean))
  server.close(() => process.exit(0))
  setTimeout(() => process.exit(0), 2_000).unref()
}

process.once('SIGINT', () => { void shutdown() })
process.once('SIGTERM', () => { void shutdown() })
