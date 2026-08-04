import assert from 'node:assert/strict'
import test from 'node:test'

import {
  createLuopanRepairChallengeStore,
  luopanRepairLink,
  validateLuopanRepairPublicBaseUrl,
} from '../../../tools/uat/luopan-repair-challenge.mjs'

const captchaImage = () => Buffer.alloc(128, 7)

test('creates a fragment-only repair link and stores only a token hash', () => {
  const store = createLuopanRepairChallengeStore({
    now: () => new Date('2026-08-04T00:15:00Z'),
    tokenBytes: () => Buffer.alloc(32, 3),
  })
  const created = store.create({
    hotelId: 'hotel-002',
    hotelCode: '002',
    hotelName: '示例罗盘门店',
  })
  const link = luopanRepairLink('https://ota.example.com', created.token)

  assert.equal(
    link,
    `https://ota.example.com/api/v1/luopan-repair#${created.token}`,
  )
  const snapshot = JSON.stringify(store.debugSnapshot())
  assert.equal(snapshot.includes(created.token), false)
  assert.match(snapshot, /"tokenSha256":"[a-f0-9]{64}"/u)
})

test('accepts up to three bounded answers and never retains submitted values', () => {
  const store = createLuopanRepairChallengeStore({
    now: () => new Date('2026-08-04T00:15:00Z'),
    tokenBytes: () => Buffer.alloc(32, 4),
  })
  const created = store.create({
    hotelId: 'hotel-004',
    hotelCode: '004',
    hotelName: '示例门店',
  })
  store.setWaiting(created.tokenSha256, captchaImage())
  const first = store.submit(created.token, 'a1B2')
  assert.equal(first.record.attemptsUsed, 1)
  assert.equal(JSON.stringify(store.debugSnapshot()).includes('a1B2'), false)

  store.setWaiting(created.tokenSha256, captchaImage(), 'CAPTCHA_REJECTED')
  store.submit(created.token, 'c3D4')
  store.setWaiting(created.tokenSha256, captchaImage(), 'CAPTCHA_REJECTED')
  const third = store.submit(created.token, 'e5F6')
  assert.equal(third.record.attemptsRemaining, 0)
  assert.throws(
    () => store.setWaiting(created.tokenSha256, captchaImage()),
    /LUOPAN_REPAIR_CHALLENGE_CLOSED/u,
  )
})

test('expires a challenge after ten minutes and removes its captcha', () => {
  let current = new Date('2026-08-04T00:15:00Z')
  const store = createLuopanRepairChallengeStore({
    now: () => current,
    tokenBytes: () => Buffer.alloc(32, 5),
  })
  const created = store.create({
    hotelId: 'hotel-005',
    hotelCode: '005',
    hotelName: '示例门店',
  })
  store.setWaiting(created.tokenSha256, captchaImage())
  assert.equal(store.captcha(created.token).length, 128)

  current = new Date('2026-08-04T00:25:00Z')
  assert.equal(store.get(created.token).status, 'EXPIRED')
  assert.equal(store.captcha(created.token), null)
  assert.throws(
    () => store.submit(created.token, 'a1B2'),
    /LUOPAN_REPAIR_CHALLENGE_NOT_READY/u,
  )
})

test('rejects unsafe public URLs', () => {
  assert.equal(
    validateLuopanRepairPublicBaseUrl('https://ota.example.com/'),
    'https://ota.example.com',
  )
  for (const value of [
    'http://ota.example.com',
    'https://127.0.0.1',
    'https://ota.example.com:8443',
    'https://ota.example.com/path',
    'https://user@example.com',
  ]) {
    assert.throws(
      () => validateLuopanRepairPublicBaseUrl(value),
      /LUOPAN_REPAIR_PUBLIC_URL_INVALID/u,
    )
  }
})
