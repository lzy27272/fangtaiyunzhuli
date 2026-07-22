import { apiMutation, apiRequest, type ApiIdentity, type ApiMutationOptions } from '../../api/client'

const dangerousKeys = new Set(['__proto__', 'prototype', 'constructor'])

function camelKey(key: string): string {
  return key.replace(/_([a-z0-9])/g, (_, character: string) => character.toUpperCase())
}
export function camelizeKeysDeep<T>(value: unknown): T {
  if (Array.isArray(value)) return value.map((item) => camelizeKeysDeep(item)) as T
  if (!value || typeof value !== 'object') return value as T

  const source = value as Record<string, unknown>
  const result: Record<string, unknown> = {}
  const keys = Object.keys(source).filter((key) => !dangerousKeys.has(key))
  // Preserve an explicitly returned camelCase property when both spellings exist.
  keys.sort((left, right) => Number(left.includes('_')) - Number(right.includes('_')))
  keys.forEach((key) => {
    const normalized = camelKey(key)
    if (!Object.prototype.hasOwnProperty.call(result, normalized)) {
      result[normalized] = camelizeKeysDeep(source[key])
    }
  })
  return result as T
}

export async function featureApiRequest<T>(path: string, identity: ApiIdentity, init: RequestInit = {}): Promise<T> {
  return camelizeKeysDeep<T>(await apiRequest<unknown>(path, identity, init))
}

export async function featureApiMutation<T>(path: string, identity: ApiIdentity, options: ApiMutationOptions = {}): Promise<T> {
  return camelizeKeysDeep<T>(await apiMutation<unknown>(path, identity, options))
}
