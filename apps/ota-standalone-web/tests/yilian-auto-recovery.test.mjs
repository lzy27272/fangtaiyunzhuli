import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import test from 'node:test'

const readSource = (relativePath) => readFile(
  new URL(relativePath, import.meta.url),
  'utf8',
)

const apiScript = fileURLToPath(
  new URL('../../../tools/uat/ota-standalone-review-api.mjs', import.meta.url),
)
const repoRoot = fileURLToPath(new URL('../../../', import.meta.url))
const apiToken = 'yilian-auto-recovery-test-token'

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
      OTA_REVIEW_USERNAME: 'review-test',
      OTA_REVIEW_PASSWORD: 'example-Review-Test-Password-42',
      OTA_REVIEW_ACCESS_TOKEN: apiToken,
      OTA_REVIEW_DATA_PATH: join(runtimePath, 'report-sources.json'),
      OTA_REVIEW_COOKIE_SECRETS_PATH: join(
        runtimePath,
        'report-source-cookie-secrets.json',
      ),
      OTA_REVIEW_SECRET_KEY: Buffer.alloc(32, 21).toString('base64url'),
      OTA_REVIEW_PSEUDONYM_SECRET_KEY: Buffer.alloc(32, 22).toString('base64url'),
      OTA_REVIEW_AUTO_COLLECTION_ENABLED: 'false',
      OTA_REVIEW_YILIAN_ASSISTED_REAUTH_ENABLED: 'true',
    },
    stdio: ['ignore', 'ignore', 'pipe'],
  })
  let stderr = ''
  child.stderr.on('data', (chunk) => { stderr += chunk.toString('utf8') })
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (child.exitCode !== null) {
      throw new Error(`YILIAN_TEST_API_EXITED:${stderr.slice(-1_000)}`)
    }
    try {
      const response = await fetch(`http://127.0.0.1:${port}/health`)
      if (response.ok) return { child, port }
    } catch {
      // Retry while the local API starts.
    }
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  child.kill()
  throw new Error('YILIAN_TEST_API_TIMEOUT')
}

const stopApi = async (child) => {
  if (child.exitCode !== null) return
  child.kill()
  await once(child, 'exit')
}

test('Yilian recovery validates a full three-source shadow before atomic token replacement', async () => {
  const api = await readSource('../../../tools/uat/ota-standalone-review-api.mjs')
  const recoveryStart = api.indexOf('const startYilianCloudRecovery')
  const recoveryEnd = api.indexOf('const scheduledYilianRecoveryTick', recoveryStart)
  const recovery = api.slice(recoveryStart, recoveryEnd)
  const shadowIndex = recovery.indexOf('await collectYilianCloudReports')
  const gateIndex = recovery.indexOf("shadow.run.status !== 'SUCCEEDED'")
  const replaceIndex = recovery.indexOf('replaceYilianAccessToken')
  const activationIndex = recovery.indexOf('activationCommitted = true')

  assert.ok(recoveryStart > 0)
  assert.ok(shadowIndex > 0)
  assert.ok(gateIndex > shadowIndex)
  assert.ok(replaceIndex > gateIndex)
  assert.ok(activationIndex > replaceIndex)
  assert.match(recovery, /shadow\.run\.sourceCount !== 3/u)
  assert.match(recovery, /shadow\.run\.successfulSourceCount !== 3/u)
  assert.match(recovery, /shadow\.run\.outboundDeliveryAttempted !== false/u)
  assert.match(recovery, /cookieSecretsByHotel\.set\(hotelId, previousSecrets\)/u)
  assert.match(recovery, /YILIAN_ACTIVATION_ROLLBACK_FAILED/u)
  assert.doesNotMatch(recovery, /appendAndPersistSnapshot/u)
  assert.doesNotMatch(recovery, /deliverWeComSnapshot/u)
})

