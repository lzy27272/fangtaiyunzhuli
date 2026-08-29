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
  phone: '#phone, input[placeholder="输入手机号"]',
  smsCode: 'input[placeholder="输入验证码"]',
  agreement: 'label[for="checkbox"]',
  agreementInput: '#checkbox',
  requestCode: '.timer-button',
})

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

const pageText = (frame) =>
  frame.locator('body').innerText().catch(() => '')

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

export const startBieyanghongAssistedLogin = async ({
  profileRoot,
  credentials,
  chromium = chromiumFor(),
  browserExecutable = browserExecutableFor(),
}) => {
  if (
    typeof profileRoot !== 'string'
    || !profileRoot
    || !credentials
    || !/^\d{11}$/u.test(String(credentials.username ?? ''))
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
  let closed = false
  const close = async () => {
    if (closed) return
    closed = true
    await context.close().catch(() => {})
  }
  try {
    const existingCookieHeader = await captureCookieHeader(context)
      .catch(() => null)
    if (existingCookieHeader) {
      return {
        alreadyAuthenticated: true,
        cookieHeader: existingCookieHeader,
        close,
      }
    }

    const frame = await prepareBieyanghongSmsLogin({
      page,
      phone: credentials.username,
    })
    credentials = null
    return {
      alreadyAuthenticated: false,
      close,
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
        await frame.getByText('登录', { exact: true }).last().click()

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
    credentials = null
    await close()
    throw error
  }
}
