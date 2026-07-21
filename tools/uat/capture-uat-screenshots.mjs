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
const webBase = (process.env.UAT_WEB_BASE ?? 'http://127.0.0.1:5173').replace(/\/$/, '')
const runId = process.env.UAT_RUN_ID ?? new Date().toISOString().replaceAll(/[-:]/g, '').slice(0, 15)
const outputRoot = path.resolve(process.env.UAT_SCREENSHOT_DIR ?? path.join(repoRoot, 'docs', 'uat', 'evidence', runId, 'screenshots'))
const tokenFile = path.resolve(process.env.UAT_TOKEN_FILE ?? path.join(repoRoot, '.uat-runtime', 'identity', 'tokens.json'))
const browserExecutable = process.env.UAT_BROWSER_EXECUTABLE
  ?? ['C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', 'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'].find(existsSync)

if (!browserExecutable || !existsSync(browserExecutable)) {
  throw new Error('Set UAT_BROWSER_EXECUTABLE to an installed Chromium-compatible browser. No Playwright browser download is assumed.')
}
if (!existsSync(tokenFile)) {
  throw new Error(`Signed-JWT UAT token file was not found: ${tokenFile}`)
}

const tokenDocument = JSON.parse(await readFile(tokenFile, 'utf8'))
if (tokenDocument.audience !== 'hotel-ai-os-api' || tokenDocument.algorithm !== 'RS256') {
  throw new Error('The UAT token file does not describe the expected RS256 hotel-ai-os-api tokens.')
}

const roleViews = [
  { key: 'housekeeping-supervisor', scenario: 'A', flow: '客房照片→卫生标准评价→整改任务→客房主管执行→店总验收', views: ['workbench', 'my-work', 'tasks', 'evaluations'] },
  { key: 'general-manager', scenario: 'A', flow: '客房照片→卫生标准评价→整改任务→客房主管执行→店总验收', views: ['hotel-dashboard', 'tasks', 'evaluations'] },
  { key: 'front-desk', scenario: 'B', flow: '前台客诉提交→标准判断→规则触发→任务→关闭', views: ['workbench', 'my-work', 'tasks', 'evaluations'] },
  { key: 'front-supervisor', scenario: 'B', flow: '前台客诉提交→标准判断→规则触发→任务→关闭', views: ['team-work', 'tasks', 'evaluations'] },
  { key: 'housekeeping-supervisor', scenario: 'C', flow: '未提交→MISSED扫描→提醒通知→整改任务→逾期升级', views: ['my-work', 'tasks', 'notifications'] },
  { key: 'assistant-gm', scenario: 'C', flow: '未提交→MISSED扫描→提醒通知→整改任务→逾期升级', views: ['workbench', 'tasks', 'notifications'] },
  { key: 'regional-operations', scenario: 'SCOPE', flow: '区域角色多门店隔离与总览', views: ['workbench', 'operations-dashboard', 'team-work', 'rules', 'tasks'] },
]

for (const role of roleViews) {
  if (typeof tokenDocument.tokens?.[role.key] !== 'string' || tokenDocument.tokens[role.key].length < 100) {
    throw new Error(`Signed bearer token is missing for UAT role ${role.key}.`)
  }
}

await mkdir(outputRoot, { recursive: true })
const browser = await chromium.launch({ headless: true, executablePath: browserExecutable })
const manifest = []
let sequence = 1

