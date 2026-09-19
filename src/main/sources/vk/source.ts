import type { Account, Lyrics, Playlist, SearchResult, Track } from '@shared/domain'
import { trackKey } from '@shared/domain'
import { SessionExpiredError, type Source } from '../types'
import { clearSession, getAuthCookies, isSignedIn, signIn } from './bridge'
import { VKAudio } from '@toil/vk-audio'
import { VKWebClient } from '@toil/vk-audio/client'
import { forgetLists, readList, writeList } from '../../library/cache'
import { listChanged, notifyLibraryChanged } from '../../library/changed'
import type { WaveTuning } from '@shared/wave'
import { matchKey } from '../../library/match'
import { getSettings, setSettings } from '../../state/settings'


/** Items per request, and a ceiling on how many requests one listing may make. */
const PAGE_SIZE = 200
const MAX_PAGES = 60
/** Parallel audio.get requests; more than this and VK starts throttling. */
const PAGE_CONCURRENCY = 4
/** How long the cached library stays good before it is walked again. */
const LIKED_TTL_MS = 5 * 60 * 1000
/** Плейлисты меняются реже треков, поэтому и держатся дольше. */
const LISTS_TTL_MS = 10 * 60 * 1000
/**
 * Сколько отвергнутых треков помнить. Список нужен, чтобы вычёркивать их из
 * волны, а она не заглядывает на годы назад — расти ему без края незачем.
 */
const DISLIKED_KEPT = 2000
/** Сколько треков просить у станции по треку за раз. */
const WAVE_BATCH = 30

export class VkSource implements Source {
  readonly id = 'vk' as const

  private connected = false
  private account: Account | null = null
  private client: VKAudio | null = null
  private accountId: string | null = null

  isConnected(): boolean {
    return this.connected
  }

  async restore(): Promise<Account | null> {
    if (!(await isSignedIn())) return null
    return this.adopt()
  }

  async connect(): Promise<Account> {
    await signIn()
    if (!(await isSignedIn())) throw new Error('VK: вход не подтвердился')
    return this.adopt()
  }

  async disconnect(): Promise<void> {
    this.connected = false
    this.account = null
    this.client = null
    this.liked = null
    this.lists = null
    forgetLists('vk')
    await clearSession()
  }

  getAccount(): Account | null {
    return this.account
  }

  async likedTracks(): Promise<Track[]> {
    if (!this.client) throw new SessionExpiredError('vk')

    // The audio tab's default section is VK's *home page* for music: it returns
    // a few dozen recent tracks however large the account is, which made the
    // library look truncated. audio.get on the account itself is the real
    // library, and it has to be walked a page at a time.
    const fresh = this.liked && Date.now() - this.liked.at < LIKED_TTL_MS
    if (fresh) return this.liked!.tracks
    // Home and the Liked tab ask at the same moment on startup; without this
    // they would each walk the whole library.
    if (this.likedInFlight) return this.likedInFlight

    // Список с прошлого запуска отдаётся сразу, а обход уходит в фон:
    // восемнадцать страниц по двести треков — это секунды, которые иначе
    // человек смотрит на пустую Главную.
    const stored = this.liked ? null : readList<Track>('liked', 'vk')
    if (stored) {
      this.liked = { at: Date.now(), tracks: stored.items }
      this.indexLiked(stored.items)
      void this.walkLibrary(true)
      return stored.items
    }

    return this.walkLibrary(false)
  }

  /** Обойти библиотеку целиком и запомнить её — в памяти и на диске. */
  private walkLibrary(background: boolean): Promise<Track[]> {
    const known = this.liked?.tracks
    this.likedInFlight = this.pagedAudioGet({ owner_id: this.accountId || '' }, true)
      .then((tracks) => {
        this.liked = { at: Date.now(), tracks }
        this.indexLiked(tracks)
        writeList('liked', 'vk', tracks)
        // Фоновый обход никто не ждёт, поэтому об изменениях надо сказать —
        // иначе экран останется с прошлым списком до следующего запуска.
        if (background && listChanged(known, tracks)) notifyLibraryChanged()
        return tracks
      })
      .finally(() => {
        this.likedInFlight = null
      })
    return this.likedInFlight
  }

