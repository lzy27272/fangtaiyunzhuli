const MAX_MESSAGE_BYTES = 1900
const OCCUPANCY_THRESHOLD = 20
const OCCUPANCY_RE_ALERT_STEP = 5
const HOURLY_NET_RE_ALERT = 3

const finiteNumber = (value) => {
  if (value === null || value === undefined || value === '') return null
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

const dayDistance = (businessDate, stayDate) => {
  const start = new Date(`${businessDate}T00:00:00Z`).getTime()
  const end = new Date(`${stayDate}T00:00:00Z`).getTime()
  return Number.isFinite(start) && Number.isFinite(end)
    ? Math.round((end - start) / 86_400_000)
    : null
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
  return number === null
    ? '?'
    : `${number > 0 ? '+' : ''}${compact(number, digits)}`
}

const cutoff = (value) => {
  const match = String(value ?? '').match(
    /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})/,
  )
  return match ? `${match[1]} ${match[2]}:${match[3]}` : '时间未知'
}

const stateKey = (hotelId, stayDate) => `${hotelId}:${stayDate}`

export const reconcileFutureDemandRiskStates = ({
  hotelId,
  snapshot,
  riskStates,
}) => {
  if (!snapshot || !Array.isArray(snapshot.futureBookingChanges?.daily)) {
    return false
  }
  let changed = false
  for (const row of snapshot.futureBookingChanges.daily) {
    const distance = dayDistance(snapshot.businessDate, row.stayDate)
    if (distance === null || distance < 15 || distance > 90) continue
    const occupancy = finiteNumber(row.occupancyPercent)
    const key = stateKey(hotelId, row.stayDate)
    const current = riskStates[key]
    if (
      occupancy !== null
      && occupancy < OCCUPANCY_THRESHOLD
      && current?.active === true
    ) {
      riskStates[key] = {
        ...current,
        active: false,
        clearedAt: snapshot.observedAt,
      }
      changed = true
    }
  }
  return changed
}

export const selectFutureDemandRiskCandidates = ({
  hotelId,
  snapshot,
  riskStates = {},
}) => {
  if (
    typeof hotelId !== 'string'
    || !snapshot
    || typeof snapshot.businessDate !== 'string'
    || !Array.isArray(snapshot.futureBookingChanges?.daily)
  ) {
    return []
  }
  const candidates = []
  for (const row of snapshot.futureBookingChanges.daily) {
    const distance = dayDistance(snapshot.businessDate, row.stayDate)
    const occupancy = finiteNumber(row.occupancyPercent)
    if (
      distance === null
      || distance < 15
      || distance > 90
      || occupancy === null
      || occupancy < OCCUPANCY_THRESHOLD
    ) {
      continue
    }
    const key = stateKey(hotelId, row.stayDate)
    const state = riskStates[key]
    const hourlyNet = finiteNumber(row.hourlyNetRoomNights)
    const crossedThreshold = state?.active !== true
    const advancedFivePoints =
      state?.active === true
      && finiteNumber(state.lastAlertOccupancy) !== null
      && occupancy >= finiteNumber(state.lastAlertOccupancy)
        + OCCUPANCY_RE_ALERT_STEP
    const accelerated =
      state?.active === true
      && hourlyNet !== null
      && hourlyNet >= HOURLY_NET_RE_ALERT
      && state.lastAlertRunId !== snapshot.collectionRunId
    if (!crossedThreshold && !advancedFivePoints && !accelerated) continue
    const reasons = [
      crossedThreshold ? 'CROSS_20_PERCENT' : null,
      advancedFivePoints ? 'GAIN_5_POINTS' : null,
      accelerated ? 'HOURLY_NET_3' : null,
    ].filter(Boolean)
    candidates.push({
      stateKey: key,
      stayDate: row.stayDate,
      dayOffset: distance,
      row,
      reasons,
      messageKey:
        `${hotelId}:${row.stayDate}:P1_FUTURE_DEMAND:`
        + snapshot.collectionRunId,
    })
  }
  return candidates.sort((left, right) =>
    left.stayDate.localeCompare(right.stayDate))
}

