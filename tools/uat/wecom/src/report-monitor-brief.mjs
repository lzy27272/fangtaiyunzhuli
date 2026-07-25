const MAX_MESSAGE_BYTES = 1900
const PART_COUNT = 1
const CHANNEL_ORDER = ['MEITUAN', 'FEIZHU', 'DOUYIN', 'OTHER']

const finiteNumber = (value) => {
  if (
    value === null
    || value === undefined
    || (typeof value === 'string' && value.trim() === '')
  ) {
    return null
  }
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

const metricNumber = (metric) => finiteNumber(metric?.value)

const numberText = (value, digits = 0) => {
  const number = finiteNumber(value)
  return number === null ? '?' : number.toFixed(digits)
}

const compactNumber = (value, digits = 1) => {
  const number = finiteNumber(value)
  if (number === null) return '?'
  return Number.isInteger(number)
    ? number.toFixed(0)
    : number.toFixed(digits)
}

const currency = (value) => {
  const number = finiteNumber(value)
  if (number === null) return '无法判断'
  return `¥${number.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`
}

const metricCurrency = (metric) => currency(metricNumber(metric))

const metricQuantity = (metric, unit, digits = 1) => {
  const number = metricNumber(metric)
  return number === null ? `?${unit}` : `${compactNumber(number, digits)}${unit}`
}

const percent = (value, digits = 2) => {
  const number = finiteNumber(value)
  return number === null ? '待配置' : `${number.toFixed(digits)}%`
}

const dateParts = (value) => {
  if (typeof value !== 'string') return null
  const match = value.match(
    /^(\d{4})-(\d{2})-(\d{2})(?:T|\s)(\d{2}):(\d{2})/,
  )
  if (!match) return null
  return {
    year: match[1],
    month: match[2],
    day: match[3],
    hour: match[4],
    minute: match[5],
  }
}

const shortDate = (value) => {
  if (typeof value !== 'string') return '未知'
  const match = value.match(/^\d{4}-(\d{2})-(\d{2})/)
  return match ? `${match[1]}-${match[2]}` : value.slice(0, 10)
}

const cutoffHour = (value) => {
  const parts = dateParts(value)
  return parts
    ? `${parts.month}-${parts.day} ${parts.hour}:00`
    : '时间未知'
}

const localTime = (value) => {
  const parts = dateParts(value)
  return parts ? `${parts.hour}:${parts.minute}` : '--:--'
}

const localHour = (value) => {
  const parts = dateParts(value)
  return parts ? `${parts.hour}:00` : '--:--'
}

const delta = (value, digits = 2) => {
  const number = finiteNumber(value)
  if (number === null) return ''
  if (number > 0) return `↑${number.toFixed(digits)}`
  if (number < 0) return `↓${Math.abs(number).toFixed(digits)}`
  return `→${number.toFixed(digits)}`
}

const normalizeRoomName = (value) => {
  const name = String(value ?? '').trim()
  return name || '未知房型'
}

const listWithinByteBudget = (
  rawValues,
  maxBytes,
  emptyText = '暂无',
) => {
  const values = [...new Set(
    rawValues.map(normalizeRoomName).filter(Boolean),
  )]
  if (values.length === 0) return emptyText
  const full = values.join('、')
  if (Buffer.byteLength(full, 'utf8') <= maxBytes) return full
  const suffix = `等${values.length}型`
  const kept = []
  for (const value of values) {
    const candidate = [...kept, value].join('、') + `、${suffix}`
    if (Buffer.byteLength(candidate, 'utf8') > maxBytes) break
    kept.push(value)
  }
  return kept.length > 0 ? `${kept.join('、')}、${suffix}` : `共${values.length}型`
}

const soldOutRooms = (monitor) =>
  (monitor.inventory ?? [])
    .filter((room) => {
      const available = finiteNumber(room.primaryAvailableRooms)
      return available !== null && available <= 0
    })
    .map((room) => normalizeRoomName(room.displayName))

const hotInventory = (monitor) =>
  (monitor.hotSellingAlerts ?? []).map((alert) => {
    const available = finiteNumber(alert.availableRooms)
    return `${normalizeRoomName(alert.displayName)}${
      available === null ? '?' : compactNumber(available)
    }`
  })

const sourceStatus = (monitor) => {
  const sources = Array.isArray(monitor.sources) ? monitor.sources : []
  const complete = sources.filter(
    (source) => source?.completeness === 'COMPLETE',
  ).length
  const total = sources.length
  if (total === 0) return '0/0不可用'
  if (complete === total && monitor.completeness === 'COMPLETE') {
    return `${complete}/${total}完整`
  }
  if (complete > 0) return `${complete}/${total}部分`
  return `0/${total}不可用`
}

const emptyOrderBucket = () => ({
  active: 0,
  today: 0,
  future: 0,
  canceled: 0,
})

const reportChannel = (channel) => {
  if (channel === 'MEITUAN') return 'MEITUAN'
  if (channel === 'FEIZHU') return 'FEIZHU'
  if (channel === 'DOUYIN') return 'DOUYIN'
  return 'OTHER'
}

const aggregateDailyOrders = (snapshot) => {
  const result = Object.fromEntries(
    CHANNEL_ORDER.map((channel) => [channel, emptyOrderBucket()]),
  )
  for (const order of snapshot?.orders ?? []) {
    if (order?.orderDate !== snapshot.businessDate) continue
    const roomNights = finiteNumber(order.roomNights)
    if (roomNights === null) continue
    const bucket = result[reportChannel(order.channel)]
    if (order.status === 'CANCELLED') {
      bucket.canceled += roomNights
      continue
    }
    if (order.status !== 'ACTIVE') continue
    bucket.active += roomNights
    if (order.arrivalClass === 'TODAY') bucket.today += roomNights
    if (order.arrivalClass === 'FUTURE') bucket.future += roomNights
  }
  return result
}

const orderTuple = (summary, field) =>
  CHANNEL_ORDER
    .map((channel) => numberText(summary[channel][field]))
    .join('/')

const orderTotal = (summary, field) =>
  CHANNEL_ORDER.reduce(
    (total, channel) => total + summary[channel][field],
    0,
  )

const dailyOrderLines = (snapshot) => {
  if (!snapshot || !Array.isArray(snapshot.orders)) {
    return ['订单数据｜不可用']
  }
  const summary = aggregateDailyOrders(snapshot)
  return [
    `今日有效｜${numberText(orderTotal(summary, 'active'))}`
      + `（${orderTuple(summary, 'active')}）`,
    `当日入住｜${numberText(orderTotal(summary, 'today'))}`
      + `（${orderTuple(summary, 'today')}）`,
    `远期入住｜${numberText(orderTotal(summary, 'future'))}`
      + `（${orderTuple(summary, 'future')}）`,
    `当前取消｜${numberText(orderTotal(summary, 'canceled'))}`
      + `（${orderTuple(summary, 'canceled')}）`,
  ]
}

const aggregateHourlyChannels = (hourlyDelta) => {
  const result = Object.fromEntries(
    CHANNEL_ORDER.map((channel) => [channel, {
      newRoomNights: 0,
      todayRoomNights: 0,
      futureRoomNights: 0,
      canceledRoomNights: 0,
    }]),
  )
  for (const [channel, source] of Object.entries(
    hourlyDelta?.byChannel ?? {},
  )) {
    const bucket = result[reportChannel(channel)]
    for (const field of Object.keys(bucket)) {
      bucket[field] += finiteNumber(source?.[field]) ?? 0
    }
  }
  return result
}

const hourlyTuple = (summary, field) =>
  CHANNEL_ORDER
    .map((channel) => numberText(summary[channel][field]))
    .join('/')

const hourlyOrderLines = (hourlyDelta) => {
  if (
    hourlyDelta?.basis !== 'HOURLY_SNAPSHOT_DIFF'
    || !hourlyDelta.totals
  ) {
    return ['✅小时进单｜基线待建立']
  }
  const totals = hourlyDelta.totals
  const summary = aggregateHourlyChannels(hourlyDelta)
  return [
    `✅小时进单｜${localHour(hourlyDelta.intervalStartAt)}→`
      + `${localHour(hourlyDelta.intervalEndAt)}`,
    '渠道顺序｜美团/飞猪/抖音/其他',
    `新增｜${numberText(totals.newRoomNights)}`
      + `（${hourlyTuple(summary, 'newRoomNights')}）`
      + `｜当日｜${numberText(totals.todayRoomNights)}`
      + `（${hourlyTuple(summary, 'todayRoomNights')}）`,
    `远期｜${numberText(totals.futureRoomNights)}`
      + `（${hourlyTuple(summary, 'futureRoomNights')}）`
      + `｜取消｜${numberText(totals.canceledRoomNights)}`
      + `（${hourlyTuple(summary, 'canceledRoomNights')}）`,
  ]
}

const p1Text = (monitor) => {
  const mismatches = []
  let comparedProducts = 0
  for (const room of monitor.inventory ?? []) {
    const primary = finiteNumber(room.primaryAvailableRooms)
    if (primary === null) continue
    for (const available of Object.values(room.otaAvailableRooms ?? {})) {
      const otaAvailable = finiteNumber(available)
      if (otaAvailable === null) continue
      comparedProducts += 1
      if (otaAvailable < primary) {
        mismatches.push(normalizeRoomName(room.displayName))
        break
      }
    }
  }
  if (mismatches.length > 0) {
    return `P1｜房态不匹配：${
      listWithinByteBudget(mismatches, 180)
    }`
  }
  if (comparedProducts > 0) return 'P1｜未发现房态不匹配'
  return 'P1｜暂无法判断（未接入OTA售卖产品库存）'
}

const normalizedContent = (lines) =>
  lines
    .map((line) => String(line).trimEnd())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')

const buildPayload = (lines) => {
  const content = normalizedContent(lines)
  const bytes = Buffer.byteLength(content, 'utf8')
  if (bytes > MAX_MESSAGE_BYTES) {
    const error = new Error('REPORT_MONITOR_MESSAGE_TOO_LARGE')
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

const comparisonSuffix = (metricDelta, field, digits = 2) => {
  if (!metricDelta) return ''
  const text = delta(metricDelta[field], digits)
  return text ? `（${text}）` : ''
}

const targetValues = (monitor, options) => {
  const targetRevenue = finiteNumber(options.target?.roomRevenueTarget)
  const targetAdr = finiteNumber(options.target?.targetAdr)
  const revenue = metricNumber(monitor.metrics?.totalRevenue)
  const available = metricNumber(monitor.metrics?.availableRooms)
  const targetProgress = metricNumber(monitor.metrics?.targetProgress)
  const gap =
    targetRevenue === null || revenue === null
      ? null
      : Math.max(0, targetRevenue - revenue)
  const remainingAverage =
    available === 0
      ? '不适用'
      : gap === null || available === null || available < 0
        ? '待配置'
        : currency(gap / available)
  return {
    targetRevenue,
    targetAdr,
    targetProgress,
    gap,
    remainingAverage,
  }
}

const aiAdvice = (monitor, p1Risk) => {
  const available = metricNumber(monitor.metrics?.availableRooms)
  if (p1Risk.startsWith('P1｜房态不匹配')) {
    return '立即核对OTA房态并停止继续放量；修复后复查各售卖产品库存。'
  }
  if (available !== null && available <= 0) {
    return '当前满房，停止低价放量并检查超售。相似日期提高热销房型价格或延后放量；目标配置后补齐差额、进度判断与调价建议。'
  }
  return '保持主力房价格并关注剩余库存；热销房型仅小量测试放房。目标配置后补齐差额、进度判断与调价建议。'
}

export const createReportMonitorWeComPayloads = (
  monitor,
  options = {},
) => {
  if (
    !monitor
    || typeof monitor !== 'object'
    || typeof monitor.hotelName !== 'string'
    || monitor.hotelName.trim().length < 1
  ) {
    throw new Error('REPORT_MONITOR_INVALID')
  }

  const snapshot = options.snapshot ?? null
  const hourly = monitor.hourlyDelta
  const metricDelta = hourly?.metricDelta
  const totalRooms = finiteNumber(snapshot?.overview?.roomCount)
  const availableRooms = metricNumber(monitor.metrics?.availableRooms)
  const sellProgress = metricNumber(monitor.metrics?.sellProgress)
  const soldOut = soldOutRooms(monitor)
  const hotRooms = hotInventory(monitor)
  const targets = targetValues(monitor, options)
  const paceProgress = finiteNumber(options.paceProgressPercent)
  const roomNightDelta = finiteNumber(metricDelta?.roomNights)
  const netSellPoints =
    totalRooms && roomNightDelta !== null
      ? roomNightDelta / totalRooms * 100
      : null
  const p1Risk = p1Text(monitor)
  const collectionAt = snapshot?.observedAt ?? monitor.cutoffAt
  const rawMessagePrefix =
    typeof options.messagePrefix === 'string'
    && options.messagePrefix.trim()
      ? options.messagePrefix.trim().slice(0, 16)
      : null
  const messagePrefix =
    rawMessagePrefix && rawMessagePrefix !== '手动通道测试'
      ? `｜${rawMessagePrefix}`
      : ''
  const targetProgressText = percent(targets.targetProgress)
  const paceText = paceProgress === null
    ? '旺季待配置'
    : `旺季${percent(paceProgress, 1)}`
  const targetJudgment = targets.targetProgress === null
    ? '目标待配置'
    : `目标${targetProgressText}`
  const combination = targets.targetProgress === null
    ? `${availableRooms === 0 ? '库存售罄' : '库存仍可售'}×目标待配置`
    : availableRooms === 0
      ? '库存售罄×目标已配置'
      : '库存仍可售×目标已配置'
  const priceText = targets.targetAdr === null
    ? `ADR ${metricCurrency(monitor.metrics?.adr)}，目标对比待配置`
    : `ADR ${metricCurrency(monitor.metrics?.adr)}，目标${currency(targets.targetAdr)}`
  const hourlyTotals = hourly?.basis === 'HOURLY_SNAPSHOT_DIFF'
    ? hourly.totals
    : null
  const speedText = hourlyTotals
    ? `净售卖${netSellPoints === null ? '?' : `${netSellPoints >= 0 ? '+' : ''}${netSellPoints.toFixed(1)}`}点`
      + `｜新增${numberText(hourlyTotals.newRoomNights)}`
      + `｜取消${numberText(hourlyTotals.canceledRoomNights)}`
    : '基线待建立'
  const inventoryText =
    monitor.inventory?.length > 0
      ? soldOut.length === monitor.inventory.length
        ? `${soldOut.length}个实体房型售罄`
        : `售罄${soldOut.length}/${monitor.inventory.length}个实体房型`
      : '库存数据不可用'

  const linesFor = (soldOutBudget, hotRoomBudget) => [
    '【UAT测试｜非经营指令】',
    `${monitor.hotelName.trim().slice(0, 40)}｜今日收益分析${messagePrefix}`,
    `⏰截止 ${cutoffHour(monitor.cutoffAt)}`
      + `｜营业日 ${shortDate(monitor.businessDate)}`
      + `｜采集 ${localTime(collectionAt)}（${sourceStatus(monitor)}）`,
    '',
    '📌今日压力',
    `可售｜${metricQuantity(monitor.metrics?.availableRooms, '间', 0)}`
      + `${availableRooms === 0 ? '（满房）' : ''}`
      + `｜差额目标｜${targets.gap === null ? '待配置' : currency(targets.gap)}`
      + `｜剩余均价｜${targets.remainingAverage}`,
    `售罄｜${listWithinByteBudget(soldOut, soldOutBudget, '暂无')}`,
    '',
    '🎯今日进度',
    `目标任务｜${targets.targetRevenue === null ? '待配置' : currency(targets.targetRevenue)}`
      + `｜目标均价｜${targets.targetAdr === null ? '待配置' : currency(targets.targetAdr)}`,
    `完成指标｜${targetProgressText}`
      + `｜售卖进度｜${percent(sellProgress)}`,
    '',
    `🔄经营对比｜${
      hourly?.basis === 'HOURLY_SNAPSHOT_DIFF'
        ? `${localHour(hourly.intervalStartAt)}→${localHour(hourly.intervalEndAt)}`
        : '基线待建立'
    }`,
    `房费｜${metricCurrency(monitor.metrics?.totalRevenue)}`
      + `${comparisonSuffix(metricDelta, 'roomFee')}`
      + `｜ADR｜${metricCurrency(monitor.metrics?.adr)}`
      + `${comparisonSuffix(metricDelta, 'adr')}`,
    `RevPAR｜${metricCurrency(monitor.metrics?.revPar)}`
      + `${comparisonSuffix(metricDelta, 'revPar')}`
      + `｜已售｜${metricQuantity(monitor.metrics?.soldRooms, '间夜')}`
      + `${comparisonSuffix(metricDelta, 'roomNights', 1)}`,
    `实体｜${totalRooms === null ? '?' : compactNumber(totalRooms)}间`
      + `｜可售｜${metricQuantity(monitor.metrics?.availableRooms, '间', 0)}`,
    '',
    '📝收益判断',
    `${paceText}/${targetJudgment}｜组合｜${combination}`,
    `价格｜${priceText}`,
    `时速｜${speedText}`,
    `库存｜${inventoryText}`,
    `热销库存｜${listWithinByteBudget(hotRooms, hotRoomBudget, '暂无配置')}`,
    p1Risk,
    '',
    `【订单汇报｜统计日${shortDate(monitor.businessDate)}】`,
    '渠道顺序｜美团/飞猪/抖音/其他',
    ...dailyOrderLines(snapshot),
    '',
    ...hourlyOrderLines(hourly),
    '',
    '🤖AI建议',
    aiAdvice(monitor, p1Risk),
    '',
    '用途｜仅验证企微通道，不得据此调价、调整库存或执行经营动作',
    '隐私处理｜已过滤姓名、订单号、电话、备注、操作员及内部链接',
  ]

  for (const [soldOutBudget, hotRoomBudget] of [
    [420, 300],
    [260, 170],
    [160, 90],
  ]) {
    try {
      return [buildPayload(linesFor(soldOutBudget, hotRoomBudget))]
    } catch (error) {
      if (error?.message !== 'REPORT_MONITOR_MESSAGE_TOO_LARGE') throw error
    }
  }
  return [buildPayload(linesFor(80, 60))]
}

export const reportMonitorBriefLimits = Object.freeze({
  maxMessageBytes: MAX_MESSAGE_BYTES,
  partCount: PART_COUNT,
})
