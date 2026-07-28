import { FormEvent, useEffect, useState } from 'react'
import { hasRefreshContext, login, logout, refreshSession } from './api/auth'
import type { HotelContext } from './api/business'
import { clearSession, getSession, setSession, type AuthSession, type OtaRole } from './auth/session'
import { HotelContextBar } from './components/HotelContextBar'
import { HistoryPage } from './pages/HistoryPage'
import { MappingTargetPage } from './pages/MappingTargetPage'
import { MonitorPage } from './pages/MonitorPage'
import { ReportSourceConfigPage } from './pages/ReportSourceConfigPage'
import type { ReportSourceAttention } from './pages/reportSourceAttention'

function LoginPanel({ onAuthenticated }: { onAuthenticated: (session: AuthSession) => void }) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    setSubmitting(true)
    try {
      const session = await login(username.trim(), password)
      setSession(session)
      setPassword('')
      onAuthenticated(session)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '登录失败')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <main className="login-layout">
      <section className="brand-panel" aria-label="产品说明">
        <p className="eyebrow">REPORT-FUSION-V0.1</p>
        <h1>四方馆经营自动化后台</h1>
        <p>独立运行的多报表融合计算、小时经营简报与P1风险控制后台。</p>
        <div className="sprint-badge">本机评审 · 多URL报表融合</div>
      </section>

      <section className="login-panel">
        <form onSubmit={submit}>
          <h2>本地人员账号登录</h2>
          <p className="muted">后台账号与报表接口、OTA及企业微信凭据严格分离。</p>

          <label>
            账号
            <input
              autoComplete="username"
              autoFocus
              required
              value={username}
              onChange={(event) => setUsername(event.target.value)}
            />
          </label>
          <label>
            密码
            <input
              autoComplete="current-password"
              required
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </label>

          {error ? <div className="error" role="alert">{error}</div> : null}
          <button disabled={submitting || !username.trim() || !password} type="submit">
            {submitting ? '正在验证…' : '安全登录'}
          </button>
          <p className="security-note">Access Token仅保存在当前页面内存；刷新凭据由安全Cookie承载。</p>
        </form>
      </section>
    </main>
  )
}

type PageCode = 'connections' | 'monitor' | 'mapping' | 'history'

const NAVIGATION: Array<{ code: PageCode; number: string; label: string }> = [
  { code: 'connections', number: '01', label: '报表接口' },
  { code: 'monitor', number: '02', label: '实时监控' },
  { code: 'mapping', number: '03', label: '指标规则' },
  { code: 'history', number: '04', label: '简报推送' },
]

const ROLE_LABELS: Record<OtaRole, string> = {
  PLATFORM_ADMIN: '平台管理员',
  OTA_OPERATION_ASSISTANT: 'OTA运营助理',
  OTA_OPERATION_MANAGER: 'OTA运营经理',
  CEO: '总经理',
  REGIONAL_MANAGER: '区域经理',
  REVENUE_MANAGER: '收益经理',
  HOTEL_P1_HANDLER: 'P1处理人',
}

function getRoleSummary(roles: OtaRole[]): string {
  const [primaryRole] = roles
  if (!primaryRole) return '未配置权限'

  const primaryLabel = ROLE_LABELS[primaryRole]
  return roles.length > 1 ? `${primaryLabel} · ${roles.length}项权限` : primaryLabel
}

