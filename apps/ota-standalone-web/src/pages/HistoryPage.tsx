import { useCallback, useEffect, useState } from 'react'
import {
  loadBriefs,
  loadIncidents,
  loadOutboxPreview,
  loadWeComConfig,
  saveWeComConfig,
  sendWeComTestDelivery,
  type BriefView,
  type HotelContext,
  type IncidentView,
  type OutboxPreview,
  type WeComConfigView,
} from '../api/business'
import { StatePanel } from '../components/StatePanel'

interface Props {
  context: HotelContext | null
  canConfigure: boolean
}

export function HistoryPage({ context, canConfigure }: Props) {
  const [briefs, setBriefs] = useState<BriefView[]>([])
  const [incidents, setIncidents] = useState<IncidentView[]>([])
  const [outbox, setOutbox] = useState<OutboxPreview[]>([])
  const [weComConfig, setWeComConfig] =
    useState<WeComConfigView | null>(null)
  const [weComEnabled, setWeComEnabled] = useState(false)
  const [webhookDraft, setWebhookDraft] = useState('')
  const [clearWebhook, setClearWebhook] = useState(false)
  const [loading, setLoading] = useState(false)
  const [savingWeCom, setSavingWeCom] = useState(false)
  const [sendingTest, setSendingTest] = useState(false)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')

  const refresh = useCallback(async () => {
    if (!context) return
    setLoading(true)
    setError('')
    try {
      const [briefRows, incidentRows, outboxRows, config] = await Promise.all([
        loadBriefs(context),
        loadIncidents(context),
        loadOutboxPreview(context),
        loadWeComConfig(context),
      ])
      setBriefs(briefRows)
      setIncidents(incidentRows)
      setOutbox(outboxRows)
      setWeComConfig(config)
      setWeComEnabled(config.enabled)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '读取历史失败')
    } finally {
      setLoading(false)
    }
  }, [context])

  useEffect(() => {
    void refresh()
  }, [refresh])

  async function saveAutomation() {
    if (!context) return
    setSavingWeCom(true)
    setError('')
    setNotice('')
    try {
      const webhookUpdate = webhookDraft.trim()
        ? { action: 'REPLACE' as const, value: webhookDraft.trim() }
        : clearWebhook
          ? { action: 'CLEAR' as const }
          : { action: 'KEEP' as const }
      const saved = await saveWeComConfig(
        context,
        weComEnabled,
        webhookUpdate,
      )
      setWeComConfig(saved)
      setWeComEnabled(saved.enabled)
      setWebhookDraft('')
      setClearWebhook(false)
      setNotice(
        saved.enabled
          ? '企微UAT自动推送已启用：整点采集，06分发送并@所有人。'
          : '企微自动推送当前关闭；自动采集不受影响。',
      )
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '保存企微配置失败')
    } finally {
      setSavingWeCom(false)
    }
  }

  async function sendTest() {
    if (!context) return
    setSendingTest(true)
    setError('')
    setNotice('')
    try {
      const delivery = await sendWeComTestDelivery(context)
      setNotice(
        delivery.deliveryStatus === 'DELIVERED'
          ? '企微单条完整测试简报已送达，并已写入发送记录。'
          : `企微测试结果：${delivery.deliveryStatus}（${delivery.reasonCode}）`,
      )
      await refresh()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '企微测试发送失败')
    } finally {
      setSendingTest(false)
    }
  }

  return (
    <section className="page-card">
      <div className="page-heading">
        <div>
          <p className="eyebrow">04 · EVIDENCE</p>
          <h2>简报与告警历史</h2>
          <p>简报、P1、任务和发送记录对应每次真实融合快照；企微Webhook只在本机加密保存。</p>
        </div>
        <button className="secondary" disabled={!context || loading} type="button" onClick={refresh}>
          刷新证据
        </button>
      </div>

      {!context ? (
        <div className="state-panel">请先在顶部载入租户和门店。</div>
      ) : (
        <StatePanel loading={loading} error={error}>
          <section className="wecom-automation-card">
            <div className="page-heading">
              <div>
                <p className="eyebrow">WECOM UAT AUTOMATION</p>
                <h3>企业微信群机器人自动推送</h3>
                <p>
                  每小时00–05分完成采集，06分推送；测试阶段固定
                  @所有人，并在正文标注“UAT测试｜非经营指令”。
                  每份简报压缩为1条高密度消息，在企微安全长度内保留核心经营数据。
                  启用后会按时间顺序补发已保存但尚未发送的整点简报。
                  建议先保持关闭、保存Webhook并发送一次测试，确认群无误后再启用。
                </p>
              </div>
              <b className={weComConfig?.enabled ? 'source-complete' : 'source-partial'}>
                {weComConfig?.enabled ? '自动推送已启用' : '自动推送未启用'}
              </b>
            </div>

            <div className="wecom-config-grid">
              <label className="inline-toggle">
                <input
                  checked={weComEnabled}
                  disabled={!canConfigure || savingWeCom}
                  type="checkbox"
                  onChange={(event) => setWeComEnabled(event.target.checked)}
                />
                启用企微UAT自动推送
              </label>
              <label className="wide-field">
                企业微信群机器人Webhook
                <input
                  autoComplete="off"
                  disabled={!canConfigure || savingWeCom || clearWebhook}
                  placeholder={
                    weComConfig?.webhookConfigured
                      ? '已加密保存；留空表示不更换'
                      : '请粘贴完整官方Webhook地址'
                  }
                  type="password"
                  value={webhookDraft}
                  onChange={(event) => setWebhookDraft(event.target.value)}
                />
                <small>
                  仅允许 https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=…
                  ，保存后不回显。
                </small>
              </label>
              <label className="inline-toggle wide-field">
                <input
                  checked={clearWebhook}
                  disabled={!canConfigure || !weComConfig?.webhookConfigured}
                  type="checkbox"
                  onChange={(event) => {
                    setClearWebhook(event.target.checked)
                    if (event.target.checked) {
                      setWebhookDraft('')
                      setWeComEnabled(false)
                    }
                  }}
                />
                清除已保存的Webhook并关闭推送
              </label>
            </div>

            <div className="wecom-status-row">
              <span>
                Webhook｜{weComConfig?.webhookConfigured ? '已配置' : '未配置'}
              </span>
              <span>发送时间｜每小时06分</span>
              <span>
                指纹｜
                {weComConfig?.endpointSha256
                  ? `${weComConfig.endpointSha256.slice(0, 12)}…`
                  : '无'}
              </span>
              <span>
                最近结果｜
                {weComConfig?.lastDelivery?.deliveryStatus ?? '尚未发送'}
              </span>
            </div>

            <div className="heading-actions">
              <button
                className="secondary"
                disabled={!canConfigure || savingWeCom}
                type="button"
                onClick={saveAutomation}
              >
                {savingWeCom ? '保存中…' : '保存企微配置'}
              </button>
              <button
                disabled={
                  !canConfigure
                  || sendingTest
                  || !weComConfig?.webhookConfigured
                }
                type="button"
                onClick={sendTest}
              >
                {sendingTest ? '正在发送单条简报…' : '发送单条完整UAT测试简报'}
              </button>
            </div>
          </section>

          {notice ? <div className="success" role="status">{notice}</div> : null}

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
            <h3>企业微信发送记录</h3>
            <p>每个小时简报使用唯一消息键；结果不明确时不自动重试，避免群内重复消息。</p>
            {outbox.map((message) => (
              <article className="outbox-card" key={message.messageKey}>
                <header>
                  <strong>{message.messageType}</strong>
                  <b className={
                    message.deliveryStatus === 'DELIVERED'
                      ? 'source-complete'
                      : 'unsafe'
                  }>
                    {message.deliveryStatus}
                  </b>
                </header>
                <code>{message.messageKey}</code>
                <pre>{message.bodyPreview}</pre>
                <small>
                  {message.createdAt}
                  {message.messageType === 'WECOM_CHANNEL_TEST'
                    ? '｜单条高密度完整模板'
                    : ''}
                </small>
              </article>
            ))}
            {outbox.length === 0 ? <div className="state-panel">尚无待投递正文。</div> : null}
          </section>
        </StatePanel>
      )}
    </section>
  )
}
