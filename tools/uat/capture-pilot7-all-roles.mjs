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
const outputRoot = path.join(repoRoot, 'docs', 'uat', 'evidence', 'pilot7-all-roles')
const browserExecutable = process.env.UAT_BROWSER_EXECUTABLE
  ?? ['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'].find(existsSync)

if (!browserExecutable || !existsSync(browserExecutable) || !existsSync(accountFile)) throw new Error('Browser and protected account file are required.')
const rows = (await readFile(accountFile, 'utf8')).split(/\r?\n/).filter(Boolean).map((line) => line.split('\t')).filter((parts) => parts.length >= 3)
const accounts = new Map(rows.map((parts) => [parts[1], parts[2]]))
const roles = [
  { login: 'front.demo', slug: 'front-desk', canCreate: false, home: 'workbench' },
  { login: 'fo.supervisor', slug: 'front-office-supervisor', canCreate: true, home: 'workbench' },
  { login: 'hk.supervisor', slug: 'housekeeping-supervisor', canCreate: true, home: 'workbench' },
  { login: 'assistant.gm', slug: 'assistant-general-manager', canCreate: true, home: 'hotel-dashboard' },
  { login: 'gm.hz', slug: 'general-manager', canCreate: true, home: 'hotel-dashboard' },
  { login: 'ota.assistant', slug: 'ota-assistant', canCreate: true, home: 'tasks?view=team' },
  { login: 'ota.manager', slug: 'ota-manager', canCreate: true, home: 'operations-dashboard' },
  { login: 'ceo.demo', slug: 'ceo', canCreate: true, home: 'hotel-dashboard' },
]
for (const role of roles) if (!accounts.has(role.login)) throw new Error(`Credential missing for ${role.login}`)

await mkdir(outputRoot, { recursive: true })
const browser = await chromium.launch({ headless: true, executablePath: browserExecutable })
const results = []
try {
  for (const role of roles) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: 'zh-CN', timezoneId: 'Asia/Shanghai' })
    const page = await context.newPage()
    const apiFailures = []
    page.on('response', (response) => {
      if (response.url().includes('/api/') && response.status() >= 400) apiFailures.push({ status: response.status(), path: new URL(response.url()).pathname })
    })
    try {
      await page.goto(`${webBase}/#/workbench`, { waitUntil: 'domcontentloaded', timeout: 60_000 })
      await page.locator('.login-card').waitFor({ state: 'visible', timeout: 30_000 })
      await page.locator('input[autocomplete="username"]').fill(role.login)
      await page.locator('input[autocomplete="current-password"]').fill(accounts.get(role.login))
      await page.locator('button.login-submit').click()
      await page.locator('.shell').waitFor({ state: 'visible', timeout: 30_000 })
      await page.locator('.sidebar-footer').filter({ hasText: 'TECH-V0.2-PILOT.7' }).waitFor({ state: 'visible', timeout: 20_000 })

      await page.goto(`${webBase}/#/${role.home}`, { waitUntil: 'domcontentloaded', timeout: 60_000 })
      await page.locator('main h1').waitFor({ state: 'visible', timeout: 30_000 })
      await page.waitForTimeout(800)
      const homeTitle = await page.locator('main h1').innerText()
      await page.screenshot({ path: path.join(outputRoot, `${role.slug}-home.png`), fullPage: true })

      await page.goto(`${webBase}/#/tasks?view=${role.login === 'ceo.demo' ? 'team' : 'mine'}`, { waitUntil: 'domcontentloaded', timeout: 60_000 })
      await page.locator('main h1').waitFor({ state: 'visible', timeout: 30_000 })
      await page.waitForTimeout(800)
      const createButtonVisible = await page.locator('.page-title button.primary').count() > 0
      const permissionMatch = createButtonVisible === role.canCreate
      await page.screenshot({ path: path.join(outputRoot, `${role.slug}-tasks.png`), fullPage: true })
      results.push({ login: role.login, home: role.home, homeTitle, expectedCanCreate: role.canCreate,
        createButtonVisible, permissionMatch, apiFailures, passed: permissionMatch && apiFailures.length === 0 })
    } catch (error) {
      results.push({ login: role.login, expectedCanCreate: role.canCreate, apiFailures,
        error: error instanceof Error ? error.message : String(error), passed: false })
    } finally { await context.close() }
  }
} finally { await browser.close() }

const passed = results.length === roles.length && results.every((result) => result.passed)
const report = { generatedAt: new Date().toISOString(), version: 'TECH-V0.2-PILOT.7', webBase, passed,
  summary: { passed: results.filter((result) => result.passed).length, total: results.length, failed: results.filter((result) => !result.passed).length },
  results, credentialsPersistedInEvidence: false }
await writeFile(path.join(outputRoot, 'pilot7-all-roles.json'), JSON.stringify(report, null, 2), 'utf8')
console.log(JSON.stringify({ version: report.version, passed: report.passed, summary: report.summary, outputRoot }))
if (!passed) process.exit(1)
