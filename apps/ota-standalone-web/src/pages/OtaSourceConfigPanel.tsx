import { useEffect, useMemo, useState } from 'react'
import {
  loadOtaSources,
  refreshOtaSource,
  saveOtaSources,
  triggerLiveCollection,
  type HotelContext,
  type OtaCredentialUpdate,
  type OtaCookieUpdate,
  type OtaPlatformCode,
  type OtaSourceInput,
  type OtaSourceView,
} from '../api/business'
import { otaSourceGuidance } from './otaSourceGuidance'

interface Props {
  context: HotelContext
  canConfigure: boolean
  attentionSourceId: string | null
  onStatusChanged?: () => void
}

const PLATFORM_LABELS: Record<OtaPlatformCode, string> = {
  CTRIP: '携程',
  MEITUAN: '美团',
  FLIGGY: '飞猪',
  DOUYIN: '抖音',
  QUNAR: '去哪儿',
  TONGCHENG: '同程',
  OTHER: '其他OTA',
}

const DIMENSION_LABELS: Record<string, string> = {
  DATE: '日期',
  ROOM_TYPE: '房型',
  INVENTORY: '库存/可售',
  PRICE: '价格/收入',
  SALES: '销量/间夜',
  CHANNEL: '渠道',
  CANCELLATION: '取消',
  RANK: '同行排名',
  EXPOSURE: '曝光',
  TRAFFIC: '访问流量',
  CONVERSION: '转化率',
  PEER_SET_SIZE: '竞争圈规模',
}

const OTA_DEFAULT_POLL_INTERVAL_MINUTES = 120
const OTA_POLL_INTERVAL_OPTIONS = [
  { minutes: 30, label: '每30分钟' },
  { minutes: 60, label: '每1小时' },
  { minutes: 120, label: '每2小时' },
  { minutes: 180, label: '每3小时' },
  { minutes: 240, label: '每4小时' },
  { minutes: 360, label: '每6小时' },
  { minutes: 720, label: '每12小时' },
  { minutes: 1_440, label: '每24小时' },
] as const

const SENSITIVE_QUERY_KEY =
  /(?:token|cookie|password|passwd|secret|session|authorization|api[_-]?key|sign(?:ature)?)/i

const validateUrl = (value: string): string | null => {
  let url
  try {
    url = new URL(value)
  } catch {
    return '必须填写完整HTTPS网址。'
  }
  if (url.protocol !== 'https:') return '只允许HTTPS网址。'
  if (url.username || url.password) return '网址中不能包含账号或密码。'
  if (url.hash) return '网址中不能包含片段标识。'
  if ([...url.searchParams.keys()].some((key) =>
    SENSITIVE_QUERY_KEY.test(key))) {
    return '网址查询参数中不能包含Token、Cookie、密码或签名。'
  }
  return null
}

const emptyOtaSource = (): OtaSourceView => ({
  sourceId: globalThis.crypto.randomUUID(),
  displayName: '',
  platformCode: 'CTRIP',
  portalUrl: '',
  dataEndpointUrl: '',
  requestMethod: 'GET',
  requestPayloadJson: '',
  pollIntervalMinutes: OTA_DEFAULT_POLL_INTERVAL_MINUTES,
  enabled: true,
  cookieConfigured: false,
  cookieUpdatedAt: null,
  credentialsConfigured: false,
  credentialsUpdatedAt: null,
  loginMode: 'CONTROLLED_LOGIN_PENDING',
  loginExecutionEnabled: false,
  lastRefreshStatus: 'NEVER',
  lastRefreshAt: null,
  lastErrorCode: null,
  lastSummary: null,
  rowVersion: 0,
})

const otaCardId = (sourceId: string) =>
  `ota-source-${sourceId.replace(/[^A-Za-z0-9_-]/g, '-')}`

