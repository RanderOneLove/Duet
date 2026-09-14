import type { ServiceId, Track } from './domain'

export type DownloadStatus = 'queued' | 'downloading' | 'done' | 'failed'

/**
 * One track kept on disk. It carries enough of the track to render the
 * Downloads screen without going back to the service, so the list still works
 * when a service is disconnected.
 */
export interface DownloadItem {
  trackId: string
  service: ServiceId
  nativeId: string
  title: string
  artists: string[]
  album: string | null
  coverUrl: string | null
  durationMs: number
  status: DownloadStatus
  /** 0..1 while downloading, 1 once finished. */
  progress: number
  bytes: number
  /** Absolute path, once the file is fully written. */
  file: string | null
  error: string | null
  addedAt: number
  /** Queued by the auto-download rule rather than by the user. Only these are
   *  evicted when the folder outgrows its limit. */
  auto: boolean
}

export interface DownloadsState {
  items: DownloadItem[]
  /** Total bytes of finished downloads. */
  totalBytes: number
  /** Ceiling for automatic downloads; 0 when auto-download is off. */
  limitBytes: number
  folder: string
}

export const EMPTY_DOWNLOADS: DownloadsState = { items: [], totalBytes: 0, limitBytes: 0, folder: '' }

/** The subset of a track that the downloads index stores. */
export function describeTrack(track: Track): Pick<
  DownloadItem,
  'trackId' | 'service' | 'nativeId' | 'title' | 'artists' | 'album' | 'coverUrl' | 'durationMs'
> {
  return {
    trackId: track.id,
    service: track.service,
    nativeId: track.nativeId,
    title: track.title,
    artists: track.artists,
    album: track.album,
    coverUrl: track.coverUrl,
    durationMs: track.durationMs
  }
}

export function formatBytes(bytes: number): string {
  if (bytes <= 0) return '0 МБ'
  const mb = bytes / (1024 * 1024)
  if (mb < 1024) return `${mb.toFixed(mb < 10 ? 1 : 0)} МБ`
  return `${(mb / 1024).toFixed(2)} ГБ`
}
