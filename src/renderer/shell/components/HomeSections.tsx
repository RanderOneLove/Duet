import type { Playlist, Track } from '@shared/domain'
import { ServiceBadge } from '../../shared/ServiceLogo'
import { Play } from '../../shared/Icons'
import { Cover } from './Cover'
import { TrackList } from './TrackList'
import { useFiltered, type ServiceFilter } from '../useServiceFilter'

/*
 * Блоки Главной, общие для всех её видов: ряд плейлистов и список треков.
 * Вынесены из HomeScreen, когда видов стало шесть, — каждый вид собирает
 * экран по-своему, а блоки остаются одними и теми же.
 */

/** Ряд плейлистов обоих сервисов. */
export function PlaylistsBlock({
  playlists,
  onOpenPlaylist,
  onOpenLibrary
}: {
  playlists: Playlist[]
  onOpenPlaylist: (playlist: Playlist) => void
  onOpenLibrary: () => void
}): JSX.Element {
  return (
    <section className="home__section">
      <div className="home__head">
        <h2 className="home__title">Плейлисты сервисов</h2>
        <span className="muted">оба сервиса · {playlists.length}</span>
        <div className="home__spacer" />
        <button className="gbtn" onClick={onOpenLibrary}>
          Все
        </button>
      </div>
      <div className="cardrow">
        {playlists.map((playlist) => (
          <button key={playlist.id} className="card" onClick={() => onOpenPlaylist(playlist)}>
            <div className="card__artwrap">
              <Cover url={playlist.coverUrl} seed={playlist.title} className="card__art" />
              <span className="card__play">
                <Play size={14} />
              </span>
            </div>
            <div className="card__titlerow">
              <span className="truncate card__title">{playlist.title}</span>
              <ServiceBadge service={playlist.service} />
            </div>
            <div className="truncate muted card__sub">{playlist.trackCount} треков</div>
          </button>
        ))}
      </div>
    </section>
  )
}

/** Список треков на Главной: избранное или скачанное. */
export function TracksBlock({
  title,
  filter,
  tracks,
  activeId,
  playing,
  onPlayTracks,
  onToggleLike,
  downloadedIds,
  onDownload,
  onSimilar
}: {
  title: string
  filter: ServiceFilter
  tracks: Track[]
  activeId: string | null
  playing: boolean
  onPlayTracks: (tracks: Track[], index: number) => void
  onToggleLike: (track: Track) => void
  downloadedIds: Set<string>
  onDownload: (track: Track) => void
  onSimilar: (track: Track) => void
}): JSX.Element {
  const filtered = useFiltered(tracks, filter)

  return (
    <section className="home__section">
      <div className="home__head">
        <h2 className="home__title">{title}</h2>
        {/* Счётчик остался, а переключатель сервиса уехал в титульную строку:
            он один на всё окно и не должен повторяться на каждом экране. */}
        <span className="muted home__count">{filtered.length}</span>
        <div className="home__spacer" />
        <button className="gbtn" disabled={filtered.length === 0} onClick={() => onPlayTracks(filtered, 0)}>
          <Play size={13} /> Слушать
        </button>
      </div>

      <TrackList
        tracks={filtered}
        loading={false}
        activeId={activeId}
        playing={playing}
        onPlay={(index) => onPlayTracks(filtered, index)}
        onToggleLike={onToggleLike}
        downloadedIds={downloadedIds}
        onDownload={onDownload}
        onSimilar={onSimilar}
        emptyTitle="В этом сервисе пусто"
        emptyHint="Выберите другую вкладку фильтра."
      />
    </section>
  )
}
