import { useEffect, useMemo, useState } from 'react'
import { apiCommand, apiRequest, authMode, clearAccessToken, demoFallbackEnabled, hasAccessToken, login } from './api/client'
import {
  addWorkRecordSupplement,
  createWorkRecordDraft,
  createRuleWithVersion,
  createTaskEvaluation,
  deleteTaskEvidence,
  loadEvaluations,
  loadEvaluation,
  loadExpectation,
  loadIdentity,
  loadMyWork,
  loadNotifications,
  loadRuleDetail,
  loadTaskEvidenceContent,
  loadRules,
  loadTask,
  loadTasks,
  loadWorkPackages,
  loadWorkRecord,
  publishRuleVersion,
  saveRuleVersion,
  submitWorkRecordDraft,
  updateWorkRecordDraft,
  uploadTaskEvidence,
  uploadWorkRecordAttachment,
} from './api/resources'
import { roleContexts } from './data/roles'
import { HotelDashboardPage, OperationsDashboardPage, TeamWorkPage } from './P0Pages'
import { OrganizationCenter, WorkPackageCenter } from './ConfigurationPages'
import { EnterpriseTemplateCenter, TaskCreateDialog } from './Pilot6Pages'
import { product } from './product'
import type {
  ApiSource,
  IdentitySnapshot,
  ManagementRule,
  ManagementTask,
  Navigate,
  RouteParams,
  RuleDetail,
  RuleVersionDraft,
  RoleContext,
  StandardEvaluation,
  ViewId,
  WorkExpectation,
  WorkRecordDetail,
} from './domain'
import { useResource } from './useResource'

const navigation: Array<{ id: ViewId; label: string; icon: string; group?: string; permissions?: string[]; roles?: string[] }> = [
  { id: 'workbench', label: '角色工作台', icon: '⌂' },
  { id: 'hotel-dashboard', label: '门店驾驶舱', icon: '▤', group: '管理驾驶舱', permissions: ['dashboard.hotel'] },
  { id: 'operations-dashboard', label: '区域多门店', icon: '▥', group: '管理驾驶舱', roles: ['OTA_OPERATION_MANAGER'] },
  { id: 'work-packages', label: '工作包中心', icon: '▦', group: '标准与工作', permissions: ['work-package.read', 'work-package.manage', 'standard.read'] },
  { id: 'my-work', label: '我的工作', icon: '✓', permissions: ['work-record.read', 'work-record.submit', 'work.submit'] },
  { id: 'team-work', label: '团队工作', icon: '◎', permissions: ['work-record.review', 'work-record.read-team'] },
  { id: 'rules', label: '企业规则中心', icon: '◇', group: '管理闭环', permissions: ['rule.read', 'rule.manage'] },
  { id: 'tasks', label: '任务中心', icon: '↗', permissions: ['task.read', 'task.act', 'task.review'] },
  { id: 'evaluations', label: '标准评价', icon: '★', permissions: ['evaluation.read', 'evaluation.manual-review'] },
  { id: 'notifications', label: '通知中心', icon: '◉', permissions: ['notification.read'] },
  { id: 'templates', label: '集团模板配置', icon: '▧', group: '系统配置', permissions: ['template.manage'] },
  { id: 'organization', label: '组织与权限', icon: '⚙', group: '系统配置', permissions: ['org.read'] },
]

const viewIds = new Set<ViewId>(navigation.map((item) => item.id))
const roleStorageKey = 'hotel-ai-os-role:v1'
const statusText: Record<string, string> = {
  DRAFT: '草稿', PUBLISHED: '已发布', RETIRED: '已停用', PENDING: '待完成',
  PLANNED: '待开放', AVAILABLE: '可填报', NOT_STARTED: '待开始', IN_PROGRESS: '执行中',
  SUBMITTED: '已提交', SATISFIED: '已达标', FAILED: '未达标', MISSED: '已漏交',
  COMPLETED: '已完成', OVERDUE: '已逾期', WAIVED: '已豁免',
  PROPOSED: '待派发', PENDING_ACK: '待确认', RESULT_SUBMITTED: '结果已提交',
  AWAITING_REVIEW: '待验收', REWORK: '返工中', CANCELLED: '已取消',
  PASS: '通过', WARNING: '预警', FAIL: '不通过', PENDING_MANUAL: '待人工', PENDING_AI: '待AI',
  ON_TIME: '正常', DUE_SOON: '即将到期', HIGH: '高', URGENT: '紧急', NORMAL: '普通', LOW: '低',
}

function useHashRoute() {
  const read = () => {
    const raw = window.location.hash.replace(/^#\/?/, '')
    const queryIndex = raw.indexOf('?')
    const path = (queryIndex >= 0 ? raw.slice(0, queryIndex) : raw).split('/')[0] as ViewId
    const search = new URLSearchParams(queryIndex >= 0 ? raw.slice(queryIndex + 1) : '')
    return {
      view: viewIds.has(path) ? path : 'workbench',
      params: Object.fromEntries(search.entries()) as RouteParams,
    }
  }
  const [route, setRoute] = useState(read)
  useEffect(() => {
    const listener = () => setRoute(read())
    window.addEventListener('hashchange', listener)
    return () => window.removeEventListener('hashchange', listener)
  }, [])
  const navigate: Navigate = (next, params = {}) => {
    const search = new URLSearchParams()
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== '') search.set(key, value)
    })
    const nextHash = `/${next}${search.size ? `?${search.toString()}` : ''}`
    window.location.hash = nextHash
    setRoute(read())
  }
  return [route, navigate] as const
}

function formatDate(value?: string, includeTime = true) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit', day: '2-digit', ...(includeTime ? { hour: '2-digit', minute: '2-digit' } : {}),
  }).format(date)
}

function label(value?: string) {
  if (!value) return '—'
  return statusText[value] ?? value
}

function Status({ value, tone }: { value: string; tone?: string }) {
  return <span className={`status-pill ${tone ?? value.toLowerCase().replaceAll('_', '-')}`}>{label(value)}</span>
}

function PageHeader({ eyebrow, title, description, actions }: { eyebrow: string; title: string; description: string; actions?: React.ReactNode }) {
  return <header className="page-title">
    <div><span className="eyebrow">{eyebrow}</span><h1>{title}</h1><p>{description}</p></div>
    {actions && <div className="page-actions">{actions}</div>}
  </header>
}

function DataState({ loading, error, empty, onRetry }: { loading: boolean; error?: string; empty?: boolean; onRetry: () => void }) {
  if (loading) return <div className="state-card"><div className="spinner" /><strong>正在读取管理数据</strong><span>数据来自当前任职权限范围</span></div>
  if (error) return <div className="state-card error-state"><b>!</b><strong>数据读取失败</strong><span>{error}</span><button className="secondary" onClick={onRetry}>重新加载</button></div>
  if (empty) return <div className="state-card"><b>◇</b><strong>当前范围暂无数据</strong><span>这里不会用演示数据填充真实 API 的空结果。</span><button className="secondary" onClick={onRetry}>立即刷新</button></div>
  return null
}

function SourceFlag({ source }: { source: ApiSource }) {
  return source === 'demo'
    ? <span className="source-flag demo">演示回退</span>
    : <span className="source-flag api">实时 API</span>
}

function Metric({ label: title, value, hint, tone = 'blue', onClick }: { label: string; value: string | number; hint: string; tone?: string; onClick?: () => void }) {
  const content = <><div>{title.slice(0, 1)}</div><span>{title}<strong>{value}</strong><small>{hint}</small></span></>
  return onClick
    ? <button type="button" className={`metric metric-action ${tone}`} onClick={onClick} aria-label={`${title}：${value}，查看明细`}>{content}</button>
    : <article className={`metric ${tone}`}>{content}</article>
}

