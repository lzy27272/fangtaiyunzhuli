import assert from 'node:assert/strict'
import test from 'node:test'
import {
  OTA_DEFAULT_POLL_INTERVAL_MINUTES,
  OTA_INCOMPLETE_RANK_RETRY_MINUTES,
  OTA_POLL_INTERVAL_OPTIONS_MINUTES,
  otaSourcePollingDue,
  otaSourceSchedulerReady,
} from '../../../tools/uat/ota-source-schedule.mjs'

test('OTA polling defaults to two hours and exposes approved intervals', () => {
  assert.equal(OTA_DEFAULT_POLL_INTERVAL_MINUTES, 120)
  assert.equal(OTA_INCOMPLETE_RANK_RETRY_MINUTES, 10)
  assert.deepEqual(
    OTA_POLL_INTERVAL_OPTIONS_MINUTES,
    [30, 60, 120, 180, 240, 360, 720, 1_440],
  )
})

test('OTA source becomes due only after its configured interval', () => {
  const source = {
    enabled: true,
    pollIntervalMinutes: 120,
    lastRefreshAt: '2026-08-12T00:00:00.000Z',
  }
  assert.equal(
    otaSourcePollingDue(source, new Date('2026-08-12T01:59:59.999Z')),
    false,
  )
  assert.equal(
    otaSourcePollingDue(source, new Date('2026-08-12T02:00:00.000Z')),
    true,
  )
})

test('new sources are due while disabled or invalid sources stay closed', () => {
  assert.equal(otaSourcePollingDue({
    enabled: true,
    pollIntervalMinutes: 30,
    lastRefreshAt: null,
  }), true)
  assert.equal(otaSourcePollingDue({
    enabled: false,
    pollIntervalMinutes: 30,
    lastRefreshAt: null,
  }), false)
  assert.equal(otaSourcePollingDue({
    enabled: true,
    pollIntervalMinutes: 31,
    lastRefreshAt: null,
  }), false)
  assert.equal(otaSourcePollingDue({
    enabled: true,
    dataEndpointUrl: '',
    pollIntervalMinutes: 30,
    lastRefreshAt: null,
  }), false)
})

test('enabled Fliggy order source can poll through its built-in endpoint', () => {
  const source = {
    enabled: true,
    platformCode: 'FLIGGY',
    displayName: '飞猪订单',
    dataEndpointUrl: '',
    pollIntervalMinutes: 120,
    lastRefreshStatus: 'NEVER',
    lastRefreshAt: null,
  }
  assert.equal(otaSourcePollingDue(source), true)
  source.enabled = false
  assert.equal(otaSourcePollingDue(source), false)
})

test('enabled Fliggy review source can poll through its built-in endpoint', () => {
  const source = {
    enabled: true,
    platformCode: 'FLIGGY',
    displayName: '飞猪评价',
    dataEndpointUrl: '',
    requestMethod: 'POST',
    requestPayloadJson: JSON.stringify({ pageNo: 1, pageSize: 10 }),
    pollIntervalMinutes: 120,
    lastRefreshStatus: 'NEVER',
    lastRefreshAt: null,
  }
  assert.equal(otaSourcePollingDue(source), true)
  source.enabled = false
  assert.equal(otaSourcePollingDue(source), false)
})

test('existing Meituan rank source is due once to backfill the safe dashboard projection', () => {
  const source = {
    enabled: true,
    platformCode: 'MEITUAN',
    pollIntervalMinutes: 120,
    lastRefreshStatus: 'COMPLETE',
    lastRefreshAt: '2026-08-12T01:59:59.999Z',
    lastSummary: {
      recordPath: '$.data.peerRankResult',
      detectedDimensions: ['RANK'],
    },
  }
  assert.equal(
    otaSourcePollingDue(source, new Date('2026-08-12T02:00:00.000Z')),
    true,
  )
  source.lastSummary.peerRanking = {
    provider: 'MEITUAN',
    metrics: [],
  }
  assert.equal(
    otaSourcePollingDue(source, new Date('2026-08-12T02:00:00.000Z')),
    false,
  )
})

