import { useEffect, useMemo, useState } from 'react'
import {
  loadPmsLoginConfig,
  loadReportSources,
  savePmsLoginConfig,
  saveReportSources,
  triggerLiveCollection,
  type CalculationRole,
  type HotelContext,
  type PmsLoginConfigView,
  type ReportSourceInput,
  type ReportSourceView,
  type ReportType,
} from '../api/business'
import { StatePanel } from '../components/StatePanel'
import { LuopanBrowserConfigPanel } from './LuopanBrowserConfigPanel'
import { OtaSourceConfigPanel } from './OtaSourceConfigPanel'
import {
  reportSourceGuidance,
  type ReportSourceAttention,
} from './reportSourceAttention'
import { DataAccessOverviewPanel } from './DataAccessOverviewPanel'

interface Props {
  context: HotelContext | null
  canConfigure: boolean
  attentionItems: ReportSourceAttention[]
  otaAttentionSourceId: string | null
}

const REPORT_TYPE_LABELS: Record<ReportType, string> = {
  ORDER_DETAIL: '订单明细报表',
  ROOM_REVENUE: '房费收入报表',
  PHYSICAL_INVENTORY: '实体房型库存报表',
  OTA_PRODUCT_INVENTORY: 'OTA售卖产品库存',
  BUSINESS_DAY: '营业日/夜审状态',
  CUSTOM_REPORT: '其他辅助报表',
}

const CALCULATION_ROLE_LABELS: Record<CalculationRole, string> = {
  PRIMARY_CALCULATION: '主计算来源',
  AUXILIARY_CALCULATION: '辅助计算来源',
}

const REQUIRED_COVERAGE: Array<{
  type: ReportType
  label: string
  required: boolean
}> = [
  { type: 'ORDER_DETAIL', label: '订单与取消间夜', required: true },
  { type: 'ROOM_REVENUE', label: '房费收入/ADR', required: true },
  { type: 'PHYSICAL_INVENTORY', label: '实体库存与可售', required: true },
  { type: 'BUSINESS_DAY', label: '营业日/夜审状态', required: true },
  { type: 'OTA_PRODUCT_INVENTORY', label: 'OTA房态辅助对账', required: false },
]

const SENSITIVE_QUERY_KEY = /(?:token|cookie|password|passwd|secret|session|authorization|api[_-]?key|sign(?:ature)?)/i

function validateEndpoint(value: string): string | null {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return '必须填写完整HTTPS地址。'
  }
  if (url.protocol !== 'https:') return '只允许HTTPS接口地址。'
  if (url.username || url.password) return 'URL中不能包含账号或密码。'
  if (url.hash) return 'URL中不能包含片段标识。'
  if ([...url.searchParams.keys()].some((key) => SENSITIVE_QUERY_KEY.test(key))) {
    return 'URL查询参数中不能包含Token、Cookie、密码或签名密钥。'
  }
  return null
}

const createEmptySource = (): ReportSourceView => ({
  sourceId: globalThis.crypto.randomUUID(),
  displayName: '',
  endpointUrl: '',
  reportType: 'CUSTOM_REPORT',
  calculationRole: 'AUXILIARY_CALCULATION',
  pollIntervalMinutes: 30,
  credentialAlias: '',
  requestPayloadJson: '',
  cookieConfigured: false,
  cookieUpdatedAt: null,
  definitionLocked: false,
  definitionTemplateHotelCode: '001/001',
  enabledToggleOnly: false,
  enabled: false,
  validationStatus: 'NOT_TESTED',
  rowVersion: 0,
})

const sourceCardId = (sourceId: string) =>
  `report-source-${sourceId.replace(/[^A-Za-z0-9_-]/g, '-')}`

