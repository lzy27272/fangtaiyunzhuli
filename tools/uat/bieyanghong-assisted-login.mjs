import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import process from 'node:process'

const require = createRequire(import.meta.url)
const LOGIN_URL = 'https://pms.meituan.com/pms-web/account/login'
const PMS_ORIGIN = 'https://pms.meituan.com/'
const REQUIRED_COOKIE_NAMES = Object.freeze([
  '_lxsdk_cuid',
  'hotelpms_login_hotel_id',
  'hotelpms_login_org_id',
  'hotelpms_tenant_id',
  'hotelpms_token',
])

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
    throw new Error('BIEYANGHONG_BROWSER_RUNTIME_UNAVAILABLE')
  }
}

const browserExecutableFor = () =>
  process.env.BIEYANGHONG_BROWSER_EXECUTABLE
  || process.env.UAT_BROWSER_EXECUTABLE
  || process.env.LUOPAN_BROWSER_EXECUTABLE
  || [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  ].find(existsSync)

export const bieyanghongLoginSelectors = Object.freeze({
  loginFrameUrl: 'eepassport.meituan.com/portal/login',
  accountLoginTab: '.ep-tab_item',
  account: '#login, input[placeholder="输入账号"]',
  password: '#password, input[placeholder="输入密码"]',
  phone: '#phone, input[placeholder="输入手机号"]',
  smsCode: 'input[placeholder="输入验证码"]',
  agreement: 'label[for="checkbox"]',
  agreementInput: '#checkbox',
  requestCode: '.timer-button',
  accountCard: '.account-card',
})

const VISUAL_KEYS = new Set([
  'Backspace',
  'Tab',
  'Enter',
  'Escape',
  'ArrowLeft',
  'ArrowRight',
  'ArrowUp',
  'ArrowDown',
])

const visualCoordinate = (value) =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1
    ? value
    : null

export const normalizeBieyanghongVisualInteraction = (input) => {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('BIEYANGHONG_VISUAL_INTERACTION_INVALID')
  }
  if (input.kind === 'tap') {
    const x = visualCoordinate(input.x)
    const y = visualCoordinate(input.y)
    if (x === null || y === null) {
      throw new Error('BIEYANGHONG_VISUAL_INTERACTION_INVALID')
    }
    return { kind: 'tap', x, y }
  }
  if (input.kind === 'drag') {
    const fromX = visualCoordinate(input.fromX)
    const fromY = visualCoordinate(input.fromY)
    const toX = visualCoordinate(input.toX)
    const toY = visualCoordinate(input.toY)
    if ([fromX, fromY, toX, toY].includes(null)) {
      throw new Error('BIEYANGHONG_VISUAL_INTERACTION_INVALID')
    }
    const durationMs = Number.isInteger(input.durationMs)
      ? Math.max(250, Math.min(1_500, input.durationMs))
      : 650
    return { kind: 'drag', fromX, fromY, toX, toY, durationMs }
  }
  if (input.kind === 'text') {
    const value = typeof input.value === 'string' ? input.value : ''
    if (!value || value.length > 64 || /[\r\n\u0000]/u.test(value)) {
      throw new Error('BIEYANGHONG_VISUAL_INTERACTION_INVALID')
    }
    return { kind: 'text', value }
  }
  if (input.kind === 'key' && VISUAL_KEYS.has(input.key)) {
    return { kind: 'key', key: input.key }
  }
  throw new Error('BIEYANGHONG_VISUAL_INTERACTION_INVALID')
}

const loginFrameFor = async (page, timeoutMs = 20_000) => {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const frame = page.frames().find((candidate) =>
      candidate.url().includes(bieyanghongLoginSelectors.loginFrameUrl))
    if (frame) return frame
    await page.waitForTimeout(250)
  }
  throw new Error('BIEYANGHONG_LOGIN_FORM_UNAVAILABLE')
}

const cookiesToHeader = (cookies) =>
  cookies
    .filter((cookie) =>
      /(^|\.)meituan\.com$/iu.test(String(cookie.domain ?? '')))
    .sort((left, right) => left.name.localeCompare(right.name))
    .map((cookie) => `${cookie.name}=${cookie.value}`)
    .join('; ')

export const bieyanghongCookieHeaderValid = (cookieHeader) => {
  const names = new Set(
    String(cookieHeader ?? '')
      .split(';')
      .map((part) => part.trim().split('=', 1)[0])
      .filter(Boolean),
  )
  return REQUIRED_COOKIE_NAMES.every((name) => names.has(name))
}

