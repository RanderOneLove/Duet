import { app } from 'electron'
import { autoUpdater } from 'electron-updater'
import { IDLE_UPDATE, type UpdateState } from '@shared/updates'
import { getSettings } from './state/settings'

/**
 * Обновление с GitHub.
 *
 * Установщики лежат в релизах репозитория, рядом с ними — `latest.yml`, где
 * записано, какая версия последняя и какой у файла размер и отпечаток. Отсюда
 * и берётся ответ на вопрос «вышло ли что-то новее»: никакого своего сервера
 * для этого не нужно.
 *
 * Скачивание идёт в стороне и ничему не мешает, а установка откладывается до
 * выхода из приложения. Обрывать музыку ради обновления — плохая плата за
 * свежесть, и человек, который слушает, не должен вообще замечать, что что-то
 * происходит. Захочет раньше — в «О программе» есть кнопка.
 */

/** Первая проверка не на старте: ему и без сети есть чем заняться. */
const FIRST_CHECK_DELAY_MS = 20_000
/** Дальше — раз в несколько часов, приложение живёт днями. */
const RECHECK_EVERY_MS = 6 * 60 * 60 * 1000

type Listener = (state: UpdateState) => void

let state: UpdateState = IDLE_UPDATE
const listeners = new Set<Listener>()
let timer: NodeJS.Timeout | null = null
let wired = false

export function getUpdateState(): UpdateState {
  return state
}

export function onUpdateChanged(listener: Listener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function patch(changes: Partial<UpdateState>): void {
  state = { ...state, ...changes }
  for (const listener of listeners) listener(state)
}

/**
 * Включить обновления. Из исходников приложение не обновляется: обновлять
 * нечего, и говорить об этом надо прямо, а не изображать проверку.
 */
export function setupUpdates(): void {
  if (!app.isPackaged) {
    patch({ phase: 'unsupported' })
    return
  }

  wire()

  // Установка при выходе — то, ради чего всё и затевалось: человек закрывает
  // приложение, а открывает уже новое.
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true

  setTimeout(() => {
    void checkForUpdates()
    timer = setInterval(() => void checkForUpdates(), RECHECK_EVERY_MS)
    timer.unref?.()
  }, FIRST_CHECK_DELAY_MS).unref?.()
}

export function stopUpdates(): void {
  if (timer) clearInterval(timer)
  timer = null
}

/**
 * Посмотреть, есть ли что-то новее. `manual` отличает нажатие кнопки от
 * проверки по расписанию: по расписанию мы молчим, когда обновления выключены,
 * а на прямую просьбу отвечаем всегда.
 */
export async function checkForUpdates(manual = false): Promise<UpdateState> {
  if (!app.isPackaged) {
    patch({ phase: 'unsupported' })
    return state
  }
  if (!manual && !getSettings().autoUpdate) return state
  // Уже скачано — проверять нечего, надо перезапускать.
  if (state.phase === 'ready' || state.phase === 'downloading') return state

  wire()
  patch({ phase: 'checking', error: null })
  try {
    await autoUpdater.checkForUpdates()
  } catch (error) {
    patch({ phase: 'error', error: readable(error) })
  }
  return state
}

/** Перезапуститься и встать новой версией прямо сейчас. */
export function installUpdate(): boolean {
  if (state.phase !== 'ready') return false
  // Выход должен быть настоящим: обычное закрытие окна прячет приложение в трей.
  setImmediate(() => autoUpdater.quitAndInstall(false, true))
  return true
}

/** Подписки на события — один раз за жизнь процесса. */
function wire(): void {
  if (wired) return
  wired = true

  autoUpdater.on('update-available', (info) => {
    patch({ phase: 'downloading', version: info.version, progress: 0, error: null })
  })
  autoUpdater.on('update-not-available', (info) => {
    patch({ phase: 'current', version: info.version, progress: 0, error: null, checkedAt: Date.now() })
  })
  autoUpdater.on('download-progress', (progress) => {
    patch({ phase: 'downloading', progress: Math.max(0, Math.min(1, progress.percent / 100)) })
  })
  autoUpdater.on('update-downloaded', (info) => {
    patch({ phase: 'ready', version: info.version, progress: 1, error: null, checkedAt: Date.now() })
  })
  autoUpdater.on('error', (error) => {
    patch({ phase: 'error', error: readable(error) })
  })
}

/**
 * Ошибки обновления приходят техническими. Чаще всего дело в двух вещах: сети
 * нет или релиз собран без описания версии — и в обоих случаях человеку важно
 * не сообщение библиотеки, а что теперь делать.
 */
function readable(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error)
  if (/ENOTFOUND|ETIMEDOUT|ECONNRESET|ERR_INTERNET_DISCONNECTED|getaddrinfo/i.test(text)) {
    return 'Нет связи с GitHub — попробуйте позже'
  }
  if (/404|latest\.yml/i.test(text)) {
    return 'В последнем релизе нет описания версии — обновляться пока не из чего'
  }
  if (/rate limit/i.test(text)) return 'GitHub временно отказывает в ответах — попробуйте позже'
  return text
}
