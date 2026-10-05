import { BrowserWindow, screen } from 'electron'
import { join } from 'node:path'
import { IPC } from '@shared/ipc'
import { MINI_SIZES, isEdgeVariant, type EdgeInfo, type MiniAnchor, type Settings } from '@shared/types'
import { createMiniWire, getPlayer, onPlayerChanged } from '../player/engine'
import { getSettings, onSettingsChanged, setSettings } from '../state/settings'

/**
 * The always-on-top mini player shown while the app sits in the tray.
 *
 * The window is frameless and transparent, so it must hug its content exactly —
 * transparent padding would still swallow clicks meant for the app underneath.
 * The renderer measures itself and reports its size through `mini:resize`.
 */

let win: BrowserWindow | null = null
let size = { width: 0, height: 0 }
/** Set while we reposition the window ourselves, so 'moved' ignores it. */
let repositioning = false
let listenersBound = false

export function createMiniPlayer(): BrowserWindow {
  if (win && !win.isDestroyed()) return win

  const settings = getSettings()
  size = { ...MINI_SIZES[settings.miniVariant] }

  // A new window knows nothing, so the next push must carry the queue.
  toMini = createMiniWire()

  win = new BrowserWindow({
    ...size,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    resizable: false,
    movable: canDrag(settings),
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    hasShadow: false,
    webPreferences: {
      preload: join(__dirname, '../preload/mini.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })

  // 'screen-saver' keeps it visible over full-screen apps, which 'floating'
  // does not on Windows — unless they raise themselves later (see syncRaise).
  win.setAlwaysOnTop(true, 'screen-saver')
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })

  loadRenderer(win)

  win.once('ready-to-show', () => {
    pushConfig()
    pushPlayback()
  })

  /*
   * Перетаскивание переводит привязку в «своё место» и запоминает, куда окно
   * положили. Наш собственный setBounds тоже поднимает 'moved' — отсюда флаг.
   *
   * Вместе с координатами запоминается и экран: перенос на соседний монитор и
   * есть выбор монитора. Без этого настройка продолжала указывать на прежний
   * дисплей, а applyBounds прижимает окно к его границам — виджет возвращался
   * обратно тем же движением, которым его унесли.
   */
  win.on('moved', () => {
    if (repositioning || !win || win.isDestroyed()) return
    // Шторку и язычок двигает только край экрана, а не рука.
    if (isEdgeVariant(getSettings().miniVariant)) return
    const bounds = win.getBounds()
    setSettings({
      miniAnchor: 'custom',
      miniCustomX: bounds.x,
      miniCustomY: bounds.y,
      miniDisplayId: screen.getDisplayMatching(bounds).id
    })
  })

  win.on('closed', () => {
    win = null
  })

  // Bound once for the process: the window may be destroyed and recreated.
  if (!listenersBound) {
    listenersBound = true
    onPlayerChanged(pushPlayback)
    onSettingsChanged((next) => {
      pushConfig()
      syncRaise(next)
      win?.setMovable(canDrag(next))
      // A variant change alters the content size; re-place on the new anchor.
      applyBounds(size.width, size.height, next)
    })
  }

  return win
}

/**
 * Hover is detected from the cursor position rather than DOM events: the whole
 * plate is a `-webkit-app-region: drag` surface so it can be moved by grabbing
 * anywhere, and Windows does not deliver mouse events over drag regions — the
 * renderer would only ever see the pointer over the buttons.
 */
let hoverTimer: NodeJS.Timeout | null = null
let hovered = false

/** Форма шторки или язычка внутри окна; null — плита, она и есть окно. */
let edge: EdgeInfo | null = null

/**
 * Принять от плиты, где её форма и ловит ли она мышь.
 *
 * Мышь пропускается насквозь, пока форма не раскрыта: в покое это полоска, по
 * которой щёлкать незачем, а прозрачный запас окна вокруг неё лежит прямо над
 * краем чужого окна — над его полосой прокрутки, заголовком, кнопками.
 */
export function setMiniEdge(info: EdgeInfo | null): void {
  edge = info
  if (!win || win.isDestroyed()) return
  win.setIgnoreMouseEvents(info ? !info.interactive : false)
}

function startHoverWatch(): void {
  if (hoverTimer) return
  hoverTimer = setInterval(() => {
    if (!win || win.isDestroyed() || !win.isVisible()) return
    const point = screen.getCursorScreenPoint()
    const bounds = win.getBounds()
    // У шторки и язычка наведение — это курсор над формой, а не над окном.
    const b = edge
      ? {
          x: bounds.x + edge.hit.x,
          y: bounds.y + edge.hit.y,
          width: edge.hit.width,
          height: edge.hit.height
        }
      : bounds
    // A couple of pixels of slack stops the state flapping on the border.
    const slack = hovered ? 2 : 0
    const inside =
      point.x >= b.x - slack &&
      point.x < b.x + b.width + slack &&
      point.y >= b.y - slack &&
      point.y < b.y + b.height + slack
    if (inside === hovered) return
    hovered = inside
    win.webContents.send(IPC.miniHover, hovered)
  }, HOVER_POLL_MS)
}

function stopHoverWatch(): void {
  if (hoverTimer) clearInterval(hoverTimer)
  hoverTimer = null
  hovered = false
}

const HOVER_POLL_MS = 120

/**
 * Поверх полноэкранных приложений.
 *
 * Уровень 'screen-saver' в Windows значит просто «поверх всех», а таких окон
 * бывает несколько: они делят один слой, и сверху то, что подняли последним.
 * Игра или видеоплеер во весь экран часто сами встают «поверх всех» и при
 * каждом щелчке по ним поднимаются над мини-плеером. Узнать, что на переднем
 * плане полноэкранное окно, Electron не умеет, поэтому при включённой
 * настройке плита просто поднимается обратно раз в секунду. Фокус она при
 * этом не забирает: moveTop в Windows двигает окно без активации.
 *
 * Игру в эксклюзивном полноэкранном режиме не перекрыть ничем — она владеет
 * экраном целиком, и об этом сказано в подсказке настройки.
 */
const RAISE_MS = 1000
let raiseTimer: NodeJS.Timeout | null = null

function syncRaise(settings: Settings): void {
  const want = settings.miniOverFullscreen && isMiniPlayerVisible()
  if (want && !raiseTimer) {
    raiseTimer = setInterval(() => {
      if (!win || win.isDestroyed() || !win.isVisible()) return
      win.setAlwaysOnTop(true, 'screen-saver')
      win.moveTop()
    }, RAISE_MS)
  } else if (!want && raiseTimer) {
    clearInterval(raiseTimer)
    raiseTimer = null
  }
}

export function showMiniPlayer(): void {
  const target = createMiniPlayer()
  applyBounds(size.width, size.height, getSettings())
  // showInactive keeps focus where the user is actually working.
  target.showInactive()
  target.setAlwaysOnTop(true, 'screen-saver')
  startHoverWatch()
  syncRaise(getSettings())
  pushConfig()
  pushPlayback()
}

export function hideMiniPlayer(): void {
  stopHoverWatch()
  if (win && !win.isDestroyed()) win.hide()
  syncRaise(getSettings())
}

export function isMiniPlayerVisible(): boolean {
  return Boolean(win && !win.isDestroyed() && win.isVisible())
}

export function toggleMiniPlayer(): void {
  if (isMiniPlayerVisible()) hideMiniPlayer()
  else showMiniPlayer()
}

export function destroyMiniPlayer(): void {
  stopHoverWatch()
  if (win && !win.isDestroyed()) win.destroy()
  win = null
  syncRaise(getSettings())
}

/** Resize to the renderer's measured content, keeping the anchored edges put. */
export function resizeMiniPlayer(width: number, height: number): void {
  /*
   * Нижний предел — от плит: окно меньше 120×40 у них значило бы ошибку
   * замера. У шторки и язычка покой и есть полоска в несколько пикселей, и
   * этот предел раздувал бы её в невидимую плашку, ловящую щелчки.
   */
  const edge = isEdgeVariant(getSettings().miniVariant)
  const w = Math.max(edge ? 4 : 120, Math.round(width))
  const h = Math.max(edge ? 4 : 40, Math.round(height))
  if (w === size.width && h === size.height) return
  size = { width: w, height: h }
  applyBounds(w, h, getSettings())
}

/** Reset with the window: a fresh one must be told the queue it starts on. */
let toMini = createMiniWire()

export function pushPlayback(): void {
  if (!win || win.isDestroyed()) return
  win.webContents.send(IPC.playerState, toMini(getPlayer()))
}

/** Послать плите что-нибудь одно — например, цвет, взятый с обложки. */
export function sendToMini(channel: string, payload: unknown): void {
  if (!win || win.isDestroyed()) return
  win.webContents.send(channel, payload)
}

export function pushConfig(): void {
  if (!win || win.isDestroyed()) return
  win.webContents.send(IPC.settingsChanged, getSettings())
}

function loadRenderer(target: BrowserWindow): void {
  const devServer = process.env['ELECTRON_RENDERER_URL']
  if (devServer) void target.loadURL(`${devServer}/mini/index.html`)
  else void target.loadFile(join(__dirname, '../renderer/mini/index.html'))
}

/**
 * Place the window for the current size. Presets hug a screen edge; 'custom'
 * grows inward from whichever corner the window sits nearest, so expanding on
 * hover never pushes it off the display.
 */
function applyBounds(width: number, height: number, settings: Settings): void {
  if (!win || win.isDestroyed()) return

  if (isEdgeVariant(settings.miniVariant)) {
    placeAtEdge(width, height, settings)
    return
  }

  const previous = win.getBounds()
  /*
   * У пресетов экран берётся из настройки, у «своего места» — тот, на котором
   * окно сейчас лежит. Пока перетаскивание идёт, настройка ещё указывает на
   * прежний монитор, и считать границы по ней значило бы отменять перенос.
   */
  const display =
    settings.miniAnchor === 'custom' ? screen.getDisplayMatching(previous) : pickDisplay(settings)
  const area = display.workArea
  let x: number
  let y: number

  if (settings.miniAnchor === 'custom') {
    const left = settings.miniCustomX ?? previous.x
    const top = settings.miniCustomY ?? previous.y
    // Keep the edge nearest the screen border fixed, so growing on hover moves
    // the window inward rather than off the display.
    const growsLeft = left + previous.width / 2 > area.x + area.width / 2
    const growsUp = top + previous.height / 2 > area.y + area.height / 2
    x = growsLeft ? left + previous.width - width : left
    y = growsUp ? top + previous.height - height : top
  } else {
    const margin = settings.miniMargin
    const [vertical, horizontal] = splitAnchor(settings.miniAnchor)
    x =
      horizontal === 'left'
        ? area.x + margin
        : horizontal === 'right'
          ? area.x + area.width - width - margin
          : area.x + Math.round((area.width - width) / 2)
    y = vertical === 'top' ? area.y + margin : area.y + area.height - height - margin
  }

  // Never let the window leave the display it belongs to.
  x = clamp(x, area.x, area.x + area.width - width)
  y = clamp(y, area.y, area.y + area.height - height)

  repositioning = true
  win.setBounds({ x, y, width, height })
  // 'moved' is emitted asynchronously after setBounds returns.
  setImmediate(() => {
    repositioning = false
  })
}

/**
 * Шторка и язычок прижаты к краю экрана, а не к углу.
 *
 * Шторка срастается с верхним краем, язычок — с боковым, и оба растут от края
 * внутрь: шторка вниз, язычок вбок. Середину они держат при любом размере —
 * шторка по горизонтали (если стоит по центру), язычок по вертикали, — поэтому
 * раскрытие выглядит как рост из одной точки, а не как съезд в сторону.
 *
 * Берётся рабочая область, а не весь экран: если панель задач стоит сверху или
 * сбоку, полоска должна прижаться к ней, а не спрятаться под неё.
 */
const NOTCH_SIDE_INSET = 32

function placeAtEdge(width: number, height: number, settings: Settings): void {
  if (!win || win.isDestroyed()) return
  const area = pickDisplay(settings).workArea
  let x: number
  let y: number

  if (settings.miniVariant === 'notch') {
    y = area.y
    x =
      settings.notchPlace === 'left'
        ? area.x + NOTCH_SIDE_INSET
        : settings.notchPlace === 'right'
          ? area.x + area.width - width - NOTCH_SIDE_INSET
          : area.x + Math.round((area.width - width) / 2)
  } else {
    x = settings.sideEdge === 'left' ? area.x : area.x + area.width - width
    y = area.y + Math.round((area.height - height) / 2)
  }

  x = clamp(x, area.x, area.x + area.width - width)
  y = clamp(y, area.y, area.y + area.height - height)

  repositioning = true
  win.setBounds({ x, y, width, height })
  setImmediate(() => {
    repositioning = false
  })
}

/** Перетаскивать можно плиту, но не то, что прижато к краю экрана. */
function canDrag(settings: Settings): boolean {
  return settings.miniDraggable && !isEdgeVariant(settings.miniVariant)
}

function splitAnchor(anchor: Exclude<MiniAnchor, 'custom'>): ['top' | 'bottom', 'left' | 'center' | 'right'] {
  const [vertical, horizontal] = anchor.split('-') as ['top' | 'bottom', 'left' | 'center' | 'right']
  return [vertical, horizontal]
}

/** The configured display, falling back to the primary one when unplugged. */
function pickDisplay(settings: Settings): Electron.Display {
  if (settings.miniDisplayId != null) {
    const match = screen.getAllDisplays().find((display) => display.id === settings.miniDisplayId)
    if (match) return match
  }
  return screen.getPrimaryDisplay()
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}
