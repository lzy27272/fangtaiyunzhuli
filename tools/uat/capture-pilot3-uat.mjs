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
const outerAccessFile = process.env.PILOT_OUTER_ACCESS_FILE ?? 'D:\\SifangguanHotelAIOS\\Pilot-Test-Access.txt'
const browserExecutable = process.env.UAT_BROWSER_EXECUTABLE
  ?? ['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'].find(existsSync)
const outputRoot = path.resolve(process.env.UAT_SCREENSHOT_DIR ?? path.join(repoRoot, 'docs', 'uat', 'evidence', 'pilot3'))

if (!browserExecutable || !existsSync(browserExecutable)) throw new Error('Chrome or Edge is required for Pilot browser UAT.')
if (!existsSync(accountFile)) throw new Error(`Pilot account file is missing: ${accountFile}`)
if (!existsSync(outerAccessFile)) throw new Error(`Pilot outer access file is missing: ${outerAccessFile}`)

const accountLines = (await readFile(accountFile, 'utf8')).split(/\r?\n/).filter(Boolean)
const accounts = accountLines.map((line) => line.split('\t')).filter((parts) => parts.length >= 3)
const outerLines = (await readFile(outerAccessFile, 'utf8')).split(/\r?\n/)
const outerValue = (label) => {
  const line = outerLines.find((item) => item.trim().startsWith(`${label}：`))
  if (!line) throw new Error(`Pilot outer access field is missing: ${label}.`)
  return line.slice(line.indexOf('：') + 1).trim()
}
const httpCredentials = { username: outerValue('用户名'), password: outerValue('密码') }
const credential = (loginName) => {
  const found = accounts.find((parts) => parts[1] === loginName)
  if (!found) throw new Error(`Pilot credential is missing for ${loginName}.`)
  return { loginName: found[1], password: found[2] }
}

await mkdir(outputRoot, { recursive: true })
const browser = await chromium.launch({ headless: true, executablePath: browserExecutable })
const results = []

async function login(page, loginName) {
  const account = credential(loginName)
  await page.goto(`${webBase}/#/workbench`, { waitUntil: 'domcontentloaded', timeout: 45_000 })
  await page.locator('.login-card').waitFor({ state: 'visible', timeout: 20_000 })
  await page.locator('input[autocomplete="username"]').fill(account.loginName)
  await page.locator('input[autocomplete="current-password"]').fill(account.password)
  await page.getByRole('button', { name: '登录中台' }).click()
  await page.locator('.connection').filter({ hasText: '服务端权限已解析' }).waitFor({ state: 'visible', timeout: 30_000 })
}

async function scopedOrganizations(page) {
  return page.evaluate(async () => {
    const token = window.localStorage.getItem('hotel-ai-os-access-token')
    const response = await fetch('/api/v1/org/units', { headers: { 'X-Hotel-AI-Authorization': `Bearer ${token}` } })
    if (!response.ok) throw new Error(`org units returned ${response.status}`)
    const rows = await response.json()
    return rows.map((row) => ({ id: row.id, name: row.name, unitType: row.unit_type }))
  })
}

async function runCase(name, loginName, execute) {
  const context = await browser.newContext({ viewport: { width: 1600, height: 1050 }, locale: 'zh-CN', timezoneId: 'Asia/Shanghai', httpCredentials })
  const page = await context.newPage()
  const consoleErrors = []
  const pageErrors = []
  const failedRequests = []
  const serverErrors = []
  page.on('console', (message) => {
    if (message.type() === 'error' && !message.text().includes('static.cloudflareinsights.com')) consoleErrors.push(message.text())
  })
  page.on('pageerror', (error) => pageErrors.push(error.message))
  page.on('requestfailed', (request) => {
    if (!request.url().includes('static.cloudflareinsights.com')) failedRequests.push({ url: request.url(), reason: request.failure()?.errorText ?? 'unknown' })
  })
  page.on('response', (response) => { if (response.status() >= 500) serverErrors.push({ url: response.url(), status: response.status() }) })

  const evidence = []
  let detail = {}
  let passed = false
  let error = null
  try {
    await login(page, loginName)
    detail = await execute(page, async (fileName) => {
      const filePath = path.join(outputRoot, fileName)
      await page.screenshot({ path: filePath, fullPage: true })
      evidence.push(fileName)
    })
    if (await page.locator('.demo-warning, .source-flag.demo').count()) throw new Error('Demo data indicator is visible.')
    if (await page.locator('.page-error, .error-state').count()) throw new Error('A page-level API error is visible.')
    if (consoleErrors.length || pageErrors.length || failedRequests.length || serverErrors.length) {
      throw new Error(`Browser health failed: console=${consoleErrors.length}, page=${pageErrors.length}, requests=${failedRequests.length}, server=${serverErrors.length}`)
    }
    passed = true
  } catch (caught) {
    error = caught instanceof Error ? caught.message : String(caught)
    const failureFile = `pilot3-${name}-failure.png`
    await page.screenshot({ path: path.join(outputRoot, failureFile), fullPage: true }).catch(() => {})
    evidence.push(failureFile)
  } finally {
    results.push({ name, loginName, passed, error, evidence, detail, consoleErrors, pageErrors, failedRequests, serverErrors })
    await context.close()
  }
}

