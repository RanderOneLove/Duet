import { app, Menu, nativeImage, Tray } from 'electron'
import { join } from 'node:path'
import { artistLine } from '@shared/domain'
import { currentTrack, type PlayerState } from '@shared/player'
import { getPlayer, command, onPlayerChanged } from './player/engine'
import { getSettings, onSettingsChanged, setSettings } from './state/settings'
import { isMiniPlayerVisible, toggleMiniPlayer } from './windows/miniPlayer'
import { markQuitting, showMainWindow, toggleMainWindow } from './windows/mainWindow'

let tray: Tray | null = null

export function createTray(): Tray {
  tray = new Tray(trayIcon())
  tray.setToolTip(app.getName())
  tray.on('click', toggleMainWindow)
  tray.on('double-click', showMainWindow)

  render()
  onPlayerChanged(render)
  onSettingsChanged(render)

  return tray
}

export function destroyTray(): void {
  tray?.destroy()
  tray = null
}

/** Rebuild the menu — Electron cannot mutate a single item's label. */
function render(): void {
  if (!tray || tray.isDestroyed()) return
  const state = getPlayer()
  const settings = getSettings()
  const track = currentTrack(state)

  tray.setToolTip(tooltip(state))
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: nowPlayingLabel(state), enabled: false },
      { type: 'separator' },
      {
        label: state.playing ? 'Пауза' : 'Воспроизвести',
        enabled: track !== null,
        click: () => void command({ type: 'playPause' })
      },
      { label: 'Предыдущий', enabled: track !== null, click: () => void command({ type: 'prev' }) },
      { label: 'Следующий', enabled: track !== null, click: () => void command({ type: 'next' }) },
      { type: 'separator' },
      { label: 'Мини-плеер', type: 'checkbox', checked: isMiniPlayerVisible(), click: toggleMiniPlayer },
      {
        label: 'Показывать мини-плеер при сворачивании',
        type: 'checkbox',
        checked: settings.miniOnMinimize,
        click: () => setSettings({ miniOnMinimize: !settings.miniOnMinimize })
      },
      { type: 'separator' },
      { label: 'Открыть приложение', click: showMainWindow },
      {
        label: 'Выход',
        click: () => {
          markQuitting()
          app.quit()
        }
      }
    ])
  )
}

function nowPlayingLabel(state: PlayerState): string {
  const track = currentTrack(state)
  if (!track) return 'Ничего не играет'
  const artists = artistLine(track)
  return truncate(`${artists ? `${artists} — ` : ''}${track.title}`, 60)
}

function tooltip(state: PlayerState): string {
  const track = currentTrack(state)
  if (!track) return app.getName()
  // Windows truncates tray tooltips at 127 chars.
  return truncate(`${track.title}\n${artistLine(track)}`, 120)
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text
}

/**
 * The tray icon lives in `resources/`, outside the bundle — next to the sources
 * in development, beside app.asar in a packaged build.
 */
function trayIcon(): Electron.NativeImage {
  const candidates = app.isPackaged
    ? [join(process.resourcesPath, 'tray.ico'), join(process.resourcesPath, 'app.asar.unpacked/resources/tray.ico')]
    : [join(__dirname, '../../resources/tray.ico')]

  for (const candidate of candidates) {
    const image = nativeImage.createFromPath(candidate)
    if (!image.isEmpty()) return image
  }
  // A 1×1 transparent pixel: an empty image makes `new Tray()` throw on Windows.
  return nativeImage.createFromDataURL(BLANK_PIXEL)
}

const BLANK_PIXEL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='
