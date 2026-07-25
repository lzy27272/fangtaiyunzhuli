import { useCallback, useEffect, useState } from 'react'
import {
  loadBriefs,
  loadIncidents,
  loadOutboxPreview,
  type BriefView,
  type HotelContext,
  type IncidentView,
  type OutboxPreview,
} from '../api/business'
import { StatePanel } from '../components/StatePanel'

interface Props {
  context: HotelContext | null
}

export function HistoryPage({ context }: Props) {
  const [briefs, setBriefs] = useState<BriefView[]>([])
  const [incidents, setIncidents] = useState<IncidentView[]>([])
  const [outbox, setOutbox] = useState<OutboxPreview[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const refresh = useCallback(async () => {
    if (!context) return
    setLoading(true)
    setError('')
    try {
      const [briefRows, incidentRows, outboxRows] = await Promise.all([
        loadBriefs(context),
        loadIncidents(context),
        loadOutboxPreview(context),
      ])
      setBriefs(briefRows)
      setIncidents(incidentRows)
      setOutbox(outboxRows)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '读取历史失败')
    } finally {
      setLoading(false)
    }
  }, [context])

  useEffect(() => {
    void refresh()
  }, [refresh])

  return (
    <section className="page-card">
      <div className="page-heading">
        <div>
          <p className="eyebrow">04 · EVIDENCE</p>
          <h2>简报与告警历史</h2>
          <p>简报、P1、任务和Outbox记录各报表版本与融合结果；评审模式只展示正文，不连接企业微信。</p>
        </div>
        <button className="secondary" disabled={!context || loading} type="button" onClick={refresh}>
          刷新证据
        </button>
      </div>

      {!context ? (
        <div className="state-panel">请先在顶部载入租户和门店。</div>
      ) : (
        <StatePanel loading={loading} error={error}>
          <div className="history-columns">
            <section>
              <h3>小时简报</h3>
              {briefs.map((brief) => (
                <details
                  className="history-card"
                  key={`${brief.briefId}:${brief.revisionNo}:${brief.simulationRunId}`}
                >
                  <summary>
                    <span>{brief.businessDate} · {brief.cutoffAt}</span>
                    <b>{brief.deliveryStatus}</b>
                  </summary>
                  <pre>{brief.content}</pre>
                  <small>
                    修订 {brief.revisionNo} · 完整度 {brief.completenessCode} ·
                    {brief.simulationMode ? ' 模拟事实' : ' 非模拟'}
                  </small>
                </details>
              ))}
              {briefs.length === 0 ? <div className="state-panel">尚无小时简报。</div> : null}
            </section>

            <section>
              <h3>P1与任务</h3>
              {incidents.map((incident) => (
                <article className="history-card" key={incident.incidentId}>
                  <header>
                    <strong>{incident.type}</strong>
                    <b>{incident.status}</b>
                  </header>
                  <p>{incident.sourceCode ?? '来源未标注'} · {incident.directionCode ?? '无方向'}</p>
                  <small>首次 {incident.openedAt}</small>
                  <small>最近 {incident.lastObservedAt}</small>
                  {incident.taskId ? <code>任务 {incident.taskId}</code> : null}
                </article>
              ))}
              {incidents.length === 0 ? <div className="state-panel">当前没有P1记录。</div> : null}
            </section>
          </div>

          <section className="outbox-section">
            <h3>企业微信Outbox预览</h3>
            <p>以下正文只保存在独立数据库；`deliveryBlocked=true`必须成立。</p>
            {outbox.map((message) => (
              <article className="outbox-card" key={message.messageKey}>
                <header>
                  <strong>{message.messageType}</strong>
                  <b className={message.deliveryBlocked ? 'blocked' : 'unsafe'}>
                    {message.deliveryBlocked ? 'DELIVERY BLOCKED' : '安全门禁异常'}
                  </b>
                </header>
                <code>{message.messageKey}</code>
                <pre>{message.bodyPreview}</pre>
                <small>{message.createdAt}</small>
              </article>
            ))}
            {outbox.length === 0 ? <div className="state-panel">尚无待投递正文。</div> : null}
          </section>
        </StatePanel>
      )}
    </section>
  )
}
