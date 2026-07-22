import { useCallback, useEffect, useState } from 'react'
import type { ApiSource } from './domain'

type Loaded<T> = { data: T; source: ApiSource }

export function useResource<T>(key: string, loader: () => Promise<Loaded<T>>, initial: T, refreshMs = 0) {
  const [data, setData] = useState<T>(initial)
  const [source, setSource] = useState<ApiSource>('api')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string>()

  const load = useCallback(async (silent: boolean) => {
    if (!silent) {
      setLoading(true)
      setError(undefined)
    }
    try {
      const loaded = await loader()
      setData(loaded.data)
      setSource(loaded.source)
      setError(undefined)
    } catch (reason) {
      if (!silent) {
        setData(initial)
        setSource('api')
        setError(reason instanceof Error ? reason.message : '数据加载失败')
      }
    } finally {
      if (!silent) setLoading(false)
    }
  // key deliberately represents every loader dependency.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  const reload = useCallback(() => load(false), [load])
  useEffect(() => { void reload() }, [reload])
  useEffect(() => {
    if (refreshMs <= 0) return
    const timer = window.setInterval(() => {
      if (!document.hidden) void load(true)
    }, refreshMs)
    return () => window.clearInterval(timer)
  }, [load, refreshMs])
  return { data, source, loading, error, reload, setData }
}
