#!/usr/bin/env node

import {
  createHmac,
  generateKeyPairSync,
  randomBytes,
  randomInt,
  sign,
} from 'node:crypto'
import { spawn, spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import {
  existsSync,
  mkdirSync,
} from 'node:fs'
import os from 'node:os'
import { dirname, join, resolve } from 'node:path'
import {
  appendAndPersistSnapshot,
  collectLiveReports,
  loadSnapshotStore,
} from '../uat/live-report-collector.mjs'
import { collectionSlotFor } from '../uat/report-schedule.mjs'
import {
  trustedDeviceCanonicalMessage,
  trustedDeviceScopeProof,
} from '../uat/trusted-device-intake.mjs'
import {
  createTrustedDeviceLocalStateStore,
} from './trusted-device-local-state.mjs'

const require = createRequire(import.meta.url)
const { chromium } = require('playwright-core')

const DEFAULT_SERVER_ORIGIN = 'https://www.sfgzt.cn'
const DEFAULT_CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const LEGACY_REVENUE_SOURCE_ID = '27f5ead0-11a3-4131-87ce-7ba9d7ff0ce0'
const LEGACY_REVENUE_ENDPOINT =
  'https://pms.meituan.com/hotelpms/api/v2/report/jy09'
const CURRENT_REVENUE_ENDPOINT =
  'https://pms.meituan.com/hotelpms/api/v1/report/home/workbench/businessOverview'
const args = process.argv.slice(2)
const command = args.shift() ?? 'help'
const option = (name, fallback = null) => {
  const index = args.indexOf(`--${name}`)
  return index >= 0 && typeof args[index + 1] === 'string'
    ? args[index + 1]
    : fallback
}

const enrollmentHotelCode =
  /^([A-Z0-9][A-Z0-9_-]{0,15})-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/u
    .exec(String(option('code', '')))?.[1] ?? ''
const HOTEL_CODE = String(
  option('hotel', enrollmentHotelCode || '001'),
).trim().toUpperCase()
if (!/^[A-Z0-9][A-Z0-9_-]{0,15}$/u.test(HOTEL_CODE)) {
  throw new Error('TRUSTED_DEVICE_HOTEL_CODE_INVALID')
}
const stateRoot = process.env.LOCALAPPDATA
  ? join(
      process.env.LOCALAPPDATA,
      'Sifangguan',
      HOTEL_CODE === '001' ? 'TrustedDevice001' : `TrustedDevice-${HOTEL_CODE}`,
    )
  : join(
      os.homedir(),
      '.sifangguan',
      HOTEL_CODE === '001' ? 'trusted-device-001' : `trusted-device-${HOTEL_CODE.toLowerCase()}`,
    )
const defaultStatePath = join(stateRoot, 'device-state.json')

const statePath = resolve(option('state', defaultStatePath))
const localStateStore = createTrustedDeviceLocalStateStore({
  path: statePath,
  hotelCode: HOTEL_CODE,
})
const browserExecutable = option(
  'chrome',
  process.env.SFG_TRUSTED_DEVICE_CHROME ?? DEFAULT_CHROME,
)

const loadState = () => {
  const state = localStateStore.read()
  if (!state) throw new Error('TRUSTED_DEVICE_NOT_ENROLLED')
  if (
    state?.schemaVersion === 1
    && state.hotelCode === HOTEL_CODE
    && (
      typeof state.scopeProofKey !== 'string'
      || Buffer.from(state.scopeProofKey, 'base64url').length !== 32
    )
  ) throw new Error('TRUSTED_DEVICE_REENROLL_REQUIRED')
  if (
    state?.schemaVersion !== 1
    || state.hotelCode !== HOTEL_CODE
    || typeof state.deviceId !== 'string'
    || typeof state.privateKeyPem !== 'string'
    || typeof state.scopeProofKey !== 'string'
    || Buffer.from(state.scopeProofKey, 'base64url').length !== 32
    || typeof state.serverOrigin !== 'string'
    || !state.serverOrigin.startsWith('https://')
  ) throw new Error('TRUSTED_DEVICE_LOCAL_STATE_INVALID')
  return state
}

const mergeCurrentDeviceState = (state, patch, { abandonOnChange = false } = {}) => {
  const allowedKeys = new Set([
    'browserDebuggingPort',
    'lastCollectionSlot',
    'pseudonymKey',
  ])
  if (Object.keys(patch).some((key) => !allowedKeys.has(key))) {
    throw new Error('TRUSTED_DEVICE_LOCAL_STATE_PATCH_INVALID')
  }
  const merged = localStateStore.mergeForDevice({
    deviceId: state.deviceId,
    expectedStateVersion:
      Number.isInteger(state.stateVersion) ? state.stateVersion : 0,
    patch,
  })
  if (!merged.updated) {
    if (abandonOnChange) return null
    throw new Error('TRUSTED_DEVICE_LOCAL_STATE_STALE')
  }
  Object.assign(state, merged.state)
  return merged.state
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
  const label = option('label', `${HOTEL_CODE}门店采集电脑`)
  if (
    !enrollmentCode
    || !/^[A-Z0-9][A-Z0-9_-]{0,15}-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/u.test(enrollmentCode)
    || !enrollmentCode.startsWith(`${HOTEL_CODE}-`)
  ) {
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
  if (
    typeof device.scopeProofKey !== 'string'
    || Buffer.from(device.scopeProofKey, 'base64url').length !== 32
  ) throw new Error('TRUSTED_DEVICE_SCOPE_PROOF_KEY_INVALID')
  const next = {
    schemaVersion: 1,
    hotelCode: HOTEL_CODE,
    serverOrigin,
    deviceId: device.deviceId,
    label: device.label,
    privateKeyPem,
    scopeProofKey: device.scopeProofKey,
    localHmacSecret: randomBytes(32).toString('base64url'),
    chromeProfilePath: join(dirname(statePath), 'chrome-profile'),
    snapshotPath: join(dirname(statePath), 'local-snapshots.json'),
    lastCollectionSlot: null,
    enrolledAt: device.enrolledAt,
  }
  const installed = localStateStore.installEnrollment(next)
  if (!installed.updated) {
    throw new Error('TRUSTED_DEVICE_LOCAL_STATE_STALE')
  }
  process.stdout.write(`${HOTEL_CODE}可信设备注册成功。私钥与浏览器会话仅保存在本机。\n`)
}

const delay = (milliseconds) => new Promise((resolvePromise) =>
  setTimeout(resolvePromise, milliseconds))

const ensureBrowserDebuggingPort = (state) => {
  if (
    Number.isInteger(state.browserDebuggingPort)
    && state.browserDebuggingPort >= 20_000
    && state.browserDebuggingPort <= 49_999
  ) return state.browserDebuggingPort
  const updated = mergeCurrentDeviceState(state, {
    browserDebuggingPort: randomInt(20_000, 50_000),
  })
  return updated.browserDebuggingPort
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

const discoverOfficialBrowserDebuggingPort = (state) => {
  if (process.platform !== 'win32') return null
  const script = [
    '$profile = [Environment]::GetEnvironmentVariable("SFG_TRUSTED_PROFILE")',
    `$processes = Get-CimInstance Win32_Process -Filter "Name='chrome.exe'" -ErrorAction SilentlyContinue`,
    'foreach ($process in $processes) {',
    '  $line = [string]$process.CommandLine',
    `  if ($line -and $line.IndexOf($profile, [System.StringComparison]::OrdinalIgnoreCase) -ge 0 -and $line -match '--remote-debugging-port=(\\d+)') {`,
    '    [Console]::Out.Write($Matches[1])',
    '    break',
    '  }',
    '}',
  ].join('\n')
  const result = spawnSync(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-Command', script],
    {
      encoding: 'utf8',
      env: { ...process.env, SFG_TRUSTED_PROFILE: state.chromeProfilePath },
      timeout: 5_000,
      windowsHide: true,
    },
  )
  if (result.status !== 0) return null
  const discovered = Number.parseInt(result.stdout.trim(), 10)
  return Number.isInteger(discovered)
    && discovered >= 20_000
    && discovered <= 49_999
    ? discovered
    : null
}

const connectToOfficialBrowser = async (state) => {
  let origin = browserDebuggingOrigin(state)
  if (!await browserDebuggingReady(origin)) {
    const discoveredPort = discoverOfficialBrowserDebuggingPort(state)
    if (discoveredPort !== null) {
      const discoveredOrigin = `http://127.0.0.1:${discoveredPort}`
      if (await browserDebuggingReady(discoveredOrigin)) {
        mergeCurrentDeviceState(state, {
          browserDebuggingPort: discoveredPort,
        })
        origin = discoveredOrigin
      }
    }
  }
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

const pmsPageFor = (context) => context.pages().find((candidate) =>
  candidate.url().startsWith('https://pms.meituan.com')) ?? null

const pmsLoginHotelIdFromCookies = (cookies) => {
  const candidates = cookies.filter((cookie) =>
    cookie.name === 'hotelpms_login_hotel_id'
    && (cookie.domain === 'pms.meituan.com'
      || cookie.domain === '.pms.meituan.com'
      || cookie.domain === '.meituan.com'))
  if (candidates.length === 0) return null
  if (candidates.some((cookie) =>
    typeof cookie.value !== 'string'
    || !/^(?:0|[1-9][0-9]{0,63})$/u.test(cookie.value))) {
    throw new Error('TRUSTED_DEVICE_STORE_SCOPE_INVALID')
  }
  const distinct = new Set(candidates.map((cookie) => cookie.value))
  if (distinct.size !== 1) {
    throw new Error('TRUSTED_DEVICE_STORE_SCOPE_INVALID')
  }
  return [...distinct][0]
}

const clearOfficialHotelScopeCookies = async (context) => {
  const cookies = await context.cookies('https://pms.meituan.com')
  for (const cookie of cookies.filter((item) =>
    item.name === 'hotelpms_login_hotel_id'
    && (item.domain === 'pms.meituan.com'
      || item.domain === '.pms.meituan.com'
      || item.domain === '.meituan.com'))) {
    await context.addCookies([{
      name: cookie.name,
      value: '',
      domain: cookie.domain,
      path: cookie.path || '/',
      expires: 1,
    }])
  }
}

const usableOfficialSession = async (context) => {
  const cookies = await context.cookies('https://pms.meituan.com')
  if (!pmsLoginHotelIdFromCookies(cookies)) return false
  const page = pmsPageFor(context)
  if (!page) return false
  const pathname = new URL(page.url()).pathname
  return !/(?:^|\/)account\/login(?:\/|$)/u.test(pathname)
}

const officialBrowserFor = async (state) => {
  try {
    return await connectToOfficialBrowser(state)
  } catch (error) {
    if (error?.message !== 'TRUSTED_DEVICE_OFFICIAL_BROWSER_NOT_RUNNING') {
      throw error
    }
    return openOfficialBrowser(state)
  }
}

const waitForOfficialLogin = async (
  state,
  { forceReauthentication = false, clearStoreScope = false } = {},
) => {
  const { context } = await officialBrowserFor(state)
  if (clearStoreScope) await clearOfficialHotelScopeCookies(context)
  let page = pmsPageFor(context)
  if (!page) page = await context.newPage()
  await page.bringToFront()
  if (forceReauthentication || !await usableOfficialSession(context)) {
    await page.goto(
      'https://pms.meituan.com/pms-web/account/login',
      { waitUntil: 'domcontentloaded', timeout: 30_000 },
    ).catch(() => {})
  } else {
    process.stdout.write(`已检测到${HOTEL_CODE}本机有效登录会话。\n`)
    return
  }
  process.stdout.write(
    '普通Chrome已打开；请在美团官网人工完成必要验证，成功后系统会自动继续采集。\n',
  )
  const deadline = Date.now() + 30 * 60_000
  while (Date.now() < deadline) {
    if (await usableOfficialSession(context)) {
      process.stdout.write(`已检测到${HOTEL_CODE}本机会话。未上传Cookie或账号信息。\n`)
      return
    }
    await delay(2_000)
  }
  throw new Error('TRUSTED_DEVICE_LOGIN_TIMEOUT')
}

const login = async () => {
  await waitForOfficialLogin(loadState())
}

const cookieHeaderFrom = (cookies) => cookies
  .filter((cookie) => cookie.domain === 'pms.meituan.com'
    || cookie.domain.endsWith('.meituan.com'))
  .map((cookie) => `${cookie.name}=${cookie.value}`)
  .join('; ')

const currentSourcesForTrustedDevice = (sources) => sources.map((source) =>
  source.sourceId === LEGACY_REVENUE_SOURCE_ID
  && source.endpointUrl === LEGACY_REVENUE_ENDPOINT
    ? {
        ...source,
        displayName: '经营概览（房费/ADR/RevPAR）',
        endpointUrl: CURRENT_REVENUE_ENDPOINT,
      }
    : source)

const scopedCollectionConfig = async (state, cookies) => {
  const challenge = await signedPost(
    state,
    '/api/v1/trusted-device/config',
    { hotelCode: HOTEL_CODE },
  )
  if (
    challenge?.schemaVersion !== 2
    || challenge?.phase !== 'SCOPE_CHALLENGE'
    || typeof challenge?.scopeChallenge?.challengeId !== 'string'
    || typeof challenge?.scopeChallenge?.value !== 'string'
  ) throw new Error('TRUSTED_DEVICE_COLLECTION_CONFIG_INVALID')
  const pmsLoginHotelId = pmsLoginHotelIdFromCookies(cookies)
  if (!pmsLoginHotelId) throw new Error('TRUSTED_DEVICE_LOGIN_REQUIRED')
  const scopeProof = trustedDeviceScopeProof({
    hotelCode: HOTEL_CODE,
    deviceId: state.deviceId,
    challenge: challenge.scopeChallenge.value,
    pmsLoginHotelId,
    scopeProofKey: state.scopeProofKey,
  })
  const config = await signedPost(
    state,
    '/api/v1/trusted-device/config',
    {
      hotelCode: HOTEL_CODE,
      scopeChallengeId: challenge.scopeChallenge.challengeId,
      scopeProof,
    },
  )
  if (
    config?.schemaVersion !== 2
    || config?.phase !== 'COLLECTION_CONFIG'
    || config?.hotel?.hotelCode !== HOTEL_CODE
    || !Array.isArray(config.sources)
    || typeof config.scopeReceipt !== 'string'
    || typeof config.pseudonymKey !== 'string'
    || Buffer.from(config.pseudonymKey, 'base64url').length !== 32
  ) throw new Error('TRUSTED_DEVICE_COLLECTION_CONFIG_INVALID')
  if (state.pseudonymKey !== config.pseudonymKey) {
    mergeCurrentDeviceState(state, {
      pseudonymKey: config.pseudonymKey,
    })
  }
  return config
}

const collectOnce = async () => {
  const state = loadState()
  const { context } = await connectToOfficialBrowser(state)
  const cookies = await context.cookies('https://pms.meituan.com')
  const config = await scopedCollectionConfig(state, cookies)
  let scopeReceipt = config.scopeReceipt
  let cookieHeader = cookieHeaderFrom(cookies)

  const collectionSources = currentSourcesForTrustedDevice(config.sources)
  const previousStore = loadSnapshotStore(state.snapshotPath)
  const pseudonymKey = Buffer.from(config.pseudonymKey, 'base64url')
  const matchesCurrentPseudonymKey = (snapshot) => {
    const rooms = [
      ...(Array.isArray(snapshot?.physicalInventory)
        ? snapshot.physicalInventory
        : []),
      ...(Array.isArray(snapshot?.roomForecast)
        ? snapshot.roomForecast
        : []),
    ]
    return rooms.length > 0 && rooms.every((room) => {
      if (typeof room?.displayName !== 'string') return false
      const code = createHmac('sha256', pseudonymKey)
        .update(`room-type:${room.displayName}`)
        .digest('hex')
        .slice(0, 16)
      return room.inventoryPoolId === `PMS-${code}`
        && room.physicalRoomTypeCode === `PMS-${code}`
    })
  }
  // Releases before 2026-09-02 treated the Base64URL key as UTF-8 text.
  // Ignore those local baselines so the first corrected upload cannot report
  // a false order delta after the room identity key changes.
  const previousSnapshots = (
    previousStore[config.hotel.hotelId] ?? []
  ).filter(matchesCurrentPseudonymKey)
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
      secretKey: pseudonymKey,
      legacySecretKey: state.localHmacSecret,
      target: null,
      hotSellingRoomTypeCodes: config.hotSellingRoomTypeCodes ?? [],
    })
  } finally {
    pseudonymKey.fill(0)
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
    physicalInventory: result.snapshot.physicalInventory.map(({
      legacyPhysicalRoomTypeCode: _legacyCode,
      ...room
    }) => room),
    roomForecast: result.snapshot.roomForecast.map(({
      legacyPhysicalRoomTypeCode: _legacyCode,
      ...room
    }) => room),
  }
  let receipt
  try {
    receipt = await signedPost(
      state,
      '/api/v1/trusted-device/snapshots',
      { hotelCode: HOTEL_CODE, scopeReceipt, snapshot: cloudSnapshot },
    )
  } finally {
    scopeReceipt = null
  }
  process.stdout.write(
    `${HOTEL_CODE}采集完成：${result.snapshot.businessDate}，${result.snapshot.completeness}`
    + `${receipt.replayed ? '（云端已存在）' : '（已签名上报）'}。\n`,
  )
  return { ...result, trustedDeviceId: state.deviceId }
}

const repair = async () => {
  try {
    const result = await collectOnce()
    if (result.snapshot.completeness !== 'COMPLETE') {
      throw new Error('TRUSTED_DEVICE_REPAIR_INCOMPLETE')
    }
    process.stdout.write(`${HOTEL_CODE}一键修复完成；当前会话有效，采集与上报正常。\n`)
    return
  } catch (error) {
    const reauthenticationRequired = new Set([
      'TRUSTED_DEVICE_OFFICIAL_BROWSER_NOT_RUNNING',
      'TRUSTED_DEVICE_LOGIN_REQUIRED',
      'TRUSTED_DEVICE_STORE_SCOPE_INVALID',
      'PMS_SESSION_REAUTH_REQUIRED',
    ])
    if (!reauthenticationRequired.has(error?.message)) throw error
    await waitForOfficialLogin(loadState(), {
      forceReauthentication:
        error?.message === 'PMS_SESSION_REAUTH_REQUIRED'
        || error?.message === 'TRUSTED_DEVICE_STORE_SCOPE_INVALID',
      clearStoreScope:
        error?.message === 'TRUSTED_DEVICE_STORE_SCOPE_INVALID',
    })
  }
  const result = await collectOnce()
  if (result.snapshot.completeness !== 'COMPLETE') {
    throw new Error('TRUSTED_DEVICE_REPAIR_INCOMPLETE')
  }
  process.stdout.write(`${HOTEL_CODE}一键修复完成；登录已确认，采集与上报正常。\n`)
}

const collectIfDue = async () => {
  const state = loadState()
  const slot = collectionSlotFor()
  if (!slot || state.lastCollectionSlot === slot.slotKey) return
  const result = await collectOnce()
  mergeCurrentDeviceState(
    { ...state, deviceId: result.trustedDeviceId },
    { lastCollectionSlot: slot.slotKey },
    { abandonOnChange: true },
  )
}

const status = async () => {
  const state = loadState()
  const { context } = await connectToOfficialBrowser(state)
  const remote = await scopedCollectionConfig(
    state,
    await context.cookies('https://pms.meituan.com'),
  )
  process.stdout.write(
    `${HOTEL_CODE}可信设备正常；云端配置${remote.sources.length}个报表数据源。\n`,
  )
}

const help = () => process.stdout.write([
  '门店可信设备采集器',
  '  enroll --hotel 门店编号 --code 门店编号-XXXX-XXXX-XXXX [--server https://www.sfgzt.cn]',
  '  login --hotel 门店编号',
  '  repair --hotel 门店编号',
  '  collect-once --hotel 门店编号',
  '  collect-if-due --hotel 门店编号',
  '  status --hotel 门店编号',
].join('\n') + '\n')

try {
  if (command === 'enroll') await enroll()
  else if (command === 'login') await login()
  else if (command === 'repair') await repair()
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
