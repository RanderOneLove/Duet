import type {
  Connection,
  Lyrics,
  HomeSection,
  Playlist,
  SearchResult,
  ServiceId,
  Track,
  WaveChoice
} from '@shared/domain'
import { EMPTY_SEARCH } from '@shared/domain'
import { SessionExpiredError, type Source, type WaveEvent } from './types'
import { localPlaylists, localPlaylistTracks } from '../library/playlists'
import { notifyLibraryChanged } from '../library/changed'
import { backfillCovers, forgetCovers, withKnownCovers } from '../library/covers'
import type { JamSeed } from '@shared/jam'
import type { WaveTuning } from '@shared/wave'
import { matchKey, pickTwin } from '../library/match'
import { lrclibLyrics } from '../lyrics/lrclib'
import { getSettings } from '../state/settings'
import { YandexSource } from './yandex/source'
import { VkSource } from './vk/source'

/**
 * Both services behind one catalogue. Screens ask for "liked tracks" and get a
 * merged list with each row badged by service; a service that is disconnected
 * or failing contributes nothing rather than failing the whole screen.
 */

const yandex = new YandexSource()
const vk = new VkSource()

const sources: Record<ServiceId, Source> = { yandex, vk }
const order: ServiceId[] = ['yandex', 'vk']

/** Last error per service, surfaced on Connect and in the 2m error state. */
const errors = new Map<ServiceId, string | null>()

type Listener = (connections: Connection[]) => void
const listeners = new Set<Listener>()

/**
 * Anything that changes what the catalogue would return — a like, or a library
 * that finished refreshing in the background. The shell re-reads the affected
 * lists instead of guessing locally, because the service decides what "liked"
 * actually means (VK stores a copy with a new id, Yandex flips a flag on the
 * original). Само событие живёт в отдельном модуле: подавать его нужно и из
 * источников, а те реестр импортировать не могут.
 */
export { onLibraryChanged } from '../library/changed'

