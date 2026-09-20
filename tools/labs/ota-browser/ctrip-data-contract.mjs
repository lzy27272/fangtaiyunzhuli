// Contracts observed in the authenticated, isolated eBooking trial (2026-09-18).
// These are read-only queries, not an arbitrary HTTP replay facility.
export const CTRIP_DATA_RECIPES = Object.freeze(Object.fromEntries(Object.entries({
  catalog: ['/ebkovsroom/api/inventory/getRcProductList', '/ebkovsroom/inventory/calendar'],
  inventory: ['/ebkovsroom/inventory/getbasicroomstatushtml', '/ebkovsroom/inventory/calendar'],
  rating: ['/restapi/soa2/26353/getHotelRating', '/comment/commentList'],
  reviews: ['/restapi/soa2/26353/getCommentNumV2', '/comment/commentList'],
  reviewScope: ['/restapi/soa2/26353/getCommentList', '/comment/commentList'],
  orders: ['/restapi/soa2/27204/queryOrderList', '/ebkorderv3/domestic'],
  liveTraffic: ['/datacenter/api/dataCenter/current/fetchVisitorTitleV2', '/datacenter/inland/businessreport/flowdata'],
  traffic: ['/datacenter/api/inland/marketanalysis/flowanalysis/queryScanFlowDetailsV2', '/datacenter/inland/businessreport/flowdata'],
}).map(([id, [path, page]]) => [id, Object.freeze({ id, version: 1, method: 'POST', path, page })])))

const fail = (code = 'CTRIP_DATA_SCHEMA_CHANGED') => { throw new Error(code) }
export const dataAssert = (condition, code) => { if (!condition) fail(code) }
export const dataId = (value) => {
  const result = typeof value === 'number' && Number.isSafeInteger(value) ? String(value) : value
  dataAssert(typeof result === 'string' && /^[1-9]\d{0,19}$/u.test(result))
  return result
}
const number = (value, max = Number.MAX_SAFE_INTEGER) => {
  dataAssert(typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= max)
  return value
}
const count = value => { number(value); dataAssert(Number.isSafeInteger(value)); return value }
const optionalCount = value => value == null ? null : count(value)
export const isoDay = (value) => {
  dataAssert(typeof value === 'string' && /^\d{4}-\d{2}-\d{2}(?:$|[ T])/u.test(value))
  const day = value.slice(0, 10)
  dataAssert(Number.isFinite(Date.parse(day)) && new Date(day).toISOString().slice(0, 10) === day)
  return day
}
export const shiftDay = (day, delta) => new Date(Date.parse(isoDay(day)) + delta * 86400000).toISOString().slice(0, 10)
export const ctripDataWindow = (now = new Date()) => {
  const today = new Date(now.getTime() + 8 * 3600000).toISOString().slice(0, 10)
  return { timezone: 'Asia/Shanghai', startDate: shiftDay(today, -30), endDate: shiftDay(today, -1), today }
}
export const windowDays = ({ startDate, endDate }) => {
  isoDay(startDate); isoDay(endDate)
  const length = Math.round((Date.parse(endDate) - Date.parse(startDate)) / 86400000) + 1
  dataAssert(length > 0 && length <= 90)
  return Array.from({ length }, (_, i) => shiftDay(startDate, i))
}
export const soaSuccess = root => {
  dataAssert(root?.resStatus?.rcode === 200 && root.ResponseStatus?.Ack === 'Success', 'CTRIP_DATA_PROVIDER_REJECTED')
}
const inventorySuccess = root => dataAssert(root?.code === 200 && (root.returnCode == null || root.returnCode === 0), 'CTRIP_DATA_PROVIDER_REJECTED')
const roomName = value => {
  dataAssert(typeof value === 'string' && value.length <= 2000)
  // Encoded product names are plain text. Never render source HTML.
  return value.replace(/&#(?:x([a-f\d]+)|(\d+));/giu, (_, hex, decimal) => {
    const point = parseInt(hex || decimal, hex ? 16 : 10)
    return point > 0 && point <= 0x10ffff ? String.fromCodePoint(point) : ''
  }).replace(/&(amp|lt|gt|quot|apos|middot|nbsp);/gu, (_, key) => ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", middot: '·', nbsp: ' ' }[key]))
    .replace(/&(middot|nbsp);/gu, (_, key) => key === 'middot' ? '·' : ' ')
    .replace(/[\u0000-\u001f\u007f]/gu, '').slice(0, 300)
}

