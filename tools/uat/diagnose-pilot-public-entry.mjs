import { existsSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'
import process from 'node:process'

const require = createRequire(import.meta.url)
const { chromium } = require('playwright')
const target = process.env.PILOT_WEB_BASE ?? 'https://www.sfgzt.cn'
const outputRoot = path.resolve(process.env.UAT_EVIDENCE_ROOT ?? '.uat-runtime/pilot-public-entry-diagnostic')
const browserExecutable = process.env.UAT_BROWSER_EXECUTABLE
  ?? ['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'].find(existsSync)

if (!browserExecutable) throw new Error('Chrome or Edge is required.')
await mkdir(outputRoot, { recursive: true })

const events = []
const browser = await chromium.launch({ headless: true, executablePath: browserExecutable })
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: 'zh-CN' })
const page = await context.newPage()

page.on('console', (message) => events.push({ type: 'console', level: message.type(), text: message.text().slice(0, 1000) }))
page.on('pageerror', (error) => events.push({ type: 'pageerror', text: String(error).slice(0, 2000) }))
page.on('requestfailed', (request) => events.push({
  type: 'requestfailed',
  method: request.method(),
  resourceType: request.resourceType(),
  url: request.url().split('?')[0],
  failure: request.failure()?.errorText ?? 'unknown',
}))
page.on('response', (response) => {
  const type = response.request().resourceType()
  if (['document', 'script', 'stylesheet', 'fetch', 'xhr'].includes(type)) {
    events.push({ type: 'response', resourceType: type, status: response.status(), url: response.url().split('?')[0] })
  }
})

let navigationError
try {
  await page.goto(`${target.replace(/\/$/, '')}/#/login`, { waitUntil: 'domcontentloaded', timeout: 60_000 })
  await page.waitForTimeout(45_000)
} catch (error) {
  navigationError = String(error).slice(0, 2000)
}

const report = {
  target,
  capturedAt: new Date().toISOString(),
  navigationError,
  url: page.url().split('?')[0],
  title: await page.title().catch(() => ''),
  loginCardCount: await page.locator('.login-card').count().catch(() => -1),
  rootHtmlLength: await page.locator('#root').evaluate((element) => element.innerHTML.length).catch(() => -1),
  rootText: (await page.locator('#root').innerText().catch(() => '')).slice(0, 1000),
  events,
}

await page.screenshot({ path: path.join(outputRoot, 'public-entry.png'), fullPage: true }).catch(() => undefined)
await writeFile(path.join(outputRoot, 'public-entry.json'), JSON.stringify(report, null, 2), 'utf8')
await context.close()
await browser.close()
console.log(JSON.stringify({ outputRoot, loginCardCount: report.loginCardCount, rootHtmlLength: report.rootHtmlLength, eventCount: events.length }))
