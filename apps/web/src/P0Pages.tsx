import { useEffect, useMemo, useState } from 'react'
import { demoFallbackEnabled } from './api/client'
import {
  createCorrectiveTask,
  createWorkRecordEvaluation,
  loadAttachmentContent,
  loadHotelDashboard,
  loadOperationsDashboard,
  loadTeamWork,
  loadTeamWorkCase,
  reviewWorkRecord,
} from './api/resources'
import type {
  ApiSource,
  ManagementTask,
  RoleContext,
  TeamWorkCase,
  WorkExpectation,
  WorkRecordAttachment,
} from './domain'
import { useResource } from './useResource'

const statusLabels: Record<string, string> = {
  PLANNED: '待开放', AVAILABLE: '可填报', PENDING: '待完成', IN_PROGRESS: '执行中',
  SUBMITTED: '已提交', APPROVED: '复核通过', REJECTED: '已退回', SATISFIED: '已达标',
  FAILED: '未达标', MISSED: '已漏交', COMPLETED: '已完成', OVERDUE: '已逾期',
  PROPOSED: '待派发', PENDING_ACK: '待确认', RESULT_SUBMITTED: '结果已提交',
  AWAITING_REVIEW: '待验收', REWORK: '返工中', CANCELLED: '已取消',
  PASS: '通过', WARN: '预警', WARNING: '预警', FAIL: '不通过', OPEN: '待处理',
  ON_TIME: '正常', DUE_SOON: '即将到期', ESCALATED: '已升级',
  LOW: '低', NORMAL: '普通', HIGH: '高', URGENT: '紧急', CLEAN: '安全', PENDING_SCAN: '待扫描',
}

function label(value?: string) {
  return value ? statusLabels[value] ?? value : '—'
}

function formatDate(value?: string) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).format(date)
}

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function Status({ value }: { value: string }) {
  return <span className={`status-pill ${value.toLowerCase().replaceAll('_', '-')}`}>{label(value)}</span>
}

function SourceFlag({ source }: { source: ApiSource }) {
  return <span className={`source-flag ${source}`}>{source === 'demo' ? '演示回退' : '实时 API'}</span>
}

function LoadingState({ loading, error, empty, retry }: { loading: boolean; error?: string; empty?: boolean; retry: () => void }) {
  if (loading) return <div className="state-card"><div className="spinner" /><strong>正在读取业务数据</strong><span>数据范围由服务端权限决定</span></div>
  if (error) return <div className="state-card error-state"><b>!</b><strong>数据读取失败</strong><span>{error}</span><button className="secondary" onClick={retry}>重新加载</button></div>
  if (empty) return <div className="state-card"><b>◇</b><strong>当前范围暂无数据</strong><span>系统不会用演示数据覆盖真实空结果。</span></div>
  return null
}

function PageHeader({ eyebrow, title, description, source }: { eyebrow: string; title: string; description: string; source: ApiSource }) {
  return <header className="page-title"><div><span className="eyebrow">{eyebrow}</span><h1>{title}</h1><p>{description}</p></div><div className="page-actions"><SourceFlag source={source} /></div></header>
}

function demoScopedTeam(items: WorkExpectation[], roleCode: string) {
  if (roleCode === 'HOUSEKEEPING_SUPERVISOR') return items.filter((item) => item.targetOrgName.includes('客房'))
  if (roleCode === 'FRONT_OFFICE_SUPERVISOR') return items.filter((item) => !item.targetOrgName.includes('客房') && !item.packageName.includes('OTA'))
  return items
}

