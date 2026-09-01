import { useEffect, useMemo, useState } from 'react'
import {
  saveRoomTypeConfiguration,
  type HotelContext,
  type RoomTypeCatalogSourceView,
  type RoomTypeConfigurationView,
  type RoomTypeMappingView,
} from '../api/business'
import {
  EmptyState,
  Icon,
  PlatformIcon,
  type PlatformIconName,
} from '../components/ConsoleUi'
import {
  configurationDraft,
  observedOtaSources,
  otaRoomTypeAvailable,
  sameRoomTypeConfiguration,
} from './hotSellingRoomModel'

interface Props {
  context: HotelContext
  configuration: RoomTypeConfigurationView
  canConfigure: boolean
  onSaved: (configuration: RoomTypeConfigurationView) => void
}

interface MappingDraft {
  sourceId: string
  otaRoomTypeCode: string
}

const platformLabels: Record<string, string> = {
  CTRIP: '携程',
  MEITUAN: '美团',
  FLIGGY: '飞猪',
  DOUYIN: '抖音',
  QUNAR: '去哪儿',
  TONGCHENG: '同程',
  OTHER: '其他渠道',
}

const formatObservedAt = (value: string | null) => {
  if (!value) return '尚未抓取房型'
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime())
    ? '已抓取'
    : new Intl.DateTimeFormat('zh-CN', {
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      }).format(parsed)
}

const sourceOptionLabel = (source: RoomTypeCatalogSourceView) => (
  `${platformLabels[source.platformCode] ?? source.platformCode}`
  + `${source.displayName
    && source.displayName !== platformLabels[source.platformCode]
    ? ` · ${source.displayName}`
    : ''}`
  + ` · 最近发现${source.roomTypes.length}个房型`
)

