import assert from 'node:assert/strict'
import { createCipheriv, createHash } from 'node:crypto'
import { EventEmitter } from 'node:events'
import test from 'node:test'
import {
  normalizeRepairAdminState, repairAdminRoster, bindRepairAdminToHotels,
  updateRepairAdmin, decryptRepairDirectoryCallback, repairDirectoryXmlField,
  applyRepairDirectoryEvent,
} from '../../../tools/uat/wecom/src/wecom-repair-admins.mjs'
import {
  createWeComRepairBotPairingStore, normalizeWeComRepairBotCredentials,
  weComRepairBotCanRepairHotel, weComRepairBotRecipientsForHotel, createWeComRepairBotRuntime,
} from '../../../tools/uat/wecom/src/wecom-repair-bot.mjs'

const now = new Date('2026-09-18T04:00:01.200Z')
const hotels = [1, 2, 3].map((n) => ({ hotelId: `hotel-${n}`, hotelCode: `00${n}`, hotelName: `测试门店${n}` }))
const directory = { enabled: true, corpId: 'ww-test-corp', token: 'testCallbackToken',
  encodingAesKey: Buffer.alloc(32, 17).toString('base64').slice(0, -1) }
const credentials = () => normalizeWeComRepairBotCredentials({ botId: 'bot-test-01',
  secret: 'example-robot-secret-for-tests', allowedUserIds: ['global.user'],
  hotelAllowedUserIds: { 'hotel-1': ['manager'], 'hotel-2': ['other'] },
  directorySync: directory,
  userProfiles: { manager: { displayName: '张经理', directoryUserId: 'zhangsan',
    directoryLinkedAt: '2026-09-17T04:00:00Z' } },
})
const memberId = (id) => createHash('sha256').update(id).digest('hex')
const eventXml = (user = 'zhangsan', change = 'delete_user', extra = '') =>
  `<xml><ToUserName><![CDATA[${directory.corpId}]]></ToUserName><MsgType>event</MsgType>`
  + `<CreateTime>${Math.floor(now.getTime() / 1000)}</CreateTime><Event>change_contact</Event>`
  + `<ChangeType>${change}</ChangeType><UserID><![CDATA[${user}]]></UserID>${extra}</xml>`
function signed(message, corpId = directory.corpId) {
  const content = Buffer.from(message)
  const length = Buffer.alloc(4); length.writeUInt32BE(content.length)
  const raw = Buffer.concat([Buffer.alloc(16, 7), length, content, Buffer.from(corpId)])
  const pad = 32 - raw.length % 32
  const key = Buffer.from(`${directory.encodingAesKey}=`, 'base64')
  const cipher = createCipheriv('aes-256-cbc', key, key.subarray(0, 16)); cipher.setAutoPadding(false)
  const encrypted = Buffer.concat([cipher.update(Buffer.concat([raw, Buffer.alloc(pad, pad)])), cipher.final()]).toString('base64')
  const timestamp = String(Math.floor(now.getTime() / 1000)), nonce = 'test-nonce'
  const signature = createHash('sha1').update([directory.token, timestamp, nonce, encrypted].sort().join('')).digest('hex')
  return { config: directory, timestamp, nonce, encrypted, signature, now }
}

test('legacy bindings remain visible and unnamed; metadata is additive', () => {
  const rows = repairAdminRoster(credentials(), hotels)
  assert.equal(rows.find((m) => m.userId === 'global.user').globalRecipient, true)
  assert.equal(rows.find((m) => m.userId === 'other').nameSource, 'UNSET')
  assert.equal(rows.find((m) => m.userId === 'manager').displayName, '张经理')
  assert.throws(() => normalizeRepairAdminState({ userProfiles: { manager: { displayName: 'bad\nname' } } }), /NAME_INVALID/)
})

