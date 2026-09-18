import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import test from 'node:test'

import {
  createWeComRepairBotPairingStore,
  createWeComRepairBotRuntime,
  consumeWeComRepairTemplateCardAction,
  deliverWeComRepairBotToAllowedUsers,
  fingerprintWeComRepairBotValue,
  normalizeWeComRepairBotCredentials,
  parseWeComRepairBotText,
  planYilianRepairCardDelivery,
  planWeComRepairNoticeDeliveries,
  selectWeComRepairNoticeChannels,
  shouldFanOutWeComRepairNotice,
  weComRepairBotCanRepairHotel,
  weComRepairBotRecipientsForHotel,
  yilianRepairCardDeliveryActive,
} from '../../../tools/uat/wecom/src/wecom-repair-bot.mjs'
import {
  reconcileInterruptedWeComDelivery,
} from '../../../tools/uat/wecom/src/delivery-state.mjs'

test('parses pairing, help, strict captcha and explicit Yilian recovery commands', () => {
  assert.deepEqual(parseWeComRepairBotText('绑定 123456'), {
    type: 'PAIR',
    pairingCode: '123456',
  })
  assert.deepEqual(parseWeComRepairBotText('014 5dm8'), {
    type: 'CAPTCHA',
    hotelCode: '014',
    captcha: '5dm8',
  })
  assert.deepEqual(parseWeComRepairBotText('帮助'), { type: 'HELP' })
  assert.deepEqual(parseWeComRepairBotText('恢复 015'), {
    type: 'YILIAN_REPAIR',
    hotelCode: '015',
  })
  assert.deepEqual(parseWeComRepairBotText('015 一键恢复'), {
    type: 'YILIAN_REPAIR',
    hotelCode: '015',
  })
  assert.deepEqual(parseWeComRepairBotText('恢复015 删除配置'), {
    type: 'INVALID',
  })
  assert.deepEqual(parseWeComRepairBotText('014 密码=111111'), {
    type: 'INVALID',
  })
})

test('pairing stores only a code hash and binds one valid user', () => {
  const store = createWeComRepairBotPairingStore({
    now: () => new Date('2026-08-05T00:00:00Z'),
    codeFactory: () => '654321',
  })
  const created = store.start()
  assert.equal(created.pairingCode, '654321')
  const snapshot = JSON.stringify(store.debugSnapshot())
  assert.equal(snapshot.includes('654321'), false)
  assert.equal(store.submit({
    pairingCode: '654321',
    userId: 'approved.user',
  }).userId, 'approved.user')
  assert.equal(store.status().active, false)
})

test('pairing keeps a safe hotel scope without storing the plain code', () => {
  const store = createWeComRepairBotPairingStore({
    now: () => new Date('2026-08-05T00:00:00Z'),
    codeFactory: () => '123456',
  })
  const created = store.start({
    scope: { type: 'HOTEL', hotelId: 'hotel-014' },
  })
  assert.deepEqual(created.scope, { type: 'HOTEL', hotelId: 'hotel-014' })
  assert.equal(JSON.stringify(store.debugSnapshot()).includes('123456'), false)
  const paired = store.submit({
    pairingCode: '123456',
    userId: 'hotel.manager',
  })
  assert.deepEqual(paired.scope, { type: 'HOTEL', hotelId: 'hotel-014' })
})

test('pairing defaults to exactly 24 hours and accepts a code just before expiry', () => {
  let timestamp = Date.parse('2026-09-18T12:00:00Z')
  const store = createWeComRepairBotPairingStore({ now: () => new Date(timestamp), codeFactory: () => '654321' })
  const created = store.start({ scope: { type: 'HOTEL', hotelId: 'hotel-014' } })
  assert.equal(created.expiresAt, '2026-09-19T12:00:00.000Z')
  assert.equal(created.attemptsRemaining, 5)
  timestamp += 24 * 60 * 60_000 - 1
  assert.equal(store.status().active, true)
  assert.equal(store.submit({ pairingCode: '654321', userId: 'test.manager' }).userId, 'test.manager')
  assert.throws(() => store.submit({ pairingCode: '654321', userId: 'another.manager' }), /PAIRING_NOT_ACTIVE/)
})

