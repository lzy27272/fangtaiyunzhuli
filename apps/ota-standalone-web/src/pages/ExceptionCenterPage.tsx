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
import type { StoreTab } from './StoreConsolePage'

type IssueKind = 'LOGIN' | 'COLLECTION' | 'PARTIAL' | 'BROADCAST' | 'OFFLINE'
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
  LOGIN: '登录失效', COLLECTION: '采集失败', PARTIAL: '数据不完整', BROADCAST: '播报失败', OFFLINE: '可信设备离线',
}
const sourceLabel = (value: string) => ({ CTRIP: '携程', MEITUAN: '美团', FLIGGY: '飞猪', DOUYIN: '抖音', PMS: 'PMS', WECOM: '企业微信' }[value] ?? value)
const fmt = (value: string) => {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).format(date)
}

function classifyIncident(incident: IncidentView): IssueKind {
  const raw = `${incident.type} ${incident.directionCode ?? ''}`.toUpperCase()
  if (/LOGIN|AUTH|SESSION|COOKIE/.test(raw)) return 'LOGIN'
  if (/BROADCAST|DELIVERY|WECOM|MESSAGE/.test(raw)) return 'BROADCAST'
  if (/DEVICE|OFFLINE/.test(raw)) return 'OFFLINE'
  if (/PARTIAL|INCOMPLETE/.test(raw)) return 'PARTIAL'
  return 'COLLECTION'
}