export function TeamWorkPage({ identity, permissions }: { identity: RoleContext; permissions: string[] }) {
  const resource = useResource(`${identity.key}:p0-team-work`, () => loadTeamWork(identity), [])
  const [selected, setSelected] = useState<WorkExpectation>()
  const items = resource.source === 'demo' ? demoScopedTeam(resource.data, identity.roleCode) : resource.data
  const submitted = items.filter((item) => ['SUBMITTED', 'COMPLETED', 'SATISFIED'].includes(item.status)).length
  const exception = items.filter((item) => ['OVERDUE', 'MISSED', 'FAILED'].includes(item.status) || ['FAIL', 'WARNING'].includes(item.evaluationOutcome ?? '')).length

  return <section className="page-section">
    <PageHeader eyebrow="TEAM EXECUTION" title="团队工作看板" description="查看团队记录详情、完成复核，并从异常工作记录创建可验收的整改任务。" source={resource.source} />
    <section className="mini-metrics"><span><strong>{items.length}</strong>范围内工作</span><span><strong>{submitted}</strong>已提交/完成</span><span className="danger"><strong>{exception}</strong>异常与逾期</span><span><strong>{items.length ? Math.round(submitted / items.length * 100) : 0}%</strong>完成率</span></section>
    <article className="panel table-panel">
      <LoadingState loading={resource.loading} error={resource.error} empty={!items.length} retry={resource.reload} />
      {!resource.loading && !resource.error && !!items.length && <div className="data-table p0-team-table">
        <div className="table-row table-head"><span>工作记录</span><span>目标组织</span><span>负责人</span><span>评价</span><span>状态</span><span>管理操作</span></div>
        {items.map((item) => <div className="table-row" key={item.id}>
          <span><strong>{item.title}</strong><small>{item.packageName} · {item.itemName}</small></span>
          <span>{item.targetOrgName}</span><span>{item.assigneeName}<small>{formatDate(item.dueAt)}</small></span>
          <span>{item.evaluationOutcome ? <Status value={item.evaluationOutcome} /> : '—'}</span><span><Status value={item.status} /></span>
          <span><button className="link-button" onClick={() => setSelected(item)}>详情、复核与整改</button></span>
        </div>)}
      </div>}
    </article>
    {selected && <TeamWorkDrawer initial={selected} identity={identity} permissions={permissions} onClose={() => setSelected(undefined)} onChanged={resource.reload} />}
  </section>
}

function AttachmentList({ items, disabled, onPreview }: {
  items: WorkRecordAttachment[]
  disabled: boolean
  onPreview: (item: WorkRecordAttachment) => void
}) {
  if (!items.length) return <p className="muted">尚未上传现场图片或附件。</p>
  return <div className="attachment-list">{items.map((item) => <div key={item.id}>
    <span className="attachment-icon">▧</span><span><strong>{item.originalName}</strong><small>{formatSize(item.sizeBytes)} · {label(item.scanStatus)} · {formatDate(item.createdAt)}</small></span>
    <button className="link-button" disabled={disabled} onClick={() => onPreview(item)}>查看</button>
  </div>)}</div>
}

