import {
  createHmac,
  createHash,
  createPublicKey,
  randomBytes,
  randomUUID,
  timingSafeEqual,
  verify,
} from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs'
import { dirname } from 'node:path'
import { normalizeDailyOrderSummary } from './daily-order-summary.mjs'

export const TRUSTED_DEVICE_PILOT_HOTEL_CODE = '001'
export const TRUSTED_DEVICE_ENROLLMENT_TTL_MS = 15 * 60_000
export const TRUSTED_DEVICE_REQUEST_SKEW_MS = 5 * 60_000
export const TRUSTED_DEVICE_SCOPE_TTL_MS = 5 * 60_000

const MAX_NONCES_PER_DEVICE = 120
const MAX_SCOPE_ARTIFACTS = 20
const MAX_LABEL_LENGTH = 60
const ALLOWED_COMPLETENESS = new Set(['COMPLETE', 'PARTIAL', 'UNAVAILABLE'])
const REQUIRED_COMPLETE_SOURCE_PREFIXES = [
  'REPORT_ORDER_',
  'REPORT_REVENUE_',
  'REPORT_INVENTORY_',
]
const COMPLETE_OVERVIEW_METRICS = ['roomFee', 'roomNights', 'adr', 'revPar']
const SNAPSHOT_KEYS = new Set([
  'schemaVersion',
  'sourceSystem',
  'collectionRunId',
  'tenantId',
  'hotelId',
  'businessDate',
  'businessDateBasis',
  'businessDateSource',
  'businessDateStartedAt',
  'previousBusinessDate',
  'businessDateChanged',
  'observedAt',
  'completeness',
  'sources',
  'orders',
  'dailyOrderSummary',
  'overview',
  'futureDaily',
  'physicalInventory',
  'roomForecast',
  'hourlyDelta',
  'futureBookingChanges',
])
const SOURCE_KEYS = new Set([
  'sourceId',
  'sourceCode',
  'reportType',
  'completeness',
  'observedAt',
  'ingestedAt',
  'errorCode',
])
const OVERVIEW_KEYS = new Set([
  'stayDate',
  'roomCount',
  'availableRooms',
  'soldRooms',
  'orderRooms',
  'checkinRooms',
  'roomFee',
  'revenue',
  'roomNights',
  'occupancyRate',
  'adr',
  'revPar',
])
const INVENTORY_KEYS = new Set([
  'inventoryPoolId',
  'physicalRoomTypeCode',
  'displayName',
  'physicalRoomCount',
  'primaryAvailableRooms',
  'estimatedRoomNights',
  'estimatedRoomFee',
  'estimatedAdr',
  'forecastRevPar',
  'forecastOverbookingCount',
  'forecastCheckinCount',
  'forecastOrderCount',
  'forecastMaintainingCount',
])
const CHANNEL_DELTA_KEYS = new Set([
  'newRoomNights',
  'todayRoomNights',
  'futureRoomNights',
  'canceledRoomNights',
])
const HOURLY_DELTA_KEYS = new Set([
  'basis',
  'aggregationWindow',
  'intervalStartAt',
  'intervalEndAt',
  'totals',
  'byChannel',
  'metricDelta',
])
const FUTURE_BOOKING_KEYS = new Set([
  'basis',
  'hourlyBaselineAt',
  'cumulativeBaselineAt',
  'previousDayEndAt',
  'daily',
])
const FUTURE_BOOKING_ROW_KEYS = new Set([
  ...OVERVIEW_KEYS,
  'bookedRoomNights',
  'occupancyPercent',
  'hourlyNetRoomNights',
  'cumulativeNetRoomNights',
  'previousDayNetRoomNights',
  'hourlyAdrDelta',
  'inferredHourlyAdr',
])

const sha256 = (value) => createHash('sha256').update(value).digest('hex')

export const stableJson = (value, depth = 0) => {
  if (depth > 20) throw new Error('TRUSTED_DEVICE_BODY_DEPTH_INVALID')
  if (typeof value === 'number' && !Number.isFinite(value)) {
    throw new Error('TRUSTED_DEVICE_BODY_NUMBER_INVALID')
  }
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) {
    return `[${value.map((item) =>
      stableJson(item, depth + 1) ?? 'null').join(',')}]`
  }
  return `{${Object.keys(value).sort().flatMap((key) => {
    const canonical = stableJson(value[key], depth + 1)
    return canonical === undefined
      ? []
      : [`${JSON.stringify(key)}:${canonical}`]
  }).join(',')}}`
}

const canonicalPmsLoginHotelId = (value) => {
  if (
    typeof value !== 'string'
    || !/^(?:0|[1-9][0-9]{0,63})$/u.test(value)
  ) throw new Error('TRUSTED_DEVICE_STORE_SCOPE_INVALID')
  return value
}

export const trustedDeviceScopeProof = ({
  hotelCode,
  deviceId,
  challenge,
  pmsLoginHotelId,
  scopeProofKey,
}) => {
  if (
    typeof hotelCode !== 'string'
    || !/^[A-Z0-9][A-Z0-9_-]{0,15}$/u.test(hotelCode)
    || typeof deviceId !== 'string'
    || !/^[0-9a-f-]{36}$/iu.test(deviceId)
    || typeof challenge !== 'string'
    || !/^[A-Za-z0-9_-]{40,120}$/u.test(challenge)
  ) throw new Error('TRUSTED_DEVICE_SCOPE_PROOF_INPUT_INVALID')
  const key = typeof scopeProofKey === 'string'
    ? Buffer.from(scopeProofKey, 'base64url')
    : Buffer.alloc(0)
  if (key.length !== 32) {
    throw new Error('TRUSTED_DEVICE_SCOPE_PROOF_INPUT_INVALID')
  }
  return createHmac('sha256', key).update([
    'SFG_TRUSTED_DEVICE_SCOPE_V1',
    hotelCode,
    deviceId,
    challenge,
    canonicalPmsLoginHotelId(pmsLoginHotelId),
  ].join('\n')).digest('hex')
}

