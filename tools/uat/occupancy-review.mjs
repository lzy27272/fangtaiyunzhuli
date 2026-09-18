import { createHash, randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

export const OCCUPANCY_TIMES = Object.freeze(['12:00', '15:00', '18:00', '21:00', '23:00'])
const DAY_MS = 86_400_000
const MAX_SAMPLE_AGE_MS = 90 * 60_000
const round = (value) => Math.round(value * 10) / 10
const number = (value) => value === null || value === undefined || (typeof value === 'string' && !value.trim()) || typeof value === 'boolean'
  ? null : Number.isFinite(Number(value)) ? Number(value) : null
const percent = (value) => {
  const parsed = number(value)
  return parsed !== null && parsed >= 0 && parsed <= 100 ? round(parsed) : null
}
export const validDate = (value) => typeof value === 'string'
  && /^\d{4}-\d{2}-\d{2}$/.test(value)
  && Number.isFinite(Date.parse(`${value}T00:00:00Z`))
  && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value
export const shanghaiDate = (now = new Date()) => new Date(now.getTime() + 8 * 3_600_000).toISOString().slice(0, 10)
export const addDays = (date, count) => new Date(Date.parse(`${date}T00:00:00Z`) + count * DAY_MS).toISOString().slice(0, 10)
export const weekStart = (date) => addDays(date, -(new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7)
const cutoff = (date, time) => Date.parse(`${date}T${time}:00+08:00`)
const keyFor = (point) => `${point.date}/${point.time}`
const scopeKey = ({ tenantId, hotelId }) => JSON.stringify([tenantId, hotelId])
const fail = (code) => { throw new Error(`OCCUPANCY_${code}`) }

export function periodBounds(type, date) {
  if (!['WEEK', 'MONTH'].includes(type) || !validDate(date)) fail('PERIOD_INVALID')
  const start = type === 'WEEK' ? weekStart(date) : `${date.slice(0, 7)}-01`
  const end = type === 'WEEK' ? addDays(start, 6)
    : addDays(new Date(Date.UTC(Number(start.slice(0, 4)), Number(start.slice(5, 7)), 1)).toISOString().slice(0, 10), -1)
  return { type, start, end, expectedDays: Math.round((Date.parse(end) - Date.parse(start)) / DAY_MS) + 1 }
}

function previousPeriod(type, start, year = false) {
  // Week YoY compares the same weekdays (52 weeks), not a shifted calendar date.
  if (type === 'WEEK') return addDays(start, year ? -364 : -7)
  return new Date(Date.UTC(Number(start.slice(0, 4)) - (year ? 1 : 0), Number(start.slice(5, 7)) - (year ? 1 : 2), 1))
    .toISOString().slice(0, 10)
}

function summarize(history, bounds, today) {
  const stored = history.periods?.find((row) => row.type === bounds.type && row.start === bounds.start)
  if (stored) return { ...bounds, occupancyPercent: percent(stored.occupancyPercent), availableDays: stored.availableDays,
    complete: stored.availableDays === bounds.expectedDays && bounds.end < today && percent(stored.occupancyPercent) !== null }
  const days = (history.daily ?? []).filter((day) => day.date >= bounds.start && day.date <= bounds.end
    && percent(day.occupancyPercent) !== null && number(day.roomCount) > 0)
  const capacity = days.reduce((sum, day) => sum + Number(day.roomCount), 0)
  return { ...bounds, occupancyPercent: capacity > 0
    ? round(days.reduce((sum, day) => sum + Number(day.occupancyPercent) * Number(day.roomCount), 0) / capacity) : null,
  availableDays: days.length, complete: days.length === bounds.expectedDays && bounds.end < today }
}

export function buildOccupancyReview({ history, type = 'WEEK', date, now = new Date() }) {
  const today = shanghaiDate(now)
  const bounds = periodBounds(type, date ?? (type === 'WEEK' ? addDays(weekStart(today), -7) : addDays(`${today.slice(0, 7)}-01`, -1)))
  if (bounds.start > today || bounds.start < addDays(today, -5 * 366)) fail('PERIOD_OUT_OF_RANGE')
  const current = summarize(history, bounds, today)
  const prior = summarize(history, periodBounds(type, previousPeriod(type, bounds.start)), today)
  const priorYear = summarize(history, periodBounds(type, previousPeriod(type, bounds.start, true)), today)
  const comparison = (baseline) => ({ ...baseline,
    deltaPp: current.complete && baseline.complete ? round(current.occupancyPercent - baseline.occupancyPercent) : null })
  const daily = new Map((history.daily ?? []).map((day) => [day.date, day]))
  const pace = new Map((history.pace ?? []).map((point) => [keyFor(point), point]))
  const days = Array.from({ length: bounds.expectedDays }, (_, index) => {
    const stayDate = addDays(bounds.start, index)
    return { date: stayDate, occupancyPercent: percent(daily.get(stayDate)?.occupancyPercent),
      observedAt: daily.get(stayDate)?.observedAt ?? null,
      points: OCCUPANCY_TIMES.map((time) => ({ time, ...historicalPoint(pace.get(`${stayDate}/${time}`), stayDate, time, now) })) }
  })
  return { ...current, prior: comparison(prior), priorYear: comparison(priorYear), days,
    comparisonBasis: type === 'WEEK' ? 'SAME_WEEKDAYS_52_WEEKS' : 'SAME_CALENDAR_MONTH',
    note: current.complete ? '按 PMS 房量加权汇总，非每日百分比简单平均。'
      : `有效日末数据 ${current.availableDays}/${current.expectedDays} 天；未完整结期，不计算环比、同比。` }
}

function historicalPoint(point, date, time, now) {
  const observed = Date.parse(point?.observedAt ?? '')
  const at = cutoff(date, time)
  const value = percent(point?.occupancyPercent)
  const usable = value !== null && Number.isFinite(observed) && observed <= at
    && at - observed <= MAX_SAMPLE_AGE_MS && at <= now.getTime()
  return { occupancyPercent: usable ? value : null, observedAt: usable ? point.observedAt : null }
}

export function buildOccupancyPlan({ history, start, approved = null, now = new Date() }) {
  const today = shanghaiDate(now)
  start ??= weekStart(today)
  if (!validDate(start) || start !== weekStart(start)) fail('WEEK_INVALID')
  if (start < addDays(weekStart(today), -7 * 104) || start > addDays(weekStart(today), 28)) fail('WEEK_OUT_OF_RANGE')
  const pace = new Map((history.pace ?? []).map((point) => [keyFor(point), point]))
  const targets = new Map((approved?.points ?? []).map((point) => [keyFor(point), point.percent]))
  const days = Array.from({ length: 7 }, (_, index) => {
    const date = addDays(start, index)
    const baselineDate = addDays(date, -7)
    const points = OCCUPANCY_TIMES.map((time) => {
      const baseline = historicalPoint(pace.get(`${baselineDate}/${time}`), baselineDate, time, now)
      const actual = historicalPoint(pace.get(`${date}/${time}`), date, time, now)
      const target = targets.get(`${date}/${time}`) ?? null
      const due = cutoff(date, time) <= now.getTime()
      return { date, time, baselineDate, baselinePercent: baseline.occupancyPercent,
        baselineObservedAt: baseline.observedAt, suggestedPercent: baseline.occupancyPercent,
        targetPercent: target, actualPercent: actual.occupancyPercent, actualObservedAt: actual.observedAt,
        editable: !due, gapPp: target !== null && actual.occupancyPercent !== null ? round(actual.occupancyPercent - target) : null,
        status: target === null ? 'UNSET' : !due ? 'PENDING' : actual.occupancyPercent === null ? 'MISSING'
          : actual.occupancyPercent >= target ? 'MET' : 'BEHIND' }
    })
    let fastest = null
    for (let i = 1; i < points.length; i += 1) {
      const previous = points[i - 1], current = points[i]
      if (previous.baselinePercent === null || current.baselinePercent === null) continue
      const gain = round(current.baselinePercent - previous.baselinePercent)
      if (gain > 0 && (!fastest || gain > fastest.gain)) fastest = { from: previous.time, to: current.time, gain }
    }
    const covered = points.filter((point) => point.suggestedPercent !== null).length
    return { date, baselineDate, points, advice: covered === 0
      ? '上周同日无可用时点数据，暂不生成数值建议；可手工设定尚未到期的目标。'
      : `${covered}/${OCCUPANCY_TIMES.length} 个时点可参考。${fastest
        ? `上周 ${fastest.from}–${fastest.to} 出租率净增 ${fastest.gain} 个百分点，可重点关注该时段。`
        : '未观察到可确认的主要增长时段。'}建议先参考上周同日水平，再结合节假日、团单和实际房量调整。` }
  })
  return { weekStart: start, weekEnd: addDays(start, 6), baselineWeekStart: addDays(start, -7),
    version: approved?.version ?? 0, approvedAt: approved?.approvedAt ?? null, approvedBy: approved?.approvedBy ?? null,
    reason: approved?.reason ?? null, days,
    note: '建议不自动生效；确认后才作为目标。历史数据仅代表已采集时点，不是新增订单量。' }
}

export function currentOccupancy(snapshot, now = new Date()) {
  if (!snapshot || snapshot.completeness === 'UNAVAILABLE' || snapshot.businessDate !== shanghaiDate(now)) return null
  const total = number(snapshot.overview?.roomCount)
  const sold = number(snapshot.overview?.soldRooms)
  const rawRate = number(snapshot.overview?.occupancyRate)
  // soldRooms is already the PMS's combined in-house + reserved measure.
  // Never add orderRooms/checkinRooms to it: those are overlapping in some PMSs.
  const value = total > 0 && sold !== null ? percent(sold / total * 100)
    : total > 0 && rawRate !== null ? percent(snapshot.sourceSystem === 'LUOPAN_CLOUD' ? rawRate : rawRate <= 1 ? rawRate * 100 : rawRate) : null
  const observed = Date.parse(snapshot.observedAt)
  if (value === null || !Number.isFinite(observed) || observed > now.getTime()) return null
  return { date: snapshot.businessDate, occupancyPercent: value, observedAt: snapshot.observedAt,
    stale: now.getTime() - observed > MAX_SAMPLE_AGE_MS }
}

export function createOccupancyReviewService({ historyPath, targetPath, clock = () => new Date() }) {
  let cachedSignature = null
  let cachedHistory = null
  const readHistory = () => {
    if (!historyPath || !existsSync(historyPath)) return null
    try {
      const stat = statSync(historyPath)
      if (stat.size > 128 * 1024 * 1024) return null
      const signature = `${stat.mtimeMs}:${stat.size}`
      if (signature !== cachedSignature) {
        const parsed = JSON.parse(readFileSync(historyPath, 'utf8'))
        if (parsed.schemaVersion !== 1 || !Array.isArray(parsed.hotels) || !Number.isFinite(Date.parse(parsed.generatedAt))) return null
        cachedHistory = { generatedAt: parsed.generatedAt, hotels: new Map(parsed.hotels.map((hotel) => [scopeKey(hotel), hotel])) }
        cachedSignature = signature
      }
      return cachedHistory
    } catch { return null }
  }
  const readTargets = () => {
    if (!targetPath || !existsSync(targetPath)) return { schemaVersion: 1, plans: [] }
    try {
      const parsed = JSON.parse(readFileSync(targetPath, 'utf8'))
      if (parsed.schemaVersion !== 1 || !Array.isArray(parsed.plans)) fail('TARGET_STORE_UNAVAILABLE')
      return parsed
    } catch { fail('TARGET_STORE_UNAVAILABLE') }
  }
  const latestPlan = (store, scope, start) => store.plans.filter((plan) => scopeKey(plan) === scopeKey(scope) && plan.weekStart === start)
    .sort((a, b) => b.version - a.version)[0] ?? null
  return {
    view(scope, { type, date, planWeek, snapshot } = {}) {
      const now = clock()
      const data = readHistory()
      const history = data?.hotels.get(scopeKey(scope)) ?? { daily: [], pace: [], periods: [], firstDate: null }
      const start = planWeek ?? weekStart(shanghaiDate(now))
      const decisions = readTargets()
      const approved = latestPlan(decisions, scope, start)
      const plan = buildOccupancyPlan({ history, start, approved, now })
      const current = currentOccupancy(snapshot, now)
      const currentPlan = start === weekStart(shanghaiDate(now)) ? plan : buildOccupancyPlan({ history,
        start: weekStart(shanghaiDate(now)), approved: latestPlan(decisions, scope, weekStart(shanghaiDate(now))), now })
      const latestDue = currentPlan.days.find((day) => day.date === shanghaiDate(now))?.points
        .filter((point) => !point.editable && point.targetPercent !== null).at(-1)
      return { basis: 'PMS_STAY_DATE_IN_HOUSE_AND_RESERVED', times: OCCUPANCY_TIMES,
        today: shanghaiDate(now), currentWeek: weekStart(shanghaiDate(now)),
        history: { status: !data ? 'UNAVAILABLE' : now.getTime() - Date.parse(data.generatedAt) > 20 * 60_000 ? 'STALE' : 'READY',
          generatedAt: data?.generatedAt ?? null, firstDate: history.firstDate ?? null,
          hourlyMonths: 48, dailyYears: 2, aggregateYears: 5 },
        current: current ? { ...current, targetPercent: latestDue?.targetPercent ?? null,
          gapPp: !current.stale && latestDue ? round(current.occupancyPercent - latestDue.targetPercent) : null } : null,
        review: buildOccupancyReview({ history, type, date, now }), plan,
        recentDecisions: decisions.plans.filter((entry) => scopeKey(entry) === scopeKey(scope) && entry.weekStart === start)
          .sort((a, b) => b.version - a.version).slice(0, 10)
          .map(({ version, approvedAt, approvedBy, reason }) => ({ version, approvedAt, approvedBy, reason })) }
    },
    approve(scope, input, actor) {
      if (!targetPath) fail('TARGET_STORE_UNAVAILABLE')
      const now = clock(), today = shanghaiDate(now)
      if (!validDate(input.weekStart) || input.weekStart !== weekStart(input.weekStart)
        || input.weekStart < weekStart(today) || input.weekStart > addDays(weekStart(today), 28)) fail('WEEK_OUT_OF_RANGE')
      if (!Number.isInteger(input.expectedVersion) || input.expectedVersion < 0
        || !Array.isArray(input.points) || input.points.length > 35 || typeof input.reason !== 'string'
        || !input.reason.trim() || input.reason.trim().length > 300) fail('TARGET_INVALID')
      const points = input.points.map((point) => {
        if (!point || !validDate(point.date) || point.date < input.weekStart || point.date > addDays(input.weekStart, 6)
          || !OCCUPANCY_TIMES.includes(point.time) || typeof point.percent !== 'number' || percent(point.percent) === null) fail('TARGET_INVALID')
        return { date: point.date, time: point.time, percent: percent(point.percent) }
      }).sort((a, b) => keyFor(a).localeCompare(keyFor(b)))
      if (!points.length || new Set(points.map(keyFor)).size !== points.length) fail('TARGET_INVALID')
      const store = readTargets()
      const previous = latestPlan(store, scope, input.weekStart)
      const digest = createHash('sha256').update(JSON.stringify([points, input.reason.trim()])).digest('hex')
      // A retry after a lost response is idempotent; a genuine stale edit conflicts.
      if (previous?.digest === digest && previous.approvedBy === actor
        && previous.version === input.expectedVersion + 1) return previous
      if ((previous?.version ?? 0) !== input.expectedVersion) fail('TARGET_VERSION_CONFLICT')
      const oldPoints = new Map((previous?.points ?? []).map((point) => [keyFor(point), point.percent]))
      const newPoints = new Map(points.map((point) => [keyFor(point), point.percent]))
      for (const point of [...points, ...(previous?.points ?? [])]) {
        if (cutoff(point.date, point.time) <= now.getTime() && oldPoints.get(keyFor(point)) !== newPoints.get(keyFor(point))) fail('PAST_TARGET_LOCKED')
      }
      const plan = { ...scope, weekStart: input.weekStart, version: (previous?.version ?? 0) + 1,
        approvedAt: now.toISOString(), approvedBy: String(actor).slice(0, 120), reason: input.reason.trim(), digest, points }
      const updated = { schemaVersion: 1, plans: [...store.plans.filter((entry) => entry.weekStart >= addDays(today, -5 * 366)), plan] }
      try {
        mkdirSync(dirname(targetPath), { recursive: true })
        const temp = `${targetPath}.${randomUUID()}.tmp`
        writeFileSync(temp, JSON.stringify(updated), { encoding: 'utf8', mode: 0o600, flag: 'wx' })
        renameSync(temp, targetPath)
      } catch { fail('TARGET_PERSIST_FAILED') }
      return plan
    },
  }
}
