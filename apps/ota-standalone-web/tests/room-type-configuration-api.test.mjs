import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { once } from 'node:events'
import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { extractRoomTypeCatalog } from '../../../tools/uat/room-type-catalog.mjs'

const apiScript = fileURLToPath(new URL(
  '../../../tools/uat/ota-standalone-review-api.mjs',
  import.meta.url,
))
const repoRoot = fileURLToPath(new URL('../../../', import.meta.url))
const token = 'room-type-configuration-api-test-token'
const tenantId = '10000000-0000-4000-8000-000000000001'
const hotelId = '20000000-0000-4000-8000-000000000001'
const sourceId = '34000000-0000-4000-8000-000000000099'

async function availablePort() {
  const server = createServer()
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  await new Promise((resolve) => server.close(resolve))
  return address.port
}

async function startApi(runtimePath) {
  const port = await availablePort()
  const child = spawn(process.execPath, [apiScript], {
    cwd: repoRoot,
    env: {
      ...process.env,
      OTA_REVIEW_API_PORT: String(port),
      OTA_REVIEW_USERNAME: 'room-type-test',
      OTA_REVIEW_PASSWORD: 'example-Room-Type-Test-Password-42',
      OTA_REVIEW_ACCESS_TOKEN: token,
      OTA_REVIEW_DATA_PATH: join(runtimePath, 'report-sources.json'),
      OTA_REVIEW_COOKIE_SECRETS_PATH: join(
        runtimePath,
        'report-source-cookie-secrets.json',
      ),
      OTA_REVIEW_SECRET_KEY: Buffer.alloc(32, 11).toString('base64url'),
      OTA_REVIEW_AUTO_COLLECTION_ENABLED: 'false',
    },
  })
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (child.exitCode !== null) break
    try {
      const response = await fetch(`http://127.0.0.1:${port}/health`)
      if (response.ok) return { port, child }
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  throw new Error('ROOM_TYPE_TEST_API_START_FAILED')
}

async function stopApi(child) {
  if (child.exitCode !== null) return
  child.kill()
  await once(child, 'exit')
}

const scopedPath = (port, suffix) => (
  `http://127.0.0.1:${port}/api/v1/ota/tenants/${tenantId}`
  + `/hotels/${hotelId}${suffix}`
)

async function apiRequest(port, suffix, options = {}) {
  return fetch(scopedPath(port, suffix), {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(options.headers ?? {}),
    },
  })
}

const sourceInput = (rowVersion, displayName = '携程订单房型') => ({
  sourceId,
  displayName,
  platformCode: 'CTRIP',
  portalUrl: 'https://merchant.ctrip.com/',
  dataEndpointUrl: 'https://merchant.ctrip.com/api/orders',
  requestMethod: 'GET',
  requestPayloadJson: '',
  pollIntervalMinutes: 120,
  enabled: true,
  rowVersion,
  cookieUpdate: { action: 'KEEP' },
  credentialUpdate: { action: 'KEEP' },
})

