import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { requireExplicitUatFile, resolveIsolatedUatWebBase } from './isolated-uat-target.mjs'

const require = createRequire(import.meta.url)
const { chromium } = require(process.env.UAT_PLAYWRIGHT_MODULE ?? 'playwright')
const toolRoot = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(toolRoot, '..', '..')
const webBase = await resolveIsolatedUatWebBase(repoRoot)
const accountFile = requireExplicitUatFile('PILOT_ACCOUNT_FILE')
const outerAccessFile = requireExplicitUatFile('PILOT_OUTER_ACCESS_FILE')
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
const ceoParts = accounts.find((parts) => parts[1] === 'ceo.demo')
if (!ceoParts) throw new Error('CEO Pilot credential is missing.')

const runId = new Date().toISOString().replace(/\D/g, '').slice(2, 14)
const generated = {
  hotelCode: `UI-H-${runId}`,
  hotelName: `Pilot网页验收酒店${runId}`,
  positionCode: `UI-P-${runId}`,
  positionName: `网页验收前台${runId}`,
  employeeNo: `UI-E-${runId}`,
  employeeName: `网页验收员工${runId.slice(-6)}`,
  loginName: `ui.${runId}`,
  temporaryPassword: `SfG!${runId}Aa`,
  packageCode: `UI-WP-${runId}`,
  packageName: `网页全流程工作包${runId}`,
  itemName: `完成网页全流程日报${runId}`,
  workflowPositionName: '前台员工',
}

await mkdir(outputRoot, { recursive: true })
const browser = await chromium.launch({ headless: true, executablePath: browserExecutable })
const context = await browser.newContext({ viewport: { width: 1600, height: 1050 }, locale: 'zh-CN', timezoneId: 'Asia/Shanghai', httpCredentials })
const page = await context.newPage()
const consoleErrors = []
const pageErrors = []
const failedRequests = []
const serverErrors = []
const evidence = []

page.on('console', (message) => {
  if (message.type() === 'error' && !message.text().includes('static.cloudflareinsights.com')) consoleErrors.push(message.text())
})
page.on('pageerror', (error) => pageErrors.push(error.message))
page.on('requestfailed', (request) => {
  if (!request.url().includes('static.cloudflareinsights.com')) failedRequests.push({ url: request.url(), reason: request.failure()?.errorText ?? 'unknown' })
})
page.on('response', (response) => {
  if (response.status() >= 500) serverErrors.push({ url: response.url(), status: response.status() })
})

async function screenshot(fileName) {
  await page.screenshot({ path: path.join(outputRoot, fileName), fullPage: true })
  evidence.push(fileName)
}

async function login(loginName, password) {
  await page.goto(`${webBase}/#/workbench`, { waitUntil: 'domcontentloaded', timeout: 45_000 })
  await page.locator('.login-card').waitFor({ state: 'visible', timeout: 20_000 })
  await page.locator('input[autocomplete="username"]').fill(loginName)
  await page.locator('input[autocomplete="current-password"]').fill(password)
  await page.getByRole('button', { name: '登录中台' }).click()
  await page.locator('.connection').filter({ hasText: '服务端权限已解析' }).waitFor({ state: 'visible', timeout: 30_000 })
}

async function selectFirstMatching(select, predicate, description) {
  const option = await select.locator('option').evaluateAll((items, pattern) => {
    const expression = new RegExp(pattern)
    return items.map((item) => ({ value: item.value, text: item.textContent ?? '' })).find((item) => item.value && expression.test(item.text)) ?? null
  }, predicate.source)
  if (!option) throw new Error(`No selectable ${description} option was found.`)
  await select.selectOption(option.value)
  return option
}

async function openNavigation(name) {
  const button = page.getByRole('button', { name })
  await button.waitFor({ state: 'visible', timeout: 30_000 })
  await button.click()
}

const report = {
  generatedAt: new Date().toISOString(),
  version: 'TECH-V0.2-PILOT.3',
  target: webBase,
  browserAutomation: 'Playwright fallback (Browser plugin unavailable)',
  credentialsPersistedInEvidence: false,
  outerHttpCredentialsPersistedInEvidence: false,
  passed: false,
  created: {
    hotelCode: generated.hotelCode,
    hotelName: generated.hotelName,
    positionCode: generated.positionCode,
    positionName: generated.positionName,
    employeeNo: generated.employeeNo,
    employeeName: generated.employeeName,
    packageCode: generated.packageCode,
    packageName: generated.packageName,
  },
  employeeVisibleOrgCount: null,
  workRecordStatus: null,
  attachmentSubmitted: false,
  evidence,
  consoleErrors,
  pageErrors,
  failedRequests,
  serverErrors,
  error: null,
}

