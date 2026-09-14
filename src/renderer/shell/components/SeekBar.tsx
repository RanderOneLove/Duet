import { useCallback, type PointerEvent } from 'react'

interface Props {
  ratio: number
  seekable: boolean
  className?: string
  onSeek: (ratio: number) => void
}

/**
 * A progress bar that also seeks. Dragging is handled with pointer capture so
 * the gesture keeps working once the cursor leaves the 4px-tall track.
 */
export function SeekBar({ ratio, seekable, className, onSeek }: Props): JSX.Element {
  const emit = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      const rect = event.currentTarget.getBoundingClientRect()
      if (rect.width <= 0) return
      onSeek(Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)))
    },
    [onSeek]
  )

  return (
    <div
      className={`bar ${seekable ? 'bar--seekable' : ''} ${className ?? ''}`}
      onPointerDown={(event) => {
        if (!seekable) return
        event.currentTarget.setPointerCapture(event.pointerId)
        emit(event)
      }}
      onPointerMove={(event) => {
        if (!seekable || !event.currentTarget.hasPointerCapture(event.pointerId)) return
        emit(event)
      }}
      onPointerUp={(event) => event.currentTarget.releasePointerCapture(event.pointerId)}
    >
      <i style={{ width: `${Math.round(ratio * 1000) / 10}%` }} />
    </div>
  )
}
