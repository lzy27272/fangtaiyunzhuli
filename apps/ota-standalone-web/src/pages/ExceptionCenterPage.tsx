import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  loadIncidents,
  loadMonitor,
  loadOtaSources,
  loadWeComConfig,
  triggerLiveCollection,
  type HotelContext,
  type IncidentView,
  type SimulationHotelView,
} from '../api/business'
import { EmptyState, Icon, LoadingState, Status, type Tone } from '../components/ConsoleUi'
import { loadTrustedDeviceStatus } from '../api/trustedDevice'
import {
  evaluatePmsRepair,
  PMS_REPAIR_REASON_LABEL,
  type PmsRepairReason,
} from '../domain/pmsRepair'
import { businessCodeLabel, businessErrorMessage, safeBusinessText } from '../ui/businessDisplay'
import type { StoreTab } from './StoreConsolePage'

const COLLECTION_FEEDBACK_TIMEOUT_MS = 120_000

async function withCollectionFeedbackTimeout<T>(operation: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error('本次采集耗时较长，服务器可能仍在继续处理。请稍后点击“重新检查”查看结果。'))
    }, COLLECTION_FEEDBACK_TIMEOUT_MS)
  })
  try {
    return await Promise.race([operation, timeout])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

type IssueKind = 'PMS_REPAIR' | 'LOGIN' | 'COLLECTION' | 'PARTIAL' | 'BROADCAST'
interface ConsoleIssue {
  id: string
  hotel: SimulationHotelView
  kind: IssueKind
  source: string
  title: string
  detail: string
  observedAt: string
  original?: IncidentView
}

const KIND_LABEL: Record<IssueKind, string> = {
  PMS_REPAIR: 'PMS需要修复处理', LOGIN: '登录失效', COLLECTION: '采集失败', PARTIAL: '数据不完整', BROADCAST: '播报失败',
}
const sourceLabel = (value: string) => ({ CTRIP: '携程', MEITUAN: '美团', FLIGGY: '飞猪', DOUYIN: '抖音', PMS: '酒店系统', WECOM: '企业微信' }[value] ?? '其他数据来源')
const fmt = (value: string) => {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).format(date)
}

function collectionResultNotice(issue: ConsoleIssue, run: Awaited<ReturnType<typeof triggerLiveCollection>>) {
  if (run.status === 'SUCCEEDED') {
    return `${issue.hotel.hotelCode} 门店重新采集成功，${run.successfulSourceCount}/${run.sourceCount} 个数据源已更新。`
  }
  const pendingReasons = [...new Set(
    run.monitor.sources
      .filter((source) => source.completeness !== 'COMPLETE')
      .map((source) => businessCodeLabel(source.errorCode, businessCodeLabel(source.reportType, '数据来源待核对'))),
  )]
  const detail = pendingReasons.length
    ? `待处理：${pendingReasons.join('、')}。`
    : '请进入门店检查未完成的数据来源。'
  return `${issue.hotel.hotelCode} 门店重新采集完成：${run.successfulSourceCount}/${run.sourceCount} 个数据源成功，结果仍不完整。${detail}`
}

function classifyIncident(incident: IncidentView): IssueKind | null {
  const raw = `${incident.type} ${incident.directionCode ?? ''}`.toUpperCase()
  if (incident.type === 'PMS_REPAIR_REQUIRED') return 'PMS_REPAIR'
  if (/DEVICE.*OFFLINE|OFFLINE.*DEVICE/.test(raw)) return null
  if (/LOGIN|AUTH|SESSION|COOKIE/.test(raw)) return 'LOGIN'
  if (/BROADCAST|DELIVERY|WECOM|MESSAGE/.test(raw)) return 'BROADCAST'
  if (/PARTIAL|INCOMPLETE/.test(raw)) return 'PARTIAL'
  return 'COLLECTION'
}

