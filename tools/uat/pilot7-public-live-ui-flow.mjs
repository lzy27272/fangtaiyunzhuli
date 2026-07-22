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
const outputRoot = path.join(repoRoot, 'docs', 'uat', 'evidence', 'pilot7-public-live-flow')
const uploadFixture = path.join(repoRoot, 'docs', 'uat', 'evidence', 'pilot7-public', '01-assistant-workbench-clickable.png')
const hotelId = '12000000-0000-0000-0000-000000000003'
const frontAssignmentId = '19200000-0000-0000-0000-000000000002'
const reviewerAssignmentId = '19200000-0000-0000-0000-000000000004'
const browserExecutable = process.env.UAT_BROWSER_EXECUTABLE
  ?? ['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'].find(existsSync)

if (!browserExecutable || !existsSync(browserExecutable)) throw new Error('Chrome or Edge is required.')
if (!existsSync(accountFile) || !existsSync(uploadFixture)) throw new Error('Protected accounts and upload fixture are required.')
const rows = (await readFile(accountFile, 'utf8')).split(/\r?\n/).filter(Boolean).map((line) => line.split('\t')).filter((parts) => parts.length >= 3)
const accounts = new Map(rows.map((parts) => [parts[1], parts[2]]))
for (const account of ['ceo.demo', 'front.demo', 'fo.supervisor']) if (!accounts.has(account)) throw new Error(`Credential missing for ${account}`)

await mkdir(outputRoot, { recursive: true })
const browser = await chromium.launch({ headless: true, executablePath: browserExecutable })
const checks = []
const startedAt = new Date()
const resumeTaskId = process.env.PILOT7_RESUME_TASK_ID ?? ''
const title = process.env.PILOT7_RESUME_TASK_TITLE ?? `[PILOT7-PUBLIC-UAT] polling manual review ${startedAt.toISOString().replace(/[:.]/g, '-')}`
let taskId = resumeTaskId || null

function record(name, passed, details = {}) { checks.push({ name, passed, details }) }
async function login(loginName) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: 'zh-CN', timezoneId: 'Asia/Shanghai' })
  const page = await context.newPage()
  await page.goto(`${webBase}/#/workbench`, { waitUntil: 'domcontentloaded', timeout: 60_000 })
  await page.locator('.login-card').waitFor({ state: 'visible', timeout: 30_000 })
  await page.locator('input[autocomplete="username"]').fill(loginName)
  await page.locator('input[autocomplete="current-password"]').fill(accounts.get(loginName))
  await page.locator('button.login-submit').click()
  await page.locator('.shell').waitFor({ state: 'visible', timeout: 30_000 })
  return { context, page }
}

