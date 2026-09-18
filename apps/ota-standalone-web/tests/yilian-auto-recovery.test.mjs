import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
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

const startApi = async (
  runtimePath,
  { automaticCollectionEnabled = false } = {},
) => {
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
      OTA_REVIEW_AUTO_COLLECTION_ENABLED: String(automaticCollectionEnabled),
      OTA_REVIEW_YILIAN_ASSISTED_REAUTH_ENABLED: 'true',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let stdout = ''
  let stderr = ''
  child.stdout.on('data', (chunk) => { stdout += chunk.toString('utf8') })
  child.stderr.on('data', (chunk) => { stderr += chunk.toString('utf8') })
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (child.exitCode !== null) {
      throw new Error(`YILIAN_TEST_API_EXITED:${stderr.slice(-1_000)}`)
    }
    try {
      const response = await fetch(`http://127.0.0.1:${port}/health`)
      if (response.ok) return { child, port, stdout: () => stdout }
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
  const snapshotIndex = recovery.indexOf('appendAndPersistSnapshot')
  const successIndex = recovery.indexOf("state: 'SUCCEEDED'")

  assert.ok(recoveryStart > 0)
  assert.ok(shadowIndex > 0)
  assert.ok(gateIndex > shadowIndex)
  assert.ok(replaceIndex > gateIndex)
  assert.ok(activationIndex > replaceIndex)
  assert.ok(snapshotIndex > activationIndex)
  assert.ok(successIndex > snapshotIndex)
  assert.match(recovery, /shadow\.run\.sourceCount !== 3/u)
  assert.match(recovery, /shadow\.run\.successfulSourceCount !== 3/u)
  assert.match(recovery, /shadow\.run\.outboundDeliveryAttempted !== false/u)
  assert.match(recovery, /cookieSecretsByHotel\.set\(hotelId, previousSecrets\)/u)
  assert.match(recovery, /YILIAN_ACTIVATION_ROLLBACK_FAILED/u)
  assert.match(
    recovery,
    /appendAndPersistSnapshot\([\s\S]{0,160}shadow\.snapshot/u,
  )
  assert.match(recovery, /YILIAN_SNAPSHOT_PERSIST_FAILED/u)
  assert.doesNotMatch(recovery, /deliverWeComSnapshot/u)
})

test('Yilian recovery is single-store locked and stops automatic retries for human or credential action', async () => {
  const api = await readSource('../../../tools/uat/ota-standalone-review-api.mjs')
  assert.match(api, /const activeYilianRepairsByHotel = new Map\(\)/u)
  assert.match(api, /YILIAN_REAUTH_IN_PROGRESS/u)
  assert.match(api, /YILIAN_SESSION_REAUTH_REQUIRED[\s\S]*startYilianCloudRecovery/u)
  assert.match(api, /const YILIAN_AUTOMATIC_RETRYABLE_ERRORS = new Set/u)
  assert.match(api, /'YILIAN_ORDER_PAGINATION_INCOMPLETE'/u)
  assert.match(
    api,
    /YILIAN_AUTOMATIC_RETRYABLE_ERRORS[\s\S]{0,500}'YILIAN_REPORT_CODE_REJECTED'/u,
  )
  assert.match(api, /YILIAN_AUTHENTICATION_NOT_COMPLETED/u)
  assert.match(api, /const YILIAN_AUTO_RECOVERY_RETRY_MS = 30 \* 60_000/u)
  assert.match(api, /const yilianAutomaticRecoveryDue/u)
  assert.match(api, /OUTDATED_REALTIME_ENDPOINT/u)
  assert.match(api, /migrationVersion: 3/u)
  assert.match(api, /migratedYilianReportSources\(sources\)/u)
  assert.match(
    api,
    /!YILIAN_INTERACTIVE_REPAIR_TRIGGERS\.has\(trigger\)[\s\S]{0,240}!yilianAutomaticRecoveryDue/u,
  )
  assert.match(
    api,
    /const previousStatus = yilianRepairStatusRecordFor\(hotelId\)[\s\S]{0,180}yilianRepairRetryAllowed\(previousStatus\)/u,
  )
  assert.match(api, /void scheduledYilianRecoveryTick\(\)/u)
  assert.match(
    api,
    /if \(isNightlyRepairDeferred\(\)\) continue/u,
  )
  const scheduledRecovery = api.slice(
    api.indexOf('const scheduledYilianRecoveryTick'),
    api.indexOf('const processSubmittedLuopanRepair'),
  )
  assert.match(
    scheduledRecovery,
    /const activationPending = yilianInitialActivationPending\(hotel, status\)/u,
  )
  assert.match(api, /const YILIAN_INITIAL_ACTIVATION_TRIGGER/u)
  assert.match(api, /const YILIAN_ACTIVATION_INTENT_TRIGGERS/u)
  assert.match(scheduledRecovery, /SCHEDULED_INITIAL_ACTIVATION/u)
  assert.match(
    scheduledRecovery,
    /const manualRecoveryPending =[\s\S]{0,260}YILIAN_INTERACTIVE_REPAIR_TRIGGERS\.has\(status\.trigger\)/u,
  )
  assert.match(
    scheduledRecovery,
    /manualRecoveryPending[\s\S]{0,120}\? status\.trigger/u,
  )
  assert.doesNotMatch(
    scheduledRecovery,
    /!hotel\.collectionEnabled \|\| !pmsLoginSecretsByHotel/u,
  )
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

test('WeCom Yilian recovery is authorized, asynchronous, cooled down and private', async () => {
  const [api, repairBot] = await Promise.all([
    readSource('../../../tools/uat/ota-standalone-review-api.mjs'),
    readSource('../../../tools/uat/wecom/src/wecom-repair-bot.mjs'),
  ])
  const commandStart = api.indexOf('const YILIAN_WECOM_CREDENTIAL_ERRORS')
  const commandEnd = api.indexOf('const expireLuopanRepairSessions', commandStart)
  const command = api.slice(commandStart, commandEnd)

  assert.ok(commandStart > 0)
  assert.match(api, /const YILIAN_WECOM_REPAIR_COOLDOWN_MS = 5 \* 60_000/u)
  assert.match(api, /const YILIAN_WECOM_REPAIR_TRIGGER = 'WECOM_MANAGER_REPAIR'/u)
  assert.match(command, /authorizedYilianHotelForWeCom/u)
  assert.match(command, /pmsSystemCode === 'YILIAN_CLOUD'/u)
  assert.match(command, /weComRepairBotActionAuthorizedForHotel\(userId, candidate\.hotelId\)/u)
  assert.match(command, /const recovery = plan\.shouldRun[\s\S]{0,260}runYilianWeComRecovery\([\s\S]{0,420}await replyText\(frame, plan\.message\)/u)
  assert.match(command, /onTemplateCardEvent: handleWeComRepairBotTemplateCard/u)
  assert.match(command, /consumeYilianWeComTemplateCard\([\s\S]{0,2200}runYilianWeComRecovery\([\s\S]{0,520}await updateTemplateCard\(frame,/u)
  assert.match(command, /startYilianCloudRecovery\([\s\S]{0,180}YILIAN_WECOM_REPAIR_TRIGGER[\s\S]{0,120}notifyOnActionRequired: false/u)
  assert.match(command, /deliveryType: 'YILIAN_WECOM_REPAIR_RESULT'/u)
  assert.match(command, /scheduledYilianWeComResultTick/u)
  assert.match(command, /currentPmsRepairIncidentForHotel\(hotel, now\)/u)
  assert.match(command, /status\.lastCompletedAt \?\? status\.lastAttemptAt/u)
  assert.match(repairBot, /taskIdSha256/u)
  assert.match(repairBot, /recipientSha256/u)
  assert.match(repairBot, /currentIncidentId !== matched\.action\.incidentId/u)
  assert.match(command, /requesterSha256/u)
  assert.doesNotMatch(command, /username|password|accessToken/u)
})

test('Yilian recovery waits for in-flight collection before replacing tokens', async () => {
  const api = await readSource('../../../tools/uat/ota-standalone-review-api.mjs')
  const recoveryStart = api.indexOf('const startYilianCloudRecovery')
  const recoveryEnd = api.indexOf('const scheduledYilianRecoveryTick', recoveryStart)
  const recovery = api.slice(recoveryStart, recoveryEnd)
  const waitIndex = recovery.indexOf('await Promise.race([')
  const drainIndex = recovery.indexOf('Promise.allSettled(inFlightCollections)')
  const timeoutIndex = recovery.indexOf('YILIAN_COLLECTION_DRAIN_TIMEOUT')
  const loginIndex = recovery.indexOf('await startYilianPasswordLogin')
  const tokenIndex = recovery.indexOf('replaceYilianAccessToken')

  assert.ok(waitIndex > 0)
  assert.ok(drainIndex > waitIndex)
  assert.ok(timeoutIndex > drainIndex)
  assert.ok(loginIndex > waitIndex)
  assert.ok(tokenIndex > loginIndex)
  assert.match(recovery, /liveCollectionLocks\.get\(hotelId\)/u)
  assert.match(recovery, /ISOLATED_NON_PUBLISHING/u)
})

test('Yilian repair UI stores credentials without echo and exposes explicit cloud retry status', async () => {
  const [panel, client, wizard, contextBar] = await Promise.all([
    readSource('../src/pages/StoreRepairPanel.tsx'),
    readSource('../src/api/business.ts'),
    readSource('../src/pages/NewStoreWizard.tsx'),
    readSource('../src/components/HotelContextBar.tsx'),
  ])
  assert.match(panel, /云端自动登录凭据/u)
  assert.match(panel, /type="password"/u)
  assert.match(panel, /一键快速恢复/u)
  assert.match(panel, /失败保留旧令牌和全部接口配置，不触发播报/u)
  assert.match(client, /loadYilianCloudRepair/u)
  assert.match(client, /triggerYilianCloudRepair/u)
  assert.match(client, /TRIGGER_YILIAN_CLOUD_REAUTH/u)
  assert.match(wizard, /\['LUOPAN_CLOUD', 'YILIAN_CLOUD'\]\.includes\(draft\.pmsSystemCode\)/u)
  assert.match(wizard, /驿联云令牌失效时会用本店凭据自动重登/u)
  assert.match(
    contextBar,
    /\['LUOPAN_CLOUD', 'YILIAN_CLOUD'\]\.includes\(draft\.pmsSystemCode\)/u,
  )
  assert.match(contextBar, /pmsUsername: draft\.pmsUsername\.trim\(\)/u)
  assert.match(contextBar, /驿联云PMS账号/u)
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

test('Yilian status persistence failure rolls back memory so recovery can retry', { timeout: 30_000 }, async () => {
  const runtimePath = await mkdtemp(join(tmpdir(), 'yilian-status-rollback-'))
  let api = null
  let blockerPath = null
  try {
    api = await startApi(runtimePath)
    const create = await fetch(
      `http://127.0.0.1:${api.port}/api/v1/ota/simulation/hotels`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiToken}`,
          'Content-Type': 'application/json',
          'Idempotency-Key': 'create-yilian-status-rollback-store',
        },
        body: JSON.stringify({
          hotelCode: '015',
          hotelDisplayName: 'Yilian Status Rollback Test Hotel',
          ownershipType: 'DIRECT',
          pmsSystemCode: 'YILIAN_CLOUD',
          pmsUsername: 'synthetic-yilian-rollback',
          pmsPassword: 'synthetic-Yilian-Rollback-Password-42',
          timezone: 'Asia/Shanghai',
          reasonCode: 'CREATE_STORE_FROM_CONSOLE_WIZARD',
        }),
      },
    )
    assert.equal(create.status, 201)
    const hotelId = (await create.json()).data.resourceId
    const directory = await fetch(
      `http://127.0.0.1:${api.port}/api/v1/ota/simulation/hotels`,
      { headers: { Authorization: `Bearer ${apiToken}` } },
    )
    assert.equal(directory.status, 200)
    const hotel = (await directory.json()).data.hotels.find(
      (candidate) => candidate.hotelId === hotelId,
    )
    assert.ok(hotel)
    const base = `http://127.0.0.1:${api.port}/api/v1/ota/tenants/`
      + `${hotel.tenantId}/hotels/${hotelId}`
    blockerPath = join(
      runtimePath,
      `yilian-cloud-repair-statuses.json.${api.child.pid}.tmp`,
    )
    await mkdir(blockerPath)

    const failed = await fetch(`${base}/yilian-cloud-repair`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ reasonCode: 'TRIGGER_YILIAN_CLOUD_REAUTH' }),
    })
    assert.notEqual(failed.status, 200)

    const afterFailure = await fetch(`${base}/yilian-cloud-repair`, {
      headers: { Authorization: `Bearer ${apiToken}` },
    })
    assert.equal(afterFailure.status, 200)
    const afterFailureStatus = (await afterFailure.json()).data
    assert.equal(afterFailureStatus.active, false)
    assert.equal(afterFailureStatus.state, 'IDLE')
    assert.equal(afterFailureStatus.lastAttemptAt, null)

    await rm(blockerPath, { recursive: true, force: true })
    blockerPath = null
    const clearCredentials = await fetch(`${base}/pms-login-config`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        reasonCode: 'TEST_CLEAR_PMS_CREDENTIALS',
        credentialUpdate: { action: 'CLEAR' },
      }),
    })
    assert.equal(clearCredentials.status, 200)

    const retried = await fetch(`${base}/yilian-cloud-repair`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ reasonCode: 'TRIGGER_YILIAN_CLOUD_REAUTH' }),
    })
    assert.equal(retried.status, 200)
    const retriedStatus = (await retried.json()).data
    assert.equal(retriedStatus.active, false)
    assert.equal(retriedStatus.state, 'CREDENTIALS_REQUIRED')
    assert.equal(typeof retriedStatus.lastErrorCode, 'string')
  } finally {
    if (api) await stopApi(api.child)
    if (blockerPath) await rm(blockerPath, { recursive: true, force: true })
    await rm(runtimePath, { recursive: true, force: true })
  }
})

