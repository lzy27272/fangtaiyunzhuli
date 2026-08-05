import assert from 'node:assert/strict'
import test from 'node:test'

import {
  luopanLoginPageSelectors,
  prepareLuopanLoginPage,
} from '../../../tools/uat/luopan-assisted-login.mjs'

const fakePage = ({ failSelector = null } = {}) => {
  const calls = []
  const locator = (selector) => ({
    first: () => ({
      fill: async (value) => {
        calls.push({ action: 'fill', selector, value })
        if (selector === failSelector) throw new Error('selector missing')
      },
      waitFor: async () => {
        calls.push({ action: 'waitFor', selector })
        if (selector === failSelector) throw new Error('selector missing')
      },
      screenshot: async () => {
        calls.push({ action: 'screenshot', selector })
        if (selector === failSelector) throw new Error('selector missing')
        return Buffer.from('captcha-image')
      },
    }),
  })
  return {
    calls,
    page: {
      goto: async () => calls.push({ action: 'goto' }),
      locator,
    },
  }
}

test('Luopan assisted login accepts the live userId account field', async () => {
  const { page, calls } = fakePage()
  const captcha = await prepareLuopanLoginPage(page, {
    username: 'example-user',
    password: 'sample',
  })

  assert.match(luopanLoginPageSelectors.username, /name="userId"/u)
  assert.ok(calls.some((call) =>
    call.action === 'fill'
    && call.selector === luopanLoginPageSelectors.username
    && call.value === 'example-user'))
  assert.equal(captcha.toString('utf8'), 'captcha-image')
})

test('Luopan assisted login reports a stable form error code', async () => {
  const { page } = fakePage({
    failSelector: luopanLoginPageSelectors.username,
  })

  await assert.rejects(
    prepareLuopanLoginPage(page, {
      username: 'example-user',
      password: 'sample',
    }),
    { message: 'LUOPAN_LOGIN_FORM_UNAVAILABLE' },
  )
})

test('Luopan assisted login reports a stable captcha error code', async () => {
  const { page } = fakePage({
    failSelector: luopanLoginPageSelectors.captcha,
  })

  await assert.rejects(
    prepareLuopanLoginPage(page, {
      username: 'example-user',
      password: 'sample',
    }),
    { message: 'LUOPAN_CAPTCHA_UNAVAILABLE' },
  )
})
