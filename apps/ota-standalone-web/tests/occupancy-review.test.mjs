import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { addDays, buildOccupancyPlan, buildOccupancyReview, createOccupancyReviewService, currentOccupancy, OCCUPANCY_TIMES, periodBounds, shanghaiDate, weekStart } from '../../../tools/uat/occupancy-review.mjs'

const now = new Date('2026-09-21T09:00:00+08:00')
const scope = { tenantId: 'tenant-a', hotelId: 'hotel-a' }
const day = (date, occupancyPercent = 70, roomCount = 100) => ({ date, occupancyPercent, roomCount, observedAt: `${date}T23:30:00+08:00` })
const point = (date, time, occupancyPercent = 60) => ({ date, time, occupancyPercent, observedAt: `${date}T${time}:00+08:00` })
const history = () => ({ ...scope, firstDate: '2026-09-07', daily: Array.from({ length: 14 }, (_, i) => day(addDays('2026-09-07', i), i < 7 ? 50 : 70)),
  pace: Array.from({ length: 14 }, (_, i) => OCCUPANCY_TIMES.map((time, index) => point(addDays('2026-09-07', i), time, 30 + 10 * index))).flat(), periods: [] })

test('Shanghai natural week, month, leap day and year boundaries', () => {
  assert.equal(shanghaiDate(new Date('2026-09-20T17:00:00Z')), '2026-09-21')
  assert.equal(weekStart('2026-09-20'), '2026-09-14')
  assert.equal(weekStart('2026-09-21'), '2026-09-21')
  assert.deepEqual(periodBounds('WEEK', '2027-01-01'), { type: 'WEEK', start: '2026-12-28', end: '2027-01-03', expectedDays: 7 })
  assert.equal(periodBounds('MONTH', '2028-02-29').expectedDays, 29)
  assert.throws(() => periodBounds('MONTH', '2026-02-30'), /PERIOD_INVALID/)
})

test('weekly reviews compare complete periods; year baseline must exist', () => {
  const report = buildOccupancyReview({ history: history(), now })
  assert.equal(report.start, '2026-09-14')
  assert.equal(report.occupancyPercent, 70)
  assert.equal(report.complete, true)
  assert.equal(report.prior.deltaPp, 20)
  assert.equal(report.priorYear.start, '2025-09-15')
  assert.equal(report.priorYear.deltaPp, null)
  assert.equal(report.comparisonBasis, 'SAME_WEEKDAYS_52_WEEKS')
})

test('occupancy is room-capacity weighted; zero is valid, missing is not zero', () => {
  const report = buildOccupancyReview({ history: { daily: [day('2026-09-14', 100, 10), day('2026-09-15', 0, 90), day('2026-09-16', null)], pace: [] }, now })
  assert.equal(report.occupancyPercent, 10)
  assert.equal(report.availableDays, 2)
  assert.equal(report.days[1].occupancyPercent, 0)
  assert.equal(report.days[2].occupancyPercent, null)
  assert.equal(report.prior.deltaPp, null)
})

test('monthly and weekly retained aggregates work after daily details expire', () => {
  const archived = { daily: [], pace: [], periods: [
    { type: 'MONTH', start: '2024-01-01', occupancyPercent: 60, availableDays: 31 },
    { type: 'MONTH', start: '2023-12-01', occupancyPercent: 50, availableDays: 31 },
    { type: 'MONTH', start: '2023-01-01', occupancyPercent: 40, availableDays: 31 },
  ] }
  const report = buildOccupancyReview({ history: archived, type: 'MONTH', date: '2024-01-15', now })
  assert.equal(report.prior.deltaPp, 10)
  assert.equal(report.priorYear.deltaPp, 20)
  assert.equal(report.days.every((row) => row.occupancyPercent === null), true)
})

test('partial current week/month never gets a misleading complete-period comparison', () => {
  const report = buildOccupancyReview({ history: history(), date: '2026-09-18', now: new Date('2026-09-18T12:00:00+08:00') })
  assert.equal(report.complete, false)
  assert.equal(report.prior.deltaPp, null)
})

