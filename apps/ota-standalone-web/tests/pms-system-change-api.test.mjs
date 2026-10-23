import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { createServer, request as httpRequest } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash, randomUUID } from 'node:crypto'
import test from 'node:test'
import { decryptCookie, encryptCookie } from '../../../tools/uat/report-source-cookie-crypto.mjs'
import { fingerprintWeComWebhook } from '../../../tools/uat/wecom/src/wecom-group-robot.mjs'

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url))
const apiScript = join(repoRoot, 'tools/uat/ota-standalone-review-api.mjs')
const secretKey = Buffer.alloc(32, 17).toString('base64url')
const tenantId = '10000000-0000-4000-8000-000000000001'
const hotelId = '20000000-0000-4000-8000-000000000009'
const otherHotelId = '20000000-0000-4000-8000-000000000010'
const sourceId = '34000000-0000-4000-8000-000000000001'
const baseHotel = (id, code, pms = 'LUOPAN_CLOUD') => ({
  tenantId, hotelId: id, tenantCode: '001', tenantName: 'Synthetic tenant',
  hotelCode: code, hotelName: `Synthetic hotel ${code}`, ownershipType: 'DIRECT',
  pmsSystemCode: pms, pmsSystemName: pms === 'LUOPAN_CLOUD' ? '罗盘PMS' : '美团别样红 PMS',
  timezone: 'Asia/Shanghai', collectionEnabled: true, rowVersion: 4,
  lifecycleStatus: 'PILOT', messageEnabled: false, configuredMockConnectors: 2, simulationOnly: true,
})
const report = {
  sourceId, displayName: 'Synthetic former report', reportType: 'ORDER_DETAIL',
  endpointUrl: 'https://pms.meituan.com/hotelpms/api/v1/report/jd01',
  calculationRole: 'PRIMARY_CALCULATION', pollIntervalMinutes: 60,
  credentialAlias: '', requestPayloadJson: '', enabled: true,
  validationStatus: 'FORMAT_VALID', rowVersion: 1,
}
const jsonFile = async (root, name, value) => writeFile(join(root, name), JSON.stringify(value), 'utf8')
const readJson = async (root, name) => JSON.parse(await readFile(join(root, name), 'utf8'))

async function seed(root) {
  await jsonFile(root, 'simulation-hotels.json', [baseHotel(hotelId, '009'), baseHotel(otherHotelId, '010', 'MEITUAN_BIEYANGHONG')])
  await jsonFile(root, 'report-sources.json', { [hotelId]: [report], [otherHotelId]: [report] })
  await jsonFile(root, 'report-source-cookie-secrets.json', Object.fromEntries([hotelId, otherHotelId].map(id => [id, {
    [sourceId]: encryptCookie('synthetic_cookie=former-vendor', secretKey, `${id}:${sourceId}`),
  }])))
  await jsonFile(root, 'pms-login-secrets.json', Object.fromEntries([hotelId, otherHotelId].map(id => [id,
    encryptCookie(JSON.stringify({ username: 'synthetic-user', password: 'example-Synthetic-Password-42' }), secretKey, `pms-login:${id}`),
  ])))
  await jsonFile(root, 'luopan-browser-configs.json', { [hotelId]: {
    enabled: true, profileRef: 'synthetic-009', scopeStatus: 'SINGLE_HOTEL_CONFIRMED',
    expectedHotelFingerprint: '1234567890abcdef', rowVersion: 2,
  } })
  const session = { cookies: [{ name: 'synthetic', value: 'former-session-value', domain: 'bj.chinapms.com',
    path: '/', expires: -1, httpOnly: true, secure: false, sameSite: 'Lax' }], origins: [] }
  await jsonFile(root, 'luopan-session-secrets.json', { [hotelId]: encryptCookie(JSON.stringify(session), secretKey, `luopan-session:${hotelId}`) })
  await jsonFile(root, 'live-report-snapshots.json', Object.fromEntries([hotelId, otherHotelId].map(id => [id, [{
    tenantId, hotelId: id, sourceSystem: 'LUOPAN_CLOUD', observedAt: '2026-10-21T04:00:00.000Z',
    businessDate: '2026-10-21', collectionRunId: `former-${id}`, completeness: 'COMPLETE',
    physicalInventory: [{ physicalRoomTypeCode: 'FORMER_KING', displayName: 'Former king', availableRooms: 1 }],
  }]])))
  await jsonFile(root, 'business-day-controls.json', { [hotelId]: { businessDate: '2026-10-21', mode: 'PMS_CONFIRMED' } })
  await jsonFile(root, 'room-type-mappings.json', { [hotelId]: {
    schemaVersion: 1, roomTypeCodes: ['FORMER_KING'], mappings: [], rowVersion: 3,
  } })
  await jsonFile(root, 'future-demand-risk-states.json', { [`${hotelId}:2026-10-23`]: { eventSequence: 2 } })
  await jsonFile(root, 'ota-source-configs.json', { [hotelId]: [], [otherHotelId]: [] })
  await jsonFile(root, 'ota-source-secrets.json', {})
  await jsonFile(root, 'wecom-configs.json', { [hotelId]: { enabled: false, broadcastIntervalHours: 0 } })
  await jsonFile(root, 'wecom-repair-bot-config.json', { enabled: false, rowVersion: 7 })
  await mkdir(join(root, 'analytics-retention'), { recursive: true })
  await writeFile(join(root, 'analytics-retention', 'retained-history.jsonl'), '{"syntheticHistoricalFact":true}\n')
}

