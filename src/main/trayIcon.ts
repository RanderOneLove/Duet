import { nativeImage } from 'electron'

/**
 * Значок Duet, нарисованный под выбранный цвет.
 *
 * В трее лежит картинка, а не разметка, поэтому взять цвет из темы, как делает
 * значок в окне, здесь не выйдет — марку приходится рисовать самим. Фигура
 * простая: два круга радиусом 40 в поле 115×80, левый цветной, правый светлый,
 * пересечение — смесь. Считается она точно так же, как её описывает SVG, чтобы
 * значок в трее и значок в окне были одной и той же марки.
 */

/** Круги марки в системе координат вайрфрейма (viewBox 115×80). */
const LEFT = { x: 40, y: 40, r: 40 }
const RIGHT = { x: 75, y: 40, r: 40 }
const ART_W = 115
const ART_H = 80

/** Светлый круг: он же второй круг марки. */
const SECOND: RGB = [233, 233, 237]

/** Сглаживание: столько выборок на пиксель по каждой оси. */
const SAMPLES = 4

type RGB = [number, number, number]

export function markImage(accent: string, size = 32): Electron.NativeImage {
  const left = parseHex(accent) ?? [74, 108, 247]
  // Пересечение в SVG — смесь цветного и светлого; повторяем её же.
  const overlap = mix(left, SECOND, 0.6)

  // Марка шире, чем выше: вписываем её в квадрат по ширине и центрируем.
  const scale = size / ART_W
  const offsetY = (size - ART_H * scale) / 2

  const buffer = Buffer.alloc(size * size * 4)
  const step = 1 / SAMPLES
  const per = SAMPLES * SAMPLES

  for (let py = 0; py < size; py += 1) {
    for (let px = 0; px < size; px += 1) {
      let r = 0
      let g = 0
      let b = 0
      let hits = 0

      for (let sy = 0; sy < SAMPLES; sy += 1) {
        for (let sx = 0; sx < SAMPLES; sx += 1) {
          const ax = (px + (sx + 0.5) * step) / scale
          const ay = (py + (sy + 0.5) * step - offsetY) / scale
          const inLeft = inside(ax, ay, LEFT)
          const inRight = inside(ax, ay, RIGHT)
          if (!inLeft && !inRight) continue
          const colour = inLeft && inRight ? overlap : inLeft ? left : SECOND
          r += colour[0]
          g += colour[1]
          b += colour[2]
          hits += 1
        }
      }

      const at = (py * size + px) * 4
      if (hits === 0) continue
      const alpha = hits / per
      // Windows ждёт BGRA с домноженной на прозрачность яркостью.
      buffer[at] = Math.round((b / hits) * alpha)
      buffer[at + 1] = Math.round((g / hits) * alpha)
      buffer[at + 2] = Math.round((r / hits) * alpha)
      buffer[at + 3] = Math.round(alpha * 255)
    }
  }

  return nativeImage.createFromBitmap(buffer, { width: size, height: size })
}

function inside(x: number, y: number, circle: { x: number; y: number; r: number }): boolean {
  const dx = x - circle.x
  const dy = y - circle.y
  return dx * dx + dy * dy <= circle.r * circle.r
}

function mix(a: RGB, b: RGB, share: number): RGB {
  return [
    Math.round(a[0] * share + b[0] * (1 - share)),
    Math.round(a[1] * share + b[1] * (1 - share)),
    Math.round(a[2] * share + b[2] * (1 - share))
  ]
}

/** `#rrggbb` или `#rgb`; всё остальное — не цвет, и звать его цветом не надо. */
function parseHex(value: string): RGB | null {
  const text = value.trim().replace(/^#/, '')
  const full = text.length === 3 ? text.replace(/./g, (c) => c + c) : text
  if (!/^[0-9a-f]{6}$/i.test(full)) return null
  return [
    parseInt(full.slice(0, 2), 16),
    parseInt(full.slice(2, 4), 16),
    parseInt(full.slice(4, 6), 16)
  ]
}
