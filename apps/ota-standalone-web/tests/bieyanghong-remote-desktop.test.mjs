import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import {
  normalizeBieyanghongRemoteDesktopConfig,
  startBieyanghongRemoteDesktop,
} from '../../../tools/uat/bieyanghong-remote-desktop.mjs'

const existingExecutable = fileURLToPath(import.meta.url)
const defaultVncSocketPath = '/run/sifangguan-bieyanghong/vnc.sock'
const defaultAuthPath = '/run/sifangguan-bieyanghong/websockify.auth'
const defaultAuthPlugin = 'bieyanghong_websockify_auth.FileBasicHTTPAuth'

const enabledConfig = (overrides = {}) => ({
  enabled: true,
  vncSocketPath: defaultVncSocketPath,
  websockifyAuthPath: defaultAuthPath,
  websockifyAuthPlugin: defaultAuthPlugin,
  xvfbExecutable: existingExecutable,
  x11vncExecutable: existingExecutable,
  websockifyExecutable: existingExecutable,
  ...overrides,
})

const readinessProbes = ({
  display = ':92',
  vncSocketPath = defaultVncSocketPath,
  webSocketPort,
  onVncSocketReady = () => {},
}) => {
  const displaySocketPath = `/tmp/.X11-unix/X${display.slice(1)}`
  const displayCalls = new Map()
  const portCalls = new Map()
  return {
    displayCalls,
    portCalls,
    displaySocketReady: (path) => {
      const calls = (displayCalls.get(path) ?? 0) + 1
      displayCalls.set(path, calls)
      if (path === vncSocketPath) {
        onVncSocketReady(path)
        return true
      }
      assert.equal(path, displaySocketPath)
      return calls > 1
    },
    portProbe: async (port) => {
      const calls = (portCalls.get(port) ?? 0) + 1
      portCalls.set(port, calls)
      assert.equal(port, webSocketPort)
      return calls > 1
    },
    displaySocketPath,
  }
}

