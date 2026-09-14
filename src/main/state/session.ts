import { app } from 'electron'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Track } from '@shared/domain'

/**
 * What was playing when the app last closed, so it comes back with the same
 * track loaded (paused). Kept out of settings.json — it is machine state, not
 * something a person edits.
 */

export interface Session {
  queue: Track[]
  index: number
  positionMs: number
}

const FILE = (): string => join(app.getPath('userData'), 'session.json')

/** Long queues are mostly noise to restore; keep it to a sane slice. */
const MAX_TRACKS = 200

export function readSession(): Session | null {
  try {
    const raw = JSON.parse(readFileSync(FILE(), 'utf8')) as Partial<Session>
    if (!Array.isArray(raw.queue) || raw.queue.length === 0) return null
    const index = Number(raw.index ?? 0)
    if (!Number.isInteger(index) || index < 0 || index >= raw.queue.length) return null
    return {
      // A file written by an older version predates some fields, and a
      // half-built Track crashes whatever reads it. Fill them in here so
      // nothing downstream has to wonder which version wrote this.
      queue: raw.queue.map((track) => ({ ...track, artistRefs: track.artistRefs ?? [] })),
      index,
      positionMs: Math.max(0, Number(raw.positionMs ?? 0))
    }
  } catch {
    // Missing or corrupt: simply start with nothing loaded.
    return null
  }
}

export function writeSession(session: Session): void {
  try {
    const start = Math.max(0, session.index - MAX_TRACKS / 2)
    const queue = session.queue.slice(start, start + MAX_TRACKS)
    writeFileSync(
      FILE(),
      JSON.stringify({ queue, index: session.index - start, positionMs: session.positionMs })
    )
  } catch {
    // Losing the session is not worth surfacing to the user.
  }
}
