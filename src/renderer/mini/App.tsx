import { useEffect, useRef, useState } from 'react'
import { useAutoSize } from './useAutoSize'
import { useMiniState } from './useMiniState'
import { BarVariant } from './variants/BarVariant'
import { CardVariant } from './variants/CardVariant'
import { PillVariant } from './variants/PillVariant'
import { CoverVariant } from './variants/CoverVariant'
import { NotchVariant } from './variants/NotchVariant'
import { SideVariant } from './variants/SideVariant'
import type { VariantProps } from './variants/shared'
import { isEdgeVariant, type MiniVariant } from '@shared/types'
import { useAppearance } from '../shared/useAppearance'

const VARIANTS: Record<MiniVariant, (props: VariantProps) => JSX.Element> = {
  bar: BarVariant,
  card: CardVariant,
  pill: PillVariant,
  cover: CoverVariant,
  notch: NotchVariant,
  side: SideVariant
}

/** Сколько ждать после ухода курсора, прежде чем свернуть шторку и язычок. */
const LEAVE_MS = 240

/**
 * Флаг, который включается и выключается с задержкой. Нулевая задержка —
 * мгновенно, как было у плит до шторки.
 */
function useDelayedFlag(value: boolean, onMs: number, offMs: number): boolean {
  const [flag, setFlag] = useState(value)
  useEffect(() => {
    if (value === flag) return
    const wait = value ? onMs : offMs
    if (wait <= 0) {
      setFlag(value)
      return
    }
    const timer = window.setTimeout(() => setFlag(value), wait)
    return () => window.clearTimeout(timer)
  }, [value, flag, onMs, offMs])
  return flag
}

/**
 * Host for the four mini-player designs. It owns the expanded/idle state and
 * the hover behaviour; each variant only decides how it looks in either state.
 */
export function App(): JSX.Element {
  const { player, settings } = useMiniState()
  /*
   * Цвет с обложки приходит из окна приложения — считать его здесь нечем:
   * у плиты та же картинка, но тянуть её второй раз ради нескольких пикселей
   * незачем, а в свёрнутом виде обложки может не быть вовсе.
   */
  const [liveAccent, setLiveAccent] = useState<string | null>(null)
  useEffect(() => window.mini.onAccent(setLiveAccent), [])
  useAppearance(settings, settings.accentFromCover ? liveAccent : null)
  const ref = useRef<HTMLDivElement>(null)
  /**
   * Authoritative hover, measured against the cursor position by the main
   * process. The plate is one big drag region so it can be moved from anywhere,
   * and Windows delivers no mouse events over drag regions — DOM `mouseenter`
   * alone only ever fired over the buttons.
   */
  const [hovered, setHovered] = useState(false)
  const [pinned, setPinned] = useState(false)

  useAutoSize(ref)

  useEffect(() => window.mini.onHover(setHovered), [])

  // Switching variants resets the sticky expansion, otherwise a variant with no
  // expanded state would stay latched.
  useEffect(() => setPinned(false), [settings.miniVariant])

  // Pinning it in place is a window-level setting, but the plate must also stop
  // advertising itself as a drag region or the cursor still invites a drag.
  const edge = isEdgeVariant(settings.miniVariant)
  useEffect(() => {
    // Шторку и язычок двигает край экрана, а не рука.
    document.body.classList.toggle('mini--locked', !settings.miniDraggable || edge)
  }, [settings.miniDraggable, edge])

  /*
   * У шторки и язычка раскрытие ждёт: полоска у края попадается под курсор,
   * идущий к заголовку окна или в угол экрана, и раскрываться от каждого такого
   * прохода значило бы мешать. Уход тоже ждёт — меньше: пути от полоски до
   * кнопки внутри хватает, чтобы курсор на мгновение вышел за край.
   */
  const hoverOpen = useDelayedFlag(
    settings.miniExpandOnHover && hovered,
    edge ? settings.notchDelay : 0,
    edge ? LEAVE_MS : 0
  )
  const expanded = pinned || hoverOpen

  // Плита — это и есть окно: ловит мышь целиком, наведение по всему окну.
  useEffect(() => {
    if (!edge) window.mini.edge(null)
  }, [edge])
  const Variant = VARIANTS[settings.miniVariant] ?? BarVariant

  /**
   * Двойной щелчок по плите. Проверено настоящим системным щелчком: Windows
   * глотает по drag-поверхности движения мыши, но не щелчки, — поэтому здесь
   * можно обойтись обычным обработчиком, без своего перетаскивания.
   */
  const onDoubleClick = (): void => {
    if (settings.miniDoubleClick === 'openPlayer') window.mini.openPlayer()
    else if (settings.miniDoubleClick === 'expand') setPinned((value) => !value)
  }

  return (
    <div ref={ref} className="mini" style={{ opacity: hovered ? 1 : settings.miniIdleOpacity }}>
      <Variant
        player={player}
        settings={settings}
        onEdge={edge ? window.mini.edge : undefined}
        expanded={expanded}
        onToggleExpand={onDoubleClick}
        onCommand={(command) => window.mini.command(command)}
        onClose={() => window.mini.close()}
        onRestore={() => window.mini.restoreMain()}
      />
    </div>
  )
}
