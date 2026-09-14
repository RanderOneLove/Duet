import { formatRemaining, formatTime, ratio } from '../../shared/format'
import { useSmoothPosition } from '../../shared/useSmoothPosition'
import { SeekBar } from '../../shell/components/SeekBar'
import { Close, Maximize, Volume } from '../../shared/Icons'
import { Artwork, Badge, LikeButton, Transport, artist, title, track, type VariantProps } from './shared'

/**
 * Wireframe 3b — vertical card, 272px. Large artwork with a "next up" strip,
 * the only variant that shows what is coming.
 */
export function CardVariant({ player, expanded, onCommand, onToggleExpand, onClose, onRestore }: VariantProps): JSX.Element {
  const position = useSmoothPosition(player)

  return (
    <div className="v-card drag" onDoubleClick={onToggleExpand}>
      <div className="v-card__head">
        <span className="v-card__mark" />
        <span className="muted v-card__kicker">СЕЙЧАС ИГРАЕТ</span>
        <div className="v-card__spacer" />
        <button className="v-card__icon nodrag" title="Открыть приложение" onClick={onRestore}>
          <Maximize size={12} />
        </button>
        <button className="v-card__icon nodrag" title="Скрыть мини-плеер" onClick={onClose}>
          <Close size={12} />
        </button>
      </div>

      <Artwork player={player} className="v-card__art" />

      <div>
        <div className="truncate v-card__title">{title(player)}</div>
        <div className="muted v-card__sub">
          <span className="truncate">{artist(player)}</span>
          <Badge player={player} />
        </div>
      </div>

      <div className="v-card__progress nodrag">
        <SeekBar
          ratio={ratio(player.durationMs, position)}
          seekable={player.durationMs > 0}
          onSeek={(value) => onCommand({ type: 'seek', positionMs: value * player.durationMs })}
        />
        <div className="v-card__times muted">
          <span>{formatTime(position)}</span>
          <div className="v-card__volume">
            <Volume size={14} />
            <SeekBar
              ratio={player.muted ? 0 : player.volume}
              seekable={true}
              onSeek={(value) => onCommand({ type: 'setVolume', volume: value })}
            />
          </div>
          <span>{formatRemaining(player.durationMs, position)}</span>
        </div>
      </div>

      <div className="v-card__controls">
        <LikeButton player={player} onCommand={onCommand} />
        <Transport player={player} onCommand={onCommand} size={46} accent className="nodrag v-card__transport" />
      </div>

      {/*
        The wireframe's "ДАЛЕЕ" strip needs the service's queue, which the
        embedded player does not expose. Expanded shows the album instead, which
        we genuinely read, rather than a placeholder that never fills in.
      */}
      {expanded && track(player)?.album && (
        <div className="v-card__next">
          <span className="v-card__nextlabel muted">АЛЬБОМ</span>
          <span className="truncate v-card__nexttitle">{track(player)?.album}</span>
        </div>
      )}
    </div>
  )
}