test('pairing expires at the 24-hour boundary and never revives afterward', () => {
  let timestamp = Date.parse('2026-09-18T12:00:00Z')
  const store = createWeComRepairBotPairingStore({ now: () => new Date(timestamp), codeFactory: () => '654321' })
  store.start()
  timestamp += 24 * 60 * 60_000
  assert.equal(store.status().active, false)
  assert.throws(() => store.submit({ pairingCode: '654321', userId: 'test.manager' }), /PAIRING_NOT_ACTIVE/)
  timestamp += 1
  assert.equal(store.status().active, false)
})

test('24-hour pairing keeps replacement, five-attempt and TTL bounds protections', () => {
  let code = '123456'
  const store = createWeComRepairBotPairingStore({ codeFactory: () => code })
  store.start()
  code = '654321'
  store.start()
  assert.throws(() => store.submit({ pairingCode: '123456', userId: 'test.manager' }), /PAIRING_CODE_REJECTED/)
  assert.equal(store.status().attemptsRemaining, 4)
  for (let attempt = 0; attempt < 4; attempt += 1) {
    assert.throws(() => store.submit({ pairingCode: '000000', userId: 'test.manager' }), /PAIRING_CODE_REJECTED/)
  }
  assert.equal(store.status().active, false)
  assert.throws(() => store.submit({ pairingCode: '654321', userId: 'test.manager' }), /PAIRING_NOT_ACTIVE/)
  for (const ttlMs of [59_999, 24 * 60 * 60_000 + 1, NaN]) {
    assert.throws(() => createWeComRepairBotPairingStore({ ttlMs }), /PAIRING_CONFIG_INVALID/)
  }
  assert.equal(createWeComRepairBotPairingStore({ ttlMs: 24 * 60 * 60_000 }).start().attemptsRemaining, 5)
})

test('credentials reject whitespace and never appear in runtime status', () => {
  const normalized = normalizeWeComRepairBotCredentials({
    botId: 'aib-example-bot',
    secret: 'example_secret_value_1234567890',
  })
  assert.equal(normalized.allowedUserId, null)
  assert.deepEqual(normalized.allowedUserIds, [])
  assert.deepEqual(normalized.hotelAllowedUserIds, {})
  assert.throws(
    () => normalizeWeComRepairBotCredentials({
      botId: 'aib-example-bot',
      secret: 'bad secret value',
    }),
    /WECOM_REPAIR_BOT_CREDENTIALS_INVALID/u,
  )
})

test('store managers are scoped to their hotel while legacy users stay global', () => {
  const credentials = normalizeWeComRepairBotCredentials({
    botId: 'aib-example-bot',
    secret: 'example_secret_value_1234567890',
    allowedUserIds: ['global.first', 'global.second'],
    hotelAllowedUserIds: {
      'hotel-009': ['hotel.manager', 'global.first'],
      'hotel-014': ['other.manager'],
    },
  })
  assert.deepEqual(
    weComRepairBotRecipientsForHotel(credentials, 'hotel-009'),
    ['global.first', 'global.second', 'hotel.manager'],
  )
  assert.deepEqual(
    weComRepairBotRecipientsForHotel(credentials, 'hotel-014'),
    ['global.first', 'global.second', 'other.manager'],
  )
  assert.equal(
    weComRepairBotRecipientsForHotel(credentials, 'hotel-009')
      .includes('other.manager'),
    false,
  )
  assert.equal(weComRepairBotCanRepairHotel({
    credentials,
    userId: 'hotel.manager',
    hotelId: 'hotel-009',
    allowGlobalRepairActions: false,
  }), true)
  assert.equal(weComRepairBotCanRepairHotel({
    credentials,
    userId: 'global.second',
    hotelId: 'hotel-009',
    allowGlobalRepairActions: false,
  }), false)
  assert.equal(weComRepairBotCanRepairHotel({
    credentials,
    userId: 'global.second',
    hotelId: 'hotel-009',
    allowGlobalRepairActions: true,
  }), true)
})

