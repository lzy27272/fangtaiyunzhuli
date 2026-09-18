import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { EventEmitter } from 'node:events'
import test from 'node:test'
import { normalizeWeComRepairBotCredentials, createWeComRepairBotRuntime, weComRepairBotCanRepairHotel } from '../../../tools/uat/wecom/src/wecom-repair-bot.mjs'
import { repairAdminRoster, updateRepairAdmin, applyRepairDirectoryEvent } from '../../../tools/uat/wecom/src/wecom-repair-admins.mjs'
import { configureRepairApprovals, parseRepairApprovalText, submitRepairApproval, decideRepairApproval,
  cancelRepairApproval, ownRepairApproval, reconcileRepairApprovals, repairApprovalView, repairApprovalCard,
  createRepairApprovalOutbox } from '../../../tools/uat/wecom/src/wecom-repair-approvals.mjs'
import { encryptCookie, decryptCookie } from '../../../tools/uat/report-source-cookie-crypto.mjs'

const now = new Date('2026-09-18T08:00:00Z')
const hash = (s) => createHash('sha256').update(s).digest('hex')
const hotels = [1, 2, 3].map((n) => ({ hotelId: `hotel-${n}`, hotelCode: `00${n}`, hotelName: `测试门店${n}` }))
const base = () => normalizeWeComRepairBotCredentials({ botId: 'test-approval-bot', secret: 'example-test-approval-secret',
  allowedUserIds: ['owner', 'ops'], hotelAllowedUserIds: { 'hotel-3': ['plain.receiver'] },
  userProfiles: Object.fromEntries(['owner', 'ops'].map((id) => [id, { displayName: `测试${id}`, directoryUserId: `directory.${id}`, directoryLinkedAt: now.toISOString() }])),
  directorySync: { enabled: true, corpId: 'ww-test-corp', token: 'testCallbackToken',
    encodingAesKey: Buffer.alloc(32, 11).toString('base64').slice(0, -1), verifiedAt: now.toISOString() },
})
const configured = () => configureRepairApprovals({ credentials: base(), enabled: true, approverMemberIds: ['owner', 'ops'].map(hash), now })
const frame = (userId = 'applicant', changes = {}) => ({ body: { aibotid: 'test-approval-bot', msgid: 'message-1',
  chattype: 'single', msgtype: 'text', from: { userid: userId, corpid: 'ww-test-corp' }, create_time: now.getTime() / 1000, ...changes } })
const submit = (c = configured(), f = frame(), text = '申请 001,002 测试员工') => submitRepairApproval({ credentials: c, frame: f, hotels, command: parseRepairApprovalText(text), now })
const pending = () => { const { credentials: c } = submit(); c.bindingApproval.requests[0].cards.forEach((d) => { d.status = 'SENT' }); return c }
const cardFrame = (c, userId = 'owner', key = 'BIND_APPROVE') => frame(userId, { msgtype: 'event', event: {
  eventtype: 'template_card_event', task_id: c.bindingApproval.requests[0].cards.find((d) => d.userId === userId)?.id, event_key: key,
} })
const decide = (c, f = cardFrame(c)) => decideRepairApproval({ credentials: c, frame: f, hotels, now })

test('binding approval defaults off and does not inherit notification recipients; explicit verified selection only', () => {
  const c = base()
  assert.deepEqual(c.bindingApproval, { enabled: false, revision: 0, approverUserIds: [], requests: [] })
  for (const ids of [[], ['plain.receiver'], ['owner', 'ops', 'plain.receiver'], ['missing']]) {
    assert.throws(() => configureRepairApprovals({ credentials: c, enabled: true, approverMemberIds: ids.map(hash), now }), /WECOM_REPAIR_APPROVAL_/)
  }
  const next = configured()
  assert.deepEqual(next.allowedUserIds, c.allowedUserIds)
  assert.deepEqual(next.hotelAllowedUserIds, c.hotelAllowedUserIds)
  assert.equal(repairApprovalView(next, hotels, now).eligibleMemberIds.length, 2)
})

