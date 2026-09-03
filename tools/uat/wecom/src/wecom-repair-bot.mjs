import {
  createHash,
  randomInt,
} from 'node:crypto'
import weComSdk from '../../vendor/wecom-aibot-sdk-1.0.7.cjs'

const { WSClient, generateReqId } = weComSdk

const BOT_ID_PATTERN = /^[A-Za-z0-9._:-]{6,128}$/u
const SECRET_PATTERN = /^[\x21-\x7e]{16,256}$/u
const USER_ID_PATTERN = /^[^\s\x00-\x1f\x7f]{1,128}$/u
const PAIRING_CODE_PATTERN = /^\d{6}$/u
const CAPTCHA_PATTERN = /^[A-Za-z0-9]{4,8}$/u
const DEFAULT_PAIRING_TTL_MS = 10 * 60 * 1000
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
  }
}

export const weComRepairBotRecipientsForHotel = (credentials, hotelId) => {
  const allowedUserIds = normalizeWeComRepairBotAllowedUserIds(credentials)
  const hotelAllowedUserIds =
    normalizeWeComRepairBotHotelAllowedUserIds(credentials)
  const scopedUserIds = hotelAllowedUserIds[String(hotelId ?? '')] ?? []
  return [...new Set([...allowedUserIds, ...scopedUserIds])]
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
  deliver,
}) => {
  const allowedUserIds = hotelId
    ? weComRepairBotRecipientsForHotel(credentials, hotelId)
    : normalizeWeComRepairBotAllowedUserIds(credentials)
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

export const createWeComRepairBotPairingStore = ({
  now = () => new Date(),
  codeFactory = () => String(randomInt(0, 1_000_000)).padStart(6, '0'),
  ttlMs = DEFAULT_PAIRING_TTL_MS,
  maxAttempts = DEFAULT_PAIRING_ATTEMPTS,
} = {}) => {
  if (
    !Number.isInteger(ttlMs)
    || ttlMs < 60_000
    || ttlMs > 30 * 60_000
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
  onStatusChanged = () => {},
} = {}) => {
  let client = null
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
      client.on('event.enter_chat', (frame) => {
        void client.replyWelcome(frame, {
          msgtype: 'text',
          text: {
            content:
              '罗盘简报修复助手：请发送“门店编号 验证码”。首次使用请先发送后台显示的“绑定 6位配对码”。',
          },
        }).catch(() => {})
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
      return sendText(userId, content)
    },
    async sendCaptcha({ userId, captcha, content }) {
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
      await client.sendMediaMessage(userId, 'image', uploaded.media_id)
      return sendText(userId, content)
    },
  }
}