async function loadIssuesForHotel(hotel: SimulationHotelView): Promise<ConsoleIssue[]> {
  const context: HotelContext = { tenantId: hotel.tenantId, hotelId: hotel.hotelId }
  const [monitorResult, otaResult, wecomResult, incidentResult] = await Promise.allSettled([
    loadMonitor(context), loadOtaSources(context), loadWeComConfig(context), loadIncidents(context),
  ])
  const issues: ConsoleIssue[] = []
  if (incidentResult.status === 'fulfilled') {
    for (const incident of incidentResult.value.filter((item) => !/CLOSED|RESOLVED/i.test(item.status))) {
      const kind = classifyIncident(incident)
      issues.push({
        id: `${hotel.hotelId}-${incident.incidentId}`, hotel, kind,
        source: sourceLabel(incident.sourceCode ?? (kind === 'BROADCAST' ? 'WECOM' : 'PMS')),
        title: `${sourceLabel(incident.sourceCode ?? 'PMS')} · ${KIND_LABEL[kind]}`,
        detail: incident.type,
        observedAt: incident.lastObservedAt,
        original: incident,
      })
    }
  }
  if (monitorResult.status === 'rejected') {
    issues.push({ id: `${hotel.hotelId}-monitor-unavailable`, hotel, kind: 'COLLECTION', source: 'PMS', title: 'PMS · 采集失败', detail: '门店监控数据接口暂时不可用', observedAt: new Date().toISOString() })
  } else if (monitorResult.value.completeness === 'PARTIAL') {
    issues.push({ id: `${hotel.hotelId}-partial`, hotel, kind: 'PARTIAL', source: 'PMS', title: 'PMS · 数据不完整', detail: '部分必需数据源尚未形成完整快照，播报已阻断', observedAt: monitorResult.value.cutoffAt ?? new Date().toISOString() })
  }
  if (otaResult.status === 'fulfilled') {
    for (const source of otaResult.value.filter((item) => item.enabled && item.lastRefreshStatus === 'FAILED')) {
      const login = /LOGIN|AUTH|SESSION|COOKIE/i.test(source.lastErrorCode ?? '')
      issues.push({ id: `${hotel.hotelId}-ota-${source.sourceId}`, hotel, kind: login ? 'LOGIN' : 'COLLECTION', source: sourceLabel(source.platformCode), title: `${sourceLabel(source.platformCode)} · ${login ? '登录失效' : '采集失败'}`, detail: source.lastErrorCode ?? '渠道最近一次刷新失败', observedAt: source.lastRefreshAt ?? new Date().toISOString() })
    }
  }
  if (wecomResult.status === 'fulfilled' && ['REJECTED', 'AMBIGUOUS'].includes(wecomResult.value.lastDelivery?.deliveryStatus ?? '')) {
    issues.push({ id: `${hotel.hotelId}-broadcast-${wecomResult.value.lastDelivery?.deliveryId}`, hotel, kind: 'BROADCAST', source: '企业微信', title: '企业微信 · 播报失败', detail: wecomResult.value.lastDelivery?.reasonCode ?? '最近一次播报未确认送达', observedAt: wecomResult.value.lastDelivery?.attemptedAt ?? new Date().toISOString() })
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
  const [notice, setNotice] = useState('')
  const [note, setNote] = useState('')

  const refresh = useCallback(async () => {
    setLoading(true); setError('')
    try { setIssues((await Promise.all(hotels.map(loadIssuesForHotel))).flat()) }
    catch (cause) { setError(cause instanceof Error ? cause.message : '异常列表读取失败') }
    finally { setLoading(false) }
  }, [hotels])
  useEffect(() => { void refresh() }, [refresh])

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase()
    return issues.filter((item) => (filter === 'ALL' || item.kind === filter)
      && (!query || `${item.hotel.hotelName} ${item.hotel.hotelCode} ${item.title} ${item.detail}`.toLowerCase().includes(query)))
  }, [filter, issues, search])

  const count = (kind: IssueKind) => issues.filter((item) => item.kind === kind).length
  const safeAction = async () => {
    if (!selected) return
    if (selected.kind === 'LOGIN' || selected.kind === 'OFFLINE') {
      setSelected(null); onOpenStore(selected.hotel, 'collection'); return
    }
    if (selected.kind === 'BROADCAST') {
      setSelected(null); onOpenStore(selected.hotel, 'broadcast'); return
    }
    setProcessing(true); setError(''); setNotice('')
    try {
      const run = await triggerLiveCollection({ tenantId: selected.hotel.tenantId, hotelId: selected.hotel.hotelId })
      setNotice(run.status === 'SUCCEEDED' ? `${selected.hotel.hotelCode} 门店重新采集成功。` : `重新采集完成，状态：${run.status}`)
      setSelected(null); setNote(''); await refresh()
    } catch (cause) { setError(cause instanceof Error ? cause.message : '重新采集失败') }
    finally { setProcessing(false) }
  }

  const actionLabel = selected?.kind === 'LOGIN' || selected?.kind === 'OFFLINE'
    ? '进入登录修复' : selected?.kind === 'BROADCAST' ? '检查播报记录' : '安全重新采集'

  return (
    <section className="console-page exception-page">
      <div className="page-title-row"><div><p className="section-kicker">FAILURE CENTER</p><h1>异常处理</h1><p>只提供可回退的安全动作；平台登录验证仍由管理员在官网完成。</p></div><button className="quiet-button" type="button" onClick={() => void refresh()}><Icon name="refresh" />重新检查</button></div>
      <div className="connection-banner"><span className="connection-dot" /><div><strong>云端状态已连接</strong><small>自动恢复仅限幂等采集，登录和验证码不会自动绕过</small></div><span>{issues.length} 项需要处理</span></div>
      <div className="summary-strip exception-summary"><button className={filter === 'ALL' ? 'selected' : ''} onClick={() => setFilter('ALL')} type="button"><span>全部异常</span><strong>{issues.length}</strong><small>需要处理</small></button><button className={filter === 'LOGIN' ? 'selected' : ''} onClick={() => setFilter('LOGIN')} type="button"><span>登录失效</span><strong>{count('LOGIN')}</strong><small>先恢复登录</small></button><button className={filter === 'COLLECTION' ? 'selected' : ''} onClick={() => setFilter('COLLECTION')} type="button"><span>采集失败</span><strong>{count('COLLECTION')}</strong><small>可以重新采集</small></button><button className={filter === 'BROADCAST' ? 'selected' : ''} onClick={() => setFilter('BROADCAST')} type="button"><span>播报失败</span><strong>{count('BROADCAST')}</strong><small>检查后补发</small></button></div>
      <div className="table-toolbar"><div className="segmented-control">{(['ALL', 'LOGIN', 'COLLECTION', 'PARTIAL', 'BROADCAST', 'OFFLINE'] as const).map((code) => <button key={code} className={filter === code ? 'active' : ''} onClick={() => setFilter(code)} type="button">{code === 'ALL' ? '全部' : KIND_LABEL[code]}</button>)}</div><label className="search-field"><Icon name="search" /><input placeholder="搜索门店、平台或错误原因" value={search} onChange={(event) => setSearch(event.target.value)} /></label></div>
      {notice ? <div className="inline-message success" role="status">{notice}</div> : null}
      {error && !selected ? <div className="inline-message error" role="alert">{error}</div> : null}
      {loading ? <LoadingState label="正在检查各门店异常…" /> : null}
      {!loading && !filtered.length ? <EmptyState title="当前没有待处理异常" detail="系统会在每日凌晨自检后汇总到这里。" /> : null}
      <div className="issue-list">{filtered.map((issue) => {
        const tone: Tone = issue.kind === 'BROADCAST' || issue.kind === 'LOGIN' ? 'error' : 'warning'
        return <article key={issue.id}><span className={`issue-icon ${tone}`}><Icon name="alert" /></span><div className="issue-store"><strong>{issue.hotel.hotelCode} · {issue.hotel.hotelName}</strong><small>{issue.source}</small></div><div><strong>{issue.title}</strong><small>{issue.detail}</small></div><div><strong>{fmt(issue.observedAt)}</strong><small>最近发现</small></div><Status tone={tone}>待处理</Status><button className="row-action" onClick={() => { setSelected(issue); setNote(''); setError('') }} type="button">检查处理<Icon name="chevron" /></button></article>
      })}</div>

      {selected ? <div className="drawer-backdrop" onMouseDown={() => setSelected(null)}><aside className="side-drawer wide" onMouseDown={(event) => event.stopPropagation()}><header><div><p className="section-kicker">ISSUE DETAIL</p><h2>{selected.title}</h2></div><button className="icon-button" onClick={() => setSelected(null)} type="button">×</button></header><div className="drawer-body"><div className="issue-detail-head"><span className="issue-icon error"><Icon name="alert" /></span><div><strong>{selected.hotel.hotelCode} · {selected.hotel.hotelName}</strong><small>{selected.source} · {fmt(selected.observedAt)}</small></div></div><dl className="review-list compact"><div><dt>异常类型</dt><dd>{KIND_LABEL[selected.kind]}</dd></div><div><dt>原因</dt><dd>{selected.detail}</dd></div><div><dt>当前状态</dt><dd><Status tone="error">待处理</Status></dd></div><div><dt>安全处理方式</dt><dd>{selected.kind === 'LOGIN' ? '进入门店采集配置，由管理员在官方页面完成登录验证。' : selected.kind === 'BROADCAST' ? '检查最近投递和数据完整性，确认未送达后再补发。' : '触发一次幂等重新采集，不执行批量登录。'}</dd></div></dl><label className="optional-note">处理说明（选填）<textarea placeholder="可填写本次处理说明；不填写也可以继续" value={note} onChange={(event) => setNote(event.target.value)} maxLength={500} /><small>{note.length}/500 · 当前接口暂不持久化处理说明</small></label>{error ? <div className="inline-message error" role="alert">{error}</div> : null}</div><footer><button className="quiet-button" type="button" onClick={() => setSelected(null)}>取消</button><button className="primary-button danger-safe" disabled={processing} type="button" onClick={() => void safeAction()}>{processing ? '正在处理…' : actionLabel}</button></footer></aside></div> : null}
    </section>
  )
}
