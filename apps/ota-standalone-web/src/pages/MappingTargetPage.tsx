import { useEffect, useMemo, useState } from 'react'
import {
  loadConfiguration,
  upsertInventoryPool,
  upsertProduct,
  upsertProductMapping,
  upsertRevenueTarget,
  type HotelContext,
  type InventoryPoolView,
  type ProductMappingView,
  type RevenueTargetView,
  type SellableProductView,
  type SimulationConfiguration,
} from '../api/business'
import { StatePanel } from '../components/StatePanel'
import { businessErrorMessage } from '../ui/businessDisplay'

interface Props {
  context: HotelContext | null
  canConfigure: boolean
  showProductMappings?: boolean
}

interface MappingDraft {
  inventoryPoolCode: string
  physicalRoomTypeName: string
  physicalRoomCount: string
  sourceSystem: 'CTRIP' | 'MEITUAN'
  productCode: string
  productName: string
  mealPlanCode: 'ROOM_ONLY' | 'BREAKFAST_INCLUDED'
}

const EMPTY_MAPPING: MappingDraft = {
  inventoryPoolCode: '',
  physicalRoomTypeName: '',
  physicalRoomCount: '1',
  sourceSystem: 'CTRIP',
  productCode: '',
  productName: '',
  mealPlanCode: 'ROOM_ONLY',
}
const OPERATION_CONFIG_CHANGE_REASON = 'UPDATE_STORE_OPERATION_CONFIGURATION'

function todayInShanghai(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())
}

