import type { Account, Album, Lyrics, Playlist, SearchResult, ServiceId, Track } from '@shared/domain'

/**
 * One music service, behind an interface the screens never look past. Both
 * sources authorize by having the user sign in on the service's own site, then
 * talk to the same endpoints that service's web client uses.
 */
/** What can happen to a radio track, in the words the station understands. */
export type WaveEvent = 'radioStarted' | 'trackStarted' | 'trackFinished' | 'skip'

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
  /**
   * Последняя выданная станцией порция — без обращения к сервису.
   *
   * Станция устроена так, что любой запрос её двигает: спросил треки — она
   * считает их выданными. Поэтому показывать «что дальше» на Главной запросом
   * нельзя: экран съедал бы очередь у плеера. Здесь лежит то, что уже
   * спрашивали, и показ обходится этим.
   */
  lastWave(): Track[]
  /**
   * Взять порцию заранее — чтобы Главной было что показать.
   *
   * Отличается от `wave` обещанием: взятое здесь не пропадает, а достаётся
   * плееру, когда тот попросит. Иначе показ отнимал бы у станции по порции на
   * каждый запуск, а показанное «далее» никогда бы не заиграло.
   */
  prefetchWave(afterNativeId?: string): Promise<Track[]>
  /**
   * Report how a radio track went. Yandex's station will not advance without
   * this; VK's mix moves on its own and ignores it.
   */
  waveFeedback(event: WaveEvent, track?: Track, playedSeconds?: number): Promise<void>
  setLiked(track: Track, liked: boolean): Promise<void>
  /**
   * Сказать сервису «не нравится»: трек уходит из рекомендаций.
   *
   * Умеет не всякий сервис — у VK такого метода просто нет, — поэтому здесь и
   * признак, и действие. Кнопку, которая ничего не делает, показывать нельзя.
   */
  canDislike(): boolean
  dislike(track: Track): Promise<void>
  /** Tracks the service considers close to this one; empty when it has none. */
  similarTracks(track: Track): Promise<Track[]>
  /** The words, or null when the service has none for this track. */
  lyrics(track: Track): Promise<Lyrics | null>

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
