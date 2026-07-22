import { useCallback, useEffect, useRef, useState } from 'react'

export type ScopedResourceState<T> = {
  data: T
  loading: boolean
  error?: unknown
  stale: boolean
  lastUpdatedAt?: string
}

export function useScopedResource<T>(
  key: string,
  loader: (signal: AbortSignal) => Promise<T>,
  initial: T,
  refreshMs = 0,
) {
  const loaderRef = useRef(loader)
  const initialRef = useRef(initial)
  const generationRef = useRef(0)
  const controllerRef = useRef<AbortController | undefined>(undefined)
  loaderRef.current = loader
  initialRef.current = initial

  const [state, setState] = useState<ScopedResourceState<T>>({ data: initial, loading: true, stale: false })

  const load = useCallback(async (silent = false) => {
    const generation = generationRef.current + 1
    generationRef.current = generation
    controllerRef.current?.abort()
    const controller = new AbortController()
    controllerRef.current = controller

    if (!silent) setState({ data: initialRef.current, loading: true, stale: false })
    try {
      const data = await loaderRef.current(controller.signal)
      if (controller.signal.aborted || generation !== generationRef.current) return
      setState({ data, loading: false, stale: false, lastUpdatedAt: new Date().toISOString() })
    } catch (error) {
      if (controller.signal.aborted || generation !== generationRef.current) return
      if (silent) setState((current) => ({ ...current, loading: false, error, stale: true }))
      else setState({ data: initialRef.current, loading: false, error, stale: false })
    }
  }, [key])

  useEffect(() => {
    void load(false)
    return () => {
      generationRef.current += 1
      controllerRef.current?.abort()
    }
  }, [load])

  useEffect(() => {
    if (refreshMs <= 0) return
    const timer = window.setInterval(() => {
      if (!document.hidden) void load(true)
    }, refreshMs)
    return () => window.clearInterval(timer)
  }, [load, refreshMs])

  const setData = useCallback((next: T | ((current: T) => T)) => {
    setState((current) => ({
      ...current,
      data: typeof next === 'function' ? (next as (value: T) => T)(current.data) : next,
    }))
  }, [])

  return { ...state, reload: () => load(false), setData }
}
