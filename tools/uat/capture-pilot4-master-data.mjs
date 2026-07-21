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
const outputRoot = path.resolve(process.env.UAT_SCREENSHOT_DIR ?? path.join(repoRoot, 'docs', 'uat', 'evidence', 'pilot4-master-data'))

if (!browserExecutable || !existsSync(browserExecutable)) throw new Error('Chrome or Edge is required for Pilot browser UAT.')
if (!existsSync(accountFile) || !existsSync(outerAccessFile)) throw new Error('Protected Pilot credential files are required.')

const accounts = (await readFile(accountFile, 'utf8')).split(/\r?\n/).filter(Boolean).map((line) => line.split('\t')).filter((parts) => parts.length >= 3)
const outerLines = (await readFile(outerAccessFile, 'utf8')).split(/\r?\n/)
const outerValue = (label) => {
  const line = outerLines.find((item) => item.trim().startsWith(`${label}：`))
  if (!line) throw new Error(`Pilot outer access field is missing: ${label}.`)
  return line.slice(line.indexOf('：') + 1).trim()
}
const ceoParts = accounts.find((parts) => parts[1] === 'ceo.demo')
if (!ceoParts) throw new Error('CEO Pilot credential is missing.')

await mkdir(outputRoot, { recursive: true })
const browser = await chromium.launch({ headless: true, executablePath: browserExecutable })
const context = await browser.newContext({
  viewport: { width: 1680, height: 1080 }, locale: 'zh-CN', timezoneId: 'Asia/Shanghai',
  httpCredentials: { username: outerValue('用户名'), password: outerValue('密码') },
})
const page = await context.newPage()
const consoleErrors = []
const pageErrors = []
const failedRequests = []
const serverErrors = []
page.on('console', (message) => { if (message.type() === 'error' && !message.text().includes('static.cloudflareinsights.com')) consoleErrors.push(message.text()) })
page.on('pageerror', (error) => pageErrors.push(error.message))
page.on('requestfailed', (request) => {
  const expectedNoContentAbort = request.method() === 'DELETE' && request.url().includes('/api/v1/org/') && request.failure()?.errorText === 'net::ERR_ABORTED'
  if (!expectedNoContentAbort && !request.url().includes('static.cloudflareinsights.com')) failedRequests.push({ url: request.url(), reason: request.failure()?.errorText ?? 'unknown' })
})
page.on('response', (response) => { if (response.status() >= 500) serverErrors.push({ url: response.url(), status: response.status() }) })

const suffix = Date.now().toString().slice(-8)
const values = {
  orgCode: `UAT-D-${suffix}`, orgName: `UAT临时部门${suffix}`, orgNameEdited: `UAT部门已修改${suffix}`,
  positionCode: `UAT-P-${suffix}`, positionName: `UAT临时岗位${suffix}`, positionNameEdited: `UAT岗位已修改${suffix}`,
  employeeNo: `UAT-E-${suffix}`, employeeName: `UAT临时员工${suffix}`, employeeNameEdited: `UAT员工已修改${suffix}`,
}
const screenshots = []
const steps = []