const captureCookieHeader = async (context) => {
  const header = cookiesToHeader(await context.cookies(PMS_ORIGIN))
  if (!bieyanghongCookieHeaderValid(header)) {
    throw new Error('BIEYANGHONG_SESSION_COOKIE_INVALID')
  }
  return header
}

const officialInteractivePage = (context, fallbackPage) => {
  const active = context.pages().filter((candidate) => !candidate.isClosed())
  const page = active.at(-1) ?? fallbackPage
  let url
  try {
    url = new URL(page.url())
  } catch {
    throw new Error('BIEYANGHONG_VISUAL_PAGE_UNAVAILABLE')
  }
  if (
    url.protocol !== 'https:'
    || !/(^|\.)meituan\.com$/iu.test(url.hostname)
  ) {
    throw new Error('BIEYANGHONG_VISUAL_NAVIGATION_BLOCKED')
  }
  return page
}

const pageText = (frame) =>
  frame.locator('body').innerText().catch(() => '')

// Meituan's login controls are React-managed. In the production headless
// browser a synthetic Playwright click can leave the control visually
// unchanged, so prefer the vendor control's own React handler and fall back to
// a normal click only when that handler is unavailable.
const clickVendorControl = async (locator) => {
  const reactHandled = await locator.evaluate((element) => {
    const key = Object.keys(element)
      .find((candidate) => candidate.startsWith('__reactProps'))
    const onClick = key ? element[key]?.onClick : null
    if (typeof onClick !== 'function') return false
    onClick()
    return true
  }).catch(() => false)
  if (!reactHandled) await locator.click()
}

const smsFailureReason = (text) => {
  if (/操作频繁|过于频繁|稍后再试|次数过多|达到上限/u.test(text)) {
    return 'BIEYANGHONG_SMS_RATE_LIMITED'
  }
  if (/安全验证|滑块|拖动.*验证|请完成验证/u.test(text)) {
    return 'BIEYANGHONG_LOGIN_RISK_CHALLENGE_REQUIRED'
  }
  if (/手机号.{0,8}(错误|无效|不存在)|请输入正确.*手机号/u.test(text)) {
    return 'BIEYANGHONG_LOGIN_ACCOUNT_REJECTED'
  }
  return null
}

const loginFailureReason = (text) => {
  if (/验证码.{0,8}(错误|不正确|失效|过期)|请输入.*验证码/u.test(text)) {
    return 'BIEYANGHONG_SMS_CODE_REJECTED'
  }
  return smsFailureReason(text)
    ?? 'BIEYANGHONG_AUTHENTICATION_NOT_COMPLETED'
}

const credentialFailureReason = (text) => {
  if (
    /账号或密码.{0,8}(错误|不正确)|密码.{0,8}(错误|不正确)|账号.{0,8}(不存在|无效)|登录失败/u
      .test(text)
  ) {
    return 'BIEYANGHONG_LOGIN_CREDENTIALS_REJECTED'
  }
  return smsFailureReason(text)
}

const selectAccountLogin = async (page, initialFrame) => {
  const deadline = Date.now() + 6_000
  let frame = initialFrame
  let nativeAttempted = false
  let reactAttempted = false
  while (Date.now() < deadline) {
    frame = page.frames().find((candidate) =>
      candidate.url().includes(bieyanghongLoginSelectors.loginFrameUrl))
      ?? frame
    const password = frame
      .locator(bieyanghongLoginSelectors.password)
      .first()
    if (await password.isVisible().catch(() => false)) return frame
    const accountTab = frame
      .locator(bieyanghongLoginSelectors.accountLoginTab)
      .filter({ hasText: '账号登录' })
      .first()
    if (!nativeAttempted) {
      nativeAttempted = true
      await accountTab.click().catch(() => {})
    } else if (!reactAttempted) {
      reactAttempted = true
      // The vendor page can ignore synthetic tab clicks in headless Chrome.
      // Invoke the same React handler, then reacquire the iframe because the
      // tab switch may replace it.
      await accountTab.evaluate((element) => {
        const key = Object.keys(element)
          .find((candidate) => candidate.startsWith('__reactProps'))
        const onClick = key ? element[key]?.onClick : null
        if (typeof onClick !== 'function') {
          throw new Error('TAB_HANDLER_MISSING')
        }
        onClick({ preventDefault() {} })
      }).catch(() => {})
    }
    await page.waitForTimeout(250)
  }
  throw new Error('BIEYANGHONG_ACCOUNT_LOGIN_FORM_UNAVAILABLE')
}

