import { MEITUAN_DATA_RECIPES, assertMeituanScope, normalizeMeituanBusiness } from './meituan-data-contract.mjs'

// Uses the provider's already-authenticated page. No cookie export, injected
// credentials, signature extraction, hidden login, or automatic 403 retries.
export const collectMeituanBusiness = async ({ frame, scope, period = 'LAST_7_DAYS', now = () => new Date() }) => {
  const range = { YESTERDAY: '1', LAST_7_DAYS: '7', LAST_30_DAYS: '30' }[period]
  if (!range) throw new Error('MEITUAN_DATA_PERIOD_REQUIRED')
  const recipe = MEITUAN_DATA_RECIPES.business
  const query = { ...assertMeituanScope(scope, scope), dateRange: range, dataScope: 'vpoi', deviceType: '1' }
  if (typeof scope.propertyName !== 'string' || scope.propertyName.trim().length < 2) throw new Error('MEITUAN_DATA_SCOPE_REQUIRED')
  const assertVisibleScope = async () => {
    const url = new URL(frame.url())
    if (url.origin !== recipe.origin || !url.pathname.startsWith('/newhb-sub-app/data-center-pc/')) {
      throw new Error('MEITUAN_DATA_PAGE_REQUIRED')
    }
    const content = await frame.locator('body').innerText()
    const compact = text => text.replace(/\s+/g, '').replace(/[()]/g, c => c === '(' ? '（' : '）')
    if (!compact(content).includes(compact(scope.propertyName))) throw new Error('MEITUAN_DATA_SCOPE_MISMATCH')
  }
  await assertVisibleScope()
  const response = await frame.evaluate(async ({ recipe, query }) => {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 15000)
    try {
      if (location.origin !== recipe.origin) return { httpStatus: null, issue: 'PAGE_CHANGED' }
      const url = new URL(recipe.path, recipe.origin)
      for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value)
      const response = await fetch(url.href, { method: 'GET', credentials: 'same-origin', redirect: 'error',
        headers: { Accept: 'application/json' }, signal: controller.signal })
      if (response.status !== 200) return { httpStatus: response.status }
      if (!/json/i.test(response.headers.get('content-type') ?? '')) return { httpStatus: 200, issue: 'NOT_JSON' }
      if (!response.body) return { httpStatus: 200, issue: 'EMPTY_RESPONSE' }
      const reader = response.body.getReader(), chunks = []
      let size = 0
      try {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          size += value.byteLength
          if (size > 1024 * 1024) { await reader.cancel(); return { httpStatus: 200, issue: 'TOO_LARGE' } }
          chunks.push(value)
        }
      } finally { reader.releaseLock() }
      const bytes = new Uint8Array(size)
      let offset = 0
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
      return { httpStatus: 200, root: JSON.parse(new TextDecoder().decode(bytes)) }
    } catch { return { httpStatus: null, issue: 'BROWSER_READ_FAILED' } }
    finally { clearTimeout(timer) }
  }, { recipe: { origin: recipe.origin, path: recipe.path }, query })
  if (response.httpStatus !== 200) throw new Error(Number.isInteger(response.httpStatus)
    ? `MEITUAN_DATA_HTTP_${response.httpStatus}` : 'MEITUAN_DATA_BROWSER_READ_FAILED')
  if (response.issue || !response.root) throw new Error('MEITUAN_DATA_RESPONSE_UNAVAILABLE')
  await assertVisibleScope()
  return normalizeMeituanBusiness(response.root, query, scope, { period, observedAt: now().toISOString() })
}
