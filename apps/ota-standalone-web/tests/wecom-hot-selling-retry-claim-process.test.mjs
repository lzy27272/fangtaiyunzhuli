import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

const claimModuleUrl = new URL(
  '../../../tools/uat/wecom-hot-selling-retry.mjs',
  import.meta.url,
).href

const expectedDeliveryId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const childDeliveryId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const operationKey = 'HOT_SELLING_RETRY_PROCESS_TEST'
const requestKey = `hotel-015:HOT_SELLING_RETRY_V1:${'a'.repeat(64)}`

const childProgram = String.raw`
const {
  acquireHotSellingRetryClaim,
} = await import(process.env.WECOM_CLAIM_MODULE_URL)

const input = JSON.parse(process.env.WECOM_CLAIM_INPUT)
const startAt = Number(process.env.WECOM_CLAIM_START_AT || 0)
if (Number.isFinite(startAt) && startAt > Date.now()) {
  await new Promise((resolve) => setTimeout(resolve, startAt - Date.now()))
}
let claim
try {
  claim = acquireHotSellingRetryClaim(input)
  if (process.env.WECOM_CLAIM_STAGE === 'CHILD_PERSISTED') {
    claim.markChildPersisted(process.env.WECOM_CHILD_DELIVERY_ID)
  }
  process.stdout.write(JSON.stringify({
    type: 'acquired',
    stage: claim.stage,
  }) + '\n')
  if (process.env.WECOM_CLAIM_HOLD === '1') {
    process.stdin.resume()
    await new Promise((resolve) => process.stdin.once('end', resolve))
  }
  if (claim.stage === 'PREFLIGHT') claim.releasePreflight()
  claim.close()
} catch (error) {
  process.stdout.write(JSON.stringify({
    type: 'error',
    reasonCode: error instanceof Error ? error.message : String(error),
  }) + '\n')
  process.exitCode = 42
}
`

const spawnClaimProcess = ({
  claimsRoot,
  hold = false,
  stage = 'PREFLIGHT',
  allowStalePreflightRecovery = false,
  startAt = 0,
}) => spawn(process.execPath, ['--input-type=module', '--eval', childProgram], {
  env: {
    ...process.env,
    WECOM_CLAIM_MODULE_URL: claimModuleUrl,
    WECOM_CLAIM_INPUT: JSON.stringify({
      claimsRoot,
      hotelId: 'hotel-015',
      sourceDeliveryId: expectedDeliveryId,
      operationKey,
      requestKey,
      allowStalePreflightRecovery,
    }),
    WECOM_CLAIM_STAGE: stage,
    WECOM_CHILD_DELIVERY_ID: childDeliveryId,
    WECOM_CLAIM_HOLD: hold ? '1' : '0',
    WECOM_CLAIM_START_AT: String(startAt),
  },
  stdio: ['pipe', 'pipe', 'pipe'],
})

const readFirstJsonLine = (child, timeoutMs = 10_000) => new Promise(
  (resolve, reject) => {
    let stdout = ''
    let stderr = ''
    const timeout = setTimeout(() => {
      reject(new Error(`claim child timed out; stdout=${stdout}; stderr=${stderr}`))
    }, timeoutMs)

    const finish = (result, error = null) => {
      clearTimeout(timeout)
      child.stdout.off('data', onStdout)
      child.stderr.off('data', onStderr)
      child.off('exit', onExit)
      if (error) reject(error)
      else resolve(result)
    }
    const onStderr = (chunk) => { stderr += chunk.toString('utf8') }
    const onStdout = (chunk) => {
      stdout += chunk.toString('utf8')
      const newline = stdout.indexOf('\n')
      if (newline < 0) return
      try {
        finish(JSON.parse(stdout.slice(0, newline)))
      } catch (error) {
        finish(null, new Error(
          `claim child emitted invalid JSON; stdout=${stdout}; stderr=${stderr}; ${error.message}`,
        ))
      }
    }
    const onExit = (code, signal) => finish(null, new Error(
      `claim child exited before reporting; code=${code}; signal=${signal}; stderr=${stderr}`,
    ))

    child.stdout.on('data', onStdout)
    child.stderr.on('data', onStderr)
    child.once('exit', onExit)
  },
)

