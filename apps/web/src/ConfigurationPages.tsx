import { useEffect, useMemo, useState } from 'react'
import { apiRequest, asList } from './api/client'
import type { RoleContext } from './domain'

type Row = Record<string, unknown>
type OrgUnit = { id: string; parentId?: string; code: string; name: string; unitType: string; status: string; sortOrder: number; propertyCode?: string; city?: string; roomCount?: number; openingDate?: string }
type Position = { id: string; code: string; name: string; jobFamily: string; levelCode?: string; status: string }
type Employee = { id: string; accountId?: string; loginName?: string; employeeNo: string; name: string; mobile?: string; hiredOn?: string; employmentStatus: string; accountStatus?: string; assignmentId?: string; orgUnitId?: string; orgUnitName?: string; positionId?: string; positionName?: string; primary?: boolean }
type Role = { id: string; code: string; name: string }
type PackageRow = { id: string; code: string; name: string; positionName: string; lifecycleStatus: string; versionNo: number; latestVersionId?: string; ownerOrgName?: string }
type SelectRow = { id: string; code: string; name: string; status?: string; versionId?: string; positionId?: string }
type AllocationRow = { id: string; assignmentId: string; targetOrgName: string; assigneeName: string; status: string; validFrom: string }

const field = (row: Row, ...keys: string[]) => keys.map((key) => row[key]).find((value) => value !== undefined && value !== null)
const text = (row: Row, ...keys: string[]) => String(field(row, ...keys) ?? '')
const bool = (row: Row, ...keys: string[]) => Boolean(field(row, ...keys))
const jsonObject = (candidate: unknown): Row => {
  if (candidate && typeof candidate === 'object' && !Array.isArray(candidate)) return candidate as Row
  if (typeof candidate === 'string') { try { const parsed: unknown = JSON.parse(candidate); return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Row : {} } catch { return {} } }
  return {}
}

async function loadSetup(identity: RoleContext, includeRoles: boolean) {
  const [orgRaw, positionRaw, employeeRaw, roleRaw] = await Promise.all([
    apiRequest<unknown>('/org/units', identity), apiRequest<unknown>('/org/positions', identity),
    apiRequest<unknown>('/org/employees', identity), includeRoles ? apiRequest<unknown>('/iam/roles', identity) : Promise.resolve([]),
  ])
  const orgUnits = asList<Row>(orgRaw).map((row): OrgUnit => ({
    id: text(row, 'id'), parentId: text(row, 'parent_id', 'parentId') || undefined,
    code: text(row, 'code'), name: text(row, 'name'), unitType: text(row, 'unit_type', 'unitType'),
    status: text(row, 'status') || 'ACTIVE', sortOrder: Number(field(row, 'sort_order', 'sortOrder') ?? 0),
    propertyCode: text(row, 'property_code', 'propertyCode') || undefined,
    city: text(row, 'city') || undefined, roomCount: field(row, 'room_count', 'roomCount') === undefined ? undefined : Number(field(row, 'room_count', 'roomCount')),
    openingDate: text(row, 'opening_date', 'openingDate') || undefined,
  }))
  const positions = asList<Row>(positionRaw).map((row): Position => ({
    id: text(row, 'id'), code: text(row, 'code'), name: text(row, 'name'),
    jobFamily: text(row, 'job_family', 'jobFamily'), levelCode: text(row, 'level_code', 'levelCode') || undefined,
    status: text(row, 'status') || 'ACTIVE',
  }))
  const employees = asList<Row>(employeeRaw).map((row): Employee => ({
    id: text(row, 'id'), accountId: text(row, 'account_id', 'accountId') || undefined,
    loginName: text(row, 'login_name', 'loginName') || undefined, employeeNo: text(row, 'employee_no', 'employeeNo'),
    name: text(row, 'name'), mobile: text(row, 'mobile') || undefined,
    hiredOn: text(row, 'hired_on', 'hiredOn') || undefined,
    employmentStatus: text(row, 'employment_status', 'employmentStatus') || 'ACTIVE',
    accountStatus: text(row, 'account_status', 'accountStatus') || undefined,
    assignmentId: text(row, 'assignment_id', 'assignmentId') || undefined,
    orgUnitId: text(row, 'org_unit_id', 'orgUnitId') || undefined, orgUnitName: text(row, 'org_unit_name', 'orgUnitName') || undefined,
    positionId: text(row, 'position_id', 'positionId') || undefined, positionName: text(row, 'position_name', 'positionName') || undefined,
    primary: bool(row, 'is_primary', 'primary'),
  }))
  const roles = asList<Row>(roleRaw).map((row): Role => ({ id: text(row, 'id'), code: text(row, 'code'), name: text(row, 'name') }))
  return { orgUnits, positions, employees, roles }
}

function Modal({ title, children, onClose, onSave, saving, saveLabel = '保存' }: { title: string; children: React.ReactNode; onClose: () => void; onSave: () => void; saving: boolean; saveLabel?: string }) {
  return <div className="modal-backdrop"><section className="modal configuration-modal" role="dialog" aria-modal="true">
    <header><div><span className="panel-kicker">CONFIGURATION</span><h2>{title}</h2></div><button className="close" onClick={onClose}>×</button></header>
    <div className="form-body configuration-form">{children}</div>
    <footer><button className="secondary" onClick={onClose}>取消</button><button className="primary" disabled={saving} onClick={onSave}>{saving ? '保存中…' : saveLabel}</button></footer>
  </section></div>
}

