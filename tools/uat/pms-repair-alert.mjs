import { createHash } from 'node:crypto'

export const PMS_REPAIR_STALE_AFTER_MS = 90 * 60 * 1000

const LUOPAN_REPAIR_GUIDANCE_VERSION = 'LUOPAN_GUIDANCE_V1'

const luopanFailureLabel = (errorCode) => {
  switch (errorCode) {
    case 'LUOPAN_REAUTH_REQUIRED':
      return '罗盘登录会话已失效'
    case 'LUOPAN_FORECAST_TABLE_UNAVAILABLE':
      return '罗盘房态报表页未返回可识别表格'
    case 'LUOPAN_FORECAST_FORM_UNAVAILABLE':
      return '罗盘房态查询表单未正常加载'
    case 'LUOPAN_BUSINESS_DATE_UNAVAILABLE':
      return '罗盘营业日暂时无法读取'
    case 'LUOPAN_HOTEL_SCOPE_AMBIGUOUS':
    case 'LUOPAN_HOTEL_SCOPE_CHANGED':
    case 'LUOPAN_HOTEL_SCOPE_UNVERIFIED':
      return '罗盘门店范围需要重新确认'
    default:
      return '罗盘采集未完成，需要重新检测'
  }
}

export const luopanPmsRepairGuidance = (lastErrorCode) => {
  const normalized = typeof lastErrorCode === 'string'
    ? lastErrorCode.trim()
    : ''
  if (normalized === 'LUOPAN_REAUTH_REQUIRED') {
    return {
      diagnosis: luopanFailureLabel(normalized),
      captchaRequired: true,
      captchaText:
        '需要验证码；系统会由修复机器人私聊本店管理员发送验证码图片。',
      action:
        '收到后按“门店编号 验证码”回复；若未收到，请检查本店管理员绑定。',
    }
  }
  return {
    diagnosis: luopanFailureLabel(normalized),
    captchaRequired: false,
    captchaText:
      '未检测到登录失效，本次无需验证码，机器人不会发送无效验证码。',
    action:
      '进入修复后台检查罗盘官方页面并重新验证；若官网要求登录，系统会转入验证码流程。',
  }
}

export const pmsRepairNoticeMessageKey = ({
  hotel,
  incident,
  providerLastErrorCode = null,
}) => {
  const base = `${hotel.hotelId}:PMS_REPAIR_REQUIRED:${incident.incidentId}`
  if (hotel.pmsSystemCode !== 'LUOPAN_CLOUD') return base
  const mode = providerLastErrorCode === 'LUOPAN_REAUTH_REQUIRED'
    ? 'REAUTH'
    : 'NONAUTH'
  return `${base}:${LUOPAN_REPAIR_GUIDANCE_VERSION}:${mode}`
}

export const buildStoreRepairConsoleUrl = ({ publicOrigin, hotelCode }) => {
  if (!/^[0-9]{3}$/u.test(String(hotelCode ?? ''))) {
    throw new Error('PMS_REPAIR_HOTEL_CODE_INVALID')
  }
  const origin = new URL(String(publicOrigin ?? ''))
  if (
    origin.protocol !== 'https:'
    || origin.username
    || origin.password
  ) {
    throw new Error('PMS_REPAIR_PUBLIC_ORIGIN_INVALID')
  }
  const target = new URL('/ota-console/', origin.origin)
  target.searchParams.set('repairHotel', hotelCode)
  return target.toString()
}

const validTimestamp = (value) => {
  if (typeof value !== 'string' || value.trim() === '') return null
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

export const evaluatePmsRepair = ({
  monitor,
  trustedDeviceStatus = null,
  now = new Date(),
} = {}) => {
  const reasons = []
  const completeness = monitor?.completeness ?? 'UNAVAILABLE'
  const cutoffAt = validTimestamp(monitor?.cutoffAt)
  if (completeness !== 'COMPLETE' || !cutoffAt) {
    reasons.push({
      code: 'PMS_SNAPSHOT_INCOMPLETE',
      detail: 'PMS快照不完整',
    })
  }

  if (
    cutoffAt
    && now.getTime() - cutoffAt.getTime() > PMS_REPAIR_STALE_AFTER_MS
  ) {
    reasons.push({
      code: 'PMS_DATA_STALE',
      detail: 'PMS数据超过90分钟未更新',
    })
  }

  if (trustedDeviceStatus?.eligible) {
    const device = trustedDeviceStatus.device
    if (!device || device.reenrollRequired) {
      reasons.push({
        code: 'PMS_DEVICE_REENROLL_REQUIRED',
        detail: 'PMS采集设备需要重新绑定',
      })
    }
    if (device && device.scopeApprovalStatus !== 'APPROVED') {
      reasons.push({
        code: 'PMS_SCOPE_NOT_APPROVED',
        detail: 'PMS门店范围尚未授权',
      })
    }
  }

  return {
    required: reasons.length > 0,
    reasons,
    cutoffAt: cutoffAt?.toISOString() ?? null,
  }
}

export const pmsRepairIncidentFor = ({
  hotel,
  monitor,
  trustedDeviceStatus = null,
  now = new Date(),
}) => {
  const evaluation = evaluatePmsRepair({ monitor, trustedDeviceStatus, now })
  if (!evaluation.required) return null
  const reasonCodes = evaluation.reasons.map((reason) => reason.code).sort()
  const fingerprint = createHash('sha256')
    .update(JSON.stringify({
      hotelId: hotel.hotelId,
      reasonCodes,
      cutoffAt: evaluation.cutoffAt,
      deviceId: trustedDeviceStatus?.device?.deviceId ?? null,
      scopeApprovalStatus:
        trustedDeviceStatus?.device?.scopeApprovalStatus ?? null,
    }))
    .digest('hex')
    .slice(0, 16)
  const observedAt = now.toISOString()
  return {
    incidentId: `pms-repair-${fingerprint}`,
    type: 'PMS_REPAIR_REQUIRED',
    status: 'OPEN',
    sourceCode: 'PMS',
    directionCode: reasonCodes.join(','),
    openedAt: evaluation.cutoffAt ?? observedAt,
    lastObservedAt: observedAt,
  }
}

export const pmsRepairNoticeContent = ({
  hotel,
  incident,
  publicOrigin,
  providerLastErrorCode = null,
}) => {
  const labels = {
    PMS_SNAPSHOT_INCOMPLETE: 'PMS快照不完整',
    PMS_DATA_STALE: 'PMS数据超过90分钟未更新',
    PMS_DEVICE_REENROLL_REQUIRED: 'PMS采集设备需要重新绑定',
    PMS_SCOPE_NOT_APPROVED: 'PMS门店范围尚未授权',
  }
  const reasons = String(incident?.directionCode ?? '')
    .split(',')
    .map((code) => labels[code])
    .filter(Boolean)
  const guidance = hotel.pmsSystemCode === 'LUOPAN_CLOUD'
    ? luopanPmsRepairGuidance(providerLastErrorCode)
    : null
  return [
    '【PMS需要修复处理】',
    `门店：${hotel.hotelCode} · ${hotel.hotelName}`,
    `原因：${reasons.join('；') || 'PMS状态异常'}`,
    ...(guidance ? [
      `诊断：${guidance.diagnosis}`,
      `验证码：${guidance.captchaText}`,
      `处理：${guidance.action}`,
    ] : ['处理：点击修复后台，登录后按页面指引操作。']),
    `修复后台：${buildStoreRepairConsoleUrl({
      publicOrigin,
      hotelCode: hotel.hotelCode,
    })}`,
  ].join('\n')
}
