import test from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { runInNewContext } from 'node:vm'
import { CTRIP_DATA_RECIPES, ctripDataWindow, windowDays, normalizeCtripCatalog, normalizeCtripInventory,
  normalizeCtripReviews, ctripOrderQuery, normalizeCtripOrderPage, aggregateCtripOrders, normalizeCtripTraffic } from '../../../tools/labs/ota-browser/ctrip-data-contract.mjs'
import { collectCtripData, fetchCtripData, ctripDataQueryMatches } from '../../../tools/labs/ota-browser/ctrip-data-engine.mjs'
import { createCtripDataStore } from '../../../tools/labs/ota-browser/ctrip-data-store.mjs'

const hotelId = '1234567', internalId = '7654321', profileId = `ctrip-${'a'.repeat(32)}`
const now = () => new Date('2026-09-18T12:00:00.000Z')
const window = ctripDataWindow(now())
const soa = patch => ({ resStatus: { rcode: 200 }, ResponseStatus: { Ack: 'Success' }, ...patch })
const catalogRoot = () => ({ code: 200, data: [{ basicRoomTypeID: 100, roomName: '合成&#25151;&#22411;',
  sonBasicRoomIDList: [101], enableBasicRoomQuantity: false,
  roomInfos: [{ hotelID: Number(internalId), roomTypeID: 200, roomClass: 200, payType: 'PP' }] }] })
const inventoryRoot = body => ({ code: 200, data: '<script>never return source HTML</script>',
  otherData: windowDays(body).map(date => ({ effectDate: date, roomTypeID: 100, roomStatus: 'ROOMED',
    enableBasicRoomQuantity: false, canUsedQuantity: 0, soldRoomQuantity: null, roomQuantity: 10 })) })
const rating = () => soa({ ctripRatings: { ratingAll: 4.8, ratingLocation: 4.8, ratingFacility: 4.7, ratingService: 4.9, ratingRoom: 4.8 } })
const reviews = () => soa({ ctripCount: { commentCount: 100, noRecommendCount: 1, unReplyCount: 2, hasPicCount: 30, goodRate: 0.99, responseRate: 0.98 } })
const order = (index, patch = {}) => ({ hotel: internalId, sourceType: 'Ebooking', orderId: String(1000 + index),
  formId: String(2000 + index), orderDate: '2026-09-17', arrival: '2026-09-17 00:00:00',
  formDateOriginal: '2026-09-17 10:00:00', quantity: 1, liveDays: '2', orderStatus: 100,
  orderStatusType: 'Receipt', clientName: 'PRIVATE-GUEST-MUST-NOT-PERSIST', token: 'SECRET-SOURCE-TOKEN', ...patch })
const trafficRoot = () => ({ rcode: 0, data: {
  effectDateList: windowDays(window).map(d => d.slice(5)),
  ...Object.fromEntries(['pvDataList', 'uvDataList', 'orderDataList', 'conversionsRatesDataList'].map(k => [k, Array(30).fill(10)])),
} })
const fixture = (options = {}) => {
  const recipes = [], calls = [], progress = []
  let scopeChecks = 0, discoveries = 0
  const read = async (page, recipe, body) => {
    calls.push({ id: recipe.id, body })
    const override = await options.read?.(recipe.id, body, calls)
    if (override !== undefined) return override
    if (recipe.id === 'catalog') return catalogRoot()
    if (recipe.id === 'inventory') return inventoryRoot(body)
    if (recipe.id === 'rating') return rating()
    if (recipe.id === 'reviews') return reviews()
    if (recipe.id === 'reviewScope') return soa({ masterHotelId: hotelId, commentlist: [{ text: 'PRIVATE-REVIEW' }] })
    if (recipe.id === 'liveTraffic') return { visitorTotal: 40, competitorAvgNumber: 30, visitorRank: 3, lastVisitorTotal: 50 }
    if (recipe.id === 'traffic') return trafficRoot()
    if (recipe.id === 'orders') {
      const index = body.orderQueryCondition.pageInfo.pageIndex
      return soa({ total: 21, orderList: Array.from({ length: index ? 1 : 20 }, (_, i) => order(index * 20 + i)) })
    }
    throw new Error('UNEXPECTED_RECIPE')
  }
  return { recipes, calls, progress, scopeChecks: () => scopeChecks, discoveries: () => discoveries,
    run: () => collectCtripData({ page: {}, hotelId, profileId, now, read,
      assertScope: async () => { scopeChecks++; await options.assertScope?.(scopeChecks) },
      saveRecipe: async r => recipes.push(r), progress: v => progress.push(v), pace: async () => {},
      discover: async () => { discoveries++; return options.discover?.() }, maxPages: options.maxPages ?? 5 }) }
}

