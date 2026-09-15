import { getSettings } from '../state/settings'
import type { SharedState } from './host'

/**
 * Следование за чужим прослушиванием.
 *
 * Держит открытым поток событий ретранслятора и отдаёт каждое состояние
 * наружу. Сам ничего не проигрывает — что делать с состоянием, решает движок.
 */

type Handler = (state: SharedState) => void
type Ended = () => void

let stop: (() => void) | null = null

export function isFollowing(): boolean {
  return stop !== null
}

/**
 * Подключиться к сессии. Возвращает false, если сессии нет — ведущий мог
 * закрыть приложение между тем, как дал ссылку, и тем, как по ней пришли.
 */
export async function startFollowing(
  code: string,
  onState: Handler,
  onEnded: Ended
): Promise<boolean> {
  stopFollowing()

  const controller = new AbortController()
  let response: Response
  try {
    response = await fetch(`${getSettings().relayUrl}/s/${encodeURIComponent(code)}`, {
      headers: { Accept: 'text/event-stream' },
      signal: controller.signal
    })
  } catch {
    return false
  }
  if (!response.ok || !response.body) return false

  stop = () => controller.abort()
  void readStream(response.body, onState, () => {
    // Поток кончился — сам по себе или потому, что мы его закрыли.
    if (stop) {
      stop = null
      onEnded()
    }
  })
  return true
}

export function stopFollowing(): void {
  const current = stop
  stop = null
  current?.()
}

/**
 * Разбор потока событий. Формат простой настолько, что тянуть ради него
 * зависимость не за что: события разделены пустой строкой, полезное лежит
 * в строках `data:`.
 */
async function readStream(
  body: ReadableStream<Uint8Array>,
  onState: Handler,
  onEnded: Ended
): Promise<void> {
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
        handleChunk(chunk, onState)
      }
    }
  } catch {
    // Обрыв связи — такой же конец, как и закрытие потока.
  }
  onEnded()
}

function handleChunk(chunk: string, onState: Handler): void {
  // Строка, начинающаяся с двоеточия, — сердцебиение, а не событие.
  if (chunk.startsWith(':')) return

  const data = chunk
    .split('\n')
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).trim())
    .join('')
  if (!data) return

  try {
    const parsed = JSON.parse(data) as SharedState
    if (typeof parsed?.at === 'number') onState(parsed)
  } catch {
    // Мусор в потоке пропускаем: следующее событие важнее.
  }
}
