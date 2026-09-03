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
  type PmsSystemCode,
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
import { TrustedDevicePanel } from './TrustedDevicePanel'
import { loadTrustedDeviceStatus } from '../api/trustedDevice'
import { businessErrorMessage } from '../ui/businessDisplay'

interface Props {
  context: HotelContext | null
  canConfigure: boolean
  pmsSystemCode: PmsSystemCode
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
const REPORT_SOURCE_CHANGE_REASON = 'UPDATE_COLLECTION_CONFIGURATION'

function validateEndpoint(value: string): string | null {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return '必须填写完整的安全接口地址。'
  }
  if (url.protocol !== 'https:') return '只允许以 https 开头的安全接口地址。'
  if (url.username || url.password) return '接口地址中不能包含账号或密码。'
  if (url.hash) return '接口地址中不能包含页面片段。'
  if ([...url.searchParams.keys()].some((key) => SENSITIVE_QUERY_KEY.test(key))) {
    return '接口地址中不能包含访问令牌、登录凭据、密码或签名密钥。'
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
  pmsSystemCode,
  attentionItems,
  otaAttentionSourceId,
}: Props) {
  const [sources, setSources] = useState<ReportSourceView[]>([])
  const [cookieDrafts, setCookieDrafts] = useState<Record<string, string>>({})
  const [cookieClears, setCookieClears] = useState<Record<string, boolean>>({})
  const [collectionSection, setCollectionSection] =
    useState<'overview' | 'pms' | 'ota' | 'reports'>('overview')
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
  const [trustedDeviceEligible, setTrustedDeviceEligible] =
    useState<boolean | null>(null)
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
          setError(businessErrorMessage(cause, '读取报表接口失败'))
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
      setTrustedDeviceEligible(null)
      return
    }
    let cancelled = false
    setTrustedDeviceEligible(null)
    Promise.all([
      loadPmsLoginConfig(context),
      loadTrustedDeviceStatus(context),
    ])
      .then(([config, trustedDevice]) => {
        if (!cancelled) {
          setPmsLoginConfig(config)
          setTrustedDeviceEligible(trustedDevice.eligible)
        }
      })
      .catch((cause) => {
        if (!cancelled) {
          setPmsLoginError(
            businessErrorMessage(cause, '读取酒店系统登录配置失败'),
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
      setError('请求内容格式不正确，请检查后再保存。')
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
    if (
      Object.values(cookieDrafts).some((value) =>
        /[\r\n\u0000]/.test(value)
        || /^\s*cookie\s*:/i.test(value)
        || (value.length > 0 && !value.trim()))
    ) {
      setError('登录凭据格式不正确，请重新填写。')
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
      await saveReportSources(context, payload, REPORT_SOURCE_CHANGE_REASON)
      const savedSources = await loadReportSources(context)
      setSources(savedSources)
      setCookieDrafts({})
      setCookieClears({})
      if (enabledToggleOnly) {
        setOverviewVersion((current) => current + 1)
        setNotice(
          '罗盘酒店系统的报表启用状态已保存；未启用的报表不会参与采集。',
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
        const message = businessErrorMessage(cause, '采集未完成')
        collectionNotice =
          ` 配置已保存，但自动采集未完成（${message}）；`
          + '可修正配置后再次保存，或到监控页手动采集。'
      }
      setOverviewVersion((current) => current + 1)
      setNotice(
        (definitionsLocked
          ? `当前门店登录凭据及请求内容已保存；其他接口设置继续由${definitionTemplateHotelCode}门店统一同步。`
          : '报表接口及当前门店登录凭据已保存；接口设置已同步到全部门店，登录凭据不会被复制或覆盖。')
        + collectionNotice,
      )
    } catch (cause) {
      setError(businessErrorMessage(cause, '保存报表接口失败'))
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
          ? '酒店系统账号密码已加密保存，页面输入已清空且不会回显。'
          : '酒店系统账号密码配置已清除。',
      )
    } catch (cause) {
      setPmsLoginError(
        businessErrorMessage(cause, '保存酒店系统登录配置失败'),
      )
    } finally {
      setSavingPmsLogin(false)
    }
  }

  return (
    <section className="page-card">
      <div className="page-heading">
        <div>
          <p className="eyebrow">管理员专用</p>
          <h2>数据采集设置</h2>
          <p>按步骤检查酒店系统、渠道平台和数据报表。日常维护只需进入对应步骤，无需理解技术参数。</p>
        </div>
        <span className="mode-chip">仅管理员可见</span>
      </div>

      <div className="collection-step-nav" aria-label="采集设置步骤">
        {([
          ['overview', '状态总览', '先看是否正常'],
          ['pms', '酒店系统', '登录与采集设备'],
          ['ota', '渠道平台', '携程、美团等'],
          ['reports', '高级报表', '接口与登录凭据'],
        ] as const).map(([code, label, detail], index) => (
          <button
            className={collectionSection === code ? 'active' : ''}
            key={code}
            type="button"
            onClick={() => setCollectionSection(code)}
          >
            <span>{index + 1}</span>
            <strong>{label}</strong>
            <small>{detail}</small>
          </button>
        ))}
      </div>

      {!context ? (
        <div className="state-panel">请先在顶部选择门店。</div>
      ) : (
        <StatePanel loading={loading} error={error}>
          {collectionSection === 'overview' ? <>
            <DataAccessOverviewPanel
              context={context}
              pmsSystemCode={pmsSystemCode}
              pmsLoginConfigured={pmsLoginConfig?.configured ?? false}
              refreshVersion={overviewVersion}
              reportSources={sources}
            />
            <div className="collection-next-actions">
              <button type="button" onClick={() => setCollectionSection('pms')}>检查酒店系统</button>
              <button className="secondary" type="button" onClick={() => setCollectionSection('ota')}>检查渠道平台</button>
            </div>
          </> : null}

          {collectionSection === 'pms' ? <>
            {pmsSystemCode === 'MEITUAN_BIEYANGHONG' ? (
              <TrustedDevicePanel
                canRevokeDevice={canConfigure}
                context={context}
                onStatusChanged={() =>
                  setOverviewVersion((current) => current + 1)}
              />
            ) : pmsSystemCode === 'LUOPAN_CLOUD' ? (
              <LuopanBrowserConfigPanel
                canConfigure={canConfigure}
                context={context}
                onStatusChanged={() =>
                  setOverviewVersion((current) => current + 1)}
              />
            ) : (
              <article className="report-source-card">
                <header>
                  <div><span>酒店系统厂家</span><strong>其他 PMS 接入配置</strong></div>
                  <span className="mode-chip">待适配</span>
                </header>
                <p>厂家名称已保存到门店档案。请先完成该厂家的只读数据接口适配、字段映射和单店校验；通过前不会启用采集或播报。</p>
              </article>
            )}
          </> : null}

          {collectionSection === 'ota' ? <OtaSourceConfigPanel
            attentionSourceId={otaAttentionSourceId}
            canConfigure={canConfigure}
            context={context}
            onStatusChanged={() =>
              setOverviewVersion((current) => current + 1)}
          /> : null}

          {collectionSection === 'pms'
          && pmsSystemCode === 'MEITUAN_BIEYANGHONG'
          && trustedDeviceEligible === false ? (
          <article className="report-source-card pms-login-card">
            <header>
              <div>
                <span>酒店系统登录</span>
                <strong>备用账号配置</strong>
              </div>
              <span className="mode-chip">
                {pmsLoginConfig?.configured ? '已加密配置' : '未配置'}
              </span>
            </header>
            <p>
              账号密码仅按当前门店加密保存，提交后立即从页面清空且不回显。
              系统不会在此页面自动登录或处理验证码；需要验证时请使用“登录修复”。
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
          ) : null}

          {collectionSection === 'reports' ? <>
          <div className="security-note report-source-note">
            高级报表只在新增或更换采集接口时使用。登录凭据会按门店加密保存，保存后不再显示原文。
          </div>
          {definitionsLocked ? (
            <div className="security-note report-source-note" role="status">
              报表接口由
              {definitionTemplateHotelCode}
              门店统一配置并自动同步；当前门店只需单独填写登录凭据和请求内容，
              接口地址及其他设置无需重复填写。
            </div>
          ) : (
            <div className="security-note report-source-note" role="status">
              当前门店是报表接口模板。保存接口定义后会自动同步到现有及后续新增的全部评审门店；
              各门店登录凭据始终独立，不会被同步或覆盖。
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
              停用后不要求登录凭据或请求内容，也不会参与定时采集。
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
                      {attention?.errorCode ? <details className="technical-details"><summary>查看错误编号</summary><code>{attention.errorCode}</code></details> : null}
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
                      数据接口地址
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
                      授权名称（可选）
                      <input
                        disabled={!canConfigure || source.definitionLocked}
                        placeholder="例如：每日经营报表"
                        value={source.credentialAlias}
                        onChange={(event) =>
                          updateSource(source.sourceId, {
                            credentialAlias: event.target.value,
                          })}
                      />
                    </label>
                    <label className="wide-field">
                      请求内容（可选）
                      <textarea
                        disabled={!canConfigure || source.enabledToggleOnly}
                        maxLength={20_000}
                        placeholder="留空表示使用默认查询条件"
                        rows={6}
                        value={source.requestPayloadJson}
                        onChange={(event) =>
                          updateSource(source.sourceId, {
                            requestPayloadJson: event.target.value,
                          })}
                      />
                      <small>
                        只有接口明确要求时才填写。每家门店可单独修改，不得填写访问令牌、登录凭据或密码；
                        房态预测接口的日期会按本次采集返回的PMS营业日自动更新。
                      </small>
                    </label>
                    <label className="wide-field cookie-field">
                      该接口专用登录凭据（可选）
                      <input
                        autoComplete="off"
                        disabled={!canConfigure || source.enabledToggleOnly}
                        maxLength={16 * 1024}
                        placeholder={
                          source.cookieConfigured
                            ? '已配置；留空表示保持不变'
                            : '粘贴登录凭据原文，系统会加密保存'
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
                        保存时清除该接口的登录凭据
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
                        : source.cookieConfigured ? '登录凭据已配置' : '登录凭据未配置'}
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
            ? <div className="state-panel">尚未配置报表接口。</div>
            : null}

          {canConfigure ? (
            <div className="report-source-actions">
              {!definitionsLocked ? (
                <button
                    className="secondary"
                    type="button"
                    onClick={() => setSources((current) => [
                      ...current,
                      createEmptySource(),
                    ])}
                  >
                    新增报表接口
                  </button>
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
          </> : null}
          {notice ? <p className="success-note">{notice}</p> : null}
        </StatePanel>
      )}
    </section>
  )
}