test('same-weekday recommendations are drafts; missing, stale and future samples never backfill a deadline', () => {
  const input = history()
  input.pace.find((p) => p.date === '2026-09-14' && p.time === '12:00').observedAt = '2026-09-14T12:01:00+08:00'
  input.pace.find((p) => p.date === '2026-09-14' && p.time === '15:00').observedAt = '2026-09-14T13:29:00+08:00'
  input.pace.find((p) => p.date === '2026-09-14' && p.time === '18:00').occupancyPercent = 0
  const plan = buildOccupancyPlan({ history: input, now })
  assert.equal(plan.days[0].baselineDate, '2026-09-14')
  assert.equal(plan.days[0].points[0].suggestedPercent, null)
  assert.equal(plan.days[0].points[1].suggestedPercent, null)
  assert.equal(plan.days[0].points[2].suggestedPercent, 0)
  assert.equal(plan.days[0].points.every((p) => p.targetPercent === null && p.status === 'UNSET'), true)
})

test('future target weeks do not peek into an incomplete baseline week', () => {
  const plan = buildOccupancyPlan({ history: history(), start: '2026-09-28', now })
  assert.equal(plan.days.flatMap((d) => d.points).every((p) => p.suggestedPercent === null), true)
})

test('deadline assessments distinguish pending/missing/met/behind and preserve declining actuals', () => {
  const input = history()
  input.pace.push(point('2026-09-21', '12:00', 90), point('2026-09-21', '15:00', 60))
  const approved = { version: 1, points: OCCUPANCY_TIMES.map((time) => ({ date: '2026-09-21', time, percent: 80 })) }
  const plan = buildOccupancyPlan({ history: input, approved, now: new Date('2026-09-21T18:30:00+08:00') })
  assert.deepEqual(plan.days[0].points.map((p) => p.status), ['MET', 'BEHIND', 'MISSING', 'PENDING', 'PENDING'])
  assert.equal(plan.days[0].points[1].gapPp, -20)
})

test('combined PMS sold count is not added again to check-in or reservation counts', () => {
  const snapshot = { businessDate: '2026-09-21', observedAt: '2026-09-21T08:30:00+08:00', completeness: 'COMPLETE',
    overview: { roomCount: 100, soldRooms: 80, orderRooms: 30, checkinRooms: 50, occupancyRate: 0.8 } }
  assert.equal(currentOccupancy(snapshot, now).occupancyPercent, 80)
  assert.equal(currentOccupancy({ ...snapshot, overview: { ...snapshot.overview, soldRooms: 0 } }, now).occupancyPercent, 0)
  assert.equal(currentOccupancy({ ...snapshot, overview: { roomCount: 100, occupancyRate: null } }, now), null)
  assert.equal(currentOccupancy({ ...snapshot, businessDate: '2026-09-20' }, now), null)
  assert.equal(currentOccupancy(snapshot, new Date('2026-09-21T11:00:00+08:00')).stale, true)
})

