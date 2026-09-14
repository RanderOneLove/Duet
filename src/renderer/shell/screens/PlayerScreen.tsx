import { useEffect, useState } from 'react'
import type { ArtistRef, Playlist, Track } from '@shared/domain'
import { currentTrack, type PlayerState, type RepeatMode } from '@shared/player'
import { formatTime, ratio } from '../../shared/format'
import { ServiceBadge } from '../../shared/ServiceLogo'
import { useSmoothPosition } from '../../shared/useSmoothPosition'
import { SeekBar } from '../components/SeekBar'
import {
  Check,
  Close,
  Download,
  Heart,
  Maximize,
  Minimize,
  Next,
  Pause,
  Play,
  Prev,
  Repeat,
  RepeatOne,
  Shuffle,
  TrayDown,
  Volume
} from '../../shared/Icons'
import { Cover } from '../components/Cover'
import { QueueList } from '../components/QueueList'
import { AddToPlaylist } from '../components/AddToPlaylist'

interface Props {
  state: PlayerState
  onClose: () => void
  downloaded: boolean
  playlists: Playlist[]
  onDownload: (track: Track) => void
  onOpenArtist: (track: Track, artist: ArtistRef) => void
}

/** Wireframe 2d: the full-screen player with the queue beside it. */
export function PlayerScreen({
  state,
  onClose,
  downloaded,
  playlists,
  onDownload,
  onOpenArtist
}: Props): JSX.Element {
  const position = useSmoothPosition(state)
  const track = currentTrack(state)

  return (
    <div className="fullplayer">
      {/* The current cover, blurred, carries the screen's colour. */}
      {track?.coverUrl && (
        <div className="fullplayer__glow" style={{ backgroundImage: `url("${track.coverUrl}")` }} />
      )}

      <div className="fullplayer__header">
        <button className="iconbtn" title="Свернуть" onClick={onClose}>
          ▾
        </button>
        <div className="fullplayer__header-title">
          <div className="muted fullplayer__kicker">ИГРАЕТ ИЗ ОЧЕРЕДИ</div>
          <div className="fullplayer__source">{state.queue.length} треков</div>
        </div>
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
      </div>

      <div className="fullplayer__body">
        <div className="fullplayer__now">
          <Cover url={track?.coverUrl} seed={track?.title ?? ''} className="fullplayer__art" />

          <div className="fullplayer__meta">
            <div className="truncate fullplayer__title">{track?.title ?? 'Ничего не играет'}</div>
            <div className="fullplayer__artist muted">
              {track ? <Artists track={track} onOpen={onOpenArtist} /> : <span>—</span>}
              {track && track.album && <span> · {track.album}</span>}
              {track && <ServiceBadge service={track.service} />}
            </div>
          </div>

          <div className="fullplayer__progress">
            <SeekBar
              ratio={ratio(state.durationMs, position)}
              seekable={state.durationMs > 0}
              onSeek={(value) => window.shell.command({ type: 'seek', positionMs: value * state.durationMs })}
            />
            <div className="fullplayer__times muted">
              <span>{formatTime(position)}</span>
              <span>{formatTime(state.durationMs)}</span>
            </div>
          </div>

          <div className="fullplayer__transport">
            <button
              className={`togglebtn ${state.shuffle ? 'togglebtn--on' : ''}`}
              title="Перемешать"
              onClick={() => window.shell.command({ type: 'toggleShuffle' })}
            >
              <Shuffle size={18} />
            </button>
            <button className="transport" title="Предыдущий" onClick={() => window.shell.command({ type: 'prev' })}>
              <Prev size={24} />
            </button>
            <button
              className="fullplayer__play"
              disabled={!track}
              onClick={() => window.shell.command({ type: 'playPause' })}
            >
              {state.playing ? <Pause size={24} /> : <Play size={24} />}
            </button>
            <button className="transport" title="Следующий" onClick={() => window.shell.command({ type: 'next' })}>
              <Next size={24} />
            </button>
            <button
              className={`togglebtn ${state.repeat !== 'off' ? 'togglebtn--on' : ''}`}
              title={repeatTitle(state.repeat)}
              onClick={() => window.shell.command({ type: 'cycleRepeat' })}
            >
              {state.repeat === 'one' ? <RepeatOne size={18} /> : <Repeat size={18} />}
            </button>
          </div>

          <div className="fullplayer__volume">
            <button
              className="transport"
              title={state.muted ? 'Включить звук' : 'Выключить звук'}
              onClick={() => window.shell.command({ type: 'toggleMute' })}
            >
              <Volume size={16} />
            </button>
            <SeekBar
              ratio={state.muted ? 0 : state.volume}
              seekable
              className="fullplayer__volumebar"
              onSeek={(value) => window.shell.command({ type: 'setVolume', volume: value })}
            />
            <span className="muted fullplayer__volumevalue">
              {state.muted ? 'без звука' : `${Math.round(state.volume * 100)} %`}
            </span>
          </div>

          {track && (
            <div className="fullplayer__actions">
              {/*
                Goes through the engine, not setLiked directly: the engine also
                flips the flag on the queued track, which is what this button
                reads its own state from.
              */}
              <button
                className={`pill pill--outline ${track.liked ? 'liked' : ''}`}
                title={track.liked ? 'Убрать из избранного' : 'Добавить в избранное'}
                onClick={() => window.shell.command({ type: 'toggleLike' })}
              >
                <Heart size={14} />
                {track.liked ? ' В избранном' : ' В избранное'} ·{' '}
                {track.service === 'vk' ? 'VK' : 'Яндекс'}
              </button>

              <AddToPlaylist tracks={[track]} playlists={playlists} label="+ В плейлист" />

              <button
                className={`pill pill--outline ${downloaded ? 'liked' : ''}`}
                title={downloaded ? 'Скачан — нажмите, чтобы удалить файл' : 'Скачать трек'}
                onClick={() => onDownload(track)}
              >
                {downloaded ? <Check size={14} /> : <Download size={14} />}
                {downloaded ? ' Скачан' : ' Скачать'}
              </button>
            </div>
          )}

          <div className="fullplayer__outputs">
            <Output state={state} />
            <SleepTimer endsAt={state.sleepEndsAt} />
          </div>

          {state.error && <div className="fullplayer__error">{state.error}</div>}
        </div>

        <aside className="queue">
          <div className="queue__head">
            <span className="queue__title">Очередь</span>
            <span className="muted">{state.queue.length}</span>
          </div>

          <QueueList state={state} />

          <div className="queue__footer">
            <div className="muted queue__note">Одна очередь на оба сервиса — переключение вкладок её не сбрасывает.</div>
            <div className="queue__footer-actions">
              {state.queue.length > 0 && (
                <AddToPlaylist
                  tracks={state.queue}
                  playlists={playlists}
                  label="Сохранить очередь"
                />
              )}
              <button
                className="pill pill--outline pill--sm"
                disabled={state.queue.length === 0}
                onClick={() => window.shell.command({ type: 'clearQueue' })}
              >
                Очистить
              </button>
            </div>
          </div>
        </aside>
      </div>
    </div>
  )
}

