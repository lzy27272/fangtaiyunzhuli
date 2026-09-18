import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, utimesSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import {
  ANALYTICS_RETENTION_POLICY,
  createAnalyticsRetentionStore,
  decryptRawEvidence,
  sanitizeValue,
} from '../../../tools/uat/analytics-retention.mjs'

const key = Buffer.alloc(32, 7).toString('base64url')

const snapshot = ({
  businessDate = '2026-09-14',
  observedAt = '2026-09-15T01:00:00+08:00',
  collectionRunId = `run-${businessDate}`,
} = {}) => ({
  schemaVersion: 1,
  tenantId: '10000000-0000-4000-8000-000000000001',
  hotelId: '20000000-0000-4000-8000-000000000001',
  sourceSystem: 'MEITUAN_BIEYANGHONG',
  collectionRunId,
  businessDate,
  observedAt,
  completeness: 'COMPLETE',
  overview: {
    roomFee: 12_345.67,
    roomNights: 48,
    roomCount: 60,
    availableRooms: 12,
    occupancyRate: 80,
    adr: 257.2,
    revPar: 205.76,
  },
  dailyOrderSummary: {
    basis: 'PMS_ORDER_DETAIL_AGGREGATE_V1',
    businessDate,
    byChannel: { MEITUAN: { active: 12, today: 2, future: 10, canceled: 1 } },
  },
  futureDaily: [{
    stayDate: '2026-09-16',
    roomCount: 60,
    availableRooms: 20,
    soldRooms: 40,
    roomFee: 10_000,
  }],
  sources: [{
    sourceId: 'source-1',
    sourceCode: 'REPORT_REVENUE',
    reportType: 'BUSINESS_OVERVIEW',
    completeness: 'COMPLETE',
  }],
})

const decodeSpool = (path) => readFileSync(path, 'utf8')
  .trim()
  .split('\n')
  .filter(Boolean)
  .map((line) => JSON.parse(Buffer.from(line, 'base64').toString('utf8')))

