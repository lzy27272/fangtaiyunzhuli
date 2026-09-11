import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

import {
  HOT_SELLING_RETRY_REASON_CODE,
  hotSellingRetryMessageKey,
} from '../../../tools/uat/wecom-hot-selling-retry.mjs'

const apiScript = fileURLToPath(
  new URL('../../../tools/uat/ota-standalone-review-api.mjs', import.meta.url),
)
const repoRoot = fileURLToPath(new URL('../../../', import.meta.url))
const tenantId = '10000000-0000-4000-8000-000000000001'
const hotelId = '20000000-0000-4000-8000-000000000001'
const sourceDeliveryId = '11111111-1111-4111-8111-111111111111'
const operationKey = 'RETRY_TEST_0001'
const apiUsername = 'wecom-retry-test'
const apiPassword = 'example-WeCom-Retry-Test-Password-42'

const availablePort = async () => {
  const server = createServer()
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  await new Promise((resolve) => server.close(resolve))
  return address.port
}

const startApi = async (runtimePath) => {
  const port = await availablePort()
  const child = spawn(process.execPath, [apiScript], {
    cwd: repoRoot,
    env: {
      ...process.env,
      OTA_REVIEW_API_PORT: String(port),
      OTA_REVIEW_USERNAME: apiUsername,
      OTA_REVIEW_PASSWORD: apiPassword,
      OTA_REVIEW_ACCESS_TOKEN: 'wecom-hot-selling-retry-test-token',
      OTA_REVIEW_DATA_PATH: join(runtimePath, 'report-sources.json'),
      OTA_REVIEW_COOKIE_SECRETS_PATH: join(
        runtimePath,
        'report-source-cookie-secrets.json',
      ),
      OTA_REVIEW_SECRET_KEY: Buffer.alloc(32, 31).toString('base64url'),
      OTA_REVIEW_PSEUDONYM_SECRET_KEY:
        Buffer.alloc(32, 32).toString('base64url'),
      OTA_REVIEW_AUTO_COLLECTION_ENABLED: 'false',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let stdout = ''
  let stderr = ''
  child.stdout.on('data', (chunk) => { stdout += chunk.toString('utf8') })
  child.stderr.on('data', (chunk) => { stderr += chunk.toString('utf8') })
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (child.exitCode !== null) {
      throw new Error(`WECOM_RETRY_TEST_API_EXITED:${stderr.slice(-1_000)}`)
    }
    try {
      const response = await fetch(`http://127.0.0.1:${port}/health`)
      if (response.ok) {
        return { child, port, stdout: () => stdout }
      }
    } catch {
      // Retry while the isolated local API starts.
    }
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  child.kill()
  throw new Error('WECOM_RETRY_TEST_API_TIMEOUT')
}

const stopApi = async (child) => {
  if (child.exitCode !== null) return
  child.kill()
  await once(child, 'exit')
}

const login = async ({ port }) => {
  const response = await fetch(`http://127.0.0.1:${port}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: apiUsername, password: apiPassword }),
  })
  assert.equal(response.status, 200)
  return (await response.json()).accessToken
}

const retryRequest = async ({ port, token, selectedOperationKey }) => fetch(
  `http://127.0.0.1:${port}/api/v1/ota/tenants/${tenantId}`
    + `/hotels/${hotelId}/wecom-hot-selling-retry-deliveries`,
  {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      expectedDeliveryId: sourceDeliveryId,
      operationKey: selectedOperationKey,
      reasonCode: HOT_SELLING_RETRY_REASON_CODE,
    }),
  },
)

const requestKeyFor = (selectedOperationKey = operationKey) =>
  hotSellingRetryMessageKey({
    hotelId,
    expectedDeliveryId: sourceDeliveryId,
    operationKey: selectedOperationKey,
  })

const rejectedSourceDelivery = (hotSellingRetryResolution) => ({
  deliveryId: sourceDeliveryId,
  messageKey: `${hotelId}:TEST:HOT_SOURCE`,
  hotelId,
  deliveryType: 'HOT_SELLING_SOLD_OUT',
  businessDate: '2026-09-11',
  cutoffAt: '2026-09-11T03:00:00.000Z',
  attemptedAt: '2026-09-11T03:01:00.000Z',
  completedAt: '2026-09-11T03:01:01.000Z',
  deliveryStatus: 'REJECTED',
  reasonCode: 'WECOM_HTTP_ERROR',
  httpStatus: 500,
  weComCode: null,
  networkAttempted: true,
  partCount: 1,
  deliveredPartCount: 0,
  parts: [{
    partNo: 1,
    deliveryStatus: 'REJECTED',
    reasonCode: 'WECOM_HTTP_ERROR',
    httpStatus: 500,
    weComCode: null,
    networkAttempted: true,
  }],
  hotSellingRetryResolution,
})

const seedRuntime = async (runtimePath, deliveries) => {
  await writeFile(join(runtimePath, 'report-sources.json'), '{}\n', 'utf8')
  await writeFile(
    join(runtimePath, 'wecom-deliveries.json'),
    `${JSON.stringify(deliveries, null, 2)}\n`,
    'utf8',
  )
}

test('persisted hot-selling retry results replay across restart without a second send', {
  timeout: 15_000,
}, async () => {
  const runtimePath = await mkdtemp(join(tmpdir(), 'wecom-hot-retry-'))
  const requestKey = requestKeyFor()
  const sourceDelivery = rejectedSourceDelivery({
    requestKey,
    status: 'SKIPPED',
    skippedReasonCode: 'HOT_SELLING_SOLD_OUT_NONE',
    collectionRunId: 'seed-run',
    cutoffAt: '2026-09-11T03:00:00.000Z',
    completedAt: '2026-09-11T03:02:00.000Z',
  })
  let first = null
  let second = null
  try {
    await seedRuntime(runtimePath, [sourceDelivery])

    first = await startApi(runtimePath)
    const firstToken = await login(first)
    const [firstReplay, concurrentReplay] = await Promise.all([
      retryRequest({
        port: first.port,
        token: firstToken,
        selectedOperationKey: operationKey,
      }),
      retryRequest({
        port: first.port,
        token: firstToken,
        selectedOperationKey: operationKey,
      }),
    ])
    assert.equal(firstReplay.status, 200)
    assert.equal(concurrentReplay.status, 200)
    for (const response of [firstReplay, concurrentReplay]) {
      const result = (await response.json()).data
      assert.equal(result.operationKey, operationKey)
      assert.equal(result.sourceDeliveryId, sourceDeliveryId)
      assert.equal(result.overallStatus, 'SKIPPED')
      assert.equal(result.skippedReasonCode, 'HOT_SELLING_SOLD_OUT_NONE')
      assert.equal(result.replayed, true)
      assert.equal(result.delivery, null)
    }

    const conflictingRetry = await retryRequest({
      port: first.port,
      token: firstToken,
      selectedOperationKey: 'RETRY_TEST_0002',
    })
    assert.equal(conflictingRetry.status, 400)
    assert.equal(
      (await conflictingRetry.json()).code,
      'WECOM_HOT_SELLING_RETRY_ALREADY_ATTEMPTED',
    )
    assert.doesNotMatch(
      first.stdout(),
      /WECOM_HOT_SELLING_RETRY_COMPLETED/u,
    )

    await stopApi(first.child)
    first = null
    second = await startApi(runtimePath)
    const secondToken = await login(second)
    const restartedReplay = await retryRequest({
      port: second.port,
      token: secondToken,
      selectedOperationKey: operationKey,
    })
    assert.equal(restartedReplay.status, 200)
    const restartedResult = (await restartedReplay.json()).data
    assert.equal(restartedResult.overallStatus, 'SKIPPED')
    assert.equal(restartedResult.replayed, true)
    assert.equal(restartedResult.collectionRunId, 'seed-run')
    assert.doesNotMatch(
      second.stdout(),
      /WECOM_HOT_SELLING_RETRY_COMPLETED/u,
    )

    const persisted = JSON.parse(await readFile(
      join(runtimePath, 'wecom-deliveries.json'),
      'utf8',
    ))
    assert.equal(persisted.length, 1)
    assert.equal(
      persisted[0].hotSellingRetryResolution.requestKey,
      requestKey,
    )
  } finally {
    if (first) await stopApi(first.child)
    if (second) await stopApi(second.child)
    await rm(runtimePath, { recursive: true, force: true })
  }
})

test('an interrupted retry child becomes ambiguous and is never sent again', {
  timeout: 15_000,
}, async () => {
  const runtimePath = await mkdtemp(join(tmpdir(), 'wecom-hot-ambiguous-'))
  const requestKey = requestKeyFor()
  const childDeliveryId = '22222222-2222-4222-8222-222222222222'
  const sourceDelivery = rejectedSourceDelivery({
    requestKey,
    status: 'SENDING',
    skippedReasonCode: null,
    collectionRunId: 'interrupted-run',
    cutoffAt: '2026-09-11T03:05:00.000Z',
    deliveryId: childDeliveryId,
    completedAt: null,
  })
  const childDelivery = {
    deliveryId: childDeliveryId,
    messageKey: requestKey,
    deliveryType: 'HOT_SELLING_SOLD_OUT',
    hotelId,
    businessDate: '2026-09-11',
    cutoffAt: '2026-09-11T03:05:00.000Z',
    attemptedAt: '2026-09-11T03:05:01.000Z',
    completedAt: null,
    deliveryStatus: 'SENDING',
    reasonCode: 'WECOM_BUNDLE_SENDING',
    httpStatus: null,
    weComCode: null,
    networkAttempted: false,
    partCount: 1,
    deliveredPartCount: 0,
    parts: [],
    retrySourceDeliveryId: sourceDeliveryId,
    retryOperationKey: operationKey,
  }
  let api = null
  try {
    await seedRuntime(runtimePath, [sourceDelivery, childDelivery])
    api = await startApi(runtimePath)
    const token = await login(api)
    const replay = await retryRequest({
      port: api.port,
      token,
      selectedOperationKey: operationKey,
    })
    assert.equal(replay.status, 200)
    const result = (await replay.json()).data
    assert.equal(result.replayed, true)
    assert.equal(result.overallStatus, 'AMBIGUOUS')
    assert.equal(result.delivery.deliveryId, childDeliveryId)
    assert.equal(
      result.delivery.reasonCode,
      'WECOM_PROCESS_INTERRUPTED_RESULT_UNKNOWN',
    )
    assert.equal(result.delivery.networkAttempted, null)

    const conflictingRetry = await retryRequest({
      port: api.port,
      token,
      selectedOperationKey: 'RETRY_TEST_0002',
    })
    assert.equal(conflictingRetry.status, 400)
    assert.equal(
      (await conflictingRetry.json()).code,
      'WECOM_HOT_SELLING_RETRY_ALREADY_ATTEMPTED',
    )
    assert.doesNotMatch(
      api.stdout(),
      /WECOM_HOT_SELLING_RETRY_COMPLETED/u,
    )

    const persisted = JSON.parse(await readFile(
      join(runtimePath, 'wecom-deliveries.json'),
      'utf8',
    ))
    const persistedSource = persisted.find(
      (delivery) => delivery.deliveryId === sourceDeliveryId,
    )
    const persistedChild = persisted.find(
      (delivery) => delivery.deliveryId === childDeliveryId,
    )
    assert.equal(
      persistedSource.hotSellingRetryResolution.status,
      'AMBIGUOUS',
    )
    assert.equal(persistedChild.deliveryStatus, 'AMBIGUOUS')
    assert.equal(
      persistedChild.reasonCode,
      'WECOM_PROCESS_INTERRUPTED_RESULT_UNKNOWN',
    )
  } finally {
    if (api) await stopApi(api.child)
    await rm(runtimePath, { recursive: true, force: true })
  }
})

test('a preflight-only marker rejects a different lineage after a crash', {
  timeout: 15_000,
}, async () => {
  const runtimePath = await mkdtemp(join(tmpdir(), 'wecom-hot-preflight-'))
  const sourceDelivery = rejectedSourceDelivery({
    requestKey: requestKeyFor('RETRY_TEST_OLD_0001'),
    status: 'SENDING',
    skippedReasonCode: null,
    collectionRunId: 'preflight-run',
    cutoffAt: '2026-09-11T03:10:00.000Z',
    deliveryId: null,
    completedAt: null,
  })
  let api = null
  try {
    await seedRuntime(runtimePath, [sourceDelivery])
    api = await startApi(runtimePath)
    const token = await login(api)
    const response = await retryRequest({
      port: api.port,
      token,
      selectedOperationKey: operationKey,
    })
    assert.equal(response.status, 400)
    assert.equal(
      (await response.json()).code,
      'WECOM_HOT_SELLING_RETRY_ALREADY_ATTEMPTED',
    )
    assert.doesNotMatch(
      api.stdout(),
      /WECOM_HOT_SELLING_RETRY_COMPLETED/u,
    )

    const persisted = JSON.parse(await readFile(
      join(runtimePath, 'wecom-deliveries.json'),
      'utf8',
    ))
    assert.equal(persisted.length, 1)
    assert.equal(persisted[0].hotSellingRetryResolution.status, 'SENDING')
    assert.equal(
      persisted[0].hotSellingRetryResolution.requestKey,
      requestKeyFor('RETRY_TEST_OLD_0001'),
    )
  } finally {
    if (api) await stopApi(api.child)
    await rm(runtimePath, { recursive: true, force: true })
  }
})
