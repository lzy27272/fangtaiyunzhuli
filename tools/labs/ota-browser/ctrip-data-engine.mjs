import { createHash } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'
import { CTRIP_DATA_RECIPES as RECIPES, dataAssert, ctripDataWindow, shiftDay,
  normalizeCtripCatalog, inventoryQuery, normalizeCtripInventory, normalizeCtripReviews,
  ctripOrderQuery, normalizeCtripOrderPage, aggregateCtripOrders,
  normalizeCtripLiveTraffic, normalizeCtripTraffic } from './ctrip-data-contract.mjs'

const ORIGIN = 'https://ebooking.ctrip.com'
const ERROR_CODES = new Set(['CTRIP_DATA_SCHEMA_CHANGED', 'CTRIP_DATA_PROVIDER_REJECTED',
  'CTRIP_DATA_SCOPE_MISMATCH', 'CTRIP_DATA_DATE_MISMATCH', 'CTRIP_DATA_LOGIN_REQUIRED',
  'CTRIP_DATA_READ_FAILED', 'CTRIP_DATA_CANCELLED', 'CTRIP_DATA_RESPONSE_TOO_LARGE'])
export const ctripDataError = error => ERROR_CODES.has(error?.message) ? error.message : 'CTRIP_DATA_READ_FAILED'
const fatal = error => ['CTRIP_DATA_SCOPE_MISMATCH', 'CTRIP_DATA_LOGIN_REQUIRED', 'CTRIP_DATA_CANCELLED'].includes(error?.message)

// No cookies, authentication headers, browser storage, copied request bodies or
// anti-bot parameters are extracted. Fetch runs inside the existing own profile.
export const fetchCtripData = async (page, recipe, body) => {
  dataAssert(RECIPES[recipe.id] === recipe && new URL(page.url()).origin === ORIGIN, 'CTRIP_DATA_SCOPE_MISMATCH')
  const response = await page.evaluate(async ({ path, body }) => {
    try {
      const response = await fetch(path, { method: 'POST', credentials: 'same-origin', redirect: 'error',
        headers: { 'Content-Type': 'application/json;charset=UTF-8' },
        ...(body === null ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(15000) })
      if ([401, 403].includes(response.status)) return { error: 'CTRIP_DATA_LOGIN_REQUIRED' }
      if (response.status !== 200 || !/json/i.test(response.headers.get('content-type') || '')) return { error: 'CTRIP_DATA_PROVIDER_REJECTED' }
      const reader = response.body.getReader(), chunks = []; let size = 0
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        size += value.byteLength
        if (size > 4 * 1024 * 1024) { await reader.cancel(); return { error: 'CTRIP_DATA_RESPONSE_TOO_LARGE' } }
        chunks.push(value)
      }
      const bytes = new Uint8Array(size); let offset = 0
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
      return { root: JSON.parse(new TextDecoder().decode(bytes)) }
    } catch { return { error: 'CTRIP_DATA_READ_FAILED' } }
  }, { path: recipe.path, body })
  if (response.error) throw new Error(ctripDataError(new Error(response.error)))
  return response.root
}

export const ctripDataQueryMatches = (actual, expected) => {
  if (expected === null) return actual == null || (typeof actual === 'object' && !Array.isArray(actual) && Object.keys(actual).length === 0)
  if (Array.isArray(expected)) return Array.isArray(actual) && actual.length === expected.length && expected.every((v, i) => ctripDataQueryMatches(actual[i], v))
  if (expected && typeof expected === 'object') return actual && typeof actual === 'object'
    && Object.entries(expected).every(([key, value]) => Object.hasOwn(actual, key) && ctripDataQueryMatches(actual[key], value))
  return actual === expected
}

