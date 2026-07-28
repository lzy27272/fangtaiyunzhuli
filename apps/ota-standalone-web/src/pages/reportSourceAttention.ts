export interface ReportSourceAttention {
  sourceId: string
  sourceCode: string
  errorCode: string
}

interface ReportSourceGuidance {
  reason: string
  fields: string[]
  action: string
}

const GUIDANCE_BY_ERROR: Record<string, ReportSourceGuidance> = {
  COOKIE_NOT_CONFIGURED: {
    reason: '该报表尚未配置Cookie',
    fields: ['Cookie'],
    action: '填写当前门店该网址专用Cookie并保存。',
  },
  HTTP_ERROR: {
    reason: '接口返回HTTP错误，Cookie可能已失效或当前请求无权访问',
    fields: ['Cookie', 'POST请求载荷', 'HTTPS接口地址'],
    action: '优先更新Cookie；如仍失败，再核对当前门店POST载荷及接口地址。',
  },
  TIMEOUT: {
    reason: '接口采集超时',
    fields: ['HTTPS接口地址', 'POST请求载荷'],
    action: '核对接口和查询范围后保存，再返回监控重新采集。',
  },
  REQUEST_PAYLOAD_INVALID: {
    reason: 'POST请求载荷不符合接口要求',
    fields: ['POST请求载荷'],
    action: '修正当前门店POST载荷后保存。',
  },
  PMS_CONTEXT_INVALID: {
    reason: '当前登录上下文与PMS接口不匹配',
    fields: ['Cookie', 'POST请求载荷'],
    action: '更新Cookie，并核对当前门店请求载荷。',
  },
  PMS_CONTEXT_MISSING: {
    reason: 'PMS登录上下文缺失',
    fields: ['Cookie'],
    action: '重新登录PMS取得当前有效Cookie并保存。',
  },
  REPORT_CODE_REJECTED: {
    reason: 'PMS报表接口拒绝了本次查询',
    fields: ['Cookie', 'POST请求载荷'],
    action: '核对Cookie权限及该报表的POST查询参数。',
  },
  EMPTY_RESPONSE: {
    reason: '接口返回空响应',
    fields: ['POST请求载荷', 'HTTPS接口地址'],
    action: '核对查询参数、营业日期范围和接口地址。',
  },
  RESPONSE_JSON_INVALID: {
    reason: '接口响应不是可解析的JSON',
    fields: ['HTTPS接口地址', 'Cookie'],
    action: '核对是否因Cookie失效跳转到登录页，以及接口地址是否正确。',
  },
  REPORT_DATA_INVALID: {
    reason: '接口返回的数据结构与该报表模板不匹配',
    fields: ['POST请求载荷', 'HTTPS接口地址'],
    action: '核对报表类型、接口地址及查询载荷。',
  },
  ENDPOINT_NOT_ALLOWED: {
    reason: '接口地址不在允许范围内',
    fields: ['HTTPS接口地址'],
    action: '核对并保存正确的HTTPS报表接口地址。',
  },
  ENDPOINT_NOT_SUPPORTED: {
    reason: '接口路径尚未被当前采集器支持',
    fields: ['HTTPS接口地址'],
    action: '核对是否选择了正确的报表接口。',
  },
  RESPONSE_TOO_LARGE: {
    reason: '接口响应超过安全采集上限',
    fields: ['POST请求载荷'],
    action: '缩小查询日期或数据范围后保存。',
  },
  COLLECTION_FAILED: {
    reason: '报表采集失败，未取得可用响应',
    fields: ['Cookie', 'POST请求载荷', 'HTTPS接口地址'],
    action: '依次核对Cookie、当前门店载荷和接口地址。',
  },
  COLLECTION_INCOMPLETE: {
    reason: '最近一次采集未完成',
    fields: ['Cookie', 'POST请求载荷', 'HTTPS接口地址'],
    action: '核对配置并保存，再返回监控重新采集。',
  },
}

export function reportSourceGuidance(
  errorCode: string,
): ReportSourceGuidance {
  return GUIDANCE_BY_ERROR[errorCode] ?? {
    reason: `采集错误：${errorCode || '原因未知'}`,
    fields: ['Cookie', 'POST请求载荷', 'HTTPS接口地址'],
    action: '核对配置并保存，再返回监控重新采集。',
  }
}