export function OrganizationCenter({ identity, permissions }: { identity: RoleContext; permissions: string[] }) {
  const canManage = permissions.includes('org.manage') || permissions.includes('*')
  const canGrant = permissions.includes('iam.manage') || permissions.includes('*')
  const [data, setData] = useState<{ orgUnits: OrgUnit[]; positions: Position[]; employees: Employee[]; roles: Role[] }>({ orgUnits: [], positions: [], employees: [], roles: [] })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string>()
  const [modal, setModal] = useState<'org' | 'position' | 'employee' | 'assignment'>()
  const [editingId, setEditingId] = useState<string>()
  const [saving, setSaving] = useState(false)
  const [tab, setTab] = useState<'org' | 'position' | 'employee'>('org')
  const [orgForm, setOrgForm] = useState({ unitType: 'HOTEL', parentId: '', code: '', name: '', propertyCode: '', city: '', roomCount: '', openingDate: '', sortOrder: '0', status: 'ACTIVE' })
  const [positionForm, setPositionForm] = useState({ code: '', name: '', jobFamily: '酒店运营', levelCode: '', status: 'ACTIVE' })
  const [employeeForm, setEmployeeForm] = useState({ employeeNo: '', name: '', mobile: '', hiredOn: new Date().toISOString().slice(0, 10), loginName: '', temporaryPassword: '', employmentStatus: 'ACTIVE' })
  const [assignmentForm, setAssignmentForm] = useState({ employeeId: '', orgUnitId: '', positionId: '', managerAssignmentId: '', primary: true, assignmentType: 'PERMANENT', roleId: '' })

  const reload = async () => {
    setLoading(true); setError(undefined)
    try { setData(await loadSetup(identity, canGrant)) } catch (reason) { setError(reason instanceof Error ? reason.message : '组织数据加载失败') }
    finally { setLoading(false) }
  }
  useEffect(() => { void reload() }, [identity.key, canGrant])
  const orgDepth = useMemo(() => {
    const byId = new Map(data.orgUnits.map((item) => [item.id, item]))
    const depth = (item: OrgUnit) => { let result = 0; let current = item; const seen = new Set<string>(); while (current.parentId && byId.has(current.parentId) && !seen.has(current.id)) { seen.add(current.id); result += 1; current = byId.get(current.parentId)! } return result }
    return new Map(data.orgUnits.map((item) => [item.id, depth(item)]))
  }, [data.orgUnits])
  const primaryEmployees = useMemo(() => {
    const grouped = new Map<string, Employee[]>()
    for (const employee of data.employees) grouped.set(employee.id, [...(grouped.get(employee.id) ?? []), employee])
    return [...grouped.values()].map((rows) => rows.find((row) => row.primary) ?? rows[0])
  }, [data.employees])

  const closeModal = () => { setModal(undefined); setEditingId(undefined) }
  const openCreate = (kind: 'org' | 'position' | 'employee') => {
    setEditingId(undefined); setError(undefined)
    if (kind === 'org') setOrgForm({ unitType: 'HOTEL', parentId: '', code: '', name: '', propertyCode: '', city: '', roomCount: '', openingDate: '', sortOrder: '0', status: 'ACTIVE' })
    if (kind === 'position') setPositionForm({ code: '', name: '', jobFamily: '酒店运营', levelCode: '', status: 'ACTIVE' })
    if (kind === 'employee') setEmployeeForm({ employeeNo: '', name: '', mobile: '', hiredOn: new Date().toISOString().slice(0, 10), loginName: '', temporaryPassword: '', employmentStatus: 'ACTIVE' })
    setModal(kind)
  }
  const openOrgEdit = (item: OrgUnit) => {
    setEditingId(item.id); setError(undefined)
    setOrgForm({ unitType: item.unitType, parentId: item.parentId ?? '', code: item.code, name: item.name, propertyCode: item.propertyCode ?? '', city: item.city ?? '', roomCount: item.roomCount === undefined ? '' : String(item.roomCount), openingDate: item.openingDate ?? '', sortOrder: String(item.sortOrder), status: item.status })
    setModal('org')
  }
  const openPositionEdit = (item: Position) => {
    setEditingId(item.id); setError(undefined)
    setPositionForm({ code: item.code, name: item.name, jobFamily: item.jobFamily, levelCode: item.levelCode ?? '', status: item.status })
    setModal('position')
  }
  const openEmployeeEdit = (item: Employee) => {
    setEditingId(item.id); setError(undefined)
    setEmployeeForm({ employeeNo: item.employeeNo, name: item.name, mobile: item.mobile ?? '', hiredOn: item.hiredOn ?? '', loginName: item.loginName ?? '', temporaryPassword: '', employmentStatus: item.employmentStatus })
    setModal('employee')
  }
  const orgBody = (form = orgForm) => ({ code: form.code, name: form.name, sortOrder: form.sortOrder ? Number(form.sortOrder) : 0, status: form.status, propertyCode: form.unitType === 'HOTEL' ? form.propertyCode : null, city: form.unitType === 'HOTEL' ? form.city || null : null, roomCount: form.unitType === 'HOTEL' && form.roomCount ? Number(form.roomCount) : null, openingDate: form.unitType === 'HOTEL' ? form.openingDate || null : null })
  const positionBody = (form = positionForm) => ({ code: form.code, name: form.name, jobFamily: form.jobFamily, levelCode: form.levelCode || null, status: form.status })
  const employeeBody = (form = employeeForm) => ({ employeeNo: form.employeeNo, name: form.name, mobile: form.mobile || null, hiredOn: form.hiredOn || null, employmentStatus: form.employmentStatus, loginName: form.loginName || null, temporaryPassword: form.temporaryPassword || null })
  const runMaintenance = async (request: () => Promise<unknown>, fallback: string) => {
    setSaving(true); setError(undefined)
    try { await request(); await reload() }
    catch (reason) { setError(reason instanceof Error ? reason.message : fallback) }
    finally { setSaving(false) }
  }
  const toggleOrg = (item: OrgUnit) => runMaintenance(() => apiRequest(`/org/units/${item.id}`, identity, { method: 'PUT', body: JSON.stringify(orgBody({ ...orgForm, unitType: item.unitType, code: item.code, name: item.name, sortOrder: String(item.sortOrder), status: item.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE', propertyCode: item.propertyCode ?? '', city: item.city ?? '', roomCount: item.roomCount === undefined ? '' : String(item.roomCount), openingDate: item.openingDate ?? '', parentId: item.parentId ?? '' })) }), '组织状态修改失败')
  const togglePosition = (item: Position) => runMaintenance(() => apiRequest(`/org/positions/${item.id}`, identity, { method: 'PUT', body: JSON.stringify(positionBody({ code: item.code, name: item.name, jobFamily: item.jobFamily, levelCode: item.levelCode ?? '', status: item.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE' })) }), '岗位状态修改失败')
  const toggleEmployee = (item: Employee) => runMaintenance(() => apiRequest(`/org/employees/${item.id}`, identity, { method: 'PUT', body: JSON.stringify(employeeBody({ employeeNo: item.employeeNo, name: item.name, mobile: item.mobile ?? '', hiredOn: item.hiredOn ?? '', loginName: item.loginName ?? '', temporaryPassword: '', employmentStatus: item.employmentStatus === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE' })) }), '员工状态修改失败')
  const deleteMasterData = async (kind: 'units' | 'positions' | 'employees', id: string, name: string) => {
    if (!window.confirm(`确认永久删除“${name}”？\n\n仅未被业务数据引用且已停用的数据允许删除；有历史记录的数据会被系统拒绝。`)) return
    await runMaintenance(() => apiRequest(`/org/${kind}/${id}`, identity, { method: 'DELETE' }), '删除失败')
  }
  const submit = async () => {
    setSaving(true); setError(undefined)
    try {
      if (modal === 'org') {
        if (editingId) await apiRequest(`/org/units/${editingId}`, identity, { method: 'PUT', body: JSON.stringify(orgBody()) })
        else await apiRequest('/org/units', identity, { method: 'POST', body: JSON.stringify({ unitType: orgForm.unitType, parentId: orgForm.parentId || null, code: orgForm.code, name: orgForm.name, propertyCode: orgForm.unitType === 'HOTEL' ? orgForm.propertyCode : null, city: orgForm.city || null, roomCount: orgForm.roomCount ? Number(orgForm.roomCount) : null, openingDate: orgForm.openingDate || null, sortOrder: orgForm.sortOrder ? Number(orgForm.sortOrder) : 0 }) })
      }
      if (modal === 'position') {
        if (editingId) await apiRequest(`/org/positions/${editingId}`, identity, { method: 'PUT', body: JSON.stringify(positionBody()) })
        else await apiRequest('/org/positions', identity, { method: 'POST', body: JSON.stringify({ code: positionForm.code, name: positionForm.name, jobFamily: positionForm.jobFamily, levelCode: positionForm.levelCode || null }) })
      }
      if (modal === 'employee') {
        if (editingId) await apiRequest(`/org/employees/${editingId}`, identity, { method: 'PUT', body: JSON.stringify(employeeBody()) })
        else await apiRequest('/org/employees', identity, { method: 'POST', body: JSON.stringify({ employeeNo: employeeForm.employeeNo, name: employeeForm.name, mobile: employeeForm.mobile || null, hiredOn: employeeForm.hiredOn || null, loginName: employeeForm.loginName || null, temporaryPassword: employeeForm.temporaryPassword || null }) })
      }
      if (modal === 'assignment') {
        const selected = primaryEmployees.find((item) => item.id === assignmentForm.employeeId)
        await apiRequest(`/org/employees/${assignmentForm.employeeId}/assignments`, identity, { method: 'POST', body: JSON.stringify({ orgUnitId: assignmentForm.orgUnitId, positionId: assignmentForm.positionId, managerAssignmentId: assignmentForm.managerAssignmentId || null, primary: assignmentForm.primary, assignmentType: assignmentForm.assignmentType, validFrom: new Date().toISOString().slice(0, 10), validTo: null }) })
        if (assignmentForm.roleId && selected?.accountId) await apiRequest('/iam/role-assignments', identity, { method: 'POST', body: JSON.stringify({ accountId: selected.accountId, roleId: assignmentForm.roleId, scopeOrgUnitId: assignmentForm.orgUnitId, scopeType: 'ORG_TREE', validFrom: new Date().toISOString(), validTo: null }) })
      }
      closeModal(); await reload()
    } catch (reason) { setError(reason instanceof Error ? reason.message : '保存失败') }
    finally { setSaving(false) }
  }

  return <section className="page-section configuration-page">
    <header className="page-title"><div><span className="eyebrow">ORGANIZATION & ACCESS</span><h1>组织、岗位与人员</h1><p>集团统一配置，门店账号只读取授权组织树；同一员工可绑定多个任职。</p></div><div className="page-actions"><span className="source-flag api">真实 PostgreSQL</span></div></header>
    <div className="config-tabs"><button className={tab === 'org' ? 'active' : ''} onClick={() => setTab('org')}>门店与部门</button><button className={tab === 'position' ? 'active' : ''} onClick={() => setTab('position')}>岗位字典</button><button className={tab === 'employee' ? 'active' : ''} onClick={() => setTab('employee')}>人员与任职</button></div>
    {error && <div className="inline-error page-error">{error}</div>}
    {loading ? <div className="state-card"><div className="spinner" /><strong>正在读取组织权限数据</strong></div> : <article className="panel table-panel config-panel">
      <header><div><span className="panel-kicker">{tab.toUpperCase()}</span><h2>{tab === 'org' ? '组织层级' : tab === 'position' ? '岗位定义' : '员工账号与多岗位任职'}</h2></div>{canManage && <div className="panel-actions">{tab === 'employee' && <button className="secondary" onClick={() => { setEditingId(undefined); setModal('assignment') }}>＋ 分配任职</button>}<button className="primary" onClick={() => openCreate(tab === 'org' ? 'org' : tab === 'position' ? 'position' : 'employee')}>＋ 新建{tab === 'org' ? '组织' : tab === 'position' ? '岗位' : '员工'}</button></div>}</header>
      {tab === 'org' && <div className="config-list">{data.orgUnits.map((item) => <div className={`config-row ${item.status === 'INACTIVE' ? 'inactive-row' : ''}`} key={item.id} style={{ paddingLeft: `${18 + (orgDepth.get(item.id) ?? 0) * 28}px` }}><i className={`org-icon ${item.unitType.toLowerCase()}`}>{item.unitType === 'HOTEL' ? '店' : item.unitType === 'DEPARTMENT' ? '部' : item.unitType === 'REGION' ? '区' : '集'}</i><span><strong>{item.name}</strong><small>{item.code} · {item.unitType}{item.city ? ` · ${item.city}` : ''}{item.roomCount !== undefined ? ` · ${item.roomCount}间` : ''}</small></span><b className={item.status === 'INACTIVE' ? 'inactive' : ''}>{item.status === 'ACTIVE' ? '启用' : '已停用'}</b>{canManage && <div className="maintenance-actions"><button className="text-action" onClick={() => openOrgEdit(item)}>编辑</button>{item.unitType !== 'GROUP' && <button className="text-action" disabled={saving} onClick={() => void toggleOrg(item)}>{item.status === 'ACTIVE' ? '停用' : '启用'}</button>}<button className="text-action danger" disabled={saving || item.status === 'ACTIVE' || item.unitType === 'GROUP'} title={item.status === 'ACTIVE' ? '请先停用后再删除' : '仅无历史引用的数据可删除'} onClick={() => void deleteMasterData('units', item.id, item.name)}>删除</button></div>}</div>)}</div>}
      {tab === 'position' && <div className="simple-table maintenance-table"><div className="simple-head"><span>岗位编码</span><span>岗位名称</span><span>职族</span><span>职级</span><span>状态与操作</span></div>{data.positions.map((item) => <div className={item.status === 'INACTIVE' ? 'inactive-row' : ''} key={item.id}><span>{item.code}</span><strong>{item.name}</strong><span>{item.jobFamily}</span><span>{item.levelCode || '—'}</span><span className="table-maintenance"><b className={`status-pill ${item.status.toLowerCase()}`}>{item.status === 'ACTIVE' ? '启用' : '已停用'}</b>{canManage && <span className="maintenance-actions"><button className="text-action" onClick={() => openPositionEdit(item)}>编辑</button><button className="text-action" disabled={saving} onClick={() => void togglePosition(item)}>{item.status === 'ACTIVE' ? '停用' : '启用'}</button><button className="text-action danger" disabled={saving || item.status === 'ACTIVE'} title={item.status === 'ACTIVE' ? '请先停用后再删除' : '仅无历史引用的数据可删除'} onClick={() => void deleteMasterData('positions', item.id, item.name)}>删除</button></span>}</span></div>)}</div>}
      {tab === 'employee' && <div className="simple-table employees-table maintenance-table"><div className="simple-head"><span>员工</span><span>登录账号</span><span>组织</span><span>岗位</span><span>任职</span><span>状态与操作</span></div>{data.employees.map((item) => <div className={item.employmentStatus === 'INACTIVE' ? 'inactive-row' : ''} key={`${item.id}:${item.assignmentId ?? 'none'}`}><span><strong>{item.name}</strong><small>{item.employeeNo}</small></span><span>{item.loginName || '未开通'}</span><span>{item.orgUnitName || '待分配'}</span><span>{item.positionName || '待分配'}</span><span>{item.primary ? '主岗' : item.assignmentId ? '兼岗' : '—'}</span><span className="table-maintenance"><b className={`status-pill ${item.employmentStatus.toLowerCase()}`}>{item.employmentStatus === 'ACTIVE' ? '启用' : '已停用'}</b>{canManage && <span className="maintenance-actions"><button className="text-action" onClick={() => openEmployeeEdit(item)}>编辑</button><button className="text-action" disabled={saving} onClick={() => void toggleEmployee(item)}>{item.employmentStatus === 'ACTIVE' ? '停用' : '启用'}</button><button className="text-action danger" disabled={saving || item.employmentStatus === 'ACTIVE'} title={item.employmentStatus === 'ACTIVE' ? '请先停用后再删除' : '仅无历史引用的数据可删除'} onClick={() => void deleteMasterData('employees', item.id, item.name)}>删除</button></span>}</span></div>)}</div>}
    </article>}

    {modal === 'org' && <Modal title={editingId ? '编辑组织/门店' : '新建组织/门店'} onClose={closeModal} onSave={submit} saving={saving}><div className="form-grid"><label>组织类型<select disabled={Boolean(editingId)} value={orgForm.unitType} onChange={(event) => setOrgForm({ ...orgForm, unitType: event.target.value })}><option value="REGION">区域</option><option value="HOTEL">门店</option><option value="DEPARTMENT">部门</option><option value="GROUP">集团</option></select></label><label>上级组织<select disabled={Boolean(editingId)} value={orgForm.parentId} onChange={(event) => setOrgForm({ ...orgForm, parentId: event.target.value })}><option value="">无（仅集团）</option>{data.orgUnits.filter((item) => item.status === 'ACTIVE').map((item) => <option value={item.id} key={item.id}>{item.name} · {item.unitType}</option>)}</select></label><label>组织编码<input value={orgForm.code} onChange={(event) => setOrgForm({ ...orgForm, code: event.target.value })} /></label><label>组织名称<input value={orgForm.name} onChange={(event) => setOrgForm({ ...orgForm, name: event.target.value })} /></label><label>排序<input type="number" min="0" value={orgForm.sortOrder} onChange={(event) => setOrgForm({ ...orgForm, sortOrder: event.target.value })} /></label>{editingId && <label>状态<select disabled={orgForm.unitType === 'GROUP'} value={orgForm.status} onChange={(event) => setOrgForm({ ...orgForm, status: event.target.value })}><option value="ACTIVE">启用</option><option value="INACTIVE">停用</option></select></label>}{orgForm.unitType === 'HOTEL' && <><label>门店编码<input value={orgForm.propertyCode} onChange={(event) => setOrgForm({ ...orgForm, propertyCode: event.target.value })} /></label><label>城市<input value={orgForm.city} onChange={(event) => setOrgForm({ ...orgForm, city: event.target.value })} /></label><label>房间数<input type="number" min="0" value={orgForm.roomCount} onChange={(event) => setOrgForm({ ...orgForm, roomCount: event.target.value })} /></label><label>开业日期<input type="date" value={orgForm.openingDate} onChange={(event) => setOrgForm({ ...orgForm, openingDate: event.target.value })} /></label></>}</div>{editingId && <div className="inline-warning">为保护组织树与历史权限，编辑时不允许更改组织类型和上级组织。</div>}</Modal>}
    {modal === 'position' && <Modal title={editingId ? '编辑岗位' : '新建岗位'} onClose={closeModal} onSave={submit} saving={saving}><div className="form-grid"><label>岗位编码<input value={positionForm.code} onChange={(event) => setPositionForm({ ...positionForm, code: event.target.value })} /></label><label>岗位名称<input value={positionForm.name} onChange={(event) => setPositionForm({ ...positionForm, name: event.target.value })} /></label><label>职族<input value={positionForm.jobFamily} onChange={(event) => setPositionForm({ ...positionForm, jobFamily: event.target.value })} /></label><label>职级<input value={positionForm.levelCode} onChange={(event) => setPositionForm({ ...positionForm, levelCode: event.target.value })} /></label>{editingId && <label>状态<select value={positionForm.status} onChange={(event) => setPositionForm({ ...positionForm, status: event.target.value })}><option value="ACTIVE">启用</option><option value="INACTIVE">停用</option></select></label>}</div></Modal>}
    {modal === 'employee' && <Modal title={editingId ? '编辑员工与登录账号' : '新建员工与登录账号'} onClose={closeModal} onSave={submit} saving={saving}><div className="form-grid"><label>员工编号<input value={employeeForm.employeeNo} onChange={(event) => setEmployeeForm({ ...employeeForm, employeeNo: event.target.value })} /></label><label>姓名<input value={employeeForm.name} onChange={(event) => setEmployeeForm({ ...employeeForm, name: event.target.value })} /></label><label>手机号<input value={employeeForm.mobile} onChange={(event) => setEmployeeForm({ ...employeeForm, mobile: event.target.value })} /></label><label>入职日期<input type="date" value={employeeForm.hiredOn} onChange={(event) => setEmployeeForm({ ...employeeForm, hiredOn: event.target.value })} /></label><label>登录账号<input autoComplete="off" value={employeeForm.loginName} onChange={(event) => setEmployeeForm({ ...employeeForm, loginName: event.target.value })} placeholder="姓名拼音或工号" /></label><label>{editingId ? '重置密码（选填）' : '初始密码'}<input type="password" autoComplete="new-password" value={employeeForm.temporaryPassword} onChange={(event) => setEmployeeForm({ ...employeeForm, temporaryPassword: event.target.value })} placeholder={editingId ? '留空则不修改密码' : '至少10位'} /></label>{editingId && <label>在职状态<select value={employeeForm.employmentStatus} onChange={(event) => setEmployeeForm({ ...employeeForm, employmentStatus: event.target.value })}><option value="ACTIVE">启用</option><option value="INACTIVE">停用</option></select></label>}</div><div className="inline-warning">{editingId ? '停用员工会同步停用账号、结束有效任职和角色授权；重新启用不会自动恢复旧授权。' : '初始密码仅本次创建时使用，请通过安全渠道交给员工。'}</div></Modal>}
    {modal === 'assignment' && <Modal title="分配岗位与角色范围" onClose={closeModal} onSave={submit} saving={saving}><div className="form-grid"><label>员工<select value={assignmentForm.employeeId} onChange={(event) => setAssignmentForm({ ...assignmentForm, employeeId: event.target.value })}><option value="">请选择</option>{primaryEmployees.filter((item) => item.employmentStatus === 'ACTIVE').map((item) => <option value={item.id} key={item.id}>{item.name} · {item.employeeNo}</option>)}</select></label><label>组织/门店<select value={assignmentForm.orgUnitId} onChange={(event) => setAssignmentForm({ ...assignmentForm, orgUnitId: event.target.value })}><option value="">请选择</option>{data.orgUnits.filter((item) => item.status === 'ACTIVE').map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label><label>岗位<select value={assignmentForm.positionId} onChange={(event) => setAssignmentForm({ ...assignmentForm, positionId: event.target.value })}><option value="">请选择</option>{data.positions.filter((item) => item.status === 'ACTIVE').map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label><label>上级任职<select value={assignmentForm.managerAssignmentId} onChange={(event) => setAssignmentForm({ ...assignmentForm, managerAssignmentId: event.target.value })}><option value="">暂不设置</option>{data.employees.filter((item) => item.assignmentId && item.employmentStatus === 'ACTIVE').map((item) => <option value={item.assignmentId} key={item.assignmentId}>{item.name} · {item.positionName}</option>)}</select></label><label>任职类型<select value={assignmentForm.assignmentType} onChange={(event) => setAssignmentForm({ ...assignmentForm, assignmentType: event.target.value })}><option value="PERMANENT">正式</option><option value="TEMPORARY">临时</option><option value="ACTING">代理</option></select></label>{canGrant && <label>业务角色<select value={assignmentForm.roleId} onChange={(event) => setAssignmentForm({ ...assignmentForm, roleId: event.target.value })}><option value="">仅分配岗位</option>{data.roles.map((item) => <option value={item.id} key={item.id}>{item.name} · {item.code}</option>)}</select></label>}<label className="checkbox-label"><input type="checkbox" checked={assignmentForm.primary} onChange={(event) => setAssignmentForm({ ...assignmentForm, primary: event.target.checked })} />设为主岗</label></div></Modal>}
  </section>
}

export function WorkPackageCenter({ identity, permissions }: { identity: RoleContext; permissions: string[] }) {
  const canManage = permissions.includes('work-package.manage') || permissions.includes('*')
  const canPublish = permissions.includes('work-package.publish') || permissions.includes('*')
  const canAllocate = permissions.includes('work-package.allocate') || permissions.includes('*')
  const [packages, setPackages] = useState<PackageRow[]>([])
  const [orgs, setOrgs] = useState<OrgUnit[]>([])
  const [positions, setPositions] = useState<Position[]>([])
  const [forms, setForms] = useState<SelectRow[]>([])
  const [standards, setStandards] = useState<SelectRow[]>([])
  const [assignments, setAssignments] = useState<Employee[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string>()
  const [modal, setModal] = useState(false)
  const [saving, setSaving] = useState(false)
  const [detail, setDetail] = useState<Row>()
  const [detailAllocations, setDetailAllocations] = useState<AllocationRow[]>([])
  const [allocation, setAllocation] = useState({ assignmentId: '', targetOrgUnitId: '' })
  const [draft, setDraft] = useState({ code: '', name: '', description: '', positionId: '', ownerOrgUnitId: '', scopeOrgUnitId: '', formVersionId: '', standardVersionId: '', itemCode: 'DAILY-01', itemName: '', itemType: 'SCHEDULED_RECORD', periodType: 'DAY', dueLocalTime: '18:00', reviewMode: 'NONE', completionStatementRequired: true, exceptionStatementRequired: false, nextActionRequired: false, attachmentRequired: false, maxAttachments: '10', allowedExtensions: 'jpg,jpeg,png,pdf,docx,xlsx' })
  const reload = async () => {
    setLoading(true); setError(undefined)
    try {
      const [packageRaw, setup, formRaw, standardRaw] = await Promise.all([
        apiRequest<unknown>('/work-packages', identity), loadSetup(identity, false), apiRequest<unknown>('/work-data/forms', identity), apiRequest<unknown>('/standards', identity),
      ])
      setPackages(asList<Row>(packageRaw).map((row) => ({ id: text(row, 'id'), code: text(row, 'code'), name: text(row, 'name'), positionName: text(row, 'position_name', 'positionName'), lifecycleStatus: text(row, 'lifecycle_status', 'lifecycleStatus') || 'DRAFT', versionNo: Number(field(row, 'version_no', 'versionNo') ?? 0), latestVersionId: text(row, 'latest_version_id', 'latestVersionId') || undefined, ownerOrgName: text(row, 'owner_org_unit_name', 'ownerOrgName') || undefined })))
      setOrgs(setup.orgUnits); setPositions(setup.positions)
      setAssignments(setup.employees.filter((item) => item.assignmentId))
      setForms(asList<Row>(formRaw).map((row) => ({ id: text(row, 'id'), code: text(row, 'code'), name: text(row, 'name'), status: text(row, 'lifecycle_status', 'lifecycleStatus'), versionId: text(row, 'latest_version_id', 'latestVersionId') || undefined, positionId: text(row, 'position_id', 'positionId') || undefined })))
      setStandards(asList<Row>(standardRaw).map((row) => ({ id: text(row, 'id'), code: text(row, 'code'), name: text(row, 'name'), status: text(row, 'lifecycle_status', 'lifecycleStatus'), versionId: text(row, 'latest_version_id', 'latestVersionId') || undefined })))
    } catch (reason) { setError(reason instanceof Error ? reason.message : '工作包数据加载失败') }
    finally { setLoading(false) }
  }
  useEffect(() => { void reload() }, [identity.key])
  const create = async () => {
    setSaving(true); setError(undefined)
    try {
      const definition = await apiRequest<Row>('/work-packages', identity, { method: 'POST', body: JSON.stringify({ code: draft.code, name: draft.name, description: draft.description, positionId: draft.positionId, ownerOrgUnitId: draft.ownerOrgUnitId || null }) })
      const packageId = text(definition, 'id')
      const version = await apiRequest<Row>(`/work-packages/${packageId}/versions`, identity, { method: 'POST', body: JSON.stringify({ title: draft.name, description: draft.description }) })
      const versionId = text(version, 'id')
      const responsibilities: Row[] = [{ participantType: 'EXECUTOR', resolverType: 'CURRENT_ASSIGNMENT', scopeStrategy: 'TARGET_ORG', escalationLevel: 0 }]
      if (draft.reviewMode !== 'NONE') responsibilities.push({ participantType: 'ACCEPTOR', resolverType: 'DIRECT_MANAGER_ASSIGNMENT', scopeStrategy: 'TARGET_ORG', escalationLevel: 0 })
      await apiRequest(`/work-packages/${packageId}/versions/${versionId}`, identity, { method: 'PUT', body: JSON.stringify({
        title: draft.name, description: draft.description,
        scopes: [{ scopeType: 'ORG_TREE', orgUnitId: draft.scopeOrgUnitId }],
        items: [{ itemCode: draft.itemCode, name: draft.itemName, description: draft.description, itemType: draft.itemType, formVersionId: draft.formVersionId, sortOrder: 1, required: true, periodType: draft.periodType, timezoneMode: 'HOTEL', dueLocalTime: draft.dueLocalTime, graceMinutes: 30, weekdays: [], holidayPolicy: 'INCLUDE', waiverAllowed: false, targetGranularity: 'TARGET_ORG', reviewMode: draft.reviewMode, submissionPolicy: { completionStatementRequired: draft.completionStatementRequired, exceptionStatementRequired: draft.exceptionStatementRequired, nextActionRequired: draft.nextActionRequired, attachmentRequired: draft.attachmentRequired, maxAttachments: Number(draft.maxAttachments), maxFileSizeBytes: 20 * 1024 * 1024, allowedExtensions: draft.allowedExtensions.split(',').map((value) => value.trim().toLowerCase()).filter(Boolean) }, standards: draft.standardVersionId ? [{ standardVersionId: draft.standardVersionId, usageType: 'EXECUTION', weight: 1 }] : [], responsibilities }],
      }) })
      setModal(false); await reload()
    } catch (reason) { setError(reason instanceof Error ? reason.message : '工作包创建失败') }
    finally { setSaving(false) }
  }
  const openDetail = async (item: PackageRow) => {
    setError(undefined)
    setAllocation({ assignmentId: '', targetOrgUnitId: '' })
    try {
      const [packageDetail, allocationRaw] = await Promise.all([
        apiRequest<Row>(`/work-packages/${item.id}`, identity),
        apiRequest<unknown>(`/work-packages/${item.id}/allocations`, identity),
      ])
      setDetail(packageDetail)
      const configuration = packageDetail.latestVersion && typeof packageDetail.latestVersion === 'object' ? packageDetail.latestVersion as Row : {}
      const firstItem = asList<Row>(configuration.items)[0]
      const firstScope = asList<Row>(configuration.scopes)[0]
      const policy = jsonObject(field(firstItem ?? {}, 'submission_policy', 'submissionPolicy'))
      const firstStandard = asList<Row>(firstItem?.standards)[0]
      setDraft((current) => ({ ...current, code: text(packageDetail, 'code'), name: text(packageDetail, 'name'), description: text(packageDetail, 'description'), positionId: text(packageDetail, 'position_id', 'positionId'), ownerOrgUnitId: text(packageDetail, 'owner_org_unit_id', 'ownerOrgUnitId'), scopeOrgUnitId: text(firstScope ?? {}, 'org_unit_id', 'orgUnitId'), formVersionId: text(firstItem ?? {}, 'form_version_id', 'formVersionId'), standardVersionId: text(firstStandard ?? {}, 'standard_version_id', 'standardVersionId'), itemCode: text(firstItem ?? {}, 'item_code', 'itemCode'), itemName: text(firstItem ?? {}, 'name'), itemType: text(firstItem ?? {}, 'item_type', 'itemType') || 'SCHEDULED_RECORD', periodType: text(firstItem ?? {}, 'period_type', 'periodType') || 'DAY', dueLocalTime: text(firstItem ?? {}, 'due_local_time', 'dueLocalTime') || '18:00', reviewMode: text(firstItem ?? {}, 'review_mode', 'reviewMode') || 'NONE', completionStatementRequired: policy.completionStatementRequired !== false, exceptionStatementRequired: policy.exceptionStatementRequired === true, nextActionRequired: policy.nextActionRequired === true, attachmentRequired: policy.attachmentRequired === true, maxAttachments: String(policy.maxAttachments ?? 10), allowedExtensions: asList<string>(policy.allowedExtensions).join(',') || 'jpg,jpeg,png,pdf,docx,xlsx' }))
      setDetailAllocations(asList<Row>(allocationRaw).map((row) => ({
        id: text(row, 'id'), assignmentId: text(row, 'position_assignment_id', 'positionAssignmentId'),
        targetOrgName: text(row, 'target_org_unit_name', 'targetOrgUnitName', 'targetOrgName'),
        assigneeName: text(row, 'employee_name', 'employeeName', 'assigneeName'),
        status: text(row, 'status'), validFrom: text(row, 'valid_from', 'validFrom'),
      })))
    } catch (reason) { setError(reason instanceof Error ? reason.message : '详情加载失败') }
  }
  const versionPayload = (source: Row, updateFirst: boolean) => {
    const configuration = source.latestVersion && typeof source.latestVersion === 'object' ? source.latestVersion as Row : {}
    const scopes = asList<Row>(configuration.scopes).map((scope) => ({ scopeType: text(scope, 'scope_type', 'scopeType'), brandId: text(scope, 'brand_id', 'brandId') || null, orgUnitId: text(scope, 'org_unit_id', 'orgUnitId') || null, positionId: text(scope, 'position_id', 'positionId') || null }))
    const items = asList<Row>(configuration.items).map((item, index) => {
      const originalPolicy = jsonObject(field(item, 'submission_policy', 'submissionPolicy'))
      const submissionPolicy = index === 0 && updateFirst ? { completionStatementRequired: draft.completionStatementRequired, exceptionStatementRequired: draft.exceptionStatementRequired, nextActionRequired: draft.nextActionRequired, attachmentRequired: draft.attachmentRequired, maxAttachments: Number(draft.maxAttachments), maxFileSizeBytes: 20 * 1024 * 1024, allowedExtensions: draft.allowedExtensions.split(',').map((value) => value.trim().toLowerCase()).filter(Boolean) } : originalPolicy
      return {
        itemCode: text(item, 'item_code', 'itemCode'), name: index === 0 && updateFirst ? draft.itemName : text(item, 'name'), description: index === 0 && updateFirst ? draft.description : text(item, 'description') || null,
        itemType: text(item, 'item_type', 'itemType'), formVersionId: text(item, 'form_version_id', 'formVersionId'), sortOrder: Number(field(item, 'sort_order', 'sortOrder') ?? index), required: field(item, 'required') !== false,
        periodType: index === 0 && updateFirst ? draft.periodType : text(item, 'period_type', 'periodType'), timezoneMode: text(item, 'timezone_mode', 'timezoneMode') || 'HOTEL', fixedTimezone: text(item, 'fixed_timezone', 'fixedTimezone') || null,
        workWindowStart: text(item, 'work_window_start', 'workWindowStart') || null, workWindowEnd: text(item, 'work_window_end', 'workWindowEnd') || null, dueLocalTime: index === 0 && updateFirst ? draft.dueLocalTime : text(item, 'due_local_time', 'dueLocalTime') || null,
        graceMinutes: Number(field(item, 'grace_minutes', 'graceMinutes') ?? 0), weekdays: asList<number>(field(item, 'weekdays')), dayOfMonth: field(item, 'day_of_month', 'dayOfMonth') ?? null,
        holidayPolicy: text(item, 'holiday_policy', 'holidayPolicy') || 'INCLUDE', waiverAllowed: field(item, 'waiver_allowed', 'waiverAllowed') === true, targetGranularity: text(item, 'target_granularity', 'targetGranularity') || 'TARGET_ORG', reviewMode: index === 0 && updateFirst ? draft.reviewMode : text(item, 'review_mode', 'reviewMode') || 'NONE', submissionPolicy,
        standards: asList<Row>(item.standards).map((standard) => ({ standardVersionId: text(standard, 'standard_version_id', 'standardVersionId'), usageType: text(standard, 'usage_type', 'usageType'), weight: Number(field(standard, 'weight') ?? 1) })),
        responsibilities: asList<Row>(item.responsibilities).map((responsibility) => ({ participantType: text(responsibility, 'participant_type', 'participantType'), resolverType: text(responsibility, 'resolver_type', 'resolverType'), positionId: text(responsibility, 'position_id', 'positionId') || null, scopeStrategy: text(responsibility, 'scope_strategy', 'scopeStrategy') || 'TARGET_ORG', escalationLevel: Number(field(responsibility, 'escalation_level', 'escalationLevel') ?? 0) })),
      }
    })
    return { title: text(asList<Row>(source.versions)[0] ?? {}, 'title') || text(source, 'name'), description: text(source, 'description') || null, scopes, items }
  }
  const refreshDetail = async (id: string) => setDetail(await apiRequest<Row>(`/work-packages/${id}`, identity))
  const createEditableVersion = async () => {
    if (!detail) return
    setSaving(true); setError(undefined)
    try {
      const packageId = text(detail, 'id')
      const created = await apiRequest<Row>(`/work-packages/${packageId}/versions`, identity, { method: 'POST', body: JSON.stringify({ title: `${text(detail, 'name')}（新版本）`, description: text(detail, 'description') || null }) })
      await apiRequest(`/work-packages/${packageId}/versions/${text(created, 'id')}`, identity, { method: 'PUT', body: JSON.stringify(versionPayload(detail, false)) })
      await refreshDetail(packageId); await reload()
    } catch (reason) { setError(reason instanceof Error ? reason.message : '创建工作包新版本失败') }
    finally { setSaving(false) }
  }
  const saveDraftConfiguration = async () => {
    if (!detail) return
    const latest = asList<Row>(detail.versions)[0]
    if (!latest || text(latest, 'lifecycle_status', 'lifecycleStatus') !== 'DRAFT') return
    setSaving(true); setError(undefined)
    try { const packageId = text(detail, 'id'); await apiRequest(`/work-packages/${packageId}/versions/${text(latest, 'id')}`, identity, { method: 'PUT', body: JSON.stringify(versionPayload(detail, true)) }); await refreshDetail(packageId); await reload() }
    catch (reason) { setError(reason instanceof Error ? reason.message : '保存工作包草稿失败') }
    finally { setSaving(false) }
  }
  const detailAction = async () => {
    if (!detail) return
    const id = text(detail, 'id'); const versions = asList<Row>(detail.versions); const latest = versions[0]
    if (!latest) return
    const lifecycle = text(latest, 'lifecycle_status', 'lifecycleStatus')
    if (lifecycle !== 'DRAFT' && !canAllocate) { setDetail(undefined); return }
    setSaving(true); setError(undefined)
    try {
      if (lifecycle === 'DRAFT') {
        await apiRequest(`/work-packages/${id}/versions/${text(latest, 'id')}/validate`, identity, { method: 'POST' })
        await apiRequest(`/work-packages/${id}/versions/${text(latest, 'id')}/publish`, identity, { method: 'POST', body: JSON.stringify({ effectiveFrom: new Date().toISOString(), effectiveTo: null }) })
      } else {
        const selected = assignments.find((item) => item.assignmentId === allocation.assignmentId)
        if (!selected?.assignmentId || !allocation.targetOrgUnitId) throw new Error('请选择负责人任职与目标门店。')
        await apiRequest(`/work-packages/${id}/allocations`, identity, { method: 'POST', body: JSON.stringify({ workPackageVersionId: text(latest, 'id'), positionAssignmentId: selected.assignmentId, targetOrgUnitId: allocation.targetOrgUnitId, validFrom: new Date().toISOString().slice(0, 10), validTo: null, allocationSource: 'MANUAL' }) })
        const latestConfiguration = detail.latestVersion && typeof detail.latestVersion === 'object' ? detail.latestVersion as Row : {}
        const firstItem = asList<Row>(latestConfiguration.items)[0]
        const periodType = text(firstItem ?? {}, 'period_type', 'periodType') || 'DAY'
        await apiRequest('/work-expectations/actions/generate', identity, { method: 'POST', body: JSON.stringify({ positionAssignmentId: selected.assignmentId, targetOrgUnitId: allocation.targetOrgUnitId, businessDate: new Date().toISOString().slice(0, 10), periodType, dutyPeriodId: null }) })
      }
      setDetail(undefined); await reload()
    } catch (reason) { setError(reason instanceof Error ? reason.message : '工作包操作失败') }
    finally { setSaving(false) }
  }
  return <section className="page-section configuration-page"><header className="page-title"><div><span className="eyebrow">WORK PACKAGE CENTER</span><h1>工作包中心</h1><p>创建岗位工作包草稿，绑定表单、标准和门店范围，校验后发布。</p></div><div className="page-actions"><span className="source-flag api">实时 API</span>{canManage && <button className="primary" onClick={() => setModal(true)}>＋ 新建工作包</button>}</div></header>
    {error && <div className="inline-error page-error">{error}</div>}
    {loading ? <div className="state-card"><div className="spinner" /><strong>正在读取工作包</strong></div> : !packages.length ? <div className="state-card"><b>◇</b><strong>当前范围暂无工作包</strong><span>{canManage ? '点击右上角创建第一个工作包。' : '请联系集团管理员发布并分配工作包。'}</span></div> : <div className="card-grid">{packages.map((item) => <article className="package-card" key={item.id}><div className="card-top"><span>{item.code}</span><span className={`status-pill ${item.lifecycleStatus.toLowerCase()}`}>{item.lifecycleStatus === 'PUBLISHED' ? '已发布' : item.lifecycleStatus === 'DRAFT' ? '草稿' : item.lifecycleStatus}</span></div><h2>{item.name}</h2><p>{item.positionName} · {item.ownerOrgName || '集团范围'}</p><div className="package-stats"><span><strong>V{item.versionNo || '—'}</strong>当前版本</span><span><strong>{item.lifecycleStatus === 'PUBLISHED' ? '生效' : '待发布'}</strong>版本状态</span></div><button className="secondary" onClick={() => openDetail(item)}>{canAllocate ? '查看版本与下发' : canPublish ? '查看版本与发布' : '查看工作包详情'}</button></article>)}</div>}
    {modal && <Modal title="创建工作包与首个工作项" onClose={() => setModal(false)} onSave={create} saving={saving} saveLabel="创建草稿"><div className="form-grid"><label>工作包编码<input value={draft.code} onChange={(event) => setDraft({ ...draft, code: event.target.value })} placeholder="WP-FRONT-DAILY" /></label><label>工作包名称<input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></label><label>目标岗位<select value={draft.positionId} onChange={(event) => setDraft({ ...draft, positionId: event.target.value })}><option value="">请选择</option>{positions.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label><label>归属组织<select value={draft.ownerOrgUnitId} onChange={(event) => setDraft({ ...draft, ownerOrgUnitId: event.target.value })}><option value="">集团统一</option>{orgs.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label><label>下发范围<select value={draft.scopeOrgUnitId} onChange={(event) => setDraft({ ...draft, scopeOrgUnitId: event.target.value })}><option value="">请选择门店/组织树</option>{orgs.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label><label>工作表单<select value={draft.formVersionId} onChange={(event) => setDraft({ ...draft, formVersionId: event.target.value })}><option value="">请选择已发布表单</option>{forms.filter((item) => item.status === 'PUBLISHED' && item.versionId).map((item) => <option value={item.versionId} key={item.versionId}>{item.name}</option>)}</select></label><label>工作项编码<input value={draft.itemCode} onChange={(event) => setDraft({ ...draft, itemCode: event.target.value })} /></label><label>工作项名称<input value={draft.itemName} onChange={(event) => setDraft({ ...draft, itemName: event.target.value })} placeholder="例如 完成前台交接记录" /></label><label>工作类型<select value={draft.itemType} onChange={(event) => setDraft({ ...draft, itemType: event.target.value })}><option value="SCHEDULED_RECORD">定时记录</option><option value="INSPECTION">巡检</option><option value="METRIC_REVIEW">指标复盘</option></select></label><label>执行周期<select value={draft.periodType} onChange={(event) => setDraft({ ...draft, periodType: event.target.value })}><option value="DAY">每日</option><option value="WEEK">每周</option><option value="SHIFT">每班次</option></select></label><label>截止时间<input type="time" value={draft.dueLocalTime} onChange={(event) => setDraft({ ...draft, dueLocalTime: event.target.value })} /></label><label>验收方式<select value={draft.reviewMode} onChange={(event) => setDraft({ ...draft, reviewMode: event.target.value })}><option value="NONE">提交即完成</option><option value="MANUAL">直属上级人工验收</option><option value="STANDARD_EVALUATION">按标准评价验收</option></select></label><label>关联标准<select value={draft.standardVersionId} onChange={(event) => setDraft({ ...draft, standardVersionId: event.target.value })}><option value="">暂不关联</option>{standards.filter((item) => item.status === 'PUBLISHED' && item.versionId).map((item) => <option value={item.versionId} key={item.versionId}>{item.name}</option>)}</select></label><label>最多附件数<input type="number" min="0" max="10" value={draft.maxAttachments} onChange={(event) => setDraft({ ...draft, maxAttachments: event.target.value })} /></label><label className="full-field">允许附件类型<input value={draft.allowedExtensions} onChange={(event) => setDraft({ ...draft, allowedExtensions: event.target.value })} /></label><label className="checkbox-label"><input type="checkbox" checked={draft.completionStatementRequired} onChange={(event) => setDraft({ ...draft, completionStatementRequired: event.target.checked })} />必须填写完成情况</label><label className="checkbox-label"><input type="checkbox" checked={draft.attachmentRequired} onChange={(event) => setDraft({ ...draft, attachmentRequired: event.target.checked })} />必须上传附件证据</label><label className="checkbox-label"><input type="checkbox" checked={draft.exceptionStatementRequired} onChange={(event) => setDraft({ ...draft, exceptionStatementRequired: event.target.checked })} />必须填写异常事项</label><label className="checkbox-label"><input type="checkbox" checked={draft.nextActionRequired} onChange={(event) => setDraft({ ...draft, nextActionRequired: event.target.checked })} />必须填写下一步行动</label><label className="full-field">说明<textarea rows={3} value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} /></label></div></Modal>}
    {detail && (() => {
      const latest = asList<Row>(detail.versions)[0] ?? {}
      const lifecycle = text(latest, 'lifecycle_status', 'lifecycleStatus')
      const matchingAssignments = assignments.filter((item) => item.positionId === text(detail, 'position_id', 'positionId'))
      return <Modal title={`${text(detail, 'name')} · 版本与下发`} onClose={() => setDetail(undefined)} onSave={detailAction} saving={saving} saveLabel={lifecycle === 'DRAFT' && canPublish ? '校验并发布' : lifecycle === 'PUBLISHED' && canAllocate ? '下发并生成今日工作' : '关闭'}>
        <div className="version-summary"><strong>{text(detail, 'code')}</strong><p>{text(detail, 'description') || '暂无说明'}</p>{asList<Row>(detail.versions).map((version) => <div key={text(version, 'id')}><span>V{text(version, 'version_no', 'versionNo')}</span><b>{text(version, 'lifecycle_status', 'lifecycleStatus')}</b><small>{text(version, 'title')}</small></div>)}</div>
        {lifecycle === 'PUBLISHED' && canManage && <div className="allocation-box"><h3>CEO 标准工作模板维护</h3><p>创建新草稿版本后修改，不覆盖已发布版本和历史工作记录。</p><button className="secondary" disabled={saving} onClick={() => void createEditableVersion()}>{saving ? '创建中…' : '创建可编辑新版本'}</button></div>}
        {lifecycle === 'DRAFT' && canManage && <div className="allocation-box"><h3>修改首个标准工作项</h3><div className="form-grid"><label>工作项名称<input value={draft.itemName} onChange={(event) => setDraft({ ...draft, itemName: event.target.value })} /></label><label>执行周期<select value={draft.periodType} onChange={(event) => setDraft({ ...draft, periodType: event.target.value })}><option value="DAY">每日</option><option value="WEEK">每周</option><option value="SHIFT">每班次</option><option value="EVENT">事件触发</option></select></label><label>截止时间<input type="time" value={draft.dueLocalTime} onChange={(event) => setDraft({ ...draft, dueLocalTime: event.target.value })} /></label><label>验收方式<select value={draft.reviewMode} onChange={(event) => setDraft({ ...draft, reviewMode: event.target.value })}><option value="NONE">提交即完成</option><option value="MANUAL">人工验收</option><option value="STANDARD_EVALUATION">按标准评价</option></select></label><label>最多附件<input type="number" min="0" max="10" value={draft.maxAttachments} onChange={(event) => setDraft({ ...draft, maxAttachments: event.target.value })} /></label><label className="full-field">允许附件类型<input value={draft.allowedExtensions} onChange={(event) => setDraft({ ...draft, allowedExtensions: event.target.value })} /></label><label className="checkbox-label"><input type="checkbox" checked={draft.completionStatementRequired} onChange={(event) => setDraft({ ...draft, completionStatementRequired: event.target.checked })} />必须填写完成情况</label><label className="checkbox-label"><input type="checkbox" checked={draft.attachmentRequired} onChange={(event) => setDraft({ ...draft, attachmentRequired: event.target.checked })} />必须上传证据</label><label className="checkbox-label"><input type="checkbox" checked={draft.exceptionStatementRequired} onChange={(event) => setDraft({ ...draft, exceptionStatementRequired: event.target.checked })} />必须填写异常</label><label className="checkbox-label"><input type="checkbox" checked={draft.nextActionRequired} onChange={(event) => setDraft({ ...draft, nextActionRequired: event.target.checked })} />必须填写下一步</label><label className="full-field">说明<textarea rows={3} value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} /></label></div><button className="secondary" disabled={saving} onClick={() => void saveDraftConfiguration()}>{saving ? '保存中…' : '保存草稿修改'}</button></div>}
        {detailAllocations.length > 0 && <div className="allocation-box"><h3>当前有效下发</h3><div className="version-summary">{detailAllocations.filter((item) => item.status === 'ACTIVE').map((item) => <div key={item.id}><span>{item.assigneeName || '已分配员工'}</span><b>{item.status === 'ACTIVE' ? '生效' : item.status}</b><small>{item.targetOrgName || '任职组织'} · {item.validFrom}</small></div>)}</div></div>}
        {lifecycle === 'PUBLISHED' && canAllocate && <div className="allocation-box"><h3>下发到岗位任职</h3>{matchingAssignments.length === 0 && <div className="inline-warning">当前权限范围内没有该岗位的有效任职。请先到“组织与权限”创建员工并分配对应岗位。</div>}<div className="form-grid"><label>负责人任职<select value={allocation.assignmentId} onChange={(event) => { const assignmentId = event.target.value; const selected = matchingAssignments.find((item) => item.assignmentId === assignmentId); setAllocation({ assignmentId, targetOrgUnitId: selected?.orgUnitId ?? '' }) }}><option value="">请选择同岗位员工</option>{matchingAssignments.map((item) => <option value={item.assignmentId} key={item.assignmentId}>{item.name} · {item.positionName} · {item.orgUnitName}</option>)}</select></label><label>目标门店/部门<select value={allocation.targetOrgUnitId} onChange={(event) => setAllocation({ ...allocation, targetOrgUnitId: event.target.value })}><option value="">请选择</option>{orgs.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label></div><small>选择员工后默认使用其任职组织；下发成功会立即生成今天的真实工作。</small></div>}
        {lifecycle === 'DRAFT' && !canPublish && <div className="inline-warning">当前账号可查看草稿，但没有发布权限。</div>}
      </Modal>
    })()}
  </section>
}
