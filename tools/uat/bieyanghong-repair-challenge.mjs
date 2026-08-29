import {
  createHash,
  randomBytes,
  randomUUID,
} from 'node:crypto'
import { isIP } from 'node:net'

const CODE_PATTERN = /^\d{4,8}$/u
const PHONE_PATTERN = /^\d{11}$/u
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{40,96}$/u
const DEFAULT_TTL_MS = 10 * 60 * 1000
const DEFAULT_MAX_ATTEMPTS = 3
const DEFAULT_MAX_CREDENTIAL_REQUESTS = 2

const tokenHash = (token) =>
  createHash('sha256').update(token).digest('hex')

const publicRecord = (record) => ({
  challengeId: record.challengeId,
  hotelCode: record.hotelCode,
  hotelName: record.hotelName,
  status: record.status,
  createdAt: record.createdAt,
  updatedAt: record.updatedAt,
  expiresAt: record.expiresAt,
  attemptsUsed: record.attemptsUsed,
  attemptsRemaining: Math.max(
    0,
    record.maxAttempts - record.attemptsUsed,
  ),
  credentialRequestsUsed: record.credentialRequestsUsed,
  credentialRequestsRemaining: Math.max(
    0,
    record.maxCredentialRequests - record.credentialRequestsUsed,
  ),
  reasonCode: record.reasonCode,
})

export const validateBieyanghongRepairPublicBaseUrl = (value) => {
  const raw = String(value ?? '').trim().replace(/\/$/u, '')
  if (!raw) return null
  let url
  try {
    url = new URL(raw)
  } catch {
    throw new Error('BIEYANGHONG_REPAIR_PUBLIC_URL_INVALID')
  }
  if (
    url.protocol !== 'https:'
    || url.port
    || url.username
    || url.password
    || url.search
    || url.hash
    || url.pathname !== '/'
    || !url.hostname.includes('.')
    || isIP(url.hostname) !== 0
  ) {
    throw new Error('BIEYANGHONG_REPAIR_PUBLIC_URL_INVALID')
  }
  return url.origin
}

export const bieyanghongRepairLink = (baseUrl, token) => {
  const origin = validateBieyanghongRepairPublicBaseUrl(baseUrl)
  if (!origin || !TOKEN_PATTERN.test(String(token ?? ''))) {
    throw new Error('BIEYANGHONG_REPAIR_LINK_INVALID')
  }
  return `${origin}/api/v1/bieyanghong-repair#${token}`
}

