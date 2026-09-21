import { randomBytes } from 'node:crypto'
import type { Track } from '@shared/domain'
import { JAM_QUEUE_LIMIT, type JamQueueItem } from '@shared/jam'
import type { PlayerState } from '@shared/player'
import { getSettings, setSettings } from '../state/settings'

/**
 * Публикация того, что здесь играет, чтобы приглашённые могли слушать то же
 * самое. Уходит только «какой трек и с какой секунды» — звук остаётся здесь,
 * каждый слушает из своего аккаунта.
 */

/** Что видит ведомый. */
export interface SharedState {
  track: Track | null
  positionMs: number
  playing: boolean
  /** Когда это было верно, по часам ведущего. */
  at: number
  /**
   * Ближайшие треки общей очереди и кто их предложил.
   *
   * Без этого участник видел только играющий трек и не мог проверить даже то,
   * дошёл ли его собственный: добавил — и тишина до самой смены трека.
   */
  next?: JamQueueItem[]
  /** Сколько всего слушает — чтобы участник видел то же число, что и ведущий. */
  listeners?: number
  /** Открыта ли общая сессия: по ней участник понимает, можно ли добавлять. */
  jam?: boolean
}

/**
 * Позиция тикает четыре раза в секунду, но слать её так часто незачем:
 * ведомый идёт по своим часам между обновлениями. Раз в столько секунд —
 * чтобы сессия не считалась брошенной и чтобы расхождение не копилось.
 */
const HEARTBEAT_MS = 15_000

let lastSent = ''
let lastAt = 0

/** Приглашение делается один раз и живёт в настройках: ссылка не должна меняться. */
export function ensureInvite(): { code: string; key: string } {
  const settings = getSettings()
  if (settings.togetherCode && settings.togetherKey) {
    return { code: settings.togetherCode, key: settings.togetherKey }
  }

  // Код уходит в ссылку и потому считается известным; ключ не уходит никуда
  // и отличает ведущего от того, кто просто увидел ссылку.
  const code = randomBytes(12).toString('base64url')
  const key = randomBytes(24).toString('base64url')
  setSettings({ togetherCode: code, togetherKey: key })
  return { code, key }
}

export function inviteLink(): string | null {
  const settings = getSettings()
  if (!settings.listenTogether || !settings.togetherCode) return null
  return `${settings.joinPageUrl}?join=${encodeURIComponent(settings.togetherCode)}`
}

/**
 * Отправить состояние, если оно того стоит. Молча ничего не делает, когда
 * совместное прослушивание выключено — это выключатель, а не пожелание.
 */
export async function publish(state: PlayerState, force = false): Promise<void> {
  const settings = getSettings()
  if (!settings.listenTogether) return

  const track = state.queue[state.index] ?? null
  const next = jamQueue(state)
  lastQueued = next.length
  const shared: SharedState = {
    track,
    positionMs: Math.round(state.positionMs),
    playing: state.playing,
    at: Date.now(),
    next,
    listeners,
    jam: state.jamOpen
  }

  /*
   * Позиция меняется постоянно, поэтому в сравнение она не входит: обновление
   * уходит по смене трека, паузе или по таймеру. Очередь — входит: добавленный
   * трек должен появиться у всех сразу, а не с ближайшей сменой.
   *
   * Вместе с очередью — имена предложивших. Ведущий узнаёт имя на один шаг
   * позже самого трека, и без имён в подписи та публикация считалась бы
   * повторной: трек у участников появлялся, а «кто добавил» — нет.
   */
  const queueMark = next.map((item) => `${item.id}~${item.by ?? ''}`).join(',')
  const signature = `${track?.id ?? ''}|${state.playing}|${queueMark}`
  const stale = Date.now() - lastAt > HEARTBEAT_MS
  if (!force && signature === lastSent && !stale) return

  /*
   * Отправки идут по одной и только последняя.
   *
   * Вызывают публикацию из обработчика изменений, не дожидаясь её конца, и
   * два состояния подряд — обычное дело: добавили трек, следом узнали, кто его
   * предложил. Отправленные наперегонки, они приходили к ретранслятору в любом
   * порядке, и у него оставалось то, что доехало последним, — то есть иногда
   * предыдущее. Участник видел очередь на шаг старее, чем она есть, и своего
   * добавления в ней не находил.
   */
  queued = { shared, signature }
  if (sending) return
  await drain()
}