test('Yilian recovery is single-store locked and stops automatic retries for human or credential action', async () => {
  const api = await readSource('../../../tools/uat/ota-standalone-review-api.mjs')
  assert.match(api, /const activeYilianRepairsByHotel = new Map\(\)/u)
  assert.match(api, /YILIAN_REAUTH_IN_PROGRESS/u)
  assert.match(api, /YILIAN_SESSION_REAUTH_REQUIRED[\s\S]*startYilianCloudRecovery/u)
  assert.match(api, /const YILIAN_AUTOMATIC_RETRYABLE_ERRORS = new Set/u)
  assert.match(api, /YILIAN_AUTHENTICATION_NOT_COMPLETED/u)
  assert.match(api, /const YILIAN_AUTO_RECOVERY_RETRY_MS = 30 \* 60_000/u)
  assert.match(api, /const yilianAutomaticRecoveryDue/u)
  assert.match(
    api,
    /trigger !== 'MANUAL_REPAIR'[\s\S]{0,240}!yilianAutomaticRecoveryDue/u,
  )
  assert.match(
    api,
    /const previousStatus = yilianRepairStatusRecordFor\(hotelId\)[\s\S]{0,180}yilianRepairRetryAllowed\(previousStatus\)/u,
  )
  assert.match(api, /void scheduledYilianRecoveryTick\(\)/u)
  const morningRepair = api.slice(
    api.indexOf('const repairNightlyBriefingHealthAudit'),
    api.indexOf('const scheduledBriefingAuditTick'),
  )
  assert.match(
    morningRepair,
    /pmsSystemCode === 'YILIAN_CLOUD'[\s\S]*startYilianCloudRecovery\([\s\S]*'DAILY_07_30_REPAIR'/u,
  )
  assert.doesNotMatch(
    morningRepair,
    /pmsSystemCode === 'YILIAN_CLOUD'[\s\S]{0,500}startLuopanRepairChallenge/u,
  )
})

test('Yilian repair UI stores credentials without echo and exposes explicit cloud retry status', async () => {
  const [panel, client, wizard] = await Promise.all([
    readSource('../src/pages/StoreRepairPanel.tsx'),
    readSource('../src/api/business.ts'),
    readSource('../src/pages/NewStoreWizard.tsx'),
  ])
  assert.match(panel, /云端自动登录凭据/u)
  assert.match(panel, /type="password"/u)
  assert.match(panel, /立即尝试云端重登/u)
  assert.match(panel, /失败保留旧令牌和全部接口配置，不触发播报/u)
  assert.match(client, /loadYilianCloudRepair/u)
  assert.match(client, /triggerYilianCloudRepair/u)
  assert.match(client, /TRIGGER_YILIAN_CLOUD_REAUTH/u)
  assert.match(wizard, /\['LUOPAN_CLOUD', 'YILIAN_CLOUD'\]\.includes\(draft\.pmsSystemCode\)/u)
  assert.match(wizard, /驿联云令牌失效时会用本店凭据自动重登/u)
})

test('Yilian recovery runtime and status state are included in release and rollback protection', async () => {
  const [publisher, deployment, runtimeExample] = await Promise.all([
    readSource('../../../infra/ota-standalone-server/scripts/Publish-OtaStandaloneServer.ps1'),
    readSource('../../../infra/ota-standalone-server/scripts/deploy-native.sh'),
    readSource('../../../infra/ota-standalone-server/runtime.env.example'),
  ])
  assert.match(publisher, /tools\/uat\/yilian-assisted-login\.mjs/u)
  assert.match(deployment, /yilian-cloud-repair-statuses\.json/u)
  assert.match(runtimeExample, /OTA_REVIEW_YILIAN_ASSISTED_REAUTH_ENABLED=true/u)
  assert.match(runtimeExample, /YILIAN_BROWSER_EXECUTABLE/u)
})

test('new Yilian stores persist encrypted credentials and expose no secret in repair status', { timeout: 15_000 }, async () => {
  const runtimePath = await mkdtemp(join(tmpdir(), 'yilian-auto-recovery-'))
  let first = null
  let second = null
  const username = 'synthetic-yilian-user'
  const password = 'synthetic-Yilian-Password-42'
  try {
    first = await startApi(runtimePath)
    const create = await fetch(
      `http://127.0.0.1:${first.port}/api/v1/ota/simulation/hotels`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiToken}`,
          'Content-Type': 'application/json',
          'Idempotency-Key': 'create-yilian-auto-recovery-test-store',
        },
        body: JSON.stringify({
          hotelDisplayName: 'Yilian Auto Recovery Test Hotel',
          ownershipType: 'DIRECT',
          pmsSystemCode: 'YILIAN_CLOUD',
          pmsUsername: username,
          pmsPassword: password,
          timezone: 'Asia/Shanghai',
          reasonCode: 'CREATE_STORE_FROM_CONSOLE_WIZARD',
        }),
      },
    )
    assert.equal(create.status, 201)
    const receipt = (await create.json()).data
    assert.equal(receipt.pmsCredentialsConfigured, true)

    const directoryResponse = await fetch(
      `http://127.0.0.1:${first.port}/api/v1/ota/simulation/hotels`,
      { headers: { Authorization: `Bearer ${apiToken}` } },
    )
    const hotel = (await directoryResponse.json()).data.hotels.find(
      (candidate) => candidate.hotelId === receipt.resourceId,
    )
    const base = `http://127.0.0.1:${first.port}/api/v1/ota/tenants/`
      + `${hotel.tenantId}/hotels/${hotel.hotelId}`
    const loginConfig = await fetch(`${base}/pms-login-config`, {
      headers: { Authorization: `Bearer ${apiToken}` },
    })
    const loginView = (await loginConfig.json()).data
    assert.equal(loginView.configured, true)
    assert.equal(loginView.loginMode, 'CLOUD_PASSWORD_AUTO_REAUTH')
    assert.equal(loginView.loginExecutionEnabled, true)

    const repairResponse = await fetch(`${base}/yilian-cloud-repair`, {
      headers: { Authorization: `Bearer ${apiToken}` },
    })
    assert.equal(repairResponse.status, 200)
    const repairView = (await repairResponse.json()).data
    assert.equal(repairView.state, 'IDLE')
    assert.equal(repairView.credentialsConfigured, true)
    assert.equal(JSON.stringify(repairView).includes(username), false)
    assert.equal(JSON.stringify(repairView).includes(password), false)

    const persistedSecrets = await readFile(
      join(runtimePath, 'pms-login-secrets.json'),
      'utf8',
    )
    assert.equal(persistedSecrets.includes(username), false)
    assert.equal(persistedSecrets.includes(password), false)

    await stopApi(first.child)
    first = null
    second = await startApi(runtimePath)
    const restartedLogin = await fetch(
      `http://127.0.0.1:${second.port}/api/v1/auth/login`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: 'review-test',
          password: 'example-Review-Test-Password-42',
        }),
      },
    )
    assert.equal(restartedLogin.status, 200)
    const restartedAccessToken = (await restartedLogin.json()).accessToken
    const restartedBase = `http://127.0.0.1:${second.port}/api/v1/ota/tenants/`
      + `${hotel.tenantId}/hotels/${hotel.hotelId}`
    const restartedRepair = await fetch(`${restartedBase}/yilian-cloud-repair`, {
      headers: { Authorization: `Bearer ${restartedAccessToken}` },
    })
    assert.equal(restartedRepair.status, 200)
    const restartedView = (await restartedRepair.json()).data
    assert.equal(restartedView.credentialsConfigured, true)
    assert.equal(restartedView.state, 'IDLE')
  } finally {
    if (first) await stopApi(first.child)
    if (second) await stopApi(second.child)
    await rm(runtimePath, { recursive: true, force: true })
  }
})
