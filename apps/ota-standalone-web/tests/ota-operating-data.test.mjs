import assert from 'node:assert/strict'
import test from 'node:test'
import {
  groupOtaOperatingSources,
  latestSuccessfulCollectionAt,
  otaOperatingDataKind,
  otaOperatingDataState,
  otaReviewDashboardSources,
} from '../src/pages/otaOperatingData.ts'
import { otaSourceGuidance } from '../src/pages/otaSourceGuidance.ts'

const source = (overrides = {}) => ({
  sourceId: 'source-1',
  displayName: '携程经营数据',
  platformCode: 'CTRIP',
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
  lastRefreshAt: '2026-09-17T01:33:29.021Z',
  lastErrorCode: null,
  lastSummary: {
    observedAt: '2026-09-17T01:33:29.021Z',
    httpStatus: 200,
    rootType: 'object',
    recordPath: '$.ResponseStatus.Extension',
    recordCount: 2,
    detectedDimensions: [],
    detectedFields: ['Id', 'Value'],
  },
  rowVersion: 1,
  ...overrides,
})

test('configured Ctrip metadata stays visible but is not reported as operating data', () => {
  const configured = source()
  assert.deepEqual(otaOperatingDataState(configured), {
    state: 'UNRECOGNIZED',
    label: '未形成经营数据',
    tone: 'warning',
  })
  assert.equal(otaOperatingDataKind(configured), 'GENERIC')
  const groups = groupOtaOperatingSources([configured])
  assert.equal(groups.length, 1)
  assert.equal(groups[0].platformCode, 'CTRIP')
  assert.equal(groups[0].sources[0], configured)
})

test('generic dimensions are shown as structure pending mapping', () => {
  const configured = source({
    lastSummary: {
      ...source().lastSummary,
      recordPath: '$.data',
      recordCount: 1,
      detectedDimensions: ['DATE', 'INVENTORY'],
      detectedFields: ['stayDate', 'availableRooms'],
    },
  })
  assert.equal(otaOperatingDataState(configured).state, 'STRUCTURE_ONLY')
})

test('rank, review, and order summaries are recognized as formed data', () => {
  const rank = source({
    lastSummary: {
      ...source().lastSummary,
      peerRanking: { provider: 'MEITUAN', metrics: [] },
    },
  })
  const review = source({
    lastSummary: {
      ...source().lastSummary,
      providerDataset: {
        provider: 'FLIGGY',
        dataset: 'REVIEW',
        scope: 'ENDPOINT_TOTAL_AND_CURRENT_PAGE',
        totalCount: 0,
        returnedCount: 0,
      },
    },
  })
  const order = source({
    lastSummary: {
      ...source().lastSummary,
      providerDataset: {
        provider: 'DOUYIN',
        dataset: 'ORDER',
        scope: 'BUSINESS_MONTH_TO_DATE',
        totalCount: 0,
        returnedCount: 0,
      },
    },
  })

  assert.equal(otaOperatingDataKind(rank), 'RANK')
  assert.equal(otaOperatingDataKind(review), 'REVIEW')
  assert.equal(otaOperatingDataKind(order), 'ORDER')
  assert.equal(otaOperatingDataState(rank).state, 'READY')
  assert.equal(otaOperatingDataState(review).state, 'READY')
  assert.equal(otaOperatingDataState(order).state, 'READY')
})

test('same-platform sources remain present and platform state reflects the worst source', () => {
  const complete = source({ sourceId: 'ctrip-complete' })
  const failed = source({
    sourceId: 'ctrip-failed',
    displayName: '携程评价',
    lastRefreshStatus: 'FAILED',
    lastErrorCode: 'OTA_HTTP_403',
    lastSummary: null,
  })
  const groups = groupOtaOperatingSources([complete, failed])
  assert.equal(groups.length, 1)
  assert.equal(groups[0].sources.length, 2)
  assert.deepEqual(
    groups[0].sources.map((item) => item.sourceId),
    ['ctrip-complete', 'ctrip-failed'],
  )
  assert.equal(groups[0].state.state, 'FAILED')
})

test('review dashboard excludes disabled, failed, and unrecognized sources', () => {
  const readyReview = source({
    sourceId: 'ready-review',
    platformCode: 'DOUYIN',
    lastSummary: {
      ...source().lastSummary,
      providerDataset: {
        provider: 'DOUYIN',
        dataset: 'REVIEW',
        scope: 'ENDPOINT_TOTAL_AND_CURRENT_PAGE',
        totalCount: 3,
        returnedCount: 3,
      },
    },
  })
  const readyOrder = source({
    sourceId: 'ready-order',
    platformCode: 'DOUYIN',
    lastSummary: {
      ...source().lastSummary,
      providerDataset: {
        provider: 'DOUYIN',
        dataset: 'ORDER',
        scope: 'BUSINESS_MONTH_TO_DATE',
        totalCount: 4,
        returnedCount: 4,
      },
    },
  })
  const included = otaReviewDashboardSources([
    readyReview,
    readyOrder,
    source({ sourceId: 'unrecognized' }),
    source({ sourceId: 'disabled', enabled: false }),
    source({
      sourceId: 'failed',
      lastRefreshStatus: 'FAILED',
      lastSummary: null,
    }),
  ])
  assert.deepEqual(
    included.map((item) => item.sourceId),
    ['ready-review', 'ready-order'],
  )
})

test('latest collection time includes only successful enabled OTA sources', () => {
  const latest = latestSuccessfulCollectionAt('2026-09-17T01:00:00.000Z', [
    source({
      platformCode: 'DOUYIN',
      lastRefreshAt: '2026-09-17T01:33:29.021Z',
      lastSummary: {
        ...source().lastSummary,
        providerDataset: {
          provider: 'DOUYIN',
          dataset: 'ORDER',
          scope: 'BUSINESS_MONTH_TO_DATE',
          totalCount: 0,
          returnedCount: 0,
        },
      },
    }),
    source({
      sourceId: 'unrecognized-later',
      lastRefreshAt: '2026-09-17T01:45:00.000Z',
    }),
    source({
      sourceId: 'failed-later',
      lastRefreshStatus: 'FAILED',
      lastRefreshAt: '2026-09-17T02:00:00.000Z',
      lastSummary: null,
    }),
  ])
  assert.equal(latest, '2026-09-17T01:33:29.021Z')
})

test('Ctrip schema guidance explains why HTTP success is not enough', () => {
  const guidance = otaSourceGuidance('OTA_CTRIP_ORDER_SCHEMA_UNRECOGNIZED')
  assert.match(guidance.reason, /尚未安全识别携程订单结构/u)
  assert.match(guidance.action, /不要反复更换 Cookie/u)
  assert.equal(otaOperatingDataState(source({
    lastRefreshStatus: 'FAILED',
    lastErrorCode: 'OTA_CTRIP_ORDER_SCHEMA_UNRECOGNIZED',
    lastSummary: null,
  })).state, 'UNRECOGNIZED')
})

test('expired Ctrip session routes the operator to reauthentication without changing the endpoint', () => {
  const guidance = otaSourceGuidance('OTA_CTRIP_SESSION_INVALID')
  assert.match(guidance.reason, /携程登录会话已过期/u)
  assert.match(guidance.action, /接口网址和请求参数无需修改/u)
  assert.match(guidance.action, /保存后系统会立即重新采集/u)
  assert.equal(otaOperatingDataState(source({
    lastRefreshStatus: 'FAILED',
    lastErrorCode: 'OTA_CTRIP_SESSION_INVALID',
    lastSummary: null,
  })).state, 'FAILED')
})
