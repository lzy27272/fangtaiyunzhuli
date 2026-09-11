#!/usr/bin/env node
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { isDeepStrictEqual } from 'node:util'

import { decryptCookie } from '../../../tools/uat/report-source-cookie-crypto.mjs'

const REPORT_POLL_INTERVAL_MINUTES = 60
const MIGRATION_TRIGGER = 'STARTUP_SOURCE_CONTRACT_MIGRATION'
const HOTEL_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu
const HOTEL_CODE = /^[A-Z0-9][A-Z0-9_-]{0,15}$/u
const STATUS_STATES = new Set([
  'IDLE',
  'RUNNING',
  'SUCCEEDED',
  'HUMAN_AUTHORIZATION_REQUIRED',
  'FAILED',
])
const PMS_SYSTEM_CODES = new Set([
  'MEITUAN_BIEYANGHONG',
  'LUOPAN_CLOUD',
  'YILIAN_CLOUD',
  'OTHER',
])
const PMS_SYSTEM_NAMES = Object.freeze({
  MEITUAN_BIEYANGHONG: '美团别样红 PMS',
  LUOPAN_CLOUD: '罗盘 PMS',
  YILIAN_CLOUD: '驿联云 PMS',
})
const OWNERSHIP_TYPES = new Set(['DIRECT', 'NON_DIRECT'])
const REPORT_TYPES = new Set([
  'ORDER_DETAIL',
  'ROOM_REVENUE',
  'PHYSICAL_INVENTORY',
  'OTA_PRODUCT_INVENTORY',
  'BUSINESS_DAY',
  'CUSTOM_REPORT',
])
const CALCULATION_ROLES = new Set([
  'PRIMARY_CALCULATION',
  'AUXILIARY_CALCULATION',
])
const REPORT_POLL_INTERVALS = new Set([5, 10, 15, 30, 60])
const SENSITIVE_QUERY_KEY =
  /(?:token|cookie|password|passwd|secret|session|authorization|api[_-]?key|sign(?:ature)?)/iu

const reject = (code) => {
  const error = new Error(code)
  error.code = code
  throw error
}

const isRecord = (value) =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

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

