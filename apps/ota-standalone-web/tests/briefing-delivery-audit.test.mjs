import assert from 'node:assert/strict'
import test from 'node:test'

import {
  auditBriefingStore,
  auditLuopanBriefingStore,
  dailyBriefingAuditSlot,
  dailyBriefingRepairSlot,
  isNightlyRepairDeferred,
} from '../../../tools/uat/wecom/src/briefing-delivery-audit.mjs'

const hotel = {
  hotelId: 'hotel-002',
  hotelCode: '002',
  pmsSystemCode: 'LUOPAN_CLOUD',
}
const snapshot = {
  observedAt: '2026-08-04T01:00:10+08:00',
}
const customSchedule = (overrides = {}) => ({
  enabled: true,
  webhookConfigured: true,
  broadcastScheduleMode: 'CUSTOM_V1',
  broadcastStartHour: 9,
  broadcastQuietHour: 2,
  broadcastIntervalHours: 3,
  ...overrides,
})
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

test('daily audit runs once in the 01:20 grace window', () => {
  assert.equal(
    dailyBriefingAuditSlot(new Date('2026-08-03T17:19:00Z')),
    null,
  )
  assert.equal(
    dailyBriefingAuditSlot(new Date('2026-08-03T17:20:00Z')).auditKey,
    '2026-08-04:01:20',
  )
  assert.equal(
    dailyBriefingAuditSlot(new Date('2026-08-03T17:26:00Z')),
    null,
  )
})

test('custom schedule audits its final due broadcast hour instead of 01:00', () => {
  const config = customSchedule()
  assert.equal(
    dailyBriefingAuditSlot(
      new Date('2026-09-10T16:20:00Z'),
      config,
    ).snapshotHourKey,
    '2026-09-11T00',
  )
  assert.equal(
    dailyBriefingAuditSlot(
      new Date('2026-09-10T17:20:00Z'),
      config,
    ),
    null,
  )

  const customSnapshot = {
    observedAt: '2026-09-11T00:00:10+08:00',
  }
  const result = auditBriefingStore({
    hotel,
    weComConfig: config,
    snapshots: [customSnapshot],
    deliveries: [
      delivery('TODAY_REVENUE', { cutoffAt: customSnapshot.observedAt }),
      delivery('FUTURE_14D', { cutoffAt: customSnapshot.observedAt }),
    ],
    date: new Date('2026-09-10T16:20:00Z'),
    snapshotHourKey: '2026-09-11T00',
  })
  assert.equal(result.status, 'HEALTHY')
  assert.equal(result.snapshotObservedAt, customSnapshot.observedAt)
})

test('custom repair maps 07:30 to the latest completed schedule audit', () => {
  const sameDay = dailyBriefingRepairSlot(
    new Date('2026-09-10T23:30:00Z'),
    customSchedule(),
  )
  assert.equal(sameDay.auditKey, '2026-09-11:00:20')
  assert.equal(sameDay.snapshotHourKey, '2026-09-11T00')

  const previousDay = dailyBriefingRepairSlot(
    new Date('2026-09-10T23:30:00Z'),
    customSchedule({
      broadcastQuietHour: 22,
      broadcastIntervalHours: 4,
    }),
  )
  assert.equal(previousDay.auditKey, '2026-09-10:21:20')
  assert.equal(previousDay.snapshotHourKey, '2026-09-10T21')
})

test('an intentionally paused custom schedule needs no delivery repair', () => {
  const paused = customSchedule({
    enabled: false,
    broadcastIntervalHours: 0,
  })
  assert.equal(
    auditBriefingStore({
      hotel,
      weComConfig: paused,
      snapshots: [],
      deliveries: [],
      date: new Date('2026-09-10T17:20:00Z'),
    }).status,
    'NOT_REQUIRED',
  )
})

test('a newly saved custom schedule does not audit a pre-effective slot', () => {
  const input = {
    hotel,
    snapshots: [],
    deliveries: [],
    date: new Date('2026-09-10T16:20:00Z'),
    snapshotHourKey: '2026-09-11T00',
  }
  assert.equal(
    auditBriefingStore({
      ...input,
      weComConfig: customSchedule({
        broadcastScheduleEffectiveAt: '2026-09-11T00:03:00+08:00',
      }),
    }).status,
    'NOT_REQUIRED',
  )
  assert.equal(
    auditBriefingStore({
      ...input,
      weComConfig: customSchedule({
        broadcastScheduleEffectiveAt: '2026-09-11T00:00:00+08:00',
      }),
    }).status,
    'COLLECTION_MISSING',
  )
})

test('morning repair runs once in the 07:30 grace window', () => {
  assert.equal(
    dailyBriefingRepairSlot(new Date('2026-08-03T23:29:00Z')),
    null,
  )
  assert.equal(
    dailyBriefingRepairSlot(new Date('2026-08-03T23:30:00Z')).repairKey,
    '2026-08-04:07:30',
  )
  assert.equal(
    dailyBriefingRepairSlot(new Date('2026-08-03T23:36:00Z')),
    null,
  )
})

test('defers automatic login repair overnight until 07:30', () => {
  assert.equal(
    isNightlyRepairDeferred(new Date('2026-08-03T16:30:00Z')),
    true,
  )
  assert.equal(
    isNightlyRepairDeferred(new Date('2026-08-03T17:00:00Z')),
    true,
  )
  assert.equal(
    isNightlyRepairDeferred(new Date('2026-08-03T23:29:59Z')),
    true,
  )
  assert.equal(
    isNightlyRepairDeferred(new Date('2026-08-03T23:30:00Z')),
    false,
  )
  assert.equal(
    isNightlyRepairDeferred(new Date('2026-08-04T06:00:00Z')),
    false,
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
    date: new Date('2026-08-03T17:20:00Z'),
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
    date: new Date('2026-08-03T17:20:00Z'),
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
    date: new Date('2026-08-03T17:20:00Z'),
  })
  assert.equal(result.status, 'REAUTH_REQUIRED')
})

test('audits non-Luopan hotels and classifies disabled chains', () => {
  const regularHotel = {
    hotelId: 'hotel-013',
    hotelCode: '013',
    pmsSystemCode: 'MEITUAN_BIEYANGHONG',
    collectionEnabled: true,
  }
  const healthy = auditBriefingStore({
    hotel: regularHotel,
    weComConfig: { enabled: true, webhookConfigured: true },
    snapshots: [{ ...snapshot }],
    deliveries: [
      { ...delivery('TODAY_REVENUE'), hotelId: regularHotel.hotelId },
      { ...delivery('FUTURE_14D'), hotelId: regularHotel.hotelId },
    ],
    date: new Date('2026-08-03T17:20:00Z'),
  })
  assert.equal(healthy.status, 'HEALTHY')

  assert.equal(
    auditBriefingStore({
      hotel: { ...regularHotel, collectionEnabled: false },
      date: new Date('2026-08-03T17:20:00Z'),
    }).status,
    'COLLECTION_DISABLED',
  )
  assert.equal(
    auditBriefingStore({
      hotel: regularHotel,
      weComConfig: { enabled: false, webhookConfigured: true },
      date: new Date('2026-08-03T17:20:00Z'),
    }).status,
    'DELIVERY_DISABLED',
  )
})
