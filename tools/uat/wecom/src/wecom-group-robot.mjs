import { createHash } from 'node:crypto'

const OFFICIAL_HOST = 'qyapi.weixin.qq.com'
const WEBHOOK_PATH = '/cgi-bin/webhook/send'
const MAX_REQUEST_TEXT_BYTES = 1900
const MAX_RESPONSE_BYTES = 4096

const isApprovedOperationalTemplate = (content) =>
  /^[^\n]{1,40}｜今日收益分析(?:｜[^\n]{1,16})?\n/u.test(content)
  || /^[^\n]{1,40}｜远期房态(?:｜[^\n]{1,12})?\n/u.test(content)
  || /^[^\n]{1,40}｜经营综合简报(?:｜[^\n]{1,12})?\n/u.test(content)
  || content.startsWith('【热销房型售罄预警】\n')

export class SafeWeComError extends Error {
  constructor(reasonCode) {
    super(reasonCode)
    this.name = 'SafeWeComError'
    this.reasonCode = reasonCode
  }
}

const fail = (reasonCode) => {
  throw new SafeWeComError(reasonCode)
}

export function sha256(value) {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}

const validateWeComWebhook = (rawWebhook) => {
  if (
    typeof rawWebhook !== 'string' ||
    rawWebhook.length < 40 ||
    rawWebhook.length > 500
  ) {
    fail('WECOM_WEBHOOK_INVALID')
  }

  let url
  try {
    url = new URL(rawWebhook)
  } catch {
    fail('WECOM_WEBHOOK_INVALID')
  }

  if (
    url.protocol !== 'https:' ||
    url.hostname !== OFFICIAL_HOST ||
    url.port !== '' ||
    url.username !== '' ||
    url.password !== '' ||
    url.pathname !== WEBHOOK_PATH ||
    url.hash !== ''
  ) {
    fail('WECOM_WEBHOOK_NOT_OFFICIAL')
  }

  const entries = [...url.searchParams.entries()]
  if (
    entries.length !== 1 ||
    entries[0][0] !== 'key' ||
    !/^[A-Za-z0-9-]{20,100}$/.test(entries[0][1])
  ) {
    fail('WECOM_WEBHOOK_QUERY_INVALID')
  }
  return url
}

export function fingerprintWeComWebhook(rawWebhook) {
  const url = validateWeComWebhook(rawWebhook)
  return sha256(url.toString())
}

const hasExactKeys = (value, expectedKeys) => {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false
  }
  const actualKeys = Object.keys(value).sort()
  return (
    actualKeys.length === expectedKeys.length &&
    expectedKeys.every((key, index) => key === actualKeys[index])
  )
}

const validatePayload = (payload) => {
  if (
    !hasExactKeys(payload, ['msgtype', 'text']) ||
    !hasExactKeys(payload?.text, ['content', 'mentioned_list']) ||
    payload?.msgtype !== 'text' ||
    typeof payload?.text?.content !== 'string' ||
    payload.text.content.length === 0 ||
    Buffer.byteLength(payload.text.content, 'utf8') >
      MAX_REQUEST_TEXT_BYTES ||
    !Array.isArray(payload.text.mentioned_list) ||
    payload.text.mentioned_list.length !== 0
  ) {
    fail('WECOM_PAYLOAD_INVALID')
  }
  if (
    [
      '【UAT测试｜非经营指令】',
      '隐私处理｜已过滤姓名、订单号、电话、备注、操作员及内部链接',
      '@所有人',
    ].some((removed) => payload.text.content.includes(removed))
  ) {
    fail('WECOM_REMOVED_DECORATION_PRESENT')
  }
  if (!isApprovedOperationalTemplate(payload.text.content)) {
    fail('WECOM_TEMPLATE_POLICY_REQUIRED')
  }
}

