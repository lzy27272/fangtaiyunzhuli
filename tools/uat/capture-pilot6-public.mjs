import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const { chromium } = require(process.env.UAT_PLAYWRIGHT_MODULE ?? 'playwright')
const toolRoot = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(toolRoot, '..', '..')
const webBase = (process.env.PILOT_WEB_BASE ?? 'https://www.sfgzt.cn').replace(/\/$/, '')
const accountFile = process.env.PILOT_ACCOUNT_FILE ?? 'D:\\SifangguanHotelAIOS\\Pilot-Account-Access.txt'
const outputRoot = path.resolve(process.env.UAT_SCREENSHOT_DIR
  ?? path.join(repoRoot, 'docs', 'uat', 'evidence', 'pilot6-public'))
const browserExecutable = process.env.UAT_BROWSER_EXECUTABLE
  ?? ['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'].find(existsSync)

if (!browserExecutable || !existsSync(browserExecutable)) throw new Error('Chrome or Edge is required.')
if (!existsSync(accountFile)) throw new Error('Protected Pilot application account file is required.')

const accountRows = (await readFile(accountFile, 'utf8')).split(/\r?\n/).filter(Boolean)
  .map((line) => line.split('\t')).filter((parts) => parts.length >= 3)
const accounts = new Map(accountRows.map((parts) => [parts[1], parts[2]]))

const roles = [
  { login: 'front.demo', slug: 'front-desk', view: 'my-work' },
  { login: 'fo.supervisor', slug: 'front-office-supervisor', view: 'team-work' },
  { login: 'hk.supervisor', slug: 'housekeeping-supervisor', view: 'my-work' },
  { login: 'assistant.gm', slug: 'assistant-general-manager', view: 'hotel-dashboard' },
  { login: 'gm.hz', slug: 'general-manager', view: 'tasks' },
  { login: 'ota.assistant', slug: 'ota-assistant', view: 'my-work' },
  { login: 'ota.manager', slug: 'ota-manager', view: 'operations-dashboard' },
  { login: 'ceo.demo', slug: 'ceo', view: 'templates' },
]
for (const role of roles) if (!accounts.has(role.login)) throw new Error(`Credential missing for ${role.login}`)

await mkdir(outputRoot, { recursive: true })
const browser = await chromium.launch({ headless: true, executablePath: browserExecutable })
const results = []
const isKnownCloudflareTelemetryBlock = (value) => value.includes('static.cloudflareinsights.com/beacon.min.js')

async function login(page, loginName) {
  await page.goto(`${webBase}/#/workbench`, { waitUntil: 'domcontentloaded', timeout: 60_000 })
  await page.locator('.login-card').waitFor({ state: 'visible', timeout: 30_000 })
  await page.locator('input[autocomplete="username"]').fill(loginName)
  await page.locator('input[autocomplete="current-password"]').fill(accounts.get(loginName))
  await page.locator('button.login-submit').click()
  await page.locator('.connection').filter({ hasText: '服务端权限已解析' }).waitFor({ state: 'visible', timeout: 30_000 })
  await page.locator('.sidebar-footer').filter({ hasText: 'TECH-V0.2-PILOT.6' }).waitFor({ state: 'visible', timeout: 20_000 })
}

try {
  for (const role of roles) {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
      locale: 'zh-CN',
      timezoneId: 'Asia/Shanghai',
      ignoreHTTPSErrors: false,
    })
    const page = await context.newPage()
    const consoleErrors = []
    const httpFailures = []
    const requestFailures = []
    page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()) })
    page.on('response', (response) => {
      if (response.status() >= 400) httpFailures.push({ status: response.status(), url: response.url() })
    })
    page.on('requestfailed', (request) => {
      requestFailures.push({ url: request.url(), error: request.failure()?.errorText ?? 'unknown' })
    })
    try {
      await login(page, role.login)
      await page.goto(`${webBase}/#/${role.view}`, { waitUntil: 'domcontentloaded', timeout: 60_000 })
      await page.locator('main h1').first().waitFor({ state: 'visible', timeout: 30_000 })
      await page.waitForTimeout(1200)
      const screenshot = path.join(outputRoot, `role-${role.slug}.png`)
      await page.screenshot({ path: screenshot, fullPage: true })
      results.push({ login: role.login, view: role.view, title: await page.locator('main h1').first().innerText(),
        screenshot: path.basename(screenshot), consoleErrors, httpFailures, requestFailures })

      if (role.login === 'ceo.demo') {
        const taskTab = page.locator('.template-tabs button').filter({ hasText: '任务模板' })
        await taskTab.click()
        await page.waitForTimeout(800)
        await page.screenshot({ path: path.join(outputRoot, 'ceo-task-templates.png'), fullPage: true })
        const dashboardTab = page.locator('.template-tabs button').filter({ hasText: '门店驾驶舱模板' })
        await dashboardTab.click()
        await page.waitForTimeout(800)
        await page.screenshot({ path: path.join(outputRoot, 'ceo-dashboard-templates.png'), fullPage: true })
        const workTab = page.locator('.template-tabs button').filter({ hasText: '岗位标准工作' })
        await workTab.click()
        await page.waitForTimeout(800)
        await page.screenshot({ path: path.join(outputRoot, 'ceo-standard-work-templates.png'), fullPage: true })
      }
    } catch (error) {
      results.push({ login: role.login, view: role.view, error: error instanceof Error ? error.message : String(error),
        consoleErrors, httpFailures, requestFailures })
    } finally {
      await context.close()
    }
  }
} finally {
  await browser.close()
}

const passed = results.length === roles.length
  && results.every((item) => !item.error
    && item.httpFailures.length === 0
    && item.requestFailures.every((failure) => failure.error === 'csp' && isKnownCloudflareTelemetryBlock(failure.url))
    && item.consoleErrors.every((message) => isKnownCloudflareTelemetryBlock(message)))
const report = { generatedAt: new Date().toISOString(), version: 'TECH-V0.2-PILOT.6', webBase, passed, results,
  credentialsPersistedInEvidence: false }
await writeFile(path.join(outputRoot, 'pilot6-public-browser-uat.json'), JSON.stringify(report, null, 2), 'utf8')
console.log(JSON.stringify({ version: report.version, rolesPassed: results.filter((item) => !item.error).length,
  rolesTotal: roles.length, passed, outputRoot }))
if (!passed) process.exit(1)
