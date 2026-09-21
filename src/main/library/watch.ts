import type { BrowserWindow } from 'electron'
import { refreshLibrary } from '../sources/registry'

/*
 * Раз в четверть часа спрашиваем источники, не пора ли перечитать фонотеку.
 * Сами источники и решают (`likedSuspect`): почти всегда ответ «нет» и в сеть
 * никто не идёт. Смысл проверки в другом — поймать тот случай, когда обход
 * когда-то упал и список с тех пор неполный: без неё неполнота живёт до
 * перезапуска, и лайки просто не показываются.
 */
const EVERY_MS = 15 * 60 * 1000

let timer: NodeJS.Timeout | null = null

export function watchLibrary(window: BrowserWindow): void {
  stopWatchingLibrary()
  timer = setInterval(() => {
    // Свёрнутое окно никто не смотрит: проверка подождёт до возвращения.
    if (window.isDestroyed() || !window.isVisible() || window.isMinimized()) return
    void refreshLibrary()
  }, EVERY_MS)
  timer.unref()
}

export function stopWatchingLibrary(): void {
  if (!timer) return
  clearInterval(timer)
  timer = null
}
