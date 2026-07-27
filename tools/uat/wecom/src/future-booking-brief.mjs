const MAX_MESSAGE_BYTES = 1900
const DISPLAY_DAYS = 14

const finiteNumber = (value) => {
  if (value === null || value === undefined || value === '') return null
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

const addDays = (dateText, days) => {
  const date = new Date(`${dateText}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

const shortDate = (value) => {
  const match = String(value ?? '').match(/^\d{4}-(\d{2})-(\d{2})/)
  return match ? `${match[1]}-${match[2]}` : '--'
}

const localTime = (value, includeDate = false) => {
  const match = String(value ?? '').match(
    /^\d{4}-(\d{2})-(\d{2})T(\d{2}):(\d{2})/,
  )
  if (!match) return '待建立'
  return includeDate
    ? `${match[1]}-${match[2]} ${match[3]}:${match[4]}`
    : `${match[3]}:${match[4]}`
}

const cutoffHour = (value) => {
  const match = String(value ?? '').match(
    /^\d{4}-(\d{2})-(\d{2})T(\d{2}):/,
  )
  return match ? `${match[1]}-${match[2]} ${match[3]}:00` : '时间未知'
}

const compact = (value, digits = 0) => {
  const number = finiteNumber(value)
  if (number === null) return '?'
  return Number.isInteger(number)
    ? number.toFixed(0)
    : number.toFixed(digits)
}

const signed = (value, digits = 0) => {
  const number = finiteNumber(value)
  if (number === null) return '?'
  return `${number > 0 ? '+' : ''}${compact(number, digits)}`
}

const money = (value) => {
  const number = finiteNumber(value)
  return number === null ? '?' : `¥${Math.round(number)}`
}

const rowForDate = (changes, stayDate) =>
  (changes?.daily ?? []).find((row) => row?.stayDate === stayDate) ?? {
    stayDate,
  }

const lineFor = (row, compactMode = false) => {
  const booked = finiteNumber(row.bookedRoomNights)
  const roomCount = finiteNumber(row.roomCount)
  const available = finiteNumber(row.availableRooms)
  const remaining =
    available !== null
      ? Math.max(0, available)
      : booked !== null && roomCount !== null
        ? Math.max(0, roomCount - booked)
        : null
  const rate = finiteNumber(row.occupancyPercent)
  const hourly = finiteNumber(row.hourlyNetRoomNights)
  const yesterday = finiteNumber(row.previousDayNetRoomNights)
  const inferredAdr = finiteNumber(row.inferredHourlyAdr)
  const hourlyAdr =
    hourly !== null && hourly !== 0
      ? `${signed(hourly)}${inferredAdr === null ? '' : `@${money(inferredAdr)}*`}`
      : hourly === 0
        ? '0'
        : '?'
  if (compactMode) {
    return `${shortDate(row.stayDate)}｜${compact(booked, 1)}/${compact(remaining, 1)}`
      + `｜${compact(rate, 0)}%｜${money(row.adr)}`
      + `｜${hourlyAdr}/${signed(yesterday)}`
  }
  return `${shortDate(row.stayDate)}｜${compact(booked, 1)}/${compact(remaining, 1)}`
    + `｜${compact(rate, 0)}%｜${money(row.adr)}`
    + `｜${hourlyAdr}｜${signed(yesterday)}`
}

const adviceFor = (rows) => {
  const accelerating = rows
    .filter((row) => finiteNumber(row.hourlyNetRoomNights) >= 3)
    .sort(
      (left, right) =>
        finiteNumber(right.hourlyNetRoomNights)
        - finiteNumber(left.hourlyNetRoomNights),
    )
  const highOccupancy = rows
    .filter((row) => finiteNumber(row.occupancyPercent) >= 70)
    .sort(
      (left, right) =>
        finiteNumber(right.occupancyPercent)
        - finiteNumber(left.occupancyPercent),
    )
  if (accelerating.length > 0) {
    return `${shortDate(accelerating[0].stayDate)}小时净增`
      + `${signed(accelerating[0].hourlyNetRoomNights)}间夜，建议人工核查`
      + '流量来源、竞对价格和剩余库存，再决定是否提价或收紧低价房。'
  }
  if (highOccupancy.length > 0) {
    return `${shortDate(highOccupancy[0].stayDate)}售卖率`
      + `${compact(highOccupancy[0].occupancyPercent)}%，建议检查竞对价格与`
      + '剩余库存，保护高需求日期收益。'
  }
  return '未来14天暂未发现明显加速，保持价格与库存观察；出现集中进单时再人工核查竞对和活动。'
}

const payload = (lines) => {
  const content = lines
    .map((line) => String(line).trimEnd())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
  const bytes = Buffer.byteLength(content, 'utf8')
  if (bytes > MAX_MESSAGE_BYTES) {
    const error = new Error('FUTURE_BOOKING_MESSAGE_TOO_LARGE')
    error.actualBytes = bytes
    error.maxBytes = MAX_MESSAGE_BYTES
    throw error
  }
  return {
    msgtype: 'text',
    text: {
      content,
      mentioned_list: ['@all'],
    },
  }
}

export const createFutureBookingWeComPayloads = (
  hotel,
  snapshot,
  options = {},
) => {
  if (
    !hotel
    || typeof hotel.hotelName !== 'string'
    || !snapshot
    || typeof snapshot.businessDate !== 'string'
  ) {
    throw new Error('FUTURE_BOOKING_INPUT_INVALID')
  }
  const changes = snapshot.futureBookingChanges ?? {
    daily: snapshot.futureDaily ?? [],
  }
  const rows = Array.from(
    { length: DISPLAY_DAYS },
    (_, index) =>
      rowForDate(changes, addDays(snapshot.businessDate, index + 1)),
  )
  const monitoredP1Count = (changes.daily ?? []).filter((row) => {
    const day = Math.round(
      (
        new Date(`${row.stayDate}T00:00:00Z`).getTime()
        - new Date(`${snapshot.businessDate}T00:00:00Z`).getTime()
      ) / 86_400_000,
    )
    return day >= 15
      && day <= 90
      && finiteNumber(row.occupancyPercent) >= 20
  }).length
  const totalHourlyNet = rows.reduce(
    (sum, row) => sum + (finiteNumber(row.hourlyNetRoomNights) ?? 0),
    0,
  )
  const prefix =
    typeof options.messagePrefix === 'string' && options.messagePrefix.trim()
      ? `｜${options.messagePrefix.trim().slice(0, 12)}`
      : ''
  const baselines = snapshot.futureBookingChanges ?? {}
  const linesFor = (compactMode = false) => [
    '【UAT测试｜非经营指令】',
    `${hotel.hotelName.trim().slice(0, 40)}｜远期房态${prefix}`,
    `⏰截止 ${cutoffHour(snapshot.observedAt)}`
      + `｜上时${localTime(baselines.hourlyBaselineAt)}`
      + `｜昨末${localTime(baselines.previousDayEndAt, true)}`,
    `📊未来14天｜小时净${signed(totalHourlyNet, 1)}`
      + `｜15-90天P1日期${monitoredP1Count}`,
    '日期｜售/余｜率｜ADR｜时｜昨',
    ...rows.map((row) => lineFor(row, compactMode)),
    '*小时成交均价按相邻快照房费差额推算，仅作观察',
    '',
    '🤖AI建议',
    adviceFor(rows),
    '',
    '用途｜仅验证企微通道，不得据此调价、调整库存或执行经营动作',
    '隐私处理｜已过滤姓名、订单号、电话、备注、操作员及内部链接',
  ]
  try {
    return [payload(linesFor(false))]
  } catch (error) {
    if (error?.message !== 'FUTURE_BOOKING_MESSAGE_TOO_LARGE') throw error
    return [payload(linesFor(true))]
  }
}

export const futureBookingBriefLimits = Object.freeze({
  maxMessageBytes: MAX_MESSAGE_BYTES,
  displayDays: DISPLAY_DAYS,
  partCount: 1,
})