export const rediscoverCtripData = async (page, recipe, assertScope, expectedBody) => {
  await assertScope()
  let observed = false
  let candidate = null
  const belongs = request => {
    try {
      const url = new URL(request.url())
      return request.frame() === page.mainFrame() && url.origin === ORIGIN && !url.search
        && url.pathname === recipe.path && request.method() === recipe.method
    } catch { return false }
  }
  const listener = request => {
    if (belongs(request)) observed = true
  }
  const responses = new Set()
  const responseListener = response => {
    if (!belongs(response.request()) || response.status() !== 200) return
    const task = (async () => {
      let actual
      try { actual = response.request().postDataJSON() } catch { return }
      if (!ctripDataQueryMatches(actual, expectedBody) || !/json/i.test(response.headers()['content-type'] || '')
        || Number(response.headers()['content-length']) > 4 * 1024 * 1024) return
      const bytes = await response.body()
      if (bytes.length <= 4 * 1024 * 1024) candidate = { root: JSON.parse(bytes.toString('utf8')) }
    })().catch(() => undefined)
    responses.add(task)
    void task.finally(() => responses.delete(task))
  }
  page.on('request', listener)
  page.on('response', responseListener)
  try {
    await page.goto(ORIGIN + recipe.page, { waitUntil: 'domcontentloaded', timeout: 30000 })
    // eBooking mounts its hotel header before the authenticated sidebar. Wait for
    // both visible identity surfaces, then perform the same strict scope check.
    // A transitional half-rendered page must not be mistaken for another hotel.
    try {
      await page.waitForFunction(() => {
        const visible = n => n.getClientRects().length && getComputedStyle(n).visibility !== 'hidden'
        const links = [...document.querySelectorAll('a.he-ctrip-hotel-title-link')].filter(visible)
        const navigation = [...document.querySelectorAll('a,nav,[role="menuitem"]')].filter(visible).map(n => n.innerText || '').join('\n')
        return links.length > 0 && /订单管理|订单查询|全部订单/.test(navigation) && /房态|房价|收益|酒店信息/.test(navigation)
      }, undefined, { timeout: 10000 })
    } catch (error) { await assertScope(); throw error }
    for (let attempt = 0; attempt < 40 && !candidate; attempt++) await delay(250)
    await assertScope()
    dataAssert(observed, 'CTRIP_DATA_SCHEMA_CHANGED')
    return candidate
  } finally { page.off('request', listener); page.off('response', responseListener) }
}

