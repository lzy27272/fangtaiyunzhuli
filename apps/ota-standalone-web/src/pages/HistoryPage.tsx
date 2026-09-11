import { useCallback, useEffect, useRef, useState } from 'react'
import {
  loadBriefs,
  loadIncidents,
  loadOutboxPreview,
  loadWeComConfig,
  replayLatestWeComBrief,
  retryHotSellingSoldOutAlert,
  saveWeComConfig,
  sendWeComTestSuite,
  type BriefView,
  type BroadcastIntervalHours,
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
  weComDeliveryDiagnostic,
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

const HOUR_OPTIONS = Array.from({ length: 24 }, (_, hour) => ({
  label: `${String(hour).padStart(2, '0')}:00`,
  value: hour,
}))

const BROADCAST_INTERVAL_OPTIONS: Array<{
  label: string
  value: BroadcastIntervalHours
}> = [
  { label: '每小时播报', value: 1 },
  { label: '每2小时播报', value: 2 },
  { label: '每3小时播报', value: 3 },
  { label: '每4小时播报', value: 4 },
  { label: '暂停播报', value: 0 },
]

const broadcastIntervalLabel = (value: BroadcastIntervalHours) =>
  BROADCAST_INTERVAL_OPTIONS.find((option) => option.value === value)?.label
  ?? '暂停播报'

const configuredBroadcastInterval = (
  config: WeComConfigView,
): BroadcastIntervalHours =>
  config.broadcastIntervalHours ?? (config.enabled ? 1 : 0)

const createManualReplayOperationKey = (): string => {
  const randomPart = globalThis.crypto?.randomUUID?.().toUpperCase()
    ?? `${Date.now()}_${Math.random().toString(16).slice(2)}`.toUpperCase()
  return `MANUAL_REPLAY_${randomPart}`
}

const createHotSellingRetryOperationKey = (deliveryId: string): string =>
  `HOT_SELLING_RETRY_${deliveryId.replaceAll('-', '').toUpperCase()}`

export function HistoryPage({ context, canConfigure, onStatusChanged }: Props) {
  const [briefs, setBriefs] = useState<BriefView[]>([])
  const [incidents, setIncidents] = useState<IncidentView[]>([])
  const [outbox, setOutbox] = useState<OutboxPreview[]>([])
  const [weComConfig, setWeComConfig] =
    useState<WeComConfigView | null>(null)
  const [groupRepairLinkEnabled, setGroupRepairLinkEnabled] = useState(false)
  const [broadcastStartHour, setBroadcastStartHour] = useState(9)
  const [broadcastQuietHour, setBroadcastQuietHour] = useState(2)
  const [broadcastIntervalHours, setBroadcastIntervalHours] =
    useState<BroadcastIntervalHours>(0)
  const [webhookDraft, setWebhookDraft] = useState('')
  const [clearWebhook, setClearWebhook] = useState(false)
  const [loading, setLoading] = useState(false)
  const [savingWeCom, setSavingWeCom] = useState(false)
  const [sendingTest, setSendingTest] = useState(false)
  const [replaying, setReplaying] = useState(false)
  const [retryingDeliveryId, setRetryingDeliveryId] = useState<string | null>(
    null,
  )
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
      setGroupRepairLinkEnabled(config.groupRepairLinkEnabled ?? false)
      setBroadcastStartHour(config.broadcastStartHour ?? 9)
      setBroadcastQuietHour(config.broadcastQuietHour ?? 2)
      setBroadcastIntervalHours(configuredBroadcastInterval(config))
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
    setRetryingDeliveryId(null)
    setReplayResult(null)
    setNotice('')
    return () => {
      replayAttemptRef.current += 1
    }
  }, [hotelId, tenantId])

  async function saveAutomation() {
    if (!context) return
    if (broadcastStartHour === broadcastQuietHour) {
      setNotice('')
      setError('每日播报开始时间与静默时间不能相同。')
      return
    }
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
        {
          groupRepairLinkEnabled,
          broadcastStartHour,
          broadcastQuietHour,
          broadcastIntervalHours,
          webhookUpdate,
        },
      )
      setWeComConfig(saved)
      const savedInterval = configuredBroadcastInterval(saved)
      const savedStartHour = saved.broadcastStartHour ?? 9
      const savedQuietHour = saved.broadcastQuietHour ?? 2
      const savedRepairLinkEnabled = saved.groupRepairLinkEnabled ?? false
      setGroupRepairLinkEnabled(savedRepairLinkEnabled)
      setBroadcastStartHour(savedStartHour)
      setBroadcastQuietHour(savedQuietHour)
      setBroadcastIntervalHours(savedInterval)
      setWebhookDraft('')
      setClearWebhook(false)
      setNotice(
        savedInterval > 0
          ? `播报设置已保存：每日 ${String(savedStartHour).padStart(2, '0')}:00 开始、${String(savedQuietHour).padStart(2, '0')}:00 静默，${broadcastIntervalLabel(savedInterval)}；群内修复链接${savedRepairLinkEnabled ? '已开启' : '已停止'}。`
          : `门店播报已暂停；群内修复链接${savedRepairLinkEnabled ? '仍保持开启' : '已停止'}。PMS 数据仍每小时采集一次。`,
      )
    } catch (cause) {
      setError(businessErrorMessage(cause, '保存企微配置失败'))
    } finally {
      setSavingWeCom(false)
    }
  }

  async function sendTest() {
    if (!context || !weComConfig?.endpointSha256) return
    if (!window.confirm(
      '将向当前门店企微群发送带“测试消息”标识的非全员提醒模板。'
      + '售罄预警等 @所有人 模板不会从此入口发送。是否继续？',
    )) return
    setSendingTest(true)
    setError('')
    setNotice('')
    try {
      const result = await sendWeComTestSuite(
        context,
        weComConfig.endpointSha256,
      )
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
        + `${result.collectionRun.sourceCount} 个报表；安全测试模板送达 `
        + `${deliveredCount}/${result.deliveries.length}`
        + `${skipped ? `；无适用数据跳过：${skipped}` : ''}`
        + `${failed ? `；生成或发送失败：${failed}` : ''}`
        + `${rejected ? `；未送达：${rejected}` : ''}`
        + '；售罄预警等 @所有人 告警模板未从测试入口发送。',
      )
      await refresh()
    } catch (cause) {
      setError(businessErrorMessage(cause, '企微测试发送失败'))
    } finally {
      setSendingTest(false)
    }
  }

  async function retryHotSellingAlert(message: OutboxPreview) {
    if (
      !context
      || !canConfigure
      || !message.retryEligible
      || retryingDeliveryId
      || !weComConfig?.enabled
      || !weComConfig.webhookConfigured
    ) return
    const confirmed = window.confirm(
      '系统将重新采集当前门店库存；只有热销房型仍可靠售罄时，才会向企业微信群发送新的预警并@所有人。是否继续？',
    )
    if (!confirmed) return
    setRetryingDeliveryId(message.eventId)
    setError('')
    setNotice('')
    try {
      const result = await retryHotSellingSoldOutAlert(
        context,
        message.eventId,
        createHotSellingRetryOperationKey(message.eventId),
      )
      if (result.overallStatus === 'SKIPPED') {
        setNotice(
          result.skippedReasonCode === 'HOT_SELLING_SOLD_OUT_NONE'
            ? '已重新采集：当前没有可靠售罄的热销房型，本次未发送预警。'
            : `${businessCodeLabel(result.skippedReasonCode, '当前预警无需再次发送')}，本次未重复发送。`,
        )
      } else if (result.delivery?.deliveryStatus === 'DELIVERED') {
        setNotice('已重新采集并发送热销房型售罄预警，企业微信确认接收。')
      } else {
        setError(
          result.delivery
            ? weComDeliveryDiagnostic(result.delivery)
            : '预警重试未完成，请刷新后查看发送记录。',
        )
      }
      await refresh()
      onStatusChanged?.()
    } catch (cause) {
      setError(businessErrorMessage(cause, '热销房型预警重试失败'))
      await refresh()
    } finally {
      setRetryingDeliveryId(null)
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
  const savedBroadcastInterval = weComConfig
    ? configuredBroadcastInterval(weComConfig)
    : 0
  const savedBroadcastStartHour = weComConfig?.broadcastStartHour ?? 9
  const savedBroadcastQuietHour = weComConfig?.broadcastQuietHour ?? 2
  const legacyBroadcastSchedule = Boolean(weComConfig)
    && (weComConfig?.broadcastScheduleMode ?? 'LEGACY_DYNAMIC')
      === 'LEGACY_DYNAMIC'

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
      + '补发正式播报到企业微信群。请确认群内尚未收到同一播报，是否继续？',
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
                  每家门店可独立设置每日开始、静默时间和播报频率；选择暂停播报后仅停止群消息，
                  PMS 数据仍按每小时一次采集。群内修复链接使用独立开关，关闭后不影响已绑定管理员私聊接手。
                  今日经营、远期房态和热销房型提醒仍按既定模板顺序发送；热销房型售罄预警固定 @所有人，例行简报不触发全员提醒。
                </p>
              </div>
              <b className={savedBroadcastInterval > 0 ? 'source-complete' : 'source-partial'}>
                {savedBroadcastInterval > 0 ? '自动推送已启用' : '自动推送已暂停'}
              </b>
            </div>

            {legacyBroadcastSchedule ? (
              <div className="wecom-schedule-note" role="status">
                当前沿用原播报时段，保存后按本页设置执行。
              </div>
            ) : null}

            <div className="wecom-config-grid">
              <label>
                播报频率
                <select
                  disabled={!canConfigure || savingWeCom}
                  value={broadcastIntervalHours}
                  onChange={(event) => setBroadcastIntervalHours(
                    Number(event.target.value) as BroadcastIntervalHours,
                  )}
                >
                  {BROADCAST_INTERVAL_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
                <small>暂停播报不影响 PMS 每小时采集。</small>
              </label>
              <label>
                每日播报开始时间（北京时间）
                <select
                  disabled={!canConfigure || savingWeCom}
                  value={broadcastStartHour}
                  onChange={(event) => setBroadcastStartHour(
                    Number(event.target.value),
                  )}
                >
                  {HOUR_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                每日静默时间（北京时间，暂停）
                <select
                  disabled={!canConfigure || savingWeCom}
                  value={broadcastQuietHour}
                  onChange={(event) => setBroadcastQuietHour(
                    Number(event.target.value),
                  )}
                >
                  {HOUR_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
                <small>静默时间早于开始时间时，表示次日进入静默。</small>
              </label>
              <label className="wecom-toggle-field">
                <span className="inline-toggle">
                  <input
                    checked={groupRepairLinkEnabled}
                    disabled={!canConfigure || savingWeCom || clearWebhook}
                    type="checkbox"
                    onChange={(event) => setGroupRepairLinkEnabled(
                      event.target.checked,
                    )}
                  />
                  群内推送修复链接
                </span>
                <small>关闭后只停止门店群内修复地址，管理员私聊和正常播报不受影响。</small>
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
                      setBroadcastIntervalHours(0)
                      setGroupRepairLinkEnabled(false)
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
              <span>
                播报时段｜{String(savedBroadcastStartHour).padStart(2, '0')}:00 开始 · {String(savedBroadcastQuietHour).padStart(2, '0')}:00 静默
              </span>
              <span>播报频率｜{broadcastIntervalLabel(savedBroadcastInterval)}</span>
              <span>
                修复链接｜{weComConfig?.groupRepairLinkEnabled ? '群内已开启' : '群内已停止'}
              </span>
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
                  ? '正在采集并发送安全测试模板…'
                  : '采集并发送安全测试模板'}
              </button>
            </div>
            <p className="form-note">
              测试消息带有醒目标识且不提醒全员；售罄预警、经营综合简报等
              @所有人 模板不会由此按钮发送。
            </p>
          </section>

          {canConfigure ? (
            <section className="wecom-automation-card">
              <div className="page-heading">
                <div>
                  <p className="eyebrow">正式播报补发</p>
                  <h3>补发最新正式播报</h3>
                  <p>
                    手工采集仅更新数据，不自动群发。此操作使用最新完整数据补发正式播报，
                    提交前会再次确认，避免产生重复播报。
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
            <p>
              系统会自动避免重复发送；结果待确认或已有部分送达时不会重试。明确失败可由管理员重新采集当前库存后重试一次。
            </p>
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
                    ? '｜安全模板测试'
                    : ''}
                  {message.partCount > 1
                    ? `｜分段送达 ${message.deliveredPartCount}/${message.partCount}`
                    : ''}
                </small>
                {message.deliveryStatus !== 'DELIVERED' ? (
                  <div className="outbox-diagnostic" role="status">
                    <b>{businessCodeLabel(message.reasonCode, '原因待确认')}</b>
                    <span>{weComDeliveryDiagnostic(message)}</span>
                    {message.retryEligible && canConfigure ? (
                      <button
                        className="secondary"
                        disabled={
                          retryingDeliveryId !== null
                          || !weComConfig?.enabled
                          || !weComConfig.webhookConfigured
                        }
                        type="button"
                        onClick={() => void retryHotSellingAlert(message)}
                      >
                        {retryingDeliveryId === message.eventId
                          ? '正在重新采集并重试…'
                          : '重新采集并重试此预警'}
                      </button>
                    ) : null}
                  </div>
                ) : null}
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