export function ReportSourceConfigPage({
  context,
  canConfigure,
  attentionItems,
  otaAttentionSourceId,
}: Props) {
  const [sources, setSources] = useState<ReportSourceView[]>([])
  const [cookieDrafts, setCookieDrafts] = useState<Record<string, string>>({})
  const [cookieClears, setCookieClears] = useState<Record<string, boolean>>({})
  const [reasonCode, setReasonCode] = useState('REPORT_SOURCE_CONFIG')
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [pmsLoginConfig, setPmsLoginConfig] =
    useState<PmsLoginConfigView | null>(null)
  const [pmsUsername, setPmsUsername] = useState('')
  const [pmsPassword, setPmsPassword] = useState('')
  const [clearPmsLogin, setClearPmsLogin] = useState(false)
  const [savingPmsLogin, setSavingPmsLogin] = useState(false)
  const [pmsLoginError, setPmsLoginError] = useState('')
  const [pmsLoginNotice, setPmsLoginNotice] = useState('')
  const [overviewVersion, setOverviewVersion] = useState(0)

  useEffect(() => {
    if (!context) {
      setSources([])
      setCookieDrafts({})
      setCookieClears({})
      return
    }
    let cancelled = false
    setLoading(true)
    setError('')
    loadReportSources(context)
      .then((rows) => {
        if (!cancelled) {
          setSources(rows)
          setCookieDrafts({})
          setCookieClears({})
        }
      })
      .catch((cause) => {
        if (!cancelled) {
          setError(cause instanceof Error ? cause.message : '读取报表URL失败')
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [context])

  useEffect(() => {
    setPmsUsername('')
    setPmsPassword('')
    setClearPmsLogin(false)
    setPmsLoginError('')
    setPmsLoginNotice('')
    if (!context) {
      setPmsLoginConfig(null)
      return
    }
    let cancelled = false
    loadPmsLoginConfig(context)
      .then((config) => {
        if (!cancelled) setPmsLoginConfig(config)
      })
      .catch((cause) => {
        if (!cancelled) {
          setPmsLoginError(
            cause instanceof Error ? cause.message : '读取PMS登录配置失败',
          )
        }
      })
    return () => {
      cancelled = true
    }
  }, [context])

  const coverage = useMemo(
    () => REQUIRED_COVERAGE.map((item) => ({
      ...item,
      configured: sources.some((source) =>
        source.enabled && source.reportType === item.type),
    })),
    [sources],
  )
  const definitionsLocked = sources.some((source) => source.definitionLocked)
  const enabledToggleOnly = sources.some((source) => source.enabledToggleOnly)
  const definitionTemplateHotelCode =
    sources[0]?.definitionTemplateHotelCode ?? '001/001'
  const attentionBySourceId = useMemo(
    () => new Map(
      attentionItems.map((attention) => [attention.sourceId, attention]),
    ),
    [attentionItems],
  )
  const attentionRows = useMemo(
    () => attentionItems.map((attention) => {
      const sourceIndex = sources.findIndex(
        (source) => source.sourceId === attention.sourceId,
      )
      return {
        attention,
        guidance: reportSourceGuidance(attention.errorCode),
        source: sourceIndex >= 0 ? sources[sourceIndex] : null,
        sourceIndex,
      }
    }),
    [attentionItems, sources],
  )

  useEffect(() => {
    if (loading || attentionRows.length === 0) return
    const frame = window.requestAnimationFrame(() => {
      const panel = document.getElementById('report-source-attention-panel')
      panel?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      panel?.focus({ preventScroll: true })
    })
    return () => window.cancelAnimationFrame(frame)
  }, [attentionRows.length, context?.hotelId, loading])

  function updateSource(
    sourceId: string,
    patch: Partial<ReportSourceView>,
  ) {
    setSources((current) => current.map((source) =>
      source.sourceId === sourceId
        ? { ...source, ...patch, validationStatus: 'NOT_TESTED' }
        : source))
  }

  function removeSource(sourceId: string) {
    setSources((current) =>
      current.filter((source) => source.sourceId !== sourceId))
    setCookieDrafts((current) => {
      const next = { ...current }
      delete next[sourceId]
      return next
    })
    setCookieClears((current) => {
      const next = { ...current }
      delete next[sourceId]
      return next
    })
  }

  async function save() {
    if (!context || !canConfigure) return
    setError('')
    setNotice('')
    const normalized = sources.map((source) => ({
      ...source,
      displayName: source.displayName.trim(),
      endpointUrl: source.endpointUrl.trim(),
      credentialAlias: source.credentialAlias.trim().toUpperCase(),
      requestPayloadJson: source.requestPayloadJson.trim(),
    }))
    if (
      normalized.some((source) =>
        !source.displayName
        || !source.endpointUrl
        || validateEndpoint(source.endpointUrl))
    ) {
      setError('请修正所有报表名称和接口地址后再保存。')
      return
    }
    if (
      normalized.some((source) => {
        if (!source.requestPayloadJson) return false
        try {
          const value = JSON.parse(source.requestPayloadJson)
          return value === null || typeof value !== 'object' || Array.isArray(value)
        } catch {
          return true
        }
      })
    ) {
      setError('请求载荷必须是有效的JSON对象。')
      return
    }
    if (
      normalized.filter((source) => source.enabled).length > 0
      && !normalized.some((source) =>
        source.enabled
        && source.calculationRole === 'PRIMARY_CALCULATION')
    ) {
      setError('至少保留一个启用的主计算来源。')
      return
    }
    if (!/^[A-Z0-9][A-Z0-9_-]{1,63}$/.test(reasonCode)) {
      setError('变更原因码必须为2至64位大写字母、数字、下划线或连字符。')
      return
    }
    if (
      Object.values(cookieDrafts).some((value) =>
        /[\r\n\u0000]/.test(value)
        || /^\s*cookie\s*:/i.test(value)
        || (value.length > 0 && !value.trim()))
    ) {
      setError('Cookie不能包含请求头前缀、换行符、空字符或仅空格内容。')
      return
    }

    const payload: ReportSourceInput[] = normalized.map((source) => ({
      sourceId: source.sourceId,
      displayName: source.displayName,
      endpointUrl: source.endpointUrl,
      reportType: source.reportType,
      calculationRole: source.calculationRole,
      pollIntervalMinutes: source.pollIntervalMinutes,
      credentialAlias: source.credentialAlias,
      requestPayloadJson: source.requestPayloadJson,
      cookieUpdate: cookieDrafts[source.sourceId]
        ? { action: 'REPLACE', value: cookieDrafts[source.sourceId] }
        : cookieClears[source.sourceId]
          ? { action: 'CLEAR' }
          : { action: 'KEEP' },
      enabled: source.enabled,
      rowVersion: source.rowVersion,
    }))
    setSaving(true)
    try {
      await saveReportSources(context, payload, reasonCode)
      const savedSources = await loadReportSources(context)
      setSources(savedSources)
      setCookieDrafts({})
      setCookieClears({})
      if (enabledToggleOnly) {
        setOverviewVersion((current) => current + 1)
        setNotice(
          '罗盘PMS报表启用状态已保存；未启用的报表无需配置Cookie或POST载荷，也不会参与采集。',
        )
        return
      }
      let collectionNotice = ''
      try {
        const run = await triggerLiveCollection(context)
        collectionNotice =
          ` 已自动采集一次：${run.successfulSourceCount}/${run.sourceCount}`
          + ` 个来源可用，结果为${run.status === 'PARTIAL' ? '部分形成' : '完整'}。`
      } catch (cause) {
        const code = cause instanceof Error ? cause.message : 'COLLECTION_FAILED'
        collectionNotice =
          ` 配置已保存，但自动采集未完成（${code}）；`
          + '可修正配置后再次保存，或到监控页手动采集。'
      }
      setOverviewVersion((current) => current + 1)
      setNotice(
        (definitionsLocked
          ? `当前门店Cookie及POST载荷已保存；其他接口定义继续由${definitionTemplateHotelCode}门店统一同步。`
          : '报表URL及当前门店Cookie状态已保存；接口定义已同步到全部评审门店，Cookie不会被复制或覆盖。')
        + collectionNotice,
      )
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '保存报表URL失败')
    } finally {
      setSaving(false)
    }
  }

  async function savePmsCredentials() {
    if (!context || !canConfigure) return
    setPmsLoginError('')
    setPmsLoginNotice('')
    const username = pmsUsername.trim()
    if (
      !clearPmsLogin
      && (
        !username
        || !pmsPassword
        || /[\r\n\u0000]/.test(username)
        || /[\r\n\u0000]/.test(pmsPassword)
      )
    ) {
      setPmsLoginError('请完整填写账号和密码，且不能包含换行或空字符。')
      return
    }
    setSavingPmsLogin(true)
    try {
      const saved = await savePmsLoginConfig(
        context,
        clearPmsLogin
          ? { action: 'CLEAR' }
          : { action: 'REPLACE', username, password: pmsPassword },
      )
      setPmsLoginConfig(saved)
      setPmsUsername('')
      setPmsPassword('')
      setClearPmsLogin(false)
      setOverviewVersion((current) => current + 1)
      setPmsLoginNotice(
        saved.configured
          ? 'PMS账号密码已加密保存，页面输入已清空且不会回显。'
          : 'PMS账号密码配置已清除。',
      )
    } catch (cause) {
      setPmsLoginError(
        cause instanceof Error ? cause.message : '保存PMS登录配置失败',
      )
    } finally {
      setSavingPmsLogin(false)
    }
  }

  return (
    <section className="page-card">
      <div className="page-heading">
        <div>
          <p className="eyebrow">01 · REPORT SOURCES</p>
          <h2>多报表URL接入</h2>
          <p>
            PMS和OTA均不是必选系统。后台按报表用途组合多个JSON接口，
            主来源参与确定性计算，OTA可作为辅助校验来源。
          </p>
        </div>
        <span className="mode-chip">URL FUSION</span>
      </div>

      <div className="report-pipeline" role="status">
        <strong>报表URL</strong>
        <span>→</span>
        <strong>字段映射</strong>
        <span>→</span>
        <strong>融合计算</strong>
        <span>→</span>
        <strong>两类简报 / 售罄预警 / P1</strong>
        <span>→</span>
        <strong>企微机器人</strong>
      </div>

      <div className="security-note report-source-note">
        每个网址可以独立配置Cookie。Cookie不得写入URL，密码框内容写入后不回显；
        后台按门店与网址隔离加密保存，正式抓取时仅向对应接口注入。
      </div>

      <div className="delivery-policy-grid" aria-label="企业微信推送规则">
        <article>
          <span>整点简报</span>
          <strong>08:00—次日02:00整点</strong>
          <small>每30分钟采集；02:00后暂停，08:00首轮汇总停播时段。</small>
        </article>
        <article>
          <span>热销房型售罄</span>
          <strong>两类简报后1分钟独立推送</strong>
          <small>仅可靠可售量为0或以下时触发；数据缺失不误报，同小时不重复。</small>
        </article>
        <article>
          <span>P1房态风险</span>
          <strong>播报时段内立即推送</strong>
          <small>08:00至次日02:00不等待整点；停播期间不采集、不推送。</small>
        </article>
        <article>
          <span>推送对象</span>
          <strong>同一运营群 · @所有人</strong>
          <small>Webhook仅通过凭据别名绑定，不在页面显示明文。</small>
        </article>
      </div>

      {!context ? (
        <div className="state-panel">请先在顶部选择门店。</div>
      ) : (
        <StatePanel loading={loading} error={error}>
          <DataAccessOverviewPanel
            context={context}
            pmsLoginConfigured={pmsLoginConfig?.configured ?? false}
            refreshVersion={overviewVersion}
            reportSources={sources}
          />

          <OtaSourceConfigPanel
            attentionSourceId={otaAttentionSourceId}
            canConfigure={canConfigure}
            context={context}
            onStatusChanged={() =>
              setOverviewVersion((current) => current + 1)}
          />

          <LuopanBrowserConfigPanel
            canConfigure={canConfigure}
            context={context}
            onStatusChanged={() =>
              setOverviewVersion((current) => current + 1)}
          />

          <article className="report-source-card pms-login-card">
            <header>
              <div>
                <span>PMS LOGIN</span>
                <strong>模拟登录账号配置</strong>
              </div>
              <span className="mode-chip">
                {pmsLoginConfig?.configured ? '已加密配置' : '未配置'}
              </span>
            </header>
            <p>
              账号密码仅按当前门店加密保存，提交后立即从页面清空且不回显。
              当前仅提供配置接口，模拟登录执行保持关闭，不会自动访问PMS或处理验证码。
            </p>
            <div className="report-source-form">
              <label>
                PMS账号
                <input
                  autoComplete="off"
                  disabled={!canConfigure || clearPmsLogin}
                  maxLength={256}
                  placeholder={
                    pmsLoginConfig?.configured
                      ? '已配置；重新填写将替换原账号'
                      : '请输入PMS登录账号'
                  }
                  value={pmsUsername}
                  onChange={(event) => {
                    setPmsUsername(event.target.value)
                    setClearPmsLogin(false)
                  }}
                />
              </label>
              <label>
                PMS密码
                <input
                  autoComplete="new-password"
                  disabled={!canConfigure || clearPmsLogin}
                  maxLength={4096}
                  placeholder={
                    pmsLoginConfig?.configured
                      ? '已配置；重新填写将替换原密码'
                      : '请输入PMS登录密码'
                  }
                  type="password"
                  value={pmsPassword}
                  onChange={(event) => {
                    setPmsPassword(event.target.value)
                    setClearPmsLogin(false)
                  }}
                />
              </label>
            </div>
            {pmsLoginConfig?.configured ? (
              <label className="cookie-clear-option">
                <input
                  checked={clearPmsLogin}
                  disabled={!canConfigure}
                  type="checkbox"
                  onChange={(event) => {
                    setClearPmsLogin(event.target.checked)
                    if (event.target.checked) {
                      setPmsUsername('')
                      setPmsPassword('')
                    }
                  }}
                />
                保存时清除当前门店的PMS账号密码
              </label>
            ) : null}
            <footer>
              <span>
                {pmsLoginConfig?.configured
                  ? `配置时间：${pmsLoginConfig.updatedAt
                    ? new Date(pmsLoginConfig.updatedAt).toLocaleString('zh-CN')
                    : '已配置'}`
                  : '账号密码尚未配置'}
                {' · '}
                模拟登录：未启用
              </span>
              {canConfigure ? (
                <button
                  disabled={
                    savingPmsLogin
                    || (
                      !clearPmsLogin
                      && (!pmsUsername.trim() || !pmsPassword)
                    )
                  }
                  type="button"
                  onClick={savePmsCredentials}
                >
                  {savingPmsLogin
                    ? '保存中…'
                    : clearPmsLogin
                      ? '确认清除'
                      : pmsLoginConfig?.configured
                        ? '替换账号密码'
                        : '保存账号密码'}
                </button>
              ) : null}
            </footer>
            {pmsLoginError ? (
              <p className="field-error" role="alert">{pmsLoginError}</p>
            ) : null}
            {pmsLoginNotice ? (
              <p className="success-note" role="status">{pmsLoginNotice}</p>
            ) : null}
          </article>

          {definitionsLocked ? (
            <div className="security-note report-source-note" role="status">
              报表接口由
              {definitionTemplateHotelCode}
              门店统一配置并自动同步；当前门店可单独填写Cookie和POST请求载荷，
              HTTPS地址及其他接口定义无需重复填写。
            </div>
          ) : (
            <div className="security-note report-source-note" role="status">
              当前门店是报表接口模板。保存接口定义后会自动同步到现有及后续新增的全部评审门店；
              各门店Cookie始终独立，不会被同步或覆盖。
            </div>
          )}

          {attentionRows.length > 0 ? (
            <section
              className="report-source-attention-panel"
              id="report-source-attention-panel"
              role="alert"
              tabIndex={-1}
            >
              <div>
                <strong>最近一次采集需要核对以下报表</strong>
                <span>
                  已按失败来源定位；修改并保存后，请返回“实时监控”重新采集验证。
                </span>
              </div>
              <ul>
                {attentionRows.map((row) => (
                  <li key={`${row.attention.sourceId}:${row.attention.errorCode}`}>
                    <div>
                      <strong>
                        {row.sourceIndex >= 0
                          ? `报表 ${String(row.sourceIndex + 1).padStart(2, '0')} · `
                          : ''}
                        {row.source?.displayName
                          ?? row.attention.sourceCode
                          ?? '未识别报表'}
                      </strong>
                      <span>
                        {row.guidance.reason}
                        {'；需核对：'}
                        {row.guidance.fields.join('、')}
                      </span>
                    </div>
                    {row.source ? (
                      <button
                        className="secondary"
                        type="button"
                        onClick={() =>
                          document
                            .getElementById(sourceCardId(row.source!.sourceId))
                            ?.scrollIntoView({
                              behavior: 'smooth',
                              block: 'center',
                            })}
                      >
                        定位该报表
                      </button>
                    ) : null}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {enabledToggleOnly ? (
            <div className="state-panel">
              当前为罗盘PMS门店，无须配置美团报表接口。可取消报表右上角的“启用”并保存；
              停用后不要求Cookie或POST载荷，也不会参与轮询采集。
            </div>
          ) : (
            <>
              <h3>计算覆盖</h3>
              <div className="coverage-grid">
                {coverage.map((item) => (
                  <article
                    className={item.configured ? 'coverage-ready' : 'coverage-missing'}
                    key={item.type}
                  >
                    <strong>{item.label}</strong>
                    <span>
                      {item.configured
                        ? '已配置'
                        : item.required ? '缺少主数据' : '可选'}
                    </span>
                  </article>
                ))}
              </div>
            </>
          )}

          <div className="report-source-list" id="report-source-list">
            {sources.map((source, index) => {
              const endpointError = source.endpointUrl
                ? validateEndpoint(source.endpointUrl)
                : null
              const attention = attentionBySourceId.get(source.sourceId)
              const attentionGuidance = attention
                ? reportSourceGuidance(attention.errorCode)
                : null
              return (
                <article
                  className={`report-source-card ${
                    attention ? 'needs-attention' : ''
                  }`}
                  id={sourceCardId(source.sourceId)}
                  key={source.sourceId}
                >
                  <header>
                    <div>
                      <span>报表 {String(index + 1).padStart(2, '0')}</span>
                      <strong>
                        {source.displayName || '未命名报表接口'}
                      </strong>
                      {attentionGuidance ? (
                        <b className="attention-chip">
                          需核对：{attentionGuidance.fields.join('、')}
                        </b>
                      ) : null}
                    </div>
                    <label className="inline-toggle">
                      <input
                        checked={source.enabled}
                        disabled={
                          !canConfigure
                          || (source.definitionLocked && !source.enabledToggleOnly)
                        }
                        type="checkbox"
                        onChange={(event) =>
                          updateSource(source.sourceId, {
                            enabled: event.target.checked,
                          })}
                      />
                      启用
                    </label>
                  </header>

                  {attentionGuidance ? (
                    <div className="report-source-card-attention" role="alert">
                      <strong>{attentionGuidance.reason}</strong>
                      <span>{attentionGuidance.action}</span>
                      <code>{attention?.errorCode}</code>
                    </div>
                  ) : null}

                  <div className="report-source-form">
                    <label>
                      报表名称
                      <input
                        disabled={!canConfigure || source.definitionLocked}
                        value={source.displayName}
                        onChange={(event) =>
                          updateSource(source.sourceId, {
                            displayName: event.target.value,
                          })}
                      />
                    </label>
                    <label>
                      报表用途
                      <select
                        disabled={!canConfigure || source.definitionLocked}
                        value={source.reportType}
                        onChange={(event) =>
                          updateSource(source.sourceId, {
                            reportType: event.target.value as ReportType,
                          })}
                      >
                        {Object.entries(REPORT_TYPE_LABELS).map(([value, label]) => (
                          <option key={value} value={value}>{label}</option>
                        ))}
                      </select>
                    </label>
                    <label>
                      计算角色
                      <select
                        disabled={!canConfigure || source.definitionLocked}
                        value={source.calculationRole}
                        onChange={(event) =>
                          updateSource(source.sourceId, {
                            calculationRole: event.target.value as CalculationRole,
                          })}
                      >
                        {Object.entries(CALCULATION_ROLE_LABELS).map(([value, label]) => (
                          <option key={value} value={value}>{label}</option>
                        ))}
                      </select>
                    </label>
                    <label>
                      轮询间隔
                      <select
                        disabled={!canConfigure || source.definitionLocked}
                        value={source.pollIntervalMinutes}
                        onChange={(event) =>
                          updateSource(source.sourceId, {
                            pollIntervalMinutes: Number(event.target.value),
                          })}
                      >
                        {[30].map((minutes) => (
                          <option key={minutes} value={minutes}>
                            {minutes}分钟
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="wide-field">
                      完整HTTPS接口地址
                      <input
                        disabled={!canConfigure || source.definitionLocked}
                        placeholder="https://example.com/report/api"
                        value={source.endpointUrl}
                        onChange={(event) =>
                          updateSource(source.sourceId, {
                            endpointUrl: event.target.value,
                          })}
                      />
                      {endpointError
                        ? <small className="field-error">{endpointError}</small>
                        : null}
                    </label>
                    <label>
                      其他凭据别名（可空）
                      <input
                        disabled={!canConfigure || source.definitionLocked}
                        placeholder="REPORT_READER_01"
                        value={source.credentialAlias}
                        onChange={(event) =>
                          updateSource(source.sourceId, {
                            credentialAlias: event.target.value,
                          })}
                      />
                    </label>
                    <label className="wide-field">
                      POST请求载荷（JSON，可空）
                      <textarea
                        disabled={!canConfigure || source.enabledToggleOnly}
                        maxLength={20_000}
                        placeholder='例如：{"roomTypes":[],"channelKey":"Hotel"}'
                        rows={6}
                        value={source.requestPayloadJson}
                        onChange={(event) =>
                          updateSource(source.sourceId, {
                            requestPayloadJson: event.target.value,
                          })}
                      />
                      <small>
                        每家门店可单独修改。不得填写Token、Cookie或密码；
                        房态预测接口的日期会按本次采集返回的PMS营业日自动更新。
                      </small>
                    </label>
                    <label className="wide-field cookie-field">
                      该网址专用Cookie（可空）
                      <input
                        autoComplete="off"
                        disabled={!canConfigure || source.enabledToggleOnly}
                        maxLength={16 * 1024}
                        placeholder={
                          source.cookieConfigured
                            ? '已配置；留空表示保持不变'
                            : '粘贴Cookie值，不含“Cookie:”前缀'
                        }
                        type="password"
                        value={cookieDrafts[source.sourceId] ?? ''}
                        onChange={(event) => {
                          setCookieDrafts((current) => ({
                            ...current,
                            [source.sourceId]: event.target.value,
                          }))
                          if (event.target.value) {
                            setCookieClears((current) => ({
                              ...current,
                              [source.sourceId]: false,
                            }))
                          }
                        }}
                      />
                      <small>
                        {cookieDrafts[source.sourceId]
                          ? '待替换：保存后立即从页面内存清除'
                          : source.cookieConfigured
                            ? `已安全配置${source.cookieUpdatedAt
                              ? ` · ${new Date(source.cookieUpdatedAt).toLocaleString('zh-CN')}`
                              : ''}`
                            : '未配置；公开接口可以留空'}
                      </small>
                    </label>
                    {source.cookieConfigured ? (
                      <label className="cookie-clear-option">
                        <input
                          checked={Boolean(cookieClears[source.sourceId])}
                          disabled={
                            !canConfigure
                            || source.enabledToggleOnly
                            || Boolean(cookieDrafts[source.sourceId])
                          }
                          type="checkbox"
                          onChange={(event) =>
                            setCookieClears((current) => ({
                              ...current,
                              [source.sourceId]: event.target.checked,
                            }))}
                        />
                        保存时清除该网址的Cookie
                      </label>
                    ) : null}
                  </div>

                  <footer>
                    <span>
                      {source.validationStatus === 'FORMAT_VALID'
                        ? '地址格式已校验'
                        : '尚未执行真实连通测试'}
                      {' · '}
                      {source.enabledToggleOnly && !source.enabled
                        ? '已停用，不参与采集'
                        : source.cookieConfigured ? 'Cookie已配置' : 'Cookie未配置'}
                    </span>
                    {canConfigure && !source.definitionLocked ? (
                      <button
                        className="danger-link"
                        type="button"
                        onClick={() => removeSource(source.sourceId)}
                      >
                        移除
                      </button>
                    ) : null}
                  </footer>
                </article>
              )
            })}
          </div>

          {sources.length === 0
            ? <div className="state-panel">尚未配置报表URL。</div>
            : null}

          {canConfigure ? (
            <div className="report-source-actions">
              {!definitionsLocked ? (
                <>
                  <button
                    className="secondary"
                    type="button"
                    onClick={() => setSources((current) => [
                      ...current,
                      createEmptySource(),
                    ])}
                  >
                    新增报表URL
                  </button>
                  <label>
                    变更原因码
                    <input
                      value={reasonCode}
                      onChange={(event) =>
                        setReasonCode(event.target.value.toUpperCase())}
                    />
                  </label>
                </>
              ) : null}
              <button disabled={saving} type="button" onClick={save}>
                {saving
                  ? enabledToggleOnly ? '正在保存…' : '正在保存并采集…'
                  : enabledToggleOnly
                    ? '保存报表启用状态'
                    : definitionsLocked
                    ? '保存当前门店配置并自动采集一次'
                    : '保存同步接口并自动采集一次'}
              </button>
            </div>
          ) : null}
          {notice ? <p className="success-note">{notice}</p> : null}
        </StatePanel>
      )}
    </section>
  )
}