async function start(root, { expectFailure = false, collectorFixture = false } = {}) {
  const socket = createServer()
  await new Promise(resolve => socket.listen(0, '127.0.0.1', resolve))
  const { port } = socket.address()
  await new Promise(resolve => socket.close(resolve))
  const env = { ...process.env, OTA_REVIEW_API_PORT: String(port),
    OTA_REVIEW_USERNAME: 'pms-test', OTA_REVIEW_PASSWORD: 'example-Pms-Test-Password-42',
    OTA_REVIEW_ACCESS_TOKEN: 'pms-test-bootstrap-token', OTA_REVIEW_DATA_PATH: join(root, 'report-sources.json'),
    OTA_REVIEW_COOKIE_SECRETS_PATH: join(root, 'report-source-cookie-secrets.json'),
    OTA_REVIEW_SECRET_KEY: secretKey, OTA_REVIEW_PSEUDONYM_SECRET_KEY: Buffer.alloc(32, 18).toString('base64url'),
    OTA_REVIEW_AUTH_STATE_PATH: join(root, 'review-auth-state.json'),
    OTA_REVIEW_AUTH_REFRESH_STATE_PATH: join(root, 'review-auth-sessions.json'),
    OTA_REVIEW_SECURITY_AUDIT_PATH: join(root, 'security-audit.jsonl'),
    OTA_ANALYTICS_RETENTION_ENABLED: 'false', OTA_ANALYTICS_RETENTION_ROOT: join(root, 'analytics-retention'),
    OTA_OCCUPANCY_HISTORY_PATH: join(root, 'analytics-retention', 'occupancy-history.json'),
    OTA_REVIEW_AUTO_COLLECTION_ENABLED: 'false', OTA_REVIEW_YILIAN_ASSISTED_REAUTH_ENABLED: 'false',
    OTA_REVIEW_LUOPAN_ASSISTED_REAUTH_ENABLED: 'false', OTA_REVIEW_BIEYANGHONG_ASSISTED_REAUTH_ENABLED: 'false',
    OTA_REVIEW_TRUSTED_DEVICE_ENABLED: 'false' }
  env.PMS_SYSTEM_TEST_COLLECTOR_STATE_PATH = join(root, 'collector-test-state.json')
  env.PMS_SYSTEM_TEST_SEND_SPY_PATH = join(root, 'wecom-network-test-spy.jsonl')
  env.PMS_SYSTEM_TEST_COLLECTOR_SPY_PATH = join(root, 'collector-test-spy.jsonl')
  const args = collectorFixture
    ? ['--import', new URL('./fixtures/pms-system-collector-loader.mjs', import.meta.url).href, apiScript]
    : [apiScript]
  const child = spawn(process.execPath, args, { cwd: repoRoot, env, stdio: ['ignore', 'pipe', 'pipe'] })
  let errors = ''
  child.stderr.on('data', chunk => { errors += chunk })
  child.stdout.resume()
  const origin = `http://127.0.0.1:${port}`
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (child.exitCode !== null) {
      if (expectFailure) return { child, errors }
      throw new Error(`PMS_TEST_API_EXITED:${errors}`)
    }
    try {
      if ((await fetch(`${origin}/health`)).ok) {
        assert.equal(expectFailure, false)
        const login = await fetch(`${origin}/api/v1/auth/login`, { method: 'POST',
          headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'pms-test', password: 'example-Pms-Test-Password-42' }) })
        assert.equal(login.status, 200)
        const token = (await login.json()).accessToken
        return { child, origin, token, scoped: `${origin}/api/v1/ota/tenants/${tenantId}/hotels/${hotelId}`,
          get errors() { return errors } }
      }
    } catch (error) {
      if (error instanceof assert.AssertionError) throw error
    }
    await new Promise(resolve => setTimeout(resolve, 30))
  }
  child.kill()
  throw new Error('PMS_TEST_API_START_TIMEOUT')
}
async function stop(app) {
  if (!app || app.child.exitCode !== null) return
  app.child.kill()
  await once(app.child, 'exit')
}
async function call(app, suffix, body, token = app.token) {
  const response = await fetch(`${app.scoped}${suffix}`, { method: body === undefined ? 'GET' : 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'Idempotency-Key': randomUUID() },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
  return { status: response.status, body: await response.json() }
}
const change = (code, version = 4, extra = {}) => ({ expectedRowVersion: version,
  pmsSystemCode: code, confirmChange: true, reasonCode: 'CHANGE_HOTEL_PMS_SYSTEM', ...extra })

test('PMS change archives the retained 50 snapshots from a realistic 100-snapshot input larger than an HTTP Cookie', { timeout: 20_000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'pms-change-realistic-history-'))
  let app
  try {
    await seed(root)
    const snapshotStore = await readJson(root, 'live-report-snapshots.json')
    const original = snapshotStore[hotelId][0]
    snapshotStore[hotelId] = Array.from({ length: 100 }, (_, index) => ({
      ...original, collectionRunId: randomUUID(),
      observedAt: new Date(Date.now() - (100 - index) * 60 * 60_000).toISOString(),
      overview: { roomCount: 80, availableRooms: 30, soldRooms: 50, roomNights: 50, roomFee: 10000, adr: 200, revPar: 125 },
      physicalInventory: Array.from({ length: 8 }, (_, roomIndex) => ({
        physicalRoomTypeCode: `synthetic-room-${roomIndex}`,
        displayName: `合成房型${roomIndex}，带中文名称`, roomCount: 10, primaryAvailableRooms: 4,
      })),
      sources: Array.from({ length: 4 }, (_, sourceIndex) => ({ sourceId: `synthetic-source-${sourceIndex}`,
        completeness: 'COMPLETE', observedAt: original.observedAt, ingestedAt: original.observedAt })),
      futureDaily: Array.from({ length: 30 }, (_, dayIndex) => ({ stayDate: `2026-11-${String(dayIndex + 1).padStart(2, '0')}`,
        roomCount: 80, availableRooms: 30, soldRooms: 50, roomNights: 50, roomFee: 10000, adr: 200, revPar: 125 })),
      orders: Array.from({ length: 60 }, (_, orderIndex) => ({ key: `synthetic-pseudonym-${orderIndex}`,
        channel: 'MEITUAN', status: 'VALID', roomNights: 1, arrivalClass: 'TODAY', orderDate: '2026-10-21', arrivalDate: '2026-10-22' })),
      syntheticText: '历史状态中的换行\n会由 JSON.stringify 转义\r\n不会成为 HTTP 头字段',
    }))
    // Existing live-store policy keeps the latest 50. The switch must archive
    // every retained snapshot, without changing that unrelated retention rule.
    const expectedHistory = snapshotStore[hotelId].slice(-50)
    assert.equal(snapshotStore[hotelId].length, 100)
    assert.ok(Buffer.byteLength(JSON.stringify(expectedHistory), 'utf8') > 512 * 1024)
    assert.throws(() => encryptCookie(JSON.stringify(expectedHistory), secretKey, `${hotelId}:${sourceId}`), /COOKIE_VALUE_INVALID/)
    await jsonFile(root, 'live-report-snapshots.json', snapshotStore)
    app = await start(root)
    const result = await call(app, '/pms-system', change('MEITUAN_BIEYANGHONG'))
    assert.equal(result.status, 200, JSON.stringify(result.body))
    assert.equal(result.body.data.pmsSystemCode, 'MEITUAN_BIEYANGHONG')
    assert.deepEqual((await readJson(root, 'live-report-snapshots.json'))[hotelId], [])
    const archiveDirectory = join(root, 'pms-system-history', hotelId)
    const archiveNames = await readdir(archiveDirectory)
    assert.equal(archiveNames.length, 1)
    const serialized = await readFile(join(archiveDirectory, archiveNames[0]), 'utf8')
    assert.doesNotMatch(serialized, /synthetic-pseudonym|合成房型|former-session-value/)
    const archive = JSON.parse(serialized)
    const archived = JSON.parse(decryptCookie(archive.record, secretKey,
      `pms-system-archive:${hotelId}:${archive.transactionId}`))
    assert.equal(archived.snapshots.length, 50)
    assert.deepEqual(archived.snapshots, expectedHistory)
    await stop(app)
    app = await start(root)
    assert.equal((await call(app, '/pms-system')).body.data.pmsSystemCode, 'MEITUAN_BIEYANGHONG')
    assert.equal((await call(app, '/pms-login-config')).body.data.configured, false)
    assert.deepEqual((await readJson(root, 'live-report-snapshots.json'))[hotelId], [])
  } finally { await stop(app); await rm(root, { recursive: true, force: true }) }
})

test('PMS change preserves former data in an encrypted archive and isolates current authorization across restart', { timeout: 20_000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'pms-change-isolation-'))
  let app
  try {
    await seed(root)
    app = await start(root)
    const protectedFiles = ['ota-source-configs.json', 'ota-source-secrets.json', 'wecom-configs.json',
      'wecom-repair-bot-config.json', 'analytics-retention/retained-history.jsonl']
    const before = await Promise.all(protectedFiles.map(name => readFile(join(root, name), 'utf8')))
    const othersBefore = {
      hotel: (await readJson(root, 'simulation-hotels.json')).find(h => h.hotelId === otherHotelId),
      sources: (await readJson(root, 'report-sources.json'))[otherHotelId],
      secrets: (await readJson(root, 'report-source-cookie-secrets.json'))[otherHotelId],
      snapshots: (await readJson(root, 'live-report-snapshots.json'))[otherHotelId],
    }
    const current = await call(app, '/pms-system')
    assert.equal(current.status, 200)
    assert.equal(current.body.data.rowVersion, 4)
    // Stored label spelling differs from the canonical label; same vendor is still a no-op.
    assert.equal((await call(app, '/pms-system', change('LUOPAN_CLOUD'))).body.data.rowVersion, 4)
    assert.equal((await call(app, '/pms-login-config')).body.data.configured, true)
    assert.equal((await call(app, '/pms-system', change('YILIAN_CLOUD', 4, { confirmChange: false }))).status, 400)
    assert.equal((await call(app, '/pms-system', change('YILIAN_CLOUD', 3))).body.code, 'PMS_SYSTEM_VERSION_CONFLICT')
    const result = await call(app, '/pms-system', change('YILIAN_CLOUD'))
    assert.equal(result.status, 200, JSON.stringify(result.body))
    assert.equal(result.body.data.rowVersion, 5)
    assert.equal(result.body.data.collectionEnabled, false)
    assert.equal((await call(app, '/pms-login-config')).body.data.configured, false)
    const sources = (await call(app, '/report-sources')).body.data
    assert.equal(sources.length, 3)
    assert.ok(sources.every(s => new URL(s.endpointUrl).hostname === 'pms.ygjpms.com' && !s.cookieConfigured))
    assert.deepEqual((await readJson(root, 'live-report-snapshots.json'))[hotelId], [])
    assert.equal((await call(app, '/business-day-control')).body.data.mode, 'UNCONFIRMED')
    assert.deepEqual((await call(app, '/hot-selling-room-types')).body.data.roomTypeCodes, [])
    assert.equal((await call(app, '/pms-system', change('YILIAN_CLOUD', 5))).body.data.rowVersion, 5)
    const archiveDirectory = join(root, 'pms-system-history', hotelId)
    const archives = await readdir(archiveDirectory)
    assert.equal(archives.length, 1)
    const serialized = await readFile(join(archiveDirectory, archives[0]), 'utf8')
    assert.doesNotMatch(serialized, /former-session-value|synthetic-user|former-vendor|Former king/)
    const archive = JSON.parse(serialized)
    const former = JSON.parse(decryptCookie(archive.record, secretKey, `pms-system-archive:${hotelId}:${archive.transactionId}`))
    assert.equal(former.hotel.pmsSystemCode, 'LUOPAN_CLOUD')
    assert.equal(former.snapshots[0].collectionRunId, `former-${hotelId}`)
    assert.equal(former.luopanSession.cookies[0].value, 'former-session-value')
    assert.ok(former.pmsLoginSecret.ciphertext)
    await stop(app)
    app = await start(root)
    assert.equal((await call(app, '/pms-system')).body.data.pmsSystemCode, 'YILIAN_CLOUD')
    assert.equal((await call(app, '/pms-login-config')).body.data.configured, false)
    assert.equal((await call(app, '/pms-system', change('MEITUAN_BIEYANGHONG', 5))).status, 200)
    const bhySources = (await call(app, '/report-sources')).body.data
    assert.equal(bhySources.length, 4)
    assert.ok(bhySources.every(s => new URL(s.endpointUrl).hostname === 'pms.meituan.com' && !s.cookieConfigured && !s.requestPayloadJson))
    assert.equal(bhySources.find(s => s.endpointUrl.includes('/batchSearchBaseRoomForcasting')).enabled, false)
    assert.equal(bhySources.filter(s => s.enabled).length, 3)
    assert.equal((await call(app, '/pms-system')).body.data.collectionEnabled, false)
    assert.equal((await call(app, '/pms-system', change('OTHER', 6, { pmsSystemName: 'Synthetic PMS' }))).status, 200)
    assert.deepEqual((await call(app, '/report-sources')).body.data, [])
    assert.equal((await call(app, '/pms-system', change('LUOPAN_CLOUD', 7))).status, 200)
    assert.equal((await call(app, '/pms-login-config')).body.data.configured, false)
    const luopan = (await call(app, '/luopan-browser-config')).body.data
    assert.equal(luopan.enabled, false)
    assert.equal(luopan.encryptedSessionConfigured, false)
    assert.equal(luopan.scopeStatus, 'NOT_VALIDATED')
    assert.equal(luopan.profileRef, '')
    const othersAfter = {
      hotel: (await readJson(root, 'simulation-hotels.json')).find(h => h.hotelId === otherHotelId),
      sources: (await readJson(root, 'report-sources.json'))[otherHotelId],
      secrets: (await readJson(root, 'report-source-cookie-secrets.json'))[otherHotelId],
      snapshots: (await readJson(root, 'live-report-snapshots.json'))[otherHotelId],
    }
    assert.deepEqual(othersAfter, othersBefore)
    assert.deepEqual(await Promise.all(protectedFiles.map(name => readFile(join(root, name), 'utf8'))), before)
  } finally { await stop(app); await rm(root, { recursive: true, force: true }) }
})

