import { globalShortcut } from 'electron'
import type { HotkeyStatus, Settings } from '@shared/types'
import { command } from './player/engine'
import { toggleMiniPlayer } from './windows/miniPlayer'

/**
 * Global shortcuts. Registration is best-effort: another app may already own a
 * combination, and that must not stop the player from starting — the shell
 * shows which ones actually took effect.
 */

let status: HotkeyStatus = {}

export function registerHotkeys(settings: Settings): HotkeyStatus {
  globalShortcut.unregisterAll()
  status = {}

  bind('hotkeyPlayPause', settings.hotkeyPlayPause, () => void command({ type: 'playPause' }))
  bind('hotkeyNext', settings.hotkeyNext, () => void command({ type: 'next' }))
  bind('hotkeyPrev', settings.hotkeyPrev, () => void command({ type: 'prev' }))
  bind('hotkeyToggleMini', settings.hotkeyToggleMini, toggleMiniPlayer)

  return status
}

export function getHotkeyStatus(): HotkeyStatus {
  return status
}

export function unregisterHotkeys(): void {
  globalShortcut.unregisterAll()
  status = {}
}

function bind(key: string, accelerator: string, handler: () => void): void {
  if (!accelerator) {
    status[key] = false
    return
  }
  try {
    status[key] = globalShortcut.register(accelerator, handler)
  } catch (error) {
    // An invalid accelerator string throws rather than returning false.
    console.warn(`[hotkeys] ${key} "${accelerator}" rejected:`, error)
    status[key] = false
  }
}
