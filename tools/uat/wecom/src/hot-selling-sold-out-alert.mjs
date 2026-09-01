const MAX_MESSAGE_BYTES = 1900

const PLATFORM_LABELS = Object.freeze({
  CTRIP: '携程',
  MEITUAN: '美团',
  FLIGGY: '飞猪',
  DOUYIN: '抖音',
  QUNAR: '去哪儿',
  TONGCHENG: '同程',
  OTHER: '其他渠道',
})

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

const dateParts = (value) => {
  if (typeof value !== 'string') return null
  const match = value.match(
    /^(\d{4})-(\d{2})-(\d{2})(?:T|\s)(\d{2}):(\d{2})/,
  )
  if (!match) return null
  return {
    month: match[2],
    day: match[3],
    hour: match[4],
  }
}

const cutoffHour = (value) => {
  const parts = dateParts(value)
  return parts ? `${parts.month}-${parts.day} ${parts.hour}:00` : '时间未知'
}

const shortDate = (value) => {
  if (typeof value !== 'string') return '未知'
  const match = value.match(/^\d{4}-(\d{2})-(\d{2})/)
  return match ? `${match[1]}-${match[2]}` : value.slice(0, 10)
}

const listWithinByteBudget = (values, maxBytes) => {
  const full = values.join('、')
  if (Buffer.byteLength(full, 'utf8') <= maxBytes) return full
  const suffix = `等${values.length}型`
  const kept = []
  for (const value of values) {
    const candidate = [...kept, value].join('、') + `、${suffix}`
    if (Buffer.byteLength(candidate, 'utf8') > maxBytes) break
    kept.push(value)
  }
  return kept.length > 0
    ? `${kept.join('、')}、${suffix}`
    : `共${values.length}型`
}

const buildPayload = (lines) => {
  const content = lines.join('\n')
  if (Buffer.byteLength(content, 'utf8') > MAX_MESSAGE_BYTES) {
    throw new Error('HOT_SELLING_SOLD_OUT_MESSAGE_TOO_LARGE')
  }
  return {
    msgtype: 'text',
    text: {
      content,
      mentioned_list: ['@all'],
    },
  }
}

export const selectHotSellingSoldOutAlerts = (monitor) => {
  const selected = new Map()
  for (const alert of monitor?.hotSellingAlerts ?? []) {
    const availableRooms = finiteNumber(alert?.availableRooms)
    const displayName = String(alert?.displayName ?? '').trim()
    if (
      alert?.state !== 'SOLD_OUT'
      || availableRooms === null
      || availableRooms > 0
      || !displayName
    ) {
      continue
    }
    const key = String(alert?.physicalRoomTypeCode ?? displayName).trim()
    if (!selected.has(key)) selected.set(key, { ...alert, displayName })
  }
  return [...selected.values()]
}

export const createHotSellingSoldOutWeComPayloads = (
  monitor,
  options = {},
) => {
  if (
    !monitor
    || typeof monitor.hotelName !== 'string'
    || !monitor.hotelName.trim()
    || typeof monitor.businessDate !== 'string'
  ) {
    throw new Error('HOT_SELLING_SOLD_OUT_MONITOR_INVALID')
  }
  const alerts = selectHotSellingSoldOutAlerts(monitor)
  if (alerts.length === 0) throw new Error('HOT_SELLING_SOLD_OUT_NONE')
  const prefix =
    typeof options.messagePrefix === 'string' && options.messagePrefix.trim()
      ? `｜${options.messagePrefix.trim().slice(0, 16)}`
      : ''
  const roomNames = alerts.map((alert) => alert.displayName)
  const mappings = Array.isArray(options.roomTypeMappings)
    ? options.roomTypeMappings
    : []
  const mappedRoomNames = alerts.flatMap((alert) => {
    const aliases = mappings
      .filter((mapping) => (
        mapping?.physicalRoomTypeCode === alert.physicalRoomTypeCode
        && typeof mapping.otaRoomTypeName === 'string'
        && mapping.otaRoomTypeName.trim()
      ))
      .map((mapping) => (
        `${PLATFORM_LABELS[mapping.platformCode] ?? '渠道'}`
        + `/${mapping.otaRoomTypeName.trim().slice(0, 60)}`
      ))
    return aliases.length > 0
      ? [`${alert.displayName}＝${[...new Set(aliases)].join('、')}`]
      : []
  })
  return [buildPayload([
    '【热销房型售罄预警】',
    `${monitor.hotelName.trim().slice(0, 40)}｜独立库存预警${prefix}`,
    `⏰截止 ${cutoffHour(monitor.cutoffAt)}｜营业日 ${shortDate(monitor.businessDate)}`,
    '',
    `售罄房型｜${listWithinByteBudget(roomNames, 1000)}`,
    ...(mappedRoomNames.length > 0
      ? [`渠道对应｜${listWithinByteBudget(mappedRoomNames, 480)}`]
      : []),
    '建议处理｜立即复核渠道价格、房态和后续库存释放策略。',
    '发送规则｜今日经营、远期房态两类简报送达后1分钟独立发送。',
    '判定规则｜仅可靠可售量为0或以下时触发；数据缺失不误报。',
  ])]
}

export const hourlyBriefBundleDelivered = ({
  hotelId,
  candidate,
  deliveriesByKey,
  now = new Date(),
}) => {
  if (
    typeof hotelId !== 'string'
    || typeof candidate?.snapshotHour !== 'string'
    || typeof candidate?.snapshot?.businessDate !== 'string'
    || !deliveriesByKey
    || typeof deliveriesByKey.get !== 'function'
  ) {
    return false
  }
  const prefix =
    `${hotelId}:${candidate.snapshot.businessDate}:${candidate.snapshotHour}`
  const requiredDeliveries = [
    `${prefix}:HOURLY_UAT_V1`,
    `${prefix}:FUTURE_14D_V1`,
  ].map((messageKey) => deliveriesByKey.get(messageKey))
  if (requiredDeliveries.some(
    (delivery) => delivery?.deliveryStatus !== 'DELIVERED',
  )) {
    return false
  }
  const completedAtTimes = requiredDeliveries.map(
    (delivery) => new Date(delivery.completedAt).getTime(),
  )
  const nowTime = new Date(now).getTime()
  return Number.isFinite(nowTime)
    && completedAtTimes.every(Number.isFinite)
    && nowTime - Math.max(...completedAtTimes) >= 60_000
}

export const hotSellingSoldOutAlertLimits = Object.freeze({
  maxMessageBytes: MAX_MESSAGE_BYTES,
  partCount: 1,
})
