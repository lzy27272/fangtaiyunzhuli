interface OtaSourceGuidance {
  reason: string
  fields: string[]
  action: string
}

const GUIDANCE: Record<string, OtaSourceGuidance> = {
  OTA_SOURCE_NOT_CONFIGURED: {
    reason: '该OTA来源尚未补充数据接口',
    fields: ['OTA数据接口网址（可选）'],
    action: '如需自动采集，请展开来源并补充返回JSON的数据接口；仅保存渠道资料则无需处理。',
  },
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
  OTA_HTTP_401: {
    reason: 'OTA数据接口未认可当前登录身份（HTTP 401）',
    fields: ['Cookie'],
    action: '重新登录对应OTA门店，并从该数据请求中更新完整Cookie。',
  },
  OTA_HTTP_403: {
    reason: 'OTA平台拒绝当前数据请求（HTTP 403）',
    fields: ['Cookie', 'OTA账号权限', '门店与接口参数'],
    action: '更新该接口请求使用的完整Cookie，并核对账号是否有权查看当前门店。',
  },
  OTA_HTTP_429: {
    reason: 'OTA平台限制了当前请求频率（HTTP 429）',
    fields: ['轮询间隔'],
    action: '暂停手动重试并调大轮询间隔，等待平台限流窗口恢复。',
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
  OTA_MEITUAN_ORDER_BUSINESS_ERROR: {
    reason: '美团订单接口返回业务错误，HTTP 连接成功但没有有效订单数据',
    fields: ['Cookie', '门店与账号权限', '订单数据接口网址'],
    action: '更新该门店美团Cookie，并确认当前账号有权查看订单列表。',
  },
  OTA_MEITUAN_ORDER_SCHEMA_UNRECOGNIZED: {
    reason: '美团订单返回结构已变化，系统无法安全识别订单汇总',
    fields: ['订单数据接口网址'],
    action: '保留当前配置并联系管理员更新美团订单适配器。',
  },
  OTA_DOUYIN_ORDER_BUSINESS_ERROR: {
    reason: '抖音订单接口返回业务错误，当前会话或门店权限可能失效',
    fields: ['Cookie', '门店与账号权限'],
    action: '更新该门店抖音Cookie后重新刷新。',
  },
  OTA_DOUYIN_ORDER_SCHEMA_UNRECOGNIZED: {
    reason: '抖音订单返回结构已变化，系统无法安全识别订单记录',
    fields: ['订单数据接口网址', 'POST请求载荷'],
    action: '保留配置并联系管理员更新抖音订单适配器。',
  },
  OTA_DOUYIN_REVIEW_BUSINESS_ERROR: {
    reason: '抖音评价接口返回业务错误，当前会话或门店权限可能失效',
    fields: ['Cookie', '门店与账号权限'],
    action: '更新该门店抖音Cookie后重新刷新。',
  },
  OTA_DOUYIN_REVIEW_SCHEMA_UNRECOGNIZED: {
    reason: '抖音评价返回结构已变化，系统无法安全识别评价记录',
    fields: ['评价数据接口网址'],
    action: '保留配置并联系管理员更新抖音评价适配器。',
  },
  OTA_FLIGGY_SESSION_INVALID: {
    reason: '飞猪登录会话已失效或缺少短效签名所需的登录Cookie',
    fields: ['飞猪Cookie'],
    action: '重新登录飞猪后台并更新Cookie；接口网址无需保留t、sign或bx临时参数。',
  },
  OTA_FLIGGY_BUSINESS_ERROR: {
    reason: '飞猪接口返回业务错误，当前会话、门店权限或接口参数可能失效',
    fields: ['飞猪Cookie', '门店权限', '数据接口网址'],
    action: '更新Cookie并确认该账号可查看对应订单、评价或排名页面。',
  },
  OTA_FLIGGY_REQUEST_DATA_INVALID: {
    reason: '飞猪接口缺少可解析的data查询参数',
    fields: ['数据接口网址'],
    action: '从飞猪后台复制返回JSON的完整接口网址；系统会自动移除临时签名参数。',
  },
  OTA_FLIGGY_REQUEST_PAYLOAD_INVALID: {
    reason: '飞猪旧版评价接口缺少必要的POST请求参数，只有Cookie不能返回评价列表',
    fields: ['POST请求载荷', '飞猪Cookie'],
    action: '在飞猪评价页的网络请求中找到guestReviewV3.do，将Form Data按键值填入POST请求载荷后保存；系统会自动转为表单编码。',
  },
  OTA_FLIGGY_PAGINATION_STALLED: {
    reason: '飞猪接口分页没有继续返回新数据，已停止本次采集以避免重复',
    fields: ['数据接口网址', 'Cookie'],
    action: '更新Cookie后重试；仍失败时需核对接口分页字段。',
  },
  OTA_FLIGGY_METHOD_UNSUPPORTED: {
    reason: '当前飞猪MTop适配器仅支持GET接口',
    fields: ['请求方式'],
    action: '将该数据源请求方式改为GET后保存。',
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
