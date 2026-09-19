import { useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

interface Props {
  /** What sits in the bar; the panel hangs off it. */
  icon: ReactNode
  /**
   * Подпись рядом со значком. С ней кнопка отвечает на свой вопрос, не
   * раскрываясь: видно устройство вывода и остаток таймера.
   */
  label?: string
  title: string
  /** Marks the button as doing something right now — a timer running, say. */
  active?: boolean
  /** The panel opens upwards in the bottom bar, downwards elsewhere. */
  align?: 'up' | 'down'
  /** Панель по умолчанию шириной со список; узкому содержимому нужен свой класс. */
  panelClass?: string
  /**
   * Рисовать панель вне своего места в разметке.
   *
   * Нужно там, где вокруг кнопки стоит подрезка: плита волны скругляет углы и
   * прячет вылезающее свечение, а заодно срезала бы и панель. Портал уносит её
   * в конец документа, где резать некому, а место она получает по кнопке.
   */
  portal?: boolean
  children: (close: () => void) => ReactNode
}

/**
 * An icon in the transport that opens a small panel. The app has no menus of
 * its own, and a bare `<select>` in a dark player looks like something the
 * operating system left behind — this is the shape the rest of the controls
 * already use: a round icon button, a surface panel, one click to dismiss.
 */
export function Popover({
  icon,
  label,
  title,
  active,
  align = 'up',
  panelClass,
  portal,
  children
}: Props): JSX.Element {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const floating = useRef<HTMLDivElement>(null)
  const [spot, setSpot] = useState<{ top: number; left: number } | null>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (event: MouseEvent): void => {
      const target = event.target as Node
      // Панель в портале лежит вне кнопки, и щелчок по ней иначе считался бы
      // щелчком мимо.
      if (root.current?.contains(target) || floating.current?.contains(target)) return
      setOpen(false)
    }
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOpen(false)
    }
    // Capture, so a click on a control inside another popover closes this one.
    document.addEventListener('mousedown', onDown, true)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown, true)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  /*
   * Место панели считается по кнопке в момент открытия: она стоит внутри
   * прокручиваемого экрана, и запоминать его заранее было бы враньём.
   */
  useEffect(() => {
    if (!open || !portal) return
    const button = root.current?.querySelector('button')
    if (!button) return
    const box = button.getBoundingClientRect()
    setSpot({ top: Math.round(box.bottom + 8), left: Math.round(box.left) })
  }, [open, portal])

  return (
    <div className="pop" ref={root}>
      <button
        className={
          label
            ? `gbtn gbtn--labelled ${active ? 'gbtn--on' : ''}`
            : `togglebtn ${active ? 'togglebtn--on' : ''}`
        }
        title={title}
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        {icon}
        {label && <span className="truncate pop__label">{label}</span>}
      </button>

      {open && !portal && (
        <div
          className={`pop__panel pop__panel--${align} ${panelClass ?? ''}`}
          role="dialog"
          aria-label={title}
        >
          {children(() => setOpen(false))}
        </div>
      )}

      {open &&
        portal &&
        spot &&
        createPortal(
          <div
            ref={floating}
            className={`pop__panel pop__panel--floating ${panelClass ?? ''}`}
            style={{ top: spot.top, left: spot.left }}
            role="dialog"
            aria-label={title}
          >
            {children(() => setOpen(false))}
          </div>,
          document.body
        )}
    </div>
  )
}
