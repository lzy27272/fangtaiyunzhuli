import { apiBlob, apiRequest, asList, demoFallbackEnabled, demoOnlyEnabled, type ApiIdentity } from './client'
import type {
  ApiSource,
  DashboardMetric,
  DashboardRisk,
  EnterpriseTemplate,
  EnterpriseTemplateType,
  HotelDashboard,
  IdentitySnapshot,
  ManagementRule,
  ManagementTask,
  NotificationItem,
  OperationsDashboard,
  OperationsHotel,
  RuleDetail,
  RuleScope,
  RuleVersionDetail,
  RuleVersionDraft,
  StandardEvaluation,
  TeamWorkCase,
  TaskTimelineItem,
  TaskEvidence,
  WorkExpectation,
  WorkPackage,
  WorkRecordAttachment,
  WorkRecordDetail,
  WorkRecordSummary,
  WorkStandardReference,
} from '../domain'

type JsonObject = Record<string, unknown>

const object = (value: unknown): JsonObject => value && typeof value === 'object' ? value as JsonObject : {}
const value = (item: JsonObject, ...keys: string[]): unknown => {
  for (const key of keys) if (item[key] !== undefined && item[key] !== null) return item[key]
  return undefined
}
const text = (item: JsonObject, keys: string[], fallback = '—') => String(value(item, ...keys) ?? fallback)
const number = (item: JsonObject, keys: string[], fallback = 0) => Number(value(item, ...keys) ?? fallback)

function jsonColumn(raw: unknown): unknown {
  if (typeof raw === 'string') {
    try { return JSON.parse(raw) } catch { return raw }
  }
  const wrapped = object(raw)
  if (typeof wrapped.value === 'string' && (wrapped.type === 'jsonb' || wrapped.type === 'json')) {
    try { return JSON.parse(wrapped.value) } catch { return raw }
  }
  return raw
}

export async function loadIdentity(identity: ApiIdentity, fallback: IdentitySnapshot) {
  return withFallback(async () => {
    const raw = object(await apiRequest<unknown>('/iam/me', identity))
    const account = object(raw.account)
    const employee = object(raw.employee)
    const assignments = asList<JsonObject>(value(raw, 'positionAssignments', 'assignments'))
    return {
      accountId: text(account, ['id'], identity.actorId),
      displayName: text(account, ['displayName', 'display_name'], '当前用户'),
      employeeId: text(employee, ['id'], '') || undefined,
      employeeName: text(employee, ['name'], '') || undefined,
      primaryRoleCode: text(raw, ['primaryRole', 'primaryRoleCode', 'primary_role_code', 'roleCode'], identity.roleCode),
      roleCodes: asList<string>(value(raw, 'roles', 'roleCodes')),
      permissions: asList<string>(raw.permissions),
      tenantScope: Boolean(value(raw, 'tenantScope', 'tenant_scope')),
      orgScopes: asList<string>(value(raw, 'organizationScopes', 'orgScopes')),
      assignments: assignments.map((item) => ({
        id: text(item, ['id']), orgUnitId: text(item, ['organizationId', 'orgUnitId', 'org_unit_id']),
        orgName: text(item, ['organizationName', 'orgName', 'org_name']), positionId: text(item, ['positionId', 'position_id']),
        positionCode: text(item, ['positionCode', 'position_code']), positionName: text(item, ['positionName', 'position_name']),
        primary: Boolean(value(item, 'primary', 'isPrimary', 'is_primary')),
        assignmentType: text(item, ['assignmentType', 'assignment_type'], 'PERMANENT'),
      })),
    } satisfies IdentitySnapshot
  }, fallback)
}

type DemoExport =
  | 'demoWorkPackages'
  | 'demoExpectations'
  | 'demoRules'
  | 'demoTasks'
  | 'demoEvaluations'
  | 'demoNotifications'
  | 'demoHotelDashboard'
  | 'demoOperationsDashboard'

async function demoValue<T>(name: DemoExport): Promise<T> {
  const module = await import('../data/demo')
  return module[name] as T
}

async function withFallback<T>(request: () => Promise<T>, fallback: T | (() => Promise<T>)): Promise<{ data: T; source: ApiSource }> {
  if (demoOnlyEnabled) {
    return { data: typeof fallback === 'function' ? await (fallback as () => Promise<T>)() : fallback, source: 'demo' }
  }
  try {
    return { data: await request(), source: 'api' }
  } catch (error) {
    if (!demoFallbackEnabled) throw error
    return { data: typeof fallback === 'function' ? await (fallback as () => Promise<T>)() : fallback, source: 'demo' }
  }
}

export async function loadWorkPackages(identity: ApiIdentity) {
  return withFallback(async () => {
    const payload = await apiRequest<unknown>('/work-packages?page=0&size=100', identity)
    return asList<JsonObject>(payload).map((item): WorkPackage => ({
      id: text(item, ['id']), code: text(item, ['code']), name: text(item, ['name', 'title']),
      positionName: text(item, ['positionName', 'position_name', 'targetPositionName'], '全部岗位'),
      versionNo: number(item, ['versionNo', 'version_no', 'currentVersionNo'], 1),
      lifecycleStatus: text(item, ['lifecycleStatus', 'lifecycle_status', 'status'], 'DRAFT'),
      scopeName: text(item, ['scopeName', 'scope_name', 'applicableScope', 'owner_org_unit_name'], '租户范围'),
      completionRate: value(item, 'completionRate', 'completion_rate') === undefined ? undefined : number(item, ['completionRate', 'completion_rate']),
      itemCount: value(item, 'itemCount', 'item_count') === undefined ? undefined : number(item, ['itemCount', 'item_count']),
      updatedAt: text(item, ['updatedAt', 'updated_at'], ''),
    }))
  }, () => demoValue<WorkPackage[]>('demoWorkPackages'))
}

