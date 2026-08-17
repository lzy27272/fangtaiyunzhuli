import assert from 'node:assert/strict'
import test from 'node:test'
import {
  pairOtaReviewAndOrderSources,
} from '../../../tools/uat/ota-review-order-pairing.mjs'

const meituanReviewSource = () => ({
  sourceId: 'review-meituan',
  enabled: true,
  platformCode: 'MEITUAN',
  lastRefreshStatus: 'COMPLETE',
  lastSummary: {
    reviewMetrics: {
      provider: 'MEITUAN',
      monthStart: '2026-08-01',
      previousBusinessDate: '2026-08-12',
      goodCountThroughPreviousBusinessDate: 36,
      negativeCountThroughPreviousBusinessDate: 1,
      validStayedOrderCountThroughPreviousBusinessDate: 598,
      goodRatePercent: 6.02,
      negativeRatePermille: 1.67,
      denominatorStatus: 'AVAILABLE',
    },
  },
})

const meituanOrderSource = () => ({
  sourceId: 'order-meituan',
  enabled: true,
  platformCode: 'MEITUAN',
  lastRefreshStatus: 'COMPLETE',
  lastSummary: {
    providerDataset: {
      provider: 'MEITUAN',
      dataset: 'ORDER',
      scope: 'BUSINESS_MONTH_TO_DATE',
      periodBasis: 'THROUGH_PREVIOUS_BUSINESS_DATE',
      rangeStart: '2026-08-01',
      rangeEnd: '2026-08-12',
      nonCanceledCount: 327,
    },
  },
})

test('Meituan review rates use only the matched Meituan order denominator', () => {
  const paired = pairOtaReviewAndOrderSources([
    meituanReviewSource(),
    meituanOrderSource(),
  ])
  const summary = paired[0].lastSummary
  assert.equal(summary.reviewOrderPairing.status, 'AVAILABLE')
  assert.equal(summary.reviewOrderPairing.denominatorCount, 327)
  assert.equal(
    summary.reviewMetrics.eligibleOtaOrderCountThroughPreviousBusinessDate,
    327,
  )
  assert.equal(
    summary.reviewMetrics.validStayedOrderCountThroughPreviousBusinessDate,
    null,
  )
  assert.equal(summary.reviewMetrics.goodRatePercent, 11.01)
  assert.equal(summary.reviewMetrics.negativeRatePermille, 3.06)
})

test('Douyin review rates use only the matched complete Douyin order denominator', () => {
  const review = meituanReviewSource()
  review.sourceId = 'review-douyin'
  review.platformCode = 'DOUYIN'
  review.lastSummary.reviewMetrics = {
    ...review.lastSummary.reviewMetrics,
    provider: 'DOUYIN',
    metricBasis: 'DOUYIN_NATIVE_ATTITUDE',
    goodCountThroughPreviousBusinessDate: 9,
    negativeCountThroughPreviousBusinessDate: 1,
  }
  const order = meituanOrderSource()
  order.sourceId = 'order-douyin'
  order.platformCode = 'DOUYIN'
  order.lastSummary.providerDataset.provider = 'DOUYIN'
  order.lastSummary.providerDataset.nonCanceledCount = 100
  const paired = pairOtaReviewAndOrderSources([review, order])
  const summary = paired[0].lastSummary
  assert.equal(summary.reviewOrderPairing.status, 'AVAILABLE')
  assert.equal(summary.reviewOrderPairing.denominatorCount, 100)
  assert.equal(summary.reviewMetrics.goodRatePercent, 9)
  assert.equal(summary.reviewMetrics.negativeRatePermille, 10)
})

test('a review source never borrows an order denominator from another OTA', () => {
  const douyinOrder = meituanOrderSource()
  douyinOrder.sourceId = 'order-douyin'
  douyinOrder.platformCode = 'DOUYIN'
  douyinOrder.lastSummary.providerDataset.provider = 'DOUYIN'
  const paired = pairOtaReviewAndOrderSources([
    meituanReviewSource(),
    douyinOrder,
  ])
  assert.equal(
    paired[0].lastSummary.reviewOrderPairing.status,
    'ORDER_SOURCE_MISSING',
  )
  assert.equal(paired[0].lastSummary.reviewMetrics.goodRatePercent, null)
})

test('an incomplete paged order source cannot produce a review rate', () => {
  const review = {
    sourceId: 'review-douyin',
    enabled: true,
    platformCode: 'DOUYIN',
    lastRefreshStatus: 'COMPLETE',
    lastSummary: {
      providerDataset: {
        provider: 'DOUYIN',
        dataset: 'REVIEW',
        scope: 'ENDPOINT_TOTAL_AND_CURRENT_PAGE',
      },
    },
  }
  const order = {
    sourceId: 'order-douyin',
    enabled: true,
    platformCode: 'DOUYIN',
    lastRefreshStatus: 'COMPLETE',
    lastSummary: {
      providerDataset: {
        provider: 'DOUYIN',
        dataset: 'ORDER',
        scope: 'ENDPOINT_TOTAL_AND_CURRENT_PAGE',
        nonCanceledCount: 20,
        hasMore: true,
      },
    },
  }
  const paired = pairOtaReviewAndOrderSources([review, order])
  const pairing = paired[0].lastSummary.reviewOrderPairing
  assert.equal(pairing.status, 'ORDER_DATA_INCOMPLETE')
  assert.equal(pairing.orderDataComplete, false)
  assert.equal(pairing.scoreMetricsAvailable, false)
})

test('period mismatch is explicit and never silently calculated', () => {
  const order = meituanOrderSource()
  order.lastSummary.providerDataset.rangeEnd = '2026-08-13'
  const paired = pairOtaReviewAndOrderSources([
    meituanReviewSource(),
    order,
  ])
  assert.equal(
    paired[0].lastSummary.reviewOrderPairing.status,
    'PERIOD_MISMATCH',
  )
  assert.equal(paired[0].lastSummary.reviewMetrics.goodRatePercent, null)
})
