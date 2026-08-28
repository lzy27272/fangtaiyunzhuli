import { useCallback, useEffect, useState } from 'react'
import {
  loadHotSellingRoomTypes,
  loadLuopanBrowserConfig,
  loadMonitor,
  loadOtaSources,
  loadReportSources,
  saveHotSellingRoomTypes,
  triggerLiveCollection,
  type HotelContext,
  type LiveCollectionRunView,
  type LuopanBrowserConfigView,
  type MonitorView,
  type OtaSourceView,
  type ReportSourceView,
} from '../api/business'
import { StatePanel } from '../components/StatePanel'
import {
  reportSourceGuidance,
  type ReportSourceAttention,
} from './reportSourceAttention'
import { otaSourceGuidance } from './otaSourceGuidance'
import {
  buildOtaHotelReviewDashboard,
  isOtaDashboardSource,
  type OtaHotelReviewRateStatus,
} from './otaReviewDashboard'

interface Props {
  context: HotelContext | null
  onOpenReportSources: (attention: ReportSourceAttention[]) => void
  onOpenOtaSource: (sourceId?: string) => void
}

const METRIC_LABELS: Record<string, string> = {
  totalRevenue: '房费收入（报表口径）',
  adr: '平均房价 ADR',
  revPar: '单房收益 RevPAR',
  soldRooms: '今日已售间夜',
  availableRooms: '今日可售',
  targetProgress: '目标完成进度',
  sellProgress: '售卖进度',
}

const OTA_PEER_RANK_LABELS: Record<string, string> = {
  OVERALL: '综合表现',
  ORDER_COUNT: '订单量',
  REVIEW_SCORE: '评价表现',
  STAY_ROOM_NIGHTS: '入住间夜',
  ROOM_REVENUE: '房费收入',
  SOLD_ROOM_NIGHTS: '销售间夜',
  GMV: '销售额',
  EXPOSURE: '曝光',
  VIEWS: '浏览',
  VIEW_CONVERSION: '浏览转化',
  PAYMENT_CONVERSION: '支付转化',
}

const otaProviderLabel = (provider?: string): string => {
  if (provider === 'MEITUAN') return '美团'
  if (provider === 'DOUYIN') return '抖音'
  if (provider === 'FLIGGY') return '飞猪'
  return 'OTA'
}

function pollingIntervalLabel(minutes: number): string {
  if (minutes === 30) return '每30分钟'
  if (minutes % 1_440 === 0) return `每${minutes / 1_440}天`
  if (minutes % 60 === 0) return `每${minutes / 60}小时`
  return `每${minutes}分钟`
}

function observedAtLabel(value: string): string {
  const observedAt = new Date(value)
  return Number.isNaN(observedAt.getTime())
    ? '采集时间待核验'
    : `采集于 ${observedAt.toLocaleString('zh-CN', { hour12: false })}`
}

function otaPairingStatusLabel(status?: string): string {
  if (status === 'AVAILABLE') return '订单与评价已配对'
  if (status === 'ZERO_DENOMINATOR') return '截止昨日有效订单为0'
  if (status === 'ORDER_SOURCE_MISSING') return '待配置同平台订单接口'
  if (status === 'ORDER_DATA_INCOMPLETE') return '订单数据未完整分页'
  if (status === 'REVIEW_SCORE_METRICS_UNAVAILABLE') return '评价评分字段待映射'
  if (status === 'PERIOD_MISMATCH') return '订单与评价统计期不一致'
  return '等待订单与评价配对'
}

function otaHotelReviewRateStatusLabel(
  status: OtaHotelReviewRateStatus,
): string {
  if (status === 'AVAILABLE') return '已按全渠道汇总口径计算'
  if (status === 'NO_REVIEW_DATA') return '等待渠道评价数据'
  if (status === 'PERIOD_MISMATCH') return '各渠道统计期不一致'
  if (status === 'ZERO_DENOMINATOR') return '截止昨日全渠道有效订单为0'
  return '部分渠道订单分母尚未就绪'
}

