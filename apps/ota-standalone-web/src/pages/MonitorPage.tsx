import { useCallback, useEffect, useState } from 'react'
import {
  loadHotSellingRoomTypes,
  loadMonitor,
  loadOtaSources,
  loadReportSources,
  saveHotSellingRoomTypes,
  triggerLiveCollection,
  type HotelContext,
  type LiveCollectionRunView,
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

const OTA_DIMENSION_LABELS: Record<string, string> = {
  DATE: '日期',
  ROOM_TYPE: '房型',
  INVENTORY: '库存/可售',
  PRICE: '价格/收入',
  SALES: '销量/间夜',
  CHANNEL: '渠道',
  CANCELLATION: '取消',
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
      ] = await Promise.all([
        loadMonitor(context),
        loadHotSellingRoomTypes(context),
        loadReportSources(context),
        loadOtaSources(context),
      ])
      setMonitor(monitorView)
      setHotRoomTypeCodes(hotRoomConfig.roomTypeCodes)
      setSavedHotRoomTypeCodes(hotRoomConfig.roomTypeCodes)
      setReportSources(sourceConfig)
      setOtaSources(otaSourceConfig)
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
      const sourceConfig = await loadReportSources(context)
      setReportSources(sourceConfig)
      const enabledSources = sourceConfig.filter((source) => source.enabled)
      if (enabledSources.length === 0) {
        throw new Error('REPORT_SOURCE_ENABLED_REQUIRED')
      }
      if (!enabledSources.some((source) => source.cookieConfigured)) {
        throw new Error('REPORT_SOURCE_COOKIE_REQUIRED')
      }
      const started = await triggerLiveCollection(context)
      setRun(started)
      setMonitor(started.monitor)
      setOtaSources(started.otaRefreshes ?? await loadOtaSources(context))
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
      setNotice('热销房型配置已保存；可售为0时生成售罄简报告警。')
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
    (source) => source.completeness !== 'COMPLETE',
  ) ?? []
  const incompleteMonitorAttention: ReportSourceAttention[] =
    incompleteMonitorSources.map((source) => ({
      sourceId: source.sourceId,
      sourceCode: source.sourceCode,
      errorCode: source.errorCode ?? 'COLLECTION_INCOMPLETE',
    }))

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

      {context && enabledReportSources.length > 0 ? (
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
              <h3>OTA多维度对比来源</h3>
              <p>
                OTA刷新结果与PMS报表分开留痕；当前显示JSON记录数及已识别的
                日期、房型、库存、价格、销量、渠道和取消等维度。
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
          {otaSources.length > 0 ? (
            <div className="ota-monitor-grid">
              {otaSources.map((source) => {
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
                    <span>
                      Cookie｜{source.cookieConfigured ? '已配置' : '未配置'}
                      {' · '}
                      账号密码｜
                      {source.credentialsConfigured ? '已加密配置' : '未配置'}
                    </span>
                    {source.lastSummary ? (
                      <>
                        <span>记录数｜{source.lastSummary.recordCount}</span>
                        <span>
                          已识别维度｜
                          {source.lastSummary.detectedDimensions
                            .map((code) => OTA_DIMENSION_LABELS[code] ?? code)
                            .join('、')
                            || '尚未识别'}
                        </span>
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
                    勾选后持续监测实体可售量；等于0时生成售罄告警，
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
                    ? '｜已进入简报告警候选，将随下一小时简报处理。'
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
