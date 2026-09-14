import { contextBridge, ipcRenderer } from 'electron'
import { IPC } from '@shared/ipc'
import type { DisplayInfo, HotkeyStatus, Settings } from '@shared/types'
import type { Connection, HomeSection, Playlist, SearchResult, ServiceId, Track, WaveChoice } from '@shared/domain'
import type { PlayerCommand, PlayerState, PlayerUpdate } from '@shared/player'
import type { DownloadsState } from '@shared/downloads'

/** The only surface the shell renderer has onto the main process. */
const api = {
  // player
  getPlayer: (): Promise<PlayerState> => ipcRenderer.invoke(IPC.playerGet),
  command: (input: PlayerCommand): void => ipcRenderer.send(IPC.playerCommand, input),
  onPlayer: (handler: (state: PlayerUpdate) => void) => subscribe(IPC.playerState, handler),

  // sources
  getConnections: (): Promise<Connection[]> => ipcRenderer.invoke(IPC.sourceConnections),
  connect: (id: ServiceId): Promise<Connection[]> => ipcRenderer.invoke(IPC.sourceConnect, id),
  disconnect: (id: ServiceId): Promise<Connection[]> => ipcRenderer.invoke(IPC.sourceDisconnect, id),
  onConnections: (handler: (connections: Connection[]) => void) =>
    subscribe(IPC.sourceConnectionsChanged, handler),
  /** Fires after a like lands, so lists can re-read themselves. */
  onLibraryChanged: (handler: () => void) => subscribe(IPC.libChanged, handler),

  // catalogue
  home: (): Promise<HomeSection[]> => ipcRenderer.invoke(IPC.libHome),
  liked: (): Promise<Track[]> => ipcRenderer.invoke(IPC.libLiked),
  playlists: (): Promise<Playlist[]> => ipcRenderer.invoke(IPC.libPlaylists),
  playlistTracks: (service: ServiceId | null, nativeId: string): Promise<Track[]> =>
    ipcRenderer.invoke(IPC.libPlaylistTracks, service, nativeId),
  albumTracks: (service: ServiceId, nativeId: string): Promise<Track[]> =>
    ipcRenderer.invoke(IPC.libAlbumTracks, service, nativeId),
  artistTracks: (service: ServiceId, nativeId: string): Promise<Track[]> =>
    ipcRenderer.invoke(IPC.libArtistTracks, service, nativeId),
  createPlaylist: (title: string, tracks: Track[] = []): Promise<string> =>
    ipcRenderer.invoke(IPC.libLocalCreate, title, tracks),
  renamePlaylist: (id: string, title: string): Promise<void> =>
    ipcRenderer.invoke(IPC.libLocalRename, id, title),
  removePlaylist: (id: string): Promise<void> => ipcRenderer.invoke(IPC.libLocalRemove, id),
  addToPlaylist: (id: string, tracks: Track[]): Promise<void> =>
    ipcRenderer.invoke(IPC.libLocalAdd, id, tracks),
  removeFromPlaylist: (id: string, trackId: string): Promise<void> =>
    ipcRenderer.invoke(IPC.libLocalRemoveTrack, id, trackId),
  lyrics: (track: Track): Promise<string | null> => ipcRenderer.invoke(IPC.libLyrics, track),
  search: (query: string): Promise<SearchResult> => ipcRenderer.invoke(IPC.libSearch, query),
  wave: (choice: WaveChoice): Promise<Track[]> => ipcRenderer.invoke(IPC.libWave, choice),
  setLiked: (track: Track, liked: boolean): Promise<void> => ipcRenderer.invoke(IPC.libSetLiked, track, liked),

  // downloads
  getDownloads: (): Promise<DownloadsState> => ipcRenderer.invoke(IPC.downloadsGet),
  download: (tracks: Track[]): Promise<void> => ipcRenderer.invoke(IPC.downloadsAdd, tracks),
  removeDownload: (trackId: string): Promise<void> => ipcRenderer.invoke(IPC.downloadsRemove, trackId),
  retryDownload: (trackId: string): Promise<void> => ipcRenderer.invoke(IPC.downloadsRetry, trackId),
  openDownloadsFolder: (): Promise<void> => ipcRenderer.invoke(IPC.downloadsOpenFolder),
  pickDownloadsFolder: (): Promise<string | null> => ipcRenderer.invoke(IPC.downloadsPickFolder),
  onDownloads: (handler: (state: DownloadsState) => void) => subscribe(IPC.downloadsChanged, handler),

  // settings / system
  getSettings: (): Promise<Settings> => ipcRenderer.invoke(IPC.settingsGet),
  setSettings: (patch: Partial<Settings>): Promise<Settings> => ipcRenderer.invoke(IPC.settingsSet, patch),
  getDisplays: (): Promise<DisplayInfo[]> => ipcRenderer.invoke(IPC.displaysGet),
  getAppInfo: (): Promise<{ name: string; version: string }> => ipcRenderer.invoke(IPC.appInfo),
  getHotkeyStatus: (): Promise<HotkeyStatus> => ipcRenderer.invoke(IPC.hotkeyStatus),
  onSettings: (handler: (settings: Settings) => void) => subscribe(IPC.settingsChanged, handler),
  onHotkeyStatus: (handler: (status: HotkeyStatus) => void) => subscribe(IPC.hotkeyStatus, handler),

  // window
  toggleMiniPlayer: (): void => ipcRenderer.send(IPC.miniToggle),
  minimize: (): void => ipcRenderer.send(IPC.windowMinimize),
  maximizeToggle: (): void => ipcRenderer.send(IPC.windowMaximizeToggle),
  hideToTray: (): void => ipcRenderer.send(IPC.windowHideToTray)
}

/** Subscribe and hand back an unsubscribe, so React effects can clean up. */
function subscribe<T>(channel: string, handler: (payload: T) => void): () => void {
  const listener = (_event: Electron.IpcRendererEvent, payload: T): void => handler(payload)
  ipcRenderer.on(channel, listener)
  return () => {
    ipcRenderer.removeListener(channel, listener)
  }
}

contextBridge.exposeInMainWorld('shell', api)

export type ShellApi = typeof api
