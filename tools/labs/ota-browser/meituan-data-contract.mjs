// Read-only endpoints observed in the isolated, user-confirmed Guilai trial.
// Finding a path is not proof of completeness, hotel identity, or KPI readiness.
const dc = '/api/shepherdGw/bizDatacenter/hotel/eb/dataCenter'
export const MEITUAN_DATA_RECIPES = Object.freeze(Object.fromEntries(Object.entries({
  inventory: ['me', 'POST', '/api/gw/v1/product/goods/queryRoomStatusInfo'],
  prices: ['me', 'POST', '/api/gw/v1/product/goods/queryPriceInventoryStatusInfo'],
  reviews: ['me', 'GET', '/api/gw/v1/base/comments/queryGeneralCommentInfo'],
  business: ['eb', 'GET', '/api/v1/ebooking/home/businessData'],
  flow: ['eb', 'GET', `${dc}/analyse/flowConversion`],
  flowTrend: ['eb', 'GET', `${dc}/analyse/flowTrendDetail`],
  trade: ['eb', 'GET', `${dc}/trade/manage`],
  tradeTrend: ['eb', 'GET', `${dc}/trade/manageDetail`],
  score: ['eb', 'GET', `${dc}/home/score`],
  peerRanks: ['eb', 'GET', `${dc}/home/peerTrends`],
  peerRankDetail: ['eb', 'GET', '/api/v1/ebooking/business/peer/rank/data/detail'],
  peerRankResult: ['eb', 'GET', '/api/v1/ebooking/business/peer/rank/data/result'],
  peerEntryPrice: ['eb', 'GET', '/api/v1/ebooking/peerRank/followPoi/info/query'],
  orderLoss: ['eb', 'GET', '/api/v1/ebooking/peerRank/order/loss/query'],
}).map(([id, [host, method, path]]) => [id, Object.freeze({ id, version: 1,
  origin: `https://${host}.meituan.com`, method, path, mode: 'READ_ONLY_DISCOVERY' })])))

const assert = (value, code = 'MEITUAN_DATA_SCHEMA_CHANGED') => { if (!value) throw new Error(code) }
const id = value => {
  const text = typeof value === 'number' && Number.isSafeInteger(value) ? String(value) : value
  assert(typeof text === 'string' && /^[1-9]\d{0,15}$/.test(text))
  return text
}
const numeric = value => { assert(typeof value === 'number' && Number.isFinite(value)); return value }
const count = value => { numeric(value); assert(Number.isSafeInteger(value) && value >= 0); return value }
const text = (value, max = 300) => { assert(typeof value === 'string' && value.length <= max); return value }
const date = value => {
  assert(typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value))
  assert(Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0,10) === value)
  return value
}
const dayOf = value => {
  if (value == null || value === 0) return null
  assert(Number.isSafeInteger(value) && value >= Date.parse('2000-01-01') && value < Date.parse('2100-01-01'))
  return new Date(value + 8 * 3600000).toISOString().slice(0,10)
}
export const assertMeituanScope = (query, expected) => {
  assert(expected && query, 'MEITUAN_DATA_SCOPE_REQUIRED')
  assert(id(query.poiId) === id(expected.poiId) && id(query.partnerId) === id(expected.partnerId), 'MEITUAN_DATA_SCOPE_MISMATCH')
  return { poiId: id(expected.poiId), partnerId: id(expected.partnerId) }
}
const providerSuccess = (root, kind) => {
  assert(root && typeof root === 'object' && !Array.isArray(root))
  assert(kind === 'merchant' ? root.code === 10000 : root.status === 0, 'MEITUAN_DATA_PROVIDER_REJECTED')
}
const array = (value, max) => { assert(Array.isArray(value) && value.length <= max); return value }

// Missing or explicitly unavailable numbers never become zero.
export const meituanDisplayNumber = (value, scale = null) => {
  if (value == null || value === '-' || value === '--' || value === '') return { value: null, approximate: false }
  const rendered = String(value)
  assert(/^-?\d+(?:\.\d+)?$/.test(rendered))
  assert(scale == null || scale === '' || scale === '万' || scale === '亿')
  const multiplier = scale === '万' ? 10000 : scale === '亿' ? 100000000 : 1
  const result = Number(`${rendered}e${multiplier === 1 ? 0 : multiplier === 10000 ? 4 : 8}`)
  assert(Number.isFinite(result))
  return { value: result, approximate: multiplier !== 1 }
}
const comparisonValues = value => array(Array.isArray(value) ? value : [value], 8).map(item => text(item, 100))

