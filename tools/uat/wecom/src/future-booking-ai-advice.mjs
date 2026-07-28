import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'

const DEFAULT_TIMEOUT_MS = 8_000
const MAX_TIMEOUT_MS = 15_000
const MAX_RESPONSE_BYTES = 32 * 1024
const MAX_LINE_CHARACTERS = 72
const MAX_TOTAL_CHARACTERS = 216
const ACTION_PREFIXES = Object.freeze([
  '先做｜',
  '策略｜',
  '复盘｜',
])

export class SafeFutureBookingAiError extends Error {
  constructor(reasonCode) {
    super(reasonCode)
    this.name = 'SafeFutureBookingAiError'
    this.reasonCode = reasonCode
  }
}

const fail = (reasonCode) => {
  throw new SafeFutureBookingAiError(reasonCode)
}

const baseUrlFrom = (rawUrl) => {
  let base
  try {
    base = new URL(rawUrl)
  } catch {
    fail('AI_BASE_URL_INVALID')
  }
  if (
    base.protocol !== 'https:'
    || base.username
    || base.password
    || base.hash
    || base.search
    || (base.port && base.port !== '443')
    || [
      'localhost',
      'localhost.localdomain',
      'metadata.google.internal',
    ].includes(base.hostname.toLowerCase())
    || base.hostname.toLowerCase().endsWith('.local')
    || base.hostname.toLowerCase().endsWith('.internal')
  ) {
    fail('AI_BASE_URL_UNSAFE')
  }
  return base
}

const decodeApiKey = (encoded) => {
  if (
    typeof encoded !== 'string'
    || encoded.length < 8
    || encoded.length > 2_048
    || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)
  ) {
    fail('AI_API_KEY_ENCODING_INVALID')
  }
  let value
  try {
    value = Buffer.from(encoded, 'base64').toString('utf8')
  } catch {
    fail('AI_API_KEY_ENCODING_INVALID')
  }
  if (
    !value
    || value.length < 8
    || value.length > 1_024
    || /[\u0000-\u001f\u007f]/.test(value)
  ) {
    fail('AI_API_KEY_INVALID')
  }
  return value
}

const timeoutFrom = (value) => {
  if (value === undefined || value === null || value === '') {
    return DEFAULT_TIMEOUT_MS
  }
  const timeoutMs = Number.parseInt(value, 10)
  if (
    !Number.isInteger(timeoutMs)
    || timeoutMs < 1_000
    || timeoutMs > MAX_TIMEOUT_MS
  ) {
    fail('AI_TIMEOUT_INVALID')
  }
  return timeoutMs
}

export const futureBookingAiConfigFromEnv = (env = process.env) => {
  const enabled = env.OTA_REVIEW_AI_ENABLED === 'true'
  if (!enabled) {
    return Object.freeze({
      enabled: false,
      ready: false,
      reasonCode: 'AI_ADVICE_DISABLED',
      baseUrl: null,
      model: null,
      apiKey: null,
      timeoutMs: DEFAULT_TIMEOUT_MS,
    })
  }
  const baseUrl = String(env.OTA_REVIEW_AI_BASE_URL ?? '').trim()
  const model = String(env.OTA_REVIEW_AI_MODEL ?? '').trim()
  let timeoutMs
  let apiKey
  try {
    timeoutMs = timeoutFrom(env.OTA_REVIEW_AI_TIMEOUT_MS)
    apiKey = decodeApiKey(env.OTA_REVIEW_AI_API_KEY_B64)
  } catch (error) {
    return Object.freeze({
      enabled: true,
      ready: false,
      reasonCode:
        error?.reasonCode ?? 'AI_CONFIGURATION_INVALID',
      baseUrl: baseUrl || null,
      model: model || null,
      apiKey: null,
      timeoutMs: DEFAULT_TIMEOUT_MS,
    })
  }
  if (!baseUrl) {
    return Object.freeze({
      enabled: true,
      ready: false,
      reasonCode: 'AI_BASE_URL_REQUIRED',
      baseUrl: null,
      model: model || null,
      apiKey: null,
      timeoutMs,
    })
  }
  try {
    baseUrlFrom(baseUrl)
  } catch (error) {
    return Object.freeze({
      enabled: true,
      ready: false,
      reasonCode:
        error?.reasonCode ?? 'AI_BASE_URL_INVALID',
      baseUrl: null,
      model: model || null,
      apiKey: null,
      timeoutMs,
    })
  }
  if (!/^[A-Za-z0-9._:/-]{1,120}$/.test(model)) {
    return Object.freeze({
      enabled: true,
      ready: false,
      reasonCode: 'AI_MODEL_INVALID',
      baseUrl,
      model: null,
      apiKey: null,
      timeoutMs,
    })
  }
  return Object.freeze({
    enabled: true,
    ready: true,
    reasonCode: 'AI_ADVICE_READY',
    baseUrl,
    model,
    apiKey,
    timeoutMs,
  })
}

