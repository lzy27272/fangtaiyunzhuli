import assert from 'node:assert/strict'
import test from 'node:test'

import {
  applyLuopanSessionState,
  normalizeLuopanSessionState,
} from '../../../tools/uat/luopan-session-state.mjs'

const validState = () => ({
  cookies: [
    {
      name: 'SESSION',
      value: 'sanitized-test-value',
      domain: '.BJ.CHINAPMS.COM',
      path: '/',
      expires: 2_000_000_000,
      httpOnly: true,
      secure: false,
      sameSite: 'Lax',
    },
  ],
  origins: [
    {
      origin: 'http://bj.chinapms.com:8880',
      localStorage: [
        { name: 'language', value: 'zh-CN' },
      ],
    },
  ],
})

const syntheticState = () => ({
  cookies: [
    {
      name: 'JSESSIONID',
      value: 'synthetic-session-cookie',
      domain: 'bj.chinapms.com',
      path: '/pms-web',
      expires: -1,
      httpOnly: true,
      secure: false,
      sameSite: 'Lax',
    },
  ],
  origins: [
    {
      origin: 'http://bj.chinapms.com:8880',
      localStorage: [
        { name: 'synthetic-key', value: 'synthetic-value' },
      ],
    },
  ],
})

test('normalizes a bounded Luopan session without exposing extra fields', () => {
  const candidate = validState()
  candidate.cookies[0].ignored = 'not persisted'

  assert.deepEqual(normalizeLuopanSessionState(candidate), {
    cookies: [
      {
        name: 'SESSION',
        value: 'sanitized-test-value',
        domain: '.bj.chinapms.com',
        path: '/',
        expires: 2_000_000_000,
        httpOnly: true,
        secure: false,
        sameSite: 'Lax',
      },
    ],
    origins: [
      {
        origin: 'http://bj.chinapms.com:8880',
        localStorage: [
          { name: 'language', value: 'zh-CN' },
        ],
      },
    ],
  })
})

test('rejects session data outside the Luopan allowlist', () => {
  const wrongDomain = validState()
  wrongDomain.cookies[0].domain = '.example.com'
  assert.throws(
    () => normalizeLuopanSessionState(wrongDomain),
    /LUOPAN_SESSION_STATE_INVALID/,
  )

  const wrongOrigin = validState()
  wrongOrigin.origins[0].origin = 'https://example.com'
  assert.throws(
    () => normalizeLuopanSessionState(wrongOrigin),
    /LUOPAN_SESSION_STATE_INVALID/,
  )
})

test('accepts a bounded approved PMS session shape', () => {
  const normalized = normalizeLuopanSessionState(syntheticState())
  assert.equal(normalized.cookies.length, 1)
  assert.equal(normalized.origins.length, 1)
})

test('applies cookies and scoped localStorage initialization', async () => {
  const calls = []
  const context = {
    addCookies: async (cookies) => calls.push(['cookies', cookies]),
    addInitScript: async (script, argument) =>
      calls.push(['script', typeof script, argument]),
  }

  await applyLuopanSessionState(context, validState())

  assert.equal(calls.length, 2)
  assert.equal(calls[0][0], 'cookies')
  assert.equal(calls[0][1][0].domain, '.bj.chinapms.com')
  assert.deepEqual(calls[1], [
    'script',
    'function',
    {
      origins: [
        {
          origin: 'http://bj.chinapms.com:8880',
          localStorage: [
            { name: 'language', value: 'zh-CN' },
          ],
        },
      ],
    },
  ])
})

test('does not touch the browser context when no session is configured', async () => {
  const context = {
    addCookies: async () => assert.fail('cookies should not be added'),
    addInitScript: async () => assert.fail('script should not be added'),
  }
  await applyLuopanSessionState(context, null)
})
