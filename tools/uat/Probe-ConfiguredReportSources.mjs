#!/usr/bin/env node

import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { decryptCookie } from './report-source-cookie-crypto.mjs'

const configPath = process.env.OTA_REVIEW_PROBE_CONFIG_PATH
const cookieSecretsPath = process.env.OTA_REVIEW_PROBE_COOKIE_SECRETS_PATH
const cookieSecretKey = process.env.OTA_REVIEW_PROBE_SECRET_KEY
const hotelId = process.env.OTA_REVIEW_PROBE_HOTEL_ID
const requestMethod = (
  process.env.OTA_REVIEW_PROBE_METHOD ?? 'GET'
).toUpperCase()
const requestProfile =
  process.env.OTA_REVIEW_PROBE_PROFILE ?? 'BROWSER_JSON'
const reportDate = process.env.OTA_REVIEW_PROBE_REPORT_DATE
const reportEndDate = process.env.OTA_REVIEW_PROBE_REPORT_END_DATE
const configuredOrgId = process.env.OTA_REVIEW_PROBE_ORG_ID
const sourceIdFilter = process.env.OTA_REVIEW_PROBE_SOURCE_ID
const lowercaseLastPathSegment =
  process.env.OTA_REVIEW_PROBE_LOWERCASE_LAST_SEGMENT === 'true'

if (
  !configPath
  || !cookieSecretsPath
  || !cookieSecretKey
  || !hotelId
  || !['GET', 'POST'].includes(requestMethod)
  || ![
    'BROWSER_JSON',
    'MINIMAL_JSON',
    'MINIMAL_NO_BODY',
    'FORM_EMPTY',
    'REPORT_FILTERS_DIRECT',
    'REPORT_FILTERS_VARIABLES',
    'REPORT_FILTERS_DATA',
    'JY09_FUTURE_INVENTORY',
    'ROOM_WORKBENCH_INVENTORY',
  ].includes(requestProfile)
  || (
    requestProfile.startsWith('REPORT_FILTERS_')
    && !/^\d{4}-\d{2}-\d{2}$/.test(reportDate ?? '')
  )
  || (
    configuredOrgId !== undefined
    && !/^\d+$/.test(configuredOrgId)
  )
  || (
    requestProfile === 'JY09_FUTURE_INVENTORY'
    && !/^\d{4}-\d{2}-\d{2}$/.test(reportEndDate ?? '')
  )
  || (
    sourceIdFilter !== undefined
    && !/^[0-9a-f-]{36}$/i.test(sourceIdFilter)
  )
) {
  process.stderr.write('REPORT_PROBE_CONFIGURATION_INVALID\n')
  process.exit(2)
}

const configByHotel = JSON.parse(readFileSync(configPath, 'utf8'))
const secretsByHotel = JSON.parse(readFileSync(cookieSecretsPath, 'utf8'))
const sources = configByHotel[hotelId]
const secrets = secretsByHotel[hotelId]

if (!Array.isArray(sources) || !secrets || typeof secrets !== 'object') {
  process.stderr.write('REPORT_PROBE_HOTEL_CONFIGURATION_MISSING\n')
  process.exit(3)
}

const MAX_RESPONSE_BYTES = 10 * 1024 * 1024
const MAX_TRAVERSED_NODES = 200_000
const MAX_ARRAY_OBSERVATIONS = 5_000
const MAX_SCHEMA_ROWS = 200
const BUSINESS_FIELD =
  /(?:room|revenue|amount|price|rate|inventory|available|remain|sold|order|cancel|check.?in|check.?out|arrival|departure|business|date|night|occup|adr|revpar|房|收入|金额|房价|可售|库存|订单|取消|入住|离店|营业日|间夜|数量|状态)/i
const SENSITIVE_FIELD =
  /(?:guest|customer|member|contractName|phone|mobile|identity|idcard|cardno|address|email|contact|user|account|token|cookie|secret|姓名|客人|住客|会员|手机|电话|证件|身份证|地址|邮箱|账号)/i

