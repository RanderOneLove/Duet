import { ratio } from '../../shared/format'
import { useSmoothPosition } from '../../shared/useSmoothPosition'
import { SeekBar } from '../../shell/components/SeekBar'
import { Close, Maximize, Volume } from '../../shared/Icons'
import { Badge, LikeButton, Transport, artist, title, track, type VariantProps } from './shared'

/**
 * Wireframe 3d — 264px square with the artwork as the background. The gradient
 * scrim is fixed rather than sampled from the art, so text contrast holds for
 * any cover.
 */
export function CoverVariant({ player, expanded, onCommand, onToggleExpand, onClose, onRestore }: VariantProps): JSX.Element {
  const position = useSmoothPosition(player)

  return (
    <div
      className="v-cover drag"
      onDoubleClick={onToggleExpand}
      style={track(player)?.coverUrl ? { backgroundImage: `url("${track(player)?.coverUrl}")` } : undefined}
    >
      <div className="v-cover__scrim" />
      <div className="v-cover__inner">
        <div className="v-cover__head">
          <Badge player={player} />
          <div className="v-cover__spacer" />
          <button className="v-cover__icon nodrag" title="Открыть приложение" onClick={onRestore}>
            <Maximize size={12} />
          </button>
          <button className="v-cover__icon nodrag" title="Скрыть мини-плеер" onClick={onClose}>
            <Close size={12} />
          </button>
        </div>

        <div className="v-cover__foot">
          <div>
            <div className="truncate v-cover__title">{title(player)}</div>
            <div className="truncate muted v-cover__sub">{artist(player)}</div>
          </div>

          {/* At rest the square stays purely the cover; hovering brings controls up. */}
          {expanded && (
            <>
              <div className="v-cover__progress nodrag">
                <SeekBar
                  ratio={ratio(player.durationMs, position)}
                  seekable={player.durationMs > 0}
                  onSeek={(value) => onCommand({ type: 'seek', positionMs: value * player.durationMs })}
                />
                <div className="v-cover__volume">
                  <Volume size={14} />
                  <SeekBar
                    ratio={player.muted ? 0 : player.volume}
                    seekable={true}
                    onSeek={(value) => onCommand({ type: 'setVolume', volume: value })}
                  />
                </div>
              </div>
              <div className="v-cover__controls">
                <LikeButton player={player} onCommand={onCommand} />
                <Transport player={player} onCommand={onCommand} size={44} className="nodrag v-cover__transport" />
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
