import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import process from 'node:process'

const require = createRequire(import.meta.url)

export const YILIAN_LOGIN_URL = 'https://pms.ygjpms.com/saas/#/login'

const passwordInputSelector = 'input[placeholder="登录密码"]'

export const yilianLoginSelectors = Object.freeze({
  username: 'input[placeholder="登录账号或绑定手机号"]',
  password: passwordInputSelector,
  submit: 'button.top-login-btn',
  company: '.company-item',
  department: '.department-item',
  shift: '.shift-item',
  shiftConfirm:
    '.el-dialog:has-text("请选择您的班次") button:has-text("确定")',
  message: '.el-message__content, .el-message, [role="alert"]',
  humanVerification:
    'input[placeholder*="验证码"]:visible, input[placeholder*="短信"]:visible, [class*="captcha"]:visible, [class*="slide-verify"]:visible, iframe[src*="captcha"]:visible',
})

const normalizeCredentials = (credentials) => {
  const username = typeof credentials?.username === 'string'
    ? credentials.username.trim()
    : ''
  const password = typeof credentials?.password === 'string'
    ? credentials.password
    : ''
  if (
    username.length < 1
    || username.length > 256
    || password.length < 1
    || password.length > 4096
    || /[\r\n\u0000]/u.test(username)
    || /[\r\n\u0000]/u.test(password)
  ) throw new Error('PMS_LOGIN_CREDENTIALS_INVALID')
  return { username, password }
}

export const isYilianOfficialUrl = (value) => {
  try {
    const url = new URL(value)
    return url.protocol === 'https:'
      && url.hostname === 'pms.ygjpms.com'
      && (
        url.pathname.startsWith('/saas/')
        || url.pathname.startsWith('/login/')
      )
  } catch {
    return false
  }
}

export const isYilianOfficialRequest = (value) => {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && url.hostname === 'pms.ygjpms.com'
  } catch {
    return false
  }
}

export const classifyYilianLoginFailure = (text) => {
  const normalized = String(text ?? '').replace(/\s+/gu, ' ').trim()
  if (/锁定|冻结|次数过多|操作频繁|稍后再试|风险|异常登录|安全限制/u.test(normalized)) {
    return 'YILIAN_RISK_CONTROL_REQUIRED'
  }
  if (/短信|验证码|人机|滑块|二次验证|安全验证|扫码确认|手机确认/u.test(normalized)) {
    return 'YILIAN_HUMAN_AUTHORIZATION_REQUIRED'
  }
  if (/账号或密码|用户名或密码|密码错误|密码不正确|账号不存在|用户不存在|登录失败|登陆失败/u.test(normalized)) {
    return 'YILIAN_CREDENTIALS_REJECTED'
  }
  return 'YILIAN_AUTHENTICATION_NOT_COMPLETED'
}

let cachedChromium = null
const chromiumFor = () => {
  if (cachedChromium) return cachedChromium
  try {
    const module = require(
      process.env.UAT_PLAYWRIGHT_MODULE ?? 'playwright',
    )
    cachedChromium = module.chromium
    return cachedChromium
  } catch {
    throw new Error('YILIAN_BROWSER_RUNTIME_UNAVAILABLE')
  }
}

const browserExecutableFor = () =>
  process.env.YILIAN_BROWSER_EXECUTABLE
  || process.env.UAT_BROWSER_EXECUTABLE
  || process.env.LUOPAN_BROWSER_EXECUTABLE
  || [
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  ].find(existsSync)

const clearPageSecrets = async (page) => {
  await page.evaluate(() => {
    sessionStorage.clear()
    localStorage.clear()
  }).catch(() => {})
  await page.locator(yilianLoginSelectors.username).first().fill('')
    .catch(() => {})
  await page.locator(yilianLoginSelectors.password).first().fill('')
    .catch(() => {})
}

const safeVisibleMessageText = async (page) => {
  const messages = await page.locator(yilianLoginSelectors.message)
    .allTextContents()
    .catch(() => [])
  return messages.join(' ').slice(0, 2_000)
}

const humanVerificationVisible = async (page) => page
  .locator(yilianLoginSelectors.humanVerification)
  .first()
  .isVisible()
  .catch(() => false)

