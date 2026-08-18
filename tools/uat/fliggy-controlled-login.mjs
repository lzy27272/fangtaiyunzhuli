import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import process from 'node:process'

const require = createRequire(import.meta.url)
const FLIGGY_PORTAL_URL =
  'https://hotel.fliggy.com/ebooking/hotelBaseInfoUv.htm#/ebk/order/listV2'
const FLIGGY_LOGIN_HOST = 'hotel.fliggy.com'
const SESSION_COOKIE_DOMAINS = Object.freeze([
  'fliggy.com',
  'taobao.com',
  'tmall.com',
  'alibaba.com',
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
    throw new Error('OTA_FLIGGY_BROWSER_RUNTIME_UNAVAILABLE')
  }
}

const browserExecutableFor = () =>
  process.env.FLIGGY_BROWSER_EXECUTABLE
  || process.env.UAT_BROWSER_EXECUTABLE
  || [
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  ].find(existsSync)

const boundedText = (value, minimum, maximum) =>
  typeof value === 'string'
  && value.length >= minimum
  && value.length <= maximum
  && !/[\r\n\u0000]/.test(value)

const allowedCookieDomain = (value) => {
  const domain = String(value ?? '').trim().toLowerCase().replace(/^\./, '')
  return SESSION_COOKIE_DOMAINS.some(
    (allowed) => domain === allowed || domain.endsWith(`.${allowed}`),
  )
}

export const normalizeFliggySessionState = (candidate) => {
  if (
    !candidate
    || typeof candidate !== 'object'
    || Array.isArray(candidate)
    || !Array.isArray(candidate.cookies)
    || candidate.cookies.length < 1
    || candidate.cookies.length > 200
  ) {
    throw new Error('OTA_FLIGGY_SESSION_STATE_INVALID')
  }
  const cookies = candidate.cookies
    .filter((cookie) => allowedCookieDomain(cookie?.domain))
    .map((cookie) => {
      if (
        !cookie
        || typeof cookie !== 'object'
        || Array.isArray(cookie)
        || !boundedText(cookie.name, 1, 256)
        || !boundedText(cookie.value, 0, 8192)
        || !boundedText(cookie.domain, 1, 512)
        || !boundedText(cookie.path, 1, 1024)
        || !String(cookie.path).startsWith('/')
        || !Number.isFinite(cookie.expires)
        || typeof cookie.httpOnly !== 'boolean'
        || typeof cookie.secure !== 'boolean'
        || !['Strict', 'Lax', 'None'].includes(cookie.sameSite)
      ) {
        throw new Error('OTA_FLIGGY_SESSION_STATE_INVALID')
      }
      return {
        name: cookie.name,
        value: cookie.value,
        domain: String(cookie.domain).trim().toLowerCase(),
        path: cookie.path,
        expires: cookie.expires,
        httpOnly: cookie.httpOnly,
        secure: cookie.secure,
        sameSite: cookie.sameSite,
      }
    })
  if (cookies.length < 1) {
    throw new Error('OTA_FLIGGY_SESSION_STATE_INVALID')
  }
  return { cookies }
}

const cookieMatchesHost = (cookie, host) => {
  const domain = cookie.domain.replace(/^\./, '')
  return host === domain || host.endsWith(`.${domain}`)
}

export const fliggyCookieHeaderForHost = (candidate, rawHost) => {
  const state = normalizeFliggySessionState(candidate)
  const host = String(rawHost ?? '').trim().toLowerCase()
  if (
    !host
    || !SESSION_COOKIE_DOMAINS.some(
      (allowed) => host === allowed || host.endsWith(`.${allowed}`),
    )
  ) {
    throw new Error('OTA_FLIGGY_COOKIE_HOST_UNSAFE')
  }
  return state.cookies
    .filter((cookie) => cookieMatchesHost(cookie, host))
    .sort((left, right) => right.path.length - left.path.length)
    .map((cookie) => `${cookie.name}=${cookie.value}`)
    .join('; ')
}

export const fliggyMtopTokenAvailable = (candidate) =>
  /(?:^|;\s*)_m_h5_tk=[^;]+/.test(
    fliggyCookieHeaderForHost(candidate, 'h5api.m.fliggy.com'),
  )

