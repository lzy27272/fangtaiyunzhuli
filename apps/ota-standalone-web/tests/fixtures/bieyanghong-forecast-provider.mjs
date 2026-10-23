import { appendFileSync, readFileSync } from 'node:fs'

export const forecastFixtureDate = '2026-10-23'
export const forecastFixtureCatalog = () => [
  ['DCF', '合成大床房', 29], ['SCF', '合成双床房', 25], ['TF', '合成套房', 8], ['QZPCF', '合成亲子房', 9],
].map(([roomTypeId, roomTypeName, roomCount], index) => ({ id: `123456789012345678${index}`, roomTypeId, roomTypeName, roomCount, isActive: true }))
export const forecastFixtureSources = () => [
  ['34000000-0000-4000-8000-000000000001', '/hotelpms/api/v1/report/jd01', 'ORDER_DETAIL'],
  ['34000000-0000-4000-8000-000000000002', '/hotelpms/api/v1/report/lion/manager/workbench/room', 'PHYSICAL_INVENTORY'],
  ['27f5ead0-11a3-4131-87ce-7ba9d7ff0ce0', '/hotelpms/api/v1/report/home/workbench/businessOverview', 'CUSTOM_REPORT'],
  ['94c0b6ee-2ee4-421f-a9e8-d1fa38a352a9', '/hotelpms/api/v2/report/roomState/batchSearchBaseRoomForcasting', 'PHYSICAL_INVENTORY'],
].map(([sourceId, path, reportType], index) => ({ sourceId, endpointUrl: `https://pms.meituan.com${path}`,
  reportType, displayName: `Synthetic source ${index}`, calculationRole: 'PRIMARY_CALCULATION',
  credentialAlias: '', requestPayloadJson: '', enabled: index !== 3, rowVersion: 1, pollIntervalMinutes: 60, validationStatus: 'FORMAT_VALID' }))
export const forecastFixtureCookie = (id = '9009') => `hotelpms_login_hotel_id=${id}; hotelpms_login_org_id=900; hotelpms_tenant_id=90; hotelpms_token=example-forecast-test-token; _lxsdk_cuid=example-client-id`
export const createForecastProvider = ({ state = () => ({}), requests = [] } = {}) => async (input, options) => {
  const url = new URL(String(input))
  if (url.hostname !== 'pms.meituan.com') throw new Error('EXAMPLE_EXTERNAL_NETWORK_BLOCKED')
  const current = state()
  const body = options?.body ? JSON.parse(options.body) : null
  requests.push({ path: url.pathname, body })
  if (process.env.FORECAST_SETUP_TEST_SPY_PATH) appendFileSync(process.env.FORECAST_SETUP_TEST_SPY_PATH,
    `${JSON.stringify({ path: url.pathname, body })}\n`)
  const catalog = forecastFixtureCatalog()
  let data
  if (url.pathname === '/hotelpms/api/v1/property/roomType/search') {
    if (current.delayMs) await new Promise(resolve => setTimeout(resolve, current.delayMs))
    data = { list: catalog, pageInfo: { currentPageNum: 1, pageSize: 10, totalPageCount: 1, totalCount: 4 } }
    if (current.variant === 'PAGED') data.pageInfo.totalPageCount = 2
    if (current.variant === 'DUPLICATE_CODE') data.list[1].roomTypeId = data.list[0].roomTypeId
    if (current.variant === 'DUPLICATE_NAME') data.list[1].roomTypeName = data.list[0].roomTypeName
    if (current.variant === 'INACTIVE') data.list[0].isActive = false
  } else if (url.pathname === '/hotelpms/api/v1/night/audit/businessDate/detail') {
    data = { businessDate: forecastFixtureDate }
  } else if (url.pathname.endsWith('/report/jd01')) {
    data = { dataList: [] }
  } else if (url.pathname.endsWith('/workbench/businessOverview')) {
    data = { estimatedRoomAmt: 1000, estimatedRoomNights: 40, estimatedAvgRoomPrice: 25, estimatedRevPAR: 14 }
  } else if (url.pathname.endsWith('/lion/manager/workbench/room')) {
    data = catalog.map(room => ({ roomName: room.roomTypeName, roomNum: room.roomCount, availableRoomNum: 1,
      estimatedRoomNights: room.roomCount - 1, estimatedRoomAmt: 100, estimatedAvgRoomPrice: 10 }))
    if (current.variant === 'INVENTORY_MISMATCH') data[0].roomNum = 0
  } else if (url.pathname.endsWith('/batchSearchBaseRoomForcasting')) {
    data = catalog.map(room => ({ roomTypeName: room.roomTypeName, totalCount: String(room.roomCount),
      details: Array.from({ length: 30 }, (_, index) => ({
        date: `${new Date(new Date(`${forecastFixtureDate}T00:00:00Z`).getTime() + index * 86_400_000).toISOString().slice(0, 10)} 00:00:00`,
        availableCount: '1', occupationCount: String(room.roomCount - 1), roomRent: '100', orderCount: '1', checkinCount: '0',
        adr: '10', revPar: '5', overbookingCount: '0', maintainingCount: '0',
      })) }))
    if (current.variant === 'FALSE_ZERO') data.forEach(room => { room.totalCount = '0'; room.details.forEach(detail => { detail.availableCount = '0'; detail.occupationCount = '0' }) })
    if (current.variant === 'MISSING_DAY') data[0].details.splice(10, 1)
    if (current.variant === 'MISSING_LATE_DAY') data[0].details.splice(20, 1)
    if (current.variant === 'DUPLICATE_DAY') data[0].details[10] = { ...data[0].details[9] }
    if (current.variant === 'NULL_AVAILABLE') data[0].details[10].availableCount = null
    if (current.variant === 'NULL_ORDER') data[0].details[20].orderCount = null
    if (current.variant === 'NULL_CHECKIN') data[0].details[10].checkinCount = null
    if (current.variant === 'NULL_FEE') data[0].details[10].roomRent = null
    if (current.variant === 'OVERFLOW') data.forEach(room => room.details.forEach(detail => { detail.occupationCount = String(Number.MAX_SAFE_INTEGER) }))
    data.push({ isAggregation: true, roomTypeName: '合计', totalCount: '71', details: [] })
  } else throw new Error('EXAMPLE_UNOBSERVED_ENDPOINT_BLOCKED')
  return new Response(JSON.stringify({ code: 10000, data, error: null }), { status: 200, headers: { 'Content-Type': 'application/json' } })
}

if (process.env.FORECAST_SETUP_TEST_STATE_PATH) {
  const original = globalThis.fetch
  const provider = createForecastProvider({ state: () => JSON.parse(readFileSync(process.env.FORECAST_SETUP_TEST_STATE_PATH, 'utf8')) })
  globalThis.fetch = (input, options) => {
    const url = new URL(String(input))
    return ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) ? original(input, options) : provider(input, options)
  }
}
