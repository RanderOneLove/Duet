import { useEffect, useRef, useState } from 'react'
import { useAutoSize } from './useAutoSize'
import { useMiniState } from './useMiniState'
import { BarVariant } from './variants/BarVariant'
import { CardVariant } from './variants/CardVariant'
import { PillVariant } from './variants/PillVariant'
import { CoverVariant } from './variants/CoverVariant'
import type { VariantProps } from './variants/shared'
import type { MiniVariant } from '@shared/types'

const VARIANTS: Record<MiniVariant, (props: VariantProps) => JSX.Element> = {
  bar: BarVariant,
  card: CardVariant,
  pill: PillVariant,
  cover: CoverVariant
}

/**
 * Host for the four mini-player designs. It owns the expanded/idle state and
 * the hover behaviour; each variant only decides how it looks in either state.
 */
export function App(): JSX.Element {
  const { player, settings } = useMiniState()
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
  useEffect(() => {
    document.body.classList.toggle('mini--locked', !settings.miniDraggable)
  }, [settings.miniDraggable])

  const expanded = pinned || (settings.miniExpandOnHover && hovered)
  const Variant = VARIANTS[settings.miniVariant] ?? BarVariant

  return (
    <div ref={ref} className="mini" style={{ opacity: hovered ? 1 : settings.miniIdleOpacity }}>
      <Variant
        player={player}
        expanded={expanded}
        onToggleExpand={() => setPinned((value) => !value)}
        onCommand={(command) => window.mini.command(command)}
        onClose={() => window.mini.close()}
        onRestore={() => window.mini.restoreMain()}
      />
    </div>
  )
}
