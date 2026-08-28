import { createHmac, randomUUID } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs'
import { dirname } from 'node:path'
import {
  briefingCycleStart,
  isScheduledBriefSnapshot,
  reportScheduleFor,
} from './report-schedule.mjs'

const MAX_RESPONSE_BYTES = 12 * 1024 * 1024
const SNAPSHOT_RETENTION = 50
const SHANGHAI_OFFSET = '+08:00'
const PMS_BUSINESS_DAY_ENDPOINT =
  'https://pms.meituan.com'
  + '/hotelpms/api/v1/night/audit/businessDate/detail?moduleKey=RoomStatus'
const SUPPORTED_REPORT_PATHS = new Map([
  ['/hotelpms/api/v1/report/jd01', 'ORDER_DETAIL'],
  ['/hotelpms/api/v2/report/jy09', 'FUTURE_OVERVIEW'],
  [
    '/hotelpms/api/v1/report/lion/manager/workbench/room',
    'PHYSICAL_INVENTORY',
  ],
  [
    '/hotelpms/api/v2/report/roomState/batchSearchBaseRoomForcasting',
    'ROOM_FORECAST',
  ],
])

const finiteNumber = (value) => {
  if (value === null || value === undefined || value === '') return null
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

const rounded = (value, digits = 2) =>
  value === null || value === undefined
    ? null
    : Number(Number(value).toFixed(digits))

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

const addDays = (dateText, days) => {
  const date = new Date(`${dateText}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

const canonicalBusinessDate = (value) => {
  const text = String(value ?? '').trim()
  const normalized =
    /^\d{8}$/.test(text)
      ? `${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6, 8)}`
      : text
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) return null
  const parsed = new Date(`${normalized}T00:00:00Z`)
  if (Number.isNaN(parsed.getTime())) return null
  return parsed.toISOString().slice(0, 10) === normalized
    ? normalized
    : null
}

const readCookieValue = (cookie, name) => {
  for (const segment of String(cookie ?? '').split(';')) {
    const separator = segment.indexOf('=')
    if (separator < 1) continue
    if (segment.slice(0, separator).trim() === name) {
      return segment.slice(separator + 1).trim()
    }
  }
  return null
}

const requiredCookieValue = (cookie, name) => {
  const value = readCookieValue(cookie, name)
  if (!value || /[\r\n\u0000]/.test(value)) {
    throw new Error('PMS_CONTEXT_MISSING')
  }
  return value
}

const requestContract = (source, cookie, reportDate) => {
  const endpoint = new URL(source.endpointUrl)
  if (
    endpoint.protocol !== 'https:'
    || endpoint.hostname !== 'pms.meituan.com'
    || endpoint.username
    || endpoint.password
    || endpoint.search
    || endpoint.hash
  ) {
    throw new Error('ENDPOINT_NOT_ALLOWED')
  }
  const contract = SUPPORTED_REPORT_PATHS.get(endpoint.pathname)
  if (!contract) throw new Error('ENDPOINT_NOT_SUPPORTED')

  const hotelId = requiredCookieValue(cookie, 'hotelpms_login_hotel_id')
  if (!/^\d+$/.test(hotelId)) throw new Error('PMS_CONTEXT_INVALID')

  const commonHeaders = {
    Accept: 'application/json, text/plain, */*',
    'Accept-Language': 'zh-CN,zh;q=0.9',
    Cookie: cookie,
  }
  if (contract === 'ORDER_DETAIL') {
    return {
      contract,
      endpoint,
      headers: {
        ...commonHeaders,
        'Content-Type': 'application/json',
        Origin: endpoint.origin,
        Referer: `${endpoint.origin}/`,
        'User-Agent': 'Sifangguan-ReadOnly-Report-Collector/0.1',
      },
      body: {
        startDate: reportDate,
        endDate: reportDate,
        orgId: hotelId,
        memberLevel: null,
        integratedBusiness: null,
        isSplited: false,
      },
    }
  }
  if (contract === 'FUTURE_OVERVIEW') {
    return {
      contract,
      endpoint,
      headers: {
        ...commonHeaders,
        'Content-Type': 'application/json',
        Origin: endpoint.origin,
        Referer: `${endpoint.origin}/`,
        'User-Agent': 'Sifangguan-ReadOnly-Report-Collector/0.1',
      },
      body: {
        hotelId,
        startDate: reportDate,
        endDate: addDays(reportDate, 90),
        dimension: 'Hotel',
      },
    }
  }
  if (contract === 'ROOM_FORECAST') {
    let configuredPayload
    try {
      configuredPayload = JSON.parse(source.requestPayloadJson ?? '')
    } catch {
      throw new Error('REQUEST_PAYLOAD_INVALID')
    }
    if (
      !configuredPayload
      || typeof configuredPayload !== 'object'
      || Array.isArray(configuredPayload)
      || !Array.isArray(configuredPayload.roomTypes)
      || configuredPayload.roomTypes.length < 1
      || configuredPayload.roomTypes.length > 100
    ) {
      throw new Error('REQUEST_PAYLOAD_INVALID')
    }
    const roomTypes = configuredPayload.roomTypes.map((roomType) => {
      if (
        !roomType
        || typeof roomType !== 'object'
        || typeof roomType.id !== 'string'
        || !/^[A-Za-z0-9_-]{1,40}$/.test(roomType.id)
        || typeof roomType.roomTypeName !== 'string'
        || roomType.roomTypeName.trim().length < 1
        || roomType.roomTypeName.trim().length > 80
      ) {
        throw new Error('REQUEST_PAYLOAD_INVALID')
      }
      return {
        id: roomType.id,
        roomTypeName: roomType.roomTypeName.trim(),
        description: null,
      }
    })
    const beginHour =
      typeof configuredPayload.beginHour === 'string'
      && /^\d{2}:\d{2}$/.test(configuredPayload.beginHour)
        ? configuredPayload.beginHour
        : '18:00'
    const channelKey =
      typeof configuredPayload.channelKey === 'string'
      && /^[A-Za-z0-9_-]{1,40}$/.test(configuredPayload.channelKey)
        ? configuredPayload.channelKey
        : 'Hotel'
    return {
      contract,
      endpoint,
      headers: {
        ...commonHeaders,
        'Cache-Control': 'no-cache',
        'Content-Type': 'application/json;charset=UTF-8',
        Origin: endpoint.origin,
        Pragma: 'no-cache',
        Referer: `${endpoint.origin}/`,
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) '
          + 'AppleWebKit/537.36 Chrome/152.0.0.0 Safari/537.36',
        'hotelpms-client-id':
          requiredCookieValue(cookie, '_lxsdk_cuid'),
        'hotelpms-platform': 'pc',
        'm-appkey': 'fe_com.sankuai.hotelpms.fe.web',
      },
      body: {
        roomTypes,
        beginHour,
        channelKey,
        beginDate: `${reportDate} 00:00:00`,
        endDate: `${addDays(reportDate, 29)} 00:00:00`,
      },
    }
  }
  return {
    contract,
    endpoint,
    headers: {
      ...commonHeaders,
      'Cache-Control': 'no-cache',
      'Content-Type': 'application/json;charset=UTF-8',
      Origin: 'https://awp.meituan.com',
      Pragma: 'no-cache',
      Referer: 'https://awp.meituan.com/',
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) '
        + 'AppleWebKit/537.36 Chrome/138.0.0.0 Safari/537.36',
      'hotelpms-login-hotel-id': hotelId,
      'hotelpms-login-org-id':
        requiredCookieValue(cookie, 'hotelpms_login_org_id'),
      'hotelpms-tenant-id':
        requiredCookieValue(cookie, 'hotelpms_tenant_id'),
      'hotelpms-token': requiredCookieValue(cookie, 'hotelpms_token'),
    },
    body: {
      orgId: hotelId,
      timeType: '1',
      startDate: reportDate,
      endDate: reportDate,
    },
  }
}

const readLimitedJson = async (response) => {
  if (!response.body) throw new Error('EMPTY_RESPONSE')
  const reader = response.body.getReader()
  const chunks = []
  let total = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > MAX_RESPONSE_BYTES) {
        await reader.cancel()
        throw new Error('RESPONSE_TOO_LARGE')
      }
      chunks.push(Buffer.from(value))
    }
  } finally {
    reader.releaseLock()
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    throw new Error('RESPONSE_JSON_INVALID')
  }
}

const fetchPmsBusinessDay = async (cookie, fetchImpl) => {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 10_000)
  const clientId = readCookieValue(cookie, '_lxsdk_cuid')
  let response
  try {
    response = await fetchImpl(PMS_BUSINESS_DAY_ENDPOINT, {
      method: 'GET',
      redirect: 'error',
      signal: controller.signal,
      headers: {
        Accept: 'application/json, text/plain, */*',
        'Accept-Language': 'zh-CN,zh;q=0.9',
        Cookie: cookie,
        Referer: 'https://pms.meituan.com/',
        'User-Agent': 'Sifangguan-ReadOnly-Report-Collector/0.1',
        ...(clientId
          ? {
              'hotelpms-client-id': clientId,
              'hotelpms-platform': 'pc',
            }
          : {}),
      },
    })
  } catch {
    throw new Error('PMS_BUSINESS_DATE_UNAVAILABLE')
  } finally {
    clearTimeout(timer)
  }
  if (!response.ok) throw new Error('PMS_BUSINESS_DATE_UNAVAILABLE')
  let root
  try {
    root = await readLimitedJson(response)
  } catch {
    throw new Error('PMS_BUSINESS_DATE_UNAVAILABLE')
  }
  const pmsCode = Number(root?.code)
  if (![0, 10000].includes(pmsCode)) {
    // Meituan PMS can return an HTTP 200 response after a login session has
    // expired. Treat the observed session-rejection response as actionable so
    // the operator is directed to renew the stored PMS Cookie, rather than
    // being shown a generic availability failure.
    if (pmsCode === 10008) {
      throw new Error('PMS_SESSION_REAUTH_REQUIRED')
    }
    throw new Error('PMS_BUSINESS_DATE_UNAVAILABLE')
  }
  const businessDate = canonicalBusinessDate(
    root?.data?.businessDate ?? root?.data,
  )
  if (!businessDate) throw new Error('PMS_BUSINESS_DATE_INVALID')
  const beginTime = finiteNumber(root?.data?.businessBeginTime)
  const businessDateStartedAt =
    beginTime !== null && beginTime > 0
      ? localIso(new Date(beginTime))
      : null
  return { businessDate, businessDateStartedAt }
}

const resolvePmsBusinessDay = async ({
  enabledSources,
  cookiesBySourceId,
  fetchImpl,
}) => {
  const candidateCookies = [
    ...new Set(
      enabledSources
        .map((source) => cookiesBySourceId[source.sourceId])
        .filter((cookie) => typeof cookie === 'string' && cookie.length > 0),
    ),
  ]
  let sessionReauthenticationRequired = false
  for (const cookie of candidateCookies) {
    try {
      return await fetchPmsBusinessDay(cookie, fetchImpl)
    } catch (error) {
      if (error?.message === 'PMS_SESSION_REAUTH_REQUIRED') {
        sessionReauthenticationRequired = true
      }
      // A store can temporarily contain one expired source Cookie and another
      // current one. Only fail after every configured PMS session was tried.
    }
  }
  if (sessionReauthenticationRequired) {
    throw new Error('PMS_SESSION_REAUTH_REQUIRED')
  }
  throw new Error('PMS_BUSINESS_DATE_UNAVAILABLE')
}

const safeErrorCode = (error) => {
  if (error?.name === 'AbortError') return 'TIMEOUT'
  const message = String(error?.message ?? '')
  const allowed = new Set([
    'COOKIE_NOT_CONFIGURED',
    'EMPTY_RESPONSE',
    'ENDPOINT_NOT_ALLOWED',
    'ENDPOINT_NOT_SUPPORTED',
    'HTTP_ERROR',
    'PMS_CONTEXT_INVALID',
    'PMS_CONTEXT_MISSING',
    'REPORT_CODE_REJECTED',
    'REPORT_DATA_INVALID',
    'REQUEST_PAYLOAD_INVALID',
    'RESPONSE_JSON_INVALID',
    'RESPONSE_TOO_LARGE',
    'TIMEOUT',
  ])
  return allowed.has(message) ? message : 'COLLECTION_FAILED'
}

const fetchReport = async (source, cookie, reportDate, fetchImpl) => {
  const contract = requestContract(source, cookie, reportDate)
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 20_000)
  let response
  try {
    response = await fetchImpl(contract.endpoint, {
      method: 'POST',
      redirect: 'error',
      signal: controller.signal,
      headers: contract.headers,
      body: JSON.stringify(contract.body),
    })
  } finally {
    clearTimeout(timer)
  }
  if (!response.ok) throw new Error('HTTP_ERROR')
  const root = await readLimitedJson(response)
  if (![0, 10000].includes(Number(root?.code))) {
    throw new Error('REPORT_CODE_REJECTED')
  }
  return { contract: contract.contract, root }
}

const hmac = (key, value, length = 32) =>
  createHmac('sha256', key).update(String(value)).digest('hex').slice(0, length)

const dateOnly = (value) =>
  typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value)
    ? value.slice(0, 10)
    : null

const roomNightsFor = (row) => {
  const roomCount = finiteNumber(row?.roomCount)
  if (roomCount === null || roomCount <= 0) return 0
  const arrival = dateOnly(row?.estArriveTime)
  const departure = dateOnly(row?.estDepatureTime)
  if (!arrival || !departure) return roomCount
  const nights = Math.round(
    (
      new Date(`${departure}T00:00:00Z`).getTime()
      - new Date(`${arrival}T00:00:00Z`).getTime()
    ) / 86_400_000,
  )
  return roomCount * Math.max(1, nights)
}

const detectChannel = (row) => {
  const text = [
    row?.orderSource,
    row?.source,
    row?.customerLevel,
    row?.roomPriceType,
    row?.prePaymentType,
  ]
    .filter((value) => typeof value === 'string')
    .join('\n')
  if (/(?:携程|ctrip|trip\.com)/i.test(text)) return 'CTRIP'
  if (/(?:美团|meituan)/i.test(text)) return 'MEITUAN'
  if (/(?:飞猪|fliggy|alitrip)/i.test(text)) return 'FEIZHU'
  if (/(?:抖音|douyin)/i.test(text)) return 'DOUYIN'
  return 'UNKNOWN'
}

const orderState = (root, reportDate, secretKey) => {
  const rows = root?.data?.dataList
  if (!Array.isArray(rows)) throw new Error('REPORT_DATA_INVALID')
  const grouped = new Map()
  for (const row of rows) {
    if (!row || typeof row !== 'object' || Array.isArray(row)) continue
    const arrivalDate = dateOnly(row.estArriveTime)
    const departureDate = dateOnly(row.estDepatureTime)
    const orderDate = dateOnly(row.orderDate)
    const rawOrderKey =
      typeof row.orderNo === 'string' && row.orderNo.trim()
        ? `order:${row.orderNo.trim()}`
        : JSON.stringify([
            orderDate,
            arrivalDate,
            departureDate,
            row.roomType ?? '',
            row.roomCount ?? '',
            row.orderStatus ?? '',
            row.orderSource ?? '',
          ])
    const key = hmac(secretKey, rawOrderKey)
    const current = grouped.get(key) ?? {
      key,
      channel: detectChannel(row),
      status: 'ACTIVE',
      roomNights: 0,
      arrivalClass:
        arrivalDate === reportDate
          ? 'TODAY'
          : arrivalDate && arrivalDate > reportDate
            ? 'FUTURE'
            : 'OTHER',
      orderDate,
      arrivalDate,
      lineKeys: new Set(),
    }
    const canceled = /(?:取消|cancel)/i.test(String(row.orderStatus ?? ''))
    if (canceled) current.status = 'CANCELLED'
    if (current.channel === 'UNKNOWN') current.channel = detectChannel(row)
    const lineKey = JSON.stringify([
      row.roomType ?? '',
      arrivalDate,
      departureDate,
      row.roomCount ?? '',
      row.roomPrice ?? '',
      row.orderStatus ?? '',
    ])
    if (!current.lineKeys.has(lineKey)) {
      current.lineKeys.add(lineKey)
      current.roomNights += roomNightsFor(row)
    }
    grouped.set(key, current)
  }
  return [...grouped.values()]
    .map(({ lineKeys: _lineKeys, ...order }) => ({
      ...order,
      roomNights: rounded(order.roomNights, 2),
    }))
    .sort((left, right) => left.key.localeCompare(right.key))
}

const overviewRowState = (row) => ({
  stayDate: canonicalBusinessDate(row?.estimatedDate),
  roomCount: finiteNumber(row?.roomCount),
  availableRooms: finiteNumber(row?.availableRoom),
  soldRooms: finiteNumber(row?.saleRoom),
  orderRooms: finiteNumber(row?.orderRoom),
  checkinRooms: finiteNumber(row?.checkinRoom),
  roomFee: finiteNumber(row?.estimatedRoomFee),
  revenue: finiteNumber(row?.estimatedRevenue),
  roomNights: finiteNumber(row?.estimatedRoomNights),
  occupancyRate: finiteNumber(row?.estimatedRentRate),
  adr: finiteNumber(row?.estimatedAvgRoomPrice),
  revPar: finiteNumber(row?.estimatedRevpar),
})

const overviewState = (root, reportDate) => {
  const rows = root?.data?.dataList
  if (!Array.isArray(rows)) throw new Error('REPORT_DATA_INVALID')
  const daily = rows
    .map(overviewRowState)
    .filter((row) => row.stayDate)
    .sort((left, right) => left.stayDate.localeCompare(right.stayDate))
  const current = daily.find((row) => row.stayDate === reportDate)
  if (!current) throw new Error('REPORT_DATA_INVALID')
  return {
    current,
    futureDaily: daily.filter(
      (row) =>
        row.stayDate > reportDate
        && row.stayDate <= addDays(reportDate, 90),
    ),
  }
}

const physicalInventoryState = (root, secretKey) => {
  const rows = Array.isArray(root?.data)
    ? root.data
    : root?.data?.dataList
  if (!Array.isArray(rows)) throw new Error('REPORT_DATA_INVALID')
  return rows
    .filter((row) => row && typeof row === 'object' && !Array.isArray(row))
    .map((row) => {
      const displayName =
        typeof row.roomName === 'string' && row.roomName.trim()
          ? row.roomName.trim().slice(0, 80)
          : '未命名实体房型'
      const code = hmac(secretKey, `room-type:${displayName}`, 16)
      return {
        inventoryPoolId: `PMS-${code}`,
        physicalRoomTypeCode: `PMS-${code}`,
        displayName,
        physicalRoomCount: finiteNumber(row.roomNum),
        primaryAvailableRooms: finiteNumber(row.availableRoomNum),
        estimatedRoomNights: finiteNumber(row.estimatedRoomNights),
        estimatedRoomFee: finiteNumber(row.estimatedRoomAmt),
        estimatedAdr: finiteNumber(row.estimatedAvgRoomPrice),
      }
    })
}

const roomForecastState = (root, reportDate, secretKey) => {
  const rows = root?.data
  if (!Array.isArray(rows)) throw new Error('REPORT_DATA_INVALID')
  return rows
    .filter(
      (row) =>
        row
        && typeof row === 'object'
        && !Array.isArray(row)
        && row.isAggregation !== true
        && typeof row.roomTypeName === 'string'
        && Array.isArray(row.details),
    )
    .map((row) => {
      const displayName = row.roomTypeName.trim().slice(0, 80)
      const detail = row.details.find(
        (item) =>
          typeof item?.date === 'string'
          && item.date.startsWith(reportDate),
      )
      if (!detail) return null
      const code = hmac(secretKey, `room-type:${displayName}`, 16)
      return {
        inventoryPoolId: `PMS-${code}`,
        physicalRoomTypeCode: `PMS-${code}`,
        displayName,
        physicalRoomCount: finiteNumber(row.totalCount),
        primaryAvailableRooms: finiteNumber(detail.availableCount),
        estimatedRoomNights: finiteNumber(detail.occupationCount),
        estimatedRoomFee: finiteNumber(detail.roomRent),
        estimatedAdr: finiteNumber(detail.adr),
        forecastRevPar: finiteNumber(detail.revPar),
        forecastOverbookingCount: finiteNumber(detail.overbookingCount),
        forecastCheckinCount: finiteNumber(detail.checkinCount),
        forecastOrderCount: finiteNumber(detail.orderCount),
        forecastMaintainingCount: finiteNumber(detail.maintainingCount),
      }
    })
    .filter(Boolean)
}

const mergePhysicalInventory = (physicalRows, forecastRows) => {
  const merged = new Map(
    physicalRows.map((room) => [room.physicalRoomTypeCode, room]),
  )
  for (const forecast of forecastRows) {
    const current = merged.get(forecast.physicalRoomTypeCode)
    merged.set(
      forecast.physicalRoomTypeCode,
      current
        ? {
            ...current,
            ...forecast,
            physicalRoomCount:
              forecast.physicalRoomCount ?? current.physicalRoomCount,
            primaryAvailableRooms: forecast.primaryAvailableRooms,
          }
        : forecast,
    )
  }
  return [...merged.values()]
}

const sourceCodeFor = (contract, sourceId) => {
  const prefix =
    contract === 'ORDER_DETAIL'
      ? 'REPORT_ORDER'
      : contract === 'FUTURE_OVERVIEW'
        ? 'REPORT_REVENUE'
        : contract === 'ROOM_FORECAST'
          ? 'REPORT_ROOM_FORECAST'
        : contract === 'PHYSICAL_INVENTORY'
          ? 'REPORT_INVENTORY'
          : 'REPORT_UNKNOWN'
  return `${prefix}_${String(sourceId).slice(0, 8)}`
}

const emptyChannelDelta = () => ({
  newRoomNights: 0,
  todayRoomNights: 0,
  futureRoomNights: 0,
  canceledRoomNights: 0,
})

const snapshotSourceSystem = (snapshot) => {
  if (typeof snapshot?.sourceSystem === 'string' && snapshot.sourceSystem) {
    return snapshot.sourceSystem
  }
  return Array.isArray(snapshot?.orders) ? 'MEITUAN_BIEYANGHONG' : null
}

const sameSnapshotSource = (left, right) => {
  const leftSource = snapshotSourceSystem(left)
  return leftSource !== null && leftSource === snapshotSourceSystem(right)
}

const isMorningFirstBriefSnapshot = (snapshot) => {
  const observedAt = new Date(snapshot?.observedAt ?? '')
  if (Number.isNaN(observedAt.getTime())) return false
  const schedule = reportScheduleFor(observedAt)
  return schedule.hour === schedule.startHour && schedule.minute <= 5
}

const hourlyDeltaFor = (snapshot, previousSnapshots, observedAtMs) => {
  const hourlyCandidates = previousSnapshots
    .filter(
      (candidate) =>
        candidate.businessDate === snapshot.businessDate
        && sameSnapshotSource(candidate, snapshot)
        && Array.isArray(candidate.orders)
        && isScheduledBriefSnapshot(candidate),
    )
    .map((candidate) => ({
      candidate,
      distance:
        observedAtMs - new Date(candidate.observedAt).getTime(),
    }))
    .filter(
      (item) =>
        item.distance > 0
        && item.distance <= 135 * 60 * 1000,
    )
    .sort((left, right) => left.distance - right.distance)
  const observedDate = String(snapshot?.observedAt ?? '').slice(0, 10)
  const pauseCandidates = previousSnapshots
    .filter(
      (candidate) =>
        Array.isArray(candidate.orders)
        && sameSnapshotSource(candidate, snapshot)
        && new RegExp(`^${observedDate}T01:0[0-5]`).test(
          String(candidate.observedAt ?? ''),
        ),
    )
    .map((candidate) => ({
      candidate,
      distance:
        observedAtMs - new Date(candidate.observedAt).getTime(),
    }))
    .filter(
      (item) =>
        item.distance > 0
        && item.distance <= 9 * 60 * 60 * 1000,
    )
    .sort((left, right) => left.distance - right.distance)
  const pauseWindow =
    isMorningFirstBriefSnapshot(snapshot)
    && pauseCandidates.length > 0
  const previous = pauseWindow
    ? pauseCandidates[0].candidate
    : hourlyCandidates[0]?.candidate
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

  const byChannel = Object.fromEntries(
    ['CTRIP', 'MEITUAN', 'FEIZHU', 'DOUYIN', 'UNKNOWN']
      .map((channel) => [channel, emptyChannelDelta()]),
  )
  const previousOrders = new Map(
    previous.orders.map((order) => [order.key, order]),
  )
  for (const order of snapshot.orders) {
    const old = previousOrders.get(order.key)
    if (order.status === 'CANCELLED') {
      if (old?.status === 'ACTIVE') {
        byChannel[order.channel].canceledRoomNights += old.roomNights
      }
      continue
    }
    const increase =
      old?.status === 'ACTIVE'
        ? Math.max(0, order.roomNights - old.roomNights)
        : order.roomNights
    if (increase <= 0) continue
    const bucket = byChannel[order.channel]
    bucket.newRoomNights += increase
    if (order.arrivalClass === 'TODAY') bucket.todayRoomNights += increase
    if (order.arrivalClass === 'FUTURE') bucket.futureRoomNights += increase
  }
  for (const channel of Object.values(byChannel)) {
    for (const key of Object.keys(channel)) channel[key] = rounded(channel[key])
  }
  const totals = Object.values(byChannel).reduce(
    (sum, channel) => ({
      newRoomNights: sum.newRoomNights + channel.newRoomNights,
      todayRoomNights: sum.todayRoomNights + channel.todayRoomNights,
      futureRoomNights: sum.futureRoomNights + channel.futureRoomNights,
      canceledRoomNights:
        sum.canceledRoomNights + channel.canceledRoomNights,
    }),
    emptyChannelDelta(),
  )
  const metricDelta =
    snapshot.businessDate === previous.businessDate
    && snapshot.overview
    && previous.overview
      ? {
          roomFee:
            snapshot.overview.roomFee === null
            || previous.overview.roomFee === null
              ? null
              : rounded(
                  snapshot.overview.roomFee - previous.overview.roomFee,
                ),
          adr:
            snapshot.overview.adr === null || previous.overview.adr === null
              ? null
              : rounded(snapshot.overview.adr - previous.overview.adr),
          revPar:
            snapshot.overview.revPar === null
            || previous.overview.revPar === null
              ? null
              : rounded(snapshot.overview.revPar - previous.overview.revPar),
          roomNights:
            snapshot.overview.roomNights === null
            || previous.overview.roomNights === null
              ? null
              : rounded(
                  snapshot.overview.roomNights
                  - previous.overview.roomNights,
                ),
        }
      : null
  return {
    basis: 'HOURLY_SNAPSHOT_DIFF',
    aggregationWindow:
      pauseWindow
        ? 'PAUSE_TO_FIRST_BRIEF'
        : observedAtMs - new Date(previous.observedAt).getTime()
          >= 90 * 60 * 1000
          ? 'TWO_HOUR'
          : 'HOURLY',
    intervalStartAt: previous.observedAt,
    intervalEndAt: snapshot.observedAt,
    totals,
    byChannel,
    metricDelta,
  }
}

const futureBookedRoomNights = (row) =>
  finiteNumber(row?.roomNights) ?? finiteNumber(row?.soldRooms)

const occupancyPercentFor = (row) => {
  const reported = finiteNumber(row?.occupancyRate)
  if (reported !== null) return rounded(reported <= 2 ? reported * 100 : reported)
  const booked = futureBookedRoomNights(row)
  const roomCount = finiteNumber(row?.roomCount)
  return booked === null || roomCount === null || roomCount <= 0
    ? null
    : rounded(booked / roomCount * 100)
}

const closestScheduledFutureBaseline = (
  snapshot,
  previousSnapshots,
  observedAtMs,
) =>
  previousSnapshots
    .filter(
      (candidate) =>
        Array.isArray(candidate?.futureDaily)
        && sameSnapshotSource(candidate, snapshot)
        && isScheduledBriefSnapshot(candidate)
        && Number.isFinite(new Date(candidate.observedAt).getTime()),
    )
    .map((candidate) => ({
      candidate,
      distance: observedAtMs - new Date(candidate.observedAt).getTime(),
    }))
    .filter(
      (item) =>
        item.distance > 0
        && item.distance <= 135 * 60 * 1000,
    )
    .sort((left, right) => left.distance - right.distance)[0]?.candidate ?? null

const previousCalendarDayEndBaseline = (
  snapshot,
  previousSnapshots,
) => {
  const observedDate = String(snapshot.observedAt ?? '').slice(0, 10)
  const previousDate = canonicalBusinessDate(observedDate)
    ? addDays(observedDate, -1)
    : null
  if (!previousDate) return null
  return previousSnapshots
    .filter(
      (candidate) =>
        Array.isArray(candidate?.futureDaily)
        && sameSnapshotSource(candidate, snapshot)
        && ['COMPLETE', 'PARTIAL'].includes(candidate?.completeness)
        && String(candidate.observedAt ?? '').startsWith(`${previousDate}T`),
    )
    .sort((left, right) =>
      String(right.observedAt).localeCompare(String(left.observedAt)))[0] ?? null
}

const currentBriefingCycleBaseline = (
  snapshot,
  previousSnapshots,
) => {
  const observedAt = new Date(snapshot.observedAt)
  const cycleStartMs = new Date(briefingCycleStart(observedAt)).getTime()
  if (!Number.isFinite(cycleStartMs)) return null
  return previousSnapshots
    .filter((candidate) => {
      const candidateAtMs = new Date(candidate?.observedAt ?? '').getTime()
      return Array.isArray(candidate?.futureDaily)
        && sameSnapshotSource(candidate, snapshot)
        && ['COMPLETE', 'PARTIAL'].includes(candidate?.completeness)
        && isScheduledBriefSnapshot(candidate)
        && Number.isFinite(candidateAtMs)
        && candidateAtMs < cycleStartMs
    })
    .sort((left, right) =>
      String(right.observedAt).localeCompare(String(left.observedAt)))[0] ?? null
}

const bookingRowForDate = (snapshot, stayDate) => {
  if (!snapshot || !canonicalBusinessDate(stayDate)) return null
  if (snapshot.businessDate === stayDate && snapshot.overview) {
    return { ...snapshot.overview, stayDate }
  }
  return (snapshot.futureDaily ?? []).find(
    (row) => row?.stayDate === stayDate,
  ) ?? null
}

const futureBookingChangeRow = ({
  row,
  hourly,
  yesterday,
  cumulative,
}) => {
  const bookedRoomNights = futureBookedRoomNights(row)
  const hourlyBooked = futureBookedRoomNights(hourly)
  const yesterdayBooked = futureBookedRoomNights(yesterday)
  const cumulativeBooked = futureBookedRoomNights(cumulative)
  const hourlyNetRoomNights =
    bookedRoomNights === null || hourlyBooked === null
      ? null
      : rounded(bookedRoomNights - hourlyBooked)
  const previousDayNetRoomNights =
    bookedRoomNights === null || yesterdayBooked === null
      ? null
      : rounded(bookedRoomNights - yesterdayBooked)
  const cumulativeNetRoomNights =
    bookedRoomNights === null || cumulativeBooked === null
      ? null
      : rounded(bookedRoomNights - cumulativeBooked)
  const hourlyRoomFeeDelta =
    finiteNumber(row.roomFee) === null || finiteNumber(hourly?.roomFee) === null
      ? null
      : rounded(finiteNumber(row.roomFee) - finiteNumber(hourly.roomFee))
  const inferredHourlyAdr =
    hourlyNetRoomNights !== null
    && hourlyNetRoomNights > 0
    && hourlyRoomFeeDelta !== null
      ? rounded(hourlyRoomFeeDelta / hourlyNetRoomNights)
      : null
  return {
    ...row,
    bookedRoomNights,
    occupancyPercent: occupancyPercentFor(row),
    hourlyNetRoomNights,
    cumulativeNetRoomNights,
    previousDayNetRoomNights,
    hourlyAdrDelta:
      finiteNumber(row.adr) === null || finiteNumber(hourly?.adr) === null
        ? null
        : rounded(finiteNumber(row.adr) - finiteNumber(hourly.adr)),
    inferredHourlyAdr,
  }
}

const futureBookingChangesFor = (
  snapshot,
  previousSnapshots,
  observedAtMs,
) => {
  const hourlyBaseline = closestScheduledFutureBaseline(
    snapshot,
    previousSnapshots,
    observedAtMs,
  )
  const previousDayEnd = previousCalendarDayEndBaseline(
    snapshot,
    previousSnapshots,
  )
  const cumulativeBaseline = currentBriefingCycleBaseline(
    snapshot,
    previousSnapshots,
  )
  const sourceRows = [
    ...(snapshot.overview
      ? [{ ...snapshot.overview, stayDate: snapshot.businessDate }]
      : []),
    ...(snapshot.futureDaily ?? []),
  ]
  const daily = sourceRows.map((row) => futureBookingChangeRow({
    row,
    hourly: bookingRowForDate(hourlyBaseline, row.stayDate),
    yesterday: bookingRowForDate(previousDayEnd, row.stayDate),
    cumulative: bookingRowForDate(cumulativeBaseline, row.stayDate),
  }))
  return {
    basis:
      hourlyBaseline || cumulativeBaseline || previousDayEnd
        ? 'FUTURE_SNAPSHOT_DIFF'
        : 'BASELINE_PENDING',
    hourlyBaselineAt: hourlyBaseline?.observedAt ?? null,
    cumulativeBaselineAt: cumulativeBaseline?.observedAt ?? null,
    previousDayEndAt: previousDayEnd?.observedAt ?? null,
    daily,
  }
}

const metric = (value, unit) => ({
  value: value === null || value === undefined ? null : rounded(value),
  unit,
  state:
    value === null || value === undefined ? 'UNAVAILABLE' : 'AVAILABLE',
})

export const monitorFromSnapshot = (
  snapshot,
  hotel,
  target = null,
  hotSellingRoomTypeCodes = [],
) => {
  if (!snapshot) {
    return {
      tenantId: hotel.tenantId,
      hotelId: hotel.hotelId,
      hotelName: hotel.hotelName,
      completeness: 'UNAVAILABLE',
      simulationMode: false,
      sources: [],
      metrics: {
        totalRevenue: metric(null, 'CURRENCY'),
        adr: metric(null, 'CURRENCY'),
        revPar: metric(null, 'CURRENCY'),
        soldRooms: metric(null, 'ROOM_NIGHT'),
        availableRooms: metric(null, 'ROOM'),
        targetProgress: {
          value: null,
          unit: 'PERCENT',
          state: 'NOT_CONFIGURED',
        },
        sellProgress: metric(null, 'PERCENT'),
      },
      inventory: [],
      hotSellingAlerts: [],
      businessDateBasis: 'CALENDAR_FALLBACK',
      revenueSemantics: 'REPORT_ESTIMATED_ROOM_FEE',
      hourlyDelta: {
        basis: 'BASELINE_PENDING',
        aggregationWindow: null,
        intervalStartAt: null,
        intervalEndAt: null,
        totals: null,
        byChannel: null,
        metricDelta: null,
      },
    }
  }
  const overview = snapshot.overview
  const occupancyPercent =
    overview?.occupancyRate === null || overview?.occupancyRate === undefined
      ? null
      : overview.occupancyRate <= 2
        ? overview.occupancyRate * 100
        : overview.occupancyRate
  const targetValue = finiteNumber(target?.roomRevenueTarget)
  const targetProgress =
    overview?.roomFee === null
    || overview?.roomFee === undefined
    || targetValue === null
    || targetValue <= 0
      ? null
      : overview.roomFee / targetValue * 100
  const hotSellingSet = new Set(hotSellingRoomTypeCodes)
  const inventory = snapshot.physicalInventory.map((room) => {
    const hotSelling = hotSellingSet.has(room.physicalRoomTypeCode)
    const hotSellingAlertState =
      !hotSelling
        ? null
        : room.primaryAvailableRooms === null
          ? 'UNAVAILABLE'
          : room.primaryAvailableRooms <= 0
            ? 'SOLD_OUT'
            : 'AVAILABLE'
    return {
      inventoryPoolId: room.inventoryPoolId,
      physicalRoomTypeCode: room.physicalRoomTypeCode,
      displayName: room.displayName,
      primaryAvailableRooms: room.primaryAvailableRooms,
      otaAvailableRooms: {},
      state: 'UNAVAILABLE',
      hotSelling,
      hotSellingAlertState,
    }
  })
  const hotSellingAlerts = inventory
    .filter((room) => room.hotSelling)
    .map((room) => ({
      physicalRoomTypeCode: room.physicalRoomTypeCode,
      displayName: room.displayName,
      availableRooms: room.primaryAvailableRooms,
      state: room.hotSellingAlertState,
      shouldNotify: room.hotSellingAlertState === 'SOLD_OUT',
      message:
        room.hotSellingAlertState === 'SOLD_OUT'
          ? `热销房型售罄：${room.displayName}，请检查价格与后续库存释放策略。`
          : room.hotSellingAlertState === 'UNAVAILABLE'
            ? `热销房型库存暂无法判断：${room.displayName}。`
            : `热销房型仍可售：${room.displayName}，剩余${room.primaryAvailableRooms}间。`,
    }))
  return {
    tenantId: hotel.tenantId,
    hotelId: hotel.hotelId,
    hotelName: hotel.hotelName,
    businessDate: snapshot.businessDate,
    cutoffAt: snapshot.observedAt,
    completeness: snapshot.completeness,
    simulationMode: false,
    sources: snapshot.sources.map((source) => ({
      sourceId: source.sourceId,
      sourceCode: source.sourceCode,
      reportType: source.reportType,
      completeness: source.completeness,
      sourceObservedAt: source.observedAt,
      ingestedAt: source.ingestedAt,
      errorCode: source.errorCode,
    })),
    metrics: {
      totalRevenue: metric(overview?.roomFee, 'CURRENCY'),
      adr: metric(overview?.adr, 'CURRENCY'),
      revPar: metric(overview?.revPar, 'CURRENCY'),
      soldRooms: metric(overview?.roomNights, 'ROOM_NIGHT'),
      availableRooms: metric(overview?.availableRooms, 'ROOM'),
      targetProgress:
        targetValue === null
          ? {
              value: null,
              unit: 'PERCENT',
              state: 'NOT_CONFIGURED',
            }
          : metric(targetProgress, 'PERCENT'),
      sellProgress: metric(occupancyPercent, 'PERCENT'),
    },
    inventory,
    hotSellingAlerts,
    businessDateBasis: snapshot.businessDateBasis,
    revenueSemantics: 'REPORT_ESTIMATED_ROOM_FEE',
    hourlyDelta: snapshot.hourlyDelta,
    collectionRunId: snapshot.collectionRunId,
  }
}

export const collectLiveReports = async ({
  hotel,
  sources,
  cookiesBySourceId,
  previousSnapshots = [],
  secretKey,
  target = null,
  hotSellingRoomTypeCodes = [],
  reportDate: configuredReportDate = null,
  now = new Date(),
  fetchImpl = fetch,
}) => {
  const previousBusinessDate =
    configuredReportDate === null
      ? null
      : canonicalBusinessDate(configuredReportDate)
  if (configuredReportDate !== null && !previousBusinessDate) {
    throw new Error('BUSINESS_DATE_INVALID')
  }
  const observedAt = localIso(now)
  const collectionRunId = randomUUID()
  const enabledSources = sources.filter((source) => source.enabled)
  const businessDay = await resolvePmsBusinessDay({
    enabledSources,
    cookiesBySourceId,
    fetchImpl,
  })
  const reportDate = businessDay.businessDate
  const businessDateChanged =
    previousBusinessDate !== null
    && previousBusinessDate !== reportDate
  const collected = await Promise.all(
    enabledSources.map(async (source) => {
      const cookie = cookiesBySourceId[source.sourceId]
      const fallbackContract =
        SUPPORTED_REPORT_PATHS.get(new URL(source.endpointUrl).pathname)
      const sourceCode = sourceCodeFor(fallbackContract, source.sourceId)
      if (!cookie) {
        return {
          source,
          sourceCode,
          contract: fallbackContract,
          completeness: 'UNAVAILABLE',
          observedAt,
          ingestedAt: localIso(new Date()),
          errorCode: 'COOKIE_NOT_CONFIGURED',
          parsed: null,
        }
      }
      try {
        const { contract, root } = await fetchReport(
          source,
          cookie,
          reportDate,
          fetchImpl,
        )
        const parsed =
          contract === 'ORDER_DETAIL'
            ? orderState(root, reportDate, secretKey)
            : contract === 'FUTURE_OVERVIEW'
              ? overviewState(root, reportDate)
              : contract === 'PHYSICAL_INVENTORY'
                ? physicalInventoryState(root, secretKey)
                : roomForecastState(root, reportDate, secretKey)
        return {
          source,
          sourceCode: sourceCodeFor(contract, source.sourceId),
          contract,
          completeness: 'COMPLETE',
          observedAt,
          ingestedAt: localIso(new Date()),
          errorCode: null,
          parsed,
        }
      } catch (error) {
        return {
          source,
          sourceCode,
          contract: fallbackContract,
          completeness: 'UNAVAILABLE',
          observedAt,
          ingestedAt: localIso(new Date()),
          errorCode: safeErrorCode(error),
          parsed: null,
        }
      }
    }),
  )
  const successful = collected.filter(
    (source) => source.completeness === 'COMPLETE',
  )
  const orderReport = successful.find(
    (source) => source.contract === 'ORDER_DETAIL',
  )
  const overviewReport = successful.find(
    (source) => source.contract === 'FUTURE_OVERVIEW',
  )
  const physicalReport = successful.find(
    (source) => source.contract === 'PHYSICAL_INVENTORY',
  )
  const forecastReport = successful.find(
    (source) => source.contract === 'ROOM_FORECAST',
  )
  const hasCore =
    Boolean(orderReport) && Boolean(overviewReport) && Boolean(physicalReport)
  const snapshot = {
    schemaVersion: 1,
    sourceSystem: 'MEITUAN_BIEYANGHONG',
    collectionRunId,
    tenantId: hotel.tenantId,
    hotelId: hotel.hotelId,
    businessDate: reportDate,
    businessDateBasis: 'PMS_CONFIRMED',
    businessDateSource: 'PMS_NIGHT_AUDIT_API',
    businessDateStartedAt: businessDay.businessDateStartedAt,
    previousBusinessDate,
    businessDateChanged,
    observedAt,
    completeness:
      successful.length === 0
        ? 'UNAVAILABLE'
        : hasCore && successful.length === enabledSources.length
          ? 'COMPLETE'
          : 'PARTIAL',
    sources: collected.map((source) => ({
      sourceId: source.source.sourceId,
      sourceCode: source.sourceCode,
      reportType: source.source.reportType,
      completeness: source.completeness,
      observedAt: source.observedAt,
      ingestedAt: source.ingestedAt,
      errorCode: source.errorCode,
    })),
    orders: orderReport?.parsed ?? [],
    overview: overviewReport?.parsed?.current ?? null,
    futureDaily: overviewReport?.parsed?.futureDaily ?? [],
    physicalInventory: mergePhysicalInventory(
      physicalReport?.parsed ?? [],
      forecastReport?.parsed ?? [],
    ),
    roomForecast: forecastReport?.parsed ?? [],
  }
  snapshot.hourlyDelta = hourlyDeltaFor(
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
      status:
        snapshot.completeness === 'COMPLETE'
          ? 'SUCCEEDED'
          : snapshot.completeness === 'PARTIAL'
            ? 'PARTIAL'
            : 'FAILED',
      requestedAt: observedAt,
      completedAt: localIso(new Date()),
      businessDate: reportDate,
      previousBusinessDate,
      businessDateChanged,
      businessDateSource: 'PMS_NIGHT_AUDIT_API',
      businessDateStartedAt: businessDay.businessDateStartedAt,
      sourceCount: enabledSources.length,
      successfulSourceCount: successful.length,
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
}

export const loadSnapshotStore = (path) => {
  if (!path || !existsSync(path)) return {}
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8'))
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {}
    }
    return Object.fromEntries(
      Object.entries(parsed)
        .filter(([, snapshots]) => Array.isArray(snapshots))
        .map(([hotelId, snapshots]) => [
          hotelId,
          snapshots
            .filter(
              (snapshot) =>
                snapshot
                && typeof snapshot === 'object'
                && snapshot.hotelId === hotelId
                && typeof snapshot.observedAt === 'string',
            )
            .slice(-SNAPSHOT_RETENTION),
        ]),
    )
  } catch {
    return {}
  }
}

export const appendAndPersistSnapshot = (store, path, snapshot) => {
  const current = Array.isArray(store[snapshot.hotelId])
    ? store[snapshot.hotelId]
    : []
  store[snapshot.hotelId] = [...current, snapshot].slice(-SNAPSHOT_RETENTION)
  if (!path) return
  mkdirSync(dirname(path), { recursive: true })
  const temporaryPath = `${path}.${process.pid}.tmp`
  writeFileSync(
    temporaryPath,
    `${JSON.stringify(store, null, 2)}\n`,
    { encoding: 'utf8', mode: 0o600 },
  )
  renameSync(temporaryPath, path)
}