export function OtaSourceConfigPanel({
  context,
  canConfigure,
  attentionSourceId,
  onStatusChanged,
}: Props) {
  const [sources, setSources] = useState<OtaSourceView[]>([])
  const [cookieDrafts, setCookieDrafts] =
    useState<Record<string, string>>({})
  const [accountDrafts, setAccountDrafts] =
    useState<Record<string, string>>({})
  const [passwordDrafts, setPasswordDrafts] =
    useState<Record<string, string>>({})
  const [clearCookies, setClearCookies] =
    useState<Record<string, boolean>>({})
  const [clearCredentials, setClearCredentials] =
    useState<Record<string, boolean>>({})
  const [portalUrlEnabled, setPortalUrlEnabled] =
    useState<Record<string, boolean>>({})
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [refreshingId, setRefreshingId] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const reload = async () => {
    const rows = await loadOtaSources(context)
    setSources(rows)
    setPortalUrlEnabled(Object.fromEntries(
      rows.map((source) => [source.sourceId, Boolean(source.portalUrl)]),
    ))
    return rows
  }

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError('')
    setNotice('')
    loadOtaSources(context)
      .then((rows) => {
        if (!cancelled) {
          setSources(rows)
          setCookieDrafts({})
          setAccountDrafts({})
          setPasswordDrafts({})
          setClearCookies({})
          setClearCredentials({})
          setPortalUrlEnabled(Object.fromEntries(
            rows.map((source) => [source.sourceId, Boolean(source.portalUrl)]),
          ))
        }
      })
      .catch((cause) => {
        if (!cancelled) {
          setError(cause instanceof Error ? cause.message : '读取OTA配置失败')
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
    if (attentionSourceId === null || loading) return
    const frame = window.requestAnimationFrame(() => {
      const target = attentionSourceId
        ? document.getElementById(otaCardId(attentionSourceId))
        : document.getElementById('ota-source-config-panel')
      target?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      target?.focus({ preventScroll: true })
    })
    return () => window.cancelAnimationFrame(frame)
  }, [attentionSourceId, loading, sources.length])

  const enabledCount = useMemo(
    () => sources.filter((source) => source.enabled).length,
    [sources],
  )

  const updateSource = (
    sourceId: string,
    patch: Partial<OtaSourceView>,
  ) => {
    setSources((current) => current.map((source) =>
      source.sourceId === sourceId ? { ...source, ...patch } : source))
  }

  const validate = (): string | null => {
    for (const source of sources) {
      if (!source.displayName.trim()) return '请填写所有OTA来源名称。'
      const usesPortalUrl = portalUrlEnabled[source.sourceId]
        ?? Boolean(source.portalUrl)
      if (usesPortalUrl) {
        const portalError = validateUrl(source.portalUrl)
        if (portalError) return `${source.displayName || 'OTA来源'}后台网址：${portalError}`
      }
      const endpointError = validateUrl(source.dataEndpointUrl)
      if (endpointError) return `${source.displayName || 'OTA来源'}数据接口：${endpointError}`
      if (source.requestMethod === 'GET' && source.requestPayloadJson.trim()) {
        return `${source.displayName}使用GET时不能填写POST请求载荷。`
      }
      if (!OTA_POLL_INTERVAL_OPTIONS.some(
        (option) => option.minutes === source.pollIntervalMinutes,
      )) {
        return `${source.displayName}的轮询间隔不受支持。`
      }
      if (source.requestMethod === 'POST') {
        try {
          const payload = JSON.parse(source.requestPayloadJson || '{}')
          if (
            payload === null
            || typeof payload !== 'object'
            || Array.isArray(payload)
          ) {
            return `${source.displayName}的POST请求载荷必须是JSON对象。`
          }
        } catch {
          return `${source.displayName}的POST请求载荷不是有效JSON。`
        }
      }
      const cookie = cookieDrafts[source.sourceId] ?? ''
      if (
        /[\r\n\u0000]/.test(cookie)
        || /^\s*cookie\s*:/i.test(cookie)
        || (cookie.length > 0 && !cookie.trim())
      ) {
        return `${source.displayName}的Cookie格式无效。`
      }
      const account = (accountDrafts[source.sourceId] ?? '').trim()
      const password = passwordDrafts[source.sourceId] ?? ''
      if ((account || password) && (!account || !password)) {
        return `${source.displayName}的OTA账号和密码必须同时填写。`
      }
      if (/[\r\n\u0000]/.test(account) || /[\r\n\u0000]/.test(password)) {
        return `${source.displayName}的账号密码不能包含换行或空字符。`
      }
    }
    return null
  }

  const inputFor = (source: OtaSourceView): OtaSourceInput => {
    const cookie = cookieDrafts[source.sourceId] ?? ''
    const account = (accountDrafts[source.sourceId] ?? '').trim()
    const password = passwordDrafts[source.sourceId] ?? ''
    const cookieUpdate: OtaCookieUpdate = cookie
      ? { action: 'REPLACE', value: cookie }
      : clearCookies[source.sourceId]
        ? { action: 'CLEAR' }
        : { action: 'KEEP' }
    const credentialUpdate: OtaCredentialUpdate = account && password
      ? { action: 'REPLACE', account, password }
      : clearCredentials[source.sourceId]
        ? { action: 'CLEAR' }
        : { action: 'KEEP' }
    return {
      sourceId: source.sourceId,
      displayName: source.displayName.trim(),
      platformCode: source.platformCode,
      portalUrl:
        (portalUrlEnabled[source.sourceId] ?? Boolean(source.portalUrl))
          ? source.portalUrl.trim()
          : '',
      dataEndpointUrl: source.dataEndpointUrl.trim(),
      requestMethod: source.requestMethod,
      requestPayloadJson: source.requestPayloadJson.trim(),
      pollIntervalMinutes: source.pollIntervalMinutes,
      enabled: source.enabled,
      cookieUpdate,
      credentialUpdate,
      rowVersion: source.rowVersion,
    }
  }

  async function save() {
    if (!canConfigure) return
    setError('')
    setNotice('')
    const validationError = validate()
    if (validationError) {
      setError(validationError)
      return
    }
    setSaving(true)
    try {
      const saved = await saveOtaSources(
        context,
        sources.map(inputFor),
      )
      setSources(saved)
      setPortalUrlEnabled(Object.fromEntries(
        saved.map((source) => [source.sourceId, Boolean(source.portalUrl)]),
      ))
      setCookieDrafts({})
      setAccountDrafts({})
      setPasswordDrafts({})
      setClearCookies({})
      setClearCredentials({})
      const enabledSources = saved.filter((source) => source.enabled)
      if (enabledSources.length === 0) {
        setNotice('OTA配置已安全保存；当前没有启用的OTA来源，因此未执行自动采集。')
        onStatusChanged?.()
        return
      }
      try {
        const run = await triggerLiveCollection(context)
        const refreshed = run.otaRefreshes ?? await reload()
        setSources(refreshed)
        const otaCompleted = refreshed.filter(
          (source) =>
            source.enabled && source.lastRefreshStatus === 'COMPLETE',
        ).length
        setNotice(
          `OTA配置已保存并自动执行一次融合采集：`
          + `${run.successfulSourceCount}/${run.sourceCount}个主报表来源可用，`
          + `${otaCompleted}/${enabledSources.length}个OTA来源已形成数据。`,
        )
      } catch (collectionCause) {
        let completed = 0
        let failed = 0
        for (const source of enabledSources) {
          setRefreshingId(source.sourceId)
          try {
            await refreshOtaSource(context, source.sourceId)
            completed += 1
          } catch {
            failed += 1
          }
        }
        await reload()
        const code =
          collectionCause instanceof Error
            ? collectionCause.message
            : 'COLLECTION_FAILED'
        setNotice(
          `OTA配置已保存；融合采集未完成（${code}），`
          + `已自动单独刷新一次OTA来源：${completed}个完成，${failed}个需核对。`,
        )
        if (failed > 0) {
          setError('部分OTA来源刷新失败，请根据来源卡片中的错误原因修改后再次保存或手动刷新。')
        }
      }
      onStatusChanged?.()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '保存OTA配置失败')
    } finally {
      setRefreshingId(null)
      setSaving(false)
    }
  }

  async function refreshOne(sourceId: string) {
    setRefreshingId(sourceId)
    setError('')
    setNotice('')
    try {
      const refreshed = await refreshOtaSource(context, sourceId)
      setSources((current) => current.map((source) =>
        source.sourceId === sourceId ? refreshed : source))
      setNotice(`${refreshed.displayName}已完成只读刷新。`)
    } catch (cause) {
      await reload()
      setError(cause instanceof Error ? cause.message : 'OTA刷新失败')
    } finally {
      setRefreshingId(null)
      onStatusChanged?.()
    }
  }

  return (
    <section
      className={`ota-source-config-panel ${
        attentionSourceId !== null ? 'attention-requested' : ''
      }`}
      id="ota-source-config-panel"
      tabIndex={-1}
    >
      <div className="page-heading">
        <div>
          <p className="eyebrow">OTA DATA SOURCES</p>
          <h3>OTA后台与数据接口</h3>
          <p>
            每个门店可配置多个OTA来源。Cookie和账号密码分别加密保存且不回显；
            后台登录网址为可选补充项；立即刷新仅使用Cookie只读访问HTTPS JSON接口，
            不会自动调价或修改库存。
          </p>
        </div>
        <span className="mode-chip">
          {enabledCount}/{sources.length} 已启用
        </span>
      </div>

      <div className="security-note report-source-note">
        账号密码已预留给后续平台专用受控登录；在明确登录协议、验证码流程和授权范围前，
        不会把账号密码发送给任意网址。当前可用链路为：登录OTA后台取得Cookie → 保存 →
        立即刷新JSON数据接口。
      </div>

      {loading ? <div className="state-panel">正在读取OTA配置…</div> : null}
      {error ? <div className="error" role="alert">{error}</div> : null}
      {notice ? <div className="success" role="status">{notice}</div> : null}

      <div className="ota-source-list">
        {sources.map((source, index) => {
          const guidance = source.lastRefreshStatus === 'FAILED'
            ? otaSourceGuidance(source.lastErrorCode)
            : null
          const highlighted =
            attentionSourceId === source.sourceId
            || source.lastRefreshStatus === 'FAILED'
          return (
            <article
              className={`ota-source-card ${highlighted ? 'needs-attention' : ''}`}
              id={otaCardId(source.sourceId)}
              key={source.sourceId}
              tabIndex={-1}
            >
              <header>
                <div>
                  <span>OTA {String(index + 1).padStart(2, '0')}</span>
                  <strong>{source.displayName || '未命名OTA来源'}</strong>
                  <small>{PLATFORM_LABELS[source.platformCode]}</small>
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

              {guidance ? (
                <div className="report-source-card-attention" role="alert">
                  <strong>{guidance.reason}</strong>
                  <span>
                    需核对：{guidance.fields.join('、')}。{guidance.action}
                  </span>
                  <code>{source.lastErrorCode}</code>
                </div>
              ) : null}

              <div className="report-source-form">
                <label>
                  OTA来源名称
                  <input
                    disabled={!canConfigure}
                    placeholder="例如 携程房态"
                    value={source.displayName}
                    onChange={(event) =>
                      updateSource(source.sourceId, {
                        displayName: event.target.value,
                      })}
                  />
                </label>
                <label>
                  OTA平台
                  <select
                    disabled={!canConfigure}
                    value={source.platformCode}
                    onChange={(event) =>
                      updateSource(source.sourceId, {
                        platformCode: event.target.value as OtaPlatformCode,
                      })}
                  >
                    {Object.entries(PLATFORM_LABELS).map(([code, label]) => (
                      <option key={code} value={code}>{label}</option>
                    ))}
                  </select>
                </label>
                <label className="cookie-clear-option wide-field">
                  <input
                    checked={
                      portalUrlEnabled[source.sourceId]
                      ?? Boolean(source.portalUrl)
                    }
                    disabled={!canConfigure}
                    type="checkbox"
                    onChange={(event) =>
                      setPortalUrlEnabled((current) => ({
                        ...current,
                        [source.sourceId]: event.target.checked,
                      }))}
                  />
                  填写OTA后台登录网址（可选）
                  <small>仅用于后台快捷跳转，不参与数据采集。</small>
                </label>
                {(portalUrlEnabled[source.sourceId]
                  ?? Boolean(source.portalUrl)) ? (
                  <label className="wide-field">
                    OTA后台登录网址（补充）
                    <input
                      disabled={!canConfigure}
                      placeholder="https://..."
                      value={source.portalUrl}
                      onChange={(event) =>
                        updateSource(source.sourceId, {
                          portalUrl: event.target.value,
                        })}
                    />
                    {source.portalUrl && validateUrl(source.portalUrl)
                      ? <small className="field-error">{validateUrl(source.portalUrl)}</small>
                      : null}
                  </label>
                ) : null}
                <label className="wide-field">
                  OTA数据接口网址（返回JSON）
                  <input
                    disabled={!canConfigure}
                    placeholder="https://.../api/..."
                    value={source.dataEndpointUrl}
                    onChange={(event) =>
                      updateSource(source.sourceId, {
                        dataEndpointUrl: event.target.value,
                      })}
                  />
                  {source.dataEndpointUrl && validateUrl(source.dataEndpointUrl)
                    ? <small className="field-error">{validateUrl(source.dataEndpointUrl)}</small>
                    : null}
                </label>
                <label>
                  请求方式
                  <select
                    disabled={!canConfigure}
                    value={source.requestMethod}
                    onChange={(event) =>
                      updateSource(source.sourceId, {
                        requestMethod:
                          event.target.value as 'GET' | 'POST',
                        requestPayloadJson:
                          event.target.value === 'GET'
                            ? ''
                            : source.requestPayloadJson,
                      })}
                  >
                    <option value="GET">GET</option>
                    <option value="POST">POST</option>
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
                    {OTA_POLL_INTERVAL_OPTIONS.map((option) => (
                      <option
                        key={option.minutes}
                        value={option.minutes}
                      >
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
                {source.requestMethod === 'POST' ? (
                  <label className="wide-field">
                    POST请求载荷（JSON对象）
                    <textarea
                      disabled={!canConfigure}
                      maxLength={20_000}
                      placeholder='例如：{"hotelCode":"H001"}'
                      rows={5}
                      value={source.requestPayloadJson}
                      onChange={(event) =>
                        updateSource(source.sourceId, {
                          requestPayloadJson: event.target.value,
                        })}
                    />
                  </label>
                ) : null}
                <label className="wide-field cookie-field">
                  OTA Cookie
                  <input
                    autoComplete="off"
                    disabled={!canConfigure || clearCookies[source.sourceId]}
                    maxLength={16 * 1024}
                    placeholder={
                      source.cookieConfigured
                        ? '已加密配置；留空表示保持不变'
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
                        setClearCookies((current) => ({
                          ...current,
                          [source.sourceId]: false,
                        }))
                      }
                    }}
                  />
                  <small>
                    {source.cookieConfigured ? 'Cookie已加密保存且不会回显' : '立即刷新前必须配置'}
                  </small>
                </label>
                <label>
                  OTA账号
                  <input
                    autoComplete="off"
                    disabled={!canConfigure || clearCredentials[source.sourceId]}
                    placeholder={
                      source.credentialsConfigured
                        ? '已配置；重新填写将替换'
                        : '用于后续受控登录'
                    }
                    value={accountDrafts[source.sourceId] ?? ''}
                    onChange={(event) =>
                      setAccountDrafts((current) => ({
                        ...current,
                        [source.sourceId]: event.target.value,
                      }))}
                  />
                </label>
                <label>
                  OTA密码
                  <input
                    autoComplete="new-password"
                    disabled={!canConfigure || clearCredentials[source.sourceId]}
                    placeholder={
                      source.credentialsConfigured
                        ? '已配置；重新填写将替换'
                        : '用于后续受控登录'
                    }
                    type="password"
                    value={passwordDrafts[source.sourceId] ?? ''}
                    onChange={(event) =>
                      setPasswordDrafts((current) => ({
                        ...current,
                        [source.sourceId]: event.target.value,
                      }))}
                  />
                </label>
                {source.cookieConfigured ? (
                  <label className="cookie-clear-option wide-field">
                    <input
                      checked={Boolean(clearCookies[source.sourceId])}
                      disabled={!canConfigure || Boolean(cookieDrafts[source.sourceId])}
                      type="checkbox"
                      onChange={(event) =>
                        setClearCookies((current) => ({
                          ...current,
                          [source.sourceId]: event.target.checked,
                        }))}
                    />
                    保存时清除该OTA来源Cookie
                  </label>
                ) : null}
                {source.credentialsConfigured ? (
                  <label className="cookie-clear-option wide-field">
                    <input
                      checked={Boolean(clearCredentials[source.sourceId])}
                      disabled={
                        !canConfigure
                        || Boolean(accountDrafts[source.sourceId])
                        || Boolean(passwordDrafts[source.sourceId])
                      }
                      type="checkbox"
                      onChange={(event) =>
                        setClearCredentials((current) => ({
                          ...current,
                          [source.sourceId]: event.target.checked,
                        }))}
                    />
                    保存时清除该OTA来源账号密码
                  </label>
                ) : null}
              </div>

              <div className="ota-refresh-summary">
                <strong>
                  刷新状态｜{source.lastRefreshStatus}
                </strong>
                <span>
                  {source.lastRefreshAt
                    ? new Date(source.lastRefreshAt).toLocaleString('zh-CN')
                    : '尚未刷新'}
                </span>
                {source.lastSummary ? (
                  <>
                    <span>记录数｜{source.lastSummary.recordCount}</span>
                    <span>
                      已识别维度｜
                      {source.lastSummary.detectedDimensions
                        .map((code) => DIMENSION_LABELS[code] ?? code)
                        .join('、') || '尚未识别'}
                    </span>
                  </>
                ) : null}
              </div>

              <footer>
                <div className="heading-actions">
                  {(portalUrlEnabled[source.sourceId]
                    ?? Boolean(source.portalUrl))
                    && source.portalUrl
                    && !validateUrl(source.portalUrl) ? (
                    <a
                      className="secondary button-link"
                      href={source.portalUrl}
                      rel="noreferrer"
                      target="_blank"
                    >
                      打开OTA后台
                    </a>
                  ) : null}
                  <button
                    className="secondary"
                    disabled={
                      !canConfigure
                      || refreshingId !== null
                      || source.rowVersion === 0
                    }
                    type="button"
                    onClick={() => void refreshOne(source.sourceId)}
                  >
                    {refreshingId === source.sourceId ? '刷新中…' : '立即刷新'}
                  </button>
                </div>
                {canConfigure ? (
                  <button
                    className="danger-link"
                    type="button"
                    onClick={() =>
                      setSources((current) =>
                        current.filter((item) =>
                          item.sourceId !== source.sourceId))}
                  >
                    移除
                  </button>
                ) : null}
              </footer>
            </article>
          )
        })}
      </div>

      {sources.length === 0 && !loading ? (
        <div className="state-panel">
          尚未配置OTA来源。新增后填写JSON数据接口及Cookie；后台登录网址可选。
        </div>
      ) : null}

      {canConfigure ? (
        <div className="report-source-actions">
          <button
            className="secondary"
            disabled={saving}
            type="button"
              onClick={() => {
                const source = emptyOtaSource()
                setSources((current) => [...current, source])
                setPortalUrlEnabled((current) => ({
                  ...current,
                  [source.sourceId]: false,
                }))
              }}
          >
            新增OTA数据源
          </button>
          <button
            disabled={saving || sources.length === 0}
            type="button"
            onClick={() => void save()}
          >
            {saving ? '保存并采集中…' : '保存并自动采集一次'}
          </button>
        </div>
      ) : null}
    </section>
  )
}