test('approval is scoped, durable, versioned, idempotent and cannot rewrite elapsed deadlines', () => {
  const root = mkdtempSync(join(tmpdir(), 'occupancy-targets-'))
  try {
    const targetPath = join(root, 'targets.json'), historyPath = join(root, 'history.json')
    writeFileSync(historyPath, JSON.stringify({ schemaVersion: 1, generatedAt: now.toISOString(), hotels: [history(), { ...history(), hotelId: 'hotel-b' }] }))
    let at = now
    const create = () => createOccupancyReviewService({ targetPath, historyPath, clock: () => at })
    const service = create()
    const input = { weekStart: '2026-09-21', expectedVersion: 0, reason: '批准本店目标', points: [{ date: '2026-09-21', time: '12:00', percent: 80 }] }
    const saved = service.approve(scope, input, 'operator-a')
    assert.equal(saved.version, 1)
    assert.deepEqual(service.approve(scope, input, 'operator-a'), saved)
    assert.throws(() => service.approve(scope, { ...input, reason: '另一份草案' }, 'operator-b'), /VERSION_CONFLICT/)
    assert.equal(create().view(scope).plan.days[0].points[0].targetPercent, 80)
    assert.equal(service.view({ ...scope, hotelId: 'hotel-b' }).plan.version, 0)
    assert.equal(service.view({ ...scope, tenantId: 'another-tenant' }).history.firstDate, null)
    at = new Date('2026-09-21T13:00:00+08:00')
    assert.throws(() => service.approve(scope, { ...input, expectedVersion: 1, points: [{ ...input.points[0], percent: 50 }] }, 'operator-a'), /PAST_TARGET_LOCKED/)
    const next = service.approve(scope, { ...input, expectedVersion: 1, points: [...input.points, { date: '2026-09-21', time: '18:00', percent: 90 }] }, 'operator-a')
    assert.equal(next.version, 2)
    assert.equal(JSON.parse(readFileSync(targetPath, 'utf8')).plans.length, 2)
    writeFileSync(targetPath, '{broken')
    assert.throws(() => create().view(scope), /STORE_UNAVAILABLE/)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('invalid dates, cross-week points, duplicate slots and missing values cannot be approved', () => {
  const root = mkdtempSync(join(tmpdir(), 'occupancy-validation-'))
  try {
    const service = createOccupancyReviewService({ targetPath: join(root, 'targets.json'), clock: () => now })
    const input = { weekStart: '2026-09-21', expectedVersion: 0, reason: 'test', points: [{ date: '2026-09-21', time: '12:00', percent: 80 }] }
    for (const invalid of [null, '', -1, 101, NaN, Infinity, true, '80']) {
      assert.throws(() => service.approve(scope, { ...input, points: [{ ...input.points[0], percent: invalid }] }, 'test'), /TARGET_INVALID/)
    }
    assert.throws(() => service.approve(scope, { ...input, points: [...input.points, ...input.points] }, 'test'), /TARGET_INVALID/)
    assert.throws(() => service.approve(scope, { ...input, points: [{ ...input.points[0], date: '2026-09-28' }] }, 'test'), /TARGET_INVALID/)
    assert.throws(() => service.approve(scope, { ...input, weekStart: '2026-09-22' }, 'test'), /WEEK_OUT_OF_RANGE/)
    assert.equal(service.view(scope).history.status, 'UNAVAILABLE')
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('SQL and release wiring retain summaries five years, protect decisions and export no raw order payloads', () => {
  const sql = readFileSync(new URL('../../../infra/ota-standalone-server/sql/analytics-retention.sql', import.meta.url), 'utf8')
  const importer = readFileSync(new URL('../../../infra/ota-standalone-server/scripts/import-analytics-retention.sh', import.meta.url), 'utf8')
  const release = readFileSync(new URL('../../../infra/ota-standalone-server/scripts/Publish-OtaStandaloneServer.ps1', import.meta.url), 'utf8')
  const deploy = readFileSync(new URL('../../../infra/ota-standalone-server/scripts/deploy-native.sh', import.meta.url), 'utf8')
  assert.match(sql, /EXCLUDED.available_day_count >= existing.available_day_count/)
  assert.match(sql, /DELETE FROM ota_analytics.occupancy_review_period[\s\S]*?interval '5 years'/)
  const exported = sql.split('FUNCTION ota_analytics.occupancy_review_export')[1].split('REVOKE ALL')[0]
  assert.doesNotMatch(exported, /daily_order_summary|future_daily|event_payload/)
  assert.match(importer, /refresh_occupancy_reviews/)
  assert.match(importer, /occupancy_review_export/)
  assert.match(importer, /archive_occupancy_targets/)
  assert.match(sql, /OCCUPANCY_TARGET_ARCHIVE_VERSION_CONFLICT/)
  assert.match(sql, /occupancy_target_decision TO ota_analytics_reader/)
  assert.match(release, /tools\/uat\/occupancy-review.mjs/)
  assert.match(deploy, /\/var\/lib\/sifangguan-ota\/occupancy-targets.json/)
})
