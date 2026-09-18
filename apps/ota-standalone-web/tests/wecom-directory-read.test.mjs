import assert from 'node:assert/strict'
import test from 'node:test'
import { normalizeDirectoryRead, readDirectoryNames, directoryReadView, directoryReadDue, directoryReadErrorCode } from '../../../tools/uat/wecom/src/wecom-directory-read.mjs'
import { normalizeWeComRepairBotCredentials } from '../../../tools/uat/wecom/src/wecom-repair-bot.mjs'
import { repairAdminRoster } from '../../../tools/uat/wecom/src/wecom-repair-admins.mjs'

const config = { enabled: true, corpId: 'ww-test-corp', appSecret: 'example-app-secret-for-test' }
const response = (body) => Response.json({ errcode: 0, ...body })
const mock = (overrides = {}) => async (url, options) => {
  assert.equal(url.origin, 'https://qyapi.weixin.qq.com')
  assert.equal(options.method, 'GET')
  assert.equal(options.redirect, 'error')
  assert.ok(options.signal instanceof AbortSignal)
  const path = url.pathname.replace('/cgi-bin/', '')
  if (overrides[path]) return overrides[path](url)
  if (path === 'gettoken') return response({ access_token: 'test-token' })
  if (path === 'department/simplelist') return response({ department_id: [{ id: 1 }, { id: 2 }, { id: 2 }] })
  if (path === 'user/simplelist') {
    assert.equal(url.searchParams.has('fetch_child'), false)
    return response({ userlist: [{ userid: 'zhang', name: '张三', mobile: 'must-not-persist', department: [1, 2], open_userid: 'ignored' },
      { userid: 'opaque', name: 'opaque' }] })
  }
  assert.fail('unexpected endpoint')
}

test('directory client reads every authorized department and whitelists only ID and name', async () => {
  const calls = []
  const members = await readDirectoryNames(config, { fetchImpl: async (...args) => {
    calls.push(args[0].pathname + '?' + args[0].searchParams.get('department_id'))
    return mock()(...args)
  } })
  assert.deepEqual(members, [{ userId: 'zhang', name: '张三' }])
  assert.equal(calls.length, 4)
  assert.ok(calls.includes('/cgi-bin/user/simplelist?1'))
  assert.ok(calls.includes('/cgi-bin/user/simplelist?2'))
  const normalized = normalizeDirectoryRead({ ...config, members, access_token: 'never-saved', mobile: 'never-saved' })
  assert.equal('access_token' in normalized, false)
  const view = JSON.stringify(directoryReadView(normalized))
  assert.equal(view.includes(config.appSecret), false)
  assert.equal(view.includes('张三'), false)
})

test('directory failures are safe codes without upstream secrets or partial success', async () => {
  for (const [errcode, code] of [[40013, 'CREDENTIAL_INVALID'], [60020, 'IP_FORBIDDEN'], [48009, 'SCOPE_FORBIDDEN'], [45009, 'RATE_LIMITED'], [999, 'UNAVAILABLE']]) {
    await assert.rejects(readDirectoryNames(config, { fetchImpl: mock({ 'user/simplelist': () => response({ errcode, errmsg: 'private-upstream-secret' }) }) }), new RegExp(`^Error: WECOM_DIRECTORY_READ_${code}$`))
  }
  await assert.rejects(readDirectoryNames(config, { fetchImpl: async () => { throw new Error('contains-corpsecret-and-token') } }), /WECOM_DIRECTORY_READ_UNAVAILABLE$/)
  await assert.rejects(readDirectoryNames(config, { fetchImpl: mock({ 'department/simplelist': () => response({ department_id: [] }) }) }), /SCOPE_FORBIDDEN/)
  await assert.rejects(readDirectoryNames(config, { fetchImpl: mock({ 'user/simplelist': (url) => response({ userlist: [{ userid: 'same', name: url.searchParams.get('department_id') === '1' ? '张三' : '李四' }] }) }) }), /RESPONSE_INVALID/)
  assert.equal(directoryReadErrorCode(new Error('secret')), 'WECOM_DIRECTORY_READ_UNAVAILABLE')
})

