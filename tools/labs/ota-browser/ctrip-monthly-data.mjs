import { createHash } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'
import { CTRIP_DATA_RECIPES as R, dataAssert, soaSuccess, dataId, isoDay, normalizeCtripCatalog,
  normalizeCtripOrderPage, aggregateCtripOrders, ctripOrderQuery } from './ctrip-data-contract.mjs'
import { fetchCtripData, rediscoverCtripData, ctripDataError } from './ctrip-data-engine.mjs'

export const ctripMonthWindow = (month, now = new Date()) => {
  const today = new Date(now.getTime() + 8 * 3600000).toISOString().slice(0, 10)
  dataAssert(typeof month === 'string' && /^20\d{2}-(0[1-9]|1[0-2])$/u.test(month)
    && month < today.slice(0, 7), 'CTRIP_MONTH_INVALID')
  const startDate = `${month}-01`
  const endDate = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5)), 0)).toISOString().slice(0, 10)
  return { month, startDate, endDate, today, timezone: 'Asia/Shanghai' }
}

export const ctripMonthlyReviewQuery = pageIndex => ({ keyWord: '', pageIndex, commentStatus: '', isNeedTranslate: false,
  sortType: 0, catalogTab: 'all', catalogName: '全部点评', pageSize: 10, needOrder: false,
  startDate: '', endDate: '', channelSource: '1' })

// Only these projections may leave the read layer. Identifiers are transient,
// solely for pagination/deduplication; no review text, guest or credential fields.
export const normalizeCtripMonthlyReviews = (root, hotelId) => {
  soaSuccess(root)
  dataAssert(dataId(root.masterHotelId) === hotelId, 'CTRIP_DATA_SCOPE_MISMATCH')
  dataAssert(Number.isSafeInteger(root.commentCount) && root.commentCount >= 0
    && Number.isSafeInteger(root.currentPageIndex) && root.currentPageIndex >= 1
    && root.pageCount === Math.ceil(root.commentCount / 10) && Array.isArray(root.commentlist)
    && root.commentlist.length <= 10)
  return { total: root.commentCount, pageIndex: root.currentPageIndex, rows: root.commentlist.map(row => {
    dataAssert(row.sourceId === 1 && row.channelSource === 'trip', 'CTRIP_DATA_SCOPE_MISMATCH')
    dataAssert(row.status === 'Approved')
    const match = /^\/Date\((\d+)\+0800\)\/$/u.exec(row.addtime)
    dataAssert(match && Number.isFinite(Number(match[1])))
    const day = isoDay(new Date(Number(match[1]) + 8 * 3600000).toISOString().slice(0, 10))
    dataAssert(typeof row.avgScore === 'number' && Number.isFinite(row.avgScore) && row.avgScore >= 0
      && row.avgScore <= 5 && row.score?.maxScore === 5 && row.score.avgScore === row.avgScore)
    dataAssert(row.checkinTimeStr == null || row.checkinTimeStr === '' || /^20\d{2}-(0[1-9]|1[0-2])$/u.test(row.checkinTimeStr))
    return { key: dataId(row.commentId), day, month: row.checkinTimeStr || null, score: row.avgScore }
  }) }
}

export const aggregateMonthlyReviews = (rows, window) => {
  const cohort = rows.filter(row => row.month === window.month)
  const published = rows.filter(row => row.day >= window.startDate && row.day <= window.endDate)
  const good = cohort.filter(row => row.score >= 4.8)
  const scoreCounts = new Map()
  for (const row of cohort) scoreCounts.set(row.score, (scoreCounts.get(row.score) || 0) + 1)
  return { basis: 'REVIEW_CHECKIN_MONTH', threshold: 4.8, total: cohort.length, good: good.length,
    belowThreshold: cohort.length - good.length, missingStayMonth: rows.filter(row => !row.month).length,
    lateReviews: cohort.filter(row => row.day > window.endDate).length,
    lateGood: good.filter(row => row.day > window.endDate).length,
    publishedTotal: published.length, publishedGood: published.filter(row => row.score >= 4.8).length,
    scores: [...scoreCounts].sort((a, b) => b[0] - a[0]).map(([score, count]) => ({ score, count })) }
}

