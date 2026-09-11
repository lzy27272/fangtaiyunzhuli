import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { once } from 'node:events'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const apiScript = fileURLToPath(
  new URL('../../../tools/uat/ota-standalone-review-api.mjs', import.meta.url),
)
const repoRoot = fileURLToPath(new URL('../../../', import.meta.url))
const tenantId = '10000000-0000-4000-8000-000000000001'
const hotelId = '20000000-0000-4000-8000-000000000001'
const apiUsername = 'wecom-ledger-boundary-admin'
const apiPassword = 'WeCom-Ledger-Boundary-Password-42'

const legacyHotSellingBody = [
  '【热销房型售罄预警】',
  '测试酒店｜独立库存预警',
  '⏰截止 09-11 11:00｜营业日 09-11',
  '',
  '售罄房型｜系统信息·PRO大床房',
  '建议处理｜立即复核渠道价格、房态和后续库存释放策略。',
  '发送规则｜今日经营、远期房态两类简报送达后1分钟独立发送。',
  '判定规则｜仅可靠可售量为0或以下时触发；数据缺失不误报。',
].join('\n')
const legacyHotSellingBodySha256 = createHash('sha256')
  .update(legacyHotSellingBody, 'utf8')
  .digest('hex')
const canonicalLegacyHotSellingMessageKey =
  `${hotelId}:2026-09-11:2026-09-11T11:HOT_SELLING_SOLD_OUT_V1`

const legacyHotSellingDelivery = () => ({
  deliveryId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  messageKey: canonicalLegacyHotSellingMessageKey,
  deliveryType: 'HOT_SELLING_SOLD_OUT',
  hotelId,
  businessDate: '2026-09-11',
  cutoffAt: '2026-09-11T11:00:00+08:00',
  attemptedAt: '2026-09-11T11:09:00+08:00',
  completedAt: '2026-09-11T11:09:01+08:00',
  deliveryStatus: 'REJECTED',
  reasonCode: 'WECOM_BUNDLE_REJECTED',
  endpointSha256: 'e'.repeat(64),
  messageSha256: legacyHotSellingBodySha256,
  httpStatus: null,
  weComCode: null,
  automaticRetryAttempted: false,
  partCount: 1,
  deliveredPartCount: 0,
  parts: [{
    partNo: 1,
    messageSha256: legacyHotSellingBodySha256,
    deliveryStatus: 'REJECTED',
    reasonCode: 'WECOM_PAYLOAD_INVALID',
    httpStatus: null,
    weComCode: null,
  }],
  bodyPreview: legacyHotSellingBody,
})

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
      OTA_REVIEW_ACCESS_TOKEN: 'wecom-ledger-boundary-token',
      OTA_REVIEW_DATA_PATH: join(runtimePath, 'report-sources.json'),
      OTA_REVIEW_COOKIE_SECRETS_PATH: join(
        runtimePath,
        'report-source-cookie-secrets.json',
      ),
      OTA_REVIEW_SECRET_KEY: Buffer.alloc(32, 41).toString('base64url'),
      OTA_REVIEW_PSEUDONYM_SECRET_KEY:
        Buffer.alloc(32, 42).toString('base64url'),
      OTA_REVIEW_AUTO_COLLECTION_ENABLED: 'false',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let stderr = ''
  child.stderr.on('data', (chunk) => { stderr += chunk.toString('utf8') })
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (child.exitCode !== null) {
      throw new Error(`WECOM_LEDGER_TEST_API_EXITED:${stderr.slice(-1_000)}`)
    }
    try {
      const response = await fetch(`http://127.0.0.1:${port}/health`)
      if (response.ok) return { child, port }
    } catch {
      // Retry while the isolated local API starts.
    }
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  child.kill()
  throw new Error(`WECOM_LEDGER_TEST_API_TIMEOUT:${stderr.slice(-1_000)}`)
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

const hotelApiUrl = (port, suffix) =>
  `http://127.0.0.1:${port}/api/v1/ota/tenants/${tenantId}`
  + `/hotels/${hotelId}${suffix}`

const seedRuntime = async (runtimePath, ledgerText) => {
  await writeFile(join(runtimePath, 'report-sources.json'), '{}\n', 'utf8')
  await writeFile(
    join(runtimePath, 'wecom-deliveries.json'),
    ledgerText,
    'utf8',
  )
}

