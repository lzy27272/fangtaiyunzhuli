import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import test from 'node:test'

import {
  createWeComRepairBotPairingStore,
  createWeComRepairBotRuntime,
  deliverWeComRepairBotToAllowedUsers,
  normalizeWeComRepairBotCredentials,
  parseWeComRepairBotText,
  weComRepairBotRecipientsForHotel,
} from '../../../tools/uat/wecom/src/wecom-repair-bot.mjs'

test('parses only pairing, help and strict store captcha commands', () => {
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