async function loadIssuesForHotel(hotel: SimulationHotelView): Promise<ConsoleIssue[]> {
  const context: HotelContext = { tenantId: hotel.tenantId, hotelId: hotel.hotelId }
  const [monitorResult, otaResult, wecomResult, incidentResult, trustedDeviceResult] = await Promise.allSettled([
    loadMonitor(context), loadOtaSources(context), loadWeComConfig(context), loadIncidents(context),
    loadTrustedDeviceStatus(context),
  ])
  const issues: ConsoleIssue[] = []
  if (incidentResult.status === 'fulfilled') {
    for (const incident of incidentResult.value.filter((item) => !/CLOSED|RESOLVED/i.test(item.status))) {
      const kind = classifyIncident(incident)
      if (!kind) continue
      const pmsRepairReasons = kind === 'PMS_REPAIR'
        ? (incident.directionCode ?? '').split(',')
          .filter((reason): reason is PmsRepairReason => reason in PMS_REPAIR_REASON_LABEL)
        : []
      issues.push({
        id: `${hotel.hotelId}-${incident.incidentId}`, hotel, kind,
        source: sourceLabel(incident.sourceCode ?? (kind === 'BROADCAST' ? 'WECOM' : 'PMS')),
        title: kind === 'PMS_REPAIR' ? 'PMS需要修复处理' : `${sourceLabel(incident.sourceCode ?? 'PMS')} · ${KIND_LABEL[kind]}`,
        detail: pmsRepairReasons.map((reason) => PMS_REPAIR_REASON_LABEL[reason]).join('；') || safeBusinessText(incident.type, KIND_LABEL[kind]),
        observedAt: incident.lastObservedAt,
        original: incident,
      })
    }
  }
  const hasPmsRepairIncident = issues.some((issue) => issue.kind === 'PMS_REPAIR')
  const pmsRepair = evaluatePmsRepair({
    monitor: monitorResult.status === 'fulfilled' ? monitorResult.value : null,
    trustedDeviceStatus: trustedDeviceResult.status === 'fulfilled' ? trustedDeviceResult.value : null,
  })
  if (!hasPmsRepairIncident && pmsRepair.required) {
    issues.push({
      id: `${hotel.hotelId}-pms-repair`, hotel, kind: 'PMS_REPAIR', source: 'PMS',
      title: 'PMS需要修复处理',
      detail: pmsRepair.reasons.map((reason) => PMS_REPAIR_REASON_LABEL[reason]).join('；'),
      observedAt: monitorResult.status === 'fulfilled' && monitorResult.value.cutoffAt
        ? monitorResult.value.cutoffAt : new Date().toISOString(),
    })
  }
  if (otaResult.status === 'fulfilled') {
    for (const source of otaResult.value.filter((item) => item.enabled && item.lastRefreshStatus === 'FAILED')) {
      const login = /LOGIN|AUTH|SESSION|COOKIE/i.test(source.lastErrorCode ?? '')
      issues.push({ id: `${hotel.hotelId}-ota-${source.sourceId}`, hotel, kind: login ? 'LOGIN' : 'COLLECTION', source: sourceLabel(source.platformCode), title: `${sourceLabel(source.platformCode)} · ${login ? '登录失效' : '采集失败'}`, detail: businessCodeLabel(source.lastErrorCode, '渠道最近一次刷新失败'), observedAt: source.lastRefreshAt ?? new Date().toISOString() })
    }
  }
  if (wecomResult.status === 'fulfilled' && ['REJECTED', 'AMBIGUOUS'].includes(wecomResult.value.lastDelivery?.deliveryStatus ?? '')) {
    issues.push({ id: `${hotel.hotelId}-broadcast-${wecomResult.value.lastDelivery?.deliveryId}`, hotel, kind: 'BROADCAST', source: '企业微信', title: '企业微信 · 播报失败', detail: businessCodeLabel(wecomResult.value.lastDelivery?.reasonCode, '最近一次播报未确认送达'), observedAt: wecomResult.value.lastDelivery?.attemptedAt ?? new Date().toISOString() })
  }
  return [...new Map(issues.map((item) => [item.id, item])).values()]
}

