import { createHash } from 'node:crypto'

const FLIGGY_MTOP_HOST = 'h5api.m.fliggy.com'
const FLIGGY_ORDER_API = 'mtop.taobao.hotel.ebooking.order.list.get'
const FLIGGY_LEGACY_REVIEW_HOST = 'hotel.fliggy.com'
const FLIGGY_LEGACY_REVIEW_PATH = '/ebooking/review/guestReviewV3.do'
const FLIGGY_REFERER = 'https://ebooking.fliggy.com/'
const FLIGGY_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) '
  + 'AppleWebKit/537.36 Chrome/140.0.0.0 Safari/537.36'
const FLIGGY_MAX_PAGES = 100
const FLIGGY_LEGACY_REVIEW_MAX_PAGES = 500
const FLIGGY_PAGE_SIZE = 50
const FLIGGY_LEGACY_REVIEW_DEFAULT_PAGE_SIZE = 10
const FLIGGY_AGGREGATION_VERSION = 6
const EPHEMERAL_QUERY_KEYS = new Set([
  't',
  'sign',
  'bx-ua',
  'bx-umidtoken',
])

const canonicalDate = (value) => {
  const text = String(value ?? '').trim().replaceAll('/', '-')
  const match = text.match(/^(\d{4}-\d{2}-\d{2})/)
  if (!match) return null
  const parsed = new Date(`${match[1]}T00:00:00Z`)
  return !Number.isNaN(parsed.getTime())
    && parsed.toISOString().slice(0, 10) === match[1]
      ? match[1]
      : null
}