  /**
   * Плейлисты меняются редко, а запрашивались при каждом открытии Главной —
   * полсекунды сети на то, что почти всегда то же самое. Поэтому здесь тот же
   * порядок, что и с лайками: сохранённое сразу, свежее следом.
   */
  async playlists(): Promise<Playlist[]> {
    if (!this.client) throw new SessionExpiredError('vk')
    if (this.lists && Date.now() - this.lists.at < LISTS_TTL_MS) return this.lists.items

    const stored = this.lists ? null : readList<Playlist>('playlists', 'vk')
    if (stored) {
      this.lists = { at: Date.now(), items: stored.items }
      void this.readPlaylists(true)
      return stored.items
    }
    return this.readPlaylists(false)
  }

  private async readPlaylists(background: boolean): Promise<Playlist[]> {
    if (!this.client) throw new SessionExpiredError('vk')
    const known = this.lists?.items
    const data = await this.client.getSectionsWithBlocks(this.accountId || undefined)
    const items = data.playlists.map((p) => this.mapPlaylist(p))
    this.lists = { at: Date.now(), items }
    writeList('playlists', 'vk', items)
    if (background && listChanged(known, items)) notifyLibraryChanged()
    return items
  }

  async playlistTracks(nativeId: string): Promise<Track[]> {
    if (!this.client) throw new SessionExpiredError('vk')
    const [ownerId, playlistId, accessHash = ''] = nativeId.split('_')
    return this.pagedAudioGet({ owner_id: ownerId ?? '', album_id: playlistId ?? '', access_key: accessHash }, false)
  }

  /**
   * audio.get caps each response, so a long listing is read in pages. The first
   * response reports the total, which lets the remaining pages go out in
   * parallel instead of one after another.
   */
  private async pagedAudioGet(
    base: Record<string, string>,
    liked: boolean,
    method = 'audio.get'
  ): Promise<Track[]> {
    const first = await this.audioGetPage(base, 0, liked, method)
    const pages = Math.min(Math.ceil(first.total / PAGE_SIZE), MAX_PAGES)
    if (pages <= 1) return first.tracks

    const rest: Track[][] = Array.from({ length: pages - 1 }, () => [])
    let next = 1
    const worker = async (): Promise<void> => {
      for (;;) {
        const page = next
        next += 1
        if (page >= pages) return
        rest[page - 1] = (await this.audioGetPage(base, page * PAGE_SIZE, liked, method)).tracks
      }
    }
    await Promise.all(Array.from({ length: Math.min(PAGE_CONCURRENCY, pages - 1) }, worker))

    return [...first.tracks, ...rest.flat()]
  }

  private async audioGetPage(
    base: Record<string, string>,
    offset: number,
    liked: boolean,
    method = 'audio.get'
  ): Promise<{ tracks: Track[]; total: number }> {
    if (!this.client) throw new SessionExpiredError('vk')
    const params = new URLSearchParams({ ...base, count: String(PAGE_SIZE), offset: String(offset) })
    const res = (await this.client.request<any>(method as any, params)) as any
    const items: any[] = res.success ? (res.data?.response?.items ?? []) : []
    return {
      tracks: items.map((item) => this.mapRawAudio(item, liked)),
      total: Number(res.data?.response?.count ?? items.length)
    }
  }

  async artistTracks(nativeId: string): Promise<Track[]> {
    if (!this.client) throw new SessionExpiredError('vk')
    return this.pagedAudioGet({ artist_id: nativeId }, false, 'audio.getAudiosByArtist')
  }

  async albumTracks(nativeId: string): Promise<Track[]> {
    return this.playlistTracks(nativeId)
  }

  async search(query: string): Promise<SearchResult> {
    if (!this.client) throw new SessionExpiredError('vk')
    // VK exposes audios through one method and the rest through others that are
    // not part of the library's typed surface. Each extra lookup is optional:
    // if VK drops it, the row simply stays empty instead of failing the search.
    const [result, albums, artists, lists] = await Promise.all([
      this.client.searchAudio(query),
      this.searchAlbums(query),
      this.searchArtists(query),
      this.searchPlaylists(query)
    ])

    return {
      tracks: result.audios.map((a) => this.mapTrack(a, false)),
      albums,
      artists,
      playlists: lists
    }
  }