test('startup reconciles interrupted and already-completed WeCom result outboxes', { timeout: 30_000 }, async () => {
  const runtimePath = await mkdtemp(join(tmpdir(), 'yilian-wecom-restart-'))
  let first = null
  let second = null
  let third = null
  let fourth = null
  try {
    first = await startApi(runtimePath)
    const response = await fetch(
      `http://127.0.0.1:${first.port}/api/v1/ota/simulation/hotels`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiToken}`,
          'Content-Type': 'application/json',
          'Idempotency-Key': 'create-yilian-wecom-restart-test-store',
        },
        body: JSON.stringify({
          hotelCode: '015',
          hotelDisplayName: 'Yilian WeCom Restart Test Hotel',
          ownershipType: 'DIRECT',
          pmsSystemCode: 'YILIAN_CLOUD',
          pmsUsername: 'synthetic-yilian-restart',
          pmsPassword: 'synthetic-Yilian-Restart-Password-42',
          timezone: 'Asia/Shanghai',
          reasonCode: 'CREATE_STORE_FROM_CONSOLE_WIZARD',
        }),
      },
    )
    assert.equal(response.status, 201)
    const hotelId = (await response.json()).data.resourceId
    await stopApi(first.child)
    first = null

    const repairStatusPath = join(
      runtimePath,
      'yilian-cloud-repair-statuses.json',
    )
    const statuses = JSON.parse(await readFile(repairStatusPath, 'utf8'))
    statuses[hotelId] = {
      ...statuses[hotelId],
      state: 'SUCCEEDED',
      trigger: 'WECOM_MANAGER_REPAIR',
      lastAttemptAt: '2026-09-17T03:39:26.000Z',
      lastCompletedAt: '2026-09-17T03:40:38.000Z',
      lastSucceededAt: '2026-09-17T03:40:38.000Z',
      lastErrorCode: null,
      sourceCount: 3,
      successfulSourceCount: 3,
      weComResult: {
        operationIdSha256: 'a'.repeat(64),
        requesterSha256: 'b'.repeat(64),
        pending: true,
        actionSource: 'TEMPLATE_CARD',
        startedAt: '2026-09-17T03:41:00.000Z',
        state: 'RUNNING',
        completedAt: null,
        lastErrorCode: null,
        lastBusinessDate: '2026-09-17',
        sourceCount: 0,
        successfulSourceCount: 0,
        deliveryAttempt: 0,
        lastDeliveryAttemptAt: null,
      },
    }
    await writeFile(
      repairStatusPath,
      `${JSON.stringify(statuses, null, 2)}\n`,
      'utf8',
    )

    second = await startApi(runtimePath)
    const recovered = JSON.parse(
      await readFile(repairStatusPath, 'utf8'),
    )[hotelId]
    assert.equal(recovered.state, 'FAILED')
    assert.equal(recovered.lastErrorCode, 'YILIAN_REPAIR_INTERRUPTED')
    assert.equal(recovered.weComResult.pending, true)
    assert.equal(recovered.weComResult.state, 'FAILED')
    assert.equal(
      recovered.weComResult.lastErrorCode,
      'YILIAN_REPAIR_INTERRUPTED',
    )
    assert.equal(typeof recovered.weComResult.completedAt, 'string')

    await stopApi(second.child)
    second = null
    const completedStatuses = JSON.parse(
      await readFile(repairStatusPath, 'utf8'),
    )
    completedStatuses[hotelId] = {
      ...completedStatuses[hotelId],
      state: 'SUCCEEDED',
      lastCompletedAt: '2026-09-17T03:50:00.000Z',
      lastSucceededAt: '2026-09-17T03:50:00.000Z',
      lastBusinessDate: '2026-09-17',
      lastErrorCode: null,
      sourceCount: 3,
      successfulSourceCount: 3,
      weComResult: {
        ...completedStatuses[hotelId].weComResult,
        pending: true,
        startedAt: '2026-09-17T03:49:00.000Z',
        state: 'RUNNING',
        completedAt: null,
        lastErrorCode: null,
        sourceCount: 0,
        successfulSourceCount: 0,
      },
    }
    await writeFile(
      repairStatusPath,
      `${JSON.stringify(completedStatuses, null, 2)}\n`,
      'utf8',
    )
    third = await startApi(runtimePath)
    const completedRecovery = JSON.parse(
      await readFile(repairStatusPath, 'utf8'),
    )[hotelId]
    assert.equal(completedRecovery.state, 'SUCCEEDED')
    assert.equal(completedRecovery.lastErrorCode, null)
    assert.equal(completedRecovery.weComResult.pending, true)
    assert.equal(completedRecovery.weComResult.state, 'SUCCEEDED')
    assert.equal(
      completedRecovery.weComResult.completedAt,
      '2026-09-17T03:50:00.000Z',
    )
    assert.equal(completedRecovery.weComResult.sourceCount, 3)
    assert.equal(completedRecovery.weComResult.successfulSourceCount, 3)

    await stopApi(third.child)
    third = null
    const unrelatedRunningStatuses = JSON.parse(
      await readFile(repairStatusPath, 'utf8'),
    )
    unrelatedRunningStatuses[hotelId] = {
      ...unrelatedRunningStatuses[hotelId],
      state: 'RUNNING',
      trigger: 'SCHEDULED_REPAIR',
      lastAttemptAt: '2026-09-17T04:00:00.000Z',
      lastCompletedAt: null,
      lastErrorCode: null,
      weComResult: {
        ...unrelatedRunningStatuses[hotelId].weComResult,
        pending: true,
        state: 'SUCCEEDED',
        completedAt: '2026-09-17T03:50:00.000Z',
        lastErrorCode: null,
      },
    }
    await writeFile(
      repairStatusPath,
      `${JSON.stringify(unrelatedRunningStatuses, null, 2)}\n`,
      'utf8',
    )
    fourth = await startApi(runtimePath)
    const unrelatedRecovery = JSON.parse(
      await readFile(repairStatusPath, 'utf8'),
    )[hotelId]
    assert.equal(unrelatedRecovery.state, 'FAILED')
    assert.equal(unrelatedRecovery.lastErrorCode, 'YILIAN_REPAIR_INTERRUPTED')
    assert.equal(unrelatedRecovery.weComResult.pending, true)
    assert.equal(unrelatedRecovery.weComResult.state, 'SUCCEEDED')
    assert.equal(unrelatedRecovery.weComResult.lastErrorCode, null)
  } finally {
    if (first) await stopApi(first.child)
    if (second) await stopApi(second.child)
    if (third) await stopApi(third.child)
    if (fourth) await stopApi(fourth.child)
    await rm(runtimePath, { recursive: true, force: true })
  }
})

test('new Yilian stores persist credentials and safely recover legacy source stores', { timeout: 30_000 }, async () => {
  const runtimePath = await mkdtemp(join(tmpdir(), 'yilian-auto-recovery-'))
  let first = null
  let second = null
  let third = null
  let fourth = null
  let fifth = null
  const username = 'synthetic-yilian-user'
  const syntheticPmsCredential = 'synthetic-Yilian-Password-42'
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
          pmsPassword: syntheticPmsCredential,
          timezone: 'Asia/Shanghai',
          reasonCode: 'CREATE_STORE_FROM_CONSOLE_WIZARD',
        }),
      },
    )
    assert.equal(create.status, 201)
    const receipt = (await create.json()).data
    assert.equal(receipt.pmsCredentialsConfigured, true)
    assert.equal(receipt.copiedReportSourceCount, 3)

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

    const sourceResponse = await fetch(`${base}/report-sources`, {
      headers: { Authorization: `Bearer ${apiToken}` },
    })
    assert.equal(sourceResponse.status, 200)
    const sources = (await sourceResponse.json()).data
    assert.equal(sources.length, 3)
    assert.deepEqual(
      sources.map((source) => new URL(source.endpointUrl).pathname).sort(),
      [
        '/newPms/reportAPP/nowRoomStateReport',
        '/newPms/orderManage/selectAll',
        '/newPms/reportAPP/rateCalendarReport',
      ].sort(),
    )
    assert.equal(sources.every((source) => source.enabled), true)

    const repairResponse = await fetch(`${base}/yilian-cloud-repair`, {
      headers: { Authorization: `Bearer ${apiToken}` },
    })
    assert.equal(repairResponse.status, 200)
    const repairView = (await repairResponse.json()).data
    assert.equal(repairView.state, 'IDLE')
    assert.equal(repairView.credentialsConfigured, true)
    assert.equal(JSON.stringify(repairView).includes(username), false)
    assert.equal(JSON.stringify(repairView).includes(syntheticPmsCredential), false)

    const persistedSecrets = await readFile(
      join(runtimePath, 'pms-login-secrets.json'),
      'utf8',
    )
    assert.equal(persistedSecrets.includes(username), false)
    assert.equal(persistedSecrets.includes(syntheticPmsCredential), false)

    await stopApi(first.child)
    first = null
    const reportSourcePath = join(runtimePath, 'report-sources.json')
    const persistedReportSources = JSON.parse(
      await readFile(reportSourcePath, 'utf8'),
    )
    persistedReportSources[hotel.hotelId] = []
    await writeFile(
      reportSourcePath,
      `${JSON.stringify(persistedReportSources, null, 2)}\n`,
      'utf8',
    )
    const repairStatusPath = join(
      runtimePath,
      'yilian-cloud-repair-statuses.json',
    )
    const persistedRepairStatuses = JSON.parse(
      await readFile(repairStatusPath, 'utf8'),
    )
    assert.equal(
      persistedRepairStatuses[hotel.hotelId].trigger,
      'INITIAL_ACTIVATION_PENDING',
    )
    persistedRepairStatuses[hotel.hotelId] = {
      ...persistedRepairStatuses[hotel.hotelId],
      state: 'FAILED',
      trigger: 'MANUAL_REPAIR',
      lastAttemptAt: '2026-09-11T03:00:00.000Z',
      lastErrorCode: 'YILIAN_SOURCE_CONTRACT_INVALID',
      sourceCount: 0,
      successfulSourceCount: 0,
    }
    await writeFile(
      repairStatusPath,
      `${JSON.stringify(persistedRepairStatuses, null, 2)}\n`,
      'utf8',
    )
    second = await startApi(runtimePath)
    assert.match(second.stdout(), /YILIAN_SOURCE_CONTRACT_MIGRATED/u)
    assert.match(second.stdout(), new RegExp(hotel.hotelId, 'u'))
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
    assert.equal(restartedView.lastErrorCode, null)
    const restartedSourcesResponse = await fetch(
      `${restartedBase}/report-sources`,
      { headers: { Authorization: `Bearer ${restartedAccessToken}` } },
    )
    assert.equal(restartedSourcesResponse.status, 200)
    const restartedSources = (await restartedSourcesResponse.json()).data
    assert.equal(restartedSources.length, 3)
    assert.equal(restartedSources.every((source) => source.enabled), true)

    const migratedReportSources = JSON.parse(
      await readFile(reportSourcePath, 'utf8'),
    )
    assert.equal(migratedReportSources[hotel.hotelId].length, 3)
    const migratedRepairStatuses = JSON.parse(
      await readFile(repairStatusPath, 'utf8'),
    )
    assert.equal(migratedRepairStatuses[hotel.hotelId].state, 'IDLE')
    assert.equal(
      migratedRepairStatuses[hotel.hotelId].trigger,
      'STARTUP_SOURCE_CONTRACT_MIGRATION',
    )
    assert.equal(migratedRepairStatuses[hotel.hotelId].lastErrorCode, null)

    await stopApi(second.child)
    second = null
    delete migratedReportSources[hotel.hotelId]
    migratedRepairStatuses[hotel.hotelId] = {
      ...migratedRepairStatuses[hotel.hotelId],
      state: 'FAILED',
      trigger: 'MANUAL_REPAIR',
      lastAttemptAt: '2026-09-11T03:30:00.000Z',
      lastErrorCode: 'YILIAN_SOURCE_CONTRACT_INVALID',
      sourceCount: 0,
      successfulSourceCount: 0,
    }
    await writeFile(
      reportSourcePath,
      `${JSON.stringify(migratedReportSources, null, 2)}\n`,
      'utf8',
    )
    await writeFile(
      repairStatusPath,
      `${JSON.stringify(migratedRepairStatuses, null, 2)}\n`,
      'utf8',
    )
    third = await startApi(runtimePath)
    assert.match(third.stdout(), /YILIAN_SOURCE_CONTRACT_MIGRATED/u)
    const missingKeySources = JSON.parse(
      await readFile(reportSourcePath, 'utf8'),
    )
    const missingKeyStatuses = JSON.parse(
      await readFile(repairStatusPath, 'utf8'),
    )
    assert.equal(missingKeySources[hotel.hotelId].length, 3)
    assert.equal(missingKeyStatuses[hotel.hotelId].state, 'IDLE')
    assert.equal(missingKeyStatuses[hotel.hotelId].lastErrorCode, null)

    await stopApi(third.child)
    third = null
    await writeFile(reportSourcePath, '{broken-json', 'utf8')
    missingKeyStatuses[hotel.hotelId] = {
      ...missingKeyStatuses[hotel.hotelId],
      state: 'FAILED',
      trigger: 'MANUAL_REPAIR',
      lastAttemptAt: '2026-09-11T04:00:00.000Z',
      lastErrorCode: 'YILIAN_SOURCE_CONTRACT_INVALID',
      sourceCount: 0,
      successfulSourceCount: 0,
    }
    await writeFile(
      repairStatusPath,
      `${JSON.stringify(missingKeyStatuses, null, 2)}\n`,
      'utf8',
    )
    await assert.rejects(
      startApi(runtimePath),
      /REPORT_SOURCE_STORE_INVALID/u,
    )
    assert.equal(await readFile(reportSourcePath, 'utf8'), '{broken-json')
    const unchangedRepairStatuses = JSON.parse(
      await readFile(repairStatusPath, 'utf8'),
    )
    assert.equal(unchangedRepairStatuses[hotel.hotelId].state, 'FAILED')
    assert.equal(
      unchangedRepairStatuses[hotel.hotelId].lastErrorCode,
      'YILIAN_SOURCE_CONTRACT_INVALID',
    )

    missingKeySources[hotel.hotelId] = []
    await writeFile(
      reportSourcePath,
      `${JSON.stringify(missingKeySources, null, 2)}\n`,
      'utf8',
    )
    await writeFile(repairStatusPath, '{broken-json', 'utf8')
    await assert.rejects(
      startApi(runtimePath),
      /YILIAN_REPAIR_STATUS_STORE_INVALID/u,
    )
    assert.equal(await readFile(repairStatusPath, 'utf8'), '{broken-json')

    migratedRepairStatuses[hotel.hotelId] = {
      ...missingKeyStatuses[hotel.hotelId],
      state: 'IDLE',
      trigger: 'SOURCE_CONFIG_UPDATED',
      lastAttemptAt: null,
      lastErrorCode: null,
      sourceCount: 0,
      successfulSourceCount: 0,
    }
    await writeFile(
      reportSourcePath,
      `${JSON.stringify(missingKeySources, null, 2)}\n`,
      'utf8',
    )
    await writeFile(
      repairStatusPath,
      `${JSON.stringify(migratedRepairStatuses, null, 2)}\n`,
      'utf8',
    )
    fifth = await startApi(runtimePath, {
      automaticCollectionEnabled: true,
    })
    await new Promise((resolve) => setTimeout(resolve, 2_300))
    assert.doesNotMatch(fifth.stdout(), /YILIAN_SOURCE_CONTRACT_MIGRATED/u)
    const thirdLogin = await fetch(
      `http://127.0.0.1:${fifth.port}/api/v1/auth/login`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: 'review-test',
          password: 'example-Review-Test-Password-42',
        }),
      },
    )
    assert.equal(thirdLogin.status, 200)
    const thirdAccessToken = (await thirdLogin.json()).accessToken
    const intentionalDisabledRepair = await fetch(
      `http://127.0.0.1:${fifth.port}/api/v1/ota/tenants/`
        + `${hotel.tenantId}/hotels/${hotel.hotelId}/yilian-cloud-repair`,
      { headers: { Authorization: `Bearer ${thirdAccessToken}` } },
    )
    assert.equal(intentionalDisabledRepair.status, 200)
    const intentionalDisabledView =
      (await intentionalDisabledRepair.json()).data
    assert.equal(intentionalDisabledView.state, 'IDLE')
    assert.equal(intentionalDisabledView.lastErrorCode, null)
    const intentionalEmptyResponse = await fetch(
      `http://127.0.0.1:${fifth.port}/api/v1/ota/tenants/`
        + `${hotel.tenantId}/hotels/${hotel.hotelId}/report-sources`,
      { headers: { Authorization: `Bearer ${thirdAccessToken}` } },
    )
    assert.equal(intentionalEmptyResponse.status, 200)
    assert.deepEqual((await intentionalEmptyResponse.json()).data, [])
  } finally {
    if (first) await stopApi(first.child)
    if (second) await stopApi(second.child)
    if (third) await stopApi(third.child)
    if (fourth) await stopApi(fourth.child)
    if (fifth) await stopApi(fifth.child)
    await rm(runtimePath, { recursive: true, force: true })
  }
})

