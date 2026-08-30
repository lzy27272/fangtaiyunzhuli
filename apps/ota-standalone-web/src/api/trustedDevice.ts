import { refreshSession } from './auth'
import type { HotelContext } from './business'
import { clearSession, getSession, setSession } from '../auth/session'

const API_BASE_URL = (
  import.meta.env.VITE_OTA_API_BASE_URL ?? '/api/v1'
).replace(/\/$/, '')

export interface TrustedDeviceView {
  deviceId: string
  label: string
  status: 'ACTIVE' | 'REVOKED'
  enrolledAt: string
  lastSeenAt: string | null
  lastSnapshotAt: string | null
  lastBusinessDate: string | null
  lastCompleteness: 'COMPLETE' | 'PARTIAL' | 'UNAVAILABLE' | null
}

export interface TrustedDeviceStatus {
  eligible: boolean
  mode: 'STORE_TRUSTED_DEVICE' | 'NOT_APPLICABLE'
  hotelCode: string
  hotelName: string
  enrollmentTtlMinutes: number
  enrollmentPending: boolean
  enrollmentExpiresAt: string | null
  device: TrustedDeviceView | null
}

export interface TrustedDeviceEnrollment {
  enrollmentCode: string
  expiresAt: string
  hotelCode: '001'
  label: string
}

const requestId = (): string =>
  globalThis.crypto?.randomUUID?.()
  ?? `web-${Date.now()}-${Math.random().toString(16).slice(2)}`

const pathFor = (context: HotelContext, suffix: string): string => {
  const tenantId = encodeURIComponent(context.tenantId)
  const hotelId = encodeURIComponent(context.hotelId)
  return `/ota/tenants/${tenantId}/hotels/${hotelId}${suffix}`
}

const failureCode = async (response: Response): Promise<string> => {
  try {
    const body = await response.json() as { code?: string }
    return body.code ?? `请求失败（${response.status}）`
  } catch {
    return `请求失败（${response.status}）`
  }
}

const request = async <T>(
  context: HotelContext,
  suffix: string,
  init: RequestInit = {},
  allowRefresh = true,
): Promise<T> => {
  const session = getSession()
  if (!session) throw new Error('会话已失效，请重新登录')
  const response = await fetch(`${API_BASE_URL}${pathFor(context, suffix)}`, {
    ...init,
    credentials: 'include',
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${session.accessToken}`,
      'X-Correlation-ID': requestId(),
      ...init.headers,
    },
  })
  if (response.status === 401 && allowRefresh) {
    try {
      const refreshed = await refreshSession()
      setSession(refreshed)
      return request<T>(context, suffix, init, false)
    } catch (cause) {
      clearSession()
      throw cause
    }
  }
  if (!response.ok) throw new Error(await failureCode(response))
  const body = await response.json() as { data?: T }
  if (!Object.hasOwn(body, 'data')) throw new Error('服务响应缺少data字段')
  return body.data as T
}

export const loadTrustedDeviceStatus = (
  context: HotelContext,
): Promise<TrustedDeviceStatus> => request(context, '/trusted-device')

export const createTrustedDeviceEnrollment = (
  context: HotelContext,
  label = '001门店采集电脑',
): Promise<TrustedDeviceEnrollment> => request(
  context,
  '/trusted-device/enrollment',
  {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Idempotency-Key': requestId(),
    },
    body: JSON.stringify({ label }),
  },
)

export const revokeTrustedDevice = (
  context: HotelContext,
): Promise<{ revoked: boolean; status: TrustedDeviceStatus }> => request(
  context,
  '/trusted-device',
  {
    method: 'DELETE',
    headers: { 'Idempotency-Key': requestId() },
  },
)
