import { createHash } from 'node:crypto'

export const PMS_REPAIR_STALE_AFTER_MS = 90 * 60 * 1000

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

export const pmsRepairNoticeContent = ({ hotel, incident }) => {
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
  return [
    '【PMS需要修复处理】',
    `门店：${hotel.hotelCode} · ${hotel.hotelName}`,
    `原因：${reasons.join('；') || 'PMS状态异常'}`,
    '请进入四方馆后台“异常处理”，点击“一键直达”完成修复。',
  ].join('\n')
}
