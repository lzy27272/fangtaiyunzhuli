import { createHmac, randomUUID } from 'node:crypto'
import { createDailyOrderSummary } from './daily-order-summary.mjs'
import {
  finalizeLiveSnapshot,
  monitorFromSnapshot,
} from './live-report-collector.mjs'

const AUTHORIZED_HOST = 'pms.ygjpms.com'
const MAX_RESPONSE_BYTES = 12 * 1024 * 1024
const MAX_ORDER_PAGES = 50
const SHANGHAI_OFFSET = '+08:00'
const CONTRACTS = new Map([
  ['/newPms/reportAPP/nowRoomStateReport', 'REALTIME_OVERVIEW'],
  ['/newPms/orderManage/selectAll', 'ORDER_DETAIL'],
  ['/newPms/reportAPP/rateCalendarReport', 'ROOM_FORECAST'],
])
const SENSITIVE_QUERY_KEY =
  /(?:token|cookie|password|passwd|secret|session|authorization|api[_-]?key|sign(?:ature)?)/i

const finiteNumber = (value) => {
  if (value === null || value === undefined || value === '') return null
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

const rounded = (value, digits = 2) =>
  value === null || value === undefined
    ? null
    : Number(Number(value).toFixed(digits))

const canonicalDate = (value) => {
  const match = String(value ?? '').trim().match(/^(\d{4})[-/]?(\d{2})[-/]?(\d{2})/u)
  if (!match) return null
  const normalized = `${match[1]}-${match[2]}-${match[3]}`
  const parsed = new Date(`${normalized}T00:00:00Z`)
  return !Number.isNaN(parsed.getTime())
    && parsed.toISOString().slice(0, 10) === normalized
    ? normalized
    : null
}

const addDays = (dateText, days) => {
  const date = new Date(`${dateText}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

const shanghaiParts = (date) => Object.fromEntries(
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date)
    .filter((part) => part.type !== 'literal')
    .map((part) => [part.type, part.value]),
)

const shanghaiDate = (date) => {
  const parts = shanghaiParts(date)
  return `${parts.year}-${parts.month}-${parts.day}`
}

const localIso = (date) => {
  const parts = shanghaiParts(date)
  return `${parts.year}-${parts.month}-${parts.day}`
    + `T${parts.hour}:${parts.minute}:${parts.second}${SHANGHAI_OFFSET}`
}

const hmac = (key, value, length = 32) =>
  createHmac('sha256', key).update(String(value)).digest('hex').slice(0, length)

export const normalizeYilianAccessToken = (value) => {
  const token = typeof value === 'string' ? value.trim() : ''
  if (
    token.length < 16
    || token.length > 4096
    || /[\r\n\u0000-\u001f\u007f]/u.test(token)
  ) throw new Error('YILIAN_ACCESS_TOKEN_INVALID')
  return token
}

const sourceContract = (source) => {
  let endpoint
  try {
    endpoint = new URL(source?.endpointUrl)
  } catch {
    throw new Error('YILIAN_ENDPOINT_INVALID')
  }
  if (
    endpoint.protocol !== 'https:'
    || endpoint.hostname !== AUTHORIZED_HOST
    || endpoint.port
    || endpoint.username
    || endpoint.password
    || endpoint.hash
    || [...endpoint.searchParams.keys()].some((key) =>
      SENSITIVE_QUERY_KEY.test(key))
  ) throw new Error('YILIAN_ENDPOINT_NOT_ALLOWED')
  const contract = CONTRACTS.get(endpoint.pathname)
  if (!contract) throw new Error('YILIAN_ENDPOINT_NOT_SUPPORTED')
  return { contract, endpoint }
}

const requestUrl = (source, reportDate, pageNumber = null) => {
  const { contract, endpoint } = sourceContract(source)
  const url = new URL(endpoint)
  if (contract === 'ROOM_FORECAST') {
    url.searchParams.set('startDate', reportDate)
    url.searchParams.set('endDate', addDays(reportDate, 13))
  }
  if (contract === 'ORDER_DETAIL') {
    url.searchParams.set('pageNum', String(pageNumber ?? 1))
  }
  return { contract, url }
}

const readLimitedJson = async (response) => {
  if (!response.body) throw new Error('YILIAN_EMPTY_RESPONSE')
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
        throw new Error('YILIAN_RESPONSE_TOO_LARGE')
      }
      chunks.push(Buffer.from(value))
    }
  } finally {
    reader.releaseLock()
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    throw new Error('YILIAN_RESPONSE_JSON_INVALID')
  }
}

const fetchRoot = async ({
  source,
  accessToken,
  reportDate,
  pageNumber = null,
  fetchImpl,
}) => {
  const { contract, url } = requestUrl(source, reportDate, pageNumber)
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 20_000)
  let response
  try {
    response = await fetchImpl(url, {
      method: 'GET',
      redirect: 'manual',
      signal: controller.signal,
      headers: {
        Accept: 'application/json, text/plain, */*',
        'Accept-Language': 'zh-CN,zh;q=0.9',
        'Content-Type': 'text/xml',
        access_token: accessToken,
        Referer: `${url.origin}/saas/`,
        'User-Agent': 'Sifangguan-ReadOnly-Yilian-Collector/1.0',
      },
    })
  } catch (error) {
    if (error?.name === 'AbortError') throw new Error('YILIAN_REQUEST_TIMEOUT')
    throw new Error('YILIAN_REQUEST_FAILED')
  } finally {
    clearTimeout(timer)
  }
  if (
    [401, 403].includes(response.status)
    || [301, 302, 303, 307, 308].includes(response.status)
  ) throw new Error('YILIAN_SESSION_REAUTH_REQUIRED')
  if (!response.ok) throw new Error('YILIAN_HTTP_ERROR')
  const root = await readLimitedJson(response)
  const code = Number(root?.code)
  if (code === 202) throw new Error('YILIAN_SESSION_REAUTH_REQUIRED')
  if (code !== 200) throw new Error('YILIAN_REPORT_CODE_REJECTED')
  return { contract, root }
}

const forecastRows = (root) => {
  if (!Array.isArray(root?.data)) throw new Error('YILIAN_REPORT_DATA_INVALID')
  const rows = root.data.flatMap((group) =>
    Array.isArray(group?.list) ? group.list : [])
  if (rows.length < 1) throw new Error('YILIAN_REPORT_DATA_INVALID')
  return rows
}

const businessDateFromForecast = (root) => {
  const candidates = []
  for (const group of Array.isArray(root?.data) ? root.data : []) {
    candidates.push(group?.nowDate)
    for (const row of Array.isArray(group?.list) ? group.list : []) {
      for (const detail of Array.isArray(row?.rateCalendarDetailDtoList)
        ? row.rateCalendarDetailDtoList
        : []) candidates.push(detail?.nowDate)
    }
  }
  const dates = candidates.map(canonicalDate).filter(Boolean).sort()
  if (dates.length < 1) throw new Error('YILIAN_BUSINESS_DATE_INVALID')
  return dates[0]
}

const sum = (rows, field) => {
  const values = rows.map((row) => finiteNumber(row?.[field])).filter((value) => value !== null)
  return values.length < 1 ? null : rounded(values.reduce((total, value) => total + value, 0))
}

const safeDisplayName = (value) => {
  const text = typeof value === 'string' ? value.trim().slice(0, 80) : ''
  return text || '未命名实体房型'
}

const realtimeState = (root, reportDate, secretKey) => {
  const rows = Array.isArray(root?.data)
    ? root.data.flatMap((group) =>
        Array.isArray(group?.list) ? group.list : [group])
      .filter((row) => row && typeof row === 'object' && !Array.isArray(row))
    : []
  if (rows.length < 1) throw new Error('YILIAN_REPORT_DATA_INVALID')
  const physicalInventory = rows.map((row) => {
    const displayName = safeDisplayName(row.roomClassName)
    const code = hmac(secretKey, `room-type:${displayName}`, 16)
    return {
      inventoryPoolId: `PMS-${code}`,
      physicalRoomTypeCode: `PMS-${code}`,
      displayName,
      physicalRoomCount: finiteNumber(row.allCount),
      primaryAvailableRooms: finiteNumber(row.canSellCount),
      estimatedRoomNights: rounded(
        (finiteNumber(row.passNightCount) ?? 0)
        + (finiteNumber(row.reserveCount) ?? 0),
      ),
      estimatedRoomFee: finiteNumber(row.roomIncome),
      estimatedAdr: finiteNumber(row.avgRoomCharge),
    }
  })
  const roomCount = sum(rows, 'allCount')
  const availableRooms = sum(rows, 'canSellCount')
  const reservedRooms = sum(rows, 'reserveCount')
  const stayoverRooms = sum(rows, 'passNightCount')
  const soldRooms = reservedRooms === null && stayoverRooms === null
    ? roomCount !== null && availableRooms !== null
      ? Math.max(0, roomCount - availableRooms - (sum(rows, 'serviceCount') ?? 0))
      : null
    : rounded((reservedRooms ?? 0) + (stayoverRooms ?? 0))
  const roomFee = sum(rows, 'roomIncome')
  const overview = {
    stayDate: reportDate,
    roomCount,
    availableRooms,
    soldRooms,
    orderRooms: reservedRooms,
    checkinRooms: sum(rows, 'checkInCount'),
    roomFee,
    revenue: roomFee,
    roomNights: soldRooms,
    occupancyRate:
      roomCount && soldRooms !== null ? rounded(soldRooms / roomCount, 4) : null,
    adr:
      soldRooms && roomFee !== null ? rounded(roomFee / soldRooms) : null,
    revPar:
      roomCount && roomFee !== null ? rounded(roomFee / roomCount) : null,
  }
  if (overview.roomCount === null || overview.availableRooms === null) {
    throw new Error('YILIAN_REPORT_DATA_INVALID')
  }
  if (
    overview.roomCount < 0
    || overview.availableRooms < 0
    || overview.soldRooms === null
    || overview.soldRooms < 0
    || overview.availableRooms > overview.roomCount
    || overview.soldRooms > overview.roomCount
    || overview.availableRooms + overview.soldRooms > overview.roomCount
    || physicalInventory.some((room) =>
      room.physicalRoomCount === null
      || room.primaryAvailableRooms === null
      || room.estimatedRoomNights === null
      || room.physicalRoomCount < 0
      || room.primaryAvailableRooms < 0
      || room.estimatedRoomNights < 0
      || room.primaryAvailableRooms > room.physicalRoomCount
      || room.estimatedRoomNights > room.physicalRoomCount
      || room.primaryAvailableRooms + room.estimatedRoomNights
        > room.physicalRoomCount)
  ) throw new Error('YILIAN_REPORT_DATA_INVALID')
  return { overview, physicalInventory }
}

const forecastState = (root, reportDate, secretKey) => {
  const current = []
  const daily = new Map()
  for (const row of forecastRows(root)) {
    const displayName = safeDisplayName(row.roomClass)
    const code = hmac(secretKey, `room-type:${displayName}`, 16)
    const details = Array.isArray(row.rateCalendarDetailDtoList)
      ? row.rateCalendarDetailDtoList
      : []
    for (const detail of details) {
      const stayDate = canonicalDate(detail?.nowDate)
      if (!stayDate || stayDate < reportDate || stayDate > addDays(reportDate, 13)) continue
      const availableRooms = finiteNumber(detail.sumRoomClassNum)
      const soldRooms = finiteNumber(detail.useIngNum)
      const serviceRooms = finiteNumber(detail.serviceCount)
      const retainedRooms = finiteNumber(detail.retainCount)
      const roomCount = [availableRooms, soldRooms, serviceRooms, retainedRooms]
        .every((value) => value === null)
        ? finiteNumber(row.sumRoomClassNum)
        : rounded(
            (availableRooms ?? 0)
            + (soldRooms ?? 0)
            + (serviceRooms ?? 0)
            + (retainedRooms ?? 0),
          )
      if (stayDate === reportDate) {
        current.push({
          inventoryPoolId: `PMS-${code}`,
          physicalRoomTypeCode: `PMS-${code}`,
          displayName,
          physicalRoomCount: roomCount,
          primaryAvailableRooms: availableRooms,
          estimatedRoomNights: soldRooms,
          estimatedRoomFee: null,
          estimatedAdr: null,
          forecastRevPar: null,
          forecastOverbookingCount: null,
          forecastCheckinCount: finiteNumber(detail.checkIn),
          forecastOrderCount: soldRooms,
          forecastMaintainingCount: serviceRooms,
        })
      }
      const aggregate = daily.get(stayDate) ?? {
        stayDate,
        roomCount: 0,
        availableRooms: 0,
        soldRooms: 0,
        orderRooms: 0,
        checkinRooms: 0,
        roomFee: null,
        revenue: null,
        roomNights: 0,
      }
      aggregate.roomCount += roomCount ?? 0
      aggregate.availableRooms += availableRooms ?? 0
      aggregate.soldRooms += soldRooms ?? 0
      aggregate.orderRooms += soldRooms ?? 0
      aggregate.checkinRooms += finiteNumber(detail.checkIn) ?? 0
      aggregate.roomNights += soldRooms ?? 0
      daily.set(stayDate, aggregate)
    }
  }
  const futureDaily = [...daily.values()]
    .sort((left, right) => left.stayDate.localeCompare(right.stayDate))
    .map((row) => ({
      ...row,
      roomCount: rounded(row.roomCount),
      availableRooms: rounded(row.availableRooms),
      soldRooms: rounded(row.soldRooms),
      orderRooms: rounded(row.orderRooms),
      checkinRooms: rounded(row.checkinRooms),
      roomNights: rounded(row.roomNights),
      occupancyRate: row.roomCount > 0
        ? rounded(row.soldRooms / row.roomCount, 4)
        : null,
      adr: null,
      revPar: null,
    }))
  if (current.length < 1 || futureDaily.length < 1) {
    throw new Error('YILIAN_REPORT_DATA_INVALID')
  }
  return { current, futureDaily }
}

const dateOnly = (value) => canonicalDate(value)

const detectChannel = (row) => {
  const text = [row?.channelName, row?.rentClassName, row?.protocolName]
    .filter((value) => typeof value === 'string')
    .join('\n')
  if (/(?:携程|ctrip|trip\.com)/iu.test(text)) return 'CTRIP'
  if (/(?:美团|meituan)/iu.test(text)) return 'MEITUAN'
  if (/(?:飞猪|fliggy|alitrip)/iu.test(text)) return 'FEIZHU'
  if (/(?:抖音|douyin)/iu.test(text)) return 'DOUYIN'
  return 'UNKNOWN'
}

const orderRoomNights = (row) => {
  const lines = Array.isArray(row?.list) ? row.list : []
  let total = 0
  for (const line of lines) {
    const roomCount = finiteNumber(line?.roomCount) ?? 1
    const priceDays = Array.isArray(line?.price) ? line.price.length : 0
    const arrival = dateOnly(row?.etaTime)
    const departure = dateOnly(row?.dueOutTime)
    const dateNights = arrival && departure
      ? Math.max(1, Math.round(
          (new Date(`${departure}T00:00:00Z`).getTime()
            - new Date(`${arrival}T00:00:00Z`).getTime()) / 86_400_000,
        ))
      : 1
    total += roomCount * Math.max(1, priceDays || dateNights)
  }
  return rounded(total)
}

const orderState = (root, reportDate, secretKey) => {
  const rows = root?.data?.list
  if (!Array.isArray(rows)) throw new Error('YILIAN_REPORT_DATA_INVALID')
  const grouped = new Map()
  for (const row of rows) {
    if (!row || typeof row !== 'object' || Array.isArray(row)) continue
    const arrivalDate = dateOnly(row.etaTime)
    const orderDate = dateOnly(row.createTime)
    const rawKey = typeof row.orderId === 'string' && row.orderId.trim()
      ? `order:${row.orderId.trim()}`
      : JSON.stringify([
          orderDate,
          arrivalDate,
          dateOnly(row.dueOutTime),
          row.recState ?? '',
          row.allAmount ?? '',
        ])
    const key = hmac(secretKey, rawKey)
    const canceled = /(?:取消|cancel|cancelled|canceled)/iu.test(
      `${row.recState ?? ''}\n${row.teamStatus ?? ''}`,
    )
    grouped.set(key, {
      key,
      channel: detectChannel(row),
      status: canceled ? 'CANCELLED' : 'ACTIVE',
      roomNights: orderRoomNights(row),
      arrivalClass:
        arrivalDate === reportDate
          ? 'TODAY'
          : arrivalDate && arrivalDate > reportDate
            ? 'FUTURE'
            : 'OTHER',
      orderDate,
      arrivalDate,
    })
  }
  return [...grouped.values()].sort((left, right) => left.key.localeCompare(right.key))
}

const fetchAllOrders = async ({ source, accessToken, reportDate, fetchImpl }) => {
  const first = await fetchRoot({ source, accessToken, reportDate, fetchImpl })
  const list = first.root?.data?.list
  if (!Array.isArray(list)) throw new Error('YILIAN_REPORT_DATA_INVALID')
  const total = finiteNumber(first.root?.data?.total) ?? list.length
  const configured = new URL(source.endpointUrl)
  const pageSize = Number.parseInt(
    configured.searchParams.get('pageSize') ?? '',
    10,
  )
  if (
    !Number.isInteger(pageSize)
    || pageSize < 1
    || pageSize > 200
    || list.length > pageSize
  ) throw new Error('YILIAN_ORDER_PAGE_SIZE_INVALID')
  const pageCount = Math.ceil(total / pageSize)
  if (pageCount > MAX_ORDER_PAGES) {
    throw new Error('YILIAN_ORDER_PAGINATION_LIMIT')
  }
  const additional = []
  for (let pageNumber = 2; pageNumber <= pageCount; pageNumber += 1) {
    const page = await fetchRoot({
      source,
      accessToken,
      reportDate,
      pageNumber,
      fetchImpl,
    })
    const rows = page.root?.data?.list
    if (!Array.isArray(rows)) throw new Error('YILIAN_REPORT_DATA_INVALID')
    additional.push(...rows)
    if (rows.length < pageSize) break
  }
  const combined = [...list, ...additional]
  if (combined.length < total) throw new Error('YILIAN_ORDER_PAGINATION_INCOMPLETE')
  return {
    contract: first.contract,
    root: {
      ...first.root,
      data: { ...first.root.data, list: combined },
    },
  }
}

const sourceCodeFor = (contract, sourceId) => {
  const prefix = contract === 'REALTIME_OVERVIEW'
    ? 'YILIAN_REALTIME'
    : contract === 'ORDER_DETAIL'
      ? 'YILIAN_ORDER'
      : 'YILIAN_FORECAST'
  return `${prefix}_${String(sourceId).slice(0, 8)}`
}

const sourceByContract = (sources, contract) => {
  const matches = sources.filter((source) => sourceContract(source).contract === contract)
  if (matches.length !== 1) throw new Error('YILIAN_SOURCE_CONTRACT_INVALID')
  return matches[0]
}

const accessTokenForSources = (sources, accessTokensBySourceId) => {
  const values = [...new Set(sources.map((source) =>
    accessTokensBySourceId[source.sourceId]).filter(Boolean))]
  if (values.length !== 1) throw new Error('YILIAN_ACCESS_TOKEN_REQUIRED')
  return normalizeYilianAccessToken(values[0])
}

const fetchCore = async ({
  sources,
  accessToken,
  now,
  fetchImpl,
  includeAllOrders,
}) => {
  const forecastSource = sourceByContract(sources, 'ROOM_FORECAST')
  const realtimeSource = sourceByContract(sources, 'REALTIME_OVERVIEW')
  const orderSource = sourceByContract(sources, 'ORDER_DETAIL')
  const calendarDate = shanghaiDate(now)
  let forecast = await fetchRoot({
    source: forecastSource,
    accessToken,
    reportDate: calendarDate,
    fetchImpl,
  })
  const businessDate = businessDateFromForecast(forecast.root)
  if (businessDate !== calendarDate) {
    forecast = await fetchRoot({
      source: forecastSource,
      accessToken,
      reportDate: businessDate,
      fetchImpl,
    })
  }
  const [realtime, orders] = await Promise.all([
    fetchRoot({
      source: realtimeSource,
      accessToken,
      reportDate: businessDate,
      fetchImpl,
    }),
    includeAllOrders
      ? fetchAllOrders({
          source: orderSource,
          accessToken,
          reportDate: businessDate,
          fetchImpl,
        })
      : fetchRoot({
          source: orderSource,
          accessToken,
          reportDate: businessDate,
          fetchImpl,
        }),
  ])
  return {
    businessDate,
    records: new Map([
      [forecastSource.sourceId, forecast],
      [realtimeSource.sourceId, realtime],
      [orderSource.sourceId, orders],
    ]),
  }
}

export const validateYilianAccessToken = async ({
  sources,
  accessToken,
  now = new Date(),
  fetchImpl = fetch,
}) => {
  const enabledSources = sources.filter((source) => source.enabled)
  if (enabledSources.length !== 3) throw new Error('YILIAN_SOURCE_CONTRACT_INVALID')
  const token = normalizeYilianAccessToken(accessToken)
  const result = await fetchCore({
    sources: enabledSources,
    accessToken: token,
    now,
    fetchImpl,
    includeAllOrders: false,
  })
  return {
    sourceCount: enabledSources.length,
    successfulSourceCount: result.records.size,
    businessDate: result.businessDate,
    outboundDeliveryAttempted: false,
  }
}

export const collectYilianCloudReports = async ({
  hotel,
  sources,
  accessTokensBySourceId,
  previousSnapshots = [],
  secretKey,
  target = null,
  hotSellingRoomTypeCodes = [],
  configuredReportDate = null,
  now = new Date(),
  fetchImpl = fetch,
}) => {
  const enabledSources = sources.filter((source) => source.enabled)
  if (enabledSources.length !== 3) throw new Error('YILIAN_SOURCE_CONTRACT_INVALID')
  const accessToken = accessTokenForSources(enabledSources, accessTokensBySourceId)
  const fetched = await fetchCore({
    sources: enabledSources,
    accessToken,
    now,
    fetchImpl,
    includeAllOrders: true,
  })
  const previousBusinessDate = configuredReportDate
    ? canonicalDate(configuredReportDate)
    : null
  if (configuredReportDate && !previousBusinessDate) {
    throw new Error('YILIAN_BUSINESS_DATE_INVALID')
  }
  const observedAt = localIso(now)
  const realtimeRecord = [...fetched.records.values()].find(
    (record) => record.contract === 'REALTIME_OVERVIEW',
  )
  const orderRecord = [...fetched.records.values()].find(
    (record) => record.contract === 'ORDER_DETAIL',
  )
  const forecastRecord = [...fetched.records.values()].find(
    (record) => record.contract === 'ROOM_FORECAST',
  )
  const realtime = realtimeState(
    realtimeRecord.root,
    fetched.businessDate,
    secretKey,
  )
  const orders = orderState(orderRecord.root, fetched.businessDate, secretKey)
  const forecast = forecastState(
    forecastRecord.root,
    fetched.businessDate,
    secretKey,
  )
  const collectionRunId = randomUUID()
  const baseSnapshot = {
    schemaVersion: 1,
    sourceSystem: 'YILIAN_CLOUD',
    collectionRunId,
    tenantId: hotel.tenantId,
    hotelId: hotel.hotelId,
    businessDate: fetched.businessDate,
    businessDateBasis: 'PMS_CONFIRMED',
    businessDateSource: 'YILIAN_RATE_CALENDAR',
    businessDateStartedAt: null,
    previousBusinessDate,
    businessDateChanged:
      previousBusinessDate !== null
      && previousBusinessDate !== fetched.businessDate,
    observedAt,
    completeness: 'COMPLETE',
    sources: enabledSources.map((source) => {
      const contract = fetched.records.get(source.sourceId)?.contract
      return {
        sourceId: source.sourceId,
        sourceCode: sourceCodeFor(contract, source.sourceId),
        reportType: source.reportType,
        completeness: 'COMPLETE',
        observedAt,
        ingestedAt: localIso(new Date()),
        errorCode: null,
      }
    }),
    orders,
    dailyOrderSummary: createDailyOrderSummary({
      orders,
      businessDate: fetched.businessDate,
    }),
    overview: realtime.overview,
    futureDaily: forecast.futureDaily.filter(
      (row) => row.stayDate > fetched.businessDate,
    ),
    physicalInventory: realtime.physicalInventory,
    roomForecast: forecast.current,
  }
  const snapshot = finalizeLiveSnapshot({
    snapshot: baseSnapshot,
    previousSnapshots,
    now,
  })
  return {
    run: {
      runId: collectionRunId,
      status: 'SUCCEEDED',
      requestedAt: observedAt,
      completedAt: localIso(new Date()),
      businessDate: fetched.businessDate,
      previousBusinessDate,
      businessDateChanged: baseSnapshot.businessDateChanged,
      businessDateSource: 'YILIAN_RATE_CALENDAR',
      businessDateStartedAt: null,
      sourceCount: enabledSources.length,
      successfulSourceCount: enabledSources.length,
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
