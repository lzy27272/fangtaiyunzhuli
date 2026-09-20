import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { createCloudBrowserManager, inspectCloudHotel, cloudBrowserEnvironment } from '../../../tools/uat/ota-cloud-browser.mjs'
import { CLOUD_PILOTS, cloudNetworkAllowed, cloudPilotFor, cloudProfileId, cloudError,
  validateCloudInput, validateCloudEnvelope } from '../../../tools/uat/ota-cloud-browser-policy.mjs'

const actorId = '90000000-0000-4000-8000-000000000001'
const secondActor = '90000000-0000-4000-8000-000000000002'
const request = (pilot = CLOUD_PILOTS[0], extras = {}) => ({ tenantId: pilot.tenantId,
  hotelId: pilot.hotelId, platformCode: pilot.platformCode, actorId, action: 'status', ...extras })
const ready = p => ({ state: 'READY', hotelId: p.platformCode === 'CTRIP' ? '1234567' : undefined,
  propertyName: p.propertyName, ...(p.platformCode === 'MEITUAN' ? { poiId: p.poiId, partnerId: p.partnerId } : {}) })
const fixture = async (options = {}) => {
  const root = await mkdtemp(join(tmpdir(), 'ota-cloud-test-'))
  const opened = [], input = []
  const launch = async ({ directory, pilot }) => {
    const callbacks = new Map()
    const browser = { directory, pilot, context: { closed: false,
      on: (name, cb) => callbacks.set(name, cb),
      async close() { this.closed = true; callbacks.get('close')?.() },
    }, page: { url: () => pilot.portal, screenshot: async () => Buffer.from('synthetic-image'),
      mouse: { move: async () => {}, down: async () => {}, up: async () => {}, wheel: async () => {} },
      keyboard: { insertText: async value => input.push(value), press: async value => input.push(value) } } }
    opened.push(browser); return browser
  }
  const manager = createCloudBrowserManager({ root, launch, inspect: async (_page, pilot) => ready(pilot),
    collect: async () => ({ status: 'COMPLETE', completedAt: new Date().toISOString(), datasets: {} }), ...options })
  return { manager, root, opened, input, cleanup: async () => { await manager.closeAll(); await rm(root, { recursive: true, force: true }) } }
}

test('cloud Chrome retains Xvfb authorization but never inherits application secrets', () => {
  const result = cloudBrowserEnvironment({ DISPLAY: ':99', XAUTHORITY: '/tmp/synthetic-Xauthority',
    PATH: '/usr/bin', OTA_REVIEW_SECRET_KEY: 'never-forward', OTA_CLOUD_TOKEN: 'never-forward' })
  assert.deepEqual(result, { PATH: '/usr/bin', DISPLAY: ':99', XAUTHORITY: '/tmp/synthetic-Xauthority' })
})

