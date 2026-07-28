import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { once } from 'node:events'
import { spawn } from 'node:child_process'
import test from 'node:test'

const apiScript = fileURLToPath(
  new URL('../../../tools/uat/ota-standalone-review-api.mjs', import.meta.url),
)
const repoRoot = fileURLToPath(new URL('../../../', import.meta.url))
const token = 'review-hotel-directory-test-token'

const reportSourceDefinition = (source) => ({
  sourceId: source.sourceId,
  displayName: source.displayName,
  endpointUrl: source.endpointUrl,
  reportType: source.reportType,
  calculationRole: source.calculationRole,
  pollIntervalMinutes: source.pollIntervalMinutes,
  credentialAlias: source.credentialAlias,
  requestPayloadJson: source.requestPayloadJson,
  enabled: source.enabled,
})

async function availablePort() {
  const server = createServer()
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  await new Promise((resolve) => server.close(resolve))
  return address.port
}

async function waitForReviewApi(port, child) {
  let lastError = null
  for (let attempt = 0; attempt < 40; attempt += 1) {
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

async function startReviewApi(runtimePath) {
  const port = await availablePort()
  const child = spawn(process.execPath, [apiScript], {
    cwd: repoRoot,
    env: {
      ...process.env,
      OTA_REVIEW_API_PORT: String(port),
      OTA_REVIEW_USERNAME: 'review-test',
      OTA_REVIEW_PASSWORD: 'review-test',
      OTA_REVIEW_ACCESS_TOKEN: token,
      OTA_REVIEW_DATA_PATH: join(runtimePath, 'report-sources.json'),
      OTA_REVIEW_COOKIE_SECRETS_PATH: join(
        runtimePath,
        'report-source-cookie-secrets.json',
      ),
      OTA_REVIEW_SECRET_KEY: Buffer.alloc(32, 7).toString('base64url'),
      OTA_REVIEW_AUTO_COLLECTION_ENABLED: 'false',
    },
  })
  await waitForReviewApi(port, child)
  return { port, child }
}

async function stopReviewApi(child) {
  if (child.exitCode !== null) return
  child.kill()
  await once(child, 'exit')
}

test('created review hotels are returned by the directory and survive restart', { timeout: 15_000 }, async () => {
  const runtimePath = await mkdtemp(join(tmpdir(), 'sfg-review-hotel-directory-'))
  let first = null
  let second = null
  try {
    first = await startReviewApi(runtimePath)
    const initialDirectory = await fetch(
      `http://127.0.0.1:${first.port}/api/v1/ota/simulation/hotels`,
      { headers: { Authorization: `Bearer ${token}` } },
    )
    const initialBody = await initialDirectory.json()
    const templateHotel = initialBody.data.hotels.find(
      (hotel) => hotel.tenantCode === '001' && hotel.hotelCode === '001',
    )
    const existingManagedHotel = initialBody.data.hotels.find(
      (hotel) => hotel.hotelId !== templateHotel.hotelId,
    )
    const templatePath =
      `http://127.0.0.1:${first.port}/api/v1/ota/tenants/`
      + `${templateHotel.tenantId}/hotels/${templateHotel.hotelId}`
    const templateReportResponse = await fetch(
      `${templatePath}/report-sources`,
      { headers: { Authorization: `Bearer ${token}` } },
    )
    const templateReportBody = await templateReportResponse.json()
    assert.equal(
      templateReportBody.data.every(
        (source) => source.pollIntervalMinutes === 30,
      ),
      true,
    )
    assert.equal(
      templateReportBody.data.every(
        (source) =>
          source.definitionLocked === false
          && source.definitionTemplateHotelCode === '001/001',
      ),
      true,
    )
    let templateSources = [
      ...templateReportBody.data,
      {
        ...templateReportBody.data[0],
        sourceId: '34000000-0000-4000-8000-000000000099',
        displayName: 'Cloned Revenue Report',
        reportType: 'ROOM_REVENUE',
        calculationRole: 'PRIMARY_CALCULATION',
        rowVersion: 0,
      },
    ]
    const saveTemplateReports = await fetch(
      `${templatePath}/report-sources`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          'Idempotency-Key': 'review-template-report-sources-001',
        },
        body: JSON.stringify({
          reasonCode: 'REPORT_SOURCE_CONFIG',
          sources: templateSources.map((source) => ({
            ...source,
            cookieUpdate: {
              action: 'REPLACE',
              value: 'synthetic_template_cookie=not-for-copy',
            },
          })),
        }),
      },
    )
    assert.equal(saveTemplateReports.status, 200)

    const managedPath =
      `http://127.0.0.1:${first.port}/api/v1/ota/tenants/`
      + `${existingManagedHotel.tenantId}/hotels/${existingManagedHotel.hotelId}`
    const managedReportResponse = await fetch(
      `${managedPath}/report-sources`,
      { headers: { Authorization: `Bearer ${token}` } },
    )
    const managedReportBody = await managedReportResponse.json()
    assert.deepEqual(
      managedReportBody.data.map(reportSourceDefinition),
      templateSources.map(reportSourceDefinition),
    )
    assert.equal(
      managedReportBody.data.every(
        (source) =>
          source.definitionLocked === true
          && source.definitionTemplateHotelCode === '001/001'
          && source.cookieConfigured === false,
      ),
      true,
    )

    const saveManagedCookie = await fetch(
      `${managedPath}/report-sources`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          'Idempotency-Key': 'review-managed-cookie-001',
        },
        body: JSON.stringify({
          reasonCode: 'REPORT_SOURCE_CONFIG',
          sources: managedReportBody.data.map((source, index) => ({
            ...source,
            requestPayloadJson: index === 0
              ? '{"hotelSpecific":true}'
              : source.requestPayloadJson,
            cookieUpdate: index === 0
              ? {
                  action: 'REPLACE',
                  value: 'synthetic_managed_cookie=isolated',
                }
              : { action: 'KEEP' },
          })),
        }),
      },
    )
    assert.equal(saveManagedCookie.status, 200)

    const rejectedManagedDefinition = await fetch(
      `${managedPath}/report-sources`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          'Idempotency-Key': 'review-managed-definition-rejected-001',
        },
        body: JSON.stringify({
          reasonCode: 'REPORT_SOURCE_CONFIG',
          sources: managedReportBody.data.map((source, index) => ({
            ...source,
            displayName: index === 0
              ? 'Managed Hotel Must Not Override'
              : source.displayName,
            cookieUpdate: { action: 'KEEP' },
          })),
        }),
      },
    )
    assert.equal(rejectedManagedDefinition.status, 400)
    assert.equal(
      (await rejectedManagedDefinition.json()).code,
      'REPORT_SOURCE_DEFINITION_MANAGED',
    )

    templateSources = templateSources.map((source) =>
      source.sourceId === '34000000-0000-4000-8000-000000000099'
        ? { ...source, displayName: 'Canonical Revenue Report V2' }
        : source)
    const updateTemplateReports = await fetch(
      `${templatePath}/report-sources`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          'Idempotency-Key': 'review-template-report-sources-002',
        },
        body: JSON.stringify({
          reasonCode: 'REPORT_SOURCE_CONFIG',
          sources: templateSources.map((source) => ({
            ...source,
            cookieUpdate: { action: 'KEEP' },
          })),
        }),
      },
    )
    assert.equal(updateTemplateReports.status, 200)

    const synchronizedManagedResponse = await fetch(
      `${managedPath}/report-sources`,
      { headers: { Authorization: `Bearer ${token}` } },
    )
    const synchronizedManagedBody = await synchronizedManagedResponse.json()
    assert.deepEqual(
      synchronizedManagedBody.data.map(reportSourceDefinition),
      templateSources.map((source, index) => ({
        ...reportSourceDefinition(source),
        requestPayloadJson: index === 0
          ? '{"hotelSpecific":true}'
          : source.requestPayloadJson,
      })),
    )
    assert.equal(
      synchronizedManagedBody.data.filter(
        (source) => source.cookieConfigured,
      ).length,
      1,
    )
    const saveTemplateLogin = await fetch(
      `${templatePath}/pms-login-config`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          'Idempotency-Key': 'review-template-login-config-001',
        },
        body: JSON.stringify({
          reasonCode: 'UPDATE_PMS_LOGIN_CREDENTIALS',
          credentialUpdate: {
            action: 'REPLACE',
            username: 'synthetic-template-user',
            password: 'example-template-password',
          },
        }),
      },
    )
    assert.equal(saveTemplateLogin.status, 200)

    const create = await fetch(
      `http://127.0.0.1:${first.port}/api/v1/ota/simulation/hotels`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          'Idempotency-Key': 'review-hotel-directory-create-001',
        },
        body: JSON.stringify({
          tenantCode: '002',
          tenantDisplayName: 'Directory Test Tenant',
          hotelCode: '003',
          hotelDisplayName: 'Directory Test Hotel',
          timezone: 'Asia/Shanghai',
          reasonCode: 'CREATE_SPRINT1_SIMULATION_HOTEL',
          templateHotelId: existingManagedHotel.hotelId,
        }),
      },
    )
    assert.equal(create.status, 201)
    const receipt = await create.json()

    const createSecondHotel = await fetch(
      `http://127.0.0.1:${first.port}/api/v1/ota/simulation/hotels`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          'Idempotency-Key': 'review-hotel-directory-create-002',
        },
        body: JSON.stringify({
          tenantCode: '002',
          tenantDisplayName: 'Directory Test Tenant',
          hotelCode: '004',
          hotelDisplayName: 'Directory Test Hotel Two',
          timezone: 'Asia/Shanghai',
          reasonCode: 'CREATE_SPRINT1_SIMULATION_HOTEL',
        }),
      },
    )
    assert.equal(createSecondHotel.status, 201)
    const secondReceipt = await createSecondHotel.json()

    const firstDirectory = await fetch(
      `http://127.0.0.1:${first.port}/api/v1/ota/simulation/hotels`,
      { headers: { Authorization: `Bearer ${token}` } },
    )
    const firstBody = await firstDirectory.json()
    const created = firstBody.data.hotels.find(
      (hotel) => hotel.hotelId === receipt.data.resourceId,
    )
    assert.deepEqual(created, {
      tenantId: created.tenantId,
      hotelId: receipt.data.resourceId,
      tenantCode: '002',
      tenantName: 'Directory Test Tenant',
      hotelCode: '003',
      hotelName: 'Directory Test Hotel',
      timezone: 'Asia/Shanghai',
      lifecycleStatus: 'PILOT',
      collectionEnabled: true,
      messageEnabled: false,
      configuredMockConnectors: 2,
      simulationOnly: true,
      rowVersion: 1,
    })
    const createdPath =
      `http://127.0.0.1:${first.port}/api/v1/ota/tenants/`
      + `${created.tenantId}/hotels/${created.hotelId}`
    const clonedReportResponse = await fetch(
      `${createdPath}/report-sources`,
      { headers: { Authorization: `Bearer ${token}` } },
    )
    const clonedReportBody = await clonedReportResponse.json()
    assert.deepEqual(
      clonedReportBody.data.map(reportSourceDefinition),
      templateSources.map(reportSourceDefinition),
    )
    assert.equal(
      clonedReportBody.data.every(
        (source) =>
          source.cookieConfigured === false
          && source.cookieUpdatedAt === null
          && source.pollIntervalMinutes === 30
          && source.definitionLocked === true
          && source.definitionTemplateHotelCode === '001/001',
      ),
      true,
    )
    const collectionWithoutCookies = await fetch(
      `${createdPath}/live-collection-runs`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          'Idempotency-Key': 'review-created-collection-no-cookie-001',
        },
        body: JSON.stringify({}),
      },
    )
    assert.equal(collectionWithoutCookies.status, 400)
    assert.equal(
      (await collectionWithoutCookies.json()).code,
      'REPORT_SOURCE_COOKIE_REQUIRED',
    )
    const createdLoginBeforeSave = await fetch(
      `${createdPath}/pms-login-config`,
      { headers: { Authorization: `Bearer ${token}` } },
    )
    assert.deepEqual(await createdLoginBeforeSave.json(), {
      data: {
        configured: false,
        updatedAt: null,
        loginMode: 'CONTROLLED_BROWSER',
        loginExecutionEnabled: false,
      },
    })
    const saveCreatedLogin = await fetch(
      `${createdPath}/pms-login-config`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          'Idempotency-Key': 'review-created-login-config-001',
        },
        body: JSON.stringify({
          reasonCode: 'UPDATE_PMS_LOGIN_CREDENTIALS',
          credentialUpdate: {
            action: 'REPLACE',
            username: 'synthetic-created-user',
            password: 'example-created-password',
          },
        }),
      },
    )
    const savedCreatedLoginText = await saveCreatedLogin.text()
    assert.equal(saveCreatedLogin.status, 200)
    assert.doesNotMatch(savedCreatedLoginText, /synthetic-created-(?:user|password)/)
    assert.equal(JSON.parse(savedCreatedLoginText).data.configured, true)
    assert.equal(
      firstBody.data.hotels.some(
        (hotel) =>
          hotel.hotelId === secondReceipt.data.resourceId
          && hotel.tenantId === created.tenantId,
      ),
      true,
    )

    const persisted = JSON.parse(
      await readFile(join(runtimePath, 'simulation-hotels.json'), 'utf8'),
    )
    assert.equal(
      persisted.some((hotel) => hotel.hotelId === receipt.data.resourceId),
      true,
    )
    assert.equal(
      persisted.some((hotel) => hotel.hotelId === secondReceipt.data.resourceId),
      true,
    )
    const encryptedPmsLoginStore = await readFile(
      join(runtimePath, 'pms-login-secrets.json'),
      'utf8',
    )
    assert.match(encryptedPmsLoginStore, /"ciphertext"/)
    assert.doesNotMatch(
      encryptedPmsLoginStore,
      /synthetic-(?:template|created)-(?:user|password)/,
    )

    await stopReviewApi(first.child)
    first = null
    second = await startReviewApi(runtimePath)
    const restartedDirectory = await fetch(
      `http://127.0.0.1:${second.port}/api/v1/ota/simulation/hotels`,
      { headers: { Authorization: `Bearer ${token}` } },
    )
    const restartedBody = await restartedDirectory.json()
    assert.equal(
      restartedBody.data.hotels.some(
        (hotel) => hotel.hotelId === receipt.data.resourceId,
      ),
      true,
    )
    assert.equal(
      restartedBody.data.hotels.some(
        (hotel) => hotel.hotelId === secondReceipt.data.resourceId,
      ),
      true,
    )
    const restartedCreatedPath =
      `http://127.0.0.1:${second.port}/api/v1/ota/tenants/`
      + `${created.tenantId}/hotels/${created.hotelId}`
    const restartedLoginConfig = await fetch(
      `${restartedCreatedPath}/pms-login-config`,
      { headers: { Authorization: `Bearer ${token}` } },
    )
    assert.equal(
      (await restartedLoginConfig.json()).data.configured,
      true,
    )
    const restartedManagedPath =
      `http://127.0.0.1:${second.port}/api/v1/ota/tenants/`
      + `${existingManagedHotel.tenantId}/hotels/${existingManagedHotel.hotelId}`
    const restartedManagedReports = await fetch(
      `${restartedManagedPath}/report-sources`,
      { headers: { Authorization: `Bearer ${token}` } },
    )
    const restartedManagedBody = await restartedManagedReports.json()
    assert.equal(
      restartedManagedBody.data[0].requestPayloadJson,
      '{"hotelSpecific":true}',
    )
  } finally {
    if (first) await stopReviewApi(first.child)
    if (second) await stopReviewApi(second.child)
    await rm(runtimePath, { recursive: true, force: true })
  }
})