test('one single-use pairing binds all selected stores without changing global recipients', () => {
  const store = createWeComRepairBotPairingStore({ now: () => now, codeFactory: () => '123456' })
  store.start({ scope: { type: 'HOTELS', hotelIds: ['hotel-2', 'hotel-1', 'hotel-1'], displayName: '运营李经理', role: 'OPERATIONS_MANAGER' } })
  const paired = store.submit({ pairingCode: '123456', userId: 'new.manager' })
  const next = bindRepairAdminToHotels({ credentials: credentials(), userId: paired.userId, ...paired.scope, hotels, now })
  assert.deepEqual(next.allowedUserIds, ['global.user'])
  assert.equal(next.userProfiles['new.manager'].displayName, '运营李经理')
  for (const id of ['hotel-1', 'hotel-2']) assert.equal(weComRepairBotCanRepairHotel({ credentials: next, userId: paired.userId, hotelId: id }), true)
  assert.equal(weComRepairBotCanRepairHotel({ credentials: next, userId: paired.userId, hotelId: 'hotel-3' }), false)
  assert.throws(() => store.submit({ pairingCode: '123456', userId: 'other' }), /NOT_ACTIVE/)
  assert.throws(() => store.start({ scope: { type: 'HOTELS', hotelIds: [], displayName: '张三' } }), /SCOPE_INVALID/)
})

test('batch capacity and unknown stores fail atomically without partial binding', () => {
  const current = credentials()
  current.hotelAllowedUserIds['hotel-2'] = Array.from({ length: 20 }, (_, n) => `user-${n}`)
  const before = structuredClone(current)
  assert.throws(() => bindRepairAdminToHotels({ credentials: current, userId: 'new', hotelIds: ['hotel-1', 'hotel-2'], hotels }), /CAPACITY_REACHED/)
  assert.deepEqual(current, before)
  assert.throws(() => bindRepairAdminToHotels({ credentials: current, userId: 'new', hotelIds: ['unknown'], hotels }), /HOTELS_INVALID/)
})

test('scope edit replaces only chosen user permissions and explicitly confirms directory mapping', () => {
  const input = { credentials: credentials(), memberId: memberId('manager'), action: 'EDIT',
    displayName: '运营张经理', role: 'OPERATIONS_MANAGER', hotelIds: ['hotel-2', 'hotel-3'],
    directoryUserId: 'zhang.manager', hotels, now }
  assert.throws(() => updateRepairAdmin(input), /IDENTITY_CONFIRM_REQUIRED/)
  const next = updateRepairAdmin({ ...input, directoryIdentityConfirmed: true })
  assert.deepEqual(next.hotelAllowedUserIds['hotel-1'], [])
  assert.deepEqual(next.hotelAllowedUserIds['hotel-2'], ['other', 'manager'])
  assert.equal(next.userProfiles.manager.directoryUserId, 'zhang.manager')
  assert.deepEqual(next.allowedUserIds, ['global.user'])
  assert.throws(() => updateRepairAdmin({ ...input, memberId: memberId('other'), directoryUserId: 'zhangsan', directoryIdentityConfirmed: true }), /DIRECTORY_USER_DUPLICATE/)
})

test('manual revoke removes every global and store grant and blocks old pairing', () => {
  const current = credentials(); current.allowedUserIds.push('manager')
  const next = normalizeWeComRepairBotCredentials(updateRepairAdmin({ credentials: current,
    memberId: memberId('manager'), action: 'REVOKE', hotels, now }))
  assert.equal(weComRepairBotRecipientsForHotel(next, 'hotel-1').includes('manager'), false)
  assert.equal(weComRepairBotCanRepairHotel({ credentials: next, userId: 'manager', hotelId: 'hotel-1', allowGlobalRepairActions: true }), false)
  assert.equal(repairAdminRoster(next, hotels).find((m) => m.userId === 'manager').active, false)
  assert.throws(() => bindRepairAdminToHotels({ credentials: next, userId: 'manager', hotelIds: ['hotel-1'], hotels }), /MEMBER_REVOKED/)
})

test('callback verifies protocol signature, corporation, timestamp and bounded XML', () => {
  const payload = signed(eventXml())
  assert.equal(decryptRepairDirectoryCallback(payload), eventXml())
  assert.equal(decryptRepairDirectoryCallback(signed('echo-challenge')), 'echo-challenge')
  assert.throws(() => decryptRepairDirectoryCallback({ ...payload, signature: 'a'.repeat(40) }), /CALLBACK_INVALID/)
  assert.throws(() => decryptRepairDirectoryCallback(signed(eventXml(), 'different-corp')), /CALLBACK_INVALID/)
  assert.throws(() => decryptRepairDirectoryCallback({ ...payload, now: new Date(now.getTime() + 11 * 60_000) }), /CALLBACK_INVALID/)
  assert.throws(() => repairDirectoryXmlField('<!DOCTYPE xml [<!ENTITY x SYSTEM "file:///etc/passwd">]><xml><Encrypt>&x;</Encrypt></xml>', 'Encrypt'), /CALLBACK_INVALID/)
  assert.throws(() => repairDirectoryXmlField('<xml><Encrypt>x</Encrypt><Encrypt>y</Encrypt></xml>', 'Encrypt'), /CALLBACK_INVALID/)
})

