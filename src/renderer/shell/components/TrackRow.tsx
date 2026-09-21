import type { Track } from '@shared/domain'
import { formatTime } from '../../shared/format'
import { ServiceBadge } from '../../shared/ServiceLogo'
import { Check, Download, Pause, Play, PlaylistAdd, Radio, Sparkle } from '../../shared/Icons'
import { Cover } from './Cover'
import { useContext } from 'react'
import { JamGuestContext } from '../JamContext'

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
  /** Omitted where a detour into similar tracks makes no sense. */
  onSimilar?: () => void
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
  onDownload,
  onSimilar
}: Props): JSX.Element {
  const jamGuest = useContext(JamGuestContext)
  return (
    <div
      className={`trackrow ${active ? 'trackrow--active' : ''} ${track.available ? '' : 'trackrow--off'}`}
      onDoubleClick={
        track.available
          ? active
            ? () => window.shell.command({ type: 'playPause' })
            : onPlay
          : undefined
      }
    >
      <button
        className="trackrow__index"
        disabled={!track.available}
        title={
          !track.available
            ? 'Трек недоступен'
            : active && playing
              ? 'Пауза'
              : active
                ? 'Продолжить'
                : 'Воспроизвести'
        }
        /*
         * У играющей строки кнопка — это пауза, а не «включить заново».
         * Раньше она всегда пересобирала очередь, и повторное нажатие
         * отматывало трек в начало вместо того, чтобы его остановить.
         */
        onClick={active ? () => window.shell.command({ type: 'playPause' }) : onPlay}
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

      {/* В общей сессии трек уходит в общую очередь у ведущего, а не играет
          здесь: музыка одна на всех. */}
      {jamGuest && (
        <button
          className="trackrow__jam"
          title="Предложить трек в общую очередь — он появится у всех участников"
          onClick={(event) => {
            event.stopPropagation()
            window.shell.command({ type: 'jamAdd', tracks: [track] })
          }}
        >
          <PlaylistAdd size={13} />
          {/* С подписью, а не одним значком: среди четырёх одинаковых кружков
              главное действие участника было неотличимо от остальных. */}
          <span>В очередь</span>
        </button>
      )}

      {/* Волна отсюда: не список похожего, а бесконечная станция вокруг этой
          песни — начинается с неё же. */}
      <button
        className="trackrow__dl"
        title="Волна по этому треку"
        onClick={(event) => {
          event.stopPropagation()
          window.shell.command({ type: 'playTrackWave', track })
        }}
      >
        <Radio size={14} />
      </button>

      {onSimilar && (
        <button className="trackrow__dl" title="Похожие треки" onClick={onSimilar}>
          <Sparkle size={13} />
        </button>
      )}

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
