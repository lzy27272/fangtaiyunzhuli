import { useEffect, useState } from 'react'
import type { HotelContext } from '../api/business'
import { approveOccupancyTargets, loadOccupancyReview, occupancyError, type OccupancyReviewView } from '../api/occupancyReview'
import { LoadingState, Status } from '../components/ConsoleUi'
import './occupancyReview.css'

const pct = (value: number | null | undefined) => value === null || value === undefined ? '—' : `${value.toFixed(1)}%`
const pp = (value: number | null) => value === null ? '数据不足' : `${value > 0 ? '+' : ''}${value.toFixed(1)} 个百分点`
const shortDate = (date: string) => `${date.slice(5)} ${['周日', '周一', '周二', '周三', '周四', '周五', '周六'][new Date(`${date}T00:00:00Z`).getUTCDay()]}`
const timeLabel = (value: string | null) => value ? new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(value)) : '暂无'
const shiftWeek = (date: string, weeks: number) => new Date(Date.parse(`${date}T00:00:00Z`) + weeks * 7 * 86400000).toISOString().slice(0, 10)
const initialDraft = (view: OccupancyReviewView) => Object.fromEntries(view.plan.days.flatMap((day) => day.points.map((point) =>
  [`${point.date}/${point.time}`, point.targetPercent === null ? '' : String(point.targetPercent)])))

