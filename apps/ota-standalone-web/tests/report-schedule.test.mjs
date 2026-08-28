import assert from 'node:assert/strict'
import test from 'node:test'
import {
  briefingCycleSnapshots,
  briefingCycleStart,
  briefingSnapshotsObservedAfter,
  collectionSlotFor,
  isBriefDeliveryTime,
  isBroadcastWindowOpen,
  isScheduledBriefSnapshot,
  reportScheduleFor,
} from '../../../tools/uat/report-schedule.mjs'

const localDate = (value) => new Date(`${value}+08:00`)

test('July and August collect hourly from 08:00 through the final 01:00 slot', () => {
  assert.equal(collectionSlotFor(localDate('2026-07-28T07:59:00')), null)
  assert.equal(
    collectionSlotFor(localDate('2026-07-28T08:00:00')).slotKey,
    '2026-07-28T08:00',
  )
  assert.equal(collectionSlotFor(localDate('2026-07-28T08:30:00')), null)
  assert.equal(
    collectionSlotFor(localDate('2026-07-29T01:00:00')).slotKey,
    '2026-07-29T01:00',
  )
  assert.equal(collectionSlotFor(localDate('2026-07-29T01:30:00')), null)
  assert.equal(collectionSlotFor(localDate('2026-07-29T02:00:00')), null)
})

test('official holidays and the preceding day use the peak hourly profile', () => {
  assert.equal(
    reportScheduleFor(localDate('2026-09-23T12:00:00')).profile,
    'STANDARD_MIXED',
  )
  assert.equal(
    reportScheduleFor(localDate('2026-09-24T12:00:00')).profile,
    'PEAK_HOURLY',
  )
  assert.equal(
    reportScheduleFor(localDate('2026-09-25T12:00:00')).profile,
    'PEAK_HOURLY',
  )
  assert.equal(
    collectionSlotFor(localDate('2026-09-24T08:00:00')).slotKey,
    '2026-09-24T08:00',
  )
})

test('ordinary dates collect at 09:00, 11:00, 13:00 and hourly after 14:00', () => {
  assert.equal(collectionSlotFor(localDate('2026-09-10T08:00:00')), null)
  assert.equal(
    collectionSlotFor(localDate('2026-09-10T09:00:00')).slotKey,
    '2026-09-10T09:00',
  )
  assert.equal(collectionSlotFor(localDate('2026-09-10T10:00:00')), null)
  assert.equal(
    collectionSlotFor(localDate('2026-09-10T11:00:00')).slotKey,
    '2026-09-10T11:00',
  )
  assert.equal(collectionSlotFor(localDate('2026-09-10T12:00:00')), null)
  assert.equal(
    collectionSlotFor(localDate('2026-09-10T13:00:00')).slotKey,
    '2026-09-10T13:00',
  )
  assert.equal(
    collectionSlotFor(localDate('2026-09-10T14:00:00')).slotKey,
    '2026-09-10T14:00',
  )
  assert.equal(
    collectionSlotFor(localDate('2026-09-11T01:00:00')).slotKey,
    '2026-09-11T01:00',
  )
  assert.equal(collectionSlotFor(localDate('2026-09-11T02:00:00')), null)
})

test('delivery follows each scheduled collection and closes after 01:15', () => {
  assert.equal(
    isBriefDeliveryTime(localDate('2026-07-29T01:06:00'), 6),
    true,
  )
  assert.equal(
    isBroadcastWindowOpen(localDate('2026-07-29T01:16:00')),
    false,
  )
  assert.equal(
    isBriefDeliveryTime(localDate('2026-07-29T07:59:00'), 6),
    false,
  )
  assert.equal(
    isBriefDeliveryTime(localDate('2026-07-29T08:06:00'), 6),
    true,
  )
  assert.equal(
    isBriefDeliveryTime(localDate('2026-09-10T08:06:00'), 6),
    false,
  )
  assert.equal(
    isBriefDeliveryTime(localDate('2026-09-10T09:06:00'), 6),
    true,
  )
  assert.equal(
    isBriefDeliveryTime(localDate('2026-09-10T10:06:00'), 6),
    false,
  )
  assert.equal(
    isBriefDeliveryTime(localDate('2026-09-10T14:08:00'), 8),
    true,
  )
})

test('briefing cycles start at 08:00 for peak dates and 09:00 otherwise', () => {
  const peakNow = localDate('2026-07-29T08:06:00')
  assert.equal(briefingCycleStart(peakNow), '2026-07-29T08:00:00+08:00')
  const peakSelected = briefingCycleSnapshots([
    { observedAt: '2026-07-29T01:00:00+08:00' },
    { observedAt: '2026-07-29T03:00:00+08:00' },
    { observedAt: '2026-07-29T08:00:00+08:00' },
  ], peakNow)
  assert.deepEqual(
    peakSelected.map((snapshot) => snapshot.observedAt),
    ['2026-07-29T08:00:00+08:00'],
  )
  assert.equal(
    briefingCycleStart(localDate('2026-07-29T01:00:00')),
    '2026-07-28T08:00:00+08:00',
  )

  const ordinaryNow = localDate('2026-09-10T09:06:00')
  assert.equal(
    briefingCycleStart(ordinaryNow),
    '2026-09-10T09:00:00+08:00',
  )
  assert.deepEqual(
    briefingCycleSnapshots([
      { observedAt: '2026-09-10T08:00:00+08:00' },
      { observedAt: '2026-09-10T09:00:00+08:00' },
      { observedAt: '2026-09-10T10:00:00+08:00' },
    ], ordinaryNow).map((snapshot) => snapshot.observedAt),
    ['2026-09-10T09:00:00+08:00'],
  )
})

test('only snapshots from configured collection slots are broadcast candidates', () => {
  assert.equal(
    isScheduledBriefSnapshot({
      observedAt: '2026-09-10T09:00:00+08:00',
    }),
    true,
  )
  assert.equal(
    isScheduledBriefSnapshot({
      observedAt: '2026-09-10T10:00:00+08:00',
    }),
    false,
  )
  assert.equal(
    isScheduledBriefSnapshot({
      observedAt: '2026-07-29T08:30:00+08:00',
    }),
    false,
  )
})

test('service restart does not replay briefing snapshots observed before startup', () => {
  const selected = briefingSnapshotsObservedAfter([
    { observedAt: '2026-07-29T08:00:00+08:00' },
    { observedAt: '2026-07-29T09:00:00+08:00' },
    { observedAt: 'invalid' },
  ], '2026-07-29T09:00:00+08:00')
  assert.deepEqual(
    selected.map((snapshot) => snapshot.observedAt),
    ['2026-07-29T09:00:00+08:00'],
  )
  assert.deepEqual(
    briefingSnapshotsObservedAfter(
      [{ observedAt: '2026-07-29T09:00:00+08:00' }],
      'invalid',
    ),
    [],
  )
})