const classifyControlText = (values) => {
  const strings = []
  const collectStrings = (value, depth = 0) => {
    if (strings.length >= 30 || depth > 4 || value === null) return
    if (typeof value === 'string') {
      strings.push(value)
      return
    }
    if (Array.isArray(value)) {
      for (const item of value.slice(0, 10)) collectStrings(item, depth + 1)
      return
    }
    if (typeof value === 'object') {
      for (const child of Object.values(value).slice(0, 30)) {
        collectStrings(child, depth + 1)
      }
    }
  }
  for (const value of values) collectStrings(value)
  const joined = strings.join('\n')
  const categories = []
  const hints = []
  const patterns = [
    ['AUTH_OR_SESSION', /(?:登录|登陆|认证|会话|令牌|login|auth|session|token|cookie|过期|失效)/i],
    ['PERMISSION', /(?:权限|无权|拒绝|禁止|permission|forbidden|denied)/i],
    ['HOTEL_OR_TENANT_CONTEXT', /(?:酒店|门店|租户|组织|hotel|tenant|org)/i],
    ['REQUEST_PARAMETER', /(?:参数|请求|parameter|argument|invalid request)/i],
    ['SERVER_FAILURE', /(?:系统|服务|异常|错误|system|service|exception|error)/i],
  ]
  for (const [category, pattern] of patterns) {
    if (pattern.test(joined)) categories.push(category)
  }
  const hintPatterns = [
    ['HOTEL_ID', /(?:hotel[_-]?id|酒店\s*id|门店\s*id)/i],
    ['TENANT_ID', /(?:tenant[_-]?id|租户\s*id)/i],
    ['ORG_ID', /(?:org(?:anization)?[_-]?id|组织\s*id)/i],
    ['LOGIN_CONTEXT', /(?:login[_-]?(?:hotel|org)|登录酒店|登录组织)/i],
    ['MISSING_OR_REQUIRED', /(?:missing|required|不能为空|为空|缺少|未传|null)/i],
    ['METHOD_OR_BODY', /(?:post|request body|请求体|请求方式|method)/i],
  ]
  for (const [hint, pattern] of hintPatterns) {
    if (pattern.test(joined)) hints.push(hint)
  }
  const redactedPreview = joined
    .replace(/https?:\/\/\S+/gi, '<URL>')
    .replace(/[A-Za-z0-9_=-]{24,}/g, '<OPAQUE>')
    .replace(/\d{4,}/g, '<NUM>')
    .slice(0, 600)
  return {
    categories,
    hints,
    redactedPreview,
    textFieldCount: strings.length,
    combinedSha256:
      joined.length > 0
        ? createHash('sha256').update(joined).digest('hex')
        : null,
  }
}

const inspectCookieMetadata = (cookie) => {
  const segments = cookie.split(';')
  const names = []
  let invalidSegmentCount = 0
  for (const segment of segments) {
    const separator = segment.indexOf('=')
    if (separator < 1) {
      invalidSegmentCount += 1
      continue
    }
    const name = segment.slice(0, separator).trim()
    if (!name || /\s/.test(name)) {
      invalidSegmentCount += 1
      continue
    }
    names.push(name)
  }
  const nameSet = new Set(names)
  const tokenSegment = segments.find((segment) =>
    segment.trim().startsWith('hotelpms_token='))
  const tokenLength =
    tokenSegment === undefined
      ? 0
      : tokenSegment.slice(tokenSegment.indexOf('=') + 1).trim().length
  return {
    cookieBytes: Buffer.byteLength(cookie, 'utf8'),
    cookieNameCount: names.length,
    uniqueCookieNameCount: nameSet.size,
    invalidSegmentCount,
    hasMarkdownAsterisks: cookie.includes('**'),
    hasCookieHeaderPrefix: /^\s*cookie\s*:/i.test(cookie),
    hasHotelPmsToken: nameSet.has('hotelpms_token'),
    tokenLengthPlausible: tokenLength >= 32,
    hasTenantId: nameSet.has('hotelpms_tenant_id'),
    hasLoginOrgId: nameSet.has('hotelpms_login_org_id'),
    hasLoginOrgType: nameSet.has('hotelpms_login_org_type'),
    hasLoginHotelId: nameSet.has('hotelpms_login_hotel_id'),
    hasShift: nameSet.has('hotelpms_shift'),
    loginContextComplete:
      nameSet.has('hotelpms_token')
      && nameSet.has('hotelpms_tenant_id')
      && nameSet.has('hotelpms_login_org_id')
      && nameSet.has('hotelpms_login_org_type')
      && nameSet.has('hotelpms_login_hotel_id'),
  }
}

