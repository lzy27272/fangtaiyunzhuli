import assert from 'node:assert/strict'
import test from 'node:test'

import {
  bieyanghongCookieHeaderValid,
  bieyanghongLoginSelectors,
  prepareBieyanghongCredentialLogin,
} from '../../../tools/uat/bieyanghong-assisted-login.mjs'

const fakeLoginPage = () => {
  const calls = []
  let accountMode = false
  let checked = false
  let smsVisible = false
  const element = (selector) => ({
    first() { return this },
    last() { return this },
    filter() { return this },
    fill: async (value) => calls.push({ action: 'fill', selector, value }),
    isChecked: async () => checked,
    isVisible: async () => {
      if (selector === bieyanghongLoginSelectors.password) return accountMode
      if (selector === bieyanghongLoginSelectors.smsCode) return smsVisible
      if (selector === bieyanghongLoginSelectors.phone) return false
      if (selector === bieyanghongLoginSelectors.requestCode) return smsVisible
      return true
    },
    click: async () => {
      calls.push({ action: 'click', selector })
      if (selector === bieyanghongLoginSelectors.accountLoginTab) {
        accountMode = true
      }
      if (selector === bieyanghongLoginSelectors.agreement) checked = true
      if (selector === 'text:登录') smsVisible = true
    },
    waitFor: async () => {},
    evaluate: async () => {},
    innerText: async () => '获取验证码',
    getAttribute: async () => 'timer-button',
  })
  const frame = {
    url: () => `https://${bieyanghongLoginSelectors.loginFrameUrl}`,
    locator: (selector) => element(selector),
    getByText: (text) => element(`text:${text}`),
    waitForTimeout: async () => {},
  }
  return {
    calls,
    page: {
      goto: async (url) => calls.push({ action: 'goto', url }),
      frames: () => [frame],
      waitForTimeout: async () => {},
    },
    context: {
      cookies: async () => [],
    },
  }
}

test('submits transient manager credentials before requesting the SMS code', async () => {
  const { page, context, calls } = fakeLoginPage()
  const prepared = await prepareBieyanghongCredentialLogin({
    page,
    context,
    phone: '13800138000',
    password: 'temporary-example-password',
  })

  assert.ok(calls.some((call) =>
    call.action === 'fill'
    && call.selector === bieyanghongLoginSelectors.account
    && call.value === '13800138000'))
  assert.ok(calls.some((call) =>
    call.action === 'fill'
    && call.selector === bieyanghongLoginSelectors.password
    && call.value === 'temporary-example-password'))
  assert.ok(calls.some((call) =>
    call.action === 'click'
    && call.selector === bieyanghongLoginSelectors.agreement))
  assert.ok(calls.some((call) =>
    call.action === 'click'
    && call.selector === bieyanghongLoginSelectors.requestCode))
  assert.equal(prepared.alreadyAuthenticated, false)
})

test('requires the complete scoped Meituan PMS cookie set', () => {
  assert.equal(bieyanghongCookieHeaderValid([
    '_lxsdk_cuid=a',
    'hotelpms_login_hotel_id=b',
    'hotelpms_login_org_id=c',
    'hotelpms_tenant_id=d',
    'hotelpms_token=e',
  ].join('; ')), true)
  assert.equal(
    bieyanghongCookieHeaderValid('hotelpms_token=e; _lxsdk_cuid=a'),
    false,
  )
})
