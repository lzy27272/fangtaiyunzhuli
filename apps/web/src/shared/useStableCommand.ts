import { useCallback, useRef, useState } from 'react'
import { createIdempotencyKey } from '../api/client'

export function useStableCommand(prefix: string) {
  const keyRef = useRef(createIdempotencyKey(prefix))
  const runningRef = useRef(false)
  const [busy, setBusy] = useState(false)

  const reset = useCallback(() => {
    keyRef.current = createIdempotencyKey(prefix)
  }, [prefix])

  const run = useCallback(async <T,>(command: (idempotencyKey: string) => Promise<T>): Promise<T | undefined> => {
    if (runningRef.current) return undefined
    runningRef.current = true
    setBusy(true)
    try {
      const result = await command(keyRef.current)
      reset()
      return result
    } finally {
      runningRef.current = false
      setBusy(false)
    }
  }, [reset])

  return { busy, run, reset, currentKey: () => keyRef.current }
}