const readCookieValue = (cookie, name) => {
  for (const segment of cookie.split(';')) {
    const separator = segment.indexOf('=')
    if (separator < 1) continue
    if (segment.slice(0, separator).trim() === name) {
      return segment.slice(separator + 1).trim()
    }
  }
  return null
}

const createReportFilters = (cookie) => {
  const orgId =
    configuredOrgId ?? readCookieValue(cookie, 'hotelpms_login_hotel_id')
  if (!orgId || !/^\d+$/.test(orgId)) {
    throw new Error('REPORT_PROBE_ORG_ID_INVALID')
  }
  return {
    startDate: reportDate,
    endDate: reportDate,
    orgId,
    memberLevel: null,
    integratedBusiness: null,
    isSplited: false,
  }
}

const createJy09FutureInventoryFilters = (cookie) => {
  const orgId =
    configuredOrgId ?? readCookieValue(cookie, 'hotelpms_login_hotel_id')
  if (!orgId || !/^\d+$/.test(orgId)) {
    throw new Error('REPORT_PROBE_ORG_ID_INVALID')
  }
  return {
    hotelId: orgId,
    startDate: reportDate,
    endDate: reportEndDate,
    dimension: 'Hotel',
  }
}

const createRoomWorkbenchInventoryFilters = (cookie) => {
  const orgId =
    configuredOrgId ?? readCookieValue(cookie, 'hotelpms_login_hotel_id')
  if (!orgId || !/^\d+$/.test(orgId)) {
    throw new Error('REPORT_PROBE_ORG_ID_INVALID')
  }
  return {
    orgId,
    timeType: '1',
    startDate: reportDate,
    endDate: reportDate,
  }
}

const createRoomWorkbenchContextHeaders = (cookie) => {
  const bindings = [
    ['hotelpms-tenant-id', 'hotelpms_tenant_id'],
    ['hotelpms-token', 'hotelpms_token'],
    ['hotelpms-login-hotel-id', 'hotelpms_login_hotel_id'],
    ['hotelpms-login-org-id', 'hotelpms_login_org_id'],
    ['hotelpms-login-org-type', 'hotelpms_login_org_type'],
    ['hotelpms-shift', 'hotelpms_shift'],
    ['hotelpms-client-id', '_lxsdk_cuid'],
  ]
  const headers = {}
  for (const [headerName, cookieName] of bindings) {
    const value = readCookieValue(cookie, cookieName)
    if (!value || /[\r\n\u0000]/.test(value)) {
      throw new Error('REPORT_PROBE_PMS_CONTEXT_HEADER_INVALID')
    }
    headers[headerName] = value
  }
  headers['hotelpms-platform'] = 'pc'
  headers['m-appkey'] = 'fe_com.sankuai.hotelpms.web.report'
  return headers
}

const readLimited = async (response) => {
  if (!response.body) return Buffer.alloc(0)
  const chunks = []
  let total = 0
  const reader = response.body.getReader()
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > MAX_RESPONSE_BYTES) {
        await reader.cancel()
        throw new Error('REPORT_RESPONSE_TOO_LARGE')
      }
      chunks.push(Buffer.from(value))
    }
  } finally {
    reader.releaseLock()
  }
  return Buffer.concat(chunks)
}

const valueKind = (value) => {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'array'
  if (typeof value === 'object') return 'object'
  return typeof value
}

