import { useCallback, useEffect, useRef, useState } from 'react'
import {
  loadWeComRepairBotConfig,
  saveWeComRepairBotConfig,
  startWeComRepairBotPairing,
  type HotelContext,
  type WeComRepairBotConfigView,
  type WeComRepairBotPairingView,
} from '../api/business'
import { businessErrorMessage } from '../ui/businessDisplay'
import { WeComRepairAdminsPanel } from './WeComRepairAdminsPanel'

interface Props {
  canConfigure: boolean
  context: HotelContext | null
}

const contextKeyFor = (context: HotelContext | null) => context
  ? `${context.tenantId}:${context.hotelId}`
  : null

const configForHotel = (
  config: WeComRepairBotConfigView,
  hotelId: string,
): WeComRepairBotConfigView => {
  const hotelBindings = config.hotelBindings.filter(
    (binding) => binding.hotelId === hotelId,
  )
  const pairingMatchesHotel = config.pairing.active
    && config.pairing.scope?.type === 'HOTEL'
    && config.pairing.scope.hotelId === hotelId
  return {
    ...config,
    hotelPairedUserCount: hotelBindings[0]?.pairedUserCount ?? 0,
    hotelBindings,
    pairing: pairingMatchesHotel
      ? config.pairing
      : { active: false, expiresAt: null, attemptsRemaining: 0 },
  }
}

const connectionLabel = (config: WeComRepairBotConfigView | null) => {
  if (!config) return '正在读取'
  if (config.connected && config.connectionStatus === 'AUTHENTICATED') {
    return '长连接已认证'
  }
  const labels: Record<string, string> = {
    DISABLED: '未启用',
    STARTING: '正在启动',
    NOT_CONFIGURED: '未配置凭据',
    CONNECTING: '正在连接',
    DISCONNECTED: '连接已断开，自动重连中',
    ERROR: '连接异常',
  }
  return labels[config.connectionStatus] ?? config.connectionStatus
}

