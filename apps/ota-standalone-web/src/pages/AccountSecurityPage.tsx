import { type FormEvent, useState } from 'react'
import {
  changeCredentials,
  type CredentialChangeInput,
} from '../api/auth'
import {
  setSession,
  type AuthSession,
} from '../auth/session'

export function AccountSecurityPage({
  session,
  onSessionChange,
}: {
  session: AuthSession
  onSessionChange: (session: AuthSession) => void
}) {
  const [currentPassword, setCurrentPassword] = useState('')
  const [newUsername, setNewUsername] = useState(session.username)
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    setNotice('')
    if (newPassword !== confirmPassword) {
      setError('两次输入的新密码不一致')
      return
    }

    const input: CredentialChangeInput = {
      currentPassword,
      newUsername: newUsername.trim(),
      newPassword,
    }
    setSubmitting(true)
    try {
      const nextSession = await changeCredentials(session, input)
      setSession(nextSession)
      onSessionChange(nextSession)
      setNewUsername(nextSession.username)
      setCurrentPassword('')
      setNewPassword('')
      setConfirmPassword('')
      setNotice('账号密码已更新，其他页面和设备上的旧登录已失效。')
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : '账号密码修改失败，请稍后重试',
      )
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <section className="page-card account-security-page">
      <header className="page-heading">
        <div>
          <p className="eyebrow">05 · ACCOUNT SECURITY</p>
          <h2>账号安全</h2>
          <p>
            修改后台登录账号和密码。密码仅保存不可逆哈希，
            修改后旧会话立即失效。
          </p>
        </div>
        <span className="mode-chip">仅平台管理员</span>
      </header>

      <form className="account-security-form" onSubmit={submit}>
        <div className="security-current-account">
          <span>当前登录账号</span>
          <strong>{session.username}</strong>
        </div>

        <div className="account-security-grid">
          <label>
            当前密码
            <input
              autoComplete="current-password"
              required
              type="password"
              value={currentPassword}
              onChange={(event) => setCurrentPassword(event.target.value)}
            />
          </label>
          <label>
            新登录账号
            <input
              autoComplete="username"
              maxLength={64}
              minLength={3}
              pattern="[\p{L}\p{N}][\p{L}\p{N}._@-]{2,63}"
              required
              value={newUsername}
              onChange={(event) => setNewUsername(event.target.value)}
            />
            <small>3–64 位，可使用中英文、数字及 . _ @ -</small>
          </label>
          <label>
            新密码
            <input
              autoComplete="new-password"
              maxLength={128}
              minLength={10}
              required
              type="password"
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
            />
            <small>至少 10 位，并包含大小写字母、数字、符号中的三类</small>
          </label>
          <label>
            确认新密码
            <input
              autoComplete="new-password"
              maxLength={128}
              minLength={10}
              required
              type="password"
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
            />
          </label>
        </div>

        {error ? <div className="error" role="alert">{error}</div> : null}
        {notice ? (
          <div className="credential-success" role="status">{notice}</div>
        ) : null}

        <div className="credential-actions">
          <button
            disabled={
              submitting
              || !currentPassword
              || !newUsername.trim()
              || !newPassword
              || !confirmPassword
            }
            type="submit"
          >
            {submitting ? '正在安全更新…' : '保存新账号和密码'}
          </button>
        </div>
      </form>
    </section>
  )
}
