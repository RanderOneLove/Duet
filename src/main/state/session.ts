import { app } from 'electron'
import { readFileSync, writeFileSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Track, WaveChoice } from '@shared/domain'

/**
 * What was playing when the app last closed, so it comes back with the same
 * track loaded (paused). Kept out of settings.json — it is machine state, not
 * something a person edits.
 */

export interface Session {
  queue: Track[]
  index: number
  positionMs: number
  /**
   * Была ли это волна и какая.
   *
   * Без этого станция не переживала перезапуск: очередь возвращалась, а
   * приложение не знало, что она бесконечная. Треки доигрывали и всё вставало
   * — при том, что станции есть чем продолжить, курсоры лежат в настройках.
   */
  waveService: WaveChoice | null
  /** Трек, вокруг которого была станция. null — обычная «Моя волна». */
  waveSeed: Track | null
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
      positionMs: Math.max(0, Number(raw.positionMs ?? 0)),
      // Файл от прежней версии про волну ничего не знает — значит, не волна.
      waveService:
        raw.waveService === 'yandex' || raw.waveService === 'vk' || raw.waveService === 'both'
          ? raw.waveService
          : null,
      waveSeed: raw.waveSeed && typeof raw.waveSeed === 'object' ? (raw.waveSeed as Track) : null
    }
  } catch {
    // Missing or corrupt: simply start with nothing loaded.
    return null
  }
}

/** Уже идущая запись и то, что в ней: одно и то же писать дважды незачем. */
let writing = false
let lastPayload = ''

function payloadOf(session: Session): string {
  const start = Math.max(0, session.index - MAX_TRACKS / 2)
  const queue = session.queue.slice(start, start + MAX_TRACKS)
  return JSON.stringify({
    queue,
    index: session.index - start,
    positionMs: session.positionMs,
    waveService: session.waveService,
    waveSeed: session.waveSeed
  })
}

/**
 * Записать сессию, не задерживая главный поток. Раньше это был синхронный
 * `writeFileSync` двухсот треков каждые несколько секунд — всё это время
 * процесс не отвечал ни на команды плеера, ни на запросы каталога.
 */
export function writeSession(session: Session): void {
  const payload = payloadOf(session)
  if (writing || payload === lastPayload) return
  lastPayload = payload
  writing = true
  void writeFile(FILE(), payload)
    .catch(() => undefined)
    .finally(() => {
      writing = false
    })
}

/**
 * Записать немедленно и синхронно — на выходе из приложения, где обещать
 * дописать «потом» уже некому.
 */
export function flushSession(session: Session): void {
  try {
    writeFileSync(FILE(), payloadOf(session))
  } catch {
    // Losing the session is not worth surfacing to the user.
  }
}
