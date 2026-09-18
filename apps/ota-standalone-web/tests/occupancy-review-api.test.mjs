import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { addDays, shanghaiDate, weekStart } from '../../../tools/uat/occupancy-review.mjs'

const root = fileURLToPath(new URL('../../../', import.meta.url))
const script = fileURLToPath(new URL('../../../tools/uat/ota-standalone-review-api.mjs', import.meta.url))
const hotelId = '20000000-0000-4000-8000-000000000001'
const tenantId = '10000000-0000-4000-8000-000000000001'
const prefix = `/api/v1/ota/tenants/${tenantId}/hotels/${hotelId}`
const password = 'example-Occupancy-QA-Password-42'

async function startApi(directory) {
  const portServer = createServer()
  portServer.listen(0, '127.0.0.1'); await once(portServer, 'listening')
  const port = portServer.address().port
  portServer.close(); await once(portServer, 'close')
  const child = spawn(process.execPath, [script], { cwd: root, env: { ...process.env,
    OTA_REVIEW_API_PORT: String(port), OTA_REVIEW_USERNAME: 'occupancy-admin', OTA_REVIEW_PASSWORD: password,
    OTA_REVIEW_ACCESS_TOKEN: 'occupancy-isolated-test-token', OTA_REVIEW_DATA_PATH: join(directory, 'report-sources.json'),
    OTA_REVIEW_COOKIE_SECRETS_PATH: join(directory, 'cookies.json'), OTA_REVIEW_SECRET_KEY: Buffer.alloc(32, 23).toString('base64url'),
    OTA_REVIEW_PSEUDONYM_SECRET_KEY: Buffer.alloc(32, 24).toString('base64url'),
    OTA_REVIEW_AUTO_COLLECTION_ENABLED: 'false', OTA_ANALYTICS_RETENTION_ENABLED: 'false', OTA_OCCUPANCY_HISTORY_PATH: join(directory, 'history.json'),
  }, stdio: ['ignore', 'ignore', 'pipe'] })
  let stderr = ''; child.stderr.on('data', (data) => { stderr += data.toString() })
  for (let i = 0; i < 100; i += 1) {
    if (child.exitCode !== null) throw new Error(`API exited: ${stderr.slice(-500)}`)
    try { if ((await fetch(`http://127.0.0.1:${port}/health`)).ok) return { child, base: `http://127.0.0.1:${port}` } } catch {}
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  child.kill(); throw new Error('OCCUPANCY_TEST_START_FAILED')
}
async function stop(child) { if (child && child.exitCode === null) { child.kill(); await once(child, 'exit') } }
const request = (base, path, token, body) => fetch(`${base}${path}`, { method: body ? 'POST' : 'GET',
  headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
  ...(body ? { body: JSON.stringify(body) } : {}) })
async function login(base, username) {
  const response = await request(base, '/api/v1/auth/login', null, { username, password })
  assert.equal(response.status, 200)
  return (await response.json()).accessToken
}

test('occupancy API enforces tenant/hotel/role scope and persists real decisions across restart', { timeout: 25000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'occupancy-api-'))
  const today = shanghaiDate(), start = addDays(weekStart(today), 7)
  await writeFile(join(directory, 'history.json'), JSON.stringify({ schemaVersion: 1, generatedAt: new Date().toISOString(), hotels: [
    { tenantId, hotelId, firstDate: addDays(today, -10), daily: [], pace: [], periods: [] },
    { tenantId: 'other-tenant', hotelId, firstDate: '2000-01-01', daily: [], pace: [], periods: [] },
  ] }))
  let running
  try {
    running = await startApi(directory)
    const { base } = running
    const token = await login(base, 'occupancy-admin')
    assert.equal((await request(base, `${prefix}/occupancy-review`, null)).status, 401)
    assert.equal((await request(base, prefix.replace(tenantId, 'other-tenant') + '/occupancy-review', token)).status, 404)
    const read = await request(base, `${prefix}/occupancy-review`, token)
    assert.equal(read.status, 200)
    assert.equal((await read.json()).data.history.firstDate, addDays(today, -10))
    for (const [username, role] of [['occupancy-viewer', 'GENERAL_MANAGER'], ['occupancy-manager', 'OTA_OPERATION_MANAGER']]) {
      const created = await request(base, '/api/v1/auth/accounts', token, { username, displayName: username, password, roles: [role], hotelIds: [hotelId] })
      assert.equal(created.status, 201)
    }
    const viewer = await login(base, 'occupancy-viewer'), manager = await login(base, 'occupancy-manager')
    assert.equal((await request(base, `${prefix}/occupancy-review`, viewer)).status, 200)
    const otherHotelPath = prefix.replace(hotelId, '20000000-0000-4000-8000-000000000002')
    assert.equal((await request(base, `${otherHotelPath}/occupancy-review`, manager)).status, 404)
    const input = { reasonCode: 'APPROVE_OCCUPANCY_TARGETS', weekStart: start, expectedVersion: 0,
      reason: '确认上周同日参考目标', points: [{ date: start, time: '18:00', percent: 85 }] }
    assert.equal((await request(base, `${prefix}/occupancy-targets`, viewer, input)).status, 403)
    assert.equal((await request(base, `${otherHotelPath}/occupancy-targets`, manager, input)).status, 404)
    const approved = await request(base, `${prefix}/occupancy-targets`, manager, input)
    assert.equal(approved.status, 200, JSON.stringify(await approved.clone().json()))
    assert.equal((await approved.json()).data.approvedBy, 'occupancy-manager')
    assert.equal((await request(base, `${prefix}/occupancy-targets`, manager, { ...input, reason: 'stale edit' })).status, 409)
    const illegal = await request(base, `${prefix}/occupancy-targets`, manager, { ...input, expectedVersion: 1, points: [{ ...input.points[0], percent: null }] })
    assert.equal(illegal.status, 400)
    await stop(running.child)
    running = await startApi(directory)
    const secondToken = await login(running.base, 'occupancy-manager')
    const second = await request(running.base, `${prefix}/occupancy-review?planWeek=${start}`, secondToken)
    const view = (await second.json()).data
    assert.equal(view.plan.version, 1)
    assert.equal(view.plan.days[0].points.find((p) => p.time === '18:00').targetPercent, 85)
    assert.equal(view.recentDecisions[0].reason, input.reason)
    assert.equal((await request(running.base, `${prefix}/occupancy-review?type=YEAR`, secondToken)).status, 400)
  } finally { await stop(running?.child); await rm(directory, { recursive: true, force: true }) }
})
