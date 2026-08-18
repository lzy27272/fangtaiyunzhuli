#!/usr/bin/env node

import { createServer } from 'node:http'
import { randomUUID } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join } from 'node:path'
import {
  decryptCookie,
  encryptCookie,
} from './report-source-cookie-crypto.mjs'
import { createReviewAuthStore } from './review-auth-store.mjs'
import { collectOtaSource } from './ota-source-collector.mjs'
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
import {
  appendAndPersistSnapshot,
  collectLiveReports,
  loadSnapshotStore,
  monitorFromSnapshot,
} from './live-report-collector.mjs'
import {
  briefingCycleSnapshots,
  briefingSnapshotsObservedAfter,
  collectionSlotFor,
  isBriefDeliveryTime,
  isBroadcastWindowOpen,
  shanghaiScheduleParts,
} from './report-schedule.mjs'
import { selectHourlyDeliveryCandidates } from './wecom/src/hourly-delivery-candidates.mjs'
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
  auditLuopanBriefingStore,
  dailyBriefingAuditSlot,
} from './wecom/src/briefing-delivery-audit.mjs'
import {
  createWeComRepairBotPairingStore,
  createWeComRepairBotRuntime,
  deliverWeComRepairBotToAllowedUsers,
  fingerprintWeComRepairBotValue,
  normalizeWeComRepairBotCredentials,
  parseWeComRepairBotText,
  WECOM_REPAIR_BOT_MAX_ALLOWED_USERS,
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
const liveSnapshotPath = dataPath
  ? join(dirname(dataPath), 'live-report-snapshots.json')
  : null
const businessDayControlPath = dataPath
  ? join(dirname(dataPath), 'business-day-controls.json')
  : null
const hotSellingRoomTypePath = dataPath
  ? join(dirname(dataPath), 'hot-selling-room-types.json')
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
const weComConfigPath = dataPath
  ? join(dirname(dataPath), 'wecom-configs.json')
  : null
const weComSecretPath = dataPath
  ? join(dirname(dataPath), 'wecom-webhook-secrets.json')
  : null
const weComDeliveryPath = dataPath
  ? join(dirname(dataPath), 'wecom-deliveries.json')
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

if (
  !Number.isInteger(port)
  || port < 1024
  || port > 65535
  || !bootstrapUsername
  || !bootstrapPassword
  || !bootstrapAccessToken
  || !authStatePath
  || !cookieSecretsPath
  || !cookieSecretKey
) {
  process.stderr.write('REVIEW_API_CONFIGURATION_INVALID\n')
  process.exit(2)
}

const authStore = createReviewAuthStore({
  statePath: authStatePath,
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
    pmsSystemCode: 'MEITUAN_BIEYANGHONG',
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
    pmsSystemCode: 'LUOPAN_CLOUD',
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
const liveSnapshotStore = loadSnapshotStore(liveSnapshotPath)
const businessDayControlsByHotel = new Map()
const hotSellingRoomTypesByHotel = new Map()
const weComConfigsByHotel = new Map()
const weComSecretsByHotel = new Map()
const weComDeliveriesByKey = new Map()
const weComDeliveryLocks = new Map()
const futureDemandRiskStates = {}
const lastScheduledCollectionSlotByHotel = new Map()
const luopanRepairChallengeStore = createLuopanRepairChallengeStore()
const activeLuopanRepairsByHotel = new Map()
const weComRepairBotPairingStore = createWeComRepairBotPairingStore()
const seenWeComRepairBotMessageHashes = new Map()
let weComRepairBotConfig = {
  enabled: false,
  botIdSha256: null,
  allowedUserIdSha256: null,
  allowedUserIdSha256s: [],
  updatedAt: null,
}
let weComRepairBotCredentials = null
let weComRepairBotRuntime = null
const lastDailyBriefingAuditKeyByHotel = new Map()
const schedulerStartedAt = new Date()
const REPORT_POLL_INTERVAL_MINUTES = 30
const WECOM_DELIVERY_RETENTION_LIMIT = 5_000

const SIMULATION_HOTEL_CODE = /^[A-Z0-9][A-Z0-9_-]{0,15}$/
const SIMULATION_HOTEL_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const PMS_SYSTEM_CODES = new Set([
  'MEITUAN_BIEYANGHONG',
  'LUOPAN_CLOUD',
])

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
  if (
    !SIMULATION_HOTEL_ID.test(candidate.tenantId)
    || !SIMULATION_HOTEL_ID.test(candidate.hotelId)
    || !SIMULATION_HOTEL_CODE.test(tenantCode)
    || !SIMULATION_HOTEL_CODE.test(hotelCode)
    || tenantName.length < 1
    || tenantName.length > 80
    || hotelName.length < 1
    || hotelName.length > 80
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
    pmsSystemCode,
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
    : ''
  const hotelCode = typeof body.hotelCode === 'string'
    ? body.hotelCode.trim().toUpperCase()
    : ''
  const tenantName = typeof body.tenantDisplayName === 'string'
    ? body.tenantDisplayName.trim()
    : ''
  const hotelName = typeof body.hotelDisplayName === 'string'
    ? body.hotelDisplayName.trim()
    : ''
  const timezone = typeof body.timezone === 'string'
    ? body.timezone.trim()
    : ''
  const pmsSystemCode = PMS_SYSTEM_CODES.has(body.pmsSystemCode)
    ? body.pmsSystemCode
    : null
  if (
    !SIMULATION_HOTEL_CODE.test(tenantCode)
    || !SIMULATION_HOTEL_CODE.test(hotelCode)
    || tenantName.length < 1
    || tenantName.length > 80
    || hotelName.length < 1
    || hotelName.length > 80
    || typeof body.reasonCode !== 'string'
    || !/^[A-Z0-9][A-Z0-9_-]{1,63}$/.test(body.reasonCode)
    || !pmsSystemCode
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
    pmsSystemCode,
    pmsCredentials,
    timezone,
  }
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
    displayName: '房费收入/ADR报表 jy09',
    endpointUrl: 'https://pms.meituan.com/hotelpms/api/v2/report/jy09',
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
  return {
    configured: Boolean(record),
    updatedAt: record?.updatedAt ?? null,
    loginMode: 'CONTROLLED_BROWSER',
    loginExecutionEnabled: false,
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
    const previous = previousById.get(source.sourceId)
    const lastState = persisted ? source : previous
    const pollIntervalMinutes =
      persisted && source.pollIntervalPolicyVersion !== 1
        ? OTA_DEFAULT_POLL_INTERVAL_MINUTES
        : source.pollIntervalMinutes
    return {
      sourceId: source.sourceId,
      displayName: source.displayName.trim(),
      platformCode: source.platformCode,
      portalUrl: normalizeOptionalOtaUrl(source.portalUrl),
      dataEndpointUrl: normalizeOptionalOtaUrl(source.dataEndpointUrl),
      requestMethod: source.requestMethod,
      requestPayloadJson:
        requestPayload === null ? '' : JSON.stringify(requestPayload),
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
      rowVersion: persisted ? source.rowVersion : source.rowVersion + 1,
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
              && /^[A-Za-z0-9-]{3,80}$/.test(code),
          ),
        ),
      ].slice(0, 30)
      hotSellingRoomTypesByHotel.set(hotelId, {
        roomTypeCodes,
        updatedAt:
          typeof config.updatedAt === 'string' ? config.updatedAt : null,
      })
    }
  } catch {
    process.stderr.write('REVIEW_HOT_ROOM_STORE_IGNORED\n')
  }
}