const ensureAgreement = async (frame) => {
  const input = frame.locator(bieyanghongLoginSelectors.agreementInput).first()
  if (await input.isChecked().catch(() => false)) return
  await frame.locator(bieyanghongLoginSelectors.agreement).first()
    .click()
    .catch(() => {})
  if (await input.isChecked().catch(() => false)) return
  await input.evaluate((element) => {
    const key = Object.keys(element)
      .find((candidate) => candidate.startsWith('__reactProps'))
    const onChange = key ? element[key]?.onChange : null
    if (typeof onChange !== 'function') {
      throw new Error('AGREEMENT_HANDLER_MISSING')
    }
    onChange({ target: { checked: true } })
  }).catch(() => {})
  if (!(await input.isChecked().catch(() => false))) {
    throw new Error('BIEYANGHONG_LOGIN_AGREEMENT_UNAVAILABLE')
  }
}

const clearCredentialFields = async (frame) => {
  await frame.locator(bieyanghongLoginSelectors.account).first()
    .fill('')
    .catch(() => {})
  await frame.locator(bieyanghongLoginSelectors.password).first()
    .fill('')
    .catch(() => {})
}

export const prepareBieyanghongSmsLogin = async ({
  page,
  phone,
}) => {
  if (!/^\d{11}$/u.test(String(phone ?? ''))) {
    throw new Error('BIEYANGHONG_LOGIN_PHONE_INVALID')
  }
  await page.goto(LOGIN_URL, {
    waitUntil: 'domcontentloaded',
    timeout: 45_000,
  })
  const frame = await loginFrameFor(page)
  try {
    await frame.locator(bieyanghongLoginSelectors.phone).first().fill(phone)
    const checked = await frame
      .locator(bieyanghongLoginSelectors.agreementInput)
      .first()
      .isChecked()
      .catch(() => false)
    if (!checked) {
      await frame.locator(bieyanghongLoginSelectors.agreement).first().click()
    }
    await frame.locator(bieyanghongLoginSelectors.requestCode).first().click()
    await frame.waitForTimeout(1_500)
  } catch {
    throw new Error('BIEYANGHONG_LOGIN_FORM_UNAVAILABLE')
  }
  const text = await pageText(frame)
  const reasonCode = smsFailureReason(text)
  if (reasonCode) throw new Error(reasonCode)
  return frame
}

