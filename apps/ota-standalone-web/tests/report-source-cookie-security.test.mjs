import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import test from 'node:test'
import {
  decryptCookie,
  encryptCookie,
  validateCookieValue,
} from '../../../tools/uat/report-source-cookie-crypto.mjs'

test('a report-source cookie is encrypted at rest and round-trips only in its scope', () => {
  const key = randomBytes(32).toString('base64url')
  const cookie = 'session_id=uat-value; hotel_id=602758915'
  const scope = 'hotel-1:source-1'
  const encrypted = encryptCookie(cookie, key, scope)

  assert.equal(JSON.stringify(encrypted).includes(cookie), false)
  assert.equal(decryptCookie(encrypted, key, scope), cookie)
  assert.throws(
    () => decryptCookie(encrypted, key, 'hotel-1:source-2'),
  )
})

test('cookie input rejects header injection and invalid encryption keys', () => {
  assert.throws(() => validateCookieValue('a=b\r\nX-Test: injected'))
  assert.throws(() => validateCookieValue('Cookie: a=b'))
  assert.throws(() => validateCookieValue('   '))
  assert.throws(() => validateCookieValue(''))
  assert.throws(() => encryptCookie('a=b', 'not-a-key', 'hotel:source'))
})
