import { createHmac } from 'node:crypto'
import { isAuthenticationUrl } from './luopan-network-sanitizer.mjs'

const SEARCH_URL =
  'http://bj.chinapms.com:8880/pms-web/room_register/room_register_search.do'
const PAGE_SIZE = 10
const MAX_PAGES = 200
const FETCH_CONCURRENCY = 4

const canonicalDate = (value) => {
  const text = String(value ?? '').trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null
  const parsed = new Date(`${text}T00:00:00Z`)
  return !Number.isNaN(parsed.getTime())
    && parsed.toISOString().slice(0, 10) === text
      ? text
      : null
}

const addCalendarDays = (date, days) => {
  const parsed = new Date(`${date}T00:00:00Z`)
  parsed.setUTCDate(parsed.getUTCDate() + days)
  return parsed.toISOString().slice(0, 10)
}

const normalizedStatus = (value) => {
  const text = String(value ?? '').replace(/\s+/g, '')
  if (/作废|取消|未到|NoShow/i.test(text)) return 'INVALID'
  if (/退房|离店|历史|结账/.test(text)) return 'CHECKED_OUT'
  if (/在住|入住/.test(text)) return 'IN_HOUSE'
  return 'OTHER'
}

const stableId = ({ hotelId, recordKey, secretKey }) =>
  createHmac('sha256', secretKey)
    .update(`luopan-register:${hotelId}:${recordKey}`)
    .digest('hex')

export const summarizeLuopanStayedOrderPages = ({
  pages,
  hotelId,
  businessDate,
  secretKey,
}) => {
  const effectiveBusinessDate = canonicalDate(businessDate)
  if (
    !effectiveBusinessDate
    || typeof hotelId !== 'string'
    || hotelId.length < 3
    || typeof secretKey !== 'string'
    || secretKey.length < 20
  ) {
    throw new Error('LUOPAN_STAYED_ORDER_SUMMARY_INVALID')
  }
  const throughDate = addCalendarDays(effectiveBusinessDate, -1)
  const monthStart = `${throughDate.slice(0, 7)}-01`
  const statusCounts = {
    CHECKED_OUT: 0,
    IN_HOUSE: 0,
    INVALID: 0,
    OTHER: 0,
  }
  const validIds = new Set()
  let fetchedRowCount = 0

  for (const page of pages ?? []) {
    for (const row of page ?? []) {
      if (
        typeof row?.recordKey !== 'string'
        || row.recordKey.length < 1
        || row.recordKey.length > 256
        || !canonicalDate(row.checkoutDate)
      ) continue
      fetchedRowCount += 1
      const status = normalizedStatus(row.status)
      statusCounts[status] += 1
      if (
        status !== 'CHECKED_OUT'
        || row.checkoutDate < monthStart
        || row.checkoutDate > throughDate
      ) continue
      validIds.add(stableId({ hotelId, recordKey: row.recordKey, secretKey }))
    }
  }

  if (statusCounts.OTHER > 0 || statusCounts.IN_HOUSE > 0) {
    throw new Error('LUOPAN_STAYED_ORDER_STATUS_UNRECOGNIZED')
  }
  return {
    businessDate: effectiveBusinessDate,
    monthStart,
    throughDate,
    validStayedOrderCount: validIds.size,
    fetchedRowCount,
    pageCount: pages?.length ?? 0,
    statusCounts,
    deduplicationBasis: 'HMAC_INTERNAL_REGISTRATION_ID',
    storesGuestData: false,
    storesRawRegisterNumbers: false,
  }
}

const submitFirstPage = async (page, monthStart, throughDate) => {
  await page.goto(SEARCH_URL, {
    waitUntil: 'domcontentloaded',
    timeout: 30_000,
  })
  if (isAuthenticationUrl(page.url())) {
    throw new Error('LUOPAN_REAUTH_REQUIRED')
  }
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 30_000 }),
    page.evaluate(({ start, end, pageSize }) => {
      const form = document.querySelector(
        'form[action*="room_register_search.do"]',
      )
      if (!form) throw new Error('SEARCH_FORM_MISSING')
      const set = (name, value) => {
        const control = form.elements.namedItem(name)
        if (!control) throw new Error(`SEARCH_FIELD_MISSING:${name}`)
        control.value = value
      }
      set('start_checkout_date', start)
      set('end_checkout_date', end)
      set('is_checkout', 'true')
      set('pageNo', '1')
      set('pageSize', String(pageSize))
      form.submit()
    }, { start: monthStart, end: throughDate, pageSize: PAGE_SIZE }),
  ])
  if (isAuthenticationUrl(page.url())) {
    throw new Error('LUOPAN_REAUTH_REQUIRED')
  }
  return page.evaluate(() => {
    const clean = (value) => String(value ?? '').replace(/\s+/g, ' ').trim()
    const target = [...document.querySelectorAll('table')].find((table) => {
      const headers = [...table.querySelectorAll('th')]
        .map((header) => clean(header.textContent))
      return headers.includes('登记单号')
        && headers.includes('状态')
        && headers.includes('离店日期')
    })
    if (!target) throw new Error('RESULT_TABLE_MISSING')
    const headers = [...target.querySelectorAll('th')]
      .map((header) => clean(header.textContent))
    const statusIndex = headers.indexOf('状态')
    const checkoutIndex = headers.indexOf('离店日期')
    const rows = [...target.querySelectorAll('tr')]
      .map((row) => [...row.querySelectorAll('td')])
      .filter((cells) => cells.length >= headers.length)
      .map((cells) => {
        let recordKey = ''
        try {
          const href = cells[0].querySelector('a[href]')?.href
          recordKey = href
            ? new URL(href, window.location.href).searchParams.get('id') ?? ''
            : ''
        } catch {
          recordKey = ''
        }
        return {
          recordKey,
          status: clean(cells[statusIndex].textContent),
          checkoutDate: clean(cells[checkoutIndex].textContent),
        }
      })
      .filter((row) => row.recordKey)
    const gotoPages = [...document.querySelectorAll('a[onclick]')]
      .map((anchor) => String(anchor.getAttribute('onclick') ?? '')
        .match(/Pagination\.goto\(this,\s*(\d+)\s*\)/)?.[1])
      .filter(Boolean)
      .map(Number)
      .filter(Number.isSafeInteger)
    return {
      rows,
      totalPages: Math.max(1, ...gotoPages),
    }
  })
}