function Workbench({ identity, permissions, go }: { identity: RoleContext; permissions: string[]; go: Navigate }) {
  const hasAssignment = Boolean(identity.assignmentId)
  const canReview = permissions.includes('task.review')
  const primaryTaskView = hasAssignment ? 'mine' : 'team'
  const myWork = useResource(`${identity.key}:my-work`, () => hasAssignment ? loadMyWork(identity) : Promise.resolve({ data: [], source: 'api' as const }), [], 30_000)
  const tasks = useResource(`${identity.key}:tasks`, () => loadTasks(identity, { view: primaryTaskView }), [], 15_000)
  const reviewTaskResource = useResource(`${identity.key}:review-tasks:${canReview}`, () => canReview ? loadTasks(identity, { view: 'review' }) : Promise.resolve({ data: [], source: 'api' as const }), [], 15_000)
  const notices = useResource(`${identity.key}:notices`, () => loadNotifications(identity), [], 15_000)
  const loading = myWork.loading || tasks.loading || reviewTaskResource.loading || notices.loading
  const scopedWork = myWork.data
  const scopedTasks = tasks.data
  const scopedNotices = notices.data
  const pendingWork = scopedWork.filter((item) => !['SATISFIED', 'SUBMITTED', 'WAIVED', 'CANCELLED'].includes(item.status))
  const activeTasks = scopedTasks.filter((item) => !['COMPLETED', 'CANCELLED'].includes(item.status))
  const reviewTasks = reviewTaskResource.data.filter((item) => ['RESULT_SUBMITTED', 'AWAITING_REVIEW'].includes(item.status))
  const unread = scopedNotices.filter((item) => !item.readAt)
  const source: ApiSource = [myWork.source, tasks.source, reviewTaskResource.source, notices.source].includes('demo') ? 'demo' : 'api'

  return <>
    <section className="hero">
      <div><span className="eyebrow">SPRINT 2 · MANAGEMENT LOOP</span><h1>{identity.label}工作台</h1><p>{identity.focus}</p></div>
      <div className="hero-context"><span>当前有效任职</span><strong>{identity.label}</strong><small>{identity.orgName}</small><SourceFlag source={source} /></div>
    </section>
    {loading ? <DataState loading onRetry={() => void Promise.all([myWork.reload(), tasks.reload(), reviewTaskResource.reload(), notices.reload()])} /> : <>
      <section className="metrics-grid">
        <Metric label={hasAssignment ? '今日待完成' : '岗位待办'} value={pendingWork.length} hint={hasAssignment ? `当前任职工作 ${scopedWork.length} 项` : '管理账号查看授权团队工作'} onClick={() => go(hasAssignment ? 'my-work' : 'team-work', { status: 'PENDING_WORK' })} />
        <Metric label="执行中任务" value={activeTasks.length} hint={`${scopedTasks.filter((x) => x.slaStatus === 'OVERDUE').length} 项已逾期`} tone="teal" onClick={() => go('tasks', { view: primaryTaskView, status: 'ACTIVE' })} />
        {canReview && <Metric label="待我验收" value={reviewTasks.length} hint="有标准按标准评价，无标准由验收人人工判定" tone="gold" onClick={() => go('tasks', { view: 'review' })} />}
        <Metric label="未读通知" value={unread.length} hint="任务、逾期与升级提醒" tone="violet" onClick={() => go('notifications', { unread: 'true' })} />
      </section>
      <section className="dashboard-grid">
        <article className="panel span-2"><header><div><span className="panel-kicker">{hasAssignment ? "TODAY'S WORK" : 'MANAGEMENT SCOPE'}</span><h2>{hasAssignment ? '今日岗位工作' : '集团管理视图'}</h2></div><button className="link-button" onClick={() => go(hasAssignment ? 'my-work' : 'team-work')}>{hasAssignment ? '查看全部' : '查看团队执行'}</button></header>
          {hasAssignment ? <div className="compact-list">{scopedWork.slice(0, 5).map((item) => <div key={item.id}><i className={`work-dot ${item.status.toLowerCase()}`} /><span><strong>{item.title}</strong><small>{item.targetOrgName} · {item.packageName}</small></span><span className="compact-meta"><Status value={item.status} /><small>{formatDate(item.dueAt)}</small></span></div>)}</div> : <div className="state-card"><b>◎</b><strong>当前为集团管理账号</strong><span>CEO 等无岗位任职的账号通过团队工作、任务中心和驾驶舱管理，不生成虚假的个人工作。</span></div>}
        </article>
        <article className="panel"><header><div><span className="panel-kicker">NOTIFICATIONS</span><h2>管理提醒</h2></div><button className="link-button" onClick={() => go('notifications')}>通知中心</button></header>
          <div className="notice-list">{scopedNotices.slice(0, 4).map((item) => <div className={item.readAt ? 'read' : ''} key={item.id}><i /><span><strong>{item.title}</strong><small>{item.content}</small></span></div>)}</div>
        </article>
        <article className="panel span-3"><header><div><span className="panel-kicker">EXECUTION LOOP</span><h2>执行任务</h2></div><button className="link-button" onClick={() => go('tasks', { view: primaryTaskView })}>进入任务中心</button></header>
          <TaskRows tasks={scopedTasks.slice(0, 5)} onSelect={(task) => go('tasks', { view: primaryTaskView, taskId: task.id })} />
        </article>
      </section>
    </>}
  </>
}

function WorkPackages({ identity }: { identity: RoleContext }) {
  const resource = useResource(`${identity.key}:packages`, () => loadWorkPackages(identity), [])
  return <section className="page-section">
    <PageHeader eyebrow="WORK PACKAGE CENTER" title="工作包中心" description="把已发布标准转化为岗位每日、每周、每月必须完成的结构化工作。" actions={<><SourceFlag source={resource.source} /><button className="primary" disabled>＋ 新建工作包</button></>} />
    <DataState loading={resource.loading} error={resource.error} empty={!resource.data.length} onRetry={resource.reload} />
    {!resource.loading && !resource.error && !!resource.data.length && <div className="card-grid">{resource.data.map((item) => <article className="package-card" key={item.id}>
      <div className="card-top"><span>{item.code}</span><Status value={item.lifecycleStatus} /></div>
      <h2>{item.name}</h2><p>{item.positionName} · {item.scopeName}</p>
      <div className="package-stats"><span><strong>V{item.versionNo}</strong>当前版本</span><span><strong>{item.itemCount ?? '—'}</strong>工作项</span><span><strong>{item.completionRate === undefined ? '—' : `${item.completionRate}%`}</strong>今日完成</span></div>
      <div className="progress"><i style={{ width: `${item.completionRate ?? 0}%` }} /></div>
      <button className="secondary">查看版本与分配</button>
    </article>)}</div>}
  </section>
}

function WorkTable({ items, own = false, onFill }: { items: WorkExpectation[]; own?: boolean; onFill?: (item: WorkExpectation) => void }) {
  return <div className="data-table work-table">
    <div className="table-row table-head"><span>工作项</span><span>目标组织</span><span>负责人</span><span>截止时间</span><span>评价</span><span>状态</span>{own && <span>操作</span>}</div>
    {items.map((item) => <div className="table-row" key={item.id}>
      <span><strong>{item.title}</strong><small>{item.packageName} · {item.itemName}</small></span>
      <span>{item.targetOrgName}</span><span>{item.assigneeName}</span><span>{formatDate(item.dueAt)}</span>
      <span>{item.evaluationOutcome ? <Status value={item.evaluationOutcome} /> : '—'}</span><span><Status value={item.status} /></span>
      {own && <span><button className="link-button" disabled={['MISSED', 'WAIVED', 'CANCELLED'].includes(item.status)} onClick={() => onFill?.(item)}>{['SUBMITTED', 'SATISFIED'].includes(item.status) ? '查看提交' : item.status === 'FAILED' ? '查看并重提' : '填报'}</button></span>}
    </div>)}
  </div>
}

