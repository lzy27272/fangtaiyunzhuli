import { collectLiveReports } from './live-report-collector.mjs'

export const BIEYANGHONG_FORECAST_ENDPOINT = 'https://pms.meituan.com/hotelpms/api/v2/report/roomState/batchSearchBaseRoomForcasting'
export const BIEYANGHONG_ROOM_CATALOG_ENDPOINT = 'https://pms.meituan.com/hotelpms/api/v1/property/roomType/search'
const FORECAST_SOURCE_ID = '94c0b6ee-2ee4-421f-a9e8-d1fa38a352a9'
const CORE_PATHS = ['/hotelpms/api/v1/report/jd01', '/hotelpms/api/v1/report/lion/manager/workbench/room',
  '/hotelpms/api/v1/report/home/workbench/businessOverview']
const fail = code => { throw new Error(`PMS_FORECAST_SETUP_${code}`) }
const safeName = value => typeof value === 'string' && value === value.trim() && value.length > 0 && value.length <= 80
  && !/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufeff]/u.test(value)
const numberValue = value => typeof value === 'number' && Number.isFinite(value) ? value
  : typeof value === 'string' && /^-?\d+(?:\.\d+)?$/u.test(value) && Number.isFinite(Number(value)) ? Number(value) : null
const day = value => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}(?: 00:00:00)?$/u.test(value)) return null
  const date = value.slice(0, 10)
  const parsed = new Date(`${date}T00:00:00Z`)
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date ? date : null
}
const addDays = (value, count) => new Date(new Date(`${value}T00:00:00Z`).getTime() + count * 86_400_000).toISOString().slice(0, 10)

export const bieyanghongForecastSetupCandidate = (hotel, sources) => {
  if (hotel?.pmsSystemCode !== 'MEITUAN_BIEYANGHONG' || !hotel.pmsChangedAt || !hotel.collectionEnabled
    || !Array.isArray(sources) || sources.length !== 4) return null
  const candidate = sources.find(source => source.sourceId === FORECAST_SOURCE_ID)
  if (!candidate || candidate.endpointUrl !== BIEYANGHONG_FORECAST_ENDPOINT || candidate.enabled !== false
    || candidate.reportType !== 'PHYSICAL_INVENTORY' || candidate.calculationRole !== 'PRIMARY_CALCULATION'
    || typeof candidate.requestPayloadJson !== 'string' || candidate.requestPayloadJson.trim() !== '') return null
  const enabled = sources.filter(source => source.enabled)
  if (enabled.length !== 3 || CORE_PATHS.some(path => enabled.filter(source => source.endpointUrl === `https://pms.meituan.com${path}`).length !== 1)) return null
  return candidate
}

const cookieValue = (cookie, key) => {
  if (typeof cookie !== 'string' || Buffer.byteLength(cookie, 'utf8') > 16 * 1024 || /[\r\n\u0000]/u.test(cookie)) fail('COOKIE_SCOPE_INVALID')
  const values = cookie.split(';').map(part => part.trim()).filter(part => part.startsWith(`${key}=`)).map(part => part.slice(key.length + 1).trim())
  if (!values.length || values.some(value => !value) || new Set(values).size !== 1) fail('COOKIE_SCOPE_INVALID')
  return values[0]
}
const readCatalogJson = async response => {
  if (!response.ok || !response.body) fail('CATALOG_UNAVAILABLE')
  const reader = response.body.getReader()
  const chunks = []
  let length = 0
  try {
    while (true) {
      const item = await reader.read()
      if (item.done) break
      length += item.value.byteLength
      if (length > 2 * 1024 * 1024) { await reader.cancel(); fail('CATALOG_TOO_LARGE') }
      chunks.push(Buffer.from(item.value))
    }
  } finally { reader.releaseLock() }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')) } catch { fail('CATALOG_INVALID') }
}

export const parseBieyanghongRoomCatalog = root => {
  const list = root?.data?.list
  const page = root?.data?.pageInfo
  if (root?.code !== 10000 || !Array.isArray(list) || !page || !Number.isInteger(page.totalCount)
    || page.totalCount < 1 || page.totalCount > 100 || page.totalCount !== list.length
    || page.currentPageNum !== 1 || page.totalPageCount !== 1
    || !Number.isInteger(page.pageSize) || page.pageSize < list.length || page.pageSize > 100) fail('CATALOG_INCOMPLETE')
  const codes = new Set(), names = new Set()
  const catalog = list.map(row => {
    // row.id is a database identifier. Only the observed business code
    // roomTypeId is accepted by this vendor's forecasting endpoint.
    if (!row || row.isActive !== true || typeof row.roomTypeId !== 'string'
      || !/^[A-Za-z0-9_-]{1,40}$/u.test(row.roomTypeId) || !safeName(row.roomTypeName)
      || !Number.isSafeInteger(row.roomCount) || row.roomCount < 0
      || codes.has(row.roomTypeId) || names.has(row.roomTypeName)) fail('CATALOG_INVALID')
    codes.add(row.roomTypeId); names.add(row.roomTypeName)
    return { id: row.roomTypeId, roomTypeName: row.roomTypeName, roomCount: row.roomCount }
  })
  const totalRoomCount = catalog.reduce((sum, row) => sum + row.roomCount, 0)
  if (!Number.isSafeInteger(totalRoomCount) || totalRoomCount < 1) fail('CATALOG_INVALID')
  return catalog
}

