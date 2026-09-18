import assert from 'node:assert/strict'
import { createCipheriv, createHash } from 'node:crypto'
import { EventEmitter } from 'node:events'
import test from 'node:test'
import {
  normalizeRepairAdminState, repairAdminRoster, bindRepairAdminToHotels,
  updateRepairAdmin, decryptRepairDirectoryCallback, repairDirectoryXmlField,
  applyRepairDirectoryEvent,
  preauthorizeRepairAdmin, activatePreauthorizedRepairAdmin,
  registerRepairAdmin, approveRepairAdminRegistration,
} from '../../../tools/uat/wecom/src/wecom-repair-admins.mjs'
import {
  createWeComRepairBotPairingStore, normalizeWeComRepairBotCredentials,
  weComRepairBotCanRepairHotel, weComRepairBotRecipientsForHotel, createWeComRepairBotRuntime,
} from '../../../tools/uat/wecom/src/wecom-repair-bot.mjs'
import { encryptCookie, decryptCookie, validateCookieValue } from '../../../tools/uat/report-source-cookie-crypto.mjs'

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
const registrationFrame = (overrides = {}) => ({ body: {
  aibotid: 'bot-test-01', msgtype: 'text', chattype: 'single', msgid: 'register-msg-1',
  create_time: Math.floor(now.getTime() / 1000), from: { userid: 'applicant', corpid: directory.corpId },
  text: { content: '激活 王店长' }, ...overrides,
} })

test('activation registers the observed sender without permissions; approval uses immutable member identity', () => {
  const before = credentials()
  assert.equal(Object.hasOwn(before.userProfiles.manager, 'registration'), false)
  const withoutDirectory = { ...before, directorySync: null }
  assert.equal(registerRepairAdmin({ credentials: withoutDirectory, frame: registrationFrame(), now }).status, 'REQUESTED')
  const result = registerRepairAdmin({ credentials: before, frame: registrationFrame(), now })
  const pending = normalizeWeComRepairBotCredentials(result.credentials)
  const member = repairAdminRoster(pending, hotels, now).find((m) => m.userId === 'applicant')
  assert.equal(result.status, 'REQUESTED')
  assert.equal(member.active, false)
  assert.equal(member.activationStatus, 'REQUESTED')
  assert.equal(member.nameSource, 'APPLICANT_PROVIDED')
  assert.equal(member.displayName, '王店长')
  assert.deepEqual(pending.allowedUserIds, before.allowedUserIds)
  assert.deepEqual(pending.hotelAllowedUserIds, before.hotelAllowedUserIds)
  assert.equal(weComRepairBotCanRepairHotel({ credentials: pending, userId: 'applicant', hotelId: 'hotel-1' }), false)
  assert.equal(registerRepairAdmin({ credentials: pending, frame: registrationFrame(), now }).credentials, pending)
  const input = { credentials: pending, memberId: member.memberId, hotels, now,
    hotelIds: ['hotel-1', 'hotel-2'], displayName: '王店长', role: 'OPERATIONS_MANAGER' }
  assert.throws(() => approveRepairAdminRegistration(input), /REGISTRATION_CONFIRM_REQUIRED/)
  const approved = approveRepairAdminRegistration({ ...input, identityConfirmed: true, userId: 'forged-user' })
  assert.deepEqual(approved.allowedUserIds, before.allowedUserIds)
  assert.equal(approved.hotelAllowedUserIds['hotel-1'].includes('applicant'), true)
  assert.equal(approved.hotelAllowedUserIds['hotel-2'].includes('applicant'), true)
  assert.equal(Object.values(approved.hotelAllowedUserIds).flat().includes('forged-user'), false)
  assert.equal(approved.userProfiles.applicant.directoryUserId, '')
  assert.equal(approved.userProfiles.applicant.registration, null)
  assert.throws(() => approveRepairAdminRegistration({ ...input, credentials: approved, identityConfirmed: true }), /REGISTRATION_STALE/)
  assert.equal(registerRepairAdmin({ credentials: approved, frame: registrationFrame(), now }).status, 'ACTIVE')
})

