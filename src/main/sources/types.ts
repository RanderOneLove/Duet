import type { Account, Album, Playlist, SearchResult, ServiceId, Track } from '@shared/domain'

/**
 * One music service, behind an interface the screens never look past. Both
 * sources authorize by having the user sign in on the service's own site, then
 * talk to the same endpoints that service's web client uses.
 */
export interface Source {
  readonly id: ServiceId

  /** True once a stored session has been restored or a sign-in completed. */
  isConnected(): boolean
  /** Opens the service's own sign-in window; resolves when a session is held. */
  connect(): Promise<Account>
  /** Forgets the session and clears the partition's cookies. */
  disconnect(): Promise<void>
  /** Re-attach to a stored session on startup; false when it has expired. */
  restore(): Promise<Account | null>

  likedTracks(): Promise<Track[]>
  playlists(): Promise<Playlist[]>
  playlistTracks(nativeId: string): Promise<Track[]>
  albumTracks(nativeId: string): Promise<Track[]>
  /** What an artist is known for, most popular first. */
  artistTracks(nativeId: string): Promise<Track[]>
  search(query: string): Promise<SearchResult>
  /**
   * The service's personal radio — "Моя волна" on both. Returns one batch;
   * pass the native id of the last track played to continue the station rather
   * than restart it.
   */
  wave(afterNativeId?: string): Promise<Track[]>
  setLiked(track: Track, liked: boolean): Promise<void>

  /**
   * A playable url for the track. Both services hand out short-lived links, so
   * this is called at play time and never cached in the catalogue.
   */
  streamUrl(track: Track): Promise<string>
}

/** Raised when a session is gone, so the UI can prompt to reconnect. */
export class SessionExpiredError extends Error {
  constructor(public readonly service: ServiceId) {
    super('Сессия истекла — войдите в сервис заново')
    this.name = 'SessionExpiredError'
  }
}

export interface AlbumWithTracks extends Album {
  tracks: Track[]
}
