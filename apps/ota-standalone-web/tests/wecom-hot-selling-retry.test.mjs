import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import {
  acquireHotSellingRetryClaim,
  coordinateHotSellingRetry,
  hotSellingRetryMessageKey,
  normalizeHotSellingRetryRequest,
} from '../../../tools/uat/wecom-hot-selling-retry.mjs'

const expectedDeliveryId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const operationKey = 'HOT_SELLING_RETRY_12345678'

test('hot-selling retry accepts only the exact audited request shape', () => {
  assert.deepEqual(normalizeHotSellingRetryRequest({
    expectedDeliveryId,
    operationKey,
    reasonCode: 'RETRY_HOT_SELLING_SOLD_OUT',
  }), { expectedDeliveryId, operationKey })

  for (const invalid of [
    null,
    { expectedDeliveryId, operationKey },
    {
      expectedDeliveryId,
      operationKey,
      reasonCode: 'OTHER_REASON',
    },
    {
      expectedDeliveryId: 'not-a-delivery-id',
      operationKey,
      reasonCode: 'RETRY_HOT_SELLING_SOLD_OUT',
    },
    {
      expectedDeliveryId,
      operationKey: 'short',
      reasonCode: 'RETRY_HOT_SELLING_SOLD_OUT',
    },
    {
      expectedDeliveryId,
      operationKey,
      reasonCode: 'RETRY_HOT_SELLING_SOLD_OUT',
      unexpected: true,
    },
  ]) {
    assert.throws(() => normalizeHotSellingRetryRequest(invalid), /WECOM_/u)
  }
})

test('hot-selling retry request keys are deterministic and scoped', () => {
  const first = hotSellingRetryMessageKey({
    hotelId: 'hotel-015',
    expectedDeliveryId,
    operationKey,
  })
  assert.equal(first, hotSellingRetryMessageKey({
    hotelId: 'hotel-015',
    expectedDeliveryId,
    operationKey,
  }))
  assert.notEqual(first, hotSellingRetryMessageKey({
    hotelId: 'hotel-016',
    expectedDeliveryId,
    operationKey,
  }))
  assert.notEqual(first, hotSellingRetryMessageKey({
    hotelId: 'hotel-015',
    expectedDeliveryId,
    operationKey: 'HOT_SELLING_RETRY_87654321',
  }))
  assert.match(first, /^hotel-015:HOT_SELLING_RETRY_V1:[a-f0-9]{64}$/u)
})

test('same-operation retries share one in-flight execution', async () => {
  const locksByHotel = new Map()
  let release
  let runCount = 0
  const gate = new Promise((resolve) => { release = resolve })
  const input = {
    locksByHotel,
    hotelId: 'hotel-015',
    sourceDeliveryId: expectedDeliveryId,
    operationKey,
  }
  const first = coordinateHotSellingRetry({
    ...input,
    run: async () => {
      runCount += 1
      await gate
      return { deliveryId: 'result-001', replayed: false }
    },
  })
  const joined = coordinateHotSellingRetry({
    ...input,
    run: async () => {
      runCount += 1
      return { deliveryId: 'must-not-run' }
    },
  })
  assert.equal(first.joined, false)
  assert.equal(joined.joined, true)
  await Promise.resolve()
  assert.equal(runCount, 1)
  release()
  assert.deepEqual(await joined.operation, await first.operation)
  assert.equal(locksByHotel.size, 0)
})

test('a hotel lock rejects a different operation and clears after failure', async () => {
  const locksByHotel = new Map()
  let rejectRun
  let conflictingRunCount = 0
  const gate = new Promise((_resolve, reject) => { rejectRun = reject })
  const first = coordinateHotSellingRetry({
    locksByHotel,
    hotelId: 'hotel-015',
    sourceDeliveryId: expectedDeliveryId,
    operationKey,
    run: () => gate,
  })
  assert.throws(
    () => coordinateHotSellingRetry({
      locksByHotel,
      hotelId: 'hotel-015',
      sourceDeliveryId: expectedDeliveryId,
      operationKey: 'HOT_SELLING_RETRY_DIFFERENT',
      run: async () => { conflictingRunCount += 1 },
    }),
    /WECOM_HOT_SELLING_RETRY_IN_PROGRESS/u,
  )
  assert.equal(conflictingRunCount, 0)
  rejectRun(new Error('synthetic failure'))
  await assert.rejects(first.operation, /synthetic failure/u)
  assert.equal(locksByHotel.size, 0)

  const afterFailure = coordinateHotSellingRetry({
    locksByHotel,
    hotelId: 'hotel-015',
    sourceDeliveryId: expectedDeliveryId,
    operationKey: 'HOT_SELLING_RETRY_DIFFERENT',
    run: async () => 'recovered',
  })
  assert.equal(await afterFailure.operation, 'recovered')
  assert.equal(locksByHotel.size, 0)
})