export const trustedDeviceCanonicalMessage = ({
  method,
  path,
  hotelCode,
  deviceId,
  timestamp,
  nonce,
  body,
}) => [
  'SFG_TRUSTED_DEVICE_V1',
  String(method ?? '').toUpperCase(),
  path,
  hotelCode,
  deviceId,
  timestamp,
  nonce,
  sha256(stableJson(body)),
].join('\n')

const canonicalLabel = (value, fallback = '门店可信设备') => {
  const label = String(value ?? '').trim()
  if (!label) return fallback
  if (label.length > MAX_LABEL_LENGTH || /[\r\n\u0000]/u.test(label)) {
    throw new Error('TRUSTED_DEVICE_LABEL_INVALID')
  }
  return label
}

const normalizedPublicKey = (value) => {
  if (typeof value !== 'string' || value.length > 2_000) {
    throw new Error('TRUSTED_DEVICE_PUBLIC_KEY_INVALID')
  }
  try {
    const key = createPublicKey(value)
    if (key.asymmetricKeyType !== 'ed25519') {
      throw new Error('TRUSTED_DEVICE_PUBLIC_KEY_INVALID')
    }
    return key.export({ format: 'pem', type: 'spki' }).toString()
  } catch {
    throw new Error('TRUSTED_DEVICE_PUBLIC_KEY_INVALID')
  }
}

const timingSafeTextEqual = (left, right) => {
  const leftBuffer = Buffer.from(left)
  const rightBuffer = Buffer.from(right)
  return leftBuffer.length === rightBuffer.length
    && timingSafeEqual(leftBuffer, rightBuffer)
}

const safeDate = (value) => {
  const parsed = new Date(value)
  return Number.isFinite(parsed.getTime()) ? parsed : null
}

const plainObject = (value) =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)

const assertArrayLimit = (value, limit, code) => {
  if (!Array.isArray(value) || value.length > limit) throw new Error(code)
}

const assertExactKeys = (value, allowed, code) => {
  if (
    !plainObject(value)
    || Object.keys(value).some((key) => !allowed.has(key))
  ) throw new Error(code)
}

const nullableFiniteNumber = (value) =>
  value === null || (typeof value === 'number' && Number.isFinite(value))

const nullableIsoDate = (value) => value === null || Boolean(safeDate(value))

const validScopeAnchor = (value) => Boolean(
  plainObject(value)
  && plainObject(value.sealedExpectedPmsLoginHotelId)
  && typeof value.epoch === 'string'
  && /^[0-9a-f-]{36}$/iu.test(value.epoch)
  && ['PENDING', 'APPROVED'].includes(value.approvalStatus)
)

const scopeApprovalStatus = (anchor) =>
  validScopeAnchor(anchor)
  && anchor.approvalStatus === 'APPROVED'
    ? 'APPROVED'
    : validScopeAnchor(anchor)
      ? 'PENDING'
      : 'UNBOUND'

const assertOverviewRow = (row, code) => {
  assertExactKeys(row, OVERVIEW_KEYS, code)
  if (
    typeof row.stayDate !== 'string'
    || !/^\d{4}-\d{2}-\d{2}$/u.test(row.stayDate)
    || [...OVERVIEW_KEYS]
      .filter((key) => key !== 'stayDate')
      .some((key) => !nullableFiniteNumber(row[key]))
  ) throw new Error(code)
}

const assertInventoryRow = (row) => {
  assertExactKeys(row, INVENTORY_KEYS, 'TRUSTED_DEVICE_SNAPSHOT_INVENTORY_INVALID')
  if (
    typeof row.inventoryPoolId !== 'string'
    || row.inventoryPoolId.length < 1
    || row.inventoryPoolId.length > 100
    || typeof row.physicalRoomTypeCode !== 'string'
    || row.physicalRoomTypeCode.length < 1
    || row.physicalRoomTypeCode.length > 100
    || typeof row.displayName !== 'string'
    || row.displayName.length < 1
    || row.displayName.length > 80
    || [...INVENTORY_KEYS]
      .filter((key) => ![
        'inventoryPoolId',
        'physicalRoomTypeCode',
        'displayName',
      ].includes(key))
      .some((key) =>
        Object.hasOwn(row, key) && !nullableFiniteNumber(row[key]))
  ) throw new Error('TRUSTED_DEVICE_SNAPSHOT_INVENTORY_INVALID')
}

const assertChannelDelta = (value) => {
  assertExactKeys(value, CHANNEL_DELTA_KEYS, 'TRUSTED_DEVICE_SNAPSHOT_DELTA_INVALID')
  if ([...CHANNEL_DELTA_KEYS].some((key) =>
    typeof value[key] !== 'number' || !Number.isFinite(value[key]))) {
    throw new Error('TRUSTED_DEVICE_SNAPSHOT_DELTA_INVALID')
  }
}

