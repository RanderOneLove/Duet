import { useEffect, useState } from 'react'
import type { PlayerState } from '@shared/player'

/**
 * The main process samples position four times a second; interpolating between
 * samples keeps the progress bar smooth without flooding IPC.
 *
 * Two things it deliberately does not do: run while the track is paused or
 * still loading, and run away from the last sample. A stalled stream keeps the
 * media element "unpaused" while its clock stands still, and unbounded
 * interpolation would show a bar marching along a track that is silent.
 */
const MAX_DRIFT_MS = 1200

export function useSmoothPosition(state: PlayerState): number {
  const [position, setPosition] = useState(state.positionMs)

  useEffect(() => {
    setPosition(state.positionMs)
    if (!state.playing || state.loading || state.durationMs <= 0) return

    const started = performance.now()
    let frame = 0
    const tick = (): void => {
      const elapsed = Math.min(performance.now() - started, MAX_DRIFT_MS)
      setPosition(Math.min(state.durationMs, state.positionMs + elapsed))
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [state.positionMs, state.playing, state.loading, state.durationMs, state.index])

  return position
}
