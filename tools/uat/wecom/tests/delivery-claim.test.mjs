import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import {
  acquireDeliveryClaim,
  SafeDeliveryClaimError,
} from '../src/delivery-claim.mjs'

test('delivery claim permits one concurrent sender and blocks duplicates', async () => {
  const workspaceRoot = await mkdtemp(
    join(tmpdir(), 'ota-wecom-claim-'),
  )
  const claimsRoot = join(
    workspaceRoot,
    '.uat-runtime',
    'wecom',
    'delivery-claims',
  )
  await mkdir(claimsRoot, { recursive: true })

  try {
    const command = {
      claimsRoot,
      workspaceRoot,
      endpointSha256: 'a'.repeat(64),
      messageSha256: 'b'.repeat(64),
      inputSha256: 'c'.repeat(64),
    }
    const results = await Promise.allSettled([
      acquireDeliveryClaim(command),
      acquireDeliveryClaim(command),
    ])
    const fulfilled = results.filter(
      (result) => result.status === 'fulfilled',
    )
    const rejected = results.filter(
      (result) => result.status === 'rejected',
    )
    assert.equal(fulfilled.length, 1)
    assert.equal(rejected.length, 1)
    assert.equal(
      rejected[0].reason instanceof SafeDeliveryClaimError,
      true,
    )
    assert.equal(
      rejected[0].reason.reasonCode,
      'WECOM_UAT_DUPLICATE_MESSAGE_BLOCKED',
    )

    const claim = fulfilled[0].value
    await claim.complete({
      deliveryStatus: 'DELIVERED',
      reasonCode: 'WECOM_DELIVERED',
      httpStatus: 200,
      weComCode: 0,
    })
    await claim.close()

    const claimPath = join(claimsRoot, `${claim.claimId}.json`)
    const persisted = JSON.parse(await readFile(claimPath, 'utf8'))
    assert.equal(persisted.state, 'DELIVERED')
    assert.equal(JSON.stringify(persisted).includes('webhook'), false)
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true })
  }
})
