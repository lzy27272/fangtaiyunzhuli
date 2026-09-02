import assert from 'node:assert/strict'
import {
  generateKeyPairSync,
  sign,
} from 'node:crypto'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { createDailyOrderSummary } from '../../../tools/uat/daily-order-summary.mjs'
import {
  createTrustedDeviceIntakeStore,
  stableJson,
  trustedDeviceCanonicalMessage,
  trustedDeviceScopeProof,
  validateTrustedDeviceSnapshot,
} from '../../../tools/uat/trusted-device-intake.mjs'

const hotel = {
  tenantId: '10000000-0000-4000-8000-000000000001',
  hotelId: '20000000-0000-4000-8000-000000000001',
  hotelCode: '001',
  hotelName: '001测试门店',
  pmsSystemCode: 'MEITUAN_BIEYANGHONG',
}

const createStore = ({ path, hotel: scopedHotel = hotel }) =>
  createTrustedDeviceIntakeStore({
    path,
    hotel: scopedHotel,
    sealStoreScope: (value) => ({
      ciphertext: Buffer.from(value).toString('base64url'),
    }),
    openStoreScope: (record) =>
      Buffer.from(record.ciphertext, 'base64url').toString(),
    sealDeviceScopeProofKey: (value) => ({
      ciphertext: Buffer.from(value).toString('base64url'),
    }),
    openDeviceScopeProofKey: (record) =>
      Buffer.from(record.ciphertext, 'base64url').toString(),
  })

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
  sources: [
    ['34000000-0000-4000-8000-000000000001', 'REPORT_ORDER_34000000', 'ORDER_DETAIL'],
    ['34000000-0000-4000-8000-000000000002', 'REPORT_INVENTORY_34000000', 'PHYSICAL_INVENTORY'],
    ['27f5ead0-11a3-4131-87ce-7ba9d7ff0ce0', 'REPORT_REVENUE_27f5ead0', 'CUSTOM_REPORT'],
  ].map(([sourceId, sourceCode, reportType]) => ({
    sourceId,
    sourceCode,
    reportType,
    completeness: 'COMPLETE',
    observedAt: now.toISOString(),
    ingestedAt: now.toISOString(),
    errorCode: null,
  })),
  orders: [],
  dailyOrderSummary: createDailyOrderSummary({
    orders: [],
    businessDate: now.toISOString().slice(0, 10),
  }),
  overview: {
    stayDate: now.toISOString().slice(0, 10),
    roomCount: 10,
    availableRooms: 5,
    soldRooms: 5,
    orderRooms: 5,
    checkinRooms: 4,
    roomFee: 1000,
    revenue: 1000,
    roomNights: 5,
    occupancyRate: 0.5,
    adr: 200,
    revPar: 100,
  },
  futureDaily: [],
  physicalInventory: [{
    inventoryPoolId: 'PMS-aaaaaaaaaaaaaaaa',
    physicalRoomTypeCode: 'PMS-aaaaaaaaaaaaaaaa',
    displayName: '测试房型',
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
})

