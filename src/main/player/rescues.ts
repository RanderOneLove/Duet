import type { ServiceId } from '@shared/domain'

/**
 * Треки, которые сыграли вместо недоступных — найденные во втором сервисе.
 *
 * Отдельным модулем без зависимостей: движок пишет сюда в момент подмены, а
 * журнал прослушиваний забирает, когда трек зазвучит. Напрямую они друг друга
 * не импортируют — журнал сам смотрит на движок.
 */

const rescued = new Map<string, ServiceId>()

export function noteRescued(trackId: string, from: ServiceId): void {
  rescued.set(trackId, from)
  // Подмена случается редко; держать больше сотни незачем.
  if (rescued.size > 100) rescued.delete(rescued.keys().next().value!)
}

/** Забрать отметку: одна подмена — одно прослушивание. */
export function takeRescued(trackId: string): ServiceId | null {
  const from = rescued.get(trackId) ?? null
  rescued.delete(trackId)
  return from
}
