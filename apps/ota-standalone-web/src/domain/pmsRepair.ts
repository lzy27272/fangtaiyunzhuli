import type { MonitorView } from '../api/business'
import type { TrustedDeviceStatus } from '../api/trustedDevice'

export const PMS_REPAIR_STALE_AFTER_MS = 90 * 60 * 1000

export type PmsRepairReason =
  | 'PMS_SNAPSHOT_INCOMPLETE'
  | 'PMS_DATA_STALE'
  | 'PMS_DEVICE_REENROLL_REQUIRED'
  | 'PMS_SCOPE_NOT_APPROVED'

export interface PmsRepairEvaluation {
  required: boolean
  reasons: PmsRepairReason[]
}

export const PMS_REPAIR_REASON_LABEL: Record<PmsRepairReason, string> = {
  PMS_SNAPSHOT_INCOMPLETE: 'PMS快照不完整',
  PMS_DATA_STALE: 'PMS数据超过90分钟未更新',
  PMS_DEVICE_REENROLL_REQUIRED: 'PMS采集设备需要重新绑定',
  PMS_SCOPE_NOT_APPROVED: 'PMS门店范围尚未授权',
}

export function evaluatePmsRepair({
  monitor,
  trustedDeviceStatus,
  nowMs = Date.now(),
}: {
  monitor: MonitorView | null
  trustedDeviceStatus: TrustedDeviceStatus | null
  nowMs?: number
}): PmsRepairEvaluation {
  const reasons: PmsRepairReason[] = []
  const cutoffMs = monitor?.cutoffAt ? new Date(monitor.cutoffAt).getTime() : Number.NaN
  if (monitor?.completeness !== 'COMPLETE' || !Number.isFinite(cutoffMs)) {
    reasons.push('PMS_SNAPSHOT_INCOMPLETE')
  }

  if (Number.isFinite(cutoffMs) && nowMs - cutoffMs > PMS_REPAIR_STALE_AFTER_MS) {
    reasons.push('PMS_DATA_STALE')
  }

  if (trustedDeviceStatus?.eligible) {
    const device = trustedDeviceStatus.device
    if (!device || device.reenrollRequired) reasons.push('PMS_DEVICE_REENROLL_REQUIRED')
    if (device && device.scopeApprovalStatus !== 'APPROVED') reasons.push('PMS_SCOPE_NOT_APPROVED')
  }

  return { required: reasons.length > 0, reasons }
}
