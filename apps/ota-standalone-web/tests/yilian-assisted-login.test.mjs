import assert from 'node:assert/strict'
import test from 'node:test'
import {
  classifyYilianLoginFailure,
  isYilianOfficialRequest,
  isYilianOfficialUrl,
  startYilianPasswordLogin,
  yilianLoginSelectors,
} from '../../../tools/uat/yilian-assisted-login.mjs'

const fakeBrowserRuntime = ({
  token = '',
  finalToken = 'synthetic-yilian-final-access-token-000000000000000002',
  messages = [],
  humanVerification = false,
  companyOptions = [],
  departmentOptions = [],
  shiftOptions = ['早班 08:00 ~ 20:00'],
} = {}) => {
  const calls = []
  const storage = { token }
  const optionsFor = (selector) => {
    if (selector === yilianLoginSelectors.company) return companyOptions
    if (selector === yilianLoginSelectors.department) return departmentOptions
    if (selector === yilianLoginSelectors.shift) return shiftOptions
    if (selector === yilianLoginSelectors.shiftConfirm) return ['确定']
    if (selector === yilianLoginSelectors.message) return messages
    if (selector === yilianLoginSelectors.humanVerification) {
      return humanVerification ? ['验证码'] : []
    }
    return ['visible']
  }
  const locatorFor = (selector, index = null) => ({
    first: () => locatorFor(selector, 0),
    nth: (nextIndex) => locatorFor(selector, nextIndex),
    count: async () => optionsFor(selector).length,
    waitFor: async () => {
      calls.push(['waitFor', selector])
      if (optionsFor(selector).length === 0) throw new Error('synthetic hidden')
    },
    fill: async (value) => { calls.push(['fill', selector, value]) },
    click: async () => {
      calls.push(['click', selector])
      if (selector === yilianLoginSelectors.shiftConfirm) {
        storage.token = finalToken
      }
    },
    allTextContents: async () => messages,
    innerText: async () => optionsFor(selector)[index ?? 0] ?? '',
    isVisible: async () =>
      optionsFor(selector)[index ?? 0] !== undefined,
  })
  const page = {
    on: () => {},
    goto: async (url) => { calls.push(['goto', url]) },
    url: () => 'https://pms.ygjpms.com/saas/#/login',
    locator: locatorFor,
    waitForFunction: async (_operation, previousToken = null) => {
      if (!storage.token || (previousToken && storage.token === previousToken)) {
        throw new Error('synthetic timeout')
      }
    },
    evaluate: async (operation) => {
      if (String(operation).includes('sessionStorage.clear()')) {
        storage.token = ''
        return undefined
      }
      return storage.token
    },
  }
  const context = {
    setDefaultTimeout: () => {},
    route: async () => {},
    newPage: async () => page,
    close: async () => { calls.push(['context.close']) },
  }
  const browser = {
    newContext: async () => context,
    close: async () => { calls.push(['browser.close']) },
  }
  return {
    calls,
    chromium: {
      launch: async () => browser,
    },
  }
}

test('Yilian browser login is restricted to the exact official HTTPS host', () => {
  assert.equal(isYilianOfficialUrl('https://pms.ygjpms.com/saas/#/login'), true)
  assert.equal(isYilianOfficialUrl('https://pms.ygjpms.com/login/pms/start'), true)
  assert.equal(isYilianOfficialUrl('http://pms.ygjpms.com/saas/#/login'), false)
  assert.equal(isYilianOfficialUrl('https://pms.ygjpms.com.example/saas/#/login'), false)
  assert.equal(isYilianOfficialRequest('https://pms.ygjpms.com/newPms/example'), true)
  assert.equal(isYilianOfficialRequest('https://api.translate.zvo.cn/init.json'), false)
})

