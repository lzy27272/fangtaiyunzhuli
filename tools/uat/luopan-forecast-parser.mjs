import { createHmac } from 'node:crypto'

const AGGREGATE_LABEL = '全部可售房'
const METRIC_LABELS = new Set([
  '已售房',
  '在住',
  '预抵',
  '预离',
  '维修',
  '自用',
  '简单出租率',
  '预计平均房价',
  '预计房费收入',
])

const canonicalDate = (value) => {
  const text = String(value ?? '').trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null
  const parsed = new Date(`${text}T00:00:00Z`)
  return !Number.isNaN(parsed.getTime())
    && parsed.toISOString().slice(0, 10) === text
      ? text
      : null
}

const finiteNumber = (value) => {
  const text = String(value ?? '').replace(/,/g, '').trim()
  if (!text || text === '---' || text === '--') return null
  const number = Number(text.replace(/%$/, ''))
  return Number.isFinite(number) ? number : null
}

const rounded = (value, digits = 2) =>
  value === null || value === undefined
    ? null
    : Number(Number(value).toFixed(digits))

const dateFromMonthDay = (monthDay, businessDate) => {
  const match = String(monthDay ?? '').match(/^(\d{2})-(\d{2})$/)
  if (!match) return null
  const base = new Date(`${businessDate}T00:00:00Z`)
  const candidates = [-1, 0, 1]
    .map((offset) => {
      const year = base.getUTCFullYear() + offset
      const text = `${year}-${match[1]}-${match[2]}`
      const parsed = new Date(`${text}T00:00:00Z`)
      return {
        text,
        parsed,
        distance: Math.abs(parsed.getTime() - base.getTime()),
      }
    })
    .filter((candidate) =>
      !Number.isNaN(candidate.parsed.getTime())
      && candidate.parsed.toISOString().slice(0, 10) === candidate.text)
    .sort((left, right) => left.distance - right.distance)
  return candidates[0]?.text ?? null
}

const valuesFor = (row, dateCount) =>
  Array.from(
    { length: dateCount },
    (_, index) => finiteNumber(row?.[index + 1]),
  )

const parseBlock = (rows, startIndex, dates) => {
  const first = rows[startIndex]
  const metrics = new Map([
    ['可售房', valuesFor(first, dates.length)],
  ])
  let cursor = startIndex + 1
  while (cursor < rows.length) {
    const label = String(rows[cursor]?.[0] ?? '').trim()
    if (!METRIC_LABELS.has(label)) break
    metrics.set(label, valuesFor(rows[cursor], dates.length))
    cursor += 1
  }
  return {
    label: String(first?.[0] ?? '').trim(),
    metrics,
    nextIndex: cursor,
  }
}

const metricAt = (block, label, index) =>
  block.metrics.get(label)?.[index] ?? null

const dailyRow = (block, stayDate, index) => {
  const availableRooms = metricAt(block, '可售房', index)
  const soldRooms = metricAt(block, '已售房', index)
  const maintainingRooms = metricAt(block, '维修', index)
  const ownUseRooms = metricAt(block, '自用', index)
  const roomCount =
    availableRooms === null || soldRooms === null
      ? null
      : availableRooms
        + soldRooms
        + (maintainingRooms ?? 0)
        + (ownUseRooms ?? 0)
  const roomFee = metricAt(block, '预计房费收入', index)
  return {
    stayDate,
    roomCount,
    availableRooms,
    soldRooms,
    orderRooms: metricAt(block, '预抵', index),
    checkinRooms: metricAt(block, '在住', index),
    departureRooms: metricAt(block, '预离', index),
    maintainingRooms,
    ownUseRooms,
    roomFee,
    revenue: roomFee,
    roomNights: soldRooms,
    occupancyRate: metricAt(block, '简单出租率', index),
    adr: metricAt(block, '预计平均房价', index),
    revPar:
      roomFee === null || roomCount === null || roomCount <= 0
        ? null
        : rounded(roomFee / roomCount),
  }
}

