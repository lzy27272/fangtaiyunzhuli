import { useEffect, useMemo, useState } from 'react'
import {
  loadOtaControlledLogins,
  loadOtaSources,
  refreshOtaSource,
  saveOtaSources,
  startOtaControlledLogin,
  submitOtaControlledLoginVerification,
  type HotelContext,
  type OtaControlledLoginProfile,
  type OtaControlledLoginResult,
  type OtaCredentialUpdate,
  type OtaCookieUpdate,
  type OtaPlatformCode,
  type OtaSourceInput,
  type OtaSourceView,
} from '../api/business'
import { businessCodeLabel, businessErrorMessage } from '../ui/businessDisplay'
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

type OtaSourceKind = 'ORDER' | 'REVIEW' | 'RANK' | 'OTHER'

const SOURCE_KIND_LABELS: Record<OtaSourceKind, string> = {
  ORDER: '订单',
  REVIEW: '评价',
  RANK: '排名',
  OTHER: '其他数据',
}

const SOURCE_KIND_ORDER: Record<OtaSourceKind, number> = {
  ORDER: 0,
  REVIEW: 1,
  RANK: 2,
  OTHER: 3,
}

const otaSourceKind = (source: OtaSourceView): OtaSourceKind => {
  if (source.lastSummary?.peerRanking) return 'RANK'
  if (
    source.lastSummary?.reviewMetrics
    || source.lastSummary?.providerDataset?.dataset === 'REVIEW'
  ) return 'REVIEW'
  if (source.lastSummary?.providerDataset?.dataset === 'ORDER') return 'ORDER'
  const text = `${source.displayName} ${source.dataEndpointUrl}`.toLowerCase()
  if (/rank|ranking|排名/.test(text)) return 'RANK'
  if (/review|comment|evaluate|evaluation|评价|点评/.test(text)) return 'REVIEW'
  if (/order|booking|订单/.test(text)) return 'ORDER'
  return 'OTHER'
}

const hasBuiltInReadOnlyEndpoint = (source: OtaSourceView): boolean =>
  source.platformCode === 'FLIGGY'
  && ['ORDER', 'REVIEW'].includes(otaSourceKind(source))

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

const CONTROLLED_LOGIN_STATUS_LABELS: Record<string, string> = {
  NEVER: '尚未使用账号登录',
  RUNNING: '登录处理中',
  AUTHENTICATED: '会话有效',
  VERIFICATION_REQUIRED: '等待一次性验证码',
  EXTERNAL_VERIFICATION_REQUIRED: '需要滑块或扫码验证',
  FAILED: '登录失败',
  RATE_LIMITED: '已触发安全限次',
}

const CONTROLLED_LOGIN_ERROR_LABELS: Record<string, string> = {
  OTA_FLIGGY_USERNAME_FORM_UNAVAILABLE: '未检测到飞猪官方账号输入页。',
  OTA_FLIGGY_PASSWORD_FORM_UNAVAILABLE:
    '账号提交后未进入密码页；当前账号可能不适用密码登录。',
  OTA_FLIGGY_LOGIN_CONFIRMATION_UNAVAILABLE:
    '密码已提交，但飞猪未建立有效后台会话；可能要求二次验证或拒绝当前登录方式。',
  OTA_FLIGGY_CREDENTIALS_REJECTED: '账号或密码被飞猪拒绝，请核对后再试。',
  OTA_FLIGGY_ACCOUNT_LOCKED: '飞猪限制了当前账号登录，请稍后按官方提示处理。',
  OTA_FLIGGY_CODE_VERIFICATION_REQUIRED: '飞猪要求提交一次性验证码。',
  OTA_FLIGGY_SLIDER_VERIFICATION_REQUIRED: '飞猪要求完成滑块验证。',
  OTA_FLIGGY_QR_VERIFICATION_REQUIRED: '飞猪要求扫码确认登录。',
  OTA_FLIGGY_EXTERNAL_VERIFICATION_REQUIRED: '飞猪要求完成额外身份验证。',
}

