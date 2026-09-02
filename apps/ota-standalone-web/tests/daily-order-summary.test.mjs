import assert from 'node:assert/strict'
import test from 'node:test'

import {
  createDailyOrderSummary,
  normalizeDailyOrderSummary,
} from '../../../tools/uat/daily-order-summary.mjs'

test('daily order summary keeps only privacy-safe channel aggregates', () => {
  const summary = createDailyOrderSummary({
    businessDate: '2026-09-02',
    orders: [
      {
        orderDate: '2026-09-02', channel: 'MEITUAN', status: 'ACTIVE',
        arrivalClass: 'TODAY', roomNights: 2,
      },
      {
        orderDate: '2026-09-02', channel: 'DOUYIN', status: 'ACTIVE',
        arrivalClass: 'FUTURE', roomNights: 3,
      },
      {
        orderDate: '2026-09-02', channel: 'CTRIP', status: 'CANCELLED',
        arrivalClass: 'FUTURE', roomNights: 1,
      },
      {
        orderDate: '2026-09-01', channel: 'MEITUAN', status: 'ACTIVE',
        arrivalClass: 'TODAY', roomNights: 99,
      },
    ],
  })

  assert.deepEqual(summary.byChannel.MEITUAN, {
    active: 2, today: 2, future: 0, canceled: 0,
  })
  assert.deepEqual(summary.byChannel.DOUYIN, {
    active: 3, today: 0, future: 3, canceled: 0,
  })
  assert.deepEqual(summary.byChannel.OTHER, {
    active: 0, today: 0, future: 0, canceled: 1,
  })
  assert.doesNotMatch(JSON.stringify(summary), /orderNo|guest|phone|roomType/iu)
  assert.deepEqual(
    normalizeDailyOrderSummary(summary, { businessDate: '2026-09-02' }),
    summary,
  )
})

test('daily order summary rejects malformed or cross-day aggregates', () => {
  const summary = createDailyOrderSummary({
    businessDate: '2026-09-02',
    orders: [],
  })
  assert.equal(
    normalizeDailyOrderSummary(summary, { businessDate: '2026-09-03' }),
    null,
  )
  assert.equal(
    normalizeDailyOrderSummary({
      ...summary,
      byChannel: {
        ...summary.byChannel,
        MEITUAN: { ...summary.byChannel.MEITUAN, active: -1 },
      },
    }, { businessDate: '2026-09-02' }),
    null,
  )
})
