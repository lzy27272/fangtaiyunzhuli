import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import process from 'node:process'
import test, { mock } from 'node:test'

const moduleMocksAvailable = typeof mock.module === 'function'
const brokerSecret = 'S'.repeat(48)
const socketPath = '/run/sifangguan-test/browser-broker.sock'
const webSocketAuthorization = `Basic ${Buffer.from(
  `viewer:${'A'.repeat(43)}`,
  'latin1',
).toString('base64')}`

const setBrokerEnvironment = () => {
  const previous = new Map([
    ['BIEYANGHONG_BROWSER_BROKER_ENABLED', process.env.BIEYANGHONG_BROWSER_BROKER_ENABLED],
    ['BIEYANGHONG_BROWSER_BROKER_SOCKET_PATH', process.env.BIEYANGHONG_BROWSER_BROKER_SOCKET_PATH],
    ['BIEYANGHONG_BROWSER_BROKER_SECRET', process.env.BIEYANGHONG_BROWSER_BROKER_SECRET],
    ['BIEYANGHONG_BROWSER_PROFILE_ROOT', process.env.BIEYANGHONG_BROWSER_PROFILE_ROOT],
    ['BIEYANGHONG_REMOTE_DESKTOP_WEBSOCKET_PORT', process.env.BIEYANGHONG_REMOTE_DESKTOP_WEBSOCKET_PORT],
  ])
  process.env.BIEYANGHONG_BROWSER_BROKER_ENABLED = 'true'
  process.env.BIEYANGHONG_BROWSER_BROKER_SOCKET_PATH = socketPath
  process.env.BIEYANGHONG_BROWSER_BROKER_SECRET = brokerSecret
  process.env.BIEYANGHONG_BROWSER_PROFILE_ROOT = '/var/lib/sifangguan-login/hotel-001'
  process.env.BIEYANGHONG_REMOTE_DESKTOP_WEBSOCKET_PORT = '6081'
  return () => {
    for (const [name, value] of previous) {
      if (value === undefined) delete process.env[name]
      else process.env[name] = value
    }
  }
}

const fakeHttpRequest = ({ calls, route }) => (options, onResponse) => {
  const request = new EventEmitter()
  let timeoutHandler = null
  let destroyed = false
  request.setTimeout = (_milliseconds, handler) => {
    timeoutHandler = handler
    return request
  }
  request.destroy = (error) => {
    if (destroyed) return request
    destroyed = true
    queueMicrotask(() => request.emit('error', error))
    return request
  }
  request.end = (payload) => {
    calls.push({ options, body: JSON.parse(String(payload || '{}')) })
    const result = route({ options, body: calls.at(-1).body })
    if (result.timeout) {
      queueMicrotask(() => timeoutHandler())
      return request
    }
    queueMicrotask(() => {
      if (destroyed) return
      const response = new EventEmitter()
      response.statusCode = result.statusCode ?? 200
      onResponse(response)
      const content = Buffer.from(JSON.stringify(result.body))
      response.emit('data', content)
      response.emit('end')
    })
    return request
  }
  return request
}

const invokeBrokerHandler = ({ handler, authorization, url, body = {} }) =>
  new Promise((resolve, reject) => {
    const request = new EventEmitter()
    request.method = 'POST'
    request.url = url
    request.headers = { authorization }
    const response = {
      statusCode: null,
      headers: null,
      writeHead(statusCode, headers) {
        this.statusCode = statusCode
        this.headers = headers
      },
      end(content) {
        try {
          resolve({
            statusCode: this.statusCode,
            headers: this.headers,
            body: JSON.parse(String(content)),
          })
        } catch (error) {
          reject(error)
        }
      },
    }
    Promise.resolve(handler(request, response)).catch(reject)
    queueMicrotask(() => {
      const content = JSON.stringify(body)
      if (content !== '{}') request.emit('data', Buffer.from(content))
      request.emit('end')
    })
  })