const normalizedSelectionText = (value) =>
  String(value ?? '').replace(/\s+/gu, '').trim()

const visibleOptions = async (page, selector) => {
  const locator = page.locator(selector)
  const options = []
  const count = await locator.count().catch(() => 0)
  for (let index = 0; index < count; index += 1) {
    const option = locator.nth(index)
    if (!await option.isVisible().catch(() => false)) continue
    options.push({
      option,
      text: normalizedSelectionText(
        await option.innerText().catch(() => ''),
      ),
    })
  }
  return options
}

const waitForSelectionStep = async (
  page,
  timeoutMs,
  candidates = [
    yilianLoginSelectors.company,
    yilianLoginSelectors.department,
    yilianLoginSelectors.shift,
  ],
) => {
  try {
    return await Promise.any(candidates.map((selector) => page.locator(selector)
      .first()
      .waitFor({ state: 'visible', timeout: timeoutMs })
      .then(() => selector)))
  } catch {
    return null
  }
}

const chooseCompany = async (page, expectedHotelName) => {
  const options = await visibleOptions(page, yilianLoginSelectors.company)
  if (options.length === 0) return false
  const expected = normalizedSelectionText(expectedHotelName)
  const matches = expected
    ? options.filter(({ text }) => text.includes(expected))
    : []
  const selected = matches.length === 1
    ? matches[0]
    : options.length === 1
      ? options[0]
      : null
  if (!selected) throw new Error('YILIAN_HOTEL_SELECTION_AMBIGUOUS')
  await selected.option.click()
  return true
}

const chooseHotelDepartment = async (page) => {
  const options = await visibleOptions(page, yilianLoginSelectors.department)
  if (options.length === 0) return false
  const hotelOptions = options.filter(({ text }) => /酒店|Hotel|客房/iu.test(text))
  const selected = hotelOptions.length === 1
    ? hotelOptions[0]
    : options.length === 1
      ? options[0]
      : null
  if (!selected) throw new Error('YILIAN_DEPARTMENT_SELECTION_AMBIGUOUS')
  await selected.option.click()
  return true
}

const completeHotelSystemSelection = async ({
  page,
  intermediateToken,
  expectedHotelName,
  timeoutMs,
}) => {
  let step = await waitForSelectionStep(page, timeoutMs)
  if (step === yilianLoginSelectors.company) {
    await chooseCompany(page, expectedHotelName)
    step = await waitForSelectionStep(page, timeoutMs, [
      yilianLoginSelectors.department,
      yilianLoginSelectors.shift,
    ])
  }
  if (step === yilianLoginSelectors.department) {
    await chooseHotelDepartment(page)
  }
  await page.locator(yilianLoginSelectors.shift).first()
    .waitFor({ state: 'visible', timeout: timeoutMs })
    .catch(() => { throw new Error('YILIAN_SHIFT_SELECTION_UNAVAILABLE') })
  await page.locator(yilianLoginSelectors.shiftConfirm).first().click()
  await page.waitForFunction(
    (previousToken) => {
      const current = String(sessionStorage.getItem('token') ?? '').trim()
      return current.length >= 16 && current !== previousToken
    },
    intermediateToken,
    { timeout: timeoutMs },
  ).catch(() => { throw new Error('YILIAN_CONFIRM_LOGIN_TIMEOUT') })
}

