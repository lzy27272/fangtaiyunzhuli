import test from 'node:test'
import assert from 'node:assert/strict'
import { runInNewContext } from 'node:vm'
import { collectMeituanBusiness } from '../../../tools/labs/ota-browser/meituan-data-engine.mjs'
import { MEITUAN_DATA_RECIPES, assertMeituanScope, meituanDisplayNumber,
  normalizeMeituanBusiness, normalizeMeituanReviewPage, normalizeMeituanInventory, normalizeMeituanPeerEntry }
  from '../../../tools/labs/ota-browser/meituan-data-contract.mjs'

const scope = { poiId: '1234567', partnerId: '7654321', propertyName: '合成测试酒店' }
const query = { poiId: scope.poiId, partnerId: scope.partnerId, dateRange: '7' }
const meta = { observedAt: '2026-09-18T16:20:00.000Z', period: 'LAST_7_DAYS' }
const business = () => ({ status: 0, data: { rtDataUpdateTime: '数据更新时间：2026/09/19 00:20',
  cookies: 'PRIVATE', cards: [{ id: 'PAY_ORDER_CNT_UV', title: '支付转化率', value: '8.82', suffix: '%',
    extAttrs: [{ key: 'COMPARE', name: '较上期', values: ['+', '1.53%'] },
      { key: 'TEXT', name: '同行排名', values: ['5/20'] }, { key: 'TEXT', name: '同行均值', values: '7.00' }] }] } })

test('Meituan discovery catalog contains only observed reads, not an order write or guessed collector', () => {
  assert.equal(Object.keys(MEITUAN_DATA_RECIPES).length, 14)
  for (const row of Object.values(MEITUAN_DATA_RECIPES)) {
    assert.equal(row.mode, 'READ_ONLY_DISCOVERY')
    assert.ok(['https://me.meituan.com', 'https://eb.meituan.com'].includes(row.origin))
    assert.ok(['GET','POST'].includes(row.method))
    assert.ok(!/update|delete|cancel|confirm|reply|save/i.test(row.path))
    assert.throws(() => { row.path = '/unsafe' }, TypeError)
  }
  assert.equal(MEITUAN_DATA_RECIPES.orders, undefined)
})
test('hotel scope requires both provider IDs; account label or local store number is insufficient', () => {
  assert.deepEqual(assertMeituanScope(query, scope), { poiId: '1234567', partnerId: '7654321' })
  assert.throws(() => assertMeituanScope({ ...query, poiId: '009' }, scope))
  assert.throws(() => assertMeituanScope({ ...query, partnerId: '999999' }, scope), /SCOPE_MISMATCH/)
  assert.throws(() => assertMeituanScope({}, scope))
})
test('displayed missing values stay missing and compact units stay approximate', () => {
  for (const value of [null, undefined, '-', '--', '']) assert.equal(meituanDisplayNumber(value).value, null)
  assert.deepEqual(meituanDisplayNumber('0'), { value: 0, approximate: false })
  assert.deepEqual(meituanDisplayNumber('3.25', '万'), { value: 32500, approximate: true })
  assert.deepEqual(meituanDisplayNumber('4.48', '万'), { value: 44800, approximate: true })
  for (const value of ['NaN','Infinity','one',{},true]) assert.throws(() => meituanDisplayNumber(value))
  assert.throws(() => meituanDisplayNumber('3.25', 'unknown'))
})
test('business snapshots keep exact comparison signs and never invent a review denominator', () => {
  const result = normalizeMeituanBusiness(business(), query, scope, meta)
  assert.equal(result.cards[0].value, 8.82)
  assert.deepEqual(result.cards[0].rank, { position: 5, peers: 20 })
  assert.deepEqual(result.cards[0].comparisons[0].values, ['+', '1.53%'])
  assert.deepEqual(result.cards[0].comparisons[2].values, ['7.00'])
  assert.equal(result.validStayedOrderCount, null)
  assert.equal(result.goodReviewConversionPercent, null)
  assert.equal(result.readyForAlerts, false)
  assert.equal(JSON.stringify(result).includes('PRIVATE'), false)
})
test('daily snapshot before 09:00 Shanghai is withheld even when HTTP and provider code succeed', () => {
  const options = { ...meta, period: 'YESTERDAY' }, dailyQuery = { ...query, dateRange: '1' }
  assert.equal(normalizeMeituanBusiness(business(), dailyQuery, scope, options).publicationStatus, 'AWAITING_09_00_DAILY_UPDATE')
  assert.equal(normalizeMeituanBusiness(business(), dailyQuery, scope,
    { ...options, observedAt: '2026-09-19T01:00:00Z' }).publicationStatus, 'SOURCE_DATE_CONFIRMATION_REQUIRED')
  assert.throws(() => normalizeMeituanBusiness(business(), query, scope, options), /PERIOD_MISMATCH/)
  assert.throws(() => normalizeMeituanBusiness(business(), query, scope, { ...meta, period: 'LIVE' }), /LIVE_PERIOD_NOT_VERIFIED/)
})
test('business projection fails closed on provider rejection, duplicate cards, bad ranks, or schema drift', () => {
  assert.throws(() => normalizeMeituanBusiness({ status: 403 }, query, scope, meta), /PROVIDER_REJECTED/)
  const duplicate = business(); duplicate.data.cards.push(duplicate.data.cards[0])
  assert.throws(() => normalizeMeituanBusiness(duplicate, query, scope, meta))
  const wrongRank = business(); wrongRank.data.cards[0].extAttrs[1].values = ['21/20']
  assert.throws(() => normalizeMeituanBusiness(wrongRank, query, scope, meta))
  assert.throws(() => normalizeMeituanBusiness({ status: 0, data: { cards: [] } }, query, scope, meta))
})
const review = precise => ({ poiName: scope.propertyName, score: 50, accurateScore: precise,
  commentTime: Date.parse('2026-09-18T16:01:00Z'), consumeTime: Date.parse('2026-09-17T16:00:00Z'),
  userName: 'PRIVATE-GUEST', comment: 'PRIVATE-REVIEW', orderId: 11111111, token: 'SECRET' })