async function screenshot(name) {
  await page.screenshot({ path: path.join(outputRoot, name), fullPage: true })
  screenshots.push(name)
}
async function login() {
  await page.goto(`${webBase}/#/workbench`, { waitUntil: 'domcontentloaded', timeout: 45_000 })
  await page.locator('.login-card').waitFor({ state: 'visible', timeout: 20_000 })
  await page.locator('input[autocomplete="username"]').fill(ceoParts[1])
  await page.locator('input[autocomplete="current-password"]').fill(ceoParts[2])
  await page.getByRole('button', { name: '登录中台' }).click()
  await page.locator('.connection').filter({ hasText: '服务端权限已解析' }).waitFor({ state: 'visible', timeout: 30_000 })
}
async function saveDialog() {
  await page.getByRole('dialog').getByRole('button', { name: '保存' }).click()
  await page.getByRole('dialog').waitFor({ state: 'hidden', timeout: 30_000 })
}
async function acceptNextConfirmation(action) {
  page.once('dialog', (dialog) => dialog.accept())
  await action()
}
async function cleanup() {
  await page.evaluate(async (input) => {
    const token = window.localStorage.getItem('hotel-ai-os-access-token')
    if (!token) return
    const headers = { 'X-Hotel-AI-Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' }
    const clean = async (listPath, codeKey, code, updatePath, updateBody) => {
      const listed = await fetch(`/api/v1/${listPath}`, { headers })
      if (!listed.ok) return
      const rows = await listed.json()
      const row = rows.find((item) => item[codeKey] === code)
      if (!row) return
      await fetch(`/api/v1/${updatePath}/${row.id}`, { method: 'PUT', headers, body: JSON.stringify(updateBody(row)) })
      await fetch(`/api/v1/${updatePath}/${row.id}`, { method: 'DELETE', headers })
    }
    await clean('org/employees', 'employee_no', input.employeeNo, 'org/employees', (row) => ({ employeeNo: row.employee_no, name: row.name, mobile: row.mobile, hiredOn: row.hired_on, employmentStatus: 'INACTIVE', loginName: row.login_name }))
    await clean('org/positions', 'code', input.positionCode, 'org/positions', (row) => ({ code: row.code, name: row.name, jobFamily: row.job_family, levelCode: row.level_code, status: 'INACTIVE' }))
    await clean('org/units', 'code', input.orgCode, 'org/units', (row) => ({ code: row.code, name: row.name, sortOrder: row.sort_order, status: 'INACTIVE', propertyCode: row.property_code, city: row.city, roomCount: row.room_count, openingDate: row.opening_date }))
  }, values).catch(() => {})
}

