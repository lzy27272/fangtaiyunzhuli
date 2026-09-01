import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { dirname } from 'node:path'

const LOCK_TIMEOUT_MS = 5_000
const STALE_LOCK_MS = 30_000
const LOCK_POLL_MS = 25
const waitArray = new Int32Array(new SharedArrayBuffer(4))

const stateVersionFor = (state) =>
  Number.isInteger(state?.stateVersion) && state.stateVersion >= 0
    ? state.stateVersion
    : 0

const atomicWrite = (path, value) => {
  mkdirSync(dirname(path), { recursive: true })
  const temporaryPath = `${path}.${process.pid}.tmp`
  writeFileSync(
    temporaryPath,
    `${JSON.stringify(value, null, 2)}\n`,
    { encoding: 'utf8', mode: 0o600 },
  )
  renameSync(temporaryPath, path)
}

const readJson = (path) => {
  if (!existsSync(path)) return null
  return JSON.parse(readFileSync(path, 'utf8'))
}

const acquireLock = (lockPath, {
  timeoutMs = LOCK_TIMEOUT_MS,
  staleLockMs = STALE_LOCK_MS,
} = {}) => {
  const deadline = Date.now() + timeoutMs
  mkdirSync(dirname(lockPath), { recursive: true })
  while (Date.now() <= deadline) {
    try {
      const descriptor = openSync(lockPath, 'wx', 0o600)
      writeFileSync(descriptor, `${process.pid}\n`, 'utf8')
      return descriptor
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error
      try {
        if (Date.now() - statSync(lockPath).mtimeMs > staleLockMs) {
          unlinkSync(lockPath)
          continue
        }
      } catch (statError) {
        if (statError?.code !== 'ENOENT') throw statError
        continue
      }
      Atomics.wait(waitArray, 0, 0, LOCK_POLL_MS)
    }
  }
  throw new Error('TRUSTED_DEVICE_LOCAL_STATE_LOCK_TIMEOUT')
}

const withLock = (path, callback, options) => {
  const lockPath = `${path}.lock`
  const descriptor = acquireLock(lockPath, options)
  try {
    return callback()
  } finally {
    closeSync(descriptor)
    try {
      unlinkSync(lockPath)
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error
    }
  }
}

export const createTrustedDeviceLocalStateStore = ({
  path,
  hotelCode,
  lockOptions = {},
}) => {
  if (
    typeof path !== 'string'
    || path.length < 1
    || typeof hotelCode !== 'string'
    || !/^[A-Z0-9][A-Z0-9_-]{0,15}$/u.test(hotelCode)
  ) throw new Error('TRUSTED_DEVICE_LOCAL_STATE_STORE_INVALID')

  const read = () => readJson(path)

  const installEnrollment = (candidate) => withLock(path, () => {
    const current = readJson(path)
    if (
      current?.hotelCode === hotelCode
      && current.deviceId !== candidate.deviceId
      && typeof current.enrolledAt === 'string'
      && typeof candidate.enrolledAt === 'string'
      && current.enrolledAt.localeCompare(candidate.enrolledAt) >= 0
    ) return { updated: false, reason: 'NEWER_ENROLLMENT_PRESENT', state: current }
    const reusableLocalHmacSecret =
      current?.hotelCode === hotelCode
      && typeof current.localHmacSecret === 'string'
      && Buffer.from(current.localHmacSecret, 'base64url').length === 32
        ? current.localHmacSecret
        : candidate.localHmacSecret
    const next = {
      ...candidate,
      localHmacSecret: reusableLocalHmacSecret,
      stateVersion: stateVersionFor(current) + 1,
    }
    atomicWrite(path, next)
    return { updated: true, reason: null, state: next }
  }, lockOptions)

  const mergeForDevice = ({
    deviceId,
    expectedStateVersion = 0,
    patch,
  }) => withLock(path, () => {
    const current = readJson(path)
    if (!current || current.deviceId !== deviceId) {
      return { updated: false, reason: 'DEVICE_CHANGED', state: current }
    }
    const currentVersion = stateVersionFor(current)
    if (
      !Number.isInteger(expectedStateVersion)
      || expectedStateVersion < 0
      || currentVersion < expectedStateVersion
    ) throw new Error('TRUSTED_DEVICE_LOCAL_STATE_VERSION_INVALID')
    if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
      throw new Error('TRUSTED_DEVICE_LOCAL_STATE_PATCH_INVALID')
    }
    const next = {
      ...current,
      ...patch,
      stateVersion: currentVersion + 1,
    }
    atomicWrite(path, next)
    return { updated: true, reason: null, state: next }
  }, lockOptions)

  return { read, installEnrollment, mergeForDevice }
}