const reviewRoot = () => ({ code: 10000, data: { total: 3182, offset: 1, limit: 10,
  commentList: [review(48), review(47.5), review(50), review(null)] } })
test('reviews use precise score and include 4.8; rounded 5.0 cannot hide a precise 4.75', () => {
  const result = normalizeMeituanReviewPage(reviewRoot(), { ...query, replyType: '3' }, scope)
  assert.deepEqual(result.rows.map(row => row.good), [true, false, true, null])
  assert.equal(result.rows[1].score, 4.75)
  assert.equal(result.rows[0].publishedDate, '2026-09-19')
  assert.equal(result.rows[0].providerConsumeDate, '2026-09-18')
  assert.equal(result.windowComplete, false)
  assert.equal(result.consumeDateMeaning, 'NOT_YET_VERIFIED_AS_CHECKIN_DATE')
  assert.equal(result.goodReviewConversionPercent, null)
  for (const privateValue of ['PRIVATE','SECRET','orderId','userName']) assert.equal(JSON.stringify(result).includes(privateValue), false)
})
test('review property name, provider status and score range must match', () => {
  const foreign = reviewRoot(); foreign.data.commentList[0].poiName = '另一门店'
  assert.throws(() => normalizeMeituanReviewPage(foreign, query, scope), /SCOPE_MISMATCH/)
  const invalid = reviewRoot(); invalid.data.commentList[0].accurateScore = 51
  assert.throws(() => normalizeMeituanReviewPage(invalid, query, scope))
  assert.throws(() => normalizeMeituanReviewPage({ code: 403 }, query, scope), /PROVIDER_REJECTED/)
})
const inventoryQuery = { ...query, startDate: '2026-09-18', endDate: '2026-09-18', roomIds: [42] }
const inventoryRoot = () => ({ code: 10000, success: true, data: [{ roomBaseInfo: { roomId: 42, roomName: '合成房型' },
  roomStatusMap: { '2026-09-18': { date: '2026-09-18', roomStatus: 1, invSwitch: 0, limitType: 2,
    remainCount: 0, limitRemain: -1, usedCount: null } } }] })
test('inventory preserves zero, null and unlimited sentinel without assuming sellable availability', () => {
  const result = normalizeMeituanInventory(inventoryRoot(), inventoryQuery, scope)
  const day = result.rooms[0].days[0]
  assert.equal(day.providerRemainCount, 0)
  assert.equal(day.providerLimitRemain, -1)
  assert.equal(day.providerUsedCount, null)
  assert.equal(day.reliableAvailable, null)
  assert.equal(result.readyForAlerts, false)
})
test('inventory deduplicates identical room records but rejects conflicting duplicates, missing rooms and date gaps', () => {
  assert.throws(() => normalizeMeituanInventory({ ...inventoryRoot(), data: [] }, inventoryQuery, scope), /ROOMS_INCOMPLETE/)
  const duplicate = inventoryRoot(); duplicate.data.push(duplicate.data[0])
  assert.equal(normalizeMeituanInventory(duplicate, { ...inventoryQuery, roomIds: [42,42] }, scope).rooms.length, 1)
  const conflicting = inventoryRoot()
  conflicting.data.push(structuredClone(conflicting.data[0]))
  conflicting.data[1].roomStatusMap['2026-09-18'].remainCount = 9
  assert.throws(() => normalizeMeituanInventory(conflicting, inventoryQuery, scope), /CONFLICTING_INVENTORY/)
  const foreign = inventoryRoot(); foreign.data[0].roomBaseInfo.roomId = 43
  assert.throws(() => normalizeMeituanInventory(foreign, inventoryQuery, scope), /SCOPE_MISMATCH/)
  assert.throws(() => normalizeMeituanInventory(inventoryRoot(), { ...inventoryQuery, endDate: '2026-09-19' }, scope), /DATES_INCOMPLETE/)
})

