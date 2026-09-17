import type {
  Connection,
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
import { matchKey } from '../library/match'
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

export async function likedTracks(): Promise<Track[]> {
  const results = await eachConnected((source) => source.likedTracks())
  return interleave(results)
}

export async function playlists(): Promise<Playlist[]> {
  const results = await eachConnected((source) => source.playlists())
  // Ours first: they are the only ones the listener actually assembled.
  return [...localPlaylists(), ...results.flat()]
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
export async function lyrics(track: Track): Promise<string | null> {
  const source = sources[track.service]
  if (!source.isConnected()) return null
  return source.lyrics(track)
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
