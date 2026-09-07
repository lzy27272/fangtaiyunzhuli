import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
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
  const noVncRoot = join(runtimePath, 'novnc')
  const liteInlineScript = '\nwindow.__NOVNC_LITE_STARTED__ = true\n'
  await mkdir(noVncRoot)
  await writeFile(
    join(noVncRoot, 'vnc_lite.html'),
    '<!doctype html><title>noVNC lite fixture</title>'
      + `<script type="module">${liteInlineScript}</script>`,
    'utf8',
  )
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
      OTA_REVIEW_BIEYANGHONG_COLLECTION_MODE: 'STORE_TRUSTED_DEVICE',
      BIEYANGHONG_NOVNC_ROOT: noVncRoot,
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
    const officialCsp = officialPage.headers.get('content-security-policy')
    assert.match(officialCsp, /frame-src 'self'/u)
    assert.match(officialCsp, /connect-src 'self'/u)
    assert.doesNotMatch(officialCsp, /wss:/u)
    const officialHtml = await officialPage.text()
    assert.match(officialHtml, /直接操作美团官方页面/u)
    assert.match(officialHtml, /id="official-frame"/u)
    assert.match(officialHtml, /class="official-frame hidden"/u)
    assert.match(officialHtml, /width:100%;height:100%/u)
    assert.doesNotMatch(
      officialHtml,
      /vendor-screen|pan-mode|operate-mode|locate-login/u,
    )
    assert.doesNotMatch(
      officialHtml,
      /account-value|secret-value|type="password"|手机号|验证码/u,
    )

    const officialClient = await fetch(
      `http://127.0.0.1:${port}/api/v1/bieyanghong-repair/official.js`,
    )
    assert.equal(officialClient.status, 200)
    const officialClientScript = await officialClient.text()
    assert.doesNotThrow(() => new Script(officialClientScript))
    assert.match(officialClientScript, /bieyanghong-repair\/official\/start/u)
    assert.match(officialClientScript, /bieyanghong-repair\/vnc\/session/u)
    assert.match(officialClientScript, /bieyanghong-repair\/vnc\/check/u)
    assert.match(
      officialClientScript,
      /bieyanghong-repair\/novnc\/vnc_lite\.html\?scale=true/u,
    )
    assert.doesNotMatch(officialClientScript, /view_only=/u)
    assert.match(officialClientScript, /topBar\.hidden = true/u)
    assert.match(
      officialClientScript,
      /officialFrame\.addEventListener\('load', simplifyRemoteView\)/u,
    )
    assert.doesNotMatch(officialClientScript, /novnc\/vnc\.html/u)
    assert.match(
      officialClientScript,
      /if \(!sessionResponse\.ok\)[\s\S]*?repairToken = ''[\s\S]*?officialFrame\.src = noVncUrl/u,
    )
    assert.doesNotMatch(
      officialClientScript,
      /bieyanghong-repair\/visual\/(?:frame|interact)|kind:'(?:field|control)'/u,
    )
    assert.doesNotMatch(officialClientScript, /localStorage|sessionStorage/u)

    const liteClient = await fetch(
      `http://127.0.0.1:${port}/api/v1/bieyanghong-repair/novnc/vnc_lite.html`,
    )
    assert.equal(liteClient.status, 200)
    const liteCsp = liteClient.headers.get('content-security-policy')
    assert.match(liteCsp, /script-src 'self'/u)
    assert.doesNotMatch(liteCsp, /script-src[^;]*'unsafe-inline'/u)
    const liteHtml = await liteClient.text()
    assert.match(liteHtml, /noVNC lite fixture/u)
    assert.match(liteHtml, /src="\.\/vnc_lite_bootstrap\.js"/u)
    assert.doesNotMatch(liteHtml, /__NOVNC_LITE_STARTED__/u)

    const liteBootstrap = await fetch(
      `http://127.0.0.1:${port}/api/v1/bieyanghong-repair/novnc/vnc_lite_bootstrap.js`,
    )
    assert.equal(liteBootstrap.status, 200)
    assert.match(
      liteBootstrap.headers.get('content-type'),
      /application\/javascript/u,
    )
    assert.equal(await liteBootstrap.text(), liteInlineScript)

    const missing = await fetch(
      `http://127.0.0.1:${port}/api/v1/bieyanghong-repair/status`,
      { headers: { Authorization: 'Repair invalid' } },
    )
    assert.equal(missing.status, 404)

    const vncCheckMissing = await fetch(
      `http://127.0.0.1:${port}/api/v1/bieyanghong-repair/vnc/check`,
    )
    assert.equal(vncCheckMissing.status, 401)
    assert.equal(
      (await vncCheckMissing.json()).code,
      'BIEYANGHONG_REMOTE_DESKTOP_SESSION_REQUIRED',
    )

    for (const assetPath of [
      'missing-test-asset.html',
      '%2e%2e%2fpackage.json',
    ]) {
      const missingAsset = await fetch(
        `http://127.0.0.1:${port}/api/v1/bieyanghong-repair/novnc/${assetPath}`,
      )
      assert.equal(missingAsset.status, 404)
      assert.equal(
        (await missingAsset.json()).code,
        'BIEYANGHONG_NOVNC_ASSET_NOT_FOUND',
      )
    }

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
      'BIEYANGHONG_TRUSTED_DEVICE_MODE',
    )

    const anonymousWorkspace = await fetch(
      `http://127.0.0.1:${port}`
      + '/api/v1/ota/tenants/example/hotels/example/bieyanghong-workspace',
      { method: 'POST' },
    )
    assert.equal(anonymousWorkspace.status, 401)

    const loginResponse = await fetch(
      `http://127.0.0.1:${port}/api/v1/auth/login`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: 'repair-test',
          password: 'example-Repair-Test-Password-42',
        }),
      },
    )
    assert.equal(loginResponse.status, 200)
    const { accessToken } = await loginResponse.json()
    const hotelsResponse = await fetch(
      `http://127.0.0.1:${port}/api/v1/ota/simulation/hotels`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    )
    assert.equal(hotelsResponse.status, 200)
    const hotelRows = (await hotelsResponse.json()).data.hotels
    const hotel001 = hotelRows.find((hotel) => hotel.hotelCode === '001')
    assert.ok(hotel001)
    const fixedWorkspace = await fetch(
      `http://127.0.0.1:${port}`
      + `/api/v1/ota/tenants/${encodeURIComponent(hotel001.tenantId)}`
      + `/hotels/${encodeURIComponent(hotel001.hotelId)}`
      + '/bieyanghong-workspace',
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}` },
      },
    )
    assert.equal(fixedWorkspace.status, 400)
    assert.equal(
      (await fixedWorkspace.json()).code,
      'BIEYANGHONG_TRUSTED_DEVICE_MODE',
    )

    const recoveryPath =
      `http://127.0.0.1:${port}`
      + '/api/v1/internal/bieyanghong-cookie-recovery'
    const proxiedRecovery = await fetch(recoveryPath, {
      method: 'POST',
      headers: {
        Authorization: 'Pilot repair-test-token',
        'Content-Type': 'application/json',
        'X-Forwarded-For': '203.0.113.10',
      },
      body: JSON.stringify({
        operationKey: 'COOKIE_RECOVERY_20260829_003_013',
      }),
    })
    assert.equal(proxiedRecovery.status, 404)

    const bearerRecovery = await fetch(recoveryPath, {
      method: 'POST',
      headers: {
        Authorization: ['Bearer', 'repair-test-token'].join(' '),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        operationKey: 'COOKIE_RECOVERY_20260829_003_013',
      }),
    })
    assert.equal(bearerRecovery.status, 404)

    const callerScopedRecovery = await fetch(recoveryPath, {
      method: 'POST',
      headers: {
        Authorization: 'Pilot repair-test-token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        operationKey: 'COOKIE_RECOVERY_20260829_003_013',
        hotelCodes: ['001'],
      }),
    })
    assert.equal(callerScopedRecovery.status, 400)
    assert.equal(
      (await callerScopedRecovery.json()).code,
      'BIEYANGHONG_RECOVERY_SCOPE_IS_SERVER_FIXED',
    )

    const fixedRecovery = await fetch(recoveryPath, {
      method: 'POST',
      headers: {
        Authorization: 'Pilot repair-test-token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        operationKey: 'COOKIE_RECOVERY_20260829_003_013',
      }),
    })
    assert.equal(fixedRecovery.status, 400)
    assert.equal(
      (await fixedRecovery.json()).code,
      'BIEYANGHONG_RECOVERY_COLLECTION_NOT_READY',
    )
  } finally {
    if (child.exitCode === null) {
      child.kill()
      await once(child, 'exit')
    }
    await rm(runtimePath, { recursive: true, force: true })
  }
})
