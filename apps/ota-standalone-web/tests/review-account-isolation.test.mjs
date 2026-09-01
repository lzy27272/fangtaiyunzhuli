import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, rm } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const apiScript = fileURLToPath(
  new URL('../../../tools/uat/ota-standalone-review-api.mjs', import.meta.url),
)
const repoRoot = fileURLToPath(new URL('../../../', import.meta.url))

const availablePort = async () => {
  const server = createServer()
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  const port = typeof address === 'object' ? address.port : 0
  server.close()
  await once(server, 'close')
  return port
}

const login = (port, username, password) => fetch(
  `http://127.0.0.1:${port}/api/v1/auth/login`,
  {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  },
)

test('managed account sees only assigned hotels and scoped APIs enforce the same boundary', { timeout: 20_000 }, async () => {
  const runtimePath = await mkdtemp(join(tmpdir(), 'review-account-scope-'))
  const port = await availablePort()
  const child = spawn(process.execPath, [apiScript], {
    cwd: repoRoot,
    env: {
      ...process.env,
      OTA_REVIEW_API_PORT: String(port),
      OTA_REVIEW_USERNAME: 'scope-admin',
      OTA_REVIEW_PASSWORD: 'example-Scope-Admin-Password-42',
      OTA_REVIEW_ACCESS_TOKEN: 'scope-bootstrap-token',
      OTA_REVIEW_DATA_PATH: join(runtimePath, 'report-sources.json'),
      OTA_REVIEW_COOKIE_SECRETS_PATH: join(runtimePath, 'cookies.json'),
      OTA_REVIEW_SECRET_KEY: Buffer.alloc(32, 21).toString('base64url'),
      OTA_REVIEW_AUTO_COLLECTION_ENABLED: 'false',
    },
    stdio: ['ignore', 'ignore', 'pipe'],
  })
  let stderr = ''
  child.stderr.on('data', (chunk) => { stderr += chunk.toString('utf8') })
  try {
    let health
    for (let attempt = 0; attempt < 50; attempt += 1) {
      if (child.exitCode !== null) throw new Error(`API_EXITED:${stderr.slice(-500)}`)
      try {
        health = await fetch(`http://127.0.0.1:${port}/health`)
        if (health.ok) break
      } catch {}
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 50))
    }
    assert.equal(health?.ok, true)

    const adminLogin = await login(
      port,
      'scope-admin',
      'example-Scope-Admin-Password-42',
    )
    assert.equal(adminLogin.status, 200)
    const adminSession = await adminLogin.json()
    const authHeaders = { Authorization: `Bearer ${adminSession.accessToken}` }
    const directoryResponse = await fetch(
      `http://127.0.0.1:${port}/api/v1/ota/simulation/hotels`,
      { headers: authHeaders },
    )
    const allHotels = (await directoryResponse.json()).data.hotels
    const hotel001 = allHotels.find((hotel) => hotel.hotelCode === '001')
    const hotel002 = allHotels.find((hotel) => hotel.hotelCode === '002')
    assert.ok(hotel001)
    assert.ok(hotel002)

    const createResponse = await fetch(
      `http://127.0.0.1:${port}/api/v1/auth/accounts`,
      {
        method: 'POST',
        headers: { ...authHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: 'scoped-operator',
          displayName: '001门店管理员',
          password: 'example-Scoped-Operator-Password-42',
          roles: ['GENERAL_MANAGER'],
          hotelIds: [hotel001.hotelId],
        }),
      },
    )
    assert.equal(createResponse.status, 201)
    const created = (await createResponse.json()).data

    const operatorLogin = await login(
      port,
      'scoped-operator',
      'example-Scoped-Operator-Password-42',
    )
    assert.equal(operatorLogin.status, 200)
    const operatorSession = await operatorLogin.json()
    assert.deepEqual(operatorSession.account.hotelIds, [hotel001.hotelId])
    const operatorHeaders = {
      Authorization: `Bearer ${operatorSession.accessToken}`,
    }

    const scopedDirectory = await fetch(
      `http://127.0.0.1:${port}/api/v1/ota/simulation/hotels`,
      { headers: operatorHeaders },
    )
    assert.equal(scopedDirectory.status, 200)
    const visibleHotels = (await scopedDirectory.json()).data.hotels
    assert.deepEqual(visibleHotels.map((hotel) => hotel.hotelCode), ['001'])

    const hotelBasePath =
      `/api/v1/ota/tenants/${encodeURIComponent(hotel001.tenantId)}`
      + `/hotels/${encodeURIComponent(hotel001.hotelId)}`
    assert.equal((await fetch(
      `http://127.0.0.1:${port}${hotelBasePath}/configuration`,
      { headers: operatorHeaders },
    )).status, 403)
    assert.equal((await fetch(
      `http://127.0.0.1:${port}${hotelBasePath}/report-sources`,
      { headers: operatorHeaders },
    )).status, 403)
    const sanitizedOtaResponse = await fetch(
      `http://127.0.0.1:${port}${hotelBasePath}/ota-sources`,
      { headers: operatorHeaders },
    )
    assert.equal(sanitizedOtaResponse.status, 200)
    const sanitizedOtaSources = (await sanitizedOtaResponse.json()).data
    assert.ok(sanitizedOtaSources.every((source) =>
      source.portalUrl === ''
      && source.dataEndpointUrl === ''
      && source.requestPayloadJson === ''))
    assert.equal((await fetch(
      `http://127.0.0.1:${port}${hotelBasePath}/pms-login-config`,
      { headers: operatorHeaders },
    )).status, 200)

    const scopedPath = (hotel) =>
      `/api/v1/ota/tenants/${encodeURIComponent(hotel.tenantId)}`
      + `/hotels/${encodeURIComponent(hotel.hotelId)}/trusted-device`
    assert.equal((await fetch(
      `http://127.0.0.1:${port}${scopedPath(hotel001)}`,
      { headers: operatorHeaders },
    )).status, 200)
    assert.equal((await fetch(
      `http://127.0.0.1:${port}${scopedPath(hotel002)}`,
      { headers: operatorHeaders },
    )).status, 404)

    const updateResponse = await fetch(
      `http://127.0.0.1:${port}/api/v1/auth/accounts/${created.id}`,
      {
        method: 'PATCH',
        headers: { ...authHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          displayName: '002门店管理员',
          roles: ['GENERAL_MANAGER'],
          hotelIds: [hotel002.hotelId],
          enabled: true,
        }),
      },
    )
    assert.equal(updateResponse.status, 200)
    assert.equal((await fetch(
      `http://127.0.0.1:${port}/api/v1/ota/simulation/hotels`,
      { headers: operatorHeaders },
    )).status, 401)

    const cancelledRoleResponse = await fetch(
      `http://127.0.0.1:${port}/api/v1/auth/accounts`,
      {
        method: 'POST',
        headers: { ...authHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: 'legacy-role-user',
          displayName: '已取消角色测试',
          password: 'example-Legacy-Role-Password-42',
          roles: ['REVENUE_MANAGER'],
          hotelIds: [hotel001.hotelId],
        }),
      },
    )
    assert.equal(cancelledRoleResponse.status, 400)
  } finally {
    if (child.exitCode === null) {
      child.kill()
      await once(child, 'exit')
    }
    await rm(runtimePath, { recursive: true, force: true })
  }
})
