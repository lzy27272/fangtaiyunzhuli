#!/usr/bin/env node

import { randomUUID, timingSafeEqual } from 'node:crypto'
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  realpathSync,
  unlinkSync,
} from 'node:fs'
import { createServer } from 'node:http'
import { dirname } from 'node:path'
import process from 'node:process'
import { startBieyanghongAssistedLogin } from './bieyanghong-assisted-login.mjs'

const socketPath =
  process.env.BIEYANGHONG_BROWSER_BROKER_SOCKET_PATH?.trim()
  || '/run/sifangguan-bieyanghong/broker.sock'
const brokerSecret =
  process.env.BIEYANGHONG_BROWSER_BROKER_SECRET?.trim() || ''
const profileRoot =
  process.env.BIEYANGHONG_BROWSER_PROFILE_ROOT?.trim()
  || '/var/lib/sifangguan-login/hotel-001'
const secretPattern = /^[A-Za-z0-9_-]{40,128}$/u
const sessionIdPattern = /^[0-9a-f-]{36}$/iu
const maxSessionMs = 10 * 60_000

if (
  !/^\/run\/[A-Za-z0-9_-]+\/[A-Za-z0-9_.-]+\.sock$/u.test(socketPath)
  || !secretPattern.test(brokerSecret)
  || profileRoot !== '/var/lib/sifangguan-login/hotel-001'
) {
  throw new Error('BIEYANGHONG_BROWSER_BROKER_CONFIGURATION_INVALID')
}

mkdirSync(profileRoot, { recursive: true, mode: 0o700 })
if (
  lstatSync(profileRoot).isSymbolicLink()
  || realpathSync(profileRoot) !== profileRoot
) {
  throw new Error('BIEYANGHONG_BROWSER_BROKER_PROFILE_UNSAFE')
}

const remoteDesktopConfig = Object.freeze({
  enabled: true,
  display: process.env.BIEYANGHONG_REMOTE_DESKTOP_DISPLAY?.trim() || ':91',
  width: process.env.BIEYANGHONG_REMOTE_DESKTOP_WIDTH,
  height: process.env.BIEYANGHONG_REMOTE_DESKTOP_HEIGHT,
  vncPort: process.env.BIEYANGHONG_REMOTE_DESKTOP_VNC_PORT,
  webSocketPort: process.env.BIEYANGHONG_REMOTE_DESKTOP_WEBSOCKET_PORT,
  xvfbExecutable: '/usr/bin/Xvfb',
  x11vncExecutable: '/usr/bin/x11vnc',
  websockifyExecutable: '/usr/bin/websockify',
})

const json = (response, status, body) => {
  const content = JSON.stringify(body)
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(content),
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  })
  response.end(content)
}

const suppliedSecretValid = (request) => {
  const authorization = String(request.headers.authorization ?? '')
  const supplied = authorization.startsWith('Broker ')
    ? authorization.slice('Broker '.length).trim()
    : ''
  if (!secretPattern.test(supplied)) return false
  const suppliedBuffer = Buffer.from(supplied)
  const expectedBuffer = Buffer.from(brokerSecret)
  return suppliedBuffer.length === expectedBuffer.length
    && timingSafeEqual(suppliedBuffer, expectedBuffer)
}

const readBody = (request) => new Promise((resolve, reject) => {
  const chunks = []
  let size = 0
  request.on('data', (chunk) => {
    size += chunk.length
    if (size > 4_096) {
      reject(new Error('BIEYANGHONG_BROWSER_BROKER_REQUEST_INVALID'))
      request.destroy()
      return
    }
    chunks.push(chunk)
  })
  request.once('end', () => {
    try {
      resolve(chunks.length
        ? JSON.parse(Buffer.concat(chunks).toString('utf8'))
        : {})
    } catch {
      reject(new Error('BIEYANGHONG_BROWSER_BROKER_REQUEST_INVALID'))
    }
  })
  request.once('error', reject)
})

let active = null
let idleTimer = null
let sessionOperation = Promise.resolve()

const serializeSessionOperation = (operation) => {
  const pending = sessionOperation.then(operation, operation)
  sessionOperation = pending.catch(() => {})
  return pending
}

