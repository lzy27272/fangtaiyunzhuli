import { useEffect, useMemo, useState } from 'react'
import {
  loadReportSources,
  saveReportSources,
  type CalculationRole,
  type HotelContext,
  type ReportSourceInput,
  type ReportSourceView,
  type ReportType,
} from '../api/business'
import { StatePanel } from '../components/StatePanel'

interface Props {
  context: HotelContext | null
  canConfigure: boolean
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
  pollIntervalMinutes: 5,
  credentialAlias: '',
  cookieConfigured: false,
  cookieUpdatedAt: null,
  enabled: false,
  validationStatus: 'NOT_TESTED',
  rowVersion: 0,
})

export function ReportSourceConfigPage({ context, canConfigure }: Props) {
  const [sources, setSources] = useState<ReportSourceView[]>([])
  const [cookieDrafts, setCookieDrafts] = useState<Record<string, string>>({})
  const [cookieClears, setCookieClears] = useState<Record<string, boolean>>({})
  const [reasonCode, setReasonCode] = useState('REPORT_SOURCE_CONFIG')
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

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

  const coverage = useMemo(
    () => REQUIRED_COVERAGE.map((item) => ({
      ...item,
      configured: sources.some((source) =>
        source.enabled && source.reportType === item.type),
    })),
    [sources],
  )

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
      setSources(await loadReportSources(context))
      setCookieDrafts({})
      setCookieClears({})
      setNotice('报表URL及各自Cookie状态已保存；Cookie写入后不回显，仅在“实时监控”页主动采集时使用。')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '保存报表URL失败')
    } finally {
      setSaving(false)
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
        <strong>小时简报 / P1</strong>
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
          <strong>每小时 00 分</strong>
          <small>按上一小时同一截止点对比，过时简报恢复后补发。</small>
        </article>
        <article>
          <span>P1房态风险</span>
          <strong>立即推送</strong>
          <small>任一OTA辅助库存低于实体库存时，不等待整点。</small>
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

          <div className="report-source-list">
            {sources.map((source, index) => {
              const endpointError = source.endpointUrl
                ? validateEndpoint(source.endpointUrl)
                : null
              return (
                <article className="report-source-card" key={source.sourceId}>
                  <header>
                    <div>
                      <span>报表 {String(index + 1).padStart(2, '0')}</span>
                      <strong>
                        {source.displayName || '未命名报表接口'}
                      </strong>
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
                        {[5, 10, 15, 30, 60].map((minutes) => (
                          <option key={minutes} value={minutes}>
                            {minutes}分钟
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="wide-field">
                      完整HTTPS接口地址
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
                      其他凭据别名（可空）
                      <input
                        disabled={!canConfigure}
                        placeholder="REPORT_READER_01"
                        value={source.credentialAlias}
                        onChange={(event) =>
                          updateSource(source.sourceId, {
                            credentialAlias: event.target.value,
                          })}
                      />
                    </label>
                    <label className="wide-field cookie-field">
                      该网址专用Cookie（可空）
                      <input
                        autoComplete="off"
                        disabled={!canConfigure}
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
                          disabled={!canConfigure || Boolean(cookieDrafts[source.sourceId])}
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
                      {source.cookieConfigured ? 'Cookie已配置' : 'Cookie未配置'}
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
            ? <div className="state-panel">尚未配置报表URL。</div>
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
              <button disabled={saving} type="button" onClick={save}>
                {saving ? '正在保存…' : '保存全部报表URL'}
              </button>
            </div>
          ) : null}
          {notice ? <p className="success-note">{notice}</p> : null}
        </StatePanel>
      )}
    </section>
  )
}
