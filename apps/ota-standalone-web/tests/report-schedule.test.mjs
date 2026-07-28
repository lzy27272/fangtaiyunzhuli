import assert from 'node:assert/strict'
import test from 'node:test'
import {
  briefingCycleSnapshots,
  briefingCycleStart,
  collectionSlotFor,
  isBriefDeliveryTime,
  isBroadcastWindowOpen,
} from '../../../tools/uat/report-schedule.mjs'

const localDate = (value) => new Date(`${value}+08:00`)

test('30-minute polling runs from 08:00 through the final 02:00 slot', () => {
  assert.equal(collectionSlotFor(localDate('2026-07-28T07:59:00')), null)
  assert.equal(
    collectionSlotFor(localDate('2026-07-28T08:00:00')).slotKey,
    '2026-07-28T08:00',
  )
  assert.equal(
    collectionSlotFor(localDate('2026-07-28T08:30:00')).slotKey,
    '2026-07-28T08:30',
  )
  assert.equal(
    collectionSlotFor(localDate('2026-07-29T01:30:00')).slotKey,
    '2026-07-29T01:30',
  )
  assert.equal(
    collectionSlotFor(localDate('2026-07-29T02:00:00')).slotKey,
    '2026-07-29T02:00',
  )
  assert.equal(collectionSlotFor(localDate('2026-07-29T02:30:00')), null)
  assert.equal(collectionSlotFor(localDate('2026-07-29T03:00:00')), null)
})

test('brief delivery closes after the 02:00 dispatch and resumes at 08:00', () => {
  assert.equal(
    isBriefDeliveryTime(localDate('2026-07-29T02:06:00'), 6),
    true,
  )
  assert.equal(
    isBroadcastWindowOpen(localDate('2026-07-29T02:16:00')),
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
})

test('08:00 starts a new briefing cycle without replaying pause snapshots', () => {
  const now = localDate('2026-07-29T08:06:00')
  assert.equal(briefingCycleStart(now), '2026-07-29T08:00:00+08:00')
  const selected = briefingCycleSnapshots([
    { observedAt: '2026-07-29T02:00:00+08:00' },
    { observedAt: '2026-07-29T03:00:00+08:00' },
    { observedAt: '2026-07-29T08:00:00+08:00' },
  ], now)
  assert.deepEqual(
    selected.map((snapshot) => snapshot.observedAt),
    ['2026-07-29T08:00:00+08:00'],
  )
  assert.equal(
    briefingCycleStart(localDate('2026-07-29T01:00:00')),
    '2026-07-28T08:00:00+08:00',
  )
})
