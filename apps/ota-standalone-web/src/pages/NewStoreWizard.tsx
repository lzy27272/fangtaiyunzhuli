import { useEffect, useMemo, useState } from 'react'
import {
  listManagedAccounts,
  updateManagedAccount,
  type ManagedAccount,
} from '../api/auth'
import {
  initializeSimulationHotel,
  listSimulationHotels,
  loadOtaSources,
  saveOtaSources,
  type OtaPlatformCode,
  type OtaSourceInput,
  type PmsSystemCode,
  type SimulationHotelView,
} from '../api/business'
import type { AuthSession } from '../auth/session'
import { Icon, Status } from '../components/ConsoleUi'
import { businessErrorMessage } from '../ui/businessDisplay'

const STEPS = ['门店信息', '酒店系统', '渠道平台', '管理人员', '校验启用'] as const
const PMS_OPTIONS: Array<{ code: PmsSystemCode; name: string; detail: string }> = [
  { code: 'MEITUAN_BIEYANGHONG', name: '美团别样红 PMS', detail: '门店可信设备采集，登录会话只留在指定电脑' },
  { code: 'LUOPAN_CLOUD', name: '罗盘 PMS', detail: '现有浏览器登录配置与只读采集方式' },
]
const OTA_OPTIONS: Array<{ code: OtaPlatformCode; name: string }> = [
  { code: 'CTRIP', name: '携程' }, { code: 'MEITUAN', name: '美团' },
  { code: 'FLIGGY', name: '飞猪' }, { code: 'DOUYIN', name: '抖音' },
  { code: 'QUNAR', name: '去哪儿' }, { code: 'TONGCHENG', name: '同程' },
]

interface CustomChannel {
  id: string
  name: string
  portalUrl: string
  dataEndpointUrl: string
}