const shanghaiDate = (value) => {
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return null
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
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

const addCalendarDays = (date, offset) => {
  const parsed = new Date(`${date}T00:00:00Z`)
  parsed.setUTCDate(parsed.getUTCDate() + offset)
  return parsed.toISOString().slice(0, 10)
}

const dateValue = (value) => {
  const direct = canonicalDate(value)
  if (direct) return direct
  const numeric = Number(value)
  if (!Number.isFinite(numeric) || numeric <= 0) return null
  return shanghaiDate(numeric < 10_000_000_000 ? numeric * 1_000 : numeric)
}

const scalarLeaves = (value, path = '', depth = 0, leaves = []) => {
  if (depth > 7 || value === null || typeof value !== 'object') return leaves
  for (const [key, child] of Object.entries(value)) {
    const childPath = path ? `${path}.${key}` : key
    if (child !== null && typeof child === 'object') {
      scalarLeaves(child, childPath, depth + 1, leaves)
    } else if (['string', 'number', 'boolean'].includes(typeof child)) {
      leaves.push({ path: childPath, value: child })
    }
  }
  return leaves
}

const nestedValue = (value) => {
  if (typeof value !== 'string') return value
  const text = value.trim()
  if (!(text.startsWith('{') || text.startsWith('['))) return value
  try {
    return JSON.parse(text)
  } catch {
    return value
  }
}

const objectRows = (value, path = '$', depth = 0, candidates = []) => {
  if (depth > 7 || value === null) return candidates
  const normalized = nestedValue(value)
  if (normalized === null || typeof normalized !== 'object') return candidates
  if (
    Array.isArray(normalized)
    && normalized.some((item) => {
      const row = nestedValue(item)
      return row !== null && typeof row === 'object' && !Array.isArray(row)
    })
  ) {
    candidates.push({
      path,
      rows: normalized
        .map(nestedValue)
        .filter((item) =>
          item !== null && typeof item === 'object' && !Array.isArray(item)),
    })
  }
  if (!Array.isArray(normalized)) {
    for (const [key, child] of Object.entries(normalized)) {
      objectRows(child, `${path}.${key}`, depth + 1, candidates)
    }
  }
  return candidates
}

const safeResponseShape = (root) => {
  const arrays = []
  const signals = []
  const visit = (value, path = '$', depth = 0) => {
    if (depth > 5 || value === null || typeof value !== 'object') return
    if (Array.isArray(value)) {
      arrays.push({ path, length: value.length })
      return
    }
    for (const [key, child] of Object.entries(value)) {
      const childPath = `${path}.${key}`
      if (child !== null && typeof child === 'object') {
        visit(child, childPath, depth + 1)
      } else if (
        /^(?:success|issuccess|code|status|total|totalcount|recordcount|page|pageindex|pageno|pagesize|hasmore|hasnext)$/i
          .test(key)
      ) {
        signals.push({ path: childPath, type: typeof child })
      }
    }
  }
  visit(root)
  return {
    rootKeys:
      root && typeof root === 'object' && !Array.isArray(root)
        ? Object.keys(root).sort().slice(0, 30)
        : [],
    arrays: arrays.slice(0, 30),
    signals: signals.slice(0, 30),
  }
}

const fieldNames = (rows) => [...new Set(
  rows.slice(0, 200).flatMap((row) =>
    scalarLeaves(row).map((leaf) => leaf.path.split('.').at(-1) ?? '')),
)]
  .filter(Boolean)
  .sort()
  .slice(0, 60)

const sourceKind = ({ source, endpoint }) => {
  const api = endpoint.searchParams.get('api') ?? ''
  const text = `${api} ${endpoint.pathname} ${source?.displayName ?? ''}`
    .toLowerCase()
  if (/rank|ranking|排名/.test(text)) return 'RANK'
  if (/review|comment|evaluate|evaluation|rate\.list|评价|点评/.test(text)) {
    return 'REVIEW'
  }
  if (/order|booking|订单/.test(text)) return 'ORDER'
  return 'OTHER'
}

const kindFieldMatcher = (kind) => {
  if (kind === 'REVIEW') return /review|comment|evaluate|score|star|rating|rate/i
  if (kind === 'ORDER') return /order|booking|book|checkin|checkout|status/i
  if (kind === 'RANK') return /rank|ranking|position|place/i
  return /date|time|status|count|total/i
}

const selectRows = (root, kind) => {
  const matcher = kindFieldMatcher(kind)
  const candidates = objectRows(root)
    .map((candidate) => ({
      ...candidate,
      score: candidate.rows.slice(0, 50).reduce(
        (sum, row) => sum + scalarLeaves(row)
          .filter((leaf) => matcher.test(leaf.path)).length,
        0,
      ),
    }))
    .sort((left, right) =>
      right.score - left.score || right.rows.length - left.rows.length)
  return candidates[0] ?? { path: null, rows: [], score: 0 }
}

const topLevelAggregate = (root, matcher) => scalarLeaves(root)
  .filter((leaf) =>
    !/(?:^|\.)\d+(?:\.|$)/.test(leaf.path)
    && matcher.test(leaf.path.split('.').at(-1) ?? ''))
  .map((leaf) => Number(leaf.value))
  .find((value) => Number.isSafeInteger(value) && value >= 0) ?? null

const totalCountFor = (root) => topLevelAggregate(
  root,
  /^(?:total|totalcount|totalsize|recordcount|records)$/i,
)

const hasMoreFor = (root) => {
  const leaf = scalarLeaves(root).find((candidate) =>
    !/(?:^|\.)\d+(?:\.|$)/.test(candidate.path)
    && /^(?:hasmore|hasnext|more)$/i.test(
      candidate.path.split('.').at(-1) ?? '',
    ))
  if (!leaf) return null
  if (typeof leaf.value === 'boolean') return leaf.value
  if (leaf.value === 1 || leaf.value === '1' || leaf.value === 'true') return true
  if (leaf.value === 0 || leaf.value === '0' || leaf.value === 'false') return false
  return null
}

const assertBusinessSuccess = (root) => {
  const results = Array.isArray(root?.ret)
    ? root.ret.map(String)
    : ['string', 'number', 'boolean'].includes(typeof root?.ret)
      ? [String(root.ret)]
      : []
  const codes = [root?.code, root?.errorCode]
    .filter((value) => ['string', 'number'].includes(typeof value))
    .map((value) => String(value).trim())
    .filter(Boolean)
  const accepted = /^(?:SUCCESS(?:::|$)|OK$|TRUE$|0$|200$)/i
  const explicitFailure = root?.success === false
    || root?.isSuccess === false
    || results.some((value) => !accepted.test(value.trim()))
    || codes.some((value) => !accepted.test(value))
  if (!explicitFailure) return
  const diagnostic = [
    ...results,
    ...codes,
    typeof root?.msg === 'string' ? root.msg : '',
    typeof root?.message === 'string' ? root.message : '',
  ].join(' ')
  if (/login|session|cookie|token|auth|expired|unauthor|登录|会话|失效|过期|授权/i.test(diagnostic)) {
    throw new Error('OTA_FLIGGY_SESSION_INVALID')
  }
  if (/param|payload|request|page|size|参数|请求|分页|页码/i.test(diagnostic)) {
    throw new Error('OTA_FLIGGY_REQUEST_PAYLOAD_INVALID')
  }
  throw new Error('OTA_FLIGGY_BUSINESS_ERROR')
}

export const sanitizeFliggyEndpointUrl = (rawUrl) => {
  const url = rawUrl instanceof URL ? new URL(rawUrl) : new URL(rawUrl)
  if (url.hostname.toLowerCase() !== FLIGGY_MTOP_HOST) return url.toString()
  for (const key of [...url.searchParams.keys()]) {
    if (EPHEMERAL_QUERY_KEYS.has(key.toLowerCase())) {
      url.searchParams.delete(key)
    }
  }
  return url.toString()
}

export const isFliggySource = ({ source, endpoint }) =>
  source?.platformCode === 'FLIGGY'
  && (
    endpoint?.hostname?.toLowerCase() === 'fliggy.com'
    || endpoint?.hostname?.toLowerCase().endsWith('.fliggy.com')
  )

export const builtInFliggyOrderEndpointUrl = (source) => {
  if (
    source?.platformCode !== 'FLIGGY'
    || !/(?:order|booking|\u8ba2\u5355)/i.test(String(source?.displayName ?? ''))
  ) return null
  const endpoint = new URL(
    `https://${FLIGGY_MTOP_HOST}/h5/${FLIGGY_ORDER_API}/1.0/`,
  )
  endpoint.searchParams.set('jsv', '2.7.5')
  endpoint.searchParams.set('appKey', '12574478')
  endpoint.searchParams.set('v', '1.0')
  endpoint.searchParams.set('type', 'originaljson')
  endpoint.searchParams.set('dataType', 'json')
  endpoint.searchParams.set('needLogin', 'true')
  endpoint.searchParams.set('api', FLIGGY_ORDER_API)
  endpoint.searchParams.set('data', JSON.stringify({
    source: 'EBK_PC',
    sversion: 3,
    pageSize: FLIGGY_PAGE_SIZE,
    hid: 0,
    dateType: 3,
    orderStatus: '["0"]',
    payType: 0,
    originStartDate: '',
    originEndDate: '',
    startDate: '',
    endDate: '',
    groupType: 0,
    orderBy: 1,
    orderTags: '["0"]',
    init: true,
    pageIndex: 1,
    sortType: 'desc',
  }))
  return endpoint.toString()
}

export const builtInFliggyReviewEndpointUrl = (source) => {
  if (
    source?.platformCode !== 'FLIGGY'
    || !/(?:review|comment|evaluate|evaluation|\u8bc4\u4ef7|\u70b9\u8bc4)/i
      .test(String(source?.displayName ?? ''))
  ) return null
  const endpoint = new URL(
    `https://${FLIGGY_LEGACY_REVIEW_HOST}${FLIGGY_LEGACY_REVIEW_PATH}`,
  )
  endpoint.searchParams.set('_input_charset', 'UTF-8')
  return endpoint.toString()
}

export const builtInFliggyEndpointUrl = (source) =>
  builtInFliggyOrderEndpointUrl(source)
  ?? builtInFliggyReviewEndpointUrl(source)

export const fliggyBuiltInFallbackSource = ({ source, errorCode }) => {
  if (
    source?.platformCode !== 'FLIGGY'
    || errorCode !== 'OTA_HTTP_REDIRECT'
    || !String(source?.dataEndpointUrl ?? '').trim()
    || !builtInFliggyEndpointUrl(source)
  ) return null
  return {
    ...source,
    dataEndpointUrl: '',
  }
}

const h5Token = (cookie) => {
  const match = String(cookie).match(/(?:^|;\s*)_m_h5_tk=([^;]+)/)
  if (!match) throw new Error('OTA_FLIGGY_SESSION_INVALID')
  let value = match[1]
  try {
    value = decodeURIComponent(value)
  } catch {
    // An unescaped cookie value is still valid input for the token parser.
  }
  const token = value.split('_')[0]
  if (!token) throw new Error('OTA_FLIGGY_SESSION_INVALID')
  return token
}

const requestDataFor = (endpoint) => {
  const data = endpoint.searchParams.get('data')
  if (!data) throw new Error('OTA_FLIGGY_REQUEST_DATA_INVALID')
  try {
    const parsed = JSON.parse(data)
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('OTA_FLIGGY_REQUEST_DATA_INVALID')
    }
    return parsed
  } catch (error) {
    if (error?.message === 'OTA_FLIGGY_REQUEST_DATA_INVALID') throw error
    throw new Error('OTA_FLIGGY_REQUEST_DATA_INVALID')
  }
}

