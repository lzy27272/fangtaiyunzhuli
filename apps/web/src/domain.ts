import type { ApiIdentity } from './api/client'

export type ViewId =
  | 'workbench'
  | 'hotel-dashboard'
  | 'operations-dashboard'
  | 'work-packages'
  | 'my-work'
  | 'team-work'
  | 'rules'
  | 'tasks'
  | 'evaluations'
  | 'notifications'
  | 'templates'
  | 'organization'

export type RoleContext = ApiIdentity & {
  key: string
  label: string
  userName: string
  orgName: string
  focus: string
  employeeId?: string
  assignmentOrgUnitId?: string
}

export type IdentityAssignment = {
  id: string
  orgUnitId: string
  orgName: string
  positionId: string
  positionCode: string
  positionName: string
  primary: boolean
  assignmentType: string
}

export type IdentitySnapshot = {
  accountId: string
  displayName: string
  employeeId?: string
  employeeName?: string
  primaryRoleCode: string
  roleCodes: string[]
  permissions: string[]
  tenantScope: boolean
  orgScopes: string[]
  assignments: IdentityAssignment[]
}

export type WorkPackage = {
  id: string
  code: string
  name: string
  positionName: string
  versionNo: number
  lifecycleStatus: string
  scopeName: string
  completionRate?: number
  itemCount?: number
  updatedAt?: string
}

export type WorkExpectation = {
  id: string
  title: string
  packageName: string
  itemName: string
  status: string
  businessDate: string
  dueAt?: string
  targetOrgName: string
  assigneeName: string
  assignmentId?: string
  orgUnitId?: string
  employeeId?: string
  formVersionId?: string
  formCode?: string
  formName?: string
  formSchema?: {
    type?: string
    required?: string[]
    properties?: Record<string, { type?: string; title?: string; description?: string; minimum?: number; maximum?: number }>
  }
  workPackageVersionId?: string
  workPackageItemId?: string
  recordId?: string
  rowVersion?: number
  evaluationOutcome?: string
  standards?: WorkStandardReference[]
  records?: WorkRecordSummary[]
  submissionPolicy?: SubmissionPolicy
}

export type SubmissionPolicy = {
  completionStatementRequired: boolean
  exceptionStatementRequired: boolean
  nextActionRequired: boolean
  attachmentRequired: boolean
  maxAttachments: number
  maxFileSizeBytes: number
  allowedExtensions: string[]
}

export type WorkStandardReference = {
  standardVersionId: string
  usageType: string
  standardCode: string
  title: string
  versionNo: number
}

export type WorkRecordSummary = {
  id: string
  status: string
  attemptNo: number
  submittedAt?: string
  reviewedAt?: string
  reviewReason?: string
}

export type WorkRecordAttachment = {
  id: string
  objectKey?: string
  originalName: string
  mediaType: string
  sizeBytes: number
  sha256?: string
  scanStatus: string
  createdAt?: string
}

export type WorkRecordDetail = {
  id: string
  status: string
  rowVersion: number
  businessDate?: string
  payload: Record<string, unknown>
  employeeName: string
  positionName: string
  formName: string
  targetOrgName: string
  targetOrgUnitId?: string
  positionAssignmentId?: string
  workExpectationId?: string
  completionStatement?: string
  exceptionStatement?: string
  nextAction?: string
  reviewReason?: string
  submittedAt?: string
  reviewedAt?: string
  attachments: WorkRecordAttachment[]
  supplements: WorkRecordSupplement[]
}

export type WorkRecordSupplement = {
  id: string
  submittedByAssignmentId: string
  submittedByName: string
  content: string
  createdAt?: string
}

export type TeamWorkCase = {
  expectation: WorkExpectation
  record?: WorkRecordDetail
}

export type ManagementRule = {
  id: string
  code: string
  name: string
  status: string
  versionNo: number
  eventType: string
  scopeName: string
  hitCount?: number
  latestVersionId?: string
  rowVersion?: number
}

export type RuleScope = {
  scopeType: string
  brandId?: string
  orgUnitId?: string
  positionId?: string
}

