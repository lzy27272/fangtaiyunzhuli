import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, rm } from 'node:fs/promises'
import { createServer } from 'node:http'
import os from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { Script } from 'node:vm'

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

test('001 official-login popup is public but challenge data remains token-gated', async () => {
  const runtimePath = await mkdtemp(join(os.tmpdir(), 'bieyanghong-repair-api-'))
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
        throw new Error(`BIEYANGHONG_API_EXITED:${stderr.slice(-500)}`)
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
    assert.equal(healthBody.bieyanghongAssistedRepair.enabled, false)
    assert.equal(healthBody.bieyanghongAssistedRepair.ready, false)
    assert.equal(
      healthBody.bieyanghongAssistedRepair.pilotHotelCode,
      '001',
    )
    assert.equal(
      healthBody.bieyanghongAssistedRepair.credentialInputMode,
      'CLOUD_OFFICIAL_LOGIN_POPUP',
    )

    const page = await fetch(
      `http://127.0.0.1:${port}/api/v1/bieyanghong-repair`,
    )
    assert.equal(page.status, 200)
    assert.match(page.headers.get('cache-control'), /no-store/u)
    assert.match(page.headers.get('content-security-policy'), /default-src 'none'/u)
    const html = await page.text()
    assert.match(html, /别样红简报授权修复/u)
    assert.match(html, /本次处理管理员/u)
    assert.match(html, /id="open-official"/u)
    assert.match(html, /打开美团官网登录窗口/u)
    assert.match(html, /https:\/\/pms\.meituan\.com/u)
    assert.doesNotMatch(html, /id="phone"|id="password"|发送短信验证码/u)
    assert.doesNotMatch(html, /手机号\s*1\d{10}|Cookie=/iu)
    assert.match(html, /\/api\/v1\/bieyanghong-repair\/client\.js/u)

    const client = await fetch(
      `http://127.0.0.1:${port}/api/v1/bieyanghong-repair/client.js`,
    )
    assert.equal(client.status, 200)
    const clientScript = await client.text()
    assert.doesNotThrow(() => new Script(clientScript))
    assert.equal(
      clientScript.includes("window.open('/api/v1/bieyanghong-repair/official#'"),
      true,
    )
    assert.match(
      clientScript,
      /WAITING_FOR_INTERACTIVE_VERIFICATION/u,
    )
    assert.doesNotMatch(clientScript, /request-code|phoneValue|passwordValue/u)
    assert.doesNotMatch(clientScript, /localStorage|sessionStorage/u)

    const officialPage = await fetch(
      `http://127.0.0.1:${port}/api/v1/bieyanghong-repair/official`,
    )
    assert.equal(officialPage.status, 200)
    assert.match(officialPage.headers.get('cache-control'), /no-store/u)
    const officialHtml = await officialPage.text()
    assert.match(officialHtml, /美团官方：pms\.meituan\.com/u)
    assert.match(officialHtml, /id="vendor-screen"/u)
    assert.match(officialHtml, /type="password"/u)
    assert.doesNotMatch(officialHtml, /管理员手机号|短信验证码/u)

    const officialClient = await fetch(
      `http://127.0.0.1:${port}/api/v1/bieyanghong-repair/official.js`,
    )
    assert.equal(officialClient.status, 200)
    const officialClientScript = await officialClient.text()
    assert.doesNotThrow(() => new Script(officialClientScript))
    assert.match(officialClientScript, /bieyanghong-repair\/official\/start/u)
    assert.match(officialClientScript, /bieyanghong-repair\/visual\/frame/u)
    assert.match(officialClientScript, /bieyanghong-repair\/visual\/interact/u)
    assert.doesNotMatch(officialClientScript, /localStorage|sessionStorage/u)

    const missing = await fetch(
      `http://127.0.0.1:${port}/api/v1/bieyanghong-repair/status`,
      { headers: { Authorization: 'Repair invalid' } },
    )
    assert.equal(missing.status, 404)

    const visualMissing = await fetch(
      `http://127.0.0.1:${port}/api/v1/bieyanghong-repair/visual/frame`,
    )
    assert.equal(visualMissing.status, 400)
    assert.equal(
      (await visualMissing.json()).code,
      'BIEYANGHONG_REPAIR_CHALLENGE_NOT_FOUND',
    )

    const proxiedTrigger = await fetch(
      `http://127.0.0.1:${port}/api/v1/bieyanghong-repair/start`,
      {
        method: 'POST',
        headers: {
          Authorization: 'Pilot repair-test-token',
          'X-Forwarded-For': '203.0.113.10',
        },
      },
    )
    assert.equal(proxiedTrigger.status, 404)

    const localTrigger = await fetch(
      `http://127.0.0.1:${port}/api/v1/bieyanghong-repair/start`,
      {
        method: 'POST',
        headers: { Authorization: 'Pilot repair-test-token' },
      },
    )
    assert.equal(localTrigger.status, 400)
    assert.equal(
      (await localTrigger.json()).code,
      'BIEYANGHONG_REPAIR_DISABLED',
    )
  } finally {
    if (child.exitCode === null) {
      child.kill()
      await once(child, 'exit')
    }
    await rm(runtimePath, { recursive: true, force: true })
  }
})
