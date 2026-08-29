import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import {
  chmodSync,
  closeSync,
  existsSync,
  lstatSync,
  openSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { createConnection } from 'node:net'
import { once } from 'node:events'

const DEFAULTS = Object.freeze({
  display: ':91',
  width: 1280,
  height: 800,
  webSocketPort: 6081,
  vncSocketPath: '/run/sifangguan-bieyanghong/vnc.sock',
  websockifyAuthPath: '/run/sifangguan-bieyanghong/websockify.auth',
  websockifyAuthPlugin:
    'bieyanghong_websockify_auth.FileBasicHTTPAuth',
  xvfbExecutable: '/usr/bin/Xvfb',
  x11vncExecutable: '/usr/bin/x11vnc',
  websockifyExecutable: '/usr/bin/websockify',
})

const integerInRange = (value, fallback, minimum, maximum) => {
  const parsed = Number.parseInt(String(value ?? ''), 10)
  return Number.isInteger(parsed) && parsed >= minimum && parsed <= maximum
    ? parsed
    : fallback
}

export const normalizeBieyanghongRemoteDesktopConfig = (input = {}) => {
  const enabled = input.enabled === true
  const config = {
    enabled,
    display: typeof input.display === 'string' && /^:\d{1,3}$/u.test(input.display)
      ? input.display
      : DEFAULTS.display,
    width: integerInRange(input.width, DEFAULTS.width, 960, 1920),
    height: integerInRange(input.height, DEFAULTS.height, 640, 1200),
    webSocketPort: integerInRange(
      input.webSocketPort,
      DEFAULTS.webSocketPort,
      1024,
      65535,
    ),
    vncSocketPath:
      typeof input.vncSocketPath === 'string'
      && /^\/run\/sifangguan-bieyanghong\/[A-Za-z0-9_.-]+\.sock$/u
        .test(input.vncSocketPath)
        ? input.vncSocketPath
        : DEFAULTS.vncSocketPath,
    websockifyAuthPath:
      typeof input.websockifyAuthPath === 'string'
      && /^\/run\/sifangguan-bieyanghong\/[A-Za-z0-9_.-]+\.auth$/u
        .test(input.websockifyAuthPath)
        ? input.websockifyAuthPath
        : DEFAULTS.websockifyAuthPath,
    websockifyAuthPlugin:
      input.websockifyAuthPlugin === DEFAULTS.websockifyAuthPlugin
        ? input.websockifyAuthPlugin
        : DEFAULTS.websockifyAuthPlugin,
    xvfbExecutable: input.xvfbExecutable ?? DEFAULTS.xvfbExecutable,
    x11vncExecutable: input.x11vncExecutable ?? DEFAULTS.x11vncExecutable,
    websockifyExecutable:
      input.websockifyExecutable ?? DEFAULTS.websockifyExecutable,
  }
  if (enabled) {
    for (const executable of [
      config.xvfbExecutable,
      config.x11vncExecutable,
      config.websockifyExecutable,
    ]) {
      if (typeof executable !== 'string' || !existsSync(executable)) {
        throw new Error('BIEYANGHONG_REMOTE_DESKTOP_RUNTIME_UNAVAILABLE')
      }
    }
  }
  return config
}

const delay = (milliseconds) => new Promise((resolve) => {
  const timer = setTimeout(resolve, milliseconds)
  timer.unref?.()
})

const portAccepting = (port) => new Promise((resolve) => {
  const socket = createConnection({ host: '127.0.0.1', port })
  let settled = false
  const done = (value) => {
    if (settled) return
    settled = true
    socket.destroy()
    resolve(value)
  }
  socket.setTimeout(300, () => done(false))
  socket.once('connect', () => done(true))
  socket.once('error', () => done(false))
})

const assertChildRunning = (child, childFailures) => {
  if (
    childFailures.get(child)
    || child.exitCode !== null
    || child.signalCode !== null
  ) {
    throw new Error('BIEYANGHONG_REMOTE_DESKTOP_CHILD_EXITED')
  }
}

const waitForDisplay = async ({
  child,
  childFailures,
  displaySocketReady,
  displaySocketPath,
  timeoutMs = 5_000,
}) => {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    assertChildRunning(child, childFailures)
    if (displaySocketReady(displaySocketPath)) return
    await delay(100)
  }
  throw new Error('BIEYANGHONG_REMOTE_DESKTOP_START_TIMEOUT')
}

const waitForPort = async ({
  child,
  childFailures,
  port,
  portProbe,
  timeoutMs = 5_000,
}) => {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    assertChildRunning(child, childFailures)
    if (await portProbe(port)) return
    await delay(100)
  }
  throw new Error('BIEYANGHONG_REMOTE_DESKTOP_START_TIMEOUT')
}

const stopProcess = async (child) => {
  if (!child || child.exitCode !== null || child.signalCode !== null) return
  child.kill('SIGTERM')
  await Promise.race([once(child, 'exit'), delay(1_500)]).catch(() => {})
  if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
}

