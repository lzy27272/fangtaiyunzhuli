import { createHash, randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { monitorFromSnapshot } from './live-report-collector.mjs'
import { parseLuopanForecastTable } from './luopan-forecast-parser.mjs'
import {
  luopanProfileName,
  luopanProfilePaths,
} from './luopan-profile.mjs'
import { isAuthenticationUrl } from './luopan-network-sanitizer.mjs'
import { applyLuopanSessionState } from './luopan-session-state.mjs'

const require = createRequire(import.meta.url)
let cachedChromium = null
const chromiumFor = () => {
  if (cachedChromium) return cachedChromium
  try {
    const module = require(
      process.env.UAT_PLAYWRIGHT_MODULE ?? 'playwright',
    )
    cachedChromium = module.chromium
    return cachedChromium
  } catch {
    throw new Error('LUOPAN_BROWSER_RUNTIME_UNAVAILABLE')
  }
}
const toolRoot = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(toolRoot, '..', '..')
const homeUrl =
  'http://bj.chinapms.com:8880/pms-web/home/hg_index.do'
const forecastUrl =
  'http://bj.chinapms.com:8880/pms-web/post/room_forecast.do'
const SHANGHAI_OFFSET = '+08:00'

const browserExecutableFor = () =>
  process.env.LUOPAN_BROWSER_EXECUTABLE
  || process.env.UAT_BROWSER_EXECUTABLE
  || [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  ].find(existsSync)

const profileRootFor = (profileRef) => {
  const profileName = luopanProfileName({
    argv: ['node', 'collector', `--profile=${profileRef}`],
    env: {},
  })
  const rootOverride =
    process.env.LUOPAN_BROWSER_PROFILE_BASE?.trim()
  if (rootOverride) {
    return {
      profileName,
      profileRoot: path.join(rootOverride, profileName, 'browser-profile'),
    }
  }
  return {
    profileName,
    profileRoot:
      luopanProfilePaths({ repoRoot, profileName }).profileRoot,
  }
}

const localParts = (date) => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date)
  return Object.fromEntries(
    parts
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, part.value]),
  )
}

const localIso = (date) => {
  const parts = localParts(date)
  return `${parts.year}-${parts.month}-${parts.day}`
    + `T${parts.hour}:${parts.minute}:${parts.second}${SHANGHAI_OFFSET}`
}

