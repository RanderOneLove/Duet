import { app } from 'electron'
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import type { ServiceId, Track } from '@shared/domain'
import type { HistoryInfo, PlayRecord, PlaySource } from '@shared/history'
import { currentTrack, type PlayerState } from '@shared/player'
import { HOST_ID } from '@shared/jam'
import { onPlayerChanged } from './player/engine'
import { takeRescued } from './player/rescues'
import { getSettings } from './state/settings'

/**
 * Журнал прослушиваний — то, из чего к концу года соберутся итоги.
 *
 * Ни VK, ни Яндекс не отдадут историю по обоим сервисам сразу, поэтому её
 * ведёт сам Duet и только на этом компьютере: файл на месяц, строка JSON на
 * прослушивание. Наружу журнал не уходит.
 *
 * Журнал не вмешивается в плеер, а смотрит на его состояние: какой трек
 * текущий и звучит ли он. Так в учёт попадает всё, что слышно, — откуда бы
 * трек ни заиграл, — и ничего, что не звучало.
 */

/** Засчитывается, если звучало хотя бы столько — или половину трека. */
const COUNTED_MS = 30_000
/** «Дослушан» — дошёл почти до конца. */
const FINISHED_SHARE = 0.9
/**
 * Самый большой промежуток между двумя отчётами, который считается звучанием.
 * Отчёты идут четыре раза в секунду; длинный разрыв — это сон компьютера или
 * зависший поток, а не две минуты музыки.
 */
const MAX_STEP_MS = 2000

interface Open {
  track: Track
  /** Когда впервые зазвучал; 0 — ещё не звучал (восстановлен на паузе). */
  startedAt: number
  listened: number
  /** Время последнего отчёта, пока трек звучал; null — на паузе. */
  lastAt: number | null
  durationMs: number
  maxPositionMs: number
  source: PlaySource
  with: Set<string>
  lyrics: boolean
  rescuedFrom: ServiceId | null
}

let open: Open | null = null

function folder(): string {
  return join(app.getPath('userData'), 'history')
}

function fileFor(time: number): string {
  const date = new Date(time)
  const month = String(date.getMonth() + 1).padStart(2, '0')
  return join(folder(), `${date.getFullYear()}-${month}.jsonl`)
}

export function startHistory(): void {
  onPlayerChanged(observe)
}

/** Открыли текст играющего трека. */
export function noteLyricsViewed(trackId: string): void {
  if (open?.track.id === trackId) open.lyrics = true
}

/** Перед выходом: дописать то, что звучало до последней секунды. */
export function flushHistory(): void {
  close(Date.now())
}

export function clearHistory(): void {
  open = null
  rmSync(folder(), { recursive: true, force: true })
}

/** Весь журнал, от старых записей к новым. Битые строки пропускаются. */
export function readHistory(): PlayRecord[] {
  const dir = folder()
  if (!existsSync(dir)) return []
  const records: PlayRecord[] = []
  for (const name of readdirSync(dir).filter((file) => file.endsWith('.jsonl')).sort()) {
    for (const line of readFileSync(join(dir, name), 'utf8').split('\n')) {
      if (!line) continue
      try {
        records.push(JSON.parse(line) as PlayRecord)
      } catch {
        // Строка, недописанная при сбое, — не повод терять остальной файл.
      }
    }
  }
  return records.sort((a, b) => a.t - b.t)
}

/** Дописать готовые записи — для пробного журнала в замерах. */
export function appendHistory(records: PlayRecord[]): void {
  mkdirSync(folder(), { recursive: true })
  const byFile = new Map<string, string[]>()
  for (const record of records) {
    const file = fileFor(record.t)
    byFile.set(file, [...(byFile.get(file) ?? []), JSON.stringify(record)])
  }
  for (const [file, lines] of byFile) appendFileSync(file, `${lines.join('\n')}\n`, 'utf8')
}

export function historyInfo(): HistoryInfo {
  const dir = folder()
  if (!existsSync(dir)) return { plays: 0, since: null }
  let plays = 0
  let since: number | null = null
  for (const name of readdirSync(dir).filter((file) => file.endsWith('.jsonl')).sort()) {
    const lines = readFileSync(join(dir, name), 'utf8').split('\n').filter(Boolean)
    plays += lines.length
    if (since === null && lines.length > 0) {
      try {
        since = (JSON.parse(lines[0]) as PlayRecord).t
      } catch {
        // Битая строка — не повод не показать остальное.
      }
    }
  }
  return { plays, since }
}

