import { useEffect, useState } from 'react'
import { loadWeComRepairAdmins, loadWeComRepairBotConfig, repairAdminLabel, type HotelContext, type WeComRepairAdmin, type WeComRepairBotConfigView } from '../api/business'
import { businessErrorMessage } from '../ui/businessDisplay'

interface Props { context: HotelContext | null; canConfigure: boolean; onOpenPeoplePermissions?: () => void }
interface Summary {
  key: string; config: WeComRepairBotConfigView | null
  members: Pick<WeComRepairAdmin, 'memberId' | 'displayName' | 'userId' | 'nameSource' | 'wecomName'>[] | null
  error: string
}

// This store surface is read-only. All global grants/configuration live in People & Permissions.
export function WeComStoreRepairSummary({ context, canConfigure, onOpenPeoplePermissions }: Props) {
  const [summary, setSummary] = useState<Summary | null>(null)
  const hotelId = context?.hotelId, tenantId = context?.tenantId
  const key = `${tenantId}:${hotelId}:${canConfigure}`
  useEffect(() => {
    if (!hotelId || !tenantId) return
    let cancelled = false, inFlight = false
    const refresh = async () => {
      if (inFlight) return
      inFlight = true
      const results = await Promise.allSettled([
        loadWeComRepairBotConfig({ tenantId, hotelId }),
        // The existing roster endpoint remains platform-admin-only; store roles never request it.
        canConfigure ? loadWeComRepairAdmins() : Promise.resolve(null),
      ])
      inFlight = false
      if (cancelled) return
      const failures = results.filter((r) => r.status === 'rejected')
      setSummary({ key, config: results[0].status === 'fulfilled' ? results[0].value : null,
        members: results[1].status === 'fulfilled' && results[1].value ? results[1].value.members
          .filter((member) => member.active && member.hotelIds.includes(hotelId))
          .map(({ memberId, displayName, userId, nameSource, wecomName }) => ({ memberId, displayName, userId, nameSource, wecomName })) : null,
        error: failures.map((r) => r.status === 'rejected' ? businessErrorMessage(r.reason, '读取本店修复人员失败') : '').join('；'),
      })
    }
    void refresh()
    const timer = window.setInterval(() => void refresh(), 5_000)
    return () => { cancelled = true; window.clearInterval(timer) }
  }, [hotelId, tenantId, canConfigure, key])
  const current = summary?.key === key ? summary : null
  const binding = current?.config?.hotelBindings.find((row) => row.hotelId === hotelId)

  if (!context) return null
  return <section className="wecom-automation-card" aria-label="本店企微修复人员">
    <div className="page-heading"><div><p className="eyebrow">本店人员 · 只读</p><h3>本店企微修复人员</h3>
      <p>审批人、人员绑定、多店授权、离职解绑及共用机器人配置，统一在“人员与权限 → 企微管理与审批”管理；本页不修改全平台权限。</p></div>
      {canConfigure && onOpenPeoplePermissions ? <button className="secondary" type="button" onClick={onOpenPeoplePermissions}>前往人员与权限配置</button> : null}</div>
    {!current ? <p role="status">正在读取本店绑定状态…</p> : <>
      {current.error ? <p className="error" role="alert">{current.error}</p> : null}
      <div className="wecom-status-row"><span>共用机器人｜{current.config?.connected ? '已连接' : current.config ? '尚未连接' : '状态未载入'}</span>
        <span>{binding ? `${binding.hotelCode} · ${binding.displayName}｜已绑定 ${binding.pairedUserCount} 人` : '本店绑定人数尚未载入'}</span></div>
      {canConfigure && current.members ? current.members.length ? <ul className="store-repair-members">{current.members.map((member) => <li key={member.memberId}>
        <strong>{repairAdminLabel(member)}</strong><span>{member.userId}</span>{member.wecomName ? <small>企微通讯录名称</small> : member.nameSource === 'APPLICANT_PROVIDED' ? <small>姓名由员工填写</small> : null}
      </li>)}</ul> : <p>本店暂无单独绑定的企微人员。全局接收人由平台统一管理，不计入本店名单。</p> : null}
      {!canConfigure ? <p>人员授权调整请联系平台管理员。</p> : null}
    </>}
  </section>
}
