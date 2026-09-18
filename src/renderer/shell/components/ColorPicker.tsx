import { useEffect, useRef, useState } from 'react'
import { hsvToRgb, parseHex, rgbToHsv, toHex } from '../../shared/accent'

interface Props {
  value: string
  onChange: (hex: string) => void
  onReset: () => void
}

/**
 * Выбор своего цвета: поле насыщенности и яркости, полоса тона, поле ввода.
 *
 * Системный `<input type="color">` открывает диалог операционной системы —
 * чужое окно поверх приложения, со своей типографикой и своим языком. Здесь
 * это часть интерфейса: цвет меняется под пальцем, и видно, что получается.
 */
export function ColorPicker({ value, onChange, onReset }: Props): JSX.Element {
  const rgb = parseHex(value) ?? { r: 10, g: 132, b: 255 }
  const hsv = rgbToHsv(rgb)

  const [hue, setHue] = useState(hsv.h)
  const [text, setText] = useState(value)
  const field = useRef<HTMLDivElement>(null)

  // Цвет могли сменить снаружи — палитрой или обложкой.
  useEffect(() => {
    setText(value)
    const next = parseHex(value)
    if (next) setHue(rgbToHsv(next).h)
  }, [value])

  const pick = (event: PointerEvent | React.PointerEvent): void => {
    const box = field.current?.getBoundingClientRect()
    if (!box) return
    const x = Math.min(1, Math.max(0, (event.clientX - box.left) / box.width))
    const y = Math.min(1, Math.max(0, (event.clientY - box.top) / box.height))
    onChange(toHex(hsvToRgb(hue, x, 1 - y)))
  }

  const onDown = (event: React.PointerEvent<HTMLDivElement>): void => {
    // Захват указателя: цвет тянется и когда курсор ушёл за края поля.
    event.currentTarget.setPointerCapture(event.pointerId)
    pick(event)
  }

  return (
    <div className="picker">
      <div
        ref={field}
        className="picker__field"
        style={{ backgroundColor: toHex(hsvToRgb(hue, 1, 1)) }}
        onPointerDown={onDown}
        onPointerMove={(event) => {
          if (event.buttons === 1) pick(event)
        }}
      >
        <span
          className="picker__dot"
          style={{ left: `${hsv.s * 100}%`, top: `${(1 - hsv.v) * 100}%` }}
        />
      </div>

      <input
        className="picker__hue"
        type="range"
        min={0}
        max={359}
        value={Math.round(hue)}
        aria-label="Тон"
        onChange={(event) => {
          const next = Number(event.target.value)
          setHue(next)
          onChange(toHex(hsvToRgb(next, Math.max(hsv.s, 0.15), Math.max(hsv.v, 0.35))))
        }}
      />

      <div className="picker__row">
        <span className="picker__swatch" style={{ background: value }} />
        <input
          className="input picker__hex"
          value={text}
          spellCheck={false}
          aria-label="Цвет в виде #rrggbb"
          onChange={(event) => {
            setText(event.target.value)
            const parsed = parseHex(event.target.value)
            if (parsed) onChange(toHex(parsed))
          }}
        />
        <button className="gbtn" onClick={onReset}>
          Сбросить
        </button>
      </div>
    </div>
  )
}
