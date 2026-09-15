import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from 'node:crypto'
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'

export const ANALYTICS_RETENTION_POLICY = Object.freeze({
  hourlyMonths: 48,
  dailyYears: 2,
  aggregateYears: 5,
  rawEvidenceMinimumDays: 30,
  rawEvidenceMaximumDays: 90,
  rawEvidenceDefaultDays: 90,
  dailyBackupCount: 30,
  monthlyBackupCount: 12,
  yearlyBackupCount: 3,
  offsiteCopyRequired: true,
})

const ENCRYPTION_ALGORITHM = 'aes-256-gcm'
const MAX_RAW_EVIDENCE_BYTES = 12 * 1024 * 1024
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/u
const SHA256_PATTERN = /^[a-f0-9]{64}$/u
const SENSITIVE_KEY_PATTERN =
  /password|passwd|pwd|secret|token|cookie|authorization|session|jsessionid|captcha|verification|mobile|phone|telephone|email|idcard|identity|certificate|guest|customer|contact|member|address|order(?:no|number|id)|booking(?:no|number|id)/iu
const PHONE_PATTERN = /(?<!\d)1[3-9]\d{9}(?!\d)/gu
const EMAIL_PATTERN = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/giu
const IDENTITY_PATTERN = /(?<!\d)\d{17}[0-9X](?!\d)/giu

const finiteNumber = (value) => {
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

const boundedText = (value, maximum = 160) =>
  typeof value === 'string' && value.trim()
    ? value.trim().slice(0, maximum)
    : null

const safeDate = (value) => {
  const parsed = new Date(value ?? '')
  return Number.isFinite(parsed.getTime()) ? parsed : null
}

const canonicalDate = (value) =>
  typeof value === 'string' && DATE_PATTERN.test(value) ? value : null

const decodeEncryptionKey = (encoded) => {
  if (typeof encoded !== 'string') throw new Error('ANALYTICS_RAW_KEY_REQUIRED')
  const key = Buffer.from(encoded, 'base64url')
  if (key.length !== 32) throw new Error('ANALYTICS_RAW_KEY_INVALID')
  return key
}

const normalizedOccupancy = (value) => {
  const parsed = finiteNumber(value)
  if (parsed === null || parsed < 0) return null
  if (parsed <= 1) return parsed
  return parsed <= 100 ? parsed / 100 : null
}

const safeDailyOrderSummary = (value) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return sanitizeValue(value)
}

const safeFutureDaily = (value) => {
  if (!Array.isArray(value)) return []
  return value.slice(0, 90).map((row) => ({
    stayDate: canonicalDate(row?.stayDate),
    roomCount: finiteNumber(row?.roomCount),
    availableRooms: finiteNumber(row?.availableRooms),
    soldRooms: finiteNumber(row?.soldRooms),
    orderRooms: finiteNumber(row?.orderRooms),
    checkinRooms: finiteNumber(row?.checkinRooms),
    roomRevenue: finiteNumber(row?.roomFee ?? row?.revenue),
    occupancyRate: normalizedOccupancy(row?.occupancyRate),
    adr: finiteNumber(row?.adr),
    revPar: finiteNumber(row?.revPar),
  })).filter((row) => row.stayDate)
}

const snapshotMeasures = (snapshot) => {
  const overview = snapshot?.overview ?? {}
  const soldRoomNights = finiteNumber(
    overview.roomNights ?? overview.soldRooms,
  )
  const availableRooms = finiteNumber(overview.availableRooms)
  const explicitRoomCount = finiteNumber(overview.roomCount)
  const effectiveSellableRoomNights = explicitRoomCount ?? (
    soldRoomNights !== null && availableRooms !== null
      ? soldRoomNights + availableRooms
      : null
  )
  return {
    roomRevenue: finiteNumber(overview.roomFee ?? overview.revenue),
    soldRoomNights,
    effectiveSellableRoomNights,
    availableRooms,
    occupancyRate: normalizedOccupancy(overview.occupancyRate),
    adr: finiteNumber(overview.adr),
    revPar: finiteNumber(overview.revPar),
  }
}