function displayMetric(value: string | number | null | undefined, unit: string, state: string): string {
  if (state === 'UNAVAILABLE') return '无法判断'
  if (state === 'NOT_CONFIGURED') return '暂未配置标准'
  if (state === 'NOT_APPLICABLE') return '不适用'
  if (value === null || value === undefined) return '无法判断'
  return `${value}${unit === 'PERCENT'
    ? '%'
    : unit === 'ROOM'
      ? '间'
      : unit === 'ROOM_NIGHT'
        ? '间夜'
        : unit === 'CURRENCY'
          ? '元'
          : ''}`
}

function sameRoomTypeCodes(left: string[], right: string[]) {
  if (left.length !== right.length) return false
  const leftCodes = new Set(left)
  const rightCodes = new Set(right)
  return (
    leftCodes.size === rightCodes.size
    && [...leftCodes].every((code) => rightCodes.has(code))
  )
}

function collectionErrorMessage(cause: unknown): string {
  const code = cause instanceof Error ? cause.message : ''
  if (code === 'REPORT_SOURCE_COOKIE_REQUIRED') {
    return '当前门店已配置报表接口，但尚未保存任何Cookie。请到“报表接口”页为当前门店填写并保存Cookie后重新采集。'
  }
  if (code === 'REPORT_SOURCE_ENABLED_REQUIRED') {
    return '当前门店没有启用的报表接口，请先到“报表接口”页启用接口。'
  }
  if (code === 'PMS_BUSINESS_DATE_UNAVAILABLE') {
    return '当前门店Cookie无法访问PMS营业日接口，可能已经失效或缺少登录上下文。请更新Cookie后重新采集。'
  }
  if (code === 'PMS_SESSION_REAUTH_REQUIRED') {
    return 'PMS已拒绝当前登录会话，本次未生成新简报。请到“报表接口”页更新当前门店的PMS Cookie后重新采集。'
  }
  if (code === 'PMS_BUSINESS_DATE_INVALID') {
    return 'PMS返回的营业日格式无效，本次未生成经营监控数据。'
  }
  return code || '真实采集失败'
}