const createShapeSummary = (root) => {
  const paths = new Map()
  const arrays = new Map()
  const candidates = new Map()
  let traversedNodes = 0

  const recordPath = (path, kind) => {
    if (!path) return
    const current = paths.get(path) ?? { path, kinds: new Set(), count: 0 }
    current.kinds.add(kind)
    current.count += 1
    paths.set(path, current)
  }

  const recordCandidate = (path, value) => {
    const fieldName = path.split('.').at(-1)?.replace(/\[\]$/, '') ?? path
    if (!BUSINESS_FIELD.test(fieldName) || SENSITIVE_FIELD.test(fieldName)) {
      return
    }
    const kind = valueKind(value)
    const current = candidates.get(path) ?? {
      path,
      kinds: new Set(),
      count: 0,
      numericCount: 0,
      numericSum: 0,
      numericMin: null,
      numericMax: null,
      dateMin: null,
      dateMax: null,
    }
    current.kinds.add(kind)
    current.count += 1
    if (typeof value === 'number' && Number.isFinite(value)) {
      current.numericCount += 1
      current.numericSum += value
      current.numericMin =
        current.numericMin === null ? value : Math.min(current.numericMin, value)
      current.numericMax =
        current.numericMax === null ? value : Math.max(current.numericMax, value)
    } else if (
      typeof value === 'string'
      && /^\d{4}-\d{2}-\d{2}(?:[ T]\d{2}:\d{2}(?::\d{2})?)?/.test(value)
    ) {
      current.dateMin =
        current.dateMin === null || value < current.dateMin
          ? value
          : current.dateMin
      current.dateMax =
        current.dateMax === null || value > current.dateMax
          ? value
          : current.dateMax
    }
    candidates.set(path, current)
  }

  const visit = (value, path, depth) => {
    traversedNodes += 1
    if (traversedNodes > MAX_TRAVERSED_NODES || depth > 10) return
    const kind = valueKind(value)
    recordPath(path, kind)
    if (kind !== 'object' && kind !== 'array') {
      recordCandidate(path, value)
      return
    }
    if (Array.isArray(value)) {
      const summary = arrays.get(path) ?? {
        path,
        count: value.length,
        itemKinds: new Set(),
        itemKeys: new Set(),
      }
      summary.count = Math.max(summary.count, value.length)
      for (const item of value.slice(0, MAX_SCHEMA_ROWS)) {
        summary.itemKinds.add(valueKind(item))
        if (item && typeof item === 'object' && !Array.isArray(item)) {
          for (const key of Object.keys(item)) summary.itemKeys.add(key)
        }
      }
      arrays.set(path, summary)
      for (const item of value.slice(0, MAX_ARRAY_OBSERVATIONS)) {
        visit(item, `${path}[]`, depth + 1)
      }
      return
    }
    for (const [key, child] of Object.entries(value)) {
      visit(child, path ? `${path}.${key}` : key, depth + 1)
    }
  }

  visit(root, '', 0)
  return {
    traversedNodes,
    paths: [...paths.values()]
      .map((item) => ({
        path: item.path,
        kinds: [...item.kinds].sort(),
        observations: item.count,
      }))
      .filter((item) => item.path)
      .slice(0, 1_000),
    arrays: [...arrays.values()].map((item) => ({
      path: item.path,
      count: item.count,
      itemKinds: [...item.itemKinds].sort(),
      itemKeys: [...item.itemKeys].sort(),
    })),
    businessCandidates: [...candidates.values()].map((item) => ({
      path: item.path,
      kinds: [...item.kinds].sort(),
      observations: item.count,
      numeric:
        item.numericCount > 0
          ? {
              count: item.numericCount,
              sum: Number(item.numericSum.toFixed(4)),
              min: item.numericMin,
              max: item.numericMax,
            }
          : null,
      dateRange:
        item.dateMin === null
          ? null
          : { min: item.dateMin, max: item.dateMax },
    })),
  }
}

