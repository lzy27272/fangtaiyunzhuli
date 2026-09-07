import { createHash } from 'node:crypto'

export const P1_MANUAL_REPLAY_OPERATION_KEY =
  'P1_REPLAY_001_20260907_ALLOWLIST_FIX_V1'
export const P1_MANUAL_REPLAY_REASON_CODE =
  'MANUAL_REPLAY_P1_FUTURE_DEMAND'

const P1_DELIVERY_TYPE = 'P1_FUTURE_DEMAND'
const COLLECTION_RUN_ID =
  /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/iu
const HOTEL_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/u
const SAFE_REASON_CODE = /^[A-Z][A-Z0-9_]{2,127}$/u
const ISO_TIMESTAMP =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u
const DELIVERY_STATUSES = new Set([
  'SENDING',
  'DELIVERED',
  'REJECTED',
  'AMBIGUOUS',
])

const fail = (reasonCode) => {
  throw new Error(reasonCode)
}

const validHotelId = (hotelId) =>
  typeof hotelId === 'string' && HOTEL_ID.test(hotelId)

const validSnapshotScope = (snapshot) =>
  snapshot
  && typeof snapshot === 'object'
  && !Array.isArray(snapshot)
  && typeof snapshot.businessDate === 'string'
  && /^\d{4}-\d{2}-\d{2}$/u.test(snapshot.businessDate)
  && typeof snapshot.observedAt === 'string'
  && !Number.isNaN(new Date(snapshot.observedAt).getTime())

export const normalizeP1ManualReplayRequest = (body) => {
  if (
    !body
    || typeof body !== 'object'
    || Array.isArray(body)
    || Object.keys(body).sort().join(',')
      !== 'expectedCollectionRunId,reasonCode'
  ) fail('WECOM_P1_MANUAL_REPLAY_REQUEST_INVALID')

  const expectedCollectionRunId =
    typeof body.expectedCollectionRunId === 'string'
      ? body.expectedCollectionRunId.trim()
      : ''
  if (!COLLECTION_RUN_ID.test(expectedCollectionRunId)) {
    fail('WECOM_P1_MANUAL_REPLAY_COLLECTION_RUN_ID_INVALID')
  }
  if (body.reasonCode !== P1_MANUAL_REPLAY_REASON_CODE) {
    fail('WECOM_P1_MANUAL_REPLAY_REASON_CODE_INVALID')
  }
  return {
    expectedCollectionRunId,
    operationKey: P1_MANUAL_REPLAY_OPERATION_KEY,
    reasonCode: P1_MANUAL_REPLAY_REASON_CODE,
  }
}

export const p1ManualReplayMessageKey = ({
  hotelId,
  operationKey = P1_MANUAL_REPLAY_OPERATION_KEY,
} = {}) => {
  if (
    !validHotelId(hotelId)
    || operationKey !== P1_MANUAL_REPLAY_OPERATION_KEY
  ) fail('WECOM_P1_MANUAL_REPLAY_MESSAGE_KEY_INPUT_INVALID')

  const operationDigest = createHash('sha256')
    .update(
      `wecom-p1-manual-replay:v1:${hotelId}:${operationKey}`,
      'utf8',
    )
    .digest('hex')
  return `${hotelId}:P1_MANUAL_REPLAY_V1:${operationDigest}:${P1_DELIVERY_TYPE}`
}

export const p1ManualReplayDeliveryDecision = ({
  delivery,
  hotelId,
  snapshot,
} = {}) => {
  if (!validHotelId(hotelId) || !validSnapshotScope(snapshot)) {
    fail('WECOM_P1_MANUAL_REPLAY_DECISION_INPUT_INVALID')
  }
  if (!delivery) return 'SEND_MISSING'
  if (
    typeof delivery !== 'object'
    || Array.isArray(delivery)
    || delivery.hotelId !== hotelId
    || delivery.deliveryType !== P1_DELIVERY_TYPE
    || delivery.businessDate !== snapshot.businessDate
    || delivery.cutoffAt !== snapshot.observedAt
  ) return 'OPERATION_SCOPE_CONFLICT'
  if (delivery.deliveryStatus === 'DELIVERED') return 'ALREADY_DELIVERED'
  if (
    delivery.deliveryStatus === 'SENDING'
    || delivery.deliveryStatus === 'AMBIGUOUS'
  ) return 'MANUAL_RECONCILIATION_REQUIRED'
  return 'REJECTED_NO_AUTOMATIC_RETRY'
}

export const p1ManualReplayDeliveryView = (delivery) => {
  if (!delivery || typeof delivery !== 'object' || Array.isArray(delivery)) {
    fail('WECOM_P1_MANUAL_REPLAY_DELIVERY_INVALID')
  }
  const partCount =
    Number.isInteger(delivery.partCount) && delivery.partCount >= 0
      ? delivery.partCount
      : 0
  const deliveredPartCount =
    Number.isInteger(delivery.deliveredPartCount)
    && delivery.deliveredPartCount >= 0
    && delivery.deliveredPartCount <= partCount
      ? delivery.deliveredPartCount
      : 0
  const view = {
    deliveryType: P1_DELIVERY_TYPE,
    deliveryStatus: DELIVERY_STATUSES.has(delivery.deliveryStatus)
      ? delivery.deliveryStatus
      : 'REJECTED',
    reasonCode: SAFE_REASON_CODE.test(String(delivery.reasonCode ?? ''))
      ? delivery.reasonCode
      : 'WECOM_P1_MANUAL_REPLAY_DELIVERY_FAILED_CLOSED',
    partCount,
    deliveredPartCount,
  }
  if (
    typeof delivery.attemptedAt === 'string'
    && ISO_TIMESTAMP.test(delivery.attemptedAt)
  ) view.attemptedAt = delivery.attemptedAt
  if (
    typeof delivery.completedAt === 'string'
    && ISO_TIMESTAMP.test(delivery.completedAt)
  ) view.completedAt = delivery.completedAt
  return view
}

export const safeP1ManualReplayFailureReason = (error) => {
  const reasonCode = String(error?.reasonCode ?? error?.message ?? '')
  return SAFE_REASON_CODE.test(reasonCode)
    ? reasonCode
    : 'WECOM_P1_MANUAL_REPLAY_FAILED_CLOSED'
}