try {
  await login(ceoParts[1], ceoParts[2])

  await openNavigation('组织与权限')
  await page.getByRole('heading', { name: '组织、岗位与人员' }).waitFor()
  await page.getByRole('button', { name: '＋ 新建组织' }).click()
  const orgDialog = page.getByRole('dialog')
  await orgDialog.waitFor()
  await orgDialog.getByLabel('组织类型').selectOption('HOTEL')
  await selectFirstMatching(orgDialog.getByLabel('上级组织'), /· REGION$/, 'region')
  await orgDialog.getByLabel('组织编码').fill(generated.hotelCode)
  await orgDialog.getByLabel('组织名称').fill(generated.hotelName)
  await orgDialog.getByLabel('门店编码').fill(generated.hotelCode)
  await orgDialog.getByLabel('城市').fill('贵阳')
  await orgDialog.getByLabel('房间数').fill('88')
  await orgDialog.getByRole('button', { name: '保存' }).click()
  await orgDialog.waitFor({ state: 'hidden', timeout: 30_000 })
  await page.getByText(generated.hotelName, { exact: true }).waitFor()
  await screenshot('pilot3-ui-created-hotel.png')

  await page.getByRole('button', { name: '岗位字典' }).click()
  await page.getByRole('button', { name: '＋ 新建岗位' }).click()
  const positionDialog = page.getByRole('dialog')
  await positionDialog.getByLabel('岗位编码').fill(generated.positionCode)
  await positionDialog.getByLabel('岗位名称').fill(generated.positionName)
  await positionDialog.getByLabel('职族').fill('前厅运营')
  await positionDialog.getByLabel('职级').fill('PILOT')
  await positionDialog.getByRole('button', { name: '保存' }).click()
  await positionDialog.waitFor({ state: 'hidden', timeout: 30_000 })
  await page.getByText(generated.positionName, { exact: true }).waitFor()

  await page.getByRole('button', { name: '人员与任职' }).click()
  await page.getByRole('button', { name: '＋ 新建员工' }).click()
  const employeeDialog = page.getByRole('dialog')
  await employeeDialog.getByLabel('员工编号').fill(generated.employeeNo)
  await employeeDialog.getByLabel('姓名').fill(generated.employeeName)
  await employeeDialog.getByLabel('手机号').fill(`139${runId.slice(-8)}`)
  await employeeDialog.getByLabel('登录账号').fill(generated.loginName)
  await employeeDialog.getByLabel('初始密码').fill(generated.temporaryPassword)
  await employeeDialog.getByRole('button', { name: '保存' }).click()
  await employeeDialog.waitFor({ state: 'hidden', timeout: 30_000 })
  await page.getByText(generated.employeeName, { exact: true }).waitFor()

  await page.getByRole('button', { name: '＋ 分配任职' }).click()
  const assignmentDialog = page.getByRole('dialog')
  const assignmentSelects = assignmentDialog.locator('.form-grid select')
  await assignmentSelects.nth(0).selectOption({ label: `${generated.employeeName} · ${generated.employeeNo}` })
  await assignmentSelects.nth(1).selectOption({ label: generated.hotelName })
  await assignmentSelects.nth(2).selectOption({ label: generated.positionName })
  await selectFirstMatching(assignmentSelects.nth(5), /FRONT_DESK/, 'front-desk role')
  await assignmentDialog.getByLabel('设为主岗').uncheck()
  await assignmentDialog.getByRole('button', { name: '保存' }).click()
  await assignmentDialog.waitFor({ state: 'hidden', timeout: 30_000 })

  await page.getByRole('button', { name: '＋ 分配任职' }).click()
  const primaryAssignmentDialog = page.getByRole('dialog')
  const primaryAssignmentSelects = primaryAssignmentDialog.locator('.form-grid select')
  await primaryAssignmentSelects.nth(0).selectOption({ label: `${generated.employeeName} · ${generated.employeeNo}` })
  await primaryAssignmentSelects.nth(1).selectOption({ label: generated.hotelName })
  await primaryAssignmentSelects.nth(2).selectOption({ label: generated.workflowPositionName })
  await primaryAssignmentSelects.nth(5).selectOption('')
  await primaryAssignmentDialog.getByLabel('设为主岗').check()
  await primaryAssignmentDialog.getByRole('button', { name: '保存' }).click()
  await primaryAssignmentDialog.waitFor({ state: 'hidden', timeout: 30_000 })
  const employeeRows = page.locator('.employees-table > div').filter({ hasText: generated.employeeName })
  await employeeRows.filter({ hasText: generated.positionName }).waitFor({ state: 'visible', timeout: 30_000 })
  await employeeRows.filter({ hasText: generated.workflowPositionName }).waitFor({ state: 'visible', timeout: 30_000 })
  await screenshot('pilot3-ui-created-employee-assignment.png')

  await openNavigation('工作包中心')
  await page.getByRole('heading', { name: '工作包中心' }).waitFor()
  await page.getByRole('button', { name: '＋ 新建工作包' }).click()
  const packageDialog = page.getByRole('dialog')
  await packageDialog.getByLabel('工作包编码').fill(generated.packageCode)
  await packageDialog.getByLabel('工作包名称').fill(generated.packageName)
  await packageDialog.getByLabel('目标岗位').selectOption({ label: generated.workflowPositionName })
  await packageDialog.getByLabel('归属组织').selectOption({ label: generated.hotelName })
  await packageDialog.getByLabel('下发范围').selectOption({ label: generated.hotelName })
  await selectFirstMatching(packageDialog.getByLabel('工作表单'), /前台|日报|FD/, 'published front-desk form')
  await packageDialog.getByLabel('工作项编码').fill(`DAILY-${runId.slice(-6)}`)
  await packageDialog.getByLabel('工作项名称').fill(generated.itemName)
  await packageDialog.getByLabel('执行周期').selectOption('DAY')
  await packageDialog.getByLabel('验收方式').selectOption('NONE')
  await packageDialog.getByLabel('说明').fill('TECH-V0.2-PILOT.3 公网页面全流程验收数据。')
  await packageDialog.getByRole('button', { name: '创建草稿' }).click()
  await packageDialog.waitFor({ state: 'hidden', timeout: 30_000 })

  const packageCard = page.locator('.package-card').filter({ hasText: generated.packageCode })
  await packageCard.waitFor({ state: 'visible', timeout: 30_000 })
  await packageCard.getByRole('button', { name: '查看版本与发布' }).click()
  const publishDialog = page.getByRole('dialog')
  await publishDialog.getByRole('button', { name: '校验并发布' }).click()
  await publishDialog.waitFor({ state: 'hidden', timeout: 30_000 })
  await packageCard.getByText('已发布', { exact: true }).waitFor({ state: 'visible', timeout: 30_000 })

  await packageCard.getByRole('button', { name: '查看版本与发布' }).click()
  const allocationDialog = page.getByRole('dialog')
  await allocationDialog.getByLabel('负责人任职').selectOption({ label: `${generated.employeeName} · ${generated.workflowPositionName} · ${generated.hotelName}` })
  await allocationDialog.getByLabel('目标门店/部门').selectOption({ label: generated.hotelName })
  await screenshot('pilot3-ui-published-allocation.png')
  await allocationDialog.getByRole('button', { name: '下发并生成今日工作' }).click()
  await allocationDialog.waitFor({ state: 'hidden', timeout: 30_000 })

  await page.getByRole('button', { name: '退出' }).click()
  await page.locator('.login-card').waitFor({ state: 'visible', timeout: 20_000 })
  await login(generated.loginName, generated.temporaryPassword)
  await openNavigation('我的工作')
  await page.getByRole('heading', { name: '我的工作' }).waitFor()
  const workRow = page.locator('.work-table .table-row').filter({ hasText: generated.itemName })
  await workRow.waitFor({ state: 'visible', timeout: 30_000 })

  const employeeScope = await page.evaluate(async () => {
    const token = window.localStorage.getItem('hotel-ai-os-access-token')
    const response = await fetch('/api/v1/org/units', { headers: { 'X-Hotel-AI-Authorization': `Bearer ${token}` } })
    if (!response.ok) throw new Error(`Scoped organization request returned ${response.status}.`)
    return response.json()
  })
  report.employeeVisibleOrgCount = employeeScope.length
  if (employeeScope.length !== 1 || employeeScope[0]?.name !== generated.hotelName) {
    throw new Error(`Generated employee scope mismatch: expected only ${generated.hotelName}, received ${employeeScope.map((item) => item.name).join(', ')}.`)
  }
  await screenshot('pilot3-ui-employee-scoped-work.png')

  await workRow.getByRole('button', { name: '填报' }).click()
  const recordDialog = page.getByRole('dialog')
  await recordDialog.waitFor()
  const dynamicInputs = recordDialog.locator('.dynamic-form input')
  for (let index = 0; index < await dynamicInputs.count(); index += 1) {
    const input = dynamicInputs.nth(index)
    await input.fill((await input.getAttribute('type')) === 'number' ? '1' : 'Pilot网页全流程验收')
  }
  const dynamicSelects = recordDialog.locator('.dynamic-form select')
  for (let index = 0; index < await dynamicSelects.count(); index += 1) {
    const select = dynamicSelects.nth(index)
    await select.selectOption('true').catch(async () => select.selectOption({ index: 1 }))
  }
  const attachmentPath = path.join(outputRoot, 'pilot3-ui-created-hotel.png')
  await recordDialog.locator('input[type="file"]').setInputFiles(attachmentPath)
  report.attachmentSubmitted = true
  await screenshot('pilot3-ui-work-record-with-attachment.png')
  await recordDialog.getByRole('button', { name: '提交并评价' }).click()
  await recordDialog.waitFor({ state: 'hidden', timeout: 45_000 })
  await workRow.getByText('已提交', { exact: true }).waitFor({ state: 'visible', timeout: 30_000 })
  report.workRecordStatus = 'SUBMITTED'
  await screenshot('pilot3-ui-work-record-submitted.png')

  if (await page.locator('.demo-warning, .source-flag.demo').count()) throw new Error('Demo data indicator is visible.')
  if (await page.locator('.page-error, .error-state').count()) throw new Error('A page-level API error is visible.')
  if (consoleErrors.length || pageErrors.length || failedRequests.length || serverErrors.length) {
    throw new Error(`Browser health failed: console=${consoleErrors.length}, page=${pageErrors.length}, requests=${failedRequests.length}, server=${serverErrors.length}`)
  }
  report.passed = true
} catch (caught) {
  report.error = caught instanceof Error ? caught.message : String(caught)
  await screenshot('pilot3-ui-full-flow-failure.png').catch(() => {})
} finally {
  await context.close()
  await browser.close()
}