export function MappingTargetPage({
  context,
  canConfigure,
  showProductMappings = true,
}: Props) {
  const [configuration, setConfiguration] = useState<SimulationConfiguration | null>(null)
  const [draft, setDraft] = useState<MappingDraft>(EMPTY_MAPPING)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  useEffect(() => {
    if (!context) {
      setConfiguration(null)
      return
    }
    let cancelled = false
    setLoading(true)
    setError('')
    loadConfiguration(context)
      .then((current) => {
        if (!cancelled) setConfiguration(current)
      })
      .catch((cause) => {
        if (!cancelled) setError(businessErrorMessage(cause, '读取配置失败'))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [context])

  const joinedMappings = useMemo(() => {
    if (!configuration) return []
    return configuration.productMappings.map((mapping) => ({
      mapping,
      product: configuration.products.find((product) => product.productId === mapping.productId),
      pool: configuration.inventoryPools.find((pool) => pool.inventoryPoolId === mapping.inventoryPoolId),
    }))
  }, [configuration])

  const target = configuration?.targets[0]

  function updateTarget(field: 'roomRevenueTarget' | 'targetAdr', value: string) {
    if (!configuration) return
    const current: RevenueTargetView = target ?? {
      targetVersionId: globalThis.crypto.randomUUID(),
      businessDate: todayInShanghai(),
      roomRevenueTarget: '10000.00',
      targetAdr: '200.00',
      rowVersion: 0,
    }
    setConfiguration({
      ...configuration,
      targets: [{ ...current, [field]: value }, ...configuration.targets.slice(target ? 1 : 0)],
    })
  }

  function addMapping() {
    if (!configuration) return
    const physicalRoomCount = Number.parseInt(draft.physicalRoomCount, 10)
    if (!draft.inventoryPoolCode.trim() || !draft.physicalRoomTypeName.trim()
      || !draft.productCode.trim() || !draft.productName.trim()
      || !Number.isInteger(physicalRoomCount) || physicalRoomCount < 1) {
      setError('库存池、实体房型、有效房量、来源产品编码和名称均为必填。')
      return
    }
    if (configuration.products.some((product) =>
      product.sourceCode === draft.sourceSystem
      && product.externalProductCode === draft.productCode.trim())) {
      setError('同一来源产品只能映射一次。')
      return
    }
    const connector = configuration.connectors.find((item) =>
      item.sourceCode === draft.sourceSystem && item.enabled)
    if (!connector) {
      setError(`当前门店未配置${draft.sourceSystem}辅助来源；OTA数据不是必填，可不新增该映射。`)
      return
    }

    const existingPool = configuration.inventoryPools.find((pool) =>
      pool.physicalRoomTypeCode === draft.inventoryPoolCode.trim())
    const pool: InventoryPoolView = existingPool ?? {
      inventoryPoolId: globalThis.crypto.randomUUID(),
      physicalRoomTypeCode: draft.inventoryPoolCode.trim(),
      displayName: draft.physicalRoomTypeName.trim(),
      physicalRoomCount,
      rowVersion: 0,
    }
    const product: SellableProductView = {
      productId: globalThis.crypto.randomUUID(),
      connectorId: connector.connectorId,
      sourceCode: draft.sourceSystem,
      externalProductCode: draft.productCode.trim(),
      displayName: draft.productName.trim(),
      mealPlanCode: draft.mealPlanCode,
      rowVersion: 0,
    }
    const mapping: ProductMappingView = {
      mappingVersionId: globalThis.crypto.randomUUID(),
      productId: product.productId,
      inventoryPoolId: pool.inventoryPoolId,
      validFrom: new Date().toISOString(),
      rowVersion: 0,
    }
    setConfiguration({
      ...configuration,
      inventoryPools: existingPool ? configuration.inventoryPools : [...configuration.inventoryPools, pool],
      products: [...configuration.products, product],
      productMappings: [...configuration.productMappings, mapping],
    })
    setDraft(EMPTY_MAPPING)
    setError('')
  }

  async function save() {
    if (!context || !configuration) return
    setSaving(true)
    setError('')
    setNotice('')
    try {
      const reasonCode = OPERATION_CONFIG_CHANGE_REASON
      for (const pool of configuration.inventoryPools.filter((item) => item.rowVersion === 0)) {
        await upsertInventoryPool(context, pool, reasonCode)
      }
      for (const product of configuration.products.filter((item) => item.rowVersion === 0)) {
        await upsertProduct(context, product, reasonCode)
      }
      for (const mapping of configuration.productMappings.filter((item) => item.rowVersion === 0)) {
        await upsertProductMapping(context, mapping, reasonCode)
      }
      if (configuration.targets[0]) {
        await upsertRevenueTarget(context, configuration.targets[0], reasonCode)
      }
      setConfiguration(await loadConfiguration(context))
      setNotice('房型对应关系与销售目标已保存。')
    } catch (cause) {
      setError(businessErrorMessage(cause, '保存失败'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="page-card">
      <div className="page-heading">
        <div>
          <p className="eyebrow">运营设置</p>
          <h2>{showProductMappings ? '销售目标与房型对应' : '销售目标与计算规则'}</h2>
          <p>{showProductMappings
            ? '设置每日销售目标，并把渠道售卖名称对应到酒店实体房型。'
            : '设置每日房费目标、目标平均房价与旺季节奏；PMS 房型和 OTA 对应关系在上方维护。'}</p>
        </div>
        <span className="mode-chip">保存后自动同步</span>
      </div>

      {!context ? (
        <div className="state-panel">请先在顶部载入租户和门店。</div>
      ) : (
        <StatePanel loading={loading} error={error}>
          {configuration ? (
            <>
              <div className="target-grid">
                <label>
                  每日房费收入目标
                  <input
                    disabled={!canConfigure}
                    inputMode="decimal"
                    value={target?.roomRevenueTarget ?? ''}
                    onChange={(event) => updateTarget('roomRevenueTarget', event.target.value)}
                  />
                </label>
                <label>
                  目标平均房价
                  <input
                    disabled={!canConfigure}
                    inputMode="decimal"
                    value={target?.targetAdr ?? ''}
                    onChange={(event) => updateTarget('targetAdr', event.target.value)}
                  />
                </label>
                <div className="policy-card">
                  <span>库存计算方式</span>
                  <strong>以酒店实体可售房量为准</strong>
                  <small>渠道库存只用于核对差异，不会覆盖酒店库存。</small>
                </div>
              </div>

              {showProductMappings ? (
                <>
                  <h3>房型对应关系</h3>
                  <div className="mapping-list">
                    {joinedMappings.map(({ mapping, product, pool }) => (
                      <article key={mapping.mappingVersionId}>
                        <div>
                          <strong>{pool?.displayName ?? '库存池不存在'}</strong>
                          <small>酒店实体房型</small>
                        </div>
                        <span>{product?.sourceCode ?? '未知'} · {product?.displayName ?? '产品不存在'}</span>
                        <details className="technical-details"><summary>查看平台产品编号</summary><code>{product?.externalProductCode ?? mapping.productId}</code></details>
                        <b>{mapping.rowVersion === 0 ? '待保存' : `第${mapping.rowVersion}版`}</b>
                      </article>
                    ))}
                    {joinedMappings.length === 0
                      ? <div className="state-panel">尚未设置房型对应关系，渠道库存暂时无法自动核对。</div>
                      : null}
                  </div>

                  {canConfigure ? (
                    <div className="mapping-editor">
                      <label>
                        酒店房型编号
                        <input
                          value={draft.inventoryPoolCode}
                          onChange={(event) => setDraft({ ...draft, inventoryPoolCode: event.target.value.toUpperCase() })}
                        />
                      </label>
                      <label>
                        酒店房型名称
                        <input
                          value={draft.physicalRoomTypeName}
                          onChange={(event) => setDraft({ ...draft, physicalRoomTypeName: event.target.value })}
                        />
                      </label>
                      <label>
                        有效总房量
                        <input
                          inputMode="numeric"
                          value={draft.physicalRoomCount}
                          onChange={(event) => setDraft({ ...draft, physicalRoomCount: event.target.value })}
                        />
                      </label>
                      <label>
                        来源
                        <select
                          value={draft.sourceSystem}
                          onChange={(event) => setDraft({
                            ...draft,
                            sourceSystem: event.target.value as MappingDraft['sourceSystem'],
                          })}
                        >
                          <option value="CTRIP">携程</option>
                          <option value="MEITUAN">美团</option>
                        </select>
                      </label>
                      <label>
                        平台产品编号
                        <input
                          value={draft.productCode}
                          onChange={(event) => setDraft({ ...draft, productCode: event.target.value.toUpperCase() })}
                        />
                      </label>
                      <label>
                        售卖名称
                        <input
                          value={draft.productName}
                          onChange={(event) => setDraft({ ...draft, productName: event.target.value })}
                        />
                      </label>
                      <label>
                        餐食
                        <select
                          value={draft.mealPlanCode}
                          onChange={(event) => setDraft({
                            ...draft,
                            mealPlanCode: event.target.value as MappingDraft['mealPlanCode'],
                          })}
                        >
                          <option value="ROOM_ONLY">无早</option>
                          <option value="BREAKFAST_INCLUDED">含早</option>
                        </select>
                      </label>
                      <button className="secondary" type="button" onClick={addMapping}>添加对应关系</button>
                    </div>
                  ) : null}
                </>
              ) : null}

              <h3>旺季销售进度参考</h3>
              <div className="pace-row">
                {configuration.paceCurves.flatMap((curve) => curve.points.map((point) => (
                  <article key={`${curve.paceCurveVersionId}-${point.cutoffLocalTime}`}>
                    <strong>{point.cutoffLocalTime}</strong>
                    <span>收益 {point.revenueProgressPercent}%</span>
                    <span>售卖 {point.soldProgressPercent}%</span>
                  </article>
                )))}
                {configuration.paceCurves.length === 0
                  ? <div className="state-panel">暂未配置节奏标准，简报不得推断领先或落后。</div>
                  : null}
              </div>

              <div className="save-row simple-save-row">
                <button
                  disabled={!canConfigure || saving}
                  type="button"
                  onClick={save}
                >
                  {saving ? '正在保存…' : '保存运营设置'}
                </button>
              </div>
              <p className="muted">保存失败时不会继续后续步骤，请根据页面提示检查后重试。</p>
              {notice ? <p className="success-note">{notice}</p> : null}
            </>
          ) : null}
        </StatePanel>
      )}
    </section>
  )
}