test('a durable claim blocks a second process owner after child persistence', async () => {
  const claimsRoot = await mkdtemp(join(tmpdir(), 'wecom-hot-claim-'))
  const requestKey = hotSellingRetryMessageKey({
    hotelId: 'hotel-015',
    expectedDeliveryId,
    operationKey,
  })
  let first = null
  try {
    first = acquireHotSellingRetryClaim({
      claimsRoot,
      hotelId: 'hotel-015',
      sourceDeliveryId: expectedDeliveryId,
      operationKey,
      requestKey,
    })
    assert.throws(
      () => acquireHotSellingRetryClaim({
        claimsRoot,
        hotelId: 'hotel-015',
        sourceDeliveryId: expectedDeliveryId,
        operationKey,
        requestKey,
      }),
      /WECOM_HOT_SELLING_RETRY_IN_PROGRESS/u,
    )
    first.markChildPersisted('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb')
    first.close()
    first = null
    assert.throws(
      () => acquireHotSellingRetryClaim({
        claimsRoot,
        hotelId: 'hotel-015',
        sourceDeliveryId: expectedDeliveryId,
        operationKey,
        requestKey,
        allowStalePreflightRecovery: true,
        isProcessAlive: () => false,
      }),
      /WECOM_HOT_SELLING_MANUAL_RECONCILIATION_REQUIRED/u,
    )
  } finally {
    first?.close()
    await rm(claimsRoot, { recursive: true, force: true })
  }
})

test('only the same lineage can recover a dead preflight owner', async () => {
  const claimsRoot = await mkdtemp(join(tmpdir(), 'wecom-hot-stale-'))
  const requestKey = hotSellingRetryMessageKey({
    hotelId: 'hotel-015',
    expectedDeliveryId,
    operationKey,
  })
  let stale = null
  let recovered = null
  try {
    stale = acquireHotSellingRetryClaim({
      claimsRoot,
      hotelId: 'hotel-015',
      sourceDeliveryId: expectedDeliveryId,
      operationKey,
      requestKey,
      ownerPid: 999_999,
    })
    stale.close()
    stale = null
    const replacementOperation = 'HOT_SELLING_RETRY_AFTER_CRASH'
    assert.throws(
      () => acquireHotSellingRetryClaim({
        claimsRoot,
        hotelId: 'hotel-015',
        sourceDeliveryId: expectedDeliveryId,
        operationKey: replacementOperation,
        requestKey: hotSellingRetryMessageKey({
          hotelId: 'hotel-015',
          expectedDeliveryId,
          operationKey: replacementOperation,
        }),
        allowStalePreflightRecovery: true,
        isProcessAlive: () => false,
      }),
      /WECOM_HOT_SELLING_MANUAL_RECONCILIATION_REQUIRED/u,
    )
    recovered = acquireHotSellingRetryClaim({
      claimsRoot,
      hotelId: 'hotel-015',
      sourceDeliveryId: expectedDeliveryId,
      operationKey,
      requestKey,
      allowStalePreflightRecovery: true,
      isProcessAlive: () => false,
    })
    assert.equal(recovered.stage, 'PREFLIGHT')
    assert.equal(recovered.releasePreflight(), true)
    recovered = null
  } finally {
    stale?.close()
    recovered?.releasePreflight()
    recovered?.close()
    await rm(claimsRoot, { recursive: true, force: true })
  }
})

test('the release package includes every new retry runtime module', async () => {
  const publishScript = await readFile(new URL(
    '../../../infra/ota-standalone-server/scripts/Publish-OtaStandaloneServer.ps1',
    import.meta.url,
  ), 'utf8')
  assert.match(publishScript, /tools\/uat\/wecom-hot-selling-retry\.mjs/u)
  assert.match(publishScript, /tools\/uat\/wecom\/src\/delivery-state\.mjs/u)
})
