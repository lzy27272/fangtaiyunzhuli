import {
  createHash,
  randomInt,
} from 'node:crypto'
import weComSdk from '../../vendor/wecom-aibot-sdk-1.0.7.cjs'
import {
  normalizeRepairAdminState,
  normalizeRepairAdminHotelIds,
  normalizeRepairAdminName,
} from './wecom-repair-admins.mjs'
import { normalizeRepairApprovalState } from './wecom-repair-approvals.mjs'

const { WSClient, generateReqId } = weComSdk

const BOT_ID_PATTERN = /^[A-Za-z0-9._:-]{6,128}$/u
const SECRET_PATTERN = /^[\x21-\x7e]{16,256}$/u
const USER_ID_PATTERN = /^[^\s\x00-\x1f\x7f]{1,128}$/u
const PAIRING_CODE_PATTERN = /^\d{6}$/u
const CAPTCHA_PATTERN = /^[A-Za-z0-9]{4,8}$/u
const DEFAULT_PAIRING_TTL_MS = 24 * 60 * 60 * 1000
const DEFAULT_PAIRING_ATTEMPTS = 5
export const WECOM_REPAIR_BOT_MAX_ALLOWED_USERS = 2
export const WECOM_REPAIR_BOT_MAX_STORE_USERS = 20
const WECOM_REPAIR_BOT_MAX_STORE_COUNT = 200
const HOTEL_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/u

const hash = (value) =>
  createHash('sha256').update(String(value), 'utf8').digest('hex')

export const fingerprintWeComRepairBotValue = (value) => hash(value)

export const normalizeWeComRepairBotAllowedUserIds = (candidate) => {
  const source = Array.isArray(candidate?.allowedUserIds)
    ? candidate.allowedUserIds
    : candidate?.allowedUserId == null
      ? []
      : [candidate.allowedUserId]
  const allowedUserIds = [...new Set(source.map((value) =>
    String(value ?? '').trim()))]
  if (
    allowedUserIds.length > WECOM_REPAIR_BOT_MAX_ALLOWED_USERS
    || allowedUserIds.some((userId) => !USER_ID_PATTERN.test(userId))
  ) {
    throw new Error('WECOM_REPAIR_BOT_ALLOWED_USERS_INVALID')
  }
  return allowedUserIds
}

export const normalizeWeComRepairBotHotelAllowedUserIds = (candidate) => {
  const source = candidate?.hotelAllowedUserIds == null
    ? {}
    : candidate.hotelAllowedUserIds
  if (
    !source
    || typeof source !== 'object'
    || Array.isArray(source)
    || Object.keys(source).length > WECOM_REPAIR_BOT_MAX_STORE_COUNT
  ) {
    throw new Error('WECOM_REPAIR_BOT_HOTEL_ALLOWED_USERS_INVALID')
  }
  const entries = Object.entries(source)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([hotelId, candidateUserIds]) => {
      const allowedUserIds = [...new Set(
        (Array.isArray(candidateUserIds) ? candidateUserIds : [])
          .map((value) => String(value ?? '').trim()),
      )]
      if (
        !HOTEL_ID_PATTERN.test(hotelId)
        || !Array.isArray(candidateUserIds)
        || allowedUserIds.length > WECOM_REPAIR_BOT_MAX_STORE_USERS
        || allowedUserIds.some((userId) => !USER_ID_PATTERN.test(userId))
      ) {
        throw new Error('WECOM_REPAIR_BOT_HOTEL_ALLOWED_USERS_INVALID')
      }
      return [hotelId, allowedUserIds]
    })
  return Object.fromEntries(entries)
}

export const normalizeWeComRepairBotCredentials = (candidate) => {
  const botId = String(candidate?.botId ?? '').trim()
  const secret = String(candidate?.secret ?? '').trim()
  const allowedUserIds = normalizeWeComRepairBotAllowedUserIds(candidate)
  const hotelAllowedUserIds =
    normalizeWeComRepairBotHotelAllowedUserIds(candidate)
  if (
    !BOT_ID_PATTERN.test(botId)
    || !SECRET_PATTERN.test(secret)
  ) {
    throw new Error('WECOM_REPAIR_BOT_CREDENTIALS_INVALID')
  }
  return {
    botId,
    secret,
    allowedUserId: allowedUserIds[0] ?? null,
    allowedUserIds,
    hotelAllowedUserIds,
    ...normalizeRepairAdminState(candidate),
    bindingApproval: normalizeRepairApprovalState(candidate),
  }
}

