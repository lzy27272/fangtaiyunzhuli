const WECOM_ENTRY_PATH = '/wecom-auth'
const UNSAFE_CREDENTIAL_PARAMS = ['access_token', 'token', 'jwt', 'secret', 'corpsecret', 'corp_secret', 'wecom_secret'] as const
const CODE_PATTERN = /^[A-Za-z0-9._~-]{16,512}$/
const TASK_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export type WecomTaskEntry = {
  code?: string
  securityError?: string
}

let consumed = false
let cachedEntry: WecomTaskEntry | undefined

/**
 * Reads a WeCom callback exactly once and removes credentials from the address bar
 * before React performs the exchange request. Both history and storage stay free of
 * the one-time code.
 */
export function consumeWecomTaskEntry(location: Location = window.location): WecomTaskEntry | undefined {
  if (consumed) return cachedEntry
  consumed = true

  const url = new URL(location.href)
  const cleanPath = url.pathname.replace(/\/$/, '')
  const fromPath = cleanPath === WECOM_ENTRY_PATH
  if (!fromPath) return undefined

  const params = url.searchParams
  const code = params.get('exchange_code')?.trim() || undefined
  const unsafeParam = UNSAFE_CREDENTIAL_PARAMS.find((key) => params.has(key))

  window.history.replaceState(null, '', `${url.pathname}${url.hash}`)

  if (unsafeParam) {
    cachedEntry = { securityError: '链接包含禁止出现在地址栏中的敏感凭据，系统已拒绝使用并清除。请从企微重新打开任务。' }
  } else if (!code || !CODE_PATTERN.test(code)) {
    cachedEntry = { securityError: '企微一次性登录凭证缺失或格式无效。凭证可能已过期，请返回企微重新打开任务。' }
  } else {
    cachedEntry = { code }
  }
  return cachedEntry
}

export function buildTaskDeepLink(taskId: string): string {
  if (!TASK_ID_PATTERN.test(taskId)) throw new Error('无效的任务编号。')
  const query = new URLSearchParams({ view: 'mine', taskId })
  return `#/tasks?${query.toString()}`
}

export function buildAppHashLocation(hashRoute: string, baseUrl: string): string {
  const safeBase = baseUrl.startsWith('/') && !baseUrl.startsWith('//') && !/[\\\u0000-\u001f\u007f]/.test(baseUrl)
    ? baseUrl
    : '/'
  const normalizedBase = safeBase.endsWith('/') ? safeBase : `${safeBase}/`
  const normalizedHash = hashRoute.startsWith('#/') ? hashRoute : `#/${hashRoute.replace(/^#?\/?/, '')}`
  return `${normalizedBase}${normalizedHash}`
}

export function safeTaskDeepLink(returnTo: string | undefined): string {
  if (!returnTo) {
    throw new Error('服务端未返回本次企微登录绑定的任务地址。')
  }
  if (/[\\\u0000-\u001f\u007f]/.test(returnTo) || returnTo.includes('://') || returnTo.startsWith('//')) {
    throw new Error('服务端返回了不安全的任务地址，系统已拒绝跳转。')
  }

  const normalized = returnTo.startsWith('#/') ? returnTo.slice(1) : returnTo
  const target = new URL(normalized, window.location.origin)
  if (target.origin !== window.location.origin || target.pathname !== '/tasks') {
    throw new Error('企微登录目标不是中台任务页面，系统已拒绝跳转。')
  }
  const taskId = target.searchParams.get('taskId')?.trim()
  if (!taskId || !TASK_ID_PATTERN.test(taskId)) {
    throw new Error('企微登录目标缺少有效的任务编号，系统已拒绝跳转。')
  }
  return buildTaskDeepLink(taskId)
}
