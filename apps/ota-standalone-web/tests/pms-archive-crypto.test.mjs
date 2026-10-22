import assert from 'node:assert/strict'
import { createCipheriv, randomBytes } from 'node:crypto'
import test from 'node:test'
import { decryptCookie, encryptCookie, validateCookieValue } from '../../../tools/uat/report-source-cookie-crypto.mjs'

const key = randomBytes(32).toString('base64url')
const hotelId = '20000000-0000-4000-8000-000000000009'
const transactionId = '30000000-0000-4000-8000-000000000001'
const scope = `pms-system-archive:${hotelId}:${transactionId}`
const archiveLimit = 64 * 1024 * 1024
const cookieLimit = 16 * 1024
const rosterLimit = 4 * 1024 * 1024

// Produce the established v1 envelope independently of the helper's new limits,
// so compatibility and post-decryption validation are not self-roundtrip-only.
function priorEnvelope(plaintext, aadScope = scope) {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', Buffer.from(key, 'base64url'), iv)
  cipher.setAAD(Buffer.from(`sifangguan-report-cookie:v1:${aadScope}`, 'utf8'))
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  return { version: 1, algorithm: 'AES-256-GCM', iv: iv.toString('base64url'),
    ciphertext: ciphertext.toString('base64url'), authTag: cipher.getAuthTag().toString('base64url'),
    updatedAt: '2026-10-22T00:00:00.000Z' }
}

test('PMS archive accepts exactly 64 MiB of UTF-8 and rejects a larger document in both directions', () => {
  // Chinese text has fewer characters than bytes: the accepted boundary must
  // be the UTF-8 byte count, not JavaScript string length.
  const exact = '店'.repeat(Math.floor(archiveLimit / 3)) + 'x'.repeat(archiveLimit % 3)
  assert.equal(Buffer.byteLength(exact, 'utf8'), archiveLimit)
  assert.ok(exact.length < archiveLimit)
  const encrypted = encryptCookie(exact, key, scope)
  assert.equal(decryptCookie(encrypted, key, scope), exact)
  assert.throws(() => encryptCookie(`${exact}x`, key, scope), /COOKIE_VALUE_INVALID/u)
  const oversized = priorEnvelope(`${exact}x`)
  assert.throws(() => decryptCookie(oversized, key, scope), /COOKIE_VALUE_INVALID/u)
})

test('only an exact archive scope receives the enlarged bound; cookies and the roster retain their original limits', () => {
  const cookie = 'x'.repeat(cookieLimit)
  assert.equal(decryptCookie(encryptCookie(cookie, key, 'ordinary-cookie'), key, 'ordinary-cookie'), cookie)
  assert.doesNotThrow(() => validateCookieValue(cookie))
  assert.throws(() => validateCookieValue(`${cookie}x`), /COOKIE_VALUE_INVALID/u)
  assert.throws(() => encryptCookie(`${cookie}x`, key, 'ordinary-cookie'), /COOKIE_VALUE_INVALID/u)
  assert.throws(() => decryptCookie(priorEnvelope(`${cookie}x`, 'ordinary-cookie'), key, 'ordinary-cookie'), /COOKIE_VALUE_INVALID/u)
  for (const fake of [
    `pms-system-archive:${hotelId}:not-a-transaction`,
    `pms-system-archive:${hotelId}:30000000-0000-0000-8000-000000000001`,
    `pms-system-archive:${hotelId}:30000000-0000-4000-0000-000000000001`,
    `${scope}:extra`, `prefix:${scope}`, ` ${scope}`, `${scope}\n`,
  ]) assert.throws(() => encryptCookie(`${cookie}x`, key, fake), /COOKIE_VALUE_INVALID/u)
  const roster = 'x'.repeat(rosterLimit)
  assert.equal(decryptCookie(encryptCookie(roster, key, 'wecom-repair-bot:v1'), key, 'wecom-repair-bot:v1'), roster)
  assert.throws(() => encryptCookie(`${roster}x`, key, 'wecom-repair-bot:v1'), /COOKIE_VALUE_INVALID/u)
  assert.throws(() => encryptCookie(roster, key, 'wecom-repair-bot:v1:extra'), /COOKIE_VALUE_INVALID/u)
})

test('current small archives remain compatible and cannot be moved between hotels or transactions or tampered with', () => {
  const plaintext = JSON.stringify({ snapshots: [{ note: '合成归档', roomFee: 1234 }] })
  const oldRecord = priorEnvelope(plaintext)
  assert.equal(decryptCookie(oldRecord, key, scope), plaintext)
  const record = encryptCookie(plaintext, key, scope)
  for (const otherScope of [
    `pms-system-archive:20000000-0000-4000-8000-000000000010:${transactionId}`,
    `pms-system-archive:${hotelId}:30000000-0000-4000-8000-000000000002`,
    'ordinary-cookie',
  ]) assert.throws(() => decryptCookie(record, key, otherScope))
  for (const field of ['ciphertext', 'authTag', 'iv']) {
    const bytes = Buffer.from(record[field], 'base64url')
    bytes[0] ^= 1
    assert.throws(() => decryptCookie({ ...record, [field]: bytes.toString('base64url') }, key, scope))
  }
  for (const invalid of ['', ' ', 'cookie: value', 'value\nnext', 'value\rnext', 'value\u0000next']) {
    assert.throws(() => encryptCookie(invalid, key, scope), /COOKIE_VALUE_INVALID/u)
  }
})
