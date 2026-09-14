import { app } from 'electron'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Playlist, Track } from '@shared/domain'

/**
 * Playlists that live here rather than at a service. They are the only place
 * the two catalogues can be mixed in one list — neither VK nor Yandex will
 * accept the other's tracks — so a local playlist stores whole tracks rather
 * than ids, and keeps working even while a service is disconnected.
 */

export interface LocalPlaylist {
  id: string
  title: string
  createdAt: number
  tracks: Track[]
}

let lists: LocalPlaylist[] = []
let loaded = false

type Listener = () => void
const listeners = new Set<Listener>()

export function onPlaylistsChanged(listener: Listener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function file(): string {
  return join(app.getPath('userData'), 'playlists.json')
}

export async function loadPlaylists(): Promise<void> {
  if (loaded) return
  loaded = true
  try {
    const raw = JSON.parse(await readFile(file(), 'utf8')) as LocalPlaylist[]
    lists = raw.filter((list) => list && typeof list.id === 'string').map(normalise)
  } catch {
    // No playlists yet.
  }
}

/** Older files predate fields the app now expects of a track. */
function normalise(list: LocalPlaylist): LocalPlaylist {
  return {
    ...list,
    tracks: (list.tracks ?? []).map((track) => ({ ...track, artistRefs: track.artistRefs ?? [] }))
  }
}

/** As the rest of the app sees them: playlists with no service behind them. */
export function localPlaylists(): Playlist[] {
  return lists.map((list) => ({
    id: `local:${list.id}`,
    service: null,
    nativeId: list.id,
    title: list.title,
    description: null,
    trackCount: list.tracks.length,
    coverUrl: list.tracks.find((track) => track.coverUrl)?.coverUrl ?? null
  }))
}

export function localPlaylistTracks(id: string): Track[] {
  return lists.find((list) => list.id === id)?.tracks ?? []
}

export async function createPlaylist(title: string, tracks: Track[] = []): Promise<string> {
  const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
  lists = [{ id, title: title.trim() || 'Новый плейлист', createdAt: Date.now(), tracks }, ...lists]
  await save()
  return id
}

export async function renamePlaylist(id: string, title: string): Promise<void> {
  lists = lists.map((list) => (list.id === id ? { ...list, title: title.trim() || list.title } : list))
  await save()
}

export async function removePlaylist(id: string): Promise<void> {
  lists = lists.filter((list) => list.id !== id)
  await save()
}

/** Adding a track that is already there would only confuse the listing. */
export async function addToPlaylist(id: string, tracks: Track[]): Promise<void> {
  lists = lists.map((list) => {
    if (list.id !== id) return list
    const known = new Set(list.tracks.map((track) => track.id))
    return { ...list, tracks: [...list.tracks, ...tracks.filter((track) => !known.has(track.id))] }
  })
  await save()
}

export async function removeFromPlaylist(id: string, trackId: string): Promise<void> {
  lists = lists.map((list) =>
    list.id === id ? { ...list, tracks: list.tracks.filter((track) => track.id !== trackId) } : list
  )
  await save()
}

async function save(): Promise<void> {
  try {
    await writeFile(file(), JSON.stringify(lists))
  } catch {
    // Losing the file costs the lists, which is worth no interruption here.
  }
  for (const listener of listeners) listener()
}
