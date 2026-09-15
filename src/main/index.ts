import { app, BrowserWindow, dialog, ipcMain, screen } from 'electron'
import { IPC } from '@shared/ipc'
import type { DisplayInfo, Settings } from '@shared/types'
import type {
  Connection,
  HomeSection,
  Playlist,
  SearchResult,
  ServiceId,
  Track,
  WaveChoice
} from '@shared/domain'
import type { PlayerCommand, PlayerState } from '@shared/player'
import type { DownloadsState } from '@shared/downloads'
import type { AudioEvent } from '../preload/audio'
import { getSettings, onSettingsChanged, setSettings } from './state/settings'
import { getHotkeyStatus, registerHotkeys, unregisterHotkeys } from './hotkeys'
import {
  command,
  getPlayer,
  handleAudioEvent,
  initPlayer,
  onPlayerChanged,
  restoreSession,
  createPlayerWire
} from './player/engine'
import {
  albumTracks,
  artistTracks,
  connectSource,
  disconnectSource,
  disposeSources,
  getConnections,
  home,
  likedTracks,
  lyrics,
  onConnectionsChanged,
  onLibraryChanged,
  playlists,
  playlistTracks,
  restoreSources,
  search,
  setLiked,
  similarTracks,
  wave
} from './sources/registry'
import { createTray, destroyTray } from './tray'
import {
  addDownloads,
  getDownloads,
  loadDownloads,
  onDownloadsChanged,
  openDownloadsFolder,
  removeDownload,
  retryDownload
} from './downloads/manager'
import { registerMediaScheme, serveMediaScheme } from './downloads/protocol'
import { claimJoinScheme, joinCodeFrom, offerJoinCode, onJoinRequest } from './together/join'
import { ensureInvite, publish } from './together/host'
import {
  addToPlaylist,
  createPlaylist,
  loadPlaylists,
  onPlaylistsChanged,
  removeFromPlaylist,
  removePlaylist,
  renamePlaylist
} from './library/playlists'
import {
  createMainWindow,
  getMainWindow,
  hideMainWindow,
  isQuitting,
  markQuitting,
  sendToShell,
  showMainWindow
} from './windows/mainWindow'
import { createAudioHost, destroyAudioHost } from './windows/audioHost'
import { destroyMiniPlayer, hideMiniPlayer, resizeMiniPlayer, showMiniPlayer, toggleMiniPlayer } from './windows/miniPlayer'
import { initDiscordRPC } from './discord'

// A second launch should surface the running app, not start a rival instance
// that fights over the tray icon and the global shortcuts.
registerMediaScheme()

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  // A `duet://join/...` link opens a second copy; Windows puts the link in its
  // arguments, and that copy hands them here before quitting.
  app.on('second-instance', (_event, argv) => {
    showMainWindow()
    offerJoinCode(joinCodeFrom(argv))
  })
  void app.whenReady().then(start)
}

// Shim for @toil/vk-audio library bug
if (!('isError' in Error)) {
  ;(Error as any).isError = (err: any) => err instanceof Error
}

