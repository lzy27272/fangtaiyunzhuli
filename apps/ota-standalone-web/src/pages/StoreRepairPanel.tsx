import { useCallback, useEffect, useState } from 'react'
import {
  loadLuopanBrowserRepair,
  loadPmsLoginConfig,
  savePmsLoginConfig,
  validateLuopanBrowserRepair,
  type HotelContext,
  type LuopanBrowserRepairView,
  type PmsSystemCode,
} from '../api/business'
import { loadTrustedDeviceStatus } from '../api/trustedDevice'
import { Icon, LoadingState, Status } from '../components/ConsoleUi'
import { TrustedDevicePanel } from './TrustedDevicePanel'
import { businessErrorMessage } from '../ui/businessDisplay'

interface Props {
  context: HotelContext
  pmsSystemCode: PmsSystemCode
  canConfigure: boolean
  onStatusChanged: () => void
}

const formatTime = (value: string | null): string =>
  value ? new Date(value).toLocaleString('zh-CN') : '尚未完成'

export function StoreRepairPanel({
  context,
  pmsSystemCode,
  canConfigure,
  onStatusChanged,
}: Props) {
  const [trustedDeviceEligible, setTrustedDeviceEligible] = useState<boolean | null>(null)
  const [pmsConfigured, setPmsConfigured] = useState(false)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [luopan, setLuopan] = useState<LuopanBrowserRepairView | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [validating, setValidating] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const refresh = useCallback(async () => {
    setLoading(true)
    setError('')
    if (pmsSystemCode === 'OTHER') {
      setTrustedDeviceEligible(false)
      setPmsConfigured(false)
      setLuopan(null)
      setLoading(false)
      return
    }
    const [trustedResult, pmsResult, luopanResult] = await Promise.allSettled([
      loadTrustedDeviceStatus(context),
      loadPmsLoginConfig(context),
      pmsSystemCode === 'LUOPAN_CLOUD'
        ? loadLuopanBrowserRepair(context)
        : Promise.resolve(null),
    ])
    setTrustedDeviceEligible(
      trustedResult.status === 'fulfilled' ? trustedResult.value.eligible : false,
    )
    if (pmsResult.status === 'fulfilled') setPmsConfigured(pmsResult.value.configured)
    if (luopanResult.status === 'fulfilled') setLuopan(luopanResult.value)
    if (trustedResult.status === 'rejected' && pmsResult.status === 'rejected') {
      setError('登录修复状态暂时不可用，请刷新后重试。')
    }
    setLoading(false)
  }, [context, pmsSystemCode])

  useEffect(() => {
    setUsername('')
    setPassword('')
    setNotice('')
    void refresh()
  }, [refresh])

  async function saveRepairCredentials() {
    const normalizedUsername = username.trim()
    if (
      !normalizedUsername
      || !password
      || /[\r\n\u0000]/u.test(normalizedUsername)
      || /[\r\n\u0000]/u.test(password)
    ) {
      setError('请完整填写账号和密码，且不能包含换行或空字符。')
      return
    }
    setSaving(true)
    setError('')
    setNotice('')
    try {
      const saved = await savePmsLoginConfig(context, {
        action: 'REPLACE',
        username: normalizedUsername,
        password,
      })
      setPmsConfigured(saved.configured)
      setUsername('')
      setPassword('')
      setNotice('修复凭据已安全提交，输入内容已清空且不会回显。')
      onStatusChanged()
    } catch (cause) {
      setError(businessErrorMessage(cause, '修复凭据提交失败'))
    } finally {
      setSaving(false)
    }
  }

  async function validateLuopanSession() {
    setValidating(true)
    setError('')
    setNotice('')
    try {
      const next = await validateLuopanBrowserRepair(context)
      setLuopan(next)
      setNotice(`登录验证通过，PMS营业日为${next.lastBusinessDate ?? '已确认'}。`)
      onStatusChanged()
    } catch (cause) {
      setError(businessErrorMessage(cause, '登录验证失败'))
    } finally {
      setValidating(false)
    }
  }

  if (loading) return <LoadingState label="正在读取登录修复状态…" />

  if (pmsSystemCode === 'OTHER') {
    return (
      <section className="content-panel repair-access-intro">
        <span className="role-icon"><Icon name="settings" /></span>
        <div>
          <h2>PMS 厂家待接入</h2>
          <p>该门店已登记其他 PMS 厂家。完成厂家适配、接口校验和单店数据验证后，系统才会开放登录修复与采集。</p>
        </div>
        <Status tone="warning">待适配</Status>
      </section>
    )
  }

  return (
    <div className="repair-access-layout">
      <section className="content-panel repair-access-intro">
        <span className="role-icon"><Icon name="shield" /></span>
        <div>
          <h2>登录修复</h2>
          <p>此页面只提供账号、密码和官方验证等修复操作，不显示采集网址、Cookie、接口参数或采集规则。</p>
        </div>
        <Status tone="ok">门店范围已校验</Status>
      </section>

      {trustedDeviceEligible ? (
        <TrustedDevicePanel
          canConfigure={canConfigure}
          context={context}
          onStatusChanged={onStatusChanged}
        />
      ) : (
        <section className="content-panel repair-credential-card">
          <div className="section-heading small">
            <div>
              <h2>酒店系统账号修复</h2>
              <p>仅用于重新建立当前门店登录；账号和密码不会在页面回显。</p>
            </div>
            <Status tone={pmsConfigured ? 'ok' : 'warning'}>
              {pmsConfigured ? '已提交修复凭据' : '等待填写'}
            </Status>
          </div>
          <div className="report-source-form">
            <label>酒店系统账号<input autoComplete="off" maxLength={256} value={username} onChange={(event) => setUsername(event.target.value)} placeholder="请输入当前门店账号" /></label>
            <label>酒店系统密码<input autoComplete="new-password" maxLength={4096} type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="请输入密码" /></label>
          </div>
          <div className="button-row">
            <button disabled={saving || !username.trim() || !password} type="button" onClick={() => void saveRepairCredentials()}>{saving ? '正在安全提交…' : '提交修复凭据'}</button>
          </div>
        </section>
      )}

      {pmsSystemCode === 'LUOPAN_CLOUD' && luopan ? (
        <section className="content-panel repair-credential-card">
          <div className="section-heading small">
            <div><h2>罗盘官网登录验证</h2><p>在罗盘官方页面完成登录后，返回这里验证当前门店会话。</p></div>
            <Status tone={luopan.scopeStatus === 'SINGLE_HOTEL_CONFIRMED' ? 'ok' : 'warning'}>{luopan.scopeStatus === 'SINGLE_HOTEL_CONFIRMED' ? '单店会话已确认' : '等待验证'}</Status>
          </div>
          <dl className="review-list compact">
            <div><dt>最近验证</dt><dd>{formatTime(luopan.lastValidatedAt)}</dd></div>
            <div><dt>营业日</dt><dd>{luopan.lastBusinessDate ?? '尚未确认'}</dd></div>
            <div><dt>最近采集</dt><dd>{formatTime(luopan.lastCollectionAt)}</dd></div>
          </dl>
          <div className="button-row">
            <a className="button-link secondary" href={luopan.portalUrl} rel="noreferrer" target="_blank">打开罗盘官网登录</a>
            <button disabled={validating || !luopan.profileConfigured} type="button" onClick={() => void validateLuopanSession()}>{validating ? '正在验证…' : '登录完成，开始验证'}</button>
          </div>
        </section>
      ) : null}

      {notice ? <div className="inline-message success" role="status">{notice}</div> : null}
      {error ? <div className="inline-message error" role="alert">{error}</div> : null}
    </div>
  )
}
