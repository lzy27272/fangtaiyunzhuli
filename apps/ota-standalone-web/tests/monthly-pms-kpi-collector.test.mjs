import assert from 'node:assert/strict'
import test from 'node:test'
import { summarizeMonthlyRows } from '../../../tools/uat/monthly-pms-kpi-collector.mjs'

const row = (date, sold, available, reported = sold / (sold + available)) => ({
  estimatedDate: date,
  estimatedRoomNights: sold,
  saleRoom: sold,
  availableRoom: available,
  roomCount: sold + available,
  estimatedRoomFee: sold * 200,
  estimatedRentRate: reported,
})

const totalRow = (rows) => ({
  estimatedDate: '',
  estimatedRoomNights: rows.reduce((total, item) => total + item.estimatedRoomNights, 0),
  estimatedRoomFee: rows.reduce((total, item) => total + item.estimatedRoomFee, 0),
})

test('monthly occupancy uses cumulative numerator and denominator', () => {
  const rows = [row('2026-02-01', 1, 1), row('2026-02-02', 9, 1),
    ...Array.from({ length: 26 }, (_, index) => row(`2026-02-${String(index + 3).padStart(2, '0')}`, 0, 10))]
  const result = summarizeMonthlyRows({
    rows: [...rows, totalRow(rows)],
    periodStart: '2026-02-01',
    periodEnd: '2026-02-28',
  })
  assert.equal(result.metrics.overnightSoldRoomNights, 10)
  assert.equal(result.metrics.effectiveSellableRoomNights, 272)
  assert.equal(result.metrics.occupancyRate, 0.03676471)
  assert.equal(result.validation.coverageState, 'PASS')
})

test('missing and duplicate days fail coverage instead of being scored', () => {
  const rows = Array.from({ length: 31 }, (_, index) =>
    row(`2026-07-${String(index + 1).padStart(2, '0')}`, 40, 7))
  rows.pop()
  rows.push(row('2026-07-30', 40, 7))
  const result = summarizeMonthlyRows({
    rows: [...rows, totalRow(rows)],
    periodStart: '2026-07-01',
    periodEnd: '2026-07-31',
  })
  assert.equal(result.validation.coverageState, 'FAIL')
  assert.deepEqual(result.period.missingDates, ['2026-07-31'])
  assert.deepEqual(result.period.duplicateDates, ['2026-07-30'])
})

test('reported daily occupancy is independently cross-checked', () => {
  const rows = Array.from({ length: 31 }, (_, index) =>
    row(`2026-07-${String(index + 1).padStart(2, '0')}`, 40, 7))
  rows[4].estimatedRentRate = 0.5
  const result = summarizeMonthlyRows({
    rows: [...rows, totalRow(rows)],
    periodStart: '2026-07-01',
    periodEnd: '2026-07-31',
  })
  assert.equal(result.validation.dailyReportedFormulaState, 'FAIL')
  assert.equal(result.validation.dailyReportedFormulaMismatchCount, 1)
})

test('hourly-room exclusion is never inferred from numeric agreement', () => {
  const rows = Array.from({ length: 31 }, (_, index) =>
    row(`2026-07-${String(index + 1).padStart(2, '0')}`, 40, 7))
  const result = summarizeMonthlyRows({
    rows: [...rows, totalRow(rows)],
    periodStart: '2026-07-01',
    periodEnd: '2026-07-31',
  })
  assert.equal(result.validation.accuracyState,
    'CANDIDATE_NUMERICALLY_VALIDATED_DEFINITION_PENDING')
  assert.equal(result.validation.hourlyRoomExclusionState,
    'UNVERIFIED_PMS_FIELD_SEMANTICS')
})
