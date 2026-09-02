import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  listSimulationHotels,
  loadBriefs,
  loadConfiguration,
  loadIncidents,
  loadMonitor,
  loadOutboxPreview,
  loadOtaSources,
  loadRoomTypeConfiguration,
  loadWeComConfig,
  triggerLiveCollection,
  type BriefView,
  type HotelContext,
  type IncidentView,
  type MonitorView,
  type OutboxPreview,
  type OtaSourceView,
  type RoomTypeConfigurationView,
  type SimulationConfiguration,
  type SimulationHotelView,
  type WeComConfigView,
} from '../api/business'
import {
  EmptyState,
  Icon,
  LoadingState,
  PlatformIcon,
  Status,
  type PlatformIconName,
  type Tone,
} from '../components/ConsoleUi'
import {
  evaluatePmsRepair,
  PMS_REPAIR_REASON_LABEL,
  type PmsRepairReason,
} from '../domain/pmsRepair'
import {
  loadTrustedDeviceStatus,
  trustedDeviceRepairUrl,
  type TrustedDeviceStatus,
  waitForTrustedDeviceSnapshot,
} from '../api/trustedDevice'
import {
  businessCodeLabel,
  businessErrorMessage,
  metricLabel,
  unitLabel,
} from '../ui/businessDisplay'
import { HistoryPage } from './HistoryPage'
import { HotSellingRoomConfigPanel } from './HotSellingRoomConfigPanel'
import { MappingTargetPage } from './MappingTargetPage'
import { ReportSourceConfigPage } from './ReportSourceConfigPage'
import { StoreRepairPanel } from './StoreRepairPanel'

export interface HotelSummary {
  hotel: SimulationHotelView
  monitor: MonitorView | null
  otaSources: OtaSourceView[]
  wecom: WeComConfigView | null
  briefs: BriefView[]
  incidents: IncidentView[]
  trustedDeviceStatus: TrustedDeviceStatus | null
  unavailable: boolean
}

type StoreTab = 'overview' | 'repair' | 'collection' | 'operations' | 'broadcast'

const PMS_LABELS = {
  MEITUAN_BIEYANGHONG: '美团别样红 PMS',
  LUOPAN_CLOUD: '罗盘 PMS',
  OTHER: '其他 PMS',
} as const

const pmsDisplayName = (hotel: SimulationHotelView) =>
  hotel.pmsSystemCode === 'OTHER'
    ? hotel.pmsSystemName
    : PMS_LABELS[hotel.pmsSystemCode]

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

const PLATFORM_ORDER = ['CTRIP', 'MEITUAN', 'FLIGGY', 'DOUYIN', 'QUNAR', 'TONGCHENG', 'OTHER'] as const

const configuredOtaSources = (sources: OtaSourceView[]) => [...sources]
  .sort((left, right) => {
    const leftIndex = PLATFORM_ORDER.indexOf(left.platformCode as typeof PLATFORM_ORDER[number])
    const rightIndex = PLATFORM_ORDER.indexOf(right.platformCode as typeof PLATFORM_ORDER[number])
    return (leftIndex < 0 ? PLATFORM_ORDER.length : leftIndex)
      - (rightIndex < 0 ? PLATFORM_ORDER.length : rightIndex)
  })
  .filter((source, index, all) =>
    all.findIndex((candidate) => candidate.platformCode === source.platformCode) === index)

const storeMonogram = (hotelName: string) => hotelName.trim().match(/[\u3400-\u9fffA-Za-z0-9]/)?.[0] ?? '店'

function otaState(source: OtaSourceView | undefined): { tone: Tone; label: string } {
  if (!source) return { tone: 'muted', label: '未配置' }
  if (!source.enabled) return { tone: 'muted', label: '已停用' }
  if (source.lastRefreshStatus === 'FAILED') return { tone: 'error', label: '异常' }
  if (source.lastRefreshStatus === 'COMPLETE') return { tone: 'ok', label: '正常' }
  return { tone: 'warning', label: '待验证' }
}

