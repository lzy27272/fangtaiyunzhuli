const MAX_INPUT_BYTES = 1024 * 1024
const MAX_ROWS = 5000
const MAX_TEXT_BYTES = 1900

const ROOT_FIELDS = new Set(['code', 'data', 'message', 'msg', 'success'])
const DATA_FIELDS = new Set(['variables', 'dataList'])
const VARIABLE_FIELDS = new Set([
  'currentTime',
  'bussinessDate',
  'currentUser',
  'startDate',
  'endDate',
  'dateType',
  'orgId',
  'memberLevel',
  'integratedBusiness',
  'isSplited',
])
const ROW_FIELDS = new Set([
  'orderSource',
  'orderNo',
  'orderDate',
  'contractName',
  'source',
  'customerLevel',
  'estArriveTime',
  'estDepatureTime',
  'roomType',
  'roomCount',
  'roomPrice',
  'roomPriceType',
  'prePayAmount',
  'expireKeepTime',
  'orderStatus',
  'remark',
  'operator',
  'url',
  'phoneNumber',
  'prePaymentType',
])
const REQUIRED_ROW_FIELDS = [
  'customerLevel',
  'roomType',
  'roomCount',
  'roomPrice',
]
const KNOWN_CHANNELS = new Map([
  ['携程', '携程'],
  ['美团', '美团'],
  ['飞猪', '飞猪'],
  ['抖音', '抖音'],
  ['去哪儿', '去哪儿'],
  ['同程', '同程'],
  ['艺龙', '艺龙'],
  ['门店', '门店'],
  ['线下', '线下'],
  ['散客', '散客'],
])
const CHANNEL_ORDER = [
  '携程',
  '美团',
  '飞猪',
  '抖音',
  '去哪儿',
  '同程',
  '艺龙',
  '门店',
  '线下',
  '散客',
  '其他/未识别',
]

export class SafePmsJsonError extends Error {
  constructor(reasonCode) {
    super(reasonCode)
    this.name = 'SafePmsJsonError'
    this.reasonCode = reasonCode
  }
}

const fail = (reasonCode) => {
  throw new SafePmsJsonError(reasonCode)
}

const isPlainObject = (value) =>
  value !== null &&
  typeof value === 'object' &&
  !Array.isArray(value) &&
  Object.getPrototypeOf(value) === Object.prototype

const assertKnownFields = (value, allowedFields, reasonCode) => {
  for (const key of Object.keys(value)) {
    if (!allowedFields.has(key)) {
      fail(reasonCode)
    }
  }
}

const assertOptionalPrimitive = (value, reasonCode) => {
  if (
    value !== null &&
    typeof value !== 'string' &&
    typeof value !== 'number' &&
    typeof value !== 'boolean'
  ) {
    fail(reasonCode)
  }
  if (typeof value === 'string' && value.length > 5000) {
    fail(reasonCode)
  }
}

const validateDocument = (document) => {
  if (!isPlainObject(document)) fail('PMS_JSON_ROOT_INVALID')
  assertKnownFields(document, ROOT_FIELDS, 'PMS_JSON_ROOT_FIELD_UNKNOWN')
  if (!Number.isInteger(document.code)) fail('PMS_JSON_CODE_INVALID')
  if (document.code !== 10000) fail('PMS_JSON_BUSINESS_NOT_SUCCESSFUL')
  for (const field of ['message', 'msg']) {
    if (Object.hasOwn(document, field)) {
      assertOptionalPrimitive(
        document[field],
        'PMS_JSON_ROOT_VALUE_INVALID',
      )
    }
  }
  if (Object.hasOwn(document, 'success')) {
    if (typeof document.success !== 'boolean') {
      fail('PMS_JSON_SUCCESS_FLAG_INVALID')
    }
    if (!document.success) fail('PMS_JSON_BUSINESS_NOT_SUCCESSFUL')
  }
  if (!isPlainObject(document.data)) fail('PMS_JSON_DATA_INVALID')
  assertKnownFields(document.data, DATA_FIELDS, 'PMS_JSON_DATA_FIELD_UNKNOWN')

  const variables = document.data.variables
  if (!isPlainObject(variables)) fail('PMS_JSON_VARIABLES_INVALID')
  assertKnownFields(
    variables,
    VARIABLE_FIELDS,
    'PMS_JSON_VARIABLE_FIELD_UNKNOWN',
  )
  for (const value of Object.values(variables)) {
    assertOptionalPrimitive(value, 'PMS_JSON_VARIABLE_VALUE_INVALID')
  }

  const rows = document.data.dataList
  if (!Array.isArray(rows) || rows.length > MAX_ROWS) {
    fail('PMS_JSON_DATA_LIST_INVALID')
  }

  for (const row of rows) {
    if (!isPlainObject(row)) fail('PMS_JSON_ROW_INVALID')
    assertKnownFields(row, ROW_FIELDS, 'PMS_JSON_ROW_FIELD_UNKNOWN')
    for (const field of REQUIRED_ROW_FIELDS) {
      if (!Object.hasOwn(row, field)) fail('PMS_JSON_ROW_REQUIRED_FIELD_MISSING')
    }
    for (const value of Object.values(row)) {
      assertOptionalPrimitive(value, 'PMS_JSON_ROW_VALUE_INVALID')
    }
    if (
      !Number.isInteger(row.roomCount) ||
      row.roomCount < 0 ||
      row.roomCount > 1000
    ) {
      fail('PMS_JSON_ROOM_COUNT_INVALID')
    }
    if (
      typeof row.roomPrice !== 'number' ||
      !Number.isFinite(row.roomPrice) ||
      row.roomPrice < 0
    ) {
      fail('PMS_JSON_ROOM_PRICE_INVALID')
    }
    if (typeof row.roomType !== 'string') {
      fail('PMS_JSON_ROOM_TYPE_INVALID')
    }
    if (typeof row.customerLevel !== 'string') {
      fail('PMS_JSON_CHANNEL_INVALID')
    }
  }
}

