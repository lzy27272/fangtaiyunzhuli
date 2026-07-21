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
const outputRoot = path.resolve(process.env.UAT_SCREENSHOT_DIR ?? path.join(repoRoot, 'docs', 'uat', 'evidence', 'pilot5-role-capability'))
const browserExecutable = process.env.UAT_BROWSER_EXECUTABLE
  ?? ['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'].find(existsSync)

if (!browserExecutable || !existsSync(browserExecutable)) throw new Error('Chrome or Edge is required for Pilot browser UAT.')
if (!existsSync(accountFile) || !existsSync(outerAccessFile)) throw new Error('Protected Pilot credential files are required.')

const accountRows = (await readFile(accountFile, 'utf8')).split(/\r?\n/).filter(Boolean).map((line) => line.split('\t')).filter((parts) => parts.length >= 3)
const accounts = new Map(accountRows.map((parts) => [parts[1], parts[2]]))
const outerLines = (await readFile(outerAccessFile, 'utf8')).split(/\r?\n/)
const outerValue = (label) => {
  const line = outerLines.find((item) => item.trim().startsWith(`${label}：`))
  if (!line) throw new Error(`Pilot outer access field is missing: ${label}.`)
  return line.slice(line.indexOf('：') + 1).trim()
}

const roles = [
  { login: 'front.demo', slug: 'front-desk', packageName: '前台员工岗位日清工作包（Pilot）', team: false },
  { login: 'fo.supervisor', slug: 'front-office-supervisor', packageName: '前厅主管岗位日清工作包（Pilot）', team: true },
  { login: 'hk.supervisor', slug: 'housekeeping-supervisor', packageName: '客房主管岗位日清工作包（Pilot）', team: true },
  { login: 'assistant.gm', slug: 'assistant-general-manager', packageName: '店助管理日清工作包（Pilot）', team: true, dashboard: '门店驾驶舱' },
  { login: 'gm.hz', slug: 'general-manager', packageName: '店总经营管理日清工作包（Pilot）', team: true, dashboard: '门店驾驶舱' },
  { login: 'ota.assistant', slug: 'ota-assistant', packageName: 'OTA运营助理岗位日清工作包（Pilot）', team: false },
  { login: 'ota.manager', slug: 'ota-manager', packageName: 'OTA运营经理岗位日清工作包（Pilot）', team: true, dashboard: '区域多门店' },
  { login: 'ceo.demo', slug: 'ceo', team: true, ceo: true },
]
for (const role of roles) if (!accounts.has(role.login)) throw new Error(`Protected credential is missing for ${role.login}.`)

await mkdir(outputRoot, { recursive: true })
const browser = await chromium.launch({ headless: true, executablePath: browserExecutable })
const results = []
const screenshots = []
const preparedBusinessDate = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)

async function login(page, role) {
  await page.goto(`${webBase}/#/workbench`, { waitUntil: 'domcontentloaded', timeout: 45_000 })
  await page.locator('.login-card').waitFor({ state: 'visible', timeout: 20_000 })
  await page.locator('input[autocomplete="username"]').fill(role.login)
  await page.locator('input[autocomplete="current-password"]').fill(accounts.get(role.login))
  await page.getByRole('button', { name: '登录中台' }).click()
  await page.locator('.connection').filter({ hasText: '服务端权限已解析' }).waitFor({ state: 'visible', timeout: 30_000 })
  await page.getByText('TECH-V0.2-PILOT.5', { exact: true }).waitFor({ state: 'visible', timeout: 20_000 })
}

function navButton(page, label) {
  return page.locator('.sidebar nav button').filter({ hasText: label }).first()
}

