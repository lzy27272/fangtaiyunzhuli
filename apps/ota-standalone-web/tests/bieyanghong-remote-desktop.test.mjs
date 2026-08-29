import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import {
  normalizeBieyanghongRemoteDesktopConfig,
  startBieyanghongRemoteDesktop,
} from '../../../tools/uat/bieyanghong-remote-desktop.mjs'

const existingExecutable = fileURLToPath(import.meta.url)

const enabledConfig = (overrides = {}) => ({
  enabled: true,
  xvfbExecutable: existingExecutable,
  x11vncExecutable: existingExecutable,
  websockifyExecutable: existingExecutable,
  ...overrides,
})

const readinessProbes = ({ display = ':92', vncPort, webSocketPort }) => {
  const displaySocketPath = `/tmp/.X11-unix/X${display.slice(1)}`
  const displayCalls = []
  const portCalls = new Map()
  return {
    displayCalls,
    portCalls,
    displaySocketReady: (path) => {
      displayCalls.push(path)
      return displayCalls.length > 1
    },
    portProbe: async (port) => {
      const calls = (portCalls.get(port) ?? 0) + 1
      portCalls.set(port, calls)
      assert.ok(port === vncPort || port === webSocketPort)
      return calls > 1
    },
    displaySocketPath,
  }
}

class MockChildProcess extends EventEmitter {
  constructor(name, killCalls) {
    super()
    this.name = name
    this.killCalls = killCalls
    this.exitCode = null
    this.signalCode = null
  }

  kill(signal) {
    this.killCalls.push({ name: this.name, signal })
    this.signalCode = signal
    queueMicrotask(() => this.emit('exit', null, signal))
    return true
  }
}

test('normalizes the disabled remote desktop configuration to safe defaults', () => {
  assert.deepEqual(normalizeBieyanghongRemoteDesktopConfig({
    display: ':1234',
    width: 959,
    height: 1201,
    vncPort: 80,
    webSocketPort: 70_000,
    xvfbExecutable: null,
    x11vncExecutable: undefined,
    websockifyExecutable: null,
  }), {
    enabled: false,
    display: ':91',
    width: 1280,
    height: 800,
    vncPort: 5901,
    webSocketPort: 6081,
    xvfbExecutable: '/usr/bin/Xvfb',
    x11vncExecutable: '/usr/bin/x11vnc',
    websockifyExecutable: '/usr/bin/websockify',
  })
})

test('returns null without checking runtimes or spawning when disabled', async () => {
  let spawnCalls = 0
  const result = await startBieyanghongRemoteDesktop({
    config: {
      enabled: false,
      xvfbExecutable: 'missing-xvfb',
      x11vncExecutable: 'missing-x11vnc',
      websockifyExecutable: 'missing-websockify',
    },
    spawnProcess: () => {
      spawnCalls += 1
      throw new Error('must not spawn')
    },
    portProbe: async () => {
      throw new Error('must not probe ports')
    },
    displaySocketReady: () => {
      throw new Error('must not probe the display socket')
    },
  })

  assert.equal(result, null)
  assert.equal(spawnCalls, 0)
})

test('rejects a conflicting VNC and WebSocket port', () => {
  assert.throws(
    () => normalizeBieyanghongRemoteDesktopConfig({
      vncPort: 6201,
      webSocketPort: '6201',
    }),
    { message: 'BIEYANGHONG_REMOTE_DESKTOP_PORT_CONFLICT' },
  )
})

test('rejects an enabled configuration when a runtime is unavailable', () => {
  assert.throws(
    () => normalizeBieyanghongRemoteDesktopConfig({
      ...enabledConfig(),
      xvfbExecutable: `${existingExecutable}.does-not-exist`,
    }),
    { message: 'BIEYANGHONG_REMOTE_DESKTOP_RUNTIME_UNAVAILABLE' },
  )
})

test('rejects startup when a display socket or port is already in use', async (t) => {
  const config = enabledConfig({
    display: ':92',
    vncPort: 5902,
    webSocketPort: 6082,
  })

  await t.test('occupied X display socket', async () => {
    let spawnCalls = 0
    await assert.rejects(
      startBieyanghongRemoteDesktop({
        config,
        displaySocketReady: () => true,
        portProbe: async () => {
          throw new Error('port probe must be short-circuited')
        },
        spawnProcess: () => {
          spawnCalls += 1
          throw new Error('must not spawn')
        },
      }),
      { message: 'BIEYANGHONG_REMOTE_DESKTOP_RESOURCE_IN_USE' },
    )
    assert.equal(spawnCalls, 0)
  })

  for (const occupiedPort of [config.vncPort, config.webSocketPort]) {
    await t.test(`occupied port ${occupiedPort}`, async () => {
      let spawnCalls = 0
      await assert.rejects(
        startBieyanghongRemoteDesktop({
          config,
          displaySocketReady: () => false,
          portProbe: async (port) => port === occupiedPort,
          spawnProcess: () => {
            spawnCalls += 1
            throw new Error('must not spawn')
          },
        }),
        { message: 'BIEYANGHONG_REMOTE_DESKTOP_RESOURCE_IN_USE' },
      )
      assert.equal(spawnCalls, 0)
    })
  }
})