export const fliggyLoginSelectors = Object.freeze({
  username: [
    'input[name="username"]',
    '#fm-login-id',
    'input[name="fm-login-id"]',
    'input[name="TPL_username"]',
  ],
  password: [
    'input[name="password"]',
    '#fm-login-password',
    'input[name="fm-login-password"]',
    '#TPL_password_1',
    'input[type="password"]',
  ],
  submit: [
    'button.login-button',
    'button[type="submit"]',
    '.password-login',
    '#J_SubmitStatic',
  ],
  verification: [
    'input[name*="sms" i]',
    'input[name*="code" i]',
    'input[id*="code" i]',
    'input[placeholder*="验证码"]',
    'input[placeholder*="短信"]',
  ],
  captcha: [
    'img[src*="captcha" i]',
    'img[id*="captcha" i]',
    'img[class*="captcha" i]',
  ],
})

export const classifyFliggyLoginChallengeText = (value) => {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, 8_000)
  if (/锁定|冻结|次数过多|稍后再试|风险账号/u.test(text)) {
    return { status: 'FAILED', reasonCode: 'OTA_FLIGGY_ACCOUNT_LOCKED' }
  }
  if (/账号或密码|用户名或密码|密码错误|密码不正确|账号不存在/u.test(text)) {
    return { status: 'FAILED', reasonCode: 'OTA_FLIGGY_CREDENTIALS_REJECTED' }
  }
  if (/滑块|拖动.*验证|安全验证|验证中心/u.test(text)) {
    return {
      status: 'EXTERNAL_VERIFICATION_REQUIRED',
      reasonCode: 'OTA_FLIGGY_SLIDER_VERIFICATION_REQUIRED',
      challengeType: 'SLIDER',
    }
  }
  if (/扫码|二维码|手机淘宝.*扫一扫/u.test(text)) {
    return {
      status: 'EXTERNAL_VERIFICATION_REQUIRED',
      reasonCode: 'OTA_FLIGGY_QR_VERIFICATION_REQUIRED',
      challengeType: 'QR',
    }
  }
  if (/短信|验证码|校验码/u.test(text)) {
    return {
      status: 'VERIFICATION_REQUIRED',
      reasonCode: 'OTA_FLIGGY_CODE_VERIFICATION_REQUIRED',
      challengeType: 'CODE',
    }
  }
  return null
}

const firstVisible = async (page, selectors) => {
  for (const selector of selectors) {
    const locator = page.locator(selector).first()
    if (await locator.isVisible().catch(() => false)) return locator
  }
  return null
}

const clickAndSettle = async (page, button) => {
  const navigation = page.waitForNavigation({
    waitUntil: 'domcontentloaded',
    timeout: 20_000,
  }).catch(() => null)
  await button.click()
  await navigation
  await page.waitForTimeout(1_200)
}

const authenticatedUrl = (value) => {
  try {
    const url = new URL(value)
    return url.protocol === 'https:'
      && url.hostname.toLowerCase() === FLIGGY_LOGIN_HOST
      && !/\/ebooking\/login\.htm$/i.test(url.pathname)
      && !/\b(?:login|punish|captcha)\b/i.test(url.pathname)
  } catch {
    return false
  }
}

const safeBodyText = async (page) =>
  String(await page.locator('body').innerText().catch(() => ''))
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 8_000)

const captureCaptcha = async (page) => {
  const captcha = await firstVisible(page, fliggyLoginSelectors.captcha)
  if (!captcha) return null
  const image = await captcha.screenshot().catch(() => null)
  return image && image.length <= 256 * 1024 ? image : null
}

const captureSession = async (context) =>
  normalizeFliggySessionState(await context.storageState())

const warmAuthenticatedSession = async (page, context) => {
  await page.goto(FLIGGY_PORTAL_URL, {
    waitUntil: 'domcontentloaded',
    timeout: 30_000,
  })
  await page.waitForTimeout(5_000)
  if (!authenticatedUrl(page.url())) {
    throw new Error('OTA_FLIGGY_SESSION_INVALID')
  }
  return captureSession(context)
}

const validateCredentials = (credentials) => {
  if (
    !credentials
    || typeof credentials.account !== 'string'
    || typeof credentials.password !== 'string'
    || credentials.account.trim().length < 1
    || credentials.account.trim().length > 256
    || credentials.password.length < 1
    || credentials.password.length > 4096
    || /[\r\n\u0000]/.test(credentials.account)
    || /[\r\n\u0000]/.test(credentials.password)
  ) {
    throw new Error('OTA_LOGIN_CREDENTIALS_INVALID')
  }
  return {
    account: credentials.account.trim(),
    password: credentials.password,
  }
}

