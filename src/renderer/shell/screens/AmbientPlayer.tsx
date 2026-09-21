import { useState } from 'react'
import type { Playlist, Track } from '@shared/domain'
import type { Settings } from '@shared/types'
import { artistLine } from '@shared/domain'
import { currentTrack, type PlayerState } from '@shared/player'
import { formatTime, ratio } from '../../shared/format'
import { ServiceBadge } from '../../shared/ServiceLogo'
import { useSmoothPosition } from '../../shared/useSmoothPosition'
import {
  Close,
  Heart,
  Maximize,
  Minimize,
  TrayDown,
  HeartOff,
  Next,
  Pause,
  Play,
  Prev,
  Radio,
  Repeat,
  RepeatOne,
  Shuffle,
  Sparkle
} from '../../shared/Icons'
import { Cover } from '../components/Cover'
import { Lyrics } from '../components/Lyrics'
import { SeekBar } from '../components/SeekBar'
import { VolumeButton } from '../components/VolumeButton'
import { PlayerExtras } from '../components/PlayerExtras'
import { LikeBurst } from '../components/LikeBurst'
import { useIdle } from '../useIdle'

interface Props {
  state: PlayerState
  /** Уходит: разыгрывается обратный путь, потом снимут. */
  closing?: boolean
  settings: Settings
  playlists: Playlist[]
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
/** Сколько покоя считать «на экран не смотрят». */
const IDLE_MS = 3000

export function AmbientPlayer({
  state,
  closing,
  settings,
  playlists,
  onClose,
  onSimilar,
  onOpenQueue
}: Props): JSX.Element {
  const [burst, setBurst] = useState(0)
  const position = useSmoothPosition(state)
  const track = currentTrack(state)
  /*
   * Верхняя строка уходит в покое: этот вид — про слова песни во весь экран, и
   * служебная полоса над ними нужна ровно тогда, когда за ней потянулись.
   * Нижняя плита остаётся всегда — прятать транспорт значит заставлять его
   * искать. При выключенном движении не прячется ничего.
   */
  const hidden = useIdle(IDLE_MS, settings.motion !== 'off')

  return (
    <div className={`ambient on-media ${closing ? 'is-closing' : ''} ${hidden ? 'ambient--bare' : ''}`}>
      {/* Две «лавовые» сферы из цветов обложки: фон живёт, но ни на что не
          претендует — там нет ни текста, ни границ. */}
      {track?.coverUrl && (
        <>
          <div className="ambient__blob ambient__blob--a" style={{ backgroundImage: `url("${track.coverUrl}")` }} />
          <div className="ambient__blob ambient__blob--b" style={{ backgroundImage: `url("${track.coverUrl}")` }} />
        </>
      )}
      <div className="ambient__veil" />

      {/* Полоса скрыта, но не снята: она остаётся под курсором, и кнопки
          возвращаются от того же движения, которым к ним тянутся. */}
      <header className="ambient__top" aria-hidden={hidden}>
        <button className="iconbtn nodrag" title="Свернуть плеер (Esc)" onClick={onClose}>
          <Close />
        </button>
        <div className="ambient__kicker">
          {state.waveService ? 'МОЯ ВОЛНА' : 'ИГРАЕТ ИЗ ОЧЕРЕДИ'}
          {track && <ServiceBadge service={track.service} />}
        </div>
        <span className="ambient__spacer" />
        {/* Тот же набор, что и у обычного полноэкранного: этот вид занимает
            окно целиком, и без них свернуть или закрыть его нечем. */}
        <div className="wincontrols nodrag">
          <button title="Свернуть окно" onClick={() => window.shell.minimize()}>
            <Minimize />
          </button>
          <button title="Развернуть на весь экран" onClick={() => window.shell.maximizeToggle()}>
            <Maximize />
          </button>
          <button title="Свернуть в трей" onClick={() => window.shell.hideToTray()}>
            <TrayDown />
          </button>
          <button
            className="wincontrols__close"
            title="Закрыть в трей"
            onClick={() => window.shell.hideToTray()}
          >
            <Close />
          </button>
        </div>
      </header>

      <div className="ambient__stage">
        <Lyrics
          track={track}
          positionMs={position}
          big
          holdSec={settings.lyricsHoldSec}
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
        {/* Сердечко и «не нравится» — там же, где и в обычной панели: это не
            украшение плеера, а то, ради чего в него заглядывают. */}
        <button
          className={`dock__like ${track?.liked ? 'dock__like--on' : ''}`}
          disabled={!track}
          title={track?.liked ? 'Убрать из избранного' : 'В избранное'}
          onClick={() => {
            if (settings.likeBurst && !track?.liked) setBurst((n) => n + 1)
            window.shell.command({ type: 'toggleLike' })
          }}
        >
          <Heart size={15} />
          <LikeBurst fire={burst} />
        </button>
        {state.canDislike && (
          <button
            className="dock__like"
            disabled={!track}
            title={
              track?.service === 'vk'
                ? 'Не нравится — больше не попадётся в волне'
                : 'Не нравится — убрать из рекомендаций'
            }
            onClick={() => window.shell.command({ type: 'dislike' })}
          >
            <HeartOff size={15} />
          </button>
        )}

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
        {track && (
          <button
            className="gbtn"
            title="Бесконечная станция вокруг этого трека"
            onClick={() => window.shell.command({ type: 'playTrackWave', track })}
          >
            <Radio size={13} /> Волна отсюда
          </button>
        )}

        <PlayerExtras
          state={state}
          settings={settings}
          playlists={playlists}
          tracks={track ? [track] : []}
          align="up"
        />
        <VolumeButton state={state} align="up" />
      </footer>
    </div>
  )
}
