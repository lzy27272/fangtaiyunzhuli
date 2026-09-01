import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  createManagedAccount,
  listManagedAccounts,
  updateManagedAccount,
  type ManagedAccount,
} from '../api/auth'
import type { SimulationHotelView } from '../api/business'
import type { AuthSession, OtaRole } from '../auth/session'
import { EmptyState, Icon, LoadingState, Status } from '../components/ConsoleUi'

type PeopleTab = 'accounts' | 'roles' | 'audit'
const ROLE_LABELS: Record<OtaRole, string> = {
  PLATFORM_ADMIN: '管理员', OTA_OPERATION_ASSISTANT: 'OTA 运营助理',
  OTA_OPERATION_MANAGER: '运营总监', CEO: '总经理',
  REGIONAL_MANAGER: '区域经理', GENERAL_MANAGER: '店长',
  REVENUE_MANAGER: '已取消：收益经理', HOTEL_P1_HANDLER: '已取消：异常处理人',
}
const ROLE_OPTIONS: Array<[OtaRole, string]> = [
  ['PLATFORM_ADMIN', ROLE_LABELS.PLATFORM_ADMIN],
  ['GENERAL_MANAGER', ROLE_LABELS.GENERAL_MANAGER],
  ['OTA_OPERATION_MANAGER', ROLE_LABELS.OTA_OPERATION_MANAGER],
  ['OTA_OPERATION_ASSISTANT', ROLE_LABELS.OTA_OPERATION_ASSISTANT],
  ['CEO', ROLE_LABELS.CEO],
  ['REGIONAL_MANAGER', ROLE_LABELS.REGIONAL_MANAGER],
]
const ASSIGNABLE_ROLES = new Set<OtaRole>(ROLE_OPTIONS.map(([role]) => role))
const ROLE_TEMPLATES: Array<{ role: OtaRole; detail: string; permissions: string[] }> = [
  { role: 'PLATFORM_ADMIN', detail: '管理账号、门店与采集连接', permissions: ['全部门店', '查看与编辑采集配置', '登录修复', '人员权限'] },
  { role: 'GENERAL_MANAGER', detail: '负责指定门店的日常经营', permissions: ['门店总览', '经营数据', '播报记录', '登录修复'] },
  { role: 'OTA_OPERATION_MANAGER', detail: '统筹授权门店的运营工作', permissions: ['经营总览', '异常处理', '播报检查', '登录修复'] },
  { role: 'OTA_OPERATION_ASSISTANT', detail: '查看门店状态并协助修复', permissions: ['查看总览', '查看门店数据', '查看播报记录', '登录修复'] },
  { role: 'CEO', detail: '查看授权范围内的经营结果', permissions: ['经营总览', '经营数据', '异常记录', '登录修复'] },
  { role: 'REGIONAL_MANAGER', detail: '查看授权区域的全部门店', permissions: ['区域总览', '经营数据', '异常记录', '登录修复'] },
]

interface AccountDraft {
  username: string
  displayName: string
  password: string
  roles: OtaRole[]
  hotelIds: string[]
  enabled: boolean
}
const emptyDraft: AccountDraft = { username: '', displayName: '', password: '', roles: ['GENERAL_MANAGER'], hotelIds: [], enabled: true }

function fmt(value: string) {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).format(date)
}

