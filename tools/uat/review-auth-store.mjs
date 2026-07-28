import {
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs'
import { dirname } from 'node:path'

const AUTH_STATE_VERSION = 1
const PASSWORD_KEY_BYTES = 32
const SCRYPT_COST = 16_384
const SCRYPT_BLOCK_SIZE = 8
const SCRYPT_PARALLELIZATION = 1
const SCRYPT_MAX_MEMORY = 64 * 1024 * 1024
const USERNAME_PATTERN =
  /^[\p{L}\p{N}][\p{L}\p{N}._@-]{2,63}$/u

const safeEqual = (left, right) => {
  const leftBuffer = Buffer.from(left ?? '', 'utf8')
  const rightBuffer = Buffer.from(right ?? '', 'utf8')
  return (
    leftBuffer.length === rightBuffer.length
    && timingSafeEqual(leftBuffer, rightBuffer)
  )
}

const normalizeUsername = (value) => {
  const normalized = typeof value === 'string' ? value.trim() : ''
  if (!USERNAME_PATTERN.test(normalized)) {
    throw new Error('REVIEW_AUTH_USERNAME_INVALID')
  }
  return normalized
}

const validateNewPassword = (value, username) => {
  if (
    typeof value !== 'string'
    || value.length < 10
    || value.length > 128
    || /[\r\n\u0000]/.test(value)
    || safeEqual(value.toLocaleLowerCase(), username.toLocaleLowerCase())
  ) {
    throw new Error('REVIEW_AUTH_PASSWORD_WEAK')
  }

  const characterClasses = [
    /[\p{Ll}]/u,
    /[\p{Lu}]/u,
    /\p{N}/u,
    /[^\p{L}\p{N}]/u,
  ].filter((pattern) => pattern.test(value)).length
  if (characterClasses < 3) {
    throw new Error('REVIEW_AUTH_PASSWORD_WEAK')
  }
  return value
}

const passwordDigest = (password, salt = randomBytes(16)) => ({
  algorithm: 'scrypt',
  cost: SCRYPT_COST,
  blockSize: SCRYPT_BLOCK_SIZE,
  parallelization: SCRYPT_PARALLELIZATION,
  salt: salt.toString('hex'),
  hash: scryptSync(password, salt, PASSWORD_KEY_BYTES, {
    N: SCRYPT_COST,
    r: SCRYPT_BLOCK_SIZE,
    p: SCRYPT_PARALLELIZATION,
    maxmem: SCRYPT_MAX_MEMORY,
  }).toString('hex'),
})

const validPasswordDigest = (digest) =>
  digest
  && digest.algorithm === 'scrypt'
  && digest.cost === SCRYPT_COST
  && digest.blockSize === SCRYPT_BLOCK_SIZE
  && digest.parallelization === SCRYPT_PARALLELIZATION
  && typeof digest.salt === 'string'
  && /^[0-9a-f]{32}$/.test(digest.salt)
  && typeof digest.hash === 'string'
  && /^[0-9a-f]{64}$/.test(digest.hash)

const verifyPassword = (password, digest) => {
  if (typeof password !== 'string' || !validPasswordDigest(digest)) {
    return false
  }
  const actual = passwordDigest(password, Buffer.from(digest.salt, 'hex'))
  return safeEqual(actual.hash, digest.hash)
}

const normalizePersistedState = (candidate) => {
  if (
    !candidate
    || candidate.version !== AUTH_STATE_VERSION
    || !validPasswordDigest(candidate.passwordDigest)
    || typeof candidate.updatedAt !== 'string'
    || !Number.isFinite(Date.parse(candidate.updatedAt))
  ) {
    throw new Error('REVIEW_AUTH_STATE_INVALID')
  }
  return {
    version: AUTH_STATE_VERSION,
    username: normalizeUsername(candidate.username),
    passwordDigest: candidate.passwordDigest,
    updatedAt: candidate.updatedAt,
  }
}

const persistState = (statePath, state) => {
  mkdirSync(dirname(statePath), { recursive: true })
  const temporaryPath = `${statePath}.${process.pid}.tmp`
  writeFileSync(
    temporaryPath,
    `${JSON.stringify(state, null, 2)}\n`,
    { encoding: 'utf8', mode: 0o600 },
  )
  renameSync(temporaryPath, statePath)
}

export const createReviewAuthStore = ({
  statePath,
  bootstrapUsername,
  bootstrapPassword,
  bootstrapAccessToken,
}) => {
  if (
    typeof statePath !== 'string'
    || statePath.trim() === ''
    || typeof bootstrapPassword !== 'string'
    || bootstrapPassword === ''
    || typeof bootstrapAccessToken !== 'string'
    || bootstrapAccessToken === ''
  ) {
    throw new Error('REVIEW_AUTH_CONFIGURATION_INVALID')
  }

  let state
  let activeAccessToken
  if (existsSync(statePath)) {
    state = normalizePersistedState(
      JSON.parse(readFileSync(statePath, 'utf8')),
    )
    activeAccessToken = randomBytes(32).toString('hex')
  } else {
    state = {
      version: AUTH_STATE_VERSION,
      username: normalizeUsername(bootstrapUsername),
      passwordDigest: passwordDigest(bootstrapPassword),
      updatedAt: new Date().toISOString(),
    }
    persistState(statePath, state)
    activeAccessToken = bootstrapAccessToken
  }

  const session = () => ({
    accessToken: activeAccessToken,
    expiresInSeconds: 14_400,
    username: state.username,
  })

  return {
    authenticate(accessToken) {
      return safeEqual(accessToken, activeAccessToken)
    },

    login(username, password) {
      const usernameMatches = safeEqual(
        typeof username === 'string' ? username.trim() : '',
        state.username,
      )
      const passwordMatches = verifyPassword(
        password,
        state.passwordDigest,
      )
      if (!usernameMatches || !passwordMatches) {
        return null
      }
      activeAccessToken = randomBytes(32).toString('hex')
      return session()
    },

    changeCredentials({
      currentPassword,
      newUsername,
      newPassword,
    }) {
      if (!verifyPassword(currentPassword, state.passwordDigest)) {
        throw new Error('REVIEW_AUTH_CURRENT_PASSWORD_INVALID')
      }
      const username = normalizeUsername(newUsername)
      const password = validateNewPassword(newPassword, username)
      if (
        safeEqual(username, state.username)
        && verifyPassword(password, state.passwordDigest)
      ) {
        throw new Error('REVIEW_AUTH_CREDENTIALS_UNCHANGED')
      }
      state = {
        version: AUTH_STATE_VERSION,
        username,
        passwordDigest: passwordDigest(password),
        updatedAt: new Date().toISOString(),
      }
      persistState(statePath, state)
      activeAccessToken = randomBytes(32).toString('hex')
      return {
        ...session(),
        updatedAt: state.updatedAt,
      }
    },

    currentUsername() {
      return state.username
    },
  }
}
