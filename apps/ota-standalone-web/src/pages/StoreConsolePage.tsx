import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  listSimulationHotels,
  loadBriefs,
  loadConfiguration,
  loadHotSellingRoomTypes,
  loadIncidents,
  loadMonitor,
  loadOtaSources,
  loadWeComConfig,
  saveHotSellingRoomTypes,
  triggerLiveCollection,
  type BriefView,
  type HotelContext,
  type IncidentView,
  type MonitorView,
  type OtaSourceView,
  type SimulationConfiguration,
  type SimulationHotelView,
  type WeComConfigView,
} from '../api/business'
import { EmptyState, Icon, LoadingState, Status, type Tone } from '../components/ConsoleUi'
import { HistoryPage } from './HistoryPage'
import { MappingTargetPage } from './MappingTargetPage'
import { ReportSourceConfigPage } from './ReportSourceConfigPage'

export interface HotelSummary {
  hotel: SimulationHotelView
  monitor: MonitorView | null
  otaSources: OtaSourceView[]
  wecom: WeComConfigView | null
  incidents: IncidentView[]
  unavailable: boolean
}

type StoreTab = 'overview' | 'collection' | 'operations' | 'broadcast'

const PMS_LABELS = {
  MEITUAN_BIEYANGHONG: '美团别样红 PMS',
  LUOPAN_CLOUD: '罗盘 PMS',
} as const

const formatTime = (value?: string | null) => {
  if (!value) return '尚未上报'
  const date = new Date(value)
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat('zh-CN', {
        month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
      }).format(date)
}

const sourceDisplayName = (platform: string) => ({
  CTRIP: '携程', MEITUAN: '美团', FLIGGY: '飞猪', DOUYIN: '抖音',
  QUNAR: '去哪儿', TONGCHENG: '同程', OTHER: '其他渠道',
}[platform] ?? platform)

function otaState(source: OtaSourceView | undefined): { tone: Tone; label: string } {
  if (!source) return { tone: 'muted', label: '未配置' }
  if (!source.enabled) return { tone: 'muted', label: '已停用' }
  if (source.lastRefreshStatus === 'FAILED') return { tone: 'error', label: '异常' }
  if (source.lastRefreshStatus === 'COMPLETE') return { tone: 'ok', label: '正常' }
  return { tone: 'warning', label: '待验证' }
}

function pmsState(summary: HotelSummary): { tone: Tone; label: string } {
  if (summary.unavailable || summary.monitor?.completeness === 'UNAVAILABLE') {
    return { tone: 'error', label: '连接异常' }
  }
  if (summary.monitor?.completeness === 'PARTIAL') return { tone: 'warning', label: '数据不完整' }
  if (summary.monitor?.completeness === 'COMPLETE') return { tone: 'ok', label: '正常' }
  return { tone: 'warning', label: '待采集' }
}

function broadcastState(summary: HotelSummary): { tone: Tone; label: string } {
  const failed = summary.incidents.some((item) =>
    /BROADCAST|DELIVERY|WECOM|MESSAGE/i.test(item.type) && !/CLOSED|RESOLVED/i.test(item.status))
  if (failed || ['REJECTED', 'AMBIGUOUS'].includes(summary.wecom?.lastDelivery?.deliveryStatus ?? '')) {
    return { tone: 'error', label: '播报异常' }
  }
  if (summary.wecom?.lastDelivery?.deliveryStatus === 'DELIVERED') return { tone: 'ok', label: '正常' }
  return { tone: 'warning', label: '待验证' }
}

async function loadHotelSummary(hotel: SimulationHotelView): Promise<HotelSummary> {
  const context = { tenantId: hotel.tenantId, hotelId: hotel.hotelId }
  const [monitor, otaSources, wecom, incidents] = await Promise.allSettled([
    loadMonitor(context), loadOtaSources(context), loadWeComConfig(context), loadIncidents(context),
  ])
  return {
    hotel,
    monitor: monitor.status === 'fulfilled' ? monitor.value : null,
    otaSources: otaSources.status === 'fulfilled' ? otaSources.value : [],
    wecom: wecom.status === 'fulfilled' ? wecom.value : null,
    incidents: incidents.status === 'fulfilled' ? incidents.value : [],
    unavailable: [monitor, otaSources, wecom, incidents].every((item) => item.status === 'rejected'),
  }
}