export function MonitorPage({
  context,
  onOpenReportSources,
  onOpenOtaSource,
}: Props) {
  const [monitor, setMonitor] = useState<MonitorView | null>(null)
  const [run, setRun] = useState<LiveCollectionRunView | null>(null)
  const [hotRoomTypeCodes, setHotRoomTypeCodes] = useState<string[]>([])
  const [savedHotRoomTypeCodes, setSavedHotRoomTypeCodes] = useState<string[]>([])
  const [reportSources, setReportSources] = useState<ReportSourceView[]>([])
  const [otaSources, setOtaSources] = useState<OtaSourceView[]>([])
  const [luopanConfig, setLuopanConfig] =
    useState<LuopanBrowserConfigView | null>(null)
  const [loading, setLoading] = useState(false)
  const [running, setRunning] = useState(false)
  const [savingHotRooms, setSavingHotRooms] = useState(false)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')

  const refresh = useCallback(async () => {
    if (!context) return
    setLoading(true)
    setError('')
    try {
      const [
        monitorView,
        hotRoomConfig,
        sourceConfig,
        otaSourceConfig,
        luopanConfigView,
      ] = await Promise.all([
        loadMonitor(context),
        loadHotSellingRoomTypes(context),
        loadReportSources(context),
        loadOtaSources(context),
        loadLuopanBrowserConfig(context),
      ])
      setMonitor(monitorView)
      setHotRoomTypeCodes(hotRoomConfig.roomTypeCodes)
      setSavedHotRoomTypeCodes(hotRoomConfig.roomTypeCodes)
      setReportSources(sourceConfig)
      setOtaSources(otaSourceConfig)
      setLuopanConfig(luopanConfigView)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '读取监控失败')
    } finally {
      setLoading(false)
    }
  }, [context])

  const collectNow = useCallback(async () => {
    if (!context) return
    setRunning(true)
    setError('')
    setNotice('')
    try {
      const started = await triggerLiveCollection(context)
      setRun(started)
      setMonitor(started.monitor)
      setOtaSources(started.otaRefreshes ?? await loadOtaSources(context))
      setReportSources(await loadReportSources(context))
      setLuopanConfig(await loadLuopanBrowserConfig(context))
      setNotice(
        `已重新采集 ${started.successfulSourceCount}/${started.sourceCount} 个已配置报表。`,
      )
    } catch (cause) {
      setError(collectionErrorMessage(cause))
    } finally {
      setRunning(false)
    }
  }, [context])

  useEffect(() => {
    if (!context) {
      setHotRoomTypeCodes([])
      setSavedHotRoomTypeCodes([])
      setReportSources([])
      setOtaSources([])
      setLuopanConfig(null)
      return
    }
    void refresh()
  }, [context, refresh])

  function toggleHotRoomType(roomTypeCode: string) {
    setHotRoomTypeCodes((current) =>
      current.includes(roomTypeCode)
        ? current.filter((code) => code !== roomTypeCode)
        : [...current, roomTypeCode])
  }

  async function saveHotRooms() {
    if (!context || sameRoomTypeCodes(hotRoomTypeCodes, savedHotRoomTypeCodes)) return
    setSavingHotRooms(true)
    setError('')
    setNotice('')
    try {
      const saved = await saveHotSellingRoomTypes(
        context,
        hotRoomTypeCodes,
      )
      setHotRoomTypeCodes(saved.roomTypeCodes)
      setSavedHotRoomTypeCodes(saved.roomTypeCodes)
      setMonitor(await loadMonitor(context))
      setNotice('热销房型配置已保存；可售为0或以下时生成独立售罄预警。')
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : '保存热销房型失败',
      )
    } finally {
      setSavingHotRooms(false)
    }
  }

  const hotRoomTypesChanged = !sameRoomTypeCodes(
    hotRoomTypeCodes,
    savedHotRoomTypeCodes,
  )
  const saveHotRoomsLabel = savingHotRooms
    ? '保存中…'
    : hotRoomTypesChanged
      ? '保存更改'
      : hotRoomTypeCodes.length > 0
        ? '已保存'
        : '选择后保存'
  const enabledReportSources = reportSources.filter((source) => source.enabled)
  const luopanPrimaryEnabled =
    luopanConfig?.enabled === true
    && luopanConfig.scopeStatus === 'SINGLE_HOTEL_CONFIRMED'
  const enabledReportSourceIds = new Set(
    enabledReportSources.map((source) => source.sourceId),
  )
  const cookieReadySourceCount = enabledReportSources.filter(
    (source) => source.cookieConfigured,
  ).length
  const cookieMissingSources = enabledReportSources.filter(
    (source) => !source.cookieConfigured,
  )
  const cookieMissingAttention: ReportSourceAttention[] =
    cookieMissingSources.map((source) => ({
      sourceId: source.sourceId,
      sourceCode: source.displayName,
      errorCode: 'COOKIE_NOT_CONFIGURED',
    }))
  const incompleteMonitorSources = monitor?.sources.filter(
    (source) =>
      source.completeness !== 'COMPLETE'
      && (
        luopanPrimaryEnabled
        || enabledReportSourceIds.has(source.sourceId)
      ),
  ) ?? []
  const incompleteMonitorAttention: ReportSourceAttention[] =
    incompleteMonitorSources.map((source) => ({
      sourceId: source.sourceId,
      sourceCode: source.sourceCode,
      errorCode: source.errorCode ?? 'COLLECTION_INCOMPLETE',
    }))
  const visibleOtaSources = otaSources.filter(isOtaDashboardSource)
  const hotelReviewDashboard = buildOtaHotelReviewDashboard(otaSources)

  return (
    <section className="page-card">
      <div className="page-heading">
        <div>
          <p className="eyebrow">02 · MONITOR</p>
          <h2>多报表融合经营监控</h2>
          <p>从已保存的报表接口只读采集并融合计算；原始响应、Cookie、订单号和客人信息均不落盘。</p>
        </div>
        <div className="heading-actions">
          <button className="secondary" disabled={!context || loading} type="button" onClick={refresh}>
            刷新
          </button>
          <button
            disabled={!context || running}
            type="button"
            onClick={() => {
              void collectNow()
            }}
          >
            {running ? '采集中…' : '重新采集已配置报表'}
          </button>
        </div>
      </div>

      <div className="run-strip">
        <strong>PMS营业日</strong>
        <span>{run?.businessDate ?? monitor?.businessDate ?? '等待PMS采集返回'}</span>
        <span>以每次采集返回的PMS营业日为准，零点不自动切日</span>
      </div>

      {context && luopanPrimaryEnabled ? (
        <div className="monitor-readiness ready" role="status">
          罗盘云单门店主采集已启用；传统报表Cookie
          {' '}
          {cookieReadySourceCount}/{enabledReportSources.length}
          {' '}
          不会阻止罗盘采集。配置保存后自动采集一次，也可点击右上角手动采集。
        </div>
      ) : null}

      {context && !luopanPrimaryEnabled && enabledReportSources.length > 0 ? (
        <div
          className={`monitor-readiness ${
            cookieReadySourceCount === enabledReportSources.length
              ? 'ready'
              : 'missing'
          }`}
          role="status"
        >
          当前门店已启用
          {' '}
          {enabledReportSources.length}
          {' '}
          个报表接口，已保存Cookie
          {' '}
          {cookieReadySourceCount}
          /
          {enabledReportSources.length}
          个。
          {cookieReadySourceCount === enabledReportSources.length
            ? ' 采集凭据已就绪。'
            : ' 缺少Cookie的接口无法采集，请到“报表接口”页补充并保存。'}
          {cookieMissingSources.length > 0 ? (
            <ul className="monitor-attention-list">
              {cookieMissingSources.map((source) => (
                <li key={source.sourceId}>
                  {source.displayName}
                  {'：Cookie未配置'}
                </li>
              ))}
            </ul>
          ) : null}
          {cookieReadySourceCount < enabledReportSources.length ? (
            <button
              className="inline-action-link"
              type="button"
              onClick={() => onOpenReportSources(cookieMissingAttention)}
            >
              进入报表接口核对配置
            </button>
          ) : null}
        </div>
      ) : null}

      {run ? (
        <div className="run-strip">
          <strong>真实采集 {run.status}</strong>
          <span>{run.runId}</span>
          <span>来源 {run.successfulSourceCount}/{run.sourceCount}</span>
          <span>营业日候选 {run.businessDate}</span>
          <b>本次仅采集；企微在08:00至次日02:00的整点约06分推送</b>
        </div>
      ) : null}

      {notice ? <div className="success" role="status">{notice}</div> : null}

      {incompleteMonitorSources.length > 0 ? (
        <div className="monitor-readiness missing" role="alert">
          本次有
          {incompleteMonitorSources.length}
          个报表来源未完整采集，请核对接口、Cookie及POST载荷。
          <ul className="monitor-attention-list">
            {incompleteMonitorSources.map((source) => {
              const configuredSource = reportSources.find(
                (item) => item.sourceId === source.sourceId,
              )
              const sourceIndex = reportSources.findIndex(
                (item) => item.sourceId === source.sourceId,
              )
              const guidance = reportSourceGuidance(
                source.errorCode ?? 'COLLECTION_INCOMPLETE',
              )
              return (
                <li key={source.sourceId}>
                  <strong>
                    {sourceIndex >= 0
                      ? `报表 ${String(sourceIndex + 1).padStart(2, '0')} · `
                      : ''}
                    {configuredSource?.displayName ?? source.sourceCode}
                  </strong>
                  <span>
                    {guidance.reason}
                    {'；核对：'}
                    {guidance.fields.join('、')}
                  </span>
                </li>
              )
            })}
          </ul>
          <button
            className="inline-action-link"
            type="button"
            onClick={() =>
              onOpenReportSources(incompleteMonitorAttention)}
          >
            进入报表接口核对配置
          </button>
        </div>
      ) : null}

      {context ? (
        <section className="ota-monitor-panel">
          <div className="page-heading">
            <div>
              <h3>OTA排名与评价经营看板</h3>
              <p>
                仅展示各渠道排名、门店全渠道评价汇总及分渠道评价；
                订单数据只作为评价率分母在后台计算，不在看板展示。
              </p>
            </div>
            <button
              className="secondary"
              type="button"
              onClick={() => onOpenOtaSource()}
            >
              配置OTA来源
            </button>
          </div>
          {hotelReviewDashboard.channels.length > 0 ? (
            <section className="ota-peer-rank-board ota-review-board ota-hotel-review-board">
              <header>
                <div>
                  <strong>门店全渠道评价总览</strong>
                  <small>
                    本月 {hotelReviewDashboard.monthStart ?? '统计期待对齐'} 起
                    {' · '}已纳入 {hotelReviewDashboard.channels.length} 个渠道
                  </small>
                </div>
                <span>
                  {hotelReviewDashboard.latestObservedAt
                    ? observedAtLabel(hotelReviewDashboard.latestObservedAt)
                    : '等待渠道采集'}
                </span>
              </header>
              <div className="ota-peer-rank-metrics">
                <div>
                  <span>本月全渠道好评</span>
                  <strong>{hotelReviewDashboard.monthlyGoodCount} 条</strong>
                </div>
                <div>
                  <span>截止昨日全渠道好评率</span>
                  <strong>
                    {hotelReviewDashboard.goodRatePercent === null
                      ? otaHotelReviewRateStatusLabel(hotelReviewDashboard.rateStatus)
                      : `${hotelReviewDashboard.goodRatePercent}%`}
                  </strong>
                </div>
                <div>
                  <span>本月全渠道差评</span>
                  <strong>{hotelReviewDashboard.monthlyNegativeCount} 条</strong>
                </div>
                <div>
                  <span>昨日全渠道新增差评</span>
                  <strong>{hotelReviewDashboard.yesterdayNegativeCount} 条</strong>
                </div>
                <div>
                  <span>截止昨日全渠道差评率</span>
                  <strong>
                    {hotelReviewDashboard.negativeRatePermille === null
                      ? otaHotelReviewRateStatusLabel(hotelReviewDashboard.rateStatus)
                      : `${hotelReviewDashboard.negativeRatePermille}‰`}
                  </strong>
                </div>
              </div>
              <small>
                全渠道好评率＝所有已配置渠道截止昨日好评数之和 ÷
                所有对应渠道截止昨日有效订单数之和；差评率按相同分母 ×1000‰。
                订单仅用于后台测算，不在看板显示。
              </small>
            </section>
          ) : null}

          {visibleOtaSources.length > 0 ? (
            <div className="ota-monitor-grid">
              {visibleOtaSources.map((source) => {
                const guidance = source.lastRefreshStatus === 'FAILED'
                  ? otaSourceGuidance(source.lastErrorCode)
                  : null
                return (
                  <article
                    className={
                      source.lastRefreshStatus === 'FAILED'
                        ? 'ota-monitor-source failed'
                        : 'ota-monitor-source'
                    }
                    key={source.sourceId}
                  >
                    <header>
                      <strong>{source.displayName}</strong>
                      <b className={
                        source.lastRefreshStatus === 'COMPLETE'
                          ? 'source-complete'
                          : 'source-partial'
                      }>
                        {source.lastRefreshStatus}
                      </b>
                    </header>
                    {source.lastSummary ? (
                      <>
                        {source.lastSummary.peerRanking ? (
                          <section className="ota-peer-rank-board">
                            <header>
                              <div>
                                <strong>
                                  {otaProviderLabel(source.lastSummary.peerRanking.provider)}
                                  排名实时看板
                                </strong>
                                <small>
                                  最近一次采集 · {pollingIntervalLabel(source.pollIntervalMinutes)}更新
                                </small>
                              </div>
                              <span>{observedAtLabel(source.lastSummary.observedAt)}</span>
                            </header>
                            <div className="ota-peer-rank-metrics">
                              {source.lastSummary.peerRanking.metrics.map((metric) => (
                                <div key={metric.code}>
                                  <span>{OTA_PEER_RANK_LABELS[metric.code] ?? metric.code}</span>
                                  <strong>
                                    {metric.rank === null ? '平台暂未返回' : `第 ${metric.rank} 名`}
                                  </strong>
                                </div>
                              ))}
                            </div>
                            <small>
                              平台口径为美团同行排名；当前接口未返回竞争圈总数和上期名次，
                              暂不计算前30%或升降趋势；遇到排名空值将在10分钟后补采。
                            </small>
                          </section>
                        ) : null}
                        {source.lastSummary.reviewMetrics ? (
                          <section className="ota-peer-rank-board ota-review-board">
                            <header>
                              <div>
                                <strong>
                                  {otaProviderLabel(source.lastSummary.reviewMetrics.provider)}
                                  评价经营看板
                                </strong>
                                <small>
                                  本月 {source.lastSummary.reviewMetrics.monthStart} 起
                                  {' · '}
                                  {pollingIntervalLabel(source.pollIntervalMinutes)}更新
                                </small>
                              </div>
                              <span>{observedAtLabel(source.lastSummary.observedAt)}</span>
                            </header>
                            <div className="ota-peer-rank-metrics">
                              <div>
                                <span>
                                  {source.lastSummary.reviewMetrics.provider === 'DOUYIN'
                                    ? '本月新增平台好评'
                                    : '本月新增 ≥4.8分'}
                                </span>
                                <strong>
                                  {source.lastSummary.reviewMetrics.monthlyGoodCount} 条
                                </strong>
                              </div>
                              <div>
                                <span>本月截止昨日好评率</span>
                                <strong>
                                  {source.lastSummary.reviewMetrics.goodRatePercent === null
                                    ? otaPairingStatusLabel(
                                      source.lastSummary.reviewOrderPairing?.status,
                                    )
                                    : `${source.lastSummary.reviewMetrics.goodRatePercent}%`}
                                </strong>
                              </div>
                              <div>
                                <span>
                                  {source.lastSummary.reviewMetrics.provider === 'DOUYIN'
                                    ? '本月平台差评'
                                    : '本月差评 <3.0分'}
                                </span>
                                <strong>
                                  {source.lastSummary.reviewMetrics.monthlyNegativeCount} 条
                                </strong>
                              </div>
                              <div>
                                <span>昨日新增差评</span>
                                <strong>
                                  {source.lastSummary.reviewMetrics.yesterdayNegativeCount} 条
                                </strong>
                              </div>
                              <div>
                                <span>本月截止昨日差评率</span>
                                <strong>
                                  {source.lastSummary.reviewMetrics.negativeRatePermille === null
                                    ? otaPairingStatusLabel(
                                      source.lastSummary.reviewOrderPairing?.status,
                                    )
                                    : `${source.lastSummary.reviewMetrics.negativeRatePermille}‰`}
                                </strong>
                              </div>
                            </div>
                            <small>
                              已通过
                              {source.lastSummary.reviewMetrics.provider === 'DOUYIN'
                                ? '抖音生活服务接口'
                                : `${otaProviderLabel(source.lastSummary.reviewMetrics.provider)}已配置接口`}
                              安全分页采集
                              {' '}{source.lastSummary.reviewMetrics.fetchedPageCount} 页；
                              仅保存日期和评分汇总，不保存评价正文、用户名或订单号。
                              {source.lastSummary.reviewMetrics.provider === 'DOUYIN'
                                ? ' 抖音按平台原生好评、中评、差评分类汇总；'
                                : null}
                              {' '}两项比率按同门店、同一OTA平台、同统计期的未取消订单测算，
                              不再混用PMS全渠道订单。
                            </small>
                          </section>
                        ) : null}
                        {source.lastSummary.providerDataset?.dataset === 'REVIEW'
                        && !source.lastSummary.reviewMetrics ? (
                          <section className="ota-peer-rank-board ota-review-board">
                            <header>
                              <div>
                                <strong>
                                  {otaProviderLabel(source.lastSummary.providerDataset.provider)}
                                  评价数据看板
                                </strong>
                                <small>
                                  {source.lastSummary.providerDataset.scope === 'BUSINESS_MONTH_TO_DATE'
                                    ? `${source.lastSummary.providerDataset.rangeStart} 至 ${source.lastSummary.providerDataset.rangeEnd}`
                                    : '接口累计与当前页'}
                                  {' · '}{pollingIntervalLabel(source.pollIntervalMinutes)}更新
                                </small>
                              </div>
                              <span>{observedAtLabel(source.lastSummary.observedAt)}</span>
                            </header>
                            <div className="ota-peer-rank-metrics">
                              <div>
                                <span>
                                  平台评价总数
                                </span>
                                <strong>
                                  {source.lastSummary.providerDataset.totalCount === null
                                    ? '平台暂未返回'
                                    : `${source.lastSummary.providerDataset.totalCount} 条`}
                                </strong>
                              </div>
                              <div>
                                <span>本次返回记录</span>
                                <strong>{source.lastSummary.providerDataset.returnedCount} 条</strong>
                              </div>
                              {source.lastSummary.providerDataset.hasMore !== undefined ? (
                                <div>
                                  <span>平台是否还有更多</span>
                                  <strong>
                                    {source.lastSummary.providerDataset.hasMore ? '是' : '否'}
                                  </strong>
                                </div>
                              ) : null}
                            </div>
                            <small>
                              仅保存数量、日期范围和状态汇总，不保存住客信息、评价正文或用户信息。
                              {' '}当前{otaProviderLabel(source.lastSummary.providerDataset.provider)}
                              接口尚未形成可确认的完整评分分页，暂不推算好评率和差评率。
                            </small>
                          </section>
                        ) : null}
                      </>
                    ) : null}
                    {guidance ? (
                      <div className="ota-monitor-error">
                        <strong>{guidance.reason}</strong>
                        <span>核对：{guidance.fields.join('、')}</span>
                        <button
                          className="inline-action-link"
                          type="button"
                          onClick={() => onOpenOtaSource(source.sourceId)}
                        >
                          直达修改
                        </button>
                      </div>
                    ) : null}
                  </article>
                )
              })}
            </div>
          ) : (
            <div className="state-panel">
              尚未配置OTA数据源。进入“报表接口”填写OTA后台网址、
              JSON数据接口、Cookie及账号密码。
            </div>
          )}
        </section>
      ) : null}

      {!context ? (
        <div className="state-panel">请先在顶部载入租户和门店。</div>
      ) : (
        <StatePanel loading={loading} error={error} empty={!monitor} emptyText="系统会在播报时段按30分钟轮询；也可以点击“重新采集已配置报表”。">
          {monitor ? (
            <>
              <div className="monitor-summary">
                <div>
                  <span>门店</span>
                  <strong>{monitor.hotelName}</strong>
                </div>
                <div>
                  <span>经营营业日</span>
                  <strong>{monitor.businessDate ?? '无法判断'}</strong>
                  <small>
                    {monitor.businessDateBasis === 'PMS_CONFIRMED'
                      ? '已按PMS夜审状态确认'
                      : '旧快照：日历日候选'}
                  </small>
                </div>
                <div>
                  <span>快照采集时间</span>
                  <strong>{monitor.cutoffAt ?? '尚未冻结'}</strong>
                </div>
                <div>
                  <span>完整度</span>
                  <strong className={`quality-${monitor.completeness.toLowerCase()}`}>
                    {monitor.completeness}
                  </strong>
                </div>
              </div>

              <div className="metric-grid">
                {Object.entries(monitor.metrics).map(([code, metric]) => (
                  <article className="metric-card" key={code}>
                    <span>{METRIC_LABELS[code] ?? code}</span>
                    <strong>{displayMetric(metric.value, metric.unit, metric.state)}</strong>
                    <small>{metric.state}</small>
                  </article>
                ))}
              </div>

              <h3>
                {monitor.hourlyDelta?.aggregationWindow === 'PAUSE_TO_FIRST_BRIEF'
                  ? '停播时段汇总'
                  : '小时快照差分'}
              </h3>
              {monitor.hourlyDelta?.basis === 'HOURLY_SNAPSHOT_DIFF'
                && monitor.hourlyDelta.totals ? (
                  <>
                    <div className="monitor-summary">
                      <div>
                        <span>对比区间</span>
                        <strong>
                          {monitor.hourlyDelta.intervalStartAt} → {monitor.hourlyDelta.intervalEndAt}
                        </strong>
                      </div>
                      <div>
                        <span>新增间夜</span>
                        <strong>{monitor.hourlyDelta.totals.newRoomNights}</strong>
                      </div>
                      <div>
                        <span>当日 / 远期</span>
                        <strong>
                          {monitor.hourlyDelta.totals.todayRoomNights}
                          {' / '}
                          {monitor.hourlyDelta.totals.futureRoomNights}
                        </strong>
                      </div>
                      <div>
                        <span>取消间夜</span>
                        <strong>{monitor.hourlyDelta.totals.canceledRoomNights}</strong>
                      </div>
                    </div>
                    <div className="source-row">
                      {Object.entries(monitor.hourlyDelta.byChannel ?? {}).map(([channel, delta]) => (
                        <article key={channel}>
                          <strong>{channel}</strong>
                          <span>新增 {delta.newRoomNights} 间夜</span>
                          <small>
                            当日 {delta.todayRoomNights}｜远期 {delta.futureRoomNights}
                            ｜取消 {delta.canceledRoomNights}
                          </small>
                        </article>
                      ))}
                    </div>
                  </>
                ) : (
                  <div className="state-panel">
                    基线已建立后，需再取得约一小时后的快照，才会计算小时进单与取消间夜。
                  </div>
                )}

              <h3>来源新鲜度</h3>
              <div className="source-row">
                {monitor.sources.map((source) => {
                  const configuredSource = reportSources.find(
                    (item) => item.sourceId === source.sourceId,
                  )
                  return (
                  <article key={source.sourceId}>
                    <strong>
                      {configuredSource?.displayName ?? source.sourceCode}
                    </strong>
                    <span className={`source-${source.completeness.toLowerCase()}`}>{source.completeness}</span>
                    <small>
                      {source.sourceCode}
                      {'｜'}
                      {source.sourceObservedAt ?? '尚未观察'}
                      {source.errorCode ? `｜${source.errorCode}` : ''}
                    </small>
                  </article>
                  )
                })}
              </div>

              <div className="page-heading">
                <div>
                  <h3>热销房型监测配置</h3>
                  <p>
                    勾选后持续监测实体可售量；为0或以下时生成售罄告警，
                    数据缺失时不误报。
                  </p>
                </div>
                <button
                  className="secondary"
                  disabled={
                    savingHotRooms
                    || monitor.inventory.length === 0
                    || !hotRoomTypesChanged
                  }
                  type="button"
                  onClick={saveHotRooms}
                >
                  {saveHotRoomsLabel}
                </button>
              </div>

              {(monitor.hotSellingAlerts ?? []).map((alert) => (
                <div
                  className={
                    alert.state === 'SOLD_OUT' ? 'shell-error' : 'state-panel'
                  }
                  key={alert.physicalRoomTypeCode}
                  role={alert.state === 'SOLD_OUT' ? 'alert' : 'status'}
                >
                  {alert.message}
                  {alert.state === 'SOLD_OUT'
                    ? '｜已进入独立预警候选，将在两类简报送达后1分钟推送。'
                    : ''}
                </div>
              ))}

              <h3>实体房型库存与热销标记</h3>
              <div className="inventory-list">
                {monitor.inventory.map((pool) => (
                  <article key={pool.inventoryPoolId}>
                    <header>
                      <strong>{pool.displayName}</strong>
                      <span>主库存报表可售 {pool.primaryAvailableRooms ?? '无法判断'}</span>
                      <label>
                        <input
                          checked={hotRoomTypeCodes.includes(
                            pool.physicalRoomTypeCode,
                          )}
                          type="checkbox"
                          onChange={() =>
                            toggleHotRoomType(pool.physicalRoomTypeCode)}
                        />
                        热销房型
                      </label>
                    </header>
                    {Object.entries(pool.otaAvailableRooms).map(([productCode, available]) => (
                      <div key={productCode}>
                        <span>辅助来源 · {productCode}</span>
                        <span>可售 {available}</span>
                        <b className={`inventory-${pool.state.toLowerCase()}`}>{pool.state}</b>
                      </div>
                    ))}
                    <small>
                      当前仅有实体房型报表时不做P1判断；接入OTA产品可售量后才逐项比较，绝不累加。
                    </small>
                  </article>
                ))}
              </div>
            </>
          ) : null}
        </StatePanel>
      )}
    </section>
  )
}