function TeamWorkDrawer({ initial, identity, permissions, onClose, onChanged }: {
  initial: WorkExpectation
  identity: RoleContext
  permissions: string[]
  onClose: () => void
  onChanged: () => void
}) {
  const fallback: TeamWorkCase = useMemo(() => ({ expectation: initial }), [initial])
  const resource = useResource(`${identity.key}:team-case:${initial.id}`, () => loadTeamWorkCase(identity, initial), fallback)
  const { expectation, record } = resource.data
  const [reviewReason, setReviewReason] = useState('')
  const [taskTitle, setTaskTitle] = useState(`整改：${initial.title}`)
  const [taskDescription, setTaskDescription] = useState('请根据工作标准完成整改，补充结果说明和现场证据。')
  const [taskPriority, setTaskPriority] = useState('NORMAL')
  const [taskDueAt, setTaskDueAt] = useState(() => new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 16))
  const [selectedStandard, setSelectedStandard] = useState('')
  const [busy, setBusy] = useState<string>()
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string }>()
  const [previewUrl, setPreviewUrl] = useState<string>()
  const standards = expectation.standards ?? []
  const isDemo = resource.source === 'demo'
  const allows = (permission: string) => permissions.includes(permission) || (demoFallbackEnabled && isDemo)

  useEffect(() => {
    if (!selectedStandard && standards.length) setSelectedStandard(standards[0].standardVersionId)
  }, [selectedStandard, standards])
  useEffect(() => () => { if (previewUrl) URL.revokeObjectURL(previewUrl) }, [previewUrl])

  const mutation = async (name: string, action: () => Promise<unknown>, success: string) => {
    if (isDemo) { setMessage({ tone: 'error', text: '演示回退仅用于页面走查，不会向业务系统写入数据。' }); return }
    setBusy(name); setMessage(undefined)
    try {
      await action(); setMessage({ tone: 'ok', text: success }); await resource.reload(); onChanged()
    } catch (error) { setMessage({ tone: 'error', text: error instanceof Error ? error.message : '操作失败' }) }
    finally { setBusy(undefined) }
  }

  const review = (outcome: 'APPROVED' | 'REJECTED') => {
    if (!record) return
    void mutation(`review-${outcome}`, () => reviewWorkRecord(identity, record.id, outcome, reviewReason, record.rowVersion), outcome === 'APPROVED' ? '工作记录复核通过。' : '工作记录已退回。')
  }

  const createTask = () => {
    if (!record?.targetOrgUnitId || !record.positionAssignmentId || !identity.assignmentId) {
      setMessage({ tone: 'error', text: '记录缺少目标组织、执行任职或当前验收任职，无法安全创建任务。' }); return
    }
    if (record.positionAssignmentId === identity.assignmentId) {
      setMessage({ tone: 'error', text: '负责人和验收人不能是同一任职。' }); return
    }
    void mutation('task', () => createCorrectiveTask(identity, {
      orgUnitId: record.targetOrgUnitId!, assigneeAssignmentId: record.positionAssignmentId!, reviewerAssignmentId: identity.assignmentId!,
      standardVersionId: selectedStandard || undefined, workRecordId: record.id, title: taskTitle,
      description: taskDescription, priority: taskPriority, dueAt: taskDueAt ? new Date(taskDueAt).toISOString() : undefined,
    }), '整改任务已创建，责任人与验收人已冻结。')
  }

  const preview = async (attachment: WorkRecordAttachment) => {
    if (isDemo) { setMessage({ tone: 'error', text: '演示附件没有真实文件内容。' }); return }
    setBusy(`preview-${attachment.id}`)
    try {
      const blob = await loadAttachmentContent(identity, attachment.id)
      if (previewUrl) URL.revokeObjectURL(previewUrl)
      setPreviewUrl(URL.createObjectURL(blob))
    } catch (error) { setMessage({ tone: 'error', text: error instanceof Error ? error.message : '附件读取失败' }) }
    finally { setBusy(undefined) }
  }

  const evaluate = () => {
    if (!record || !selectedStandard) { setMessage({ tone: 'error', text: '必须选择工作包绑定的已发布标准版本。' }); return }
    void mutation('evaluation', () => createWorkRecordEvaluation(identity, { record, standardVersionId: selectedStandard }), '标准评价已创建，可进入评价中心查看逐项结果。')
  }

  return <div className="drawer-backdrop"><aside className="drawer p0-drawer" role="dialog" aria-modal="true">
    <header><div><span className="panel-kicker">TEAM WORK DETAIL</span><h2>{expectation.title}</h2><small>{expectation.targetOrgName} · {expectation.assigneeName}</small></div><button className="close" onClick={onClose}>×</button></header>
    <div className="drawer-body">
      <LoadingState loading={resource.loading} error={resource.error} retry={resource.reload} />
      {!resource.loading && !resource.error && <>
        <div className="task-summary"><span><small>工作状态</small><Status value={expectation.status} /></span><span><small>评价结果</small>{expectation.evaluationOutcome ? <Status value={expectation.evaluationOutcome} /> : '—'}</span><span><small>截止时间</small><strong>{formatDate(expectation.dueAt)}</strong></span></div>
        {!record ? <div className="inline-warning">该工作期望尚未形成可复核的工作记录。</div> : <>
          <section className="detail-section"><h3>记录事实</h3><dl><div><dt>提交员工</dt><dd>{record.employeeName}</dd></div><div><dt>执行岗位</dt><dd>{record.positionName}</dd></div><div><dt>记录状态</dt><dd>{label(record.status)}</dd></div><div><dt>提交时间</dt><dd>{formatDate(record.submittedAt)}</dd></div></dl><div className="payload-grid">{Object.entries(record.payload).map(([key, raw]) => <span key={key}><small>{key}</small><strong>{typeof raw === 'object' ? JSON.stringify(raw) : String(raw ?? '—')}</strong></span>)}</div>{record.reviewReason && <div className="inline-warning">上次复核意见：{record.reviewReason}</div>}</section>

          <section className="detail-section"><h3>现场图片与附件</h3>
            <p className="muted">团队工作仅复核员工提交的证据；附件上传、补充和删除由记录所属员工在“我的工作”中完成。</p>
            <AttachmentList items={record.attachments} disabled={!!busy || isDemo} onPreview={preview} />
            {previewUrl && <div className="attachment-preview"><img src={previewUrl} alt="现场附件预览" /><button className="close" onClick={() => { URL.revokeObjectURL(previewUrl); setPreviewUrl(undefined) }}>×</button></div>}
          </section>

          {allows('work-record.review') && <section className="action-box"><h3>工作记录复核</h3><p className="muted">复核只判断记录是否完整，不替代标准评价和任务验收。</p><label>复核意见<textarea rows={2} value={reviewReason} onChange={(event) => setReviewReason(event.target.value)} placeholder="退回时必须填写原因" /></label><div><button className="primary" disabled={!!busy || record.status !== 'SUBMITTED' || isDemo} onClick={() => review('APPROVED')}>复核通过</button><button className="danger-button" disabled={!!busy || record.status !== 'SUBMITTED' || !reviewReason.trim() || isDemo} onClick={() => review('REJECTED')}>退回补充</button></div></section>}

          {allows('evaluation.manual-review') && <section className="action-box"><h3>创建标准评价</h3><label>评价依据<select value={selectedStandard} onChange={(event) => setSelectedStandard(event.target.value)}><option value="">请选择已发布标准</option>{standards.map((standard) => <option value={standard.standardVersionId} key={standard.standardVersionId}>{standard.standardCode} · {standard.title} V{standard.versionNo}</option>)}</select></label>{!standards.length && <div className="inline-warning">工作包条目尚未返回绑定标准，不能由页面猜测评价依据。</div>}<div><button className="primary" disabled={!!busy || !selectedStandard || isDemo} onClick={evaluate}>{busy === 'evaluation' ? '创建中…' : '按标准创建评价'}</button></div></section>}

          {allows('task.create') && <section className="action-box"><h3>创建整改任务</h3><div className="form-grid"><label>任务标题<input value={taskTitle} onChange={(event) => setTaskTitle(event.target.value)} /></label><label>优先级<select value={taskPriority} onChange={(event) => setTaskPriority(event.target.value)}><option value="LOW">低</option><option value="NORMAL">普通</option><option value="HIGH">高</option><option value="URGENT">紧急</option></select></label><label>完成时限<input type="datetime-local" value={taskDueAt} onChange={(event) => setTaskDueAt(event.target.value)} /></label></div><label>整改要求<textarea rows={3} value={taskDescription} onChange={(event) => setTaskDescription(event.target.value)} /></label><div><button className="primary" disabled={!!busy || !taskTitle.trim() || !taskDescription.trim() || isDemo} onClick={createTask}>{busy === 'task' ? '创建中…' : '创建整改任务'}</button></div></section>}
        </>}
        {isDemo && <div className="inline-warning">当前为演示回退：所有P0操作入口可见，但写操作被保护性禁用。</div>}
        {message && <div className={message.tone === 'ok' ? 'inline-success' : 'inline-error'}>{message.text}</div>}
      </>}
    </div>
  </aside></div>
}

