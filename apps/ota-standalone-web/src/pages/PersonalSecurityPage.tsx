import { useState, type FormEvent } from 'react'
import { changeCredentials } from '../api/auth'
import { setSession, type AuthSession, type OtaRole } from '../auth/session'
import { Icon, Status } from '../components/ConsoleUi'
import { businessErrorMessage } from '../ui/businessDisplay'

const ROLE_LABELS: Record<OtaRole, string> = {
  PLATFORM_ADMIN: '管理员', OTA_OPERATION_ASSISTANT: 'OTA 运营助理',
  OTA_OPERATION_MANAGER: '运营总监', CEO: '总经理',
  REGIONAL_MANAGER: '区域经理', GENERAL_MANAGER: '店长',
  REVENUE_MANAGER: '已取消：收益经理', HOTEL_P1_HANDLER: '已取消：异常处理人',
}

export function PersonalSecurityPage({ session, onSessionChange }: { session: AuthSession; onSessionChange: (session: AuthSession) => void }) {
  const [currentPassword, setCurrentPassword] = useState('')
  const [newUsername, setNewUsername] = useState(session.username)
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(''); setNotice('')
    if (newPassword !== confirmPassword) { setError('两次输入的新密码不一致'); return }
    setSubmitting(true)
    try {
      const updated = await changeCredentials(session, { currentPassword, newUsername: newUsername.trim(), newPassword })
      setSession(updated); onSessionChange(updated); setCurrentPassword(''); setNewPassword(''); setConfirmPassword('')
      setNotice('账号和密码已更新，其他设备上的旧登录会话已失效。')
    } catch (cause) { setError(businessErrorMessage(cause, '账号安全设置保存失败')) }
    finally { setSubmitting(false) }
  }

  return <section className="console-page personal-security-page">
    <div className="page-title-row"><div><p className="section-kicker">账号与安全</p><h1>账号安全</h1><p>修改当前账号的登录资料，不影响业务平台登录和登录凭据。</p></div><Status tone="ok"><Icon name="shield" size={14} />会话受保护</Status></div>
    <div className="security-layout">
      <section className="content-panel account-profile"><span className="large-avatar">{session.account.displayName.slice(0, 1)}</span><div><h2>{session.account.displayName}</h2><p>{session.username}</p></div><dl><div><dt>账号角色</dt><dd>{session.account.roles.map((role) => ROLE_LABELS[role]).join('、')}</dd></div><div><dt>门店范围</dt><dd>{session.account.hotelIds === null ? '全部门店' : `${session.account.hotelIds.length} 家已授权门店`}</dd></div><div><dt>登录方式</dt><dd>本地账号 + 安全会话</dd></div></dl></section>
      <form className="content-panel security-form" onSubmit={submit}><div className="section-heading small"><div><h2>修改登录资料</h2><p>保存后将立即使其他设备上的旧会话失效。</p></div></div><label>当前密码<input autoComplete="current-password" required type="password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} /></label><label>新登录账号<input autoComplete="username" minLength={3} maxLength={64} required value={newUsername} onChange={(event) => setNewUsername(event.target.value)} /></label><label>新密码<input autoComplete="new-password" minLength={10} maxLength={128} required type="password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} /><small>至少 10 位，并包含大小写字母、数字、符号中的三类</small></label><label>确认新密码<input autoComplete="new-password" minLength={10} maxLength={128} required type="password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} /></label>{error ? <div className="inline-message error" role="alert">{error}</div> : null}{notice ? <div className="inline-message success" role="status">{notice}</div> : null}<button className="primary-button" disabled={submitting || !currentPassword || !newPassword || !confirmPassword} type="submit">{submitting ? '正在安全更新…' : '保存登录资料'}</button></form>
    </div>
  </section>
}
