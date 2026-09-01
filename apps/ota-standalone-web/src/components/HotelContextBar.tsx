import { FormEvent, useCallback, useEffect, useState } from 'react'
import {
  initializeSimulationHotel,
  listSimulationHotels,
  type HotelContext,
  type PmsSystemCode,
  type SimulationHotelView,
} from '../api/business'

interface Props {
  context: HotelContext | null
  canCreate: boolean
  onApply: (context: HotelContext) => void
}

const pmsSystemLabel = (code: PmsSystemCode, name: string) =>
  code === 'OTHER' ? name : code === 'LUOPAN_CLOUD' ? '罗盘PMS' : '美团别样红'

function hotelDisplayCode(
  hotels: SimulationHotelView[],
  target: SimulationHotelView,
): string {
  if (/^\d{3}$/.test(target.hotelCode)) return target.hotelCode
  return String(hotels.indexOf(target) + 1).padStart(3, '0')
}

function resolveHotelContext(
  hotels: SimulationHotelView[],
  hotelReference: string,
): HotelContext | null {
  const normalizedHotel = hotelReference.trim().toUpperCase()
  const matches = hotels.filter(
    (hotel) =>
      hotel.hotelCode.toUpperCase() === normalizedHotel
      || hotelDisplayCode(hotels, hotel) === normalizedHotel,
  )
  if (matches.length === 1) {
    const [selected] = matches
    return {
      tenantId: selected.tenantId,
      hotelId: selected.hotelId,
    }
  }
  return null
}

