import { useMemo } from 'react'
import type { Track } from '@shared/domain'

export type ServiceFilter = 'all' | 'vk' | 'yandex'

/**
 * Какой сервис показывать.
 *
 * Раньше это была пара «состояние + сегмент» внутри каждого экрана, и выбор,
 * сделанный на Главной, не совпадал с тем, что стоял в «Вам нравится». В
 * вайрфрейме v2 переключатель один, в титульной строке, а экраны только
 * применяют его — поэтому здесь остался расчёт, но не состояние.
 */
export function useFiltered(tracks: Track[], filter: ServiceFilter): Track[] {
  return useMemo(
    () => (filter === 'all' ? tracks : tracks.filter((track) => track.service === filter)),
    [tracks, filter]
  )
}
