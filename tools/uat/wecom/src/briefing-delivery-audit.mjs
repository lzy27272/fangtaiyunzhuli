import { shanghaiScheduleParts } from '../../report-schedule.mjs'

const fullyDelivered = (delivery) =>
  delivery?.deliveryStatus === 'DELIVERED'
  && Number.isInteger(delivery.partCount)
  && delivery.partCount > 0
  && delivery.deliveredPartCount === delivery.partCount
  && typeof delivery.completedAt === 'string'

export const dailyBriefingAuditSlot = (date = new Date()) => {
  const parts = shanghaiScheduleParts(date)
  if (parts.hour !== 8 || parts.minute < 15 || parts.minute > 20) {
    return null
  }
  return {
    ...parts,
    auditKey: `${parts.dateKey}:08:15`,
  }
}

export const auditLuopanBriefingStore = ({
  hotel,
  luopanConfig,
  snapshots = [],
  deliveries = [],
  date = new Date(),
}) => {
  const { dateKey } = shanghaiScheduleParts(date)
  if (hotel?.pmsSystemCode !== 'LUOPAN_CLOUD') {
    return { status: 'NOT_APPLICABLE', dateKey }
  }
  if (luopanConfig?.lastErrorCode === 'LUOPAN_REAUTH_REQUIRED') {
    return { status: 'REAUTH_REQUIRED', dateKey }
  }
  const snapshot = snapshots
    .filter((item) =>
      String(item?.observedAt ?? '').startsWith(`${dateKey}T08:0`))
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
