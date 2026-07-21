import { useCallback, useEffect, useState } from 'react'
import type { ApiSource } from './domain'

type Loaded<T> = { data: T; source: ApiSource }

export function useResource<T>(key: string, loader: () => Promise<Loaded<T>>, initial: T) {
  const [data, setData] = useState<T>(initial)
  const [source, setSource] = useState<ApiSource>('api')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string>()

  const reload = useCallback(async () => {
    setLoading(true)
    setError(undefined)
    try {
      const loaded = await loader()
      setData(loaded.data)
      setSource(loaded.source)
    } catch (reason) {
      setData(initial)
      setSource('api')
      setError(reason instanceof Error ? reason.message : '数据加载失败')
    } finally {
      setLoading(false)
    }
  // key deliberately represents every loader dependency.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  useEffect(() => { void reload() }, [reload])
  return { data, source, loading, error, reload, setData }
}