test('transiently incomplete Meituan ranking retries after ten minutes', () => {
  const source = {
    enabled: true,
    platformCode: 'MEITUAN',
    pollIntervalMinutes: 120,
    lastRefreshStatus: 'COMPLETE',
    lastRefreshAt: '2026-08-12T02:00:00.000Z',
    lastSummary: {
      recordPath: '$.data.peerRankResult',
      peerRanking: {
        provider: 'MEITUAN',
        metrics: [{ code: 'ROOM_REVENUE', rank: null }],
      },
    },
  }
  assert.equal(
    otaSourcePollingDue(source, new Date('2026-08-12T02:09:59.999Z')),
    false,
  )
  assert.equal(
    otaSourcePollingDue(source, new Date('2026-08-12T02:10:00.000Z')),
    true,
  )
  source.lastSummary.peerRanking.metrics[0].rank = 3
  assert.equal(
    otaSourcePollingDue(source, new Date('2026-08-12T02:10:00.000Z')),
    false,
  )
})

test('existing Meituan comment source is due once to backfill review metrics', () => {
  const source = {
    enabled: true,
    platformCode: 'MEITUAN',
    pollIntervalMinutes: 120,
    lastRefreshStatus: 'COMPLETE',
    lastRefreshAt: '2026-08-12T02:00:00.000Z',
    lastSummary: {
      recordPath: '$.data.commentList',
      detectedDimensions: ['ROOM_TYPE', 'PRICE', 'SALES'],
    },
  }
  assert.equal(
    otaSourcePollingDue(source, new Date('2026-08-12T02:00:01.000Z')),
    true,
  )
  source.lastSummary.reviewMetrics = {
    provider: 'MEITUAN',
  }
  source.lastSummary.reviewOrderPairing = {
    status: 'ORDER_SOURCE_MISSING',
  }
  assert.equal(
    otaSourcePollingDue(source, new Date('2026-08-12T02:00:01.000Z')),
    false,
  )
})

test('Meituan review polling no longer depends on the PMS denominator', () => {
  const source = {
    enabled: true,
    platformCode: 'MEITUAN',
    pollIntervalMinutes: 360,
    lastRefreshStatus: 'COMPLETE',
    lastRefreshAt: '2026-08-12T02:00:00.000Z',
    lastSummary: {
      recordPath: '$.data.commentList',
      reviewMetrics: {
        denominatorStatus: 'PMS_VALID_STAYED_ORDER_COUNT_UNAVAILABLE',
      },
      reviewOrderPairing: {
        status: 'ORDER_SOURCE_MISSING',
      },
    },
  }
  assert.equal(otaSourcePollingDue(
    source,
    new Date('2026-08-12T02:00:01.000Z'),
    { validStayedOrderCountThroughPreviousBusinessDate: 535 },
  ), false)
  assert.equal(otaSourcePollingDue(
    source,
    new Date('2026-08-12T02:00:01.000Z'),
    { validStayedOrderCountThroughPreviousBusinessDate: null },
  ), false)
})

test('legacy review and order summaries are due once for OTA pairing', () => {
  const review = {
    enabled: true,
    platformCode: 'MEITUAN',
    pollIntervalMinutes: 360,
    lastRefreshStatus: 'COMPLETE',
    lastRefreshAt: '2026-08-12T02:00:00.000Z',
    lastSummary: {
      reviewMetrics: { provider: 'MEITUAN' },
    },
  }
  assert.equal(otaSourcePollingDue(
    review,
    new Date('2026-08-12T02:00:01.000Z'),
  ), true)
  review.lastSummary.reviewOrderPairing = {
    status: 'ORDER_SOURCE_MISSING',
  }
  assert.equal(otaSourcePollingDue(
    review,
    new Date('2026-08-12T02:00:01.000Z'),
  ), false)

  const order = {
    enabled: true,
    platformCode: 'MEITUAN',
    pollIntervalMinutes: 360,
    lastRefreshStatus: 'COMPLETE',
    lastRefreshAt: '2026-08-12T02:00:00.000Z',
    lastSummary: {
      providerDataset: {
        provider: 'MEITUAN',
        dataset: 'ORDER',
        scope: 'BUSINESS_MONTH_TO_DATE',
      },
    },
  }
  assert.equal(otaSourcePollingDue(
    order,
    new Date('2026-08-12T02:00:01.000Z'),
  ), true)
  order.lastSummary.providerDataset.periodBasis =
    'THROUGH_PREVIOUS_BUSINESS_DATE'
  assert.equal(otaSourcePollingDue(
    order,
    new Date('2026-08-12T02:00:01.000Z'),
  ), false)
})