export const collectCtripData = async ({ page, hotelId, profileId, assertScope, now = () => new Date(),
  progress = () => {}, saveRecipe = async () => {}, read = fetchCtripData,
  discover = rediscoverCtripData, pace = () => delay(200), maxPages = 300 } = {}) => {
  const window = ctripDataWindow(now())
  const result = { version: 1, hotelId, profileId, startedAt: now().toISOString(),
    window, status: 'RUNNING', datasets: {}, verifiedRecipeCount: 0 }
  const verified = new Set(), recovered = new Set()
  let requestCount = 0
  let orderPhase = null
  const notify = phase => {
    if (phase.startsWith('ordersBy')) orderPhase = phase
    progress({ phase: phase === 'orders' && orderPhase ? orderPhase : phase, requestCount, verifiedRecipeCount: verified.size })
  }
  const query = async (id, body, normalize) => {
    const recipe = RECIPES[id]
    const commit = async root => {
      await assertScope()
      const projected = normalize(root)
      if (!verified.has(id)) {
        // Persist only known recipe metadata AFTER response/scope validation.
        // Raw bodies and unknown response fields never enter this record.
        await saveRecipe({ ...recipe, profileId, hotelId, verifiedAt: now().toISOString(),
          schemaHash: createHash('sha256').update(Object.keys(root || {}).sort().join('|')).digest('hex') })
        verified.add(id)
      }
      return projected
    }
    const attempt = async () => {
      await assertScope()
      requestCount++; notify(id)
      return commit(await read(page, recipe, body))
    }
    try { return await attempt() } catch (error) {
      if (fatal(error) || recovered.has(id)) throw error
      recovered.add(id); notify('REDISCOVERING')
      // Some eBooking routes require page-managed context beyond plain fetch.
      // Accept a normal page response only when its read-only request parameters
      // exactly cover this query; keep the same parser and before/after scope.
      const observed = await discover(page, recipe, assertScope, body)
      if (observed?.root) return commit(observed.root)
      return attempt()
    }
  }
  const dataset = async (key, operation) => {
    notify(key)
    try { result.datasets[key] = { status: 'COMPLETE', data: await operation() } }
    catch (error) {
      if (fatal(error)) throw error
      result.datasets[key] = { status: 'FAILED', error: ctripDataError(error) }
    }
  }
  await assertScope()
  let catalog
  await dataset('inventory', async () => {
    // The official catalog POST has NO body. Some routes also require page-managed
    // context; if a direct query returns empty, observe the normal page response.
    catalog = await query('catalog', null, normalizeCtripCatalog)
    const inventoryWindow = { startDate: window.today, endDate: shiftDay(window.today, 13) }
    const rooms = []
    for (const room of catalog.rooms) {
      rooms.push(await query('inventory', inventoryQuery(room, inventoryWindow), root => normalizeCtripInventory(root, room, inventoryWindow)))
      await pace()
    }
    return { ...inventoryWindow, scope: 'CHANNEL_ROOM_STATUS', rooms }
  })
  await dataset('reviews', async () => {
    // Scope response is projected immediately; review text and reviewer identities
    // are deliberately discarded before returning from this operation.
    const scope = await query('reviewScope', { keyWord: '', pageIndex: 1, commentStatus: '', isNeedTranslate: false,
      sortType: 0, catalogTab: 'all', catalogName: '全部点评', pageSize: 10, needOrder: false,
      startDate: '', endDate: '', channelSource: '1' }, root => {
      dataAssert(root?.resStatus?.rcode === 200 && root.ResponseStatus?.Ack === 'Success', 'CTRIP_DATA_PROVIDER_REJECTED')
      dataAssert(String(root.masterHotelId) === hotelId, 'CTRIP_DATA_SCOPE_MISMATCH')
      return { resStatus: { rcode: 200 }, ResponseStatus: { Ack: 'Success' }, masterHotelId: hotelId }
    })
    let rating
    await query('rating', { channelSource: 'trip' }, root => {
      dataAssert(root?.resStatus?.rcode === 200 && root.ResponseStatus?.Ack === 'Success' && typeof root.ctripRatings?.ratingAll === 'number')
      rating = { resStatus: { rcode: 200 }, ResponseStatus: { Ack: 'Success' },
        ctripRatings: Object.fromEntries(['ratingAll', 'ratingLocation', 'ratingFacility', 'ratingService', 'ratingRoom'].map(k => [k, root.ctripRatings[k]])) }
    })
    return query('reviews', { channelSources: ['trip'] }, counts => normalizeCtripReviews(rating, counts, scope, hotelId))
  })
  await dataset('traffic', async () => {
    const live = await query('liveTraffic', {}, normalizeCtripLiveTraffic)
    const series = async dataType => query('traffic', { platform: 'Ctrip', channelType: '0',
      startDate: window.startDate, endDate: window.endDate, dateDimension: '0', dataType },
    root => normalizeCtripTraffic(root, window))
    return { platform: 'Ctrip', live, startDate: window.startDate, endDate: window.endDate,
      own: await series(0), competitorAverage: await series(3) }
  })
  for (const basis of ['OrderDate', 'ArrivalDate']) {
    const key = basis === 'OrderDate' ? 'ordersByBooking' : 'ordersByArrival'
    await dataset(key, async () => {
      // A missing catalog is unavailable scope evidence, not evidence of another
      // hotel. Fail orders without discarding independently validated reviews.
      dataAssert(catalog?.hotelIds?.length, 'CTRIP_DATA_SCHEMA_CHANGED')
      const rows = [], records = new Set()
      // OrderDate queries also return modification forms whose original orderDate
      // is older. Include today's modifications, then filter original booking
      // dates locally. Today's newly booked orders are excluded from the report.
      const queryWindow = basis === 'OrderDate' ? { ...window, endDate: window.today } : window
      let total = null, fetched = 0, pages = 0, complete = false, issue = null
      for (let index = 0; index < maxPages; index++) {
        let response
        try {
          for (let retry = 0; retry < 3; retry++) {
            response = await query('orders', ctripOrderQuery(basis, queryWindow, index),
              root => normalizeCtripOrderPage(root, catalog.hotelIds, basis, window))
            if (response.rows.length === Math.min(20, Math.max(0, response.total - index * 20))) break
            if (retry < 2) await pace()
          }
        }
        catch (error) { if (fatal(error) || !pages) throw error; issue = ctripDataError(error); break }
        if (total !== null && response.total !== total) { issue = 'TOTAL_CHANGED'; break }
        total = response.total; pages++
        if (response.rows.some(row => records.has(row.record))
          || new Set(response.rows.map(row => row.record)).size !== response.rows.length) { issue = 'REPEATED_PAGE'; break }
        for (const row of response.rows) { records.add(row.record); rows.push(row) }
        fetched += response.rows.length
        notify(`${key}:${fetched}/${total}`)
        if (fetched === total) { complete = true; break }
        if (fetched > total || response.rows.length !== 20) { issue = 'INCOMPLETE_PAGE'; break }
        await pace()
      }
      if (!complete && !issue) issue = 'PAGE_LIMIT'
      if (complete && pages > 1) {
        // No provider snapshot token exists. Recheck the leading page to detect
        // common insertion/status changes during offset pagination.
        const final = await query('orders', ctripOrderQuery(basis, queryWindow, 0),
          root => normalizeCtripOrderPage(root, catalog.hotelIds, basis, window))
        const fingerprint = values => JSON.stringify(values.map(r => [r.record, r.key, r.changedAt, r.status, r.quantity, r.nights]))
        if (final.total !== total || fingerprint(final.rows) !== fingerprint(rows.slice(0, 20))) {
          complete = false; issue = 'SOURCE_CHANGED_DURING_READ'
        }
      }
      return aggregateCtripOrders(rows, { total, fetched, pages, complete, basis, window, issue })
    })
    if (result.datasets[key].data && !result.datasets[key].data.complete) result.datasets[key].status = 'PARTIAL'
  }
  await assertScope()
  result.verifiedRecipeCount = verified.size
  result.completedAt = now().toISOString()
  result.status = Object.values(result.datasets).every(d => d.status === 'COMPLETE') ? 'COMPLETE' : 'PARTIAL'
  notify('FINISHED')
  return result
}
