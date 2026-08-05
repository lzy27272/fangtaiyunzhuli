import { useCallback, useEffect, useState } from 'react'
import {
  loadWeComRepairBotConfig,
  saveWeComRepairBotConfig,
  startWeComRepairBotPairing,
  type WeComRepairBotConfigView,
  type WeComRepairBotPairingView,
} from '../api/business'

interface Props {
  canConfigure: boolean
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

export function WeComRepairBotConfigPanel({ canConfigure }: Props) {
  const [config, setConfig] = useState<WeComRepairBotConfigView | null>(null)
  const [enabled, setEnabled] = useState(false)
  const [botId, setBotId] = useState('')
  const [secret, setSecret] = useState('')
  const [clearCredentials, setClearCredentials] = useState(false)
  const [pairing, setPairing] = useState<WeComRepairBotPairingView | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [pairingLoading, setPairingLoading] = useState(false)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')

  const refresh = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true)
    try {
      const next = await loadWeComRepairBotConfig()
      setConfig(next)
      setEnabled(next.enabled)
      if (!next.pairing.active) setPairing(null)
      setError('')
    } catch (cause) {
      if (!quiet) {
        setError(cause instanceof Error ? cause.message : '读取机器人配置失败')
      }
    } finally {
      if (!quiet) setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
    const timer = window.setInterval(() => void refresh(true), 5_000)
    return () => window.clearInterval(timer)
  }, [refresh])

  async function save() {
    const replacing = botId.trim().length > 0 || secret.length > 0
    if (replacing && (!botId.trim() || !secret)) {
      setError('更换凭据时，Bot ID和Secret必须同时填写。')
      return
    }
    setSaving(true)
    setError('')
    setNotice('')
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
        credentialUpdate,
      )
      setConfig(next)
      setEnabled(next.enabled)
      setBotId('')
      setSecret('')
      setClearCredentials(false)
      setPairing(null)
      setNotice(
        next.enabled
          ? '配置已加密保存，服务器正在建立企业微信长连接。'
          : '智能机器人修复通道当前未启用。',
      )
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '保存机器人配置失败')
    } finally {
      setSaving(false)
    }
  }

  async function createPairingCode() {
    setPairingLoading(true)
    setError('')
    setNotice('')
    try {
      const next = await startWeComRepairBotPairing()
      setPairing(next)
      setNotice('配对码已生成，请在10分钟内发送给企业微信智能机器人。')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '生成配对码失败')
    } finally {
      setPairingLoading(false)
    }
  }

  return (
    <section className="wecom-automation-card">
      <div className="page-heading">
        <div>
          <p className="eyebrow">WECOM REPAIR BOT</p>
          <h3>罗盘简报验证码修复助手</h3>
          <p>
            服务器通过企业微信官方长连接接收消息，无需域名。
            发现罗盘会话失效时，机器人会私聊发送验证码图片；
            最多绑定两位企业微信成员，两人同时接收；
            只有完成一次性绑定的账号可以回复“门店编号 验证码”。
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
            disabled={!canConfigure || loading || saving || clearCredentials}
            type="checkbox"
            onChange={(event) => setEnabled(event.target.checked)}
          />
          启用罗盘验证码企业微信修复通道
        </label>
        <label>
          企业微信智能机器人 Bot ID
          <input
            autoComplete="off"
            disabled={!canConfigure || saving || clearCredentials}
            placeholder={config?.credentialConfigured ? '已加密保存；留空表示不更换' : '请在此填写Bot ID'}
            type="password"
            value={botId}
            onChange={(event) => setBotId(event.target.value)}
          />
        </label>
        <label>
          企业微信智能机器人 Secret
          <input
            autoComplete="new-password"
            disabled={!canConfigure || saving || clearCredentials}
            placeholder={config?.credentialConfigured ? '已加密保存；留空表示不更换' : '请在此填写Secret'}
            type="password"
            value={secret}
            onChange={(event) => setSecret(event.target.value)}
          />
        </label>
        <label className="inline-toggle wide-field">
          <input
            checked={clearCredentials}
            disabled={!canConfigure || !config?.credentialConfigured || saving}
            type="checkbox"
            onChange={(event) => {
              setClearCredentials(event.target.checked)
              if (event.target.checked) {
                setEnabled(false)
                setBotId('')
                setSecret('')
              }
            }}
          />
          清除已保存的Bot ID和Secret并关闭修复通道
        </label>
      </div>

      <div className="wecom-status-row">
        <span>凭据｜{config?.credentialConfigured ? '已加密保存' : '未配置'}</span>
        <span>连接｜{connectionLabel(config)}</span>
        <span>
          授权账号｜{config?.pairedUserCount
            ? `已绑定${config.pairedUserCount}/${config.pairedUserCapacity}人`
            : '尚未绑定'}
        </span>
        <span>机器人指纹｜{config?.botIdFingerprint ?? '无'}</span>
      </div>

      {pairing ? (
        <div className="success" role="status">
          请在企业微信中打开刚创建的智能机器人并发送：
          <strong className="pairing-command">绑定 {pairing.pairingCode}</strong>
          <small>有效至 {new Date(pairing.expiresAt).toLocaleString('zh-CN')}，最多尝试 {pairing.attemptsRemaining} 次。</small>
        </div>
      ) : null}
      {notice ? <div className="success" role="status">{notice}</div> : null}
      {error ? <div className="error" role="alert">{error}</div> : null}

      <div className="heading-actions">
        <button
          className="secondary"
          disabled={!canConfigure || loading || saving}
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
            || (config?.pairedUserCount ?? 0)
              >= (config?.pairedUserCapacity ?? 2)
          }
          type="button"
          onClick={createPairingCode}
        >
          {pairingLoading
            ? '正在生成…'
            : (config?.pairedUserCount ?? 0)
                >= (config?.pairedUserCapacity ?? 2)
              ? '已绑定2人'
              : config?.pairedUserCount === 1
                ? '绑定第二位接收人'
                : '生成第一位配对码'}
        </button>
      </div>
    </section>
  )
}
