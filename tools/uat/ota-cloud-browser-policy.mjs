import { createHash } from 'node:crypto'
import { createMeituanLoginNetwork } from '../labs/ota-browser/meituan-login-network.mjs'

export const CLOUD_VIEWPORT = Object.freeze({ width: 1280, height: 800 })
export const CLOUD_SOCKET = '/run/sifangguan-ota-cloud/browser.sock'
const tenantId = '10000000-0000-4000-8000-000000000001'
export const CLOUD_PILOTS = Object.freeze([
  Object.freeze({ tenantId, hotelId: '20000000-0000-4000-8000-000000000002', hotelCode: '002',
    platformCode: 'CTRIP', label: '解放路 MOOD · 携程', portal: 'https://ebooking.ctrip.com/login',
    propertyName: 'MOOD SHIFT酒店（甲秀楼青云市集店）' }),
  Object.freeze({ tenantId, hotelId: '6a3cc0e8-7915-45dd-abe2-52aba7ae6ab9', hotelCode: '009',
    platformCode: 'MEITUAN', label: '009 归来 · 美团', portal: 'https://eb.meituan.com/',
    propertyName: '四方馆白宫See City·爱立斯高空城景酒店（贵阳花果园购物中心店）', poiId: '1492755909', partnerId: '4950672' }),
])
export const cloudPilotFor = (scope) => CLOUD_PILOTS.find(p => p.tenantId === scope?.tenantId
  && p.hotelId === scope?.hotelId && p.platformCode === scope?.platformCode) ?? null
export const cloudProfileId = (scope) => {
  if (!cloudPilotFor(scope)) throw new Error('OTA_CLOUD_SCOPE_INVALID')
  return createHash('sha256').update(`${scope.tenantId}\0${scope.hotelId}\0${scope.platformCode}`).digest('hex')
}
export const cloudError = (error) => /^(?:OTA_CLOUD|CTRIP_DATA|MEITUAN_DATA)_[A-Z0-9_]{1,80}$/.test(error?.message ?? '')
  ? error.message : 'OTA_CLOUD_OPERATION_FAILED'

const ctripHosts = ['ebooking.ctrip.com', 'bd-s.tripcdn.cn', 'ws-s.tripcdn.cn', 'static.tripcdn.com',
  'file.tripcdn.com', 'dimg04.c-ctrip.com', 'dimg04.tripcdn.com', 'webresource.c-ctrip.com', 'm.ctrip.com']
const meituanHosts = new Set(createMeituanLoginNetwork().networkRules.map(r => new URL(r.origin).hostname))
// These exact security dependencies were observed during the official login.
// They are dependencies, not an attempt to evade provider access controls.
for (const host of ['certificates.meituan.com', 'awp-assets.sankuai.com',
  'root-certs-verify-digicert.meituan.com', 'root-certs-verify-globalsign.meituan.com']) meituanHosts.add(host)
export const cloudNetworkAllowed = (platform, raw, method = 'GET') => {
  let url
  try { url = new URL(raw) } catch { return false }
  if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443')) return false
  const hosts = platform === 'CTRIP' ? new Set(ctripHosts) : platform === 'MEITUAN' ? meituanHosts : new Set()
  if (!hosts.has(url.hostname) || !['GET', 'POST', 'HEAD', 'OPTIONS'].includes(method)) return false
  // Fail closed on known business mutations, even if reached by a manual click.
  if (/(?:refund|cancelOrder|confirmOrder|acceptOrder|rejectOrder|replyComment|savePrice|updatePrice|setRoomStatus|modifyInventory|delete)/i.test(url.pathname)) return false
  return true
}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export const validateCloudEnvelope = (body) => {
  if (!body || typeof body !== 'object' || Array.isArray(body) || !cloudPilotFor(body)
    || !uuid.test(body.actorId ?? '') || !['status', 'open', 'frame', 'input', 'inspect', 'collect', 'close'].includes(body.action)) {
    throw new Error('OTA_CLOUD_REQUEST_INVALID')
  }
  const allowed = new Set(['tenantId', 'hotelId', 'platformCode', 'actorId', 'action', 'sessionId', 'sequence', 'input'])
  if (Object.keys(body).some(k => !allowed.has(k))) throw new Error('OTA_CLOUD_REQUEST_INVALID')
  if (!['status', 'open'].includes(body.action) && !uuid.test(body.sessionId ?? '')) throw new Error('OTA_CLOUD_SESSION_REQUIRED')
  if (body.action === 'input') {
    if (!Number.isSafeInteger(body.sequence) || body.sequence < 1) throw new Error('OTA_CLOUD_INPUT_INVALID')
    validateCloudInput(body.input)
  }
  return body
}
export const validateCloudInput = (input) => {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('OTA_CLOUD_INPUT_INVALID')
  const exact = (...keys) => Object.keys(input).sort().join(',') === ['type', ...keys].sort().join(',')
  const point = p => p && Object.keys(p).sort().join(',') === 'x,y'
    && Number.isInteger(p.x) && Number.isInteger(p.y) && p.x >= 0 && p.y >= 0
    && p.x < CLOUD_VIEWPORT.width && p.y < CLOUD_VIEWPORT.height
  let valid = false
  if (input.type === 'pointer') valid = exact('points') && Array.isArray(input.points)
    && input.points.length >= 1 && input.points.length <= 100 && input.points.every(point)
  if (input.type === 'text') valid = exact('text') && typeof input.text === 'string'
    && input.text.length > 0 && input.text.length <= 256 && !/[\u0000-\u001f\u007f]/u.test(input.text)
  if (input.type === 'key') valid = exact('key')
    && ['Tab', 'Enter', 'Backspace', 'Delete', 'Escape', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Control+A'].includes(input.key)
  if (input.type === 'scroll') valid = exact('delta') && Number.isInteger(input.delta) && Math.abs(input.delta) <= 700
  if (!valid) throw new Error('OTA_CLOUD_INPUT_INVALID')
  return input
}
