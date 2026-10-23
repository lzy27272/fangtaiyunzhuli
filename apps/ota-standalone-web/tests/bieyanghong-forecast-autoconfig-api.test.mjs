import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { encryptCookie } from '../../../tools/uat/report-source-cookie-crypto.mjs'
import { fingerprintWeComWebhook } from '../../../tools/uat/wecom/src/wecom-group-robot.mjs'
import { forecastFixtureSources, forecastFixtureCookie } from './fixtures/bieyanghong-forecast-provider.mjs'

const repo = fileURLToPath(new URL('../../../', import.meta.url))
const tenantId = '10000000-0000-4000-8000-000000000001'
const hotelId = '20000000-0000-4000-8000-000000000009'
const otherId = '20000000-0000-4000-8000-000000000010'
const key = Buffer.alloc(32, 23).toString('base64url')
const json = (root, file, value) => writeFile(join(root, file), JSON.stringify(value), 'utf8')
const read = async (root, file) => JSON.parse(await readFile(join(root, file), 'utf8'))
const requests = async root => { try { return (await readFile(join(root, 'provider-spy.jsonl'), 'utf8')).split('\n').filter(Boolean).map(JSON.parse) } catch (error) { if (error.code === 'ENOENT') return []; throw error } }
async function seed(root) {
  await json(root, 'simulation-hotels.json', [hotelId, otherId].map((id, index) => ({ tenantId, hotelId: id,
    tenantCode: '001', tenantName: 'Synthetic tenant', hotelCode: index ? '010' : '009', hotelName: `Synthetic ${index}`,
    pmsSystemCode: 'MEITUAN_BIEYANGHONG', pmsSystemName: '美团别样红 PMS', timezone: 'Asia/Shanghai',
    ownershipType: 'DIRECT', lifecycleStatus: 'PILOT', collectionEnabled: true, messageEnabled: false,
    rowVersion: 3, configuredMockConnectors: 2, simulationOnly: true,
    ...(index ? {} : { pmsChangedAt: '2026-10-22T00:00:00.000Z' }) })))
  await json(root, 'report-sources.json', Object.fromEntries([hotelId, otherId].map(id => [id, forecastFixtureSources()])))
  await json(root, 'report-source-cookie-secrets.json', Object.fromEntries([hotelId, otherId].map((id, index) => [id,
    Object.fromEntries(forecastFixtureSources().map(source => [source.sourceId,
      encryptCookie(forecastFixtureCookie(index ? '9010' : '9009'), key, `${id}:${source.sourceId}`)]))])))
  await json(root, 'fixture-state.json', {})
}
async function start(root) {
  const socket = createServer()
  await new Promise(resolve => socket.listen(0, '127.0.0.1', resolve))
  const { port } = socket.address()
  await new Promise(resolve => socket.close(resolve))
  const child = spawn(process.execPath, ['--import', new URL('./fixtures/bieyanghong-forecast-provider.mjs', import.meta.url).href,
    join(repo, 'tools/uat/ota-standalone-review-api.mjs')], { cwd: repo, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, OTA_REVIEW_API_PORT: String(port), OTA_REVIEW_DATA_PATH: join(root, 'report-sources.json'),
      OTA_REVIEW_COOKIE_SECRETS_PATH: join(root, 'report-source-cookie-secrets.json'), OTA_REVIEW_SECRET_KEY: key,
      OTA_REVIEW_PSEUDONYM_SECRET_KEY: Buffer.alloc(32, 24).toString('base64url'),
      OTA_REVIEW_USERNAME: 'forecast-test', OTA_REVIEW_PASSWORD: 'example-Forecast-Test-Password-42',
      OTA_REVIEW_ACCESS_TOKEN: 'example-forecast-bootstrap', OTA_REVIEW_AUTH_STATE_PATH: join(root, 'auth.json'),
      OTA_REVIEW_AUTH_REFRESH_STATE_PATH: join(root, 'auth-sessions.json'), OTA_REVIEW_SECURITY_AUDIT_PATH: join(root, 'audit.jsonl'),
      OTA_ANALYTICS_RETENTION_ENABLED: 'false', OTA_REVIEW_AUTO_COLLECTION_ENABLED: 'false',
      OTA_REVIEW_TRUSTED_DEVICE_ENABLED: 'false', OTA_REVIEW_YILIAN_ASSISTED_REAUTH_ENABLED: 'false',
      OTA_REVIEW_LUOPAN_ASSISTED_REAUTH_ENABLED: 'false', OTA_REVIEW_BIEYANGHONG_ASSISTED_REAUTH_ENABLED: 'false',
      FORECAST_SETUP_TEST_STATE_PATH: join(root, 'fixture-state.json'), FORECAST_SETUP_TEST_SPY_PATH: join(root, 'provider-spy.jsonl') } })
  let errors = ''
  child.stderr.on('data', chunk => { errors += chunk })
  child.stdout.resume()
  const origin = `http://127.0.0.1:${port}`
  for (let index = 0; index < 100; index += 1) {
    if (child.exitCode !== null) throw new Error(`EXAMPLE_API_START_FAILED:${errors}`)
    try {
      if ((await fetch(`${origin}/health`)).ok) {
        const response = await fetch(`${origin}/api/v1/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username: 'forecast-test', password: 'example-Forecast-Test-Password-42' }) })
        assert.equal(response.status, 200)
        return { child, origin, token: (await response.json()).accessToken,
          scoped: `${origin}/api/v1/ota/tenants/${tenantId}/hotels/${hotelId}` }
      }
    } catch (error) { if (error instanceof assert.AssertionError) throw error }
    await new Promise(resolve => setTimeout(resolve, 25))
  }
  child.kill(); throw new Error('EXAMPLE_API_START_TIMEOUT')
}
async function stop(app) { if (app?.child.exitCode === null) { app.child.kill(); await once(app.child, 'exit') } }
async function call(app, suffix, body, token = app.token) {
  const response = await fetch(`${app.scoped}${suffix}`, { method: body === undefined ? 'GET' : 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
  return { status: response.status, body: await response.json() }
}

test('authenticated normal collection atomically fills only the current switched-store preset, preserving Cookie and other stores', { timeout: 20_000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'forecast-setup-api-'))
  let app
  try {
    await seed(root)
    const cookieBefore = await readFile(join(root, 'report-source-cookie-secrets.json'), 'utf8')
    const otherBefore = (await read(root, 'report-sources.json'))[otherId]
    app = await start(root)
    const denied = await fetch(`${app.scoped}/live-collection-runs`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
    assert.equal(denied.status, 401)
    assert.equal((await fetch(`${app.origin}/api/v1/auth/accounts`, { method: 'POST',
      headers: { Authorization: `Bearer ${app.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'forecast-operator', displayName: 'Synthetic operator',
        password: 'example-Forecast-Operator-Password-42', roles: ['OTA_OPERATION_MANAGER'], hotelIds: [hotelId] }) })).status, 201)
    const operatorLogin = await fetch(`${app.origin}/api/v1/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'forecast-operator', password: 'example-Forecast-Operator-Password-42' }) })
    const operator = (await operatorLogin.json()).accessToken
    assert.equal((await call(app, '/live-collection-runs', {}, operator)).status, 403)
    assert.equal((await requests(root)).length, 0, 'authorization failures cannot access provider data')
    const result = await call(app, '/live-collection-runs', {})
    assert.equal(result.status, 200, JSON.stringify(result.body))
    assert.equal(result.body.data.status, 'SUCCEEDED')
    assert.equal(result.body.data.sourceCount, 4)
    assert.deepEqual(result.body.data.forecastSetup, { status: 'CONFIGURED', roomTypeCount: 4, physicalRoomCount: 71, verifiedFutureDays: 14 })
    const store = await read(root, 'report-sources.json')
    assert.equal(store[hotelId][3].enabled, true)
    assert.deepEqual(JSON.parse(store[hotelId][3].requestPayloadJson).roomTypes.map(room => room.id), ['DCF', 'SCF', 'TF', 'QZPCF'])
    assert.deepEqual(store[otherId], otherBefore)
    assert.equal(await readFile(join(root, 'report-source-cookie-secrets.json'), 'utf8'), cookieBefore)
    const snapshot = (await read(root, 'live-report-snapshots.json'))[hotelId].at(-1)
    assert.equal(snapshot.roomForecast.length, 4)
    assert.equal(snapshot.futureDaily.length, 29)
    assert.equal(snapshot.overview.roomFee, 1000, 'forecast does not replace business-overview revenue')
    assert.equal((await call(app, '/live-collection-runs', {})).body.data.forecastSetup, undefined)
    assert.equal((await requests(root)).filter(request => request.path.endsWith('/property/roomType/search')).length, 1)
    assert.ok((await requests(root)).every(request => request.path.startsWith('/hotelpms/')), 'no outbound delivery is attempted')
    await stop(app)
    app = await start(root)
    assert.equal((await call(app, '/report-sources')).body.data[3].enabled, true)
  } finally { await stop(app); await rm(root, { recursive: true, force: true }) }
})

test('isolated non-publishing test collection never discovers or persists forecast configuration', { timeout: 20_000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'forecast-setup-api-isolated-'))
  let app
  try {
    await seed(root)
    const webhook = 'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=example-not-a-real-forecast-webhook'
    const endpointSha256 = fingerprintWeComWebhook(webhook)
    await json(root, 'wecom-configs.json', { [hotelId]: { enabled: false, broadcastIntervalHours: 0, endpointSha256 } })
    await json(root, 'wecom-webhook-secrets.json', { [hotelId]: encryptCookie(webhook, key, `wecom-webhook:${hotelId}`) })
    const configBefore = await readFile(join(root, 'report-sources.json'), 'utf8')
    const cookieBefore = await readFile(join(root, 'report-source-cookie-secrets.json'), 'utf8')
    app = await start(root)
    const result = await call(app, '/wecom-test-suite-deliveries', { reasonCode: 'SEND_WECOM_UAT_TEST_SUITE',
      confirmRealWeComSend: true, expectedEndpointSha256: endpointSha256 })
    assert.equal(result.status, 200, JSON.stringify(result.body))
    assert.equal(result.body.data.collectionRun.sourceCount, 3)
    assert.equal(result.body.data.collectionRun.forecastSetup, undefined)
    assert.equal((await requests(root)).filter(request => request.path.endsWith('/property/roomType/search')).length, 0)
    assert.equal(await readFile(join(root, 'report-sources.json'), 'utf8'), configBefore)
    assert.equal(await readFile(join(root, 'report-source-cookie-secrets.json'), 'utf8'), cookieBefore)
    await assert.rejects(readFile(join(root, 'live-report-snapshots.json')), { code: 'ENOENT' })
  } finally { await stop(app); await rm(root, { recursive: true, force: true }) }
})

test('invalid forecast and persistence errors retain three-source service and explicitly report NOT_READY', { timeout: 20_000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'forecast-setup-api-failure-'))
  let app
  try {
    await seed(root)
    const configBefore = await readFile(join(root, 'report-sources.json'), 'utf8')
    app = await start(root)
    for (const variant of ['FALSE_ZERO', 'MISSING_LATE_DAY', 'NULL_ORDER']) {
      await json(root, 'fixture-state.json', { variant })
      const result = await call(app, '/live-collection-runs', {})
      assert.equal(result.status, 200)
      assert.equal(result.body.data.status, 'SUCCEEDED')
      assert.equal(result.body.data.sourceCount, 3)
      assert.equal(result.body.data.forecastSetup.status, 'NOT_READY')
      assert.equal(result.body.data.forecastSetup.reasonCode, 'PMS_FORECAST_SETUP_FORECAST_INCOMPLETE')
      assert.equal(await readFile(join(root, 'report-sources.json'), 'utf8'), configBefore)
    }
    await json(root, 'fixture-state.json', {})
    const path = join(root, 'report-sources.json')
    await rename(path, `${path}.saved`); await mkdir(path)
    const failed = await call(app, '/live-collection-runs', {})
    assert.equal(failed.status, 200)
    assert.equal(failed.body.data.sourceCount, 3)
    assert.equal(failed.body.data.forecastSetup.reasonCode, 'PMS_FORECAST_SETUP_PERSIST_FAILED')
    assert.equal((await call(app, '/report-sources')).body.data[3].enabled, false, 'memory must roll back to the original source array')
    await rm(path, { recursive: true }); await rename(`${path}.saved`, path)
    assert.equal(await readFile(path, 'utf8'), configBefore)
  } finally { await stop(app); await rm(root, { recursive: true, force: true }) }
})

test('source configuration changes during shadow validation are never overwritten or published', { timeout: 20_000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'forecast-setup-api-race-'))
  let app
  try {
    await seed(root)
    await json(root, 'fixture-state.json', { delayMs: 400 })
    app = await start(root)
    const collection = call(app, '/live-collection-runs', {})
    for (let index = 0; index < 100 && !(await requests(root)).length; index += 1) await new Promise(resolve => setTimeout(resolve, 10))
    const current = (await call(app, '/report-sources')).body.data
    const changed = current.map((source, index) => ({ ...source, displayName: index ? source.displayName : 'Updated by administrator', cookieUpdate: { action: 'KEEP' } }))
    assert.equal((await call(app, '/report-sources', { sources: changed, reasonCode: 'UPDATE_COLLECTION_CONFIGURATION' })).status, 200)
    const stale = await collection
    assert.equal(stale.status, 400)
    assert.equal(stale.body.code, 'REPORT_SOURCE_CHANGED_DURING_VALIDATION')
    const persisted = (await read(root, 'report-sources.json'))[hotelId]
    assert.equal(persisted[0].displayName, 'Updated by administrator')
    assert.equal(persisted[3].enabled, false)
    await assert.rejects(readFile(join(root, 'live-report-snapshots.json')), { code: 'ENOENT' })
  } finally { await stop(app); await rm(root, { recursive: true, force: true }) }
})

test('Cookie validation racing with discovery prevents a stale shadow from committing or publishing', { timeout: 20_000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'forecast-setup-api-cookie-race-'))
  let app
  try {
    await seed(root)
    await json(root, 'fixture-state.json', { delayMs: 400 })
    app = await start(root)
    const collection = call(app, '/live-collection-runs', {})
    for (let index = 0; index < 100 && !(await requests(root)).length; index += 1) await new Promise(resolve => setTimeout(resolve, 10))
    assert.equal((await call(app, '/pms-cookie-validation', { reasonCode: 'VALIDATE_AND_UPDATE_PMS_COOKIE',
      cookieHeader: forecastFixtureCookie() })).status, 200)
    const stale = await collection
    assert.equal(stale.status, 400)
    assert.equal(stale.body.code, 'PMS_COOKIE_CHANGED_DURING_VALIDATION')
    assert.equal((await read(root, 'report-sources.json'))[hotelId][3].enabled, false)
    await assert.rejects(readFile(join(root, 'live-report-snapshots.json')), { code: 'ENOENT' })
  } finally { await stop(app); await rm(root, { recursive: true, force: true }) }
})
