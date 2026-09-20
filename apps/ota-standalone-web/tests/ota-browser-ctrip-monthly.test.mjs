import test from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { setTimeout as delay } from 'node:timers/promises'
import { ctripMonthWindow, normalizeCtripMonthlyReviews, aggregateMonthlyReviews, collectCtripMonthlyData } from '../../../tools/labs/ota-browser/ctrip-monthly-data.mjs'
import { createCtripDataStore } from '../../../tools/labs/ota-browser/ctrip-data-store.mjs'

const hotelId = '1234567', internalId = '7654321', profileId = `ctrip-${'a'.repeat(32)}`
const now = () => new Date('2026-09-18T12:00:00.000Z'), month = '2026-08'
const soa = value => ({ resStatus: { rcode: 200 }, ResponseStatus: { Ack: 'Success' }, ...value })
const order = (i, patch = {}) => ({ hotel: internalId, sourceType: 'Ebooking', formId: String(1000 + i), orderId: String(2000 + i),
  formDateOriginal: '2026-08-15 10:00:00', arrival: '2026-08-15', orderDate: '2026-08-14', quantity: 1, liveDays: 2,
  allinanceName: i < 15 ? 'ctrip' : 'qunar', orderStatusType: i === 12 ? 'Receipt' : i === 13 ? 'Canceled' : i === 14 ? 'Changed' : 'CheckIn',
  ...(i === 14 ? { orderType: 'S', orderTypeDesc: '无效' } : {}), clientName: 'PRIVATE_GUEST', token: 'SECRET_TOKEN', ...patch })
const review = (i, patch = {}) => ({ commentId: String(3000 + i), sourceId: 1, channelSource: 'trip', status: 'Approved',
  avgScore: i === 0 ? 4.8 : i === 1 ? 4.79 : 5, score: { maxScore: 5, avgScore: i === 0 ? 4.8 : i === 1 ? 4.79 : 5 },
  addtime: `/Date(${Date.parse(i === 2 ? '2026-09-02T00:00:00Z' : '2026-08-15T00:00:00Z')}+0800)/`,
  checkinTimeStr: i < 3 ? '2026-08' : '2026-07', content: 'PRIVATE_REVIEW', userName: 'PRIVATE_USER', ...patch })
const reviewsRoot = (rows, index = 1, total = rows.length) => soa({ masterHotelId: hotelId, commentCount: total,
  currentPageIndex: index, pageCount: Math.ceil(total / 10), commentlist: rows })
const fixture = (options = {}) => {
  const calls = [], recipes = [], progress = []
  let active = 0, peak = 0, checks = 0
  const orders = options.orders || Array.from({ length: 21 }, (_, i) => order(i))
  const reviews = options.reviews || Array.from({ length: 11 }, (_, i) => review(i))
  const read = async (page, recipe, body) => {
    calls.push({ id: recipe.id, body }); active++; peak = Math.max(peak, active)
    try {
      await delay(1)
      const override = await options.read?.(recipe.id, body, calls)
      if (override !== undefined) return override
      if (recipe.id === 'catalog') return { code: 200, data: [{ basicRoomTypeID: 100, roomName: '合成房型',
        sonBasicRoomIDList: [100], enableBasicRoomQuantity: true,
        roomInfos: [{ hotelID: internalId, roomTypeID: 200, roomClass: 200, payType: 'PP' }] }] }
      if (recipe.id === 'orders') {
        const q = body.orderQueryCondition, start = q.pageInfo.pageIndex * 20
        const rows = q.queryCustemFilter === 'CheckedIn' ? orders.filter(row => row.allinanceName === 'ctrip' && row.orderStatusType === 'CheckIn') : orders
        return soa({ total: rows.length, orderList: rows.slice(start, start + 20) })
      }
      if (recipe.id === 'reviewScope') return reviewsRoot(reviews.slice((body.pageIndex - 1) * 10, body.pageIndex * 10), body.pageIndex, reviews.length)
      throw new Error('UNEXPECTED_READ')
    } finally { active-- }
  }
  return { calls, recipes, progress, peak: () => peak, active: () => active, checks: () => checks,
    run: () => collectCtripMonthlyData({ page: {}, hotelId, profileId, month: options.month || month, now, read,
      assertScope: async () => { checks++; await options.assertScope?.(checks) }, progress: p => progress.push(p),
      saveRecipe: async r => recipes.push(r), discover: async () => null, pace: async () => {}, maxPages: options.maxPages ?? 10 }) }
}

