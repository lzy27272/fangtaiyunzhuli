import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, rm, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'node:http'
import { randomUUID } from 'node:crypto'

test('cloud gateway authenticates, checks hotel scope, restricts interactive access, and refuses forged scope', { timeout: 20000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'ota-cloud-api-'))
  const accessToken = randomUUID()
  const allocator = createServer(); allocator.listen(0, '127.0.0.1'); await once(allocator, 'listening')
  const port = allocator.address().port; allocator.close(); await once(allocator, 'close')
  const repo = fileURLToPath(new URL('../../../', import.meta.url))
  const child = spawn(process.execPath, [join(repo, 'tools/uat/ota-standalone-review-api.mjs')], { cwd: repo,
    env: { ...process.env, OTA_REVIEW_API_PORT: String(port), OTA_REVIEW_USERNAME: 'cloud-test-admin',
      OTA_REVIEW_PASSWORD: 'example-Cloud-Test-Password-42', OTA_REVIEW_ACCESS_TOKEN: accessToken,
      OTA_REVIEW_DATA_PATH: join(root, 'report-sources.json'), OTA_REVIEW_COOKIE_SECRETS_PATH: join(root, 'cookies.json'),
      OTA_REVIEW_SECRET_KEY: Buffer.alloc(32, 18).toString('base64url'),
      OTA_REVIEW_PSEUDONYM_SECRET_KEY: Buffer.alloc(32, 19).toString('base64url'), OTA_REVIEW_AUTO_COLLECTION_ENABLED: 'false' },
    stdio: ['ignore', 'ignore', 'ignore'] })
  const api = `http://127.0.0.1:${port}`
  const auth = { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' }
  try {
    let healthy = false
    for (let n = 0; n < 60; n++) {
      try { if ((await fetch(`${api}/health`)).ok) { healthy = true; break } } catch { /* bounded startup wait */ }
      await new Promise(r => setTimeout(r, 50))
    }
    assert.equal(healthy, true)
    const path = '/api/v1/ota/tenants/10000000-0000-4000-8000-000000000001/hotels/20000000-0000-4000-8000-000000000002/ota-cloud-browser'
    assert.equal((await fetch(api + path)).status, 401)
    const unavailable = await fetch(api + path, { headers: auth })
    assert.equal(unavailable.status, 200)
    assert.equal((await unavailable.json()).data[0].status, 'UNAVAILABLE')
    const forged = await fetch(api + path, { method: 'POST', headers: auth,
      body: JSON.stringify({ platformCode: 'CTRIP', action: 'open', actorId: 'spoof' }) })
    assert.equal(forged.status, 400)
    assert.equal((await forged.json()).code, 'OTA_CLOUD_REQUEST_INVALID')
    assert.equal((await fetch(api + path.replace('10000000-', '99999999-'), { headers: auth })).status, 404)
    const account = await fetch(`${api}/api/v1/auth/accounts`, { method: 'POST', headers: auth,
      body: JSON.stringify({ username: 'cloud-test-viewer', displayName: 'Synthetic cloud viewer',
        password: 'example-Cloud-Viewer-Password-42', roles: ['GENERAL_MANAGER'],
        hotelIds: ['20000000-0000-4000-8000-000000000002'] }) })
    assert.equal(account.status, 201)
    const login = await fetch(`${api}/api/v1/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'cloud-test-viewer', password: 'example-Cloud-Viewer-Password-42' }) })
    const viewerAuth = { Authorization: `Bearer ${(await login.json()).accessToken}`, 'Content-Type': 'application/json' }
    assert.equal((await fetch(api + path, { headers: viewerAuth })).status, 200)
    assert.equal((await fetch(api + path, { method: 'POST', headers: viewerAuth,
      body: JSON.stringify({ platformCode: 'CTRIP', action: 'open' }) })).status, 403)
    assert.equal((await fetch(api + path.replace('20000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000001'),
      { headers: viewerAuth })).status, 404)
  } finally {
    if (child.exitCode === null) { child.kill(); await once(child, 'exit') }
    await rm(root, { recursive: true, force: true })
  }
})

test('cloud release packages only runtime sources and uses isolated local-socket service', async () => {
  const source = fileURLToPath(new URL('../../../', import.meta.url))
  const publish = await readFile(join(source, 'infra/ota-standalone-server/scripts/Publish-OtaStandaloneServer.ps1'), 'utf8')
  for (const file of ['ota-cloud-browser.mjs', 'ota-cloud-browser-client.mjs', 'ota-cloud-browser-worker.mjs', 'ota-cloud-browser-policy.mjs',
    'ctrip-data-contract.mjs', 'ctrip-data-engine.mjs', 'meituan-data-contract.mjs', 'meituan-data-engine.mjs']) assert.ok(publish.includes(file))
  const service = await readFile(join(source, 'infra/ota-standalone-server/systemd/sifangguan-ota-cloud.service'), 'utf8')
  assert.match(service, /User=sifangguan-ota-cloud/); assert.match(service, /MemoryMax=2300M/)
  assert.match(service, /InaccessiblePaths=.*\/etc\/sifangguan-ota/)
  const worker = await readFile(join(source, 'tools/uat/ota-cloud-browser-worker.mjs'), 'utf8')
  assert.match(worker, /server.listen\(CLOUD_SOCKET/); assert.doesNotMatch(worker, /0\.0\.0\.0|9222|storageState\(|\.cookies\(/)
})