function start(): void {
  app.setAppUserModelId('com.rednikin.duet')
  app.setName('Duet')

  const settings = getSettings()
  applyAutoStart(settings)

  // Started by Windows with --hidden: go straight to the tray.
  const startHidden =
    process.argv.includes('--hidden') ||
    (app.getLoginItemSettings().wasOpenedAtLogin && settings.autoStartMinimized)

  claimJoinScheme()
  serveMediaScheme()
  void loadDownloads()
  void loadPlaylists()

  const window = createMainWindow({ startHidden })
  createAudioHost()
  createTray()
  registerIpc()
  initPlayer(settings.volume, settings.muted)
  initDiscordRPC()

  // Hiding to the tray is exactly when the mini player earns its keep.
  window.on('hide', () => {
    if (getSettings().miniOnMinimize) showMiniPlayer()
  })
  window.on('minimize', () => {
    if (getSettings().miniOnMinimize) showMiniPlayer()
  })
  window.on('show', hideMiniPlayer)
  window.on('restore', hideMiniPlayer)

  const toShell = createPlayerWire()
  // Приглашение может прийти и до того, как окно готово: тогда оно ждёт здесь.
  onJoinRequest((code) => {
    showMainWindow()
    void command({ type: 'follow', code })
  })

  onPlayerChanged((state) => {
    sendToShell(IPC.playerState, toShell(state))
    // Ведомым нужно знать, что здесь играет, — если публикация включена.
    void publish(state)
    // Volume survives restarts; the rest of the state is deliberately not kept.
    persistVolume(state)
  })
  onConnectionsChanged((connections) => sendToShell(IPC.sourceConnectionsChanged, connections))
  onLibraryChanged(() => sendToShell(IPC.libChanged, undefined))
  onPlaylistsChanged(() => sendToShell(IPC.libChanged, undefined))
  onDownloadsChanged((state) => sendToShell(IPC.downloadsChanged, state))

  offerJoinCode(joinCodeFrom(process.argv))

  void restoreSources().then(async () => {
    await restoreSession()
    // Read the library now rather than when a screen first asks for it: the
    // walk takes seconds, and doing it during startup means Home and Liked
    // open on a list that is already in hand.
    await likedTracks().catch(() => undefined)
  })

  sendToShell(IPC.hotkeyStatus, registerHotkeys(settings))
  let previous = settings
  onSettingsChanged((next) => {
    // Приглашение нужно уже в настройках, а не с первой сыгранной секундой.
    if (next.listenTogether && !next.togetherCode) ensureInvite()
    if (hotkeysChanged(previous, next)) sendToShell(IPC.hotkeyStatus, registerHotkeys(next))
    if (next.autoStart !== previous.autoStart || next.autoStartMinimized !== previous.autoStartMinimized) {
      applyAutoStart(next)
    }
    previous = next
  })

  // Nothing is shown yet when we start hidden, so the mini player stands in.
  if (startHidden && settings.miniOnMinimize) showMiniPlayer()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow()
    else showMainWindow()
  })
}