test('month windows are completed Shanghai months and preserve leap-year boundaries', () => {
  assert.equal(ctripMonthWindow('2024-02', now()).endDate, '2024-02-29')
  assert.equal(ctripMonthWindow('2025-02', now()).endDate, '2025-02-28')
  assert.equal(ctripMonthWindow(month, now()).startDate, '2026-08-01')
  for (const value of ['2026-09', '2027-01', '2026-00', '2026-13', '2026-8', null, '../2026']) assert.throws(() => ctripMonthWindow(value, now()), /CTRIP_MONTH_INVALID/)
})

test('review threshold includes 4.8, excludes 4.79 without rounding, and includes late reviews by stay month', () => {
  const rows = normalizeCtripMonthlyReviews(reviewsRoot(Array.from({ length: 4 }, (_, i) => review(i))), hotelId).rows
  const result = aggregateMonthlyReviews(rows, ctripMonthWindow(month, now()))
  assert.equal(result.total, 3); assert.equal(result.good, 2); assert.equal(result.lateReviews, 1)
  assert.equal(result.publishedTotal, 3); assert.equal(result.publishedGood, 2)
  assert.equal(JSON.stringify(rows).includes('PRIVATE'), false)
  assert.equal(JSON.stringify(result).includes('3000'), false)
})

test('monthly collector scans all channels then projects Ctrip and crosschecks official checked-in count', async () => {
  const run = fixture(), result = await run.run()
  assert.equal(result.status, 'COMPLETE')
  assert.equal(result.orders.checkedIn, 12); assert.equal(result.orders.confirmed, 1)
  assert.equal(result.orders.effective, 13); assert.equal(result.orders.excluded, 2)
  assert.equal(result.orders.otherChannelRecords, 6); assert.equal(result.orders.sourceRecords, 21)
  assert.equal(result.reviews.total, 3); assert.equal(result.reviews.good, 2)
  assert.equal(result.goodRate, 2 / 12 * 100); assert.equal(result.effectiveRate, 2 / 13 * 100)
  assert.ok(run.peak() <= 2); assert.equal(run.active(), 0); assert.ok(run.checks() >= run.calls.length * 2)
  assert.ok(run.calls.filter(c => c.id === 'orders' && c.body.orderQueryCondition.queryCustemFilter !== 'CheckedIn').every(c => c.body.orderQueryCondition.allicanceNames.length === 0))
  for (const value of ['PRIVATE', 'SECRET', 'formId', 'orderId', 'commentId', 'userName']) assert.equal(JSON.stringify({ result, recipes: run.recipes }).includes(value), false)
})

test('zero checked-in denominator is not displayed as zero percent', async () => {
  const result = await fixture({ orders: [] }).run()
  assert.equal(result.status, 'COMPLETE'); assert.equal(result.orders.checkedIn, 0)
  assert.equal(result.goodRate, null); assert.equal(result.effectiveRate, null)
})

test('large reports use at most two simultaneous page requests', async () => {
  const run = fixture({ orders: Array.from({ length: 61 }, (_, i) => order(i)) })
  assert.equal((await run.run()).status, 'COMPLETE')
  assert.equal(run.peak(), 2); assert.equal(run.active(), 0)
})

test('missing channel, unknown Ctrip status and official count mismatch never calculate a rate', async () => {
  const cases = [
    { orders: [order(0, { allinanceName: undefined })] },
    { orders: [order(0, { orderStatusType: 'Unknown' })] },
    { read: async (id, body) => id === 'orders' && body.orderQueryCondition.queryCustemFilter === 'CheckedIn' ? soa({ total: 0, orderList: [] }) : undefined },
  ]
  for (const options of cases) {
    const result = await fixture(options).run()
    assert.equal(result.status, 'PARTIAL'); assert.equal(result.orders, null); assert.equal(result.goodRate, null)
    assert.ok(result.reviews)
  }
})

