import {
  randomBytes,
  randomUUID,
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

const AUTH_STATE_VERSION = 2
const PASSWORD_KEY_BYTES = 32
const SCRYPT_COST = 16_384
const SCRYPT_BLOCK_SIZE = 8
const SCRYPT_PARALLELIZATION = 1
const SCRYPT_MAX_MEMORY = 64 * 1024 * 1024
const SESSION_TTL_SECONDS = 14_400
const USERNAME_PATTERN =
  /^[\p{L}\p{N}][\p{L}\p{N}._@-]{2,63}$/u
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu
const ALLOWED_ROLES = new Set([
  'PLATFORM_ADMIN',
  'OTA_OPERATION_ASSISTANT',
  'OTA_OPERATION_MANAGER',
  'CEO',
  'REGIONAL_MANAGER',
  'GENERAL_MANAGER',
  'REVENUE_MANAGER',
  'HOTEL_P1_HANDLER',
])

const safeEqual = (left, right) => {
  const leftBuffer = Buffer.from(left ?? '', 'utf8')
  const rightBuffer = Buffer.from(right ?? '', 'utf8')
  return leftBuffer.length === rightBuffer.length
    && timingSafeEqual(leftBuffer, rightBuffer)
}

const normalizeUsername = (value) => {
  const normalized = typeof value === 'string' ? value.trim() : ''
  if (!USERNAME_PATTERN.test(normalized)) {
    throw new Error('REVIEW_AUTH_USERNAME_INVALID')
  }
  return normalized
}

const normalizeDisplayName = (value) => {
  const normalized = typeof value === 'string' ? value.trim() : ''
  if (
    normalized.length < 2
    || normalized.length > 60
    || /[\r\n\u0000]/u.test(normalized)
  ) throw new Error('REVIEW_AUTH_DISPLAY_NAME_INVALID')
  return normalized
}

const validateNewPassword = (value, username) => {
  if (
    typeof value !== 'string'
    || value.length < 10
    || value.length > 128
    || /[\r\n\u0000]/u.test(value)
    || safeEqual(value.toLocaleLowerCase(), username.toLocaleLowerCase())
  ) throw new Error('REVIEW_AUTH_PASSWORD_WEAK')

  const characterClasses = [
    /[\p{Ll}]/u,
    /[\p{Lu}]/u,
    /\p{N}/u,
    /[^\p{L}\p{N}]/u,
  ].filter((pattern) => pattern.test(value)).length
  if (characterClasses < 3) throw new Error('REVIEW_AUTH_PASSWORD_WEAK')
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
  && /^[0-9a-f]{32}$/u.test(digest.salt)
  && typeof digest.hash === 'string'
  && /^[0-9a-f]{64}$/u.test(digest.hash)

const verifyPassword = (password, digest) => {
  if (typeof password !== 'string' || !validPasswordDigest(digest)) return false
  const actual = passwordDigest(password, Buffer.from(digest.salt, 'hex'))
  return safeEqual(actual.hash, digest.hash)
}

const normalizeRoles = (value) => {
  if (!Array.isArray(value)) throw new Error('REVIEW_AUTH_ROLES_INVALID')
  const roles = [...new Set(value.map((role) => String(role).trim()))]
  if (
    roles.length < 1
    || roles.length > ALLOWED_ROLES.size
    || roles.some((role) => !ALLOWED_ROLES.has(role))
  ) throw new Error('REVIEW_AUTH_ROLES_INVALID')
  return roles
}

const normalizeHotelIds = (value, roles) => {
  if (roles.includes('PLATFORM_ADMIN')) return []
  if (!Array.isArray(value)) throw new Error('REVIEW_AUTH_HOTEL_SCOPE_INVALID')
  const hotelIds = [...new Set(value.map((item) => String(item).trim()))]
  if (
    hotelIds.length < 1
    || hotelIds.length > 100
    || hotelIds.some((hotelId) => !UUID_PATTERN.test(hotelId))
  ) throw new Error('REVIEW_AUTH_HOTEL_SCOPE_INVALID')
  return hotelIds
}

const normalizeAccount = (candidate) => {
  if (
    !candidate
    || typeof candidate.accountId !== 'string'
    || !UUID_PATTERN.test(candidate.accountId)
    || !validPasswordDigest(candidate.passwordDigest)
    || typeof candidate.enabled !== 'boolean'
    || typeof candidate.createdAt !== 'string'
    || !Number.isFinite(Date.parse(candidate.createdAt))
    || typeof candidate.updatedAt !== 'string'
    || !Number.isFinite(Date.parse(candidate.updatedAt))
  ) throw new Error('REVIEW_AUTH_STATE_INVALID')
  const roles = normalizeRoles(candidate.roles)
  return {
    accountId: candidate.accountId,
    username: normalizeUsername(candidate.username),
    displayName: normalizeDisplayName(candidate.displayName),
    passwordDigest: candidate.passwordDigest,
    roles,
    hotelIds: normalizeHotelIds(candidate.hotelIds, roles),
    enabled: candidate.enabled,
    createdAt: candidate.createdAt,
    updatedAt: candidate.updatedAt,
  }
}

const normalizePersistedState = (candidate) => {
  if (!candidate || candidate.version !== AUTH_STATE_VERSION || !Array.isArray(candidate.accounts)) {
    throw new Error('REVIEW_AUTH_STATE_INVALID')
  }
  const accounts = candidate.accounts.map(normalizeAccount)
  if (
    accounts.length < 1
    || new Set(accounts.map((account) => account.username.toLocaleLowerCase())).size !== accounts.length
    || !accounts.some((account) => account.enabled && account.roles.includes('PLATFORM_ADMIN'))
  ) throw new Error('REVIEW_AUTH_STATE_INVALID')
  return { version: AUTH_STATE_VERSION, accounts }
}

const migrateVersionOneState = (candidate) => {
  if (
    !candidate
    || candidate.version !== 1
    || !validPasswordDigest(candidate.passwordDigest)
    || typeof candidate.updatedAt !== 'string'
    || !Number.isFinite(Date.parse(candidate.updatedAt))
  ) return null
  return {
    version: AUTH_STATE_VERSION,
    accounts: [{
      accountId: '90000000-0000-4000-8000-000000000001',
      username: normalizeUsername(candidate.username),
      displayName: '平台管理员',
      passwordDigest: candidate.passwordDigest,
      roles: [
        'PLATFORM_ADMIN',
        'OTA_OPERATION_MANAGER',
        'CEO',
        'REGIONAL_MANAGER',
        'REVENUE_MANAGER',
      ],
      hotelIds: [],
      enabled: true,
      createdAt: candidate.updatedAt,
      updatedAt: candidate.updatedAt,
    }],
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

const publicAccount = (account) => ({
  id: account.accountId,
  username: account.username,
  displayName: account.displayName,
  roles: [...account.roles],
  hotelIds: account.roles.includes('PLATFORM_ADMIN')
    ? null
    : [...account.hotelIds],
  enabled: account.enabled,
  createdAt: account.createdAt,
  updatedAt: account.updatedAt,
})

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
  ) throw new Error('REVIEW_AUTH_CONFIGURATION_INVALID')

  let state
  let initialToken = bootstrapAccessToken
  if (existsSync(statePath)) {
    const parsed = JSON.parse(readFileSync(statePath, 'utf8'))
    const migrated = migrateVersionOneState(parsed)
    state = migrated ?? normalizePersistedState(parsed)
    initialToken = randomBytes(32).toString('hex')
  } else {
    const now = new Date().toISOString()
    state = {
      version: AUTH_STATE_VERSION,
      accounts: [{
        accountId: '90000000-0000-4000-8000-000000000001',
        username: normalizeUsername(bootstrapUsername),
        displayName: '平台管理员',
        passwordDigest: passwordDigest(bootstrapPassword),
        roles: [
          'PLATFORM_ADMIN',
          'OTA_OPERATION_MANAGER',
          'CEO',
          'REGIONAL_MANAGER',
          'REVENUE_MANAGER',
        ],
        hotelIds: [],
        enabled: true,
        createdAt: now,
        updatedAt: now,
      }],
    }
    persistState(statePath, state)
  }

  const sessions = new Map()
  const initialAdmin = state.accounts.find((account) =>
    account.enabled && account.roles.includes('PLATFORM_ADMIN'))
  sessions.set(initialToken, {
    accountId: initialAdmin.accountId,
    expiresAt: Date.now() + SESSION_TTL_SECONDS * 1_000,
  })

  const accountByToken = (accessToken) => {
    const token = typeof accessToken === 'string' ? accessToken : ''
    const session = sessions.get(token)
    if (!session || session.expiresAt <= Date.now()) {
      sessions.delete(token)
      return null
    }
    return state.accounts.find((account) =>
      account.accountId === session.accountId && account.enabled) ?? null
  }

  const invalidateAccountSessions = (accountId) => {
    for (const [token, session] of sessions.entries()) {
      if (session.accountId === accountId) sessions.delete(token)
    }
  }

  const sessionFor = (account, token = randomBytes(32).toString('hex')) => {
    sessions.set(token, {
      accountId: account.accountId,
      expiresAt: Date.now() + SESSION_TTL_SECONDS * 1_000,
    })
    const view = publicAccount(account)
    return {
      accessToken: token,
      expiresInSeconds: SESSION_TTL_SECONDS,
      username: account.username,
      account: {
        id: view.id,
        displayName: view.displayName,
        roles: view.roles,
        hotelIds: view.hotelIds,
      },
    }
  }

  const persist = () => persistState(statePath, state)
  const assertUniqueUsername = (username, ignoredAccountId = null) => {
    if (state.accounts.some((account) =>
      account.accountId !== ignoredAccountId
      && account.username.toLocaleLowerCase() === username.toLocaleLowerCase())) {
      throw new Error('REVIEW_AUTH_USERNAME_CONFLICT')
    }
  }

  return {
    authenticate(accessToken) {
      return Boolean(accountByToken(accessToken))
    },

    principal(accessToken) {
      const account = accountByToken(accessToken)
      return account ? publicAccount(account) : null
    },

    login(username, password) {
      const normalized = typeof username === 'string' ? username.trim() : ''
      const account = state.accounts.find((candidate) =>
        candidate.enabled
        && safeEqual(candidate.username.toLocaleLowerCase(), normalized.toLocaleLowerCase()))
      if (!account || !verifyPassword(password, account.passwordDigest)) return null
      invalidateAccountSessions(account.accountId)
      return sessionFor(account)
    },

    logout(accessToken) {
      sessions.delete(typeof accessToken === 'string' ? accessToken : '')
    },

    changeCredentials({
      accessToken = null,
      currentPassword,
      newUsername,
      newPassword,
    }) {
      const account = accessToken
        ? accountByToken(accessToken)
        : state.accounts.length === 1 ? state.accounts[0] : null
      if (!account) throw new Error('REVIEW_AUTH_SESSION_REQUIRED')
      if (!verifyPassword(currentPassword, account.passwordDigest)) {
        throw new Error('REVIEW_AUTH_CURRENT_PASSWORD_INVALID')
      }
      const username = normalizeUsername(newUsername)
      const password = validateNewPassword(newPassword, username)
      assertUniqueUsername(username, account.accountId)
      if (
        safeEqual(username, account.username)
        && verifyPassword(password, account.passwordDigest)
      ) throw new Error('REVIEW_AUTH_CREDENTIALS_UNCHANGED')
      account.username = username
      account.passwordDigest = passwordDigest(password)
      account.updatedAt = new Date().toISOString()
      persist()
      invalidateAccountSessions(account.accountId)
      return sessionFor(account)
    },

    listAccounts() {
      return state.accounts.map(publicAccount)
    },

    createAccount({ username, displayName, password, roles, hotelIds }) {
      const normalizedUsername = normalizeUsername(username)
      const normalizedRoles = normalizeRoles(roles)
      const normalizedHotels = normalizeHotelIds(hotelIds, normalizedRoles)
      validateNewPassword(password, normalizedUsername)
      assertUniqueUsername(normalizedUsername)
      const now = new Date().toISOString()
      const account = {
        accountId: randomUUID(),
        username: normalizedUsername,
        displayName: normalizeDisplayName(displayName),
        passwordDigest: passwordDigest(password),
        roles: normalizedRoles,
        hotelIds: normalizedHotels,
        enabled: true,
        createdAt: now,
        updatedAt: now,
      }
      state.accounts.push(account)
      persist()
      return publicAccount(account)
    },

    updateAccount({ accountId, displayName, roles, hotelIds, enabled, newPassword }) {
      const account = state.accounts.find((candidate) => candidate.accountId === accountId)
      if (!account) throw new Error('REVIEW_AUTH_ACCOUNT_NOT_FOUND')
      const normalizedRoles = normalizeRoles(roles)
      const normalizedHotels = normalizeHotelIds(hotelIds, normalizedRoles)
      if (typeof enabled !== 'boolean') throw new Error('REVIEW_AUTH_ACCOUNT_STATUS_INVALID')
      if (
        account.roles.includes('PLATFORM_ADMIN')
        && (!enabled || !normalizedRoles.includes('PLATFORM_ADMIN'))
        && state.accounts.filter((candidate) =>
          candidate.accountId !== account.accountId
          && candidate.enabled
          && candidate.roles.includes('PLATFORM_ADMIN')).length === 0
      ) throw new Error('REVIEW_AUTH_LAST_PLATFORM_ADMIN_REQUIRED')
      account.displayName = normalizeDisplayName(displayName)
      account.roles = normalizedRoles
      account.hotelIds = normalizedHotels
      account.enabled = enabled
      if (typeof newPassword === 'string' && newPassword.length > 0) {
        account.passwordDigest = passwordDigest(
          validateNewPassword(newPassword, account.username),
        )
      }
      account.updatedAt = new Date().toISOString()
      persist()
      invalidateAccountSessions(account.accountId)
      return publicAccount(account)
    },

    currentUsername() {
      return initialAdmin.username
    },
  }
}
