import { FormEvent, useCallback, useEffect, useState } from 'react'
import {
  initializeSimulationHotel,
  listSimulationHotels,
  type HotelContext,
  type SimulationHotelView,
} from '../api/business'

interface Props {
  context: HotelContext | null
  canCreate: boolean
  onApply: (context: HotelContext) => void
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function tenantDisplayCode(
  hotels: SimulationHotelView[],
  target: SimulationHotelView,
): string {
  if (/^\d{3}$/.test(target.tenantCode)) return target.tenantCode
  const tenantIds = [...new Set(hotels.map((hotel) => hotel.tenantId))]
  return String(tenantIds.indexOf(target.tenantId) + 1).padStart(3, '0')
}

function hotelDisplayCode(
  hotels: SimulationHotelView[],
  target: SimulationHotelView,
): string {
  if (/^\d{3}$/.test(target.hotelCode)) return target.hotelCode
  const tenantHotels = hotels.filter(
    (hotel) => hotel.tenantId === target.tenantId,
  )
  return String(tenantHotels.indexOf(target) + 1).padStart(3, '0')
}

function resolveHotelContext(
  hotels: SimulationHotelView[],
  tenantReference: string,
  hotelReference: string,
): HotelContext | null {
  const normalizedTenant = tenantReference.trim().toUpperCase()
  const normalizedHotel = hotelReference.trim().toUpperCase()
  const selected = hotels.find(
    (hotel) =>
      (
        hotel.tenantCode.toUpperCase() === normalizedTenant
        && hotel.hotelCode.toUpperCase() === normalizedHotel
      )
      || (
        tenantDisplayCode(hotels, hotel) === normalizedTenant
        && hotelDisplayCode(hotels, hotel) === normalizedHotel
      ),
  )
  if (selected) {
    return {
      tenantId: selected.tenantId,
      hotelId: selected.hotelId,
    }
  }
  if (
    UUID_PATTERN.test(tenantReference.trim())
    && UUID_PATTERN.test(hotelReference.trim())
  ) {
    return {
      tenantId: tenantReference.trim(),
      hotelId: hotelReference.trim(),
    }
  }
  return null
}

export function HotelContextBar({ context, canCreate, onApply }: Props) {
  const [tenantReference, setTenantReference] = useState('')
  const [hotelReference, setHotelReference] = useState('')
  const [hotels, setHotels] = useState<SimulationHotelView[]>([])
  const [directoryState, setDirectoryState] = useState('尚未载入目录')
  const [error, setError] = useState('')
  const [creating, setCreating] = useState(false)
  const [draft, setDraft] = useState({
    tenantCode: '',
    tenantDisplayName: '',
    hotelCode: '',
    hotelDisplayName: '',
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
      setTenantReference('')
      setHotelReference('')
      return
    }
    const selected = hotels.find(
      (hotel) =>
        hotel.tenantId === context.tenantId
        && hotel.hotelId === context.hotelId,
    )
    if (selected) {
      setTenantReference(tenantDisplayCode(hotels, selected))
      setHotelReference(hotelDisplayCode(hotels, selected))
    }
  }, [context, hotels])

  function apply(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const resolved = resolveHotelContext(
      hotels,
      tenantReference,
      hotelReference,
    )
    if (!resolved) {
      setError('请输入门店目录中的租户编号和门店编号，例如 001 / 002。')
      return
    }
    setError('')
    onApply(resolved)
  }

  function selectHotel(value: string) {
    const selected = hotels.find((hotel) => `${hotel.tenantId}|${hotel.hotelId}` === value)
    if (!selected) return
    setTenantReference(tenantDisplayCode(hotels, selected))
    setHotelReference(hotelDisplayCode(hotels, selected))
    onApply({ tenantId: selected.tenantId, hotelId: selected.hotelId })
  }

  async function createHotel() {
    if (!canCreate) return
    const fields = Object.values(draft)
    if (fields.some((value) => !value.trim())) {
      setError('新增模拟门店的所有字段均为必填。')
      return
    }
    setCreating(true)
    setError('')
    try {
      const receipt = await initializeSimulationHotel(draft)
      const directory = await listSimulationHotels()
      setHotels(directory.hotels)
      const created = directory.hotels.find((hotel) => hotel.hotelId === receipt.resourceId)
      if (created) {
        setTenantReference(tenantDisplayCode(directory.hotels, created))
        setHotelReference(hotelDisplayCode(directory.hotels, created))
        onApply({ tenantId: created.tenantId, hotelId: created.hotelId })
      }
      setDirectoryState(`${directory.hotels.length}家评审门店`)
      setDraft({
        ...draft,
        hotelCode: '',
        hotelDisplayName: '',
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
                {tenantDisplayCode(hotels, hotel)}/{hotelDisplayCode(hotels, hotel)} · {hotel.tenantName} / {hotel.hotelName}（{hotel.configuredMockConnectors}个示例接口）
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="tenant-context">租户编号</label>
          <input
            id="tenant-context"
            maxLength={16}
            placeholder="001"
            value={tenantReference}
            onChange={(event) =>
              setTenantReference(event.target.value.toUpperCase())}
          />
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
              租户编码
              <input
                value={draft.tenantCode}
                onChange={(event) => setDraft({ ...draft, tenantCode: event.target.value.toUpperCase() })}
              />
            </label>
            <label>
              租户名称
              <input
                value={draft.tenantDisplayName}
                onChange={(event) => setDraft({ ...draft, tenantDisplayName: event.target.value })}
              />
            </label>
            <label>
              门店编码
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
              {creating ? '正在创建…' : '创建模拟门店'}
            </button>
          </div>
        </details>
      ) : null}
    </section>
  )
}