const fatal = error => ['CTRIP_DATA_LOGIN_REQUIRED', 'CTRIP_DATA_SCOPE_MISMATCH', 'CTRIP_DATA_CANCELLED'].includes(error?.message)
const issueCodes = new Set(['PAGE_LIMIT', 'INCOMPLETE_PAGE', 'REPEATED_PAGE', 'TOTAL_CHANGED', 'SOURCE_CHANGED_DURING_READ',
  'UNKNOWN_CHANNEL', 'UNKNOWN_ORDER_STATUS', 'UNKNOWN_REVIEW_MONTH', 'CHECKIN_COUNT_MISMATCH'])
const safeIssue = error => issueCodes.has(error?.message) ? error.message : ctripDataError(error)

export const collectCtripMonthlyData = async ({ page, hotelId, profileId, month, now = () => new Date(),
  assertScope, progress = () => {}, saveRecipe = async () => {}, read = fetchCtripData,
  discover = rediscoverCtripData, pace = () => delay(200), maxPages = 300 } = {}) => {
  const window = ctripMonthWindow(month, now())
  const result = { version: 1, kind: 'CTRIP_MONTHLY', scope: 'CTRIP_ONLY', hotelId, profileId, window,
    startedAt: now().toISOString(), status: 'RUNNING', orders: null, reviews: null, goodRate: null, effectiveRate: null, issues: [] }
  const recovered = new Set(), verified = new Set()
  let requestCount = 0
  const notify = (phase, extra = {}) => progress({ month, phase, requestCount, ...extra })
  const query = async (id, body, normalize, recover = false) => {
    const commit = async root => {
      await assertScope()
      const projected = normalize(root)
      if (!verified.has(id)) {
        await saveRecipe({ ...R[id], hotelId, profileId, verifiedAt: now().toISOString(),
          schemaHash: createHash('sha256').update(Object.keys(root || {}).sort().join('|')).digest('hex') })
        verified.add(id)
      }
      return projected
    }
    const attempt = async () => {
      await assertScope(); requestCount++
      return commit(await read(page, R[id], body))
    }
    try { return await attempt() } catch (error) {
      if (fatal(error) || !recover || recovered.has(id)) throw error
      recovered.add(id); notify('REDISCOVERING')
      const observed = await discover(page, R[id], assertScope, body)
      if (observed?.root) return commit(observed.root)
      return attempt()
    }
  }
  // Two read-only pages in flight at most. Await BOTH on failure before returning
  // control, so shutdown/another task never races orphaned page requests.
  const paginate = async ({ id, size, body, normalize, key, phase }) => {
    let first = await query(id, body(0), normalize, true)
    const pageCount = Math.max(1, Math.ceil(first.total / size)), rows = [], seen = new Set()
    dataAssert(pageCount <= maxPages, 'PAGE_LIMIT')
    const readPage = async index => {
      let value = index === 0 ? first : await query(id, body(index), normalize)
      const expected = Math.min(size, Math.max(0, first.total - index * size))
      for (let retry = 0; value.rows.length !== expected && retry < 2; retry++) {
        await pace(); value = await query(id, body(index), normalize)
      }
      dataAssert(value.total === first.total, 'TOTAL_CHANGED')
      dataAssert(value.rows.length === expected, 'INCOMPLETE_PAGE')
      if (id === 'reviewScope') dataAssert(value.pageIndex === index + 1)
      if (index === 0) first = value
      return value
    }
    for (let index = 0; index < pageCount; index += 2) {
      const jobs = [index, index + 1].filter(i => i < pageCount).map(readPage)
      const settled = await Promise.allSettled(jobs)
      const failure = settled.find(value => value.status === 'rejected' && fatal(value.reason))
        || settled.find(value => value.status === 'rejected')
      if (failure) throw failure.reason
      for (const { value } of settled) for (const row of value.rows) {
        dataAssert(!seen.has(key(row)), 'REPEATED_PAGE'); seen.add(key(row)); rows.push(row)
      }
      notify(phase, { fetched: rows.length, total: first.total, pages: Math.min(index + 2, pageCount) })
      await pace()
    }
    const final = await query(id, body(0), normalize)
    dataAssert(final.total === first.total && JSON.stringify(final.rows) === JSON.stringify(first.rows), 'SOURCE_CHANGED_DURING_READ')
    dataAssert(rows.length === first.total, 'INCOMPLETE_PAGE')
    return { rows, total: first.total, pages: pageCount }
  }
  await assertScope()
  try {
    notify('CATALOG')
    const catalog = await query('catalog', null, normalizeCtripCatalog, true)
    notify('ORDERS')
    const all = await paginate({ id: 'orders', size: 20, body: index => ctripOrderQuery('ArrivalDate', window, index),
      normalize: root => {
        const value = normalizeCtripOrderPage(root, catalog.hotelIds, 'ArrivalDate', window)
        return { ...value, rows: value.rows.map((row, index) => ({ ...row,
          alliance: typeof root.orderList[index].allinanceName === 'string' && /^[A-Za-z0-9_-]{1,64}$/u.test(root.orderList[index].allinanceName)
            ? root.orderList[index].allinanceName : null })) }
      }, key: row => row.record, phase: 'ORDERS' })
    dataAssert(all.rows.every(row => row.alliance), 'UNKNOWN_CHANNEL')
    // Filter by channel only AFTER all-provider pagination. The provider's channel
    // filtered offset pages were observed to repeat rows in the live August trial.
    const rows = all.rows.filter(row => row.alliance === 'ctrip')
    const summary = aggregateCtripOrders(rows, { total: rows.length, fetched: rows.length, pages: all.pages,
      complete: true, basis: 'ArrivalDate', window })
    dataAssert(summary.complete, 'UNKNOWN_ORDER_STATUS')
    notify('VERIFY_CHECKIN')
    const checkedInQuery = ctripOrderQuery('ArrivalDate', window, 0)
    checkedInQuery.orderQueryCondition.allicanceNames = ['ctrip']
    // Observed from the official 已入住 tab; not a guessed status filter.
    checkedInQuery.orderQueryCondition.queryCustemFilter = 'CheckedIn'
    const checkedIn = await query('orders', checkedInQuery, root => {
      const value = normalizeCtripOrderPage(root, catalog.hotelIds, 'ArrivalDate', window)
      dataAssert(root.orderList.every(row => row.allinanceName === 'ctrip'))
      dataAssert(value.rows.every(row => row.status === 'CheckIn' && rows.some(known => known.record === row.record && known.status === row.status)), 'CHECKIN_COUNT_MISMATCH')
      return value
    })
    dataAssert(checkedIn.total === (summary.statusCounts.CheckIn || 0), 'CHECKIN_COUNT_MISMATCH')
    result.orders = { checkedIn: checkedIn.total, confirmed: summary.statusCounts.Receipt || 0,
      effective: summary.effectiveOrders, excluded: summary.excludedOrders, total: summary.uniqueOrders,
      sourceRecords: all.total, sourcePages: all.pages, otherChannelRecords: all.total - rows.length,
      complete: true, statusCounts: summary.statusCounts }
  } catch (error) { if (fatal(error)) throw error; result.issues.push({ dataset: 'orders', code: safeIssue(error) }) }
  try {
    notify('REVIEWS')
    // A publication-month filter misses next-month reviews for this stay cohort.
    // Scan projected review metadata only, and select the provider's stay month.
    const all = await paginate({ id: 'reviewScope', size: 10, body: index => ctripMonthlyReviewQuery(index + 1),
      normalize: root => normalizeCtripMonthlyReviews(root, hotelId), key: row => row.key, phase: 'REVIEWS' })
    const summary = aggregateMonthlyReviews(all.rows, window)
    dataAssert(summary.missingStayMonth === 0, 'UNKNOWN_REVIEW_MONTH')
    result.reviews = { ...summary, sourceRecords: all.total, sourcePages: all.pages, complete: true }
  } catch (error) { if (fatal(error)) throw error; result.issues.push({ dataset: 'reviews', code: safeIssue(error) }) }
  await assertScope()
  result.status = result.orders && result.reviews && !result.issues.length ? 'COMPLETE' : 'PARTIAL'
  if (result.status === 'COMPLETE') {
    if (result.orders.checkedIn > 0) result.goodRate = result.reviews.good / result.orders.checkedIn * 100
    if (result.orders.effective > 0) result.effectiveRate = result.reviews.good / result.orders.effective * 100
  }
  result.completedAt = now().toISOString()
  result.requestCount = requestCount
  result.durationMs = Date.parse(result.completedAt) - Date.parse(result.startedAt)
  notify('FINISHED')
  return result
}
