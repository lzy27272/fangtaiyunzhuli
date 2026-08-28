const SHANGHAI_TIME_ZONE = 'Asia/Shanghai'
const PEAK_BROADCAST_START_HOUR = 8
const STANDARD_BROADCAST_START_HOUR = 9
const FINAL_COLLECTION_HOUR = 1
const END_HOUR_DELIVERY_CUTOFF_MINUTE = 15
const PEAK_MONTHS = new Set([7, 8])
const STANDARD_COLLECTION_HOURS = new Set([9, 11, 13])

// 2026 dates are sourced from the State Council General Office notice
// 国办发明电〔2025〕7号. Later annual calendars can replace this built-in
// set through OTA_REVIEW_PUBLIC_HOLIDAY_DATES without a code deployment.
const BUILT_IN_PUBLIC_HOLIDAY_DATES = [
  '2026-01-01',
  '2026-01-02',
  '2026-01-03',
  '2026-02-15',
  '2026-02-16',
  '2026-02-17',
  '2026-02-18',
  '2026-02-19',
  '2026-02-20',
  '2026-02-21',
  '2026-02-22',
  '2026-02-23',
  '2026-04-04',
  '2026-04-05',
  '2026-04-06',
  '2026-05-01',
  '2026-05-02',
  '2026-05-03',
  '2026-05-04',
  '2026-05-05',
  '2026-06-19',
  '2026-06-20',
  '2026-06-21',
  '2026-09-25',
  '2026-09-26',
  '2026-09-27',
  '2026-10-01',
  '2026-10-02',
  '2026-10-03',
  '2026-10-04',
  '2026-10-05',
  '2026-10-06',
  '2026-10-07',
]

const holidayDatesFromEnv = () => {
  const configured = process.env.OTA_REVIEW_PUBLIC_HOLIDAY_DATES?.trim()
  if (!configured) return new Set(BUILT_IN_PUBLIC_HOLIDAY_DATES)
  const dates = configured
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
  if (
    dates.length === 0
    || dates.some((value) => !/^\d{4}-\d{2}-\d{2}$/.test(value))
  ) {
    throw new Error('PUBLIC_HOLIDAY_DATES_INVALID')
  }
  return new Set(dates)
}

const publicHolidayDates = holidayDatesFromEnv()

const dateKeyBefore = (dateKey) => {
  const date = new Date(`${dateKey}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() - 1)
  return date.toISOString().slice(0, 10)
}

const dateKeyAfter = (dateKey) => {
  const date = new Date(`${dateKey}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() + 1)
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
    month: Number(parts.month),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
  }
}

const isPeakScheduleDate = (
  dateKey,
  holidayDates = publicHolidayDates,
) => {
  const month = Number(dateKey.slice(5, 7))
  return PEAK_MONTHS.has(month)
    || holidayDates.has(dateKey)
    || holidayDates.has(dateKeyAfter(dateKey))
}

export const reportScheduleFor = (
  date = new Date(),
  holidayDates = publicHolidayDates,
) => {
  const parts = shanghaiScheduleParts(date)
  const scheduleDate = parts.hour <= FINAL_COLLECTION_HOUR
    ? dateKeyBefore(parts.dateKey)
    : parts.dateKey
  const peak = isPeakScheduleDate(scheduleDate, holidayDates)
  return {
    ...parts,
    scheduleDate,
    profile: peak ? 'PEAK_HOURLY' : 'STANDARD_MIXED',
    startHour: peak
      ? PEAK_BROADCAST_START_HOUR
      : STANDARD_BROADCAST_START_HOUR,
  }
}

export const isBroadcastHour = (hour, profile = 'PEAK_HOURLY') => {
  if (!Number.isInteger(hour)) return false
  if (hour <= FINAL_COLLECTION_HOUR) return true
  if (profile === 'PEAK_HOURLY') {
    return hour >= PEAK_BROADCAST_START_HOUR
  }
  return STANDARD_COLLECTION_HOURS.has(hour) || hour >= 14
}

export const collectionSlotFor = (
  date = new Date(),
  holidayDates = publicHolidayDates,
) => {
  const schedule = reportScheduleFor(date, holidayDates)
  if (!isBroadcastHour(schedule.hour, schedule.profile)) return null
  const slotMinute = schedule.minute >= 0 && schedule.minute <= 5 ? 0 : null
  if (slotMinute === null) return null
  return {
    ...schedule,
    slotMinute,
    slotKey: `${schedule.hourKey}:${String(slotMinute).padStart(2, '0')}`,
  }
}

export const isBroadcastWindowOpen = (
  date = new Date(),
  holidayDates = publicHolidayDates,
) => {
  const schedule = reportScheduleFor(date, holidayDates)
  if (!isBroadcastHour(schedule.hour, schedule.profile)) return false
  return schedule.hour !== FINAL_COLLECTION_HOUR
    ? true
    : schedule.minute <= END_HOUR_DELIVERY_CUTOFF_MINUTE
}

export const isBriefDeliveryTime = (
  date,
  sendMinute,
  holidayDates = publicHolidayDates,
) => {
  const { minute } = shanghaiScheduleParts(date)
  return isBroadcastWindowOpen(date, holidayDates) && minute >= sendMinute
}

export const briefingCycleStart = (
  date = new Date(),
  holidayDates = publicHolidayDates,
) => {
  const schedule = reportScheduleFor(date, holidayDates)
  return `${schedule.scheduleDate}T${String(schedule.startHour).padStart(2, '0')}:00:00+08:00`
}

export const isScheduledBriefSnapshot = (
  snapshot,
  holidayDates = publicHolidayDates,
) => {
  const observedAt = new Date(snapshot?.observedAt ?? '')
  if (Number.isNaN(observedAt.getTime())) return false
  return collectionSlotFor(observedAt, holidayDates) !== null
}

export const briefingCycleSnapshots = (
  snapshots,
  date = new Date(),
  holidayDates = publicHolidayDates,
) => {
  const cycleStartedAt = new Date(
    briefingCycleStart(date, holidayDates),
  ).getTime()
  return snapshots.filter((snapshot) => {
    if (!isScheduledBriefSnapshot(snapshot, holidayDates)) return false
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
