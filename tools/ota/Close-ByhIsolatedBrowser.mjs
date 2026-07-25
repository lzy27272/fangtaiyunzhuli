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
await browser.close()

process.stdout.write(
  JSON.stringify({
    closed: true,
    capturedRequestHeaders: false,
    capturedRequestBodies: false,
    capturedResponseBodies: false,
    capturedCookies: false,
    capturedStorage: false,
    capturedInputValues: false,
    capturedPageText: false,
  }),
)