export const normalizeMeituanBusiness = (root, query, expected, { observedAt, period } = {}) => {
  const scope = assertMeituanScope(query, expected)
  providerSuccess(root, 'datacenter')
  assert(['YESTERDAY', 'LAST_7_DAYS', 'LAST_30_DAYS', 'LIVE'].includes(period), 'MEITUAN_DATA_PERIOD_REQUIRED')
  assert({ YESTERDAY: '1', LAST_7_DAYS: '7', LAST_30_DAYS: '30' }[period] === String(query.dateRange)
    || period === 'LIVE', 'MEITUAN_DATA_PERIOD_MISMATCH')
  // Live dateRange has not been independently verified. Do not guess its value.
  assert(period !== 'LIVE', 'MEITUAN_LIVE_PERIOD_NOT_VERIFIED')
  const captured = new Date(observedAt)
  assert(Number.isFinite(captured.getTime()))
  const localHour = (captured.getUTCHours() + 8) % 24
  const awaitingDailyPublication = period === 'YESTERDAY' && localHour < 9
  const seen = new Set()
  const cards = array(root.data?.cards, 50).map(row => {
    const metricId = text(String(row.id), 100)
    assert(!seen.has(metricId)); seen.add(metricId)
    const value = meituanDisplayNumber(row.value, row.unit)
    const comparisons = array(row.extAttrs ?? [], 10).map(attr => ({
      kind: text(attr.key, 40), label: text(attr.name, 60), values: comparisonValues(attr.values),
    }))
    const rankText = comparisons.find(attr => attr.label === '同行排名')?.values[0]
    const match = /^(\d+)\/(\d+)$/.exec(rankText ?? '')
    const rank = match ? { position: Number(match[1]), peers: Number(match[2]) } : null
    if (rank) assert(rank.position > 0 && rank.position <= rank.peers)
    // Preserve provider-rendered peer values and comparison signs. Different
    // cards can have different scales and % is not automatically a pp delta.
    return { id: metricId, label: text(row.title, 100), displayValue: row.value == null ? null : text(String(row.value), 100),
      scale: row.unit ?? null, suffix: row.suffix ?? null, ...value, rank, comparisons }
  })
  assert(cards.length > 0)
  return { provider: 'MEITUAN', scope, period, observedAt: captured.toISOString(),
    sourceUpdatedAtText: text(root.data?.rtDataUpdateTime ?? '', 150),
    publicationStatus: awaitingDailyPublication ? 'AWAITING_09_00_DAILY_UPDATE' : 'SOURCE_DATE_CONFIRMATION_REQUIRED',
    // The successful request and an update clock do not establish a complete
    // business-day snapshot. The alert scheduler must verify its source date.
    readyForAlerts: false, cards,
    validStayedOrderCount: null, goodReviewConversionPercent: null,
    kpiStatus: 'VALID_STAYED_ORDERS_REQUIRED',
  }
}

export const normalizeMeituanReviewPage = (root, query, expected) => {
  const scope = assertMeituanScope(query, expected)
  providerSuccess(root, 'merchant')
  const expectedName = text(expected.propertyName, 300).replace(/\s+/g, '')
  assert(expectedName.length > 0, 'MEITUAN_DATA_SCOPE_REQUIRED')
  const rows = array(root.data?.commentList, 100).map(row => {
    assert(text(row.poiName, 300).replace(/\s+/g, '') === expectedName, 'MEITUAN_DATA_SCOPE_MISMATCH')
    const precise = row.accurateScore == null ? null : numeric(row.accurateScore)
    if (precise !== null) assert(precise >= 0 && precise <= 50)
    return { publishedDate: dayOf(row.commentTime), providerConsumeDate: dayOf(row.consumeTime),
      score: precise === null ? null : precise / 10,
      good: precise === null ? null : precise >= 48 }
  })
  return { provider: 'MEITUAN', scope, totalAllTime: count(root.data?.total),
    page: count(root.data?.offset), limit: count(root.data?.limit), rows,
    replyFilter: String(query.replyType ?? ''), fetchedRows: rows.length,
    // The API's total is cumulative and can stay unchanged after filtering.
    // A short filtered page is not proof that the month's reviews are complete.
    windowComplete: false, consumeDateMeaning: 'NOT_YET_VERIFIED_AS_CHECKIN_DATE',
    goodReviewConversionPercent: null }
}

