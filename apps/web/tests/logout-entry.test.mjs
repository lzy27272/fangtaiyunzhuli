import assert from 'node:assert/strict'
import test from 'node:test'
import { consumeLogoutEntry } from '../src/app/logoutEntry.ts'

test('logout entry clears the browser session and returns to the login root', () => {
  let cleared = 0
  let replaced = ''
  const consumed = consumeLogoutEntry(
    () => { cleared += 1 },
    {
      location: {
        href: 'http://127.0.0.1:4180/?preview=latest&logout=1#/team-work',
      },
      history: {
        replaceState: (_state, _title, url) => { replaced = String(url) },
      },
    },
  )

  assert.equal(consumed, true)
  assert.equal(cleared, 1)
  assert.equal(replaced, '/?preview=latest#/')
})

test('normal entry keeps the existing session untouched', () => {
  let cleared = 0
  const consumed = consumeLogoutEntry(
    () => { cleared += 1 },
    {
      location: { href: 'http://127.0.0.1:4180/#/team-work' },
      history: { replaceState: () => assert.fail('normal entry must not rewrite the URL') },
    },
  )

  assert.equal(consumed, false)
  assert.equal(cleared, 0)
})