export const validateBieyanghongForecastShadow = ({ catalog, result, forecastRoot, physicalRoot, sourceCount }) => {
  const date = day(result?.snapshot?.businessDate)
  if (!date || result?.run?.status !== 'SUCCEEDED' || result.run.sourceCount !== sourceCount
    || result.run.successfulSourceCount !== sourceCount || result.snapshot.completeness !== 'COMPLETE') fail('SHADOW_INCOMPLETE')
  const physical = Array.isArray(physicalRoot?.data) ? physicalRoot.data : physicalRoot?.data?.dataList
  if (!Array.isArray(physical) || physical.length !== catalog.length) fail('CATALOG_INVENTORY_MISMATCH')
  const physicalNames = new Set()
  for (const row of physical) {
    const matching = catalog.find(room => room.roomTypeName === row?.roomName)
    if (!matching || physicalNames.has(row.roomName) || numberValue(row.roomNum) !== matching.roomCount) fail('CATALOG_INVENTORY_MISMATCH')
    physicalNames.add(row.roomName)
  }
  if (!Array.isArray(forecastRoot?.data) || forecastRoot.data.length > catalog.length + 1) fail('FORECAST_INCOMPLETE')
  const rows = forecastRoot.data.filter(row => row?.isAggregation !== true)
  if (rows.length !== catalog.length) fail('FORECAST_INCOMPLETE')
  const names = new Set(), totalsByDay = new Map()
  let completeDates = null
  for (const row of rows) {
    const matching = catalog.find(room => room.roomTypeName === row?.roomTypeName)
    if (!matching || names.has(row.roomTypeName) || numberValue(row.totalCount) !== matching.roomCount
      || (row.roomTypeId !== undefined && row.roomTypeId !== matching.id)
      || !Array.isArray(row.details) || row.details.length < 15 || row.details.length > 30) fail('FORECAST_INCOMPLETE')
    names.add(row.roomTypeName)
    const dates = new Set()
    for (const detail of row.details) {
      const stayDate = day(detail?.date)
      const available = numberValue(detail?.availableCount), occupied = numberValue(detail?.occupationCount)
      const orders = numberValue(detail?.orderCount), checkins = numberValue(detail?.checkinCount)
      const fee = numberValue(detail?.roomRent)
      if (!stayDate || stayDate < date || stayDate > addDays(date, 29) || dates.has(stayDate)
        || !Number.isSafeInteger(available) || !Number.isSafeInteger(occupied) || occupied < 0
        || !Number.isSafeInteger(orders) || orders < 0 || !Number.isSafeInteger(checkins) || checkins < 0 || fee === null) fail('FORECAST_INCOMPLETE')
      dates.add(stayDate)
      const total = totalsByDay.get(stayDate) ?? { availableRooms: 0, soldRooms: 0, orderRooms: 0, checkinRooms: 0, roomFee: 0 }
      total.availableRooms += available; total.soldRooms += occupied; total.orderRooms += orders
      total.checkinRooms += checkins; total.roomFee += fee
      if (![total.availableRooms, total.soldRooms, total.orderRooms, total.checkinRooms].every(Number.isSafeInteger)
        || !Number.isFinite(total.roomFee)) fail('FORECAST_INCOMPLETE')
      totalsByDay.set(stayDate, total)
    }
    for (let index = 0; index <= 14; index += 1) if (!dates.has(addDays(date, index))) fail('FORECAST_INCOMPLETE')
    if (completeDates && (dates.size !== completeDates.size || [...dates].some(value => !completeDates.has(value)))) fail('FORECAST_INCOMPLETE')
    completeDates ??= dates
  }
  const snapshotRooms = result.snapshot.roomForecast
  if (!Array.isArray(snapshotRooms) || snapshotRooms.length !== catalog.length
    || catalog.some(room => snapshotRooms.filter(row => row.displayName === room.roomTypeName
      && row.physicalRoomCount === room.roomCount).length !== 1)) fail('SHADOW_INCOMPLETE')
  const future = result.snapshot.futureDaily
  for (const stayDate of [...completeDates].filter(value => value > date)) {
    const matches = Array.isArray(future) ? future.filter(row => row.stayDate === stayDate) : []
    const expected = totalsByDay.get(stayDate)
    if (matches.length !== 1 || matches[0].availableRooms !== expected.availableRooms
      || matches[0].soldRooms !== expected.soldRooms || matches[0].orderRooms !== expected.orderRooms
      || matches[0].checkinRooms !== expected.checkinRooms || numberValue(matches[0].roomFee) === null
      || Math.abs(matches[0].roomFee - expected.roomFee) > 0.011) fail('SHADOW_INCOMPLETE')
  }
  return { roomTypeCount: catalog.length, physicalRoomCount: catalog.reduce((sum, row) => sum + row.roomCount, 0), verifiedFutureDays: 14 }
}

