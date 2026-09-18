import { useCallback, useEffect, useRef, useState } from 'react'
import {
  loadWeComRepairAdmins, manageWeComRepairAdmins,
  type WeComRepairAdmin, type WeComRepairAdminCommand, type WeComRepairAdminsView,
} from '../api/business'
import { businessErrorMessage } from '../ui/businessDisplay'
import { WeComRepairApprovalPanel } from './WeComRepairApprovalPanel'

interface Props { hotelId: string; onChanged: () => void }
const timeLabel = (value: string | null) => value ? new Date(value).toLocaleString('zh-CN') : '尚无记录'

export function WeComRepairAdminsPanel({ hotelId, onChanged }: Props) {
  const [data, setData] = useState<WeComRepairAdminsView | null>(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const [showAll, setShowAll] = useState(false)
  const [editing, setEditing] = useState<WeComRepairAdmin | 'NEW' | null>(null)
  const [newMode, setNewMode] = useState<'DIRECT' | 'PAIR'>('DIRECT')
  const [userId, setUserId] = useState('')
  const [search, setSearch] = useState('')
  const [formVersion, setFormVersion] = useState(0)
  const [displayName, setDisplayName] = useState('')
  const [role, setRole] = useState<WeComRepairAdmin['role']>('STORE_MANAGER')
  const [selected, setSelected] = useState<string[]>([hotelId])
  const [directoryUserId, setDirectoryUserId] = useState('')
  const [identityConfirmed, setIdentityConfirmed] = useState(false)
  const [pairing, setPairing] = useState<WeComRepairAdminsView['createdPairing']>()
  const [pendingRevoke, setPendingRevoke] = useState<WeComRepairAdmin | null>(null)
  const [corpId, setCorpId] = useState('')
  const [callbackToken, setCallbackToken] = useState('')
  const [aesKey, setAesKey] = useState('')
  const [directoryVersion, setDirectoryVersion] = useState<number | null>(null)
  const sequence = useRef(0)
  const inFlight = useRef(false)
  const mounted = useRef(true)
  const refresh = useCallback(async () => {
    if (inFlight.current) return
    const id = ++sequence.current
    try {
      const next = await loadWeComRepairAdmins()
      if (mounted.current && id === sequence.current) setData(next)
    } catch (cause) {
      if (mounted.current && id === sequence.current) setError(businessErrorMessage(cause, '读取管理员名单失败'))
    }
  }, [])
  useEffect(() => {
    mounted.current = true
    void refresh()
    const timer = window.setInterval(() => void refresh(), 5_000)
    return () => { mounted.current = false; sequence.current += 1; window.clearInterval(timer) }
  }, [refresh])
  useEffect(() => {
    if (!pairing) return
    const timer = window.setTimeout(() => setPairing(undefined), Math.max(0, Date.parse(pairing.expiresAt) - Date.now()))
    return () => window.clearTimeout(timer)
  }, [pairing])
  useEffect(() => {
    if (pairing && data && (!data.pairing.active || data.pairing.expiresAt !== pairing.expiresAt)) {
      setPairing(undefined)
      setNotice('配对已完成、被替换或失效，请以最新人员名单中的绑定结果为准。')
    }
  }, [data, pairing])

  async function command(input: WeComRepairAdminCommand, version: number) {
    if (inFlight.current) return
    inFlight.current = true
    sequence.current += 1
    setBusy(true); setError(''); setNotice('')
    try {
      const next = await manageWeComRepairAdmins(input, version)
      if (!mounted.current) return
      setData(next)
      setEditing(null); setPendingRevoke(null)
      setPairing(next.createdPairing)
      if (input.action === 'DIRECTORY') {
        setCallbackToken(''); setAesKey(''); setDirectoryVersion(null)
      }
      setNotice(input.action === 'APPROVAL_CONFIG'
        ? '企微简易审批设置已保存。仅勾选的人员获得绑定审批权；变更前的待审批申请已取消。'
        : input.action === 'PAIR'
        ? '配对码已生成，请只交给指定人员。对方发送一次，即绑定所有勾选门店。'
        : input.action === 'AUTHORIZE'
          ? next.members.find((m) => m.userId === input.userId)?.activationStatus === 'PENDING'
            ? '预授权已保存，等待该员工首次进入机器人自动绑定；当天已进入过，请发送“激活”，不需要六位配对码。'
            : '人员门店权限已立即更新，无需再次配对。'
        : input.action === 'REVOKE'
          ? '已撤销此人的全部修复权限；不再接收私聊任务，旧修复卡片也无法继续授权操作。'
          : input.action === 'DIRECTORY'
            ? '通讯录接入配置已加密保存，请在企业微信后台保存回调地址并完成验证。'
            : '人员信息和门店权限已保存。')
      onChanged()
      return true
    } catch (cause) {
      if (!mounted.current) return
      setError(businessErrorMessage(cause, '操作失败，请重试'))
      if (cause instanceof Error && cause.message === 'WECOM_REPAIR_BOT_CONFIG_VERSION_CONFLICT') {
        setEditing(null); setPendingRevoke(null); setDirectoryVersion(null)
        setCallbackToken(''); setAesKey('')
      }
      return false
    } finally {
      inFlight.current = false
      if (mounted.current) { setBusy(false); void refresh() }
    }
  }

  function edit(member: WeComRepairAdmin | 'NEW', mode: 'DIRECT' | 'PAIR' = 'DIRECT') {
    if (!data || busy) return
    setEditing(member); setPendingRevoke(null); setFormVersion(data.rowVersion)
    setNewMode(mode); setUserId(member === 'NEW' ? '' : member.userId)
    setDisplayName(member === 'NEW' || member.nameSource === 'UNSET' ? '' : member.displayName)
    setSelected(member === 'NEW' ? [hotelId] : member.activationStatus === 'PENDING' ? member.pendingHotelIds : member.hotelIds)
    setRole(member === 'NEW' ? 'STORE_MANAGER' : member.role)
    setDirectoryUserId(member === 'NEW' ? '' : member.directoryUserId)
    setIdentityConfirmed(false); setPairing(undefined); setError(''); setNotice('')
  }
  const matchesSearch = (m: WeComRepairAdmin) => `${m.displayName} ${m.userId} ${m.directoryUserId}`.toLowerCase().includes(search.trim().toLowerCase())
  const members = (data?.members ?? []).filter((m) => (showAll || m.globalRecipient || m.hotelIds.includes(hotelId) || m.pendingHotelIds?.includes(hotelId)) && matchesSearch(m))
  const linked = data?.directory
  const directoryReady = linked?.enabled && Boolean(linked.verifiedAt)
  const existing = editing && editing !== 'NEW' ? editing : null
  const direct = (!existing && newMode === 'DIRECT') || existing?.activationStatus === 'PENDING'
  const formValid = Boolean(displayName.trim()) && (selected.length > 0 || existing?.globalRecipient)
    && (!existing || !directoryUserId.trim() || directoryUserId.trim() === existing.directoryUserId || identityConfirmed)
    && (!direct || (userId.trim() && directoryUserId.trim() && identityConfirmed && directoryReady))

  return (
    <section className="repair-admin-panel" aria-label="播报修复管理员管理">
      <div className="page-heading">
        <div><h3>已绑定人员与多店授权</h3><p>已绑定人员：选择人员 → 勾选门店 → 保存即生效。新人员可使用下方企微简易审批，也保留预授权和备用配对码。</p></div>
        <div className="heading-actions"><button type="button" disabled={!data || busy || !data.credentialConfigured} onClick={() => edit('NEW')}>免配对码授权</button><button className="secondary" type="button" disabled={!data || busy || !data.credentialConfigured} onClick={() => edit('NEW', 'PAIR')}>备用配对码 / 多店绑定</button></div>
      </div>
      <p>机器人只需由平台统一配置一次，员工无需配置机器人密钥。企业微信消息中打开“播报推送修复助手”；未添加的员工仍需获得机器人的分享入口。</p>
      {data ? <WeComRepairApprovalPanel data={data} busy={busy} onSave={command} /> : null}
      <label className="repair-admin-search">搜索人员姓名或企微账号<input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="已保存的人员名单，不是全企业通讯录" /></label>
      <label className="inline-toggle"><input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} />查看全部门店人员（含已解绑记录）</label>
      {!data ? <p role="status">正在读取管理员名单…</p> : null}
      {data && members.length === 0 ? <p>当前门店暂无已绑定人员，也没有全局接收人。</p> : null}
      <div className="repair-admin-roster">
        {members.map((member) => (
          <article className="repair-admin-member" key={member.memberId}>
            <div><strong>{member.displayName}</strong><span className={member.active ? 'source-complete' : 'source-partial'}>{member.active ? (member.globalRecipient ? '全局接收人' : member.role === 'OPERATIONS_MANAGER' ? '运营经理' : '门店管理员') : member.activationStatus === 'PENDING' ? '待首次激活' : member.activationStatus === 'UNASSIGNED' ? '尚未授权' : '已解绑'}</span></div>
            <p className="repair-admin-account">企微机器人账号：{member.userId}</p>
            {member.nameSource === 'APPLICANT_PROVIDED' ? <small>姓名由员工申请时填写，非通讯录自动核验；可编辑核对姓名与离职关联。</small> : null}
            <p>{member.globalRecipient ? '接收所有门店通知；跨店处理权限取决于上方全局授权开关。' : null}</p>
            <p>门店授权：{member.hotels.map((h) => `${h.hotelCode} ${h.displayName}`).join('、') || '无单独门店授权'}</p>
            {member.activationStatus === 'PENDING' ? <p>待激活门店：{member.pendingHotels.map((h) => `${h.hotelCode} ${h.displayName}`).join('、')}。尚不能接收或处理任务；进入机器人或发送“激活”完成绑定。</p> : null}
            {member.activatedAt ? <small>自动绑定成功：{timeLabel(member.activatedAt)}</small> : null}
            {member.identityReviewRequired ? <p className="error">通讯录身份发生变化，已暂停自动激活；请重新核对机器人账号、通讯录账号并保存预授权。</p> : null}
            <small>{member.activationStatus === 'PENDING' ? `预授权时间：${timeLabel(member.preauthorizedAt)} · 已关联通讯录账号 ${member.directoryUserId}` : !member.active
              ? `解绑时间：${timeLabel(member.revokedAt)} · ${member.revokeReason === 'MEMBER_DELETED' ? '企业微信已删除成员' : member.revokeReason === 'MEMBER_DISABLED' ? '企业微信已禁用成员' : '管理员手动解绑'}`
              : member.offboardingLinked ? `离职关联：${member.directoryUserId} · ${directoryReady ? '回调已验证，收到离职通知后自动解绑' : '尚需接通通讯录通知'}`
                : '离职关联：未关联通讯录账号，请编辑并核对人员身份'}</small>
            {member.active || member.activationStatus === 'PENDING' ? <div className="heading-actions">
              <button className="secondary" type="button" disabled={busy} onClick={() => edit(member)}>编辑姓名 / 门店</button>
              <button className="secondary" type="button" disabled={busy} onClick={() => { setPendingRevoke(member); setFormVersion(data!.rowVersion); setEditing(null) }}>解绑此人</button>
            </div> : null}
          </article>
        ))}
      </div>
      {pendingRevoke ? <div className="repair-admin-confirm" role="alert">
        <p>确认解除 {pendingRevoke.displayName}（{pendingRevoke.userId}）的全部绑定？将撤销所有门店和全局权限。</p>
        <div className="heading-actions"><button type="button" disabled={busy} onClick={() => void command({ action: 'REVOKE', memberId: pendingRevoke.memberId }, formVersion)}>确认全部解绑</button><button className="secondary" type="button" disabled={busy} onClick={() => setPendingRevoke(null)}>取消</button></div>
      </div> : null}
      {editing ? <form className="repair-admin-editor" onSubmit={(event) => {
        event.preventDefault()
        if (!formValid) return
        void command(direct ? { action: 'AUTHORIZE', userId: userId.trim(), displayName, role,
          hotelIds: selected, directoryUserId: directoryUserId.trim(), directoryIdentityConfirmed: identityConfirmed }
          : existing ? { action: 'EDIT', memberId: existing.memberId, displayName,
          role, hotelIds: selected, directoryUserId, directoryIdentityConfirmed: identityConfirmed }
          : { action: 'PAIR', displayName, role, hotelIds: selected }, formVersion)
      }}>
        <h4>{existing ? '编辑管理员' : direct ? '免配对码 · 选择人员与负责门店' : '备用配对码 · 一次绑定多店'}</h4>
        {!existing && direct ? <label>选择已绑定人员（保存即生效）<select value="" disabled={busy} onChange={(e) => {
          const member = data?.members.find((m) => m.memberId === e.target.value)
          if (member) edit(member)
        }}><option value="">新增人员请填写下方账号；已有人员可在此选择</option>{data?.members.filter((m) => m.active && matchesSearch(m)).map((m) => <option key={m.memberId} value={m.memberId}>{m.displayName} · {m.userId}</option>)}</select></label> : null}
        {direct ? <div className="wecom-config-grid">
          <label>企微机器人账号（UserID）<input required disabled={busy || Boolean(existing)} maxLength={128} value={userId} onChange={(e) => { setUserId(e.target.value); setIdentityConfirmed(false) }} placeholder="精确账号，不能按姓名猜测" /></label>
          <label>同一人的通讯录成员账号<input required disabled={busy} maxLength={128} value={directoryUserId} onChange={(e) => { setDirectoryUserId(e.target.value); setIdentityConfirmed(false) }} placeholder="企业微信管理后台 → 通讯录 → 成员 → 账号" /></label>
          <label className="inline-toggle wide-field"><input type="checkbox" disabled={busy} checked={identityConfirmed} onChange={(e) => setIdentityConfirmed(e.target.checked)} />已核对上述账号属于本企业同一位在职员工，机器人账号与通讯录账号可能不同；不确定时使用备用配对码。</label>
        </div> : null}
        <div className="wecom-config-grid">
          <label>姓名备注<input required maxLength={60} disabled={busy} value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="填写真实姓名，便于识别" /></label>
          <label>岗位标记<select disabled={busy} value={role} onChange={(e) => setRole(e.target.value as WeComRepairAdmin['role'])}><option value="STORE_MANAGER">门店管理员</option><option value="OPERATIONS_MANAGER">运营经理</option></select></label>
        </div>
        <fieldset disabled={busy}><legend>负责门店 · 已选择 {selected.length} 家</legend>
          <div className="heading-actions"><button className="secondary" type="button" onClick={() => setSelected(data?.hotels.map((h) => h.hotelId) ?? [])}>全选门店</button><button className="secondary" type="button" onClick={() => setSelected([hotelId])}>仅当前门店</button></div>
          <div className="repair-admin-hotels">{data?.hotels.map((hotel) => <label className="inline-toggle" key={hotel.hotelId}><input type="checkbox" checked={selected.includes(hotel.hotelId)} onChange={(e) => setSelected((current) => e.target.checked ? [...current, hotel.hotelId] : current.filter((id) => id !== hotel.hotelId))} />{hotel.hotelCode} · {hotel.displayName}</label>)}</div>
        </fieldset>
        {existing && !direct ? <div className="wecom-config-grid">
          <label className="wide-field">通讯录成员账号（离职自动解绑使用）<input disabled={busy} value={directoryUserId} maxLength={128} onChange={(e) => { setDirectoryUserId(e.target.value); setIdentityConfirmed(false) }} placeholder="企业微信管理后台 → 通讯录 → 成员 → 账号" /><small>填写通讯录 UserID，不是手机号、姓名或 open_userid。机器人账号与通讯录账号可能不同，必须核对为同一人。留空则取消离职关联。</small></label>
          {directoryUserId.trim() && directoryUserId.trim() !== existing.directoryUserId ? <label className="inline-toggle wide-field"><input type="checkbox" disabled={busy} checked={identityConfirmed} onChange={(e) => setIdentityConfirmed(e.target.checked)} />已核实该通讯录成员与上方机器人账号是同一个人</label> : null}
        </div> : direct ? <p>保存后为“待首次激活”，只有指定账号进入机器人或发送“激活”才会获得所选门店权限。已离职或已解绑人员不能重新激活。</p> : <p>对方发送配对码后，名单会自动显示账号；再编辑该人员，核对通讯录账号以接通离职自动解绑。</p>}
        <div className="heading-actions"><button type="submit" disabled={busy || !formValid || (!existing && !direct && !data?.connected)}>{busy ? '处理中…' : direct ? `保存 ${selected.length} 家门店预授权` : existing ? '保存人员与门店权限' : `生成 ${selected.length} 家门店配对码`}</button><button className="secondary" type="button" disabled={busy} onClick={() => setEditing(null)}>取消</button></div>
        {direct && !directoryReady ? <p className="error">请先完成下方“离职自动解绑”的通讯录回调验证，或选择备用配对码。</p> : null}
        {!existing && !data?.connected ? <p>机器人尚未连接：预授权可以保存，但需等待机器人连接成功才能激活。</p> : null}
      </form> : null}
      {pairing ? <div className="success" role="status"><strong className="pairing-command">绑定 {pairing.pairingCode}</strong><p>有效至 {timeLabel(pairing.expiresAt)}。仅交给指定人员使用；新配对码会替换旧码。</p></div> : null}
      {notice ? <p className="success" role="status">{notice}</p> : null}
      {error ? <p className="error" role="alert">{error}</p> : null}
      <details className="repair-admin-directory">
        <summary>离职自动解绑 · {directoryReady ? '回调已验证' : linked?.enabled ? '等待企业微信验证' : '未接通'}</summary>
        <p>仅当企业微信删除或禁用成员、并向本系统发送有效通讯录通知时，自动解除该人员全部绑定；断网或登录失败不会触发解绑。只离开群聊不等于离职。</p>
        <p>已关联 {linked?.linkedCount ?? 0} 人，尚未关联 {linked?.unlinkedCount ?? 0} 人。回调验证：{timeLabel(linked?.verifiedAt ?? null)}；最近通知：{timeLabel(linked?.lastEventAt ?? null)}。</p>
        {linked?.lastEventResult === 'UNMATCHED' ? <p className="error">最近通知未匹配到已关联人员，请核对通讯录账号和人员关联；请勿将“回调验证通过”理解为所有人员已接通。</p> : null}
        <ol><li>在企业微信通讯录同步的“接收事件服务器”配置通讯录变更通知，并覆盖需要管理的员工。如已有其他系统使用此回调，请先协调转发，不要直接覆盖。</li><li>将企业 ID、Token、EncodingAESKey 填到下方并保存，然后在企业微信后台填入本系统回调地址、同一组 Token 和密钥并验证。</li><li>逐人编辑名单，核对并关联通讯录成员账号。历史离职人员请先手动解绑，过去的离职事件不会自动补发。</li></ol>
        <label>回调地址<input readOnly value={linked ? `${window.location.origin}${linked.callbackPath}` : ''} /></label>
        <form className="wecom-config-grid" onSubmit={(e) => {
          e.preventDefault()
          if (!data) return
          void command({ action: 'DIRECTORY', directoryUpdate: { action: 'REPLACE',
            corpId: corpId.trim() || linked?.corpId || '', token: callbackToken.trim(), encodingAesKey: aesKey.trim() } }, directoryVersion ?? data.rowVersion)
        }}>
          <label>企业 ID<input required value={corpId || linked?.corpId || ''} disabled={busy} onChange={(e) => { setDirectoryVersion((v) => v ?? data?.rowVersion ?? 0); setCorpId(e.target.value) }} /></label>
          <label>通讯录回调 Token<input required type="password" autoComplete="new-password" disabled={busy} value={callbackToken} onChange={(e) => { setDirectoryVersion((v) => v ?? data?.rowVersion ?? 0); setCallbackToken(e.target.value) }} /></label>
          <label className="wide-field">通讯录回调 EncodingAESKey<input required type="password" autoComplete="new-password" disabled={busy} value={aesKey} onChange={(e) => { setDirectoryVersion((v) => v ?? data?.rowVersion ?? 0); setAesKey(e.target.value) }} /><small>此密钥不是机器人通信密钥，保存后不再展示。不需要提供员工密码。</small></label>
          <div className="heading-actions wide-field"><button type="submit" disabled={busy || !data?.credentialConfigured || !callbackToken || !aesKey}>保存通讯录接入</button>{linked?.enabled ? <button className="secondary" type="button" disabled={busy} onClick={() => { if (data) void command({ action: 'DIRECTORY', directoryUpdate: { action: 'DISABLE' } }, data.rowVersion) }}>停用自动解绑</button> : null}</div>
        </form>
      </details>
    </section>
  )
}
