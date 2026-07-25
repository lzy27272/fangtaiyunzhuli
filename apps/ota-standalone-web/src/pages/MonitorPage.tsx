import { useCallback, useEffect, useState } from 'react'
import {
  loadMonitor,
  triggerSimulationRun,
  type HotelContext,
  type MonitorView,
  type SimulationRunView,
} from '../api/business'
import { StatePanel } from '../components/StatePanel'

interface Props {
  context: HotelContext | null
}

const METRIC_LABELS: Record<string, string> = {
  totalRevenue: '总营业额',
  adr: '平均房价 ADR',
  revPar: '单房收益 RevPAR',
  soldRooms: '今日已售',
  availableRooms: '今日可售',
  targetProgress: '目标完成进度',
  sellProgress: '售卖进度',
}

function displayMetric(value: string | number | null | undefined, unit: string, state: string): string {
  if (state === 'UNAVAILABLE') return '无法判断'
  if (state === 'NOT_CONFIGURED') return '暂未配置标准'
  if (state === 'NOT_APPLICABLE') return '不适用'
  if (value === null || value === undefined) return '无法判断'
  return `${value}${unit === 'PERCENT' ? '%' : unit === 'ROOM' ? '间' : unit === 'CURRENCY' ? '元' : ''}`
}

export function MonitorPage({ context }: Props) {
  const [monitor, setMonitor] = useState<MonitorView | null>(null)
  const [run, setRun] = useState<SimulationRunView | null>(null)
  const [scenario, setScenario] = useState<
    'BASELINE' | 'INVENTORY_MISMATCH' | 'SOURCE_UNAVAILABLE' | 'LATE_BRIEF_REPLAY'
  >('BASELINE')
  const [loading, setLoading] = useState(false)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState('')

  const refresh = useCallback(async () => {
    if (!context) return
    setLoading(true)
    setError('')
    try {
      setMonitor(await loadMonitor(context))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '读取监控失败')
    } finally {
      setLoading(false)
    }
  }, [context])

  useEffect(() => {
    void refresh()
  }, [refresh])

  async function runSimulation() {
    if (!context) return
    setRunning(true)
    setError('')
    try {
      const started = await triggerSimulationRun(context, scenario)
      setRun(started)
      await refresh()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '模拟运行失败')
    } finally {
      setRunning(false)
    }
  }

  return (
    <section className="page-card">
      <div className="page-heading">
        <div>
          <p className="eyebrow">02 · MONITOR</p>
          <h2>多报表融合经营监控</h2>
          <p>数值由已配置的主报表融合计算；辅助来源只做校验。缺失和过期数据保持“无法判断”。</p>
        </div>
        <div className="heading-actions">
          <select
            aria-label="模拟场景"
            disabled={running}
            value={scenario}
            onChange={(event) => setScenario(event.target.value as typeof scenario)}
          >
            <option value="BASELINE">正常基线</option>
            <option value="INVENTORY_MISMATCH">房态不匹配</option>
            <option value="SOURCE_UNAVAILABLE">来源不可用</option>
            <option value="LATE_BRIEF_REPLAY">迟到补记</option>
          </select>
          <button className="secondary" disabled={!context || loading} type="button" onClick={refresh}>
            刷新
          </button>
          <button disabled={!context || running} type="button" onClick={runSimulation}>
            {running ? '运行中…' : '运行整点模拟'}
          </button>
        </div>
      </div>

      {run ? (
        <div className="run-strip">
          <strong>模拟运行 {run.status}</strong>
          <span>{run.runId}</span>
          <span>执行 {run.fixedClockAt}</span>
          <span>截止 {run.scheduledFor}</span>
          <b>企微禁发</b>
        </div>
      ) : null}

      {!context ? (
        <div className="state-panel">请先在顶部载入租户和门店。</div>
      ) : (
        <StatePanel loading={loading} error={error} empty={!monitor} emptyText="该门店尚无模拟快照。">
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
                </div>
                <div>
                  <span>统计截止</span>
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

              <h3>来源新鲜度</h3>
              <div className="source-row">
                {monitor.sources.map((source) => (
                  <article key={source.sourceCode}>
                    <strong>{source.sourceCode}</strong>
                    <span className={`source-${source.completeness.toLowerCase()}`}>{source.completeness}</span>
                    <small>{source.sourceObservedAt ?? '尚未观察'}</small>
                  </article>
                ))}
              </div>

              <h3>实体库存池逐来源对账</h3>
              <div className="inventory-list">
                {monitor.inventory.map((pool) => (
                  <article key={pool.inventoryPoolId}>
                    <header>
                      <strong>{pool.displayName}</strong>
                      <span>主库存报表可售 {pool.primaryAvailableRooms ?? '无法判断'}</span>
                    </header>
                    {Object.entries(pool.otaAvailableRooms).map(([productCode, available]) => (
                      <div key={productCode}>
                        <span>辅助来源 · {productCode}</span>
                        <span>可售 {available}</span>
                        <b className={`inventory-${pool.state.toLowerCase()}`}>{pool.state}</b>
                      </div>
                    ))}
                    <small>多个售卖名称共享实体库存；辅助来源逐项比较，绝不累加。</small>
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