function normalizeExpectation(item: JsonObject): WorkExpectation {
  const standards = asList<JsonObject>(item.standards).map((standard): WorkStandardReference => ({
    standardVersionId: text(standard, ['standardVersionId', 'standard_version_id']),
    usageType: text(standard, ['usageType', 'usage_type'], 'EXECUTION'),
    standardCode: text(standard, ['standardCode', 'standard_code']),
    title: text(standard, ['title', 'standardTitle', 'standard_title'], '已发布标准'),
    versionNo: number(standard, ['standardVersionNo', 'standard_version_no', 'versionNo'], 1),
  }))
  const records = asList<JsonObject>(item.records).map((record): WorkRecordSummary => ({
    id: text(record, ['id']),
    status: text(record, ['status'], 'SUBMITTED'),
    attemptNo: number(record, ['attemptNo', 'attempt_no'], 1),
    submittedAt: text(record, ['submittedAt', 'submitted_at'], '') || undefined,
    reviewedAt: text(record, ['reviewedAt', 'reviewed_at'], '') || undefined,
    reviewReason: text(record, ['reviewReason', 'review_reason'], '') || undefined,
  }))
  return {
    id: text(item, ['id']),
    title: text(item, ['title', 'expectationTitle', 'workItemName', 'itemName', 'item_name'], '岗位工作'),
    packageName: text(item, ['packageName', 'workPackageName', 'work_package_name'], '工作包'),
    itemName: text(item, ['itemName', 'workItemName', 'work_item_name'], '工作项'),
    status: text(item, ['status'], 'PENDING'),
    businessDate: text(item, ['businessDate', 'business_date'], ''),
    dueAt: text(item, ['dueAt', 'due_at'], '') || undefined,
    targetOrgName: text(item, ['targetOrgName', 'targetOrgUnitName', 'orgUnitName', 'target_org_name', 'target_org_unit_name'], '当前组织'),
    assigneeName: text(item, ['assigneeName', 'employeeName', 'employee_name', 'assignee_name'], '当前负责人'),
    assignmentId: text(item, ['assignmentId', 'employeePositionAssignmentId', 'positionAssignmentId', 'assignment_id', 'position_assignment_id'], '') || undefined,
    orgUnitId: text(item, ['orgUnitId', 'targetOrgUnitId', 'org_unit_id', 'target_org_unit_id'], '') || undefined,
    employeeId: text(item, ['employeeId', 'employee_id'], '') || undefined,
    formVersionId: text(item, ['formVersionId', 'form_version_id'], '') || undefined,
    formCode: text(item, ['formCode', 'form_code'], '') || undefined,
    formName: text(item, ['formName', 'form_name'], '') || undefined,
    formSchema: (() => {
      const raw = jsonColumn(value(item, 'formSchema', 'form_schema'))
      return raw && typeof raw === 'object' ? raw as WorkExpectation['formSchema'] : undefined
    })(),
    workPackageVersionId: text(item, ['workPackageVersionId', 'work_package_version_id'], '') || undefined,
    workPackageItemId: text(item, ['workPackageItemId', 'work_package_item_id'], '') || undefined,
    recordId: text(item, ['recordId', 'workRecordId', 'record_id'], '') || records[0]?.id,
    rowVersion: value(item, 'rowVersion', 'row_version') === undefined ? undefined : number(item, ['rowVersion', 'row_version']),
    evaluationOutcome: text(item, ['evaluationOutcome', 'evaluation_outcome'], '') || undefined,
    standards,
    records,
    submissionPolicy: (() => {
      const raw = object(jsonColumn(value(item, 'submissionPolicy', 'submission_policy')))
      return {
        completionStatementRequired: raw.completionStatementRequired !== false,
        exceptionStatementRequired: raw.exceptionStatementRequired === true,
        nextActionRequired: raw.nextActionRequired === true,
        attachmentRequired: raw.attachmentRequired === true,
        maxAttachments: Number(raw.maxAttachments ?? 10),
        maxFileSizeBytes: Number(raw.maxFileSizeBytes ?? 20 * 1024 * 1024),
        allowedExtensions: asList<string>(raw.allowedExtensions).length
          ? asList<string>(raw.allowedExtensions)
          : ['jpg', 'jpeg', 'png', 'pdf', 'docx', 'xlsx'],
      }
    })(),
  }
}

export async function loadExpectation(identity: ApiIdentity, id: string, fallback: WorkExpectation) {
  return withFallback(async () => normalizeExpectation(object(await apiRequest<unknown>(`/work-expectations/${id}`, identity))), fallback)
}

export async function loadMyWork(identity: ApiIdentity) {
  return withFallback(async () => {
    const payload = await apiRequest<unknown>('/my/work-expectations?page=0&size=100', identity)
    return asList<JsonObject>(payload).map(normalizeExpectation)
  }, () => demoValue<WorkExpectation[]>('demoExpectations'))
}

export async function loadTeamWork(identity: ApiIdentity) {
  return withFallback(async () => {
    const payload = await apiRequest<unknown>('/team/work-expectations?page=0&size=100', identity)
    return asList<JsonObject>(payload).map(normalizeExpectation)
  }, () => demoValue<WorkExpectation[]>('demoExpectations'))
}