function registerIpc(): void {
  // ---- player ----
  ipcMain.handle(IPC.playerGet, (): PlayerState => getPlayer())
  ipcMain.on(IPC.playerCommand, (_event, input: PlayerCommand) => void command(input))
  ipcMain.on(IPC.audioEvent, (_event, event: AudioEvent) => handleAudioEvent(event))

  // ---- sources ----
  ipcMain.handle(IPC.sourceConnections, (): Connection[] => getConnections())
  ipcMain.handle(IPC.sourceConnect, async (_event, id: ServiceId) => {
    await connectSource(id)
    return getConnections()
  })
  ipcMain.handle(IPC.sourceDisconnect, async (_event, id: ServiceId) => {
    await disconnectSource(id)
    return getConnections()
  })

  // ---- catalogue ----
  ipcMain.handle(IPC.libHome, (): Promise<HomeSection[]> => home())
  ipcMain.handle(IPC.libLiked, (): Promise<Track[]> => likedTracks())
  ipcMain.handle(IPC.libPlaylists, (): Promise<Playlist[]> => playlists())
  ipcMain.handle(IPC.libPlaylistTracks, (_event, service: ServiceId | null, nativeId: string): Promise<Track[]> =>
    playlistTracks(service, nativeId)
  )
  ipcMain.handle(IPC.libAlbumTracks, (_event, service: ServiceId, nativeId: string): Promise<Track[]> =>
    albumTracks(service, nativeId)
  )
  ipcMain.handle(IPC.libArtistTracks, (_event, service: ServiceId, nativeId: string): Promise<Track[]> =>
    artistTracks(service, nativeId)
  )
  ipcMain.handle(IPC.libLocalCreate, (_event, title: string, tracks: Track[]): Promise<string> =>
    createPlaylist(title, tracks)
  )
  ipcMain.handle(IPC.libLocalRename, (_event, id: string, title: string) => renamePlaylist(id, title))
  ipcMain.handle(IPC.libLocalRemove, (_event, id: string) => removePlaylist(id))
  ipcMain.handle(IPC.libLocalAdd, (_event, id: string, tracks: Track[]) => addToPlaylist(id, tracks))
  ipcMain.handle(IPC.libLocalRemoveTrack, (_event, id: string, trackId: string) =>
    removeFromPlaylist(id, trackId)
  )
  ipcMain.handle(IPC.libSimilar, (_event, track: Track): Promise<Track[]> => similarTracks(track))
  ipcMain.handle(IPC.libLyrics, (_event, track: Track): Promise<string | null> => lyrics(track))
  ipcMain.handle(IPC.libSearch, (_event, query: string): Promise<SearchResult> => search(query))
  ipcMain.handle(IPC.libWave, (_event, choice: WaveChoice): Promise<Track[]> => wave(choice))
  ipcMain.handle(IPC.libSetLiked, async (_event, track: Track, liked: boolean) => {
    await setLiked(track, liked)
  })

  // ---- downloads ----
  ipcMain.handle(IPC.downloadsGet, (): DownloadsState => getDownloads())
  ipcMain.handle(IPC.downloadsAdd, (_event, tracks: Track[]) => addDownloads(tracks))
  ipcMain.handle(IPC.downloadsRemove, (_event, trackId: string) => removeDownload(trackId))
  ipcMain.handle(IPC.downloadsRetry, (_event, trackId: string) => retryDownload(trackId))
  ipcMain.handle(IPC.downloadsOpenFolder, () => openDownloadsFolder())
  ipcMain.handle(IPC.downloadsPickFolder, async (): Promise<string | null> => {
    const window = getMainWindow()
    const result = window
      ? await dialog.showOpenDialog(window, {
          title: 'Папка для скачанной музыки',
          defaultPath: getSettings().downloadsPath ?? undefined,
          properties: ['openDirectory', 'createDirectory']
        })
      : { canceled: true, filePaths: [] as string[] }
    if (result.canceled || !result.filePaths[0]) return null
    // Files already on disk keep their recorded paths, so nothing is lost.
    setSettings({ downloadsPath: result.filePaths[0] })
    return result.filePaths[0]
  })

  // ---- settings / system ----
  ipcMain.handle(IPC.settingsGet, (): Settings => getSettings())
  ipcMain.handle(IPC.settingsSet, (_event, patch: Partial<Settings>): Settings => setSettings(patch))
  ipcMain.handle(IPC.hotkeyStatus, () => getHotkeyStatus())
  ipcMain.handle(IPC.appInfo, () => ({ name: app.getName(), version: app.getVersion() }))
  ipcMain.handle(IPC.displaysGet, (): DisplayInfo[] => {
    const primary = screen.getPrimaryDisplay()
    return screen.getAllDisplays().map((display, index) => ({
      id: display.id,
      label: display.label || `Дисплей ${index + 1}`,
      bounds: display.bounds,
      isPrimary: display.id === primary.id
    }))
  })

  // ---- mini player ----
  ipcMain.on(IPC.miniResize, (_event, size: { width: number; height: number }) =>
    resizeMiniPlayer(size.width, size.height)
  )
  ipcMain.on(IPC.miniToggle, toggleMiniPlayer)
  ipcMain.on(IPC.miniRestoreMain, () => {
    hideMiniPlayer()
    showMainWindow()
  })

  // ---- window ----
  ipcMain.on(IPC.windowMinimize, () => getMainWindow()?.minimize())
  ipcMain.on(IPC.windowMaximizeToggle, () => {
    const target = getMainWindow()
    if (!target) return
    if (target.isMaximized()) target.unmaximize()
    else target.maximize()
  })
  ipcMain.on(IPC.windowHideToTray, hideMainWindow)
}

/** Persist volume changes, but not on every progress tick. */
let lastVolume = -1
let lastMuted: boolean | null = null
function persistVolume(state: PlayerState): void {
  if (state.volume === lastVolume && state.muted === lastMuted) return
  lastVolume = state.volume
  lastMuted = state.muted
  setSettings({ volume: state.volume, muted: state.muted })
}

/**
 * Register or clear the Windows login item. In development this points at the
 * Electron binary rather than an installed Duet.exe, which is expected.
 */
function applyAutoStart(settings: Settings): void {
  app.setLoginItemSettings({
    openAtLogin: settings.autoStart,
    path: process.execPath,
    args: settings.autoStartMinimized ? ['--hidden'] : []
  })
}

function hotkeysChanged(a: Settings, b: Settings): boolean {
  return (
    a.hotkeyPlayPause !== b.hotkeyPlayPause ||
    a.hotkeyNext !== b.hotkeyNext ||
    a.hotkeyPrev !== b.hotkeyPrev ||
    a.hotkeyToggleMini !== b.hotkeyToggleMini
  )
}

app.on('before-quit', () => {
  markQuitting()
  unregisterHotkeys()
  destroyMiniPlayer()
  destroyAudioHost()
  destroyTray()
  disposeSources()
})

// The app lives in the tray, so closing every window must not end the process.
app.on('window-all-closed', () => {
  if (isQuitting() && process.platform !== 'darwin') app.quit()
})