test('business collection reuses a verified visible page and projects response before returning', async () => {
  let scopeReads = 0
  const calls = []
  const frame = { url: () => 'https://eb.meituan.com/newhb-sub-app/data-center-pc/home/index.html',
    locator: () => ({ innerText: async () => { scopeReads++; return scope.propertyName } }),
    evaluate: async (fn, args) => { calls.push(args); return { httpStatus: 200, root: business() } } }
  const result = await collectMeituanBusiness({ frame, scope, now: () => new Date(meta.observedAt) })
  assert.equal(scopeReads, 2)
  assert.equal(calls.length, 1)
  assert.deepEqual(calls[0].query, { poiId: scope.poiId, partnerId: scope.partnerId, dateRange: '7', dataScope: 'vpoi', deviceType: '1' })
  assert.equal(result.cards[0].value, 8.82)
  assert.equal(JSON.stringify(result).includes('PRIVATE'), false)
})
test('business collection never retries forbidden requests and rejects a property switch in flight', async () => {
  let calls = 0, reads = 0
  const frame = { url: () => 'https://eb.meituan.com/newhb-sub-app/data-center-pc/home/index.html',
    locator: () => ({ innerText: async () => { reads++; return reads > 1 ? '另一门店' : scope.propertyName } }),
    evaluate: async () => { calls++; return { httpStatus: 403 } } }
  await assert.rejects(collectMeituanBusiness({ frame, scope }), /HTTP_403/)
  assert.equal(calls, 1)
  reads = 0
  frame.evaluate = async () => ({ httpStatus: 200, root: business() })
  await assert.rejects(collectMeituanBusiness({ frame, scope }), /SCOPE_MISMATCH/)
  frame.url = () => 'https://eb.meituan.com.attacker.invalid/newhb-sub-app/data-center-pc/home/index.html'
  await assert.rejects(collectMeituanBusiness({ frame, scope }), /PAGE_REQUIRED/)
  await assert.rejects(collectMeituanBusiness({ frame, scope, period: 'ARBITRARY' }), /PERIOD_REQUIRED/)
})
test('browser transport has an exact read target, no credential copying, and bounded JSON', async () => {
  let source, args
  const frame = { url: () => 'https://eb.meituan.com/newhb-sub-app/data-center-pc/home/index.html',
    locator: () => ({ innerText: async () => scope.propertyName }),
    evaluate: async (fn, input) => { source = fn.toString(); args = input; return { httpStatus: 200, root: business() } } }
  await collectMeituanBusiness({ frame, scope })
  const requests = []
  const browserRead = runInNewContext(`(${source})`, { URL, AbortController, setTimeout, clearTimeout, Uint8Array, TextDecoder,
    location: { origin: 'https://eb.meituan.com' },
    fetch: async (url, options) => { requests.push({ url, options }); return new Response(JSON.stringify(business()), { headers: { 'content-type': 'application/json' } }) } })
  const response = await browserRead(args)
  assert.equal(response.httpStatus, 200)
  assert.equal(requests[0].options.credentials, 'same-origin')
  assert.equal(requests[0].options.redirect, 'error')
  assert.equal(requests[0].options.method, 'GET')
  assert.deepEqual(Object.keys(requests[0].options.headers), ['Accept'])
  assert.equal(new URL(requests[0].url).pathname, MEITUAN_DATA_RECIPES.business.path)
  const oversizedRead = runInNewContext(`(${source})`, { URL, AbortController, setTimeout, clearTimeout, Uint8Array, TextDecoder,
    location: { origin: 'https://eb.meituan.com' }, fetch: async () => new Response(' '.repeat(1024 * 1024 + 1), { headers: { 'content-type': 'application/json' } }) })
  assert.equal((await oversizedRead(args)).issue, 'TOO_LARGE')
})

test('peer entry price is not misrepresented as a dated, comparable room quote', () => {
  const root = { status: 0, data: { poiId: 888888, poiName: '合成同行酒店', lowestPrice: 238 } }
  const result = normalizeMeituanPeerEntry(root, { ...query, followPoiId: '888888' }, scope)
  assert.equal(result.displayFromPrice, 238)
  assert.equal(result.quoteType, 'PLATFORM_FROM_PRICE')
  assert.equal(result.checkInDate, null)
  assert.equal(result.availability, null)
  assert.equal(result.readyForPriceAlerts, false)
  for (const value of [0, -1, null]) {
    assert.equal(normalizeMeituanPeerEntry({ ...root, data: { ...root.data, lowestPrice: value } },
      { ...query, followPoiId: '888888' }, scope).displayFromPrice, null)
  }
  assert.throws(() => normalizeMeituanPeerEntry(root, { ...query, followPoiId: '999999' }, scope), /PEER_MISMATCH/)
})