function normalizeAttachment(item: JsonObject): WorkRecordAttachment {
  return {
    id: text(item, ['id']),
    objectKey: text(item, ['objectKey', 'object_key'], '') || undefined,
    originalName: text(item, ['originalName', 'original_name'], '现场图片'),
    mediaType: text(item, ['mediaType', 'media_type'], 'application/octet-stream'),
    sizeBytes: number(item, ['sizeBytes', 'size_bytes'], 0),
    sha256: text(item, ['sha256'], '') || undefined,
    scanStatus: text(item, ['scanStatus', 'scan_status'], 'PENDING'),
    createdAt: text(item, ['createdAt', 'created_at'], '') || undefined,
  }
}

function normalizeWorkRecord(item: JsonObject): WorkRecordDetail {
  const rawPayload = value(item, 'payload')
  return {
    id: text(item, ['id']),
    status: text(item, ['status'], 'SUBMITTED'),
    rowVersion: number(item, ['rowVersion', 'row_version'], 0),
    businessDate: text(item, ['businessDate', 'business_date'], '') || undefined,
    payload: rawPayload && typeof rawPayload === 'object' ? rawPayload as Record<string, unknown> : {},
    employeeName: text(item, ['employeeName', 'employee_name'], '提交员工'),
    positionName: text(item, ['positionName', 'position_name'], '执行岗位'),
    formName: text(item, ['formName', 'form_name'], '岗位工作记录'),
    targetOrgName: text(item, ['targetOrgUnitName', 'target_org_unit_name', 'targetOrgName'], '当前组织'),
    targetOrgUnitId: text(item, ['targetOrgUnitId', 'target_org_unit_id'], '') || undefined,
    positionAssignmentId: text(item, ['positionAssignmentId', 'position_assignment_id'], '') || undefined,
    workExpectationId: text(item, ['workExpectationId', 'work_expectation_id'], '') || undefined,
    completionStatement: text(item, ['completionStatement', 'completion_statement'], '') || undefined,
    exceptionStatement: text(item, ['exceptionStatement', 'exception_statement'], '') || undefined,
    nextAction: text(item, ['nextAction', 'next_action'], '') || undefined,
    reviewReason: text(item, ['reviewReason', 'review_reason'], '') || undefined,
    submittedAt: text(item, ['submittedAt', 'submitted_at'], '') || undefined,
    reviewedAt: text(item, ['reviewedAt', 'reviewed_at'], '') || undefined,
    attachments: asList<JsonObject>(item.attachments).map(normalizeAttachment),
    supplements: asList<JsonObject>(item.supplements).map((supplement) => ({
      id: text(supplement, ['id']),
      submittedByAssignmentId: text(supplement, ['submittedByAssignmentId', 'submitted_by_assignment_id']),
      submittedByName: text(supplement, ['submittedByName', 'submitted_by_name'], '提交人'),
      content: text(supplement, ['content']),
      createdAt: text(supplement, ['createdAt', 'created_at'], '') || undefined,
    })),
  }
}

function demoRecord(expectation: WorkExpectation): WorkRecordDetail | undefined {
  if (!['SUBMITTED', 'COMPLETED', 'SATISFIED', 'FAILED'].includes(expectation.status) && !expectation.recordId) return undefined
  return {
    id: expectation.recordId ?? `record-${expectation.id}`,
    status: expectation.status === 'COMPLETED' ? 'APPROVED' : 'SUBMITTED',
    rowVersion: 0,
    businessDate: expectation.businessDate,
    payload: { summary: `${expectation.itemName}已完成现场记录`, issues: expectation.evaluationOutcome === 'FAIL' ? 2 : 0 },
    employeeName: expectation.assigneeName,
    positionName: '当前岗位',
    formName: expectation.packageName,
    targetOrgName: expectation.targetOrgName,
    targetOrgUnitId: expectation.orgUnitId,
    positionAssignmentId: expectation.assignmentId,
    workExpectationId: expectation.id,
    completionStatement: '已完成现场记录',
    submittedAt: new Date().toISOString(),
    attachments: [{
      id: `attachment-${expectation.id}`,
      originalName: '现场检查照片.jpg',
      mediaType: 'image/jpeg',
      sizeBytes: 842_116,
      scanStatus: 'CLEAN',
      createdAt: new Date().toISOString(),
    }],
    supplements: [],
  }
}

export async function createWorkRecordDraft(identity: ApiIdentity, input: Record<string, unknown>) {
  return apiRequest<Record<string, unknown>>('/work-data/records', identity, {
    method: 'POST',
    headers: { 'Idempotency-Key': crypto.randomUUID() },
    body: JSON.stringify({ ...input, saveAsDraft: true }),
  })
}

export async function submitWorkRecordDraft(identity: ApiIdentity, recordId: string, expectedVersion: number) {
  return apiRequest(`/work-data/records/${recordId}/actions/submit`, identity, {
    method: 'POST',
    headers: { 'Idempotency-Key': crypto.randomUUID() },
    body: JSON.stringify({ expectedVersion }),
  })
}

export async function updateWorkRecordDraft(identity: ApiIdentity, recordId: string, input: {
  payload: Record<string, unknown>; completionStatement: string; exceptionStatement?: string
  nextAction?: string; expectedVersion: number
}) {
  return apiRequest<Record<string, unknown>>(`/work-data/records/${recordId}`, identity, {
    method: 'PUT',
    body: JSON.stringify({ ...input, occurredAt: new Date().toISOString() }),
  })
}

export async function addWorkRecordSupplement(identity: ApiIdentity, recordId: string, assignmentId: string, content: string) {
  return apiRequest(`/work-data/records/${recordId}/supplements`, identity, {
    method: 'POST',
    body: JSON.stringify({ submittedByAssignmentId: assignmentId, content }),
  })
}