export function NewStoreWizard({
  session,
  onCancel,
  onCreated,
}: {
  session: AuthSession
  onCancel: () => void
  onCreated: (hotel: SimulationHotelView) => void
}) {
  const [step, setStep] = useState(0)
  const [accounts, setAccounts] = useState<ManagedAccount[]>([])
  const [selectedAccounts, setSelectedAccounts] = useState<string[]>([])
  const [selectedOta, setSelectedOta] = useState<OtaPlatformCode[]>(['CTRIP', 'MEITUAN'])
  const [customChannels, setCustomChannels] = useState<CustomChannel[]>([])
  const [showCustom, setShowCustom] = useState(false)
  const [customDraft, setCustomDraft] = useState({ name: '', portalUrl: '', dataEndpointUrl: '' })
  const [draft, setDraft] = useState({
    tenantCode: '', tenantDisplayName: '四方馆酒店经营中心', hotelCode: '', hotelDisplayName: '',
    timezone: 'Asia/Shanghai', pmsSystemCode: 'MEITUAN_BIEYANGHONG' as PmsSystemCode,
    pmsUsername: '', pmsPassword: '',
  })
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [progress, setProgress] = useState<string[]>([])

  useEffect(() => {
    listManagedAccounts(session).then(setAccounts).catch(() => setAccounts([]))
  }, [session])

  const canNext = useMemo(() => {
    if (step === 0) return Boolean(draft.tenantCode.trim() && draft.hotelCode.trim() && draft.hotelDisplayName.trim())
    if (step === 1 && draft.pmsSystemCode === 'LUOPAN_CLOUD') return Boolean(draft.pmsUsername.trim() && draft.pmsPassword)
    return true
  }, [draft, step])

  function toggleOta(code: OtaPlatformCode) {
    setSelectedOta((current) => current.includes(code) ? current.filter((item) => item !== code) : [...current, code])
  }

  function toggleAccount(id: string) {
    setSelectedAccounts((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id])
  }

  function addCustomChannel() {
    if (!customDraft.name.trim() || !customDraft.portalUrl.trim()) {
      setError('新增渠道至少需要填写渠道名称和官方入口。')
      return
    }
    setCustomChannels((current) => [
      ...current,
      { ...customDraft, id: crypto.randomUUID() },
    ])
    setCustomDraft({ name: '', portalUrl: '', dataEndpointUrl: '' })
    setShowCustom(false)
    setError('')
  }

  async function finish() {
    setSubmitting(true); setError(''); setProgress(['正在创建门店基础档案…'])
    try {
      const receipt = await initializeSimulationHotel({
        tenantCode: draft.tenantCode.trim(),
        tenantDisplayName: draft.tenantDisplayName.trim(),
        hotelCode: draft.hotelCode.trim(),
        hotelDisplayName: draft.hotelDisplayName.trim(),
        pmsSystemCode: draft.pmsSystemCode,
        timezone: draft.timezone,
        reasonCode: 'CREATE_STORE_FROM_CONSOLE_WIZARD',
        ...(draft.pmsSystemCode === 'LUOPAN_CLOUD'
          ? { pmsUsername: draft.pmsUsername.trim(), pmsPassword: draft.pmsPassword }
          : {}),
      })
      const directory = await listSimulationHotels()
      const created = directory.hotels.find((hotel) => hotel.hotelId === receipt.resourceId)
      if (!created) throw new Error('门店已创建，但目录回读未找到新门店。')
      const context = { tenantId: created.tenantId, hotelId: created.hotelId }

      setProgress((current) => [...current, '门店基础档案已创建', '正在保存 OTA 渠道启用状态…'])
      const existingSources = await loadOtaSources(context).catch(() => [])
      const selected = new Set(selectedOta)
      const inputs: OtaSourceInput[] = existingSources.map((source) => ({
        sourceId: source.sourceId,
        displayName: source.displayName,
        platformCode: source.platformCode,
        portalUrl: source.portalUrl,
        dataEndpointUrl: source.dataEndpointUrl,
        requestMethod: source.requestMethod,
        requestPayloadJson: source.requestPayloadJson,
        pollIntervalMinutes: source.pollIntervalMinutes,
        enabled: selected.has(source.platformCode),
        cookieUpdate: { action: 'KEEP' },
        credentialUpdate: { action: 'KEEP' },
        rowVersion: source.rowVersion,
      }))
      const existingPlatforms = new Set(existingSources.map((source) => source.platformCode))
      for (const option of OTA_OPTIONS.filter((item) => selected.has(item.code) && !existingPlatforms.has(item.code))) {
        inputs.push({
          sourceId: crypto.randomUUID(),
          displayName: `${option.name}经营数据`,
          platformCode: option.code,
          portalUrl: '',
          dataEndpointUrl: '',
          requestMethod: 'GET',
          requestPayloadJson: '',
          pollIntervalMinutes: 120,
          enabled: true,
          cookieUpdate: { action: 'KEEP' },
          credentialUpdate: { action: 'KEEP' },
          rowVersion: 0,
        })
      }
      for (const channel of customChannels) {
        inputs.push({
          sourceId: channel.id,
          displayName: channel.name,
          platformCode: 'OTHER',
          portalUrl: channel.portalUrl,
          dataEndpointUrl: channel.dataEndpointUrl || channel.portalUrl,
          requestMethod: 'GET', requestPayloadJson: '', pollIntervalMinutes: 60,
          enabled: true, cookieUpdate: { action: 'KEEP' }, credentialUpdate: { action: 'KEEP' }, rowVersion: 0,
        })
      }
      if (inputs.length) await saveOtaSources(context, inputs)

      if (selectedAccounts.length) {
        setProgress((current) => [...current, 'OTA 渠道草稿已保存', '正在分配管理人员门店权限…'])
        const selectedRows = accounts.filter((account) => selectedAccounts.includes(account.id) && !account.roles.includes('PLATFORM_ADMIN'))
        await Promise.all(selectedRows.map((account) => updateManagedAccount(session, account.id, {
          displayName: account.displayName,
          roles: account.roles,
          hotelIds: [...new Set([...(account.hotelIds ?? []), created.hotelId])],
          enabled: account.enabled,
        })))
      }
      setProgress((current) => [...current, '权限已分配', '门店已进入待校验状态'])
      onCreated(created)
    } catch (cause) {
      setError(businessErrorMessage(cause, '新增门店失败'))
    } finally { setSubmitting(false) }
  }

  return (
    <section className="console-page wizard-page">
      <button className="back-link" type="button" onClick={onCancel}>‹ 返回门店总览</button>
      <div className="page-title-row compact-title"><div><p className="section-kicker">门店建档</p><h1>新增门店</h1><p>按步骤创建档案并配置数据连接；播报在渠道校验通过前保持关闭。</p></div></div>

      <ol className="wizard-steps">
        {STEPS.map((label, index) => <li key={label} className={index === step ? 'active' : index < step ? 'done' : ''}><span>{index < step ? <Icon name="check" size={14} /> : index + 1}</span><strong>{label}</strong></li>)}
      </ol>

      <div className="wizard-panel">
        {step === 0 ? (
          <>
            <div className="section-heading"><div><h2>门店基本信息</h2><p>编号用于门店目录和权限范围，请使用现有三位编号规范。</p></div></div>
            <div className="form-grid two">
              <label>租户编号<input maxLength={16} placeholder="001" value={draft.tenantCode} onChange={(event) => setDraft({ ...draft, tenantCode: event.target.value.toUpperCase() })} /></label>
              <label>门店编号<input maxLength={16} placeholder="018" value={draft.hotelCode} onChange={(event) => setDraft({ ...draft, hotelCode: event.target.value.toUpperCase() })} /></label>
              <label>门店名称<input placeholder="请输入门店全称" value={draft.hotelDisplayName} onChange={(event) => setDraft({ ...draft, hotelDisplayName: event.target.value })} /></label>
              <label>所属组织<input value={draft.tenantDisplayName} onChange={(event) => setDraft({ ...draft, tenantDisplayName: event.target.value })} /></label>
              <label>时区<select value={draft.timezone} onChange={(event) => setDraft({ ...draft, timezone: event.target.value })}><option value="Asia/Shanghai">中国标准时间（上海）</option></select></label>
            </div>
          </>
        ) : null}

        {step === 1 ? (
          <>
            <div className="section-heading"><div><h2>选择酒店系统厂家</h2><p>酒店系统厂家与采集方式分离，后续可以继续增加适配厂家。</p></div></div>
            <div className="choice-list">
              {PMS_OPTIONS.map((option) => <button type="button" className={draft.pmsSystemCode === option.code ? 'selected' : ''} key={option.code} onClick={() => setDraft({ ...draft, pmsSystemCode: option.code })}><span className="choice-radio" /><span><strong>{option.name}</strong><small>{option.detail}</small></span><Status tone={option.code === 'MEITUAN_BIEYANGHONG' ? 'ok' : 'info'}>{option.code === 'MEITUAN_BIEYANGHONG' ? '可信设备方式' : '已支持'}</Status></button>)}
              <div className="future-choice"><span className="choice-radio" /><span><strong>其他 PMS 厂家</strong><small>完成厂家适配和接口校验后可加入目录</small></span><Status tone="muted">暂未接入</Status></div>
            </div>
            {draft.pmsSystemCode === 'LUOPAN_CLOUD' ? <div className="form-grid two compact-form"><label>罗盘登录账号<input autoComplete="off" value={draft.pmsUsername} onChange={(event) => setDraft({ ...draft, pmsUsername: event.target.value })} /></label><label>罗盘登录密码<input autoComplete="new-password" type="password" value={draft.pmsPassword} onChange={(event) => setDraft({ ...draft, pmsPassword: event.target.value })} /></label><p className="form-note">登录资料仅提交至受控服务端配置，不在页面回显。</p></div> : <div className="privacy-note"><Icon name="shield" /><span><strong>别样红采用门店可信设备登录</strong><small>账号、密码、验证码和浏览器会话不上传云端。</small></span></div>}
          </>
        ) : null}

        {step === 2 ? (
          <>
            <div className="section-heading"><div><h2>配置 OTA 渠道</h2><p>先登记使用渠道，登录资料和接口校验在门店采集配置中完成。</p></div><button className="quiet-button" type="button" onClick={() => setShowCustom(true)}><Icon name="plus" />新增其他渠道</button></div>
            <div className="channel-table">
              {OTA_OPTIONS.map((option) => <label key={option.code}><input checked={selectedOta.includes(option.code)} type="checkbox" onChange={() => toggleOta(option.code)} /><strong>{option.name}</strong><span>登录与数据接口待校验</span><Status tone={selectedOta.includes(option.code) ? 'warning' : 'muted'}>{selectedOta.includes(option.code) ? '待配置' : '未启用'}</Status></label>)}
              {customChannels.map((channel) => <label key={channel.id}><input checked readOnly type="checkbox" /><strong>{channel.name}</strong><span>{channel.portalUrl}</span><Status tone="warning">待配置</Status></label>)}
            </div>
            {showCustom ? <div className="drawer-backdrop" onMouseDown={() => setShowCustom(false)}><aside className="side-drawer" onMouseDown={(event) => event.stopPropagation()}><header><div><p className="section-kicker">其他渠道设置</p><h2>新增其他 OTA 渠道</h2></div><button className="icon-button" onClick={() => setShowCustom(false)} type="button">×</button></header><div className="drawer-body form-stack"><label>渠道名称<input value={customDraft.name} onChange={(event) => setCustomDraft({ ...customDraft, name: event.target.value })} /></label><label>官方入口<input type="url" placeholder="https://" value={customDraft.portalUrl} onChange={(event) => setCustomDraft({ ...customDraft, portalUrl: event.target.value })} /></label><label>数据接口地址（可稍后配置）<input type="url" placeholder="https://" value={customDraft.dataEndpointUrl} onChange={(event) => setCustomDraft({ ...customDraft, dataEndpointUrl: event.target.value })} /></label></div><footer><button className="quiet-button" type="button" onClick={() => setShowCustom(false)}>取消</button><button className="primary-button" type="button" onClick={addCustomChannel}>加入渠道</button></footer></aside></div> : null}
          </>
        ) : null}

        {step === 3 ? (
          <>
            <div className="section-heading"><div><h2>分配管理人员</h2><p>账号只看见被分配的门店；平台管理员默认拥有全部门店。</p></div></div>
            <div className="account-choice-list">
              {accounts.map((account) => <label key={account.id} className={account.roles.includes('PLATFORM_ADMIN') ? 'fixed' : ''}><input checked={account.roles.includes('PLATFORM_ADMIN') || selectedAccounts.includes(account.id)} disabled={account.roles.includes('PLATFORM_ADMIN')} type="checkbox" onChange={() => toggleAccount(account.id)} /><span><strong>{account.displayName}</strong><small>{account.username}</small></span><Status tone={account.enabled ? 'ok' : 'muted'}>{account.roles.includes('PLATFORM_ADMIN') ? '全部门店' : account.enabled ? '启用' : '停用'}</Status></label>)}
              {!accounts.length ? <div className="empty-inline">未读取到可分配账号，创建后可在“人员与权限”中补充。</div> : null}
            </div>
          </>
        ) : null}

        {step === 4 ? (
          <>
            <div className="section-heading"><div><h2>校验并启用</h2><p>确认配置后创建门店。采集和播报仍需真实登录与数据校验，不会自动绕过平台风控。</p></div></div>
            <dl className="review-list">
              <div><dt>门店</dt><dd>{draft.hotelCode} · {draft.hotelDisplayName}</dd></div>
              <div><dt>PMS</dt><dd>{PMS_OPTIONS.find((item) => item.code === draft.pmsSystemCode)?.name}</dd></div>
              <div><dt>OTA 渠道</dt><dd>{[...selectedOta.map((code) => OTA_OPTIONS.find((item) => item.code === code)?.name), ...customChannels.map((item) => item.name)].filter(Boolean).join('、') || '暂不启用'}</dd></div>
              <div><dt>管理人员</dt><dd>{accounts.filter((account) => account.roles.includes('PLATFORM_ADMIN') || selectedAccounts.includes(account.id)).map((item) => item.displayName).join('、') || '仅平台管理员'}</dd></div>
              <div><dt>初始状态</dt><dd><Status tone="warning">待登录与数据校验</Status></dd></div>
              <div><dt>播报</dt><dd><Status tone="muted">校验前关闭</Status></dd></div>
            </dl>
            {progress.length ? <ol className="progress-list">{progress.map((item) => <li key={item}><Icon name="check" />{item}</li>)}</ol> : null}
          </>
        ) : null}

        {error ? <div className="inline-message error" role="alert">{error}</div> : null}
        <footer className="wizard-actions">
          <button className="quiet-button" disabled={step === 0 || submitting} type="button" onClick={() => setStep((current) => Math.max(0, current - 1))}>上一步</button>
          {step < STEPS.length - 1 ? <button className="primary-button" disabled={!canNext} type="button" onClick={() => { setError(''); setStep((current) => current + 1) }}>下一步：{STEPS[step + 1]}<Icon name="arrow" /></button> : <button className="primary-button" disabled={submitting} type="button" onClick={() => void finish()}>{submitting ? '正在创建并校验…' : '创建门店'}</button>}
        </footer>
      </div>
    </section>
  )
}
