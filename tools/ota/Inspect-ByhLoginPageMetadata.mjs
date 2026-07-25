import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const playwrightModule = process.env.UAT_PLAYWRIGHT_MODULE
const cdpEndpoint = process.env.BYH_CDP_ENDPOINT

if (!playwrightModule) {
  throw new Error('UAT_PLAYWRIGHT_MODULE is required')
}
if (!cdpEndpoint || !/^http:\/\/127\.0\.0\.1:\d+$/.test(cdpEndpoint)) {
  throw new Error('BYH_CDP_ENDPOINT must be a loopback HTTP endpoint')
}

const { chromium } = require(playwrightModule)
const browser = await chromium.connectOverCDP(cdpEndpoint)
const pageResults = []

const sanitizeUrl = (rawUrl) => {
  try {
    const url = new URL(rawUrl)
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
    return 'INVALID_URL'
  }
}

for (const context of browser.contexts()) {
  for (const page of context.pages()) {
    let parsed
    try {
      parsed = new URL(page.url())
    } catch {
      continue
    }
    if (parsed.hostname !== 'pms.meituan.com') {
      continue
    }

    const result = await page.evaluate(() => {
      return performance
        .getEntriesByType('resource')
        .filter((entry) => {
          try {
            return new URL(entry.name, window.location.href).origin === window.location.origin
          } catch {
            return false
          }
        })
        .filter((entry) => ['fetch', 'xmlhttprequest'].includes(entry.initiatorType))
        .slice(-80)
        .map((entry) => ({
          rawUrl: entry.name,
          initiatorType: entry.initiatorType,
          responseStatus: Number.isFinite(entry.responseStatus) ? entry.responseStatus : null,
          durationMs: Math.round(entry.duration),
          transferSize: Number.isFinite(entry.transferSize) ? entry.transferSize : null,
        }))
    })
    pageResults.push({
      pagePath: sanitizeUrl(page.url()),
      resources: result.map(({ rawUrl, ...entry }) => ({
        path: sanitizeUrl(rawUrl),
        ...entry,
      })),
    })
  }
}

process.stdout.write(
  JSON.stringify(
    {
      connected: true,
      matchingPages: pageResults.length,
      pages: pageResults,
      capturedRequestHeaders: false,
      capturedRequestBodies: false,
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