export function StoreOverviewPage({
  hotels,
  loadingDirectory,
  directoryError,
  canCreate,
  onCreate,
  onOpen,
  onOpenException,
  onRefreshDirectory,
}: {
  hotels: SimulationHotelView[]
  loadingDirectory: boolean
  directoryError: string
  canCreate: boolean
  onCreate: () => void
  onOpen: (hotel: SimulationHotelView, tab?: StoreTab) => void
  onOpenException: () => void
  onRefreshDirectory: () => void
}) {
  const [summaries, setSummaries] = useState<HotelSummary[]>([])
  const [loading, setLoading] = useState(false)
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<'ALL' | 'NORMAL' | 'ATTENTION'>('ALL')

  const refresh = useCallback(async () => {
    if (!hotels.length) {
      setSummaries([])
      return
    }
    setLoading(true)
    const rows = await Promise.all(hotels.map(loadHotelSummary))
    setSummaries(rows)
    setLoading(false)
  }, [hotels])

  useEffect(() => { void refresh() }, [refresh])

  const filtered = useMemo(() => summaries.filter((summary) => {
    const query = search.trim().toLowerCase()
    const matchesSearch = !query
      || summary.hotel.hotelName.toLowerCase().includes(query)
      || summary.hotel.hotelCode.toLowerCase().includes(query)
      || PMS_LABELS[summary.hotel.pmsSystemCode].toLowerCase().includes(query)
    const needsAttention = pmsState(summary).tone === 'error'
      || broadcastState(summary).tone === 'error'
      || summary.otaSources.some((source) => otaState(source).tone === 'error')
    return matchesSearch && (filter === 'ALL' || (filter === 'ATTENTION' ? needsAttention : !needsAttention))
  }), [filter, search, summaries])

  const abnormalCount = summaries.filter((summary) =>
    pmsState(summary).tone === 'error'
    || broadcastState(summary).tone === 'error'
    || summary.otaSources.some((source) => otaState(source).tone === 'error')).length
  const latest = summaries
    .map((summary) => summary.monitor?.cutoffAt)
    .filter((value): value is string => Boolean(value))
    .sort()
    .at(-1)

  return (
    <section className="console-page store-overview-page">
      <div className="page-title-row">
        <div>
          <p className="section-kicker">STORE OVERVIEW</p>
          <h1>门店总览</h1>
          <p>查看授权范围内门店的登录、采集和播报状态。</p>
        </div>
        {canCreate ? <button className="primary-button" type="button" onClick={onCreate}><Icon name="plus" />新增门店</button> : null}
      </div>

      <div className="connection-banner">
        <span className="connection-dot" />
        <div><strong>云端状态已连接</strong><small>门店权限由服务端隔离，敏感登录资料不在此页显示</small></div>
        <span>最近数据：{formatTime(latest)}</span>
        <button className="quiet-button" type="button" onClick={() => { onRefreshDirectory(); void refresh() }}><Icon name="refresh" />刷新</button>
      </div>

      <div className="summary-strip">
        <div><span>可见门店</span><strong>{hotels.length}</strong><small>已按账号权限过滤</small></div>
        <div><span>正常门店</span><strong>{Math.max(0, summaries.length - abnormalCount)}</strong><small>当前无阻断异常</small></div>
        <button type="button" className={abnormalCount ? 'attention' : ''} onClick={onOpenException}>
          <span>需要处理</span><strong>{abnormalCount}</strong><small>进入异常处理中心</small>
        </button>
      </div>

      <div className="table-toolbar">
        <div className="segmented-control">
          <button className={filter === 'ALL' ? 'active' : ''} onClick={() => setFilter('ALL')} type="button">全部 {summaries.length}</button>
          <button className={filter === 'NORMAL' ? 'active' : ''} onClick={() => setFilter('NORMAL')} type="button">正常</button>
          <button className={filter === 'ATTENTION' ? 'active' : ''} onClick={() => setFilter('ATTENTION')} type="button">需处理 {abnormalCount}</button>
        </div>
        <label className="search-field"><Icon name="search" /><input aria-label="搜索门店" placeholder="搜索门店或 PMS" value={search} onChange={(event) => setSearch(event.target.value)} /></label>
      </div>

      {loading || loadingDirectory ? <LoadingState label="正在汇总门店运行状态…" /> : null}
      {directoryError ? <div className="inline-message error" role="alert">{directoryError}</div> : null}
      {!loading && !loadingDirectory && filtered.length === 0 ? <EmptyState title="没有符合条件的门店" detail="调整筛选条件，或由平台管理员新增门店。" /> : null}

      <div className="store-list">
        {filtered.map((summary) => {
          const pms = pmsState(summary)
          const broadcast = broadcastState(summary)
          const platformMap = new Map(summary.otaSources.map((source) => [source.platformCode, source]))
          const openIncidents = summary.incidents.filter((item) => !/CLOSED|RESOLVED/i.test(item.status)).length
          return (
            <article className={`store-row${pms.tone === 'error' || broadcast.tone === 'error' ? ' has-error' : ''}`} key={summary.hotel.hotelId}>
              <button className="store-main" type="button" onClick={() => onOpen(summary.hotel)}>
                <span className="store-avatar">{summary.hotel.hotelCode.slice(-1)}</span>
                <span><strong>{summary.hotel.hotelCode} · {summary.hotel.hotelName}</strong><small>{PMS_LABELS[summary.hotel.pmsSystemCode]} · {summary.hotel.lifecycleStatus}</small></span>
              </button>
              <div className="source-statuses">
                <Status tone={pms.tone}>PMS · {pms.label}</Status>
                {(['CTRIP', 'MEITUAN', 'FLIGGY', 'DOUYIN'] as const).map((platform) => {
                  const state = otaState(platformMap.get(platform))
                  return <Status key={platform} tone={state.tone}>{sourceDisplayName(platform)} · {state.label}</Status>
                })}
                <Status tone={broadcast.tone}>播报 · {broadcast.label}</Status>
              </div>
              <div className="store-meta"><strong>{formatTime(summary.monitor?.cutoffAt)}</strong><small>{openIncidents ? `${openIncidents}项异常待处理` : '最近检查'}</small></div>
              <button className="row-action" type="button" onClick={() => onOpen(summary.hotel)}>进入门店<Icon name="chevron" /></button>
            </article>
          )
        })}
      </div>
    </section>
  )
}