test('room type configuration saves atomically, conflicts safely and survives restart', { timeout: 20_000 }, async () => {
  const runtimePath = await mkdtemp(join(tmpdir(), 'sfg-room-types-'))
  let first = null
  let second = null
  try {
    first = await startApi(runtimePath)
    const sourceResponse = await apiRequest(first.port, '/ota-sources', {
      method: 'POST',
      headers: { 'Idempotency-Key': 'room-type-source-config-1' },
      body: JSON.stringify({
        reasonCode: 'ROOM_TYPE_TEST_SOURCE',
        sources: [sourceInput(0)],
      }),
    })
    const sourceBody = await sourceResponse.json()
    assert.equal(sourceResponse.status, 200, JSON.stringify(sourceBody))
    assert.equal(sourceBody.data[0].rowVersion, 1)
    await stopApi(first.child)
    first = null
    await rm(join(runtimePath, 'review-auth-state.json'), { force: true })

    const pmsRoomCode = 'PMS-ROOM-001'
    const [otaRoom] = extractRoomTypeCatalog({
      roomTypeId: 'ctrip-room-001',
      roomTypeName: '景观大床房',
    }, { platformCode: 'CTRIP' })
    const sourceFingerprint = createHash('sha256')
      .update(JSON.stringify({
        hotelId,
        sourceId,
        platformCode: 'CTRIP',
        dataEndpointUrl: 'https://merchant.ctrip.com/api/orders',
        requestMethod: 'GET',
        requestPayloadJson: '',
      }))
      .digest('hex')
    await Promise.all([
      writeFile(join(runtimePath, 'live-report-snapshots.json'), JSON.stringify({
        [hotelId]: [{
          hotelId,
          observedAt: '2026-09-01T08:00:00.000Z',
          businessDate: '2026-09-01',
          physicalInventory: [{
            physicalRoomTypeCode: pmsRoomCode,
            displayName: '景观大床房',
            primaryAvailableRooms: 2,
          }],
        }],
      })),
      writeFile(join(runtimePath, 'ota-room-type-catalogs.json'), JSON.stringify({
        [hotelId]: {
          [sourceId]: {
            sourceId,
            displayName: '携程订单房型',
            platformCode: 'CTRIP',
            sourceRowVersion: 1,
            sourceFingerprint,
            observedAt: '2026-09-01T08:01:00.000Z',
            roomTypes: [otaRoom],
          },
        },
      })),
    ])

    second = await startApi(runtimePath)
    const initial = await apiRequest(
      second.port,
      '/room-type-configuration',
    )
    assert.equal(initial.status, 200)
    const initialBody = await initial.json()
    assert.equal(initialBody.data.pmsRoomTypes[0].displayName, '景观大床房')
    assert.equal(initialBody.data.otaSources[0].roomTypes[0].displayName, '景观大床房')

    const renamedSource = await apiRequest(second.port, '/ota-sources', {
      method: 'POST',
      headers: { 'Idempotency-Key': 'room-type-source-rename-1' },
      body: JSON.stringify({
        reasonCode: 'ROOM_TYPE_TEST_SOURCE_RENAME',
        sources: [sourceInput(1, '携程主账号')],
      }),
    })
    const renamedSourceBody = await renamedSource.json()
    assert.equal(renamedSource.status, 200, JSON.stringify(renamedSourceBody))
    assert.equal(renamedSourceBody.data[0].rowVersion, 2)
    const afterSourceRename = await apiRequest(
      second.port,
      '/room-type-configuration',
    )
    const afterSourceRenameBody = await afterSourceRename.json()
    assert.equal(afterSourceRenameBody.data.otaSources[0].displayName, '携程主账号')
    assert.equal(afterSourceRenameBody.data.otaSources[0].roomTypes.length, 1)

    const mapping = {
      physicalRoomTypeCode: pmsRoomCode,
      sourceId,
      platformCode: 'CTRIP',
      otaRoomTypeCode: otaRoom.roomTypeCode,
      otaRoomTypeName: '客户端旧名称',
      matchMethod: 'MANUAL',
    }
    const saved = await apiRequest(second.port, '/room-type-configuration', {
      method: 'POST',
      headers: { 'Idempotency-Key': 'room-type-combined-save-1' },
      body: JSON.stringify({
        expectedRowVersion: 0,
        mappings: [mapping],
        hotSellingRoomTypeCodes: [pmsRoomCode],
        reasonCode: 'UPDATE_ROOM_TYPE_CONFIGURATION',
      }),
    })
    assert.equal(saved.status, 200)
    const savedBody = await saved.json()
    assert.equal(savedBody.data.rowVersion, 1)
    assert.equal(savedBody.data.mappings[0].otaRoomTypeName, '景观大床房')

    const conflict = await apiRequest(second.port, '/hot-selling-room-types', {
      method: 'POST',
      headers: { 'Idempotency-Key': 'room-type-legacy-conflict-1' },
      body: JSON.stringify({
        expectedRowVersion: 0,
        roomTypeCodes: [pmsRoomCode],
        reasonCode: 'UPDATE_HOT_SELLING_ROOM_TYPES',
      }),
    })
    assert.equal(conflict.status, 409)

    await stopApi(second.child)
    await rm(join(runtimePath, 'review-auth-state.json'), { force: true })
    second = await startApi(runtimePath)
    const restored = await apiRequest(
      second.port,
      '/room-type-configuration',
    )
    assert.equal(restored.status, 200)
    const restoredBody = await restored.json()
    assert.equal(restoredBody.data.rowVersion, 1)
    assert.equal(restoredBody.data.mappings.length, 1)
    assert.deepEqual(restoredBody.data.hotSellingRoomTypeCodes, [pmsRoomCode])

    const legacyPersisted = await readFile(
      join(runtimePath, 'hot-selling-room-types.json'),
      'utf8',
    )
    const canonicalPersisted = await readFile(
      join(runtimePath, 'room-type-mappings.json'),
      'utf8',
    )
    assert.equal(legacyPersisted.includes('mappings'), false)
    assert.equal(legacyPersisted.includes('景观大床房'), false)
    assert.equal(canonicalPersisted.includes('景观大床房'), true)
    assert.equal(canonicalPersisted.includes('客户端旧名称'), false)
    assert.equal(canonicalPersisted.includes('cookie'), false)
    assert.equal(canonicalPersisted.includes('guest'), false)

    await stopApi(second.child)
    await writeFile(
      join(runtimePath, 'hot-selling-room-types.json'),
      JSON.stringify({
        [hotelId]: {
          roomTypeCodes: [],
          updatedAt: '2026-09-02T00:00:00.000Z',
        },
      }),
    )
    await rm(join(runtimePath, 'review-auth-state.json'), { force: true })
    second = await startApi(runtimePath)
    const afterLegacyRollback = await apiRequest(
      second.port,
      '/room-type-configuration',
    )
    assert.equal(afterLegacyRollback.status, 200)
    const rollbackBody = await afterLegacyRollback.json()
    assert.equal(rollbackBody.data.rowVersion, 2)
    assert.deepEqual(rollbackBody.data.hotSellingRoomTypeCodes, [])
    assert.equal(rollbackBody.data.mappings.length, 1)
    const staleAfterRollback = await apiRequest(
      second.port,
      '/room-type-configuration',
      {
        method: 'POST',
        headers: { 'Idempotency-Key': 'room-type-stale-after-rollback-1' },
        body: JSON.stringify({
          expectedRowVersion: 1,
          mappings: [mapping],
          hotSellingRoomTypeCodes: [pmsRoomCode],
          reasonCode: 'UPDATE_ROOM_TYPE_CONFIGURATION',
        }),
      },
    )
    assert.equal(staleAfterRollback.status, 409)

    const staleSourceDelete = await apiRequest(second.port, '/ota-sources', {
      method: 'POST',
      headers: { 'Idempotency-Key': 'room-type-stale-source-delete-1' },
      body: JSON.stringify({
        reasonCode: 'ROOM_TYPE_TEST_SOURCE_DELETE',
        sources: [],
        deletedSources: [{ sourceId, expectedRowVersion: 1 }],
      }),
    })
    assert.equal(staleSourceDelete.status, 409)
    const safeSourceDelete = await apiRequest(second.port, '/ota-sources', {
      method: 'POST',
      headers: { 'Idempotency-Key': 'room-type-safe-source-delete-1' },
      body: JSON.stringify({
        reasonCode: 'ROOM_TYPE_TEST_SOURCE_DELETE',
        sources: [],
        deletedSources: [{ sourceId, expectedRowVersion: 2 }],
      }),
    })
    assert.equal(safeSourceDelete.status, 200)
    const safeSourceDeleteBody = await safeSourceDelete.json()
    assert.deepEqual(safeSourceDeleteBody.data, [])
  } finally {
    if (first) await stopApi(first.child)
    if (second) await stopApi(second.child)
    await rm(runtimePath, { recursive: true, force: true })
  }
})