export async function loadWorkRecord(identity: ApiIdentity, recordId: string, fallback?: WorkRecordDetail) {
  return withFallback(async () => {
    const record = normalizeWorkRecord(object(await apiRequest<unknown>(`/work-data/records/${recordId}`, identity)))
    const attachments = await apiRequest<unknown>(`/work-data/records/${recordId}/attachments`, identity).catch(() => record.attachments)
    record.attachments = asList<JsonObject>(attachments).map(normalizeAttachment)
    return record
  }, fallback ?? normalizeWorkRecord({ id: recordId }))
}

export async function loadTeamWorkCase(identity: ApiIdentity, initial: WorkExpectation) {
  return withFallback<TeamWorkCase>(async () => {
    const expectation = normalizeExpectation(object(await apiRequest<unknown>(`/work-expectations/${initial.id}`, identity)))
    const recordId = expectation.recordId ?? expectation.records?.[0]?.id
    const record = recordId ? normalizeWorkRecord(object(await apiRequest<unknown>(`/work-data/records/${recordId}`, identity))) : undefined
    if (record) {
      const attachments = await apiRequest<unknown>(`/work-data/records/${record.id}/attachments`, identity).catch(() => record.attachments)
      record.attachments = asList<JsonObject>(attachments).map(normalizeAttachment)
    }
    return { expectation, record }
  }, { expectation: initial, record: demoRecord(initial) })
}

export async function reviewWorkRecord(identity: ApiIdentity, recordId: string, outcome: 'APPROVED' | 'REJECTED', reason: string, expectedVersion: number) {
  return apiRequest(`/work-data/records/${recordId}/actions/review`, identity, {
    method: 'POST',
    headers: { 'Idempotency-Key': crypto.randomUUID() },
    body: JSON.stringify({ outcome, reason: reason || null, expectedVersion }),
  })
}

export async function uploadWorkRecordAttachment(identity: ApiIdentity, recordId: string, file: File) {
  const form = new FormData()
  form.append('file', file, file.name)
  return apiRequest(`/work-data/records/${recordId}/attachments/upload`, identity, {
    method: 'POST',
    headers: { 'Idempotency-Key': crypto.randomUUID() },
    body: form,
  })
}

export async function deleteWorkRecordAttachment(identity: ApiIdentity, recordId: string, attachmentId: string) {
  return apiRequest(`/work-data/records/${recordId}/attachments/${attachmentId}`, identity, { method: 'DELETE' })
}

export async function loadAttachmentContent(identity: ApiIdentity, attachmentId: string) {
  return apiBlob(`/work-data/attachments/${attachmentId}/content`, identity)
}

export async function createCorrectiveTask(identity: ApiIdentity, input: {
  orgUnitId: string
  assigneeAssignmentId: string
  reviewerAssignmentId: string
  standardVersionId?: string
  workRecordId: string
  title: string
  description: string
  priority: string
  dueAt?: string
}) {
  return apiRequest('/tasks', identity, {
    method: 'POST',
    headers: { 'Idempotency-Key': crypto.randomUUID() },
    body: JSON.stringify({ ...input, sourceSnapshot: { source: 'TEAM_WORK_REVIEW', workRecordId: input.workRecordId } }),
  })
}

export async function createWorkRecordEvaluation(identity: ApiIdentity, input: {
  record: WorkRecordDetail
  standardVersionId: string
}) {
  if (!input.record.targetOrgUnitId) throw new Error('工作记录缺少目标组织，不能创建标准评价。')
  return apiRequest('/standard-evaluations', identity, {
    method: 'POST',
    headers: { 'Idempotency-Key': crypto.randomUUID() },
    body: JSON.stringify({
      subjectType: 'WORK_RECORD',
      subjectId: input.record.id,
      orgUnitId: input.record.targetOrgUnitId,
      positionAssignmentId: input.record.positionAssignmentId,
      standardVersionId: input.standardVersionId,
      inputSnapshot: input.record.payload,
    }),
  })
}

export async function loadRules(identity: ApiIdentity) {
  return withFallback(async () => {
    const payload = await apiRequest<unknown>('/rules?page=0&size=100', identity)
    return asList<JsonObject>(payload).map((item): ManagementRule => ({
      id: text(item, ['id']), code: text(item, ['code']), name: text(item, ['name', 'title']),
      status: text(item, ['lifecycleStatus', 'lifecycle_status', 'status'], 'DRAFT'),
      versionNo: number(item, ['versionNo', 'version_no', 'currentVersionNo'], 1),
      eventType: text(item, ['eventType', 'event_type', 'triggerEventType'], '—'),
      scopeName: text(item, ['scopeName', 'applicableScope'], '租户范围'),
      hitCount: value(item, 'hitCount') === undefined ? undefined : number(item, ['hitCount']),
      latestVersionId: text(item, ['latestVersionId', 'latest_version_id'], '') || undefined,
      rowVersion: value(item, 'rowVersion', 'row_version') === undefined ? undefined : number(item, ['rowVersion', 'row_version']),
    }))
  }, () => demoValue<ManagementRule[]>('demoRules'))
}

function ruleScope(item: JsonObject): RuleScope {
  return {
    scopeType: text(item, ['scopeType', 'scope_type'], 'TENANT'),
    brandId: text(item, ['brandId', 'brand_id'], '') || undefined,
    orgUnitId: text(item, ['orgUnitId', 'org_unit_id'], '') || undefined,
    positionId: text(item, ['positionId', 'position_id'], '') || undefined,
  }
}