test('PMS change is administrator-only and rejects target configuration requests still in progress', { timeout: 15_000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'pms-change-busy-'))
  let app
  let pending
  try {
    await seed(root)
    app = await start(root)
    const created = await fetch(`${app.origin}/api/v1/auth/accounts`, { method: 'POST',
      headers: { Authorization: `Bearer ${app.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'pms-operator', displayName: 'Synthetic operator',
        password: 'example-Operator-Password-42', roles: ['OTA_OPERATION_MANAGER'], hotelIds: [hotelId] }) })
    assert.equal(created.status, 201)
    const login = await fetch(`${app.origin}/api/v1/auth/login`, { method: 'POST',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'pms-operator', password: 'example-Operator-Password-42' }) })
    const operatorToken = (await login.json()).accessToken
    assert.equal((await call(app, '/pms-system', undefined, operatorToken)).status, 403)
    assert.equal((await call(app, '/pms-system', change('YILIAN_CLOUD'), operatorToken)).status, 403)
    pending = httpRequest(`${app.scoped}/pms-login-config`, { method: 'POST',
      headers: { Authorization: `Bearer ${app.token}`, 'Content-Type': 'application/json', 'Idempotency-Key': randomUUID() } })
    pending.on('error', () => {})
    const finished = new Promise(resolve => pending.on('response', response => { response.resume(); response.on('end', resolve) }))
    pending.write('{"reasonCode":')
    // Headers and the first body chunk reach the actual server while its body read remains pending.
    await new Promise(resolve => setTimeout(resolve, 80))
    const busy = await call(app, '/pms-system', change('YILIAN_CLOUD'))
    assert.equal(busy.status, 409)
    assert.equal(busy.body.code, 'PMS_SYSTEM_CHANGE_BUSY')
    assert.equal((await call(app, '/pms-system')).body.data.rowVersion, 4)
    pending.end('"UPDATE_PMS_LOGIN_CREDENTIALS","credentialUpdate":{"action":"KEEP"}}')
    await finished
    assert.equal((await call(app, '/pms-system', change('YILIAN_CLOUD'))).status, 200)
  } finally { pending?.destroy(); await stop(app); await rm(root, { recursive: true, force: true }) }
})

test('partial PMS document writes remain blocked and recover from the journal before serving after restart', { timeout: 20_000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'pms-change-recovery-'))
  let app
  try {
    await seed(root)
    app = await start(root)
    const secretFile = join(root, 'pms-login-secrets.json')
    await rename(secretFile, `${secretFile}.saved`)
    await mkdir(secretFile)
    const failed = await call(app, '/pms-system', change('YILIAN_CLOUD'))
    assert.equal(failed.status, 500)
    assert.equal(failed.body.code, 'PMS_SYSTEM_CHANGE_PERSIST_FAILED')
    const failureEvent = app.errors.split('\n').filter(Boolean).map(line => {
      try { return JSON.parse(line) } catch { return null }
    }).find(event => event?.event === 'PMS_SYSTEM_CHANGE_PERSIST_FAILED')
    assert.equal(failureEvent.phase, 'APPLY_ACTIVE_STATE')
    assert.ok(failureEvent.archivePlaintextBytes > 0)
    assert.ok(['EACCES', 'EPERM', 'EISDIR'].includes(failureEvent.reasonCode))
    assert.doesNotMatch(app.errors, /synthetic-user|Synthetic-Password|former-session-value/)
    assert.equal((await call(app, '/pms-login-config')).status, 503)
    assert.equal((await call(app, '/report-sources')).status, 503)
    const journal = await readJson(root, 'pms-system-change-transaction.json')
    assert.equal(journal.nextHotel.pmsSystemCode, 'YILIAN_CLOUD')
    await stop(app)
    app = await start(root, { expectFailure: true })
    assert.match(app.errors, /PMS_SYSTEM_CHANGE_RECOVERY_REQUIRED/)
    await rm(secretFile, { recursive: true })
    await rename(`${secretFile}.saved`, secretFile)
    app = await start(root)
    const recovered = (await call(app, '/pms-system')).body.data
    assert.equal(recovered.pmsSystemCode, 'YILIAN_CLOUD')
    assert.equal(recovered.rowVersion, 5)
    assert.equal(recovered.collectionEnabled, false)
    assert.equal((await call(app, '/pms-login-config')).body.data.configured, false)
    assert.equal((await readJson(root, 'report-source-cookie-secrets.json'))[hotelId], undefined)
    assert.equal((await readJson(root, 'pms-login-secrets.json'))[hotelId], undefined)
    assert.equal((await readJson(root, 'luopan-session-secrets.json'))[hotelId], undefined)
    assert.deepEqual((await readJson(root, 'live-report-snapshots.json'))[hotelId], [])
    assert.equal((await call(app, '/report-sources')).body.data.length, 3)
    assert.ok((await readJson(root, 'pms-login-secrets.json'))[otherHotelId])
    assert.equal((await readdir(root)).includes('pms-system-change-transaction.json'), false)
  } finally { await stop(app); await rm(root, { recursive: true, force: true }) }
})

test('Luopan and Bieyanghong resume automatic collection only after a complete current-PMS read', { timeout: 20_000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'pms-change-activation-'))
  let app
  try {
    await seed(root)
    await jsonFile(root, 'collector-test-state.json', { completeness: 'PARTIAL' })
    app = await start(root, { collectorFixture: true })
    for (const code of ['MEITUAN_BIEYANGHONG', 'LUOPAN_CLOUD']) {
      const current = (await call(app, '/pms-system')).body.data
      assert.equal((await call(app, '/pms-system', change(code, current.rowVersion))).status, 200)
      assert.equal((await call(app, '/pms-system')).body.data.collectionEnabled, false)
      if (code === 'MEITUAN_BIEYANGHONG') {
        const sources = (await call(app, '/report-sources')).body.data
        assert.equal((await call(app, '/report-sources', { reasonCode: 'UPDATE_COLLECTION_CONFIGURATION',
          sources: sources.map(source => ({ ...source, cookieUpdate: { action: 'REPLACE', value: 'synthetic_cookie=new-vendor' } })) })).status, 200)
      } else {
        assert.equal((await call(app, '/pms-login-config', { reasonCode: 'UPDATE_PMS_LOGIN_CREDENTIALS',
          credentialUpdate: { action: 'REPLACE', username: 'new-synthetic-user', password: 'example-New-Synthetic-Password-42' } })).status, 200)
        assert.equal((await call(app, '/luopan-browser-config', { reasonCode: 'UPDATE_LUOPAN_BROWSER_CONFIG',
          profileRef: 'new-synthetic-009', enabled: false, rowVersion: 0 })).status, 200)
        const validation = await call(app, '/luopan-browser-session-validations', { reasonCode: 'VALIDATE_LUOPAN_BROWSER_SESSION' })
        assert.equal(validation.status, 200)
        assert.equal((await call(app, '/luopan-browser-config', { reasonCode: 'UPDATE_LUOPAN_BROWSER_CONFIG',
          profileRef: 'new-synthetic-009', enabled: true, rowVersion: validation.body.data.rowVersion })).status, 200)
      }
      // Saving credentials (and even validating a browser session) is not a complete data read.
      assert.equal((await call(app, '/pms-system')).body.data.collectionEnabled, false)
      await jsonFile(root, 'collector-test-state.json', { completeness: 'FAILED' })
      assert.equal((await call(app, '/live-collection-runs', {})).status, 400)
      assert.equal((await call(app, '/pms-system')).body.data.collectionEnabled, false)
      await jsonFile(root, 'collector-test-state.json', { completeness: 'PARTIAL' })
      const partial = await call(app, '/live-collection-runs', {})
      assert.equal(partial.status, 200, JSON.stringify(partial.body))
      assert.equal((await call(app, '/pms-system')).body.data.collectionEnabled, false)
      const first = (await readJson(root, 'live-report-snapshots.json'))[hotelId][0]
      assert.equal(first.sourceSystem, code)
      assert.equal(first.testBaselineSnapshotCount, 0, 'the old manufacturer must not participate in the new baseline')
      await jsonFile(root, 'collector-test-state.json', { completeness: 'COMPLETE' })
      assert.equal((await call(app, '/live-collection-runs', {})).status, 200)
      assert.equal((await call(app, '/pms-system')).body.data.collectionEnabled, true)
    }
    await stop(app)
    app = await start(root)
    assert.equal((await call(app, '/pms-system')).body.data.collectionEnabled, true)
  } finally { await stop(app); await rm(root, { recursive: true, force: true }) }
})

test('old-PMS snapshots cannot reach the WeCom network boundary after manufacturer cutover', { timeout: 20_000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'pms-change-obsolete-send-'))
  let app
  try {
    await seed(root)
    await jsonFile(root, 'collector-test-state.json', { completeness: 'COMPLETE' })
    const webhook = 'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=example-not-a-real-webhook-000009'
    await jsonFile(root, 'wecom-configs.json', { [hotelId]: { enabled: true, broadcastIntervalHours: 1,
      endpointSha256: fingerprintWeComWebhook(webhook) } })
    await jsonFile(root, 'wecom-webhook-secrets.json', { [hotelId]: encryptCookie(webhook, secretKey, `wecom-webhook:${hotelId}`) })
    await jsonFile(root, 'wecom-deliveries.json', [])
    await writeFile(join(root, 'wecom-network-test-spy.jsonl'), '', 'utf8')
    const sendCount = async () => (await readFile(join(root, 'wecom-network-test-spy.jsonl'), 'utf8')).split('\n').filter(Boolean).length
    const replay = snapshot => ({ reasonCode: 'MANUAL_REPLAY_LATEST_COMPLETE',
      expectedCollectionRunId: snapshot.collectionRunId, operationKey: randomUUID() })
    app = await start(root, { collectorFixture: true })
    assert.equal((await call(app, '/live-collection-runs', {})).status, 200)
    const oldSnapshot = (await readJson(root, 'live-report-snapshots.json'))[hotelId].at(-1)
    assert.equal(oldSnapshot.sourceSystem, 'LUOPAN_CLOUD')
    // Positive control: the real API, template validator, and delivery ledger
    // can reach the mocked final network boundary before cutover.
    const before = await call(app, '/wecom-manual-replay-deliveries', replay(oldSnapshot))
    assert.equal(before.status, 200)
    assert.equal(before.body.data.overallStatus, 'COMPLETE', JSON.stringify(before.body))
    const sentBeforeCutover = await sendCount()
    assert.ok(sentBeforeCutover > 0)
    const current = (await call(app, '/pms-system')).body.data
    assert.equal((await call(app, '/pms-system', change('MEITUAN_BIEYANGHONG', current.rowVersion))).status, 200)
    const retired = await call(app, '/wecom-manual-replay-deliveries', replay(oldSnapshot))
    assert.equal(retired.status, 409)
    assert.equal(retired.body.code, 'WECOM_MANUAL_REPLAY_SNAPSHOT_REQUIRED')
    assert.equal(await sendCount(), sentBeforeCutover)
    const sources = (await call(app, '/report-sources')).body.data
    assert.equal((await call(app, '/report-sources', { reasonCode: 'UPDATE_COLLECTION_CONFIGURATION',
      sources: sources.map(source => ({ ...source, cookieUpdate: { action: 'REPLACE', value: 'synthetic_cookie=new-vendor' } })) })).status, 200)
    assert.equal((await call(app, '/live-collection-runs', {})).status, 200)
    const changed = await call(app, '/wecom-manual-replay-deliveries', replay(oldSnapshot))
    assert.equal(changed.status, 409)
    assert.equal(changed.body.code, 'WECOM_MANUAL_REPLAY_LATEST_SNAPSHOT_CHANGED')
    assert.equal(await sendCount(), sentBeforeCutover)
    await stop(app)
    // Simulate a delayed stale-store restore. Even if an old complete
    // snapshot re-enters active storage, the final send guard rejects it.
    const staleStore = await readJson(root, 'live-report-snapshots.json')
    staleStore[hotelId] = [oldSnapshot]
    await jsonFile(root, 'live-report-snapshots.json', staleStore)
    app = await start(root, { collectorFixture: true })
    const stale = await call(app, '/wecom-manual-replay-deliveries', replay(oldSnapshot))
    assert.equal(stale.status, 200)
    assert.equal(stale.body.data.overallStatus, 'PARTIAL')
    assert.deepEqual(stale.body.data.failedTemplates, [{ templateCode: 'TODAY_REVENUE', reasonCode: 'PMS_SYSTEM_SNAPSHOT_OBSOLETE' }])
    assert.equal(await sendCount(), sentBeforeCutover)
  } finally { await stop(app); await rm(root, { recursive: true, force: true }) }
})

const initialCookie = (id = '9009') => `hotelpms_login_hotel_id=${id}; hotelpms_login_org_id=900; hotelpms_tenant_id=90; hotelpms_token=example-test-only-pms-token; _lxsdk_cuid=example-client-id`
const initialCookieCommand = (version = 5, overrides = {}) => ({
  reasonCode: 'VALIDATE_AND_UPDATE_PMS_COOKIE', cookieHeader: initialCookie(),
  initialStoreBinding: { independentExpectedPmsHotelId: '9009', confirmStoreIdentity: true, expectedRowVersion: version },
  ...overrides,
})
const initialNameCookieCommand = (version = 5, name = 'SeeCity爱立斯', overrides = {}) => ({
  reasonCode: 'VALIDATE_AND_UPDATE_PMS_COOKIE', cookieHeader: initialCookie(),
  initialStoreBinding: { independentExpectedPmsHotelName: name, confirmStoreIdentity: true, expectedRowVersion: version },
  ...overrides,
})
const fixtureReadCount = async root => {
  try { return (await readFile(join(root, 'collector-test-spy.jsonl'), 'utf8')).split('\n').filter(Boolean).length }
  catch (error) { if (error.code === 'ENOENT') return 0; throw error }
}
async function waitForFixtureReads(root, minimum) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (await fixtureReadCount(root) >= minimum) return
    await new Promise(resolve => setTimeout(resolve, 15))
  }
  assert.fail('Synthetic provider read did not start')
}
async function prepareInitialCookieStore(root) {
  await seed(root)
  await jsonFile(root, 'collector-test-state.json', { completeness: 'COMPLETE' })
  await writeFile(join(root, 'wecom-network-test-spy.jsonl'), '', 'utf8')
  const app = await start(root, { collectorFixture: true })
  assert.equal((await call(app, '/pms-system', change('MEITUAN_BIEYANGHONG'))).status, 200)
  return app
}

test('initial Cookie authorization requires an independent confirmed ID and complete reads, then survives restart', { timeout: 20_000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'pms-initial-cookie-'))
  let app
  try {
    app = await prepareInitialCookieStore(root)
    const unbound = await call(app, '/pms-cookie-validation')
    assert.equal(unbound.status, 200)
    assert.deepEqual(unbound.body.data, { status: 'NOT_BOUND', firstTimeSetupRequired: true, canInitialize: true,
      hotelRowVersion: 5, hotelCode: '009', hotelName: 'Synthetic hotel 009', collectionEnabled: false,
      automaticHourlyCollectionEnabled: false, enabledSourceCount: 3, roomForecastConfigured: false })
    const secretsBefore = await readFile(join(root, 'report-source-cookie-secrets.json'), 'utf8')
    const otherSecrets = (await readJson(root, 'report-source-cookie-secrets.json'))[otherHotelId]
    const account = await fetch(`${app.origin}/api/v1/auth/accounts`, { method: 'POST',
      headers: { Authorization: `Bearer ${app.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'initial-cookie-operator', displayName: 'Synthetic operator',
        password: 'example-Initial-Operator-Password-42', roles: ['OTA_OPERATION_MANAGER'], hotelIds: [hotelId] }) })
    assert.equal(account.status, 201)
    const login = await fetch(`${app.origin}/api/v1/auth/login`, { method: 'POST',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'initial-cookie-operator', password: 'example-Initial-Operator-Password-42' }) })
    const operator = (await login.json()).accessToken
    assert.equal((await call(app, '/pms-cookie-validation', undefined, operator)).status, 403)
    assert.equal((await call(app, '/pms-cookie-validation', initialCookieCommand(), operator)).status, 403)
    assert.equal((await call(app, '/pms-cookie-validation', initialNameCookieCommand(), operator)).status, 403)
    for (const id of ['0', '09009', ' 9009', '9009 ', '', 9009]) {
      const rejected = await call(app, '/pms-cookie-validation', initialCookieCommand(5, {
        initialStoreBinding: { independentExpectedPmsHotelId: id, confirmStoreIdentity: true, expectedRowVersion: 5 },
      }))
      assert.equal(rejected.status, 400)
      assert.equal(rejected.body.code, 'BIEYANGHONG_INITIAL_BINDING_INVALID')
    }
    const missingConfirmation = await call(app, '/pms-cookie-validation', initialCookieCommand(5, {
      initialStoreBinding: { independentExpectedPmsHotelId: '9009', confirmStoreIdentity: false, expectedRowVersion: 5 },
    }))
    assert.equal(missingConfirmation.body.code, 'BIEYANGHONG_INITIAL_BINDING_INVALID')
    const stale = await call(app, '/pms-cookie-validation', initialCookieCommand(4))
    assert.equal(stale.status, 409)
    assert.equal(stale.body.code, 'BIEYANGHONG_INITIAL_BINDING_VERSION_CONFLICT')
    const wrongStore = await call(app, '/pms-cookie-validation', initialCookieCommand(5, { cookieHeader: initialCookie('9010') }))
    assert.equal(wrongStore.body.code, 'BIEYANGHONG_STORE_SCOPE_INVALID')
    const duplicateStore = await call(app, '/pms-cookie-validation', initialCookieCommand(5, {
      cookieHeader: `${initialCookie()}; hotelpms_login_hotel_id=9010`,
    }))
    assert.equal(duplicateStore.body.code, 'BIEYANGHONG_STORE_SCOPE_INVALID')
    const noIndependentBinding = await call(app, '/pms-cookie-validation', {
      reasonCode: 'VALIDATE_AND_UPDATE_PMS_COOKIE', cookieHeader: initialCookie(),
    })
    assert.equal(noIndependentBinding.body.code, 'BIEYANGHONG_EXPECTED_STORE_SCOPE_UNAVAILABLE')
    assert.equal(await fixtureReadCount(root), 0, 'invalid scope must fail before provider access')
    assert.equal(await readFile(join(root, 'report-source-cookie-secrets.json'), 'utf8'), secretsBefore)
    await jsonFile(root, 'collector-test-state.json', { completeness: 'PARTIAL' })
    const partial = await call(app, '/pms-cookie-validation', initialCookieCommand())
    assert.equal(partial.status, 400)
    assert.equal(partial.body.code, 'PMS_COOKIE_VALIDATION_INCOMPLETE')
    assert.equal(await readFile(join(root, 'report-source-cookie-secrets.json'), 'utf8'), secretsBefore)
    assert.equal((await call(app, '/pms-cookie-validation')).body.data.status, 'NOT_BOUND')
    assert.equal((await call(app, '/pms-system')).body.data.collectionEnabled, false)
    await jsonFile(root, 'collector-test-state.json', { completeness: 'COMPLETE' })
    const accepted = await call(app, '/pms-cookie-validation', initialCookieCommand())
    assert.equal(accepted.status, 200, JSON.stringify(accepted.body))
    assert.equal(accepted.body.data.initialStoreBindingAccepted, true)
    assert.equal(accepted.body.data.identityBasis, 'ADMIN_INDEPENDENT_ID_CONFIRMATION')
    assert.equal(accepted.body.data.vendorNameVerified, false)
    assert.equal(Object.hasOwn(accepted.body.data, 'declaredPmsHotelName'), false)
    assert.equal(accepted.body.data.successfulSourceCount, 3)
    assert.equal(accepted.body.data.outboundDeliveryAttempted, false)
    const bound = (await call(app, '/pms-cookie-validation')).body.data
    assert.equal(bound.status, 'BOUND')
    assert.equal(bound.canInitialize, false)
    assert.equal(bound.expectedPmsHotelId, '9009')
    assert.equal(bound.collectionEnabled, false)
    assert.equal(bound.roomForecastConfigured, false)
    const encryptedStore = await readFile(join(root, 'report-source-cookie-secrets.json'), 'utf8')
    assert.doesNotMatch(encryptedStore, /hotelpms_login_hotel_id|example-test-only-pms-token/)
    assert.deepEqual((await readJson(root, 'report-source-cookie-secrets.json'))[otherHotelId], otherSecrets)
    const cannotRebind = await call(app, '/pms-cookie-validation', initialCookieCommand(5, {
      initialStoreBinding: { independentExpectedPmsHotelId: '9010', confirmStoreIdentity: true, expectedRowVersion: 5 },
      cookieHeader: initialCookie('9010'),
    }))
    assert.equal(cannotRebind.status, 409)
    assert.equal(cannotRebind.body.code, 'BIEYANGHONG_INITIAL_BINDING_NOT_ALLOWED')
    const oldContract = { reasonCode: 'VALIDATE_AND_UPDATE_PMS_COOKIE', cookieHeader: initialCookie() }
    assert.equal((await call(app, '/pms-cookie-validation', oldContract)).status, 200)
    assert.equal((await call(app, '/pms-cookie-validation', { ...oldContract, cookieHeader: initialCookie('9010') })).body.code,
      'BIEYANGHONG_STORE_SCOPE_INVALID')
    assert.equal((await call(app, '/live-collection-runs', {})).status, 200)
    assert.equal((await call(app, '/pms-cookie-validation')).body.data.collectionEnabled, true)
    assert.equal(await readFile(join(root, 'wecom-network-test-spy.jsonl'), 'utf8'), '', 'setup and collection must not send messages')
    const audits = await readFile(join(root, 'security-audit.jsonl'), 'utf8')
    assert.match(audits, /BIEYANGHONG_INITIAL_STORE_SCOPE_CONFIRMED/)
    assert.doesNotMatch(audits + app.errors, /hotelpms_login_hotel_id|example-test-only-pms-token/)
    await stop(app)
    app = await start(root, { collectorFixture: true })
    const restarted = (await call(app, '/pms-cookie-validation')).body.data
    assert.equal(restarted.status, 'BOUND')
    assert.equal(restarted.expectedPmsHotelId, '9009')
    assert.equal(restarted.collectionEnabled, true)
  } finally { await stop(app); await rm(root, { recursive: true, force: true }) }
})

