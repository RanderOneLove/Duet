import type { Track } from '@shared/domain'

/**
 * Узнавание одного и того же трека под разными личинами.
 *
 * Идентификаторы сервисов не совпадают ни между собой, ни даже внутри VK:
 * добавленный в избранное трек хранится как ваша собственная копия с новым
 * владельцем и новым номером, а из волны тот же трек приходит с исходными.
 * Поэтому сравнивать приходится по имени — нарочно грубо, потому что одна и
 * та же песня подписана то «feat.», то «ft.», то со скобкой про ремикс.
 */
export function matchKey(track: Pick<Track, 'title' | 'artists'>): string {
  return `${track.artists.join(' ')} ${track.title}`
    .toLowerCase()
    .replace(/\(.*?\)|\[.*?]/g, ' ')
    .replace(/feat\.?|ft\.?|prod\.?/g, ' ')
    .replace(/[^a-zа-яё0-9]+/gi, '')
}

/**
 * Выбрать из найденного у другого сервиса тот же самый трек.
 *
 * Совпадения имени мало: у песни бывают концертная версия, ремикс и чужой
 * кавер под тем же названием, и все они пройдут по огрублённому ключу.
 * Длительность различает их лучше всего — своя версия отличается на секунды,
 * чужая на десятки. Допуск в пять секунд: у сервисов разные мастера, и
 * одинаковая до миллисекунды длина — редкость.
 */
const CLOSE_ENOUGH_MS = 5000

export function pickTwin(original: Track, candidates: Track[]): Track | null {
  const key = matchKey(original)
  const named = candidates.filter((item) => matchKey(item) === key)
  if (named.length === 0) return null

  // Без длительности сравнивать нечем — берём первое по порядку выдачи:
  // сервисы ставят вперёд то, что считают основной версией.
  if (original.durationMs <= 0) return named[0]!

  const ranked = named
    .map((item) => ({ item, off: Math.abs(item.durationMs - original.durationMs) }))
    .sort((a, b) => a.off - b.off)

  const best = ranked[0]!
  return best.off <= CLOSE_ENOUGH_MS ? best.item : null
}