function WorkRecordDialog({ item, identity, onClose, onSaved }: { item: WorkExpectation; identity: RoleContext; onClose: () => void; onSaved: () => void }) {
  const [completion, setCompletion] = useState('')
  const [exception, setException] = useState('')
  const [nextAction, setNextAction] = useState('')
  const [payload, setPayload] = useState<Record<string, string | number | boolean>>({})
  const [attachments, setAttachments] = useState<File[]>([])
  const [existing, setExisting] = useState<WorkRecordDetail>()
  const [loadingRecord, setLoadingRecord] = useState(Boolean(item.recordId))
  const [supplement, setSupplement] = useState('')
  const [saving, setSaving] = useState<'draft' | 'submit' | 'supplement'>()
  const [message, setMessage] = useState<string>()
  const employeeId = item.employeeId ?? identity.employeeId
  const assignmentOrgUnitId = identity.assignmentOrgUnitId
  const canSubmit = item.orgUnitId && assignmentOrgUnitId && employeeId && item.assignmentId && item.formVersionId
  const properties = item.formSchema?.properties ?? {}
  const required = item.formSchema?.required ?? []
  const policy = item.submissionPolicy ?? { completionStatementRequired: true, exceptionStatementRequired: false, nextActionRequired: false, attachmentRequired: false, maxAttachments: 10, maxFileSizeBytes: 20 * 1024 * 1024, allowedExtensions: ['jpg', 'jpeg', 'png', 'pdf', 'docx', 'xlsx'] }
  const viewOnly = Boolean(existing && ['SUBMITTED', 'APPROVED'].includes(existing.status) && item.status !== 'FAILED')
  const fieldLabels: Record<string, string> = { checkins: '今日入住数', complaints: '客诉数量', vipReception: 'VIP接待情况', roomsChecked: '检查房间数', issues: '发现问题数', attendance: '出勤人数', employeeStatus: '员工状态', handover: '交接事项', operationsReviewed: '已查看经营数据', otaChecked: '已完成OTA巡查', employeeTalks: '员工沟通人数', summary: '完成情况' }
  const requiredReady = required.every((key) => payload[key] !== undefined && payload[key] !== '')
  useEffect(() => {
    if (!item.recordId) return
    setLoadingRecord(true)
    void loadWorkRecord(identity, item.recordId).then((resource) => {
      setExisting(resource.data)
      if (['DRAFT', 'REJECTED'].includes(resource.data.status)) {
        setCompletion(resource.data.completionStatement ?? '')
        setException(resource.data.exceptionStatement ?? '')
        setNextAction(resource.data.nextAction ?? '')
        setPayload(Object.fromEntries(Object.entries(resource.data.payload).filter((entry): entry is [string, string | number | boolean] => ['string', 'number', 'boolean'].includes(typeof entry[1]))))
      }
    }).catch((error) => setMessage(error instanceof Error ? error.message : '工作记录加载失败')).finally(() => setLoadingRecord(false))
  }, [identity.key, item.recordId])
  const recordPayload = () => Object.keys(properties).length ? payload : { summary: completion, exception: exception || null }
  const validate = (forSubmission: boolean) => {
    if (!canSubmit) throw new Error('接口结果缺少组织、员工、任职或表单版本，无法安全提交。')
    if (forSubmission && !requiredReady) throw new Error('请完成表单中的所有必填项。')
    if (forSubmission && policy.completionStatementRequired && !completion.trim()) throw new Error('请填写完成情况。')
    if (forSubmission && policy.exceptionStatementRequired && !exception.trim()) throw new Error('请填写异常与协同事项。')
    if (forSubmission && policy.nextActionRequired && !nextAction.trim()) throw new Error('请填写下一步行动。')
    const totalAttachments = (existing?.status === 'DRAFT' ? existing.attachments.length : 0) + attachments.length
    if (forSubmission && policy.attachmentRequired && totalAttachments === 0) throw new Error('该岗位工作要求必须上传附件证据。')
    if (totalAttachments > policy.maxAttachments) throw new Error(`最多上传 ${policy.maxAttachments} 个附件。`)
    const oversized = attachments.find((file) => file.size > policy.maxFileSizeBytes)
    if (oversized) throw new Error(`${oversized.name} 超过单文件大小上限。`)
  }
  const persist = async (submitAfterUpload: boolean) => {
    try { validate(submitAfterUpload) } catch (reason) { setMessage(reason instanceof Error ? reason.message : '提交校验失败'); return }
    setSaving(submitAfterUpload ? 'submit' : 'draft'); setMessage(undefined)
    try {
      const draftInput = { payload: recordPayload(), completionStatement: completion, exceptionStatement: exception || undefined, nextAction: nextAction || undefined }
      const created = existing?.status === 'DRAFT'
        ? await updateWorkRecordDraft(identity, existing.id, { ...draftInput, expectedVersion: existing.rowVersion })
        : await createWorkRecordDraft(identity, {
          orgUnitId: assignmentOrgUnitId, employeeId, positionAssignmentId: item.assignmentId,
          formVersionId: item.formVersionId, businessDate: item.businessDate,
          workPackageVersionId: item.workPackageVersionId, workPackageItemId: item.workPackageItemId,
          workExpectationId: item.id, targetOrgUnitId: item.orgUnitId,
          occurredAt: new Date().toISOString(), ...draftInput,
          supersedesWorkRecordId: item.status === 'FAILED' ? existing?.id ?? item.recordId : null,
        })
      const recordId = existing?.status === 'DRAFT' ? existing.id : String(created.id ?? created.recordId ?? '')
      if (!recordId) throw new Error('服务端未返回工作记录编号。')
      for (const file of attachments) await uploadWorkRecordAttachment(identity, recordId, file)
      if (submitAfterUpload) await submitWorkRecordDraft(identity, recordId, Number(created.rowVersion ?? created.row_version ?? 0))
      await Promise.resolve(onSaved()); onClose()
    } catch (error) { setMessage(error instanceof Error ? error.message : '工作记录保存失败') }
    finally { setSaving(undefined) }
  }
  const addSupplement = async () => {
    if (!existing || !identity.assignmentId || !supplement.trim()) return
    setSaving('supplement'); setMessage(undefined)
    try {
      await addWorkRecordSupplement(identity, existing.id, identity.assignmentId, supplement)
      const refreshed = await loadWorkRecord(identity, existing.id, existing)
      setExisting(refreshed.data); setSupplement(''); onSaved()
    } catch (error) { setMessage(error instanceof Error ? error.message : '补充说明失败') }
    finally { setSaving(undefined) }
  }
  const preview = async (attachmentId: string) => {
    try {
      const { loadAttachmentContent } = await import('./api/resources')
      const blob = await loadAttachmentContent(identity, attachmentId)
      window.open(URL.createObjectURL(blob), '_blank', 'noopener,noreferrer')
    } catch (error) { setMessage(error instanceof Error ? error.message : '附件打开失败') }
  }
  return <div className="modal-backdrop" role="presentation"><section className="modal work-record-modal" role="dialog" aria-modal="true">
    <header><div><span className="panel-kicker">WORK RECORD · REAL API</span><h2>{item.title}</h2></div><button className="close" onClick={onClose}>×</button></header>
    <div className="form-body"><div className="form-context"><strong>{item.formName ?? '岗位工作记录'}</strong><small>{item.formCode ?? '结构化表单'} · 最多 {policy.maxAttachments} 个附件 · 单文件 ≤ {Math.round(policy.maxFileSizeBytes / 1024 / 1024)}MB</small></div>
      {loadingRecord && <div className="state-card"><div className="spinner" /><strong>正在读取已提交记录</strong></div>}
      {existing && <section className="detail-section"><h3>最近一次提交 · {label(existing.status)}</h3><dl><div><dt>完成情况</dt><dd>{existing.completionStatement ?? String(existing.payload.summary ?? '—')}</dd></div><div><dt>异常事项</dt><dd>{existing.exceptionStatement ?? String(existing.payload.exception ?? '无')}</dd></div><div><dt>下一步行动</dt><dd>{existing.nextAction ?? '—'}</dd></div><div><dt>提交时间</dt><dd>{formatDate(existing.submittedAt)}</dd></div></dl>{existing.reviewReason && <div className="inline-warning">复核意见：{existing.reviewReason}</div>}<div className="attachment-list">{existing.attachments.map((attachment) => <button className="secondary" key={attachment.id} onClick={() => void preview(attachment.id)}>{attachment.originalName} · {Math.ceil(attachment.sizeBytes / 1024)}KB</button>)}</div>{existing.supplements.map((entry) => <p className="muted" key={entry.id}>补充：{entry.content} · {entry.submittedByName}</p>)}</section>}
      {viewOnly && existing?.status === 'SUBMITTED' && <section className="action-box"><label>补充说明<textarea rows={3} value={supplement} onChange={(event) => setSupplement(event.target.value)} placeholder="待主管复核前可追加说明，原提交内容不会被覆盖" /></label><button className="secondary" disabled={saving === 'supplement' || !supplement.trim()} onClick={() => void addSupplement()}>{saving === 'supplement' ? '补充中…' : '追加说明'}</button></section>}
      {!viewOnly && !loadingRecord && <>{item.status === 'FAILED' && <div className="inline-warning">上一版未通过，本次提交会生成新的尝试记录，不覆盖历史证据。</div>}{Object.keys(properties).length > 0 && <div className="dynamic-form">{Object.entries(properties).map(([key, definition]) => <label key={key}>{fieldLabels[key] ?? definition.title ?? key}{required.includes(key) ? ' *' : ''}{definition.type === 'boolean' ? <select value={String(payload[key] ?? '')} onChange={(event) => setPayload({ ...payload, [key]: event.target.value === 'true' })}><option value="">请选择</option><option value="true">是</option><option value="false">否</option></select> : ['integer', 'number'].includes(definition.type ?? '') ? <input type="number" min={definition.minimum} max={definition.maximum} value={String(payload[key] ?? '')} onChange={(event) => setPayload({ ...payload, [key]: event.target.value === '' ? '' : Number(event.target.value) })} /> : <textarea rows={3} value={String(payload[key] ?? '')} onChange={(event) => setPayload({ ...payload, [key]: event.target.value })} />}{definition.description && <small>{definition.description}</small>}</label>)}</div>}
        <label>完成情况{policy.completionStatementRequired ? ' *' : ''}<textarea rows={4} value={completion} onChange={(event) => setCompletion(event.target.value)} placeholder="说明实际完成内容、结果和关键数据" /></label><label>异常与需协同事项{policy.exceptionStatementRequired ? ' *' : ''}<textarea rows={3} value={exception} onChange={(event) => setException(event.target.value)} placeholder="没有异常请填写“无”" /></label><label>下一步行动{policy.nextActionRequired ? ' *' : ''}<textarea rows={2} value={nextAction} onChange={(event) => setNextAction(event.target.value)} placeholder="需要继续跟进时填写" /></label>
        <label className="attachment-picker">附件证据{policy.attachmentRequired ? ' *' : '（可选）'}<input type="file" multiple accept=".jpg,.jpeg,.png,.pdf,.docx,.xlsx" onChange={(event) => setAttachments(Array.from(event.target.files ?? []).slice(0, policy.maxAttachments))} /><small>{attachments.length ? `已选择 ${attachments.length} 个：${attachments.map((file) => file.name).join('、')}` : '支持图片、PDF、Word、Excel；先上传成功，再提交工作记录'}</small></label></>}
      {!canSubmit && !viewOnly && <div className="inline-warning">此条接口数据尚未返回完整提交上下文；页面不会猜测任职或表单版本。</div>}{message && <div className="inline-error">{message}</div>}
    </div><footer><button className="secondary" onClick={onClose}>关闭</button>{!viewOnly && !loadingRecord && <><button className="secondary" disabled={!!saving} onClick={() => void persist(false)}>{saving === 'draft' ? '保存中…' : '保存草稿'}</button><button className="primary" disabled={!!saving} onClick={() => void persist(true)}>{saving === 'submit' ? '上传并提交中…' : item.status === 'FAILED' ? '重新提交' : '上传并提交'}</button></>}</footer>
  </section></div>
}

