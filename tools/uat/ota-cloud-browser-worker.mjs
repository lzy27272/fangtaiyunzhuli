import { createServer } from 'node:http'
import { chmodSync, existsSync, unlinkSync } from 'node:fs'
import { createRequire } from 'node:module'
import { CLOUD_SOCKET, cloudError } from './ota-cloud-browser-policy.mjs'
import { createCloudBrowserManager } from './ota-cloud-browser.mjs'

const require = createRequire(import.meta.url)
if (process.platform !== 'linux' || process.getuid() === 0 || existsSync(CLOUD_SOCKET)) throw new Error('OTA_CLOUD_RUNTIME_UNSAFE')
const chromium = require('/opt/sifangguan-ota/runtime/playwright/node_modules/playwright').chromium
const manager = createCloudBrowserManager({ root: '/var/lib/sifangguan-ota-cloud', chromium })
const server = createServer(async (req, res) => {
  const send = (code, value) => { res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(value)) }
  try {
    if (req.method !== 'POST' || req.url !== '/command' || req.headers['content-type'] !== 'application/json') {
      send(404, { code: 'OTA_CLOUD_NOT_FOUND' }); return
    }
    let size = 0; const chunks = []
    for await (const chunk of req) {
      size += chunk.length
      if (size > 16384) { send(413, { code: 'OTA_CLOUD_REQUEST_INVALID' }); return }
      chunks.push(chunk)
    }
    let body
    try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')) } catch { throw new Error('OTA_CLOUD_REQUEST_INVALID') }
    const result = await manager.execute(body)
    send(200, { data: result })
  } catch (e) { if (!res.headersSent) send(400, { code: cloudError(e) }); else res.end() }
})
server.requestTimeout = 55_000; server.headersTimeout = 10_000; server.maxConnections = 16
server.listen(CLOUD_SOCKET, () => { chmodSync(CLOUD_SOCKET, 0o660); process.stdout.write('OTA_CLOUD_READY\n') })
const stop = async () => {
  server.close(); await manager.closeAll(); server.closeAllConnections()
  if (existsSync(CLOUD_SOCKET)) unlinkSync(CLOUD_SOCKET)
  process.exit(0)
}
process.once('SIGTERM', stop); process.once('SIGINT', stop)
