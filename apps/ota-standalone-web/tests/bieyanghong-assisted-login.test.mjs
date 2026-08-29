import assert from 'node:assert/strict'
import test from 'node:test'

import {
  bieyanghongCookieHeaderValid,
  bieyanghongLoginSelectors,
  normalizeBieyanghongVisualInteraction,
  prepareBieyanghongCredentialLogin,
} from '../../../tools/uat/bieyanghong-assisted-login.mjs'

const fakeLoginPage = ({ riskAfterCredential = false } = {}) => {
  const calls = []
  let accountMode = false
  let codeRequested = false
  let currentFrame
  const createFrame = (kind) => {
    const frameState = { checked: false }
    const element = (selector) => ({
      first() { return this },
      last() { return this },
      filter() { return this },
      fill: async (value) => calls.push({
        action: 'fill',
        frame: kind,
        selector,
        value,
      }),
      isChecked: async () => frameState.checked,
      isVisible: async () => {
        if (selector === bieyanghongLoginSelectors.password) {
          return kind === 'credential' && accountMode
        }
        if (selector === bieyanghongLoginSelectors.smsCode) {
          return kind === 'verification'
        }
        if (selector === bieyanghongLoginSelectors.phone) {
          return kind === 'verification'
        }
        if (selector === bieyanghongLoginSelectors.requestCode) {
          return kind === 'verification'
        }
        return true
      },
      click: async () => {
        calls.push({ action: 'click', frame: kind, selector })
        if (selector === bieyanghongLoginSelectors.accountLoginTab) {
          accountMode = true
        }
        if (selector === bieyanghongLoginSelectors.agreement) {
          frameState.checked = true
        }
        if (selector === 'text:登录') {
          currentFrame = createFrame('verification')
        }
        if (selector === bieyanghongLoginSelectors.requestCode) {
          codeRequested = true
        }
      },
      waitFor: async () => {},
      evaluate: async () => {
        calls.push({ action: 'react-click', frame: kind, selector })
        if (selector === 'text:登录') {
          currentFrame = createFrame('verification')
        }
        if (selector === bieyanghongLoginSelectors.requestCode) {
          codeRequested = true
        }
        return true
      },
      count: async () => 0,
      innerText: async () => {
        if (
          selector === 'body'
          && riskAfterCredential
          && kind === 'verification'
        ) return '请完成安全验证'
        return codeRequested ? '59秒后重新获取' : '获取验证码'
      },
      getAttribute: async () => codeRequested
        ? 'timer-button disabled'
        : 'timer-button',
    })
    return {
      url: () => `https://${bieyanghongLoginSelectors.loginFrameUrl}`,
      locator: (selector) => element(selector),
      getByText: (text) => element(`text:${text}`),
      waitForTimeout: async () => {},
    }
  }
  currentFrame = createFrame('credential')
  return {
    calls,
    page: {
      goto: async (url) => calls.push({ action: 'goto', url }),
      frames: () => [currentFrame],
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
    call.action === 'react-click'
    && call.frame === 'verification'
    && call.selector === bieyanghongLoginSelectors.requestCode))
  assert.ok(calls.some((call) =>
    call.action === 'react-click'
    && call.frame === 'credential'
    && call.selector === 'text:登录'))
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

test('keeps the browser open for manager-operated Meituan risk verification', async () => {
  const { page, context } = fakeLoginPage({ riskAfterCredential: true })
  const prepared = await prepareBieyanghongCredentialLogin({
    page,
    context,
    phone: '13800138000',
    password: 'temporary-example-password',
  })

  assert.equal(prepared.alreadyAuthenticated, false)
  assert.equal(prepared.interactiveVerificationRequired, true)
  assert.equal(
    prepared.interactiveReasonCode,
    'BIEYANGHONG_LOGIN_RISK_CHALLENGE_REQUIRED',
  )
})

test('visual verification accepts only bounded pointer and keyboard actions', () => {
  assert.deepEqual(
    normalizeBieyanghongVisualInteraction({ kind: 'tap', x: 0.5, y: 0.25 }),
    { kind: 'tap', x: 0.5, y: 0.25 },
  )
  assert.deepEqual(
    normalizeBieyanghongVisualInteraction({
      kind: 'drag',
      fromX: 0.1,
      fromY: 0.4,
      toX: 0.8,
      toY: 0.4,
      durationMs: 5_000,
    }),
    {
      kind: 'drag',
      fromX: 0.1,
      fromY: 0.4,
      toX: 0.8,
      toY: 0.4,
      durationMs: 1_500,
    },
  )
  assert.deepEqual(
    normalizeBieyanghongVisualInteraction({ kind: 'key', key: 'Enter' }),
    { kind: 'key', key: 'Enter' },
  )
  assert.throws(
    () => normalizeBieyanghongVisualInteraction({
      kind: 'tap',
      x: 1.1,
      y: 0.5,
    }),
    /BIEYANGHONG_VISUAL_INTERACTION_INVALID/u,
  )
  assert.throws(
    () => normalizeBieyanghongVisualInteraction({
      kind: 'text',
      value: 'unsafe\nvalue',
    }),
    /BIEYANGHONG_VISUAL_INTERACTION_INVALID/u,
  )
})