export function PeoplePermissionsPage({ session, hotels }: { session: AuthSession; hotels: SimulationHotelView[] }) {
  const [tab, setTab] = useState<PeopleTab>('accounts')
  const [accounts, setAccounts] = useState<ManagedAccount[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [search, setSearch] = useState('')
  const [drawer, setDrawer] = useState<'create' | 'edit' | null>(null)
  const [editing, setEditing] = useState<ManagedAccount | null>(null)
  const [draft, setDraft] = useState<AccountDraft>(emptyDraft)
  const [saving, setSaving] = useState(false)

  const refresh = useCallback(async () => {
    setLoading(true); setError('')
    try { setAccounts(await listManagedAccounts(session)) }
    catch (cause) { setError(cause instanceof Error ? cause.message : '人员账号读取失败') }
    finally { setLoading(false) }
  }, [session])
  useEffect(() => { void refresh() }, [refresh])

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase()
    return accounts.filter((item) => !query || `${item.displayName} ${item.username} ${item.roles.join(' ')}`.toLowerCase().includes(query))
  }, [accounts, search])

  function toggle<T extends string>(values: T[], value: T) {
    return values.includes(value) ? values.filter((item) => item !== value) : [...values, value]
  }
  function openCreate() { setDraft(emptyDraft); setEditing(null); setError(''); setDrawer('create') }
  function openEdit(account: ManagedAccount) {
    setEditing(account)
    setDraft({ username: account.username, displayName: account.displayName, password: '', roles: account.roles.filter((role) => ASSIGNABLE_ROLES.has(role)), hotelIds: account.hotelIds ?? [], enabled: account.enabled })
    setError(''); setDrawer('edit')
  }

  async function save() {
    setSaving(true); setError(''); setNotice('')
    try {
      if (drawer === 'create') {
        const created = await createManagedAccount(session, {
          username: draft.username.trim(), displayName: draft.displayName.trim(), password: draft.password,
          roles: draft.roles, hotelIds: draft.hotelIds,
        })
        setAccounts((current) => [...current, created]); setNotice('账号已创建，门店权限已在服务端生效。')
      } else if (editing) {
        const updated = await updateManagedAccount(session, editing.id, {
          displayName: draft.displayName.trim(), roles: draft.roles, hotelIds: draft.hotelIds,
          enabled: draft.enabled, ...(draft.password ? { newPassword: draft.password } : {}),
        })
        setAccounts((current) => current.map((item) => item.id === updated.id ? updated : item)); setNotice('账号权限已更新，旧登录会话已失效。')
      }
      setDrawer(null)
    } catch (cause) { setError(cause instanceof Error ? cause.message : '账号保存失败') }
    finally { setSaving(false) }
  }

  const platformAdmins = accounts.filter((item) => item.roles.includes('PLATFORM_ADMIN')).length
  const enabledCount = accounts.filter((item) => item.enabled).length
  const administratorSelected = draft.roles.includes('PLATFORM_ADMIN')

  return (
    <section className="console-page people-page">
      <div className="page-title-row"><div><p className="section-kicker">PEOPLE & ACCESS</p><h1>人员与权限</h1><p>账号、角色和门店范围由服务端逐请求校验。</p></div><button className="primary-button" type="button" onClick={openCreate}><Icon name="plus" />新增账号</button></div>
      <div className="summary-strip"><div><span>全部账号</span><strong>{accounts.length}</strong><small>含管理员</small></div><div><span>启用账号</span><strong>{enabledCount}</strong><small>可正常登录</small></div><div><span>管理员</span><strong>{platformAdmins}</strong><small>拥有全部门店及采集配置权限</small></div></div>
      <nav className="store-tabs"><button className={tab === 'accounts' ? 'active' : ''} onClick={() => setTab('accounts')} type="button">账号与门店</button><button className={tab === 'roles' ? 'active' : ''} onClick={() => setTab('roles')} type="button">角色模板</button><button className={tab === 'audit' ? 'active' : ''} onClick={() => setTab('audit')} type="button">权限变更记录</button></nav>
      {notice ? <div className="inline-message success" role="status">{notice}</div> : null}
      {error && !drawer ? <div className="inline-message error" role="alert">{error}</div> : null}
      {loading ? <LoadingState label="正在读取人员账号…" /> : null}

      {!loading && tab === 'accounts' ? <>
        <div className="table-toolbar"><div><strong>{filtered.length} 个账号</strong></div><label className="search-field"><Icon name="search" /><input placeholder="搜索人员、账号或角色" value={search} onChange={(event) => setSearch(event.target.value)} /></label></div>
        <div className="data-table people-table"><div className="table-head"><span>人员</span><span>角色</span><span>门店范围</span><span>状态</span><span>最近更新</span><span /></div>{filtered.map((account) => <div className="table-row" key={account.id}><span className="person-cell"><i>{account.displayName.slice(0, 1)}</i><b>{account.displayName}<small>{account.username}</small></b></span><span>{account.roles.map((role) => ROLE_LABELS[role]).join('、')}</span><span>{account.hotelIds === null ? '全部门店' : `${account.hotelIds.length} 家门店`}</span><span><Status tone={account.enabled ? 'ok' : 'muted'}>{account.enabled ? '启用' : '停用'}</Status></span><span>{fmt(account.updatedAt)}</span><span><button className="text-link" type="button" onClick={() => openEdit(account)}>查看权限</button></span></div>)}</div>
        {!filtered.length ? <EmptyState title="未找到人员账号" detail="调整搜索条件或新增一个账号。" /> : null}
      </> : null}

      {!loading && tab === 'roles' ? <div className="role-template-list">{ROLE_TEMPLATES.map((template) => <article key={template.role}><div><span className="role-icon"><Icon name="shield" /></span><span><strong>{ROLE_LABELS[template.role]}</strong><small>{template.detail}</small></span></div><div className="permission-tags">{template.permissions.map((item) => <span key={item}>{item}</span>)}</div><Status tone="ok">系统模板</Status></article>)}</div> : null}

      {!loading && tab === 'audit' ? <div className="data-table audit-table"><div className="table-head"><span>时间</span><span>账号</span><span>记录类型</span><span>当前范围</span></div>{[...accounts].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).map((account) => <div className="table-row" key={account.id}><span>{fmt(account.updatedAt)}</span><span>{account.displayName}<small>{account.username}</small></span><span>{account.createdAt === account.updatedAt ? '账号创建' : '账号目录更新'}</span><span>{account.hotelIds === null ? '全部门店' : `${account.hotelIds.length} 家门店`}</span></div>)}</div> : null}

      {drawer ? <div className="drawer-backdrop" onMouseDown={() => setDrawer(null)}><aside className="side-drawer wide" onMouseDown={(event) => event.stopPropagation()}><header><div><p className="section-kicker">{drawer === 'create' ? 'NEW ACCOUNT' : 'ACCOUNT ACCESS'}</p><h2>{drawer === 'create' ? '新增管理账号' : '账号与门店权限'}</h2></div><button className="icon-button" type="button" onClick={() => setDrawer(null)}>×</button></header><div className="drawer-body form-stack"><label>登录账号<input disabled={drawer === 'edit'} value={draft.username} onChange={(event) => setDraft({ ...draft, username: event.target.value })} /></label><label>人员名称<input value={draft.displayName} onChange={(event) => setDraft({ ...draft, displayName: event.target.value })} /></label><label>{drawer === 'create' ? '初始密码' : '重置密码（不修改可留空）'}<input autoComplete="new-password" type="password" value={draft.password} onChange={(event) => setDraft({ ...draft, password: event.target.value })} /><small>至少 10 位，并包含三类字符</small></label>{drawer === 'edit' ? <label className="toggle-field"><input checked={draft.enabled} type="checkbox" onChange={(event) => setDraft({ ...draft, enabled: event.target.checked })} /><span>允许该账号登录</span></label> : null}<fieldset><legend>角色</legend><div className="checkbox-grid">{ROLE_OPTIONS.map(([code, label]) => <label key={code}><input checked={draft.roles.includes(code)} type="checkbox" onChange={() => setDraft({ ...draft, roles: toggle(draft.roles, code) })} />{label}</label>)}</div><small>只有管理员可以查看及编辑采集配置；其他角色仅能进入登录修复。</small></fieldset><fieldset><legend>可访问门店</legend>{administratorSelected ? <div className="inline-message success">管理员自动拥有全部门店权限，无需逐店勾选。</div> : <div className="checkbox-grid hotel-grid">{hotels.map((hotel) => <label key={hotel.hotelId}><input checked={draft.hotelIds.includes(hotel.hotelId)} type="checkbox" onChange={() => setDraft({ ...draft, hotelIds: toggle(draft.hotelIds, hotel.hotelId) })} /><span>{hotel.hotelCode} · {hotel.hotelName}</span></label>)}</div>}</fieldset>{error ? <div className="inline-message error" role="alert">{error}</div> : null}</div><footer><button className="quiet-button" type="button" onClick={() => setDrawer(null)}>取消</button><button className="primary-button" disabled={saving || !draft.displayName.trim() || drawer === 'create' && (!draft.username.trim() || !draft.password) || !draft.roles.length || (!administratorSelected && !draft.hotelIds.length)} type="button" onClick={() => void save()}>{saving ? '正在保存…' : '保存账号权限'}</button></footer></aside></div> : null}
    </section>
  )
}
