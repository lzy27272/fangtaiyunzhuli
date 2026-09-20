export const LEGACY_DAILY_ORDER_SUMMARY_BASIS = 'PMS_ORDER_DETAIL_AGGREGATE_V1'
export const DAILY_ORDER_SUMMARY_BASIS = 'PMS_ORDER_DETAIL_AGGREGATE_V2'
export const DAILY_ORDER_CHANNELS = Object.freeze([
  'CTRIP',
  'MEITUAN',
  'FEIZHU',
  'DOUYIN',
  'FRONT_DESK',
  'WEDDING',
  'OTHER',
])
export const DAILY_ORDER_CHANNEL_LABELS = Object.freeze({
  CTRIP: '携程',
  MEITUAN: '美团',
  FEIZHU: '飞猪',
  DOUYIN: '抖音',
  FRONT_DESK: '前台',
  WEDDING: '婚宴',
  OTHER: '其他',
})
const LEGACY_DAILY_ORDER_CHANNELS = Object.freeze(['MEITUAN', 'FEIZHU', 'DOUYIN', 'OTHER'])
export const PMS_ORDER_CHANNELS = Object.freeze([
  ...DAILY_ORDER_CHANNELS.filter((channel) => channel !== 'OTHER'), 'UNKNOWN',
])

const CHANNEL_PATTERNS = [
  ['CTRIP', /(?:携程|ctrip|trip\.com)/iu],
  ['MEITUAN', /(?:美团|meituan)/iu],
  ['FEIZHU', /(?:飞猪|fliggy|alitrip)/iu],
  ['DOUYIN', /(?:抖音|douyin)/iu],
  ['FRONT_DESK', /(?:前台|walk[ -]?in)/iu],
  ['WEDDING', /(?:婚宴|婚房|wedding)/iu],
]

// Preserve the PMS channel field's precedence over secondary rate/contract labels.
// Only emit known categories, never arbitrary source text or personal information.
export const detectPmsOrderChannel = (values) => {
  for (const value of values) {
    if (typeof value !== 'string' || !value.trim()) continue
    const match = CHANNEL_PATTERNS.find(([, pattern]) => pattern.test(value))
    if (match) return match[0]
  }
  return 'UNKNOWN'
}

const BUCKET_FIELDS = Object.freeze([
  'active',
  'today',
  'future',
  'canceled',
])
const MAX_AGGREGATE_ROOM_NIGHTS = 1_000_000

const plainObject = (value) =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)

const exactKeys = (value, expected) =>
  plainObject(value)
  && Object.keys(value).length === expected.length
  && expected.every((key) => Object.hasOwn(value, key))

const businessDateValue = (value) =>
  typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/u.test(value)
    ? value
    : null

const safeAggregate = (value) =>
  typeof value === 'number'
  && Number.isFinite(value)
  && value >= 0
  && value <= MAX_AGGREGATE_ROOM_NIGHTS
    ? value
    : null

const emptyBucket = () => ({
  active: 0,
  today: 0,
  future: 0,
  canceled: 0,
})

const canonicalChannel = (value) =>
  DAILY_ORDER_CHANNELS.includes(value) ? value : 'OTHER'

const rounded = (value) => Number(value.toFixed(2))

export const createDailyOrderSummary = ({ orders, businessDate }) => {
  const scopedBusinessDate = businessDateValue(businessDate)
  if (!scopedBusinessDate || !Array.isArray(orders)) {
    throw new Error('DAILY_ORDER_SUMMARY_INPUT_INVALID')
  }
  const byChannel = Object.fromEntries(
    DAILY_ORDER_CHANNELS.map((channel) => [channel, emptyBucket()]),
  )
  for (const order of orders) {
    if (!plainObject(order) || order.orderDate !== scopedBusinessDate) continue
    const roomNights = safeAggregate(order.roomNights)
    if (roomNights === null) continue
    const bucket = byChannel[canonicalChannel(order.channel)]
    if (order.status === 'CANCELLED') {
      bucket.canceled += roomNights
      continue
    }
    if (order.status !== 'ACTIVE') continue
    bucket.active += roomNights
    if (order.arrivalClass === 'TODAY') bucket.today += roomNights
    if (order.arrivalClass === 'FUTURE') bucket.future += roomNights
  }
  for (const bucket of Object.values(byChannel)) {
    for (const field of BUCKET_FIELDS) {
      if (safeAggregate(bucket[field]) === null) {
        throw new Error('DAILY_ORDER_SUMMARY_LIMIT_EXCEEDED')
      }
      bucket[field] = rounded(bucket[field])
    }
  }
  return {
    basis: DAILY_ORDER_SUMMARY_BASIS,
    businessDate: scopedBusinessDate,
    byChannel,
  }
}

export const normalizeDailyOrderSummary = (
  value,
  { businessDate = null } = {},
) => {
  // V1 combined Ctrip with OTHER. Keep that provenance: a missing Ctrip
  // bucket in an old aggregate is not evidence of zero Ctrip orders.
  const channels = value?.basis === LEGACY_DAILY_ORDER_SUMMARY_BASIS
    ? LEGACY_DAILY_ORDER_CHANNELS
    : DAILY_ORDER_CHANNELS
  if (
    !exactKeys(value, ['basis', 'businessDate', 'byChannel'])
    || ![DAILY_ORDER_SUMMARY_BASIS, LEGACY_DAILY_ORDER_SUMMARY_BASIS].includes(value.basis)
    || !businessDateValue(value.businessDate)
    || (businessDate !== null && value.businessDate !== businessDate)
    || !exactKeys(value.byChannel, channels)
  ) return null

  const byChannel = {}
  for (const channel of channels) {
    const bucket = value.byChannel[channel]
    if (!exactKeys(bucket, BUCKET_FIELDS)) return null
    byChannel[channel] = {}
    for (const field of BUCKET_FIELDS) {
      const aggregate = safeAggregate(bucket[field])
      if (aggregate === null) return null
      byChannel[channel][field] = aggregate
    }
  }
  return {
    basis: value.basis,
    businessDate: value.businessDate,
    byChannel,
  }
}