const SENSITIVE_QUERY_KEY =
  /(?:token|cookie|password|passwd|secret|session|authorization|api[_-]?key|sign(?:ature)?)/i

const FLIGGY_EPHEMERAL_QUERY_KEYS = new Set([
  't',
  'sign',
  'bx-ua',
  'bx-umidtoken',
])

const normalizeDataEndpointUrl = (value: string): string => {
  const trimmed = value.trim()
  if (!trimmed) return ''
  try {
    const url = new URL(trimmed)
    if (url.hostname.toLowerCase() === 'h5api.m.fliggy.com') {
      for (const key of [...url.searchParams.keys()]) {
        if (FLIGGY_EPHEMERAL_QUERY_KEYS.has(key.toLowerCase())) {
          url.searchParams.delete(key)
        }
      }
    }
    return url.toString()
  } catch {
    return trimmed
  }
}

const validateUrl = (value: string): string | null => {
  let url
  try {
    url = new URL(normalizeDataEndpointUrl(value))
  } catch {
    return '必须填写完整的安全网址。'
  }
  if (url.protocol !== 'https:') return '只允许以 https 开头的安全网址。'
  if (url.username || url.password) return '网址中不能包含账号或密码。'
  if (url.hash) return '网址中不能包含片段标识。'
  if ([...url.searchParams.keys()].some((key) =>
    SENSITIVE_QUERY_KEY.test(key)
    && !(
      url.hostname.toLowerCase() === 'h5api.m.fliggy.com'
      && key.toLowerCase() === 'appkey'
    ))) {
    return '网址中不能包含访问令牌、登录凭据、密码或签名。'
  }
  return null
}