function pmsRepairState(summary: HotelSummary) {
  if (summary.hotel.pmsSystemCode === 'OTHER') {
    return { required: false, reasons: [] as PmsRepairReason[] }
  }
  const evaluated = evaluatePmsRepair({
    monitor: summary.monitor,
    trustedDeviceStatus: summary.trustedDeviceStatus,
  })
  const incidentRequired = summary.incidents.some((item) =>
    item.type === 'PMS_REPAIR_REQUIRED' && !/CLOSED|RESOLVED/i.test(item.status))
  const incidentReasons = summary.incidents
    .filter((item) => item.type === 'PMS_REPAIR_REQUIRED' && !/CLOSED|RESOLVED/i.test(item.status))
    .flatMap((item) => (item.directionCode ?? '').split(','))
    .filter((reason): reason is PmsRepairReason => reason in PMS_REPAIR_REASON_LABEL)
  return {
    required: summary.unavailable || evaluated.required || incidentRequired,
    reasons: [...new Set([...evaluated.reasons, ...incidentReasons])],
  }
}

function pmsState(summary: HotelSummary): { tone: Tone; label: string } {
  if (summary.hotel.pmsSystemCode === 'OTHER') {
    return { tone: 'warning', label: '待接入' }
  }
  if (pmsRepairState(summary).required) {
    return { tone: 'error', label: '需要修复处理' }
  }
  return { tone: 'ok', label: '正常' }
}

function broadcastDiagnosis(summary: HotelSummary): { tone: Tone; label: string; tab: StoreTab } {
  const failedIncident = summary.incidents.some((item) =>
    /BROADCAST|DELIVERY|WECOM|MESSAGE/i.test(item.type) && !/CLOSED|RESOLVED/i.test(item.status))
  const failedDelivery = ['REJECTED', 'AMBIGUOUS']
    .includes(summary.wecom?.lastDelivery?.deliveryStatus ?? '')
  const latestBrief = [...summary.briefs]
    .sort((left, right) => right.publishedAt.localeCompare(left.publishedAt))[0]
  const monitorReady = summary.monitor?.completeness === 'COMPLETE'
    && Boolean(summary.monitor.collectionRunId)
  const briefReady = latestBrief?.completenessCode === 'COMPLETE'

  if ((failedIncident || failedDelivery) && (!monitorReady || !briefReady)) {
    return { tone: 'warning', label: '上游数据待处理', tab: 'collection' }
  }
  if (failedIncident || failedDelivery) {
    return { tone: 'error', label: '播报异常', tab: 'broadcast' }
  }
  if (summary.wecom?.lastDelivery?.deliveryStatus === 'DELIVERED') {
    return { tone: 'ok', label: '正常', tab: 'broadcast' }
  }
  return { tone: 'warning', label: '待验证', tab: 'broadcast' }
}

const broadcastState = (summary: HotelSummary) => broadcastDiagnosis(summary)

function directTarget(summary: HotelSummary): { tab: StoreTab; label: string } | null {
  if (summary.hotel.pmsSystemCode === 'OTHER') {
    return { tab: 'collection', label: '完善PMS接入' }
  }
  const pms = pmsState(summary)
  if (pms.tone === 'error') {
    return { tab: 'repair', label: 'PMS需要修复处理' }
  }
  const failedOta = configuredOtaSources(summary.otaSources)
    .find((source) => otaState(source).tone === 'error')
  if (failedOta) {
    return { tab: 'collection', label: `检查${sourceDisplayName(failedOta.platformCode)}` }
  }
  const broadcast = broadcastDiagnosis(summary)
  if (broadcast.label === '上游数据待处理') {
    return { tab: 'collection', label: '检查采集数据' }
  }
  if (broadcast.tone === 'error') {
    return { tab: broadcast.tab, label: '检查播报' }
  }
  return null
}