  /**
   * Плейлисты по запросу. Раньше здесь стояла пустая заглушка, и раздел
   * «Плейлисты» в поиске держался на одном Яндексе. У VK для этого есть
   * отдельный метод — альбомы и плейлисты он различает, хотя поля у них общие.
   */
  private async searchPlaylists(query: string): Promise<Playlist[]> {
    try {
      const params = new URLSearchParams({ q: query, count: '10' })
      const items = (await this.call('audio.searchPlaylists', params))?.items
      if (!Array.isArray(items)) return []
      return items.map((raw: any) => {
        // Тот же вид идентификатора, что и у своих плейлистов: по нему
        // playlistTracks потом разбирает владельца, номер и ключ доступа.
        const nativeId = `${raw.owner_id}_${raw.id}_${raw.access_key ?? ''}`
        return {
          id: `vk:${nativeId}`,
          service: 'vk' as const,
          nativeId,
          title: String(raw.title ?? ''),
          description: raw.description ? String(raw.description) : null,
          trackCount: Number(raw.count ?? 0),
          coverUrl: thumbOf(raw.photo ?? raw.thumb)
        }
      })
    } catch {
      return []
    }
  }

  /**
   * VK's "Моя волна" is an audio mix. The mix advances on VK's side, so each
   * call returns the next few tracks and the caller needs no cursor.
   */
  async wave(): Promise<Track[]> {
    // Та же договорённость, что и у Яндекса: взятое ради показа достаётся
    // плееру, а не выбрасывается — станция отдаёт треки один раз.
    if (this.waveAhead && this.waveBatch.length > 0) {
      this.waveAhead = false
      return this.waveBatch
    }
    if (!this.client) throw new SessionExpiredError('vk')

    const data = await this.client.getSectionsWithBlocks(this.accountId || undefined)
    const mixes = data.audioMixes ?? []
    const mix =
      mixes.find((item) => /волна|wave/i.test(item.titles?.common ?? '')) ?? mixes[0]
    if (!mix) throw new Error('VK: «Моя волна» недоступна для этого аккаунта')

    const params = new URLSearchParams({ mix_id: mix.id, count: '30' })
    const items = await this.call('audio.getStreamMixAudios', params)
    if (!Array.isArray(items)) throw new Error('VK не отдал треки волны')
    // Отвергнутое вычёркивается здесь: VK о нашем списке не знает и продолжает
    // его предлагать.
    const disliked = new Set(getSettings().vkDisliked)
    this.waveBatch = items
      .map((item: any) => this.mapRawAudio(item, false))
      .filter((track) => !disliked.has(track.nativeId))
    this.waveAhead = false
    return this.waveBatch
  }

  /**
   * У VK настроить волну нечем.
   *
   * Категории он показывает — audio.getStreamMixSettings отдаёт настроение,
   * узнаваемость и язык, — но записать выбор некуда: проверены
   * setStreamMixSettings, saveStreamMixSettings, updateStreamMixSettings,
   * setStreamMixCategories и editStreamMix, все отказали. Передача категории
   * прямо в запрос за треками ничего не меняет: доля русских исполнителей при
   * «русском» 46%, при «иностранном» 54% — то есть параметр просто проглочен.
   *
   * Показывать переключатели, которые ни на что не влияют, хуже, чем не
   * показывать их вовсе.
   */
  async waveTuning(): Promise<WaveTuning | null> {
    return null
  }

  async setWaveTuning(): Promise<boolean> {
    return false
  }

  /**
   * Станция вокруг одного трека.
   *
   * У VK нет отдельной «волны по треку» — есть подбор похожего, на котором уже
   * стоит кнопка «Похожее». Разница не в запросе, а в том, как этим
   * пользоваться: список показывают, а станцию слушают, и она продолжается.
   * Продолжение берётся от последнего выданного трека — так она и уходит от
   * начальной песни, как положено волне.
   */
  async trackWave(seed: Track, afterNativeId?: string): Promise<Track[]> {
    if (!this.client) throw new SessionExpiredError('vk')
    const target = afterNativeId ?? seed.nativeId
    const params = new URLSearchParams({ target_audio: target, count: String(WAVE_BATCH) })
    const items = (await this.call('audio.getRecommendations', params))?.items
    if (!Array.isArray(items)) throw new Error('VK не отдал треки волны')
    const disliked = new Set(getSettings().vkDisliked)
    return items
      .map((item: any) => this.mapRawAudio(item, false))
      .filter((track) => !disliked.has(track.nativeId))
  }