function observe(state: PlayerState): void {
  const now = Date.now()
  const track = currentTrack(state)

  if (open && (!track || track.id !== open.track.id)) close(now)

  /*
   * Тот же трек заново: «повторять трек» перематывает в начало, не меняя
   * текущего. Дошёл почти до конца и вернулся к началу — это новое
   * прослушивание, а не продолжение старого.
   */
  if (
    open &&
    open.durationMs > 0 &&
    open.maxPositionMs >= open.durationMs * FINISHED_SHARE &&
    state.positionMs < 3000
  ) {
    close(now)
  }

  /*
   * В первый миг после смены трека в состоянии ещё лежат позиция и «играет»
   * прежнего: движок сначала сдвигает номер, потом грузит. Поэтому на этом
   * отчёте трек только заводится, а считать начинаем со следующего.
   */
  if (!open && track) {
    open = begin(track, state)
    return
  }
  if (!open) return
  // Тот же трек, но свежий: лайк, поставленный посреди песни, тоже в счёт.
  if (track) open.track = track

  if (open.lastAt !== null) open.listened += Math.min(now - open.lastAt, MAX_STEP_MS)
  const sounding = state.playing && !state.loading
  open.lastAt = sounding ? now : null
  if (sounding && open.startedAt === 0) open.startedAt = now
  if (state.durationMs > 0) open.durationMs = state.durationMs
  open.maxPositionMs = Math.max(open.maxPositionMs, state.positionMs)
  // Общая сессия, начатая посреди трека, — тоже «вместе».
  if (open.source === 'queue' || open.source === 'wave' || open.source === 'trackWave') {
    const source = sourceOf(state)
    if (source !== 'queue' && source !== 'wave' && source !== 'trackWave') open.source = source
  }
  const self = state.jamSelfId ?? HOST_ID
  for (const person of state.jamRoom.people) {
    if (person.id !== self) open.with.add(person.name)
  }
}

function begin(track: Track, state: PlayerState): Open {
  const from = takeRescued(track.id)
  return {
    track,
    startedAt: 0,
    listened: 0,
    lastAt: null,
    durationMs: state.durationMs || track.durationMs,
    maxPositionMs: 0,
    source: sourceOf(state),
    with: new Set(),
    lyrics: false,
    rescuedFrom: from
  }
}

function sourceOf(state: PlayerState): PlaySource {
  if (state.following) return state.jamGuest ? 'jamGuest' : 'follow'
  if (state.jamOpen) return 'jamHost'
  if (state.waveSeed) return 'trackWave'
  if (state.waveService) return 'wave'
  return 'queue'
}

function close(now: number): void {
  const done = open
  open = null
  if (!done || done.startedAt === 0) return
  if (done.lastAt !== null) done.listened += Math.min(now - done.lastAt, MAX_STEP_MS)

  const counted = done.listened >= COUNTED_MS || (done.durationMs > 0 && done.listened >= done.durationMs / 2)
  if (!counted || !getSettings().keepHistory) return

  const track = done.track
  const record: PlayRecord = {
    t: done.startedAt,
    id: track.id,
    s: track.service,
    n: track.title,
    a: track.artists,
    al: track.album,
    c: track.coverUrl,
    d: done.durationMs,
    l: Math.round(done.listened),
    src: done.source
  }
  if (done.durationMs > 0 && done.maxPositionMs >= done.durationMs * FINISHED_SHARE) record.f = 1
  if (done.rescuedFrom) record.r = done.rescuedFrom
  if (done.lyrics) record.ly = 1
  if (track.liked) record.lk = 1
  if (done.with.size > 0) record.w = [...done.with]

  try {
    mkdirSync(folder(), { recursive: true })
    // Строка на трек раз в несколько минут — писать сразу и синхронно проще,
    // чем копить: выход из приложения ничего не потеряет.
    appendFileSync(fileFor(record.t), `${JSON.stringify(record)}\n`, 'utf8')
  } catch (error) {
    console.warn('[history] не удалось записать прослушивание:', error)
  }
}
