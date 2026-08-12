import assert from 'node:assert/strict'
import test from 'node:test'
import {
  OTA_DEFAULT_POLL_INTERVAL_MINUTES,
  OTA_POLL_INTERVAL_OPTIONS_MINUTES,
  otaSourcePollingDue,
  otaSourceSchedulerReady,
} from '../../../tools/uat/ota-source-schedule.mjs'

test('OTA polling defaults to two hours and exposes approved intervals', () => {
  assert.equal(OTA_DEFAULT_POLL_INTERVAL_MINUTES, 120)
  assert.deepEqual(
    OTA_POLL_INTERVAL_OPTIONS_MINUTES,
    [30, 60, 120, 180, 240, 360, 720, 1_440],
  )
})

test('OTA source becomes due only after its configured interval', () => {
  const source = {
    enabled: true,
    pollIntervalMinutes: 120,
    lastRefreshAt: '2026-08-12T00:00:00.000Z',
  }
  assert.equal(
    otaSourcePollingDue(source, new Date('2026-08-12T01:59:59.999Z')),
    false,
  )
  assert.equal(
    otaSourcePollingDue(source, new Date('2026-08-12T02:00:00.000Z')),
    true,
  )
})

test('new sources are due while disabled or invalid sources stay closed', () => {
  assert.equal(otaSourcePollingDue({
    enabled: true,
    pollIntervalMinutes: 30,
    lastRefreshAt: null,
  }), true)
  assert.equal(otaSourcePollingDue({
    enabled: false,
    pollIntervalMinutes: 30,
    lastRefreshAt: null,
  }), false)
  assert.equal(otaSourcePollingDue({
    enabled: true,
    pollIntervalMinutes: 31,
    lastRefreshAt: null,
  }), false)
})

test('existing Meituan rank source is due once to backfill the safe dashboard projection', () => {
  const source = {
    enabled: true,
    platformCode: 'MEITUAN',
    pollIntervalMinutes: 120,
    lastRefreshStatus: 'COMPLETE',
    lastRefreshAt: '2026-08-12T01:59:59.999Z',
    lastSummary: {
      recordPath: '$.data.peerRankResult',
      detectedDimensions: ['RANK'],
    },
  }
  assert.equal(
    otaSourcePollingDue(source, new Date('2026-08-12T02:00:00.000Z')),
    true,
  )
  source.lastSummary.peerRanking = {
    provider: 'MEITUAN',
    metrics: [],
  }
  assert.equal(
    otaSourcePollingDue(source, new Date('2026-08-12T02:00:00.000Z')),
    false,
  )
})

test('automatic OTA polling waits through the deployment startup grace', () => {
  const startedAt = new Date('2026-08-12T00:00:00.000Z')
  assert.equal(
    otaSourceSchedulerReady(
      startedAt,
      new Date('2026-08-12T00:01:29.999Z'),
    ),
    false,
  )
  assert.equal(
    otaSourceSchedulerReady(
      startedAt,
      new Date('2026-08-12T00:01:30.000Z'),
    ),
    true,
  )
})