const hotSellingRoomTypesFor = (hotelId) =>
  hotSellingRoomTypesByHotel.get(hotelId) ?? {
    roomTypeCodes: [],
    updatedAt: null,
  }

const persistHotSellingRoomTypes = () => {
  if (!hotSellingRoomTypePath) return
  mkdirSync(dirname(hotSellingRoomTypePath), { recursive: true })
  const temporaryPath = `${hotSellingRoomTypePath}.${process.pid}.tmp`
  writeFileSync(
    temporaryPath,
    `${JSON.stringify(
      Object.fromEntries(hotSellingRoomTypesByHotel),
      null,
      2,
    )}\n`,
    { encoding: 'utf8', mode: 0o600 },
  )
  renameSync(temporaryPath, hotSellingRoomTypePath)
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

const weComRepairBotSecretScope = () => 'wecom-repair-bot:v1'
const SHA256_PATTERN = /^[a-f0-9]{64}$/iu

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
  return {
    enabled: weComRepairBotConfig.enabled === true,
    credentialConfigured: Boolean(weComRepairBotCredentials),
    paired: allowedUserIds.length > 0,
    pairedUserCount: allowedUserIds.length,
    pairedUserCapacity: WECOM_REPAIR_BOT_MAX_ALLOWED_USERS,
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
    weComRepairBotConfig = {
      enabled: persisted.enabled === true,
      botIdSha256:
        SHA256_PATTERN.test(String(persisted.botIdSha256 ?? ''))
          ? String(persisted.botIdSha256).toLowerCase()
          : null,
      allowedUserIdSha256: allowedUserIdSha256s[0] ?? null,
      allowedUserIdSha256s,
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
    if (
      (weComRepairBotConfig.botIdSha256
        && weComRepairBotConfig.botIdSha256 !== botIdSha256)
      || (weComRepairBotConfig.allowedUserIdSha256s.length > 0
        && JSON.stringify(weComRepairBotConfig.allowedUserIdSha256s)
          !== JSON.stringify(allowedUserIdSha256s))
    ) {
      throw new Error('WECOM_REPAIR_BOT_SECRET_FINGERPRINT_MISMATCH')
    }
    weComRepairBotCredentials = credentials
    weComRepairBotConfig = {
      ...weComRepairBotConfig,
      botIdSha256,
      allowedUserIdSha256,
      allowedUserIdSha256s,
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
  if (credentialUpdate.action === 'REPLACE') {
    const candidateBotId = String(credentialUpdate.botId ?? '').trim()
    const candidateBotIdSha256 = fingerprintWeComRepairBotValue(candidateBotId)
    const preservePairing =
      candidateBotIdSha256 === weComRepairBotConfig.botIdSha256
        ? weComRepairBotCredentials?.allowedUserIds ?? []
        : []
    nextCredentials = normalizeWeComRepairBotCredentials({
      botId: candidateBotId,
      secret: credentialUpdate.secret,
      allowedUserIds: preservePairing,
    })
    nextBotIdSha256 = candidateBotIdSha256
    nextAllowedUserIdSha256s = preservePairing
      .map(fingerprintWeComRepairBotValue)
    nextAllowedUserIdSha256 = nextAllowedUserIdSha256s[0] ?? null
    if (preservePairing.length === 0) weComRepairBotPairingStore.clear()
  } else if (credentialUpdate.action === 'CLEAR') {
    nextCredentials = null
    nextBotIdSha256 = null
    nextAllowedUserIdSha256 = null
    nextAllowedUserIdSha256s = []
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

const startWeComRepairBotPairing = () => {
  const status = weComRepairBotStatus()
  if (
    !status.enabled
    || !status.credentialConfigured
    || status.connectionStatus !== 'AUTHENTICATED'
    || !status.connected
  ) {
    throw new Error('WECOM_REPAIR_BOT_NOT_CONNECTED')
  }
  if (status.pairedUserCount >= WECOM_REPAIR_BOT_MAX_ALLOWED_USERS) {
    throw new Error('WECOM_REPAIR_BOT_PAIRING_LIMIT_REACHED')
  }
  return weComRepairBotPairingStore.start()
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

const json = (response, status, body) => {
  const content = JSON.stringify(body)
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(content),
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'x-ota-review-mode': 'local-live-pilot',
  })
  response.end(content)
}

const empty = (response, status = 204) => {
  response.writeHead(status, {
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'x-ota-review-mode': 'local-live-pilot',
  })
  response.end()
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
      const collectSource = async (candidateSource) => collectOtaSource({
        source: candidateSource,
        cookie: otaSecretValuesFor(hotelId, sourceId).cookie,
        businessDate: (liveSnapshotStore[hotelId] ?? []).at(-1)
          ?.businessDate,
        validStayedOrderCountThroughPreviousBusinessDate: null,
      })
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
      const updated = {
        ...source,
        lastRefreshStatus: 'COMPLETE',
        lastRefreshAt: summary.observedAt,
        lastErrorCode: null,
        lastSummary: summary,
      }
      sources[sourceIndex] = updated
      const pairedSources = pairOtaReviewAndOrderSources(sources)
      otaSourcesByHotel.set(hotelId, pairedSources)
      persistOtaSources()
      return decorateOtaSources(hotelId, [
        pairedSources.find((candidate) => candidate.sourceId === sourceId)
          ?? updated,
      ])[0]
    } catch (error) {
      const errorCode = safeOtaRefreshErrorCode(error)
      const updated = {
        ...source,
        lastRefreshStatus: 'FAILED',
        lastRefreshAt: new Date().toISOString(),
        lastErrorCode: errorCode,
        lastSummary: null,
      }
      sources[sourceIndex] = updated
      const pairedSources = pairOtaReviewAndOrderSources(sources)
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
    if (errorCode === 'LUOPAN_REAUTH_REQUIRED') {
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
  const running = liveCollectionLocks.get(hotelId)
  if (running) return running

  const operation = (async () => {
    const luopanConfig = luopanBrowserConfigRecordFor(hotelId)
    if (luopanConfig.enabled) {
      return collectLuopanLiveFor(
        hotelId,
        luopanConfig,
        { otaRefreshDueOnly },
      )
    }
    const hotel = selectedHotel(hotelId)
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
      secretKey: cookieSecretKey,
      target: null,
      hotSellingRoomTypeCodes:
        hotSellingRoomTypesFor(hotelId).roomTypeCodes,
      reportDate: businessDayControl.businessDate,
    })
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
  })()
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
            mentioned_list: ['@all'],
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
    const allowedUserIds = weComRepairBotCredentials?.allowedUserIds ?? []
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
    const normalizedSession = normalizeLuopanSessionState(sessionState)
    const validation = await validateLuopanBrowserSession({
      profileRef: config.profileRef,
      expectedHotelFingerprint: config.expectedHotelFingerprint,
      sessionState: normalizedSession,
    })
    if (validation.scopeStatus !== 'SINGLE_HOTEL_CONFIRMED') {
      throw new Error('LUOPAN_STORE_SCOPE_INVALID')
    }
    luopanSessionStatesByHotel.set(hotelId, normalizedSession)
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
    const delivery = repairChannel === 'WECOM_LONG_CONNECTION'
      ? await deliverWeComRepairBotDirectMessage({
        hotelId,
        messageKey:
          `${hotelId}:LUOPAN_REPAIR_REQUIRED:${created.record.challengeId}`,
        deliveryType: 'LUOPAN_REPAIR_REQUIRED',
        captcha: handle.login.captcha,
        content: [
          '### 罗盘简报需要人工验证码',
          `门店：${hotel.hotelCode} · ${hotel.hotelName}`,
          '请查看上方验证码图片，并直接回复：',
          `**${hotel.hotelCode} 验证码**`,
          '有效期10分钟，最多提交3次。',
        ].join('\n'),
      })
      : await deliverWeComAuditNotice({
        hotelId,
        messageKey:
          `${hotelId}:LUOPAN_REPAIR_REQUIRED:${created.record.challengeId}`,
        deliveryType: 'LUOPAN_REPAIR_REQUIRED',
        content: [
          '【罗盘简报需要人工验证码】',
          `门店：${hotel.hotelCode} · ${hotel.hotelName}`,
          '原因：罗盘登录会话已失效，自动简报已暂停。',
          '处理：点击下方链接，在企业微信内填写验证码。',
          '有效期：10分钟，最多提交3次。',
          luopanRepairLink(luopanRepairPublicBaseUrl, created.token),
        ].join('\n'),
        bodyPreview:
          `罗盘简报需要人工验证码 · ${hotel.hotelCode} · 安全链接已隐藏`,
      })
    if (delivery.deliveredPartCount < 1) {
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
  void (async () => {
    let answer = submitted.answer
    try {
      const result = await handle.login.submit(answer)
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

const handleWeComRepairBotText = async (frame, replyText) => {
  const body = frame?.body
  const userId = typeof body?.from?.userid === 'string'
    ? body.from.userid.trim()
    : ''
  if (body?.chattype !== 'single' || !userId) {
    await replyText(frame, '请在与机器人的单聊中完成验证码修复。')
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
      const existingAllowedUserIds =
        weComRepairBotCredentials.allowedUserIds
      const allowedUserIds = existingAllowedUserIds.includes(pairing.userId)
        ? existingAllowedUserIds
        : [...existingAllowedUserIds, pairing.userId]
      if (allowedUserIds.length > WECOM_REPAIR_BOT_MAX_ALLOWED_USERS) {
        throw new Error('WECOM_REPAIR_BOT_PAIRING_LIMIT_REACHED')
      }
      weComRepairBotCredentials = normalizeWeComRepairBotCredentials({
        ...weComRepairBotCredentials,
        allowedUserIds,
      })
      const allowedUserIdSha256s = weComRepairBotCredentials.allowedUserIds
        .map(fingerprintWeComRepairBotValue)
      weComRepairBotConfig = {
        ...weComRepairBotConfig,
        allowedUserIdSha256: allowedUserIdSha256s[0] ?? null,
        allowedUserIdSha256s,
        updatedAt: new Date().toISOString(),
      }
      persistWeComRepairBotSecret()
      persistWeComRepairBotConfig()
      await replyText(
        frame,
        `绑定成功。当前已授权${allowedUserIds.length}/2人，两人都会同时收到验证码。`,
      )
    } catch (error) {
      await replyText(
        frame,
        error?.message === 'WECOM_REPAIR_BOT_PAIRING_LIMIT_REACHED'
          ? '已绑定2人，不能再添加其他账号。'
          : '配对码无效或已过期，请在后台重新生成。',
      )
    }
    return
  }

  const allowedUserIds = weComRepairBotCredentials?.allowedUserIds ?? []
  if (!allowedUserIds.includes(userId)) {
    await replyText(frame, '当前账号未获授权，请先使用后台配对码完成绑定。')
    return
  }

  if (command.type === 'HELP') {
    const pendingCodes = [...activeLuopanRepairsByHotel.values()]
      .filter((handle) => handle.channel === 'WECOM_LONG_CONNECTION')
      .map((handle) => selectedHotel(handle.hotelId).hotelCode)
      .sort()
    await replyText(
      frame,
      pendingCodes.length > 0
        ? `已安全连接。待处理门店：${pendingCodes.join('、')}。请发送“门店编号 验证码”。`
        : '已安全连接，目前没有等待填写验证码的门店。',
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
    '仅支持“门店编号 验证码”，例如：014 5dm8；可发送“状态”查看待处理门店。',
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
}

const scheduledBriefingAuditTick = async () => {
  await expireLuopanRepairSessions()
  if (!luopanAssistedRepairReady()) return
  const now = new Date()
  const slot = dailyBriefingAuditSlot(now)
  if (!slot) return
  for (const hotel of hotels.filter(
    (item) => item.pmsSystemCode === 'LUOPAN_CLOUD',
  )) {
    if (
      lastDailyBriefingAuditKeyByHotel.get(hotel.hotelId)
      === slot.auditKey
    ) {
      continue
    }
    lastDailyBriefingAuditKeyByHotel.set(hotel.hotelId, slot.auditKey)
    const audit = auditLuopanBriefingStore({
      hotel,
      luopanConfig: luopanBrowserConfigRecordFor(hotel.hotelId),
      snapshots: liveSnapshotStore[hotel.hotelId] ?? [],
      deliveries: [...weComDeliveriesByKey.values()],
      date: now,
    })
    if (audit.status === 'REAUTH_REQUIRED') {
      await startLuopanRepairChallenge(hotel.hotelId, 'DAILY_08_15_AUDIT')
      continue
    }
    if (
      audit.status === 'COLLECTION_MISSING'
      || audit.status === 'DELIVERY_MISSING'
    ) {
      await deliverWeComAuditNotice({
        hotelId: hotel.hotelId,
        messageKey:
          `${hotel.hotelId}:DAILY_BRIEFING_AUDIT:${slot.auditKey}`,
        deliveryType: 'DAILY_BRIEFING_AUDIT_ALERT',
        content: [
          '【罗盘每日简报审核异常】',
          `门店：${hotel.hotelCode} · ${hotel.hotelName}`,
          `状态码：${audit.status}`,
          '本异常不是验证码问题，系统未启动登录操作。',
        ].join('\n'),
        bodyPreview:
          `罗盘每日简报审核异常 · ${hotel.hotelCode} · ${audit.status}`,
      }).catch(() => {})
    }
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
              { messagePrefix },
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

const requireAuth = (request, response) => {
  const authorization = request.headers.authorization ?? ''
  const token = authorization.startsWith('Bearer ')
    ? authorization.slice('Bearer '.length)
    : ''
  if (!authStore.authenticate(token)) {
    json(response, 401, { code: 'REVIEW_SESSION_REQUIRED' })
    return false
  }
  return true
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
          weComRepairBot: weComRepairBotStatus(),
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

    if (request.method === 'POST' && path === '/api/v1/auth/login') {
      const body = await readBody(request)
      const authSession = authStore.login(
        String(body.username ?? ''),
        String(body.password ?? ''),
      )
      if (!authSession) {
        json(response, 401, { code: 'REVIEW_LOGIN_FAILED' })
        return
      }
      json(response, 200, {
        ...authSession,
        account: {
          id: '90000000-0000-4000-8000-000000000001',
          displayName: '本机评审管理员',
          roles: [
            'PLATFORM_ADMIN',
            'OTA_OPERATION_MANAGER',
            'CEO',
            'REGIONAL_MANAGER',
            'REVENUE_MANAGER',
          ],
        },
      })
      return
    }

    if (
      request.method === 'POST'
      && path === '/api/v1/auth/credentials'
    ) {
      if (!requireAuth(request, response)) return
      const body = await readBody(request)
      try {
        const authSession = authStore.changeCredentials({
          currentPassword: String(body.currentPassword ?? ''),
          newUsername: String(body.newUsername ?? ''),
          newPassword: String(body.newPassword ?? ''),
        })
        json(response, 200, {
          ...authSession,
          account: {
            id: '90000000-0000-4000-8000-000000000001',
            displayName: '\u672c\u673a\u8bc4\u5ba1\u7ba1\u7406\u5458',
            roles: [
              'PLATFORM_ADMIN',
              'OTA_OPERATION_MANAGER',
              'CEO',
              'REGIONAL_MANAGER',
              'REVENUE_MANAGER',
            ],
          },
        })
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

    if (request.method === 'POST' && path === '/api/v1/auth/logout') {
      empty(response)
      return
    }

    if (path.startsWith('/api/v1/ota/') && !requireAuth(request, response)) {
      return
    }

    if (
      request.method === 'GET'
      && path === '/api/v1/ota/wecom-repair-bot-config'
    ) {
      json(response, 200, { data: weComRepairBotStatus() })
      return
    }

    if (
      request.method === 'POST'
      && path === '/api/v1/ota/wecom-repair-bot-config'
    ) {
      const status = applyWeComRepairBotConfigUpdate(await readBody(request))
      json(response, 200, { data: status })
      return
    }

    if (
      request.method === 'POST'
      && path === '/api/v1/ota/wecom-repair-bot-pairing'
    ) {
      const body = await readBody(request)
      if (
        body?.reasonCode !== 'START_WECOM_REPAIR_BOT_PAIRING'
      ) {
        throw new Error('WECOM_REPAIR_BOT_PAIRING_REQUEST_INVALID')
      }
      json(response, 201, { data: startWeComRepairBotPairing() })
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
      json(response, 200, {
        data: { coverage: 'LOCAL_REVIEW', hotels, failedTenantIds: [] },
      })
      return
    }
    if (
      request.method === 'POST'
      && path === '/api/v1/ota/simulation/hotels'
    ) {
      const input = normalizeSimulationHotelInput(await readBody(request))
      if (!input) throw new Error('SIMULATION_HOTEL_INVALID')
      const tenant = hotels.find(
        (hotel) => hotel.tenantCode === input.tenantCode,
      )
      if (tenant && tenant.tenantName !== input.tenantName) {
        throw new Error('SIMULATION_TENANT_NAME_CONFLICT')
      }
      const existing = hotels.find(
        (hotel) =>
          hotel.tenantCode === input.tenantCode
          && hotel.hotelCode === input.hotelCode,
      )
      if (existing) {
        if (
          existing.hotelName !== input.hotelName
          || existing.timezone !== input.timezone
          || existing.pmsSystemCode !== input.pmsSystemCode
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
        tenantCode: input.tenantCode,
        tenantName: input.tenantName,
        hotelCode: input.hotelCode,
        hotelName: input.hotelName,
        pmsSystemCode: input.pmsSystemCode,
        timezone: input.timezone,
        lifecycleStatus: 'PILOT',
        collectionEnabled: true,
        messageEnabled: false,
        configuredMockConnectors: 2,
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
      ) {
        json(response, 404, { code: 'REVIEW_HOTEL_NOT_FOUND' })
        return
      }

      if (request.method === 'GET' && suffix === '/configuration') {
        json(response, 200, { data: configurationFor(hotelId) })
        return
      }
      if (request.method === 'GET' && suffix === '/report-sources') {
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
        json(response, 200, {
          data: decorateOtaSources(
            hotelId,
            otaSourcesByHotel.get(hotelId) ?? [],
          ),
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
        const normalized = normalizeOtaSources(
          body.sources,
          otaSourcesByHotel.get(hotelId) ?? [],
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
        json(response, 200, {
          data: luopanBrowserConfigFor(hotelId),
        })
        return
      }
      if (
        request.method === 'POST'
        && suffix === '/luopan-browser-config'
      ) {
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
            data: luopanBrowserConfigFor(hotelId),
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
          || typeof body.reasonCode !== 'string'
          || !/^[A-Z0-9][A-Z0-9_-]{1,63}$/.test(body.reasonCode)
        ) {
          throw new Error('HOT_SELLING_ROOM_TYPES_INVALID')
        }
        const latestSnapshot =
          (liveSnapshotStore[hotelId] ?? []).at(-1) ?? null
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
        const config = {
          roomTypeCodes,
          updatedAt: new Date().toISOString(),
        }
        hotSellingRoomTypesByHotel.set(hotelId, config)
        persistHotSellingRoomTypes()
        json(response, 200, { data: config })
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
        json(response, 200, { data: [] })
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
                    || error.message.startsWith('LUOPAN_')
                  )
                    ? error.message
           : 'REVIEW_API_FAILED_CLOSED'
    json(response, 400, { code })
  }
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
    void scheduledCollectionTick()
    void scheduledOtaSourceTick()
    void scheduledWeComDeliveryTick()
    void scheduledFutureBookingDeliveryTick()
    void scheduledHotSellingSoldOutDeliveryTick()
    void scheduledBriefingAuditTick()
  }, 30_000)
  scheduler.unref()
  const initialScheduler = setTimeout(() => {
    void scheduledCollectionTick()
    void scheduledWeComDeliveryTick()
    void scheduledFutureBookingDeliveryTick()
    void scheduledHotSellingSoldOutDeliveryTick()
    void scheduledBriefingAuditTick()
  }, 2_000)
  initialScheduler.unref()
})

const shutdown = () => {
  weComRepairBotRuntime?.disconnect()
  server.close(() => process.exit(0))
  setTimeout(() => process.exit(0), 2_000).unref()
}

process.once('SIGINT', shutdown)
process.once('SIGTERM', shutdown)