export const weComRepairBotRecipientsForHotel = (credentials, hotelId) => {
  const allowedUserIds = normalizeWeComRepairBotAllowedUserIds(credentials)
  const hotelAllowedUserIds =
    normalizeWeComRepairBotHotelAllowedUserIds(credentials)
  const scopedUserIds = hotelAllowedUserIds[String(hotelId ?? '')] ?? []
  return [...new Set([...allowedUserIds, ...scopedUserIds])]
}

export const weComRepairBotCanRepairHotel = ({
  credentials,
  userId,
  hotelId,
  allowGlobalRepairActions = false,
}) => {
  const normalizedUserId = String(userId ?? '').trim()
  if (!USER_ID_PATTERN.test(normalizedUserId)) return false
  const globalUserIds = normalizeWeComRepairBotAllowedUserIds(credentials)
  const hotelUserIds = normalizeWeComRepairBotHotelAllowedUserIds(
    credentials,
  )[String(hotelId ?? '')] ?? []
  return hotelUserIds.includes(normalizedUserId)
    || (
      allowGlobalRepairActions === true
      && globalUserIds.includes(normalizedUserId)
    )
}

export const selectWeComRepairNoticeChannels = ({
  repairBotReady = false,
  recipientCount = 0,
  groupWebhookEnabled = false,
  groupWebhookConfigured = false,
} = {}) => {
  const channels = []
  if (
    repairBotReady === true
    && Number.isInteger(recipientCount)
    && recipientCount > 0
  ) channels.push('WECOM_LONG_CONNECTION')
  if (groupWebhookEnabled === true && groupWebhookConfigured === true) {
    channels.push('WECOM_GROUP_WEBHOOK')
  }
  return channels
}

const REPAIR_GROUP_NOTICE_TYPES = new Set([
  'PMS_REPAIR_REQUIRED',
  'YILIAN_REPAIR_REQUIRED',
  'DAILY_MORNING_REPAIR_COMPLETE',
  'DAILY_MORNING_REPAIR_FAILED',
])

export const shouldFanOutWeComRepairNotice = (deliveryType) =>
  REPAIR_GROUP_NOTICE_TYPES.has(deliveryType)

const LOCAL_GROUP_POLICY_RETRY_REASONS = new Set([
  'WECOM_PAYLOAD_INVALID',
  'WECOM_TEMPLATE_POLICY_REQUIRED',
])

export const planWeComRepairNoticeDeliveries = ({
  messageKey,
  channels,
  deliveryForKey,
}) => {
  const existingBase = deliveryForKey(messageKey)
  const baseChannel = existingBase
    ? existingBase.deliveryChannel === 'WECOM_LONG_CONNECTION'
      ? 'WECOM_LONG_CONNECTION'
      : 'WECOM_GROUP_WEBHOOK'
    : channels[0]

  return channels.map((channel) => {
    const canonicalKey = channel === baseChannel
      ? messageKey
      : `${messageKey}:${channel}`
    const existing = deliveryForKey(canonicalKey)
    const canRetryLocalGroupPolicy =
      channel === 'WECOM_GROUP_WEBHOOK'
      && existing?.deliveryStatus === 'REJECTED'
      && Number(existing.deliveredPartCount ?? 0) === 0
      && LOCAL_GROUP_POLICY_RETRY_REASONS.has(existing.reasonCode)
    return {
      channel,
      messageKey: canRetryLocalGroupPolicy
        ? `${canonicalKey}:LOCAL_POLICY_V2`
        : canonicalKey,
    }
  })
}

export const deliverWeComRepairBotToAllowedUsers = async ({
  credentials,
  hotelId = null,
  allowedUserIds: explicitAllowedUserIds = null,
  deliver,
}) => {
  const allowedUserIds = Array.isArray(explicitAllowedUserIds)
    ? [...new Set(explicitAllowedUserIds.map((value) =>
      String(value ?? '').trim()))]
    : hotelId
      ? weComRepairBotRecipientsForHotel(credentials, hotelId)
      : normalizeWeComRepairBotAllowedUserIds(credentials)
  if (
    allowedUserIds.length
      > WECOM_REPAIR_BOT_MAX_ALLOWED_USERS + WECOM_REPAIR_BOT_MAX_STORE_USERS
    || allowedUserIds.some((userId) => !USER_ID_PATTERN.test(userId))
  ) throw new Error('WECOM_REPAIR_BOT_ALLOWED_USERS_INVALID')
  if (allowedUserIds.length === 0) {
    throw new Error('WECOM_REPAIR_BOT_PAIRING_REQUIRED')
  }
  if (typeof deliver !== 'function') {
    throw new Error('WECOM_REPAIR_BOT_DELIVERY_INVALID')
  }
  return Promise.allSettled(
    allowedUserIds.map((userId, partIndex) => deliver(userId, partIndex)),
  )
}

