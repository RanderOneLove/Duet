import { app, shell } from 'electron'
import { createWriteStream } from 'node:fs'
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { Track } from '@shared/domain'
import { describeTrack, type DownloadItem, type DownloadsState } from '@shared/downloads'
import { resolveStream } from '../sources/registry'
import { getSettings } from '../state/settings'
import { BROWSER_HEADERS, downloadHls, isHls } from './hls'

/**
 * Offline copies of tracks. The index is the source of truth for what the
 * Downloads screen shows; the audio files sit next to it on disk with readable
 * names so the folder is useful on its own.
 */

const CONCURRENCY = 2
/** Progress updates are throttled — a download fires thousands of chunks. */
const PROGRESS_INTERVAL_MS = 250

let items = new Map<string, DownloadItem>()
let loaded = false
const running = new Set<string>()

type Listener = (state: DownloadsState) => void
const listeners = new Set<Listener>()

export function onDownloadsChanged(listener: Listener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function downloadsFolder(): string {
  // A folder the user picked wins; otherwise files live with the app's data.
  return getSettings().downloadsPath || join(app.getPath('userData'), 'downloads')
}

/** The ceiling on automatic downloads, in bytes. */
function limitBytes(): number {
  return Math.max(0, getSettings().downloadLimitGb) * 1024 * 1024 * 1024
}

function indexFile(): string {
  return join(app.getPath('userData'), 'downloads.json')
}

export async function loadDownloads(): Promise<void> {
  if (loaded) return
  loaded = true
  try {
    const raw = JSON.parse(await readFile(indexFile(), 'utf8')) as DownloadItem[]
    for (const item of raw) {
      // Anything interrupted by a quit is not on disk in a usable state.
      const restored = { ...item, auto: item.auto === true }
      items.set(item.trackId, restored.status === 'done' ? restored : { ...restored, status: 'failed', progress: 0 })
    }
  } catch {
    // No index yet.
  }
  await pruneMissingFiles()
  notify()
}

export function getDownloads(): DownloadsState {
  const list = [...items.values()].sort((a, b) => b.addedAt - a.addedAt)
  return {
    items: list,
    totalBytes: list.reduce((sum, item) => (item.status === 'done' ? sum + item.bytes : sum), 0),
    limitBytes: limitBytes(),
    folder: downloadsFolder()
  }
}

/** Absolute path of a finished download, or null. */
export function downloadedFile(trackId: string): string | null {
  const item = items.get(trackId)
  return item && item.status === 'done' && item.file ? item.file : null
}

export function isDownloaded(trackId: string): boolean {
  return downloadedFile(trackId) !== null
}

/**
 * Queue tracks that are not already downloaded or in flight. Automatic
 * downloads stay inside the configured limit; a download the user asked for is
 * always honoured, because silently ignoring a button press is worse than
 * going a little over.
 */
export async function addDownloads(tracks: Track[], auto = false): Promise<void> {
  let added = false

  for (const track of tracks) {
    if (!track.available) continue
    const existing = items.get(track.id)
    if (existing && (existing.status === 'done' || existing.status === 'downloading')) continue
    if (auto && !makeRoom()) break

    items.set(track.id, {
      ...describeTrack(track),
      status: 'queued',
      progress: 0,
      bytes: 0,
      file: null,
      error: null,
      addedAt: existing?.addedAt ?? Date.now(),
      // Asking again for something the rule already fetched makes it the
      // user's copy, so it stops being a candidate for eviction.
      auto: auto && (existing?.auto ?? true)
    })
    added = true
  }

  if (!added) return
  notify()
  await save()
  pump()
}

/**
 * Drop the oldest automatic downloads until the folder is back under its
 * limit. Returns false when nothing more can be freed, which is the signal to
 * stop queueing automatic downloads.
 */
function makeRoom(): boolean {
  const limit = limitBytes()
  if (limit <= 0) return false

  while (usedBytes() >= limit) {
    const oldest = [...items.values()]
      .filter((item) => item.auto && item.status === 'done')
      .sort((a, b) => a.addedAt - b.addedAt)[0]
    if (!oldest) return false
    items.delete(oldest.trackId)
    if (oldest.file) void rm(oldest.file, { force: true }).catch(() => undefined)
  }
  return true
}

function usedBytes(): number {
  let total = 0
  for (const item of items.values()) if (item.status === 'done') total += item.bytes
  return total
}

export async function retryDownload(trackId: string): Promise<void> {
  const item = items.get(trackId)
  if (!item || item.status === 'downloading') return
  items.set(trackId, { ...item, status: 'queued', progress: 0, error: null })
  notify()
  pump()
}

export async function removeDownload(trackId: string): Promise<void> {
  const item = items.get(trackId)
  if (!item) return
  items.delete(trackId)
  if (item.file) await rm(item.file, { force: true }).catch(() => undefined)
  notify()
  await save()
}

export async function openDownloadsFolder(): Promise<void> {
  const folder = downloadsFolder()
  await mkdir(folder, { recursive: true }).catch(() => undefined)
  await shell.openPath(folder)
}

// ---- the queue ------------------------------------------------------------

function pump(): void {
  if (running.size >= CONCURRENCY) return
  const next = [...items.values()].find((item) => item.status === 'queued' && !running.has(item.trackId))
  if (!next) return
  running.add(next.trackId)
  void run(next.trackId).finally(() => {
    running.delete(next.trackId)
    pump()
  })
  // Fill the remaining slot in the same tick.
  if (running.size < CONCURRENCY) pump()
}

async function run(trackId: string): Promise<void> {
  const item = items.get(trackId)
  if (!item) return

  update(trackId, { status: 'downloading', progress: 0, error: null })

  const base = fileFor(item)
  const temp = `${base}.part`
  // The codec is only known once the stream is open, so the name is finished later.
  let target = `${base}.mp3`

  try {
    // Stream links are short-lived, so this is resolved at download time.
    const url = await resolveStream(toTrack(item))
    await mkdir(dirname(temp), { recursive: true })
    let received = 0
    let lastReport = 0

    if (isHls(url)) {
      // VK: a few dozen small encrypted segments, assembled in memory.
      const { data, extension } = await downloadHls(url, (fraction, bytes) => {
        const now = Date.now()
        if (now - lastReport < PROGRESS_INTERVAL_MS) return
        lastReport = now
        update(trackId, { bytes, progress: fraction })
      })
      target = `${base}.${extension}`
      received = data.length
      await writeFile(temp, data)
    } else {
      // Yandex: one plain file, streamed straight to disk.
      const response = await fetch(url, { headers: BROWSER_HEADERS })
      if (!response.ok || !response.body) throw new Error(`сервис ответил ${response.status}`)

      const total = Number(response.headers.get('content-length') ?? 0)
      const body = Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0])
      body.on('data', (chunk: Buffer) => {
        received += chunk.length
        const now = Date.now()
        if (now - lastReport < PROGRESS_INTERVAL_MS) return
        lastReport = now
        update(trackId, { bytes: received, progress: total > 0 ? received / total : 0 })
      })

      await pipeline(body, createWriteStream(temp))

      // A truncated file plays as a broken track; treat it as a failure.
      if (total > 0 && received < total * 0.98) throw new Error('файл скачался не полностью')
    }

    await rm(target, { force: true }).catch(() => undefined)
    await rename(temp, target)

    update(trackId, { status: 'done', progress: 1, bytes: received, file: target, error: null })
    // This download may have been what pushed the folder over its limit.
    if (item.auto) makeRoom()
  } catch (error) {
    await rm(temp, { force: true }).catch(() => undefined)
    update(trackId, {
      status: 'failed',
      progress: 0,
      file: null,
      error: error instanceof Error ? error.message : String(error)
    })
  }
  await save()
}