const finiteNumber = (value) => {
  if (value === null || value === undefined || value === '') return null
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

const rounded = (value, digits = 2) =>
  value === null || value === undefined
    ? null
    : Number(Number(value).toFixed(digits))

const canonicalBusinessDate = (value) => {
  const text = String(value ?? '').trim()
  const match = text.match(
    /(?:^|[^\d])(\d{4})[-/]?(\d{2})[-/]?(\d{2})(?:[^\d]|$)/,
  )
  if (!match) return null
  const normalized = `${match[1]}-${match[2]}-${match[3]}`
  const parsed = new Date(`${normalized}T00:00:00Z`)
  return !Number.isNaN(parsed.getTime())
    && parsed.toISOString().slice(0, 10) === normalized
      ? normalized
      : null
}

const addCalendarDays = (date, days) => {
  const parsed = new Date(`${date}T00:00:00Z`)
  parsed.setUTCDate(parsed.getUTCDate() + days)
  return parsed.toISOString().slice(0, 10)
}

const selectedFingerprint = (option) =>
  createHash('sha256')
    .update(`${option.value}\u0000${option.label}`)
    .digest('hex')
    .slice(0, 16)

const launchContext = async (profileRef, sessionState = null) => {
  const chromium = chromiumFor()
  const browserExecutable = browserExecutableFor()
  if (!browserExecutable || !existsSync(browserExecutable)) {
    throw new Error('LUOPAN_BROWSER_NOT_FOUND')
  }
  const { profileName, profileRoot } = profileRootFor(profileRef)
  if (!existsSync(profileRoot)) {
    throw new Error('LUOPAN_BROWSER_PROFILE_NOT_FOUND')
  }
  const context = await chromium.launchPersistentContext(profileRoot, {
    headless: true,
    executablePath: browserExecutable,
    acceptDownloads: false,
    locale: 'zh-CN',
    timezoneId: 'Asia/Shanghai',
    viewport: { width: 1440, height: 960 },
    args: [
      '--disable-features=PasswordManagerOnboarding,PasswordLeakDetection',
      '--disable-save-password-bubble',
      '--no-default-browser-check',
      '--no-first-run',
    ],
  })
  await applyLuopanSessionState(context, sessionState)
  return { context, profileName }
}

const readSingleHotelScope = async (page) => {
  const raw = await page.evaluate(async () => {
    const select = document.querySelector('select[name="hotel_id"]')
    if (!select) return null
    const options = [...select.options]
      .filter((option) =>
        String(option.value ?? '').trim()
        || String(option.textContent ?? '').trim())
      .map((option) => ({
        value: String(option.value ?? ''),
        label: String(option.textContent ?? '')
          .replace(/\s+/g, ' ')
          .trim(),
        selected: option.selected,
      }))
    const selected = options.filter((option) => option.selected)
    let businessDateText = ''
    if (selected.length === 1) {
      try {
        const response = await fetch(
          '/pms-web/ajax/get_hotel_today_date.json?hotel_id='
            + encodeURIComponent(selected[0].value),
          {
            credentials: 'same-origin',
            headers: { Accept: 'application/json, text/plain, */*' },
          },
        )
        if (response.ok) businessDateText = (await response.text()).slice(0, 500)
      } catch {
        businessDateText = ''
      }
    }
    return { options, selected, businessDateText }
  })
  if (!raw) throw new Error('LUOPAN_HOTEL_SCOPE_UNVERIFIED')
  if (raw.options.length !== 1 || raw.selected.length !== 1) {
    throw new Error('LUOPAN_HOTEL_SCOPE_AMBIGUOUS')
  }
  const businessDate = canonicalBusinessDate(raw.businessDateText)
  if (!businessDate) throw new Error('LUOPAN_BUSINESS_DATE_UNAVAILABLE')
  return {
    optionCount: raw.options.length,
    fingerprint: selectedFingerprint(raw.selected[0]),
    businessDate,
  }
}

const verifyFingerprint = (actual, expected) => {
  if (
    typeof expected === 'string'
    && expected
    && actual !== expected
  ) {
    throw new Error('LUOPAN_HOTEL_SCOPE_CHANGED')
  }
}

const queryForecastRows = async (page, businessDate) => {
  await page.goto(forecastUrl, {
    waitUntil: 'domcontentloaded',
    timeout: 30_000,
  })
  if (isAuthenticationUrl(page.url())) {
    throw new Error('LUOPAN_REAUTH_REQUIRED')
  }
  const navigation = page.waitForNavigation({
    waitUntil: 'domcontentloaded',
    timeout: 30_000,
  })
  const submitted = await page.evaluate((date) => {
    const form = [...document.forms].find((candidate) =>
      /\/post\/room_forecast\.do/i.test(
        candidate.getAttribute('action') ?? '',
      ))
    const input = form?.querySelector('input[name="start_date"]')
    if (!form || !input) return false
    input.value = date
    form.submit()
    return true
  }, businessDate)
  if (!submitted) throw new Error('LUOPAN_FORECAST_FORM_UNAVAILABLE')
  await navigation
  await page.waitForTimeout(1_500)
  const tableRows = await page.evaluate(() => {
    const clean = (value) =>
      String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, 160)
    const table = [...document.querySelectorAll('table')].find(
      (candidate) => clean(candidate.textContent).includes('全部可售房'),
    )
    if (!table) return null
    return [...table.querySelectorAll('tr')]
      .slice(0, 500)
      .map((row) => [...row.querySelectorAll('th, td')]
        .map((cell) => clean(cell.textContent))
        .slice(0, 100))
      .filter((row) => row.some(Boolean))
  })
  if (!tableRows) throw new Error('LUOPAN_FORECAST_TABLE_UNAVAILABLE')
  return tableRows
}

