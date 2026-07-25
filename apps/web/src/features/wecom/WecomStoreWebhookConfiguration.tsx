import { useEffect, useState } from 'react'
import { apiRequest, asList } from '../../api/client'
import type { RoleContext } from '../../domain'

type Row = Record<string, unknown>

type StoreWebhook = {
  hotelOrgUnitId: string
  hotelCode: string
  hotelName: string
  configured: boolean
  updatedAt?: string
  updatedByName?: string
  secureStorageReady: boolean
}

const field = (row: Row, ...keys: string[]) => keys.map((key) => row[key]).find((value) => value !== undefined && value !== null)
const text = (row: Row, ...keys: string[]) => String(field(row, ...keys) ?? '')

function toStoreWebhook(row: Row): StoreWebhook {
  return {
    hotelOrgUnitId: text(row, 'hotelOrgUnitId', 'hotel_org_unit_id'),
    hotelCode: text(row, 'hotelCode', 'hotel_code'),
    hotelName: text(row, 'hotelName', 'hotel_name'),
    configured: Boolean(field(row, 'configured')),
    updatedAt: text(row, 'updatedAt', 'updated_at') || undefined,
    updatedByName: text(row, 'updatedByName', 'updated_by_name') || undefined,
    secureStorageReady: Boolean(field(row, 'secureStorageReady', 'secure_storage_ready')),
  }
}

function displayTime(value?: string) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(date)
}

export function WecomStoreWebhookConfiguration({ identity, permissions }: { identity: RoleContext; permissions: string[] }) {
  const canManage = permissions.includes('*') || permissions.includes('org.manage')
  const [stores, setStores] = useState<StoreWebhook[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string>()
  const [notice, setNotice] = useState<string>()
  const [selected, setSelected] = useState<StoreWebhook>()
  const [webhookUrl, setWebhookUrl] = useState('')

  const reload = async () => {
    setLoading(true)
    setError(undefined)
    try {
      const response = await apiRequest<unknown>('/integrations/wecom/group-webhooks', identity)
      setStores(asList<Row>(response).map(toStoreWebhook))
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '企业微信 Webhook 配置加载失败')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void reload() }, [identity.key])

  const openEditor = (store: StoreWebhook) => {
    setError(undefined)
    setNotice(undefined)
    setWebhookUrl('')
    setSelected(store)
  }

  const closeEditor = () => {
    setWebhookUrl('')
    setSelected(undefined)
  }

  const save = async () => {
    if (!selected) return
    if (!webhookUrl.trim()) {
      setError('请粘贴企业微信群机器人的完整 Webhook 地址。')
      return
    }
    setSaving(true)
    setError(undefined)
    try {
      await apiRequest(`/integrations/wecom/group-webhooks/${selected.hotelOrgUnitId}`, identity, {
        method: 'PUT', body: JSON.stringify({ webhookUrl: webhookUrl.trim() }),
      })
      closeEditor()
      setNotice(`${selected.hotelName} 的企业微信 Webhook 已加密保存。自动推送仍处于禁用状态。`)
      await reload()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Webhook 保存失败')
    } finally {
      setSaving(false)
    }
  }

  const storageReady = selected?.secureStorageReady !== false

  return <section className="page-section configuration-page">
    <header className="page-title">
      <div>
        <span className="eyebrow">WECOM GROUP ROBOT</span>
        <h1>门店企业微信 Webhook</h1>
        <p>为每家门店单独保存群机器人地址。仅完成受控配置，不会发送消息或启用自动推送。</p>
      </div>
      <div className="page-actions"><span className="source-flag api">加密服务端存储</span></div>
    </header>

    <div className="inline-warning page-error">Webhook 是发送凭据：保存后不会在页面、接口响应、审计记录或日志中回显。门店日报与经营提醒仍保持“自动推送禁用”。</div>
    {notice && <div className="inline-success page-error">{notice}</div>}
    {error && <div className="inline-error page-error">{error}</div>}

    <article className="panel table-panel config-panel">
      <header>
        <div><span className="panel-kicker">STORE DESTINATIONS</span><h2>门店群机器人地址</h2></div>
        <button className="secondary" disabled={loading || saving} onClick={() => void reload()}>刷新</button>
      </header>
      {loading ? <div className="state-card"><div className="spinner" /><strong>正在读取门店配置状态</strong></div>
        : !stores.length ? <div className="state-card"><b>◇</b><strong>当前权限范围内没有启用门店</strong><span>请先在“组织与权限”维护门店。</span></div>
          : <div className="simple-table maintenance-table wecom-webhook-table">
            <div className="simple-head"><span>门店</span><span>门店编码</span><span>Webhook 状态</span><span>最近更新</span><span>操作</span></div>
            {stores.map((store) => <div key={store.hotelOrgUnitId}>
              <span><strong>{store.hotelName}</strong><small>一店一址 · 地址不回显</small></span>
              <span>{store.hotelCode || '—'}</span>
              <span><b className={`status-pill ${store.configured ? 'approved' : 'inactive'}`}>{store.configured ? '已配置' : '未配置'}</b></span>
              <span><small>{displayTime(store.updatedAt)}{store.updatedByName ? ` · ${store.updatedByName}` : ''}</small></span>
              <span>{canManage ? <button className="text-action" onClick={() => openEditor(store)}>{store.configured ? '替换地址' : '配置地址'}</button> : '仅可查看'}</span>
            </div>)}
          </div>}
    </article>

    {selected && <div className="modal-backdrop">
      <section className="modal configuration-modal" role="dialog" aria-modal="true" aria-labelledby="wecom-webhook-title">
        <header><div><span className="panel-kicker">{selected.hotelCode || 'HOTEL'}</span><h2 id="wecom-webhook-title">{selected.hotelName} · 群机器人地址</h2></div><button className="close" onClick={closeEditor} aria-label="关闭">×</button></header>
        <div className="form-body configuration-form">
          <p className="inline-warning">请粘贴企业微信群机器人生成的完整地址。为保护凭据，保存成功后系统不会再次显示该地址。</p>
          {!storageReady && <p className="inline-error">服务器尚未配置 Webhook 加密密钥，暂不能保存地址。请由部署管理员设置 <code>WECOM_GROUP_ROBOT_ENCRYPTION_KEY</code> 后重试。</p>}
          <div className="form-grid"><label className="full-field">Webhook 地址<input type="password" autoComplete="off" value={webhookUrl} onChange={(event) => setWebhookUrl(event.target.value)} placeholder="https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=…" /></label></div>
          <small>仅接受企业微信官方群机器人 HTTPS 地址；这里不会校验或触发外部发送。</small>
        </div>
        <footer><button className="secondary" disabled={saving} onClick={closeEditor}>取消</button><button className="primary" disabled={saving || !storageReady} onClick={() => void save()}>{saving ? '保存中…' : '加密保存'}</button></footer>
      </section>
    </div>}
  </section>
}