  /** Спросить порцию заранее — чтобы было что показать, не отнимая у плеера. */
  async prefetchWave(): Promise<Track[]> {
    if (this.waveBatch.length > 0) return this.waveBatch
    const tracks = await this.wave()
    this.waveAhead = true
    return tracks
  }

  /** Порция взята для показа и ещё не досталась плееру. */
  private waveAhead = false

  lastWave(): Track[] {
    return this.waveBatch
  }

  /**
   * Call a VK method the library does not type and hand back `response`.
   * Returns null when VK reports a failure, so callers can degrade quietly.
   */
  private async call(method: string, params: URLSearchParams): Promise<any> {
    if (!this.client) throw new SessionExpiredError('vk')
    const res = await this.client.request<any>(method as never, params)
    if (!res.success) return null
    return (res as { data?: { response?: unknown } }).data?.response ?? null
  }

  private async searchAlbums(query: string): Promise<SearchResult['albums']> {
    try {
      const params = new URLSearchParams({ q: query, count: '10' })
      const items = (await this.call('audio.searchAlbums', params))?.items
      if (!Array.isArray(items)) return []
      return items.map((raw: any) => ({
        id: `vk:${raw.owner_id}_${raw.id}_${raw.access_key ?? ''}`,
        service: 'vk' as const,
        nativeId: `${raw.owner_id}_${raw.id}_${raw.access_key ?? ''}`,
        title: String(raw.title ?? ''),
        artists: [String(raw.main_artists?.[0]?.name ?? raw.artist ?? '')].filter(Boolean),
        year: raw.year ? Number(raw.year) : null,
        coverUrl: thumbOf(raw.photo ?? raw.thumb)
      }))
    } catch {
      return []
    }
  }

  private async searchArtists(query: string): Promise<SearchResult['artists']> {
    try {
      const params = new URLSearchParams({ q: query, count: '10' })
      const items = (await this.call('audio.searchArtists', params))?.items
      if (!Array.isArray(items)) return []
      return items.map((raw: any) => ({
        id: `vk:artist:${raw.id ?? raw.domain ?? raw.name}`,
        service: 'vk' as const,
        nativeId: String(raw.id ?? raw.domain ?? ''),
        name: String(raw.name ?? ''),
        coverUrl: thumbOf(raw.photo)
      }))
    } catch {
      return []
    }
  }

  async similarTracks(track: Track): Promise<Track[]> {
    if (!this.client) throw new SessionExpiredError('vk')
    const params = new URLSearchParams({ target_audio: track.nativeId, count: String(PAGE_SIZE) })
    const items = (await this.call('audio.getRecommendations', params))?.items
    if (!Array.isArray(items)) return []
    return items.map((item: any) => this.mapRawAudio(item, false))
  }

  async lyrics(track: Track): Promise<Lyrics | null> {
    if (!this.client) throw new SessionExpiredError('vk')
    const [ownerId, audioId] = track.nativeId.split('_')
    try {
      const data = await this.call('audio.getLyrics', new URLSearchParams({ audio_id: `${ownerId}_${audioId}` }))
      const lines = data?.lyrics?.text
      if (!Array.isArray(lines) || lines.length === 0) return null
      const text = lines.join(String.fromCharCode(10)).trim()
      // У VK меток времени нет — только текст целиком.
      return text ? { text, lines: [] } : null
    } catch {
      return null
    }
  }

  async waveFeedback(): Promise<void> {
    // The VK mix advances server-side; there is nothing to report to.
  }

  /**
   * «Не нравится» у VK делаем сами.
   *
   * Метода для этого у сервиса нет: проверены audio.dislike, audio.setDislike,
   * audio.addDislike, audio.dislikeAudio, audio.dislikeRecommendation,
   * audio.hide, audio.hideAudio, audio.hideRecommendation,
   * audio.getDislikedAudios, audio.removeFromRecommendations,
   * audio.setBlacklist, audio.addToBlacklist, audio.notInterested,
   * audio.markAsUninteresting и оба имени для отзыва о микшированной волне —
   * все отвечают отказом. Отвечает только newsfeed.ignoreItem, но она прячет
   * запись из ленты новостей, а не трек из рекомендаций.
   *
   * Кнопки от этого не было, а нужна она ровно за тем же: больше не слышать
   * этот трек. Список отвергнутого Duet держит у себя и вычёркивает его из
   * волны сам — на стороне VK рекомендации останутся прежними, зато обещание
   * кнопки выполняется.
   */
  canDislike(): boolean {
    return true
  }