export const createBieyanghongRepairChallengeStore = ({
  now = () => new Date(),
  tokenBytes = () => randomBytes(32),
  ttlMs = DEFAULT_TTL_MS,
  maxAttempts = DEFAULT_MAX_ATTEMPTS,
  maxCredentialRequests = DEFAULT_MAX_CREDENTIAL_REQUESTS,
} = {}) => {
  if (
    !Number.isInteger(ttlMs)
    || ttlMs < 60_000
    || ttlMs > 30 * 60_000
    || !Number.isInteger(maxAttempts)
    || maxAttempts < 1
    || maxAttempts > 5
    || !Number.isInteger(maxCredentialRequests)
    || maxCredentialRequests < 1
    || maxCredentialRequests > 3
  ) {
    throw new Error('BIEYANGHONG_REPAIR_CHALLENGE_CONFIG_INVALID')
  }

  const recordsByHash = new Map()

  const currentTime = () => {
    const value = now()
    if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
      throw new Error('BIEYANGHONG_REPAIR_CLOCK_INVALID')
    }
    return value
  }

  const expireIfNeeded = (record) => {
    if (
      !['COMPLETE', 'FAILED', 'EXPIRED'].includes(record.status)
      && currentTime().getTime() >= new Date(record.expiresAt).getTime()
    ) {
      record.status = 'EXPIRED'
      record.updatedAt = currentTime().toISOString()
      record.reasonCode = 'BIEYANGHONG_REPAIR_CHALLENGE_EXPIRED'
    }
    return record
  }

  const recordForHash = (hash) => {
    const record = recordsByHash.get(hash)
    return record ? expireIfNeeded(record) : null
  }

  const recordForToken = (token) => {
    if (!TOKEN_PATTERN.test(String(token ?? ''))) return null
    return recordForHash(tokenHash(token))
  }

  const update = (hash, mutator) => {
    const record = recordForHash(hash)
    if (!record) throw new Error('BIEYANGHONG_REPAIR_CHALLENGE_NOT_FOUND')
    mutator(record)
    record.updatedAt = currentTime().toISOString()
    return publicRecord(record)
  }

  return {
    create({ hotelId, hotelCode, hotelName }) {
      if (
        typeof hotelId !== 'string'
        || !hotelId
        || !/^\d{3}$/u.test(String(hotelCode ?? ''))
        || typeof hotelName !== 'string'
        || !hotelName.trim()
      ) {
        throw new Error('BIEYANGHONG_REPAIR_CHALLENGE_INPUT_INVALID')
      }
      const token = tokenBytes().toString('base64url')
      if (!TOKEN_PATTERN.test(token)) {
        throw new Error('BIEYANGHONG_REPAIR_TOKEN_INVALID')
      }
      const hash = tokenHash(token)
      const createdAt = currentTime()
      const record = {
        challengeId: randomUUID(),
        tokenSha256: hash,
        hotelId,
        hotelCode,
        hotelName: hotelName.trim().slice(0, 120),
        status: 'PREPARING',
        createdAt: createdAt.toISOString(),
        updatedAt: createdAt.toISOString(),
        expiresAt: new Date(createdAt.getTime() + ttlMs).toISOString(),
        attemptsUsed: 0,
        maxAttempts,
        credentialRequestsUsed: 0,
        maxCredentialRequests,
        reasonCode: null,
      }
      recordsByHash.set(hash, record)
      return {
        token,
        tokenSha256: hash,
        record: publicRecord(record),
      }
    },

    get(token) {
      const record = recordForToken(token)
      return record ? publicRecord(record) : null
    },

    getInternal(token) {
      const record = recordForToken(token)
      return record ? { ...record } : null
    },

    getInternalByHash(hash) {
      const record = recordForHash(hash)
      return record ? { ...record } : null
    },

    setWaitingForCredentials(hash, reasonCode = null) {
      return update(hash, (record) => {
        if (
          ['COMPLETE', 'FAILED', 'EXPIRED'].includes(record.status)
          || record.credentialRequestsUsed >= record.maxCredentialRequests
        ) {
          throw new Error('BIEYANGHONG_REPAIR_CHALLENGE_CLOSED')
        }
        record.status = 'WAITING_FOR_CREDENTIALS'
        record.reasonCode = reasonCode
      })
    },

    requestCode(token, input) {
      const record = recordForToken(token)
      if (!record) throw new Error('BIEYANGHONG_REPAIR_CHALLENGE_NOT_FOUND')
      if (record.status !== 'WAITING_FOR_CREDENTIALS') {
        throw new Error('BIEYANGHONG_REPAIR_CHALLENGE_NOT_READY')
      }
      let phone = typeof input?.phone === 'string'
        ? input.phone.trim()
        : ''
      let password = typeof input?.password === 'string'
        ? input.password
        : ''
      if (
        !PHONE_PATTERN.test(phone)
        || password.length < 1
        || password.length > 256
        || /[\r\n\u0000]/u.test(password)
      ) {
        phone = ''
        password = ''
        throw new Error('BIEYANGHONG_LOGIN_CREDENTIALS_INVALID')
      }
      if (record.credentialRequestsUsed >= record.maxCredentialRequests) {
        phone = ''
        password = ''
        throw new Error('BIEYANGHONG_REPAIR_CREDENTIAL_REQUESTS_EXHAUSTED')
      }
      record.credentialRequestsUsed += 1
      record.status = 'REQUESTING_CODE'
      record.updatedAt = currentTime().toISOString()
      record.reasonCode = null
      return {
        credentials: { phone, password },
        tokenSha256: record.tokenSha256,
        record: publicRecord(record),
      }
    },

    setWaitingForCode(hash, reasonCode = null) {
      return update(hash, (record) => {
        if (
          ['COMPLETE', 'FAILED', 'EXPIRED'].includes(record.status)
          || record.attemptsUsed >= record.maxAttempts
        ) {
          throw new Error('BIEYANGHONG_REPAIR_CHALLENGE_CLOSED')
        }
        record.status = 'WAITING_FOR_CODE'
        record.reasonCode = reasonCode
      })
    },

    setWaitingForInteractiveVerification(hash, reasonCode) {
      return update(hash, (record) => {
        if (
          record.status !== 'REQUESTING_CODE'
          || record.credentialRequestsUsed < 1
        ) {
          throw new Error('BIEYANGHONG_REPAIR_CHALLENGE_CLOSED')
        }
        record.status = 'WAITING_FOR_INTERACTIVE_VERIFICATION'
        record.reasonCode =
          typeof reasonCode === 'string'
          && /^[A-Z][A-Z0-9_]{2,80}$/u.test(reasonCode)
            ? reasonCode
            : 'BIEYANGHONG_LOGIN_RISK_CHALLENGE_REQUIRED'
      })
    },

    submit(token, code) {
      const record = recordForToken(token)
      if (!record) throw new Error('BIEYANGHONG_REPAIR_CHALLENGE_NOT_FOUND')
      if (record.status !== 'WAITING_FOR_CODE') {
        throw new Error('BIEYANGHONG_REPAIR_CHALLENGE_NOT_READY')
      }
      const answer = String(code ?? '').trim()
      if (!CODE_PATTERN.test(answer)) {
        throw new Error('BIEYANGHONG_REPAIR_CODE_INVALID')
      }
      if (record.attemptsUsed >= record.maxAttempts) {
        throw new Error('BIEYANGHONG_REPAIR_ATTEMPTS_EXHAUSTED')
      }
      record.attemptsUsed += 1
      record.status = 'SUBMITTED'
      record.updatedAt = currentTime().toISOString()
      record.reasonCode = null
      return {
        answer,
        tokenSha256: record.tokenSha256,
        record: publicRecord(record),
      }
    },

    markVerifying(hash) {
      return update(hash, (record) => {
        if (![
          'PREPARING',
          'REQUESTING_CODE',
          'WAITING_FOR_INTERACTIVE_VERIFICATION',
          'SUBMITTED',
          'VERIFYING',
        ].includes(record.status)) {
          throw new Error('BIEYANGHONG_REPAIR_CHALLENGE_NOT_SUBMITTED')
        }
        record.status = 'VERIFYING'
      })
    },

    complete(hash) {
      return update(hash, (record) => {
        record.status = 'COMPLETE'
        record.reasonCode = null
      })
    },

    fail(hash, reasonCode) {
      return update(hash, (record) => {
        record.status = 'FAILED'
        record.reasonCode =
          typeof reasonCode === 'string'
          && /^[A-Z][A-Z0-9_]{2,80}$/u.test(reasonCode)
            ? reasonCode
            : 'BIEYANGHONG_REPAIR_FAILED'
      })
    },

    cleanupExpired() {
      for (const record of recordsByHash.values()) expireIfNeeded(record)
    },

    debugSnapshot() {
      return [...recordsByHash.values()].map((record) => ({
        ...publicRecord(expireIfNeeded(record)),
        tokenSha256: record.tokenSha256,
      }))
    },
  }
}