test('request parsing supports exact store codes and Chinese delimiters, not bare numbers or arbitrary commands', () => {
  assert.deepEqual(parseRepairApprovalText('申请 001， 002 张三'), { type: 'APPLY', hotelCodes: ['001', '002'], claimedName: '张三' })
  assert.equal(parseRepairApprovalText('003'), null)
  assert.equal(parseRepairApprovalText('申请 003').type, 'INVALID')
  assert.equal(parseRepairApprovalText('申请状态').type, 'STATUS')
  assert.equal(parseRepairApprovalText('取消申请').type, 'CANCEL')
})

test('pending application grants nothing; duplicate delivery/message requests produce no extra cards', () => {
  const first = submit(), c = first.credentials
  assert.equal(first.request.cards.length, 2)
  assert.equal(c.userProfiles.applicant, undefined)
  assert.equal(weComRepairBotCanRepairHotel({ credentials: c, userId: 'applicant', hotelId: 'hotel-1' }), false)
  assert.equal(submit(c).credentials, c)
  assert.equal(submit(c, frame('applicant', { msgid: 'different-message' })).request.id, first.request.id)
  assert.throws(() => submit(c, frame('applicant', { msgid: 'changed-message' }), '申请 003 测试员工'), /PENDING_EXISTS/)
})

test('foreign bot/corp, group, malformed and stale frames cannot create or read applications', () => {
  for (const changes of [{ aibotid: 'other-bot' }, { from: { userid: 'applicant', corpid: 'other-corp' } },
    { chattype: 'group' }, { chatid: 'group-id' }, { msgtype: 'image' }, { create_time: 1 }, { msgid: '' }]) {
    assert.throws(() => submit(configured(), frame('applicant', changes)), /IDENTITY_INVALID/)
  }
  const c = submit().credentials
  assert.equal(ownRepairApproval({ credentials: c, frame: frame('stranger'), now }), null)
  assert.throws(() => ownRepairApproval({ credentials: c, frame: frame('applicant', { aibotid: 'other-bot' }), now }), /IDENTITY_INVALID/)
})

test('unknown store, unsafe claimed name, revoked applicant and self-only approver fail closed', () => {
  assert.throws(() => submit(configured(), frame(), '申请 999 测试员工'), /HOTELS_INVALID/)
  assert.throws(() => submit(configured(), frame(), '申请 001 <假的姓名>'), /NAME_INVALID/)
  const c = configured(); c.userProfiles.applicant = { revokedAt: now.toISOString() }
  assert.throws(() => submit(c), /MEMBER_REVOKED/)
  const solo = configureRepairApprovals({ credentials: base(), enabled: true, approverMemberIds: [hash('owner')], now })
  assert.throws(() => submit(solo, frame('owner')), /NO_APPROVER/)
  assert.deepEqual(submit(configured(), frame('owner')).request.cards.map((d) => d.userId), ['ops'])
})

test('either designated approver grants exact stores once, preserving global roles and marking claimed identity', () => {
  const c = pending(), original = structuredClone(c)
  const result = decide(c, cardFrame(c, 'ops'))
  assert.equal(result.request.status, 'APPROVED')
  assert.deepEqual(c, original)
  assert.deepEqual(result.credentials.allowedUserIds, c.allowedUserIds)
  const row = repairAdminRoster(normalizeWeComRepairBotCredentials(result.credentials), hotels).find((r) => r.userId === 'applicant')
  assert.deepEqual(row.hotelIds, ['hotel-1', 'hotel-2'])
  assert.equal(row.globalRecipient, false)
  assert.equal(row.nameSource, 'APPLICANT_PROVIDED')
  assert.equal(row.offboardingLinked, false)
  assert.deepEqual(result.request.notices.map((n) => n.userId), ['applicant', 'owner'])
  assert.equal(decide(result.credentials, cardFrame(c, 'owner', 'BIND_REJECT')).changed, false)
  assert.equal(decide(result.credentials).request.status, 'APPROVED')
})

