import assert from 'node:assert/strict'
import test from 'node:test'
import { summarizeJy07MonthlyOccupancy } from './monthly-pms-kpi-collector.mjs'

test('reads the direct overnight occupancy rate from JY07', () => {
  const value = summarizeJy07MonthlyOccupancy({
    periodStart: '2026-07-01',
    periodEnd: '2026-07-31',
    root: {
      data: {
        roomStatistics: [
          { category: '总营业指标', statistics: '出租率', currentPeriod: '100.65%' },
          { category: '总营业指标', statistics: '过夜房出租率', currentPeriod: '98.97%' },
        ],
      },
    },
  })

  assert.equal(value.metrics.occupancyRate, 0.9897)
  assert.equal(value.validation.hourlyRoomExclusionState,
    'VERIFIED_DIRECT_OVERNIGHT_OCCUPANCY')
  assert.equal(value.validation.accuracyState, 'NUMERICALLY_VALIDATED')
})

test('rejects an ambiguous direct occupancy rate', () => {
  assert.throws(() => summarizeJy07MonthlyOccupancy({
    periodStart: '2026-07-01',
    periodEnd: '2026-07-31',
    root: {
      data: {
        roomStatistics: [
          { category: '总营业指标', statistics: '过夜房出租率', currentPeriod: '98.97%' },
          { category: '总营业指标', statistics: '过夜房出租率', currentPeriod: '98.96%' },
        ],
      },
    },
  }), /PMS_OVERNIGHT_OCCUPANCY_AMBIGUOUS/)
})

test('accepts duplicate renderer rows when the value is identical', () => {
  const value = summarizeJy07MonthlyOccupancy({
    periodStart: '2026-07-01',
    periodEnd: '2026-07-31',
    root: {
      data: {
        roomStatistics: [
          { category: '总营业指标', statistics: '过夜房出租率', currentPeriod: '98.97%' },
          { category: '总营业指标', statistics: '过夜房出租率', currentPeriod: '98.97%' },
        ],
      },
    },
  })
  assert.equal(value.metrics.occupancyRate, 0.9897)
})

test('finds the direct metric when JY07 nests the full report below a compact summary', () => {
  const value = summarizeJy07MonthlyOccupancy({
    periodStart: '2026-07-01',
    periodEnd: '2026-07-31',
    root: {
      data: {
        roomStatistics: [
          { category: '客房统计', statistics: '过夜房', currentPeriod: '1440.00' },
        ],
        sections: [{
          rows: [
            { category: '总营业指标', statistics: '过夜房出租率', currentPeriod: '98.97%' },
          ],
        }],
      },
    },
  })
  assert.equal(value.metrics.occupancyRate, 0.9897)
})
