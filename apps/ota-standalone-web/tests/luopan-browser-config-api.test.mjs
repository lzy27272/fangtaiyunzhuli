import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import {
  mkdtemp,
  readFile,
  rm,
} from 'node:fs/promises'
import { createServer } from 'node:http'
import os from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const apiScript = fileURLToPath(
  new URL('../../../tools/uat/ota-standalone-review-api.mjs', import.meta.url),
)
const repoRoot = fileURLToPath(new URL('../../../', import.meta.url))
const token = 'luopan-browser-config-test-token'

const availablePort = async () => {
  const server = createServer()
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  const port = typeof address === 'object' ? address.port : 0
  server.close()
  await once(server, 'close')
  return port
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
      OTA_REVIEW_ACCESS_TOKEN: token,
      OTA_REVIEW_DATA_PATH: join(runtimePath, 'report-sources.json'),
      OTA_REVIEW_COOKIE_SECRETS_PATH: join(
        runtimePath,
        'report-source-cookie-secrets.json',
      ),
      OTA_REVIEW_SECRET_KEY: Buffer.alloc(32, 11).toString('base64url'),
      OTA_REVIEW_AUTO_COLLECTION_ENABLED: 'false',
    },
    stdio: ['ignore', 'ignore', 'pipe'],
  })
  let stderr = ''
  child.stderr.on('data', (chunk) => {
    stderr += chunk.toString('utf8')
  })
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (child.exitCode !== null) {
      throw new Error(
        `LUOPAN_CONFIG_TEST_API_EXITED:${stderr.slice(-1000)}`,
      )
    }
    try {
      const response = await fetch(
        `http://127.0.0.1:${port}/api/v1/ota/simulation/hotels`,
        { headers: { Authorization: `Bearer ${token}` } },
      )
      if (response.ok) return { child, port }
    } catch {
      // Retry while the local test API starts.
    }
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  child.kill()
  throw new Error('LUOPAN_CONFIG_TEST_API_TIMEOUT')
}

const stopApi = async (child) => {
  if (child.exitCode !== null) return
  child.kill()
  await once(child, 'exit')
}

test('Luopan browser config persists only an opaque profile reference and requires validation before enablement', async () => {
  const runtimePath = await mkdtemp(join(os.tmpdir(), 'luopan-config-'))
  let child
  try {
    const started = await startApi(runtimePath)
    child = started.child
    const directoryResponse = await fetch(
      `http://127.0.0.1:${started.port}/api/v1/ota/simulation/hotels`,
      { headers: { Authorization: `Bearer ${token}` } },
    )
    const directory = await directoryResponse.json()
    const hotel = directory.data.hotels[0]
    const base =
      `http://127.0.0.1:${started.port}/api/v1/ota/tenants/`
      + `${hotel.tenantId}/hotels/${hotel.hotelId}`

    const initialResponse = await fetch(
      `${base}/luopan-browser-config`,
      { headers: { Authorization: `Bearer ${token}` } },
    )
    const initial = (await initialResponse.json()).data
    assert.equal(initial.enabled, false)
    assert.equal(initial.hotelFingerprintConfigured, false)

    const savedResponse = await fetch(
      `${base}/luopan-browser-config`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          enabled: false,
          profileRef: 'store-account-test',
          rowVersion: initial.rowVersion,
          reasonCode: 'UPDATE_LUOPAN_BROWSER_CONFIG',
        }),
      },
    )
    assert.equal(savedResponse.status, 200)
    const saved = (await savedResponse.json()).data
    assert.equal(saved.profileRef, 'store-account-test')
    assert.equal(saved.scopeStatus, 'NOT_VALIDATED')
    assert.equal(saved.hotelFingerprintConfigured, false)

    const enableResponse = await fetch(
      `${base}/luopan-browser-config`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          enabled: true,
          profileRef: 'store-account-test',
          rowVersion: saved.rowVersion,
          reasonCode: 'UPDATE_LUOPAN_BROWSER_CONFIG',
        }),
      },
    )
    assert.equal(enableResponse.status, 400)
    const enableBody = await enableResponse.json()
    assert.equal(enableBody.code, 'LUOPAN_SESSION_VALIDATION_REQUIRED')

    const persisted = await readFile(
      join(dirname(join(runtimePath, 'report-sources.json')), 'luopan-browser-configs.json'),
      'utf8',
    )
    assert.match(persisted, /"profileRef": "store-account-test"/)
    assert.doesNotMatch(persisted, /password|cookie|jsessionid/i)
  } finally {
    if (child) await stopApi(child)
    await rm(runtimePath, { recursive: true, force: true })
  }
})
