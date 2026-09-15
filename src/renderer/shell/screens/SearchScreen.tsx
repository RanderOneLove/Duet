import { useMemo, useState } from 'react'
import type { Album, Artist, Playlist, SearchResult, ServiceId, Track } from '@shared/domain'
import { ServiceBadge } from '../../shared/ServiceLogo'
import { TrackList } from '../components/TrackList'
import { StateBlock } from '../components/StateBlock'
import { Segmented } from '../components/Segmented'
import { Play } from '../../shared/Icons'
import { Cover } from '../components/Cover'

type Tab = 'all' | 'vk' | 'yandex'

interface Props {
  query: string
  result: SearchResult
  loading: boolean
  activeId: string | null
  playing: boolean
  onPlay: (index: number) => void
  onToggleLike: (track: Track) => void
  downloadedIds: Set<string>
  onDownload: (track: Track) => void
  onSimilar: (track: Track) => void
  onOpenAlbum: (album: Album) => void
  onOpenPlaylist: (playlist: Playlist) => void
  onOpenArtist: (artist: Artist) => void
}

/** Wireframe 2c: tabs, a top result, then tracks, albums, artists, playlists. */
export function SearchScreen({
  query,
  result,
  loading,
  activeId,
  playing,
  onPlay,
  onToggleLike,
  downloadedIds,
  onDownload,
  onSimilar,
  onOpenAlbum,
  onOpenPlaylist,
  onOpenArtist
}: Props): JSX.Element {
  const [tab, setTab] = useState<Tab>('all')

  const vkCount = result.tracks.filter((track) => track.service === 'vk').length
  const yaCount = result.tracks.filter((track) => track.service === 'yandex').length

  const view = useMemo(() => filterByTab(result, tab), [result, tab])

  // The strongest single answer to the query, in the order the wireframe ranks
  // them: an artist, then an album, then simply the first track.
  const top = useMemo(() => pickTopResult(view, query), [view, query])

  if (!query.trim()) {
    return (
      <div className="screen">
        <StateBlock
          kind="empty"
          title="Что ищем?"
          hint="Начните вводить название трека, исполнителя или альбома в строке сверху."
        />
      </div>
    )
  }

  const nothing =
    !loading &&
    view.tracks.length === 0 &&
    view.albums.length === 0 &&
    view.artists.length === 0 &&
    view.playlists.length === 0

  return (
    <div className="screen">
      <div className="screen__head">
        <h1 className="screen__title">Поиск</h1>
        <span className="muted">«{query}»</span>
      </div>

      <Segmented
        className="search__tabs"
        value={tab}
        onChange={setTab}
        options={[
          { id: 'all', label: 'Все' },
          { id: 'vk', label: 'VK', hint: loading ? '…' : String(vkCount) },
          { id: 'yandex', label: 'Яндекс', hint: loading ? '…' : String(yaCount) }
        ]}
      />

      {nothing ? (
        <StateBlock kind="empty" title="Ничего не нашлось" hint="Попробуйте изменить запрос." />
      ) : (
        <>
          <div className="search__split">
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
                      else if (top.track) onPlay(indexInAll(result.tracks, top.track))
                    }}
                  >
                    <Play size={13} /> {top.kind === 'track' ? 'Слушать' : 'Открыть'}
                  </button>
                </div>
              </div>
            )}

            <div className="search__tracks">
              <div className="muted search__label">ТРЕКИ</div>
              <TrackList
                tracks={view.tracks}
                loading={loading}
                activeId={activeId}
                playing={playing}
                onPlay={(index) => onPlay(indexInAll(result.tracks, view.tracks[index]))}
                onToggleLike={onToggleLike}
                downloadedIds={downloadedIds}
                onDownload={onDownload}
            onSimilar={onSimilar}
                emptyTitle="Треков нет"
                emptyHint="Попробуйте другой запрос или другую вкладку."
              />
            </div>
          </div>

          {view.albums.length > 0 && (
            <section className="search__section">
              <div className="muted search__label">АЛЬБОМЫ</div>
              <div className="cardrow">
                {view.albums.map((album) => (
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
                      {[album.artists.join(', '), album.year].filter(Boolean).join(' · ')}
                    </div>
                  </button>
                ))}
              </div>
            </section>
          )}

          {view.artists.length > 0 && (
            <section className="search__section">
              <div className="muted search__label">ИСПОЛНИТЕЛИ</div>
              <div className="cardrow">
                {view.artists.map((artist) => (
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
              </div>
            </section>
          )}

          {view.playlists.length > 0 && (
            <section className="search__section">
              <div className="muted search__label">ПЛЕЙЛИСТЫ</div>
              <div className="cardrow">
                {view.playlists.map((playlist) => (
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
          )}
        </>
      )}
    </div>
  )
}

function filterByTab(result: SearchResult, tab: Tab): SearchResult {
  if (tab === 'all') return result
  const service: ServiceId = tab
  return {
    tracks: result.tracks.filter((item) => item.service === service),
    albums: result.albums.filter((item) => item.service === service),
    artists: result.artists.filter((item) => item.service === service),
    playlists: result.playlists.filter((item) => item.service === service)
  }
}

interface TopResult {
  kind: 'artist' | 'album' | 'track'
  title: string
  subtitle: string
  coverUrl: string | null
  service: ServiceId
  /** Exactly one of these is set; the screen decides what a click does. */
  artist?: Artist
  album?: Album
  track?: Track
}

/** Prefer an exact-ish name match, since that is what the query usually means. */
function pickTopResult(result: SearchResult, query: string): TopResult | null {
  const needle = query.trim().toLowerCase()
  const artist =
    result.artists.find((item) => item.name.toLowerCase() === needle) ?? result.artists[0]
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

  const album = result.albums[0]
  if (album) {
    return {
      kind: 'album',
      title: album.title,
      subtitle: album.artists.join(', ') || 'Альбом',
      coverUrl: album.coverUrl,
      service: album.service,
      album
    }
  }

  const track = result.tracks[0]
  if (track) {
    return {
      kind: 'track',
      title: track.title,
      subtitle: track.artists.join(', '),
      coverUrl: track.coverUrl,
      service: track.service,
      track
    }
  }
  return null
}

/** Playing from a filtered view still has to start the full result queue. */
function indexInAll(all: Track[], track: Track | undefined): number {
  if (!track) return 0
  const index = all.findIndex((item) => item.id === track.id)
  return index >= 0 ? index : 0
}