const roomCode = (secretKey, label) =>
  createHmac('sha256', secretKey)
    .update(`luopan-room-type:${label}`)
    .digest('hex')
    .slice(0, 16)

export const parseLuopanForecastTable = ({
  rows,
  businessDate,
  secretKey,
}) => {
  const normalizedBusinessDate = canonicalDate(businessDate)
  if (!normalizedBusinessDate) {
    throw new Error('LUOPAN_BUSINESS_DATE_INVALID')
  }
  if (
    !Array.isArray(rows)
    || rows.length < 4
    || typeof secretKey !== 'string'
    || secretKey.length < 16
  ) {
    throw new Error('LUOPAN_FORECAST_TABLE_INVALID')
  }
  const normalizedRows = rows
    .filter((row) => Array.isArray(row))
    .map((row) =>
      row.map((cell) =>
        String(cell ?? '').replace(/\s+/g, ' ').trim()))
    .filter((row) => row.some(Boolean))
  const dateRow = normalizedRows.find(
    (row) =>
      row.slice(1).filter((cell) => /^\d{2}-\d{2}$/.test(cell)).length >= 2,
  )
  if (!dateRow) throw new Error('LUOPAN_FORECAST_DATES_MISSING')
  const dates = dateRow
    .slice(1)
    .map((cell) => dateFromMonthDay(cell, normalizedBusinessDate))
  if (
    dates.length < 2
    || dates.some((date) => !date)
    || new Set(dates).size !== dates.length
    || !dates.includes(normalizedBusinessDate)
  ) {
    throw new Error('LUOPAN_FORECAST_DATES_INVALID')
  }
  const aggregateIndex = normalizedRows.findIndex(
    (row) => row[0] === AGGREGATE_LABEL,
  )
  if (aggregateIndex < 0) {
    throw new Error('LUOPAN_FORECAST_AGGREGATE_MISSING')
  }
  const aggregate = parseBlock(normalizedRows, aggregateIndex, dates)
  const daily = dates.map(
    (stayDate, index) => dailyRow(aggregate, stayDate, index),
  )
  const current = daily.find(
    (row) => row.stayDate === normalizedBusinessDate,
  )
  if (
    !current
    || current.roomCount === null
    || current.availableRooms === null
    || current.soldRooms === null
  ) {
    throw new Error('LUOPAN_FORECAST_CURRENT_INVALID')
  }

  const roomBlocks = []
  let cursor = aggregate.nextIndex
  while (cursor < normalizedRows.length) {
    const label = normalizedRows[cursor]?.[0]
    if (!label || METRIC_LABELS.has(label) || label === AGGREGATE_LABEL) {
      cursor += 1
      continue
    }
    const block = parseBlock(normalizedRows, cursor, dates)
    if (block.metrics.has('已售房')) roomBlocks.push(block)
    cursor = Math.max(cursor + 1, block.nextIndex)
  }
  const physicalInventory = roomBlocks.map((block) => {
    const index = dates.indexOf(normalizedBusinessDate)
    const row = dailyRow(block, normalizedBusinessDate, index)
    const code = roomCode(secretKey, block.label)
    return {
      inventoryPoolId: `LUOPAN-${code}`,
      physicalRoomTypeCode: `LUOPAN-${code}`,
      displayName: block.label.slice(0, 80),
      physicalRoomCount: row.roomCount,
      primaryAvailableRooms: row.availableRooms,
      estimatedRoomNights: row.soldRooms,
      estimatedRoomFee: row.roomFee,
      estimatedAdr: row.adr,
    }
  })
  if (physicalInventory.length < 1) {
    throw new Error('LUOPAN_FORECAST_ROOM_TYPES_MISSING')
  }
  return {
    businessDate: normalizedBusinessDate,
    current,
    futureDaily: daily.filter(
      (row) => row.stayDate > normalizedBusinessDate,
    ),
    physicalInventory,
    roomForecast: physicalInventory.map((row) => ({ ...row })),
  }
}

export const luopanForecastLabels = Object.freeze({
  aggregate: AGGREGATE_LABEL,
  metrics: [...METRIC_LABELS],
})
