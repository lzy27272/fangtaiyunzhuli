import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import {
  generateKeyPairSync,
  randomBytes,
  sign,
} from 'node:crypto'
import { once } from 'node:events'
import { mkdtemp, rm } from 'node:fs/promises'
import { createServer } from 'node:http'
import os from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { trustedDeviceCanonicalMessage } from '../../../tools/uat/trusted-device-intake.mjs'

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

const signedHeaders = ({ privateKey, deviceId, path, body }) => {
  const timestamp = new Date().toISOString()
  const nonce = randomBytes(24).toString('base64url')
  const signature = sign(null, Buffer.from(trustedDeviceCanonicalMessage({
    method: 'POST',
    path,
    hotelCode: '001',
    deviceId,
    timestamp,
    nonce,
    body,
  })), privateKey).toString('base64url')
  return {
    'Content-Type': 'application/json',
    'X-SFG-Device-ID': deviceId,
    'X-SFG-Device-Timestamp': timestamp,
    'X-SFG-Device-Nonce': nonce,
    'X-SFG-Device-Signature': signature,
  }
}

test('001 trusted device API enrolls, verifies and accepts a scoped snapshot', async () => {
  const runtimePath = await mkdtemp(join(os.tmpdir(), 'trusted-device-api-'))
  const port = await availablePort()
  const child = spawn(process.execPath, [apiScript], {
    cwd: repoRoot,
    env: {
      ...process.env,
      OTA_REVIEW_API_PORT: String(port),
      OTA_REVIEW_USERNAME: 'trusted-test',
      OTA_REVIEW_PASSWORD: 'example-Trusted-Test-Password-42',
      OTA_REVIEW_ACCESS_TOKEN: 'trusted-test-token',
      OTA_REVIEW_DATA_PATH: join(runtimePath, 'report-sources.json'),
      OTA_REVIEW_COOKIE_SECRETS_PATH: join(runtimePath, 'cookies.json'),
      OTA_REVIEW_SECRET_KEY: Buffer.alloc(32, 18).toString('base64url'),
      OTA_REVIEW_AUTO_COLLECTION_ENABLED: 'false',
      OTA_REVIEW_TRUSTED_DEVICE_001_ENABLED: 'true',
    },
    stdio: ['ignore', 'ignore', 'pipe'],
  })
  let stderr = ''
  child.stderr.on('data', (chunk) => { stderr += chunk.toString('utf8') })
  try {
    let health
    for (let attempt = 0; attempt < 40; attempt += 1) {
      if (child.exitCode !== null) throw new Error(`API_EXITED:${stderr.slice(-500)}`)
      try {
        health = await fetch(`http://127.0.0.1:${port}/health`)
        if (health.ok) break
      } catch {
        // Wait for API startup.
      }
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 50))
    }
    assert.equal(health?.ok, true)
    const healthBody = await health.json()
    assert.equal(healthBody.trustedDevice001.enabled, true)
    assert.equal(healthBody.trustedDevice001.mode, 'STORE_TRUSTED_DEVICE')

    const loginResponse = await fetch(`http://127.0.0.1:${port}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: 'trusted-test',
        password: 'example-Trusted-Test-Password-42',
      }),
    })
    const { accessToken } = await loginResponse.json()
    const hotelsResponse = await fetch(
      `http://127.0.0.1:${port}/api/v1/ota/simulation/hotels`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    )
    const hotel001 = (await hotelsResponse.json()).data.hotels
      .find((hotel) => hotel.hotelCode === '001')
    assert.ok(hotel001)
    const scoped = `/api/v1/ota/tenants/${encodeURIComponent(hotel001.tenantId)}`
      + `/hotels/${encodeURIComponent(hotel001.hotelId)}`
    const bootstrapResponse = await fetch(
      `http://127.0.0.1:${port}${scoped}/trusted-device/bootstrap`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ label: '001 bootstrap test' }),
      },
    )
    assert.equal(bootstrapResponse.status, 200)
    assert.match(
      bootstrapResponse.headers.get('content-disposition') ?? '',
      /Sifangguan-001-Setup\.cmd/u,
    )
    assert.match(bootstrapResponse.headers.get('x-sfg-enrollment-expires-at') ?? '', /^\d{4}-/u)
    const bootstrap = await bootstrapResponse.text()
    assert.match(bootstrap, /SFG_B64/u)
    assert.match(bootstrap, /ExecutionPolicy Bypass/u)
    assert.doesNotMatch(bootstrap, /password|cookie|手机号|验证码/iu)

    const enrollmentResponse = await fetch(
      `http://127.0.0.1:${port}${scoped}/trusted-device/enrollment`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ label: '001 API test' }),
      },
    )
    assert.equal(enrollmentResponse.status, 201)
    const enrollment = (await enrollmentResponse.json()).data
    assert.match(enrollment.enrollmentCode, /^001-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/u)

    const { publicKey, privateKey } = generateKeyPairSync('ed25519')
    const enrolledResponse = await fetch(
      `http://127.0.0.1:${port}/api/v1/trusted-device/enroll`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          hotelCode: '001',
          enrollmentCode: enrollment.enrollmentCode,
          label: '001 API test',
          publicKeyPem: publicKey.export({ format: 'pem', type: 'spki' }).toString(),
        }),
      },
    )
    assert.equal(enrolledResponse.status, 201)
    const device = (await enrolledResponse.json()).data

    const configPath = '/api/v1/trusted-device/config'
    const configBody = { hotelCode: '001' }
    const configResponse = await fetch(
      `http://127.0.0.1:${port}${configPath}`,
      {
        method: 'POST',
        headers: signedHeaders({ privateKey, deviceId: device.deviceId, path: configPath, body: configBody }),
        body: JSON.stringify(configBody),
      },
    )
    assert.equal(configResponse.status, 200)
    const config = (await configResponse.json()).data
    assert.equal(config.hotel.hotelCode, '001')
    assert.ok(config.sources.length >= 3)
    assert.doesNotMatch(JSON.stringify(config), /cookie|password|secret/iu)

    const now = new Date()
    const snapshot = {
      schemaVersion: 1,
      sourceSystem: 'MEITUAN_BIEYANGHONG',
      collectionRunId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      tenantId: hotel001.tenantId,
      hotelId: hotel001.hotelId,
      businessDate: now.toISOString().slice(0, 10),
      businessDateBasis: 'PMS_CONFIRMED',
      businessDateSource: 'PMS_NIGHT_AUDIT_API',
      businessDateStartedAt: null,
      previousBusinessDate: null,
      businessDateChanged: false,
      observedAt: now.toISOString(),
      completeness: 'COMPLETE',
      sources: [],
      orders: [],
      overview: null,
      futureDaily: [],
      physicalInventory: [],
      roomForecast: [],
      hourlyDelta: null,
      futureBookingChanges: null,
    }
    const snapshotPath = '/api/v1/trusted-device/snapshots'
    const snapshotBody = { hotelCode: '001', snapshot }
    const snapshotResponse = await fetch(
      `http://127.0.0.1:${port}${snapshotPath}`,
      {
        method: 'POST',
        headers: signedHeaders({ privateKey, deviceId: device.deviceId, path: snapshotPath, body: snapshotBody }),
        body: JSON.stringify(snapshotBody),
      },
    )
    assert.equal(snapshotResponse.status, 202)
    assert.equal((await snapshotResponse.json()).data.accepted, true)

    const statusResponse = await fetch(
      `http://127.0.0.1:${port}${scoped}/trusted-device`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    )
    const status = (await statusResponse.json()).data
    assert.equal(status.device.lastCompleteness, 'COMPLETE')
    assert.equal(status.device.lastBusinessDate, snapshot.businessDate)
  } finally {
    if (child.exitCode === null) {
      child.kill()
      await once(child, 'exit')
    }
    await rm(runtimePath, { recursive: true, force: true })
  }
})