test('broker client authenticates fake socket requests and enforces close/timeout', {
  skip: !moduleMocksAvailable && 'requires --experimental-test-module-mocks',
}, async () => {
  const restoreEnvironment = setBrokerEnvironment()
  const calls = []
  const sessionId = '11111111-1111-4111-8111-111111111111'
  let startCalls = 0
  let detectCalls = 0
  const fsMock = mock.module('node:fs', {
    exports: { existsSync: (path) => path === socketPath },
  })
  const httpMock = mock.module('node:http', {
    exports: {
      request: fakeHttpRequest({
        calls,
        route: ({ options, body }) => {
          assert.equal(options.socketPath, socketPath)
          assert.equal(options.method, 'POST')
          assert.equal(options.headers.authorization, `Broker ${brokerSecret}`)
          if (options.path === '/session/start') {
            startCalls += 1
            if (startCalls === 3) return { timeout: true }
            return {
              statusCode: 201,
              body: {
                data: {
                  sessionId,
                  alreadyAuthenticated: false,
                  cookieHeader: null,
                  remoteDesktop: {
                    width: 1280,
                    height: 800,
                    webSocketPort: startCalls === 2 ? 6082 : 6081,
                    webSocketAuthorization,
                  },
                },
              },
            }
          }
          if (options.path === '/session/detect') {
            assert.deepEqual(body, { sessionId })
            detectCalls += 1
            return detectCalls === 1
              ? { body: { data: { authenticated: false } } }
              : {
                  body: {
                    data: {
                      authenticated: true,
                      cookieHeader: 'session=fake-detected',
                    },
                  },
                }
          }
          if (options.path === '/session/close') {
            assert.deepEqual(body, { sessionId })
            return { body: { data: { closed: true } } }
          }
          throw new Error(`unexpected fake route ${options.path}`)
        },
      }),
    },
  })

  try {
    const client = await import(
      `../../../tools/uat/bieyanghong-browser-broker-client.mjs?test=${Date.now()}`
    )
    assert.equal(client.bieyanghongBrowserBrokerReady(), true)
    const login = await client.startBieyanghongBrokeredLogin()
    assert.equal(login.alreadyAuthenticated, false)
    assert.equal(login.cookieHeader, null)
    assert.deepEqual(login.remoteDesktop, {
      width: 1280,
      height: 800,
      webSocketPort: 6081,
      webSocketAuthorization,
    })
    assert.deepEqual(await login.detectAuthentication(), {
      authenticated: false,
    })
    assert.deepEqual(await login.detectAuthentication(), {
      authenticated: true,
      cookieHeader: 'session=fake-detected',
    })

    await login.close()
    await login.close()
    assert.equal(calls.filter(({ options }) =>
      options.path === '/session/close').length, 1)
    await assert.rejects(
      login.detectAuthentication(),
      { message: 'BIEYANGHONG_REPAIR_CHALLENGE_CLOSED' },
    )
    await assert.rejects(
      client.startBieyanghongBrokeredLogin(),
      { message: 'BIEYANGHONG_BROWSER_BROKER_RESPONSE_INVALID' },
    )
    assert.equal(calls.filter(({ options }) =>
      options.path === '/session/close').length, 2)
    await assert.rejects(
      client.startBieyanghongBrokeredLogin(),
      { message: 'BIEYANGHONG_BROWSER_BROKER_TIMEOUT' },
    )
  } finally {
    httpMock.restore()
    fsMock.restore()
    restoreEnvironment()
  }
})