export const startYilianPasswordLogin = async ({
  credentials,
  expectedHotelName = '',
  chromium = null,
  executablePath = null,
  executableExists = existsSync,
  timeoutMs = 30_000,
} = {}) => {
  const normalized = normalizeCredentials(credentials)
  const browserType = chromium ?? chromiumFor()
  const browserExecutable = executablePath ?? browserExecutableFor()
  if (!browserExecutable || !executableExists(browserExecutable)) {
    throw new Error('YILIAN_BROWSER_NOT_FOUND')
  }

  let browser = null
  let context = null
  let page = null
  try {
    browser = await browserType.launch({
      headless: true,
      executablePath: browserExecutable,
      chromiumSandbox: true,
      args: [
        '--disable-dev-shm-usage',
        '--disable-background-networking',
        '--disable-default-apps',
        '--disable-extensions',
        '--disable-features=PasswordManagerOnboarding,PasswordLeakDetection',
        '--disable-save-password-bubble',
        '--disable-sync',
        '--no-default-browser-check',
        '--no-first-run',
      ],
    })
    context = await browser.newContext({
      acceptDownloads: false,
      locale: 'zh-CN',
      serviceWorkers: 'block',
      timezoneId: 'Asia/Shanghai',
      viewport: { width: 1440, height: 960 },
    })
    context.setDefaultTimeout(timeoutMs)
    await context.route('**/*', async (route) => {
      if (isYilianOfficialRequest(route.request().url())) {
        await route.continue()
      } else {
        await route.abort('blockedbyclient')
      }
    })
    page = await context.newPage()
    page.on('dialog', (dialog) => { void dialog.dismiss().catch(() => {}) })
    await page.goto(YILIAN_LOGIN_URL, {
      waitUntil: 'domcontentloaded',
      timeout: timeoutMs,
    })
    if (!isYilianOfficialUrl(page.url())) {
      throw new Error('YILIAN_LOGIN_ORIGIN_INVALID')
    }

    const usernameInput = page.locator(yilianLoginSelectors.username).first()
    const passwordInput = page.locator(yilianLoginSelectors.password).first()
    const submitButton = page.locator(yilianLoginSelectors.submit).first()
    await usernameInput.waitFor({ state: 'visible', timeout: timeoutMs })
      .catch(() => { throw new Error('YILIAN_LOGIN_FORM_UNAVAILABLE') })
    await passwordInput.waitFor({ state: 'visible', timeout: timeoutMs })
      .catch(() => { throw new Error('YILIAN_LOGIN_FORM_UNAVAILABLE') })
    await usernameInput.fill(normalized.username)
    await passwordInput.fill(normalized.password)
    await submitButton.click()

    await Promise.race([
      page.waitForFunction(
        () => String(sessionStorage.getItem('token') ?? '').trim().length >= 16,
        null,
        { timeout: timeoutMs },
      ).catch(() => null),
      page.locator(yilianLoginSelectors.message).first()
        .waitFor({ state: 'visible', timeout: timeoutMs })
        .catch(() => null),
      page.locator(yilianLoginSelectors.humanVerification).first()
        .waitFor({ state: 'visible', timeout: timeoutMs })
        .catch(() => null),
    ])
    if (!isYilianOfficialUrl(page.url())) {
      throw new Error('YILIAN_LOGIN_ORIGIN_INVALID')
    }
    const intermediateToken = await page.evaluate(
      () => String(sessionStorage.getItem('token') ?? '').trim(),
    )
    if (!intermediateToken) {
      if (await humanVerificationVisible(page)) {
        throw new Error('YILIAN_HUMAN_AUTHORIZATION_REQUIRED')
      }
      throw new Error(classifyYilianLoginFailure(
        await safeVisibleMessageText(page),
      ))
    }
    await completeHotelSystemSelection({
      page,
      intermediateToken,
      expectedHotelName,
      timeoutMs,
    })
    if (!isYilianOfficialUrl(page.url())) {
      throw new Error('YILIAN_LOGIN_ORIGIN_INVALID')
    }
    const accessToken = await page.evaluate(
      () => String(sessionStorage.getItem('token') ?? '').trim(),
    )
    if (!accessToken || accessToken === intermediateToken) {
      throw new Error('YILIAN_AUTHENTICATION_NOT_COMPLETED')
    }
    return { accessToken }
  } catch (error) {
    const code = typeof error?.message === 'string' ? error.message : ''
    if (code.startsWith('YILIAN_') || code.startsWith('PMS_LOGIN_')) throw error
    if (/Timeout .* exceeded|timed out/iu.test(code)) {
      throw new Error('YILIAN_LOGIN_TIMEOUT')
    }
    throw new Error('YILIAN_BROWSER_LOGIN_FAILED')
  } finally {
    normalized.username = ''
    normalized.password = ''
    if (page) await clearPageSecrets(page)
    await context?.close().catch(() => {})
    await browser?.close().catch(() => {})
  }
}
