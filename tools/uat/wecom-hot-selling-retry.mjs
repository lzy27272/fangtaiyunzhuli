import { createHash, randomUUID } from 'node:crypto'
import {
  closeSync,
  fsyncSync,
  ftruncateSync,
  mkdirSync,
  openSync,
  readFileSync,
  unlinkSync,
  writeSync,
} from 'node:fs'
import { join, resolve } from 'node:path'

export const HOT_SELLING_RETRY_REASON_CODE =
  'RETRY_HOT_SELLING_SOLD_OUT'

const DELIVERY_ID = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/iu
const OPERATION_KEY = /^[A-Z0-9][A-Z0-9_-]{7,127}$/u

const fail = (reasonCode) => {
  throw new Error(reasonCode)
}

export const normalizeHotSellingRetryRequest = (body) => {
  if (
    !body
    || typeof body !== 'object'
    || Array.isArray(body)
    || Object.keys(body).sort().join(',')
      !== 'expectedDeliveryId,operationKey,reasonCode'
  ) fail('WECOM_HOT_SELLING_RETRY_REQUEST_INVALID')
  const expectedDeliveryId = String(body.expectedDeliveryId ?? '').trim()
  const operationKey = String(body.operationKey ?? '').trim()
  if (!DELIVERY_ID.test(expectedDeliveryId)) {
    fail('WECOM_HOT_SELLING_RETRY_DELIVERY_ID_INVALID')
  }
  if (!OPERATION_KEY.test(operationKey)) {
    fail('WECOM_HOT_SELLING_RETRY_OPERATION_KEY_INVALID')
  }
  if (body.reasonCode !== HOT_SELLING_RETRY_REASON_CODE) {
    fail('WECOM_HOT_SELLING_RETRY_REASON_CODE_INVALID')
  }
  return { expectedDeliveryId, operationKey }
}

export const hotSellingRetryMessageKey = ({
  hotelId,
  expectedDeliveryId,
  operationKey,
}) => {
  if (
    typeof hotelId !== 'string'
    || !hotelId
    || hotelId.length > 128
    || !DELIVERY_ID.test(expectedDeliveryId)
    || !OPERATION_KEY.test(operationKey)
  ) fail('WECOM_HOT_SELLING_RETRY_MESSAGE_KEY_INPUT_INVALID')
  const digest = createHash('sha256')
    .update(
      `wecom-hot-selling-retry:v1:${hotelId}:${expectedDeliveryId}:${operationKey}`,
      'utf8',
    )
    .digest('hex')
  return `${hotelId}:HOT_SELLING_RETRY_V1:${digest}`
}

export const coordinateHotSellingRetry = ({
  locksByHotel,
  hotelId,
  sourceDeliveryId,
  operationKey,
  run,
}) => {
  if (
    !(locksByHotel instanceof Map)
    || typeof hotelId !== 'string'
    || !hotelId
    || !DELIVERY_ID.test(sourceDeliveryId)
    || !OPERATION_KEY.test(operationKey)
    || typeof run !== 'function'
  ) fail('WECOM_HOT_SELLING_RETRY_COORDINATOR_INPUT_INVALID')

  const running = locksByHotel.get(hotelId)
  if (running) {
    if (
      running.sourceDeliveryId !== sourceDeliveryId
      || running.operationKey !== operationKey
    ) fail('WECOM_HOT_SELLING_RETRY_IN_PROGRESS')
    return { operation: running.operation, joined: true }
  }

  const lock = {
    sourceDeliveryId,
    operationKey,
    operation: null,
  }
  const operation = Promise.resolve()
    .then(run)
    .finally(() => {
      if (locksByHotel.get(hotelId) === lock) locksByHotel.delete(hotelId)
    })
  lock.operation = operation
  locksByHotel.set(hotelId, lock)
  return { operation, joined: false }
}

const processIsAlive = (pid) => {
  if (!Number.isInteger(pid) || pid < 1) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return error?.code === 'EPERM'
  }
}

