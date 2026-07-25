import { useEffect, useState } from 'react'
import {
  listAdapters,
  loadConfiguration,
  updateHotel,
  upsertConnector,
  type AdapterSummary,
  type ConnectorView,
  type HotelContext,
  type SimulationConfiguration,
} from '../api/business'
import { StatePanel } from '../components/StatePanel'
import { ConnectorAdmissionReadinessPanel } from './ConnectorAdmissionReadinessPanel'
import { RealConnectorPrepPanel } from './RealConnectorPrepPanel'

interface Props {
  context: HotelContext | null
  canConfigure: boolean
  canReadConnectorGovernance: boolean
}

export function ConnectionConfigPage({
  context,
  canConfigure,
  canReadConnectorGovernance,
}: Props) {
  const [adapters, setAdapters] = useState<AdapterSummary[]>([])
  const [configuration, setConfiguration] = useState<SimulationConfiguration | null>(null)
  const [reason, setReason] = useState('')
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError('')
    Promise.all([
      listAdapters(),
      context ? loadConfiguration(context) : Promise.resolve(null),
    ])
      .then(([catalog, current]) => {
        if (cancelled) return
        setAdapters(catalog)
        setConfiguration(current)
      })
      .catch((cause) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : '读取配置失败')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [context])

  function toggleAdapter(code: string) {
    if (!configuration) return
    const existing = configuration.connectors.find((connector) => connector.adapterCode === code)
    if (existing) {
      setConfiguration({
        ...configuration,
        connectors: configuration.connectors.map((connector) =>
          connector.connectorId === existing.connectorId
            ? { ...connector, enabled: !connector.enabled }
            : connector),
      })
      return
    }
    const adapter = adapters.find((item) => item.code === code)
    if (!adapter) return
    const sourceCode = adapter.sourceSystem
    const connector: ConnectorView = {
      connectorId: globalThis.crypto.randomUUID(),
      adapterCode: adapter.code,
      sourceCode,
      enabled: true,
      fixtureScenarioCode: 'BASELINE',
      pollIntervalMinutes: sourceCode === 'PMS' ? 5 : 15,
      rowVersion: 0,
      secret: { referenceConfigured: false },
    }
    setConfiguration({
      ...configuration,
      connectors: [...configuration.connectors, connector],
    })
  }

  async function save() {
    if (!context || !configuration || !reason.trim()) return
    if (!/^[A-Z0-9][A-Z0-9_-]{1,63}$/.test(reason.trim())) {
      setError('变更原因码必须为2至64位大写字母、数字、下划线或连字符。')
      return
    }
    setSaving(true)
    setError('')
    setNotice('')
    try {
      const reasonCode = reason.trim().toUpperCase()
      await updateHotel(context, configuration.hotel, reasonCode)
      for (const connector of configuration.connectors) {
        await upsertConnector(context, {
          connectorId: connector.connectorId,
          adapterCode: connector.adapterCode,
          sourceCode: connector.sourceCode,
          enabled: connector.enabled,
          fixtureScenarioCode: connector.fixtureScenarioCode,
          pollIntervalMinutes: connector.pollIntervalMinutes,
          rowVersion: connector.rowVersion,
        }, reasonCode)
      }
      setConfiguration(await loadConfiguration(context))
      setReason('')
      setNotice('模拟配置已分步保存并重新载入；未建立任何真实连接。')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '保存失败')
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="page-card">
      <div className="page-heading">
        <div>
          <p className="eyebrow">01 · CONNECTIONS</p>
          <h2>PMS与OTA接入配置</h2>
          <p>仅登记内置模拟适配器及非密钥参数。任意脚本、URL、Cookie和Webhook均不在此页面接收。</p>
        </div>
        <span className="mode-chip">SIMULATION ONLY</span>
      </div>

      {!context ? (
        <div className="state-panel">请先在顶部载入租户和门店。</div>
      ) : (
        <StatePanel loading={loading} error={error}>
          <div className="adapter-grid">
            {adapters.map((adapter) => {
              const selected = configuration?.connectors.some((connector) =>
                connector.adapterCode === adapter.code && connector.enabled) ?? false
              return (
                <label className={`adapter-card ${selected ? 'selected' : ''}`} key={adapter.code}>
                  <input
                    checked={selected}
                    disabled={!canConfigure || !configuration || !adapter.simulationOnly}
                    type="checkbox"
                    onChange={() => toggleAdapter(adapter.code)}
                  />
                  <span>
                    <strong>{adapter.displayName}</strong>
                    <small>{adapter.sourceSystem} · {adapter.code}</small>
                    <small>{adapter.streams.join(' / ')}</small>
                  </span>
                  <b>{adapter.simulationOnly ? '模拟' : '已禁用'}</b>
                </label>
              )
            })}
          </div>

          {configuration ? (
            <div className="configuration-form">
              <label>
                门店显示名
                <input
                  disabled={!canConfigure}
                  value={configuration.hotel.displayName}
                  onChange={(event) => setConfiguration({
                    ...configuration,
                    hotel: { ...configuration.hotel, displayName: event.target.value },
                  })}
                />
              </label>
              <label>
                门店时区
                <input
                  disabled={!canConfigure}
                  value={configuration.hotel.timezone}
                  onChange={(event) => setConfiguration({
                    ...configuration,
                    hotel: { ...configuration.hotel, timezone: event.target.value },
                  })}
                />
              </label>
              <label className="wide-field">
                变更原因码
                <input
                  disabled={!canConfigure}
                  pattern="[A-Z0-9][A-Z0-9_-]{1,63}"
                  placeholder="例如 SPRINT1_SIMULATION_CONFIG"
                  value={reason}
                  onChange={(event) => setReason(event.target.value.toUpperCase())}
                />
              </label>
              <div className="safety-lock wide-field">
                <strong>企微投递：数据库级禁用</strong>
                <span>
                  messageEnabled = false；outboundDeliveryBlocked =
                  {configuration.outboundDeliveryBlocked ? 'true' : '安全门禁异常'}
                </span>
              </div>
              <button
                disabled={!canConfigure || saving || !reason.trim()}
                type="button"
                onClick={save}
              >
                {saving ? '正在分步保存…' : '分步保存模拟配置'}
              </button>
              <p className="muted">门店和连接器按各自row_version逐项提交；失败时停止后续步骤并重新载入核对。</p>
              {!canConfigure ? <p className="muted">当前角色为只读，不能修改门店配置。</p> : null}
              {notice ? <p className="success-note">{notice}</p> : null}
            </div>
          ) : null}
        </StatePanel>
      )}
      {context && canReadConnectorGovernance ? (
        <>
          <RealConnectorPrepPanel context={context} canConfigure={canConfigure} />
          <ConnectorAdmissionReadinessPanel context={context} />
        </>
      ) : null}
      {context && !canReadConnectorGovernance ? (
        <div className="state-panel">
          当前角色没有跨租户连接器读取权限。
        </div>
      ) : null}
    </section>
  )
}