const matchingKey = (object, matcher) => Object.keys(object)
  .find((key) => matcher.test(key)) ?? null

const pagedRequestData = ({ base, pageIndex, pageSize, rangeStart, rangeEnd }) => {
  const data = { ...base }
  const pageKey = matchingKey(data, /^(?:pageindex|pageno|currentpage|page)$/i)
  const sizeKey = matchingKey(data, /^(?:pagesize|limit|count)$/i)
  if (pageKey) data[pageKey] = pageIndex
  else data.pageIndex = pageIndex
  if (sizeKey) data[sizeKey] = pageSize
  else data.pageSize = pageSize
  for (const key of Object.keys(data)) {
    if (/^(?:origin)?startdate$/i.test(key)) data[key] = rangeStart
    if (/^(?:origin)?enddate$/i.test(key)) data[key] = rangeEnd
  }
  return { data, pageKey: pageKey ?? 'pageIndex' }
}

const signedUrl = ({ endpoint, cookie, data, now }) => {
  const url = new URL(sanitizeFliggyEndpointUrl(endpoint))
  const appKey = url.searchParams.get('appKey')
  if (!appKey) throw new Error('OTA_FLIGGY_APP_KEY_MISSING')
  const timestamp = String(now().getTime())
  const serialized = JSON.stringify(data)
  const signature = createHash('md5')
    .update(`${h5Token(cookie)}&${timestamp}&${appKey}&${serialized}`)
    .digest('hex')
  url.searchParams.set('t', timestamp)
  url.searchParams.set('sign', signature)
  url.searchParams.set('data', serialized)
  return url
}