test('repair notices can independently reach the scoped manager and broadcast group', () => {
  assert.deepEqual(selectWeComRepairNoticeChannels({
    repairBotReady: true,
    recipientCount: 1,
    groupWebhookEnabled: true,
    groupWebhookConfigured: true,
  }), ['WECOM_LONG_CONNECTION', 'WECOM_GROUP_WEBHOOK'])
  assert.deepEqual(selectWeComRepairNoticeChannels({
    repairBotReady: false,
    recipientCount: 0,
    groupWebhookEnabled: true,
    groupWebhookConfigured: true,
  }), ['WECOM_GROUP_WEBHOOK'])
  assert.deepEqual(selectWeComRepairNoticeChannels({
    repairBotReady: true,
    recipientCount: 1,
    groupWebhookEnabled: false,
    groupWebhookConfigured: true,
  }), ['WECOM_LONG_CONNECTION'])
  assert.deepEqual(selectWeComRepairNoticeChannels({
    repairBotReady: true,
    recipientCount: 0,
    groupWebhookEnabled: false,
    groupWebhookConfigured: false,
  }), [])
  assert.equal(shouldFanOutWeComRepairNotice('PMS_REPAIR_REQUIRED'), true)
  assert.equal(shouldFanOutWeComRepairNotice('YILIAN_REPAIR_REQUIRED'), true)
  assert.equal(shouldFanOutWeComRepairNotice('DAILY_MORNING_REPAIR_COMPLETE'), true)
  assert.equal(shouldFanOutWeComRepairNotice('DAILY_MORNING_REPAIR_FAILED'), true)
  assert.equal(shouldFanOutWeComRepairNotice('TODAY_OPERATING'), false)
})

test('repair notice planning retries only historical local group-policy rejections once', () => {
  const messageKey = 'hotel-013:PMS_REPAIR_REQUIRED:incident-1'
  const deliveries = new Map([
    [messageKey, {
      messageKey,
      deliveryChannel: null,
      deliveryStatus: 'REJECTED',
      reasonCode: 'WECOM_PAYLOAD_INVALID',
      deliveredPartCount: 0,
    }],
    [`${messageKey}:WECOM_LONG_CONNECTION`, {
      messageKey: `${messageKey}:WECOM_LONG_CONNECTION`,
      deliveryChannel: 'WECOM_LONG_CONNECTION',
      deliveryStatus: 'DELIVERED',
      deliveredPartCount: 2,
    }],
  ])
  const plan = () => planWeComRepairNoticeDeliveries({
    messageKey,
    channels: ['WECOM_LONG_CONNECTION', 'WECOM_GROUP_WEBHOOK'],
    deliveryForKey: (key) => deliveries.get(key),
  })

  assert.deepEqual(plan(), [
    {
      channel: 'WECOM_LONG_CONNECTION',
      messageKey: `${messageKey}:WECOM_LONG_CONNECTION`,
    },
    {
      channel: 'WECOM_GROUP_WEBHOOK',
      messageKey: `${messageKey}:LOCAL_POLICY_V2`,
    },
  ])

  deliveries.set(`${messageKey}:LOCAL_POLICY_V2`, {
    deliveryStatus: 'DELIVERED',
    deliveryChannel: 'WECOM_GROUP_WEBHOOK',
    deliveredPartCount: 1,
  })
  assert.equal(plan()[1].messageKey, `${messageKey}:LOCAL_POLICY_V2`)

  deliveries.set(messageKey, {
    deliveryChannel: 'WECOM_GROUP_WEBHOOK',
    deliveryStatus: 'REJECTED',
    reasonCode: 'WECOM_HTTP_REJECTED',
    deliveredPartCount: 0,
  })
  assert.equal(plan()[1].messageKey, messageKey)
})

test('new repair incidents use one stable key per delivery channel', () => {
  const messageKey = 'hotel-013:PMS_REPAIR_REQUIRED:incident-2'
  assert.deepEqual(planWeComRepairNoticeDeliveries({
    messageKey,
    channels: ['WECOM_LONG_CONNECTION', 'WECOM_GROUP_WEBHOOK'],
    deliveryForKey: () => undefined,
  }), [
    { channel: 'WECOM_LONG_CONNECTION', messageKey },
    {
      channel: 'WECOM_GROUP_WEBHOOK',
      messageKey: `${messageKey}:WECOM_GROUP_WEBHOOK`,
    },
  ])
})