const workFilters = ['ALL', 'PENDING_WORK', 'AVAILABLE', 'PLANNED', 'IN_PROGRESS', 'SUBMITTED', 'SATISFIED', 'FAILED', 'MISSED'] as const

function MyWork({ identity, routeParams, go }: { identity: RoleContext; routeParams: RouteParams; go: Navigate }) {
  const resource = useResource(`${identity.key}:my-work`, () => loadMyWork(identity), [])
  const requestedFilter = workFilters.includes(routeParams.status as typeof workFilters[number]) ? routeParams.status : 'ALL'
  const [filter, setFilter] = useState(requestedFilter)
  const [editing, setEditing] = useState<WorkExpectation>()
  const [opening, setOpening] = useState<string>()
  const [openError, setOpenError] = useState<string>()
  useEffect(() => setFilter(requestedFilter), [requestedFilter])
  const items = filter === 'ALL'
    ? resource.data
    : filter === 'PENDING_WORK'
      ? resource.data.filter((item) => !['SUBMITTED', 'SATISFIED', 'WAIVED', 'CANCELLED'].includes(item.status))
      : resource.data.filter((item) => item.status === filter)
  const openRecord = async (item: WorkExpectation) => {
    setOpening(item.id); setOpenError(undefined)
    try {
      const detail = await loadExpectation(identity, item.id, item)
      setEditing(detail.data)
    } catch (error) { setOpenError(error instanceof Error ? error.message : '工作详情加载失败') }
    finally { setOpening(undefined) }
  }
  return <section className="page-section"><PageHeader eyebrow="POSITION WORK" title="我的工作" description={`当前任职：${identity.label} · ${identity.orgName}。每条记录绑定精确任职，不因切换岗位而串岗。`} actions={<SourceFlag source={resource.source} />} />
    <div className="filters">{workFilters.map((item) => <button className={filter === item ? 'active' : ''} onClick={() => { setFilter(item); go('my-work', { ...routeParams, status: item === 'ALL' ? undefined : item }) }} key={item}>{item === 'ALL' ? '全部' : item === 'PENDING_WORK' ? '待完成' : label(item)}</button>)}</div>
    {openError && <div className="inline-error page-error">{openError}</div>}
    <article className="panel table-panel"><DataState loading={resource.loading || !!opening} error={resource.error} empty={!items.length} onRetry={resource.reload} />{!resource.loading && !opening && !resource.error && !!items.length && <WorkTable items={items} own onFill={openRecord} />}</article>
    {editing && <WorkRecordDialog item={editing} identity={identity} onClose={() => setEditing(undefined)} onSaved={resource.reload} />}
  </section>
}

function TeamWork({ identity, permissions, routeParams }: { identity: RoleContext; permissions: string[]; routeParams: RouteParams }) {
  return <TeamWorkPage identity={identity} permissions={permissions} routeParams={routeParams} />
}

const defaultCondition = '{\n  "op": "EXISTS",\n  "fact": "workRecordId"\n}'
const defaultActions = '[\n  {\n    "key": "notify-owner",\n    "type": "CREATE_NOTIFICATION",\n    "recipientResolver": "CURRENT_ASSIGNMENT",\n    "title": "请处理规则命中事项"\n  }\n]'

function RuleEditor({ identity, detail, permissions, onClose, onSaved }: {
  identity: RoleContext
  detail?: RuleDetail
  permissions: string[]
  onClose: () => void
  onSaved: () => Promise<void>
}) {
  const latest = detail?.versions[0]
  const [code, setCode] = useState(detail?.code ?? '')
  const [name, setName] = useState(detail?.name ?? '')
  const [eventType, setEventType] = useState(detail?.eventType ?? 'WORK_RECORD_SUBMITTED')
  const [description, setDescription] = useState(detail?.description ?? '')
  const [condition, setCondition] = useState(latest ? JSON.stringify(latest.conditionAst, null, 2) : defaultCondition)
  const [actions, setActions] = useState(latest ? JSON.stringify(latest.actions, null, 2) : defaultActions)
  const [priority, setPriority] = useState(String(latest?.priority ?? 100))
  const [cooldown, setCooldown] = useState(String(latest?.cooldownMinutes ?? 0))
  const [busy, setBusy] = useState<'save' | 'publish'>()
  const [error, setError] = useState<string>()

  const readVersion = (): RuleVersionDraft => {
    const conditionAst: unknown = JSON.parse(condition)
    const parsedActions: unknown = JSON.parse(actions)
    if (!conditionAst || typeof conditionAst !== 'object' || Array.isArray(conditionAst)) throw new Error('判断条件必须是JSON对象。')
    if (!Array.isArray(parsedActions) || parsedActions.length === 0) throw new Error('执行动作必须是非空JSON数组。')
    return {
      conditionAst: conditionAst as Record<string, unknown>, actions: parsedActions as Array<Record<string, unknown>>,
      priority: Number(priority), cooldownMinutes: Number(cooldown), scopes: latest?.scopes.length ? latest.scopes : [{ scopeType: 'TENANT' }],
    }
  }

  const save = async () => {
    setBusy('save'); setError(undefined)
    try {
      const version = readVersion()
      if (!detail) await createRuleWithVersion(identity, { code, name, eventType, description: description || undefined }, version)
      else if (latest) await saveRuleVersion(identity, detail.id, latest, version)
      else throw new Error('规则详情缺少版本上下文，无法安全修改。')
      await onSaved(); onClose()
    } catch (failure) { setError(failure instanceof Error ? failure.message : '规则保存失败。') }
    finally { setBusy(undefined) }
  }

  const publish = async () => {
    if (!detail || !latest || latest.lifecycleStatus !== 'DRAFT') return
    setBusy('publish'); setError(undefined)
    try { await publishRuleVersion(identity, detail.id, latest); await onSaved(); onClose() }
    catch (failure) { setError(failure instanceof Error ? failure.message : '规则发布失败。') }
    finally { setBusy(undefined) }
  }

  return <div className="modal-backdrop" role="presentation"><section className="modal rule-editor" role="dialog" aria-modal="true" aria-label={detail ? '修改规则' : '创建规则'}>
    <header><div><span className="panel-kicker">RULE VERSION</span><h2>{detail ? `${detail.name} · ${latest?.lifecycleStatus === 'DRAFT' ? '修改草稿' : '创建新版本'}` : '创建企业规则'}</h2></div><button className="close" onClick={onClose}>×</button></header>
    <div className="form-body">
      {detail && latest?.lifecycleStatus !== 'DRAFT' && <div className="inline-warning">已发布版本不可覆盖；本次保存将自动创建新的草稿版本。</div>}
      <div className="rule-definition-grid"><label>规则编码<input value={code} disabled={!!detail} onChange={(event) => setCode(event.target.value.toUpperCase())} placeholder="RULE-WORK-MISSED" /></label><label>规则名称<input value={name} disabled={!!detail} onChange={(event) => setName(event.target.value)} /></label></div>
      <label>监听事件<input value={eventType} disabled={!!detail} onChange={(event) => setEventType(event.target.value.toUpperCase())} list="rule-event-types" /><datalist id="rule-event-types"><option value="WORK_RECORD_SUBMITTED" /><option value="WORK_EXPECTATION_MISSED" /><option value="METRIC_TREND_DETECTED" /></datalist></label>
      <label>说明<textarea rows={2} value={description} disabled={!!detail} onChange={(event) => setDescription(event.target.value)} /></label>
      <div className="rule-number-grid"><label>优先级（0-1000）<input type="number" min="0" max="1000" value={priority} onChange={(event) => setPriority(event.target.value)} /></label><label>冷却时间（分钟）<input type="number" min="0" value={cooldown} onChange={(event) => setCooldown(event.target.value)} /></label></div>
      <label>判断条件 JSON<textarea className="code-editor" rows={7} value={condition} onChange={(event) => setCondition(event.target.value)} /></label>
      <label>执行动作 JSON<textarea className="code-editor" rows={9} value={actions} onChange={(event) => setActions(event.target.value)} /></label>
      <div className="inline-warning">当前基础版使用租户范围。阈值、时限、通知和升级必须写入结构化规则，不交给大模型判断。</div>
      {error && <div className="inline-error">{error}</div>}
    </div><footer><button className="secondary" onClick={onClose}>取消</button>{detail && latest?.lifecycleStatus === 'DRAFT' && permissions.includes('rule.publish') && <button className="secondary" disabled={!!busy} onClick={publish}>{busy === 'publish' ? '发布中…' : '发布当前草稿'}</button>}<button className="primary" disabled={!!busy || !code.trim() || !name.trim() || !eventType.trim()} onClick={save}>{busy === 'save' ? '保存中…' : latest?.lifecycleStatus === 'PUBLISHED' ? '保存为新版本' : '保存草稿'}</button></footer>
  </section></div>
}

