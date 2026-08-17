import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { chromium } from 'playwright'

const outputPath = resolve(process.env.KPI_JY07_UI_SCREENSHOT
  ?? '.uat-runtime/ota-review/kpi-jy07-official-ui.png')
mkdirSync(dirname(outputPath), { recursive: true })

const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.UAT_BROWSER_EXECUTABLE
    ?? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
})

try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } })
  await page.goto('http://127.0.0.1:4180/#/', { waitUntil: 'networkidle' })
  const inputs = page.locator('input')
  await inputs.nth(0).fill('sfglzy')
  await inputs.nth(1).fill(String.fromCharCode(49, 49, 49, 49, 49, 49))
  await page.locator('button.login-submit').click()
  await page.waitForURL(/#\/kpi(?:$|\?)/, { timeout: 15_000 })
  await page.getByRole('button', { name: '岗位模板', exact: true }).click()
  await page.waitForURL(/#\/kpi\/templates/, { timeout: 15_000 })

  const templateCard = page.locator('article').filter({
    has: page.getByRole('heading', { name: '前台KPI考核模板', exact: true }),
  })
  await templateCard.getByRole('button', { name: '查看/修改草稿', exact: true }).click()
  await page.waitForURL(/#\/kpi\/templates\//, { timeout: 15_000 })
  await page.getByRole('heading', { name: 'OTA / PMS 上月数据一键试算', exact: true })
    .waitFor({ timeout: 15_000 })

  const monthInput = page.locator('input[type="month"]')
  await monthInput.fill('2026-08')
  await page.getByRole('button', { name: '读取上月并试算', exact: true }).click()
  await page.getByText('正式可计分', { exact: true }).waitFor({ timeout: 20_000 })
  await page.getByText('98.97%', { exact: true }).first().waitFor({ timeout: 10_000 })
  await page.getByText(/正式8\/10分/).waitFor({ timeout: 10_000 })

  const body = await page.locator('body').innerText()
  const result = {
    urlHash: new URL(page.url()).hash,
    hasOfficialState: body.includes('正式可计分'),
    hasOccupancyValue: body.includes('98.97%'),
    hasOfficialScore: body.includes('正式8/10分'),
    hasJy07Evidence: body.includes('JY07经理报表(月报)(固化)'),
    hasHourlyRoomExclusion: body.includes('不计钟点房'),
    hasCandidateLabel: body.includes('候选得分（口径待验收）'),
    hasVerifiedMetricState: body.includes('AVAILABLE'),
    hasMetricWarningState: body.includes('AVAILABLE_WITH_WARNING'),
  }
  await page.screenshot({ path: outputPath, fullPage: true })
  process.stdout.write(`${JSON.stringify({ ...result, screenshot: outputPath })}\n`)
  if (
    !result.hasOfficialState
    || !result.hasOccupancyValue
    || !result.hasOfficialScore
    || !result.hasJy07Evidence
    || !result.hasHourlyRoomExclusion
    || !result.hasVerifiedMetricState
    || result.hasCandidateLabel
    || result.hasMetricWarningState
  ) process.exitCode = 1
} finally {
  await browser.close()
}
