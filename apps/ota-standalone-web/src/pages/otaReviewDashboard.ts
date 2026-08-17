import type {
  OtaReviewMetricsSummary,
  OtaReviewOrderPairingSummary,
  OtaSourceView,
} from '../api/business'

export type OtaHotelReviewRateStatus =
  | 'AVAILABLE'
  | 'NO_REVIEW_DATA'
  | 'DENOMINATOR_UNAVAILABLE'
  | 'PERIOD_MISMATCH'
  | 'ZERO_DENOMINATOR'

export interface OtaChannelReviewDashboard {
  source: OtaSourceView
  metrics: OtaReviewMetricsSummary
  pairing: OtaReviewOrderPairingSummary | null
}

export interface OtaHotelReviewDashboard {
  channels: OtaChannelReviewDashboard[]
  monthlyGoodCount: number
  monthlyNegativeCount: number
  yesterdayNegativeCount: number
  goodRatePercent: number | null
  negativeRatePermille: number | null
  rateStatus: OtaHotelReviewRateStatus
  monthStart: string | null
  previousBusinessDate: string | null
  latestObservedAt: string | null
}

const observedAtTime = (source: OtaSourceView): number => {
  const value = Date.parse(source.lastSummary?.observedAt ?? '')
  return Number.isFinite(value) ? value : 0
}

const rounded = (value: number): number => Math.round(value * 100) / 100

export const isOtaDashboardSource = (source: OtaSourceView): boolean =>
  Boolean(
    source.lastSummary?.peerRanking
    || source.lastSummary?.reviewMetrics
    || source.lastSummary?.providerDataset?.dataset === 'REVIEW'
    || /(?:评价|点评|排名|review|comment|rank)/i.test(source.displayName),
  )

export const buildOtaHotelReviewDashboard = (
  sources: OtaSourceView[],
): OtaHotelReviewDashboard => {
  const latestByProvider = new Map<string, OtaChannelReviewDashboard>()
  for (const source of sources) {
    const metrics = source.lastSummary?.reviewMetrics
    if (!metrics) continue
    const candidate = {
      source,
      metrics,
      pairing: source.lastSummary?.reviewOrderPairing ?? null,
    }
    const current = latestByProvider.get(metrics.provider)
    if (!current || observedAtTime(source) > observedAtTime(current.source)) {
      latestByProvider.set(metrics.provider, candidate)
    }
  }

  const channels = [...latestByProvider.values()].sort((left, right) =>
    left.metrics.provider.localeCompare(right.metrics.provider))
  const monthlyGoodCount = channels.reduce(
    (sum, channel) => sum + channel.metrics.monthlyGoodCount,
    0,
  )
  const monthlyNegativeCount = channels.reduce(
    (sum, channel) => sum + channel.metrics.monthlyNegativeCount,
    0,
  )
  const yesterdayNegativeCount = channels.reduce(
    (sum, channel) => sum + channel.metrics.yesterdayNegativeCount,
    0,
  )
  const latestObservedAt = channels
    .map((channel) => channel.source.lastSummary?.observedAt ?? '')
    .filter(Boolean)
    .sort((left, right) => right.localeCompare(left))[0] ?? null
  const monthStarts = new Set(channels.map((channel) => channel.metrics.monthStart))
  const previousBusinessDates = new Set(
    channels.map((channel) => channel.metrics.previousBusinessDate),
  )
  const base = {
    channels,
    monthlyGoodCount,
    monthlyNegativeCount,
    yesterdayNegativeCount,
    monthStart: monthStarts.size === 1 ? [...monthStarts][0] : null,
    previousBusinessDate:
      previousBusinessDates.size === 1 ? [...previousBusinessDates][0] : null,
    latestObservedAt,
  }

  if (channels.length === 0) {
    return {
      ...base,
      goodRatePercent: null,
      negativeRatePermille: null,
      rateStatus: 'NO_REVIEW_DATA',
    }
  }
  if (monthStarts.size !== 1 || previousBusinessDates.size !== 1) {
    return {
      ...base,
      goodRatePercent: null,
      negativeRatePermille: null,
      rateStatus: 'PERIOD_MISMATCH',
    }
  }
  const ready = channels.every((channel) =>
    channel.pairing?.status === 'AVAILABLE'
    && channel.metrics.denominatorStatus === 'AVAILABLE'
    && Number.isSafeInteger(channel.pairing.denominatorCount)
    && (channel.pairing.denominatorCount ?? -1) >= 0
    && channel.pairing.periodStart === channel.metrics.monthStart
    && channel.pairing.periodEnd === channel.metrics.previousBusinessDate)
  if (!ready) {
    return {
      ...base,
      goodRatePercent: null,
      negativeRatePermille: null,
      rateStatus: 'DENOMINATOR_UNAVAILABLE',
    }
  }
  const denominator = channels.reduce(
    (sum, channel) => sum + (channel.pairing?.denominatorCount ?? 0),
    0,
  )
  if (denominator === 0) {
    return {
      ...base,
      goodRatePercent: null,
      negativeRatePermille: null,
      rateStatus: 'ZERO_DENOMINATOR',
    }
  }
  const goodCount = channels.reduce(
    (sum, channel) =>
      sum + channel.metrics.goodCountThroughPreviousBusinessDate,
    0,
  )
  const negativeCount = channels.reduce(
    (sum, channel) =>
      sum + channel.metrics.negativeCountThroughPreviousBusinessDate,
    0,
  )
  return {
    ...base,
    goodRatePercent: rounded(goodCount / denominator * 100),
    negativeRatePermille: rounded(negativeCount / denominator * 1_000),
    rateStatus: 'AVAILABLE',
  }
}
