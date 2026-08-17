import { builtInFliggyEndpointUrl } from './fliggy-source-collector.mjs'

export const OTA_DEFAULT_POLL_INTERVAL_MINUTES = 120
export const OTA_INCOMPLETE_RANK_RETRY_MINUTES = 10
export const OTA_SCHEDULER_STARTUP_GRACE_MILLISECONDS = 90_000
const FLIGGY_AGGREGATION_VERSION = 6
const FLIGGY_LEGACY_PAGE_SIZE_FIX_CUTOFF = Date.parse(
  '2026-08-17T14:05:00.000Z',
)

const OTA_PROVIDER_DATASET_BACKFILL_ENDPOINTS = Object.freeze([
  ['eb.meituan.com', '/api/v1/ebooking/orders/list'],
  ['life.douyin.com', '/life/infra/v1/review/get_review_list'],
  ['life.douyin.com', '/life/trade_view/v1/workbench/book/query/list'],
])

export const OTA_POLL_INTERVAL_OPTIONS_MINUTES = Object.freeze([
  30,
  60,
  120,
  180,
  240,
  360,
  720,
  1_440,
])

export const otaSourcePollingDue = (
  source,
  now = new Date(),
  _context = {},
) => {
  if (!source?.enabled) return false
  if (
    typeof source.dataEndpointUrl === 'string'
    && !source.dataEndpointUrl.trim()
    && !builtInFliggyEndpointUrl(source)
  ) return false
  if (!OTA_POLL_INTERVAL_OPTIONS_MINUTES.includes(
    source.pollIntervalMinutes,
  )) {
    return false
  }
  const observedAt = new Date(source.lastRefreshAt ?? '').getTime()
  if (!Number.isFinite(observedAt)) return true
  const currentTime = now instanceof Date
    ? now.getTime()
    : new Date(now).getTime()
  if (!Number.isFinite(currentTime)) return false
  if (
    source.platformCode === 'FLIGGY'
    && source.lastRefreshStatus === 'FAILED'
    && source.lastErrorCode === 'OTA_FLIGGY_BUSINESS_ERROR'
    && observedAt < FLIGGY_LEGACY_PAGE_SIZE_FIX_CUTOFF
  ) {
    return currentTime - observedAt >= 90_000
  }
  if (
    source.platformCode === 'DOUYIN'
    && source.lastRefreshStatus === 'FAILED'
    && source.lastErrorCode === 'OTA_DOUYIN_REVIEW_BUSINESS_ERROR'
  ) {
    return currentTime - observedAt >= 90_000
  }
  if (
    source.platformCode === 'DOUYIN'
    && source.lastRefreshStatus === 'FAILED'
    && source.lastErrorCode === 'OTA_DOUYIN_ORDER_PAGINATION_NOT_DESCENDING'
  ) {
    return currentTime - observedAt >= 90_000
  }
  if (
    source.platformCode === 'MEITUAN'
    && source.lastRefreshStatus === 'COMPLETE'
    && source.lastSummary?.recordPath === '$.data.commentList'
    && !source.lastSummary?.reviewMetrics
  ) {
    return true
  }
  if (
    source.lastRefreshStatus === 'COMPLETE'
    && source.lastSummary?.providerDataset?.provider === 'DOUYIN'
    && source.lastSummary.providerDataset.dataset === 'REVIEW'
    && (
      source.lastSummary.providerDataset.aggregationVersion !== 1
      || source.lastSummary?.reviewMetrics?.aggregationVersion !== 1
    )
  ) {
    return true
  }
  if (
    source.lastRefreshStatus === 'COMPLETE'
    && source.lastSummary?.providerDataset?.provider === 'FLIGGY'
    && source.lastSummary.providerDataset.aggregationVersion
      !== FLIGGY_AGGREGATION_VERSION
  ) {
    return true
  }
  if (
    source.lastRefreshStatus === 'COMPLETE'
    && source.lastSummary?.providerDataset?.provider === 'DOUYIN'
    && source.lastSummary.providerDataset.dataset === 'ORDER'
    && source.lastSummary.providerDataset.aggregationVersion !== 1
  ) {
    return true
  }
  if (
    source.lastRefreshStatus === 'COMPLETE'
    && !source.lastSummary?.providerDataset
    && !source.lastSummary?.peerRanking
  ) {
    try {
      const endpoint = new URL(source.dataEndpointUrl)
      const pathname = endpoint.pathname.replace(/\/+$/, '')
      const fliggyApi = endpoint.searchParams.get('api') ?? ''
      const requiresProviderDatasetBackfill =
        endpoint.protocol === 'https:'
        && (
          OTA_PROVIDER_DATASET_BACKFILL_ENDPOINTS.some(
            ([hostname, expectedPathname]) =>
              endpoint.hostname === hostname
              && pathname === expectedPathname,
          )
          || (
            source.platformCode === 'FLIGGY'
            && (
              endpoint.hostname === 'fliggy.com'
              || endpoint.hostname.endsWith('.fliggy.com')
            )
            && /order|review|comment|evaluate|rank|订单|评价|点评|排名/i.test(
              `${fliggyApi} ${source.displayName ?? ''}`,
            )
          )
        )
      if (requiresProviderDatasetBackfill) return true
    } catch {
      // Invalid or absent endpoint URLs stay on the ordinary interval path.
    }
  }
  if (
    source.platformCode === 'MEITUAN'
    && source.lastRefreshStatus === 'COMPLETE'
    && source.lastSummary?.recordPath === '$.data.peerRankResult'
  ) {
    if (!source.lastSummary?.peerRanking) return true
    const hasIncompleteRank = source.lastSummary.peerRanking.metrics
      ?.some((metric) => metric?.rank === null)
    if (hasIncompleteRank) {
      return currentTime - observedAt
      >= OTA_INCOMPLETE_RANK_RETRY_MINUTES * 60_000
    }
  }
  if (
    source.lastRefreshStatus === 'COMPLETE'
    && (
      source.lastSummary?.reviewMetrics
      || source.lastSummary?.providerDataset?.dataset === 'REVIEW'
    )
    && !source.lastSummary?.reviewOrderPairing
  ) {
    return true
  }
  if (
    source.lastRefreshStatus === 'COMPLETE'
    && source.lastSummary?.providerDataset?.dataset === 'ORDER'
    && source.lastSummary.providerDataset.scope === 'BUSINESS_MONTH_TO_DATE'
    && source.lastSummary.providerDataset.periodBasis
      !== 'THROUGH_PREVIOUS_BUSINESS_DATE'
  ) {
    return true
  }
  return currentTime - observedAt
    >= source.pollIntervalMinutes * 60_000
}

export const otaSourceSchedulerReady = (
  startedAt,
  now = new Date(),
) => {
  const startedTime = new Date(startedAt).getTime()
  const currentTime = new Date(now).getTime()
  return Number.isFinite(startedTime)
    && Number.isFinite(currentTime)
    && currentTime - startedTime
      >= OTA_SCHEDULER_STARTUP_GRACE_MILLISECONDS
}
