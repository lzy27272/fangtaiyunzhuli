import { useEffect, useRef, useState } from 'react'
import { commandOtaCloudBrowser, loadOtaCloudBrowsers, type HotelContext, type OtaCloudBrowserView } from '../api/business'

const LABELS: Record<string, string> = {
  NOT_CONNECTED: '待首次云端登录', LOGIN_REQUIRED: '等待官方登录 / 验证', READY: '门店核对通过',
  SESSION_SAVED: '已保存云端会话', STORE_UNVERIFIED: '门店身份待核对', STORE_MISMATCH: '请切换到试点门店',
  COLLECTING: '正在云端采集', PARTIAL: '部分数据已采集', COLLECTION_FAILED: '采集未完成', UNAVAILABLE: '云端采集服务暂不可用',
}
const ERRORS: Record<string, string> = {
  OTA_CLOUD_BUSY: '正在处理上一项操作，请稍后再试。', OTA_CLOUD_IN_USE: '另一位管理员正在操作此门店，请等待其结束。',
  OTA_CLOUD_UNAVAILABLE: '云端采集服务暂未就绪，现有后台业务不受影响。', OTA_CLOUD_SESSION_EXPIRED: '交互窗口已结束，请重新打开；云端登录资料保留。',
  OTA_CLOUD_LOGIN_OR_STORE_REQUIRED: '请先完成官方登录，并选择页面提示的试点门店。', OTA_CLOUD_STORE_CHANGED: '页面门店与已核对门店不同，已停止采集。',
  MEITUAN_DATA_HTTP_403: '美团拒绝读取，不能按零订单处理。请在官方页面核对登录。',
  OTA_CLOUD_INPUT_SEQUENCE: '操作顺序已变化，请关闭控制画面并重新打开。',
}
type Point = { x: number; y: number }
function DataSummary({ view }: { view: OtaCloudBrowserView }) {
  if (!view.latest) return <p>尚无云端采集结果。完成登录并核对门店后，可执行首次采集。</p>
  return <div className="ota-cloud-results">
    <p>最近云端采集：{view.latest.completedAt ? new Date(view.latest.completedAt).toLocaleString('zh-CN') : '未完成'} · {view.latest.status === 'COMPLETE' ? '本次采集完成' : '数据尚不完整'}</p>
    {Object.entries(view.latest.datasets).map(([key, raw]) => {
      const dataset = raw as { status?: string; data?: Record<string, unknown>; cards?: { id: string; label: string; displayValue: string | null; suffix?: string; scale?: string; rank?: { position: number; peers: number } }[] }
      const label = ({ YESTERDAY: '昨日', LAST_7_DAYS: '近7天', LAST_30_DAYS: '近30天', inventory: '房态', reviews: '评价汇总', traffic: '流量与竞争圈', ordersByBooking: '预订日期订单', ordersByArrival: '入住日期订单' } as Record<string, string>)[key] ?? key
      const data = dataset.data
      const value = (field: string) => typeof data?.[field] === 'number' ? String(data[field]) : '—'
      const detail = key.startsWith('ordersBy') && data ? `有效订单 ${value('effectiveOrders')} 笔；${String(data.startDate)} 至 ${String(data.endDate)}。含已确认订单，不作为实际入住KPI分母。`
        : key === 'reviews' && data ? `累计点评 ${value('total')} 条，综合评分 ${value('rating')}。累计值不是当月好评数量。`
        : key === 'inventory' && Array.isArray(data?.rooms) ? `${data.rooms.length} 个房型；${String(data.startDate)} 至 ${String(data.endDate)}。`
        : key === 'traffic' && data ? `${String(data.startDate)} 至 ${String(data.endDate)}，本店与竞争圈流量已分别保留。` : null
      return <section key={key}><h5>{label}</h5>{dataset.cards ? <dl>{dataset.cards.map(card => <div key={card.id}>
        <dt>{card.label}</dt><dd>{card.displayValue ?? '—'}{card.scale}{card.suffix}{card.rank ? ` · 同行 ${card.rank.position}/${card.rank.peers}` : ''}</dd>
      </div>)}</dl> : <><span>{dataset.status === 'COMPLETE' ? '已完成采集' : '待核对完整性'}</span>{detail ? <p>{detail}</p> : null}</>}</section>
    })}
  </div>
}

