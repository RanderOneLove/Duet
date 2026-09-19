import { randomBytes } from 'node:crypto'
import type { JamMessage } from '@shared/jam'
import { getSettings, setSettings } from '../state/settings'
import { ensureInvite } from './host'

/**
 * Общая сессия — «Duet Jam».
 *
 * У совместного прослушивания две разные ссылки, и разница между ними в правах,
 * а не в оформлении. Обычная зовёт послушать: гость слышит то же самое и ничем
 * не управляет. Эта — зовёт участвовать: по ней можно добавлять треки в общую
 * очередь и переключать.
 *
 * Поэтому у неё свой секрет, отдельный от кода сессии. Код знают все, кому
 * когда-либо давали послушать, и если бы права держались на нём, отозвать их
 * было бы нечем. Пропуск меняется одной кнопкой: старая ссылка перестаёт
 * работать, а слушатели остаются на месте.
 */

type Handler = (message: JamMessage) => void

const RETRY_MS = [1000, 2000, 4000, 8000, 15_000]

let listening: { stop: boolean; controller: AbortController | null } | null = null

/** Пропуск ведущего: заводится при первом открытии сессии. */
export function ensureJamPass(): string {
  const stored = getSettings().jamPass
  if (stored) return stored
  const pass = randomBytes(12).toString('base64url')
  setSettings({ jamPass: pass })
  return pass
}

export function jamLink(): string | null {
  const settings = getSettings()
  if (!settings.listenTogether || !settings.togetherCode || !settings.jamPass) return null
  return `${settings.joinPageUrl}?join=${encodeURIComponent(settings.togetherCode)}&jam=${encodeURIComponent(
    settings.jamPass
  )}`
}

/**
 * Открыть общую сессию: сказать ретранслятору пропуск и начать слушать просьбы.
 *
 * Сессия на ретрансляторе заводится первой публикацией, поэтому здесь она уже
 * есть: без играющей музыки звать участников не во что.
 */
export async function openJam(onMessage: Handler): Promise<boolean> {
  closeJamLocally()
  const pass = ensureJamPass()
  const { code, key } = ensureInvite()

  if (!(await tellRelay(code, key, pass))) return false

  const own = { stop: false, controller: null as AbortController | null }
  listening = own
  void listen(own, code, key, onMessage)
  return true
}

/** Закрыть общую сессию: пропуск на ретрансляторе обнуляется. */
export async function closeJam(): Promise<void> {
  closeJamLocally()
  const { code, key } = ensureInvite()
  await tellRelay(code, key, null)
}

/**
 * Выдать новый пропуск вместо прежнего.
 *
 * Тому, кто раздал ссылку не тем, нужна не кнопка «закрыть», а именно эта:
 * сессия продолжается, музыка не прерывается, а прежние ссылки мертвы.
 */
export async function rotateJam(onMessage: Handler): Promise<boolean> {
  setSettings({ jamPass: randomBytes(12).toString('base64url') })
  return openJam(onMessage)
}

export function isJamOpen(): boolean {
  return listening !== null && !listening.stop
}

function closeJamLocally(): void {
  const current = listening
  listening = null
  if (!current) return
  current.stop = true
  current.controller?.abort()
}

/** Сказать ретранслятору, какой сейчас пропуск. null — закрыть сессию. */
async function tellRelay(code: string, key: string, pass: string | null): Promise<boolean> {
  try {
    const response = await fetch(`${getSettings().relayUrl}/s/${encodeURIComponent(code)}/jam`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Duet-Key': key },
      body: JSON.stringify({ jam: pass }),
      signal: AbortSignal.timeout(8000)
    })
    return response.ok
  } catch {
    return false
  }
}

/**
 * Держать обратный канал открытым, восстанавливая его после обрыва.
 *
 * Та же беда, что и у слушателя: поток рвётся не только когда сессия кончилась.
 * Разница в том, что здесь молчание незаметно — музыка играет, просто просьбы
 * перестают доходить, — и потому восстанавливаться надо тем более упорно.
 */
async function listen(
  own: { stop: boolean; controller: AbortController | null },
  code: string,
  key: string,
  onMessage: Handler
): Promise<void> {
  let attempt = 0

  while (!own.stop) {
    const controller = new AbortController()
    own.controller = controller
    try {
      const response = await fetch(`${getSettings().relayUrl}/s/${encodeURIComponent(code)}/inbox`, {
        headers: { Accept: 'text/event-stream', 'X-Duet-Key': key },
        signal: controller.signal
      })
      if (response.ok && response.body) {
        attempt = 0
        await read(response.body, onMessage)
      }
    } catch {
      // Обрыв — такой же повод попробовать снова, как и закрытый поток.
    }

    if (own.stop) return
    await wait(RETRY_MS[Math.min(attempt, RETRY_MS.length - 1)]!)
    attempt += 1
  }
}

async function read(body: ReadableStream<Uint8Array>, onMessage: Handler): Promise<void> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  try {
    for (;;) {
      const { value, done } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })

      let split = buffer.indexOf('\n\n')
      while (split >= 0) {
        const chunk = buffer.slice(0, split)
        buffer = buffer.slice(split + 2)
        split = buffer.indexOf('\n\n')
        if (chunk.startsWith(':')) continue
        const data = chunk
          .split('\n')
          .filter((line) => line.startsWith('data:'))
          .map((line) => line.slice(5).trim())
          .join('')
        if (!data) continue
        try {
          const message = JSON.parse(data) as JamMessage
          if (message && typeof message.type === 'string') onMessage(message)
        } catch {
          // Мусор в потоке пропускаем: следующая просьба важнее.
        }
      }
    }
  } catch {
    // Обрыв разбирает тот, кто нас позвал.
  }
}

/**
 * Просьба участника ведущему.
 *
 * Возвращает, дошла ли она: ретранслятор отвечает числом слушающих, и ноль
 * означает, что ведущий сейчас не на связи. Об этом участнику надо сказать —
 * иначе он будет жать кнопку и думать, что сломалось у него.
 */
export async function sayToHost(code: string, pass: string, message: JamMessage): Promise<boolean> {
  try {
    const response = await fetch(`${getSettings().relayUrl}/s/${encodeURIComponent(code)}/say`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Duet-Jam': pass },
      body: JSON.stringify(message),
      signal: AbortSignal.timeout(8000)
    })
    if (!response.ok) return false
    const data = (await response.json().catch(() => null)) as { delivered?: number } | null
    return (data?.delivered ?? 0) > 0
  } catch {
    return false
  }
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
