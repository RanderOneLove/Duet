import { useMemo, useState } from 'react'
import type { Track } from '@shared/domain'

export type ServiceFilter = 'all' | 'vk' | 'yandex'

interface Result {
  filter: ServiceFilter
  setFilter: (filter: ServiceFilter) => void
  filtered: Track[]
  /** Ready for <Segmented>, with per-service counts as hints. */
  options: { id: ServiceFilter; label: string; hint: string }[]
}

/** The All / VK / Яндекс filter shared by Liked and the Home liked block. */
export function useServiceFilter(tracks: Track[]): Result {
  const [filter, setFilter] = useState<ServiceFilter>('all')

  const vkCount = tracks.filter((track) => track.service === 'vk').length
  const yaCount = tracks.length - vkCount

  const filtered = useMemo(
    () => (filter === 'all' ? tracks : tracks.filter((track) => track.service === filter)),
    [tracks, filter]
  )

  return {
    filter,
    setFilter,
    filtered,
    options: [
      { id: 'all', label: 'Все', hint: String(tracks.length) },
      { id: 'vk', label: 'VK', hint: String(vkCount) },
      { id: 'yandex', label: 'Яндекс', hint: String(yaCount) }
    ]
  }
}
