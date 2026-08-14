import { apiBlob } from '../../api/client'
import type { RoleContext } from '../../domain'
import { featureApiMutation, featureApiRequest } from '../shared/featureApi'
import type {
  CostParameterInput,
  CostParameterVersion,
  InvestmentAuditEntry,
  InvestmentProjectDetail,
  InvestmentProjectSummary,
  InvestmentVersion,
  PlanInput,
  ProfessionalCalculationResult,
  ProfessionalPlanInput,
  ProfessionalReportHistoryRecord,
  ProfessionalReportHistorySummary,
} from './types'

export const loadInvestmentProjects = (identity: RoleContext, signal?: AbortSignal, includeArchived = false) =>
  featureApiRequest<InvestmentProjectSummary[]>(`/investments/projects?includeArchived=${includeArchived}`, identity, { signal })

export const loadInvestmentProject = (identity: RoleContext, projectId: string, signal?: AbortSignal) =>
  featureApiRequest<InvestmentProjectDetail>(`/investments/projects/${projectId}`, identity, { signal })

export const createInvestmentProject = (identity: RoleContext, projectName: string, input: PlanInput) =>
  featureApiMutation<InvestmentProjectDetail>('/investments/projects', identity, {
    method: 'POST', body: { projectName, input },
  })

export const updateInvestmentDraft = (
  identity: RoleContext,
  version: InvestmentVersion,
  projectName: string,
  input: PlanInput,
) => featureApiMutation<InvestmentVersion>(`/investments/versions/${version.id}`, identity, {
  method: 'PUT', body: { projectName, input, expectedVersion: version.rowVersion }, expectedVersion: version.rowVersion,
})

export const confirmInvestmentVersion = (identity: RoleContext, version: InvestmentVersion) =>
  featureApiMutation<InvestmentVersion>(`/investments/versions/${version.id}/actions/confirm`, identity, {
    method: 'POST', body: { expectedVersion: version.rowVersion }, expectedVersion: version.rowVersion,
  })

export const copyInvestmentVersion = (identity: RoleContext, versionId: string) =>
  featureApiMutation<InvestmentVersion>(`/investments/versions/${versionId}/actions/copy`, identity, { method: 'POST' })

export const setInvestmentProjectArchived = (identity: RoleContext, project: InvestmentProjectDetail, archived: boolean) =>
  featureApiMutation<InvestmentProjectDetail>(`/investments/projects/${project.id}/actions/${archived ? 'archive' : 'restore'}`, identity, {
    method: 'POST', body: { expectedVersion: project.rowVersion }, expectedVersion: project.rowVersion,
  })

export const loadInvestmentAudit = (identity: RoleContext, projectId: string, signal?: AbortSignal) =>
  featureApiRequest<InvestmentAuditEntry[]>(`/investments/projects/${projectId}/audit`, identity, { signal })

export const loadInvestmentCostParameters = (identity: RoleContext, signal?: AbortSignal) =>
  featureApiRequest<CostParameterVersion[]>('/investments/cost-parameters', identity, { signal })

export const createInvestmentCostParameters = (identity: RoleContext, input: CostParameterInput) =>
  featureApiMutation<CostParameterVersion>('/investments/cost-parameters', identity, { method: 'POST', body: { input } })

export const updateInvestmentCostParameters = (
  identity: RoleContext,
  version: CostParameterVersion,
  input: CostParameterInput,
) => featureApiMutation<CostParameterVersion>(`/investments/cost-parameters/${version.id}`, identity, {
  method: 'PUT', body: { input, expectedVersion: version.rowVersion }, expectedVersion: version.rowVersion,
})

export const activateInvestmentCostParameters = (identity: RoleContext, version: CostParameterVersion) =>
  featureApiMutation<CostParameterVersion>(`/investments/cost-parameters/${version.id}/actions/activate`, identity, {
    method: 'POST', body: { expectedVersion: version.rowVersion }, expectedVersion: version.rowVersion,
  })