const identityFor = (row) => {
  const leaf = scalarLeaves(row).find((candidate) => {
    const field = candidate.path.split('.').at(-1) ?? ''
    return /(?:^id$|(?:order|review|comment|rate)[_-]?id$)/i.test(field)
      && !/(?:user|guest|member|account|hotel|merchant|poi)/i.test(candidate.path)
  })
  return leaf
    ? createHash('sha256').update(String(leaf.value)).digest('hex')
    : null
}

const rowDate = (row, kind) => {
  const leaves = scalarLeaves(row)
  const preferred = leaves.filter((leaf) => {
    const path = leaf.path.toLowerCase()
    const field = path.split('.').at(-1) ?? ''
    if (!/(?:date|time|gmtcreate|createdat)$/.test(field)) return false
    return kind === 'REVIEW'
      ? /review|comment|evaluate|rate|publish|create/.test(path)
      : /order|book|create|pay|checkin/.test(path)
  })
  for (const leaf of [...preferred, ...leaves]) {
    const field = leaf.path.split('.').at(-1) ?? ''
    if (!/(?:date|time|gmtcreate|createdat)$/i.test(field)) continue
    const date = dateValue(leaf.value)
    if (date) return date
  }
  return null
}

const reviewScore = (row) => {
  const candidates = scalarLeaves(row)
    .filter((leaf) => {
      const field = leaf.path.split('.').at(-1) ?? ''
      return /(?:score|star|rating)$/i.test(field)
        && !/(?:count|tag|reply|merchant|hotel|average)/i.test(leaf.path)
    })
    .map((leaf) => {
      const match = String(leaf.value).match(/-?\d+(?:\.\d+)?/)
      return match ? Number(match[0]) : Number.NaN
    })
    .filter((value) => Number.isFinite(value) && value >= 0 && value <= 5)
  return candidates[0] ?? null
}

const canceledOrder = (row) => scalarLeaves(row).some((leaf) => {
  const field = leaf.path.split('.').at(-1) ?? ''
  if (/^(?:iscancel|cancelled|canceled)$/i.test(field)) {
    return leaf.value === true || leaf.value === 1 || leaf.value === '1'
  }
  return /status|state/i.test(field)
    && /cancel|closed|取消|关闭/i.test(String(leaf.value))
})

const collectPages = async ({
  source,
  endpoint,
  cookie,
  kind,
  rangeStart,
  rangeEnd,
  requestJson,
  now,
}) => {
  const base = requestDataFor(endpoint)
  const records = []
  const identities = new Set()
  let recordPath = null
  let totalCount = null
  let paginationComplete = false
  let httpStatus = 200
  let fetchedPageCount = 0
  let duplicateCount = 0
  for (let pageIndex = 1; pageIndex <= FLIGGY_MAX_PAGES; pageIndex += 1) {
    const requestData = pagedRequestData({
      base,
      pageIndex,
      pageSize: FLIGGY_PAGE_SIZE,
      rangeStart,
      rangeEnd,
    })
    const response = await requestJson({
      endpoint: signedUrl({
        endpoint,
        cookie,
        data: requestData.data,
        now,
      }),
      method: 'GET',
      headers: {
        Accept: 'application/json, text/plain, */*',
        'Accept-Language': 'zh-CN,zh;q=0.9',
        Cookie: cookie,
        Referer: FLIGGY_REFERER,
        'User-Agent': FLIGGY_USER_AGENT,
      },
      fetchImpl: globalThis.fetch,
    })
    httpStatus = response.httpStatus
    assertBusinessSuccess(response.root)
    const selected = selectRows(response.root, kind)
    recordPath ??= selected.path
    fetchedPageCount += 1
    const pageTotal = totalCountFor(response.root)
    if (pageTotal !== null) totalCount = pageTotal
    let newRecordCount = 0
    selected.rows.forEach((row, rowIndex) => {
      const identity = identityFor(row) ?? `page:${pageIndex}:row:${rowIndex}`
      if (identities.has(identity)) {
        duplicateCount += 1
        return
      }
      identities.add(identity)
      newRecordCount += 1
      records.push(row)
    })
    const hasMore = hasMoreFor(response.root)
    if (
      selected.rows.length === 0
      || hasMore === false
      || (totalCount !== null && identities.size >= totalCount)
      || (hasMore === null && selected.rows.length < FLIGGY_PAGE_SIZE)
    ) {
      paginationComplete = true
      break
    }
    if (newRecordCount === 0) {
      throw new Error('OTA_FLIGGY_PAGINATION_STALLED')
    }
  }
  return {
    records,
    recordPath,
    totalCount,
    paginationComplete,
    fetchedPageCount,
    duplicateCount,
    httpStatus,
    detectedFields: fieldNames(records),
  }
}