const writeClaimState = (descriptor, state) => {
  const content = Buffer.from(`${JSON.stringify(state, null, 2)}\n`, 'utf8')
  ftruncateSync(descriptor, 0)
  writeSync(descriptor, content, 0, content.length, 0)
  fsyncSync(descriptor)
}

const claimPathFor = ({ claimsRoot, hotelId, sourceDeliveryId }) => {
  if (
    typeof claimsRoot !== 'string'
    || !claimsRoot.trim()
    || typeof hotelId !== 'string'
    || !hotelId
    || !DELIVERY_ID.test(sourceDeliveryId)
  ) fail('WECOM_HOT_SELLING_RETRY_CLAIM_INPUT_INVALID')
  const root = resolve(claimsRoot)
  mkdirSync(root, { recursive: true, mode: 0o700 })
  const claimId = createHash('sha256')
    .update(
      `wecom-hot-selling-retry-claim:v1:${hotelId}:${sourceDeliveryId}`,
      'utf8',
    )
    .digest('hex')
  const claimPath = join(root, `${claimId}.json`)
  return {
    claimId,
    claimPath,
    acquisitionPath: `${claimPath}.acquire`,
  }
}

const readBoundedJson = (path) => {
  const raw = readFileSync(path, 'utf8')
  if (Buffer.byteLength(raw, 'utf8') > 4096) throw new Error('oversize')
  return JSON.parse(raw)
}

