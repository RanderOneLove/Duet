import type { Account, Playlist, SearchResult, Track } from '@shared/domain'
import { trackKey } from '@shared/domain'
import { getSecret, setSecret } from '../../state/secrets'
import { SessionExpiredError, type Source } from '../types'
import { YandexApi, type YandexTrack } from './api'
import { clearSession, signIn } from './auth'

/** How long the cached library stays good before it is read again. */
const LIKED_TTL_MS = 5 * 60 * 1000

const TOKEN_KEY = 'yandex.token'
const UID_KEY = 'yandex.uid'

/** Яндекс.Музыка as a catalogue source. */
export class YandexSource implements Source {
  readonly id = 'yandex' as const

  private api: YandexApi | null = null
  /** The whole library, so opening a screen does not re-read it. */
  private liked: { at: number; tracks: Track[] } | null = null
  /** A read already under way; a second caller waits on it instead of starting its own. */
  private likedInFlight: Promise<Track[]> | null = null
  private uid: string | null = null
  private account: Account | null = null

  isConnected(): boolean {
    return this.api !== null && this.uid !== null
  }

  async restore(): Promise<Account | null> {
    const token = getSecret(TOKEN_KEY)
    if (!token) return null
    try {
      return await this.adopt(token)
    } catch {
      // An expired token is not an error at startup — just an unconnected service.
      return null
    }
  }

  async connect(): Promise<Account> {
    const token = await signIn()
    const account = await this.adopt(token)
    setSecret(TOKEN_KEY, token)
    return account
  }

  async disconnect(): Promise<void> {
    setSecret(TOKEN_KEY, null)
    setSecret(UID_KEY, null)
    this.api = null
    this.uid = null
    this.liked = null
    this.account = null
    await clearSession()
  }

  /**
   * The whole library, cached the same way VK's is. Home and the Liked tab ask
   * for it separately, and a couple of thousand tracks is two round trips —
   * without this, every visit to either screen paid for them again.
   */
  async likedTracks(): Promise<Track[]> {
    const { api, uid } = this.require()
    if (this.liked && Date.now() - this.liked.at < LIKED_TTL_MS) return this.liked.tracks
    if (this.likedInFlight) return this.likedInFlight

    this.likedInFlight = (async () => {
      const ids = await api.likedTrackIds(uid)
      const raw = await api.tracks(ids)
      return raw.map((track) => this.toDomain(track, true))
    })()
      .then((tracks) => {
        this.liked = { at: Date.now(), tracks }
        return tracks
      })
      .finally(() => {
        this.likedInFlight = null
      })
    return this.likedInFlight
  }

  async playlists(): Promise<Playlist[]> {
    const { api, uid } = this.require()
    const list = await api.playlists(uid)
    return list.map((raw) => ({
      id: `yandex:${uid}:${raw.kind}`,
      service: 'yandex' as const,
      // playlistTracks needs both halves, so the owner travels in the id.
      nativeId: `${uid}:${raw.kind}`,
      title: raw.title,
      description: null,
      trackCount: raw.trackCount,
      coverUrl: raw.coverUrl
    }))
  }

  async playlistTracks(nativeId: string): Promise<Track[]> {
    const { api } = this.require()
    const [owner, kind] = nativeId.split(':')
    const tracks = await api.playlistTracks(owner, kind)
    return tracks.map((track) => this.toDomain(track, false))
  }

  async albumTracks(nativeId: string): Promise<Track[]> {
    const { api } = this.require()
    const tracks = await api.albumTracks(nativeId)
    return tracks.map((track) => this.toDomain(track, false))
  }

  async artistTracks(nativeId: string): Promise<Track[]> {
    const { api } = this.require()
    const tracks = await api.artistTracks(nativeId)
    return tracks.map((track) => this.toDomain(track, false))
  }

  async search(query: string): Promise<SearchResult> {
    const { api } = this.require()
    const found = await api.search(query)
    return {
      tracks: found.tracks.map((track) => this.toDomain(track, false)),
      albums: found.albums.map((album) => ({
        id: `yandex:${album.id}`,
        service: 'yandex' as const,
        nativeId: album.id,
        title: album.title,
        artists: album.artists,
        year: album.year,
        coverUrl: album.coverUrl
      })),
      artists: found.artists.map((artist) => ({
        id: `yandex:${artist.id}`,
        service: 'yandex' as const,
        nativeId: artist.id,
        name: artist.name,
        coverUrl: artist.coverUrl
      })),
      playlists: found.playlists.map((playlist) => ({
        id: `yandex:${playlist.uid}:${playlist.kind}`,
        service: 'yandex' as const,
        nativeId: `${playlist.uid}:${playlist.kind}`,
        title: playlist.title,
        description: null,
        trackCount: playlist.trackCount,
        coverUrl: playlist.coverUrl
      }))
    }
  }

  async wave(afterNativeId?: string): Promise<Track[]> {
    const { api } = this.require()
    const tracks = await api.wave(afterNativeId)
    return tracks.map((track) => this.toDomain(track, false))
  }

  async lyrics(track: Track): Promise<string | null> {
    const { api } = this.require()
    return api.lyrics(track.nativeId)
  }

  async setLiked(track: Track, liked: boolean): Promise<void> {
    const { api, uid } = this.require()
    await api.setLiked(uid, track.nativeId, liked)

    // Patch the cache rather than dropping it, so a like shows up at once
    // without re-reading the whole library.
    if (this.liked) {
      const without = this.liked.tracks.filter((item) => item.id !== track.id)
      this.liked.tracks = liked ? [{ ...track, liked: true }, ...without] : without
    }
  }

  async streamUrl(track: Track): Promise<string> {
    const { api } = this.require()
    return api.streamUrl(track.nativeId)
  }

  getAccount(): Account | null {
    return this.account
  }

  /** Adopt a token: verify it and remember who it belongs to. */
  private async adopt(token: string): Promise<Account> {
    const api = new YandexApi(token)
    const status = await api.accountStatus()
    this.api = api
    this.uid = status.uid
    this.account = { displayName: status.displayName, avatarUrl: status.avatarUrl }
    setSecret(UID_KEY, status.uid)
    return this.account
  }

  private require(): { api: YandexApi; uid: string } {
    if (!this.api || !this.uid) throw new SessionExpiredError('yandex')
    return { api: this.api, uid: this.uid }
  }

  private toDomain(track: YandexTrack, liked: boolean): Track {
    return {
      id: trackKey('yandex', track.id),
      service: 'yandex',
      nativeId: track.id,
      title: track.title,
      artists: track.artists,
      artistRefs: track.artistRefs,
      album: track.album,
      albumId: track.albumId,
      durationMs: track.durationMs,
      coverUrl: track.coverUrl,
      liked,
      available: track.available
    }
  }
}