test('a new runtime creates an explicit empty delivery ledger', {
  timeout: 15_000,
}, async () => {
  const runtimePath = await mkdtemp(join(tmpdir(), 'wecom-ledger-new-'))
  let api = null
  try {
    await writeFile(join(runtimePath, 'report-sources.json'), '{}\n', 'utf8')
    api = await startApi(runtimePath)
    const health = await (await fetch(
      `http://127.0.0.1:${api.port}/health`,
    )).json()
    assert.equal(health.status, 'UP')
    assert.equal(health.outboundDeliveryReady, true)
    assert.deepEqual(JSON.parse(await readFile(
      join(runtimePath, 'wecom-deliveries.json'),
      'utf8',
    )), [])
  } finally {
    if (api) await stopApi(api.child)
    await rm(runtimePath, { recursive: true, force: true })
  }
})

test('a missing ledger after WeCom configuration fails closed', {
  timeout: 15_000,
}, async () => {
  const runtimePath = await mkdtemp(join(tmpdir(), 'wecom-ledger-missing-'))
  let api = null
  try {
    await writeFile(join(runtimePath, 'report-sources.json'), '{}\n', 'utf8')
    await writeFile(join(runtimePath, 'wecom-configs.json'), '{}\n', 'utf8')
    api = await startApi(runtimePath)

    const health = await (await fetch(
      `http://127.0.0.1:${api.port}/health`,
    )).json()
    assert.equal(health.status, 'DEGRADED')
    assert.equal(health.outboundDeliveryReady, false)
    assert.equal(
      health.outboundDeliveryBlockedReasonCode,
      'WECOM_DELIVERY_LEDGER_MISSING',
    )
    await assert.rejects(
      readFile(join(runtimePath, 'wecom-deliveries.json'), 'utf8'),
      /ENOENT/u,
    )

    const token = await login(api)
    const outboxResponse = await fetch(
      hotelApiUrl(api.port, '/outbox-preview'),
      { headers: { Authorization: `Bearer ${token}` } },
    )
    assert.equal(outboxResponse.status, 503)
    assert.deepEqual(await outboxResponse.json(), {
      code: 'WECOM_DELIVERY_LEDGER_UNAVAILABLE',
    })
  } finally {
    if (api) await stopApi(api.child)
    await rm(runtimePath, { recursive: true, force: true })
  }
})

test('invalid WeCom ledger degrades health and blocks authenticated outbox reads', {
  timeout: 15_000,
}, async () => {
  const runtimePath = await mkdtemp(join(tmpdir(), 'wecom-ledger-invalid-'))
  let api = null
  try {
    await seedRuntime(runtimePath, '{ invalid-json')
    api = await startApi(runtimePath)

    const healthResponse = await fetch(
      `http://127.0.0.1:${api.port}/health`,
    )
    assert.equal(healthResponse.status, 200)
    const health = await healthResponse.json()
    assert.equal(health.status, 'DEGRADED')
    assert.equal(health.outboundDeliveryReady, false)
    assert.equal(health.outboundDeliveryEnabled, false)
    assert.equal(
      health.outboundDeliveryBlockedReasonCode,
      'WECOM_DELIVERY_LEDGER_INVALID',
    )

    const token = await login(api)
    const outboxResponse = await fetch(
      hotelApiUrl(api.port, '/outbox-preview'),
      { headers: { Authorization: `Bearer ${token}` } },
    )
    assert.equal(outboxResponse.status, 503)
    assert.deepEqual(await outboxResponse.json(), {
      code: 'WECOM_DELIVERY_LEDGER_UNAVAILABLE',
    })
  } finally {
    if (api) await stopApi(api.child)
    await rm(runtimePath, { recursive: true, force: true })
  }
})