const readResponseBodyLimited = async (response) => {
  if (typeof response.body?.getReader === 'function') {
    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let byteCount = 0
    let text = ''
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      byteCount += value.byteLength
      if (byteCount > MAX_RESPONSE_BYTES) {
        await reader.cancel()
        throw new Error('response too large')
      }
      text += decoder.decode(value, { stream: true })
    }
    text += decoder.decode()
    return text
  }

  if (typeof response.text !== 'function') {
    throw new Error('response body unavailable')
  }
  const text = await response.text()
  if (Buffer.byteLength(text, 'utf8') > MAX_RESPONSE_BYTES) {
    throw new Error('response too large')
  }
  return text
}

export async function sendWeComGroupRobotMessage({
  rawWebhook,
  payload,
  expectedEndpointSha256,
  fetchImpl,
  networkAuthorized = false,
  timeoutMs = 10_000,
}) {
  const url = validateWeComWebhook(rawWebhook)
  validatePayload(payload)
  if (networkAuthorized !== true) fail('WECOM_NETWORK_NOT_AUTHORIZED')
  if (typeof fetchImpl !== 'function') fail('WECOM_FETCH_UNAVAILABLE')
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 30_000) {
    fail('WECOM_TIMEOUT_INVALID')
  }

  const endpointSha256 = sha256(url.toString())
  if (
    typeof expectedEndpointSha256 !== 'string' ||
    !/^[a-f0-9]{64}$/i.test(expectedEndpointSha256)
  ) {
    fail('WECOM_ENDPOINT_FINGERPRINT_REQUIRED')
  }
  if (endpointSha256 !== expectedEndpointSha256.toLowerCase()) {
    fail('WECOM_ENDPOINT_FINGERPRINT_MISMATCH')
  }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const response = await fetchImpl(url.toString(), {
      method: 'POST',
      headers: {
        'content-type': 'application/json; charset=utf-8',
      },
      body: JSON.stringify(payload),
      redirect: 'error',
      signal: controller.signal,
    })

    if (!response || typeof response.status !== 'number') {
      return Object.freeze({
        deliveryStatus: 'AMBIGUOUS',
        reasonCode: 'WECOM_RESPONSE_UNREADABLE',
        endpointSha256,
        httpStatus: null,
        weComCode: null,
      })
    }

    const httpStatus = response.status
    if (!response.ok) {
      const resultUnknown =
        httpStatus === 408 || httpStatus === 429 || httpStatus >= 500
      return Object.freeze({
        deliveryStatus: resultUnknown ? 'AMBIGUOUS' : 'REJECTED',
        reasonCode: resultUnknown
          ? 'WECOM_HTTP_RESULT_UNKNOWN'
          : 'WECOM_HTTP_REJECTED',
        endpointSha256,
        httpStatus,
        weComCode: null,
      })
    }

    let responseBody
    try {
      const rawBody = await readResponseBodyLimited(response)
      responseBody = JSON.parse(rawBody)
    } catch {
      return Object.freeze({
        deliveryStatus: 'AMBIGUOUS',
        reasonCode: 'WECOM_RESPONSE_UNREADABLE',
        endpointSha256,
        httpStatus,
        weComCode: null,
      })
    }

    if (!Number.isInteger(responseBody?.errcode)) {
      return Object.freeze({
        deliveryStatus: 'AMBIGUOUS',
        reasonCode: 'WECOM_RESPONSE_SCHEMA_INVALID',
        endpointSha256,
        httpStatus,
        weComCode: null,
      })
    }

    if (responseBody.errcode !== 0) {
      return Object.freeze({
        deliveryStatus: 'REJECTED',
        reasonCode: 'WECOM_BUSINESS_REJECTED',
        endpointSha256,
        httpStatus,
        weComCode: responseBody.errcode,
      })
    }

    return Object.freeze({
      deliveryStatus: 'DELIVERED',
      reasonCode: 'WECOM_DELIVERED',
      endpointSha256,
      httpStatus,
      weComCode: 0,
    })
  } catch {
    return Object.freeze({
      deliveryStatus: 'AMBIGUOUS',
      reasonCode: 'WECOM_NETWORK_RESULT_UNKNOWN',
      endpointSha256,
      httpStatus: null,
      weComCode: null,
    })
  } finally {
    clearTimeout(timer)
  }
}
