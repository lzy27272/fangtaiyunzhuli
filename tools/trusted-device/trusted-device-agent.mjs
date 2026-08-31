#!/usr/bin/env node

import {
  generateKeyPairSync,
  randomBytes,
  randomInt,
  sign,
} from 'node:crypto'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs'
import os from 'node:os'
import { dirname, join, resolve } from 'node:path'
import {
  appendAndPersistSnapshot,
  collectLiveReports,
  loadSnapshotStore,
} from '../uat/live-report-collector.mjs'
import { collectionSlotFor } from '../uat/report-schedule.mjs'
import { trustedDeviceCanonicalMessage } from '../uat/trusted-device-intake.mjs'

const require = createRequire(import.meta.url)
const { chromium } = require('playwright-core')

const HOTEL_CODE = '001'
const DEFAULT_SERVER_ORIGIN = 'https://www.sfgzt.cn'
const DEFAULT_CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const LEGACY_REVENUE_SOURCE_ID = '27f5ead0-11a3-4131-87ce-7ba9d7ff0ce0'
const LEGACY_REVENUE_ENDPOINT =
  'https://pms.meituan.com/hotelpms/api/v2/report/jy09'
const CURRENT_REVENUE_ENDPOINT =
  'https://pms.meituan.com/hotelpms/api/v1/report/home/workbench/businessOverview'
const stateRoot = process.env.LOCALAPPDATA
  ? join(process.env.LOCALAPPDATA, 'Sifangguan', 'TrustedDevice001')
  : join(os.homedir(), '.sifangguan', 'trusted-device-001')
const defaultStatePath = join(stateRoot, 'device-state.json')

const args = process.argv.slice(2)
const command = args.shift() ?? 'help'
const option = (name, fallback = null) => {
  const index = args.indexOf(`--${name}`)
  return index >= 0 && typeof args[index + 1] === 'string'
    ? args[index + 1]
    : fallback
}

const statePath = resolve(option('state', defaultStatePath))
const browserExecutable = option(
  'chrome',
  process.env.SFG_TRUSTED_DEVICE_CHROME ?? DEFAULT_CHROME,
)

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

const loadState = () => {
  if (!existsSync(statePath)) throw new Error('TRUSTED_DEVICE_NOT_ENROLLED')
  const state = JSON.parse(readFileSync(statePath, 'utf8'))
  if (
    state?.schemaVersion !== 1
    || state.hotelCode !== HOTEL_CODE
    || typeof state.deviceId !== 'string'
    || typeof state.privateKeyPem !== 'string'
    || typeof state.serverOrigin !== 'string'
    || !state.serverOrigin.startsWith('https://')
  ) throw new Error('TRUSTED_DEVICE_LOCAL_STATE_INVALID')
  return state
}

const postJson = async (url, body, headers = {}) => {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      ...headers,
    },
    body: JSON.stringify(body),
  })
  const parsed = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw new Error(parsed?.code ?? `TRUSTED_DEVICE_HTTP_${response.status}`)
  }
  return parsed.data
}

const signedPost = async (state, path, body) => {
  const transmittedBody = JSON.parse(JSON.stringify(body))
  const timestamp = new Date().toISOString()
  const nonce = randomBytes(24).toString('base64url')
  const message = trustedDeviceCanonicalMessage({
    method: 'POST',
    path,
    hotelCode: HOTEL_CODE,
    deviceId: state.deviceId,
    timestamp,
    nonce,
    body: transmittedBody,
  })
  const signature = sign(
    null,
    Buffer.from(message),
    state.privateKeyPem,
  ).toString('base64url')
  return postJson(`${state.serverOrigin}${path}`, transmittedBody, {
    'X-SFG-Device-ID': state.deviceId,
    'X-SFG-Device-Timestamp': timestamp,
    'X-SFG-Device-Nonce': nonce,
    'X-SFG-Device-Signature': signature,
  })
}

