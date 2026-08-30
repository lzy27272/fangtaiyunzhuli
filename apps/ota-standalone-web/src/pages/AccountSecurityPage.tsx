import { type FormEvent, useEffect, useState } from 'react'
import {
  changeCredentials,
  createManagedAccount,
  listManagedAccounts,
  updateManagedAccount,
  type CredentialChangeInput,
  type ManagedAccount,
} from '../api/auth'
import {
  listSimulationHotels,
  type SimulationHotelView,
} from '../api/business'
import {
  setSession,
  type AuthSession,
  type OtaRole,
} from '../auth/session'

const ROLE_OPTIONS: Array<{ value: OtaRole; label: string }> = [
  { value: 'OTA_OPERATION_MANAGER', label: 'OTA运营经理' },
  { value: 'OTA_OPERATION_ASSISTANT', label: 'OTA运营助理' },
  { value: 'REVENUE_MANAGER', label: '收益经理' },
  { value: 'REGIONAL_MANAGER', label: '区域经理' },
  { value: 'HOTEL_P1_HANDLER', label: 'P1处理人' },
]

const toggleValue = <T extends string>(values: T[], value: T): T[] =>
  values.includes(value)
    ? values.filter((item) => item !== value)
    : [...values, value]

const hotelLabel = (hotel: SimulationHotelView) =>
  `${hotel.hotelCode} · ${hotel.hotelName}`