await writeFile(path.join(outputRoot, 'pilot3-ui-full-flow.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8')
await writeFile(path.join(outputRoot, 'pilot3-ui-full-flow.md'), [
  '# TECH-V0.2-PILOT.3 Public UI Full-Flow UAT',
  '',
  `Target: ${webBase}`,
  `Generated: ${report.generatedAt}`,
  `Result: ${report.passed ? 'PASS' : `FAIL: ${report.error}`}`,
  '',
  '| Check | Result |',
  '|---|---|',
  `| Create hotel in UI | ${report.created.hotelName} |`,
  `| Create position in UI | ${report.created.positionName} |`,
  `| Create employee and login in UI | ${report.created.employeeName} (credential omitted) |`,
  `| Assign position and FRONT_DESK scoped role | ${report.passed || report.employeeVisibleOrgCount !== null ? 'Completed' : 'Not completed'} |`,
  `| Create, publish and allocate work package | ${report.created.packageName} |`,
  `| Employee visible organization count | ${report.employeeVisibleOrgCount ?? '—'} |`,
  `| Submit structured work record | ${report.workRecordStatus ?? '—'} |`,
  `| Upload image attachment | ${report.attachmentSubmitted ? 'Completed' : 'Not completed'} |`,
  `| Browser/API errors | console=${consoleErrors.length}, page=${pageErrors.length}, request=${failedRequests.length}, server=${serverErrors.length} |`,
  '',
  `Evidence: ${evidence.join(', ')}`,
  '',
  '> Generated temporary application credentials are intentionally omitted from all evidence files.',
  '',
].join('\n'), 'utf8')

if (!report.passed) {
  process.stderr.write(`Pilot public UI full-flow UAT failed: ${report.error}\n`)
  process.exitCode = 1
} else {
  process.stdout.write(`Pilot public UI full-flow UAT PASS, evidence at ${outputRoot}\n`)
}