const hashJson = (value) => createHash('sha256')
  .update(JSON.stringify(value), 'utf8')
  .digest('hex')

const eventWithHashes = (event) => {
  const contentHash = hashJson(event)
  return {
    ...event,
    contentHash,
    idempotencyKey: hashJson({
      eventType: event.eventType,
      tenantId: event.tenantId,
      hotelId: event.hotelId,
      businessDate: event.businessDate ?? null,
      observedAt: event.observedAt,
      sourceId: event.sourceId ?? null,
      contentHash,
    }),
  }
}

const structuredSnapshotEvent = (snapshot, eventType) => {
  const businessDate = canonicalDate(snapshot?.businessDate)
  const observedAt = safeDate(snapshot?.observedAt)?.toISOString()
  if (
    !businessDate
    || !observedAt
    || typeof snapshot?.tenantId !== 'string'
    || typeof snapshot?.hotelId !== 'string'
  ) throw new Error('ANALYTICS_SNAPSHOT_INVALID')
  return eventWithHashes({
    schemaVersion: 1,
    eventType,
    tenantId: snapshot.tenantId,
    hotelId: snapshot.hotelId,
    businessDate,
    observedAt,
    sourceSystem: boundedText(snapshot.sourceSystem, 64) ?? 'UNKNOWN',
    completeness: ['COMPLETE', 'PARTIAL', 'UNAVAILABLE'].includes(
      snapshot.completeness,
    ) ? snapshot.completeness : 'UNAVAILABLE',
    collectionRunId: boundedText(snapshot.collectionRunId, 80),
    measures: snapshotMeasures(snapshot),
    dailyOrderSummary: safeDailyOrderSummary(snapshot.dailyOrderSummary),
    futureDaily: safeFutureDaily(snapshot.futureDaily),
    sourceCoverage: Array.isArray(snapshot.sources)
      ? snapshot.sources.slice(0, 32).map((source) => ({
          sourceId: boundedText(source?.sourceId, 96),
          sourceCode: boundedText(source?.sourceCode, 96),
          reportType: boundedText(source?.reportType, 64),
          completeness: boundedText(source?.completeness, 32),
          errorCode: boundedText(source?.errorCode, 96),
        }))
      : [],
  })
}

const latestFinalizableSnapshot = (snapshots, currentBusinessDate) => {
  if (!Array.isArray(snapshots) || snapshots.length === 0) return null
  const lastSnapshot = snapshots.at(-1)
  const previousDate = canonicalDate(lastSnapshot?.businessDate)
  // A daily fact is finalized once, at the first snapshot of the next
  // business day. Database idempotency is still the second line of defence,
  // but this transition check prevents needless duplicate spool events.
  if (previousDate === currentBusinessDate) return null
  if (!previousDate) return null
  const candidates = snapshots.filter((snapshot) =>
    snapshot?.businessDate === previousDate
    && snapshot?.completeness !== 'UNAVAILABLE'
    && snapshot?.overview)
  return candidates.at(-1) ?? null
}

const redactText = (value) => value
  .replace(PHONE_PATTERN, '[REDACTED_PHONE]')
  .replace(EMAIL_PATTERN, '[REDACTED_EMAIL]')
  .replace(IDENTITY_PATTERN, '[REDACTED_ID]')
  .slice(0, 4096)

export const sanitizeValue = (value, key = '') => {
  if (SENSITIVE_KEY_PATTERN.test(key)) return '[REDACTED]'
  if (typeof value === 'string') return redactText(value)
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'boolean' || value === null) return value
  if (Array.isArray(value)) {
    return value.slice(0, 100_000).map((item) => sanitizeValue(item))
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([childKey, childValue]) => [
        childKey,
        sanitizeValue(childValue, childKey),
      ]),
    )
  }
  return null
}

const safeRoot = (rootPath) => {
  if (typeof rootPath !== 'string' || !isAbsolute(rootPath)) {
    throw new Error('ANALYTICS_ROOT_ABSOLUTE_PATH_REQUIRED')
  }
  const resolved = resolve(rootPath)
  if (resolved === resolve(resolved, sep) || dirname(resolved) === resolved) {
    throw new Error('ANALYTICS_ROOT_UNSAFE')
  }
  return resolved
}

