import assert from 'node:assert/strict'
import test from 'node:test'
import {
  selectHourlyDeliveryCandidates,
} from '../../../tools/uat/wecom/src/hourly-delivery-candidates.mjs'

const snapshot = (observedAt, completeness, businessDate = '2026-07-25') => ({
  collectionRunId: `${observedAt}:${completeness}`,
  observedAt,
  completeness,
  businessDate,
})

test('one hourly delivery selects the complete retry instead of the earliest failure', () => {
  const candidates = selectHourlyDeliveryCandidates({
    hotelId: 'hotel-001',
    snapshots: [
      snapshot('2026-07-26T02:00:10+08:00', 'UNAVAILABLE'),
      snapshot('2026-07-26T02:02:10+08:00', 'COMPLETE'),
      snapshot('2026-07-26T02:05:10+08:00', 'PARTIAL'),
    ],
  })
  assert.equal(candidates.length, 1)
  assert.equal(candidates[0].snapshot.completeness, 'COMPLETE')
  assert.equal(candidates[0].snapshot.observedAt, '2026-07-26T02:02:10+08:00')
})

test('same completeness selects the latest retry and ignores late snapshots', () => {
  const candidates = selectHourlyDeliveryCandidates({
    hotelId: 'hotel-001',
    snapshots: [
      snapshot('2026-07-26T03:01:10+08:00', 'PARTIAL'),
      snapshot('2026-07-26T03:04:10+08:00', 'PARTIAL'),
      snapshot('2026-07-26T03:06:10+08:00', 'COMPLETE'),
    ],
  })
  assert.equal(candidates.length, 1)
  assert.equal(candidates[0].snapshot.observedAt, '2026-07-26T03:04:10+08:00')
})

test('delivered hours stay excluded and the backlog remains chronological', () => {
  const deliveredKey =
    'hotel-001:2026-07-25:2026-07-26T01:HOURLY_UAT_V1'
  const candidates = selectHourlyDeliveryCandidates({
    hotelId: 'hotel-001',
    snapshots: [
      snapshot('2026-07-26T02:02:10+08:00', 'COMPLETE'),
      snapshot('2026-07-26T01:02:10+08:00', 'COMPLETE'),
      snapshot('2026-07-26T03:02:10+08:00', 'COMPLETE'),
    ],
    deliveredMessageKeys: new Set([deliveredKey]),
    limit: 1,
  })
  assert.equal(candidates.length, 1)
  assert.equal(candidates[0].snapshotHour, '2026-07-26T02')
})

test('one clock hour cannot produce two briefs across a PMS day switch', () => {
  const candidates = selectHourlyDeliveryCandidates({
    hotelId: 'hotel-001',
    snapshots: [
      snapshot('2026-07-26T06:00:10+08:00', 'COMPLETE', '2026-07-25'),
      snapshot('2026-07-26T06:04:10+08:00', 'PARTIAL', '2026-07-26'),
    ],
    businessDayControl: {
      businessDate: '2026-07-26',
      businessDateStartedAt: '2026-07-26T03:20:10+08:00',
    },
  })

  assert.equal(candidates.length, 1)
  assert.equal(candidates[0].snapshot.businessDate, '2026-07-26')
  assert.equal(
    candidates[0].messageKey,
    'hotel-001:2026-07-26:2026-07-26T06:HOURLY_UAT_V1',
  )

  const afterOldDayWasDelivered = selectHourlyDeliveryCandidates({
    hotelId: 'hotel-001',
    snapshots: candidates.map((candidate) => candidate.snapshot),
    deliveredMessageKeys: new Set([
      'hotel-001:2026-07-25:2026-07-26T06:HOURLY_UAT_V1',
    ]),
  })
  assert.equal(afterOldDayWasDelivered.length, 0)
})

test('stale snapshots after night audit are never backfilled', () => {
  const candidates = selectHourlyDeliveryCandidates({
    hotelId: 'hotel-001',
    snapshots: [
      snapshot('2026-07-26T03:00:10+08:00', 'COMPLETE', '2026-07-25'),
      snapshot('2026-07-26T04:00:10+08:00', 'COMPLETE', '2026-07-25'),
    ],
    businessDayControl: {
      businessDate: '2026-07-26',
      businessDateStartedAt: '2026-07-26T03:20:10+08:00',
    },
  })

  assert.equal(candidates.length, 1)
  assert.equal(candidates[0].snapshotHour, '2026-07-26T03')
  assert.equal(candidates[0].snapshot.businessDate, '2026-07-25')
})

test('future and today briefs keep independent hourly delivery slots', () => {
  const source = snapshot(
    '2026-07-26T13:02:10+08:00',
    'COMPLETE',
    '2026-07-26',
  )
  const deliveredToday =
    'hotel-001:2026-07-26:2026-07-26T13:HOURLY_UAT_V1'
  const futureCandidates = selectHourlyDeliveryCandidates({
    hotelId: 'hotel-001',
    snapshots: [source],
    deliveredMessageKeys: new Set([deliveredToday]),
    messageKeySuffix: 'FUTURE_14D_V1',
  })

  assert.equal(futureCandidates.length, 1)
  assert.equal(
    futureCandidates[0].messageKey,
    'hotel-001:2026-07-26:2026-07-26T13:FUTURE_14D_V1',
  )
})
