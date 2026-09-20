import { randomUUID } from 'node:crypto'
import { mkdirSync, lstatSync, realpathSync, readFileSync, writeFileSync, renameSync, existsSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { collectCtripData } from '../labs/ota-browser/ctrip-data-engine.mjs'
import { collectMeituanBusiness } from '../labs/ota-browser/meituan-data-engine.mjs'
import { CLOUD_PILOTS, CLOUD_VIEWPORT, cloudPilotFor, cloudProfileId, cloudNetworkAllowed,
  cloudError, validateCloudEnvelope } from './ota-cloud-browser-policy.mjs'

const privateDirectory = path => {
  mkdirSync(path, { recursive: true, mode: 0o700 })
  const stat = lstatSync(path)
  if (!stat.isDirectory() || stat.isSymbolicLink() || realpathSync(path) !== resolve(path)
    || (process.platform !== 'win32' && ((stat.mode & 0o077) || stat.uid !== process.getuid()))) {
    throw new Error('OTA_CLOUD_DIRECTORY_UNSAFE')
  }
}
const compactName = s => String(s ?? '').replace(/\s+/g, '').replace(/[()]/g, c => c === '(' ? '（' : '）')
export const cloudBrowserEnvironment = (environment = process.env) => Object.fromEntries(
  ['PATH', 'HOME', 'DISPLAY', 'XAUTHORITY', 'TMPDIR', 'LANG', 'XDG_CONFIG_HOME', 'XDG_CACHE_HOME']
    .filter(key => environment[key]).map(key => [key, environment[key]]),
)
export const inspectCloudHotel = async (page, pilot) => {
  if (!cloudNetworkAllowed(pilot.platformCode, page.url())) return { state: 'LOGIN_REQUIRED' }
  if (pilot.platformCode === 'CTRIP') {
    const links = await page.locator('a.he-ctrip-hotel-title-link:visible').evaluateAll(nodes => nodes.map(n => ({ href: n.href, name: n.innerText })))
    if (links.length !== 1) return { state: 'LOGIN_REQUIRED' }
    let url
    try { url = new URL(links[0].href) } catch { return { state: 'STORE_UNVERIFIED' } }
    const match = /^\/hotels\/([1-9]\d{0,14})\.html$/.exec(url.pathname)
    if (url.origin !== 'https://hotels.ctrip.com' || url.username || url.password || !match) return { state: 'STORE_UNVERIFIED' }
    if (compactName(links[0].name) !== compactName(pilot.propertyName)) return { state: 'STORE_MISMATCH' }
    return { state: 'READY', hotelId: match[1], propertyName: pilot.propertyName }
  }
  for (const frame of page.frames()) {
    const url = new URL(frame.url())
    if (!['https://me.meituan.com', 'https://eb.meituan.com'].includes(url.origin)) continue
    if (!/new-workbench|data-center-pc/.test(url.pathname)) continue
    const body = await frame.locator('body').innerText({ timeout: 4000 }).catch(() => '')
    if (compactName(body).includes(compactName(pilot.propertyName))) {
      for (const [key, value] of [['poiId', pilot.poiId], ['partnerId', pilot.partnerId]]) {
        if (url.searchParams.has(key) && url.searchParams.get(key) !== value) return { state: 'STORE_MISMATCH' }
      }
      return { state: 'READY', poiId: pilot.poiId, partnerId: pilot.partnerId, propertyName: pilot.propertyName }
    }
  }
  return { state: 'LOGIN_REQUIRED' }
}

export const launchCloudBrowser = async ({ chromium, directory, pilot, onBlocked }) => {
  privateDirectory(directory)
  const context = await chromium.launchPersistentContext(directory, {
    executablePath: process.env.OTA_CLOUD_CHROME_PATH || '/usr/bin/google-chrome',
    headless: false, chromiumSandbox: true, acceptDownloads: false,
    locale: 'zh-CN', timezoneId: 'Asia/Shanghai', viewport: CLOUD_VIEWPORT,
    serviceWorkers: 'block', timeout: 30_000,
    // Do not inherit application secrets into Chrome's environment.
    env: cloudBrowserEnvironment(),
    args: ['--no-first-run', '--no-default-browser-check', '--disable-save-password-bubble'],
  })
  try {
    await context.route('**/*', async route => {
      const request = route.request()
      if (cloudNetworkAllowed(pilot.platformCode, request.url(), request.method())) await route.continue()
      else {
        try { onBlocked(new URL(request.url()).origin) } catch { /* no raw URL or query logging */ }
        await route.abort('blockedbyclient')
      }
    })
    await context.routeWebSocket('**/*', socket => socket.close())
    const page = context.pages()[0] ?? await context.newPage()
    context.on('page', other => { if (other !== page) void other.close().catch(() => {}) })
    page.on('download', download => { void download.cancel().catch(() => {}) })
    page.on('dialog', dialog => { void dialog.dismiss().catch(() => {}) })
    await page.goto(pilot.portal, { waitUntil: 'domcontentloaded', timeout: 30_000 })
    return { context, page }
  } catch (e) { await context.close().catch(() => {}); throw e }
}

export const collectCloudData = async ({ page, pilot, binding, profileId, assertScope, progress }) => {
  if (pilot.platformCode === 'CTRIP') return collectCtripData({ page, hotelId: binding.hotelId,
    profileId, assertScope, progress, maxPages: 300 })
  // Navigate only through an already-rendered official menu, not a guessed URL.
  let frame = page.frames().find(f => /^https:\/\/eb\.meituan\.com\/newhb-sub-app\/data-center-pc\//.test(f.url()))
  if (!frame) {
    const menu = page.getByText('数据中心', { exact: true })
    if (await menu.count() !== 1) throw new Error('MEITUAN_DATA_PAGE_REQUIRED')
    await menu.click({ timeout: 5000 })
    for (let n = 0; n < 30; n++) {
      frame = page.frames().find(f => /^https:\/\/eb\.meituan\.com\/newhb-sub-app\/data-center-pc\//.test(f.url()))
      if (frame) break
      await delay(250)
    }
  }
  if (!frame) throw new Error('MEITUAN_DATA_PAGE_REQUIRED')
  const datasets = {}
  for (const period of ['YESTERDAY', 'LAST_7_DAYS', 'LAST_30_DAYS']) {
    await assertScope()
    progress({ phase: period })
    datasets[period] = await collectMeituanBusiness({ frame, scope: binding, period })
  }
  await assertScope()
  return { status: 'PARTIAL', completedAt: new Date().toISOString(), datasets,
    missing: ['STAYED_ORDERS', 'COMPLETE_PERIOD_REVIEWS', 'COMPARABLE_COMPETITOR_PRICES'], readyForAlerts: false }
}

export const createCloudBrowserManager = ({ root, chromium, now = () => Date.now(),
  launch = launchCloudBrowser, inspect = inspectCloudHotel, collect = collectCloudData,
  leaseMs = 20 * 60_000, collectionTimeoutMs = 15 * 60_000 } = {}) => {
  privateDirectory(root)
  const profiles = join(root, 'profiles'); privateDirectory(profiles)
  const states = join(root, 'snapshots'); privateDirectory(states)
  const sessions = new Map(), locks = new Set(), snapshots = new Map()
  let closing = false
  for (const pilot of CLOUD_PILOTS) {
    const path = join(states, `${cloudProfileId(pilot)}.json`)
    if (existsSync(path)) {
      const stat = lstatSync(path)
      if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size > 2 * 1024 * 1024) throw new Error('OTA_CLOUD_SNAPSHOT_INVALID')
      const stored = JSON.parse(readFileSync(path, 'utf8'))
      if (stored.version !== 1 || stored.profileId !== cloudProfileId(pilot)) throw new Error('OTA_CLOUD_SNAPSHOT_INVALID')
      snapshots.set(stored.profileId, stored)
    }
  }
  const save = (key, data) => {
    const file = join(states, `${key}.json`), temp = `${file}.${randomUUID()}.tmp`
    const value = { version: 1, profileId: key, ...data }
    writeFileSync(temp, JSON.stringify(value), { flag: 'wx', mode: 0o600 })
    renameSync(temp, file); snapshots.set(key, value)
  }
  const close = async key => {
    const session = sessions.get(key)
    if (!session) return
    clearTimeout(session.timer)
    session.closed = true
    await session.context.close().catch(() => {})
    if (sessions.get(key) === session) sessions.delete(key)
  }
  const view = (pilot, actorId) => {
    const key = cloudProfileId(pilot), session = sessions.get(key), saved = snapshots.get(key)
    const owned = session?.actorId === actorId
    return { platformCode: pilot.platformCode, label: pilot.label,
      status: session?.status ?? (saved?.binding ? 'SESSION_SAVED' : 'NOT_CONNECTED'),
      sessionId: owned ? session.id : null, controlledByOther: Boolean(session && !owned),
      nextSequence: owned ? session.sequence + 1 : null,
      expiresAt: owned ? new Date(session.expiresAt).toISOString() : null,
      viewport: CLOUD_VIEWPORT, busy: Boolean(session?.collecting || (!session && locks.has(key))),
      lastErrorCode: session?.error ?? null, progress: session?.progress ?? null,
      binding: saved?.binding ?? null, latest: saved?.latest ?? null,
      blockedOrigins: owned ? [...session.blocked].slice(0, 24) : [],
      automationEnabled: false, alertsEnabled: false, acceptance: 'CLOUD_PILOT_NOT_PRODUCTION_ACCEPTED' }
  }
  const execute = async raw => {
    const body = validateCloudEnvelope(raw), pilot = cloudPilotFor(body), key = cloudProfileId(pilot)
    if (closing) throw new Error('OTA_CLOUD_UNAVAILABLE')
    if (body.action === 'status') return view(pilot, body.actorId)
    if (locks.has(key)) throw new Error('OTA_CLOUD_BUSY')
    locks.add(key)
    try {
      let session = sessions.get(key)
      if (body.action === 'open') {
        if (session?.expiresAt <= now()) { await close(key); session = null }
        if (session && session.actorId !== body.actorId) throw new Error('OTA_CLOUD_IN_USE')
        if (!session) {
          if (sessions.size >= 2) throw new Error('OTA_CLOUD_CAPACITY_REACHED')
          const blocked = new Set()
          const browser = await launch({ chromium, directory: join(profiles, key), pilot,
            onBlocked: origin => { if (blocked.size < 24) blocked.add(origin) } })
          session = { ...browser, id: randomUUID(), actorId: body.actorId, sequence: 0,
            status: 'LOGIN_REQUIRED', error: null, blocked, expiresAt: now() + leaseMs, closed: false }
          sessions.set(key, session)
          session.context.on?.('close', () => {
            clearTimeout(session.timer); session.closed = true
            if (sessions.get(key) === session) sessions.delete(key)
          })
          session.timer = setTimeout(() => { void close(key) }, leaseMs).unref()
        }
        return view(pilot, body.actorId)
      }
      if (!session || session.closed || session.id !== body.sessionId || session.actorId !== body.actorId || session.expiresAt <= now()) {
        throw new Error('OTA_CLOUD_SESSION_EXPIRED')
      }
      if (body.action === 'close') { await close(key); return view(pilot, body.actorId) }
      if (body.action === 'frame') {
        if (!cloudNetworkAllowed(pilot.platformCode, session.page.url())) throw new Error('OTA_CLOUD_NAVIGATION_BLOCKED')
        const jpeg = await session.page.screenshot({ type: 'jpeg', quality: 65, timeout: 8000 })
        if (jpeg.length > 1500000) throw new Error('OTA_CLOUD_FRAME_TOO_LARGE')
        return { ...view(pilot, body.actorId), frame: `data:image/jpeg;base64,${jpeg.toString('base64')}` }
      }
      if (session.collecting) throw new Error('OTA_CLOUD_BUSY')
      if (body.action === 'input') {
        if (body.sequence <= session.sequence) return view(pilot, body.actorId)
        if (body.sequence !== session.sequence + 1) throw new Error('OTA_CLOUD_INPUT_SEQUENCE')
        session.sequence = body.sequence
        const input = body.input
        if (!cloudNetworkAllowed(pilot.platformCode, session.page.url())) throw new Error('OTA_CLOUD_NAVIGATION_BLOCKED')
        if (input.type === 'pointer') {
          const [first, ...rest] = input.points
          await session.page.mouse.move(first.x, first.y)
          await session.page.mouse.down()
          try { for (const point of rest) { await session.page.mouse.move(point.x, point.y); await delay(12) } }
          finally { await session.page.mouse.up().catch(() => {}) }
        } else if (input.type === 'text') {
          try { await session.page.keyboard.insertText(input.text) } finally { input.text = '' }
        } else if (input.type === 'key') await session.page.keyboard.press(input.key)
        else await session.page.mouse.wheel(0, input.delta)
        return view(pilot, body.actorId)
      }
      const identity = await inspect(session.page, pilot)
      session.status = identity.state
      if (identity.state !== 'READY') { session.error = 'OTA_CLOUD_LOGIN_OR_STORE_REQUIRED'; return view(pilot, body.actorId) }
      const previous = snapshots.get(key)
      if (previous?.binding?.hotelId && identity.hotelId !== previous.binding.hotelId) throw new Error('OTA_CLOUD_STORE_CHANGED')
      save(key, { binding: identity, latest: previous?.latest ?? null })
      session.error = null
      if (body.action === 'inspect') return view(pilot, body.actorId)
      if (body.action === 'collect') {
        session.collecting = true; session.status = 'COLLECTING'
        const assertScope = async () => {
          if (session.closed || sessions.get(key) !== session) throw new Error('OTA_CLOUD_SESSION_EXPIRED')
          const current = await inspect(session.page, pilot)
          if (JSON.stringify(current) !== JSON.stringify(identity)) throw new Error('OTA_CLOUD_STORE_CHANGED')
        }
        const timeout = setTimeout(() => { session.error = 'OTA_CLOUD_COLLECTION_TIMEOUT'; void close(key) }, collectionTimeoutMs).unref()
        session.task = Promise.resolve().then(() => collect({ page: session.page, pilot, binding: identity,
          profileId: key, assertScope, progress: value => { session.progress = value } }))
          .then(async latest => {
            await assertScope()
            save(key, { binding: identity, latest })
            session.status = latest.status === 'COMPLETE' ? 'READY' : 'PARTIAL'
          }).catch(e => { session.error = cloudError(e); session.status = 'COLLECTION_FAILED' })
          .finally(() => { clearTimeout(timeout); session.collecting = false })
      }
      return view(pilot, body.actorId)
    } catch (e) {
      const session = sessions.get(key)
      if (session?.actorId === body.actorId) session.error = cloudError(e)
      throw new Error(cloudError(e))
    } finally { locks.delete(key) }
  }
  return { execute, async closeAll() { closing = true; await Promise.all([...sessions.keys()].map(close)) } }
}
