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
    reason: '该报表尚未配置登录凭据',
    fields: ['登录凭据'],
    action: '填写当前门店该网址专用的登录凭据并保存。',
  },
  HTTP_ERROR: {
    reason: '接口连接异常，登录凭据可能已失效或当前账号无权访问',
    fields: ['登录凭据', '提交内容', '接口地址'],
    action: '优先更新登录凭据；如仍失败，再核对当前门店的提交内容及接口地址。',
  },
  TIMEOUT: {
    reason: '接口采集超时',
    fields: ['接口地址', '提交内容'],
    action: '核对接口和查询范围后保存，再返回监控重新采集。',
  },
  REQUEST_PAYLOAD_INVALID: {
    reason: '提交内容不符合接口要求',
    fields: ['提交内容'],
    action: '修正当前门店的提交内容后保存。',
  },
  PMS_CONTEXT_INVALID: {
    reason: '当前登录状态与酒店系统接口不匹配',
    fields: ['登录凭据', '提交内容'],
    action: '更新登录凭据，并核对当前门店的提交内容。',
  },
  PMS_CONTEXT_MISSING: {
    reason: '酒店系统登录状态缺失',
    fields: ['登录凭据'],
    action: '重新登录酒店系统，取得当前有效的登录凭据并保存。',
  },
  REPORT_CODE_REJECTED: {
    reason: '酒店系统拒绝了本次报表查询',
    fields: ['登录凭据', '提交内容'],
    action: '核对登录权限及该报表的查询条件。',
  },
  EMPTY_RESPONSE: {
    reason: '接口返回空响应',
    fields: ['提交内容', '接口地址'],
    action: '核对查询参数、营业日期范围和接口地址。',
  },
  RESPONSE_JSON_INVALID: {
    reason: '接口返回内容格式异常',
    fields: ['接口地址', '登录凭据'],
    action: '核对是否因登录失效跳转到登录页，以及接口地址是否正确。',
  },
  REPORT_DATA_INVALID: {
    reason: '接口返回的数据结构与该报表模板不匹配',
    fields: ['提交内容', '接口地址'],
    action: '核对报表类型、接口地址及查询载荷。',
  },
  ENDPOINT_NOT_ALLOWED: {
    reason: '接口地址不在允许范围内',
    fields: ['接口地址'],
    action: '核对并保存正确的安全报表接口地址。',
  },
  ENDPOINT_NOT_SUPPORTED: {
    reason: '接口路径尚未被当前采集器支持',
    fields: ['接口地址'],
    action: '核对是否选择了正确的报表接口。',
  },
  RESPONSE_TOO_LARGE: {
    reason: '接口响应超过安全采集上限',
    fields: ['提交内容'],
    action: '缩小查询日期或数据范围后保存。',
  },
  COLLECTION_FAILED: {
    reason: '报表采集失败，未取得可用响应',
    fields: ['登录凭据', '提交内容', '接口地址'],
    action: '依次核对登录凭据、当前门店的提交内容和接口地址。',
  },
  COLLECTION_INCOMPLETE: {
    reason: '最近一次采集未完成',
    fields: ['登录凭据', '提交内容', '接口地址'],
    action: '核对配置并保存，再返回监控重新采集。',
  },
}

export function reportSourceGuidance(
  errorCode: string,
): ReportSourceGuidance {
  return GUIDANCE_BY_ERROR[errorCode] ?? {
    reason: errorCode ? '采集配置需要检查' : '暂未取得具体原因',
    fields: ['登录凭据', '提交内容', '接口地址'],
    action: '核对配置并保存，再返回监控重新采集。',
  }
}