test('reject, forwarded card, unsent card, forged action and wrong event cannot grant rights', () => {
  const c = pending()
  const rejected = decide(c, cardFrame(c, 'ops', 'BIND_REJECT'))
  assert.equal(rejected.request.status, 'REJECTED')
  assert.equal(rejected.credentials.userProfiles.applicant, undefined)
  for (const user of ['applicant', 'plain.receiver', 'stranger', 'ops']) {
    const f = cardFrame(c); f.body.from.userid = user
    assert.throws(() => decide(c, f), /FORBIDDEN/)
  }
  assert.throws(() => decide(c, cardFrame(c, 'owner', 'OTHER_ACTION')), /FORBIDDEN/)
  const malformed = cardFrame(c); malformed.body.msgtype = 'text'
  assert.throws(() => decide(c, malformed), /IDENTITY_INVALID/)
  const unsent = submit().credentials
  assert.throws(() => decide(unsent), /FORBIDDEN/)
})

test('full store causes atomic failure without partial grants or a successful decision', () => {
  const c = pending()
  c.hotelAllowedUserIds['hotel-2'] = Array.from({ length: 20 }, (_, i) => `occupant.${i}`)
  assert.throws(() => decide(c), /CAPACITY_REACHED/)
  assert.equal(c.hotelAllowedUserIds['hotel-1'], undefined)
  assert.equal(c.bindingApproval.requests[0].status, 'PENDING')
})

test('expiry, applicant cancellation, config change and account updates invalidate old cards', () => {
  const c = pending()
  const expired = reconcileRepairApprovals(c, new Date(now.getTime() + 86_400_001))
  assert.equal(expired.bindingApproval.requests[0].status, 'EXPIRED')
  const cancelled = cancelRepairApproval({ credentials: c, frame: frame(), now })
  assert.equal(decide(cancelled).request.status, 'CANCELLED')
  assert.equal(cancelRepairApproval({ credentials: c, frame: frame('stranger'), now }), c)
  const changed = configureRepairApprovals({ credentials: c, enabled: true, approverMemberIds: [hash('owner')], now })
  assert.equal(decide(changed).request.status, 'CANCELLED')
  const edited = structuredClone(c); edited.userProfiles.applicant = { displayName: '管理员已修改' }
  assert.equal(reconcileRepairApprovals(edited, now).bindingApproval.requests[0].status, 'CANCELLED')
})

test('manual/offboarding revocation immediately disables approver on pending cards', () => {
  let c = pending()
  const xml = `<xml><ToUserName>ww-test-corp</ToUserName><MsgType>event</MsgType><Event>change_contact</Event><ChangeType>delete_user</ChangeType><CreateTime>${now.getTime() / 1000}</CreateTime><UserID>directory.owner</UserID></xml>`
  c = applyRepairDirectoryEvent({ credentials: c, xml, now }).credentials
  assert.throws(() => decide(c, cardFrame(c, 'owner')), /FORBIDDEN/)
  assert.equal(decide(c, cardFrame(c, 'ops')).request.status, 'APPROVED')
  c = updateRepairAdmin({ credentials: c, memberId: hash('ops'), action: 'REVOKE', hotels, now })
  assert.equal(reconcileRepairApprovals(c, now).bindingApproval.requests[0].status, 'CANCELLED')
})

test('rate bound is per actual sender and encrypted state survives restart; no card secrets in admin view', () => {
  let c = configured()
  for (let i = 0; i < 5; i += 1) {
    c = submit(c, frame('applicant', { msgid: `request-${i}` })).credentials
    c = cancelRepairApproval({ credentials: c, frame: frame(), now })
  }
  assert.throws(() => submit(c, frame('applicant', { msgid: 'request-six' })), /RATE_LIMITED/)
  const key = Buffer.alloc(32, 13).toString('base64url')
  const encrypted = encryptCookie(JSON.stringify(c), key, 'wecom-repair-bot:v1')
  const roundtrip = normalizeWeComRepairBotCredentials(JSON.parse(decryptCookie(encrypted, key, 'wecom-repair-bot:v1')))
  assert.deepEqual(roundtrip.bindingApproval, c.bindingApproval)
  const view = JSON.stringify(repairApprovalView(c, hotels, now))
  assert.equal(view.includes('bind_'), false)
  assert.equal(view.includes('profileGuard'), false)
  assert.equal(JSON.stringify(encrypted).includes('测试员工'), false)
})

