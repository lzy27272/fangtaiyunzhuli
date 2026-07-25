import { useCallback, useEffect, useRef, useState } from 'react'
import {
  loadHotSellingRoomTypes,
  loadMonitor,
  saveHotSellingRoomTypes,
  triggerLiveCollection,
  type HotelContext,
  type LiveCollectionRunView,
  type MonitorView,
} from '../api/business'
import { StatePanel } from '../components/StatePanel'

interface Props {
  context: HotelContext | null
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

export function MonitorPage({ context }: Props) {
  const [monitor, setMonitor] = useState<MonitorView | null>(null)
  const [run, setRun] = useState<LiveCollectionRunView | null>(null)
  const [hotRoomTypeCodes, setHotRoomTypeCodes] = useState<string[]>([])
  const [savedHotRoomTypeCodes, setSavedHotRoomTypeCodes] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const [running, setRunning] = useState(false)
  const [savingHotRooms, setSavingHotRooms] = useState(false)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const lastAutoCollectionContext = useRef<string | null>(null)

  const refresh = useCallback(async () => {
    if (!context) return
    setLoading(true)
    setError('')
    try {
      const [monitorView, hotRoomConfig] = await Promise.all([
        loadMonitor(context),
        loadHotSellingRoomTypes(context),
      ])
      setMonitor(monitorView)
      setHotRoomTypeCodes(hotRoomConfig.roomTypeCodes)
      setSavedHotRoomTypeCodes(hotRoomConfig.roomTypeCodes)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '读取监控失败')
    } finally {
      setLoading(false)
    }
  }, [context])

  const collectNow = useCallback(async (origin: 'automatic' | 'manual' = 'manual') => {
    if (!context) return
    setRunning(true)
    setError('')
    setNotice('')
    try {
      const started = await triggerLiveCollection(context)
      setRun(started)
      setMonitor(started.monitor)
      setNotice(
        origin === 'automatic'
          ? `门店加载后已自动采集 ${started.successfulSourceCount}/${started.sourceCount} 个已配置报表。`
          : `已重新采集 ${started.successfulSourceCount}/${started.sourceCount} 个已配置报表。`,
      )
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '真实采集失败')
    } finally {
      setRunning(false)
    }
  }, [context])

  useEffect(() => {
    if (!context) {
      lastAutoCollectionContext.current = null
      setHotRoomTypeCodes([])
      setSavedHotRoomTypeCodes([])
      return
    }
    const contextKey = `${context.tenantId}:${context.hotelId}`
    if (lastAutoCollectionContext.current === contextKey) return
    lastAutoCollectionContext.current = contextKey
    let cancelled = false
    void (async () => {
      await refresh()
      if (!cancelled) await collectNow('automatic')
    })()
    return () => {
      cancelled = true
    }
  }, [collectNow, context, refresh])

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

      {run ? (
        <div className="run-strip">
          <strong>真实采集 {run.status}</strong>
          <span>{run.runId}</span>
          <span>来源 {run.successfulSourceCount}/{run.sourceCount}</span>
          <span>营业日候选 {run.businessDate}</span>
          <b>本次仅采集；企微由06分调度处理</b>
        </div>
      ) : null}

      {notice ? <div className="success" role="status">{notice}</div> : null}

      {!context ? (
        <div className="state-panel">请先在顶部载入租户和门店。</div>
      ) : (
        <StatePanel loading={loading} error={error} empty={!monitor} emptyText="门店加载后会自动采集所有已配置报表。">
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

              <h3>小时快照差分</h3>
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
                {monitor.sources.map((source) => (
                  <article key={source.sourceCode}>
                    <strong>{source.sourceCode}</strong>
                    <span className={`source-${source.completeness.toLowerCase()}`}>{source.completeness}</span>
                    <small>
                      {source.sourceObservedAt ?? '尚未观察'}
                      {source.errorCode ? `｜${source.errorCode}` : ''}
                    </small>
                  </article>
                ))}
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
