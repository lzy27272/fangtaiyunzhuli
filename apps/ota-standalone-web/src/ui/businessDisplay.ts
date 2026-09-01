const BUSINESS_CODE_LABELS: Record<string, string> = {
  ACTIVE: '正常使用',
  AVAILABLE: '数据可用',
  UNAVAILABLE: '数据不可用',
  COMPLETE: '数据完整',
  PARTIAL: '数据不完整',
  PENDING: '等待处理',
  RUNNING: '正在处理',
  SUCCEEDED: '处理成功',
  SUCCESS: '处理成功',
  FAILED: '处理失败',
  DELIVERED: '发送成功',
  REJECTED: '发送失败',
  AMBIGUOUS: '结果待确认',
  NOT_CONFIGURED: '尚未配置',
  NOT_TESTED: '尚未验证',
  NOT_VALIDATED: '尚未验证',
  FORMAT_VALID: '格式正确',
  ENABLED: '已启用',
  DISABLED: '已停用',
  OPEN: '待处理',
  CLOSED: '已关闭',
  RESOLVED: '已解决',
  AUTH_REQUIRED: '需要登录验证',
  WAITING_FOR_OPERATOR: '等待人工验证',
  OFFLINE_REHEARSAL_COMPLETE: '验证演练完成',
  SINGLE_HOTEL_CONFIRMED: '单门店已确认',
  PMS_CONFIRMED: '以酒店系统营业日为准',
  CALENDAR_FALLBACK: '暂以系统日期为准',
  SYSTEM_DATE_FALLBACK: '暂以系统日期为准',
  HOURLY_SNAPSHOT_DIFF: '与上一小时对比',
  BASELINE_PENDING: '等待首个对比基准',
  PAUSE_TO_FIRST_BRIEF: '恢复后至首份简报',
  HOURLY: '按小时统计',
  MATCHED: '数据一致',
  P1_RISK: '存在高风险差异',
  SOLD_OUT: '已售罄',
  NO_CURRENT_RISK: '当前没有风险',
  COLLECTION_MISSING: '缺少采集数据',
  COLLECTION_FAILED: '采集失败',
  COLLECTION_INCOMPLETE: '采集数据不完整',
  DAILY_MORNING_REPAIR_FAILED: '每日早间自动修复失败',
  HOT_SELLING_SOLD_OUT: '热销房型售罄提醒',
  LATE_BRIEF_REPLAY: '延迟简报补发',
  INVENTORY_MISMATCH: '库存数据不一致',
  ORDER_SOURCE_MISSING: '缺少订单数据来源',
  ORDER_DATA_INCOMPLETE: '订单数据不完整',
  SOURCE_UNAVAILABLE: '数据来源暂不可用',
  COOKIE_NOT_CONFIGURED: '登录凭据尚未配置',
  REPORT_SOURCE_COOKIE_REQUIRED: '需要更新登录凭据',
  REPORT_SOURCE_ENABLED_REQUIRED: '需要启用报表采集',
  PMS_SESSION_REAUTH_REQUIRED: '酒店系统需要重新登录',
  PMS_BUSINESS_DATE_UNAVAILABLE: '无法读取酒店营业日',
  PMS_BUSINESS_DATE_INVALID: '酒店营业日异常',
  LUOPAN_ORDER_DETAIL_NOT_CONFIGURED: '罗盘订单明细尚未配置',
  VERIFICATION_REQUIRED: '需要验证码',
  EXTERNAL_VERIFICATION_REQUIRED: '需要在官网完成验证',
  RATE_LIMITED: '操作过于频繁，请稍后重试',
  ROOM_ONLY: '不含早餐',
  BREAKFAST_INCLUDED: '含早餐',
  FULL_SYNC: '完整同步',
  PRIMARY_CALCULATION: '主要计算来源',
  AUXILIARY_CALCULATION: '辅助核对来源',
  ORDER_DETAIL: '订单明细',
  ROOM_REVENUE: '房费收入',
  PHYSICAL_INVENTORY: '实体房型库存',
  OTA_PRODUCT_INVENTORY: '渠道售卖库存',
  BUSINESS_DAY: '营业日与夜审',
  CUSTOM_REPORT: '其他辅助报表',
  PMS: '酒店系统',
  WECOM: '企业微信',
  CTRIP: '携程',
  MEITUAN: '美团',
  FLIGGY: '飞猪',
  DOUYIN: '抖音',
  QUNAR: '去哪儿',
  TONGCHENG: '同程',
}

const METRIC_LABELS: Record<string, string> = {
  totalRevenue: '当日预计房费',
  adr: '平均房价（ADR）',
  revPar: '单房收益（RevPAR）',
  soldRooms: '当日已售间夜',
  availableRooms: '当日剩余可售房',
  targetProgress: '营收目标完成率',
  sellProgress: '出租率（OCC）',
  EXPECTED_ROOM_REVENUE: '当日预计房费',
  ROOM_REVENUE: '当日房费收入',
  ADR: '平均房价（ADR）',
  REVPAR: '单房收益（RevPAR）',
  SOLD_ROOMS: '已售房间',
  SOLD_ROOM_NIGHTS: '当日已售间夜',
  AVAILABLE_ROOMS: '当日剩余可售房',
  PHYSICAL_AVAILABLE_ROOMS: '实体可售房间',
  OCCUPANCY_RATE: '出租率（OCC）',
  ORDER_COUNT: '订单量',
  STAY_ROOM_NIGHTS: '入住间夜',
  REVIEW_SCORE: '评价得分',
  GOOD_REVIEW_RATE: '好评率',
  VIEW_CONVERSION: '浏览转化率',
  PAYMENT_CONVERSION: '支付转化率',
}

const UNIT_LABELS: Record<string, string> = {
  CURRENCY: '元',
  CNY: '元',
  RMB: '元',
  ROOM: '间',
  ROOMS: '间',
  ROOM_NIGHT: '间夜',
  PERCENT: '%',
  COUNT: '条',
}

export function businessCodeLabel(code?: string | null, fallback = '系统状态') {
  if (!code) return fallback
  return BUSINESS_CODE_LABELS[code] ?? fallback
}

export function metricLabel(code: string) {
  return METRIC_LABELS[code] ?? '经营指标'
}

export function unitLabel(unit?: string | null) {
  if (!unit) return ''
  return UNIT_LABELS[unit] ?? ''
}

export function formatBusinessTime(value?: string | null, fallback = '暂无记录') {
  if (!value) return fallback
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return value
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit',
  }).format(parsed)
}

export function safeBusinessText(value?: string | null, fallback = '暂无说明') {
  if (!value) return fallback
  if (/^[A-Z][A-Z0-9_:-]+$/.test(value)) return businessCodeLabel(value, fallback)
  return value.replace(/[A-Z][A-Z0-9_:-]{3,}/g, (code) =>
    BUSINESS_CODE_LABELS[code] ?? '系统信息')
}

export function businessErrorMessage(cause: unknown, fallback: string) {
  if (!(cause instanceof Error) || !cause.message.trim()) return fallback
  const message = cause.message.trim()
  if (/[A-Za-z]{4}/.test(message) && !/[\u3400-\u9fff]/.test(message)) {
    return businessCodeLabel(message, fallback)
  }
  return safeBusinessText(message, fallback)
}