test('30 complete days use Shanghai midnight across years and leap days', () => {
  assert.deepEqual(window, { timezone: 'Asia/Shanghai', startDate: '2026-08-19', endDate: '2026-09-17', today: '2026-09-18' })
  assert.equal(ctripDataWindow(new Date('2026-09-17T15:59:59Z')).today, '2026-09-17')
  assert.equal(ctripDataWindow(new Date('2026-09-17T16:00:00Z')).today, '2026-09-18')
  assert.equal(windowDays(ctripDataWindow(new Date('2024-03-01T00:00:00Z'))).at(-1), '2024-02-29')
  assert.equal(windowDays(ctripDataWindow(new Date('2026-01-01T00:00:00Z'))).length, 30)
})

test('catalog establishes product hotel scope and inventory disabled zero stays unavailable', () => {
  const catalog = normalizeCtripCatalog(catalogRoot()), room = catalog.rooms[0]
  assert.deepEqual(catalog.hotelIds, [internalId])
  assert.equal(room.name, '合成房型')
  const scope = { startDate: window.today, endDate: window.today }
  const inventory = normalizeCtripInventory(inventoryRoot(scope), room, scope)
  assert.equal(inventory.days[0].available, null)
  assert.equal(inventory.days[0].sold, null)
  assert.equal(inventory.days[0].status, 'ROOMED')
  assert.equal(JSON.stringify(inventory).includes('<script>'), false)
  const foreign = inventoryRoot(scope); foreign.otherData[0].roomTypeID = 999
  assert.throws(() => normalizeCtripInventory(foreign, room, scope), /SCOPE_MISMATCH/)
  const missing = inventoryRoot(scope); missing.otherData = []
  assert.throws(() => normalizeCtripInventory(missing, room, scope), /SCHEMA_CHANGED/)
})

test('reviews are cumulative, bounded and scoped; private review text never leaves projection', () => {
  const scope = soa({ masterHotelId: hotelId, commentlist: [{ text: 'PRIVATE-REVIEW' }] })
  const data = normalizeCtripReviews(rating(), reviews(), scope, hotelId)
  assert.equal(data.scope, 'CURRENT_CUMULATIVE')
  assert.equal(data.total, 100)
  assert.equal(JSON.stringify(data).includes('PRIVATE'), false)
  assert.throws(() => normalizeCtripReviews(rating(), reviews(), scope, internalId), /SCOPE_MISMATCH/)
  const corrupt = reviews(); corrupt.ctripCount.goodRate = 99
  assert.throws(() => normalizeCtripReviews(rating(), corrupt, scope, hotelId), /SCHEMA_CHANGED/)
})

test('orders never infer effectiveness from numeric 100 and unknown statuses fail completeness', () => {
  const page = normalizeCtripOrderPage(soa({ total: 3, orderList: [order(0), order(1, { orderStatusType: 'Canceled' }), order(2, { orderStatusType: 'NewStatus' })] }), [internalId], 'OrderDate', window)
  const result = aggregateCtripOrders(page.rows, { total: 3, fetched: 3, pages: 1, complete: true, basis: 'OrderDate', window })
  assert.equal(result.effectiveOrders, 1); assert.equal(result.excludedOrders, 1); assert.equal(result.unknownOrders, 1)
  assert.equal(result.roomNights, 2); assert.equal(result.complete, false); assert.equal(result.paginationComplete, true)
  for (const privateValue of ['PRIVATE', 'SECRET', 'formId', 'orderId', 'clientName']) assert.equal(JSON.stringify(result).includes(privateValue), false)
})

