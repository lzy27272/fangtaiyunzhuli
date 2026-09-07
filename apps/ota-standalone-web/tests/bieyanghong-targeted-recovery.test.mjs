import assert from 'node:assert/strict'
import test from 'node:test'

import {
  normalizeBieyanghongRecoveryRequest,
  recoveryDeliveryDecision,
  resolveBieyanghongRecoveryTargets,
  safeBieyanghongRecoveryReason,
} from '../../../tools/uat/bieyanghong-targeted-recovery.mjs'

const readyHotel = (overrides = {}) => ({
  hotelId: 'hotel-003',
  hotelCode: '003',
  pmsSystemCode: 'MEITUAN_BIEYANGHONG',
  collectionEnabled: true,
  cookieConfigured: true,
  messageEnabled: false,
  weComEnabled: true,
  weComWebhookConfigured: true,
  ...overrides,
})

test('targeted recovery includes all three server-Cookie hotels', () => {
  const request = normalizeBieyanghongRecoveryRequest({
    operationKey: 'COOKIE_RECOVERY_20260904_001_003_013',
    hotelCodes: ['003', '001', '013'],
  })
  assert.deepEqual(request.hotelCodes, ['001', '003', '013'])
  assert.deepEqual(
    resolveBieyanghongRecoveryTargets({
      hotels: [
        readyHotel({ hotelId: 'hotel-001', hotelCode: '001' }),
        readyHotel(),
        readyHotel({ hotelId: 'hotel-013', hotelCode: '013' }),
      ],
      hotelCodes: request.hotelCodes,
    }).map((hotel) => hotel.hotelCode),
    ['001', '003', '013'],
  )
})

test('targeted recovery preflight accepts only ready Bieyanghong hotels', () => {
  const hotels = [
    readyHotel(),
    readyHotel({ hotelId: 'hotel-013', hotelCode: '013' }),
    readyHotel({
      hotelId: 'hotel-010',
      hotelCode: '010',
      pmsSystemCode: 'LUOPAN_CLOUD',
    }),
  ]
  const request = normalizeBieyanghongRecoveryRequest({
    operationKey: 'COOKIE_RECOVERY_20260829_003_013',
    hotelCodes: ['013', '003'],
  })
  assert.deepEqual(request.hotelCodes, ['003', '013'])
  assert.deepEqual(
    resolveBieyanghongRecoveryTargets({ hotels, hotelCodes: request.hotelCodes })
      .map((hotel) => hotel.hotelCode),
    ['003', '013'],
  )
  assert.throws(
    () => resolveBieyanghongRecoveryTargets({
      hotels,
      hotelCodes: ['003', '010'],
    }),
    /BIEYANGHONG_RECOVERY_SCOPE_INVALID/u,
  )
})

test('targeted recovery preflight fails closed for missing Cookie or WeCom', () => {
  for (const hotel of [
    readyHotel({ cookieConfigured: false }),
    readyHotel({ weComWebhookConfigured: false }),
  ]) {
    assert.throws(() => resolveBieyanghongRecoveryTargets({
      hotels: [hotel],
      hotelCodes: ['003'],
    }))
  }
})

test('existing uncertain or rejected delivery is never automatically resent', () => {
  assert.equal(
    recoveryDeliveryDecision({ deliveryStatus: 'DELIVERED' }),
    'ALREADY_DELIVERED',
  )
  assert.equal(
    recoveryDeliveryDecision({ deliveryStatus: 'AMBIGUOUS' }),
    'MANUAL_RECONCILIATION_REQUIRED',
  )
  assert.equal(
    recoveryDeliveryDecision({ deliveryStatus: 'SENDING' }),
    'MANUAL_RECONCILIATION_REQUIRED',
  )
  assert.equal(
    recoveryDeliveryDecision({ deliveryStatus: 'REJECTED' }),
    'REJECTED_NO_AUTOMATIC_RETRY',
  )
  assert.equal(recoveryDeliveryDecision(null), 'SEND_MISSING')
})

test('unsafe upstream errors are not exposed by recovery response', () => {
  assert.equal(
    safeBieyanghongRecoveryReason(new Error('PMS_SESSION_REAUTH_REQUIRED')),
    'PMS_SESSION_REAUTH_REQUIRED',
  )
  assert.equal(
    safeBieyanghongRecoveryReason(new Error('Cookie=private-value')),
    'BIEYANGHONG_RECOVERY_FAILED_CLOSED',
  )
})
