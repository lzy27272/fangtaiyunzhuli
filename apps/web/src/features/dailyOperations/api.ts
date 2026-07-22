import type { ApiIdentity } from '../../api/client'
import { featureApiMutation, featureApiRequest } from '../shared/featureApi'
import { queryString, requireItems, type PageEnvelope } from '../shared/apiEnvelope'
import type { DailyOperationOverview, OperationActionItem, OperationExport, OperationIssueDetail, OperationIssueSummary, OperationSnapshotDetail, OperationSnapshotSummary, TaskCandidate } from './types'

const operationsBase = '/daily-operations'

type Row = Record<string, unknown>
const row = (value: unknown): Row => value && typeof value === 'object' ? value as Row : {}
const rows = (value: unknown): Row[] => Array.isArray(value) ? value.map(row) : []
const text = (value: unknown, fallback = '') => value === undefined || value === null ? fallback : String(value)
const count = (value: unknown, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback

function snapshotText(value: unknown): string {
  if (typeof value === 'string') return value
  const wrapped = row(value)
  if (typeof wrapped.value === 'string') return wrapped.value
  return Object.keys(wrapped).length ? JSON.stringify(wrapped) : '来源快照未提供可读内容'
}

function requiredAssignmentId(identity: ApiIdentity): string {
  if (!identity.assignmentId) throw new Error('请先选择当前任职后再执行该操作')
  return identity.assignmentId
}

function issueActions(status: string): string[] {
  if (status === 'CANDIDATE') return ['CONFIRM']
  if (status === 'CONFIRMED') return ['START']
  if (status === 'IN_PROGRESS') return ['PENDING_CLOSE']
  if (status === 'PENDING_CLOSE') return ['CLOSE']
  if (status === 'CLOSED') return ['REOPEN']
  return []
}

function candidateActions(status: string, syncStatus?: string): string[] {
  if (status === 'PENDING_CONFIRMATION') return ['CONFIRM', 'REJECT']
  if (status === 'PENDING_SYNC' && ['FAILED', 'MANUAL_INTERVENTION'].includes(syncStatus || '')) return ['RETRY_SYNC']
  return []
}

function normalizeIssueSummary(value: unknown): OperationIssueSummary {
  const source = row(value)
  const lifecycleStatus = text(source.lifecycleStatus || source.status, 'CANDIDATE') as OperationIssueSummary['lifecycleStatus']
  const dueAt = text(source.dueAt) || undefined
  return {
    ...source,
    id: text(source.id),
    issueNo: text(source.issueNo, text(source.id)),
    title: text(source.title, '未命名异常'),
    description: text(source.description) || undefined,
    severity: text(source.severity, 'GENERAL') as OperationIssueSummary['severity'],
    lifecycleStatus,
    ownerName: text(source.ownerName || source.ownerAssignmentId) || undefined,
    ownerAssignmentId: text(source.ownerAssignmentId) || undefined,
    reviewerAssignmentId: text(source.reviewerAssignmentId || source.acceptanceAssignmentId) || undefined,
    hotelName: text(source.hotelName) || undefined,
    businessDate: text(source.businessDate),
    dueAt,
    overdue: Boolean(source.overdue) || Boolean(dueAt && lifecycleStatus !== 'CLOSED' && Date.parse(dueAt) < Date.now()),
    sourceCount: count(source.sourceCount),
    taskCount: count(source.taskCount),
    updatedAt: text(source.updatedAt) || undefined,
    rowVersion: count(source.rowVersion),
  } as OperationIssueSummary
}

function normalizeTaskCandidate(value: unknown): TaskCandidate {
  const source = row(value)
  const status = text(source.status, 'PENDING_CONFIRMATION') as TaskCandidate['status']
  const syncStatus = text(source.syncStatus) || undefined
  return {
    ...source,
    id: text(source.id),
    title: text(source.title, '未命名任务候选'),
    description: text(source.description),
    priority: text(source.priority, 'NORMAL'),
    ownerName: text(source.ownerName || source.assigneeAssignmentId) || undefined,
    dueAt: text(source.dueAt) || undefined,
    acceptanceCriteria: text(source.acceptanceCriteria) || undefined,
    status,
    syncStatus,
    formalTaskId: text(source.formalTaskId) || undefined,
    aiSuggested: Boolean(source.aiSuggested),
    sourceLabels: Array.isArray(source.sourceLabels) ? source.sourceLabels.map(String) : [],
    rowVersion: count(source.rowVersion),
    allowedActions: Array.isArray(source.allowedActions) ? source.allowedActions.map(String) : candidateActions(status, syncStatus),
  } as TaskCandidate
}

function normalizeAiRecommendation(value: unknown, index: number) {
  const source = row(value)
  return {
    id: text(source.id, `ai-recommendation:${index}`),
    facts: text(source.facts || source.factSummary, '暂无结构化事实'),
    analysis: text(source.analysis, '暂无补充分析'),
    recommendation: text(source.recommendation || source.recommendationText, '暂无建议内容'),
    sourceLabels: Array.isArray(source.sourceLabels) ? source.sourceLabels.map(String) : [],
    decision: text(source.decision) || undefined,
    createdAt: text(source.createdAt),
  }
}

function normalizeIssueDetail(value: unknown): OperationIssueDetail {
  const source = row(value)
  const summary = normalizeIssueSummary(source)
  const linkedTasks = rows(source.linkedTasks ?? source.tasks).map((task) => {
    const snapshot = row(task.taskSnapshot)
    return {
      id: text(task.managementTaskId || task.id),
      taskNo: text(task.taskNo || task.managementTaskNo) || undefined,
      title: text(snapshot.title, text(task.taskNo || task.managementTaskNo, '关联正式任务')),
      status: text(snapshot.status || snapshot.lifecycleStatus || task.linkStatus, 'LINKED'),
    }
  })
  const timeline = rows(source.timeline).map((item, index) => ({
    id: text(item.id, `${summary.id}:timeline:${index}`),
    eventType: text(item.eventType || item.command, 'STATUS_CHANGED'),
    description: text(item.description || item.reason, `${text(item.fromStatus, '—')} → ${text(item.toStatus, '—')}`),
    actorName: text(item.actorName || item.actorAssignmentId || item.actorAccountId) || undefined,
    occurredAt: text(item.occurredAt || item.createdAt),
  }))
  const sources = rows(source.sources).map((item) => ({
    id: text(item.id),
    sourceType: text(item.sourceType, 'OTHER'),
    sourceId: text(item.sourceId),
    label: text(item.label || item.sourceExternalKey, `${text(item.sourceType, '来源')} · ${text(item.sourceId)}`),
    snapshot: snapshotText(item.sourceSnapshot),
    invalidatedAt: text(item.invalidatedAt) || undefined,
  }))
  return {
    ...summary,
    sources,
    linkedTasks,
    taskCandidates: rows(source.taskCandidates).map(normalizeTaskCandidate),
    timeline,
    aiRecommendations: rows(source.aiRecommendations).map(normalizeAiRecommendation),
    allowedActions: Array.isArray(source.allowedActions) ? source.allowedActions.map(String) : issueActions(summary.lifecycleStatus),
    blockedActionReasons: row(source.blockedActionReasons) as Record<string, string>,
  }
}

function normalizeOverview(value: unknown): DailyOperationOverview {
  const source = row(value)
  return {
    ...source,
    orgUnitId: text(source.orgUnitId),
    orgName: text(source.orgName, '当前组织'),
    businessDate: text(source.businessDate),
    timezone: text(source.timezone, 'Asia/Shanghai'),
    mode: text(source.mode, 'REALTIME') as DailyOperationOverview['mode'],
    unavailableSources: Array.isArray(source.unavailableSources) ? source.unavailableSources.map(String) : [],
    metrics: rows(source.metrics).map((metric, index) => ({
      code: text(metric.code, `METRIC_${index}`),
      label: text(metric.label, '未命名指标'),
      value: metric.value === undefined || metric.value === null || !Number.isFinite(Number(metric.value)) ? undefined : Number(metric.value),
      unit: text(metric.unit) || undefined,
      available: Boolean(metric.available),
      source: text(metric.source) || undefined,
    })),
    issues: rows(source.issues).map(normalizeIssueSummary),
    actionItemCount: count(source.actionItemCount),
    unresolvedIssueCount: count(source.unresolvedIssueCount),
    overdueCount: count(source.overdueCount),
    pendingTaskCandidateCount: count(source.pendingTaskCandidateCount),
  } as DailyOperationOverview
}

export async function loadDailyOperationOverview(identity: ApiIdentity, signal: AbortSignal, filters: { businessDate?: string; orgUnitId?: string; mode?: string; snapshotId?: string }) {
  return normalizeOverview(await featureApiRequest<unknown>(`${operationsBase}${queryString(filters)}`, identity, { signal }))
}

export async function loadOperationActionItems(identity: ApiIdentity, signal: AbortSignal, filters: { businessDate?: string; orgUnitId?: string; status?: string }) {
  const endpoint = `${operationsBase}/action-items${queryString(filters)}`
  const payload = await featureApiRequest<unknown[] | PageEnvelope<unknown>>(endpoint, identity, { signal })
  return requireItems(payload, endpoint).map((value, index) => {
    const item = row(value)
    return {
      ...item,
      id: text(item.id, `action-item:${index}`),
      actionType: text(item.actionType, 'VIEW_SOURCE'),
      title: text(item.title, '未命名行动项'),
      description: text(item.description) || undefined,
      severity: text(item.severity) || undefined,
      sourceType: text(item.sourceType),
      sourceId: text(item.sourceId),
      ownerName: text(item.ownerName) || undefined,
      dueAt: text(item.dueAt) || undefined,
      escalationLevel: count(item.escalationLevel),
      syncStatus: text(item.syncStatus) || undefined,
      allowedActions: Array.isArray(item.allowedActions) ? item.allowedActions.map(String) : [],
    } as OperationActionItem
  })
}

export async function loadOperationIssues(identity: ApiIdentity, signal: AbortSignal, filters: { businessDate?: string; orgUnitId?: string; severity?: string; status?: string }) {
  const endpoint = `${operationsBase}/issues${queryString(filters)}`
  const payload = await featureApiRequest<OperationIssueSummary[] | PageEnvelope<OperationIssueSummary>>(endpoint, identity, { signal })
  return requireItems(payload, endpoint).map(normalizeIssueSummary)
}

export async function loadOperationIssue(identity: ApiIdentity, issueId: string, signal?: AbortSignal) {
  return normalizeIssueDetail(await featureApiRequest<unknown>(`${operationsBase}/issues/${encodeURIComponent(issueId)}`, identity, { signal }))
}

export async function transitionOperationIssue(identity: ApiIdentity, issue: OperationIssueDetail, command: 'confirm' | 'assign' | 'start' | 'pending-close' | 'close' | 'reopen', input: Record<string, unknown>, idempotencyKey: string) {
  return normalizeIssueDetail(await featureApiMutation<unknown>(`${operationsBase}/issues/${encodeURIComponent(issue.id)}/actions/${command}`, identity, {
    body: { ...input, actorAssignmentId: requiredAssignmentId(identity) }, expectedVersion: issue.rowVersion, idempotencyKey,
  }))
}

export async function confirmTaskCandidate(identity: ApiIdentity, candidate: TaskCandidate, idempotencyKey: string) {
  return normalizeTaskCandidate(await featureApiMutation<unknown>(`/task-candidates/${encodeURIComponent(candidate.id)}/confirm`, identity, {
    body: { actorAssignmentId: requiredAssignmentId(identity) }, expectedVersion: candidate.rowVersion, idempotencyKey,
  }))
}

export async function createTaskCandidate(identity: ApiIdentity, input: { sourceIssueId: string; title: string; description: string; priority: string; dueAt?: string; assigneeAssignmentId: string; reviewerAssignmentId: string }, idempotencyKey: string) {
  return normalizeTaskCandidate(await featureApiMutation<unknown>('/task-candidates', identity, { body: { ...input, createdByAssignmentId: requiredAssignmentId(identity) }, idempotencyKey }))
}

export async function rejectTaskCandidate(identity: ApiIdentity, candidate: TaskCandidate, reason: string, idempotencyKey: string) {
  return normalizeTaskCandidate(await featureApiMutation<unknown>(`/task-candidates/${encodeURIComponent(candidate.id)}/reject`, identity, {
    body: { reason, actorAssignmentId: requiredAssignmentId(identity) }, expectedVersion: candidate.rowVersion, idempotencyKey,
  }))
}

export async function retryTaskCandidateSync(identity: ApiIdentity, candidate: TaskCandidate, idempotencyKey: string) {
  return normalizeTaskCandidate(await featureApiMutation<unknown>(`/task-candidates/${encodeURIComponent(candidate.id)}/sync`, identity, {
    body: { actorAssignmentId: requiredAssignmentId(identity) }, expectedVersion: candidate.rowVersion, idempotencyKey,
  }))
}

export async function loadOperationSnapshots(identity: ApiIdentity, signal: AbortSignal, filters: { businessDate?: string; orgUnitId?: string }) {
  const endpoint = `/daily-operation-snapshots${queryString(filters)}`
  const payload = await featureApiRequest<OperationSnapshotSummary[] | PageEnvelope<OperationSnapshotSummary>>(endpoint, identity, { signal })
  return requireItems(payload, endpoint)
}

export async function loadOperationSnapshot(identity: ApiIdentity, snapshotId: string, signal?: AbortSignal) {
  const result = await featureApiRequest<OperationSnapshotDetail>(`/daily-operation-snapshots/${encodeURIComponent(snapshotId)}`, identity, { signal })
  return { ...result, overview: normalizeOverview(result.overview) }
}

export function retryOperationSnapshot(identity: ApiIdentity, snapshot: OperationSnapshotSummary, idempotencyKey: string) {
  return featureApiMutation<OperationSnapshotSummary>(`/daily-operation-snapshots/${encodeURIComponent(snapshot.id)}/retry`, identity, {
    body: {}, expectedVersion: snapshot.rowVersion, idempotencyKey,
  })
}

export async function loadOperationExports(identity: ApiIdentity, signal: AbortSignal) {
  const payload = await featureApiRequest<OperationExport[] | PageEnvelope<OperationExport>>(`${operationsBase}/exports`, identity, { signal })
  return requireItems(payload, `${operationsBase}/exports`)
}

export function createOperationExport(identity: ApiIdentity, input: { exportType: string; businessDate: string; orgUnitId?: string; includeSensitive: boolean }, idempotencyKey: string) {
  return featureApiMutation<OperationExport>(`${operationsBase}/exports`, identity, { body: { ...input, actorAssignmentId: requiredAssignmentId(identity) }, idempotencyKey })
}

export function decideAiRecommendation(identity: ApiIdentity, recommendationId: string, decision: 'ACCEPTED' | 'PARTIALLY_ACCEPTED' | 'REJECTED' | 'REPORTED_INCORRECT', note: string, idempotencyKey: string) {
  return featureApiMutation(`/ai/recommendations/${encodeURIComponent(recommendationId)}/decisions`, identity, {
    body: { decision, note, actorAssignmentId: requiredAssignmentId(identity) }, idempotencyKey,
  })
}
