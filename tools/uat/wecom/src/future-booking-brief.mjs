import {
  generateFutureBookingAiActionLines,
} from './future-booking-ai-advice.mjs'

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

const rowsForSnapshot = (snapshot) => {
  const changes = snapshot.futureBookingChanges ?? {
    daily: snapshot.futureDaily ?? [],
  }
  return Array.from(
    { length: DISPLAY_DAYS },
    (_, index) =>
      rowForDate(changes, addDays(snapshot.businessDate, index + 1)),
  )
}

const remainingRooms = (row) => {
  const available = finiteNumber(row.availableRooms)
  const booked = finiteNumber(row.bookedRoomNights)
  const roomCount = finiteNumber(row.roomCount)
  if (available !== null) return Math.max(0, available)
  if (booked !== null && roomCount !== null) {
    return Math.max(0, roomCount - booked)
  }
  return null
}

const lineFor = (row, compactMode = false) => {
  const booked = finiteNumber(row.bookedRoomNights)
  const remaining = remainingRooms(row)
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
  const strongest = [...rows]
    .filter((row) => finiteNumber(row.occupancyPercent) !== null)
    .sort(
      (left, right) =>
        finiteNumber(right.occupancyPercent)
        - finiteNumber(left.occupancyPercent),
    )[0]
  if (accelerating.length > 0) {
    const focus = accelerating[0]
    return [
      `结论｜${shortDate(focus.stayDate)}小时净增`
        + `${signed(focus.hourlyNetRoomNights)}间夜`
        + `，售卖率${compact(focus.occupancyPercent)}%`
        + `，余${compact(remainingRooms(focus))}间，需求加速。`,
      '先做｜店长/收益30分钟内核对进单渠道、同房型竞对可售价、'
        + '退改条件、活动叠加和房态一致性。',
      '策略｜若竞对仍有房且本店产品条件不弱，人工评估提价3%-5%'
        + '并限量低价房；否则稳价，避免同时改多个变量。',
      '复盘｜2小时后看净增间夜、ADR和余房；净增≥2且售卖率继续升'
        + '再评估下一档，零新增则取消提价试验。',
    ]
  }
  if (highOccupancy.length > 0) {
    const focus = highOccupancy[0]
    const remaining = remainingRooms(focus)
    if (
      finiteNumber(focus.occupancyPercent) >= 90
      || (remaining !== null && remaining <= 2)
    ) {
      return [
        `结论｜${shortDate(focus.stayDate)}售卖率`
          + `${compact(focus.occupancyPercent)}%`
          + `，余${compact(remaining)}间，进入尾房收益保护。`,
        '先做｜店长/收益立即核对超售风险、保留房和各渠道房态，'
          + '同步比较竞对同房型可售价及退改条件。',
        '策略｜房态一致且竞对仍有房时，人工评估关闭低价产品并分档提价；'
          + '保留必要直销/会员库存，不一次性关完所有渠道。',
        '复盘｜每小时检查取消量、ADR和余房；出现取消回补或零新增时，'
          + '先恢复一档可售产品再观察。',
      ]
    }
    return [
      `结论｜${shortDate(focus.stayDate)}售卖率`
        + `${compact(focus.occupancyPercent)}%`
        + `，余${compact(remaining)}间，高需求但当前未触发加速。`,
      '先做｜店长/收益30分钟内核对竞对同房型可售价、退改条件、'
        + '活动叠加、渠道占比与可售房态。',
      '策略｜若2小时出现新增且竞对价格不弱，人工评估提价3%-5%'
        + '并减少低价配额；无新增则稳价，不提前封死渠道。',
      '复盘｜2小时后以净增间夜、ADR、余房为准；售卖率≥80%'
        + '再收紧一档，动销停滞则恢复引流。',
    ]
  }
  return [
    `结论｜未来14天未见明显加速`
      + `${strongest ? `，最高售卖率${compact(strongest.occupancyPercent)}%` : ''}`
      + '，暂不支持直接提价或加大促销。',
    '先做｜店长/收益检查页面可售、价格倒挂、活动生效、房型映射'
      + '和竞对同房型可售价，先排除配置问题。',
    '策略｜对低售卖日期只做一个小流量变量测试（价格、套餐或曝光三选一），'
      + '避免多项同时调整后无法判断效果。',
    '复盘｜2小时后比较净增间夜、ADR与取消量；有新增再保留测试，'
      + '无新增则撤回并记录原因。',
  ]
}

const adviceLinesFor = (rows, override) => {
  if (override === undefined || override === null) {
    return adviceFor(rows)
  }
  const prefixes = ['结论｜', '先做｜', '策略｜', '复盘｜']
  if (
    !Array.isArray(override)
    || override.length !== prefixes.length
    || override.some(
      (line, index) =>
        typeof line !== 'string'
        || !line.startsWith(prefixes[index])
        || /[\r\n\u0000-\u001f\u007f]/.test(line),
    )
  ) {
    throw new Error('FUTURE_BOOKING_ADVICE_INVALID')
  }
  return [...override]
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
      mentioned_list: [],
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
  const rows = rowsForSnapshot(snapshot)
  const adviceLines = adviceLinesFor(rows, options.adviceLines)
  const adviceHeading =
    options.adviceMode === 'MODEL'
      ? '🤖AI建议（模型增强）'
      : options.adviceMode === 'RULE_FALLBACK'
        ? '🤖AI建议（规则回退）'
        : '🤖AI建议'
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
    adviceHeading,
    ...adviceLines,
  ]
  try {
    return [payload(linesFor(false))]
  } catch (error) {
    if (error?.message !== 'FUTURE_BOOKING_MESSAGE_TOO_LARGE') throw error
    return [payload(linesFor(true))]
  }
}

export const createFutureBookingWeComPayloadsWithAi = async (
  hotel,
  snapshot,
  options = {},
) => {
  const config = options.aiConfig
  if (config?.enabled !== true) {
    return createFutureBookingWeComPayloads(hotel, snapshot, options)
  }
  if (config.ready !== true) {
    options.onAiFallback?.(
      config.reasonCode ?? 'AI_CONFIGURATION_NOT_READY',
    )
    return createFutureBookingWeComPayloads(
      hotel,
      snapshot,
      {
        ...options,
        adviceMode: 'RULE_FALLBACK',
      },
    )
  }
  const rows = rowsForSnapshot(snapshot)
  const ruleAdviceLines = adviceFor(rows)
  try {
    const actionLines = await generateFutureBookingAiActionLines({
      config,
      businessDate: snapshot.businessDate,
      rows,
      ruleAdviceLines,
      fetchImpl: options.fetchImpl,
      lookupImpl: options.lookupImpl,
    })
    const payloads = createFutureBookingWeComPayloads(
      hotel,
      snapshot,
      {
        ...options,
        adviceMode: 'MODEL',
        adviceLines: [
          ruleAdviceLines[0],
          ...actionLines,
        ],
      },
    )
    options.onAiApplied?.()
    return payloads
  } catch (error) {
    options.onAiFallback?.(
      error?.reasonCode
      ?? error?.message
      ?? 'AI_ADVICE_FALLBACK',
    )
    return createFutureBookingWeComPayloads(
      hotel,
      snapshot,
      {
        ...options,
        adviceMode: 'RULE_FALLBACK',
      },
    )
  }
}

export const futureBookingBriefLimits = Object.freeze({
  maxMessageBytes: MAX_MESSAGE_BYTES,
  displayDays: DISPLAY_DAYS,
  partCount: 1,
})
