import { shanghaiScheduleParts } from '../../report-schedule.mjs'

const fullyDelivered = (delivery) =>
  delivery?.deliveryStatus === 'DELIVERED'
  && Number.isInteger(delivery.partCount)
  && delivery.partCount > 0
  && delivery.deliveredPartCount === delivery.partCount
  && typeof delivery.completedAt === 'string'

export const dailyBriefingAuditSlot = (date = new Date()) => {
  const parts = shanghaiScheduleParts(date)
  if (parts.hour !== 1 || parts.minute < 20 || parts.minute > 25) {
    return null
  }
  return {
    ...parts,
    auditKey: `${parts.dateKey}:01:20`,
    snapshotHourKey: `${parts.dateKey}T01`,
  }
}

export const dailyBriefingRepairSlot = (date = new Date()) => {
  const parts = shanghaiScheduleParts(date)
  if (parts.hour !== 7 || parts.minute < 30 || parts.minute > 35) {
    return null
  }
  return {
    ...parts,
    repairKey: `${parts.dateKey}:07:30`,
    auditKey: `${parts.dateKey}:01:20`,
  }
}

export const isNightlyRepairDeferred = (date = new Date()) => {
  const { hour, minute } = shanghaiScheduleParts(date)
  return hour >= 1 && (hour < 7 || (hour === 7 && minute < 30))
}

export const auditBriefingStore = ({
  hotel,
  luopanConfig,
  weComConfig,
  snapshots = [],
  deliveries = [],
  date = new Date(),
}) => {
  const { dateKey } = shanghaiScheduleParts(date)
  if (hotel?.collectionEnabled === false) {
    return { status: 'COLLECTION_DISABLED', dateKey }
  }
  if (
    weComConfig
    && (!weComConfig.enabled || !weComConfig.webhookConfigured)
  ) {
    return { status: 'DELIVERY_DISABLED', dateKey }
  }
  if (
    hotel?.pmsSystemCode === 'LUOPAN_CLOUD'
    && luopanConfig?.lastErrorCode === 'LUOPAN_REAUTH_REQUIRED'
  ) {
    return { status: 'REAUTH_REQUIRED', dateKey }
  }
  const snapshot = snapshots
    .filter((item) =>
      String(item?.observedAt ?? '').startsWith(`${dateKey}T01:0`))
    .sort((left, right) =>
      String(left.observedAt).localeCompare(String(right.observedAt)))
    .at(-1)
  if (!snapshot) {
    return { status: 'COLLECTION_MISSING', dateKey }
  }
  const matching = deliveries.filter(
    (item) =>
      item?.hotelId === hotel.hotelId
      && item.cutoffAt === snapshot.observedAt,
  )
  const todayRevenueDelivered = matching.some(
    (item) => item.deliveryType === 'TODAY_REVENUE' && fullyDelivered(item),
  )
  const future14dDelivered = matching.some(
    (item) => item.deliveryType === 'FUTURE_14D' && fullyDelivered(item),
  )
  if (!todayRevenueDelivered || !future14dDelivered) {
    return {
      status: 'DELIVERY_MISSING',
      dateKey,
      snapshotObservedAt: snapshot.observedAt,
      todayRevenueDelivered,
      future14dDelivered,
    }
  }
  return {
    status: 'HEALTHY',
    dateKey,
    snapshotObservedAt: snapshot.observedAt,
    todayRevenueDelivered: true,
    future14dDelivered: true,
  }
}

// Backward-compatible name for existing imports and integrations.
export const auditLuopanBriefingStore = auditBriefingStore
