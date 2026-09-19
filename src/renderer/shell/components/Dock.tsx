import { artistLine, type Playlist } from '@shared/domain'
import type { Settings } from '@shared/types'
import { currentTrack, type PlayerState } from '@shared/player'
import { formatTime, ratio } from '../../shared/format'
import { ServiceBadge } from '../../shared/ServiceLogo'
import { useSmoothPosition } from '../../shared/useSmoothPosition'
import { Heart, HeartOff, Next, Pause, Play, Prev, Repeat, RepeatOne, Shuffle } from '../../shared/Icons'
import { SeekBar } from './SeekBar'
import { OutputPicker, PlaylistPicker, SleepPicker } from './PlayerExtras'
import { VolumeButton } from './VolumeButton'
import { Cover } from './Cover'

interface Props {
  state: PlayerState
  settings: Settings
  playlists: Playlist[]
  queueCount: number
  onOpenPlayer: () => void
}

/**
 * Панель плеера из вайрфрейма v2.
 *
 * Прежде это была полоса во всю ширину окна, отрезавшая от него свои 76
 * пикселей. Теперь это плита, лежащая поверх содержимого: она короче окна,
 * скруглена и отделена от фона кромкой, а список проезжает под ней.
 *
 * Вместе с видом изменился и состав. Устройство вывода и таймер сна перестали
 * быть спрятанными в настройках: это кнопки с подписью — видно, куда идёт звук
 * и сколько осталось до тишины. Полоса перемотки ушла под транспорт, а не
 * тянется через всю панель, — так её видно целиком вместе со временем.
 */
export function Dock({ state, settings, playlists, queueCount, onOpenPlayer }: Props): JSX.Element {
  const position = useSmoothPosition(state)
  const track = currentTrack(state)

  return (
    <footer className="dock glass">
      <button className="dock__track" onClick={onOpenPlayer} title="Открыть плеер">
        <Cover url={track?.coverUrl} seed={track?.title ?? ''} className="dock__art" />
        <div className="dock__meta">
          <div className="truncate dock__title">{track?.title ?? 'Ничего не играет'}</div>
          <div className="muted dock__artist">
            <span className="truncate">{track ? artistLine(track) : 'Выберите трек'}</span>
            {track && <ServiceBadge service={track.service} />}
          </div>
        </div>
      </button>

      <button
        className={`dock__like ${track?.liked ? 'dock__like--on' : ''}`}
        disabled={!track}
        title={track?.liked ? 'Убрать из избранного' : 'В избранное'}
        onClick={() => window.shell.command({ type: 'toggleLike' })}
      >
        <Heart size={15} />
      </button>

      {/* Кнопка появляется, только когда сервис играющего трека умеет её
          обслужить: у Яндекса это настоящая отметка, у VK — свой список
          Duet, потому что метода для этого сервис не даёт. */}
      {state.canDislike && (
        <button
          className="dock__like"
          disabled={!track}
          title={
            track?.service === 'vk'
              ? 'Не нравится — больше не попадётся в волне и играет следующий'
              : 'Не нравится — убрать из рекомендаций и включить следующий'
          }
          onClick={() => window.shell.command({ type: 'dislike' })}
        >
          <HeartOff size={15} />
        </button>
      )}

      <div className="dock__center">
        {/* Пока идём следом, об этом надо сказать прямо: иначе неработающая
            кнопка «дальше» выглядит поломкой, а не чужой очередью. */}
        {state.following && (
          <div className="dock__follow">
            <span className="dock__follow-dot" />
            <span className="truncate">
              {state.followError ??
                (state.jamGuest
                  ? 'Общая сессия — можно добавлять треки и переключать'
                  : 'Слушаете вместе — переключает ведущий')}
            </span>
            <button
              className="gbtn"
              title="Перестать слушать вместе"
              onClick={() => window.shell.command({ type: 'stopFollowing' })}
            >
              Отключиться
            </button>
          </div>
        )}

        <div className="dock__transport">
          <button
            className={`togglebtn ${state.shuffle ? 'togglebtn--on' : ''}`}
            title="Перемешать"
            onClick={() => window.shell.command({ type: 'toggleShuffle' })}
          >
            <Shuffle size={14} />
          </button>
          <button
            className="transport"
            disabled={!track || (state.following !== null && !state.jamGuest)}
            title={
              state.jamGuest
                ? 'Предыдущий — просьба уйдёт ведущему'
                : state.following
                  ? 'Пока слушаете вместе, переключает ведущий'
                  : 'Предыдущий'
            }
            onClick={() => window.shell.command({ type: 'prev' })}
          >
            <Prev size={17} />
          </button>
          <button
            className="playbtn dock__play"
            disabled={!track}
            title={
              state.following
                ? 'Подключиться к ведущему заново'
                : state.playing
                  ? 'Пауза'
                  : 'Воспроизвести'
            }
            onClick={() => window.shell.command({ type: 'playPause' })}
          >
            {state.loading ? (
              <span className="spinner" />
            ) : state.playing ? (
              <Pause size={16} />
            ) : (
              <Play size={16} />
            )}
          </button>
          <button
            className="transport"
            disabled={!track || (state.following !== null && !state.jamGuest)}
            title={
              state.jamGuest
                ? 'Следующий — просьба уйдёт ведущему'
                : state.following
                  ? 'Пока слушаете вместе, переключает ведущий'
                  : 'Следующий'
            }
            onClick={() => window.shell.command({ type: 'next' })}
          >
            <Next size={17} />
          </button>
          <button
            className={`togglebtn ${state.repeat !== 'off' ? 'togglebtn--on' : ''}`}
            title="Повтор"
            onClick={() => window.shell.command({ type: 'cycleRepeat' })}
          >
            {state.repeat === 'one' ? <RepeatOne size={14} /> : <Repeat size={14} />}
          </button>
        </div>

        <div className="dock__progress">
          <span className="muted dock__time">{formatTime(position)}</span>
          <SeekBar
            ratio={ratio(state.durationMs, position)}
            seekable={state.durationMs > 0}
            onSeek={(value) => window.shell.command({ type: 'seek', positionMs: value * state.durationMs })}
          />
          <span className="muted dock__time">{formatTime(state.durationMs)}</span>
        </div>
      </div>

      <div className="dock__right">
        <button className="gbtn" onClick={onOpenPlayer} title="Очередь и текст песни">
          <span className="dock__queue-label">Очередь</span> <b>{queueCount}</b>
        </button>
        <button className="gbtn dock__lyrics" onClick={onOpenPlayer} title="Текст песни">
          Текст
        </button>

        <OutputPicker state={state} align="up" labelled />
        <SleepPicker state={state} settings={settings} align="up" labelled />

        <VolumeButton state={state} align="up" />

        {/* Добавить играющий трек в свой плейлист — там же, где и было. */}
        {track && <PlaylistPicker tracks={[track]} playlists={playlists} align="up" />}
      </div>
    </footer>
  )
}