export const prepareBieyanghongForecastSources = async ({ hotel, sources, cookiesBySourceId, expectedHotelId,
  reportDate, secretKey, legacySecretKey = null, fetchImpl = fetch, collectImpl = collectLiveReports }) => {
  const candidate = bieyanghongForecastSetupCandidate(hotel, sources)
  if (!candidate || !/^[1-9][0-9]{0,63}$/u.test(expectedHotelId ?? '')) fail('NOT_ELIGIBLE')
  const cookie = cookiesBySourceId[candidate.sourceId]
  if (cookieValue(cookie, 'hotelpms_login_hotel_id') !== expectedHotelId) fail('COOKIE_SCOPE_INVALID')
  const clientId = cookieValue(cookie, '_lxsdk_cuid')
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 10_000)
  let root
  try {
    root = await readCatalogJson(await fetchImpl(BIEYANGHONG_ROOM_CATALOG_ENDPOINT, {
      method: 'POST', redirect: 'error', signal: controller.signal, body: '{}',
      headers: { Accept: 'application/json, text/plain, */*', Cookie: cookie,
        'Content-Type': 'application/json;charset=UTF-8', Origin: 'https://pms.meituan.com', Referer: 'https://pms.meituan.com/',
        'hotelpms-client-id': clientId, 'hotelpms-platform': 'pc', 'm-appkey': 'fe_com.sankuai.hotelpms.fe.web' },
    }))
  } catch (error) {
    if (/^PMS_FORECAST_SETUP_[A-Z_]+$/u.test(String(error?.message ?? ''))) throw error
    fail('CATALOG_UNAVAILABLE')
  } finally { clearTimeout(timeout) }
  const catalog = parseBieyanghongRoomCatalog(root)
  const nextSources = sources.map(source => source !== candidate ? source : ({ ...source, enabled: true,
    requestPayloadJson: JSON.stringify({ roomTypes: catalog.map(({ id, roomTypeName }) => ({ id, roomTypeName })),
      beginHour: '18:00', channelKey: 'Hotel' }), rowVersion: source.rowVersion + 1 }))
  let forecastRoot, physicalRoot
  const physicalSource = sources.find(source => source.endpointUrl.endsWith('/lion/manager/workbench/room'))
  const result = await collectImpl({ hotel, sources: nextSources, cookiesBySourceId, previousSnapshots: [],
    secretKey, legacySecretKey, reportDate, fetchImpl,
    onSourceResponse: ({ sourceId, payload }) => {
      if (sourceId === candidate.sourceId) forecastRoot = payload
      if (sourceId === physicalSource.sourceId) physicalRoot = payload
    } })
  const verification = validateBieyanghongForecastShadow({ catalog, result, forecastRoot, physicalRoot,
    sourceCount: nextSources.filter(source => source.enabled).length })
  return { sources: nextSources, ...verification }
}

export const safeBieyanghongForecastSetupError = error => /^PMS_FORECAST_SETUP_[A-Z_]+$/u.test(String(error?.message ?? ''))
  ? error.message : 'PMS_FORECAST_SETUP_VALIDATION_FAILED'

export const bieyanghongForecastRepairTickAllowed = time => {
  const date = new Date(time)
  if (!Number.isFinite(date.getTime())) return false
  const minute = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Shanghai', minute: '2-digit' }).format(date))
  return minute >= 6 && minute <= 54
}

export const createBieyanghongForecastSetupScheduler = ({ enabled, hotels, eligible, fingerprint, busy, collect, onFailure,
  shouldRunRepairTick = bieyanghongForecastRepairTickAllowed, now = () => Date.now() }) => {
  const attempts = new Map()
  let running = false
  return async () => {
    if (!enabled() || running || !shouldRunRepairTick(now())) return
    running = true
    try {
      for (const hotel of hotels()) {
        if (!shouldRunRepairTick(now())) break
        if (!eligible(hotel) || busy(hotel)) continue
        const key = fingerprint(hotel), last = attempts.get(hotel.hotelId), time = now()
        if (last?.key === key && time - last.at < 15 * 60_000) continue
        attempts.set(hotel.hotelId, { key, at: time })
        try { await collect(hotel) } catch (error) { onFailure(hotel, safeBieyanghongForecastSetupError(error)) }
      }
    } finally { running = false }
  }
}