export const parseWeComRepairBotText = (value) => {
  const content = String(value ?? '').trim()
  const pairing = content.match(/^(?:绑定|\/bind)\s+(\d{6})$/iu)
  if (pairing) return { type: 'PAIR', pairingCode: pairing[1] }
  const yilianRepair = content.match(
    /^(?:恢复|快速恢复|一键恢复)\s*(\d{3})$/u,
  ) ?? content.match(
    /^(\d{3})\s*(?:恢复|快速恢复|一键恢复)$/u,
  )
  if (yilianRepair) {
    return {
      type: 'YILIAN_REPAIR',
      hotelCode: yilianRepair[1],
    }
  }
  const captcha = content.match(/^(\d{3})\s+([A-Za-z0-9]{4,8})$/u)
  if (captcha) {
    return {
      type: 'CAPTCHA',
      hotelCode: captcha[1],
      captcha: captcha[2],
    }
  }
  if (/^(?:帮助|状态|help|status)$/iu.test(content)) {
    return { type: 'HELP' }
  }
  return { type: 'INVALID' }
}

export const yilianRepairCardDeliveryActive = (
  delivery,
  now = new Date(),
  authorizedRecipientSha256s = null,
) => {
  const nowAt = now instanceof Date ? now.getTime() : Number.NaN
  if (!Number.isFinite(nowAt) || !Array.isArray(delivery?.parts)) return false
  const authorizedRecipients = authorizedRecipientSha256s == null
    ? null
    : new Set(authorizedRecipientSha256s)
  return delivery.parts.some((part) => {
    const action = part?.templateCardAction
    if (action?.version !== 1) return false
    if (
      authorizedRecipients
      && !authorizedRecipients.has(action.recipientSha256)
    ) return false
    if (
      action.status === 'CONSUMED'
      && ['PENDING', 'RUNNING'].includes(action.operationState)
    ) return true
    const expiresAt = Date.parse(action.expiresAt ?? '')
    return action.status === 'ACTIVE'
      && part.deliveryStatus === 'DELIVERED'
      && Number.isFinite(expiresAt)
      && expiresAt > nowAt
  })
}