export function HotelContextBar({ context, canCreate, onApply }: Props) {
  const [hotelReference, setHotelReference] = useState('')
  const [hotels, setHotels] = useState<SimulationHotelView[]>([])
  const [directoryState, setDirectoryState] = useState('尚未载入目录')
  const [error, setError] = useState('')
  const [creating, setCreating] = useState(false)
  const [draft, setDraft] = useState({
    hotelCode: '',
    hotelDisplayName: '',
    pmsSystemCode: 'MEITUAN_BIEYANGHONG' as PmsSystemCode,
    pmsSystemName: '',
    pmsUsername: '',
    pmsPassword: '',
    timezone: 'Asia/Shanghai',
    reasonCode: 'CREATE_SPRINT1_SIMULATION_HOTEL',
  })

  const refreshDirectory = useCallback(async () => {
    setDirectoryState('正在载入门店目录…')
    try {
      const directory = await listSimulationHotels()
      setHotels(directory.hotels)
      setDirectoryState(
        directory.failedTenantIds.length === 0
          ? `${directory.hotels.length}家评审门店`
          : `${directory.hotels.length}家可用，${directory.failedTenantIds.length}个租户读取失败`,
      )
    } catch (cause) {
      setDirectoryState(cause instanceof Error ? cause.message : '门店目录不可用')
    }
  }, [])

  useEffect(() => {
    void refreshDirectory()
  }, [refreshDirectory])

  useEffect(() => {
    if (!context) {
      setHotelReference('')
      return
    }
    const selected = hotels.find(
      (hotel) =>
        hotel.tenantId === context.tenantId
        && hotel.hotelId === context.hotelId,
    )
    if (selected) {
      setHotelReference(hotelDisplayCode(hotels, selected))
    }
  }, [context, hotels])

  function apply(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const resolved = resolveHotelContext(
      hotels,
      hotelReference,
    )
    if (!resolved) {
      setError('请输入门店目录中的门店编号，例如 001。')
      return
    }
    setError('')
    onApply(resolved)
  }

  function selectHotel(value: string) {
    const selected = hotels.find((hotel) => `${hotel.tenantId}|${hotel.hotelId}` === value)
    if (!selected) return
    setHotelReference(hotelDisplayCode(hotels, selected))
    onApply({ tenantId: selected.tenantId, hotelId: selected.hotelId })
  }

  async function createHotel() {
    if (!canCreate) return
    const requiredFields = [
      draft.hotelCode,
      draft.hotelDisplayName,
      draft.timezone,
      draft.reasonCode,
      ...(draft.pmsSystemCode === 'OTHER' ? [draft.pmsSystemName] : []),
    ]
    if (requiredFields.some((value) => !value.trim())) {
      setError('请完整填写门店和时区信息。')
      return
    }
    if (
      draft.pmsSystemCode === 'LUOPAN_CLOUD'
      && (!draft.pmsUsername.trim() || !draft.pmsPassword)
    ) {
      setError('选择罗盘PMS时，必须填写该门店的PMS账号和密码。')
      return
    }
    setCreating(true)
    setError('')
    try {
      const receipt = await initializeSimulationHotel({
        hotelCode: draft.hotelCode,
        hotelDisplayName: draft.hotelDisplayName,
        pmsSystemCode: draft.pmsSystemCode,
        ...(draft.pmsSystemCode === 'OTHER'
          ? { pmsSystemName: draft.pmsSystemName }
          : {}),
        timezone: draft.timezone,
        reasonCode: draft.reasonCode,
        ...(draft.pmsSystemCode === 'LUOPAN_CLOUD'
          ? {
              pmsUsername: draft.pmsUsername,
              pmsPassword: draft.pmsPassword,
            }
          : {}),
      })
      const directory = await listSimulationHotels()
      setHotels(directory.hotels)
      const created = directory.hotels.find((hotel) => hotel.hotelId === receipt.resourceId)
      if (created) {
        setHotelReference(hotelDisplayCode(directory.hotels, created))
        onApply({ tenantId: created.tenantId, hotelId: created.hotelId })
      }
      setDirectoryState(`${directory.hotels.length}家评审门店`)
      setDraft({
        ...draft,
        hotelCode: '',
        hotelDisplayName: '',
        pmsUsername: '',
        pmsPassword: '',
      })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '新增模拟门店失败')
    } finally {
      setCreating(false)
    }
  }

  return (
    <section className="context-section">
      <form className="context-bar" onSubmit={apply}>
        <div>
          <label htmlFor="hotel-directory">门店目录</label>
          <select
            id="hotel-directory"
            value={context ? `${context.tenantId}|${context.hotelId}` : ''}
            onChange={(event) => selectHotel(event.target.value)}
          >
            <option value="">{directoryState}</option>
            {hotels.map((hotel) => (
              <option key={`${hotel.tenantId}-${hotel.hotelId}`} value={`${hotel.tenantId}|${hotel.hotelId}`}>
                {hotelDisplayCode(hotels, hotel)} · {hotel.hotelName}（{pmsSystemLabel(hotel.pmsSystemCode, hotel.pmsSystemName)}）
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="hotel-context">门店编号</label>
          <input
            id="hotel-context"
            maxLength={16}
            placeholder="001"
            value={hotelReference}
            onChange={(event) =>
              setHotelReference(event.target.value.toUpperCase())}
          />
        </div>
        <button type="submit">载入门店</button>
        <button className="secondary" type="button" onClick={refreshDirectory}>刷新目录</button>
        {error ? <span className="context-error" role="alert">{error}</span> : null}
      </form>

      {canCreate ? (
        <details className="simulation-hotel-creator">
          <summary>新增评审门店（无需修改代码或重启）</summary>
          <div>
            <label>
              门店编号
              <input
                value={draft.hotelCode}
                onChange={(event) => setDraft({ ...draft, hotelCode: event.target.value.toUpperCase() })}
              />
            </label>
            <label>
              门店名称
              <input
                value={draft.hotelDisplayName}
                onChange={(event) => setDraft({ ...draft, hotelDisplayName: event.target.value })}
              />
            </label>
            <label>
              PMS系统
              <select
                value={draft.pmsSystemCode}
                onChange={(event) => setDraft({
                  ...draft,
                  pmsSystemCode: event.target.value as PmsSystemCode,
                  pmsUsername: '',
                  pmsPassword: '',
                })}
              >
                <option value="MEITUAN_BIEYANGHONG">美团别样红</option>
                <option value="LUOPAN_CLOUD">罗盘PMS</option>
                <option value="OTHER">其他 PMS 厂家</option>
              </select>
            </label>
            {draft.pmsSystemCode === 'OTHER' ? (
              <label>
                PMS 厂家名称
                <input
                  value={draft.pmsSystemName}
                  onChange={(event) => setDraft({ ...draft, pmsSystemName: event.target.value })}
                />
              </label>
            ) : null}
            {draft.pmsSystemCode === 'LUOPAN_CLOUD' ? (
              <>
                <label>
                  罗盘PMS账号
                  <input
                    autoComplete="off"
                    value={draft.pmsUsername}
                    onChange={(event) => setDraft({ ...draft, pmsUsername: event.target.value })}
                  />
                </label>
                <label>
                  罗盘PMS密码
                  <input
                    autoComplete="new-password"
                    type="password"
                    value={draft.pmsPassword}
                    onChange={(event) => setDraft({ ...draft, pmsPassword: event.target.value })}
                  />
                </label>
              </>
            ) : null}
            <label>
              时区
              <input
                value={draft.timezone}
                onChange={(event) => setDraft({ ...draft, timezone: event.target.value })}
              />
            </label>
            <label>
              原因码
              <input
                value={draft.reasonCode}
                onChange={(event) => setDraft({ ...draft, reasonCode: event.target.value.toUpperCase() })}
              />
            </label>
            <button disabled={creating} type="button" onClick={createHotel}>
              {creating ? '正在创建…' : '创建评审门店'}
            </button>
            <p className="hotel-copy-note">
              {draft.pmsSystemCode === 'MEITUAN_BIEYANGHONG'
                ? '美团别样红：按01/03门店的4个报表模板自动生成接口地址；Cookie与POST请求载荷保持为空，建店后逐项填写。'
                : draft.pmsSystemCode === 'LUOPAN_CLOUD'
                  ? '罗盘PMS：初始化与02门店相同的罗盘入口和采集路径，账号密码按新门店加密保存；首次采集前仍需验证一次该门店的受控浏览器会话。'
                  : '其他PMS：先保存厂家名称和门店档案；完成厂家适配及接口校验前，采集和播报保持关闭。'}
              {' '}两种PMS均不复制OTA配置，建店后请单独配置该门店的OTA平台。
            </p>
          </div>
        </details>
      ) : null}
    </section>
  )
}