const orderSummary = ({ pages, businessDate, rangeStart, rangeEnd, now }) => {
  const dated = pages.records.map((row) => ({ row, date: rowDate(row, 'ORDER') }))
  const dateComplete = dated.every((item) => item.date !== null)
  const rows = dateComplete
    ? dated.filter((item) => item.date >= rangeStart && item.date <= rangeEnd)
    : dated
  const canceledCount = rows.filter((item) => canceledOrder(item.row)).length
  return {
    observedAt: now().toISOString(),
    httpStatus: pages.httpStatus,
    rootType: 'OBJECT',
    recordPath: pages.recordPath,
    recordCount: rows.length,
    detectedDimensions: ['ORDER', 'DATE', 'SALES', 'CANCELLATION'],
    detectedFields: pages.detectedFields,
    providerDataset: {
      provider: 'FLIGGY',
      dataset: 'ORDER',
      scope: dateComplete ? 'BUSINESS_MONTH_TO_DATE' : 'ENDPOINT_TOTAL_AND_CURRENT_PAGE',
      ...(dateComplete ? {
        periodBasis: 'THROUGH_PREVIOUS_BUSINESS_DATE',
        rangeStart,
        rangeEnd,
      } : {}),
      totalCount: dateComplete ? rows.length : pages.totalCount,
      returnedCount: rows.length,
      canceledCount,
      nonCanceledCount: rows.length - canceledCount,
      hasMore: !pages.paginationComplete,
      fetchedPageCount: pages.fetchedPageCount,
      paginationComplete: pages.paginationComplete,
      duplicateCount: pages.duplicateCount,
      aggregationVersion: FLIGGY_AGGREGATION_VERSION,
    },
  }
}

const reviewSummary = ({
  pages,
  businessDate,
  suppliedBusinessDate,
  rangeStart,
  rangeEnd,
  now,
}) => {
  const rows = pages.records.map((row) => ({
    date: rowDate(row, 'REVIEW'),
    score: reviewScore(row),
  }))
  const reviewMetricCoverage = {
    totalRowCount: rows.length,
    datedRowCount: rows.filter((row) => row.date !== null).length,
    scoredRowCount: rows.filter((row) => row.score !== null).length,
    usableRowCount: rows.filter(
      (row) => row.date !== null && row.score !== null,
    ).length,
    paginationComplete: pages.paginationComplete,
  }
  const metricsAvailable = pages.paginationComplete
    && rows.every((row) => row.date !== null && row.score !== null)
  const monthlyRows = metricsAvailable
    ? rows.filter((row) => row.date >= rangeStart && row.date <= businessDate)
    : []
  const throughPrevious = monthlyRows.filter((row) => row.date <= rangeEnd)
  const monthlyGoodCount = monthlyRows.filter((row) => row.score >= 4.8).length
  const monthlyNegativeCount = monthlyRows.filter((row) => row.score < 3).length
  const goodCountThroughPreviousBusinessDate = throughPrevious
    .filter((row) => row.score >= 4.8).length
  const negativeCountThroughPreviousBusinessDate = throughPrevious
    .filter((row) => row.score < 3).length
  return {
    observedAt: now().toISOString(),
    httpStatus: pages.httpStatus,
    rootType: 'OBJECT',
    recordPath: pages.recordPath,
    recordCount: pages.records.length,
    detectedDimensions: ['REVIEW', 'DATE'],
    detectedFields: pages.detectedFields,
    reviewMetricCoverage,
    providerDataset: {
      provider: 'FLIGGY',
      dataset: 'REVIEW',
      scope: metricsAvailable
        ? 'BUSINESS_MONTH_TO_DATE'
        : 'ENDPOINT_TOTAL_AND_CURRENT_PAGE',
      ...(metricsAvailable ? {
        periodBasis: 'THROUGH_CURRENT_BUSINESS_DATE',
        rangeStart,
        rangeEnd: businessDate,
      } : {}),
      totalCount: pages.totalCount,
      returnedCount: pages.records.length,
      hasMore: !pages.paginationComplete,
      fetchedPageCount: pages.fetchedPageCount,
      paginationComplete: pages.paginationComplete,
      duplicateCount: pages.duplicateCount,
      aggregationVersion: FLIGGY_AGGREGATION_VERSION,
    },
    ...(metricsAvailable ? {
      reviewMetrics: {
        provider: 'FLIGGY',
        metricBasis: 'FLIGGY_STAR_THRESHOLDS',
        businessDate,
        businessDateBasis: suppliedBusinessDate
          ? 'PMS_CONFIRMED'
          : 'SYSTEM_DATE_FALLBACK',
        previousBusinessDate: rangeEnd,
        monthStart: rangeStart,
        monthlyGoodCount,
        monthlyNegativeCount,
        yesterdayNegativeCount: monthlyRows
          .filter((row) => row.date === rangeEnd && row.score < 3).length,
        goodCountThroughPreviousBusinessDate,
        negativeCountThroughPreviousBusinessDate,
        validStayedOrderCountThroughPreviousBusinessDate: null,
        eligibleOtaOrderCountThroughPreviousBusinessDate: null,
        goodRatePercent: null,
        negativeRatePermille: null,
        denominatorSource: 'MATCHED_OTA_ORDER_SOURCE',
        denominatorStatus: 'ORDER_SOURCE_MISSING',
        totalAllTime: pages.totalCount,
        fetchedRowCount: pages.records.length,
        fetchedPageCount: pages.fetchedPageCount,
        paginationComplete: true,
        aggregationVersion: FLIGGY_AGGREGATION_VERSION,
      },
    } : {}),
  }
}

