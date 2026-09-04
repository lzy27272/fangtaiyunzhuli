import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import {
  createTrustedDeviceLocalStateStore,
} from '../../../tools/trusted-device/trusted-device-local-state.mjs'

const moduleUrl = new URL(
  '../../../tools/trusted-device/trusted-device-local-state.mjs',
  import.meta.url,
).href

const candidate = ({ deviceId, enrolledAt }) => ({
  schemaVersion: 1,
  hotelCode: '001',
  serverOrigin: 'https://example.invalid',
  deviceId,
  label: 'synthetic device',
  privateKeyPem: `synthetic-private-${deviceId}`,
  scopeProofKey: Buffer.alloc(32, deviceId === 'device-a' ? 1 : 2)
    .toString('base64url'),
  localHmacSecret: Buffer.alloc(32, 7).toString('base64url'),
  chromeProfilePath: 'synthetic-profile',
  snapshotPath: 'synthetic-snapshots',
  lastCollectionSlot: null,
  enrolledAt,
})

const mergeInChild = async ({ path, deviceId, version, key, value }) => {
  const script = [
    "const { createTrustedDeviceLocalStateStore } = await import(process.env.MODULE_URL)",
    "const store = createTrustedDeviceLocalStateStore({ path: process.env.STATE_PATH, hotelCode: '001' })",
    'const result = store.mergeForDevice({',
    '  deviceId: process.env.DEVICE_ID,',
    '  expectedStateVersion: Number(process.env.STATE_VERSION),',
    '  patch: { [process.env.PATCH_KEY]: process.env.PATCH_VALUE },',
    '})',
    'if (!result.updated) process.exit(3)',
  ].join('\n')
  const child = spawn(process.execPath, ['--input-type=module', '--eval', script], {
    env: {
      ...process.env,
      MODULE_URL: moduleUrl,
      STATE_PATH: path,
      DEVICE_ID: deviceId,
      STATE_VERSION: String(version),
      PATCH_KEY: key,
      PATCH_VALUE: value,
    },
    stdio: 'ignore',
  })
  const [code] = await once(child, 'exit')
  assert.equal(code, 0)
}

test('trusted device local state serializes concurrent field merges and rejects stale devices', async () => {
  const root = await mkdtemp(join(os.tmpdir(), 'trusted-local-state-'))
  const path = join(root, 'device-state.json')
  try {
    const store = createTrustedDeviceLocalStateStore({
      path,
      hotelCode: '001',
    })
    const installedA = store.installEnrollment(candidate({
      deviceId: 'device-a',
      enrolledAt: '2026-09-01T01:00:00.000Z',
    }))
    assert.equal(installedA.updated, true)
    const staleA = installedA.state
    const installedB = store.installEnrollment(candidate({
      deviceId: 'device-b',
      enrolledAt: '2026-09-01T01:01:00.000Z',
    }))
    assert.equal(installedB.updated, true)
    assert.equal(
      installedB.state.localHmacSecret,
      installedA.state.localHmacSecret,
    )
    const staleWrite = store.mergeForDevice({
      deviceId: staleA.deviceId,
      expectedStateVersion: staleA.stateVersion,
      patch: { lastCollectionSlot: 'stale-slot' },
    })
    assert.equal(staleWrite.updated, false)
    assert.equal(staleWrite.reason, 'DEVICE_CHANGED')

    for (let iteration = 0; iteration < 5; iteration += 1) {
      const current = store.read()
      await Promise.all([
        mergeInChild({
          path,
          deviceId: current.deviceId,
          version: current.stateVersion,
          key: 'pseudonymKey',
          value: `pseudonym-${iteration}`,
        }),
        mergeInChild({
          path,
          deviceId: current.deviceId,
          version: current.stateVersion,
          key: 'lastCollectionSlot',
          value: `slot-${iteration}`,
        }),
      ])
      const merged = store.read()
      assert.equal(merged.deviceId, 'device-b')
      assert.equal(merged.privateKeyPem, 'synthetic-private-device-b')
      assert.equal(merged.pseudonymKey, `pseudonym-${iteration}`)
      assert.equal(merged.lastCollectionSlot, `slot-${iteration}`)
    }

    const olderEnrollment = store.installEnrollment(candidate({
      deviceId: 'device-a',
      enrolledAt: '2026-09-01T01:00:30.000Z',
    }))
    assert.equal(olderEnrollment.updated, false)
    assert.equal(store.read().deviceId, 'device-b')
    assert.doesNotMatch(await readFile(path, 'utf8'), /stale-slot/u)

    const beforeRunStatus = store.read()
    const runStatus = store.mergeForDevice({
      deviceId: beforeRunStatus.deviceId,
      expectedStateVersion: beforeRunStatus.stateVersion,
      patch: {
        consecutiveCollectionFailures: 1,
        lastCollectionAttemptAt: '2026-09-01T01:02:00.000Z',
        lastCollectionAttemptSlot: '2026-09-01T09:00',
        lastCollectionAttemptStatus: 'FAILED',
        lastCollectionErrorCode: 'TRUSTED_DEVICE_OFFICIAL_BROWSER_NOT_RUNNING',
      },
    })
    assert.equal(runStatus.updated, true)
    assert.equal(runStatus.state.consecutiveCollectionFailures, 1)
    assert.equal(runStatus.state.lastCollectionAttemptStatus, 'FAILED')
    assert.equal(
      runStatus.state.lastCollectionErrorCode,
      'TRUSTED_DEVICE_OFFICIAL_BROWSER_NOT_RUNNING',
    )
    assert.equal(runStatus.state.privateKeyPem, 'synthetic-private-device-b')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('agent state writes use locked device-scoped merges', async () => {
  const agentPath = new URL(
    '../../../tools/trusted-device/trusted-device-agent.mjs',
    import.meta.url,
  )
  const source = await readFile(agentPath, 'utf8')
  assert.match(source, /installEnrollment\(next\)/u)
  assert.match(source, /mergeCurrentDeviceState/u)
  assert.doesNotMatch(source, /atomicWrite\(statePath/u)
})
