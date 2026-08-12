import type { RoleContext } from '../../domain'
import { apiBlob } from '../../api/client'
import { featureApiMutation, featureApiRequest } from '../shared/featureApi'
import type {
  InspectionSchedule,
  InspectionSubmission,
  KpiPeriod,
  KpiRelation,
  KpiScorecard,
  KpiScorecardDetail,
  KpiSettlement,
  KpiTemplate,
} from './types'

export type KpiPositionOption = { id: string; code: string; name: string; status: string }
export type KpiImportTier = { target: string; score?: number }
export type KpiImportIndicator = {
  section: string
  name: string
  criteria: string
  maxScore: number
  minScore?: number
  redline: boolean
  bonus: boolean
  allowAboveMax: boolean
  weeklySplitType: string
  targetValue?: number
  sourceWeight: string
  tiers: KpiImportTier[]
}
export type KpiDetectedTemplate = {
  sheetName: string
  templateCode: string
  templateName: string
  baseFullScore: number
  bonusBase?: number
  suggestedPositionId?: string
  suggestedPositionCode: string
  suggestedPositionName: string
  matchConfidence: string
  indicators: KpiImportIndicator[]
  warnings: string[]
}
export type KpiImportUpload = {
  id: string
  fileName: string
  rowCount: number
  sheetCount: number
  status: string
  importMode: string
  headers: string[]
  preview: Array<Record<string, string>>
  templates: KpiDetectedTemplate[]
  ignoredSheets: Array<{ sheetName: string; reason: string }>
}
export type KpiSourceHotel = {
  hotelId: string
  hotelCode: string
  hotelName: string
  snapshotAvailable: boolean
  latestBusinessDate?: string
  latestObservedAt?: string
  freshnessState?: string
  businessDayCount?: number
  middlePlatformStoreBindingState: string
}
export type KpiSourcePreviewCatalog = {
  templateVersionId: string
  templateTitle: string
  templateLifecycleStatus: string
  sourceMode: string
  sourceConfigured: boolean
  factWriteEnabled: boolean
  totalIndicators: number
  suggestedSourceBindings: number
  currentlyScoreableIndicators: number
  hotels: KpiSourceHotel[]
  notice: string
}
export type KpiSourcePreviewResult = {
  previewOnly: boolean
  officialScoreEligible: boolean
  scoreState: string
  assessmentMonth: string
  sourceDataMonth: string
  templateTitle: string
  sourceHotel: KpiSourceHotel
  window: { from: string; to: string; businessDays: number }
  freshnessState: string
  completenessState: string
  sourceMetrics: Array<{ code: string; name: string; value?: number; displayValue: string; unit: string; state: string }>
  automaticScore: number
  automaticMaxScore: number
  candidateScore: number
  candidateMaxScore: number
  baseFullScore: number
  scoreableIndicators: number
  pendingIndicators: number
  validation: Record<string, unknown>
  indicators: Array<{ section: string; indicatorCode: string; name: string; maxScore: number; sourceMetricCode?: string; sourceLabel: string; state: string; actualValue?: number; displayValue?: string; score?: number; candidateScore?: number; matchedTier?: string; evidence?: string; reason?: string; definitionWarning?: string }>
  warnings: string[]
}

function query(params: Record<string, string | undefined>) {
  const search = new URLSearchParams()
  Object.entries(params).forEach(([key, value]) => { if (value) search.set(key, value) })
  return search.size ? `?${search.toString()}` : ''
}

export const loadKpiPeriods = (identity: RoleContext, signal?: AbortSignal) =>
  featureApiRequest<KpiPeriod[]>('/kpi/periods', identity, { signal })

export const loadKpiScorecards = (
  identity: RoleContext,
  signal?: AbortSignal,
  params: { periodId?: string; cardType?: string; status?: string } = {},
) => featureApiRequest<KpiScorecard[]>(`/kpi/scorecards${query(params)}`, identity, { signal })

export const loadKpiScorecard = (identity: RoleContext, scorecardId: string, signal?: AbortSignal) =>
  featureApiRequest<KpiScorecardDetail>(`/kpi/scorecards/${scorecardId}`, identity, { signal })

export const generateKpiPeriod = (identity: RoleContext, body: Record<string, unknown>) =>
  featureApiMutation<Record<string, unknown>>('/kpi/periods/actions/generate', identity, { method: 'POST', body })

export const reviewKpiScorecard = (identity: RoleContext, scorecard: KpiScorecardDetail, body: Record<string, unknown>) =>
  featureApiMutation<Record<string, unknown>>(`/kpi/scorecards/${scorecard.id}/reviews`, identity, {
    method: 'POST', body: { ...body, expectedVersion: scorecard.rowVersion }, expectedVersion: scorecard.rowVersion,
  })

export const submitManualKpiScore = (identity: RoleContext, scorecardId: string, body: Record<string, unknown>) =>
  featureApiMutation<Record<string, unknown>>(`/kpi/scorecards/${scorecardId}/manual-scores`, identity, { method: 'POST', body })