test('015 source migration leaves a non-migrating 016 source key absent', { timeout: 30_000 }, async () => {
  const runtimePath = await mkdtemp(join(tmpdir(), 'yilian-store-isolation-'))
  let first = null
  let second = null
  try {
    first = await startApi(runtimePath)
    const createStore = async (hotelCode) => {
      const response = await fetch(
        `http://127.0.0.1:${first.port}/api/v1/ota/simulation/hotels`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${apiToken}`,
            'Content-Type': 'application/json',
            'Idempotency-Key': `create-yilian-isolation-${hotelCode}`,
          },
          body: JSON.stringify({
            hotelCode,
            hotelDisplayName: `${hotelCode} Yilian Isolation Test Hotel`,
            ownershipType: 'DIRECT',
            pmsSystemCode: 'YILIAN_CLOUD',
            pmsUsername: `synthetic-yilian-${hotelCode}`,
            pmsPassword: `synthetic-Yilian-Password-${hotelCode}-42`,
            timezone: 'Asia/Shanghai',
            reasonCode: 'CREATE_STORE_FROM_CONSOLE_WIZARD',
          }),
        },
      )
      assert.equal(response.status, 201)
      return (await response.json()).data
    }
    const receipt015 = await createStore('015')
    const receipt016 = await createStore('016')
    const directoryResponse = await fetch(
      `http://127.0.0.1:${first.port}/api/v1/ota/simulation/hotels`,
      { headers: { Authorization: `Bearer ${apiToken}` } },
    )
    assert.equal(directoryResponse.status, 200)
    const createdHotels = (await directoryResponse.json()).data.hotels
    const hotel015 = createdHotels.find(
      (candidate) => candidate.hotelId === receipt015.resourceId,
    )
    const hotel016 = createdHotels.find(
      (candidate) => candidate.hotelId === receipt016.resourceId,
    )
    assert.equal(hotel015.hotelCode, '015')
    assert.equal(hotel016.hotelCode, '016')

    await stopApi(first.child)
    first = null
    const reportSourcePath = join(runtimePath, 'report-sources.json')
    const repairStatusPath = join(
      runtimePath,
      'yilian-cloud-repair-statuses.json',
    )
    const persistedSources = JSON.parse(await readFile(reportSourcePath, 'utf8'))
    const persistedStatuses = JSON.parse(await readFile(repairStatusPath, 'utf8'))
    delete persistedSources[hotel015.hotelId]
    delete persistedSources[hotel016.hotelId]
    persistedStatuses[hotel015.hotelId] = {
      ...persistedStatuses[hotel015.hotelId],
      state: 'FAILED',
      trigger: 'MANUAL_REPAIR',
      lastAttemptAt: '2026-09-11T03:00:00.000Z',
      lastErrorCode: 'YILIAN_SOURCE_CONTRACT_INVALID',
      sourceCount: 0,
      successfulSourceCount: 0,
    }
    persistedStatuses[hotel016.hotelId] = {
      ...persistedStatuses[hotel016.hotelId],
      state: 'IDLE',
      trigger: 'SOURCE_CONFIG_UPDATED',
      lastAttemptAt: null,
      lastErrorCode: null,
      sourceCount: 0,
      successfulSourceCount: 0,
    }
    await writeFile(
      reportSourcePath,
      `${JSON.stringify(persistedSources, null, 2)}\n`,
      'utf8',
    )
    await writeFile(
      repairStatusPath,
      `${JSON.stringify(persistedStatuses, null, 2)}\n`,
      'utf8',
    )

    second = await startApi(runtimePath)
    assert.match(second.stdout(), new RegExp(hotel015.hotelId, 'u'))
    assert.doesNotMatch(second.stdout(), new RegExp(hotel016.hotelId, 'u'))

    const migratedSources = JSON.parse(await readFile(reportSourcePath, 'utf8'))
    const migratedStatuses = JSON.parse(await readFile(repairStatusPath, 'utf8'))
    assert.equal(migratedSources[hotel015.hotelId].length, 3)
    assert.equal(Object.hasOwn(migratedSources, hotel016.hotelId), false)
    assert.equal(
      migratedStatuses[hotel015.hotelId].trigger,
      'STARTUP_SOURCE_CONTRACT_MIGRATION',
    )
    assert.equal(
      migratedStatuses[hotel016.hotelId].trigger,
      'SOURCE_CONFIG_UPDATED',
    )

    const loginResponse = await fetch(
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
    assert.equal(loginResponse.status, 200)
    const accessToken = (await loginResponse.json()).accessToken

    for (const [hotel, expectedSourceCount] of [
      [hotel015, 3],
      [hotel016, 0],
    ]) {
      const response = await fetch(
        `http://127.0.0.1:${second.port}/api/v1/ota/tenants/`
          + `${hotel.tenantId}/hotels/${hotel.hotelId}/report-sources`,
        { headers: { Authorization: `Bearer ${accessToken}` } },
      )
      assert.equal(response.status, 200)
      assert.equal((await response.json()).data.length, expectedSourceCount)
    }
    const afterReads = JSON.parse(await readFile(reportSourcePath, 'utf8'))
    assert.equal(Object.hasOwn(afterReads, hotel016.hotelId), false)
  } finally {
    if (first) await stopApi(first.child)
    if (second) await stopApi(second.child)
    await rm(runtimePath, { recursive: true, force: true })
  }
})
