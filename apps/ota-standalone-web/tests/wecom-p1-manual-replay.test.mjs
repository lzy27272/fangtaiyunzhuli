import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import {
  P1_MANUAL_REPLAY_OPERATION_KEY,
  P1_MANUAL_REPLAY_REASON_CODE,
  normalizeP1ManualReplayRequest,
  p1ManualReplayDeliveryDecision,
  p1ManualReplayDeliveryView,
  p1ManualReplayMessageKey,
  safeP1ManualReplayFailureReason,
} from '../../../tools/uat/wecom-p1-manual-replay.mjs'

const hotelId = '20000000-0000-4000-8000-000000000001'
const expectedCollectionRunId = '10000000-0000-4000-8000-000000000001'
const snapshot = {
  businessDate: '2026-09-07',
  observedAt: '2026-09-07T07:00:00.000Z',
}

const request = () => ({
  expectedCollectionRunId,
  reasonCode: P1_MANUAL_REPLAY_REASON_CODE,
})

const delivery = (overrides = {}) => ({
  hotelId,
  deliveryType: 'P1_FUTURE_DEMAND',
  businessDate: snapshot.businessDate,
  cutoffAt: snapshot.observedAt,
  deliveryStatus: 'DELIVERED',
  reasonCode: 'WECOM_BUNDLE_DELIVERED',
  attemptedAt: '2026-09-07T07:01:00.000Z',
  completedAt: '2026-09-07T07:01:01.000Z',
  partCount: 1,
  deliveredPartCount: 1,
  ...overrides,
})

test('normalizes the fixed P1 replay request without accepting an operation key', () => {
  assert.deepEqual(normalizeP1ManualReplayRequest(request()), {
    expectedCollectionRunId,
    operationKey: P1_MANUAL_REPLAY_OPERATION_KEY,
    reasonCode: P1_MANUAL_REPLAY_REASON_CODE,
  })
  assert.throws(
    () => normalizeP1ManualReplayRequest({
      ...request(),
      operationKey: P1_MANUAL_REPLAY_OPERATION_KEY,
    }),
    /WECOM_P1_MANUAL_REPLAY_REQUEST_INVALID/u,
  )
  assert.throws(
    () => normalizeP1ManualReplayRequest({
      ...request(),
      reasonCode: 'MANUAL_REPLAY_LATEST_COMPLETE',
    }),
    /WECOM_P1_MANUAL_REPLAY_REASON_CODE_INVALID/u,
  )
  assert.throws(
    () => normalizeP1ManualReplayRequest({
      ...request(),
      expectedCollectionRunId: 'not-a-run-id',
    }),
    /WECOM_P1_MANUAL_REPLAY_COLLECTION_RUN_ID_INVALID/u,
  )
})

test('builds a deterministic scoped key without exposing the fixed operation key', () => {
  const first = p1ManualReplayMessageKey({ hotelId })
  const second = p1ManualReplayMessageKey({
    hotelId,
    operationKey: P1_MANUAL_REPLAY_OPERATION_KEY,
  })
  assert.equal(first, second)
  assert.match(
    first,
    new RegExp(
      `^${hotelId}:P1_MANUAL_REPLAY_V1:[a-f0-9]{64}:P1_FUTURE_DEMAND$`,
      'u',
    ),
  )
  assert.equal(first.includes(P1_MANUAL_REPLAY_OPERATION_KEY), false)
  assert.notEqual(
    first,
    p1ManualReplayMessageKey({ hotelId: hotelId.replace(/1$/u, '2') }),
  )
  assert.throws(
    () => p1ManualReplayMessageKey({
      hotelId,
      operationKey: 'P1_REPLAY_001_ANOTHER_OPERATION',
    }),
    /WECOM_P1_MANUAL_REPLAY_MESSAGE_KEY_INPUT_INVALID/u,
  )
})