function repeatTitle(mode: RepeatMode): string {
  return mode === 'off' ? 'Повтор выключен' : mode === 'all' ? 'Повторять очередь' : 'Повторять трек'
}

/**
 * The artists as links, where the service told us who they are. A name without
 * an id stays plain text rather than becoming a link that goes nowhere.
 */
function Artists({
  track,
  onOpen
}: {
  track: Track
  onOpen: (track: Track, artist: ArtistRef) => void
}): JSX.Element {
  const refs = track.artistRefs ?? []
  if (refs.length === 0) {
    return <span className="truncate">{track.artists.join(', ') || '—'}</span>
  }

  return (
    <span className="truncate">
      {refs.map((artist, index) => (
        <span key={artist.nativeId}>
          {index > 0 && ', '}
          <button className="linklike" title={`Открыть ${artist.name}`} onClick={() => onOpen(track, artist)}>
            {artist.name}
          </button>
        </span>
      ))}
    </span>
  )
}

/** Which speakers the music comes out of. */
function Output({ state }: { state: PlayerState }): JSX.Element {
  return (
    <label className="picker">
      <span className="muted picker__label">Устройство</span>
      <select
        value={state.outputDeviceId}
        onChange={(event) =>
          window.shell.command({ type: 'setOutputDevice', deviceId: event.target.value })
        }
      >
        <option value="">Системное</option>
        {state.outputDevices
          .filter((device) => device.id && device.id !== 'default')
          .map((device) => (
            <option key={device.id} value={device.id}>
              {device.label}
            </option>
          ))}
      </select>
    </label>
  )
}

const PRESETS = [5, 15, 30, 45, 60, 90]

/** Stop the music after a while, with a countdown once it is running. */
function SleepTimer({ endsAt }: { endsAt: number | null }): JSX.Element {
  const [custom, setCustom] = useState(false)
  const [minutes, setMinutes] = useState('20')
  const left = useCountdown(endsAt)

  return (
    <label className="picker">
      <span className="muted picker__label">Таймер сна</span>
      <select
        value={endsAt ? 'on' : custom ? 'custom' : 'off'}
        onChange={(event) => {
          const value = event.target.value
          setCustom(value === 'custom')
          if (value === 'custom') return
          window.shell.command({
            type: 'setSleepTimer',
            minutes: value === 'off' || value === 'on' ? null : Number(value)
          })
        }}
      >
        {endsAt && <option value="on">Осталось {left}</option>}
        <option value="off">Выключен</option>
        {PRESETS.map((preset) => (
          <option key={preset} value={preset}>
            {preset} минут
          </option>
        ))}
        <option value="custom">Своё время…</option>
      </select>

      {custom && !endsAt && (
        <span className="picker__custom">
          <input
            type="number"
            min={1}
            max={600}
            value={minutes}
            onChange={(event) => setMinutes(event.target.value)}
          />
          <button
            className="pill pill--sm"
            disabled={!(Number(minutes) > 0)}
            onClick={() => {
              window.shell.command({ type: 'setSleepTimer', minutes: Number(minutes) })
              setCustom(false)
            }}
          >
            Пуск
          </button>
        </span>
      )}
    </label>
  )
}

/** Time left as m:ss, ticking once a second only while a timer runs. */
function useCountdown(endsAt: number | null): string {
  const [, tick] = useState(0)

  useEffect(() => {
    if (!endsAt) return
    const id = setInterval(() => tick((value) => value + 1), 1000)
    return () => clearInterval(id)
  }, [endsAt])

  if (!endsAt) return ''
  return formatTime(Math.max(0, endsAt - Date.now()))
}
