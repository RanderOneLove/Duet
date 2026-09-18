import type { Track } from '@shared/domain'
import { TrackList } from '../components/TrackList'
import { useFiltered, type ServiceFilter } from '../useServiceFilter'
import { Download, Play, Shuffle } from '../../shared/Icons'

interface Props {
  /** Выбор сервиса общий на всё окно и приходит из титульной строки. */
  filter: ServiceFilter
  tracks: Track[]
  loading: boolean
  activeId: string | null
  playing: boolean
  onPlay: (index: number) => void
  onToggleLike: (track: Track) => void
  downloadedIds: Set<string>
  onDownload: (track: Track) => void
  onDownloadAll: (tracks: Track[]) => void
  onSimilar: (track: Track) => void
}

/** Wireframe 2b: liked tracks from both services in one list. */
export function LikedScreen(props: Props): JSX.Element {
  const filteredTracks = useFiltered(props.tracks, props.filter)

  const vkCount = props.tracks.filter((t) => t.service === 'vk').length
  const yaCount = props.tracks.length - vkCount
  
  const totalDurationMs = props.tracks.reduce((acc, t) => acc + t.durationMs, 0)
  
  // We need to map the original index for `onPlay`, so we pass the track itself or search its index
  const playTrack = (track: Track) => {
    const idx = props.tracks.findIndex((t) => t.id === track.id)
    if (idx >= 0) props.onPlay(idx)
  }

  const hours = Math.floor(totalDurationMs / 3600000)
  const minutes = Math.floor((totalDurationMs % 3600000) / 60000)
  const durationText = hours > 0 ? `${hours} ч ${minutes} мин` : `${minutes} мин`

  return (
    <div className="screen">
      <div className="liked-hero">
        <div className="liked-hero__art" />
        <div className="liked-hero__info">
          <div className="liked-hero__kicker muted">ПЛЕЙЛИСТ</div>
          <h1 className="liked-hero__title">Вам нравится</h1>
          <div className="muted">{vkCount} из VK · {yaCount} из Яндекса · {durationText}</div>
          <div className="liked-hero__actions">
            <button className="pill" disabled={filteredTracks.length === 0} onClick={() => filteredTracks.length > 0 && playTrack(filteredTracks[0])}>
              <Play size={14} /> Слушать
            </button>
            {/* Кнопка обязана включить именно этот список вперемешку. Раньше она
                лишь переключала тумблер — то есть на пустом плеере не делала
                ничего, а на чужой очереди перемешивала чужое. */}
            <button
              className="pill pill--ghost"
              title="Слушать вперемешку"
              disabled={filteredTracks.length === 0}
              onClick={() =>
                window.shell.command({
                  type: 'playQueue',
                  tracks: filteredTracks,
                  startIndex: 0,
                  shuffle: true
                })
              }
            >
              <Shuffle size={14} /> Перемешать
            </button>
            <button
              className="pill pill--outline"
              title="Скачать все треки из этого списка"
              disabled={filteredTracks.length === 0}
              onClick={() => props.onDownloadAll(filteredTracks)}
            >
              <Download size={14} /> Скачать всё
            </button>
          </div>
        </div>
      </div>

      <div className="tracklist-header muted">
        <span className="tracklist-header__index">#</span>
        <span className="tracklist-header__title">НАЗВАНИЕ</span>
        <span className="tracklist-header__album">АЛЬБОМ</span>
        <span className="tracklist-header__time">⏱</span>
      </div>
      <TrackList
        {...props}
        tracks={filteredTracks}
        downloadedIds={props.downloadedIds}
        onDownload={props.onDownload}
        onPlay={(index) => playTrack(filteredTracks[index])}
        emptyTitle="Тут пока пусто"
        emptyHint="Лайкните треки в сервисе — они появятся здесь."
      />
    </div>
  )
}