export function ExceptionCenterPage({
  hotels,
  onOpenStore,
}: {
  hotels: SimulationHotelView[]
  onOpenStore: (hotel: SimulationHotelView, tab: StoreTab) => void
}) {
  const [issues, setIssues] = useState<ConsoleIssue[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [filter, setFilter] = useState<'ALL' | IssueKind>('ALL')
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<ConsoleIssue | null>(null)
  const [processing, setProcessing] = useState(false)
  const [processingSeconds, setProcessingSeconds] = useState(0)
  const [notice, setNotice] = useState('')
  const [note, setNote] = useState('')

  const refresh = useCallback(async () => {
    setLoading(true); setError('')
    try { setIssues((await Promise.all(hotels.map(loadIssuesForHotel))).flat()) }
    catch (cause) { setError(businessErrorMessage(cause, '异常列表读取失败')) }
    finally { setLoading(false) }
  }, [hotels])
  useEffect(() => { void refresh() }, [refresh])
  useEffect(() => {
    if (!processing) return undefined
    const startedAt = Date.now()
    setProcessingSeconds(0)
    const timer = window.setInterval(() => {
      setProcessingSeconds(Math.floor((Date.now() - startedAt) / 1000))
    }, 1_000)
    return () => window.clearInterval(timer)
  }, [processing])

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase()
    return issues.filter((item) => (filter === 'ALL' || item.kind === filter)
      && (!query || `${item.hotel.hotelName} ${item.hotel.hotelCode} ${item.title} ${item.detail}`.toLowerCase().includes(query)))
  }, [filter, issues, search])

  const count = (kind: IssueKind) => issues.filter((item) => item.kind === kind).length
  const safeAction = async () => {
    if (!selected) return
    const issue = selected
    if (issue.kind === 'PMS_REPAIR' || issue.kind === 'LOGIN') {
      setSelected(null); onOpenStore(issue.hotel, 'repair'); return
    }
    if (issue.kind === 'BROADCAST') {
      setSelected(null); onOpenStore(issue.hotel, 'broadcast'); return
    }
    setProcessing(true); setError(''); setNotice('')
    try {
      const run = await withCollectionFeedbackTimeout(triggerLiveCollection({
        tenantId: issue.hotel.tenantId,
        hotelId: issue.hotel.hotelId,
      }))
      setNotice(collectionResultNotice(issue, run))
      setSelected(null); setNote(''); void refresh()
    } catch (cause) { setError(businessErrorMessage(cause, '重新采集失败')) }
    finally { setProcessing(false) }
  }

  const actionLabel = selected?.kind === 'PMS_REPAIR' || selected?.kind === 'LOGIN'
    ? '进入PMS修复' : selected?.kind === 'BROADCAST' ? '检查播报记录' : '安全重新采集'

  return (
    <section className="console-page exception-page">
      <div className="page-title-row"><div><p className="section-kicker">异常处理中心</p><h1>异常处理</h1><p>只提供可回退的安全动作；平台登录验证仍由管理员在官网完成。</p></div><button className="quiet-button" type="button" onClick={() => void refresh()}><Icon name="refresh" />重新检查</button></div>
      <div className="connection-banner"><span className="connection-dot" /><div><strong>云端状态已连接</strong><small>自动恢复仅限幂等采集，登录和验证码不会自动绕过</small></div><span>{issues.length} 项需要处理</span></div>
      <div className="summary-strip exception-summary"><button className={filter === 'ALL' ? 'selected' : ''} onClick={() => setFilter('ALL')} type="button"><span>全部异常</span><strong>{issues.length}</strong><small>需要处理</small></button><button className={filter === 'PMS_REPAIR' ? 'selected' : ''} onClick={() => setFilter('PMS_REPAIR')} type="button"><span>PMS需修复</span><strong>{count('PMS_REPAIR')}</strong><small>一键进入处理</small></button><button className={filter === 'COLLECTION' ? 'selected' : ''} onClick={() => setFilter('COLLECTION')} type="button"><span>采集失败</span><strong>{count('COLLECTION')}</strong><small>可以重新采集</small></button><button className={filter === 'BROADCAST' ? 'selected' : ''} onClick={() => setFilter('BROADCAST')} type="button"><span>播报失败</span><strong>{count('BROADCAST')}</strong><small>检查后补发</small></button></div>
      <div className="table-toolbar"><div className="segmented-control">{(['ALL', 'PMS_REPAIR', 'LOGIN', 'COLLECTION', 'PARTIAL', 'BROADCAST'] as const).map((code) => <button key={code} className={filter === code ? 'active' : ''} onClick={() => setFilter(code)} type="button">{code === 'ALL' ? '全部' : KIND_LABEL[code]}</button>)}</div><label className="search-field"><Icon name="search" /><input placeholder="搜索门店、平台或错误原因" value={search} onChange={(event) => setSearch(event.target.value)} /></label></div>
      {notice ? <div className="inline-message success" role="status">{notice}</div> : null}
      {error && !selected ? <div className="inline-message error" role="alert">{error}</div> : null}
      {loading ? <LoadingState label="正在检查各门店异常…" /> : null}
      {!loading && !filtered.length ? <EmptyState title="当前没有待处理异常" detail="系统会持续检查PMS数据时效、绑定、授权范围和快照完整性。" /> : null}
      <div className="issue-list">{filtered.map((issue) => {
        const tone: Tone = issue.kind === 'PMS_REPAIR' || issue.kind === 'BROADCAST' || issue.kind === 'LOGIN' ? 'error' : 'warning'
        return <article key={issue.id}><span className={`issue-icon ${tone}`}><Icon name="alert" /></span><div className="issue-store"><strong>{issue.hotel.hotelCode} · {issue.hotel.hotelName}</strong><small>{issue.source}</small></div><div><strong>{issue.title}</strong><small>{issue.detail}</small></div><div><strong>{fmt(issue.observedAt)}</strong><small>最近发现</small></div><Status tone={tone}>待处理</Status><button className="row-action" onClick={() => { setSelected(issue); setNote(''); setError('') }} type="button">检查处理<Icon name="chevron" /></button></article>
      })}</div>

      {selected ? <div className="drawer-backdrop" onMouseDown={() => setSelected(null)}><aside className="side-drawer wide" onMouseDown={(event) => event.stopPropagation()}><header><div><p className="section-kicker">异常详情</p><h2>{selected.title}</h2></div><button className="icon-button" onClick={() => setSelected(null)} type="button">×</button></header><div className="drawer-body"><div className="issue-detail-head"><span className="issue-icon error"><Icon name="alert" /></span><div><strong>{selected.hotel.hotelCode} · {selected.hotel.hotelName}</strong><small>{selected.source} · {fmt(selected.observedAt)}</small></div></div><dl className="review-list compact"><div><dt>异常类型</dt><dd>{KIND_LABEL[selected.kind]}</dd></div><div><dt>原因</dt><dd>{selected.detail}</dd></div><div><dt>当前状态</dt><dd><Status tone="error">待处理</Status></dd></div><div><dt>安全处理方式</dt><dd>{selected.kind === 'PMS_REPAIR' || selected.kind === 'LOGIN' ? '进入PMS修复，根据提示完成重新绑定、范围授权或官网验证。' : selected.kind === 'BROADCAST' ? '检查最近投递和数据完整性，确认未送达后再补发。' : '触发一次安全重新采集，不执行批量登录。'}</dd></div></dl><label className="optional-note">处理说明（选填）<textarea placeholder="可填写本次处理说明；不填写也可以继续" value={note} onChange={(event) => setNote(event.target.value)} maxLength={500} /><small>{note.length}/500 · 当前接口暂不保存处理说明</small></label>{processing ? <div className="inline-message progress" role="status" aria-live="polite"><strong>采集请求已提交</strong><span>正在连接酒店系统并核对数据，已等待 {processingSeconds} 秒。罗盘采集通常需要 30–90 秒，请勿重复点击。</span></div> : null}{error ? <div className="inline-message error" role="alert">{error}</div> : null}</div><footer><button className="quiet-button" type="button" onClick={() => setSelected(null)}>{processing ? '关闭弹窗' : '取消'}</button><button className="primary-button danger-safe" disabled={processing} type="button" onClick={() => void safeAction()}>{processing ? `正在采集 ${processingSeconds} 秒` : actionLabel}</button></footer></aside></div> : null}
    </section>
  )
}