test('registration rejects foreign/group/stale/malformed messages and never revives revocations', () => {
  const before = credentials()
  for (const fields of [ { aibotid: 'foreign' }, { chattype: 'group' }, { chatid: 'group' },
    { from: { userid: 'applicant', corpid: 'foreign' } }, { from: { userid: 'bad id' } },
    { msgtype: 'event' }, { msgid: '' }, { msgid: 123 }, { from: { userid: 123 } }, { create_time: 1 }, { create_time: 'bad' },
    { create_time: Math.floor(now.getTime() / 1000) + 3600 } ]) {
    assert.throws(() => registerRepairAdmin({ credentials: before, frame: registrationFrame(fields), now }), /REGISTRATION_IDENTITY_INVALID/)
  }
  assert.throws(() => registerRepairAdmin({ credentials: before, frame: registrationFrame({ text: { content: '激活\n伪造\n姓名' } }), now }), /REGISTRATION_INVALID/)
  assert.throws(() => registerRepairAdmin({ credentials: before, frame: registrationFrame({ text: { content: '激活 \u202e假名' } }), now }), /NAME_INVALID/)
  const pending = registerRepairAdmin({ credentials: before, frame: registrationFrame(), now }).credentials
  const revoked = updateRepairAdmin({ credentials: pending, action: 'REVOKE', memberId: memberId('applicant'), hotels, now })
  assert.throws(() => registerRepairAdmin({ credentials: revoked, frame: registrationFrame(), now }), /MEMBER_REVOKED/)
  assert.throws(() => approveRepairAdminRegistration({ credentials: revoked, memberId: memberId('applicant'), hotels, now }), /REGISTRATION_STALE/)
})

test('bare activation can add a claimed name, while expiry, bot changes and capacity block approval atomically', () => {
  const blank = registerRepairAdmin({ credentials: credentials(), frame: registrationFrame({ text: { content: '激活' } }), now }).credentials
  assert.equal(blank.userProfiles.applicant.displayName, '')
  const pending = registerRepairAdmin({ credentials: blank, frame: registrationFrame(), now }).credentials
  const input = { credentials: pending, memberId: memberId('applicant'), hotels, now,
    hotelIds: ['hotel-1', 'hotel-2'], displayName: '王店长', role: 'STORE_MANAGER', identityConfirmed: true }
  for (const changed of [{ now: new Date(now.getTime() + 24 * 60 * 60_000) },
    { credentials: { ...pending, botId: 'another-bot' } },
    { credentials: { ...pending, directorySync: { ...pending.directorySync, corpId: 'another-corp' } } }]) {
    assert.throws(() => approveRepairAdminRegistration({ ...input, ...changed }), /REGISTRATION_STALE/)
  }
  const full = structuredClone(pending)
  full.hotelAllowedUserIds['hotel-2'] = Array.from({ length: 20 }, (_, n) => `full-${n}`)
  const copy = structuredClone(full)
  assert.throws(() => approveRepairAdminRegistration({ ...input, credentials: full }), /CAPACITY_REACHED/)
  assert.deepEqual(full, copy)
  assert.throws(() => approveRepairAdminRegistration({ ...input, hotelIds: ['unknown'] }), /HOTELS_INVALID/)
  const hasCard = { ...pending, bindingApproval: { requests: [{ userId: 'applicant', status: 'PENDING', expiresAt: new Date(now.getTime() + 1000).toISOString() }] } }
  assert.equal(registerRepairAdmin({ credentials: hasCard, frame: registrationFrame(), now }).credentials, hasCard)
  const capacity = credentials()
  capacity.userProfiles = Object.fromEntries(Array.from({ length: 500 }, (_, n) => [`registered-${n}`, { registration: pending.userProfiles.applicant.registration }]))
  assert.throws(() => registerRepairAdmin({ credentials: capacity, frame: registrationFrame(), now }), /REGISTRATION_CAPACITY_REACHED/)
})
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

const pendingAdmin = (overrides = {}) => preauthorizeRepairAdmin({ credentials: {
  ...credentials(), directorySync: { ...directory, verifiedAt: now.toISOString() },
}, userId: 'new.manager', directoryUserId: 'new.directory', directoryIdentityConfirmed: true,
displayName: '免码运营经理', role: 'OPERATIONS_MANAGER', hotelIds: ['hotel-1', 'hotel-3'], hotels, now, ...overrides })
const entryFrame = (overrides = {}) => ({ body: { aibotid: 'bot-test-01', msgid: 'entry-1',
  msgtype: 'event', event: { eventtype: 'enter_chat' },
  create_time: Math.floor(now.getTime() / 1000), from: { userid: 'new.manager', corpid: directory.corpId }, ...overrides } })