function SprintOneShell({ session, onLogout }: { session: AuthSession; onLogout: () => void }) {
  const [working, setWorking] = useState(false)
  const [logoutError, setLogoutError] = useState('')
  const [page, setPage] = useState<PageCode>('monitor')
  const [context, setContext] = useState<HotelContext | null>(null)
  const [reportSourceAttention, setReportSourceAttention] =
    useState<ReportSourceAttention[]>([])
  const canAdminConfigure = session.account.roles.includes('PLATFORM_ADMIN')
  const canRevenueConfigure = canAdminConfigure
    || session.account.roles.includes('REVENUE_MANAGER')
  const roleSummary = getRoleSummary(session.account.roles)
  const fullRoleList = session.account.roles.map((role) => ROLE_LABELS[role]).join(' · ')

  async function signOut() {
    setWorking(true)
    setLogoutError('')
    try {
      await logout()
      clearSession()
      onLogout()
    } catch (reason) {
      setLogoutError(reason instanceof Error ? reason.message : '退出失败，请重试')
    } finally {
      setWorking(false)
    }
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="sidebar-brand">
          <p className="eyebrow">REPORT-FUSION-V0.1</p>
          <strong>四方馆酒店房态运营助手</strong>
        </div>
        <nav aria-label="业务页面">
          {NAVIGATION.map((item) => (
            <button
              className={page === item.code ? 'active' : ''}
              key={item.code}
              type="button"
              onClick={() => {
                setReportSourceAttention([])
                setPage(item.code)
              }}
            >
              <span>{item.number}</span>
              {item.label}
            </button>
          ))}
        </nav>
        <div className="sidebar-account">
          <span className="status-dot" aria-hidden="true" />
          <div>
            <strong>{session.account.displayName}</strong>
            <small aria-label={`权限：${fullRoleList}`} title={fullRoleList}>{roleSummary}</small>
          </div>
        </div>
      </aside>

      <main className="workspace">
        <header className="workspace-header">
          <div>
            <p className="eyebrow">LOCAL REVIEW · REPORT FUSION</p>
            <h1>多报表融合经营闭环</h1>
          </div>
          <button className="secondary" disabled={working} onClick={signOut} type="button">
            {working ? '正在安全退出…' : '退出登录'}
          </button>
        </header>

        <div className="simulation-banner" role="status">
          <strong>本机试点环境 · 报表只读采集已启用 · 企微UAT推送可配置</strong>
          <span>系统在08:00至次日02:00每30分钟采集、整点约06分发送；Webhook在本机加密保存，推送结果可追踪。</span>
        </div>

        {logoutError ? <div className="shell-error" role="alert">{logoutError}，当前会话仍保留。</div> : null}
        <HotelContextBar
          canCreate={session.account.roles.includes('PLATFORM_ADMIN')}
          context={context}
          onApply={(nextContext) => {
            setReportSourceAttention([])
            setContext(nextContext)
          }}
        />

        {page === 'connections' ? (
          <ReportSourceConfigPage
            attentionItems={reportSourceAttention}
            context={context}
            canConfigure={canAdminConfigure}
          />
        ) : null}
        {page === 'monitor' ? (
          <MonitorPage
            context={context}
            onOpenReportSources={(attention) => {
              setReportSourceAttention(attention)
              setPage('connections')
            }}
          />
        ) : null}
        {page === 'mapping' ? <MappingTargetPage context={context} canConfigure={canRevenueConfigure} /> : null}
        {page === 'history' ? (
          <HistoryPage
            context={context}
            canConfigure={canAdminConfigure}
          />
        ) : null}
      </main>
    </div>
  )
}

export default function App() {
  const [session, updateSession] = useState<AuthSession | null>(() => getSession())
  const [restoring, setRestoring] = useState(() => getSession() === null && hasRefreshContext())

  useEffect(() => {
    if (getSession() || !hasRefreshContext()) {
      setRestoring(false)
      return
    }
    let cancelled = false
    refreshSession()
      .then((restored) => {
        if (cancelled) return
        setSession(restored)
        updateSession(restored)
      })
      .catch(() => {
        if (cancelled) return
        clearSession()
        updateSession(null)
      })
      .finally(() => {
        if (!cancelled) setRestoring(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!session) return
    let cancelled = false
    const delayMs = Math.max(1_000, (session.expiresInSeconds - 60) * 1_000)
    const timer = window.setTimeout(() => {
      refreshSession()
        .then((refreshed) => {
          if (cancelled) return
          setSession(refreshed)
          updateSession(refreshed)
        })
        .catch(() => {
          if (cancelled) return
          clearSession()
          updateSession(null)
        })
    }, delayMs)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [session])

  if (restoring) {
    return <main className="login-layout" aria-live="polite">正在安全恢复会话…</main>
  }
  return session
    ? <SprintOneShell session={session} onLogout={() => updateSession(null)} />
    : <LoginPanel onAuthenticated={updateSession} />
}