export const defaultYilianReportSourcesForMigration = () => [
  {
    sourceId: '34000000-0000-4000-8000-000000000001',
    displayName: '实时房态',
    endpointUrl:
      'https://pms.ygjpms.com/newPms/reportAPP/nowRoomStateReport',
    reportType: 'CUSTOM_REPORT',
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
  {
    sourceId: '27f5ead0-11a3-4131-87ce-7ba9d7ff0ce0',
    displayName: '订单明细',
    endpointUrl:
      'https://pms.ygjpms.com/newPms/orderManage/selectAll?pageNum=1&pageSize=100&recState=2',
    reportType: 'ORDER_DETAIL',
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
    displayName: '远期房态',
    endpointUrl:
      'https://pms.ygjpms.com/newPms/reportAPP/rateCalendarReport?startDate=2020-01-01&endDate=2020-01-02',
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

const requestPayloadContainsSensitiveKey = (value, depth = 0) => {
  if (depth > 12 || value === null || typeof value !== 'object') return false
  if (Array.isArray(value)) {
    return value.some((item) =>
      requestPayloadContainsSensitiveKey(item, depth + 1))
  }
  return Object.entries(value).some(
    ([key, child]) =>
      SENSITIVE_QUERY_KEY.test(key)
      || requestPayloadContainsSensitiveKey(child, depth + 1),
  )
}

const normalizePersistedReportSources = (input) => {
  if (!Array.isArray(input) || input.length > 20) {
    reject('REPORT_SOURCE_BASELINE_INVALID')
  }
  const normalized = input.map((source) => {
    const rowVersion = Math.max(0, Number(source?.rowVersion ?? 1) - 1)
    const candidate = { ...source, rowVersion }
    const cookieUpdate = candidate.cookieUpdate ?? { action: 'KEEP' }
    const requestPayloadJson =
      typeof candidate.requestPayloadJson === 'string'
        ? candidate.requestPayloadJson.trim()
        : ''
    let requestPayload = null
    if (requestPayloadJson) {
      if (requestPayloadJson.length > 20_000) {
        reject('REPORT_SOURCE_BASELINE_INVALID')
      }
      try {
        requestPayload = JSON.parse(requestPayloadJson)
      } catch {
        reject('REPORT_SOURCE_BASELINE_INVALID')
      }
      if (
        !isRecord(requestPayload)
        || requestPayloadContainsSensitiveKey(requestPayload)
      ) {
        reject('REPORT_SOURCE_BASELINE_INVALID')
      }
    }
    if (
      !isRecord(candidate)
      || typeof candidate.sourceId !== 'string'
      || !/^[0-9a-f-]{36}$/iu.test(candidate.sourceId)
      || typeof candidate.displayName !== 'string'
      || candidate.displayName.trim().length < 1
      || candidate.displayName.trim().length > 80
      || typeof candidate.endpointUrl !== 'string'
      || candidate.endpointUrl.length > 500
      || !REPORT_TYPES.has(candidate.reportType)
      || !CALCULATION_ROLES.has(candidate.calculationRole)
      || !REPORT_POLL_INTERVALS.has(candidate.pollIntervalMinutes)
      || typeof candidate.credentialAlias !== 'string'
      || (
        candidate.credentialAlias.length > 0
        && !/^[A-Z0-9][A-Z0-9_-]{1,63}$/u.test(candidate.credentialAlias)
      )
      || typeof candidate.enabled !== 'boolean'
      || !Number.isInteger(candidate.rowVersion)
      || candidate.rowVersion < 0
      || !isRecord(cookieUpdate)
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
      reject('REPORT_SOURCE_BASELINE_INVALID')
    }
    let endpoint
    try {
      endpoint = new URL(candidate.endpointUrl)
    } catch {
      reject('REPORT_SOURCE_BASELINE_INVALID')
    }
    if (
      endpoint.protocol !== 'https:'
      || endpoint.username
      || endpoint.password
      || endpoint.hash
      || [...endpoint.searchParams.keys()].some((key) =>
        SENSITIVE_QUERY_KEY.test(key))
    ) {
      reject('REPORT_SOURCE_BASELINE_INVALID')
    }
    return {
      sourceId: candidate.sourceId,
      displayName: candidate.displayName.trim(),
      endpointUrl: endpoint.toString(),
      reportType: candidate.reportType,
      calculationRole: candidate.calculationRole,
      pollIntervalMinutes: REPORT_POLL_INTERVAL_MINUTES,
      credentialAlias: candidate.credentialAlias,
      enabled: candidate.enabled,
      requestPayloadJson:
        requestPayload === null ? '' : JSON.stringify(requestPayload),
      validationStatus: 'FORMAT_VALID',
      rowVersion: candidate.rowVersion + 1,
    }
  })
  if (
    normalized.some((source) => source.enabled)
    && !normalized.some((source) =>
      source.enabled
      && source.calculationRole === 'PRIMARY_CALCULATION')
  ) {
    reject('REPORT_SOURCE_BASELINE_INVALID')
  }
  return normalized
}

const cloneReportSourceDefinitions = (sources) => sources.map((source) => ({
  sourceId: source.sourceId,
  displayName: source.displayName,
  endpointUrl: source.endpointUrl,
  reportType: source.reportType,
  calculationRole: source.calculationRole,
  pollIntervalMinutes: source.pollIntervalMinutes,
  credentialAlias: source.credentialAlias,
  requestPayloadJson: '',
  enabled: source.enabled,
  validationStatus: source.validationStatus,
  rowVersion: source.rowVersion,
}))

const migratedYilianReportSources = (sources) => {
  const previousBySourceId = new Map(
    (Array.isArray(sources) ? sources : [])
      .map((source) => [source.sourceId, source]),
  )
  return defaultYilianReportSourcesForMigration().map((source) => {
    const previous = previousBySourceId.get(source.sourceId)
    if (!previous) return source
    return {
      ...source,
      enabled: previous.enabled,
      rowVersion: Number.isInteger(previous.rowVersion)
        ? previous.rowVersion + 1
        : source.rowVersion,
    }
  })
}

const isLegacyYilianPms = (systemCode, systemName) =>
  systemCode === 'OTHER'
  && /^(?:驿联云(?:\s*PMS)?|YILIAN(?:\s*CLOUD)?(?:\s*PMS)?)$/iu.test(
    String(systemName ?? '').trim(),
  )

const normalizeHotels = (input) => {
  if (!Array.isArray(input)) reject('HOTEL_BASELINE_INVALID')
  const normalized = input.map((candidate) => {
    if (!isRecord(candidate)) return null
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
    const pmsSystemCode = isLegacyYilianPms(
      candidate.pmsSystemCode,
      candidate.pmsSystemName,
    )
      ? 'YILIAN_CLOUD'
      : PMS_SYSTEM_CODES.has(candidate.pmsSystemCode)
        ? candidate.pmsSystemCode
        : tenantCode === '001' && hotelCode === '002'
          ? 'LUOPAN_CLOUD'
          : 'MEITUAN_BIEYANGHONG'
    const pmsSystemName = typeof candidate.pmsSystemName === 'string'
      && candidate.pmsSystemName.trim()
      ? candidate.pmsSystemName.trim()
      : PMS_SYSTEM_NAMES[pmsSystemCode]
    if (
      !HOTEL_ID.test(candidate.tenantId)
      || !HOTEL_ID.test(candidate.hotelId)
      || !HOTEL_CODE.test(tenantCode)
      || !HOTEL_CODE.test(hotelCode)
      || tenantName.length < 1
      || tenantName.length > 80
      || hotelName.length < 1
      || hotelName.length > 80
      || typeof pmsSystemName !== 'string'
      || pmsSystemName.length < 1
      || pmsSystemName.length > 80
      || !timezone
    ) return null
    try {
      Intl.DateTimeFormat(undefined, { timeZone: timezone })
    } catch {
      return null
    }
    return {
      hotelId: candidate.hotelId,
      tenantCode,
      hotelCode,
      pmsSystemCode,
      collectionEnabled: candidate.collectionEnabled !== false,
      ownershipType: OWNERSHIP_TYPES.has(candidate.ownershipType)
        ? candidate.ownershipType
        : 'DIRECT',
    }
  }).filter((hotel) => hotel !== null).slice(0, 100)
  if (normalized.length < 1) reject('HOTEL_BASELINE_INVALID')
  const ids = new Set(normalized.map((hotel) => hotel.hotelId))
  if (ids.size !== normalized.length) reject('HOTEL_BASELINE_AMBIGUOUS')
  return normalized
}

const defaultRepairStatus = () => ({
  state: 'IDLE',
  trigger: null,
  lastAttemptAt: null,
  lastValidatedAt: null,
  lastSucceededAt: null,
  lastBusinessDate: null,
  lastErrorCode: null,
  sourceCount: 0,
  successfulSourceCount: 0,
  outboundDeliveryAttempted: false,
})

const normalizeRepairStatus = (candidate) => {
  const fallback = defaultRepairStatus()
  if (candidate === null || typeof candidate !== 'object') return fallback
  const safeTime = (value) => {
    if (typeof value !== 'string') return null
    const parsed = new Date(value)
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString()
  }
  return {
    state: STATUS_STATES.has(candidate.state) ? candidate.state : 'IDLE',
    trigger: typeof candidate.trigger === 'string'
      && /^[A-Z0-9][A-Z0-9_-]{1,63}$/u.test(candidate.trigger)
      ? candidate.trigger
      : null,
    lastAttemptAt: safeTime(candidate.lastAttemptAt),
    lastValidatedAt: safeTime(candidate.lastValidatedAt),
    lastSucceededAt: safeTime(candidate.lastSucceededAt),
    lastBusinessDate: typeof candidate.lastBusinessDate === 'string'
      && /^\d{4}-\d{2}-\d{2}$/u.test(candidate.lastBusinessDate)
      ? candidate.lastBusinessDate
      : null,
    lastErrorCode: typeof candidate.lastErrorCode === 'string'
      && /^YILIAN_[A-Z0-9_]{2,80}$/u.test(candidate.lastErrorCode)
      ? candidate.lastErrorCode
      : null,
    sourceCount: Number.isInteger(candidate.sourceCount)
      ? Math.max(0, Math.min(20, candidate.sourceCount))
      : 0,
    successfulSourceCount: Number.isInteger(candidate.successfulSourceCount)
      ? Math.max(0, Math.min(20, candidate.successfulSourceCount))
      : 0,
    outboundDeliveryAttempted: false,
  }
}

const parseJsonOr = (text, fallback) => {
  if (typeof text !== 'string') return fallback
  try {
    return JSON.parse(text)
  } catch {
    return fallback
  }
}

const restoredReportSources = (text, hotels) => {
  const hotelIds = new Set(hotels.map((hotel) => hotel.hotelId))
  if (text === null) return { sources: new Map(), restoredIds: new Set() }
  let parsed
  try {
    parsed = JSON.parse(text)
  } catch {
    reject('REPORT_SOURCE_BASELINE_INVALID')
  }
  if (!isRecord(parsed)) {
    return { sources: new Map(), restoredIds: new Set() }
  }
  try {
    const sources = new Map()
    const restoredIds = new Set()
    for (const [hotelId, candidates] of Object.entries(parsed)) {
      if (!hotelIds.has(hotelId)) continue
      sources.set(hotelId, normalizePersistedReportSources(candidates))
      restoredIds.add(hotelId)
    }
    return { sources, restoredIds }
  } catch {
    reject('REPORT_SOURCE_BASELINE_INVALID')
  }
}

const ensureReportSources = (sources, hotels) => {
  const primary = hotels.find((hotel) =>
    hotel.tenantCode === '001' && hotel.hotelCode === '001') ?? hotels[0]
  const primaryUsesReportTemplate = primary.pmsSystemCode !== 'YILIAN_CLOUD'
  if (primaryUsesReportTemplate && !sources.has(primary.hotelId)) {
    sources.set(primary.hotelId, defaultReportSources())
  }
  const primarySources = primaryUsesReportTemplate
    ? sources.get(primary.hotelId)
    : defaultReportSources()
  for (const hotel of hotels) {
    if (sources.has(hotel.hotelId)) continue
    // Match the runtime's per-hotel migration boundary: absence alone must not
    // synthesize a Yilian contract for a store that did not qualify.
    if (hotel.pmsSystemCode === 'YILIAN_CLOUD') continue
    sources.set(
      hotel.hotelId,
      hotel.pmsSystemCode === 'MEITUAN_BIEYANGHONG'
        ? hotel.hotelId === primary.hotelId
          ? primarySources
          : cloneReportSourceDefinitions(primarySources)
        : [],
    )
  }
}

const restoredRepairStatuses = (text, hotels) => {
  const hotelsById = new Map(hotels.map((hotel) => [hotel.hotelId, hotel]))
  if (text === null) return new Map()
  let parsed
  try {
    parsed = JSON.parse(text)
  } catch {
    reject('REPAIR_STATUS_BASELINE_INVALID')
  }
  const statuses = new Map()
  if (!isRecord(parsed)) return statuses
  for (const [hotelId, candidate] of Object.entries(parsed)) {
    if (hotelsById.get(hotelId)?.pmsSystemCode !== 'YILIAN_CLOUD') continue
    const normalized = normalizeRepairStatus(candidate)
    statuses.set(hotelId, {
      ...normalized,
      state: normalized.state === 'RUNNING' ? 'IDLE' : normalized.state,
    })
  }
  return statuses
}

export const verifyYilianSourceContractMigration = ({
  beforeReportSourcesText,
  beforeRepairStatusesText,
  afterReportSources,
  afterRepairStatuses,
  hotels: hotelCandidates,
  configuredPmsHotelIds = new Set(),
}) => {
  const hotels = normalizeHotels(hotelCandidates)
  const { sources, restoredIds } = restoredReportSources(
    beforeReportSourcesText,
    hotels,
  )
  ensureReportSources(sources, hotels)
  const statuses = restoredRepairStatuses(beforeRepairStatusesText, hotels)
  const migratedHotelIds = []

  for (const hotel of hotels.filter(
    (candidate) => candidate.pmsSystemCode === 'YILIAN_CLOUD',
  )) {
    const hotelSources = sources.get(hotel.hotelId)
    const status = statuses.get(hotel.hotelId) ?? defaultRepairStatus()
    const sourceContractUnavailable =
      !restoredIds.has(hotel.hotelId)
      || (Array.isArray(hotelSources) && hotelSources.length === 0)
    const outdatedRealtimeContract = Array.isArray(hotelSources)
      && hotelSources.some((source) => {
        try {
          return new URL(source.endpointUrl).pathname
            === '/newPms/forwardRoomState/nowRoomState'
        } catch {
          return false
        }
      })
    const outdatedOrderPagination = Array.isArray(hotelSources)
      && hotelSources.some((source) => {
        try {
          const endpoint = new URL(source.endpointUrl)
          return endpoint.pathname === '/newPms/orderManage/selectAll'
            && endpoint.searchParams.get('pageSize') !== '100'
        } catch {
          return false
        }
      })
    const outdatedSourceContract =
      outdatedRealtimeContract || outdatedOrderPagination
    const failedOnMissingContract =
      status.state === 'FAILED'
      && status.lastErrorCode === 'YILIAN_SOURCE_CONTRACT_INVALID'
    const legacyInitialActivationPending =
      !hotel.collectionEnabled
      && configuredPmsHotelIds.has(hotel.hotelId)
      && status.state === 'IDLE'
      && status.trigger === null
      && status.lastAttemptAt === null
      && status.lastErrorCode === null
      && status.sourceCount === 0
    const interruptedMigration =
      status.state === 'IDLE'
      && status.trigger === MIGRATION_TRIGGER
      && status.lastErrorCode === null
    if (
      !outdatedSourceContract
      && (
        !sourceContractUnavailable
        || (
          !failedOnMissingContract
          && !legacyInitialActivationPending
          && !interruptedMigration
        )
      )
    ) continue

    sources.set(
      hotel.hotelId,
      outdatedSourceContract
        ? migratedYilianReportSources(hotelSources)
        : defaultYilianReportSourcesForMigration(),
    )
    statuses.set(
      hotel.hotelId,
      normalizeRepairStatus({
        ...status,
        state: 'IDLE',
        trigger: MIGRATION_TRIGGER,
        lastAttemptAt: null,
        lastErrorCode: null,
        sourceCount: 3,
        successfulSourceCount: 0,
      }),
    )
    migratedHotelIds.push(hotel.hotelId)
  }

  if (migratedHotelIds.length < 1) {
    reject('YILIAN_MIGRATION_NOT_EXPECTED')
  }
  if (!isDeepStrictEqual(afterReportSources, Object.fromEntries(sources))) {
    reject('YILIAN_REPORT_SOURCE_MIGRATION_MISMATCH')
  }
  if (!isDeepStrictEqual(afterRepairStatuses, Object.fromEntries(statuses))) {
    reject('YILIAN_REPAIR_STATUS_MIGRATION_MISMATCH')
  }
  return { migratedHotelCount: migratedHotelIds.length }
}

const readRequiredText = (path, label) => {
  try {
    return readFileSync(path, 'utf8')
  } catch {
    reject(`${label}_READ_FAILED`)
  }
}

const readSnapshotText = (statePath, dataPath, label) => {
  const state = readRequiredText(statePath, `${label}_STATE`).trim()
  if (state === 'ABSENT') return null
  if (state !== 'PRESENT') reject(`${label}_STATE_INVALID`)
  return readRequiredText(dataPath, label)
}

const readOptionalText = (path) => {
  try {
    return readFileSync(path, 'utf8')
  } catch (error) {
    if (error?.code === 'ENOENT') return null
    reject('PMS_LOGIN_SECRET_STORE_READ_FAILED')
  }
}

const runtimeSecretKey = (runtimeEnvText) => {
  const values = runtimeEnvText
    .split(/\r?\n/u)
    .filter((line) => line.startsWith('OTA_REVIEW_SECRET_KEY='))
    .map((line) => line.slice('OTA_REVIEW_SECRET_KEY='.length))
  if (values.length !== 1 || !/^[A-Za-z0-9_-]{43}$/u.test(values[0])) {
    reject('RUNTIME_SECRET_KEY_INVALID')
  }
  return values[0]
}

const configuredPmsHotelIdsFromStore = ({ text, hotels, secretKey }) => {
  const parsed = parseJsonOr(text, null)
  if (!isRecord(parsed)) return new Set()
  const hotelIds = new Set(hotels.map((hotel) => hotel.hotelId))
  const configured = new Set()
  try {
    for (const [hotelId, record] of Object.entries(parsed)) {
      if (!hotelIds.has(hotelId)) continue
      const plaintext = decryptCookie(
        record,
        secretKey,
        `pms-login:${hotelId}`,
      )
      const credentials = JSON.parse(plaintext)
      const username = typeof credentials?.username === 'string'
        ? credentials.username.trim()
        : ''
      const password = typeof credentials?.password === 'string'
        ? credentials.password
        : ''
      if (
        username.length < 1
        || username.length > 256
        || password.length < 1
        || password.length > 4096
        || /[\r\n\u0000]/u.test(username)
        || /[\r\n\u0000]/u.test(password)
      ) reject('PMS_LOGIN_SECRET_STORE_INVALID')
      configured.add(hotelId)
    }
  } catch {
    // The API keeps any records successfully restored before a corrupt record.
  }
  return configured
}

const parseArguments = (input) => {
  const result = {}
  for (let index = 0; index < input.length; index += 2) {
    const name = input[index]
    const value = input[index + 1]
    if (!/^--[a-z-]+$/u.test(name ?? '') || typeof value !== 'string') {
      reject('ARGUMENTS_INVALID')
    }
    const key = name.slice(2)
    if (Object.hasOwn(result, key)) reject('ARGUMENTS_INVALID')
    result[key] = value
  }
  const required = [
    'before-report-sources-state',
    'before-report-sources-data',
    'before-repair-statuses-state',
    'before-repair-statuses-data',
    'after-report-sources',
    'after-repair-statuses',
    'hotels',
    'pms-login-secrets',
    'runtime-env',
  ]
  if (required.some((key) => !Object.hasOwn(result, key))) {
    reject('ARGUMENTS_INVALID')
  }
  return result
}

const runCli = () => {
  const args = parseArguments(process.argv.slice(2))
  const hotelCandidates = parseJsonOr(
    readRequiredText(args.hotels, 'HOTEL_BASELINE'),
    null,
  )
  const hotels = normalizeHotels(hotelCandidates)
  const secretKey = runtimeSecretKey(
    readRequiredText(args['runtime-env'], 'RUNTIME_ENV'),
  )
  const configuredPmsHotelIds = configuredPmsHotelIdsFromStore({
    text: readOptionalText(args['pms-login-secrets']),
    hotels,
    secretKey,
  })
  const result = verifyYilianSourceContractMigration({
    beforeReportSourcesText: readSnapshotText(
      args['before-report-sources-state'],
      args['before-report-sources-data'],
      'REPORT_SOURCE_BASELINE',
    ),
    beforeRepairStatusesText: readSnapshotText(
      args['before-repair-statuses-state'],
      args['before-repair-statuses-data'],
      'REPAIR_STATUS_BASELINE',
    ),
    afterReportSources: parseJsonOr(
      readRequiredText(args['after-report-sources'], 'REPORT_SOURCE_AFTER'),
      null,
    ),
    afterRepairStatuses: parseJsonOr(
      readRequiredText(args['after-repair-statuses'], 'REPAIR_STATUS_AFTER'),
      null,
    ),
    hotels: hotelCandidates,
    configuredPmsHotelIds,
  })
  process.stdout.write(
    `YILIAN_SOURCE_CONTRACT_MIGRATION_VERIFIED:${result.migratedHotelCount}\n`,
  )
}

if (
  process.argv[1]
  && import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    runCli()
  } catch (error) {
    const code = typeof error?.code === 'string'
      ? error.code
      : 'YILIAN_MIGRATION_VERIFICATION_FAILED'
    process.stderr.write(`${code}\n`)
    process.exitCode = 1
  }
}
