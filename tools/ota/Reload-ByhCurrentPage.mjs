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
  throw new Error('No selected-hotel PMS page found in the isolated browser')
}

await page.reload({ waitUntil: 'domcontentloaded', timeout: 30_000 })

process.stdout.write(
  JSON.stringify({
    reloaded: true,
    pagePath: 'https://pms.meituan.com/',
    submittedForms: false,
    capturedRequestHeaders: false,
    capturedRequestBodies: false,
    capturedResponseBodies: false,
    capturedCookies: false,
    capturedStorage: false,
    capturedInputValues: false,
    capturedPageText: false,
  }),
  () => process.exit(0),
)
