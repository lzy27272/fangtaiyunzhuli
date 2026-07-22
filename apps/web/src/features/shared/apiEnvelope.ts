export type PageEnvelope<T> = {
  items?: T[]
  content?: T[]
  data?: T[]
  totalElements?: number
  total?: number
}
export function requireItems<T>(payload: T[] | PageEnvelope<T>, endpoint: string): T[] {
  if (Array.isArray(payload)) return payload
  for (const candidate of [payload.items, payload.content, payload.data]) {
    if (Array.isArray(candidate)) return candidate
  }
  throw new Error(`${endpoint} 返回格式不兼容，未将其误判为空数据。`)
}

export function queryString(params: Record<string, string | undefined>): string {
  const query = new URLSearchParams()
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== '') query.set(key, value)
  })
  return query.size ? `?${query.toString()}` : ''
}
