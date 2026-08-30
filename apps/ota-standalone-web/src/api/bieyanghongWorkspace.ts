import { refreshSession } from './auth'
import type { HotelContext } from './business'
import { clearSession, getSession, setSession } from '../auth/session'

const API_BASE_URL = (
  import.meta.env.VITE_OTA_API_BASE_URL ?? '/api/v1'
).replace(/\/$/, '')

export interface BieyanghongWorkspaceView {
  challengeId: string
  hotelCode: '001'
  hotelName: string
  status: string
  createdAt: string
  expiresAt: string
  workspaceUrl: string
}

export interface BieyanghongWorkspaceAvailability {
  eligible: boolean
  ready: boolean
  hotelCode: string
  hotelName: string
  reasonCode: string | null
  workspaceTtlMinutes: number
}

const requestId = (): string =>
  globalThis.crypto?.randomUUID?.()
  ?? `web-${Date.now()}-${Math.random().toString(16).slice(2)}`

const scopedPath = (context: HotelContext): string => {
  const tenantId = encodeURIComponent(context.tenantId)
  const hotelId = encodeURIComponent(context.hotelId)
  return `/ota/tenants/${tenantId}/hotels/${hotelId}/bieyanghong-workspace`
}

const failureCode = async (response: Response): Promise<string> => {
  try {
    const body = await response.json() as { code?: string }
    return body.code ?? `请求失败（${response.status}）`
  } catch {
    return `请求失败（${response.status}）`
  }
}

const authorizedResponse = async (
  context: HotelContext,
  method: 'GET' | 'POST',
  allowRefresh: boolean,
): Promise<Response> => {
  const session = getSession()
  if (!session) throw new Error('会话已失效，请重新登录')
  const response = await fetch(`${API_BASE_URL}${scopedPath(context)}`, {
    method,
    credentials: 'include',
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${session.accessToken}`,
      'Idempotency-Key': requestId(),
      'X-Correlation-ID': requestId(),
    },
  })
  if (response.status === 401 && allowRefresh) {
    try {
      const refreshed = await refreshSession()
      setSession(refreshed)
      return authorizedResponse(context, method, false)
    } catch (cause) {
      clearSession()
      throw cause
    }
  }
  if (!response.ok) throw new Error(await failureCode(response))
  return response
}

const startRequest = async (
  context: HotelContext,
): Promise<BieyanghongWorkspaceView> => {
  const response = await authorizedResponse(context, 'POST', true)
  const body = await response.json() as { data?: BieyanghongWorkspaceView }
  const view = body.data
  if (
    !view
    || view.hotelCode !== '001'
    || typeof view.challengeId !== 'string'
    || typeof view.expiresAt !== 'string'
    || typeof view.workspaceUrl !== 'string'
  ) {
    throw new Error('BIEYANGHONG_WORKSPACE_RESPONSE_INVALID')
  }
  const workspace = new URL(view.workspaceUrl)
  if (
    workspace.protocol !== 'https:'
    || workspace.username
    || workspace.password
    || workspace.search
    || workspace.pathname !== '/api/v1/bieyanghong-repair/official'
    || !workspace.hash
  ) {
    throw new Error('BIEYANGHONG_WORKSPACE_URL_INVALID')
  }
  return view
}

export const startBieyanghongWorkspace = (
  context: HotelContext,
): Promise<BieyanghongWorkspaceView> => startRequest(context)

export const loadBieyanghongWorkspaceAvailability = async (
  context: HotelContext,
): Promise<BieyanghongWorkspaceAvailability> => {
  const response = await authorizedResponse(context, 'GET', true)
  const body = await response.json() as {
    data?: BieyanghongWorkspaceAvailability
  }
  const availability = body.data
  if (
    !availability
    || typeof availability.eligible !== 'boolean'
    || typeof availability.ready !== 'boolean'
    || typeof availability.hotelCode !== 'string'
    || typeof availability.hotelName !== 'string'
    || !Number.isInteger(availability.workspaceTtlMinutes)
  ) {
    throw new Error('BIEYANGHONG_WORKSPACE_AVAILABILITY_INVALID')
  }
  return availability
}
