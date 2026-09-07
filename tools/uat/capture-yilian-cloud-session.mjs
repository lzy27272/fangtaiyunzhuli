#!/usr/bin/env node

import { createRequire } from 'node:module'
import {
  lstatSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs'
import { dirname } from 'node:path'
import { encryptCookie } from './report-source-cookie-crypto.mjs'
import { validateYilianAccessToken } from './yilian-cloud-collector.mjs'

const hotelCode = String(process.env.YILIAN_CAPTURE_HOTEL_CODE ?? '')
  .trim()
  .toUpperCase()
const cdpEndpoint = new URL(
  process.env.YILIAN_CAPTURE_CDP_ENDPOINT ?? 'http://127.0.0.1:9226',
)
const hotelsPath = process.env.OTA_REVIEW_DATA_PATH
  ? `${dirname(process.env.OTA_REVIEW_DATA_PATH)}/simulation-hotels.json`
  : ''
const sourcesPath = process.env.OTA_REVIEW_DATA_PATH ?? ''
const secretsPath = process.env.OTA_REVIEW_COOKIE_SECRETS_PATH ?? ''
const secretKey = process.env.OTA_REVIEW_SECRET_KEY ?? ''
const playwrightModule = process.env.UAT_PLAYWRIGHT_MODULE
  || process.env.BIEYANGHONG_PLAYWRIGHT_MODULE

if (
  !/^\d{3}$/u.test(hotelCode)
  || cdpEndpoint.protocol !== 'http:'
  || cdpEndpoint.hostname !== '127.0.0.1'
  || cdpEndpoint.username
  || cdpEndpoint.password
  || cdpEndpoint.pathname !== '/'
  || cdpEndpoint.search
  || cdpEndpoint.hash
  || !/^92\d{2}$/u.test(cdpEndpoint.port)
  || !hotelsPath
  || !sourcesPath
  || !secretsPath
  || !secretKey
  || !playwrightModule
) throw new Error('YILIAN_CAPTURE_CONFIGURATION_INVALID')

const hotels = JSON.parse(readFileSync(hotelsPath, 'utf8'))
const matches = hotels.filter((hotel) => hotel.hotelCode === hotelCode)
if (matches.length !== 1) throw new Error('YILIAN_CAPTURE_HOTEL_SCOPE_INVALID')
const hotel = matches[0]
const legacyYilian = hotel.pmsSystemCode === 'OTHER'
  && /^(?:驿联云(?:\s*PMS)?|YILIAN(?:\s*CLOUD)?(?:\s*PMS)?)$/iu.test(
    String(hotel.pmsSystemName ?? '').trim(),
  )
if (hotel.pmsSystemCode !== 'YILIAN_CLOUD' && !legacyYilian) {
  throw new Error('YILIAN_CAPTURE_PMS_SCOPE_INVALID')
}

const allSources = JSON.parse(readFileSync(sourcesPath, 'utf8'))
const sources = (allSources[hotel.hotelId] ?? []).filter((source) => source.enabled)
if (sources.length !== 3) throw new Error('YILIAN_SOURCE_CONTRACT_INVALID')

const require = createRequire(import.meta.url)
const { chromium } = require(playwrightModule)
const browser = await chromium.connectOverCDP(cdpEndpoint.toString())
const context = browser.contexts()[0]
if (!context) throw new Error('YILIAN_CAPTURE_BROWSER_CONTEXT_MISSING')
const page = context.pages().find((candidate) => {
  try {
    const url = new URL(candidate.url())
    return url.protocol === 'https:'
      && url.hostname === 'pms.ygjpms.com'
      && (
        url.pathname.startsWith('/saas/')
        || url.pathname.startsWith('/login/pms/')
      )
  } catch {
    return false
  }
})
if (!page) throw new Error('YILIAN_CAPTURE_PAGE_MISSING')
const accessToken = await page.evaluate(() => sessionStorage.getItem('token') ?? '')

const validation = await validateYilianAccessToken({ sources, accessToken })
if (
  validation.sourceCount !== 3
  || validation.successfulSourceCount !== 3
) throw new Error('YILIAN_CAPTURE_VALIDATION_FAILED')

let store = {}
let secretsMode = 0o600
try {
  const stats = lstatSync(secretsPath)
  if (!stats.isFile() || stats.isSymbolicLink()) {
    throw new Error('YILIAN_SECRET_STORE_PATH_UNSAFE')
  }
  secretsMode = stats.mode & 0o777
  const parsed = JSON.parse(readFileSync(secretsPath, 'utf8'))
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('YILIAN_SECRET_STORE_INVALID')
  }
  store = parsed
} catch (error) {
  if (error?.code !== 'ENOENT') throw error
}
const nextForHotel = { ...(store[hotel.hotelId] ?? {}) }
for (const source of sources) {
  nextForHotel[source.sourceId] = encryptCookie(
    accessToken,
    secretKey,
    `${hotel.hotelId}:${source.sourceId}`,
  )
}
const nextStore = { ...store, [hotel.hotelId]: nextForHotel }
const temporaryPath = `${secretsPath}.${process.pid}.tmp`
writeFileSync(
  temporaryPath,
  `${JSON.stringify(nextStore, null, 2)}\n`,
  { encoding: 'utf8', mode: secretsMode },
)
renameSync(temporaryPath, secretsPath)

await new Promise((resolve) => {
  process.stdout.write(`${JSON.stringify({
    state: 'YILIAN_SESSION_CAPTURED_AND_ENCRYPTED',
    hotelCode,
    sourceCount: validation.sourceCount,
    successfulSourceCount: validation.successfulSourceCount,
    businessDate: validation.businessDate,
    outboundDeliveryAttempted: false,
  })}\n`, resolve)
})
process.exit(0)