function CloudStore({ context, initial, canConfigure, onChange }: { context: HotelContext; initial: OtaCloudBrowserView;
  canConfigure: boolean; onChange: () => void }) {
  const [view, setView] = useState(initial)
  const [opened, setOpened] = useState(false)
  const [frame, setFrame] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [text, setText] = useState('')
  const [zoom, setZoom] = useState(false)
  const sequence = useRef(1)
  const points = useRef<Point[]>([])
  const sending = useRef(false)
  const alive = useRef(true)
  const imageRef = useRef<HTMLImageElement>(null)
  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])
  useEffect(() => { if (!opened) setView(initial) }, [initial, opened])
  const { tenantId, hotelId } = context
  const sessionId = view.sessionId
  useEffect(() => {
    if (!opened || !sessionId) return
    const controller = new AbortController()
    let timer = 0
    const refresh = async () => {
      try {
        if (!sending.current && !document.hidden) {
          const result = await commandOtaCloudBrowser({ tenantId, hotelId }, {
            platformCode: initial.platformCode, action: 'frame', sessionId,
          }, controller.signal)
          if (!controller.signal.aborted) { setFrame(result.frame ?? ''); setView(result) }
        }
      } catch (cause) {
        if (controller.signal.aborted) return
        const code = cause instanceof Error ? cause.message : ''
        if (code !== 'OTA_CLOUD_BUSY') {
          setError(ERRORS[code] ?? '画面连接暂时中断，请重新打开云端窗口。')
          setOpened(false); setFrame(''); return
        }
      }
      if (!controller.signal.aborted) timer = window.setTimeout(() => void refresh(), 1200)
    }
    void refresh()
    return () => { controller.abort(); window.clearTimeout(timer) }
  }, [tenantId, hotelId, initial.platformCode, opened, sessionId])

  async function command(action: string, input?: unknown) {
    if (sending.current) return
    sending.current = true; setBusy(true); setError('')
    try {
      const result = await commandOtaCloudBrowser(context, {
        platformCode: view.platformCode, action, ...(sessionId ? { sessionId } : {}),
        ...(input ? { input, sequence: sequence.current } : {}),
      })
      if (!alive.current) return
      setView(result); sequence.current = result.nextSequence ?? sequence.current
      if (action === 'open') setOpened(true)
      if (action === 'close') { setOpened(false); setFrame(''); setText('') }
      if (action !== 'input') onChange()
    } catch (cause) {
      if (alive.current) { const code = cause instanceof Error ? cause.message : ''; setError(ERRORS[code] ?? `操作未完成（${code || '连接失败'}）`) }
    } finally { sending.current = false; if (alive.current) setBusy(false) }
  }
  const point = (event: React.PointerEvent<HTMLImageElement>): Point => {
    const rect = event.currentTarget.getBoundingClientRect()
    return { x: Math.max(0, Math.min(1279, Math.round((event.clientX - rect.left) * 1280 / rect.width))),
      y: Math.max(0, Math.min(799, Math.round((event.clientY - rect.top) * 800 / rect.height))) }
  }
  return <section className="ota-cloud-store">
    <div className="ota-cloud-heading"><h4>{view.label}</h4><span role="status">{LABELS[view.status] ?? '等待核对'}</span></div>
    <p>采集在云端运行，不依赖您的电脑。试点尚未启用自动调度和企业微信预警。</p>
    {canConfigure ? <div className="ota-cloud-actions">
      <button type="button" disabled={busy || view.controlledByOther} onClick={() => void command('open')}>打开云端官方登录</button>
      {opened ? <>
        <button type="button" disabled={busy || view.busy} onClick={() => void command('inspect')}>核对登录与门店</button>
        <button type="button" disabled={busy || view.busy || !view.binding} onClick={() => void command('collect')}>立即云端采集</button>
        <button type="button" disabled={busy} onClick={() => void command('close')}>关闭云端窗口</button>
      </> : null}
    </div> : <p>请由平台管理员完成首次登录；您可以查看本门店采集结果。</p>}
    {error ? <p className="error" role="alert">{error}</p> : null}
    {view.lastErrorCode ? <p className="warning">{ERRORS[view.lastErrorCode] ?? `待处理：${view.lastErrorCode}`}</p> : null}
    {opened ? <div className="ota-cloud-remote">
      <p>这是服务器上的官方页面。点击画面中的输入框后，在下方输入文字；验证码、扫码和滑块由您本人完成。仅用于登录与核对，勿进行订单或价格操作。</p>
      <div className="ota-cloud-actions"><button type="button" onClick={() => setZoom(value => !value)}>{zoom ? '适应屏幕' : '放大画面'}</button>
        <button type="button" disabled={busy} onClick={() => void command('input', { type: 'scroll', delta: -500 })}>页面上翻</button>
        <button type="button" disabled={busy} onClick={() => void command('input', { type: 'scroll', delta: 500 })}>页面下翻</button></div>
      <div className={`ota-cloud-screen ${zoom ? 'zoomed' : ''}`}>
        {frame ? <img ref={imageRef} src={frame} alt={`${view.label}官方登录交互画面`} draggable={false}
          onPointerDown={event => { if (busy || view.busy) return; event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId); points.current = [point(event)] }}
          onPointerMove={event => { if (points.current.length && points.current.length < 99) points.current.push(point(event)) }}
          onPointerUp={event => { if (!points.current.length) return; const path = [...points.current, point(event)]; points.current = []; void command('input', { type: 'pointer', points: path }) }}
          onPointerCancel={() => { points.current = [] }} /> : <p>正在连接云端画面…</p>}
      </div>
      <div className="ota-cloud-input">
        <label>向已选中的官方输入框输入<input type="password" autoComplete="off" value={text} maxLength={256}
          onChange={event => setText(event.target.value)} placeholder="账号、密码或验证码（发送后清空）" /></label>
        <button type="button" disabled={busy || view.busy || !text} onClick={() => { const value = text; setText(''); void command('input', { type: 'text', text: value }) }}>输入到官方页面</button>
        {(['Tab', 'Enter', 'Backspace', 'Control+A'] as const).map(key => <button key={key} type="button" disabled={busy || view.busy}
          onClick={() => void command('input', { type: 'key', key })}>{({ Tab: '下一个输入框', Enter: '回车', Backspace: '退格', 'Control+A': '全选当前输入框' })[key]}</button>)}
      </div>
      <small>交互窗口最长20分钟；关闭网页不会删除云端登录资料。遇到验证码不自动绕过。</small>
    </div> : null}
    <DataSummary view={view} />
    <small>昨日 / 当月好评转化率、可比竞对报价及自动预警，须完成真实数据验收后启用；缺失数据不会显示为0。</small>
  </section>
}

export function OtaCloudBrowserPanel({ context, canConfigure }: { context: HotelContext; canConfigure: boolean }) {
  const [views, setViews] = useState<OtaCloudBrowserView[]>([])
  const [revision, setRevision] = useState(0)
  const { tenantId, hotelId } = context
  useEffect(() => {
    const controller = new AbortController()
    void loadOtaCloudBrowsers({ tenantId, hotelId }, controller.signal).then(setViews).catch(() => {})
    return () => controller.abort()
  }, [tenantId, hotelId, revision])
  if (!views.length) return null
  return <section className="ota-cloud-panel" aria-label="云端浏览器采集试点">
    <h3>云端浏览器采集 · 两店试点</h3>
    {views.map(view => <CloudStore key={`${tenantId}:${hotelId}:${view.platformCode}`} context={context} initial={view}
      canConfigure={canConfigure} onChange={() => setRevision(value => value + 1)} />)}
  </section>
}
