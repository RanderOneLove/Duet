import { useEffect, useState } from 'react'

/**
 * Следить за медиазапросом, а не спрашивать его один раз при открытии.
 *
 * Нужно там, где от ширины окна или системной настройки зависит не оформление,
 * а сама разметка: ползунок громкости вместо кнопки, например. Такое нельзя
 * сделать одним CSS — элементов разное количество, — и нельзя решить при
 * первом рисовании: окно меняют размером уже после.
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches)

  useEffect(() => {
    const media = window.matchMedia(query)
    const update = (): void => setMatches(media.matches)
    update()
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [query])

  return matches
}
