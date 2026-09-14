import { artistLine, type Playlist } from '@shared/domain'
import type { Settings } from '@shared/types'
import { currentTrack, type PlayerState } from '@shared/player'
import { formatTime, ratio } from '../../shared/format'
import { ServiceBadge } from '../../shared/ServiceLogo'
import { useSmoothPosition } from '../../shared/useSmoothPosition'
import { Expand, Heart, Next, Pause, Play, Prev, Repeat, RepeatOne, Shuffle, Volume } from '../../shared/Icons'
import { SeekBar } from './SeekBar'
import { PlayerExtras } from './PlayerExtras'
import { Cover } from './Cover'

interface Props {
  state: PlayerState
  settings: Settings
  playlists: Playlist[]
  onOpenPlayer: () => void
}

/** The persistent transport bar from 2a, driven by our own player. */
export function NowPlayingBar({ state, settings, playlists, onOpenPlayer }: Props): JSX.Element {
  const position = useSmoothPosition(state)
  const track = currentTrack(state)
  const badge = track ? track.service : null

  return (
    <footer className="nowplaying">
      <button className="nowplaying__track" onClick={onOpenPlayer} title="Открыть плеер">
        <Cover url={track?.coverUrl} seed={track?.title ?? ''} className="nowplaying__art" />
        <div className="nowplaying__meta">
          <div className="truncate nowplaying__title">{track?.title ?? 'Ничего не играет'}</div>
          <div className="muted nowplaying__artist">
            <span className="truncate">{track ? artistLine(track) : 'Выберите трек'}</span>
            {badge && <ServiceBadge service={badge} />}
          </div>
        </div>
        <span className="nowplaying__expand">
          <Expand size={13} />
        </span>
      </button>

      <button
        className={`likebtn ${track?.liked ? 'likebtn--on' : ''}`}
        disabled={!track}
        title={track?.liked ? 'Убрать из избранного' : 'В избранное'}
        onClick={() => window.shell.command({ type: 'toggleLike' })}
      >
        <Heart size={15} />
      </button>

      <div className="nowplaying__center">
        <div className="nowplaying__transport">
          <button
            className={`togglebtn ${state.shuffle ? 'togglebtn--on' : ''}`}
            title="Перемешать"
            onClick={() => window.shell.command({ type: 'toggleShuffle' })}
          >
            <Shuffle size={14} />
          </button>
          <button
            className="transport"
            disabled={!track}
            title="Предыдущий"
            onClick={() => window.shell.command({ type: 'prev' })}
          >
            <Prev size={17} />
          </button>
          <button
            className="playbtn nowplaying__play"
            disabled={!track}
            title={state.playing ? 'Пауза' : 'Воспроизвести'}
            onClick={() => window.shell.command({ type: 'playPause' })}
          >
            {state.loading ? <span className="spinner" /> : state.playing ? <Pause size={15} /> : <Play size={15} />}
          </button>
          <button
            className="transport"
            disabled={!track}
            title="Следующий"
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

        <div className="nowplaying__progress">
          <span className="muted nowplaying__time">{formatTime(position)}</span>
          <SeekBar
            ratio={ratio(state.durationMs, position)}
            seekable={state.durationMs > 0}
            onSeek={(value) => window.shell.command({ type: 'seek', positionMs: value * state.durationMs })}
          />
          <span className="muted nowplaying__time">{formatTime(state.durationMs)}</span>
        </div>
      </div>

      <div className="nowplaying__right">
        <PlayerExtras
          state={state}
          settings={settings}
          playlists={playlists}
          tracks={track ? [track] : []}
          align="up"
        />
        <button
          className="transport"
          title={state.muted ? 'Включить звук' : 'Выключить звук'}
          onClick={() => window.shell.command({ type: 'toggleMute' })}
        >
          <Volume size={15} />
        </button>
        <SeekBar
          ratio={state.muted ? 0 : state.volume}
          seekable
          className="nowplaying__volume"
          onSeek={(value) => window.shell.command({ type: 'setVolume', volume: value })}
        />
      </div>
    </footer>
  )
}