const createOrderCalculationEvidence = (root) => {
  const rows = root?.data?.dataList
  if (!Array.isArray(rows)) return null

  const roomUnits = (row) => {
    const value = Number(row?.roomCount)
    return Number.isFinite(value) && value > 0 ? value : 0
  }
  const createBucket = () => ({
    rows: 0,
    roomUnits: 0,
    uniqueOrderKeys: new Set(),
  })
  const addToBucket = (bucket, row) => {
    bucket.rows += 1
    bucket.roomUnits += roomUnits(row)
    if (typeof row?.orderNo === 'string' && row.orderNo) {
      bucket.uniqueOrderKeys.add(row.orderNo)
    }
  }
  const finishBucket = (bucket) => ({
    rows: bucket.rows,
    roomUnits: bucket.roomUnits,
    uniqueOrders: bucket.uniqueOrderKeys.size,
  })
  const groupBy = (field, include = () => true) => {
    const groups = new Map()
    for (const row of rows) {
      if (!include(row)) continue
      const raw = row?.[field]
      const label =
        typeof raw === 'string' && raw.trim()
          ? raw.trim().slice(0, 80)
          : '(空)'
      const bucket = groups.get(label) ?? createBucket()
      addToBucket(bucket, row)
      groups.set(label, bucket)
    }
    return [...groups.entries()]
      .map(([label, bucket]) => ({ label, ...finishBucket(bucket) }))
      .sort((a, b) => b.roomUnits - a.roomUnits || a.label.localeCompare(b.label))
  }
  const detectChannel = (row) => {
    const safeCandidateText = [
      row?.orderSource,
      row?.source,
      row?.roomPriceType,
      row?.prePaymentType,
      row?.operator,
      row?.remark,
      row?.url,
    ]
      .filter((value) => typeof value === 'string')
      .join('\n')
    if (/(?:携程|ctrip|trip\.com)/i.test(safeCandidateText)) return '携程'
    if (/(?:美团|meituan)/i.test(safeCandidateText)) return '美团'
    return '未识别'
  }
  const groupByDetectedChannel = (include = () => true) => {
    const groups = new Map()
    for (const row of rows) {
      if (!include(row)) continue
      const label = detectChannel(row)
      const bucket = groups.get(label) ?? createBucket()
      addToBucket(bucket, row)
      groups.set(label, bucket)
    }
    return [...groups.entries()]
      .map(([label, bucket]) => ({ label, ...finishBucket(bucket) }))
      .sort((a, b) => b.roomUnits - a.roomUnits || a.label.localeCompare(b.label))
  }
  const dateFormatCounts = new Map()
  const all = createBucket()
  const createdOnReportDate = createBucket()
  const createdOnReportDateArrivingToday = createBucket()
  const createdOnReportDateArrivingFuture = createBucket()
  const createdOnReportDateCurrentlyCanceled = createBucket()
  const arrivingOnReportDate = createBucket()
  const arrivingAfterReportDate = createBucket()
  const canceledRows = createBucket()
  const createdByHour = new Map()
  let roomPriceNumericRows = 0
  let roomPriceSum = 0
  let roomPriceTimesRoomUnitsSum = 0

  for (const row of rows) {
    addToBucket(all, row)
    const orderDate =
      typeof row?.orderDate === 'string' ? row.orderDate : ''
    const dateFormat =
      /^\d{4}-\d{2}-\d{2}$/.test(orderDate)
        ? 'DATE_ONLY'
        : /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(?::\d{2})?/.test(orderDate)
          ? 'DATE_TIME'
          : orderDate
            ? 'OTHER'
            : 'EMPTY'
    dateFormatCounts.set(
      dateFormat,
      (dateFormatCounts.get(dateFormat) ?? 0) + 1,
    )
    const arrivalDate =
      typeof row?.estArriveTime === 'string' ? row.estArriveTime : ''
    const orderStatus =
      typeof row?.orderStatus === 'string' ? row.orderStatus : ''
    if (reportDate && orderDate.startsWith(reportDate)) {
      addToBucket(createdOnReportDate, row)
      if (arrivalDate.startsWith(reportDate)) {
        addToBucket(createdOnReportDateArrivingToday, row)
      } else if (arrivalDate.slice(0, 10) > reportDate) {
        addToBucket(createdOnReportDateArrivingFuture, row)
      }
      if (/(?:取消|cancel)/i.test(orderStatus)) {
        addToBucket(createdOnReportDateCurrentlyCanceled, row)
      }
      const hourMatch = orderDate.match(
        /^(\d{4}-\d{2}-\d{2})[ T](\d{2})/,
      )
      if (hourMatch) {
        const hour = `${hourMatch[1]} ${hourMatch[2]}`
        const bucket = createdByHour.get(hour) ?? createBucket()
        addToBucket(bucket, row)
        createdByHour.set(hour, bucket)
      }
    }
    if (reportDate && arrivalDate.startsWith(reportDate)) {
      addToBucket(arrivingOnReportDate, row)
    } else if (reportDate && arrivalDate.slice(0, 10) > reportDate) {
      addToBucket(arrivingAfterReportDate, row)
    }
    if (/(?:取消|cancel)/i.test(orderStatus)) {
      addToBucket(canceledRows, row)
    }
    const roomPrice = Number(row?.roomPrice)
    if (Number.isFinite(roomPrice)) {
      roomPriceNumericRows += 1
      roomPriceSum += roomPrice
      roomPriceTimesRoomUnitsSum += roomPrice * roomUnits(row)
    }
  }

  return {
    semantics: {
      roomUnits:
        'sum(roomCount); not certified as consumed room-nights without report semantics',
      revenue:
        'roomPrice is quoted order price, not certified posted room-fee revenue',
      cancellation:
        'orderStatus can identify current canceled rows but no cancellation timestamp is present',
    },
    total: finishBucket(all),
    createdOnReportDate: finishBucket(createdOnReportDate),
    createdOnReportDateArrivingToday:
      finishBucket(createdOnReportDateArrivingToday),
    createdOnReportDateArrivingFuture:
      finishBucket(createdOnReportDateArrivingFuture),
    createdOnReportDateCurrentlyCanceled:
      finishBucket(createdOnReportDateCurrentlyCanceled),
    arrivingOnReportDate: finishBucket(arrivingOnReportDate),
    arrivingAfterReportDate: finishBucket(arrivingAfterReportDate),
    currentCanceledRows: finishBucket(canceledRows),
    priceCandidates: {
      numericRows: roomPriceNumericRows,
      roomPriceSum: Number(roomPriceSum.toFixed(2)),
      roomPriceTimesRoomUnitsSum: Number(
        roomPriceTimesRoomUnitsSum.toFixed(2),
      ),
    },
    byOrderSource: groupBy('orderSource'),
    bySource: groupBy('source'),
    byOrderStatus: groupBy('orderStatus'),
    byRoomPriceType: groupBy('roomPriceType'),
    byPrePaymentType: groupBy('prePaymentType').slice(0, 60),
    byDetectedChannel: groupByDetectedChannel(),
    createdOnReportDateByDetectedChannel: groupByDetectedChannel(
      (row) =>
        typeof row?.orderDate === 'string'
        && row.orderDate.startsWith(reportDate),
    ),
    createdOnReportDateByOrderStatus: groupBy(
      'orderStatus',
      (row) =>
        typeof row?.orderDate === 'string'
        && row.orderDate.startsWith(reportDate),
    ),
    createdByHour: [...createdByHour.entries()]
      .map(([hour, bucket]) => ({ hour, ...finishBucket(bucket) }))
      .sort((a, b) => a.hour.localeCompare(b.hour)),
    orderDateFormats: [...dateFormatCounts.entries()]
      .map(([format, count]) => ({ format, count }))
      .sort((a, b) => b.count - a.count),
  }
}