export async function loadRuleDetail(identity: ApiIdentity, ruleId: string): Promise<RuleDetail> {
  const raw = object(await apiRequest<unknown>(`/rules/${ruleId}`, identity))
  const scopes = asList<JsonObject>(raw.scopes)
  const scopesByVersion = new Map<string, RuleScope[]>()
  for (const item of scopes) {
    const versionId = text(item, ['ruleVersionId', 'rule_version_id'], '')
    if (!versionId) continue
    scopesByVersion.set(versionId, [...(scopesByVersion.get(versionId) ?? []), ruleScope(item)])
  }
  const versions = asList<JsonObject>(raw.versions).map((item): RuleVersionDetail => {
    const id = text(item, ['id'])
    const conditionValue = jsonColumn(value(item, 'conditionAst', 'condition_ast'))
    const actionValue = jsonColumn(value(item, 'actions'))
    return {
      id,
      versionNo: number(item, ['versionNo', 'version_no'], 1),
      lifecycleStatus: text(item, ['lifecycleStatus', 'lifecycle_status'], 'DRAFT'),
      conditionAst: object(conditionValue),
      actions: asList<Record<string, unknown>>(actionValue),
      priority: number(item, ['priority'], 100),
      cooldownMinutes: number(item, ['cooldownMinutes', 'cooldown_minutes'], 0),
      rowVersion: number(item, ['rowVersion', 'row_version'], 0),
      effectiveFrom: text(item, ['effectiveFrom', 'effective_from'], '') || undefined,
      effectiveTo: text(item, ['effectiveTo', 'effective_to'], '') || undefined,
      scopes: scopesByVersion.get(id) ?? [{ scopeType: 'TENANT' }],
    }
  })
  return {
    id: text(raw, ['id']), code: text(raw, ['code']), name: text(raw, ['name']),
    eventType: text(raw, ['eventType', 'event_type']), description: text(raw, ['description'], '') || undefined,
    status: text(raw, ['status'], 'ACTIVE'), versions,
  }
}

export async function createRuleWithVersion(identity: ApiIdentity, definition: {
  code: string
  name: string
  eventType: string
  description?: string
}, version: RuleVersionDraft): Promise<string> {
  const created = object(await apiRequest<unknown>('/rules', identity, {
    method: 'POST', headers: { 'Idempotency-Key': crypto.randomUUID() }, body: JSON.stringify(definition),
  }))
  const ruleId = text(created, ['id'], '')
  if (!ruleId) throw new Error('规则已创建，但服务端未返回规则ID。')
  await apiRequest(`/rules/${ruleId}/versions`, identity, {
    method: 'POST', headers: { 'Idempotency-Key': crypto.randomUUID() }, body: JSON.stringify(version),
  })
  return ruleId
}

export async function saveRuleVersion(identity: ApiIdentity, ruleId: string, current: RuleVersionDetail, version: RuleVersionDraft) {
  if (current.lifecycleStatus === 'DRAFT') {
    return apiRequest(`/rules/${ruleId}/versions/${current.id}`, identity, {
      method: 'PUT', body: JSON.stringify({ ...version, expectedVersion: current.rowVersion }),
    })
  }
  return apiRequest(`/rules/${ruleId}/versions`, identity, {
    method: 'POST', headers: { 'Idempotency-Key': crypto.randomUUID() }, body: JSON.stringify(version),
  })
}

export async function publishRuleVersion(identity: ApiIdentity, ruleId: string, version: RuleVersionDetail) {
  return apiRequest(`/rules/${ruleId}/versions/${version.id}/publish`, identity, {
    method: 'POST', headers: { 'Idempotency-Key': crypto.randomUUID() },
    body: JSON.stringify({ expectedVersion: version.rowVersion, effectiveFrom: new Date().toISOString() }),
  })
}

function normalizeTimeline(payload: unknown): TaskTimelineItem[] {
  return asList<JsonObject>(payload).map((item): TaskTimelineItem => ({
    id: text(item, ['id']), command: text(item, ['command', 'action']),
    fromStatus: text(item, ['fromStatus', 'from_status'], '') || undefined,
    toStatus: text(item, ['toStatus', 'to_status'], '—'), actorName: text(item, ['actorName', 'actor_name'], '系统'),
    occurredAt: text(item, ['occurredAt', 'occurred_at', 'createdAt'], ''),
    remark: text(item, ['remark', 'reason'], '') || undefined,
  }))
}