test('broker server hides unauthorized access and keeps only one active session', {
  skip: !moduleMocksAvailable && 'requires --experimental-test-module-mocks',
}, async () => {
  const restoreEnvironment = setBrokerEnvironment()
  const existingSignalListeners = {
    SIGINT: new Set(process.listeners('SIGINT')),
    SIGTERM: new Set(process.listeners('SIGTERM')),
  }
  let requestHandler = null
  const logins = []
  const server = {
    listen(path, callback) {
      assert.equal(path, socketPath)
      callback()
    },
    close(callback) {
      callback()
    },
  }
  const fsMock = mock.module('node:fs', {
    exports: {
      chmodSync: () => {},
      existsSync: () => false,
      lstatSync: () => ({
        isDirectory: () => true,
        isSocket: () => true,
        isSymbolicLink: () => false,
        mode: 0o40700,
      }),
      mkdirSync: () => {},
      realpathSync: (path) => path,
      unlinkSync: () => {},
    },
  })
  const httpMock = mock.module('node:http', {
    exports: {
      createServer: (handler) => {
        requestHandler = handler
        return server
      },
    },
  })
  const assistedLoginUrl = new URL(
    '../../../tools/uat/bieyanghong-assisted-login.mjs',
    import.meta.url,
  ).href
  const assistedMock = mock.module(assistedLoginUrl, {
    exports: {
      startBieyanghongAssistedLogin: async (options) => {
        assert.equal(options.profileRoot, '/var/lib/sifangguan-login/hotel-001')
        assert.equal(options.officialLogin, true)
        assert.equal(options.remoteDesktopConfig.enabled, true)
        const index = logins.length
        const login = {
          alreadyAuthenticated: false,
          cookieHeader: null,
          remoteDesktop: {
            width: 1280,
            height: 800,
            webSocketPort: 6081,
            webSocketAuthorization,
          },
          closeCalls: 0,
          detectCalls: 0,
          async close() { this.closeCalls += 1 },
          async detectAuthentication() {
            this.detectCalls += 1
            return {
              authenticated: true,
              cookieHeader: `session=fake-${index}`,
            }
          },
        }
        logins.push(login)
        return login
      },
    },
  })

  try {
    await import(`../../../tools/uat/bieyanghong-browser-broker.mjs?test=${Date.now()}`)
    assert.equal(typeof requestHandler, 'function')

    const unauthorized = await invokeBrokerHandler({
      handler: requestHandler,
      authorization: `Broker ${'X'.repeat(48)}`,
      url: '/health',
    })
    assert.equal(unauthorized.statusCode, 404)
    assert.equal(unauthorized.body.code, 'BIEYANGHONG_BROWSER_BROKER_NOT_FOUND')
    assert.equal(logins.length, 0)

    const firstStart = await invokeBrokerHandler({
      handler: requestHandler,
      authorization: `Broker ${brokerSecret}`,
      url: '/session/start',
    })
    assert.equal(firstStart.statusCode, 201)
    assert.match(firstStart.body.data.sessionId, /^[0-9a-f-]{36}$/u)
    assert.equal(logins.length, 1)

    const secondStart = await invokeBrokerHandler({
      handler: requestHandler,
      authorization: `Broker ${brokerSecret}`,
      url: '/session/start',
    })
    assert.equal(secondStart.statusCode, 201)
    assert.notEqual(secondStart.body.data.sessionId, firstStart.body.data.sessionId)
    assert.equal(logins.length, 2)
    assert.equal(logins[0].closeCalls, 1)

    const staleDetect = await invokeBrokerHandler({
      handler: requestHandler,
      authorization: `Broker ${brokerSecret}`,
      url: '/session/detect',
      body: { sessionId: firstStart.body.data.sessionId },
    })
    assert.equal(staleDetect.statusCode, 400)
    assert.equal(
      staleDetect.body.code,
      'BIEYANGHONG_BROWSER_BROKER_SESSION_NOT_FOUND',
    )

    const currentDetect = await invokeBrokerHandler({
      handler: requestHandler,
      authorization: `Broker ${brokerSecret}`,
      url: '/session/detect',
      body: { sessionId: secondStart.body.data.sessionId },
    })
    assert.equal(currentDetect.statusCode, 200)
    assert.equal(currentDetect.body.data.authenticated, true)
    assert.equal(currentDetect.body.data.cookieHeader, 'session=fake-1')
    assert.equal(logins[1].detectCalls, 1)

    const closed = await invokeBrokerHandler({
      handler: requestHandler,
      authorization: `Broker ${brokerSecret}`,
      url: '/session/close',
      body: { sessionId: secondStart.body.data.sessionId },
    })
    assert.equal(closed.statusCode, 200)
    assert.equal(closed.body.data.closed, true)
    assert.equal(logins[1].closeCalls, 1)
  } finally {
    for (const signal of ['SIGINT', 'SIGTERM']) {
      for (const listener of process.listeners(signal)) {
        if (!existingSignalListeners[signal].has(listener)) {
          process.removeListener(signal, listener)
        }
      }
    }
    assistedMock.restore()
    httpMock.restore()
    fsMock.restore()
    restoreEnvironment()
  }
})
