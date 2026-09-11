import { createHash } from 'node:crypto'

const OFFICIAL_HOST = 'qyapi.weixin.qq.com'
const WEBHOOK_PATH = '/cgi-bin/webhook/send'
const MAX_REQUEST_TEXT_BYTES = 1900
const MAX_RESPONSE_BYTES = 4096

const isApprovedOperationalTemplate = (content) =>
  /^[^\n]{1,40}｜今日收益分析(?:｜[^\n]{1,16})?\n/u.test(content)
  || /^[^\n]{1,40}｜远期房态(?:｜[^\n]{1,12})?\n/u.test(content)
  || /^[^\n]{1,40}｜经营综合简报(?:｜[^\n]{1,12})?\n/u.test(content)
  || content.startsWith('🚨P1远期需求异动\n')
  || content.startsWith('🧪测试消息｜P1远期需求异动\n')
  || content.startsWith('【热销房型售罄预警】\n')
  || [
    '【PMS需要修复处理】\n',
    '【门店晨间修复完成】\n',
    '【门店晨间修复未完成】\n',
    '【罗盘简报自动修复完成】\n',
    '【罗盘简报自动修复未完成】\n',
    '【罗盘简报需要人工验证】\n',
  ].some((prefix) => content.startsWith(prefix))

const COMPACT_VALUE_PATTERN = String.raw`(?:\?|-?\d+(?:\.\d+)?)`
const SIGNED_VALUE_PATTERN = String.raw`(?:\?|[+-]?\d+(?:\.\d+)?)`
const MONEY_VALUE_PATTERN = String.raw`(?:\?|¥-?\d+)`
const SHORT_DATE_PATTERN = String.raw`(?:\d{2}-\d{2}|--)`
const LOCAL_HOUR_PATTERN = String.raw`(?:\d{2}-\d{2} \d{2}:00|时间未知)`

const combinedTodayLine = new RegExp(
  `^📌今日｜售/余 ${COMPACT_VALUE_PATTERN}/${COMPACT_VALUE_PATTERN}`
    + `｜率${COMPACT_VALUE_PATTERN}%｜ADR${MONEY_VALUE_PATTERN}$`,
  'u',
)
const combinedRevenueLine = new RegExp(
  `^房费${MONEY_VALUE_PATTERN}｜RevPAR${MONEY_VALUE_PATTERN}$`,
  'u',
)
const combinedHourlyDetailLine = new RegExp(
  `^新增${COMPACT_VALUE_PATTERN}｜取消${COMPACT_VALUE_PATTERN}`
    + `｜净增${SIGNED_VALUE_PATTERN}｜当日入住${COMPACT_VALUE_PATTERN}$`,
  'u',
)
const combinedFutureSummaryLine = new RegExp(
  `^📊当日\\+未来14天｜时净${SIGNED_VALUE_PATTERN}`
    + `｜累净${SIGNED_VALUE_PATTERN}$`,
  'u',
)
const combinedFutureRowLine = new RegExp(
  `^${SHORT_DATE_PATTERN}｜${COMPACT_VALUE_PATTERN}/${COMPACT_VALUE_PATTERN}`
    + `｜${COMPACT_VALUE_PATTERN}%｜${MONEY_VALUE_PATTERN}`
    + `｜${SIGNED_VALUE_PATTERN}/${SIGNED_VALUE_PATTERN}`
    + `/${SIGNED_VALUE_PATTERN}$`,
  'u',
)
const combinedFutureAdviceLine = new RegExp(
  `^远期｜(?:${SHORT_DATE_PATTERN}达${COMPACT_VALUE_PATTERN}%` +
    '，复核价格和余房释放。'
    + `|${SHORT_DATE_PATTERN}小时净增${SIGNED_VALUE_PATTERN}`
    + '，2小时后复盘。'
    + `|${SHORT_DATE_PATTERN}仅${COMPACT_VALUE_PATTERN}%` +
    '，先检查曝光并做单变量测试。)$',
  'u',
)

const isApprovedHotSellingAtAllTemplate = (content) => {
  const lines = content.split('\n')
  const hasChannelMapping = lines.length === 9
  if (!hasChannelMapping && lines.length !== 8) return false
  if (
    lines[0] !== '【热销房型售罄预警】'
    || !/^[^｜\r\n]{1,40}｜独立库存预警(?:｜[^｜\r\n]{1,16})?$/u.test(
      lines[1],
    )
    || !/^⏰截止 (?:\d{2}-\d{2} \d{2}:00|时间未知)｜营业日 \d{2}-\d{2}$/u.test(
      lines[2],
    )
    || lines[3] !== ''
    || !/^售罄房型｜[^\r\n]{1,1000}$/u.test(lines[4])
  ) return false

  let tailIndex = 5
  if (hasChannelMapping) {
    if (!/^渠道对应｜[^\r\n]{1,480}$/u.test(lines[tailIndex])) return false
    tailIndex += 1
  }
  return (
    lines[tailIndex] === '建议处理｜立即复核渠道价格、房态和后续库存释放策略。'
    && lines[tailIndex + 1]
      === '发送规则｜今日经营、远期房态两类简报送达后1分钟独立发送。'
    && lines[tailIndex + 2]
      === '判定规则｜仅可靠可售量为0或以下时触发；数据缺失不误报。'
  )
}