const closestBaseline = ({
  previousSnapshots,
  observedAtMs,
  offsetHours,
}) =>
  previousSnapshots
    .filter(
      (snapshot) =>
        snapshot?.sourceSystem === 'LUOPAN_CLOUD'
        && snapshot?.overview
        && Number.isFinite(new Date(snapshot.observedAt).getTime()),
    )
    .map((snapshot) => ({
      snapshot,
      distance: Math.abs(
        new Date(snapshot.observedAt).getTime()
        - (observedAtMs - offsetHours * 60 * 60 * 1000),
      ),
    }))
    .filter((candidate) => candidate.distance <= 20 * 60 * 1000)
    .sort((left, right) => left.distance - right.distance)[0]?.snapshot ?? null

const metricDeltaFor = (
  snapshot,
  previousSnapshots,
  observedAtMs,
) => {
  const firstMorning =
    /^\d{4}-\d{2}-\d{2}T08:0[0-5]/.test(snapshot.observedAt)
  const previous = closestBaseline({
    previousSnapshots,
    observedAtMs,
    offsetHours: firstMorning ? 6 : 1,
  })
  if (!previous) {
    return {
      basis: 'BASELINE_PENDING',
      aggregationWindow: null,
      intervalStartAt: null,
      intervalEndAt: snapshot.observedAt,
      totals: null,
      byChannel: null,
      metricDelta: null,
    }
  }
  const delta = (field) => {
    const current = finiteNumber(snapshot.overview?.[field])
    const old = finiteNumber(previous.overview?.[field])
    return current === null || old === null ? null : rounded(current - old)
  }
  return {
    basis: 'HOURLY_SNAPSHOT_DIFF',
    aggregationWindow:
      firstMorning ? 'PAUSE_TO_FIRST_BRIEF' : 'HOURLY',
    intervalStartAt: previous.observedAt,
    intervalEndAt: snapshot.observedAt,
    totals: null,
    byChannel: null,
    metricDelta: {
      roomFee: delta('roomFee'),
      adr: delta('adr'),
      revPar: delta('revPar'),
      roomNights: delta('roomNights'),
    },
  }
}

const futureBookingChangesFor = (
  snapshot,
  previousSnapshots,
  observedAtMs,
) => {
  const hourly = closestBaseline({
    previousSnapshots,
    observedAtMs,
    offsetHours: 1,
  })
  const observedDate = snapshot.observedAt.slice(0, 10)
  const yesterday = previousSnapshots
    .filter(
      (candidate) =>
        candidate?.sourceSystem === 'LUOPAN_CLOUD'
        && Array.isArray(candidate.futureDaily)
        && candidate.observedAt?.slice(0, 10) < observedDate,
    )
    .sort((left, right) =>
      String(right.observedAt).localeCompare(String(left.observedAt)))[0] ?? null
  const hourlyRows = new Map(
    (hourly?.futureDaily ?? []).map((row) => [row.stayDate, row]),
  )
  const yesterdayRows = new Map(
    (yesterday?.futureDaily ?? []).map((row) => [row.stayDate, row]),
  )
  return {
    basis:
      hourly || yesterday ? 'FUTURE_SNAPSHOT_DIFF' : 'BASELINE_PENDING',
    hourlyBaselineAt: hourly?.observedAt ?? null,
    previousDayEndAt: yesterday?.observedAt ?? null,
    daily: snapshot.futureDaily.map((row) => {
      const hourlyRow = hourlyRows.get(row.stayDate)
      const yesterdayRow = yesterdayRows.get(row.stayDate)
      const sold = finiteNumber(row.soldRooms)
      const hourlySold = finiteNumber(hourlyRow?.soldRooms)
      const yesterdaySold = finiteNumber(yesterdayRow?.soldRooms)
      const hourlyNetRoomNights =
        sold === null || hourlySold === null
          ? null
          : rounded(sold - hourlySold)
      const roomFee = finiteNumber(row.roomFee)
      const hourlyRoomFee = finiteNumber(hourlyRow?.roomFee)
      const inferredHourlyAdr =
        hourlyNetRoomNights !== null
        && hourlyNetRoomNights > 0
        && roomFee !== null
        && hourlyRoomFee !== null
          ? rounded((roomFee - hourlyRoomFee) / hourlyNetRoomNights)
          : null
      return {
        ...row,
        bookedRoomNights: sold,
        occupancyPercent: row.occupancyRate,
        hourlyNetRoomNights,
        previousDayNetRoomNights:
          sold === null || yesterdaySold === null
            ? null
            : rounded(sold - yesterdaySold),
        hourlyAdrDelta:
          finiteNumber(row.adr) === null
          || finiteNumber(hourlyRow?.adr) === null
            ? null
            : rounded(
                finiteNumber(row.adr) - finiteNumber(hourlyRow.adr),
              ),
        inferredHourlyAdr,
      }
    }),
  }
}