const assertHourlyDelta = (value) => {
  assertExactKeys(value, HOURLY_DELTA_KEYS, 'TRUSTED_DEVICE_SNAPSHOT_DELTA_INVALID')
  if (
    !['BASELINE_PENDING', 'HOURLY_SNAPSHOT_DIFF'].includes(value.basis)
    || ![
      null,
      'PAUSE_TO_FIRST_BRIEF',
      'TWO_HOUR',
      'HOURLY',
    ].includes(value.aggregationWindow)
    || !nullableIsoDate(value.intervalStartAt)
    || !nullableIsoDate(value.intervalEndAt)
  ) throw new Error('TRUSTED_DEVICE_SNAPSHOT_DELTA_INVALID')
  if (value.totals !== null) assertChannelDelta(value.totals)
  if (value.byChannel !== null) {
    const channels = new Set(['CTRIP', 'MEITUAN', 'FEIZHU', 'DOUYIN', 'UNKNOWN'])
    assertExactKeys(value.byChannel, channels, 'TRUSTED_DEVICE_SNAPSHOT_DELTA_INVALID')
    if ([...channels].some((channel) => !Object.hasOwn(value.byChannel, channel))) {
      throw new Error('TRUSTED_DEVICE_SNAPSHOT_DELTA_INVALID')
    }
    for (const channel of Object.values(value.byChannel)) assertChannelDelta(channel)
  }
  if (value.metricDelta !== null) {
    const metricKeys = new Set(['roomFee', 'adr', 'revPar', 'roomNights'])
    assertExactKeys(value.metricDelta, metricKeys, 'TRUSTED_DEVICE_SNAPSHOT_DELTA_INVALID')
    if ([...metricKeys].some((key) => !nullableFiniteNumber(value.metricDelta[key]))) {
      throw new Error('TRUSTED_DEVICE_SNAPSHOT_DELTA_INVALID')
    }
  }
}

const assertFutureBookingChanges = (value) => {
  assertExactKeys(
    value,
    FUTURE_BOOKING_KEYS,
    'TRUSTED_DEVICE_SNAPSHOT_FUTURE_CHANGES_INVALID',
  )
  if (
    !['BASELINE_PENDING', 'FUTURE_SNAPSHOT_DIFF'].includes(value.basis)
    || !nullableIsoDate(value.hourlyBaselineAt)
    || !nullableIsoDate(value.cumulativeBaselineAt)
    || !nullableIsoDate(value.previousDayEndAt)
    || !Array.isArray(value.daily)
    || value.daily.length > 100
  ) throw new Error('TRUSTED_DEVICE_SNAPSHOT_FUTURE_CHANGES_INVALID')
  for (const row of value.daily) {
    assertExactKeys(
      row,
      FUTURE_BOOKING_ROW_KEYS,
      'TRUSTED_DEVICE_SNAPSHOT_FUTURE_CHANGES_INVALID',
    )
    if (
      typeof row.stayDate !== 'string'
      || !/^\d{4}-\d{2}-\d{2}$/u.test(row.stayDate)
      || [...FUTURE_BOOKING_ROW_KEYS]
        .filter((key) => key !== 'stayDate')
        .some((key) => !nullableFiniteNumber(row[key]))
    ) throw new Error('TRUSTED_DEVICE_SNAPSHOT_FUTURE_CHANGES_INVALID')
  }
}

const assertCompleteSnapshotPayload = (snapshot) => {
  if (snapshot.completeness !== 'COMPLETE') return
  if (
    snapshot.businessDateBasis !== 'PMS_CONFIRMED'
    || snapshot.businessDateSource !== 'PMS_NIGHT_AUDIT_API'
    || snapshot.sources.length < REQUIRED_COMPLETE_SOURCE_PREFIXES.length
    || snapshot.sources.some((source) => source.completeness !== 'COMPLETE')
    || REQUIRED_COMPLETE_SOURCE_PREFIXES.some((prefix) =>
      !snapshot.sources.some((source) => source.sourceCode.startsWith(prefix)))
    || !plainObject(snapshot.overview)
    || snapshot.physicalInventory.length === 0
    || !snapshot.physicalInventory.some((row) =>
      typeof row.physicalRoomCount === 'number'
      && Number.isFinite(row.physicalRoomCount)
      && row.physicalRoomCount > 0)
    || !COMPLETE_OVERVIEW_METRICS.some((field) =>
      typeof snapshot.overview[field] === 'number'
      && Number.isFinite(snapshot.overview[field]))
  ) throw new Error('TRUSTED_DEVICE_COMPLETE_SNAPSHOT_INVALID')
}

const forbiddenSnapshotKey = /(?:cookie|password|passwd|secret|authorization|access.?token|refresh.?token|phone|mobile|guest.?name|customer.?name|id.?card|set.?cookie)/iu

const assertSnapshotContainsNoSecrets = (value, depth = 0) => {
  if (depth > 12) throw new Error('TRUSTED_DEVICE_SNAPSHOT_DEPTH_INVALID')
  if (Array.isArray(value)) {
    for (const item of value) assertSnapshotContainsNoSecrets(item, depth + 1)
    return
  }
  if (!plainObject(value)) return
  for (const [key, child] of Object.entries(value)) {
    if (forbiddenSnapshotKey.test(key)) {
      throw new Error('TRUSTED_DEVICE_SNAPSHOT_SECRET_FIELD_REJECTED')
    }
    assertSnapshotContainsNoSecrets(child, depth + 1)
  }
}