function normalizeTask(item: JsonObject): ManagementTask {
  const participants = asList<JsonObject>(item.participants)
  const participantName = (kind: string) => {
    const participant = participants.find((row) => text(row, ['participantType', 'participant_type'], '') === kind)
    const employee = object(value(participant ?? {}, 'employeeSnapshot', 'employee_snapshot'))
    return participant ? text(employee, ['name', 'employeeName'], '待解析') : '待解析'
  }
  const participantId = (kind: string) => {
    const participant = participants.find((row) => text(row, ['participantType', 'participant_type'], '') === kind)
    return participant ? text(participant, ['positionAssignmentId', 'position_assignment_id'], '') || undefined : undefined
  }
  const evidence = asList<JsonObject>(item.evidence).map((row): TaskEvidence => ({
    id: text(row, ['id']),
    submittedByAssignmentId: text(row, ['submittedByAssignmentId', 'submitted_by_assignment_id'], '') || undefined,
    evidenceType: text(row, ['evidenceType', 'evidence_type'], 'FILE'),
    objectKey: text(row, ['objectKey', 'object_key'], '') || undefined,
    originalName: text(row, ['originalName', 'original_name'], '') || undefined,
    mediaType: text(row, ['mediaType', 'media_type'], '') || undefined,
    sizeBytes: value(row, 'sizeBytes', 'size_bytes') === undefined ? undefined : number(row, ['sizeBytes', 'size_bytes']),
    scanStatus: text(row, ['scanStatus', 'scan_status'], 'PENDING'),
    createdAt: text(row, ['createdAt', 'created_at'], '') || undefined,
  }))
  return {
    id: text(item, ['id']), code: text(item, ['code', 'taskNo', 'task_no']), title: text(item, ['title', 'name']),
    status: text(item, ['status', 'lifecycleStatus', 'lifecycle_status'], 'PROPOSED'), slaStatus: text(item, ['slaStatus', 'sla_status'], 'ON_TIME'),
    priority: text(item, ['priority'], 'NORMAL'), assigneeName: text(item, ['assigneeName', 'assignee_name', 'responsibleName'], participantName('ASSIGNEE')),
    reviewerName: text(item, ['reviewerName', 'reviewer_name', 'acceptanceOwnerName'], participantName('REVIEWER')),
    assigneeAssignmentId: text(item, ['assigneeAssignmentId', 'assignee_assignment_id'], '') || participantId('ASSIGNEE'),
    reviewerAssignmentId: text(item, ['reviewerAssignmentId', 'reviewer_assignment_id'], '') || participantId('REVIEWER'),
    targetOrgName: text(item, ['targetOrgName', 'orgUnitName', 'org_unit_name', 'org_unit_id'], '当前组织'),
    targetOrgUnitId: text(item, ['targetOrgUnitId', 'orgUnitId', 'org_unit_id'], '') || undefined,
    standardVersionId: text(item, ['standardVersionId', 'standard_version_id'], '') || undefined,
    resultSnapshot: (() => {
      const raw = value(item, 'resultSnapshot', 'result_snapshot')
      return raw && typeof raw === 'object' ? raw as Record<string, unknown> : undefined
    })(),
    sourceType: text(item, ['sourceType', 'source_type'], 'MANUAL'),
    sourceTitle: text(item, ['sourceTitle', 'source_title'], '') || undefined,
    description: text(item, ['description', 'requirement'], '') || undefined,
    dueAt: text(item, ['dueAt', 'due_at'], '') || undefined,
    version: number(item, ['version', 'lockVersion', 'row_version'], 0),
    evaluationId: text(item, ['evaluationId', 'standardEvaluationId'], '') || undefined,
    timeline: value(item, 'timeline', 'transitions') ? normalizeTimeline(value(item, 'timeline', 'transitions')) : undefined,
    evidence,
  }
}

export async function createManagementTask(identity: ApiIdentity, input: Record<string, unknown>) {
  return apiRequest<Record<string, unknown>>('/tasks', identity, {
    method: 'POST',
    headers: { 'Idempotency-Key': crypto.randomUUID() },
    body: JSON.stringify(input),
  })
}

export async function uploadTaskEvidence(identity: ApiIdentity, taskId: string, assignmentId: string, file: File) {
  const form = new FormData()
  form.append('file', file, file.name)
  return apiRequest(`/tasks/${taskId}/evidence/upload?submittedByAssignmentId=${encodeURIComponent(assignmentId)}`, identity, {
    method: 'POST', body: form,
  })
}

export async function deleteTaskEvidence(identity: ApiIdentity, taskId: string, evidenceId: string, assignmentId: string) {
  return apiRequest(`/tasks/${taskId}/evidence/${evidenceId}?actorAssignmentId=${encodeURIComponent(assignmentId)}`, identity, { method: 'DELETE' })
}

export async function loadTaskEvidenceContent(identity: ApiIdentity, taskId: string, evidenceId: string) {
  return apiBlob(`/tasks/${taskId}/evidence/${evidenceId}/content`, identity)
}

function normalizeEnterpriseTemplate(item: JsonObject): EnterpriseTemplate {
  const configuration = jsonColumn(value(item, 'configuration'))
  const publishedConfiguration = jsonColumn(value(item, 'publishedConfiguration', 'published_configuration'))
  return {
    id: text(item, ['id']),
    templateType: text(item, ['templateType', 'template_type'], 'TASK') as EnterpriseTemplateType,
    code: text(item, ['code']),
    name: text(item, ['name']),
    description: text(item, ['description'], '') || undefined,
    positionName: text(item, ['positionName', 'position_name'], '') || undefined,
    ownerOrgName: text(item, ['ownerOrgUnitName', 'owner_org_unit_name'], '') || undefined,
    latestVersionId: text(item, ['latestVersionId', 'latest_version_id'], '') || undefined,
    versionNo: number(item, ['versionNo', 'version_no'], 0),
    lifecycleStatus: text(item, ['lifecycleStatus', 'lifecycle_status'], 'DRAFT'),
    configuration: configuration && typeof configuration === 'object' ? configuration as Record<string, unknown> : {},
    publishedVersionId: text(item, ['publishedVersionId', 'published_version_id'], '') || undefined,
    publishedVersionNo: value(item, 'publishedVersionNo', 'published_version_no') === undefined ? undefined : number(item, ['publishedVersionNo', 'published_version_no']),
    publishedConfiguration: publishedConfiguration && typeof publishedConfiguration === 'object' ? publishedConfiguration as Record<string, unknown> : undefined,
    rowVersion: number(item, ['rowVersion', 'row_version'], 0),
  }
}

