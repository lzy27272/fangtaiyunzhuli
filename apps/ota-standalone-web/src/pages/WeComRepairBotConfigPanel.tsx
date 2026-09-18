import { useCallback, useEffect, useRef, useState } from 'react'
import { loadGlobalWeComRepairBotConfig, saveWeComRepairBotConfig, type WeComRepairBotConfigView } from '../api/business'
import { businessErrorMessage } from '../ui/businessDisplay'

const connectionLabel = (config: WeComRepairBotConfigView | null) => {
  if (!config) return '正在读取'
  if (config.connected && config.connectionStatus === 'AUTHENTICATED') return '长连接已认证'
  return ({ DISABLED: '未启用', STARTING: '正在启动', NOT_CONFIGURED: '未配置凭据', CONNECTING: '正在连接',
    DISCONNECTED: '连接已断开，自动重连中', ERROR: '连接异常' } as Record<string, string>)[config.connectionStatus] ?? '连接待确认'
}

// Global-only editor: no store context or implicit store selection.
export function WeComRepairBotConfigPanel({ canConfigure }: { canConfigure: boolean }) {
  const [config, setConfig] = useState<WeComRepairBotConfigView | null>(null)
  const [enabled, setEnabled] = useState(false)
  const [allowGlobalRepairActions, setAllowGlobalRepairActions] = useState(false)
  const [botId, setBotId] = useState('')
  const [secret, setSecret] = useState('')
  const [clearCredentials, setClearCredentials] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const formDirtyRef = useRef(false)
  const requestSequenceRef = useRef(0)
  const loadingRef = useRef(false)
  const savingRef = useRef(false)
  const mountedRef = useRef(true)
  const configLoaded = Boolean(config)

  const refresh = useCallback(async (quiet = false) => {
    if (!canConfigure || (quiet && (loadingRef.current || savingRef.current))) return
    const requestSequence = ++requestSequenceRef.current
    loadingRef.current = true
    if (!quiet) setLoading(true)
    try {
      const next = await loadGlobalWeComRepairBotConfig()
      if (!mountedRef.current || requestSequence !== requestSequenceRef.current) return
      setConfig((current) => quiet && formDirtyRef.current && current ? { ...next, rowVersion: current.rowVersion } : next)
      if (!quiet || !formDirtyRef.current) {
        setEnabled(next.enabled); setAllowGlobalRepairActions(next.allowGlobalRepairActions)
      }
      if (!quiet) { formDirtyRef.current = false; setError('') }
    } catch (cause) {
      if (mountedRef.current && requestSequence === requestSequenceRef.current) {
        setError(businessErrorMessage(cause, '读取全平台机器人配置失败'))
      }
    } finally {
      if (mountedRef.current && requestSequence === requestSequenceRef.current) {
        loadingRef.current = false; setLoading(false)
      }
    }
  }, [canConfigure])

  useEffect(() => {
    mountedRef.current = true
    void refresh()
    const timer = window.setInterval(() => void refresh(true), 5_000)
    return () => { mountedRef.current = false; requestSequenceRef.current += 1; window.clearInterval(timer) }
  }, [refresh])

  async function save() {
    const currentConfig = config
    if (!canConfigure || !currentConfig || loading || savingRef.current) return
    const replacing = Boolean(botId.trim() || secret)
    if (replacing && (!botId.trim() || !secret)) { setError('更换凭据时，机器人编号和通信密钥必须同时填写。'); return }
    savingRef.current = true; setSaving(true); setError(''); setNotice('')
    const requestSequence = ++requestSequenceRef.current
    // The save supersedes an in-flight quiet read; don't leave its loading lock held.
    loadingRef.current = false
    try {
      const credentialUpdate = replacing ? { action: 'REPLACE' as const, botId: botId.trim(), secret }
        : clearCredentials ? { action: 'CLEAR' as const } : { action: 'KEEP' as const }
      const next = await saveWeComRepairBotConfig(clearCredentials ? false : enabled,
        clearCredentials ? false : allowGlobalRepairActions, credentialUpdate, currentConfig.rowVersion)
      if (!mountedRef.current || requestSequence !== requestSequenceRef.current) return
      setConfig(next); setEnabled(next.enabled); setAllowGlobalRepairActions(next.allowGlobalRepairActions)
      setBotId(''); setSecret(''); setClearCredentials(false); formDirtyRef.current = false
      setNotice(next.enabled ? '全平台配置已加密保存，服务器正在建立企业微信长连接。' : '全平台智能机器人修复通道已停用。')
    } catch (cause) {
      if (!mountedRef.current) return
      if (cause instanceof Error && cause.message === 'WECOM_REPAIR_BOT_CONFIG_VERSION_CONFLICT') {
        savingRef.current = false; formDirtyRef.current = false
        setBotId(''); setSecret(''); setClearCredentials(false)
        await refresh(true)
      }
      if (mountedRef.current) setError(businessErrorMessage(cause, '保存机器人配置失败'))
    } finally {
      savingRef.current = false
      if (mountedRef.current) setSaving(false)
    }
  }

  if (!canConfigure) return null
  return <section className="wecom-automation-card" aria-label="全平台机器人连接配置">
    <div className="page-heading"><div><p className="eyebrow">全平台共用 · 仅管理员可修改</p><h3>企微机器人连接与全局修复权限</h3>
      <p>所有门店共用此机器人。这里修改连接、密钥或跨店修复开关，会影响全平台；各店播报频率及群机器人地址仍在对应门店配置。审批人请在上方“企业微信简易绑定审批”单独勾选。</p></div>
      <b className={config?.connected ? 'source-complete' : 'source-partial'}>{connectionLabel(config)}</b></div>
    <div className="wecom-config-grid">
      <label className="inline-toggle wide-field"><input type="checkbox" checked={enabled} disabled={!configLoaded || loading || saving || clearCredentials} onChange={(e) => { setEnabled(e.target.checked); formDirtyRef.current = true }} />启用全平台企业微信修复通道</label>
      <label>企业微信智能机器人编号<input type="password" autoComplete="off" disabled={!configLoaded || loading || saving || clearCredentials} value={botId} placeholder={config?.credentialConfigured ? '已加密保存；留空表示不更换' : '请填写机器人编号'} onChange={(e) => { setBotId(e.target.value); formDirtyRef.current = true }} /></label>
      <label>企业微信智能机器人通信密钥<input type="password" autoComplete="new-password" disabled={!configLoaded || loading || saving || clearCredentials} value={secret} placeholder={config?.credentialConfigured ? '已加密保存；留空表示不更换' : '请填写通信密钥'} onChange={(e) => { setSecret(e.target.value); formDirtyRef.current = true }} /></label>
      <label className="inline-toggle wide-field"><input type="checkbox" checked={allowGlobalRepairActions} disabled={!configLoaded || loading || saving || clearCredentials} onChange={(e) => { setAllowGlobalRepairActions(e.target.checked); formDirtyRef.current = true }} />允许已绑定的全局接收人处理所有门店修复任务（高权限）</label>
      <label className="inline-toggle wide-field"><input type="checkbox" checked={clearCredentials} disabled={!configLoaded || !config?.credentialConfigured || saving} onChange={(e) => {
        setClearCredentials(e.target.checked); formDirtyRef.current = true
        if (e.target.checked) { setEnabled(false); setAllowGlobalRepairActions(false); setBotId(''); setSecret('') }
      }} />清除已保存的机器人编号和通信密钥并关闭全平台修复通道</label>
    </div>
    <div className="wecom-status-row"><span>凭据｜{config?.credentialConfigured ? '已加密保存' : '未配置'}</span><span>连接｜{connectionLabel(config)}</span>
      <span>全局接收人｜{config?.pairedUserCount ?? 0}/{config?.pairedUserCapacity ?? 2}人</span><span>跨店处理｜{config?.allowGlobalRepairActions ? '已显式授权' : '未授权'}</span>
      <span>门店管理人员｜全平台已绑定{config?.hotelPairedUserCount ?? 0}人次</span><span>机器人指纹｜{config?.botIdFingerprint ?? '无'}</span></div>
    {notice ? <p className="success" role="status">{notice}</p> : null}{error ? <p className="error" role="alert">{error}</p> : null}
    <div className="heading-actions"><button type="button" disabled={!configLoaded || loading || saving} onClick={() => void save()}>{saving ? '保存中…' : '保存全平台机器人配置'}</button>
      <button className="secondary" type="button" disabled={loading || saving} onClick={() => {
        setBotId(''); setSecret(''); setClearCredentials(false); void refresh()
      }}>{loading ? '读取中…' : '重新读取配置'}</button></div>
  </section>
}
