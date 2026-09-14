import { formatTime, ratio } from '../../shared/format'
import { useSmoothPosition } from '../../shared/useSmoothPosition'
import { SeekBar } from '../../shell/components/SeekBar'
import { Artwork, Badge, LikeButton, Transport, artist, title, type VariantProps } from './shared'
import { Volume } from '../../shared/Icons'

/**
 * Wireframe 3a — horizontal plate, 384px. Everything at a glance; the progress
 * row appears when expanded.
 */
export function BarVariant({ player, expanded, onCommand, onToggleExpand }: VariantProps): JSX.Element {
  const position = useSmoothPosition(player)

  return (
    <div className="v-bar drag" onDoubleClick={onToggleExpand}>
      <div className="v-bar__top">
        <Artwork player={player} className="v-bar__art" />
        <div className="v-bar__meta">
          <div className="truncate v-bar__title">{title(player)}</div>
          <div className="muted v-bar__sub">
            <span className="truncate">{artist(player)}</span>
            <Badge player={player} />
          </div>
        </div>
        <Transport player={player} onCommand={onCommand} size={36} className="nodrag" />
      </div>

      {expanded && (
        <div className="v-bar__progress nodrag">
          <span className="muted v-bar__time">{formatTime(position)}</span>
          <SeekBar
            ratio={ratio(player.durationMs, position)}
            seekable={player.durationMs > 0}
            onSeek={(value) => onCommand({ type: 'seek', positionMs: value * player.durationMs })}
          />
          <span className="muted v-bar__time">{formatTime(player.durationMs)}</span>
          <LikeButton player={player} onCommand={onCommand} />
          <div className="v-bar__volume">
            <Volume size={14} />
            <SeekBar
              ratio={player.muted ? 0 : player.volume}
              seekable={true}
              onSeek={(value) => onCommand({ type: 'setVolume', volume: value })}
            />
          </div>
        </div>
      )}
    </div>
  )
}
