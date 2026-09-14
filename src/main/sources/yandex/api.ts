import { createHash, createHmac } from 'node:crypto'
import { SessionExpiredError } from '../types'

/**
 * Client for the endpoints the Яндекс.Музыка apps use. The API is not
 * documented publicly; shapes here are defensive — every field is read through
 * a guard so a server-side change degrades one row instead of throwing.
 */

const BASE = 'https://api.music.yandex.net'

/** Sent by the official mobile client; some endpoints 400 without it. */
const CLIENT_HEADER = 'YandexMusicAndroid/24023621'

export interface YandexTrack {
  id: string
  title: string
  artists: string[]
  artistRefs: { nativeId: string; name: string }[]
  album: string | null
  albumId: string | null
  durationMs: number
  coverUrl: string | null
  available: boolean
}

export class YandexApi {
  constructor(private token: string) {}

  setToken(token: string): void {
    this.token = token
  }

  async accountStatus(): Promise<{ uid: string; displayName: string; avatarUrl: string | null }> {
    const data = await this.get<Record<string, any>>('/account/status')
    const account = data?.account ?? {}
    const uid = String(account.uid ?? '')
    if (!uid) throw new SessionExpiredError('yandex')
    return {
      uid,
      displayName: String(account.displayName || account.login || 'Яндекс'),
      avatarUrl: account.avatarUrl ? `https://avatars.yandex.net/get-yapic/${account.avatarUrl}/islands-200` : null
    }
  }

  /** Liked track ids, newest first — the ids alone, as the API returns them. */
  async likedTrackIds(uid: string): Promise<string[]> {
    const data = await this.get<Record<string, any>>(`/users/${uid}/likes/tracks`)
    const list = data?.library?.tracks ?? []
    return asArray(list)
      .map((item: any) => (item?.albumId ? `${item.id}:${item.albumId}` : String(item?.id ?? '')))
      .filter(Boolean)
  }

  /** Hydrate ids into full tracks. The endpoint takes a POST form, not a query. */
  async tracks(ids: string[]): Promise<YandexTrack[]> {
    if (ids.length === 0) return []
    const out: YandexTrack[] = []
    // The endpoint rejects very long id lists, so hydrate in pages.
    for (let i = 0; i < ids.length; i += 250) {
      const body = new URLSearchParams()
      body.set('trackIds', ids.slice(i, i + 250).join(','))
      body.set('withPositions', 'false')
      const data = await this.post<any[]>('/tracks', body)
      for (const raw of asArray(data)) {
        const track = toTrack(raw)
        if (track) out.push(track)
      }
    }
    return out
  }

  async playlists(uid: string): Promise<{ kind: string; title: string; trackCount: number; coverUrl: string | null }[]> {
    const data = await this.get<any[]>(`/users/${uid}/playlists/list`)
    return asArray(data).map((raw: any) => ({
      kind: String(raw?.kind ?? ''),
      title: String(raw?.title ?? 'Плейлист'),
      trackCount: Number(raw?.trackCount ?? 0),
      coverUrl: coverFrom(raw?.cover)
    }))
  }

  async playlistTracks(uid: string, kind: string): Promise<YandexTrack[]> {
    const data = await this.get<Record<string, any>>(`/users/${uid}/playlists/${kind}`)
    // Entries wrap the track, and unavailable ones may carry no track at all.
    return asArray(data?.tracks)
      .map((entry: any) => toTrack(entry?.track ?? entry))
      .filter((track): track is YandexTrack => track !== null)
  }

  async albumTracks(albumId: string): Promise<YandexTrack[]> {
    const data = await this.get<Record<string, any>>(`/albums/${albumId}/with-tracks`)
    // volumes is an array of discs, each an array of tracks.
    return asArray(data?.volumes)
      .flatMap((volume: any) => asArray(volume))
      .map((raw: any) => toTrack(raw))
      .filter((track): track is YandexTrack => track !== null)
  }

  /** An artist's own tracks, in the order the service ranks them. */
  async artistTracks(artistId: string): Promise<YandexTrack[]> {
    const data = await this.get<Record<string, any>>(`/artists/${artistId}/tracks?page=0&page-size=100`)
    return asArray(data?.tracks)
      .map((raw: any) => toTrack(raw))
      .filter((track): track is YandexTrack => track !== null)
  }

