import type { AuthSession } from '../auth/session'

const API_BASE_URL = (import.meta.env.VITE_OTA_API_BASE_URL ?? '/api/v1').replace(/\/$/, '')

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
  }
}

async function readError(response: Response, action: 'login' | 'session'): Promise<string> {
  if (response.status === 401) {
    return action === 'login' ? '账号或密码不正确' : '会话已失效，请重新登录'
  }
  if (response.status === 429) return '尝试次数过多，请稍后再试'
  if (response.status === 403) return '请求已被安全策略拒绝'
  return '服务暂时不可用'
}

function readCsrfCookie(): string | undefined {
  const match = document.cookie
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith('ota_csrf='))
  return match ? decodeURIComponent(match.slice('ota_csrf='.length)) : undefined
}

export function hasRefreshContext(): boolean {
  return readCsrfCookie() !== undefined
}

export async function login(username: string, password: string): Promise<AuthSession> {
  const response = await fetch(`${API_BASE_URL}/auth/login`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  })

  if (!response.ok) {
    throw new ApiError(await readError(response, 'login'), response.status)
  }
  return (await response.json()) as AuthSession
}

let refreshInFlight: Promise<AuthSession> | null = null

async function performRefresh(): Promise<AuthSession> {
  const csrfToken = readCsrfCookie()
  if (!csrfToken) {
    throw new ApiError('会话已失效，请重新登录', 401)
  }
  const response = await fetch(`${API_BASE_URL}/auth/refresh`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'X-CSRF-TOKEN': csrfToken },
  })
  if (!response.ok) {
    throw new ApiError(await readError(response, 'session'), response.status)
  }
  return (await response.json()) as AuthSession
}

export function refreshSession(): Promise<AuthSession> {
  if (!refreshInFlight) {
    refreshInFlight = performRefresh().finally(() => {
      refreshInFlight = null
    })
  }
  return refreshInFlight
}

export async function logout(): Promise<void> {
  const csrfToken = readCsrfCookie()
  const response = await fetch(`${API_BASE_URL}/auth/logout`, {
    method: 'POST',
    credentials: 'include',
    headers: {
      ...(csrfToken ? { 'X-CSRF-TOKEN': csrfToken } : {}),
    },
  })
  if (!response.ok) {
    throw new ApiError(await readError(response, 'session'), response.status)
  }
}

export interface CredentialChangeInput {
  currentPassword: string
  newUsername: string
  newPassword: string
}

async function readCredentialError(response: Response): Promise<string> {
  if (response.status === 401) {
    return '会话已失效，请重新登录'
  }
  let code = ''
  try {
    code = String(((await response.json()) as { code?: string }).code ?? '')
  } catch {
    return '账号密码修改失败，请稍后重试'
  }
  if (code === 'REVIEW_AUTH_CURRENT_PASSWORD_INVALID') {
    return '当前密码不正确'
  }
  if (code === 'REVIEW_AUTH_USERNAME_INVALID') {
    return '账号需为 3–64 位，可使用中英文、数字及 . _ @ -'
  }
  if (code === 'REVIEW_AUTH_PASSWORD_WEAK') {
    return '新密码需为 10–128 位，并至少包含三类字符'
  }
  if (code === 'REVIEW_AUTH_CREDENTIALS_UNCHANGED') {
    return '新账号和新密码不能与当前设置完全相同'
  }
  return '账号密码修改失败，请稍后重试'
}

export async function changeCredentials(
  session: AuthSession,
  input: CredentialChangeInput,
): Promise<AuthSession> {
  const response = await fetch(`${API_BASE_URL}/auth/credentials`, {
    method: 'POST',
    credentials: 'include',
    headers: {
      Authorization: `Bearer ${session.accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(input),
  })
  if (!response.ok) {
    throw new ApiError(
      await readCredentialError(response),
      response.status,
    )
  }
  return (await response.json()) as AuthSession
}