test('legacy Douyin review summary is due once for the operating dashboard', () => {
  const source = {
    enabled: true,
    platformCode: 'DOUYIN',
    pollIntervalMinutes: 360,
    lastRefreshStatus: 'COMPLETE',
    lastRefreshAt: '2026-08-12T02:00:00.000Z',
    lastSummary: {
      providerDataset: {
        provider: 'DOUYIN',
        dataset: 'REVIEW',
      },
      reviewOrderPairing: { status: 'ORDER_DATA_INCOMPLETE' },
    },
  }
  assert.equal(otaSourcePollingDue(
    source,
    new Date('2026-08-12T02:00:01.000Z'),
  ), true)
  source.lastSummary.providerDataset.aggregationVersion = 1
  source.lastSummary.reviewMetrics = {
    provider: 'DOUYIN',
    aggregationVersion: 1,
  }
  assert.equal(otaSourcePollingDue(
    source,
    new Date('2026-08-12T02:00:01.000Z'),
  ), false)
})

test('pre-fallback Douyin page-size failure retries once after startup', () => {
  const source = {
    enabled: true,
    platformCode: 'DOUYIN',
    pollIntervalMinutes: 360,
    lastRefreshStatus: 'FAILED',
    lastRefreshAt: '2026-08-12T02:00:00.000Z',
    lastErrorCode: 'OTA_DOUYIN_REVIEW_BUSINESS_ERROR',
  }
  assert.equal(otaSourcePollingDue(
    source,
    new Date('2026-08-12T02:01:29.999Z'),
  ), false)
  assert.equal(otaSourcePollingDue(
    source,
    new Date('2026-08-12T02:01:30.000Z'),
  ), true)
  source.lastErrorCode = 'OTA_DOUYIN_REVIEW_PAGINATION_BUSINESS_ERROR'
  assert.equal(otaSourcePollingDue(
    source,
    new Date('2026-08-12T02:01:30.000Z'),
  ), false)
  source.lastErrorCode = 'OTA_DOUYIN_ORDER_PAGINATION_NOT_DESCENDING'
  assert.equal(otaSourcePollingDue(
    source,
    new Date('2026-08-12T02:01:30.000Z'),
  ), true)
})

test('pre-fix Fliggy legacy review page-size failure retries only once', () => {
  const source = {
    enabled: true,
    platformCode: 'FLIGGY',
    displayName: '飞猪评价',
    dataEndpointUrl: '',
    pollIntervalMinutes: 720,
    lastRefreshStatus: 'FAILED',
    lastRefreshAt: '2026-08-17T14:04:36.652Z',
    lastErrorCode: 'OTA_FLIGGY_BUSINESS_ERROR',
  }
  assert.equal(otaSourcePollingDue(
    source,
    new Date('2026-08-17T14:06:06.651Z'),
  ), false)
  assert.equal(otaSourcePollingDue(
    source,
    new Date('2026-08-17T14:06:06.652Z'),
  ), true)
  source.lastRefreshAt = '2026-08-17T14:05:00.001Z'
  assert.equal(otaSourcePollingDue(
    source,
    new Date('2026-08-17T14:06:30.001Z'),
  ), false)
})

test('Douyin review and order summaries backfill operating aggregates once', () => {
  for (const dataset of ['REVIEW', 'ORDER']) {
    const source = {
      enabled: true,
      platformCode: 'DOUYIN',
      pollIntervalMinutes: 360,
      lastRefreshStatus: 'COMPLETE',
      lastRefreshAt: '2026-08-12T02:00:00.000Z',
      lastSummary: {
        providerDataset: {
          provider: 'DOUYIN',
          dataset,
        },
        ...(dataset === 'REVIEW'
          ? { reviewOrderPairing: { status: 'ORDER_DATA_INCOMPLETE' } }
          : {}),
      },
    }
    assert.equal(otaSourcePollingDue(
      source,
      new Date('2026-08-12T02:00:01.000Z'),
    ), true)
    source.lastSummary.providerDataset.aggregationVersion = 1
    if (dataset === 'REVIEW') {
      source.lastSummary.reviewMetrics = {
        provider: 'DOUYIN',
        aggregationVersion: 1,
      }
    }
    assert.equal(otaSourcePollingDue(
      source,
      new Date('2026-08-12T02:00:01.000Z'),
    ), false)
  }
})