test('credentials migrate one legacy user and allow at most two users', () => {
  const legacy = normalizeWeComRepairBotCredentials({
    botId: 'aib-example-bot',
    secret: 'example_secret_value_1234567890',
    allowedUserId: 'first.user',
  })
  assert.equal(legacy.allowedUserId, 'first.user')
  assert.deepEqual(legacy.allowedUserIds, ['first.user'])

  const dual = normalizeWeComRepairBotCredentials({
    botId: 'aib-example-bot',
    secret: 'example_secret_value_1234567890',
    allowedUserIds: ['first.user', 'second.user', 'first.user'],
  })
  assert.equal(dual.allowedUserId, 'first.user')
  assert.deepEqual(dual.allowedUserIds, ['first.user', 'second.user'])

  assert.throws(
    () => normalizeWeComRepairBotCredentials({
      botId: 'aib-example-bot',
      secret: 'example_secret_value_1234567890',
      allowedUserIds: ['first.user', 'second.user', 'third.user'],
    }),
    /WECOM_REPAIR_BOT_ALLOWED_USERS_INVALID/u,
  )
})

test('delivery fans out to both authorized users without exposing ids', async () => {
  const delivered = []
  const results = await deliverWeComRepairBotToAllowedUsers({
    credentials: {
      allowedUserIds: ['first.user', 'second.user'],
    },
    deliver: async (userId, partIndex) => {
      delivered.push({ userId, partIndex })
      return { errcode: 0 }
    },
  })

  assert.deepEqual(delivered, [
    { userId: 'first.user', partIndex: 0 },
    { userId: 'second.user', partIndex: 1 },
  ])
  assert.deepEqual(results.map((result) => result.status), [
    'fulfilled',
    'fulfilled',
  ])

  delivered.length = 0
  const targeted = await deliverWeComRepairBotToAllowedUsers({
    credentials: {
      allowedUserIds: ['first.user', 'second.user'],
    },
    allowedUserIds: ['second.user'],
    deliver: async (userId, partIndex) => {
      delivered.push({ userId, partIndex })
      return { errcode: 0 }
    },
  })
  assert.deepEqual(delivered, [{ userId: 'second.user', partIndex: 0 }])
  assert.deepEqual(targeted.map((result) => result.status), ['fulfilled'])
})

test('signed repair cards are scoped, durable and single-use', () => {
  const taskId = `sfg_${'a'.repeat(48)}`
  const userId = 'hotel.manager'
  const action = {
    version: 1,
    eventKey: 'YILIAN_REPAIR_015',
    taskIdSha256: fingerprintWeComRepairBotValue(taskId),
    recipientSha256: fingerprintWeComRepairBotValue(userId),
    incidentId: 'incident-015',
    status: 'ACTIVE',
    issuedAt: '2026-09-17T03:00:00.000Z',
    expiresAt: '2026-09-18T03:00:00.000Z',
    consumedAt: null,
    callbackMessageSha256: null,
  }
  const deliveries = [{
    hotelId: 'hotel-015',
    deliveryType: 'PMS_REPAIR_REQUIRED',
    deliveryChannel: 'WECOM_LONG_CONNECTION',
    parts: [{ deliveryStatus: 'DELIVERED', templateCardAction: action }],
  }]
  let persistCount = 0
  const consume = (patch = {}) => consumeWeComRepairTemplateCardAction({
    deliveries,
    userId,
    taskId,
    eventKey: 'YILIAN_REPAIR_015',
    callbackMessageId: 'callback-001',
    now: new Date('2026-09-17T03:05:00.000Z'),
    canRepairHotel: () => true,
    currentIncidentIdForHotel: () => 'incident-015',
    lastSucceededAtForHotel: () => null,
    persist: () => { persistCount += 1 },
    ...patch,
  })

  assert.equal(consume({ userId: 'other.manager' }).status, 'INVALID')
  const accepted = consume()
  assert.equal(accepted.status, 'ACCEPTED')
  assert.equal(accepted.hotelId, 'hotel-015')
  assert.match(accepted.messageHash, /^[a-f0-9]{64}$/u)
  assert.equal(action.status, 'CONSUMED')
  assert.equal(action.operationState, 'PENDING')
  assert.equal(action.operationIdSha256, accepted.messageHash)
  assert.equal(persistCount, 1)
  assert.equal(consume().status, 'ALREADY_CONSUMED')
  assert.equal(persistCount, 1)
  assert.doesNotMatch(JSON.stringify(deliveries), new RegExp(userId, 'u'))
  assert.doesNotMatch(JSON.stringify(deliveries), new RegExp(taskId, 'u'))
})

