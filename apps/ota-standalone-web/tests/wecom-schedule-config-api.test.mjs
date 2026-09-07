import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { once } from 'node:events'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const apiScript = fileURLToPath(
  new URL('../../../tools/uat/ota-standalone-review-api.mjs', import.meta.url),
)
const repoRoot = fileURLToPath(new URL('../../../', import.meta.url))
const platformToken = 'wecom-schedule-config-test-token'
const adminCredential = ['Schedule', 'Admin', 'Password', '42'].join('-')
const managerCredential = ['Schedule', 'Store', 'Password', '42'].join('-')

async function availablePort() {
  const server = createServer()
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  await new Promise((resolve) => server.close(resolve))
  return address.port
}

async function startReviewApi(runtimePath) {
  const port = await availablePort()
  const child = spawn(process.execPath, [apiScript], {
    cwd: repoRoot,
    env: {
      ...process.env,
      OTA_REVIEW_API_PORT: String(port),
      OTA_REVIEW_USERNAME: 'schedule-admin',
      OTA_REVIEW_PASSWORD: adminCredential,
      OTA_REVIEW_ACCESS_TOKEN: platformToken,
      OTA_REVIEW_DATA_PATH: join(runtimePath, 'report-sources.json'),
      OTA_REVIEW_COOKIE_SECRETS_PATH: join(
        runtimePath,
        'report-source-cookie-secrets.json',
      ),
      OTA_REVIEW_SECRET_KEY: Buffer.alloc(32, 17).toString('base64url'),
      OTA_REVIEW_PSEUDONYM_SECRET_KEY:
        Buffer.alloc(32, 18).toString('base64url'),
      OTA_REVIEW_AUTO_COLLECTION_ENABLED: 'false',
    },
  })
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (child.exitCode !== null) break
    try {
      const response = await fetch(`http://127.0.0.1:${port}/health`)
      if (response.ok) return { child, port }
    } catch {
      // The child is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  throw new Error('REVIEW_API_START_FAILED')
}

async function stopReviewApi(child) {
  if (child.exitCode !== null) return
  child.kill()
  await once(child, 'exit')
}

const platformHeaders = (json = false) => ({
  Authorization: `Bearer ${platformToken}`,
  ...(json ? { 'Content-Type': 'application/json' } : {}),
})

test('per-store broadcast schedule persists securely and rejects store writes', {
  timeout: 20_000,
}, async () => {
  const runtimePath = await mkdtemp(join(tmpdir(), 'sfg-wecom-schedule-'))
  let runtime = null
  try {
    runtime = await startReviewApi(runtimePath)
    const baseUrl = `http://127.0.0.1:${runtime.port}`
    const directoryResponse = await fetch(
      `${baseUrl}/api/v1/ota/simulation/hotels`,
      { headers: platformHeaders() },
    )
    const directory = await directoryResponse.json()
    const hotel = directory.data.hotels.find((item) => item.hotelCode === '001')
    assert.ok(hotel)
    const configUrl = `${baseUrl}/api/v1/ota/tenants/${hotel.tenantId}`
      + `/hotels/${hotel.hotelId}/wecom-config`

    const initialResponse = await fetch(configUrl, {
      headers: platformHeaders(),
    })
    assert.equal(initialResponse.status, 200)
    const initial = (await initialResponse.json()).data
    assert.equal(initial.enabled, false)
    assert.equal(initial.groupRepairLinkEnabled, false)
    assert.equal(initial.broadcastScheduleMode, 'LEGACY_DYNAMIC')
    assert.equal(initial.broadcastIntervalHours, 0)

    const fakeWebhookKey = '1'.repeat(32)
    const fakeWebhook = 'https://qyapi.weixin.qq.com/cgi-bin/webhook/send'
      + `?key=${fakeWebhookKey}`
    const savedResponse = await fetch(configUrl, {
      method: 'POST',
      headers: platformHeaders(true),
      body: JSON.stringify({
        enabled: true,
        groupRepairLinkEnabled: false,
        broadcastStartHour: 9,
        broadcastQuietHour: 2,
        broadcastIntervalHours: 2,
        webhookUpdate: { action: 'REPLACE', value: fakeWebhook },
        reasonCode: 'UPDATE_WECOM_UAT_AUTOMATION',
      }),
    })
    assert.equal(savedResponse.status, 200)
    const saved = (await savedResponse.json()).data
    assert.equal(saved.enabled, true)
    assert.equal(saved.groupRepairLinkEnabled, false)
    assert.equal(saved.broadcastScheduleMode, 'CUSTOM_V1')
    assert.equal(saved.broadcastIntervalHours, 2)
    assert.equal(saved.webhookConfigured, true)
    assert.ok(Number.isFinite(Date.parse(saved.broadcastScheduleEffectiveAt)))

    const independentToggleResponse = await fetch(configUrl, {
      method: 'POST',
      headers: platformHeaders(true),
      body: JSON.stringify({
        enabled: false,
        groupRepairLinkEnabled: true,
        broadcastStartHour: 9,
        broadcastQuietHour: 2,
        broadcastIntervalHours: 0,
        webhookUpdate: { action: 'KEEP' },
        reasonCode: 'UPDATE_WECOM_UAT_AUTOMATION',
      }),
    })
    assert.equal(independentToggleResponse.status, 200)
    const independentlyToggled = (await independentToggleResponse.json()).data
    assert.equal(independentlyToggled.enabled, false)
    assert.equal(independentlyToggled.groupRepairLinkEnabled, true)

    const restoredResponse = await fetch(configUrl, {
      method: 'POST',
      headers: platformHeaders(true),
      body: JSON.stringify({
        enabled: true,
        groupRepairLinkEnabled: false,
        broadcastStartHour: 9,
        broadcastQuietHour: 2,
        broadcastIntervalHours: 2,
        webhookUpdate: { action: 'KEEP' },
        reasonCode: 'UPDATE_WECOM_UAT_AUTOMATION',
      }),
    })
    assert.equal(restoredResponse.status, 200)

    const invalidResponse = await fetch(configUrl, {
      method: 'POST',
      headers: platformHeaders(true),
      body: JSON.stringify({
        enabled: true,
        groupRepairLinkEnabled: true,
        broadcastStartHour: 9,
        broadcastQuietHour: 9,
        broadcastIntervalHours: 5,
        webhookUpdate: { action: 'KEEP' },
        reasonCode: 'UPDATE_WECOM_UAT_AUTOMATION',
      }),
    })
    assert.equal(invalidResponse.status, 400)
    assert.equal((await invalidResponse.json()).code, 'WECOM_CONFIG_INVALID')

    const createAccountResponse = await fetch(
      `${baseUrl}/api/v1/auth/accounts`,
      {
        method: 'POST',
        headers: platformHeaders(true),
        body: JSON.stringify({
          username: 'schedule-store-manager',
          displayName: 'Schedule Store Manager',
          password: managerCredential,
          roles: ['GENERAL_MANAGER'],
          hotelIds: [hotel.hotelId],
        }),
      },
    )
    assert.equal(createAccountResponse.status, 201)
    const loginResponse = await fetch(`${baseUrl}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: 'schedule-store-manager',
        password: managerCredential,
      }),
    })
    assert.equal(loginResponse.status, 200)
    const storeToken = (await loginResponse.json()).accessToken
    const forbiddenResponse = await fetch(configUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${storeToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        enabled: false,
        groupRepairLinkEnabled: false,
        broadcastStartHour: 9,
        broadcastQuietHour: 2,
        broadcastIntervalHours: 0,
        webhookUpdate: { action: 'KEEP' },
        reasonCode: 'UPDATE_WECOM_UAT_AUTOMATION',
      }),
    })
    assert.equal(forbiddenResponse.status, 403)
    const forbiddenCookieResponse = await fetch(
      `${baseUrl}/api/v1/ota/tenants/${hotel.tenantId}`
        + `/hotels/${hotel.hotelId}/pms-cookie-validation`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${storeToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          reasonCode: 'VALIDATE_AND_UPDATE_PMS_COOKIE',
          cookieHeader: 'blocked-before-validation',
        }),
      },
    )
    assert.equal(forbiddenCookieResponse.status, 403)

    const storedConfig = await readFile(
      join(runtimePath, 'wecom-configs.json'),
      'utf8',
    )
    const storedSecret = await readFile(
      join(runtimePath, 'wecom-webhook-secrets.json'),
      'utf8',
    )
    assert.equal(storedConfig.includes(fakeWebhookKey), false)
    assert.equal(storedSecret.includes(fakeWebhookKey), false)

    await stopReviewApi(runtime.child)
    runtime = await startReviewApi(runtimePath)
    const restartedBaseUrl = `http://127.0.0.1:${runtime.port}`
    const restartedLoginResponse = await fetch(
      `${restartedBaseUrl}/api/v1/auth/login`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: 'schedule-admin',
          password: adminCredential,
        }),
      },
    )
    assert.equal(restartedLoginResponse.status, 200)
    const restartedToken = (await restartedLoginResponse.json()).accessToken
    const restartedConfigUrl = `${restartedBaseUrl}/api/v1/ota/tenants/${hotel.tenantId}`
      + `/hotels/${hotel.hotelId}/wecom-config`
    const restartedResponse = await fetch(restartedConfigUrl, {
      headers: { Authorization: `Bearer ${restartedToken}` },
    })
    assert.equal(restartedResponse.status, 200)
    const restarted = (await restartedResponse.json()).data
    assert.equal(restarted.broadcastScheduleMode, 'CUSTOM_V1')
    assert.equal(restarted.broadcastStartHour, 9)
    assert.equal(restarted.broadcastQuietHour, 2)
    assert.equal(restarted.broadcastIntervalHours, 2)
    assert.equal(restarted.groupRepairLinkEnabled, false)
    assert.equal(restarted.webhookConfigured, true)
    assert.equal(Object.hasOwn(restarted, 'webhook'), false)
  } finally {
    if (runtime) await stopReviewApi(runtime.child)
    await rm(runtimePath, { recursive: true, force: true })
  }
})