const safeCollectorError = (error) => {
  const code = String(error?.message ?? '')
  const allowed = new Set([
    'LUOPAN_BROWSER_NOT_FOUND',
    'LUOPAN_BROWSER_PROFILE_NOT_FOUND',
    'LUOPAN_BROWSER_RUNTIME_UNAVAILABLE',
    'LUOPAN_BUSINESS_DATE_UNAVAILABLE',
    'LUOPAN_FORECAST_DATES_INVALID',
    'LUOPAN_FORECAST_FORM_UNAVAILABLE',
    'LUOPAN_FORECAST_TABLE_INVALID',
    'LUOPAN_FORECAST_TABLE_UNAVAILABLE',
    'LUOPAN_HOTEL_SCOPE_AMBIGUOUS',
    'LUOPAN_HOTEL_SCOPE_CHANGED',
    'LUOPAN_HOTEL_SCOPE_UNVERIFIED',
    'LUOPAN_REAUTH_REQUIRED',
  ])
  return allowed.has(code) ? code : 'LUOPAN_COLLECTION_FAILED'
}

export const validateLuopanBrowserSession = async ({
  profileRef,
  expectedHotelFingerprint = null,
  sessionState = null,
  now = new Date(),
}) => {
  const { context, profileName } = await launchContext(
    profileRef,
    sessionState,
  )
  try {
    const page = context.pages()[0] ?? await context.newPage()
    await page.goto(homeUrl, {
      waitUntil: 'domcontentloaded',
      timeout: 30_000,
    })
    if (isAuthenticationUrl(page.url())) {
      throw new Error('LUOPAN_REAUTH_REQUIRED')
    }
    const scope = await readSingleHotelScope(page)
    verifyFingerprint(scope.fingerprint, expectedHotelFingerprint)
    return {
      profileRef: profileName,
      scopeStatus: 'SINGLE_HOTEL_CONFIRMED',
      hotelFingerprint: scope.fingerprint,
      businessDate: scope.businessDate,
      validatedAt: localIso(now),
      hotelOptionCount: scope.optionCount,
    }
  } finally {
    await context.close()
  }
}

