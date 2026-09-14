/**
 * Every IPC channel name in one place. Nothing may hardcode these strings
 * inline — a typo in a channel name fails silently at runtime.
 */
export const IPC = {
  // ---- player (main owns the queue and the state) ----
  /** main → shell/mini: the whole PlayerState. */
  playerState: 'player:state',
  /** shell/mini/tray → main: a PlayerCommand. */
  playerCommand: 'player:command',
  /** shell/mini → main: pull the current state on mount. */
  playerGet: 'player:get',

  // ---- audio host (the hidden window that actually plays sound) ----
  /** main → host: load a stream url and start at an offset. */
  audioLoad: 'audio:load',
  /** main → host: transport that maps straight onto the media element. */
  audioControl: 'audio:control',
  /** host → main: playback progress, end of track, decode failures. */
  audioEvent: 'audio:event',

  // ---- sources ----
  /** shell → main: open the service's own sign-in window. */
  sourceConnect: 'source:connect',
  sourceDisconnect: 'source:disconnect',
  /** shell → main: current per-service Connection[]. */
  sourceConnections: 'source:connections',
  /** main → shell: connections changed (sign-in finished, token expired). */
  sourceConnectionsChanged: 'source:connectionsChanged',

  /** shell → main: catalogue queries, all returning domain objects. */
  libHome: 'lib:home',
  libLiked: 'lib:liked',
  libPlaylists: 'lib:playlists',
  libPlaylistTracks: 'lib:playlistTracks',
  libArtistTracks: 'lib:artistTracks',
  libLocalCreate: 'lib:localCreate',
  libLocalRename: 'lib:localRename',
  libLocalRemove: 'lib:localRemove',
  libLocalAdd: 'lib:localAdd',
  libLocalRemoveTrack: 'lib:localRemoveTrack',
  libAlbumTracks: 'lib:albumTracks',
  libSearch: 'lib:search',
  libWave: 'lib:wave',
  /** main → shell: the catalogue changed; re-read the lists. */
  libChanged: 'lib:changed',
  libSetLiked: 'lib:setLiked',

  // ---- downloads ----
  downloadsGet: 'downloads:get',
  downloadsAdd: 'downloads:add',
  downloadsRemove: 'downloads:remove',
  downloadsRetry: 'downloads:retry',
  downloadsOpenFolder: 'downloads:openFolder',
  downloadsPickFolder: 'downloads:pickFolder',
  /** main → shell: the index or a progress figure changed. */
  downloadsChanged: 'downloads:changed',

  // ---- settings ----
  settingsGet: 'settings:get',
  settingsSet: 'settings:set',
  settingsChanged: 'settings:changed',

  // ---- mini player ----
  miniResize: 'mini:resize',
  /** main → mini: the cursor entered or left the window. */
  miniHover: 'mini:hover',
  miniToggle: 'mini:toggle',
  miniRestoreMain: 'mini:restoreMain',

  // ---- window / system ----
  displaysGet: 'displays:get',
  /** shell → main: name and version for the About pane. */
  appInfo: 'app:info',
  hotkeyStatus: 'hotkeys:status',
  windowMinimize: 'window:minimize',
  windowMaximizeToggle: 'window:maximizeToggle',
  windowHideToTray: 'window:hideToTray'
} as const

export type IpcChannel = (typeof IPC)[keyof typeof IPC]
