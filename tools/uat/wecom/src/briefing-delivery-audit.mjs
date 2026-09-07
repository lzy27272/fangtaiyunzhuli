import { shanghaiScheduleParts } from '../../report-schedule.mjs'

const CUSTOM_SCHEDULE_MODE = 'CUSTOM_V1'
const CUSTOM_BROADCAST_INTERVALS = new Set([1, 2, 3, 4])
const LEGACY_AUDIT_HOUR = 1
const AUDIT_START_MINUTE = 20
const AUDIT_END_MINUTE = 25
const REPAIR_HOUR = 7
const REPAIR_START_MINUTE = 30
const REPAIR_END_MINUTE = 35

const dateKeyBefore = (dateKey) => {
  const date = new Date(`${dateKey}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() - 1)
  return date.toISOString().slice(0, 10)
}

const customSchedulePaused = (config) =>
  config?.broadcastScheduleMode === CUSTOM_SCHEDULE_MODE
  && config.enabled === false
  && config.broadcastIntervalHours === 0

const customScheduleNotEffectiveForSlot = (config, snapshotHourKey) => {
  if (
    config?.broadcastScheduleMode !== CUSTOM_SCHEDULE_MODE
    || typeof snapshotHourKey !== 'string'
    || typeof config.broadcastScheduleEffectiveAt !== 'string'
  ) return false
  const slotAt = new Date(`${snapshotHourKey}:00:00+08:00`).getTime()
  const effectiveAt = new Date(config.broadcastScheduleEffectiveAt).getTime()
  return Number.isFinite(slotAt)
    && Number.isFinite(effectiveAt)
    && slotAt < effectiveAt
}

const validCustomSchedule = (config) =>
  config?.broadcastScheduleMode === CUSTOM_SCHEDULE_MODE
  && config.enabled === true
  && Number.isInteger(config.broadcastStartHour)
  && config.broadcastStartHour >= 0
  && config.broadcastStartHour <= 23
  && Number.isInteger(config.broadcastQuietHour)
  && config.broadcastQuietHour >= 0
  && config.broadcastQuietHour <= 23
  && config.broadcastStartHour !== config.broadcastQuietHour
  && CUSTOM_BROADCAST_INTERVALS.has(config.broadcastIntervalHours)

const customLastBroadcastHour = (config) => {
  if (!validCustomSchedule(config)) return null
  const activeWindowHours =
    (config.broadcastQuietHour - config.broadcastStartHour + 24) % 24
  const lastOffset = Math.floor(
    (activeWindowHours - 1) / config.broadcastIntervalHours,
  ) * config.broadcastIntervalHours
  return (config.broadcastStartHour + lastOffset) % 24
}

const auditSlotFor = ({ dateKey, hour, parts }) => ({
  ...parts,
  dateKey,
  auditKey: `${dateKey}:${String(hour).padStart(2, '0')}:20`,
  snapshotHourKey: `${dateKey}T${String(hour).padStart(2, '0')}`,
})

const fullyDelivered = (delivery) =>
  delivery?.deliveryStatus === 'DELIVERED'
  && Number.isInteger(delivery.partCount)
  && delivery.partCount > 0
  && delivery.deliveredPartCount === delivery.partCount
  && typeof delivery.completedAt === 'string'

export const dailyBriefingAuditSlot = (date = new Date(), config = {}) => {
  const parts = shanghaiScheduleParts(date)
  const customLastHour = customLastBroadcastHour(config)
  const auditHour = customLastHour ?? LEGACY_AUDIT_HOUR
  if (
    parts.hour !== auditHour
    || parts.minute < AUDIT_START_MINUTE
    || parts.minute > AUDIT_END_MINUTE
  ) {
    return null
  }
  return auditSlotFor({ dateKey: parts.dateKey, hour: auditHour, parts })
}

export const dailyBriefingRepairSlot = (date = new Date(), config = {}) => {
  const parts = shanghaiScheduleParts(date)
  if (
    parts.hour !== REPAIR_HOUR
    || parts.minute < REPAIR_START_MINUTE
    || parts.minute > REPAIR_END_MINUTE
  ) {
    return null
  }
  const customLastHour = customLastBroadcastHour(config)
  const auditHour = customLastHour ?? LEGACY_AUDIT_HOUR
  const auditDateKey = customLastHour !== null && customLastHour > REPAIR_HOUR
    ? dateKeyBefore(parts.dateKey)
    : parts.dateKey
  return {
    ...parts,
    repairKey: `${parts.dateKey}:07:30`,
    auditKey:
      `${auditDateKey}:${String(auditHour).padStart(2, '0')}:20`,
    snapshotHourKey:
      `${auditDateKey}T${String(auditHour).padStart(2, '0')}`,
    auditDateKey,
  }
}

export const isNightlyRepairDeferred = (date = new Date()) => {
  const { hour, minute } = shanghaiScheduleParts(date)
  return hour < 7 || (hour === 7 && minute < 30)
}

export const auditBriefingStore = ({
  hotel,
  luopanConfig,
  weComConfig,
  snapshots = [],
  deliveries = [],
  date = new Date(),
  snapshotHourKey = null,
}) => {
  const scheduleParts = shanghaiScheduleParts(date)
  const dateKey = typeof snapshotHourKey === 'string'
    ? snapshotHourKey.slice(0, 10)
    : scheduleParts.dateKey
  if (hotel?.collectionEnabled === false) {
    return { status: 'COLLECTION_DISABLED', dateKey }
  }
  if (customSchedulePaused(weComConfig)) {
    return { status: 'NOT_REQUIRED', dateKey }
  }
  if (customScheduleNotEffectiveForSlot(weComConfig, snapshotHourKey)) {
    return { status: 'NOT_REQUIRED', dateKey }
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
  const expectedSnapshotHourKey = typeof snapshotHourKey === 'string'
    ? snapshotHourKey
    : `${dateKey}T01`
  const snapshot = snapshots
    .filter((item) =>
      String(item?.observedAt ?? '').startsWith(
        `${expectedSnapshotHourKey}:0`,
      ))
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
