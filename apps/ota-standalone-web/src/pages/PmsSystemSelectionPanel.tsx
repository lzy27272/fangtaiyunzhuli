import { useEffect, useState, type FormEvent } from 'react'
import {
  changePmsSystem,
  loadPmsSystem,
  type HotelContext,
  type PmsSystemCode,
  type SimulationHotelView,
} from '../api/business'
import { businessErrorMessage } from '../ui/businessDisplay'

export const PMS_VENDOR_LABELS: Record<PmsSystemCode, string> = {
  MEITUAN_BIEYANGHONG: '美团别样红 PMS',
  LUOPAN_CLOUD: '罗盘 PMS',
  YILIAN_CLOUD: '驿联云 PMS',
  OTHER: '其他 PMS 厂家',
}

interface Props {
  context: HotelContext
  canConfigure: boolean
  onSaved: (hotel: SimulationHotelView) => void
  onRefreshed: (hotel: SimulationHotelView) => void
}

export function PmsSystemSelectionPanel({ context, canConfigure, onSaved, onRefreshed }: Props) {
  const [current, setCurrent] = useState<SimulationHotelView | null>(null)
  const [vendor, setVendor] = useState<PmsSystemCode>('LUOPAN_CLOUD')
  const [vendorName, setVendorName] = useState('')
  const [confirmed, setConfirmed] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError('')
    loadPmsSystem(context).then((hotel) => {
      if (cancelled) return
      setCurrent(hotel)
      setVendor(hotel.pmsSystemCode)
      setVendorName(hotel.pmsSystemCode === 'OTHER' ? hotel.pmsSystemName : '')
      setConfirmed(false)
    }).catch((cause) => {
      if (!cancelled) setError(businessErrorMessage(cause, '读取 PMS 厂家失败，请刷新配置后重试。'))
    }).finally(() => {
      if (!cancelled) setLoading(false)
    })
    return () => { cancelled = true }
  }, [context])

  const changed = Boolean(current && (
    vendor !== current.pmsSystemCode
    || (vendor === 'OTHER' && vendorName.trim() !== current.pmsSystemName)
  ))
  const nameValid = vendor !== 'OTHER' || Boolean(vendorName.trim())
  const busy = loading || saving
  const ready = canConfigure && Boolean(current) && changed && confirmed && nameValid && !busy

  async function refreshConfig() {
    if (busy) return
    setLoading(true)
    setError('')
    try {
      onRefreshed(await loadPmsSystem(context))
    } catch (cause) {
      setError(businessErrorMessage(cause, '读取 PMS 厂家失败，请刷新配置后重试。'))
    } finally {
      setLoading(false)
    }
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!current || !ready) return
    setSaving(true)
    setError('')
    try {
      const hotel = await changePmsSystem(context, {
        pmsSystemCode: vendor,
        ...(vendor === 'OTHER' ? { pmsSystemName: vendorName.trim() } : {}),
        expectedRowVersion: current.rowVersion,
      })
      onSaved(hotel)
    } catch (cause) {
      setError(businessErrorMessage(cause, 'PMS 厂家未能保存，请刷新配置后重试。'))
    } finally {
      setSaving(false)
    }
  }

  return <form className="report-source-card pms-endpoint-card pms-system-selection" id="pms-system-config-panel" tabIndex={-1} onSubmit={save} aria-label="更换门店 PMS 系统">
    <header>
      <div><span>{current ? `${current.hotelCode} · ${current.hotelName}` : '当前门店'}</span><strong>选择 PMS 系统</strong></div>
      <span className="mode-chip">{loading ? '正在读取…' : current ? `当前：${current.pmsSystemName}` : '配置未读取'}</span>
    </header>
    <div className="pms-vendor-selection">
      <label>
        当前门店 PMS 厂家
        <select aria-label="当前门店 PMS 厂家" disabled={!canConfigure || !current || busy} value={current ? vendor : ''} onChange={(event) => {
          setVendor(event.target.value as PmsSystemCode)
          setVendorName('')
          setConfirmed(false)
          setError('')
        }}>
          <option value="" disabled>请先读取当前厂家</option>
          {Object.entries(PMS_VENDOR_LABELS).map(([code, label]) => <option key={code} value={code}>{label}</option>)}
        </select>
        <small>更换 PMS 后，在此选择新厂家并保存；登录方式、已有链接和报表入口会随厂家更新。</small>
      </label>
      {vendor === 'OTHER' ? <label>
        PMS 厂家名称
        <input aria-label="PMS 厂家名称" value={vendorName} maxLength={80} disabled={!canConfigure || !current || busy} required onChange={(event) => {
          setVendorName(event.target.value)
          setConfirmed(false)
          setError('')
        }} placeholder="填写门店正在使用的 PMS 厂家" />
        <small>未适配厂家可登记配置，完成只读接口适配前保持停采集。</small>
      </label> : null}
    </div>
    {changed ? <div className="inline-message info" role="status">
      <p>切换后将暂停原 PMS 采集，原系统的授权不会用于新系统。历史经营数据保留；新 PMS 完成登录和采集验证后才能恢复。</p>
      <label className="cookie-clear-option"><input type="checkbox" checked={confirmed} disabled={busy || !canConfigure} onChange={(event) => setConfirmed(event.target.checked)} />确认 {current?.hotelCode} · {current?.hotelName} 已更换 PMS，并使用所选厂家</label>
      {!nameValid ? <p>请填写新 PMS 的厂家名称。</p> : null}
    </div> : null}
    {error ? <div className="inline-message error" role="alert">{error}</div> : null}
    <footer>
      <span>{changed
        ? !confirmed ? '请先勾选“确认门店已更换 PMS”，再保存。' : '仅修改当前门店，保存后按新厂家的引导完成授权。'
        : !current ? '请先读取当前门店的 PMS 配置。'
          : !current.collectionEnabled ? '当前厂家已保存，采集仍暂停；请完成本店新系统授权和完整采集验证。'
            : '当前厂家已保存；如门店已更换 PMS，可在上方重新选择。'}</span>
      <div className="heading-actions">
        <button className="secondary" type="button" disabled={busy} onClick={() => void refreshConfig()}>刷新配置</button>
        {canConfigure ? <button type="submit" disabled={!ready}>{saving ? '正在保存 PMS 厂家…' : '保存 PMS 厂家'}</button> : null}
      </div>
    </footer>
  </form>
}
