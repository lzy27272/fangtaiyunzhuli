import assert from 'node:assert/strict'
import process from 'node:process'
import test from 'node:test'
import {
  classifyFliggyLoginChallengeText,
  fliggyAuthenticationEligible,
  fliggyControlledLoginPolicy,
  fliggyCookieHeaderForHost,
  fliggyMtopTokenAvailable,
  normalizeFliggySessionState,
  startFliggyControlledLogin,
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
