import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
} from 'node:crypto'

const ALGORITHM = 'aes-256-gcm'
const VERSION = 1
const MAX_COOKIE_BYTES = 16 * 1024

const decodeKey = (encodedKey) => {
  if (typeof encodedKey !== 'string' || encodedKey.length < 40) {
    throw new Error('COOKIE_SECRET_KEY_INVALID')
  }
  const key = Buffer.from(encodedKey, 'base64url')
  if (key.length !== 32) {
    throw new Error('COOKIE_SECRET_KEY_INVALID')
  }
  return key
}

const validateScope = (scope) => {
  if (typeof scope !== 'string' || scope.length < 3 || scope.length > 200) {
    throw new Error('COOKIE_SECRET_SCOPE_INVALID')
  }
  return Buffer.from(`sifangguan-report-cookie:v1:${scope}`, 'utf8')
}

export const validateCookieValue = (cookieValue) => {
  if (
    typeof cookieValue !== 'string'
    || Buffer.byteLength(cookieValue, 'utf8') < 1
    || Buffer.byteLength(cookieValue, 'utf8') > MAX_COOKIE_BYTES
    || cookieValue.trim().length < 1
    || /[\r\n\u0000]/.test(cookieValue)
    || /^\s*cookie\s*:/i.test(cookieValue)
  ) {
    throw new Error('COOKIE_VALUE_INVALID')
  }
}

export const encryptCookie = (cookieValue, encodedKey, scope) => {
  validateCookieValue(cookieValue)
  const key = decodeKey(encodedKey)
  const iv = randomBytes(12)
  const cipher = createCipheriv(ALGORITHM, key, iv)
  cipher.setAAD(validateScope(scope))
  const ciphertext = Buffer.concat([
    cipher.update(cookieValue, 'utf8'),
    cipher.final(),
  ])
  return {
    version: VERSION,
    algorithm: 'AES-256-GCM',
    iv: iv.toString('base64url'),
    ciphertext: ciphertext.toString('base64url'),
    authTag: cipher.getAuthTag().toString('base64url'),
    updatedAt: new Date().toISOString(),
  }
}

export const decryptCookie = (record, encodedKey, scope) => {
  if (
    record === null
    || typeof record !== 'object'
    || record.version !== VERSION
    || record.algorithm !== 'AES-256-GCM'
    || typeof record.iv !== 'string'
    || typeof record.ciphertext !== 'string'
    || typeof record.authTag !== 'string'
  ) {
    throw new Error('COOKIE_SECRET_RECORD_INVALID')
  }
  const decipher = createDecipheriv(
    ALGORITHM,
    decodeKey(encodedKey),
    Buffer.from(record.iv, 'base64url'),
  )
  decipher.setAAD(validateScope(scope))
  decipher.setAuthTag(Buffer.from(record.authTag, 'base64url'))
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(record.ciphertext, 'base64url')),
    decipher.final(),
  ]).toString('utf8')
  validateCookieValue(plaintext)
  return plaintext
}
