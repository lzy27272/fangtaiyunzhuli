#!/usr/bin/env node

import { createServer } from 'node:http'
import { randomUUID, timingSafeEqual } from 'node:crypto'
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
import {
  appendAndPersistSnapshot,
  collectLiveReports,
  loadSnapshotStore,
  monitorFromSnapshot,
} from './live-report-collector.mjs'

const host = '127.0.0.1'
const port = Number.parseInt(process.env.OTA_REVIEW_API_PORT ?? '8091', 10)
const username = process.env.OTA_REVIEW_USERNAME
const password = process.env.OTA_REVIEW_PASSWORD
const accessToken = process.env.OTA_REVIEW_ACCESS_TOKEN
const dataPath = process.env.OTA_REVIEW_DATA_PATH?.trim()
const cookieSecretsPath =
  process.env.OTA_REVIEW_COOKIE_SECRETS_PATH?.trim()
const cookieSecretKey = process.env.OTA_REVIEW_SECRET_KEY?.trim()
const automaticHourlyCollectionEnabled =
  process.env.OTA_REVIEW_AUTO_COLLECTION_ENABLED === 'true'
const liveSnapshotPath = dataPath
  ? join(dirname(dataPath), 'live-report-snapshots.json')
  : null
const businessDayControlPath = dataPath
  ? join(dirname(dataPath), 'business-day-controls.json')
  : null
const hotSellingRoomTypePath = dataPath
  ? join(dirname(dataPath), 'hot-selling-room-types.json')
  : null

if (
  !Number.isInteger(port)
  || port < 1024
  || port > 65535
  || !username
  || !password
  || !accessToken
  || !cookieSecretsPath
  || !cookieSecretKey
) {
  process.stderr.write('REVIEW_API_CONFIGURATION_INVALID\n')
  process.exit(2)
}