test('directory response limits and schema guards fail closed', async () => {
  for (const value of [{ ...config, appSecret: 'bad' }, { ...config, members: [{ userId: 'bad id', name: '姓名' }] },
    { ...config, members: [{ userId: 'id', name: '\u202e伪造' }] }]) assert.throws(() => normalizeDirectoryRead(value), /WECOM_DIRECTORY_READ_/)
  await assert.rejects(readDirectoryNames(config, { fetchImpl: mock({ 'department/simplelist': () => response({ department_id: Array.from({ length: 501 }, (_, id) => ({ id: id + 1 })) }) }) }), /LIMIT_EXCEEDED/)
  await assert.rejects(readDirectoryNames(config, { fetchImpl: async () => new Response('x'.repeat(2 * 1024 * 1024 + 1)) }), /LIMIT_EXCEEDED/)
  await assert.rejects(readDirectoryNames(config, { fetchImpl: mock({ 'user/simplelist': () => response({ userlist: [{ userid: 'id', name: 'a'.repeat(129) }] }) }) }), /RESPONSE_INVALID/)
})

test('directory names never mutate remarks, permissions or offboarding links; exact matching only', () => {
  const credentials = normalizeWeComRepairBotCredentials({ botId: 'bot-test-01', secret: 'example-bot-secret-for-test',
    allowedUserIds: ['zhang'], hotelAllowedUserIds: { 'hotel-1': ['bot-opaque', 'unknown', 'missing-link', 'revoked'] },
    directorySync: { enabled: true, corpId: config.corpId, token: 'testToken', encodingAesKey: Buffer.alloc(32, 7).toString('base64').slice(0, -1) },
    directoryRead: { ...config, members: [{ userId: 'zhang', name: '张三' }, { userId: 'li', name: '李四' }, { userId: 'missing-link', name: '不可回退' }, { userId: 'revoked', name: '新同名账号' }] },
    userProfiles: { zhang: { displayName: '张总备注' }, 'bot-opaque': { directoryUserId: 'li', directoryLinkedAt: '2026-09-18T00:00:00Z' },
      'missing-link': { directoryUserId: 'absent', directoryLinkedAt: '2026-09-18T00:00:00Z' }, revoked: { revokedAt: '2026-09-18T00:00:00Z' } },
  })
  const before = structuredClone(credentials)
  const rows = repairAdminRoster(credentials, [])
  const find = (id) => rows.find((m) => m.userId === id)
  assert.equal(find('zhang').wecomName, '张三')
  assert.equal(find('zhang').displayName, '张总备注')
  assert.equal(find('zhang').offboardingLinked, false)
  assert.equal(find('zhang').wecomNameMatch, 'EXACT_ACCOUNT')
  assert.equal(find('bot-opaque').wecomName, '李四')
  for (const id of ['unknown', 'missing-link', 'revoked']) assert.equal(find(id).wecomName, null)
  assert.deepEqual(credentials, before)
  for (const changed of [{ ...credentials.directoryRead, corpId: 'foreign' }, { ...credentials.directoryRead, enabled: false }]) {
    assert.equal(repairAdminRoster({ ...credentials, directoryRead: changed }, []).every((m) => !m.wecomName), true)
  }
})

test('refresh is six-hourly, backs off errors for one hour and does not run when disabled', () => {
  const now = Date.parse('2026-09-18T06:00:00Z')
  assert.equal(directoryReadDue(null, now), false)
  assert.equal(directoryReadDue({ ...config, enabled: false }, now), false)
  assert.equal(directoryReadDue(config, now), true)
  assert.equal(directoryReadDue({ ...config, lastAttemptAt: '2026-09-18T00:00:01Z' }, now), false)
  assert.equal(directoryReadDue({ ...config, lastAttemptAt: '2026-09-18T00:00:00Z' }, now), true)
  assert.equal(directoryReadDue({ ...config, lastAttemptAt: '2026-09-18T05:00:00Z', lastErrorCode: 'failure' }, now), true)
})
