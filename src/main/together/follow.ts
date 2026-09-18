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
type Trouble = () => void

/**
 * Паузы между попытками восстановить связь. Поток рвётся не только когда
 * ведущий ушёл: у ретранслятора бывает перезапуск, у ноутбука — сон, у
 * вай-фая — своё мнение. Раньше любой такой обрыв заканчивал совместное
 * прослушивание насовсем, и человеку оставалось гадать, почему музыка встала.
 */
const RETRY_MS = [1000, 2000, 4000, 8000, 15_000]

/** Сколько всего добиваться связи, прежде чем признать сессию законченной. */
const GIVE_UP_MS = 120_000

interface Session {
  code: string
  controller: AbortController | null
  stopped: boolean
}

let session: Session | null = null

export function isFollowing(): boolean {
  return session !== null && !session.stopped
}

/**
 * Подключиться к сессии. Возвращает false, если сессии нет — ведущий мог
 * закрыть приложение между тем, как дал ссылку, и тем, как по ней пришли.
 *
 * Дальше связь держится сама: обрыв — это повод переподключиться, а не конец.
 * `onTrouble` зовётся на каждый обрыв, чтобы об этом можно было сказать вслух;
 * `onEnded` — только когда добиваться стало нечего.
 */
export async function startFollowing(
  code: string,
  onState: Handler,
  onEnded: Ended,
  onTrouble?: Trouble
): Promise<boolean> {
  stopFollowing()

  const own: Session = { code, controller: null, stopped: false }
  session = own

  const stream = await open(own)
  if (!stream) {
    if (session === own) session = null
    return false
  }

  void keepFollowing(own, stream, onState, onEnded, onTrouble)
  return true
}

export function stopFollowing(): void {
  const current = session
  session = null
  if (!current) return
  current.stopped = true
  current.controller?.abort()
}

/** Открыть поток. null означает «не вышло», а не «сессии не существует». */
async function open(own: Session): Promise<ReadableStream<Uint8Array> | null> {
  const controller = new AbortController()
  own.controller = controller
  try {
    const response = await fetch(`${getSettings().relayUrl}/s/${encodeURIComponent(own.code)}`, {
      headers: { Accept: 'text/event-stream' },
      signal: controller.signal
    })
    if (!response.ok || !response.body) return null
    return response.body
  } catch {
    return null
  }
}

/**
 * Читать поток, а когда он кончится — открывать заново, пока есть смысл.
 *
 * Смысл кончается по времени, а не по числу попыток: важно не сколько раз мы
 * постучались, а сколько человек уже сидит без музыки. Отсчёт идёт от первого
 * обрыва и сбрасывается, как только пришло настоящее событие, — значит, связь
 * снова живая, даже если перед этим она рвалась десять раз.
 */
async function keepFollowing(
  own: Session,
  first: ReadableStream<Uint8Array>,
  onState: Handler,
  onEnded: Ended,
  onTrouble?: Trouble
): Promise<void> {
  let stream: ReadableStream<Uint8Array> | null = first
  let troubleSince = 0
  let attempt = 0

  for (;;) {
    if (stream) {
      const delivered = await readStream(stream, (state) => {
        troubleSince = 0
        attempt = 0
        onState(state)
      })
      if (own.stopped) return
      if (delivered) {
        troubleSince = 0
        attempt = 0
      }
      if (troubleSince === 0) {
        troubleSince = Date.now()
        onTrouble?.()
      }
    }

    if (own.stopped) return
    if (troubleSince !== 0 && Date.now() - troubleSince > GIVE_UP_MS) break

    await wait(RETRY_MS[Math.min(attempt, RETRY_MS.length - 1)]!)
    attempt += 1
    if (own.stopped) return

    stream = await open(own)
  }

  if (own.stopped) return
  if (session === own) session = null
  onEnded()
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Разбор потока событий. Формат простой настолько, что тянуть ради него
 * зависимость не за что: события разделены пустой строкой, полезное лежит
 * в строках `data:`. Возвращает, пришло ли хоть одно настоящее событие, —
 * по этому и видно, была ли связь живой.
 */
async function readStream(body: ReadableStream<Uint8Array>, onState: Handler): Promise<boolean> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let delivered = false

  const deliver = (state: SharedState): void => {
    delivered = true
    onState(state)
  }

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
        handleChunk(chunk, deliver)
      }
    }
  } catch {
    // Обрыв связи — такой же конец, как и закрытие потока.
  }
  return delivered
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