export function WeComRepairBotConfigPanel({ canConfigure, context }: Props) {
  const [config, setConfig] = useState<WeComRepairBotConfigView | null>(null)
  const [enabled, setEnabled] = useState(false)
  const [allowGlobalRepairActions, setAllowGlobalRepairActions] = useState(false)
  const [botId, setBotId] = useState('')
  const [secret, setSecret] = useState('')
  const [clearCredentials, setClearCredentials] = useState(false)
  const [pairing, setPairing] = useState<WeComRepairBotPairingView | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [pairingLoading, setPairingLoading] = useState(false)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const [loadedContextKey, setLoadedContextKey] = useState<string | null>(null)
  const formDirtyRef = useRef(false)
  const requestSequenceRef = useRef(0)
  const pairingSequenceRef = useRef(0)
  const loadingRef = useRef(true)
  const savingRef = useRef(false)
  const mountedRef = useRef(true)
  const contextRef = useRef(context)
  contextRef.current = context
  const contextKey = contextKeyFor(context)
  const configLoaded = Boolean(
    contextKey && config && loadedContextKey === contextKey,
  )

  const refresh = useCallback(async (quiet = false) => {
    if (quiet && (loadingRef.current || savingRef.current)) return
    const activeContext = contextRef.current
    const activeContextKey = contextKeyFor(activeContext)
    const requestSequence = ++requestSequenceRef.current
    if (!activeContext || !activeContextKey) {
      setConfig(null)
      setLoadedContextKey(null)
      setEnabled(false)
      setAllowGlobalRepairActions(false)
      setPairing(null)
      if (!quiet) {
        loadingRef.current = false
        setLoading(false)
        setError('')
      }
      return
    }
    if (!quiet) {
      loadingRef.current = true
      setLoading(true)
      setLoadedContextKey(null)
    }
    try {
      const next = await loadWeComRepairBotConfig(activeContext)
      if (
        requestSequence !== requestSequenceRef.current
        || activeContextKey !== contextKeyFor(contextRef.current)
      ) return
      setConfig((current) => (
        quiet && formDirtyRef.current && current
          ? { ...next, rowVersion: current.rowVersion }
          : next
      ))
      setLoadedContextKey(activeContextKey)
      if (!quiet || !formDirtyRef.current) {
        setEnabled(next.enabled)
        setAllowGlobalRepairActions(next.allowGlobalRepairActions)
      }
      if (!quiet) {
        formDirtyRef.current = false
        setError('')
      }
      if (!next.pairing.active) setPairing(null)
    } catch (cause) {
      if (
        !quiet
        && requestSequence === requestSequenceRef.current
        && activeContextKey === contextKeyFor(contextRef.current)
      ) {
        setLoadedContextKey(null)
        setError(businessErrorMessage(cause, '读取机器人配置失败'))
      }
    } finally {
      if (
        !quiet
        && requestSequence === requestSequenceRef.current
        && activeContextKey === contextKeyFor(contextRef.current)
      ) {
        loadingRef.current = false
        setLoading(false)
      }
    }
  }, [])

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      requestSequenceRef.current += 1
      pairingSequenceRef.current += 1
    }
  }, [])

  useEffect(() => {
    requestSequenceRef.current += 1
    pairingSequenceRef.current += 1
    formDirtyRef.current = false
    setConfig(null)
    setLoadedContextKey(null)
    setEnabled(false)
    setAllowGlobalRepairActions(false)
    setBotId('')
    setSecret('')
    setClearCredentials(false)
    setPairing(null)
    setPairingLoading(false)
    setNotice('')
    setError('')
    void refresh()
    const timer = window.setInterval(() => void refresh(true), 5_000)
    return () => {
      window.clearInterval(timer)
      requestSequenceRef.current += 1
      pairingSequenceRef.current += 1
    }
  }, [contextKey, refresh])

  async function save() {
    const activeContext = contextRef.current
    const activeContextKey = contextKeyFor(activeContext)
    const currentConfig = config
    if (
      !activeContext
      || !activeContextKey
      || loadedContextKey !== activeContextKey
      || !currentConfig
    ) {
      setError('机器人配置尚未完成加载，请稍后重试。')
      return
    }
    const replacing = botId.trim().length > 0 || secret.length > 0
    if (replacing && (!botId.trim() || !secret)) {
      setError('更换凭据时，机器人编号和通信密钥必须同时填写。')
      return
    }
    savingRef.current = true
    setSaving(true)
    setError('')
    setNotice('')
    const requestSequence = ++requestSequenceRef.current
    try {
      const credentialUpdate = replacing
        ? {
          action: 'REPLACE' as const,
          botId: botId.trim(),
          secret,
        }
        : clearCredentials
          ? { action: 'CLEAR' as const }
          : { action: 'KEEP' as const }
      const next = await saveWeComRepairBotConfig(
        clearCredentials ? false : enabled,
        clearCredentials ? false : allowGlobalRepairActions,
        credentialUpdate,
        currentConfig.rowVersion,
      )
      if (
        requestSequence !== requestSequenceRef.current
        || activeContextKey !== contextKeyFor(contextRef.current)
      ) return
      setConfig(configForHotel(next, activeContext.hotelId))
      setLoadedContextKey(activeContextKey)
      setEnabled(next.enabled)
      setAllowGlobalRepairActions(next.allowGlobalRepairActions)
      setBotId('')
      setSecret('')
      setClearCredentials(false)
      setPairing(null)
      formDirtyRef.current = false
      setNotice(
        next.enabled
          ? '配置已加密保存，服务器正在建立企业微信长连接。'
          : '智能机器人修复通道当前未启用。',
      )
    } catch (cause) {
      if (
        mountedRef.current
        && activeContextKey === contextKeyFor(contextRef.current)
      ) {
        const message = businessErrorMessage(cause, '保存机器人配置失败')
        if (
          cause instanceof Error
          && cause.message === 'WECOM_REPAIR_BOT_CONFIG_VERSION_CONFLICT'
        ) {
          savingRef.current = false
          formDirtyRef.current = false
          setBotId('')
          setSecret('')
          setClearCredentials(false)
          await refresh(true)
        }
        if (
          mountedRef.current
          && activeContextKey === contextKeyFor(contextRef.current)
        ) setError(message)
      }
    } finally {
      savingRef.current = false
      if (!mountedRef.current) return
      setSaving(false)
      const latestContextKey = contextKeyFor(contextRef.current)
      if (latestContextKey && latestContextKey !== activeContextKey) {
        void refresh()
      }
    }
  }

  async function createPairingCode() {
    const activeContext = contextRef.current
    const activeContextKey = contextKeyFor(activeContext)
    if (!activeContext || !activeContextKey) {
      setError('当前门店尚未载入，无法新增修复管理员。')
      return
    }
    const requestSequence = ++pairingSequenceRef.current
    setPairingLoading(true)
    setError('')
    setNotice('')
    try {
      const next = await startWeComRepairBotPairing(activeContext)
      if (
        requestSequence !== pairingSequenceRef.current
        || activeContextKey !== contextKeyFor(contextRef.current)
      ) return
      setPairing(next)
      setNotice(
        `${next.hotelCode} ${next.displayName} 的配对命令是“绑定 ${next.pairingCode}”；请在10分钟内发送给企业微信智能机器人。`,
      )
    } catch (cause) {
      if (
        requestSequence === pairingSequenceRef.current
        && activeContextKey === contextKeyFor(contextRef.current)
      ) setError(businessErrorMessage(cause, '生成配对码失败'))
    } finally {
      if (requestSequence === pairingSequenceRef.current) {
        setPairingLoading(false)
      }
    }
  }

  const selectedHotelBinding = config?.hotelBindings.find(
    (binding) => binding.hotelId === context?.hotelId,
  ) ?? null

  return (
    <section className="wecom-automation-card">
      <div className="page-heading">
        <div>
          <p className="eyebrow">企业微信修复助手</p>
          <h3>门店播报与PMS修复助手</h3>
          <p>
            服务器通过企业微信官方长连接接收消息，无需域名。
            当前门店发生PMS或播报异常时，机器人优先私聊已绑定的修复管理员；
            是否同时向门店群推送本店修复入口，可在下方播报设置中独立开启或停止。
            罗盘验证码可在企微回复；别样红门店直接在修复页更新 Cookie，无需安装门店软件。
            现有全局接收人默认只接收通知；仅在平台管理员显式授权后，才可处理所有门店；
            下方人员管理可查看绑定名单、填写姓名，并为运营经理批量授权多家门店。
          </p>
        </div>
        <b className={config?.paired && config.connected ? 'source-complete' : 'source-partial'}>
          {config?.paired && config.connected ? '已连接并绑定' : connectionLabel(config)}
        </b>
      </div>

      <div className="wecom-config-grid">
        <label className="inline-toggle wide-field">
          <input
            checked={enabled}
            disabled={
              !canConfigure || !configLoaded || loading || saving
              || clearCredentials
            }
            type="checkbox"
            onChange={(event) => {
              setEnabled(event.target.checked)
              formDirtyRef.current = true
            }}
          />
          启用企业微信门店修复接手通道
        </label>
        <label>
          企业微信智能机器人编号
          <input
            autoComplete="off"
            disabled={!canConfigure || !configLoaded || saving || clearCredentials}
            placeholder={config?.credentialConfigured ? '已加密保存；留空表示不更换' : '请填写机器人编号'}
            type="password"
            value={botId}
            onChange={(event) => {
              setBotId(event.target.value)
              formDirtyRef.current = true
            }}
          />
        </label>
        <label>
          企业微信智能机器人通信密钥
          <input
            autoComplete="new-password"
            disabled={!canConfigure || !configLoaded || saving || clearCredentials}
            placeholder={config?.credentialConfigured ? '已加密保存；留空表示不更换' : '请填写通信密钥'}
            type="password"
            value={secret}
            onChange={(event) => {
              setSecret(event.target.value)
              formDirtyRef.current = true
            }}
          />
        </label>
        <label className="inline-toggle wide-field">
          <input
            checked={allowGlobalRepairActions}
            disabled={
              !canConfigure || !configLoaded || loading || saving
              || clearCredentials
            }
            type="checkbox"
            onChange={(event) => {
              setAllowGlobalRepairActions(event.target.checked)
              formDirtyRef.current = true
            }}
          />
          允许已绑定的全局接收人处理所有门店修复任务（高权限）
        </label>
        <label className="inline-toggle wide-field">
          <input
            checked={clearCredentials}
            disabled={
              !canConfigure || !configLoaded
              || !config?.credentialConfigured || saving
            }
            type="checkbox"
            onChange={(event) => {
              setClearCredentials(event.target.checked)
              formDirtyRef.current = true
              if (event.target.checked) {
                setEnabled(false)
                setAllowGlobalRepairActions(false)
                setBotId('')
                setSecret('')
              }
            }}
          />
          清除已保存的机器人编号和通信密钥并关闭修复通道
        </label>
      </div>

      <div className="wecom-status-row">
        <span>凭据｜{config?.credentialConfigured ? '已加密保存' : '未配置'}</span>
        <span>连接｜{connectionLabel(config)}</span>
        <span>
          授权账号｜{config?.pairedUserCount
            ? `全局接收人${config.pairedUserCount}/${config.pairedUserCapacity}人`
            : '尚未绑定'}
        </span>
        <span>
          跨店处理｜{config?.allowGlobalRepairActions ? '已显式授权' : '未授权'}
        </span>
        <span>门店管理人员｜已绑定{config?.hotelPairedUserCount ?? 0}人次</span>
        <span>机器人指纹｜{config?.botIdFingerprint ?? '无'}</span>
      </div>

      {pairing ? (
        <div className="success" role="status">
          为 {pairing.hotelCode} {pairing.displayName} 新增管理人员；
          请让该人员在企业微信中打开智能机器人并发送：
          <strong className="pairing-command">
            配对命令：绑定 {pairing.pairingCode}
          </strong>
          <small>有效至 {new Date(pairing.expiresAt).toLocaleString('zh-CN')}，最多尝试 {pairing.attemptsRemaining} 次。</small>
        </div>
      ) : null}
      {notice ? <div className="success" role="status">{notice}</div> : null}
      {error ? <div className="error" role="alert">{error}</div> : null}

      <div className="wecom-config-grid">
        <label className="wide-field">
          当前门店管理人员
          <input
            aria-label="当前门店管理员配置范围"
            readOnly
            value={
              selectedHotelBinding
                ? `${selectedHotelBinding.hotelCode} · ${selectedHotelBinding.displayName}（已绑定${selectedHotelBinding.pairedUserCount}人）`
                : loading
                  ? '正在读取当前门店'
                  : '当前门店管理员状态尚未载入'
            }
          />
          <small>
            快捷配对仅绑定当前门店，作为备用方式；推荐使用下方“免配对码授权”，可一次选择多店。
          </small>
        </label>
      </div>

      <div className="heading-actions">
        <button
          className="secondary"
          disabled={!canConfigure || !configLoaded || loading || saving}
          type="button"
          onClick={save}
        >
          {saving ? '保存中…' : '保存机器人配置'}
        </button>
        <button
          disabled={
            !canConfigure
            || pairingLoading
            || !config?.connected
            || config.connectionStatus !== 'AUTHENTICATED'
            || !selectedHotelBinding
            || selectedHotelBinding.pairedUserCount
              >= selectedHotelBinding.pairedUserCapacity
          }
          type="button"
          onClick={createPairingCode}
        >
          {pairingLoading
            ? '正在生成…'
            : selectedHotelBinding
                && selectedHotelBinding.pairedUserCount
                  >= selectedHotelBinding.pairedUserCapacity
              ? '该门店已达绑定上限'
              : selectedHotelBinding
                ? `备用：为${selectedHotelBinding.hotelCode}生成配对码`
                : loading
                  ? '正在读取当前门店'
                  : '当前门店管理员状态不可用'}
        </button>
      </div>
      {canConfigure && context ? (
        <WeComRepairAdminsPanel
          key={context.hotelId}
          hotelId={context.hotelId}
          onChanged={() => void refresh(true)}
        />
      ) : null}
    </section>
  )
}
