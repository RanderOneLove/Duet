import { BrowserWindow } from 'electron'
import { join } from 'node:path'
import { IPC } from '@shared/ipc'
import { getSettings, onSettingsChanged } from '../state/settings'
import { mark } from '../perf'

/**
 * The app shell: our own dark chrome (sidebar, top bar, now-playing bar) with
 * the active service's web view mounted into the content area.
 */

let win: BrowserWindow | null = null

/** Set on 'before-quit' so closing the window hides to tray instead of exiting. */
let quitting = false

export function markQuitting(): void {
  quitting = true
}

export function isQuitting(): boolean {
  return quitting
}

export function getMainWindow(): BrowserWindow | null {
  return win && !win.isDestroyed() ? win : null
}

export function createMainWindow(options: { startHidden?: boolean } = {}): BrowserWindow {
  win = new BrowserWindow({
    width: 1180,
    height: 760,
    minWidth: 940,
    minHeight: 600,
    show: false,
    frame: false,
    backgroundColor: '#121212',
    webPreferences: {
      preload: join(__dirname, '../preload/shell.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })

  const devServer = process.env['ELECTRON_RENDERER_URL']
  if (devServer) void win.loadURL(`${devServer}/shell/index.html`)
  else void win.loadFile(join(__dirname, '../renderer/shell/index.html'))

  win.once('ready-to-show', () => {
    mark('shellReady')
    // Auto-started into the tray: stay out of the way until asked for.
    if (options.startHidden) return
    win?.show()
    pushSettings()
  })

  // Closing the window parks the app in the tray; only 'before-quit' really exits.
  win.on('close', (event) => {
    if (quitting) return
    event.preventDefault()
    win?.hide()
  })

  win.on('closed', () => {
    win = null
  })

  onSettingsChanged(pushSettings)

  return win
}

export function showMainWindow(): void {
  const target = getMainWindow()
  if (!target) return
  if (target.isMinimized()) target.restore()
  target.show()
  target.focus()
}

export function hideMainWindow(): void {
  getMainWindow()?.hide()
}

export function toggleMainWindow(): void {
  const target = getMainWindow()
  if (!target) return
  if (target.isVisible() && !target.isMinimized()) hideMainWindow()
  else showMainWindow()
}

export function sendToShell(channel: string, payload: unknown): void {
  getMainWindow()?.webContents.send(channel, payload)
}

function pushSettings(): void {
  sendToShell(IPC.settingsChanged, getSettings())
}