test('official-name confirmation requires an explicit administrator declaration, full reads and atomic Cookie persistence', { timeout: 20_000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'pms-initial-name-'))
  let app
  try {
    app = await prepareInitialCookieStore(root)
    const secretFile = join(root, 'report-source-cookie-secrets.json')
    const before = await readFile(secretFile, 'utf8')
    for (const name of ['', ' ', '  SeeCity爱立斯', 'SeeCity爱立斯 ', '9009', '酒'.repeat(81), 9009,
      '酒店\n名', '酒店\u007f名', '酒店\u0085名', '酒店\u200b名', '酒店\u200e名', '酒店\u202e名', '酒店\u2066名', '酒店\ufeff名']) {
      const rejected = await call(app, '/pms-cookie-validation', initialNameCookieCommand(5, name))
      assert.equal(rejected.status, 400)
      assert.equal(rejected.body.code, 'BIEYANGHONG_INITIAL_BINDING_INVALID')
    }
    for (const binding of [
      { independentExpectedPmsHotelName: 'SeeCity爱立斯', independentExpectedPmsHotelId: '9009', confirmStoreIdentity: true, expectedRowVersion: 5 },
      { independentExpectedPmsHotelName: 'SeeCity爱立斯', confirmStoreIdentity: true, expectedRowVersion: 5, vendorNameVerified: true },
      { independentExpectedPmsHotelName: 'SeeCity爱立斯', confirmStoreIdentity: false, expectedRowVersion: 5 },
      { independentExpectedPmsHotelName: 'SeeCity爱立斯', expectedRowVersion: 5 },
    ]) {
      assert.equal((await call(app, '/pms-cookie-validation', initialNameCookieCommand(5, 'SeeCity爱立斯', {
        initialStoreBinding: binding,
      }))).body.code, 'BIEYANGHONG_INITIAL_BINDING_INVALID')
    }
    assert.equal((await call(app, '/pms-cookie-validation', initialNameCookieCommand(4))).body.code,
      'BIEYANGHONG_INITIAL_BINDING_VERSION_CONFLICT')
    for (const cookieHeader of [initialCookie('0'), initialCookie('09009'), 'synthetic_session=without-hotel-id',
      `${initialCookie()}; hotelpms_login_hotel_id=9010`]) {
      assert.equal((await call(app, '/pms-cookie-validation', initialNameCookieCommand(5, 'SeeCity爱立斯', { cookieHeader }))).body.code,
        'BIEYANGHONG_STORE_SCOPE_INVALID')
    }
    assert.equal(await fixtureReadCount(root), 0)
    assert.equal(await readFile(secretFile, 'utf8'), before)
    await jsonFile(root, 'collector-test-state.json', { completeness: 'PARTIAL' })
    assert.equal((await call(app, '/pms-cookie-validation', initialNameCookieCommand())).body.code, 'PMS_COOKIE_VALIDATION_INCOMPLETE')
    assert.equal(await readFile(secretFile, 'utf8'), before)
    assert.equal((await call(app, '/pms-cookie-validation')).body.data.status, 'NOT_BOUND')
    await jsonFile(root, 'collector-test-state.json', { completeness: 'COMPLETE' })
    await rename(secretFile, `${secretFile}.saved`)
    await mkdir(secretFile)
    assert.equal((await call(app, '/pms-cookie-validation', initialNameCookieCommand())).body.code, 'PMS_COOKIE_PERSIST_FAILED')
    assert.equal((await call(app, '/pms-cookie-validation')).body.data.status, 'NOT_BOUND')
    await rm(secretFile, { recursive: true })
    await rename(`${secretFile}.saved`, secretFile)
    const accepted = await call(app, '/pms-cookie-validation', initialNameCookieCommand())
    assert.equal(accepted.status, 200, JSON.stringify(accepted.body))
    assert.equal(accepted.body.data.initialStoreBindingAccepted, true)
    assert.equal(accepted.body.data.identityBasis, 'ADMIN_OFFICIAL_NAME_CONFIRMATION')
    assert.equal(accepted.body.data.declaredPmsHotelName, 'SeeCity爱立斯')
    assert.equal(accepted.body.data.vendorNameVerified, false)
    assert.equal(accepted.body.data.successfulSourceCount, 3)
    assert.equal(accepted.body.data.outboundDeliveryAttempted, false)
    const bound = (await call(app, '/pms-cookie-validation')).body.data
    assert.equal(bound.status, 'BOUND')
    assert.equal(bound.expectedPmsHotelId, '9009')
    assert.equal(bound.hotelName, 'Synthetic hotel 009', 'declared vendor name need not equal the local alias')
    assert.equal(bound.collectionEnabled, false, 'saving credentials alone must not enable collection')
    assert.equal(Object.hasOwn(bound, 'declaredPmsHotelName'), false, 'no non-atomic second identity store is introduced')
    assert.doesNotMatch(await readFile(secretFile, 'utf8'), /hotelpms_login_hotel_id|example-test-only-pms-token/)
    const auditEvents = (await readFile(join(root, 'security-audit.jsonl'), 'utf8')).split('\n').filter(Boolean).map(JSON.parse)
    const confirmations = auditEvents.filter(event => event.action === 'BIEYANGHONG_INITIAL_STORE_SCOPE_CONFIRMED')
    assert.equal(confirmations.length, 1, 'failed or incomplete setup must not be audited as accepted')
    assert.deepEqual(confirmations[0].storeScopeConfirmation, {
      basis: 'ADMIN_OFFICIAL_NAME_CONFIRMATION', declaredPmsHotelName: 'SeeCity爱立斯',
      pmsHotelIdFingerprint: createHash('sha256').update('9009', 'utf8').digest('hex'),
    })
    assert.equal(confirmations[0].hotelId, hotelId)
    assert.ok(confirmations[0].actorAccountId)
    assert.doesNotMatch(JSON.stringify(auditEvents) + app.errors, /hotelpms_login_hotel_id|example-test-only-pms-token/)
    assert.equal((await call(app, '/pms-cookie-validation', initialNameCookieCommand(5, 'Other hotel', {
      cookieHeader: initialCookie('9010'),
    }))).body.code, 'BIEYANGHONG_INITIAL_BINDING_NOT_ALLOWED')
    await stop(app)
    app = await start(root, { collectorFixture: true })
    assert.equal((await call(app, '/pms-cookie-validation')).body.data.expectedPmsHotelId, '9009')
    assert.equal((await call(app, '/pms-cookie-validation', {
      reasonCode: 'VALIDATE_AND_UPDATE_PMS_COOKIE', cookieHeader: initialCookie(),
    })).status, 200, 'normal scoped repair remains compatible after restart')
    assert.equal(await readFile(join(root, 'wecom-network-test-spy.jsonl'), 'utf8'), '')
  } finally { await stop(app); await rm(root, { recursive: true, force: true }) }
})

