import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const playwrightModule = process.env.UAT_PLAYWRIGHT_MODULE
const cdpEndpoint = process.env.BYH_CDP_ENDPOINT
const targetEndpoint =
  'https://pms.meituan.com/hotelpms/api/v1/report/lion/manager/workbench/room'
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

const { chromium } = require(playwrightModule)
const browser = await chromium.connectOverCDP(cdpEndpoint)
const pages = browser.contexts().flatMap((context) => context.pages())
const page = pages.find((candidate) => {
  try {
    const url = new URL(candidate.url())
    return url.origin === 'https://pms.meituan.com' && url.pathname === '/'
  } catch {
    return false
  }
})

if (!page) {
  throw new Error('No selected-hotel PMS workbench found in the isolated browser')
}

const result = await page.evaluate(async ({ endpoint, allowedEnvelopeKeys }) => {
  const maxPaths = 400
  const maxDepth = 8
  const maxResponseBytes = 512 * 1024
  const paths = new Map()
  const anonymousKeys = new Map()
  let truncated = false

  const safeKey = (key) => {
    if (allowedEnvelopeKeys.includes(key)) return key
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
      for (const item of value.slice(0, 3)) {
        walk(item, `${path}[]`, depth + 1)
      }
      return
    }
    if (typeof value === 'object') {
      if (!addType(path, 'object')) return
      for (const [key, child] of Object.entries(value).slice(0, 100)) {
        walk(child, `${path}.${safeKey(key)}`, depth + 1)
      }
      return
    }
    addType(path, typeof value)
  }

  const abortController = new AbortController()
  const timeout = setTimeout(() => abortController.abort(), 10_000)
  let response
  try {
    response = await fetch(endpoint, {
      method: 'GET',
      credentials: 'same-origin',
      cache: 'no-store',
      redirect: 'error',
      signal: abortController.signal,
    })
  } catch {
    clearTimeout(timeout)
    return {
      requestCompleted: false,
      failureClass: abortController.signal.aborted
        ? 'TIMEOUT'
        : 'NETWORK_REDIRECT_OR_BROWSER_REJECTION',
      schema: [],
    }
  }

  if (!response.ok || response.url !== endpoint) {
    clearTimeout(timeout)
    await response.body?.cancel()
    return {
      requestCompleted: true,
      status: response.status,
      endpointMatched: response.url === endpoint,
      transportAndJsonAccepted: false,
      schema: [],
    }
  }

  let rawPayload = ''
  try {
    if (!response.body) {
      throw new Error('EMPTY_RESPONSE_BODY')
    }
    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let receivedBytes = 0

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      receivedBytes += value.byteLength
      if (receivedBytes > maxResponseBytes) {
        await reader.cancel()
        clearTimeout(timeout)
        return {
          requestCompleted: true,
          status: response.status,
          endpointMatched: true,
          transportAndJsonAccepted: false,
          failureClass: 'RESPONSE_SIZE_LIMIT_EXCEEDED',
          schema: [],
        }
      }
      rawPayload += decoder.decode(value, { stream: true })
    }
    rawPayload += decoder.decode()
  } catch {
    clearTimeout(timeout)
    return {
      requestCompleted: true,
      status: response.status,
      endpointMatched: true,
      transportAndJsonAccepted: false,
      failureClass: abortController.signal.aborted ? 'TIMEOUT' : 'BODY_READ_FAILED',
      schema: [],
    }
  }
  clearTimeout(timeout)

  let payload
  try {
    payload = JSON.parse(rawPayload)
  } catch {
    rawPayload = ''
    return {
      requestCompleted: true,
      status: response.status,
      endpointMatched: true,
      transportAndJsonAccepted: false,
      responseFormat: 'NON_JSON_OR_EMPTY',
      schema: [],
    }
  }
  rawPayload = ''
  walk(payload, '$', 0)

  return {
    requestCompleted: true,
    status: response.status,
    endpointMatched: true,
    transportAndJsonAccepted: true,
    businessSuccessVerified: false,
    connectorUsable: false,
    responseFormat: 'JSON',
    schemaKeyMode: 'GENERIC_ENVELOPE_PLUS_ORDINAL_PLACEHOLDERS',
    schema: [...paths.entries()].map(([path, types]) => ({
      path,
      types: [...types].sort(),
    })),
    truncated,
  }
}, { endpoint: targetEndpoint, allowedEnvelopeKeys: [...genericEnvelopeKeys] })

process.stdout.write(
  JSON.stringify(
    {
      endpoint:
        'https://pms.meituan.com/hotelpms/api/v1/report/lion/manager/workbench/room',
      method: 'GET',
      ...result,
      capturedRequestHeaders: false,
      capturedRequestBodies: false,
      emittedResponseValues: false,
      persistedRawResponse: false,
      responseValuesProcessedOnlyInEphemeralBrowserMemory: true,
      capturedCookies: false,
      capturedStorage: false,
      capturedInputValues: false,
      capturedPageText: false,
      capturedPageTitle: false,
    },
    null,
    2,
  ),
  () => process.exit(0),
)