const safeRelativePath = (root, path) => {
  const resolved = resolve(path)
  const relativePath = relative(root, resolved)
  if (
    !relativePath
    || relativePath.startsWith(`..${sep}`)
    || relativePath === '..'
    || isAbsolute(relativePath)
  ) throw new Error('ANALYTICS_PATH_OUTSIDE_ROOT')
  return relativePath.split(sep).join('/')
}

const atomicWrite = (path, value) => {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
  const temporary = `${path}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`
  writeFileSync(temporary, value, { encoding: 'utf8', mode: 0o600 })
  renameSync(temporary, path)
}

const walkEvidenceFiles = (directory) => {
  if (!existsSync(directory)) return []
  const result = []
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) result.push(...walkEvidenceFiles(path))
    else if (entry.isFile() && entry.name.endsWith('.json.enc')) result.push(path)
  }
  return result
}

export const createAnalyticsRetentionStore = ({
  rootPath,
  encryptionKey,
  rawRetentionDays = ANALYTICS_RETENTION_POLICY.rawEvidenceDefaultDays,
}) => {
  const root = safeRoot(rootPath)
  const key = decodeEncryptionKey(encryptionKey)
  if (
    !Number.isInteger(rawRetentionDays)
    || rawRetentionDays < ANALYTICS_RETENTION_POLICY.rawEvidenceMinimumDays
    || rawRetentionDays > ANALYTICS_RETENTION_POLICY.rawEvidenceMaximumDays
  ) throw new Error('ANALYTICS_RAW_RETENTION_OUT_OF_RANGE')
  const spoolPath = join(root, 'spool', 'facts.pending.b64')
  const rawRoot = join(root, 'raw')

  const appendEvent = (event) => {
    mkdirSync(dirname(spoolPath), { recursive: true, mode: 0o700 })
    const encoded = Buffer.from(JSON.stringify(event), 'utf8').toString('base64')
    appendFileSync(spoolPath, `${encoded}\n`, { encoding: 'utf8', mode: 0o600 })
    return event
  }

  const recordSnapshot = ({ snapshot, previousSnapshots = [] }) => {
    const events = [
      appendEvent(structuredSnapshotEvent(snapshot, 'PMS_HOURLY_FACT_V1')),
    ]
    const finalSnapshot = latestFinalizableSnapshot(
      previousSnapshots,
      snapshot.businessDate,
    )
    if (finalSnapshot) {
      events.push(appendEvent(
        structuredSnapshotEvent(finalSnapshot, 'PMS_DAILY_FINAL_FACT_V1'),
      ))
    }
    return events
  }

  const recordOtaSource = ({ tenantId, hotelId, source }) => {
    const observedAt = safeDate(source?.lastRefreshAt)?.toISOString()
    if (!tenantId || !hotelId || !source?.sourceId || !observedAt) {
      throw new Error('ANALYTICS_OTA_SOURCE_INVALID')
    }
    return appendEvent(eventWithHashes({
      schemaVersion: 1,
      eventType: 'OTA_SOURCE_FACT_V1',
      tenantId,
      hotelId,
      sourceId: source.sourceId,
      platformCode: boundedText(source.platformCode, 48) ?? 'UNKNOWN',
      sourceType: boundedText(source.sourceType, 64),
      observedAt,
      completeness: source.lastRefreshStatus === 'COMPLETE'
        ? 'COMPLETE'
        : 'UNAVAILABLE',
      errorCode: boundedText(source.lastErrorCode, 96),
      summary: sanitizeValue(source.lastSummary ?? null),
    }))
  }

  const archiveRawResponse = ({
    tenantId,
    hotelId,
    sourceId,
    sourceSystem,
    observedAt,
    payload,
  }) => {
    const observed = safeDate(observedAt)
    if (!tenantId || !hotelId || !sourceId || !observed) {
      throw new Error('ANALYTICS_RAW_EVIDENCE_INVALID')
    }
    const sanitized = sanitizeValue(payload)
    const plaintext = JSON.stringify(sanitized)
    if (Buffer.byteLength(plaintext, 'utf8') > MAX_RAW_EVIDENCE_BYTES) {
      throw new Error('ANALYTICS_RAW_EVIDENCE_TOO_LARGE')
    }
    const contentHash = createHash('sha256').update(plaintext).digest('hex')
    const observedIso = observed.toISOString()
    const evidenceId = hashJson({ hotelId, sourceId, observedIso, contentHash })
    const dateKey = observedIso.slice(0, 10)
    const aad = Buffer.from(
      `sifangguan-analytics-raw:v1:${tenantId}:${hotelId}:${sourceId}:${observedIso}`,
      'utf8',
    )
    const iv = randomBytes(12)
    const cipher = createCipheriv(ENCRYPTION_ALGORITHM, key, iv)
    cipher.setAAD(aad)
    const ciphertext = Buffer.concat([
      cipher.update(plaintext, 'utf8'),
      cipher.final(),
    ])
    const path = join(rawRoot, dateKey, `${evidenceId}.json.enc`)
    const expiresAt = new Date(
      observed.getTime() + rawRetentionDays * 86_400_000,
    ).toISOString()
    const envelope = {
      schemaVersion: 1,
      algorithm: 'AES-256-GCM',
      evidenceId,
      tenantId,
      hotelId,
      sourceId,
      sourceSystem: boundedText(sourceSystem, 64) ?? 'UNKNOWN',
      observedAt: observedIso,
      expiresAt,
      contentHash,
      aad: aad.toString('base64url'),
      iv: iv.toString('base64url'),
      authTag: cipher.getAuthTag().toString('base64url'),
      ciphertext: ciphertext.toString('base64url'),
    }
    atomicWrite(path, `${JSON.stringify(envelope)}\n`)
    appendEvent(eventWithHashes({
      schemaVersion: 1,
      eventType: 'RAW_EVIDENCE_MANIFEST_V1',
      tenantId,
      hotelId,
      sourceId,
      sourceSystem: envelope.sourceSystem,
      observedAt: observedIso,
      expiresAt,
      evidenceId,
      evidencePath: safeRelativePath(root, path),
      evidenceContentHash: contentHash,
    }))
    return { path, envelope }
  }

  const sweepRawEvidence = ({ now = new Date() } = {}) => {
    const cutoff = now.getTime() - rawRetentionDays * 86_400_000
    if (!Number.isFinite(cutoff)) throw new Error('ANALYTICS_RETENTION_TIME_INVALID')
    const removed = []
    for (const path of walkEvidenceFiles(rawRoot)) {
      const modifiedAt = statSync(path).mtimeMs
      if (modifiedAt >= cutoff) continue
      safeRelativePath(root, path)
      rmSync(path)
      removed.push(path)
    }
    return removed
  }

  return {
    policy: ANALYTICS_RETENTION_POLICY,
    rootPath: root,
    spoolPath,
    rawRoot,
    rawRetentionDays,
    recordSnapshot,
    recordOtaSource,
    archiveRawResponse,
    sweepRawEvidence,
  }
}

export const decryptRawEvidence = ({ path, encryptionKey }) => {
  const envelope = JSON.parse(readFileSync(path, 'utf8'))
  if (
    envelope?.algorithm !== 'AES-256-GCM'
    || !SHA256_PATTERN.test(String(envelope.contentHash ?? ''))
  ) throw new Error('ANALYTICS_RAW_EVIDENCE_ENVELOPE_INVALID')
  const decipher = createDecipheriv(
    ENCRYPTION_ALGORITHM,
    decodeEncryptionKey(encryptionKey),
    Buffer.from(envelope.iv, 'base64url'),
  )
  decipher.setAAD(Buffer.from(envelope.aad, 'base64url'))
  decipher.setAuthTag(Buffer.from(envelope.authTag, 'base64url'))
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(envelope.ciphertext, 'base64url')),
    decipher.final(),
  ]).toString('utf8')
  if (createHash('sha256').update(plaintext).digest('hex') !== envelope.contentHash) {
    throw new Error('ANALYTICS_RAW_EVIDENCE_HASH_MISMATCH')
  }
  return JSON.parse(plaintext)
}