async function download(identity: RoleContext, path: string, fileName: string) {
  const blob = await apiBlob(path, identity)
  const link = document.createElement('a')
  link.href = URL.createObjectURL(blob)
  link.download = fileName
  link.click()
  URL.revokeObjectURL(link.href)
}

function investmentReportFileName(projectName: string, extension: 'pdf' | 'xlsx') {
  const cleaned = projectName
    .trim()
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '')
    .replace(/[. ]+$/g, '') || '投资项目'
  const baseName = cleaned.endsWith('投资测算')
    ? cleaned
    : `${cleaned}${cleaned.endsWith('项目') ? '' : '项目'}投资测算`
  return `${baseName}.${extension}`
}

export const downloadInvestmentExcel = (identity: RoleContext, version: InvestmentVersion) =>
  download(identity, `/investments/versions/${version.id}/exports/excel`, investmentReportFileName(version.projectName, 'xlsx'))

export const downloadInvestmentPdf = (
  identity: RoleContext,
  version: InvestmentVersion,
  occupancies: number[],
) => download(
  identity,
  `/investments/versions/${version.id}/exports/pdf?occupancies=${occupancies.join(',')}`,
  investmentReportFileName(version.projectName, 'pdf'),
)

export const calculateProfessionalInvestment = (identity: RoleContext, input: ProfessionalPlanInput) =>
  featureApiMutation<ProfessionalCalculationResult>('/investments/professional/calculate', identity, { method: 'POST', body: { input } })

export const loadProfessionalInvestmentHistories = (identity: RoleContext, signal?: AbortSignal) =>
  featureApiRequest<ProfessionalReportHistorySummary[]>('/investments/professional/reports', identity, { signal })

export const loadProfessionalInvestmentHistory = (identity: RoleContext, reportId: string, signal?: AbortSignal) =>
  featureApiRequest<ProfessionalReportHistoryRecord>(`/investments/professional/reports/${reportId}`, identity, { signal })

export const createProfessionalInvestmentHistory = (identity: RoleContext, input: ProfessionalPlanInput) =>
  featureApiMutation<ProfessionalReportHistoryRecord>('/investments/professional/reports', identity, { method: 'POST', body: { input } })

export const updateProfessionalInvestmentHistory = (
  identity: RoleContext,
  report: ProfessionalReportHistoryRecord,
  input: ProfessionalPlanInput,
) => featureApiMutation<ProfessionalReportHistoryRecord>(`/investments/professional/reports/${report.id}`, identity, {
  method: 'PUT', body: { input, expectedVersion: report.rowVersion }, expectedVersion: report.rowVersion,
})

export const deleteProfessionalInvestmentHistory = (identity: RoleContext, report: ProfessionalReportHistorySummary) =>
  featureApiMutation<void>(`/investments/professional/reports/${report.id}/actions/delete`, identity, {
    method: 'POST', body: { expectedVersion: report.rowVersion }, expectedVersion: report.rowVersion,
  })

export async function downloadProfessionalInvestmentPdf(identity: RoleContext, input: ProfessionalPlanInput) {
  const blob = await apiBlob('/investments/professional/exports/pdf', identity, {
    method: 'POST', body: JSON.stringify({ input }),
  })
  const link = document.createElement('a')
  link.href = URL.createObjectURL(blob)
  link.download = professionalReportFileName(input.projectName)
  link.click()
  window.setTimeout(() => URL.revokeObjectURL(link.href), 0)
}

export const downloadProfessionalInvestmentHistoryPdf = (identity: RoleContext, report: ProfessionalReportHistorySummary) =>
  download(identity, `/investments/professional/reports/${report.id}/exports/pdf`, professionalReportFileName(report.projectName))

function professionalReportFileName(projectName: string) {
  return investmentReportFileName(projectName, 'pdf').replace('.pdf', '_专业版.pdf')
}
