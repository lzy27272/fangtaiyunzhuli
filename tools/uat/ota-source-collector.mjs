import { lookup } from 'node:dns/promises'
import { createHash } from 'node:crypto'
import { isIP } from 'node:net'
import {
  collectMeituanCommentSummary,
  isMeituanCommentSource,
} from './meituan-comment-browser-collector.mjs'
import {
  builtInFliggyEndpointUrl,
  builtInFliggyOrderEndpointUrl,
  collectFliggySourceSummary,
  isFliggySource,
} from './fliggy-source-collector.mjs'

const MAX_RESPONSE_BYTES = 2 * 1024 * 1024
const MAX_SCAN_ROWS = 200
const MAX_FIELDS = 60
const MAX_DOUYIN_REVIEW_PAGES = 100
const MAX_DOUYIN_ORDER_PAGES = 500
const DOUYIN_ORDER_OPTIMIZED_PAGE_SIZE = 100
const DOUYIN_REVIEW_AGGREGATION_VERSION = 1
const DOUYIN_ORDER_AGGREGATION_VERSION = 1
const DOUYIN_GOOD_ATTITUDE = 1
const DOUYIN_NEUTRAL_ATTITUDE = 2
const DOUYIN_NEGATIVE_ATTITUDE = 3
const MEITUAN_EBOOKING_HOST = 'eb.meituan.com'
const MEITUAN_EBOOKING_REFERER = 'https://eb.meituan.com/'
const MEITUAN_PEER_RANK_PATH =
  '/api/v1/ebooking/business/peer/rank/data/result'
const MEITUAN_ORDER_PATH = '/api/v1/ebooking/orders/list'
const DOUYIN_LIFE_HOST = 'life.douyin.com'
const DOUYIN_REVIEW_PATH = '/life/infra/v1/review/get_review_list/'
const DOUYIN_ORDER_PATH = '/life/trade_view/v1/workbench/book/query/list'
const SHANGHAI_TIME_ZONE = 'Asia/Shanghai'
const MEITUAN_PEER_RANK_METRICS = Object.freeze({
  '入住间夜': 'STAY_ROOM_NIGHTS',
  '房费收入': 'ROOM_REVENUE',
  '销售间夜': 'SOLD_ROOM_NIGHTS',
  '销售额': 'GMV',
  '曝光': 'EXPOSURE',
  '浏览': 'VIEWS',
  '浏览转化': 'VIEW_CONVERSION',
  '支付转化': 'PAYMENT_CONVERSION',
})
const CONTROLLED_BROWSER_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) '
  + 'AppleWebKit/537.36 Chrome/140.0.0.0 Safari/537.36'

const privateIpv4 = (address) => {
  const octets = String(address).split('.').map(Number)
  if (octets.length !== 4 || octets.some((part) => !Number.isInteger(part))) {
    return false
  }
  return (
    octets[0] === 0
    || octets[0] === 10
    || octets[0] === 127
    || (octets[0] === 169 && octets[1] === 254)
    || (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31)
    || (octets[0] === 192 && octets[1] === 168)
    || octets[0] >= 224
  )
}

const privateIpv6 = (address) => {
  const normalized = String(address).toLowerCase()
  return (
    normalized === '::'
    || normalized === '::1'
    || normalized.startsWith('fc')
    || normalized.startsWith('fd')
    || normalized.startsWith('fe8')
    || normalized.startsWith('fe9')
    || normalized.startsWith('fea')
    || normalized.startsWith('feb')
  )
}

const privateAddress = (address) => {
  const family = isIP(address)
  return family === 4
    ? privateIpv4(address)
    : family === 6
      ? privateIpv6(address)
      : true
}

const validateEndpoint = async (rawUrl, lookupImpl) => {
  let endpoint
  try {
    endpoint = new URL(rawUrl)
  } catch {
    throw new Error('OTA_ENDPOINT_INVALID')
  }
  if (
    endpoint.protocol !== 'https:'
    || endpoint.username
    || endpoint.password
    || endpoint.hash
    || (endpoint.port && endpoint.port !== '443')
    || ['localhost', 'localhost.localdomain'].includes(
      endpoint.hostname.toLowerCase(),
    )
  ) {
    throw new Error('OTA_ENDPOINT_UNSAFE')
  }
  let addresses
  try {
    addresses = await lookupImpl(endpoint.hostname, {
      all: true,
      verbatim: true,
    })
  } catch {
    throw new Error('OTA_ENDPOINT_DNS_FAILED')
  }
  if (
    !Array.isArray(addresses)
    || addresses.length < 1
    || addresses.some((item) => privateAddress(item?.address))
  ) {
    throw new Error('OTA_ENDPOINT_PRIVATE_NETWORK_BLOCKED')
  }
  return endpoint
}

const readLimitedText = async (response) => {
  const declaredLength = Number(response.headers?.get?.('content-length'))
  if (
    Number.isFinite(declaredLength)
    && declaredLength > MAX_RESPONSE_BYTES
  ) {
    throw new Error('OTA_RESPONSE_TOO_LARGE')
  }
  if (!response.body?.getReader) {
    const text = await response.text()
    if (Buffer.byteLength(text, 'utf8') > MAX_RESPONSE_BYTES) {
      throw new Error('OTA_RESPONSE_TOO_LARGE')
    }
    return text
  }
  const reader = response.body.getReader()
  const chunks = []
  let totalBytes = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      totalBytes += value.byteLength
      if (totalBytes > MAX_RESPONSE_BYTES) {
        throw new Error('OTA_RESPONSE_TOO_LARGE')
      }
      chunks.push(Buffer.from(value))
    }
  } finally {
    reader.releaseLock()
  }
  return Buffer.concat(chunks).toString('utf8')
}

const objectRows = (value, path = '$', depth = 0, candidates = []) => {
  if (depth > 5 || value === null || typeof value !== 'object') {
    return candidates
  }
  if (
    Array.isArray(value)
    && value.some((item) =>
      item !== null && typeof item === 'object' && !Array.isArray(item))
  ) {
    candidates.push({
      path,
      rows: value.filter(
        (item) =>
          item !== null && typeof item === 'object' && !Array.isArray(item),
      ),
    })
  }
  if (!Array.isArray(value)) {
    for (const [key, child] of Object.entries(value)) {
      objectRows(child, `${path}.${key}`, depth + 1, candidates)
    }
  }
  return candidates
}

const dimensionMatchers = Object.freeze({
  DATE: /(?:^|_)(?:date|day|staydate|bizdate|arrivaldate|checkindate)(?:$|_)/i,
  ROOM_TYPE: /room.*(?:type|name)|(?:type|name).*room/i,
  INVENTORY: /inventory|available|remaining|stock|quota/i,
  PRICE: /price|adr|amount|revenue|room.*rate|rate.*(?:price|amount)|(?:^|_)rate(?:$|_)/i,
  SALES: /sold|booked|booking|roomnights?|orders?/i,
  CHANNEL: /channel|source|ota|platform/i,
  CANCELLATION: /cancel/i,
  RANK: /rank|ranking|position|place/i,
  EXPOSURE: /exposure|impression|show(?:count|num)?/i,
  TRAFFIC: /traffic|visitors?|views?|clicks?|(?:^|_)uv(?:$|_)/i,
  CONVERSION: /conversion|convert|cvr/i,
  PEER_SET_SIZE: /(?:peer|competitor).*(?:count|size|total)/i,
})