function Rules({ identity, permissions }: { identity: RoleContext; permissions: string[] }) {
  const resource = useResource(`${identity.key}:rules`, () => loadRules(identity), [])
  const [editor, setEditor] = useState<{ key: string; detail?: RuleDetail }>()
  const [opening, setOpening] = useState<string>()
  const [openError, setOpenError] = useState<string>()
  const canManage = permissions.includes('rule.manage')
  const openExisting = async (item: ManagementRule) => {
    setOpening(item.id); setOpenError(undefined)
    try { setEditor({ key: `${item.id}:${Date.now()}`, detail: await loadRuleDetail(identity, item.id) }) }
    catch (failure) { setOpenError(failure instanceof Error ? failure.message : '规则详情读取失败。') }
    finally { setOpening(undefined) }
  }
  return <section className="page-section"><PageHeader eyebrow="RULE ENGINE" title="企业规则中心" description="确定性的事件＋条件＋动作：规则决定何时行动，AI不参与阈值、时限和升级判断。" actions={<><SourceFlag source={resource.source} />{canManage && <button className="primary" onClick={() => setEditor({ key: `new:${Date.now()}` })}>＋ 创建规则</button>}</>} />
    {openError && <div className="inline-error page-error">{openError}</div>}
    <article className="panel table-panel"><DataState loading={resource.loading} error={resource.error} empty={!resource.data.length} onRetry={resource.reload} />
      {!resource.loading && !resource.error && !!resource.data.length && <div className="data-table rule-table"><div className="table-row table-head"><span>规则</span><span>监听事件</span><span>范围</span><span>命中</span><span>版本</span><span>状态</span>{canManage && <span>操作</span>}</div>{resource.data.map((item) => <div className="table-row" key={item.id}><span><strong>{item.name}</strong><small>{item.code}</small></span><span><code>{item.eventType}</code></span><span>{item.scopeName}</span><span>{item.hitCount ?? '—'}</span><span>V{item.versionNo}</span><span><Status value={item.status} /></span>{canManage && <span><button className="link-button" disabled={opening === item.id} onClick={() => void openExisting(item)}>{opening === item.id ? '读取中…' : '修改 / 新版本'}</button></span>}</div>)}</div>}
    </article>
    {editor && <RuleEditor key={editor.key} identity={identity} detail={editor.detail} permissions={permissions} onClose={() => setEditor(undefined)} onSaved={resource.reload} />}
  </section>
}

function TaskRows({ tasks, onSelect }: { tasks: ManagementTask[]; onSelect: (task: ManagementTask) => void }) {
  return <div className="data-table task-table"><div className="table-row table-head"><span>任务</span><span>目标组织</span><span>负责人 / 验收人</span><span>SLA</span><span>状态</span><span>操作</span></div>
    {tasks.map((task) => <div className="table-row" key={task.id}><span><strong>{task.title}</strong><small>{task.code} · {label(task.priority)}优先级</small></span><span>{task.targetOrgName}</span><span>{task.assigneeName}<small>验收：{task.reviewerName}</small></span><span><Status value={task.slaStatus} /></span><span><Status value={task.status} /></span><span><button className="link-button" onClick={() => onSelect(task)}>查看与处理</button></span></div>)}
  </div>
}

const actionsByStatus: Record<string, Array<{ command: string; label: string; tone?: string }>> = {
  PROPOSED: [{ command: 'dispatch', label: '派发任务' }],
  PENDING_ACK: [{ command: 'acknowledge', label: '确认接单' }],
  IN_PROGRESS: [{ command: 'submit-result', label: '提交执行结果' }],
  REWORK: [{ command: 'start', label: '开始返工' }],
  RESULT_SUBMITTED: [{ command: 'approve', label: '验收通过' }, { command: 'reject', label: '退回整改', tone: 'danger' }],
  AWAITING_REVIEW: [{ command: 'approve', label: '验收通过' }, { command: 'rework', label: '打回返工', tone: 'danger' }],
}