export const acquireHotSellingRetryClaim = ({
  claimsRoot,
  hotelId,
  sourceDeliveryId,
  operationKey,
  requestKey,
  allowStalePreflightRecovery = false,
  ownerPid = process.pid,
  isProcessAlive = processIsAlive,
}) => {
  if (
    !OPERATION_KEY.test(operationKey)
    || typeof requestKey !== 'string'
    || requestKey.length < 32
    || requestKey.length > 512
    || !Number.isInteger(ownerPid)
    || ownerPid < 1
    || typeof isProcessAlive !== 'function'
  ) fail('WECOM_HOT_SELLING_RETRY_CLAIM_INPUT_INVALID')
  const { claimId, claimPath, acquisitionPath } = claimPathFor({
    claimsRoot,
    hotelId,
    sourceDeliveryId,
  })

  let acquisitionDescriptor
  try {
    acquisitionDescriptor = openSync(acquisitionPath, 'wx', 0o600)
  } catch (error) {
    if (error?.code !== 'EEXIST') {
      fail('WECOM_HOT_SELLING_RETRY_CLAIM_FAILED')
    }
    let acquisitionState
    try {
      acquisitionState = readBoundedJson(acquisitionPath)
    } catch {
      fail('WECOM_HOT_SELLING_MANUAL_RECONCILIATION_REQUIRED')
    }
    if (
      acquisitionState?.version === 1
      && acquisitionState?.claimId === claimId
      && isProcessAlive(acquisitionState?.ownerPid)
    ) {
      fail('WECOM_HOT_SELLING_RETRY_IN_PROGRESS')
    }
    // A crashed acquisition guard is deliberately not removed automatically.
    // Recovering it without an external CAS would recreate the same takeover
    // race this guard prevents, so an operator must reconcile it explicitly.
    fail('WECOM_HOT_SELLING_MANUAL_RECONCILIATION_REQUIRED')
  }

  let descriptor
  let claimCreated = false
  let state
  let acquisitionSucceeded = false
  try {
    writeClaimState(acquisitionDescriptor, {
      version: 1,
      claimId,
      guardNonce: randomUUID(),
      ownerPid,
      acquiredAt: new Date().toISOString(),
    })

    try {
      descriptor = openSync(claimPath, 'wx', 0o600)
      claimCreated = true
    } catch (error) {
      if (error?.code !== 'EEXIST') {
        fail('WECOM_HOT_SELLING_RETRY_CLAIM_FAILED')
      }
      let existing
      try {
        existing = readBoundedJson(claimPath)
      } catch {
        fail('WECOM_HOT_SELLING_MANUAL_RECONCILIATION_REQUIRED')
      }
      if (isProcessAlive(existing?.ownerPid)) {
        fail('WECOM_HOT_SELLING_RETRY_IN_PROGRESS')
      }
      if (
        allowStalePreflightRecovery !== true
        || existing?.version !== 1
        || existing?.claimId !== claimId
        || existing?.hotelId !== hotelId
        || existing?.sourceDeliveryId !== sourceDeliveryId
        || existing?.operationKey !== operationKey
        || existing?.requestKey !== requestKey
        || existing?.stage !== 'PREFLIGHT'
      ) {
        fail('WECOM_HOT_SELLING_MANUAL_RECONCILIATION_REQUIRED')
      }
      try {
        unlinkSync(claimPath)
      } catch {
        fail('WECOM_HOT_SELLING_RETRY_IN_PROGRESS')
      }
      try {
        descriptor = openSync(claimPath, 'wx', 0o600)
        claimCreated = true
      } catch (recoveryError) {
        if (recoveryError?.code === 'EEXIST') {
          fail('WECOM_HOT_SELLING_RETRY_IN_PROGRESS')
        }
        fail('WECOM_HOT_SELLING_RETRY_CLAIM_FAILED')
      }
    }

    if (!Number.isInteger(descriptor)) {
      fail('WECOM_HOT_SELLING_RETRY_CLAIM_FAILED')
    }
    state = {
      version: 1,
      claimId,
      claimNonce: randomUUID(),
      hotelId,
      sourceDeliveryId,
      operationKey,
      requestKey,
      ownerPid,
      stage: 'PREFLIGHT',
      claimedAt: new Date().toISOString(),
      childDeliveryId: null,
      completedAt: null,
      completionStatus: null,
    }
    writeClaimState(descriptor, state)
    acquisitionSucceeded = true
  } catch (error) {
    if (Number.isInteger(descriptor)) {
      try { closeSync(descriptor) } catch {}
    }
    if (claimCreated) {
      try { unlinkSync(claimPath) } catch {}
    }
    throw error
  } finally {
    let acquisitionCleanupFailed = false
    try {
      closeSync(acquisitionDescriptor)
    } catch {
      acquisitionCleanupFailed = true
    }
    try {
      unlinkSync(acquisitionPath)
    } catch {
      acquisitionCleanupFailed = true
    }
    if (acquisitionCleanupFailed) {
      if (acquisitionSucceeded && Number.isInteger(descriptor)) {
        try { closeSync(descriptor) } catch {}
      }
      fail('WECOM_HOT_SELLING_MANUAL_RECONCILIATION_REQUIRED')
    }
  }

  let closed = false
  const update = (nextState) => {
    if (closed) fail('WECOM_HOT_SELLING_RETRY_CLAIM_CLOSED')
    state = nextState
    try {
      writeClaimState(descriptor, state)
    } catch {
      fail('WECOM_HOT_SELLING_RETRY_CLAIM_UPDATE_FAILED')
    }
  }
  return {
    get stage() { return state.stage },
    markChildPersisted(childDeliveryId) {
      if (!DELIVERY_ID.test(childDeliveryId)) {
        fail('WECOM_HOT_SELLING_RETRY_CLAIM_CHILD_INVALID')
      }
      update({
        ...state,
        stage: 'CHILD_PERSISTED',
        childDeliveryId,
      })
    },
    complete(completionStatus) {
      if (
        typeof completionStatus !== 'string'
        || !/^[A-Z][A-Z0-9_]{1,63}$/u.test(completionStatus)
      ) fail('WECOM_HOT_SELLING_RETRY_CLAIM_STATUS_INVALID')
      update({
        ...state,
        stage: 'COMPLETED',
        completedAt: new Date().toISOString(),
        completionStatus,
      })
    },
    releasePreflight() {
      if (closed || state.stage !== 'PREFLIGHT') return false
      closed = true
      closeSync(descriptor)
      try {
        unlinkSync(claimPath)
        return true
      } catch {
        return false
      }
    },
    close() {
      if (closed) return
      closed = true
      closeSync(descriptor)
    },
  }
}