const createJy09CalculationEvidence = (root) => {
  const rows = root?.data?.dataList
  if (!Array.isArray(rows)) return null

  const numberOrNull = (value) => {
    const number = Number(value)
    return Number.isFinite(number) ? number : null
  }
  const dailyRows = rows
    .filter(
      (row) =>
        typeof row?.estimatedDate === 'string'
        && /^\d{4}-\d{2}-\d{2}$/.test(row.estimatedDate),
    )
    .map((row) => {
      const roomCount = numberOrNull(row.roomCount)
      const availableRoom = numberOrNull(row.availableRoom)
      const saleRoom = numberOrNull(row.saleRoom)
      return {
        date: row.estimatedDate,
        roomCount,
        availableRoom,
        saleRoom,
        orderRoom: numberOrNull(row.orderRoom),
        checkinRoom: numberOrNull(row.checkinRoom),
        maintenceRoom: numberOrNull(row.maintenceRoom),
        freeRoom: numberOrNull(row.freeRoom),
        internalRoom: numberOrNull(row.internalRoom),
        overSaleRoom: numberOrNull(row.overSaleRoom),
        estimatedRevenue: numberOrNull(row.estimatedRevenue),
        estimatedRoomFee: numberOrNull(row.estimatedRoomFee),
        estimatedRoomNights: numberOrNull(row.estimatedRoomNights),
        estimatedRentRate: numberOrNull(row.estimatedRentRate),
        estimatedAvgRoomPrice: numberOrNull(row.estimatedAvgRoomPrice),
        estimatedRevpar: numberOrNull(row.estimatedRevpar),
        roomBalance:
          roomCount === null
          || availableRoom === null
          || saleRoom === null
            ? null
            : Number((roomCount - availableRoom - saleRoom).toFixed(4)),
      }
    })
    .sort((a, b) => a.date.localeCompare(b.date))

  return {
    semantics: {
      dailyRows:
        'rows with estimatedDate; rows without a date are excluded as summary rows',
      roomBalance:
        'roomCount - availableRoom - saleRoom; expected zero when inventory reconciles',
      revenue:
        'estimatedRoomFee is forecast/report room fee, not yet certified as posted room-fee ledger revenue',
    },
    sourceRowCount: rows.length,
    excludedSummaryRowCount: rows.length - dailyRows.length,
    dailyRows,
  }
}