test('retention policy matches the approved business windows', () => {
  assert.deepEqual(ANALYTICS_RETENTION_POLICY, {
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
})

test('missing operating metrics stay null in archives instead of becoming zero occupancy', () => {
  const root = mkdtempSync(join(tmpdir(), 'sfg-analytics-null-'))
  try {
    const store = createAnalyticsRetentionStore({ rootPath: root, encryptionKey: key })
    const missing = snapshot()
    missing.overview = { roomCount: 50, occupancyRate: null, roomNights: null, availableRooms: null }
    const [event] = store.recordSnapshot({ snapshot: missing, previousSnapshots: [] })
    assert.equal(event.measures.occupancyRate, null)
    assert.equal(event.measures.soldRoomNights, null)
    assert.equal(event.measures.availableRooms, null)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('Luopan low occupancy is not mistaken for 100 percent', () => {
  const root = mkdtempSync(join(tmpdir(), 'sfg-analytics-occupancy-'))
  try {
    const store = createAnalyticsRetentionStore({ rootPath: root, encryptionKey: key })
    const value = snapshot()
    value.sourceSystem = 'LUOPAN_CLOUD'
    value.overview = { roomCount: 100, soldRooms: 1, roomNights: 1, occupancyRate: 1 }
    assert.equal(store.recordSnapshot({ snapshot: value, previousSnapshots: [] })[0].measures.occupancyRate, 0.01)
    value.overview.soldRooms = null
    assert.equal(store.recordSnapshot({ snapshot: value, previousSnapshots: [] })[0].measures.occupancyRate, 0.01)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('snapshot journal appends hourly facts and finalizes the prior business day', () => {
  const root = mkdtempSync(join(tmpdir(), 'sfg-analytics-'))
  try {
    const store = createAnalyticsRetentionStore({
      rootPath: root,
      encryptionKey: key,
    })
    const previous = snapshot()
    const current = snapshot({
      businessDate: '2026-09-15',
      observedAt: '2026-09-15T02:00:00+08:00',
    })
    const events = store.recordSnapshot({
      snapshot: current,
      previousSnapshots: [previous],
    })
    assert.deepEqual(events.map((event) => event.eventType), [
      'PMS_HOURLY_FACT_V1',
      'PMS_DAILY_FINAL_FACT_V1',
    ])
    const persisted = decodeSpool(store.spoolPath)
    assert.equal(persisted.length, 2)
    assert.equal(persisted[0].measures.occupancyRate, 0.8)
    assert.equal(persisted[1].businessDate, '2026-09-14')
    assert.match(persisted[0].idempotencyKey, /^[a-f0-9]{64}$/u)

    const nextCurrent = snapshot({
      businessDate: '2026-09-15',
      observedAt: '2026-09-15T03:00:00+08:00',
    })
    const nextEvents = store.recordSnapshot({
      snapshot: nextCurrent,
      previousSnapshots: [previous, current],
    })
    assert.deepEqual(nextEvents.map((event) => event.eventType), [
      'PMS_HOURLY_FACT_V1',
    ])
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('OTA observations append history instead of replacing the previous success', () => {
  const root = mkdtempSync(join(tmpdir(), 'sfg-analytics-'))
  try {
    const store = createAnalyticsRetentionStore({
      rootPath: root,
      encryptionKey: key,
    })
    const base = {
      tenantId: '10000000-0000-4000-8000-000000000001',
      hotelId: '20000000-0000-4000-8000-000000000001',
    }
    store.recordOtaSource({
      ...base,
      source: {
        sourceId: 'ota-source',
        platformCode: 'MEITUAN',
        lastRefreshAt: '2026-09-15T00:00:00Z',
        lastRefreshStatus: 'COMPLETE',
        lastSummary: { recordCount: 12 },
      },
    })
    store.recordOtaSource({
      ...base,
      source: {
        sourceId: 'ota-source',
        platformCode: 'MEITUAN',
        lastRefreshAt: '2026-09-15T02:00:00Z',
        lastRefreshStatus: 'FAILED',
        lastErrorCode: 'TIMEOUT',
        lastSummary: null,
      },
    })
    const events = decodeSpool(store.spoolPath)
    assert.equal(events.length, 2)
    assert.equal(events[0].summary.recordCount, 12)
    assert.equal(events[1].completeness, 'UNAVAILABLE')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('raw evidence is redacted before encryption and expires inside 30-90 days', () => {
  const root = mkdtempSync(join(tmpdir(), 'sfg-analytics-'))
  try {
    const store = createAnalyticsRetentionStore({
      rootPath: root,
      encryptionKey: key,
      rawRetentionDays: 30,
    })
    const archived = store.archiveRawResponse({
      tenantId: '10000000-0000-4000-8000-000000000001',
      hotelId: '20000000-0000-4000-8000-000000000001',
      sourceId: 'source-1',
      sourceSystem: 'PMS',
      observedAt: '2026-09-15T00:00:00Z',
      payload: {
        cookie: 'sid=secret',
        guestName: '张三',
        note: '联系电话 13800138000，邮箱 guest@example.com',
        roomRevenue: 99,
      },
    })
    const encryptedText = readFileSync(archived.path, 'utf8')
    assert.equal(encryptedText.includes('13800138000'), false)
    assert.equal(encryptedText.includes('guest@example.com'), false)
    const restored = decryptRawEvidence({ path: archived.path, encryptionKey: key })
    assert.equal(restored.cookie, '[REDACTED]')
    assert.equal(restored.guestName, '[REDACTED]')
    assert.match(restored.note, /REDACTED_PHONE/u)
    assert.equal(restored.roomRevenue, 99)

    const old = new Date('2026-08-01T00:00:00Z')
    utimesSync(archived.path, old, old)
    const removed = store.sweepRawEvidence({
      now: new Date('2026-09-15T00:00:00Z'),
    })
    assert.deepEqual(removed, [archived.path])

    assert.throws(() => createAnalyticsRetentionStore({
      rootPath: root,
      encryptionKey: key,
      rawRetentionDays: 29,
    }), /ANALYTICS_RAW_RETENTION_OUT_OF_RANGE/u)
    assert.throws(() => createAnalyticsRetentionStore({
      rootPath: root,
      encryptionKey: key,
      rawRetentionDays: 91,
    }), /ANALYTICS_RAW_RETENTION_OUT_OF_RANGE/u)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('free-text sanitizer removes common personal identifiers', () => {
  const sanitized = sanitizeValue({
    comment: '联系 13912345678 / USER@EXAMPLE.COM / 52010219900101123X',
  })
  assert.equal(JSON.stringify(sanitized).includes('13912345678'), false)
  assert.equal(JSON.stringify(sanitized).includes('USER@EXAMPLE.COM'), false)
  assert.equal(JSON.stringify(sanitized).includes('52010219900101123X'), false)
})

test('database, importer, release and backup contracts carry the approved policy', () => {
  const schema = readFileSync(new URL(
    '../../../infra/ota-standalone-server/sql/analytics-retention.sql',
    import.meta.url,
  ), 'utf8')
  const importer = readFileSync(new URL(
    '../../../infra/ota-standalone-server/scripts/import-analytics-retention.sh',
    import.meta.url,
  ), 'utf8')
  const importTimer = readFileSync(new URL(
    '../../../infra/ota-standalone-server/systemd/sifangguan-ota-analytics-import.timer',
    import.meta.url,
  ), 'utf8')
  const publisher = readFileSync(new URL(
    '../../../infra/ota-standalone-server/scripts/Publish-OtaStandaloneServer.ps1',
    import.meta.url,
  ), 'utf8')
  const backup = readFileSync(new URL(
    '../../../infra/production/backup/backup-postgres.sh',
    import.meta.url,
  ), 'utf8')

  assert.match(schema, /interval '48 months'/u)
  assert.match(schema, /interval '2 years'/u)
  assert.match(schema, /interval '5 years'/u)
  assert.match(schema, /'MONTH', 'QUARTER', 'HALF_YEAR', 'YEAR'/u)
  assert.match(schema, /ingest_base64_event/u)
  assert.match(importer, /refresh_rollups/u)
  assert.match(importTimer, /OnUnitActiveSec=5min/u)
  assert.match(publisher, /analytics-retention\.sql/u)
  assert.match(backup, /prune_tier .* 30/u)
  assert.match(backup, /prune_tier .* 12/u)
  assert.match(backup, /prune_tier .* 3/u)
  assert.match(backup, /OFFSITE_BACKUP_REMOTE_MOUNT_REQUIRED/u)
})