export async function loadEnterpriseTemplates(identity: ApiIdentity, type?: EnterpriseTemplateType) {
  const payload = await apiRequest<unknown>(`/templates${type ? `?type=${type}` : ''}`, identity)
  return asList<JsonObject>(payload).map(normalizeEnterpriseTemplate)
}

export async function createEnterpriseTemplate(identity: ApiIdentity, input: {
  templateType: EnterpriseTemplateType; code: string; name: string; description?: string
  targetPositionId?: string; ownerOrgUnitId?: string; configuration: Record<string, unknown>
}) {
  return apiRequest<Record<string, unknown>>('/templates', identity, { method: 'POST', body: JSON.stringify(input) })
}

export async function saveEnterpriseTemplateVersion(identity: ApiIdentity, template: EnterpriseTemplate, configuration: Record<string, unknown>) {
  if (template.latestVersionId && template.lifecycleStatus === 'DRAFT') {
    return apiRequest(`/templates/${template.id}/versions/${template.latestVersionId}`, identity, {
      method: 'PUT', body: JSON.stringify({ configuration, expectedVersion: template.rowVersion }),
    })
  }
  return apiRequest(`/templates/${template.id}/versions`, identity, { method: 'POST', body: JSON.stringify({ configuration }) })
}

export async function publishEnterpriseTemplate(identity: ApiIdentity, templateId: string, versionId: string) {
  return apiRequest(`/templates/${templateId}/versions/${versionId}/publish`, identity, {
    method: 'POST', body: JSON.stringify({ effectiveFrom: new Date().toISOString() }),
  })
}

export async function loadTasks(identity: ApiIdentity, team = false) {
  return withFallback(async () => {
    const payload = await apiRequest<unknown>(`/tasks?view=${team ? 'team' : 'mine'}&page=0&size=100`, identity)
    return asList<JsonObject>(payload).map(normalizeTask)
  }, () => demoValue<ManagementTask[]>('demoTasks'))
}

export async function loadTask(identity: ApiIdentity, id: string, fallback?: ManagementTask) {
  return withFallback(async () => {
    const payload = await apiRequest<unknown>(`/tasks/${id}`, identity)
    const task = normalizeTask(object(payload))
    if (!task.timeline) {
      const timeline = await apiRequest<unknown>(`/tasks/${id}/timeline`, identity).catch(() => [])
      task.timeline = normalizeTimeline(timeline)
    }
    return task
  }, fallback ?? normalizeTask({ id }))
}

export async function createTaskEvaluation(identity: ApiIdentity, task: ManagementTask) {
  if (!task.targetOrgUnitId || !task.standardVersionId) {
    throw new Error('任务缺少目标组织或绑定标准，不能进入验收评价。')
  }
  return apiRequest('/standard-evaluations', identity, {
    method: 'POST',
    headers: { 'Idempotency-Key': crypto.randomUUID() },
    body: JSON.stringify({
      subjectType: 'TASK',
      subjectId: task.id,
      orgUnitId: task.targetOrgUnitId,
      positionAssignmentId: task.assigneeAssignmentId,
      standardVersionId: task.standardVersionId,
      inputSnapshot: task.resultSnapshot ?? {},
    }),
  })
}

function normalizeMetric(item: JsonObject): DashboardMetric {
  return {
    code: text(item, ['code']),
    name: text(item, ['name'], text(item, ['code'])),
    unit: text(item, ['unit'], ''),
    value: number(item, ['value']),
    businessDate: text(item, ['businessDate', 'business_date'], '') || undefined,
  }
}

function normalizeRisk(item: JsonObject, index: number): DashboardRisk {
  return {
    id: text(item, ['id'], `risk-${index}`),
    title: text(item, ['title', 'name', 'summary'], '待处理风险事项'),
    type: text(item, ['type', 'riskType', 'risk_type'], 'MANAGEMENT_RISK'),
    severity: text(item, ['severity', 'priority'], 'MEDIUM'),
    status: text(item, ['status'], 'OPEN'),
    source: text(item, ['source', 'sourceType', 'source_type'], '') || undefined,
    ownerName: text(item, ['ownerName', 'owner_name', 'assigneeName'], '') || undefined,
    occurredAt: text(item, ['occurredAt', 'occurred_at', 'createdAt', 'created_at'], '') || undefined,
  }
}

export async function loadHotelDashboard(identity: ApiIdentity, hotelId: string) {
  return withFallback(async () => {
    const [dashboardPayload, templatePayload] = await Promise.all([
      apiRequest<unknown>(`/dashboards/hotels/${hotelId}`, identity),
      apiRequest<unknown>('/templates?type=HOTEL_DASHBOARD', identity).catch(() => []),
    ])
    const raw = object(dashboardPayload)
    const template = asList<JsonObject>(templatePayload).find((row) => text(row, ['lifecycleStatus', 'lifecycle_status']) === 'PUBLISHED' || Boolean(value(row, 'publishedVersionId', 'published_version_id')))
    const configuration = object(jsonColumn(template
      ? text(template, ['lifecycleStatus', 'lifecycle_status']) === 'PUBLISHED'
        ? value(template, 'configuration')
        : value(template, 'publishedConfiguration', 'published_configuration')
      : {}))
    const metricCodes = new Set(asList<string>(configuration.metricCodes))
    const riskLimit = Number(configuration.riskLimit ?? 10)
    const taskLimit = Number(configuration.taskLimit ?? 20)
    const hotel = object(raw.hotel)
    return {
      hotel: {
        id: text(hotel, ['id'], hotelId),
        name: text(hotel, ['name'], '当前门店'),
        city: text(hotel, ['city'], '') || undefined,
        roomCount: value(hotel, 'roomCount', 'room_count') === undefined ? undefined : number(hotel, ['roomCount', 'room_count']),
      },
      activeEmployeeCount: number(raw, ['activeEmployeeCount', 'active_employee_count']),
      todayWorkSubmissionCount: number(raw, ['todayWorkSubmissionCount', 'today_work_submission_count']),
      latestMetrics: asList<JsonObject>(value(raw, 'latestMetrics', 'latest_metrics')).map(normalizeMetric).filter((metric) => !metricCodes.size || metricCodes.has(metric.code)),
      risks: asList<JsonObject>(value(raw, 'risks', 'riskItems', 'risk_items')).map(normalizeRisk).slice(0, riskLimit),
      incompleteTasks: asList<JsonObject>(value(raw, 'incompleteTasks', 'incomplete_tasks')).map(normalizeTask).slice(0, taskLimit),
      templateSections: asList<string>(configuration.sections),
    } satisfies HotelDashboard
  }, () => demoValue<HotelDashboard>('demoHotelDashboard'))
}

