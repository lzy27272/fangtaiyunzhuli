import {
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

export const TRUSTED_DEVICE_PILOT_HOTEL_CODE = '001'
export const TRUSTED_DEVICE_ENROLLMENT_TTL_MS = 15 * 60_000
export const TRUSTED_DEVICE_REQUEST_SKEW_MS = 5 * 60_000

const MAX_NONCES_PER_DEVICE = 120
const MAX_LABEL_LENGTH = 60
const ALLOWED_COMPLETENESS = new Set(['COMPLETE', 'PARTIAL', 'UNAVAILABLE'])

const sha256 = (value) => createHash('sha256').update(value).digest('hex')

export const stableJson = (value, depth = 0) => {
  if (depth > 20) throw new Error('TRUSTED_DEVICE_BODY_DEPTH_INVALID')
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

const canonicalLabel = (value, fallback = '001门店可信设备') => {
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

export const validateTrustedDeviceSnapshot = ({ snapshot, hotel, now = new Date() }) => {
  if (!plainObject(snapshot)) throw new Error('TRUSTED_DEVICE_SNAPSHOT_INVALID')
  if (
    snapshot.schemaVersion !== 1
    || snapshot.sourceSystem !== 'MEITUAN_BIEYANGHONG'
    || snapshot.tenantId !== hotel.tenantId
    || snapshot.hotelId !== hotel.hotelId
    || typeof snapshot.collectionRunId !== 'string'
    || !/^[0-9a-f-]{36}$/iu.test(snapshot.collectionRunId)
    || typeof snapshot.businessDate !== 'string'
    || !/^\d{4}-\d{2}-\d{2}$/u.test(snapshot.businessDate)
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
  assertSnapshotContainsNoSecrets(snapshot)
  return snapshot
}

const defaultState = () => ({
  schemaVersion: 1,
  enrollment: null,
  devices: [],
})

const loadState = (path, hotelId) => {
  if (!path || !existsSync(path)) return defaultState()
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8'))
    if (!plainObject(parsed) || !Array.isArray(parsed.devices)) return defaultState()
    return {
      schemaVersion: 1,
      enrollment:
        plainObject(parsed.enrollment) && parsed.enrollment.hotelId === hotelId
          ? parsed.enrollment
          : null,
      devices: parsed.devices
        .filter((device) => plainObject(device) && device.hotelId === hotelId)
        .slice(-10),
    }
  } catch {
    return defaultState()
  }
}

const publicDevice = (device) => device ? ({
  deviceId: device.deviceId,
  label: device.label,
  status: device.status,
  enrolledAt: device.enrolledAt,
  lastSeenAt: device.lastSeenAt ?? null,
  lastSnapshotAt: device.lastSnapshotAt ?? null,
  lastBusinessDate: device.lastBusinessDate ?? null,
  lastCompleteness: device.lastCompleteness ?? null,
}) : null

export const createTrustedDeviceIntakeStore = ({ path = null, hotel }) => {
  if (
    !hotel
    || hotel.hotelCode !== TRUSTED_DEVICE_PILOT_HOTEL_CODE
    || typeof hotel.hotelId !== 'string'
    || typeof hotel.tenantId !== 'string'
  ) throw new Error('TRUSTED_DEVICE_PILOT_HOTEL_INVALID')

  let state = loadState(path, hotel.hotelId)

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
      device: publicDevice(activeDevice()),
    }
  }

  const createEnrollment = ({ label = '', now = new Date() } = {}) => {
    const random = randomBytes(10).toString('base64url').toUpperCase()
      .replace(/[^A-Z0-9]/gu, '').padEnd(12, 'X').slice(0, 12)
    const code = `${hotel.hotelCode}-${random.slice(0, 4)}-${random.slice(4, 8)}-${random.slice(8, 12)}`
    state.enrollment = {
      enrollmentId: randomUUID(),
      hotelId: hotel.hotelId,
      hotelCode: hotel.hotelCode,
      label: canonicalLabel(label),
      codeHash: sha256(code),
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + TRUSTED_DEVICE_ENROLLMENT_TTL_MS).toISOString(),
      consumedAt: null,
    }
    persist()
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
    state.devices = state.devices.map((device) =>
      device.status === 'ACTIVE'
        ? { ...device, status: 'REVOKED', revokedAt: now.toISOString() }
        : device)
    const device = {
      deviceId: randomUUID(),
      hotelId: hotel.hotelId,
      hotelCode: hotel.hotelCode,
      label: canonicalLabel(label, enrollment.label),
      status: 'ACTIVE',
      publicKeyPem: publicKey,
      enrolledAt: now.toISOString(),
      revokedAt: null,
      lastSeenAt: null,
      lastSnapshotAt: null,
      lastBusinessDate: null,
      lastCompleteness: null,
      recentNonces: [],
    }
    state.devices.push(device)
    state.enrollment = { ...enrollment, consumedAt: now.toISOString() }
    persist()
    return publicDevice(device)
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
    return publicDevice(device)
  }

  const acceptSnapshot = ({ deviceId, snapshot, now = new Date() }) => {
    const device = state.devices.find((candidate) =>
      candidate.deviceId === deviceId && candidate.status === 'ACTIVE')
    if (!device) throw new Error('TRUSTED_DEVICE_NOT_ACTIVE')
    validateTrustedDeviceSnapshot({ snapshot, hotel, now })
    device.lastSeenAt = now.toISOString()
    device.lastSnapshotAt = snapshot.observedAt
    device.lastBusinessDate = snapshot.businessDate
    device.lastCompleteness = snapshot.completeness
    persist()
    return publicDevice(device)
  }

  const revoke = ({ now = new Date() } = {}) => {
    const device = activeDevice()
    if (!device) return null
    device.status = 'REVOKED'
    device.revokedAt = now.toISOString()
    persist()
    return publicDevice(device)
  }

  return { status, createEnrollment, enroll, verifyRequest, acceptSnapshot, revoke }
}
