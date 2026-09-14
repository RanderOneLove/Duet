import { ratio } from '../../shared/format'
import { useSmoothPosition } from '../../shared/useSmoothPosition'
import { SeekBar } from '../../shell/components/SeekBar'
import { Artwork, Badge, LikeButton, Transport, artist, title, type VariantProps } from './shared'
import { Volume } from '../../shared/Icons'

/**
 * Wireframe 3c — narrow pill, 230px at rest, 330px with artist and progress
 * once the pointer is over it. The smallest footprint of the four.
 */
export function PillVariant({ player, expanded, onCommand, onToggleExpand }: VariantProps): JSX.Element {
  const position = useSmoothPosition(player)

  if (!expanded) {
    return (
      <div className="v-pill v-pill--compact drag" onDoubleClick={onToggleExpand}>
        <Artwork player={player} className="v-pill__art v-pill__art--sm" />
        <div className="truncate v-pill__title">{title(player)}</div>
        <Transport player={player} onCommand={onCommand} size={24} className="nodrag" />
      </div>
    )
  }

  return (
    <div className="v-pill v-pill--expanded drag" onDoubleClick={onToggleExpand}>
      <div className="v-pill__row">
        <Artwork player={player} className="v-pill__art" />
        <div className="v-pill__meta">
          <div className="truncate v-pill__title">{title(player)}</div>
          <div className="muted v-pill__sub">
            <span className="truncate">{artist(player)}</span>
            <Badge player={player} />
          </div>
        </div>
        <Transport player={player} onCommand={onCommand} size={32} className="nodrag" />
      </div>
      <div className="v-pill__progress nodrag">
        <LikeButton player={player} onCommand={onCommand} />
        <SeekBar
          ratio={ratio(player.durationMs, position)}
          seekable={player.durationMs > 0}
          className="v-pill__seek"
          onSeek={(value) => onCommand({ type: 'seek', positionMs: value * player.durationMs })}
        />
        <div className="v-pill__volume">
          <Volume size={14} />
          <SeekBar
            ratio={player.muted ? 0 : player.volume}
            seekable={true}
            onSeek={(value) => onCommand({ type: 'setVolume', volume: value })}
          />
        </div>
      </div>
    </div>
  )
}