test('preauthorization persists a pending scope with no delivery/action grants; exact entry activates atomically', () => {
  const pending = normalizeWeComRepairBotCredentials(pendingAdmin())
  const member = repairAdminRoster(pending, hotels).find((m) => m.userId === 'new.manager')
  assert.equal(member.activationStatus, 'PENDING')
  assert.equal(member.offboardingLinked, true)
  for (const h of hotels) {
    assert.equal(weComRepairBotRecipientsForHotel(pending, h.hotelId).includes('new.manager'), false)
    assert.equal(weComRepairBotCanRepairHotel({ credentials: pending, userId: 'new.manager', hotelId: h.hotelId }), false)
  }
  const result = activatePreauthorizedRepairAdmin({ credentials: pending, frame: entryFrame(), hotels, now })
  assert.equal(result.activated, true)
  assert.deepEqual(result.credentials.allowedUserIds, ['global.user'])
  assert.equal(weComRepairBotCanRepairHotel({ credentials: result.credentials, userId: 'new.manager', hotelId: 'hotel-3' }), true)
  assert.equal(weComRepairBotCanRepairHotel({ credentials: result.credentials, userId: 'new.manager', hotelId: 'hotel-2' }), false)
  assert.equal(activatePreauthorizedRepairAdmin({ credentials: result.credentials, frame: entryFrame(), hotels, now }).activated, false)
})

test('wrong identity, group, stale event, foreign corp/bot and disabled directory never activate pending grants', () => {
  const pending = pendingAdmin()
  for (const overrides of [
    { from: { userid: 'someone.else', corpid: directory.corpId } },
    { from: { userid: 'new.manager', corpid: 'other-corp' } },
    { aibotid: 'other-bot' }, { aibotid: undefined },
    { chattype: 'group' }, { chatid: 'group-id' },
    { create_time: undefined }, { create_time: Math.floor(now.getTime() / 1000) - 60 },
    { create_time: Math.floor(now.getTime() / 1000) + 120 },
  ]) assert.equal(activatePreauthorizedRepairAdmin({ credentials: pending, frame: entryFrame(overrides), hotels, now }).activated, false)
  assert.equal(activatePreauthorizedRepairAdmin({ credentials: { ...pending, directorySync: { ...pending.directorySync, enabled: false } }, frame: entryFrame(), hotels, now }).activated, false)
  assert.equal(activatePreauthorizedRepairAdmin({ credentials: pending, frame: entryFrame({ msgtype: 'text', chattype: 'single', create_time: undefined, text: { content: '激活' } }), hotels, now }).activated, true)
})

test('manual revoke and member departure cancel pending authorization permanently', () => {
  const pending = pendingAdmin()
  const revoked = updateRepairAdmin({ credentials: pending, action: 'REVOKE', memberId: memberId('new.manager'), hotels, now })
  const departed = applyRepairDirectoryEvent({ credentials: pending, xml: eventXml('new.directory'), now }).credentials
  for (const current of [revoked, departed]) {
    assert.equal(repairAdminRoster(current, hotels).find((m) => m.userId === 'new.manager').activationStatus, 'REVOKED')
    assert.equal(activatePreauthorizedRepairAdmin({ credentials: current, frame: entryFrame(), hotels, now }).activated, false)
    assert.throws(() => pendingAdmin({ credentials: current }), /MEMBER_REVOKED/)
    assert.throws(() => pendingAdmin({ credentials: current, userId: 'new.alias' }), /DIRECTORY_USER_DUPLICATE/)
  }
})