test('Yilian browser login fills encrypted-server credentials once and clears page secrets', async () => {
  const runtime = fakeBrowserRuntime({
    token: 'synthetic-yilian-access-token-000000000000000001',
  })
  const result = await startYilianPasswordLogin({
    credentials: { username: 'hotel-user', password: 'secret-pass' },
    chromium: runtime.chromium,
    executablePath: '/synthetic/chrome',
    executableExists: () => true,
    timeoutMs: 100,
  })
  assert.deepEqual(result, {
    accessToken: 'synthetic-yilian-final-access-token-000000000000000002',
  })
  assert.deepEqual(
    runtime.calls.filter(([name]) => name === 'fill').slice(0, 2),
    [
      ['fill', yilianLoginSelectors.username, 'hotel-user'],
      ['fill', yilianLoginSelectors.password, 'secret-pass'],
    ],
  )
  assert.ok(runtime.calls.some(([name]) => name === 'context.close'))
  assert.ok(runtime.calls.some(([name]) => name === 'browser.close'))
  assert.deepEqual(
    runtime.calls.filter(([name]) => name === 'fill').slice(-2),
    [
      ['fill', yilianLoginSelectors.username, ''],
      ['fill', yilianLoginSelectors.password, ''],
    ],
  )
  assert.ok(runtime.calls.some(
    ([name, selector]) => name === 'click'
      && selector === yilianLoginSelectors.shiftConfirm,
  ))
})

test('Yilian login selects the requested hotel and hotel department before confirming a shift', async () => {
  const runtime = fakeBrowserRuntime({
    token: 'synthetic-yilian-intermediate-token-00000000000001',
    companyOptions: ['其他门店 营业中', '贵州宴 营业中'],
    departmentOptions: ['餐饮 Catering', '酒店 Hotel'],
  })
  const result = await startYilianPasswordLogin({
    credentials: { username: 'hotel-user', password: 'secret-pass' },
    expectedHotelName: '贵州宴',
    chromium: runtime.chromium,
    executablePath: '/synthetic/chrome',
    executableExists: () => true,
    timeoutMs: 100,
  })
  assert.equal(
    result.accessToken,
    'synthetic-yilian-final-access-token-000000000000000002',
  )
  assert.equal(
    runtime.calls.filter(
      ([name, selector]) => name === 'click'
        && selector === yilianLoginSelectors.company,
    ).length,
    1,
  )
  assert.equal(
    runtime.calls.filter(
      ([name, selector]) => name === 'click'
        && selector === yilianLoginSelectors.department,
    ).length,
    1,
  )
})

test('Yilian login stops for human verification or risk control without retrying', async () => {
  assert.equal(
    classifyYilianLoginFailure('请完成短信验证码后继续'),
    'YILIAN_HUMAN_AUTHORIZATION_REQUIRED',
  )
  assert.equal(
    classifyYilianLoginFailure('操作频繁，触发安全限制，请稍后再试'),
    'YILIAN_RISK_CONTROL_REQUIRED',
  )
  assert.equal(
    classifyYilianLoginFailure('账号或密码错误'),
    'YILIAN_CREDENTIALS_REJECTED',
  )

  const runtime = fakeBrowserRuntime({ messages: ['请完成短信验证码后继续'] })
  await assert.rejects(
    startYilianPasswordLogin({
      credentials: { username: 'hotel-user', password: 'secret-pass' },
      chromium: runtime.chromium,
      executablePath: '/synthetic/chrome',
      executableExists: () => true,
      timeoutMs: 100,
    }),
    /YILIAN_HUMAN_AUTHORIZATION_REQUIRED/u,
  )
  assert.equal(
    runtime.calls.filter(([name]) => name === 'click').length,
    1,
  )

  const visualChallenge = fakeBrowserRuntime({ humanVerification: true })
  await assert.rejects(
    startYilianPasswordLogin({
      credentials: { username: 'hotel-user', password: 'secret-pass' },
      chromium: visualChallenge.chromium,
      executablePath: '/synthetic/chrome',
      executableExists: () => true,
      timeoutMs: 100,
    }),
    /YILIAN_HUMAN_AUTHORIZATION_REQUIRED/u,
  )
})
