import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import {
  MANUAL_REPLAY_REASON_CODE,
  manualReplayDeliveryDecision,
  manualReplayDeliveryView,
  manualReplayMessageKey,
  normalizeManualReplayRequest,
  safeManualReplayFailureReason,
  selectLatestAuthoritativeCompleteSnapshot,
} from '../../../tools/uat/wecom-manual-replay.mjs'

const collectionRunId = '2f7202ab-284d-4a34-8d42-ccefe785ad92'
const observedAt = '2026-09-02T22:38:36+08:00'
const operationKey = '6ec13bf4-4382-488a-9bb3-2caa1a41585b'

const completeSnapshot = (overrides = {}) => ({
  collectionRunId,
  observedAt,
  businessDate: '2026-09-02',
  completeness: 'COMPLETE',
  futureBookingChanges: { daily: [{ businessDate: '2026-09-03' }] },
  ...overrides,
})

const trustedDeviceStatus = (overrides = {}) => ({
  eligible: true,
  mode: 'STORE_TRUSTED_DEVICE',
  device: {
    cutoverReady: true,
    lastSnapshotAt: observedAt,
    lastBusinessDate: '2026-09-02',
    lastCompleteness: 'COMPLETE',
    ...overrides,
  },
})

test('manual replay request accepts only the exact idempotent command shape', () => {
  assert.deepEqual(normalizeManualReplayRequest({
    expectedCollectionRunId: collectionRunId,
    operationKey,
    reasonCode: MANUAL_REPLAY_REASON_CODE,
  }), {
    expectedCollectionRunId: collectionRunId,
    operationKey,
    reasonCode: MANUAL_REPLAY_REASON_CODE,
  })

  assert.throws(
    () => normalizeManualReplayRequest({
      expectedCollectionRunId: collectionRunId,
      operationKey,
      reasonCode: MANUAL_REPLAY_REASON_CODE,
      webhook: 'must-not-be-accepted',
    }),
    /WECOM_MANUAL_REPLAY_REQUEST_INVALID/u,
  )
  assert.throws(
    () => normalizeManualReplayRequest({
      expectedCollectionRunId: collectionRunId,
      operationKey,
      reasonCode: 'MANUAL_REPLAY_ANY_SNAPSHOT',
    }),
    /WECOM_MANUAL_REPLAY_REASON_CODE_INVALID/u,
  )
})

test('manual replay selects only the current complete snapshot', () => {
  const latest = completeSnapshot()
  assert.equal(selectLatestAuthoritativeCompleteSnapshot({
    snapshots: [latest],
    expectedCollectionRunId: collectionRunId,
    trustedDeviceStatus: null,
  }), latest)

  const partial = completeSnapshot({
    collectionRunId: 'ec193a3e-48a5-4a2c-8c99-817a898f79f5',
    observedAt: '2026-09-02T22:40:00+08:00',
    completeness: 'PARTIAL',
  })
  assert.throws(
    () => selectLatestAuthoritativeCompleteSnapshot({
      snapshots: [latest, partial],
      expectedCollectionRunId: collectionRunId,
      trustedDeviceStatus: null,
    }),
    /WECOM_MANUAL_REPLAY_LATEST_SNAPSHOT_CHANGED/u,
  )
  assert.throws(
    () => selectLatestAuthoritativeCompleteSnapshot({
      snapshots: [latest, partial],
      expectedCollectionRunId: partial.collectionRunId,
      trustedDeviceStatus: null,
    }),
    /WECOM_MANUAL_REPLAY_COMPLETE_SNAPSHOT_REQUIRED/u,
  )
})

test('trusted-device replay requires committed matching authoritative state', () => {
  const latest = completeSnapshot()
  assert.equal(selectLatestAuthoritativeCompleteSnapshot({
    snapshots: [latest],
    expectedCollectionRunId: collectionRunId,
    trustedDeviceStatus: trustedDeviceStatus(),
  }), latest)

  for (const status of [
    trustedDeviceStatus({ cutoverReady: false }),
    trustedDeviceStatus({ lastSnapshotAt: '2026-09-02T22:37:00+08:00' }),
    trustedDeviceStatus({ lastCompleteness: 'PARTIAL' }),
  ]) {
    assert.throws(
      () => selectLatestAuthoritativeCompleteSnapshot({
        snapshots: [latest],
        expectedCollectionRunId: collectionRunId,
        trustedDeviceStatus: status,
      }),
      /WECOM_MANUAL_REPLAY_AUTHORITATIVE_SNAPSHOT_REQUIRED/u,
    )
  }
})