const defaultRuntimeFileOps = Object.freeze({
  exists: existsSync,
  createExclusive(path, content) {
    const descriptor = openSync(path, 'wx', 0o600)
    let failure = null
    try {
      writeFileSync(descriptor, content, 'utf8')
    } catch (error) {
      failure = error
    }
    try {
      closeSync(descriptor)
    } catch (error) {
      failure ??= error
    }
    if (failure) {
      if (existsSync(path)) unlinkSync(path)
      throw failure
    }
  },
  chmod: chmodSync,
  inspect: lstatSync,
  unlink: unlinkSync,
})

const unlinkRuntimeFile = (path, allowedType, runtimeFileOps) => {
  if (!runtimeFileOps.exists(path)) return
  const stats = runtimeFileOps.inspect(path)
  if (
    stats.isSymbolicLink()
    || (allowedType === 'file' && !stats.isFile())
    || (allowedType === 'socket' && !stats.isSocket())
  ) {
    throw new Error('BIEYANGHONG_REMOTE_DESKTOP_RUNTIME_PATH_UNSAFE')
  }
  runtimeFileOps.unlink(path)
}

export const startBieyanghongRemoteDesktop = async ({
  config: inputConfig,
  spawnProcess = spawn,
  portProbe = portAccepting,
  displaySocketReady = existsSync,
  runtimeFileOps = defaultRuntimeFileOps,
  randomBytesFactory = randomBytes,
} = {}) => {
  const config = normalizeBieyanghongRemoteDesktopConfig(inputConfig)
  if (!config.enabled) return null
  const processes = []
  const childFailures = new WeakMap()
  let authFileCreated = false
  let vncSocketCreated = false
  const launch = (executable, args) => {
    const child = spawnProcess(executable, args, {
      stdio: 'ignore',
      windowsHide: true,
    })
    child.once?.('error', (error) => childFailures.set(child, error))
    processes.push(child)
    return child
  }
  const close = async () => {
    for (const child of [...processes].reverse()) await stopProcess(child)
    if (vncSocketCreated) {
      unlinkRuntimeFile(config.vncSocketPath, 'socket', runtimeFileOps)
      vncSocketCreated = false
    }
    if (authFileCreated) {
      unlinkRuntimeFile(config.websockifyAuthPath, 'file', runtimeFileOps)
      authFileCreated = false
    }
  }
  try {
    const displayNumber = config.display.slice(1)
    const displaySocketPath = `/tmp/.X11-unix/X${displayNumber}`
    if (
      displaySocketReady(displaySocketPath)
      || runtimeFileOps.exists(config.vncSocketPath)
      || runtimeFileOps.exists(config.websockifyAuthPath)
      || await portProbe(config.webSocketPort)
    ) {
      throw new Error('BIEYANGHONG_REMOTE_DESKTOP_RESOURCE_IN_USE')
    }
    const xvfb = launch(config.xvfbExecutable, [
      config.display,
      '-screen',
      '0',
      `${config.width}x${config.height}x24`,
      '-nolisten',
      'tcp',
      '-noreset',
    ])
    await waitForDisplay({
      child: xvfb,
      childFailures,
      displaySocketReady,
      displaySocketPath,
    })
    let webSocketPassword = randomBytesFactory(32).toString('base64url')
    let webSocketAuthorization = `Basic ${Buffer.from(
      `viewer:${webSocketPassword}`,
      'latin1',
    ).toString('base64')}`
    runtimeFileOps.createExclusive(
      config.websockifyAuthPath,
      `viewer:${webSocketPassword}\n`,
    )
    webSocketPassword = null
    authFileCreated = true
    const x11vnc = launch(config.x11vncExecutable, [
      '-display',
      config.display,
      '-nopw',
      '-forever',
      '-noshared',
      '-repeat',
      '-noxdamage',
      '-unixsock',
      config.vncSocketPath,
      '-rfbport',
      '0',
      '-quiet',
    ])
    vncSocketCreated = true
    await waitForDisplay({
      child: x11vnc,
      childFailures,
      displaySocketReady,
      displaySocketPath: config.vncSocketPath,
    })
    runtimeFileOps.chmod(config.vncSocketPath, 0o600)
    const websockify = launch(config.websockifyExecutable, [
      '--heartbeat=30',
      `--auth-plugin=${config.websockifyAuthPlugin}`,
      `--auth-source=${config.websockifyAuthPath}`,
      `--unix-target=${config.vncSocketPath}`,
      `127.0.0.1:${config.webSocketPort}`,
    ])
    await waitForPort({
      child: websockify,
      childFailures,
      port: config.webSocketPort,
      portProbe,
    })
    unlinkRuntimeFile(config.websockifyAuthPath, 'file', runtimeFileOps)
    authFileCreated = false
    return {
      display: config.display,
      width: config.width,
      height: config.height,
      webSocketPort: config.webSocketPort,
      webSocketAuthorization,
      close,
    }
  } catch (error) {
    await close()
    if (String(error?.message ?? '').startsWith('BIEYANGHONG_')) throw error
    throw new Error('BIEYANGHONG_REMOTE_DESKTOP_START_FAILED')
  }
}
