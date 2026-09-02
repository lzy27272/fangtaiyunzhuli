import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
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
      OTA_REVIEW_PASSWORD: 'example-Review-Test-Password-42',
      OTA_REVIEW_ACCESS_TOKEN: token,
      OTA_REVIEW_DATA_PATH: join(runtimePath, 'report-sources.json'),
      OTA_REVIEW_COOKIE_SECRETS_PATH: join(
        runtimePath,
        'report-source-cookie-secrets.json',
      ),
      OTA_REVIEW_SECRET_KEY: Buffer.alloc(32, 7).toString('base64url'),
      OTA_REVIEW_PSEUDONYM_SECRET_KEY: Buffer.alloc(32, 8).toString('base64url'),
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

test('new store number is generated and ownership survives restart', { timeout: 15_000 }, async () => {
  const runtimePath = await mkdtemp(join(tmpdir(), 'sfg-auto-hotel-code-'))
  let first = null
  let second = null
  try {
    first = await startReviewApi(runtimePath)
    const create = await fetch(
      `http://127.0.0.1:${first.port}/api/v1/ota/simulation/hotels`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          'Idempotency-Key': 'auto-store-code-non-direct-001',
        },
        body: JSON.stringify({
          hotelDisplayName: 'Auto Number Non Direct Hotel',
          ownershipType: 'NON_DIRECT',
          pmsSystemCode: 'MEITUAN_BIEYANGHONG',
          timezone: 'Asia/Shanghai',
          reasonCode: 'CREATE_STORE_FROM_CONSOLE_WIZARD',
        }),
      },
    )
    assert.equal(create.status, 201)
    const receipt = await create.json()
    const directory = await fetch(
      `http://127.0.0.1:${first.port}/api/v1/ota/simulation/hotels`,
      { headers: { Authorization: `Bearer ${token}` } },
    )
    const created = (await directory.json()).data.hotels.find(
      (hotel) => hotel.hotelId === receipt.data.resourceId,
    )
    assert.equal(created.hotelCode, '003')
    assert.equal(created.ownershipType, 'NON_DIRECT')

    await stopReviewApi(first.child)
    first = null
    second = await startReviewApi(runtimePath)
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
    const restartedToken = (await restartedLogin.json()).accessToken
    const restartedDirectory = await fetch(
      `http://127.0.0.1:${second.port}/api/v1/ota/simulation/hotels`,
      { headers: { Authorization: `Bearer ${restartedToken}` } },
    )
    const restarted = (await restartedDirectory.json()).data.hotels.find(
      (hotel) => hotel.hotelId === receipt.data.resourceId,
    )
    assert.equal(restarted.hotelCode, '003')
    assert.equal(restarted.ownershipType, 'NON_DIRECT')
  } finally {
    if (first) await stopReviewApi(first.child)
    if (second) await stopReviewApi(second.child)
    await rm(runtimePath, { recursive: true, force: true })
  }
})

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
    const luopanTemplateHotel = initialBody.data.hotels.find(
      (hotel) => hotel.tenantCode === '001' && hotel.hotelCode === '002',
    )
    assert.equal(templateHotel.pmsSystemCode, 'MEITUAN_BIEYANGHONG')
    assert.equal(luopanTemplateHotel.pmsSystemCode, 'LUOPAN_CLOUD')
    const createManaged = await fetch(
      `http://127.0.0.1:${first.port}/api/v1/ota/simulation/hotels`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          'Idempotency-Key': 'review-managed-template-hotel-001',
        },
        body: JSON.stringify({
          hotelCode: '090',
          hotelDisplayName: 'Managed Template Test Hotel',
          pmsSystemCode: 'MEITUAN_BIEYANGHONG',
          timezone: 'Asia/Shanghai',
          reasonCode: 'CREATE_SPRINT1_SIMULATION_HOTEL',
        }),
      },
    )
    assert.equal(createManaged.status, 201)
    const managedReceipt = await createManaged.json()
    const existingManagedHotel = {
      tenantId: templateHotel.tenantId,
      hotelId: managedReceipt.data.resourceId,
    }
    const directoryAfterManagedCreate = await fetch(
      `http://127.0.0.1:${first.port}/api/v1/ota/simulation/hotels`,
      { headers: { Authorization: `Bearer ${token}` } },
    )
    const managedDirectoryBody = await directoryAfterManagedCreate.json()
    const managedHotel = managedDirectoryBody.data.hotels.find(
      (hotel) => hotel.hotelId === managedReceipt.data.resourceId,
    )
    assert.equal(managedHotel.hotelCode, '090')
    assert.equal(managedHotel.tenantId, templateHotel.tenantId)
    assert.equal(managedHotel.tenantCode, templateHotel.tenantCode)
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
    const updatedTemplateSourceId = templateReportBody.data[2].sourceId
    let templateSources = templateReportBody.data.map((source, index) =>
      index === 2
        ? { ...source, displayName: 'Canonical Revenue Report' }
        : source)
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
      source.sourceId === updatedTemplateSourceId
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
    assert.equal(saveTemplateLogin.status, 400)
    assert.deepEqual(await saveTemplateLogin.json(), {
      code: 'TRUSTED_DEVICE_CREDENTIAL_UPLOAD_REJECTED',
    })

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
          pmsSystemCode: 'MEITUAN_BIEYANGHONG',
          timezone: 'Asia/Shanghai',
          reasonCode: 'CREATE_SPRINT1_SIMULATION_HOTEL',
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
          pmsSystemCode: 'LUOPAN_CLOUD',
          pmsUsername: 'synthetic-luopan-user',
          pmsPassword: 'example-luopan-password',
          timezone: 'Asia/Shanghai',
          reasonCode: 'CREATE_SPRINT1_SIMULATION_HOTEL',
        }),
      },
    )
    assert.equal(createSecondHotel.status, 201)
    const secondReceipt = await createSecondHotel.json()

    const createOtherPmsHotel = await fetch(
      `http://127.0.0.1:${first.port}/api/v1/ota/simulation/hotels`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          'Idempotency-Key': 'review-hotel-directory-create-other-pms-001',
        },
        body: JSON.stringify({
          hotelCode: '005',
          hotelDisplayName: 'Other PMS Test Hotel',
          pmsSystemCode: 'OTHER',
          pmsSystemName: '测试云 PMS',
          timezone: 'Asia/Shanghai',
          reasonCode: 'CREATE_SPRINT1_SIMULATION_HOTEL',
        }),
      },
    )
    assert.equal(createOtherPmsHotel.status, 201)
    const otherPmsReceipt = await createOtherPmsHotel.json()

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
      ownershipType: 'DIRECT',
      pmsSystemCode: 'MEITUAN_BIEYANGHONG',
      pmsSystemName: '美团别样红 PMS',
      timezone: 'Asia/Shanghai',
      lifecycleStatus: 'PILOT',
      collectionEnabled: true,
      messageEnabled: false,
      configuredMockConnectors: 2,
      simulationOnly: true,
      rowVersion: 1,
    })
    const createdLuopan = firstBody.data.hotels.find(
      (hotel) => hotel.hotelId === secondReceipt.data.resourceId,
    )
    assert.equal(createdLuopan.pmsSystemCode, 'LUOPAN_CLOUD')
    assert.equal(createdLuopan.pmsSystemName, '罗盘 PMS')
    const createdOtherPms = firstBody.data.hotels.find(
      (hotel) => hotel.hotelId === otherPmsReceipt.data.resourceId,
    )
    assert.equal(createdOtherPms.pmsSystemCode, 'OTHER')
    assert.equal(createdOtherPms.pmsSystemName, '测试云 PMS')
    assert.equal(createdOtherPms.tenantId, templateHotel.tenantId)
    assert.equal(createdOtherPms.collectionEnabled, false)
    assert.equal(createdOtherPms.configuredMockConnectors, 0)
    const createdLuopanPath =
      `http://127.0.0.1:${first.port}/api/v1/ota/tenants/`
      + `${createdLuopan.tenantId}/hotels/${createdLuopan.hotelId}`
    const [
      luopanReportsResponse,
      luopanLoginResponse,
      luopanConfigResponse,
      luopanOtaResponse,
    ] = await Promise.all([
      fetch(`${createdLuopanPath}/report-sources`, {
        headers: { Authorization: `Bearer ${token}` },
      }),
      fetch(`${createdLuopanPath}/pms-login-config`, {
        headers: { Authorization: `Bearer ${token}` },
      }),
      fetch(`${createdLuopanPath}/luopan-browser-config`, {
        headers: { Authorization: `Bearer ${token}` },
      }),
      fetch(`${createdLuopanPath}/ota-sources`, {
        headers: { Authorization: `Bearer ${token}` },
      }),
    ])
    assert.deepEqual((await luopanReportsResponse.json()).data, [])
    assert.equal((await luopanLoginResponse.json()).data.configured, true)
    const luopanConfig = (await luopanConfigResponse.json()).data
    assert.equal(
      luopanConfig.portalUrl,
      'http://bj.chinapms.com:8880/pms-web/login/login.do',
    )
    assert.equal(luopanConfig.scopeStatus, 'NOT_VALIDATED')
    assert.equal(luopanConfig.enabled, false)
    assert.deepEqual((await luopanOtaResponse.json()).data, [])
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
          && source.requestPayloadJson === ''
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
        loginMode: 'STORE_TRUSTED_DEVICE',
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
    assert.equal(saveCreatedLogin.status, 400)
    assert.doesNotMatch(savedCreatedLoginText, /synthetic-created-(?:user|password)/)
    assert.equal(
      JSON.parse(savedCreatedLoginText).code,
      'TRUSTED_DEVICE_CREDENTIAL_UPLOAD_REJECTED',
    )
    const optionalPortalSourceId = '46000000-0000-4000-8000-000000000001'
    const saveOptionalPortalOta = await fetch(
      `${createdPath}/ota-sources`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          'Idempotency-Key': 'review-optional-ota-portal-001',
        },
        body: JSON.stringify({
          reasonCode: 'UPDATE_OTA_SOURCE_CONFIG',
          sources: [{
            sourceId: optionalPortalSourceId,
            displayName: 'Synthetic Review Source',
            platformCode: 'FLIGGY',
            portalUrl: '',
            dataEndpointUrl: '',
            requestMethod: 'GET',
            requestPayloadJson: '',
            pollIntervalMinutes: 120,
            enabled: false,
            cookieUpdate: { action: 'KEEP' },
            credentialUpdate: { action: 'KEEP' },
            rowVersion: 0,
          }],
        }),
      },
    )
    assert.equal(saveOptionalPortalOta.status, 200)
    const optionalPortalOtaBody = await saveOptionalPortalOta.json()
    assert.equal(optionalPortalOtaBody.data[0].portalUrl, '')
    assert.equal(
      optionalPortalOtaBody.data[0].dataEndpointUrl,
      '',
    )
    assert.equal(
      optionalPortalOtaBody.data[0].loginMode,
      'CONTROLLED_BROWSER_CREDENTIALS',
    )
    assert.equal(optionalPortalOtaBody.data[0].loginExecutionEnabled, true)
    const controlledLoginProfiles = await fetch(
      `${createdPath}/ota-controlled-logins`,
      { headers: { Authorization: `Bearer ${token}` } },
    )
    assert.equal(controlledLoginProfiles.status, 200)
    const controlledLoginText = await controlledLoginProfiles.text()
    const controlledLoginBody = JSON.parse(controlledLoginText)
    assert.equal(controlledLoginBody.data[0].credentialsConfigured, false)
    assert.equal(controlledLoginBody.data[0].autoRenewEnabled, false)
    assert.doesNotMatch(
      controlledLoginText,
      /(?:password|cookie)\s*[:=]\s*["'][^"']+/i,
    )
    const missingCredentialLogin = await fetch(
      `${createdPath}/ota-controlled-logins`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          'Idempotency-Key': 'review-controlled-login-missing-001',
        },
        body: JSON.stringify({
          platformCode: 'FLIGGY',
          reasonCode: 'MANUAL_OTA_CONTROLLED_LOGIN',
        }),
      },
    )
    assert.equal(missingCredentialLogin.status, 400)
    assert.deepEqual(await missingCredentialLogin.json(), {
      code: 'OTA_CHANNEL_CREDENTIALS_MISSING',
    })
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
      /synthetic-(?:template|created|luopan)-(?:user|password)|example-luopan-password/,
    )

    await stopReviewApi(first.child)
    first = null
    second = await startReviewApi(runtimePath)
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
    const restartedToken = (await restartedLogin.json()).accessToken
    const restartedDirectory = await fetch(
      `http://127.0.0.1:${second.port}/api/v1/ota/simulation/hotels`,
      { headers: { Authorization: `Bearer ${restartedToken}` } },
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
    assert.equal(
      restartedBody.data.hotels.some(
        (hotel) =>
          hotel.hotelId === otherPmsReceipt.data.resourceId
          && hotel.pmsSystemCode === 'OTHER'
          && hotel.pmsSystemName === '测试云 PMS',
      ),
      true,
    )
    const restartedCreatedPath =
      `http://127.0.0.1:${second.port}/api/v1/ota/tenants/`
      + `${created.tenantId}/hotels/${created.hotelId}`
    const restartedLoginConfig = await fetch(
      `${restartedCreatedPath}/pms-login-config`,
      { headers: { Authorization: `Bearer ${restartedToken}` } },
    )
    assert.equal(
      (await restartedLoginConfig.json()).data.configured,
      false,
    )
    const restartedOptionalPortalOta = await fetch(
      `${restartedCreatedPath}/ota-sources`,
      { headers: { Authorization: `Bearer ${restartedToken}` } },
    )
    const restartedOptionalPortalOtaBody =
      await restartedOptionalPortalOta.json()
    assert.equal(restartedOptionalPortalOtaBody.data[0].portalUrl, '')
    assert.equal(
      restartedOptionalPortalOtaBody.data[0].sourceId,
      optionalPortalSourceId,
    )
    assert.equal(
      restartedOptionalPortalOtaBody.data[0].dataEndpointUrl,
      '',
    )
    const restartedManagedPath =
      `http://127.0.0.1:${second.port}/api/v1/ota/tenants/`
      + `${existingManagedHotel.tenantId}/hotels/${existingManagedHotel.hotelId}`
    const restartedManagedReports = await fetch(
      `${restartedManagedPath}/report-sources`,
      { headers: { Authorization: `Bearer ${restartedToken}` } },
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

test('Luopan legacy reports allow enabled-only changes and keep them across restart', { timeout: 15_000 }, async () => {
  const runtimePath = await mkdtemp(join(tmpdir(), 'sfg-review-luopan-toggle-'))
  const tenantId = '10000000-0000-4000-8000-000000000001'
  const meituanHotelId = '20000000-0000-4000-8000-000000000001'
  const luopanHotelId = '20000000-0000-4000-8000-000000000002'
  const source = {
    sourceId: '34000000-0000-4000-8000-000000000001',
    displayName: 'Legacy report',
    endpointUrl: 'https://pms.meituan.com/hotelpms/api/v1/report/jd01',
    reportType: 'ORDER_DETAIL',
    calculationRole: 'PRIMARY_CALCULATION',
    pollIntervalMinutes: 30,
    credentialAlias: 'REPORT_READER_ORDERS',
    requestPayloadJson: '',
    enabled: true,
    validationStatus: 'FORMAT_VALID',
    rowVersion: 1,
  }
  const hotels = [
    {
      tenantId,
      hotelId: meituanHotelId,
      tenantCode: '001',
      tenantName: 'Test tenant',
      hotelCode: '001',
      hotelName: 'Meituan hotel',
      pmsSystemCode: 'MEITUAN_BIEYANGHONG',
      timezone: 'Asia/Shanghai',
      rowVersion: 1,
    },
    {
      tenantId,
      hotelId: luopanHotelId,
      tenantCode: '001',
      tenantName: 'Test tenant',
      hotelCode: '002',
      hotelName: 'Luopan hotel',
      pmsSystemCode: 'LUOPAN_CLOUD',
      timezone: 'Asia/Shanghai',
      rowVersion: 1,
    },
  ]
  let first = null
  let second = null
  try {
    await writeFile(
      join(runtimePath, 'simulation-hotels.json'),
      JSON.stringify(hotels),
      'utf8',
    )
    await writeFile(
      join(runtimePath, 'report-sources.json'),
      JSON.stringify({
        [meituanHotelId]: [source],
        [luopanHotelId]: [source],
      }),
      'utf8',
    )
    first = await startReviewApi(runtimePath)
    const scopedPath =
      `http://127.0.0.1:${first.port}/api/v1/ota/tenants/`
      + `${tenantId}/hotels/${luopanHotelId}`
    const loaded = await fetch(`${scopedPath}/report-sources`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    const loadedSources = (await loaded.json()).data
    assert.equal(loadedSources[0].enabled, true)
    assert.equal(loadedSources[0].enabledToggleOnly, true)

    const disabledResponse = await fetch(`${scopedPath}/report-sources`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': 'review-luopan-disable-001',
      },
      body: JSON.stringify({
        reasonCode: 'DISABLE_LEGACY_LUOPAN_REPORT',
        sources: loadedSources.map((item) => ({
          ...item,
          enabled: false,
          cookieUpdate: { action: 'KEEP' },
        })),
      }),
    })
    assert.equal(disabledResponse.status, 200)

    const changedDefinitionResponse = await fetch(
      `${scopedPath}/report-sources`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          'Idempotency-Key': 'review-luopan-definition-rejected-001',
        },
        body: JSON.stringify({
          reasonCode: 'REJECT_LUOPAN_DEFINITION_EDIT',
          sources: loadedSources.map((item) => ({
            ...item,
            displayName: 'Must stay managed',
            enabled: false,
            cookieUpdate: { action: 'KEEP' },
          })),
        }),
      },
    )
    assert.equal(changedDefinitionResponse.status, 400)
    assert.equal(
      (await changedDefinitionResponse.json()).code,
      'LUOPAN_REPORT_SOURCE_ENABLED_ONLY',
    )

    await stopReviewApi(first.child)
    first = null
    second = await startReviewApi(runtimePath)
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
    const restartedToken = (await loginResponse.json()).accessToken
    const restartedPath =
      `http://127.0.0.1:${second.port}/api/v1/ota/tenants/`
      + `${tenantId}/hotels/${luopanHotelId}`
    const restarted = await fetch(`${restartedPath}/report-sources`, {
      headers: { Authorization: `Bearer ${restartedToken}` },
    })
    const restartedSources = (await restarted.json()).data
    assert.equal(restartedSources[0].enabled, false)
    assert.equal(restartedSources[0].enabledToggleOnly, true)
  } finally {
    if (first) await stopReviewApi(first.child)
    if (second) await stopReviewApi(second.child)
    await rm(runtimePath, { recursive: true, force: true })
  }
})