test('initial setup rejects a PMS scope already claimed by another store without disabling legacy repairs', { timeout: 20_000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'pms-initial-name-duplicate-'))
  let app
  try {
    app = await prepareInitialCookieStore(root)
    await stop(app)
    const secretStore = await readJson(root, 'report-source-cookie-secrets.json')
    secretStore[otherHotelId] = { [sourceId]: encryptCookie(initialCookie(), secretKey, `${otherHotelId}:${sourceId}`) }
    await jsonFile(root, 'report-source-cookie-secrets.json', secretStore)
    const before = await readFile(join(root, 'report-source-cookie-secrets.json'), 'utf8')
    app = await start(root, { collectorFixture: true })
    for (const body of [initialCookieCommand(), initialNameCookieCommand()]) {
      const rejected = await call(app, '/pms-cookie-validation', body)
      assert.equal(rejected.status, 409)
      assert.equal(rejected.body.code, 'BIEYANGHONG_STORE_ALREADY_BOUND')
    }
    assert.equal(await fixtureReadCount(root), 0)
    assert.equal(await readFile(join(root, 'report-source-cookie-secrets.json'), 'utf8'), before)
    assert.equal((await call(app, '/pms-cookie-validation')).body.data.status, 'NOT_BOUND')
    await stop(app)
    const badSourceId = '34000000-0000-4000-8000-000000000099'
    secretStore[otherHotelId][badSourceId] = encryptCookie(initialCookie('9010'), secretKey, `${otherHotelId}:${badSourceId}`)
    secretStore[otherHotelId][badSourceId].authTag = Buffer.alloc(16).toString('base64url')
    await jsonFile(root, 'report-source-cookie-secrets.json', secretStore)
    const corruptOtherBefore = await readFile(join(root, 'report-source-cookie-secrets.json'), 'utf8')
    app = await start(root, { collectorFixture: true })
    const conflictedOtherApp = { ...app, scoped: app.scoped.replace(hotelId, otherHotelId) }
    assert.equal((await call(conflictedOtherApp, '/pms-cookie-validation')).body.data.status, 'CONFLICT')
    assert.equal((await call(app, '/pms-cookie-validation', initialNameCookieCommand())).body.code,
      'BIEYANGHONG_STORE_ALREADY_BOUND', 'a separately readable claim in a partly corrupt other-store document still occupies this ID')
    assert.equal(await fixtureReadCount(root), 0)
    assert.equal(await readFile(join(root, 'report-source-cookie-secrets.json'), 'utf8'), corruptOtherBefore)
    await stop(app)
    delete secretStore[otherHotelId][badSourceId]
    const sourceStore = await readJson(root, 'report-sources.json')
    secretStore[hotelId] = Object.fromEntries(sourceStore[hotelId].map(source => [source.sourceId,
      encryptCookie(initialCookie(), secretKey, `${hotelId}:${source.sourceId}`)]))
    await jsonFile(root, 'report-source-cookie-secrets.json', secretStore)
    app = await start(root, { collectorFixture: true })
    const legacyRepair = { reasonCode: 'VALIDATE_AND_UPDATE_PMS_COOKIE', cookieHeader: initialCookie() }
    const otherApp = { ...app, scoped: app.scoped.replace(hotelId, otherHotelId) }
    assert.equal((await call(app, '/pms-cookie-validation', legacyRepair)).status, 200)
    assert.equal((await call(otherApp, '/pms-cookie-validation', legacyRepair)).status, 200,
      'the new first-setup guard must not retroactively block historical duplicate-scope repair')
    assert.equal(await readFile(join(root, 'wecom-network-test-spy.jsonl'), 'utf8'), '')
  } finally { await stop(app); await rm(root, { recursive: true, force: true }) }
})

