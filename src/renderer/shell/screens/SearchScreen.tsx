import { useEffect, useMemo, useState } from 'react'
import type { Album, Artist, Playlist, SearchResult, Track } from '@shared/domain'
import { ServiceBadge } from '../../shared/ServiceLogo'
import { TrackList } from '../components/TrackList'
import { StateBlock } from '../components/StateBlock'
import { Play, Sparkle } from '../../shared/Icons'
import { Cover } from '../components/Cover'
import { useFiltered, type ServiceFilter } from '../useServiceFilter'
import { Segmented } from '../components/Segmented'

/** Какой раздел результатов показывать. */
type Kind = 'all' | 'tracks' | 'albums' | 'artists' | 'playlists'

const KINDS: { id: Kind; label: string }[] = [
  { id: 'all', label: 'Всё' },
  { id: 'tracks', label: 'Треки' },
  { id: 'albums', label: 'Альбомы' },
  { id: 'artists', label: 'Исполнители' },
  { id: 'playlists', label: 'Плейлисты' }
]

interface Props {
  query: string
  /** Выбор сервиса общий на всё окно и приходит из титульной строки. */
  filter: ServiceFilter
  result: SearchResult
  loading: boolean
  activeId: string | null
  playing: boolean
  recent: string[]
  onSearch: (query: string) => void
  onPlay: (index: number) => void
  onToggleLike: (track: Track) => void
  downloadedIds: Set<string>
  onDownload: (track: Track) => void
  onSimilar: (track: Track) => void
  onOpenAlbum: (album: Album) => void
  onOpenPlaylist: (playlist: Playlist) => void
  onOpenArtist: (artist: Artist) => void
}

/** Сколько треков показывать сразу, пока не попросили остальные. */
const TRACKS_SHOWN = 6

/**
 * Поиск по вайрфрейму 1h.
 *
 * Слева — один лучший ответ на запрос и недавние запросы, справа — треки и
 * ряды карточек. Такое деление держит карточки на виду: в прежней раскладке
 * они стояли под полусотней треков, и до плейлистов никто не доскролливал.
 *
 * Фильтр сервиса сюда не дублируется — он один на всё окно, в титульной строке.
 */