test('decides replay idempotency and scope without retrying uncertain results', () => {
  assert.equal(
    p1ManualReplayDeliveryDecision({ delivery: null, hotelId, snapshot }),
    'SEND_MISSING',
  )
  assert.equal(
    p1ManualReplayDeliveryDecision({
      delivery: delivery(),
      hotelId,
      snapshot,
    }),
    'ALREADY_DELIVERED',
  )
  for (const deliveryStatus of ['SENDING', 'AMBIGUOUS']) {
    assert.equal(
      p1ManualReplayDeliveryDecision({
        delivery: delivery({ deliveryStatus }),
        hotelId,
        snapshot,
      }),
      'MANUAL_RECONCILIATION_REQUIRED',
    )
  }
  assert.equal(
    p1ManualReplayDeliveryDecision({
      delivery: delivery({ deliveryStatus: 'REJECTED' }),
      hotelId,
      snapshot,
    }),
    'REJECTED_NO_AUTOMATIC_RETRY',
  )
  for (const conflict of [
    { hotelId: hotelId.replace(/1$/u, '2') },
    { deliveryType: 'P1_FUTURE_DEMAND_TEST' },
    { businessDate: '2026-09-06' },
    { cutoffAt: '2026-09-07T06:00:00.000Z' },
  ]) {
    assert.equal(
      p1ManualReplayDeliveryDecision({
        delivery: delivery(conflict),
        hotelId,
        snapshot,
      }),
      'OPERATION_SCOPE_CONFLICT',
    )
  }
})

test('returns an allowlisted delivery view without message content or secrets', () => {
  const view = p1ManualReplayDeliveryView(delivery({
    bodyPreview: 'secret message body',
    messageSha256: 'sensitive-message-hash',
    endpointSha256: 'sensitive-endpoint-hash',
    messageKey: 'internal-message-key',
    webhook: 'https://example.invalid/secret',
  }))
  assert.deepEqual(view, {
    deliveryType: 'P1_FUTURE_DEMAND',
    deliveryStatus: 'DELIVERED',
    reasonCode: 'WECOM_BUNDLE_DELIVERED',
    partCount: 1,
    deliveredPartCount: 1,
    attemptedAt: '2026-09-07T07:01:00.000Z',
    completedAt: '2026-09-07T07:01:01.000Z',
  })
  const serialized = JSON.stringify(view)
  for (const removed of [
    'secret message body',
    'sensitive-message-hash',
    'sensitive-endpoint-hash',
    'internal-message-key',
    'example.invalid',
  ]) assert.equal(serialized.includes(removed), false)
})

test('fails closed for malformed delivery fields and unsafe errors', () => {
  assert.deepEqual(
    p1ManualReplayDeliveryView(delivery({
      deliveryType: 'UNTRUSTED',
      deliveryStatus: 'UNKNOWN',
      reasonCode: 'remote body with a secret',
      attemptedAt: 'not-a-time',
      completedAt: 'also-not-a-time',
      partCount: -1,
      deliveredPartCount: 99,
    })),
    {
      deliveryType: 'P1_FUTURE_DEMAND',
      deliveryStatus: 'REJECTED',
      reasonCode: 'WECOM_P1_MANUAL_REPLAY_DELIVERY_FAILED_CLOSED',
      partCount: 0,
      deliveredPartCount: 0,
    },
  )
  assert.equal(
    safeP1ManualReplayFailureReason(
      new Error('WECOM_P1_MANUAL_REPLAY_COMPLETE_SNAPSHOT_REQUIRED'),
    ),
    'WECOM_P1_MANUAL_REPLAY_COMPLETE_SNAPSHOT_REQUIRED',
  )
  assert.equal(
    safeP1ManualReplayFailureReason(new Error('remote body with a secret')),
    'WECOM_P1_MANUAL_REPLAY_FAILED_CLOSED',
  )
})

test('production packages the fixed loopback-only P1 replay operation', async () => {
  const publishScript = await readFile(new URL(
    '../../../infra/ota-standalone-server/scripts/Publish-OtaStandaloneServer.ps1',
    import.meta.url,
  ), 'utf8')
  const reviewApi = await readFile(new URL(
    '../../../tools/uat/ota-standalone-review-api.mjs',
    import.meta.url,
  ), 'utf8')
  assert.match(
    publishScript,
    /tools\/uat\/wecom-p1-manual-replay\.mjs/u,
  )
  assert.match(
    reviewApi,
    /path === '\/api\/v1\/internal\/p1-future-demand-replay-001'/u,
  )
  assert.match(
    reviewApi,
    /if \(!loopbackPilotTriggerAuthorized\(request\)\)/u,
  )
})
