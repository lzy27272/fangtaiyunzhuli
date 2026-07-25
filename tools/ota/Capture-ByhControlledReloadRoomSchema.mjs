import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const playwrightModule = process.env.UAT_PLAYWRIGHT_MODULE
const cdpEndpoint = process.env.BYH_CDP_ENDPOINT
const targetOrigin = 'https://pms.meituan.com'
const targetPath = '/hotelpms/api/v1/report/home/workbench/room'
const genericEnvelopeKeys = new Set([
  'code',
  'data',
  'error',
  'errorCode',
  'message',
  'msg',
  'result',
  'status',
  'success',
  'timestamp',
])

if (!playwrightModule) {
  throw new Error('UAT_PLAYWRIGHT_MODULE is required')
}
if (!cdpEndpoint || !/^http:\/\/127\.0\.0\.1:\d+$/.test(cdpEndpoint)) {
  throw new Error('BYH_CDP_ENDPOINT must be a loopback HTTP endpoint')
}

const buildSchema = (payload) => {
  const maxPaths = 500
  const maxDepth = 10
  const paths = new Map()
  const anonymousKeys = new Map()
  let truncated = false

  const safeKey = (key) => {
    if (genericEnvelopeKeys.has(key)) return key
    if (!anonymousKeys.has(key)) {
      anonymousKeys.set(key, `field_${String(anonymousKeys.size + 1).padStart(3, '0')}`)
    }
    return anonymousKeys.get(key)
  }

  const addType = (path, type) => {
    if (!paths.has(path) && paths.size >= maxPaths) {
      truncated = true
      return false
    }
    const types = paths.get(path) ?? new Set()
    types.add(type)
    paths.set(path, types)
    return true
  }

  const walk = (value, path, depth) => {
    if (depth > maxDepth) {
      truncated = true
      return
    }
    if (value === null) {
      addType(path, 'null')
      return
    }
    if (Array.isArray(value)) {
      if (!addType(path, 'array')) return
      if (value.length > 3) truncated = true
      for (const item of value.slice(0, 3)) {
        walk(item, `${path}[]`, depth + 1)
      }
      return
    }
    if (typeof value === 'object') {
      if (!addType(path, 'object')) return
      const entries = Object.entries(value)
      if (entries.length > 100) truncated = true
      for (const [key, child] of entries.slice(0, 100)) {
        walk(child, `${path}.${safeKey(key)}`, depth + 1)
      }
      return
    }
    addType(path, typeof value)
  }

  walk(payload, '$', 0)
  return {
    paths: [...paths.entries()].map(([path, types]) => ({
      path,
      types: [...types].sort(),
    })),
    truncated,
  }
}

const parseJsonSchema = (rawText, maxBytes) => {
  if (rawText === null) {
    return { format: 'NONE', schema: [], truncated: false }
  }
  if (Buffer.byteLength(rawText, 'utf8') > maxBytes) {
    return {
      format: 'SIZE_LIMIT_EXCEEDED',
      schema: [],
      truncated: true,
    }
  }
  try {
    const parsed = JSON.parse(rawText)
    const schema = buildSchema(parsed)
    return {
      format: 'JSON',
      schema: schema.paths,
      truncated: schema.truncated,
    }
  } catch {
    return { format: 'NON_JSON', schema: [], truncated: false }
  }
}

const { chromium } = require(playwrightModule)
const browser = await chromium.connectOverCDP(cdpEndpoint)
const pages = browser.contexts().flatMap((context) => context.pages())
const matchingPages = pages.filter((candidate) => {
  try {
    const url = new URL(candidate.url())
    return url.origin === targetOrigin && url.pathname === '/'
  } catch {
    return false
  }
})

if (matchingPages.length !== 1) {
  throw new Error('Expected exactly one PMS workbench page in the isolated browser')
}
const [page] = matchingPages

const responsePromise = page.waitForResponse(
  (response) => {
    try {
      const url = new URL(response.url())
      return (
        url.origin === targetOrigin &&
        url.pathname === targetPath &&
        url.search === '' &&
        response.request().method() === 'POST' &&
        ['fetch', 'xhr'].includes(response.request().resourceType())
      )
    } catch {
      return false
    }
  },
  { timeout: 35_000 },
)

const [response] = await Promise.all([
  responsePromise,
  page.reload({ waitUntil: 'domcontentloaded', timeout: 30_000 }),
])
const request = response.request()

const requestResult = parseJsonSchema(request.postData(), 64 * 1024)
let responseResult
try {
  const responseBuffer = await response.body()
  if (responseBuffer.byteLength > 512 * 1024) {
    responseResult = {
      format: 'SIZE_LIMIT_EXCEEDED',
      schema: [],
      truncated: true,
    }
  } else {
    responseResult = parseJsonSchema(responseBuffer.toString('utf8'), 512 * 1024)
  }
} catch {
  responseResult = {
    format: 'BODY_READ_FAILED',
    schema: [],
    truncated: false,
  }
}

const output = JSON.stringify(
  {
    endpoint: `${targetOrigin}${targetPath}`,
    method: request.method(),
    status: response.status(),
    transportAccepted: response.ok(),
    businessSuccessVerified: false,
    connectorUsable: false,
    captureMode: 'CONTROLLED_PAGE_RELOAD',
    schemaKeyMode: 'GENERIC_ENVELOPE_PLUS_ORDINAL_PLACEHOLDERS',
    request: requestResult,
    response: responseResult,
    emittedPrimitiveValues: false,
    emittedDynamicObjectKeys: false,
    scriptPersistedRawRequest: false,
    scriptPersistedRawResponse: false,
    fullPayloadsReadOnlyIntoEphemeralProcessMemory: true,
    capturedRequestHeaders: false,
    capturedResponseHeaders: false,
    capturedCookies: false,
    capturedStorage: false,
    capturedInputValues: false,
    capturedPageText: false,
    capturedPageTitle: false,
  },
  null,
  2,
)

process.stdout.write(output, () => process.exit(0))
