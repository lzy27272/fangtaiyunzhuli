import assert from 'node:assert/strict'
import process from 'node:process'
import test from 'node:test'
import {
  classifyFliggyLoginChallengeText,
  fliggyAuthenticationEligible,
  fliggyControlledLoginPolicy,
  fliggyCookieHeaderForHost,
  fliggyLoginRateLimitState,
  fliggyMtopTokenAvailable,
  normalizeFliggySessionState,
  startFliggyControlledLogin,
  withFliggyControlledLoginTimeout,
} from '../../../tools/uat/fliggy-controlled-login.mjs'

const cookie = (name, value, domain, path = '/') => ({
  name,
  value,
  domain,
  path,
  expires: -1,
  httpOnly: true,
  secure: true,
  sameSite: 'Lax',
})

test('Fliggy session keeps only approved OTA domains', () => {
  const normalized = normalizeFliggySessionState({
    cookies: [
      cookie('_m_h5_tk', 'synthetic_token_1', '.fliggy.com'),
      cookie('sid', 'synthetic_sid', '.taobao.com'),
      cookie('unrelated', 'must-not-survive', '.example.com'),
    ],
    origins: [{ origin: 'https://hotel.fliggy.com', localStorage: [] }],
  })
  assert.deepEqual(
    normalized.cookies.map((item) => item.name),
    ['_m_h5_tk', 'sid'],
  )
  assert.equal(JSON.stringify(normalized).includes('must-not-survive'), false)
})

test('Fliggy cookies are projected only to the requested approved host', () => {
  const state = {
    cookies: [
      cookie('_m_h5_tk', 'synthetic_token_1', '.fliggy.com'),
      cookie('hotel_session', 'synthetic_hotel', 'hotel.fliggy.com'),
      cookie('taobao_session', 'synthetic_taobao', '.taobao.com'),
    ],
  }
  assert.match(
    fliggyCookieHeaderForHost(state, 'h5api.m.fliggy.com'),
    /_m_h5_tk=synthetic_token_1/,
  )
  assert.doesNotMatch(
    fliggyCookieHeaderForHost(state, 'h5api.m.fliggy.com'),
    /taobao_session/,
  )
  assert.equal(fliggyMtopTokenAvailable(state), true)
  assert.throws(
    () => fliggyCookieHeaderForHost(state, 'example.com'),
    /OTA_FLIGGY_COOKIE_HOST_UNSAFE/,
  )
})

test('Fliggy login challenges fail closed and remain human verified', () => {
  assert.deepEqual(
    classifyFliggyLoginChallengeText('请输入短信验证码'),
    {
      status: 'VERIFICATION_REQUIRED',
      reasonCode: 'OTA_FLIGGY_CODE_VERIFICATION_REQUIRED',
      challengeType: 'CODE',
    },
  )
  assert.equal(
    classifyFliggyLoginChallengeText('请拖动滑块完成安全验证').status,
    'EXTERNAL_VERIFICATION_REQUIRED',
  )
  assert.equal(
    classifyFliggyLoginChallengeText('账号或密码错误').status,
    'FAILED',
  )
  assert.equal(
    classifyFliggyLoginChallengeText('账户名或登录密码不正确').reasonCode,
    'OTA_FLIGGY_CREDENTIALS_REJECTED',
  )
  assert.equal(
    classifyFliggyLoginChallengeText('请完成身份验证').reasonCode,
    'OTA_FLIGGY_EXTERNAL_VERIFICATION_REQUIRED',
  )
  assert.deepEqual(
    {
      portalUrl: fliggyControlledLoginPolicy.portalUrl,
      maxAttemptsPerWindow:
        fliggyControlledLoginPolicy.maxAttemptsPerWindow,
      attemptWindowMinutes:
        fliggyControlledLoginPolicy.attemptWindowMinutes,
      challengeTtlMinutes:
        fliggyControlledLoginPolicy.challengeTtlMinutes,
      maxVerificationAnswers:
        fliggyControlledLoginPolicy.maxVerificationAnswers,
    },
    {
      portalUrl: 'https://hotel.fliggy.com/ebooking/',
      maxAttemptsPerWindow: 3,
      attemptWindowMinutes: 30,
      challengeTtlMinutes: 10,
      maxVerificationAnswers: 3,
    },
  )
})

