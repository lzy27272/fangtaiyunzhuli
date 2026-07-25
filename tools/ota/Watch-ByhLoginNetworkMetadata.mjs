import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const playwrightModule = process.env.UAT_PLAYWRIGHT_MODULE
const cdpEndpoint = process.env.BYH_CDP_ENDPOINT
const watchSeconds = Number(process.env.BYH_WATCH_SECONDS ?? '180')

if (!playwrightModule) {
  throw new Error('UAT_PLAYWRIGHT_MODULE is required')
}
if (!cdpEndpoint || !/^http:\/\/127\.0\.0\.1:\d+$/.test(cdpEndpoint)) {
  throw new Error('BYH_CDP_ENDPOINT must be a loopback HTTP endpoint')
}
if (!Number.isFinite(watchSeconds) || watchSeconds < 15 || watchSeconds > 300) {
  throw new Error('BYH_WATCH_SECONDS must be between 15 and 300')
}

const { chromium } = require(playwrightModule)
const browser = await chromium.connectOverCDP(cdpEndpoint)
const allowedHost = 'pms.meituan.com'
const allowedTypes = new Set(['document', 'fetch', 'xhr'])
const events = []
const startedAt = Date.now()

const sanitizeUrl = (rawUrl) => {
  try {
    const url = new URL(rawUrl)
    if (url.hostname !== allowedHost) {
      return null
    }
    const segments = url.pathname.split('/').map((segment) => {
      if (!segment) return ''
      if (/^v\d+$/i.test(segment)) return segment
      if (/^[A-Za-z][A-Za-z_-]{0,31}$/.test(segment)) return segment
      if (/^[A-Za-z][A-Za-z_-]{0,24}\.(?:js|json|html|css)$/i.test(segment)) {
        return segment
      }
      return ':redacted'
    })
    return `${url.origin}${segments.join('/')}`
  } catch {
    return null
  }
}

const classifyFailure = (failureText) => {
  if (!failureText) return 'UNKNOWN'
  if (failureText.includes('TIMED_OUT')) return 'TIMEOUT'
  if (failureText.includes('NAME_NOT_RESOLVED')) return 'DNS'
  if (failureText.includes('CONNECTION')) return 'CONNECTION'
  if (failureText.includes('CERT')) return 'TLS'
  if (failureText.includes('ABORTED')) return 'ABORTED'
  return 'NETWORK_OTHER'
}

const attachPage = (page) => {
  page.on('response', (response) => {
    const request = response.request()
    const resourceType = request.resourceType()
    const path = sanitizeUrl(response.url())
    if (!path || !allowedTypes.has(resourceType)) return

    events.push({
      elapsedMs: Date.now() - startedAt,
      kind: 'response',
      path,
      method: request.method(),
      resourceType,
      status: response.status(),
    })
  })

  page.on('requestfailed', (request) => {
    const resourceType = request.resourceType()
    const path = sanitizeUrl(request.url())
    if (!path || !allowedTypes.has(resourceType)) return

    events.push({
      elapsedMs: Date.now() - startedAt,
      kind: 'requestfailed',
      path,
      method: request.method(),
      resourceType,
      failureClass: classifyFailure(request.failure()?.errorText),
    })
  })
}

let matchingPages = 0
for (const context of browser.contexts()) {
  for (const page of context.pages()) {
    try {
      if (new URL(page.url()).hostname !== allowedHost) continue
    } catch {
      continue
    }
    matchingPages += 1
    attachPage(page)
  }
  context.on('page', attachPage)
}

if (matchingPages === 0) {
  throw new Error('No matching PMS page found in the isolated browser')
}

await new Promise((resolve) => setTimeout(resolve, watchSeconds * 1000))

process.stdout.write(
  JSON.stringify(
    {
      connected: true,
      matchingPages,
      watchSeconds,
      events: events.slice(-200),
      capturedRequestHeaders: false,
      capturedRequestBodies: false,
      capturedResponseHeaders: false,
      capturedResponseBodies: false,
      capturedCookies: false,
      capturedStorage: false,
      capturedInputValues: false,
      capturedPageText: false,
      capturedPageTitle: false,
    },
    null,
    2,
  ),
)

process.exit(0)