const fetchSameOrigin = async (source, cookie) => {
  let target = new URL(source.endpointUrl)
  if (lowercaseLastPathSegment) {
    const segments = target.pathname.split('/')
    segments[segments.length - 1] =
      segments[segments.length - 1].toLowerCase()
    target.pathname = segments.join('/')
  }
  const originalOrigin = target.origin
  for (let redirect = 0; redirect <= 3; redirect += 1) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 20_000)
    let response
    try {
      const postHeaders =
        requestMethod !== 'POST'
          ? {}
          : requestProfile === 'FORM_EMPTY'
            ? { 'Content-Type': 'application/x-www-form-urlencoded' }
            : requestProfile === 'MINIMAL_NO_BODY'
              ? {}
              : requestProfile === 'ROOM_WORKBENCH_INVENTORY'
                ? {
                    'Content-Type': 'application/json;charset=UTF-8',
                    'X-Requested-With': 'XMLHttpRequest',
                  }
              : { 'Content-Type': 'application/json' }
      const browserHeaders =
        requestProfile === 'BROWSER_JSON'
          || requestProfile.startsWith('REPORT_FILTERS_')
          || requestProfile === 'JY09_FUTURE_INVENTORY'
          || requestProfile === 'ROOM_WORKBENCH_INVENTORY'
          ? {
              Origin: target.origin,
              Referer:
                requestProfile === 'ROOM_WORKBENCH_INVENTORY'
                  ? `${target.origin}/pms-report/home/report/`
                  : `${target.origin}/`,
            }
          : {}
      const pmsContextHeaders =
        requestProfile === 'ROOM_WORKBENCH_INVENTORY'
          ? createRoomWorkbenchContextHeaders(cookie)
          : {}
      const requestBody =
        requestMethod !== 'POST' || requestProfile === 'MINIMAL_NO_BODY'
          ? {}
          : requestProfile === 'FORM_EMPTY'
            ? { body: '' }
            : requestProfile === 'JY09_FUTURE_INVENTORY'
              ? {
                  body: JSON.stringify(
                    createJy09FutureInventoryFilters(cookie),
                  ),
                }
            : requestProfile === 'ROOM_WORKBENCH_INVENTORY'
              ? {
                  body: JSON.stringify(
                    createRoomWorkbenchInventoryFilters(cookie),
                  ),
                }
            : requestProfile.startsWith('REPORT_FILTERS_')
              ? {
                  body: JSON.stringify(
                    requestProfile === 'REPORT_FILTERS_DIRECT'
                      ? createReportFilters(cookie)
                      : requestProfile === 'REPORT_FILTERS_VARIABLES'
                        ? { variables: createReportFilters(cookie) }
                        : { data: createReportFilters(cookie) },
                  ),
                }
              : { body: '{}' }
      response = await fetch(target, {
        method: requestMethod,
        redirect: 'manual',
        signal: controller.signal,
        headers: {
          Accept: 'application/json, text/plain, */*',
          'Accept-Language': 'zh-CN,zh;q=0.9',
          ...postHeaders,
          Cookie: cookie,
          ...browserHeaders,
          ...pmsContextHeaders,
          'User-Agent':
            requestProfile === 'ROOM_WORKBENCH_INVENTORY'
              ? 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/138.0.0.0 Safari/537.36'
              : 'Sifangguan-ReadOnly-Report-Probe/0.1',
        },
        ...requestBody,
      })
    } finally {
      clearTimeout(timer)
    }
    if (response.status < 300 || response.status > 399) return response
    const location = response.headers.get('location')
    if (!location) return response
    const next = new URL(location, target)
    if (next.origin !== originalOrigin) {
      throw new Error('CROSS_ORIGIN_REDIRECT_BLOCKED')
    }
    target = next
  }
  throw new Error('TOO_MANY_REDIRECTS')
}

