import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { hasRefreshContext, login, logout, refreshSession } from './api/auth'
import type { SimulationHotelView } from './api/business'
import { clearSession, getSession, setSession, type AuthSession } from './auth/session'
import { Brand, Icon, LoadingState } from './components/ConsoleUi'
import { ExceptionCenterPage } from './pages/ExceptionCenterPage'
import { NewStoreWizard } from './pages/NewStoreWizard'
import { PeoplePermissionsPage } from './pages/PeoplePermissionsPage'
import { PersonalSecurityPage } from './pages/PersonalSecurityPage'
import { loadAuthorizedHotels, StoreDetailPage, StoreOverviewPage, type StoreTab } from './pages/StoreConsolePage'

type AppPage = 'stores' | 'exceptions' | 'people' | 'security' | 'store-detail' | 'new-store'

function LoginPanel({ expired, onAuthenticated }: { expired: boolean; onAuthenticated: (session: AuthSession) => void }) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setSubmitting(true); setError('')
    try {
      const session = await login(username.trim(), password)
      setSession(session); setPassword(''); onAuthenticated(session)
    } catch (cause) { setError(cause instanceof Error ? cause.message : '登录失败，请稍后重试') }
    finally { setSubmitting(false) }
  }

  return <main className="new-login-page">
    <header className="login-header"><Brand /><span>酒店经营自动化后台</span></header>
    <div className="login-content">
      <section className="login-intro"><p className="section-kicker">四方馆酒店经营中心</p><h1>让每一家门店的<br />数据与播报<span>清晰可控</span></h1><p>统一管理酒店系统、渠道数据连接、采集状态和企业微信播报，账号只访问已授权门店。</p><ul><li><Icon name="shield" />门店级权限隔离</li><li><Icon name="radio" />采集与播报状态可追踪</li><li><Icon name="alert" />异常一键直达处理</li></ul></section>
      <section className="new-login-panel"><form onSubmit={submit}>
        <div className="login-form-title"><span className="brand-mark"><Icon name="hotel" /></span><div><h2>登录经营中心</h2><p>使用平台管理账号登录</p></div></div>
        {expired ? <div className="session-expired"><Icon name="alert" /><span><strong>登录会话已过期</strong><small>请重新登录，未保存的账号密码不会被保留。</small></span></div> : null}
        <label>登录账号<input autoComplete="username" autoFocus required value={username} onChange={(event) => setUsername(event.target.value)} placeholder="请输入账号" /></label>
        <label>登录密码<input autoComplete="current-password" required type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="请输入密码" /></label>
        {error ? <div className="inline-message error" role="alert">{error}</div> : null}
        <button className="primary-button login-submit" disabled={submitting || !username.trim() || !password} type="submit">{submitting ? '正在安全验证…' : '登录'}<Icon name="arrow" /></button>
        <p className="login-help">忘记账号或密码，请联系平台管理员处理。</p>
      </form></section>
    </div>
    <footer className="login-footer">四方馆酒店经营中心 · 登录资料与业务平台凭据严格分离</footer>
  </main>
}

