import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import {
  prepareBieyanghongForecastSources, bieyanghongForecastSetupCandidate,
  createBieyanghongForecastSetupScheduler, bieyanghongForecastRepairTickAllowed, parseBieyanghongRoomCatalog,
} from '../../../tools/uat/bieyanghong-forecast-autoconfig.mjs'
import { createForecastProvider, forecastFixtureSources, forecastFixtureCookie, forecastFixtureCatalog } from './fixtures/bieyanghong-forecast-provider.mjs'

const hotel = { hotelId: 'example-hotel-009', tenantId: 'example-tenant', hotelName: 'Local alias',
  pmsSystemCode: 'MEITUAN_BIEYANGHONG', pmsChangedAt: '2026-10-22T00:00:00Z', collectionEnabled: true }
const sources = forecastFixtureSources()
const command = extra => ({ hotel, sources, expectedHotelId: '9009',
  cookiesBySourceId: Object.fromEntries(sources.map(source => [source.sourceId, forecastFixtureCookie()])),
  secretKey: Buffer.alloc(32, 19).toString('base64url'), reportDate: '2026-10-22', ...extra })

test('official same-store catalog business codes safely enable a real four-source shadow forecast', async () => {
  const requests = []
  const result = await prepareBieyanghongForecastSources(command({ fetchImpl: createForecastProvider({ requests }) }))
  assert.equal(result.roomTypeCount, 4)
  assert.equal(result.physicalRoomCount, 71)
  assert.equal(result.verifiedFutureDays, 14)
  assert.equal(result.sources[3].enabled, true)
  assert.equal(sources[3].enabled, false)
  assert.equal(result.sources[3].rowVersion, 2)
  assert.deepEqual(JSON.parse(result.sources[3].requestPayloadJson).roomTypes.map(row => row.id), ['DCF', 'SCF', 'TF', 'QZPCF'])
  assert.doesNotMatch(result.sources[3].requestPayloadJson, /123456789012345678/)
  assert.deepEqual(requests[0], { path: '/hotelpms/api/v1/property/roomType/search', body: {} })
  const forecast = requests.find(request => request.path.endsWith('/batchSearchBaseRoomForcasting'))
  assert.equal(forecast.body.beginDate, '2026-10-23 00:00:00', 'PMS-confirmed date controls the shadow request')
  assert.deepEqual(forecast.body.roomTypes.map(row => row.id), ['DCF', 'SCF', 'TF', 'QZPCF'])
  assert.ok(requests.every(request => !/webhook|send|login/iu.test(request.path)))
})

test('catalog scope, complete single-page metadata, active identities and uniqueness fail closed before shadow access', async () => {
  const overflowCatalog = forecastFixtureCatalog().map(room => ({ ...room, roomCount: Number.MAX_SAFE_INTEGER }))
  assert.throws(() => parseBieyanghongRoomCatalog({ code: 10000, data: { list: overflowCatalog,
    pageInfo: { currentPageNum: 1, pageSize: 10, totalPageCount: 1, totalCount: 4 } } }), /PMS_FORECAST_SETUP_CATALOG_INVALID/)
  for (const variant of ['PAGED', 'DUPLICATE_CODE', 'DUPLICATE_NAME', 'INACTIVE']) {
    const requests = []
    await assert.rejects(prepareBieyanghongForecastSources(command({ fetchImpl: createForecastProvider({ requests, state: () => ({ variant }) }) })), /PMS_FORECAST_SETUP_CATALOG_/)
    assert.equal(requests.length, 1)
  }
  for (const cookie of [forecastFixtureCookie('9010'), `${forecastFixtureCookie()}; hotelpms_login_hotel_id=9010`]) {
    const requests = []
    await assert.rejects(prepareBieyanghongForecastSources(command({ cookiesBySourceId: Object.fromEntries(sources.map(source => [source.sourceId, cookie])),
      fetchImpl: createForecastProvider({ requests }) })), /PMS_FORECAST_SETUP_COOKIE_SCOPE_INVALID/)
    assert.equal(requests.length, 0)
  }
})

