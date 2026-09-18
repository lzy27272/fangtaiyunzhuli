// Read-only directory adapter. Persist only member account IDs and names, never
// tokens, raw responses, department data or other personal/contact fields.
const prefix = 'WECOM_DIRECTORY_READ_'
const fail = (code) => { throw new Error(`${prefix}${code}`) }
const account = (v) => typeof v === 'string' && /^[^\s\x00-\x1f\x7f]{1,128}$/u.test(v)
const timestamp = (v) => typeof v === 'string' && Number.isFinite(Date.parse(v)) ? v : null
const codes = ['CONFIG_INVALID', 'CORP_MISMATCH', 'NOT_CONFIGURED', 'BUSY', 'CREDENTIAL_INVALID',
  'IP_FORBIDDEN', 'SCOPE_FORBIDDEN', 'RATE_LIMITED', 'UNAVAILABLE', 'RESPONSE_INVALID', 'LIMIT_EXCEEDED']
export const directoryReadErrorCode = (error) => codes.map((c) => `${prefix}${c}`).includes(error?.message)
  ? error.message : `${prefix}UNAVAILABLE`

export function normalizeDirectoryRead(value) {
  if (value == null) return null
  if (typeof value !== 'object' || typeof value.enabled !== 'boolean'
    || !/^[A-Za-z0-9_-]{3,128}$/u.test(value.corpId ?? '')
    || typeof value.appSecret !== 'string' || !/^[A-Za-z0-9_-]{16,256}$/u.test(value.appSecret)
    || !Array.isArray(value.members ?? []) || (value.members ?? []).length > 10000) fail('CONFIG_INVALID')
  const members = new Map()
  for (const row of value.members ?? []) {
    if (!account(row?.userId) || typeof row.name !== 'string' || !row.name.trim()
      || row.name.length > 128 || /[\x00-\x1f\x7f\u202a-\u202e\u2066-\u2069]/u.test(row.name)) fail('RESPONSE_INVALID')
    const name = row.name.trim()
    if (members.has(row.userId) && members.get(row.userId) !== name) fail('RESPONSE_INVALID')
    members.set(row.userId, name)
  }
  return { enabled: value.enabled, corpId: value.corpId, appSecret: value.appSecret,
    members: [...members].map(([userId, name]) => ({ userId, name })),
    lastSyncedAt: timestamp(value.lastSyncedAt), lastAttemptAt: timestamp(value.lastAttemptAt),
    lastErrorCode: value.lastErrorCode ? directoryReadErrorCode({ message: value.lastErrorCode }) : null }
}

export const directoryReadView = (value) => ({
  configured: Boolean(value), enabled: value?.enabled === true, corpId: value?.corpId ?? '',
  memberCount: value?.members.length ?? 0, lastSyncedAt: value?.lastSyncedAt ?? null,
  lastAttemptAt: value?.lastAttemptAt ?? null, lastErrorCode: value?.lastErrorCode ?? null,
})

export function directoryReadDue(value, now = Date.now()) {
  return Boolean(value?.enabled && (!value.lastAttemptAt
    || now - Date.parse(value.lastAttemptAt) >= (value.lastErrorCode ? 60 : 360) * 60_000))
}

export async function readDirectoryNames(config, { fetchImpl = fetch, timeoutMs = 55_000 } = {}) {
  const normalized = normalizeDirectoryRead(config)
  if (!normalized?.enabled) fail('NOT_CONFIGURED')
  const deadline = AbortSignal.timeout(timeoutMs)
  async function request(path, params) {
    const url = new URL(`https://qyapi.weixin.qq.com/cgi-bin/${path}`)
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, String(value))
    try {
      const response = await fetchImpl(url, { method: 'GET', redirect: 'error',
        signal: AbortSignal.any([deadline, AbortSignal.timeout(10_000)]) })
      if (!response.ok) fail('UNAVAILABLE')
      const reader = response.body.getReader()
      const chunks = []
      let bytes = 0
      try {
        for (;;) {
          const { value, done } = await reader.read()
          if (done) break
          bytes += value.length
          if (bytes > 2 * 1024 * 1024) { await reader.cancel(); fail('LIMIT_EXCEEDED') }
          chunks.push(Buffer.from(value))
        }
      } finally { reader.releaseLock() }
      let body
      try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')) } catch { fail('RESPONSE_INVALID') }
      if (body?.errcode !== 0) {
        if ([40001, 40013, 40014, 40125, 42001].includes(body?.errcode)) fail('CREDENTIAL_INVALID')
        if ([60020].includes(body?.errcode)) fail('IP_FORBIDDEN')
        if ([48002, 48009, 50001, 60011].includes(body?.errcode)) fail('SCOPE_FORBIDDEN')
        if ([45009, 45011].includes(body?.errcode)) fail('RATE_LIMITED')
        fail('UNAVAILABLE')
      }
      return body
    } catch (error) { throw new Error(directoryReadErrorCode(error)) }
  }
  const token = await request('gettoken', { corpid: normalized.corpId, corpsecret: normalized.appSecret })
  if (typeof token.access_token !== 'string' || !token.access_token || token.access_token.length > 4096) fail('RESPONSE_INVALID')
  const auth = { access_token: token.access_token }
  const departments = await request('department/simplelist', auth)
  if (!Array.isArray(departments.department_id)) fail('RESPONSE_INVALID')
  if (departments.department_id.length > 500) fail('LIMIT_EXCEEDED')
  const ids = [...new Set(departments.department_id.map((d) => d?.id))]
  if (ids.some((id) => !Number.isSafeInteger(id) || id <= 0)) fail('RESPONSE_INVALID')
  if (!ids.length) fail('SCOPE_FORBIDDEN')
  const members = new Map()
  // Current official contract requires separate requests for each department;
  // fetch_child is not supported. Partial results must never replace the cache.
  for (const id of ids) {
    const result = await request('user/simplelist', { ...auth, department_id: id })
    if (!Array.isArray(result.userlist) || result.userlist.length > 10000) fail('RESPONSE_INVALID')
    for (const row of result.userlist) {
      if (!account(row?.userid) || typeof row.name !== 'string') fail('RESPONSE_INVALID')
      if (!row.name.trim() || row.name === row.userid) continue // redacted name, not a nickname
      if (members.has(row.userid) && members.get(row.userid) !== row.name.trim()) fail('RESPONSE_INVALID')
      members.set(row.userid, row.name.trim())
      if (members.size > 10000) fail('LIMIT_EXCEEDED')
    }
  }
  return normalizeDirectoryRead({ ...normalized,
    members: [...members].map(([userId, name]) => ({ userId, name })) }).members
}