function TaskDetail({ initial, identity, permissions, onClose, onChanged }: { initial: ManagementTask; identity: RoleContext; permissions: string[]; onClose: () => void; onChanged: () => void }) {
  const resource = useResource(`${identity.key}:task:${initial.id}`, () => loadTask(identity, initial.id, initial), initial)
  const task = resource.data
  const [remark, setRemark] = useState('')
  const [busy, setBusy] = useState<string>()
  const [error, setError] = useState<string>()
  const [evidenceFiles, setEvidenceFiles] = useState<File[]>([])
  const isAssignee = Boolean(identity.assignmentId && identity.assignmentId === task.assigneeAssignmentId)
  const isReviewer = Boolean(identity.assignmentId && identity.assignmentId === task.reviewerAssignmentId)
  const canEditEvidence = Boolean(identity.assignmentId && identity.assignmentId === task.assigneeAssignmentId && ['IN_PROGRESS', 'REWORK'].includes(task.status))
  const allowedActions = (actionsByStatus[task.status] ?? []).filter((action) => {
    if (task.status === 'RESULT_SUBMITTED' && task.standardVersionId) return false
    if (['approve', 'rework', 'reject'].includes(action.command)) return isReviewer && permissions.includes('task.review')
    if (action.command === 'dispatch') return permissions.includes('task.dispatch')
    return isAssignee && permissions.includes('task.act')
  })
  const run = async (command: string) => {
    setBusy(command); setError(undefined)
    try {
      await apiCommand(`/tasks/${task.id}/actions/${command}`, identity, {
        actorAssignmentId: identity.assignmentId,
        payload: { remark, ...(command === 'submit-result' ? { result: { summary: remark } } : {}) },
      }, task.version)
      setRemark(''); await resource.reload(); onChanged()
    } catch (reason) { setError(reason instanceof Error ? reason.message : '任务操作失败') }
    finally { setBusy(undefined) }
  }
  const evaluateResult = async () => {
    setBusy('evaluate-result'); setError(undefined)
    try {
      await createTaskEvaluation(identity, task)
      await resource.reload(); onChanged()
    } catch (reason) { setError(reason instanceof Error ? reason.message : '任务结果评价失败') }
    finally { setBusy(undefined) }
  }
  const uploadEvidence = async () => {
    if (!identity.assignmentId || !evidenceFiles.length) return
    setBusy('upload-evidence'); setError(undefined)
    try {
      for (const file of evidenceFiles) await uploadTaskEvidence(identity, task.id, identity.assignmentId, file)
      setEvidenceFiles([]); await resource.reload(); onChanged()
    } catch (reason) { setError(reason instanceof Error ? reason.message : '执行证据上传失败') }
    finally { setBusy(undefined) }
  }
  const previewEvidence = async (evidenceId: string) => {
    try { const blob = await loadTaskEvidenceContent(identity, task.id, evidenceId); window.open(URL.createObjectURL(blob), '_blank', 'noopener,noreferrer') }
    catch (reason) { setError(reason instanceof Error ? reason.message : '执行证据打开失败') }
  }
  const removeEvidence = async (evidenceId: string) => {
    if (!identity.assignmentId) return
    setBusy(`delete:${evidenceId}`); setError(undefined)
    try { await deleteTaskEvidence(identity, task.id, evidenceId, identity.assignmentId); await resource.reload(); onChanged() }
    catch (reason) { setError(reason instanceof Error ? reason.message : '执行证据删除失败') }
    finally { setBusy(undefined) }
  }
  return <div className="drawer-backdrop" role="presentation"><aside className="drawer" role="dialog" aria-modal="true">
    <header><div><span className="panel-kicker">TASK DETAIL</span><h2>{task.title}</h2><small>{task.code}</small></div><button className="close" onClick={onClose}>×</button></header>
    <div className="drawer-body"><div className="task-summary"><span><small>任务状态</small><Status value={task.status} /></span><span><small>SLA状态</small><Status value={task.slaStatus} /></span><span><small>优先级</small><Status value={task.priority} /></span></div>
      <dl><div><dt>目标组织</dt><dd>{task.targetOrgName}</dd></div><div><dt>负责人</dt><dd>{task.assigneeName}</dd></div><div><dt>验收人</dt><dd>{task.reviewerName}</dd></div><div><dt>截止时间</dt><dd>{formatDate(task.dueAt)}</dd></div><div><dt>来源</dt><dd>{task.sourceTitle ?? label(task.sourceType)}</dd></div></dl>
      <section className="detail-section"><h3>执行要求</h3><p>{task.description ?? '任务来源已记录，执行结果需提交结构化说明和证据。'}</p></section>
      <section className="detail-section"><h3>执行证据</h3>{task.evidence?.length ? <div className="attachment-list">{task.evidence.map((evidence) => <span className="evidence-chip" key={evidence.id}><button className="secondary" disabled={!evidence.objectKey} onClick={() => void previewEvidence(evidence.id)}>{evidence.originalName || label(evidence.evidenceType)} · {evidence.scanStatus}</button>{canEditEvidence && evidence.submittedByAssignmentId === identity.assignmentId && <button className="text-action danger" disabled={busy === `delete:${evidence.id}`} onClick={() => void removeEvidence(evidence.id)}>删除</button>}</span>)}</div> : <p className="muted">尚未上传图片或文档证据。</p>}{canEditEvidence && <div className="evidence-uploader"><input type="file" multiple accept=".jpg,.jpeg,.png,.pdf,.docx,.xlsx" onChange={(event) => setEvidenceFiles(Array.from(event.target.files ?? []).slice(0, 10))} /><button className="secondary" disabled={!!busy || !evidenceFiles.length} onClick={() => void uploadEvidence()}>{busy === 'upload-evidence' ? '上传中…' : `上传证据${evidenceFiles.length ? `（${evidenceFiles.length}）` : ''}`}</button><small>支持图片、PDF、Word、Excel；单文件不超过20MB。</small></div>}</section>
      {!!allowedActions.length && <section className="action-box"><label>处理说明<textarea rows={3} value={remark} onChange={(event) => setRemark(event.target.value)} placeholder="填写执行结果、验收意见或返工原因" /></label>{error && <div className="inline-error">{error}</div>}<div>{allowedActions.map((action) => <button className={action.tone === 'danger' ? 'danger-button' : 'primary'} disabled={!!busy || !remark.trim()} onClick={() => run(action.command)} key={action.command}>{busy === action.command ? '处理中…' : action.label}</button>)}</div></section>}
      {task.status === 'RESULT_SUBMITTED' && task.standardVersionId && isReviewer && permissions.includes('evaluation.manual-review') && <section className="action-box"><h3>任务结果标准评价</h3><p className="muted">系统使用任务创建时冻结的标准版本评价执行结果；评价完成后任务进入待验收状态。</p>{error && <div className="inline-error">{error}</div>}<div><button className="primary" disabled={!!busy} onClick={evaluateResult}>{busy === 'evaluate-result' ? '评价中…' : '按绑定标准评价结果'}</button></div></section>}
      <section className="detail-section"><h3>不可变时间线</h3><div className="timeline">{task.timeline?.length ? task.timeline.map((item) => <div key={item.id}><i /><span><strong>{label(item.toStatus)}</strong><small>{item.actorName} · {formatDate(item.occurredAt)}</small>{item.remark && <p>{item.remark}</p>}</span></div>) : <p className="muted">暂无流转记录。</p>}</div></section>
    </div>
  </aside></div>
}

const taskViews = ['mine', 'team', 'review'] as const

function Tasks({ identity, permissions, routeParams, go }: { identity: RoleContext; permissions: string[]; routeParams: RouteParams; go: Navigate }) {
  const requestedView = taskViews.includes(routeParams.view as typeof taskViews[number])
    ? routeParams.view as typeof taskViews[number]
    : identity.assignmentId ? 'mine' : 'team'
  const [taskView, setTaskView] = useState<typeof taskViews[number]>(requestedView)
  useEffect(() => setTaskView(requestedView), [requestedView])
  const statusFilter = (routeParams.status || 'ALL').toUpperCase()
  const serverStatus = ['ALL', 'ACTIVE', 'OVERDUE'].includes(statusFilter) ? undefined : statusFilter
  const taskQueryKey = `${taskView}:${serverStatus ?? 'all'}:${routeParams.hotelId ?? 'all'}`
  const resource = useResource(`${identity.key}:tasks:${taskQueryKey}`, () => loadTasks(identity, {
    view: taskView,
    status: serverStatus,
    orgUnitId: routeParams.hotelId,
  }), [], 15_000)
  const [selected, setSelected] = useState<ManagementTask>()
  const [linkedTaskError, setLinkedTaskError] = useState<string>()
  const [creating, setCreating] = useState(false)
  const tasks = resource.data.filter((item) => {
    if (statusFilter === 'ALL') return true
    if (statusFilter === 'ACTIVE') return !['COMPLETED', 'CANCELLED'].includes(item.status)
    if (statusFilter === 'OVERDUE') return item.slaStatus === 'OVERDUE'
    return item.status === statusFilter
  })
  useEffect(() => {
    if (!routeParams.taskId) return
    const linkedTask = resource.data.find((item) => item.id === routeParams.taskId)
    if (linkedTask) { setSelected(linkedTask); setLinkedTaskError(undefined); return }
    if (resource.loading) return
    let active = true
    setLinkedTaskError(undefined)
    void loadTask(identity, routeParams.taskId)
      .then((task) => { if (active) setSelected(task.data) })
      .catch((reason) => { if (active) setLinkedTaskError(reason instanceof Error ? reason.message : '任务详情加载失败') })
    return () => { active = false }
  }, [identity, resource.data, resource.loading, routeParams.taskId])
  const switchView = (next: typeof taskViews[number]) => {
    setTaskView(next)
    go('tasks', { ...routeParams, view: next, taskId: undefined })
  }
  const switchStatus = (next: string) => go('tasks', { ...routeParams, status: next === 'ALL' ? undefined : next, taskId: undefined })
  return <section className="page-section"><PageHeader eyebrow="TASK EXECUTION CENTER" title="任务中心" description="任务绑定责任任职、验收任职、来源标准和完整状态时间线。" actions={<><SourceFlag source={resource.source} />{permissions.includes('task.create') && <button className="primary" onClick={() => setCreating(true)}>＋ 新建任务</button>}</>} />
    <div className="filters"><button className={taskView === 'mine' ? 'active' : ''} onClick={() => switchView('mine')}>我的任务</button>{permissions.includes('task.review') && <><button className={taskView === 'review' ? 'active' : ''} onClick={() => switchView('review')}>待我验收</button><button className={taskView === 'team' ? 'active' : ''} onClick={() => switchView('team')}>团队任务</button></>}</div>
    <div className="filters task-status-filters">{['ALL', 'ACTIVE', 'AWAITING_REVIEW', 'OVERDUE', 'COMPLETED'].map((item) => <button className={statusFilter === item ? 'active' : ''} onClick={() => switchStatus(item)} key={item}>{item === 'ALL' ? '全部状态' : item === 'ACTIVE' ? '未完成' : item === 'OVERDUE' ? '已逾期' : label(item)}</button>)}</div>
    {linkedTaskError && <div className="inline-error page-error">{linkedTaskError}</div>}
    <article className="panel table-panel"><DataState loading={resource.loading} error={resource.error} empty={!tasks.length} onRetry={resource.reload} />{!resource.loading && !resource.error && !!tasks.length && <TaskRows tasks={tasks} onSelect={setSelected} />}</article>
    {selected && <TaskDetail initial={selected} identity={identity} permissions={permissions} onClose={() => { setSelected(undefined); if (routeParams.taskId) go('tasks', { ...routeParams, taskId: undefined }) }} onChanged={resource.reload} />}
    {creating && <TaskCreateDialog identity={identity} onClose={() => setCreating(false)} onCreated={resource.reload} />}
  </section>
}

