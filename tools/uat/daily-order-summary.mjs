export const DAILY_ORDER_SUMMARY_BASIS = 'PMS_ORDER_DETAIL_AGGREGATE_V1'
export const DAILY_ORDER_CHANNELS = Object.freeze([
  'MEITUAN',
  'FEIZHU',
  'DOUYIN',
  'OTHER',
])

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
  if (
    !exactKeys(value, ['basis', 'businessDate', 'byChannel'])
    || value.basis !== DAILY_ORDER_SUMMARY_BASIS
    || !businessDateValue(value.businessDate)
    || (businessDate !== null && value.businessDate !== businessDate)
    || !exactKeys(value.byChannel, DAILY_ORDER_CHANNELS)
  ) return null

  const byChannel = {}
  for (const channel of DAILY_ORDER_CHANNELS) {
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
    basis: DAILY_ORDER_SUMMARY_BASIS,
    businessDate: value.businessDate,
    byChannel,
  }
}