export const planYilianRepairCardDelivery = ({
  messageKey,
  deliveries,
  now = new Date(),
  retryMs,
  generationTtlMs,
  maxAttempts,
  maxGenerations,
  authorizedRecipientSha256s = null,
}) => {
  const normalizedMessageKey = String(messageKey ?? '').trim()
  const nowAt = now instanceof Date ? now.getTime() : Number.NaN
  if (
    normalizedMessageKey.length === 0
    || !Number.isFinite(nowAt)
    || !Number.isInteger(retryMs)
    || retryMs < 1
    || !Number.isInteger(generationTtlMs)
    || generationTtlMs < retryMs
    || !Number.isInteger(maxAttempts)
    || maxAttempts < 1
    || !Number.isInteger(maxGenerations)
    || maxGenerations < 1
  ) throw new Error('YILIAN_WECOM_CARD_PLAN_INVALID')

  const legacyPrefix = `${normalizedMessageKey}:CARD_ACTION_V1`
  const generationPrefix = `${normalizedMessageKey}:CARD_ACTION_V2`
  const authorizedRecipients = authorizedRecipientSha256s == null
    ? null
    : new Set(authorizedRecipientSha256s)
  const attempts = []
  for (const delivery of deliveries ?? []) {
    const deliveryMessageKey = String(delivery?.messageKey ?? '')
    let generation = null
    if (
      deliveryMessageKey === legacyPrefix
      || deliveryMessageKey.startsWith(`${legacyPrefix}:RETRY_`)
    ) {
      generation = 0
    } else if (deliveryMessageKey.startsWith(`${generationPrefix}:G`)) {
      const suffix = deliveryMessageKey.slice(generationPrefix.length)
      const match = suffix.match(/^:G([1-9]\d*)(?::RETRY_([2-9]\d*))?$/u)
      if (match) generation = Number.parseInt(match[1], 10)
    }
    if (generation != null) attempts.push({ delivery, generation })
  }
  if (attempts.some(({ delivery }) =>
    yilianRepairCardDeliveryActive(delivery, now, authorizedRecipients))) {
    return {
      due: false,
      messageKey: `${generationPrefix}:G1`,
      reasonCode: 'YILIAN_WECOM_CARD_STILL_ACTIONABLE',
    }
  }

  const latestGeneration = attempts.reduce(
    (latest, attempt) => Math.max(latest, attempt.generation),
    attempts.length > 0 ? 0 : 1,
  )
  const generationAttempts = attempts
    .filter((attempt) => attempt.generation === latestGeneration)
    .map((attempt) => attempt.delivery)
    .sort((left, right) =>
      String(left.attemptedAt).localeCompare(String(right.attemptedAt)))
  const baseKeyFor = (generation) =>
    `${generationPrefix}:G${generation}`
  if (generationAttempts.length === 0) {
    return { due: true, messageKey: baseKeyFor(1), reasonCode: null }
  }
  const generationHasAuthorizedRecipient = authorizedRecipients == null
    || generationAttempts.some((delivery) =>
      (delivery.parts ?? []).some((part) =>
        part?.templateCardAction?.version === 1
        && authorizedRecipients.has(
          part.templateCardAction.recipientSha256,
        )))
  if (!generationHasAuthorizedRecipient) {
    const nextGeneration = Math.max(1, latestGeneration + 1)
    return nextGeneration <= maxGenerations
      ? {
        due: true,
        messageKey: baseKeyFor(nextGeneration),
        reasonCode: null,
      }
      : {
        due: false,
        messageKey: baseKeyFor(maxGenerations),
        reasonCode: 'YILIAN_WECOM_CARD_GENERATION_LIMIT_REACHED',
      }
  }

  const attemptTimes = generationAttempts
    .map((delivery) => Date.parse(
      delivery.completedAt
      ?? delivery.attemptedAt
      ?? delivery.parts?.find((part) => part?.templateCardAction)
        ?.templateCardAction?.issuedAt
      ?? '',
    ))
    .filter(Number.isFinite)
  if (attemptTimes.length === 0) {
    return {
      due: false,
      messageKey: baseKeyFor(Math.max(1, latestGeneration)),
      reasonCode: 'YILIAN_WECOM_CARD_ATTEMPT_TIME_INVALID',
    }
  }
  const latestAt = Math.max(...attemptTimes)
  if (nowAt - latestAt < retryMs) {
    return {
      due: false,
      messageKey: baseKeyFor(Math.max(1, latestGeneration)),
      reasonCode: 'YILIAN_WECOM_CARD_RETRY_COOLDOWN',
    }
  }

  const actions = generationAttempts.flatMap((delivery) =>
    (delivery.parts ?? [])
      .map((part) => part?.templateCardAction)
      .filter((action) => action?.version === 1))
  const terminalConsumption = actions.some((action) =>
    action.status === 'CONSUMED'
    && !['PENDING', 'RUNNING'].includes(action.operationState))
  const expired = actions.some((action) => {
    const expiresAt = Date.parse(action.expiresAt ?? '')
    return action.status === 'EXPIRED'
      || (Number.isFinite(expiresAt) && expiresAt <= nowAt)
  })
  const attemptsExhausted = generationAttempts.length >= maxAttempts
  const generationStartedAt = Math.min(...attemptTimes)
  const generationWindowElapsed = nowAt - generationStartedAt
    >= generationTtlMs
  const needsNewGeneration = latestGeneration === 0
    || terminalConsumption
    || expired
    || (attemptsExhausted && generationWindowElapsed)

  if (needsNewGeneration) {
    const nextGeneration = Math.max(1, latestGeneration + 1)
    if (nextGeneration > maxGenerations) {
      return {
        due: false,
        messageKey: baseKeyFor(maxGenerations),
        reasonCode: 'YILIAN_WECOM_CARD_GENERATION_LIMIT_REACHED',
      }
    }
    return {
      due: true,
      messageKey: baseKeyFor(nextGeneration),
      reasonCode: null,
    }
  }
  if (attemptsExhausted) {
    return {
      due: false,
      messageKey: baseKeyFor(Math.max(1, latestGeneration)),
      reasonCode: 'YILIAN_WECOM_CARD_ATTEMPTS_EXHAUSTED',
    }
  }
  const retryNumber = generationAttempts.length + 1
  return {
    due: true,
    messageKey: `${baseKeyFor(Math.max(1, latestGeneration))}:RETRY_${retryNumber}`,
    reasonCode: null,
  }
}

