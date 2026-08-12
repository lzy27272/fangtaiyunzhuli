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

export const downloadInvestmentExcel = (identity: RoleContext, projectNo: string, version: InvestmentVersion) =>
  download(identity, `/investments/versions/${version.id}/exports/excel`, `${projectNo}-V${String(version.versionNo).padStart(3, '0')}.xlsx`)

export const downloadInvestmentPdf = (
  identity: RoleContext,
  projectNo: string,
  version: InvestmentVersion,
  occupancies: number[],
) => download(
  identity,
  `/investments/versions/${version.id}/exports/pdf?occupancies=${occupancies.join(',')}`,
  `${projectNo}-V${String(version.versionNo).padStart(3, '0')}-${occupancies.join('-')}.pdf`,
)