export const disputeKpiScorecard = (identity: RoleContext, scorecardId: string, body: Record<string, unknown>) =>
  featureApiMutation<Record<string, unknown>>(`/kpi/scorecards/${scorecardId}/disputes`, identity, { method: 'POST', body })

export const loadKpiTemplates = (identity: RoleContext, signal?: AbortSignal) =>
  featureApiRequest<KpiTemplate[]>('/kpi/templates', identity, { signal })

export const loadKpiPositions = (identity: RoleContext, signal?: AbortSignal) =>
  featureApiRequest<KpiPositionOption[]>('/org/positions', identity, { signal })

export const loadKpiTemplate = (identity: RoleContext, templateId: string, signal?: AbortSignal) =>
  featureApiRequest<Record<string, unknown>>(`/kpi/templates/${templateId}`, identity, { signal })

export const loadKpiTemplateVersion = (identity: RoleContext, versionId: string, signal?: AbortSignal) =>
  featureApiRequest<Record<string, unknown>>(`/kpi/template-versions/${versionId}`, identity, { signal })

export const loadKpiSourcePreviewCatalog = (identity: RoleContext, versionId: string, signal?: AbortSignal) =>
  featureApiRequest<KpiSourcePreviewCatalog>(`/kpi/source-preview/catalog?templateVersionId=${encodeURIComponent(versionId)}`, identity, { signal })

export const calculateKpiSourcePreview = (identity: RoleContext, templateVersionId: string, sourceHotelId: string, assessmentMonth: string) =>
  featureApiMutation<KpiSourcePreviewResult>('/kpi/source-preview/actions/calculate', identity, {
    method: 'POST', body: { templateVersionId, sourceHotelId, assessmentMonth: `${assessmentMonth}-01` },
  })

export const updateKpiTemplateVersion = (identity: RoleContext, versionId: string, body: Record<string, unknown>) =>
  featureApiMutation<Record<string, unknown>>(`/kpi/template-versions/${versionId}`, identity, { method: 'PUT', body })

export const loadKpiRelations = (identity: RoleContext, signal?: AbortSignal) =>
  featureApiRequest<KpiRelation[]>('/kpi/relations', identity, { signal })

export const loadKpiSettlements = (identity: RoleContext, signal?: AbortSignal, periodId?: string) =>
  featureApiRequest<KpiSettlement[]>(`/kpi/settlements${query({ periodId })}`, identity, { signal })

export const loadInspectionSchedules = (identity: RoleContext, signal?: AbortSignal) =>
  featureApiRequest<InspectionSchedule[]>('/kpi/inspections/schedules', identity, { signal })

export const loadInspections = (identity: RoleContext, signal?: AbortSignal, businessDate?: string) =>
  featureApiRequest<InspectionSubmission[]>(`/kpi/inspections${query({ businessDate })}`, identity, { signal })

export const submitInspection = (identity: RoleContext, body: Record<string, unknown>) =>
  featureApiMutation<InspectionSubmission>('/kpi/inspections', identity, { method: 'POST', body })

export const recordInspectionEvent = (identity: RoleContext, submissionId: string, body: Record<string, unknown>) =>
  featureApiMutation<Record<string, unknown>>(`/kpi/inspections/${submissionId}/events`, identity, { method: 'POST', body })

export const verifyInspection = (identity: RoleContext, submissionId: string, body: Record<string, unknown>) =>
  featureApiMutation<Record<string, unknown>>(`/kpi/inspections/${submissionId}/verifications`, identity, { method: 'POST', body })

export const uploadKpiTemplate = (identity: RoleContext, file: File) => {
  const form = new FormData()
  form.append('file', file)
  return featureApiRequest<KpiImportUpload>('/kpi/imports', identity, { method: 'POST', body: form })
}

export const applyKpiTemplateImport = (identity: RoleContext, jobId: string, body: Record<string, unknown>) =>
  featureApiMutation<Record<string, unknown>>(`/kpi/imports/${jobId}/actions/apply`, identity, { method: 'POST', body })

export const generateKpiTemplateDrafts = (identity: RoleContext, jobId: string, body: Record<string, unknown>) =>
  featureApiMutation<Record<string, unknown>>(`/kpi/imports/${jobId}/actions/generate-drafts`, identity, { method: 'POST', body })

export async function downloadKpiExport(
  identity: RoleContext,
  type: 'scorecards' | 'settlements',
  periodId?: string,
) {
  const suffix = periodId ? `?periodId=${encodeURIComponent(periodId)}` : ''
  const blob = await apiBlob(`/kpi/exports/${type}.csv${suffix}`, identity)
  const link = document.createElement('a')
  link.href = URL.createObjectURL(blob)
  link.download = `${type === 'scorecards' ? 'KPI考核结果明细' : 'KPI奖金结算'}.csv`
  link.click()
  URL.revokeObjectURL(link.href)
}