const results = []
for (
  const source of sources.filter(
    (item) =>
      item.enabled
      && (!sourceIdFilter || item.sourceId === sourceIdFilter),
  )
) {
  const secret = secrets[source.sourceId]
  if (!secret) {
    results.push({
      sourceId: source.sourceId,
      name: source.displayName,
      reportType: source.reportType,
      state: 'COOKIE_NOT_CONFIGURED',
    })
    continue
  }

  try {
    const cookie = decryptCookie(
      secret,
      cookieSecretKey,
      `${hotelId}:${source.sourceId}`,
    )
    const cookieMetadata = inspectCookieMetadata(cookie)
    const response = await fetchSameOrigin(source, cookie)
    const bytes = await readLimited(response)
    const contentType = response.headers.get('content-type') ?? ''
    let parsed = null
    let jsonState = 'NOT_JSON'
    try {
      parsed = JSON.parse(bytes.toString('utf8'))
      jsonState = 'PARSED'
    } catch {
      jsonState = contentType.includes('json') ? 'INVALID_JSON' : 'NOT_JSON'
    }
    const control = {}
    let controlTextClassification = {
      categories: [],
      textFieldCount: 0,
      combinedSha256: null,
    }
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      for (const key of ['code', 'status', 'success', 'reasonCode']) {
        const value = parsed[key]
        if (
          value === null
          || ['string', 'number', 'boolean'].includes(typeof value)
        ) {
          control[key] = value
        }
      }
      const successCode = parsed.code === 0 || parsed.code === 10000
      if (!successCode) {
        controlTextClassification = classifyControlText([
          parsed.message,
          parsed.error,
          typeof parsed.data === 'string' ? parsed.data : null,
          parsed.extend?.detailMessage,
        ])
      }
    }
    results.push({
      sourceId: source.sourceId,
      name: source.displayName,
      reportType: source.reportType,
      calculationRole: source.calculationRole,
      host: new URL(source.endpointUrl).host,
      path: new URL(source.endpointUrl).pathname,
      effectivePath:
        lowercaseLastPathSegment
          ? new URL(source.endpointUrl).pathname
              .split('/')
              .map((segment, index, parts) =>
                index === parts.length - 1
                  ? segment.toLowerCase()
                  : segment)
              .join('/')
          : new URL(source.endpointUrl).pathname,
      state: 'FETCHED',
      requestMethod,
      requestProfile,
      cookieMetadata,
      httpStatus: response.status,
      contentType,
      responseBytes: bytes.length,
      responseSha256: createHash('sha256').update(bytes).digest('hex'),
      jsonState,
      control,
      controlTextClassification,
      topLevelKeys:
        parsed && typeof parsed === 'object' && !Array.isArray(parsed)
          ? Object.keys(parsed)
          : [],
      shape:
        parsed === null
          ? null
          : createShapeSummary(parsed),
      calculationEvidence:
        source.reportType === 'ORDER_DETAIL'
          ? createOrderCalculationEvidence(parsed)
          : source.endpointUrl.toLowerCase().endsWith('/report/jy09')
            ? createJy09CalculationEvidence(parsed)
            : null,
    })
  } catch (error) {
    results.push({
      sourceId: source.sourceId,
      name: source.displayName,
      reportType: source.reportType,
      state: 'FAILED_CLOSED',
      errorCode:
        error instanceof Error
          ? error.message
          : 'UNKNOWN_REPORT_PROBE_FAILURE',
    })
  }
}

process.stdout.write(`${JSON.stringify({
  mode: 'READ_ONLY_NO_RAW_RESPONSE_PERSISTENCE',
  hotelId,
  sourceCount: results.length,
  results,
}, null, 2)}\n`)