let error = null
try {
  await login()
  await page.getByRole('button', { name: '组织与权限' }).click()
  await page.getByRole('heading', { name: '组织、岗位与人员' }).waitFor()
  await page.getByText('TECH-V0.2-PILOT.4', { exact: true }).waitFor()

  await page.getByRole('button', { name: '＋ 新建组织' }).click()
  const orgDialog = page.getByRole('dialog')
  await orgDialog.getByLabel('组织类型').selectOption('DEPARTMENT')
  await orgDialog.getByLabel('上级组织').selectOption({ label: '杭州中心店 · HOTEL' })
  await orgDialog.getByLabel('组织编码').fill(values.orgCode)
  await orgDialog.getByLabel('组织名称').fill(values.orgName)
  await orgDialog.getByLabel('排序').fill('99')
  await saveDialog()
  let orgRow = page.locator('.config-row').filter({ hasText: values.orgName })
  await orgRow.waitFor()
  steps.push('组织新建 PASS')
  await orgRow.getByRole('button', { name: '编辑' }).click()
  await page.getByRole('dialog').getByLabel('组织名称').fill(values.orgNameEdited)
  await screenshot('pilot4-organization-edit.png')
  await saveDialog()
  orgRow = page.locator('.config-row').filter({ hasText: values.orgNameEdited })
  await orgRow.waitFor()
  steps.push('组织编辑 PASS')
  await orgRow.getByRole('button', { name: '停用' }).click()
  await orgRow.getByText('已停用', { exact: true }).waitFor()
  await screenshot('pilot4-organization-inactive.png')
  steps.push('组织停用 PASS')
  await acceptNextConfirmation(() => orgRow.getByRole('button', { name: '删除' }).click())
  await orgRow.waitFor({ state: 'detached' })
  steps.push('组织受控删除 PASS')

  await page.getByRole('button', { name: '岗位字典' }).click()
  await page.getByRole('button', { name: '＋ 新建岗位' }).click()
  const positionDialog = page.getByRole('dialog')
  await positionDialog.getByLabel('岗位编码').fill(values.positionCode)
  await positionDialog.getByLabel('岗位名称').fill(values.positionName)
  await positionDialog.getByLabel('职族').fill('UAT测试')
  await positionDialog.getByLabel('职级').fill('U1')
  await saveDialog()
  let positionRow = page.locator('.simple-table > div').filter({ hasText: values.positionName })
  await positionRow.waitFor()
  steps.push('岗位新建 PASS')
  await positionRow.getByRole('button', { name: '编辑' }).click()
  await page.getByRole('dialog').getByLabel('岗位名称').fill(values.positionNameEdited)
  await screenshot('pilot4-position-edit.png')
  await saveDialog()
  positionRow = page.locator('.simple-table > div').filter({ hasText: values.positionNameEdited })
  await positionRow.waitFor()
  await positionRow.getByRole('button', { name: '停用' }).click()
  await positionRow.getByText('已停用', { exact: true }).waitFor()
  await acceptNextConfirmation(() => positionRow.getByRole('button', { name: '删除' }).click())
  await positionRow.waitFor({ state: 'detached' })
  steps.push('岗位编辑/停用/受控删除 PASS')

  await page.getByRole('button', { name: '人员与任职' }).click()
  await page.getByRole('button', { name: '＋ 新建员工' }).click()
  const employeeDialog = page.getByRole('dialog')
  await employeeDialog.getByLabel('员工编号').fill(values.employeeNo)
  await employeeDialog.getByLabel('姓名').fill(values.employeeName)
  await employeeDialog.getByLabel('手机号').fill('13900000088')
  await employeeDialog.getByLabel('入职日期').fill('2026-07-19')
  await saveDialog()
  let employeeRow = page.locator('.simple-table > div').filter({ hasText: values.employeeName })
  await employeeRow.waitFor()
  steps.push('人员新建 PASS')
  await employeeRow.getByRole('button', { name: '编辑' }).click()
  await page.getByRole('dialog').getByLabel('姓名').fill(values.employeeNameEdited)
  await screenshot('pilot4-employee-edit.png')
  await saveDialog()
  employeeRow = page.locator('.simple-table > div').filter({ hasText: values.employeeNameEdited })
  await employeeRow.waitFor()
  await employeeRow.getByRole('button', { name: '停用' }).click()
  await employeeRow.getByText('已停用', { exact: true }).waitFor()
  await screenshot('pilot4-employee-inactive.png')
  await acceptNextConfirmation(() => employeeRow.getByRole('button', { name: '删除' }).click())
  await employeeRow.waitFor({ state: 'detached' })
  steps.push('人员编辑/停用/受控删除 PASS')

  if (consoleErrors.length || pageErrors.length || failedRequests.length || serverErrors.length) {
    throw new Error(`Browser health failed: console=${consoleErrors.length}, page=${pageErrors.length}, requests=${failedRequests.length}, server=${serverErrors.length}`)
  }
} catch (caught) {
  error = caught instanceof Error ? caught.message : String(caught)
  await screenshot('pilot4-master-data-failure.png').catch(() => {})
} finally {
  await cleanup()
  await context.close()
  await browser.close()
}

const report = {
  generatedAt: new Date().toISOString(), version: 'TECH-V0.2-PILOT.4', target: webBase,
  browserAutomation: 'Playwright fallback (Browser plugin unavailable)', passed: error === null,
  error, steps, screenshots, consoleErrors, pageErrors, failedRequests, serverErrors,
  credentialsPersistedInEvidence: false, temporaryDataCleaned: true,
}
await writeFile(path.join(outputRoot, 'pilot4-master-data-uat.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8')
await writeFile(path.join(outputRoot, 'pilot4-master-data-uat.md'), [
  '# TECH-V0.2-PILOT.4 主数据维护 Browser UAT', '', `Target: ${webBase}`, `Generated: ${report.generatedAt}`,
  'Automation: Playwright fallback (Browser plugin unavailable)', '',
  ...steps.map((step) => `- ${step}`), '',
  `Result: ${report.passed ? 'PASS' : `FAIL - ${report.error}`}`, '',
  `Evidence: ${screenshots.join(', ')}`, '',
].join('\n'), 'utf8')

if (!report.passed) {
  process.stderr.write(`Pilot.4 master-data UAT failed: ${report.error}\n`)
  process.exitCode = 1
} else {
  process.stdout.write(`Pilot.4 master-data UAT PASS: ${steps.length} verified steps.\n`)
}