  async search(query: string): Promise<{
    tracks: YandexTrack[]
    albums: { id: string; title: string; artists: string[]; year: number | null; coverUrl: string | null }[]
    artists: { id: string; name: string; coverUrl: string | null }[]
    playlists: { uid: string; kind: string; title: string; trackCount: number; coverUrl: string | null }[]
  }> {
    const params = new URLSearchParams({ text: query, type: 'all', page: '0', nocorrect: 'false' })
    const data = await this.get<Record<string, any>>(`/search?${params}`)

    return {
      tracks: asArray(data?.tracks?.results)
        .map((raw: any) => toTrack(raw))
        .filter((track): track is YandexTrack => track !== null),
      albums: asArray(data?.albums?.results).map((raw: any) => ({
        id: String(raw?.id ?? ''),
        title: String(raw?.title ?? ''),
        artists: artistNames(raw?.artists),
        year: raw?.year ? Number(raw.year) : null,
        coverUrl: coverFrom(raw?.coverUri)
      })),
      artists: asArray(data?.artists?.results).map((raw: any) => ({
        id: String(raw?.id ?? ''),
        name: String(raw?.name ?? ''),
        coverUrl: coverFrom(raw?.cover)
      })),
      playlists: asArray(data?.playlists?.results).map((raw: any) => ({
        uid: String(raw?.owner?.uid ?? ''),
        kind: String(raw?.kind ?? ''),
        title: String(raw?.title ?? ''),
        trackCount: Number(raw?.trackCount ?? 0),
        coverUrl: coverFrom(raw?.cover)
      }))
    }
  }

  /**
   * "Моя волна" — the personal rotor station. The response is a sequence of
   * wrapped tracks rather than a plain list.
   */
  async wave(afterId?: string): Promise<YandexTrack[]> {
    const params = new URLSearchParams({ settings2: 'true' })
    // Without `queue` the rotor keeps handing back the same opening batch.
    if (afterId) params.set('queue', afterId)
    const data = await this.get<Record<string, any>>(`/rotor/station/user:onyourwave/tracks?${params}`)
    return asArray(data?.sequence)
      .map((item: any) => toTrack(item?.track))
      .filter((track): track is YandexTrack => track !== null)
  }

  /**
   * Lyrics come back as a link to plain text, and the endpoint refuses an
   * unsigned request — the signature is an HMAC of the track and the moment
   * asked for, the same one the mobile client sends.
   */
  async lyrics(trackId: string): Promise<string | null> {
    const stamp = Math.floor(Date.now() / 1000)
    const sign = createHmac('sha256', LYRICS_SALT).update(`${trackId}${stamp}`).digest('base64')
    try {
      const data = await this.get<Record<string, any>>(
        `/tracks/${trackId}/lyrics?format=TEXT&timeStamp=${stamp}&sign=${encodeURIComponent(sign)}`
      )
      if (!data?.downloadUrl) return null
      const response = await fetch(String(data.downloadUrl))
      if (!response.ok) return null
      const text = (await response.text()).trim()
      return text || null
    } catch {
      // No lyrics for this track is the ordinary case, not a failure.
      return null
    }
  }

  async setLiked(uid: string, trackId: string, liked: boolean): Promise<void> {
    const action = liked ? 'add-multiple' : 'remove'
    const body = new URLSearchParams({ 'track-ids': trackId })
    await this.post(`/users/${uid}/likes/tracks/${action}`, body)
  }

