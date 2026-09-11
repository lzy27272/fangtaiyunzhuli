import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import {
  automaticHotSellingRetryDecision,
  HOT_SELLING_AUTOMATIC_RETRY_OPERATION_KEY,
  hotSellingRetryDecision,
  markAutomaticHotSellingRetryPreflight,
  preciseWeComDeliveryFailure,
  reconcileInterruptedWeComDelivery,
  summarizeWeComBundleDelivery,
} from '../../../tools/uat/wecom/src/delivery-state.mjs'

const rejectedHotSellingDelivery = (overrides = {}) => ({
  deliveryId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  deliveryType: 'HOT_SELLING_SOLD_OUT',
  deliveryStatus: 'REJECTED',
  reasonCode: 'WECOM_BUNDLE_REJECTED',
  httpStatus: null,
  weComCode: null,
  networkAttempted: false,
  partCount: 1,
  deliveredPartCount: 0,
  parts: [{
    deliveryStatus: 'REJECTED',
    reasonCode: 'WECOM_PAYLOAD_INVALID',
    httpStatus: null,
    weComCode: null,
    networkAttempted: false,
  }],
  ...overrides,
})

test('bundle failure preserves the first concrete part diagnostic', () => {
  const delivery = rejectedHotSellingDelivery()
  assert.deepEqual(preciseWeComDeliveryFailure(delivery), {
    reasonCode: 'WECOM_PAYLOAD_INVALID',
    httpStatus: null,
    weComCode: null,
    networkAttempted: false,
  })
  assert.deepEqual(summarizeWeComBundleDelivery({
    parts: delivery.parts,
    expectedPartCount: 1,
  }), {
    deliveryStatus: 'REJECTED',
    reasonCode: 'WECOM_PAYLOAD_INVALID',
  })
})

test('ambiguous bundle result stays ambiguous and is never collapsed to rejected', () => {
  assert.deepEqual(summarizeWeComBundleDelivery({
    parts: [{
      deliveryStatus: 'AMBIGUOUS',
      reasonCode: 'WECOM_NETWORK_RESULT_UNKNOWN',
    }],
    expectedPartCount: 1,
  }), {
    deliveryStatus: 'AMBIGUOUS',
    reasonCode: 'WECOM_NETWORK_RESULT_UNKNOWN',
  })
})

test('only a proven zero-delivery rejected hot-selling alert is retryable', () => {
  assert.equal(
    hotSellingRetryDecision(rejectedHotSellingDelivery()),
    'RETRY_ALLOWED',
  )
  assert.equal(hotSellingRetryDecision(null), 'DELIVERY_NOT_FOUND')
  assert.equal(hotSellingRetryDecision(rejectedHotSellingDelivery({
    deliveryType: 'TODAY_REVENUE',
  })), 'DELIVERY_TYPE_NOT_SUPPORTED')
  assert.equal(hotSellingRetryDecision(rejectedHotSellingDelivery({
    deliveryStatus: 'DELIVERED',
  })), 'ALREADY_DELIVERED')
  for (const deliveryStatus of ['SENDING', 'AMBIGUOUS']) {
    assert.equal(hotSellingRetryDecision(rejectedHotSellingDelivery({
      deliveryStatus,
    })), 'MANUAL_RECONCILIATION_REQUIRED')
  }
  assert.equal(hotSellingRetryDecision(rejectedHotSellingDelivery({
    deliveryStatus: 'FAILED',
  })), 'RETRY_BLOCKED')
  assert.equal(hotSellingRetryDecision(rejectedHotSellingDelivery({
    retrySourceDeliveryId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  })), 'RETRY_ALREADY_ATTEMPTED')
  assert.equal(hotSellingRetryDecision(rejectedHotSellingDelivery({
    hotSellingRetryResolution: {
      status: 'SKIPPED',
      requestKey: 'opaque-request-key',
    },
  })), 'RETRY_ALREADY_ATTEMPTED')
})