// Ensure every operational account has a writable real instance even when the
// current-day deadline has passed or a prior write audit already submitted it.
const preparationContext = await browser.newContext({
  viewport: { width: 1280, height: 800 }, locale: 'zh-CN', timezoneId: 'Asia/Shanghai',
  httpCredentials: { username: outerValue('用户名'), password: outerValue('密码') },
})
const preparationPage = await preparationContext.newPage()
await login(preparationPage, roles.find((role) => role.ceo))
await preparationPage.evaluate(async ({ logins, businessDate }) => {
  const token = window.localStorage.getItem('hotel-ai-os-access-token')
  if (!token) throw new Error('CEO bearer token is missing during browser-work preparation.')
  const headers = { 'X-Hotel-AI-Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' }
  const employeesResponse = await fetch('/api/v1/org/employees', { headers })
  if (!employeesResponse.ok) throw new Error(`Employee preparation read failed: ${employeesResponse.status}`)
  const employees = await employeesResponse.json()
  for (const login of logins) {
    const candidates = employees.filter((row) => (row.login_name ?? row.loginName) === login && (row.assignment_id ?? row.assignmentId))
    const employee = candidates.find((row) => row.primary) ?? candidates[0]
    if (!employee) throw new Error(`Active assignment is missing for ${login}.`)
    const response = await fetch('/api/v1/work-expectations/actions/generate', {
      method: 'POST', headers: { ...headers, 'Idempotency-Key': crypto.randomUUID() },
      body: JSON.stringify({
        positionAssignmentId: employee.assignment_id ?? employee.assignmentId,
        targetOrgUnitId: employee.org_unit_id ?? employee.orgUnitId,
        businessDate, periodType: 'DAY', dutyPeriodId: null,
      }),
    })
    if (!response.ok) throw new Error(`Work preparation failed for ${login}: ${response.status} ${await response.text()}`)
  }
}, { logins: roles.filter((role) => !role.ceo).map((role) => role.login), businessDate: preparedBusinessDate })
await preparationContext.close()

for (const role of roles) {
  const consoleErrors = []
  const pageErrors = []
  const failedRequests = []
  const serverErrors = []
  const steps = []
  let error = null
  const context = await browser.newContext({
    viewport: { width: 1680, height: 1080 }, locale: 'zh-CN', timezoneId: 'Asia/Shanghai',
    httpCredentials: { username: outerValue('用户名'), password: outerValue('密码') },
  })
  const page = await context.newPage()
  page.on('console', (message) => { if (message.type() === 'error' && !message.text().includes('static.cloudflareinsights.com')) consoleErrors.push(message.text()) })
  page.on('pageerror', (exception) => pageErrors.push(exception.message))
  page.on('requestfailed', (request) => { if (!request.url().includes('static.cloudflareinsights.com')) failedRequests.push({ url: request.url(), reason: request.failure()?.errorText ?? 'unknown' }) })
  page.on('response', (response) => { if (response.status() >= 500) serverErrors.push({ url: response.url(), status: response.status() }) })
  try {
    await login(page, role)
    steps.push('真实账号登录 PASS')

    if (role.ceo) {
      if (await navButton(page, '我的工作').count()) throw new Error('CEO不应显示虚假的个人工作入口。')
      await navButton(page, '团队工作').click()
      await page.getByRole('heading', { name: '团队工作' }).waitFor()
      steps.push('集团团队执行视图 PASS')
      await navButton(page, '工作包中心').click()
      await page.getByRole('heading', { name: '工作包中心' }).waitFor()
      const create = page.getByRole('button', { name: '＋ 新建工作包' })
      if (!(await create.isEnabled())) throw new Error('CEO工作包创建入口未启用。')
      await create.click()
      const dialog = page.getByRole('dialog')
      await dialog.getByRole('heading', { name: '创建工作包与首个工作项' }).waitFor()
      const requiredControls = ['工作包编码', '工作包名称', '目标岗位', '下发范围', '工作表单', '工作项名称']
      for (const label of requiredControls) if (!(await dialog.getByLabel(label).count())) throw new Error(`工作包表单缺少字段：${label}`)
      steps.push('工作包真实创建表单 PASS')
    } else {
      await navButton(page, '我的工作').click()
      await page.getByRole('heading', { name: '我的工作' }).waitFor()
      await page.locator('.work-table').getByText(role.packageName, { exact: false }).first().waitFor({ state: 'visible', timeout: 20_000 })
      const enabledFill = page.locator('button.link-button:enabled').filter({ hasText: '填报' }).first()
      await enabledFill.waitFor({ state: 'visible', timeout: 20_000 })
      await enabledFill.click()
      const dialog = page.getByRole('dialog')
      await dialog.getByText('数据将按已发布表单校验', { exact: false }).waitFor()
      if (!(await dialog.locator('.dynamic-form input, .dynamic-form select').count())) throw new Error('岗位工作记录未加载结构化表单。')
      if (await dialog.getByText('无法安全提交', { exact: false }).count()) throw new Error('岗位工作记录缺少提交上下文。')
      steps.push('我的工作有真实实例且可打开结构化填报 PASS')
      const formScreenshot = `pilot5-${role.slug}-my-work-form.png`
      await page.screenshot({ path: path.join(outputRoot, formScreenshot), fullPage: true })
      screenshots.push(formScreenshot)

      await dialog.getByRole('button', { name: '取消' }).click()
      await navButton(page, '工作包中心').click()
      await page.getByRole('heading', { name: '工作包中心' }).waitFor()
      await page.locator('.package-card').filter({ hasText: role.packageName }).first().waitFor({ state: 'visible', timeout: 20_000 })
      steps.push('岗位工作包可见 PASS')

      if (role.team) {
        await navButton(page, '团队工作').click()
        await page.getByRole('heading', { name: '团队工作' }).waitFor()
        steps.push('团队工作入口及授权范围 PASS')
      } else if (await navButton(page, '团队工作').count()) {
        throw new Error('执行岗位不应显示团队工作入口。')
      } else {
        steps.push('团队工作越权入口隐藏 PASS')
      }

      if (role.dashboard) {
        await navButton(page, role.dashboard).click()
        await page.getByRole('heading', { name: new RegExp(role.dashboard) }).waitFor()
        await page.locator(role.dashboard === '门店驾驶舱' ? '.p0-dashboard-metrics' : '.regional-summary').waitFor({ state: 'visible', timeout: 20_000 })
        steps.push(`${role.dashboard}实时数据 PASS`)
      }
    }

    const screenshotName = `pilot5-${role.slug}-capability.png`
    await page.screenshot({ path: path.join(outputRoot, screenshotName), fullPage: true })
    screenshots.push(screenshotName)
    if (consoleErrors.length || pageErrors.length || failedRequests.length || serverErrors.length) {
      throw new Error(`浏览器健康失败：console=${consoleErrors.length}, page=${pageErrors.length}, requests=${failedRequests.length}, server=${serverErrors.length}`)
    }
  } catch (caught) {
    error = caught instanceof Error ? caught.message : String(caught)
    const failureName = `pilot5-${role.slug}-failure.png`
    await page.screenshot({ path: path.join(outputRoot, failureName), fullPage: true }).catch(() => {})
    screenshots.push(failureName)
  } finally {
    results.push({ login: role.login, passed: error === null, error, steps, consoleErrors, pageErrors, failedRequests, serverErrors })
    await context.close()
  }
}
await browser.close()