test('Fliggy controlled login rejects same-domain shell false positives', () => {
  const valid = {
    url: 'https://hotel.fliggy.com/ebooking/hotelBaseInfoUv.htm',
    usernameSubmitted: true,
    passwordSubmitted: true,
    usernameVisible: false,
    passwordVisible: false,
    challengeDetected: false,
  }
  assert.equal(fliggyAuthenticationEligible(valid), true)
  assert.equal(fliggyAuthenticationEligible({
    ...valid,
    usernameSubmitted: false,
    passwordSubmitted: false,
  }), false)
  assert.equal(fliggyAuthenticationEligible({
    ...valid,
    passwordVisible: true,
  }), false)
  assert.equal(fliggyAuthenticationEligible({
    ...valid,
    challengeDetected: true,
  }), false)
  assert.equal(fliggyAuthenticationEligible({
    ...valid,
    url: 'https://login.taobao.com/member/login.jhtml',
  }), false)
})

test('Fliggy controlled login rate limit releases when its window expires', () => {
  const windowStartedAt = '2026-08-19T00:00:00.000Z'
  const active = fliggyLoginRateLimitState({
    windowStartedAt,
    attemptCount: 3,
    now: Date.parse('2026-08-19T00:29:59.000Z'),
  })
  assert.equal(active.rateLimited, true)
  assert.equal(active.nextAttemptAt, '2026-08-19T00:30:00.000Z')
  const expired = fliggyLoginRateLimitState({
    windowStartedAt,
    attemptCount: 3,
    now: Date.parse('2026-08-19T00:30:00.000Z'),
  })
  assert.equal(expired.rateLimited, false)
  assert.equal(expired.nextAttemptAt, null)
})

test('Fliggy controlled login has a bounded whole-attempt timeout and closes late results', async () => {
  let aborted = false
  let closed = false
  await assert.rejects(
    withFliggyControlledLoginTimeout((signal) => new Promise((resolve) => {
      signal.addEventListener('abort', () => { aborted = true }, { once: true })
      setTimeout(() => resolve({
        status: 'AUTHENTICATED',
        close: async () => { closed = true },
      }), 25)
    }), { timeoutMs: 5 }),
    /OTA_FLIGGY_LOGIN_TIMEOUT/,
  )
  await new Promise((resolve) => setTimeout(resolve, 35))
  assert.equal(aborted, true)
  assert.equal(closed, true)
  assert.equal(fliggyControlledLoginPolicy.attemptTimeoutSeconds, 90)
})

test('Fliggy controlled login timeout aborts a never-settling operation', async () => {
  let aborted = false
  await assert.rejects(
    withFliggyControlledLoginTimeout((signal) => new Promise(() => {
      signal.addEventListener('abort', () => { aborted = true }, { once: true })
    }), { timeoutMs: 5 }),
    /OTA_FLIGGY_LOGIN_TIMEOUT/,
  )
  assert.equal(aborted, true)
})

test('Fliggy controlled login cleans up browser setup failures', async () => {
  let browserClosed = 0
  const browser = {
    newContext: async () => { throw new Error('synthetic-context-failure') },
    close: async () => { browserClosed += 1 },
  }
  await assert.rejects(
    startFliggyControlledLogin({
      credentials: { account: 'synthetic-account', password: 'synthetic-pass' },
      chromium: { launch: async () => browser },
      executablePath: process.execPath,
    }),
    /synthetic-context-failure/,
  )
  assert.equal(browserClosed, 1)

  let contextClosed = 0
  browserClosed = 0
  const context = {
    newPage: async () => { throw new Error('synthetic-page-failure') },
    close: async () => { contextClosed += 1 },
  }
  await assert.rejects(
    startFliggyControlledLogin({
      credentials: { account: 'synthetic-account', password: 'synthetic-pass' },
      chromium: {
        launch: async () => ({
          newContext: async () => context,
          close: async () => { browserClosed += 1 },
        }),
      },
      executablePath: process.execPath,
    }),
    /synthetic-page-failure/,
  )
  assert.equal(contextClosed, 1)
  assert.equal(browserClosed, 1)
})

test('Fliggy controlled login cleanup survives a synchronous context close error', async () => {
  let browserClosed = 0
  const page = {
    url: () => 'https://hotel.fliggy.com/ebooking/login.htm',
    goto: async () => undefined,
    waitForTimeout: async () => undefined,
    waitForNavigation: async () => null,
    frames: () => [],
    locator: () => ({
      first() { return this },
      isVisible: async () => false,
      innerText: async () => '登录页面',
    }),
  }
  const login = await startFliggyControlledLogin({
    credentials: { account: 'synthetic-account', password: 'synthetic-pass' },
    chromium: {
      launch: async () => ({
        newContext: async () => ({
          newPage: async () => page,
          close: () => { throw new Error('synthetic-close-failure') },
        }),
        close: async () => { browserClosed += 1 },
      }),
    },
    executablePath: process.execPath,
  })
  await login.close()
  assert.equal(browserClosed, 1)
})

