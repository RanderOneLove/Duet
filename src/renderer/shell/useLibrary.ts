import { useCallback, useEffect, useState } from 'react'

export interface Async<T> {
  data: T
  loading: boolean
  error: string | null
  reload: () => void
}

/**
 * Run a catalogue query and track its loading and error states, so every screen
 * can show the wireframe's loading / empty / error states (artboard 2m) without
 * repeating the plumbing.
 */
export function useAsync<T>(load: () => Promise<T>, initial: T, deps: unknown[]): Async<T> {
  const [data, setData] = useState<T>(initial)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [nonce, setNonce] = useState(0)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    load()
      .then((result) => {
        if (!cancelled) setData(result)
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
    // `load` is recreated on every render by design; deps are the real inputs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, nonce])

  const reload = useCallback(() => setNonce((value) => value + 1), [])
  return { data, loading, error, reload }
}
