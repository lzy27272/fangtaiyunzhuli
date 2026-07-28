interface OtaSourceGuidance {
  reason: string
  fields: string[]
  action: string
}

const GUIDANCE: Record<string, OtaSourceGuidance> = {
  OTA_COOKIE_REQUIRED_FOR_REFRESH: {
    reason: '立即刷新需要当前OTA登录会话的Cookie',
    fields: ['Cookie'],
    action: '打开OTA后台登录后，更新Cookie并保存，再执行刷新。',
  },
  OTA_HTTP_ERROR: {
    reason: 'OTA数据接口返回HTTP错误，登录会话可能已失效',
    fields: ['Cookie', 'OTA数据接口网址'],
    action: '优先更新Cookie；仍失败时核对数据接口网址和当前账号权限。',
  },
  OTA_RESPONSE_NOT_JSON: {
    reason: 'OTA接口未返回JSON，可能填写了后台页面网址或已跳转登录页',
    fields: ['OTA数据接口网址', 'Cookie'],
    action: '填写浏览器网络面板中真实返回JSON的数据接口，并更新Cookie。',
  },
  OTA_REQUEST_PAYLOAD_INVALID: {
    reason: 'OTA POST请求载荷不是有效JSON对象',
    fields: ['POST请求载荷'],
    action: '从成功请求中复制原始JSON请求体后重新保存。',
  },
  OTA_REFRESH_TIMEOUT: {
    reason: 'OTA接口刷新超时',
    fields: ['OTA数据接口网址', 'POST请求载荷'],
    action: '核对接口与查询范围后重试。',
  },
  OTA_NETWORK_FAILED: {
    reason: '无法连接OTA数据接口',
    fields: ['OTA数据接口网址'],
    action: '核对网址、网络和OTA服务状态后重试。',
  },
  OTA_ENDPOINT_DNS_FAILED: {
    reason: 'OTA数据接口域名无法解析',
    fields: ['OTA数据接口网址'],
    action: '核对域名拼写和网络环境。',
  },
  OTA_ENDPOINT_PRIVATE_NETWORK_BLOCKED: {
    reason: '为防止访问本机或内网，已阻止该数据接口',
    fields: ['OTA数据接口网址'],
    action: '仅允许配置可公开解析的HTTPS OTA接口。',
  },
  OTA_ENDPOINT_UNSAFE: {
    reason: 'OTA数据接口不符合HTTPS安全要求',
    fields: ['OTA数据接口网址'],
    action: '移除网址中的账号、密码、片段或非443端口。',
  },
  OTA_RESPONSE_TOO_LARGE: {
    reason: 'OTA响应超过安全读取上限',
    fields: ['POST请求载荷'],
    action: '缩小查询日期或房型范围后重试。',
  },
}

export function otaSourceGuidance(
  errorCode: string | null | undefined,
): OtaSourceGuidance {
  const code = errorCode ?? 'OTA_REFRESH_FAILED'
  return GUIDANCE[code] ?? {
    reason: `OTA刷新失败：${code}`,
    fields: ['Cookie', 'OTA数据接口网址', 'POST请求载荷'],
    action: '核对配置并保存，再执行立即刷新。',
  }
}