function ConsoleShell({ session, onSessionChange, onSignedOut }: { session: AuthSession; onSessionChange: (session: AuthSession) => void; onSignedOut: () => void }) {
  const [page, setPage] = useState<AppPage>('stores')
  const [hotels, setHotels] = useState<SimulationHotelView[]>([])
  const [selectedHotel, setSelectedHotel] = useState<SimulationHotelView | null>(null)
  const [selectedTab, setSelectedTab] = useState<StoreTab>('overview')
  const [loadingDirectory, setLoadingDirectory] = useState(true)
  const [directoryError, setDirectoryError] = useState('')
  const [working, setWorking] = useState(false)
  const [accountMenu, setAccountMenu] = useState(false)
  const [mobileMenu, setMobileMenu] = useState(false)

  const platformAdmin = session.account.roles.includes('PLATFORM_ADMIN')
  const canConfigure = platformAdmin
  const canRevenueConfigure = platformAdmin || session.account.roles.includes('OTA_OPERATION_MANAGER')

  const refreshHotels = useCallback(async () => {
    setLoadingDirectory(true); setDirectoryError('')
    try {
      const rows = await loadAuthorizedHotels()
      const allowed = session.account.hotelIds === null ? rows : rows.filter((hotel) => session.account.hotelIds?.includes(hotel.hotelId))
      setHotels(allowed)
      setSelectedHotel((current) => current ? allowed.find((hotel) => hotel.hotelId === current.hotelId) ?? null : null)
    } catch (cause) { setDirectoryError(cause instanceof Error ? cause.message : '门店目录读取失败') }
    finally { setLoadingDirectory(false) }
  }, [session.account.hotelIds])
  useEffect(() => { void refreshHotels() }, [refreshHotels])

  const navigate = (next: AppPage) => { setPage(next); setAccountMenu(false); setMobileMenu(false) }
  const openHotel = (hotel: SimulationHotelView, tab: StoreTab = 'overview') => { setSelectedHotel(hotel); setSelectedTab(tab); navigate('store-detail') }
  const activeTopPage = page === 'store-detail' || page === 'new-store' ? 'stores' : page

  async function signOut() {
    setWorking(true)
    try { await logout(); clearSession(); onSignedOut() }
    catch (reason) {
      setDirectoryError(reason instanceof Error ? `${reason.message}，当前会话仍保留。` : '退出失败，当前会话仍保留。')
    }
    finally { setWorking(false) }
  }
  const storeLabel = useMemo(() => `${hotels.length} 家门店`, [hotels.length])

  return <div className="console-shell">
    <header className="console-header">
      <Brand />
      <button className="mobile-menu-button" type="button" onClick={() => setMobileMenu((value) => !value)} aria-label="打开导航">☰</button>
      <nav className={mobileMenu ? 'mobile-open' : ''} aria-label="全局导航">
        <button className={activeTopPage === 'stores' ? 'active' : ''} type="button" onClick={() => navigate('stores')}><Icon name="hotel" />门店总览</button>
        <button className={activeTopPage === 'exceptions' ? 'active' : ''} type="button" onClick={() => navigate('exceptions')}><Icon name="alert" />异常处理</button>
        {platformAdmin ? <button className={activeTopPage === 'people' ? 'active' : ''} type="button" onClick={() => navigate('people')}><Icon name="users" />人员与权限</button> : null}
      </nav>
      <div className="header-actions">
        <span className="scope-badge">{session.account.hotelIds === null ? `全部门店 · ${hotels.length}家` : storeLabel}</span>
        <div className="account-menu-wrap"><button className="account-trigger" type="button" onClick={() => setAccountMenu((value) => !value)}><span>{session.account.displayName.slice(0, 1)}</span><b>{session.account.displayName}<small>{platformAdmin ? '管理员' : '门店管理账号'}</small></b><span className="caret">⌄</span></button>{accountMenu ? <div className="account-popover"><button type="button" onClick={() => navigate('security')}><Icon name="shield" />账号安全</button><button disabled={working} type="button" onClick={() => void signOut()}><Icon name="logout" />{working ? '正在退出…' : '退出登录'}</button></div> : null}</div>
      </div>
    </header>
    <main className="console-main">
      {loadingDirectory && page !== 'security' ? <LoadingState label="正在载入授权门店…" /> : null}
      {page === 'stores' ? <StoreOverviewPage hotels={hotels} loadingDirectory={loadingDirectory} directoryError={directoryError} canCreate={platformAdmin} onCreate={() => navigate('new-store')} onOpen={openHotel} onOpenException={() => navigate('exceptions')} onRefreshDirectory={() => void refreshHotels()} /> : null}
      {page === 'store-detail' && selectedHotel ? <StoreDetailPage hotel={selectedHotel} initialTab={selectedTab} canConfigure={canConfigure} canRevenueConfigure={canRevenueConfigure} onBack={() => navigate('stores')} onOpenExceptions={() => navigate('exceptions')} /> : null}
      {page === 'new-store' && platformAdmin ? <NewStoreWizard session={session} onCancel={() => navigate('stores')} onCreated={(hotel) => { void refreshHotels(); openHotel(hotel, 'collection') }} /> : null}
      {page === 'exceptions' ? <ExceptionCenterPage hotels={hotels} onOpenStore={openHotel} /> : null}
      {page === 'people' && platformAdmin ? <PeoplePermissionsPage session={session} hotels={hotels} /> : null}
      {page === 'security' ? <PersonalSecurityPage session={session} onSessionChange={onSessionChange} /> : null}
    </main>
  </div>
}

export default function App() {
  const initialSession = getSession()
  const [session, updateSession] = useState<AuthSession | null>(initialSession)
  const [restoring, setRestoring] = useState(initialSession === null && hasRefreshContext())
  const [expired, setExpired] = useState(false)

  useEffect(() => {
    if (getSession() || !hasRefreshContext()) { setRestoring(false); return }
    let cancelled = false
    refreshSession().then((restored) => { if (!cancelled) { setSession(restored); updateSession(restored) } }).catch(() => { if (!cancelled) { clearSession(); updateSession(null); setExpired(true) } }).finally(() => { if (!cancelled) setRestoring(false) })
    return () => { cancelled = true }
  }, [])
  useEffect(() => {
    if (!session) return
    let cancelled = false
    const timer = window.setTimeout(() => { refreshSession().then((refreshed) => { if (!cancelled) { setSession(refreshed); updateSession(refreshed) } }).catch(() => { if (!cancelled) { clearSession(); updateSession(null); setExpired(true) } }) }, Math.max(1_000, (session.expiresInSeconds - 60) * 1_000))
    return () => { cancelled = true; window.clearTimeout(timer) }
  }, [session])

  if (restoring) return <main className="restore-screen"><Brand /><LoadingState label="正在安全恢复会话…" /></main>
  return session ? <ConsoleShell session={session} onSessionChange={(next) => { setSession(next); updateSession(next) }} onSignedOut={() => updateSession(null)} /> : <LoginPanel expired={expired} onAuthenticated={(next) => { setExpired(false); updateSession(next) }} />
}
