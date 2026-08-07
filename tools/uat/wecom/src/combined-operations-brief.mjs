const MAX_MESSAGE_BYTES = 1900
const DISPLAY_DAYS = 15

const finiteNumber = (value) => {
  if (value === null || value === undefined || value === '') return null
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

const metricNumber = (metric) => finiteNumber(metric?.value)

const compact = (value, digits = 0) => {
  const number = finiteNumber(value)
  if (number === null) return '?'
  return Number.isInteger(number)
    ? number.toFixed(0)
    : number.toFixed(digits)
}

const money = (value) => {
  const number = finiteNumber(value)
  return number === null ? '?' : `¥${Math.round(number)}`
}

const signed = (value, digits = 0) => {
  const number = finiteNumber(value)
  if (number === null) return '?'
  return `${number > 0 ? '+' : ''}${compact(number, digits)}`
}

const shortDate = (value) => {
  const match = String(value ?? '').match(/^\d{4}-(\d{2})-(\d{2})/u)
  return match ? `${match[1]}-${match[2]}` : '--'
}

const localHour = (value) => {
  const match = String(value ?? '').match(
    /^\d{4}-(\d{2})-(\d{2})T(\d{2}):/u,
  )
  return match ? `${match[1]}-${match[2]} ${match[3]}:00` : '时间未知'
}

const sourceStatus = (monitor) => {
  const sources = Array.isArray(monitor?.sources) ? monitor.sources : []
  const complete = sources.filter(
    (source) => source?.completeness === 'COMPLETE',
  ).length
  if (sources.length === 0) return '数据状态未知'
  if (complete === sources.length && monitor?.completeness === 'COMPLETE') {
    return `${complete}/${sources.length}完整`
  }
  return `${complete}/${sources.length}部分`
}

const occupancy = (row) => {
  const direct = finiteNumber(row?.occupancyPercent)
  if (direct !== null) return direct
  const booked = finiteNumber(row?.bookedRoomNights)
  const roomCount = finiteNumber(row?.roomCount)
  return booked !== null && roomCount !== null && roomCount > 0
    ? (booked / roomCount) * 100
    : null
}

const dailyRows = (snapshot) => (
  Array.isArray(snapshot?.futureBookingChanges?.daily)
    ? snapshot.futureBookingChanges.daily.slice(0, DISPLAY_DAYS)
    : []
)

const futureRowLine = (row) => {
  const sold = finiteNumber(row?.bookedRoomNights)
  const available = finiteNumber(row?.availableRooms)
  return `${shortDate(row?.stayDate)}｜${compact(sold)}/${compact(available)}`
    + `｜${compact(occupancy(row))}%｜${money(row?.adr)}`
    + `｜${signed(row?.hourlyNetRoomNights)}`
    + `/${signed(row?.cumulativeNetRoomNights)}`
    + `/${signed(row?.previousDayNetRoomNights)}`
}

const dailyOrderLine = (snapshot) => {
  if (!Array.isArray(snapshot?.orders)) {
    return '当日订单｜PMS未提供订单明细'
  }
  let active = 0
  let canceled = 0
  for (const order of snapshot.orders) {
    if (order?.orderDate !== snapshot.businessDate) continue
    const roomNights = finiteNumber(order?.roomNights)
    if (roomNights === null) continue
    if (order.status === 'ACTIVE') active += roomNights
    if (order.status === 'CANCELLED') canceled += roomNights
  }
  return `当日订单｜有效${compact(active)}｜取消${compact(canceled)}`
}

const hourlyLines = (monitor) => {
  const hourly = monitor?.hourlyDelta
  if (hourly?.basis !== 'HOURLY_SNAPSHOT_DIFF' || !hourly.totals) {
    return ['✅小时进单｜同PMS一小时前基线待建立']
  }
  const totals = hourly.totals
  const added = finiteNumber(totals.newRoomNights)
  const canceled = finiteNumber(totals.canceledRoomNights)
  const net = added === null || canceled === null ? null : added - canceled
  return [
    `✅小时进单｜${localHour(hourly.intervalStartAt).slice(-5)}`
      + `→${localHour(hourly.intervalEndAt).slice(-5)}`,
    `新增${compact(added)}｜取消${compact(canceled)}`
      + `｜净增${signed(net)}｜当日入住${compact(totals.todayRoomNights)}`,
  ]
}

const todayAdvice = (monitor) => {
  const available = metricNumber(monitor?.metrics?.availableRooms)
  const rate = metricNumber(monitor?.metrics?.sellProgress)
  if (available === 0) {
    return '今日｜已满房，停止低价放量并复核超售与保留房。'
  }
  if (rate !== null && rate >= 80) {
    return '今日｜销售高位，核对热销房型余量后再决定放量。'
  }
  if (rate !== null && rate <= 40) {
    return '今日｜销售偏低，先检查渠道曝光和同房型价格。'
  }
  return '今日｜按小时净增、ADR和余房变化继续复盘。'
}

const futureAdvice = (rows) => {
  const future = rows.slice(1).filter((row) => occupancy(row) !== null)
  if (future.length === 0) return '远期｜可用房态不足，暂不生成经营动作。'
  const highest = future.reduce((best, row) => (
    occupancy(row) > occupancy(best) ? row : best
  ))
  const highestRate = occupancy(highest)
  if (highestRate >= 80) {
    return `远期｜${shortDate(highest.stayDate)}达${compact(highestRate)}%`
      + '，复核价格和余房释放。'
  }
  const accelerating = future
    .filter((row) => finiteNumber(row?.hourlyNetRoomNights) > 0)
    .sort((left, right) => (
      finiteNumber(right.hourlyNetRoomNights)
      - finiteNumber(left.hourlyNetRoomNights)
    ))[0]
  if (accelerating) {
    return `远期｜${shortDate(accelerating.stayDate)}小时净增`
      + `${signed(accelerating.hourlyNetRoomNights)}，2小时后复盘。`
  }
  const lowest = future.reduce((best, row) => (
    occupancy(row) < occupancy(best) ? row : best
  ))
  return `远期｜${shortDate(lowest.stayDate)}仅${compact(occupancy(lowest))}%`
    + '，先检查曝光并做单变量测试。'
}

const buildPayload = (lines) => {
  const content = lines.join('\n')
  if (Buffer.byteLength(content, 'utf8') > MAX_MESSAGE_BYTES) {
    throw new Error('COMBINED_OPERATIONS_MESSAGE_TOO_LARGE')
  }
  return Object.freeze({
    msgtype: 'text',
    text: Object.freeze({
      content,
      mentioned_list: Object.freeze(['@all']),
    }),
  })
}

export const createCombinedOperationsWeComPayloads = ({
  hotel,
  monitor,
  snapshot,
  messagePrefix = '',
}) => {
  const rows = dailyRows(snapshot)
  if (rows.length < DISPLAY_DAYS) {
    throw new Error('COMBINED_OPERATIONS_FUTURE_ROWS_REQUIRED')
  }
  const prefix = String(messagePrefix ?? '').trim().slice(0, 12)
  const sold = metricNumber(monitor?.metrics?.soldRooms)
  const available = metricNumber(monitor?.metrics?.availableRooms)
  const rate = metricNumber(monitor?.metrics?.sellProgress)
  const totalHourly = rows.reduce(
    (sum, row) => sum + (finiteNumber(row?.hourlyNetRoomNights) ?? 0),
    0,
  )
  const cumulativeValues = rows
    .map((row) => finiteNumber(row?.cumulativeNetRoomNights))
    .filter((value) => value !== null)
  const totalCumulative = cumulativeValues.length > 0
    ? cumulativeValues.reduce((sum, value) => sum + value, 0)
    : null
  const lines = [
    `${String(hotel?.hotelName ?? '').trim().slice(0, 40)}｜经营综合简报`
      + `${prefix ? `｜${prefix}` : ''}`,
    `⏰截止 ${localHour(snapshot?.observedAt)}`
      + `｜营业日 ${shortDate(snapshot?.businessDate)}`
      + `｜${sourceStatus(monitor)}`,
    `📌今日｜售/余 ${compact(sold)}/${compact(available)}`
      + `｜率${compact(rate)}%｜ADR${money(metricNumber(monitor?.metrics?.adr))}`,
    `房费${money(metricNumber(monitor?.metrics?.totalRevenue))}`
      + `｜RevPAR${money(metricNumber(monitor?.metrics?.revPar))}`,
    ...hourlyLines(monitor),
    dailyOrderLine(snapshot),
    `📊当日+未来14天｜时净${signed(totalHourly, 1)}`
      + `｜累净${signed(totalCumulative, 1)}`,
    '日期｜售/余｜率｜ADR｜时/累/昨',
    ...rows.map(futureRowLine),
    '🤖运营建议',
    todayAdvice(monitor),
    futureAdvice(rows),
  ]
  return [buildPayload(lines)]
}

export const combinedOperationsBriefLimits = Object.freeze({
  maxMessageBytes: MAX_MESSAGE_BYTES,
  partCount: 1,
  displayDays: DISPLAY_DAYS,
})