export const consumeWeComRepairTemplateCardAction = ({
  deliveries,
  userId,
  taskId,
  eventKey,
  callbackMessageId,
  now = new Date(),
  canRepairHotel,
  currentIncidentIdForHotel,
  lastSucceededAtForHotel,
  persist,
}) => {
  const normalizedUserId = String(userId ?? '').trim()
  const normalizedTaskId = String(taskId ?? '').trim()
  const normalizedEventKey = String(eventKey ?? '').trim()
  const normalizedCallbackMessageId = String(callbackMessageId ?? '').trim()
  if (
    !USER_ID_PATTERN.test(normalizedUserId)
    || !/^sfg_[a-f0-9]{48}$/u.test(normalizedTaskId)
    || !/^YILIAN_REPAIR_\d{3}$/u.test(normalizedEventKey)
    || normalizedCallbackMessageId.length === 0
    || typeof canRepairHotel !== 'function'
    || typeof currentIncidentIdForHotel !== 'function'
    || typeof lastSucceededAtForHotel !== 'function'
    || typeof persist !== 'function'
  ) return { status: 'INVALID', hotelId: null, messageHash: null }

  const taskIdSha256 = hash(normalizedTaskId)
  const recipientSha256 = hash(normalizedUserId)
  const matches = []
  for (const delivery of deliveries ?? []) {
    if (
      delivery?.deliveryType !== 'PMS_REPAIR_REQUIRED'
      || delivery?.deliveryChannel !== 'WECOM_LONG_CONNECTION'
    ) continue
    for (const part of delivery.parts ?? []) {
      const action = part?.templateCardAction
      if (
        action?.version === 1
        && action.taskIdSha256 === taskIdSha256
        && action.recipientSha256 === recipientSha256
        && action.eventKey === normalizedEventKey
      ) matches.push({ delivery, action })
    }
  }
  if (matches.length !== 1) {
    return { status: 'INVALID', hotelId: null, messageHash: null }
  }
  const matched = matches[0]
  const hotelId = String(matched.delivery.hotelId ?? '')
  if (!canRepairHotel(hotelId)) {
    return { status: 'FORBIDDEN', hotelId, messageHash: null }
  }
  if (
    matched.action.status === 'CONSUMED'
    || matched.action.consumedAt != null
  ) {
    return { status: 'ALREADY_CONSUMED', hotelId, messageHash: null }
  }

  const transition = (patch) => {
    const previous = { ...matched.action }
    Object.assign(matched.action, patch)
    try {
      persist()
    } catch (error) {
      for (const key of Object.keys(matched.action)) delete matched.action[key]
      Object.assign(matched.action, previous)
      throw error
    }
  }
  const nowAt = now instanceof Date ? now.getTime() : Number.NaN
  const issuedAt = Date.parse(matched.action.issuedAt ?? '')
  const expiresAt = Date.parse(matched.action.expiresAt ?? '')
  if (
    !Number.isFinite(nowAt)
    || !Number.isFinite(issuedAt)
    || !Number.isFinite(expiresAt)
    || nowAt < issuedAt - 5 * 60_000
    || nowAt >= expiresAt
  ) {
    transition({ status: 'EXPIRED' })
    return { status: 'EXPIRED', hotelId, messageHash: null }
  }
  if (!['ISSUING', 'ACTIVE', 'DELIVERY_UNKNOWN'].includes(
    matched.action.status,
  )) {
    return { status: 'INVALID', hotelId, messageHash: null }
  }
  const currentIncidentId = currentIncidentIdForHotel(hotelId)
  const lastSucceededAt = Date.parse(lastSucceededAtForHotel(hotelId) ?? '')
  const callbackMessageSha256 = hash(normalizedCallbackMessageId)
  const operationIdSha256 = hash(`TEMPLATE_CARD:${normalizedTaskId}`)
  if (
    !currentIncidentId
    || currentIncidentId !== matched.action.incidentId
    || (Number.isFinite(lastSucceededAt) && lastSucceededAt >= issuedAt)
  ) {
    transition({
      status: 'CONSUMED',
      consumedAt: now.toISOString(),
      callbackMessageSha256,
      operationState: 'NOT_REQUIRED',
      operationIdSha256: null,
    })
    return { status: 'RESOLVED', hotelId, messageHash: null }
  }
  transition({
    status: 'CONSUMED',
    consumedAt: now.toISOString(),
    callbackMessageSha256,
    operationState: 'PENDING',
    operationIdSha256,
  })
  return {
    status: 'ACCEPTED',
    hotelId,
    messageHash: operationIdSha256,
  }
}