test('the exact historical pre-HTTP failure is migrated and survives restart', {
  timeout: 15_000,
}, async () => {
  const runtimePath = await mkdtemp(join(tmpdir(), 'wecom-ledger-old-hot-'))
  let api = null
  try {
    const delivery = legacyHotSellingDelivery()
    const ledgerPath = join(runtimePath, 'wecom-deliveries.json')
    await seedRuntime(
      runtimePath,
      `${JSON.stringify([delivery], null, 2)}\n`,
    )
    api = await startApi(runtimePath)
    const token = await login(api)
    const response = await fetch(
      hotelApiUrl(api.port, '/outbox-preview'),
      { headers: { Authorization: `Bearer ${token}` } },
    )
    assert.equal(response.status, 200)
    const body = await response.json()
    assert.equal(body.data.length, 1)
    assert.equal(body.data[0].eventId, delivery.deliveryId)
    assert.equal(body.data[0].reasonCode, 'WECOM_PAYLOAD_INVALID')
    assert.equal(body.data[0].networkAttempted, false)
    assert.equal(body.data[0].retryEligible, true)

    await stopApi(api.child)
    api = null
    const firstPersisted = JSON.parse(await readFile(ledgerPath, 'utf8'))[0]
    assert.equal(firstPersisted.networkAttempted, false)
    assert.equal(firstPersisted.parts[0].networkAttempted, false)
    assert.deepEqual(
      Object.keys(firstPersisted.networkAttemptedInference).sort(),
      ['inference', 'migratedAt', 'version'],
    )
    assert.equal(
      firstPersisted.networkAttemptedInference.inference,
      'LEGACY_PRE_FETCH_PAYLOAD_INVALID',
    )
    assert.equal(firstPersisted.networkAttemptedInference.version, 1)
    assert.ok(Number.isFinite(new Date(
      firstPersisted.networkAttemptedInference.migratedAt,
    ).getTime()))

    api = await startApi(runtimePath)
    const restartedToken = await login(api)
    const restartedResponse = await fetch(
      hotelApiUrl(api.port, '/outbox-preview'),
      { headers: { Authorization: `Bearer ${restartedToken}` } },
    )
    assert.equal(restartedResponse.status, 200)
    const restartedBody = await restartedResponse.json()
    assert.equal(restartedBody.data[0].networkAttempted, false)
    await stopApi(api.child)
    api = null
    const secondPersisted = JSON.parse(await readFile(ledgerPath, 'utf8'))[0]
    assert.deepEqual(secondPersisted, firstPersisted)
  } finally {
    if (api) await stopApi(api.child)
    await rm(runtimePath, { recursive: true, force: true })
  }
})

test('near-match historical failures never receive inferred network evidence', {
  timeout: 60_000,
}, async () => {
  const cases = [
    ['top-level network evidence is null', (delivery) => {
      delivery.networkAttempted = null
    }],
    ['part network evidence is true', (delivery) => {
      delivery.parts[0].networkAttempted = true
    }],
    ['message key is not canonical', (delivery) => {
      delivery.messageKey =
        `${hotelId}:2026-09-11:11:HOT_SELLING_SOLD_OUT_V1`
    }],
    ['cutoff contradicts the historical body', (delivery) => {
      delivery.cutoffAt = '2026-09-11T12:00:00+08:00'
      delivery.messageKey =
        `${hotelId}:2026-09-11:2026-09-11T12:HOT_SELLING_SOLD_OUT_V1`
    }],
    ['the delivery is not exactly one complete part', (delivery) => {
      delivery.partCount = 2
    }],
    ['the historical body is not approved', (delivery) => {
      delivery.bodyPreview = delivery.bodyPreview.replace(
        '建议处理｜立即复核渠道价格、房态和后续库存释放策略。',
        '建议处理｜未知旧模板。',
      )
      const bodyHash = createHash('sha256')
        .update(delivery.bodyPreview, 'utf8')
        .digest('hex')
      delivery.messageSha256 = bodyHash
      delivery.parts[0].messageSha256 = bodyHash
    }],
    ['the body discloses an existing retry lineage', (delivery) => {
      delivery.bodyPreview = delivery.bodyPreview.replace(
        '测试酒店｜独立库存预警',
        '测试酒店｜独立库存预警｜系统安全补偿',
      )
      const bodyHash = createHash('sha256')
        .update(delivery.bodyPreview, 'utf8')
        .digest('hex')
      delivery.messageSha256 = bodyHash
      delivery.parts[0].messageSha256 = bodyHash
    }],
    ['the body hash is contradictory', (delivery) => {
      delivery.messageSha256 = 'f'.repeat(64)
    }],
    ['retry lineage already exists', (delivery) => {
      delivery.retrySourceDeliveryId =
        'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
    }],
    ['a retry child already points to the source', (delivery, records) => {
      const child = legacyHotSellingDelivery()
      child.deliveryId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
      child.messageKey =
        `${hotelId}:2026-09-11:2026-09-11T12:HOT_SELLING_SOLD_OUT_V1`
      child.cutoffAt = '2026-09-11T12:00:00+08:00'
      child.retrySourceDeliveryId = delivery.deliveryId
      records.push(child)
    }],
    ['an automatic retry was already attempted', (delivery) => {
      delivery.automaticRetryAttempted = true
    }],
  ]

  for (const [name, mutate] of cases) {
    const runtimePath = await mkdtemp(join(tmpdir(), 'wecom-ledger-near-hot-'))
    let api = null
    try {
      const candidate = legacyHotSellingDelivery()
      const records = [candidate]
      mutate(candidate, records)
      const ledgerPath = join(runtimePath, 'wecom-deliveries.json')
      const seeded = `${JSON.stringify(records, null, 2)}\n`
      await seedRuntime(runtimePath, seeded)
      api = await startApi(runtimePath)
      const health = await (await fetch(
        `http://127.0.0.1:${api.port}/health`,
      )).json()
      assert.equal(health.status, 'UP', name)
      await stopApi(api.child)
      api = null
      assert.equal(await readFile(ledgerPath, 'utf8'), seeded, name)
      for (const persisted of JSON.parse(seeded)) {
        assert.equal(
          Object.hasOwn(persisted, 'networkAttemptedInference'),
          false,
          name,
        )
      }
    } finally {
      if (api) await stopApi(api.child)
      await rm(runtimePath, { recursive: true, force: true })
    }
  }
})