export type RuleVersionDetail = {
  id: string
  versionNo: number
  lifecycleStatus: string
  conditionAst: Record<string, unknown>
  actions: Array<Record<string, unknown>>
  priority: number
  cooldownMinutes: number
  rowVersion: number
  effectiveFrom?: string
  effectiveTo?: string
  scopes: RuleScope[]
}

export type RuleDetail = {
  id: string
  code: string
  name: string
  eventType: string
  description?: string
  status: string
  versions: RuleVersionDetail[]
}

export type RuleVersionDraft = {
  conditionAst: Record<string, unknown>
  actions: Array<Record<string, unknown>>
  priority: number
  cooldownMinutes: number
  scopes: RuleScope[]
}

export type ManagementTask = {
  id: string
  code: string
  title: string
  status: string
  slaStatus: string
  priority: string
  assigneeName: string
  reviewerName: string
  targetOrgName: string
  sourceType: string
  sourceTitle?: string
  description?: string
  dueAt?: string
  version: number
  targetOrgUnitId?: string
  standardVersionId?: string
  resultSnapshot?: Record<string, unknown>
  evaluationId?: string
  assigneeAssignmentId?: string
  reviewerAssignmentId?: string
  timeline?: TaskTimelineItem[]
  evidence?: TaskEvidence[]
}

export type TaskEvidence = {
  id: string
  submittedByAssignmentId?: string
  evidenceType: string
  objectKey?: string
  originalName?: string
  mediaType?: string
  sizeBytes?: number
  scanStatus: string
  createdAt?: string
}

export type TaskTimelineItem = {
  id: string
  command: string
  fromStatus?: string
  toStatus: string
  actorName: string
  occurredAt: string
  remark?: string
}

export type StandardEvaluation = {
  id: string
  subjectType: string
  subjectTitle: string
  standardCode: string
  standardTitle: string
  standardVersion: number
  outcome: string
  score?: number
  severity: string
  executionStatus: string
  evaluatedAt?: string
  targetOrgName: string
  assignmentId?: string
  items?: EvaluationItem[]
}

export type EvaluationItem = {
  id: string
  itemCode: string
  itemName: string
  outcome: string
  expected?: string
  actual?: string
  score?: number
  reason?: string
}

export type NotificationItem = {
  id: string
  type: string
  title: string
  content: string
  sourceType?: string
  sourceId?: string
  createdAt: string
  readAt?: string
  version: number
  recipientAssignmentId?: string
}

export type DashboardMetric = {
  code: string
  name: string
  unit: string
  value: number
  businessDate?: string
}

export type DashboardRisk = {
  id: string
  title: string
  type: string
  severity: string
  status: string
  source?: string
  ownerName?: string
  occurredAt?: string
}

export type HotelDashboard = {
  hotel: { id: string; name: string; city?: string; roomCount?: number }
  activeEmployeeCount: number
  todayWorkSubmissionCount: number
  latestMetrics: DashboardMetric[]
  risks: DashboardRisk[]
  incompleteTasks: ManagementTask[]
  templateSections?: string[]
}

export type OperationsHotel = {
  id: string
  name: string
  city?: string
  roomCount?: number
  openTaskCount: number
  overdueTaskCount: number
  failedEvaluationCount: number
  missedWorkCount: number
  todaySubmissionCount: number
}

export type OperationsDashboard = {
  hotels: OperationsHotel[]
}

export type EnterpriseTemplateType = 'TASK' | 'HOTEL_DASHBOARD'

export type EnterpriseTemplate = {
  id: string
  templateType: EnterpriseTemplateType
  code: string
  name: string
  description?: string
  positionName?: string
  ownerOrgName?: string
  latestVersionId?: string
  versionNo: number
  lifecycleStatus: string
  configuration: Record<string, unknown>
  publishedVersionId?: string
  publishedVersionNo?: number
  publishedConfiguration?: Record<string, unknown>
  rowVersion: number
}

export type ApiSource = 'api' | 'demo'