test('original booking dates are locally filtered; duplicate order changes count only latest', () => {
  const root = soa({ total: 4, orderList: [order(0), order(1, { orderId: '1000', orderStatusType: 'Canceled', formDateOriginal: '2026-09-17 11:00:00' }),
    order(2, { orderDate: '2026-08-14' }), order(3, { orderDate: '2026-09-18' })] })
  const page = normalizeCtripOrderPage(root, [internalId], 'OrderDate', window)
  const result = aggregateCtripOrders(page.rows, { total: 4, fetched: 4, pages: 1, complete: true, basis: 'OrderDate', window })
  assert.equal(result.uniqueOrders, 3); assert.equal(result.effectiveOrders, 0); assert.equal(result.excludedOrders, 1)
  assert.equal(result.outsideWindowOrders, 2)
  assert.throws(() => normalizeCtripOrderPage(soa({ total: 1, orderList: [order(0, { arrival: '2026-09-18' })] }), [internalId], 'ArrivalDate', window), /DATE_MISMATCH/)
  assert.throws(() => normalizeCtripOrderPage(soa({ total: 1, orderList: [order(0, { hotel: hotelId })] }), [internalId], 'OrderDate', window), /SCOPE_MISMATCH/)
})

test('Changed orders count as excluded only when the provider explicitly identifies an invalid old order', () => {
  for (const [patch, known] of [[{ orderType: 'S', orderTypeDesc: '无效' }, true], [{ orderType: 'F', orderTypeDesc: '预订' }, false], [{}, false]]) {
    const page = normalizeCtripOrderPage(soa({ total: 1, orderList: [order(0, { orderStatusType: 'Changed', ...patch })] }), [internalId], 'OrderDate', window)
    assert.equal(page.rows[0].known, known); assert.equal(page.rows[0].effective, false)
  }
})

test('traffic preserves nulls and requires exact 30-day alignment, not relative 31-day quick filter', () => {
  const root = trafficRoot(); root.data.uvDataList[0] = null
  const data = normalizeCtripTraffic(root, window)
  assert.equal(data.length, 30); assert.equal(data[0].visitors, null)
  root.data.effectDateList[0] = '08-18'
  assert.throws(() => normalizeCtripTraffic(root, window), /DATE_MISMATCH/)
})

test('full collector produces both bases, complete pagination, only safe summaries and metadata', async () => {
  const run = fixture(), result = await run.run()
  assert.equal(result.status, 'COMPLETE'); assert.equal(result.verifiedRecipeCount, 8)
  assert.equal(result.datasets.ordersByBooking.data.effectiveOrders, 21)
  assert.equal(result.datasets.ordersByArrival.data.roomNights, 42)
  assert.ok(run.scopeChecks() >= run.calls.length * 2)
  const orderCalls = run.calls.filter(c => c.id === 'orders')
  assert.equal(orderCalls[0].body.orderQueryCondition.dateEnd, window.today)
  assert.equal(orderCalls.at(-1).body.orderQueryCondition.dateEnd, window.endDate)
  assert.equal(run.discoveries(), 0)
  const encoded = JSON.stringify({ result, recipes: run.recipes })
  for (const privateValue of ['PRIVATE', 'SECRET', 'reqHead', 'spiderkey', 'cookie', 'password']) assert.equal(encoded.includes(privateValue), false)
})

test('source errors rediscover once per endpoint; unknown schema cannot silently activate', async () => {
  const run = fixture({ read: async id => id === 'reviews' ? {} : undefined })
  const result = await run.run()
  assert.equal(result.status, 'PARTIAL'); assert.equal(result.datasets.reviews.status, 'FAILED')
  assert.equal(run.discoveries(), 1)
  assert.equal(run.recipes.some(r => r.id === 'reviews'), false)
})

test('bounded recovery works for a known read-only route without saving request secrets', async () => {
  let tries = 0
  const run = fixture({ read: async id => id === 'catalog' && ++tries === 1 ? {} : undefined })
  assert.equal((await run.run()).status, 'COMPLETE')
  assert.equal(run.discoveries(), 1)
})