  async dislike(track: Track): Promise<void> {
    const disliked = getSettings().vkDisliked
    if (!disliked.includes(track.nativeId)) {
      setSettings({ vkDisliked: [track.nativeId, ...disliked].slice(0, DISLIKED_KEPT) })
    }

    // Нелюбимое не должно остаться в избранном — это противоречило бы само себе.
    if (track.liked || this.likedTwin(track)) {
      try {
        await this.setLiked(track, false)
      } catch {
        // Отметка уже сделана; не снявшийся лайк её не отменяет.
      }
    }
  }

  async setLiked(track: Track, liked: boolean): Promise<void> {
    if (!this.client) throw new SessionExpiredError('vk')

    // Удалять надо свою копию, а не тот трек, который показан. У пришедшего
    // из волны владелец чужой, и удаление по его номеру не сделало бы ничего.
    const twin = this.likedTwin(track)
    const target = liked ? track : twin ?? track
    const [ownerId, audioId] = target.nativeId.split('_')

    if (liked) {
      await this.client.add(Number(ownerId), Number(audioId))
    } else {
      await this.client.delete(Number(ownerId), Number(audioId))
    }

    // Patch the cached library so the change shows immediately, without paying
    // for the full walk again.
    if (this.liked) {
      const without = this.liked.tracks.filter(
        (item) => item.id !== target.id && item.id !== track.id
      )
      this.liked.tracks = liked ? [{ ...track, liked: true }, ...without] : without
      this.indexLiked(this.liked.tracks)
    }
  }

  async streamUrl(track: Track): Promise<string> {
    const raw = this.streamHints.get(track.id)
    if (raw && !raw.includes('audio_api_unavailable')) {
      return raw
    }
    
    // If we don't have it or it's unavailable, request it explicitly.
    if (!this.client) throw new SessionExpiredError('vk')
    const [ownerId, audioId, accessHash] = track.nativeId.split('_')
    const fullId = accessHash ? `${ownerId}_${audioId}_${accessHash}` : `${ownerId}_${audioId}`
    
    const params = new URLSearchParams({ audios: fullId })
    const res = await this.client.request<any>('audio.getById' as any, params)
    
    if (!res.success) throw new Error('VK: API request failed')
    const url = res.data?.response?.[0]?.url
    if (!url || url.includes('audio_api_unavailable')) {
      throw new Error('VK: не удалось получить ссылку на трек')
    }
    return url
  }

  async diagnose(): Promise<Record<string, unknown>> {
    const cookies = await getAuthCookies()
    return {
      hasCookies: cookies !== null,
      isConnected: this.connected,
      account: this.account
    }
  }

  dispose(): void {
    this.client = null
  }

  // ---- internals ----
  
  private streamHints = new Map<string, string>()
  /** The whole library, so opening a screen does not re-walk 18 pages. */
  private liked: { at: number; tracks: Track[] } | null = null
  /** A walk already under way; a second caller waits on it instead of starting its own. */
  private likedInFlight: Promise<Track[]> | null = null
  /** Плейлисты — тот же приём, только список короткий. */
  private lists: { at: number; items: Playlist[] } | null = null
  /** Последняя порция волны — для показа, без нового запроса к миксу. */
  private waveBatch: Track[] = []

  /**
   * Избранное, разложенное для узнавания. По имени — потому что добавленный
   * трек VK хранит как вашу копию с другим номером: из волны тот же трек
   * приходит с исходным владельцем, и сравнение по идентификатору его не
   * узнаёт. Значение — та самая копия: именно её надо удалять, когда сердечко
   * гасят у трека, пришедшего не из библиотеки.
   */
  private likedIndex = new Map<string, Track>()

  private indexLiked(tracks: Track[]): void {
    this.likedIndex = new Map()
    for (const track of tracks) {
      this.likedIndex.set(track.id, track)
      this.likedIndex.set(matchKey(track), track)
    }
  }

  /** Та же песня в избранном, если она там есть. */
  private likedTwin(track: Pick<Track, 'id' | 'title' | 'artists'>): Track | undefined {
    return this.likedIndex.get(track.id) ?? this.likedIndex.get(matchKey(track))
  }