test('missing stay month, new review status and invalid score do not silently drop reviews', async () => {
  for (const patch of [{ checkinTimeStr: '' }, { status: 'Pending' }, { avgScore: 6 }, { addtime: 'bad' }]) {
    const result = await fixture({ reviews: [review(0, patch)] }).run()
    assert.equal(result.status, 'PARTIAL'); assert.equal(result.reviews, null); assert.equal(result.goodRate, null)
    assert.ok(result.orders)
  }
})

test('duplicate review pages, order pages, changing totals and page caps remain unavailable', async () => {
  const cases = [
    { read: async (id, body) => id === 'reviewScope' && body.pageIndex === 2 ? reviewsRoot([review(0)], 2, 11) : undefined },
    { read: async (id, body) => id === 'orders' && body.orderQueryCondition.pageInfo.pageIndex === 1 ? soa({ total: 21, orderList: [order(0)] }) : undefined },
    { read: async (id, body) => id === 'reviewScope' && body.pageIndex === 2 ? reviewsRoot([review(10)], 2, 12) : undefined },
    { maxPages: 1 },
  ]
  for (const options of cases) {
    const run = fixture(options), result = await run.run()
    assert.equal(result.status, 'PARTIAL'); assert.equal(result.goodRate, null); assert.equal(run.active(), 0)
  }
})

test('short first page retries without poisoning the final fingerprint', async () => {
  let attempts = 0
  const result = await fixture({ read: async id => id === 'orders' && ++attempts === 1 ? soa({ total: 21, orderList: [order(0)] }) : undefined }).run()
  assert.equal(result.status, 'COMPLETE')
})

test('review update during read fails the final leading-page fingerprint', async () => {
  let first = 0
  const result = await fixture({ read: async (id, body) => {
    if (id === 'reviewScope' && body.pageIndex === 1 && ++first === 2) return reviewsRoot(Array.from({ length: 10 }, (_, i) => review(i, i === 0 ? { avgScore: 5, score: { maxScore: 5, avgScore: 5 } } : {})), 1, 11)
  } }).run()
  assert.equal(result.goodRate, null)
  assert.equal(result.issues.at(-1).code, 'SOURCE_CHANGED_DURING_READ')
})

test('wrong hotel, wrong review channel and expired session are fatal; nothing in flight survives', async () => {
  for (const options of [
    { reviews: [review(0, { channelSource: 'qunar' })] },
    { orders: [order(0, { hotel: hotelId })] },
    { assertScope: async n => { if (n > 4) throw new Error('CTRIP_DATA_LOGIN_REQUIRED') } },
  ]) {
    const run = fixture(options)
    await assert.rejects(run.run(), /CTRIP_DATA_(SCOPE_MISMATCH|LOGIN_REQUIRED)/)
    assert.equal(run.active(), 0)
  }
})

test('a concurrent scope failure takes precedence over a schema failure and stops later datasets', async () => {
  const run = fixture({ orders: Array.from({ length: 61 }, (_, i) => order(i)), read: async (id, body) => {
    if (id !== 'orders') return
    const index = body.orderQueryCondition.pageInfo.pageIndex
    if (index === 2) return {}
    if (index === 3) return soa({ total: 61, orderList: [order(60, { hotel: hotelId })] })
  } })
  await assert.rejects(run.run(), /CTRIP_DATA_SCOPE_MISMATCH/)
  assert.equal(run.active(), 0)
  assert.equal(run.calls.some(call => call.id === 'reviewScope'), false)
})

test('monthly aggregate persists across store recreation, is scoped and contains no identifiers', async () => {
  const db = new DatabaseSync(':memory:')
  try {
    const result = await fixture().run(), store = createCtripDataStore(db)
    await store.saveMonthlyData(result)
    assert.deepEqual(createCtripDataStore(db).getMonthlyData(profileId, hotelId), JSON.parse(JSON.stringify(result)))
    assert.equal(store.getMonthlyData(profileId, internalId), null)
    assert.equal(store.getMonthlyData(profileId, null), null)
    const persisted = db.prepare('SELECT value FROM lab_monthly_result').get().value
    assert.equal(persisted.includes('PRIVATE'), false); assert.equal(persisted.includes('SECRET'), false)
    assert.equal(persisted.includes('formId'), false); assert.equal(persisted.includes('commentId'), false)
    await assert.rejects(store.saveMonthlyData({ ...result, scope: 'ALL' }))
  } finally { db.close() }
})
