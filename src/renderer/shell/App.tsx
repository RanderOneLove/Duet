import { useCallback, useEffect, useMemo, useState } from 'react'
import { DEFAULT_SETTINGS, type HotkeyStatus, type Settings } from '@shared/types'
import {
  EMPTY_SEARCH,
  type Album,
  type Artist,
  type ArtistRef,
  type Connection,
  type WaveChoice,
  type Playlist,
  type ServiceId,
  type Track
} from '@shared/domain'
import { currentTrack, EMPTY_PLAYER, type PlayerState } from '@shared/player'
import { EMPTY_DOWNLOADS, type DownloadsState } from '@shared/downloads'
import { Sidebar, type Route } from './components/Sidebar'
import { TopBar } from './components/TopBar'
import { NowPlayingBar } from './components/NowPlayingBar'
import { SettingsScreen } from './components/SettingsScreen'
import { ConnectScreen } from './screens/ConnectScreen'
import { HomeScreen } from './screens/HomeScreen'
import { LikedScreen } from './screens/LikedScreen'
import { SearchScreen } from './screens/SearchScreen'
import { LibraryScreen } from './screens/LibraryScreen'
import { PlaylistScreen } from './screens/PlaylistScreen'
import { PlayerScreen } from './screens/PlayerScreen'
import { DownloadsScreen } from './screens/DownloadsScreen'
import { useAsync } from './useLibrary'

