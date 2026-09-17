import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { createServer } from 'node:http'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const apiScript = fileURLToPath(
  new URL('../../../tools/uat/ota-standalone-review-api.mjs', import.meta.url),
)
const repoRoot = fileURLToPath(new URL('../../../', import.meta.url))
const token = 'ota-controlled-login-reliability-test-token'
const tenantId = '10000000-0000-4000-8000-000000000001'
const hotelIds = [
  '20000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000002',
]

const persistedFliggySource = (sourceId, lastLoginStatus) => ({
  sourceId,
  displayName: `飞猪-${lastLoginStatus}`,
  platformCode: 'FLIGGY',
  portalUrl: '',
  dataEndpointUrl: '',
  requestMethod: 'GET',
  requestPayloadJson: '',
  pollIntervalMinutes: 120,
  pollIntervalPolicyVersion: 1,
  enabled: true,
  lastLoginStatus,
  lastLoginAttemptAt: '2026-09-17T00:00:00.000Z',
  rowVersion: 1,
})

async function availablePort() {
  const server = createServer()
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address()
  await new Promise((resolve) => server.close(resolve))
  return port
}

async function waitForReviewApi(port, child) {
  let lastError = null
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (child.exitCode !== null) break
    try {
      const response = await fetch(`http://127.0.0.1:${port}/health`)
      if (response.ok) return
    } catch (error) {
      lastError = error
    }
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  throw lastError ?? new Error('REVIEW_API_START_FAILED')
}

async function stopReviewApi(child) {
  if (child.exitCode !== null) return
  child.kill('SIGTERM')
  await once(child, 'exit')
}

test('controlled login service keeps the abort, revision, and mutex contracts', async () => {
  const source = await readFile(apiScript, 'utf8')
  assert.match(source, /otaControlledLoginRevisionFor/)
  assert.match(source, /OTA_CHANNEL_CREDENTIALS_CHANGED/)
  assert.match(
    source,
    /withFliggyControlledLoginTimeout\(\s*\(timeoutSignal\) => startFliggyControlledLogin/,
  )
  assert.match(
    source,
    /active\.login\.submit\(answer, \{\s*signal:/,
  )
  assert.match(source, /if \(otaControlledLoginLocks\.has\(key\)\)/)
  assert.match(source, /await invalidateChangedOtaControlledLogin/)
  assert.match(source, /handle\.abortController\.abort\(\)/)
  assert.match(source, /active\.login\?\.close\(\)/)

  const startBlock = source.slice(
    source.indexOf('const startOtaControlledLoginFor'),
    source.indexOf('const submitOtaControlledLoginAnswer'),
  )
  assert.match(
    startBlock,
    /await cleanExpiredOtaControlledLogin[\s\S]*?if \(shuttingDown\)/,
  )
  const submitBlock = source.slice(
    source.indexOf('const submitOtaControlledLoginAnswer'),
    source.indexOf('const safeOtaRefreshErrorCode'),
  )
  assert.match(
    submitBlock,
    /await cleanExpiredOtaControlledLogin[\s\S]*?if \(shuttingDown\)/,
  )

  const cleanupBlock = source.slice(
    source.indexOf('const cleanExpiredOtaControlledLogin'),
    source.indexOf('const invalidateChangedOtaControlledLogin'),
  )
  assert.ok(
    cleanupBlock.indexOf('otaControlledLoginLocks.has(key)')
      < cleanupBlock.indexOf(
        'activeOtaControlledLoginAttempts.get(key)',
      ),
  )
  assert.ok(
    cleanupBlock.indexOf('updateOtaPlatformLoginState')
      < cleanupBlock.indexOf('active.login.close()'),
  )

  const saveBlock = source.slice(
    source.indexOf("request.method === 'POST' && suffix === '/ota-sources'"),
    source.indexOf("suffix === '/ota-source-refreshes'"),
  )
  assert.match(saveBlock, /await invalidateChangedOtaControlledLogin/)
  assert.match(saveBlock, /otaSourcesByHotel\.get\(hotelId\)/)

  const shutdownBlock = source.slice(source.indexOf('const shutdown = async'))
  assert.ok(
    shutdownBlock.indexOf('setTimeout(() => process.exit(0), 2_000)')
      < shutdownBlock.indexOf('server.close(resolveClose)'),
  )
  assert.ok(
    shutdownBlock.indexOf('server.close(resolveClose)')
      < shutdownBlock.indexOf('await Promise.allSettled'),
  )
})

test('startup recovers persisted running and verification login states', { timeout: 15_000 }, async () => {
  const runtimePath = await mkdtemp(
    join(tmpdir(), 'sfg-ota-controlled-login-recovery-'),
  )
  const configPath = join(runtimePath, 'ota-source-configs.json')
  const states = ['RUNNING', 'VERIFICATION_REQUIRED']
  const persisted = Object.fromEntries(hotelIds.map((hotelId, index) => [
    hotelId,
    [persistedFliggySource(
      `40000000-0000-4000-8000-00000000002${index}`,
      states[index],
    )],
  ]))
  await writeFile(configPath, `${JSON.stringify(persisted, null, 2)}\n`)
  const port = await availablePort()
  const child = spawn(process.execPath, [apiScript], {
    cwd: repoRoot,
    env: {
      ...process.env,
      OTA_REVIEW_API_PORT: String(port),
      OTA_REVIEW_USERNAME: 'review-test',
      OTA_REVIEW_PASSWORD: 'example-Review-Test-Password-42',
      OTA_REVIEW_ACCESS_TOKEN: token,
      OTA_REVIEW_DATA_PATH: join(runtimePath, 'report-sources.json'),
      OTA_REVIEW_COOKIE_SECRETS_PATH: join(
        runtimePath,
        'report-source-cookie-secrets.json',
      ),
      OTA_REVIEW_SECRET_KEY: Buffer.alloc(32, 7).toString('base64url'),
      OTA_REVIEW_PSEUDONYM_SECRET_KEY:
        Buffer.alloc(32, 8).toString('base64url'),
      OTA_REVIEW_AUTO_COLLECTION_ENABLED: 'false',
    },
    stdio: 'ignore',
  })
  try {
    await waitForReviewApi(port, child)
    for (const hotelId of hotelIds) {
      const response = await fetch(
        `http://127.0.0.1:${port}/api/v1/ota/tenants/`
        + `${tenantId}/hotels/${hotelId}/ota-controlled-logins`,
        { headers: { Authorization: `Bearer ${token}` } },
      )
      assert.equal(response.status, 200)
      const body = await response.json()
      assert.equal(body.data[0].status, 'FAILED')
      assert.equal(
        body.data[0].lastErrorCode,
        'OTA_FLIGGY_LOGIN_INTERRUPTED',
      )
      assert.equal(body.data[0].challengeActive, false)
    }
    const recovered = JSON.parse(await readFile(configPath, 'utf8'))
    for (const hotelId of hotelIds) {
      assert.equal(recovered[hotelId][0].lastLoginStatus, 'FAILED')
      assert.equal(
        recovered[hotelId][0].lastLoginErrorCode,
        'OTA_FLIGGY_LOGIN_INTERRUPTED',
      )
    }
  } finally {
    await stopReviewApi(child)
    await rm(runtimePath, { recursive: true, force: true })
  }
})