function TargetEditor({ view, context, canConfigure, onSaved, onDirty }: { view: OccupancyReviewView; context: HotelContext; canConfigure: boolean; onSaved: () => void; onDirty: (dirty: boolean) => void }) {
  const [draft, setDraft] = useState<Record<string, string>>(() => initialDraft(view))
  const [reason, setReason] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const allPoints = view.plan.days.flatMap((day) => day.points)
  const hasChanges = allPoints.some((point) => draft[`${point.date}/${point.time}`] !== (point.targetPercent === null ? '' : String(point.targetPercent)))
  const hasSuggestion = allPoints.some((point) => point.editable && point.suggestedPercent !== null)
  const editable = canConfigure && !saving && view.plan.weekStart >= view.currentWeek
  function useSuggestions() {
    setDraft((previous) => ({ ...previous, ...Object.fromEntries(allPoints.filter((point) => point.editable && point.suggestedPercent !== null)
      .map((point) => [`${point.date}/${point.time}`, String(point.suggestedPercent)])) }))
    setReason(`参考上周同日各时点出租率，确认 ${view.plan.weekStart} 起一周的执行目标。`)
    onDirty(true)
    setError('')
  }
  async function save() {
    setError('')
    const values = allPoints.filter((point) => draft[`${point.date}/${point.time}`]?.trim())
    if (!values.length || !reason.trim() || values.some((point) => {
      const value = Number(draft[`${point.date}/${point.time}`]); return !Number.isFinite(value) || value < 0 || value > 100
    })) { setError('请填写 0–100 的出租率，至少保留一个目标时点，并填写决策说明。'); return }
    setSaving(true)
    try {
      await approveOccupancyTargets(context, { weekStart: view.plan.weekStart, expectedVersion: view.plan.version, reason,
        points: values.map((point) => ({ date: point.date, time: point.time, percent: Number(draft[`${point.date}/${point.time}`]) })) })
      onSaved()
    } catch (cause) { setError(occupancyError(cause)) }
    finally { setSaving(false) }
  }
  return <section id="occupancy-week-targets" className="content-panel occupancy-plan">
    <div className="section-heading small"><div><h2>每天各时点的出租率目标</h2><p>{view.plan.weekStart} 至 {view.plan.weekEnd} · 参考前一周同一星期几</p></div>
      <Status tone={view.plan.version ? 'ok' : 'warning'}>{view.plan.version ? `已生效 · 第 ${view.plan.version} 版` : '尚未确认'}</Status></div>
    <p className="occupancy-help">只管理“在住＋预订”出租率。先填入建议，再调整百分比并确认；不会修改 PMS 或 OTA 的房价、房态。</p>
    {canConfigure ? <div className="occupancy-toolbar"><button className="quiet-button" disabled={!editable || !hasSuggestion} onClick={useSuggestions} type="button">填入上周同日建议</button><span>{hasChanges ? '有未确认的目标' : view.plan.note}</span></div> : <p className="occupancy-help">当前账号可查看目标；平台管理员或有本店权限的运营经理可确认和调整。</p>}
    <div className="occupancy-table-wrap" role="region" aria-label="每天各时点出租率目标" tabIndex={0}>
      <table className="occupancy-table"><thead><tr><th scope="col">入住日</th>{view.times.map((time) => <th scope="col" key={time}>{time}</th>)}</tr></thead>
        <tbody>{view.plan.days.map((day) => <tr key={day.date}><th scope="row">{shortDate(day.date)}<small>参考 {day.baselineDate.slice(5)}</small></th>{day.points.map((point) => {
          const key = `${point.date}/${point.time}`
          return <td key={key} className={point.status === 'BEHIND' ? 'occupancy-behind' : point.status === 'MET' ? 'occupancy-met' : ''}>
            {canConfigure ? <label className="occupancy-target-input"><span className="occupancy-sr-only">{point.date} {point.time} 目标出租率</span><input aria-label={`${point.date} ${point.time} 目标出租率`} type="number" min="0" max="100" step="0.1" inputMode="decimal" placeholder="未设" disabled={!editable || !point.editable} value={draft[key] ?? ''} onChange={(event) => { setDraft((previous) => ({ ...previous, [key]: event.target.value })); onDirty(true) }} /><span>%</span></label>
              : <strong>目标 {pct(point.targetPercent)}</strong>}
            <small title={point.baselineObservedAt ? `上周样本 ${timeLabel(point.baselineObservedAt)}` : '无上周同一时点的可靠样本'}>上周 {pct(point.baselinePercent)}</small>
            {!point.editable ? <small title={point.actualObservedAt ? `实际采集 ${timeLabel(point.actualObservedAt)}` : ''}>实际 {pct(point.actualPercent)}</small> : null}
            <span className="occupancy-point-status">{{ UNSET: point.editable ? '未设目标' : '未设 · 已过点', PENDING: '待到时点', MISSING: '缺采集，不判定', MET: '已达标', BEHIND: `差 ${Math.abs(point.gapPp ?? 0).toFixed(1)} 个百分点` }[point.status]}</span>
          </td>
        })}</tr>)}</tbody></table>
    </div>
    <p className="occupancy-help">表格可左右滑动查看各时点。实际值取该时刻之前、90 分钟内最近一次采集；超时或缺失不记为 0。已经过点的目标锁定，不能事后补改。</p>
    <details className="occupancy-advice"><summary>查看每天的建议依据</summary><ul>{view.plan.days.map((day) => <li key={day.date}><strong>{shortDate(day.date)}：</strong>{day.advice}</li>)}</ul></details>
    {canConfigure ? <div className="occupancy-decision"><label>决策说明<input maxLength={300} value={reason} disabled={!editable} placeholder="例如：周末有团单，18 点目标上调至 85%" onChange={(event) => { setReason(event.target.value); onDirty(true) }} /></label>
      <button className="primary-button" disabled={!editable || !hasChanges || !reason.trim()} onClick={() => void save()} type="button">{saving ? '正在保存…' : '确认目标并生效'}</button></div> : null}
    {error ? <p className="inline-message error" role="alert">{error}</p> : null}
    {view.plan.approvedAt ? <p className="occupancy-help">最近确认：{view.plan.approvedBy} · {timeLabel(view.plan.approvedAt)} · {view.plan.reason}</p> : null}
    {view.recentDecisions.length > 1 ? <details className="occupancy-advice"><summary>目标版本记录</summary><ul>{view.recentDecisions.map((decision) => <li key={decision.version}>第 {decision.version} 版 · {decision.approvedBy} · {timeLabel(decision.approvedAt)} · {decision.reason}</li>)}</ul></details> : null}
  </section>
}

