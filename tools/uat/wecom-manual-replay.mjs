import { createHash } from 'node:crypto'

export const MANUAL_REPLAY_REASON_CODE = 'MANUAL_REPLAY_LATEST_COMPLETE'
export const MANUAL_REPLAY_MESSAGE_PREFIX = '人工补发'

const COLLECTION_RUN_ID = /^[0-9a-f-]{36}$/iu
const OPERATION_KEY = /^[A-Z0-9][A-Z0-9_-]{7,127}$/iu
const SAFE_REASON_CODE = /^[A-Z][A-Z0-9_]{2,127}$/u
const DELIVERY_TYPES = new Set(['TODAY_REVENUE', 'FUTURE_14D'])

const fail = (reasonCode) => {
  throw new Error(reasonCode)
}

export const normalizeManualReplayRequest = (body) => {
  if (
    !body
    || typeof body !== 'object'
    || Array.isArray(body)
    || Object.keys(body).sort().join(',')
      !== 'expectedCollectionRunId,operationKey,reasonCode'
  ) fail('WECOM_MANUAL_REPLAY_REQUEST_INVALID')

  const expectedCollectionRunId =
    typeof body.expectedCollectionRunId === 'string'
      ? body.expectedCollectionRunId.trim()
      : ''
  const operationKey = typeof body.operationKey === 'string'
    ? body.operationKey.trim()
    : ''
  if (!COLLECTION_RUN_ID.test(expectedCollectionRunId)) {
    fail('WECOM_MANUAL_REPLAY_COLLECTION_RUN_ID_INVALID')
  }
  if (!OPERATION_KEY.test(operationKey)) {
    fail('WECOM_MANUAL_REPLAY_OPERATION_KEY_INVALID')
  }
  if (body.reasonCode !== MANUAL_REPLAY_REASON_CODE) {
    fail('WECOM_MANUAL_REPLAY_REASON_CODE_INVALID')
  }
  return {
    expectedCollectionRunId,
    operationKey,
    reasonCode: MANUAL_REPLAY_REASON_CODE,
  }
}

export const selectLatestAuthoritativeCompleteSnapshot = ({
  snapshots,
  expectedCollectionRunId,
  trustedDeviceStatus,
}) => {
  if (
    trustedDeviceStatus !== null
    && trustedDeviceStatus !== undefined
    && (
      trustedDeviceStatus.eligible !== true
      || trustedDeviceStatus.mode !== 'STORE_TRUSTED_DEVICE'
      || trustedDeviceStatus.device?.cutoverReady !== true
    )
  ) fail('WECOM_MANUAL_REPLAY_AUTHORITATIVE_SNAPSHOT_REQUIRED')
  if (!Array.isArray(snapshots) || snapshots.length === 0) {
    fail('WECOM_MANUAL_REPLAY_SNAPSHOT_REQUIRED')
  }
  const snapshot = snapshots.at(-1)
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) {
    fail('WECOM_MANUAL_REPLAY_SNAPSHOT_INVALID')
  }
  if (snapshot.collectionRunId !== expectedCollectionRunId) {
    fail('WECOM_MANUAL_REPLAY_LATEST_SNAPSHOT_CHANGED')
  }
  if (snapshot.completeness !== 'COMPLETE') {
    fail('WECOM_MANUAL_REPLAY_COMPLETE_SNAPSHOT_REQUIRED')
  }
  if (
    typeof snapshot.observedAt !== 'string'
    || Number.isNaN(new Date(snapshot.observedAt).getTime())
    || typeof snapshot.businessDate !== 'string'
    || !/^\d{4}-\d{2}-\d{2}$/u.test(snapshot.businessDate)
  ) fail('WECOM_MANUAL_REPLAY_SNAPSHOT_INVALID')
  if (
    trustedDeviceStatus !== null
    && trustedDeviceStatus !== undefined
    && (
      trustedDeviceStatus.device.lastSnapshotAt !== snapshot.observedAt
      || trustedDeviceStatus.device.lastBusinessDate !== snapshot.businessDate
      || trustedDeviceStatus.device.lastCompleteness !== 'COMPLETE'
    )
  ) fail('WECOM_MANUAL_REPLAY_AUTHORITATIVE_SNAPSHOT_REQUIRED')
  return snapshot
}

export const manualReplayMessageKey = ({
  hotelId,
  operationKey,
  deliveryType,
}) => {
  if (
    typeof hotelId !== 'string'
    || hotelId.length < 1
    || hotelId.length > 128
    || !OPERATION_KEY.test(operationKey)
    || !DELIVERY_TYPES.has(deliveryType)
  ) fail('WECOM_MANUAL_REPLAY_MESSAGE_KEY_INPUT_INVALID')
  const operationDigest = createHash('sha256')
    .update(`wecom-manual-replay:v1:${hotelId}:${operationKey}`, 'utf8')
    .digest('hex')
  return `${hotelId}:MANUAL_REPLAY_V1:${operationDigest}:${deliveryType}`
}

export const manualReplayDeliveryDecision = ({
  delivery,
  hotelId,
  snapshot,
}) => {
  if (!delivery) return 'SEND_MISSING'
  if (
    delivery.hotelId !== hotelId
    || delivery.businessDate !== snapshot.businessDate
    || delivery.cutoffAt !== snapshot.observedAt
  ) return 'OPERATION_SCOPE_CONFLICT'
  if (delivery.deliveryStatus === 'DELIVERED') return 'ALREADY_DELIVERED'
  if (
    delivery.deliveryStatus === 'AMBIGUOUS'
    || delivery.deliveryStatus === 'SENDING'
  ) return 'MANUAL_RECONCILIATION_REQUIRED'
  return 'REJECTED_NO_AUTOMATIC_RETRY'
}

export const manualReplayDeliveryView = (delivery) => {
  if (!delivery || typeof delivery !== 'object') {
    fail('WECOM_MANUAL_REPLAY_DELIVERY_INVALID')
  }
  const view = {
    deliveryType: delivery.deliveryType,
    deliveryStatus: delivery.deliveryStatus,
    reasonCode: SAFE_REASON_CODE.test(String(delivery.reasonCode ?? ''))
      ? delivery.reasonCode
      : 'WECOM_MANUAL_REPLAY_DELIVERY_FAILED_CLOSED',
    partCount: Number.isInteger(delivery.partCount) ? delivery.partCount : 0,
    deliveredPartCount: Number.isInteger(delivery.deliveredPartCount)
      ? delivery.deliveredPartCount
      : 0,
  }
  if (typeof delivery.attemptedAt === 'string') {
    view.attemptedAt = delivery.attemptedAt
  }
  if (typeof delivery.completedAt === 'string') {
    view.completedAt = delivery.completedAt
  }
  return view
}

export const safeManualReplayFailureReason = (error) => {
  const reasonCode = String(error?.message ?? '')
  return SAFE_REASON_CODE.test(reasonCode)
    ? reasonCode
    : 'WECOM_MANUAL_REPLAY_FAILED_CLOSED'
}
