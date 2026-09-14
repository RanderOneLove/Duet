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

const PREVIEW_WIDTH = 200

/**
 * The settings screen previews a variant by rendering the very same component
 * the mini player uses, on the live player state — so what is shown cannot
 * drift from what the window actually looks like.
 */
export function MiniPreview({ variant, player }: { variant: MiniVariant; player: PlayerState }): JSX.Element {
  const Variant = VARIANTS[variant]
  const scale = PREVIEW_WIDTH / NATURAL_WIDTH[variant]

  return (
    <div className="minipreview" style={{ width: PREVIEW_WIDTH }}>
      <div className="minipreview__scale" style={{ transform: `scale(${scale})` }}>
        <Variant player={player} expanded onToggleExpand={noop} onCommand={noop} onClose={noop} onRestore={noop} />
      </div>
    </div>
  )
}

/** The preview is a picture, not a control — every callback is inert. */
function noop(): void {}
