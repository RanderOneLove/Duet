import { useCallback, type PointerEvent } from 'react'

interface Props {
  /** Доля от нуля до единицы. */
  value: number
  onChange: (value: number) => void
  /**
   * Лёжа — когда в ряду есть место и ползунок стоит прямо в плите; стоя — когда
   * он живёт во всплывающей панели над кнопкой.
   */
  horizontal?: boolean
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
export function VolumeSlider({ value, onChange, horizontal }: Props): JSX.Element {
  const emit = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      const rect = event.currentTarget.getBoundingClientRect()
      if (horizontal) {
        if (rect.width <= 0) return
        onChange(Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)))
        return
      }
      if (rect.height <= 0) return
      onChange(Math.max(0, Math.min(1, (rect.bottom - event.clientY) / rect.height)))
    },
    [onChange, horizontal]
  )

  return (
    <div
      className={horizontal ? 'vbar vbar--wide' : 'vbar'}
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
        // Лёжа громче — вправо, стоя — вверх: стрелки должны совпадать с тем,
        // куда на самом деле едет заливка.
        const up = horizontal ? 'ArrowRight' : 'ArrowUp'
        const down = horizontal ? 'ArrowLeft' : 'ArrowDown'
        if (event.key === up) onChange(Math.min(1, value + step))
        else if (event.key === down) onChange(Math.max(0, value - step))
        else return
        event.preventDefault()
      }}
    >
      <i
        style={
          horizontal
            ? { width: `${Math.round(value * 1000) / 10}%` }
            : { height: `${Math.round(value * 1000) / 10}%` }
        }
      />
    </div>
  )
}
