import assert from 'node:assert/strict'
import test from 'node:test'
import {
  isMeituanCommentSource,
  summarizeMeituanCommentPages,
} from '../../../tools/uat/meituan-comment-browser-collector.mjs'

const shanghaiTimestamp = (dateTime) =>
  new Date(`${dateTime}+08:00`).getTime()

test('Meituan comment source matching is restricted to the official read endpoint', () => {
  const source = { platformCode: 'MEITUAN', requestMethod: 'GET' }
  assert.equal(isMeituanCommentSource({
    source,
    endpoint: new URL(
      'https://me.meituan.com/api/gw/v1/base/comments/queryGeneralCommentInfo',
    ),
  }), true)
  assert.equal(isMeituanCommentSource({
    source,
    endpoint: new URL('https://me.meituan.com/api/gw/v1/base/comments/reply'),
  }), false)
  assert.equal(isMeituanCommentSource({
    source: { ...source, requestMethod: 'POST' },
    endpoint: new URL(
      'https://me.meituan.com/api/gw/v1/base/comments/queryGeneralCommentInfo',
    ),
  }), false)
})

test('Meituan review summary applies frozen score thresholds and yesterday cutoff', () => {
  const summary = summarizeMeituanCommentPages({
    businessDate: '2026-08-12',
    businessDateBasis: 'PMS_CONFIRMED',
    validStayedOrderCountThroughPreviousBusinessDate: 4,
    pages: [
      {
        total: 2_952,
        rows: [
          { commentTime: shanghaiTimestamp('2026-08-12T18:00:00'), score: 50 },
          { commentTime: shanghaiTimestamp('2026-08-12T09:00:00'), score: 10 },
          { commentTime: shanghaiTimestamp('2026-08-11T20:00:00'), score: 48 },
          { commentTime: shanghaiTimestamp('2026-08-11T08:00:00'), score: 29 },
          { commentTime: shanghaiTimestamp('2026-08-11T07:00:00'), score: 30 },
        ],
      },
      {
        total: 2_952,
        rows: [
          { commentTime: shanghaiTimestamp('2026-08-01T10:00:00'), score: 49 },
          { commentTime: shanghaiTimestamp('2026-07-31T23:59:59'), score: 50 },
        ],
      },
    ],
  })

  assert.equal(summary.monthlyGoodCount, 3)
  assert.equal(summary.monthlyNegativeCount, 2)
  assert.equal(summary.yesterdayNegativeCount, 1)
  assert.equal(summary.goodCountThroughPreviousBusinessDate, 2)
  assert.equal(summary.negativeCountThroughPreviousBusinessDate, 1)
  assert.equal(summary.validStayedOrderCountThroughPreviousBusinessDate, 4)
  assert.equal(summary.goodRatePercent, 50)
  assert.equal(summary.negativeRatePermille, 250)
  assert.equal(
    summary.denominatorStatus,
    'AVAILABLE',
  )
  assert.equal(summary.paginationComplete, true)
  assert.equal(summary.fetchedRowCount, 7)
  assert.equal(summary.totalAllTime, 2_952)
  assert.equal(Object.hasOwn(summary, 'reviews'), false)
})

test('Meituan review summary stays incomplete until pagination crosses month start', () => {
  const summary = summarizeMeituanCommentPages({
    businessDate: '2026-08-12',
    pages: [{
      total: 2_952,
      rows: [
        { commentTime: shanghaiTimestamp('2026-08-12T10:00:00'), score: 50 },
        { commentTime: shanghaiTimestamp('2026-08-09T10:00:00'), score: 10 },
      ],
    }],
  })
  assert.equal(summary.paginationComplete, false)
  assert.equal(summary.goodRatePercent, null)
  assert.equal(
    summary.denominatorStatus,
    'PMS_VALID_STAYED_ORDER_COUNT_UNAVAILABLE',
  )
})