export const normalizeCtripCatalog = root => {
  inventorySuccess(root)
  dataAssert(Array.isArray(root.data) && root.data.length > 0 && root.data.length <= 100)
  const ids = new Set()
  const rooms = root.data.map(row => {
    const id = dataId(row.basicRoomTypeID)
    dataAssert(!ids.has(id)); ids.add(id)
    dataAssert(Array.isArray(row.roomInfos) && row.roomInfos.length > 0 && row.roomInfos.length <= 300)
    dataAssert(Array.isArray(row.sonBasicRoomIDList) && row.sonBasicRoomIDList.length > 0)
    const products = row.roomInfos.map(product => {
      dataAssert(['PP', 'FG'].includes(product.payType))
      return { hotelID: dataId(product.hotelID), roomTypeID: dataId(product.roomTypeID),
        payType: product.payType, roomClass: dataId(product.roomClass) }
    })
    dataAssert(typeof row.enableBasicRoomQuantity === 'boolean')
    return { id, name: roomName(row.roomName), sourceName: row.roomName,
      basicRoomList: row.sonBasicRoomIDList.map(dataId), products,
      quantityEnabled: row.enableBasicRoomQuantity }
  })
  return { rooms, hotelIds: [...new Set(rooms.flatMap(room => room.products.map(p => p.hotelID)))] }
}
export const inventoryQuery = (room, window) => ({
  masterBasicRoomID: Number(room.id), masterBasicRoomName: room.sourceName,
  basicRoomList: room.basicRoomList.map(Number),
  hotelRoomInfoDtoList: room.products.map(p => ({ ...p, hotelID: Number(p.hotelID), roomTypeID: Number(p.roomTypeID), roomClass: Number(p.roomClass) })),
  startDate: window.startDate, endDate: window.endDate, returnDateHead: true,
  enableBasicRoomQuantity: room.quantityEnabled, hideBasicSoldedQuantity: false,
})
export const normalizeCtripInventory = (root, room, window) => {
  inventorySuccess(root)
  const expected = windowDays(window)
  dataAssert(Array.isArray(root.otherData) && root.otherData.length === expected.length)
  const rows = root.otherData.map(row => {
    dataAssert(dataId(row.roomTypeID) === room.id, 'CTRIP_DATA_SCOPE_MISMATCH')
    dataAssert(['ROOMED', 'FULL'].includes(row.roomStatus))
    dataAssert(typeof row.enableBasicRoomQuantity === 'boolean')
    return { date: isoDay(row.effectDate), status: row.roomStatus,
      available: row.enableBasicRoomQuantity === true && room.quantityEnabled === true ? optionalCount(row.canUsedQuantity) : null,
      sold: optionalCount(row.soldRoomQuantity), roomQuantity: optionalCount(row.roomQuantity) }
  }).sort((a, b) => a.date.localeCompare(b.date))
  dataAssert(rows.every((row, i) => row.date === expected[i]))
  return { id: room.id, name: room.name, days: rows }
}
export const normalizeCtripReviews = (rating, counts, scope, hotelId) => {
  for (const root of [rating, counts, scope]) soaSuccess(root)
  dataAssert(dataId(scope.masterHotelId) === hotelId, 'CTRIP_DATA_SCOPE_MISMATCH')
  const r = rating.ctripRatings, c = counts.ctripCount
  dataAssert(r && c)
  return { scope: 'CURRENT_CUMULATIVE', rating: number(r.ratingAll, 5),
    location: number(r.ratingLocation, 5), facilities: number(r.ratingFacility, 5),
    service: number(r.ratingService, 5), room: number(r.ratingRoom, 5),
    total: count(c.commentCount), negative: count(c.noRecommendCount), unreplied: count(c.unReplyCount),
    withPictures: count(c.hasPicCount), goodRate: number(c.goodRate, 1), responseRate: number(c.responseRate, 1) }
}
export const ctripOrderQuery = (basis, window, pageIndex) => {
  dataAssert(['OrderDate', 'ArrivalDate'].includes(basis) && Number.isSafeInteger(pageIndex) && pageIndex >= 0)
  windowDays(window)
  return { timeZone: 8, isHotelCompany: false, orderCountTypes: ['UnBookingInvoice'], isUnProcess: false,
    orderQueryCondition: { queryDateType: basis, dateStart: window.startDate, dateEnd: window.endDate,
      formType: 'All', formTypes: [], sourceType: 'Ebooking', receiveTypes: [], allicanceNames: [], unBookingInvoice: false,
      queryOrderStatus: 'All', queryOrderStatuses: [], queryCustemFilter: 'None',
      keyword: '', roomName: '', bookingNo: '', confirmName: '', isShowExtraInfo: true,
      pageInfo: { pageIndex, orderBy: 'FormDate', sort: 'Desc', pageSize: 20 },
      extraMap: { DOMESTIC_NEW_WEB: 'T', UNPROCESS_COUNT_BY_SOURCE: 'T' } } }
}
// Numeric orderStatus=100 was observed for BOTH confirmed and cancelled orders.
// Only the verified semantic status is eligible; new statuses never default to valid.
const EFFECTIVE = new Set(['Receipt', 'CheckIn'])
const EXCLUDED = new Set(['Canceled', 'Unprocess', 'Rejected'])
export const normalizeCtripOrderPage = (root, hotelIds, basis, window) => {
  soaSuccess(root)
  const total = count(root.total)
  dataAssert(Array.isArray(root.orderList) && root.orderList.length <= 20 && root.orderList.length <= total)
  const rows = root.orderList.map(row => {
    dataAssert(hotelIds.includes(dataId(row.hotel)), 'CTRIP_DATA_SCOPE_MISMATCH')
    const date = isoDay(basis === 'OrderDate' ? row.orderDate : row.arrival)
    if (basis === 'ArrivalDate') dataAssert(date >= window.startDate && date <= window.endDate, 'CTRIP_DATA_DATE_MISMATCH')
    dataAssert(typeof row.sourceType === 'string' && /^[A-Za-z0-9_-]{1,32}$/u.test(row.sourceType))
    dataAssert(typeof row.orderStatusType === 'string' && /^[A-Za-z]{1,32}$/u.test(row.orderStatusType))
    dataAssert(typeof row.formDateOriginal === 'string' && /^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/u.test(row.formDateOriginal))
    return { key: `${row.sourceType}:${dataId(row.orderId)}`, record: `${row.sourceType}:${dataId(row.formId)}`,
      changedAt: row.formDateOriginal, date, status: row.orderStatusType,
      inWindow: date >= window.startDate && date <= window.endDate,
      quantity: count(row.quantity), nights: /^\d+$/u.test(String(row.liveDays)) ? count(Number(row.liveDays)) : fail(),
      effective: EFFECTIVE.has(row.orderStatusType), known: EFFECTIVE.has(row.orderStatusType) || EXCLUDED.has(row.orderStatusType)
        // Observed Changed + orderType S + description 无效 identifies the obsolete
        // original of a rebooking, not a still-effective modified reservation.
        || (row.orderStatusType === 'Changed' && row.orderType === 'S' && row.orderTypeDesc === '无效') }
  })
  return { total, rows }
}
export const aggregateCtripOrders = (rows, { total, fetched, pages, complete, basis, window, issue = null }) => {
  const orders = new Map()
  for (const row of rows) {
    const previous = orders.get(row.key)
    if (!previous || row.changedAt > previous.changedAt) orders.set(row.key, row)
    else if (row.changedAt === previous.changedAt && row.status !== previous.status) complete = false
  }
  const daily = windowDays(window).map(date => ({ date, effectiveOrders: 0, roomNights: 0 }))
  const byDay = new Map(daily.map(row => [row.date, row]))
  let effectiveOrders = 0, roomNights = 0, excludedOrders = 0, unknownOrders = 0, outsideWindowOrders = 0
  const statusCounts = Object.create(null)
  for (const row of orders.values()) {
    if (row.inWindow === false) { outsideWindowOrders++; continue }
    statusCounts[row.status] = (statusCounts[row.status] || 0) + 1
    if (!row.known) unknownOrders++
    else if (!row.effective) excludedOrders++
    else { effectiveOrders++; roomNights += row.quantity * row.nights
      byDay.get(row.date).effectiveOrders++; byDay.get(row.date).roomNights += row.quantity * row.nights }
  }
  return { basis, startDate: window.startDate, endDate: window.endDate, timezone: window.timezone,
    scope: 'EBOOKING_ALL_ORDERS', totalRecords: total, fetchedRecords: fetched, pages,
    uniqueOrders: orders.size, effectiveOrders, roomNights, excludedOrders, unknownOrders,
    outsideWindowOrders, statusCounts,
    paginationComplete: complete && fetched === total, complete: complete && fetched === total && unknownOrders === 0,
    issue: issue || (unknownOrders ? 'UNRECOGNIZED_ORDER_STATUS' : null), daily }
}
export const normalizeCtripLiveTraffic = root => ({
  scope: 'TODAY_LIVE', visitors: count(root?.visitorTotal), competitorVisitors: count(root?.competitorAvgNumber),
  rank: count(root?.visitorRank), previousVisitors: count(root?.lastVisitorTotal),
})
export const normalizeCtripTraffic = (root, window) => {
  dataAssert(root?.rcode === 0 && root.data, 'CTRIP_DATA_PROVIDER_REJECTED')
  const dates = windowDays(window), data = root.data
  for (const key of ['effectDateList', 'pvDataList', 'uvDataList', 'orderDataList', 'conversionsRatesDataList']) {
    dataAssert(Array.isArray(data[key]) && data[key].length === dates.length)
  }
  return dates.map((date, i) => {
    dataAssert(data.effectDateList[i] === date.slice(5), 'CTRIP_DATA_DATE_MISMATCH')
    const nullable = value => value == null ? null : number(value)
    return { date, pageViews: nullable(data.pvDataList[i]), visitors: nullable(data.uvDataList[i]),
      orders: nullable(data.orderDataList[i]), conversionPercent: nullable(data.conversionsRatesDataList[i]) }
  })
}
