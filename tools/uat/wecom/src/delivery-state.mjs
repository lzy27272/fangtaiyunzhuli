import { createHash } from 'node:crypto'

export const LEGACY_HOT_SELLING_NETWORK_INFERENCE =
  'LEGACY_PRE_FETCH_PAYLOAD_INVALID'
export const LEGACY_HOT_SELLING_NETWORK_INFERENCE_VERSION = 1

const sha256 = (value) =>
  createHash('sha256').update(value, 'utf8').digest('hex')

const legacyHotSellingBodyMatches = (delivery) => {
  const body = delivery?.bodyPreview
  if (
    typeof body !== 'string'
    || body.length === 0
    || Buffer.byteLength(body, 'utf8') > 1900
  ) return false

  const lines = body.split('\n')
  const hasChannelMapping = lines.length === 9
  if (!hasChannelMapping && lines.length !== 8) return false
  const cutoff = new Date(delivery?.cutoffAt ?? '')
  const businessDate = String(delivery?.businessDate ?? '').match(
    /^(\d{4})-(\d{2})-(\d{2})$/u,
  )
  if (!Number.isFinite(cutoff.getTime()) || !businessDate) return false
  const cutoffParts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Shanghai',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(cutoff)
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, part.value]),
  )
  if (
    lines[0] !== '【热销房型售罄预警】'
    || !/^[^｜\r\n]{1,40}｜独立库存预警$/u.test(
      lines[1] ?? '',
    )
    || lines[2] !== (
      `⏰截止 ${cutoffParts.month}-${cutoffParts.day}`
      + ` ${cutoffParts.hour}:00｜营业日`
      + ` ${businessDate[2]}-${businessDate[3]}`
    )
    || lines[3] !== ''
    || !/^售罄房型｜[^\r\n]{1,1000}$/u.test(lines[4] ?? '')
  ) return false

  let tailIndex = 5
  if (hasChannelMapping) {
    if (!/^渠道对应｜[^\r\n]{1,480}$/u.test(lines[tailIndex] ?? '')) {
      return false
    }
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

const hasRetryLineage = (delivery) =>
  delivery?.automaticRetryAttempted !== false
  || delivery?.retrySourceDeliveryId != null
  || delivery?.retryOperationKey != null
  || delivery?.hotSellingRetryResolution != null
  || delivery?.automaticRetryAttemptedAt != null
  || delivery?.automaticRetryReasonCode != null

export const migrateLegacyHotSellingNetworkEvidence = ({
  delivery,
  canonicalMessageKey,
  retryChildExists = false,
  now = new Date(),
}) => {
  const part = Array.isArray(delivery?.parts) && delivery.parts.length === 1
    ? delivery.parts[0]
    : null
  const migratedAt = now instanceof Date ? now : new Date(now)
  const attemptedAt = new Date(delivery?.attemptedAt ?? '').getTime()
  const completedAt = new Date(delivery?.completedAt ?? '').getTime()
  const cutoffAt = new Date(delivery?.cutoffAt ?? '').getTime()
  const bodyHash = typeof delivery?.bodyPreview === 'string'
    ? sha256(delivery.bodyPreview)
    : null
  const exactLegacyFingerprint = (
    delivery
    && typeof delivery === 'object'
    && !Array.isArray(delivery)
    && delivery.deliveryType === 'HOT_SELLING_SOLD_OUT'
    && delivery.deliveryStatus === 'REJECTED'
    && delivery.reasonCode === 'WECOM_BUNDLE_REJECTED'
    && /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/iu.test(
      delivery.deliveryId ?? '',
    )
    && delivery.messageKey === canonicalMessageKey
    && typeof canonicalMessageKey === 'string'
    && canonicalMessageKey.length > 0
    && typeof delivery.hotelId === 'string'
    && delivery.hotelId.length > 0
    && /^\d{4}-\d{2}-\d{2}$/u.test(delivery.businessDate ?? '')
    && Number.isFinite(cutoffAt)
    && Number.isFinite(attemptedAt)
    && Number.isFinite(completedAt)
    && attemptedAt >= cutoffAt
    && completedAt >= attemptedAt
    && delivery.partCount === 1
    && delivery.deliveredPartCount === 0
    && part?.partNo === 1
    && part?.deliveryStatus === 'REJECTED'
    && part?.reasonCode === 'WECOM_PAYLOAD_INVALID'
    && delivery.httpStatus === null
    && delivery.weComCode === null
    && part.httpStatus === null
    && part.weComCode === null
    && !Object.hasOwn(delivery, 'networkAttempted')
    && !Object.hasOwn(part, 'networkAttempted')
    && !Object.hasOwn(delivery, 'networkAttemptedInference')
    && !Object.hasOwn(part, 'networkAttemptedInference')
    && retryChildExists === false
    && !hasRetryLineage(delivery)
    && /^[a-f0-9]{64}$/u.test(delivery.endpointSha256 ?? '')
    && delivery.messageSha256 === bodyHash
    && part.messageSha256 === bodyHash
    && legacyHotSellingBodyMatches(delivery)
    && Number.isFinite(migratedAt.getTime())
  )
  if (!exactLegacyFingerprint) return null

  return {
    ...delivery,
    networkAttempted: false,
    networkAttemptedInference: {
      inference: LEGACY_HOT_SELLING_NETWORK_INFERENCE,
      version: LEGACY_HOT_SELLING_NETWORK_INFERENCE_VERSION,
      migratedAt: migratedAt.toISOString(),
    },
    parts: [{
      ...part,
      networkAttempted: false,
    }],
  }
}

const firstNonDeliveredPart = (delivery) =>
  Array.isArray(delivery?.parts)
    ? delivery.parts.find((part) => part?.deliveryStatus !== 'DELIVERED') ?? null
    : null

export const preciseWeComDeliveryFailure = (delivery) => {
  const failedPart = firstNonDeliveredPart(delivery)
  return {
    reasonCode:
      typeof failedPart?.reasonCode === 'string' && failedPart.reasonCode
        ? failedPart.reasonCode
        : typeof delivery?.reasonCode === 'string' && delivery.reasonCode
          ? delivery.reasonCode
          : 'WECOM_DELIVERY_FAILED_CLOSED',
    httpStatus: Number.isInteger(failedPart?.httpStatus)
      ? failedPart.httpStatus
      : Number.isInteger(delivery?.httpStatus)
        ? delivery.httpStatus
        : null,
    weComCode: Number.isInteger(failedPart?.weComCode)
      ? failedPart.weComCode
      : Number.isInteger(delivery?.weComCode)
        ? delivery.weComCode
        : null,
    networkAttempted:
      typeof failedPart?.networkAttempted === 'boolean'
        ? failedPart.networkAttempted
        : typeof delivery?.networkAttempted === 'boolean'
          ? delivery.networkAttempted
          : null,
  }
}

export const summarizeWeComBundleDelivery = ({ parts, expectedPartCount }) => {
  const safeParts = Array.isArray(parts) ? parts : []
  const allDelivered =
    Number.isInteger(expectedPartCount)
    && expectedPartCount > 0
    && safeParts.length === expectedPartCount
    && safeParts.every((part) => part?.deliveryStatus === 'DELIVERED')
  if (allDelivered) {
    return {
      deliveryStatus: 'DELIVERED',
      reasonCode: 'WECOM_BUNDLE_DELIVERED',
    }
  }

  const failedPart = safeParts.find(
    (part) => part?.deliveryStatus !== 'DELIVERED',
  )
  const hasAmbiguous = safeParts.some(
    (part) => part?.deliveryStatus === 'AMBIGUOUS',
  )
  return {
    deliveryStatus: hasAmbiguous ? 'AMBIGUOUS' : 'REJECTED',
    reasonCode:
      typeof failedPart?.reasonCode === 'string' && failedPart.reasonCode
        ? failedPart.reasonCode
        : hasAmbiguous
          ? 'WECOM_BUNDLE_RESULT_UNKNOWN'
          : 'WECOM_BUNDLE_REJECTED',
  }
}

export const hotSellingRetryDecision = (delivery) => {
  if (!delivery) return 'DELIVERY_NOT_FOUND'
  if (delivery.deliveryType !== 'HOT_SELLING_SOLD_OUT') {
    return 'DELIVERY_TYPE_NOT_SUPPORTED'
  }
  if (
    typeof delivery.retrySourceDeliveryId === 'string'
    && delivery.retrySourceDeliveryId
  ) return 'RETRY_ALREADY_ATTEMPTED'
  if (
    delivery.hotSellingRetryResolution
    && typeof delivery.hotSellingRetryResolution === 'object'
  ) return 'RETRY_ALREADY_ATTEMPTED'
  if (delivery.deliveryStatus === 'DELIVERED') return 'ALREADY_DELIVERED'
  if (
    delivery.deliveryStatus === 'SENDING'
    || delivery.deliveryStatus === 'AMBIGUOUS'
  ) return 'MANUAL_RECONCILIATION_REQUIRED'
  if (delivery.deliveryStatus !== 'REJECTED') return 'RETRY_BLOCKED'
  if (
    delivery.deliveredPartCount !== 0
    || !Number.isInteger(delivery.partCount)
    || delivery.partCount < 1
    || !Array.isArray(delivery.parts)
    || delivery.parts.length < 1
    || delivery.parts.length !== delivery.partCount
    || delivery.parts.some((part) => part?.deliveryStatus !== 'REJECTED')
  ) return 'PARTIAL_DELIVERY_RECONCILIATION_REQUIRED'
  return 'RETRY_ALLOWED'
}

export const HOT_SELLING_AUTOMATIC_RETRY_OPERATION_KEY =
  'HOT_SELLING_AUTOMATIC_RETRY_V1'

export const HOT_SELLING_AUTOMATIC_RETRY_MAX_AGE_MS = 12 * 60 * 60_000
export const HOT_SELLING_AUTOMATIC_RETRY_BACKOFF_MS = 5 * 60_000

const automaticRetryPreflight = (delivery) => {
  const resolution = delivery?.hotSellingRetryResolution
  return (
    delivery?.automaticRetryAttempted === true
    && resolution
    && typeof resolution === 'object'
    && resolution.retryMode === 'AUTOMATIC'
    && resolution.retryOperationKey
      === HOT_SELLING_AUTOMATIC_RETRY_OPERATION_KEY
    && resolution.status === 'SENDING'
    && resolution.deliveryId === null
    && typeof resolution.requestKey === 'string'
    && resolution.requestKey.length >= 32
  )
}

const automaticRetryEvidenceIsSafe = (delivery) => {
  const failure = preciseWeComDeliveryFailure(delivery)
  return (
    delivery?.deliveryType === 'HOT_SELLING_SOLD_OUT'
    && delivery?.deliveryStatus === 'REJECTED'
    && !delivery?.retrySourceDeliveryId
    && delivery?.deliveredPartCount === 0
    && Number.isInteger(delivery?.partCount)
    && delivery.partCount > 0
    && delivery?.networkAttempted === false
    && delivery?.httpStatus == null
    && delivery?.weComCode == null
    && failure.reasonCode === 'WECOM_PAYLOAD_INVALID'
    && failure.networkAttempted === false
    && Array.isArray(delivery?.parts)
    && delivery.parts.length === delivery.partCount
    && delivery.parts.every((part) =>
      part?.deliveryStatus === 'REJECTED'
      && part?.reasonCode === 'WECOM_PAYLOAD_INVALID'
      && part?.networkAttempted === false
      && part?.httpStatus == null
      && part?.weComCode == null)
  )
}

export const automaticHotSellingRetryDecision = (
  delivery,
  now = new Date(),
) => {
  const recoverablePreflight = automaticRetryPreflight(delivery)
  if (delivery?.automaticRetryAttempted === true && !recoverablePreflight) {
    return 'AUTOMATIC_RETRY_ALREADY_ATTEMPTED'
  }
  if (!recoverablePreflight) {
    const retryDecision = hotSellingRetryDecision(delivery)
    if (retryDecision !== 'RETRY_ALLOWED') return retryDecision
  }

  if (!automaticRetryEvidenceIsSafe(delivery)) {
    return 'AUTOMATIC_RETRY_NOT_PROVEN_SAFE'
  }

  const attemptedAt = new Date(delivery.attemptedAt ?? '').getTime()
  const currentTime = now instanceof Date ? now.getTime() : Number.NaN
  const ageMs = currentTime - attemptedAt
  if (
    !Number.isFinite(attemptedAt)
    || !Number.isFinite(currentTime)
    || ageMs < -5 * 60_000
    || ageMs > HOT_SELLING_AUTOMATIC_RETRY_MAX_AGE_MS
  ) return 'AUTOMATIC_RETRY_WINDOW_CLOSED'

  const nextAttemptAt = new Date(
    delivery?.hotSellingRetryResolution?.nextPreflightAttemptAt ?? '',
  ).getTime()
  if (
    recoverablePreflight
    && Number.isFinite(nextAttemptAt)
    && currentTime < nextAttemptAt
  ) return 'AUTOMATIC_RETRY_BACKOFF'

  return recoverablePreflight
    ? 'AUTOMATIC_RETRY_RECOVERY_REQUIRED'
    : 'AUTOMATIC_RETRY_ALLOWED'
}

export const markAutomaticHotSellingRetryPreflight = ({
  delivery,
  requestKey,
  persist,
  now = new Date(),
}) => {
  const decision = automaticHotSellingRetryDecision(delivery, now)
  if (
    decision !== 'AUTOMATIC_RETRY_ALLOWED'
    && decision !== 'AUTOMATIC_RETRY_RECOVERY_REQUIRED'
  ) {
    throw new Error(`WECOM_${decision}`)
  }
  if (
    typeof requestKey !== 'string'
    || requestKey.length < 32
    || typeof persist !== 'function'
  ) {
    throw new Error('WECOM_AUTOMATIC_RETRY_PERSIST_REQUIRED')
  }
  delivery.automaticRetryAttempted = true
  delivery.automaticRetryAttemptedAt = now.toISOString()
  delivery.automaticRetryReasonCode = 'WECOM_PAYLOAD_INVALID'
  const previousResolution = automaticRetryPreflight(delivery)
    ? delivery.hotSellingRetryResolution
    : null
  delivery.hotSellingRetryResolution = {
    requestKey,
    retryMode: 'AUTOMATIC',
    retryOperationKey: HOT_SELLING_AUTOMATIC_RETRY_OPERATION_KEY,
    status: 'SENDING',
    skippedReasonCode: null,
    collectionRunId: null,
    cutoffAt: delivery.cutoffAt,
    deliveryId: null,
    completedAt: null,
    preflightAttemptCount:
      Number.isInteger(previousResolution?.preflightAttemptCount)
        ? previousResolution.preflightAttemptCount + 1
        : 1,
    nextPreflightAttemptAt: null,
  }
  // Persist the complete recoverable marker before collection or HTTP work.
  persist()
}

export const reconcileInterruptedWeComDelivery = (
  delivery,
  completedAt = new Date().toISOString(),
) => delivery?.deliveryStatus === 'SENDING'
  ? {
      ...delivery,
      completedAt,
      deliveryStatus: 'AMBIGUOUS',
      reasonCode: 'WECOM_PROCESS_INTERRUPTED_RESULT_UNKNOWN',
      networkAttempted: null,
    }
  : delivery
