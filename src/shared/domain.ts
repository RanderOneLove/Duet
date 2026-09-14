/** The music domain, shared by every source and every screen. */

export type ServiceId = 'yandex' | 'vk'

export const SERVICE_META: Record<ServiceId, { label: string; short: string }> = {
  yandex: { label: 'Яндекс.Музыка', short: 'YA' },
  vk: { label: 'VK Музыка', short: 'VK' }
}

/**
 * Ids are always source-scoped (`yandex:12345`), because the two services
 * number their catalogues independently and screens mix them in one list.
 */
export type TrackId = string

export interface Track {
  id: TrackId
  service: ServiceId
  /** The id as the service itself knows it, for API calls. */
  nativeId: string
  title: string
  artists: string[]
  /**
   * The same artists with the service's own ids, where the service gave them —
   * enough to open an artist page. Empty when it did not, in which case the
   * names stay plain text rather than dead links.
   */
  artistRefs: ArtistRef[]
  album: string | null
  albumId: string | null
  durationMs: number
  coverUrl: string | null
  liked: boolean
  /** false when the service lists the track but will not stream it. */
  available: boolean
}

/**
 * Which personal radio to play: one service's, or both woven together. "Both"
 * is not a joint recommender — neither service knows about the other — it is
 * two stations taken in turns, with the duplicates that causes removed.
 */
export type WaveChoice = ServiceId | 'both'

export interface ArtistRef {
  nativeId: string
  name: string
}

export interface Playlist {
  id: string
  service: ServiceId
  nativeId: string
  title: string
  description: string | null
  trackCount: number
  coverUrl: string | null
}

export interface Album {
  id: string
  service: ServiceId
  nativeId: string
  title: string
  artists: string[]
  year: number | null
  coverUrl: string | null
}

export interface Artist {
  id: string
  service: ServiceId
  nativeId: string
  name: string
  coverUrl: string | null
}

export interface SearchResult {
  tracks: Track[]
  albums: Album[]
  artists: Artist[]
  playlists: Playlist[]
}

export const EMPTY_SEARCH: SearchResult = { tracks: [], albums: [], artists: [], playlists: [] }

/** A titled block on Home. `service: null` means it mixes both services. */
export interface HomeSection {
  id: string
  service: ServiceId | null
  title: string
  kind: 'playlists' | 'albums' | 'tracks'
  playlists?: Playlist[]
  albums?: Album[]
  tracks?: Track[]
}

export interface Account {
  displayName: string
  avatarUrl: string | null
}

/** Per-service connection state, as shown on Connect and in Settings. */
export interface Connection {
  service: ServiceId
  connected: boolean
  account: Account | null
  /** Set when the last call failed, so screens can show 2m's error state. */
  error: string | null
}

export function trackKey(service: ServiceId, nativeId: string): TrackId {
  return `${service}:${nativeId}`
}

/** "Artist A, Artist B" — the line shown under every title. */
export function artistLine(track: Pick<Track, 'artists'>): string {
  return track.artists.filter(Boolean).join(', ')
}