interface DetailData {
  configuration: SimulationConfiguration | null
  monitor: MonitorView | null
  otaSources: OtaSourceView[]
  wecom: WeComConfigView | null
  briefs: BriefView[]
  incidents: IncidentView[]
  hotSelling: string[]
}

const emptyDetail: DetailData = {
  configuration: null, monitor: null, otaSources: [], wecom: null,
  briefs: [], incidents: [], hotSelling: [],
}

export function StoreDetailPage({
  hotel,
  initialTab = 'overview',
  canConfigure,
  canRevenueConfigure,
  onBack,
  onOpenExceptions,
}: {
  hotel: SimulationHotelView
  initialTab?: StoreTab
  canConfigure: boolean
  canRevenueConfigure: boolean
  onBack: () => void
  onOpenExceptions: () => void
}) {
  const context = useMemo<HotelContext>(() => ({ tenantId: hotel.tenantId, hotelId: hotel.hotelId }), [hotel])
  const [tab, setTab] = useState<StoreTab>(initialTab)
  const [data, setData] = useState<DetailData>(emptyDetail)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [collecting, setCollecting] = useState(false)
  const [notice, setNotice] = useState('')
  const [hotSellingDraft, setHotSellingDraft] = useState('')

  const refresh = useCallback(async () => {
    setLoading(true)
    setError('')
    const results = await Promise.allSettled([
      loadConfiguration(context), loadMonitor(context), loadOtaSources(context),
      loadWeComConfig(context), loadBriefs(context), loadIncidents(context),
      loadHotSellingRoomTypes(context),
    ])
    setData({
      configuration: results[0].status === 'fulfilled' ? results[0].value : null,
      monitor: results[1].status === 'fulfilled' ? results[1].value : null,
      otaSources: results[2].status === 'fulfilled' ? results[2].value : [],
      wecom: results[3].status === 'fulfilled' ? results[3].value : null,
      briefs: results[4].status === 'fulfilled' ? results[4].value : [],
      incidents: results[5].status === 'fulfilled' ? results[5].value : [],
      hotSelling: results[6].status === 'fulfilled' ? results[6].value.roomTypeCodes : [],
    })
    if (results.every((result) => result.status === 'rejected')) setError('门店数据暂时不可用，请检查连接状态。')
    if (results[6].status === 'fulfilled') setHotSellingDraft(results[6].value.roomTypeCodes.join('、'))
    setLoading(false)
  }, [context])

  useEffect(() => { setTab(initialTab) }, [initialTab])
  useEffect(() => { void refresh() }, [refresh])

  const collect = async () => {
    setCollecting(true); setNotice(''); setError('')
    try {
      const run = await triggerLiveCollection(context)
      setNotice(run.status === 'SUCCEEDED' ? '采集已完成，数据预览已更新。' : `采集完成，状态：${run.status}`)
      await refresh()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '采集触发失败')
    } finally { setCollecting(false) }
  }

  const saveHotSelling = async () => {
    const codes = hotSellingDraft.split(/[、,，\s]+/).map((item) => item.trim()).filter(Boolean)
    try {
      const saved = await saveHotSellingRoomTypes(context, [...new Set(codes)])
      setData((current) => ({ ...current, hotSelling: saved.roomTypeCodes }))
      setHotSellingDraft(saved.roomTypeCodes.join('、'))
      setNotice('热销房型配置已保存。')
    } catch (cause) { setError(cause instanceof Error ? cause.message : '热销房型保存失败') }
  }

  const summary: HotelSummary = { hotel, monitor: data.monitor, otaSources: data.otaSources, wecom: data.wecom, incidents: data.incidents, unavailable: Boolean(error) }
  const pms = pmsState(summary)
  const broadcast = broadcastState(summary)

  return (
    <section className="console-page store-detail-page">
      <button className="back-link" type="button" onClick={onBack}>‹ 返回门店总览</button>
      <div className="page-title-row compact-title">
        <div><p className="section-kicker">{hotel.hotelCode} · STORE WORKSPACE</p><h1>{hotel.hotelName}</h1><p>{PMS_LABELS[hotel.pmsSystemCode]} · 账号仅可读取授权门店</p></div>
        <div className="title-actions"><button className="quiet-button" type="button" onClick={() => void refresh()}><Icon name="refresh" />刷新状态</button><button className="quiet-button" type="button" onClick={() => setTab('collection')}><Icon name="settings" />门店设置</button></div>
      </div>

      <div className="store-health-bar">
        <Status tone={pms.tone}>PMS · {pms.label}</Status>
        {data.otaSources.map((source) => { const state = otaState(source); return <Status key={source.sourceId} tone={state.tone}>{sourceDisplayName(source.platformCode)} · {state.label}</Status> })}
        <Status tone={broadcast.tone}>播报 · {broadcast.label}</Status>
      </div>

      <nav className="store-tabs" aria-label="门店功能">
        {([
          ['overview', '门店概览'], ['collection', '采集配置'], ['operations', '运营配置'], ['broadcast', '播报记录'],
        ] as Array<[StoreTab, string]>).map(([code, label]) => <button key={code} className={tab === code ? 'active' : ''} onClick={() => setTab(code)} type="button">{label}</button>)}
      </nav>

      {error ? <div className="inline-message error" role="alert">{error}</div> : null}
      {notice ? <div className="inline-message success" role="status">{notice}</div> : null}
      {loading ? <LoadingState /> : null}

      {!loading && tab === 'overview' ? (
        <div className="detail-overview">
          {data.incidents.some((item) => !/CLOSED|RESOLVED/i.test(item.status)) ? (
            <button className="issue-banner" type="button" onClick={onOpenExceptions}><Icon name="alert" size={22} /><span><strong>{data.incidents.filter((item) => !/CLOSED|RESOLVED/i.test(item.status)).length}项问题需要处理</strong><small>查看异常原因及安全处理入口</small></span><span>进入异常处理<Icon name="chevron" /></span></button>
          ) : null}

          <div className="section-heading"><div><h2>总数据预览</h2><p>PMS 与 OTA 最近一次成功采集结果；不完整数据不会作为正式播报依据。</p></div><button className="primary-button" disabled={collecting} onClick={() => void collect()} type="button"><Icon name="refresh" />{collecting ? '正在采集…' : '立即采集'}</button></div>
          <div className="metric-table">
            {Object.entries(data.monitor?.metrics ?? {}).slice(0, 8).map(([code, metric]) => (
              <div key={code}><span>{code.replaceAll('_', ' ')}</span><strong>{metric.state === 'AVAILABLE' ? `${metric.value ?? '—'}${metric.unit ? ` ${metric.unit}` : ''}` : '—'}</strong><small>{metric.state === 'AVAILABLE' ? '已采集' : metric.state}</small></div>
            ))}
            {!Object.keys(data.monitor?.metrics ?? {}).length ? <EmptyState title="暂无可预览数据" detail="完成 PMS 登录并执行一次采集后显示。" /> : null}
          </div>

          <div className="two-column-section">
            <section className="content-panel">
              <div className="section-heading small"><div><h2>数据连接</h2><p>连接状态与最近同步时间</p></div><button className="text-link" onClick={() => setTab('collection')} type="button">查看配置</button></div>
              <div className="connection-table">
                <div><strong>{PMS_LABELS[hotel.pmsSystemCode]}</strong><Status tone={pms.tone}>{pms.label}</Status><span>{formatTime(data.monitor?.cutoffAt)}</span></div>
                {data.otaSources.map((source) => { const state = otaState(source); return <div key={source.sourceId}><strong>{sourceDisplayName(source.platformCode)}</strong><Status tone={state.tone}>{state.label}</Status><span>{formatTime(source.lastRefreshAt)}</span></div> })}
              </div>
            </section>
            <section className="content-panel">
              <div className="section-heading small"><div><h2>播报状态</h2><p>企业微信最近一次投递</p></div><button className="text-link" onClick={() => setTab('broadcast')} type="button">查看记录</button></div>
              <div className="broadcast-summary"><Status tone={broadcast.tone}>{broadcast.label}</Status><dl><div><dt>最近投递</dt><dd>{formatTime(data.wecom?.lastDelivery?.attemptedAt)}</dd></div><div><dt>结果</dt><dd>{data.wecom?.lastDelivery?.deliveryStatus ?? '尚未投递'}</dd></div><div><dt>已生成简报</dt><dd>{data.briefs.length} 条</dd></div></dl></div>
            </section>
          </div>
        </div>
      ) : null}

      {!loading && tab === 'collection' ? <div className="embedded-legacy-page"><ReportSourceConfigPage context={context} canConfigure={canConfigure} attentionItems={[]} otaAttentionSourceId={null} /></div> : null}

      {!loading && tab === 'operations' ? (
        <div className="operations-layout">
          <section className="content-panel operation-quick-config">
            <div className="section-heading small"><div><h2>热销房型配置</h2><p>填写房型编码，用顿号或逗号分隔。</p></div></div>
            <label>热销房型编码<input disabled={!canRevenueConfigure} value={hotSellingDraft} placeholder="KING、TWIN" onChange={(event) => setHotSellingDraft(event.target.value)} /></label>
            <button className="primary-button" disabled={!canRevenueConfigure} type="button" onClick={() => void saveHotSelling()}>保存热销房型</button>
          </section>
          <div className="embedded-legacy-page"><MappingTargetPage context={context} canConfigure={canRevenueConfigure} /></div>
        </div>
      ) : null}

      {!loading && tab === 'broadcast' ? <div className="embedded-legacy-page"><HistoryPage context={context} canConfigure={canConfigure} /></div> : null}
    </section>
  )
}

export async function loadAuthorizedHotels(): Promise<SimulationHotelView[]> {
  return (await listSimulationHotels()).hotels
}

export type { StoreTab }
