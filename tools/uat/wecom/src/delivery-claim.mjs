import { createHash } from 'node:crypto'
import { mkdir, open, realpath, unlink } from 'node:fs/promises'
import { isAbsolute, relative, resolve } from 'node:path'

export class SafeDeliveryClaimError extends Error {
  constructor(reasonCode) {
    super(reasonCode)
    this.name = 'SafeDeliveryClaimError'
    this.reasonCode = reasonCode
  }
}

const isInside = (rootPath, childPath) => {
  const childRelativePath = relative(rootPath, childPath)
  return (
    childRelativePath !== '' &&
    !childRelativePath.startsWith('..') &&
    !isAbsolute(childRelativePath)
  )
}

const sha256 = (value) =>
  createHash('sha256').update(value, 'utf8').digest('hex')

const writeState = async (handle, state) => {
  const content = Buffer.from(
    `${JSON.stringify(state, null, 2)}\n`,
    'utf8',
  )
  await handle.write(content, 0, content.length, 0)
  await handle.truncate(content.length)
  await handle.sync()
}

const resolveClaimsRoot = async ({ claimsRoot, workspaceRoot }) => {
  await mkdir(claimsRoot, { recursive: true, mode: 0o700 })
  const [realClaimsRoot, realWorkspaceRoot] = await Promise.all([
    realpath(claimsRoot),
    realpath(workspaceRoot),
  ])
  if (!isInside(realWorkspaceRoot, realClaimsRoot)) {
    throw new SafeDeliveryClaimError('DELIVERY_CLAIMS_ROOT_INVALID')
  }
  return realClaimsRoot
}

export async function acquireDeliveryClaim({
  claimsRoot,
  workspaceRoot,
  endpointSha256,
  messageSha256,
  inputSha256,
}) {
  const realClaimsRoot = await resolveClaimsRoot({ claimsRoot, workspaceRoot })

  const claimId = sha256(`${endpointSha256}|${messageSha256}`)
  const claimPath = resolve(realClaimsRoot, `${claimId}.json`)
  let handle
  try {
    handle = await open(claimPath, 'wx', 0o600)
  } catch (error) {
    if (error?.code === 'EEXIST') {
      throw new SafeDeliveryClaimError(
        'WECOM_UAT_DUPLICATE_MESSAGE_BLOCKED',
      )
    }
    throw new SafeDeliveryClaimError(
      'WECOM_UAT_DELIVERY_CLAIM_FAILED',
    )
  }

  await writeState(handle, {
    state: 'CLAIMED',
    claimId,
    endpointSha256,
    messageSha256,
    inputSha256,
    claimedAt: new Date().toISOString(),
  })

  let closed = false
  return Object.freeze({
    claimId,
    async complete(resultState) {
      if (closed) {
        throw new SafeDeliveryClaimError(
          'WECOM_UAT_DELIVERY_CLAIM_CLOSED',
        )
      }
      await writeState(handle, {
        state: resultState.deliveryStatus,
        claimId,
        endpointSha256,
        messageSha256,
        inputSha256,
        completedAt: new Date().toISOString(),
        reasonCode: resultState.reasonCode,
        httpStatus: resultState.httpStatus,
        weComCode: resultState.weComCode,
      })
    },
    async close() {
      if (!closed) {
        closed = true
        await handle.close()
      }
    },
  })
}

export async function acquireMessageKeyDeliveryClaim({
  claimsRoot,
  workspaceRoot,
  hotelId,
  messageKey,
  deliveryType,
  messageSha256,
  ownerPid = process.pid,
}) {
  if (
    typeof hotelId !== 'string'
    || hotelId.length < 1
    || hotelId.length > 128
    || typeof messageKey !== 'string'
    || messageKey.length < 1
    || messageKey.length > 512
    || typeof deliveryType !== 'string'
    || !/^[A-Z][A-Z0-9_]{1,63}$/u.test(deliveryType)
    || !/^[a-f0-9]{64}$/u.test(messageSha256)
    || !Number.isInteger(ownerPid)
    || ownerPid < 1
  ) {
    throw new SafeDeliveryClaimError(
      'WECOM_DELIVERY_MESSAGE_KEY_CLAIM_INPUT_INVALID',
    )
  }

  const realClaimsRoot = await resolveClaimsRoot({ claimsRoot, workspaceRoot })
  const messageKeySha256 = sha256(messageKey)
  const claimId = sha256(
    `wecom-message-key-claim:v1:${hotelId}:${messageKeySha256}`,
  )
  const claimPath = resolve(realClaimsRoot, `${claimId}.json`)
  let handle
  try {
    handle = await open(claimPath, 'wx', 0o600)
  } catch (error) {
    if (error?.code === 'EEXIST') {
      throw new SafeDeliveryClaimError(
        'WECOM_DELIVERY_MESSAGE_KEY_ALREADY_CLAIMED',
      )
    }
    throw new SafeDeliveryClaimError(
      'WECOM_DELIVERY_MESSAGE_KEY_CLAIM_FAILED',
    )
  }

  let state = {
    version: 1,
    state: 'PREPARED',
    claimId,
    ownerPid,
    hotelId,
    messageKeySha256,
    deliveryType,
    messageSha256,
    claimedAt: new Date().toISOString(),
    deliveryId: null,
    completedAt: null,
    reasonCode: null,
  }
  try {
    await writeState(handle, state)
  } catch {
    try { await handle.close() } catch {}
    try { await unlink(claimPath) } catch {}
    throw new SafeDeliveryClaimError(
      'WECOM_DELIVERY_MESSAGE_KEY_CLAIM_FAILED',
    )
  }

  let closed = false
  const update = async (nextState) => {
    if (closed) {
      throw new SafeDeliveryClaimError(
        'WECOM_DELIVERY_MESSAGE_KEY_CLAIM_CLOSED',
      )
    }
    try {
      await writeState(handle, nextState)
      state = nextState
    } catch {
      throw new SafeDeliveryClaimError(
        'WECOM_DELIVERY_MESSAGE_KEY_CLAIM_UPDATE_FAILED',
      )
    }
  }

  return Object.freeze({
    claimId,
    async markLedgerPersisted(deliveryId) {
      if (!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/iu.test(
        deliveryId,
      )) {
        throw new SafeDeliveryClaimError(
          'WECOM_DELIVERY_MESSAGE_KEY_CLAIM_DELIVERY_INVALID',
        )
      }
      await update({
        ...state,
        state: 'LEDGER_PERSISTED',
        deliveryId,
      })
    },
    async complete(resultState) {
      if (
        typeof resultState?.deliveryStatus !== 'string'
        || !/^[A-Z][A-Z0-9_]{1,63}$/u.test(resultState.deliveryStatus)
        || typeof resultState?.reasonCode !== 'string'
        || !/^[A-Z][A-Z0-9_]{1,95}$/u.test(resultState.reasonCode)
      ) {
        throw new SafeDeliveryClaimError(
          'WECOM_DELIVERY_MESSAGE_KEY_CLAIM_RESULT_INVALID',
        )
      }
      await update({
        ...state,
        state: resultState.deliveryStatus,
        completedAt: new Date().toISOString(),
        reasonCode: resultState.reasonCode,
      })
    },
    async close() {
      if (!closed) {
        closed = true
        await handle.close()
      }
    },
  })
}