const report = {
  generatedAt: new Date().toISOString(), version: 'TECH-V0.2-PILOT.5', target: webBase,
  browserAutomation: 'Playwright fallback (Browser plugin unavailable)', passed: results.every((item) => item.passed),
  preparedBusinessDate, results, screenshots, credentialsPersistedInEvidence: false,
}
await writeFile(path.join(outputRoot, 'pilot5-role-browser-uat.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8')
await writeFile(path.join(outputRoot, 'pilot5-role-browser-uat.md'), [
  '# TECH-V0.2-PILOT.5 八角色 Browser UAT', '', `Target: ${webBase}`, `Generated: ${report.generatedAt}`,
  'Automation: Playwright fallback (Browser plugin unavailable)', '',
  ...results.flatMap((item) => [`## ${item.login}`, '', ...item.steps.map((step) => `- ${step}`), '', `Result: ${item.passed ? 'PASS' : `BLOCKED - ${item.error}`}`, '']),
  `Overall: ${report.passed ? 'PASS' : 'BLOCKED'}`, '', `Evidence: ${screenshots.join(', ')}`, '',
].join('\n'), 'utf8')

if (!report.passed) {
  process.stderr.write(`Pilot.5 browser UAT BLOCKED: ${results.filter((item) => !item.passed).map((item) => `${item.login}: ${item.error}`).join('; ')}\n`)
  process.exitCode = 1
} else {
  process.stdout.write(`Pilot.5 browser UAT PASS: ${results.length} real roles verified.\n`)
}