test('signed departure revokes exact mapped member across stores, is idempotent and never guesses IDs', () => {
  let current = bindRepairAdminToHotels({ credentials: credentials(), userId: 'manager', hotelIds: ['hotel-2', 'hotel-3'], hotels, now })
  current.allowedUserIds.push('manager')
  const unchanged = applyRepairDirectoryEvent({ credentials: current, xml: eventXml('manager'), now })
  assert.equal(unchanged.result, 'UNMATCHED')
  assert.equal(weComRepairBotCanRepairHotel({ credentials: unchanged.credentials, userId: 'manager', hotelId: 'hotel-1' }), true)
  const result = applyRepairDirectoryEvent({ credentials: current, xml: decryptRepairDirectoryCallback(signed(eventXml())), now })
  assert.equal(result.result, 'REVOKED')
  assert.deepEqual(result.revoked, [memberId('manager')])
  for (const hotel of hotels) assert.equal(weComRepairBotRecipientsForHotel(result.credentials, hotel.hotelId).includes('manager'), false)
  assert.deepEqual(result.credentials.allowedUserIds, ['global.user'])
  assert.deepEqual(result.credentials.hotelAllowedUserIds['hotel-2'], ['other'])
  assert.deepEqual(applyRepairDirectoryEvent({ credentials: result.credentials, xml: eventXml(), now }).revoked, [])
})

test('member disabled revokes; normal updates, older events and unverified identity never revoke', () => {
  const current = credentials()
  assert.equal(applyRepairDirectoryEvent({ credentials: current, xml: eventXml('zhangsan', 'update_user', '<Status>1</Status>'), now }).result, 'IGNORED')
  assert.equal(applyRepairDirectoryEvent({ credentials: current, xml: eventXml('zhangsan', 'update_user', '<Status>2</Status>'), now }).result, 'REVOKED')
  current.userProfiles.manager.directoryLinkedAt = new Date(now.getTime() + 1000).toISOString()
  assert.deepEqual(applyRepairDirectoryEvent({ credentials: current, xml: eventXml(), now }).revoked, [])
  current.userProfiles.manager.directoryLinkedAt = null
  assert.deepEqual(applyRepairDirectoryEvent({ credentials: current, xml: eventXml(), now }).revoked, [])
})

test('directory account rename keeps offboarding linkage without auto-restoring departed members', () => {
  const renamed = applyRepairDirectoryEvent({ credentials: credentials(),
    xml: eventXml('zhangsan', 'update_user', '<NewUserID>new.zhang</NewUserID>'), now })
  assert.equal(renamed.result, 'UPDATED')
  assert.equal(renamed.credentials.userProfiles.manager.directoryUserId, 'new.zhang')
  assert.equal(applyRepairDirectoryEvent({ credentials: renamed.credentials, xml: eventXml('new.zhang'), now }).result, 'REVOKED')
})

test('queued messages and captcha recheck revocation before actual delivery', async () => {
  class Fake extends EventEmitter {
    isConnected = true
    sent = []
    connect() { this.emit('authenticated') }
    disconnect() {}
    async sendMessage(userId) { this.sent.push(userId) }
    async uploadMedia() { allowed = false; return { media_id: 'fake' } }
    async sendMediaMessage() { throw new Error('revoked image must not send') }
  }
  let allowed = true
  const fake = new Fake()
  const runtime = createWeComRepairBotRuntime({ createClient: () => fake, canSendToUser: () => allowed, minimumProactiveIntervalMs: 0 })
  runtime.configure({ enabled: true, credentials: credentials() })
  const queued = runtime.sendText('manager', 'test'); allowed = false
  await assert.rejects(queued, /USER_REVOKED/)
  allowed = true
  await assert.rejects(runtime.sendCaptcha({ userId: 'manager', captcha: Buffer.alloc(32), content: 'test' }), /USER_REVOKED/)
  assert.deepEqual(fake.sent, [])
})
