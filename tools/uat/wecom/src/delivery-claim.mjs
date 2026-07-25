import { createHash } from 'node:crypto'
import { mkdir, open, realpath } from 'node:fs/promises'
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

export async function acquireDeliveryClaim({
  claimsRoot,
  workspaceRoot,
  endpointSha256,
  messageSha256,
  inputSha256,
}) {
  await mkdir(claimsRoot, { recursive: true, mode: 0o700 })
  const [realClaimsRoot, realWorkspaceRoot] = await Promise.all([
    realpath(claimsRoot),
    realpath(workspaceRoot),
  ])
  if (!isInside(realWorkspaceRoot, realClaimsRoot)) {
    throw new SafeDeliveryClaimError(
      'DELIVERY_CLAIMS_ROOT_INVALID',
    )
  }

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
