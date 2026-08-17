import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildOtaHotelReviewDashboard,
  isOtaDashboardSource,
} from '../src/pages/otaReviewDashboard.ts'

const reviewSource = ({
  provider,
  monthlyGoodCount,
  goodThroughPrevious,
  monthlyNegativeCount,
  negativeThroughPrevious,
  yesterdayNegativeCount,
  denominatorCount,
  observedAt,
}) => ({
  sourceId: `${provider}-review`,
  displayName: `${provider}评价`,
  platformCode: provider,
  portalUrl: '',
  dataEndpointUrl: '',
  requestMethod: 'GET',
  requestPayloadJson: '',
  pollIntervalMinutes: 120,
  enabled: true,
  cookieConfigured: true,
  cookieUpdatedAt: null,
  credentialsConfigured: false,
  credentialsUpdatedAt: null,
  loginMode: 'CONTROLLED_LOGIN_PENDING',
  loginExecutionEnabled: false,
  lastRefreshStatus: 'COMPLETE',
  lastRefreshAt: observedAt,
  lastErrorCode: null,
  rowVersion: 1,
  lastSummary: {
    observedAt,
    httpStatus: 200,
    rootType: 'OBJECT',
    recordPath: '$.rows',
    recordCount: monthlyGoodCount + monthlyNegativeCount,
    detectedDimensions: ['REVIEW'],
    detectedFields: ['score'],
    reviewMetrics: {
      provider,
      businessDate: '2026-08-17',
      businessDateBasis: 'PMS_CONFIRMED',
      previousBusinessDate: '2026-08-16',
      monthStart: '2026-08-01',
      monthlyGoodCount,
      monthlyNegativeCount,
      yesterdayNegativeCount,
      goodCountThroughPreviousBusinessDate: goodThroughPrevious,
      negativeCountThroughPreviousBusinessDate: negativeThroughPrevious,
      validStayedOrderCountThroughPreviousBusinessDate: null,
      eligibleOtaOrderCountThroughPreviousBusinessDate: denominatorCount,
      goodRatePercent: null,
      negativeRatePermille: null,
      denominatorSource: 'MATCHED_OTA_ORDER_SOURCE',
      denominatorStatus: 'AVAILABLE',
      totalAllTime: null,
      fetchedRowCount: 100,
      fetchedPageCount: 10,
      paginationComplete: true,
    },
    reviewOrderPairing: {
      provider,
      orderSourceId: `${provider}-order`,
      orderCountDefinition: 'NON_CANCELED_OTA_ORDERS',
      periodStart: '2026-08-01',
      periodEnd: '2026-08-16',
      denominatorCount,
      orderDataComplete: true,
      scoreMetricsAvailable: true,
      status: 'AVAILABLE',
    },
  },
})

test('hotel review dashboard uses sums of channel numerators and denominators', () => {
  const dashboard = buildOtaHotelReviewDashboard([
    reviewSource({
      provider: 'MEITUAN',
      monthlyGoodCount: 38,
      goodThroughPrevious: 36,
      monthlyNegativeCount: 1,
      negativeThroughPrevious: 1,
      yesterdayNegativeCount: 0,
      denominatorCount: 309,
      observedAt: '2026-08-17T10:00:00.000Z',
    }),
    reviewSource({
      provider: 'FLIGGY',
      monthlyGoodCount: 53,
      goodThroughPrevious: 50,
      monthlyNegativeCount: 2,
      negativeThroughPrevious: 1,
      yesterdayNegativeCount: 0,
      denominatorCount: 265,
      observedAt: '2026-08-17T11:00:00.000Z',
    }),
  ])

  assert.equal(dashboard.channels.length, 2)
  assert.equal(dashboard.monthlyGoodCount, 91)
  assert.equal(dashboard.monthlyNegativeCount, 3)
  assert.equal(dashboard.yesterdayNegativeCount, 0)
  assert.equal(dashboard.goodRatePercent, 14.98)
  assert.equal(dashboard.negativeRatePermille, 3.48)
  assert.equal(dashboard.rateStatus, 'AVAILABLE')
})

test('hotel review dashboard fails closed when any channel denominator is unavailable', () => {
  const ready = reviewSource({
    provider: 'MEITUAN',
    monthlyGoodCount: 38,
    goodThroughPrevious: 36,
    monthlyNegativeCount: 1,
    negativeThroughPrevious: 1,
    yesterdayNegativeCount: 0,
    denominatorCount: 309,
    observedAt: '2026-08-17T10:00:00.000Z',
  })
  const unavailable = reviewSource({
    provider: 'FLIGGY',
    monthlyGoodCount: 53,
    goodThroughPrevious: 50,
    monthlyNegativeCount: 2,
    negativeThroughPrevious: 1,
    yesterdayNegativeCount: 0,
    denominatorCount: 265,
    observedAt: '2026-08-17T11:00:00.000Z',
  })
  unavailable.lastSummary.reviewOrderPairing.status = 'ORDER_SOURCE_MISSING'
  unavailable.lastSummary.reviewMetrics.denominatorStatus = 'ORDER_SOURCE_MISSING'

  const dashboard = buildOtaHotelReviewDashboard([ready, unavailable])
  assert.equal(dashboard.monthlyGoodCount, 91)
  assert.equal(dashboard.goodRatePercent, null)
  assert.equal(dashboard.negativeRatePermille, null)
  assert.equal(dashboard.rateStatus, 'DENOMINATOR_UNAVAILABLE')
})

test('order-only sources are hidden from the OTA operating dashboard', () => {
  assert.equal(isOtaDashboardSource({
    displayName: '飞猪订单',
    lastSummary: { providerDataset: { dataset: 'ORDER' } },
  }), false)
  assert.equal(isOtaDashboardSource({
    displayName: '飞猪评价',
    lastSummary: { providerDataset: { dataset: 'REVIEW' } },
  }), true)
  assert.equal(isOtaDashboardSource({
    displayName: '美团实时排名',
    lastSummary: null,
  }), true)
})