const closeActive = async (sessionId = null) => {
  if (!active || (sessionId && active.sessionId !== sessionId)) return false
  const closing = active
  active = null
  if (idleTimer) clearTimeout(idleTimer)
  idleTimer = null
  await closing.login.close().catch(() => {})
  process.stdout.write(`${JSON.stringify({
    event: 'BIEYANGHONG_BROWSER_BROKER_SESSION_CLOSED',
    sessionId: closing.sessionId,
  })}\n`)
  return true
}

const startSession = async () => {
  await closeActive()
  const sessionId = randomUUID()
  const login = await startBieyanghongAssistedLogin({
    profileRoot,
    officialLogin: true,
    remoteDesktopConfig,
  })
  active = { sessionId, login }
  idleTimer = setTimeout(() => { void closeActive(sessionId) }, maxSessionMs)
  idleTimer.unref()
  process.stdout.write(`${JSON.stringify({
    event: 'BIEYANGHONG_BROWSER_BROKER_SESSION_STARTED',
    sessionId,
    alreadyAuthenticated: login.alreadyAuthenticated,
  })}\n`)
  return {
    sessionId,
    alreadyAuthenticated: login.alreadyAuthenticated,
    cookieHeader: login.alreadyAuthenticated ? login.cookieHeader : null,
    remoteDesktop: login.remoteDesktop ?? null,
  }
}

const server = createServer(async (request, response) => {
  try {
    if (!suppliedSecretValid(request)) {
      json(response, 404, { code: 'BIEYANGHONG_BROWSER_BROKER_NOT_FOUND' })
      return
    }
    if (request.method !== 'POST') {
      json(response, 405, { code: 'BIEYANGHONG_BROWSER_BROKER_METHOD_INVALID' })
      return
    }
    if (request.url === '/health') {
      json(response, 200, { data: { status: 'UP', active: Boolean(active) } })
      return
    }
    const body = await readBody(request)
    if (request.url === '/session/start') {
      json(response, 201, {
        data: await serializeSessionOperation(startSession),
      })
      return
    }
    if (request.url === '/session/detect') {
      if (!sessionIdPattern.test(String(body.sessionId ?? ''))) {
        throw new Error('BIEYANGHONG_BROWSER_BROKER_SESSION_INVALID')
      }
      if (!active || active.sessionId !== body.sessionId) {
        throw new Error('BIEYANGHONG_BROWSER_BROKER_SESSION_NOT_FOUND')
      }
      const detected = await serializeSessionOperation(async () => {
        if (!active || active.sessionId !== body.sessionId) {
          throw new Error('BIEYANGHONG_BROWSER_BROKER_SESSION_NOT_FOUND')
        }
        return active.login.detectAuthentication()
      })
      json(response, 200, { data: detected })
      detected.cookieHeader = null
      return
    }
    if (request.url === '/session/close') {
      if (!sessionIdPattern.test(String(body.sessionId ?? ''))) {
        throw new Error('BIEYANGHONG_BROWSER_BROKER_SESSION_INVALID')
      }
      await serializeSessionOperation(() => closeActive(body.sessionId))
      json(response, 200, { data: { closed: true } })
      return
    }
    json(response, 404, { code: 'BIEYANGHONG_BROWSER_BROKER_NOT_FOUND' })
  } catch (error) {
    const code = /^[A-Z][A-Z0-9_]{2,100}$/u.test(String(error?.message ?? ''))
      ? error.message
      : 'BIEYANGHONG_BROWSER_BROKER_FAILED'
    json(response, 400, { code })
  }
})

if (existsSync(socketPath)) {
  const current = lstatSync(socketPath)
  if (!current.isSocket()) {
    throw new Error('BIEYANGHONG_BROWSER_BROKER_SOCKET_UNSAFE')
  }
  unlinkSync(socketPath)
}
mkdirSync(dirname(socketPath), { recursive: true, mode: 0o750 })
server.listen(socketPath, () => {
  chmodSync(socketPath, 0o660)
  process.stdout.write(`${JSON.stringify({
    status: 'READY',
    service: 'BIEYANGHONG_BROWSER_BROKER',
  })}\n`)
})

let shuttingDown = false
const shutdown = async () => {
  if (shuttingDown) return
  shuttingDown = true
  await closeActive()
  server.close(() => {
    if (existsSync(socketPath) && lstatSync(socketPath).isSocket()) {
      unlinkSync(socketPath)
    }
    process.exit(0)
  })
  setTimeout(() => process.exit(0), 5_000).unref()
}

process.once('SIGINT', () => { void shutdown() })
process.once('SIGTERM', () => { void shutdown() })