export const createWeComRepairBotPairingStore = ({
  now = () => new Date(),
  codeFactory = () => String(randomInt(0, 1_000_000)).padStart(6, '0'),
  ttlMs = DEFAULT_PAIRING_TTL_MS,
  maxAttempts = DEFAULT_PAIRING_ATTEMPTS,
} = {}) => {
  if (
    !Number.isInteger(ttlMs)
    || ttlMs < 60_000
    || ttlMs > DEFAULT_PAIRING_TTL_MS
    || !Number.isInteger(maxAttempts)
    || maxAttempts < 1
    || maxAttempts > 10
  ) {
    throw new Error('WECOM_REPAIR_BOT_PAIRING_CONFIG_INVALID')
  }
  let active = null

  const currentTime = () => {
    const value = now()
    if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
      throw new Error('WECOM_REPAIR_BOT_PAIRING_CLOCK_INVALID')
    }
    return value
  }

  const pairingScope = (candidate) => {
    if (candidate == null) return { type: 'GLOBAL' }
    if (candidate?.type === 'HOTELS') {
      const hotelIds = normalizeRepairAdminHotelIds(candidate.hotelIds)
      const displayName = normalizeRepairAdminName(candidate.displayName)
      if (!hotelIds.length || !displayName) {
        throw new Error('WECOM_REPAIR_BOT_PAIRING_SCOPE_INVALID')
      }
      return { type: 'HOTELS', hotelIds, displayName,
        role: candidate.role === 'OPERATIONS_MANAGER' ? 'OPERATIONS_MANAGER' : 'STORE_MANAGER' }
    }
    if (
      candidate?.type === 'HOTEL'
      && HOTEL_ID_PATTERN.test(String(candidate.hotelId ?? ''))
    ) {
      return { type: 'HOTEL', hotelId: String(candidate.hotelId) }
    }
    if (candidate?.type === 'GLOBAL') return { type: 'GLOBAL' }
    throw new Error('WECOM_REPAIR_BOT_PAIRING_SCOPE_INVALID')
  }

  const publicStatus = () => {
    if (!active) return { active: false, expiresAt: null, attemptsRemaining: 0 }
    if (currentTime().getTime() >= new Date(active.expiresAt).getTime()) {
      active = null
      return { active: false, expiresAt: null, attemptsRemaining: 0 }
    }
    return {
      active: true,
      expiresAt: active.expiresAt,
      attemptsRemaining: Math.max(0, maxAttempts - active.attemptsUsed),
      scope: active.scope,
    }
  }

  return {
    start({ scope = null } = {}) {
      const pairingCode = String(codeFactory())
      if (!PAIRING_CODE_PATTERN.test(pairingCode)) {
        throw new Error('WECOM_REPAIR_BOT_PAIRING_CODE_INVALID')
      }
      const createdAt = currentTime()
      active = {
        codeSha256: hash(pairingCode),
        expiresAt: new Date(createdAt.getTime() + ttlMs).toISOString(),
        attemptsUsed: 0,
        scope: pairingScope(scope),
      }
      return {
        pairingCode,
        expiresAt: active.expiresAt,
        attemptsRemaining: maxAttempts,
        scope: active.scope,
      }
    },
    submit({ pairingCode, userId }) {
      const status = publicStatus()
      if (!status.active || !active) {
        throw new Error('WECOM_REPAIR_BOT_PAIRING_NOT_ACTIVE')
      }
      const normalizedUserId = String(userId ?? '').trim()
      if (!USER_ID_PATTERN.test(normalizedUserId)) {
        throw new Error('WECOM_REPAIR_BOT_USER_INVALID')
      }
      const normalizedCode = String(pairingCode ?? '').trim()
      active.attemptsUsed += 1
      if (
        !PAIRING_CODE_PATTERN.test(normalizedCode)
        || hash(normalizedCode) !== active.codeSha256
      ) {
        if (active.attemptsUsed >= maxAttempts) active = null
        throw new Error('WECOM_REPAIR_BOT_PAIRING_CODE_REJECTED')
      }
      const scope = active.scope
      active = null
      return { userId: normalizedUserId, scope }
    },
    status: publicStatus,
    clear() {
      active = null
    },
    debugSnapshot() {
      const status = publicStatus()
      return {
        ...status,
        codeSha256Configured: Boolean(active?.codeSha256),
      }
    },
  }
}

const safeConnectionErrorCode = (error) => {
  if (error?.code === 'WS_AUTH_FAILURE_EXHAUSTED') {
    return 'WECOM_REPAIR_BOT_AUTH_REJECTED'
  }
  if (error?.code === 'WS_RECONNECT_EXHAUSTED') {
    return 'WECOM_REPAIR_BOT_RECONNECT_EXHAUSTED'
  }
  return 'WECOM_REPAIR_BOT_CONNECTION_FAILED'
}

const silentLogger = Object.freeze({
  debug() {},
  info() {},
  warn() {},
  error() {},
})

