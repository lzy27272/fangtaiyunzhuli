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
  cutoverAt: string | null
  cutoverReady: boolean
  cutoverPending: boolean
  reenrollRequired: boolean
  scopeApprovalStatus: 'UNBOUND' | 'PENDING' | 'APPROVED'
  scopeApprovedAt: string | null
}

export interface TrustedDeviceStatus {
  eligible: boolean
  mode: 'STORE_TRUSTED_DEVICE' | 'SERVER_COOKIE' | 'NOT_APPLICABLE'
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
  hotelCode: string
  label: string
}

export interface TrustedDeviceBootstrapDownload {
  blob: Blob
  fileName: string
  expiresAt: string | null
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
  { signal }: { signal?: AbortSignal } = {},
): Promise<TrustedDeviceStatus> => request(
  context,
  '/trusted-device',
  { signal },
)

export const trustedDeviceRepairUrl = (hotelCode: string): string => {
  const protocolCode = hotelCode.toLowerCase().replaceAll('_', '-')
  if (!/^[a-z0-9][a-z0-9-]{0,15}$/u.test(protocolCode)) {
    throw new Error('可信设备门店编号无效')
  }
  return `sfgtrusted${protocolCode}://repair`
}

export async function waitForTrustedDeviceSnapshot(
  context: HotelContext,
  baselineSnapshotAt: string | null,
  {
    signal,
    timeoutMs = 5 * 60_000,
    pollIntervalMs = 3_000,
  }: {
    signal?: AbortSignal
    timeoutMs?: number
    pollIntervalMs?: number
  } = {},
): Promise<TrustedDeviceStatus> {
  const wait = (durationMs: number): Promise<void> => new Promise(
    (resolve, reject) => {
      if (signal?.aborted) {
        reject(new DOMException('Aborted', 'AbortError'))
        return
      }
      const onAbort = () => {
        globalThis.clearTimeout(timer)
        reject(new DOMException('Aborted', 'AbortError'))
      }
      const timer = globalThis.setTimeout(() => {
        signal?.removeEventListener('abort', onAbort)
        resolve()
      }, durationMs)
      signal?.addEventListener('abort', onAbort, { once: true })
    },
  )
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
    await wait(pollIntervalMs)
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
    const next = await loadTrustedDeviceStatus(context, { signal })
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
    const latest = next.device?.lastSnapshotAt ?? null
    if (latest && latest !== baselineSnapshotAt) return next
  }
  throw new Error('本机采集器未在5分钟内返回新数据，请进入登录修复查看状态。')
}

export const createTrustedDeviceEnrollment = (
  context: HotelContext,
  label = '门店采集电脑',
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

const downloadBootstrap = async (
  context: HotelContext,
  label: string,
  allowRefresh = true,
): Promise<TrustedDeviceBootstrapDownload> => {
  const session = getSession()
  if (!session) throw new Error('会话已失效，请重新登录')
  const response = await fetch(
    `${API_BASE_URL}${pathFor(context, '/trusted-device/bootstrap')}`,
    {
      method: 'POST',
      credentials: 'include',
      headers: {
        Accept: 'application/octet-stream',
        Authorization: `Bearer ${session.accessToken}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': requestId(),
        'X-Correlation-ID': requestId(),
      },
      body: JSON.stringify({ label }),
    },
  )
  if (response.status === 401 && allowRefresh) {
    try {
      const refreshed = await refreshSession()
      setSession(refreshed)
      return downloadBootstrap(context, label, false)
    } catch (cause) {
      clearSession()
      throw cause
    }
  }
  if (!response.ok) throw new Error(await failureCode(response))
  return {
    blob: await response.blob(),
    fileName: response.headers.get('x-sfg-bootstrap-file-name')
      ?? 'Sifangguan-Trusted-Device-Setup.cmd',
    expiresAt: response.headers.get('x-sfg-enrollment-expires-at'),
  }
}

export const downloadTrustedDeviceBootstrap = (
  context: HotelContext,
  label = '门店采集电脑',
): Promise<TrustedDeviceBootstrapDownload> =>
  downloadBootstrap(context, label)

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

export const approveTrustedDeviceScope = (
  context: HotelContext,
): Promise<TrustedDeviceView> => request(
  context,
  '/trusted-device/scope-approval',
  {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Idempotency-Key': requestId(),
    },
    body: JSON.stringify({
      reasonCode: 'APPROVE_TRUSTED_DEVICE_STORE_SCOPE',
    }),
  },
)