async function loadHotelSummary(hotel: SimulationHotelView): Promise<HotelSummary> {
  const context = { tenantId: hotel.tenantId, hotelId: hotel.hotelId }
  const [monitor, otaSources, wecom, briefs, incidents, trustedDeviceStatus] = await Promise.allSettled([
    loadMonitor(context), loadOtaSources(context), loadWeComConfig(context), loadBriefs(context),
    loadIncidents(context),
    loadTrustedDeviceStatus(context),
  ])
  return {
    hotel,
    monitor: monitor.status === 'fulfilled' ? monitor.value : null,
    otaSources: otaSources.status === 'fulfilled' ? otaSources.value : [],
    wecom: wecom.status === 'fulfilled' ? wecom.value : null,
    briefs: briefs.status === 'fulfilled' ? briefs.value : [],
    incidents: incidents.status === 'fulfilled' ? incidents.value : [],
    trustedDeviceStatus: trustedDeviceStatus.status === 'fulfilled' ? trustedDeviceStatus.value : null,
    unavailable: [monitor, otaSources, wecom, briefs, incidents, trustedDeviceStatus].every((item) => item.status === 'rejected'),
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
      || pmsDisplayName(summary.hotel).toLowerCase().includes(query)
    const needsAttention = Boolean(directTarget(summary))
    return matchesSearch && (filter === 'ALL' || (filter === 'ATTENTION' ? needsAttention : !needsAttention))
  }), [filter, search, summaries])

  const abnormalCount = summaries.filter((summary) => directTarget(summary)).length
  const latest = summaries
    .map((summary) => summary.monitor?.cutoffAt)
    .filter((value): value is string => Boolean(value))
    .sort()
    .at(-1)

  return (
    <section className="console-page store-overview-page">
      <div className="page-title-row">
        <div>
          <p className="section-kicker">门店经营总览</p>
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
          const otaSources = configuredOtaSources(summary.otaSources)
          const direct = directTarget(summary)
          const openIncidents = summary.incidents.filter((item) => !/CLOSED|RESOLVED/i.test(item.status)).length
          const rowTone = pms.tone === 'error'
            || otaSources.some((source) => otaState(source).tone === 'error')
            || broadcast.tone === 'error'
            ? 'error'
            : direct ? 'warning' : 'ok'
          return (
            <article className={`store-row has-${rowTone}`} key={summary.hotel.hotelId}>
              <button className="store-main" type="button" onClick={() => onOpen(summary.hotel)}>
                <span className="store-avatar">{storeMonogram(summary.hotel.hotelName)}</span>
                <span><strong>{summary.hotel.hotelCode} · {summary.hotel.hotelName}</strong><small>{pmsDisplayName(summary.hotel)} · {businessCodeLabel(summary.hotel.lifecycleStatus, '状态待确认')}</small></span>
              </button>
              <div className="source-statuses">
                <button aria-label={`打开 PMS 处理页面，当前${pms.label}`} className="channel-status-link" onClick={() => onOpen(summary.hotel, pmsRepairState(summary).required ? 'repair' : 'collection')} type="button"><PlatformIcon name="PMS" /><Status tone={pms.tone}>PMS · {pms.label}</Status></button>
                {otaSources.map((source) => {
                  const state = otaState(source)
                  return <button aria-label={`打开${sourceDisplayName(source.platformCode)}配置，当前${state.label}`} className="channel-status-link" key={source.platformCode} onClick={() => onOpen(summary.hotel, 'collection')} type="button"><PlatformIcon name={source.platformCode as PlatformIconName} /><Status tone={state.tone}>{sourceDisplayName(source.platformCode)} · {state.label}</Status></button>
                })}
                <button aria-label={`打开${broadcast.tab === 'collection' ? '采集配置' : '播报记录'}，当前${broadcast.label}`} className="channel-status-link" onClick={() => onOpen(summary.hotel, broadcast.tab)} type="button"><PlatformIcon name="BROADCAST" /><Status tone={broadcast.tone}>播报 · {broadcast.label}</Status></button>
              </div>
              <div className="store-meta"><strong>{formatTime(summary.monitor?.cutoffAt)}</strong><small>{openIncidents ? `${openIncidents}项异常待处理` : '最近检查'}</small></div>
              <button className={`row-action${direct ? ' direct' : ''}`} type="button" onClick={() => onOpen(summary.hotel, direct?.tab)}>{direct ? <><Icon name="arrow" />一键直达<small>{direct.label}</small></> : <>进入门店<Icon name="chevron" /></>}</button>
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
  roomTypes: RoomTypeConfigurationView | null
  trustedDeviceStatus: TrustedDeviceStatus | null
  outbox: OutboxPreview[]
}

const emptyDetail: DetailData = {
  configuration: null, monitor: null, otaSources: [], wecom: null,
  briefs: [], incidents: [], roomTypes: null, trustedDeviceStatus: null,
  outbox: [],
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
  const authorizedInitialTab = initialTab === 'collection' && !canConfigure ? 'repair' : initialTab
  const [tab, setTab] = useState<StoreTab>(authorizedInitialTab)
  const [data, setData] = useState<DetailData>(emptyDetail)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [dataUnavailable, setDataUnavailable] = useState(false)
  const [collecting, setCollecting] = useState(false)
  const [notice, setNotice] = useState('')
  const collectingRef = useRef(false)
  const collectionAbortRef = useRef<AbortController | null>(null)
  const refreshSequenceRef = useRef(0)
  const contextKey = `${context.tenantId}\u0000${context.hotelId}`

  const refresh = useCallback(async () => {
    const sequence = ++refreshSequenceRef.current
    setLoading(true)
    setError('')
    const results = await Promise.allSettled([
      loadConfiguration(context), loadMonitor(context), loadOtaSources(context),
      loadWeComConfig(context), loadBriefs(context), loadIncidents(context),
      loadRoomTypeConfiguration(context),
      loadTrustedDeviceStatus(context),
      loadOutboxPreview(context),
    ])
    if (sequence !== refreshSequenceRef.current) return
    setData({
      configuration: results[0].status === 'fulfilled' ? results[0].value : null,
      monitor: results[1].status === 'fulfilled' ? results[1].value : null,
      otaSources: results[2].status === 'fulfilled' ? results[2].value : [],
      wecom: results[3].status === 'fulfilled' ? results[3].value : null,
      briefs: results[4].status === 'fulfilled' ? results[4].value : [],
      incidents: results[5].status === 'fulfilled' ? results[5].value : [],
      roomTypes: results[6].status === 'fulfilled' ? results[6].value : null,
      trustedDeviceStatus: results[7].status === 'fulfilled' ? results[7].value : null,
      outbox: results[8].status === 'fulfilled' ? results[8].value : [],
    })
    const unavailable = results.every((result) => result.status === 'rejected')
    setDataUnavailable(unavailable)
    if (unavailable) {
      setError('门店数据暂时不可用，请检查连接状态。')
    }
    setLoading(false)
  }, [context])

  useEffect(() => {
    setTab(initialTab === 'collection' && !canConfigure ? 'repair' : initialTab)
  }, [canConfigure, initialTab])
  useEffect(() => {
    collectionAbortRef.current?.abort()
    collectionAbortRef.current = null
    collectingRef.current = false
    refreshSequenceRef.current += 1
    setCollecting(false)
    setNotice('')
    setError('')
    setData(emptyDetail)
    setDataUnavailable(false)
    return () => {
      refreshSequenceRef.current += 1
      collectionAbortRef.current?.abort()
      collectionAbortRef.current = null
      collectingRef.current = false
    }
  }, [contextKey])
  useEffect(() => { void refresh() }, [refresh])

  const collect = async () => {
    if (collectingRef.current) return
    collectingRef.current = true
    setCollecting(true); setNotice(''); setError('')
    const controller = new AbortController()
    collectionAbortRef.current?.abort()
    collectionAbortRef.current = controller
    const isCurrentOperation = () => (
      collectionAbortRef.current === controller && !controller.signal.aborted
    )
    try {
      const trusted = data.trustedDeviceStatus
      if (!trusted) {
        throw new Error('采集方式尚未加载，请刷新状态后重试。')
      }
      if (trusted.eligible) {
        if (trusted.mode !== 'STORE_TRUSTED_DEVICE') {
          throw new Error('可信设备采集状态异常，请刷新后重试。')
        }
        if (!trusted.device || trusted.device.status !== 'ACTIVE') {
          setTab('repair')
          throw new Error('请先在登录修复中完成本机可信设备安装与绑定。')
        }
        const baselineSnapshotAt = trusted.device.lastSnapshotAt
        setNotice(
          `正在调用${trusted.hotelCode}门店电脑采集；浏览器询问时请选择“打开”。`,
        )
        // Keep the external-protocol navigation in the original click stack;
        // awaiting a network request first can consume Chrome user activation.
        window.location.href = trustedDeviceRepairUrl(trusted.hotelCode)
        const next = await waitForTrustedDeviceSnapshot(
          context,
          baselineSnapshotAt,
          { signal: controller.signal },
        )
        if (!isCurrentOperation()) return
        if (
          next.device?.lastCompleteness !== 'COMPLETE'
          || !next.device.cutoverReady
        ) {
          setTab('repair')
          throw new Error('本机已返回数据，但快照仍不完整，请进入登录修复查看状态。')
        }
        await refresh()
        if (!isCurrentOperation()) return
        setNotice(
          '本机采集已完成，仅更新数据，不自动群发。可在“播报记录”中确认后补发最新正式播报。',
        )
        return
      }

      // Only stores explicitly declared ineligible for trusted-device mode
      // both in the loaded page and in a fresh server read may use the legacy
      // cloud collector. A status read failure therefore fails closed.
      const latest = await loadTrustedDeviceStatus(
        context,
        { signal: controller.signal },
      )
      if (!isCurrentOperation()) return
      setData((current) => ({ ...current, trustedDeviceStatus: latest }))
      if (latest.eligible) {
        throw new Error('该门店已切换为本机可信设备采集，请再次点击“立即采集”。')
      }
      const run = await triggerLiveCollection(context)
      if (!isCurrentOperation()) return
      setNotice(
        run.status === 'SUCCEEDED'
          ? '采集已完成，仅更新数据，不自动群发。可在“播报记录”中确认后补发最新正式播报。'
          : `采集完成：${businessCodeLabel(run.status)}；仅更新数据，不自动群发。`,
      )
      await refresh()
    } catch (cause) {
      if (
        controller.signal.aborted
        || (cause instanceof DOMException && cause.name === 'AbortError')
      ) return
      setError(businessErrorMessage(cause, '采集触发失败'))
    } finally {
      if (collectionAbortRef.current === controller) {
        collectionAbortRef.current = null
        collectingRef.current = false
        setCollecting(false)
      }
    }
  }

  const summary: HotelSummary = { hotel, monitor: data.monitor, otaSources: data.otaSources, wecom: data.wecom, briefs: data.briefs, incidents: data.incidents, trustedDeviceStatus: data.trustedDeviceStatus, unavailable: dataUnavailable }
  const pms = pmsState(summary)
  const pmsRepair = pmsRepairState(summary)
  const broadcast = broadcastState(summary)
  const connectionTab: StoreTab = canConfigure ? 'collection' : 'repair'
  const lastCollectionAt = data.monitor?.cutoffAt ?? null
  const latestBrief = [...data.briefs]
    .sort((left, right) => left.cutoffAt.localeCompare(right.cutoffAt))
    .at(-1)
  const latestDelivered = [...data.outbox]
    .filter((message) => message.deliveryStatus === 'DELIVERED')
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
    .at(-1)
  const trustedDeviceCollection = data.trustedDeviceStatus?.eligible
    && data.trustedDeviceStatus.mode === 'STORE_TRUSTED_DEVICE'

  return (
    <section className="console-page store-detail-page">
      <button className="back-link" type="button" onClick={onBack}>‹ 返回门店总览</button>
      <div className="page-title-row compact-title">
        <div><p className="section-kicker">{hotel.hotelCode} · 门店工作台</p><h1>{hotel.hotelName}</h1><p>{pmsDisplayName(hotel)} · 账号仅可读取授权门店</p></div>
        <div className="title-actions"><button className="quiet-button" type="button" onClick={() => void refresh()}><Icon name="refresh" />刷新状态</button><button className="quiet-button" type="button" onClick={() => setTab(connectionTab)}><Icon name={canConfigure ? 'settings' : 'shield'} />{canConfigure ? '门店设置' : '登录修复'}</button></div>
      </div>

      <div className="store-health-bar">
        <button className="channel-status-link" onClick={() => setTab(pmsRepair.required ? 'repair' : connectionTab)} type="button"><PlatformIcon name="PMS" /><Status tone={pms.tone}>PMS · {pms.label}</Status></button>
        {configuredOtaSources(data.otaSources).map((source) => { const state = otaState(source); return <button className="channel-status-link" key={source.platformCode} onClick={() => setTab(connectionTab)} type="button"><PlatformIcon name={source.platformCode as PlatformIconName} /><Status tone={state.tone}>{sourceDisplayName(source.platformCode)} · {state.label}</Status></button> })}
        <button className="channel-status-link" onClick={() => setTab(broadcast.tab)} type="button"><PlatformIcon name="BROADCAST" /><Status tone={broadcast.tone}>播报 · {broadcast.label}</Status></button>
      </div>

      <nav className="store-tabs" aria-label="门店功能">
        {([
          ['overview', '门店概览'],
          ['repair', '登录修复'],
          ...(canConfigure ? [['collection', '采集配置'] as [StoreTab, string]] : []),
          ['operations', '运营配置'],
          ['broadcast', '播报记录'],
        ] as Array<[StoreTab, string]>).map(([code, label]) => <button key={code} className={tab === code ? 'active' : ''} onClick={() => setTab(code)} type="button">{label}</button>)}
      </nav>

      {error ? <div className="inline-message error" role="alert">{error}</div> : null}
      {notice ? <div className="inline-message success" role="status">{notice}</div> : null}
      {loading ? <LoadingState /> : null}

      {!loading && tab === 'overview' ? (
        <div className="detail-overview">
          {pmsRepair.required ? <button className="issue-banner" type="button" onClick={() => setTab('repair')}><Icon name="alert" size={22} /><span><strong>PMS需要修复处理</strong><small>{pmsRepair.reasons.map((reason) => PMS_REPAIR_REASON_LABEL[reason]).join('；') || 'PMS状态暂时不可用'}</small></span><span>一键直达<Icon name="chevron" /></span></button> : null}
          {data.incidents.some((item) => item.type !== 'PMS_REPAIR_REQUIRED' && !/CLOSED|RESOLVED/i.test(item.status)) ? (
            <button className="issue-banner" type="button" onClick={onOpenExceptions}><Icon name="alert" size={22} /><span><strong>{data.incidents.filter((item) => item.type !== 'PMS_REPAIR_REQUIRED' && !/CLOSED|RESOLVED/i.test(item.status)).length}项其他问题需要处理</strong><small>查看异常原因及安全处理入口</small></span><span>进入异常处理<Icon name="chevron" /></span></button>
          ) : null}

          <div className="section-heading overview-data-heading">
            <div><h2>总数据预览</h2><p>PMS 与 OTA 最近一次成功采集结果；手工采集仅更新数据，不自动群发。</p></div>
            <div className="overview-data-actions">
              <div className="last-collection-time" aria-label={`最后采集时间：${lastCollectionAt ? formatTime(lastCollectionAt) : '尚未采集'}`}>
                <span>最后采集时间</span>
                <strong>{lastCollectionAt ? <time dateTime={lastCollectionAt}>{formatTime(lastCollectionAt)}</time> : '尚未采集'}</strong>
              </div>
              <button className="primary-button" disabled={collecting} onClick={() => void collect()} type="button"><Icon name="refresh" />{collecting ? (trustedDeviceCollection ? '正在调用本机…' : '正在采集…') : (trustedDeviceCollection ? '本机立即采集' : '立即采集')}</button>
            </div>
          </div>
          <div className="metric-table">
            {Object.entries(data.monitor?.metrics ?? {}).slice(0, 8).map(([code, metric]) => (
              <div key={code}><span>{metricLabel(code)}</span><strong>{metric.state === 'AVAILABLE' ? `${metric.value ?? '—'}${unitLabel(metric.unit) ? ` ${unitLabel(metric.unit)}` : ''}` : '—'}</strong><small>{metric.state === 'AVAILABLE' ? '已采集' : businessCodeLabel(metric.state, '数据待确认')}</small></div>
            ))}
            {!Object.keys(data.monitor?.metrics ?? {}).length ? <EmptyState title="暂无可预览数据" detail="完成 PMS 登录并执行一次采集后显示。" /> : null}
          </div>

          <div className="two-column-section">
            <section className="content-panel">
              <div className="section-heading small"><div><h2>数据连接</h2><p>连接状态与最近同步时间</p></div><button className="text-link" onClick={() => setTab(connectionTab)} type="button">{canConfigure ? '查看配置' : '登录修复'}</button></div>
              <div className="connection-table">
                <div><strong className="connection-name"><PlatformIcon name="PMS" />{pmsDisplayName(hotel)}</strong><Status tone={pms.tone}>{pms.label}</Status><span>{formatTime(data.monitor?.cutoffAt)}</span></div>
                {configuredOtaSources(data.otaSources).map((source) => { const state = otaState(source); return <div key={source.platformCode}><strong className="connection-name"><PlatformIcon name={source.platformCode as PlatformIconName} />{sourceDisplayName(source.platformCode)}</strong><Status tone={state.tone}>{state.label}</Status><span>{formatTime(source.lastRefreshAt)}</span></div> })}
              </div>
            </section>
            <section className="content-panel">
              <div className="section-heading small"><div><h2>播报状态</h2><p>最新数据与企业微信送达分别记录</p></div><button className="text-link" onClick={() => setTab(broadcast.tab)} type="button">{broadcast.tab === 'collection' ? '检查上游数据' : canConfigure ? '查看及补发' : '查看记录'}</button></div>
              <div className="broadcast-summary"><Status tone={broadcast.tone}>{broadcast.label}</Status><dl><div><dt>最新数据时间</dt><dd>{formatTime(lastCollectionAt)}</dd></div><div><dt>最新简报状态</dt><dd>{businessCodeLabel(latestBrief?.deliveryStatus, '尚未生成')}</dd></div><div><dt>最近企微送达</dt><dd>{formatTime(latestDelivered?.createdAt)}</dd></div></dl></div>
            </section>
          </div>
        </div>
      ) : null}

      {!loading && tab === 'repair' ? <StoreRepairPanel context={context} pmsSystemCode={hotel.pmsSystemCode} canConfigure={canConfigure} onStatusChanged={() => void refresh()} /> : null}

      {!loading && tab === 'collection' && canConfigure ? <div className="embedded-legacy-page"><ReportSourceConfigPage context={context} canConfigure pmsSystemCode={hotel.pmsSystemCode} attentionItems={[]} otaAttentionSourceId={null} /></div> : null}

      {!loading && tab === 'operations' ? (
        <div className="operations-layout">
          {data.roomTypes ? (
            <HotSellingRoomConfigPanel
              canConfigure={canRevenueConfigure}
              configuration={data.roomTypes}
              context={context}
              onSaved={(roomTypes) => setData((current) => ({
                ...current,
                roomTypes,
              }))}
            />
          ) : (
            <EmptyState title="房型配置暂不可用" detail="房型配置服务读取失败，请刷新后重试；这不等同于 PMS 尚未采集。" />
          )}
          <div className="embedded-legacy-page"><MappingTargetPage context={context} canConfigure={canRevenueConfigure} showProductMappings={false} /></div>
        </div>
      ) : null}

      {!loading && tab === 'broadcast' ? <div className="embedded-legacy-page"><HistoryPage context={context} canConfigure={canConfigure} onStatusChanged={() => void refresh()} /></div> : null}
    </section>
  )
}

export async function loadAuthorizedHotels(): Promise<SimulationHotelView[]> {
  return (await listSimulationHotels()).hotels
}

export type { StoreTab }
