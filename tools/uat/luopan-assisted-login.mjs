import { isAuthenticationUrl } from './luopan-network-sanitizer.mjs'
import {
  launchLuopanBrowserContext,
} from './luopan-controlled-browser-collector.mjs'
import { normalizeLuopanSessionState } from './luopan-session-state.mjs'

const LOGIN_URL =
  'http://bj.chinapms.com:8880/pms-web/login/login.do'
const HOME_URL =
  'http://bj.chinapms.com:8880/pms-web/home/hg_index.do'

export const luopanLoginPageSelectors = Object.freeze({
  username: '[name="userId"], [name="username"]',
  passwordField: '[name="password"]',
  verification: '[name="verification"]',
  captcha: 'img[src*="Kaptcha"], img[src*="kaptcha"]',
  submit: 'button[type="submit"]',
})

const safeRejectReason = (text) => {
  if (/锁定|冻结|次数过多|稍后再试/u.test(text)) {
    return 'PMS_ACCOUNT_LOCKED'
  }
  if (/用户名或密码|账号或密码|密码错误|密码不正确|账号不存在|用户不存在/u.test(text)) {
    return 'PMS_CREDENTIALS_REJECTED'
  }
  if (/验证码.{0,8}(错误|不正确|失效|过期)|请输入验证码/u.test(text)) {
    return 'CAPTCHA_REJECTED'
  }
  return 'AUTHENTICATION_REJECTED'
}

export const prepareLuopanLoginPage = async (page, credentials) => {
  await page.goto(LOGIN_URL, {
    waitUntil: 'domcontentloaded',
    timeout: 30_000,
  })
  try {
    await page.locator(luopanLoginPageSelectors.username)
      .first()
      .fill(credentials.username)
    await page.locator(luopanLoginPageSelectors.passwordField)
      .first()
      .fill(credentials.password)
    await page.locator(luopanLoginPageSelectors.verification)
      .first()
      .fill('')
  } catch {
    throw new Error('LUOPAN_LOGIN_FORM_UNAVAILABLE')
  }
  try {
    const captcha = page.locator(luopanLoginPageSelectors.captcha).first()
    await captcha.waitFor({ state: 'visible', timeout: 15_000 })
    return await captcha.screenshot()
  } catch {
    throw new Error('LUOPAN_CAPTCHA_UNAVAILABLE')
  }
}

const captureSessionState = async (context) => {
  const persistentUntil =
    Math.floor(Date.now() / 1000) + (7 * 24 * 60 * 60)
  const cookies = (await context.cookies())
    .filter((cookie) => /(^|\.)chinapms\.com$/iu.test(cookie.domain))
    .map((cookie) => ({
      ...cookie,
      expires: persistentUntil,
    }))
  if (cookies.length === 0) {
    throw new Error('LUOPAN_SESSION_STATE_INVALID')
  }
  await context.addCookies(cookies)
  return normalizeLuopanSessionState(await context.storageState())
}

export const startLuopanAssistedLogin = async ({
  profileRef,
  credentials,
}) => {
  if (
    !credentials
    || typeof credentials.username !== 'string'
    || typeof credentials.password !== 'string'
  ) {
    throw new Error('PMS_LOGIN_CREDENTIALS_INVALID')
  }
  const { context } = await launchLuopanBrowserContext(profileRef)
  const page = context.pages()[0] ?? await context.newPage()
  let closed = false
  const close = async () => {
    if (closed) return
    closed = true
    await context.close().catch(() => {})
  }
  try {
    await page.goto(HOME_URL, {
      waitUntil: 'commit',
      timeout: 30_000,
    }).catch(() => null)
    await page.waitForTimeout(1_000)
    if (!isAuthenticationUrl(page.url())) {
      try {
        return {
          alreadyAuthenticated: true,
          sessionState: await captureSessionState(context),
          close,
        }
      } catch (error) {
        // Some expired PMS sessions land on a non-login intermediate page. Do
        // not treat that page as an authenticated session when it has no
        // usable Chinapms cookie; continue with the explicit login form so a
        // human can complete the current captcha challenge.
        if (error?.message !== 'LUOPAN_SESSION_STATE_INVALID') throw error
      }
    }
    const captcha = await prepareLuopanLoginPage(page, credentials)
    return {
      alreadyAuthenticated: false,
      captcha,
      close,
      submit: async (answer) => {
        if (closed) throw new Error('LUOPAN_REPAIR_CHALLENGE_CLOSED')
        await page.locator(luopanLoginPageSelectors.verification)
          .first()
          .fill(answer)
        const navigation = page.waitForNavigation({
          waitUntil: 'domcontentloaded',
          timeout: 30_000,
        }).catch(() => null)
        await page.locator(luopanLoginPageSelectors.submit).first().click()
        await navigation
        await page.waitForTimeout(1_500)
        if (!isAuthenticationUrl(page.url())) {
          let sessionState = null
          try {
            sessionState = await captureSessionState(context)
          } catch (error) {
            if (error?.message !== 'LUOPAN_SESSION_STATE_INVALID') {
              throw error
            }
          }
          return {
            authenticated: true,
            // The managed persistent profile is the approved session store.
            // Some PMS login variants keep their authenticated state there
            // without exposing a serializable cookie, so validation must be
            // allowed to reopen that same scoped profile.
            sessionState,
          }
        }
        const bodyText = await page.locator('body').innerText()
          .catch(() => '')
        const reasonCode = safeRejectReason(bodyText)
        if (
          reasonCode === 'PMS_CREDENTIALS_REJECTED'
          || reasonCode === 'PMS_ACCOUNT_LOCKED'
        ) {
          return { authenticated: false, reasonCode, captcha: null }
        }
        return {
          authenticated: false,
          reasonCode,
          captcha: await prepareLuopanLoginPage(page, credentials),
        }
      },
    }
  } catch (error) {
    await close()
    throw error
  }
}
