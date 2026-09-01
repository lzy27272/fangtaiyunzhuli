import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const apiScript = fileURLToPath(
  new URL('../../../tools/uat/ota-standalone-review-api.mjs', import.meta.url),
)
const repoRoot = fileURLToPath(new URL('../../../', import.meta.url))
const hotelId = '20000000-0000-4000-8000-000000000001'
const tenantId = '10000000-0000-4000-8000-000000000001'

const availablePort = async () => {
  const server = createServer()
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const port = server.address().port
  server.close()
  await once(server, 'close')
  return port
}

test('a new runtime defaults to the current Meituan business overview source', async () => {
  const runtimePath = await mkdtemp(join(tmpdir(), 'report-source-migration-'))
  const configPath = join(runtimePath, 'report-sources.json')
  const revenueSourceId = '27f5ead0-11a3-4131-87ce-7ba9d7ff0ce0'
  const port = await availablePort()
  const token = 'report-source-migration-token'
  const child = spawn(process.execPath, [apiScript], {
    cwd: repoRoot,
    env: {
      ...process.env,
      OTA_REVIEW_API_PORT: String(port),
      OTA_REVIEW_USERNAME: 'migration-test',
      OTA_REVIEW_PASSWORD: 'example-Migration-Test-Password-42',
      OTA_REVIEW_ACCESS_TOKEN: token,
      OTA_REVIEW_DATA_PATH: configPath,
      OTA_REVIEW_COOKIE_SECRETS_PATH: join(runtimePath, 'cookies.json'),
      OTA_REVIEW_SECRET_KEY: Buffer.alloc(32, 19).toString('base64url'),
      OTA_REVIEW_PSEUDONYM_SECRET_KEY: Buffer.alloc(32, 20).toString('base64url'),
      OTA_REVIEW_AUTO_COLLECTION_ENABLED: 'false',
    },
    stdio: ['ignore', 'ignore', 'pipe'],
  })
  try {
    let health = null
    for (let attempt = 0; attempt < 40; attempt += 1) {
      try {
        health = await fetch(`http://127.0.0.1:${port}/health`)
        if (health.ok) break
      } catch {
        // Wait for startup.
      }
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
    assert.equal(health?.ok, true)
    const response = await fetch(
      `http://127.0.0.1:${port}/api/v1/ota/tenants/${tenantId}`
      + `/hotels/${hotelId}/report-sources`,
      { headers: { Authorization: `Bearer ${token}` } },
    )
    assert.equal(response.status, 200)
    const body = await response.json()
    const revenue = body.data.find((source) =>
      source.sourceId === revenueSourceId)
    assert.equal(
      revenue.endpointUrl,
      'https://pms.meituan.com/hotelpms/api/v1/report/home/workbench/businessOverview',
    )
    assert.equal(revenue.displayName, '经营概览（房费/ADR/RevPAR）')
    const persisted = JSON.parse(await readFile(configPath, 'utf8'))
    assert.equal(
      persisted[hotelId].find((source) => source.sourceId === revenueSourceId)
        .endpointUrl,
      revenue.endpointUrl,
    )
  } finally {
    if (child.exitCode === null) {
      child.kill()
      await once(child, 'exit')
    }
    await rm(runtimePath, { recursive: true, force: true })
  }
})
