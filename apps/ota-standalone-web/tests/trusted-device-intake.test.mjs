import assert from 'node:assert/strict'
import {
  generateKeyPairSync,
  sign,
} from 'node:crypto'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import {
  createTrustedDeviceIntakeStore,
  trustedDeviceCanonicalMessage,
} from '../../../tools/uat/trusted-device-intake.mjs'

const hotel = {
  tenantId: '10000000-0000-4000-8000-000000000001',
  hotelId: '20000000-0000-4000-8000-000000000001',
  hotelCode: '001',
  hotelName: '001测试门店',
  pmsSystemCode: 'MEITUAN_BIEYANGHONG',
}

const minimalSnapshot = (now) => ({
  schemaVersion: 1,
  sourceSystem: 'MEITUAN_BIEYANGHONG',
  collectionRunId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  tenantId: hotel.tenantId,
  hotelId: hotel.hotelId,
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
})

test('001 trusted device enrollment stores only public key and rejects replay', async () => {
  const root = await mkdtemp(join(os.tmpdir(), 'trusted-device-store-'))
  const path = join(root, 'registry.json')
  try {
    const now = new Date('2026-08-30T02:00:00.000Z')
    const store = createTrustedDeviceIntakeStore({ path, hotel })
    const enrollment = store.createEnrollment({ now })
    const { publicKey, privateKey } = generateKeyPairSync('ed25519')
    const publicKeyPem = publicKey.export({ format: 'pem', type: 'spki' }).toString()
    const device = store.enroll({
      hotelCode: '001',
      enrollmentCode: enrollment.enrollmentCode,
      publicKeyPem,
      label: '001前台采集电脑',
      now: new Date(now.getTime() + 1_000),
    })
    assert.equal(device.status, 'ACTIVE')
    assert.equal(store.status().device.deviceId, device.deviceId)

    const persisted = await readFile(path, 'utf8')
    assert.doesNotMatch(persisted, new RegExp(enrollment.enrollmentCode, 'u'))
    assert.doesNotMatch(persisted, /PRIVATE KEY|password|cookie/iu)
    assert.match(persisted, /PUBLIC KEY/u)

    const requestNow = new Date(now.getTime() + 2_000)
    const body = { hotelCode: '001' }
    const request = {
      method: 'POST',
      path: '/api/v1/trusted-device/config',
      hotelCode: '001',
      deviceId: device.deviceId,
      timestamp: requestNow.toISOString(),
      nonce: '0123456789abcdef0123456789abcdef',
      body,
    }
    const signature = sign(
      null,
      Buffer.from(trustedDeviceCanonicalMessage(request)),
      privateKey,
    ).toString('base64url')
    const headers = {
      'x-sfg-device-id': device.deviceId,
      'x-sfg-device-timestamp': request.timestamp,
      'x-sfg-device-nonce': request.nonce,
      'x-sfg-device-signature': signature,
    }
    assert.equal(
      store.verifyRequest({
        method: request.method,
        path: request.path,
        body,
        headers,
        now: requestNow,
      }).deviceId,
      device.deviceId,
    )
    assert.throws(
      () => store.verifyRequest({
        method: request.method,
        path: request.path,
        body,
        headers,
        now: requestNow,
      }),
      /TRUSTED_DEVICE_REPLAY_REJECTED/u,
    )

    const snapshot = minimalSnapshot(requestNow)
    assert.equal(
      store.acceptSnapshot({ deviceId: device.deviceId, snapshot, now: requestNow })
        .lastCompleteness,
      'COMPLETE',
    )
    assert.throws(
      () => store.acceptSnapshot({
        deviceId: device.deviceId,
        snapshot: { ...snapshot, cookie: 'must-not-pass' },
        now: requestNow,
      }),
      /TRUSTED_DEVICE_SNAPSHOT_SECRET_FIELD_REJECTED/u,
    )
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('trusted-device registries isolate two Bieyanghong stores', async () => {
  const root = await mkdtemp(join(os.tmpdir(), 'trusted-device-multistore-'))
  try {
    const now = new Date('2026-09-01T02:00:00.000Z')
    const hotel003 = {
      ...hotel,
      hotelId: '20000000-0000-4000-8000-000000000003',
      hotelCode: '003',
      hotelName: '003测试门店',
    }
    const store001 = createTrustedDeviceIntakeStore({
      path: join(root, '001.json'),
      hotel,
    })
    const store003 = createTrustedDeviceIntakeStore({
      path: join(root, '003.json'),
      hotel: hotel003,
    })
    const key001 = generateKeyPairSync('ed25519')
    const enrollment001 = store001.createEnrollment({ now })
    const device001 = store001.enroll({
      hotelCode: '001',
      enrollmentCode: enrollment001.enrollmentCode,
      publicKeyPem: key001.publicKey.export({ format: 'pem', type: 'spki' }).toString(),
      now: new Date(now.getTime() + 1_000),
    })
    const requestNow = new Date(now.getTime() + 2_000)
    const body003 = { hotelCode: '003' }
    const request003 = {
      method: 'POST',
      path: '/api/v1/trusted-device/config',
      hotelCode: '003',
      deviceId: device001.deviceId,
      timestamp: requestNow.toISOString(),
      nonce: 'fedcba9876543210fedcba9876543210',
      body: body003,
    }
    const signature = sign(
      null,
      Buffer.from(trustedDeviceCanonicalMessage(request003)),
      key001.privateKey,
    ).toString('base64url')
    assert.throws(
      () => store003.verifyRequest({
        method: request003.method,
        path: request003.path,
        body: body003,
        headers: {
          'x-sfg-device-id': device001.deviceId,
          'x-sfg-device-timestamp': request003.timestamp,
          'x-sfg-device-nonce': request003.nonce,
          'x-sfg-device-signature': signature,
        },
        now: requestNow,
      }),
      /TRUSTED_DEVICE_NOT_ACTIVE/u,
    )
    assert.equal(store001.status().hotelCode, '001')
    assert.equal(store003.status().hotelCode, '003')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
