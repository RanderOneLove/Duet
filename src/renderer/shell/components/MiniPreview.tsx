import { useEffect, useRef, useState } from 'react'
import type { MiniVariant } from '@shared/types'
import type { PlayerState } from '@shared/player'
import { BarVariant } from '../../mini/variants/BarVariant'
import { CardVariant } from '../../mini/variants/CardVariant'
import { CoverVariant } from '../../mini/variants/CoverVariant'
import { PillVariant } from '../../mini/variants/PillVariant'
import type { VariantProps } from '../../mini/variants/shared'
import '../../mini/mini.css'

const VARIANTS: Record<MiniVariant, (props: VariantProps) => JSX.Element> = {
  bar: BarVariant,
  card: CardVariant,
  pill: PillVariant,
  cover: CoverVariant
}

/** Width each variant renders at, used to scale it into the settings card. */
const NATURAL_WIDTH: Record<MiniVariant, number> = { bar: 384, card: 272, pill: 330, cover: 264 }

/**
 * Ширину превью задаёт не число, а место в плашке.
 *
 * Раньше здесь стояло 200 пикселей, и стоило плашкам стать уже — превью
 * вылезало за их края. Высота при этом не менялась вовсе: уменьшение сделано
 * трансформацией, а она не трогает раскладку, и под уменьшенной картинкой
 * оставалась пустота на всю её настоящую высоту.
 */

/**
 * The settings screen previews a variant by rendering the very same component
 * the mini player uses, on the live player state — so what is shown cannot
 * drift from what the window actually looks like.
 */
export function MiniPreview({ variant, player }: { variant: MiniVariant; player: PlayerState }): JSX.Element {
  const Variant = VARIANTS[variant]
  const box = useRef<HTMLDivElement>(null)
  const inner = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ width: 0, height: 0 })

  useEffect(() => {
    const outer = box.current
    const child = inner.current
    if (!outer || !child) return

    const measure = (): void => {
      const width = outer.clientWidth
      const natural = child.offsetHeight
      if (width > 0 && natural > 0) {
        setSize({ width, height: Math.round(natural * (width / NATURAL_WIDTH[variant])) })
      }
    }

    measure()
    // Ширина зависит от окна, высота — от того, что нарисовал вариант; обе
    // меняются без нашего ведома, поэтому смотрим за обеими.
    const watcher = new ResizeObserver(measure)
    watcher.observe(outer)
    watcher.observe(child)
    return () => watcher.disconnect()
  }, [variant])

  const scale = size.width > 0 ? size.width / NATURAL_WIDTH[variant] : 0

  return (
    <div className="minipreview" ref={box} style={{ height: size.height || undefined }}>
      <div
        className="minipreview__scale"
        ref={inner}
        style={{ transform: scale ? `scale(${scale})` : undefined }}
      >
        <Variant player={player} expanded onToggleExpand={noop} onCommand={noop} onClose={noop} onRestore={noop} />
      </div>
    </div>
  )
}

/** The preview is a picture, not a control — every callback is inert. */
function noop(): void {}