export function onConnectionsChanged(listener: Listener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** Подключён ли сервис прямо сейчас. */
export function isServiceConnected(service: ServiceId): boolean {
  return sources[service].isConnected()
}

export function getConnections(): Connection[] {
  return order.map((id) => ({
    service: id,
    connected: sources[id].isConnected(),
    account: accountOf(id),
    error: errors.get(id) ?? null
  }))
}

/** Re-attach stored sessions at startup, in parallel and without failing. */
export async function restoreSources(): Promise<void> {
  await Promise.all(
    order.map(async (id) => {
      try {
        await sources[id].restore()
        errors.set(id, null)
      } catch (error) {
        errors.set(id, message(error))
      }
    })
  )
  notify()
}

export async function connectSource(id: ServiceId): Promise<void> {
  try {
    await sources[id].connect()
    errors.set(id, null)
  } catch (error) {
    errors.set(id, message(error))
    throw error
  } finally {
    notify()
  }
}

export async function disconnectSource(id: ServiceId): Promise<void> {
  await sources[id].disconnect()
  errors.set(id, null)
  forgetCovers(id)
  notify()
}

// ---- catalogue ----

/**
 * Home is composed here rather than per source: the playlist row and the liked
 * list are single, merged blocks so both services sit in one list.
 */
export async function home(): Promise<HomeSection[]> {
  const [lists, liked] = await Promise.all([playlists(), likedTracks()])
  const sections: HomeSection[] = []
  if (lists.length > 0) {
    sections.push({ id: 'playlists', service: null, title: 'Ваши плейлисты', kind: 'playlists', playlists: lists })
  }
  if (liked.length > 0) {
    sections.push({ id: 'liked', service: null, title: 'Вам нравится', kind: 'tracks', tracks: liked })
  }
  return sections
}

/**
 * Перечитать фонотеку обоих сервисов.
 *
 * `force` — это кнопка «обновить»: спрашиваем всех подключённых, не разбирая,
 * похоже ли что-то на беду. Без него — почасовая проверка: обходятся только
 * те, чей список падал или постарел, иначе сеть дёргается зря.
 */
export async function refreshLibrary(force = false): Promise<void> {
  const worth = order.filter(
    (id) => sources[id].isConnected() && (force || sources[id].likedSuspect())
  )
  if (worth.length === 0) return
  await Promise.allSettled(worth.map((id) => sources[id].refreshLibrary()))
  notifyLibraryChanged()
}

export async function likedTracks(): Promise<Track[]> {
  const results = await eachConnected((source) => source.likedTracks())
  return interleave(results)
}

export async function playlists(): Promise<Playlist[]> {
  const results = await eachConnected((source) => source.playlists())
  // Ours first: they are the only ones the listener actually assembled.
  const all = [...localPlaylists(), ...results.flat()]
  /*
   * Плейлист без обложки показывается обложкой первого своего трека — так же,
   * как это делают локальные списки. Найденное подставляется сразу, а чего ещё
   * не знаем — дочитывается в фоне: список не должен ждать сети ради картинки.
   */
  const shown = withKnownCovers(all)
  backfillCovers(shown, (playlist) => playlistTracks(playlist.service, playlist.nativeId))
  return shown
}

export async function playlistTracks(service: ServiceId | null, nativeId: string): Promise<Track[]> {
  if (service === null) return localPlaylistTracks(nativeId)
  return sources[service].playlistTracks(nativeId)
}

export async function albumTracks(service: ServiceId, nativeId: string): Promise<Track[]> {
  return sources[service].albumTracks(nativeId)
}

/** Tell a service's station how a track went; quiet when it has none. */
export async function waveFeedback(
  service: ServiceId,
  event: WaveEvent,
  track?: Track,
  playedSeconds?: number
): Promise<void> {
  const source = sources[service]
  if (!source.isConnected()) return
  try {
    await source.waveFeedback(event, track, playedSeconds)
  } catch {
    // Never let a report get in the way of playing.
  }
}

/** Tracks close to this one, from the service it came from. */
export async function similarTracks(track: Track): Promise<Track[]> {
  const source = sources[track.service]
  if (!source.isConnected()) return []
  return source.similarTracks(track)
}

/** The words for a track, from the service it came from. */
/**
 * Текст песни, откуда бы он ни нашёлся.
 *
 * Сервисы знают слова далеко не ко всему, и знают разное: у одного текст есть,
 * у другого той же песни нет. Поэтому спрашиваем по очереди — сперва свой
 * сервис, потом второй про тот же трек, и только потом открытую базу.
 * Размеченный текст при этом ценнее простого: если у своего сервиса нашёлся
 * текст без меток, а у соседа с метками, победит сосед.
 */
export async function lyrics(track: Track): Promise<Lyrics | null> {
  const own = sources[track.service].isConnected() ? await safeLyrics(track.service, track) : null
  if (own?.lines.length) return own

  const twin = await findTwin(track)
  const other = twin ? await safeLyrics(twin.service, twin) : null
  if (other?.lines.length) return other

  if (getSettings().openLyrics) {
    const open = await lrclibLyrics(track)
    if (open?.lines.length) return open
    // Простой текст из базы берём только если у сервисов не нашлось и такого.
    if (!own && !other && open) return open
  }

  return own ?? other
}

async function safeLyrics(service: ServiceId, track: Track): Promise<Lyrics | null> {
  try {
    return await sources[service].lyrics(track)
  } catch {
    return null
  }
}

/**
 * Тот же трек у другого сервиса.
 *
 * Нужен в двух местах: когда текста нет у своего сервиса и когда играть надо,
 * а свой сервис не подключён или трек в нём недоступен. Ответ держится в
 * памяти — и найденный, и ненайденный: поиск стоит обращения к сервису, а
 * спрашивают об одном и том же треке по многу раз.
 */
const TWIN_TTL_MS = 30 * 60 * 1000
const twins = new Map<string, { at: number; track: Track | null }>()

export async function findTwin(track: Track): Promise<Track | null> {
  const target = order.find((id) => id !== track.service && sources[id].isConnected())
  if (!target) return null

  const key = `${target}:${matchKey(track)}:${Math.round(track.durationMs / 1000)}`
  const known = twins.get(key)
  if (known && Date.now() - known.at < TWIN_TTL_MS) return known.track

  let found: Track | null = null
  try {
    const query = `${track.artists.join(' ')} ${track.title}`.trim()
    const result = await sources[target].search(query)
    found = pickTwin(track, result.tracks)
  } catch {
    // Поиск не удался — это не повод падать там, откуда нас позвали.
  }

  twins.set(key, { at: Date.now(), track: found })
  return found
}

/**
 * Найти у себя трек, который предложил участник общей сессии.
 *
 * Едет описание, а не номер: номера у сервисов свои, и добавленный из VK трек
 * нечем открыть тому, у кого только Яндекс. Сначала спрашиваем тот сервис,
 * откуда трек у предложившего, — там он точно есть под этим названием.
 */
export async function resolveSeed(seed: JamSeed): Promise<Track | null> {
  const probe: Pick<Track, 'title' | 'artists' | 'durationMs'> = {
    title: seed.title,
    artists: seed.artists,
    durationMs: seed.durationMs
  }
  const query = `${seed.artists.join(' ')} ${seed.title}`.trim()
  if (!query) return null

  const tryFirst = order.filter((id) => id === seed.service)
  for (const id of [...tryFirst, ...order.filter((x) => x !== seed.service)]) {
    if (!sources[id].isConnected()) continue
    try {
      const result = await sources[id].search(query)
      const hit = pickTwin(probe as Track, result.tracks)
      if (hit) return hit
    } catch {
      // Один сервис не ответил — спросим второй.
    }
  }
  return null
}

/**
 * Каким треком отвечать на просьбу его проиграть.
 *
 * Трек может прийти из чужой очереди, из совместного прослушивания или просто
 * оказаться недоступным в своём сервисе. Раньше это заканчивалось тишиной и
 * сообщением; теперь та же песня ищется у второго сервиса, и играет она.
 * Возвращается именно трек, а не ссылка: дальше по нему будут и лайк, и текст,
 * и подпись в Discord — всё это должно указывать на то, что звучит.
 */
export async function playableTrack(track: Track): Promise<Track> {
  const source = sources[track.service]
  if (source.isConnected() && track.available) return track

  const twin = await findTwin(track)
  return twin ?? track
}

export async function artistTracks(service: ServiceId, nativeId: string): Promise<Track[]> {
  return sources[service].artistTracks(nativeId)
}

/**
 * The personal radio the Home toggle asks for. `both` runs the two stations at
 * once and takes them in turns; each keeps its own place, since neither can be
 * told where the other got to.
 */
export async function wave(
  choice: WaveChoice,
  cursors: Partial<Record<ServiceId, string>> = {}
): Promise<Track[]> {
  if (choice !== 'both') return oneWave(choice, cursors[choice])

  const results = await Promise.allSettled(
    order.filter((id) => sources[id].isConnected()).map((id) => oneWave(id, cursors[id]))
  )
  const lists = results
    .filter((result): result is PromiseFulfilledResult<Track[]> => result.status === 'fulfilled')
    .map((result) => result.value)

  if (lists.length === 0) {
    // Both stations failed; the first reason is the useful one to show.
    const failed = results.find((result) => result.status === 'rejected')
    throw failed && failed.status === 'rejected'
      ? (failed.reason as Error)
      : new Error('Волна недоступна')
  }
  return dedupe(interleave(lists))
}

/**
 * The same song is often in both libraries, and hearing it twice in a row from
 * two services is the one thing a woven station must not do. Matching is by
 * name rather than id — the services share none — so it is deliberately loose.
 */
function dedupe(tracks: Track[]): Track[] {
  const seen = new Set<string>()
  return tracks.filter((track) => {
    const key = matchKey(track)
    if (!key || seen.has(key)) return false
    seen.add(key)
    return true
  })
}

async function oneWave(service: ServiceId, afterNativeId?: string): Promise<Track[]> {
  const source = sources[service]
  if (!source.isConnected()) throw new Error(`${SERVICE_LABEL[service]}: нет подключения`)
  try {
    const tracks = await source.wave(afterNativeId)
    errors.set(service, null)
    return tracks
  } catch (error) {
    errors.set(service, message(error))
    notify()
    throw error
  }
}

/**
 * Что станция выдала в прошлый раз — для показа на Главной.
 *
 * Отдельно от `wave` именно потому, что ничего не запрашивает: экран, который
 * тянет треки, чтобы их показать, отбирает их у плеера и сбивает станции
 * отчётность о прослушанном.
 */
/**
 * Спросить у станций по порции заранее, для показа на Главной.
 *
 * Зовётся один раз на запуск: плита волны без обложки и без «далее» выглядит
 * сломанной, а узнать, что будет играть, можно только спросив. Спрошенное не
 * пропадает — `wave` отдаст плееру ровно его.
 */
let waveAhead: Promise<void> | null = null

export function prefetchWave(
  choice: WaveChoice,
  cursors: Partial<Record<ServiceId, string>> = {}
): Promise<void> {
  const ids = choice === 'both' ? order : [choice]
  waveAhead = Promise.allSettled(
    ids.filter((id) => sources[id].isConnected()).map((id) => sources[id].prefetchWave(cursors[id]))
  ).then(() => undefined)
  return waveAhead
}

/**
 * Чем можно подкрутить волну выбранного сервиса.
 *
 * У «обеих» настройки не показываются: станции две, набор у каждой свой, и
 * один переключатель на двоих означал бы, что половина выбора куда-то делась.
 */
export async function waveTuning(choice: WaveChoice): Promise<WaveTuning | null> {
  if (choice === 'both') return null
  const source = sources[choice]
  if (!source.isConnected()) return null
  try {
    return await source.waveTuning()
  } catch {
    return null
  }
}

export async function setWaveTuning(
  choice: WaveChoice,
  values: Record<string, string>
): Promise<boolean> {
  if (choice === 'both') return false
  const source = sources[choice]
  if (!source.isConnected()) return false
  try {
    return await source.setWaveTuning(values)
  } catch {
    return false
  }
}

/** Станция вокруг трека — у того сервиса, из которого он пришёл. */
export async function trackWave(seed: Track, afterNativeId?: string): Promise<Track[]> {
  const source = sources[seed.service]
  if (!source.isConnected()) {
    throw new Error(`${SERVICE_LABEL[seed.service]}: нет подключения`)
  }
  return source.trackWave(seed, afterNativeId)
}

export async function wavePreview(choice: WaveChoice): Promise<Track[]> {
  /*
   * Дожидаемся порции, если её уже пошли брать.
   *
   * Экран спрашивает раньше, чем приходит ответ, и без этого ожидания плита
   * оставалась бы пустой до первого же повода перерисоваться — а его может и
   * не случиться. Своего запроса здесь по-прежнему нет: показ не должен
   * отнимать треки у плеера.
   */
  if (waveAhead) await waveAhead
  return waveNow(choice)
}

function waveNow(choice: WaveChoice): Track[] {
  if (choice !== 'both') {
    const source = sources[choice]
    return source.isConnected() ? source.lastWave() : []
  }
  return dedupe(
    interleave(order.filter((id) => sources[id].isConnected()).map((id) => sources[id].lastWave()))
  )
}

export async function search(query: string): Promise<SearchResult> {
  if (!query.trim()) return EMPTY_SEARCH
  const results = await eachConnected((source) => source.search(query))
  return {
    tracks: interleave(results.map((result) => result.tracks)),
    albums: results.flatMap((result) => result.albums),
    artists: results.flatMap((result) => result.artists),
    playlists: results.flatMap((result) => result.playlists)
  }
}

/** Умеет ли сервис этого трека «не нравится». */
export function canDislike(service: ServiceId): boolean {
  const source = sources[service]
  return source.isConnected() && source.canDislike()
}

export async function dislike(track: Track): Promise<void> {
  await sources[track.service].dislike(track)
  notifyLibraryChanged()
}

export async function setLiked(track: Track, liked: boolean): Promise<void> {
  await sources[track.service].setLiked(track, liked)
  notifyLibraryChanged()
}

/** Called by the player at play time; links are short-lived by design. */
export async function resolveStream(track: Track): Promise<string> {
  const source = sources[track.service]
  if (!source.isConnected()) throw new Error(`${SERVICE_LABEL[track.service]}: нет подключения`)
  return source.streamUrl(track)
}

const SERVICE_LABEL: Record<ServiceId, string> = { vk: 'VK', yandex: 'Яндекс' }

export function disposeSources(): void {
  vk.dispose()
}

// ---- helpers ----

function accountOf(id: ServiceId): Connection['account'] {
  return id === 'yandex' ? yandex.getAccount() : vk.getAccount()
}

/**
 * Run a query against every connected service. A service that throws is
 * recorded and skipped — one broken service must not blank the screen.
 */
async function eachConnected<T>(run: (source: Source) => Promise<T>): Promise<T[]> {
  const settled = await Promise.all(
    order
      .filter((id) => sources[id].isConnected())
      .map(async (id) => {
        try {
          const value = await run(sources[id])
          errors.set(id, null)
          return value
        } catch (error) {
          errors.set(id, message(error))
          if (error instanceof SessionExpiredError) notify()
          return null
        }
      })
  )
  const failed = settled.some((value) => value === null)
  if (failed) notify()
  return settled.filter((value): value is Awaited<T> => value !== null)
}

/**
 * Merge per-service lists round-robin, so a mixed screen opens with both
 * services visible instead of one service's whole catalogue first.
 */
function interleave<T>(lists: T[][]): T[] {
  const out: T[] = []
  const longest = Math.max(0, ...lists.map((list) => list.length))
  for (let i = 0; i < longest; i++) {
    for (const list of lists) {
      if (i < list.length) out.push(list[i])
    }
  }
  return out
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function notify(): void {
  const connections = getConnections()
  for (const listener of listeners) listener(connections)
}
