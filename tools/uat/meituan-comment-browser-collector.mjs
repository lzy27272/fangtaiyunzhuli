import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import process from 'node:process'

const require = createRequire(import.meta.url)
const MEITUAN_COMMENT_HOST = 'me.meituan.com'
const MEITUAN_COMMENT_API_PATH =
  '/api/gw/v1/base/comments/queryGeneralCommentInfo'
const MEITUAN_COMMENT_PAGE =
  'https://me.meituan.com/ebooking/merchant/comment-manage-react#/home'
const PAGE_SIZE = 10
const MAX_PAGES = 100
const SHANGHAI_TIME_ZONE = 'Asia/Shanghai'

let cachedChromium = null
const chromiumFor = () => {
  if (cachedChromium) return cachedChromium
  try {
    const module = require(process.env.UAT_PLAYWRIGHT_MODULE ?? 'playwright')
    cachedChromium = module.chromium
    return cachedChromium
  } catch {
    throw new Error('OTA_MEITUAN_COMMENT_BROWSER_RUNTIME_UNAVAILABLE')
  }
}

const browserExecutableFor = () =>
  process.env.UAT_BROWSER_EXECUTABLE
  || process.env.LUOPAN_BROWSER_EXECUTABLE
  || [
    '/usr/bin/google-chrome',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  ].find(existsSync)

const shanghaiDate = (value) => {
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return null
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: SHANGHAI_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date)
  const values = Object.fromEntries(
    parts
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, part.value]),
  )
  return `${values.year}-${values.month}-${values.day}`
}

const addCalendarDays = (date, days) => {
  const parsed = new Date(`${date}T00:00:00Z`)
  if (Number.isNaN(parsed.getTime())) return null
  parsed.setUTCDate(parsed.getUTCDate() + days)
  return parsed.toISOString().slice(0, 10)
}

const canonicalDate = (value) => {
  const text = String(value ?? '')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null
  const parsed = new Date(`${text}T00:00:00Z`)
  return !Number.isNaN(parsed.getTime())
    && parsed.toISOString().slice(0, 10) === text
      ? text
      : null
}

const cookieRecords = (header) => String(header ?? '')
  .split(';')
  .map((entry) => entry.trim())
  .filter(Boolean)
  .map((entry) => {
    const separator = entry.indexOf('=')
    if (separator < 1) return null
    return {
      name: entry.slice(0, separator).trim(),
      value: entry.slice(separator + 1),
      domain: '.meituan.com',
      path: '/',
      secure: true,
      sameSite: 'Lax',
    }
  })
  .filter(Boolean)

const normalizedScore = (value) => {
  const score = Number(value)
  return Number.isFinite(score) && score >= 0 && score <= 50
    ? score
    : null
}

export const isMeituanCommentSource = ({ source, endpoint }) =>
  source?.platformCode === 'MEITUAN'
  && source?.requestMethod === 'GET'
  && endpoint?.hostname?.toLowerCase() === MEITUAN_COMMENT_HOST
  && endpoint?.pathname === MEITUAN_COMMENT_API_PATH

export const summarizeMeituanCommentPages = ({
  pages,
  businessDate,
  businessDateBasis = 'SYSTEM_DATE_FALLBACK',
  validStayedOrderCountThroughPreviousBusinessDate = null,
}) => {
  const effectiveBusinessDate = canonicalDate(businessDate)
  if (!effectiveBusinessDate) {
    throw new Error('OTA_MEITUAN_COMMENT_BUSINESS_DATE_INVALID')
  }
  const previousBusinessDate = addCalendarDays(effectiveBusinessDate, -1)
  const monthStart = `${effectiveBusinessDate.slice(0, 7)}-01`
  let monthlyGoodCount = 0
  let monthlyNegativeCount = 0
  let yesterdayNegativeCount = 0
  let goodCountThroughPreviousBusinessDate = 0
  let negativeCountThroughPreviousBusinessDate = 0
  let oldestObservedDate = null
  let totalAllTime = null
  let rowCount = 0

  for (const page of pages) {
    if (Number.isSafeInteger(page?.total) && page.total >= 0) {
      totalAllTime = page.total
    }
    for (const row of page?.rows ?? []) {
      const date = shanghaiDate(Number(row?.commentTime))
      const score = normalizedScore(row?.score)
      if (!date || score === null) continue
      rowCount += 1
      if (!oldestObservedDate || date < oldestObservedDate) {
        oldestObservedDate = date
      }
      if (date < monthStart || date > effectiveBusinessDate) continue
      if (score >= 48) monthlyGoodCount += 1
      if (score < 30) monthlyNegativeCount += 1
      if (date <= previousBusinessDate) {
        if (score >= 48) goodCountThroughPreviousBusinessDate += 1
        if (score < 30) negativeCountThroughPreviousBusinessDate += 1
      }
      if (date === previousBusinessDate && score < 30) {
        yesterdayNegativeCount += 1
      }
    }
  }

  const paginationComplete =
    oldestObservedDate !== null
    && oldestObservedDate < monthStart
  const exhausted =
    totalAllTime !== null
    && rowCount >= totalAllTime
  const denominator = Number.isSafeInteger(
    validStayedOrderCountThroughPreviousBusinessDate,
  ) && validStayedOrderCountThroughPreviousBusinessDate > 0
    ? validStayedOrderCountThroughPreviousBusinessDate
    : null

  return {
    provider: 'MEITUAN',
    businessDate: effectiveBusinessDate,
    businessDateBasis,
    previousBusinessDate,
    monthStart,
    monthlyGoodCount,
    monthlyNegativeCount,
    yesterdayNegativeCount,
    goodCountThroughPreviousBusinessDate,
    negativeCountThroughPreviousBusinessDate,
    validStayedOrderCountThroughPreviousBusinessDate: denominator,
    goodRatePercent: denominator === null
      ? null
      : Number((goodCountThroughPreviousBusinessDate / denominator * 100)
        .toFixed(2)),
    negativeRatePermille: denominator === null
      ? null
      : Number((negativeCountThroughPreviousBusinessDate / denominator * 1000)
        .toFixed(2)),
    denominatorStatus: denominator === null
      ? 'PMS_VALID_STAYED_ORDER_COUNT_UNAVAILABLE'
      : 'AVAILABLE',
    totalAllTime,
    fetchedRowCount: rowCount,
    fetchedPageCount: pages.length,
    paginationComplete: paginationComplete || exhausted,
  }
}