export function parsePmsJsonText(rawText) {
  if (typeof rawText !== 'string' || rawText.length === 0) {
    fail('PMS_JSON_EMPTY')
  }
  if (Buffer.byteLength(rawText, 'utf8') > MAX_INPUT_BYTES) {
    fail('PMS_JSON_SIZE_LIMIT_EXCEEDED')
  }

  const normalizedText = rawText.replace(/^\uFEFF/, '')
  try {
    const document = JSON.parse(normalizedText)
    validateDocument(document)
    return { document, recoveredTruncatedRoot: false }
  } catch (error) {
    if (error instanceof SafePmsJsonError) throw error
  }

  const trimmed = normalizedText.trimEnd()
  if (!trimmed.endsWith(',')) fail('PMS_JSON_PARSE_FAILED')

  try {
    const document = JSON.parse(`${trimmed.slice(0, -1)}}`)
    validateDocument(document)
    return { document, recoveredTruncatedRoot: true }
  } catch (error) {
    if (error instanceof SafePmsJsonError) throw error
    fail('PMS_JSON_PARSE_FAILED')
  }
}

const safeDateText = (value) => {
  if (
    typeof value === 'string' &&
    /^\d{4}-\d{2}-\d{2}(?: \d{2}:\d{2}:\d{2})?$/.test(value)
  ) {
    return value
  }
  return '未提供'
}

export const normalizeHotelName = (value) => {
  if (typeof value !== 'string') fail('HOTEL_NAME_INVALID')
  const normalized = value.normalize('NFKC').trim()
  if (
    normalized.length === 0 ||
    normalized.length > 80 ||
    !/^[\p{L}\p{N}（）()·\-— _]+$/u.test(normalized)
  ) {
    fail('HOTEL_NAME_INVALID')
  }
  return normalized
}

export function summarizePmsDocument(
  document,
  { recoveredTruncatedRoot = false } = {},
) {
  validateDocument(document)
  const rows = document.data.dataList
  const variables = document.data.variables
  const channelCounts = new Map()
  const roomTypes = new Set()
  let roomCountTotal = 0

  for (const row of rows) {
    const rawChannel = row.customerLevel.trim()
    const channel = KNOWN_CHANNELS.get(rawChannel) ?? '其他/未识别'
    channelCounts.set(channel, (channelCounts.get(channel) ?? 0) + 1)
    roomCountTotal += row.roomCount
    if (row.roomType.trim().length > 0) roomTypes.add(row.roomType.trim())
  }

  const orderedChannelCounts = CHANNEL_ORDER.filter((channel) =>
    channelCounts.has(channel),
  ).map((channel) => ({
    channel,
    count: channelCounts.get(channel),
  }))

  return Object.freeze({
    responseCode: document.code,
    currentTime: safeDateText(variables.currentTime),
    businessDate: safeDateText(variables.bussinessDate),
    startDate: safeDateText(variables.startDate),
    endDate: safeDateText(variables.endDate),
    recordCount: rows.length,
    roomCountTotal,
    roomTypeDistinctCount: roomTypes.size,
    channelCounts: Object.freeze(orderedChannelCounts),
    recoveredTruncatedRoot: Boolean(recoveredTruncatedRoot),
  })
}

export function createWeComTextPayload(summary, { hotelName }) {
  const safeName = normalizeHotelName(hotelName)
  const channels =
    summary.channelCounts.length === 0
      ? ['· 暂无记录']
      : summary.channelCounts.map(
          ({ channel, count }) => `· ${channel}：${count}条`,
        )
  const recoveryNotice = summary.recoveredTruncatedRoot
    ? '输入校验｜原文件根对象截断，已按唯一安全规则在内存恢复'
    : '输入校验｜JSON结构完整'

  const content = [
    '【UAT测试｜非经营指令】',
    `门店｜${safeName}`,
    '用途｜仅验证企微通道，不得据此调价、调整库存或执行经营动作',
    `统计时间｜${summary.currentTime}`,
    `PMS营业日｜${summary.businessDate}`,
    `查询区间｜${summary.startDate}→${summary.endDate}`,
    `接口结果｜${summary.responseCode}`,
    `记录数量｜${summary.recordCount}条`,
    `房量字段｜${summary.roomCountTotal}`,
    `房型种类｜${summary.roomTypeDistinctCount}种`,
    'customerLevel原字段分布｜',
    ...channels,
    recoveryNotice,
    '隐私处理｜已过滤姓名、订单号、电话、备注、操作员及内部链接',
    '口径提示｜customerLevel、roomCount与roomPrice均未完成厂商口径确认，不用于收益结论',
  ].join('\n')

  if (Buffer.byteLength(content, 'utf8') > MAX_TEXT_BYTES) {
    fail('WECOM_TEXT_SIZE_LIMIT_EXCEEDED')
  }

  return Object.freeze({
    msgtype: 'text',
    text: Object.freeze({
      content,
      mentioned_list: Object.freeze(['@all']),
    }),
  })
}

export const limits = Object.freeze({
  maxInputBytes: MAX_INPUT_BYTES,
  maxRows: MAX_ROWS,
  maxTextBytes: MAX_TEXT_BYTES,
})
