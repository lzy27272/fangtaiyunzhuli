const safeCount = (value) =>
  Number.isSafeInteger(value) && value >= 0 ? value : null

const orderDatasetFor = (source) => {
  if (
    !source?.enabled
    || source.lastRefreshStatus !== 'COMPLETE'
    || source.lastSummary?.providerDataset?.dataset !== 'ORDER'
  ) return null
  return source.lastSummary.providerDataset
}

const reviewProviderFor = (source) =>
  source?.lastSummary?.reviewMetrics?.provider
  ?? (source?.lastSummary?.providerDataset?.dataset === 'REVIEW'
    ? source.lastSummary.providerDataset.provider
    : null)

const pairingFor = ({ source, orderSource }) => {
  const provider = reviewProviderFor(source)
  const reviewMetrics = source.lastSummary?.reviewMetrics ?? null
  const orderDataset = orderSource ? orderDatasetFor(orderSource) : null
  const base = {
    provider,
    orderSourceId: orderSource?.sourceId ?? null,
    orderCountDefinition: 'NON_CANCELED_OTA_ORDERS',
    periodStart: reviewMetrics?.monthStart ?? orderDataset?.rangeStart ?? null,
    periodEnd:
      reviewMetrics?.previousBusinessDate ?? orderDataset?.rangeEnd ?? null,
    denominatorCount: null,
    orderDataComplete: false,
    scoreMetricsAvailable: Boolean(reviewMetrics),
  }
  if (!orderDataset) {
    return { ...base, status: 'ORDER_SOURCE_MISSING' }
  }
  const denominator = safeCount(orderDataset.nonCanceledCount)
  const orderDataComplete =
    orderDataset.scope === 'BUSINESS_MONTH_TO_DATE'
    && orderDataset.periodBasis === 'THROUGH_PREVIOUS_BUSINESS_DATE'
    && orderDataset.paginationComplete !== false
    && denominator !== null
  if (!orderDataComplete) {
    return { ...base, status: 'ORDER_DATA_INCOMPLETE' }
  }
  if (!reviewMetrics) {
    return {
      ...base,
      denominatorCount: denominator,
      orderDataComplete: true,
      status: 'REVIEW_SCORE_METRICS_UNAVAILABLE',
    }
  }
  if (
    orderDataset.rangeStart !== reviewMetrics.monthStart
    || orderDataset.rangeEnd !== reviewMetrics.previousBusinessDate
  ) {
    return {
      ...base,
      denominatorCount: denominator,
      orderDataComplete: true,
      status: 'PERIOD_MISMATCH',
    }
  }
  return {
    ...base,
    denominatorCount: denominator,
    orderDataComplete: true,
    status: denominator > 0 ? 'AVAILABLE' : 'ZERO_DENOMINATOR',
  }
}

const reviewMetricsWithPairing = (reviewMetrics, pairing) => {
  const denominator = pairing.status === 'AVAILABLE'
    ? pairing.denominatorCount
    : null
  return {
    ...reviewMetrics,
    validStayedOrderCountThroughPreviousBusinessDate: null,
    eligibleOtaOrderCountThroughPreviousBusinessDate: denominator,
    goodRatePercent: denominator === null
      ? null
      : Number((
        reviewMetrics.goodCountThroughPreviousBusinessDate
        / denominator
        * 100
      ).toFixed(2)),
    negativeRatePermille: denominator === null
      ? null
      : Number((
        reviewMetrics.negativeCountThroughPreviousBusinessDate
        / denominator
        * 1_000
      ).toFixed(2)),
    denominatorSource: 'MATCHED_OTA_ORDER_SOURCE',
    denominatorStatus: pairing.status,
  }
}

export const pairOtaReviewAndOrderSources = (sources) => {
  const sourceList = Array.isArray(sources) ? sources : []
  const orderByProvider = new Map()
  for (const source of sourceList) {
    const dataset = orderDatasetFor(source)
    if (!dataset || orderByProvider.has(dataset.provider)) continue
    orderByProvider.set(dataset.provider, source)
  }
  return sourceList.map((source) => {
    const provider = reviewProviderFor(source)
    if (!provider) return source
    const pairing = pairingFor({
      source,
      orderSource: orderByProvider.get(provider) ?? null,
    })
    return {
      ...source,
      lastSummary: {
        ...source.lastSummary,
        reviewOrderPairing: pairing,
        ...(source.lastSummary.reviewMetrics
          ? {
              reviewMetrics: reviewMetricsWithPairing(
                source.lastSummary.reviewMetrics,
                pairing,
              ),
            }
          : {}),
      },
    }
  })
}
