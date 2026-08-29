import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { createConnection } from 'node:net'
import { once } from 'node:events'

const DEFAULTS = Object.freeze({
  display: ':91',
  width: 1280,
  height: 800,
  vncPort: 5901,
  webSocketPort: 6081,
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
    vncPort: integerInRange(input.vncPort, DEFAULTS.vncPort, 1024, 65535),
    webSocketPort: integerInRange(
      input.webSocketPort,
      DEFAULTS.webSocketPort,
      1024,
      65535,
    ),
    xvfbExecutable: input.xvfbExecutable ?? DEFAULTS.xvfbExecutable,
    x11vncExecutable: input.x11vncExecutable ?? DEFAULTS.x11vncExecutable,
    websockifyExecutable:
      input.websockifyExecutable ?? DEFAULTS.websockifyExecutable,
  }
  if (config.vncPort === config.webSocketPort) {
    throw new Error('BIEYANGHONG_REMOTE_DESKTOP_PORT_CONFLICT')
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

export const startBieyanghongRemoteDesktop = async ({
  config: inputConfig,
  spawnProcess = spawn,
  portProbe = portAccepting,
  displaySocketReady = existsSync,
} = {}) => {
  const config = normalizeBieyanghongRemoteDesktopConfig(inputConfig)
  if (!config.enabled) return null
  const processes = []
  const childFailures = new WeakMap()
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
  }
  try {
    const displayNumber = config.display.slice(1)
    const displaySocketPath = `/tmp/.X11-unix/X${displayNumber}`
    if (
      displaySocketReady(displaySocketPath)
      || await portProbe(config.vncPort)
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
    const x11vnc = launch(config.x11vncExecutable, [
      '-display',
      config.display,
      '-localhost',
      '-nopw',
      '-forever',
      '-noshared',
      '-repeat',
      '-noxdamage',
      '-rfbport',
      String(config.vncPort),
      '-quiet',
    ])
    await waitForPort({
      child: x11vnc,
      childFailures,
      port: config.vncPort,
      portProbe,
    })
    const websockify = launch(config.websockifyExecutable, [
      '--heartbeat=30',
      `127.0.0.1:${config.webSocketPort}`,
      `127.0.0.1:${config.vncPort}`,
    ])
    await waitForPort({
      child: websockify,
      childFailures,
      port: config.webSocketPort,
      portProbe,
    })
    return {
      display: config.display,
      width: config.width,
      height: config.height,
      webSocketPort: config.webSocketPort,
      close,
    }
  } catch (error) {
    await close()
    if (String(error?.message ?? '').startsWith('BIEYANGHONG_')) throw error
    throw new Error('BIEYANGHONG_REMOTE_DESKTOP_START_FAILED')
  }
}
