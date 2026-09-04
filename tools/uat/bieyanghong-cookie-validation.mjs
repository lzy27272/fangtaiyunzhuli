import { collectLiveReports } from './live-report-collector.mjs'

const MAX_COOKIE_BYTES = 16 * 1024

const cookieValue = (cookieHeader, name) => {
  for (const segment of String(cookieHeader ?? '').split(';')) {
    const separator = segment.indexOf('=')
    if (separator < 1) continue
    if (segment.slice(0, separator).trim() === name) {
      return segment.slice(separator + 1).trim()
    }
  }
  return null
}

export const normalizeBieyanghongCookieHeader = (value) => {
  if (typeof value !== 'string') {
    throw new Error('BIEYANGHONG_COOKIE_INVALID')
  }
  const cookieHeader = value.trim()
  if (
    cookieHeader.length < 1
    || Buffer.byteLength(cookieHeader, 'utf8') > MAX_COOKIE_BYTES
    || /[\r\n\u0000]/u.test(cookieHeader)
    || /^cookie\s*:/iu.test(cookieHeader)
  ) {
    throw new Error('BIEYANGHONG_COOKIE_INVALID')
  }
  return cookieHeader
}

export const validateBieyanghongCookieAccess = async ({
  hotel,
  sources,
  cookieHeader: inputCookieHeader,
  expectedHotelId,
  secretKey,
  legacySecretKey = null,
  reportDate,
  now = new Date(),
  fetchImpl = fetch,
}) => {
  const cookieHeader = normalizeBieyanghongCookieHeader(inputCookieHeader)
  const authenticatedHotelId = cookieValue(
    cookieHeader,
    'hotelpms_login_hotel_id',
  )
  if (
    !/^\d+$/u.test(String(expectedHotelId ?? ''))
    || authenticatedHotelId !== expectedHotelId
  ) {
    throw new Error('BIEYANGHONG_STORE_SCOPE_INVALID')
  }
  const enabledSources = sources.filter((source) => {
    if (!source.enabled) return false
    try {
      return new URL(source.endpointUrl).hostname === 'pms.meituan.com'
    } catch {
      return false
    }
  })
  if (enabledSources.length < 1) {
    throw new Error('BIEYANGHONG_REPORT_SOURCE_NOT_CONFIGURED')
  }
  const cookiesBySourceId = Object.fromEntries(
    enabledSources.map((source) => [source.sourceId, cookieHeader]),
  )
  const result = await collectLiveReports({
    hotel,
    sources: enabledSources,
    cookiesBySourceId,
    previousSnapshots: [],
    secretKey,
    legacySecretKey,
    target: null,
    hotSellingRoomTypeCodes: [],
    reportDate,
    now,
    fetchImpl,
  })
  if (
    result.run.status !== 'SUCCEEDED'
    || result.snapshot.completeness !== 'COMPLETE'
    || result.run.successfulSourceCount !== result.run.sourceCount
  ) {
    throw new Error('PMS_COOKIE_VALIDATION_INCOMPLETE')
  }
  return {
    status: 'SUCCEEDED',
    validatedAt: result.run.completedAt,
    businessDate: result.run.businessDate,
    sourceCount: result.run.sourceCount,
    successfulSourceCount: result.run.successfulSourceCount,
    outboundDeliveryAttempted: false,
  }
}