const emptyOtaSource = (
  platformCode: OtaPlatformCode = 'CTRIP',
): OtaSourceView => ({
  sourceId: globalThis.crypto.randomUUID(),
  displayName: '',
  platformCode,
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
  const [persistedSourceVersions, setPersistedSourceVersions] =
    useState<Record<string, number>>({})
  const [controlledLogins, setControlledLogins] =
    useState<OtaControlledLoginProfile[]>([])
  const [controlledLoginResult, setControlledLoginResult] =
    useState<OtaControlledLoginResult | null>(null)
  const [verificationAnswer, setVerificationAnswer] = useState('')
  const [loggingInPlatform, setLoggingInPlatform] =
    useState<OtaPlatformCode | null>(null)
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
  const [expandedSourceIds, setExpandedSourceIds] =
    useState<Record<string, boolean>>({})
  const [expandedPlatformCodes, setExpandedPlatformCodes] =
    useState<Partial<Record<OtaPlatformCode, boolean>>>({})
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [refreshingId, setRefreshingId] = useState<string | null>(null)
  const [dirtySourceIds, setDirtySourceIds] =
    useState<Record<string, boolean>>({})
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const reload = async () => {
    const [rows, loginProfiles] = await Promise.all([
      loadOtaSources(context),
      loadOtaControlledLogins(context),
    ])
    setSources(rows)
    setPersistedSourceVersions(Object.fromEntries(
      rows.map((source) => [source.sourceId, source.rowVersion]),
    ))
    setControlledLogins(loginProfiles)
    setPortalUrlEnabled(Object.fromEntries(
      rows.map((source) => [source.sourceId, Boolean(source.portalUrl)]),
    ))
    setExpandedSourceIds(Object.fromEntries(
      rows.map((source) => [
        source.sourceId,
        source.rowVersion === 0
          || attentionSourceId === source.sourceId,
      ]),
    ))
    expandPlatformForRows(rows)
    return rows
  }

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError('')
    setNotice('')
    Promise.all([
      loadOtaSources(context),
      loadOtaControlledLogins(context),
    ])
      .then(([rows, loginProfiles]) => {
        if (!cancelled) {
          setSources(rows)
          setPersistedSourceVersions(Object.fromEntries(
            rows.map((source) => [source.sourceId, source.rowVersion]),
          ))
          setControlledLogins(loginProfiles)
          setControlledLoginResult(null)
          setVerificationAnswer('')
          setCookieDrafts({})
          setAccountDrafts({})
          setPasswordDrafts({})
          setClearCookies({})
          setClearCredentials({})
          setDirtySourceIds({})
          setPortalUrlEnabled(Object.fromEntries(
            rows.map((source) => [source.sourceId, Boolean(source.portalUrl)]),
          ))
          setExpandedSourceIds(Object.fromEntries(
            rows.map((source) => [
              source.sourceId,
              source.rowVersion === 0
                || attentionSourceId === source.sourceId,
            ]),
          ))
          expandPlatformForRows(rows)
        }
      })
      .catch((cause) => {
        if (!cancelled) {
          setError(businessErrorMessage(cause, '读取渠道配置失败'))
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
    if (attentionSourceId) {
      const attentionSource = sources.find(
        (source) => source.sourceId === attentionSourceId,
      )
      if (attentionSource) {
        setExpandedPlatformCodes((current) => ({
          ...current,
          [attentionSource.platformCode]: true,
        }))
      }
      setExpandedSourceIds((current) => ({
        ...current,
        [attentionSourceId]: true,
      }))
    }
    const frame = window.requestAnimationFrame(() => {
      const target = attentionSourceId
        ? document.getElementById(otaCardId(attentionSourceId))
        : document.getElementById('ota-source-config-panel')
      target?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      target?.focus({ preventScroll: true })
    })
    return () => window.cancelAnimationFrame(frame)
  }, [attentionSourceId, loading, sources.length])

  useEffect(() => {
    const nextAttemptAt = controlledLogins
      .filter((profile) => profile.status === 'RATE_LIMITED')
      .map((profile) => new Date(profile.nextAttemptAt ?? '').getTime())
      .filter(Number.isFinite)
      .sort((left, right) => left - right)[0]
    if (!Number.isFinite(nextAttemptAt)) return
    const timer = window.setTimeout(() => {
      void loadOtaControlledLogins(context)
        .then(setControlledLogins)
        .catch(() => undefined)
    }, Math.max(1_000, nextAttemptAt - Date.now() + 1_000))
    return () => window.clearTimeout(timer)
  }, [context, controlledLogins])

  const enabledCount = useMemo(
    () => sources.filter((source) => source.enabled).length,
    [sources],
  )

  const platformGroups = useMemo(() =>
    (Object.entries(PLATFORM_LABELS) as Array<[OtaPlatformCode, string]>)
      .map(([platformCode, label]) => ({
        platformCode,
        label,
        sources: sources
          .filter((source) => source.platformCode === platformCode)
          .sort((left, right) =>
            SOURCE_KIND_ORDER[otaSourceKind(left)]
            - SOURCE_KIND_ORDER[otaSourceKind(right)]),
      }))
      .filter((group) => group.sources.length > 0),
  [sources])

  const expandPlatformForRows = (rows: OtaSourceView[]) => {
    const next: Partial<Record<OtaPlatformCode, boolean>> = {}
    for (const source of rows) {
      if (
        source.rowVersion === 0
        || attentionSourceId === source.sourceId
      ) next[source.platformCode] = true
    }
    setExpandedPlatformCodes(next)
  }

  const updateSource = (
    sourceId: string,
    patch: Partial<OtaSourceView>,
  ) => {
    setSources((current) => current.map((source) =>
      source.sourceId === sourceId ? { ...source, ...patch } : source))
    setDirtySourceIds((current) => ({ ...current, [sourceId]: true }))
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
      if (source.dataEndpointUrl.trim()) {
        const endpointError = validateUrl(source.dataEndpointUrl)
        if (endpointError) return `${source.displayName || 'OTA来源'}数据接口：${endpointError}`
      }
      if (source.requestMethod === 'GET' && source.requestPayloadJson.trim()) {
        return `${source.displayName}使用读取方式时不能填写提交内容。`
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
            return `${source.displayName}的提交内容格式不正确。`
          }
        } catch {
          return `${source.displayName}的提交内容格式不正确。`
        }
      }
      const cookie = cookieDrafts[source.sourceId] ?? ''
      if (
        /[\r\n\u0000]/.test(cookie)
        || /^\s*cookie\s*:/i.test(cookie)
        || (cookie.length > 0 && !cookie.trim())
      ) {
        return `${source.displayName}的登录凭据格式无效。`
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
      dataEndpointUrl: normalizeDataEndpointUrl(source.dataEndpointUrl),
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
      const sourceIdsToRefresh = new Set(
        sources
          .filter((source) =>
            source.rowVersion === 0
            || dirtySourceIds[source.sourceId]
            || Boolean((cookieDrafts[source.sourceId] ?? '').trim()))
          .map((source) => source.sourceId),
      )
      const saved = await saveOtaSources(
        context,
        sources.map(inputFor),
        Object.entries(persistedSourceVersions)
          .filter(([sourceId]) => !sources.some(
            (source) => source.sourceId === sourceId,
          ))
          .map(([sourceId, expectedRowVersion]) => ({
            sourceId,
            expectedRowVersion,
          })),
      )
      setSources(saved)
      setPersistedSourceVersions(Object.fromEntries(
        saved.map((source) => [source.sourceId, source.rowVersion]),
      ))
      setPortalUrlEnabled(Object.fromEntries(
        saved.map((source) => [source.sourceId, Boolean(source.portalUrl)]),
      ))
      setExpandedSourceIds(Object.fromEntries(
        saved.map((source) => [
          source.sourceId,
          attentionSourceId === source.sourceId,
        ]),
      ))
      expandPlatformForRows(saved)
      setCookieDrafts({})
      setAccountDrafts({})
      setPasswordDrafts({})
      setClearCookies({})
      setClearCredentials({})
      setDirtySourceIds({})
      const refreshTargets = saved.filter(
        (source) =>
          sourceIdsToRefresh.has(source.sourceId)
          && source.enabled
          && source.cookieConfigured
          && (
            Boolean(source.dataEndpointUrl)
            || hasBuiltInReadOnlyEndpoint(source)
          ),
      )
      if (refreshTargets.length === 0) {
        setNotice(
          'OTA配置已保存；本次没有需要立即刷新的已启用数据源。',
        )
        onStatusChanged?.()
        return
      }
      setNotice(
        `OTA配置已保存；正在后台刷新本次改动的${refreshTargets.length}个数据源，`
        + '无需等待整店其他渠道采集。',
      )
      void refreshAfterSave(refreshTargets)
      onStatusChanged?.()
    } catch (cause) {
      setError(businessErrorMessage(cause, '保存渠道配置失败'))
    } finally {
      setSaving(false)
    }
  }

  async function refreshAfterSave(targets: OtaSourceView[]) {
    let completed = 0
    let failed = 0
    const targetIds = new Set(targets.map((source) => source.sourceId))
    for (const source of targets) {
      setRefreshingId(source.sourceId)
      try {
        const refreshed = await refreshOtaSource(context, source.sourceId)
        setSources((current) => current.map((candidate) =>
          candidate.sourceId === refreshed.sourceId ? refreshed : candidate))
        completed += 1
      } catch {
        failed += 1
      }
    }
    if (failed > 0) {
      try {
        const latest = await loadOtaSources(context)
        setSources((current) => current.map((source) => {
          if (!targetIds.has(source.sourceId)) return source
          return latest.find((candidate) =>
            candidate.sourceId === source.sourceId) ?? source
        }))
      } catch {
        // The saved configuration remains valid even if status reload fails.
      }
    }
    setRefreshingId(null)
    setNotice(
      `OTA配置已保存；本次改动数据源刷新完成：${completed}个完成，`
      + `${failed}个需要核对。`,
    )
    if (failed > 0) {
      setError('部分本次改动的数据源刷新失败，请根据来源卡片中的错误原因核对；其他渠道未被重复采集。')
    }
    onStatusChanged?.()
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
      setError(businessErrorMessage(cause, '渠道数据刷新失败'))
    } finally {
      setRefreshingId(null)
      onStatusChanged?.()
    }
  }

  const mergeControlledLoginResult = (result: OtaControlledLoginResult) => {
    setControlledLoginResult(result)
    if (result.profile) {
      setControlledLogins((current) => [
        ...current.filter((profile) =>
          profile.platformCode !== result.profile?.platformCode),
        result.profile as OtaControlledLoginProfile,
      ])
    }
    if (result.refreshedSources.length > 0) {
      setSources((current) => current.map((source) =>
        result.refreshedSources.find((updated) =>
          updated.sourceId === source.sourceId) ?? source))
    }
  }

  const controlledLoginRefreshNotice = (result: OtaControlledLoginResult) => {
    const failed = result.refreshedSources.filter((source) =>
      source.lastRefreshStatus === 'FAILED')
    const complete = result.refreshedSources.length - failed.length
    return failed.length > 0
      ? `飞猪会话已更新；${complete}个数据源刷新成功，${failed.length}个失败，请查看失败卡片错误码。`
      : `飞猪会话已安全更新，并刷新${complete}个已启用数据源。`
  }

  async function loginAndRefreshFliggy() {
    if (!canConfigure) return
    setLoggingInPlatform('FLIGGY')
    setError('')
    setNotice('正在通过飞猪官方登录页建立受控会话，请勿重复提交。')
    setControlledLoginResult(null)
    setVerificationAnswer('')
    try {
      const result = await startOtaControlledLogin(context, 'FLIGGY')
      mergeControlledLoginResult(result)
      if (result.status === 'AUTHENTICATED') {
        setNotice(controlledLoginRefreshNotice(result))
      } else if (result.status === 'VERIFICATION_REQUIRED') {
        setNotice('飞猪要求一次性验证码；请在10分钟内完成，最多提交3次。')
      } else {
        setNotice('飞猪要求滑块或扫码等外部验证；本次已安全停止，请改用官网登录修复。')
      }
    } catch (cause) {
      await reload().catch(() => undefined)
      setError(businessErrorMessage(cause, '飞猪登录失败'))
      setNotice('')
    } finally {
      setLoggingInPlatform(null)
      onStatusChanged?.()
    }
  }

  async function submitFliggyVerification() {
    const attemptId = controlledLoginResult?.attemptId
    if (!attemptId || !/^[A-Za-z0-9]{4,8}$/.test(verificationAnswer)) {
      setError('请输入页面当前显示的4至8位验证码。')
      return
    }
    setLoggingInPlatform('FLIGGY')
    setError('')
    setNotice('正在提交一次性验证码…')
    try {
      const result = await submitOtaControlledLoginVerification(
        context,
        'FLIGGY',
        attemptId,
        verificationAnswer,
      )
      setVerificationAnswer('')
      mergeControlledLoginResult(result)
      if (result.status === 'AUTHENTICATED') {
        setNotice(controlledLoginRefreshNotice(result))
      } else {
        setNotice('验证码尚未通过，请核对页面当前验证码后重试。')
      }
    } catch (cause) {
      await reload().catch(() => undefined)
      setError(businessErrorMessage(cause, '验证码提交失败'))
      setNotice('')
    } finally {
      setLoggingInPlatform(null)
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
          <p className="eyebrow">渠道数据来源</p>
          <h3>OTA后台与数据接口</h3>
          <p>
            每个门店可配置多个渠道来源。登录凭据和账号密码分别加密保存且不回显；
            后台登录网址和数据接口均为可选补充项。已保存来源默认收起；
            补充接口后只进行只读采集，不会自动调价或修改库存。
          </p>
        </div>
        <span className="mode-chip">
          {enabledCount}/{sources.length} 已启用
        </span>
      </div>

      <div className="security-note report-source-note">
        飞猪账号密码仅在管理员主动点击“账号登录并刷新”后提交给飞猪官方登录页，
        登录会话按数据接口域名隔离后加密保存且不回显；首次成功后才允许会话失效时
        自动续期。验证码最多3次、10分钟有效，滑块或扫码不会自动绕过。
        其他渠道仍使用加密登录凭据只读采集。
      </div>

      {loading ? <div className="state-panel">正在读取OTA配置…</div> : null}
      {error ? <div className="error" role="alert">{error}</div> : null}
      {notice ? <div className="success" role="status">{notice}</div> : null}

      <div className="ota-platform-list">
        {platformGroups.map((group) => {
          const platformExpanded = expandedPlatformCodes[group.platformCode]
            ?? group.sources.some((source) =>
              source.rowVersion === 0
              || attentionSourceId === source.sourceId)
          const kinds = [...new Set(group.sources.map(otaSourceKind))]
            .sort((left, right) =>
              SOURCE_KIND_ORDER[left] - SOURCE_KIND_ORDER[right])
          const controlledLogin = controlledLogins.find((profile) =>
            profile.platformCode === group.platformCode)
          return (
            <section className="ota-platform-group" key={group.platformCode}>
              <button
                aria-expanded={platformExpanded}
                className="ota-platform-menu"
                type="button"
                onClick={() =>
                  setExpandedPlatformCodes((current) => ({
                    ...current,
                    [group.platformCode]: !platformExpanded,
                  }))}
              >
                <div>
                  <strong>{group.label}</strong>
                  <small>{group.sources.length} 个数据源</small>
                </div>
                <span className="ota-platform-kinds">
                  {kinds.map((kind) => (
                    <b key={kind}>{SOURCE_KIND_LABELS[kind]}</b>
                  ))}
                </span>
                <b>{platformExpanded ? '收起' : '展开'}</b>
              </button>

              {platformExpanded ? (
                <div className="ota-platform-content">
                  {group.platformCode === 'FLIGGY' && controlledLogin ? (
                    <div className="ota-controlled-login-panel">
                      <div>
                        <strong>飞猪账号受控登录</strong>
                        <span>
                          {CONTROLLED_LOGIN_STATUS_LABELS[
                            controlledLogin.status
                          ] ?? businessCodeLabel(controlledLogin.status)}
                        </span>
                        <small>
                          账号密码已配置 {controlledLogin.credentialSourceCount}
                          个数据源；会话覆盖 {controlledLogin.sessionSourceCount}
                          个数据源；自动续期
                          {controlledLogin.autoRenewEnabled ? '已启用' : '尚未启用'}。
                        </small>
                        {controlledLogin.lastAuthenticatedAt ? (
                          <small>
                            最近成功：
                            {new Date(
                              controlledLogin.lastAuthenticatedAt,
                            ).toLocaleString('zh-CN')}
                          </small>
                        ) : null}
                        {controlledLogin.status === 'RATE_LIMITED'
                          && controlledLogin.nextAttemptAt ? (
                            <small>
                              已达到 {controlledLogin.maxAttempts} 次安全上限；将在
                              {' '}
                              {new Date(
                                controlledLogin.nextAttemptAt,
                              ).toLocaleString('zh-CN')}
                              {' '}
                              自动解锁，请勿重复提交。
                            </small>
                          ) : null}
                        {controlledLogin.lastErrorCode ? (
                          <>
                            {CONTROLLED_LOGIN_ERROR_LABELS[
                              controlledLogin.lastErrorCode
                            ] ? (
                              <small>
                                {CONTROLLED_LOGIN_ERROR_LABELS[
                                  controlledLogin.lastErrorCode
                                ]}
                              </small>
                            ) : null}
                            <details className="technical-details"><summary>查看错误编号</summary><code>{controlledLogin.lastErrorCode}</code></details>
                          </>
                        ) : null}
                      </div>
                      <button
                        className="secondary"
                        disabled={
                          !canConfigure
                          || loggingInPlatform !== null
                          || !controlledLogin.credentialsConfigured
                          || controlledLogin.status === 'RATE_LIMITED'
                          || controlledLogin.challengeActive
                        }
                        type="button"
                        onClick={() => void loginAndRefreshFliggy()}
                      >
                        {loggingInPlatform === 'FLIGGY'
                          ? '登录处理中…'
                          : '账号登录并刷新'}
                      </button>
                    </div>
                  ) : null}
                  {group.platformCode === 'FLIGGY'
                    && controlledLoginResult?.status
                      === 'VERIFICATION_REQUIRED'
                    && controlledLoginResult.attemptId ? (
                    <div className="ota-controlled-verification" role="group">
                      <div>
                        <strong>完成一次性验证码</strong>
                        <small>仅填写当前页面验证码，不要填写账号、密码或其他登录凭据。</small>
                      </div>
                      {controlledLoginResult.captchaImageDataUrl ? (
                        <img
                          alt="飞猪登录验证码"
                          src={controlledLoginResult.captchaImageDataUrl}
                        />
                      ) : null}
                      <input
                        autoComplete="one-time-code"
                        disabled={loggingInPlatform !== null}
                        maxLength={8}
                        placeholder="4至8位验证码"
                        value={verificationAnswer}
                        onChange={(event) =>
                          setVerificationAnswer(event.target.value.trim())}
                      />
                      <button
                        disabled={
                          loggingInPlatform !== null
                          || !/^[A-Za-z0-9]{4,8}$/.test(verificationAnswer)
                        }
                        type="button"
                        onClick={() => void submitFliggyVerification()}
                      >
                        提交验证码
                      </button>
                    </div>
                  ) : null}
                  <div className="ota-source-list">
        {group.sources.map((source) => {
          const index = sources.findIndex(
            (candidate) => candidate.sourceId === source.sourceId,
          )
          const guidance = source.lastRefreshStatus === 'FAILED'
            ? otaSourceGuidance(source.lastErrorCode)
            : null
          const highlighted =
            attentionSourceId === source.sourceId
            || source.lastRefreshStatus === 'FAILED'
          const expanded = expandedSourceIds[source.sourceId]
            ?? (
              source.rowVersion === 0
              || attentionSourceId === source.sourceId
            )
          return (
            <article
              className={`ota-source-card ${highlighted ? 'needs-attention' : ''} ${
                expanded ? 'is-expanded' : 'is-collapsed'
              }`}
              id={otaCardId(source.sourceId)}
              key={source.sourceId}
              tabIndex={-1}
            >
              <header>
                <div>
                  {expanded ? (
                    <span>OTA {String(index + 1).padStart(2, '0')}</span>
                  ) : null}
                  <strong>{source.displayName || '未命名OTA来源'}</strong>
                  <small>
                    {SOURCE_KIND_LABELS[otaSourceKind(source)]}
                    {' · '}{source.enabled ? '已启用' : '已停用'}
                  </small>
                </div>
                <div className="ota-card-header-actions">
                  {expanded ? (
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
                  ) : null}
                  <button
                    aria-expanded={expanded}
                    className="secondary ota-expand-button"
                    type="button"
                    onClick={() =>
                      setExpandedSourceIds((current) => ({
                        ...current,
                        [source.sourceId]: !expanded,
                      }))}
                  >
                    {expanded ? '收起' : '展开'}
                  </button>
                </div>
              </header>

              {expanded ? <>
              {guidance ? (
                <div className="report-source-card-attention" role="alert">
                  <strong>{guidance.reason}</strong>
                  <span>
                    需核对：{guidance.fields.join('、')}。{guidance.action}
                  </span>
                  {source.lastErrorCode ? <details className="technical-details"><summary>查看错误编号</summary><code>{source.lastErrorCode}</code></details> : null}
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
                    onChange={(event) => {
                      const platformCode = event.target.value as OtaPlatformCode
                      updateSource(source.sourceId, { platformCode })
                      setExpandedPlatformCodes((current) => ({
                        ...current,
                        [platformCode]: true,
                      }))
                    }}
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
                  渠道数据接口地址（可选）
                  <input
                    disabled={!canConfigure}
                    placeholder="可补充填写：https://.../api/..."
                    value={source.dataEndpointUrl}
                    onChange={(event) =>
                      updateSource(source.sourceId, {
                        dataEndpointUrl: event.target.value,
                      })}
                  />
                  {source.dataEndpointUrl && validateUrl(source.dataEndpointUrl)
                    ? <small className="field-error">{validateUrl(source.dataEndpointUrl)}</small>
                    : null}
                  {!source.dataEndpointUrl ? (
                    <small>未填写时仅保存OTA渠道资料，不参与自动轮询。</small>
                  ) : null}
                  {source.platformCode === 'FLIGGY' ? (
                    <small>
                      飞猪接口中的临时 t、sign、bx-ua 和 bx-umidtoken
                      会在保存时自动移除，采集时使用已加密登录凭据重新生成短效签名。
                    </small>
                  ) : null}
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
                    <option value="GET">读取数据</option>
                    <option value="POST">提交请求</option>
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
                    提交内容
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
                  渠道登录凭据
                  <input
                    autoComplete="off"
                    disabled={!canConfigure || clearCookies[source.sourceId]}
                    maxLength={16 * 1024}
                    placeholder={
                      source.cookieConfigured
                        ? '已加密配置；留空表示保持不变'
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
                        setClearCookies((current) => ({
                          ...current,
                          [source.sourceId]: false,
                        }))
                      }
                    }}
                  />
                  <small>
                    {source.cookieConfigured ? '登录凭据已加密保存且不会回显' : '立即刷新前必须配置'}
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
                        : source.platformCode === 'FLIGGY'
                          ? '用于飞猪官方受控登录'
                          : '暂仅加密保存'
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
                        : source.platformCode === 'FLIGGY'
                          ? '用于飞猪官方受控登录'
                          : '暂仅加密保存'
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
                    保存时清除该渠道登录凭据
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
                  刷新状态｜{businessCodeLabel(source.lastRefreshStatus, '尚未刷新')}
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
                        .map((code) => DIMENSION_LABELS[code] ?? '其他指标')
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
                      || (
                        !source.dataEndpointUrl
                        && !hasBuiltInReadOnlyEndpoint(source)
                      )
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
              </> : null}
            </article>
          )
        })}
                  </div>
                  {canConfigure ? (
                    <button
                      className="secondary ota-platform-add-source"
                      disabled={saving}
                      type="button"
                      onClick={() => {
                        const source = emptyOtaSource(group.platformCode)
                        setSources((current) => [...current, source])
                        setPortalUrlEnabled((current) => ({
                          ...current,
                          [source.sourceId]: false,
                        }))
                        setExpandedSourceIds((current) => ({
                          ...current,
                          [source.sourceId]: true,
                        }))
                      }}
                    >
                      新增{group.label}数据源
                    </button>
                  ) : null}
                </div>
              ) : null}
            </section>
          )
        })}
      </div>

      {sources.length === 0 && !loading ? (
        <div className="state-panel">
          尚未配置OTA来源。新增后先选择OTA平台并填写来源名称；
          后台登录网址、数据接口及登录凭据均可按需补充。
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
                setExpandedSourceIds((current) => ({
                  ...current,
                  [source.sourceId]: true,
                }))
                setExpandedPlatformCodes((current) => ({
                  ...current,
                  [source.platformCode]: true,
                }))
              }}
          >
            新增OTA渠道
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