const rankCode = (path) => {
  const text = path.toLowerCase()
  if (/review|comment|score|评价|点评/.test(text)) return 'REVIEW_SCORE'
  if (/order|booking|订单/.test(text)) return 'ORDER_COUNT'
  if (/night|间夜/.test(text)) return 'STAY_ROOM_NIGHTS'
  if (/revenue|income|roomfee|房费/.test(text)) return 'ROOM_REVENUE'
  if (/gmv|sales|amount|销售额/.test(text)) return 'GMV'
  if (/exposure|impression|show|曝光/.test(text)) return 'EXPOSURE'
  if (/view|browse|traffic|浏览|流量/.test(text)) return 'VIEWS'
  if (/conversion|convert|转化/.test(text)) return 'VIEW_CONVERSION'
  return 'OVERALL'
}

const rankingSummary = ({ root, httpStatus, source, endpoint, now }) => {
  const selected = selectRows(root, 'RANK')
  const metrics = new Map()
  for (const row of selected.rows.slice(0, 200)) {
    for (const leaf of scalarLeaves(row)) {
      if (!/rank|ranking|position|place|排名/i.test(leaf.path)) continue
      const value = Number(leaf.value)
      if (!Number.isSafeInteger(value) || value <= 0) continue
      const code = rankCode(leaf.path)
      if (!metrics.has(code)) metrics.set(code, value)
    }
  }
  const generic = {
    observedAt: now().toISOString(),
    httpStatus,
    rootType: 'OBJECT',
    recordPath: selected.path,
    recordCount: selected.rows.length,
    detectedDimensions: ['RANK'],
    detectedFields: fieldNames(selected.rows),
  }
  return metrics.size > 0
    ? {
        ...generic,
        peerRanking: {
          provider: 'FLIGGY',
          metrics: [...metrics].map(([code, rank]) => ({ code, rank })),
        },
      }
    : generic
}

const isLegacyFliggyReviewEndpoint = (endpoint) =>
  endpoint.hostname.toLowerCase() === FLIGGY_LEGACY_REVIEW_HOST
  && endpoint.pathname === FLIGGY_LEGACY_REVIEW_PATH

const directPayloadObject = (source) => {
  try {
    const payload = JSON.parse(source.requestPayloadJson || '{}')
    if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
      throw new Error('OTA_REQUEST_PAYLOAD_INVALID')
    }
    return payload
  } catch (error) {
    if (error?.message === 'OTA_REQUEST_PAYLOAD_INVALID') throw error
    throw new Error('OTA_REQUEST_PAYLOAD_INVALID')
  }
}

