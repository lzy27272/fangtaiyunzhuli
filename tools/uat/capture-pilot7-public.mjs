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
  ?? path.join(repoRoot, 'docs', 'uat', 'evidence', 'pilot7-public'))
const expectedTaskId = process.env.PILOT7_TASK_ID ?? '00535677-f39e-4a54-8d21-cc1e4ad0df8c'
const browserExecutable = process.env.UAT_BROWSER_EXECUTABLE
  ?? ['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'].find(existsSync)

if (!browserExecutable || !existsSync(browserExecutable)) throw new Error('Chrome or Edge is required.')
if (!existsSync(accountFile)) throw new Error('Protected Pilot account file is required.')

const accountRows = (await readFile(accountFile, 'utf8')).split(/\r?\n/).filter(Boolean)
  .map((line) => line.split('\t')).filter((parts) => parts.length >= 3)
const accounts = new Map(accountRows.map((parts) => [parts[1], parts[2]]))
for (const loginName of ['ceo.demo', 'assistant.gm', 'front.demo', 'ota.assistant']) {
  if (!accounts.has(loginName)) throw new Error(`Credential missing for ${loginName}`)
}

await mkdir(outputRoot, { recursive: true })
const browser = await chromium.launch({ headless: true, executablePath: browserExecutable })
const checks = []
const failures = []

function record(name, passed, details = {}) {
  checks.push({ name, passed, details })
  if (!passed) failures.push(name)
}

async function login(context, loginName) {
  const page = await context.newPage()
  await page.goto(`${webBase}/#/workbench`, { waitUntil: 'domcontentloaded', timeout: 60_000 })
  await page.locator('.login-card').waitFor({ state: 'visible', timeout: 30_000 })
  await page.locator('input[autocomplete="username"]').fill(loginName)
  await page.locator('input[autocomplete="current-password"]').fill(accounts.get(loginName))
  await page.locator('button.login-submit').click()
  await page.locator('.shell').waitFor({ state: 'visible', timeout: 30_000 })
  await page.locator('.sidebar-footer').filter({ hasText: 'TECH-V0.2-PILOT.7' }).waitFor({ state: 'visible', timeout: 20_000 })
  return page
}

async function screenshot(page, name) {
  const target = path.join(outputRoot, name)
  await page.screenshot({ path: target, fullPage: true })
  return path.basename(target)
}

async function clickMetricAndCheck(page, index, expectedRoute, expectedParams = []) {
  await page.goto(`${webBase}/#/workbench`, { waitUntil: 'domcontentloaded', timeout: 60_000 })
  const metrics = page.locator('.metrics-grid .metric-action')
  await metrics.nth(index).waitFor({ state: 'visible', timeout: 30_000 })
  await metrics.nth(index).click()
  await page.waitForFunction((route) => window.location.hash.includes(route), expectedRoute)
  const hash = await page.evaluate(() => window.location.hash)
  return { hash, passed: hash.includes(expectedRoute) && expectedParams.every((value) => hash.includes(value)) }
}

