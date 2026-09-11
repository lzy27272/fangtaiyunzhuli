import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

const claimModuleUrl = new URL('../src/delivery-claim.mjs', import.meta.url).href

const childProgram = String.raw`
import { randomUUID } from 'node:crypto'
import { appendFileSync } from 'node:fs'

const { acquireMessageKeyDeliveryClaim } = await import(
  process.env.WECOM_DELIVERY_CLAIM_MODULE_URL
)
const startAt = Number(process.env.WECOM_DELIVERY_CLAIM_START_AT)
if (startAt > Date.now()) {
  await new Promise((resolve) => setTimeout(resolve, startAt - Date.now()))
}
let claim
try {
  claim = await acquireMessageKeyDeliveryClaim(
    JSON.parse(process.env.WECOM_DELIVERY_CLAIM_INPUT),
  )
  await claim.markLedgerPersisted(randomUUID())
  appendFileSync(process.env.WECOM_NETWORK_ATTEMPT_PATH, 'attempt\n', 'utf8')
  await claim.complete({
    deliveryStatus: 'DELIVERED',
    reasonCode: 'WECOM_DELIVERED',
  })
  process.stdout.write(JSON.stringify({ type: 'acquired' }) + '\n')
} catch (error) {
  process.stdout.write(JSON.stringify({
    type: 'error',
    reasonCode: error instanceof Error ? error.message : String(error),
  }) + '\n')
  process.exitCode = 42
} finally {
  await claim?.close()
}
`

const readFirstJsonLine = (child, timeoutMs = 15_000) => new Promise(
  (resolve, reject) => {
    let stdout = ''
    let stderr = ''
    const timeout = setTimeout(() => reject(new Error(
      `delivery claim child timed out; stdout=${stdout}; stderr=${stderr}`,
    )), timeoutMs)
    const finish = (value, error = null) => {
      clearTimeout(timeout)
      child.stdout.off('data', onStdout)
      child.stderr.off('data', onStderr)
      child.off('exit', onExit)
      if (error) reject(error)
      else resolve(value)
    }
    const onStdout = (chunk) => {
      stdout += chunk.toString('utf8')
      const newline = stdout.indexOf('\n')
      if (newline < 0) return
      try {
        finish(JSON.parse(stdout.slice(0, newline)))
      } catch (error) {
        finish(null, error)
      }
    }
    const onStderr = (chunk) => { stderr += chunk.toString('utf8') }
    const onExit = (code, signal) => finish(null, new Error(
      `delivery claim child exited early; code=${code}; signal=${signal}; stderr=${stderr}`,
    ))
    child.stdout.on('data', onStdout)
    child.stderr.on('data', onStderr)
    child.once('exit', onExit)
  },
)

test('real processes sharing one message key make only one network attempt', {
  timeout: 30_000,
}, async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'wecom-message-claim-'))
  const claimsRoot = join(workspaceRoot, 'message-claims')
  const networkAttemptPath = join(workspaceRoot, 'network-attempts.log')
  const startAt = Date.now() + 1_500
  const claimInput = JSON.stringify({
    claimsRoot,
    workspaceRoot,
    hotelId: '20000000-0000-4000-8000-000000000001',
    messageKey: 'hotel-001:2026-09-11:11:HOT_SELLING_SOLD_OUT_V1',
    deliveryType: 'HOT_SELLING_SOLD_OUT',
    messageSha256: 'a'.repeat(64),
  })
  const children = Array.from({ length: 16 }, () => spawn(
    process.execPath,
    ['--input-type=module', '--eval', childProgram],
    {
      env: {
        ...process.env,
        WECOM_DELIVERY_CLAIM_MODULE_URL: claimModuleUrl,
        WECOM_DELIVERY_CLAIM_INPUT: claimInput,
        WECOM_DELIVERY_CLAIM_START_AT: String(startAt),
        WECOM_NETWORK_ATTEMPT_PATH: networkAttemptPath,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  ))
  try {
    const results = await Promise.all(
      children.map((child) => readFirstJsonLine(child)),
    )
    await Promise.all(children.map(async (child) => {
      if (child.exitCode === null && child.signalCode === null) {
        await once(child, 'exit')
      }
    }))
    assert.equal(results.filter((result) => result.type === 'acquired').length, 1)
    assert.equal(results.filter((result) =>
      result.reasonCode === 'WECOM_DELIVERY_MESSAGE_KEY_ALREADY_CLAIMED'
    ).length, 15)
    assert.deepEqual(
      (await readFile(networkAttemptPath, 'utf8')).trim().split(/\r?\n/u),
      ['attempt'],
    )
  } finally {
    for (const child of children) {
      if (child.exitCode === null && child.signalCode === null) child.kill()
    }
    await rm(workspaceRoot, { recursive: true, force: true })
  }
})