test('new preauthorization requires verified corporate identity; known users get immediate exact store updates', () => {
  assert.throws(() => pendingAdmin({ directoryIdentityConfirmed: false }), /IDENTITY_CONFIRM_REQUIRED/)
  assert.throws(() => pendingAdmin({ credentials: credentials() }), /DIRECTORY_NOT_VERIFIED/)
  assert.throws(() => pendingAdmin({ hotelIds: ['not-real'] }), /HOTELS_INVALID/)
  assert.throws(() => pendingAdmin({ directoryUserId: 'zhangsan' }), /DIRECTORY_USER_DUPLICATE/)
  const immediate = pendingAdmin({ credentials: credentials(), userId: 'manager', hotelIds: ['hotel-3'] })
  assert.equal(immediate.userProfiles.manager.directoryUserId, 'zhangsan')
  assert.deepEqual(immediate.hotelAllowedUserIds['hotel-1'], [])
  assert.deepEqual(immediate.hotelAllowedUserIds['hotel-3'], ['manager'])
})

test('editing pending stores preserves departure ordering; contact rename requires renewed identity confirmation', () => {
  const pending = pendingAdmin()
  const edited = pendingAdmin({ credentials: pending, now: new Date(now.getTime() + 60_000) })
  assert.equal(edited.userProfiles['new.manager'].directoryLinkedAt, pending.userProfiles['new.manager'].directoryLinkedAt)
  assert.equal(applyRepairDirectoryEvent({ credentials: edited, xml: eventXml('new.directory'), now }).result, 'REVOKED')
  const renamed = applyRepairDirectoryEvent({ credentials: pending,
    xml: eventXml('new.directory', 'update_user', '<NewUserID>new.directory.renamed</NewUserID>'), now }).credentials
  assert.equal(activatePreauthorizedRepairAdmin({ credentials: renamed, frame: entryFrame(), hotels, now }).activated, false)
  assert.equal(repairAdminRoster(renamed, hotels).find((m) => m.userId === 'new.manager').identityReviewRequired, true)
})

test('activation rechecks store existence/capacity and pending reservations are bounded', () => {
  const pending = pendingAdmin()
  pending.hotelAllowedUserIds['hotel-3'] = Array.from({ length: 20 }, (_, i) => `occupant-${i}`)
  const before = structuredClone(pending)
  assert.throws(() => activatePreauthorizedRepairAdmin({ credentials: pending, frame: entryFrame(), hotels, now }), /CAPACITY_REACHED/)
  assert.deepEqual(pending, before)
  assert.throws(() => activatePreauthorizedRepairAdmin({ credentials: pendingAdmin(), frame: entryFrame(), hotels: hotels.slice(0, 2), now }), /HOTELS_INVALID/)
  assert.throws(() => pendingAdmin({ credentials: pending, userId: 'another', directoryUserId: 'another.directory' }), /CAPACITY_REACHED/)
})

test('welcome hook handles activation errors truthfully without exposing exception details or replying to groups', () => {
  class Fake extends EventEmitter {
    isConnected = true; replies = []
    connect() { this.emit('authenticated') }
    disconnect() {}
    async replyWelcome(frame, body) { this.replies.push(body.text.content) }
  }
  const fake = new Fake()
  const runtime = createWeComRepairBotRuntime({ createClient: () => fake, onEnterChat() { throw new Error('private-details') } })
  runtime.configure({ enabled: true, credentials: credentials() })
  fake.emit('event.enter_chat', entryFrame())
  assert.match(fake.replies[0], /自动绑定未完成/)
  assert.equal(fake.replies[0].includes('private-details'), false)
  fake.emit('event.enter_chat', entryFrame({ chattype: 'group' }))
  assert.equal(fake.replies.length, 1)
})

test('encrypted roster supports many staff without relaxing ordinary HTTP cookie limits', () => {
  const key = Buffer.alloc(32, 27).toString('base64url'), scope = 'wecom-repair-bot:v1'
  const payload = JSON.stringify({ profiles: 'test'.repeat(10000) })
  assert.throws(() => validateCookieValue(payload), /COOKIE_VALUE_INVALID/)
  assert.throws(() => encryptCookie(payload, key, 'source-cookie:test'), /COOKIE_VALUE_INVALID/)
  const encrypted = encryptCookie(payload, key, scope)
  assert.equal(decryptCookie(encrypted, key, scope), payload)
  assert.throws(() => decryptCookie(encrypted, key, 'source-cookie:test'))
  assert.throws(() => encryptCookie('x'.repeat(4 * 1024 * 1024 + 1), key, scope), /COOKIE_VALUE_INVALID/)
})
