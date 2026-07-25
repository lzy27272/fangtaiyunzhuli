import { useEffect, useState } from 'react'
import {
  loadConnectorContractAdmissions,
  type ConnectorContractAdmissionView,
  type HotelContext,
} from '../api/business'

interface Props {
  context: HotelContext
}

export function ConnectorAdmissionReadinessPanel({ context }: Props) {
  const [items, setItems] = useState<ConnectorContractAdmissionView[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError('')
    loadConnectorContractAdmissions(context)
      .then((result) => {
        if (!cancelled) setItems(result)
      })
      .catch((cause) => {
        if (!cancelled) {
          setError(cause instanceof Error
            ? cause.message
            : '读取接入准入状态失败')
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [context])

  return (
    <section
      className="real-prep-panel"
      aria-labelledby="connector-admission-readiness-title"
    >
      <div className="real-prep-heading">
        <div>
          <p className="eyebrow">SPRINT 2C · ADMISSION READINESS</p>
          <h3 id="connector-admission-readiness-title">连接器准入就绪度（只读）</h3>
          <p>
            当前仅展示服务端可信候选是否可用。此页面不能测试连接、不能批准或撤销，
            也不会激活连接器、运行采集或发送企业微信消息。
          </p>
        </div>
        <span className="mode-chip">RUNTIME BLOCKED</span>
      </div>

      <div className="safety-lock">
        <strong>可信候选尚未建立</strong>
        <span>
          配置草稿不能自行声明能力或数据结构。只有后续由服务端受信任构建产物生成的
          候选，才可能进入独立审批阶段。
        </span>
      </div>

      {loading
        ? <div className="state-panel">正在读取准入就绪度…</div>
        : null}
      {error
        ? <div className="error-state state-panel" role="alert">{error}</div>
        : null}
      {!loading && !error && items.length === 0
        ? <div className="state-panel">当前门店尚无可展示的真实接入配置草稿。</div>
        : null}

      {!loading && !error && items.length > 0 ? (
        <div className="real-prep-grid">
          {items.map((item) => (
            <article className="real-prep-card" key={item.connectorVersionId}>
              <header>
                <div>
                  <strong>{item.sourceCode} · {item.templateCode}</strong>
                  <small>版本 {item.adapterVersion}</small>
                </div>
                <b>{item.admissionState}</b>
              </header>
              <div className="safety-lock">
                <strong>候选不可用 · 准入未开放</strong>
                <span>
                  candidateAvailable=false · approvalAvailable=false ·
                  revocationAvailable=false · runtimeBlocked=true
                </span>
              </div>
              <ul className="prep-blockers">
                {item.blockers.map((blocker) => (
                  <li key={blocker}>{blocker}</li>
                ))}
              </ul>
            </article>
          ))}
        </div>
      ) : null}
    </section>
  )
}
