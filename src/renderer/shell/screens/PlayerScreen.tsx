import { useEffect, useState } from 'react'
import type { ArtistRef, Playlist, Track } from '@shared/domain'
import type { Settings } from '@shared/types'
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
  Sparkle,
  TrayDown,
  Volume
} from '../../shared/Icons'
import { Cover } from '../components/Cover'
import { QueueList } from '../components/QueueList'
import { Lyrics } from '../components/Lyrics'
import { Segmented } from '../components/Segmented'
import { PlayerExtras, PlaylistPicker } from '../components/PlayerExtras'
import { AmbientPlayer } from './AmbientPlayer'

interface Props {
  state: PlayerState
  onClose: () => void
  downloaded: boolean
  settings: Settings
  playlists: Playlist[]
  onDownload: (track: Track) => void
  onOpenArtist: (track: Track, artist: ArtistRef) => void
  onSimilar: (track: Track) => void
}

/** Wireframe 2d: the full-screen player with the queue beside it. */
export function PlayerScreen({
  state,
  onClose,
  downloaded,
  settings,
  playlists,
  onDownload,
  onOpenArtist,
  onSimilar
}: Props): JSX.Element {
  const position = useSmoothPosition(state)
  const track = currentTrack(state)
  const [tab, setTab] = useState<'queue' | 'lyrics'>('queue')

  /*
   * Escape закрывает плеер. Он накрывает всё окно, и единственным выходом до
   * сих пор была маленькая кнопка в углу — а из экрана, который занял собой
   * всё, всегда должен быть привычный выход.
   */
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  // «Во всё окно» — совсем другой экран, а не тот же с другими отступами:
  // там нет ни очереди сбоку, ни панели действий, зато слова песни в центре.
  if (settings.playerLayout === 'ambient') {
    return (
      <AmbientPlayer
        state={state}
        settings={settings}
        playlists={playlists}
        onClose={onClose}
        onSimilar={onSimilar}
        onOpenQueue={() => setTab('queue')}
      />
    )
  }

  return (
    <div className={`fullplayer fullplayer--${settings.playerLayout}`}>
      {/* The current cover, blurred, carries the screen's colour. */}
      {track?.coverUrl && (
        <div className="fullplayer__glow" style={{ backgroundImage: `url("${track.coverUrl}")` }} />
      )}

      {/* Шапка и левая половина лежат на размытой обложке — там свой набор
          значений. Очередь справа остаётся обычной панелью приложения, иначе
          в светлой теме её текст оказывался белым на белом. */}
      <div className="on-media fullplayer__header">
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
        <div className="on-media fullplayer__now">
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
            <PlayerExtras
              state={state}
              settings={settings}
              playlists={playlists}
              tracks={track ? [track] : []}
              align="down"
            />
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

              <button
                className="pill pill--outline"
                title="Треки, похожие на этот"
                onClick={() => onSimilar(track)}
              >
                <Sparkle size={14} /> Похожее
              </button>

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

          {state.error && <div className="fullplayer__error">{state.error}</div>}
        </div>

        <aside className="queue">
          <div className="queue__head">
            <Segmented
              value={tab}
              onChange={setTab}
              options={[
                { id: 'queue', label: 'Очередь', hint: String(state.queue.length) },
                { id: 'lyrics', label: 'Текст' }
              ]}
            />
          </div>

          {tab === 'queue' ? <QueueList state={state} /> : <Lyrics
              track={track}
              positionMs={position}
              holdSec={settings.lyricsHoldSec}
              onSeek={(at) => window.shell.command({ type: 'seek', positionMs: at })}
            />}

          <div className="queue__footer">
            <div className="muted queue__note">Одна очередь на оба сервиса — переключение вкладок её не сбрасывает.</div>
            <div className="queue__footer-actions">
              {state.queue.length > 0 && (
                <PlaylistPicker tracks={state.queue} playlists={playlists} align="up" />
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