export const startFliggyControlledLogin = async ({
  credentials: rawCredentials,
  chromium = null,
  executablePath = null,
}) => {
  const credentials = validateCredentials(rawCredentials)
  const browserExecutable = executablePath ?? browserExecutableFor()
  if (!browserExecutable || !existsSync(browserExecutable)) {
    throw new Error('OTA_FLIGGY_BROWSER_NOT_FOUND')
  }
  const browser = await (chromium ?? chromiumFor()).launch({
    headless: true,
    executablePath: browserExecutable,
    args: [
      '--disable-features=PasswordManagerOnboarding,PasswordLeakDetection',
      '--disable-save-password-bubble',
      '--no-default-browser-check',
      '--no-first-run',
    ],
  })
  const context = await browser.newContext({
    acceptDownloads: false,
    locale: 'zh-CN',
    timezoneId: 'Asia/Shanghai',
    viewport: { width: 1440, height: 960 },
  })
  const page = await context.newPage()
  let closed = false
  let usernameSubmitted = false
  let passwordSubmitted = false
  const close = async () => {
    if (closed) return
    closed = true
    await context.close().catch(() => {})
    await browser.close().catch(() => {})
  }

  const authenticated = async () => {
    const sessionState = await warmAuthenticatedSession(page, context)
    return {
      status: 'AUTHENTICATED',
      reasonCode: null,
      sessionState,
      mtopTokenAvailable: fliggyMtopTokenAvailable(sessionState),
      close,
    }
  }

  const advance = async (verificationAnswer = null) => {
    if (closed) throw new Error('OTA_FLIGGY_LOGIN_ATTEMPT_CLOSED')
    if (verificationAnswer !== null) {
      if (!/^[A-Za-z0-9]{4,8}$/.test(verificationAnswer)) {
        throw new Error('OTA_FLIGGY_VERIFICATION_ANSWER_INVALID')
      }
      const verification = await firstVisible(
        page,
        fliggyLoginSelectors.verification,
      )
      const submit = await firstVisible(page, fliggyLoginSelectors.submit)
      if (!verification || !submit) {
        throw new Error('OTA_FLIGGY_VERIFICATION_FORM_UNAVAILABLE')
      }
      await verification.fill(verificationAnswer)
      await clickAndSettle(page, submit)
    }

    for (let step = 0; step < 5; step += 1) {
      if (authenticatedUrl(page.url())) return authenticated()
      const bodyText = await safeBodyText(page)
      const classified = classifyFliggyLoginChallengeText(bodyText)
      if (classified?.status === 'FAILED') {
        return { ...classified, close }
      }

      const username = await firstVisible(page, fliggyLoginSelectors.username)
      const submit = await firstVisible(page, fliggyLoginSelectors.submit)
      if (!usernameSubmitted && username && submit) {
        await username.fill(credentials.account)
        usernameSubmitted = true
        await clickAndSettle(page, submit)
        continue
      }

      const password = await firstVisible(page, fliggyLoginSelectors.password)
      if (!passwordSubmitted && password && submit) {
        await password.fill(credentials.password)
        passwordSubmitted = true
        await clickAndSettle(page, submit)
        continue
      }

      const verification = await firstVisible(
        page,
        fliggyLoginSelectors.verification,
      )
      if (verification && submit) {
        const captcha = await captureCaptcha(page)
        return {
          status: 'VERIFICATION_REQUIRED',
          reasonCode: 'OTA_FLIGGY_CODE_VERIFICATION_REQUIRED',
          challengeType: captcha ? 'IMAGE_CODE' : 'CODE',
          captcha,
          submit: advance,
          close,
        }
      }
      if (classified) return { ...classified, close }
      await page.waitForTimeout(1_000)
    }
    return {
      status: 'FAILED',
      reasonCode: 'OTA_FLIGGY_LOGIN_FORM_UNAVAILABLE',
      close,
    }
  }

  try {
    await page.goto(FLIGGY_PORTAL_URL, {
      waitUntil: 'domcontentloaded',
      timeout: 30_000,
    })
    await page.waitForTimeout(1_500)
    return await advance()
  } catch (error) {
    await close()
    throw error
  }
}

export const fliggyControlledLoginPolicy = Object.freeze({
  portalUrl: FLIGGY_PORTAL_URL,
  maxAttemptsPerWindow: 3,
  attemptWindowMinutes: 30,
  challengeTtlMinutes: 10,
  maxVerificationAnswers: 3,
})