export const validateTrustedDeviceSnapshot = ({
  snapshot,
  hotel,
  requiredSourceContracts = null,
  requiredPseudonymKey = null,
  now = new Date(),
}) => {
  assertExactKeys(snapshot, SNAPSHOT_KEYS, 'TRUSTED_DEVICE_SNAPSHOT_INVALID')
  if (
    snapshot.schemaVersion !== 1
    || snapshot.sourceSystem !== 'MEITUAN_BIEYANGHONG'
    || snapshot.tenantId !== hotel.tenantId
    || snapshot.hotelId !== hotel.hotelId
    || typeof snapshot.collectionRunId !== 'string'
    || !/^[0-9a-f-]{36}$/iu.test(snapshot.collectionRunId)
    || typeof snapshot.businessDate !== 'string'
    || !/^\d{4}-\d{2}-\d{2}$/u.test(snapshot.businessDate)
    || !nullableIsoDate(snapshot.businessDateStartedAt)
    || (
      snapshot.previousBusinessDate !== null
      && (
        typeof snapshot.previousBusinessDate !== 'string'
        || !/^\d{4}-\d{2}-\d{2}$/u.test(snapshot.previousBusinessDate)
      )
    )
    || typeof snapshot.businessDateChanged !== 'boolean'
    || !ALLOWED_COMPLETENESS.has(snapshot.completeness)
  ) {
    throw new Error('TRUSTED_DEVICE_SNAPSHOT_SCOPE_INVALID')
  }
  const observedAt = safeDate(snapshot.observedAt)
  if (
    !observedAt
    || Math.abs(now.getTime() - observedAt.getTime()) > 30 * 60_000
  ) {
    throw new Error('TRUSTED_DEVICE_SNAPSHOT_TIME_INVALID')
  }
  assertArrayLimit(snapshot.sources, 10, 'TRUSTED_DEVICE_SNAPSHOT_SOURCES_INVALID')
  assertArrayLimit(snapshot.orders, 2_000, 'TRUSTED_DEVICE_SNAPSHOT_ORDERS_INVALID')
  assertArrayLimit(snapshot.futureDaily, 400, 'TRUSTED_DEVICE_SNAPSHOT_FUTURE_INVALID')
  assertArrayLimit(snapshot.physicalInventory, 500, 'TRUSTED_DEVICE_SNAPSHOT_INVENTORY_INVALID')
  assertArrayLimit(snapshot.roomForecast, 500, 'TRUSTED_DEVICE_SNAPSHOT_FORECAST_INVALID')
  if (snapshot.orders.length !== 0) {
    throw new Error('TRUSTED_DEVICE_SNAPSHOT_ORDERS_MUST_BE_REDACTED')
  }
  if (
    Object.hasOwn(snapshot, 'dailyOrderSummary')
    && !normalizeDailyOrderSummary(snapshot.dailyOrderSummary, {
      businessDate: snapshot.businessDate,
    })
  ) throw new Error('TRUSTED_DEVICE_SNAPSHOT_ORDER_SUMMARY_INVALID')
  for (const source of snapshot.sources) {
    assertExactKeys(source, SOURCE_KEYS, 'TRUSTED_DEVICE_SNAPSHOT_SOURCES_INVALID')
    if (
      typeof source.sourceId !== 'string'
      || !/^[0-9a-f-]{36}$/iu.test(source.sourceId)
      || typeof source.sourceCode !== 'string'
      || !/^[A-Z0-9][A-Za-z0-9_-]{1,80}$/u.test(source.sourceCode)
      || typeof source.reportType !== 'string'
      || !/^[A-Z0-9][A-Z0-9_-]{1,63}$/u.test(source.reportType)
      || !ALLOWED_COMPLETENESS.has(source.completeness)
      || !safeDate(source.observedAt)
      || !safeDate(source.ingestedAt)
      || (
        source.errorCode !== null
        && (
          typeof source.errorCode !== 'string'
          || !/^[A-Z0-9][A-Z0-9_-]{1,80}$/u.test(source.errorCode)
        )
      )
    ) throw new Error('TRUSTED_DEVICE_SNAPSHOT_SOURCES_INVALID')
  }
  if (snapshot.overview !== null) {
    assertOverviewRow(snapshot.overview, 'TRUSTED_DEVICE_SNAPSHOT_OVERVIEW_INVALID')
  }
  for (const row of snapshot.futureDaily) {
    assertOverviewRow(row, 'TRUSTED_DEVICE_SNAPSHOT_FUTURE_INVALID')
  }
  for (const row of snapshot.physicalInventory) assertInventoryRow(row)
  for (const row of snapshot.roomForecast) assertInventoryRow(row)
  if (requiredPseudonymKey !== null) {
    const key = typeof requiredPseudonymKey === 'string'
      ? Buffer.from(requiredPseudonymKey, 'base64url')
      : Buffer.alloc(0)
    if (key.length !== 32) {
      throw new Error('TRUSTED_DEVICE_SNAPSHOT_IDENTITY_INVALID')
    }
    for (const row of [...snapshot.physicalInventory, ...snapshot.roomForecast]) {
      const code = createHmac('sha256', key)
        .update(`room-type:${row.displayName}`)
        .digest('hex')
        .slice(0, 16)
      if (
        row.physicalRoomTypeCode !== `PMS-${code}`
        || row.inventoryPoolId !== `PMS-${code}`
      ) throw new Error('TRUSTED_DEVICE_SNAPSHOT_IDENTITY_INVALID')
    }
  }
  assertHourlyDelta(snapshot.hourlyDelta)
  assertFutureBookingChanges(snapshot.futureBookingChanges)
  if (requiredSourceContracts !== null) {
    if (!Array.isArray(requiredSourceContracts)) {
      throw new Error('TRUSTED_DEVICE_SNAPSHOT_CONFIG_MISMATCH')
    }
    const canonicalContract = (source) => ({
      sourceId: source?.sourceId,
      sourceCode: source?.sourceCode,
      reportType: source?.reportType,
    })
    const expected = requiredSourceContracts
      .map(canonicalContract)
      .sort((left, right) => left.sourceId.localeCompare(right.sourceId))
    const actual = snapshot.sources
      .map(canonicalContract)
      .sort((left, right) => left.sourceId.localeCompare(right.sourceId))
    if (
      expected.some((source) =>
        typeof source.sourceId !== 'string'
        || typeof source.sourceCode !== 'string'
        || typeof source.reportType !== 'string')
      || expected.length !== new Set(expected.map((source) => source.sourceId)).size
      || actual.length !== new Set(actual.map((source) => source.sourceId)).size
      || stableJson(actual) !== stableJson(expected)
    ) throw new Error('TRUSTED_DEVICE_SNAPSHOT_CONFIG_MISMATCH')
  }
  assertCompleteSnapshotPayload(snapshot)
  assertSnapshotContainsNoSecrets(snapshot)
  return snapshot
}