  private async adopt(): Promise<Account> {
    const cookies = await getAuthCookies()
    if (!cookies) throw new SessionExpiredError('vk')
    
    const webClient = new VKWebClient({ cookies })
    this.client = new VKAudio({
      client: webClient,
      token: { value: '', expiresIn: -1 } // Not needed for VKWebClient
    })
    
    // Call users.get to get user details
    const params = new URLSearchParams({
      fields: 'photo_100'
    })
    const userRes = await this.client.request<any>('users.get' as any, params)
    const user = userRes.success ? userRes.data?.response?.[0] : undefined
    if (user) {
      this.accountId = String(user.id)
    }
    
    this.connected = true
    this.account = { 
      displayName: user ? `${user.first_name} ${user.last_name}` : 'Пользователь VK', 
      avatarUrl: user?.photo_100 ?? null 
    }
    return this.account
  }

  private mapTrack(a: any, liked: boolean): Track {
    const nativeId = `${a.ownerId}_${a.id}`
    const id = trackKey('vk', nativeId)
    const artists: string[] = a.artists?.map((art: any) => art.name) || [a.artist].filter(Boolean)
    
    if (a.fileUrl) {
      this.streamHints.set(id, a.fileUrl)
    }

    return {
      id,
      service: 'vk',
      nativeId,
      title: a.title,
      artists,
      artistRefs: (a.artists ?? [])
        .map((art: any) => ({ nativeId: String(art?.id ?? ''), name: String(art?.name ?? '') }))
        .filter((art: { nativeId: string; name: string }) => art.nativeId && art.name),
      album: a.album?.title ?? null,
      albumId: null,
      durationMs: a.duration * 1000,
      coverUrl: a.thumbnail?.photo300 ?? a.thumbnail?.photo135 ?? a.thumbnail?.photo68 ?? null,
      liked: liked || a.isLiked === true || this.likedTwin({ id, title: a.title, artists }) !== undefined,
      available: !!a.fileUrl
    }
  }

  private mapRawAudio(a: any, liked: boolean): Track {
    const nativeId = `${a.owner_id}_${a.id}`
    const id = trackKey('vk', nativeId)
    
    if (a.url) {
      this.streamHints.set(id, a.url)
    }

    const artists = a.main_artists?.map((art: any) => art.name) || [a.artist].filter(Boolean)
    // VK only names the artist on some rows; without an id there is no page to open.
    const artistRefs = (a.main_artists ?? [])
      .map((art: any) => ({ nativeId: String(art?.id ?? ''), name: String(art?.name ?? '') }))
      .filter((art: { nativeId: string; name: string }) => art.nativeId && art.name)
    const coverUrl = a.album?.thumb?.photo_300 ?? a.album?.thumb?.photo_135 ?? a.album?.thumb?.photo_68 ?? null

    return {
      id,
      service: 'vk',
      nativeId,
      title: a.title,
      artists,
      artistRefs,
      album: a.album?.title ?? null,
      albumId: null,
      durationMs: (a.duration || 0) * 1000,
      coverUrl,
      // Из волны и плейлистов трек приходит без отметки об избранном — её
      // подсказывает библиотека, иначе сердечко не горит на уже лайкнутом.
      liked: liked || this.likedTwin({ id, title: a.title, artists }) !== undefined,
      available: !!a.url
    }
  }

  private mapPlaylist(p: any): Playlist {
    const nativeId = `${p.ownerId}_${p.id}_${p.accessKey || ''}`
    return {
      id: `vk:${nativeId}`,
      service: 'vk',
      nativeId,
      title: p.title,
      description: p.description || null,
      trackCount: p.count,
      coverUrl: p.photo?.photo300 ?? p.photo?.photo135 ?? p.photo?.photo68 ?? null
    }
  }
}

/** VK thumbnails arrive as either an object of sized urls or an array of them. */
function thumbOf(raw: any): string | null {
  if (!raw) return null
  const source = Array.isArray(raw) ? raw[raw.length - 1] : raw
  if (typeof source === 'string') return source
  for (const key of ['photo_600', 'photo_300', 'photo_270', 'photo_135', 'photo_68', 'url', 'src']) {
    const value = source?.[key]
    if (typeof value === 'string' && value) return value
  }
  return null
}