test('concurrent first-time setup of different stores cannot claim the same PMS scope', { timeout: 20_000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'pms-initial-name-concurrent-'))
  let app
  try {
    app = await prepareInitialCookieStore(root)
    const otherApp = { ...app, scoped: app.scoped.replace(hotelId, otherHotelId) }
    assert.equal((await call(otherApp, '/pms-system', change('LUOPAN_CLOUD'))).status, 200)
    assert.equal((await call(otherApp, '/pms-system', change('MEITUAN_BIEYANGHONG', 5))).status, 200)
    assert.equal((await call(otherApp, '/pms-cookie-validation')).body.data.status, 'NOT_BOUND')
    await jsonFile(root, 'collector-test-state.json', { completeness: 'COMPLETE', delayMs: 400 })
    const first = call(app, '/pms-cookie-validation', initialNameCookieCommand())
    await waitForFixtureReads(root, 1)
    const second = call(otherApp, '/pms-cookie-validation', initialNameCookieCommand(6, 'Another visible hotel name'))
    await waitForFixtureReads(root, 2)
    const results = await Promise.all([first, second])
    assert.deepEqual(results.map(result => result.status).sort(), [200, 409])
    assert.equal(results.find(result => result.status === 409).body.code, 'BIEYANGHONG_STORE_ALREADY_BOUND')
    const statuses = await Promise.all([app, otherApp].map(async item => (await call(item, '/pms-cookie-validation')).body.data.status))
    assert.deepEqual(statuses.sort(), ['BOUND', 'NOT_BOUND'])
    const stored = await readJson(root, 'report-source-cookie-secrets.json')
    assert.equal([hotelId, otherHotelId].filter(id => Object.keys(stored[id] ?? {}).length > 0).length, 1)
    assert.equal(await readFile(join(root, 'wecom-network-test-spy.jsonl'), 'utf8'), '')
  } finally { await stop(app); await rm(root, { recursive: true, force: true }) }
})