const runtimeFiles = ({ existing = [] } = {}) => {
  const files = new Map(existing.map(({ path, type }) => [path, { type }]))
  const calls = {
    createExclusive: [],
    chmod: [],
    inspect: [],
    unlink: [],
  }
  return {
    calls,
    files,
    markSocket: (path) => files.set(path, { type: 'socket' }),
    operations: {
      exists: (path) => files.has(path),
      createExclusive: (path, content) => {
        if (files.has(path)) throw new Error('exclusive create conflict')
        calls.createExclusive.push({ path, content })
        files.set(path, { type: 'file', content, mode: 0o600 })
      },
      chmod: (path, mode) => calls.chmod.push({ path, mode }),
      inspect: (path) => {
        calls.inspect.push(path)
        const type = files.get(path)?.type
        return {
          isSymbolicLink: () => false,
          isFile: () => type === 'file',
          isSocket: () => type === 'socket',
        }
      },
      unlink: (path) => {
        calls.unlink.push(path)
        files.delete(path)
      },
    },
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
    webSocketPort: 70_000,
    xvfbExecutable: null,
    x11vncExecutable: undefined,
    websockifyExecutable: null,
  }), {
    enabled: false,
    display: ':91',
    width: 1280,
    height: 800,
    webSocketPort: 6081,
    vncSocketPath: defaultVncSocketPath,
    websockifyAuthPath: defaultAuthPath,
    websockifyAuthPlugin: defaultAuthPlugin,
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

test('rejects an enabled configuration when a runtime is unavailable', () => {
  assert.throws(
    () => normalizeBieyanghongRemoteDesktopConfig({
      ...enabledConfig(),
      xvfbExecutable: `${existingExecutable}.does-not-exist`,
    }),
    { message: 'BIEYANGHONG_REMOTE_DESKTOP_RUNTIME_UNAVAILABLE' },
  )
})

test('rejects startup when a display, runtime file, or WebSocket port is in use', async (t) => {
  const config = enabledConfig({
    display: ':92',
    webSocketPort: 6082,
  })

  await t.test('occupied X display socket', async () => {
    let spawnCalls = 0
    await assert.rejects(
      startBieyanghongRemoteDesktop({
        config,
        displaySocketReady: () => true,
        runtimeFileOps: runtimeFiles().operations,
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

  for (const occupiedPath of [config.vncSocketPath, config.websockifyAuthPath]) {
    await t.test(`occupied runtime path ${occupiedPath}`, async () => {
      let spawnCalls = 0
      const files = runtimeFiles({
        existing: [{
          path: occupiedPath,
          type: occupiedPath.endsWith('.sock') ? 'socket' : 'file',
        }],
      })
      await assert.rejects(
        startBieyanghongRemoteDesktop({
          config,
          displaySocketReady: () => false,
          runtimeFileOps: files.operations,
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
  }

  await t.test(`occupied port ${config.webSocketPort}`, async () => {
    let spawnCalls = 0
    await assert.rejects(
      startBieyanghongRemoteDesktop({
        config,
        displaySocketReady: () => false,
        runtimeFileOps: runtimeFiles().operations,
        portProbe: async (port) => port === config.webSocketPort,
        spawnProcess: () => {
          spawnCalls += 1
          throw new Error('must not spawn')
        },
      }),
      { message: 'BIEYANGHONG_REMOTE_DESKTOP_RESOURCE_IN_USE' },
    )
    assert.equal(spawnCalls, 0)
  })
})

test('starts mocked processes and closes them in reverse launch order', async () => {
  const display = ':92'
  const webSocketPort = 6082
  const files = runtimeFiles()
  const probes = readinessProbes({
    display,
    webSocketPort,
    onVncSocketReady: files.markSocket,
  })
  const launchCalls = []
  const killCalls = []
  const randomBytesCalls = []
  const passwordBytes = Buffer.alloc(32, 0x5a)
  const expectedPassword = passwordBytes.toString('base64url')
  const expectedAuthorization = `Basic ${Buffer.from(
    `viewer:${expectedPassword}`,
    'latin1',
  ).toString('base64')}`

  const desktop = await startBieyanghongRemoteDesktop({
    config: enabledConfig({
      display,
      width: 1440,
      height: 900,
      webSocketPort,
    }),
    spawnProcess: (executable, args, options) => {
      const child = new MockChildProcess(`child-${launchCalls.length}`, killCalls)
      launchCalls.push({ executable, args, options, child })
      return child
    },
    portProbe: probes.portProbe,
    displaySocketReady: probes.displaySocketReady,
    runtimeFileOps: files.operations,
    randomBytesFactory: (size) => {
      randomBytesCalls.push(size)
      return passwordBytes
    },
  })

  assert.deepEqual({
    display: desktop.display,
    width: desktop.width,
    height: desktop.height,
    webSocketPort: desktop.webSocketPort,
    webSocketAuthorization: desktop.webSocketAuthorization,
  }, {
    display,
    width: 1440,
    height: 900,
    webSocketPort,
    webSocketAuthorization: expectedAuthorization,
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
  assert.deepEqual(launchCalls[1].args, [
    '-display',
    display,
    '-nopw',
    '-forever',
    '-noshared',
    '-repeat',
    '-noxdamage',
    '-unixsock',
    defaultVncSocketPath,
    '-rfbport',
    '0',
    '-quiet',
  ])
  assert.ok(!launchCalls[1].args.includes('-localhost'))
  assert.deepEqual(launchCalls[2].args, [
    '--heartbeat=30',
    `--auth-plugin=${defaultAuthPlugin}`,
    `--auth-source=${defaultAuthPath}`,
    `--unix-target=${defaultVncSocketPath}`,
    `127.0.0.1:${webSocketPort}`,
  ])
  assert.ok(!launchCalls[2].args.some((argument) =>
    /^127\.0\.0\.1:59\d+$/u.test(argument)))
  assert.equal(probes.displayCalls.get(probes.displaySocketPath), 2)
  assert.equal(probes.displayCalls.get(defaultVncSocketPath), 1)
  assert.equal(probes.portCalls.get(webSocketPort), 2)
  assert.deepEqual(randomBytesCalls, [32])
  assert.deepEqual(files.calls.createExclusive, [{
    path: defaultAuthPath,
    content: `viewer:${expectedPassword}\n`,
  }])
  assert.deepEqual(files.calls.chmod, [{
    path: defaultVncSocketPath,
    mode: 0o600,
  }])
  assert.ok(!launchCalls.flatMap(({ args }) => args).includes(expectedPassword))

  await desktop.close()
  assert.deepEqual(killCalls, [
    { name: 'child-2', signal: 'SIGTERM' },
    { name: 'child-1', signal: 'SIGTERM' },
    { name: 'child-0', signal: 'SIGTERM' },
  ])
  assert.equal(files.files.has(defaultAuthPath), false)
  assert.equal(files.files.has(defaultVncSocketPath), false)
  assert.deepEqual(new Set(files.calls.unlink), new Set([
    defaultAuthPath,
    defaultVncSocketPath,
  ]))
})

test('fails when a child process exits before its resource is ready', async () => {
  const display = ':92'
  const webSocketPort = 6082
  const files = runtimeFiles()
  const probes = readinessProbes({
    display,
    webSocketPort,
    onVncSocketReady: files.markSocket,
  })
  const killCalls = []
  let launchCount = 0

  await assert.rejects(
    startBieyanghongRemoteDesktop({
      config: enabledConfig({ display, webSocketPort }),
      spawnProcess: () => {
        const child = new MockChildProcess(`child-${launchCount}`, killCalls)
        launchCount += 1
        if (launchCount === 2) child.exitCode = 1
        return child
      },
      portProbe: probes.portProbe,
      displaySocketReady: probes.displaySocketReady,
      runtimeFileOps: files.operations,
      randomBytesFactory: () => Buffer.alloc(32, 0x31),
    }),
    { message: 'BIEYANGHONG_REMOTE_DESKTOP_CHILD_EXITED' },
  )

  assert.equal(launchCount, 2)
  assert.deepEqual(killCalls, [{ name: 'child-0', signal: 'SIGTERM' }])
  assert.equal(files.files.has(defaultAuthPath), false)
})

test('maps a mocked launch failure and cleans up previously started processes', async () => {
  const killCalls = []
  let launchCount = 0
  let displayProbeCalls = 0
  const files = runtimeFiles()

  await assert.rejects(
    startBieyanghongRemoteDesktop({
      config: enabledConfig({
        display: ':92',
        webSocketPort: 6082,
      }),
      spawnProcess: () => {
        launchCount += 1
        if (launchCount === 2) throw new Error('mocked spawn failure')
        return new MockChildProcess('xvfb', killCalls)
      },
      portProbe: async () => false,
      runtimeFileOps: files.operations,
      randomBytesFactory: () => Buffer.alloc(32, 0x32),
      displaySocketReady: () => {
        displayProbeCalls += 1
        return displayProbeCalls > 1
      },
    }),
    { message: 'BIEYANGHONG_REMOTE_DESKTOP_START_FAILED' },
  )

  assert.equal(launchCount, 2)
  assert.deepEqual(killCalls, [{ name: 'xvfb', signal: 'SIGTERM' }])
  assert.equal(files.files.has(defaultAuthPath), false)
})
