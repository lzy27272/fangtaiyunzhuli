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
import { join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const apiScript = fileURLToPath(
  new URL('../../../tools/uat/ota-standalone-review-api.mjs', import.meta.url),
)
const repoRoot = fileURLToPath(new URL('../../../', import.meta.url))
const token = 'wecom-repair-bot-api-test-token'

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
      OTA_REVIEW_SECRET_KEY: Buffer.alloc(32, 13).toString('base64url'),
      OTA_REVIEW_AUTO_COLLECTION_ENABLED: 'false',
      OTA_REVIEW_LUOPAN_ASSISTED_REAUTH_ENABLED: 'false',
    },
    stdio: ['ignore', 'ignore', 'pipe'],
  })
  let stderr = ''
  child.stderr.on('data', (chunk) => {
    stderr += chunk.toString('utf8')
  })
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (child.exitCode !== null) {
      throw new Error(`WECOM_REPAIR_BOT_API_EXITED:${stderr.slice(-1000)}`)
    }
    try {
      const response = await fetch(
        `http://127.0.0.1:${port}/api/v1/ota/wecom-repair-bot-config`,
        { headers: { Authorization: `Bearer ${token}` } },
      )
      if (response.ok) return { child, port }
    } catch {
      // Retry while the local test API starts.
    }
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  child.kill()
  throw new Error('WECOM_REPAIR_BOT_API_TIMEOUT')
}

const stopApi = async (child) => {
  if (child.exitCode !== null) return
  child.kill()
  await once(child, 'exit')
}

test('WeCom repair bot config encrypts credentials and never returns them', async () => {
  const runtimePath = await mkdtemp(join(os.tmpdir(), 'wecom-repair-bot-'))
  const botId = 'bot-test-01'
  const secret = 'example-bot-secret-2026-rotate'
  let child
  try {
    const started = await startApi(runtimePath)
    child = started.child
    const endpoint =
      `http://127.0.0.1:${started.port}/api/v1/ota/wecom-repair-bot-config`
    const initialResponse = await fetch(endpoint, {
      headers: { Authorization: `Bearer ${token}` },
    })
    const initial = (await initialResponse.json()).data
    assert.equal(initial.enabled, false)
    assert.equal(initial.credentialConfigured, false)
    assert.equal(initial.paired, false)
    assert.equal(initial.pairedUserCount, 0)
    assert.equal(initial.pairedUserCapacity, 2)
    assert.deepEqual(initial.allowedUserFingerprints, [])

    const savedResponse = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        enabled: false,
        reasonCode: 'UPDATE_WECOM_REPAIR_BOT_CONFIG',
        credentialUpdate: {
          action: 'REPLACE',
          botId,
          secret,
        },
      }),
    })
    assert.equal(savedResponse.status, 200)
    const savedText = await savedResponse.text()
    assert.doesNotMatch(savedText, new RegExp(botId, 'i'))
    assert.doesNotMatch(savedText, new RegExp(secret, 'i'))
    const saved = JSON.parse(savedText).data
    assert.equal(saved.credentialConfigured, true)
    assert.equal(saved.paired, false)
    assert.equal(typeof saved.botIdFingerprint, 'string')

    const persisted = await readFile(
      join(runtimePath, 'wecom-repair-bot-secrets.json'),
      'utf8',
    )
    assert.doesNotMatch(persisted, new RegExp(botId, 'i'))
    assert.doesNotMatch(persisted, new RegExp(secret, 'i'))
    assert.match(persisted, /"ciphertext"/u)

    const clearedResponse = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        enabled: false,
        reasonCode: 'CLEAR_WECOM_REPAIR_BOT_CONFIG',
        credentialUpdate: { action: 'CLEAR' },
      }),
    })
    assert.equal(clearedResponse.status, 200)
    const cleared = (await clearedResponse.json()).data
    assert.equal(cleared.credentialConfigured, false)
    assert.equal(cleared.botIdFingerprint, null)
  } finally {
    if (child) await stopApi(child)
    await rm(runtimePath, { recursive: true, force: true })
  }
})