export const futureBookingAiPublicStatus = (config) => Object.freeze({
  enabled: config?.enabled === true,
  ready: config?.ready === true,
  reasonCode:
    typeof config?.reasonCode === 'string'
      ? config.reasonCode
      : 'AI_CONFIGURATION_UNAVAILABLE',
  modelConfigured:
    typeof config?.model === 'string' && config.model.length > 0,
})

const privateIpv4 = (address) => {
  const octets = String(address).split('.').map(Number)
  if (
    octets.length !== 4
    || octets.some((part) => !Number.isInteger(part))
  ) {
    return true
  }
  return (
    octets[0] === 0
    || octets[0] === 10
    || octets[0] === 127
    || (octets[0] === 169 && octets[1] === 254)
    || (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31)
    || (octets[0] === 192 && octets[1] === 168)
    || octets[0] >= 224
  )
}

const privateIpv6 = (address) => {
  const normalized = String(address).toLowerCase()
  return (
    normalized === '::'
    || normalized === '::1'
    || normalized.startsWith('fc')
    || normalized.startsWith('fd')
    || normalized.startsWith('fe8')
    || normalized.startsWith('fe9')
    || normalized.startsWith('fea')
    || normalized.startsWith('feb')
  )
}

const privateAddress = (address) => {
  const family = isIP(address)
  return family === 4
    ? privateIpv4(address)
    : family === 6
      ? privateIpv6(address)
      : true
}

const endpointFor = async (baseUrl, lookupImpl) => {
  const base = baseUrlFrom(baseUrl)
  let addresses
  try {
    addresses = await lookupImpl(base.hostname, {
      all: true,
      verbatim: true,
    })
  } catch {
    fail('AI_ENDPOINT_DNS_FAILED')
  }
  if (
    !Array.isArray(addresses)
    || addresses.length < 1
    || addresses.some((item) => privateAddress(item?.address))
  ) {
    fail('AI_PRIVATE_NETWORK_BLOCKED')
  }
  const normalizedBase = base.toString().endsWith('/')
    ? base
    : new URL(`${base.toString()}/`)
  return new URL('chat/completions', normalizedBase)
}

const finiteOrNull = (value, digits = 1) => {
  const number = Number(value)
  if (!Number.isFinite(number)) return null
  return Number(number.toFixed(digits))
}

const remainingRooms = (row) => {
  const available = finiteOrNull(row?.availableRooms, 1)
  if (available !== null) return Math.max(0, available)
  const booked = finiteOrNull(row?.bookedRoomNights, 1)
  const roomCount = finiteOrNull(row?.roomCount, 1)
  if (booked === null || roomCount === null) return null
  return Math.max(0, Number((roomCount - booked).toFixed(1)))
}

const safeRows = (rows) => {
  if (!Array.isArray(rows) || rows.length < 1) {
    fail('AI_ADVICE_INPUT_INVALID')
  }
  return rows.slice(0, 14).map((row) => {
    const stayDate = String(row?.stayDate ?? '')
    if (!/^\d{4}-\d{2}-\d{2}$/.test(stayDate)) {
      fail('AI_ADVICE_INPUT_INVALID')
    }
    return {
      stayDate,
      occupancyPercent: finiteOrNull(row.occupancyPercent),
      remainingRooms: remainingRooms(row),
      adr: finiteOrNull(row.adr),
      hourlyNetRoomNights: finiteOrNull(row.hourlyNetRoomNights),
      previousDayNetRoomNights:
        finiteOrNull(row.previousDayNetRoomNights),
    }
  })
}

const readLimitedText = async (response) => {
  const declaredLength = Number(response.headers?.get?.('content-length'))
  if (
    Number.isFinite(declaredLength)
    && declaredLength > MAX_RESPONSE_BYTES
  ) {
    fail('AI_RESPONSE_TOO_LARGE')
  }
  if (!response.body?.getReader) {
    const text = await response.text()
    if (Buffer.byteLength(text, 'utf8') > MAX_RESPONSE_BYTES) {
      fail('AI_RESPONSE_TOO_LARGE')
    }
    return text
  }
  const reader = response.body.getReader()
  const chunks = []
  let totalBytes = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      totalBytes += value.byteLength
      if (totalBytes > MAX_RESPONSE_BYTES) {
        fail('AI_RESPONSE_TOO_LARGE')
      }
      chunks.push(Buffer.from(value))
    }
  } finally {
    reader.releaseLock()
  }
  return Buffer.concat(chunks).toString('utf8')
}

const contentFrom = (root) => {
  const content = root?.choices?.[0]?.message?.content
  if (typeof content !== 'string' || !content.trim()) {
    fail('AI_RESPONSE_SCHEMA_INVALID')
  }
  return content.trim()
}

const jsonFrom = (content) => {
  const normalized = content
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
  try {
    return JSON.parse(normalized)
  } catch {
    fail('AI_RESPONSE_NOT_JSON')
  }
}