test('a card with an unknown send acknowledgement remains safely consumable once', () => {
  const taskId = `sfg_${'c'.repeat(48)}`
  const userId = 'hotel.manager'
  const action = {
    version: 1,
    eventKey: 'YILIAN_REPAIR_015',
    taskIdSha256: fingerprintWeComRepairBotValue(taskId),
    recipientSha256: fingerprintWeComRepairBotValue(userId),
    incidentId: 'incident-015',
    status: 'DELIVERY_UNKNOWN',
    issuedAt: '2026-09-17T03:00:00.000Z',
    expiresAt: '2026-09-18T03:00:00.000Z',
    consumedAt: null,
    callbackMessageSha256: null,
  }
  const deliveries = [{
    hotelId: 'hotel-015',
    deliveryType: 'PMS_REPAIR_REQUIRED',
    deliveryChannel: 'WECOM_LONG_CONNECTION',
    parts: [{ deliveryStatus: 'AMBIGUOUS', templateCardAction: action }],
  }]
  const consume = (overrides = {}) => consumeWeComRepairTemplateCardAction({
    deliveries,
    userId,
    taskId,
    eventKey: 'YILIAN_REPAIR_015',
    callbackMessageId: 'callback-ambiguous-001',
    now: new Date('2026-09-17T03:05:00.000Z'),
    canRepairHotel: () => true,
    currentIncidentIdForHotel: () => 'incident-015',
    lastSucceededAtForHotel: () => null,
    persist: () => {},
    ...overrides,
  })

  assert.equal(consume({ userId: 'other.manager' }).status, 'INVALID')
  assert.equal(consume().status, 'ACCEPTED')
  assert.equal(action.status, 'CONSUMED')
  assert.equal(action.operationState, 'PENDING')
  assert.equal(consume().status, 'ALREADY_CONSUMED')
})

test('Yilian card planning reissues expired and terminal cards without duplicating running work', () => {
  const messageKey = 'hotel-015:PMS_REPAIR_REQUIRED:incident-015'
  const baseKey = `${messageKey}:CARD_ACTION_V2:G1`
  const now = new Date('2026-09-18T04:00:00.000Z')
  const delivery = (action, deliveryStatus = 'DELIVERED') => ({
    messageKey: baseKey,
    attemptedAt: '2026-09-17T03:00:00.000Z',
    completedAt: '2026-09-17T03:00:01.000Z',
    parts: [{ deliveryStatus, templateCardAction: action }],
  })
  const action = (patch = {}) => ({
    version: 1,
    status: 'ACTIVE',
    operationState: null,
    issuedAt: '2026-09-17T03:00:00.000Z',
    expiresAt: '2026-09-18T03:00:00.000Z',
    ...patch,
  })
  const plan = (
    deliveries,
    at = now,
    authorizedRecipientSha256s = null,
  ) => planYilianRepairCardDelivery({
    messageKey,
    deliveries,
    now: at,
    retryMs: 5 * 60_000,
    generationTtlMs: 24 * 60 * 60_000,
    maxAttempts: 3,
    maxGenerations: 30,
    authorizedRecipientSha256s,
  })

  assert.deepEqual(plan([]), {
    due: true,
    messageKey: baseKey,
    reasonCode: null,
  })
  assert.equal(yilianRepairCardDeliveryActive(
    delivery(action()),
    new Date('2026-09-18T02:59:59.000Z'),
  ), true)
  assert.equal(plan([delivery(action())]).messageKey,
    `${messageKey}:CARD_ACTION_V2:G2`)
  assert.equal(plan([delivery(action())]).due, true)

  const completed = delivery(action({
    status: 'CONSUMED',
    operationState: 'DONE',
    expiresAt: '2026-09-19T03:00:00.000Z',
  }))
  assert.equal(plan([completed]).due, true)
  assert.equal(plan([completed]).messageKey,
    `${messageKey}:CARD_ACTION_V2:G2`)

  const running = delivery(action({
    status: 'CONSUMED',
    operationState: 'RUNNING',
    expiresAt: '2026-09-19T03:00:00.000Z',
  }), 'AMBIGUOUS')
  assert.equal(yilianRepairCardDeliveryActive(running, now), true)
  assert.equal(plan([running]).due, false)

  const priorRecipient = 'a'.repeat(64)
  const replacementRecipient = 'b'.repeat(64)
  const revoked = delivery(action({
    recipientSha256: priorRecipient,
    expiresAt: '2026-09-19T03:00:00.000Z',
  }))
  const replacementPlan = plan(
    [revoked],
    new Date('2026-09-17T03:01:00.000Z'),
    new Set([replacementRecipient]),
  )
  assert.equal(replacementPlan.due, true)
  assert.equal(
    replacementPlan.messageKey,
    `${messageKey}:CARD_ACTION_V2:G2`,
  )
})