test('page-managed response recovery can replace a failed direct query with the same strict parser', async () => {
  const run = fixture({ read: async id => id === 'catalog' ? {} : undefined,
    discover: async () => ({ root: catalogRoot() }) })
  assert.equal((await run.run()).status, 'COMPLETE')
  assert.equal(run.calls.filter(c => c.id === 'catalog').length, 1)
  assert.equal(run.recipes.length, 8)
})

test('missing catalog blocks orders but preserves independently verified datasets', async () => {
  const run = fixture({ read: async id => id === 'catalog' ? {} : undefined })
  const result = await run.run()
  assert.equal(result.status, 'PARTIAL'); assert.equal(result.datasets.inventory.status, 'FAILED')
  assert.equal(result.datasets.ordersByBooking.status, 'FAILED')
  assert.equal(result.datasets.reviews.status, 'COMPLETE')
  assert.equal(run.calls.some(c => c.id === 'orders'), false)
})

test('page response recovery rejects other dates, platforms, room IDs, pagination and filters', () => {
  const expected = ctripOrderQuery('OrderDate', window, 0)
  assert.equal(ctripDataQueryMatches({ ...expected, header: { opaque: 'must-not-copy' } }, expected), true)
  for (const patch of [{ dateStart: '2026-08-18' }, { queryDateType: 'ArrivalDate' }, { keyword: 'private guest' },
    { pageInfo: { ...expected.orderQueryCondition.pageInfo, pageIndex: 1 } }]) {
    assert.equal(ctripDataQueryMatches({ ...expected, orderQueryCondition: { ...expected.orderQueryCondition, ...patch } }, expected), false)
  }
  assert.equal(ctripDataQueryMatches({ platform: 'Qunar' }, { platform: 'Ctrip' }), false)
  assert.equal(ctripDataQueryMatches({ hotelRoomInfoDtoList: [{ hotelID: '7654321' }] }, { hotelRoomInfoDtoList: [{ hotelID: '1234567' }] }), false)
  assert.equal(ctripDataQueryMatches(null, null), true)
  assert.equal(ctripDataQueryMatches({}, null), true)
  assert.equal(ctripDataQueryMatches([], null), false)
})

test('browser transport does not copy credentials and keeps empty catalog bodies empty', async () => {
  let sent
  const page = { url: () => 'https://ebooking.ctrip.com/ebkovsroom/inventory/calendar',
    evaluate: async (fn, argument) => runInNewContext(`(${fn.toString()})`, {
      fetch: async (path, options) => { sent = { path, options }; return new Response('{"ok":true}', { headers: { 'Content-Type': 'application/json' } }) },
      AbortSignal, TextDecoder, Uint8Array,
    })(argument) }
  assert.deepEqual(JSON.parse(JSON.stringify(await fetchCtripData(page, CTRIP_DATA_RECIPES.catalog, null))), { ok: true })
  assert.equal(sent.options.body, undefined)
  assert.equal(sent.options.credentials, 'same-origin')
  assert.equal(sent.options.redirect, 'error')
  assert.deepEqual(Object.keys(sent.options.headers), ['Content-Type'])
  await assert.rejects(fetchCtripData(page, { ...CTRIP_DATA_RECIPES.orders, path: '/cancelOrder' }, {}), /SCOPE_MISMATCH/)
})

test('cross-store response and expired login stop the entire collection without rediscovery', async () => {
  for (const code of ['CTRIP_DATA_LOGIN_REQUIRED', 'CTRIP_DATA_SCOPE_MISMATCH', 'CTRIP_DATA_CANCELLED']) {
    const run = fixture({ assertScope: async n => { if (n === 3) throw new Error(code) } })
    await assert.rejects(run.run(), new RegExp(code)); assert.equal(run.discoveries(), 0)
  }
  const foreign = fixture({ read: async id => id === 'reviewScope' ? soa({ masterHotelId: internalId }) : undefined })
  await assert.rejects(foreign.run(), /SCOPE_MISMATCH/)
})

