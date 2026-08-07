const SHANGHAI_TIME_ZONE = 'Asia/Shanghai'
const BROADCAST_START_HOUR = 8
const BROADCAST_END_HOUR = 2
const END_HOUR_DELIVERY_CUTOFF_MINUTE = 15

const dateKeyBefore = (dateKey) => {
  const date = new Date(`${dateKey}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() - 1)
  return date.toISOString().slice(0, 10)
}

export const shanghaiScheduleParts = (date = new Date()) => {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: SHANGHAI_TIME_ZONE,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(date)
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, part.value]),
  )
  const dateKey = `${parts.year}-${parts.month}-${parts.day}`
  return {
    dateKey,
    hourKey: `${dateKey}T${parts.hour}`,
    hour: Number(parts.hour),
    minute: Number(parts.minute),
  }
}

export const isBroadcastHour = (hour) =>
  Number.isInteger(hour)
  && (hour >= BROADCAST_START_HOUR || hour <= BROADCAST_END_HOUR)

export const collectionSlotFor = (date = new Date()) => {
  const parts = shanghaiScheduleParts(date)
  if (!isBroadcastHour(parts.hour)) return null
  const slotMinute =
    parts.minute >= 0 && parts.minute <= 5
      ? 0
      : parts.minute >= 30 && parts.minute <= 35
        ? 30
        : null
  if (
    slotMinute === null
    || (parts.hour === BROADCAST_END_HOUR && slotMinute === 30)
  ) {
    return null
  }
  return {
    ...parts,
    slotMinute,
    slotKey: `${parts.hourKey}:${String(slotMinute).padStart(2, '0')}`,
  }
}

export const isBroadcastWindowOpen = (date = new Date()) => {
  const { hour, minute } = shanghaiScheduleParts(date)
  if (hour >= BROADCAST_START_HOUR || hour < BROADCAST_END_HOUR) return true
  return hour === BROADCAST_END_HOUR
    && minute <= END_HOUR_DELIVERY_CUTOFF_MINUTE
}

export const isBriefDeliveryTime = (date, sendMinute) => {
  const { minute } = shanghaiScheduleParts(date)
  return isBroadcastWindowOpen(date) && minute >= sendMinute
}

export const briefingCycleStart = (date = new Date()) => {
  const { dateKey, hour } = shanghaiScheduleParts(date)
  const cycleDate =
    hour >= BROADCAST_START_HOUR ? dateKey : dateKeyBefore(dateKey)
  return `${cycleDate}T08:00:00+08:00`
}

export const isScheduledBriefSnapshot = (snapshot) => {
  const match = String(snapshot?.observedAt ?? '').match(
    /^\d{4}-\d{2}-\d{2}T(\d{2}):(\d{2})/,
  )
  if (!match) return false
  const hour = Number(match[1])
  const minute = Number(match[2])
  return (
    isBroadcastHour(hour)
    && minute <= 29
  )
}

export const briefingCycleSnapshots = (snapshots, date = new Date()) => {
  const cycleStartedAt = new Date(briefingCycleStart(date)).getTime()
  return snapshots.filter((snapshot) => {
    if (!isScheduledBriefSnapshot(snapshot)) return false
    const observedAt = new Date(snapshot.observedAt).getTime()
    return Number.isFinite(observedAt) && observedAt >= cycleStartedAt
  })
}

export const briefingSnapshotsObservedAfter = (snapshots, startedAt) => {
  const startedAtTime = new Date(startedAt).getTime()
  if (!Number.isFinite(startedAtTime)) return []
  return snapshots.filter((snapshot) => {
    const observedAt = new Date(snapshot?.observedAt ?? '').getTime()
    return Number.isFinite(observedAt) && observedAt >= startedAtTime
  })
}

export const briefingSnapshotsObservedAfterOrCurrentHour = (
  snapshots,
  startedAt,
  date = new Date(),
) => {
  const startedAtTime = new Date(startedAt).getTime()
  if (!Number.isFinite(startedAtTime)) return []
  const { hourKey } = shanghaiScheduleParts(date)
  return snapshots.filter((snapshot) => {
    const observedAtText = String(snapshot?.observedAt ?? '')
    const observedAt = new Date(observedAtText).getTime()
    return Number.isFinite(observedAt)
      && (
        observedAt >= startedAtTime
        || observedAtText.startsWith(`${hourKey}:`)
      )
  })
}
