import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, rm } from 'node:fs/promises'
import { createServer } from 'node:http'
import os from 'node:os'
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
  const port = typeof address === 'object' ? address.port : 0
  server.close()
  await once(server, 'close')
  return port
}

test('repair page is no-store and assisted repair stays disabled by default', async () => {
  const runtimePath = await mkdtemp(join(os.tmpdir(), 'luopan-repair-api-'))
  const port = await availablePort()
  const child = spawn(process.execPath, [apiScript], {
    cwd: repoRoot,
    env: {
      ...process.env,
      OTA_REVIEW_API_PORT: String(port),
      OTA_REVIEW_USERNAME: 'repair-test',
      OTA_REVIEW_PASSWORD: 'example-Repair-Test-Password-42',
      OTA_REVIEW_ACCESS_TOKEN: 'repair-test-token',
      OTA_REVIEW_DATA_PATH: join(runtimePath, 'report-sources.json'),
      OTA_REVIEW_COOKIE_SECRETS_PATH: join(
        runtimePath,
        'report-source-cookie-secrets.json',
      ),
      OTA_REVIEW_SECRET_KEY: Buffer.alloc(32, 13).toString('base64url'),
      OTA_REVIEW_PSEUDONYM_SECRET_KEY: Buffer.alloc(32, 14).toString('base64url'),
      OTA_REVIEW_AUTO_COLLECTION_ENABLED: 'false',
    },
    stdio: ['ignore', 'ignore', 'pipe'],
  })
  let stderr = ''
  child.stderr.on('data', (chunk) => {
    stderr += chunk.toString('utf8')
  })
  try {
    let health
    for (let attempt = 0; attempt < 40; attempt += 1) {
      if (child.exitCode !== null) {
        throw new Error(`REPAIR_API_EXITED:${stderr.slice(-500)}`)
      }
      try {
        health = await fetch(`http://127.0.0.1:${port}/health`)
        if (health.ok) break
      } catch {
        // Retry while the local API starts.
      }
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
    assert.equal(health?.ok, true)
    const healthBody = await health.json()
    assert.equal(healthBody.luopanAssistedRepair.enabled, false)
    assert.equal(healthBody.luopanAssistedRepair.ready, false)
    assert.equal(
      healthBody.luopanAssistedRepair.reasonCode,
      'LUOPAN_REPAIR_DISABLED',
    )
    assert.equal(healthBody.luopanAssistedRepair.webLinkReady, false)
    assert.equal(
      healthBody.luopanAssistedRepair.weComRepairBot.credentialConfigured,
      false,
    )
    assert.equal(
      Object.hasOwn(
        healthBody.luopanAssistedRepair.weComRepairBot,
        'secret',
      ),
      false,
    )

    const page = await fetch(
      `http://127.0.0.1:${port}/api/v1/luopan-repair`,
    )
    assert.equal(page.status, 200)
    assert.match(page.headers.get('cache-control'), /no-store/u)
    assert.match(
      page.headers.get('content-security-policy'),
      /default-src 'none'/u,
    )
    const html = await page.text()
    assert.match(html, /罗盘简报自动修复/u)
    assert.doesNotMatch(html, /qyapi\.weixin\.qq\.com|JSESSIONID/iu)
    assert.match(html, /\/api\/v1\/luopan-repair\/client\.js/u)

    const client = await fetch(
      `http://127.0.0.1:${port}/api/v1/luopan-repair/client.js`,
    )
    assert.equal(client.status, 200)
    assert.match(client.headers.get('content-type'), /javascript/u)
    assert.match(await client.text(), /history\.replaceState/u)

    const missing = await fetch(
      `http://127.0.0.1:${port}/api/v1/luopan-repair/status`,
      { headers: { Authorization: 'Repair invalid' } },
    )
    assert.equal(missing.status, 404)
  } finally {
    if (child.exitCode === null) {
      child.kill()
      await once(child, 'exit')
    }
    await rm(runtimePath, { recursive: true, force: true })
  }
})