const providerRequestHeaders = ({ source, endpoint }) =>
  source.platformCode === 'MEITUAN'
  && endpoint.hostname.toLowerCase() === MEITUAN_EBOOKING_HOST
    ? {
        Referer: MEITUAN_EBOOKING_REFERER,
        'User-Agent': CONTROLLED_BROWSER_USER_AGENT,
      }
    : {}

const safeRank = (value) => {
  const normalized = typeof value === 'number'
    ? value
    : typeof value === 'string' && /^\d+$/.test(value.trim())
      ? Number(value.trim())
      : Number.NaN
  return Number.isSafeInteger(normalized) && normalized > 0
    ? normalized
    : null
}

const summarizeMeituanPeerRanking = ({ root, source, endpoint }) => {
  if (
    source.platformCode !== 'MEITUAN'
    || endpoint.hostname.toLowerCase() !== MEITUAN_EBOOKING_HOST
    || endpoint.pathname !== MEITUAN_PEER_RANK_PATH
    || !Array.isArray(root?.data?.peerRankResult)
  ) {
    return null
  }
  const ranksByCode = new Map()
  for (const row of root.data.peerRankResult.slice(0, MAX_SCAN_ROWS)) {
    if (!row || typeof row !== 'object' || Array.isArray(row)) continue
    const code = MEITUAN_PEER_RANK_METRICS[row.metric]
    if (!code || ranksByCode.has(code)) continue
    ranksByCode.set(code, safeRank(row.rank))
  }
  if (ranksByCode.size < 1) return null
  return {
    provider: 'MEITUAN',
    metrics: Object.values(MEITUAN_PEER_RANK_METRICS)
      .filter((code) => ranksByCode.has(code))
      .map((code) => ({ code, rank: ranksByCode.get(code) })),
  }
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

const addCalendarDays = (date, offset) => {
  const parsed = new Date(`${date}T00:00:00Z`)
  parsed.setUTCDate(parsed.getUTCDate() + offset)
  return parsed.toISOString().slice(0, 10)
}

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

const shanghaiRangeMilliseconds = (date, endOfDay = false) => Date.parse(
  `${date}T${endOfDay ? '23:59:59.999' : '00:00:00.000'}+08:00`,
)

export const isMeituanOrderSource = ({ source, endpoint }) =>
  source?.platformCode === 'MEITUAN'
  && endpoint?.hostname?.toLowerCase() === MEITUAN_EBOOKING_HOST
  && endpoint?.pathname === MEITUAN_ORDER_PATH

export const isDouyinReviewSource = ({ endpoint }) =>
  endpoint?.hostname?.toLowerCase() === DOUYIN_LIFE_HOST
  && endpoint?.pathname === DOUYIN_REVIEW_PATH

export const isDouyinOrderSource = ({ endpoint }) =>
  endpoint?.hostname?.toLowerCase() === DOUYIN_LIFE_HOST
  && endpoint?.pathname === DOUYIN_ORDER_PATH

const safeInteger = (value) => {
  const normalized = Number(value)
  return Number.isSafeInteger(normalized) && normalized >= 0
    ? normalized
    : null
}

const douyinScoreFieldProfiles = (rows) => {
  const profiles = new Map()
  const visit = (value, path = '', depth = 0) => {
    if (depth > 3 || value === null || typeof value !== 'object') return
    for (const [key, child] of Object.entries(value)) {
      const childPath = path ? `${path}.${key}` : key
      if (
        /score|star|rating|attitude/i.test(key)
        && (typeof child === 'number' || typeof child === 'string')
      ) {
        const normalized = Number(child)
        if (Number.isFinite(normalized)) {
          const current = profiles.get(childPath) ?? {
            fieldPath: childPath,
            observedCount: 0,
            distinctValues: new Set(),
          }
          current.observedCount += 1
          if (current.distinctValues.size < 20) {
            current.distinctValues.add(normalized)
          }
          profiles.set(childPath, current)
        }
      }
      if (child && typeof child === 'object') {
        visit(child, childPath, depth + 1)
      }
    }
  }
  for (const row of rows.slice(0, MAX_SCAN_ROWS)) visit(row)
  return [...profiles.values()].map((profile) => ({
    fieldPath: profile.fieldPath,
    observedCount: profile.observedCount,
    distinctValues: [...profile.distinctValues].sort((left, right) => left - right),
  }))
}

const douyinPaginationFieldTypes = (data) => Object.fromEntries(
  Object.entries(data ?? {})
    .filter(([key]) => /cursor|search_after|has_more|next/i.test(key))
    .map(([key, value]) => [
      key,
      Array.isArray(value) ? 'array' : value === null ? 'null' : typeof value,
    ]),
)

const douyinReviewClassificationMetadata = (data) => {
  const output = []
  const visit = (value, path = '', depth = 0) => {
    if (depth > 3 || value === null || typeof value !== 'object') return
    for (const [key, child] of Object.entries(value)) {
      if (key === 'reviews') continue
      const childPath = path ? `${path}.${key}` : key
      if (
        /attitude|rate|tag|score|level/i.test(childPath)
        && (typeof child === 'string'
          || typeof child === 'number'
          || typeof child === 'boolean')
      ) {
        const text = String(child)
        if (text.length <= 80) output.push({ fieldPath: childPath, value: text })
      }
      if (child && typeof child === 'object') {
        visit(child, childPath, depth + 1)
      }
    }
  }
  visit(data)
  return output.slice(0, 100)
}

const douyinReviewClassificationProfiles = (rows) => {
  const profiles = new Map()
  for (const row of rows) {
    const attitude = Number(row?.attitude)
    if (!Number.isFinite(attitude)) continue
    for (const leaf of scalarLeaves(row)) {
      if (
        !/(?:attitude|type|source|status|level|tag|rate|score)/i
          .test(leaf.path)
        || /(?:id|name|content|text|reply|url|avatar|user|author)/i
          .test(leaf.path)
      ) continue
      const value = String(leaf.value)
      if (value.length > 40) continue
      const key = `${attitude}:${leaf.path}:${value}`
      const current = profiles.get(key) ?? {
        attitude,
        fieldPath: leaf.path,
        value,
        count: 0,
      }
      current.count += 1
      profiles.set(key, current)
    }
  }
  return [...profiles.values()]
    .sort((left, right) =>
      left.attitude - right.attitude
      || left.fieldPath.localeCompare(right.fieldPath)
      || right.count - left.count)
    .slice(0, 200)
}

const douyinAttitudeSignalProfiles = (rows) => {
  const profiles = new Map()
  const increment = (map, value) => {
    if (value === undefined || value === null) return
    const key = String(value)
    map.set(key, (map.get(key) ?? 0) + 1)
  }
  for (const row of rows) {
    const attitude = Number(row?.attitude)
    if (!Number.isFinite(attitude)) continue
    const current = profiles.get(attitude) ?? {
      attitude,
      count: 0,
      scoreTagSubTypes: new Map(),
      reviewSources: new Map(),
      complainStatuses: new Map(),
    }
    current.count += 1
    for (const tag of Array.isArray(row?.score_tags) ? row.score_tags : []) {
      increment(current.scoreTagSubTypes, tag?.sub_type)
    }
    increment(current.reviewSources, row?.review_source)
    increment(current.complainStatuses, row?.complain_status)
    profiles.set(attitude, current)
  }
  return [...profiles.values()]
    .sort((left, right) => left.attitude - right.attitude)
    .map((profile) => ({
      attitude: profile.attitude,
      count: profile.count,
      scoreTagSubTypes: Object.fromEntries(profile.scoreTagSubTypes),
      reviewSources: Object.fromEntries(profile.reviewSources),
      complainStatuses: Object.fromEntries(profile.complainStatuses),
    }))
}

const scalarLeaves = (value, path = '', depth = 0, leaves = []) => {
  if (depth > 4 || value === null || typeof value !== 'object') return leaves
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

const hashScalar = (value) => createHash('sha256')
  .update(String(value))
  .digest('hex')

const accumulateIdentityFieldProfiles = (rows, profiles = new Map()) => {
  for (const row of rows) {
    for (const leaf of scalarLeaves(row)) {
      const field = leaf.path.split('.').at(-1) ?? ''
      if (
        !/(?:^id$|_id$)/i.test(field)
        || /(?:user|author|account|poi|merchant|hotel|biz|life_account)/i
          .test(leaf.path)
      ) continue
      const current = profiles.get(leaf.path) ?? {
        fieldPath: leaf.path,
        observedCount: 0,
        hashes: new Set(),
      }
      current.observedCount += 1
      current.hashes.add(hashScalar(leaf.value))
      profiles.set(leaf.path, current)
    }
  }
  return profiles
}

const identityFieldProfileSummary = (profiles) => [...profiles.values()]
    .map((profile) => ({
      fieldPath: profile.fieldPath,
      observedCount: profile.observedCount,
      distinctCount: profile.hashes.size,
    }))
    .sort((left, right) =>
      right.observedCount - left.observedCount
      || right.distinctCount - left.distinctCount)
    .slice(0, 20)

const identityFieldProfiles = (rows) => identityFieldProfileSummary(
  accumulateIdentityFieldProfiles(rows),
)

const dateFieldProfiles = (rows) => {
  const profiles = new Map()
  for (const row of rows) {
    for (const leaf of scalarLeaves(row)) {
      const field = leaf.path.split('.').at(-1) ?? ''
      if (!/(?:time|date)$/i.test(field)) continue
      const date = canonicalDate(String(leaf.value))
        ?? douyinPublishedDate(leaf.value)
      if (!date) continue
      const current = profiles.get(leaf.path) ?? {
        fieldPath: leaf.path,
        observedCount: 0,
        earliestDate: date,
        latestDate: date,
      }
      current.observedCount += 1
      if (date < current.earliestDate) current.earliestDate = date
      if (date > current.latestDate) current.latestDate = date
      profiles.set(leaf.path, current)
    }
  }
  return [...profiles.values()]
    .sort((left, right) => right.observedCount - left.observedCount)
    .slice(0, 20)
}

const douyinPublishedDate = (value) => {
  const numeric = Number(value)
  if (!Number.isFinite(numeric) || numeric <= 0) return null
  return shanghaiDate(numeric < 10_000_000_000 ? numeric * 1_000 : numeric)
}

const douyinReviewRows = (root) => {
  assertDouyinBusinessSuccess(root, 'REVIEW')
  if (!Array.isArray(root?.data?.reviews)) {
    throw new Error('OTA_DOUYIN_REVIEW_SCHEMA_UNRECOGNIZED')
  }
  return root.data.reviews.filter(
    (row) => row !== null && typeof row === 'object' && !Array.isArray(row),
  )
}

const assertDouyinBusinessSuccess = (root, dataset) => {
  const codes = [
    root?.status_code,
    root?.BaseResp?.StatusCode,
    root?.BaseResp?.status_code,
  ]
    .filter((value) => value !== undefined && value !== null)
    .map(Number)
    .filter(Number.isFinite)
  if (codes.some((code) => code !== 0)) {
    throw new Error(`OTA_DOUYIN_${dataset}_BUSINESS_ERROR`)
  }
}

export const summarizeDouyinReviewJson = (root) => {
  const rows = douyinReviewRows(root)
  const totalCount = safeInteger(root?.data?.total_count)
  return {
    rootType: 'OBJECT',
    recordPath: '$.data.reviews',
    recordCount: rows.length,
    detectedDimensions: ['REVIEW', 'DATE'],
    detectedFields: ['attitude', 'publiced_time', 'review_source'],
    providerDataset: {
      provider: 'DOUYIN',
      dataset: 'REVIEW',
      scope: 'ENDPOINT_TOTAL_AND_CURRENT_PAGE',
      totalCount,
      returnedCount: rows.length,
      hasMore: root.data.has_more === true,
      safeDiagnosticsVersion: 1,
      schemaDiagnosticsVersion: 7,
      scoreFieldProfiles: douyinScoreFieldProfiles(rows),
      paginationFieldTypes: douyinPaginationFieldTypes(root.data),
      identityFieldProfiles: identityFieldProfiles(rows),
      classificationMetadata:
        douyinReviewClassificationMetadata(root.data),
    },
  }
}

const collectDouyinReviewDiagnosticsSummaryLegacy = async ({
  endpoint,
  cookie,
  businessDate,
  fetchImpl,
  now,
}) => {
  const effectiveBusinessDate = canonicalDate(businessDate)
    ?? shanghaiDate(now())
  if (!effectiveBusinessDate) {
    throw new Error('OTA_DOUYIN_REVIEW_BUSINESS_DATE_INVALID')
  }
  const monthStart = `${effectiveBusinessDate.slice(0, 7)}-01`
  const headers = {
    Accept: 'application/json, text/plain, */*',
    'Accept-Language': 'zh-CN,zh;q=0.9',
    Cookie: cookie,
  }
  const pages = []
  const attitudeCounts = new Map()
  const monthlyAttitudeCounts = new Map()
  const throughPreviousBusinessDateAttitudeCounts = new Map()
  const yesterdayAttitudeCounts = new Map()
  const scoreProfiles = new Map()
  const identityProfiles = new Map()
  const classificationProfiles = new Map()
  const attitudeSignalProfiles = new Map()
  const seenCursors = new Set()
  let totalCount = null
  let oldestObservedDate = null
  let paginationComplete = false
  let requestUrl = new URL(endpoint)
  requestUrl.searchParams.set('count', '20')
  let optimizedPageSize = true
  let httpStatus = 200
  let classificationMetadata = []
  let fetchedRowCount = 0
  const previousBusinessDate = addCalendarDays(effectiveBusinessDate, -1)

  for (let pageIndex = 0; pageIndex < MAX_DOUYIN_REVIEW_PAGES; pageIndex += 1) {
    const response = await requestOtaJson({
      endpoint: requestUrl,
      method: 'GET',
      headers,
      fetchImpl,
    })
    httpStatus = response.httpStatus
    let rows
    try {
      rows = douyinReviewRows(response.root)
    } catch (error) {
      if (
        pageIndex === 0
        && optimizedPageSize
        && error?.message === 'OTA_DOUYIN_REVIEW_BUSINESS_ERROR'
      ) {
        requestUrl = new URL(endpoint)
        optimizedPageSize = false
        pageIndex -= 1
        continue
      }
      throw new Error(
        error?.message === 'OTA_DOUYIN_REVIEW_BUSINESS_ERROR'
          ? 'OTA_DOUYIN_REVIEW_PAGINATION_BUSINESS_ERROR'
          : error?.message,
      )
    }
    pages.push(rows.length)
    fetchedRowCount += rows.length
    const candidateTotal = safeInteger(response.root?.data?.total_count)
    if (candidateTotal !== null) totalCount = candidateTotal
    if (classificationMetadata.length === 0) {
      classificationMetadata = douyinReviewClassificationMetadata(
        response.root?.data,
      )
    }
    for (const row of rows) {
      const attitude = Number(row?.attitude)
      if (Number.isFinite(attitude)) {
        attitudeCounts.set(attitude, (attitudeCounts.get(attitude) ?? 0) + 1)
      }
      const date = douyinPublishedDate(row?.publiced_time)
      if (date && (!oldestObservedDate || date < oldestObservedDate)) {
        oldestObservedDate = date
      }
      if (date && date >= monthStart && date <= effectiveBusinessDate) {
        monthlyAttitudeCounts.set(
          attitude,
          (monthlyAttitudeCounts.get(attitude) ?? 0) + 1,
        )
        if (date <= previousBusinessDate) {
          throughPreviousBusinessDateAttitudeCounts.set(
            attitude,
            (throughPreviousBusinessDateAttitudeCounts.get(attitude) ?? 0) + 1,
          )
        }
        if (date === previousBusinessDate) {
          yesterdayAttitudeCounts.set(
            attitude,
            (yesterdayAttitudeCounts.get(attitude) ?? 0) + 1,
          )
        }
      }
    }
    for (const profile of douyinScoreFieldProfiles(rows)) {
      const current = scoreProfiles.get(profile.fieldPath) ?? {
        fieldPath: profile.fieldPath,
        observedCount: 0,
        distinctValues: new Set(),
      }
      current.observedCount += profile.observedCount
      for (const value of profile.distinctValues) {
        if (current.distinctValues.size < 20) current.distinctValues.add(value)
      }
      scoreProfiles.set(profile.fieldPath, current)
    }
    accumulateIdentityFieldProfiles(rows, identityProfiles)
    for (const profile of douyinReviewClassificationProfiles(rows)) {
      const key = `${profile.attitude}:${profile.fieldPath}:${profile.value}`
      const current = classificationProfiles.get(key) ?? {
        ...profile,
        count: 0,
      }
      current.count += profile.count
      classificationProfiles.set(key, current)
    }
    for (const profile of douyinAttitudeSignalProfiles(rows)) {
      const current = attitudeSignalProfiles.get(profile.attitude) ?? {
        attitude: profile.attitude,
        count: 0,
        scoreTagSubTypes: new Map(),
        reviewSources: new Map(),
        complainStatuses: new Map(),
      }
      current.count += profile.count
      for (const [key, count] of Object.entries(profile.scoreTagSubTypes)) {
        current.scoreTagSubTypes.set(
          key,
          (current.scoreTagSubTypes.get(key) ?? 0) + count,
        )
      }
      for (const [key, count] of Object.entries(profile.reviewSources)) {
        current.reviewSources.set(
          key,
          (current.reviewSources.get(key) ?? 0) + count,
        )
      }
      for (const [key, count] of Object.entries(profile.complainStatuses)) {
        current.complainStatuses.set(
          key,
          (current.complainStatuses.get(key) ?? 0) + count,
        )
      }
      attitudeSignalProfiles.set(profile.attitude, current)
    }
    if (
      response.root?.data?.has_more !== true
      || rows.length === 0
      || (totalCount !== null && fetchedRowCount >= totalCount)
    ) {
      paginationComplete = true
      break
    }
    const nextCursor = response.root?.data?.next_cursor
    const searchAfter = response.root?.data?.search_after
    const cursorKey = JSON.stringify([nextCursor, searchAfter])
    if (
      (nextCursor === undefined && searchAfter === undefined)
      || seenCursors.has(cursorKey)
    ) {
      throw new Error('OTA_DOUYIN_REVIEW_PAGINATION_STALLED')
    }
    seenCursors.add(cursorKey)
    requestUrl = new URL(endpoint)
    if (optimizedPageSize) requestUrl.searchParams.set('count', '20')
    if (nextCursor !== undefined) {
      requestUrl.searchParams.set('cursor', String(nextCursor))
    }
    if (searchAfter !== undefined) {
      requestUrl.searchParams.set('search_after', String(searchAfter))
    }
  }
  if (!paginationComplete) {
    throw new Error('OTA_DOUYIN_REVIEW_PAGINATION_INCOMPLETE')
  }
  return {
    observedAt: now().toISOString(),
    httpStatus,
    rootType: 'OBJECT',
    recordPath: '$.data.reviews',
    recordCount: fetchedRowCount,
    detectedDimensions: ['REVIEW', 'DATE'],
    detectedFields: ['attitude', 'publiced_time', 'review_source'],
    providerDataset: {
      provider: 'DOUYIN',
      dataset: 'REVIEW',
      scope: 'BUSINESS_MONTH_TO_DATE',
      periodBasis: 'THROUGH_CURRENT_BUSINESS_DATE',
      rangeStart: monthStart,
      rangeEnd: effectiveBusinessDate,
      totalCount,
      returnedCount: fetchedRowCount,
      hasMore: false,
      safeDiagnosticsVersion: 3,
      schemaDiagnosticsVersion: 7,
      fetchedPageCount: pages.length,
      paginationComplete,
      oldestObservedDate,
      attitudeCounts: Object.fromEntries(
        [...attitudeCounts.entries()]
          .sort(([left], [right]) => left - right)
          .map(([key, count]) => [String(key), count]),
      ),
      monthlyAttitudeCounts: Object.fromEntries(
        [...monthlyAttitudeCounts.entries()]
          .sort(([left], [right]) => left - right)
          .map(([key, count]) => [String(key), count]),
      ),
      throughPreviousBusinessDateAttitudeCounts: Object.fromEntries(
        [...throughPreviousBusinessDateAttitudeCounts.entries()]
          .sort(([left], [right]) => left - right)
          .map(([key, count]) => [String(key), count]),
      ),
      yesterdayAttitudeCounts: Object.fromEntries(
        [...yesterdayAttitudeCounts.entries()]
          .sort(([left], [right]) => left - right)
          .map(([key, count]) => [String(key), count]),
      ),
      scoreFieldProfiles: [...scoreProfiles.values()].map((profile) => ({
        fieldPath: profile.fieldPath,
        observedCount: profile.observedCount,
        distinctValues: [...profile.distinctValues]
          .sort((left, right) => left - right),
      })),
      identityFieldProfiles: identityFieldProfileSummary(identityProfiles),
      classificationMetadata,
      classificationFieldProfiles: [...classificationProfiles.values()]
        .sort((left, right) =>
          left.attitude - right.attitude
          || left.fieldPath.localeCompare(right.fieldPath)
          || right.count - left.count)
        .slice(0, 200),
      attitudeSignalProfiles: [...attitudeSignalProfiles.values()]
        .sort((left, right) => left.attitude - right.attitude)
        .map((profile) => ({
          attitude: profile.attitude,
          count: profile.count,
          scoreTagSubTypes: Object.fromEntries(profile.scoreTagSubTypes),
          reviewSources: Object.fromEntries(profile.reviewSources),
          complainStatuses: Object.fromEntries(profile.complainStatuses),
        })),
    },
  }
}

const countFor = (counts, key) => counts.get(key) ?? 0

const collectDouyinReviewSummary = async ({
  endpoint,
  cookie,
  businessDate,
  fetchImpl,
  now,
}) => {
  const suppliedBusinessDate = canonicalDate(businessDate)
  const effectiveBusinessDate = suppliedBusinessDate ?? shanghaiDate(now())
  if (!effectiveBusinessDate) {
    throw new Error('OTA_DOUYIN_REVIEW_BUSINESS_DATE_INVALID')
  }
  const monthStart = `${effectiveBusinessDate.slice(0, 7)}-01`
  const previousBusinessDate = addCalendarDays(effectiveBusinessDate, -1)
  const headers = {
    Accept: 'application/json, text/plain, */*',
    'Accept-Language': 'zh-CN,zh;q=0.9',
    Cookie: cookie,
  }
  const seenReviewIds = new Set()
  const monthlyAttitudes = new Map()
  const throughPreviousAttitudes = new Map()
  const yesterdayAttitudes = new Map()
  const seenCursors = new Set()
  let requestUrl = new URL(endpoint)
  requestUrl.searchParams.set('count', '20')
  let optimizedPageSize = true
  let totalCount = null
  let httpStatus = 200
  let fetchedPageCount = 0
  let duplicateCount = 0
  let oldestObservedDate = null
  let paginationComplete = false

  for (let pageIndex = 0; pageIndex < MAX_DOUYIN_REVIEW_PAGES; pageIndex += 1) {
    const response = await requestOtaJson({
      endpoint: requestUrl,
      method: 'GET',
      headers,
      fetchImpl,
    })
    httpStatus = response.httpStatus
    let rows
    try {
      rows = douyinReviewRows(response.root)
    } catch (error) {
      if (
        pageIndex === 0
        && optimizedPageSize
        && error?.message === 'OTA_DOUYIN_REVIEW_BUSINESS_ERROR'
      ) {
        requestUrl = new URL(endpoint)
        optimizedPageSize = false
        pageIndex -= 1
        continue
      }
      throw new Error(
        error?.message === 'OTA_DOUYIN_REVIEW_BUSINESS_ERROR'
          ? 'OTA_DOUYIN_REVIEW_PAGINATION_BUSINESS_ERROR'
          : error?.message,
      )
    }
    fetchedPageCount += 1
    const candidateTotal = safeInteger(response.root?.data?.total_count)
    if (candidateTotal !== null) totalCount = candidateTotal
    for (const row of rows) {
      const reviewId = row?.review_id
      if (reviewId === undefined || reviewId === null || reviewId === '') {
        throw new Error('OTA_DOUYIN_REVIEW_ID_MISSING')
      }
      const reviewKey = hashScalar(reviewId)
      if (seenReviewIds.has(reviewKey)) {
        duplicateCount += 1
        continue
      }
      seenReviewIds.add(reviewKey)
      const attitude = Number(row?.attitude)
      const date = douyinPublishedDate(row?.publiced_time)
      if (!Number.isSafeInteger(attitude) || !date) {
        throw new Error('OTA_DOUYIN_REVIEW_CLASSIFICATION_UNRECOGNIZED')
      }
      if (!oldestObservedDate || date < oldestObservedDate) {
        oldestObservedDate = date
      }
      if (date < monthStart || date > effectiveBusinessDate) continue
      monthlyAttitudes.set(attitude, countFor(monthlyAttitudes, attitude) + 1)
      if (date <= previousBusinessDate) {
        throughPreviousAttitudes.set(
          attitude,
          countFor(throughPreviousAttitudes, attitude) + 1,
        )
      }
      if (date === previousBusinessDate) {
        yesterdayAttitudes.set(
          attitude,
          countFor(yesterdayAttitudes, attitude) + 1,
        )
      }
    }
    if (response.root?.data?.has_more !== true || rows.length === 0) {
      paginationComplete = true
      break
    }
    const nextCursor = response.root?.data?.next_cursor
    const searchAfter = response.root?.data?.search_after
    const cursorKey = JSON.stringify([nextCursor, searchAfter])
    if (
      (nextCursor === undefined && searchAfter === undefined)
      || seenCursors.has(cursorKey)
    ) {
      throw new Error('OTA_DOUYIN_REVIEW_PAGINATION_STALLED')
    }
    seenCursors.add(cursorKey)
    requestUrl = new URL(endpoint)
    if (optimizedPageSize) requestUrl.searchParams.set('count', '20')
    if (nextCursor !== undefined) {
      requestUrl.searchParams.set('cursor', String(nextCursor))
    }
    if (searchAfter !== undefined) {
      requestUrl.searchParams.set('search_after', String(searchAfter))
    }
  }
  if (!paginationComplete) {
    throw new Error('OTA_DOUYIN_REVIEW_PAGINATION_INCOMPLETE')
  }
  const supportedAttitudes = new Set([
    DOUYIN_GOOD_ATTITUDE,
    DOUYIN_NEUTRAL_ATTITUDE,
    DOUYIN_NEGATIVE_ATTITUDE,
  ])
  const unsupportedMonthlyCount = [...monthlyAttitudes.entries()]
    .filter(([attitude]) => !supportedAttitudes.has(attitude))
    .reduce((sum, [, count]) => sum + count, 0)
  if (unsupportedMonthlyCount > 0) {
    throw new Error('OTA_DOUYIN_REVIEW_CLASSIFICATION_UNSUPPORTED')
  }
  const monthlyGoodCount = countFor(
    monthlyAttitudes,
    DOUYIN_GOOD_ATTITUDE,
  )
  const monthlyNegativeCount = countFor(
    monthlyAttitudes,
    DOUYIN_NEGATIVE_ATTITUDE,
  )
  const goodCountThroughPreviousBusinessDate = countFor(
    throughPreviousAttitudes,
    DOUYIN_GOOD_ATTITUDE,
  )
  const negativeCountThroughPreviousBusinessDate = countFor(
    throughPreviousAttitudes,
    DOUYIN_NEGATIVE_ATTITUDE,
  )
  return {
    observedAt: now().toISOString(),
    httpStatus,
    rootType: 'OBJECT',
    recordPath: '$.data.reviews',
    recordCount: seenReviewIds.size,
    detectedDimensions: ['REVIEW', 'DATE'],
    detectedFields: ['attitude', 'publiced_time', 'review_source'],
    providerDataset: {
      provider: 'DOUYIN',
      dataset: 'REVIEW',
      scope: 'BUSINESS_MONTH_TO_DATE',
      periodBasis: 'THROUGH_CURRENT_BUSINESS_DATE',
      rangeStart: monthStart,
      rangeEnd: effectiveBusinessDate,
      totalCount,
      returnedCount: seenReviewIds.size,
      hasMore: false,
      fetchedPageCount,
      paginationComplete,
      oldestObservedDate,
      duplicateCount,
      aggregationVersion: DOUYIN_REVIEW_AGGREGATION_VERSION,
    },
    reviewMetrics: {
      provider: 'DOUYIN',
      metricBasis: 'DOUYIN_NATIVE_ATTITUDE',
      businessDate: effectiveBusinessDate,
      businessDateBasis: suppliedBusinessDate
        ? 'PMS_CONFIRMED'
        : 'SYSTEM_DATE_FALLBACK',
      previousBusinessDate,
      monthStart,
      monthlyGoodCount,
      monthlyNegativeCount,
      yesterdayNegativeCount: countFor(
        yesterdayAttitudes,
        DOUYIN_NEGATIVE_ATTITUDE,
      ),
      goodCountThroughPreviousBusinessDate,
      negativeCountThroughPreviousBusinessDate,
      validStayedOrderCountThroughPreviousBusinessDate: null,
      eligibleOtaOrderCountThroughPreviousBusinessDate: null,
      goodRatePercent: null,
      negativeRatePermille: null,
      denominatorSource: 'MATCHED_OTA_ORDER_SOURCE',
      denominatorStatus: 'ORDER_SOURCE_MISSING',
      totalAllTime: totalCount,
      fetchedRowCount: seenReviewIds.size,
      fetchedPageCount,
      paginationComplete,
      aggregationVersion: DOUYIN_REVIEW_AGGREGATION_VERSION,
    },
  }
}

const douyinOrderRows = (root) => {
  assertDouyinBusinessSuccess(root, 'ORDER')
  if (!Array.isArray(root?.data?.data)) {
    throw new Error('OTA_DOUYIN_ORDER_SCHEMA_UNRECOGNIZED')
  }
  const rows = root.data.data.flatMap((row) => {
    if (row !== null && typeof row === 'object' && !Array.isArray(row)) {
      return [row]
    }
    if (typeof row !== 'string') return []
    try {
      const parsed = JSON.parse(row)
      return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
        ? [parsed]
        : []
    } catch {
      return []
    }
  })
  if (root.data.data.length > 0 && rows.length < 1) {
    throw new Error('OTA_DOUYIN_ORDER_SCHEMA_UNRECOGNIZED')
  }
  return rows
}

const douyinOrderBusinessDate = (row) => {
  const candidates = [
    row?.book_detail_info?.book_apply_time,
    row?.order_base_info?.create_time,
  ]
  for (const candidate of candidates) {
    const date = canonicalDate(candidate) ?? douyinPublishedDate(candidate)
    if (date) return date
  }
  return null
}

const douyinOrderIdentity = (row) => {
  const candidates = [
    row?.book_detail_info?.book_id,
    row?.book_detail_info?.book_order_id,
    row?.order_base_info?.order_id,
  ]
  const value = candidates.find(
    (candidate) => candidate !== undefined
      && candidate !== null
      && candidate !== '',
  )
  return value === undefined ? null : hashScalar(value)
}

const douyinOrderCanceled = (row) =>
  row?.play_methods_v2?.is_cancel === true
  || row?.play_methods_v2?.is_cancel === 1
  || row?.play_methods_v2?.is_cancel === '1'

export const summarizeDouyinOrderJson = (root) => {
  const rows = douyinOrderRows(root)
  const canceledCount = rows.filter(
    douyinOrderCanceled,
  ).length
  const totalCount = safeInteger(root?.data?.pagination?.total_count)
  return {
    rootType: 'OBJECT',
    recordPath: '$.data.data',
    recordCount: rows.length,
    detectedDimensions: ['ORDER', 'DATE', 'SALES', 'CANCELLATION'],
    detectedFields: [
      'book_apply_time',
      'book_night_count',
      'book_room_count',
      'is_cancel',
    ],
    providerDataset: {
      provider: 'DOUYIN',
      dataset: 'ORDER',
      scope: 'ENDPOINT_TOTAL_AND_CURRENT_PAGE',
      totalCount,
      returnedCount: rows.length,
      canceledCount,
      nonCanceledCount: rows.length - canceledCount,
      hasMore: root?.data?.pagination?.has_more === true,
      schemaDiagnosticsVersion: 7,
      identityFieldProfiles: identityFieldProfiles(rows),
      dateFieldProfiles: dateFieldProfiles(rows),
    },
  }
}

const collectDouyinOrderSummary = async ({
  source,
  endpoint,
  cookie,
  businessDate,
  fetchImpl,
  now,
}) => {
  const effectiveBusinessDate = canonicalDate(businessDate)
    ?? shanghaiDate(now())
  if (!effectiveBusinessDate) {
    throw new Error('OTA_DOUYIN_ORDER_BUSINESS_DATE_INVALID')
  }
  const rangeStart = `${effectiveBusinessDate.slice(0, 7)}-01`
  const rangeEnd = addCalendarDays(effectiveBusinessDate, -1)
  const headers = {
    Accept: 'application/json, text/plain, */*',
    'Accept-Language': 'zh-CN,zh;q=0.9',
    Cookie: cookie,
    ...(source.requestMethod === 'POST'
      ? { 'Content-Type': 'application/json;charset=UTF-8' }
      : {}),
  }
  const basePayload = source.requestMethod === 'POST'
    ? parseRequestPayload(source)
    : null
  const seenOrderIds = new Set()
  const configuredPageSize = safeInteger(
    new URL(endpoint).searchParams.get('page_size'),
  ) || 20
  let pageSize = DOUYIN_ORDER_OPTIMIZED_PAGE_SIZE
  let optimizedPageSize = true
  let monthlyCount = 0
  let canceledCount = 0
  let fetchedPageCount = 0
  let duplicateCount = 0
  let httpStatus = 200
  let paginationComplete = rangeEnd < rangeStart

  for (
    let pageIndex = 1;
    !paginationComplete && pageIndex <= MAX_DOUYIN_ORDER_PAGES;
    pageIndex += 1
  ) {
    const requestUrl = new URL(endpoint)
    requestUrl.searchParams.set('page_index', String(pageIndex))
    requestUrl.searchParams.set('page_size', String(pageSize))
    const body = basePayload
      ? JSON.stringify({
          ...basePayload,
          page_index: pageIndex,
          page_size: pageSize,
        })
      : undefined
    const response = await requestOtaJson({
      endpoint: requestUrl,
      method: source.requestMethod,
      body,
      headers,
      fetchImpl,
    })
    httpStatus = response.httpStatus
    let rows
    try {
      rows = douyinOrderRows(response.root)
    } catch (error) {
      if (
        pageIndex === 1
        && optimizedPageSize
        && error?.message === 'OTA_DOUYIN_ORDER_BUSINESS_ERROR'
      ) {
        pageSize = configuredPageSize
        optimizedPageSize = false
        pageIndex -= 1
        continue
      }
      throw error
    }
    fetchedPageCount += 1
    let newIdentityCount = 0
    for (const row of rows) {
      const identity = douyinOrderIdentity(row)
      const date = douyinOrderBusinessDate(row)
      if (!identity || !date) {
        throw new Error('OTA_DOUYIN_ORDER_ID_OR_DATE_MISSING')
      }
      if (seenOrderIds.has(identity)) {
        duplicateCount += 1
        continue
      }
      seenOrderIds.add(identity)
      newIdentityCount += 1
      if (date < rangeStart || date > rangeEnd) continue
      monthlyCount += 1
      if (douyinOrderCanceled(row)) canceledCount += 1
    }
    const hasMore = response.root?.data?.pagination?.has_more === true
    if (!hasMore || rows.length === 0) {
      paginationComplete = true
      break
    }
    if (newIdentityCount === 0) {
      throw new Error('OTA_DOUYIN_ORDER_PAGINATION_STALLED')
    }
  }
  if (!paginationComplete) {
    throw new Error('OTA_DOUYIN_ORDER_PAGINATION_INCOMPLETE')
  }
  return {
    observedAt: now().toISOString(),
    httpStatus,
    rootType: 'OBJECT',
    recordPath: '$.data.data',
    recordCount: monthlyCount,
    detectedDimensions: ['ORDER', 'DATE', 'SALES', 'CANCELLATION'],
    detectedFields: [
      'book_apply_time',
      'book_night_count',
      'book_room_count',
      'is_cancel',
    ],
    providerDataset: {
      provider: 'DOUYIN',
      dataset: 'ORDER',
      scope: 'BUSINESS_MONTH_TO_DATE',
      periodBasis: 'THROUGH_PREVIOUS_BUSINESS_DATE',
      rangeStart,
      rangeEnd,
      totalCount: monthlyCount,
      returnedCount: seenOrderIds.size,
      canceledCount,
      nonCanceledCount: monthlyCount - canceledCount,
      hasMore: false,
      fetchedPageCount,
      paginationComplete,
      duplicateCount,
      aggregationVersion: DOUYIN_ORDER_AGGREGATION_VERSION,
    },
  }
}

export const summarizeMeituanOrderJson = ({
  allRoot,
  canceledRoot,
  rangeStart,
  rangeEnd,
}) => {
  if (Number(allRoot?.status) !== 0 || Number(canceledRoot?.status) !== 0) {
    throw new Error('OTA_MEITUAN_ORDER_BUSINESS_ERROR')
  }
  const totalCount = safeInteger(allRoot?.data?.total)
  const canceledCount = safeInteger(canceledRoot?.data?.total)
  if (totalCount === null || canceledCount === null || canceledCount > totalCount) {
    throw new Error('OTA_MEITUAN_ORDER_SCHEMA_UNRECOGNIZED')
  }
  return {
    rootType: 'OBJECT',
    recordPath: '$.data.results',
    recordCount: totalCount,
    detectedDimensions: ['ORDER', 'DATE', 'SALES', 'CANCELLATION'],
    detectedFields: ['status', 'bookingTime', 'checkInDate', 'roomCount'],
    providerDataset: {
      provider: 'MEITUAN',
      dataset: 'ORDER',
      scope: 'BUSINESS_MONTH_TO_DATE',
      periodBasis: 'THROUGH_PREVIOUS_BUSINESS_DATE',
      rangeStart,
      rangeEnd,
      totalCount,
      returnedCount: Array.isArray(allRoot?.data?.results)
        ? allRoot.data.results.length
        : 0,
      canceledCount,
      nonCanceledCount: totalCount - canceledCount,
    },
  }
}

export const summarizeOtaJson = (root) => {
  const candidates = objectRows(root)
    .sort((left, right) => right.rows.length - left.rows.length)
  const selected = candidates[0] ?? {
    path: Array.isArray(root) ? '$' : null,
    rows: Array.isArray(root) ? root : [],
  }
  const fields = [...new Set(
    selected.rows
      .slice(0, MAX_SCAN_ROWS)
      .flatMap((row) => Object.keys(row)),
  )]
    .sort()
    .slice(0, MAX_FIELDS)
  const detectedDimensions = Object.entries(dimensionMatchers)
    .filter(([, matcher]) => fields.some((field) => matcher.test(field)))
    .map(([dimension]) => dimension)
  return {
    rootType:
      Array.isArray(root) ? 'ARRAY' : root === null ? 'NULL' : typeof root,
    recordPath: selected.path,
    recordCount: selected.rows.length,
    detectedDimensions,
    detectedFields: fields,
  }
}

const requestOtaJson = async ({
  endpoint,
  method,
  body,
  headers,
  fetchImpl,
}) => {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 20_000)
  let response
  try {
    response = await fetchImpl(endpoint, {
      method,
      redirect: 'manual',
      signal: controller.signal,
      headers,
      ...(body ? { body } : {}),
    })
  } catch (error) {
    if (error?.name === 'AbortError') throw new Error('OTA_REFRESH_TIMEOUT')
    throw new Error('OTA_NETWORK_FAILED')
  } finally {
    clearTimeout(timer)
  }
  if (response.status >= 300 && response.status <= 399) {
    const location = response.headers?.get?.('location') ?? ''
    let loginRedirect = false
    try {
      const target = new URL(location, endpoint)
      loginRedirect = [
        'login.taobao.com',
        'login.tmall.com',
        'login.fliggy.com',
      ].includes(target.hostname.toLowerCase())
    } catch {
      loginRedirect = false
    }
    throw new Error(
      loginRedirect ? 'OTA_SESSION_INVALID' : 'OTA_HTTP_REDIRECT',
    )
  }
  if (!response.ok) {
    const status = Number(response.status)
    const error = new Error(
      Number.isInteger(status) && status >= 400 && status <= 599
        ? `OTA_HTTP_${status}`
        : 'OTA_HTTP_ERROR',
    )
    error.httpStatus = response.status
    throw error
  }
  const text = await readLimitedText(response)
  try {
    return { root: JSON.parse(text), httpStatus: response.status }
  } catch {
    throw new Error('OTA_RESPONSE_NOT_JSON')
  }
}

const parseRequestPayload = (source) => {
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

const collectMeituanOrderSummary = async ({
  source,
  endpoint,
  cookie,
  businessDate,
  fetchImpl,
  now,
}) => {
  const effectiveBusinessDate = canonicalDate(businessDate)
    ?? shanghaiDate(now())
  if (!effectiveBusinessDate) {
    throw new Error('OTA_MEITUAN_ORDER_BUSINESS_DATE_INVALID')
  }
  const rangeStart = `${effectiveBusinessDate.slice(0, 7)}-01`
  const rangeEnd = addCalendarDays(effectiveBusinessDate, -1)
  if (rangeEnd < rangeStart) {
    return {
      observedAt: now().toISOString(),
      httpStatus: 200,
      ...summarizeMeituanOrderJson({
        allRoot: { status: 0, data: { total: 0, results: [] } },
        canceledRoot: { status: 0, data: { total: 0, results: [] } },
        rangeStart,
        rangeEnd,
      }),
    }
  }
  const basePayload = {
    ...parseRequestPayload(source),
    startTime: shanghaiRangeMilliseconds(rangeStart),
    endTime: shanghaiRangeMilliseconds(rangeEnd, true),
  }
  delete basePayload.orderStatus
  delete basePayload.cancelOrder
  const headers = {
    Accept: 'application/json, text/plain, */*',
    'Accept-Language': 'zh-CN,zh;q=0.9',
    Cookie: cookie,
    Referer: MEITUAN_EBOOKING_REFERER,
    'User-Agent': CONTROLLED_BROWSER_USER_AGENT,
    'Content-Type': 'application/json;charset=UTF-8',
  }
  const allResponse = await requestOtaJson({
    endpoint,
    method: 'POST',
    body: JSON.stringify(basePayload),
    headers,
    fetchImpl,
  })
  const canceledResponse = await requestOtaJson({
    endpoint,
    method: 'POST',
    body: JSON.stringify({ ...basePayload, orderStatus: 'CANCELED' }),
    headers,
    fetchImpl,
  })
  return {
    observedAt: now().toISOString(),
    httpStatus: allResponse.httpStatus,
    ...summarizeMeituanOrderJson({
      allRoot: allResponse.root,
      canceledRoot: canceledResponse.root,
      rangeStart,
      rangeEnd,
    }),
  }
}

export const collectOtaSource = async ({
  source,
  cookie,
  businessDate,
  validStayedOrderCountThroughPreviousBusinessDate = null,
  fetchImpl = globalThis.fetch,
  lookupImpl = lookup,
  now = () => new Date(),
}) => {
  if (
    !source
    || typeof source !== 'object'
    || !['GET', 'POST'].includes(source.requestMethod)
    || typeof source.dataEndpointUrl !== 'string'
  ) {
    throw new Error('OTA_SOURCE_INVALID')
  }
  const builtInEndpointUrl = builtInFliggyEndpointUrl(source)
  const usesBuiltInOrderEndpoint = Boolean(
    builtInFliggyOrderEndpointUrl(source),
  )
  const effectiveSource = builtInEndpointUrl && !source.dataEndpointUrl.trim()
    ? {
        ...source,
        dataEndpointUrl: builtInEndpointUrl,
        requestMethod: usesBuiltInOrderEndpoint ? 'GET' : 'POST',
        requestPayloadJson: usesBuiltInOrderEndpoint
          ? ''
          : source.requestPayloadJson,
      }
    : source
  if (!effectiveSource.dataEndpointUrl.trim()) {
    throw new Error('OTA_SOURCE_NOT_CONFIGURED')
  }
  if (typeof cookie !== 'string' || !cookie.trim()) {
    throw new Error('OTA_COOKIE_REQUIRED_FOR_REFRESH')
  }
  const endpoint = await validateEndpoint(
    effectiveSource.dataEndpointUrl,
    lookupImpl,
  )
  if (isMeituanCommentSource({ source: effectiveSource, endpoint })) {
    return collectMeituanCommentSummary({
      source: effectiveSource,
      endpoint,
      cookie,
      businessDate,
      validStayedOrderCountThroughPreviousBusinessDate,
      now,
    })
  }
  if (isMeituanOrderSource({ source: effectiveSource, endpoint })) {
    return collectMeituanOrderSummary({
      source: effectiveSource,
      endpoint,
      cookie,
      businessDate,
      fetchImpl,
      now,
    })
  }
  if (isDouyinReviewSource({ source: effectiveSource, endpoint })) {
    return collectDouyinReviewSummary({
      endpoint,
      cookie,
      businessDate,
      fetchImpl,
      now,
    })
  }
  if (isDouyinOrderSource({ source: effectiveSource, endpoint })) {
    return collectDouyinOrderSummary({
      source: effectiveSource,
      endpoint,
      cookie,
      businessDate,
      fetchImpl,
      now,
    })
  }
  if (isFliggySource({ source: effectiveSource, endpoint })) {
    return collectFliggySourceSummary({
      source: effectiveSource,
      endpoint,
      cookie,
      businessDate,
      requestJson: (request) => requestOtaJson({
        ...request,
        fetchImpl,
      }),
      now,
    })
  }
  let body
  if (effectiveSource.requestMethod === 'POST') {
    body = JSON.stringify(parseRequestPayload(effectiveSource))
  }
  const response = await requestOtaJson({
    endpoint,
    method: effectiveSource.requestMethod,
    body,
    headers: {
      Accept: 'application/json, text/plain, */*',
      'Accept-Language': 'zh-CN,zh;q=0.9',
      Cookie: cookie,
      ...providerRequestHeaders({ source: effectiveSource, endpoint }),
      ...(effectiveSource.requestMethod === 'POST'
        ? { 'Content-Type': 'application/json;charset=UTF-8' }
        : {}),
    },
    fetchImpl,
  })
  const { root } = response
  const summary = summarizeOtaJson(root)
  const peerRanking = summarizeMeituanPeerRanking({
    root,
    source: effectiveSource,
    endpoint,
  })
  return {
    observedAt: now().toISOString(),
    httpStatus: response.httpStatus,
    ...summary,
    ...(peerRanking ? { peerRanking } : {}),
  }
}

export const otaSourceCollectorLimits = Object.freeze({
  maxResponseBytes: MAX_RESPONSE_BYTES,
  maxScanRows: MAX_SCAN_ROWS,
  maxFields: MAX_FIELDS,
})
