import type { Track } from '@shared/domain'
import { formatTime } from '../../shared/format'
import { ServiceBadge } from '../../shared/ServiceLogo'
import { Check, Download, Pause, Play } from '../../shared/Icons'
import { Cover } from './Cover'

interface Props {
  track: Track
  index: number
  active: boolean
  playing: boolean
  onPlay: () => void
  onToggleLike: () => void
  /** Omitted where downloading makes no sense, e.g. the Downloads screen. */
  downloaded?: boolean
  onDownload?: () => void
}

/** A row from wireframe 2b: index, cover, title, service badge, like, length. */
export function TrackRow({
  track,
  index,
  active,
  playing,
  onPlay,
  onToggleLike,
  downloaded,
  onDownload
}: Props): JSX.Element {
  return (
    <div
      className={`trackrow ${active ? 'trackrow--active' : ''} ${track.available ? '' : 'trackrow--off'}`}
      onDoubleClick={track.available ? onPlay : undefined}
    >
      <button
        className="trackrow__index"
        disabled={!track.available}
        title={track.available ? 'Воспроизвести' : 'Трек недоступен'}
        onClick={onPlay}
      >
        {/* The number gives way to a transport glyph on hover or while playing. */}
        <span className="trackrow__num">{index + 1}</span>
        <span className="trackrow__glyph">
          {active && playing ? <Pause size={13} /> : <Play size={13} />}
        </span>
      </button>

      <Cover url={track.coverUrl} seed={track.album ?? track.title} className="trackrow__art" />

      <div className="trackrow__meta">
        <div className="truncate trackrow__title">{track.title}</div>
        <div className="truncate muted trackrow__artist">{track.artists.join(', ') || '—'}</div>
      </div>

      {onDownload && (
        <button
          className={`trackrow__dl ${downloaded ? 'trackrow__dl--on' : ''}`}
          title={downloaded ? 'Скачан — нажмите, чтобы удалить файл' : 'Скачать'}
          onClick={onDownload}
        >
          {downloaded ? <Check size={13} /> : <Download size={13} />}
        </button>
      )}

      <ServiceBadge service={track.service} />

      <button
        className={`trackrow__like ${track.liked ? 'trackrow__like--on' : ''}`}
        title={track.liked ? 'Убрать из избранного' : 'В избранное'}
        onClick={onToggleLike}
      >
        ♥
      </button>

      <span className="muted trackrow__time">{formatTime(track.durationMs)}</span>
    </div>
  )
}