function TaskList({ tasks }: { tasks: ManagementTask[] }) {
  if (!tasks.length) return <p className="muted">当前门店没有未完成任务。</p>
  return <div className="dashboard-task-list">{tasks.map((task) => <div key={task.id}><span><strong>{task.title}</strong><small>{task.assigneeName} · 截止 {formatDate(task.dueAt)}</small></span><span><Status value={task.slaStatus} /><Status value={task.status} /></span></div>)}</div>
}

export function HotelDashboardPage({ identity }: { identity: RoleContext }) {
  const hotelId = identity.assignmentOrgUnitId ?? identity.orgScopes[0] ?? ''
  const resource = useResource(`${identity.key}:hotel-dashboard:${hotelId}`, () => loadHotelDashboard(identity, hotelId), {
    hotel: { id: hotelId, name: identity.orgName }, activeEmployeeCount: 0, todayWorkSubmissionCount: 0, latestMetrics: [], risks: [], incompleteTasks: [],
  })
  const dashboard = resource.data
  const sections = new Set(dashboard.templateSections?.length ? dashboard.templateSections : ['OPERATING_METRICS', 'RISKS', 'INCOMPLETE_TASKS', 'WORK_COMPLETION'])
  const overdue = dashboard.incompleteTasks.filter((task) => ['OVERDUE', 'ESCALATED'].includes(task.slaStatus)).length
  const highRisks = dashboard.risks.filter((risk) => ['HIGH', 'URGENT'].includes(risk.severity)).length

  return <section className="page-section">
    <PageHeader eyebrow="HOTEL MANAGEMENT COCKPIT" title={`${dashboard.hotel.name}门店驾驶舱`} description="店总视角聚合经营指标、风险事项与未完成任务；所有明细仍回到原始记录和任务。" source={resource.source} />
    <LoadingState loading={resource.loading} error={resource.error || (!hotelId ? '当前任职缺少门店组织。' : undefined)} retry={resource.reload} />
    {!resource.loading && !resource.error && !!hotelId && <>
      <section className="metrics-grid p0-dashboard-metrics"><article className="metric blue"><div>员</div><span>在岗员工<strong>{dashboard.activeEmployeeCount}</strong><small>{dashboard.hotel.city ?? '当前门店'} · {dashboard.hotel.roomCount ?? '—'}间客房</small></span></article>{sections.has('WORK_COMPLETION') && <article className="metric teal"><div>工</div><span>今日工作提交<strong>{dashboard.todayWorkSubmissionCount}</strong><small>岗位工作记录</small></span></article>}{sections.has('RISKS') && <article className="metric gold"><div>险</div><span>开放风险<strong>{dashboard.risks.length}</strong><small>{highRisks}项高风险</small></span></article>}{sections.has('INCOMPLETE_TASKS') && <article className="metric violet"><div>任</div><span>未完成任务<strong>{dashboard.incompleteTasks.length}</strong><small>{overdue}项已逾期/升级</small></span></article>}</section>
      <section className="dashboard-grid">
        {sections.has('OPERATING_METRICS') && <article className="panel span-3"><header><div><span className="panel-kicker">LATEST OPERATING METRICS</span><h2>门店经营快照</h2></div></header><div className="operation-metric-grid">{dashboard.latestMetrics.map((metric) => <div key={metric.code}><span>{metric.name}</span><strong>{metric.value.toLocaleString('zh-CN')}{metric.unit === 'PERCENT' ? '%' : ''}</strong><small>{metric.code} · {metric.businessDate ?? '最新'}</small></div>)}</div>{!dashboard.latestMetrics.length && <p className="muted">暂无经营指标。</p>}</article>}
        {sections.has('RISKS') && <article className="panel"><header><div><span className="panel-kicker">RISK ITEMS</span><h2>风险事项</h2></div></header><div className="risk-list">{dashboard.risks.map((risk) => <div key={risk.id}><i /><span><strong>{risk.title}</strong><small>{risk.ownerName ?? risk.source ?? label(risk.type)} · {formatDate(risk.occurredAt)}</small></span><Status value={risk.severity} /></div>)}</div>{!dashboard.risks.length && <p className="muted">当前没有开放风险。</p>}</article>}
        {sections.has('INCOMPLETE_TASKS') && <article className="panel span-2"><header><div><span className="panel-kicker">INCOMPLETE TASKS</span><h2>未完成任务汇总</h2></div><button className="link-button" onClick={() => { window.location.hash = '/tasks' }}>进入任务中心</button></header><TaskList tasks={dashboard.incompleteTasks} /></article>}
      </section>
    </>}
  </section>
}