export function HotSellingRoomConfigPanel({
  context,
  configuration,
  canConfigure,
  onSaved,
}: Props) {
  const configurationSignature = JSON.stringify({
    hotelId: context.hotelId,
    rowVersion: configuration.rowVersion,
    pmsObservedAt: configuration.pmsObservedAt,
    pmsRoomTypes: configuration.pmsRoomTypes,
    otaSources: configuration.otaSources,
    mappings: configuration.mappings,
    hotSellingRoomTypeCodes: configuration.hotSellingRoomTypeCodes,
  })
  const [draft, setDraft] = useState(() => configurationDraft(configuration))
  const [mappingDrafts, setMappingDrafts] = useState<Record<string, MappingDraft>>({})
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  useEffect(() => {
    setDraft(configurationDraft(configuration))
    setMappingDrafts({})
    setError('')
  }, [configurationSignature])

  useEffect(() => {
    setNotice('')
  }, [context.hotelId])

  const savedDraft = useMemo(() => ({
    mappings: configuration.mappings,
    hotSellingRoomTypeCodes: configuration.hotSellingRoomTypeCodes,
  }), [configuration.mappings, configuration.hotSellingRoomTypeCodes])
  const changed = !sameRoomTypeConfiguration(draft, savedDraft)
  const editingDisabled = !canConfigure || saving
  const availableOtaSources = useMemo(
    () => observedOtaSources(configuration.otaSources),
    [configuration.otaSources],
  )
  const pmsRoomTypeCodes = useMemo(
    () => new Set(configuration.pmsRoomTypes.map(
      (room) => room.physicalRoomTypeCode,
    )),
    [configuration.pmsRoomTypes],
  )
  const sourceById = useMemo(
    () => new Map(configuration.otaSources.map(
      (source) => [source.sourceId, source],
    )),
    [configuration.otaSources],
  )
  const invalidMappings = draft.mappings.filter((mapping) => {
    const source = sourceById.get(mapping.sourceId)
    return !pmsRoomTypeCodes.has(mapping.physicalRoomTypeCode)
      || !source
      || !source.roomTypes.some(
        (roomType) => roomType.roomTypeCode === mapping.otaRoomTypeCode,
      )
  })
  const invalidHotSellingCodes = draft.hotSellingRoomTypeCodes.filter(
    (code) => !pmsRoomTypeCodes.has(code),
  )
  const autoMatchCount = draft.mappings.filter(
    (mapping) => mapping.matchMethod === 'AUTO_NAME',
  ).length
  const mappedPmsCount = new Set(
    draft.mappings
      .filter((mapping) => pmsRoomTypeCodes.has(
        mapping.physicalRoomTypeCode,
      ))
      .map((mapping) => mapping.physicalRoomTypeCode),
  ).size
  const selectedCount = draft.hotSellingRoomTypeCodes.filter(
    (code) => pmsRoomTypeCodes.has(code),
  ).length

  const updateMappingDraft = (
    physicalRoomTypeCode: string,
    patch: Partial<MappingDraft>,
  ) => {
    setNotice('')
    setMappingDrafts((current) => ({
      ...current,
      [physicalRoomTypeCode]: {
        sourceId: current[physicalRoomTypeCode]?.sourceId ?? '',
        otaRoomTypeCode:
          current[physicalRoomTypeCode]?.otaRoomTypeCode ?? '',
        ...patch,
      },
    }))
  }

  const addMapping = (physicalRoomTypeCode: string) => {
    const current = mappingDrafts[physicalRoomTypeCode]
    const source = configuration.otaSources.find(
      (item) => item.sourceId === current?.sourceId,
    )
    const roomType = source?.roomTypes.find(
      (item) => item.roomTypeCode === current?.otaRoomTypeCode,
    )
    if (!source || !roomType) {
      setError('请先选择渠道及该渠道已抓取的房型。')
      return
    }
    if (!otaRoomTypeAvailable(
      draft.mappings,
      source.sourceId,
      roomType.roomTypeCode,
      physicalRoomTypeCode,
    )) {
      setError('该渠道房型已经对应其他 PMS 房型，请先移除原对应关系。')
      return
    }
    const mapping: RoomTypeMappingView = {
      physicalRoomTypeCode,
      sourceId: source.sourceId,
      platformCode: source.platformCode,
      otaRoomTypeCode: roomType.roomTypeCode,
      otaRoomTypeName: roomType.displayName,
      matchMethod: 'MANUAL',
    }
    setDraft((currentDraft) => ({
      ...currentDraft,
      mappings: currentDraft.mappings.some((item) => (
        item.physicalRoomTypeCode === mapping.physicalRoomTypeCode
        && item.sourceId === mapping.sourceId
        && item.otaRoomTypeCode === mapping.otaRoomTypeCode
      ))
        ? currentDraft.mappings
        : [...currentDraft.mappings, mapping],
    }))
    updateMappingDraft(physicalRoomTypeCode, { otaRoomTypeCode: '' })
    setError('')
  }

  const removeMapping = (mapping: RoomTypeMappingView) => {
    setNotice('')
    setDraft((current) => ({
      ...current,
      mappings: current.mappings.filter((item) => !(
        item.physicalRoomTypeCode === mapping.physicalRoomTypeCode
        && item.sourceId === mapping.sourceId
        && item.otaRoomTypeCode === mapping.otaRoomTypeCode
      )),
    }))
  }

  const toggleHotSelling = (physicalRoomTypeCode: string) => {
    setNotice('')
    setDraft((current) => ({
      ...current,
      hotSellingRoomTypeCodes: current.hotSellingRoomTypeCodes.includes(
        physicalRoomTypeCode,
      )
        ? current.hotSellingRoomTypeCodes.filter(
            (code) => code !== physicalRoomTypeCode,
          )
        : [...current.hotSellingRoomTypeCodes, physicalRoomTypeCode],
    }))
  }

  const save = async () => {
    if (!changed || saving) return
    setSaving(true)
    setError('')
    setNotice('')
    try {
      const saved = await saveRoomTypeConfiguration(context, {
        expectedRowVersion: configuration.rowVersion,
        mappings: draft.mappings,
        hotSellingRoomTypeCodes: draft.hotSellingRoomTypeCodes,
      })
      onSaved(saved)
      setNotice(
        `配置已保存：${saved.hotSellingRoomTypeCodes.length}个热销房型已纳入售罄播报。`,
      )
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : '房型配置保存失败'
      setError(
        message.includes('VERSION_CONFLICT')
          ? '配置已被其他管理员更新，请刷新后重新确认。'
          : message,
      )
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="content-panel hot-room-config-panel">
      <div className="section-heading small hot-room-heading">
        <div>
          <h2>热销房型与渠道对应</h2>
          <p>PMS 房型为唯一库存基准；系统列出 OTA 最近一次成功抓取的房型，名称不一致时可手工对应。</p>
        </div>
        <span className="room-config-version">版本 {configuration.rowVersion}</span>
      </div>

      <ol className="room-config-steps" aria-label="热销房型配置步骤">
        <li className="done"><span aria-hidden="true">1</span><div><strong>读取 PMS 房型</strong><small>{configuration.pmsRoomTypes.length}个实体房型</small></div></li>
        <li aria-current="step" className={mappedPmsCount ? 'done' : ''}><span aria-hidden="true">2</span><div><strong>核对渠道对应</strong><small>{mappedPmsCount}个已对应，{autoMatchCount}条同名匹配</small></div></li>
        <li className={selectedCount ? 'done' : ''}><span aria-hidden="true">3</span><div><strong>勾选热销播报</strong><small>{selectedCount}个已选择</small></div></li>
      </ol>

      <div className="room-source-summary">
        <span><PlatformIcon name="PMS" size={22} /><strong>PMS</strong><small>{formatObservedAt(configuration.pmsObservedAt)}</small></span>
        {availableOtaSources.map((source) => (
          <span key={source.sourceId}>
            <PlatformIcon name={source.platformCode as PlatformIconName} size={22} />
            <strong>{platformLabels[source.platformCode] ?? source.displayName}</strong>
            <small>最近发现{source.roomTypes.length}个房型 · {formatObservedAt(source.observedAt)}</small>
          </span>
        ))}
        {availableOtaSources.length === 0 ? <span className="room-source-empty"><strong>暂无已抓取 OTA 渠道</strong><small>未配置或尚无房型目录的渠道不会显示</small></span> : null}
      </div>

      {error ? <div className="inline-message error" role="alert">{error}</div> : null}
      {notice ? <div className="inline-message success" role="status">{notice}</div> : null}
      {autoMatchCount > 0 && changed ? <div className="inline-message info" role="status">系统发现 {autoMatchCount} 条 PMS 与 OTA 同名对应建议；请核对后与热销勾选一起保存。</div> : null}
      {invalidMappings.length || invalidHotSellingCodes.length ? (
        <div className="room-config-invalid" role="alert">
          <div><strong>发现失效的历史配置</strong><small>原房型或渠道目录已变化，请移除后再保存；系统不会静默丢弃。</small></div>
          {invalidMappings.map((mapping) => (
            <span key={`${mapping.physicalRoomTypeCode}-${mapping.sourceId}-${mapping.otaRoomTypeCode}`}>
              {platformLabels[mapping.platformCode] ?? mapping.platformCode} · {mapping.otaRoomTypeName}
              <button disabled={editingDisabled} type="button" onClick={() => removeMapping(mapping)}>移除失效对应</button>
            </span>
          ))}
          {invalidHotSellingCodes.map((code) => (
            <span key={code}>
              已失效 PMS 热销项
              <button disabled={editingDisabled} type="button" onClick={() => setDraft((current) => ({
                ...current,
                hotSellingRoomTypeCodes: current.hotSellingRoomTypeCodes.filter((item) => item !== code),
              }))}>移除失效热销项</button>
            </span>
          ))}
        </div>
      ) : null}

      {configuration.pmsRoomTypes.length === 0 ? (
        <EmptyState title="尚未抓取 PMS 房型" detail="请先执行一次 PMS 采集，系统取得实体房型后才能配置渠道对应和热销播报。" />
      ) : (
        <div className="room-mapping-list">
          {configuration.pmsRoomTypes.map((pmsRoom) => {
            const mappings = draft.mappings.filter((mapping) => (
              mapping.physicalRoomTypeCode === pmsRoom.physicalRoomTypeCode
            ))
            const currentDraft = mappingDrafts[pmsRoom.physicalRoomTypeCode] ?? {
              sourceId: '',
              otaRoomTypeCode: '',
            }
            const selectedSource = configuration.otaSources.find(
              (source) => source.sourceId === currentDraft.sourceId,
            )
            const selected = draft.hotSellingRoomTypeCodes.includes(
              pmsRoom.physicalRoomTypeCode,
            )
            return (
              <article className={`room-match-row${selected ? ' selected' : ''}`} key={pmsRoom.physicalRoomTypeCode}>
                <div className="pms-room-cell">
                  <span className="room-origin"><PlatformIcon name="PMS" size={24} />PMS 房型</span>
                  <strong>{pmsRoom.displayName}</strong>
                  <small>当前可售 {pmsRoom.primaryAvailableRooms ?? '无法判断'} 间</small>
                </div>

                <div className="room-channel-mappings">
                  <div className="room-mapping-title"><strong>渠道对应</strong><small>{mappings.length ? `${mappings.length}条对应关系` : '尚未对应，不影响 PMS 售罄判断'}</small></div>
                  <div className="room-mapping-tags">
                    {mappings.map((mapping) => (
                      <span className="room-mapping-tag" key={`${mapping.sourceId}-${mapping.otaRoomTypeCode}`}>
                        <PlatformIcon name={mapping.platformCode as PlatformIconName} size={20} />
                        <span><strong>{platformLabels[mapping.platformCode] ?? mapping.platformCode} · {mapping.otaRoomTypeName}</strong><small>{mapping.matchMethod === 'AUTO_NAME' ? '系统名称匹配' : '人工对应'}</small></span>
                        {canConfigure ? <button aria-label={`移除${pmsRoom.displayName}与${platformLabels[mapping.platformCode] ?? mapping.platformCode}渠道${mapping.otaRoomTypeName}的对应`} disabled={saving} type="button" onClick={() => removeMapping(mapping)}><Icon name="close" size={15} /></button> : null}
                      </span>
                    ))}
                  </div>
                  {canConfigure ? (
                    <div className="room-mapping-editor">
                      <label>
                        <span>选择渠道</span>
                        <select disabled={editingDisabled} value={currentDraft.sourceId} onChange={(event) => updateMappingDraft(pmsRoom.physicalRoomTypeCode, { sourceId: event.target.value, otaRoomTypeCode: '' })}>
                          <option value="">请选择已抓取渠道</option>
                          {availableOtaSources.map((source) => <option key={source.sourceId} value={source.sourceId}>{sourceOptionLabel(source)}</option>)}
                        </select>
                      </label>
                      <label>
                        <span>选择该渠道房型</span>
                        <select disabled={editingDisabled || !selectedSource || selectedSource.roomTypes.length === 0} value={currentDraft.otaRoomTypeCode} onChange={(event) => updateMappingDraft(pmsRoom.physicalRoomTypeCode, { otaRoomTypeCode: event.target.value })}>
                          <option value="">请选择抓取到的房型名称</option>
                          {(selectedSource?.roomTypes ?? []).map((roomType) => <option disabled={!otaRoomTypeAvailable(draft.mappings, selectedSource?.sourceId ?? '', roomType.roomTypeCode, pmsRoom.physicalRoomTypeCode)} key={roomType.roomTypeCode} value={roomType.roomTypeCode}>{roomType.displayName}</option>)}
                        </select>
                      </label>
                      <button className="quiet-button" disabled={editingDisabled || !currentDraft.sourceId || !currentDraft.otaRoomTypeCode} type="button" onClick={() => addMapping(pmsRoom.physicalRoomTypeCode)}><Icon name="plus" size={16} />添加对应</button>
                    </div>
                  ) : null}
                </div>

                <label className="hot-room-check">
                  <input checked={selected} disabled={editingDisabled} type="checkbox" onChange={() => toggleHotSelling(pmsRoom.physicalRoomTypeCode)} />
                  <span><strong>热销房型</strong><small>{selected ? '已纳入售罄播报' : '不参与热销播报'}</small></span>
                </label>
              </article>
            )
          })}
        </div>
      )}

      <div className="room-config-save-bar">
        <div><strong>已选择 {selectedCount} 个热销房型</strong><small>仅 PMS 可售量可靠且为0或以下时发送独立售罄预警，数据缺失不会误报。</small></div>
        <button className="primary-button" disabled={!canConfigure || saving || !changed || invalidMappings.length > 0 || invalidHotSellingCodes.length > 0 || configuration.pmsRoomTypes.length === 0} type="button" onClick={() => void save()}>{saving ? '正在保存…' : invalidMappings.length || invalidHotSellingCodes.length ? '请先移除失效配置' : changed ? '保存对应关系与播报' : '配置已保存'}</button>
      </div>
    </section>
  )
}