const isApprovedCombinedOperationsAtAllTemplate = (content) => {
  const lines = content.split('\n')
  if (
    !/^[^｜\r\n]{1,40}｜经营综合简报(?:｜[^｜\r\n]{1,12})?$/u.test(
      lines[0] ?? '',
    )
    || !new RegExp(
      `^⏰截止 ${LOCAL_HOUR_PATTERN}｜营业日 ${SHORT_DATE_PATTERN}`
        + '｜(?:数据状态未知|\\d+/\\d+(?:完整|部分))$',
      'u',
    ).test(lines[1] ?? '')
    || !combinedTodayLine.test(lines[2] ?? '')
    || !combinedRevenueLine.test(lines[3] ?? '')
  ) return false

  let cursor = 4
  if (lines[cursor] === '✅小时进单｜同PMS一小时前基线待建立') {
    cursor += 1
  } else {
    if (
      !/^✅小时进单｜(?:\d{2}:\d{2}|时间未知)→(?:\d{2}:\d{2}|时间未知)$/u.test(
        lines[cursor] ?? '',
      )
      || !combinedHourlyDetailLine.test(lines[cursor + 1] ?? '')
    ) return false
    cursor += 2
  }

  if (
    !(
      lines[cursor] === '当日订单｜PMS未提供订单明细'
      || new RegExp(
        `^当日订单｜有效${COMPACT_VALUE_PATTERN}`
          + `｜取消${COMPACT_VALUE_PATTERN}$`,
        'u',
      ).test(lines[cursor] ?? '')
    )
    || !combinedFutureSummaryLine.test(lines[cursor + 1] ?? '')
    || lines[cursor + 2] !== '日期｜售/余｜率｜ADR｜时/累/昨'
  ) return false
  cursor += 3

  const futureRows = lines.slice(cursor, cursor + 15)
  if (
    futureRows.length !== 15
    || futureRows.some((line) => !combinedFutureRowLine.test(line))
  ) return false
  cursor += 15

  const approvedTodayAdvice = new Set([
    '今日｜已满房，停止低价放量并复核超售与保留房。',
    '今日｜销售高位，核对热销房型余量后再决定放量。',
    '今日｜销售偏低，先检查渠道曝光和同房型价格。',
    '今日｜按小时净增、ADR和余房变化继续复盘。',
  ])
  return (
    lines[cursor] === '🤖运营建议'
    && approvedTodayAdvice.has(lines[cursor + 1])
    && (
      lines[cursor + 2] === '远期｜可用房态不足，暂不生成经营动作。'
      || combinedFutureAdviceLine.test(lines[cursor + 2] ?? '')
    )
    && cursor + 3 === lines.length
  )
}

const isApprovedAtAllTemplate = (content, deliveryType) =>
  (
    deliveryType === 'HOT_SELLING_SOLD_OUT'
    && isApprovedHotSellingAtAllTemplate(content)
  )
  || (
    deliveryType === 'COMBINED_OPERATIONS'
    && isApprovedCombinedOperationsAtAllTemplate(content)
  )

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

const validatePayload = (payload, deliveryType) => {
  const mentionedList = payload?.text?.mentioned_list
  const hasNoMention =
    Array.isArray(mentionedList) && mentionedList.length === 0
  const hasApprovedAtAllMention =
    Array.isArray(mentionedList)
    && mentionedList.length === 1
    && mentionedList[0] === '@all'
    && typeof payload?.text?.content === 'string'
    && isApprovedAtAllTemplate(payload.text.content, deliveryType)
  if (
    !hasExactKeys(payload, ['msgtype', 'text']) ||
    !hasExactKeys(payload?.text, ['content', 'mentioned_list']) ||
    payload?.msgtype !== 'text' ||
    typeof payload?.text?.content !== 'string' ||
    payload.text.content.length === 0 ||
    Buffer.byteLength(payload.text.content, 'utf8') >
      MAX_REQUEST_TEXT_BYTES ||
    (!hasNoMention && !hasApprovedAtAllMention)
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
  deliveryType = null,
  expectedEndpointSha256,
  fetchImpl,
  networkAuthorized = false,
  timeoutMs = 10_000,
}) {
  const url = validateWeComWebhook(rawWebhook)
  validatePayload(payload, deliveryType)
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
        networkAttempted: true,
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
        networkAttempted: true,
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
        networkAttempted: true,
      })
    }

    if (!Number.isInteger(responseBody?.errcode)) {
      return Object.freeze({
        deliveryStatus: 'AMBIGUOUS',
        reasonCode: 'WECOM_RESPONSE_SCHEMA_INVALID',
        endpointSha256,
        httpStatus,
        weComCode: null,
        networkAttempted: true,
      })
    }

    if (responseBody.errcode !== 0) {
      return Object.freeze({
        deliveryStatus: 'REJECTED',
        reasonCode: 'WECOM_BUSINESS_REJECTED',
        endpointSha256,
        httpStatus,
        weComCode: responseBody.errcode,
        networkAttempted: true,
      })
    }

    return Object.freeze({
      deliveryStatus: 'DELIVERED',
      reasonCode: 'WECOM_DELIVERED',
      endpointSha256,
      httpStatus,
      weComCode: 0,
      networkAttempted: true,
    })
  } catch {
    return Object.freeze({
      deliveryStatus: 'AMBIGUOUS',
      reasonCode: 'WECOM_NETWORK_RESULT_UNKNOWN',
      endpointSha256,
      httpStatus: null,
      weComCode: null,
      networkAttempted: true,
    })
  } finally {
    clearTimeout(timer)
  }
}
