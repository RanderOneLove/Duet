import { useEffect } from 'react'
import { ROW_HEIGHT, type Settings } from '@shared/types'
import { accentTokens } from './accent'

/**
 * Перенести оформление из настроек в окно.
 *
 * Всё выражается атрибутами и переменными на корне документа, а решают стили.
 * Так тема, анимации, плотность и цвет акцента настраиваются без единой строчки
 * логики в компонентах, гасятся одним значением и не спорят с системными
 * настройками доступности — те просто идут следующим правилом.
 *
 * Пользуются обе оболочки: и главное окно, и мини-плеер.
 */
export function useAppearance(settings: Settings, accentOverride?: string | null): void {
  const { theme, motion, motionPlayer, motionWave, motionScreens, density } = settings
  const accent = accentOverride ?? settings.accent

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
    root.density = density
  }, [motion, motionPlayer, motionWave, motionScreens, density])

  useEffect(() => {
    const root = document.documentElement
    // Высота строки нужна и стилям, и расчёту видимых строк в длинных списках,
    // поэтому значение одно и живёт здесь.
    root.style.setProperty('--row-h', `${ROW_HEIGHT[density]}px`)
  }, [density])

  useEffect(() => {
    const root = document.documentElement
    const tokens = accentTokens(accent)
    for (const [name, value] of Object.entries(tokens)) root.style.setProperty(name, value)
  }, [accent])
}
