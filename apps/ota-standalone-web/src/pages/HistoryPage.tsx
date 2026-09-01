import { useCallback, useEffect, useState } from 'react'
import {
  loadBriefs,
  loadIncidents,
  loadOutboxPreview,
  loadWeComConfig,
  saveWeComConfig,
  sendWeComTestSuite,
  type BriefView,
  type HotelContext,
  type IncidentView,
  type OutboxPreview,
  type WeComConfigView,
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
      setError(businessErrorMessage(cause, '读取历史失败'))
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

      <WeComRepairBotConfigPanel canConfigure={canConfigure} />

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