test('missing or contradictory part evidence blocks a retry', () => {
  const invalidEvidence = [
    { deliveredPartCount: undefined },
    { partCount: undefined },
    { partCount: 0 },
    { parts: undefined },
    { parts: [] },
    { partCount: 2, parts: [{ deliveryStatus: 'REJECTED' }] },
    { deliveredPartCount: 1 },
    { parts: [{ deliveryStatus: 'DELIVERED' }] },
    { parts: [{ deliveryStatus: 'AMBIGUOUS' }] },
    { partCount: 1, parts: [
      { deliveryStatus: 'REJECTED' },
      { deliveryStatus: 'REJECTED' },
    ] },
  ]
  for (const overrides of invalidEvidence) {
    assert.equal(
      hotSellingRetryDecision(rejectedHotSellingDelivery(overrides)),
      'PARTIAL_DELIVERY_RECONCILIATION_REQUIRED',
    )
  }
})

test('persisted sending state becomes result-unknown after a restart', () => {
  const sending = {
    deliveryStatus: 'SENDING',
    reasonCode: 'WECOM_BUNDLE_SENDING',
    networkAttempted: false,
  }
  const reconciled = reconcileInterruptedWeComDelivery(
    sending,
    '2026-09-11T13:00:00.000Z',
  )
  assert.equal(reconciled.deliveryStatus, 'AMBIGUOUS')
  assert.equal(
    reconciled.reasonCode,
    'WECOM_PROCESS_INTERRUPTED_RESULT_UNKNOWN',
  )
  assert.equal(reconciled.networkAttempted, null)
  assert.equal(reconciled.completedAt, '2026-09-11T13:00:00.000Z')
  const delivered = { deliveryStatus: 'DELIVERED' }
  assert.strictEqual(reconcileInterruptedWeComDelivery(delivered), delivered)
})

test('automatic retry is limited to a fresh pre-network payload rejection', () => {
  const now = new Date('2026-09-11T08:00:00.000Z')
  const eligible = rejectedHotSellingDelivery({
    attemptedAt: '2026-09-11T03:00:00.000Z',
  })
  assert.equal(
    automaticHotSellingRetryDecision(eligible, now),
    'AUTOMATIC_RETRY_ALLOWED',
  )
  for (const [overrides, expected] of [
    [{ automaticRetryAttempted: true }, 'AUTOMATIC_RETRY_ALREADY_ATTEMPTED'],
    [{ attemptedAt: '2026-09-10T19:59:59.999Z' }, 'AUTOMATIC_RETRY_WINDOW_CLOSED'],
    [{ networkAttempted: true, parts: [{
      deliveryStatus: 'REJECTED',
      reasonCode: 'WECOM_PAYLOAD_INVALID',
      networkAttempted: true,
    }] }, 'AUTOMATIC_RETRY_NOT_PROVEN_SAFE'],
    [{ httpStatus: 400 }, 'AUTOMATIC_RETRY_NOT_PROVEN_SAFE'],
    [{ weComCode: 93000 }, 'AUTOMATIC_RETRY_NOT_PROVEN_SAFE'],
    [{ parts: [{
      deliveryStatus: 'REJECTED',
      reasonCode: 'WECOM_PAYLOAD_INVALID',
      networkAttempted: false,
      httpStatus: 400,
      weComCode: null,
    }] }, 'AUTOMATIC_RETRY_NOT_PROVEN_SAFE'],
    [{ parts: [{
      deliveryStatus: 'REJECTED',
      reasonCode: 'WECOM_HTTP_REJECTED',
      networkAttempted: false,
    }] }, 'AUTOMATIC_RETRY_NOT_PROVEN_SAFE'],
    [{ deliveryStatus: 'AMBIGUOUS' }, 'MANUAL_RECONCILIATION_REQUIRED'],
  ]) {
    assert.equal(
      automaticHotSellingRetryDecision(
        rejectedHotSellingDelivery({
          attemptedAt: '2026-09-11T03:00:00.000Z',
          ...overrides,
        }),
        now,
      ),
      expected,
    )
  }
})

