import type { Track } from '@shared/domain'

/** mm:ss for a millisecond duration. */
export function formatTime(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '0:00'
  const total = Math.floor(ms / 1000)
  const minutes = Math.floor(total / 60)
  const seconds = total % 60
  return `${minutes}:${String(seconds).padStart(2, '0')}`
}

/** Remaining time, shown as -m:ss in the card mini player. */
export function formatRemaining(durationMs: number, positionMs: number): string {
  if (durationMs <= 0) return '0:00'
  return `-${formatTime(Math.max(0, durationMs - positionMs))}`
}

export function ratio(durationMs: number, positionMs: number): number {
  if (durationMs <= 0) return 0
  return Math.max(0, Math.min(1, positionMs / durationMs))
}

/** "Artist — Title", used for tooltips and the tray. */
export function trackLabel(track: Track): string {
  const artists = track.artists.join(', ')
  return artists ? `${artists} — ${track.title}` : track.title
}