test('false four-of-four zero data and every partial per-room/date/aggregate field must not enable forecasting', async () => {
  for (const variant of ['FALSE_ZERO', 'MISSING_DAY', 'MISSING_LATE_DAY', 'DUPLICATE_DAY', 'NULL_AVAILABLE', 'NULL_ORDER', 'NULL_CHECKIN', 'NULL_FEE', 'INVENTORY_MISMATCH', 'OVERFLOW']) {
    await assert.rejects(prepareBieyanghongForecastSources(command({ fetchImpl: createForecastProvider({ state: () => ({ variant }) }) })),
      /PMS_FORECAST_SETUP_(?:FORECAST_INCOMPLETE|CATALOG_INVENTORY_MISMATCH)/, variant)
    assert.equal(sources[3].enabled, false)
    assert.equal(sources[3].requestPayloadJson, '')
  }
})

test('eligibility never overrides old stores, another manufacturer, paused stores or custom disabled payloads', () => {
  for (const changed of [{ pmsChangedAt: undefined }, { pmsSystemCode: 'LUOPAN_CLOUD' }, { collectionEnabled: false }]) {
    assert.equal(bieyanghongForecastSetupCandidate({ ...hotel, ...changed }, sources), null)
  }
  for (const changed of [{ enabled: true }, { requestPayloadJson: '{}' }, { sourceId: 'example-custom-source' }]) {
    assert.equal(bieyanghongForecastSetupCandidate(hotel, sources.map((source, index) => index === 3 ? { ...source, ...changed } : source)), null)
  }
})

test('repair scheduler honors global/slot/busy gates, coalesces overlap, cools failures 15 minutes and succeeds once', async () => {
  let time = Date.parse('2026-10-23T02:10:00Z'), enabled = false, busy = false, key = 'v1', ready = false
  let calls = 0, errors = 0
  const tick = createBieyanghongForecastSetupScheduler({ enabled: () => enabled, hotels: () => [hotel], eligible: () => !ready,
    fingerprint: () => key, busy: () => busy, now: () => time,
    collect: async () => { calls += 1; if (calls < 3) throw new Error('example-not-a-secret'); ready = true },
    onFailure: (_hotel, code) => { errors += 1; assert.equal(code, 'PMS_FORECAST_SETUP_VALIDATION_FAILED') } })
  await tick(); assert.equal(calls, 0)
  enabled = true; busy = true; await tick(); assert.equal(calls, 0)
  busy = false; await tick(); assert.equal(calls, 1)
  time += 30_000; await tick(); assert.equal(calls, 1)
  time += 15 * 60_000; await tick(); assert.equal(calls, 2)
  key = 'v2'; await Promise.all([tick(), tick()]); assert.equal(calls, 3)
  await tick(); assert.equal(calls, 3); assert.equal(errors, 2)
  for (const minute of [0, 5, 55, 59]) assert.equal(bieyanghongForecastRepairTickAllowed(Date.parse(`2026-10-23T02:${String(minute).padStart(2, '0')}:00Z`)), false)
  for (const minute of [6, 54]) assert.equal(bieyanghongForecastRepairTickAllowed(Date.parse(`2026-10-23T02:${String(minute).padStart(2, '0')}:00Z`)), true)
  let lateTime = Date.parse('2026-10-23T02:54:59Z'), lateCalls = 0
  const lateTick = createBieyanghongForecastSetupScheduler({ enabled: () => true, hotels: () => [hotel, { ...hotel, hotelId: 'example-second-hotel' }],
    eligible: () => true, fingerprint: () => 'v1', busy: () => false, now: () => lateTime,
    collect: async () => { lateCalls += 1; lateTime += 2_000 }, onFailure: () => assert.fail('unexpected failure') })
  await lateTick(); assert.equal(lateCalls, 1, 'a later hotel must not start after the allowed repair slot closes')
})

test('publisher includes the auto-configuration runtime module', async () => {
  const publisher = await readFile(new URL('../../../infra/ota-standalone-server/scripts/Publish-OtaStandaloneServer.ps1', import.meta.url), 'utf8')
  assert.match(publisher, /'tools\/uat\/bieyanghong-forecast-autoconfig\.mjs'/u)
})
