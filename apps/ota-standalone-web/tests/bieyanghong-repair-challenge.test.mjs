import assert from 'node:assert/strict'
import test from 'node:test'

import {
  bieyanghongRepairLink,
  createBieyanghongRepairChallengeStore,
  validateBieyanghongRepairPublicBaseUrl,
} from '../../../tools/uat/bieyanghong-repair-challenge.mjs'

test('creates a fragment-only 001 repair link and stores only a token hash', () => {
  const store = createBieyanghongRepairChallengeStore({
    now: () => new Date('2026-08-29T00:15:00Z'),
    tokenBytes: () => Buffer.alloc(32, 8),
  })
  const created = store.create({
    hotelId: 'hotel-001',
    hotelCode: '001',
    hotelName: '示例别样红门店',
  })
  const link = bieyanghongRepairLink('https://ota.example.com', created.token)

  assert.equal(
    link,
    `https://ota.example.com/api/v1/bieyanghong-repair#${created.token}`,
  )
  const snapshot = JSON.stringify(store.debugSnapshot())
  assert.equal(snapshot.includes(created.token), false)
  assert.match(snapshot, /"tokenSha256":"[a-f0-9]{64}"/u)
})

test('accepts a transient manager phone and SMS code without retaining them', () => {
  const store = createBieyanghongRepairChallengeStore({
    now: () => new Date('2026-08-29T00:15:00Z'),
    tokenBytes: () => Buffer.alloc(32, 9),
  })
  const created = store.create({
    hotelId: 'hotel-001',
    hotelCode: '001',
    hotelName: '示例别样红门店',
  })
  store.setWaitingForCredentials(created.tokenSha256)
  const requested = store.requestCode(created.token, {
    phone: '13800138000',
  })
  assert.equal(requested.record.status, 'REQUESTING_CODE')
  assert.equal(requested.record.credentialRequestsUsed, 1)
  const credentialSnapshot = JSON.stringify(store.debugSnapshot())
  assert.equal(credentialSnapshot.includes('13800138000'), false)
  assert.deepEqual(requested.credentials, { phone: '13800138000' })
  const interactive = store.setWaitingForInteractiveVerification(
    created.tokenSha256,
    'BIEYANGHONG_LOGIN_RISK_CHALLENGE_REQUIRED',
  )
  assert.equal(interactive.status, 'WAITING_FOR_INTERACTIVE_VERIFICATION')
  assert.equal(
    interactive.reasonCode,
    'BIEYANGHONG_LOGIN_RISK_CHALLENGE_REQUIRED',
  )
  assert.equal(store.getInternal(created.token).hotelId, 'hotel-001')
  store.markVerifying(created.tokenSha256)
  store.setWaitingForCode(created.tokenSha256)
  const submitted = store.submit(created.token, '123456')
  assert.equal(submitted.record.attemptsUsed, 1)
  assert.equal(JSON.stringify(store.debugSnapshot()).includes('123456'), false)
  assert.throws(
    () => store.submit(created.token, '12ab'),
    /BIEYANGHONG_REPAIR_CHALLENGE_NOT_READY/u,
  )
})

test('expires after ten minutes and rejects unsafe public URLs', () => {
  let current = new Date('2026-08-29T00:15:00Z')
  const store = createBieyanghongRepairChallengeStore({
    now: () => current,
    tokenBytes: () => Buffer.alloc(32, 7),
  })
  const created = store.create({
    hotelId: 'hotel-001',
    hotelCode: '001',
    hotelName: '示例别样红门店',
  })
  store.setWaitingForCredentials(created.tokenSha256)
  current = new Date('2026-08-29T00:25:00Z')
  assert.equal(store.get(created.token).status, 'EXPIRED')

  assert.equal(
    validateBieyanghongRepairPublicBaseUrl('https://ota.example.com/'),
    'https://ota.example.com',
  )
  for (const value of [
    'http://ota.example.com',
    'https://127.0.0.1',
    'https://ota.example.com:8443',
    'https://ota.example.com/path',
  ]) {
    assert.throws(
      () => validateBieyanghongRepairPublicBaseUrl(value),
      /BIEYANGHONG_REPAIR_PUBLIC_URL_INVALID/u,
    )
  }
})