test('legacy WeCom test POST endpoints stay disabled without changing ledger', {
  timeout: 15_000,
}, async () => {
  const runtimePath = await mkdtemp(join(tmpdir(), 'wecom-legacy-disabled-'))
  const ledgerPath = join(runtimePath, 'wecom-deliveries.json')
  let api = null
  try {
    await seedRuntime(runtimePath, '[]\n')
    api = await startApi(runtimePath)
    const token = await login(api)

    for (const suffix of [
      '/wecom-test-deliveries',
      '/wecom-future-test-deliveries',
    ]) {
      const before = await readFile(ledgerPath, 'utf8')
      const response = await fetch(hotelApiUrl(api.port, suffix), {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ reasonCode: 'LEGACY_TEST_MUST_STAY_OFF' }),
      })
      assert.equal(response.status, 400, suffix)
      assert.deepEqual(await response.json(), {
        code: 'WECOM_LEGACY_TEST_ENDPOINT_DISABLED',
      })
      assert.equal(await readFile(ledgerPath, 'utf8'), before, suffix)
      assert.deepEqual(JSON.parse(before), [])
    }
  } finally {
    if (api) await stopApi(api.child)
    await rm(runtimePath, { recursive: true, force: true })
  }
})

test('ledger persistence failure permanently closes the outbound gate', async () => {
  const source = await readFile(apiScript, 'utf8')
  const persistStart = source.indexOf('const persistWeComDeliveries = () =>')
  const persistEnd = source.indexOf(
    'const assertWeComDeliveryLedgerReady = () =>',
    persistStart,
  )
  assert.ok(persistStart >= 0)
  assert.ok(persistEnd > persistStart)
  const persistence = source.slice(persistStart, persistEnd)
  assert.match(
    persistence,
    /catch \(error\) \{[\s\S]*?weComDeliveryLedgerReady = false/u,
  )
  assert.match(
    persistence,
    /weComDeliveryLedgerReasonCode = 'WECOM_DELIVERY_LEDGER_PERSIST_FAILED'/u,
  )
  assert.match(
    persistence,
    /throw new Error\('WECOM_DELIVERY_LEDGER_UNAVAILABLE'/u,
  )
})

test('every outbound delivery path claims its message key before I/O', async () => {
  const source = await readFile(apiScript, 'utf8')
  for (const [functionName, sideEffect] of [
    ['deliverWeComSnapshot', 'sendWeComGroupRobotMessage'],
    ['deliverWeComAuditNotice', 'sendWeComGroupRobotMessage'],
    ['deliverWeComRepairBotDirectMessage', 'deliverWeComRepairBotToAllowedUsers'],
  ]) {
    const start = source.indexOf(`const ${functionName} = async`)
    const end = source.indexOf('\nconst ', start + 1)
    const functionSource = source.slice(start, end)
    const claimIndex = functionSource.indexOf('acquireWeComMessageClaim({')
    const ledgerIndex = functionSource.indexOf(
      'persistWeComDeliveries()',
      claimIndex,
    )
    const markerIndex = functionSource.indexOf(`${sideEffect}(`, ledgerIndex)
    assert.ok(start >= 0, functionName)
    assert.ok(claimIndex >= 0, functionName)
    assert.ok(ledgerIndex > claimIndex, functionName)
    assert.ok(markerIndex > ledgerIndex, functionName)
    assert.match(
      functionSource.slice(ledgerIndex, markerIndex),
      /markLedgerPersisted/u,
      functionName,
    )
  }
})
