import { randomBytes } from 'node:crypto'
import type { Track } from '@shared/domain'
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
  const shared: SharedState = {
    track,
    positionMs: Math.round(state.positionMs),
    playing: state.playing,
    at: Date.now()
  }

  // Позиция меняется постоянно, поэтому в сравнение она не входит: обновление
  // уходит по смене трека, паузе или по таймеру.
  const signature = `${track?.id ?? ''}|${state.playing}`
  const stale = Date.now() - lastAt > HEARTBEAT_MS
  if (!force && signature === lastSent && !stale) return

  lastSent = signature
  lastAt = Date.now()

  const { code, key } = ensureInvite()
  try {
    await fetch(`${settings.relayUrl}/s/${code}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Duet-Key': key },
      body: JSON.stringify(shared),
      signal: AbortSignal.timeout(8000)
    })
  } catch {
    // Ретранслятор недоступен — это не повод мешать воспроизведению здесь.
  }
}

/** Забыть последнюю отправку, чтобы следующая ушла наверняка. */
export function resetPublishing(): void {
  lastSent = ''
  lastAt = 0
}
