import { useEffect, useState } from 'react'
import type { Settings } from '@shared/types'

/**
 * Выключено ли движение: по настройке приложения, а «как в системе» — по
 * Windows. Один ответ на все анимации — CSS-листу, шторке и Framer Motion, —
 * иначе выключатель «Сколько движения» гасил бы только часть из них.
 */
export function useQuietMotion(settings: Pick<Settings, 'motion'>): boolean {
  const [systemQuiet, setSystemQuiet] = useState(
    () => window.matchMedia('(prefers-reduced-motion: reduce)').matches
  )
  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)')
    const update = (): void => setSystemQuiet(media.matches)
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [])
  return settings.motion === 'off' || (settings.motion === 'system' && systemQuiet)
}
