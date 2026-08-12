import { randomBytes } from 'node:crypto'
import {
  mkdirSync,
  renameSync,
  writeFileSync,
} from 'node:fs'
import { createServer } from 'node:http'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HOST = '127.0.0.1'
const DEFAULT_PORT = 15_991
const MAX_FORM_BYTES = 8 * 1024
const MAX_RESPONSE_BYTES = 5 * 1024 * 1024
const REQUEST_TIMEOUT_MS = 20_000
const READ_ONLY_GATEWAY = new URL(
  'https://bj-web-r.chinapms.com/pms-web/gateway/',
)
const RESULT_PATH = resolve(
  process.env.LUOPAN_GATEWAY_TEST_RESULT_PATH
    ?? 'tmp/luopan-gateway-test-result.json',
)
const SAFE_PROVIDER_CODE = /^[A-Za-z0-9._-]{1,96}$/
const SAFE_IDENTIFIER = /^[A-Za-z0-9._-]{1,128}$/
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/

const noStoreHeaders = {
  'Cache-Control': 'no-store, max-age=0',
  'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
}

const escapeHtml = (value) => String(value ?? '')
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#39;')

const validDate = (value) => {
  if (!DATE_PATTERN.test(value)) return false
  const parsed = new Date(`${value}T00:00:00Z`)
  return Number.isFinite(parsed.getTime())
    && parsed.toISOString().slice(0, 10) === value
}

