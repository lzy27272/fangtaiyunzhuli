import { request } from 'node:http'
import { CLOUD_SOCKET, cloudPilotFor } from './ota-cloud-browser-policy.mjs'

export const cloudBrowserRequest = (input, { socketPath = CLOUD_SOCKET, timeoutMs = 50_000 } = {}) => new Promise((resolve, reject) => {
  if (!cloudPilotFor(input)) { reject(new Error('OTA_CLOUD_SCOPE_INVALID')); return }
  const body = JSON.stringify(input)
  const req = request({ socketPath, method: 'POST', path: '/command', headers: {
    'content-type': 'application/json', 'content-length': Buffer.byteLength(body),
  } }, res => {
    const chunks = []; let size = 0
    res.on('data', chunk => { size += chunk.length; if (size > 3 * 1024 * 1024) req.destroy(); else chunks.push(chunk) })
    res.on('error', () => reject(new Error('OTA_CLOUD_UNAVAILABLE')))
    res.on('end', () => {
      try {
        const value = JSON.parse(Buffer.concat(chunks).toString('utf8'))
        if (res.statusCode !== 200 || !value.data) throw new Error(/^OTA_CLOUD_[A-Z0-9_]+$/.test(value.code ?? '') ? value.code : 'OTA_CLOUD_UNAVAILABLE')
        resolve(value.data)
      } catch (e) { reject(/^OTA_CLOUD_[A-Z0-9_]+$/.test(e.message) ? e : new Error('OTA_CLOUD_UNAVAILABLE')) }
    })
  })
  req.setTimeout(timeoutMs, () => req.destroy(new Error('OTA_CLOUD_TIMEOUT')))
  req.once('error', () => reject(new Error('OTA_CLOUD_UNAVAILABLE')))
  req.end(body)
})