test('repair card expiry and persistence failures fail closed', () => {
  const taskId = `sfg_${'b'.repeat(48)}`
  const action = {
    version: 1,
    eventKey: 'YILIAN_REPAIR_015',
    taskIdSha256: fingerprintWeComRepairBotValue(taskId),
    recipientSha256: fingerprintWeComRepairBotValue('hotel.manager'),
    incidentId: 'incident-015',
    status: 'ACTIVE',
    issuedAt: '2026-09-17T03:00:00.000Z',
    expiresAt: '2026-09-17T03:10:00.000Z',
    consumedAt: null,
    callbackMessageSha256: null,
  }
  const input = (now, persist) => ({
    deliveries: [{
      hotelId: 'hotel-015',
      deliveryType: 'PMS_REPAIR_REQUIRED',
      deliveryChannel: 'WECOM_LONG_CONNECTION',
      parts: [{ deliveryStatus: 'DELIVERED', templateCardAction: action }],
    }],
    userId: 'hotel.manager',
    taskId,
    eventKey: 'YILIAN_REPAIR_015',
    callbackMessageId: 'callback-002',
    now,
    canRepairHotel: () => true,
    currentIncidentIdForHotel: () => 'incident-015',
    lastSucceededAtForHotel: () => null,
    persist,
  })

  assert.throws(() => consumeWeComRepairTemplateCardAction(
    input(new Date('2026-09-17T03:05:00.000Z'), () => {
      throw new Error('persist failed')
    }),
  ), /persist failed/u)
  assert.equal(action.status, 'ACTIVE')
  assert.equal(action.consumedAt, null)
  assert.equal(consumeWeComRepairTemplateCardAction(
    input(new Date('2026-09-17T03:11:00.000Z'), () => {}),
  ).status, 'EXPIRED')
  assert.equal(action.status, 'EXPIRED')
})

test('interrupted card delivery keeps signed metadata and consumption state', () => {
  const action = {
    version: 1,
    taskIdSha256: 'a'.repeat(64),
    recipientSha256: 'b'.repeat(64),
    status: 'CONSUMED',
    consumedAt: '2026-09-17T03:05:00.000Z',
  }
  const reconciled = reconcileInterruptedWeComDelivery({
    deliveryStatus: 'SENDING',
    parts: [{ deliveryStatus: 'SENDING', templateCardAction: action }],
  }, '2026-09-17T03:06:00.000Z')
  assert.equal(reconciled.deliveryStatus, 'AMBIGUOUS')
  assert.equal(reconciled.parts[0].deliveryStatus, 'AMBIGUOUS')
  assert.deepEqual(reconciled.parts[0].templateCardAction, action)
})

test('runtime authenticates, receives text and sends captcha without logging frames', async () => {
  class FakeClient extends EventEmitter {
    isConnected = false
    sent = []
    connect() {
      this.isConnected = true
      this.emit('authenticated')
    }
    disconnect() {
      this.isConnected = false
    }
    async replyStream(frame, streamId, content, finish) {
      this.sent.push({ type: 'reply', frame, streamId, content, finish })
      return { errcode: 0 }
    }
    async replyWelcome() {
      return { errcode: 0 }
    }
    async uploadMedia() {
      this.sent.push({ type: 'upload' })
      return { media_id: 'media-safe-id' }
    }
    async sendMediaMessage(userId, type, mediaId) {
      this.sent.push({ type: 'media', userId, mediaType: type, mediaId })
      return { errcode: 0 }
    }
    async sendMessage(userId, body) {
      this.sent.push({ type: 'message', userId, body })
      return { errcode: 0 }
    }
  }
  let fake
  let received = null
  const runtime = createWeComRepairBotRuntime({
    createClient: () => {
      fake = new FakeClient()
      return fake
    },
    onTextMessage: async (frame, reply) => {
      received = frame.body.text.content
      await reply(frame, '已接收')
    },
  })
  runtime.configure({
    enabled: true,
    credentials: {
      botId: 'aib-example-bot',
      secret: 'example_secret_value_1234567890',
    },
  })
  assert.equal(runtime.status().connected, true)
  assert.equal(JSON.stringify(runtime.status()).includes('example_secret'), false)
  fake.emit('message.text', {
    headers: { req_id: 'req-safe' },
    body: { text: { content: '014 5dm8' } },
  })
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(received, '014 5dm8')
  await runtime.sendCaptcha({
    userId: 'approved.user',
    captcha: Buffer.alloc(128, 5),
    content: '请回复门店编号和验证码',
  })
  assert.deepEqual(
    fake.sent.filter((item) => ['upload', 'media', 'message'].includes(item.type))
      .map((item) => item.type),
    ['upload', 'media', 'message'],
  )
})