export function OperationsDashboardPage({ identity }: { identity: RoleContext }) {
  const resource = useResource(`${identity.key}:operations-dashboard`, () => loadOperationsDashboard(identity), { hotels: [] })
  const hotels = resource.data.hotels
  const totals = hotels.reduce((sum, hotel) => ({
    open: sum.open + hotel.openTaskCount,
    overdue: sum.overdue + hotel.overdueTaskCount,
    failed: sum.failed + hotel.failedEvaluationCount,
    missed: sum.missed + hotel.missedWorkCount,
    submitted: sum.submitted + hotel.todaySubmissionCount,
  }), { open: 0, overdue: 0, failed: 0, missed: 0, submitted: 0 })

  return <section className="page-section">
    <PageHeader eyebrow="REGIONAL OPERATIONS" title="区域多门店运营视图" description="区域/运营角色在授权组织树内对比各门店任务、逾期、评价失败和岗位漏交，不扩大账号数据范围。" source={resource.source} />
    <section className="mini-metrics regional-summary"><span><strong>{hotels.length}</strong>授权门店</span><span><strong>{totals.submitted}</strong>今日提交</span><span className="danger"><strong>{totals.overdue}</strong>逾期任务</span><span><strong>{totals.failed}</strong>评价失败</span><span><strong>{totals.missed}</strong>岗位漏交</span></section>
    <article className="panel table-panel"><LoadingState loading={resource.loading} error={resource.error} empty={!hotels.length} retry={resource.reload} />
      {!resource.loading && !resource.error && !!hotels.length && <div className="data-table operations-table"><div className="table-row table-head"><span>门店</span><span>今日提交</span><span>开放任务</span><span>逾期</span><span>评价失败</span><span>岗位漏交</span><span>运营状态</span></div>{hotels.map((hotel) => {
        const risk = hotel.overdueTaskCount + hotel.failedEvaluationCount + hotel.missedWorkCount
        return <div className="table-row" key={hotel.id}><span><strong>{hotel.name}</strong><small>{hotel.city ?? '—'} · {hotel.roomCount ?? '—'}间</small></span><span className="score">{hotel.todaySubmissionCount}</span><span>{hotel.openTaskCount}</span><span className={hotel.overdueTaskCount ? 'danger-text' : ''}>{hotel.overdueTaskCount}</span><span className={hotel.failedEvaluationCount ? 'danger-text' : ''}>{hotel.failedEvaluationCount}</span><span className={hotel.missedWorkCount ? 'danger-text' : ''}>{hotel.missedWorkCount}</span><span><Status value={risk >= 5 ? 'HIGH' : risk ? 'MEDIUM' : 'ON_TIME'} /></span></div>
      })}</div>}
    </article>
  </section>
}