export const collectLuopanControlledBrowser = async ({
  hotel,
  profileRef,
  expectedHotelFingerprint,
  previousSnapshots = [],
  secretKey,
  sessionState = null,
  target = null,
  hotSellingRoomTypeCodes = [],
  now = new Date(),
}) => {
  if (
    !hotel
    || typeof expectedHotelFingerprint !== 'string'
    || !/^[a-f0-9]{16}$/.test(expectedHotelFingerprint)
  ) {
    throw new Error('LUOPAN_SESSION_VALIDATION_REQUIRED')
  }
  const { context } = await launchContext(profileRef, sessionState)
  try {
    const page = context.pages()[0] ?? await context.newPage()
    await page.goto(homeUrl, {
      waitUntil: 'domcontentloaded',
      timeout: 30_000,
    })
    if (isAuthenticationUrl(page.url())) {
      throw new Error('LUOPAN_REAUTH_REQUIRED')
    }
    const scope = await readSingleHotelScope(page)
    verifyFingerprint(scope.fingerprint, expectedHotelFingerprint)
    const tableRows = await queryForecastRows(page, scope.businessDate)
    const parsed = parseLuopanForecastTable({
      rows: tableRows,
      businessDate: scope.businessDate,
      secretKey,
    })
    const futureEndDate = addCalendarDays(scope.businessDate, 14)
    const futureTableRows = await queryForecastRows(page, futureEndDate)
    const futurePage = parseLuopanForecastTable({
      rows: futureTableRows,
      businessDate: futureEndDate,
      secretKey,
    })
    const futureDaily = [
      ...parsed.futureDaily,
      futurePage.current,
      ...futurePage.futureDaily,
    ]
      .filter(
        (row) =>
          row.stayDate > scope.businessDate
          && row.stayDate <= futureEndDate,
      )
      .filter(
        (row, index, rows) =>
          rows.findIndex((candidate) =>
            candidate.stayDate === row.stayDate) === index,
      )
      .sort((left, right) =>
        left.stayDate.localeCompare(right.stayDate))
    const observedAt = localIso(now)
    const collectionRunId = randomUUID()
    const ingestedAt = localIso(new Date())
    const snapshot = {
      schemaVersion: 1,
      sourceSystem: 'LUOPAN_CLOUD',
      sourceScopeFingerprint: scope.fingerprint,
      collectionRunId,
      tenantId: hotel.tenantId,
      hotelId: hotel.hotelId,
      businessDate: parsed.businessDate,
      businessDateBasis: 'PMS_CONFIRMED',
      businessDateSource: 'LUOPAN_CLOUD',
      businessDateStartedAt: null,
      previousBusinessDate: null,
      businessDateChanged: false,
      observedAt,
      completeness: 'PARTIAL',
      sources: [
        {
          sourceId: 'LUOPAN_BUSINESS_DATE',
          sourceCode: 'LUOPAN_BUSINESS_DATE',
          reportType: 'BUSINESS_DAY',
          completeness: 'COMPLETE',
          observedAt,
          ingestedAt,
          errorCode: null,
        },
        {
          sourceId: 'LUOPAN_ROOM_FORECAST',
          sourceCode: 'LUOPAN_ROOM_FORECAST',
          reportType: 'ROOM_REVENUE',
          completeness: 'COMPLETE',
          observedAt,
          ingestedAt,
          errorCode: null,
        },
        {
          sourceId: 'LUOPAN_PHYSICAL_INVENTORY',
          sourceCode: 'LUOPAN_PHYSICAL_INVENTORY',
          reportType: 'PHYSICAL_INVENTORY',
          completeness: 'COMPLETE',
          observedAt,
          ingestedAt,
          errorCode: null,
        },
        {
          sourceId: 'LUOPAN_ORDER_DETAIL',
          sourceCode: 'LUOPAN_ORDER_DETAIL',
          reportType: 'ORDER_DETAIL',
          completeness: 'UNAVAILABLE',
          observedAt,
          ingestedAt,
          errorCode: 'LUOPAN_ORDER_DETAIL_NOT_CONFIGURED',
        },
      ],
      orders: null,
      overview: parsed.current,
      futureDaily,
      physicalInventory: parsed.physicalInventory,
      roomForecast: parsed.roomForecast,
    }
    snapshot.hourlyDelta = metricDeltaFor(
      snapshot,
      previousSnapshots,
      now.getTime(),
    )
    snapshot.futureBookingChanges = futureBookingChangesFor(
      snapshot,
      previousSnapshots,
      now.getTime(),
    )
    return {
      run: {
        runId: collectionRunId,
        status: 'PARTIAL',
        requestedAt: observedAt,
        completedAt: localIso(new Date()),
        businessDate: parsed.businessDate,
        previousBusinessDate: null,
        businessDateChanged: false,
        businessDateSource: 'LUOPAN_CLOUD',
        businessDateStartedAt: null,
        sourceCount: 4,
        successfulSourceCount: 3,
        outboundDeliveryAttempted: false,
      },
      snapshot,
      monitor: monitorFromSnapshot(
        snapshot,
        hotel,
        target,
        hotSellingRoomTypeCodes,
      ),
    }
  } catch (error) {
    throw new Error(safeCollectorError(error))
  } finally {
    await context.close()
  }
}
