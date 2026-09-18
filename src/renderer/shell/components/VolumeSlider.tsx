import { useCallback, type PointerEvent } from 'react'

interface Props {
  /** Доля от нуля до единицы. */
  value: number
  onChange: (value: number) => void
}

/**
 * Вертикальный ползунок громкости.
 *
 * Своя механика, а не общая полоса перемотки, поставленная на торец поворотом.
 * У повёрнутого элемента `getBoundingClientRect()` возвращает прямоугольник,
 * описанный вокруг него: для лежащей на боку полосы это четыре пикселя ширины.
 * Доля считалась от них — и громкость от одного нажатия улетала с края на край.
 * Здесь доля берётся по высоте и снизу вверх, потому что у громкости верх
 * означает «громче».
 */
export function VolumeSlider({ value, onChange }: Props): JSX.Element {
  const emit = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      const rect = event.currentTarget.getBoundingClientRect()
      if (rect.height <= 0) return
      onChange(Math.max(0, Math.min(1, (rect.bottom - event.clientY) / rect.height)))
    },
    [onChange]
  )

  return (
    <div
      className="vbar"
      role="slider"
      tabIndex={0}
      aria-label="Громкость"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(value * 100)}
      onPointerDown={(event) => {
        event.currentTarget.setPointerCapture(event.pointerId)
        emit(event)
      }}
      onPointerMove={(event) => {
        if (!event.currentTarget.hasPointerCapture(event.pointerId)) return
        emit(event)
      }}
      onPointerUp={(event) => event.currentTarget.releasePointerCapture(event.pointerId)}
      onKeyDown={(event) => {
        const step = event.shiftKey ? 0.01 : 0.05
        if (event.key === 'ArrowUp') onChange(Math.min(1, value + step))
        else if (event.key === 'ArrowDown') onChange(Math.max(0, value - step))
        else return
        event.preventDefault()
      }}
    >
      <i style={{ height: `${Math.round(value * 1000) / 10}%` }} />
    </div>
  )
}
