import { authenticatedRequest, postCommand, scopedPath, type HotelContext } from './business'

export interface OccupancyPeriod {
  type: 'WEEK' | 'MONTH'
  start: string
  end: string
  expectedDays: number
  availableDays: number
  occupancyPercent: number | null
  complete: boolean
}
export interface OccupancyPoint {
  date: string
  time: string
  baselineDate: string
  baselinePercent: number | null
  baselineObservedAt: string | null
  suggestedPercent: number | null
  targetPercent: number | null
  actualPercent: number | null
  actualObservedAt: string | null
  editable: boolean
  gapPp: number | null
  status: 'UNSET' | 'PENDING' | 'MISSING' | 'MET' | 'BEHIND'
}
export interface OccupancyDecision {
  version: number
  approvedAt: string
  approvedBy: string
  reason: string
}
export interface OccupancyReviewView {
  basis: string
  times: string[]
  today: string
  currentWeek: string
  history: { status: 'UNAVAILABLE' | 'STALE' | 'READY'; generatedAt: string | null; firstDate: string | null; hourlyMonths: number; dailyYears: number; aggregateYears: number }
  current: { date: string; occupancyPercent: number; observedAt: string; stale: boolean; targetPercent: number | null; gapPp: number | null } | null
  review: OccupancyPeriod & {
    prior: OccupancyPeriod & { deltaPp: number | null }
    priorYear: OccupancyPeriod & { deltaPp: number | null }
    days: Array<{ date: string; occupancyPercent: number | null; observedAt: string | null; points: Array<{ time: string; occupancyPercent: number | null; observedAt: string | null }> }>
    comparisonBasis: string
    note: string
  }
  plan: {
    weekStart: string; weekEnd: string; baselineWeekStart: string; version: number
    approvedAt: string | null; approvedBy: string | null; reason: string | null; note: string
    days: Array<{ date: string; baselineDate: string; points: OccupancyPoint[]; advice: string }>
  }
  recentDecisions: OccupancyDecision[]
}
export interface OccupancyTargetInput {
  weekStart: string
  expectedVersion: number
  reason: string
  points: Array<{ date: string; time: string; percent: number }>
}
export function loadOccupancyReview(context: HotelContext, filters: { type: 'WEEK' | 'MONTH'; date?: string; planWeek?: string }, signal?: AbortSignal): Promise<OccupancyReviewView> {
  const query = new URLSearchParams({ type: filters.type })
  if (filters.date) query.set('date', filters.date)
  if (filters.planWeek) query.set('planWeek', filters.planWeek)
  return authenticatedRequest(`${scopedPath(context, '/occupancy-review')}?${query}`, { signal })
}
export function approveOccupancyTargets(context: HotelContext, input: OccupancyTargetInput): Promise<OccupancyDecision> {
  return postCommand(scopedPath(context, '/occupancy-targets'), { ...input, reasonCode: 'APPROVE_OCCUPANCY_TARGETS' })
}

export function occupancyError(cause: unknown): string {
  const message = cause instanceof Error ? cause.message : ''
  const labels: Record<string, string> = {
    OCCUPANCY_TARGET_VERSION_CONFLICT: '其他管理员已更新目标。请刷新后核对，不会覆盖对方的修改。',
    OCCUPANCY_PAST_TARGET_LOCKED: '目标时点已经过去，不能事后补设或修改。请刷新后重新确认尚未到期的目标。',
    OCCUPANCY_TARGET_INVALID: '请填写 0–100 的出租率、至少一个目标时点，以及决策说明。',
    OCCUPANCY_WEEK_INVALID: '请选择自然周的周一。',
    OCCUPANCY_WEEK_OUT_OF_RANGE: '只能确认本周或未来四周的目标。',
    OCCUPANCY_PERIOD_INVALID: '请选择有效的复盘日期。',
    OCCUPANCY_PERIOD_OUT_OF_RANGE: '请选择最近五年内的复盘周期。',
    OCCUPANCY_TARGET_STORE_UNAVAILABLE: '目标记录暂不可读取，已停止操作；请联系管理员检查存储。',
    OCCUPANCY_TARGET_PERSIST_FAILED: '目标保存失败，未生效。请稍后重试。',
    REVIEW_ACCOUNT_SCOPE_FORBIDDEN: '当前账号无权确认门店目标，请联系平台管理员。',
  }
  return labels[message] ?? '出租率数据请求失败，请刷新重试；尚未保存的目标不会生效。'
}