test('cloud pilot scopes use confirmed UUIDs, separate profiles, and no unenrolled channels', () => {
  assert.notEqual(cloudProfileId(CLOUD_PILOTS[0]), cloudProfileId(CLOUD_PILOTS[1]))
  assert.equal(cloudPilotFor({ ...CLOUD_PILOTS[0], platformCode: 'MEITUAN' }), null)
  assert.equal(cloudPilotFor({ ...CLOUD_PILOTS[1], tenantId: 'another' }), null)
  assert.throws(() => cloudProfileId({}), /SCOPE_INVALID/)
})
test('cloud protocol refuses arbitrary URLs, scripts, forged fields and invalid actions', () => {
  assert.throws(() => validateCloudEnvelope(request(undefined, { url: 'https://example.com' })), /REQUEST_INVALID/)
  assert.throws(() => validateCloudEnvelope(request(undefined, { actorId: '../admin' })), /REQUEST_INVALID/)
  assert.throws(() => validateCloudEnvelope(request(undefined, { action: 'evaluate' })), /REQUEST_INVALID/)
  assert.throws(() => validateCloudInput({ type: 'key', key: 'F12' }), /INPUT_INVALID/)
  assert.throws(() => validateCloudInput({ type: 'text', text: 'x', script: 'foo' }), /INPUT_INVALID/)
  assert.throws(() => validateCloudInput({ type: 'pointer', points: [{ x: 1280, y: 0 }] }), /INPUT_INVALID/)
  assert.throws(() => validateCloudInput({ type: 'text', text: 'bad\ntext' }), /INPUT_INVALID/)
  assert.throws(() => validateCloudInput({ type: 'pointer', points: Array(101).fill({ x: 1, y: 1 }) }), /INPUT_INVALID/)
  assert.doesNotThrow(() => validateCloudInput({ type: 'pointer', points: [{ x: 1, y: 1 }, { x: 200, y: 1 }] }))
})
test('cloud network does not admit localhost, arbitrary hosts, unsafe schemes or known mutations', () => {
  for (const url of ['http://eb.meituan.com', 'https://127.0.0.1', 'file:///etc/passwd',
    'https://me.meituan.com.evil.test', 'https://me.meituan.com:8443', 'https://u:p@me.meituan.com']) {
    assert.equal(cloudNetworkAllowed('MEITUAN', url), false)
  }
  assert.equal(cloudNetworkAllowed('MEITUAN', 'https://me.meituan.com/api/refund', 'POST'), false)
  assert.equal(cloudNetworkAllowed('MEITUAN', 'https://eb.meituan.com/', 'DELETE'), false)
  assert.equal(cloudNetworkAllowed('CTRIP', 'https://ebooking.ctrip.com/login', 'POST'), true)
  assert.equal(cloudNetworkAllowed('MEITUAN', 'https://verify.meituan.com/', 'POST'), true)
})
test('unexpected error details cannot disclose credentials through the public protocol', () => {
  assert.equal(cloudError(new Error('password=secret')), 'OTA_CLOUD_OPERATION_FAILED')
  assert.equal(cloudError(new Error('MEITUAN_DATA_HTTP_403')), 'MEITUAN_DATA_HTTP_403')
})
test('separate cloud sessions cannot view or control another actor or hotel', async () => {
  const f = await fixture()
  try {
    const opened = await f.manager.execute(request(undefined, { action: 'open' }))
    assert.equal(opened.busy, false)
    assert.equal((await f.manager.execute(request(undefined, { action: 'frame', sessionId: opened.sessionId }))).busy, false)
    const other = await f.manager.execute(request(undefined, { actorId: secondActor }))
    assert.equal(other.sessionId, null); assert.equal(other.controlledByOther, true)
    await assert.rejects(f.manager.execute(request(undefined, { actorId: secondActor, action: 'frame', sessionId: opened.sessionId })), /SESSION_EXPIRED/)
    await assert.rejects(f.manager.execute(request(undefined, { actorId: secondActor, action: 'open' })), /IN_USE/)
    await assert.rejects(f.manager.execute(request(CLOUD_PILOTS[1], { action: 'frame', sessionId: opened.sessionId })), /SESSION_EXPIRED/)
    await f.manager.execute(request(CLOUD_PILOTS[1], { action: 'open' }))
    assert.equal(f.opened.length, 2); assert.notEqual(f.opened[0].directory, f.opened[1].directory)
  } finally { await f.cleanup() }
})
test('a second device for the same operator reuses the cloud window and next input sequence', async () => {
  const f = await fixture()
  try {
    const opened = await f.manager.execute(request(undefined, { action: 'open' }))
    const event = { type: 'text', text: 'synthetic-test-input' }
    await f.manager.execute(request(undefined, { action: 'input', sessionId: opened.sessionId, sequence: 1, input: event }))
    assert.equal(event.text, '')
    const anotherDevice = await f.manager.execute(request(undefined, { action: 'open' }))
    assert.equal(anotherDevice.sessionId, opened.sessionId); assert.equal(anotherDevice.nextSequence, 2)
    await f.manager.execute(request(undefined, { action: 'input', sessionId: opened.sessionId, sequence: 1, input: { type: 'text', text: 'duplicate' } }))
    assert.deepEqual(f.input, ['synthetic-test-input'])
    await assert.rejects(f.manager.execute(request(undefined, { action: 'input', sessionId: opened.sessionId, sequence: 4,
      input: { type: 'key', key: 'Enter' } })), /INPUT_SEQUENCE/)
  } finally { await f.cleanup() }
})
test('closing cloud interaction preserves only validated aggregate snapshots and no automatic alerts', async () => {
  const f = await fixture()
  try {
    const opened = await f.manager.execute(request(undefined, { action: 'open' }))
    await f.manager.execute(request(undefined, { action: 'inspect', sessionId: opened.sessionId }))
    const collecting = await f.manager.execute(request(undefined, { action: 'collect', sessionId: opened.sessionId }))
    assert.equal(collecting.status, 'COLLECTING')
    await delay(5)
    const closed = await f.manager.execute(request(undefined, { action: 'close', sessionId: opened.sessionId }))
    assert.equal(closed.status, 'SESSION_SAVED'); assert.equal(closed.latest.status, 'COMPLETE')
    assert.equal(closed.automationEnabled, false); assert.equal(closed.alertsEnabled, false)
    const stored = await readFile(join(f.root, 'snapshots', `${cloudProfileId(CLOUD_PILOTS[0])}.json`), 'utf8')
    assert.doesNotMatch(stored, /sessionId|actorId|frame|password|cookies|synthetic-test-input/)
    const restarted = createCloudBrowserManager({ root: f.root })
    const afterRestart = await restarted.execute(request())
    assert.equal(afterRestart.latest.status, 'COMPLETE'); await restarted.closeAll()
  } finally { await f.cleanup() }
})
test('provider rejection cannot replace a successful snapshot with zero values', async () => {
  const f = await fixture({ collect: async () => { throw new Error('MEITUAN_DATA_HTTP_403') } })
  try {
    const opened = await f.manager.execute(request(undefined, { action: 'open' }))
    await f.manager.execute(request(undefined, { action: 'collect', sessionId: opened.sessionId }))
    await delay(5)
    const result = await f.manager.execute(request())
    assert.equal(result.status, 'COLLECTION_FAILED'); assert.equal(result.lastErrorCode, 'MEITUAN_DATA_HTTP_403')
    assert.equal(result.latest, null)
  } finally { await f.cleanup() }
})
test('unconfirmed or changed hotel blocks collection before any provider reads', async () => {
  let reads = 0
  const f = await fixture({ inspect: async () => ({ state: 'STORE_MISMATCH' }), collect: async () => { reads++ } })
  try {
    const opened = await f.manager.execute(request(undefined, { action: 'open' }))
    const result = await f.manager.execute(request(undefined, { action: 'collect', sessionId: opened.sessionId }))
    assert.equal(result.status, 'STORE_MISMATCH'); assert.equal(reads, 0); assert.equal(result.binding, null)
  } finally { await f.cleanup() }
})
test('expired windows cannot accept input and recreate with a distinct interactive lease', async () => {
  let time = 1000
  const f = await fixture({ now: () => time, leaseMs: 10000 })
  try {
    const first = await f.manager.execute(request(undefined, { action: 'open' }))
    time += 10001
    await assert.rejects(f.manager.execute(request(undefined, { action: 'frame', sessionId: first.sessionId })), /SESSION_EXPIRED/)
    const second = await f.manager.execute(request(undefined, { action: 'open' }))
    assert.notEqual(first.sessionId, second.sessionId); assert.equal(f.opened[0].context.closed, true)
  } finally { await f.cleanup() }
})
test('Ctrip cloud scope comes from a unique visible official hotel link, not login or account name', async () => {
  const pilot = CLOUD_PILOTS[0]
  const page = links => ({ url: () => pilot.portal, locator: () => ({ evaluateAll: async () => links }) })
  assert.equal((await inspectCloudHotel(page([]), pilot)).state, 'LOGIN_REQUIRED')
  assert.equal((await inspectCloudHotel(page([{ href: 'https://hotels.ctrip.com/hotels/12345.html', name: 'wrong hotel' }]), pilot)).state, 'STORE_MISMATCH')
  const result = await inspectCloudHotel(page([{ href: 'https://hotels.ctrip.com/hotels/12345.html', name: pilot.propertyName }]), pilot)
  assert.equal(result.state, 'READY'); assert.equal(result.hotelId, '12345')
})