test('provider adapters refresh legacy summaries once after deployment', () => {
  const endpoints = [
    'https://eb.meituan.com/api/v1/ebooking/orders/list?yodaReady=h5',
    'https://life.douyin.com/life/infra/v1/review/get_review_list/?source=hotel',
    'https://life.douyin.com/life/trade_view/v1/workbench/book/query/list',
  ]
  for (const dataEndpointUrl of endpoints) {
    const source = {
      enabled: true,
      pollIntervalMinutes: 360,
      lastRefreshStatus: 'COMPLETE',
      lastRefreshAt: '2026-08-12T02:00:00.000Z',
      dataEndpointUrl,
      lastSummary: {
        recordCount: 0,
        detectedDimensions: [],
      },
    }
    assert.equal(otaSourcePollingDue(
      source,
      new Date('2026-08-12T02:00:01.000Z'),
    ), true)
    source.lastSummary.providerDataset = { provider: 'SAFE_PROJECTION' }
    assert.equal(otaSourcePollingDue(
      source,
      new Date('2026-08-12T02:00:01.000Z'),
    ), false)
  }
})

test('Chinese-named Fliggy sources backfill dashboards while disabled sources stay closed', () => {
  const source = {
    enabled: true,
    platformCode: 'FLIGGY',
    displayName: '飞猪评价',
    pollIntervalMinutes: 720,
    lastRefreshStatus: 'COMPLETE',
    lastRefreshAt: '2026-08-14T06:49:34.523Z',
    dataEndpointUrl: 'https://hotel.fliggy.com/api/reviews',
    lastSummary: {
      recordCount: 10,
      detectedDimensions: [],
    },
  }
  assert.equal(otaSourcePollingDue(
    source,
    new Date('2026-08-14T07:00:00.000Z'),
  ), true)
  source.enabled = false
  assert.equal(otaSourcePollingDue(
    source,
    new Date('2026-08-14T07:00:00.000Z'),
  ), false)
})

test('Fliggy aggregation migration refreshes once and then respects its interval', () => {
  const source = {
    enabled: true,
    platformCode: 'FLIGGY',
    displayName: '飞猪评价',
    pollIntervalMinutes: 720,
    lastRefreshStatus: 'COMPLETE',
    lastRefreshAt: '2026-08-14T08:00:00.000Z',
    dataEndpointUrl: 'https://hotel.fliggy.com/api/reviews',
    lastSummary: {
      providerDataset: {
        provider: 'FLIGGY',
        dataset: 'REVIEW',
        aggregationVersion: 1,
      },
      reviewOrderPairing: { status: 'ORDER_SOURCE_MISSING' },
    },
  }
  assert.equal(otaSourcePollingDue(
    source,
    new Date('2026-08-14T08:00:01.000Z'),
  ), true)
  source.lastSummary.providerDataset.aggregationVersion = 6
  assert.equal(otaSourcePollingDue(
    source,
    new Date('2026-08-14T08:00:01.000Z'),
  ), false)
})

test('provider backfill stays closed for failed or unrecognized sources', () => {
  const source = {
    enabled: true,
    pollIntervalMinutes: 360,
    lastRefreshStatus: 'FAILED',
    lastRefreshAt: '2026-08-12T02:00:00.000Z',
    dataEndpointUrl:
      'https://eb.meituan.com/api/v1/ebooking/orders/list',
    lastSummary: null,
  }
  assert.equal(otaSourcePollingDue(
    source,
    new Date('2026-08-12T02:00:01.000Z'),
  ), false)
  source.lastRefreshStatus = 'COMPLETE'
  source.dataEndpointUrl = 'https://example.com/orders/list'
  source.lastSummary = { recordCount: 0 }
  assert.equal(otaSourcePollingDue(
    source,
    new Date('2026-08-12T02:00:01.000Z'),
  ), false)
})

test('automatic OTA polling waits through the deployment startup grace', () => {
  const startedAt = new Date('2026-08-12T00:00:00.000Z')
  assert.equal(
    otaSourceSchedulerReady(
      startedAt,
      new Date('2026-08-12T00:01:29.999Z'),
    ),
    false,
  )
  assert.equal(
    otaSourceSchedulerReady(
      startedAt,
      new Date('2026-08-12T00:01:30.000Z'),
    ),
    true,
  )
})