const tenantId = '10000000-0000-4000-8000-000000000001'
const hotels = [
  {
    tenantId,
    hotelId: '20000000-0000-4000-8000-000000000001',
    tenantCode: '001',
    tenantName: '四方馆酒店管理',
    hotelCode: '001',
    hotelName: '喷水池态六酒店',
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
const liveCollectionLocks = new Map()
const liveSnapshotStore = loadSnapshotStore(liveSnapshotPath)
const businessDayControlsByHotel = new Map()
const hotSellingRoomTypesByHotel = new Map()

const defaultReportSources = () => [
  {
    sourceId: '34000000-0000-4000-8000-000000000001',
    displayName: '订单明细报表 jd01',
    endpointUrl: 'https://pms.meituan.com/hotelpms/api/v1/report/jd01',
    reportType: 'ORDER_DETAIL',
    calculationRole: 'PRIMARY_CALCULATION',
    pollIntervalMinutes: 5,
    credentialAlias: 'REPORT_READER_ORDERS',
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
    pollIntervalMinutes: 5,
    credentialAlias: 'REPORT_READER_INVENTORY',
    cookieConfigured: false,
    cookieUpdatedAt: null,
    enabled: true,
    validationStatus: 'FORMAT_VALID',
    rowVersion: 1,
  },
]

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
const allowedPollIntervals = new Set([5, 10, 15, 30, 60])
const sensitiveQueryKey =
  /(?:token|cookie|password|passwd|secret|session|authorization|api[_-]?key|sign(?:ature)?)/i

const normalizeReportSources = (input) => {
  if (!Array.isArray(input) || input.length > 20) {
    throw new Error('REPORT_SOURCES_INVALID')
  }
  const normalized = input.map((source) => {
    const cookieUpdate = source?.cookieUpdate ?? { action: 'KEEP' }
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
      || !allowedPollIntervals.has(source.pollIntervalMinutes)
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
      pollIntervalMinutes: source.pollIntervalMinutes,
      credentialAlias: source.credentialAlias,
      enabled: source.enabled,
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
  return sources.map((source) => {
    const secret = secrets[source.sourceId]
    return {
      ...source,
      cookieConfigured: Boolean(secret),
      cookieUpdatedAt: secret?.updatedAt ?? null,
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
              && /^[A-Z0-9-]{3,80}$/.test(code),
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

const safeEqual = (left, right) => {
  const leftBuffer = Buffer.from(left ?? '', 'utf8')
  const rightBuffer = Buffer.from(right ?? '', 'utf8')
  return (
    leftBuffer.length === rightBuffer.length
    && timingSafeEqual(leftBuffer, rightBuffer)
  )
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
      tenantId,
      tenantCode: selected.tenantCode,
      displayName: selected.tenantName,
      timezone: selected.timezone,
      status: 'ACTIVE',
      rowVersion: 1,
    },
    hotel: {
      tenantId,
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
    tenantId,
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

const collectLiveFor = async (hotelId) => {
  const running = liveCollectionLocks.get(hotelId)
  if (running) return running

  const operation = (async () => {
    const hotel = selectedHotel(hotelId)
    const businessDayControl = businessDayControlFor(hotelId)
    if (!businessDayControl.businessDate) {
      throw new Error('BUSINESS_DAY_UNCONFIRMED')
    }
    if (!reportSourcesByHotel.has(hotelId)) {
      reportSourcesByHotel.set(hotelId, defaultReportSources())
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
      businessDateBasis: 'PMS_CONFIRMED',
    })
    appendAndPersistSnapshot(
      liveSnapshotStore,
      liveSnapshotPath,
      result.snapshot,
    )
    return result
  })()
  liveCollectionLocks.set(hotelId, operation)
  try {
    return await operation
  } finally {
    liveCollectionLocks.delete(hotelId)
  }
}

const shanghaiHour = (date = new Date()) => {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Shanghai',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(date)
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, part.value]),
  )
  return {
    hourKey:
      `${parts.year}-${parts.month}-${parts.day}T${parts.hour}`,
    minute: Number(parts.minute),
  }
}

const scheduledCollectionTick = async () => {
  if (!automaticHourlyCollectionEnabled) return
  const { hourKey, minute } = shanghaiHour()
  if (minute > 5) return
  for (const hotel of hotels.filter((item) => item.collectionEnabled)) {
    const latest = (liveSnapshotStore[hotel.hotelId] ?? []).at(-1)
    if (latest?.observedAt?.startsWith(hourKey)) continue
    try {
      await collectLiveFor(hotel.hotelId)
      process.stdout.write(
        `${JSON.stringify({
          event: 'SCHEDULED_COLLECTION_COMPLETED',
          hotelId: hotel.hotelId,
          hourKey,
        })}\n`,
      )
    } catch {
      process.stderr.write(
        `${JSON.stringify({
          event: 'SCHEDULED_COLLECTION_FAILED',
          hotelId: hotel.hotelId,
          hourKey,
        })}\n`,
      )
    }
  }
}

const briefFor = (hotelId) => {
  const hotel = selectedHotel(hotelId)
  return {
    briefId: '80000000-0000-4000-8000-000000000001',
    businessDate: '2026-07-25',
    cutoffAt: '2026-07-25T18:00:00+08:00',
    revisionNo: 1,
    completenessCode: 'COMPLETE',
    content: [
      `【评审模拟】${hotel.hotelName}｜今日收益管理`,
      '⏰ 统计时间｜2026-07-25 18:00',
      '今日可售｜11间',
      '目标任务｜¥10000',
      '完成指标｜78.5%',
      '今日已售｜39间夜',
      'P1提示｜美团景观双床房可售1，低于主库存报表实体库存2',
      '说明｜仅供界面评审，不是实时经营数据',
    ].join('\n'),
    publishedAt: '2026-07-25T18:00:06+08:00',
    simulationRunId: 'review-run-1800',
    deliveryStatus: 'BLOCKED_REVIEW_ONLY',
    simulationMode: true,
  }
}

const requireAuth = (request, response) => {
  if (request.headers.authorization !== `Bearer ${accessToken}`) {
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
        mode: 'LOCAL_LIVE_PILOT',
        automaticHourlyCollectionEnabled,
        outboundDeliveryEnabled: false,
      })
      return
    }

    if (request.method === 'POST' && path === '/api/v1/auth/login') {
      const body = await readBody(request)
      if (
        !safeEqual(String(body.username ?? ''), username)
        || !safeEqual(String(body.password ?? ''), password)
      ) {
        json(response, 401, { code: 'REVIEW_LOGIN_FAILED' })
        return
      }
      json(response, 200, {
        accessToken,
        expiresInSeconds: 14400,
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

    if (request.method === 'POST' && path === '/api/v1/auth/logout') {
      empty(response)
      return
    }

    if (path.startsWith('/api/v1/ota/') && !requireAuth(request, response)) {
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
      await readBody(request)
      json(response, 200, {
        data: {
          commandId: randomUUID(),
          resourceId: hotels[0].hotelId,
          resultingRowVersion: 1,
          replayed: false,
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
      if (
        requestTenantId !== tenantId
        || !hotels.some((hotel) => hotel.hotelId === hotelId)
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
          reportSourcesByHotel.set(hotelId, defaultReportSources())
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
        const sources = normalizeReportSources(body.sources)
        applyCookieUpdates(hotelId, body.sources)
        persistCookieSecrets()
        reportSourcesByHotel.set(hotelId, sources)
        persistReportSources()
        json(response, 200, {
          data: {
            commandId: randomUUID(),
            resourceId: hotelId,
            resultingRowVersion: Math.max(
              1,
              ...sources.map((source) => source.rowVersion),
            ),
            replayed: false,
          },
        })
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
          },
        })
        return
      }
      if (request.method === 'GET' && suffix === '/briefs') {
        json(response, 200, { data: [briefFor(hotelId)] })
        return
      }
      if (request.method === 'GET' && suffix === '/incidents') {
        json(response, 200, {
          data: [
            {
              incidentId: '81000000-0000-4000-8000-000000000001',
              type: 'P1_INVENTORY_MISMATCH',
              status: 'OPEN',
              sourceCode: 'MEITUAN',
              directionCode: 'AUXILIARY_LT_PRIMARY',
              openedAt: '2026-07-25T17:58:10+08:00',
              lastObservedAt: '2026-07-25T18:00:05+08:00',
              taskId: '82000000-0000-4000-8000-000000000001',
            },
          ],
        })
        return
      }
      if (request.method === 'GET' && suffix === '/outbox-preview') {
        json(response, 200, {
          data: [
            {
              eventId: '83000000-0000-4000-8000-000000000001',
              messageKey: `${hotelId}:2026-07-25T18:00:00+08:00:v1`,
              messageType: 'HOURLY_REVENUE_BRIEF',
              createdAt: '2026-07-25T18:00:06+08:00',
              deliveryBlocked: true,
              deliveryStatus: 'BLOCKED_REVIEW_ONLY',
              bodyPreview: briefFor(hotelId).content,
            },
          ],
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
          : 'REVIEW_API_FAILED_CLOSED'
    json(response, 400, { code })
  }
})

server.listen(port, host, () => {
  process.stdout.write(
    `${JSON.stringify({
      status: 'READY',
      mode: 'LOCAL_LIVE_PILOT',
      url: `http://${host}:${port}`,
    })}\n`,
  )
  const scheduler = setInterval(() => {
    void scheduledCollectionTick()
  }, 30_000)
  scheduler.unref()
  const initialScheduler = setTimeout(() => {
    void scheduledCollectionTick()
  }, 2_000)
  initialScheduler.unref()
})