test('operation key maps to stable scoped keys without exposing the raw key', () => {
  const command = {
    hotelId: '8b7f172e-e78e-4eb0-82d7-9463b672dd8d',
    operationKey,
    deliveryType: 'TODAY_REVENUE',
  }
  const first = manualReplayMessageKey(command)
  assert.equal(manualReplayMessageKey(command), first)
  assert.equal(first.includes(operationKey), false)
  assert.notEqual(manualReplayMessageKey({
    ...command,
    deliveryType: 'FUTURE_14D',
  }), first)
  assert.notEqual(manualReplayMessageKey({
    ...command,
    operationKey: '46c3c1de-a1de-453d-8562-b4732f9205b6',
  }), first)
})

test('existing uncertain or rejected records fail closed without resend', () => {
  const snapshot = completeSnapshot()
  const base = {
    hotelId: 'hotel-001',
    businessDate: snapshot.businessDate,
    cutoffAt: snapshot.observedAt,
  }
  assert.equal(manualReplayDeliveryDecision({
    delivery: null,
    hotelId: base.hotelId,
    snapshot,
  }), 'SEND_MISSING')
  assert.equal(manualReplayDeliveryDecision({
    delivery: { ...base, deliveryStatus: 'DELIVERED' },
    hotelId: base.hotelId,
    snapshot,
  }), 'ALREADY_DELIVERED')
  for (const deliveryStatus of ['AMBIGUOUS', 'SENDING']) {
    assert.equal(manualReplayDeliveryDecision({
      delivery: { ...base, deliveryStatus },
      hotelId: base.hotelId,
      snapshot,
    }), 'MANUAL_RECONCILIATION_REQUIRED')
  }
  assert.equal(manualReplayDeliveryDecision({
    delivery: { ...base, deliveryStatus: 'REJECTED' },
    hotelId: base.hotelId,
    snapshot,
  }), 'REJECTED_NO_AUTOMATIC_RETRY')
  assert.equal(manualReplayDeliveryDecision({
    delivery: { ...base, cutoffAt: '2026-09-02T22:02:00+08:00' },
    hotelId: base.hotelId,
    snapshot,
  }), 'OPERATION_SCOPE_CONFLICT')
})

test('manual replay response exposes aggregate delivery state only', () => {
  const view = manualReplayDeliveryView({
    deliveryType: 'TODAY_REVENUE',
    deliveryStatus: 'DELIVERED',
    reasonCode: 'WECOM_BUNDLE_DELIVERED',
    attemptedAt: '2026-09-02T14:40:00.000Z',
    completedAt: '2026-09-02T14:40:01.000Z',
    partCount: 2,
    deliveredPartCount: 2,
    messageKey: 'internal-only',
    bodyPreview: 'must not leave the server',
    endpointSha256: 'a'.repeat(64),
  })
  assert.deepEqual(view, {
    deliveryType: 'TODAY_REVENUE',
    deliveryStatus: 'DELIVERED',
    reasonCode: 'WECOM_BUNDLE_DELIVERED',
    partCount: 2,
    deliveredPartCount: 2,
    attemptedAt: '2026-09-02T14:40:00.000Z',
    completedAt: '2026-09-02T14:40:01.000Z',
  })
  assert.equal(safeManualReplayFailureReason(
    new Error('contains unsafe customer text'),
  ), 'WECOM_MANUAL_REPLAY_FAILED_CLOSED')
})

test('production release packages the manual replay runtime module', async () => {
  const publishScript = await readFile(new URL(
    '../../../infra/ota-standalone-server/scripts/Publish-OtaStandaloneServer.ps1',
    import.meta.url,
  ), 'utf8')
  assert.match(publishScript, /tools\/uat\/wecom-manual-replay\.mjs/u)
})