export const prepareBieyanghongCredentialLogin = async ({
  page,
  context,
  phone,
  password,
}) => {
  if (
    !/^\d{11}$/u.test(String(phone ?? ''))
    || typeof password !== 'string'
    || password.length < 1
    || password.length > 256
    || /[\r\n\u0000]/u.test(password)
  ) {
    throw new Error('BIEYANGHONG_LOGIN_CREDENTIALS_INVALID')
  }
  await page.goto(LOGIN_URL, {
    waitUntil: 'domcontentloaded',
    timeout: 45_000,
  })
  let frame = await loginFrameFor(page)
  frame = await selectAccountLogin(page, frame)
  try {
    await frame.locator(bieyanghongLoginSelectors.account).first().fill(phone)
    await frame.locator(bieyanghongLoginSelectors.password).first()
      .fill(password)
    await ensureAgreement(frame)
    await clickVendorControl(
      frame.getByText('登录', { exact: true }).last(),
    )
  } catch (error) {
    await clearCredentialFields(frame)
    if (String(error?.message ?? '').startsWith('BIEYANGHONG_')) throw error
    throw new Error('BIEYANGHONG_ACCOUNT_LOGIN_FORM_UNAVAILABLE')
  }

  const deadline = Date.now() + 30_000
  let activeFrame = frame
  while (Date.now() < deadline) {
    activeFrame = page.frames().find((candidate) =>
      candidate.url().includes(bieyanghongLoginSelectors.loginFrameUrl))
      ?? activeFrame
    const cookieHeader = await captureCookieHeader(context).catch(() => null)
    if (cookieHeader) {
      await clearCredentialFields(activeFrame)
      return { alreadyAuthenticated: true, cookieHeader, frame: activeFrame }
    }
    const text = await pageText(activeFrame)
    const reasonCode = credentialFailureReason(text)
    if (reasonCode) {
      if (reasonCode === 'BIEYANGHONG_LOGIN_RISK_CHALLENGE_REQUIRED') {
        return {
          alreadyAuthenticated: false,
          interactiveVerificationRequired: true,
          interactiveReasonCode: reasonCode,
          frame: activeFrame,
        }
      }
      await clearCredentialFields(activeFrame)
      throw new Error(reasonCode)
    }
    if (/选择账号/u.test(text)) {
      const accountCards = activeFrame
        .locator(bieyanghongLoginSelectors.accountCard)
      const accountCardCount = await accountCards.count().catch(() => 0)
      if (accountCardCount === 1) {
        await clickVendorControl(accountCards.first())
        await page.waitForTimeout(500)
        continue
      }
      return {
        alreadyAuthenticated: false,
        interactiveVerificationRequired: true,
        interactiveReasonCode: 'BIEYANGHONG_ACCOUNT_SELECTION_REQUIRED',
        frame: activeFrame,
      }
    }
    const smsCode = activeFrame
      .locator(bieyanghongLoginSelectors.smsCode)
      .first()
    if (await smsCode.isVisible().catch(() => false)) {
      const phoneInput = activeFrame
        .locator(bieyanghongLoginSelectors.phone)
        .first()
      if (await phoneInput.isVisible().catch(() => false)) {
        await phoneInput.fill(phone)
      }
      await ensureAgreement(activeFrame)
      const requestCode = activeFrame
        .locator(bieyanghongLoginSelectors.requestCode)
        .first()
      let requestConfirmed = false
      if (await requestCode.isVisible().catch(() => false)) {
        const codeButtonText = await requestCode.innerText().catch(() => '')
        const className = await requestCode.getAttribute('class').catch(() => '')
        requestConfirmed =
          /\d+秒后|重新获取/u.test(codeButtonText)
          && String(className ?? '').includes('disabled')
        if (!requestConfirmed && (
          /获取验证码|重新获取/u.test(codeButtonText)
          && !String(className ?? '').includes('disabled')
        )) {
          await clickVendorControl(requestCode)
          await activeFrame.waitForTimeout(2_500)
          const updatedText = await requestCode.innerText().catch(() => '')
          const updatedClass = await requestCode
            .getAttribute('class')
            .catch(() => '')
          requestConfirmed =
            /\d+秒后/u.test(updatedText)
            || String(updatedClass ?? '').includes('disabled')
        }
      }
      const smsText = await pageText(activeFrame)
      const smsReasonCode = smsFailureReason(smsText)
      if (smsReasonCode === 'BIEYANGHONG_LOGIN_RISK_CHALLENGE_REQUIRED') {
        return {
          alreadyAuthenticated: false,
          interactiveVerificationRequired: true,
          interactiveReasonCode: smsReasonCode,
          frame: activeFrame,
        }
      }
      await clearCredentialFields(activeFrame)
      if (smsReasonCode) throw new Error(smsReasonCode)
      if (!requestConfirmed) {
        throw new Error('BIEYANGHONG_SMS_REQUEST_NOT_CONFIRMED')
      }
      return { alreadyAuthenticated: false, frame: activeFrame }
    }
    await page.waitForTimeout(500)
  }
  await clearCredentialFields(activeFrame)
  throw new Error('BIEYANGHONG_AUTHENTICATION_NOT_COMPLETED')
}