const fetchCommentPage = (page, endpoint, offset) => page.evaluate(
  async ({ endpointUrl, pageOffset, pageSize }) => {
    try {
      const url = new URL(endpointUrl)
      url.searchParams.delete('mtgsig')
      url.searchParams.set('offset', String(pageOffset))
      url.searchParams.set('limit', String(pageSize))
      url.searchParams.set('replyType', '0')
      const response = await fetch(url.toString(), {
        credentials: 'include',
        headers: { Accept: 'application/json, text/plain, */*' },
      })
      if (!response.ok) return { status: response.status, rows: [], total: null }
      const root = await response.json()
      const sourceRows = Array.isArray(root?.data?.commentList)
        ? root.data.commentList
        : []
      return {
        status: response.status,
        total: Number.isFinite(Number(root?.data?.total))
          ? Number(root.data.total)
          : null,
        rows: sourceRows.map((row) => ({
          commentTime: Number(row?.commentTime),
          score: Number(row?.score),
        })),
      }
    } catch {
      return { status: null, rows: [], total: null }
    }
  },
  {
    endpointUrl: endpoint.toString(),
    pageOffset: offset,
    pageSize: PAGE_SIZE,
  },
)

export const collectMeituanCommentSummary = async ({
  source,
  endpoint,
  cookie,
  businessDate,
  validStayedOrderCountThroughPreviousBusinessDate = null,
  now = () => new Date(),
  chromium = chromiumFor(),
  browserExecutable = browserExecutableFor(),
}) => {
  if (!isMeituanCommentSource({ source, endpoint })) {
    throw new Error('OTA_MEITUAN_COMMENT_SOURCE_INVALID')
  }
  if (!browserExecutable || !existsSync(browserExecutable)) {
    throw new Error('OTA_MEITUAN_COMMENT_BROWSER_NOT_FOUND')
  }
  const cookies = cookieRecords(cookie)
  if (cookies.length < 1) throw new Error('OTA_COOKIE_REQUIRED_FOR_REFRESH')
  const observed = now()
  const effectiveBusinessDate = canonicalDate(businessDate)
    ?? shanghaiDate(observed)
  const businessDateBasis = canonicalDate(businessDate)
    ? 'PMS_CONFIRMED'
    : 'SYSTEM_DATE_FALLBACK'
  const monthStart = `${effectiveBusinessDate.slice(0, 7)}-01`
  const browser = await chromium.launch({
    headless: true,
    executablePath: browserExecutable,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  })
  try {
    const context = await browser.newContext({
      locale: 'zh-CN',
      timezoneId: SHANGHAI_TIME_ZONE,
    })
    try {
      await context.addCookies(cookies)
      const page = await context.newPage()
      const initialResponse = page.waitForResponse(
        (response) => {
          try {
            return new URL(response.url()).pathname === MEITUAN_COMMENT_API_PATH
          } catch {
            return false
          }
        },
        { timeout: 30_000 },
      )
      await page.goto(MEITUAN_COMMENT_PAGE, {
        waitUntil: 'domcontentloaded',
        timeout: 30_000,
      })
      await initialResponse
      if (/\/login(?:\/|$)/i.test(page.url())) {
        throw new Error('OTA_MEITUAN_COMMENT_REAUTH_REQUIRED')
      }
      const pages = []
      let crossedMonthBoundary = false
      for (let offset = 1; offset <= MAX_PAGES; offset += 1) {
        const result = await fetchCommentPage(page, endpoint, offset)
        if (result.status !== 200) {
          throw new Error(
            Number.isInteger(result.status)
              ? `OTA_MEITUAN_COMMENT_HTTP_${result.status}`
              : 'OTA_MEITUAN_COMMENT_FETCH_FAILED',
          )
        }
        pages.push(result)
        const dates = result.rows
          .map((row) => shanghaiDate(row.commentTime))
          .filter(Boolean)
        if (dates.length > 0 && dates.every((date) => date < monthStart)) {
          crossedMonthBoundary = true
          break
        }
        if (result.rows.length < PAGE_SIZE) break
      }
      const reviewMetrics = summarizeMeituanCommentPages({
        pages,
        businessDate: effectiveBusinessDate,
        businessDateBasis,
        validStayedOrderCountThroughPreviousBusinessDate,
      })
      if (!reviewMetrics.paginationComplete && !crossedMonthBoundary) {
        throw new Error('OTA_MEITUAN_COMMENT_PAGINATION_INCOMPLETE')
      }
      return {
        observedAt: observed.toISOString(),
        httpStatus: 200,
        rootType: 'OBJECT',
        recordPath: '$.data.commentList',
        recordCount: reviewMetrics.fetchedRowCount,
        detectedDimensions: ['REVIEW'],
        detectedFields: ['commentTime', 'score'],
        reviewMetrics,
      }
    } finally {
      await context.close()
    }
  } finally {
    await browser.close()
  }
}

export const meituanCommentCollectorLimits = Object.freeze({
  pageSize: PAGE_SIZE,
  maxPages: MAX_PAGES,
})