const defaultState = () => ({
  schemaVersion: 1,
  enrollment: null,
  scopeAnchor: null,
  devices: [],
})

const loadState = (path, hotelId) => {
  if (!path || !existsSync(path)) return defaultState()
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8'))
    if (
      !plainObject(parsed)
      || parsed.schemaVersion !== 1
      || !Array.isArray(parsed.devices)
      || (parsed.scopeAnchor !== undefined && parsed.scopeAnchor !== null
        && !validScopeAnchor(parsed.scopeAnchor))
      || (
        parsed.enrollment !== null
        && (
          !plainObject(parsed.enrollment)
          || parsed.enrollment.hotelId !== hotelId
        )
      )
      || parsed.devices.some((device) =>
        !plainObject(device) || device.hotelId !== hotelId)
    ) throw new Error('TRUSTED_DEVICE_REGISTRY_INVALID')
    return {
      schemaVersion: 1,
      enrollment: parsed.enrollment,
      scopeAnchor: parsed.scopeAnchor ?? null,
      devices: parsed.devices.slice(-10),
    }
  } catch (error) {
    if (error?.message === 'TRUSTED_DEVICE_REGISTRY_INVALID') throw error
    throw new Error('TRUSTED_DEVICE_REGISTRY_INVALID')
  }
}

const publicDevice = (device, scopeAnchor = null) => device ? ({
  deviceId: device.deviceId,
  label: device.label,
  status: device.status,
  enrolledAt: device.enrolledAt,
  lastSeenAt: device.lastSeenAt ?? null,
  lastSnapshotAt: device.lastSnapshotAt ?? null,
  lastBusinessDate: device.lastBusinessDate ?? null,
  lastCompleteness: device.lastCompleteness ?? null,
  cutoverAt: device.cutoverAt ?? null,
  cutoverReady: Boolean(device.cutoverAt),
  cutoverPending: Boolean(device.cutoverPendingAt),
  reenrollRequired: !plainObject(device.sealedScopeProofKey),
  scopeApprovalStatus: scopeApprovalStatus(scopeAnchor),
  scopeApprovedAt:
    scopeApprovalStatus(scopeAnchor) === 'APPROVED'
      ? scopeAnchor.approvedAt ?? null
      : null,
}) : null

