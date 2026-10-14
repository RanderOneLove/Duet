import { BrowserWindow, session } from 'electron'
import { join } from 'node:path'
import { IPC } from '@shared/ipc'
import type { AudioControl, AudioLoad } from '../../preload/audio'

/**
 * A hidden window that owns the media element. Keeping audio out of the UI
 * window means playback is unaffected by hiding to the tray, heavy list
 * rendering, or the shell reloading during development.
 */

let win: BrowserWindow | null = null
/** Commands issued before the host finished loading, replayed on ready. */
let pending: { channel: string; payload: unknown }[] = []
let ready = false

export function createAudioHost(): BrowserWindow {
  if (win && !win.isDestroyed()) return win

  win = new BrowserWindow({
    show: false,
    width: 320,
    height: 120,
    webPreferences: {
      preload: join(__dirname, '../preload/audio.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      // Nothing here is user-visible, so there is no gesture to wait for.
      autoplayPolicy: 'no-user-gesture-required',
      backgroundThrottling: false
    }
  })

  allowReadingAudio(win.webContents.id)

  const devServer = process.env['ELECTRON_RENDERER_URL']
  if (devServer) void win.loadURL(`${devServer}/audio/index.html`)
  else void win.loadFile(join(__dirname, '../renderer/audio/index.html'))

  win.webContents.once('did-finish-load', () => {
    ready = true
    for (const item of pending) win?.webContents.send(item.channel, item.payload)
    pending = []
  })

  win.on('closed', () => {
    win = null
    ready = false
  })

  return win
}

/**
 * Разрешить хосту читать звук, который он играет.
 *
 * Выравнивание громкости меряет звук в Web Audio, а Chromium отдаёт туда
 * чужой звук только с разрешения сервера — заголовком CORS. Серверы VK и
 * Яндекса его не обещают, поэтому он дописывается здесь, и только к ответам
 * для окна звука: остальные окна живут по обычным правилам.
 *
 * Слушатель у сессии один на всё приложение — второй вызов заменит этот.
 */
let readingAllowedFor = -1

function allowReadingAudio(webContentsId: number): void {
  const first = readingAllowedFor === -1
  readingAllowedFor = webContentsId
  if (!first) return
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    if (details.webContentsId !== readingAllowedFor || !details.responseHeaders) {
      callback({})
      return
    }
    const headers: Record<string, string[]> = {}
    for (const [name, value] of Object.entries(details.responseHeaders)) {
      // Свой ответ сервера мог разрешать другой адрес — он заменяется целиком.
      const lower = name.toLowerCase()
      if (lower === 'access-control-allow-origin' || lower === 'access-control-allow-credentials') continue
      headers[name] = value
    }
    headers['Access-Control-Allow-Origin'] = ['*']
    callback({ responseHeaders: headers })
  })
}

export function loadAudio(payload: AudioLoad): void {
  send(IPC.audioLoad, payload)
}

export function controlAudio(command: AudioControl): void {
  send(IPC.audioControl, command)
}

export function destroyAudioHost(): void {
  if (win && !win.isDestroyed()) win.destroy()
  win = null
  ready = false
}

function send(channel: string, payload: unknown): void {
  const target = createAudioHost()
  if (!ready) {
    pending.push({ channel, payload })
    return
  }
  target.webContents.send(channel, payload)
}