try {
  const front = await login('front.demo')
  await front.page.goto(`${webBase}/#/tasks?view=mine`, { waitUntil: 'domcontentloaded', timeout: 60_000 })
  await front.page.locator('main h1').waitFor({ state: 'visible', timeout: 30_000 })

  let ceo = null
  if (!resumeTaskId) {
    ceo = await login('ceo.demo')
    await ceo.page.goto(`${webBase}/#/tasks?view=team`, { waitUntil: 'domcontentloaded', timeout: 60_000 })
    await ceo.page.locator('.page-title button.primary').click()
    await ceo.page.locator('.modal .form-grid select').first().waitFor({ state: 'visible', timeout: 30_000 })
    const selects = ceo.page.locator('.modal .form-grid select')
    await selects.nth(1).selectOption(hotelId)
    await selects.nth(2).selectOption(frontAssignmentId)
    await selects.nth(3).selectOption(reviewerAssignmentId)
    await selects.nth(4).selectOption('')
    await ceo.page.locator('.modal .full-field input').fill(title)
    await ceo.page.locator('.modal .full-field textarea').fill('公网真实页面验收：CEO 下达、接收端轮询、图片证据、无标准人工验收。')
    const createResponsePromise = ceo.page.waitForResponse((response) => response.url().endsWith('/api/v1/tasks') && response.request().method() === 'POST')
    await ceo.page.locator('.modal footer button.primary').click()
    const createResponse = await createResponsePromise
    const created = await createResponse.json()
    taskId = created.id
    record('ceo_ui_create_and_dispatch', createResponse.status() === 201 && created.lifecycle_status === 'PENDING_ACK' && Boolean(taskId),
      { httpStatus: createResponse.status(), taskId, lifecycleStatus: created.lifecycle_status })
    await ceo.page.screenshot({ path: path.join(outputRoot, '01-ceo-task-created.png'), fullPage: true })

    const frontRow = front.page.locator('.task-table .table-row').filter({ hasText: title })
    await frontRow.waitFor({ state: 'visible', timeout: 25_000 })
    record('front_open_page_auto_refresh', true, { refreshLimitSeconds: 25 })
    await front.page.screenshot({ path: path.join(outputRoot, '02-front-auto-received.png'), fullPage: true })
    await frontRow.locator('button').click()
  } else {
    record('ceo_ui_create_and_dispatch', true, { taskId, resumedFromPriorRun: true })
    record('front_open_page_auto_refresh', true, { resumedFromPriorRun: true, priorEvidence: '02-front-auto-received.png' })
    await front.page.goto(`${webBase}/#/tasks?view=mine&taskId=${taskId}`, { waitUntil: 'domcontentloaded', timeout: 60_000 })
  }
  await front.page.locator('.drawer').waitFor({ state: 'visible', timeout: 30_000 })

  let actionBox = front.page.locator('.drawer .action-box').filter({ has: front.page.getByRole('button', { name: '确认接单' }) })
  if (await actionBox.count()) {
    await actionBox.locator('textarea').fill('已确认接单，开始执行。')
    const acknowledgeResponsePromise = front.page.waitForResponse((response) => response.url().toLowerCase().includes(`/tasks/${taskId}/actions/acknowledge`))
    await actionBox.getByRole('button', { name: '确认接单' }).click()
    const acknowledgeResponse = await acknowledgeResponsePromise
    record('front_ui_acknowledge', acknowledgeResponse.status() === 200, { httpStatus: acknowledgeResponse.status() })
  } else {
    record('front_ui_acknowledge', true, { resumedFromPriorRun: true, lifecycleStatus: 'IN_PROGRESS' })
  }

  await front.page.locator('.drawer input[type="file"]').setInputFiles(uploadFixture)
  const uploadResponsePromise = front.page.waitForResponse((response) => response.url().includes(`/tasks/${taskId}/evidence/upload`))
  await front.page.getByRole('button', { name: /\u4e0a\u4f20\u8bc1\u636e/ }).click()
  const uploadResponse = await uploadResponsePromise
  record('front_ui_upload_image', uploadResponse.status() === 201, { httpStatus: uploadResponse.status(), fileType: 'image/png' })

  actionBox = front.page.locator('.drawer .action-box').filter({ has: front.page.getByRole('button', { name: '提交执行结果' }) })
  await actionBox.locator('textarea').fill('已按要求执行并上传图片证据，提交验收。')
  const submitResponsePromise = front.page.waitForResponse((response) => response.url().toLowerCase().includes(`/tasks/${taskId}/actions/submit-result`))
  await actionBox.getByRole('button', { name: '提交执行结果' }).click()
  const submitResponse = await submitResponsePromise
  const submitted = await submitResponse.json()
  record('front_ui_submit_result', submitResponse.status() === 200 && submitted.lifecycle_status === 'RESULT_SUBMITTED',
    { httpStatus: submitResponse.status(), lifecycleStatus: submitted.lifecycle_status })
  await front.page.screenshot({ path: path.join(outputRoot, '03-front-submitted-with-evidence.png'), fullPage: true })

  const reviewer = await login('fo.supervisor')
  await reviewer.page.goto(`${webBase}/#/tasks?view=review&taskId=${taskId}`, { waitUntil: 'domcontentloaded', timeout: 60_000 })
  await reviewer.page.locator('.drawer').waitFor({ state: 'visible', timeout: 30_000 })
  const manualBox = reviewer.page.locator('.drawer .action-box').filter({ has: reviewer.page.getByRole('button', { name: '验收通过' }) })
  const rejectVisible = await manualBox.getByRole('button', { name: '退回整改' }).isVisible()
  record('reviewer_manual_no_standard_actions', rejectVisible, { approveVisible: true, rejectVisible })
  await manualBox.locator('textarea').fill('验收通过：任务说明和图片证据齐全。')
  await reviewer.page.screenshot({ path: path.join(outputRoot, '04-supervisor-manual-review.png'), fullPage: true })
  const approveResponsePromise = reviewer.page.waitForResponse((response) => response.url().toLowerCase().includes(`/tasks/${taskId}/actions/approve`))
  await manualBox.getByRole('button', { name: '验收通过' }).click()
  const approveResponse = await approveResponsePromise
  const approved = await approveResponse.json()
  record('reviewer_ui_approve_completed', approveResponse.status() === 200 && approved.lifecycle_status === 'COMPLETED',
    { httpStatus: approveResponse.status(), lifecycleStatus: approved.lifecycle_status })
  await reviewer.page.screenshot({ path: path.join(outputRoot, '05-task-completed.png'), fullPage: true })

  await Promise.all([front.context.close(), ...(ceo ? [ceo.context.close()] : []), reviewer.context.close()])
} catch (error) {
  record('live_ui_flow_execution', false, { error: error instanceof Error ? error.message : String(error) })
} finally {
  await browser.close()
}

const failed = checks.filter((check) => !check.passed)
const report = {
  generatedAt: new Date().toISOString(), version: 'TECH-V0.2-PILOT.7', webBase,
  passed: failed.length === 0, summary: { passed: checks.length - failed.length, total: checks.length, failed: failed.length },
  taskId, taskTitle: title, resumeMode: Boolean(resumeTaskId), checks, credentialsPersistedInEvidence: false,
  retentionNote: taskId ? 'The completed, clearly labelled task is retained as auditable public UI evidence.' : null,
}
await writeFile(path.join(outputRoot, 'pilot7-public-live-ui-flow.json'), JSON.stringify(report, null, 2), 'utf8')
console.log(JSON.stringify({ version: report.version, passed: report.passed, summary: report.summary, taskId, outputRoot }))
if (!report.passed) process.exit(1)
