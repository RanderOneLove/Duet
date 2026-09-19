import type { Lyrics, Track } from '@shared/domain'
import { parseLrc } from '../library/lrc'

/**
 * Тексты из открытой базы LRCLIB — когда их нет ни у VK, ни у Яндекса.
 *
 * База открытая и без ключа, и — в отличие от всего, чем обычно пробуют
 * закрыть эту дыру, — отдаёт сразу размеченный текст, тот же LRC, что и
 * Яндекс. У Genius текстов в API нет вовсе: они их лицензируют и не
 * раздают, оставался бы разбор их страницы. У Musixmatch нужен ключ, а
 * синхронный текст лежит в платном тарифе.
 *
 * Уходит отсюда только «исполнитель, название, длительность» — ни аккаунта,
 * ни того, что человек слушал раньше.
 */

const BASE = 'https://lrclib.net/api'
/** Назваться по имени — просьба самой базы к тем, кто её использует. */
const AGENT = 'Duet (https://github.com/RanderOneLove/Duet)'
const TIMEOUT_MS = 6000

/**
 * Длительность база использует, чтобы отличить версии одной песни. Своя
 * бывает на пару секунд другой — у сервисов разные мастера, — поэтому сперва
 * спрашиваем точно, а потом без неё.
 */
export async function lrclibLyrics(track: Track): Promise<Lyrics | null> {
  const artist = track.artists[0]
  if (!artist || !track.title) return null

  const seconds = track.durationMs > 0 ? Math.round(track.durationMs / 1000) : 0
  const found =
    (seconds > 0 ? await ask(artist, track.title, seconds) : null) ?? (await ask(artist, track.title))
  if (!found) return null

  const synced = typeof found.syncedLyrics === 'string' ? found.syncedLyrics : ''
  const plain = typeof found.plainLyrics === 'string' ? found.plainLyrics.trim() : ''

  if (synced) {
    const lines = parseLrc(synced)
    if (lines.length > 0) {
      return { text: lines.map((line) => line.text).join(String.fromCharCode(10)), lines }
    }
  }

  /*
   * Без меток текст остаётся текстом.
   *
   * Расставить их самим нечем: подсветка «по длине песни» разошлась бы с
   * первым же проигрышем и врала бы тем убедительнее, чем ровнее выглядит.
   * Поэтому — то же правило, что и для VK: нет меток, нет подсветки.
   */
  return plain ? { text: plain, lines: [] } : null
}

interface Found {
  syncedLyrics?: unknown
  plainLyrics?: unknown
  instrumental?: unknown
}

async function ask(artist: string, title: string, seconds?: number): Promise<Found | null> {
  const query = new URLSearchParams({ artist_name: artist, track_name: title })
  if (seconds) query.set('duration', String(seconds))

  try {
    const response = await fetch(`${BASE}/get?${query}`, {
      headers: { 'User-Agent': AGENT },
      signal: AbortSignal.timeout(TIMEOUT_MS)
    })
    // 404 здесь — обычный ответ «не знаю такой песни», а не поломка.
    if (!response.ok) return null
    const data = (await response.json()) as Found
    // Инструментал базе известен, и текста у него нет по существу.
    return data?.instrumental === true ? null : data
  } catch {
    return null
  }
}