try {
  for (const role of roleViews) {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 1050 },
      locale: 'zh-CN',
      timezoneId: 'Asia/Shanghai',
    })
    await context.addInitScript(({ roleKey, accessToken }) => {
      window.localStorage.setItem('hotel-ai-os-role', roleKey)
      window.localStorage.setItem('hotel-ai-os-access-token', accessToken)
    }, { roleKey: role.key, accessToken: tokenDocument.tokens[role.key] })
    const page = await context.newPage()

    for (const view of role.views) {
      const caseId = `uat-screen-${String(sequence).padStart(3, '0')}`
      const timestamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'z')
      const fileName = `tech-v0.2-${caseId}-${role.scenario.toLowerCase()}-${role.key}-${view}-${timestamp}.png`.toLowerCase()
      const filePath = path.join(outputRoot, fileName)
      const consoleErrors = []
      const consoleWarnings = []
      const pageErrors = []
      const failedRequests = []
      const serverErrors = []
      const onConsole = (message) => {
        if (message.type() === 'error') consoleErrors.push(message.text())
        if (message.type() === 'warning') consoleWarnings.push(message.text())
      }
      const onPageError = (error) => pageErrors.push(error.message)
      const onRequestFailed = (request) => failedRequests.push({ url: request.url(), reason: request.failure()?.errorText ?? 'unknown' })
      const onResponse = (response) => {
        if (response.status() >= 500) serverErrors.push({ url: response.url(), status: response.status() })
      }
      page.on('console', onConsole)
      page.on('pageerror', onPageError)
      page.on('requestfailed', onRequestFailed)
      page.on('response', onResponse)

      let passed = true
      let error = null
      let actualUrl = null
      let pageTitle = null
      let bodyTextLength = 0
      let overlayCount = 0
      let activeNavigationButtonCount = 0
      let interactionProof = null
      try {
        await page.goto(`${webBase}/#/${view}`, { waitUntil: 'networkidle', timeout: 30_000 })
        await page.waitForTimeout(700)
        actualUrl = page.url()
        pageTitle = await page.title()
        bodyTextLength = (await page.locator('body').innerText()).trim().length
        const demoCount = await page.locator('.source-flag.demo, .demo-warning').count()
        const errorCount = await page.locator('.error-state').count()
        overlayCount = await page.locator('.modal-backdrop:visible, .overlay:visible, [role="dialog"]:visible').count()
        activeNavigationButtonCount = await page.locator('nav button.active:visible').count()
        if (demoCount > 0) throw new Error('Demo fallback was visible; screenshot is not valid UAT evidence.')
        if (errorCount > 0) throw new Error('The page displayed a real API error state.')
        if (pageTitle !== 'Hotel AI OS') throw new Error(`Unexpected or blank page title: ${pageTitle ?? '<null>'}`)
        if (bodyTextLength < 20 || await page.locator('#root > *').count() === 0) throw new Error('Rendered page was blank or incomplete.')
        if (overlayCount > 0) throw new Error(`A blocking overlay/dialog remained visible (${overlayCount}).`)
        if (activeNavigationButtonCount !== 1) throw new Error(`Expected one active navigation control, found ${activeNavigationButtonCount}.`)

        const activeNavigation = page.locator('nav button.active:visible').first()
        await activeNavigation.click()
        await page.waitForTimeout(150)
        interactionProof = {
          action: 'click-active-navigation-control',
          expectedHash: `#/${view}`,
          actualHash: await page.evaluate(() => window.location.hash),
          activeNavigationButtonCount: await page.locator('nav button.active:visible').count(),
        }
        if (interactionProof.actualHash !== interactionProof.expectedHash || interactionProof.activeNavigationButtonCount !== 1) {
          throw new Error(`Navigation interaction did not preserve expected view ${view}.`)
        }
        if (consoleErrors.length || pageErrors.length || failedRequests.length || serverErrors.length) {
          throw new Error(
            `Browser health failed: consoleErrors=${consoleErrors.length}, pageErrors=${pageErrors.length}, `
            + `failedRequests=${failedRequests.length}, serverErrors=${serverErrors.length}.`,
          )
        }
      } catch (caught) {
        passed = false
        error = caught instanceof Error ? caught.message : String(caught)
      }
      await page.screenshot({ path: filePath, fullPage: true })
      manifest.push({
        caseId,
        scenario: role.scenario,
        flow: role.flow,
        role: role.key,
        view,
        fileName,
        requestedUrl: `${webBase}/#/${view}`,
        actualUrl,
        pageTitle,
        bodyTextLength,
        overlayCount,
        activeNavigationButtonCount,
        interactionProof,
        consoleErrors,
        consoleWarnings,
        pageErrors,
        failedRequests,
        serverErrors,
        passed,
        error,
      })
      page.off('console', onConsole)
      page.off('pageerror', onPageError)
      page.off('requestfailed', onRequestFailed)
      page.off('response', onResponse)
      sequence += 1
    }
    await context.close()
  }
} finally {
  await browser.close()
}

const runMetadata = {
  runId,
  generatedAt: new Date().toISOString(),
  authenticationMode: 'bearer-jwt',
  jwtAlgorithm: tokenDocument.algorithm,
  jwtIssuer: tokenDocument.issuer,
  jwtAudience: tokenDocument.audience,
  bearerTokensPersistedInEvidence: false,
  browserAutomation: 'Playwright fallback (Browser plugin unavailable)',
  browserExecutable,
  viewport: { width: 1440, height: 1050 },
  cases: manifest.length,
  passed: manifest.filter((item) => item.passed).length,
  failed: manifest.filter((item) => !item.passed).length,
  consoleErrorCount: manifest.reduce((count, item) => count + item.consoleErrors.length, 0),
  consoleWarningCount: manifest.reduce((count, item) => count + item.consoleWarnings.length, 0),
}
await writeFile(path.join(outputRoot, 'manifest.json'), `${JSON.stringify({ runMetadata, cases: manifest }, null, 2)}\n`, 'utf8')
const markdown = [
  '# TECH-V0.2 UAT screenshot manifest',
  '',
  `Run: ${runId}`,
  `Authentication: signed RS256 Bearer JWT (${tokenDocument.issuer})`,
  `Browser: ${browserExecutable}`,
  'Automation: Playwright fallback (Browser plugin unavailable)',
  `Console health: ${runMetadata.consoleErrorCount} error(s), ${runMetadata.consoleWarningCount} warning(s)`,
  '',
  '| Case | Scenario | Flow | Role | View | Result | File |',
  '|---|---|---|---|---|---|---|',
  ...manifest.map((item) => `| ${item.caseId} | ${item.scenario} | ${item.flow} | ${item.role} | ${item.view} | ${item.passed ? 'PASS' : 'FAIL'} | ${item.fileName} |`),
  '',
]
await writeFile(path.join(outputRoot, 'manifest.md'), markdown.join('\n'), 'utf8')

const failures = manifest.filter((item) => !item.passed)
if (failures.length) {
  process.stderr.write(`Screenshot capture completed with ${failures.length} invalid evidence item(s).\n`)
  process.exitCode = 1
} else {
  process.stdout.write(`Captured ${manifest.length} signed-JWT real-API screenshots in ${outputRoot}\n`)
}