const directRequestPayload = (source, endpoint, overrides = {}) => {
  if (source.requestMethod !== 'POST') return undefined
  try {
    const payload = { ...directPayloadObject(source), ...overrides }
    if (isLegacyFliggyReviewEndpoint(endpoint)) {
      const form = new URLSearchParams()
      for (const [key, value] of Object.entries(payload)) {
        if (value === undefined || value === null) continue
        form.set(
          key,
          typeof value === 'object' ? JSON.stringify(value) : String(value),
        )
      }
      return form.toString()
    }
    return JSON.stringify(payload)
  } catch (error) {
    if (error?.message === 'OTA_REQUEST_PAYLOAD_INVALID') throw error
    throw new Error('OTA_REQUEST_PAYLOAD_INVALID')
  }
}

const collectDirectLegacyReviewPages = async ({
  source,
  endpoint,
  cookie,
  requestJson,
}) => {
  const records = []
  const identities = new Set()
  let recordPath = null
  let totalCount = null
  let paginationComplete = false
  let httpStatus = 200
  let fetchedPageCount = 0
  let duplicateCount = 0
  let responseShape = null
  const basePayload = directPayloadObject(source)
  const pageKey = matchingKey(
    basePayload,
    /^(?:pageindex|pageno|currentpage|page)$/i,
  ) ?? 'pageNo'
  const sizeKey = matchingKey(basePayload, /^(?:pagesize|limit|count)$/i)
    ?? 'pageSize'
  const configuredPageSize = Number(basePayload[sizeKey])
  const pageSize = Number.isSafeInteger(configuredPageSize)
    && configuredPageSize > 0
    && configuredPageSize <= FLIGGY_PAGE_SIZE
    ? configuredPageSize
    : FLIGGY_LEGACY_REVIEW_DEFAULT_PAGE_SIZE
  for (
    let pageNo = 1;
    pageNo <= FLIGGY_LEGACY_REVIEW_MAX_PAGES;
    pageNo += 1
  ) {
    const response = await requestJson({
      endpoint,
      method: 'POST',
      body: directRequestPayload(source, endpoint, {
        [pageKey]: pageNo,
        [sizeKey]: pageSize,
      }),
      headers: {
        Accept: 'application/json, text/plain, */*',
        'Accept-Language': 'zh-CN,zh;q=0.9',
        Cookie: cookie,
        Referer: `https://${endpoint.hostname}/`,
        'User-Agent': FLIGGY_USER_AGENT,
        'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
      },
      fetchImpl: globalThis.fetch,
    })
    httpStatus = response.httpStatus
    responseShape = safeResponseShape(response.root)
    assertBusinessSuccess(response.root)
    const selected = selectRows(response.root, 'REVIEW')
    recordPath ??= selected.path
    fetchedPageCount += 1
    const pageTotal = totalCountFor(response.root)
    if (pageTotal !== null) totalCount = pageTotal
    let newRecordCount = 0
    selected.rows.forEach((row, rowIndex) => {
      const identity = identityFor(row) ?? `page:${pageNo}:row:${rowIndex}`
      if (identities.has(identity)) {
        duplicateCount += 1
        return
      }
      identities.add(identity)
      newRecordCount += 1
      records.push(row)
    })
    const hasMore = hasMoreFor(response.root)
    if (
      selected.rows.length === 0
      || hasMore === false
      || (totalCount !== null && identities.size >= totalCount)
    ) {
      paginationComplete = true
      break
    }
    if (newRecordCount === 0) {
      throw new Error('OTA_FLIGGY_PAGINATION_STALLED')
    }
  }
  return {
    records,
    recordPath,
    totalCount,
    paginationComplete,
    fetchedPageCount,
    duplicateCount,
    httpStatus,
    detectedFields: fieldNames(records),
    responseShape,
  }
}