const waitForExit = async (child) => {
  if (child.exitCode !== null || child.signalCode !== null) return
  await once(child, 'exit')
}

const stopChild = async (child) => {
  if (child.exitCode !== null || child.signalCode !== null) return
  child.kill()
  await waitForExit(child)
}

test('a real second process is rejected while CHILD_PERSISTED is held', async () => {
  const claimsRoot = await mkdtemp(join(tmpdir(), 'wecom-hot-process-lock-'))
  const holder = spawnClaimProcess({
    claimsRoot,
    hold: true,
    stage: 'CHILD_PERSISTED',
  })
  try {
    assert.deepEqual(await readFirstJsonLine(holder), {
      type: 'acquired',
      stage: 'CHILD_PERSISTED',
    })

    const contender = spawnClaimProcess({ claimsRoot })
    assert.deepEqual(await readFirstJsonLine(contender), {
      type: 'error',
      reasonCode: 'WECOM_HOT_SELLING_RETRY_IN_PROGRESS',
    })
    await waitForExit(contender)
    assert.equal(contender.exitCode, 42)
  } finally {
    await stopChild(holder)
    await rm(claimsRoot, { recursive: true, force: true })
  }
})

test('a real process can recover a PREFLIGHT claim after its owner crashes', async () => {
  const claimsRoot = await mkdtemp(join(tmpdir(), 'wecom-hot-process-crash-'))
  const crashedOwner = spawnClaimProcess({ claimsRoot, hold: true })
  try {
    assert.deepEqual(await readFirstJsonLine(crashedOwner), {
      type: 'acquired',
      stage: 'PREFLIGHT',
    })
    await stopChild(crashedOwner)

    const replacement = spawnClaimProcess({
      claimsRoot,
      allowStalePreflightRecovery: true,
    })
    assert.deepEqual(await readFirstJsonLine(replacement), {
      type: 'acquired',
      stage: 'PREFLIGHT',
    })
    await waitForExit(replacement)
    assert.equal(replacement.exitCode, 0)
  } finally {
    await stopChild(crashedOwner)
    await rm(claimsRoot, { recursive: true, force: true })
  }
})

test('concurrent processes cannot both recover the same crashed PREFLIGHT claim', async () => {
  const claimsRoot = await mkdtemp(join(tmpdir(), 'wecom-hot-process-race-'))
  const crashedOwner = spawnClaimProcess({ claimsRoot, hold: true })
  const contenders = []
  try {
    assert.deepEqual(await readFirstJsonLine(crashedOwner), {
      type: 'acquired',
      stage: 'PREFLIGHT',
    })
    await stopChild(crashedOwner)

    const startAt = Date.now() + 1_500
    for (let index = 0; index < 24; index += 1) {
      contenders.push(spawnClaimProcess({
        claimsRoot,
        stage: 'CHILD_PERSISTED',
        allowStalePreflightRecovery: true,
        startAt,
      }))
    }
    const results = await Promise.all(
      contenders.map((contender) => readFirstJsonLine(contender, 20_000)),
    )
    await Promise.all(contenders.map(waitForExit))

    assert.equal(
      results.filter((result) => result.type === 'acquired').length,
      1,
      JSON.stringify(results),
    )
    for (const result of results.filter((item) => item.type === 'error')) {
      assert.ok(
        [
          'WECOM_HOT_SELLING_RETRY_IN_PROGRESS',
          'WECOM_HOT_SELLING_MANUAL_RECONCILIATION_REQUIRED',
        ].includes(result.reasonCode),
        JSON.stringify(result),
      )
    }
  } finally {
    await Promise.all(contenders.map(stopChild))
    await stopChild(crashedOwner)
    await rm(claimsRoot, { recursive: true, force: true })
  }
})
