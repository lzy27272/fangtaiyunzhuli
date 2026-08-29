import assert from 'node:assert/strict'
import test from 'node:test'

import {
  bieyanghongCookieHeaderValid,
  bieyanghongLoginSelectors,
  prepareBieyanghongSmsLogin,
} from '../../../tools/uat/bieyanghong-assisted-login.mjs'

const fakeLoginPage = () => {
  const calls = []
  const locator = (selector) => ({
    first: () => ({
      fill: async (value) => calls.push({ action: 'fill', selector, value }),
      isChecked: async () => false,
      click: async () => calls.push({ action: 'click', selector }),
    }),
    innerText: async () => '',
  })
  const frame = {
    url: () => `https://${bieyanghongLoginSelectors.loginFrameUrl}`,
    locator,
    waitForTimeout: async () => {},
  }
  return {
    calls,
    page: {
      goto: async (url) => calls.push({ action: 'goto', url }),
      frames: () => [frame],
      waitForTimeout: async () => {},
    },
  }
}

test('prepares the official Meituan SMS login without using the password', async () => {
  const { page, calls } = fakeLoginPage()
  await prepareBieyanghongSmsLogin({ page, phone: '13800138000' })

  assert.ok(calls.some((call) =>
    call.action === 'fill'
    && call.selector === bieyanghongLoginSelectors.phone
    && call.value === '13800138000'))
  assert.ok(calls.some((call) =>
    call.action === 'click'
    && call.selector === bieyanghongLoginSelectors.agreement))
  assert.ok(calls.some((call) =>
    call.action === 'click'
    && call.selector === bieyanghongLoginSelectors.requestCode))
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
