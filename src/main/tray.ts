import { app, Menu, nativeImage, Tray } from 'electron'
import { join } from 'node:path'
import { artistLine } from '@shared/domain'
import { currentTrack, type PlayerState } from '@shared/player'
import { getPlayer, command, onPlayerChanged } from './player/engine'
import { getSettings, onSettingsChanged, setSettings } from './state/settings'
import { markImage } from './trayIcon'
import { isMiniPlayerVisible, toggleMiniPlayer } from './windows/miniPlayer'
import { markQuitting, showMainWindow, toggleMainWindow } from './windows/mainWindow'

let tray: Tray | null = null

export function createTray(): Tray {
  tray = new Tray(trayIcon(getSettings().accent))
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
  lastFace = ''
  lastAccent = ''
}

/**
 * Всё, что видно в трее, одной строкой. Пока она та же — перестраивать нечего.
 *
 * Меню и подсказка перерисовывались на каждое изменение состояния плеера, а
 * оно меняется четыре раза в секунду: тикает позиция. Каждая такая перерисовка
 * — сборка меню из двенадцати пунктов и два обращения к системному трею.
 */
let lastFace = ''

/** Цвет, которым нарисован лежащий в трее значок. */
let lastAccent = ''

/**
 * Цвет, взятый с обложки, если такой режим включён.
 *
 * Его считает окно приложения и присылает сюда: картинка уже загружена туда, и
 * тянуть её второй раз ради нескольких пикселей незачем. Пока не прислали —
 * значок держит выбранный вручную.
 */
let liveAccent: string | null = null

/** Чем сейчас покрашен значок — для проверок. */
export function getLiveAccent(): string | null {
  return liveAccent
}

export function setLiveAccent(hex: string | null): void {
  liveAccent = hex
  render()
}

/** Rebuild the menu — Electron cannot mutate a single item's label. */
function render(): void {
  if (!tray || tray.isDestroyed()) return
  const state = getPlayer()
  const settings = getSettings()

  // Значок в трее той же марки и того же цвета, что и в окне.
  const accent = (settings.accentFromCover && liveAccent) || settings.accent
  if (accent !== lastAccent) {
    lastAccent = accent
    tray.setImage(trayIcon(accent))
  }
  const track = currentTrack(state)

  const face = [
    nowPlayingLabel(state),
    tooltip(state),
    state.playing,
    track !== null,
    isMiniPlayerVisible(),
    settings.miniShowWhen
  ].join(' | ')
  if (face === lastFace) return
  lastFace = face

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
        checked: settings.miniShowWhen !== 'never',
        click: () =>
          setSettings({
            miniShowWhen: settings.miniShowWhen === 'never' ? 'minimized' : 'never'
          })
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
 * Значок для трея.
 *
 * Марка рисуется под выбранный цвет, а не берётся готовым файлом: цвет человек
 * меняет в настройках, и значок в трее должен меняться вместе со значком в
 * окне, иначе приложение выглядит двумя разными. Файл из `resources/` остаётся
 * на случай, если цвет в настройках испорчен, — тогда марку рисовать не из
 * чего, и лучше показать прежнюю, чем пустоту.
 */
function trayIcon(accent: string): Electron.NativeImage {
  const drawn = markImage(accent)
  if (!drawn.isEmpty()) return drawn

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