const dateAfter = (dateKey, days) => {
  const date = new Date(`${dateKey}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

const numeric = (value) => {
  if (typeof value === 'number') return Number.isFinite(value)
  return typeof value === 'string'
    && value.trim() !== ''
    && Number.isFinite(Number(value))
}

const payload = (candidate) => {
  if (
    candidate
    && typeof candidate === 'object'
    && !Array.isArray(candidate)
    && Object.hasOwn(candidate, 'data')
  ) {
    return candidate.data
  }
  return candidate
}

export const normalizeRoomRentCoverage = (candidate) => {
  const value = payload(candidate)
  const required = [
    'today_date',
    'total_room',
    'avail_room',
    'rent_room',
    'rent_ratio',
    'avg_room_rate',
    'revpar',
  ]
  const numericFields = required.filter((name) => name !== 'today_date')
  const missingFields = required.filter(
    (name) => !value || !Object.hasOwn(value, name),
  )
  const invalidNumericFields = numericFields.filter(
    (name) => value && Object.hasOwn(value, name) && !numeric(value[name]),
  )
  return {
    contractSatisfied:
      missingFields.length === 0 && invalidNumericFields.length === 0,
    requiredFieldCount: required.length,
    missingFields,
    invalidNumericFields,
  }
}

export const normalizeRevenueCoverage = (candidate) => {
  const value = payload(candidate)
  const required = [
    'today_date',
    'total_revenue',
    'room_fee_revenue',
  ]
  const numericFields = required.filter((name) => name !== 'today_date')
  const missingFields = required.filter(
    (name) => !value || !Object.hasOwn(value, name),
  )
  const invalidNumericFields = numericFields.filter(
    (name) => value && Object.hasOwn(value, name) && !numeric(value[name]),
  )
  return {
    contractSatisfied:
      missingFields.length === 0 && invalidNumericFields.length === 0,
    requiredFieldCount: required.length,
    missingFields,
    invalidNumericFields,
  }
}

export const normalizeBookingCoverage = (candidate) => {
  const value = payload(candidate)
  const bookings = Array.isArray(value) ? value : []
  const required = [
    'hotel_id',
    'check_in_date',
    'check_out_date',
    'total_price',
    'room_rates',
    'order_status',
  ]
  const piiFields = new Set([
    'card_no',
    'mobile',
    'booker_name',
    'booker_mobile',
    'guests',
  ])
  const missingFields = new Set()
  const futureDates = new Set()
  let piiFieldOccurrencesDropped = 0
  let rateItemCount = 0

  for (const booking of bookings) {
    for (const name of required) {
      if (!booking || !Object.hasOwn(booking, name)) missingFields.add(name)
    }
    for (const name of piiFields) {
      if (booking && Object.hasOwn(booking, name)) {
        piiFieldOccurrencesDropped += 1
      }
    }
    for (const rateGroup of Array.isArray(booking?.room_rates)
      ? booking.room_rates
      : []) {
      for (const item of Array.isArray(rateGroup?.room_rate_items)
        ? rateGroup.room_rate_items
        : []) {
        if (typeof item?.rate_date === 'string' && numeric(item?.room_rate)) {
          futureDates.add(item.rate_date)
          rateItemCount += 1
        }
      }
    }
  }

  return {
    contractSatisfied:
      Array.isArray(value)
      && missingFields.size === 0
      && (bookings.length === 0 || rateItemCount > 0),
    recordCount: bookings.length,
    requiredFieldCount: required.length,
    missingFields: [...missingFields],
    futureDateCount: futureDates.size,
    rateItemCount,
    piiFieldOccurrencesDropped,
    piiPersisted: false,
  }
}

const normalizedInput = (form) => {
  const scopeMode = form.get('scopeMode') === 'group' ? 'group' : 'hotel'
  const scopeId = String(form.get('scopeId') ?? '').trim()
  const hotelId = String(form.get('hotelId') ?? '').trim()
  const sobCode = String(form.get('sobCode') ?? '').trim()
  const password = String(form.get('password') ?? '')
  const queryDate = String(form.get('queryDate') ?? '').trim()
  if (
    !SAFE_IDENTIFIER.test(scopeId)
    || !SAFE_IDENTIFIER.test(hotelId)
    || !SAFE_IDENTIFIER.test(sobCode)
    || password.length < 1
    || password.length > 256
    || /[\r\n\u0000]/.test(password)
    || !validDate(queryDate)
  ) {
    throw new Error('INPUT_INVALID')
  }
  return { scopeMode, scopeId, hotelId, sobCode, password, queryDate }
}

export const buildGatewayUrl = ({
  endpoint,
  scopeMode,
  scopeId,
  hotelId,
  sobCode,
  password,
  query = {},
}) => {
  if (!/^\/[a-z0-9_]+$/.test(endpoint)) {
    throw new Error('ENDPOINT_NOT_ALLOWED')
  }
  const url = new URL(endpoint.slice(1), READ_ONLY_GATEWAY)
  if (
    url.origin !== READ_ONLY_GATEWAY.origin
    || !url.pathname.startsWith(READ_ONLY_GATEWAY.pathname)
  ) {
    throw new Error('GATEWAY_NOT_ALLOWED')
  }
  url.searchParams.set(
    scopeMode === 'group' ? 'sob.hotelgroup_id' : 'sob.hotel_id',
    scopeId,
  )
  url.searchParams.set('sob.sob_code', sobCode)
  url.searchParams.set('sob.password', password)
  url.searchParams.set('hotel_id', hotelId)
  for (const [key, value] of Object.entries(query)) {
    url.searchParams.set(key, value)
  }
  return url
}

const readLimitedJson = async (response) => {
  const contentLength = Number(response.headers.get('content-length') ?? '0')
  if (contentLength > MAX_RESPONSE_BYTES) {
    throw new Error('RESPONSE_TOO_LARGE')
  }
  if (!response.body) throw new Error('RESPONSE_BODY_MISSING')
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let body = ''
  let total = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > MAX_RESPONSE_BYTES) {
      await reader.cancel()
      throw new Error('RESPONSE_TOO_LARGE')
    }
    body += decoder.decode(value, { stream: true })
  }
  body += decoder.decode()
  try {
    return JSON.parse(body)
  } catch {
    throw new Error('RESPONSE_JSON_INVALID')
  }
}

const providerCode = (candidate) => {
  const code = typeof candidate?.exception_code === 'string'
    ? candidate.exception_code
    : null
  return code && SAFE_PROVIDER_CODE.test(code) ? code : null
}

const callGateway = async (input, endpoint, query) => {
  const url = buildGatewayUrl({ ...input, endpoint, query })
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  try {
    const response = await fetch(url, {
      method: 'GET',
      redirect: 'error',
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    })
    const body = await readLimitedJson(response)
    if (!response.ok) {
      return {
        ok: false,
        httpStatus: response.status,
        providerCode: providerCode(body),
      }
    }
    return { ok: true, httpStatus: response.status, body }
  } catch (error) {
    const safeCode = [
      'RESPONSE_TOO_LARGE',
      'RESPONSE_BODY_MISSING',
      'RESPONSE_JSON_INVALID',
    ].includes(error?.message)
      ? error.message
      : error?.name === 'AbortError'
        ? 'GATEWAY_TIMEOUT'
        : 'GATEWAY_NETWORK_FAILED'
    return { ok: false, httpStatus: null, providerCode: safeCode }
  } finally {
    clearTimeout(timeout)
  }
}

const runGatewayTest = async (input) => {
  const common = {
    scopeMode: input.scopeMode,
    scopeId: input.scopeId,
    hotelId: input.hotelId,
    sobCode: input.sobCode,
    password: input.password,
  }
  const roomResult = await callGateway(
    common,
    '/stat_hotel_daily_room_rent',
    { query_date: input.queryDate },
  )
  if (!roomResult.ok) {
    return {
      testedAt: new Date().toISOString(),
      gateway: 'LUOPAN_READ_ONLY_GATEWAY',
      credentialsPersisted: false,
      piiPersisted: false,
      productionChanged: false,
      complete: false,
      endpoints: {
        roomRent: roomResult,
        revenue: { ok: false, skipped: 'AUTH_OR_SCOPE_GATE_FAILED' },
        futureBookings: { ok: false, skipped: 'AUTH_OR_SCOPE_GATE_FAILED' },
      },
    }
  }
  const roomCoverage = normalizeRoomRentCoverage(roomResult.body)
  roomResult.body = null

  const revenueResult = await callGateway(
    common,
    '/stat_hotel_daily_revenue',
    { query_date: input.queryDate },
  )
  const revenueCoverage = revenueResult.ok
    ? normalizeRevenueCoverage(revenueResult.body)
    : null
  revenueResult.body = null

  const futureResult = await callGateway(
    common,
    '/search_all_bookings',
    {
      start_date: input.queryDate,
      end_date: dateAfter(input.queryDate, 14),
    },
  )
  const futureCoverage = futureResult.ok
    ? normalizeBookingCoverage(futureResult.body)
    : null
  futureResult.body = null

  const endpoints = {
    roomRent: {
      ok: roomResult.ok,
      httpStatus: roomResult.httpStatus,
      coverage: roomCoverage,
    },
    revenue: {
      ok: revenueResult.ok,
      httpStatus: revenueResult.httpStatus,
      providerCode: revenueResult.providerCode ?? null,
      coverage: revenueCoverage,
    },
    futureBookings: {
      ok: futureResult.ok,
      httpStatus: futureResult.httpStatus,
      providerCode: futureResult.providerCode ?? null,
      coverage: futureCoverage,
    },
  }
  return {
    testedAt: new Date().toISOString(),
    gateway: 'LUOPAN_READ_ONLY_GATEWAY',
    credentialsPersisted: false,
    piiPersisted: false,
    productionChanged: false,
    complete:
      roomCoverage.contractSatisfied
      && revenueCoverage?.contractSatisfied === true
      && futureCoverage?.contractSatisfied === true,
    endpoints,
  }
}

const persistSanitizedResult = (result) => {
  mkdirSync(dirname(RESULT_PATH), { recursive: true })
  const temporaryPath = `${RESULT_PATH}.${process.pid}.tmp`
  writeFileSync(
    temporaryPath,
    `${JSON.stringify(result, null, 2)}\n`,
    { encoding: 'utf8', mode: 0o600 },
  )
  renameSync(temporaryPath, RESULT_PATH)
}

const readForm = async (request) => {
  const chunks = []
  let total = 0
  for await (const chunk of request) {
    total += chunk.length
    if (total > MAX_FORM_BYTES) throw new Error('FORM_TOO_LARGE')
    chunks.push(chunk)
  }
  return new URLSearchParams(Buffer.concat(chunks).toString('utf8'))
}

const html = (body) => `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>罗盘 Gateway 只读本地测试</title><style>
body{font-family:system-ui,-apple-system,"Segoe UI",sans-serif;background:#f3f5f2;color:#16251f;margin:0;padding:32px}main{max-width:760px;margin:auto;background:#fff;border:1px solid #d9e0db;border-radius:18px;padding:28px;box-shadow:0 12px 32px #173c2820}h1{margin-top:0}label{display:block;margin:16px 0 6px;font-weight:650}input,select,button{width:100%;box-sizing:border-box;padding:11px 12px;border:1px solid #b8c5bd;border-radius:9px;font-size:16px}button{margin-top:22px;background:#176f4c;color:white;border:0;font-weight:700;cursor:pointer}.note{background:#edf7f1;border-left:4px solid #26835c;padding:12px 14px;border-radius:8px}.warn{background:#fff5e8;border-left-color:#d67b14}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#10251d;color:#e9fff3;padding:16px;border-radius:10px}small{color:#52675e}
</style></head><body><main>${body}</main></body></html>`

const formPage = (csrfToken, message = '') => html(`
<h1>罗盘 Gateway 只读本地测试</h1>
<div class="note">仅访问厂家只读网关；不保存接口代码、密码或住客资料；不切换云端生产。</div>
${message ? `<p class="note warn">${escapeHtml(message)}</p>` : ''}
<form method="post" action="/test" autocomplete="off">
<input type="hidden" name="csrf" value="${escapeHtml(csrfToken)}">
<label>权限范围</label><select name="scopeMode"><option value="hotel">单店</option><option value="group">集团</option></select>
<label>厂家权限 ID</label><input name="scopeId" required maxlength="128" autocomplete="off">
<label>业务酒店 ID</label><input name="hotelId" required maxlength="128" autocomplete="off">
<label>接口代码 sob_code</label><input name="sobCode" required maxlength="128" autocomplete="off">
<label>接口密码</label><input name="password" type="password" required maxlength="256" autocomplete="new-password">
<label>测试营业日</label><input name="queryDate" type="date" required value="${new Date().toISOString().slice(0, 10)}">
<button type="submit">执行一次只读测试</button>
</form><p><small>首次鉴权失败后，其余接口会停止，避免重复尝试。成功响应只保留字段覆盖和脱敏统计。</small></p>`)

const resultPage = (result) => html(`
<h1>只读测试结果</h1>
<div class="note">凭据未保存：${result.credentialsPersisted ? '否' : '是'}；个人信息未保存：${result.piiPersisted ? '否' : '是'}；生产未切换：${result.productionChanged ? '否' : '是'}</div>
<pre>${escapeHtml(JSON.stringify(result, null, 2))}</pre>
${result.complete ? '<p>测试完成，可进入字段映射与影子采集。</p>' : '<p><a href="/">返回修改后重试</a></p>'}`)

export const startLocalGatewayTester = ({
  port = Number.parseInt(
    process.env.LUOPAN_GATEWAY_TEST_PORT ?? String(DEFAULT_PORT),
    10,
  ),
} = {}) => {
  if (!Number.isInteger(port) || port < 1024 || port > 65_535) {
    throw new Error('PORT_INVALID')
  }
  const csrfToken = randomBytes(24).toString('hex')
  let running = false
  const server = createServer(async (request, response) => {
    const host = request.headers.host ?? ''
    if (host !== `${HOST}:${port}`) {
      response.writeHead(400, { ...noStoreHeaders, 'Content-Type': 'text/plain; charset=utf-8' })
      response.end('INVALID_HOST')
      return
    }
    const url = new URL(request.url ?? '/', `http://${host}`)
    if (request.method === 'GET' && url.pathname === '/') {
      response.writeHead(200, { ...noStoreHeaders, 'Content-Type': 'text/html; charset=utf-8' })
      response.end(formPage(csrfToken))
      return
    }
    if (request.method === 'POST' && url.pathname === '/test') {
      const origin = request.headers.origin
      if (origin && origin !== `http://${HOST}:${port}`) {
        response.writeHead(403, { ...noStoreHeaders, 'Content-Type': 'text/plain; charset=utf-8' })
        response.end('ORIGIN_REJECTED')
        return
      }
      if (running) {
        response.writeHead(409, { ...noStoreHeaders, 'Content-Type': 'text/plain; charset=utf-8' })
        response.end('TEST_ALREADY_RUNNING')
        return
      }
      running = true
      let input = null
      try {
        const form = await readForm(request)
        if (form.get('csrf') !== csrfToken) throw new Error('CSRF_REJECTED')
        input = normalizedInput(form)
        const result = await runGatewayTest(input)
        persistSanitizedResult(result)
        response.writeHead(200, { ...noStoreHeaders, 'Content-Type': 'text/html; charset=utf-8' })
        response.end(resultPage(result))
        if (result.complete) {
          setTimeout(() => server.close(), 2_000).unref()
        }
      } catch (error) {
        const safeMessage = [
          'CSRF_REJECTED',
          'FORM_TOO_LARGE',
          'INPUT_INVALID',
        ].includes(error?.message)
          ? error.message
          : 'LOCAL_TEST_FAILED_CLOSED'
        response.writeHead(400, { ...noStoreHeaders, 'Content-Type': 'text/html; charset=utf-8' })
        response.end(formPage(csrfToken, safeMessage))
      } finally {
        if (input) {
          input.password = null
          input.sobCode = null
          input.scopeId = null
          input.hotelId = null
        }
        running = false
      }
      return
    }
    response.writeHead(404, { ...noStoreHeaders, 'Content-Type': 'text/plain; charset=utf-8' })
    response.end('NOT_FOUND')
  })
  server.listen(port, HOST, () => {
    process.stdout.write(`READY http://${HOST}:${port}/\n`)
  })
  return server
}

const isMain = process.argv[1]
  && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))
if (isMain) startLocalGatewayTester()
