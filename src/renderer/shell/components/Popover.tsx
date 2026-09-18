import { useEffect, useRef, useState, type ReactNode } from 'react'

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
  children
}: Props): JSX.Element {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (event: MouseEvent): void => {
      if (!root.current?.contains(event.target as Node)) setOpen(false)
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

      {open && (
        <div
          className={`pop__panel pop__panel--${align} ${panelClass ?? ''}`}
          role="dialog"
          aria-label={title}
        >
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  )
}