test('Fliggy whole-attempt timeout closes a context blocked in page creation', async () => {
  let contextClosed = 0
  let browserClosed = 0
  const context = {
    newPage: async () => new Promise(() => {}),
    close: async () => { contextClosed += 1 },
  }
  await assert.rejects(
    withFliggyControlledLoginTimeout(
      (signal) => startFliggyControlledLogin({
        credentials: {
          account: 'synthetic-account',
          password: 'synthetic-pass',
        },
        chromium: {
          launch: async () => ({
            newContext: async () => context,
            close: async () => { browserClosed += 1 },
          }),
        },
        executablePath: process.execPath,
        signal,
      }),
      { timeoutMs: 10 },
    ),
    /OTA_FLIGGY_LOGIN_TIMEOUT/,
  )
  await new Promise((resolve) => setTimeout(resolve, 0))
  assert.equal(contextClosed, 1)
  assert.equal(browserClosed, 1)
})

test('Fliggy verification submission accepts abort signals and closes resources', async () => {
  let contextClosed = 0
  let browserClosed = 0
  let blockVerificationFill = false
  const locatorKind = (selector) => {
    if (selector === 'body') return 'BODY'
    if (/(?:sms|code|验证码|短信)/i.test(selector)) return 'VERIFICATION'
    if (/(?:submit|login-button|J_SubmitStatic)/i.test(selector)) return 'SUBMIT'
    return 'OTHER'
  }
  const page = {
    url: () => 'https://hotel.fliggy.com/ebooking/login.htm',
    goto: async () => undefined,
    waitForTimeout: async () => undefined,
    waitForNavigation: async () => null,
    frames: () => [],
    locator: (selector) => {
      const kind = locatorKind(selector)
      return {
        first() { return this },
        isVisible: async () => ['VERIFICATION', 'SUBMIT'].includes(kind),
        innerText: async () => kind === 'BODY' ? '请输入短信验证码' : '',
        fill: async () => blockVerificationFill
          ? new Promise(() => {})
          : undefined,
        click: async () => undefined,
      }
    },
  }
  const login = await startFliggyControlledLogin({
    credentials: { account: 'synthetic-account', password: 'synthetic-pass' },
    chromium: {
      launch: async () => ({
        newContext: async () => ({
          newPage: async () => page,
          close: async () => { contextClosed += 1 },
        }),
        close: async () => { browserClosed += 1 },
      }),
    },
    executablePath: process.execPath,
  })
  assert.equal(login.status, 'VERIFICATION_REQUIRED')
  blockVerificationFill = true
  const controller = new AbortController()
  const submission = login.submit('1234', { signal: controller.signal })
  controller.abort()
  await assert.rejects(submission, /OTA_FLIGGY_LOGIN_ABORTED/)
  await new Promise((resolve) => setTimeout(resolve, 0))
  assert.equal(contextClosed, 1)
  assert.equal(browserClosed, 1)
})

test('Fliggy controlled login supports iframe two-step credentials', async () => {
  let state = 'USERNAME'
  let account = ''
  let password = ''
  let submitCount = 0
  const syntheticCredential = ['hotel', 'credential'].join('-')
  const selectorKind = (selector) => {
    if (selector === 'body') return 'BODY'
    if (/(?:username|login-id|TPL_username)/.test(selector)) return 'ACCOUNT'
    if (/(?:password|TPL_password)/.test(selector)) return 'PASSWORD'
    if (/(?:submit|login-button|password-login|J_SubmitStatic)/i.test(selector)) {
      return 'SUBMIT'
    }
    return 'OTHER'
  }
  const frame = {
    locator: (selector) => {
      const kind = selectorKind(selector)
      return {
        first() { return this },
        isVisible: async () => (
          (state === 'USERNAME' && ['ACCOUNT', 'SUBMIT'].includes(kind))
          || (state === 'PASSWORD' && ['PASSWORD', 'SUBMIT'].includes(kind))
        ),
        fill: async (value) => {
          if (kind === 'ACCOUNT') account = value
          if (kind === 'PASSWORD') password = value
        },
        click: async () => {
          submitCount += 1
          if (state === 'USERNAME' && account) state = 'PASSWORD'
          else if (state === 'PASSWORD' && password) state = 'AUTHENTICATED'
        },
        innerText: async () => state === 'AUTHENTICATED'
          ? '酒店后台'
          : '账号登录',
      }
    },
  }
  const page = {
    url: () => 'https://hotel.fliggy.com/ebooking/hotelBaseInfoUv.htm',
    goto: async () => undefined,
    waitForTimeout: async () => undefined,
    waitForNavigation: async () => null,
    frames: () => [frame],
    locator: () => ({
      first() { return this },
      isVisible: async () => false,
      innerText: async () => state === 'AUTHENTICATED'
        ? '酒店后台'
        : '登录页面',
    }),
  }
  const context = {
    newPage: async () => page,
    storageState: async () => ({
      cookies: [cookie('hotel_session', 'synthetic_hotel', 'hotel.fliggy.com')],
    }),
    close: async () => undefined,
  }
  const chromium = {
    launch: async () => ({
      newContext: async () => context,
      close: async () => undefined,
    }),
  }
  const login = await startFliggyControlledLogin({
    credentials: { account: 'hotel-account', password: syntheticCredential },
    chromium,
    executablePath: process.execPath,
  })
  assert.equal(login.status, 'AUTHENTICATED')
  assert.equal(account, 'hotel-account')
  assert.equal(password, syntheticCredential)
  assert.equal(submitCount, 2)
  await login.close()
})

