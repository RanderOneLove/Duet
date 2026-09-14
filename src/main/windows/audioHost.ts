import { BrowserWindow } from 'electron'
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