// ---- helpers --------------------------------------------------------------

function toTrack(item: DownloadItem): Track {
  return {
    id: item.trackId,
    service: item.service,
    nativeId: item.nativeId,
    title: item.title,
    artists: item.artists,
    artistRefs: [],
    album: item.album,
    albumId: null,
    durationMs: item.durationMs,
    coverUrl: item.coverUrl,
    liked: false,
    available: true
  }
}

/** Readable on disk, and unique even when two tracks share a name. The
 *  extension is appended once the codec is known. */
function fileFor(item: DownloadItem): string {
  const artist = safe(item.artists.join(', ')) || 'Unknown'
  const title = safe(item.title) || 'Track'
  return join(downloadsFolder(), item.service, `${artist} - ${title} [${item.nativeId}]`)
}

function safe(text: string): string {
  return text
    .replace(/[<>:"/\\|?* -]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80)
}

/** Files deleted behind our back should not keep claiming to be downloaded. */
async function pruneMissingFiles(): Promise<void> {
  for (const item of items.values()) {
    if (item.status !== 'done' || !item.file) continue
    const ok = await stat(item.file).then(
      () => true,
      () => false
    )
    if (!ok) items.set(item.trackId, { ...item, status: 'failed', file: null, progress: 0, error: 'файл удалён' })
  }
}

function update(trackId: string, patch: Partial<DownloadItem>): void {
  const item = items.get(trackId)
  if (!item) return
  items.set(trackId, { ...item, ...patch })
  notify()
}

let saving: Promise<void> | null = null
async function save(): Promise<void> {
  // Serialise writes; several downloads finish at once.
  const write = async (): Promise<void> => {
    try {
      await writeFile(indexFile(), JSON.stringify([...items.values()], null, 0))
    } catch {
      // Losing the index only costs the user their list, not the files.
    }
  }
  saving = saving ? saving.then(write) : write()
  await saving
}

function notify(): void {
  const state = getDownloads()
  for (const listener of listeners) listener(state)
}

/** Only for tests and a clean shutdown. */
export function resetDownloads(): void {
  items = new Map()
  loaded = false
}