test('short middle page retries same page and never skips missing records', async () => {
  let attempts = 0
  const run = fixture({ read: async (id, body) => {
    if (id === 'orders' && body.orderQueryCondition.pageInfo.pageIndex === 0 && ++attempts === 1) return soa({ total: 21, orderList: [order(0)] })
  } })
  assert.equal((await run.run()).status, 'COMPLETE')
  assert.equal(run.calls.filter(c => c.id === 'orders' && c.body.orderQueryCondition.queryDateType === 'OrderDate').length, 4)
})

test('permanently short pages, repeated pages, changing totals and caps remain partial', async () => {
  const cases = [
    { read: async id => id === 'orders' ? soa({ total: 21, orderList: [order(0)] }) : undefined },
    { read: async (id, body) => id === 'orders' && body.orderQueryCondition.pageInfo.pageIndex === 1 ? soa({ total: 21, orderList: [order(0)] }) : undefined },
    { read: async (id, body) => id === 'orders' && body.orderQueryCondition.pageInfo.pageIndex === 1 ? soa({ total: 22, orderList: [order(20), order(21)] }) : undefined },
    { maxPages: 1 },
  ]
  for (const options of cases) {
    const result = await fixture(options).run()
    assert.equal(result.datasets.ordersByBooking.status, 'PARTIAL')
    assert.equal(result.datasets.ordersByBooking.data.complete, false)
  }
})

test('leading page recheck detects status changes during pagination', async () => {
  let zeroReads = 0
  const run = fixture({ read: async (id, body) => {
    if (id === 'orders' && body.orderQueryCondition.queryDateType === 'OrderDate' && body.orderQueryCondition.pageInfo.pageIndex === 0 && ++zeroReads === 2) {
      return soa({ total: 21, orderList: Array.from({ length: 20 }, (_, i) => order(i, { orderStatusType: 'Canceled' })) })
    }
  } })
  const result = await run.run()
  assert.equal(result.datasets.ordersByBooking.data.complete, false)
  assert.equal(result.datasets.ordersByBooking.data.issue, 'SOURCE_CHANGED_DURING_READ')
})

test('empty orders are zero only with a successful envelope and independently verified scope', async () => {
  const run = fixture({ read: async id => id === 'orders' ? soa({ total: 0, orderList: [] }) : undefined })
  const result = await run.run()
  assert.equal(result.datasets.ordersByArrival.data.complete, true)
  assert.equal(result.datasets.ordersByArrival.data.effectiveOrders, 0)
  assert.throws(() => normalizeCtripOrderPage({ total: 0, orderList: [] }, [internalId], 'OrderDate', window), /PROVIDER_REJECTED/)
})

test('SQLite recipes survive recreation, reject foreign stores, changed paths and extra credential fields', async () => {
  const db = new DatabaseSync(':memory:')
  try {
    const store = createCtripDataStore(db)
    const value = { ...CTRIP_DATA_RECIPES.orders, profileId, hotelId, verifiedAt: now().toISOString(), schemaHash: 'b'.repeat(64) }
    await store.saveRecipe(value)
    assert.equal(createCtripDataStore(db).getRecipeCount(profileId, hotelId), 1)
    assert.equal(store.getRecipeCount(profileId, internalId), 0)
    for (const patch of [{ path: '/cancelOrder' }, { cookie: 'SECRET' }, { version: 2 }, { profileId: '../other' }]) {
      await assert.rejects(store.saveRecipe({ ...value, ...patch }))
    }
    await store.saveData(await fixture().run())
    const persisted = db.prepare('SELECT value FROM lab_data_result').get().value
    assert.equal(persisted.includes('PRIVATE'), false); assert.equal(persisted.includes('SECRET'), false)
  } finally { db.close() }
})

test('order builder rejects unknown basis and contains no copied authentication parameters', () => {
  assert.throws(() => ctripOrderQuery('Unknown', window, 0))
  assert.throws(() => ctripOrderQuery('OrderDate', window, -1))
  assert.equal(JSON.stringify(ctripOrderQuery('OrderDate', window, 0)).includes('header'), false)
})
