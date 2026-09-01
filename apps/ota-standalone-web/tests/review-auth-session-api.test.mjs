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

const availablePort = async () => {
  const server = createServer()
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  server.close()
  await once(server, 'close')
  return typeof address === 'object' ? address.port : 0
}

const cookieValue = (response, name) => {
  const header = response.headers.get('set-cookie') ?? ''
  return decodeURIComponent(
    header.match(new RegExp(`(?:^|,\\s*)${name}=([^;,]+)`, 'u'))?.[1] ?? '',
  )
}

test('public auth issues rotating cookies, restores a session and records safe audit events', { timeout: 20_000 }, async () => {
  const runtimePath = await mkdtemp(join(tmpdir(), 'review-auth-session-api-'))
  const port = await availablePort()
  const testSecret = ['example', 'Phase1', 'Admin', 'Secret', '42'].join('-')
  const invalidSecret = ['not', 'valid'].join('-')
  const auditPath = join(runtimePath, 'security-audit.jsonl')
  const child = spawn(process.execPath, [apiScript], {
    cwd: repoRoot,
    env: {
      ...process.env,
      OTA_REVIEW_API_PORT: String(port),
      OTA_REVIEW_USERNAME: 'phase1-admin',
      OTA_REVIEW_PASSWORD: testSecret,
      OTA_REVIEW_ACCESS_TOKEN: 'phase1-bootstrap-token',
      OTA_REVIEW_DATA_PATH: join(runtimePath, 'report-sources.json'),
      OTA_REVIEW_COOKIE_SECRETS_PATH: join(runtimePath, 'cookies.json'),
      OTA_REVIEW_SECRET_KEY: Buffer.alloc(32, 31).toString('base64url'),
      OTA_REVIEW_PSEUDONYM_SECRET_KEY: Buffer.alloc(32, 30).toString('base64url'),
      OTA_REVIEW_AUTH_STATE_PATH: join(runtimePath, 'auth.json'),
      OTA_REVIEW_AUTH_REFRESH_STATE_PATH: join(runtimePath, 'sessions.json'),
      OTA_REVIEW_SECURITY_AUDIT_PATH: auditPath,
      OTA_REVIEW_AUTH_COOKIE_PATH: '/api/v1/auth',
      OTA_REVIEW_AUTH_COOKIE_SECURE: 'false',
      OTA_REVIEW_ALLOWED_ORIGINS: 'http://127.0.0.1:15180',
      OTA_REVIEW_AUTO_COLLECTION_ENABLED: 'false',
    },
    stdio: ['ignore', 'ignore', 'pipe'],
  })
  let stderr = ''
  child.stderr.on('data', (chunk) => { stderr += chunk.toString('utf8') })
  try {
    let health
    for (let attempt = 0; attempt < 60; attempt += 1) {
      if (child.exitCode !== null) throw new Error(`API_EXITED:${stderr.slice(-500)}`)
      try {
        health = await fetch(`http://127.0.0.1:${port}/health`)
        if (health.ok) break
      } catch {}
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 50))
    }
    assert.equal(health?.ok, true)

    const login = await fetch(`http://127.0.0.1:${port}/api/v1/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: 'http://127.0.0.1:15180',
      },
      body: JSON.stringify({ username: 'phase1-admin', password: testSecret }),
    })
    assert.equal(login.status, 200)
    const loginBody = await login.json()
    assert.equal(loginBody.expiresInSeconds, 600)
    assert.ok(loginBody.accessToken)
    assert.equal(Object.hasOwn(loginBody, 'refreshToken'), false)
    const refreshToken = cookieValue(login, 'ota_refresh')
    const csrfToken = cookieValue(login, 'ota_csrf')
    assert.ok(refreshToken)
    assert.ok(csrfToken)

    const missingCsrfCookie = await fetch(
      `http://127.0.0.1:${port}/api/v1/auth/refresh`,
      {
        method: 'POST',
        headers: {
          Cookie: `ota_refresh=${encodeURIComponent(refreshToken)}`,
          Origin: 'http://127.0.0.1:15180',
          'X-CSRF-TOKEN': csrfToken,
        },
      },
    )
    assert.equal(missingCsrfCookie.status, 401)

    const refresh = await fetch(`http://127.0.0.1:${port}/api/v1/auth/refresh`, {
      method: 'POST',
      headers: {
        Cookie: `ota_refresh=${encodeURIComponent(refreshToken)}; ota_csrf=${encodeURIComponent(csrfToken)}`,
        Origin: 'http://127.0.0.1:15180',
        'X-CSRF-TOKEN': csrfToken,
      },
    })
    assert.equal(refresh.status, 200)
    const rotatedRefreshToken = cookieValue(refresh, 'ota_refresh')
    const rotatedCsrfToken = cookieValue(refresh, 'ota_csrf')
    assert.notEqual(rotatedRefreshToken, refreshToken)

    const replay = await fetch(`http://127.0.0.1:${port}/api/v1/auth/refresh`, {
      method: 'POST',
      headers: {
        Cookie: `ota_refresh=${encodeURIComponent(refreshToken)}; ota_csrf=${encodeURIComponent(csrfToken)}`,
        Origin: 'http://127.0.0.1:15180',
        'X-CSRF-TOKEN': csrfToken,
      },
    })
    assert.equal(replay.status, 401)

    const logout = await fetch(`http://127.0.0.1:${port}/api/v1/auth/logout`, {
      method: 'POST',
      headers: {
        Cookie: `ota_refresh=${encodeURIComponent(rotatedRefreshToken)}; ota_csrf=${encodeURIComponent(rotatedCsrfToken)}`,
        Origin: 'http://127.0.0.1:15180',
        'X-CSRF-TOKEN': rotatedCsrfToken,
      },
    })
    assert.equal(logout.status, 204)

    for (let attempt = 0; attempt < 6; attempt += 1) {
      const denied = await fetch(`http://127.0.0.1:${port}/api/v1/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: 'missing-user',
          password: invalidSecret,
        }),
      })
      assert.equal(denied.status, attempt < 5 ? 401 : 429)
    }

    for (let attempt = 0; attempt < 21; attempt += 1) {
      const denied = await fetch(`http://127.0.0.1:${port}/api/v1/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: `missing-user-${attempt}`,
          password: invalidSecret,
        }),
      })
      assert.equal(denied.status, attempt < 20 ? 401 : 429)
    }

    const audit = await readFile(auditPath, 'utf8')
    assert.match(audit, /"action":"AUTH_LOGIN"/u)
    assert.match(audit, /"action":"AUTH_REFRESH"/u)
    assert.match(audit, /"action":"AUTH_LOGOUT"/u)
    assert.doesNotMatch(audit, new RegExp(testSecret, 'u'))
    assert.doesNotMatch(audit, new RegExp(refreshToken, 'u'))
  } finally {
    if (child.exitCode === null) {
      child.kill()
      await once(child, 'exit')
    }
    await rm(runtimePath, { recursive: true, force: true })
  }
})