function normalizeOperationsHotel(item: JsonObject): OperationsHotel {
  return {
    id: text(item, ['id']),
    name: text(item, ['name'], '门店'),
    city: text(item, ['city'], '') || undefined,
    roomCount: value(item, 'roomCount', 'room_count') === undefined ? undefined : number(item, ['roomCount', 'room_count']),
    openTaskCount: number(item, ['openTaskCount', 'open_task_count']),
    overdueTaskCount: number(item, ['overdueTaskCount', 'overdue_task_count']),
    failedEvaluationCount: number(item, ['failedEvaluationCount', 'failed_evaluation_count']),
    missedWorkCount: number(item, ['missedWorkCount', 'missed_work_count']),
    todaySubmissionCount: number(item, ['todaySubmissionCount', 'today_submission_count']),
  }
}

export async function loadOperationsDashboard(identity: ApiIdentity) {
  return withFallback(async () => {
    const raw = object(await apiRequest<unknown>('/dashboards/operations', identity))
    return { hotels: asList<JsonObject>(raw.hotels).map(normalizeOperationsHotel) } satisfies OperationsDashboard
  }, () => demoValue<OperationsDashboard>('demoOperationsDashboard'))
}

function normalizeEvaluation(item: JsonObject): StandardEvaluation {
  return {
      id: text(item, ['id']), subjectType: text(item, ['subjectType', 'subject_type']),
      subjectTitle: text(item, ['subjectTitle', 'subject_title', 'subject_id'], '评价对象'),
      standardCode: text(item, ['standardCode', 'standard_code', 'standard_version_id']), standardTitle: text(item, ['standardTitle', 'standard_title'], '已发布标准版本'),
      standardVersion: number(item, ['standardVersion', 'versionNo', 'version_no'], 1), outcome: text(item, ['outcome'], 'PENDING'),
      score: value(item, 'score') === undefined ? undefined : number(item, ['score']), severity: text(item, ['severity'], 'LOW'),
      executionStatus: text(item, ['executionStatus', 'execution_status'], 'PENDING'),
      evaluatedAt: text(item, ['evaluatedAt', 'evaluated_at', 'completed_at', 'createdAt', 'created_at'], '') || undefined,
      targetOrgName: text(item, ['targetOrgName', 'orgUnitName', 'org_unit_name', 'org_unit_id'], '当前组织'),
      assignmentId: text(item, ['positionAssignmentId', 'position_assignment_id'], '') || undefined,
      items: Array.isArray(item.items) ? item.items.map((raw) => {
        const row = object(raw)
        return { id: text(row, ['id']), itemCode: text(row, ['itemCode', 'item_code', 'code']), itemName: text(row, ['itemName', 'item_name', 'item_code', 'name']), outcome: text(row, ['outcome']), expected: text(row, ['expected', 'expected_value'], '') || undefined, actual: text(row, ['actual', 'actual_value'], '') || undefined, score: value(row, 'score') === undefined ? undefined : number(row, ['score']), reason: text(row, ['reason'], '') || undefined }
      }) : undefined,
    }
}

export async function loadEvaluations(identity: ApiIdentity) {
  return withFallback(async () => {
    const payload = await apiRequest<unknown>('/standard-evaluations?page=0&size=100', identity)
    return asList<JsonObject>(payload).map(normalizeEvaluation)
  }, () => demoValue<StandardEvaluation[]>('demoEvaluations'))
}

export async function loadEvaluation(identity: ApiIdentity, id: string, fallback: StandardEvaluation) {
  return withFallback(async () => normalizeEvaluation(object(await apiRequest<unknown>(`/standard-evaluations/${id}`, identity))), fallback)
}

export async function loadNotifications(identity: ApiIdentity) {
  return withFallback(async () => {
    const payload = await apiRequest<unknown>('/notifications?page=0&size=100', identity)
    return asList<JsonObject>(payload).map((item): NotificationItem => ({
      id: text(item, ['id']), type: text(item, ['type', 'notification_type']), title: text(item, ['title']), content: text(item, ['content', 'message']),
      sourceType: text(item, ['sourceType', 'source_type'], '') || undefined,
      sourceId: text(item, ['sourceId', 'source_id'], '') || undefined,
      recipientAssignmentId: text(item, ['recipientAssignmentId', 'recipient_assignment_id'], '') || undefined,
      createdAt: text(item, ['createdAt', 'created_at', 'delivered_at'], ''), readAt: text(item, ['readAt', 'read_at'], '') || undefined,
      version: number(item, ['version', 'row_version'], 0),
    }))
  }, () => demoValue<NotificationItem[]>('demoNotifications'))
}