export const startBieyanghongAssistedLogin = async ({
  profileRoot,
  phone,
  password,
  chromium = chromiumFor(),
  browserExecutable = browserExecutableFor(),
}) => {
  if (
    typeof profileRoot !== 'string'
    || !profileRoot
    || !/^\d{11}$/u.test(String(phone ?? ''))
    || typeof password !== 'string'
    || password.length < 1
    || password.length > 256
  ) {
    throw new Error('BIEYANGHONG_LOGIN_CONFIGURATION_INVALID')
  }
  const context = await chromium.launchPersistentContext(profileRoot, {
    headless: true,
    executablePath: browserExecutable,
    acceptDownloads: false,
    locale: 'zh-CN',
    timezoneId: 'Asia/Shanghai',
    args: [
      '--disable-dev-shm-usage',
      '--disable-background-networking',
      '--disable-default-apps',
      '--disable-extensions',
      '--disable-sync',
      '--no-first-run',
      '--no-sandbox',
    ],
  })
  const page = context.pages()[0] ?? await context.newPage()
  await context.route('**/*', async (route) => {
    const request = route.request()
    if (request.isNavigationRequest()) {
      const frame = request.frame()
      const topLevel = frame === frame.page().mainFrame()
      if (topLevel) {
        let destination
        try {
          destination = new URL(request.url())
        } catch {
          await route.abort()
          return
        }
        if (
          destination.protocol !== 'https:'
          || !/(^|\.)meituan\.com$/iu.test(destination.hostname)
        ) {
          await route.abort()
          return
        }
      }
    }
    await route.continue()
  })
  let closed = false
  let visualInteractionCount = 0
  const close = async () => {
    if (closed) return
    closed = true
    await context.close().catch(() => {})
  }
  try {
    const existingCookieHeader = await captureCookieHeader(context)
      .catch(() => null)
    if (existingCookieHeader) {
      phone = null
      password = null
      return {
        alreadyAuthenticated: true,
        cookieHeader: existingCookieHeader,
        close,
      }
    }

    const prepared = await prepareBieyanghongCredentialLogin({
      page,
      context,
      phone,
      password,
    })
    phone = null
    password = null
    if (prepared.alreadyAuthenticated) {
      return {
        alreadyAuthenticated: true,
        cookieHeader: prepared.cookieHeader,
        close,
      }
    }
    const captureVisualState = async () => {
      if (closed) throw new Error('BIEYANGHONG_REPAIR_CHALLENGE_CLOSED')
      const cookieHeader = await captureCookieHeader(context).catch(() => null)
      if (cookieHeader) return { authenticated: true, cookieHeader }
      const activePage = officialInteractivePage(context, page)
      await activePage.bringToFront()
      const image = await activePage.screenshot({
        type: 'png',
        animations: 'disabled',
        caret: 'hide',
      })
      const viewport = activePage.viewportSize() ?? { width: 1280, height: 720 }
      return {
        authenticated: false,
        image,
        width: viewport.width,
        height: viewport.height,
      }
    }
    const interactVisually = async (input) => {
      if (closed) throw new Error('BIEYANGHONG_REPAIR_CHALLENGE_CLOSED')
      visualInteractionCount += 1
      if (visualInteractionCount > 120) {
        throw new Error('BIEYANGHONG_VISUAL_INTERACTION_LIMIT_REACHED')
      }
      const action = normalizeBieyanghongVisualInteraction(input)
      const activePage = officialInteractivePage(context, page)
      await activePage.bringToFront()
      const viewport = activePage.viewportSize() ?? { width: 1280, height: 720 }
      const point = (x, y) => ({
        x: Math.round(x * viewport.width),
        y: Math.round(y * viewport.height),
      })
      if (action.kind === 'tap') {
        const target = point(action.x, action.y)
        await activePage.mouse.click(target.x, target.y)
      } else if (action.kind === 'drag') {
        const from = point(action.fromX, action.fromY)
        const to = point(action.toX, action.toY)
        await activePage.mouse.move(from.x, from.y)
        await activePage.mouse.down()
        const steps = 16
        for (let step = 1; step <= steps; step += 1) {
          await activePage.mouse.move(
            from.x + ((to.x - from.x) * step / steps),
            from.y + ((to.y - from.y) * step / steps),
          )
          await activePage.waitForTimeout(Math.ceil(action.durationMs / steps))
        }
        await activePage.mouse.up()
      } else if (action.kind === 'text') {
        await activePage.keyboard.insertText(action.value)
      } else {
        await activePage.keyboard.press(action.key)
      }
      await activePage.waitForTimeout(350)
      const cookieHeader = await captureCookieHeader(context).catch(() => null)
      return cookieHeader
        ? { authenticated: true, cookieHeader }
        : { authenticated: false }
    }
    const frame = prepared.frame
    return {
      alreadyAuthenticated: false,
      interactiveVerificationRequired:
        prepared.interactiveVerificationRequired === true,
      interactiveReasonCode: prepared.interactiveReasonCode ?? null,
      close,
      captureVisualState,
      interactVisually,
      submit: async (code) => {
        if (closed) {
          throw new Error('BIEYANGHONG_REPAIR_CHALLENGE_CLOSED')
        }
        if (!/^\d{4,8}$/u.test(String(code ?? ''))) {
          throw new Error('BIEYANGHONG_REPAIR_CODE_INVALID')
        }
        await frame.locator(bieyanghongLoginSelectors.smsCode)
          .first()
          .fill(String(code))
        await clickVendorControl(
          frame.getByText('登录', { exact: true }).last(),
        )

        const deadline = Date.now() + 35_000
        while (Date.now() < deadline) {
          const cookieHeader = await captureCookieHeader(context)
            .catch(() => null)
          if (cookieHeader) {
            return { authenticated: true, cookieHeader }
          }
          const text = await pageText(frame)
          const reasonCode = loginFailureReason(text)
          if (reasonCode !== 'BIEYANGHONG_AUTHENTICATION_NOT_COMPLETED') {
            return { authenticated: false, reasonCode }
          }
          await page.waitForTimeout(500)
        }
        return {
          authenticated: false,
          reasonCode: 'BIEYANGHONG_AUTHENTICATION_TIMEOUT',
        }
      },
    }
  } catch (error) {
    phone = null
    password = null
    await close()
    throw error
  }
}
