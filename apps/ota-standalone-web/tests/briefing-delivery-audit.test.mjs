import assert from 'node:assert/strict'
import test from 'node:test'

import {
  auditLuopanBriefingStore,
  dailyBriefingAuditSlot,
} from '../../../tools/uat/wecom/src/briefing-delivery-audit.mjs'

const hotel = {
  hotelId: 'hotel-002',
  hotelCode: '002',
  pmsSystemCode: 'LUOPAN_CLOUD',
}
const snapshot = {
  observedAt: '2026-08-04T08:00:10+08:00',
}
const delivery = (deliveryType, overrides = {}) => ({
  hotelId: hotel.hotelId,
  cutoffAt: snapshot.observedAt,
  deliveryType,
  deliveryStatus: 'DELIVERED',
  partCount: 1,
  deliveredPartCount: 1,
  completedAt: '2026-08-04T00:08:00Z',
  ...overrides,
})

test('daily audit runs once in the 08:15 grace window', () => {
  assert.equal(
    dailyBriefingAuditSlot(new Date('2026-08-04T00:14:00Z')),
    null,
  )
  assert.equal(
    dailyBriefingAuditSlot(new Date('2026-08-04T00:15:00Z')).auditKey,
    '2026-08-04:08:15',
  )
  assert.equal(
    dailyBriefingAuditSlot(new Date('2026-08-04T00:21:00Z')),
    null,
  )
})

test('requires persisted complete delivery records for both briefing types', () => {
  const healthy = auditLuopanBriefingStore({
    hotel,
    luopanConfig: {},
    snapshots: [snapshot],
    deliveries: [
      delivery('TODAY_REVENUE'),
      delivery('FUTURE_14D'),
    ],
    date: new Date('2026-08-04T00:15:00Z'),
  })
  assert.equal(healthy.status, 'HEALTHY')

  const partial = auditLuopanBriefingStore({
    hotel,
    luopanConfig: {},
    snapshots: [snapshot],
    deliveries: [
      delivery('TODAY_REVENUE'),
      delivery('FUTURE_14D', { deliveredPartCount: 0 }),
    ],
    date: new Date('2026-08-04T00:15:00Z'),
  })
  assert.equal(partial.status, 'DELIVERY_MISSING')
  assert.equal(partial.todayRevenueDelivered, true)
  assert.equal(partial.future14dDelivered, false)
})

test('classifies reauthentication before missing collection', () => {
  const result = auditLuopanBriefingStore({
    hotel,
    luopanConfig: { lastErrorCode: 'LUOPAN_REAUTH_REQUIRED' },
    snapshots: [],
    deliveries: [],
    date: new Date('2026-08-04T00:15:00Z'),
  })
  assert.equal(result.status, 'REAUTH_REQUIRED')
})