try {
  {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: 'zh-CN', timezoneId: 'Asia/Shanghai' })
    const page = await login(context, 'assistant.gm')
    const today = await clickMetricAndCheck(page, 0, '#/my-work', ['status=PENDING_WORK'])
    const active = await clickMetricAndCheck(page, 1, '#/tasks', ['view=mine', 'status=ACTIVE'])
    const review = await clickMetricAndCheck(page, 2, '#/tasks', ['view=review'])
    record('workbench_metric_navigation', today.passed && active.passed && review.passed, { today: today.hash, active: active.hash, review: review.hash })
    await page.goto(`${webBase}/#/workbench`, { waitUntil: 'domcontentloaded', timeout: 60_000 })
    await screenshot(page, '01-assistant-workbench-clickable.png')
    await context.close()
  }

  {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: 'zh-CN', timezoneId: 'Asia/Shanghai' })
    const page = await login(context, 'ceo.demo')
    await page.goto(`${webBase}/#/hotel-dashboard`, { waitUntil: 'domcontentloaded', timeout: 60_000 })
    await page.locator('main h1').waitFor({ state: 'visible', timeout: 30_000 })
    await page.locator('.p0-dashboard-metrics').waitFor({ state: 'visible', timeout: 30_000 })
    const hotelSelect = page.locator('.dashboard-hotel-select select')
    const hotelOptionCount = await hotelSelect.count() ? await hotelSelect.locator('option').count() : 1
    const dashboardTitle = await page.locator('main h1').innerText()
    record('ceo_hotel_dashboard_access', hotelOptionCount >= 1 && dashboardTitle.length > 0, { hotelOptionCount, dashboardTitle })
    await screenshot(page, '02-ceo-hotel-dashboard.png')

    const dashboardMetrics = page.locator('.p0-dashboard-metrics .metric-action')
    const metricCount = await dashboardMetrics.count()
    await dashboardMetrics.nth(metricCount - 1).click()
    await page.waitForFunction(() => window.location.hash.includes('#/tasks'))
    const taskMetricHash = await page.evaluate(() => window.location.hash)
    record('hotel_dashboard_task_navigation', taskMetricHash.includes('view=team') && taskMetricHash.includes('hotelId='), { hash: taskMetricHash })

    await page.goto(`${webBase}/#/hotel-dashboard`, { waitUntil: 'domcontentloaded', timeout: 60_000 })
    await page.locator('.p0-dashboard-metrics').waitFor({ state: 'visible', timeout: 30_000 })
    const risks = page.locator('.risk-row')
    const riskCount = await risks.count()
    let riskHash = null
    if (riskCount > 0) {
      await risks.first().click()
      await page.waitForTimeout(500)
      riskHash = await page.evaluate(() => window.location.hash)
    }
    record('hotel_dashboard_risk_navigation', riskCount === 0 || Boolean(riskHash && riskHash !== '#/hotel-dashboard'), { riskCount, hash: riskHash })

    await page.goto(`${webBase}/#/tasks?view=team`, { waitUntil: 'domcontentloaded', timeout: 60_000 })
    await page.locator('main h1').waitFor({ state: 'visible', timeout: 30_000 })
    await page.locator('.page-title button.primary').click()
    await page.locator('.modal').waitFor({ state: 'visible', timeout: 30_000 })
    await page.locator('.modal .form-grid select').first().waitFor({ state: 'visible', timeout: 30_000 })
    const selects = page.locator('.modal .form-grid select')
    const hotelOptions = await selects.nth(1).locator('option').count()
    if (hotelOptions > 1) await selects.nth(1).selectOption({ index: 1 })
    const assigneeOptions = await selects.nth(2).locator('option').count()
    record('ceo_task_target_dialog', hotelOptions > 1 && assigneeOptions > 1, { hotelOptions: hotelOptions - 1, assigneeOptions: assigneeOptions - 1 })
    await screenshot(page, '03-ceo-task-target-dialog.png')
    await context.close()
  }

  {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: 'zh-CN', timezoneId: 'Asia/Shanghai' })
    const page = await login(context, 'front.demo')
    await page.goto(`${webBase}/#/tasks?view=mine&status=COMPLETED&taskId=${expectedTaskId}`, { waitUntil: 'domcontentloaded', timeout: 60_000 })
    await page.locator('main h1').waitFor({ state: 'visible', timeout: 30_000 })
    await page.waitForTimeout(1000)
    const bodyText = await page.locator('body').innerText()
    const drawerVisible = await page.locator('.drawer').count() > 0
    const drawerText = drawerVisible ? await page.locator('.drawer').innerText() : ''
    const namesResolved = !drawerText.includes('待解析')
    const taskVisible = bodyText.includes('PILOT7-LIVE-SMOKE') && drawerVisible && namesResolved
    record('front_recipient_task_visible', taskVisible, { expectedTaskId, detailDrawerVisible: drawerVisible, participantNamesResolved: namesResolved })
    await screenshot(page, '04-front-received-task.png')

    await page.goto(`${webBase}/#/notifications`, { waitUntil: 'domcontentloaded', timeout: 60_000 })
    await page.locator('main h1').waitFor({ state: 'visible', timeout: 30_000 })
    await page.waitForTimeout(800)
    const notificationText = await page.locator('body').innerText()
    record('front_recipient_notification_visible', notificationText.includes('PILOT7-LIVE-SMOKE'), {})
    await screenshot(page, '05-front-received-notification.png')
    await context.close()
  }

  {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: 'zh-CN', timezoneId: 'Asia/Shanghai' })
    const page = await login(context, 'ota.assistant')
    await page.goto(`${webBase}/#/tasks?view=team`, { waitUntil: 'domcontentloaded', timeout: 60_000 })
    await page.locator('.page-title button.primary').waitFor({ state: 'visible', timeout: 30_000 })
    await page.locator('.page-title button.primary').click()
    await page.locator('.modal').waitFor({ state: 'visible', timeout: 30_000 })
    await page.locator('.modal .form-grid select').first().waitFor({ state: 'visible', timeout: 30_000 })
    const selects = page.locator('.modal .form-grid select')
    const hotelOptions = await selects.nth(1).locator('option').count()
    let totalTargets = 0
    const visibleTargetTexts = []
    for (let index = 1; index < hotelOptions; index += 1) {
      await selects.nth(1).selectOption({ index })
      const options = selects.nth(2).locator('option')
      const count = await options.count()
      totalTargets += Math.max(0, count - 1)
      for (let optionIndex = 1; optionIndex < count; optionIndex += 1) visibleTargetTexts.push(await options.nth(optionIndex).innerText())
    }
    const managementOnly = visibleTargetTexts.every((value) => /主管|店助|店总|经理/.test(value))
    record('ota_management_target_dialog', hotelOptions > 1 && totalTargets > 0 && managementOnly,
      { hotelOptions: hotelOptions - 1, totalTargets, managementOnly })
    await screenshot(page, '06-ota-management-target-dialog.png')
    await context.close()
  }
} catch (error) {
  record('browser_execution', false, { error: error instanceof Error ? error.message : String(error) })
} finally {
  await browser.close()
}

const report = {
  generatedAt: new Date().toISOString(), version: 'TECH-V0.2-PILOT.7', webBase,
  passed: failures.length === 0, summary: { passed: checks.filter((item) => item.passed).length, total: checks.length, failed: failures.length },
  checks, credentialsPersistedInEvidence: false,
}
await writeFile(path.join(outputRoot, 'pilot7-public-browser-uat.json'), JSON.stringify(report, null, 2), 'utf8')
console.log(JSON.stringify({ version: report.version, passed: report.passed, summary: report.summary, outputRoot }))
if (!report.passed) process.exit(1)