test('runtime serializes and spaces proactive manager messages', async () => {
  class FakeClient extends EventEmitter {
    isConnected = false
    sent = []
    connect() {
      this.isConnected = true
      this.emit('authenticated')
    }
    disconnect() {
      this.isConnected = false
    }
    async sendMessage(userId) {
      this.sent.push(userId)
      return { errcode: 0 }
    }
  }
  let fake
  let clock = 1_000
  const waits = []
  const runtime = createWeComRepairBotRuntime({
    createClient: () => {
      fake = new FakeClient()
      return fake
    },
    minimumProactiveIntervalMs: 500,
    now: () => clock,
    wait: async (milliseconds) => {
      waits.push(milliseconds)
      clock += milliseconds
    },
  })
  runtime.configure({
    enabled: true,
    credentials: {
      botId: 'aib-example-bot',
      secret: 'example_secret_value_1234567890',
    },
  })

  await Promise.all([
    runtime.sendText('first.user', '第一条'),
    runtime.sendText('second.user', '第二条'),
    runtime.sendText('third.user', '第三条'),
  ])

  assert.deepEqual(fake.sent, ['first.user', 'second.user', 'third.user'])
  assert.deepEqual(waits, [500, 500])
})

test('runtime sends and promptly updates a Yilian template card', async () => {
  class FakeClient extends EventEmitter {
    isConnected = false
    sent = []
    connect() {
      this.isConnected = true
      this.emit('authenticated')
    }
    disconnect() {
      this.isConnected = false
    }
    async sendMessage(userId, body) {
      this.sent.push({ type: 'message', userId, body })
      return { errcode: 0 }
    }
    async updateTemplateCard(frame, templateCard, userIds) {
      this.sent.push({
        type: 'update',
        frame,
        templateCard,
        userIds,
      })
      return { errcode: 0 }
    }
  }
  let fake
  const runtime = createWeComRepairBotRuntime({
    createClient: () => {
      fake = new FakeClient()
      return fake
    },
    onTemplateCardEvent: async (frame, updateTemplateCard) => {
      await updateTemplateCard(frame, {
        card_type: 'text_notice',
        main_title: { title: '已受理' },
        task_id: frame.body.event.task_id,
      }, ['approved.user'])
    },
  })
  runtime.configure({
    enabled: true,
    credentials: {
      botId: 'aib-example-bot',
      secret: 'example_secret_value_1234567890',
    },
  })
  const card = {
    card_type: 'button_interaction',
    main_title: { title: '015 需要恢复' },
    button_list: [{ text: '一键快速恢复', key: 'YILIAN_REPAIR_015' }],
    task_id: 'yilian_015_0123456789abcdef',
  }
  await runtime.sendTemplateCard('approved.user', card)
  const frame = {
    body: {
      event: {
        event_key: 'YILIAN_REPAIR_015',
        task_id: card.task_id,
      },
    },
  }
  fake.emit('event.template_card_event', frame)
  await new Promise((resolve) => setImmediate(resolve))

  assert.deepEqual(fake.sent[0], {
    type: 'message',
    userId: 'approved.user',
    body: { msgtype: 'template_card', template_card: card },
  })
  assert.equal(fake.sent[1].type, 'update')
  assert.equal(fake.sent[1].templateCard.task_id, card.task_id)
  assert.deepEqual(fake.sent[1].userIds, ['approved.user'])
})