const validateActionLines = (value) => {
  if (
    value === null
    || typeof value !== 'object'
    || Array.isArray(value)
    || Object.keys(value).length !== 1
    || !Array.isArray(value.lines)
    || value.lines.length !== ACTION_PREFIXES.length
  ) {
    fail('AI_ADVICE_SCHEMA_INVALID')
  }
  let totalCharacters = 0
  const lines = value.lines.map((rawLine, index) => {
    if (
      typeof rawLine !== 'string'
      || /[\r\n\u0000-\u001f\u007f]/.test(rawLine)
    ) {
      fail('AI_ADVICE_SCHEMA_INVALID')
    }
    const line = rawLine.trim()
    const characters = [...line].length
    if (
      !line.startsWith(ACTION_PREFIXES[index])
      || characters > MAX_LINE_CHARACTERS
      || /https?:\/\/|www\.|@all/i.test(line)
    ) {
      fail('AI_ADVICE_POLICY_REJECTED')
    }
    totalCharacters += characters
    return line
  })
  if (
    totalCharacters > MAX_TOTAL_CHARACTERS
    || !/(分钟|小时|今日|本轮|立即核对)/.test(lines[0])
    || !/(若|如|当|仅在)/.test(lines[1])
    || !/(间夜|ADR|售卖率|余房|取消|转化)/.test(lines[2])
    || lines.some((line) =>
      /自动(?:调价|改价|关房|开房|调整库存)/.test(line))
  ) {
    fail('AI_ADVICE_POLICY_REJECTED')
  }
  return Object.freeze(lines)
}

const promptFor = ({ businessDate, rows, ruleAdviceLines }) => ({
  role: 'user',
  content: JSON.stringify({
    task: '根据汇总经营指标改进酒店远期房态运营建议',
    businessDate,
    facts: safeRows(rows),
    deterministicBaseline: ruleAdviceLines,
    requiredOutput: {
      format: 'JSON object only',
      schema: {
        lines: [
          '先做｜责任人、检查项和完成时限',
          '策略｜带若/当条件的单变量人工评估动作',
          '复盘｜复盘时点、指标和撤回条件',
        ],
      },
    },
  }),
})

const systemPrompt = [
  '你是酒店收益运营分析助手。',
  '确定性结论已由规则引擎生成，你只补充行动建议，不能改写经营事实。',
  '只能使用输入中的14天汇总指标，不得声称知道竞对真实价格、活动、天气、事件或客人信息。',
  '建议必须由人员核对和评估，不得要求系统自动调价、关房、开房或调整库存。',
  '每次只建议一个主要变量，给出责任人、时限、条件和可量化复盘标准。',
  '输出严格为JSON对象，只有lines字段和3个字符串；每行不超过72个字符，不输出Markdown。',
].join('')

export const generateFutureBookingAiActionLines = async ({
  config,
  businessDate,
  rows,
  ruleAdviceLines,
  fetchImpl = globalThis.fetch,
  lookupImpl = lookup,
}) => {
  if (config?.enabled !== true) fail('AI_ADVICE_DISABLED')
  if (config?.ready !== true) {
    fail(config?.reasonCode ?? 'AI_CONFIGURATION_NOT_READY')
  }
  if (
    typeof fetchImpl !== 'function'
    || typeof lookupImpl !== 'function'
    || !/^\d{4}-\d{2}-\d{2}$/.test(String(businessDate ?? ''))
    || !Array.isArray(ruleAdviceLines)
    || ruleAdviceLines.length !== 4
    || ruleAdviceLines.some((line) => typeof line !== 'string')
  ) {
    fail('AI_ADVICE_INPUT_INVALID')
  }
  const endpoint = await endpointFor(config.baseUrl, lookupImpl)
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), config.timeoutMs)
  let response
  try {
    response = await fetchImpl(endpoint, {
      method: 'POST',
      redirect: 'error',
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${config.apiKey}`,
        'Content-Type': 'application/json; charset=utf-8',
      },
      body: JSON.stringify({
        model: config.model,
        messages: [
          {
            role: 'system',
            content: systemPrompt,
          },
          promptFor({
            businessDate,
            rows,
            ruleAdviceLines,
          }),
        ],
        temperature: 0.2,
        max_tokens: 420,
      }),
    })
  } catch (error) {
    if (error?.name === 'AbortError') fail('AI_REQUEST_TIMEOUT')
    fail('AI_NETWORK_FAILED')
  } finally {
    clearTimeout(timer)
  }
  if (!response?.ok) {
    const reason =
      response?.status === 401 || response?.status === 403
        ? 'AI_AUTH_REJECTED'
        : response?.status === 429
          ? 'AI_RATE_LIMITED'
          : 'AI_HTTP_REJECTED'
    fail(reason)
  }
  const text = await readLimitedText(response)
  let root
  try {
    root = JSON.parse(text)
  } catch {
    fail('AI_RESPONSE_NOT_JSON')
  }
  return validateActionLines(jsonFrom(contentFrom(root)))
}

export const futureBookingAiLimits = Object.freeze({
  timeoutMs: DEFAULT_TIMEOUT_MS,
  maxTimeoutMs: MAX_TIMEOUT_MS,
  maxResponseBytes: MAX_RESPONSE_BYTES,
  maxLineCharacters: MAX_LINE_CHARACTERS,
  maxTotalCharacters: MAX_TOTAL_CHARACTERS,
})