export function SearchScreen({
  query,
  filter,
  result,
  loading,
  activeId,
  playing,
  recent,
  onSearch,
  onPlay,
  onToggleLike,
  downloadedIds,
  onDownload,
  onSimilar,
  onOpenAlbum,
  onOpenPlaylist,
  onOpenArtist
}: Props): JSX.Element {
  const [kind, setKind] = useState<Kind>('all')
  const [allTracks, setAllTracks] = useState(false)

  // Новый запрос — снова короткий список и раздел «Всё».
  useEffect(() => {
    setAllTracks(false)
    setKind('all')
  }, [query])

  const tracks = useFiltered(result.tracks, filter)
  const albums = useMemo(
    () => (filter === 'all' ? result.albums : result.albums.filter((item) => item.service === filter)),
    [result.albums, filter]
  )
  const artists = useMemo(
    () => (filter === 'all' ? result.artists : result.artists.filter((item) => item.service === filter)),
    [result.artists, filter]
  )
  const playlists = useMemo(
    () =>
      filter === 'all' ? result.playlists : result.playlists.filter((item) => item.service === filter),
    [result.playlists, filter]
  )

  const top = useMemo(() => pickTop(tracks, albums, artists, query), [tracks, albums, artists, query])
  const total = tracks.length + albums.length + artists.length + playlists.length

  if (!query.trim()) {
    return (
      <div className="screen search">
        <StateBlock
          kind="empty"
          title="Что ищем?"
          hint="Начните вводить название трека, исполнителя или альбома в строке сверху."
        />
        {recent.length > 0 && (
          <div className="search__recent">
            <div className="muted search__label">НЕДАВНИЕ ЗАПРОСЫ</div>
            <div className="search__chips">
              {recent.map((item) => (
                <button key={item} className="chip" onClick={() => onSearch(item)}>
                  {item}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    )
  }

  const nothing = !loading && total === 0

  const shownTracks = allTracks ? tracks : tracks.slice(0, TRACKS_SHOWN)
  const show = (what: Kind): boolean => kind === 'all' || kind === what

  return (
    <div className="screen search">
      <div className="search__head">
        <h1 className="screen__title">Поиск</h1>
        <span className="muted">
          «{query}» {!loading && <>· {total} результатов</>}
        </span>
      </div>

      {/* Тот же сегмент, что и фильтр сервиса в титульной строке: два ряда
          переключателей на одном экране должны выглядеть одинаково. */}
      <div className="search__kinds">
        <Segmented value={kind} onChange={setKind} options={KINDS} />
      </div>

      {nothing ? (
        <StateBlock kind="empty" title="Ничего не нашлось" hint="Попробуйте изменить запрос." />
      ) : (
        <div className="search__split">
          <aside className="search__side">
            {top && (
              <div className="topresult">
                <div className="muted topresult__kicker">ЛУЧШИЙ РЕЗУЛЬТАТ</div>
                <Cover
                  url={top.coverUrl}
                  seed={top.title}
                  rounded={top.kind === 'artist'}
                  className="topresult__art"
                />
                <div className="truncate topresult__title">{top.title}</div>
                <div className="muted topresult__sub">
                  <span className="truncate">{top.subtitle}</span>
                  <ServiceBadge service={top.service} />
                </div>
                <div className="topresult__actions">
                  <button
                    className="pill pill--sm"
                    onClick={() => {
                      if (top.album) onOpenAlbum(top.album)
                      else if (top.artist) onOpenArtist(top.artist)
                      else if (top.track) onPlay(indexOf(result.tracks, top.track))
                    }}
                  >
                    <Play size={13} /> {top.kind === 'track' ? 'Слушать' : 'Открыть'}
                  </button>
                  {top.track && (
                    <button className="gbtn" onClick={() => onSimilar(top.track!)}>
                      <Sparkle size={13} /> Похожее
                    </button>
                  )}
                </div>
              </div>
            )}

            {recent.length > 0 && (
              <div className="search__recent">
                <div className="muted search__label">НЕДАВНИЕ ЗАПРОСЫ</div>
                <div className="search__chips">
                  {recent
                    .filter((item) => item !== query)
                    .map((item) => (
                      <button key={item} className="chip" onClick={() => onSearch(item)}>
                        {item}
                      </button>
                    ))}
                </div>
              </div>
            )}
          </aside>

          <div className="search__main">
            {show('tracks') && tracks.length > 0 && (
              <section className="search__section">
                <div className="search__sechead">
                  <div className="muted search__label">ТРЕКИ</div>
                  <div className="home__spacer" />
                  {!allTracks && tracks.length > TRACKS_SHOWN && kind === 'all' && (
                    <button className="gbtn" onClick={() => setAllTracks(true)}>
                      Показать все {tracks.length}
                    </button>
                  )}
                </div>
                <TrackList
                  tracks={kind === 'tracks' ? tracks : shownTracks}
                  loading={loading}
                  activeId={activeId}
                  playing={playing}
                  onPlay={(index) =>
                    onPlay(indexOf(result.tracks, (kind === 'tracks' ? tracks : shownTracks)[index]))
                  }
                  onToggleLike={onToggleLike}
                  downloadedIds={downloadedIds}
                  onDownload={onDownload}
                  onSimilar={onSimilar}
                  emptyTitle="Треков нет"
                  emptyHint="Попробуйте другой запрос."
                />
              </section>
            )}

            {show('albums') && albums.length > 0 && (
              <CardRow label="АЛЬБОМЫ">
                {albums.map((album) => (
                  <button key={album.id} className="card" onClick={() => onOpenAlbum(album)}>
                    <div className="card__artwrap">
                      <Cover url={album.coverUrl} seed={album.title} className="card__art" />
                      <span className="card__play">
                        <Play size={14} />
                      </span>
                    </div>
                    <div className="card__titlerow">
                      <span className="truncate card__title">{album.title}</span>
                      <ServiceBadge service={album.service} />
                    </div>
                    <div className="truncate muted card__sub">
                      {[album.year, album.artists.join(', ')].filter(Boolean).join(' · ')}
                    </div>
                  </button>
                ))}
              </CardRow>
            )}

            {show('artists') && artists.length > 0 && (
              <CardRow label="ИСПОЛНИТЕЛИ">
                {artists.map((artist) => (
                  <button key={artist.id} className="card" onClick={() => onOpenArtist(artist)}>
                    <div className="card__artwrap">
                      <Cover url={artist.coverUrl} seed={artist.name} rounded className="card__art" />
                    </div>
                    <div className="card__titlerow">
                      <span className="truncate card__title">{artist.name}</span>
                      <ServiceBadge service={artist.service} />
                    </div>
                    <div className="truncate muted card__sub">Исполнитель</div>
                  </button>
                ))}
              </CardRow>
            )}

            {show('playlists') && playlists.length > 0 && (
              <CardRow label="ПЛЕЙЛИСТЫ">
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
              </CardRow>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function CardRow({ label, children }: { label: string; children: React.ReactNode }): JSX.Element {
  return (
    <section className="search__section">
      <div className="muted search__label">{label}</div>
      <div className="cardrow">{children}</div>
    </section>
  )
}

interface Top {
  kind: 'artist' | 'album' | 'track'
  title: string
  subtitle: string
  coverUrl: string | null
  service: Album['service']
  artist?: Artist
  album?: Album
  track?: Track
}

/**
 * Самый уверенный ответ на запрос: точное совпадение с именем исполнителя,
 * потом с названием альбома, иначе просто первый трек. Так «oohyo» открывает
 * исполнителя, а не случайную песню с этим словом в названии.
 */
function pickTop(tracks: Track[], albums: Album[], artists: Artist[], query: string): Top | null {
  const needle = query.trim().toLowerCase()

  const artist = artists.find((item) => item.name.toLowerCase() === needle) ?? artists[0]
  if (artist && artist.name.toLowerCase() === needle) {
    return {
      kind: 'artist',
      title: artist.name,
      subtitle: 'Исполнитель',
      coverUrl: artist.coverUrl,
      service: artist.service,
      artist
    }
  }

  const album = albums.find((item) => item.title.toLowerCase() === needle)
  if (album) {
    return {
      kind: 'album',
      title: album.title,
      subtitle: [album.year, album.artists.join(', ')].filter(Boolean).join(' · '),
      coverUrl: album.coverUrl,
      service: album.service,
      album
    }
  }

  if (artist) {
    return {
      kind: 'artist',
      title: artist.name,
      subtitle: 'Исполнитель',
      coverUrl: artist.coverUrl,
      service: artist.service,
      artist
    }
  }

  const track = tracks[0]
  if (!track) return null
  return {
    kind: 'track',
    title: track.title,
    subtitle: track.artists.join(', '),
    coverUrl: track.coverUrl,
    service: track.service,
    track
  }
}

/** Где этот трек лежит в неотфильтрованном списке — по нему и играем. */
function indexOf(all: Track[], track: Track | undefined): number {
  if (!track) return 0
  const at = all.findIndex((item) => item.id === track.id)
  return at < 0 ? 0 : at
}
