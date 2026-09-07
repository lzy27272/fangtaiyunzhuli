import assert from 'node:assert/strict'
import test from 'node:test'
import {
  briefingCycleSnapshots,
  briefingCycleSnapshotsForConfig,
  briefingCycleStart,
  briefingSnapshotsObservedAfter,
  collectionSlotFor,
  isBriefDeliveryTime,
  isBriefDeliveryTimeForConfig,
  isBroadcastWindowOpen,
  isBroadcastWindowOpenForConfig,
  isScheduledBriefSnapshot,
  pmsCollectionSlotFor,
  reportScheduleFor,
} from '../../../tools/uat/report-schedule.mjs'

const localDate = (value) => new Date(`${value}+08:00`)

const customSchedule = (overrides = {}) => ({
  enabled: true,
  broadcastScheduleMode: 'CUSTOM_V1',
  broadcastStartHour: 9,
  broadcastQuietHour: 2,
  broadcastIntervalHours: 1,
  broadcastScheduleEffectiveAt: '2026-09-10T09:00:00+08:00',
  ...overrides,
})

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

test('PMS collection runs once every hour without expanding broadcast slots', () => {
  for (const hour of [0, 2, 8, 10, 12, 23]) {
    const hourText = String(hour).padStart(2, '0')
    assert.equal(
      pmsCollectionSlotFor(localDate(`2026-09-10T${hourText}:00:00`)).slotKey,
      `2026-09-10T${hourText}:00`,
    )
  }
  assert.equal(
    pmsCollectionSlotFor(localDate('2026-09-10T10:05:59')).slotKey,
    '2026-09-10T10:00',
  )
  assert.equal(pmsCollectionSlotFor(localDate('2026-09-10T10:06:00')), null)
  assert.equal(collectionSlotFor(localDate('2026-09-10T10:00:00')), null)
  assert.equal(
    isScheduledBriefSnapshot({
      observedAt: '2026-09-10T10:00:00+08:00',
    }),
    false,
  )
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

test('per-hotel custom schedules support 1, 2, 3 and 4 hour cadences', () => {
  for (const [interval, dueHour, skippedHour] of [
    [1, 10, null],
    [2, 11, 10],
    [3, 12, 11],
    [4, 13, 12],
  ]) {
    const config = customSchedule({ broadcastIntervalHours: interval })
    assert.equal(
      isBriefDeliveryTimeForConfig(
        localDate(`2026-09-10T${String(dueHour).padStart(2, '0')}:06:00`),
        6,
        config,
      ),
      true,
    )
    if (skippedHour !== null) {
      assert.equal(
        isBroadcastWindowOpenForConfig(
          localDate(`2026-09-10T${String(skippedHour).padStart(2, '0')}:06:00`),
          config,
        ),
        false,
      )
    }
  }
})

test('custom schedules cross midnight and stop at the quiet-hour boundary', () => {
  const config = customSchedule({ broadcastIntervalHours: 2 })
  assert.equal(
    isBroadcastWindowOpenForConfig(localDate('2026-09-10T23:06:00'), config),
    true,
  )
  assert.equal(
    isBroadcastWindowOpenForConfig(localDate('2026-09-11T01:06:00'), config),
    true,
  )
  assert.equal(
    isBroadcastWindowOpenForConfig(localDate('2026-09-11T02:00:00'), config),
    false,
  )
  assert.equal(
    isBroadcastWindowOpenForConfig(
      localDate('2026-09-10T09:06:00'),
      { ...config, enabled: false, broadcastIntervalHours: 0 },
    ),
    false,
  )
})

test('custom briefing candidates honor cadence and configuration effective time', () => {
  const now = localDate('2026-09-11T01:08:00')
  const config = customSchedule({
    broadcastIntervalHours: 2,
    broadcastScheduleEffectiveAt: '2026-09-10T10:00:00+08:00',
  })
  const selected = briefingCycleSnapshotsForConfig([
    { observedAt: '2026-09-10T09:00:00+08:00' },
    { observedAt: '2026-09-10T10:00:00+08:00' },
    { observedAt: '2026-09-10T11:00:00+08:00' },
    { observedAt: '2026-09-10T12:00:00+08:00' },
    { observedAt: '2026-09-10T23:00:00+08:00' },
    { observedAt: '2026-09-11T01:00:00+08:00' },
  ], now, config)
  assert.deepEqual(
    selected.map((snapshot) => snapshot.observedAt),
    [
      '2026-09-10T11:00:00+08:00',
      '2026-09-10T23:00:00+08:00',
      '2026-09-11T01:00:00+08:00',
    ],
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
