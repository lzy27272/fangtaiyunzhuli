export const OTA_DEFAULT_POLL_INTERVAL_MINUTES = 120
export const OTA_INCOMPLETE_RANK_RETRY_MINUTES = 10
export const OTA_SCHEDULER_STARTUP_GRACE_MILLISECONDS = 90_000

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
  { validStayedOrderCountThroughPreviousBusinessDate = null } = {},
) => {
  if (!source?.enabled) return false
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
    source.platformCode === 'MEITUAN'
    && source.lastRefreshStatus === 'COMPLETE'
    && source.lastSummary?.recordPath === '$.data.commentList'
  ) {
    if (!source.lastSummary?.reviewMetrics) return true
    if (
      source.lastSummary.reviewMetrics.denominatorStatus
        === 'PMS_VALID_STAYED_ORDER_COUNT_UNAVAILABLE'
      && Number.isSafeInteger(
        validStayedOrderCountThroughPreviousBusinessDate,
      )
      && validStayedOrderCountThroughPreviousBusinessDate > 0
    ) return true
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