test('outbox persists before I/O, merges latest state and does not replay successful/ambiguous sends', async () => {
  let c = submit().credentials, count = 0
  const outbox = createRepairApprovalOutbox({ getCredentials: () => c, commit: (v) => { c = v }, getHotels: () => hotels,
    enabled: () => true, now: () => now, runtime: () => ({ status: () => ({ connected: true }),
      sendBindingMessage: async (job) => {
        assert.equal(c.bindingApproval.requests[0].cards.find((d) => d.id === job.id).status, 'SENDING')
        assert.equal(outbox.allowed(job), true)
        c = { ...c, userProfiles: { ...c.userProfiles, unrelated: { displayName: '保留并发编辑' } } }
        if (++count === 2) throw new Error('ambiguous network')
        return { errcode: 0 }
      } }) })
  await Promise.all([outbox.flush(), outbox.flush()]); await outbox.flush()
  assert.equal(count, 2)
  assert.deepEqual(c.bindingApproval.requests[0].cards.map((d) => d.status), ['SENT', 'UNKNOWN'])
  assert.equal(c.userProfiles.unrelated.displayName, '保留并发编辑')
  c.bindingApproval.requests[0].cards[0].status = 'SENDING'
  c = reconcileRepairApprovals(c, now, true)
  await outbox.flush()
  assert.equal(count, 2)
  assert.equal(c.bindingApproval.requests[0].cards[0].status, 'UNKNOWN')
})

test('outbox disk failure before claim sends nothing; callback keeps a decision when in-flight delivery finishes', async () => {
  let c = submit().credentials, sends = 0
  const failed = createRepairApprovalOutbox({ getCredentials: () => c, commit: () => { throw Error('disk failed') },
    getHotels: () => hotels, enabled: () => true, now: () => now, runtime: () => ({ status: () => ({ connected: true }),
      sendBindingMessage: async () => { sends += 1 } }) })
  await assert.rejects(failed.flush(), /disk failed/)
  assert.equal(sends, 0)
  const outbox = createRepairApprovalOutbox({ getCredentials: () => c, commit: (v) => { c = v }, getHotels: () => hotels,
    enabled: () => true, now: () => now, runtime: () => ({ status: () => ({ connected: true }), sendBindingMessage: async () => {
      sends += 1; c = decide(c).credentials; return { errcode: 0 }
    } }) })
  await outbox.flush()
  assert.equal(c.bindingApproval.requests[0].status, 'APPROVED')
  assert.equal(sends, 1)
})

test('runtime rechecks binding outbox permission inside the queue and does not grant operational messaging', async () => {
  let grant = true, calls = 0
  class Client extends EventEmitter { isConnected = true; connect() { this.emit('authenticated') } disconnect() {}
    async sendMessage() { calls += 1; return { errcode: 0 } } }
  const runtime = createWeComRepairBotRuntime({ createClient: () => new Client(), canSendToUser: () => false,
    canSendBindingMessage: () => grant, minimumProactiveIntervalMs: 0 })
  runtime.configure({ enabled: true, credentials: base() })
  await assert.rejects(runtime.sendText('applicant', 'private PMS data'), /USER_REVOKED/)
  await runtime.sendBindingMessage({ userId: 'applicant', body: { msgtype: 'markdown', markdown: { content: '拒绝结果' } } })
  const queued = runtime.sendBindingMessage({ userId: 'applicant', body: { msgtype: 'markdown' } })
  grant = false
  await assert.rejects(queued, /FORBIDDEN/)
  assert.equal(calls, 1)
  runtime.disconnect()
})

test('approval card visibly distinguishes claimed name, actual account, exact stores and limited authority', () => {
  const r = submit().request, card = repairApprovalCard(r, r.cards[0], hotels)
  assert.match(card.sub_title_text, /员工填写.*测试员工/u)
  assert.match(card.sub_title_text, /企微账号：applicant/u)
  assert.match(card.sub_title_text, /001 测试门店1、002 测试门店2/u)
  assert.match(card.sub_title_text, /不授予审批权/u)
  assert.equal(card.task_id, r.cards[0].id)
  assert.notEqual(r.cards[0].id, r.cards[1].id)
})
