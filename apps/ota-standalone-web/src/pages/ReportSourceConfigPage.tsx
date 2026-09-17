import { useEffect, useMemo, useState } from 'react'
import {
  loadPmsLoginConfig,
  loadReportSources,
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
import { BieyanghongCookieRepairPanel } from './BieyanghongCookieRepairPanel'

interface Props {
  context: HotelContext | null
  canConfigure: boolean
  hotelCode: string
  pmsSystemCode: PmsSystemCode
  pmsSystemName: string
  attentionItems: ReportSourceAttention[]
  otaAttentionSourceId: string | null
}

type CollectionSection = 'overview' | 'pms' | 'ota'

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

const PMS_VENDOR_LABELS: Record<PmsSystemCode, string> = {
  MEITUAN_BIEYANGHONG: '美团别样红 PMS',
  LUOPAN_CLOUD: '罗盘 PMS',
  YILIAN_CLOUD: '驿联云 PMS',
  OTHER: '其他 PMS 厂家',
}

const LUOPAN_MANAGED_DATA_ENTRIES = [
  {
    code: 'business-day',
    name: 'PMS营业日与夜审状态',
    detail: '服务器受控会话自动读取',
  },
  {
    code: 'room-forecast',
    name: '房态预测与实体库存',
    detail: '罗盘内置页面自动采集',
  },
  {
    code: 'operating-metrics',
    name: '可售、已售、出租率、ADR与预计房费',
    detail: '罗盘内置页面自动采集',
  },
] as const

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
  pollIntervalMinutes: 60,
  credentialAlias: '',
  requestPayloadJson: '',
  cookieConfigured: false,
  cookieUpdatedAt: null,
  definitionLocked: false,
  definitionTemplateHotelCode: '',
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
  hotelCode,
  pmsSystemCode,
  pmsSystemName,
  attentionItems,
  otaAttentionSourceId,
}: Props) {
  const [sources, setSources] = useState<ReportSourceView[]>([])
  const [cookieDrafts, setCookieDrafts] = useState<Record<string, string>>({})
  const [cookieClears, setCookieClears] = useState<Record<string, boolean>>({})
  const [collectionSection, setCollectionSection] =
    useState<CollectionSection>('overview')
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [pmsLoginConfig, setPmsLoginConfig] =
    useState<PmsLoginConfigView | null>(null)
  const [trustedDeviceEligible, setTrustedDeviceEligible] =
    useState<boolean | null>(null)
  const [overviewVersion, setOverviewVersion] = useState(0)
  const selectedPmsVendorLabel = pmsSystemCode === 'OTHER'
    ? pmsSystemName.trim() || PMS_VENDOR_LABELS.OTHER
    : PMS_VENDOR_LABELS[pmsSystemCode]

  function openCollectionSection(section: CollectionSection) {
    setCollectionSection(section)
    window.requestAnimationFrame(() => {
      const targetId = section === 'overview'
        ? 'data-access-overview'
        : section === 'pms'
          ? 'pms-system-config-panel'
          : 'ota-source-config-panel'
      document.getElementById(targetId)?.scrollIntoView({
        behavior: 'smooth',
        block: 'start',
      })
    })
  }

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
          setError(
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
    setCollectionSection('pms')
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
      if (pmsSystemCode === 'OTHER') {
        setOverviewVersion((current) => current + 1)
        setNotice(
          '当前门店的接口名称、地址和登录凭据已独立保存；厂家适配完成前不会启动采集或播报。',
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
        '当前门店的接口名称、地址和登录凭据已独立保存，不会同步或覆盖其他门店。'
        + collectionNotice,
      )
    } catch (cause) {
      setError(businessErrorMessage(cause, '保存报表接口失败'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="page-card">
      <div className="page-heading">
        <div>
          <p className="eyebrow">管理员专用</p>
          <h2>数据采集设置</h2>
          <p>按步骤检查 PMS 系统和 OTA 平台。厂家链接与报表入口由系统按门店档案自动加载。</p>
        </div>
        <span className="mode-chip">仅管理员可见</span>
      </div>

      <div className="collection-step-nav" aria-label="采集设置步骤">
        {([
          ['overview', '状态总览', '先看是否正常'],
          ['pms', 'PMS系统配置', '按厂家自动匹配'],
          ['ota', 'OTA平台配置', '携程、美团等'],
        ] as const).map(([code, label, detail], index) => (
          <button
            className={collectionSection === code ? 'active' : ''}
            key={code}
            type="button"
            onClick={() => openCollectionSection(code)}
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
              onOpenOtaConfiguration={() => openCollectionSection('ota')}
              onOpenPmsConfiguration={() => openCollectionSection('pms')}
              pmsSystemCode={pmsSystemCode}
              pmsLoginConfigured={pmsLoginConfig?.configured ?? false}
              refreshVersion={overviewVersion}
              reportSources={sources}
            />
            <div className="collection-next-actions">
              <button type="button" onClick={() => openCollectionSection('pms')}>PMS系统配置</button>
              <button className="secondary" type="button" onClick={() => openCollectionSection('ota')}>OTA平台配置</button>
            </div>
          </> : null}

          {collectionSection === 'pms' ? <div
            className="pms-system-config"
            id="pms-system-config-panel"
            tabIndex={-1}
          >
            <article className="report-source-card pms-endpoint-card">
              <header>
                <div>
                  <span>{hotelCode} 门店</span>
                  <strong>PMS系统配置</strong>
                </div>
                <span className="mode-chip">
                  系统已匹配 · {selectedPmsVendorLabel}
                </span>
              </header>
              <div className="pms-vendor-selection">
                <label>
                  系统自动选择的 PMS 厂家
                  <select
                    aria-label="当前门店 PMS 厂家"
                    disabled
                    value={pmsSystemCode}
                  >
                    {Object.entries(PMS_VENDOR_LABELS).map(([code, label]) => (
                      <option key={code} value={code}>
                        {code === 'OTHER' ? selectedPmsVendorLabel : label}
                      </option>
                    ))}
                  </select>
                  <small>
                    已根据门店档案自动选择；进入本页即加载该厂家的登录方式、已有链接和数据入口。
                  </small>
                </label>
              </div>
              <p>
                {pmsSystemCode === 'OTHER'
                  ? '该厂家尚未内置适配，可在下方录入厂家提供的数据入口；保存内容只属于当前门店。'
                  : '厂家链接和报表入口由系统直接生成，无需再次输入。页面只要求处理该厂家必要的登录或授权。'}
              </p>
              <div className="pms-endpoint-list">
                {pmsSystemCode === 'LUOPAN_CLOUD'
                  ? LUOPAN_MANAGED_DATA_ENTRIES.map((entry) => (
                    <div className="pms-endpoint-row" key={entry.code}>
                      <div>
                        <strong>{entry.name}</strong>
                        <span>厂家内置数据入口</span>
                      </div>
                      <code>{entry.detail}</code>
                      <div className="pms-endpoint-states">
                        <span className="endpoint-state enabled">自动生成</span>
                        <span className="endpoint-state enabled">无需填写地址</span>
                      </div>
                    </div>
                  ))
                  : sources.length > 0 ? sources.map((source) => (
                  <div className="pms-endpoint-row" key={source.sourceId}>
                    <div>
                      <strong>{source.displayName}</strong>
                      <span>{REPORT_TYPE_LABELS[source.reportType]}</span>
                    </div>
                    <code title={source.endpointUrl}>{source.endpointUrl}</code>
                    <div className="pms-endpoint-states">
                      <span className={`endpoint-state ${source.enabled ? 'enabled' : 'disabled'}`}>
                        {source.enabled ? '已启用' : '已停用'}
                      </span>
                      <span className={`endpoint-state ${source.cookieConfigured ? 'enabled' : 'disabled'}`}>
                        {source.cookieConfigured
                          ? pmsSystemCode === 'YILIAN_CLOUD' ? '云端授权已配置' : 'Cookie 已配置'
                          : pmsSystemCode === 'YILIAN_CLOUD' ? '云端授权未配置' : 'Cookie 未配置'}
                      </span>
                    </div>
                  </div>
                )) : (
                  <div className="state-panel">
                    {pmsSystemCode === 'OTHER'
                      ? '本店尚未配置 PMS 数据入口，请在下方按厂家资料新增。'
                      : '系统尚未读取到该厂家的数据入口，请刷新状态后重试。'}
                  </div>
                )}
              </div>
              <footer>
                <span>
                  {pmsSystemCode === 'OTHER'
                    ? '仅其他 PMS 厂家需要手工维护接口定义。'
                    : '已有链接与报表入口只读展示；Cookie、令牌和账号密码不会回显。'}
                </span>
              </footer>
            </article>
            {attentionRows.length > 0 ? (
              <section
                className="report-source-attention-panel"
                id="report-source-attention-panel"
                role="alert"
                tabIndex={-1}
              >
                <div>
                  <strong>最近一次 PMS 采集需要处理</strong>
                  <span>
                    {pmsSystemCode === 'OTHER'
                      ? '已按失败来源定位；修改并保存后，请重新采集验证。'
                      : '已定位到当前厂家；请按下方登录或授权提示处理，无需修改系统生成的数据入口。'}
                  </span>
                </div>
                <ul>
                  {attentionRows.map((row) => (
                    <li key={`${row.attention.sourceId}:${row.attention.errorCode}`}>
                      <div>
                        <strong>
                          {row.sourceIndex >= 0
                            ? `数据入口 ${String(row.sourceIndex + 1).padStart(2, '0')} · `
                            : ''}
                          {row.source?.displayName
                            ?? row.attention.sourceCode
                            ?? '未识别数据入口'}
                        </strong>
                        <span>
                          {row.guidance.reason}
                          {'；需核对：'}
                          {row.guidance.fields.join('、')}
                        </span>
                      </div>
                      {pmsSystemCode === 'OTHER' && row.source ? (
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
                          定位该数据入口
                        </button>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}
            {pmsSystemCode === 'MEITUAN_BIEYANGHONG' ? (
              trustedDeviceEligible === true ? (
                <TrustedDevicePanel
                  canRevokeDevice={canConfigure}
                  context={context}
                  onStatusChanged={() =>
                    setOverviewVersion((current) => current + 1)}
                />
              ) : null
            ) : pmsSystemCode === 'LUOPAN_CLOUD' ? (
              <LuopanBrowserConfigPanel
                canConfigure={canConfigure}
                context={context}
                onStatusChanged={() =>
                  setOverviewVersion((current) => current + 1)}
                />
            ) : pmsSystemCode === 'YILIAN_CLOUD' ? (
              <article className="report-source-card">
                <header>
                  <div><span>酒店系统厂家</span><strong>驿联云云端授权</strong></div>
                  <span className="mode-chip">
                    {sources.length > 0 && sources.filter((source) => source.enabled).every(
                      (source) => source.cookieConfigured,
                    ) ? '已加密配置' : '等待登录'}
                  </span>
                </header>
                <p>驿联云不使用 Cookie。管理员在服务器云端浏览器完成官方登录后，系统自动读取当前会话的授权令牌，验证本店全部接口后再加密替换；失败不会覆盖旧授权。</p>
              </article>
            ) : (
              <article className="report-source-card">
                <header>
                  <div><span>酒店系统厂家</span><strong>{selectedPmsVendorLabel}接入配置</strong></div>
                  <span className="mode-chip">待适配</span>
                </header>
                <p>厂家名称已保存到门店档案。请先完成该厂家的只读数据接口适配、字段映射和单店校验；通过前不会启用采集或播报。</p>
              </article>
            )}
            {pmsSystemCode === 'MEITUAN_BIEYANGHONG'
            && trustedDeviceEligible === false ? (
              <BieyanghongCookieRepairPanel
                canSubmit={canConfigure}
                context={context}
                hotelCode={hotelCode}
                onStatusChanged={async () => {
                  const [refreshedSources, refreshedLogin] = await Promise.all([
                    loadReportSources(context),
                    loadPmsLoginConfig(context),
                  ])
                  setSources(refreshedSources)
                  setPmsLoginConfig(refreshedLogin)
                  setOverviewVersion((current) => current + 1)
                }}
              />
            ) : null}
          </div> : null}

          {collectionSection === 'ota' ? <OtaSourceConfigPanel
            attentionSourceId={otaAttentionSourceId}
            canConfigure={canConfigure}
            context={context}
            onStatusChanged={() =>
              setOverviewVersion((current) => current + 1)}
          /> : null}

          {collectionSection === 'pms' && pmsSystemCode === 'OTHER' ? <>
          <div className="security-note report-source-note">
            该 PMS 厂家尚未内置适配。仅在厂家提供或更换数据入口时填写；登录凭据会按门店加密保存，保存后不再显示原文。
          </div>
          <div className="security-note report-source-note" role="status">
            当前门店独立配置：报表名称、接口地址、请求内容和 Cookie 均不会同步或覆盖其他门店。
          </div>

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
                        disabled={!canConfigure}
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
                        disabled={!canConfigure}
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
                        disabled={!canConfigure}
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
                        disabled={!canConfigure}
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
                        disabled={!canConfigure}
                        value={source.pollIntervalMinutes}
                        onChange={(event) =>
                          updateSource(source.sourceId, {
                            pollIntervalMinutes: Number(event.target.value),
                          })}
                      >
                        {[60].map((minutes) => (
                          <option key={minutes} value={minutes}>
                            {minutes}分钟
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="wide-field">
                      数据接口地址
                      <input
                        disabled={!canConfigure}
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
                        disabled={!canConfigure}
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
                        disabled={!canConfigure}
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
                        disabled={!canConfigure}
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
                      {source.cookieConfigured ? '登录凭据已配置' : '登录凭据未配置'}
                    </span>
                    {canConfigure ? (
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
              <button disabled={saving} type="button" onClick={save}>
                {saving
                  ? pmsSystemCode === 'OTHER' ? '正在保存…' : '正在保存并采集…'
                  : pmsSystemCode === 'OTHER'
                    ? '保存本店配置'
                    : '保存本店配置并自动采集一次'}
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
