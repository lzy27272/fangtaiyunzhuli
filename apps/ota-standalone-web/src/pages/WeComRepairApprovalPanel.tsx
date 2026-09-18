import { useState } from 'react'
import type { WeComRepairAdminCommand, WeComRepairAdminsView } from '../api/business'

interface Props {
  data: WeComRepairAdminsView
  busy: boolean
  onSave: (command: WeComRepairAdminCommand, version: number) => Promise<boolean | undefined>
}
const statusLabel = { PENDING: '待审批', APPROVED: '已同意', REJECTED: '已拒绝', EXPIRED: '已过期', CANCELLED: '已取消' }
const timeLabel = (value: string) => new Date(value).toLocaleString('zh-CN')

export function WeComRepairApprovalPanel({ data, busy, onSave }: Props) {
  const [draft, setDraft] = useState<{ enabled: boolean; ids: string[]; version: number } | null>(null)
  const [notice, setNotice] = useState('')
  const config = data.bindingApproval
  const eligible = config.eligibleMemberIds
  const current = data.members.filter((m) => config.approverMemberIds.includes(m.memberId))
  const candidates = data.members.filter((m) => m.active || config.approverMemberIds.includes(m.memberId))
  const directoryReady = data.directory.enabled && Boolean(data.directory.verifiedAt)
  const pendingCount = config.pendingCount ?? config.requests.filter((r) => r.status === 'PENDING').length
  const valid = draft && draft.ids.every((id) => eligible.includes(id))
    && (!draft.enabled || (directoryReady && draft.ids.length > 0))
  const changed = draft && (draft.enabled !== config.enabled
    || [...draft.ids].sort().join() !== [...config.approverMemberIds].sort().join())

  return <section className="repair-admin-editor repair-approval-panel" aria-label="企业微信简易绑定审批">
    <div className="page-heading">
      <div><h4>企业微信简易绑定审批</h4><p>员工发申请 → 指定审批人收到私聊卡片 → 任一人同意后自动绑定。日常审批无需进入后台。</p></div>
      <span className={config.enabled ? 'source-complete' : 'source-partial'}>{config.enabled ? '已启用' : '未启用'}</span>
    </div>
    <p>审批人：{current.map((m) => `${m.displayName}（${m.userId}）`).join('、') || '尚未选择'}。最多两人，审批权与播报接收权限分开配置。</p>
    {config.enabled && (!directoryReady || !current.some((m) => eligible.includes(m.memberId))) ? <p className="error">审批暂不可用：请恢复通讯录通知并重新核对审批人的在职身份与绑定。</p> : null}
    {!draft ? <button type="button" className="secondary" disabled={busy || !data.credentialConfigured} onClick={() => {
      setDraft({ enabled: config.enabled, ids: [...config.approverMemberIds], version: data.rowVersion }); setNotice('')
    }}>配置审批人</button> : <form onSubmit={async (event) => {
      event.preventDefault()
      if (!valid || !changed || busy) return
      const saved = await onSave({ action: 'APPROVAL_CONFIG', approvalEnabled: draft.enabled, approverMemberIds: draft.ids }, draft.version)
      if (saved) { setDraft(null); setNotice(draft.enabled ? '审批设置已保存。员工现在可以按下方格式申请。' : '审批设置已保存，简易绑定审批已停用。') }
      else setNotice('保存未成功，请查看页面错误提示；若名单已更新，请取消编辑后重新配置。')
    }}>
      <label className="inline-toggle"><input type="checkbox" checked={draft.enabled} disabled={busy} onChange={(e) => setDraft({ ...draft, enabled: e.target.checked })} />启用企业微信简易绑定审批</label>
      <fieldset disabled={busy}><legend>勾选绑定审批人 · 已选择 {draft.ids.length}/2 人</legend>
        <p>勾选后，该人员可批准其他员工绑定申请中的任意门店。这是授权管理权限，不只是接收提醒；不能审批自己的申请。</p>
        <div className="repair-admin-hotels">{candidates.map((member) => {
          const selected = draft.ids.includes(member.memberId), selectable = eligible.includes(member.memberId)
          return <label className="inline-toggle repair-approval-person" key={member.memberId}>
            <input type="checkbox" aria-label={`审批人 ${member.displayName} ${member.userId}`} checked={selected}
              disabled={!selected && (!selectable || draft.ids.length >= 2)} onChange={(e) => setDraft({ ...draft,
                ids: e.target.checked ? [...draft.ids, member.memberId] : draft.ids.filter((id) => id !== member.memberId) })} />
            <span><strong>{member.displayName}</strong><small>{member.userId}</small><small>{selectable ? '通讯录身份已关联，可授予审批权' : '需先完成绑定并核对通讯录账号'}</small></span>
          </label>
        })}</div>
        {!candidates.length ? <p>暂无已绑定人员，请先为两位负责人完成绑定并关联通讯录身份。</p> : null}
      </fieldset>
      {!directoryReady ? <p className="error">启用前需先完成下方通讯录回调验证。</p> : null}
      {pendingCount > 0 && changed ? <p className="error">保存变更将取消当前 {pendingCount} 条待审批申请，旧卡片不再有效，员工需重新申请。</p> : null}
      <div className="heading-actions"><button type="submit" disabled={busy || !valid || !changed}>{busy ? '保存中…' : '保存审批设置'}</button><button type="button" className="secondary" disabled={busy} onClick={() => { setDraft(null); setNotice('') }}>取消编辑审批人</button></div>
    </form>}
    {notice ? <p role="status">{notice}</p> : null}
    {config.enabled ? <div className="repair-approval-guide"><p>单店：<code>申请 003 你的姓名</code>　多店：<code>申请 003,005 你的姓名</code></p><p>批准后自动绑定；员工可发送“申请状态”或“取消申请”。申请有效期为24小时。员工仍需打开机器人单聊。</p><p>员工填写的姓名仅作核对线索。新绑定人员如未关联通讯录账号，离职自动解绑尚未生效，请管理员补充核对。</p>{!data.connected ? <p className="error">机器人未连接，暂时无法推送审批卡片；连接恢复后才会处理未发送的申请。</p> : null}</div> : null}
    <details><summary>最近绑定申请 · {pendingCount} 条待审批</summary>
      {!config.requests.length ? <p>暂无申请。启用并保存审批人后，员工即可在企微发起申请。</p> : <div className="repair-admin-roster">{config.requests.map((request) => <article className="repair-admin-member" key={request.id}>
        <div><strong>{request.claimedName}（员工填写）</strong><span>{statusLabel[request.status]}</span></div>
        <p className="repair-admin-account">账号：{request.userId} · 申请 {request.id.slice(0, 8)}</p>
        <p>申请门店：{request.hotels}</p><small>提交：{timeLabel(request.createdAt)}</small>
        {request.status === 'PENDING' ? <p>卡片已确认送达 {request.deliveredCount}/{request.cardCount} 人；有效至 {timeLabel(request.expiresAt)}。</p> : null}
        {request.deliveryUncertain ? <p className="error">部分卡片发送结果待确认，请核对企微消息。不会自动重复推送；需要重提时由申请人先取消申请。</p> : null}
        {request.decidedBy ? <small>处理人：{request.decidedBy} · {request.decidedAt ? timeLabel(request.decidedAt) : ''}</small> : null}
      </article>)}</div>}
    </details>
  </section>
}