test('inactive trusted-device mode still protects approved current-generation identities but ignores retired registries', { timeout: 20_000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'pms-initial-name-device-anchor-'))
  let app
  try {
    app = await prepareInitialCookieStore(root)
    await stop(app)
    const approvedRegistry = (id, pmsHotelId = '9009') => {
      const deviceId = randomUUID()
      return { schemaVersion: 1, enrollment: null,
        // This decodes to the wrong proof-key length. The full intake-store
        // constructor rejects it, but identity-only reads must ignore it.
        devices: [{ deviceId, hotelId: id, sealedScopeProofKey: encryptCookie('example-invalid-proof-key', secretKey,
          `trusted-device-proof-key:${tenantId}:${id}:${deviceId}`) }],
        scopeAnchor: { epoch: randomUUID(), approvalStatus: 'APPROVED', approvedAt: '2026-10-23T00:00:00.000Z',
          sealedExpectedPmsLoginHotelId: encryptCookie(pmsHotelId, secretKey, `trusted-device-store-scope:${tenantId}:${id}`) },
      }
    }
    // 009 already has a fresh PMS generation. Its pre-switch registry must
    // not establish identity in that generation, even when the ID matches.
    await jsonFile(root, 'trusted-device-registry-009.json', approvedRegistry(hotelId))
    await jsonFile(root, 'trusted-device-registry-010.json', approvedRegistry(otherHotelId))
    const otherRegistryBefore = await readFile(join(root, 'trusted-device-registry-010.json'), 'utf8')
    app = await start(root, { collectorFixture: true })
    assert.equal((await call(app, '/pms-cookie-validation')).body.data.status, 'NOT_BOUND')
    const duplicate = await call(app, '/pms-cookie-validation', initialNameCookieCommand())
    assert.equal(duplicate.status, 409)
    assert.equal(duplicate.body.code, 'BIEYANGHONG_STORE_ALREADY_BOUND')
    assert.equal(await fixtureReadCount(root), 0)
    assert.equal(await readFile(join(root, 'trusted-device-registry-010.json'), 'utf8'), otherRegistryBefore)
    const otherApp = { ...app, scoped: app.scoped.replace(hotelId, otherHotelId) }
    assert.equal((await call(otherApp, '/pms-system', change('LUOPAN_CLOUD'))).status, 200)
    assert.equal((await call(otherApp, '/pms-system', change('MEITUAN_BIEYANGHONG', 5))).status, 200)
    await stop(app)
    const hotels = await readJson(root, 'simulation-hotels.json')
    const targetHotel = hotels.find(hotel => hotel.hotelId === hotelId)
    const otherHotel = hotels.find(hotel => hotel.hotelId === otherHotelId)
    const currentRegistryName = `trusted-device-registry-009-${createHash('sha256').update(targetHotel.pmsChangedAt).digest('hex').slice(0, 12)}.json`
    const otherCurrentRegistryName = `trusted-device-registry-010-${createHash('sha256').update(otherHotel.pmsChangedAt).digest('hex').slice(0, 12)}.json`
    await jsonFile(root, otherCurrentRegistryName, approvedRegistry(otherHotelId, '9010'))
    const otherCurrentBefore = await readFile(join(root, otherCurrentRegistryName), 'utf8')
    await jsonFile(root, 'collector-test-state.json', { completeness: 'PARTIAL' })
    app = await start(root, { collectorFixture: true })
    assert.equal((await call(app, '/pms-cookie-validation', initialNameCookieCommand())).body.code,
      'PMS_COOKIE_VALIDATION_INCOMPLETE', 'a different readable approved ID with bad device data must not block provider validation')
    assert.equal(await fixtureReadCount(root), 1)
    assert.equal((await call(app, '/pms-cookie-validation')).body.data.status, 'NOT_BOUND')
    assert.equal(await readFile(join(root, otherCurrentRegistryName), 'utf8'), otherCurrentBefore)
    await stop(app)
    await jsonFile(root, 'collector-test-state.json', { completeness: 'COMPLETE' })
    await jsonFile(root, currentRegistryName, approvedRegistry(hotelId))
    const targetRegistryBefore = await readFile(join(root, currentRegistryName), 'utf8')
    app = await start(root, { collectorFixture: true })
    const current = (await call(app, '/pms-cookie-validation')).body.data
    assert.equal(current.status, 'BOUND', 'current approved anchors must not be hidden by SERVER_COOKIE mode')
    assert.equal(current.expectedPmsHotelId, '9009')
    assert.equal(current.canInitialize, false)
    assert.equal((await call(app, '/pms-cookie-validation', initialNameCookieCommand())).body.code,
      'BIEYANGHONG_INITIAL_BINDING_NOT_ALLOWED')
    assert.equal(await readFile(join(root, currentRegistryName), 'utf8'), targetRegistryBefore)
    assert.equal(await fixtureReadCount(root), 1)
    await stop(app)
    await rm(join(root, currentRegistryName))
    const otherCorruptAnchor = JSON.parse(otherCurrentBefore)
    otherCorruptAnchor.scopeAnchor.sealedExpectedPmsLoginHotelId.authTag = Buffer.alloc(16).toString('base64url')
    await jsonFile(root, otherCurrentRegistryName, otherCorruptAnchor)
    app = await start(root, { collectorFixture: true })
    const otherConflictApp = { ...app, scoped: app.scoped.replace(hotelId, otherHotelId) }
    assert.equal((await call(otherConflictApp, '/pms-cookie-validation')).body.data.status, 'CONFLICT')
    assert.equal((await call(app, '/pms-cookie-validation')).body.data.status, 'NOT_BOUND')
    assert.equal((await call(otherConflictApp, '/pms-cookie-validation', initialNameCookieCommand(6))).body.code,
      'BIEYANGHONG_INITIAL_BINDING_NOT_ALLOWED', 'a target store with unreadable identity cannot reinitialize')
    assert.equal((await call(app, '/pms-cookie-validation', initialNameCookieCommand())).status, 200,
      'an unreadable identity in another store must not block unrelated initial setup')
    assert.deepEqual(await readJson(root, otherCurrentRegistryName), otherCorruptAnchor)
    await stop(app)
    // Separately prove a readable different approved identity with the same
    // unrelated device damage neither blocks nor mutates the normal repair.
    await writeFile(join(root, otherCurrentRegistryName), otherCurrentBefore, 'utf8')
    app = await start(root, { collectorFixture: true })
    assert.equal((await call(app, '/pms-cookie-validation', { reasonCode: 'VALIDATE_AND_UPDATE_PMS_COOKIE',
      cookieHeader: initialCookie() })).status, 200)
    assert.deepEqual((await readdir(root)).filter(name => name.startsWith('trusted-device-registry-')).sort(),
      ['trusted-device-registry-009.json', otherCurrentRegistryName, 'trusted-device-registry-010.json'].sort())
    assert.equal(await readFile(join(root, 'trusted-device-registry-010.json'), 'utf8'), otherRegistryBefore)
    assert.equal(await readFile(join(root, otherCurrentRegistryName), 'utf8'), otherCurrentBefore)
    assert.equal(await readFile(join(root, 'wecom-network-test-spy.jsonl'), 'utf8'), '')
  } finally { await stop(app); await rm(root, { recursive: true, force: true }) }
})

test('initial Cookie authorization rolls back memory on persistence failure and refuses in-flight setup races', { timeout: 20_000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'pms-initial-cookie-atomic-'))
  let app
  try {
    app = await prepareInitialCookieStore(root)
    const secretFile = join(root, 'report-source-cookie-secrets.json')
    await rename(secretFile, `${secretFile}.saved`)
    await mkdir(secretFile)
    const failed = await call(app, '/pms-cookie-validation', initialCookieCommand())
    assert.equal(failed.status, 500)
    assert.equal(failed.body.code, 'PMS_COOKIE_PERSIST_FAILED')
    assert.equal((await call(app, '/pms-cookie-validation')).body.data.status, 'NOT_BOUND')
    assert.equal((await call(app, '/pms-login-config')).body.data.configured, false)
    await rm(secretFile, { recursive: true })
    await rename(`${secretFile}.saved`, secretFile)
    await jsonFile(root, 'collector-test-state.json', { completeness: 'COMPLETE', delayMs: 400 })
    const first = call(app, '/pms-cookie-validation', initialCookieCommand())
    await waitForFixtureReads(root, 2)
    assert.equal((await call(app, '/pms-cookie-validation')).body.data.canInitialize, false)
    const concurrent = await call(app, '/pms-cookie-validation', initialCookieCommand())
    assert.equal(concurrent.body.code, 'PMS_COOKIE_VALIDATION_IN_PROGRESS')
    assert.equal((await call(app, '/pms-system', change('LUOPAN_CLOUD', 5))).body.code, 'PMS_SYSTEM_CHANGE_BUSY')
    assert.equal((await first).status, 200)
    assert.equal((await call(app, '/pms-cookie-validation')).body.data.status, 'BOUND')
  } finally { await stop(app); await rm(root, { recursive: true, force: true }) }
})

