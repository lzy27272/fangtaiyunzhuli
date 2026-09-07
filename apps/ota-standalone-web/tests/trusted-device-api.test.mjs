import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import {
  createHmac,
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
import {
  trustedDeviceCanonicalMessage,
  trustedDeviceScopeProof,
} from '../../../tools/uat/trusted-device-intake.mjs'

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

const signedHeaders = ({ privateKey, deviceId, hotelCode = '001', path, body }) => {
  const timestamp = new Date().toISOString()
  const nonce = randomBytes(24).toString('base64url')
  const signature = sign(null, Buffer.from(trustedDeviceCanonicalMessage({
    method: 'POST',
    path,
    hotelCode,
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

const configurePmsScope = async ({
  port,
  accessToken,
  scopedPath,
  pmsLoginHotelId,
}) => {
  const loaded = await fetch(
    `http://127.0.0.1:${port}${scopedPath}/report-sources`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  )
  assert.equal(loaded.status, 200)
  const sources = (await loaded.json()).data
  const saved = await fetch(
    `http://127.0.0.1:${port}${scopedPath}/report-sources`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        reasonCode: 'TRUSTED_DEVICE_SCOPE_TEST',
        sources: sources.map((source) => ({
          ...source,
          cookieUpdate: pmsLoginHotelId === null
            ? { action: 'CLEAR' }
            : {
                action: 'REPLACE',
                value: `hotelpms_login_hotel_id=${pmsLoginHotelId}; session=synthetic`,
              },
        })),
      }),
    },
  )
  assert.equal(saved.status, 200)
}

const fetchScopedConfig = async ({
  port,
  privateKey,
  deviceId,
  hotelCode,
  pmsLoginHotelId,
  scopeProofKey,
}) => {
  const path = '/api/v1/trusted-device/config'
  const challengeBody = { hotelCode }
  const challengeResponse = await fetch(
    `http://127.0.0.1:${port}${path}`,
    {
      method: 'POST',
      headers: signedHeaders({
        privateKey,
        deviceId,
        hotelCode,
        path,
        body: challengeBody,
      }),
      body: JSON.stringify(challengeBody),
    },
  )
  assert.equal(challengeResponse.status, 200)
  const challenge = (await challengeResponse.json()).data
  assert.equal(challenge.schemaVersion, 2)
  assert.equal(challenge.phase, 'SCOPE_CHALLENGE')
  assert.equal(Object.hasOwn(challenge, 'sources'), false)
  const proofBody = {
    hotelCode,
    scopeChallengeId: challenge.scopeChallenge.challengeId,
    scopeProof: trustedDeviceScopeProof({
      hotelCode,
      deviceId,
      challenge: challenge.scopeChallenge.value,
      pmsLoginHotelId,
      scopeProofKey,
    }),
  }
  const configResponse = await fetch(
    `http://127.0.0.1:${port}${path}`,
    {
      method: 'POST',
      headers: signedHeaders({
        privateKey,
        deviceId,
        hotelCode,
        path,
        body: proofBody,
      }),
      body: JSON.stringify(proofBody),
    },
  )
  assert.equal(configResponse.status, 200)
  return (await configResponse.json()).data
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
      OTA_REVIEW_PSEUDONYM_SECRET_KEY: Buffer.alloc(32, 19).toString('base64url'),
      OTA_REVIEW_AUTO_COLLECTION_ENABLED: 'false',
      OTA_REVIEW_TRUSTED_DEVICE_001_ENABLED: 'true',
      OTA_REVIEW_BIEYANGHONG_COLLECTION_MODE: 'STORE_TRUSTED_DEVICE',
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

    await configurePmsScope({
      port,
      accessToken,
      scopedPath: scoped,
      pmsLoginHotelId: '1001001',
    })
    const configPath = '/api/v1/trusted-device/config'
    const config = await fetchScopedConfig({
      port,
      privateKey,
      deviceId: device.deviceId,
      hotelCode: '001',
      pmsLoginHotelId: '1001001',
      scopeProofKey: device.scopeProofKey,
    })
    assert.equal(config.schemaVersion, 2)
    assert.equal(config.phase, 'COLLECTION_CONFIG')
    assert.equal(config.hotel.hotelCode, '001')
    assert.ok(config.sources.length >= 3)
    assert.doesNotMatch(JSON.stringify(config), /cookie|password|secret/iu)

    const arrayScopeBody = { hotelCode: ['001'] }
    const arrayScopeResponse = await fetch(
      `http://127.0.0.1:${port}${configPath}`,
      {
        method: 'POST',
        headers: signedHeaders({
          privateKey,
          deviceId: device.deviceId,
          hotelCode: '001',
          path: configPath,
          body: arrayScopeBody,
        }),
        body: JSON.stringify(arrayScopeBody),
      },
    )
    assert.notEqual(arrayScopeResponse.status, 200)
    const queryScopeBody = { hotelCode: '001' }
    const queryScopeResponse = await fetch(
      `http://127.0.0.1:${port}${configPath}?ignored=1`,
      {
        method: 'POST',
        headers: signedHeaders({
          privateKey,
          deviceId: device.deviceId,
          path: configPath,
          body: queryScopeBody,
        }),
        body: JSON.stringify(queryScopeBody),
      },
    )
    assert.notEqual(queryScopeResponse.status, 200)

    const now = new Date()
    const roomName = '测试大床房'
    const roomCode = createHmac(
      'sha256',
      Buffer.from(config.pseudonymKey, 'base64url'),
    ).update(`room-type:${roomName}`).digest('hex').slice(0, 16)
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
      sources: config.requiredSourceContracts.map((source) => ({
        ...source,
        completeness: 'COMPLETE',
        observedAt: now.toISOString(),
        ingestedAt: now.toISOString(),
        errorCode: null,
      })),
      orders: [],
      overview: {
        stayDate: now.toISOString().slice(0, 10),
        roomCount: 10, availableRooms: 5, soldRooms: 5,
        orderRooms: 5, checkinRooms: 4, roomFee: 1000,
        revenue: 1000, roomNights: 5, occupancyRate: 0.5,
        adr: 200, revPar: 100,
      },
      futureDaily: [],
      physicalInventory: [{
        inventoryPoolId: `PMS-${roomCode}`,
        physicalRoomTypeCode: `PMS-${roomCode}`,
        displayName: roomName,
        physicalRoomCount: 10,
        primaryAvailableRooms: 5,
        estimatedRoomNights: 5,
        estimatedRoomFee: 1000,
        estimatedAdr: 200,
      }],
      roomForecast: [],
      hourlyDelta: {
        basis: 'BASELINE_PENDING', aggregationWindow: null,
        intervalStartAt: null, intervalEndAt: now.toISOString(),
        totals: null, byChannel: null, metricDelta: null,
      },
      futureBookingChanges: {
        basis: 'BASELINE_PENDING', hourlyBaselineAt: null,
        cumulativeBaselineAt: null, previousDayEndAt: null, daily: [],
      },
    }
    const snapshotPath = '/api/v1/trusted-device/snapshots'
    const missingReceiptBody = { hotelCode: '001', snapshot }
    const missingReceiptResponse = await fetch(
      `http://127.0.0.1:${port}${snapshotPath}`,
      {
        method: 'POST',
        headers: signedHeaders({
          privateKey,
          deviceId: device.deviceId,
          path: snapshotPath,
          body: missingReceiptBody,
        }),
        body: JSON.stringify(missingReceiptBody),
      },
    )
    assert.notEqual(missingReceiptResponse.status, 200)
    const approvalResponse = await fetch(
      `http://127.0.0.1:${port}${scoped}/trusted-device/scope-approval`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          reasonCode: 'APPROVE_TRUSTED_DEVICE_STORE_SCOPE',
        }),
      },
    )
    assert.equal(approvalResponse.status, 200)
    const snapshotBody = {
      hotelCode: '001',
      scopeReceipt: config.scopeReceipt,
      snapshot,
    }
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
    assert.equal(status.device.cutoverReady, true)

    const create003Response = await fetch(
      `http://127.0.0.1:${port}/api/v1/ota/simulation/hotels`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          tenantCode: '001',
          tenantDisplayName: '四方馆酒店管理',
          hotelCode: '003',
          hotelDisplayName: '003测试门店',
          pmsSystemCode: 'MEITUAN_BIEYANGHONG',
          timezone: 'Asia/Shanghai',
          reasonCode: 'TRUSTED_DEVICE_MULTI_STORE_TEST',
        }),
      },
    )
    assert.equal(create003Response.status, 201)
    const hotels003Response = await fetch(
      `http://127.0.0.1:${port}/api/v1/ota/simulation/hotels`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    )
    const hotel003 = (await hotels003Response.json()).data.hotels
      .find((hotel) => hotel.hotelCode === '003')
    assert.ok(hotel003)
    const scoped003 = `/api/v1/ota/tenants/${encodeURIComponent(hotel003.tenantId)}`
      + `/hotels/${encodeURIComponent(hotel003.hotelId)}`
    const enrollment003Response = await fetch(
      `http://127.0.0.1:${port}${scoped003}/trusted-device/enrollment`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ label: '003 API test' }),
      },
    )
    assert.equal(enrollment003Response.status, 201)
    const enrollment003 = (await enrollment003Response.json()).data
    assert.match(enrollment003.enrollmentCode, /^003-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/u)
    const key003 = generateKeyPairSync('ed25519')
    const enrolled003Response = await fetch(
      `http://127.0.0.1:${port}/api/v1/trusted-device/enroll`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          hotelCode: '003',
          enrollmentCode: enrollment003.enrollmentCode,
          label: '003 API test',
          publicKeyPem: key003.publicKey.export({ format: 'pem', type: 'spki' }).toString(),
        }),
      },
    )
    assert.equal(enrolled003Response.status, 201)
    const device003 = (await enrolled003Response.json()).data
    const config003Body = { hotelCode: '003' }
    const legacyCollectionAfterEnrollment = await fetch(
      `http://127.0.0.1:${port}${scoped003}/live-collection-runs`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: '{}',
      },
    )
    assert.equal(legacyCollectionAfterEnrollment.status, 400)
    assert.equal(
      (await legacyCollectionAfterEnrollment.json()).code,
      'REPORT_SOURCE_COOKIE_REQUIRED',
    )
    await configurePmsScope({
      port,
      accessToken,
      scopedPath: scoped003,
      pmsLoginHotelId: '1001003',
    })
    const wrongChallengeResponse = await fetch(
      `http://127.0.0.1:${port}${configPath}`,
      {
        method: 'POST',
        headers: signedHeaders({
          privateKey: key003.privateKey,
          deviceId: device003.deviceId,
          hotelCode: '003',
          path: configPath,
          body: config003Body,
        }),
        body: JSON.stringify(config003Body),
      },
    )
    const wrongChallenge = (await wrongChallengeResponse.json()).data
    const wrongProofBody = {
      hotelCode: '003',
      scopeChallengeId: wrongChallenge.scopeChallenge.challengeId,
      scopeProof: trustedDeviceScopeProof({
        hotelCode: '003',
        deviceId: device003.deviceId,
        challenge: wrongChallenge.scopeChallenge.value,
        pmsLoginHotelId: '1001004',
        scopeProofKey: device003.scopeProofKey,
      }),
    }
    const wrongProofResponse = await fetch(
      `http://127.0.0.1:${port}${configPath}`,
      {
        method: 'POST',
        headers: signedHeaders({
          privateKey: key003.privateKey,
          deviceId: device003.deviceId,
          hotelCode: '003',
          path: configPath,
          body: wrongProofBody,
        }),
        body: JSON.stringify(wrongProofBody),
      },
    )
    assert.notEqual(wrongProofResponse.status, 200)
    assert.equal(
      (await wrongProofResponse.json()).code,
      'TRUSTED_DEVICE_STORE_SCOPE_INVALID',
    )
    await configurePmsScope({
      port,
      accessToken,
      scopedPath: scoped003,
      pmsLoginHotelId:
        '1001003; hotelpms_login_hotel_id=1001004',
    })
    const conflictChallengeResponse = await fetch(
      `http://127.0.0.1:${port}${configPath}`,
      {
        method: 'POST',
        headers: signedHeaders({
          privateKey: key003.privateKey,
          deviceId: device003.deviceId,
          hotelCode: '003',
          path: configPath,
          body: config003Body,
        }),
        body: JSON.stringify(config003Body),
      },
    )
    const conflictChallenge = (await conflictChallengeResponse.json()).data
    const conflictProofBody = {
      hotelCode: '003',
      scopeChallengeId: conflictChallenge.scopeChallenge.challengeId,
      scopeProof: trustedDeviceScopeProof({
        hotelCode: '003',
        deviceId: device003.deviceId,
        challenge: conflictChallenge.scopeChallenge.value,
        pmsLoginHotelId: '1001003',
        scopeProofKey: device003.scopeProofKey,
      }),
    }
    const conflictProofResponse = await fetch(
      `http://127.0.0.1:${port}${configPath}`,
      {
        method: 'POST',
        headers: signedHeaders({
          privateKey: key003.privateKey,
          deviceId: device003.deviceId,
          hotelCode: '003',
          path: configPath,
          body: conflictProofBody,
        }),
        body: JSON.stringify(conflictProofBody),
      },
    )
    assert.notEqual(conflictProofResponse.status, 200)
    assert.equal(
      (await conflictProofResponse.json()).code,
      'BIEYANGHONG_STORE_SCOPE_INVALID',
    )
    await configurePmsScope({
      port,
      accessToken,
      scopedPath: scoped003,
      pmsLoginHotelId: '1001003',
    })
    const config003 = await fetchScopedConfig({
      port,
      privateKey: key003.privateKey,
      deviceId: device003.deviceId,
      hotelCode: '003',
      pmsLoginHotelId: '1001003',
      scopeProofKey: device003.scopeProofKey,
    })
    assert.equal(config003.hotel.hotelCode, '003')
    const roomCode003 = createHmac(
      'sha256',
      Buffer.from(config003.pseudonymKey, 'base64url'),
    ).update(`room-type:${roomName}`).digest('hex').slice(0, 16)
    const snapshot003 = {
      ...snapshot,
      collectionRunId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      tenantId: hotel003.tenantId,
      hotelId: hotel003.hotelId,
      completeness: 'PARTIAL',
      sources: config003.requiredSourceContracts.map((source) => ({
        ...source,
        completeness: 'COMPLETE',
        observedAt: now.toISOString(),
        ingestedAt: now.toISOString(),
        errorCode: null,
      })),
      physicalInventory: snapshot.physicalInventory.map((room) => ({
        ...room,
        inventoryPoolId: `PMS-${roomCode003}`,
        physicalRoomTypeCode: `PMS-${roomCode003}`,
      })),
    }
    const partial003Body = {
      hotelCode: '003',
      scopeReceipt: config003.scopeReceipt,
      snapshot: snapshot003,
    }
    const partial003Response = await fetch(
      `http://127.0.0.1:${port}${snapshotPath}`,
      {
        method: 'POST',
        headers: signedHeaders({
          privateKey: key003.privateKey,
          deviceId: device003.deviceId,
          hotelCode: '003',
          path: snapshotPath,
          body: partial003Body,
        }),
        body: JSON.stringify(partial003Body),
      },
    )
    assert.equal(partial003Response.status, 202)
    assert.equal((await partial003Response.json()).data.authoritative, false)
    await configurePmsScope({
      port,
      accessToken,
      scopedPath: scoped003,
      pmsLoginHotelId: null,
    })
    const completeConfig003 = await fetchScopedConfig({
      port,
      privateKey: key003.privateKey,
      deviceId: device003.deviceId,
      hotelCode: '003',
      pmsLoginHotelId: '1001003',
      scopeProofKey: device003.scopeProofKey,
    })
    const legacyCollectionAfterPartial = await fetch(
      `http://127.0.0.1:${port}${scoped003}/live-collection-runs`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: '{}',
      },
    )
    assert.equal(legacyCollectionAfterPartial.status, 400)
    assert.equal(
      (await legacyCollectionAfterPartial.json()).code,
      'REPORT_SOURCE_COOKIE_REQUIRED',
    )
    const approve003 = await fetch(
      `http://127.0.0.1:${port}${scoped003}/trusted-device/scope-approval`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          reasonCode: 'APPROVE_TRUSTED_DEVICE_STORE_SCOPE',
        }),
      },
    )
    assert.equal(approve003.status, 200)
    const complete003Body = {
      hotelCode: '003',
      scopeReceipt: completeConfig003.scopeReceipt,
      snapshot: { ...snapshot003, completeness: 'COMPLETE' },
    }
    const complete003Response = await fetch(
      `http://127.0.0.1:${port}${snapshotPath}`,
      {
        method: 'POST',
        headers: signedHeaders({
          privateKey: key003.privateKey,
          deviceId: device003.deviceId,
          hotelCode: '003',
          path: snapshotPath,
          body: complete003Body,
        }),
        body: JSON.stringify(complete003Body),
      },
    )
    assert.equal(complete003Response.status, 202)
    const complete003Result = (await complete003Response.json()).data
    assert.equal(complete003Result.authoritative, true)
    assert.equal(complete003Result.device.cutoverReady, true)
    const legacyCollectionAfterComplete = await fetch(
      `http://127.0.0.1:${port}${scoped003}/live-collection-runs`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: '{}',
      },
    )
    assert.equal(legacyCollectionAfterComplete.status, 400)
    assert.equal(
      (await legacyCollectionAfterComplete.json()).code,
      'TRUSTED_DEVICE_COLLECTION_REQUIRED',
    )
    const crossStoreResponse = await fetch(
      `http://127.0.0.1:${port}${configPath}`,
      {
        method: 'POST',
        headers: signedHeaders({
          privateKey,
          deviceId: device.deviceId,
          hotelCode: '003',
          path: configPath,
          body: config003Body,
        }),
        body: JSON.stringify(config003Body),
      },
    )
    assert.notEqual(crossStoreResponse.status, 200)
    const create004Response = await fetch(
      `http://127.0.0.1:${port}/api/v1/ota/simulation/hotels`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          tenantCode: '001',
          tenantDisplayName: '四方馆酒店管理',
          hotelCode: '004',
          hotelDisplayName: '004范围外测试门店',
          pmsSystemCode: 'MEITUAN_BIEYANGHONG',
          timezone: 'Asia/Shanghai',
          reasonCode: 'TRUSTED_DEVICE_ALLOWLIST_TEST',
        }),
      },
    )
    assert.equal(create004Response.status, 201)
    const hotel004 = (await fetch(
      `http://127.0.0.1:${port}/api/v1/ota/simulation/hotels`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    ).then((response) => response.json())).data.hotels
      .find((hotel) => hotel.hotelCode === '004')
    const rejected004Enrollment = await fetch(
      `http://127.0.0.1:${port}/api/v1/ota/tenants/${hotel004.tenantId}`
      + `/hotels/${hotel004.hotelId}/trusted-device/enrollment`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ label: 'must stay outside rollout' }),
      },
    )
    assert.equal(rejected004Enrollment.status, 400)
    assert.equal(
      (await rejected004Enrollment.json()).code,
      'TRUSTED_DEVICE_SCOPE_INVALID',
    )
    const healthAfter003 = await fetch(`http://127.0.0.1:${port}/health`)
      .then((response) => response.json())
    assert.deepEqual(
      healthAfter003.trustedDevices.map((item) => item.hotelCode).sort(),
      ['001', '003'],
    )
  } finally {
    if (child.exitCode === null) {
      child.kill()
      await once(child, 'exit')
    }
    await rm(runtimePath, { recursive: true, force: true })
  }
})