export const createTrustedDeviceIntakeStore = ({
  path = null,
  hotel,
  sealStoreScope = null,
  openStoreScope = null,
  sealDeviceScopeProofKey = null,
  openDeviceScopeProofKey = null,
}) => {
  if (
    !hotel
    || typeof hotel.hotelCode !== 'string'
    || !/^[A-Z0-9][A-Z0-9_-]{0,15}$/u.test(hotel.hotelCode)
    || hotel.pmsSystemCode !== 'MEITUAN_BIEYANGHONG'
    || typeof hotel.hotelId !== 'string'
    || typeof hotel.tenantId !== 'string'
    || typeof sealStoreScope !== 'function'
    || typeof openStoreScope !== 'function'
    || typeof sealDeviceScopeProofKey !== 'function'
    || typeof openDeviceScopeProofKey !== 'function'
  ) throw new Error('TRUSTED_DEVICE_HOTEL_INVALID')

  let state = loadState(path, hotel.hotelId)
  if (validScopeAnchor(state.scopeAnchor)) {
    canonicalPmsLoginHotelId(openStoreScope(
      state.scopeAnchor.sealedExpectedPmsLoginHotelId,
    ))
  }
  for (const device of state.devices) {
    if (device.sealedScopeProofKey === undefined) continue
    if (!plainObject(device.sealedScopeProofKey)) {
      throw new Error('TRUSTED_DEVICE_REGISTRY_INVALID')
    }
    const proofKey = openDeviceScopeProofKey(
      device.sealedScopeProofKey,
      device.deviceId,
    )
    if (Buffer.from(proofKey, 'base64url').length !== 32) {
      throw new Error('TRUSTED_DEVICE_REGISTRY_INVALID')
    }
  }
  const scopeChallengesById = new Map()
  const scopeReceiptsByValue = new Map()

  const pruneScopeArtifacts = (now) => {
    for (const [key, value] of scopeChallengesById) {
      if (safeDate(value.expiresAt)?.getTime() <= now.getTime()) {
        scopeChallengesById.delete(key)
      }
    }
    for (const [key, value] of scopeReceiptsByValue) {
      if (safeDate(value.expiresAt)?.getTime() <= now.getTime()) {
        scopeReceiptsByValue.delete(key)
      }
    }
    while (scopeChallengesById.size >= MAX_SCOPE_ARTIFACTS) {
      scopeChallengesById.delete(scopeChallengesById.keys().next().value)
    }
    while (scopeReceiptsByValue.size >= MAX_SCOPE_ARTIFACTS) {
      scopeReceiptsByValue.delete(scopeReceiptsByValue.keys().next().value)
    }
  }

  const persist = () => {
    if (!path) return
    mkdirSync(dirname(path), { recursive: true })
    const temporaryPath = `${path}.${process.pid}.tmp`
    writeFileSync(
      temporaryPath,
      `${JSON.stringify(state, null, 2)}\n`,
      { encoding: 'utf8', mode: 0o600 },
    )
    renameSync(temporaryPath, path)
  }

  const activeDevice = () =>
    state.devices.findLast((device) => device.status === 'ACTIVE') ?? null
  const publicScopedDevice = (device) => publicDevice(device, state.scopeAnchor)

  const status = (now = new Date()) => {
    const enrollmentExpiresAt = safeDate(state.enrollment?.expiresAt)
    const enrollmentPending = Boolean(
      state.enrollment
      && !state.enrollment.consumedAt
      && enrollmentExpiresAt
      && enrollmentExpiresAt.getTime() > now.getTime(),
    )
    return {
      eligible: true,
      mode: 'STORE_TRUSTED_DEVICE',
      hotelCode: hotel.hotelCode,
      hotelName: hotel.hotelName,
      enrollmentTtlMinutes: TRUSTED_DEVICE_ENROLLMENT_TTL_MS / 60_000,
      enrollmentPending,
      enrollmentExpiresAt: enrollmentPending ? state.enrollment.expiresAt : null,
      device: publicScopedDevice(activeDevice()),
    }
  }

  const createEnrollment = ({ label = '', now = new Date() } = {}) => {
    const random = randomBytes(10).toString('base64url').toUpperCase()
      .replace(/[^A-Z0-9]/gu, '').padEnd(12, 'X').slice(0, 12)
    const code = `${hotel.hotelCode}-${random.slice(0, 4)}-${random.slice(4, 8)}-${random.slice(8, 12)}`
    const previousState = structuredClone(state)
    state.enrollment = {
      enrollmentId: randomUUID(),
      hotelId: hotel.hotelId,
      hotelCode: hotel.hotelCode,
      label: canonicalLabel(label, `${hotel.hotelCode}门店可信设备`),
      codeHash: sha256(code),
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + TRUSTED_DEVICE_ENROLLMENT_TTL_MS).toISOString(),
      consumedAt: null,
    }
    try {
      persist()
    } catch (error) {
      state = previousState
      throw error
    }
    return {
      enrollmentCode: code,
      expiresAt: state.enrollment.expiresAt,
      hotelCode: hotel.hotelCode,
      label: state.enrollment.label,
    }
  }

  const enroll = ({
    hotelCode,
    enrollmentCode,
    publicKeyPem,
    label = '',
    now = new Date(),
  }) => {
    const enrollment = state.enrollment
    const expiresAt = safeDate(enrollment?.expiresAt)
    if (
      hotelCode !== hotel.hotelCode
      || !enrollment
      || enrollment.consumedAt
      || !expiresAt
      || expiresAt.getTime() <= now.getTime()
      || typeof enrollmentCode !== 'string'
      || !timingSafeTextEqual(sha256(enrollmentCode), enrollment.codeHash)
    ) throw new Error('TRUSTED_DEVICE_ENROLLMENT_INVALID')

    const publicKey = normalizedPublicKey(publicKeyPem)
    const previousState = structuredClone(state)
    state.devices = state.devices.map((device) =>
      device.status === 'ACTIVE'
        ? { ...device, status: 'REVOKED', revokedAt: now.toISOString() }
        : device)
    const deviceId = randomUUID()
    const scopeProofKey = randomBytes(32).toString('base64url')
    const device = {
      deviceId,
      hotelId: hotel.hotelId,
      hotelCode: hotel.hotelCode,
      label: canonicalLabel(label, enrollment.label),
      status: 'ACTIVE',
      publicKeyPem: publicKey,
      sealedScopeProofKey: sealDeviceScopeProofKey(scopeProofKey, deviceId),
      enrolledAt: now.toISOString(),
      revokedAt: null,
      lastSeenAt: null,
      lastSnapshotAt: null,
      lastBusinessDate: null,
      lastCompleteness: null,
      cutoverAt: null,
      recentNonces: [],
    }
    state.devices.push(device)
    state.enrollment = { ...enrollment, consumedAt: now.toISOString() }
    try {
      persist()
    } catch (error) {
      state = previousState
      throw error
    }
    return {
      ...publicScopedDevice(activeDevice()),
      scopeProofKey,
    }
  }

  const issueScopeChallenge = ({ deviceId, now = new Date() }) => {
    const device = state.devices.find((candidate) =>
      candidate.deviceId === deviceId && candidate.status === 'ACTIVE')
    if (!device) throw new Error('TRUSTED_DEVICE_NOT_ACTIVE')
    pruneScopeArtifacts(now)
    const challenge = {
      challengeId: randomUUID(),
      deviceId,
      value: randomBytes(32).toString('base64url'),
      expiresAt: new Date(now.getTime() + TRUSTED_DEVICE_SCOPE_TTL_MS)
        .toISOString(),
    }
    scopeChallengesById.set(challenge.challengeId, challenge)
    return {
      challengeId: challenge.challengeId,
      value: challenge.value,
      expiresAt: challenge.expiresAt,
    }
  }

  const verifyScopeProof = ({
    deviceId,
    challengeId,
    proof,
    expectedPmsLoginHotelId = null,
    configDigest,
    now = new Date(),
  }) => {
    const device = state.devices.find((candidate) =>
      candidate.deviceId === deviceId && candidate.status === 'ACTIVE')
    if (!device) throw new Error('TRUSTED_DEVICE_NOT_ACTIVE')
    pruneScopeArtifacts(now)
    const challenge = scopeChallengesById.get(challengeId)
    scopeChallengesById.delete(challengeId)
    if (
      !challenge
      || challenge.deviceId !== deviceId
      || challenge.challengeId !== challengeId
      || safeDate(challenge.expiresAt)?.getTime() <= now.getTime()
      || typeof proof !== 'string'
      || !/^[0-9a-f]{64}$/u.test(proof)
      || typeof configDigest !== 'string'
      || !/^[0-9a-f]{64}$/u.test(configDigest)
    ) throw new Error('TRUSTED_DEVICE_STORE_SCOPE_INVALID')
    const anchor = validScopeAnchor(state.scopeAnchor)
      ? state.scopeAnchor
      : null
    const expectedScope = anchor
      ? canonicalPmsLoginHotelId(openStoreScope(
          anchor.sealedExpectedPmsLoginHotelId,
        ))
      : canonicalPmsLoginHotelId(expectedPmsLoginHotelId)
    if (!plainObject(device.sealedScopeProofKey)) {
      throw new Error('TRUSTED_DEVICE_REENROLL_REQUIRED')
    }
    const scopeProofKey = openDeviceScopeProofKey(
      device.sealedScopeProofKey,
      device.deviceId,
    )
    const expectedProof = trustedDeviceScopeProof({
      hotelCode: hotel.hotelCode,
      deviceId,
      challenge: challenge.value,
      pmsLoginHotelId: expectedScope,
      scopeProofKey,
    })
    if (!timingSafeTextEqual(proof, expectedProof)) {
      throw new Error('TRUSTED_DEVICE_STORE_SCOPE_INVALID')
    }
    const previousAnchor = state.scopeAnchor
    if (!anchor) {
      state.scopeAnchor = {
        sealedExpectedPmsLoginHotelId: sealStoreScope(expectedScope),
        epoch: randomUUID(),
        boundAt: now.toISOString(),
        approvalStatus: 'PENDING',
        approvedAt: null,
      }
    }
    const receipt = {
      value: randomBytes(32).toString('base64url'),
      deviceId,
      scopeAnchorEpoch: state.scopeAnchor.epoch,
      configDigest,
      expiresAt: new Date(now.getTime() + TRUSTED_DEVICE_SCOPE_TTL_MS)
        .toISOString(),
    }
    try {
      persist()
      scopeReceiptsByValue.set(receipt.value, receipt)
    } catch (error) {
      state.scopeAnchor = previousAnchor
      throw error
    }
    return { scopeReceipt: receipt.value, expiresAt: receipt.expiresAt }
  }

  const hasBoundStoreScope = ({ deviceId }) => {
    const device = state.devices.find((candidate) =>
      candidate.deviceId === deviceId && candidate.status === 'ACTIVE')
    return Boolean(device && validScopeAnchor(state.scopeAnchor))
  }

  const approveStoreScope = ({ now = new Date() } = {}) => {
    const device = activeDevice()
    if (!device || !validScopeAnchor(state.scopeAnchor)) {
      throw new Error('TRUSTED_DEVICE_STORE_SCOPE_NOT_BOUND')
    }
    const previousState = structuredClone(state)
    try {
      state.scopeAnchor.approvalStatus = 'APPROVED'
      state.scopeAnchor.approvedAt = now.toISOString()
      persist()
    } catch (error) {
      state = previousState
      throw error
    }
    return publicScopedDevice(activeDevice())
  }

  const consumeScopeReceipt = ({
    deviceId,
    scopeReceipt,
    configDigest,
    now = new Date(),
  }) => {
    pruneScopeArtifacts(now)
    const receipt = scopeReceiptsByValue.get(scopeReceipt)
    scopeReceiptsByValue.delete(scopeReceipt)
    if (
      !receipt
      || receipt.deviceId !== deviceId
      || safeDate(receipt.expiresAt)?.getTime() <= now.getTime()
      || typeof scopeReceipt !== 'string'
      || !timingSafeTextEqual(scopeReceipt, receipt.value)
    ) throw new Error('TRUSTED_DEVICE_STORE_SCOPE_INVALID')
    const device = state.devices.find((candidate) =>
      candidate.deviceId === deviceId && candidate.status === 'ACTIVE')
    if (
      !device
      || !validScopeAnchor(state.scopeAnchor)
      || receipt.scopeAnchorEpoch !== state.scopeAnchor.epoch
      || typeof configDigest !== 'string'
      || !/^[0-9a-f]{64}$/u.test(configDigest)
      || receipt.configDigest !== configDigest
    ) throw new Error('TRUSTED_DEVICE_SCOPE_CONFIG_CHANGED')
    return true
  }

  const verifyRequest = ({ method, path: requestPath, body, headers, now = new Date() }) => {
    const deviceId = String(headers['x-sfg-device-id'] ?? '')
    const timestamp = String(headers['x-sfg-device-timestamp'] ?? '')
    const nonce = String(headers['x-sfg-device-nonce'] ?? '')
    const signature = String(headers['x-sfg-device-signature'] ?? '')
    const hotelCode = String(body?.hotelCode ?? '')
    const signedAt = safeDate(timestamp)
    if (
      hotelCode !== hotel.hotelCode
      || !/^[0-9a-f-]{36}$/iu.test(deviceId)
      || !signedAt
      || Math.abs(now.getTime() - signedAt.getTime()) > TRUSTED_DEVICE_REQUEST_SKEW_MS
      || !/^[A-Za-z0-9_-]{16,120}$/u.test(nonce)
      || !/^[A-Za-z0-9_-]{40,160}$/u.test(signature)
    ) throw new Error('TRUSTED_DEVICE_SIGNATURE_INVALID')
    const device = state.devices.find((candidate) =>
      candidate.deviceId === deviceId && candidate.status === 'ACTIVE')
    if (!device) throw new Error('TRUSTED_DEVICE_NOT_ACTIVE')
    const recent = Array.isArray(device.recentNonces) ? device.recentNonces : []
    if (recent.some((item) => item?.nonce === nonce)) {
      throw new Error('TRUSTED_DEVICE_REPLAY_REJECTED')
    }
    let signatureBuffer
    try {
      signatureBuffer = Buffer.from(signature, 'base64url')
    } catch {
      throw new Error('TRUSTED_DEVICE_SIGNATURE_INVALID')
    }
    const message = trustedDeviceCanonicalMessage({
      method,
      path: requestPath,
      hotelCode,
      deviceId,
      timestamp,
      nonce,
      body,
    })
    if (!verify(null, Buffer.from(message), device.publicKeyPem, signatureBuffer)) {
      throw new Error('TRUSTED_DEVICE_SIGNATURE_INVALID')
    }
    device.recentNonces = [
      ...recent.filter((item) =>
        safeDate(item?.seenAt)?.getTime() > now.getTime() - TRUSTED_DEVICE_REQUEST_SKEW_MS),
      { nonce, seenAt: now.toISOString() },
    ].slice(-MAX_NONCES_PER_DEVICE)
    device.lastSeenAt = now.toISOString()
    persist()
    return publicScopedDevice(device)
  }

  const acceptSnapshot = ({
    deviceId,
    snapshot,
    now = new Date(),
  }) => {
    const device = state.devices.find((candidate) =>
      candidate.deviceId === deviceId && candidate.status === 'ACTIVE')
    if (!device) throw new Error('TRUSTED_DEVICE_NOT_ACTIVE')
    validateTrustedDeviceSnapshot({ snapshot, hotel, now })
    const previousState = structuredClone(state)
    try {
      device.lastSeenAt = now.toISOString()
      device.lastSnapshotAt = snapshot.observedAt
      device.lastBusinessDate = snapshot.businessDate
      device.lastCompleteness = snapshot.completeness
      persist()
    } catch (error) {
      state = previousState
      throw error
    }
    return publicScopedDevice(activeDevice())
  }

  const beginCutover = ({
    deviceId,
    snapshot,
    snapshotHash,
    allowPendingReplacement = false,
    now = new Date(),
  }) => {
    const device = state.devices.find((candidate) =>
      candidate.deviceId === deviceId && candidate.status === 'ACTIVE')
    if (!device) throw new Error('TRUSTED_DEVICE_NOT_ACTIVE')
    validateTrustedDeviceSnapshot({ snapshot, hotel, now })
    if (
      snapshot.completeness !== 'COMPLETE'
      || typeof snapshotHash !== 'string'
      || !/^[0-9a-f]{64}$/u.test(snapshotHash)
    ) throw new Error('TRUSTED_DEVICE_CUTOVER_REQUIRES_COMPLETE')
    if (scopeApprovalStatus(state.scopeAnchor) !== 'APPROVED') {
      throw new Error('TRUSTED_DEVICE_SCOPE_APPROVAL_REQUIRED')
    }
    if (device.cutoverAt) return publicScopedDevice(device)
    if (device.cutoverPendingAt) {
      if (
        device.cutoverPendingCollectionRunId !== snapshot.collectionRunId
        || device.cutoverPendingSnapshotHash !== snapshotHash
      ) {
        if (!allowPendingReplacement) {
          throw new Error('TRUSTED_DEVICE_CUTOVER_COMMIT_INVALID')
        }
      } else {
        return publicScopedDevice(device)
      }
    }
    const previousState = structuredClone(state)
    try {
      device.cutoverPendingAt = now.toISOString()
      device.cutoverPendingCollectionRunId = snapshot.collectionRunId
      device.cutoverPendingSnapshotHash = snapshotHash
      persist()
    } catch (error) {
      state = previousState
      throw error
    }
    return publicScopedDevice(activeDevice())
  }

  const completeCutover = ({
    deviceId,
    collectionRunId,
    snapshotHash,
    now = new Date(),
  }) => {
    const device = state.devices.find((candidate) =>
      candidate.deviceId === deviceId && candidate.status === 'ACTIVE')
    if (!device) throw new Error('TRUSTED_DEVICE_NOT_ACTIVE')
    if (device.cutoverAt) return publicScopedDevice(device)
    if (
      device.cutoverPendingCollectionRunId !== collectionRunId
      || device.cutoverPendingSnapshotHash !== snapshotHash
    ) throw new Error('TRUSTED_DEVICE_CUTOVER_COMMIT_INVALID')
    const previousState = structuredClone(state)
    try {
      device.cutoverAt = now.toISOString()
      device.cutoverPendingAt = null
      device.cutoverPendingCollectionRunId = null
      device.cutoverPendingSnapshotHash = null
      persist()
    } catch (error) {
      state = previousState
      throw error
    }
    return publicScopedDevice(activeDevice())
  }

  const legacyCollectionBlocked = () => {
    const device = activeDevice()
    return Boolean(device?.cutoverAt || device?.cutoverPendingAt)
  }

  const pendingCutover = () => {
    const device = activeDevice()
    if (!device?.cutoverPendingAt) return null
    return {
      deviceId: device.deviceId,
      collectionRunId: device.cutoverPendingCollectionRunId,
      snapshotHash: device.cutoverPendingSnapshotHash,
    }
  }

  const revoke = ({ now = new Date() } = {}) => {
    const device = activeDevice()
    if (!device && !state.enrollment) return null
    const previousState = structuredClone(state)
    if (device) {
      device.status = 'REVOKED'
      device.revokedAt = now.toISOString()
    }
    state.enrollment = null
    try {
      persist()
    } catch (error) {
      state = previousState
      throw error
    }
    if (device) {
      for (const [key, value] of scopeChallengesById) {
        if (value.deviceId === device.deviceId) scopeChallengesById.delete(key)
      }
      for (const [key, value] of scopeReceiptsByValue) {
        if (value.deviceId === device.deviceId) scopeReceiptsByValue.delete(key)
      }
    }
    return publicScopedDevice(device)
  }

  return {
    status,
    createEnrollment,
    enroll,
    verifyRequest,
    issueScopeChallenge,
    verifyScopeProof,
    hasBoundStoreScope,
    approveStoreScope,
    consumeScopeReceipt,
    acceptSnapshot,
    beginCutover,
    completeCutover,
    pendingCutover,
    legacyCollectionBlocked,
    revoke,
  }
}