export const normalizeMeituanInventory = (root, query, expected) => {
  const scope = assertMeituanScope(query, expected)
  providerSuccess(root, 'merchant')
  assert(root.success === true, 'MEITUAN_DATA_PROVIDER_REJECTED')
  const start = date(query.startDate), end = date(query.endDate)
  assert(end >= start && (Date.parse(end) - Date.parse(start)) / 86400000 < 90)
  // Multiple products can refer to the same physical room ID. The real UI
  // requests and receives duplicates; never count that inventory twice.
  const expectedRooms = [...new Set(array(query.roomIds, 100).map(id))]
  assert(expectedRooms.length > 0)
  const seen = new Map()
  for (const row of array(root.data, 100)) {
    const roomId = id(row.roomBaseInfo?.roomId)
    assert(expectedRooms.includes(roomId), 'MEITUAN_DATA_SCOPE_MISMATCH')
    assert(row.roomStatusMap && typeof row.roomStatusMap === 'object' && !Array.isArray(row.roomStatusMap))
    const days = Object.entries(row.roomStatusMap).map(([key, value]) => {
      const day = date(value.date)
      assert(key === day && day >= start && day <= end, 'MEITUAN_DATA_DATE_MISMATCH')
      return { date: day, providerStatusCode: numeric(value.roomStatus),
        inventorySwitchCode: numeric(value.invSwitch), limitTypeCode: numeric(value.limitType),
        providerRemainCount: value.remainCount == null ? null : numeric(value.remainCount),
        providerLimitRemain: value.limitRemain == null ? null : numeric(value.limitRemain),
        providerUsedCount: value.usedCount == null ? null : numeric(value.usedCount),
        // The three displayed counts and unlimited/switch flags still require
        // semantic mapping; do not send sold-out alerts from an assumed zero.
        reliableAvailable: null }
    }).sort((a,b) => a.date.localeCompare(b.date))
    assert(days.length === (Date.parse(end) - Date.parse(start)) / 86400000 + 1, 'MEITUAN_DATA_DATES_INCOMPLETE')
    const room = { roomId, name: text(row.roomBaseInfo.roomName), days }
    const previous = seen.get(roomId)
    assert(!previous || JSON.stringify(previous) === JSON.stringify(room), 'MEITUAN_DATA_CONFLICTING_INVENTORY')
    seen.set(roomId, room)
  }
  assert(seen.size === expectedRooms.length, 'MEITUAN_DATA_ROOMS_INCOMPLETE')
  return { provider: 'MEITUAN', scope, startDate: start, endDate: end, rooms: [...seen.values()],
    availabilitySemantics: 'REQUIRES_UI_MAPPING', readyForAlerts: false }
}

export const normalizeMeituanPeerEntry = (root, query, expected) => {
  const scope = assertMeituanScope(query, expected)
  providerSuccess(root, 'datacenter')
  const peerId = id(query.followPoiId)
  assert(id(root.data?.poiId) === peerId, 'MEITUAN_DATA_PEER_MISMATCH')
  const lowest = root.data?.lowestPrice
  if (lowest != null) numeric(lowest)
  return { provider: 'MEITUAN', scope, peerId, name: text(root.data.poiName),
    displayFromPrice: lowest > 0 ? lowest : null, currency: 'CNY',
    quoteType: 'PLATFORM_FROM_PRICE', checkInDate: null, roomType: null,
    mealPlan: null, cancellationPolicy: null, availability: null,
    // An entry price without stay date/rate-plan terms is not a comparable
    // room quote. No raise/lower-price alert can be based on it alone.
    readyForPriceAlerts: false }
}