function EvaluationDetail({ initial, identity, onClose }: { initial: StandardEvaluation; identity: RoleContext; onClose: () => void }) {
  const resource = useResource(`${identity.key}:evaluation:${initial.id}`, () => loadEvaluation(identity, initial.id, initial), initial)
  const evaluation = resource.data
  return <div className="drawer-backdrop"><aside className="drawer"><header><div><span className="panel-kicker">STANDARD EVALUATION</span><h2>{evaluation.subjectTitle}</h2><small>{evaluation.standardCode} · V{evaluation.standardVersion}</small></div><button className="close" onClick={onClose}>×</button></header><div className="drawer-body">
    <DataState loading={resource.loading} error={resource.error} onRetry={resource.reload} />
    {!resource.loading && !resource.error && <><div className="score-block"><div><strong>{evaluation.score ?? '—'}</strong><span>标准评分</span></div><span><Status value={evaluation.outcome} /><small>{evaluation.standardTitle}</small></span></div>
    <dl><div><dt>评价对象</dt><dd>{label(evaluation.subjectType)}</dd></div><div><dt>目标组织</dt><dd>{evaluation.targetOrgName}</dd></div><div><dt>执行状态</dt><dd>{label(evaluation.executionStatus)}</dd></div><div><dt>评价时间</dt><dd>{formatDate(evaluation.evaluatedAt)}</dd></div></dl>
    <section className="detail-section"><h3>逐项判断</h3>{evaluation.items?.length ? <div className="evaluation-items">{evaluation.items.map((item) => <div key={item.id}><span><strong>{item.itemName}</strong><small>{item.reason ?? `${item.actual ?? '—'} / ${item.expected ?? '—'}`}</small></span><Status value={item.outcome} /></div>)}</div> : <p className="muted">当前评价没有逐项结果。</p>}</section></>}
  </div></aside></div>
}

function Evaluations({ identity, routeParams, go }: { identity: RoleContext; routeParams: RouteParams; go: Navigate }) {
  const outcomeFilter = (routeParams.outcome || 'ALL').toUpperCase()
  const evaluationQueryKey = `${routeParams.hotelId ?? 'all'}:${outcomeFilter}`
  const resource = useResource(`${identity.key}:evaluations:${evaluationQueryKey}`, () => loadEvaluations(identity, {
    orgUnitId: routeParams.hotelId,
    outcome: outcomeFilter === 'ALL' ? undefined : outcomeFilter,
  }), [], 30_000)
  const [selected, setSelected] = useState<StandardEvaluation>()
  const [linkedEvaluationError, setLinkedEvaluationError] = useState<string>()
  const evaluations = outcomeFilter === 'ALL' ? resource.data : resource.data.filter((item) => item.outcome === outcomeFilter)
  useEffect(() => {
    if (!routeParams.evaluationId) return
    const linkedEvaluation = resource.data.find((item) => item.id === routeParams.evaluationId)
    if (linkedEvaluation) { setSelected(linkedEvaluation); setLinkedEvaluationError(undefined); return }
    if (resource.loading) return
    let active = true
    setLinkedEvaluationError(undefined)
    void loadEvaluation(identity, routeParams.evaluationId)
      .then((evaluation) => { if (active) setSelected(evaluation.data) })
      .catch((reason) => { if (active) setLinkedEvaluationError(reason instanceof Error ? reason.message : '评价详情加载失败') })
    return () => { active = false }
  }, [identity, resource.data, resource.loading, routeParams.evaluationId])
  return <section className="page-section"><PageHeader eyebrow="STANDARD EVALUATION" title="标准评价" description="评价永远引用已发布标准版本和输入快照，结果可解释、可复算。" actions={<SourceFlag source={resource.source} />} />
    <div className="filters">{['ALL', 'FAIL', 'WARNING', 'PASS', 'PENDING'].map((item) => <button className={outcomeFilter === item ? 'active' : ''} onClick={() => go('evaluations', { ...routeParams, outcome: item === 'ALL' ? undefined : item, evaluationId: undefined })} key={item}>{item === 'ALL' ? '全部结果' : label(item)}</button>)}</div>
    {linkedEvaluationError && <div className="inline-error page-error">{linkedEvaluationError}</div>}
    <article className="panel table-panel"><DataState loading={resource.loading} error={resource.error} empty={!evaluations.length} onRetry={resource.reload} />{!resource.loading && !resource.error && !!evaluations.length && <div className="data-table evaluation-table"><div className="table-row table-head"><span>评价对象</span><span>引用标准</span><span>目标组织</span><span>评分</span><span>结果</span><span>操作</span></div>{evaluations.map((item) => <div className="table-row" key={item.id}><span><strong>{item.subjectTitle}</strong><small>{label(item.subjectType)} · {formatDate(item.evaluatedAt)}</small></span><span>{item.standardTitle}<small>{item.standardCode} · V{item.standardVersion}</small></span><span>{item.targetOrgName}</span><span className="score">{item.score ?? '—'}</span><span><Status value={item.outcome} /></span><span><button className="link-button" onClick={() => setSelected(item)}>查看逐项判断</button></span></div>)}</div>}</article>
    {selected && <EvaluationDetail initial={selected} identity={identity} onClose={() => { setSelected(undefined); if (routeParams.evaluationId) go('evaluations', { ...routeParams, evaluationId: undefined }) }} />}
  </section>
}

function Notifications({ identity, routeParams, go }: { identity: RoleContext; routeParams: RouteParams; go: Navigate }) {
  const resource = useResource(`${identity.key}:notifications`, () => loadNotifications(identity), [], 15_000)
  const [busy, setBusy] = useState<string>()
  const [commandError, setCommandError] = useState<string>()
  const unreadOnly = routeParams.unread === 'true'
  const notices = unreadOnly ? resource.data.filter((item) => !item.readAt) : resource.data
  const markRead = async (id: string) => {
    setBusy(id); setCommandError(undefined)
    try {
      const item = resource.data.find((notice) => notice.id === id)
      await apiCommand(`/notifications/${id}/read`, identity, {}, item?.version ?? 0)
      resource.setData(resource.data.map((item) => item.id === id ? { ...item, readAt: new Date().toISOString(), version: item.version + 1 } : item))
    } catch (error) { setCommandError(error instanceof Error ? error.message : '通知处理失败') }
    finally { setBusy(undefined) }
  }
  return <section className="page-section"><PageHeader eyebrow="NOTIFICATION CENTER" title="通知中心" description="任务提醒、逾期、返工和升级集中送达；通知不替代任务主状态。" actions={<SourceFlag source={resource.source} />} />
    <div className="filters"><button className={!unreadOnly ? 'active' : ''} onClick={() => go('notifications')}>全部通知</button><button className={unreadOnly ? 'active' : ''} onClick={() => go('notifications', { unread: 'true' })}>仅未读</button></div>
    {commandError && <div className="inline-error page-error">{commandError}</div>}
    <DataState loading={resource.loading} error={resource.error} empty={!notices.length} onRetry={resource.reload} />
    {!resource.loading && !resource.error && <div className="notification-page">{notices.map((item) => <article className={item.readAt ? 'read' : ''} key={item.id}><i /><div><span><Status value={item.type} /><small>{formatDate(item.createdAt)}</small></span><h2>{item.title}</h2><p>{item.content}</p></div>{!item.readAt && <button className="secondary" disabled={busy === item.id} onClick={() => markRead(item.id)}>{busy === item.id ? '处理中…' : '标记已读'}</button>}</article>)}</div>}
  </section>
}

function LoginPage({ onAuthenticated }: { onAuthenticated: () => void }) {
  const [loginName, setLoginName] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState(false)
  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    setBusy(true); setError(undefined)
    try {
      await login(loginName, password)
      onAuthenticated()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '登录失败')
    } finally { setBusy(false) }
  }
  return <main className="login-screen">
    <section className="login-brand"><div className="login-logo">四</div><div><span className="eyebrow">HOTEL AI OS · PILOT</span><h1>{product.name}</h1><p>以真实账号进入门店管理闭环。系统按组织、任职与角色自动隔离数据。</p></div></section>
    <form className="login-card" onSubmit={submit}>
      <header><span className="panel-kicker">INTERNAL PILOT ACCESS</span><h2>内部测试登录</h2><p>请输入管理员分配的测试账号和初始密码。</p></header>
      <label>登录账号<input autoFocus autoComplete="username" value={loginName} onChange={(event) => setLoginName(event.target.value)} placeholder="例如 gm.hz" /></label>
      <label>登录密码<input type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="至少 10 位" /></label>
      {error && <div className="inline-error">{error}</div>}
      <button className="primary login-submit" disabled={busy || !loginName.trim() || !password}>{busy ? '正在验证…' : '登录中台'}</button>
      <small>内部测试系统 · 所有关键操作记录账号、组织和时间</small>
    </form>
  </main>
}