test('mixed, unparseable, and corrupt old Cookie records cannot be overridden by initial authorization', { timeout: 20_000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'pms-initial-cookie-conflict-'))
  let app
  try {
    app = await prepareInitialCookieStore(root)
    await stop(app)
    const secretStore = await readJson(root, 'report-source-cookie-secrets.json')
    const sources = (await readJson(root, 'report-sources.json'))[hotelId]
    const otherBefore = secretStore[otherHotelId]
    for (const variant of ['MIXED', 'UNPARSEABLE', 'CORRUPT']) {
      secretStore[hotelId] = Object.fromEntries(sources.slice(0, 2).map((source, index) => [source.sourceId,
        encryptCookie(variant === 'UNPARSEABLE' && index === 1 ? 'synthetic_session=without-hotel-id'
          : initialCookie(variant === 'MIXED' && index === 1 ? '9010' : '9009'), secretKey, `${hotelId}:${source.sourceId}`),
      ]))
      if (variant === 'CORRUPT') secretStore[hotelId][sources[1].sourceId].authTag = Buffer.alloc(16).toString('base64url')
      await jsonFile(root, 'report-source-cookie-secrets.json', secretStore)
      app = await start(root, { collectorFixture: true })
      const conflict = (await call(app, '/pms-cookie-validation')).body.data
      assert.equal(conflict.status, 'CONFLICT', variant)
      assert.equal(conflict.canInitialize, false)
      assert.equal(Object.hasOwn(conflict, 'expectedPmsHotelId'), false)
      const blocked = await call(app, '/pms-cookie-validation', initialCookieCommand())
      assert.equal(blocked.status, 409)
      assert.equal(blocked.body.code, 'BIEYANGHONG_INITIAL_BINDING_NOT_ALLOWED')
      assert.equal(await fixtureReadCount(root), 0)
      assert.deepEqual((await readJson(root, 'report-source-cookie-secrets.json'))[otherHotelId], otherBefore)
      await stop(app)
    }
    // An explicit manufacturer change retires only this hotel's old corrupt
    // generation; it must not leave a permanent conflict marker behind.
    app = await start(root, { collectorFixture: true })
    assert.equal((await call(app, '/pms-system', change('LUOPAN_CLOUD', 5))).status, 200)
    const historyDirectory = join(root, 'pms-system-history', hotelId)
    const archivedStates = await Promise.all((await readdir(historyDirectory)).map(async name => {
      const envelope = JSON.parse(await readFile(join(historyDirectory, name), 'utf8'))
      return JSON.parse(decryptCookie(envelope.record, secretKey, `pms-system-archive:${hotelId}:${envelope.transactionId}`))
    }))
    assert.deepEqual(archivedStates.find(state => state.unreadableCookieSecretDocument)?.unreadableCookieSecretDocument,
      secretStore[hotelId], 'retiring a corrupt generation must archive its original encrypted document')
    assert.equal((await call(app, '/pms-system', change('MEITUAN_BIEYANGHONG', 6))).status, 200)
    assert.equal((await call(app, '/pms-cookie-validation')).body.data.status, 'NOT_BOUND')
  } finally { await stop(app); await rm(root, { recursive: true, force: true }) }
})

test('three-source initial authorization enables collection but cannot send an empty future forecast', { timeout: 20_000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'pms-initial-cookie-future-'))
  let app
  try {
    await seed(root)
    await jsonFile(root, 'collector-test-state.json', { completeness: 'COMPLETE', todayOnlyFutureChange: true })
    const webhook = 'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=example-not-a-real-webhook-000009'
    await jsonFile(root, 'wecom-configs.json', { [hotelId]: { enabled: true, broadcastIntervalHours: 1,
      endpointSha256: fingerprintWeComWebhook(webhook) } })
    await jsonFile(root, 'wecom-webhook-secrets.json', { [hotelId]: encryptCookie(webhook, secretKey, `wecom-webhook:${hotelId}`) })
    await jsonFile(root, 'wecom-deliveries.json', [])
    await writeFile(join(root, 'wecom-network-test-spy.jsonl'), '', 'utf8')
    app = await start(root, { collectorFixture: true })
    assert.equal((await call(app, '/pms-system', change('MEITUAN_BIEYANGHONG'))).status, 200)
    assert.equal((await call(app, '/pms-cookie-validation', initialNameCookieCommand())).status, 200)
    assert.equal((await call(app, '/live-collection-runs', {})).status, 200)
    const status = (await call(app, '/pms-cookie-validation')).body.data
    assert.equal(status.status, 'BOUND')
    assert.equal(status.collectionEnabled, true)
    assert.equal(status.roomForecastConfigured, false)
    assert.equal(status.enabledSourceCount, 3)
    assert.equal(await readFile(join(root, 'wecom-network-test-spy.jsonl'), 'utf8'), '')
    const snapshot = (await readJson(root, 'live-report-snapshots.json'))[hotelId].at(-1)
    assert.deepEqual(snapshot.futureDaily, [])
    assert.equal(snapshot.futureBookingChanges.daily.length, 1)
    const replay = await call(app, '/wecom-manual-replay-deliveries', { reasonCode: 'MANUAL_REPLAY_LATEST_COMPLETE',
      expectedCollectionRunId: snapshot.collectionRunId, operationKey: randomUUID() })
    assert.equal(replay.status, 200)
    assert.equal(replay.body.data.overallStatus, 'PARTIAL')
    assert.deepEqual(replay.body.data.failedTemplates, [{ templateCode: 'FUTURE_14D', reasonCode: 'PMS_FUTURE_DATA_NOT_READY' }])
    const sends = (await readFile(join(root, 'wecom-network-test-spy.jsonl'), 'utf8')).split('\n').filter(Boolean).map(JSON.parse)
    assert.ok(sends.length > 0, 'the current-day template is a positive control at the mocked network boundary')
    assert.ok(sends.every(send => send.futureTemplate === false))
  } finally { await stop(app); await rm(root, { recursive: true, force: true }) }
})

test('saving an initial authorization preserves another hotel corrupt encrypted document and conflict across restart', { timeout: 20_000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'pms-initial-cookie-other-corrupt-'))
  let app
  try {
    app = await prepareInitialCookieStore(root)
    await stop(app)
    const store = await readJson(root, 'report-source-cookie-secrets.json')
    store[otherHotelId][sourceId].authTag = Buffer.alloc(16).toString('base64url')
    const corruptOther = store[otherHotelId]
    await jsonFile(root, 'report-source-cookie-secrets.json', store)
    app = await start(root, { collectorFixture: true })
    const otherApp = { ...app, scoped: app.scoped.replace(hotelId, otherHotelId) }
    assert.equal((await call(otherApp, '/pms-cookie-validation')).body.data.status, 'CONFLICT')
    assert.equal((await call(app, '/pms-cookie-validation', initialCookieCommand())).status, 200)
    assert.deepEqual((await readJson(root, 'report-source-cookie-secrets.json'))[otherHotelId], corruptOther)
    await stop(app)
    app = await start(root, { collectorFixture: true })
    assert.equal((await call(app, '/pms-cookie-validation')).body.data.status, 'BOUND')
    const otherAfterRestart = { ...app, scoped: app.scoped.replace(hotelId, otherHotelId) }
    const conflict = (await call(otherAfterRestart, '/pms-cookie-validation')).body.data
    assert.equal(conflict.status, 'CONFLICT')
    assert.equal(conflict.canInitialize, false)
    assert.equal((await call(otherAfterRestart, '/pms-cookie-validation', initialCookieCommand(4))).body.code,
      'BIEYANGHONG_INITIAL_BINDING_NOT_ALLOWED')
    assert.deepEqual((await readJson(root, 'report-source-cookie-secrets.json'))[otherHotelId], corruptOther)
  } finally { await stop(app); await rm(root, { recursive: true, force: true }) }
})

test('an unreadable whole Cookie store remains unchanged when legacy configuration attempts to save', { timeout: 20_000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'pms-initial-cookie-store-corrupt-'))
  let app
  try {
    app = await prepareInitialCookieStore(root)
    await stop(app)
    const corruptDocument = '{"synthetic-unreadable-original":'
    await writeFile(join(root, 'report-source-cookie-secrets.json'), corruptDocument, 'utf8')
    app = await start(root, { collectorFixture: true })
    assert.equal((await call(app, '/pms-cookie-validation')).body.data.status, 'CONFLICT')
    assert.equal((await call(app, '/pms-cookie-validation', initialCookieCommand())).body.code,
      'BIEYANGHONG_INITIAL_BINDING_NOT_ALLOWED')
    const sources = (await call(app, '/report-sources')).body.data
    const attemptedSave = await call(app, '/report-sources', { reasonCode: 'UPDATE_COLLECTION_CONFIGURATION',
      sources: sources.map(source => ({ ...source, cookieUpdate: { action: 'REPLACE', value: initialCookie() } })) })
    assert.ok(attemptedSave.status >= 400)
    assert.equal(await readFile(join(root, 'report-source-cookie-secrets.json'), 'utf8'), corruptDocument)
    assert.equal((await call(app, '/pms-cookie-validation')).body.data.status, 'CONFLICT')
    assert.equal(await fixtureReadCount(root), 0)
  } finally { await stop(app); await rm(root, { recursive: true, force: true }) }
})