const reasonText = (reasons) => {
  const labels = []
  if (reasons.includes('CROSS_20_PERCENT')) labels.push('远期售卖率首次达到20%')
  if (reasons.includes('GAIN_5_POINTS')) labels.push('较上次告警再增5点')
  if (reasons.includes('HOURLY_NET_3')) labels.push('本小时净增≥3间夜')
  return labels.join('；')
}

export const createFutureDemandP1WeComPayloads = (
  hotel,
  snapshot,
  candidateInput,
) => {
  const candidates = Array.isArray(candidateInput)
    ? candidateInput
    : [candidateInput]
  if (
    !hotel
    || typeof hotel.hotelName !== 'string'
    || !snapshot
    || candidates.length < 1
    || candidates.some((candidate) => !candidate?.row)
  ) {
    throw new Error('FUTURE_DEMAND_P1_INPUT_INVALID')
  }
  const riskLine = (candidate) => {
    const row = candidate.row
    const booked = finiteNumber(row.bookedRoomNights)
    const available = finiteNumber(row.availableRooms)
    const roomCount = finiteNumber(row.roomCount)
    const remaining =
      available !== null
        ? Math.max(0, available)
        : booked !== null && roomCount !== null
          ? Math.max(0, roomCount - booked)
          : null
    return `${candidate.stayDate.slice(5)}｜D+${candidate.dayOffset}`
      + `｜${compact(booked, 1)}/${compact(remaining, 1)}`
      + `｜${compact(row.occupancyPercent, 1)}%`
      + `｜时${signed(row.hourlyNetRoomNights, 1)}`
  }
  const reasons = [...new Set(
    candidates.flatMap((candidate) => candidate.reasons),
  )]
  const contentFor = (limit) => [
    '【UAT测试｜非经营指令】',
    '🚨P1远期需求异动｜@所有人',
    `${hotel.hotelName.trim().slice(0, 40)}｜触发${candidates.length}个入住日`,
    `⏰发现时间｜${cutoff(snapshot.observedAt)}`,
    `触发｜${reasonText(reasons)}`,
    '日期｜提前｜售/余｜率｜小时净变',
    ...candidates.slice(0, limit).map(riskLine),
    candidates.length > limit
      ? `另${candidates.length - limit}个日期达到条件，请在后台查看`
      : null,
    '',
    '判断｜可能存在活动、团体需求或渠道曝光上涨，须人工核查，不能仅凭本告警直接调价。',
    '建议｜立即检查活动日历、竞对价格、渠道流量和剩余库存；核实后再决定提价、限量或关闭低价产品。',
    '',
    '隐私处理｜已过滤姓名、订单号、电话、备注、操作员及内部链接',
  ].filter((line) => line !== null).join('\n')
  let content = null
  for (
    let limit = Math.min(20, candidates.length);
    limit >= 1;
    limit -= 1
  ) {
    const candidateContent = contentFor(limit)
    if (Buffer.byteLength(candidateContent, 'utf8') <= MAX_MESSAGE_BYTES) {
      content = candidateContent
      break
    }
  }
  if (!content) {
    throw new Error('FUTURE_DEMAND_P1_MESSAGE_TOO_LARGE')
  }
  return [{
    msgtype: 'text',
    text: {
      content,
      mentioned_list: ['@all'],
    },
  }]
}

export const futureDemandRiskStateAfterDelivery = (
  candidate,
  snapshot,
) => ({
  active: true,
  stayDate: candidate.stayDate,
  lastAlertOccupancy: finiteNumber(candidate.row.occupancyPercent),
  lastAlertAt: snapshot.observedAt,
  lastAlertRunId: snapshot.collectionRunId,
  lastReasons: candidate.reasons,
  clearedAt: null,
})

export const futureDemandRiskLimits = Object.freeze({
  monitoredStartDay: 15,
  monitoredEndDay: 90,
  occupancyThresholdPercent: OCCUPANCY_THRESHOLD,
  occupancyReAlertStepPercent: OCCUPANCY_RE_ALERT_STEP,
  hourlyNetReAlertRoomNights: HOURLY_NET_RE_ALERT,
  maxMessageBytes: MAX_MESSAGE_BYTES,
})