try {
  await runCase('ceo-configuration', 'ceo.demo', async (page, screenshot) => {
    await page.getByRole('button', { name: '组织与权限' }).click()
    await page.getByRole('heading', { name: '组织、岗位与人员' }).waitFor()
    await page.getByText('真实 PostgreSQL', { exact: true }).waitFor()
    await page.getByRole('button', { name: '＋ 新建组织' }).waitFor()
    await screenshot('pilot3-ceo-organization.png')

    await page.getByRole('button', { name: '岗位字典' }).click()
    await page.getByRole('button', { name: '＋ 新建岗位' }).waitFor()
    await page.getByRole('button', { name: '人员与任职' }).click()
    await page.getByRole('button', { name: '＋ 新建员工' }).waitFor()
    await page.getByRole('button', { name: '＋ 分配任职' }).waitFor()
    await screenshot('pilot3-ceo-employees-assignments.png')

    await page.getByRole('button', { name: '工作包中心' }).click()
    await page.getByRole('heading', { name: '工作包中心' }).waitFor()
    const createButton = page.getByRole('button', { name: '＋ 新建工作包' })
    await createButton.waitFor()
    if (await createButton.isDisabled()) throw new Error('CEO work-package create button is disabled.')
    await createButton.click()
    await page.getByRole('dialog').waitFor()
    await page.getByText('创建工作包与首个工作项', { exact: true }).waitFor()
    await screenshot('pilot3-ceo-work-package-create.png')
    await page.getByRole('button', { name: '×' }).click()

    const orgs = await scopedOrganizations(page)
    if (orgs.length < 2) throw new Error(`CEO should see multiple organizations, received ${orgs.length}.`)
    return { visibleOrgCount: orgs.length, organizationScope: 'TENANT' }
  })

  await runCase('front-desk-isolation', 'front.demo', async (page, screenshot) => {
    if (await page.locator('label.context-select', { hasText: '验收账号' }).count()) throw new Error('Role-switch control is visible in bearer-login mode.')
    await page.getByRole('button', { name: '我的工作' }).click()
    await page.getByRole('heading', { name: '我的工作' }).waitFor()
    await screenshot('pilot3-front-desk-my-work.png')

    const orgs = await scopedOrganizations(page)
    if (orgs.length !== 1) throw new Error(`Front desk account should see exactly one scoped organization, received ${orgs.length}.`)

    const packageNavigation = page.getByRole('button', { name: '工作包中心' })
    if (await packageNavigation.count()) {
      await packageNavigation.click()
      await page.getByRole('heading', { name: '工作包中心' }).waitFor()
      await page.locator('.state-card').waitFor({ state: 'hidden', timeout: 30_000 }).catch(() => {})
      if (await page.getByRole('button', { name: '＋ 新建工作包' }).count()) throw new Error('Front desk account can create work packages.')
    }
    const organizationNavigation = page.getByRole('button', { name: '组织与权限' })
    if (await organizationNavigation.count()) {
      await organizationNavigation.click()
      await page.getByRole('heading', { name: '组织、岗位与人员' }).waitFor()
      await page.locator('.state-card').waitFor({ state: 'hidden', timeout: 30_000 })
      if (await page.locator('.page-error').count()) throw new Error(`Front desk organization view failed: ${await page.locator('.page-error').innerText()}`)
      if (await page.getByRole('button', { name: /＋ 新建|＋ 分配/ }).count()) throw new Error('Front desk account can mutate organization data.')
    }
    await screenshot('pilot3-front-desk-permission-isolation.png')
    return { visibleOrgCount: orgs.length, organizationScope: orgs[0]?.name ?? null, mutationControlsVisible: false }
  })
} finally {
  await browser.close()
}

const report = {
  generatedAt: new Date().toISOString(),
  version: 'TECH-V0.2-PILOT.3',
  target: webBase,
  browserAutomation: 'Playwright fallback (Browser plugin unavailable)',
  browserExecutable,
  credentialsPersistedInEvidence: false,
  outerHttpCredentialsPersistedInEvidence: false,
  passed: results.filter((item) => item.passed).length,
  failed: results.filter((item) => !item.passed).length,
  cases: results,
}
await writeFile(path.join(outputRoot, 'pilot3-browser-uat.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8')
await writeFile(path.join(outputRoot, 'pilot3-browser-uat.md'), [
  '# TECH-V0.2-PILOT.3 Browser UAT',
  '',
  `Target: ${webBase}`,
  `Generated: ${report.generatedAt}`,
  'Automation: Playwright fallback (Browser plugin unavailable)',
  '',
  '| Case | Result | Visible org scope | Evidence |',
  '|---|---|---|---|',
  ...results.map((item) => `| ${item.name} | ${item.passed ? 'PASS' : `FAIL: ${item.error}`} | ${item.detail.visibleOrgCount ?? '—'} | ${item.evidence.join(', ')} |`),
  '',
].join('\n'), 'utf8')

if (report.failed) {
  process.stderr.write(`Pilot browser UAT failed: ${report.failed} case(s).\n`)
  process.exitCode = 1
} else {
  process.stdout.write(`Pilot browser UAT PASS: ${report.passed} case(s), evidence at ${outputRoot}\n`)
}