let queued: { shared: SharedState; signature: string } | null = null
let sending = false

async function drain(): Promise<void> {
  sending = true
  try {
    while (queued) {
      const { shared, signature } = queued
      queued = null
      await send(shared, signature)
    }
  } finally {
    sending = false
  }
}

async function send(shared: SharedState, signature: string): Promise<void> {
  const { code, key } = ensureInvite()
  const body = fit(shared)
  lastBytes = body.length
  try {
    const response = await fetch(`${getSettings().relayUrl}/s/${code}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Duet-Key': key },
      body,
      signal: AbortSignal.timeout(8000)
    })
    lastStatus = response.status
    if (!response.ok) throw new Error(`ретранслятор ответил ${response.status}`)
    /*
     * Подпись ставится только теперь. Раньше она ставилась до отправки, и
     * неудавшаяся публикация считалась доставленной: следующая с тем же
     * содержимым отбрасывалась как повторная, и состояние у слушателей
     * застревало до ближайшей смены трека.
     */
    lastSent = signature
    lastAt = Date.now()
    // Ответ говорит, сколько сейчас слушает. Раньше мы его выбрасывали, и
    // ведущий не знал, подключился ли к нему вообще кто-нибудь.
    const data = (await response.json().catch(() => null)) as { followers?: number } | null
    listeners = typeof data?.followers === 'number' ? data.followers : 0
    misses = 0
  } catch {
    /*
     * Ретранслятор недоступен — это не повод мешать воспроизведению здесь.
     *
     * И не повод сразу писать «никто не слушает»: одна неудачная отправка чаще
     * всего значит моргнувшую сеть, а не то, что все ушли. Число сбрасывается
     * только когда не проходит несколько подряд.
     */
    misses += 1
    if (misses >= MISSES_BEFORE_ZERO) listeners = 0
  }
}

/**
 * Уложить состояние в то, что примет ретранслятор.
 *
 * У него восемь килобайт на тело, и очередь — не тот повод их перебрать:
 * играющий трек важнее списка. Поэтому при перегрузе укорачивается именно
 * очередь, по треку за раз, а не отбрасывается всё сообщение целиком — иначе
 * у слушателей застывала бы и сама музыка.
 */
const MAX_BODY = 8 * 1024

function fit(shared: SharedState): string {
  let body = JSON.stringify(shared)
  if (byteLength(body) <= MAX_BODY) return body
  const next = [...(shared.next ?? [])]
  while (next.length > 0) {
    next.pop()
    body = JSON.stringify({ ...shared, next })
    if (byteLength(body) <= MAX_BODY) return body
  }
  return JSON.stringify({ ...shared, next: [] })
}

function byteLength(text: string): number {
  return Buffer.byteLength(text, 'utf8')
}

/** Для проб: чем кончилась последняя публикация. */
export function publishStats(): { bytes: number; status: number; queued: number } {
  return { bytes: lastBytes, status: lastStatus, queued: lastQueued }
}

let lastBytes = 0
let lastStatus = 0
let lastQueued = 0

/** Сколько неудачных отправок подряд считать потерей слушателей. */
const MISSES_BEFORE_ZERO = 3

/** Сколько человек слушает вместе с вами прямо сейчас. */
let listeners = 0
let misses = 0

export function listenerCount(): number {
  return listeners
}

/**
 * Ближайшие треки очереди в том виде, в каком их видит участник.
 *
 * Берётся только начало: дальше десятка никто не заглядывает, а тело
 * состояния у ретранслятора ограничено.
 */
function jamQueue(state: PlayerState): JamQueueItem[] {
  if (state.index < 0) return []
  return state.queue.slice(state.index + 1, state.index + 1 + JAM_QUEUE_LIMIT).map((track) => ({
    id: track.id,
    title: track.title,
    artists: track.artists,
    coverUrl: track.coverUrl ?? null,
    ...(state.jamCredits[track.id] ? { by: state.jamCredits[track.id] } : {})
  }))
}

/** Забыть последнюю отправку, чтобы следующая ушла наверняка. */
export function resetPublishing(): void {
  lastSent = ''
  lastAt = 0
  misses = 0
}
