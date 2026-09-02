import { useCallback, useEffect, useRef, useState } from 'react'
import {
  loadBriefs,
  loadIncidents,
  loadOutboxPreview,
  loadWeComConfig,
  replayLatestWeComBrief,
  saveWeComConfig,
  sendWeComTestSuite,
  type BriefView,
  type HotelContext,
  type IncidentView,
  type OutboxPreview,
  type WeComConfigView,
  type WeComManualReplayView,
} from '../api/business'
import { StatePanel } from '../components/StatePanel'
import {
  businessCodeLabel,
  businessErrorMessage,
  formatBusinessTime,
  safeBusinessText,
} from '../ui/businessDisplay'
import { WeComRepairBotConfigPanel } from './WeComRepairBotConfigPanel'

interface Props {
  context: HotelContext | null
  canConfigure: boolean
  onStatusChanged?: () => void
}

const TEMPLATE_LABELS: Record<string, string> = {
  TODAY_REVENUE: '当日经营简报',
  TODAY_REVENUE_TEST: '当日经营测试',
  HOURLY_REVENUE_BRIEF: '当日经营简报',
  WECOM_CHANNEL_TEST: '企微通道测试',
  FUTURE_14D: '当日+未来14天房态',
  FUTURE_14D_TEST: '当日+未来14天房态测试',
  P1_FUTURE_DEMAND: 'P1远期需求',
  P1_FUTURE_DEMAND_TEST: 'P1远期需求测试',
  DAILY_MORNING_REPAIR_FAILED: '每日早间自动修复失败',
  HOT_SELLING_SOLD_OUT: '热销房型售罄提醒',
  HOT_SELLING_SOLD_OUT_V1: '热销房型售罄提醒',
}

const templateLabel = (code: string) =>
  TEMPLATE_LABELS[code] ?? businessCodeLabel(code, '其他业务消息')

const createManualReplayOperationKey = (): string => {
  const randomPart = globalThis.crypto?.randomUUID?.().toUpperCase()
    ?? `${Date.now()}_${Math.random().toString(16).slice(2)}`.toUpperCase()
  return `MANUAL_REPLAY_${randomPart}`
}

