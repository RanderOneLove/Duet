import { useEffect } from 'react'
import type { Settings } from '@shared/types'

/**
 * Перенести оформление из настроек в окно.
 *
 * Всё выражается атрибутами на корне документа, а решают стили. Так анимации
 * настраиваются без единой строчки логики в компонентах, гасятся одним
 * значением и не спорят с системной настройкой «меньше движения» — та просто
 * идёт следующим правилом и перекрывает выбранное.
 *
 * Пользуются обе оболочки: и главное окно, и мини-плеер.
 */
export function useAppearance(settings: Settings): void {
  const { theme, motion, motionPlayer, motionWave, motionScreens } = settings

  useEffect(() => {
    const system = window.matchMedia('(prefers-color-scheme: light)')

    const apply = (): void => {
      // «Как в системе» разрешается здесь, а не в CSS: так у окна всегда есть
      // однозначный ответ на вопрос «какая сейчас тема», а в настройках
      // остаётся записанным именно то, что выбрал человек.
      const resolved = theme === 'system' ? (system.matches ? 'light' : 'dark') : theme
      document.documentElement.dataset.theme = resolved
    }

    apply()
    if (theme !== 'system') return
    system.addEventListener('change', apply)
    return () => system.removeEventListener('change', apply)
  }, [theme])

  useEffect(() => {
    const root = document.documentElement.dataset
    root.motion = motion
    root.animPlayer = motionPlayer
    root.animWave = motionWave
    root.animScreens = motionScreens
  }, [motion, motionPlayer, motionWave, motionScreens])
}
