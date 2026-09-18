import type { Track } from '@shared/domain'
import { artistLine } from '@shared/domain'
import { currentTrack, type PlayerState } from '@shared/player'
import { formatTime, ratio } from '../../shared/format'
import { ServiceBadge } from '../../shared/ServiceLogo'
import { useSmoothPosition } from '../../shared/useSmoothPosition'
import { Close, Next, Pause, Play, Prev, Repeat, RepeatOne, Shuffle, Sparkle } from '../../shared/Icons'
import { Cover } from '../components/Cover'
import { Lyrics } from '../components/Lyrics'
import { SeekBar } from '../components/SeekBar'

interface Props {
  state: PlayerState
  onClose: () => void
  onSimilar: (track: Track) => void
  onOpenQueue: () => void
}

/**
 * Плеер во всё окно (вайрфрейм 1f).
 *
 * Здесь нет ни панелей, ни списков: размытая обложка занимает окно целиком, а
 * главное на экране — слова песни. Строку подсвечивает не таймер интерфейса, а
 * сам сервис: Яндекс отдаёт текст с метками времени, и по ним видно, где мы в
 * песне. У треков без меток экран честно показывает текст без подсветки.
 *
 * Управление собрано в одну стеклянную плиту внизу — её видно всегда, потому
 * что прятать транспорт в плеере значит заставлять человека его искать.
 */
export function AmbientPlayer({ state, onClose, onSimilar, onOpenQueue }: Props): JSX.Element {
  const position = useSmoothPosition(state)
  const track = currentTrack(state)

  return (
    <div className="ambient on-media">
      {/* Две «лавовые» сферы из цветов обложки: фон живёт, но ни на что не
          претендует — там нет ни текста, ни границ. */}
      {track?.coverUrl && (
        <>
          <div className="ambient__blob ambient__blob--a" style={{ backgroundImage: `url("${track.coverUrl}")` }} />
          <div className="ambient__blob ambient__blob--b" style={{ backgroundImage: `url("${track.coverUrl}")` }} />
        </>
      )}
      <div className="ambient__veil" />

      <header className="ambient__top">
        <button className="iconbtn nodrag" title="Свернуть (Esc)" onClick={onClose}>
          <Close />
        </button>
        <div className="ambient__kicker">
          {state.waveService ? 'МОЯ ВОЛНА' : 'ИГРАЕТ ИЗ ОЧЕРЕДИ'}
          {track && <ServiceBadge service={track.service} />}
        </div>
        <span className="ambient__spacer" />
      </header>

      <div className="ambient__stage">
        <Lyrics
          track={track}
          positionMs={position}
          big
          onSeek={(at) => window.shell.command({ type: 'seek', positionMs: at })}
        />
      </div>

      <div className="ambient__now">
        <Cover url={track?.coverUrl} seed={track?.title ?? ''} className="ambient__art" />
        <div className="ambient__meta">
          <div className="truncate ambient__title">{track?.title ?? 'Ничего не играет'}</div>
          <div className="truncate muted ambient__artist">{track ? artistLine(track) : '—'}</div>
        </div>
      </div>

      <footer className="ambient__dock glass">
        <button
          className={`togglebtn ${state.shuffle ? 'togglebtn--on' : ''}`}
          title="Перемешать"
          onClick={() => window.shell.command({ type: 'toggleShuffle' })}
        >
          <Shuffle size={15} />
        </button>
        <button
          className="transport"
          disabled={!track}
          title="Предыдущий"
          onClick={() => window.shell.command({ type: 'prev' })}
        >
          <Prev size={20} />
        </button>
        <button
          className="playbtn ambient__play"
          disabled={!track}
          title={state.playing ? 'Пауза' : 'Воспроизвести'}
          onClick={() => window.shell.command({ type: 'playPause' })}
        >
          {state.loading ? <span className="spinner" /> : state.playing ? <Pause size={18} /> : <Play size={18} />}
        </button>
        <button
          className="transport"
          disabled={!track}
          title="Следующий"
          onClick={() => window.shell.command({ type: 'next' })}
        >
          <Next size={20} />
        </button>
        <button
          className={`togglebtn ${state.repeat !== 'off' ? 'togglebtn--on' : ''}`}
          title="Повтор"
          onClick={() => window.shell.command({ type: 'cycleRepeat' })}
        >
          {state.repeat === 'one' ? <RepeatOne size={15} /> : <Repeat size={15} />}
        </button>

        <span className="muted ambient__time">{formatTime(position)}</span>
        <SeekBar
          ratio={ratio(state.durationMs, position)}
          seekable={state.durationMs > 0}
          className="ambient__seek"
          onSeek={(value) => window.shell.command({ type: 'seek', positionMs: value * state.durationMs })}
        />
        <span className="muted ambient__time">{formatTime(state.durationMs)}</span>

        <button className="gbtn" onClick={onOpenQueue} title="Показать очередь">
          Очередь <b>{state.queue.length}</b>
        </button>
        {track && (
          <button className="gbtn" onClick={() => onSimilar(track)} title="Треки, похожие на этот">
            <Sparkle size={13} /> Похожее
          </button>
        )}
      </footer>
    </div>
  )
}
