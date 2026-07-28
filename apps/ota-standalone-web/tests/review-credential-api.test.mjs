import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const apiScript = fileURLToPath(
  new URL('../../../tools/uat/ota-standalone-review-api.mjs', import.meta.url),
)
const repoRoot = fileURLToPath(new URL('../../../', import.meta.url))

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
      OTA_REVIEW_USERNAME: 'review-admin',
      OTA_REVIEW_PASSWORD: 'example-Initial-Password-42',
      OTA_REVIEW_ACCESS_TOKEN: 'example-initial-review-access-token',
      OTA_REVIEW_DATA_PATH: join(runtimePath, 'report-sources.json'),
      OTA_REVIEW_COOKIE_SECRETS_PATH: join(
        runtimePath,
        'report-source-cookie-secrets.json',
      ),
      OTA_REVIEW_SECRET_KEY: Buffer.alloc(32, 9).toString('base64url'),
      OTA_REVIEW_AUTO_COLLECTION_ENABLED: 'false',
    },
  })
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (child.exitCode !== null) break
    try {
      const response = await fetch(`http://127.0.0.1:${port}/health`)
      if (response.ok) return { child, port }
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  throw new Error('REVIEW_API_START_FAILED')
}

async function stopReviewApi(child) {
  if (child.exitCode !== null) return
  child.kill()
  await once(child, 'exit')
}

async function login(port, username, password) {
  return fetch(`http://127.0.0.1:${port}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  })
}

test('admin credentials can be changed and survive restart without plaintext storage', { timeout: 15_000 }, async () => {
  const runtimePath = await mkdtemp(join(tmpdir(), 'review-credential-api-'))
  let first
  let second
  try {
    first = await startReviewApi(runtimePath)
    const initialLogin = await login(
      first.port,
      'review-admin',
      'example-Initial-Password-42',
    )
    assert.equal(initialLogin.status, 200)
    const initialSession = await initialLogin.json()

    const change = await fetch(
      `http://127.0.0.1:${first.port}/api/v1/auth/credentials`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${initialSession.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          currentPassword: 'example-Initial-Password-42',
          newUsername: 'operations-admin',
          newPassword: 'example-New-Secure-Password-84',
        }),
      },
    )
    assert.equal(change.status, 200)
    const changedSession = await change.json()
    assert.equal(changedSession.username, 'operations-admin')

    const oldSessionRequest = await fetch(
      `http://127.0.0.1:${first.port}/api/v1/ota/simulation/hotels`,
      {
        headers: {
          Authorization: `Bearer ${initialSession.accessToken}`,
        },
      },
    )
    assert.equal(oldSessionRequest.status, 401)
    const changedSessionRequest = await fetch(
      `http://127.0.0.1:${first.port}/api/v1/ota/simulation/hotels`,
      {
        headers: {
          Authorization: `Bearer ${changedSession.accessToken}`,
        },
      },
    )
    assert.equal(changedSessionRequest.status, 200)
    assert.equal(
      (await login(
        first.port,
        'review-admin',
        'example-Initial-Password-42',
      )).status,
      401,
    )

    const persisted = await readFile(
      join(runtimePath, 'review-auth-state.json'),
      'utf8',
    )
    assert.doesNotMatch(persisted, /example-Initial-Password-42/)
    assert.doesNotMatch(persisted, /example-New-Secure-Password-84/)
    assert.doesNotMatch(persisted, new RegExp(changedSession.accessToken))

    await stopReviewApi(first.child)
    first = null
    second = await startReviewApi(runtimePath)
    const restartedLogin = await login(
      second.port,
      'operations-admin',
      'example-New-Secure-Password-84',
    )
    assert.equal(restartedLogin.status, 200)
  } finally {
    if (first) await stopReviewApi(first.child)
    if (second) await stopReviewApi(second.child)
    await rm(runtimePath, { recursive: true, force: true })
  }
})
