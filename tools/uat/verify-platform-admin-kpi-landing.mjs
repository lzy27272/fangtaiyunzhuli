import { chromium } from 'playwright'

const browser = await chromium.launch({
  headless: true,
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
})
try {
  const page = await browser.newPage()
  await page.goto('http://127.0.0.1:4180/#/', { waitUntil: 'networkidle' })
  const inputs = page.locator('input')
  await inputs.nth(0).fill('sfglzy')
  const password = String.fromCharCode(49, 49, 49, 49, 49, 49)
  await inputs.nth(1).fill(password)
  await page.locator('button.login-submit').click()
  await page.waitForURL(/#\/kpi(?:$|\?)/, { timeout: 15_000 })
  await page.waitForLoadState('networkidle')
  await page.waitForTimeout(1_000)
  const body = await page.locator('body').innerText()
  const result = {
    urlHash: new URL(page.url()).hash,
    hasKpiCenter: body.includes('KPI考核与绩效复盘中心'),
    hasIdentityError: body.includes('身份接口异常'),
    hasFrontDeskWorkbench: body.includes('前台员工工作台'),
    hasAssignmentSelector: body.includes('当前任职'),
  }
  process.stdout.write(`${JSON.stringify(result)}\n`)
  if (
    result.urlHash !== '#/kpi'
    || !result.hasKpiCenter
    || result.hasIdentityError
    || result.hasFrontDeskWorkbench
    || result.hasAssignmentSelector
  ) process.exitCode = 1
} finally {
  await browser.close()
}