function AuthenticatedApp({ onLogout }: { onLogout?: () => void }) {
  const [route, navigate] = useHashRoute()
  const { view, params: routeParams } = route
  let storedRole: string | null = null
  try { storedRole = localStorage.getItem(roleStorageKey) } catch { /* private mode may disable storage */ }
  const [identity, setIdentity] = useState<RoleContext>(() => roleContexts.find((role) => role.key === storedRole) ?? roleContexts.find((role) => role.key === 'front-desk') ?? roleContexts[0])
  const fallbackIdentity: IdentitySnapshot = useMemo(() => ({
    accountId: identity.actorId,
    displayName: identity.userName,
    primaryRoleCode: identity.roleCode,
    roleCodes: [identity.roleCode],
    permissions: [],
    tenantScope: false,
    orgScopes: identity.orgScopes,
    assignments: identity.assignmentId ? [{
      id: identity.assignmentId,
      orgUnitId: identity.orgScopes[0] ?? '',
      orgName: identity.orgName,
      positionId: '',
      positionCode: identity.roleCode,
      positionName: identity.label,
      primary: true,
      assignmentType: 'PERMANENT',
    }] : [],
  }), [identity])
  const me = useResource(`${identity.key}:me`, () => loadIdentity(identity, fallbackIdentity), fallbackIdentity)
  const [selectedAssignmentId, setSelectedAssignmentId] = useState(identity.assignmentId ?? '')
  useEffect(() => {
    const preferred = me.data.assignments.find((item) => item.primary) ?? me.data.assignments[0]
    setSelectedAssignmentId(preferred?.id ?? (authMode === 'bearer' ? '' : identity.assignmentId ?? ''))
  }, [identity.key, me.data.assignments])
  const selectedAssignment = me.data.assignments.find((item) => item.id === selectedAssignmentId)
    ?? me.data.assignments.find((item) => item.primary)
    ?? me.data.assignments[0]
  const resolvedRoleContext = roleContexts.find((role) => role.roleCode === me.data.primaryRoleCode)
  const activeIdentity: RoleContext = useMemo(() => ({
    ...(resolvedRoleContext ?? identity),
    key: `${resolvedRoleContext?.key ?? identity.key}:${selectedAssignment?.id ?? 'account'}`,
    actorId: me.data.accountId || identity.actorId,
    userName: me.data.displayName || identity.userName,
    employeeId: me.data.employeeId,
    assignmentOrgUnitId: selectedAssignment?.orgUnitId,
    roleCode: me.data.primaryRoleCode || identity.roleCode,
    orgScopes: authMode === 'bearer' ? me.data.orgScopes : me.data.orgScopes.length ? me.data.orgScopes : identity.orgScopes,
    assignmentId: selectedAssignment?.id ?? (authMode === 'bearer' ? undefined : identity.assignmentId),
    label: selectedAssignment?.positionName ?? resolvedRoleContext?.label ?? identity.label,
    orgName: selectedAssignment?.orgName ?? resolvedRoleContext?.orgName ?? identity.orgName,
    focus: resolvedRoleContext?.focus ?? identity.focus,
  }), [identity, me.data, resolvedRoleContext, selectedAssignment])
  const unreadResource = useResource(`${identity.key}:sidebar-notices`, () => loadNotifications(activeIdentity), [], 15_000)
  const unreadCount = unreadResource.data.filter((item) => !item.readAt).length
  const pilotDemoMode = demoFallbackEnabled && me.source === 'demo'
  const visibleNavigation = navigation.filter((item) => {
    if (item.id === 'my-work' && !activeIdentity.assignmentId) return false
    if (item.roles?.length && !item.roles.includes(activeIdentity.roleCode)) return false
    return !item.permissions?.length ||
      (demoFallbackEnabled && me.source === 'demo') ||
      item.permissions.some((permission) => me.data.permissions.includes(permission))
  })
  const page = useMemo(() => {
    if (authMode === 'bearer' && (me.loading || me.error)) {
      return <section className="page-section"><div className="empty-state"><strong>{me.error ? '身份与权限读取失败' : '正在读取身份与权限'}</strong><span>{me.error ?? '系统将在权限解析完成后加载业务页面，避免使用错误的岗位或组织范围。'}</span></div></section>
    }
    switch (view) {
      case 'workbench': return <Workbench identity={activeIdentity} permissions={me.data.permissions} go={navigate} />
      case 'hotel-dashboard': return <HotelDashboardPage identity={activeIdentity} routeParams={routeParams} go={navigate} />
      case 'operations-dashboard': return <OperationsDashboardPage identity={activeIdentity} />
      case 'work-packages': return <WorkPackageCenter identity={activeIdentity} permissions={me.data.permissions} />
      case 'my-work': return <MyWork identity={activeIdentity} routeParams={routeParams} go={navigate} />
      case 'team-work': return <TeamWork identity={activeIdentity} permissions={me.data.permissions} routeParams={routeParams} />
      case 'rules': return <Rules identity={activeIdentity} permissions={me.data.permissions} />
      case 'tasks': return <Tasks identity={activeIdentity} permissions={me.data.permissions} routeParams={routeParams} go={navigate} />
      case 'evaluations': return <Evaluations identity={activeIdentity} routeParams={routeParams} go={navigate} />
      case 'notifications': return <Notifications identity={activeIdentity} routeParams={routeParams} go={navigate} />
      case 'templates': return <EnterpriseTemplateCenter identity={activeIdentity} permissions={me.data.permissions} />
      case 'organization': return <OrganizationCenter identity={activeIdentity} permissions={me.data.permissions} />
    }
  }, [view, routeParams, activeIdentity, me.data.permissions, me.error, me.loading])
  const changeRole = (key: string) => {
    const next = roleContexts.find((role) => role.key === key)
    if (!next) return
    try { localStorage.setItem(roleStorageKey, next.key) } catch { /* role still changes for this session */ }
    setIdentity(next)
    navigate('workbench')
  }

  return <div className="shell">
    <aside className="sidebar"><div className="brand-mark"><div>四</div><span><strong>{product.name}</strong><small>{product.edition} · {product.editionLabel}</small></span></div>
      <nav>{visibleNavigation.map((item, index) => <div key={item.id}>{item.group && <span className="nav-group">{item.group}</span>}<button className={view === item.id ? 'active' : ''} onClick={() => navigate(item.id)}><i>{item.icon}</i><span>{item.label}</span>{item.id === 'notifications' && unreadCount > 0 && <b>{unreadCount}</b>}</button>{index === 0 && <div className="nav-separator" />}</div>)}</nav>
      <div className="sidebar-footer"><span>{product.version}</span><small>标准 → 工作 → 任务 → 执行 → 验收</small></div>
    </aside>
    <main><header className="topbar"><div className={`connection ${me.error ? 'offline' : pilotDemoMode ? 'demo' : ''}`}><span className="live-dot" />{pilotDemoMode ? 'Pilot 演示数据' : me.error ? '身份接口异常' : '服务端权限已解析'}<small>{pilotDemoMode ? '仅用于界面与流程走查，不代表真实业务数据或权限' : authMode === 'dev-header' ? '本地验收账号 · 权限由数据库决定' : 'JWT/SSO 会话身份'}</small></div><span className="pilot-badge">{product.editionLabel}</span>
      {authMode === 'dev-header' && <label className="context-select"><span>验收账号</span><select value={identity.key} onChange={(event) => changeRole(event.target.value)}>{roleContexts.map((role) => <option value={role.key} key={role.key}>{role.label} · {role.userName}</option>)}</select></label>}
      {!!me.data.assignments.length && <label className="context-select"><span>当前任职</span><select value={selectedAssignment?.id ?? ''} onChange={(event) => setSelectedAssignmentId(event.target.value)}>{me.data.assignments.map((assignment) => <option value={assignment.id} key={assignment.id}>{assignment.positionName} · {assignment.orgName}{assignment.primary ? '（主岗）' : ''}</option>)}</select></label>}
      <button className="bell" onClick={() => navigate('notifications')} aria-label="通知">◉{unreadCount > 0 && <b>{unreadCount}</b>}</button>
      <div className="user"><span>{activeIdentity.userName.slice(-1)}</span><div><strong>{activeIdentity.userName}</strong><small>{activeIdentity.label}</small></div></div>
      {authMode === 'bearer' && <button className="logout-button" onClick={onLogout}>退出</button>}
    </header>
      {demoFallbackEnabled && <div className="demo-warning">已显式启用演示回退：仅当真实 API 请求失败时展示演示数据；API 返回空结果时仍显示空状态。</div>}
      <div className="canvas">{page}</div>
    </main>
  </div>
}

export default function App() {
  const [authenticated, setAuthenticated] = useState(() => authMode !== 'bearer' || hasAccessToken())
  useEffect(() => {
    const expired = () => setAuthenticated(false)
    window.addEventListener('hotel-ai-os:auth-expired', expired)
    return () => window.removeEventListener('hotel-ai-os:auth-expired', expired)
  }, [])
  if (!authenticated) return <LoginPage onAuthenticated={() => setAuthenticated(true)} />
  return <AuthenticatedApp onLogout={() => { clearAccessToken(); setAuthenticated(false) }} />
}