test('starts mocked processes and closes them in reverse launch order', async () => {
  const display = ':92'
  const vncPort = 5902
  const webSocketPort = 6082
  const probes = readinessProbes({ display, vncPort, webSocketPort })
  const launchCalls = []
  const killCalls = []

  const desktop = await startBieyanghongRemoteDesktop({
    config: enabledConfig({
      display,
      width: 1440,
      height: 900,
      vncPort,
      webSocketPort,
    }),
    spawnProcess: (executable, args, options) => {
      const child = new MockChildProcess(`child-${launchCalls.length}`, killCalls)
      launchCalls.push({ executable, args, options, child })
      return child
    },
    portProbe: probes.portProbe,
    displaySocketReady: probes.displaySocketReady,
  })

  assert.deepEqual({
    display: desktop.display,
    width: desktop.width,
    height: desktop.height,
    webSocketPort: desktop.webSocketPort,
  }, {
    display,
    width: 1440,
    height: 900,
    webSocketPort,
  })
  assert.equal(launchCalls.length, 3)
  assert.deepEqual(launchCalls.map(({ options }) => options), [
    { stdio: 'ignore', windowsHide: true },
    { stdio: 'ignore', windowsHide: true },
    { stdio: 'ignore', windowsHide: true },
  ])
  assert.deepEqual(launchCalls[0].args, [
    display,
    '-screen',
    '0',
    '1440x900x24',
    '-nolisten',
    'tcp',
    '-noreset',
  ])
  assert.ok(launchCalls[1].args.includes('-noshared'))
  assert.ok(!launchCalls[1].args.includes('-shared'))
  assert.equal(launchCalls[1].args.at(-2), String(vncPort))
  assert.deepEqual(launchCalls[2].args, [
    '--heartbeat=30',
    `127.0.0.1:${webSocketPort}`,
    `127.0.0.1:${vncPort}`,
  ])
  assert.deepEqual(probes.displayCalls, [
    probes.displaySocketPath,
    probes.displaySocketPath,
  ])
  assert.equal(probes.portCalls.get(vncPort), 2)
  assert.equal(probes.portCalls.get(webSocketPort), 2)

  await desktop.close()
  assert.deepEqual(killCalls, [
    { name: 'child-2', signal: 'SIGTERM' },
    { name: 'child-1', signal: 'SIGTERM' },
    { name: 'child-0', signal: 'SIGTERM' },
  ])
})

test('fails when a child process exits before its resource is ready', async () => {
  const display = ':92'
  const vncPort = 5902
  const webSocketPort = 6082
  const probes = readinessProbes({ display, vncPort, webSocketPort })
  const killCalls = []
  let launchCount = 0

  await assert.rejects(
    startBieyanghongRemoteDesktop({
      config: enabledConfig({ display, vncPort, webSocketPort }),
      spawnProcess: () => {
        const child = new MockChildProcess(`child-${launchCount}`, killCalls)
        launchCount += 1
        if (launchCount === 2) child.exitCode = 1
        return child
      },
      portProbe: probes.portProbe,
      displaySocketReady: probes.displaySocketReady,
    }),
    { message: 'BIEYANGHONG_REMOTE_DESKTOP_CHILD_EXITED' },
  )

  assert.equal(launchCount, 2)
  assert.deepEqual(killCalls, [{ name: 'child-0', signal: 'SIGTERM' }])
})

test('maps a mocked launch failure and cleans up previously started processes', async () => {
  const killCalls = []
  let launchCount = 0
  let displayProbeCalls = 0

  await assert.rejects(
    startBieyanghongRemoteDesktop({
      config: enabledConfig({
        display: ':92',
        vncPort: 5902,
        webSocketPort: 6082,
      }),
      spawnProcess: () => {
        launchCount += 1
        if (launchCount === 2) throw new Error('mocked spawn failure')
        return new MockChildProcess('xvfb', killCalls)
      },
      portProbe: async () => false,
      displaySocketReady: () => {
        displayProbeCalls += 1
        return displayProbeCalls > 1
      },
    }),
    { message: 'BIEYANGHONG_REMOTE_DESKTOP_START_FAILED' },
  )

  assert.equal(launchCount, 2)
  assert.deepEqual(killCalls, [{ name: 'xvfb', signal: 'SIGTERM' }])
})