export const createWeComRepairBotRuntime = ({
  createClient = (options) => new WSClient(options),
  onTextMessage = async () => {},
  onEnterChat = () => null,
  onTemplateCardEvent = async () => {},
  onStatusChanged = () => {},
  canSendToUser = () => true,
  canSendBindingMessage = () => false,
  minimumProactiveIntervalMs = 500,
  now = () => Date.now(),
  wait = (milliseconds) => new Promise(
    (resolve) => setTimeout(resolve, milliseconds),
  ),
} = {}) => {
  let client = null
  let proactiveQueue = Promise.resolve()
  let lastProactiveCompletedAt = null
  let state = {
    connectionStatus: 'DISABLED',
    lastAuthenticatedAt: null,
    lastDisconnectedAt: null,
    lastErrorCode: null,
  }

  const updateState = (patch) => {
    state = { ...state, ...patch }
    onStatusChanged({ ...state })
  }

  const disconnect = () => {
    const previous = client
    client = null
    previous?.disconnect()
  }

  const replyText = async (frame, content) => {
    if (!client || state.connectionStatus !== 'AUTHENTICATED') {
      throw new Error('WECOM_REPAIR_BOT_NOT_CONNECTED')
    }
    const safeContent = String(content ?? '').slice(0, 1500)
    return client.replyStream(
      frame,
      generateReqId('repair'),
      safeContent,
      true,
    )
  }

  const sendText = async (userId, content) => {
    if (!canSendToUser(userId)) throw new Error('WECOM_REPAIR_BOT_USER_REVOKED')
    if (!USER_ID_PATTERN.test(String(userId ?? ''))) {
      throw new Error('WECOM_REPAIR_BOT_USER_INVALID')
    }
    if (!client || state.connectionStatus !== 'AUTHENTICATED') {
      throw new Error('WECOM_REPAIR_BOT_NOT_CONNECTED')
    }
    return client.sendMessage(userId, {
      msgtype: 'markdown',
      markdown: { content: String(content ?? '').slice(0, 1500) },
    })
  }

  const sendTemplateCard = async (userId, templateCard) => {
    if (!canSendToUser(userId)) throw new Error('WECOM_REPAIR_BOT_USER_REVOKED')
    if (!USER_ID_PATTERN.test(String(userId ?? ''))) {
      throw new Error('WECOM_REPAIR_BOT_USER_INVALID')
    }
    if (
      !templateCard
      || typeof templateCard !== 'object'
      || Array.isArray(templateCard)
    ) {
      throw new Error('WECOM_REPAIR_BOT_TEMPLATE_CARD_INVALID')
    }
    if (!client || state.connectionStatus !== 'AUTHENTICATED') {
      throw new Error('WECOM_REPAIR_BOT_NOT_CONNECTED')
    }
    return client.sendMessage(userId, {
      msgtype: 'template_card',
      template_card: templateCard,
    })
  }

  const updateTemplateCard = async (
    frame,
    templateCard,
    userIds = undefined,
  ) => {
    if (!client || state.connectionStatus !== 'AUTHENTICATED') {
      throw new Error('WECOM_REPAIR_BOT_NOT_CONNECTED')
    }
    return client.updateTemplateCard(frame, templateCard, userIds)
  }

  const proactiveIntervalMs =
    Number.isInteger(minimumProactiveIntervalMs)
    && minimumProactiveIntervalMs >= 0
    && minimumProactiveIntervalMs <= 5_000
      ? minimumProactiveIntervalMs
      : 500
  const enqueueProactive = (operation) => {
    const queued = proactiveQueue.then(async () => {
      if (lastProactiveCompletedAt !== null) {
        const remaining = proactiveIntervalMs
          - (now() - lastProactiveCompletedAt)
        if (remaining > 0) await wait(remaining)
      }
      try {
        return await operation()
      } finally {
        lastProactiveCompletedAt = now()
      }
    })
    proactiveQueue = queued.catch(() => {})
    return queued
  }

  return {
    configure({ enabled, credentials }) {
      disconnect()
      if (enabled !== true) {
        updateState({
          connectionStatus: 'DISABLED',
          lastErrorCode: null,
        })
        return
      }
      let normalized
      try {
        normalized = normalizeWeComRepairBotCredentials(credentials)
      } catch {
        updateState({
          connectionStatus: 'NOT_CONFIGURED',
          lastErrorCode: 'WECOM_REPAIR_BOT_CREDENTIALS_INVALID',
        })
        return
      }
      updateState({
        connectionStatus: 'CONNECTING',
        lastErrorCode: null,
      })
      client = createClient({
        botId: normalized.botId,
        secret: normalized.secret,
        maxReconnectAttempts: -1,
        maxAuthFailureAttempts: 3,
        logger: silentLogger,
      })
      client.on('authenticated', () => {
        updateState({
          connectionStatus: 'AUTHENTICATED',
          lastAuthenticatedAt: new Date().toISOString(),
          lastErrorCode: null,
        })
      })
      client.on('disconnected', () => {
        updateState({
          connectionStatus: 'DISCONNECTED',
          lastDisconnectedAt: new Date().toISOString(),
        })
      })
      client.on('reconnecting', () => {
        updateState({ connectionStatus: 'CONNECTING' })
      })
      client.on('error', (error) => {
        updateState({
          connectionStatus: 'ERROR',
          lastErrorCode: safeConnectionErrorCode(error),
        })
      })
      client.on('message.text', (frame) => {
        Promise.resolve(onTextMessage(frame, replyText)).catch(() => {
          void replyText(
            frame,
            '处理失败，请稍后重试；系统没有保存本次消息内容。',
          ).catch(() => {})
        })
      })
      client.on('event.template_card_event', (frame) => {
        Promise.resolve(
          onTemplateCardEvent(frame, updateTemplateCard),
        ).catch(() => {
          const taskId = String(frame?.body?.event?.task_id ?? '')
          const userId = String(frame?.body?.from?.userid ?? '')
          if (!taskId || !USER_ID_PATTERN.test(userId)) return
          void updateTemplateCard(frame, {
            card_type: 'text_notice',
            main_title: {
              title: '未能受理本次操作',
              desc: taskId.startsWith('bind_')
                ? '审批结果未确认，请联系平台管理员核对申请记录；请勿将此提示当作审批成功。'
                : '请稍后重试，或发送“恢复 门店编号”。',
            },
            task_id: taskId,
          }, [userId]).catch(() => {})
        })
      })
      client.on('event.enter_chat', (frame) => {
        const activeClient = client
        if (frame?.body?.chattype === 'group' || frame?.body?.chatid) return
        let content
        try {
          content = onEnterChat(frame)
            || '门店简报修复助手：已预授权的人员发送“激活”完成绑定，发送“状态”查看任务；也可使用后台提供的备用配对码。'
        } catch {
          content = '自动绑定未完成，请发送“激活”重试；仍失败时请管理员核对门店容量、授权与保存状态。'
        }
        void activeClient.replyWelcome(frame, { msgtype: 'text', text: {
          content: String(content).slice(0, 1500),
        } }).catch(() => {})
      })
      client.connect()
    },
    disconnect,
    status() {
      return {
        ...state,
        connected:
          state.connectionStatus === 'AUTHENTICATED'
          && client?.isConnected === true,
      }
    },
    async replyText(frame, content) {
      return replyText(frame, content)
    },
    async sendText(userId, content) {
      return enqueueProactive(() => sendText(userId, content))
    },
    async sendTemplateCard(userId, templateCard) {
      return enqueueProactive(() => sendTemplateCard(userId, templateCard))
    },
    async sendBindingMessage(job) {
      return enqueueProactive(() => {
        // A narrow, persisted outbox grant, not a general messaging allowlist.
        if (!canSendBindingMessage(job) || !USER_ID_PATTERN.test(job.userId)
          || !['template_card', 'markdown'].includes(job.body?.msgtype)) {
          throw new Error('WECOM_REPAIR_APPROVAL_FORBIDDEN')
        }
        if (!client || state.connectionStatus !== 'AUTHENTICATED') {
          throw new Error('WECOM_REPAIR_BOT_NOT_CONNECTED')
        }
        return client.sendMessage(job.userId, job.body)
      })
    },
    async updateTemplateCard(frame, templateCard, userIds = undefined) {
      return updateTemplateCard(frame, templateCard, userIds)
    },
    async sendCaptcha({ userId, captcha, content }) {
      return enqueueProactive(async () => {
        if (!canSendToUser(userId)) throw new Error('WECOM_REPAIR_BOT_USER_REVOKED')
        if (!Buffer.isBuffer(captcha) || captcha.length < 16) {
          throw new Error('WECOM_REPAIR_BOT_CAPTCHA_INVALID')
        }
        if (!client || state.connectionStatus !== 'AUTHENTICATED') {
          throw new Error('WECOM_REPAIR_BOT_NOT_CONNECTED')
        }
        const uploaded = await client.uploadMedia(captcha, {
          type: 'image',
          filename: 'luopan-captcha.png',
        })
        if (!canSendToUser(userId)) throw new Error('WECOM_REPAIR_BOT_USER_REVOKED')
        await client.sendMediaMessage(userId, 'image', uploaded.media_id)
        return sendText(userId, content)
      })
    },
  }
}