test('automatic retry claim is durably persisted before work can continue', () => {
  const events = []
  const delivery = rejectedHotSellingDelivery({
    attemptedAt: '2026-09-11T03:00:00.000Z',
  })
  const requestKey = 'hotel-015:HOT_SELLING_RETRY_V1:' + 'a'.repeat(64)
  markAutomaticHotSellingRetryPreflight({
    delivery,
    requestKey,
    now: new Date('2026-09-11T08:00:00.000Z'),
    persist: () => events.push({
      automaticRetryAttempted: delivery.automaticRetryAttempted,
      automaticRetryAttemptedAt: delivery.automaticRetryAttemptedAt,
      resolution: { ...delivery.hotSellingRetryResolution },
    }),
  })
  assert.equal(events.length, 1)
  assert.equal(events[0].automaticRetryAttempted, true)
  assert.equal(events[0].resolution.requestKey, requestKey)
  assert.equal(events[0].resolution.retryMode, 'AUTOMATIC')
  assert.equal(
    events[0].resolution.retryOperationKey,
    HOT_SELLING_AUTOMATIC_RETRY_OPERATION_KEY,
  )
  assert.equal(events[0].resolution.status, 'SENDING')
  assert.equal(events[0].resolution.deliveryId, null)
  assert.equal(
    automaticHotSellingRetryDecision(
      delivery,
      new Date('2026-09-11T08:01:00.000Z'),
    ),
    'AUTOMATIC_RETRY_RECOVERY_REQUIRED',
  )
  markAutomaticHotSellingRetryPreflight({
    delivery,
    requestKey,
    now: new Date('2026-09-11T08:01:00.000Z'),
    persist: () => events.push('recovered-preflight-persisted'),
  })
  assert.equal(events.length, 2)
  assert.equal(delivery.hotSellingRetryResolution.preflightAttemptCount, 2)
  delivery.hotSellingRetryResolution.nextPreflightAttemptAt =
    '2026-09-11T08:06:00.000Z'
  assert.equal(
    automaticHotSellingRetryDecision(
      delivery,
      new Date('2026-09-11T08:02:00.000Z'),
    ),
    'AUTOMATIC_RETRY_BACKOFF',
  )
})

test('review API keeps retries fail-closed and exposes audited retry paths', async () => {
  const api = await readFile(new URL(
    '../../../tools/uat/ota-standalone-review-api.mjs',
    import.meta.url,
  ), 'utf8')
  assert.match(api, /scheduledHotSellingAutomaticRetryTick/u)
  assert.match(api, /markAutomaticHotSellingRetryPreflight\(\{/u)
  assert.match(api, /persist:\s*persistWeComDeliveries/u)
  assert.match(api, /HOT_SELLING_AUTOMATIC_RETRY_OPERATION_KEY/u)
  assert.match(api, /isBriefDeliveryTimeForConfig\(now, 9, config\)/u)
  assert.match(api, /hourlyBriefBundleDelivered\(\{/u)
  assert.match(api, /canonicalHotSellingSourceDelivery/u)
  assert.match(api, /retryClaim\?\.stage === 'PREFLIGHT'/u)
  assert.match(api, /nextPreflightAttemptAt/u)
  assert.match(api, /retryMode === 'MANUAL'/u)
  assert.match(api, /if \(existing\) return existing/u)
  assert.match(api, /retrySourceDeliveryId,/u)
  assert.match(api, /retryOperationKey,/u)
  assert.match(api, /hotSellingRetryResolution/u)
  assert.match(api, /coordinateHotSellingRetry\(\{/u)
  assert.match(api, /locksByHotel: weComHotSellingRetryLocks/u)
  assert.match(api, /acquireHotSellingRetryClaim\(\{/u)
  assert.match(api, /beforeNetwork: \(startedDelivery\)/u)
  assert.match(
    api,
    /payload: payloads\[index\],\s+deliveryType,\s+expectedEndpointSha256/u,
  )
  assert.match(
    api,
    /if \(!startedDelivery && retryMode === 'MANUAL'\) \{\s+delete sourceDelivery\.hotSellingRetryResolution/u,
  )
  assert.match(api, /persistedResolution\.deliveryId === null/u)
  assert.match(api, /delete sourceDelivery\.hotSellingRetryResolution/u)
  assert.match(api, /wecom-hot-selling-retry-deliveries/u)
  assert.match(api, /hotSellingRetryDecision\(delivery\) === 'RETRY_ALLOWED'/u)
  const automaticTick = api.slice(
    api.indexOf('const scheduledHotSellingAutomaticRetryTick'),
    api.indexOf('const scheduledHotSellingDeliveryWorkflowTick'),
  )
  assert.ok(
    automaticTick.indexOf('closeExpiredAutomaticRetryPreflight')
      < automaticTick.indexOf('if (!automaticHourlyCollectionEnabled) continue'),
    'expired automatic preflights must close even while collection is disabled',
  )
})
