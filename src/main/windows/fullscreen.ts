import koffi from 'koffi'

/**
 * Есть ли на экране мини-плеера чужое полноэкранное приложение.
 *
 * Electron видит только свои окна, поэтому о чужих спрашиваем Windows
 * напрямую. Полноэкранным считается окно, которое закрывает свой монитор
 * целиком, не будучи просто развёрнутым: развёрнутое занимает рабочую
 * область, а не весь экран, — кроме случая с автоскрытием панели задач, его
 * и отсекает проверка IsZoomed.
 *
 * Смотрим не только на активное окно. Видео во весь экран на одном мониторе
 * и переписка на другом — обычное дело, и плита не должна выскакивать поверх
 * видео от щелчка по соседнему экрану. Поэтому запоминается «загородившее»
 * окно, и оно держит плиту скрытой, пока само закрывает монитор. Снимает его
 * только другое окно, активированное на том же мониторе, — значит, человек
 * ушёл из полноэкранного приложения, — либо его закрытие или сворачивание.
 */

type Rect = { left: number; top: number; right: number; bottom: number }
type MonitorInfo = { cbSize: number; rcMonitor: Rect; rcWork: Rect; dwFlags: number }

type Api = {
  getForegroundWindow: () => number
  monitorFromWindow: (hwnd: number, flags: number) => number
  getMonitorInfo: (monitor: number, info: MonitorInfo) => boolean
  getWindowRect: (hwnd: number, rect: Rect) => boolean
  getWindowThreadProcessId: (hwnd: number, pid: number[]) => number
  getClassName: (hwnd: number, buffer: Buffer, length: number) => number
  isWindow: (hwnd: number) => boolean
  isWindowVisible: (hwnd: number) => boolean
  isIconic: (hwnd: number) => boolean
  isZoomed: (hwnd: number) => boolean
}

const MONITOR_DEFAULTTONEAREST = 2
const MONITORINFO_SIZE = 40

/**
 * Окна оболочки ни о чём не говорят: рабочий стол растянут на все мониторы,
 * а панель задач, меню «Пуск» и переключатель Alt+Tab всплывают поверх игры
 * на мгновение. Ни войти в полноэкранный режим, ни выйти из него они не значат.
 */
const SHELL_CLASSES = new Set([
  'Progman',
  'WorkerW',
  'Shell_TrayWnd',
  'Shell_SecondaryTrayWnd',
  'NotifyIconOverflowWindow',
  'TopLevelWindowForOverflowXamlIsland',
  'Windows.UI.Core.CoreWindow',
  'MultitaskingViewFrame',
  'XamlExplorerHostIslandWindow',
  'ForegroundStaging',
  'TaskSwitcherWnd'
])

let api: Api | null | undefined

/** null — Windows API недоступен, и плита просто не прячется. */
function loadApi(): Api | null {
  if (api !== undefined) return api
  api = null
  if (process.platform !== 'win32') return api
  try {
    const user32 = koffi.load('user32.dll')
    const RECT = koffi.struct('RECT', { left: 'int32', top: 'int32', right: 'int32', bottom: 'int32' })
    koffi.struct('MONITORINFO', { cbSize: 'uint32', rcMonitor: RECT, rcWork: RECT, dwFlags: 'uint32' })
    api = {
      getForegroundWindow: user32.func('intptr_t __stdcall GetForegroundWindow()'),
      monitorFromWindow: user32.func('intptr_t __stdcall MonitorFromWindow(intptr_t, uint32)'),
      getMonitorInfo: user32.func('bool __stdcall GetMonitorInfoW(intptr_t, _Inout_ MONITORINFO *)'),
      getWindowRect: user32.func('bool __stdcall GetWindowRect(intptr_t, _Out_ RECT *)'),
      getWindowThreadProcessId: user32.func('uint32 __stdcall GetWindowThreadProcessId(intptr_t, _Out_ uint32 *)'),
      getClassName: user32.func('int __stdcall GetClassNameW(intptr_t, _Out_ char16_t *, int)'),
      isWindow: user32.func('bool __stdcall IsWindow(intptr_t)'),
      isWindowVisible: user32.func('bool __stdcall IsWindowVisible(intptr_t)'),
      isIconic: user32.func('bool __stdcall IsIconic(intptr_t)'),
      isZoomed: user32.func('bool __stdcall IsZoomed(intptr_t)')
    }
  } catch (error) {
    console.warn('[fullscreen] Windows API недоступен:', error)
    api = null
  }
  return api
}

/** HWND из буфера, который отдаёт getNativeWindowHandle. */
export function hwndOf(handle: Buffer): number {
  return Number(handle.length >= 8 ? handle.readBigInt64LE(0) : handle.readInt32LE(0))
}

function className(win32: Api, hwnd: number): string {
  const buffer = Buffer.alloc(512)
  const length = win32.getClassName(hwnd, buffer, 256)
  return buffer.toString('utf16le', 0, Math.max(0, length) * 2)
}

/** Окно своё или оболочки — по нему нельзя судить ни о входе, ни о выходе. */
function isNeutral(win32: Api, hwnd: number): boolean {
  const pid = [0]
  win32.getWindowThreadProcessId(hwnd, pid)
  if (pid[0] === process.pid) return true
  return SHELL_CLASSES.has(className(win32, hwnd))
}

function coversMonitor(win32: Api, hwnd: number, monitor: number): boolean {
  if (!win32.isWindow(hwnd) || !win32.isWindowVisible(hwnd)) return false
  if (win32.isIconic(hwnd) || win32.isZoomed(hwnd)) return false
  if (win32.monitorFromWindow(hwnd, MONITOR_DEFAULTTONEAREST) !== monitor) return false
  const info: MonitorInfo = {
    cbSize: MONITORINFO_SIZE,
    rcMonitor: { left: 0, top: 0, right: 0, bottom: 0 },
    rcWork: { left: 0, top: 0, right: 0, bottom: 0 },
    dwFlags: 0
  }
  if (!win32.getMonitorInfo(monitor, info)) return false
  const rect: Rect = { left: 0, top: 0, right: 0, bottom: 0 }
  if (!win32.getWindowRect(hwnd, rect)) return false
  const screen = info.rcMonitor
  return (
    rect.left <= screen.left &&
    rect.top <= screen.top &&
    rect.right >= screen.right &&
    rect.bottom >= screen.bottom
  )
}

/** Окно, которое сейчас загораживает монитор плиты; 0 — такого нет. */
let blocker = 0

/**
 * Закрыт ли монитор окна `mini` чужим полноэкранным приложением. Вызывается
 * по таймеру: состояние «загородившего» окна живёт между вызовами.
 */
export function isMonitorTakenByFullscreen(mini: number): boolean {
  const win32 = loadApi()
  if (!win32) return false

  const monitor = win32.monitorFromWindow(mini, MONITOR_DEFAULTTONEAREST)
  const foreground = win32.getForegroundWindow()
  if (foreground && !isNeutral(win32, foreground)) {
    const sameMonitor = win32.monitorFromWindow(foreground, MONITOR_DEFAULTTONEAREST) === monitor
    // Активное окно на другом мониторе ничего не меняет у этого.
    if (sameMonitor) blocker = coversMonitor(win32, foreground, monitor) ? foreground : 0
  }
  // Закрыли, свернули, вышли из полноэкранного режима или унесли плиту на
  // другой монитор — загораживать больше нечему.
  if (blocker && !coversMonitor(win32, blocker, monitor)) blocker = 0
  return blocker !== 0
}

/** Забыть загородившее окно — например, когда слежку выключили. */
export function resetFullscreenWatch(): void {
  blocker = 0
}