export function App(): JSX.Element {
  const [player, setPlayer] = useState<PlayerState>(EMPTY_PLAYER)
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS)
  const [hotkeys, setHotkeys] = useState<HotkeyStatus>({})
  const [connections, setConnections] = useState<Connection[]>([])
  const [downloads, setDownloads] = useState<DownloadsState>(EMPTY_DOWNLOADS)
  const [route, setRoute] = useState<Route>('home')
  const [query, setQuery] = useState('')
  const [openPlaylist, setOpenPlaylist] = useState<Playlist | null>(null)
  const [openAlbum, setOpenAlbum] = useState<Album | null>(null)
  const [openArtist, setOpenArtist] = useState<Artist | null>(null)
  /**
   * Which service's personal radio the Home hero shows. The choice is a stored
   * setting so it survives a restart; the override only stands in for this run
   * when that service is not connected, and deliberately does not overwrite
   * the preference — a service that expires overnight should not silently
   * re-elect the other one for good.
   */
  const [waveOverride, setWaveOverride] = useState<WaveChoice | null>(null)
  const waveService = waveOverride ?? settings.waveService
  const [fullPlayer, setFullPlayer] = useState(false)
  // Connect is shown until a service is linked, or the user skips past it.
  const [skippedConnect, setSkippedConnect] = useState(false)

  useEffect(() => {
    void window.shell.getPlayer().then(setPlayer)
    void window.shell.getSettings().then(setSettings)
    void window.shell.getHotkeyStatus().then(setHotkeys)
    void window.shell.getConnections().then(setConnections)
    void window.shell.getDownloads().then(setDownloads)

    const off = [
      // An update without a queue means it did not change — keep the last one.
      window.shell.onPlayer((update) =>
        setPlayer((prev) => ({ ...update, queue: update.queue ?? prev.queue }))
      ),
      window.shell.onSettings(setSettings),
      window.shell.onHotkeyStatus(setHotkeys),
      window.shell.onConnections(setConnections),
      window.shell.onDownloads(setDownloads)
    ]
    return () => off.forEach((unsubscribe) => unsubscribe())
  }, [])

  const connectedCount = connections.filter((connection) => connection.connected).length

  // Catalogue queries. Each re-runs when the set of connected services changes,
  // so linking a service fills the screen without a manual refresh.
  const home = useAsync(() => window.shell.home(), [], [connectedCount])
  const liked = useAsync(() => window.shell.liked(), [], [connectedCount])
  const playlists = useAsync(() => window.shell.playlists(), [], [connectedCount])
  const search = useAsync(() => window.shell.search(query), EMPTY_SEARCH, [query, connectedCount])
  const playlistTracks = useAsync(
    () => (openPlaylist ? window.shell.playlistTracks(openPlaylist.service, openPlaylist.nativeId) : Promise.resolve([])),
    [],
    [openPlaylist?.id]
  )
  const albumTracks = useAsync(
    () => (openAlbum ? window.shell.albumTracks(openAlbum.service, openAlbum.nativeId) : Promise.resolve([])),
    [],
    [openAlbum?.id]
  )
  const artistTracks = useAsync(
    () => (openArtist ? window.shell.artistTracks(openArtist.service, openArtist.nativeId) : Promise.resolve([])),
    [],
    [openArtist?.id]
  )
  const wave = useAsync(
    () => (isConnected(connections, waveService) ? window.shell.wave(waveService) : Promise.resolve([])),
    [],
    [waveService, connectedCount]
  )

  useEffect(() => {
    // Services restore one after another at startup, so the preferred one can
    // be briefly absent. Standing down as soon as it appears is what keeps the
    // stored choice from being lost to that gap.
    if (waveOverride && isConnected(connections, settings.waveService)) {
      setWaveOverride(null)
      return
    }
    if (isConnected(connections, waveService)) return
    const fallback = connections.find((connection) => connection.connected)
    if (fallback) setWaveOverride(fallback.service)
  }, [connections, waveService, waveOverride, settings.waveService])

  const activeId = currentTrack(player)?.id ?? null

  /** Ids already on disk, for the tick on each row. */
  const downloadedIds = useMemo(
    () => new Set(downloads.items.filter((item) => item.status === 'done').map((item) => item.trackId)),
    [downloads.items]
  )

  const toggleDownload = useCallback(
    (track: Track) => {
      if (downloadedIds.has(track.id)) void window.shell.removeDownload(track.id)
      else void window.shell.download([track])
    },
    [downloadedIds]
  )

  const downloadAll = useCallback((tracks: Track[]) => {
    void window.shell.download(tracks)
  }, [])

  const playTracks = useCallback((tracks: Track[], index: number) => {
    window.shell.command({ type: 'playQueue', tracks, startIndex: index })
  }, [])

  const toggleLike = useCallback((track: Track) => {
    // The service owns the state; the reload comes back via onLibraryChanged.
    void window.shell.setLiked(track, !track.liked)
  }, [])

  useEffect(() => {
    return window.shell.onLibraryChanged(() => {
      liked.reload()
      search.reload()
      playlistTracks.reload()
      home.reload()
    })
  }, [liked.reload, search.reload, playlistTracks.reload, home.reload])

  const connect = useCallback(async (id: ServiceId) => {
    const next = await window.shell.connect(id)
    setConnections(next)
  }, [])

  const patchSettings = useCallback((patch: Partial<Settings>) => {
    void window.shell.setSettings(patch).then(setSettings)
  }, [])

  const goSearch = useCallback((text: string) => {
    setQuery(text)
    setRoute('search')
    setOpenPlaylist(null)
    setOpenAlbum(null)
  }, [])

  const navigate = useCallback((next: Route) => {
    setRoute(next)
    setOpenPlaylist(null)
    setOpenAlbum(null)
  }, [])

  const showPlaylist = useCallback((playlist: Playlist) => {
    setOpenAlbum(null)
    setOpenPlaylist(playlist)
  }, [])

  const showAlbum = useCallback((album: Album) => {
    setOpenPlaylist(null)
    setOpenAlbum(album)
    setOpenArtist(null)
  }, [])

  const showArtist = useCallback((artist: Artist): void => {
    setOpenArtist(artist)
    setOpenAlbum(null)
    setOpenPlaylist(null)
  }, [])

  // The hero follows the player only while the player is on that same station.
  const wavePlayback = useMemo(
    () =>
      player.waveService === waveService && player.index >= 0
        ? {
            current: player.queue[player.index] ?? null,
            next: player.queue.slice(player.index + 1, player.index + 5),
            playing: player.playing
          }
        : null,
    [player.waveService, player.index, player.queue, player.playing, waveService]
  )

  const openArtistOf = useCallback((track: Track, artist: ArtistRef): void => {
    setFullPlayer(false)
    showArtist({
      id: `${track.service}:artist:${artist.nativeId}`,
      service: track.service,
      nativeId: artist.nativeId,
      name: artist.name,
      coverUrl: null
    })
  }, [])

  const showConnect = connectedCount === 0 && !skippedConnect

  const content = useMemo(() => {
    if (showConnect) {
      return <ConnectScreen connections={connections} onConnect={connect} onSkip={() => setSkippedConnect(true)} />
    }
    if (openArtist) {
      return (
        <PlaylistScreen
          title={openArtist.name}
          subtitle="Исполнитель"
          coverUrl={openArtist.coverUrl}
          service={openArtist.service}
          round
          tracks={artistTracks.data}
          loading={artistTracks.loading}
          activeId={activeId}
          playing={player.playing}
          onBack={() => setOpenArtist(null)}
          onPlay={(index) => playTracks(artistTracks.data, index)}
          onToggleLike={toggleLike}
          downloadedIds={downloadedIds}
          onDownload={toggleDownload}
          onDownloadAll={downloadAll}
        />
      )
    }
    if (openAlbum) {
      return (
        <PlaylistScreen
          title={openAlbum.title}
          subtitle={[openAlbum.artists.join(', '), openAlbum.year].filter(Boolean).join(' · ')}
          coverUrl={openAlbum.coverUrl}
          service={openAlbum.service}
          tracks={albumTracks.data}
          loading={albumTracks.loading}
          activeId={activeId}
          playing={player.playing}
          onBack={() => setOpenAlbum(null)}
          onPlay={(index) => playTracks(albumTracks.data, index)}
          onToggleLike={toggleLike}
          downloadedIds={downloadedIds}
          onDownload={toggleDownload}
          onDownloadAll={downloadAll}
        />
      )
    }
    if (openPlaylist) {
      return (
        <PlaylistScreen
          title={openPlaylist.title}
          subtitle={`${openPlaylist.trackCount} треков`}
          coverUrl={openPlaylist.coverUrl}
          service={openPlaylist.service}
          tracks={playlistTracks.data}
          loading={playlistTracks.loading}
          activeId={activeId}
          playing={player.playing}
          onBack={() => setOpenPlaylist(null)}
          onPlay={(index) => playTracks(playlistTracks.data, index)}
          onToggleLike={toggleLike}
          downloadedIds={downloadedIds}
          onDownload={toggleDownload}
          onDownloadAll={downloadAll}
        />
      )
    }

    switch (route) {
      case 'home':
        return (
          <HomeScreen
            sections={home.data}
            loading={home.loading}
            connections={connections}
            waveService={waveService}
            wave={{
              tracks: wave.data,
              loading: wave.loading,
              error: wave.error,
              reload: wave.reload,
              playback: wavePlayback
            }}
            onWaveService={(service) => {
              setWaveOverride(null)
              patchSettings({ waveService: service })
            }}
            onPlayWave={() => window.shell.command({ type: 'playWave', service: waveService })}
            onToggleWave={() => window.shell.command({ type: 'playPause' })}
            activeId={activeId}
            playing={player.playing}
            onPlayTracks={playTracks}
            onOpenPlaylist={showPlaylist}
            onToggleLike={toggleLike}
            downloadedIds={downloadedIds}
            onDownload={toggleDownload}
          />
        )
      case 'search':
        return (
          <SearchScreen
            query={query}
            result={search.data}
            loading={search.loading}
            activeId={activeId}
            playing={player.playing}
            onPlay={(index) => playTracks(search.data.tracks, index)}
            onToggleLike={toggleLike}
            downloadedIds={downloadedIds}
            onDownload={toggleDownload}
            onOpenAlbum={showAlbum}
            onOpenPlaylist={showPlaylist}
            onOpenArtist={showArtist}
          />
        )
      case 'liked':
        return (
          <LikedScreen
            tracks={liked.data}
            loading={liked.loading}
            activeId={activeId}
            playing={player.playing}
            onPlay={(index) => playTracks(liked.data, index)}
            onToggleLike={toggleLike}
            downloadedIds={downloadedIds}
            onDownload={toggleDownload}
            onDownloadAll={downloadAll}
          />
        )
      case 'library':
        return (
          <LibraryScreen
            playlists={playlists.data}
            loading={playlists.loading}
            onOpen={showPlaylist}
          />
        )
      case 'downloads':
        return <DownloadsScreen downloads={downloads} activeId={activeId} onPlay={playTracks} />
      case 'settings':
        return (
          <SettingsScreen
            settings={settings}
            hotkeys={hotkeys}
            player={player}
            connections={connections}
            onChange={patchSettings}
            onConnect={connect}
            onDisconnect={async (id: ServiceId) => setConnections(await window.shell.disconnect(id))}
          />
        )
    }
  }, [
    showConnect,
    connections,
    downloads,
    downloadedIds,
    toggleDownload,
    downloadAll,
    connect,
    openPlaylist,
    openAlbum,
    albumTracks,
    playlistTracks,
    wave,
    waveService,
    showPlaylist,
    showAlbum,
    goSearch,
    route,
    home,
    search,
    liked,
    playlists,
    query,
    settings,
    hotkeys,
    player,
    activeId,
    playTracks,
    toggleLike,
    patchSettings
  ])

  const [dismissedError, setDismissedError] = useState<string | null>(null)

  const activeAsync = useMemo(() => {
    if (openPlaylist) return playlistTracks
    switch (route) {
      case 'home': return home
      case 'search': return search
      case 'liked': return liked
      case 'library': return playlists
      default: return null
    }
  }, [openPlaylist, route, home, search, liked, playlists, playlistTracks])

  const topBarError = activeAsync?.error && activeAsync.error !== dismissedError ? activeAsync.error : null

  return (
    <div className="app">
      <div className="app__body">
        <Sidebar
          route={route}
          playlists={playlists.data}
          collapsed={settings.sidebarCollapsed}
          onNavigate={navigate}
          onOpenPlaylist={showPlaylist}
          onToggleCollapsed={() => patchSettings({ sidebarCollapsed: !settings.sidebarCollapsed })}
        />
        <main className="app__main">
          <TopBar 
            query={query} 
            error={topBarError}
            onSearch={goSearch} 
            onToggleMini={() => window.shell.toggleMiniPlayer()} 
            onRetry={() => {
              setDismissedError(null)
              activeAsync?.reload()
            }}
            onDismissError={() => {
              if (activeAsync?.error) setDismissedError(activeAsync.error)
            }}
          />
          <div className="app__content">{content}</div>
        </main>
      </div>
      <NowPlayingBar state={player} onOpenPlayer={() => setFullPlayer(true)} />
      {fullPlayer && (
        <PlayerScreen
          state={player}
          onClose={() => setFullPlayer(false)}
          downloaded={currentTrack(player) ? downloadedIds.has(currentTrack(player)!.id) : false}
          onDownload={toggleDownload}
          onOpenArtist={openArtistOf}
        />
      )}
    </div>
  )
}

/** Whether a service is linked right now. */
function isConnected(connections: Connection[], choice: WaveChoice): boolean {
  // A woven wave only needs one of the two: the station that is up carries it
  // on its own rather than failing because its partner is missing.
  if (choice === 'both') return connections.some((connection) => connection.connected)
  return connections.some((connection) => connection.service === choice && connection.connected)
}