function ManagedAccountCard({
  account,
  hotels,
  session,
  onSaved,
}: {
  account: ManagedAccount
  hotels: SimulationHotelView[]
  session: AuthSession
  onSaved: (account: ManagedAccount) => void
}) {
  const platformAdmin = account.roles.includes('PLATFORM_ADMIN')
  const [displayName, setDisplayName] = useState(account.displayName)
  const [roles, setRoles] = useState<OtaRole[]>(account.roles)
  const [hotelIds, setHotelIds] = useState<string[]>(account.hotelIds ?? [])
  const [enabled, setEnabled] = useState(account.enabled)
  const [newPassword, setNewPassword] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const save = async () => {
    if (platformAdmin || saving) return
    setSaving(true)
    setError('')
    setNotice('')
    try {
      const updated = await updateManagedAccount(session, account.id, {
        displayName,
        roles,
        hotelIds,
        enabled,
        ...(newPassword ? { newPassword } : {}),
      })
      setNewPassword('')
      onSaved(updated)
      setNotice('账号权限已保存；该人员的旧登录会话已失效。')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '账号权限保存失败')
    } finally {
      setSaving(false)
    }
  }

  if (platformAdmin) {
    return (
      <article className="managed-account-card platform-account-card">
        <header>
          <div>
            <strong>{account.displayName}</strong>
            <span>{account.username}</span>
          </div>
          <span className="mode-chip">平台管理员 · 全部门店</span>
        </header>
        <p>平台管理员通过上方“当前账号密码”区域维护登录资料，默认拥有全部门店。</p>
      </article>
    )
  }

  return (
    <article className="managed-account-card">
      <header>
        <div>
          <strong>{account.displayName}</strong>
          <span>{account.username}</span>
        </div>
        <label className="managed-account-enabled">
          <input
            checked={enabled}
            type="checkbox"
            onChange={(event) => setEnabled(event.target.checked)}
          />
          {enabled ? '启用' : '停用'}
        </label>
      </header>
      <div className="managed-account-fields">
        <label>
          人员名称
          <input
            maxLength={60}
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
          />
        </label>
        <label>
          重置密码（可不填）
          <input
            autoComplete="new-password"
            maxLength={128}
            minLength={10}
            placeholder="留空则不修改"
            type="password"
            value={newPassword}
            onChange={(event) => setNewPassword(event.target.value)}
          />
        </label>
      </div>
      <fieldset>
        <legend>角色</legend>
        <div className="permission-checkboxes">
          {ROLE_OPTIONS.map((role) => (
            <label key={role.value}>
              <input
                checked={roles.includes(role.value)}
                type="checkbox"
                onChange={() => setRoles((current) => toggleValue(current, role.value))}
              />
              {role.label}
            </label>
          ))}
        </div>
      </fieldset>
      <fieldset>
        <legend>可访问门店（服务端强隔离）</legend>
        <div className="permission-checkboxes hotel-scope-checkboxes">
          {hotels.map((hotel) => (
            <label key={hotel.hotelId}>
              <input
                checked={hotelIds.includes(hotel.hotelId)}
                type="checkbox"
                onChange={() => setHotelIds((current) =>
                  toggleValue(current, hotel.hotelId))}
              />
              {hotelLabel(hotel)}
            </label>
          ))}
        </div>
      </fieldset>
      {error ? <div className="error" role="alert">{error}</div> : null}
      {notice ? <div className="credential-success" role="status">{notice}</div> : null}
      <div className="credential-actions">
        <button
          disabled={
            saving
            || !displayName.trim()
            || roles.length === 0
            || hotelIds.length === 0
          }
          type="button"
          onClick={() => void save()}
        >{saving ? '正在保存…' : '保存账号与门店权限'}</button>
      </div>
    </article>
  )
}

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
  const [accounts, setAccounts] = useState<ManagedAccount[]>([])
  const [hotels, setHotels] = useState<SimulationHotelView[]>([])
  const [directoryError, setDirectoryError] = useState('')
  const [loadingDirectory, setLoadingDirectory] = useState(true)
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState('')
  const [createNotice, setCreateNotice] = useState('')
  const [draft, setDraft] = useState({
    username: '',
    displayName: '',
    password: '',
    roles: ['OTA_OPERATION_MANAGER'] as OtaRole[],
    hotelIds: [] as string[],
  })

  useEffect(() => {
    let cancelled = false
    setLoadingDirectory(true)
    setDirectoryError('')
    Promise.all([
      listManagedAccounts(session),
      listSimulationHotels(),
    ])
      .then(([nextAccounts, directory]) => {
        if (cancelled) return
        setAccounts(nextAccounts)
        setHotels(directory.hotels)
      })
      .catch((cause) => {
        if (!cancelled) {
          setDirectoryError(cause instanceof Error ? cause.message : '账号目录读取失败')
        }
      })
      .finally(() => {
        if (!cancelled) setLoadingDirectory(false)
      })
    return () => { cancelled = true }
  }, [session])

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
      setError(reason instanceof Error ? reason.message : '账号密码修改失败，请稍后重试')
    } finally {
      setSubmitting(false)
    }
  }

  async function createAccount(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setCreateError('')
    setCreateNotice('')
    setCreating(true)
    try {
      const created = await createManagedAccount(session, draft)
      setAccounts((current) => [...current, created])
      setDraft({
        username: '',
        displayName: '',
        password: '',
        roles: ['OTA_OPERATION_MANAGER'],
        hotelIds: [],
      })
      setCreateNotice('账号已创建，只能访问已勾选的门店。')
    } catch (cause) {
      setCreateError(cause instanceof Error ? cause.message : '账号创建失败')
    } finally {
      setCreating(false)
    }
  }

  return (
    <section className="page-card account-security-page">
      <header className="page-heading">
        <div>
          <p className="eyebrow">05 · ACCOUNT & HOTEL ACCESS</p>
          <h2>账号与门店权限</h2>
          <p>新增管理人员并分配可访问门店；未授权门店在目录和接口层均不可读取。</p>
        </div>
        <span className="mode-chip">仅平台管理员</span>
      </header>

      <form className="account-security-form" onSubmit={submit}>
        <h3>当前平台管理员账号</h3>
        <div className="security-current-account">
          <span>当前登录账号</span>
          <strong>{session.username}</strong>
        </div>
        <div className="account-security-grid">
          <label>
            当前密码
            <input autoComplete="current-password" required type="password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} />
          </label>
          <label>
            新登录账号
            <input autoComplete="username" maxLength={64} minLength={3} required value={newUsername} onChange={(event) => setNewUsername(event.target.value)} />
            <small>3–64 位，可使用中英文、数字及 . _ @ -</small>
          </label>
          <label>
            新密码
            <input autoComplete="new-password" maxLength={128} minLength={10} required type="password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} />
            <small>至少 10 位，并包含大小写字母、数字、符号中的三类</small>
          </label>
          <label>
            确认新密码
            <input autoComplete="new-password" maxLength={128} minLength={10} required type="password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} />
          </label>
        </div>
        {error ? <div className="error" role="alert">{error}</div> : null}
        {notice ? <div className="credential-success" role="status">{notice}</div> : null}
        <div className="credential-actions">
          <button disabled={submitting || !currentPassword || !newUsername.trim() || !newPassword || !confirmPassword} type="submit">
            {submitting ? '正在安全更新…' : '保存当前账号和密码'}
          </button>
        </div>
      </form>

      <div className="account-management-section">
        <div className="account-management-heading">
          <div>
            <h3>新增管理人员</h3>
            <p>密码不可逆哈希保存；门店范围由服务端逐请求校验。</p>
          </div>
          <span>{loadingDirectory ? '正在读取…' : `${accounts.length}个账号 · ${hotels.length}家门店`}</span>
        </div>
        {directoryError ? <div className="error" role="alert">{directoryError}</div> : null}
        <form className="managed-account-create" onSubmit={createAccount}>
          <div className="managed-account-fields">
            <label>登录账号<input required value={draft.username} onChange={(event) => setDraft({ ...draft, username: event.target.value })} /></label>
            <label>人员名称<input required value={draft.displayName} onChange={(event) => setDraft({ ...draft, displayName: event.target.value })} /></label>
            <label>初始密码<input autoComplete="new-password" minLength={10} required type="password" value={draft.password} onChange={(event) => setDraft({ ...draft, password: event.target.value })} /></label>
          </div>
          <fieldset>
            <legend>角色</legend>
            <div className="permission-checkboxes">
              {ROLE_OPTIONS.map((role) => (
                <label key={role.value}>
                  <input checked={draft.roles.includes(role.value)} type="checkbox" onChange={() => setDraft({ ...draft, roles: toggleValue(draft.roles, role.value) })} />
                  {role.label}
                </label>
              ))}
            </div>
          </fieldset>
          <fieldset>
            <legend>可访问门店</legend>
            <div className="permission-checkboxes hotel-scope-checkboxes">
              {hotels.map((hotel) => (
                <label key={hotel.hotelId}>
                  <input checked={draft.hotelIds.includes(hotel.hotelId)} type="checkbox" onChange={() => setDraft({ ...draft, hotelIds: toggleValue(draft.hotelIds, hotel.hotelId) })} />
                  {hotelLabel(hotel)}
                </label>
              ))}
            </div>
          </fieldset>
          {createError ? <div className="error" role="alert">{createError}</div> : null}
          {createNotice ? <div className="credential-success" role="status">{createNotice}</div> : null}
          <div className="credential-actions">
            <button disabled={creating || !draft.username.trim() || !draft.displayName.trim() || !draft.password || draft.roles.length === 0 || draft.hotelIds.length === 0} type="submit">
              {creating ? '正在创建…' : '新增账号并绑定门店'}
            </button>
          </div>
        </form>

        <div className="managed-account-list">
          {accounts.map((account) => (
            <ManagedAccountCard
              account={account}
              hotels={hotels}
              key={account.id}
              session={session}
              onSaved={(updated) => setAccounts((current) =>
                current.map((item) => item.id === updated.id ? updated : item))}
            />
          ))}
        </div>
      </div>
    </section>
  )
}
