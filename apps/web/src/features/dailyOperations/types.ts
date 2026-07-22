export type IssueSeverity = 'GENERAL' | 'IMPORTANT' | 'MAJOR'
export type IssueStatus = 'CANDIDATE' | 'CONFIRMED' | 'IN_PROGRESS' | 'PENDING_CLOSE' | 'CLOSED'
export type TaskCandidateStatus = 'PENDING_CONFIRMATION' | 'CONFIRMED' | 'PENDING_SYNC' | 'TASK_CREATED' | 'REJECTED'
export type SnapshotStatus = 'GENERATING' | 'GENERATED' | 'FAILED' | 'SUPERSEDED'

export type OperationMetric = { code: string; label: string; value?: number; unit?: string; available: boolean; source?: string }
export type OperationIssueSummary = {
  id: string
  issueNo: string
  title: string
  description?: string
  severity: IssueSeverity
  lifecycleStatus: IssueStatus
  ownerName?: string
  ownerAssignmentId?: string
  reviewerAssignmentId?: string
  hotelName?: string
  businessDate: string
  dueAt?: string
  overdue: boolean
  sourceCount: number
  taskCount: number
  updatedAt?: string
  rowVersion: number
}

export type DailyOperationOverview = {
  orgUnitId: string
  orgName: string
  businessDate: string
  timezone: string
  mode: 'REALTIME' | 'SNAPSHOT'
  snapshotId?: string
  generatedAt?: string
  dataUpdatedAt?: string
  unavailableSources: string[]
  metrics: OperationMetric[]
  issues: OperationIssueSummary[]
  actionItemCount: number
  unresolvedIssueCount: number
  overdueCount: number
  pendingTaskCandidateCount: number
}

export type OperationActionItem = {
  id: string
  actionType: string
  title: string
  description?: string
  severity?: IssueSeverity
  sourceType: string
  sourceId: string
  ownerName?: string
  dueAt?: string
  escalationLevel?: number
  syncStatus?: string
  allowedActions: string[]
}

export type IssueSource = { id: string; sourceType: string; sourceId: string; label: string; snapshot: string; invalidatedAt?: string }
export type IssueTimelineItem = { id: string; eventType: string; description: string; actorName?: string; occurredAt: string }
export type LinkedTask = { id: string; taskNo?: string; title: string; status: string }
export type AiRecommendation = { id: string; facts: string; analysis: string; recommendation: string; sourceLabels: string[]; decision?: string; createdAt: string }

export type TaskCandidate = {
  id: string
  title: string
  description: string
  priority: string
  ownerName?: string
  dueAt?: string
  acceptanceCriteria?: string
  status: TaskCandidateStatus
  syncStatus?: string
  formalTaskId?: string
  aiSuggested: boolean
  sourceLabels: string[]
  rowVersion: number
  allowedActions: string[]
}

export type OperationIssueDetail = OperationIssueSummary & {
  sources: IssueSource[]
  linkedTasks: LinkedTask[]
  taskCandidates: TaskCandidate[]
  timeline: IssueTimelineItem[]
  aiRecommendations: AiRecommendation[]
  allowedActions: string[]
  blockedActionReasons: Record<string, string>
}

export type OperationSnapshotSummary = {
  id: string
  orgUnitId: string
  orgName: string
  businessDate: string
  versionNo: number
  status: SnapshotStatus
  generatedAt?: string
  completenessPercent?: number
  correctionReason?: string
  rowVersion: number
}

export type OperationSnapshotDetail = OperationSnapshotSummary & {
  overview: DailyOperationOverview
  previousVersionId?: string
}

export type OperationExport = {
  id: string
  exportType: string
  businessDate: string
  orgName: string
  status: 'PENDING' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'EXPIRED'
  sensitiveIncluded: boolean
  createdAt: string
  expiresAt?: string
  downloadUrl?: string
}