const enroll = async () => {
  const enrollmentCode = option('code')
  const serverOrigin = String(option('server', DEFAULT_SERVER_ORIGIN)).replace(/\/$/u, '')
  const label = option('label', '001门店采集电脑')
  if (!enrollmentCode || !/^001-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/u.test(enrollmentCode)) {
    throw new Error('TRUSTED_DEVICE_ENROLLMENT_CODE_REQUIRED')
  }
  if (!serverOrigin.startsWith('https://')) {
    throw new Error('TRUSTED_DEVICE_SERVER_HTTPS_REQUIRED')
  }
  const { publicKey, privateKey } = generateKeyPairSync('ed25519')
  const publicKeyPem = publicKey.export({ format: 'pem', type: 'spki' }).toString()
  const privateKeyPem = privateKey.export({ format: 'pem', type: 'pkcs8' }).toString()
  const device = await postJson(`${serverOrigin}/api/v1/trusted-device/enroll`, {
    hotelCode: HOTEL_CODE,
    enrollmentCode,
    label,
    publicKeyPem,
  })
  const next = {
    schemaVersion: 1,
    hotelCode: HOTEL_CODE,
    serverOrigin,
    deviceId: device.deviceId,
    label: device.label,
    privateKeyPem,
    localHmacSecret: randomBytes(32).toString('base64url'),
    chromeProfilePath: join(dirname(statePath), 'chrome-profile'),
    snapshotPath: join(dirname(statePath), 'local-snapshots.json'),
    lastCollectionSlot: null,
    enrolledAt: device.enrolledAt,
  }
  atomicWrite(statePath, next)
  process.stdout.write('001可信设备注册成功。私钥与浏览器会话仅保存在本机。\n')
}

const delay = (milliseconds) => new Promise((resolvePromise) =>
  setTimeout(resolvePromise, milliseconds))

const ensureBrowserDebuggingPort = (state) => {
  if (
    Number.isInteger(state.browserDebuggingPort)
    && state.browserDebuggingPort >= 20_000
    && state.browserDebuggingPort <= 49_999
  ) return state.browserDebuggingPort
  state.browserDebuggingPort = randomInt(20_000, 50_000)
  atomicWrite(statePath, state)
  return state.browserDebuggingPort
}

const browserDebuggingOrigin = (state) =>
  `http://127.0.0.1:${ensureBrowserDebuggingPort(state)}`

const browserDebuggingReady = async (origin) => {
  try {
    const response = await fetch(`${origin}/json/version`, {
      signal: AbortSignal.timeout(1_000),
    })
    if (!response.ok) return false
    const version = await response.json().catch(() => ({}))
    return typeof version?.webSocketDebuggerUrl === 'string'
  } catch {
    return false
  }
}

const connectToOfficialBrowser = async (state) => {
  const origin = browserDebuggingOrigin(state)
  if (!await browserDebuggingReady(origin)) {
    throw new Error('TRUSTED_DEVICE_OFFICIAL_BROWSER_NOT_RUNNING')
  }
  const browser = await chromium.connectOverCDP(origin)
  const context = browser.contexts()[0]
  if (!context) throw new Error('TRUSTED_DEVICE_OFFICIAL_BROWSER_CONTEXT_MISSING')
  return { browser, context }
}

const openOfficialBrowser = async (state) => {
  if (!existsSync(browserExecutable)) {
    throw new Error('TRUSTED_DEVICE_CHROME_NOT_FOUND')
  }
  mkdirSync(state.chromeProfilePath, { recursive: true })
  const port = ensureBrowserDebuggingPort(state)
  const browserProcess = spawn(browserExecutable, [
    '--remote-debugging-address=127.0.0.1',
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${state.chromeProfilePath}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--start-maximized',
    'https://pms.meituan.com',
  ], {
    detached: true,
    stdio: 'ignore',
    windowsHide: false,
  })
  browserProcess.unref()
  const origin = browserDebuggingOrigin(state)
  const deadline = Date.now() + 20_000
  while (Date.now() < deadline) {
    if (await browserDebuggingReady(origin)) {
      return connectToOfficialBrowser(state)
    }
    await delay(500)
  }
  throw new Error('TRUSTED_DEVICE_CLOSE_OLD_CONTROLLED_CHROME_AND_RETRY')
}

const login = async () => {
  const state = loadState()
  const { context } = await openOfficialBrowser(state)
  process.stdout.write('普通Chrome已打开；请在美团官网人工登录，完成后保留窗口运行（可以最小化）。\n')
  const deadline = Date.now() + 30 * 60_000
  while (Date.now() < deadline) {
    const cookies = await context.cookies('https://pms.meituan.com')
    if (cookies.some((cookie) =>
      cookie.name === 'hotelpms_login_hotel_id' && cookie.value)) {
      process.stdout.write('已检测到001本机会话。未上传Cookie或账号信息。\n')
      return
    }
    await delay(2_000)
  }
  throw new Error('TRUSTED_DEVICE_LOGIN_TIMEOUT')
}

