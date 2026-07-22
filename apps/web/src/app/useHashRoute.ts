import { useCallback, useEffect, useState } from 'react'
import { buildHashRoute, parseHashRoute, type AppNavigate } from './routeConfig'

export function useHashRoute() {
  const read = useCallback(() => parseHashRoute(window.location.hash), [])
  const [route, setRoute] = useState(read)

  useEffect(() => {
    const listener = () => setRoute(read())
    window.addEventListener('hashchange', listener)
    return () => window.removeEventListener('hashchange', listener)
  }, [read])

  const navigate: AppNavigate = useCallback((next, params = {}) => {
    const nextHash = buildHashRoute(next, params)
    if (window.location.hash === `#${nextHash}`) setRoute(read())
    else window.location.hash = nextHash
  }, [read])

  return [route, navigate] as const
}