const collectDirectFliggySummary = async ({
  source,
  endpoint,
  cookie,
  businessDate,
  requestJson,
  now,
}) => {
  const kind = sourceKind({ source, endpoint })
  const effectiveBusinessDate = canonicalDate(businessDate) ?? shanghaiDate(now())
  if (!effectiveBusinessDate) throw new Error('OTA_FLIGGY_BUSINESS_DATE_INVALID')
  const rangeStart = `${effectiveBusinessDate.slice(0, 7)}-01`
  const rangeEnd = addCalendarDays(effectiveBusinessDate, -1)
  if (isLegacyFliggyReviewEndpoint(endpoint) && kind === 'REVIEW') {
    const pages = await collectDirectLegacyReviewPages({
      source,
      endpoint,
      cookie,
      requestJson,
    })
    const summary = reviewSummary({
      pages,
      businessDate: effectiveBusinessDate,
      suppliedBusinessDate: canonicalDate(businessDate),
      rangeStart,
      rangeEnd,
      now,
    })
    return pages.records.length === 0
      ? { ...summary, responseShape: pages.responseShape }
      : summary
  }
  const response = await requestJson({
    endpoint,
    method: source.requestMethod,
    body: directRequestPayload(source, endpoint),
    headers: {
      Accept: 'application/json, text/plain, */*',
      'Accept-Language': 'zh-CN,zh;q=0.9',
      Cookie: cookie,
      Referer: `https://${endpoint.hostname}/`,
      'User-Agent': FLIGGY_USER_AGENT,
      ...(source.requestMethod === 'POST'
        ? {
            'Content-Type': isLegacyFliggyReviewEndpoint(endpoint)
              ? 'application/x-www-form-urlencoded;charset=UTF-8'
              : 'application/json;charset=UTF-8',
          }
        : {}),
    },
    fetchImpl: globalThis.fetch,
  })
  assertBusinessSuccess(response.root)
  if (kind === 'RANK' || kind === 'OTHER') {
    return rankingSummary({
      root: response.root,
      httpStatus: response.httpStatus,
      source,
      endpoint,
      now,
    })
  }
  const selected = selectRows(response.root, kind)
  const totalCount = totalCountFor(response.root)
  const hasMore = hasMoreFor(response.root)
  const paginationComplete = hasMore === false
    || (totalCount !== null && selected.rows.length >= totalCount)
  const pages = {
    records: selected.rows,
    recordPath: selected.path,
    totalCount,
    paginationComplete,
    fetchedPageCount: 1,
    duplicateCount: 0,
    httpStatus: response.httpStatus,
    detectedFields: fieldNames(selected.rows),
  }
  const summary = kind === 'ORDER'
    ? orderSummary({
        pages,
        businessDate: effectiveBusinessDate,
        rangeStart,
        rangeEnd,
        now,
      })
    : reviewSummary({
        pages,
        businessDate: effectiveBusinessDate,
        suppliedBusinessDate: canonicalDate(businessDate),
        rangeStart,
        rangeEnd,
        now,
      })
  return selected.rows.length === 0
    ? { ...summary, responseShape: safeResponseShape(response.root) }
    : summary
}

export const collectFliggySourceSummary = async ({
  source,
  endpoint,
  cookie,
  businessDate,
  requestJson,
  now = () => new Date(),
}) => {
  if (endpoint.hostname.toLowerCase() !== FLIGGY_MTOP_HOST) {
    return collectDirectFliggySummary({
      source,
      endpoint,
      cookie,
      businessDate,
      requestJson,
      now,
    })
  }
  if (source.requestMethod !== 'GET') {
    throw new Error('OTA_FLIGGY_METHOD_UNSUPPORTED')
  }
  const effectiveBusinessDate = canonicalDate(businessDate) ?? shanghaiDate(now())
  if (!effectiveBusinessDate) throw new Error('OTA_FLIGGY_BUSINESS_DATE_INVALID')
  const rangeStart = `${effectiveBusinessDate.slice(0, 7)}-01`
  const rangeEnd = addCalendarDays(effectiveBusinessDate, -1)
  const kind = sourceKind({ source, endpoint })
  if (kind === 'RANK' || kind === 'OTHER') {
    const data = requestDataFor(endpoint)
    const response = await requestJson({
      endpoint: signedUrl({ endpoint, cookie, data, now }),
      method: 'GET',
      headers: {
        Accept: 'application/json, text/plain, */*',
        'Accept-Language': 'zh-CN,zh;q=0.9',
        Cookie: cookie,
        Referer: FLIGGY_REFERER,
        'User-Agent': FLIGGY_USER_AGENT,
      },
      fetchImpl: globalThis.fetch,
    })
    assertBusinessSuccess(response.root)
    return rankingSummary({
      root: response.root,
      httpStatus: response.httpStatus,
      source,
      endpoint,
      now,
    })
  }
  const pages = await collectPages({
    source,
    endpoint,
    cookie,
    kind,
    rangeStart,
    rangeEnd: kind === 'ORDER' ? rangeEnd : effectiveBusinessDate,
    requestJson,
    now,
  })
  return kind === 'ORDER'
    ? orderSummary({
        pages,
        businessDate: effectiveBusinessDate,
        rangeStart,
        rangeEnd,
        now,
      })
    : reviewSummary({
        pages,
        businessDate: effectiveBusinessDate,
        suppliedBusinessDate: canonicalDate(businessDate),
        rangeStart,
        rangeEnd,
        now,
      })
}

export const fliggyCollectorLimits = Object.freeze({
  maxPages: FLIGGY_MAX_PAGES,
  legacyReviewMaxPages: FLIGGY_LEGACY_REVIEW_MAX_PAGES,
  pageSize: FLIGGY_PAGE_SIZE,
  legacyReviewDefaultPageSize: FLIGGY_LEGACY_REVIEW_DEFAULT_PAGE_SIZE,
  aggregationVersion: FLIGGY_AGGREGATION_VERSION,
})