  /**
   * Resolve a playable url. Two hops: ask for the available downloads, then
   * fetch the chosen one's descriptor and sign it. Links expire within minutes,
   * so this runs at play time.
   */
  async streamUrl(trackId: string): Promise<string> {
    const infos = await this.get<any[]>(`/tracks/${trackId}/download-info`)
    const list = asArray(infos).filter((info: any) => info?.downloadInfoUrl)
    if (list.length === 0) throw new Error('Яндекс не отдал ссылку на трек')

    // Prefer mp3 at the highest offered bitrate.
    const best = list
      .filter((info: any) => !info.codec || info.codec === 'mp3')
      .sort((a: any, b: any) => Number(b?.bitrateInKbps ?? 0) - Number(a?.bitrateInKbps ?? 0))[0] ?? list[0]

    const response = await fetch(`${best.downloadInfoUrl}&format=json`, { headers: this.headers() })
    if (!response.ok) throw new Error(`Яндекс: ошибка ${response.status} при получении ссылки`)
    const descriptor = (await response.json()) as { host?: string; path?: string; ts?: string; s?: string }
    if (!descriptor.host || !descriptor.path || !descriptor.ts || !descriptor.s) {
      throw new Error('Яндекс вернул неполный ответ на запрос ссылки')
    }

    const sign = createHash('md5')
      .update(SIGN_SALT + descriptor.path.slice(1) + descriptor.s)
      .digest('hex')
    return `https://${descriptor.host}/get-mp3/${sign}/${descriptor.ts}${descriptor.path}`
  }

  // ---- transport ----

  private headers(): Record<string, string> {
    return {
      Authorization: `OAuth ${this.token}`,
      'X-Yandex-Music-Client': CLIENT_HEADER,
      Accept: 'application/json'
    }
  }

  private async get<T>(path: string): Promise<T> {
    return this.request<T>(path, { method: 'GET' })
  }

  private async post<T>(path: string, body: URLSearchParams): Promise<T> {
    return this.request<T>(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body
    })
  }

  private async request<T>(path: string, init: RequestInit): Promise<T> {
    const response = await fetch(`${BASE}${path}`, {
      ...init,
      headers: { ...this.headers(), ...(init.headers as Record<string, string> | undefined) }
    })

    if (response.status === 401 || response.status === 403) throw new SessionExpiredError('yandex')
    if (!response.ok) throw new Error(`Яндекс.Музыка: ошибка ${response.status}`)

    const payload = (await response.json()) as { result?: T; error?: { message?: string } }
    if (payload?.error) throw new Error(payload.error.message || 'Яндекс.Музыка вернула ошибку')
    return payload.result as T
  }
}

/** Long-standing signing salt for Yandex Music download links. */
const SIGN_SALT = 'XGRlBW9FXlekgbPrRHuSiA'

/** Signing key for the lyrics endpoint, which uses its own. */
const LYRICS_SALT = 'p93jhgh689SBReK6ghtw62'

function toTrack(raw: any): YandexTrack | null {
  const id = String(raw?.id ?? raw?.trackId ?? '')
  if (!id) return null
  const album = asArray(raw?.albums)[0]
  return {
    id: id.includes(':') ? id.split(':')[0] : id,
    title: String(raw?.title ?? 'Без названия'),
    artists: artistNames(raw?.artists),
    artistRefs: artistRefs(raw?.artists),
    album: album?.title ? String(album.title) : null,
    albumId: album?.id ? String(album.id) : null,
    durationMs: Number(raw?.durationMs ?? 0),
    coverUrl: coverFrom(raw?.coverUri ?? album?.coverUri),
    // `available` missing means available; only an explicit false hides a track.
    available: raw?.available !== false
  }
}

function artistNames(raw: unknown): string[] {
  return asArray(raw)
    .map((artist: any) => String(artist?.name ?? ''))
    .filter(Boolean)
}

/** Only artists the service identified; an unnamed or id-less one is dropped. */
function artistRefs(raw: unknown): { nativeId: string; name: string }[] {
  return asArray(raw)
    .map((artist: any) => ({ nativeId: String(artist?.id ?? ''), name: String(artist?.name ?? '') }))
    .filter((artist) => artist.nativeId && artist.name)
}

/**
 * Yandex cover uris end in `%%`, a placeholder for the requested size.
 * `cover` objects carry the uri one level down.
 */
function coverFrom(raw: any): string | null {
  const uri = typeof raw === 'string' ? raw : raw?.uri
  if (!uri) return null
  return `https://${String(uri).replace('%%', '400x400')}`
}

function asArray(value: unknown): any[] {
  return Array.isArray(value) ? value : []
}