test('001 trusted device enrollment stores only public key and rejects replay', async () => {
  const root = await mkdtemp(join(os.tmpdir(), 'trusted-device-store-'))
  const path = join(root, 'registry.json')
  try {
    const now = new Date('2026-08-30T02:00:00.000Z')
    const store = createStore({ path })
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
    assert.equal(store.status().device.cutoverReady, false)

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

    const challenge = store.issueScopeChallenge({
      deviceId: device.deviceId,
      now: requestNow,
    })
    const scopeProof = trustedDeviceScopeProof({
      hotelCode: '001',
      deviceId: device.deviceId,
      challenge: challenge.value,
      pmsLoginHotelId: '1001001',
      scopeProofKey: device.scopeProofKey,
    })
    const verifiedScope = store.verifyScopeProof({
      deviceId: device.deviceId,
      challengeId: challenge.challengeId,
      proof: scopeProof,
      expectedPmsLoginHotelId: '1001001',
      configDigest: 'a'.repeat(64),
      now: requestNow,
    })
    const parallelChallenge = store.issueScopeChallenge({
      deviceId: device.deviceId,
      now: requestNow,
    })
    const parallelScope = store.verifyScopeProof({
      deviceId: device.deviceId,
      challengeId: parallelChallenge.challengeId,
      proof: trustedDeviceScopeProof({
        hotelCode: '001',
        deviceId: device.deviceId,
        challenge: parallelChallenge.value,
        pmsLoginHotelId: '1001001',
        scopeProofKey: device.scopeProofKey,
      }),
      expectedPmsLoginHotelId: '1001001',
      configDigest: 'a'.repeat(64),
      now: requestNow,
    })
    assert.equal(
      store.consumeScopeReceipt({
        deviceId: device.deviceId,
        scopeReceipt: verifiedScope.scopeReceipt,
        configDigest: 'a'.repeat(64),
        now: requestNow,
      }),
      true,
    )
    assert.equal(
      store.consumeScopeReceipt({
        deviceId: device.deviceId,
        scopeReceipt: parallelScope.scopeReceipt,
        configDigest: 'a'.repeat(64),
        now: requestNow,
      }),
      true,
    )
    const rejectedChallenge = store.issueScopeChallenge({
      deviceId: device.deviceId,
      now: requestNow,
    })
    assert.throws(
      () => store.verifyScopeProof({
        deviceId: device.deviceId,
        challengeId: rejectedChallenge.challengeId,
        proof: trustedDeviceScopeProof({
          hotelCode: '001',
          deviceId: device.deviceId,
          challenge: rejectedChallenge.value,
          pmsLoginHotelId: '1001002',
          scopeProofKey: device.scopeProofKey,
        }),
        expectedPmsLoginHotelId: '1001001',
        configDigest: 'a'.repeat(64),
        now: requestNow,
      }),
      /TRUSTED_DEVICE_STORE_SCOPE_INVALID/u,
    )

    const snapshot = minimalSnapshot(requestNow)
    assert.equal(
      store.acceptSnapshot({
        deviceId: device.deviceId,
        snapshot: { ...snapshot, completeness: 'PARTIAL' },
        now: requestNow,
      })
        .lastCompleteness,
      'PARTIAL',
    )
    assert.equal(store.status().device.cutoverReady, false)
    assert.throws(
      () => store.beginCutover({
        deviceId: device.deviceId,
        snapshot,
        snapshotHash: 'b'.repeat(64),
        now: requestNow,
      }),
      /TRUSTED_DEVICE_SCOPE_APPROVAL_REQUIRED/u,
    )
    store.approveStoreScope({ now: requestNow })
    const snapshotHash = 'b'.repeat(64)
    store.beginCutover({
      deviceId: device.deviceId,
      snapshot,
      snapshotHash,
      now: requestNow,
    })
    store.acceptSnapshot({ deviceId: device.deviceId, snapshot, now: requestNow })
    store.completeCutover({
      deviceId: device.deviceId,
      collectionRunId: snapshot.collectionRunId,
      snapshotHash,
      now: requestNow,
    })
    assert.equal(store.status().device.cutoverReady, true)
    const cutoverAt = store.status().device.cutoverAt
    store.acceptSnapshot({
      deviceId: device.deviceId,
      snapshot: { ...snapshot, completeness: 'PARTIAL' },
      now: new Date(requestNow.getTime() + 1_000),
    })
    assert.equal(store.status().device.cutoverAt, cutoverAt)
    assert.throws(
      () => store.acceptSnapshot({
        deviceId: device.deviceId,
        snapshot: { ...snapshot, cookie: 'must-not-pass' },
        now: requestNow,
      }),
      /TRUSTED_DEVICE_SNAPSHOT_INVALID/u,
    )
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('trusted-device canonical JSON rejects non-finite number aliases', () => {
  assert.throws(
    () => stableJson({ value: Number.POSITIVE_INFINITY }),
    /TRUSTED_DEVICE_BODY_NUMBER_INVALID/u,
  )
  assert.notEqual(stableJson({ value: null }), stableJson({ value: 1 }))
})

test('trusted-device COMPLETE requires exact configured business payload', () => {
  const now = new Date()
  const snapshot = minimalSnapshot(now)
  const contracts = snapshot.sources.map(({ sourceId, sourceCode, reportType }) => ({
    sourceId, sourceCode, reportType,
  }))
  assert.throws(
    () => validateTrustedDeviceSnapshot({
      snapshot: {
        ...snapshot,
        dailyOrderSummary: {
          ...snapshot.dailyOrderSummary,
          businessDate: '2020-01-01',
        },
      },
      hotel,
      requiredSourceContracts: contracts,
      now,
    }),
    /TRUSTED_DEVICE_SNAPSHOT_ORDER_SUMMARY_INVALID/u,
  )
  assert.throws(
    () => validateTrustedDeviceSnapshot({
      snapshot: { ...snapshot, physicalInventory: [] },
      hotel,
      requiredSourceContracts: contracts,
      now,
    }),
    /TRUSTED_DEVICE_COMPLETE_SNAPSHOT_INVALID/u,
  )
  assert.throws(
    () => validateTrustedDeviceSnapshot({
      snapshot: {
        ...snapshot,
        sources: snapshot.sources.map((source, index) => index === 0
          ? { ...source, sourceCode: 'REPORT_REVENUE_FORGED' }
          : source),
      },
      hotel,
      requiredSourceContracts: contracts,
      now,
    }),
    /TRUSTED_DEVICE_SNAPSHOT_CONFIG_MISMATCH/u,
  )
  assert.throws(
    () => validateTrustedDeviceSnapshot({
      snapshot: {
        ...snapshot,
        physicalInventory: [{
          ...snapshot.physicalInventory[0],
          guest: 'synthetic-person-marker',
        }],
      },
      hotel,
      now,
    }),
    /TRUSTED_DEVICE_SNAPSHOT_INVENTORY_INVALID/u,
  )
})

test('revoke atomically cancels an unconsumed enrollment', async () => {
  const root = await mkdtemp(join(os.tmpdir(), 'trusted-device-revoke-'))
  try {
    const store = createStore({ path: join(root, 'registry.json') })
    const enrollment = store.createEnrollment()
    assert.equal(store.status().enrollmentPending, true)
    store.revoke()
    assert.equal(store.status().enrollmentPending, false)
    const { publicKey } = generateKeyPairSync('ed25519')
    assert.throws(
      () => store.enroll({
        hotelCode: hotel.hotelCode,
        enrollmentCode: enrollment.enrollmentCode,
        publicKeyPem: publicKey.export({ format: 'pem', type: 'spki' }).toString(),
      }),
      /TRUSTED_DEVICE_ENROLLMENT_INVALID/u,
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
    const store001 = createStore({
      path: join(root, '001.json'),
    })
    const store003 = createStore({
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
