import { existsSync } from 'node:fs'
import { request as httpRequest } from 'node:http'

const DEFAULT_SOCKET_PATH = '/run/sifangguan-bieyanghong/broker.sock'
const BROKER_SECRET_PATTERN = /^[A-Za-z0-9_-]{40,128}$/u
const SESSION_ID_PATTERN = /^[0-9a-f-]{36}$/iu
const expectedWebSocketPort = Number.parseInt(
  process.env.BIEYANGHONG_REMOTE_DESKTOP_WEBSOCKET_PORT ?? '',
  10,
)

export const bieyanghongBrowserBrokerConfig = Object.freeze({
  enabled: process.env.BIEYANGHONG_BROWSER_BROKER_ENABLED === 'true',
  socketPath:
    process.env.BIEYANGHONG_BROWSER_BROKER_SOCKET_PATH?.trim()
    || DEFAULT_SOCKET_PATH,
  secret: process.env.BIEYANGHONG_BROWSER_BROKER_SECRET?.trim() || '',
  expectedWebSocketPort,
})

export const bieyanghongBrowserBrokerReady = () =>
  bieyanghongBrowserBrokerConfig.enabled
  && /^\/run\/[A-Za-z0-9_-]+\/[A-Za-z0-9_.-]+\.sock$/u.test(
    bieyanghongBrowserBrokerConfig.socketPath,
  )
  && BROKER_SECRET_PATTERN.test(bieyanghongBrowserBrokerConfig.secret)
  && Number.isInteger(bieyanghongBrowserBrokerConfig.expectedWebSocketPort)
  && bieyanghongBrowserBrokerConfig.expectedWebSocketPort >= 1024
  && bieyanghongBrowserBrokerConfig.expectedWebSocketPort <= 65535
  && existsSync(bieyanghongBrowserBrokerConfig.socketPath)

const validatedRemoteDesktop = (candidate) => {
  if (
    !candidate
    || !Number.isInteger(candidate.width)
    || candidate.width < 960
    || candidate.width > 1920
    || !Number.isInteger(candidate.height)
    || candidate.height < 640
    || candidate.height > 1200
    || candidate.webSocketPort
      !== bieyanghongBrowserBrokerConfig.expectedWebSocketPort
    || typeof candidate.webSocketAuthorization !== 'string'
    || !/^Basic [A-Za-z0-9+/]{40,256}={0,2}$/u
      .test(candidate.webSocketAuthorization)
  ) {
    throw new Error('BIEYANGHONG_BROWSER_BROKER_RESPONSE_INVALID')
  }
  const decoded = Buffer.from(
    candidate.webSocketAuthorization.slice('Basic '.length),
    'base64',
  ).toString('latin1')
  if (!/^viewer:[A-Za-z0-9_-]{40,128}$/u.test(decoded)) {
    throw new Error('BIEYANGHONG_BROWSER_BROKER_RESPONSE_INVALID')
  }
  return Object.freeze({
    width: candidate.width,
    height: candidate.height,
    webSocketPort: candidate.webSocketPort,
    webSocketAuthorization: candidate.webSocketAuthorization,
  })
}

const brokerRequest = ({ path, body = {}, timeoutMs = 60_000 }) =>
  new Promise((resolve, reject) => {
    if (!bieyanghongBrowserBrokerReady()) {
      reject(new Error('BIEYANGHONG_BROWSER_BROKER_UNAVAILABLE'))
      return
    }
    let payload = JSON.stringify(body)
    const request = httpRequest({
      socketPath: bieyanghongBrowserBrokerConfig.socketPath,
      path,
      method: 'POST',
      headers: {
        authorization:
          `Broker ${bieyanghongBrowserBrokerConfig.secret}`,
        'content-type': 'application/json; charset=utf-8',
        'content-length': Buffer.byteLength(payload),
      },
    }, (response) => {
      const chunks = []
      let size = 0
      response.on('data', (chunk) => {
        size += chunk.length
        if (size <= 32 * 1024) chunks.push(chunk)
        else request.destroy(new Error('BIEYANGHONG_BROWSER_BROKER_RESPONSE_INVALID'))
      })
      response.once('end', () => {
        try {
          const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'))
          if (
            response.statusCode < 200
            || response.statusCode >= 300
            || !parsed?.data
          ) {
            throw new Error(
              typeof parsed?.code === 'string'
                ? parsed.code
                : 'BIEYANGHONG_BROWSER_BROKER_REQUEST_FAILED',
            )
          }
          resolve(parsed.data)
        } catch (error) {
          reject(error)
        }
      })
    })
    request.setTimeout(timeoutMs, () => {
      request.destroy(new Error('BIEYANGHONG_BROWSER_BROKER_TIMEOUT'))
    })
    request.once('error', (error) => reject(
      String(error?.message ?? '').startsWith('BIEYANGHONG_')
        ? error
        : new Error('BIEYANGHONG_BROWSER_BROKER_UNAVAILABLE'),
    ))
    request.end(payload)
    payload = null
  })

export const startBieyanghongBrokeredLogin = async () => {
  const started = await brokerRequest({ path: '/session/start' })
  if (
    !SESSION_ID_PATTERN.test(String(started.sessionId ?? ''))
    || typeof started.alreadyAuthenticated !== 'boolean'
  ) {
    throw new Error('BIEYANGHONG_BROWSER_BROKER_RESPONSE_INVALID')
  }
  let remoteDesktop
  try {
    remoteDesktop = started.alreadyAuthenticated
      ? null
      : validatedRemoteDesktop(started.remoteDesktop)
  } catch (error) {
    started.cookieHeader = null
    started.remoteDesktop = null
    await brokerRequest({
      path: '/session/close',
      body: { sessionId: started.sessionId },
      timeoutMs: 10_000,
    }).catch(() => {})
    throw error
  }
  started.remoteDesktop = null
  let sessionId = started.sessionId
  let closed = false
  let initialCookieHeader = typeof started.cookieHeader === 'string'
    ? started.cookieHeader
    : null
  started.cookieHeader = null
  const close = async () => {
    if (closed) return
    closed = true
    const closingId = sessionId
    sessionId = null
    initialCookieHeader = null
    await brokerRequest({
      path: '/session/close',
      body: { sessionId: closingId },
      timeoutMs: 10_000,
    }).catch(() => {})
  }
  const detectAuthentication = async () => {
    if (closed || !sessionId) {
      throw new Error('BIEYANGHONG_REPAIR_CHALLENGE_CLOSED')
    }
    const detected = await brokerRequest({
      path: '/session/detect',
      body: { sessionId },
      timeoutMs: 15_000,
    })
    let cookieHeader = typeof detected.cookieHeader === 'string'
      ? detected.cookieHeader
      : null
    detected.cookieHeader = null
    if (!detected.authenticated || !cookieHeader) {
      cookieHeader = null
      return { authenticated: false }
    }
    return { authenticated: true, cookieHeader }
  }
  return {
    alreadyAuthenticated: started.alreadyAuthenticated,
    cookieHeader: initialCookieHeader,
    remoteDesktop,
    detectAuthentication,
    close,
  }
}
