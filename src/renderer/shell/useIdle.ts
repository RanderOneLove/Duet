import { useEffect, useRef, useState } from 'react'

/**
 * Простаивает ли человек прямо сейчас.
 *
 * Нужно там, где интерфейс мешает содержимому: в плеере «во всё окно» слова
 * песни занимают весь экран, а кнопки окна над ними — служебная полоса, на
 * которую нечего смотреть, пока её не понадобилось нажать. Поэтому она уходит
 * в покое и возвращается от любого движения.
 *
 * `enabled` — выключатель: при «движение выключено» ничего не прячется вовсе,
 * иначе пропадание кнопок само становится движением, от которого отказались.
 * Слушатели вешаются на окно и в фазе перехвата: нажатие внутри плиты тоже
 * считается признаком жизни.
 */
export function useIdle(delayMs: number, enabled = true): boolean {
  const [idle, setIdle] = useState(false)
  const timer = useRef<number | null>(null)

  useEffect(() => {
    if (!enabled) {
      setIdle(false)
      return
    }

    const stop = (): void => {
      if (timer.current !== null) window.clearTimeout(timer.current)
    }

    const restart = (): void => {
      stop()
      timer.current = window.setTimeout(() => setIdle(true), delayMs)
    }

    const wake = (): void => {
      setIdle((was) => (was ? false : was))
      restart()
    }

    const events: (keyof WindowEventMap)[] = [
      'mousemove',
      'mousedown',
      'wheel',
      'keydown',
      'touchstart'
    ]
    for (const name of events) window.addEventListener(name, wake, { passive: true })
    restart()

    return () => {
      stop()
      for (const name of events) window.removeEventListener(name, wake)
    }
  }, [delayMs, enabled])

  return idle
}