const cookieHeaderFrom = (cookies) => cookies
  .filter((cookie) => cookie.domain === 'pms.meituan.com'
    || cookie.domain.endsWith('.meituan.com'))
  .map((cookie) => `${cookie.name}=${cookie.value}`)
  .join('; ')

const currentSourcesFor001 = (sources) => sources.map((source) =>
  source.sourceId === LEGACY_REVENUE_SOURCE_ID
  && source.endpointUrl === LEGACY_REVENUE_ENDPOINT
    ? {
        ...source,
        displayName: '经营概览（房费/ADR/RevPAR）',
        endpointUrl: CURRENT_REVENUE_ENDPOINT,
      }
    : source)

const collectOnce = async () => {
  const state = loadState()
  const config = await signedPost(
    state,
    '/api/v1/trusted-device/config',
    { hotelCode: HOTEL_CODE },
  )
  if (
    config?.schemaVersion !== 1
    || config?.hotel?.hotelCode !== HOTEL_CODE
    || !Array.isArray(config.sources)
  ) throw new Error('TRUSTED_DEVICE_COLLECTION_CONFIG_INVALID')

  const { context } = await connectToOfficialBrowser(state)
  let cookieHeader = cookieHeaderFrom(
    await context.cookies('https://pms.meituan.com'),
  )
  if (!/(?:^|;\s*)hotelpms_login_hotel_id=/u.test(cookieHeader)) {
    throw new Error('TRUSTED_DEVICE_LOGIN_REQUIRED')
  }

  const collectionSources = currentSourcesFor001(config.sources)
  const previousStore = loadSnapshotStore(state.snapshotPath)
  const previousSnapshots = previousStore[config.hotel.hotelId] ?? []
  const enabledSources = collectionSources.filter((source) => source.enabled)
  const cookiesBySourceId = Object.fromEntries(
    enabledSources.map((source) => [source.sourceId, cookieHeader]),
  )
  cookieHeader = null
  let result
  try {
    result = await collectLiveReports({
      hotel: config.hotel,
      sources: collectionSources,
      cookiesBySourceId,
      previousSnapshots,
      secretKey: state.localHmacSecret,
      target: null,
      hotSellingRoomTypeCodes: config.hotSellingRoomTypeCodes ?? [],
    })
  } finally {
    for (const key of Object.keys(cookiesBySourceId)) {
      cookiesBySourceId[key] = null
    }
  }
  appendAndPersistSnapshot(previousStore, state.snapshotPath, result.snapshot)
  const cloudSnapshot = {
    ...result.snapshot,
    // Line-level order hashes stay on the store computer. The cloud only
    // needs the already-computed deltas, forecasts and inventory summaries.
    orders: [],
  }
  const receipt = await signedPost(
    state,
    '/api/v1/trusted-device/snapshots',
    { hotelCode: HOTEL_CODE, snapshot: cloudSnapshot },
  )
  process.stdout.write(
    `001采集完成：${result.snapshot.businessDate}，${result.snapshot.completeness}`
    + `${receipt.replayed ? '（云端已存在）' : '（已签名上报）'}。\n`,
  )
  return result
}

const collectIfDue = async () => {
  const state = loadState()
  const slot = collectionSlotFor()
  if (!slot || state.lastCollectionSlot === slot.slotKey) return
  await collectOnce()
  state.lastCollectionSlot = slot.slotKey
  atomicWrite(statePath, state)
}

const status = async () => {
  const state = loadState()
  const remote = await signedPost(
    state,
    '/api/v1/trusted-device/config',
    { hotelCode: HOTEL_CODE },
  )
  process.stdout.write(
    `001可信设备正常；云端配置${remote.sources.length}个报表数据源。\n`,
  )
}

const help = () => process.stdout.write([
  '001门店可信设备采集器',
  '  enroll --code 001-XXXX-XXXX-XXXX [--server https://www.sfgzt.cn]',
  '  login',
  '  collect-once',
  '  collect-if-due',
  '  status',
].join('\n') + '\n')

try {
  if (command === 'enroll') await enroll()
  else if (command === 'login') await login()
  else if (command === 'collect-once') await collectOnce()
  else if (command === 'collect-if-due') await collectIfDue()
  else if (command === 'status') await status()
  else help()
  await new Promise((resolvePromise) => process.stdout.write('', resolvePromise))
  process.exit(0)
} catch (error) {
  const code = error instanceof Error
    ? error.message.replace(/[^A-Z0-9_:-]/giu, '_').slice(0, 160)
    : 'TRUSTED_DEVICE_FAILED'
  process.stderr.write(`${code}\n`, () => process.exit(1))
}