const fetchPageBatch = (page, pageNumbers) => page.evaluate(
  async ({ targets, pageSize }) => {
    const parseRows = (root) => {
      const clean = (value) => String(value ?? '').replace(/\s+/g, ' ').trim()
      const target = [...root.querySelectorAll('table')].find((table) => {
        const headers = [...table.querySelectorAll('th')]
          .map((header) => clean(header.textContent))
        return headers.includes('登记单号')
          && headers.includes('状态')
          && headers.includes('离店日期')
      })
      if (!target) throw new Error('RESULT_TABLE_MISSING')
      const headers = [...target.querySelectorAll('th')]
        .map((header) => clean(header.textContent))
      const statusIndex = headers.indexOf('状态')
      const checkoutIndex = headers.indexOf('离店日期')
      return [...target.querySelectorAll('tr')]
        .map((row) => [...row.querySelectorAll('td')])
        .filter((cells) => cells.length >= headers.length)
        .map((cells) => {
          let recordKey = ''
          try {
            const href = cells[0].querySelector('a[href]')?.href
            recordKey = href
              ? new URL(href, window.location.href)
                .searchParams.get('id') ?? ''
              : ''
          } catch {
            recordKey = ''
          }
          return {
            recordKey,
            status: clean(cells[statusIndex].textContent),
            checkoutDate: clean(cells[checkoutIndex].textContent),
          }
        })
        .filter((row) => row.recordKey)
    }
    const form = document.querySelector(
      'form[action*="room_register_search.do"]',
    )
    if (!form) throw new Error('SEARCH_FORM_MISSING')
    return Promise.all(targets.map(async (pageNo) => {
      const body = new URLSearchParams(new FormData(form))
      body.set('pageNo', String(pageNo))
      body.set('pageSize', String(pageSize))
      const response = await fetch(form.action, {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
          Accept: 'text/html,application/xhtml+xml',
          'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
        },
        body: body.toString(),
      })
      if (!response.ok) throw new Error(`SEARCH_HTTP_${response.status}`)
      const html = await response.text()
      if (/\/pms-web\/login\/login\.do/i.test(html)) {
        throw new Error('REAUTH_REQUIRED')
      }
      const parsed = new DOMParser().parseFromString(html, 'text/html')
      return parseRows(parsed)
    }))
  },
  {
    targets: pageNumbers,
    pageSize: PAGE_SIZE,
  },
)

export const collectLuopanStayedOrderSummary = async ({
  page,
  hotelId,
  businessDate,
  secretKey,
}) => {
  const effectiveBusinessDate = canonicalDate(businessDate)
  if (!page || !effectiveBusinessDate) {
    throw new Error('LUOPAN_STAYED_ORDER_QUERY_INVALID')
  }
  const throughDate = addCalendarDays(effectiveBusinessDate, -1)
  const monthStart = `${throughDate.slice(0, 7)}-01`
  const first = await submitFirstPage(page, monthStart, throughDate)
  if (
    !Number.isSafeInteger(first.totalPages)
    || first.totalPages < 1
    || first.totalPages > MAX_PAGES
  ) {
    throw new Error('LUOPAN_STAYED_ORDER_PAGE_LIMIT_EXCEEDED')
  }
  const pages = [first.rows]
  for (let start = 2; start <= first.totalPages; start += FETCH_CONCURRENCY) {
    const targets = Array.from(
      { length: Math.min(FETCH_CONCURRENCY, first.totalPages - start + 1) },
      (_, index) => start + index,
    )
    pages.push(...await fetchPageBatch(page, targets))
  }
  if (pages.length !== first.totalPages) {
    throw new Error('LUOPAN_STAYED_ORDER_PAGINATION_INCOMPLETE')
  }
  return summarizeLuopanStayedOrderPages({
    pages,
    hotelId,
    businessDate: effectiveBusinessDate,
    secretKey,
  })
}

export const luopanStayedOrderCollectorLimits = Object.freeze({
  pageSize: PAGE_SIZE,
  maxPages: MAX_PAGES,
  fetchConcurrency: FETCH_CONCURRENCY,
})
