import { nativeImage, type BrowserWindow, type ThumbarButton } from 'electron'
import { currentTrack, type PlayerState } from '@shared/player'
import { command, getPlayer, onPlayerChanged } from './player/engine'

/**
 * Кнопки в превью окна на панели задач: назад, пауза, вперёд.
 *
 * Их видно, когда наводишь на значок Duet внизу экрана, — переключить трек,
 * не разворачивая окно и не ища мини-плеер. Windows забывает их, когда окно
 * прячется, поэтому они ставятся заново при каждом показе.
 */

type Glyph = 'prev' | 'next' | 'play' | 'pause'

/** Фигуры в поле 24×24, каждая — набор выпуклых многоугольников. */
const SHAPES: Record<Glyph, [number, number][][]> = {
  prev: [
    rect(5, 6, 7.4, 18),
    [
      [18.5, 6],
      [18.5, 18],
      [8.5, 12]
    ]
  ],
  next: [
    rect(16.6, 6, 19, 18),
    [
      [5.5, 6],
      [5.5, 18],
      [15.5, 12]
    ]
  ],
  play: [
    [
      [7.5, 5],
      [7.5, 19],
      [19, 12]
    ]
  ],
  pause: [rect(6.5, 5, 10, 19), rect(14, 5, 17.5, 19)]
}

const SAMPLES = 4
const icons = new Map<Glyph, Electron.NativeImage>()

/** Значок нужного размера: 16 точек и вдвое плотнее для экранов с масштабом. */
function icon(glyph: Glyph): Electron.NativeImage {
  const known = icons.get(glyph)
  if (known) return known
  const image = nativeImage.createFromBitmap(draw(glyph, 16), { width: 16, height: 16, scaleFactor: 1 })
  image.addRepresentation({ scaleFactor: 2, width: 32, height: 32, buffer: draw(glyph, 32) })
  icons.set(glyph, image)
  return image
}

/** Белая фигура на прозрачном, BGRA с домноженной яркостью — как ждёт Windows. */
function draw(glyph: Glyph, size: number): Buffer {
  const buffer = Buffer.alloc(size * size * 4)
  const scale = size / 24
  const per = SAMPLES * SAMPLES
  for (let py = 0; py < size; py += 1) {
    for (let px = 0; px < size; px += 1) {
      let hits = 0
      for (let sy = 0; sy < SAMPLES; sy += 1) {
        for (let sx = 0; sx < SAMPLES; sx += 1) {
          const x = (px + (sx + 0.5) / SAMPLES) / scale
          const y = (py + (sy + 0.5) / SAMPLES) / scale
          if (SHAPES[glyph].some((shape) => insideConvex(x, y, shape))) hits += 1
        }
      }
      if (hits === 0) continue
      const value = Math.round((hits / per) * 255)
      const at = (py * size + px) * 4
      buffer[at] = value
      buffer[at + 1] = value
      buffer[at + 2] = value
      buffer[at + 3] = value
    }
  }
  return buffer
}

function rect(x1: number, y1: number, x2: number, y2: number): [number, number][] {
  return [
    [x1, y1],
    [x2, y1],
    [x2, y2],
    [x1, y2]
  ]
}

/** Точка внутри выпуклого многоугольника: по одну сторону от всех рёбер. */
function insideConvex(x: number, y: number, points: [number, number][]): boolean {
  let sign = 0
  for (let i = 0; i < points.length; i += 1) {
    const [ax, ay] = points[i]
    const [bx, by] = points[(i + 1) % points.length]
    const cross = (bx - ax) * (y - ay) - (by - ay) * (x - ax)
    if (cross === 0) continue
    const side = Math.sign(cross)
    if (sign === 0) sign = side
    else if (side !== sign) return false
  }
  return true
}

/** Всё, от чего зависят кнопки. Совпало с прошлым разом — ставить заново незачем. */
function keyOf(state: PlayerState): string {
  return `${currentTrack(state) ? 1 : 0}${state.playing ? 1 : 0}${canSkip(state) ? 1 : 0}`
}

/**
 * Листать можно свою очередь — и общую, если ведущий разрешил участникам.
 * В чужой сессии без такого права кнопки гаснут, а не ругаются после нажатия.
 */
function canSkip(state: PlayerState): boolean {
  if (!currentTrack(state)) return false
  if (!state.following) return true
  return state.jamGuest && state.jamPerms.skip
}

export function setupTaskbar(win: BrowserWindow): void {
  if (process.platform !== 'win32') return
  let last = ''

  const apply = (state: PlayerState, force = false): void => {
    if (win.isDestroyed()) return
    const key = keyOf(state)
    if (!force && key === last) return
    last = key

    const skip = canSkip(state)
    const buttons: ThumbarButton[] = [
      {
        tooltip: 'Предыдущий',
        icon: icon('prev'),
        flags: skip ? [] : ['disabled'],
        click: () => void command({ type: 'prev' })
      },
      {
        tooltip: state.playing ? 'Пауза' : 'Слушать',
        icon: icon(state.playing ? 'pause' : 'play'),
        // Без трека кнопка не гаснет: «Слушать» тогда включает последнюю волну.
        click: () => void command({ type: 'playPause' })
      },
      {
        tooltip: 'Следующий',
        icon: icon('next'),
        flags: skip ? [] : ['disabled'],
        click: () => void command({ type: 'next' })
      }
    ]
    win.setThumbarButtons(buttons)
  }

  onPlayerChanged((state) => apply(state))
  // Спрятанное в трей окно возвращается без кнопок — Windows их не хранит.
  win.on('show', () => apply(getPlayer(), true))
  win.once('ready-to-show', () => apply(getPlayer(), true))
}
