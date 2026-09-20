import assert from 'node:assert/strict'
import test from 'node:test'

import {
  DAILY_ORDER_SUMMARY_BASIS,
  LEGACY_DAILY_ORDER_SUMMARY_BASIS,
  createDailyOrderSummary,
  detectPmsOrderChannel,
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
  assert.deepEqual(summary.byChannel.CTRIP, {
    active: 0, today: 0, future: 0, canceled: 1,
  })
  assert.deepEqual(summary.byChannel.OTHER, {
    active: 0, today: 0, future: 0, canceled: 0,
  })
  assert.equal(summary.basis, DAILY_ORDER_SUMMARY_BASIS)
  assert.doesNotMatch(JSON.stringify(summary), /orderNo|guest|phone|roomType/iu)
  assert.deepEqual(
    normalizeDailyOrderSummary(summary, { businessDate: '2026-09-02' }),
    summary,
  )
})

test('only unrecognized channels go to OTHER, without changing the daily totals', () => {
  const summary = createDailyOrderSummary({
    businessDate: '2026-09-20',
    orders: ['CTRIP', 'MEITUAN', 'FEIZHU', 'DOUYIN', 'UNKNOWN', 'unrecognized'].map((channel) => ({
      channel, orderDate: '2026-09-20', roomNights: 1.5,
      status: 'ACTIVE', arrivalClass: 'TODAY',
    })),
  })
  for (const channel of ['CTRIP', 'MEITUAN', 'FEIZHU', 'DOUYIN']) {
    assert.equal(summary.byChannel[channel].active, 1.5)
  }
  assert.equal(summary.byChannel.OTHER.active, 3)
  assert.equal(Object.values(summary.byChannel).reduce((sum, item) => sum + item.active, 0), 9)
})

test('legacy aggregates remain compatible but never claim that Ctrip has been separated', () => {
  const legacy = {
    basis: LEGACY_DAILY_ORDER_SUMMARY_BASIS,
    businessDate: '2026-09-20',
    byChannel: Object.fromEntries(['MEITUAN', 'FEIZHU', 'DOUYIN', 'OTHER'].map((channel) => [
      channel, { active: 1, today: 1, future: 0, canceled: 0 },
    ])),
  }
  assert.deepEqual(normalizeDailyOrderSummary(legacy), legacy)
  assert.equal(normalizeDailyOrderSummary({ ...legacy, basis: DAILY_ORDER_SUMMARY_BASIS }), null)
  assert.equal(normalizeDailyOrderSummary({ ...legacy, basis: 'unknown' }), null)
  assert.equal(normalizeDailyOrderSummary({ ...legacy, guestName: 'must-not-be-accepted' }), null)
  assert.equal(normalizeDailyOrderSummary({
    ...legacy,
    byChannel: { ...legacy.byChannel, CTRIP: legacy.byChannel.OTHER },
  }), null)
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

test('channel detection preserves explicit PMS channels and distinguishes front desk and wedding bookings', () => {
  for (const [label, channel] of [
    ['携程预付', 'CTRIP'], ['Trip.com', 'CTRIP'], ['美团', 'MEITUAN'],
    ['飞猪', 'FEIZHU'], ['fliggy', 'FEIZHU'], ['抖音', 'DOUYIN'],
    ['前台', 'FRONT_DESK'], ['walk-in', 'FRONT_DESK'], ['婚宴', 'WEDDING'],
  ]) assert.equal(detectPmsOrderChannel([label]), channel)
  assert.equal(detectPmsOrderChannel(['前台', '携程价']), 'FRONT_DESK')
  assert.equal(detectPmsOrderChannel([null, '', '抖音协议价']), 'DOUYIN')
  assert.equal(detectPmsOrderChannel(['unrecognized label', null]), 'UNKNOWN')
})
