const MAX_SCHEMA_FIELDS = 300
const MAX_SCHEMA_DEPTH = 7

const SENSITIVE_KEY_PATTERN =
  /(?:password|passwd|pwd|secret|token|cookie|authorization|session|jsessionid|captcha|verification|verifycode|mobile|phone|telephone|email|idcard|identity|certificate|guest|customer|contact|member|address)/i

const SAFE_PARAMETER_KEY_PATTERN =
  /(?:begin|end|start|from|to|date|day|month|year|hour|time|page|size|limit|offset|hotel|store|tenant|room|channel|status|type|code)/i

const DIMENSION_MATCHERS = [
  ['DATE', /(?:date|day|businessday|arrivaltime|departuretime|checkin|checkout)/i],
  ['ROOM_TYPE', /(?:roomtype|room_type|roomtypename|room_type_name)/i],
  ['INVENTORY', /(?:inventory|available|vacant|remaining|stock|roomcount)/i],
  ['PRICE', /(?:price|rate|adr|amount|revenue)/i],
  ['SALES', /(?:sales|sold|order|booking|reservation)/i],
  ['CHANNEL', /(?:channel|source|ota|marketcode)/i],
  ['CANCELLATION', /(?:cancel|cancellation|refund)/i],
  ['OCCUPANCY', /(?:occupancy|occ|roomnight)/i],
]

const scalarType = (value) => {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'array'
  return typeof value
}

const sanitizedKey = (key) =>
  String(key ?? '')
    .replace(/[^\w.-]/g, '_')
    .slice(0, 120)

const summarizeScalar = (key, value) => {
  if (SENSITIVE_KEY_PATTERN.test(key)) return '[REDACTED]'
  if (!SAFE_PARAMETER_KEY_PATTERN.test(key)) {
    if (typeof value === 'string') return `[STRING:${value.length}]`
    return `[${scalarType(value).toUpperCase()}]`
  }
  if (typeof value === 'string') return value.slice(0, 120)
  if (typeof value === 'number' || typeof value === 'boolean') return value
  if (value === null) return null
  return `[${scalarType(value).toUpperCase()}]`
}

const summarizePayloadValue = (value, key = '', depth = 0) => {
  if (depth >= MAX_SCHEMA_DEPTH) return '[MAX_DEPTH]'
  if (Array.isArray(value)) {
    return {
      type: 'array',
      length: value.length,
      item:
        value.length > 0
          ? summarizePayloadValue(value[0], key, depth + 1)
          : null,
    }
  }
  if (value && typeof value === 'object') {
    const result = {}
    for (const [childKey, childValue] of Object.entries(value).slice(0, 100)) {
      const safeKey = sanitizedKey(childKey)
      result[safeKey] = SENSITIVE_KEY_PATTERN.test(safeKey)
        ? '[REDACTED]'
        : summarizePayloadValue(childValue, safeKey, depth + 1)
    }
    return result
  }
  return summarizeScalar(key, value)
}

export const isLuopanUrl = (rawUrl) => {
  try {
    const parsed = new URL(rawUrl)
    const hostname = parsed.hostname.toLowerCase()
    return (
      ['http:', 'https:'].includes(parsed.protocol)
      && (
        hostname === 'chinapms.com'
        || hostname.endsWith('.chinapms.com')
      )
    )
  } catch {
    return false
  }
}

export const sanitizeNetworkUrl = (rawUrl) => {
  const parsed = new URL(rawUrl)
  const pathname = parsed.pathname
    .replace(/;jsessionid=[^/;?#]*/gi, '')
    .replace(/\/{2,}/g, '/')
  const queryKeys = [
    ...new Set(
      [...parsed.searchParams.keys()]
        .map(sanitizedKey)
        .filter(Boolean),
    ),
  ].sort()
  return {
    endpoint: `${parsed.protocol}//${parsed.host}${pathname}`,
    queryKeys,
  }
}

export const isAuthenticationUrl = (rawUrl) => {
  try {
    const parsed = new URL(rawUrl)
    return /(?:login|logout|auth|captcha|verification|verify|checkcode|validate)/i
      .test(parsed.pathname)
  } catch {
    return true
  }
}

export const summarizeRequestPayload = ({
  postData,
  contentType = '',
}) => {
  if (typeof postData !== 'string' || !postData) return null
  try {
    if (/json/i.test(contentType)) {
      return {
        format: 'JSON',
        fields: summarizePayloadValue(JSON.parse(postData)),
      }
    }
    const parameters = new URLSearchParams(postData)
    const fields = {}
    for (const [key, value] of parameters.entries()) {
      const safeKey = sanitizedKey(key)
      fields[safeKey] = summarizeScalar(safeKey, value)
    }
    return {
      format: 'FORM',
      fields,
    }
  } catch {
    return {
      format: 'UNPARSED',
      byteLength: Buffer.byteLength(postData),
    }
  }
}

export const summarizeJsonShape = (rootValue) => {
  const fieldTypes = new Map()
  const arrayLengths = new Map()
  const fieldNames = new Set()
  let visitedFields = 0

  const visit = (value, path, depth) => {
    if (
      depth > MAX_SCHEMA_DEPTH
      || visitedFields >= MAX_SCHEMA_FIELDS
    ) return
    if (Array.isArray(value)) {
      const current = arrayLengths.get(path) ?? 0
      arrayLengths.set(path, Math.max(current, value.length))
      for (const item of value.slice(0, 3)) {
        visit(item, `${path}[]`, depth + 1)
      }
      return
    }
    if (value && typeof value === 'object') {
      for (const [key, child] of Object.entries(value)) {
        if (visitedFields >= MAX_SCHEMA_FIELDS) break
        visitedFields += 1
        const safeKey = sanitizedKey(key)
        fieldNames.add(safeKey)
        const childPath = path ? `${path}.${safeKey}` : safeKey
        const types = fieldTypes.get(childPath) ?? new Set()
        types.add(scalarType(child))
        fieldTypes.set(childPath, types)
        visit(child, childPath, depth + 1)
      }
    }
  }

  visit(rootValue, '$', 0)
  const detectedDimensions = DIMENSION_MATCHERS
    .filter(([, matcher]) =>
      [...fieldNames].some((fieldName) => matcher.test(fieldName)))
    .map(([dimension]) => dimension)
  const arrays = [...arrayLengths.entries()]
    .map(([path, length]) => ({ path, length }))
    .sort((left, right) => right.length - left.length)
  return {
    rootType: scalarType(rootValue),
    recordCount: arrays[0]?.length ?? 0,
    arrays: arrays.slice(0, 30),
    fieldPaths: [...fieldTypes.entries()]
      .map(([path, types]) => ({
        path,
        types: [...types].sort(),
      }))
      .sort((left, right) => left.path.localeCompare(right.path))
      .slice(0, MAX_SCHEMA_FIELDS),
    detectedDimensions,
    truncated: visitedFields >= MAX_SCHEMA_FIELDS,
  }
}
