import assert from 'node:assert/strict'
import test from 'node:test'
import {
  applyLuopanSessionState,
  normalizeLuopanSessionState,
} from '../../../tools/uat/luopan-session-state.mjs'

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

test('Luopan session state accepts only the approved PMS origin', () => {
  const normalized = normalizeLuopanSessionState(syntheticState())
  assert.equal(normalized.cookies.length, 1)
  assert.equal(normalized.origins.length, 1)

  const invalid = syntheticState()
  invalid.cookies[0].domain = 'example.com'
  assert.throws(
    () => normalizeLuopanSessionState(invalid),
    /LUOPAN_SESSION_STATE_INVALID/,
  )
})

test('Luopan session state is injected without exposing it to callers', async () => {
  const calls = []
  const context = {
    async addCookies(cookies) {
      calls.push({ kind: 'cookies', count: cookies.length })
    },
    async addInitScript(_script, argument) {
      calls.push({
        kind: 'init',
        originCount: argument.origins.length,
      })
    },
  }
  await applyLuopanSessionState(context, syntheticState())
  assert.deepEqual(calls, [
    { kind: 'cookies', count: 1 },
    { kind: 'init', originCount: 1 },
  ])
})
