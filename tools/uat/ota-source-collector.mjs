import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'

const MAX_RESPONSE_BYTES = 2 * 1024 * 1024
const MAX_SCAN_ROWS = 200
const MAX_FIELDS = 60
const MEITUAN_EBOOKING_HOST = 'eb.meituan.com'
const MEITUAN_EBOOKING_REFERER = 'https://eb.meituan.com/'
const MEITUAN_PEER_RANK_PATH =
  '/api/v1/ebooking/business/peer/rank/data/result'
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

export const collectOtaSource = async ({
  source,
  cookie,
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
  if (typeof cookie !== 'string' || !cookie.trim()) {
    throw new Error('OTA_COOKIE_REQUIRED_FOR_REFRESH')
  }
  const endpoint = await validateEndpoint(
    source.dataEndpointUrl,
    lookupImpl,
  )
  let body
  if (source.requestMethod === 'POST') {
    try {
      body = JSON.stringify(
        JSON.parse(source.requestPayloadJson || '{}'),
      )
    } catch {
      throw new Error('OTA_REQUEST_PAYLOAD_INVALID')
    }
  }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 20_000)
  let response
  try {
    response = await fetchImpl(endpoint, {
      method: source.requestMethod,
      redirect: 'error',
      signal: controller.signal,
      headers: {
        Accept: 'application/json, text/plain, */*',
        'Accept-Language': 'zh-CN,zh;q=0.9',
        Cookie: cookie,
        ...providerRequestHeaders({ source, endpoint }),
        ...(source.requestMethod === 'POST'
          ? { 'Content-Type': 'application/json;charset=UTF-8' }
          : {}),
      },
      ...(body ? { body } : {}),
    })
  } catch (error) {
    if (error?.name === 'AbortError') throw new Error('OTA_REFRESH_TIMEOUT')
    throw new Error('OTA_NETWORK_FAILED')
  } finally {
    clearTimeout(timer)
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
  let root
  try {
    root = JSON.parse(text)
  } catch {
    throw new Error('OTA_RESPONSE_NOT_JSON')
  }
  const summary = summarizeOtaJson(root)
  const peerRanking = summarizeMeituanPeerRanking({
    root,
    source,
    endpoint,
  })
  return {
    observedAt: now().toISOString(),
    httpStatus: response.status,
    ...summary,
    ...(peerRanking ? { peerRanking } : {}),
  }
}

export const otaSourceCollectorLimits = Object.freeze({
  maxResponseBytes: MAX_RESPONSE_BYTES,
  maxScanRows: MAX_SCAN_ROWS,
  maxFields: MAX_FIELDS,
})