test('Fliggy controlled login reports the exact missing login stage', async () => {
  const page = {
    url: () => 'https://hotel.fliggy.com/ebooking/login.htm',
    goto: async () => undefined,
    waitForTimeout: async () => undefined,
    waitForNavigation: async () => null,
    frames: () => [],
    locator: () => ({
      first() { return this },
      isVisible: async () => false,
      innerText: async () => '登录页面',
    }),
  }
  const context = {
    newPage: async () => page,
    close: async () => undefined,
  }
  const chromium = {
    launch: async () => ({
      newContext: async () => context,
      close: async () => undefined,
    }),
  }
  const login = await startFliggyControlledLogin({
    credentials: {
      account: 'synthetic-account',
      password: ['synthetic', 'credential'].join('-'),
    },
    chromium,
    executablePath: process.execPath,
  })
  assert.equal(login.status, 'FAILED')
  assert.equal(login.reasonCode, 'OTA_FLIGGY_USERNAME_FORM_UNAVAILABLE')
  await login.close()
})

test('Fliggy controlled login verifies a session after an intermediate login host', async () => {
  let state = 'USERNAME'
  let currentUrl = 'https://hotel.fliggy.com/ebooking/login.htm'
  let account = ''
  let password = ''
  const selectorKind = (selector) => {
    if (selector === 'body') return 'BODY'
    if (/(?:username|login-id|TPL_username)/.test(selector)) return 'ACCOUNT'
    if (/(?:password|TPL_password)/.test(selector)) return 'PASSWORD'
    if (/(?:submit|login-button|J_SubmitStatic)/i.test(selector)) return 'SUBMIT'
    return 'OTHER'
  }
  const locator = (selector) => {
    const kind = selectorKind(selector)
    return {
      first() { return this },
      isVisible: async () => (
        (state === 'USERNAME' && ['ACCOUNT', 'SUBMIT'].includes(kind))
        || (state === 'PASSWORD' && ['PASSWORD', 'SUBMIT'].includes(kind))
      ),
      fill: async (value) => {
        if (kind === 'ACCOUNT') account = value
        if (kind === 'PASSWORD') password = value
      },
      click: async () => {
        if (state === 'USERNAME' && account) state = 'PASSWORD'
        else if (state === 'PASSWORD' && password) {
          state = 'INTERMEDIATE'
          currentUrl = 'https://login.taobao.com/member/login.jhtml'
        }
      },
      innerText: async () => state === 'AUTHENTICATED'
        ? '酒店后台'
        : '账号登录',
    }
  }
  const page = {
    url: () => currentUrl,
    goto: async (url) => {
      if (state === 'INTERMEDIATE') {
        state = 'AUTHENTICATED'
        currentUrl = 'https://hotel.fliggy.com/ebooking/hotelBaseInfoUv.htm'
      }
    },
    waitForTimeout: async () => undefined,
    waitForNavigation: async () => null,
    frames: () => [],
    locator,
  }
  const context = {
    newPage: async () => page,
    storageState: async () => ({
      cookies: [cookie('hotel_session', 'synthetic_hotel', 'hotel.fliggy.com')],
    }),
    close: async () => undefined,
  }
  const chromium = {
    launch: async () => ({
      newContext: async () => context,
      close: async () => undefined,
    }),
  }
  const login = await startFliggyControlledLogin({
    credentials: {
      account: 'synthetic-account',
      password: ['synthetic', 'credential'].join('-'),
    },
    chromium,
    executablePath: process.execPath,
  })
  assert.equal(login.status, 'AUTHENTICATED')
  assert.equal(currentUrl, 'https://hotel.fliggy.com/ebooking/hotelBaseInfoUv.htm')
  await login.close()
})