export function HistoryPage({ context, canConfigure, onStatusChanged }: Props) {
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
  const [replaying, setReplaying] = useState(false)
  const [replayResult, setReplayResult] =
    useState<WeComManualReplayView | null>(null)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const replayOperationRef = useRef<{
    collectionRunId: string
    operationKey: string
  } | null>(null)
  const replayAttemptRef = useRef(0)
  const refreshSequenceRef = useRef(0)
  const tenantId = context?.tenantId
  const hotelId = context?.hotelId

  const refresh = useCallback(async () => {
    const sequence = ++refreshSequenceRef.current
    if (!tenantId || !hotelId) return
    const activeContext = { tenantId, hotelId }
    setLoading(true)
    setError('')
    try {
      const [briefRows, incidentRows, outboxRows, config] = await Promise.all([
        loadBriefs(activeContext),
        loadIncidents(activeContext),
        loadOutboxPreview(activeContext),
        loadWeComConfig(activeContext),
      ])
      if (sequence !== refreshSequenceRef.current) return
      setBriefs(briefRows)
      setIncidents(incidentRows)
      setOutbox(outboxRows)
      setWeComConfig(config)
      setWeComEnabled(config.enabled)
    } catch (cause) {
      if (sequence !== refreshSequenceRef.current) return
      setError(businessErrorMessage(cause, '读取历史失败'))
    } finally {
      if (sequence === refreshSequenceRef.current) setLoading(false)
    }
  }, [hotelId, tenantId])

  useEffect(() => {
    void refresh()
    return () => {
      refreshSequenceRef.current += 1
    }
  }, [refresh])

  useEffect(() => {
    replayAttemptRef.current += 1
    replayOperationRef.current = null
    setReplaying(false)
    setReplayResult(null)
    setNotice('')
    return () => {
      replayAttemptRef.current += 1
    }
  }, [hotelId, tenantId])

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
          ? '企微自动推送已启用：系统按旺季/节假日与普通日期的动态时段采集，采集后按既定顺序发送并@所有人。'
          : '企微自动推送当前关闭；自动采集不受影响。',
      )
    } catch (cause) {
      setError(businessErrorMessage(cause, '保存企微配置失败'))
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
      const result = await sendWeComTestSuite(context)
      const deliveredCount = result.deliveries.filter(
        (delivery) => delivery.deliveryStatus === 'DELIVERED',
      ).length
      const skipped = result.skippedTemplates
        .map((item) =>
          item.reasonCode === 'NO_CURRENT_RISK'
            ? `${templateLabel(item.templateCode)}（当前无真实风险）`
            : `${templateLabel(item.templateCode)}（本次未采集到所需数据）`)
        .join('、')
      const failed = result.failedTemplates
        .map((item) =>
          `${templateLabel(item.templateCode)}（${businessCodeLabel(item.reasonCode, '发送失败')}）`)
        .join('、')
      const rejected = result.deliveries
        .filter((delivery) => delivery.deliveryStatus !== 'DELIVERED')
        .map((delivery) =>
          `${templateLabel(delivery.deliveryType)}（`
          + `${businessCodeLabel(delivery.deliveryStatus)}/${businessCodeLabel(delivery.reasonCode, '原因待确认')}）`)
        .join('、')
      setNotice(
        `已重新采集 ${result.collectionRun.successfulSourceCount}/`
        + `${result.collectionRun.sourceCount} 个报表；企微模板送达 `
        + `${deliveredCount}/${result.deliveries.length}`
        + `${skipped ? `；无适用数据跳过：${skipped}` : ''}`
        + `${failed ? `；生成或发送失败：${failed}` : ''}`
        + `${rejected ? `；未送达：${rejected}` : ''}。`,
      )
      await refresh()
    } catch (cause) {
      setError(businessErrorMessage(cause, '企微测试发送失败'))
    } finally {
      setSendingTest(false)
    }
  }

  const latestBrief = [...briefs]
    .sort((left, right) => left.cutoffAt.localeCompare(right.cutoffAt))
    .at(-1) ?? null
  const latestCompleteBrief = latestBrief
    && latestBrief.completenessCode === 'COMPLETE'
    && !latestBrief.simulationMode
    ? latestBrief
    : null

  async function replayLatestBrief() {
    if (
      !context
      || !canConfigure
      || replaying
      || !latestCompleteBrief
      || !weComConfig?.enabled
      || !weComConfig.webhookConfigured
    ) return
    const confirmed = window.confirm(
      `将按最新完整数据（截止${formatBusinessTime(latestCompleteBrief.cutoffAt)}）`
      + '补发正式播报到企业微信群，并@所有人。请确认群内尚未收到同一播报，是否继续？',
    )
    if (!confirmed) return

    const collectionRunId = latestCompleteBrief.simulationRunId
    if (
      !replayOperationRef.current
      || replayOperationRef.current.collectionRunId !== collectionRunId
    ) {
      replayOperationRef.current = {
        collectionRunId,
        operationKey: createManualReplayOperationKey(),
      }
    }
    const operationKey = replayOperationRef.current.operationKey
    const attempt = ++replayAttemptRef.current
    setReplaying(true)
    setReplayResult(null)
    setError('')
    setNotice('')
    try {
      const result = await replayLatestWeComBrief(
        context,
        collectionRunId,
        operationKey,
      )
      if (attempt !== replayAttemptRef.current) return
      setReplayResult(result)
      const deliveredCount = result.deliveries.filter(
        (delivery) => delivery.deliveryStatus === 'DELIVERED',
      ).length
      const failedCount = new Set([
        ...result.failedTemplates.map((item) => item.templateCode),
        ...result.deliveries
          .filter((delivery) => delivery.deliveryStatus !== 'DELIVERED')
          .map((delivery) => delivery.deliveryType),
      ]).size
      setNotice(
        `${result.replayed ? '已安全返回同一补发操作结果' : '正式播报补发处理完成'}`
        + `：送达 ${deliveredCount}，失败 ${failedCount}，跳过 ${result.skippedTemplates.length}。`,
      )
      await refresh()
      if (attempt !== replayAttemptRef.current) return
      onStatusChanged?.()
    } catch (cause) {
      if (attempt !== replayAttemptRef.current) return
      setError(businessErrorMessage(cause, '补发最新正式播报失败'))
    } finally {
      if (attempt === replayAttemptRef.current) setReplaying(false)
    }
  }

  return (
    <section className="page-card">
      <div className="page-heading">
        <div>
          <p className="eyebrow">播报与记录</p>
          <h2>简报与异常记录</h2>
          <p>集中查看经营简报、异常任务和企业微信发送结果；机器人地址仅加密保存。</p>
        </div>
        <button className="secondary" disabled={!context || loading} type="button" onClick={refresh}>
          刷新记录
        </button>
      </div>

      <WeComRepairBotConfigPanel
        canConfigure={canConfigure}
        context={context}
      />

      {!context ? (
        <div className="state-panel">请先在顶部载入租户和门店。</div>
      ) : (
        <StatePanel loading={loading} error={error}>
          <section className="wecom-automation-card">
            <div className="page-heading">
              <div>
                <p className="eyebrow">企业微信自动播报</p>
                <h3>企业微信群机器人自动推送</h3>
                <p>
                  旺季及节假日08:00起每小时采集，普通日期09/11/13点及14:00后每小时采集；采集后约06分推送今日经营、约08分推送远期房态，末班01:00；
                  热销房型可靠售罄时，在两类简报送达后约09分单独预警。固定
                  @所有人，消息正文仅保留经营数据与建议。
                  每个模板压缩为1条高密度消息，在企微安全长度内保留核心经营数据。
                  启用后会按时间顺序补发已保存但尚未发送的整点简报。
                  全模板测试会先重新采集，再发送当日经营和当日+未来14天房态；
                  仅在D+15至D+90存在真实风险时发送P1远期需求模板。
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
                启用企微自动推送
              </label>
              <label className="wide-field">
                企业微信群机器人地址
                <input
                  autoComplete="off"
                  disabled={!canConfigure || savingWeCom || clearWebhook}
                  placeholder={
                    weComConfig?.webhookConfigured
                      ? '已加密保存；留空表示不更换'
                      : '请粘贴完整的企业微信机器人地址'
                  }
                  type="password"
                  value={webhookDraft}
                  onChange={(event) => setWebhookDraft(event.target.value)}
                />
                <small>
                  只允许企业微信官方机器人地址，保存后不再显示原文。
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
                清除已保存的机器人地址并关闭推送
              </label>
            </div>

            <div className="wecom-status-row">
              <span>
                机器人地址｜{weComConfig?.webhookConfigured ? '已配置' : '未配置'}
              </span>
              <span>发送时间｜今日06分 · 远期08分 · 售罄预警09分</span>
              <span>
                指纹｜
                {weComConfig?.endpointSha256
                  ? `${weComConfig.endpointSha256.slice(0, 12)}…`
                  : '无'}
              </span>
              <span>
                最近结果｜
                {businessCodeLabel(weComConfig?.lastDelivery?.deliveryStatus, '尚未发送')}
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
                {sendingTest
                  ? '正在采集并发送全部模板…'
                  : '采集并发送全部适用模板'}
              </button>
            </div>
          </section>

          {canConfigure ? (
            <section className="wecom-automation-card">
              <div className="page-heading">
                <div>
                  <p className="eyebrow">正式播报补发</p>
                  <h3>补发最新正式播报</h3>
                  <p>
                    手工采集仅更新数据，不自动群发。此操作使用最新完整数据补发正式播报，
                    提交前会再次确认，并@企业微信群所有人。
                  </p>
                </div>
                <button
                  disabled={
                    replaying
                    || !latestCompleteBrief
                    || !weComConfig?.enabled
                    || !weComConfig.webhookConfigured
                  }
                  type="button"
                  onClick={() => void replayLatestBrief()}
                >
                  {replaying ? '正在补发…' : '补发最新正式播报'}
                </button>
              </div>
              <div className="wecom-status-row">
                <span>
                  最新完整数据｜
                  {latestCompleteBrief
                    ? formatBusinessTime(latestCompleteBrief.cutoffAt)
                    : '暂无可补发的完整数据'}
                </span>
                <span>
                  群机器人｜
                  {weComConfig?.webhookConfigured ? '已配置' : '未配置'}
                </span>
                <span>
                  自动推送｜
                  {weComConfig?.enabled ? '已启用' : '未启用'}
                </span>
              </div>
              {replayResult ? (
                <div className="history-columns" role="status">
                  <section>
                    <h3>各模板送达结果</h3>
                    {replayResult.deliveries.map((delivery, index) => (
                      <article
                        className="history-card"
                        key={`${delivery.deliveryType}:${index}`}
                      >
                        <header>
                          <strong>{templateLabel(delivery.deliveryType)}</strong>
                          <b>{businessCodeLabel(delivery.deliveryStatus, '结果待确认')}</b>
                        </header>
                        <p>{businessCodeLabel(delivery.reasonCode, '原因待确认')}</p>
                        <small>
                          分段送达 {delivery.deliveredPartCount}/{delivery.partCount}
                          {delivery.completedAt || delivery.attemptedAt
                            ? `｜${formatBusinessTime(delivery.completedAt ?? delivery.attemptedAt ?? '')}`
                            : ''}
                        </small>
                      </article>
                    ))}
                    {replayResult.deliveries.length === 0
                      ? <div className="state-panel">本次没有产生可发送模板。</div>
                      : null}
                  </section>
                  <section>
                    <h3>失败与跳过</h3>
                    {replayResult.failedTemplates.map((item) => (
                      <article className="history-card" key={`failed:${item.templateCode}`}>
                        <header>
                          <strong>{templateLabel(item.templateCode)}</strong>
                          <b className="unsafe">生成或发送失败</b>
                        </header>
                        <p>{businessCodeLabel(item.reasonCode, '原因待确认')}</p>
                      </article>
                    ))}
                    {replayResult.skippedTemplates.map((item) => (
                      <article className="history-card" key={`skipped:${item.templateCode}`}>
                        <header>
                          <strong>{templateLabel(item.templateCode)}</strong>
                          <b>本次跳过</b>
                        </header>
                        <p>{businessCodeLabel(item.reasonCode, '无适用数据')}</p>
                      </article>
                    ))}
                    {replayResult.failedTemplates.length === 0
                      && replayResult.skippedTemplates.length === 0
                      ? <div className="state-panel">没有失败或跳过的模板。</div>
                      : null}
                  </section>
                </div>
              ) : null}
            </section>
          ) : null}

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
                    <span>{brief.businessDate} · 截止 {formatBusinessTime(brief.cutoffAt)}</span>
                    <b>{businessCodeLabel(brief.deliveryStatus, '尚未发送')}</b>
                  </summary>
                  <pre>{brief.content}</pre>
                  <small>
                    第 {brief.revisionNo} 版 · {businessCodeLabel(brief.completenessCode, '完整度待确认')} ·
                    {brief.simulationMode ? ' 测试数据' : ' 正式数据'}
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
                    <strong>{businessCodeLabel(incident.type, '其他异常')}</strong>
                    <b>{businessCodeLabel(incident.status, '待处理')}</b>
                  </header>
                  <p>{safeBusinessText(incident.sourceCode, '来源未标注')} · {safeBusinessText(incident.directionCode, '无方向')}</p>
                  <small>首次发现：{formatBusinessTime(incident.openedAt)}</small>
                  <small>最近发现：{formatBusinessTime(incident.lastObservedAt)}</small>
                  {incident.taskId ? <details className="technical-details"><summary>查看任务编号</summary><code>{incident.taskId}</code></details> : null}
                </article>
              ))}
              {incidents.length === 0 ? <div className="state-panel">当前没有P1记录。</div> : null}
            </section>
          </div>

          <section className="outbox-section">
            <h3>企业微信发送记录</h3>
            <p>系统会自动避免重复发送；结果待确认时不会自动重试。</p>
            {outbox.map((message) => (
              <article className="outbox-card" key={message.messageKey}>
                <header>
                  <strong>{templateLabel(message.messageType)}</strong>
                  <b className={
                    message.deliveryStatus === 'DELIVERED'
                      ? 'source-complete'
                      : 'unsafe'
                  }>
                    {businessCodeLabel(message.deliveryStatus, '尚未发送')}
                  </b>
                </header>
                <pre>{safeBusinessText(message.bodyPreview, '暂无消息摘要')}</pre>
                <small>
                  {formatBusinessTime(message.createdAt)}
                  {message.messageType.endsWith('_TEST')
                    ? '｜全模板测试'
                    : ''}
                </small>
                <details className="technical-details"><summary>查看消息编号</summary><code>{message.messageKey}</code></details>
              </article>
            ))}
            {outbox.length === 0 ? <div className="state-panel">尚无待投递正文。</div> : null}
          </section>
        </StatePanel>
      )}
    </section>
  )
}