export function OccupancyReviewPanel({ context, canConfigure }: { context: HotelContext; canConfigure: boolean }) {
  const [type, setType] = useState<'WEEK' | 'MONTH'>('WEEK')
  const [date, setDate] = useState('')
  const [planWeek, setPlanWeek] = useState('')
  const [revision, setRevision] = useState(0)
  const [view, setView] = useState<OccupancyReviewView | null>(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [loading, setLoading] = useState(true)
  const [dirty, setDirty] = useState(false)
  function navigate(action: () => void) {
    if (dirty && !window.confirm('出租率目标尚未确认。切换会丢弃未保存的修改，是否继续？')) return
    setDirty(false)
    action()
  }
  useEffect(() => {
    if (!dirty) return
    const protectDraft = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = '' }
    window.addEventListener('beforeunload', protectDraft)
    return () => window.removeEventListener('beforeunload', protectDraft)
  }, [dirty])
  useEffect(() => {
    const controller = new AbortController()
    setLoading(true); setError('')
    loadOccupancyReview(context, { type, date: date || undefined, planWeek: planWeek || undefined }, controller.signal)
      .then((data) => { if (!controller.signal.aborted) setView(data) })
      .catch((cause) => { if (!controller.signal.aborted) { setError(occupancyError(cause)); setView(null) } })
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [context.tenantId, context.hotelId, type, date, planWeek, revision])
  return <div className="occupancy-review">
    <div className="section-heading"><div><h2>出租率复盘</h2><p>入住日口径：在住＋已预订待入住房 ÷ PMS 统计房量；不重复相加、不按下单日统计。</p></div><div className="occupancy-heading-actions"><a className="quiet-button" href="#occupancy-week-targets">直达每日目标 ↓</a><button className="quiet-button" disabled={loading} onClick={() => navigate(() => setRevision((value) => value + 1))} type="button">刷新复盘</button></div></div>
    {notice ? <p className="inline-message success" role="status">{notice}</p> : null}
    {error ? <div className="inline-message error" role="alert"><p>{error}</p><button className="quiet-button" type="button" onClick={() => navigate(() => { setDate(''); setPlanWeek(''); setRevision((value) => value + 1) })}>返回最近周期并重试</button></div> : null}
    {loading ? <LoadingState label="正在读取本店复盘与目标…" /> : null}
    {!loading && view ? <>
      <div className="occupancy-live"><div><span>今日在住＋预订出租率</span><strong>{pct(view.current?.occupancyPercent)}</strong><small>{view.current ? `${timeLabel(view.current.observedAt)}${view.current.stale ? ' · 数据过期，暂不判定达标' : ''}` : '尚无今天的可靠快照'}</small></div>
        <div><span>当前应达到</span><strong>{pct(view.current?.targetPercent)}</strong><small>{view.current?.targetPercent === null || !view.current ? '尚无已确认、已到时点的目标' : view.current.gapPp === null ? '等待新采集' : view.current.gapPp >= 0 ? `当前高于目标 ${view.current.gapPp.toFixed(1)} 个百分点` : `当前差 ${Math.abs(view.current.gapPp).toFixed(1)} 个百分点`}</small></div>
        <div><span>数据积累起点</span><strong className="occupancy-date">{view.history.firstDate ?? '尚未归档'}</strong><small>小时 48 个月 · 日事实 2 年 · 汇总 5 年</small></div></div>
      {view.history.status !== 'READY' ? <p className="inline-message warning" role="status">{view.history.status === 'UNAVAILABLE' ? '历史归档尚未接通，暂不能生成可靠复盘或数值建议。手工确认目标仍可使用。' : `历史同步有延迟（最近 ${timeLabel(view.history.generatedAt)}），请勿把缺失时点当作零出租率。`}</p> : null}
      <section className="content-panel">
        <div className="section-heading small"><div><h2>每店独立周报／月报</h2><p>每周一归集上周、每月初归集上月；随日末数据入库自动更新，无需手工执行。</p></div></div>
        <div className="occupancy-toolbar"><div className="occupancy-segment" aria-label="复盘周期">{(['WEEK', 'MONTH'] as const).map((item) => <button type="button" key={item} aria-pressed={type === item} onClick={() => { if (item !== type) navigate(() => { setType(item); setDate('') }) }}>{item === 'WEEK' ? '每周复盘' : '每月复盘'}</button>)}</div>
          <label>{type === 'WEEK' ? '选择周内任一天' : '选择月份'}<input aria-label="复盘日期" type={type === 'WEEK' ? 'date' : 'month'} max={type === 'WEEK' ? view.today : view.today.slice(0, 7)} value={date ? (type === 'WEEK' ? date : date.slice(0, 7)) : type === 'WEEK' ? view.review.start : view.review.start.slice(0, 7)} onChange={(event) => { const value = event.target.value; if (value) navigate(() => setDate(type === 'WEEK' ? value : `${value}-01`)) }} /></label></div>
        <p className="occupancy-help">{view.review.start} 至 {view.review.end} · {view.review.note}</p>
        <div className="occupancy-summary"><div><span>{view.review.complete ? '本期加权出租率' : '已采集天数出租率（非完整周期）'}</span><strong>{pct(view.review.occupancyPercent)}</strong></div>
          <div><span>环比{type === 'WEEK' ? '上周' : '上月'}</span><strong>{pp(view.review.prior.deltaPp)}</strong><small>上期 {pct(view.review.prior.occupancyPercent)} · {view.review.prior.availableDays}/{view.review.prior.expectedDays} 天</small></div>
          <div><span>{type === 'WEEK' ? '同比去年同周（前 52 周）' : '同比去年同月'}</span><strong>{pp(view.review.priorYear.deltaPp)}</strong><small>去年 {pct(view.review.priorYear.occupancyPercent)} · {view.review.priorYear.availableDays}/{view.review.priorYear.expectedDays} 天</small></div></div>
        <div className="occupancy-table-wrap" role="region" aria-label="复盘每日出租率" tabIndex={0}><table className="occupancy-table"><thead><tr><th scope="col">入住日</th>{view.times.map((time) => <th scope="col" key={time}>{time}</th>)}<th scope="col">日末快照</th></tr></thead><tbody>{view.review.days.map((day) => <tr key={day.date}><th scope="row">{shortDate(day.date)}</th>{day.points.map((point) => <td key={point.time} title={point.observedAt ? `采集于 ${timeLabel(point.observedAt)}` : '无可靠时点样本'}>{pct(point.occupancyPercent)}</td>)}<td title={day.observedAt ? `最后采集于 ${timeLabel(day.observedAt)}` : '无日末快照'}><strong>{pct(day.occupancyPercent)}</strong></td></tr>)}</tbody></table></div>
        <p className="occupancy-help">“—”表示无可靠历史，不是 0%。日末值为 PMS 营业日最后有效快照；同一时点缺采集不会用之后的结果倒填。同比需先积累去年数据。</p>
      </section>
      <div className="occupancy-toolbar occupancy-week-picker"><label>目标周<select aria-label="目标周" value={view.plan.weekStart} onChange={(event) => { const value = event.target.value; navigate(() => { setPlanWeek(value); setNotice('') }) }}>{[-1, 0, 1, 2, 3, 4].map((offset) => { const value = shiftWeek(view.currentWeek, offset); return <option key={value} value={value}>{offset === -1 ? '上周（只读）' : offset === 0 ? '本周' : offset === 1 ? '下周' : `${offset} 周后`} · {value}</option> })}</select></label><span>每店独立确认；默认仅给建议，不自动提高目标。</span></div>
      <TargetEditor key={`${context.hotelId}/${view.plan.weekStart}/${view.plan.version}/${revision}`} view={view} context={context} canConfigure={canConfigure} onDirty={setDirty} onSaved={() => { setDirty(false); setNotice('本店出租率目标已确认并生效。'); setRevision((value) => value + 1) }} />
    </> : null}
  </div>
}
