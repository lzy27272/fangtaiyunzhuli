import type { OtaSourceView } from '../api/business'

export type OtaOperatingDataState =
  | 'READY'
  | 'STRUCTURE_ONLY'
  | 'UNRECOGNIZED'
  | 'FAILED'
  | 'NOT_COLLECTED'
  | 'DISABLED'

export type OtaOperatingDataKind =
  | 'RANK'
  | 'REVIEW'
  | 'ORDER'
  | 'GENERIC'

export type OtaOperatingTone = 'ok' | 'warning' | 'error' | 'muted'

export interface OtaOperatingStateView {
  state: OtaOperatingDataState
  label: string
  tone: OtaOperatingTone
}

export interface OtaPlatformSourceGroup {
  platformCode: string
  sources: OtaSourceView[]
  state: OtaOperatingStateView
}

const PLATFORM_ORDER = [
  'CTRIP',
  'MEITUAN',
  'FLIGGY',
  'DOUYIN',
  'QUNAR',
  'TONGCHENG',
  'OTHER',
] as const

const STATE_PRIORITY: Record<OtaOperatingDataState, number> = {
  FAILED: 6,
  UNRECOGNIZED: 5,
  NOT_COLLECTED: 4,
  STRUCTURE_ONLY: 3,
  READY: 2,
  DISABLED: 1,
}

const STATE_VIEW: Record<OtaOperatingDataState, OtaOperatingStateView> = {
  READY: { state: 'READY', label: '数据已形成', tone: 'ok' },
  STRUCTURE_ONLY: {
    state: 'STRUCTURE_ONLY',
    label: '结构待映射',
    tone: 'warning',
  },
  UNRECOGNIZED: {
    state: 'UNRECOGNIZED',
    label: '未形成经营数据',
    tone: 'warning',
  },
  FAILED: { state: 'FAILED', label: '采集异常', tone: 'error' },
  NOT_COLLECTED: {
    state: 'NOT_COLLECTED',
    label: '等待首次采集',
    tone: 'warning',
  },
  DISABLED: { state: 'DISABLED', label: '已停用', tone: 'muted' },
}

export const otaPlatformLabel = (platformCode: string): string => ({
  CTRIP: '携程',
  MEITUAN: '美团',
  FLIGGY: '飞猪',
  DOUYIN: '抖音',
  QUNAR: '去哪儿',
  TONGCHENG: '同程',
  OTHER: '其他渠道',
}[platformCode] ?? platformCode)

export const otaDimensionLabel = (dimension: string): string => ({
  DATE: '日期',
  ROOM_TYPE: '房型',
  INVENTORY: '房态库存',
  PRICE: '价格与收入',
  SALES: '订单与销售',
  ORDER: '订单',
  CANCELLATION: '取消',
  CHANNEL: '渠道',
  REVIEW: '评价',
  RANK: '排名',
  EXPOSURE: '曝光',
  TRAFFIC: '流量',
  CONVERSION: '转化',
  PEER_SET_SIZE: '竞争圈',
}[dimension] ?? dimension)

export const otaOperatingDataKind = (
  source: OtaSourceView,
): OtaOperatingDataKind => {
  if (source.lastSummary?.peerRanking) return 'RANK'
  if (
    source.lastSummary?.reviewMetrics
    || source.lastSummary?.providerDataset?.dataset === 'REVIEW'
  ) return 'REVIEW'
  if (source.lastSummary?.providerDataset?.dataset === 'ORDER') return 'ORDER'
  return 'GENERIC'
}

export const otaOperatingDataState = (
  source: OtaSourceView,
): OtaOperatingStateView => {
  if (!source.enabled) return STATE_VIEW.DISABLED
  if (
    source.lastRefreshStatus === 'FAILED'
    && source.lastErrorCode === 'OTA_CTRIP_ORDER_SCHEMA_UNRECOGNIZED'
  ) return STATE_VIEW.UNRECOGNIZED
  if (source.lastRefreshStatus === 'FAILED') return STATE_VIEW.FAILED
  if (source.lastRefreshStatus !== 'COMPLETE' || !source.lastSummary) {
    return STATE_VIEW.NOT_COLLECTED
  }
  if (otaOperatingDataKind(source) !== 'GENERIC') return STATE_VIEW.READY
  if ((source.lastSummary.detectedDimensions ?? []).length > 0) {
    return STATE_VIEW.STRUCTURE_ONLY
  }
  return STATE_VIEW.UNRECOGNIZED
}

const platformIndex = (platformCode: string): number => {
  const index = PLATFORM_ORDER.indexOf(
    platformCode as typeof PLATFORM_ORDER[number],
  )
  return index < 0 ? PLATFORM_ORDER.length : index
}

export const sortOtaOperatingSources = (
  sources: OtaSourceView[],
): OtaSourceView[] => [...sources].sort((left, right) => (
  platformIndex(left.platformCode) - platformIndex(right.platformCode)
  || left.displayName.localeCompare(right.displayName, 'zh-CN')
  || left.sourceId.localeCompare(right.sourceId)
))

export const groupOtaOperatingSources = (
  sources: OtaSourceView[],
): OtaPlatformSourceGroup[] => {
  const groups = new Map<string, OtaSourceView[]>()
  for (const source of sortOtaOperatingSources(sources)) {
    const group = groups.get(source.platformCode) ?? []
    group.push(source)
    groups.set(source.platformCode, group)
  }
  return [...groups].map(([platformCode, groupedSources]) => ({
    platformCode,
    sources: groupedSources,
    state: groupedSources
      .map(otaOperatingDataState)
      .sort((left, right) => (
        STATE_PRIORITY[right.state] - STATE_PRIORITY[left.state]
      ))[0] ?? STATE_VIEW.NOT_COLLECTED,
  }))
}

export const otaReviewDashboardSources = (
  sources: OtaSourceView[],
): OtaSourceView[] => sources.filter((source) => (
  source.enabled
  && source.lastRefreshStatus === 'COMPLETE'
  && otaOperatingDataState(source).state === 'READY'
))

export const latestSuccessfulCollectionAt = (
  pmsCutoffAt: string | null | undefined,
  sources: OtaSourceView[],
): string | null => {
  const candidates = [
    pmsCutoffAt,
    ...sources
      .filter((source) => (
        source.enabled && source.lastRefreshStatus === 'COMPLETE'
        && otaOperatingDataState(source).state === 'READY'
      ))
      .map((source) => source.lastRefreshAt),
  ].filter((value): value is string => Boolean(value))

  return candidates.reduce<string | null>((latest, candidate) => {
    const candidateTime = Date.parse(candidate)
    if (!Number.isFinite(candidateTime)) return latest
    if (!latest) return candidate
    const latestTime = Date.parse(latest)
    return !Number.isFinite(latestTime) || candidateTime > latestTime
      ? candidate
      : latest
  }, null)
}
